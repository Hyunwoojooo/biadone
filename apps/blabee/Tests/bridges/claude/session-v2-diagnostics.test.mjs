import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SESSION_V2_AUTHORITY_KEYS, SessionV2ClientError } from '../../../bridges/claude/src/session-v2-client.mjs';
import { createSessionV2DiagnosticWriter, runSessionV2MCP } from '../../../bridges/claude/src/session-v2-mcp.mjs';

const moduleURL = new URL('../../../bridges/claude/src/session-v2-mcp.mjs', import.meta.url);
const ep = () => Object.assign(new Error('PRIVATE diagnostic pipe failure'), { code: 'EPIPE' });
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('diagnostic fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function sink(mode = 'healthy') {
  const stream = new EventEmitter();
  stream.writes = [];
  stream.ownershipCalls = [];
  for (const name of ['destroy', 'end', 'unref']) stream[name] = () => { stream.ownershipCalls.push(name); };
  stream.write = (message, callback) => {
    stream.writes.push(message);
    if (mode === 'throw') throw ep();
    if (mode === 'callback-error') callback(ep());
    return mode !== 'backpressure';
  };
  return stream;
}

for (const mode of ['throw', 'callback-error', 'backpressure']) {
  test(`diagnostic ${mode} disables further writes without owning stderr or retrying`, async () => {
    const stream = sink(mode);
    const write = createSessionV2DiagnosticWriter(stream);
    assert.equal(write('first diagnostic'), false);
    assert.equal(write('must be dropped'), false);
    await turn();
    assert.doesNotThrow(() => stream.emit('error', ep()));
    stream.emit('close');
    assert.doesNotThrow(() => stream.emit('error', ep()), 'late error remains handled even after close');
    assert.deepEqual(stream.writes, ['first diagnostic']);
    assert.deepEqual(stream.ownershipCalls, []);
  });
}

for (const event of ['error', 'close', 'finish']) for (const before of [true, false]) {
  test(`${event} ${before ? 'before' : 'after'} a diagnostic disables only this diagnostic sink`, () => {
    const stream = sink();
    const write = createSessionV2DiagnosticWriter(stream);
    if (!before) assert.equal(write('queued once'), true);
    stream.emit(event, ep());
    assert.equal(write('never queued'), false);
    assert.doesNotThrow(() => stream.emit('error', ep()));
    assert.deepEqual(stream.writes, before ? [] : ['queued once']);
    assert.deepEqual(stream.ownershipCalls, []);
  });
}

test('already ended, finished, closed or destroyed streams are not written and retain late error handling', () => {
  for (const state of ['writableEnded', 'writableFinished', 'destroyed', 'closed', 'writable']) {
    const stream = sink();
    stream[state] = state !== 'writable';
    const write = createSessionV2DiagnosticWriter(stream);
    assert.equal(write('not queued'), false);
    assert.doesNotThrow(() => stream.emit('error', ep()));
    assert.deepEqual(stream.writes, []);
    assert.deepEqual(stream.ownershipCalls, []);
  }
});

test('repeated users share one diagnostic writer and do not multiply stream listeners', () => {
  const stream = sink();
  const write = createSessionV2DiagnosticWriter(stream);
  for (let index = 0; index < 40; index++) assert.equal(createSessionV2DiagnosticWriter(stream), write);
  for (const event of ['error', 'close', 'finish']) assert.equal(stream.listenerCount(event), 1);
  assert.equal(write('one'), true);
  stream.emit('error', ep());
  assert.equal(createSessionV2DiagnosticWriter(stream)('two'), false);
  assert.deepEqual(stream.writes, ['one']);
});

async function mcpFixture(t, { errorOutput = sink(), failOpen = false, failCloseRequest = false,
  failCloseTransport = false, failClientClose = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let buffer = '';
  output.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const bridgeID = randomUUID();
  const commands = [];
  const clientCloses = [];
  let clients = 0;
  const runtime = await runSessionV2MCP({ args: [], env: {}, input, output, errorOutput, pollIntervalMs: 1000,
    resolveContext: async () => ({ configuration: { authority }, channelSource: 'blabee-claude' }),
    createClient: async () => {
      const index = clients++;
      return {
        request: async command => {
          commands.push(command.operation);
          if (command.operation === 'bridge.open') {
            if (failOpen) throw new SessionV2ClientError('session_v2_unavailable');
            return { bridge_id: bridgeID };
          }
          if (command.operation === 'bridge.close') {
            if (failCloseRequest) throw new SessionV2ClientError('session_v2_response_unknown');
            return { closed: true };
          }
          if (command.operation === 'readiness.begin') return { probe_id: randomUUID(), nonce: 'c'.repeat(64),
            expires_at_nanoseconds: '300000000000', status: 'pending' };
          assert.fail(`Unexpected fixture command ${command.operation}`);
        },
        exchange: async request => {
          commands.push(request.operation);
          const { payload, ...common } = request;
          return { ...common, kind: 'response', ok: true, result: { event: null } };
        },
        close: async () => {
          clientCloses.push(index);
          if ((index === 0 && failClientClose) || (index === 1 && failCloseTransport)) {
            throw new SessionV2ClientError('session_v2_unavailable');
          }
        },
      };
    },
  });
  t.after(async () => { await runtime.close(); input.destroy(); output.destroy(); });
  const send = value => input.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'diagnostic-memory-fixture', version: '1' } } });
  await until(() => messages.some(value => value.id === 1));
  send({ method: 'notifications/initialized' });
  await until(() => commands.includes('bridge.open'));
  if (!failOpen) await until(() => runtime.session?.snapshot().registered);
  return { runtime, input, output, messages, commands, clientCloses, send, errorOutput };
}

test('logger failure cannot close a healthy registered MCP or resend an RPC', async t => {
  const errorOutput = sink('throw');
  const f = await mcpFixture(t, { errorOutput });
  assert.equal(createSessionV2DiagnosticWriter(errorOutput)('isolated diagnostic failure'), false);
  errorOutput.emit('close');
  errorOutput.emit('error', ep());
  f.send({ id: 2, method: 'tools/call', params: { name: 'check_connection_v1', arguments: {} } });
  await until(() => f.messages.some(value => value.id === 2));
  const result = f.messages.find(value => value.id === 2).result;
  assert.equal(JSON.parse(result.content[0].text).ok, true);
  assert.equal(f.runtime.session.snapshot().registered, true);
  assert.deepEqual(f.clientCloses, []);
  assert.equal(f.commands.filter(value => value === 'bridge.open').length, 1);
  assert.equal(f.commands.filter(value => value === 'readiness.begin').length, 1);
  const closing = f.runtime.close();
  assert.equal(f.runtime.close(), closing);
  await closing;
  assert.deepEqual(f.clientCloses, [0, 1]);
  assert.equal(f.commands.filter(value => value === 'bridge.close').length, 1);
  assert.equal(errorOutput.writes.length, 1);
  assert.deepEqual(errorOutput.ownershipCalls, []);
  assert.doesNotMatch(JSON.stringify(f.messages), /isolated diagnostic|PRIVATE|\[blabee-claude\] 제품 MCP/);
});

test('failed bridge admission still closes once when its diagnostic throws synchronously', async t => {
  const f = await mcpFixture(t, { failOpen: true, errorOutput: sink('throw') });
  assert.equal(await f.runtime.closed, 0);
  assert.equal(await f.runtime.close(), 0);
  assert.deepEqual(f.commands, ['bridge.open']);
  assert.deepEqual(f.clientCloses, [0]);
  assert.equal(f.errorOutput.writes.length, 1);
});

for (const failure of ['request', 'transport', 'main-client']) {
  test(`registered ${failure} close failure retains its result and cleanup once with broken stderr`, async t => {
    const errorOutput = sink('throw');
    const f = await mcpFixture(t, { errorOutput, failCloseRequest: failure === 'request',
      failCloseTransport: failure === 'transport', failClientClose: failure === 'main-client' });
    const closing = f.runtime.close();
    assert.equal(f.runtime.close(), closing);
    assert.equal(await f.runtime.closed, failure === 'request' ? 0 : 1);
    await closing;
    assert.deepEqual(f.clientCloses, failure === 'main-client' ? [0] : [0, 1]);
    assert.equal(f.commands.filter(value => value === 'bridge.close').length, failure === 'main-client' ? 0 : 1);
    assert.equal(f.commands.filter(value => value === 'bridge.open').length, 1);
    assert.equal(errorOutput.writes.length, 1);
    errorOutput.emit('close');
    assert.doesNotThrow(() => errorOutput.emit('error', ep()));
    assert.deepEqual(errorOutput.ownershipCalls, []);
  });
}

test('an uncooperative diagnostic callback cannot hold bootstrap failure cleanup open', { timeout: 5_000 }, async () => {
  const input = new PassThrough(); const output = new PassThrough(); const errorOutput = sink();
  output.resume();
  const runtime = await runSessionV2MCP({ env: {}, args: [], input, output, errorOutput,
    resolveContext: async () => { throw new SessionV2ClientError('session_v2_unavailable'); },
    createClient: async () => { assert.fail('failed bootstrap must not create a client'); } });
  try {
    assert.equal(await runtime.closed, 0);
    assert.equal(errorOutput.writes.length, 1);
    assert.deepEqual(errorOutput.ownershipCalls, []);
  } finally { await runtime.close(); input.destroy(); output.destroy(); }
});

test('sequential runtimes sharing stderr retain one guard without retaining their cleanup listeners', async () => {
  const errorOutput = sink();
  const signals = ['SIGINT', 'SIGTERM'].map(name => [name, process.listenerCount(name)]);
  for (let index = 0; index < 8; index++) {
    const input = new PassThrough(); const output = new PassThrough(); output.resume();
    const runtime = await runSessionV2MCP({ env: {}, args: [], input, output, errorOutput,
      resolveContext: async () => { throw new SessionV2ClientError('session_v2_unavailable'); },
      createClient: async () => { assert.fail('failed bootstrap must not create a client'); } });
    try {
      assert.equal(await runtime.closed, 0);
      for (const event of ['error', 'close', 'finish']) assert.equal(errorOutput.listenerCount(event), 1);
      for (const [name, count] of signals) assert.equal(process.listenerCount(name), count);
    } finally { await runtime.close(); input.destroy(); output.destroy(); }
  }
  assert.equal(errorOutput.writes.length, 8);
  assert.deepEqual(errorOutput.ownershipCalls, []);
});

test('a real Writable emitting EPIPE after runtime.closed does not crash its isolated child', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { PassThrough, Writable } from 'node:stream';
    import { runSessionV2MCP } from ${JSON.stringify(moduleURL.href)};
    const input = new PassThrough(), output = new PassThrough(); output.resume();
    let writes = 0, didClose = false, callbackAfterClose = false;
    const errorOutput = new Writable({ write(_chunk, _encoding, callback) {
      writes++; setTimeout(() => {
        callbackAfterClose = didClose;
        callback(Object.assign(new Error('PRIVATE EPIPE'), {code:'EPIPE'}));
      }, 25);
    }});
    const runtime = await runSessionV2MCP({ args:[],env:{},input,output,errorOutput,
      resolveContext: async () => { throw new Error('PRIVATE bootstrap'); },
      createClient: async () => { assert.fail('no client'); } });
    const code = await runtime.closed; didClose = true;
    await new Promise(resolve => setTimeout(resolve, 60));
    errorOutput.emit('error', Object.assign(new Error('late after close'), {code:'EPIPE'}));
    process.stdout.write(JSON.stringify({code,writes,callbackAfterClose})+'\\n');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: {}, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { code: 0, writes: 1, callbackAfterClose: true });
  assert.equal(result.stderr, '');
});

for (const mode of ['throw', 'late-error', 'close-then-error']) {
  test(`dedicated CLI startup catch safely reports ${mode} and preserves failure exit code`, () => {
    const preload = `
      let writes = 0, startup = false;
      process.stderr.write = (text, callback) => {
        writes++; startup = text.includes('제품 MCP 시작 실패');
        const error = Object.assign(new Error('PRIVATE startup stderr'), {code:'EPIPE'});
        if (${JSON.stringify(mode)} === 'throw') throw error;
        setImmediate(() => {
          if (${JSON.stringify(mode)} === 'close-then-error') process.stderr.emit('close');
          callback?.(error); process.stderr.emit('error', error);
        });
        return true;
      };
      process.on('exit', () => process.stdout.write(JSON.stringify({writes,startup})+'\\n'));
    `;
    const result = spawnSync(process.execPath,
      ['--import', 'data:text/javascript,' + encodeURIComponent(preload), fileURLToPath(moduleURL)],
      { env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), { writes: 1, startup: true });
    assert.equal(result.stderr, '');
  });
}

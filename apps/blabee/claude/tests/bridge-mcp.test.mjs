import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { runMCP } from '../src/bridge/mcp.mjs';

const waitUntil = async predicate => {
  const until = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('MCP test response timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function fixture(t, customIPC) {
  const session_id = randomUUID();
  const bridge_id = randomUUID();
  const env = { BLABEE_CLAUDE_SESSION_ID: session_id, BLABEE_CLAUDE_SESSION_TOKEN: 'a'.repeat(64), BLABEE_CLAUDE_RUNTIME: '/tmp/blabee-claude-stdio-test' };
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let buffer = ''; let stderr = '';
  output.on('data', chunk => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      messages.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const calls = [];
  const signalsBefore = process.listenerCount('SIGTERM');
  const bridge = await runMCP({ env, args: ['--expected-session-id', session_id], input, output, errorOutput: { write: value => { stderr += value; } }, ipc: async (type, payload, auth) => {
    calls.push({ type, payload, auth });
    const result = await customIPC?.(type, payload, auth, { bridge_id, session_id });
    if (result !== undefined) return result;
    if (type === 'bridge.open') return { bridge_id };
    if (type === 'bridge.poll') return { event: null };
    if (type === 'bridge.close') return { closed: true };
    throw new Error(`Unexpected fixture IPC: ${type}`);
  } });
  t.after(async () => { await bridge.close(); input.destroy(); output.destroy(); });
  const send = message => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const reply = async id => {
    await waitUntil(() => messages.some(message => message.id === id));
    return messages.find(message => message.id === id);
  };
  const initialize = async (initialized = true) => {
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bridge-test', version: '1' } } });
    const result = (await reply(1)).result;
    if (initialized) send({ method: 'notifications/initialized' });
    return result;
  };
  const call = async (id, name, args) => {
    send({ id, method: 'tools/call', params: { name, ...(args === undefined ? {} : { arguments: args }) } });
    return (await reply(id)).result;
  };
  return { session_id, bridge_id, env, input, messages, calls, bridge, signalsBefore, send, reply, initialize, call, stderr: () => stderr };
}

test('real SDK refuses tools until initialized registration; duplicate initialized opens only once', async t => {
  const f = await fixture(t);
  // The SDK accepts this notification, but it must not bypass initialize.
  f.send({ method: 'notifications/initialized' });
  assert.match((await f.call(10, 'check_connection', {})).content[0].text, /bridge_not_registered/);
  assert.equal(f.calls.length, 0);
  const init = await f.initialize(false);
  assert.deepEqual(init.capabilities.experimental['claude/channel'], {});
  assert.equal(init.capabilities.experimental['claude/channel/permission'], undefined);
  assert.match(init.instructions, /check_connection/);
  assert.match(init.instructions, /ack_readiness_probe/);
  assert.equal((await f.call(11, 'check_connection', {})).isError, true);
  assert.equal(f.calls.length, 0);
  f.send({ method: 'notifications/initialized' });
  f.send({ method: 'notifications/initialized' });
  await waitUntil(() => f.calls.some(call => call.type === 'bridge.poll'));
  f.send({ id: 2, method: 'tools/list', params: {} });
  const tools = (await f.reply(2)).result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['check_connection', 'ack_readiness_probe', 'emit_decision', 'claim_selection', 'complete_selection']);
  assert.equal(f.calls.filter(call => call.type === 'bridge.open').length, 1);
  assert.deepEqual(f.calls[0], { type: 'bridge.open', payload: { session_id: f.session_id }, auth: { auth: f.env.BLABEE_CLAUDE_SESSION_TOKEN, runtime: f.env.BLABEE_CLAUDE_RUNTIME } });
  assert.deepEqual(f.calls[1].payload, { session_id: f.session_id, bridge_id: f.bridge_id });
  assert.equal(f.calls.filter(call => call.type.startsWith('readiness.')).length, 0);
  assert.doesNotMatch(JSON.stringify(f.messages) + f.stderr(), /a{64}/);
  f.input.end();
  await f.bridge.close();
  assert.equal(process.listenerCount('SIGTERM'), f.signalsBefore);
  assert.equal(f.calls.filter(call => call.type === 'bridge.close').length, 1);
  const count = f.calls.length;
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(f.calls.length, count, 'EOF must stop coordinator polling');
});

test('explicit check sends a channel probe without an automatic ACK or selected task', async t => {
  const probe_id = randomUUID();
  const nonce = 'b'.repeat(64);
  const expires_at = Date.now() + 30_000;
  let pending;
  let received = false;
  const f = await fixture(t, async (type, payload) => {
    if (type === 'readiness.begin') {
      pending = { kind: 'readiness_probe', probe_id, nonce, expires_at };
      return { probe_id, expires_at, status: 'awaiting_ack' };
    }
    if (type === 'bridge.poll') { const event = pending ?? null; pending = undefined; return { event }; }
    if (type === 'readiness.ack') {
      if (payload.probe_id !== probe_id || payload.nonce !== nonce || received) throw Object.assign(new Error('invalid readiness response'), { code: 'invalid_probe' });
      received = true;
      return { ready: true, expires_at };
    }
  });
  await f.initialize();
  await waitUntil(() => f.calls.some(call => call.type === 'bridge.poll'));
  // MCP permits arguments to be omitted for a zero-argument tool.
  const begin = await f.call(2, 'check_connection');
  assert.deepEqual(JSON.parse(begin.content[0].text), { ok: true, result: { probe_id, expires_at, status: 'awaiting_ack' } });
  assert.doesNotMatch(JSON.stringify(begin), /nonce|b{64}|ready.*true|selection_id|task/);
  await waitUntil(() => f.messages.some(message => message.method === 'notifications/claude/channel'));
  const notification = f.messages.find(message => message.method === 'notifications/claude/channel');
  assert.deepEqual(notification.params.meta, { kind: 'readiness_probe', probe_id });
  assert.deepEqual(JSON.parse(notification.params.content.split('\n').at(-1)), { probe_id, nonce });
  assert.equal(received, false);
  assert.equal(f.calls.filter(call => call.type === 'readiness.ack').length, 0);
  assert.ok(f.calls.every(call => ['bridge.open', 'bridge.poll', 'readiness.begin'].includes(call.type)));
  assert.equal((await f.call(3, 'ack_readiness_probe', { probe_id: randomUUID(), nonce })).isError, true);
  assert.equal(received, false);
  assert.equal((await f.call(4, 'ack_readiness_probe', { probe_id, nonce })).isError, undefined);
  assert.equal(received, true);
  assert.equal((await f.call(5, 'ack_readiness_probe', { probe_id, nonce })).isError, true);
  assert.ok(f.calls.filter(call => call.type.startsWith('readiness.')).every(call => call.payload.bridge_id === f.bridge_id && call.payload.session_id === f.session_id));
  assert.doesNotMatch(JSON.stringify(f.messages) + f.stderr(), /a{64}/);
});

test('SDK rejects caller registration injection and malformed readiness responses without disclosure', async t => {
  const nonce = 'b'.repeat(64);
  const probe_id = randomUUID();
  const f = await fixture(t, async type => {
    if (type === 'readiness.begin') return { probe_id, expires_at: Date.now() + 30_000, status: 'awaiting_ack', nonce };
    if (type === 'readiness.ack') return { ready: 'true', expires_at: Date.now() + 30_000 };
  });
  await f.initialize();
  await waitUntil(() => f.calls.some(call => call.type === 'bridge.poll'));
  assert.equal((await f.call(2, 'check_connection', { bridge_id: f.bridge_id })).isError, true);
  assert.equal(f.calls.filter(call => call.type === 'readiness.begin').length, 0);
  assert.match((await f.call(3, 'check_connection', {})).content[0].text, /invalid_readiness_response/);
  assert.match((await f.call(4, 'ack_readiness_probe', { probe_id, nonce })).content[0].text, /invalid_readiness_response/);
  assert.equal((await f.call(5, 'claim_selection', { selection_id: randomUUID(), delivery_token: 'd'.repeat(64), task: 'injected' })).isError, true);
  assert.equal(f.calls.filter(call => call.type === 'selection.claim').length, 0);
  assert.equal((await f.call(6, 'ack_readiness_probe')).isError, true);
  f.send({ id: 7, method: 'tools/call', params: { name: 'check_connection', arguments: null } });
  assert.ok((await f.reply(7)).error, 'null arguments must fail the MCP schema');
  assert.equal(f.calls.filter(call => call.type === 'readiness.begin').length, 1);
  assert.doesNotMatch(JSON.stringify(f.messages) + f.stderr(), /a{64}|b{64}|injected/);
});

test('registration rejection and malformed replies never poll or retry automatically', async t => {
  for (const kind of ['rejected', 'bad_id', 'extra_fields', 'missing', 'array']) {
    await t.test(kind, async t => {
      const f = await fixture(t, async (type, payload, auth, { bridge_id }) => {
        if (type !== 'bridge.open') return undefined;
        if (kind === 'rejected') throw Object.assign(new Error('a'.repeat(64)), { code: 'b'.repeat(64) });
        if (kind === 'bad_id') return { bridge_id: 'bad-id' };
        if (kind === 'extra_fields') return { bridge_id, nonce: 'b'.repeat(64) };
        if (kind === 'missing') return null;
        return [bridge_id];
      });
      await f.initialize();
      await waitUntil(() => f.stderr().includes('연결 등록'));
      f.send({ method: 'notifications/initialized' });
      assert.match((await f.call(2, 'check_connection', {})).content[0].text, /bridge_not_registered/);
      assert.equal(f.calls.filter(call => call.type === 'bridge.open').length, 1);
      assert.equal(f.calls.filter(call => call.type === 'bridge.poll').length, 0);
      assert.equal(f.calls.filter(call => call.type === 'bridge.close').length, kind === 'extra_fields' ? 1 : 0);
      assert.doesNotMatch(JSON.stringify(f.messages) + f.stderr(), /a{64}|b{64}/);
    });
  }
});

test('EOF during bridge.open closes the late registration without polling or enabling tools', async t => {
  let resolveOpen;
  const f = await fixture(t, async (type, payload, auth, { bridge_id }) => {
    if (type === 'bridge.open') return new Promise(resolve => { resolveOpen = () => resolve({ bridge_id }); });
  });
  try {
    await f.initialize();
    await waitUntil(() => resolveOpen);
    f.send({ method: 'notifications/initialized' });
    assert.match((await f.call(2, 'check_connection', {})).content[0].text, /bridge_not_registered/);
    assert.equal(f.calls.length, 1);
    f.input.end();
    await waitUntil(() => process.listenerCount('SIGTERM') === f.signalsBefore);
  } finally { resolveOpen?.(); }
  await f.bridge.close();
  assert.deepEqual(f.calls.map(call => call.type), ['bridge.open', 'bridge.close']);
  assert.deepEqual(f.calls[1].payload, { session_id: f.session_id, bridge_id: f.bridge_id });
  assert.equal(f.messages.filter(message => message.method === 'notifications/claude/channel').length, 0);
});

test('EOF while poll is pending suppresses delivery and close is best effort and idempotent', async t => {
  let resolvePoll;
  const f = await fixture(t, async type => {
    if (type === 'bridge.poll') return new Promise(resolve => { resolvePoll = resolve; });
    if (type === 'bridge.close') throw Object.assign(new Error('a'.repeat(64)), { code: 'b'.repeat(64) });
  });
  await f.initialize();
  await waitUntil(() => resolvePoll);
  f.input.end();
  await f.bridge.close();
  resolvePoll({ event: { kind: 'readiness_probe', probe_id: randomUUID(), nonce: 'b'.repeat(64), expires_at: Date.now() + 30_000 } });
  await new Promise(resolve => setImmediate(resolve));
  await f.bridge.close();
  assert.equal(f.calls.filter(call => call.type === 'bridge.close').length, 1);
  assert.equal(f.calls.filter(call => call.type === 'bridge.poll').length, 1);
  assert.equal(f.messages.filter(message => message.method === 'notifications/claude/channel').length, 0);
  assert.doesNotMatch(JSON.stringify(f.messages) + f.stderr(), /a{64}|b{64}/);
});

test('closing an initialized SDK before notifications/initialized creates no registration', async t => {
  const f = await fixture(t);
  await f.initialize(false);
  f.input.end();
  await f.bridge.close();
  assert.equal(f.calls.length, 0);
  assert.equal(process.listenerCount('SIGTERM'), f.signalsBefore);
});

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { AUTO_CONNECT_SCHEMA, createAutoConnectClient } from '../../../bridges/claude/src/auto-connect-client.mjs';
import { handleAutoConnectHook, runAutoConnectHook } from '../../../bridges/claude/src/auto-connect-hook.mjs';
import { runAutoConnectMCP } from '../../../bridges/claude/src/auto-connect-mcp.mjs';
import { SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';

const B = 'BLABEE_CLAUDE_BOOTSTRAP_';
const P = 'BLABEE_CLAUDE_SESSION_V2_';
const until = async predicate => {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const envelope = (request, body) => ({ schema_version: AUTO_CONNECT_SCHEMA, request_id: request.request_id, ...body });

async function fixture(t, { respond } = {}) {
  const cwd = await realpath(await mkdtemp('/private/tmp/blabee-auto-'));
  await chmod(cwd, 0o700);
  const socketPath = join(cwd, 'launch.sock');
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const hookToken = 'a'.repeat(64), bridgeToken = 'b'.repeat(64);
  const roleEnvironment = role => ({
    ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [P + key.toUpperCase(), value])),
    [P + 'SOCKET']: socketPath, [P + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`,
    [P + 'CWD']: cwd, [P + 'CHANNEL_SOURCE']: 'blabee-claude',
    [P + (role === 'hook' ? 'HOOK_TOKEN' : 'BRIDGE_TOKEN')]: (role === 'hook' ? 'c' : 'd').repeat(64),
  });
  const hookEnv = { [B + 'SOCKET']: socketPath, [B + 'CWD']: cwd, [B + 'HOOK_TOKEN']: hookToken,
    [B + 'BRIDGE_TOKEN']: bridgeToken, CLAUDE_CODE_SESSION_ID: authority.native_session_id };
  const mcpEnv = { ...hookEnv, [B + 'HOOK_TOKEN']: '' };
  const requests = [], sockets = new Set();
  const state = { ready: false, retired: false };
  const ready = request => envelope(request, { ok: true, status: 'ready', environment: roleEnvironment(request.role) });
  const pending = request => envelope(request, { ok: true, status: 'pending' });
  const rejected = (request, code) => envelope(request, { ok: false, error: { code } });
  const reply = request => {
    if (request.auth_token !== (request.role === 'hook' ? hookToken : bridgeToken)) {
      return rejected(request, 'claude_bootstrap_unauthorized');
    }
    if (state.retired) return rejected(request, 'claude_bootstrap_unavailable');
    if (request.native_session_id !== authority.native_session_id || request.cwd !== cwd) {
      state.retired = true;
      return rejected(request, 'claude_bootstrap_session_changed');
    }
    if (request.operation === 'start') {
      if (state.ready) {
        state.retired = true;
        return rejected(request, 'claude_bootstrap_already_started');
      }
      state.ready = true;
    }
    return state.ready ? ready(request) : pending(request);
  };
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    socket.on('data', data => {
      buffer += data.toString();
      if (!buffer.endsWith('\n')) return;
      const request = JSON.parse(buffer);
      requests.push(request);
      const result = respond ? respond(request, { ready, pending, reply, rejected, socket, state }) : reply(request);
      if (result !== undefined) socket.end(typeof result === 'string' || Buffer.isBuffer(result) ? result : JSON.stringify(result) + '\n');
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  });
  const input = (event = 'SessionStart', extra = {}) => ({ hook_event_name: event,
    session_id: authority.native_session_id, cwd, ...(event === 'SessionStart' ? { source: 'resume' } : {}), ...extra });
  return { cwd, socketPath, authority, hookEnv, mcpEnv, roleEnvironment, requests, state, sockets, input };
}

function sdkStreams(t) {
  const input = new PassThrough(), output = new PassThrough();
  const messages = []; let buffer = '';
  output.on('data', data => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1);
    }
  });
  t.after(() => { input.destroy(); output.destroy(); });
  const send = value => input.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  const reply = async id => { await until(() => messages.some(value => value.id === id)); return messages.find(value => value.id === id); };
  const initialize = async () => {
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'auto-connect-fixture', version: '1' } } });
    const initialized = await reply(1);
    send({ method: 'notifications/initialized' });
    return initialized;
  };
  return { input, output, send, reply, initialize, messages };
}

function sessionClient(f, calls) {
  const bridgeID = randomUUID();
  return async configuration => {
    assert.deepEqual(configuration.authority, f.authority);
    assert.equal(configuration.role, 'bridge');
    assert.equal(configuration.authToken, 'd'.repeat(64));
    assert.deepEqual([...new Set(configuration.credentialCorpus)], ['d'.repeat(64)]);
    return {
      async request(value) {
        calls.push(value);
        if (value.operation === 'bridge.open') return { bridge_id: bridgeID };
        if (value.operation === 'bridge.close') return { closed: true };
        if (value.operation === 'readiness.begin') return { probe_id: randomUUID(), expires_at_nanoseconds: '100', status: 'pending' };
        throw new Error('fixture rejects unexpected operation');
      },
      async exchange(request) {
        calls.push({ operation: request.operation });
        const { payload: _, ...envelope } = request;
        return { ...envelope, kind: 'response', ok: true, result: { event: null } };
      },
      async close() {},
    };
  };
}

test('actual startup, resume and fork are consumed once without a second Hook or restored boundary', async t => {
  for (const source of ['startup', 'resume', 'fork']) {
    const f = await fixture(t);
    const result = await handleAutoConnectHook(f.input('SessionStart', { source, prompt_id: randomUUID(), prompt: 'OLD PRIVATE PROMPT' }),
      { env: f.hookEnv, createClient: async () => { assert.fail('initial SessionStart must not be resent'); } });
    assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(result.hookSpecificOutput.additionalContext, /아직 유효한 작업 boundary가 없습니다/);
    assert.doesNotMatch(JSON.stringify(result), /boundary_id=|[abcd]{64}|OLD PRIVATE PROMPT/);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(Object.keys(f.requests[0]).sort(), ['schema_version', 'request_id', 'operation', 'role',
      'auth_token', 'native_session_id', 'cwd', 'source'].sort());
    assert.equal(f.requests[0].source, source);
    assert.equal(f.requests[0].native_session_id, f.authority.native_session_id);
    assert.equal(f.requests[0].operation, 'start');
  }
});

test('only the next actual prompt obtains a boundary; compact and Stop retain their native observations', async t => {
  const f = await fixture(t);
  await handleAutoConnectHook(f.input(), { env: f.hookEnv });
  const calls = [], boundary = randomUUID(), promptID = randomUUID();
  const createClient = async configuration => {
    assert.equal(configuration.authToken, 'c'.repeat(64));
    assert.deepEqual([...new Set(configuration.credentialCorpus)], ['c'.repeat(64)]);
    return { request: async value => { calls.push(value); return { observed: true, observation_status: 'accepted',
      boundary_id: value.event === 'UserPromptSubmit' ? boundary : null }; }, close: async () => {} };
  };
  const result = await handleAutoConnectHook(f.input('UserPromptSubmit', { prompt_id: promptID, prompt: 'new actual prompt' }),
    { env: f.hookEnv, createClient });
  assert.match(result.hookSpecificOutput.additionalContext, new RegExp(`boundary_id=${boundary}`));
  assert.equal(calls[0].prompt_sha256, createHash('sha256').update('new actual prompt').digest('hex'));
  await handleAutoConnectHook(f.input('SessionStart', { source: 'compact' }), { env: f.hookEnv, createClient });
  await handleAutoConnectHook(f.input('Stop', { prompt_id: promptID }), { env: f.hookEnv, createClient });
  assert.equal(calls[1].source, 'compact');
  assert.equal(Object.hasOwn(calls[1], 'prompt_id'), false);
  assert.equal(Object.hasOwn(calls[2], 'background_task_ids'), false);
  assert.deepEqual(f.requests.map(request => request.operation), ['start', 'grant', 'grant', 'grant']);
  assert.equal(new Set(f.requests.map(request => request.request_id)).size, 4);
});

test('in-process resume and identity changes retire authority instead of silently rebinding or using a stale grant', async t => {
  for (const changed of ['resume', 'identity', 'cwd']) {
    const f = await fixture(t);
    await handleAutoConnectHook(f.input(), { env: f.hookEnv });
    const anotherCWD = await realpath(await mkdtemp('/private/tmp/blabee-auto-other-'));
    t.after(() => rm(anotherCWD, { recursive: true, force: true }));
    const input = changed === 'resume' ? f.input() : f.input('UserPromptSubmit', {
      prompt_id: randomUUID(), prompt: 'actual prompt', ...(changed === 'identity' ? { session_id: randomUUID() } : { cwd: anotherCWD }) });
    let usedV2 = false;
    const options = { env: f.hookEnv, createClient: async () => { usedV2 = true; assert.fail('retired scope'); } };
    await assert.rejects(handleAutoConnectHook(input, options), { code: changed === 'resume'
      ? 'claude_bootstrap_already_started' : 'claude_bootstrap_session_changed' });
    await assert.rejects(handleAutoConnectHook(f.input('UserPromptSubmit', { prompt_id: randomUUID(), prompt: 'after retirement' }), options),
      { code: 'claude_bootstrap_unavailable' });
    assert.equal(usedV2, false);
  }
});

for (const order of ['hook-first', 'mcp-first']) test(`${order}: SDK handshake and tool list are available before authority; exactly one bridge opens`, async t => {
  const f = await fixture(t), sdk = sdkStreams(t), calls = []; let stderr = '';
  if (order === 'hook-first') await handleAutoConnectHook(f.input(), { env: f.hookEnv });
  const runtime = await runAutoConnectMCP({ env: f.mcpEnv, args: [], input: sdk.input, output: sdk.output,
    errorOutput: { write: value => { stderr += value; } }, createClient: sessionClient(f, calls), pollIntervalMs: 20 });
  t.after(() => runtime.close());
  const response = await sdk.initialize();
  assert.deepEqual(response.result.capabilities.experimental, { 'claude/channel': {} });
  sdk.send({ id: 2, method: 'tools/list' });
  assert.equal((await sdk.reply(2)).result.tools.length, 5);
  if (order === 'mcp-first') {
    await until(() => f.requests.some(request => request.operation === 'grant'));
    assert.equal(f.state.ready, false);
    assert.equal(calls.length, 0);
    sdk.send({ id: 3, method: 'tools/call', params: { name: 'check_connection_v1' } });
    assert.match((await sdk.reply(3)).result.content[0].text, /session_v2_bridge_not_registered/);
    await handleAutoConnectHook(f.input(), { env: f.hookEnv });
  }
  await until(() => runtime.session?.snapshot().registered);
  sdk.send({ method: 'notifications/initialized' });
  await until(() => calls.some(value => value.operation === 'bridge.poll'));
  assert.equal(calls.filter(value => value.operation === 'bridge.open').length, 1);
  assert.equal(calls.some(value => ['readiness.begin', 'readiness.ack', 'selection.claim'].includes(value.operation)), false);
  sdk.send({ id: 4, method: 'tools/call', params: { name: 'check_connection_v1' } });
  assert.equal(JSON.parse((await sdk.reply(4)).result.content[0].text).result.status, 'pending');
  assert.equal(calls.filter(value => value.operation === 'readiness.begin').length, 1);
  await runtime.close();
  assert.equal(calls.filter(value => value.operation === 'bridge.close').length, 1);
  assert.doesNotMatch(stderr + JSON.stringify(sdk.messages), /[abcd]{64}|BLABEE_CLAUDE_SESSION_V2_/);
});

test('SDK EOF cancels both pending grant polling and an unanswered bootstrap request immediately', async t => {
  for (const unanswered of [false, true]) {
    const f = await fixture(t, unanswered ? { respond: () => undefined } : {}), sdk = sdkStreams(t);
    const before = process.listenerCount('SIGTERM');
    let usedV2 = false;
    const runtime = await runAutoConnectMCP({ env: f.mcpEnv, args: [], input: sdk.input, output: sdk.output,
      errorOutput: { write() {} }, createClient: async () => { usedV2 = true; assert.fail('no SessionStart'); } });
    await sdk.initialize();
    await until(() => f.requests.length > 0);
    const start = Date.now();
    sdk.input.end();
    assert.equal(await runtime.closed, 0);
    assert.ok(Date.now() - start < 300, 'EOF must not wait for the grant timeout or future Hook');
    const count = f.requests.length;
    await sleep(150);
    assert.equal(f.requests.length, count);
    assert.equal(usedV2, false);
    assert.equal(f.state.ready, false);
    assert.equal(process.listenerCount('SIGTERM'), before);
    await until(() => f.sockets.size === 0);
  }
});

test('cancelling a pending Hook bootstrap stops once and returns no context or private values', async t => {
  const f = await fixture(t, { respond: () => undefined });
  const controller = new AbortController();
  let stdout = '', stderr = '';
  const before = process.listenerCount('SIGTERM');
  const run = runAutoConnectHook({ env: f.hookEnv, args: [], signal: controller.signal,
    input: Readable.from([JSON.stringify(f.input())]), output: { write: value => { stdout += value; } },
    errorOutput: { write: value => { stderr += value; } } });
  await until(() => f.requests.length === 1);
  const start = Date.now();
  controller.abort();
  assert.equal(await run, 0);
  assert.ok(Date.now() - start < 300);
  assert.equal(stdout, '');
  assert.match(stderr, /auto_connect_closed/);
  assert.doesNotMatch(stderr, /[abcd]{64}|native_session_id/);
  assert.equal(f.requests.length, 1);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('cancelling a post-grant Hook closes the v2 request and suppresses a late accepted boundary', async t => {
  const f = await fixture(t);
  await handleAutoConnectHook(f.input(), { env: f.hookEnv });
  const controller = new AbortController();
  const boundary = randomUUID();
  let resolveRequest, requestCount = 0, closeCount = 0, stdout = '', stderr = '';
  const run = runAutoConnectHook({ env: f.hookEnv, args: [], signal: controller.signal,
    input: Readable.from([JSON.stringify(f.input('UserPromptSubmit', { prompt_id: randomUUID(), prompt: 'new prompt' }))]),
    output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } },
    createClient: async () => ({ request: () => {
      requestCount++;
      return new Promise(resolve => { resolveRequest = resolve; });
    }, close: async () => { closeCount++; } }) });
  await until(() => requestCount === 1);
  const start = Date.now();
  controller.abort();
  assert.equal(await run, 0);
  assert.ok(Date.now() - start < 300, 'cancellation must not wait for the in-flight Hook response');
  assert.equal(closeCount, 1);
  resolveRequest({ observed: true, observation_status: 'accepted', boundary_id: boundary });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestCount, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /auto_connect_closed/);
  assert.equal((stdout + stderr).includes(boundary), false);
});

test('cancelling while v2 client admission is pending closes its late client without issuing any request', async t => {
  const f = await fixture(t);
  await handleAutoConnectHook(f.input(), { env: f.hookEnv });
  const controller = new AbortController();
  let resolveClient, admissionCount = 0, requestCount = 0, closeCount = 0, stdout = '';
  const run = runAutoConnectHook({ env: f.hookEnv, args: [], signal: controller.signal,
    input: Readable.from([JSON.stringify(f.input('UserPromptSubmit', { prompt_id: randomUUID(), prompt: 'new prompt' }))]),
    output: { write: value => { stdout += value; } }, errorOutput: { write() {} }, createClient: () => {
      admissionCount++;
      return new Promise(resolve => { resolveClient = resolve; });
    } });
  await until(() => admissionCount === 1);
  const start = Date.now();
  controller.abort();
  assert.equal(await run, 0);
  assert.ok(Date.now() - start < 300, 'cancellation must not wait for client admission');
  resolveClient({ request: async () => { requestCount++; assert.fail('late client cannot issue a Hook'); },
    close: async () => { closeCount++; } });
  await until(() => closeCount === 1);
  assert.equal(requestCount, 0);
  assert.equal(admissionCount, 1);
  assert.equal(stdout, '');
});

test('cancellation after an accepted Hook response but before cleanup completes still prevents stdout', async t => {
  const f = await fixture(t);
  await handleAutoConnectHook(f.input(), { env: f.hookEnv });
  const controller = new AbortController();
  const boundary = randomUUID();
  let requestCount = 0, closeCount = 0, stdout = '', stderr = '';
  const status = await runAutoConnectHook({ env: f.hookEnv, args: [], signal: controller.signal,
    input: Readable.from([JSON.stringify(f.input('UserPromptSubmit', { prompt_id: randomUUID(), prompt: 'new prompt' }))]),
    output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } },
    createClient: async () => ({ request: async () => {
      requestCount++;
      return { observed: true, observation_status: 'accepted', boundary_id: boundary };
    }, close: async () => { closeCount++; controller.abort(); } }) });
  assert.equal(status, 0);
  assert.equal(requestCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /auto_connect_closed/);
  assert.equal((stdout + stderr).includes(boundary), false);
});

test('dedicated auto Hook and MCP processes exit on SIGTERM while the bootstrap has no reply', async t => {
  for (const role of ['hook', 'mcp']) {
    const f = await fixture(t, { respond: () => undefined });
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BLABEE_'))),
      ...(role === 'hook' ? f.hookEnv : f.mcpEnv) };
    const entry = new URL(`../../../bridges/claude/src/auto-connect-${role}.mjs`, import.meta.url);
    const child = spawn(process.execPath, [entry.pathname], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const exited = new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit); child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    if (role === 'hook') child.stdin.end(JSON.stringify(f.input()));
    await until(() => f.requests.length === 1);
    const start = Date.now();
    child.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.ok(Date.now() - start < 500, 'termination must cancel admission instead of waiting for its timeout');
    assert.equal(stdout, '');
    assert.doesNotMatch(stderr, /[abcd]{64}|auth_token/);
    assert.equal(f.requests.length, 1);
    assert.equal(f.state.ready, false);
  }
});

test('unknown start outcomes are terminal, never repeated; only pending read-only grants poll with unique IDs', async t => {
  const hung = await fixture(t, { respond: () => undefined });
  const client = await createAutoConnectClient({ role: 'hook', env: hung.hookEnv,
    nativeSessionID: hung.authority.native_session_id, startTimeoutMs: 25 });
  await assert.rejects(client.start('resume'), { code: 'auto_connect_response_unknown' });
  await assert.rejects(client.start('resume'), { code: 'auto_connect_invalid_request' });
  await assert.rejects(client.grant(), { code: 'auto_connect_response_unknown' });
  assert.equal(hung.requests.length, 1);
  await client.close();
  const f = await fixture(t);
  const controller = new AbortController();
  const bridge = await createAutoConnectClient({ role: 'bridge', env: f.mcpEnv, signal: controller.signal, pollIntervalMs: 10 });
  const waiting = bridge.waitForGrant();
  const rejection = assert.rejects(waiting, { code: 'auto_connect_closed' });
  await until(() => f.requests.length >= 3);
  controller.abort();
  await rejection;
  assert.ok(f.requests.every(request => request.operation === 'grant'));
  assert.equal(new Set(f.requests.map(request => request.request_id)).size, f.requests.length);
  assert.equal(f.state.ready, false);
  await bridge.close();
});

test('bootstrap configuration refuses stale authorities, role mixups and malformed native identity before IPC', async t => {
  const f = await fixture(t);
  for (const changes of [{ [B + 'HOOK_TOKEN']: 'a'.repeat(64) }, { [P + 'BRIDGE_TOKEN']: 'd'.repeat(64) },
    { [P + 'SCOPE_ID']: randomUUID() }, { BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN: 'e'.repeat(64) },
    { BLABEE_CLAUDE_OWNER_TOKEN: 'f'.repeat(64) }, { [B + 'BRIDGE_TOKEN']: '' },
    { CLAUDE_CODE_SESSION_ID: randomUUID().toUpperCase() }, { CLAUDE_CODE_SESSION_ID: undefined },
    { [B + 'CWD']: f.cwd + '/.' }]) {
    await assert.rejects(createAutoConnectClient({ role: 'bridge', env: { ...f.mcpEnv, ...changes } }),
      { code: 'auto_connect_invalid_configuration' });
  }
  await assert.rejects(handleAutoConnectHook(f.input('SessionStart', { agent_id: 'child' }), { env: f.hookEnv }),
    { code: 'session_v2_hook_subagent' });
  await assert.rejects(handleAutoConnectHook(f.input('SessionStart', { session_id: 'invalid' }), { env: f.hookEnv }),
    { code: 'session_v2_hook_invalid_identity' });
  assert.equal(f.requests.length, 0);
});

test('ready grants enforce exact schema, correlation, native ID, cwd, role-only credentials and bounded strict frames', async t => {
  const mutate = [
    value => ({ ...value, schema_version: 'old' }),
    value => ({ ...value, request_id: randomUUID() }),
    value => ({ ...value, environment: { ...value.environment, [P + 'NATIVE_SESSION_ID']: randomUUID() } }),
    value => ({ ...value, environment: { ...value.environment, [P + 'CWD']: '/private/tmp' } }),
    value => ({ ...value, environment: { ...value.environment, [P + 'HOOK_TOKEN']: 'c'.repeat(64) } }),
    value => ({ ...value, environment: { ...value.environment, [P + 'BRIDGE_TOKEN']: 'b'.repeat(64) } }),
    value => ({ ...value, environment: { ...value.environment, [P + 'OWNER_TOKEN']: 'f'.repeat(64) } }),
    value => ({ ...value, environment: { ...value.environment, [P + 'AUTHORITY_EPOCH']: 'old' } }),
    value => ({ ...value, environment: { ...value.environment, [P + 'RUNTIME_IDENTITY']: 'legacy' } }),
    value => ({ ...value, boundary_id: randomUUID() }),
    value => JSON.stringify(value).replace('"ok":true', '"ok":true,"ok":true') + '\n',
    value => JSON.stringify(value) + '\n\n',
    value => JSON.stringify(value),
    value => Buffer.concat([Buffer.from(JSON.stringify(value)), Buffer.from([0x80, 10])]),
    () => 'x'.repeat(16 * 1024 + 1),
  ];
  for (const mutation of mutate) {
    const f = await fixture(t, { respond: (request, { ready }) => mutation(ready(request)) });
    const client = await createAutoConnectClient({ role: 'bridge', env: f.mcpEnv });
    await assert.rejects(client.grant(), { code: 'auto_connect_invalid_response' });
    await assert.rejects(client.grant(), { code: 'auto_connect_invalid_response' });
    assert.equal(f.requests.length, 1);
    await client.close();
  }
});

test('pending must be a bare read-only response and cannot stand in for an acknowledged start', async t => {
  for (const operation of ['grant', 'start']) {
    const f = await fixture(t, { respond: (request, { pending }) => operation === 'grant'
      ? { ...pending(request), environment: {} } : pending(request) });
    const client = await createAutoConnectClient({ role: 'hook', env: f.hookEnv, nativeSessionID: f.authority.native_session_id });
    await assert.rejects(operation === 'start' ? client.start('startup') : client.grant(), { code: 'auto_connect_invalid_response' });
    await client.close();
  }
});

test('bootstrap errors expose only fixed codes, never reflected diagnostics or credentials', async t => {
  for (const body of [{ ok: false, error: { code: 'claude_bootstrap_unauthorized' } },
    { ok: false, error: { code: 'claude_bootstrap_unauthorized', message: 'a'.repeat(64) } },
    { ok: false, error: { code: 'a'.repeat(64) } }]) {
    const f = await fixture(t, { respond: request => envelope(request, body) });
    let stdout = '', stderr = '';
    const code = await runAutoConnectHook({ env: f.hookEnv, args: [], input: Readable.from([JSON.stringify(f.input())]),
      output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } } });
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.doesNotMatch(stderr, /a{64}|request_id|auth_token/);
    assert.match(stderr, /claude_bootstrap_unauthorized|auto_connect_invalid_response/);
  }
});

test('bootstrap socket rejects public modes and symlinks and rechecks directory permissions before each request', async t => {
  const f = await fixture(t);
  const alias = join(f.cwd, 'alias.sock');
  await symlink(f.socketPath, alias);
  await assert.rejects(createAutoConnectClient({ role: 'bridge', env: { ...f.mcpEnv, [B + 'SOCKET']: alias } }),
    { code: 'auto_connect_invalid_socket' });
  await chmod(f.socketPath, 0o666);
  await assert.rejects(createAutoConnectClient({ role: 'bridge', env: f.mcpEnv }), { code: 'auto_connect_invalid_socket' });
  await chmod(f.socketPath, 0o600);
  const client = await createAutoConnectClient({ role: 'bridge', env: f.mcpEnv });
  await chmod(f.cwd, 0o755);
  await assert.rejects(client.grant(), { code: 'auto_connect_invalid_socket' });
  await chmod(f.cwd, 0o700);
  assert.equal(f.requests.length, 0);
  await client.close();
});

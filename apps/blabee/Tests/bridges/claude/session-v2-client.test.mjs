import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { createSessionV2Client, parseSessionV2JSON, SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';

const authority = () => Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
const command = { operation: 'bridge.open' };
function reply(request, result = { bridge_id: randomUUID() }, changes = {}) {
  const { payload: ignored, ...envelope } = request.payload.envelope;
  return { request_id: request.request_id, runtime_identity: request.runtime_identity, ok: true,
    result: { ...envelope, kind: 'response', ok: true, result, ...changes } };
}
async function fixture(t, respond = request => JSON.stringify(reply(request)) + '\n') {
  const directory = await realpath(await mkdtemp('/private/tmp/blabee-sv2-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'test.sock');
  const requests = [];
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString();
      if (!input.endsWith('\n')) return;
      const request = JSON.parse(input);
      requests.push(request);
      const result = respond(request, socket);
      if (result !== undefined) socket.end(result);
    });
  });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  const configuration = { socketPath, runtimeIdentity: `sha256:${'1'.repeat(64)}`, authority: authority(), role: 'bridge',
    authToken: 'a'.repeat(64), channelSource: 'blabee-claude', timeoutMs: 500 };
  return { directory, configuration, requests };
}

test('authenticated v3 wire uses the fixed authority and existing private outer credential wrapper', async t => {
  const f = await fixture(t);
  const original = structuredClone(f.configuration.authority);
  const client = await createSessionV2Client(f.configuration);
  f.configuration.authority.scope_id = randomUUID();
  t.after(() => client.close());
  const result = await client.request(command);
  assert.match(result.bridge_id, /^[0-9a-f-]{36}$/);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.match(request.request_id, /^claude_/);
  assert.equal(request.type, 'blabee.runtime-identity.v1/claude_session_v2');
  assert.deepEqual(Object.keys(request.payload).sort(), ['auth_token', 'envelope']);
  assert.equal(request.payload.auth_token, f.configuration.authToken);
  assert.equal(request.payload.envelope.schema_version, 'blabee.claude-session.v3');
  assert.deepEqual(request.payload.envelope.authority, original);
  assert.deepEqual(request.payload.envelope.payload, {});
  assert.equal(JSON.stringify(request.payload.envelope).includes(f.configuration.authToken), false);
  await client.request(command);
  assert.notEqual(f.requests[0].request_id, f.requests[1].request_id);
  assert.notEqual(f.requests[0].payload.envelope.request_id, f.requests[1].payload.envelope.request_id);
});

test('v2 denies every mismatched response authority/correlation and does not retry', async t => {
  const changes = [request => ({ request_id: randomUUID() }), () => ({ operation: 'readiness.begin' }),
    () => ({ role: 'hook' }), () => ({ provider: 'codex' }), () => ({ schema_version: 'blabee.claude-session.v1' }),
    () => ({ schema_version: 'blabee.claude-session.v2' }),
    ...SESSION_V2_AUTHORITY_KEYS.map(key => request => ({ authority: { ...request.payload.envelope.authority, [key]: randomUUID() } }))];
  for (const mutate of changes) {
    const f = await fixture(t, request => JSON.stringify(reply(request, { bridge_id: randomUUID() }, mutate(request))) + '\n');
    const client = await createSessionV2Client(f.configuration);
    await assert.rejects(client.request(command), { code: 'session_v2_invalid_response' });
    await assert.rejects(client.request(command), { code: 'session_v2_invalid_response' });
    assert.equal(f.requests.length, 1);
    await client.close();
  }
});

test('Hook waiter operations retain their original identity and cannot cross into the bridge role', async t => {
  const f = await fixture(t, request => JSON.stringify(reply(request,
    request.payload.envelope.operation === 'hook.poll' ? { status: 'waiting', event: null } : { cancelled: true })) + '\n');
  const payload = { native_session_id: f.configuration.authority.native_session_id,
    cwd: f.directory, prompt_id: randomUUID(), waiter_generation: randomUUID() };
  const hook = await createSessionV2Client({ ...f.configuration, role: 'hook' });
  const bridge = await createSessionV2Client(f.configuration);
  t.after(async () => { await hook.close(); await bridge.close(); });
  for (const operation of ['hook.poll', 'hook.cancel']) {
    await assert.rejects(bridge.request({ operation, ...payload }), { code: 'session_v2_invalid_request' });
    await hook.request({ operation, ...payload });
  }
  await assert.rejects(hook.request({ operation: 'bridge.open' }), { code: 'session_v2_invalid_request' });
  await assert.rejects(hook.request({ operation: 'readiness.begin', bridge_id: randomUUID() }), { code: 'session_v2_invalid_request' });
  assert.deepEqual(f.requests.map(request => request.payload.envelope.payload), [payload, payload]);
  assert.ok(f.requests.every(request => request.payload.envelope.role === 'hook'));
});

test('bridge heartbeat refuses a legacy selection event without notifying or retrying', async t => {
  const f = await fixture(t, request => JSON.stringify(reply(request, { event: { kind: 'selection',
    selection_id: randomUUID(), delivery_token: 'd'.repeat(64), delivery_sequence: '1',
    expires_at_nanoseconds: '999999', channel_source: 'blabee-claude' } })) + '\n');
  const client = await createSessionV2Client(f.configuration);
  t.after(() => client.close());
  const command = { operation: 'bridge.poll', bridge_id: randomUUID() };
  await assert.rejects(client.request(command), { code: 'session_v2_invalid_response' });
  await assert.rejects(client.request(command), { code: 'session_v2_invalid_response' });
  assert.equal(f.requests.length, 1);
});

test('raw framing, invalid UTF-8, duplicate keys, secret reflection and malformed results are terminal', async t => {
  const mutations = [
    value => JSON.stringify(value),
    value => JSON.stringify(value) + '\n\n',
    value => JSON.stringify(value).replace('"ok":true', '"ok":true,"ok":true') + '\n',
    value => Buffer.concat([Buffer.from(JSON.stringify(value)), Buffer.from([0x80, 10])]),
    value => JSON.stringify({ ...value, runtime_identity: `sha256:${'2'.repeat(64)}` }) + '\n',
    value => JSON.stringify({ ...value, result: { ...value.result, result: { bridge_id: randomUUID(), extra: true } } }) + '\n',
    value => JSON.stringify({ ...value, result: { ...value.result, result: { bridge_id: 'a'.repeat(64) } } }) + '\n',
    value => JSON.stringify({ ...value, result: { ...value.result, result: { bridge_id: randomUUID(), Owner_Token: 'unknown secret' } } }) + '\n',
    () => 'x'.repeat(256 * 1024 + 1),
  ];
  for (const mutation of mutations) {
    const f = await fixture(t, request => mutation(reply(request)));
    const client = await createSessionV2Client(f.configuration);
    await assert.rejects(client.request(command), { code: 'session_v2_invalid_response' });
    await client.close();
  }
  for (const raw of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":9007199254740992}',
    '{"x":9007199254740991.1}', '{"x":1.5}', '{"x":"\\ud800"}', '['.repeat(34) + '0' + ']'.repeat(34)]) {
    assert.throws(() => parseSessionV2JSON(Buffer.from(raw)), { code: 'session_v2_invalid_response' });
  }
  assert.deepEqual(parseSessionV2JSON(Buffer.from('{"x":9007199254740991,"safe":"18446744073709551615"}')),
    { x: Number.MAX_SAFE_INTEGER, safe: '18446744073709551615' });
});

for (const phase of ['already aborted', 'during private socket check']) {
  test(`cancellation ${phase} sends no frame and leaves the shared client reusable`, async t => {
    const f = await fixture(t);
    const client = await createSessionV2Client(f.configuration);
    t.after(() => client.close());
    const cancellation = new AbortController();
    const privateReason = new Error('PRIVATE CANCELLATION REASON');
    if (phase === 'already aborted') cancellation.abort(privateReason);
    const pending = client.request(command, { signal: cancellation.signal });
    // request enters requirePrivateSocket synchronously before its first await;
    // cancellation here covers the check-to-connect window without a timer.
    if (phase === 'during private socket check') cancellation.abort(privateReason);
    await assert.rejects(pending, error => {
      assert.equal(error.code, 'session_v2_request_cancelled');
      assert.equal(error.message, 'session_v2_request_cancelled');
      return true;
    });
    assert.equal(f.requests.length, 0);
    const result = await client.request(command);
    assert.match(result.bridge_id, /^[0-9a-f-]{36}$/);
    assert.equal(f.requests.length, 1);
  });
}

test('cancellation after socket creation but before connect sends no frame and removes its listener', async t => {
  const f = await fixture(t);
  const client = await createSessionV2Client(f.configuration);
  t.after(() => client.close());
  const cancellation = new AbortController();
  const signal = cancellation.signal;
  const addEventListener = signal.addEventListener.bind(signal);
  let registrations = 0;
  t.mock.method(signal, 'addEventListener', (type, listener, options) => {
    const result = addEventListener(type, listener, options);
    if (type === 'abort') {
      registrations++;
      assert.equal(getEventListeners(signal, 'abort').length, 1);
      // This per-request listener is installed only after the socket exists.
      // Aborting synchronously here precedes its asynchronous connect event.
      cancellation.abort(new Error('PRIVATE CANCELLATION REASON'));
    }
    return result;
  });
  await assert.rejects(client.request(command, { signal }), {
    code: 'session_v2_request_cancelled', message: 'session_v2_request_cancelled',
  });
  assert.equal(registrations, 1);
  assert.equal(getEventListeners(signal, 'abort').length, 0);
  assert.equal(f.requests.length, 0);
  const result = await client.request(command);
  assert.match(result.bridge_id, /^[0-9a-f-]{36}$/);
  assert.equal(f.requests.length, 1);
});

for (const outcome of ['valid response', 'invalid authority', 'timeout']) {
  test(`cancellation after sending preserves ${outcome} validation without retry`, async t => {
    const cancellation = new AbortController();
    let received;
    let release;
    const observed = new Promise(resolve => { received = resolve; });
    const f = await fixture(t, (request, socket) => {
      cancellation.abort(new Error('PRIVATE CANCELLATION REASON'));
      const changes = outcome === 'invalid authority'
        ? { authority: { ...request.payload.envelope.authority, authority_epoch: randomUUID() } } : {};
      release = () => socket.end(JSON.stringify(reply(request, { bridge_id: randomUUID() }, changes)) + '\n');
      received();
    });
    const client = await createSessionV2Client({ ...f.configuration, timeoutMs: 100 });
    t.after(() => client.close());
    const pending = client.request(command, { signal: cancellation.signal })
      .then(result => ({ result }), error => ({ error }));
    const frameObserved = await Promise.race([observed.then(() => true), pending.then(() => false)]);
    assert.equal(frameObserved, true, 'request settled before the service observed its frame');
    // An aborted in-flight request still owns the transport slot until its
    // actual response or bounded timeout settles. No follow-up may overlap it.
    await assert.rejects(client.request(command), { code: 'session_v2_client_busy' });
    assert.equal(f.requests.length, 1);
    if (outcome !== 'timeout') release();
    const settled = await pending;
    if (outcome === 'valid response') {
      assert.equal(settled.error, undefined);
      assert.match(settled.result.bridge_id, /^[0-9a-f-]{36}$/);
    } else {
      const code = outcome === 'invalid authority' ? 'session_v2_invalid_response' : 'session_v2_response_unknown';
      assert.equal(settled.error?.code, code);
      await assert.rejects(client.request(command), { code });
    }
    assert.equal(f.requests.length, 1);
  });
}

test('timed out mutation stays unknown; closing a pending request is bounded and never replays it', async t => {
  const f = await fixture(t, () => undefined);
  const client = await createSessionV2Client({ ...f.configuration, timeoutMs: 25 });
  await assert.rejects(client.request(command), { code: 'session_v2_response_unknown' });
  await assert.rejects(client.request(command), { code: 'session_v2_response_unknown' });
  assert.equal(f.requests.length, 1);
  await client.close();
  const other = await createSessionV2Client(f.configuration);
  const pending = other.request(command);
  const rejected = assert.rejects(pending, { code: 'session_v2_client_closed' });
  await other.close();
  await rejected;
});

test('private sockets, role allowlist, no fallback, and request-side authority are checked before sending', async t => {
  const f = await fixture(t);
  for (const changes of [{ role: 'owner' }, { role: 'selector' }, { authToken: '' }, { channelSource: '*' },
    { authority: { ...f.configuration.authority, authority_epoch: randomUUID().toUpperCase() } },
    { socketPath: 'relative' }, { runtimeIdentity: f.configuration.runtimeIdentity + '\n' }]) {
    await assert.rejects(createSessionV2Client({ ...f.configuration, ...changes }), { code: 'session_v2_invalid_configuration' });
  }
  const alias = join(f.directory, 'alias.sock');
  await symlink(f.configuration.socketPath, alias);
  await assert.rejects(createSessionV2Client({ ...f.configuration, socketPath: alias }), { code: 'session_v2_invalid_socket' });
  await chmod(f.configuration.socketPath, 0o666);
  await assert.rejects(createSessionV2Client(f.configuration), { code: 'session_v2_invalid_socket' });
  await chmod(f.configuration.socketPath, 0o600);
  const client = await createSessionV2Client(f.configuration);
  for (const value of [{ operation: 'session.end' }, { operation: 'select' }, { ...command, request_id: randomUUID() },
    { operation: 'readiness.ack', bridge_id: randomUUID(), probe_id: randomUUID(), nonce: f.configuration.authToken }]) {
    await assert.rejects(client.request(value), { code: 'session_v2_invalid_request' });
  }
  assert.equal(f.requests.length, 0);
  await client.close();
});

test('correlated errors preserve known codes; completion and claim must retain the requested selection', async t => {
  const f = await fixture(t, request => {
    const value = reply(request);
    delete value.result.result;
    return JSON.stringify({ ...value, result: { ...value.result, ok: false, error: { code: 'expired' } } }) + '\n';
  });
  const client = await createSessionV2Client(f.configuration);
  await assert.rejects(client.request(command), { code: 'session_v2_expired' });
  await client.close();
  const g = await fixture(t, request => JSON.stringify(reply(request, { selection_id: randomUUID(), recorded: true, reported_by: 'claude' })) + '\n');
  const other = await createSessionV2Client(g.configuration);
  await assert.rejects(other.request({ operation: 'selection.complete', bridge_id: randomUUID(), selection_id: randomUUID(), outcome: 'completed', note: 'done' }),
    { code: 'session_v2_invalid_response' });
  await other.close();
});

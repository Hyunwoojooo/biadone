import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

test('authenticated explicit v2 request uses the fixed authority and private outer credential wrapper', async t => {
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

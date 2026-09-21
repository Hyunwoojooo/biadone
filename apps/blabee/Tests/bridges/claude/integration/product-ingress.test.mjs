import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { REPOSITORY_ROOT, BUILD_ROOT } from '../support/paths.mjs';
import { createProductCoreClient } from '../../../../bridges/claude/src/product-core-client.mjs';

const executable = process.env.BLABEE_CLAUDE_PRODUCT_COORDINATOR;
const runtimeIdentity = `sha256:${'6'.repeat(64)}`;
const SCHEMA = 'blabee.claude-bridge.v1';
const TYPE = 'blabee.runtime-identity.v1/claude_bridge_v1';
const token = () => randomBytes(32).toString('hex');

function scope(overrides = {}) {
  return { scope_id: randomUUID(), project_id: 'project_claude_product_fixture', session_id: randomUUID(),
    bridge_token: token(), selection_token: token(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides };
}

function binding(sessionID, projectID = 'project_claude_product_fixture') {
  const prompt = randomUUID();
  return { project_id: projectID, session_id: sessionID, source_turn_id: `blabee_turn_${randomUUID()}`,
    source_prompt_id: prompt, episode_id: `episode_${randomUUID()}`, episode_root_prompt_id: prompt,
    episode_baseline_checkpoint_id: `checkpoint_${randomUUID()}`,
    decision_boundary_id: `boundary_${randomUUID()}`, boundary_sequence: 1 };
}

function proposal(label = 'A/B') {
  return { proposal_id: randomUUID(), task_goal: '인증된 공통 Coordinator 연결을 검증한다.',
    outcome: { status: 'completed', summary: `${label} 검증 선택지를 준비했다.` }, reported_side_effects: [],
    options: ['a', 'b'].map(id => ({ id: `${label.replace('/', '-')}-${id}`, title: `선택 ${id}`,
      description: `선택 ${id}의 원래 설명`, task: `선택 ${id}의 표식을 기록한다.`,
      constraints: ['선택된 작업만 실행한다.'], done_when: `선택 ${id}의 표식을 확인한다.` })) };
}

function envelope(context, command = { operation: 'snapshot' }, overrides = {}) {
  return { request_id: `claude_${randomUUID()}`, runtime_identity: runtimeIdentity, type: TYPE,
    payload: { schema_version: SCHEMA, provider: 'claude', scope_id: context.scope_id,
      session_id: context.session_id, role: 'bridge', auth_token: context.bridge_token,
      request: { schema_version: '0.1', request_id: randomUUID(), ...command }, ...overrides } };
}

async function directory(t) {
  await mkdir(BUILD_ROOT, { recursive: true });
  const root = await realpath(await mkdtemp(join(BUILD_ROOT, 'ci-')));
  await chmod(root, 0o700);
  return root;
}

function rawRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let buffer = Buffer.alloc(0);
    let failure;
    const timer = setTimeout(() => { failure = new Error('raw request timeout'); socket.destroy(); }, 5000);
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 256 * 1024) { failure = new Error('raw response oversized'); socket.destroy(); }
    });
    socket.once('error', () => { failure = new Error('raw request failed'); });
    socket.once('close', () => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try {
        const bytes = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        assert.equal(bytes.indexOf('\n'), bytes.length - 1);
        const response = JSON.parse(bytes);
        assert.equal(response.request_id, request.request_id);
        assert.equal(response.runtime_identity, runtimeIdentity);
        resolve({ response, bytes });
      } catch (error) { reject(error); }
    });
  });
}

async function nativeFixture(t, { scopes = [scope()], configMode = 0o600, expectFailure = false,
  optionalConfig = false, missingConfig = false, configText } = {}) {
  assert.ok(executable, 'Run npm run test:product-ingress to build the real Coordinator first');
  const root = await directory(t);
  const contracts = join(root, 'contracts');
  await cp(join(REPOSITORY_ROOT, 'Contracts/v1'), contracts, { recursive: true });
  await chmod(contracts, 0o700);
  const configPath = join(root, 'claude-bridge.json');
  if (!missingConfig) {
    await writeFile(configPath, configText ?? JSON.stringify({ schema_version: 'blabee.claude-bridge.config.v1', scopes }),
      { mode: configMode, flag: 'wx' });
    await chmod(configPath, configMode);
  }
  const socketPath = join(root, 'core.sock');
  const child = spawn(executable, ['claude-bridge-roundtrip-test-server', '--fixture-root', root,
    '--contracts', contracts, '--socket', socketPath, '--config', configPath,
    ...(optionalConfig ? ['--config-policy', 'optional'] : [])], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'en_US.UTF-8', BLABEE_RUNTIME_IDENTITY: runtimeIdentity },
  });
  const clients = [];
  let exited = false;
  let stdout = '';
  let stderr = '';
  let resolveExit;
  const exit = new Promise(resolve => { resolveExit = resolve; });
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); if (stdout.length > 64 * 1024) child.kill('SIGTERM'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); if (stderr.length > 64 * 1024) child.kill('SIGTERM'); });
  child.once('close', (code, signal) => { exited = true; resolveExit({ code, signal }); });
  child.once('error', () => { /* The close event settles startup below. */ });
  t.after(async () => {
    for (const client of clients) await client.close();
    if (!exited) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 1000);
      await exit;
      clearTimeout(kill);
    }
    try {
      for (const context of scopes) {
        assert.ok(!stdout.includes(context.bridge_token) && !stderr.includes(context.bridge_token));
        assert.ok(!stdout.includes(context.selection_token) && !stderr.includes(context.selection_token));
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  if (expectFailure) {
    const kill = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 5000);
    const result = await exit;
    clearTimeout(kill);
    assert.notEqual(result.code, 0);
    assert.equal(result.signal, null, 'Invalid configuration must be rejected, not wait for the test deadline');
    assert.ok(!stdout.includes('"ready":true'));
    return { root, stdout, stderr };
  }
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      child.stdout.off('data', inspect);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      if (!stdout.includes('\n')) return;
      try { assert.deepEqual(JSON.parse(stdout.split('\n')[0]), { ready: true }); finish(); }
      catch { finish(new Error('Coordinator fixture readiness was invalid')); }
    };
    const timeout = setTimeout(() => finish(new Error('Coordinator fixture readiness timed out')), 10_000);
    child.stdout.on('data', inspect);
    exit.then(({ code }) => finish(new Error(`Coordinator fixture exited before readiness (${code})`)));
    inspect();
  });
  async function client(context = scopes[0], role = 'bridge', options = {}) {
    const value = await createProductCoreClient({ socketPath, runtimeIdentity, scopeID: context.scope_id,
      sessionID: context.session_id, role, authToken: role === 'bridge' ? context.bridge_token : context.selection_token,
      ...options });
    clients.push(value);
    return value;
  }
  return { root, socketPath, scopes, client, raw: request => rawRequest(socketPath, request) };
}

function assertNoSecrets(bytes, scopes) {
  for (const context of scopes) {
    assert.ok(!bytes.includes(context.bridge_token));
    assert.ok(!bytes.includes(context.selection_token));
  }
  for (const forbidden of ['correlation_token', 'continuation_token', 'auth_token', 'queued_next_turn',
    'queued_action_context_claim_protocol', 'queued_submission_id']) assert.ok(!bytes.includes(forbidden), forbidden);
}

test('real Coordinator authenticates Claude selection and preserves C/D after late A completion', async t => {
  const host = await nativeFixture(t);
  const bridge = await host.client();
  const selector = await host.client(host.scopes[0], 'selector');
  const original = binding(host.scopes[0].session_id);
  const input = proposal();
  const first = await bridge.request({ operation: 'activate', binding: original, proposal: input });
  assert.deepEqual(first.claude_proposal, input);
  const selectionID = randomUUID();
  const selection = { operation: 'select', binding: original, packet_id: first.packet.packet_id,
    revision: first.packet.revision, selection_id: selectionID, option_id: first.option_bindings[0].option_id };
  await assert.rejects(bridge.request(selection), { code: 'claude_bridge_forbidden' });
  const selected = await selector.request(selection);
  assert.equal(selected.delivery, 'awaiting_claude_claim');
  await assert.rejects(selector.request({ operation: 'claim', binding: original, selection_id: selectionID }),
    { code: 'claude_bridge_forbidden' });
  const claimed = await bridge.request({ operation: 'claim', binding: original, selection_id: selectionID });
  assert.equal(claimed.delivery, 'claimed');
  assert.deepEqual(claimed.action, input.options[0]);
  await assert.rejects(bridge.request({ operation: 'claim', binding: original, selection_id: selectionID }));
  const file = join(host.root, 'selected-a.txt');
  await writeFile(file, 'BLABEE_PRODUCT_CLAUDE_A_OK\n', { flag: 'wx' });
  assert.equal(await readFile(file, 'utf8'), 'BLABEE_PRODUCT_CLAUDE_A_OK\n');

  const next = binding(original.session_id);
  const second = await bridge.request({ operation: 'activate', binding: next, proposal: proposal('C/D') });
  const before = await bridge.request({ operation: 'snapshot' });
  assert.deepEqual(Object.keys(before).sort(), ['cards', 'history', 'outcomes']);
  const latest = before.cards.find(card => card.packet.packet_id === second.packet.packet_id);
  assert.ok(latest);
  const completed = await bridge.request({ operation: 'complete', binding: original, selection_id: selectionID,
    outcome: 'completed', note: 'selected-a.txt: BLABEE_PRODUCT_CLAUDE_A_OK' });
  assert.equal(completed.recorded, true);
  assert.equal(completed.reported_by, 'model');
  const after = await bridge.request({ operation: 'snapshot' });
  assert.deepEqual(after.cards.find(card => card.packet.packet_id === second.packet.packet_id), latest);
  assert.ok(after.outcomes.some(item => item.selection_id === selectionID && item.reported_by === 'model'));
  const nextSelection = randomUUID();
  await selector.request({ operation: 'select', binding: next, packet_id: second.packet.packet_id,
    revision: second.packet.revision, selection_id: nextSelection, option_id: second.option_bindings[0].option_id });
  assert.equal((await bridge.request({ operation: 'claim', binding: next, selection_id: nextSelection })).delivery, 'claimed');
  const raw = await host.raw(envelope(host.scopes[0]));
  assert.equal(raw.response.ok, true);
  assertNoSecrets(raw.bytes, host.scopes);
  assertNoSecrets(JSON.stringify([first, selected, claimed, completed, after]), host.scopes);
});

test('real Coordinator rejects wrong provider session scope token role version and public-identity-only requests', async t => {
  const host = await nativeFixture(t);
  const context = host.scopes[0];
  const cases = [
    [{ provider: 'codex' }, 'claude_bridge_unauthorized'],
    [{ session_id: randomUUID() }, 'claude_bridge_unauthorized'],
    [{ scope_id: randomUUID() }, 'claude_bridge_unauthorized'],
    [{ auth_token: token() }, 'claude_bridge_unauthorized'],
    [{ auth_token: undefined }, 'claude_bridge_invalid_request'],
    [{ role: 'selector' }, 'claude_bridge_forbidden'],
    [{ schema_version: 'blabee.claude-bridge.v999' }, 'claude_bridge_invalid_request'],
  ];
  for (const [overrides, code] of cases) {
    const { response, bytes } = await host.raw(envelope(context, undefined, overrides));
    assert.equal(response.ok, false);
    assert.equal(response.error.code, code);
    assertNoSecrets(bytes, host.scopes);
  }
  const bridge = await host.client();
  await assert.rejects(bridge.request({ operation: 'activate', binding: binding(randomUUID()), proposal: proposal() }),
    { code: 'claude_bridge_unauthorized' });
  await assert.rejects(bridge.request({ operation: 'activate', binding: binding(context.session_id, 'another_project'),
    proposal: proposal() }), { code: 'claude_bridge_unauthorized' });
  const snapshot = await bridge.request({ operation: 'snapshot' });
  assert.equal(snapshot.cards.length, 0);

  const codexRead = await host.raw({ request_id: `codex_${randomUUID()}`, runtime_identity: runtimeIdentity,
    type: 'blabee.runtime-identity.v1/get_state', payload: {} });
  assert.equal(codexRead.response.ok, true);
  const codexWrite = await host.raw({ request_id: `codex_${randomUUID()}`, runtime_identity: runtimeIdentity,
    type: 'blabee.runtime-identity.v1/emit_decision', payload: envelope(context).payload });
  assert.equal(codexWrite.response.ok, false);
  assertNoSecrets(codexWrite.bytes, host.scopes);
});

test('real Coordinator scopes with equal native IDs have separate stores and selection authority', async t => {
  const one = scope();
  const two = scope({ project_id: one.project_id, session_id: one.session_id });
  const host = await nativeFixture(t, { scopes: [one, two] });
  const first = await host.client(one);
  const second = await host.client(two);
  const selector = await host.client(one, 'selector');
  const source = binding(one.session_id);
  const card = await first.request({ operation: 'activate', binding: source, proposal: proposal('first') });
  await second.request({ operation: 'activate', binding: source, proposal: proposal('second') });
  const selectionID = randomUUID();
  await selector.request({ operation: 'select', binding: source, packet_id: card.packet.packet_id,
    revision: card.packet.revision, selection_id: selectionID, option_id: card.option_bindings[0].option_id });
  const before = await second.request({ operation: 'snapshot' });
  await assert.rejects(second.request({ operation: 'claim', binding: source, selection_id: selectionID }));
  assert.deepEqual(await second.request({ operation: 'snapshot' }), before);
  assert.equal((await first.request({ operation: 'claim', binding: source, selection_id: selectionID })).delivery, 'claimed');
  const confused = await host.raw(envelope(two, undefined, { auth_token: one.bridge_token }));
  assert.equal(confused.response.ok, false);
  assert.equal(confused.response.error.code, 'claude_bridge_unauthorized');
  const stores = await readdir(join(host.root, 'claude-stores'));
  assert.ok(stores.includes(one.scope_id) && stores.includes(two.scope_id));
});

test('real Coordinator rejects credential reflection before a card is committed', async t => {
  const host = await nativeFixture(t);
  const bridge = await host.client();
  for (const secret of [host.scopes[0].bridge_token, host.scopes[0].selection_token]) {
    const malicious = proposal();
    malicious.outcome.summary = `do not echo ${secret}`;
    await assert.rejects(bridge.request({ operation: 'activate', binding: binding(host.scopes[0].session_id),
      proposal: malicious }), { code: 'claude_bridge_secret_reflection' });
    assert.equal((await bridge.request({ operation: 'snapshot' })).cards.length, 0);
  }
  const request = envelope(host.scopes[0], { operation: 'snapshot', correlation_token: token() });
  const { response, bytes } = await host.raw(request);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'claude_bridge_secret_reflection');
  assertNoSecrets(bytes, host.scopes);
});

test('real Coordinator expires only the credential scope and rejects unsafe or duplicated credential configuration', async t => {
  const expiring = scope({ expires_at: new Date(Date.now() + 5000).toISOString() });
  const healthy = scope();
  const host = await nativeFixture(t, { scopes: [expiring, healthy] });
  const expired = await host.client(expiring);
  const active = await host.client(healthy);
  await expired.request({ operation: 'snapshot' });
  await delay(Math.max(0, Date.parse(expiring.expires_at) - Date.now() + 150));
  await assert.rejects(expired.request({ operation: 'snapshot' }), { code: 'claude_bridge_unauthorized' });
  assert.equal((await active.request({ operation: 'snapshot' })).cards.length, 0);
  const unsafe = await nativeFixture(t, { configMode: 0o644, expectFailure: true });
  assert.match(unsafe.stderr, /claude_bridge_config_unsafe/);
  const duplicate = scope();
  const rejected = await nativeFixture(t, { scopes: [duplicate, scope({ bridge_token: duplicate.bridge_token })], expectFailure: true });
  assert.match(rejected.stderr, /claude_bridge_configuration_invalid/);
});

test('real Coordinator keeps Codex available when optional Claude configuration is invalid or absent', async t => {
  const expired = scope({ expires_at: new Date(Date.now() - 1000).toISOString() });
  const cases = [
    { scopes: [expired], expected: 'claude_bridge_unavailable' },
    { configText: '{invalid JSON', expected: 'claude_bridge_unavailable' },
    { missingConfig: true, expected: 'claude_bridge_disabled' },
  ];
  for (const { expected, ...options } of cases) {
    const host = await nativeFixture(t, { optionalConfig: true, ...options });
    const codex = await host.raw({ request_id: `codex_${randomUUID()}`, runtime_identity: runtimeIdentity,
      type: 'blabee.runtime-identity.v1/get_state', payload: {} });
    assert.equal(codex.response.ok, true);
    const claude = await host.raw(envelope(host.scopes[0]));
    assert.equal(claude.response.ok, false);
    assert.equal(claude.response.error.code, expected);
    assertNoSecrets(claude.bytes, host.scopes);
    assert.ok(!(await readdir(host.root)).includes('claude-stores'));
  }
});

async function fakeFixture(t, handler, options = {}) {
  const root = await directory(t);
  const socketPath = join(root, 'fake.sock');
  const context = scope();
  const sockets = new Set();
  const seen = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.split('\n')[0]);
      seen.push(request);
      handler(socket, request);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  const client = await createProductCoreClient({ socketPath, runtimeIdentity, scopeID: context.scope_id,
    sessionID: context.session_id, role: 'bridge', authToken: context.bridge_token, timeoutMs: 500, ...options });
  t.after(async () => {
    await client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { client, seen, context };
}

function responseFor(request) {
  const input = request.payload;
  return { request_id: request.request_id, runtime_identity: runtimeIdentity, ok: true,
    result: { schema_version: SCHEMA, provider: 'claude', scope_id: input.scope_id, session_id: input.session_id,
      role: input.role, request_id: input.request.request_id, ok: true, result: { accepted: true } } };
}

test('client lost mutation response cannot resend or send another command', async t => {
  const { client, seen } = await fakeFixture(t, () => {});
  await assert.rejects(client.request({ operation: 'claim' }), { code: 'product_core_response_unknown' });
  await assert.rejects(client.request({ operation: 'claim' }), { code: 'product_core_response_unknown' });
  assert.equal(seen.length, 1);
});

test('client rejects mismatched response identities and scope without accepting another command', async t => {
  for (const field of ['outer_request', 'runtime', 'schema_version', 'provider', 'scope_id', 'session_id', 'role', 'request_id']) {
    const { client } = await fakeFixture(t, (socket, request) => {
      const response = responseFor(request);
      if (field === 'outer_request') response.request_id = randomUUID();
      else if (field === 'runtime') response.runtime_identity = `sha256:${'7'.repeat(64)}`;
      else response.result[field] = 'mismatch';
      socket.end(JSON.stringify(response) + '\n');
    });
    await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'invalid_product_core_response' });
    await assert.rejects(client.request({ operation: 'snapshot' }), { code: 'invalid_product_core_response' });
  }
});

test('client rejects oversized and malformed UTF-8 responses and suppresses arbitrary error text', async t => {
  const oversized = await fakeFixture(t, socket => socket.end('x'.repeat(256 * 1024 + 1)));
  await assert.rejects(oversized.client.request({ operation: 'snapshot' }), { code: 'invalid_product_core_response' });
  const utf8 = await fakeFixture(t, (socket, request) => {
    const response = responseFor(request);
    response.result.result.text = 'placeholder';
    const encoded = JSON.stringify(response);
    const index = encoded.indexOf('placeholder');
    socket.end(Buffer.concat([Buffer.from(encoded.slice(0, index)), Buffer.from([0x80]), Buffer.from(encoded.slice(index + 11) + '\n')]));
  });
  await assert.rejects(utf8.client.request({ operation: 'snapshot' }), { code: 'invalid_product_core_response' });
  const unsafe = await fakeFixture(t, (socket, request) => {
    const response = responseFor(request);
    response.result.ok = false;
    delete response.result.result;
    response.result.error = { code: 'private diagnostic must not be returned' };
    socket.end(JSON.stringify(response) + '\n');
  });
  await assert.rejects(unsafe.client.request({ operation: 'snapshot' }), { code: 'product_core_rejected' });
});

test('client rejects oversized requests locally and close settles the one pending socket', async t => {
  const normal = await fakeFixture(t, (socket, request) => socket.end(JSON.stringify(responseFor(request)) + '\n'));
  await assert.rejects(normal.client.request({ operation: 'activate', extra: 'x'.repeat(128 * 1024) }),
    { code: 'product_core_request_too_large' });
  assert.equal(normal.seen.length, 0);
  assert.deepEqual(await normal.client.request({ operation: 'snapshot' }), { accepted: true });
  const waiting = await fakeFixture(t, () => {});
  const inFlight = assert.rejects(waiting.client.request({ operation: 'claim' }), { code: 'product_core_closed' });
  await assert.rejects(waiting.client.request({ operation: 'snapshot' }), { code: 'product_core_busy' });
  await Promise.all([inFlight, waiting.client.close()]);
  await assert.rejects(waiting.client.request({ operation: 'snapshot' }), { code: 'product_core_closed' });
});

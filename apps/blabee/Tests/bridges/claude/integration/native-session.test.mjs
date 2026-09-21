import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, StdioClientTransport } from '../../../../bridges/claude/test-support/mcp-client.mjs';
import { BRIDGE_ROOT, REPOSITORY_ROOT, BUILD_ROOT } from '../support/paths.mjs';
import { cleanSharedEnvironment, startSharedRuntime } from '../../../../bridges/claude/launchers/shared-launcher.mjs';

const executable = process.env.BLABEE_CLAUDE_NATIVE_COORDINATOR;
const TYPE = 'blabee.runtime-identity.v1/claude_session_v1';
const SCHEMA = 'blabee.claude-session.v1';
const MCP_TOOLS = ['check_connection_v1', 'ack_readiness_probe_v1', 'emit_decision_v1',
  'claim_selection_v1', 'complete_selection_v1'];
const ENV = 'BLABEE_CLAUDE_SHARED_';

async function waitFor(read, accepts, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(10);
  }
  throw new Error(message);
}

function proposal(label = 'A/B') {
  return { proposal_id: randomUUID(), task_goal: '실제 Hook과 MCP의 공통 엔진 연결을 검증한다.',
    outcome: { status: 'completed', summary: `${label} 선택지를 준비했고 실행하지 않았다.` },
    reported_side_effects: [],
    options: label.split('/').map(id => ({ id: id.toLowerCase(), title: `선택 ${id}`,
      description: `${id}의 원래 설명`, task: `선택 ${id}의 테스트 표식을 기록한다.`,
      constraints: ['선택된 작업만 실행한다.'], done_when: `${id}의 표식 파일을 확인한다.` })) };
}

function authorityValues(host) {
  return [...new Set([...Object.entries(host.hookEnvironment), ...Object.entries(host.mcpEnvironment)]
    .filter(([key]) => key.endsWith('_TOKEN')).map(([, value]) => value))];
}

function noAuthorityLeak(host, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of authorityValues(host)) {
    assert.ok(typeof secret === 'string' && secret.length > 0, 'Launcher authority must be nonempty');
    assert.ok(!text.includes(secret), 'Child output must not contain launcher credentials');
  }
}

async function assertNoCredentialFiles(host, directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await assertNoCredentialFiles(host, path);
    else if (item.isFile()) {
      const bytes = await readFile(path);
      for (const secret of authorityValues(host)) {
        assert.ok(!bytes.includes(Buffer.from(secret)), 'Runtime files must not serialize session credentials');
      }
    }
  }
}

async function fixture(t, options = {}) {
  assert.ok(executable, 'Run npm run test:native-session to build the real Coordinator first');
  const build = BUILD_ROOT;
  await mkdir(build, { recursive: true });
  const root = await realpath(await mkdtemp(join(build, 'ns-')));
  await chmod(root, 0o700);
  const runtime = join(root, 'run');
  const cwd = join(root, 'project');
  await mkdir(runtime, { mode: 0o700 });
  await mkdir(cwd, { mode: 0o700 });
  const config = { coordinatorBinary: executable, contractsDirectory: await realpath(join(REPOSITORY_ROOT, 'Contracts/v1')),
    runtime, cwd, fixture: true, ttlMs: 60_000, ...options };
  let host;
  const clients = [];
  t.after(async () => {
    try {
      for (const client of clients) await client.close();
      await host?.close();
      if (host) await assertNoCredentialFiles(host, root);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  host = await startSharedRuntime(config);
  return { ...host, root, cwd, config, clients };
}

async function hook(host, event, fields = {}, { env = host.hookEnvironment, expectedCode = 0 } = {}) {
  const child = spawn(process.execPath, [join(BRIDGE_ROOT, 'src/product-hook.mjs'),
    '--expected-session-id', host.sessionID], { cwd: host.cwd, env: { ...cleanSharedEnvironment(), ...env },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let exceeded = false;
  const collect = (name, chunk) => {
    if (name === 'stdout') stdout += chunk.toString('utf8');
    else stderr += chunk.toString('utf8');
    if (stdout.length + stderr.length > 128 * 1024) { exceeded = true; child.kill('SIGKILL'); }
  };
  child.stdout.on('data', chunk => collect('stdout', chunk));
  child.stderr.on('data', chunk => collect('stderr', chunk));
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ hook_event_name: event, session_id: host.sessionID, cwd: host.cwd, ...fields }));
  let result;
  try { result = await finished; }
  finally { clearTimeout(timer); }
  noAuthorityLeak(host, stdout + stderr);
  assert.equal(exceeded, false, 'Hook output must stay bounded');
  assert.equal(result.signal, null, 'Hook must exit on its own');
  const diagnostic = stderr.match(/\(([a-z][a-z0-9_]{1,80})\)/)?.[1] || 'no_safe_diagnostic';
  assert.equal(result.code, expectedCode, `Hook ${event} returned an unexpected exit code (${diagnostic})`);
  if (expectedCode !== 0) {
    assert.equal(stdout, '', 'Rejected native input must not issue a boundary');
    return { stderr };
  }
  if (!['SessionStart', 'UserPromptSubmit'].includes(event)) {
    assert.equal(stdout, '');
    return {};
  }
  const output = JSON.parse(stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, event);
  const context = output.hookSpecificOutput.additionalContext;
  assert.equal(typeof context, 'string');
  const boundaryID = context.match(/boundary_id["'\s:=]+([0-9a-f-]{36})/i)?.[1];
  if (event === 'UserPromptSubmit') assert.ok(boundaryID, 'A native prompt must return a server-owned boundary');
  return { boundaryID, context };
}

async function startMCP(host, env = host.mcpEnvironment) {
  const notifications = [];
  const replies = [];
  let stderr = '';
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(BRIDGE_ROOT, 'src/product-mcp.mjs'), '--expected-session-id', host.sessionID],
    cwd: host.cwd, env: { ...cleanSharedEnvironment(), ...env }, stderr: 'pipe' });
  const client = new Client({ name: 'blabee-native-session-integration', version: '1.0.0' });
  client.fallbackNotificationHandler = notification => { notifications.push(notification); };
  // A test failure must not print server diagnostics containing private context.
  client.onerror = () => {};
  transport.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  let closed = false;
  const value = {
    notifications,
    async close() {
      if (!closed) { closed = true; await client.close(); }
      noAuthorityLeak(host, JSON.stringify([...notifications, ...replies]) + stderr);
    },
    async call(name, arguments_ = {}, { error = false } = {}) {
      const reply = await client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 5000 });
      replies.push(reply);
      noAuthorityLeak(host, reply);
      if (error) {
        assert.equal(reply.isError, true, `${name} must reject the request`);
        return reply;
      }
      const parsed = JSON.parse(reply.content.find(item => item.type === 'text').text);
      const code = typeof parsed?.error?.code === 'string' && /^[a-z][a-z0-9_]{1,80}$/.test(parsed.error.code)
        ? parsed.error.code : 'no_safe_diagnostic';
      assert.ok(reply.isError !== true, `${name} must succeed (${code})`);
      assert.equal(parsed.ok, true, `${name} must return a successful versioned result`);
      return parsed.result;
    },
    async channel(kind, id) {
      return waitFor(() => notifications.find(notification => notification.method === 'notifications/claude/channel'
        && (kind === 'readiness_probe' ? notification.params.meta?.probe_id === id
          : notification.params.meta?.selection_id === id)), Boolean, `Missing ${kind} Channel notification`);
    },
  };
  host.clients.push(value);
  await client.connect(transport);
  assert.deepEqual(client.getServerVersion(), { name: 'blabee-claude', version: '0.2.0' });
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name), MCP_TOOLS);
  await waitFor(() => host.selectorClient.request({ operation: 'snapshot' }), state => state.bridge_connected,
    'Actual MCP child did not register with the Coordinator');
  return value;
}

function channelReference(notification) {
  const content = notification.params.content;
  assert.equal(typeof content, 'string');
  return JSON.parse(content.split('\n').at(-1));
}

function channelWrapper(notification) {
  const { content, meta } = notification.params;
  const attributes = meta.kind === 'readiness_probe'
    ? `kind="readiness_probe" probe_id="${meta.probe_id}"` : `selection_id="${meta.selection_id}"`;
  return `<channel source="blabee-claude" ${attributes}>\n${content}\n</channel>`;
}

async function readiness(host, mcp) {
  const begun = await mcp.call('check_connection_v1');
  assert.equal(begun.status, 'awaiting_ack');
  assert.equal(Object.hasOwn(begun, 'nonce'), false, 'Check response cannot supply its own ACK nonce');
  const notification = await mcp.channel('readiness_probe', begun.probe_id);
  assert.equal((await host.selectorClient.request({ operation: 'snapshot' })).ready, false,
    'Receiving a Channel must not acknowledge it automatically');
  const reference = channelReference(notification);
  assert.deepEqual(Object.keys(reference).sort(), ['nonce', 'probe_id']);
  assert.equal(reference.probe_id, begun.probe_id);
  await mcp.call('ack_readiness_probe_v1', { ...reference, nonce: randomBytes(32).toString('hex') }, { error: true });
  const acknowledged = await mcp.call('ack_readiness_probe_v1', reference);
  assert.equal(acknowledged.ready, true);
  await mcp.call('ack_readiness_probe_v1', reference, { error: true });
  return notification;
}

function selectionFor(state, packetID, selectionID = randomUUID()) {
  const card = state.cards.find(item => item.packet.packet_id === packetID);
  assert.ok(card, 'Server snapshot must contain the committed card');
  return { operation: 'select', boundary_id: card.binding.decision_boundary_id, packet_id: packetID,
    revision: card.packet.revision, option_id: card.option_bindings[0].option_id, selection_id: selectionID };
}

function envelope(host, role, operation, payloadOverrides = {}) {
  const env = role === 'hook' ? host.hookEnvironment : host.mcpEnvironment;
  return { request_id: `native_${randomUUID()}`, runtime_identity: host.runtimeIdentity, type: TYPE,
    payload: { schema_version: SCHEMA, provider: 'claude', scope_id: host.scopeID, session_id: host.sessionID,
      role, auth_token: env[`${ENV}${role === 'hook' ? 'HOOK' : 'BRIDGE'}_TOKEN`],
      request: { schema_version: '1.0', request_id: randomUUID(), ...operation }, ...payloadOverrides } };
}

async function rawRequest(host, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: host.socketPath });
    let buffer = Buffer.alloc(0);
    let failure;
    const timer = setTimeout(() => { failure = new Error('Native request timed out'); socket.destroy(); }, 5000);
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 256 * 1024) { failure = new Error('Native response exceeded its limit'); socket.destroy(); }
    });
    socket.once('error', () => { failure = new Error('Native request connection failed'); });
    socket.once('close', () => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        noAuthorityLeak(host, text);
        const response = JSON.parse(text);
        assert.equal(response.request_id, request.request_id);
        assert.equal(response.runtime_identity, host.runtimeIdentity);
        resolve(response);
      } catch (error) { reject(error); }
    });
  });
}

function assertRejected(response, code) {
  const result = response.ok ? response.result : response;
  assert.equal(result.ok, false, 'Unauthorized request must not succeed');
  if (code) assert.equal(result.error.code, code);
}

test('actual Hook and MCP children use the common Coordinator and preserve C/D after late A completion', async t => {
  const host = await fixture(t);
  await hook(host, 'SessionStart', { source: 'startup' });
  const promptID = randomUUID();
  const original = await hook(host, 'UserPromptSubmit', { prompt_id: promptID, prompt: 'A/B 테스트를 준비해 줘.' });
  const mcp = await startMCP(host);
  const input = proposal();
  const emitted = await mcp.call('emit_decision_v1', { boundary_id: original.boundaryID, proposal: input });
  let state = await host.selectorClient.request({ operation: 'snapshot' });
  const selection = selectionFor(state, emitted.packet_id);
  assert.equal(state.ready, false);
  assert.equal(state.selection_enabled, false);
  await assert.rejects(host.selectorClient.request(selection), { code: 'claude_session_readiness_required' });
  await readiness(host, mcp);
  await assert.rejects(host.selectorClient.request(selection), { code: 'claude_session_stop_required' });
  await hook(host, 'Stop', { prompt_id: promptID });
  const selected = await host.selectorClient.request(selection);
  assert.equal(selected.delivery, 'awaiting_claude_claim');
  assert.ok(!JSON.stringify(selected).includes('queued_next_turn'), 'Claude delivery is not a Codex queue receipt');
  const notification = await mcp.channel('selection', selection.selection_id);
  const reference = channelReference(notification);
  assert.deepEqual(Object.keys(reference).sort(), ['delivery_token', 'selection_id']);
  // This branch deliberately has no synthetic UserPromptSubmit for the Channel.
  const claimed = await mcp.call('claim_selection_v1', reference);
  assert.equal(claimed.selection_id, selection.selection_id);
  assert.equal(claimed.prompt_id, promptID, 'A Channel without a Hook must retain the actual native prompt');
  assert.notEqual(claimed.boundary_id, original.boundaryID, 'New internal work needs its own boundary');
  assert.deepEqual(claimed.action, input.options[0]);
  await mcp.call('claim_selection_v1', reference, { error: true });
  const path = join(host.cwd, 'native-a.txt');
  // The test harness writes the marker: this is protocol qualification, not a real model run.
  await writeFile(path, 'BLABEE_NATIVE_A_OK\n', { flag: 'wx' });
  assert.equal(await readFile(path, 'utf8'), 'BLABEE_NATIVE_A_OK\n');

  const nextPromptID = randomUUID();
  const next = await hook(host, 'UserPromptSubmit', { prompt_id: nextPromptID, prompt: '새 C/D 선택지를 준비해 줘.' });
  const newer = await mcp.call('emit_decision_v1', { boundary_id: next.boundaryID, proposal: proposal('C/D') });
  state = await host.selectorClient.request({ operation: 'snapshot' });
  const nextCard = state.cards.find(card => card.packet.packet_id === newer.packet_id);
  const completed = await mcp.call('complete_selection_v1', { selection_id: selection.selection_id,
    outcome: 'completed', note: 'native-a.txt: BLABEE_NATIVE_A_OK' });
  assert.equal(completed.recorded, true);
  assert.equal(completed.reported_by, 'model');
  const after = await host.selectorClient.request({ operation: 'snapshot' });
  assert.equal(after.boundary_id, next.boundaryID);
  assert.deepEqual(after.cards.find(card => card.packet.packet_id === newer.packet_id), nextCard);
  assert.ok(after.outcomes.some(outcome => outcome.selection_id === selection.selection_id && outcome.reported_by === 'model'));
  await mcp.call('complete_selection_v1', { selection_id: selection.selection_id, outcome: 'failed', note: 'overwrite' }, { error: true });
  await hook(host, 'Stop', { prompt_id: nextPromptID });
  if (!after.ready) await readiness(host, mcp);
  const nextSelection = selectionFor(await host.selectorClient.request({ operation: 'snapshot' }), newer.packet_id);
  await host.selectorClient.request(nextSelection);
  const nextReference = channelReference(await mcp.channel('selection', nextSelection.selection_id));
  assert.equal((await mcp.call('claim_selection_v1', nextReference)).action.id, 'c');
});

test('exact native Channel wrappers preserve selection while observed prompt IDs remain distinct from internal IDs', async t => {
  const host = await fixture(t);
  await hook(host, 'SessionStart', { source: 'startup' });
  const firstPrompt = randomUUID();
  const original = await hook(host, 'UserPromptSubmit', { prompt_id: firstPrompt, prompt: '선택지 테스트' });
  const mcp = await startMCP(host);
  const begun = await mcp.call('check_connection_v1');
  const probe = await mcp.channel('readiness_probe', begun.probe_id);
  const probePrompt = randomUUID();
  const probeHook = await hook(host, 'UserPromptSubmit', { prompt_id: probePrompt, prompt: channelWrapper(probe) });
  assert.equal(probeHook.boundaryID, original.boundaryID, 'An exact probe wrapper must preserve the task boundary');
  assert.equal((await host.selectorClient.request({ operation: 'snapshot' })).ready, false);
  await mcp.call('ack_readiness_probe_v1', channelReference(probe));
  const input = proposal();
  const emitted = await mcp.call('emit_decision_v1', { boundary_id: original.boundaryID, proposal: input });
  await hook(host, 'Stop', { prompt_id: probePrompt });
  const selection = selectionFor(await host.selectorClient.request({ operation: 'snapshot' }), emitted.packet_id);
  await host.selectorClient.request(selection);
  const notification = await mcp.channel('selection', selection.selection_id);
  const selectionPrompt = randomUUID();
  await hook(host, 'UserPromptSubmit', { prompt_id: selectionPrompt, prompt: channelWrapper(notification) });
  const claimed = await mcp.call('claim_selection_v1', channelReference(notification));
  assert.equal(claimed.prompt_id, selectionPrompt);
  assert.notEqual(claimed.boundary_id, original.boundaryID);
  assert.deepEqual(claimed.action, input.options[0]);
  const next = await mcp.call('emit_decision_v1', { boundary_id: claimed.boundary_id, proposal: proposal('C/D') });
  const snapshot = await host.selectorClient.request({ operation: 'snapshot' });
  const card = snapshot.cards.find(item => item.packet.packet_id === next.packet_id);
  assert.ok(card);
  assert.equal(card.binding.source_prompt_id, selectionPrompt);
  assert.notEqual(card.binding.source_turn_id, selectionPrompt, 'An internal turn must not masquerade as an observed native turn');
  assert.equal((await mcp.call('complete_selection_v1', { selection_id: selection.selection_id,
    outcome: 'completed', note: 'Exact wrapper protocol test completed.' })).recorded, true);
});

test('role credentials never reach the wrong child or authorize another provider scope session or cwd', async t => {
  const host = await fixture(t);
  const other = await fixture(t);
  const hookKeys = Object.keys(host.hookEnvironment).filter(key => key.startsWith(ENV)).sort();
  const mcpKeys = Object.keys(host.mcpEnvironment).filter(key => key.startsWith(ENV)).sort();
  const common = ['CWD', 'RUNTIME_IDENTITY', 'SCOPE_ID', 'SESSION_ID', 'SOCKET'].map(key => ENV + key);
  assert.deepEqual(hookKeys, [...common, `${ENV}HOOK_TOKEN`].sort());
  assert.deepEqual(mcpKeys, [...common, `${ENV}BRIDGE_TOKEN`].sort());
  const credentialsDiffer = host.hookEnvironment[`${ENV}HOOK_TOKEN`] !== host.mcpEnvironment[`${ENV}BRIDGE_TOKEN`];
  assert.equal(credentialsDiffer, true, 'Native Hook and model-facing MCP must have separate credentials');
  const base = { operation: 'bridge.open' };
  const cases = [
    [{ provider: 'codex' }, 'claude_session_unauthorized'],
    [{ scope_id: randomUUID() }, 'claude_session_unauthorized'],
    [{ session_id: randomUUID() }, 'claude_session_unauthorized'],
    [{ auth_token: randomBytes(32).toString('hex') }, 'claude_session_unauthorized'],
    [{ role: 'hook' }, 'claude_session_forbidden'],
    [{ auth_token: host.hookEnvironment[`${ENV}HOOK_TOKEN`] }, 'claude_session_forbidden'],
  ];
  for (const [overrides, code] of cases) assertRejected(await rawRequest(host, envelope(host, 'bridge', base, overrides)), code);
  assertRejected(await rawRequest(host, envelope(host, 'bridge', base, {
    scope_id: other.scopeID, session_id: other.sessionID,
    auth_token: other.mcpEnvironment[`${ENV}BRIDGE_TOKEN`],
  })), 'claude_session_unauthorized');
  assertRejected(await rawRequest(host, envelope(host, 'bridge', { operation: 'snapshot' })), 'claude_session_forbidden');
  assertRejected(await rawRequest(host, envelope(host, 'hook', { operation: 'hook', event: 'SessionStart',
    session_id_native: host.sessionID, cwd: join(host.cwd, 'other') })), 'claude_session_hook_mismatch');
  await hook(host, 'SessionStart', { source: 'resume' }, { expectedCode: 1 });
  const state = await host.selectorClient.request({ operation: 'snapshot' });
  assert.equal(state.cards.length, 0);
  assert.equal(state.bridge_connected, false);
  await assertNoCredentialFiles(host, host.root);
});

test('missing model proposal fields and stale native observations cannot invent authority or keep an executable card', async t => {
  const host = await fixture(t);
  await hook(host, 'SessionStart', { source: 'startup' });
  const promptID = randomUUID();
  const observed = await hook(host, 'UserPromptSubmit', { prompt_id: promptID, prompt: 'native identity checks' });
  const mcp = await startMCP(host);
  await readiness(host, mcp);
  const noOutcome = proposal();
  delete noOutcome.outcome;
  await mcp.call('emit_decision_v1', { boundary_id: observed.boundaryID, proposal: noOutcome }, { error: true });
  const noConstraints = proposal();
  delete noConstraints.options[0].constraints;
  await mcp.call('emit_decision_v1', { boundary_id: observed.boundaryID, proposal: noConstraints }, { error: true });
  assert.equal((await host.selectorClient.request({ operation: 'snapshot' })).cards.length, 0);
  const emitted = await mcp.call('emit_decision_v1', { boundary_id: observed.boundaryID, proposal: proposal() });
  await hook(host, 'Stop', { prompt_id: promptID });
  const selection = selectionFor(await host.selectorClient.request({ operation: 'snapshot' }), emitted.packet_id);
  await assert.rejects(host.selectorClient.request({ ...selection, boundary_id: randomUUID() }),
    { code: 'claude_session_boundary_mismatch' });
  await hook(host, 'Stop', { prompt_id: randomUUID() }, { expectedCode: 1 });
  const stale = await host.selectorClient.request({ operation: 'snapshot' });
  assert.equal(stale.selection_enabled, false, 'Unknown native prompt must invalidate execution eligibility');
  await assert.rejects(host.selectorClient.request(selection));
});

test('same-scope Hook observation loss retires a ready card without accepting unrelated native input', async t => {
  const host = await fixture(t);
  await hook(host, 'SessionStart', { source: 'startup' });
  const promptID = randomUUID();
  const observed = await hook(host, 'UserPromptSubmit', { prompt_id: promptID, prompt: '관찰 누락 회귀 테스트' });
  const mcp = await startMCP(host);
  await readiness(host, mcp);
  const emitted = await mcp.call('emit_decision_v1', { boundary_id: observed.boundaryID, proposal: proposal() });
  await hook(host, 'Stop', { prompt_id: promptID });
  const before = await host.selectorClient.request({ operation: 'snapshot' });
  assert.equal(before.selection_enabled, true);
  const selection = selectionFor(before, emitted.packet_id);

  const otherCwd = join(host.root, 'other-project');
  await mkdir(otherCwd, { mode: 0o700 });
  for (const fields of [{ session_id: randomUUID() }, { cwd: otherCwd }, { agent_id: randomUUID() }]) {
    await hook(host, 'UserPromptSubmit', { prompt: '관찰값이 없는 다른 호출', ...fields }, { expectedCode: 1 });
    const stillValid = await host.selectorClient.request({ operation: 'snapshot' });
    assert.equal(stillValid.selection_enabled, true, 'Unrelated native input cannot retire the authenticated session');
    assert.equal(stillValid.boundary_id, before.boundary_id);
    assert.deepEqual(stillValid.cards, before.cards);
  }

  // The same native session/cwd now reports ordinary new input without an
  // observed prompt ID. The Hook must not issue a fabricated replacement ID.
  await hook(host, 'UserPromptSubmit', { prompt: 'native prompt_id가 없는 새 사용자 입력' }, { expectedCode: 1 });
  const unavailable = await host.selectorClient.request({ operation: 'snapshot' });
  assert.equal(unavailable.ready, false, 'Lost native observation must require an independent readiness ACK again');
  assert.equal(unavailable.selection_enabled, false);
  assert.equal(unavailable.boundary_id, null, 'No fabricated prompt may create a replacement work boundary');
  assert.ok(unavailable.cards.every(card => card.binding.source_prompt_id === promptID),
    'Observation loss must not invent native source identifiers');
  await assert.rejects(host.selectorClient.request(selection));
});

test('native SessionEnd and launcher expiry revoke credentials without replacing an existing runtime', async t => {
  const ended = await fixture(t);
  await hook(ended, 'SessionStart', { source: 'startup' });
  const mcp = await startMCP(ended);
  await hook(ended, 'SessionEnd');
  assertRejected(await rawRequest(ended, envelope(ended, 'bridge', { operation: 'bridge.open' })), 'claude_session_unauthorized');
  await assert.rejects(ended.selectorClient.request({ operation: 'snapshot' }), { code: 'claude_session_unauthorized' });
  await mcp.close();
  await ended.close();
  let restarted;
  try {
    await assert.rejects(async () => { restarted = await startSharedRuntime(ended.config); },
      'A consumed runtime must not bootstrap new authority on restart');
  } finally { await restarted?.close(); }

  const expired = await fixture(t, { ttlMs: 300 });
  assert.equal((await expired.selectorClient.request({ operation: 'snapshot' })).cards.length, 0);
  await delay(400);
  assertRejected(await rawRequest(expired, envelope(expired, 'bridge', { operation: 'bridge.open' })), 'claude_session_unauthorized');
  await assert.rejects(expired.selectorClient.request({ operation: 'snapshot' }), { code: 'claude_session_unauthorized' });
});

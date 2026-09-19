import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { PROJECT_ROOT } from '../src/shared/identity.mjs';
import { createNativeSessionClient } from '../src/bridge/native-session-client.mjs';
import { productContext, safeProductErrorCode } from '../src/bridge/product-context.mjs';
import { handleProductHook, readProductHookInput, runProductHook } from '../src/bridge/product-hook.mjs';
import { createProductRequestQueue, runProductMCP } from '../src/bridge/product-mcp.mjs';
import { createProductToolHandler, PRODUCT_TOOL_DEFINITIONS, validateProductToolInput } from '../src/bridge/product-tools.mjs';

const waitUntil = async predicate => {
  const until = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() >= until) throw new Error('Product bridge test timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
async function fixtureEnvironment(t) {
  await mkdir(join(PROJECT_ROOT, 'build'), { recursive: true });
  const root = await realpath(await mkdtemp(join(PROJECT_ROOT, 'build/pb-')));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { BLABEE_CLAUDE_SHARED_SOCKET: join(root, 'core.sock'),
    BLABEE_CLAUDE_SHARED_RUNTIME_IDENTITY: `sha256:${'1'.repeat(64)}`,
    BLABEE_CLAUDE_SHARED_SCOPE_ID: randomUUID(), BLABEE_CLAUDE_SHARED_SESSION_ID: randomUUID(),
    BLABEE_CLAUDE_SHARED_CWD: root, BLABEE_CLAUDE_SHARED_HOOK_TOKEN: 'a'.repeat(64),
    BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN: 'b'.repeat(64) };
  return { root, env, mcpEnv: { ...env, BLABEE_CLAUDE_SHARED_HOOK_TOKEN: '' } };
}
function fullProposal() {
  return { proposal_id: randomUUID(), task_goal: '공통 Blabee 선택을 검증한다.',
    outcome: { status: 'partial', summary: '제안 준비를 마쳤다.' }, reported_side_effects: [],
    options: ['a', 'b'].map(id => ({ id, title: `선택 ${id}`, description: `${id} 설명`,
      task: `${id} 작업을 한다.`, done_when: `${id} 결과를 확인한다.`, constraints: ['선택된 작업만 실행한다.'] })) };
}

test('product context requires explicit native scope role credentials and canonical cwd', async t => {
  const { root, env, mcpEnv } = await fixtureEnvironment(t);
  assert.equal((await productContext('hook', { env })).configuration.authToken, env.BLABEE_CLAUDE_SHARED_HOOK_TOKEN);
  assert.equal((await productContext('bridge', { env: mcpEnv })).configuration.authToken, env.BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN);
  await assert.rejects(productContext('bridge', { env }), { code: 'unexpected_product_credential' });
  await assert.rejects(productContext('selector', { env: mcpEnv }), { code: 'invalid_product_role' });
  for (const field of ['BLABEE_CLAUDE_SHARED_SELECTOR_TOKEN', 'BLABEE_CLAUDE_SHARED_CONTROL_TOKEN']) {
    await assert.rejects(productContext('hook', { env: { ...env, [field]: 'c'.repeat(64) } }), { code: 'unexpected_product_credential' });
  }
  await assert.rejects(productContext('hook', { env: { ...env, BLABEE_CLAUDE_SHARED_HOOK_TOKEN: '',
    BLABEE_CLAUDE_SESSION_TOKEN: 'a'.repeat(64) } }), { code: 'missing_product_credential' });
  await assert.rejects(productContext('hook', { env, expectedSessionID: randomUUID() }), { code: 'session_mismatch' });
  const alias = join(root, 'alias');
  await symlink(root, alias);
  await assert.rejects(productContext('hook', { env: { ...env, BLABEE_CLAUDE_SHARED_CWD: alias } }), { code: 'invalid_product_cwd' });
  assert.equal(safeProductErrorCode({ code: 'unknown_private_text' }), 'product_bridge_unavailable');
});

test('product Hook forwards actual native IDs and hashes the original prompt without generating a boundary', async t => {
  const { root, env } = await fixtureEnvironment(t);
  const prompt_id = randomUUID();
  const boundary_id = randomUUID();
  const calls = [];
  let closes = 0;
  const createClient = async config => ({ request: async command => {
    assert.equal(config.role, 'hook');
    calls.push(command);
    if (command.event === 'SessionStart') return { boundary_id: null, prompt_id: null };
    if (command.event === 'SessionEnd') return { ended: true };
    return { boundary_id, prompt_id };
  }, close: async () => { closes++; } });
  const common = { session_id: env.BLABEE_CLAUDE_SHARED_SESSION_ID, cwd: root };
  const start = await handleProductHook({ ...common, hook_event_name: 'SessionStart', source: 'startup' }, { env, createClient });
  assert.match(start.hookSpecificOutput.additionalContext, /아직 유효한 작업 boundary가 없습니다/);
  const prompt = '원문 e\u0301\n🦭';
  const user = await handleProductHook({ ...common, hook_event_name: 'UserPromptSubmit', prompt_id, prompt }, { env, createClient });
  assert.match(user.hookSpecificOutput.additionalContext, new RegExp(`boundary_id=${boundary_id}`));
  assert.match(user.hookSpecificOutput.additionalContext, /claim_selection_v1/);
  assert.deepEqual(calls[1], { operation: 'hook', event: 'UserPromptSubmit', session_id_native: common.session_id,
    cwd: root, prompt_id, prompt_sha256: createHash('sha256').update(prompt, 'utf8').digest('hex') });
  assert.ok(!JSON.stringify(calls).includes(prompt));
  assert.equal(await handleProductHook({ ...common, hook_event_name: 'Stop', prompt_id }, { env, createClient }), null);
  assert.deepEqual(calls[2], { operation: 'hook', event: 'Stop', session_id_native: common.session_id, cwd: root, prompt_id });
  assert.equal(await handleProductHook({ ...common, hook_event_name: 'SessionEnd' }, { env, createClient }), null);
  assert.equal(closes, 4);
});

test('product Hook rejects untrusted sessions, subagents, cwd changes and resumed sessions before IPC', async t => {
  const { root, env } = await fixtureEnvironment(t);
  const input = { hook_event_name: 'UserPromptSubmit', session_id: env.BLABEE_CLAUDE_SHARED_SESSION_ID,
    cwd: root, prompt_id: randomUUID(), prompt: 'actual prompt' };
  let opened = 0;
  const createClient = async () => { opened++; throw new Error('must not open'); };
  for (const override of [{ session_id: randomUUID() }, { agent_id: 'subagent' }, { agent_type: 'worker' },
    { cwd: join(root, '.') + '/' },
    { hook_event_name: 'SessionStart', source: 'resume' }]) {
    await assert.rejects(handleProductHook({ ...input, ...override }, { env, createClient }));
  }
  assert.equal(opened, 0);
  await assert.rejects(readProductHookInput(Readable.from([Buffer.from([0x80])])), { code: 'invalid_hook_json' });
  await assert.rejects(readProductHookInput(Readable.from(['x'.repeat(30)]), { maxBytes: 20 }), { code: 'hook_input_too_large' });
  let stdout = ''; let stderr = '';
  const status = await runProductHook({ env, args: [], input: Readable.from([JSON.stringify(input)]),
    output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } },
    createClient: async () => { throw Object.assign(new Error('private value'), { code: 'a'.repeat(64) }); } });
  assert.equal(status, 1);
  assert.equal(stdout, '');
  assert.doesNotMatch(stderr, /private value|a{64}/);
});

test('product Hook sends scoped invalidation for trusted unavailable prompt observations without inventing IDs', async t => {
  const { root, env } = await fixtureEnvironment(t);
  const common = { hook_event_name: 'UserPromptSubmit', session_id: env.BLABEE_CLAUDE_SHARED_SESSION_ID,
    cwd: root, prompt_id: randomUUID(), prompt: 'actual prompt' };
  const cases = [
    [{ prompt_id: undefined }, 'invalid_prompt_id', 'invalid_native_prompt_id'],
    [{ prompt_id: 'invalid-native-id' }, 'invalid_prompt_id', 'invalid_native_prompt_id'],
    [{ hook_event_name: 'Stop', prompt_id: undefined }, 'invalid_prompt_id', 'invalid_native_prompt_id'],
    [{ hook_event_name: 'Stop', prompt_id: 'invalid-native-id' }, 'invalid_prompt_id', 'invalid_native_prompt_id'],
    [{ prompt: undefined }, 'invalid_prompt_text', 'invalid_native_prompt'],
    [{ prompt: '\ud800' }, 'invalid_prompt_text', 'invalid_native_prompt'],
  ];
  for (const [override, reason, code] of cases) {
    const calls = [];
    let closes = 0;
    const createClient = async configuration => ({ request: async command => {
      assert.equal(configuration.role, 'hook');
      calls.push(command);
      return { invalidated: true };
    }, close: async () => { closes++; } });
    await assert.rejects(handleProductHook({ ...common, ...override }, { env, createClient }), { code });
    assert.deepEqual(calls, [{ operation: 'hook', event: 'ObservationUnavailable',
      session_id_native: common.session_id, cwd: root, reason }]);
    assert.equal(closes, 1);
    assert.ok(!JSON.stringify(calls).includes(common.prompt_id));
    assert.ok(!JSON.stringify(calls).includes('invalid-native-id'));
  }
});

test('unavailable observation failure is not retried and untrusted malformed input cannot invalidate another session', async t => {
  const { root, env } = await fixtureEnvironment(t);
  const common = { hook_event_name: 'UserPromptSubmit', session_id: env.BLABEE_CLAUDE_SHARED_SESSION_ID,
    cwd: root, prompt_id: undefined, prompt: undefined };
  let attempts = 0; let closes = 0;
  const createClient = async () => ({ request: async () => {
    attempts++; throw Object.assign(new Error('private wire detail'), { code: 'product_core_response_unknown' });
  }, close: async () => { closes++; } });
  await assert.rejects(handleProductHook(common, { env, createClient }), { code: 'invalid_native_prompt_id' });
  assert.equal(attempts, 1); assert.equal(closes, 1);
  for (const override of [{ session_id: randomUUID() }, { cwd: '/' }, { agent_id: 'other-agent' }]) {
    await assert.rejects(handleProductHook({ ...common, ...override }, { env, createClient }));
  }
  assert.equal(attempts, 1);
  let stdout = ''; let stderr = '';
  assert.equal(await runProductHook({ env, args: [], input: Readable.from([JSON.stringify(common)]),
    output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } }, createClient }), 1);
  assert.equal(stdout, '');
  assert.match(stderr, /invalid_native_prompt_id/);
  assert.doesNotMatch(stderr, /private wire detail|a{64}|b{64}/);
});

test('product tool contract requires full outcomes side effects and option constraints without defaults', async () => {
  const args = { boundary_id: randomUUID(), proposal: fullProposal() };
  validateProductToolInput('emit_decision_v1', args);
  const schema = PRODUCT_TOOL_DEFINITIONS.find(tool => tool.name === 'emit_decision_v1').inputSchema;
  assert.deepEqual(schema.required, ['boundary_id', 'proposal']);
  assert.ok(schema.properties.proposal.required.includes('outcome'));
  assert.ok(schema.properties.proposal.properties.options.items.required.includes('constraints'));
  for (const field of ['outcome', 'reported_side_effects']) {
    const invalid = structuredClone(args); delete invalid.proposal[field];
    assert.throws(() => validateProductToolInput('emit_decision_v1', invalid));
  }
  const invalid = structuredClone(args); delete invalid.proposal.options[0].constraints;
  assert.throws(() => validateProductToolInput('emit_decision_v1', invalid));
  const before = structuredClone(args);
  const bridge_id = randomUUID();
  const calls = [];
  const handler = createProductToolHandler({ getBridgeID: () => bridge_id, request: async command => {
    calls.push(command); return { packet_id: `claude_packet_${randomUUID()}`, revision: 1 };
  } });
  assert.equal((await handler('emit_decision_v1', args)).isError, undefined);
  assert.deepEqual(args, before);
  assert.deepEqual(calls[0], { operation: 'proposal.emit', bridge_id, ...before });
  assert.equal((await handler('emit_decision_v1', invalid)).isError, true);
  assert.equal(calls.length, 1);
});

test('product tools accept action DTOs and suppress malformed or secret-bearing readiness results', async () => {
  const selection_id = randomUUID();
  const action = fullProposal().options[0];
  const handler = createProductToolHandler({ getBridgeID: () => randomUUID(), request: async () => ({}) });
  assert.equal((await handler('claim_selection_v1', { selection_id, delivery_token: 'c'.repeat(64) })).isError, true);
  const bridge_id = randomUUID();
  const valid = createProductToolHandler({ getBridgeID: () => bridge_id, request: async command => {
    if (command.operation === 'selection.claim') return { selection_id, boundary_id: randomUUID(), prompt_id: randomUUID(), action };
    return { probe_id: randomUUID(), nonce: 'c'.repeat(64), expires_at: Date.now() + 30_000, status: 'awaiting_ack' };
  } });
  const claim = await valid('claim_selection_v1', { selection_id, delivery_token: 'c'.repeat(64) });
  assert.deepEqual(JSON.parse(claim.content[0].text).result.action, action);
  const begin = await valid('check_connection_v1', {});
  assert.equal(begin.isError, true);
  assert.doesNotMatch(JSON.stringify(begin), /c{64}/);
});

test('versioned side-effect kinds satisfy the common Pet stable-code contract before IPC', async () => {
  const schema = PRODUCT_TOOL_DEFINITIONS.find(tool => tool.name === 'emit_decision_v1').inputSchema;
  const kindSchema = schema.properties.proposal.properties.reported_side_effects.items.properties.kind;
  assert.equal(kindSchema.pattern, '^[a-z][a-z0-9_]{0,63}$');
  assert.equal(kindSchema.maxLength, 64);
  const bridge_id = randomUUID();
  let calls = 0;
  const handler = createProductToolHandler({ getBridgeID: () => bridge_id, request: async () => {
    calls++; return { packet_id: `claude_packet_${randomUUID()}`, revision: 1 };
  } });
  const args = kind => ({ boundary_id: randomUUID(), proposal: { ...fullProposal(),
    reported_side_effects: [{ kind, summary: 'The selected file was changed.', reversibility: 'reversible' }] } });
  for (const kind of ['file_change', 'a', 'a'.repeat(64)]) {
    const value = args(kind);
    validateProductToolInput('emit_decision_v1', value);
    assert.equal((await handler('emit_decision_v1', value)).isError, undefined);
  }
  assert.equal(calls, 3);
  for (const kind of ['file-change', 'File_change', '1file_change', 'file_change\n', '', 'a'.repeat(65), 12]) {
    const value = args(kind);
    assert.throws(() => validateProductToolInput('emit_decision_v1', value), { code: 'invalid_reported_side_effects' });
    const result = await handler('emit_decision_v1', value);
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'invalid_reported_side_effects');
  }
  assert.equal(calls, 3);
});

async function mcpFixture(t, custom) {
  const { env, mcpEnv } = await fixtureEnvironment(t);
  const bridge_id = randomUUID();
  const input = new PassThrough();
  const output = new PassThrough();
  const calls = [];
  const messages = [];
  let stderr = ''; let buffer = ''; let inFlight = 0; let maxInFlight = 0;
  const configuration = [];
  output.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      messages.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1);
    }
  });
  const signalsBefore = process.listenerCount('SIGTERM');
  const bridge = await runProductMCP({ env: mcpEnv, args: [], input, output, pollIntervalMs: 20,
    errorOutput: { write: value => { stderr += value; } }, createClient: async config => {
      configuration.push(config);
      return { request: async command => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); calls.push(command);
        try {
          const value = await custom?.(command, { bridge_id });
          if (value !== undefined) return value;
          if (command.operation === 'bridge.open') return { bridge_id };
          if (command.operation === 'bridge.poll') return { event: null };
          if (command.operation === 'bridge.close') return { closed: true };
          throw new Error('Unexpected mock operation');
        } finally { inFlight--; }
      }, close: async () => {} };
    } });
  t.after(async () => { await bridge.close(); input.destroy(); output.destroy(); });
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const reply = async id => { await waitUntil(() => messages.some(message => message.id === id)); return messages.find(message => message.id === id); };
  const initialize = async (finish = true) => {
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'product-unit-test', version: '1' } } });
    const result = (await reply(1)).result;
    if (finish) send({ method: 'notifications/initialized' });
    return result;
  };
  const call = async (id, name, args) => {
    send({ id, method: 'tools/call', params: { name, ...(args === undefined ? {} : { arguments: args }) } });
    return (await reply(id)).result;
  };
  return { env, bridge_id, bridge, input, messages, calls, configuration, signalsBefore, send, reply, initialize,
    call, stderr: () => stderr, maxInFlight: () => maxInFlight };
}

test('product MCP registers only after initialize and advertises only explicit versioned tools', async t => {
  const f = await mcpFixture(t);
  f.send({ method: 'notifications/initialized' });
  assert.match((await f.call(10, 'check_connection_v1', {})).content[0].text, /bridge_not_registered/);
  assert.equal(f.calls.length, 0);
  const initialized = await f.initialize(false);
  assert.equal(initialized.serverInfo.version, '0.2.0');
  assert.deepEqual(initialized.capabilities.experimental, { 'claude/channel': {} });
  f.send({ method: 'notifications/initialized' });
  f.send({ method: 'notifications/initialized' });
  await waitUntil(() => f.calls.some(call => call.operation === 'bridge.poll'));
  f.send({ id: 2, method: 'tools/list', params: {} });
  assert.deepEqual((await f.reply(2)).result.tools.map(tool => tool.name),
    ['check_connection_v1', 'ack_readiness_probe_v1', 'emit_decision_v1', 'claim_selection_v1', 'complete_selection_v1']);
  assert.equal(f.calls.filter(call => call.operation === 'bridge.open').length, 1);
  assert.ok(f.calls.filter(call => call.operation === 'bridge.poll').every(call => call.bridge_id === f.bridge_id));
  assert.ok(f.configuration.every(config => config.role === 'bridge' && config.authToken === f.env.BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN));
  await f.bridge.close();
  assert.equal(f.calls.filter(call => call.operation === 'bridge.close').length, 1);
  assert.equal(process.listenerCount('SIGTERM'), f.signalsBefore);
});

test('product MCP forwards exact Channel content and never generates readiness ACK or claim', async t => {
  const probe_id = randomUUID();
  const nonce = 'c'.repeat(64);
  const selection_id = randomUUID();
  const delivery_token = 'd'.repeat(64);
  const content = 'EXACT server content\n  preserve spaces\n';
  let pending;
  let acknowledged = false;
  const f = await mcpFixture(t, async command => {
    if (command.operation === 'readiness.begin') {
      pending = { kind: 'readiness_probe', probe_id, nonce, expires_at: Date.now() + 30_000, content };
      return { probe_id, expires_at: pending.expires_at, status: 'awaiting_ack' };
    }
    if (command.operation === 'bridge.poll') return { event: pending ?? null };
    if (command.operation === 'readiness.ack') {
      assert.equal(command.probe_id, probe_id); assert.equal(command.nonce, nonce);
      acknowledged = true;
      pending = { kind: 'selection', selection_id, delivery_token, content: 'EXACT selection from server\n' };
      return { ready: true, expires_at: Date.now() + 30_000 };
    }
  });
  await f.initialize();
  await waitUntil(() => f.calls.some(call => call.operation === 'bridge.poll'));
  const begin = await f.call(2, 'check_connection_v1');
  assert.equal(begin.isError, undefined);
  assert.doesNotMatch(JSON.stringify(begin), /c{64}|nonce/);
  await waitUntil(() => f.messages.some(message => message.method === 'notifications/claude/channel'));
  const notification = f.messages.find(message => message.method === 'notifications/claude/channel');
  assert.equal(notification.params.content, content);
  assert.deepEqual(notification.params.meta, { kind: 'readiness_probe', probe_id });
  assert.equal(acknowledged, false);
  assert.equal(f.calls.filter(call => call.operation === 'readiness.ack').length, 0);
  assert.equal((await f.call(3, 'ack_readiness_probe_v1', { probe_id, nonce })).isError, undefined);
  await waitUntil(() => f.messages.some(message => message.params?.meta?.selection_id === selection_id));
  assert.equal(f.messages.find(message => message.params?.meta?.selection_id === selection_id).params.content, pending.content);
  assert.equal(f.calls.filter(call => call.operation === 'selection.claim').length, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(f.messages.filter(message => message.method === 'notifications/claude/channel').length, 2);
  assert.equal(f.maxInFlight(), 1);
  assert.doesNotMatch(f.stderr() + JSON.stringify(f.messages), /a{64}|b{64}/);
});

test('product MCP shutdown waits for owned requests and closes a late registration without polling', async t => {
  let resolveOpen;
  const f = await mcpFixture(t, async (command, { bridge_id }) => {
    if (command.operation === 'bridge.open') return new Promise(resolve => { resolveOpen = () => resolve({ bridge_id }); });
  });
  await f.initialize();
  await waitUntil(() => resolveOpen);
  let closed = false;
  const closing = f.bridge.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  resolveOpen();
  await closing;
  assert.deepEqual(f.calls.map(call => call.operation), ['bridge.open', 'bridge.close']);
  assert.equal(f.maxInFlight(), 1);
  assert.equal(f.messages.filter(message => message.method === 'notifications/claude/channel').length, 0);
});

test('product request FIFO prevents polling from overlapping or bypassing an already queued tool', async () => {
  const calls = [];
  const resolvers = [];
  const queue = createProductRequestQueue({ request: command => new Promise(resolve => { calls.push(command.operation); resolvers.push(resolve); }) });
  const poll = queue.request({ operation: 'bridge.poll' });
  const tool = queue.request({ operation: 'proposal.emit' });
  const nextPoll = queue.request({ operation: 'bridge.poll' });
  await waitUntil(() => resolvers.length === 1);
  assert.deepEqual(calls, ['bridge.poll']); resolvers[0]({ event: null }); await poll;
  await waitUntil(() => resolvers.length === 2);
  assert.deepEqual(calls, ['bridge.poll', 'proposal.emit']); resolvers[1]({ packet_id: 'opaque', revision: 1 }); await tool;
  await waitUntil(() => resolvers.length === 3);
  resolvers[2]({ event: null }); await nextPoll;
  queue.stop(); await queue.drain();
  await assert.rejects(queue.request({ operation: 'bridge.poll' }), { code: 'product_bridge_closed' });
});

test('native client uses its distinct versioned endpoint and refuses lost mutation replay', async t => {
  const { env, mcpEnv } = await fixtureEnvironment(t);
  const context = await productContext('bridge', { env: mcpEnv });
  const requests = [];
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.split('\n')[0]); requests.push(request);
      if (request.payload.request.operation === 'selection.claim') return;
      socket.end(JSON.stringify({ request_id: request.request_id, runtime_identity: request.runtime_identity, ok: true,
        result: { schema_version: 'blabee.claude-session.v1', provider: 'claude', scope_id: request.payload.scope_id,
          session_id: request.payload.session_id, role: 'bridge', request_id: request.payload.request.request_id,
          ok: true, result: { bridge_id: randomUUID() } } }) + '\n');
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(env.BLABEE_CLAUDE_SHARED_SOCKET, resolve); });
  await chmod(env.BLABEE_CLAUDE_SHARED_SOCKET, 0o600);
  const client = await createNativeSessionClient({ ...context.configuration, timeoutMs: 100 });
  t.after(async () => { await client.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  await client.request({ operation: 'bridge.open' });
  assert.equal(requests[0].type, 'blabee.runtime-identity.v1/claude_session_v1');
  assert.equal(requests[0].payload.schema_version, 'blabee.claude-session.v1');
  assert.equal(requests[0].payload.request.schema_version, '1.0');
  await assert.rejects(client.request({ operation: 'selection.claim' }), { code: 'product_core_response_unknown' });
  await assert.rejects(client.request({ operation: 'selection.claim' }), { code: 'product_core_response_unknown' });
  assert.equal(requests.length, 2);
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { handleHook, readHookInput, runHook } from '../../../../dev/claude-standalone/src/bridge/hook.mjs';
import { BridgeInputError, sessionBinding } from '../../../../dev/claude-standalone/src/bridge/context.mjs';
import { promptSHA256, selectionChannelContent, selectionChannelPrompt } from '../../../../dev/claude-standalone/src/shared/channel.mjs';
import { TOOL_DEFINITIONS, createToolHandler, readinessNotification, selectionNotification, startSelectionPolling } from '../../../../dev/claude-standalone/src/bridge/tools.mjs';

const session_id = randomUUID();
const prompt_id = randomUUID();
const boundary_id = randomUUID();
const bridge_id = randomUUID();
const env = { BLABEE_CLAUDE_SESSION_ID: session_id, BLABEE_CLAUDE_SESSION_TOKEN: 'a'.repeat(64), BLABEE_CLAUDE_RUNTIME: '/tmp/blabee-claude-bridge-test' };
const bridgeOptions = { env, getBridgeID: () => bridge_id };
const hook = (event = 'UserPromptSubmit') => ({ hook_event_name: event, session_id, prompt_id, cwd: '/work/project', prompt: 'private prompt not forwarded', transcript_path: '/private/transcript' });
const options = ['a', 'b'].map(id => ({ id, title: `작업 ${id}`, description: '변경 범위 설명', task: `현재 프로젝트의 ${id}를 조사한다`, done_when: '근거를 확인해 보고한다' }));
const proposal = () => ({ boundary_id, summary: '조사 완료', options: structuredClone(options) });

test('Hook normalizes only bound fields and includes authenticated fresh boundary', async () => {
  let call;
  const output = await handleHook(hook(), { env, expectedSessionID: session_id, ipc: async (...args) => { call = args; return { boundary_id, prompt_id }; } });
  assert.deepEqual(call, ['hook', { session_id, session_id_native: session_id, event: 'UserPromptSubmit', cwd: '/work/project', prompt_id, prompt_sha256: promptSHA256(hook().prompt) }, { auth: env.BLABEE_CLAUDE_SESSION_TOKEN, runtime: env.BLABEE_CLAUDE_RUNTIME }]);
  assert.match(output.hookSpecificOutput.additionalContext, new RegExp(boundary_id));
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.doesNotMatch(JSON.stringify(output), /private prompt|transcript|a{64}|permissionDecision/);
  assert.ok(!JSON.stringify(output).includes(call[1].prompt_sha256));
  assert.ok(!JSON.stringify(call[1]).includes(hook().prompt));
});

test('Hook hashes only the complete UserPromptSubmit string without forwarding raw content or caller digests', async () => {
  const calls = [];
  const ipc = async (...args) => { calls.push(args); return { boundary_id, prompt_id }; };
  const event = { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) };
  const prompt = ` ${selectionChannelPrompt(event)}\n`;
  const output = await handleHook({ ...hook(), prompt, prompt_sha256: 'f'.repeat(64) }, { env, ipc });
  assert.equal(calls[0][1].prompt_sha256, promptSHA256(prompt));
  assert.notEqual(calls[0][1].prompt_sha256, promptSHA256(prompt.trim()));
  assert.doesNotMatch(JSON.stringify(calls[0][1]) + JSON.stringify(output), /d{64}|<channel|f{64}/);
  for (const prompt of [undefined, null, { content: 'not a native string' }]) {
    await handleHook({ ...hook(), prompt, prompt_sha256: 'f'.repeat(64) }, { env, ipc });
    assert.equal(Object.hasOwn(calls.at(-1)[1], 'prompt_sha256'), false);
  }
  for (const event of ['SessionStart', 'Stop', 'SessionEnd']) {
    await handleHook(hook(event), { env, ipc });
    assert.equal(Object.hasOwn(calls.at(-1)[1], 'prompt_sha256'), false);
  }
  assert.equal(promptSHA256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(promptSHA256('한글\n'), promptSHA256('한글'));
});

test('SessionStart without native prompt has no invented boundary; Stop and SessionEnd never block', async () => {
  const start = hook('SessionStart');
  delete start.prompt_id;
  const output = await handleHook(start, { env, ipc: async () => ({ boundary_id: null, prompt_id: null }) });
  assert.match(output.hookSpecificOutput.additionalContext, /아직 유효한 작업 boundary가 없습니다/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /boundary_id=/);
  for (const event of ['Stop', 'SessionEnd']) assert.equal(await handleHook(hook(event), { env, ipc: async () => ({ boundary_id, prompt_id }) }), null);
});

test('Hook rejects wrong session, missing prompt, subagent and relative cwd before IPC', async () => {
  let calls = 0;
  for (const invalid of [{ ...hook(), session_id: randomUUID() }, { ...hook(), prompt_id: undefined }, { ...hook(), agent_id: 'child' }, { ...hook(), cwd: 'relative' }, { ...hook(), hook_event_name: 'PermissionRequest' }]) {
    await assert.rejects(handleHook(invalid, { env, ipc: async () => { calls++; } }), BridgeInputError);
  }
  assert.equal(calls, 0);
  assert.throws(() => sessionBinding(env, randomUUID()), /session_mismatch/);
  assert.throws(() => sessionBinding({ ...env, BLABEE_CLAUDE_SESSION_TOKEN: '' }), /missing_session_token/);
  assert.throws(() => sessionBinding({ ...env, BLABEE_CLAUDE_RUNTIME: undefined }), /missing_claude_runtime/);
});

test('Hook transport failure emits no stdout binding and no secret diagnostics', async () => {
  let stdout = ''; let stderr = '';
  const exit = await runHook({ env, args: [], input: Readable.from([JSON.stringify(hook())]), output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } }, ipc: async () => { throw Object.assign(new Error(env.BLABEE_CLAUDE_SESSION_TOKEN), { code: 'ECONNREFUSED' }); } });
  assert.equal(exit, 0);
  assert.equal(stdout, '');
  assert.match(stderr, /ECONNREFUSED/);
  assert.doesNotMatch(stderr, /a{64}/);
});

test('Hook refuses malformed input and coordinator response instead of fake success', async () => {
  await assert.rejects(handleHook(hook(), { env, ipc: async () => ({}) }), /missing_boundary_response/);
  await assert.rejects(readHookInput(Readable.from(['{'])), /invalid_hook_json/);
  await assert.rejects(readHookInput(Readable.from(['12345']), { maxBytes: 4 }), /hook_input_too_large/);
  const input = new PassThrough();
  await assert.rejects(readHookInput(input, { timeout: 10 }), /hook_input_timeout/);
  input.destroy();
});

test('Hook coordinator rejection returns visible nonblocking failure without valid context', async () => {
  let stdout = '';
  const exit = await runHook({ env, args: [], input: Readable.from([JSON.stringify(hook())]), output: { write: value => { stdout += value; } }, errorOutput: { write: () => {} }, ipc: async () => { throw Object.assign(new Error('not current'), { code: 'stale_prompt' }); } });
  assert.equal(exit, 1);
  assert.equal(stdout, '');
});

test('MCP tools bind session server-side and forward only validated arguments', async () => {
  const calls = [];
  const handler = createToolHandler({ ...bridgeOptions, ipc: async (...args) => { calls.push(args); return { packet_id: randomUUID(), revision: 1 }; } });
  assert.equal((await handler('emit_decision', proposal())).isError, undefined);
  assert.equal(calls[0][0], 'proposal.emit');
  assert.equal(calls[0][1].session_id, session_id);
  assert.equal(calls[0][1].bridge_id, bridge_id);
  assert.equal(calls[0][2].auth, env.BLABEE_CLAUDE_SESSION_TOKEN);
  assert.equal((await handler('emit_decision', { ...proposal(), session_id: randomUUID() })).isError, true);
  assert.equal((await handler('emit_decision', { ...proposal(), bridge_id: randomUUID() })).isError, true);
  assert.equal((await handler('emit_decision', { ...proposal(), options: [options[0], options[0]] })).isError, true);
  assert.equal((await handler('emit_decision', { ...proposal(), summary: '가'.repeat(171) })).isError, true);
  assert.equal((await handler('permission_allow', {})).isError, true);
  assert.equal(calls.length, 1);
  assert.ok(TOOL_DEFINITIONS.every(tool => tool.inputSchema.additionalProperties === false));
});

test('claim and completion require exact refs, never take caller task or authentication', async () => {
  const calls = [];
  const handler = createToolHandler({ ...bridgeOptions, ipc: async (...args) => { calls.push(args); return args[0] === 'selection.complete' ? { recorded: true, reported_by: 'model' } : { selection_id: args[1].selection_id, task: 'stored task', done_when: 'stored outcome', boundary_id, prompt_id }; } });
  const selection_id = randomUUID();
  const claim = { selection_id, delivery_token: 'd'.repeat(64) };
  const result = await handler('claim_selection', claim);
  assert.equal(JSON.parse(result.content[0].text).result.task, 'stored task');
  assert.equal((await handler('claim_selection', { ...claim, task: 'injected' })).isError, true);
  assert.equal((await handler('complete_selection', { selection_id, outcome: 'completed', note: '직접 실행 결과 확인' })).isError, undefined);
  assert.equal(calls[1][0], 'selection.complete');
  assert.equal((await handler('complete_selection', { selection_id, outcome: 'queued', note: 'not proof' })).isError, true);
});

test('coordinator rejection is MCP error and never leaks authentication', async () => {
  const handler = createToolHandler({ ...bridgeOptions, ipc: async () => { throw Object.assign(new Error('a'.repeat(64)), { code: 'stale_boundary' }); } });
  const result = await handler('emit_decision', proposal());
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /stale_boundary/);
  assert.doesNotMatch(result.content[0].text, /a{64}/);
});

test('malformed or cross-selection claim result is never treated as successful authorization', async () => {
  const handler = createToolHandler({ ...bridgeOptions, ipc: async () => ({ selection_id: randomUUID(), task: 'wrong task', done_when: 'wrong result', boundary_id, prompt_id }) });
  const result = await handler('claim_selection', { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /invalid_claim_response/);
  assert.doesNotMatch(result.content[0].text, /wrong task/);
});

test('channel notification accepts only opaque refs, excludes task payload and permission relay', () => {
  const event = { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) };
  const notification = selectionNotification(event);
  assert.equal(notification.method, 'notifications/claude/channel');
  assert.match(notification.params.content, /claim_selection/);
  assert.match(notification.params.content, new RegExp(event.selection_id));
  assert.equal(notification.params.content, selectionChannelContent(event));
  assert.equal(selectionChannelPrompt(event), `<channel source="blabee-claude" selection_id="${event.selection_id}">\n${notification.params.content}\n</channel>`);
  assert.deepEqual(notification.params.meta, { selection_id: event.selection_id });
  assert.throws(() => selectionNotification({ ...event, task: 'unsafe replacement' }), /invalid_tool_fields/);
});

test('poll does not replay a notification on send failure or overlapping polls', async () => {
  const event = { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) };
  let polls = 0; let notifications = 0; let active = 0; let maxActive = 0;
  let finish;
  const enoughPolls = new Promise(resolve => { finish = resolve; });
  const stop = startSelectionPolling({ env, bridgeID: bridge_id, intervalMs: 20, ipc: async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active--; polls++;
    if (polls === 3) finish();
    return { event };
  }, notify: async () => { notifications++; throw new Error('write failed'); } });
  await enoughPolls;
  stop();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(notifications, 1);
  assert.equal(maxActive, 1);
  assert.equal(polls, 3);
});

test('stopping during pending IPC suppresses channel delivery', async () => {
  let finish; let notifications = 0;
  const stop = startSelectionPolling({ env, bridgeID: bridge_id, ipc: () => new Promise(resolve => { finish = resolve; }), notify: async () => { notifications++; } });
  stop();
  finish({ event: { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications, 0);
});

test('tools cannot operate without a current bridge registration or after it is cleared', async () => {
  let calls = 0;
  const handler = createToolHandler({ env, ipc: async () => { calls++; } });
  assert.match((await handler('check_connection', {})).content[0].text, /bridge_not_registered/);
  assert.equal(calls, 0);
  assert.throws(() => startSelectionPolling({ env, notify: async () => {} }), /bridge_not_registered/);
  let current = bridge_id;
  const pending = createToolHandler({ env, getBridgeID: () => current, ipc: async () => {
    current = undefined;
    return { probe_id: randomUUID(), expires_at: Date.now() + 30_000, status: 'awaiting_ack' };
  } });
  assert.match((await pending('check_connection', {})).content[0].text, /bridge_not_registered/);
});

test('readiness tools bind the registration and start without exposing a nonce or executing work', async () => {
  const calls = [];
  const probe_id = randomUUID();
  const nonce = 'b'.repeat(64);
  const expires_at = Date.now() + 30_000;
  const handler = createToolHandler({ ...bridgeOptions, ipc: async (...args) => {
    calls.push(args);
    return args[0] === 'readiness.begin' ? { probe_id, expires_at, status: 'awaiting_ack' } : { ready: true, expires_at };
  } });
  const begin = await handler('check_connection', {});
  assert.deepEqual(JSON.parse(begin.content[0].text), { ok: true, result: { probe_id, expires_at, status: 'awaiting_ack' } });
  assert.deepEqual(calls[0], ['readiness.begin', { session_id, bridge_id }, { auth: env.BLABEE_CLAUDE_SESSION_TOKEN, runtime: env.BLABEE_CLAUDE_RUNTIME }]);
  assert.doesNotMatch(begin.content[0].text, /nonce|"ready":true|task|selection_id|a{64}/);
  assert.equal((await handler('ack_readiness_probe', { probe_id, nonce })).isError, undefined);
  assert.deepEqual(calls[1][1], { probe_id, nonce, session_id, bridge_id });
  for (const invalid of [{ probe_id, nonce, session_id }, { probe_id, nonce, bridge_id }, { probe_id, nonce, task: 'injected' }, { probe_id, nonce: 'wrong' }, { probe_id: 'invalid', nonce }]) {
    assert.equal((await handler('ack_readiness_probe', invalid)).isError, true);
  }
  assert.equal((await handler('check_connection', { probe_id })).isError, true);
  assert.equal(calls.length, 2);
});

test('malformed, stale or secret-bearing readiness responses never claim success', async () => {
  const probe_id = randomUUID();
  const nonce = 'b'.repeat(64);
  const expires_at = Date.now() + 30_000;
  const invalidBegins = [null, {}, { probe_id, expires_at, status: 'ready' }, { probe_id, expires_at: Date.now() - 1, status: 'awaiting_ack' }, { probe_id, expires_at, status: 'awaiting_ack', nonce }];
  const invalidAcks = [null, {}, { ready: false, expires_at }, { ready: true, expires_at: Date.now() - 1 }, { ready: true, expires_at: String(expires_at) }, { ready: true, expires_at, nonce }];
  for (const [name, args, values] of [['check_connection', {}, invalidBegins], ['ack_readiness_probe', { probe_id, nonce }, invalidAcks]]) {
    for (const result of values) {
      const handler = createToolHandler({ ...bridgeOptions, ipc: async () => result });
      const output = await handler(name, args);
      assert.equal(output.isError, true);
      assert.match(output.content[0].text, /invalid_readiness_response/);
      assert.doesNotMatch(output.content[0].text, /b{64}|a{64}/);
    }
  }
  for (const code of ['probe_expired', 'invalid_probe', nonce, `invalid_${nonce}`]) {
    const handler = createToolHandler({ ...bridgeOptions, ipc: async () => { throw Object.assign(new Error(nonce), { code }); } });
    const output = await handler('ack_readiness_probe', { probe_id, nonce });
    assert.equal(output.isError, true);
    assert.doesNotMatch(output.content[0].text, /b{64}|a{64}/);
  }
});

test('readiness notification carries only its reply reference and rejects expired or extra fields', () => {
  const event = { kind: 'readiness_probe', probe_id: randomUUID(), nonce: 'b'.repeat(64), expires_at: Date.now() + 30_000 };
  const notification = readinessNotification(event);
  assert.equal(notification.method, 'notifications/claude/channel');
  assert.deepEqual(notification.params.meta, { kind: 'readiness_probe', probe_id: event.probe_id });
  assert.match(notification.params.content, /ack_readiness_probe/);
  assert.deepEqual(JSON.parse(notification.params.content.split('\n').at(-1)), { probe_id: event.probe_id, nonce: event.nonce });
  assert.doesNotMatch(JSON.stringify(notification), /selection_id|claim_selection|permission_request|task|a{64}/);
  for (const invalid of [{ ...event, task: 'execute' }, { ...event, kind: 'selection' }, { ...event, expires_at: Date.now() - 1 }, { ...event, nonce: 'wrong' }]) {
    assert.throws(() => readinessNotification(invalid), /invalid_readiness_event/);
  }
});

test('poll validates responses, never acknowledges probes, and sends each probe at most once', async () => {
  const event = { kind: 'readiness_probe', probe_id: randomUUID(), nonce: 'b'.repeat(64), expires_at: Date.now() + 30_000 };
  const responses = [{ event, auth: env.BLABEE_CLAUDE_SESSION_TOKEN }, {}, { event: { ...event, task: 'injected' } }, { event }, { event }, { event: null }];
  const calls = []; const errors = []; const notifications = [];
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const stop = startSelectionPolling({ env, bridgeID: bridge_id, intervalMs: 20, ipc: async (...args) => {
    calls.push(args);
    const result = responses.shift();
    if (!responses.length) finish();
    return result;
  }, notify: async message => { notifications.push(message); throw Object.assign(new Error(event.nonce), { code: event.nonce }); }, onError: code => errors.push(code) });
  await completed;
  stop();
  assert.equal(notifications.length, 1);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(([type, payload]) => type === 'bridge.poll' && payload.session_id === session_id && payload.bridge_id === bridge_id));
  assert.deepEqual(errors, ['invalid_poll_response', 'invalid_readiness_event', 'bridge_unavailable']);
});

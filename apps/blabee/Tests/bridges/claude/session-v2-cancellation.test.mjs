import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';
import { createSessionV2RequestQueue, runSessionV2MCP } from '../../../bridges/claude/src/session-v2-mcp.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('cancellation fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function sdkFixture(t, { openGate, pollGate, completionGate } = {}) {
  const cwd = await realpath(await mkdtemp('/private/tmp/blabee-v2cancel-'));
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const prefix = 'BLABEE_CLAUDE_SESSION_V2_';
  const env = { [prefix + 'SOCKET']: join(cwd, 'unused.sock'), [prefix + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`,
    [prefix + 'CWD']: cwd, [prefix + 'CHANNEL_SOURCE']: 'blabee-claude', [prefix + 'BRIDGE_TOKEN']: 'b'.repeat(64),
    ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [prefix + key.toUpperCase(), value])) };
  const input = new PassThrough(); const output = new PassThrough();
  const messages = []; const calls = [];
  let buffer = ''; let active = 0; let maximumActive = 0; let clientCloses = 0; let runtime; let diagnostics = '';
  const bridgeID = randomUUID();
  output.on('data', data => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1);
    }
  });
  t.after(async () => {
    openGate?.resolve(); pollGate?.resolve(); completionGate?.resolve();
    await runtime?.close(); input.destroy(); output.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  const perform = async (command, envelope) => {
    calls.push(command.operation); active++; maximumActive = Math.max(maximumActive, active);
    try {
      if (command.operation === 'bridge.open') { await openGate?.promise; return { bridge_id: bridgeID }; }
      if (command.operation === 'bridge.close') return { closed: true };
      if (command.operation === 'bridge.poll') {
        await pollGate?.promise;
        const { payload, ...common } = envelope;
        return { ...common, kind: 'response', ok: true, result: { event: null } };
      }
      if (command.operation === 'readiness.begin') {
        return { probe_id: randomUUID(), nonce: 'c'.repeat(64), expires_at_nanoseconds: '300000000000', status: 'pending' };
      }
      if (command.operation === 'selection.complete') {
        await completionGate?.promise;
        return { selection_id: command.selection_id, recorded: true, reported_by: 'claude' };
      }
      throw new Error('unexpected service operation in cancellation fixture');
    } finally { active--; }
  };
  runtime = await runSessionV2MCP({ env, args: [], input, output, errorOutput: { write: value => { diagnostics += value; } },
    createClient: async () => ({ request: command => perform(command),
      exchange: envelope => perform({ operation: envelope.operation, ...envelope.payload }, envelope),
      close: async () => { clientCloses++; } }) });
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const reply = async id => { await until(() => messages.some(value => value.id === id)); return messages.find(value => value.id === id); };
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'cancellation-fixture', version: '1' } } });
  await reply(1);
  send({ method: 'notifications/initialized' });
  const call = (id, name, args) => send({ id, method: 'tools/call', params: { name, arguments: args } });
  const cancel = async id => {
    send({ method: 'notifications/cancelled', params: { requestId: id, reason: 'PRIVATE_CANCEL_REASON' } });
    await turn();
  };
  return { runtime, input, calls, messages, reply, call, cancel,
    diagnostics: () => diagnostics,
    state: () => ({ active, maximumActive, clientCloses }) };
}

const proposal = () => ({ proposal_id: randomUUID(), task_goal: 'Fixture goal',
  outcome: { status: 'completed', summary: 'Fixture summary' }, reported_side_effects: [],
  options: ['A', 'B'].map(id => ({ id, title: id, description: `Option ${id}`, task: `Task ${id}`,
    done_when: 'Report the fixture result.', constraints: [] })) });
const tools = [
  ['check_connection_v1', 'readiness.begin', () => ({})],
  ['ack_readiness_probe_v1', 'readiness.ack', () => ({ probe_id: randomUUID(), nonce: 'c'.repeat(64) })],
  ['emit_decision_v1', 'proposal.emit', () => ({ boundary_id: randomUUID(), proposal: proposal() })],
  ['claim_selection_v1', 'selection.claim', () => ({ selection_id: randomUUID(), delivery_token: 'd'.repeat(64) })],
  ['complete_selection_v1', 'selection.complete', () => ({ selection_id: randomUUID(), outcome: 'completed', note: 'Fixture report.' })],
];

for (const [name, operation, args] of tools) test(`SDK cancellation before dispatch prevents ${operation} without closing the bridge`, async t => {
  const pollGate = deferred();
  const f = await sdkFixture(t, { pollGate });
  await until(() => f.calls.includes('bridge.poll'));
  f.call(2, name, args());
  await until(() => f.runtime.session.snapshot().queue.pending === 2);
  assert.equal(f.calls.includes(operation), false);
  await f.cancel(2);
  await until(() => f.runtime.session.snapshot().pendingTools === 0);
  assert.equal(f.runtime.session.snapshot().queue.pending, 1, 'only the held poll retains an RPC slot');
  assert.equal(f.state().active, 1, 'cancellation settles before the active poll is released');
  assert.equal(f.calls.filter(value => value === operation).length, 0);
  assert.equal(f.messages.some(value => value.id === 2), false);
  assert.equal(f.state().clientCloses, 0);
  assert.equal(f.runtime.session.snapshot().registered, true);
  f.call(3, 'check_connection_v1', {});
  pollGate.resolve();
  assert.equal(JSON.parse((await f.reply(3)).result.content[0].text).ok, true);
  assert.equal(f.state().maximumActive, 1);
  assert.doesNotMatch(JSON.stringify(f.messages), /PRIVATE_CANCEL_REASON/);
});

test('SDK cancellation while bridge.open is pending never dispatches the waiting tool', async t => {
  const openGate = deferred();
  const f = await sdkFixture(t, { openGate });
  await until(() => f.calls.includes('bridge.open'));
  f.call(2, 'complete_selection_v1', { selection_id: randomUUID(), outcome: 'completed', note: 'Fixture report.' });
  await until(() => f.runtime.session.snapshot().pendingTools === 1);
  await f.cancel(2);
  await until(() => f.runtime.session.snapshot().pendingTools === 0);
  assert.equal(f.runtime.session.snapshot().queue.pending, 1, 'the in-flight bridge.open still owns its RPC slot');
  assert.equal(f.state().clientCloses, 0);
  assert.equal(f.calls.includes('selection.complete'), false);
  f.call(3, 'check_connection_v1', {});
  await until(() => f.runtime.session.snapshot().pendingTools === 1);
  assert.equal(f.calls.includes('readiness.begin'), false);
  openGate.resolve();
  assert.equal(JSON.parse((await f.reply(3)).result.content[0].text).ok, true);
  await until(() => f.runtime.session.snapshot().pendingTools === 0);
  assert.equal(f.calls.filter(value => value === 'selection.complete').length, 0);
  assert.equal(f.calls.filter(value => value === 'bridge.open').length, 1);
  assert.equal(f.calls.filter(value => value === 'readiness.begin').length, 1);
  assert.equal(f.state().clientCloses, 0);
  assert.equal(f.messages.some(value => value.id === 2), false);
});

test('failed bridge.open retires three waiting tools and its client without polling, dispatch or replay', async t => {
  const openGate = deferred();
  openGate.promise = openGate.promise.then(() => {
    throw Object.assign(new Error(`PRIVATE_OPEN_FAILURE ${'b'.repeat(64)}`), { code: 'session_v2_unavailable' });
  });
  const f = await sdkFixture(t, { openGate });
  await until(() => f.calls.includes('bridge.open'));
  f.call(2, 'check_connection_v1', {});
  f.call(3, 'claim_selection_v1', { selection_id: randomUUID(), delivery_token: 'd'.repeat(64) });
  f.call(4, 'complete_selection_v1', { selection_id: randomUUID(), outcome: 'completed', note: 'Fixture report.' });
  await until(() => f.runtime.session.snapshot().pendingTools === 3);
  openGate.resolve();
  assert.equal(await f.runtime.closed, 0);
  assert.equal(f.runtime.session.snapshot().pendingTools, 0);
  assert.equal(f.runtime.session.snapshot().queue.pending, 0);
  assert.equal(f.runtime.session.snapshot().closed, true);
  assert.equal(f.state().clientCloses, 1);
  assert.equal(f.state().active, 0);
  assert.deepEqual(f.calls, ['bridge.open']);
  await assert.rejects(f.runtime.session.start(), { code: 'session_v2_bridge_reopen_forbidden' });
  await turn();
  assert.deepEqual(f.calls, ['bridge.open']);
  assert.match(f.diagnostics(), /session_v2_unavailable/);
  assert.doesNotMatch(f.diagnostics() + JSON.stringify(f.messages), /PRIVATE_OPEN_FAILURE|[bd]{64}/);
});

test('cancellation after dispatch retains one exchange until its result and never replays the mutation', async t => {
  const completionGate = deferred();
  const f = await sdkFixture(t, { completionGate });
  await until(() => f.calls.includes('bridge.poll'));
  f.call(2, 'complete_selection_v1', { selection_id: randomUUID(), outcome: 'completed', note: 'Fixture report.' });
  await until(() => f.calls.includes('selection.complete'));
  await f.cancel(2);
  f.call(3, 'check_connection_v1', {});
  await until(() => f.runtime.session.snapshot().pendingTools === 2);
  assert.equal(f.runtime.session.snapshot().queue.pending, 2, 'the cancelled in-flight call retains its slot');
  assert.equal(f.calls.includes('readiness.begin'), false);
  assert.equal(f.state().clientCloses, 0);
  completionGate.resolve();
  assert.equal(JSON.parse((await f.reply(3)).result.content[0].text).ok, true);
  assert.equal(f.calls.filter(value => value === 'selection.complete').length, 1);
  assert.equal(f.messages.some(value => value.id === 2), false);
  assert.equal(f.state().maximumActive, 1);
});

test('SDK EOF still retires the bridge and prevents queued operations instead of replaying them', async t => {
  const pollGate = deferred();
  const f = await sdkFixture(t, { pollGate });
  await until(() => f.calls.includes('bridge.poll'));
  f.call(2, 'complete_selection_v1', { selection_id: randomUUID(), outcome: 'completed', note: 'Fixture report.' });
  await until(() => f.runtime.session.snapshot().queue.pending === 2);
  f.input.end();
  await until(() => f.runtime.session.snapshot().closed);
  pollGate.resolve();
  await f.runtime.closed;
  assert.equal(f.calls.includes('selection.complete'), false);
  assert.equal(f.calls.filter(value => value === 'bridge.close').length, 1);
});

test('queue skips pre-aborted and waiting requests without cancelling another active operation', async () => {
  const gate = deferred(); const calls = [];
  const queue = createSessionV2RequestQueue({ request: async value => {
    calls.push(value.operation);
    if (value.operation === 'active') await gate.promise;
    return {};
  } });
  const cancelled = new AbortController(); cancelled.abort('PRIVATE_CANCEL_REASON');
  await assert.rejects(queue.request({ operation: 'pre-aborted' }, { signal: cancelled.signal }), { code: 'session_v2_request_cancelled' });
  const active = queue.request({ operation: 'active' });
  const controller = new AbortController();
  const pending = queue.request({ operation: 'cancelled-waiter' }, { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'session_v2_request_cancelled' });
  controller.abort('PRIVATE_CANCEL_REASON');
  gate.resolve();
  await active; await rejected; await queue.drain();
  assert.deepEqual(calls, ['active']);
  assert.equal(queue.snapshot().pending, 0);
});

test('queued cancellation frees all ordinary capacity while an active RPC retains its slot and listeners are removed', async t => {
  const gate = deferred(); const calls = []; const requests = [];
  let activeCount = 0; let maximumActive = 0;
  const queue = createSessionV2RequestQueue({ request: async value => {
    calls.push(value.operation); activeCount++; maximumActive = Math.max(maximumActive, activeCount);
    try {
      if (value.operation === 'active') await gate.promise;
      return {};
    } finally { activeCount--; }
  } });
  t.after(async () => { gate.resolve(); await Promise.allSettled(requests); await queue.drain(); });
  const activeController = new AbortController();
  const active = queue.request({ operation: 'active' }, { signal: activeController.signal }); requests.push(active);
  await until(() => calls.length === 1);
  assert.equal(getEventListeners(activeController.signal, 'abort').length, 0, 'dispatch retires the queue listener');
  const controllers = Array.from({ length: 31 }, () => new AbortController());
  const waiting = controllers.map((controller, i) =>
    queue.request({ operation: `cancelled_${i}` }, { signal: controller.signal }));
  requests.push(...waiting);
  const settled = Promise.allSettled(waiting);
  assert.equal(queue.snapshot().pending, 32);
  const waitingListeners = controllers.map(controller => getEventListeners(controller.signal, 'abort').length);
  await assert.rejects(queue.request({ operation: 'overflow' }), { code: 'session_v2_queue_full' });
  for (const controller of controllers) controller.abort('PRIVATE_CANCEL_REASON');
  await turn();
  assert.equal(queue.snapshot().pending, 1, 'cancelled unsent entries release capacity before the active response');
  assert.deepEqual(waitingListeners, Array(31).fill(1));
  for (const result of await settled) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'session_v2_request_cancelled');
    assert.doesNotMatch(result.reason.message, /PRIVATE_CANCEL_REASON/);
  }
  for (const controller of controllers) assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  activeController.abort();
  assert.equal(queue.snapshot().pending, 1, 'an already dispatched RPC retains its capacity after cancellation');
  const nextController = new AbortController();
  const next = queue.request({ operation: 'next' }, { signal: nextController.signal }); requests.push(next);
  const last = queue.request({ operation: 'last' }); requests.push(last);
  assert.equal(queue.snapshot().pending, 3);
  assert.equal(getEventListeners(nextController.signal, 'abort').length, 1);
  await turn();
  assert.deepEqual(calls, ['active']);
  gate.resolve();
  await active; await next; await last; await queue.drain();
  assert.deepEqual(calls, ['active', 'next', 'last']);
  assert.equal(maximumActive, 1);
  assert.equal(queue.snapshot().pending, 0);
  assert.equal(getEventListeners(nextController.signal, 'abort').length, 0);
});

test('cancelling a waiting poll frees its slot and the next poll keeps priority without RPC overlap', async t => {
  const gate = deferred(); const calls = []; const requests = [];
  let activeCount = 0; let maximumActive = 0;
  const perform = async value => {
    calls.push(value.operation); activeCount++; maximumActive = Math.max(maximumActive, activeCount);
    try {
      if (value.operation === 'active') await gate.promise;
      return {};
    } finally { activeCount--; }
  };
  const queue = createSessionV2RequestQueue({ request: perform, exchange: perform });
  t.after(async () => { gate.resolve(); await Promise.allSettled(requests); await queue.drain(); });
  const active = queue.request({ operation: 'active' }); requests.push(active);
  await until(() => calls.length === 1);
  const cancelledController = new AbortController();
  const cancelled = queue.exchange({ operation: 'bridge.poll' }, { signal: cancelledController.signal }); requests.push(cancelled);
  const rejected = assert.rejects(cancelled, { code: 'session_v2_request_cancelled' });
  await assert.rejects(queue.exchange({ operation: 'bridge.poll' }), { code: 'session_v2_queue_full' });
  const waitingListeners = getEventListeners(cancelledController.signal, 'abort').length;
  cancelledController.abort();
  await turn();
  assert.equal(queue.snapshot().pending, 1);
  assert.equal(waitingListeners, 1);
  await rejected;
  assert.equal(getEventListeners(cancelledController.signal, 'abort').length, 0);
  const ordinary = queue.request({ operation: 'ordinary' }); requests.push(ordinary);
  const nextController = new AbortController();
  const next = queue.exchange({ operation: 'bridge.poll' }, { signal: nextController.signal }); requests.push(next);
  assert.equal(queue.snapshot().pending, 3);
  assert.equal(getEventListeners(nextController.signal, 'abort').length, 1);
  await turn();
  assert.deepEqual(calls, ['active']);
  gate.resolve();
  await active; await next; await ordinary; await queue.drain();
  assert.deepEqual(calls, ['active', 'bridge.poll', 'ordinary']);
  assert.equal(getEventListeners(nextController.signal, 'abort').length, 0);
  assert.equal(maximumActive, 1);
});

test('cancelling the last unsent entry resolves drain and removes its listener before dispatch', async () => {
  const calls = [];
  const queue = createSessionV2RequestQueue({ request: async value => { calls.push(value.operation); return {}; } });
  const controller = new AbortController();
  const pending = queue.request({ operation: 'unsent' }, { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'session_v2_request_cancelled' });
  const drained = queue.drain();
  controller.abort();
  assert.equal(queue.snapshot().pending, 0);
  await rejected; await drained; await turn();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.deepEqual(calls, []);
});

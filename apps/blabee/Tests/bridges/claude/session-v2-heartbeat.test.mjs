import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';
import { createSessionV2BridgeSession, createSessionV2RequestQueue } from '../../../bridges/claude/src/session-v2-mcp.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  const deadline = performance.now() + 2500;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('heartbeat fixture timed out');
    await delay(5);
  }
}

function queueFixture(t, heldIDs = []) {
  const gates = new Map(heldIDs.map(id => [id, deferred()]));
  const calls = []; const pending = [];
  let active = 0; let maximumActive = 0;
  const perform = async command => {
    calls.push(command.id); active++; maximumActive = Math.max(maximumActive, active);
    try { await gates.get(command.id)?.promise; return { id: command.id }; }
    finally { active--; }
  };
  const queue = createSessionV2RequestQueue({ request: perform, exchange: perform });
  const send = (method, operation, id, options) => {
    const result = queue[method]({ operation, id }, options);
    // Register rejection handling immediately; assertions may wait for a gate.
    result.catch(() => {}); pending.push(result); return result;
  };
  t.after(async () => {
    queue.stop();
    for (const gate of gates.values()) gate.resolve();
    await Promise.allSettled(pending); await queue.drain();
  });
  return { queue, calls, send, release: id => gates.get(id).resolve(), state: () => ({ active, maximumActive }) };
}

test('a waiting poll runs after the active RPC while proposal, claim and completion retain FIFO order', async t => {
  const f = queueFixture(t, ['active', 'poll']);
  const active = f.send('request', 'selection.complete', 'active');
  await until(() => f.calls.length === 1);
  const next = [f.send('request', 'proposal.emit', 'proposal'), f.send('request', 'selection.claim', 'claim')];
  const poll = f.send('exchange', 'bridge.poll', 'poll');
  next.push(f.send('request', 'selection.complete', 'completion'));
  await turn();
  assert.deepEqual(f.calls, ['active']);
  f.release('active'); await active;
  await until(() => f.calls.length >= 2);
  assert.deepEqual(f.calls, ['active', 'poll']);
  f.release('poll'); await poll; await Promise.all(next); await f.queue.drain();
  assert.deepEqual(f.calls, ['active', 'poll', 'proposal', 'claim', 'completion']);
  assert.equal(f.state().maximumActive, 1);
  assert.deepEqual(f.queue.snapshot(), { pending: 0, accepting: true });
});

test('32 admitted ordinary requests leave one bounded poll slot even while the poll is active', async t => {
  const f = queueFixture(t, ['tool-0', 'poll']);
  const ordinary = Array.from({ length: 32 }, (_, i) => f.send('request', 'readiness.begin', `tool-${i}`));
  await until(() => f.calls.length === 1);
  await assert.rejects(f.send('request', 'selection.claim', 'overflow'), { code: 'session_v2_queue_full' });
  const poll = f.send('exchange', 'bridge.poll', 'poll');
  assert.equal(f.queue.snapshot().pending, 33);
  await assert.rejects(f.send('exchange', 'bridge.poll', 'extra-poll'), { code: 'session_v2_queue_full' });
  f.release('tool-0');
  await until(() => f.calls.length >= 2);
  assert.deepEqual(f.calls, ['tool-0', 'poll']);
  await assert.rejects(f.send('exchange', 'bridge.poll', 'active-poll-overflow'), { code: 'session_v2_queue_full' });
  f.release('poll'); await poll; await Promise.all(ordinary); await f.queue.drain();
  assert.deepEqual(f.calls, ['tool-0', 'poll', ...Array.from({ length: 31 }, (_, i) => `tool-${i + 1}`)]);
  assert.equal(f.state().maximumActive, 1);
  assert.equal(f.queue.snapshot().pending, 0);
});

test('exchanges other than bridge.poll retain ordinary FIFO order', async t => {
  const f = queueFixture(t, ['active']);
  const work = [f.send('request', 'selection.complete', 'active')];
  await until(() => f.calls.length === 1);
  work.push(f.send('request', 'proposal.emit', 'proposal'));
  work.push(f.send('exchange', 'readiness.ack', 'ack'));
  work.push(f.send('request', 'selection.claim', 'claim'));
  f.release('active'); await Promise.all(work); await f.queue.drain();
  assert.deepEqual(f.calls, ['active', 'proposal', 'ack', 'claim']);
});

test('cancelling an active completion cannot let the priority poll overlap or replay it', async t => {
  const f = queueFixture(t, ['completion', 'poll']);
  const control = new AbortController();
  const completion = f.send('request', 'selection.complete', 'completion', { signal: control.signal });
  await until(() => f.calls.length === 1);
  const proposal = f.send('request', 'proposal.emit', 'proposal');
  const poll = f.send('exchange', 'bridge.poll', 'poll');
  control.abort('PRIVATE_CANCEL_REASON');
  await turn();
  assert.deepEqual(f.calls, ['completion']);
  f.release('completion'); await completion;
  await until(() => f.calls.length >= 2);
  assert.deepEqual(f.calls, ['completion', 'poll']);
  f.release('poll'); await poll; await proposal; await f.queue.drain();
  assert.deepEqual(f.calls, ['completion', 'poll', 'proposal']);
  assert.equal(f.state().maximumActive, 1);
});

test('cancelled waiting tools and polls are skipped without discarding later work', async t => {
  const f = queueFixture(t, ['active']);
  const active = f.send('request', 'selection.complete', 'active');
  await until(() => f.calls.length === 1);
  const toolControl = new AbortController(); const pollControl = new AbortController();
  const cancelled = f.send('request', 'proposal.emit', 'cancelled-tool', { signal: toolControl.signal });
  const poll = f.send('exchange', 'bridge.poll', 'cancelled-poll', { signal: pollControl.signal });
  const followup = f.send('request', 'readiness.begin', 'followup');
  toolControl.abort('PRIVATE_CANCEL_REASON'); pollControl.abort('PRIVATE_CANCEL_REASON');
  f.release('active'); await active;
  await assert.rejects(cancelled, { code: 'session_v2_request_cancelled' });
  await assert.rejects(poll, { code: 'session_v2_request_cancelled' });
  await followup; await f.queue.drain();
  assert.deepEqual(f.calls, ['active', 'followup']);
  const nextPoll = await f.send('exchange', 'bridge.poll', 'fresh-poll');
  assert.deepEqual(nextPoll, { id: 'fresh-poll' });
  await f.queue.drain();
  assert.equal(f.queue.snapshot().pending, 0);
});

test('stop rejects both waiting lanes and drain waits for the active RPC result', async t => {
  const f = queueFixture(t, ['active']);
  const active = f.send('request', 'selection.complete', 'active');
  await until(() => f.calls.length === 1);
  const waiting = f.send('request', 'proposal.emit', 'waiting');
  const poll = f.send('exchange', 'bridge.poll', 'poll');
  f.queue.stop();
  let drained = false;
  const draining = f.queue.drain().then(() => { drained = true; });
  await turn();
  assert.equal(drained, false);
  assert.deepEqual(f.calls, ['active']);
  await assert.rejects(f.send('exchange', 'bridge.poll', 'after-stop'), { code: 'session_v2_bridge_closed' });
  f.release('active'); await active;
  await assert.rejects(waiting, { code: 'session_v2_bridge_closed' });
  await assert.rejects(poll, { code: 'session_v2_bridge_closed' });
  await draining;
  assert.deepEqual(f.calls, ['active']);
  assert.deepEqual(f.queue.snapshot(), { pending: 0, accepting: false });
});

for (const outcome of ['heartbeat', 'unexpected_event', 'transport_error', 'invalid_response']) {
  test(`priority heartbeat preserves tool progress and rejects delivery on the MCP lane: ${outcome}`, async t => {
    const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
    const bridgeID = randomUUID(); const selectionID = randomUUID();
    const gate = deferred(); const calls = []; const notifications = []; const errors = []; const requests = [];
    let polls = 0;
    const event = { kind: 'selection', selection_id: randomUUID(), delivery_token: 'd'.repeat(64),
      delivery_sequence: '1', expires_at_nanoseconds: '300000000000', channel_source: 'blabee-claude' };
    const session = createSessionV2BridgeSession({ authority, channelSource: 'blabee-claude',
      notify: async message => { notifications.push(message); }, onError: code => errors.push(code), client: {
        async request(value) {
          calls.push(value.operation);
          if (value.operation === 'bridge.open') return { bridge_id: bridgeID };
          if (value.operation === 'selection.complete') {
            await gate.promise;
            return { selection_id: value.selection_id, recorded: true, reported_by: 'claude' };
          }
          assert.equal(value.operation, 'readiness.begin');
          return { probe_id: randomUUID(), nonce: 'c'.repeat(64), expires_at_nanoseconds: '300000000000', status: 'pending' };
        },
        async exchange(request) {
          calls.push(request.operation); polls++;
          if (polls > 1 && outcome === 'transport_error') throw new Error('PRIVATE_TRANSPORT_ERROR');
          const { payload, ...common } = request;
          return { ...common, kind: 'response', ok: true,
            request_id: polls > 1 && outcome === 'invalid_response' ? randomUUID() : request.request_id,
            // Deliberately repeat the same delivery on subsequent polls.
            result: { event: polls > 1 && outcome === 'unexpected_event' ? event : null } };
        },
        async close() {},
      } });
    t.after(async () => { gate.resolve(); await session.close(); await Promise.allSettled(requests); });
    await session.start();
    await until(() => polls === 1);
    const completion = session.handler('complete_selection_v1', {
      selection_id: selectionID, outcome: 'completed', note: 'Isolated fixture report.',
    });
    requests.push(completion);
    await until(() => calls.includes('selection.complete'));
    const queuedTool = session.handler('check_connection_v1', {}); requests.push(queuedTool);
    await until(() => session.snapshot().queue.pending === 3);
    assert.equal(calls.includes('readiness.begin'), false);
    gate.resolve();
    assert.equal((await completion).isError, undefined);
    const toolResult = await queuedTool;
    if (outcome === 'heartbeat') {
      assert.equal(toolResult.isError, undefined);
      await until(() => polls >= 3);
      assert.deepEqual(calls.slice(0, 5), ['bridge.open', 'bridge.poll', 'selection.complete', 'bridge.poll', 'readiness.begin']);
      assert.equal(notifications.length, 0);
      assert.equal(session.snapshot().heartbeat.failed, false);
      assert.deepEqual(errors, []);
    } else {
      await until(() => session.snapshot().closed);
      assert.equal(toolResult.isError, true);
      assert.deepEqual(calls, ['bridge.open', 'bridge.poll', 'selection.complete', 'bridge.poll']);
      assert.equal(notifications.length, 0);
      assert.deepEqual(errors, [outcome === 'transport_error'
        ? 'session_v2_channel_transport_unknown' : 'session_v2_channel_invalid_response']);
    }
    await session.close();
    assert.equal(calls.filter(operation => operation === 'selection.complete').length, 1);
    assert.equal(calls.some(operation => ['readiness.ack', 'selection.claim'].includes(operation)), false);
    assert.doesNotMatch(JSON.stringify(errors), /PRIVATE_TRANSPORT_ERROR/);
  });
}

// Uses the production bridge and its real 500ms poll timer with a fake service.
// It measures queue accumulation, not Swift persistence/lock or live-model latency.
test('six normal 900ms RPCs do not accumulate into a five-second poll gap', { timeout: 15000 }, async t => {
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const bridgeID = randomUUID();
  const pollTimes = []; const durations = []; const calls = []; const errors = [];
  let active = 0; let maximumActive = 0;
  const session = createSessionV2BridgeSession({ authority, channelSource: 'blabee-claude',
    notify: async () => { assert.fail('empty fixture polls must not fabricate a Channel event'); },
    onError: code => errors.push(code), client: {
      async request(value) {
        calls.push(value.operation); active++; maximumActive = Math.max(maximumActive, active);
        try {
          if (value.operation === 'bridge.open') return { bridge_id: bridgeID };
          assert.equal(value.operation, 'readiness.begin');
          const began = performance.now();
          await delay(900);
          durations.push(performance.now() - began);
          return { probe_id: randomUUID(), nonce: 'c'.repeat(64), expires_at_nanoseconds: '300000000000', status: 'pending' };
        } finally { active--; }
      },
      async exchange(request) {
        active++; maximumActive = Math.max(maximumActive, active);
        try {
          pollTimes.push(performance.now());
          const { payload, ...common } = request;
          return { ...common, kind: 'response', ok: true, result: { event: null } };
        } finally { active--; }
      },
      async close() {},
    } });
  t.after(() => session.close());
  await session.start();
  await until(() => pollTimes.length === 1);
  const results = await Promise.all(Array.from({ length: 6 }, () => session.handler('check_connection_v1', {})));
  await until(() => pollTimes.length >= 2 && session.snapshot().queue.pending === 0);
  const maximumGap = Math.max(...pollTimes.slice(1).map((at, i) => at - pollTimes[i]));
  t.diagnostic(JSON.stringify({ rpc_count: durations.length, rpc_delay_ms: 900,
    maximum_rpc_ms: Math.round(Math.max(...durations)), maximum_poll_gap_ms: Math.round(maximumGap),
    heartbeat_deadline_ms: 5000, maximum_concurrent_rpc: maximumActive, swift_service_executed: false }));
  assert.equal(results.every(result => !result.isError), true);
  assert.deepEqual(errors, []);
  assert.equal(durations.length, 6);
  assert.ok(durations.every(duration => duration < 5000), 'each fixture RPC must finish inside the heartbeat deadline');
  assert.ok(maximumGap < 5000, `normal RPC backlog delayed the poll ${Math.round(maximumGap)}ms`);
  assert.ok(pollTimes.length >= 4, 'polling must continue throughout the backlog');
  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, ['bridge.open', ...Array(6).fill('readiness.begin')]);
});

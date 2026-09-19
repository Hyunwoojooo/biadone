import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createSessionV2ChannelCursor, createSessionV2ChannelPoller } from '../src/bridge/session-v2-channel-poller.mjs';

const authorityKeys = ['scope_id', 'native_session_id', 'session_incarnation', 'service_incarnation', 'owner_connection_id', 'authority_epoch'];
const config = () => ({ authority: Object.fromEntries(authorityKeys.map(key => [key, randomUUID()])), bridgeID: randomUUID(),
  channelSource: 'server:blabee-claude' });
function event(sequence, kind = 'readiness_probe') {
  return { kind, delivery_sequence: String(sequence), expires_at_nanoseconds: '18446744073709551615',
    channel_source: 'server:blabee-claude', ...(kind === 'readiness_probe'
      ? { probe_id: randomUUID(), nonce: 'a'.repeat(64) } : { selection_id: randomUUID(), delivery_token: 'b'.repeat(64) }) };
}
const response = (configuration, requestID, value) => ({ schema_version: 'blabee.claude-session.v2', kind: 'response', provider: 'claude',
  request_id: requestID, role: 'bridge', operation: 'bridge.poll', authority: { ...configuration.authority }, ok: true, result: { event: value } });
const accept = (cursor, configuration, value, mutate = value => value) => {
  const requestID = randomUUID();
  return cursor.accept(mutate(response(configuration, requestID, value)), { requestID, bridgeID: configuration.bridgeID });
};

test('1,000 v2 notifications retain one digest and old deliveries remain rejected after a long session', async () => {
  const configuration = config();
  let notifications = 0; let requests = 0;
  const poller = createSessionV2ChannelPoller({ ...configuration,
    exchange: async request => {
      requests++;
      assert.equal(request.operation, 'bridge.poll');
      assert.deepEqual(request.payload, { bridge_id: configuration.bridgeID });
      return response(configuration, request.request_id, event(requests, requests % 2 ? 'readiness_probe' : 'selection'));
    }, notifyEvent: async value => { notifications++; assert.equal(value.delivery_sequence, String(notifications)); } });
  for (let index = 0; index < 1000; index++) {
    await poller.pollOnce();
    assert.deepEqual(poller.snapshot(), { deliverySequence: String(index + 1), retainedEventDigests: 1,
      failed: false, stopped: false, pendingRequests: 0, errorCode: undefined });
  }
  assert.equal(notifications, 1000);
  assert.equal(requests, 1000, 'No automatic ACK, claim or completion operation');
  await poller.stop();

  const cursor = createSessionV2ChannelCursor(configuration);
  const first = event(1);
  accept(cursor, configuration, first);
  for (let index = 2; index <= 1000; index++) accept(cursor, configuration, event(index));
  assert.throws(() => accept(cursor, configuration, first), { code: 'session_v2_channel_replayed' });
  assert.equal(cursor.snapshot().retainedEventDigests, 1);
});

test('same delivery is suppressed, object key order is irrelevant, gaps are allowed, changes and rewind are terminal', () => {
  const configuration = config();
  const cursor = createSessionV2ChannelCursor(configuration);
  const first = event(7);
  assert.deepEqual(accept(cursor, configuration, first), first);
  assert.equal(accept(cursor, configuration, Object.fromEntries(Object.entries(first).reverse())), null);
  assert.equal(accept(cursor, configuration, null), null);
  const next = event('9007199254740993', 'selection');
  assert.deepEqual(accept(cursor, configuration, next), next);
  assert.throws(() => accept(cursor, configuration, { ...next, delivery_token: 'c'.repeat(64) }), { code: 'session_v2_channel_replayed' });
  assert.throws(() => accept(cursor, configuration, event('18446744073709551615')), { code: 'session_v2_channel_replayed' });
});

test('v2 cursor checks every authority field, bridge, source, response correlation and exact event shape', () => {
  const configuration = config();
  for (const key of authorityKeys) {
    assert.throws(() => accept(createSessionV2ChannelCursor(configuration), configuration, event(1), value => ({ ...value,
      authority: { ...value.authority, [key]: randomUUID() } })), { code: 'session_v2_channel_invalid_response' });
  }
  for (const mutate of [value => ({ ...value, schema_version: 'blabee.claude-session.v1' }),
    value => ({ ...value, role: 'hook' }), value => ({ ...value, provider: 'codex' }),
    value => ({ ...value, request_id: randomUUID() }), value => ({ ...value, operation: 'readiness.ack' }),
    value => ({ ...value, authority: { ...value.authority, extra: 'private' } }),
    value => ({ ...value, result: { ...value.result, extra: true } })]) {
    assert.throws(() => accept(createSessionV2ChannelCursor(configuration), configuration, event(1), mutate),
      { code: 'session_v2_channel_invalid_response' });
  }
  for (const changes of [{ channel_source: 'server:foreign' }, { content: 'PRIVATE BODY' }, { nonce: 'a'.repeat(63) + '\n' },
    { expires_at_nanoseconds: '18446744073709551616' }, { delivery_sequence: '01' }, { delivery_sequence: '0' },
    { delivery_sequence: 1 }, { delivery_sequence: '1\n' }, { delivery_sequence: '18446744073709551616' }]) {
    assert.throws(() => accept(createSessionV2ChannelCursor(configuration), configuration, { ...event(1), ...changes }),
      { code: 'session_v2_channel_invalid_response' });
  }
  const requestID = randomUUID();
  assert.throws(() => createSessionV2ChannelCursor(configuration).accept(response(configuration, requestID, event(1)),
    { requestID, bridgeID: randomUUID() }), { code: 'session_v2_channel_invalid_response' });
});

test('transport and notification loss stop delivery without retry or raw errors', async () => {
  for (const phase of ['transport', 'notification']) {
    const configuration = config();
    let requests = 0; let notifications = 0;
    const errors = [];
    const poller = createSessionV2ChannelPoller({ ...configuration,
      exchange: async request => { requests++; if (phase === 'transport') throw new Error('PRIVATE TRANSPORT PAYLOAD');
        return response(configuration, request.request_id, event(1)); },
      notifyEvent: async () => { notifications++; throw new Error('PRIVATE NOTIFICATION PAYLOAD'); },
      onError: code => errors.push(code) });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.equal(requests, 1);
    assert.equal(notifications, phase === 'notification' ? 1 : 0);
    assert.deepEqual(errors, [`session_v2_channel_${phase}_unknown`]);
    assert.equal(poller.snapshot().deliverySequence, phase === 'notification' ? '1' : '0');
    assert.throws(() => poller.start(), { code: 'session_v2_channel_closed' });
    await poller.stop();
  }
});

test('one outstanding exchange coalesces polls; stop waits for it and suppresses a late event', async () => {
  const configuration = config();
  let resolveResponse;
  let requestSeen;
  let calls = 0; let notifications = 0;
  const poller = createSessionV2ChannelPoller({ ...configuration,
    exchange: request => { calls++; requestSeen = request; return new Promise(resolve => { resolveResponse = resolve; }); },
    notifyEvent: () => { notifications++; } });
  const first = poller.pollOnce();
  const second = poller.pollOnce();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  let stopped = false;
  const closing = poller.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  resolveResponse(response(configuration, requestSeen.request_id, event(1)));
  await closing;
  assert.equal(notifications, 0);
  assert.equal(poller.snapshot().retainedEventDigests, 0);
  assert.equal(poller.snapshot().pendingRequests, 0);
});

test('stop before a queued poll creates no new exchange and configuration remains immutable', async () => {
  const configuration = config();
  let calls = 0;
  const poller = createSessionV2ChannelPoller({ ...configuration, exchange: async () => { calls++; }, notifyEvent: () => {} });
  void poller.pollOnce();
  await poller.stop();
  assert.equal(calls, 0);
  const cursor = createSessionV2ChannelCursor(configuration);
  const original = structuredClone(configuration);
  configuration.authority.scope_id = randomUUID();
  assert.deepEqual(accept(cursor, original, event(1)).delivery_sequence, '1');
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createSessionV2ChannelCursor, createSessionV2ChannelPoller } from '../../../bridges/claude/src/session-v2-channel-poller.mjs';

const authorityKeys = ['scope_id', 'native_session_id', 'session_incarnation', 'service_incarnation', 'owner_connection_id', 'authority_epoch'];
const config = () => ({ authority: Object.fromEntries(authorityKeys.map(key => [key, randomUUID()])), bridgeID: randomUUID(),
  channelSource: 'server:blabee-claude' });
function event(sequence, kind = 'readiness_probe') {
  return { kind, delivery_sequence: String(sequence), expires_at_nanoseconds: '18446744073709551615',
    channel_source: 'server:blabee-claude', ...(kind === 'readiness_probe'
      ? { probe_id: randomUUID(), nonce: 'a'.repeat(64) } : { selection_id: randomUUID(), delivery_token: 'b'.repeat(64) }) };
}
const response = (configuration, requestID, value) => ({ schema_version: 'blabee.claude-session.v3', kind: 'response', provider: 'claude',
  request_id: requestID, role: 'bridge', operation: 'bridge.poll', authority: { ...configuration.authority }, ok: true, result: { event: value } });
const accept = (cursor, configuration, value, mutate = value => value) => {
  const requestID = randomUUID();
  return cursor.accept(mutate(response(configuration, requestID, value)), { requestID, bridgeID: configuration.bridgeID });
};

test('1,000 heartbeats retain no delivery data and never notify, ACK or claim', async () => {
  const configuration = config();
  let notifications = 0; let requests = 0;
  const poller = createSessionV2ChannelPoller({ ...configuration,
    exchange: async request => {
      requests++;
      assert.equal(request.schema_version, 'blabee.claude-session.v3');
      assert.equal(request.operation, 'bridge.poll');
      assert.deepEqual(request.payload, { bridge_id: configuration.bridgeID });
      return response(configuration, request.request_id, null);
    }, notifyEvent: async () => { notifications++; } });
  for (let index = 0; index < 1000; index++) {
    await poller.pollOnce();
    assert.deepEqual(poller.snapshot(), { failed: false, stopped: false, pendingRequests: 0, errorCode: undefined });
  }
  assert.equal(notifications, 0);
  assert.equal(requests, 1000);
  await poller.stop();
});

test('all events on the heartbeat lane are terminal compatibility failures', () => {
  const configuration = config();
  for (const value of [event(1), event(2, 'selection'), {}, false, undefined]) {
    const cursor = createSessionV2ChannelCursor(configuration);
    assert.equal(accept(cursor, configuration, null), null);
    assert.throws(() => accept(cursor, configuration, value), { code: 'session_v2_channel_invalid_response' });
    assert.throws(() => accept(cursor, configuration, null), { code: 'session_v2_channel_invalid_response' });
  }
});

test('heartbeat checks every authority field, bridge, response correlation and exact shape', () => {
  const configuration = config();
  for (const key of authorityKeys) {
    assert.throws(() => accept(createSessionV2ChannelCursor(configuration), configuration, null, value => ({ ...value,
      authority: { ...value.authority, [key]: randomUUID() } })), { code: 'session_v2_channel_invalid_response' });
  }
  for (const mutate of [value => ({ ...value, schema_version: 'blabee.claude-session.v1' }),
    value => ({ ...value, schema_version: 'blabee.claude-session.v2' }),
    value => ({ ...value, role: 'hook' }), value => ({ ...value, provider: 'codex' }),
    value => ({ ...value, request_id: randomUUID() }), value => ({ ...value, operation: 'readiness.ack' }),
    value => ({ ...value, authority: { ...value.authority, extra: 'private' } }),
    value => ({ ...value, result: { ...value.result, extra: true } })]) {
    assert.throws(() => accept(createSessionV2ChannelCursor(configuration), configuration, null, mutate),
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

test('transport loss and unexpected events stop heartbeat without retry or raw errors', async () => {
  for (const phase of ['transport', 'event']) {
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
    assert.equal(notifications, 0);
    assert.deepEqual(errors, [phase === 'transport' ? 'session_v2_channel_transport_unknown' : 'session_v2_channel_invalid_response']);
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
  assert.equal(poller.snapshot().failed, false);
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
  assert.equal(accept(cursor, original, null), null);
});

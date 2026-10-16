import { randomUUID } from 'node:crypto';
import { SESSION_V2_WIRE_VERSION } from './session-v2-client.mjs';

const AUTHORITY_KEYS = ['scope_id', 'native_session_id', 'session_incarnation', 'service_incarnation',
  'owner_connection_id', 'authority_epoch'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const authorityValue = value => keys(value, AUTHORITY_KEYS) && AUTHORITY_KEYS.every(key => uuid(value[key]));
const sourceValue = value => typeof value === 'string' && value.length <= 256
  && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value) && !value.includes('\n');

export class SessionV2ChannelError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Historical source/export names remain, but v3 accepts heartbeat only.
 * A legacy event is a compatibility failure, never a notification or ACK. */
export function createSessionV2ChannelCursor({ authority, bridgeID, channelSource } = {}) {
  if (!authorityValue(authority) || !uuid(bridgeID) || !sourceValue(channelSource)) {
    throw new SessionV2ChannelError('session_v2_channel_invalid_configuration');
  }
  const identity = Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map(key => [key, authority[key]])));
  let failure;
  const fail = code => { failure ??= new SessionV2ChannelError(code); throw failure; };
  return {
    accept(response, { requestID, bridgeID: observedBridgeID } = {}) {
      if (failure) throw failure;
      if (!uuid(requestID) || observedBridgeID !== bridgeID
          || !keys(response, ['schema_version', 'kind', 'provider', 'request_id', 'role', 'operation', 'authority', 'ok',
            response?.ok === true ? 'result' : 'error'])
          || response.schema_version !== SESSION_V2_WIRE_VERSION || response.kind !== 'response'
          || response.provider !== 'claude' || response.role !== 'bridge' || response.operation !== 'bridge.poll'
          || response.request_id !== requestID || !authorityValue(response.authority)
          || AUTHORITY_KEYS.some(key => response.authority[key] !== identity[key])) return fail('session_v2_channel_invalid_response');
      if (response.ok === false && keys(response.error, ['code']) && typeof response.error.code === 'string') {
        return fail('session_v2_channel_rejected');
      }
      if (response.ok !== true || !keys(response.result, ['event']) || response.result.event !== null) {
        return fail('session_v2_channel_invalid_response');
      }
      return null;
    },
    snapshot: () => Object.freeze({ failed: failure !== undefined }),
  };
}

/** Heartbeat poller. exchange receives/returns full parsed v3 envelopes;
 * its owner supplies authenticated, bounded, non-retrying I/O and serializes it
 * with tool requests. It has no notification callback or delivery operation.
 * No legacy environment, client, launcher, SDK channel or tool is auto-selected.
 */
export function createSessionV2ChannelPoller({ authority, bridgeID, channelSource, exchange,
  onError = () => {}, intervalMs = 500 } = {}) {
  const cursor = createSessionV2ChannelCursor({ authority, bridgeID, channelSource });
  if (typeof exchange !== 'function' || typeof onError !== 'function'
      || !Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 1000) {
    throw new SessionV2ChannelError('session_v2_channel_invalid_configuration');
  }
  const identity = Object.freeze({ ...authority });
  let stopped = false;
  let started = false;
  let timer;
  let active;
  let errorCode;
  const pollOnce = () => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = Promise.resolve().then(async () => {
      if (stopped) return;
      const requestID = randomUUID();
      let response;
      try {
        response = await exchange({ schema_version: SESSION_V2_WIRE_VERSION, kind: 'request', provider: 'claude',
          request_id: requestID, role: 'bridge', operation: 'bridge.poll', authority: identity,
          payload: { bridge_id: bridgeID } });
      } catch { throw new SessionV2ChannelError('session_v2_channel_transport_unknown'); }
      if (stopped) return;
      cursor.accept(response, { requestID, bridgeID });
    }).catch(error => {
      if (!stopped) {
        stopped = true;
        clearTimeout(timer);
        errorCode = error instanceof SessionV2ChannelError ? error.code : 'session_v2_channel_invalid_response';
        try { onError(errorCode); } catch { /* A diagnostic cannot restart delivery. */ }
      }
    }).finally(() => { active = undefined; });
    return active;
  };
  const schedule = async () => {
    await pollOnce();
    if (!stopped) timer = setTimeout(schedule, intervalMs);
  };
  return {
    pollOnce,
    start() {
      if (stopped || started) throw new SessionV2ChannelError('session_v2_channel_closed');
      started = true;
      void schedule();
    },
    async stop() { stopped = true; clearTimeout(timer); await active; },
    snapshot: () => Object.freeze({ ...cursor.snapshot(), stopped, pendingRequests: active ? 1 : 0, errorCode }),
  };
}

export function startSessionV2ChannelPolling(configuration) {
  const poller = createSessionV2ChannelPoller(configuration);
  poller.start();
  return poller;
}

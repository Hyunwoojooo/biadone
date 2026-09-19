import { createHash, randomUUID } from 'node:crypto';

const AUTHORITY_KEYS = ['scope_id', 'native_session_id', 'session_incarnation', 'service_incarnation',
  'owner_connection_id', 'authority_epoch'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const nonce = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
const uint64 = (value, positive = false) => typeof value === 'string' && value.length <= 20
  && /^(0|[1-9][0-9]*)$/.test(value) && !/[^0-9]/.test(value)
  && BigInt(value) <= MAX_UINT64 && (!positive || value !== '0');
const authorityValue = value => keys(value, AUTHORITY_KEYS) && AUTHORITY_KEYS.every(key => uuid(value[key]));
const sourceValue = value => typeof value === 'string' && value.length <= 256
  && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value) && !value.includes('\n');

export class SessionV2ChannelError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** One cursor belongs to one authenticated authority and one logical bridge.
 * The service consumes each event before replying and rejects old IDs durably.
 * This high-watermark rejects replayed deliveries without retaining their IDs.
 * It is not a readiness ACK, claim, lease renewal, or a replacement for a wire
 * client's authentication and byte/framing validation. Never restore it into
 * a newly opened/replaced bridge or reset it after a transport failure.
 */
export function createSessionV2ChannelCursor({ authority, bridgeID, channelSource } = {}) {
  if (!authorityValue(authority) || !uuid(bridgeID) || !sourceValue(channelSource)) {
    throw new SessionV2ChannelError('session_v2_channel_invalid_configuration');
  }
  const identity = Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map(key => [key, authority[key]])));
  let sequence = 0n;
  let digest;
  let failure;
  const fail = code => { failure ??= new SessionV2ChannelError(code); throw failure; };
  return {
    accept(response, { requestID, bridgeID: observedBridgeID } = {}) {
      if (failure) throw failure;
      if (!uuid(requestID) || observedBridgeID !== bridgeID
          || !keys(response, ['schema_version', 'kind', 'provider', 'request_id', 'role', 'operation', 'authority', 'ok',
            response?.ok === true ? 'result' : 'error'])
          || response.schema_version !== 'blabee.claude-session.v2' || response.kind !== 'response'
          || response.provider !== 'claude' || response.role !== 'bridge' || response.operation !== 'bridge.poll'
          || response.request_id !== requestID || !authorityValue(response.authority)
          || AUTHORITY_KEYS.some(key => response.authority[key] !== identity[key])) return fail('session_v2_channel_invalid_response');
      if (response.ok === false && keys(response.error, ['code']) && typeof response.error.code === 'string') {
        return fail('session_v2_channel_rejected');
      }
      if (response.ok !== true || !keys(response.result, ['event'])) return fail('session_v2_channel_invalid_response');
      const event = response.result.event;
      if (event === null) return null;
      const probe = event?.kind === 'readiness_probe';
      const names = ['kind', 'delivery_sequence', 'expires_at_nanoseconds', 'channel_source',
        ...(probe ? ['probe_id', 'nonce'] : ['selection_id', 'delivery_token'])];
      if (!keys(event, names) || (!probe && event.kind !== 'selection')
          || !uuid(event[probe ? 'probe_id' : 'selection_id']) || !nonce(event[probe ? 'nonce' : 'delivery_token'])
          || !uint64(event.delivery_sequence, true) || !uint64(event.expires_at_nanoseconds)
          || event.channel_source !== channelSource) return fail('session_v2_channel_invalid_response');
      const next = BigInt(event.delivery_sequence);
      // Order keys explicitly; a harmless JSON object-key order change is not
      // a changed event. Only this digest is retained, never nonce/token/body.
      const nextDigest = createHash('sha256').update(JSON.stringify(names.map(key => event[key]))).digest('hex');
      if (next < sequence || (next === sequence && nextDigest !== digest)) return fail('session_v2_channel_replayed');
      if (next === sequence) return null;
      sequence = next;
      digest = nextDigest;
      return Object.freeze(Object.fromEntries(names.map(key => [key, event[key]])));
    },
    snapshot: () => Object.freeze({ deliverySequence: sequence.toString(), retainedEventDigests: digest ? 1 : 0,
      failed: failure !== undefined }),
  };
}

/** Explicit v2-only poller. exchange receives/returns full parsed v2 envelopes;
 * its owner supplies authenticated, bounded, non-retrying I/O and serializes it
 * with tool requests. notifyEvent renders only the validated event in CP-05.
 * No legacy environment, client, launcher, SDK channel or tool is auto-selected.
 */
export function createSessionV2ChannelPoller({ authority, bridgeID, channelSource, exchange, notifyEvent,
  onError = () => {}, intervalMs = 500 } = {}) {
  const cursor = createSessionV2ChannelCursor({ authority, bridgeID, channelSource });
  if (typeof exchange !== 'function' || typeof notifyEvent !== 'function' || typeof onError !== 'function'
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
        response = await exchange({ schema_version: 'blabee.claude-session.v2', kind: 'request', provider: 'claude',
          request_id: requestID, role: 'bridge', operation: 'bridge.poll', authority: identity,
          payload: { bridge_id: bridgeID } });
      } catch { throw new SessionV2ChannelError('session_v2_channel_transport_unknown'); }
      if (stopped) return;
      const event = cursor.accept(response, { requestID, bridgeID });
      if (event !== null) {
        // Cursor advancement precedes notification. A failed/partial write is
        // terminal; never replay it or fabricate an ACK/claim to resolve it.
        try { await notifyEvent(event); }
        catch { throw new SessionV2ChannelError('session_v2_channel_notification_unknown'); }
      }
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

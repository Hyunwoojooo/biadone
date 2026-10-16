import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { boundedText, exactKeys, isRecord } from './product-context.mjs';
import { validateProductToolInput } from './product-tools.mjs';

export const SESSION_V2_AUTHORITY_KEYS = Object.freeze(['scope_id', 'native_session_id', 'session_incarnation',
  'service_incarnation', 'owner_connection_id', 'authority_epoch']);
export const SESSION_V2_WIRE_VERSION = 'blabee.claude-session.v3';
export const sessionV2UUID = value => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const sessionV2Nonce = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
export const sessionV2Source = value => typeof value === 'string' && value.length >= 1 && value.length <= 256
  && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value) && !value.includes('\n');
export const sessionV2UInt64 = (value, positive = false) => typeof value === 'string' && value.length <= 20
  && /^(0|[1-9][0-9]*)$/.test(value) && !/[^0-9]/.test(value)
  && BigInt(value) <= 18446744073709551615n && (!positive || value !== '0');
export const sessionV2Authority = value => isRecord(value) && Object.keys(value).length === SESSION_V2_AUTHORITY_KEYS.length
  && SESSION_V2_AUTHORITY_KEYS.every(key => sessionV2UUID(value[key]));
const LIMIT = 256 * 1024;
const ERROR_CODES = new Set(['invalid_request', 'unsupported_version', 'unauthorized', 'forbidden', 'stale_authority',
  'binding_mismatch', 'expired', 'revoked', 'capacity', 'unavailable', 'unknown_result']);
const OPERATIONS = new Set(['bridge.open', 'bridge.poll', 'bridge.close', 'readiness.begin', 'readiness.ack',
  'proposal.emit', 'selection.claim', 'selection.complete']);
const HOOK_OPERATIONS = new Set(['hook', 'hook.poll', 'hook.cancel']);
const RESERVED = new Set(['authtoken', 'hooktoken', 'bridgetoken', 'selectortoken', 'selectiontoken', 'ownertoken',
  'controltoken', 'capability', 'capabilities', 'credential', 'credentials', 'ownerhandle', 'authorizationticket',
  'ticket', 'continuationtoken', 'correlationtoken', 'rawcontinuationtoken', 'privatekey']);

export class SessionV2ClientError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const invalid = () => { throw new SessionV2ClientError('session_v2_invalid_response'); };
const requireValue = value => { if (!value) invalid(); };
const fields = (value, names) => {
  try { exactKeys(value, names); } catch { invalid(); }
};

/** Bounded raw parser: duplicate keys, invalid UTF-8, lone surrogates and unsafe
 * wire numbers are rejected before JS can silently coerce their meaning. */
export function parseSessionV2JSON(bytes, { maximumBytes = LIMIT, integersOnly = true } = {}) {
  try {
    requireValue(Buffer.byteLength(bytes) <= maximumBytes);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let offset = 0;
    const whitespace = () => { while (/[\x20\x09\x0a\x0d]/.test(source[offset] ?? 'x')) offset++; };
    const string = () => {
      const start = offset++;
      while (offset < source.length) {
        const character = source[offset++];
        if (character === '\\') { offset++; continue; }
        if (character === '"') {
          const value = JSON.parse(source.slice(start, offset));
          requireValue(value.isWellFormed());
          return value;
        }
      }
      invalid();
    };
    const value = depth => {
      requireValue(depth <= 32);
      whitespace();
      const character = source[offset];
      if (character === '"') return string();
      if (character === '{' || character === '[') {
        offset++;
        const object = character === '{';
        const result = object ? {} : [];
        const names = new Set();
        const end = object ? '}' : ']';
        whitespace();
        if (source[offset] === end) { offset++; return result; }
        while (offset < source.length) {
          let name;
          if (object) {
            requireValue(source[offset] === '"');
            name = string();
            requireValue(!names.has(name));
            names.add(name);
            whitespace();
            requireValue(source[offset++] === ':');
          }
          const child = value(depth + 1);
          if (object) Object.defineProperty(result, name, { value: child, enumerable: true, writable: true, configurable: true });
          else result.push(child);
          whitespace();
          if (source[offset] === end) { offset++; return result; }
          requireValue(source[offset++] === ',');
          whitespace();
        }
        invalid();
      }
      for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
        if (source.startsWith(literal, offset)) { offset += literal.length; return result; }
      }
      const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(offset))?.[0];
      requireValue(token !== undefined);
      offset += token.length;
      const number = Number(token);
      requireValue(Number.isFinite(number) && (!integersOnly || (Number.isSafeInteger(number) && !/[.eE]/.test(token))));
      return number;
    };
    const result = value(0);
    whitespace();
    requireValue(offset === source.length);
    return result;
  } catch { invalid(); }
}

function inspectPublic(value, secrets, depth = 0) {
  requireValue(depth <= 32);
  if (typeof value === 'string') {
    requireValue(value.isWellFormed() && !secrets.some(secret => value.includes(secret)));
  } else if (Array.isArray(value)) {
    for (const child of value) inspectPublic(child, secrets, depth + 1);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      requireValue(!RESERVED.has(key.replace(/[-_]/g, '').replace(/[A-Z]/g, character => character.toLowerCase())));
      inspectPublic(key, secrets, depth + 1);
      inspectPublic(child, secrets, depth + 1);
    }
  } else requireValue(value === null || typeof value === 'boolean' || Number.isSafeInteger(value));
}

function validateHook(payload) {
  requireValue(sessionV2UUID(payload?.native_session_id));
  requireValue(typeof payload.cwd === 'string' && isAbsolute(payload.cwd) && resolve(payload.cwd) === payload.cwd
    && !/[\x00-\x1f\x7f]/.test(payload.cwd) && Buffer.byteLength(payload.cwd) <= 4096);
  let extra;
  switch (payload.event) {
    case 'SessionStart':
      requireValue(['startup', 'compact'].includes(payload.source));
      extra = ['source', ...(Object.hasOwn(payload, 'prompt_id') ? ['prompt_id'] : [])];
      requireValue(payload.source === 'compact' || !Object.hasOwn(payload, 'prompt_id'));
      break;
    case 'UserPromptSubmit': extra = ['prompt_id', 'prompt_sha256']; requireValue(sessionV2Nonce(payload.prompt_sha256)); break;
    case 'Stop':
      extra = ['prompt_id', ...(Object.hasOwn(payload, 'background_task_ids') ? ['background_task_ids'] : [])];
      if (Object.hasOwn(payload, 'background_task_ids')) requireValue(Array.isArray(payload.background_task_ids)
        && payload.background_task_ids.length <= 256 && payload.background_task_ids.every(id => typeof id === 'string'
          && id.length > 0 && Buffer.byteLength(id) <= 512 && !/[\x00-\x1f\x7f]/.test(id)));
      break;
    case 'StopFailure':
      extra = ['failure_code', ...(Object.hasOwn(payload, 'prompt_id') ? ['prompt_id'] : [])];
      requireValue(['api_error', 'interrupted', 'unknown'].includes(payload.failure_code)); break;
    case 'SessionEnd': extra = []; break;
    case 'ObservationUnavailable':
      extra = ['reason'];
      requireValue(['invalid_prompt_id', 'invalid_prompt_text', 'unknown_event', 'unsupported_source'].includes(payload.reason)); break;
    default: invalid();
  }
  fields(payload, ['native_session_id', 'cwd', 'event', ...extra]);
  if (extra.includes('prompt_id')) requireValue(sessionV2UUID(payload.prompt_id));
}

function validateWaiterRequest(payload) {
  fields(payload, ['native_session_id', 'cwd', 'prompt_id', 'waiter_generation']);
  requireValue(sessionV2UUID(payload.native_session_id) && sessionV2UUID(payload.prompt_id)
    && sessionV2UUID(payload.waiter_generation) && typeof payload.cwd === 'string'
    && payload.cwd.isWellFormed() && isAbsolute(payload.cwd) && resolve(payload.cwd) === payload.cwd
    && !/[\x00-\x1f\x7f]/.test(payload.cwd) && Buffer.byteLength(payload.cwd) <= 4096);
}

export function validateSessionV2Payload(operation, payload) {
  requireValue(isRecord(payload));
  if (operation === 'hook') return validateHook(payload);
  if (operation === 'hook.poll' || operation === 'hook.cancel') return validateWaiterRequest(payload);
  if (operation === 'bridge.open') return fields(payload, []);
  requireValue(OPERATIONS.has(operation) && sessionV2UUID(payload.bridge_id));
  const { bridge_id: _, ...args } = payload;
  if (['bridge.close', 'bridge.poll', 'readiness.begin'].includes(operation)) return fields(args, []);
  const tool = { 'readiness.ack': 'ack_readiness_probe_v1', 'proposal.emit': 'emit_decision_v1',
    'selection.claim': 'claim_selection_v1', 'selection.complete': 'complete_selection_v1' }[operation];
  if (operation === 'proposal.emit') {
    fields(args.proposal, ['schema_version', 'value']);
    requireValue(args.proposal.schema_version === 'blabee.claude-proposal.v1');
    validateProductToolInput(tool, { ...args, proposal: args.proposal.value });
    requireValue(sessionV2UUID(args.proposal.value.proposal_id) && sessionV2UUID(args.boundary_id));
  } else {
    validateProductToolInput(tool, args);
    for (const key of ['probe_id', 'selection_id']) if (Object.hasOwn(args, key)) requireValue(sessionV2UUID(args[key]));
  }
}

export function validateSessionV2Result(operation, result, payload, channelSource) {
  switch (operation) {
    case 'hook':
      fields(result, ['observed', 'boundary_id', 'observation_status', 'waiter']);
      requireValue(result.observed === true && (result.boundary_id === null || sessionV2UUID(result.boundary_id))
        && ['accepted', 'new_prompt_required', 'invalidated'].includes(result.observation_status));
      requireValue(result.observation_status === 'accepted' || result.boundary_id === null);
      if (result.waiter !== null) {
        fields(result.waiter, ['generation', 'prompt_id', 'boundary_id', 'expires_at_nanoseconds']);
        requireValue(payload.event === 'Stop' && result.observation_status === 'accepted'
          && Array.isArray(payload.background_task_ids) && payload.background_task_ids.length === 0
          && sessionV2UUID(result.waiter.generation) && sessionV2UUID(result.waiter.prompt_id)
          && result.waiter.prompt_id === payload.prompt_id && sessionV2UUID(result.waiter.boundary_id)
          && result.waiter.boundary_id === result.boundary_id && sessionV2UInt64(result.waiter.expires_at_nanoseconds));
      }
      break;
    case 'hook.poll':
      fields(result, ['status', 'event']);
      requireValue(['waiting', 'closed', 'delivered'].includes(result.status));
      if (result.status !== 'delivered') { requireValue(result.event === null); break; }
      fields(result.event, ['kind', 'selection_id', 'delivery_token', 'delivery_sequence', 'expires_at_nanoseconds']);
      requireValue(result.event.kind === 'selection' && sessionV2UUID(result.event.selection_id)
        && sessionV2Nonce(result.event.delivery_token) && sessionV2UInt64(result.event.delivery_sequence, true)
        && sessionV2UInt64(result.event.expires_at_nanoseconds));
      break;
    case 'hook.cancel': fields(result, ['cancelled']); requireValue(typeof result.cancelled === 'boolean'); break;
    case 'bridge.open': fields(result, ['bridge_id']); requireValue(sessionV2UUID(result.bridge_id)); break;
    case 'bridge.close': fields(result, ['closed']); requireValue(result.closed === true); break;
    case 'readiness.begin':
      fields(result, ['probe_id', 'nonce', 'expires_at_nanoseconds', 'status']);
      requireValue(sessionV2UUID(result.probe_id) && sessionV2Nonce(result.nonce)
        && sessionV2UInt64(result.expires_at_nanoseconds) && result.status === 'pending'); break;
    case 'readiness.ack': fields(result, ['acknowledged']); requireValue(result.acknowledged === true); break;
    case 'proposal.emit':
      fields(result, ['packet_id', 'revision']); boundedText(result.packet_id, 512);
      requireValue(Number.isSafeInteger(result.revision) && result.revision > 0); break;
    case 'selection.claim': {
      fields(result, ['selection_id', 'boundary_id', 'prompt_id', 'action']);
      requireValue(result.selection_id === payload.selection_id && sessionV2UUID(result.boundary_id) && sessionV2UUID(result.prompt_id));
      fields(result.action, ['schema_version', 'value']);
      requireValue(result.action.schema_version === 'blabee.claude-action.v1');
      // Reuse the existing inner action rules without expanding the public v1 module.
      const action = result.action.value;
      fields(action, ['id', 'title', 'description', 'task', 'done_when', 'constraints']);
      for (const [key, max] of Object.entries({ id: 64, title: 128, description: 256, task: 2048, done_when: 512 })) boundedText(action[key], max);
      requireValue(Array.isArray(action.constraints) && action.constraints.length <= 32);
      for (const constraint of action.constraints) boundedText(constraint, 1024);
      break;
    }
    case 'selection.complete':
      fields(result, ['selection_id', 'recorded', 'reported_by']);
      requireValue(result.selection_id === payload.selection_id && result.recorded === true && result.reported_by === 'claude'); break;
    case 'bridge.poll': {
      fields(result, ['event']);
      requireValue(result.event === null);
      break;
    }
    default: invalid();
  }
}

async function requirePrivateSocket(socketPath) {
  try {
    const parent = dirname(socketPath);
    const [directory, socket, canonical] = await Promise.all([lstat(parent), lstat(socketPath), realpath(parent)]);
    requireValue(canonical === parent && directory.isDirectory() && !directory.isSymbolicLink()
      && directory.uid === process.getuid() && (directory.mode & 0o077) === 0
      && socket.isSocket() && !socket.isSymbolicLink() && socket.uid === process.getuid() && (socket.mode & 0o077) === 0);
  } catch { throw new SessionV2ClientError('session_v2_invalid_socket'); }
}

/** Explicit v3 wire only. One bounded socket per request, no retries and no fallback.
 * A timeout or malformed response permanently closes this logical client.
 * Only cancellation before the first write leaves this shared client reusable;
 * after writing, the original exchange must finish its response/timeout checks. */
export async function createSessionV2Client({ socketPath, runtimeIdentity, authority, role, authToken, channelSource,
  credentialCorpus = [], timeoutMs = 5000 } = {}) {
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || resolve(socketPath) !== socketPath
      || /[\x00-\x1f\x7f]/.test(socketPath) || Buffer.byteLength(socketPath) > 103
      || typeof runtimeIdentity !== 'string' || runtimeIdentity.length !== 71 || !/^sha256:[0-9a-f]{64}$/.test(runtimeIdentity)
      || !sessionV2Authority(authority) || !['hook', 'bridge'].includes(role) || !sessionV2Nonce(authToken)
      || !sessionV2Source(channelSource) || !Array.isArray(credentialCorpus) || credentialCorpus.some(value => !sessionV2Nonce(value))
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60000) {
    throw new SessionV2ClientError('session_v2_invalid_configuration');
  }
  const identity = Object.freeze({ ...authority });
  const secrets = [...new Set([authToken, ...credentialCorpus])];
  await requirePrivateSocket(socketPath);
  let closed = false;
  let failure;
  let pending;

  const validateEnvelope = request => {
    fields(request, ['schema_version', 'kind', 'provider', 'request_id', 'role', 'operation', 'authority', 'payload']);
    requireValue(request.schema_version === SESSION_V2_WIRE_VERSION && request.kind === 'request'
      && request.provider === 'claude' && request.role === role && sessionV2UUID(request.request_id)
      && sessionV2Authority(request.authority) && SESSION_V2_AUTHORITY_KEYS.every(key => request.authority[key] === identity[key])
      && (role === 'hook' ? HOOK_OPERATIONS.has(request.operation) : OPERATIONS.has(request.operation)));
    validateSessionV2Payload(request.operation, request.payload);
    inspectPublic(request, secrets);
  };
  const parseResponse = (bytes, outerID, request) => {
    requireValue(bytes.indexOf(10) === bytes.length - 1);
    const outer = parseSessionV2JSON(bytes.subarray(0, -1));
    fields(outer, ['request_id', 'runtime_identity', 'ok', outer?.ok === true ? 'result' : 'error']);
    requireValue(outer.request_id === outerID && outer.runtime_identity === runtimeIdentity && typeof outer.ok === 'boolean');
    inspectPublic(outer, secrets);
    if (!outer.ok) {
      fields(outer.error, ['code', 'message']);
      requireValue(typeof outer.error.code === 'string' && /^[a-z0-9_]{1,96}$/.test(outer.error.code)
        && outer.error.message === 'request failed');
      throw new SessionV2ClientError('session_v2_service_rejected');
    }
    const response = outer.result;
    fields(response, ['schema_version', 'kind', 'provider', 'request_id', 'role', 'operation', 'authority', 'ok',
      response?.ok === true ? 'result' : 'error']);
    requireValue(response.schema_version === request.schema_version && response.kind === 'response'
      && response.provider === request.provider && response.request_id === request.request_id
      && response.role === role && response.operation === request.operation && sessionV2Authority(response.authority)
      && SESSION_V2_AUTHORITY_KEYS.every(key => response.authority[key] === identity[key]));
    if (response.ok === false) {
      fields(response.error, ['code']); requireValue(ERROR_CODES.has(response.error.code));
    } else {
      requireValue(response.ok === true);
      validateSessionV2Result(request.operation, response.result, request.payload, channelSource);
    }
    return response;
  };
  const exchange = async (request, { signal } = {}) => {
    if (failure || closed) throw failure ?? new SessionV2ClientError('session_v2_client_closed');
    if (signal?.aborted) throw new SessionV2ClientError('session_v2_request_cancelled');
    if (pending) throw new SessionV2ClientError('session_v2_client_busy');
    let frame;
    const outerID = `claude_${randomUUID()}`;
    try {
      validateEnvelope(request);
      // Snapshot before asynchronous I/O; mutable callers cannot change the
      // correlation, claim binding or serialized payload after admission.
      request = parseSessionV2JSON(Buffer.from(JSON.stringify(request)));
      validateEnvelope(request);
      frame = JSON.stringify({ request_id: outerID, runtime_identity: runtimeIdentity,
        type: 'blabee.runtime-identity.v1/claude_session_v2', payload: { auth_token: authToken, envelope: request } }) + '\n';
      if (Buffer.byteLength(frame) > LIMIT) throw new SessionV2ClientError('session_v2_request_too_large');
    } catch (error) {
      throw new SessionV2ClientError(error?.code === 'session_v2_request_too_large' ? error.code : 'session_v2_invalid_request');
    }
    let settled;
    const active = { socket: undefined, done: new Promise(resolveDone => { settled = resolveDone; }) };
    pending = active;
    try {
      await requirePrivateSocket(socketPath);
      if (closed) throw new SessionV2ClientError('session_v2_client_closed');
      if (signal?.aborted) throw new SessionV2ClientError('session_v2_request_cancelled');
      return await new Promise((resolveRequest, rejectRequest) => {
        let bytes = Buffer.alloc(0);
        let answer;
        let sent = false;
        let cancelled = false;
        const fail = code => {
          if (cancelled) return;
          failure ??= new SessionV2ClientError(code);
          answer = { error: failure };
          active.socket?.destroy();
        };
        const timer = setTimeout(() => fail('session_v2_response_unknown'), timeoutMs);
        const socket = createConnection({ path: socketPath });
        active.socket = socket;
        const cancelBeforeSend = () => {
          if (sent || answer) return;
          cancelled = true;
          answer = { error: new SessionV2ClientError('session_v2_request_cancelled') };
          socket.destroy();
        };
        socket.once('connect', () => {
          if (signal?.aborted) return cancelBeforeSend();
          if (closed || failure) return fail('session_v2_client_closed');
          // Once writing starts the service outcome may be unknown. Keep the
          // FIFO slot until the same response or timeout is fully validated;
          // request cancellation must neither close nor retry that operation.
          sent = true;
          signal?.removeEventListener('abort', cancelBeforeSend);
          socket.write(frame, error => { if (error) fail('session_v2_response_unknown'); });
        });
        socket.on('data', chunk => {
          if (failure || cancelled) return;
          if (bytes.length + chunk.length > LIMIT) return fail('session_v2_invalid_response');
          bytes = Buffer.concat([bytes, chunk]);
        });
        socket.once('end', () => {
          if (failure || cancelled) return;
          try { answer = { value: parseResponse(bytes, outerID, request) }; }
          catch (error) { return fail(error?.code === 'session_v2_service_rejected' ? error.code : 'session_v2_invalid_response'); }
          socket.destroy();
        });
        socket.once('error', () => fail(sent ? 'session_v2_response_unknown' : 'session_v2_unavailable'));
        socket.once('close', () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancelBeforeSend);
          if (!answer) fail(closed ? 'session_v2_client_closed' : 'session_v2_response_unknown');
          if (answer.error) rejectRequest(answer.error); else resolveRequest(answer.value);
        });
        signal?.addEventListener('abort', cancelBeforeSend, { once: true });
        if (signal?.aborted) cancelBeforeSend();
      });
    } finally { pending = undefined; settled(); }
  };
  return {
    exchange,
    async request(command, options) {
      if (!isRecord(command) || !Object.hasOwn(command, 'operation')) throw new SessionV2ClientError('session_v2_invalid_request');
      const { operation, ...payload } = command;
      const response = await exchange({ schema_version: SESSION_V2_WIRE_VERSION, kind: 'request', provider: 'claude',
        request_id: randomUUID(), role, operation, authority: identity, payload }, options);
      if (!response.ok) throw new SessionV2ClientError(`session_v2_${response.error.code}`);
      return response.result;
    },
    async close() {
      closed = true;
      if (pending) {
        failure ??= new SessionV2ClientError('session_v2_client_closed');
        pending.socket?.destroy();
        await pending.done;
      }
    },
  };
}

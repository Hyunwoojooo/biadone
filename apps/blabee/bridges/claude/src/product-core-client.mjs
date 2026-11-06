import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';

const INNER_LIMIT = 128 * 1024;
const OUTER_LIMIT = 256 * 1024;
export const PRODUCT_CORE_ERROR_CODES = Object.freeze([
  'claude_bridge_unauthorized', 'claude_bridge_forbidden', 'claude_bridge_invalid_request',
  'claude_bridge_secret_reflection', 'claude_bridge_configuration_invalid',
  'claude_bridge_response_invalid', 'claude_bridge_response_too_large', 'claude_bridge_disabled',
  'claude_bridge_unavailable',
  'operational_runtime_identity_mismatch', 'operational_runtime_request_not_compatible',
  'operational_request_invalid', 'operational_request_failed', 'operational_response_too_large',
  'raw_continuation_token_forbidden', 'invalid_request', 'invalid_binding', 'invalid_proposal',
  'invalid_selection', 'invalid_completion', 'unknown_operation', 'unknown_selection',
  'unknown_card', 'already_claimed', 'already_completed', 'core_rejected', 'storage_failure',
  'unsupported_version', 'stale_selection', 'session_retired', 'request_too_large',
  'invalid_request_id', 'unsupported_schema_version', 'unsupported_operation',
  'response_too_large', 'invalid_fields', 'invalid_text', 'invalid_proposal_outcome',
  'invalid_options', 'duplicate_option_id', 'invalid_constraints', 'invalid_reported_side_effects',
  'binding_incomplete', 'invalid_claim', 'live_proposal_capacity', 'live_claim_capacity',
  'activation_effect_missing', 'selection_effect_unavailable', 'adapter_internal_error',
  'proposal_too_large', 'snapshot_capacity',
]);
const CORE_PROFILE = {
  schema: 'blabee.claude-bridge.v1', wireType: 'blabee.runtime-identity.v1/claude_bridge_v1',
  requestSchema: '0.1', roles: new Set(['bridge', 'selector']),
  operations: new Set(['activate', 'select', 'claim', 'complete', 'invalidate', 'snapshot']),
  errorCodes: new Set(PRODUCT_CORE_ERROR_CODES),
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => record(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export class ProductCoreError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function containsSecretKey(value, depth = 0) {
  if (depth > 72) return true;
  if (Array.isArray(value)) return value.some(child => containsSecretKey(child, depth + 1));
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    ['auth_token', 'bridge_token', 'selection_token', 'hook_token', 'control_token', 'correlation_token', 'continuation_token'].includes(key)
      || containsSecretKey(child, depth + 1));
}

async function requirePrivateSocket(path) {
  try {
    const parent = dirname(path);
    const [directory, socket, canonical] = await Promise.all([lstat(parent), lstat(path), realpath(parent)]);
    if (canonical !== parent || !directory.isDirectory() || directory.isSymbolicLink()
        || directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0
        || !socket.isSocket() || socket.isSymbolicLink()
        || socket.uid !== process.getuid() || (socket.mode & 0o077) !== 0) {
      throw new Error('unsafe socket');
    }
  } catch { throw new ProductCoreError('invalid_product_core_socket'); }
}

/**
 * Explicit, authenticated connection to the common Coordinator's Claude ingress.
 * A public runtime identity is only a build discriminator; authToken is the
 * scoped credential. Nothing is read from a global runtime or credential file.
 * Each command uses one socket, never retries, and waits for that socket to close.
 */
export async function createProductCoreClient(configuration = {}) {
  return createScopedCoordinatorClient(configuration, CORE_PROFILE);
}

// The profiles are code-defined by the two provider adapters, never supplied
// through an environment/configuration file or an untrusted request.
export async function createScopedCoordinatorClient({
  socketPath, runtimeIdentity, scopeID, sessionID, role, authToken, timeoutMs = 5000,
} = {}, profile) {
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || socketPath.includes('\0')
      || resolve(socketPath) !== socketPath || Buffer.byteLength(socketPath) > 103
      || typeof runtimeIdentity !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(runtimeIdentity)
      || !uuid(scopeID) || typeof sessionID !== 'string' || sessionID.length < 1
      || sessionID.length > 512 || /[\x00-\x20\x7f]/.test(sessionID)
      || !profile.roles.has(role)
      || typeof authToken !== 'string' || !/^[0-9a-f]{64}$/.test(authToken)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new ProductCoreError('invalid_product_core_configuration');
  }
  await requirePrivateSocket(socketPath);
  let failure;
  let closed = false;
  let pending;

  function parseResponse(bytes, outerID, innerID) {
    const newline = bytes.indexOf(10);
    if (newline < 0 || newline !== bytes.length - 1) throw new Error('invalid framing');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline));
    if (text.includes(authToken)) throw new Error('secret response');
    const response = JSON.parse(text);
    const outerKeys = response?.ok === true
      ? ['request_id', 'runtime_identity', 'ok', 'result']
      : ['request_id', 'runtime_identity', 'ok', 'error'];
    if (!keys(response, outerKeys) || typeof response.ok !== 'boolean'
        || response.request_id !== outerID || response.runtime_identity !== runtimeIdentity
        || containsSecretKey(response) || JSON.stringify(response).includes(authToken)) throw new Error('invalid outer response');
    if (!response.ok) {
      if (!keys(response.error, ['code', 'message']) || typeof response.error.code !== 'string'
          || response.error.message !== 'request failed') throw new Error('invalid outer error');
      return { error: new ProductCoreError(profile.errorCodes.has(response.error.code)
        ? response.error.code : 'product_core_rejected') };
    }
    const inner = response.result;
    const innerKeys = ['schema_version', 'provider', 'scope_id', 'session_id', 'role', 'request_id', 'ok',
      inner?.ok === true ? 'result' : 'error'];
    if (!keys(inner, innerKeys) || inner.schema_version !== profile.schema || inner.provider !== 'claude'
        || inner.scope_id !== scopeID || inner.session_id !== sessionID || inner.role !== role
        || inner.request_id !== innerID || typeof inner.ok !== 'boolean'
        || Buffer.byteLength(JSON.stringify(inner)) > INNER_LIMIT) throw new Error('invalid inner response');
    if (inner.ok) {
      if (!record(inner.result)) throw new Error('invalid result');
      return { result: inner.result };
    }
    if (!keys(inner.error, ['code']) || typeof inner.error.code !== 'string') throw new Error('invalid inner error');
    return { error: new ProductCoreError(profile.errorCodes.has(inner.error.code)
      ? inner.error.code : 'product_core_rejected') };
  }

  return {
    async request(command) {
      if (failure || closed) throw failure ?? new ProductCoreError('product_core_closed');
      if (pending) throw new ProductCoreError('product_core_busy');
      if (!record(command) || Object.hasOwn(command, 'schema_version') || Object.hasOwn(command, 'request_id')
          || !profile.operations.has(command.operation)) throw new ProductCoreError('invalid_product_core_request');
      // Preserve the existing Coordinator request ID rule: IDs start with a letter.
      const outerID = `claude_${randomUUID()}`;
      const innerID = randomUUID();
      let frame;
      try {
        const request = { schema_version: profile.requestSchema, request_id: innerID, ...command };
        const inner = JSON.stringify(request);
        if (Buffer.byteLength(inner) > INNER_LIMIT) throw new ProductCoreError('product_core_request_too_large');
        const payload = { schema_version: profile.schema, provider: 'claude', scope_id: scopeID, session_id: sessionID,
          role, auth_token: authToken, request };
        if (Buffer.byteLength(JSON.stringify(payload)) > INNER_LIMIT) throw new ProductCoreError('product_core_request_too_large');
        frame = JSON.stringify({ request_id: outerID, runtime_identity: runtimeIdentity, type: profile.wireType, payload }) + '\n';
        if (Buffer.byteLength(frame) > OUTER_LIMIT) throw new ProductCoreError('product_core_request_too_large');
      } catch (error) {
        throw error instanceof ProductCoreError ? error : new ProductCoreError('invalid_product_core_request');
      }

      let settleClosed;
      const closePromise = new Promise(resolveClose => { settleClosed = resolveClose; });
      const active = { socket: undefined, closePromise };
      pending = active;
      try {
        await requirePrivateSocket(socketPath);
        if (closed) throw new ProductCoreError('product_core_closed');
        return await new Promise((resolveRequest, rejectRequest) => {
          let socket;
          let buffer = Buffer.alloc(0);
          let answer;
          let sent = false;
          const fail = code => {
            failure ??= new ProductCoreError(code);
            answer = { error: failure };
            socket?.destroy();
          };
          const timer = setTimeout(() => fail('product_core_response_unknown'), timeoutMs);
          socket = createConnection({ path: socketPath });
          active.socket = socket;
          socket.once('connect', () => {
            if (closed || failure) return fail('product_core_closed');
            sent = true;
            socket.write(frame, error => { if (error) fail('product_core_response_unknown'); });
          });
          socket.on('data', chunk => {
            if (failure) return;
            if (buffer.length + chunk.length > OUTER_LIMIT) return fail('invalid_product_core_response');
            buffer = Buffer.concat([buffer, chunk]);
          });
          socket.once('end', () => {
            if (failure) return;
            try { answer = parseResponse(buffer, outerID, innerID); }
            catch { return fail('invalid_product_core_response'); }
            socket.destroy();
          });
          socket.once('error', () => fail(sent ? 'product_core_response_unknown' : 'product_core_unavailable'));
          socket.once('close', () => {
            clearTimeout(timer);
            if (!answer) fail(closed ? 'product_core_closed' : 'product_core_response_unknown');
            if (answer.error) rejectRequest(answer.error);
            else resolveRequest(answer.result);
          });
        });
      } finally {
        pending = undefined;
        settleClosed();
      }
    },
    async close() {
      closed = true;
      if (pending) {
        failure ??= new ProductCoreError('product_core_closed');
        pending.socket?.destroy();
        await pending.closePromise;
      }
    },
  };
}

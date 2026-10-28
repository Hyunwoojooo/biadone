import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { exactKeys } from './product-context.mjs';
import { parseSessionV2JSON, SESSION_V2_AUTHORITY_KEYS, sessionV2Nonce, sessionV2UUID } from './session-v2-client.mjs';
import { safeSessionV2ErrorCode, sessionV2Context } from './session-v2-context.mjs';

export const AUTO_CONNECT_SCHEMA = 'blabee.claude-launch-bootstrap.v1';
const PREFIX = 'BLABEE_CLAUDE_BOOTSTRAP_';
const SESSION = 'BLABEE_CLAUDE_SESSION_V2_';
const LIMIT = 16 * 1024;
const REMOTE_CODES = new Set(['claude_bootstrap_unauthorized', 'claude_bootstrap_invalid_request',
  'claude_bootstrap_unavailable', 'claude_bootstrap_session_changed', 'claude_bootstrap_already_started']);
const LOCAL_CODES = new Set(['auto_connect_invalid_configuration', 'auto_connect_invalid_socket',
  'auto_connect_invalid_response', 'auto_connect_invalid_request', 'auto_connect_unavailable',
  'auto_connect_response_unknown', 'auto_connect_closed', 'auto_connect_busy', 'auto_connect_pending']);
const PUBLIC_KEYS = [...SESSION_V2_AUTHORITY_KEYS.map(key => SESSION + key.toUpperCase()),
  ...['SOCKET', 'RUNTIME_IDENTITY', 'CWD', 'CHANNEL_SOURCE'].map(key => SESSION + key)];

export class AutoConnectError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const safeAutoConnectErrorCode = error => REMOTE_CODES.has(error?.code) || LOCAL_CODES.has(error?.code)
  ? error.code : safeSessionV2ErrorCode(error);
const requireValue = (value, code = 'auto_connect_invalid_response') => {
  if (!value) throw new AutoConnectError(code);
};
const fields = (value, names) => {
  try { exactKeys(value, names); } catch { throw new AutoConnectError('auto_connect_invalid_response'); }
};
const absolute = (value, maximum = 4096) => typeof value === 'string' && value.isWellFormed()
  && isAbsolute(value) && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value)
  && Buffer.byteLength(value) <= maximum;

async function canonicalDirectory(path, code) {
  try {
    requireValue(absolute(path) && await realpath(path) === path && (await lstat(path)).isDirectory(), code);
  } catch { throw new AutoConnectError(code); }
}

async function privateSocket(path) {
  try {
    requireValue(absolute(path, 103));
    const parent = dirname(path);
    const [directory, socket, canonical] = await Promise.all([lstat(parent), lstat(path), realpath(parent)]);
    requireValue(canonical === parent && directory.isDirectory() && !directory.isSymbolicLink()
      && directory.uid === process.getuid() && (directory.mode & 0o077) === 0
      && socket.isSocket() && !socket.isSymbolicLink() && socket.uid === process.getuid() && (socket.mode & 0o077) === 0);
  } catch { throw new AutoConnectError('auto_connect_invalid_socket'); }
}

/** Private per-launch admission only. No saved settings, prior v2 authority or
 * owner capability is accepted as a bootstrap fallback. Actual Hook identity is
 * sent unchanged so a valid mismatch can retire the supervisor's authority. */
export async function createAutoConnectClient({ role, env = process.env, nativeSessionID, cwd,
  signal, startTimeoutMs = 10000, grantTimeoutMs = 2000, pollIntervalMs = 100 } = {}) {
  const socketPath = env[PREFIX + 'SOCKET'];
  const launchCWD = env[PREFIX + 'CWD'];
  const authToken = env[PREFIX + (role === 'hook' ? 'HOOK_TOKEN' : 'BRIDGE_TOKEN')];
  const secrets = [env[PREFIX + 'HOOK_TOKEN'], env[PREFIX + 'BRIDGE_TOKEN']].filter(sessionV2Nonce);
  nativeSessionID ??= role === 'bridge' ? env.CLAUDE_CODE_SESSION_ID : undefined;
  cwd ??= launchCWD;
  requireValue(['hook', 'bridge'].includes(role) && sessionV2UUID(nativeSessionID) && sessionV2Nonce(authToken)
    && absolute(socketPath, 103) && [startTimeoutMs, grantTimeoutMs].every(value => Number.isSafeInteger(value)
      && value >= 10 && value <= 30000) && Number.isSafeInteger(pollIntervalMs) && pollIntervalMs >= 10 && pollIntervalMs <= 1000,
  'auto_connect_invalid_configuration');
  for (const [key, value] of Object.entries(env)) {
    if (!value || !key.startsWith('BLABEE_')) continue;
    requireValue(!key.startsWith(SESSION) && !/(?:OWNER|SELECTOR|SELECTION|CONTROL)_(?:TOKEN|CAPABILITY|HANDLE)$/.test(key)
      && !(role === 'bridge' && /HOOK_(?:TOKEN|CAPABILITY)$/.test(key))
      && (!/_(?:TOKEN|CAPABILITY)$/.test(key) || [PREFIX + 'HOOK_TOKEN', PREFIX + 'BRIDGE_TOKEN'].includes(key)),
    'auto_connect_invalid_configuration');
  }
  await canonicalDirectory(launchCWD, 'auto_connect_invalid_configuration');
  await canonicalDirectory(cwd, 'auto_connect_invalid_configuration');
  await privateSocket(socketPath);
  let closed = false;
  let failure;
  let pending;
  let delay;
  let started = false;
  let waiting = false;
  const unavailable = () => failure ?? new AutoConnectError('auto_connect_closed');
  const close = async () => {
    closed = true;
    signal?.removeEventListener('abort', onAbort);
    pending?.cancel();
    delay?.cancel();
    await pending?.done;
  };
  const onAbort = () => { void close(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) { await close(); throw unavailable(); }

  const grantEnvironment = async value => {
    fields(value, [...PUBLIC_KEYS, SESSION + (role === 'hook' ? 'HOOK_TOKEN' : 'BRIDGE_TOKEN')]);
    requireValue(Object.values(value).every(item => typeof item === 'string' && item.isWellFormed()
      && !secrets.some(secret => item.includes(secret))));
    requireValue(value[SESSION + 'NATIVE_SESSION_ID'] === nativeSessionID && value[SESSION + 'CWD'] === cwd
      && absolute(value[SESSION + 'SOCKET'], 103) && /^sha256:[0-9a-f]{64}$/.test(value[SESSION + 'RUNTIME_IDENTITY']));
    try { await sessionV2Context(role, { env: value, expectedSessionID: nativeSessionID }); }
    catch { throw new AutoConnectError('auto_connect_invalid_response'); }
    await privateSocket(value[SESSION + 'SOCKET']);
    return Object.freeze({ ...value });
  };

  const parseResponse = async (bytes, requestID, operation) => {
    requireValue(bytes.indexOf(10) === bytes.length - 1);
    let response;
    try { response = parseSessionV2JSON(bytes.subarray(0, -1), { maximumBytes: LIMIT }); }
    catch { throw new AutoConnectError('auto_connect_invalid_response'); }
    requireValue(response?.schema_version === AUTO_CONNECT_SCHEMA && response.request_id === requestID);
    if (response.ok === false) {
      fields(response, ['schema_version', 'request_id', 'ok', 'error']);
      fields(response.error, ['code']);
      requireValue(REMOTE_CODES.has(response.error.code));
      throw new AutoConnectError(response.error.code);
    }
    requireValue(response.ok === true && ['pending', 'ready'].includes(response.status));
    fields(response, ['schema_version', 'request_id', 'ok', 'status', ...(response.status === 'ready' ? ['environment'] : [])]);
    if (response.status === 'pending') {
      requireValue(operation === 'grant');
      return { status: 'pending' };
    }
    return { status: 'ready', environment: await grantEnvironment(response.environment) };
  };

  const exchange = async (operation, source) => {
    if (closed || failure) throw unavailable();
    if (pending) throw new AutoConnectError('auto_connect_busy');
    const requestID = randomUUID();
    const frame = JSON.stringify({ schema_version: AUTO_CONNECT_SCHEMA, request_id: requestID, operation,
      role, auth_token: authToken, native_session_id: nativeSessionID, cwd,
      ...(operation === 'start' ? { source } : {}) }) + '\n';
    let finishDone;
    const active = { cancel: () => {}, done: new Promise(resolveDone => { finishDone = resolveDone; }) };
    pending = active;
    try {
      await privateSocket(socketPath);
      if (closed || failure) throw unavailable();
      return await new Promise((resolveRequest, rejectRequest) => {
        let bytes = Buffer.alloc(0);
        let sent = false;
        let settled = false;
        const socket = createConnection({ path: socketPath });
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          if (error) { failure ??= error; rejectRequest(failure); }
          else resolveRequest(value);
        };
        active.cancel = () => finish(unavailable());
        const timer = setTimeout(() => finish(new AutoConnectError('auto_connect_response_unknown')),
          operation === 'start' ? startTimeoutMs : grantTimeoutMs);
        socket.once('connect', () => {
          if (closed || failure) return finish(unavailable());
          sent = true;
          socket.write(frame, error => { if (error) finish(new AutoConnectError('auto_connect_response_unknown')); });
        });
        socket.on('data', chunk => {
          if (bytes.length + chunk.length > LIMIT) return finish(new AutoConnectError('auto_connect_invalid_response'));
          bytes = Buffer.concat([bytes, chunk]);
        });
        let ended = false;
        socket.once('end', () => {
          ended = true;
          void parseResponse(bytes, requestID, operation).then(value => {
            if (closed || failure) finish(unavailable()); else finish(null, value);
          }, error => finish(error));
        });
        socket.once('error', () => finish(new AutoConnectError(sent ? 'auto_connect_response_unknown' : 'auto_connect_unavailable')));
        socket.once('close', () => { if (!ended) finish(new AutoConnectError('auto_connect_response_unknown')); });
      });
    } catch (error) { failure ??= error; throw failure; }
    finally { pending = undefined; finishDone(); }
  };
  const pause = () => new Promise((resolveDelay, rejectDelay) => {
    if (closed || failure) return rejectDelay(unavailable());
    const finish = error => {
      clearTimeout(timer);
      delay = undefined;
      if (error) rejectDelay(error); else resolveDelay();
    };
    const timer = setTimeout(() => finish(), pollIntervalMs);
    delay = { cancel: () => finish(unavailable()) };
  });
  return {
    async start(source) {
      if (role !== 'hook' || started || !['startup', 'resume', 'fork'].includes(source)) {
        throw new AutoConnectError('auto_connect_invalid_request');
      }
      started = true;
      return exchange('start', source);
    },
    grant: () => exchange('grant'),
    async waitForGrant() {
      if (waiting) throw new AutoConnectError('auto_connect_busy');
      waiting = true;
      try {
        while (true) {
          const result = await exchange('grant');
          if (result.status === 'ready') return result;
          // Only the read-only pending grant is polled. Start and any unknown
          // result are terminal and are never automatically retried.
          await pause();
        }
      } finally { waiting = false; }
    },
    close,
  };
}

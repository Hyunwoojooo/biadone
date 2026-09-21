import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const VERSION = '0.1';
const MAX_BYTES = 128 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const CODES = new Set([
  'invalid_request', 'invalid_binding', 'invalid_proposal', 'invalid_selection',
  'invalid_completion', 'unknown_operation', 'unknown_selection', 'unknown_card',
  'already_claimed', 'already_completed', 'core_rejected', 'storage_failure',
  'unsupported_version', 'stale_selection', 'session_retired',
  'request_too_large', 'invalid_request_id', 'unsupported_schema_version',
  'unsupported_operation', 'response_too_large', 'invalid_fields', 'invalid_text',
  'invalid_proposal_outcome', 'invalid_options', 'duplicate_option_id',
  'invalid_constraints', 'invalid_reported_side_effects', 'binding_incomplete',
  'invalid_claim', 'live_proposal_capacity', 'live_claim_capacity',
  'activation_effect_missing', 'selection_effect_unavailable',
  'adapter_internal_error', 'proposal_too_large', 'snapshot_capacity',
]);

export class SharedCoreError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => record(value) && Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key));

/**
 * Private, inherited-stdio connection to the shared Swift engine qualification
 * executable. This is not a production endpoint or an authentication adapter.
 * A timeout or lost response poisons this connection; requests are never replayed.
 */
export async function startSharedCore({ executable, fixtureRuntime, timeoutMs = 5000, spawnProcess = spawn } = {}) {
  if (typeof executable !== 'string' || !isAbsolute(executable)
      || typeof fixtureRuntime !== 'string' || !isAbsolute(fixtureRuntime)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new SharedCoreError('invalid_shared_core_configuration');
  }
  const [binary, directory] = await Promise.all([lstat(executable), lstat(fixtureRuntime)]);
  if (!binary.isFile() || !directory.isDirectory() || directory.isSymbolicLink()
      || directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0
      || await realpath(fixtureRuntime) !== fixtureRuntime) {
    throw new SharedCoreError('invalid_shared_core_configuration');
  }
  await access(executable, constants.X_OK);
  const child = spawnProcess(executable, ['--fixture-runtime', fixtureRuntime], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // This fixture receives no native app UI/session authority from its parent.
    env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
  });
  let buffer = Buffer.alloc(0);
  let failure;
  let ending = false;
  let exited = false;
  let stopTimer;
  let killTimer;
  const pending = new Map();
  let resolveExit;
  const exit = new Promise(resolve => { resolveExit = resolve; });

  function stopOwnedChild() {
    if (exited || stopTimer) return;
    child.stdin.end();
    stopTimer = setTimeout(() => {
      if (!exited) child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 300);
    }, 300);
  }

  function fail(code) {
    failure ??= new SharedCoreError(code);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(failure);
    }
    pending.clear();
    stopOwnedChild();
  }

  child.once('error', () => fail('shared_core_unavailable'));
  child.stdin.on('error', () => fail('shared_core_closed'));
  child.stdout.on('error', () => fail('shared_core_closed'));
  child.stderr.on('error', () => fail('shared_core_closed'));
  // Diagnostics are deliberately not returned as protocol errors or model text.
  child.stderr.resume();
  child.once('close', () => {
    exited = true;
    clearTimeout(stopTimer);
    clearTimeout(killTimer);
    if (pending.size || !ending) fail('shared_core_closed');
    resolveExit();
  });
  child.stdout.on('data', chunk => {
    if (failure) return;
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newline = buffer.indexOf(10);
      if (newline < 0) {
        if (buffer.length > MAX_BYTES) fail('invalid_shared_core_response');
        return;
      }
      if (newline > MAX_BYTES) return fail('invalid_shared_core_response');
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      let response;
      try { response = JSON.parse(utf8.decode(line)); }
      catch { return fail('invalid_shared_core_response'); }
      const expected = response?.ok === true
        ? ['schema_version', 'request_id', 'ok', 'result']
        : ['schema_version', 'request_id', 'ok', 'error'];
      if (!keys(response, expected) || response.schema_version !== VERSION
          || typeof response.ok !== 'boolean' || !pending.has(response.request_id)
          || (response.ok ? !record(response.result)
            : !keys(response.error, ['code']) || typeof response.error.code !== 'string')) {
        return fail('invalid_shared_core_response');
      }
      const request = pending.get(response.request_id);
      pending.delete(response.request_id);
      clearTimeout(request.timer);
      if (response.ok) request.resolve(response.result);
      else request.reject(new SharedCoreError(CODES.has(response.error.code) ? response.error.code : 'shared_core_rejected'));
    }
  });

  return {
    request(command) {
      if (failure || ending || exited) return Promise.reject(failure ?? new SharedCoreError('shared_core_closed'));
      if (!record(command) || Object.hasOwn(command, 'request_id') || Object.hasOwn(command, 'schema_version')
          || typeof command.operation !== 'string' || pending.size >= 32) {
        return Promise.reject(new SharedCoreError('invalid_shared_core_request'));
      }
      const requestID = randomUUID();
      let message;
      try { message = JSON.stringify({ schema_version: VERSION, request_id: requestID, ...command }) + '\n'; }
      catch { return Promise.reject(new SharedCoreError('invalid_shared_core_request')); }
      if (Buffer.byteLength(message) > MAX_BYTES) return Promise.reject(new SharedCoreError('shared_core_request_too_large'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail('shared_core_response_unknown'), timeoutMs);
        pending.set(requestID, { resolve, reject, timer });
        child.stdin.write(message, error => { if (error) fail('shared_core_closed'); });
      });
    },
    async close() {
      ending = true;
      if (pending.size) fail('shared_core_closed');
      else stopOwnedChild();
      await exit;
    },
  };
}

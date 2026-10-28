import { setTimeout as delay } from 'node:timers/promises';
import { SessionV2ClientError, validateSessionV2Payload, validateSessionV2Result } from './session-v2-client.mjs';

export const SESSION_V2_HOOK_REWAKE = Symbol('blabee-claude-hook-rewake');

// Canonical UTF-8 stderr bytes, including the final LF. The server can bind a
// verified native continuation to these exact bytes; keep rendering centralized.
// Native prompt wrappers are observed by Claude, never constructed here.
export function sessionV2SelectionNotice(event) {
  validateSessionV2Result('hook.poll', { status: 'delivered', event }, {});
  return 'Blabee Stop Hook selection reference. Call claim_selection_v1 with these values; '
    + 'execute only the returned action after a successful claim.\n'
    + JSON.stringify({ selection_id: event.selection_id, delivery_token: event.delivery_token }) + '\n';
}

/** One real Stop owns one immutable waiter. Polls and cancellation never overlap.
 * Server timestamps use mach_continuous_time, so they are not compared with
 * Node's potentially different clock. The server enforces its original expiry;
 * the local wall/monotonic budget only shortens the lifetime (including sleep).
 */
export function createSessionV2HookWaiter({ client, observation, waiter, signal, emitSelection,
  cancelRequest = command => client.request(command),
  wait = (milliseconds, options) => delay(milliseconds, undefined, options),
  now = () => performance.now(), wallNow = Date.now, maxWaitMs = 600_000 } = {}) {
  if (!client || typeof client.request !== 'function' || typeof emitSelection !== 'function' || typeof cancelRequest !== 'function'
      || typeof wait !== 'function' || typeof now !== 'function' || typeof wallNow !== 'function'
      || !Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1 || maxWaitMs > 600_000) {
    throw new SessionV2ClientError('session_v2_waiter_invalid_configuration');
  }
  validateSessionV2Result('hook', { observed: true, boundary_id: waiter?.boundary_id,
    observation_status: 'accepted', waiter }, observation);
  const binding = Object.freeze({ native_session_id: observation.native_session_id, cwd: observation.cwd,
    prompt_id: observation.prompt_id, waiter_generation: waiter.generation });
  validateSessionV2Payload('hook.poll', binding);
  const expires = BigInt(waiter.expires_at_nanoseconds);
  const began = now(), wallBegan = wallNow();
  const remaining = () => maxWaitMs - Math.max(now() - began, wallNow() - wallBegan, 0);
  const stopping = new AbortController();
  let active;
  let cancellation;
  let started = false;
  let cancelled = false;
  let closed = false;
  let delivered = false;
  let expired = false;
  const request = command => {
    const pending = Promise.resolve().then(() => {
      if (command.operation === 'hook.poll' && cancelled) throw new SessionV2ClientError('session_v2_client_closed');
      return client.request(command);
    });
    active = pending;
    return pending.finally(() => { if (active === pending) active = undefined; });
  };
  const cancel = () => {
    cancelled = true;
    stopping.abort();
    if (cancellation) return cancellation;
    cancellation = (async () => {
      // A sent RPC must finish its bounded response validation before another
      // request is admitted. Cancel is best effort and is never retried.
      await active?.catch(() => {});
      if (closed) return;
      try {
        const result = await cancelRequest({ operation: 'hook.cancel', ...binding });
        validateSessionV2Result('hook.cancel', result, binding);
      } catch { /* Unknown cancellation cannot authorize output or retry. */ }
    })();
    return cancellation;
  };
  const abort = () => { void cancel(); };
  signal?.addEventListener('abort', abort, { once: true });
  const budget = setTimeout(() => { expired = true; void cancel(); }, maxWaitMs);
  const requireActive = () => {
    if (remaining() <= 0) { expired = true; void cancel(); }
    if (signal?.aborted || cancelled) throw new SessionV2ClientError(expired
      ? 'session_v2_waiter_expired' : 'session_v2_client_closed');
  };
  return {
    cancel,
    async run() {
      if (started) throw new SessionV2ClientError('session_v2_client_closed');
      started = true;
      try {
        while (true) {
          requireActive();
          await wait(Math.min(500, remaining()), { signal: stopping.signal });
          requireActive();
          const result = await request({ operation: 'hook.poll', ...binding });
          requireActive();
          validateSessionV2Result('hook.poll', result, binding);
          if (result.status === 'closed') { closed = true; return false; }
          if (result.status === 'waiting') continue;
          if (BigInt(result.event.expires_at_nanoseconds) > expires) {
            throw new SessionV2ClientError('session_v2_invalid_response');
          }
          // Consume locally before writing. Failed/partial output is terminal;
          // the service has already consumed the delivery before its response.
          delivered = true;
          requireActive();
          await emitSelection(sessionV2SelectionNotice(result.event), { signal: stopping.signal,
            timeoutMs: Math.max(1, Math.min(2500, Math.floor(remaining()))) });
          requireActive();
          return true;
        }
      } catch (error) {
        await cancel();
        if (signal?.aborted || expired) throw new SessionV2ClientError(expired
          ? 'session_v2_waiter_expired' : 'session_v2_client_closed');
        throw error;
      } finally { clearTimeout(budget); }
    },
    async dispose() {
      clearTimeout(budget);
      if (signal?.aborted || (!delivered && !closed)) await cancel();
      await cancellation;
      signal?.removeEventListener('abort', abort);
    },
  };
}

/** One bounded native Hook write. Never retry a failed or partially drained pipe. */
export async function writeSessionV2HookOutput(output, text, { signal, timeoutMs = 2500 } = {}) {
  return new Promise((resolveWrite, rejectWrite) => {
    let settled = false;
    const cleanupOutput = () => {
      output.off?.('error', failed); output.off?.('close', closed);
    };
    const finish = error => {
      if (settled) return;
      const unknown = error || output.destroyed || output.closed || output.errored;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // Timeout/abort settles our bounded wait, not the actual pipe write.
      // Its callback or destruction can still emit EPIPE afterwards. Retain
      // one error guard until close, including after a late success callback.
      if (!unknown) cleanupOutput();
      if (unknown) rejectWrite(new SessionV2ClientError('session_v2_hook_output_unknown')); else resolveWrite();
    };
    const failed = () => finish(true);
    const closed = () => { finish(true); cleanupOutput(); };
    const abort = () => finish(true);
    const timer = setTimeout(failed, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (typeof output.on === 'function') output.on('error', failed);
    else output.once?.('error', failed);
    output.once?.('close', closed);
    if (signal?.aborted || output.destroyed || output.writableEnded) {
      failed();
      // An already closed pipe may have emitted close before this call, or
      // merely queued error/close for nextTick. Give those pending events a
      // turn before removing the guard for an attempted write of zero bytes.
      if (output.closed) setImmediate(cleanupOutput);
      return;
    }
    try {
      if (typeof output.once === 'function') output.write(text, error => finish(error));
      else Promise.resolve(output.write(text)).then(() => finish(), failed);
    } catch { failed(); }
  });
}

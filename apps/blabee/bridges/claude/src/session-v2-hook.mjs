import { pathToFileURL } from 'node:url';
import { expectedSessionArgument, ProductBridgeInputError } from './product-context.mjs';
import { createSessionV2Client, parseSessionV2JSON, SessionV2ClientError, validateSessionV2Result } from './session-v2-client.mjs';
import { SESSION_V2_WORKFLOW_INSTRUCTIONS, safeSessionV2ErrorCode, sessionV2Context } from './session-v2-context.mjs';
import { normalizeSessionV2Hook } from './session-v2-lifecycle.mjs';
import { createSessionV2HookWaiter, SESSION_V2_HOOK_REWAKE, writeSessionV2HookOutput } from './session-v2-waiter.mjs';

export async function handleSessionV2Hook(input, { env = process.env, expectedSessionID, signal,
  createClient = createSessionV2Client, emitSelection, waiterOptions } = {}) {
  const requireActive = () => {
    if (signal?.aborted) throw new SessionV2ClientError('session_v2_client_closed');
  };
  requireActive();
  // Validate the enrolled connection before accepting raw native observations.
  const context = await sessionV2Context('hook', { env, expectedSessionID });
  requireActive();
  const payload = normalizeSessionV2Hook(input);
  // Never substitute the configured native ID/cwd or synthesize native input.
  // The service must observe valid mismatches to retire unsupported sessions.
  // Only the same native session's authenticated MCP claim grants an action.
  let client;
  let closing;
  let requestStarted = false;
  let waiter;
  let resultContext = null;
  const closeClient = () => {
    if (client && !closing) closing = Promise.resolve().then(() => client.close());
    return closing;
  };
  let rejectCancellation;
  const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
  // Cancellation may arrive while filesystem validation or client admission
  // is pending. Reject the local wait immediately and close any late client;
  // never let its eventual result start a request or publish a boundary.
  cancelled.catch(() => {});
  const abort = () => {
    // Stop may return a just-created waiter. Preserve the in-flight response
    // before cancelling that exact generation; other observations publish no
    // waiter and retain their prompt cancellation behavior.
    if (waiter) void waiter.cancel();
    else if (payload.event !== 'Stop' || !requestStarted) void closeClient()?.catch(() => {});
    rejectCancellation(new SessionV2ClientError('session_v2_client_closed'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    requireActive();
    const admission = Promise.resolve().then(() => {
      requireActive();
      return createClient(context.configuration);
    }).then(async admitted => {
      client = admitted;
      if (signal?.aborted) {
        await closeClient();
        requireActive();
      }
    });
    await Promise.race([admission, cancelled]);
    requireActive();
    requestStarted = true;
    const observation = client.request({ operation: 'hook', ...payload }, { signal });
    const result = await (payload.event === 'Stop' ? observation : Promise.race([observation, cancelled]));
    validateSessionV2Result('hook', result, payload, context.channelSource);
    if (result.waiter !== null) {
      waiter = createSessionV2HookWaiter({ ...waiterOptions, client, observation: payload,
        waiter: result.waiter, signal, emitSelection: emitSelection ?? (async () => {
          throw new SessionV2ClientError('session_v2_hook_output_unknown');
        }), cancelRequest: async command => {
          // An unknown poll poisons its transport client. Retire only this
          // exact generation through a fresh client with the same authority;
          // no observation, poll, delivery or mutation is replayed.
          let canceller;
          try { canceller = await createClient(context.configuration); return await canceller.request(command); }
          finally { await canceller?.close(); }
        } });
      if (await waiter.run()) resultContext = SESSION_V2_HOOK_REWAKE;
    }
    requireActive();
    if (['SessionStart', 'UserPromptSubmit'].includes(payload.event)) {
      const boundary = result.observation_status === 'accepted' && result.boundary_id
        ? `현재 blabee-claude boundary_id=${result.boundary_id}`
        : '아직 유효한 작업 boundary가 없습니다. 다음 실제 UserPromptSubmit Hook을 기다리세요. 이전 값을 재사용하지 마세요.';
      resultContext = { hookSpecificOutput: { hookEventName: payload.event,
        additionalContext: `${SESSION_V2_WORKFLOW_INSTRUCTIONS}\n${boundary}` } };
    }
  } finally {
    try { await closeClient(); }
    finally {
      await waiter?.dispose();
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) await waiter?.cancel();
    }
  }
  requireActive();
  return resultContext;
}

// Native JSON contains metadata and unused assistant text. A 128 KiB decoded
// prompt alone can require 768 KiB after JSON escaping. Bound this outer input
// separately; normalization still limits prompt bytes and sends only its hash.
const MAX_NATIVE_HOOK_BYTES = 1024 * 1024;

export async function readSessionV2HookInput(stream, { maxBytes = MAX_NATIVE_HOOK_BYTES, timeoutMs = 2500 } = {}) {
  return new Promise((resolveInput, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData); stream.off('end', onEnd); stream.off('error', onError);
      stream.pause();
      if (error) reject(error); else resolveInput(value);
    };
    const onData = chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) return finish(new ProductBridgeInputError('hook_input_too_large'));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      try { finish(null, parseSessionV2JSON(Buffer.concat(chunks), { maximumBytes: maxBytes, integersOnly: false })); }
      catch { finish(new ProductBridgeInputError('invalid_hook_json')); }
    };
    const onError = () => finish(new ProductBridgeInputError('hook_input_error'));
    const timer = setTimeout(() => finish(new ProductBridgeInputError('hook_input_timeout')), timeoutMs);
    stream.on('data', onData); stream.once('end', onEnd); stream.once('error', onError);
  });
}

export async function runSessionV2Hook({ args = process.argv.slice(2), env = process.env,
  input = process.stdin, output = process.stdout, errorOutput = process.stderr, signal,
  createClient = createSessionV2Client, waiterOptions } = {}) {
  const controller = new AbortController();
  let reading = false;
  const abort = () => {
    controller.abort();
    if (reading) input.destroy(new SessionV2ClientError('session_v2_client_closed'));
  };
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new SessionV2ClientError('session_v2_client_closed');
    const expectedSessionID = expectedSessionArgument(args);
    let value;
    reading = true;
    try { value = await readSessionV2HookInput(input); }
    finally { reading = false; }
    const result = await handleSessionV2Hook(value, {
      env, expectedSessionID, signal: controller.signal, createClient, waiterOptions,
      emitSelection: (text, options) => writeSessionV2HookOutput(errorOutput, text, options),
    });
    if (controller.signal.aborted) throw new SessionV2ClientError('session_v2_client_closed');
    if (result === SESSION_V2_HOOK_REWAKE) return 2;
    if (result) await writeSessionV2HookOutput(output, JSON.stringify(result) + '\n', { signal: controller.signal });
    return 0;
  } catch (error) {
    const code = controller.signal.aborted ? 'session_v2_client_closed' : safeSessionV2ErrorCode(error);
    if (error?.code !== 'session_v2_hook_output_unknown') {
      try { await writeSessionV2HookOutput(errorOutput,
        `[blabee-claude] 제품 Hook을 확인하지 못했습니다 (${code}).\n`, { timeoutMs: 250 }); }
      catch { /* A failed diagnostic cannot repeat a selected reference. */ }
    }
    // Failure adds no usable context or native permission override. A service
    // outage alone need not block ordinary Claude use outside Blabee.
    return ['session_v2_unavailable', 'session_v2_response_unknown', 'session_v2_invalid_socket',
      'session_v2_client_closed', 'session_v2_waiter_expired'].includes(code) ? 0 : 1;
  } finally {
    reading = false;
    signal?.removeEventListener('abort', abort);
    process.off('SIGINT', abort); process.off('SIGTERM', abort);
  }
}

// Output was drained or declared unknown above. A backpressured native pipe
// must not keep an abandoned Hook alive and flush a stale reference later.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await runSessionV2Hook());

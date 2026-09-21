import { pathToFileURL } from 'node:url';
import { expectedSessionArgument, ProductBridgeInputError } from './product-context.mjs';
import { createSessionV2Client, parseSessionV2JSON, SessionV2ClientError, validateSessionV2Result } from './session-v2-client.mjs';
import { SESSION_V2_WORKFLOW_INSTRUCTIONS, safeSessionV2ErrorCode, sessionV2Context } from './session-v2-context.mjs';
import { normalizeSessionV2Hook } from './session-v2-lifecycle.mjs';

export async function handleSessionV2Hook(input, { env = process.env, expectedSessionID, signal,
  createClient = createSessionV2Client } = {}) {
  const requireActive = () => {
    if (signal?.aborted) throw new SessionV2ClientError('session_v2_client_closed');
  };
  requireActive();
  // Validate the enrolled connection before accepting raw native observations.
  const context = await sessionV2Context('hook', { env, expectedSessionID });
  requireActive();
  const payload = normalizeSessionV2Hook(input);
  // Never substitute the configured native ID/cwd or rewrite Channel input.
  // The service must observe valid mismatches to retire unsupported sessions;
  // its enrolled source + full body + one-use ref decide continuation binding.
  let client;
  let closing;
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
    void closeClient()?.catch(() => {});
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
    const result = await Promise.race([client.request({ operation: 'hook', ...payload }), cancelled]);
    requireActive();
    validateSessionV2Result('hook', result, payload, context.channelSource);
    if (['SessionStart', 'UserPromptSubmit'].includes(payload.event)) {
      const boundary = result.observation_status === 'accepted' && result.boundary_id
        ? `현재 blabee-claude boundary_id=${result.boundary_id}`
        : '아직 유효한 작업 boundary가 없습니다. 다음 실제 UserPromptSubmit Hook을 기다리세요. 이전 값을 재사용하지 마세요.';
      resultContext = { hookSpecificOutput: { hookEventName: payload.event,
        additionalContext: `${SESSION_V2_WORKFLOW_INSTRUCTIONS}\n${boundary}` } };
    }
  } finally {
    try { await closeClient(); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  requireActive();
  return resultContext;
}

export async function readSessionV2HookInput(stream, { maxBytes = 128 * 1024, timeoutMs = 2500 } = {}) {
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
  createClient = createSessionV2Client } = {}) {
  try {
    const result = await handleSessionV2Hook(await readSessionV2HookInput(input), {
      env, expectedSessionID: expectedSessionArgument(args), signal, createClient,
    });
    if (signal?.aborted) throw new SessionV2ClientError('session_v2_client_closed');
    if (result) output.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (error) {
    const code = safeSessionV2ErrorCode(error);
    errorOutput.write(`[blabee-claude] 제품 Hook을 확인하지 못했습니다 (${code}).\n`);
    // Failure adds no usable context or native permission override. A service
    // outage alone need not block ordinary Claude use outside Blabee.
    return ['session_v2_unavailable', 'session_v2_response_unknown', 'session_v2_invalid_socket',
      'session_v2_client_closed'].includes(code) ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runSessionV2Hook();

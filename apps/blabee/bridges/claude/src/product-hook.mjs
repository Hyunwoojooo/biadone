import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativeSessionClient } from './native-session-client.mjs';
import { ProductBridgeInputError, exactKeys, expectedSessionArgument, isRecord, isUUID,
  productBoundaryContext, productContext, safeProductErrorCode } from './product-context.mjs';

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);

async function rejectUnavailableObservation(context, input, reason, code, createClient) {
  let client;
  try {
    client = await createClient(context.configuration);
    const result = await client.request({ operation: 'hook', event: 'ObservationUnavailable',
      session_id_native: input.session_id, cwd: input.cwd, reason });
    exactKeys(result, ['invalidated'], 'invalid_boundary_response');
    if (result.invalidated !== true) throw new ProductBridgeInputError('invalid_boundary_response');
  } catch {
    // One best-effort invalidation is never replayed. Its delivery cannot turn
    // malformed native input into a valid boundary, and failure is not success.
  } finally {
    try { await client?.close(); } catch { /* Preserve the original input error. */ }
  }
  throw new ProductBridgeInputError(code);
}

export async function handleProductHook(input, {
  env = process.env, expectedSessionID, createClient = createNativeSessionClient,
} = {}) {
  const context = await productContext('hook', { env, expectedSessionID });
  if (!isRecord(input)) throw new ProductBridgeInputError('invalid_hook_input');
  const event = input.hook_event_name;
  if (!EVENTS.has(event)) throw new ProductBridgeInputError('unsupported_hook_event');
  if (input.session_id !== context.configuration.sessionID) throw new ProductBridgeInputError('native_session_mismatch');
  if (input.agent_id !== undefined || input.agent_type !== undefined) throw new ProductBridgeInputError('subagent_hook_unsupported');
  try {
    if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd) || input.cwd.includes('\0')
        || input.cwd !== context.cwd || resolve(input.cwd) !== input.cwd || await realpath(input.cwd) !== input.cwd) {
      throw new Error('mismatched cwd');
    }
  } catch { throw new ProductBridgeInputError('invalid_hook_cwd'); }
  if (['UserPromptSubmit', 'Stop'].includes(event) && !isUUID(input.prompt_id)) {
    // Only a verified main-session observation may retire prior authority.
    // Do not send the invalid/missing prompt ID or substitute an invented one.
    return rejectUnavailableObservation(context, input, 'invalid_prompt_id', 'invalid_native_prompt_id', createClient);
  }
  if (event === 'UserPromptSubmit'
      && (typeof input.prompt !== 'string' || !input.prompt.isWellFormed())) {
    return rejectUnavailableObservation(context, input, 'invalid_prompt_text', 'invalid_native_prompt', createClient);
  }
  if (event === 'SessionStart' && input.source !== undefined && !['startup', 'compact'].includes(input.source)) {
    throw new ProductBridgeInputError('invalid_hook_source');
  }
  const command = { operation: 'hook', event, session_id_native: input.session_id, cwd: input.cwd,
    ...(['UserPromptSubmit', 'Stop'].includes(event) ? { prompt_id: input.prompt_id } : {}),
    ...(event === 'UserPromptSubmit' ? { prompt_sha256: createHash('sha256').update(input.prompt, 'utf8').digest('hex') } : {}),
    ...(event === 'SessionStart' && input.source !== undefined ? { source: input.source } : {}),
  };
  const client = await createClient(context.configuration);
  try {
    const result = await client.request(command);
    if (event === 'SessionEnd') {
      exactKeys(result, ['ended'], 'invalid_boundary_response');
      if (result.ended !== true) throw new ProductBridgeInputError('invalid_boundary_response');
      return null;
    }
    const additionalContext = productBoundaryContext(result);
    if (['UserPromptSubmit', 'Stop'].includes(event) && result.prompt_id !== input.prompt_id) {
      throw new ProductBridgeInputError('invalid_boundary_response');
    }
    if (event === 'UserPromptSubmit' && !isUUID(result.boundary_id)) throw new ProductBridgeInputError('invalid_boundary_response');
    if (event === 'Stop') return null;
    return { hookSpecificOutput: { hookEventName: event, additionalContext } };
  } finally { await client.close(); }
}

export async function readProductHookInput(stream, { maxBytes = 128 * 1024, timeoutMs = 2500 } = {}) {
  return new Promise((resolveInput, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.pause();
      if (error) reject(error); else resolveInput(value);
    };
    const onData = chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) return finish(new ProductBridgeInputError('hook_input_too_large'));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(new ProductBridgeInputError('invalid_hook_json')); }
    };
    const onError = () => finish(new ProductBridgeInputError('hook_input_error'));
    const timer = setTimeout(() => finish(new ProductBridgeInputError('hook_input_timeout')), timeoutMs);
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

export async function runProductHook({ args = process.argv.slice(2), env = process.env,
  input = process.stdin, output = process.stdout, errorOutput = process.stderr,
  createClient = createNativeSessionClient } = {}) {
  try {
    const result = await handleProductHook(await readProductHookInput(input), {
      env, expectedSessionID: expectedSessionArgument(args), createClient,
    });
    if (result) output.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (error) {
    errorOutput.write(`[blabee-claude] 공통 Coordinator Hook을 확인하지 못했습니다 (${safeProductErrorCode(error)}).\n`);
    // A unavailable bridge must not change native permissions or invent a
    // successful boundary. Ordinary Claude work can continue without context.
    return ['product_core_unavailable', 'product_core_response_unknown', 'product_core_closed',
      'invalid_product_core_socket', 'claude_session_unavailable', 'claude_session_disabled'].includes(error?.code) ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runProductHook();

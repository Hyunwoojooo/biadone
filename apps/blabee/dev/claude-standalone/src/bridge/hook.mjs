import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request } from '../shared/client.mjs';
import { MAX_MESSAGE_BYTES } from '../shared/identity.mjs';
import { promptSHA256 } from '../shared/channel.mjs';
import { BridgeInputError, boundaryContext, expectedSessionArgument, isUUID, safeErrorCode, sessionBinding } from './context.mjs';

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);

export async function handleHook(input, { env = process.env, expectedSessionID, ipc = request } = {}) {
  const binding = sessionBinding(env, expectedSessionID);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BridgeInputError('invalid_hook_input');
  if (!EVENTS.has(input.hook_event_name)) throw new BridgeInputError('unsupported_hook_event');
  if (input.session_id !== binding.session_id) throw new BridgeInputError('native_session_mismatch');
  if (input.agent_id !== undefined) throw new BridgeInputError('subagent_hook_unsupported');
  if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd) || input.cwd.includes('\0')) throw new BridgeInputError('invalid_hook_cwd');
  const requiredPrompt = ['UserPromptSubmit', 'Stop'].includes(input.hook_event_name);
  if ((requiredPrompt || input.prompt_id !== undefined) && !isUUID(input.prompt_id)) throw new BridgeInputError('invalid_native_prompt_id');
  const result = await ipc('hook', {
    session_id: binding.session_id,
    session_id_native: input.session_id,
    event: input.hook_event_name,
    cwd: resolve(input.cwd),
    ...(input.prompt_id !== undefined ? { prompt_id: input.prompt_id } : {}),
    ...(input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string' ? { prompt_sha256: promptSHA256(input.prompt) } : {}),
  }, { auth: binding.auth, runtime: binding.runtime });
  if (['SessionStart', 'UserPromptSubmit'].includes(input.hook_event_name)) {
    if (input.hook_event_name === 'UserPromptSubmit' && !isUUID(result?.boundary_id)) throw new BridgeInputError('missing_boundary_response');
    return { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: boundaryContext(result) } };
  }
  return null;
}

export async function readHookInput(stream, { maxBytes = MAX_MESSAGE_BYTES, timeout = 2500 } = {}) {
  return new Promise((resolveInput, reject) => {
    const chunks = [];
    let bytes = 0;
    const finish = (error, value) => {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.pause();
      if (error) reject(error); else resolveInput(value);
    };
    const onData = chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) return finish(new BridgeInputError('hook_input_too_large'));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new BridgeInputError('invalid_hook_json')); }
    };
    const onError = () => finish(new BridgeInputError('hook_input_error'));
    const timer = setTimeout(() => finish(new BridgeInputError('hook_input_timeout')), timeout);
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

export async function runHook({ args = process.argv.slice(2), env = process.env, input = process.stdin, output = process.stdout, errorOutput = process.stderr, ipc = request } = {}) {
  try {
    const expectedSessionID = expectedSessionArgument(args);
    const result = await handleHook(await readHookInput(input), { env, expectedSessionID, ipc });
    if (result) output.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(`[blabee-claude] Hook 연결 또는 입력을 확인할 수 없습니다 (${safeErrorCode(error)}). 선택 binding을 발급하지 않았습니다.\n`);
    // Transport failure does not block ordinary Claude work. Invalid input is
    // visibly rejected (exit 1), never converted into a valid boundary or allow.
    const transportFailure = ['ECONNREFUSED', 'ENOENT', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error?.code)
      || ['coordinator_timeout', 'coordinator_closed'].includes(error?.message);
    return transportFailure ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runHook();

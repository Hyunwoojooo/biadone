import { pathToFileURL } from 'node:url';
import { createAutoConnectClient, AutoConnectError, safeAutoConnectErrorCode } from './auto-connect-client.mjs';
import { createSessionV2Client } from './session-v2-client.mjs';
import { SESSION_V2_WORKFLOW_INSTRUCTIONS } from './session-v2-context.mjs';
import { handleSessionV2Hook, readSessionV2HookInput } from './session-v2-hook.mjs';
import { normalizeSessionV2Hook } from './session-v2-lifecycle.mjs';
import { SESSION_V2_HOOK_REWAKE, writeSessionV2HookOutput } from './session-v2-waiter.mjs';

export async function handleAutoConnectHook(input, { env = process.env, signal,
  createBootstrapClient = createAutoConnectClient, createClient = createSessionV2Client, emitSelection, waiterOptions } = {}) {
  const requireActive = () => {
    if (signal?.aborted) throw new AutoConnectError('auto_connect_closed');
  };
  requireActive();
  // Normalization checks the actual native identity and rejects subagent input.
  // Initial resume/fork sources are consumed by native enrollment, never
  // rewritten to startup or forwarded a second time through session-v2.
  const observation = normalizeSessionV2Hook(input);
  const bootstrap = await createBootstrapClient({ role: 'hook', env, signal,
    nativeSessionID: observation.native_session_id, cwd: observation.cwd });
  let result;
  try {
    requireActive();
    if (input.hook_event_name === 'SessionStart' && ['startup', 'resume', 'fork'].includes(input.source)) {
      await bootstrap.start(input.source);
      requireActive();
      result = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
        `${SESSION_V2_WORKFLOW_INSTRUCTIONS}\n아직 유효한 작업 boundary가 없습니다. 다음 실제 UserPromptSubmit Hook을 기다리세요. 이전 값을 재사용하지 마세요.` } };
    } else {
      const grant = await bootstrap.grant();
      requireActive();
      if (grant.status !== 'ready') throw new AutoConnectError('auto_connect_pending');
      // Only the freshly returned role environment enters the v2 transport. The
      // inherited environment may contain no prior authority to fall back to.
      result = await handleSessionV2Hook(input, { env: grant.environment,
        expectedSessionID: observation.native_session_id, signal, createClient, emitSelection, waiterOptions });
    }
  } finally { await bootstrap.close(); }
  requireActive();
  return result;
}

export async function runAutoConnectHook({ args = process.argv.slice(2), env = process.env, input = process.stdin,
  output = process.stdout, errorOutput = process.stderr, signal,
  createBootstrapClient = createAutoConnectClient, createClient = createSessionV2Client, waiterOptions } = {}) {
  const controller = new AbortController();
  let reading = false;
  const abort = () => {
    controller.abort();
    if (reading) input.destroy(new AutoConnectError('auto_connect_closed'));
  };
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (args.length || signal?.aborted) throw new AutoConnectError(signal?.aborted
      ? 'auto_connect_closed' : 'auto_connect_invalid_configuration');
    let value;
    reading = true;
    try { value = await readSessionV2HookInput(input); }
    finally { reading = false; }
    const result = await handleAutoConnectHook(value, { env, signal: controller.signal, createBootstrapClient, createClient,
      waiterOptions, emitSelection: (text, options) => writeSessionV2HookOutput(errorOutput, text, options) });
    if (controller.signal.aborted) throw new AutoConnectError('auto_connect_closed');
    if (result === SESSION_V2_HOOK_REWAKE) return 2;
    if (result) await writeSessionV2HookOutput(output, JSON.stringify(result) + '\n', { signal: controller.signal });
    return 0;
  } catch (error) {
    const code = controller.signal.aborted ? 'auto_connect_closed' : safeAutoConnectErrorCode(error);
    if (error?.code !== 'session_v2_hook_output_unknown') {
      try { await writeSessionV2HookOutput(errorOutput,
        `[blabee-claude] 자동 연결 Hook을 확인하지 못했습니다 (${code}).\n`, { timeoutMs: 250 }); }
      catch { /* No selected-reference retry after an unknown write. */ }
    }
    return ['auto_connect_unavailable', 'auto_connect_response_unknown', 'auto_connect_invalid_socket', 'auto_connect_closed',
      'claude_bootstrap_unavailable', 'session_v2_unavailable', 'session_v2_response_unknown',
      'session_v2_invalid_socket', 'session_v2_client_closed', 'session_v2_waiter_expired'].includes(code) ? 0 : 1;
  } finally {
    reading = false;
    signal?.removeEventListener('abort', abort);
    process.off('SIGINT', abort); process.off('SIGTERM', abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await runAutoConnectHook());

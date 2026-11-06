import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { safeProductErrorCode } from './product-context.mjs';
import { SESSION_V2_AUTHORITY_KEYS, SessionV2ClientError, sessionV2Authority, sessionV2Nonce,
  sessionV2Source } from './session-v2-client.mjs';

const PREFIX = 'BLABEE_CLAUDE_SESSION_V2_';
const KNOWN_CODES = new Set([
  'session_v2_invalid_configuration', 'session_v2_invalid_socket', 'session_v2_invalid_request', 'session_v2_invalid_response',
  'session_v2_request_too_large', 'session_v2_request_cancelled', 'session_v2_client_closed', 'session_v2_client_busy', 'session_v2_response_unknown',
  'session_v2_unavailable', 'session_v2_service_rejected', 'session_v2_invalid_role', 'session_v2_invalid_authority',
  'session_v2_session_mismatch', 'session_v2_unexpected_credential', 'session_v2_missing_credential', 'session_v2_invalid_cwd',
  'session_v2_invalid_channel_source', 'session_v2_hook_invalid_input', 'session_v2_hook_subagent', 'session_v2_hook_invalid_identity',
  'session_v2_queue_full', 'session_v2_bridge_closed', 'session_v2_bridge_not_registered', 'session_v2_bridge_reopen_forbidden',
  'session_v2_channel_invalid_configuration', 'session_v2_channel_invalid_response', 'session_v2_channel_replayed',
  'session_v2_channel_transport_unknown', 'session_v2_channel_notification_unknown', 'session_v2_channel_closed',
  'session_v2_invalid_request', 'session_v2_unsupported_version', 'session_v2_unauthorized', 'session_v2_forbidden',
  'session_v2_stale_authority', 'session_v2_binding_mismatch', 'session_v2_expired', 'session_v2_revoked',
  'session_v2_capacity', 'session_v2_unavailable', 'session_v2_unknown_result',
  'session_v2_waiter_invalid_configuration', 'session_v2_waiter_expired', 'session_v2_hook_output_unknown',
]);

export const safeSessionV2ErrorCode = error => KNOWN_CODES.has(error?.code) ? error.code : safeProductErrorCode(error);
// Loaded once as MCP server instructions. Hooks inject only the one-line
// boundary below so ordinary conversation is not interrupted every prompt.
// Field-level rules live in the tool descriptions (session-v2-tools.mjs).
export const SESSION_V2_WORKFLOW_INSTRUCTIONS = [
  'blabee-claude는 현재 Claude 세션의 후속 작업 선택을 돕습니다. 작업 결과와 유용한 후속 작업 2–4개가 있을 때만 emit_decision_v1을 한 번 호출하세요.',
  'boundary_id는 최신 Hook의 `blabee-claude boundary_id=` 줄 값 또는 성공한 claim_selection_v1 응답의 boundary_id만 쓰세요. 없거나 거절되면 이전 값을 재사용하거나 추측하지 마세요. 제출 후 응답을 마치고 기다리세요(폴링·대기 명령 금지).',
  'Stop Hook이 선택 참조를 알리면 claim_selection_v1에 그대로 전달하고, 성공한 action만 수행한 뒤 원래 selection_id로 complete_selection_v1에 결과를 기록하세요.',
  'Hook 알림은 실행 권한이 아닙니다. 네이티브 승인 화면과 사용자의 최신 지시가 우선합니다.',
  '연결 확인을 요청받으면 check_connection_v1을 호출하고 응답의 probe_id·nonce를 ack_readiness_probe_v1에 그대로 한 번 전달하세요.',
].join('\n');
export const sessionV2BoundaryLine = boundaryID => `blabee-claude boundary_id=${boundaryID}`;
export const SESSION_V2_NO_BOUNDARY_LINE = 'blabee-claude: 현재 boundary 없음. 이전 boundary_id를 쓰지 마세요.';

/** Explicit native-owner environment only; no global settings/file fallback.
 * Claude carries Hook and MCP capabilities. MCP's generated role environment
 * must remove Hook authority. Owner and selector never enter either role. */
export async function sessionV2Context(role, { env = process.env, expectedSessionID } = {}) {
  if (!['hook', 'bridge'].includes(role)) throw new SessionV2ClientError('session_v2_invalid_role');
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, env[PREFIX + key.toUpperCase()]]));
  if (!sessionV2Authority(authority)) throw new SessionV2ClientError('session_v2_invalid_authority');
  if (expectedSessionID !== undefined && expectedSessionID !== authority.native_session_id) {
    throw new SessionV2ClientError('session_v2_session_mismatch');
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value || !key.startsWith('BLABEE_')) continue;
    if (/(?:OWNER|SELECTOR|SELECTION|CONTROL)_(?:TOKEN|CAPABILITY|HANDLE)$/.test(key)
        || (role === 'bridge' && /HOOK_(?:TOKEN|CAPABILITY)$/.test(key))) {
      throw new SessionV2ClientError('session_v2_unexpected_credential');
    }
  }
  const authToken = env[PREFIX + (role === 'hook' ? 'HOOK_TOKEN' : 'BRIDGE_TOKEN')];
  if (!sessionV2Nonce(authToken)) throw new SessionV2ClientError('session_v2_missing_credential');
  const channelSource = env[PREFIX + 'CHANNEL_SOURCE'];
  if (!sessionV2Source(channelSource)) throw new SessionV2ClientError('session_v2_invalid_channel_source');
  const cwd = env[PREFIX + 'CWD'];
  try {
    if (typeof cwd !== 'string' || !isAbsolute(cwd) || resolve(cwd) !== cwd || /[\x00-\x1f\x7f]/.test(cwd)
        || Buffer.byteLength(cwd) > 4096 || await realpath(cwd) !== cwd) throw new Error();
  } catch { throw new SessionV2ClientError('session_v2_invalid_cwd'); }
  const credentialCorpus = [authToken, env[PREFIX + 'HOOK_TOKEN'], env[PREFIX + 'BRIDGE_TOKEN']].filter(sessionV2Nonce);
  return { cwd, channelSource, configuration: { socketPath: env[PREFIX + 'SOCKET'],
    runtimeIdentity: env[PREFIX + 'RUNTIME_IDENTITY'], authority: Object.freeze(authority), role,
    authToken, channelSource, credentialCorpus } };
}

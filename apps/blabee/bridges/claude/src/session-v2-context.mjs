import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { safeProductErrorCode, PRODUCT_WORKFLOW_INSTRUCTIONS } from './product-context.mjs';
import { SESSION_V2_AUTHORITY_KEYS, SessionV2ClientError, sessionV2Authority, sessionV2Nonce,
  sessionV2Source } from './session-v2-client.mjs';

const PREFIX = 'BLABEE_CLAUDE_SESSION_V2_';
const KNOWN_CODES = new Set([
  'session_v2_invalid_configuration', 'session_v2_invalid_socket', 'session_v2_invalid_request', 'session_v2_invalid_response',
  'session_v2_request_too_large', 'session_v2_client_closed', 'session_v2_client_busy', 'session_v2_response_unknown',
  'session_v2_unavailable', 'session_v2_service_rejected', 'session_v2_invalid_role', 'session_v2_invalid_authority',
  'session_v2_session_mismatch', 'session_v2_unexpected_credential', 'session_v2_missing_credential', 'session_v2_invalid_cwd',
  'session_v2_invalid_channel_source', 'session_v2_hook_invalid_input', 'session_v2_hook_subagent', 'session_v2_hook_invalid_identity',
  'session_v2_queue_full', 'session_v2_bridge_closed', 'session_v2_bridge_not_registered', 'session_v2_bridge_reopen_forbidden',
  'session_v2_channel_invalid_configuration', 'session_v2_channel_invalid_response', 'session_v2_channel_replayed',
  'session_v2_channel_transport_unknown', 'session_v2_channel_notification_unknown', 'session_v2_channel_closed',
  'session_v2_invalid_request', 'session_v2_unsupported_version', 'session_v2_unauthorized', 'session_v2_forbidden',
  'session_v2_stale_authority', 'session_v2_binding_mismatch', 'session_v2_expired', 'session_v2_revoked',
  'session_v2_capacity', 'session_v2_unavailable', 'session_v2_unknown_result',
]);

export const safeSessionV2ErrorCode = error => KNOWN_CODES.has(error?.code) ? error.code : safeProductErrorCode(error);
export const SESSION_V2_WORKFLOW_INSTRUCTIONS = PRODUCT_WORKFLOW_INSTRUCTIONS
  .replace('blabee-claude v1은', 'blabee-claude는')
  + '\n제품 session-v2 transport에서도 모델 도구 이름은 _v1입니다. pending 또는 acknowledged는 각각 연결 확인 시작과 Channel ACK이며 작업 실행 완료를 뜻하지 않습니다.';

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

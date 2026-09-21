import { createScopedCoordinatorClient, PRODUCT_CORE_ERROR_CODES } from './product-core-client.mjs';

export const NATIVE_SESSION_ERROR_CODES = Object.freeze([
  ...PRODUCT_CORE_ERROR_CODES,
  'claude_session_unauthorized', 'claude_session_forbidden', 'claude_session_invalid_request',
  'claude_session_hook_mismatch', 'claude_session_unsupported_resume', 'claude_session_prompt_replay',
  'claude_session_capacity', 'claude_session_bridge_mismatch', 'claude_session_readiness_required',
  'claude_session_readiness_invalid', 'claude_session_stop_required', 'claude_session_boundary_mismatch',
  'claude_session_invalid_claim', 'claude_session_invalid_completion', 'claude_session_secret_reflection',
  'claude_session_configuration_invalid', 'claude_session_response_invalid', 'claude_session_response_too_large',
  'claude_session_disabled', 'claude_session_unavailable',
]);
const PROFILE = {
  schema: 'blabee.claude-session.v1', wireType: 'blabee.runtime-identity.v1/claude_session_v1',
  requestSchema: '1.0', roles: new Set(['hook', 'bridge', 'selector', 'control']),
  operations: new Set(['hook', 'bridge.open', 'bridge.close', 'bridge.poll', 'readiness.begin', 'readiness.ack',
    'proposal.emit', 'selection.claim', 'selection.complete', 'select', 'snapshot', 'session.end']),
  errorCodes: new Set(NATIVE_SESSION_ERROR_CODES),
};

/** Native Hook/MCP protocol; this does not translate legacy development DTOs. */
export async function createNativeSessionClient(configuration = {}) {
  return createScopedCoordinatorClient(configuration, PROFILE);
}

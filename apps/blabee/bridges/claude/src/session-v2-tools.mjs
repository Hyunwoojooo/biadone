import { PRODUCT_TOOL_DEFINITIONS, validateProductToolInput } from './product-tools.mjs';
import { SessionV2ClientError, sessionV2UUID, validateSessionV2Payload, validateSessionV2Result } from './session-v2-client.mjs';
import { safeSessionV2ErrorCode } from './session-v2-context.mjs';

export const SESSION_V2_TOOL_DEFINITIONS = PRODUCT_TOOL_DEFINITIONS;
const OPERATIONS = { check_connection_v1: 'readiness.begin', ack_readiness_probe_v1: 'readiness.ack',
  emit_decision_v1: 'proposal.emit', claim_selection_v1: 'selection.claim', complete_selection_v1: 'selection.complete' };

export const sessionV2ToolError = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false,
  error: { code: safeSessionV2ErrorCode(error), message: '요청을 확인하지 못했습니다. 이전 boundary나 선택을 추측해 실행하지 마세요. Claude의 네이티브 승인과 최신 지시를 유지하세요.' } }) }] });

export function createSessionV2ToolHandler({ request, getBridgeID = () => undefined, channelSource } = {}) {
  return async (name, args) => {
    try {
      validateProductToolInput(name, args);
      const bridgeID = getBridgeID();
      if (!sessionV2UUID(bridgeID)) throw new SessionV2ClientError('session_v2_bridge_not_registered');
      const operation = OPERATIONS[name];
      const payload = { bridge_id: bridgeID, ...args,
        ...(name === 'emit_decision_v1' ? { proposal: { schema_version: 'blabee.claude-proposal.v1', value: args.proposal } } : {}) };
      validateSessionV2Payload(operation, payload);
      const result = await request({ operation, ...payload });
      if (getBridgeID() !== bridgeID) throw new SessionV2ClientError('session_v2_bridge_not_registered');
      validateSessionV2Result(operation, result, payload, channelSource);
      const visible = name === 'claim_selection_v1' ? { ...result, action: result.action.value } : result;
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, result: visible }) }] };
    } catch (error) {
      return sessionV2ToolError(error);
    }
  };
}

/** Exact renderer shared by the enrolled source's native continuation matcher.
 * Source is fixed in the authenticated event and checked before any emission;
 * the SDK/Claude Channel wrapper supplies source, never model-provided text. */
export function sessionV2ChannelNotification(event, { channelSource } = {}) {
  validateSessionV2Result('bridge.poll', { event }, {}, channelSource);
  if (event === null) throw new SessionV2ClientError('session_v2_invalid_response');
  const probe = event.kind === 'readiness_probe';
  const content = probe
    ? 'Blabee connection probe. Call ack_readiness_probe_v1 with these values; do not run a task.\n'
      + JSON.stringify({ probe_id: event.probe_id, nonce: event.nonce })
    : 'Blabee selection reference. Call claim_selection_v1 with these values; execute only the returned action after a successful claim.\n'
      + JSON.stringify({ selection_id: event.selection_id, delivery_token: event.delivery_token });
  return { method: 'notifications/claude/channel', params: { content, meta: probe
    ? { kind: 'readiness_probe', probe_id: event.probe_id } : { selection_id: event.selection_id } } };
}

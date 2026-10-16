import { PRODUCT_TOOL_DEFINITIONS, validateProductToolInput } from './product-tools.mjs';
import { SessionV2ClientError, sessionV2UUID, validateSessionV2Payload, validateSessionV2Result } from './session-v2-client.mjs';
import { safeSessionV2ErrorCode } from './session-v2-context.mjs';

const DESCRIPTIONS = {
  check_connection_v1: '현재 MCP 연결 확인을 시작하고 probe_id와 nonce를 반환합니다. 이 값을 ack_readiness_probe_v1에 명시적으로 한 번 전달하세요. 시작 응답은 선택·실행 승인이 아닙니다.',
  ack_readiness_probe_v1: '이 서버 check_connection_v1 성공 응답의 probe_id와 nonce를 그대로 반환합니다. 작업이나 파일 변경을 만들지 않으며 다른 출처의 값을 추측하지 마세요.',
  claim_selection_v1: '같은 세션의 Blabee Stop Hook이 알린 선택 참조를 한 번 확인합니다. 성공 응답의 action.task·constraints·done_when을 읽은 뒤에만 선택된 작업을 수행하세요. 실패하거나 오래된 참조를 재사용하지 마세요.',
};
export const SESSION_V2_TOOL_DEFINITIONS = PRODUCT_TOOL_DEFINITIONS.map(tool => ({ ...tool,
  description: DESCRIPTIONS[tool.name] ?? tool.description }));
const OPERATIONS = { check_connection_v1: 'readiness.begin', ack_readiness_probe_v1: 'readiness.ack',
  emit_decision_v1: 'proposal.emit', claim_selection_v1: 'selection.claim', complete_selection_v1: 'selection.complete' };

export const sessionV2ToolError = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false,
  error: { code: safeSessionV2ErrorCode(error), message: '요청을 확인하지 못했습니다. 이전 boundary나 선택을 추측해 실행하지 마세요. Claude의 네이티브 승인과 최신 지시를 유지하세요.' } }) }] });

export function createSessionV2ToolHandler({ request, getBridgeID = () => undefined, channelSource } = {}) {
  return async (name, args, { signal } = {}) => {
    try {
      if (signal?.aborted) throw new SessionV2ClientError('session_v2_request_cancelled');
      validateProductToolInput(name, args);
      const bridgeID = getBridgeID();
      if (!sessionV2UUID(bridgeID)) throw new SessionV2ClientError('session_v2_bridge_not_registered');
      const operation = OPERATIONS[name];
      const payload = { bridge_id: bridgeID, ...args,
        ...(name === 'emit_decision_v1' ? { proposal: { schema_version: 'blabee.claude-proposal.v1', value: args.proposal } } : {}) };
      validateSessionV2Payload(operation, payload);
      const result = await request({ operation, ...payload }, { signal });
      if (getBridgeID() !== bridgeID) throw new SessionV2ClientError('session_v2_bridge_not_registered');
      validateSessionV2Result(operation, result, payload, channelSource);
      const visible = name === 'claim_selection_v1' ? { ...result, action: result.action.value } : result;
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, result: visible }) }] };
    } catch (error) {
      return sessionV2ToolError(error);
    }
  };
}

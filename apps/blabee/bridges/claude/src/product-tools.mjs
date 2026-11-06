import { ProductBridgeInputError, UUID_PATTERN, boundedText, exactKeys, isNonce, isUUID,
  safeProductErrorCode } from './product-context.mjs';

const uuid = { type: 'string', pattern: UUID_PATTERN };
const nonce = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const sideEffectKindPattern = '^[a-z][a-z0-9_]{0,63}$';
const sideEffectKind = new RegExp(sideEffectKindPattern);
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const constraints = { type: 'array', maxItems: 32, items: text(1024) };
const option = object({ id: text(64), title: text(128), description: text(256), task: text(2048),
  done_when: text(512), constraints });
const proposal = object({ proposal_id: uuid, task_goal: text(2048),
  outcome: object({ status: { type: 'string', enum: ['completed', 'partial', 'blocked', 'failed'] }, summary: text(512) }),
  reported_side_effects: { type: 'array', maxItems: 32, items: object({ kind: { ...text(64), pattern: sideEffectKindPattern }, summary: text(1024),
    reversibility: { type: 'string', enum: ['reversible', 'irreversible', 'unknown'] } }) },
  options: { type: 'array', minItems: 2, maxItems: 4, items: option },
});

export const PRODUCT_TOOL_DEFINITIONS = [
  { name: 'check_connection_v1', description: '사용자가 명시적으로 요청한 Channel 연결 확인을 시작합니다. 시작 응답은 수신 ACK나 선택·실행 승인이 아닙니다.', inputSchema: object({}) },
  { name: 'ack_readiness_probe_v1', description: '이 서버의 Channel로 받은 probe_id와 nonce를 그대로 반환합니다. 작업이나 파일 변경을 만들지 않으며 다른 출처의 값을 추측하지 마세요.', inputSchema: object({ probe_id: uuid, nonce }) },
  { name: 'emit_decision_v1', description: '현재 boundary의 실제 작업 결과와 후속 선택 2–4개를 공통 Blabee에 제출합니다. outcome·부수효과·제약을 생략하거나 추측하지 마세요. 성공은 제안 저장이며 실행 완료가 아닙니다. 길이 제한은 UTF-8 바이트입니다.', inputSchema: object({ boundary_id: uuid, proposal }) },
  { name: 'claim_selection_v1', description: '이 서버 Channel의 선택 참조를 한 번 확인합니다. 성공 응답의 action.task·constraints·done_when을 읽은 뒤에만 선택된 작업을 수행하세요. 실패하거나 오래된 참조를 재사용하지 마세요.', inputSchema: object({ selection_id: uuid, delivery_token: nonce }) },
  { name: 'complete_selection_v1', description: '이미 claim한 작업의 확인된 결과를 원래 selection_id로 보고합니다. 새 사용자 입력 이후에도 이전 결과를 보고할 수 있지만 재실행 허가는 아닙니다. completed는 확인한 성공에만 사용하며 실행 증명을 합성하지 않습니다.', inputSchema: object({ selection_id: uuid, outcome: { type: 'string', enum: ['completed', 'failed'] }, note: text(4096) }) },
];
const OPERATIONS = { check_connection_v1: 'readiness.begin', ack_readiness_probe_v1: 'readiness.ack',
  emit_decision_v1: 'proposal.emit', claim_selection_v1: 'selection.claim', complete_selection_v1: 'selection.complete' };
const future = value => Number.isSafeInteger(value) && value > Date.now();

function validateOption(value) {
  exactKeys(value, ['id', 'title', 'description', 'task', 'done_when', 'constraints']);
  for (const [key, maximum] of Object.entries({ id: 64, title: 128, description: 256, task: 2048, done_when: 512 })) {
    boundedText(value[key], maximum);
  }
  if (!Array.isArray(value.constraints) || value.constraints.length > 32) throw new ProductBridgeInputError('invalid_constraints');
  for (const constraint of value.constraints) boundedText(constraint, 1024, 'invalid_constraints');
}

export function validateProductToolInput(name, args) {
  switch (name) {
    case 'check_connection_v1': exactKeys(args, []); break;
    case 'ack_readiness_probe_v1':
      exactKeys(args, ['probe_id', 'nonce']);
      if (!isUUID(args.probe_id) || !isNonce(args.nonce)) throw new ProductBridgeInputError('invalid_readiness_probe');
      break;
    case 'emit_decision_v1': {
      exactKeys(args, ['boundary_id', 'proposal']);
      if (!isUUID(args.boundary_id)) throw new ProductBridgeInputError('invalid_boundary_id');
      const value = args.proposal;
      exactKeys(value, ['proposal_id', 'task_goal', 'outcome', 'reported_side_effects', 'options']);
      if (!isUUID(value.proposal_id)) throw new ProductBridgeInputError('invalid_proposal');
      boundedText(value.task_goal, 2048);
      exactKeys(value.outcome, ['status', 'summary']);
      if (!['completed', 'partial', 'blocked', 'failed'].includes(value.outcome.status)) throw new ProductBridgeInputError('invalid_proposal_outcome');
      boundedText(value.outcome.summary, 512);
      if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 4) throw new ProductBridgeInputError('invalid_options');
      const ids = new Set();
      for (const item of value.options) {
        validateOption(item);
        if (ids.has(item.id)) throw new ProductBridgeInputError('invalid_option_id');
        ids.add(item.id);
      }
      if (!Array.isArray(value.reported_side_effects) || value.reported_side_effects.length > 32) throw new ProductBridgeInputError('invalid_reported_side_effects');
      for (const effect of value.reported_side_effects) {
        exactKeys(effect, ['kind', 'summary', 'reversibility']);
        boundedText(effect.kind, 64, 'invalid_reported_side_effects');
        if (sideEffectKind.exec(effect.kind)?.[0] !== effect.kind) throw new ProductBridgeInputError('invalid_reported_side_effects');
        boundedText(effect.summary, 1024);
        if (!['reversible', 'irreversible', 'unknown'].includes(effect.reversibility)) throw new ProductBridgeInputError('invalid_reported_side_effects');
      }
      if (Buffer.byteLength(JSON.stringify(value)) > 24 * 1024) throw new ProductBridgeInputError('proposal_too_large');
      break;
    }
    case 'claim_selection_v1':
      exactKeys(args, ['selection_id', 'delivery_token']);
      if (!isUUID(args.selection_id)) throw new ProductBridgeInputError('invalid_selection_id');
      if (!isNonce(args.delivery_token)) throw new ProductBridgeInputError('invalid_delivery_token');
      break;
    case 'complete_selection_v1':
      exactKeys(args, ['selection_id', 'outcome', 'note']);
      if (!isUUID(args.selection_id) || !['completed', 'failed'].includes(args.outcome)) throw new ProductBridgeInputError('invalid_completion');
      boundedText(args.note, 4096);
      break;
    default: throw new ProductBridgeInputError('unknown_tool');
  }
}

function validateResult(name, result, args) {
  if (name === 'check_connection_v1') {
    exactKeys(result, ['probe_id', 'expires_at', 'status'], 'invalid_readiness_response');
    if (!isUUID(result.probe_id) || !future(result.expires_at) || result.status !== 'awaiting_ack') throw new ProductBridgeInputError('invalid_readiness_response');
  } else if (name === 'ack_readiness_probe_v1') {
    exactKeys(result, ['ready', 'expires_at'], 'invalid_readiness_response');
    if (result.ready !== true || !future(result.expires_at)) throw new ProductBridgeInputError('invalid_readiness_response');
  } else if (name === 'emit_decision_v1') {
    exactKeys(result, ['packet_id', 'revision'], 'invalid_proposal_response');
    boundedText(result.packet_id, 256, 'invalid_proposal_response');
    if (!Number.isSafeInteger(result.revision) || result.revision < 1) throw new ProductBridgeInputError('invalid_proposal_response');
  } else if (name === 'claim_selection_v1') {
    exactKeys(result, ['selection_id', 'boundary_id', 'prompt_id', 'action'], 'invalid_claim_response');
    if (result.selection_id !== args.selection_id || !isUUID(result.boundary_id) || !isUUID(result.prompt_id)) throw new ProductBridgeInputError('invalid_claim_response');
    try { validateOption(result.action); }
    catch { throw new ProductBridgeInputError('invalid_claim_response'); }
  } else if (name === 'complete_selection_v1') {
    exactKeys(result, ['recorded', 'reported_by'], 'invalid_completion_response');
    if (result.recorded !== true || result.reported_by !== 'model') throw new ProductBridgeInputError('invalid_completion_response');
  }
}

export function createProductToolHandler({ request, getBridgeID = () => undefined } = {}) {
  return async (name, args) => {
    try {
      validateProductToolInput(name, args);
      const bridge_id = getBridgeID();
      if (!isUUID(bridge_id)) throw new ProductBridgeInputError('bridge_not_registered');
      const result = await request({ operation: OPERATIONS[name], bridge_id, ...args });
      if (getBridgeID() !== bridge_id) throw new ProductBridgeInputError('bridge_not_registered');
      validateResult(name, result, args);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, result }) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false,
        error: { code: safeProductErrorCode(error), message: '요청을 확인하지 못했습니다. 이전 boundary나 선택을 추측해 실행하지 마세요. Claude의 네이티브 승인과 최신 지시를 유지하세요.' } }) }] };
    }
  };
}

export function productChannelNotification(event) {
  if (event?.kind === 'readiness_probe') {
    exactKeys(event, ['kind', 'probe_id', 'nonce', 'expires_at', 'content'], 'invalid_readiness_event');
    if (!isUUID(event.probe_id) || !isNonce(event.nonce) || !future(event.expires_at)) throw new ProductBridgeInputError('invalid_readiness_event');
    boundedText(event.content, 8192, 'invalid_readiness_event');
    return { method: 'notifications/claude/channel', params: { content: event.content, meta: { kind: 'readiness_probe', probe_id: event.probe_id } } };
  }
  exactKeys(event, ['kind', 'selection_id', 'delivery_token', 'content'], 'invalid_selection_event');
  if (event.kind !== 'selection' || !isUUID(event.selection_id) || !isNonce(event.delivery_token)) throw new ProductBridgeInputError('invalid_selection_event');
  boundedText(event.content, 8192, 'invalid_selection_event');
  return { method: 'notifications/claude/channel', params: { content: event.content, meta: { selection_id: event.selection_id } } };
}

export function startProductPolling({ request, bridgeID, notify, onError = () => {}, intervalMs = 500 } = {}) {
  if (!isUUID(bridgeID) || typeof request !== 'function' || typeof notify !== 'function'
      || !Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 1000) throw new ProductBridgeInputError('invalid_poll_configuration');
  let stopped = false;
  let timer;
  let active;
  const seen = new Set();
  const tick = async () => {
    try {
      const result = await request({ operation: 'bridge.poll', bridge_id: bridgeID });
      if (stopped) return;
      exactKeys(result, ['event'], 'invalid_poll_response');
      if (result.event !== null) {
        const notification = productChannelNotification(result.event);
        const id = `${result.event.kind}:${result.event.probe_id ?? result.event.selection_id}`;
        if (!seen.has(id)) {
          if (seen.size >= 256) throw new ProductBridgeInputError('product_event_capacity');
          seen.add(id);
          // Transport write is not a readiness ACK, a claim, or execution proof.
          await notify(notification);
        }
      }
      if (!stopped) timer = setTimeout(() => { active = tick(); }, intervalMs);
    } catch (error) {
      if (!stopped) onError(safeProductErrorCode(error));
      // An unknown poll result/failed notification is never replayed automatically.
      stopped = true;
    }
  };
  active = tick();
  return async () => { stopped = true; clearTimeout(timer); await active; };
}

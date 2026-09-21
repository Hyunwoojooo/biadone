import { request } from '../shared/client.mjs';
import { selectionChannelNotification } from '../shared/channel.mjs';
import { BridgeInputError, UUID_PATTERN, isUUID, safeErrorCode, sessionBinding } from './context.mjs';

const uuid = { type: 'string', pattern: UUID_PATTERN };
const nonce = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const option = object({ id: { ...text(64), pattern: '^[A-Za-z0-9_-]+$' }, title: text(128), description: text(256), task: text(2048), done_when: text(512) });

export const TOOL_DEFINITIONS = [
  {
    name: 'check_connection',
    description: '사용자가 Blabee 연결 확인을 명시적으로 요청한 경우에만 호출하세요. 이 세션의 Channel로 일회용 확인 메시지를 보냅니다. 응답은 확인 시작만 뜻하며 수신 확인이나 선택·실행 승인이 아닙니다.',
    inputSchema: object({}),
  },
  {
    name: 'ack_readiness_probe',
    description: '이 서버의 Channel로 받은 연결 확인 메시지의 probe_id와 nonce를 그대로 반환합니다. 파일·작업·선택을 만들거나 실행하지 않습니다. 다른 출처나 추측한 값을 사용하지 말고 Claude의 네이티브 승인을 유지하세요.',
    inputSchema: object({ probe_id: uuid, nonce }),
  },
  {
    name: 'emit_decision',
    description: '현재 boundary의 작업 결과와 후속 선택 2–4개를 blabee-claude Pet에 제출합니다. 성공은 제안 저장만 뜻하며 선택이나 실행 완료가 아닙니다. 모든 길이 제한은 UTF-8 바이트입니다.',
    inputSchema: object({ boundary_id: uuid, summary: text(512), options: { type: 'array', minItems: 2, maxItems: 4, items: option } }),
  },
  {
    name: 'claim_selection',
    description: '이 서버의 채널 참조를 최신 세션·선택과 검증하고 저장된 task와 done_when을 한 번만 돌려줍니다. 성공 응답 전에 선택 작업을 실행하지 마세요. 거절된 참조를 재사용하지 마세요.',
    inputSchema: object({ selection_id: uuid, delivery_token: nonce }),
  },
  {
    name: 'complete_selection',
    description: '성공적으로 claim한 선택의 실제 실행 결과를 원래 selection_id에 기록합니다. 새 지시 이후에도 현재 세션 권한으로 이전 결과를 보고할 수 있지만 재실행 권한은 아닙니다. completed는 확인한 성공에만, 실패·거부·실행 불가는 failed로 기록하세요. 모델 보고이며 실행 증명을 자동 생성하지 않습니다.',
    inputSchema: object({ selection_id: uuid, outcome: { type: 'string', enum: ['completed', 'failed'] }, note: text(1024) }),
  },
];

function exactKeys(value, keys, code = 'invalid_tool_fields') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new BridgeInputError(code);
}

const isNonce = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isFutureExpiry = value => Number.isSafeInteger(value) && value > Date.now();

function boundedText(value, maxBytes) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > maxBytes) throw new BridgeInputError('invalid_tool_text');
}

export function validateToolInput(name, args) {
  if (name === 'check_connection') {
    exactKeys(args, []);
  } else if (name === 'ack_readiness_probe') {
    exactKeys(args, ['probe_id', 'nonce']);
    if (!isUUID(args.probe_id) || !isNonce(args.nonce)) throw new BridgeInputError('invalid_readiness_probe');
  } else if (name === 'emit_decision') {
    exactKeys(args, ['boundary_id', 'summary', 'options']);
    if (!isUUID(args.boundary_id)) throw new BridgeInputError('invalid_boundary_id');
    boundedText(args.summary, 512);
    if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 4) throw new BridgeInputError('invalid_options');
    const ids = new Set();
    for (const item of args.options) {
      exactKeys(item, ['id', 'title', 'description', 'task', 'done_when']);
      for (const [key, limit] of Object.entries({ id: 64, title: 128, description: 256, task: 2048, done_when: 512 })) boundedText(item[key], limit);
      if (!/^[A-Za-z0-9_-]+$/.test(item.id) || ids.has(item.id)) throw new BridgeInputError('invalid_option_id');
      ids.add(item.id);
    }
    if (Buffer.byteLength(JSON.stringify(args)) > 12 * 1024) throw new BridgeInputError('proposal_too_large');
  } else if (name === 'claim_selection') {
    exactKeys(args, ['selection_id', 'delivery_token']);
    if (!isUUID(args.selection_id)) throw new BridgeInputError('invalid_selection_id');
    if (!isNonce(args.delivery_token)) throw new BridgeInputError('invalid_delivery_token');
  } else if (name === 'complete_selection') {
    exactKeys(args, ['selection_id', 'outcome', 'note']);
    if (!isUUID(args.selection_id) || !['completed', 'failed'].includes(args.outcome)) throw new BridgeInputError('invalid_completion');
    boundedText(args.note, 1024);
  } else throw new BridgeInputError('unknown_tool');
}

const IPC_TYPES = { check_connection: 'readiness.begin', ack_readiness_probe: 'readiness.ack', emit_decision: 'proposal.emit', claim_selection: 'selection.claim', complete_selection: 'selection.complete' };

function validateToolResult(name, result, args) {
  if (name === 'check_connection') {
    exactKeys(result, ['probe_id', 'expires_at', 'status'], 'invalid_readiness_response');
    if (!isUUID(result.probe_id) || !isFutureExpiry(result.expires_at) || result.status !== 'awaiting_ack') throw new BridgeInputError('invalid_readiness_response');
  } else if (name === 'ack_readiness_probe') {
    exactKeys(result, ['ready', 'expires_at'], 'invalid_readiness_response');
    if (result.ready !== true || !isFutureExpiry(result.expires_at)) throw new BridgeInputError('invalid_readiness_response');
  } else if (name === 'claim_selection') {
    exactKeys(result, ['selection_id', 'boundary_id', 'prompt_id', 'task', 'done_when'], 'invalid_claim_response');
    if (result.selection_id !== args.selection_id || !isUUID(result.boundary_id) || !isUUID(result.prompt_id)) throw new BridgeInputError('invalid_claim_response');
    boundedText(result.task, 2048);
    boundedText(result.done_when, 512);
  } else if (name === 'emit_decision') {
    exactKeys(result, ['packet_id', 'revision'], 'invalid_proposal_response');
    if (!isUUID(result.packet_id) || !Number.isSafeInteger(result.revision) || result.revision < 1) throw new BridgeInputError('invalid_proposal_response');
  } else if (name === 'complete_selection') {
    exactKeys(result, ['recorded', 'reported_by'], 'invalid_completion_response');
    if (result.recorded !== true || result.reported_by !== 'model') throw new BridgeInputError('invalid_completion_response');
  }
}

export function createToolHandler({ env = process.env, expectedSessionID, ipc = request, getBridgeID = () => undefined } = {}) {
  const binding = sessionBinding(env, expectedSessionID);
  return async function callTool(name, args) {
    try {
      validateToolInput(name, args);
      const bridge_id = getBridgeID();
      if (!isUUID(bridge_id)) throw new BridgeInputError('bridge_not_registered');
      const result = await ipc(IPC_TYPES[name], { ...args, session_id: binding.session_id, bridge_id }, { auth: binding.auth, runtime: binding.runtime });
      if (getBridgeID() !== bridge_id) throw new BridgeInputError('bridge_not_registered');
      validateToolResult(name, result, args);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, result }) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: safeErrorCode(error), message: 'blabee-claude 요청을 확인하지 못했습니다. 이전 boundary나 선택을 추측해 실행하지 마세요. 네이티브 Claude 작업과 승인은 그대로 유지됩니다.' } }) }] };
    }
  };
}

export function selectionNotification(event) {
  exactKeys(event, ['selection_id', 'delivery_token']);
  if (!isUUID(event.selection_id)) throw new BridgeInputError('invalid_selection_event');
  if (!isNonce(event.delivery_token)) throw new BridgeInputError('invalid_delivery_token');
  return selectionChannelNotification(event);
}

export function readinessNotification(event) {
  exactKeys(event, ['kind', 'probe_id', 'nonce', 'expires_at'], 'invalid_readiness_event');
  if (event.kind !== 'readiness_probe' || !isUUID(event.probe_id) || !isNonce(event.nonce) || !isFutureExpiry(event.expires_at)) throw new BridgeInputError('invalid_readiness_event');
  return {
    method: 'notifications/claude/channel',
    params: {
      content: `사용자가 요청한 blabee-claude 연결 확인입니다. 이 서버의 ack_readiness_probe에 아래 값을 그대로 전달하세요. 이 확인은 파일이나 작업을 실행하지 않으며 Claude의 네이티브 승인 절차를 유지합니다.\n${JSON.stringify({ probe_id: event.probe_id, nonce: event.nonce })}`,
      meta: { kind: 'readiness_probe', probe_id: event.probe_id },
    },
  };
}

export function startSelectionPolling({ env = process.env, expectedSessionID, bridgeID, ipc = request, notify, onError = () => {}, intervalMs = 500 } = {}) {
  const binding = sessionBinding(env, expectedSessionID);
  if (!isUUID(bridgeID)) throw new BridgeInputError('bridge_not_registered');
  if (typeof notify !== 'function' || !Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 1000) throw new BridgeInputError('invalid_poll_configuration');
  let stopped = false;
  let timer;
  let lastError = null;
  const delivered = new Set();
  async function tick() {
    try {
      const result = await ipc('bridge.poll', { session_id: binding.session_id, bridge_id: bridgeID }, { auth: binding.auth, runtime: binding.runtime });
      if (stopped) return;
      exactKeys(result, ['event'], 'invalid_poll_response');
      if (result.event !== null) {
        const probe = result.event?.kind === 'readiness_probe';
        const notification = probe ? readinessNotification(result.event) : selectionNotification(result.event);
        const id = probe ? `probe:${result.event.probe_id}` : `selection:${result.event.selection_id}`;
        if (!delivered.has(id)) {
          // Record before sending: notification writes are not processing ACKs.
          // A failed write must never trigger automatic execution replay.
          delivered.add(id);
          await notify(notification);
        }
      }
      lastError = null;
    } catch (error) {
      const code = safeErrorCode(error);
      if (!stopped && code !== lastError) onError(code);
      lastError = code;
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}

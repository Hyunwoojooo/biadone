import { parseStrictRfc3339DateTime } from "./rfc3339.mjs";

function success() {
  return Object.freeze({ valid: true, errorCode: null, choiceIndices: null });
}

function failure(errorCode, firstIndex, duplicateIndex) {
  return Object.freeze({
    valid: false,
    errorCode,
    choiceIndices: Object.freeze([firstIndex, duplicateIndex]),
  });
}

function duplicateIndices(choices, field, { ignoreNull = false } = {}) {
  const firstIndexByValue = new Map();
  for (const [index, choice] of choices.entries()) {
    const value = choice?.[field];
    if (ignoreNull && value === null) continue;
    if (firstIndexByValue.has(value)) return [firstIndexByValue.get(value), index];
    firstIndexByValue.set(value, index);
  }
  return null;
}

// Draft 2020-12 `uniqueItems` compares whole array items. It cannot require a
// single property (option_id/action_id) to be unique across otherwise distinct
// choice objects, so this cross-item rule belongs in the semantic validator.
export function validateDecisionPacketSemantics(packet) {
  if (!Array.isArray(packet?.choices) || packet.choices.length !== 4) {
    return Object.freeze({ valid: false, errorCode: "decision_packet_choices_invalid", choiceIndices: null });
  }

  const sealedAt = parseStrictRfc3339DateTime(packet.sealed_at);
  const expiresAt = parseStrictRfc3339DateTime(packet.expires_at);
  if (sealedAt === null || expiresAt === null || sealedAt >= expiresAt) {
    return Object.freeze({ valid: false, errorCode: "decision_packet_time_invalid", choiceIndices: null });
  }

  if (packet.checkpoint?.id !== packet.episode_baseline_checkpoint_id) {
    return Object.freeze({ valid: false, errorCode: "decision_packet_checkpoint_mismatch", choiceIndices: null });
  }

  const rollbackChoice = packet.choices.find((choice) => choice?.slot === 4);
  if (
    rollbackChoice?.enabled === true
    && rollbackChoice.target_checkpoint_id !== packet.episode_baseline_checkpoint_id
  ) {
    return Object.freeze({ valid: false, errorCode: "rollback_target_checkpoint_mismatch", choiceIndices: null });
  }

  const duplicateOption = duplicateIndices(packet.choices, "option_id");
  if (duplicateOption) {
    return failure("decision_packet_option_id_not_unique", ...duplicateOption);
  }

  const duplicateAction = duplicateIndices(packet.choices, "action_id", { ignoreNull: true });
  if (duplicateAction) {
    return failure("decision_packet_action_id_not_unique", ...duplicateAction);
  }

  return success();
}

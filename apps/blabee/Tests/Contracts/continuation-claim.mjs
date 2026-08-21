import { parseStrictRfc3339DateTime } from "./rfc3339.mjs";

export const COMMON_CONTINUATION_BINDING_FIELDS = Object.freeze([
  "project_id",
  "session_id",
  "source_turn_id",
  "source_prompt_id",
  "episode_id",
  "episode_root_prompt_id",
  "episode_baseline_checkpoint_id",
  "decision_boundary_id",
  "boundary_sequence",
]);

const PET_ACTION_BINDING_FIELDS = Object.freeze([
  "interaction_id",
  "packet_id",
  "revision",
  "option_id",
  "action_id",
]);

const REPAIR_BINDING_FIELDS = Object.freeze([
  "repair_request_id",
  "repair_kind",
  "repair_attempt",
  "max_repair_attempts",
]);

function accepted(details = {}) {
  return Object.freeze({ accepted: true, errorCode: null, ...details });
}

function rejected(errorCode, details = {}) {
  return Object.freeze({ accepted: false, errorCode, ...details });
}

function bindingFields(origin) {
  if (origin === "pet_action") return [...COMMON_CONTINUATION_BINDING_FIELDS, ...PET_ACTION_BINDING_FIELDS];
  if (origin === "internal_format_repair") return [...COMMON_CONTINUATION_BINDING_FIELDS, ...REPAIR_BINDING_FIELDS];
  return null;
}

function repairBoundaryKey(envelope) {
  return JSON.stringify(COMMON_CONTINUATION_BINDING_FIELDS.map((field) => envelope[field]));
}

function petSelectionKey(envelope) {
  return JSON.stringify([...COMMON_CONTINUATION_BINDING_FIELDS, ...PET_ACTION_BINDING_FIELDS].map((field) => envelope[field]));
}

function clockValueToEpochNanoseconds(value) {
  if (typeof value === "bigint") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const wholeMilliseconds = Math.trunc(value);
  if (!Number.isSafeInteger(wholeMilliseconds)) return null;
  const fractionalNanoseconds = Math.trunc((value - wholeMilliseconds) * 1_000_000);
  return BigInt(wholeMilliseconds) * 1_000_000n + BigInt(fractionalNanoseconds);
}

export function createContinuationClaimLedger({ now = () => Date.now() } = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  const claimedContinuationIds = new Set();
  const claimedTokens = new Set();
  const claimedRepairBoundaries = new Set();
  const claimedPetSelections = new Set();

  return Object.freeze({
    claim({ envelope, expectedBinding }) {
      if (!envelope || envelope.kind !== "blabee_episode_continuation") {
        return rejected("continuation_kind_invalid");
      }
      const fields = bindingFields(envelope.continuation_origin);
      if (!fields) return rejected("continuation_origin_invalid");

      const expectedMode = envelope.continuation_origin === "pet_action" ? "same_turn_stop" : "submitted_envelope";
      if (envelope.dispatch_mode !== expectedMode) {
        return rejected("dispatch_mode_conflict", { expectedMode, actualMode: envelope.dispatch_mode });
      }
      if (!expectedBinding || fields.some((field) => envelope[field] !== expectedBinding[field])) {
        return rejected("continuation_binding_mismatch", {
          mismatchedFields: fields.filter((field) => envelope[field] !== expectedBinding?.[field]),
        });
      }

      const issuedAt = parseStrictRfc3339DateTime(envelope.issued_at);
      const expiresAt = parseStrictRfc3339DateTime(envelope.expires_at);
      const currentTime = clockValueToEpochNanoseconds(now());
      if (issuedAt === null || expiresAt === null || currentTime === null) return rejected("continuation_time_invalid");
      if (issuedAt >= expiresAt) return rejected("continuation_issued_at_not_before_expiry");
      if (envelope.continuation_origin === "pet_action") {
        const inFlightDeadlineAt = parseStrictRfc3339DateTime(envelope.in_flight_deadline_at);
        if (inFlightDeadlineAt === null) return rejected("continuation_time_invalid");
        if (expiresAt > inFlightDeadlineAt) return rejected("continuation_expiry_after_in_flight_deadline");
      }
      if (currentTime < issuedAt) return rejected("continuation_not_yet_valid");
      if (currentTime >= expiresAt) return rejected("continuation_expired");

      if (claimedContinuationIds.has(envelope.continuation_id)) {
        return rejected("continuation_already_claimed");
      }
      if (claimedTokens.has(envelope.continuation_token)) {
        return rejected("continuation_token_already_claimed");
      }
      const boundaryKey = envelope.continuation_origin === "internal_format_repair"
        ? repairBoundaryKey(envelope)
        : null;
      if (boundaryKey !== null && claimedRepairBoundaries.has(boundaryKey)) {
        return rejected("format_repair_already_claimed_for_boundary");
      }
      const selectionKey = envelope.continuation_origin === "pet_action"
        ? petSelectionKey(envelope)
        : null;
      if (selectionKey !== null && claimedPetSelections.has(selectionKey)) {
        return rejected("pet_action_already_claimed_for_selection");
      }

      claimedContinuationIds.add(envelope.continuation_id);
      claimedTokens.add(envelope.continuation_token);
      if (boundaryKey !== null) claimedRepairBoundaries.add(boundaryKey);
      if (selectionKey !== null) claimedPetSelections.add(selectionKey);
      return accepted({
        continuationId: envelope.continuation_id,
        continuationOrigin: envelope.continuation_origin,
        dispatchMode: envelope.dispatch_mode,
      });
    },
  });
}

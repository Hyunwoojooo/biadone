import { invariant } from "./errors.mjs";
import {
  BINDING_FIELDS,
  assertBindingsEqual,
  assertIdentifier,
  assertNonEmptyString,
  assertStableCode,
  assertTurnLineageEqual,
  bindingFrom,
  bindingKey,
  boundaryIdentityKey,
  clone,
  deepFreeze,
  exactDeepEqual,
  packetRevisionKey,
  parseTimestamp,
  record,
  turnKey,
} from "./shared.mjs";
import { isFingerprint } from "./token.mjs";

const EVENT_CATEGORIES = Object.freeze({
  decision_boundary_opened: "decision_lifecycle",
  decision_boundary_closed: "decision_lifecycle",
  decision_packet_sealed: "decision_lifecycle",
  decision_selection_claimed: "decision_lifecycle",
  internal_format_repair_reserved: "transport",
  internal_format_repair_claimed: "transport",
  continuation_dispatched: "transport",
  continuation_consumed: "transport",
  continuation_transport_completed: "transport",
  continuation_transport_timed_out_unknown: "transport",
  work_outcome_recorded: "work_outcome",
  interaction_expired: "decision_lifecycle",
});

const REPAIR_FIELDS = Object.freeze([
  "continuation_origin",
  "continuation_id",
  "repair_request_id",
  "parent_prompt_id",
  "repair_kind",
  "repair_attempt",
  "max_repair_attempts",
  "dispatch_mode",
  "issued_at",
  "expires_at",
  "correlation_token_fingerprint",
]);

function assertNoRawToken(value, code = "raw_continuation_token_forbidden") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(key !== "continuation_token" && key !== "correlation_token", code);
    assertNoRawToken(child, code);
  }
}

export function validatePacketDocument(packet) {
  invariant(packet?.schema_version === "1.0", "packet_document_schema_version_invalid");
  invariant(packet?.kind === "blabee_decision_packet", "packet_document_kind_invalid");
  bindingFrom(packet);
  assertIdentifier(packet.interaction_id, "interaction_id");
  assertIdentifier(packet.packet_id, "packet_id");
  invariant(Number.isInteger(packet.revision) && packet.revision > 0, "packet_revision_invalid");
  invariant(
    Number.isInteger(packet.valid_after_event_sequence) && packet.valid_after_event_sequence > 0,
    "packet_valid_after_sequence_invalid",
  );
  parseTimestamp(packet.sealed_at, "decision_packet_time_invalid");
  parseTimestamp(packet.expires_at, "decision_packet_time_invalid");
  invariant(
    parseTimestamp(packet.sealed_at) < parseTimestamp(packet.expires_at),
    "decision_packet_time_invalid",
  );
  invariant(Array.isArray(packet.choices) && packet.choices.length === 4, "packet_choices_invalid");
  const optionIds = new Set();
  const actionIds = new Set();
  for (const [index, choice] of packet.choices.entries()) {
    invariant(choice?.slot === index + 1, "packet_slot_order_invalid");
    assertIdentifier(choice.option_id, "option_id");
    invariant(!optionIds.has(choice.option_id), "packet_option_id_duplicate");
    optionIds.add(choice.option_id);
    invariant(typeof choice.enabled === "boolean", "packet_choice_enabled_invalid");
    if (choice.enabled && (choice.slot === 1 || choice.slot === 2)) {
      assertIdentifier(choice.action_id, "action_id");
      invariant(
        choice.action && typeof choice.action === "object" && !Array.isArray(choice.action),
        "packet_action_missing",
      );
    }
    if (choice.action_id !== null) {
      assertIdentifier(choice.action_id, "action_id");
      invariant(!actionIds.has(choice.action_id), "decision_packet_action_id_not_unique");
      actionIds.add(choice.action_id);
    }
    if (!choice.enabled) {
      invariant(choice.action_id === null, "disabled_option_action_id_present");
      invariant(!Object.hasOwn(choice, "action"), "disabled_option_action_present");
    }
  }
  invariant(
    packet.checkpoint?.id === packet.episode_baseline_checkpoint_id,
    "decision_packet_checkpoint_mismatch",
  );
  const rollbackChoice = packet.choices.find((choice) => choice.slot === 4);
  if (rollbackChoice?.enabled) {
    invariant(
      rollbackChoice.target_checkpoint_id === packet.episode_baseline_checkpoint_id,
      "rollback_target_checkpoint_mismatch",
    );
    invariant(false, "rollback_not_supported_in_core");
  }
  assertNoRawToken(packet);
}

function validateVerificationRecord(verification) {
  invariant(verification?.schema_version === "1.0", "verification_record_schema_version_invalid");
  invariant(
    verification?.kind === "blabee_continuation_verification_record",
    "verification_record_kind_invalid",
  );
  assertIdentifier(verification.dispatch_event_id, "dispatch_event_id");
  assertIdentifier(verification.continuation_id, "continuation_id");
  bindingFrom(verification);
  for (const field of ["interaction_id", "packet_id", "option_id", "action_id"]) {
    assertIdentifier(verification[field], field);
  }
  invariant(Number.isInteger(verification.revision) && verification.revision > 0, "packet_revision_invalid");
  invariant(isFingerprint(verification.correlation_token_fingerprint), "token_fingerprint_invalid");
  assertNoRawToken(verification);
}

export function createInitialState({ documents = [], verificationRecords = [] } = {}) {
  invariant(Array.isArray(documents), "packet_documents_invalid");
  invariant(Array.isArray(verificationRecords), "verification_records_invalid");
  const packetDocuments = record();
  for (const source of documents) {
    validatePacketDocument(source);
    const packet = clone(source);
    const key = packetRevisionKey(packet.packet_id, packet.revision);
    invariant(!Object.hasOwn(packetDocuments, key), "packet_document_duplicate");
    packetDocuments[key] = packet;
  }

  const verifications = record();
  const tokenFingerprints = record();
  for (const source of verificationRecords) {
    validateVerificationRecord(source);
    const verification = clone(source);
    invariant(
      !Object.hasOwn(verifications, verification.continuation_id),
      "verification_record_duplicate",
    );
    invariant(
      !Object.hasOwn(tokenFingerprints, verification.correlation_token_fingerprint),
      "token_fingerprint_duplicate",
    );
    verifications[verification.continuation_id] = verification;
    tokenFingerprints[verification.correlation_token_fingerprint] = {
      kind: "pet_action",
      continuationId: verification.continuation_id,
    };
  }

  return deepFreeze({
    schemaVersion: "1.0",
    eventSequence: 0,
    eventIds: record(),
    boundaries: record(),
    boundaryIdentities: record(),
    latestBoundaryByTurn: record(),
    packetDocuments,
    sealedPacketDocuments: record(),
    verificationRecords: verifications,
    usedVerificationRecords: record(),
    tokenFingerprints,
    continuationIdentities: record(),
    continuations: record(),
  });
}

function validateEventEnvelope(state, event) {
  invariant(event?.schema_version === "1.0", "runtime_event_schema_version_invalid");
  invariant(event?.kind === "blabee_runtime_event", "runtime_event_kind_invalid");
  assertIdentifier(event.event_id, "event_id");
  invariant(!Object.hasOwn(state.eventIds, event.event_id), "runtime_event_id_duplicate");
  invariant(
    event.event_sequence === state.eventSequence + 1,
    "event_sequence_not_contiguous",
    `expected event sequence ${state.eventSequence + 1}, received ${event.event_sequence}`,
  );
  invariant(Object.hasOwn(EVENT_CATEGORIES, event.event_type), "runtime_event_type_unknown");
  invariant(
    event.event_category === EVENT_CATEGORIES[event.event_type],
    "runtime_event_category_mismatch",
  );
  parseTimestamp(event.occurred_at, "runtime_event_time_invalid");
  bindingFrom(event);
  invariant(event.payload && typeof event.payload === "object" && !Array.isArray(event.payload), "runtime_event_payload_invalid");
  assertNoRawToken(event);
}

function currentBoundary(next, event) {
  const exactKey = bindingKey(event);
  const exact = next.boundaries[exactKey];
  if (exact) return { key: exactKey, boundary: exact };
  const identity = next.boundaryIdentities[boundaryIdentityKey(event)];
  invariant(!identity, "decision_boundary_binding_mismatch");
  invariant(false, "unknown_decision_boundary");
}

function assertPacketMatchesSeal(packet, event) {
  assertBindingsEqual(packet, event, "packet_document_binding_mismatch");
  const payload = event.payload;
  invariant(packet.interaction_id === payload.interaction_id, "packet_document_interaction_mismatch");
  invariant(packet.packet_id === payload.packet_id, "packet_document_id_mismatch");
  invariant(packet.revision === payload.revision, "packet_document_revision_mismatch");
  invariant(packet.expires_at === payload.expires_at, "packet_document_expiry_mismatch");
  invariant(packet.sealed_at === event.occurred_at, "packet_document_sealed_at_mismatch");
  invariant(
    packet.valid_after_event_sequence === event.event_sequence,
    "packet_document_valid_after_sequence_mismatch",
  );
}

function assertVerificationMatchesDispatch(verification, event) {
  invariant(verification.dispatch_event_id === event.event_id, "verification_record_dispatch_event_mismatch");
  invariant(verification.continuation_id === event.payload.continuation_id, "verification_record_continuation_mismatch");
  for (const field of BINDING_FIELDS) {
    invariant(verification[field] === event[field], "verification_record_binding_mismatch");
  }
  for (const field of ["interaction_id", "packet_id", "revision", "option_id", "action_id"]) {
    invariant(verification[field] === event.payload[field], "verification_record_dispatch_mismatch");
  }
}

function assertBoundaryUsable(boundary, eventType) {
  invariant(!boundary.closed, "decision_boundary_closed", `${eventType} cannot follow boundary close`);
}

function assertRepairPayload(payload) {
  assertIdentifier(payload.continuation_id, "continuation_id");
  assertIdentifier(payload.repair_request_id, "repair_request_id");
  assertIdentifier(payload.parent_prompt_id, "parent_prompt_id");
  invariant(payload.continuation_origin === "internal_format_repair", "repair_origin_invalid");
  invariant(payload.dispatch_mode === "submitted_envelope", "dispatch_mode_conflict");
  invariant(payload.repair_kind === "decision_proposal_schema", "repair_kind_invalid");
  invariant(payload.repair_attempt === 1 && payload.max_repair_attempts === 1, "repair_attempt_invalid");
  invariant(isFingerprint(payload.correlation_token_fingerprint), "token_fingerprint_invalid");
  parseTimestamp(payload.issued_at, "format_repair_time_invalid");
  parseTimestamp(payload.expires_at, "format_repair_time_invalid");
}

export function reduce(state, event) {
  validateEventEnvelope(state, event);
  const next = clone(state);
  next.eventSequence = event.event_sequence;
  next.eventIds[event.event_id] = true;

  if (event.event_type === "decision_boundary_opened") {
    const key = bindingKey(event);
    const identityKey = boundaryIdentityKey(event);
    invariant(!Object.hasOwn(next.boundaries, key), "decision_boundary_reopened");
    invariant(!Object.hasOwn(next.boundaryIdentities, identityKey), "decision_boundary_identity_reused");
    const currentTurnKey = turnKey(event);
    const latestKey = next.latestBoundaryByTurn[currentTurnKey];
    if (latestKey) {
      const previous = next.boundaries[latestKey];
      invariant(previous.closed, "previous_decision_boundary_still_open");
      assertTurnLineageEqual(event, previous.binding);
      invariant(
        event.boundary_sequence === previous.binding.boundary_sequence + 1,
        "boundary_sequence_not_contiguous",
      );
    } else {
      invariant(event.boundary_sequence === 1, "boundary_sequence_not_contiguous");
    }
    assertIdentifier(event.payload.proposal_id, "proposal_id");
    next.boundaries[key] = {
      binding: bindingFrom(event),
      proposalId: event.payload.proposal_id,
      openedAt: event.occurred_at,
      closed: false,
      closeReason: null,
      expired: false,
      packet: null,
      selection: null,
      dispatchedContinuationId: null,
      repair: null,
    };
    next.boundaryIdentities[identityKey] = key;
    next.latestBoundaryByTurn[currentTurnKey] = key;
    return deepFreeze(next);
  }

  const { key, boundary } = currentBoundary(next, event);
  assertBindingsEqual(event, boundary.binding);

  if (event.event_type === "decision_selection_claimed") {
    const latestKey = next.latestBoundaryByTurn[turnKey(event)];
    invariant(latestKey === key, "stale_decision_boundary");
  }

  if (event.event_type === "decision_boundary_closed") {
    invariant(!boundary.closed, "decision_boundary_already_closed");
    if (boundary.selection?.slot === 3) {
      invariant(
        event.payload.close_reason === "episode_paused",
        "pause_selection_close_reason_invalid",
      );
    }
    if (event.payload.close_reason === "episode_paused") {
      invariant(boundary.selection?.slot === 3, "episode_pause_selection_missing");
    }
    if (boundary.selection?.slot === 1 || boundary.selection?.slot === 2) {
      invariant(
        boundary.dispatchedContinuationId,
        "transport_terminal_observation_missing",
      );
    }
    if (boundary.dispatchedContinuationId) {
      const dispatched = next.continuations[boundary.dispatchedContinuationId];
      invariant(
        dispatched
          && ["completed", "timed_out_unknown"].includes(dispatched.transport?.status),
        "transport_terminal_observation_missing",
      );
    }
    assertStableCode(event.payload.close_reason, "close_reason_invalid");
    boundary.closed = true;
    boundary.closeReason = event.payload.close_reason;
    return deepFreeze(next);
  }

  assertBoundaryUsable(boundary, event.event_type);

  if (event.event_type === "decision_packet_sealed") {
    invariant(!boundary.expired, "interaction_already_expired");
    invariant(!boundary.selection, "decision_packet_reseal_after_claim");
    invariant(!boundary.repair || boundary.repair.claimedAt, "format_repair_not_claimed_before_packet");
    const payload = event.payload;
    const documentKey = packetRevisionKey(payload.packet_id, payload.revision);
    const packet = next.packetDocuments[documentKey];
    invariant(packet, "packet_document_missing");
    assertPacketMatchesSeal(packet, event);
    const sealedAt = parseTimestamp(event.occurred_at, "decision_packet_time_invalid");
    const expiresAt = parseTimestamp(payload.expires_at, "decision_packet_time_invalid");
    invariant(sealedAt < expiresAt, "decision_packet_time_invalid");
    if (!boundary.packet) {
      invariant(payload.revision === 1, "decision_packet_initial_revision_invalid");
    } else {
      invariant(payload.interaction_id === boundary.packet.interactionId, "decision_packet_identity_changed");
      invariant(payload.packet_id === boundary.packet.packetId, "decision_packet_identity_changed");
      invariant(payload.revision === boundary.packet.revision + 1, "decision_packet_revision_not_contiguous");
      invariant(sealedAt < boundary.packet.expiresAtNs, "decision_packet_reseal_after_expiry");
    }
    invariant(!next.sealedPacketDocuments[documentKey], "packet_document_already_sealed");
    next.sealedPacketDocuments[documentKey] = true;
    boundary.packet = {
      documentKey,
      interactionId: payload.interaction_id,
      packetId: payload.packet_id,
      revision: payload.revision,
      expiresAt: payload.expires_at,
      expiresAtNs: expiresAt,
    };
    return deepFreeze(next);
  }

  if (event.event_type === "interaction_expired") {
    invariant(!boundary.expired, "interaction_already_expired");
    invariant(boundary.packet, "decision_packet_missing");
    invariant(!boundary.selection && !boundary.dispatchedContinuationId, "interaction_already_claimed");
    const payload = event.payload;
    invariant(payload.interaction_id === boundary.packet.interactionId, "decision_boundary_binding_mismatch");
    invariant(payload.packet_id === boundary.packet.packetId, "decision_boundary_binding_mismatch");
    invariant(payload.revision === boundary.packet.revision, "decision_packet_revision_stale");
    assertStableCode(payload.reason, "interaction_expiry_reason_invalid");
    invariant(payload.automatic_selection === false, "interaction_expiry_automatic_selection_forbidden");
    invariant(
      parseTimestamp(event.occurred_at, "interaction_expired_time_invalid") >= boundary.packet.expiresAtNs,
      "interaction_expired_before_packet_expiry",
    );
    boundary.expired = true;
    return deepFreeze(next);
  }

  if (event.event_type === "decision_selection_claimed") {
    invariant(!boundary.expired, "interaction_already_expired");
    invariant(!boundary.selection, "selection_already_claimed");
    invariant(boundary.packet, "decision_packet_missing");
    const payload = event.payload;
    invariant(payload.interaction_id === boundary.packet.interactionId, "decision_boundary_binding_mismatch");
    invariant(payload.packet_id === boundary.packet.packetId, "decision_boundary_binding_mismatch");
    invariant(payload.revision === boundary.packet.revision, "decision_packet_revision_stale");
    invariant(
      parseTimestamp(event.occurred_at, "decision_selection_time_invalid") < boundary.packet.expiresAtNs,
      "decision_packet_expired",
    );
    const packet = next.packetDocuments[boundary.packet.documentKey];
    const choice = packet.choices.find((candidate) => candidate.option_id === payload.option_id);
    invariant(choice, "decision_option_not_found");
    invariant(choice.enabled, "decision_option_disabled");
    boundary.selection = {
      selectionId: assertIdentifier(payload.selection_id, "selection_id"),
      interactionId: payload.interaction_id,
      packetId: payload.packet_id,
      revision: payload.revision,
      optionId: payload.option_id,
      slot: choice.slot,
      actionId: choice.action_id,
    };
    return deepFreeze(next);
  }

  if (event.event_type === "internal_format_repair_reserved") {
    invariant(!boundary.packet, "format_repair_after_packet_sealed");
    invariant(!boundary.repair, "format_repair_already_reserved_for_boundary");
    assertRepairPayload(event.payload);
    invariant(
      !next.tokenFingerprints[event.payload.correlation_token_fingerprint],
      "token_fingerprint_duplicate",
    );
    invariant(event.payload.parent_prompt_id === event.source_prompt_id, "format_repair_parent_prompt_mismatch");
    const continuationId = assertIdentifier(event.payload.continuation_id, "continuation_id");
    invariant(
      !Object.hasOwn(next.continuationIdentities, continuationId),
      "continuation_already_dispatched",
    );
    const issuedAt = parseTimestamp(event.payload.issued_at, "format_repair_time_invalid");
    const expiresAt = parseTimestamp(event.payload.expires_at, "format_repair_time_invalid");
    const occurredAt = parseTimestamp(event.occurred_at, "format_repair_time_invalid");
    invariant(issuedAt <= occurredAt && occurredAt < expiresAt, "format_repair_time_invalid");
    boundary.repair = {
      payload: clone(event.payload),
      reservedAt: event.occurred_at,
      claimedAt: null,
    };
    next.tokenFingerprints[event.payload.correlation_token_fingerprint] = {
      kind: "internal_format_repair",
      continuationId,
    };
    next.continuationIdentities[continuationId] = {
      origin: "internal_format_repair",
      boundaryKey: key,
    };
    return deepFreeze(next);
  }

  if (event.event_type === "internal_format_repair_claimed") {
    invariant(!boundary.packet, "format_repair_after_packet_sealed");
    invariant(boundary.repair, "format_repair_not_reserved");
    invariant(!boundary.repair.claimedAt, "format_repair_already_claimed_for_boundary");
    assertRepairPayload(event.payload);
    invariant(
      REPAIR_FIELDS.every((field) => exactDeepEqual(event.payload[field], boundary.repair.payload[field])),
      "format_repair_reservation_mismatch",
    );
    const occurredAt = parseTimestamp(event.occurred_at, "format_repair_time_invalid");
    invariant(
      occurredAt >= parseTimestamp(boundary.repair.reservedAt)
        && occurredAt < parseTimestamp(event.payload.expires_at),
      "format_repair_time_invalid",
    );
    boundary.repair.claimedAt = event.occurred_at;
    return deepFreeze(next);
  }

  if (event.event_type === "continuation_dispatched") {
    invariant(!boundary.expired, "interaction_already_expired");
    invariant(boundary.selection, "selection_not_claimed");
    invariant(
      boundary.selection.slot === 1 || boundary.selection.slot === 2,
      "decision_option_not_pet_action",
    );
    const selectedPacket = next.packetDocuments[boundary.packet.documentKey];
    const selectedChoice = selectedPacket.choices.find(
      (candidate) => candidate.option_id === boundary.selection.optionId,
    );
    invariant(selectedChoice?.action, "decision_option_not_pet_action");
    invariant(!boundary.dispatchedContinuationId, "continuation_already_dispatched_for_selection");
    const payload = event.payload;
    invariant(payload.dispatch_mode === "same_turn_stop", "dispatch_mode_conflict");
    for (const [field, selectedField] of [
      ["interaction_id", "interactionId"],
      ["packet_id", "packetId"],
      ["revision", "revision"],
      ["option_id", "optionId"],
      ["action_id", "actionId"],
    ]) {
      invariant(payload[field] === boundary.selection[selectedField], "decision_boundary_binding_mismatch");
    }
    assertIdentifier(payload.continuation_id, "continuation_id");
    invariant(
      !Object.hasOwn(next.continuationIdentities, payload.continuation_id),
      "continuation_already_dispatched",
    );
    const issuedAt = parseTimestamp(payload.issued_at, "continuation_time_invalid");
    const expiresAt = parseTimestamp(payload.expires_at, "continuation_time_invalid");
    const deadlineAt = parseTimestamp(payload.in_flight_deadline_at, "continuation_time_invalid");
    const occurredAt = parseTimestamp(event.occurred_at, "continuation_time_invalid");
    invariant(issuedAt <= occurredAt && occurredAt < expiresAt, "continuation_time_invalid");
    invariant(expiresAt <= deadlineAt, "continuation_expiry_after_in_flight_deadline");
    const verification = next.verificationRecords[payload.continuation_id];
    invariant(verification, "continuation_verification_missing");
    assertVerificationMatchesDispatch(verification, event);
    invariant(!next.usedVerificationRecords[payload.continuation_id], "verification_record_already_used");
    next.usedVerificationRecords[payload.continuation_id] = true;
    next.continuations[payload.continuation_id] = {
      binding: bindingFrom(event),
      boundaryKey: key,
      dispatchEventId: event.event_id,
      continuationId: payload.continuation_id,
      interactionId: payload.interaction_id,
      packetId: payload.packet_id,
      revision: payload.revision,
      optionId: payload.option_id,
      actionId: payload.action_id,
      dispatchMode: payload.dispatch_mode,
      issuedAt: payload.issued_at,
      expiresAt: payload.expires_at,
      expiresAtNs: expiresAt,
      inFlightDeadlineAt: payload.in_flight_deadline_at,
      inFlightDeadlineAtNs: deadlineAt,
      consumedAt: null,
      transport: null,
      workOutcome: null,
    };
    next.continuationIdentities[payload.continuation_id] = {
      origin: "pet_action",
      boundaryKey: key,
    };
    boundary.dispatchedContinuationId = payload.continuation_id;
    return deepFreeze(next);
  }

  const continuationId = event.payload.continuation_id;
  const continuation = continuationId ? next.continuations[continuationId] : null;
  if (
    event.event_type === "continuation_consumed"
    || event.event_type === "continuation_transport_completed"
    || event.event_type === "continuation_transport_timed_out_unknown"
    || event.event_type === "work_outcome_recorded"
  ) {
    invariant(continuation, "continuation_not_dispatched");
    assertBindingsEqual(event, continuation.binding);
  }

  if (event.event_type === "continuation_consumed") {
    invariant(event.payload.dispatch_mode === continuation.dispatchMode, "continuation_dispatch_mode_mismatch");
    invariant(!continuation.consumedAt, "continuation_already_consumed");
    invariant(!continuation.transport, "transport_already_terminal");
    const consumedAt = parseTimestamp(event.occurred_at, "continuation_consumed_time_invalid");
    invariant(
      consumedAt >= parseTimestamp(continuation.issuedAt),
      "continuation_not_yet_valid",
    );
    invariant(
      consumedAt < continuation.expiresAtNs,
      "continuation_expired",
    );
    continuation.consumedAt = event.occurred_at;
    return deepFreeze(next);
  }

  if (event.event_type === "continuation_transport_completed") {
    invariant(continuation.consumedAt, "continuation_not_consumed");
    invariant(!continuation.transport, "transport_already_terminal");
    invariant(event.payload.transport_status === "completed", "transport_status_invalid");
    invariant(event.payload.work_outcome_status === "not_recorded", "transport_work_outcome_conflated");
    invariant(
      parseTimestamp(event.occurred_at, "transport_completion_time_invalid") < continuation.inFlightDeadlineAtNs,
      "transport_completion_after_in_flight_deadline",
    );
    continuation.transport = { status: "completed", occurredAt: event.occurred_at };
    return deepFreeze(next);
  }

  if (event.event_type === "continuation_transport_timed_out_unknown") {
    invariant(!continuation.transport, "transport_already_terminal");
    invariant(
      parseTimestamp(event.occurred_at, "timeout_occurred_at_invalid") >= continuation.inFlightDeadlineAtNs,
      "timeout_before_in_flight_deadline",
    );
    invariant(event.payload.transport_status === "timed_out_unknown", "invalid_in_flight_timeout");
    invariant(event.payload.work_outcome_status === "unknown", "invalid_in_flight_timeout");
    invariant(event.payload.automatic_retry === false, "invalid_in_flight_timeout");
    invariant(event.payload.cancellation_inferred === false, "invalid_in_flight_timeout");
    invariant(event.payload.failure_inferred === false, "invalid_in_flight_timeout");
    continuation.transport = {
      status: "timed_out_unknown",
      occurredAt: event.occurred_at,
      workOutcomeStatus: "unknown",
      automaticRetry: false,
    };
    return deepFreeze(next);
  }

  if (event.event_type === "work_outcome_recorded") {
    invariant(continuation.transport, "transport_terminal_observation_missing");
    invariant(!continuation.workOutcome, "work_outcome_already_recorded");
    invariant(event.payload.action_id === continuation.actionId, "decision_boundary_binding_mismatch");
    invariant(
      ["succeeded", "failed", "cancelled", "unknown"].includes(event.payload.work_outcome_status),
      "work_outcome_status_invalid",
    );
    assertNonEmptyString(event.payload.summary, "summary");
    invariant(Array.isArray(event.payload.evidence_ids), "evidence_ids_invalid");
    invariant(event.payload.evidence_ids.length <= 256, "evidence_ids_invalid");
    for (const evidenceId of event.payload.evidence_ids) assertIdentifier(evidenceId, "evidence_id");
    continuation.workOutcome = clone(event.payload);
    return deepFreeze(next);
  }

  invariant(false, "runtime_event_type_unhandled");
}

export function replay(events, { documents = [], verificationRecords = [] } = {}) {
  invariant(Array.isArray(events), "runtime_events_invalid");
  let state = createInitialState({ documents, verificationRecords });
  for (const event of events) state = reduce(state, event);

  for (const key of Object.keys(state.packetDocuments)) {
    invariant(state.sealedPacketDocuments[key], "packet_document_orphaned");
  }
  for (const continuationId of Object.keys(state.verificationRecords)) {
    invariant(state.usedVerificationRecords[continuationId], "verification_record_orphaned");
  }
  return state;
}

export function packetForBoundary(state, binding) {
  const boundary = state.boundaries[bindingKey(binding)];
  if (!boundary?.packet) return null;
  return state.packetDocuments[boundary.packet.documentKey] ?? null;
}

export function continuationFor(state, continuationId) {
  return state.continuations[continuationId] ?? null;
}

import { invariant } from "./errors.mjs";
import {
  assertBindingsEqual,
  assertEventId,
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
  turnKey,
} from "./shared.mjs";
import { validatePacketDocument } from "./state.mjs";
import { assertGeneratedTokenMaterial, verifyTokenFingerprint } from "./token.mjs";

const CATEGORY = Object.freeze({
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

function eventFor(state, {
  eventType,
  eventId,
  occurredAt,
  binding,
  payload,
  sequenceOffset = 1,
}) {
  assertEventId(eventId);
  invariant(!Object.hasOwn(state.eventIds, eventId), "runtime_event_id_duplicate");
  parseTimestamp(occurredAt, "runtime_event_time_invalid");
  return {
    schema_version: "1.0",
    kind: "blabee_runtime_event",
    event_id: eventId,
    event_sequence: state.eventSequence + sequenceOffset,
    event_type: eventType,
    event_category: CATEGORY[eventType],
    occurred_at: occurredAt,
    ...bindingFrom(binding),
    payload: clone(payload),
  };
}

function result({ events, documents = [], verificationRecords = [], effects = [] }) {
  const eventIds = new Set();
  for (const event of events) {
    invariant(!eventIds.has(event.event_id), "runtime_event_id_duplicate");
    eventIds.add(event.event_id);
  }
  return deepFreeze({
    events: clone(events),
    documents: clone(documents),
    verificationRecords: clone(verificationRecords),
    effects: clone(effects),
  });
}

function boundaryFor(state, binding) {
  const key = bindingKey(binding);
  const boundary = state.boundaries[key];
  if (boundary) return { key, boundary };
  invariant(!state.boundaryIdentities[boundaryIdentityKey(binding)], "decision_boundary_binding_mismatch");
  invariant(false, "unknown_decision_boundary");
}

function assertOpenBoundary(state, binding) {
  const resolved = boundaryFor(state, binding);
  invariant(!resolved.boundary.closed, "decision_boundary_closed");
  return resolved;
}

function packetAndChoiceForSelection(state, request, occurredAt) {
  invariant(request?.schema_version === "1.0", "selection_schema_version_invalid");
  invariant(request?.kind === "blabee_selection_request", "selection_kind_invalid");
  for (const forbidden of ["slot", "action_id", "action", "continuation_token"]) {
    invariant(!Object.hasOwn(request, forbidden), "selection_request_contains_untrusted_execution_data");
  }
  assertIdentifier(request.selection_id, "selection_id");
  const binding = bindingFrom(request);
  const { key, boundary } = boundaryFor(state, binding);
  invariant(state.latestBoundaryByTurn[turnKey(binding)] === key, "stale_decision_boundary");
  invariant(!boundary.closed, "decision_boundary_closed");
  invariant(!boundary.expired, "interaction_already_expired");
  invariant(!boundary.selection, "selection_already_claimed");
  invariant(boundary.packet, "decision_packet_missing");
  invariant(request.interaction_id === boundary.packet.interactionId, "decision_boundary_binding_mismatch");
  invariant(request.packet_id === boundary.packet.packetId, "decision_boundary_binding_mismatch");
  invariant(request.revision === boundary.packet.revision, "decision_packet_revision_stale");
  invariant(
    parseTimestamp(occurredAt, "decision_selection_time_invalid") < boundary.packet.expiresAtNs,
    "decision_packet_expired",
  );
  const packet = state.packetDocuments[boundary.packet.documentKey];
  invariant(packet, "packet_document_missing");
  const choice = packet.choices.find((candidate) => candidate.option_id === request.option_id);
  invariant(choice, "decision_option_not_found");
  invariant(choice.enabled, "decision_option_disabled");
  return { binding, boundary, packet, choice };
}

function verificationRecordFor(dispatchEvent, fingerprint) {
  return {
    schema_version: "1.0",
    kind: "blabee_continuation_verification_record",
    dispatch_event_id: dispatchEvent.event_id,
    continuation_id: dispatchEvent.payload.continuation_id,
    ...bindingFrom(dispatchEvent),
    interaction_id: dispatchEvent.payload.interaction_id,
    packet_id: dispatchEvent.payload.packet_id,
    revision: dispatchEvent.payload.revision,
    option_id: dispatchEvent.payload.option_id,
    action_id: dispatchEvent.payload.action_id,
    correlation_token_fingerprint: fingerprint,
  };
}

function assertContinuationBinding(command, continuation) {
  assertBindingsEqual(command.binding ?? command, continuation.binding);
  invariant(command.continuation_id === continuation.continuationId, "continuation_binding_mismatch");
}

function decideOpenBoundary(state, command) {
  const binding = bindingFrom(command.binding);
  invariant(!state.boundaries[bindingKey(binding)], "decision_boundary_reopened");
  invariant(!state.boundaryIdentities[boundaryIdentityKey(binding)], "decision_boundary_identity_reused");
  const latestKey = state.latestBoundaryByTurn[turnKey(binding)];
  if (latestKey) {
    const latest = state.boundaries[latestKey];
    invariant(latest.closed, "previous_decision_boundary_still_open");
    assertTurnLineageEqual(binding, latest.binding);
    invariant(binding.boundary_sequence === latest.binding.boundary_sequence + 1, "boundary_sequence_not_contiguous");
  } else {
    invariant(binding.boundary_sequence === 1, "boundary_sequence_not_contiguous");
  }
  const event = eventFor(state, {
    eventType: "decision_boundary_opened",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding,
    payload: { proposal_id: assertIdentifier(command.proposal_id, "proposal_id") },
  });
  return result({ events: [event] });
}

function decideSealPacket(state, command) {
  const packet = clone(command.packet);
  validatePacketDocument(packet);
  const binding = bindingFrom(packet);
  const { boundary } = assertOpenBoundary(state, binding);
  invariant(!boundary.expired, "interaction_already_expired");
  invariant(!boundary.selection, "decision_packet_reseal_after_claim");
  invariant(!boundary.repair || boundary.repair.claimedAt, "format_repair_not_claimed_before_packet");
  invariant(packet?.schema_version === "1.0" && packet?.kind === "blabee_decision_packet", "packet_document_kind_invalid");
  invariant(packet.valid_after_event_sequence === state.eventSequence + 1, "packet_document_valid_after_sequence_mismatch");
  invariant(!state.packetDocuments[packetRevisionKey(packet.packet_id, packet.revision)], "packet_document_duplicate");
  if (!boundary.packet) {
    invariant(packet.revision === 1, "decision_packet_initial_revision_invalid");
  } else {
    invariant(packet.interaction_id === boundary.packet.interactionId, "decision_packet_identity_changed");
    invariant(packet.packet_id === boundary.packet.packetId, "decision_packet_identity_changed");
    invariant(packet.revision === boundary.packet.revision + 1, "decision_packet_revision_not_contiguous");
    invariant(
      parseTimestamp(packet.sealed_at) < boundary.packet.expiresAtNs,
      "decision_packet_reseal_after_expiry",
    );
  }
  const event = eventFor(state, {
    eventType: "decision_packet_sealed",
    eventId: command.event_id,
    occurredAt: packet.sealed_at,
    binding,
    payload: {
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      expires_at: packet.expires_at,
    },
  });
  return result({ events: [event], documents: [packet] });
}

function decideSelectOption(state, command) {
  const { binding, packet, choice } = packetAndChoiceForSelection(
    state,
    command.request,
    command.occurred_at,
  );
  if (choice.slot === 3) {
    const claimEvent = eventFor(state, {
      eventType: "decision_selection_claimed",
      eventId: command.event_ids?.selection_claimed,
      occurredAt: command.occurred_at,
      binding,
      sequenceOffset: 1,
      payload: {
        selection_id: command.request.selection_id,
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: choice.option_id,
      },
    });
    const closeEvent = eventFor(state, {
      eventType: "decision_boundary_closed",
      eventId: command.event_ids?.decision_boundary_closed,
      occurredAt: command.occurred_at,
      binding,
      sequenceOffset: 2,
      payload: { close_reason: "episode_paused" },
    });
    return result({
      events: [claimEvent, closeEvent],
      effects: [{
        kind: "episode_paused",
        selection_id: command.request.selection_id,
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: choice.option_id,
        ...binding,
      }],
    });
  }
  invariant(choice.slot !== 4, "rollback_not_supported_in_core");
  invariant(
    (choice.slot === 1 || choice.slot === 2) && choice.action_id && choice.action,
    "decision_option_not_pet_action",
  );
  const tokenMaterial = assertGeneratedTokenMaterial(command.token_material);
  invariant(!state.tokenFingerprints[tokenMaterial.fingerprint], "token_fingerprint_duplicate");
  assertIdentifier(command.continuation_id, "continuation_id");
  invariant(
    !Object.hasOwn(state.continuationIdentities, command.continuation_id),
    "continuation_already_dispatched",
  );
  const issuedAt = parseTimestamp(command.issued_at, "continuation_time_invalid");
  const occurredAt = parseTimestamp(command.occurred_at, "continuation_time_invalid");
  const expiresAt = parseTimestamp(command.expires_at, "continuation_time_invalid");
  const deadlineAt = parseTimestamp(command.in_flight_deadline_at, "continuation_time_invalid");
  invariant(issuedAt <= occurredAt && occurredAt < expiresAt, "continuation_time_invalid");
  invariant(expiresAt <= deadlineAt, "continuation_expiry_after_in_flight_deadline");

  const claimEvent = eventFor(state, {
    eventType: "decision_selection_claimed",
    eventId: command.event_ids?.selection_claimed,
    occurredAt: command.occurred_at,
    binding,
    sequenceOffset: 1,
    payload: {
      selection_id: command.request.selection_id,
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      option_id: choice.option_id,
    },
  });
  const dispatchEvent = eventFor(state, {
    eventType: "continuation_dispatched",
    eventId: command.event_ids?.continuation_dispatched,
    occurredAt: command.occurred_at,
    binding,
    sequenceOffset: 2,
    payload: {
      continuation_id: command.continuation_id,
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      option_id: choice.option_id,
      action_id: choice.action_id,
      dispatch_mode: "same_turn_stop",
      issued_at: command.issued_at,
      expires_at: command.expires_at,
      in_flight_deadline_at: command.in_flight_deadline_at,
    },
  });
  const verification = verificationRecordFor(dispatchEvent, tokenMaterial.fingerprint);
  const envelope = {
    schema_version: "1.0",
    kind: "blabee_episode_continuation",
    continuation_origin: "pet_action",
    dispatch_mode: "same_turn_stop",
    continuation_id: command.continuation_id,
    continuation_token: tokenMaterial.token,
    interaction_id: packet.interaction_id,
    ...binding,
    packet_id: packet.packet_id,
    revision: packet.revision,
    option_id: choice.option_id,
    action_id: choice.action_id,
    action: clone(choice.action),
    issued_at: command.issued_at,
    expires_at: command.expires_at,
    in_flight_deadline_at: command.in_flight_deadline_at,
  };
  return result({
    events: [claimEvent, dispatchEvent],
    verificationRecords: [verification],
    effects: [{ kind: "pet_action_envelope_ready", envelope }],
  });
}

function decideConsumePetAction(state, command) {
  const envelope = command.envelope;
  invariant(envelope?.schema_version === "1.0" && envelope?.kind === "blabee_episode_continuation", "continuation_envelope_invalid");
  invariant(envelope.continuation_origin === "pet_action", "continuation_origin_mismatch");
  invariant(envelope.dispatch_mode === "same_turn_stop", "dispatch_mode_conflict");
  const continuation = state.continuations[envelope.continuation_id];
  invariant(continuation, "continuation_not_dispatched");
  assertBindingsEqual(envelope, continuation.binding);
  for (const [field, expected] of [
    ["interaction_id", continuation.interactionId],
    ["packet_id", continuation.packetId],
    ["revision", continuation.revision],
    ["option_id", continuation.optionId],
    ["action_id", continuation.actionId],
  ]) {
    invariant(envelope[field] === expected, "continuation_binding_mismatch");
  }
  for (const [field, expected] of [
    ["issued_at", continuation.issuedAt],
    ["expires_at", continuation.expiresAt],
    ["in_flight_deadline_at", continuation.inFlightDeadlineAt],
  ]) {
    invariant(envelope[field] === expected, "continuation_binding_mismatch");
  }
  const boundary = state.boundaries[continuation.boundaryKey];
  const packet = state.packetDocuments[boundary.packet.documentKey];
  const choice = packet.choices.find((candidate) => candidate.option_id === continuation.optionId);
  invariant(choice && exactDeepEqual(envelope.action, choice.action), "continuation_action_mismatch");
  invariant(!continuation.consumedAt, "continuation_already_consumed");
  invariant(!continuation.transport, "transport_already_terminal");
  const consumedAt = parseTimestamp(command.occurred_at, "continuation_consumed_time_invalid");
  invariant(
    consumedAt >= parseTimestamp(continuation.issuedAt),
    "continuation_not_yet_valid",
  );
  invariant(
    consumedAt < continuation.expiresAtNs,
    "continuation_expired",
  );
  const verification = state.verificationRecords[continuation.continuationId];
  invariant(verification, "continuation_verification_missing");
  invariant(
    verifyTokenFingerprint(
      envelope.continuation_token,
      verification.correlation_token_fingerprint,
      command.hmac_key === undefined ? {} : { hmacKey: command.hmac_key },
    ),
    "continuation_token_invalid",
  );
  const event = eventFor(state, {
    eventType: "continuation_consumed",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding: continuation.binding,
    payload: {
      continuation_id: continuation.continuationId,
      dispatch_mode: continuation.dispatchMode,
    },
  });
  return result({ events: [event] });
}

function decideCompleteTransport(state, command) {
  const continuation = state.continuations[command.continuation_id];
  invariant(continuation, "continuation_not_dispatched");
  assertContinuationBinding(command, continuation);
  invariant(continuation.consumedAt, "continuation_not_consumed");
  invariant(!continuation.transport, "transport_already_terminal");
  invariant(
    parseTimestamp(command.occurred_at, "transport_completion_time_invalid") < continuation.inFlightDeadlineAtNs,
    "transport_completion_after_in_flight_deadline",
  );
  const event = eventFor(state, {
    eventType: "continuation_transport_completed",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding: continuation.binding,
    payload: {
      continuation_id: continuation.continuationId,
      transport_status: "completed",
      work_outcome_status: "not_recorded",
    },
  });
  return result({ events: [event] });
}

function decideTimeoutTransport(state, command) {
  const continuation = state.continuations[command.continuation_id];
  invariant(continuation, "continuation_not_dispatched");
  assertContinuationBinding(command, continuation);
  invariant(!continuation.transport, "transport_already_terminal");
  invariant(
    parseTimestamp(command.occurred_at, "timeout_occurred_at_invalid") >= continuation.inFlightDeadlineAtNs,
    "timeout_before_in_flight_deadline",
  );
  const event = eventFor(state, {
    eventType: "continuation_transport_timed_out_unknown",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding: continuation.binding,
    payload: {
      continuation_id: continuation.continuationId,
      transport_status: "timed_out_unknown",
      work_outcome_status: "unknown",
      automatic_retry: false,
      cancellation_inferred: false,
      failure_inferred: false,
    },
  });
  return result({ events: [event] });
}

function decideRecordWorkOutcome(state, command) {
  const continuation = state.continuations[command.continuation_id];
  invariant(continuation, "continuation_not_dispatched");
  assertContinuationBinding(command, continuation);
  const boundary = state.boundaries[continuation.boundaryKey];
  invariant(boundary && !boundary.closed, "decision_boundary_closed");
  invariant(continuation.transport, "transport_terminal_observation_missing");
  invariant(!continuation.workOutcome, "work_outcome_already_recorded");
  invariant(["succeeded", "failed", "cancelled", "unknown"].includes(command.status), "work_outcome_status_invalid");
  assertNonEmptyString(command.summary, "summary");
  invariant(Array.isArray(command.evidence_ids), "evidence_ids_invalid");
  invariant(command.evidence_ids.length <= 256, "evidence_ids_invalid");
  for (const evidenceId of command.evidence_ids) assertIdentifier(evidenceId, "evidence_id");
  const event = eventFor(state, {
    eventType: "work_outcome_recorded",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding: continuation.binding,
    payload: {
      continuation_id: continuation.continuationId,
      action_id: continuation.actionId,
      work_outcome_status: command.status,
      summary: command.summary,
      evidence_ids: clone(command.evidence_ids),
    },
  });
  return result({ events: [event] });
}

function decideCloseBoundary(state, command) {
  const binding = bindingFrom(command.binding);
  const { boundary } = boundaryFor(state, binding);
  invariant(!boundary.closed, "decision_boundary_already_closed");
  if (boundary.selection?.slot === 3) {
    invariant(
      command.close_reason === "episode_paused",
      "pause_selection_close_reason_invalid",
    );
  }
  if (command.close_reason === "episode_paused") {
    invariant(boundary.selection?.slot === 3, "episode_pause_selection_missing");
  }
  if (boundary.selection?.slot === 1 || boundary.selection?.slot === 2) {
    invariant(
      boundary.dispatchedContinuationId,
      "transport_terminal_observation_missing",
    );
  }
  if (boundary.dispatchedContinuationId) {
    const dispatched = state.continuations[boundary.dispatchedContinuationId];
    invariant(
      dispatched
        && ["completed", "timed_out_unknown"].includes(dispatched.transport?.status),
      "transport_terminal_observation_missing",
    );
  }
  const event = eventFor(state, {
    eventType: "decision_boundary_closed",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding,
    payload: { close_reason: assertStableCode(command.close_reason, "close_reason_invalid") },
  });
  return result({ events: [event] });
}

function repairPayload(command, tokenMaterial) {
  const binding = bindingFrom(command.binding);
  invariant(command.parent_prompt_id === binding.source_prompt_id, "format_repair_parent_prompt_mismatch");
  return {
    continuation_origin: "internal_format_repair",
    continuation_id: assertIdentifier(command.continuation_id, "continuation_id"),
    repair_request_id: assertIdentifier(command.repair_request_id, "repair_request_id"),
    parent_prompt_id: command.parent_prompt_id,
    repair_kind: "decision_proposal_schema",
    repair_attempt: 1,
    max_repair_attempts: 1,
    dispatch_mode: "submitted_envelope",
    issued_at: command.issued_at,
    expires_at: command.expires_at,
    correlation_token_fingerprint: tokenMaterial.fingerprint,
  };
}

function decideReserveFormatRepair(state, command) {
  const tokenMaterial = assertGeneratedTokenMaterial(command.token_material);
  invariant(!state.tokenFingerprints[tokenMaterial.fingerprint], "token_fingerprint_duplicate");
  assertIdentifier(command.continuation_id, "continuation_id");
  const binding = bindingFrom(command.binding);
  const { boundary } = assertOpenBoundary(state, binding);
  invariant(!boundary.packet, "format_repair_after_packet_sealed");
  invariant(!boundary.repair, "format_repair_already_reserved_for_boundary");
  invariant(
    !Object.hasOwn(state.continuationIdentities, command.continuation_id),
    "continuation_already_dispatched",
  );
  const issuedAt = parseTimestamp(command.issued_at, "format_repair_time_invalid");
  const expiresAt = parseTimestamp(command.expires_at, "format_repair_time_invalid");
  const occurredAt = parseTimestamp(command.occurred_at, "format_repair_time_invalid");
  invariant(issuedAt <= occurredAt && occurredAt < expiresAt, "format_repair_time_invalid");
  const payload = repairPayload(command, tokenMaterial);
  const event = eventFor(state, {
    eventType: "internal_format_repair_reserved",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding,
    payload,
  });
  const envelope = {
    schema_version: "1.0",
    kind: "blabee_episode_continuation",
    continuation_origin: "internal_format_repair",
    dispatch_mode: "submitted_envelope",
    continuation_id: payload.continuation_id,
    continuation_token: tokenMaterial.token,
    ...binding,
    repair_request_id: payload.repair_request_id,
    repair_kind: payload.repair_kind,
    repair_attempt: 1,
    max_repair_attempts: 1,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
  };
  return result({
    events: [event],
    effects: [{ kind: "format_repair_envelope_ready", envelope }],
  });
}

function decideClaimFormatRepair(state, command) {
  const envelope = command.envelope;
  invariant(envelope?.schema_version === "1.0" && envelope?.kind === "blabee_episode_continuation", "continuation_envelope_invalid");
  invariant(envelope.continuation_origin === "internal_format_repair", "continuation_origin_mismatch");
  invariant(envelope.dispatch_mode === "submitted_envelope", "dispatch_mode_conflict");
  const binding = bindingFrom(envelope);
  const { boundary } = assertOpenBoundary(state, binding);
  invariant(!boundary.packet, "format_repair_after_packet_sealed");
  invariant(boundary.repair, "format_repair_not_reserved");
  invariant(!boundary.repair.claimedAt, "format_repair_already_claimed_for_boundary");
  const expected = boundary.repair.payload;
  for (const field of [
    "continuation_id",
    "repair_request_id",
    "repair_kind",
    "repair_attempt",
    "max_repair_attempts",
    "issued_at",
    "expires_at",
  ]) {
    invariant(envelope[field] === expected[field], "format_repair_reservation_mismatch");
  }
  invariant(
    verifyTokenFingerprint(
      envelope.continuation_token,
      expected.correlation_token_fingerprint,
      command.hmac_key === undefined ? {} : { hmacKey: command.hmac_key },
    ),
    "continuation_token_invalid",
  );
  const occurredAt = parseTimestamp(command.occurred_at, "format_repair_time_invalid");
  invariant(
    occurredAt >= parseTimestamp(boundary.repair.reservedAt)
      && occurredAt < parseTimestamp(expected.expires_at),
    "format_repair_time_invalid",
  );
  const event = eventFor(state, {
    eventType: "internal_format_repair_claimed",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding,
    payload: expected,
  });
  return result({ events: [event] });
}

function decideExpireInteraction(state, command) {
  const binding = bindingFrom(command.binding);
  const { boundary } = assertOpenBoundary(state, binding);
  invariant(boundary.packet, "decision_packet_missing");
  invariant(!boundary.expired, "interaction_already_expired");
  invariant(!boundary.selection && !boundary.dispatchedContinuationId, "interaction_already_claimed");
  invariant(
    parseTimestamp(command.occurred_at, "interaction_expired_time_invalid") >= boundary.packet.expiresAtNs,
    "interaction_expired_before_packet_expiry",
  );
  const reason = command.reason === undefined
    ? "selection_timeout"
    : assertStableCode(command.reason, "interaction_expiry_reason_invalid");
  const event = eventFor(state, {
    eventType: "interaction_expired",
    eventId: command.event_id,
    occurredAt: command.occurred_at,
    binding,
    payload: {
      interaction_id: boundary.packet.interactionId,
      packet_id: boundary.packet.packetId,
      revision: boundary.packet.revision,
      reason,
      automatic_selection: false,
    },
  });
  return result({ events: [event] });
}

export function decide(state, command) {
  invariant(state?.schemaVersion === "1.0", "coordinator_state_invalid");
  invariant(command && typeof command.type === "string", "coordinator_command_invalid");
  switch (command.type) {
    case "open_boundary": return decideOpenBoundary(state, command);
    case "seal_packet": return decideSealPacket(state, command);
    case "select_option": return decideSelectOption(state, command);
    case "consume_pet_action": return decideConsumePetAction(state, command);
    case "complete_transport": return decideCompleteTransport(state, command);
    case "timeout_transport_unknown": return decideTimeoutTransport(state, command);
    case "record_work_outcome": return decideRecordWorkOutcome(state, command);
    case "close_boundary": return decideCloseBoundary(state, command);
    case "reserve_format_repair": return decideReserveFormatRepair(state, command);
    case "claim_format_repair": return decideClaimFormatRepair(state, command);
    case "expire_interaction": return decideExpireInteraction(state, command);
    default: invariant(false, "coordinator_command_unknown", `unknown command: ${command.type}`);
  }
}

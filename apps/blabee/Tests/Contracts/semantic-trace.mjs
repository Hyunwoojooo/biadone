import { parseStrictRfc3339DateTime } from "./rfc3339.mjs";

const BINDING_FIELDS = Object.freeze([
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

const TURN_LINEAGE_FIELDS = Object.freeze([
  "source_prompt_id",
  "episode_id",
  "episode_root_prompt_id",
  "episode_baseline_checkpoint_id",
]);

const BOUNDARY_EVENT_TYPES = new Set([
  "decision_boundary_opened",
  "decision_boundary_closed",
  "decision_packet_sealed",
  "decision_selection_claimed",
  "internal_format_repair_reserved",
  "internal_format_repair_claimed",
  "continuation_dispatched",
  "continuation_consumed",
  "continuation_transport_completed",
  "continuation_transport_timed_out_unknown",
  "work_outcome_recorded",
  "interaction_expired",
]);

const FORMAT_REPAIR_JOURNAL_FIELDS = Object.freeze([
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

function failure(errorCode, eventIndex, message) {
  return Object.freeze({ valid: false, errorCode, eventIndex, message });
}

function success() {
  return Object.freeze({ valid: true, errorCode: null, eventIndex: null, message: null });
}

export function extractRuntimeEvent(wrapperEvent) {
  if (wrapperEvent?.payload?.kind === "blabee_runtime_event") return wrapperEvent.payload;
  return wrapperEvent;
}

export function traceEventType(wrapperEvent) {
  const event = extractRuntimeEvent(wrapperEvent);
  return event?.event_type ?? wrapperEvent?.type ?? null;
}

export function traceEventData(wrapperEvent) {
  const event = extractRuntimeEvent(wrapperEvent);
  return event?.payload ?? wrapperEvent?.payload ?? {};
}

function eventSequence(wrapperEvent) {
  const event = extractRuntimeEvent(wrapperEvent);
  return wrapperEvent?.seq ?? event?.event_sequence ?? null;
}

function bindingFrom(wrapperEvent) {
  const event = extractRuntimeEvent(wrapperEvent);
  const data = traceEventData(wrapperEvent);
  const binding = event?.binding ?? (event?.project_id ? event : null) ?? data?.binding ?? data;
  return Object.fromEntries(BINDING_FIELDS.map((field) => [field, binding?.[field]]));
}

function bindingKey(binding) {
  return `${binding.project_id}\0${binding.session_id}\0${binding.source_turn_id}\0${binding.episode_id}\0${binding.decision_boundary_id}\0${binding.boundary_sequence}`;
}

function boundaryIdentityKey(binding) {
  return `${binding.decision_boundary_id}\0${binding.boundary_sequence}`;
}

function turnKey(binding) {
  return `${binding.project_id}\0${binding.session_id}\0${binding.source_turn_id}`;
}

function hasCompleteBinding(binding) {
  return BINDING_FIELDS.every((field) => field === "boundary_sequence"
    ? Number.isInteger(binding[field]) && binding[field] > 0
    : typeof binding[field] === "string" && binding[field].length > 0);
}

function bindingsEqual(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function turnLineageEqual(left, right) {
  return TURN_LINEAGE_FIELDS.every((field) => left[field] === right[field]);
}

function continuationId(wrapperEvent) {
  const event = extractRuntimeEvent(wrapperEvent);
  const data = traceEventData(wrapperEvent);
  return event?.continuation_id ?? data?.continuation_id ?? null;
}

function occurredAt(wrapperEvent) {
  const event = extractRuntimeEvent(wrapperEvent);
  return event?.occurred_at ?? wrapperEvent?.at ?? null;
}

function validateDispatchMode(wrapperEvent, index) {
  const data = traceEventData(wrapperEvent);
  const origin = data.continuation_origin;
  const mode = data.dispatch_mode;
  if (origin === "pet_action" && mode !== "same_turn_stop") {
    return failure("dispatch_mode_conflict", index, "pet_action must use same_turn_stop only");
  }
  if (origin === "internal_format_repair" && mode !== "submitted_envelope") {
    return failure("dispatch_mode_conflict", index, "internal_format_repair must use submitted_envelope only");
  }
  return null;
}

function validateTimeout(wrapperEvent, index) {
  const data = traceEventData(wrapperEvent);
  if (
    data.transport_status !== "timed_out_unknown" ||
    data.work_outcome_status !== "unknown" ||
    data.automatic_retry !== false ||
    data.cancellation_inferred !== false ||
    data.failure_inferred !== false
  ) {
    return failure("invalid_in_flight_timeout", index, "timeout must preserve unknown outcome and prohibit automatic retry or inference");
  }
  return null;
}

function validateDispatchTimes(wrapperEvent, index) {
  const data = traceEventData(wrapperEvent);
  const issuedAt = parseStrictRfc3339DateTime(data.issued_at);
  const expiresAt = parseStrictRfc3339DateTime(data.expires_at);
  const inFlightDeadlineAt = parseStrictRfc3339DateTime(data.in_flight_deadline_at);
  const dispatchedAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
  if (issuedAt === null || expiresAt === null || inFlightDeadlineAt === null || dispatchedAt === null) {
    return { failure: failure("continuation_time_invalid", index, "dispatch timestamps must be strict RFC3339 date-times"), inFlightDeadlineAt: null };
  }
  if (issuedAt >= expiresAt) {
    return { failure: failure("continuation_issued_at_not_before_expiry", index, "issued_at must be before expires_at"), inFlightDeadlineAt: null };
  }
  if (expiresAt > inFlightDeadlineAt) {
    return { failure: failure("continuation_expiry_after_in_flight_deadline", index, "expires_at must not be after in_flight_deadline_at"), inFlightDeadlineAt: null };
  }
  if (dispatchedAt < issuedAt) {
    return { failure: failure("continuation_dispatched_before_issued_at", index, "dispatch occurred_at cannot precede issued_at"), inFlightDeadlineAt: null };
  }
  if (dispatchedAt >= expiresAt) {
    return { failure: failure("continuation_dispatched_at_or_after_expiry", index, "dispatch occurred_at must precede expires_at"), inFlightDeadlineAt: null };
  }
  return { failure: null, inFlightDeadlineAt };
}

function rawCorrelationTokenPresent(data) {
  return Object.hasOwn(data, "correlation_token") || Object.hasOwn(data, "continuation_token");
}

function validateRepairJournalTime(wrapperEvent, index) {
  const data = traceEventData(wrapperEvent);
  const issuedAt = parseStrictRfc3339DateTime(data.issued_at);
  const expiresAt = parseStrictRfc3339DateTime(data.expires_at);
  const journaledAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
  if (
    issuedAt === null
    || expiresAt === null
    || journaledAt === null
    || issuedAt >= expiresAt
    || journaledAt < issuedAt
    || journaledAt >= expiresAt
  ) {
    return { failure: failure("format_repair_time_invalid", index, "repair journal time must satisfy issued_at <= occurred_at < expires_at"), journaledAt: null };
  }
  return { failure: null, journaledAt };
}

function repairJournalMismatches(reserved, claimed) {
  return FORMAT_REPAIR_JOURNAL_FIELDS.filter((field) => reserved[field] !== claimed[field]);
}

export function validateSemanticTrace(trace) {
  if (
    !trace ||
    trace.trace_version !== "1.0" ||
    typeof trace.name !== "string" ||
    trace.name.length === 0 ||
    !Array.isArray(trace.events)
  ) {
    return failure("invalid_trace_wrapper", null, "trace wrapper is incomplete");
  }

  const boundaries = new Map();
  const boundariesByIdentity = new Map();
  const latestBoundaryByTurn = new Map();
  const claimedBoundaries = new Set();
  const continuations = new Map();
  const continuationIdentities = new Map();
  const continuationFingerprints = new Map();
  const timedOutBoundaries = new Set();
  const formatRepairReservations = new Map();
  const restartAfterEventSequence = trace.restart_after_event_sequence;
  if (
    restartAfterEventSequence !== undefined
    && (!Number.isInteger(restartAfterEventSequence) || restartAfterEventSequence < 1)
  ) {
    return failure("restart_marker_invalid", null, "restart_after_event_sequence must identify a positive event sequence");
  }
  let restartMarkerSeen = restartAfterEventSequence === undefined;
  let previousSequence = 0;

  for (const [index, wrapperEvent] of trace.events.entries()) {
    const sequence = eventSequence(wrapperEvent);
    if (!Number.isInteger(sequence) || sequence <= previousSequence) {
      return failure("event_sequence_not_increasing", index, "event seq must be strictly increasing");
    }
    previousSequence = sequence;
    if (sequence === restartAfterEventSequence) {
      // The prefix is the durable journal replay. Reducer state intentionally
      // survives this marker so a reservation remains the budget source of truth.
      restartMarkerSeen = true;
    }

    const type = traceEventType(wrapperEvent);
    if (typeof type !== "string" || type.length === 0) {
      return failure("event_type_missing", index, "event_type is required");
    }

    let binding = null;
    let key = null;
    let currentBoundary = null;
    if (BOUNDARY_EVENT_TYPES.has(type)) {
      binding = bindingFrom(wrapperEvent);
      if (!hasCompleteBinding(binding)) {
        return failure("binding_incomplete", index, `${type} requires a complete decision-boundary binding`);
      }
      key = bindingKey(binding);
      currentBoundary = boundariesByIdentity.get(boundaryIdentityKey(binding)) ?? null;
    }

    if (type === "decision_boundary_opened") {
      if (boundaries.has(key)) return failure("decision_boundary_reopened", index, "a boundary may be opened only once");
      const currentTurnKey = turnKey(binding);
      const latest = latestBoundaryByTurn.get(currentTurnKey);
      if (latest && !turnLineageEqual(binding, latest)) {
        return failure("decision_boundary_lineage_mismatch", index, "same-turn decision boundary lineage changed");
      }
      if (latest && binding.boundary_sequence !== latest.boundary_sequence + 1) {
        return failure("boundary_sequence_not_contiguous", index, "same-turn boundaries must increase contiguously");
      }
      if (!latest && binding.boundary_sequence !== 1) {
        return failure("boundary_sequence_not_contiguous", index, "the first boundary in a turn must have sequence 1");
      }
      if (latest) {
        const previousBoundary = boundaries.get(bindingKey(latest));
        if (previousBoundary && !previousBoundary.closed) {
          return failure("previous_decision_boundary_still_open", index, "a same-turn boundary must close before the next boundary opens");
        }
      }
      const record = {
        binding,
        closed: false,
        expired: false,
        packet: null,
        selection: null,
        dispatchedContinuationId: null,
      };
      boundaries.set(key, record);
      boundariesByIdentity.set(boundaryIdentityKey(binding), record);
      latestBoundaryByTurn.set(currentTurnKey, binding);
      continue;
    }

    if (BOUNDARY_EVENT_TYPES.has(type)) {
      if (!currentBoundary) return failure("unknown_decision_boundary", index, `${type} references an unopened boundary`);
      if (!bindingsEqual(binding, currentBoundary.binding)) {
        return failure("decision_boundary_binding_mismatch", index, `${type} binding differs from its opened boundary`);
      }
      key = bindingKey(currentBoundary.binding);
      const latest = latestBoundaryByTurn.get(turnKey(binding));
      if (type === "decision_selection_claimed" && latest && bindingKey(latest) !== key) {
        return failure("stale_decision_boundary", index, "a selection cannot claim an older boundary in the same turn");
      }
      if (currentBoundary.closed && type !== "decision_boundary_closed") {
        return failure("decision_boundary_closed", index, `${type} cannot follow a closed decision boundary`);
      }
      if (
        (type === "decision_packet_sealed" || type === "decision_selection_claimed" || type === "continuation_dispatched")
        && currentBoundary.expired
      ) {
        return failure("interaction_already_expired", index, `${type} cannot use an expired interaction`);
      }
    }

    if (type === "decision_boundary_closed") {
      if (currentBoundary.closed) return failure("decision_boundary_already_closed", index, "boundary close is not idempotent input");
      currentBoundary.closed = true;
      continue;
    }


    if (type === "decision_packet_sealed") {
      const data = traceEventData(wrapperEvent);
      const repairReservation = formatRepairReservations.get(key);
      if (repairReservation && !repairReservation.claimed) {
        return failure("format_repair_not_claimed_before_packet", index, "a reserved format repair must be claimed before sealing a decision packet");
      }
      const sealedAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
      const expiresAt = parseStrictRfc3339DateTime(data.expires_at);
      if (sealedAt === null || expiresAt === null || sealedAt >= expiresAt) {
        return failure("decision_packet_time_invalid", index, "packet occurred_at must be before its strict RFC3339 expires_at");
      }
      if (!currentBoundary.packet) {
        if (data.revision !== 1) {
          return failure("decision_packet_initial_revision_invalid", index, "the first sealed packet revision must be 1");
        }
      } else {
        if (currentBoundary.selection !== null) {
          return failure("decision_packet_reseal_after_claim", index, "a claimed packet cannot be resealed");
        }
        if (
          data.interaction_id !== currentBoundary.packet.interaction_id
          || data.packet_id !== currentBoundary.packet.packet_id
        ) {
          return failure("decision_packet_identity_changed", index, "a reseal must preserve interaction_id and packet_id");
        }
        if (data.revision !== currentBoundary.packet.revision + 1) {
          return failure("decision_packet_revision_not_contiguous", index, "packet reseal revision must increase by exactly one");
        }
        if (sealedAt >= currentBoundary.packet.expiresAt) {
          return failure("decision_packet_reseal_after_expiry", index, "an expired packet cannot be resealed");
        }
      }
      currentBoundary.packet = {
        interaction_id: data.interaction_id,
        packet_id: data.packet_id,
        revision: data.revision,
        expiresAt,
      };
      continue;
    }

    if (type === "interaction_expired") {
      if (currentBoundary.expired) return failure("interaction_already_expired", index, "interaction expiration may be recorded once");
      const data = traceEventData(wrapperEvent);
      if (
        !currentBoundary.packet ||
        data.interaction_id !== currentBoundary.packet.interaction_id ||
        data.packet_id !== currentBoundary.packet.packet_id ||
        data.revision !== currentBoundary.packet.revision
      ) {
        return failure("decision_boundary_binding_mismatch", index, "expired interaction identifiers do not match the packet sealed in this boundary");
      }
      const expiredAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
      if (expiredAt === null) return failure("interaction_expired_time_invalid", index, "interaction expiration needs a strict RFC3339 occurred_at");
      if (expiredAt < currentBoundary.packet.expiresAt) {
        return failure("interaction_expired_before_packet_expiry", index, "interaction cannot expire before the sealed packet expires_at");
      }
      if (currentBoundary.selection !== null || currentBoundary.dispatchedContinuationId !== null) {
        return failure("interaction_already_claimed", index, "a claimed interaction cannot transition to expired");
      }
      currentBoundary.expired = true;
      continue;
    }

    if (type === "decision_selection_claimed") {
      if (claimedBoundaries.has(key)) return failure("selection_already_claimed", index, "a boundary selection can be claimed once");
      const data = traceEventData(wrapperEvent);
      if (
        !currentBoundary.packet ||
        data.interaction_id !== currentBoundary.packet.interaction_id ||
        data.packet_id !== currentBoundary.packet.packet_id
      ) {
        return failure("decision_boundary_binding_mismatch", index, "selection identifiers do not match the packet sealed in this boundary");
      }
      if (data.revision !== currentBoundary.packet.revision) {
        return failure("decision_packet_revision_stale", index, "selection must claim the latest sealed packet revision");
      }
      const selectedAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
      if (selectedAt === null) return failure("decision_selection_time_invalid", index, "selection occurred_at must be a strict RFC3339 date-time");
      if (selectedAt >= currentBoundary.packet.expiresAt) {
        return failure("decision_packet_expired", index, "selection cannot claim an expired decision packet");
      }
      claimedBoundaries.add(key);
      currentBoundary.selection = {
        interaction_id: data.interaction_id,
        packet_id: data.packet_id,
        revision: data.revision,
        option_id: data.option_id,
      };
      continue;
    }

    if (type === "internal_format_repair_reserved") {
      const data = traceEventData(wrapperEvent);
      if (rawCorrelationTokenPresent(data)) {
        return failure("raw_correlation_token_forbidden", index, "repair journal events may persist only a correlation fingerprint");
      }
      if (currentBoundary.packet !== null) {
        return failure("format_repair_after_packet_sealed", index, "repair reservation must precede the first sealed decision packet");
      }
      if (formatRepairReservations.has(key)) {
        return failure("format_repair_already_reserved_for_boundary", index, "a reservation permanently consumes the boundary repair budget");
      }
      if (data.parent_prompt_id !== binding.source_prompt_id) {
        return failure("format_repair_parent_prompt_mismatch", index, "parent_prompt_id must match the boundary source_prompt_id");
      }
      const timing = validateRepairJournalTime(wrapperEvent, index);
      if (timing.failure) return timing.failure;
      if (continuationIdentities.has(data.continuation_id)) {
        return failure("continuation_already_dispatched", index, "continuation_id must be globally unique across continuation origins");
      }
      if (continuationFingerprints.has(data.correlation_token_fingerprint)) {
        return failure("token_fingerprint_duplicate", index, "correlation token fingerprint must be globally unique");
      }
      formatRepairReservations.set(key, {
        payload: Object.fromEntries(FORMAT_REPAIR_JOURNAL_FIELDS.map((field) => [field, data[field]])),
        reservedAt: timing.journaledAt,
        claimed: false,
      });
      continuationIdentities.set(data.continuation_id, {
        origin: "internal_format_repair",
        boundaryKey: key,
      });
      continuationFingerprints.set(data.correlation_token_fingerprint, {
        origin: "internal_format_repair",
        continuationId: data.continuation_id,
      });
      continue;
    }

    if (type === "internal_format_repair_claimed") {
      const data = traceEventData(wrapperEvent);
      if (rawCorrelationTokenPresent(data)) {
        return failure("raw_correlation_token_forbidden", index, "repair journal events may persist only a correlation fingerprint");
      }
      const reservation = formatRepairReservations.get(key);
      if (!reservation) return failure("format_repair_not_reserved", index, "repair claim requires a prior durable reservation");
      if (currentBoundary.packet !== null) {
        return failure("format_repair_after_packet_sealed", index, "repair claim must precede the first sealed decision packet");
      }
      if (reservation.claimed) {
        return failure("format_repair_already_claimed_for_boundary", index, "a repair reservation may be claimed once");
      }
      const mismatchedFields = repairJournalMismatches(reservation.payload, data);
      if (mismatchedFields.length > 0) {
        return failure("format_repair_reservation_mismatch", index, `repair claim differs from reservation: ${mismatchedFields.join(", ")}`);
      }
      if (data.parent_prompt_id !== binding.source_prompt_id) {
        return failure("format_repair_parent_prompt_mismatch", index, "parent_prompt_id must match the boundary source_prompt_id");
      }
      const timing = validateRepairJournalTime(wrapperEvent, index);
      if (timing.failure) return timing.failure;
      if (timing.journaledAt < reservation.reservedAt) {
        return failure("format_repair_claim_before_reservation", index, "claim occurred_at cannot precede reservation occurred_at");
      }
      reservation.claimed = true;
      continue;
    }

    if (type === "continuation_dispatched") {
      const modeFailure = validateDispatchMode(wrapperEvent, index);
      if (modeFailure) return modeFailure;
      const timing = validateDispatchTimes(wrapperEvent, index);
      if (timing.failure) return timing.failure;
      const id = continuationId(wrapperEvent);
      if (typeof id !== "string" || id.length === 0) return failure("continuation_id_missing", index, "dispatch requires continuation_id");
      if (continuationIdentities.has(id)) return failure("continuation_already_dispatched", index, "continuation_id must be globally unique across continuation origins");
      if (timedOutBoundaries.has(key)) return failure("automatic_retry_after_timeout", index, "a timed-out boundary cannot dispatch an automatic retry");
      const data = traceEventData(wrapperEvent);
      if (
        !currentBoundary.selection ||
        data.interaction_id !== currentBoundary.selection.interaction_id ||
        data.packet_id !== currentBoundary.selection.packet_id ||
        data.revision !== currentBoundary.selection.revision ||
        data.option_id !== currentBoundary.selection.option_id
      ) {
        return failure("decision_boundary_binding_mismatch", index, "dispatch identifiers do not match the claimed selection in this boundary");
      }
      if (currentBoundary.dispatchedContinuationId !== null) {
        return failure("continuation_already_dispatched_for_selection", index, "a claimed selection may dispatch one continuation");
      }
      continuations.set(id, {
        boundaryKey: key,
        actionId: data.action_id,
        terminal: false,
        timedOut: false,
        consumed: false,
        workOutcomeRecorded: false,
        inFlightDeadlineAt: timing.inFlightDeadlineAt,
        issuedAt: parseStrictRfc3339DateTime(data.issued_at),
        expiresAt: parseStrictRfc3339DateTime(data.expires_at),
        dispatchMode: data.dispatch_mode,
      });
      continuationIdentities.set(id, {
        origin: "pet_action",
        boundaryKey: key,
      });
      currentBoundary.dispatchedContinuationId = id;
      continue;
    }

    if (type === "continuation_consumed") {
      const id = continuationId(wrapperEvent);
      const continuation = continuations.get(id);
      if (!continuation) return failure("continuation_not_dispatched", index, `${type} requires a prior dispatch`);
      if (continuation.boundaryKey !== key) return failure("decision_boundary_binding_mismatch", index, `${type} crossed a decision boundary`);
      if (traceEventData(wrapperEvent).dispatch_mode !== continuation.dispatchMode) {
        return failure("continuation_dispatch_mode_mismatch", index, "consumed dispatch_mode must match the dispatched continuation");
      }
      if (continuation.consumed) return failure("continuation_already_consumed", index, "continuation may be consumed once");
      if (continuation.terminal) return failure("transport_already_terminal", index, "a terminal transport cannot consume its continuation");
      const consumedAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
      if (consumedAt === null) {
        return failure("continuation_consumed_time_invalid", index, "consumption occurred_at must be a strict RFC3339 date-time");
      }
      if (consumedAt < continuation.issuedAt) {
        return failure("continuation_not_yet_valid", index, "continuation cannot be consumed before issued_at");
      }
      if (consumedAt >= continuation.expiresAt) {
        return failure("continuation_expired", index, "continuation must be consumed before expires_at");
      }
      continuation.consumed = true;
      continue;
    }

    if (type === "continuation_transport_completed") {
      const id = continuationId(wrapperEvent);
      const continuation = continuations.get(id);
      if (!continuation) return failure("continuation_not_dispatched", index, `${type} requires a prior dispatch`);
      if (continuation.boundaryKey !== key) return failure("decision_boundary_binding_mismatch", index, `${type} crossed a decision boundary`);
      if (continuation.terminal) return failure("transport_already_terminal", index, "transport has already reached a terminal observation");
      if (!continuation.consumed) return failure("continuation_not_consumed", index, "completed transport requires a prior consumption observation");
      const completedAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
      if (completedAt === null) return failure("transport_completion_time_invalid", index, "transport completion needs a strict RFC3339 occurred_at");
      if (completedAt >= continuation.inFlightDeadlineAt) {
        return failure("transport_completion_after_in_flight_deadline", index, "completion must be observed before in_flight_deadline_at");
      }
      continuation.terminal = true;
      continue;
    }

    if (type === "continuation_transport_timed_out_unknown") {
      const id = continuationId(wrapperEvent);
      const continuation = continuations.get(id);
      if (!continuation) return failure("continuation_not_dispatched", index, "timeout requires a prior dispatch");
      if (continuation.boundaryKey !== key) return failure("decision_boundary_binding_mismatch", index, "timeout crossed a decision boundary");
      if (continuation.terminal) return failure("transport_already_terminal", index, "transport has already reached a terminal observation");
      const timeoutFailure = validateTimeout(wrapperEvent, index);
      if (timeoutFailure) return timeoutFailure;
      const timeoutOccurredAt = parseStrictRfc3339DateTime(occurredAt(wrapperEvent));
      if (timeoutOccurredAt === null) return failure("timeout_occurred_at_invalid", index, "timeout occurred_at must be a strict RFC3339 date-time");
      if (timeoutOccurredAt < continuation.inFlightDeadlineAt) {
        return failure("timeout_before_in_flight_deadline", index, "timeout cannot be observed before in_flight_deadline_at");
      }
      continuation.terminal = true;
      continuation.timedOut = true;
      timedOutBoundaries.add(key);
      continue;
    }

    if (type === "work_outcome_recorded") {
      const id = continuationId(wrapperEvent);
      const continuation = continuations.get(id);
      if (!continuation) return failure("continuation_not_dispatched", index, "work outcome requires a prior dispatch");
      if (continuation.boundaryKey !== key) return failure("decision_boundary_binding_mismatch", index, "work outcome crossed a decision boundary");
      if (continuation.workOutcomeRecorded) return failure("work_outcome_already_recorded", index, "work outcome may be recorded once");
      if (!continuation.terminal) return failure("transport_terminal_observation_missing", index, "work outcome cannot stand in for transport completion");
      if (traceEventData(wrapperEvent).action_id !== continuation.actionId) {
        return failure("decision_boundary_binding_mismatch", index, "work outcome action differs from the dispatched action");
      }
      continuation.workOutcomeRecorded = true;
      continue;
    }
  }

  for (const continuation of continuations.values()) {
    if (!continuation.terminal) return failure("transport_terminal_observation_missing", null, "every dispatched continuation needs an explicit transport terminal event");
  }
  if (!restartMarkerSeen) return failure("restart_marker_invalid", null, "restart marker does not reference an event in the trace");
  return success();
}

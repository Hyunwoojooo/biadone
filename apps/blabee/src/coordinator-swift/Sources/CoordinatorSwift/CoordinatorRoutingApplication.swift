import Darwin
import Foundation

/// Monotonic time source whose elapsed value continues across system sleep.
/// `SystemCoordinatorContinuousClock` uses `mach_continuous_time`; tests inject
/// a deterministic implementation and never wait on wall time.
public protocol CoordinatorContinuousClock: Sendable {
    func nowNanoseconds() -> UInt64
}

public struct SystemCoordinatorContinuousClock: CoordinatorContinuousClock {
    private static let timebase: mach_timebase_info_data_t = {
        var value = mach_timebase_info_data_t()
        mach_timebase_info(&value)
        return value
    }()

    public init() {}

    public func nowNanoseconds() -> UInt64 {
        let ticks = mach_continuous_time()
        let numerator = UInt64(Self.timebase.numer)
        let denominator = UInt64(Self.timebase.denom)
        guard numerator != 0, denominator != 0 else { return ticks }
        let whole = ticks / denominator
        let remainder = ticks % denominator
        let (wholeScaled, wholeOverflow) = whole.multipliedReportingOverflow(by: numerator)
        let (remainderScaled, remainderOverflow) = remainder.multipliedReportingOverflow(by: numerator)
        guard !wholeOverflow, !remainderOverflow else { return UInt64.max }
        let fractional = remainderScaled / denominator
        let (result, resultOverflow) = wholeScaled.addingReportingOverflow(fractional)
        return resultOverflow ? UInt64.max : result
    }
}

public struct CoordinatorRoutingSnapshot: Sendable, Equatable {
    public let canonicalJSON: Data
}

private struct RoutingInteractionIdentity: Sendable, Equatable {
    let binding: CoordinatorBinding
    let interactionID: String
    let packetID: String
    let revision: Int64

    func matches(_ other: RoutingInteractionIdentity) -> Bool {
        binding == other.binding
            && IdentifierNormalization.isByteExact(interactionID, other.interactionID)
            && IdentifierNormalization.isByteExact(packetID, other.packetID)
            && revision == other.revision
    }

    var jsonObject: [String: Any] {
        var result: [String: Any] = [
            "interaction_id": interactionID,
            "packet_id": packetID,
            "revision": revision,
        ]
        result.merge(binding.jsonObject) { current, _ in current }
        return result
    }
}

private struct RoutingPendingInteraction: Sendable {
    let identity: RoutingInteractionIdentity
    let sealedAt: RFC3339Instant
    let expiresAt: RFC3339Instant
    let anchorNanoseconds: UInt64
    var reminderEmitted: Bool
}

private struct RoutingInFlightContinuation: Sendable {
    let continuationID: String
    let binding: CoordinatorBinding
    let issuedAt: RFC3339Instant
    let deadlineAt: RFC3339Instant
    let anchorNanoseconds: UInt64
    let deadlineAfterNanoseconds: UInt64
}

private struct RoutingFormatRepairAuthority: Sendable {
    let continuationID: String
    let binding: CoordinatorBinding
    let reservedAt: RFC3339Instant
    let anchorNanoseconds: UInt64
}

private struct RoutingAmbiguousSelection: Sendable {
    let command: Data
    let binding: CoordinatorBinding
    let anchorNanoseconds: UInt64
    let inFlightDuration: UInt64?
}

/// Product routing/time boundary layered in front of the B1 semantic service.
///
/// The journal remains the lifecycle truth source. Foreground ownership and
/// monotonic anchors intentionally remain process-local: after restart their
/// absence is treated as ambiguity, never as permission to restore a card.
public final class CoordinatorRoutingApplication: @unchecked Sendable {
    public static let reminderAfterNanoseconds: UInt64 = 60_000_000_000
    public static let expiryAfterNanoseconds: UInt64 = 120_000_000_000
    public static let continuationValidityNanoseconds: UInt64 = 120_000_000_000
    public static let inFlightDeadlineNanoseconds: UInt64 = 300_000_000_000

    public typealias EventIDGenerator = @Sendable (_ purpose: String) -> String

    private let journal: any CoordinatorSemanticJournalPort
    private let semantic: CoordinatorSemanticApplication
    private let clock: any CoordinatorContinuousClock
    private let eventIDGenerator: EventIDGenerator
    private let lock = NSLock()

    private var pending: [CoordinatorBindingKey: RoutingPendingInteraction] = [:]
    private var inFlight: [String: RoutingInFlightContinuation] = [:]
    private var formatRepairs: [String: RoutingFormatRepairAuthority] = [:]
    private var foreground: RoutingInteractionIdentity?
    private var queuedNotices: [Data] = []
    private var sealAttemptAnchors: [String: UInt64] = [:]
    private var ambiguousSelections: [CoordinatorBindingKey: RoutingAmbiguousSelection] = [:]
    private var lastClockNanoseconds: UInt64?

    public init(
        journal: any CoordinatorSemanticJournalPort,
        clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
        tokenHMACKey: Data? = nil,
        tokenGenerator: CoordinatorSemanticApplication.TokenGenerator? = nil,
        eventIDGenerator: EventIDGenerator? = nil
    ) throws {
        self.journal = journal
        self.semantic = CoordinatorSemanticApplication(
            journal: journal,
            tokenHMACKey: tokenHMACKey,
            tokenGenerator: tokenGenerator
        )
        self.clock = clock
        self.eventIDGenerator = eventIDGenerator ?? { purpose in
            "event_b2_\(purpose)_\(UUID().uuidString.lowercased())"
        }
        // A foreground choice is never restored. Any persisted authority whose
        // monotonic anchor was lost is made terminal before serving requests.
        try recoverPersistedAmbiguity()
    }

    /// Executes lifecycle commands that do not require foreground authority.
    /// Selection and scheduler-owned terminal commands have separate entry
    /// points so the product adapter cannot bypass B2 routing checks.
    public func executeCommand(_ commandData: Data) throws -> CoordinatorSemanticExecutionResult {
        lock.lock()
        defer { lock.unlock() }
        var command = try StrictJSONTransport.object(from: commandData)
        let commandType = try requiredCommandType(command)
        // An open/seal pair must remain contiguous in the global journal so
        // the packet's valid-after sequence stays exact. A recovered seal may
        // retain an old monotonic anchor; the next routing time gate evaluates
        // it before any snapshot, foreground change, or selection can proceed.
        if commandType != "open_boundary" && commandType != "seal_packet" {
            try processDueLocked()
        }
        switch commandType {
        case "select_option":
            throw CoordinatorError("foreground_selection_required")
        case "consume_pet_action":
            throw CoordinatorError("routing_token_consumption_required")
        case "expire_interaction", "timeout_transport_unknown":
            throw CoordinatorError("routing_scheduler_command_required")
        default:
            break
        }

        let authorityAnchor = lastClockNanoseconds ?? clock.nowNanoseconds()
        var sealEventID: String?
        var sealAnchor = authorityAnchor
        if commandType == "seal_packet" {
            try validateRoutedPacketInterval(command)
            let eventID = try requiredIdentifier(command, "event_id")
            sealEventID = eventID
            if let retained = sealAttemptAnchors[eventID] {
                sealAnchor = retained
            } else {
                sealAttemptAnchors[eventID] = sealAnchor
            }
        } else if commandType == "reserve_format_repair" {
            try prepareFormatRepairReservationLocked(&command)
        } else if commandType == "claim_format_repair" {
            try prepareFormatRepairClaimLocked(&command)
        } else if commandType == "complete_transport" {
            try prepareTransportCompletionLocked(&command)
        }
        let result: CoordinatorSemanticExecutionResult
        do {
            result = try semantic.execute(
                command: StrictJSONTransport.data(forJSONObject: command)
            )
        } catch {
            if let recovered = try recoverCommittedNoEffectLifecycleLocked(
                commandType: commandType,
                command: command
            ) {
                result = recovered
            } else {
                try? removeTerminalRuntimeEntriesLocked()
                throw error
            }
        }
        let now = clock.nowNanoseconds()
        lastClockNanoseconds = max(lastClockNanoseconds ?? now, now)
        if commandType == "seal_packet" {
            try registerSealedPacketLocked(command: command, anchor: sealAnchor)
            if let sealEventID { sealAttemptAnchors.removeValue(forKey: sealEventID) }
        } else if commandType == "reserve_format_repair" {
            try registerFormatRepairLocked(command: command, anchor: authorityAnchor)
        } else if commandType == "claim_format_repair" {
            if let envelope = command["envelope"] as? [String: Any],
               let continuationID = envelope["continuation_id"] as? String
            {
                formatRepairs.removeValue(forKey: continuationID)
            }
        } else {
            try removeTerminalRuntimeEntriesLocked()
        }
        return result
    }

    /// Consumes a one-time Pet action only while its process-local continuous
    /// clock anchor proves that the fixed token window is still open. The
    /// caller-provided wall timestamp is replaced before semantic validation.
    public func routeConsumePetAction(
        _ commandData: Data
    ) throws -> CoordinatorSemanticExecutionResult {
        lock.lock()
        defer { lock.unlock() }
        try processDueLocked()

        var command = try StrictJSONTransport.object(from: commandData)
        let commandType = try requiredCommandType(command)
        try require(
            commandType == "consume_pet_action",
            "route_consume_command_invalid"
        )
        guard let envelope = command["envelope"] as? [String: Any],
              let continuationID = envelope["continuation_id"] as? String,
              !continuationID.isEmpty,
              IdentifierNormalization.isNFC(continuationID)
        else { throw CoordinatorError("continuation_not_dispatched") }
        guard let current = inFlight[continuationID] else {
            throw CoordinatorError("routing_continuation_not_in_flight")
        }
        let binding = try CoordinatorBinding(jsonObject: envelope)
        try require(binding == current.binding, "decision_boundary_binding_mismatch")

        let state = try CoordinatorSemanticReplay.replay(journal.load())
        guard let continuation = state.continuation(id: continuationID) else {
            throw CoordinatorError("continuation_not_dispatched")
        }
        try require(
            continuation.binding == current.binding,
            "decision_boundary_binding_mismatch"
        )
        let now = clock.nowNanoseconds()
        let elapsed = elapsedNanoseconds(from: current.anchorNanoseconds, to: now)
        try require(elapsed < Self.continuationValidityNanoseconds, "continuation_expired")
        try require(continuation.issuedAt == current.issuedAt, "continuation_binding_mismatch")
        let logicalNow = try current.issuedAt.adding(nanoseconds: elapsed)
        try require(logicalNow < continuation.expiresAt, "continuation_expired")
        command["occurred_at"] = logicalNow.rawValue

        let result: CoordinatorSemanticExecutionResult
        do {
            result = try semantic.execute(
                command: StrictJSONTransport.data(forJSONObject: command)
            )
        } catch {
            try? removeTerminalRuntimeEntriesLocked()
            throw error
        }
        lastClockNanoseconds = max(lastClockNanoseconds ?? now, now)
        return result
    }

    /// Explicitly selects or switches the one process-wide foreground card.
    /// The target must name the exact current pending revision and expected
    /// state; passing a session or packet prefix is never sufficient.
    public func setForeground(_ targetData: Data) throws -> CoordinatorRoutingSnapshot {
        lock.lock()
        defer { lock.unlock() }
        try processDueLocked()
        let target = try routingTarget(from: targetData)
        guard let current = pending[target.binding.fullKey],
              current.identity.matches(target)
        else { throw CoordinatorError("foreground_target_not_pending") }
        foreground = current.identity
        return try snapshotLocked()
    }

    public func clearForeground() throws -> CoordinatorRoutingSnapshot {
        lock.lock()
        defer { lock.unlock() }
        try processDueLocked()
        foreground = nil
        return try snapshotLocked()
    }

    /// Routes a Pet selection through the exact foreground identity. The
    /// external wall timestamp is not an authority: the semantic event time is
    /// derived from seal audit time plus continuous monotonic elapsed time.
    public func routeSelection(_ commandData: Data) throws -> CoordinatorSemanticExecutionResult {
        lock.lock()
        defer { lock.unlock() }
        try processDueLocked()

        var command = try StrictJSONTransport.object(from: commandData)
        let commandType = try requiredCommandType(command)
        try require(commandType == "select_option", "route_selection_command_invalid")
        try require(command["expected_state"] as? String == "pending", "routing_expected_state_mismatch")
        guard let request = command["request"] as? [String: Any] else {
            throw CoordinatorError("selection_schema_version_invalid")
        }
        let binding = try CoordinatorBinding(jsonObject: request)
        guard let current = pending[binding.fullKey] else {
            throw CoordinatorError("routing_interaction_not_pending")
        }
        guard let foreground else { throw CoordinatorError("foreground_interaction_required") }
        try require(
            pending[foreground.binding.fullKey]?.identity.matches(foreground) == true,
            "foreground_interaction_stale"
        )
        let supplied = try selectionIdentity(request: request, binding: binding)
        try require(foreground.matches(supplied), "foreground_interaction_mismatch")
        try require(current.identity.matches(supplied), "foreground_interaction_mismatch")

        let now = clock.nowNanoseconds()
        let elapsed = elapsedNanoseconds(from: current.anchorNanoseconds, to: now)
        guard elapsed < Self.expiryAfterNanoseconds else {
            try expirePendingLocked(current, reason: "selection_timeout")
            throw CoordinatorError("routing_interaction_expired")
        }
        let logicalNow = try current.sealedAt.adding(nanoseconds: elapsed)
        try require(logicalNow < current.expiresAt, "routing_interaction_expired")

        let state = try CoordinatorSemanticReplay.replay(journal.load())
        guard let packet = state.packet(for: binding),
              let optionID = request["option_id"] as? String,
              let choice = packet.choices.first(where: {
                  IdentifierNormalization.isByteExact($0.optionID, optionID)
              })
        else { throw CoordinatorError("decision_option_not_found") }

        command["occurred_at"] = logicalNow.rawValue
        var inFlightDuration: UInt64?
        if choice.slot == 1 || choice.slot == 2 {
            // Pet input never chooses authority duration. The coordinator owns
            // the fixed v0.1 120-second token and 300-second in-flight windows.
            let tokenDuration = Self.continuationValidityNanoseconds
            let deadlineDuration = Self.inFlightDeadlineNanoseconds
            command["issued_at"] = logicalNow.rawValue
            let routedExpiry = try logicalNow.adding(nanoseconds: tokenDuration)
            let routedDeadline = try logicalNow.adding(nanoseconds: deadlineDuration)
            command["expires_at"] = routedExpiry.rawValue
            command["in_flight_deadline_at"] = routedDeadline.rawValue
            inFlightDuration = deadlineDuration
        }

        let routedCommand = try StrictJSONTransport.data(forJSONObject: command)
        ambiguousSelections[binding.fullKey] = RoutingAmbiguousSelection(
            command: routedCommand,
            binding: binding,
            anchorNanoseconds: now,
            inFlightDuration: inFlightDuration
        )
        let result: CoordinatorSemanticExecutionResult
        do {
            result = try semantic.execute(command: routedCommand)
            ambiguousSelections.removeValue(forKey: binding.fullKey)
        } catch {
            // A concurrent process may have won the semantic CAS after the
            // foreground preflight. Reconcile local authority before surfacing
            // the semantic error so a stale card cannot remain selectable.
            if let recovered = try recoverCommittedSelectionWithoutEffectLocked(
                command: command,
                binding: binding,
                inFlightDuration: inFlightDuration
            ) {
                // The selection is durable, but the one-time token effect was
                // lost with the response and is never reconstructed.
                result = recovered
                ambiguousSelections.removeValue(forKey: binding.fullKey)
            } else {
                ambiguousSelections.removeValue(forKey: binding.fullKey)
                try? removeTerminalRuntimeEntriesLocked()
                throw error
            }
        }
        pending.removeValue(forKey: binding.fullKey)
        self.foreground = nil

        if let inFlightDuration,
           let continuationID = command["continuation_id"] as? String
        {
            let deadlineAt = try logicalNow.adding(nanoseconds: inFlightDuration)
            inFlight[continuationID] = RoutingInFlightContinuation(
                continuationID: continuationID,
                binding: binding,
                issuedAt: logicalNow,
                deadlineAt: deadlineAt,
                anchorNanoseconds: now,
                deadlineAfterNanoseconds: inFlightDuration
            )
        }
        lastClockNanoseconds = max(lastClockNanoseconds ?? now, now)
        return result
    }

    /// Advances reminder/expiry/in-flight scheduling against the injected
    /// continuous clock and returns notices accumulated since the last drain.
    public func processTime() throws -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        try reconcileAmbiguousSelectionsLocked()
        try processDueLocked()
        return drainNoticesLocked()
    }

    /// Used by the product event loop when waking on a monotonic deadline. It
    /// intentionally preserves notices until the Pet asks for them.
    public func processTimeKeepingNotices() throws {
        lock.lock()
        defer { lock.unlock() }
        try reconcileAmbiguousSelectionsLocked()
        try processDueLocked()
    }

    public func snapshot() throws -> CoordinatorRoutingSnapshot {
        lock.lock()
        defer { lock.unlock() }
        try processDueLocked()
        return try snapshotLocked()
    }

    /// Module-internal, read-only journal authority for the operational
    /// adapter's idempotent reconciliation. It is intentionally not exposed by
    /// UDS and never returns token material outside this Swift module.
    func authoritativeState() throws -> CoordinatorSemanticState {
        lock.lock()
        defer { lock.unlock() }
        return try authoritativeStateLocked()
    }

    public func drainNotices() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return drainNoticesLocked()
    }

    /// Returns nil when no scheduler deadline exists, otherwise the bounded
    /// delay suitable for `poll(2)`. Zero means work is already due.
    public func millisecondsUntilNextDeadline() -> Int32? {
        lock.lock()
        defer { lock.unlock() }
        // Ambiguity reconciliation runs before every other due transition. If
        // its authority read keeps failing, no other zero-deadline work can
        // make progress, so keep a bounded retry instead of falling into the
        // UDS scheduler's 1ms minimum loop.
        if !ambiguousSelections.isEmpty { return 250 }
        guard !pending.isEmpty || !inFlight.isEmpty || !formatRepairs.isEmpty else {
            return nil
        }
        let now = clock.nowNanoseconds()
        var next = UInt64.max
        for item in pending.values {
            let elapsed = elapsedNanoseconds(from: item.anchorNanoseconds, to: now)
            if !item.reminderEmitted, elapsed < Self.reminderAfterNanoseconds {
                next = min(next, Self.reminderAfterNanoseconds - elapsed)
            } else if !item.reminderEmitted {
                return 0
            }
            if elapsed < Self.expiryAfterNanoseconds {
                next = min(next, Self.expiryAfterNanoseconds - elapsed)
            } else {
                return 0
            }
        }
        for item in inFlight.values {
            let elapsed = elapsedNanoseconds(from: item.anchorNanoseconds, to: now)
            if elapsed < item.deadlineAfterNanoseconds {
                next = min(next, item.deadlineAfterNanoseconds - elapsed)
            } else {
                return 0
            }
        }
        for item in formatRepairs.values {
            let elapsed = elapsedNanoseconds(from: item.anchorNanoseconds, to: now)
            if elapsed < Self.continuationValidityNanoseconds {
                next = min(next, Self.continuationValidityNanoseconds - elapsed)
            } else {
                return 0
            }
        }
        guard next != UInt64.max else { return nil }
        let milliseconds = (next + 999_999) / 1_000_000
        return Int32(min(milliseconds, UInt64(Int32.max)))
    }
}

private extension CoordinatorRoutingApplication {
    func authoritativeStateLocked() throws -> CoordinatorSemanticState {
        try CoordinatorSemanticReplay.replay(journal.load())
    }

    func recoverCommittedNoEffectLifecycleLocked(
        commandType: String,
        command: [String: Any]
    ) throws -> CoordinatorSemanticExecutionResult? {
        guard ["open_boundary", "seal_packet"].contains(commandType),
              let eventID = command["event_id"] as? String
        else { return nil }
        let snapshot = try journal.load()
        let state = try CoordinatorSemanticReplay.replay(snapshot)
        guard state.eventIDs.contains(eventID),
              let eventData = snapshot.events.first(where: { data in
                  guard let event = try? StrictJSONTransport.object(from: data)
                  else { return false }
                  guard let candidateID = event["event_id"] as? String else { return false }
                  return IdentifierNormalization.isByteExact(candidateID, eventID)
                      && event["event_type"] as? String
                          == (commandType == "open_boundary"
                              ? "decision_boundary_opened"
                              : "decision_packet_sealed")
              }),
              let event = try? StrictJSONTransport.object(from: eventData),
              let sequence = ExactJSONInteger.int64(event["event_sequence"], minimum: 1)
        else { return nil }

        if commandType == "open_boundary" {
            let binding = try commandBinding(command)
            guard let boundary = state.boundary(for: binding),
                  let proposalID = command["proposal_id"] as? String,
                  let occurredAt = command["occurred_at"] as? String,
                  let payload = event["payload"] as? [String: Any],
                  let eventProposalID = payload["proposal_id"] as? String,
                  (try? CoordinatorBinding(jsonObject: event)) == binding,
                  IdentifierNormalization.isByteExact(boundary.proposalID, proposalID),
                  IdentifierNormalization.isByteExact(eventProposalID, proposalID),
                  IdentifierNormalization.isByteExact(boundary.openedAt.rawValue, occurredAt),
                  IdentifierNormalization.isByteExact(event["occurred_at"] as? String ?? "", occurredAt)
            else { return nil }
        } else {
            guard let packetObject = command["packet"] as? [String: Any] else {
                return nil
            }
            let packet = try CoordinatorPacketDocument.parse(
                StrictJSONTransport.data(forJSONObject: packetObject)
            )
            guard let payload = event["payload"] as? [String: Any],
                  (try? CoordinatorBinding(jsonObject: event)) == packet.binding,
                  state.packet(for: packet.binding)?.canonicalJSON == packet.canonicalJSON,
                  IdentifierNormalization.isByteExact(
                      event["occurred_at"] as? String ?? "",
                      packet.sealedAt.rawValue
                  ),
                  IdentifierNormalization.isByteExact(
                      payload["interaction_id"] as? String ?? "",
                      packet.interactionID
                  ),
                  IdentifierNormalization.isByteExact(
                      payload["packet_id"] as? String ?? "",
                      packet.packetID
                  ),
                  ExactJSONInteger.int64(payload["revision"], minimum: 1) == packet.revision,
                  IdentifierNormalization.isByteExact(
                      payload["expires_at"] as? String ?? "",
                      packet.expiresAt.rawValue
                  )
            else { return nil }
        }
        return CoordinatorSemanticExecutionResult(
            commit: JournalAppendResult(
                firstSequence: sequence,
                lastSequence: sequence,
                eventCount: 1
            ),
            effects: []
        )
    }

    func recoverCommittedSelectionWithoutEffectLocked(
        command: [String: Any],
        binding: CoordinatorBinding,
        inFlightDuration: UInt64?
    ) throws -> CoordinatorSemanticExecutionResult? {
        guard let request = command["request"] as? [String: Any],
              let eventIDs = command["event_ids"] as? [String: Any],
              let claimEventID = eventIDs["selection_claimed"] as? String,
              let occurredAt = command["occurred_at"] as? String
        else { return nil }
        let snapshot = try journal.load()
        let state = try CoordinatorSemanticReplay.replay(snapshot)

        func authorityEvent(
            id: String,
            type: String
        ) throws -> ([String: Any], Int64)? {
            for data in snapshot.events {
                let event = try StrictJSONTransport.object(from: data)
                guard let candidateID = event["event_id"] as? String,
                      IdentifierNormalization.isByteExact(candidateID, id)
                else { continue }
                guard event["event_type"] as? String == type,
                      (try? CoordinatorBinding(jsonObject: event)) == binding,
                      IdentifierNormalization.isByteExact(
                          event["occurred_at"] as? String ?? "",
                          occurredAt
                      ),
                      let sequence = ExactJSONInteger.int64(
                          event["event_sequence"],
                          minimum: 1
                      )
                else { return nil }
                return (event, sequence)
            }
            return nil
        }

        guard let (claimEvent, claimSequence) = try authorityEvent(
                  id: claimEventID,
                  type: "decision_selection_claimed"
              ),
              let authorityBoundary = state.boundary(for: binding),
              let selection = authorityBoundary.selection,
              let selectionID = request["selection_id"] as? String,
              let interactionID = request["interaction_id"] as? String,
              let packetID = request["packet_id"] as? String,
              let optionID = request["option_id"] as? String,
              IdentifierNormalization.isByteExact(selection.selectionID, selectionID),
              IdentifierNormalization.isByteExact(selection.interactionID, interactionID),
              IdentifierNormalization.isByteExact(selection.packetID, packetID),
              selection.revision == ExactJSONInteger.int64(request["revision"], minimum: 1),
              IdentifierNormalization.isByteExact(selection.optionID, optionID),
              let claimPayload = claimEvent["payload"] as? [String: Any],
              IdentifierNormalization.isByteExact(
                  claimPayload["selection_id"] as? String ?? "",
                  selectionID
              ),
              IdentifierNormalization.isByteExact(
                  claimPayload["interaction_id"] as? String ?? "",
                  interactionID
              ),
              IdentifierNormalization.isByteExact(
                  claimPayload["packet_id"] as? String ?? "",
                  packetID
              ),
              ExactJSONInteger.int64(claimPayload["revision"], minimum: 1)
                  == selection.revision,
              IdentifierNormalization.isByteExact(
                  claimPayload["option_id"] as? String ?? "",
                  optionID
              )
        else { return nil }

        let terminalSequence: Int64
        if selection.slot == 1 || selection.slot == 2 {
            guard let duration = inFlightDuration,
                  duration == Self.inFlightDeadlineNanoseconds,
                  let dispatchEventID = eventIDs["continuation_dispatched"] as? String,
                  let (dispatchEvent, dispatchSequence) = try authorityEvent(
                      id: dispatchEventID,
                      type: "continuation_dispatched"
                  ),
                  dispatchSequence == claimSequence + 1,
                  let continuationID = command["continuation_id"] as? String,
                  let continuation = state.continuation(id: continuationID),
                  continuation.binding == binding,
                  IdentifierNormalization.isByteExact(
                      continuation.dispatchEventID,
                      dispatchEventID
                  ),
                  IdentifierNormalization.isByteExact(
                      continuation.interactionID,
                      interactionID
                  ),
                  IdentifierNormalization.isByteExact(continuation.packetID, packetID),
                  continuation.revision == selection.revision,
                  IdentifierNormalization.isByteExact(continuation.optionID, optionID),
                  continuation.transport == nil,
                  let issuedAt = try? RFC3339Instant(
                      command["issued_at"] as? String ?? "",
                      code: "continuation_time_invalid"
                  ),
                  let deadlineAt = try? RFC3339Instant(
                      command["in_flight_deadline_at"] as? String ?? "",
                      code: "continuation_time_invalid"
                  ),
                  let expiresAt = try? RFC3339Instant(
                      command["expires_at"] as? String ?? "",
                      code: "continuation_time_invalid"
                  ),
                  continuation.issuedAt == issuedAt,
                  continuation.expiresAt == expiresAt,
                  continuation.inFlightDeadlineAt == deadlineAt,
                  issuedAt.nanoseconds(until: deadlineAt) == duration,
                  let dispatchPayload = dispatchEvent["payload"] as? [String: Any],
                  IdentifierNormalization.isByteExact(
                      dispatchPayload["continuation_id"] as? String ?? "",
                      continuationID
                  ),
                  IdentifierNormalization.isByteExact(
                      dispatchPayload["action_id"] as? String ?? "",
                      continuation.actionID
                  ),
                  IdentifierNormalization.isByteExact(
                      dispatchPayload["issued_at"] as? String ?? "",
                      issuedAt.rawValue
                  ),
                  IdentifierNormalization.isByteExact(
                      dispatchPayload["expires_at"] as? String ?? "",
                      expiresAt.rawValue
                  ),
                  IdentifierNormalization.isByteExact(
                      dispatchPayload["in_flight_deadline_at"] as? String ?? "",
                      deadlineAt.rawValue
                  )
            else { return nil }
            terminalSequence = dispatchSequence
        } else {
            guard selection.slot == 3,
                  let closeEventID = eventIDs["decision_boundary_closed"] as? String,
                  let (closeEvent, closeSequence) = try authorityEvent(
                      id: closeEventID,
                      type: "decision_boundary_closed"
                  ),
                  closeSequence == claimSequence + 1,
                  authorityBoundary.closed,
                  authorityBoundary.closeReason == "episode_paused",
                  let closePayload = closeEvent["payload"] as? [String: Any],
                  closePayload["close_reason"] as? String == "episode_paused"
            else { return nil }
            terminalSequence = closeSequence
        }
        return CoordinatorSemanticExecutionResult(
            commit: JournalAppendResult(
                firstSequence: claimSequence,
                lastSequence: terminalSequence,
                eventCount: 2
            ),
            effects: []
        )
    }

    func reconcileAmbiguousSelectionsLocked() throws {
        for (key, record) in Array(ambiguousSelections) {
            let command = try StrictJSONTransport.object(from: record.command)
            if try recoverCommittedSelectionWithoutEffectLocked(
                command: command,
                binding: record.binding,
                inFlightDuration: record.inFlightDuration
            ) != nil {
                let authorityState = try authoritativeStateLocked()
                guard let request = command["request"] as? [String: Any],
                      let authority = authorityState.boundary(for: record.binding),
                      let selection = authority.selection
                else { throw CoordinatorError("ambiguous_selection_authority_mismatch") }
                pending.removeValue(forKey: key)
                if foreground?.binding.fullKey == key { foreground = nil }

                if selection.slot == 1 || selection.slot == 2 {
                    guard let duration = record.inFlightDuration,
                          let continuationID = command["continuation_id"] as? String,
                          let issuedAtText = command["issued_at"] as? String,
                          let deadlineAtText = command["in_flight_deadline_at"] as? String
                    else { throw CoordinatorError("ambiguous_selection_authority_mismatch") }
                    let issuedAt = try RFC3339Instant(
                        issuedAtText,
                        code: "continuation_time_invalid"
                    )
                    let deadlineAt = try RFC3339Instant(
                        deadlineAtText,
                        code: "continuation_time_invalid"
                    )
                    inFlight[continuationID] = RoutingInFlightContinuation(
                        continuationID: continuationID,
                        binding: record.binding,
                        issuedAt: issuedAt,
                        deadlineAt: deadlineAt,
                        anchorNanoseconds: record.anchorNanoseconds,
                        deadlineAfterNanoseconds: duration
                    )
                    try enqueueNotice([
                        "kind": "selection_committed_effect_lost",
                        "continuation_id": continuationID,
                        "selection_id": request["selection_id"]!,
                    ], binding: record.binding)
                } else {
                    try enqueueNotice([
                        "kind": "selection_pause_committed_response_lost",
                        "selection_id": request["selection_id"]!,
                    ], binding: record.binding)
                }
                ambiguousSelections.removeValue(forKey: key)
                continue
            }

            let authority = try authoritativeStateLocked()
            guard authority.boundary(for: record.binding)?.selection == nil else {
                throw CoordinatorError("ambiguous_selection_authority_mismatch")
            }
            // The append did not commit. Keep the original pending/foreground
            // authority and Operational waiter intact so the same Pet request
            // can be retried. If it is already overdue, processDueLocked below
            // emits the ordinary expiry notice instead.
            ambiguousSelections.removeValue(forKey: key)
        }
    }

    func recoverPersistedAmbiguity() throws {
        foreground = nil
        let snapshot = try journal.load()
        let state = try CoordinatorSemanticReplay.replay(snapshot)
        for boundary in state.pendingInteractions.sorted(by: boundaryOrder) {
            guard let packet = boundary.packet else { continue }
            let command: [String: Any] = [
                "type": "expire_interaction",
                "event_id": eventIDGenerator("restart_expiry"),
                "occurred_at": packet.expiresAt.rawValue,
                "binding": boundary.binding.jsonObject,
                "reason": "restart_elapsed_ambiguous",
            ]
            _ = try semantic.execute(command: StrictJSONTransport.data(forJSONObject: command))
            try enqueueNotice([
                "kind": "interaction_expired",
                "reason": "restart_elapsed_ambiguous",
                "interaction_id": packet.interactionID,
                "packet_id": packet.packetID,
                "revision": packet.revision,
            ], binding: boundary.binding)
        }

        // A lost process-local deadline anchor cannot prove that dispatch is
        // still within its window. Mark it unknown once; never retry it.
        let recovered = try CoordinatorSemanticReplay.replay(journal.load())
        for continuation in recovered.unterminatedContinuations.sorted(by: {
            $0.continuationID.utf8.lexicographicallyPrecedes($1.continuationID.utf8)
        }) {
            let command: [String: Any] = [
                "type": "timeout_transport_unknown",
                "event_id": eventIDGenerator("restart_timeout"),
                "occurred_at": continuation.inFlightDeadlineAt.rawValue,
                "binding": continuation.binding.jsonObject,
                "continuation_id": continuation.continuationID,
            ]
            _ = try semantic.execute(command: StrictJSONTransport.data(forJSONObject: command))
            try enqueueNotice([
                "kind": "continuation_timed_out_unknown",
                "reason": "restart_elapsed_ambiguous",
                "continuation_id": continuation.continuationID,
                "automatic_retry": false,
            ], binding: continuation.binding)
        }
        pending.removeAll()
        inFlight.removeAll()
        formatRepairs.removeAll()
        lastClockNanoseconds = clock.nowNanoseconds()
    }

    func processDueLocked() throws {
        let now = clock.nowNanoseconds()
        if let previous = lastClockNanoseconds, now < previous {
            try failClosedForClockRegressionLocked()
            lastClockNanoseconds = now
            return
        }
        lastClockNanoseconds = now

        let orderedPending = pending.values.sorted { left, right in
            if left.anchorNanoseconds != right.anchorNanoseconds {
                return left.anchorNanoseconds < right.anchorNanoseconds
            }
            return bindingOrder(left.identity.binding, right.identity.binding)
        }
        for item in orderedPending {
            guard var current = pending[item.identity.binding.fullKey] else { continue }
            let elapsed = elapsedNanoseconds(from: current.anchorNanoseconds, to: now)
            if !current.reminderEmitted, elapsed >= Self.reminderAfterNanoseconds,
               elapsed < Self.expiryAfterNanoseconds
            {
                current.reminderEmitted = true
                pending[current.identity.binding.fullKey] = current
                try enqueueNotice([
                    "kind": "interaction_reminder_due",
                    "interaction_id": current.identity.interactionID,
                    "packet_id": current.identity.packetID,
                    "revision": current.identity.revision,
                ], binding: current.identity.binding)
            }
            if elapsed >= Self.expiryAfterNanoseconds {
                try expirePendingLocked(current, reason: "selection_timeout")
            }
        }

        let orderedInFlight = inFlight.values.sorted {
            $0.continuationID.utf8.lexicographicallyPrecedes($1.continuationID.utf8)
        }
        for item in orderedInFlight {
            guard inFlight[item.continuationID] != nil else { continue }
            let elapsed = elapsedNanoseconds(from: item.anchorNanoseconds, to: now)
            if elapsed >= item.deadlineAfterNanoseconds {
                try timeoutInFlightLocked(item, reason: "in_flight_deadline_elapsed")
            }
        }
        formatRepairs = formatRepairs.filter { _, item in
            elapsedNanoseconds(from: item.anchorNanoseconds, to: now)
                < Self.continuationValidityNanoseconds
        }
        try removeTerminalRuntimeEntriesLocked()
    }

    func failClosedForClockRegressionLocked() throws {
        for item in Array(pending.values) {
            try expirePendingLocked(item, reason: "monotonic_clock_regressed")
        }
        for item in Array(inFlight.values) {
            try timeoutInFlightLocked(item, reason: "monotonic_clock_regressed")
        }
        formatRepairs.removeAll()
        foreground = nil
    }

    func expirePendingLocked(
        _ item: RoutingPendingInteraction,
        reason: String
    ) throws {
        let command: [String: Any] = [
            "type": "expire_interaction",
            "event_id": eventIDGenerator("interaction_expiry"),
            "occurred_at": item.expiresAt.rawValue,
            "binding": item.identity.binding.jsonObject,
            "reason": reason,
        ]
        var appended = false
        do {
            _ = try semantic.execute(command: StrictJSONTransport.data(forJSONObject: command))
            appended = true
        } catch {
            let authority = try authoritativeStateLocked()
            if authority.boundary(for: item.identity.binding)?.expired == true {
                // The expiry append may have committed before its response was
                // lost. The authoritative terminal state still requires one
                // process-local notice so Operational can resume its waiter.
                appended = true
            } else if let coordinatorError = error as? CoordinatorError,
                      [
                          "interaction_already_expired", "interaction_already_claimed",
                          "decision_boundary_closed",
                      ].contains(coordinatorError.code)
            {
                // Another writer made the card terminal for a different
                // reason. Do not synthesize an expiry notice.
            } else {
                throw error
            }
        }
        pending.removeValue(forKey: item.identity.binding.fullKey)
        if foreground?.matches(item.identity) == true { foreground = nil }
        if appended {
            try enqueueNotice([
                "kind": "interaction_expired",
                "reason": reason,
                "interaction_id": item.identity.interactionID,
                "packet_id": item.identity.packetID,
                "revision": item.identity.revision,
            ], binding: item.identity.binding)
        }
    }

    func timeoutInFlightLocked(
        _ item: RoutingInFlightContinuation,
        reason: String
    ) throws {
        let command: [String: Any] = [
            "type": "timeout_transport_unknown",
            "event_id": eventIDGenerator("in_flight_timeout"),
            "occurred_at": item.deadlineAt.rawValue,
            "binding": item.binding.jsonObject,
            "continuation_id": item.continuationID,
        ]
        var appended = false
        do {
            _ = try semantic.execute(command: StrictJSONTransport.data(forJSONObject: command))
            appended = true
        } catch {
            let authority = try authoritativeStateLocked()
            if authority.continuation(id: item.continuationID)?.transport?.status
                == .timedOutUnknown
            {
                // The timeout append committed even though its response was
                // lost. Preserve exactly one notice before dropping runtime
                // authority so Operational can close/promote.
                appended = true
            } else if let coordinatorError = error as? CoordinatorError,
                      coordinatorError.code == "transport_already_terminal"
            {
                // A completion won the journal CAS. Do not append a timeout.
            } else {
                throw error
            }
        }
        inFlight.removeValue(forKey: item.continuationID)
        if appended {
            try enqueueNotice([
                "kind": "continuation_timed_out_unknown",
                "reason": reason,
                "continuation_id": item.continuationID,
                "automatic_retry": false,
            ], binding: item.binding)
        }
    }

    func registerSealedPacketLocked(
        command: [String: Any],
        anchor: UInt64
    ) throws {
        guard let packetObject = command["packet"] as? [String: Any] else {
            throw CoordinatorError("packet_document_kind_invalid")
        }
        let packet = try CoordinatorPacketDocument.parse(
            StrictJSONTransport.data(forJSONObject: packetObject)
        )
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        guard let boundary = state.boundary(for: packet.binding),
              boundary.isPendingInteraction,
              let reference = boundary.packet
        else { throw CoordinatorError("routing_interaction_not_pending") }
        let identity = RoutingInteractionIdentity(
            binding: packet.binding,
            interactionID: reference.interactionID,
            packetID: reference.packetID,
            revision: reference.revision
        )
        if let foreground, foreground.binding.fullKey == packet.binding.fullKey {
            // A new revision is new authority. It must be selected explicitly.
            self.foreground = nil
        }
        pending[packet.binding.fullKey] = RoutingPendingInteraction(
            identity: identity,
            sealedAt: packet.sealedAt,
            expiresAt: packet.expiresAt,
            anchorNanoseconds: anchor,
            reminderEmitted: false
        )
    }

    func validateRoutedPacketInterval(_ command: [String: Any]) throws {
        guard let packetObject = command["packet"] as? [String: Any] else {
            throw CoordinatorError("packet_document_kind_invalid")
        }
        let packet = try CoordinatorPacketDocument.parse(
            StrictJSONTransport.data(forJSONObject: packetObject)
        )
        try require(
            packet.sealedAt.nanoseconds(until: packet.expiresAt) == Self.expiryAfterNanoseconds,
            "routing_packet_expiry_interval_invalid"
        )
    }

    func prepareFormatRepairReservationLocked(_ command: inout [String: Any]) throws {
        guard let occurredAtText = command["occurred_at"] as? String else {
            throw CoordinatorError("format_repair_time_invalid")
        }
        let reservedAt = try RFC3339Instant(
            occurredAtText,
            code: "format_repair_time_invalid"
        )
        command["issued_at"] = reservedAt.rawValue
        command["expires_at"] = try reservedAt
            .adding(nanoseconds: Self.continuationValidityNanoseconds)
            .rawValue
    }

    func registerFormatRepairLocked(
        command: [String: Any],
        anchor: UInt64
    ) throws {
        let binding = try commandBinding(command)
        let continuationID = try requiredIdentifier(command, "continuation_id")
        guard let reservedAtText = command["occurred_at"] as? String else {
            throw CoordinatorError("format_repair_time_invalid")
        }
        let reservedAt = try RFC3339Instant(
            reservedAtText,
            code: "format_repair_time_invalid"
        )
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        guard let repair = state.boundary(for: binding)?.repair,
              repair.continuationID == continuationID,
              repair.claimedAt == nil
        else { throw CoordinatorError("format_repair_not_reserved") }
        formatRepairs[continuationID] = RoutingFormatRepairAuthority(
            continuationID: continuationID,
            binding: binding,
            reservedAt: reservedAt,
            anchorNanoseconds: anchor
        )
    }

    func prepareFormatRepairClaimLocked(_ command: inout [String: Any]) throws {
        guard let envelope = command["envelope"] as? [String: Any],
              let continuationID = envelope["continuation_id"] as? String,
              !continuationID.isEmpty,
              IdentifierNormalization.isNFC(continuationID),
              let authority = formatRepairs[continuationID]
        else { throw CoordinatorError("routing_format_repair_not_active") }
        let binding = try CoordinatorBinding(jsonObject: envelope)
        try require(binding == authority.binding, "decision_boundary_binding_mismatch")
        let now = lastClockNanoseconds ?? clock.nowNanoseconds()
        let elapsed = elapsedNanoseconds(from: authority.anchorNanoseconds, to: now)
        try require(
            elapsed < Self.continuationValidityNanoseconds,
            "routing_format_repair_not_active"
        )
        let logicalNow = try authority.reservedAt.adding(nanoseconds: elapsed)
        let expiresAt = try authority.reservedAt.adding(
            nanoseconds: Self.continuationValidityNanoseconds
        )
        try require(logicalNow < expiresAt, "routing_format_repair_not_active")
        command["occurred_at"] = logicalNow.rawValue
    }

    func prepareTransportCompletionLocked(_ command: inout [String: Any]) throws {
        let continuationID = try requiredIdentifier(command, "continuation_id")
        guard let authority = inFlight[continuationID] else {
            throw CoordinatorError("routing_continuation_not_in_flight")
        }
        let binding = try commandBinding(command)
        try require(binding == authority.binding, "decision_boundary_binding_mismatch")
        let now = lastClockNanoseconds ?? clock.nowNanoseconds()
        let elapsed = elapsedNanoseconds(from: authority.anchorNanoseconds, to: now)
        let logicalNow = try authority.issuedAt.adding(nanoseconds: elapsed)
        try require(
            logicalNow < authority.deadlineAt,
            "transport_completion_after_in_flight_deadline"
        )
        command["occurred_at"] = logicalNow.rawValue
    }

    func commandBinding(_ command: [String: Any]) throws -> CoordinatorBinding {
        if let nested = command["binding"] as? [String: Any] {
            return try CoordinatorBinding(jsonObject: nested)
        }
        return try CoordinatorBinding(jsonObject: command)
    }

    func removeTerminalRuntimeEntriesLocked() throws {
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        let pendingRemovals = pending.compactMap { key, item -> (CoordinatorBindingKey, RoutingPendingInteraction)? in
            state.pendingInteractions.contains(where: {
            $0.binding.fullKey == key
            }) ? nil : (key, item)
        }
        for (key, item) in pendingRemovals {
            pending.removeValue(forKey: key)
            if foreground?.matches(item.identity) == true { foreground = nil }
        }
        let continuationRemovals = inFlight.keys.filter {
            state.continuation(id: $0)?.transport != nil
        }
        for continuationID in continuationRemovals {
            inFlight.removeValue(forKey: continuationID)
        }
        let repairRemovals = formatRepairs.compactMap { continuationID, item -> String? in
            guard let repair = state.boundary(for: item.binding)?.repair,
                  repair.continuationID == continuationID,
                  repair.claimedAt == nil
            else { return continuationID }
            return nil
        }
        for continuationID in repairRemovals {
            formatRepairs.removeValue(forKey: continuationID)
        }
    }

    func routingTarget(from data: Data) throws -> RoutingInteractionIdentity {
        let target = try StrictJSONTransport.object(from: data)
        try require(target["expected_state"] as? String == "pending", "routing_expected_state_mismatch")
        let binding = try CoordinatorBinding(jsonObject: target)
        let interactionID = try requiredIdentifier(target, "interaction_id")
        let packetID = try requiredIdentifier(target, "packet_id")
        guard let revision = ExactJSONInteger.int64(target["revision"], minimum: 1) else {
            throw CoordinatorError("packet_revision_invalid")
        }
        return RoutingInteractionIdentity(
            binding: binding,
            interactionID: interactionID,
            packetID: packetID,
            revision: revision
        )
    }

    func selectionIdentity(
        request: [String: Any],
        binding: CoordinatorBinding
    ) throws -> RoutingInteractionIdentity {
        guard let revision = ExactJSONInteger.int64(request["revision"], minimum: 1) else {
            throw CoordinatorError("packet_revision_invalid")
        }
        return RoutingInteractionIdentity(
            binding: binding,
            interactionID: try requiredIdentifier(request, "interaction_id"),
            packetID: try requiredIdentifier(request, "packet_id"),
            revision: revision
        )
    }

    func snapshotLocked() throws -> CoordinatorRoutingSnapshot {
        // Public snapshot paths process due work first. Reuse that exact clock
        // sample so a second read cannot cross the expiry boundary and expose
        // an entry that was not evaluated by the scheduler.
        let now = lastClockNanoseconds ?? clock.nowNanoseconds()
        let queue: [[String: Any]] = pending.values.sorted { left, right in
            if left.anchorNanoseconds != right.anchorNanoseconds {
                return left.anchorNanoseconds < right.anchorNanoseconds
            }
            return bindingOrder(left.identity.binding, right.identity.binding)
        }.map { item in
            let elapsed = elapsedNanoseconds(from: item.anchorNanoseconds, to: now)
            var object = item.identity.jsonObject
            object["state"] = "pending"
            object["foreground"] = foreground?.matches(item.identity) == true
            object["reminder_due"] = item.reminderEmitted
            object["milliseconds_until_expiry"] = Int64(
                min(
                    elapsed >= Self.expiryAfterNanoseconds
                        ? 0
                        : (Self.expiryAfterNanoseconds - elapsed + 999_999) / 1_000_000,
                    UInt64(Int64.max)
                )
            )
            return object
        }
        let object: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_routing_snapshot",
            "selection_enabled": foreground != nil,
            "foreground": foreground?.jsonObject ?? NSNull(),
            "pending": queue,
            "in_flight_count": inFlight.count,
        ]
        return CoordinatorRoutingSnapshot(
            canonicalJSON: try StrictJSONTransport.data(forJSONObject: object)
        )
    }

    func enqueueNotice(
        _ fields: [String: Any],
        binding: CoordinatorBinding
    ) throws {
        var notice = fields
        notice["schema_version"] = "1.0"
        notice.merge(binding.jsonObject) { current, _ in current }
        queuedNotices.append(try StrictJSONTransport.data(forJSONObject: notice))
    }

    func drainNoticesLocked() -> [Data] {
        let result = queuedNotices
        queuedNotices.removeAll(keepingCapacity: true)
        return result
    }

    func requiredCommandType(_ command: [String: Any]) throws -> String {
        guard let type = command["type"] as? String, !type.isEmpty else {
            throw CoordinatorError("coordinator_command_type_missing")
        }
        return type
    }

    func requiredIdentifier(_ object: [String: Any], _ key: String) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty,
              value.unicodeScalars.count <= 512,
              IdentifierNormalization.isNFC(value)
        else { throw CoordinatorError("\(key)_invalid") }
        return value
    }

    func elapsedNanoseconds(from anchor: UInt64, to now: UInt64) -> UInt64 {
        now >= anchor ? now - anchor : UInt64.max
    }

    func boundaryOrder(_ left: CoordinatorBoundaryState, _ right: CoordinatorBoundaryState) -> Bool {
        bindingOrder(left.binding, right.binding)
    }

    func bindingOrder(_ left: CoordinatorBinding, _ right: CoordinatorBinding) -> Bool {
        let leftComponents = [
            left.projectID,
            left.sessionID,
            left.sourceTurnID,
            left.sourcePromptID,
            left.episodeID,
            left.episodeRootPromptID,
            left.episodeBaselineCheckpointID,
            left.decisionBoundaryID,
        ]
        let rightComponents = [
            right.projectID,
            right.sessionID,
            right.sourceTurnID,
            right.sourcePromptID,
            right.episodeID,
            right.episodeRootPromptID,
            right.episodeBaselineCheckpointID,
            right.decisionBoundaryID,
        ]
        for (leftValue, rightValue) in zip(leftComponents, rightComponents) {
            if leftValue == rightValue { continue }
            return leftValue.utf8.lexicographicallyPrecedes(rightValue.utf8)
        }
        return left.boundarySequence < right.boundarySequence
    }
}

import ClaudeCoreAdapter
import CoordinatorSwift
import Dispatch
import Foundation

/// One selected, context-fenced projection plus a presentation-only inbox of all
/// provider cards. Claude never acquires Codex approval or queued-action capabilities.
actor PetProviderTransport: PetProviderControlling {
    typealias Access = @Sendable () async -> PetProviderServiceAccess?
    typealias MonotonicNow = @Sendable () -> UInt64
    private static let collectionBudgetNanoseconds: UInt64 = 1_000_000_000
    private let codex: any PetCoordinatorTransport
    private let access: Access
    private let monotonicNow: MonotonicNow
    private var currentAccess: PetProviderServiceAccess?
    private var selectedID = "codex-primary"
    private var selectionGeneration: UInt64 = 0
    private var snapshotGeneration: UInt64 = 0
    private var legacyCodexFallback = false
    private var sessions: [PetProviderSession] = []
    private var currentContext: PetProviderContext?
    private var currentSnapshot: PetSnapshot?
    private var knownClaudePresentations: [String: PetSnapshot] = [:]
    private var receipts: [(String, PetSnapshot)] = []
    private var selectedReceipts: [(Data, PetSelectionRequest, PetProviderContext, PetSelectionOutcome)] = []
    private var attempted: [String: PetInteractionIdentity] = [:]
    private var inFlight = Set<String>()
    private var lastBackgroundSessionID: String?
    private var backgroundWasDeferred = false
    private var knownArrivalSequences: [PetProviderInboxIdentity: UInt64] = [:]
    private var nextMetadataIndex = 0

    init(codex: any PetCoordinatorTransport, access: @escaping Access,
         monotonicNow: @escaping MonotonicNow = { DispatchTime.now().uptimeNanoseconds }) {
        self.codex = codex; self.access = access; self.monotonicNow = monotonicNow
    }

    func selectSession(_ session: PetProviderSession) async throws {
        guard sessions.contains(session) else { throw failure("stale_context") }
        selectionGeneration &+= 1
        selectedID = session.id; currentContext = session.context
        backgroundWasDeferred = false
        legacyCodexFallback = false
        currentSnapshot = nil; selectedReceipts.removeAll()
    }

    func request(type: String, payload: Data) async throws -> Data {
        try await request(type: type, payload: payload, expectedContext: nil)
    }

    func request(type: String, payload: Data, expectedContext: PetProviderContext?) async throws -> Data {
        if type == "get_state" { return try await snapshot(payload: payload) }
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        let owned = await access()
        try requireCurrent(expectedContext, generation: generation)
        guard owned == currentAccess else { throw failure("service_replaced") }
        if let owned {
            try requireAccess(owned)
            guard expectedContext != nil || legacyCodexFallback else { throw failure("stale_context") }
        } else if expectedContext != nil {
            throw failure("service_replaced")
        }
        if expectedContext?.provider != .claude {
            if type == "select", let owned, let context = expectedContext {
                try requireAccess(owned)
                let body = try StrictJSONTransport.object(from: payload)
                let identity = try PetInteractionIdentity(jsonObject: body)
                let request = try PetSelectionRequest(identity: identity,
                    selectionID: text(body, "selection_id"), optionID: text(body, "option_id"))
                let result = try await providerRequest("select", context: context,
                    payload: selectionPayload(request), access: owned)
                try requireCurrent(context, generation: generation)
                guard let echoed = result["selection"] as? [String: Any],
                      try StrictJSONTransport.data(forJSONObject: echoed) == StrictJSONTransport.data(forJSONObject: selectionPayload(request)),
                      let receipt = result["receipt"] as? [String: Any],
                      receipt["schema_version"] as? String == "blabee.pet.codex-receipt.v1",
                      let value = receipt["value"] as? [String: Any] else { throw failure("receipt_invalid") }
                return try StrictJSONTransport.data(forJSONObject: value)
            }
            // Codex retains its original focus, native approval and event APIs.
            // A nil-context legacy path exists only before an owned bootstrap.
            let result = try await codex.request(type: type, payload: payload)
            guard await access() == owned else { throw failure("service_replaced") }
            try requireCurrent(expectedContext, generation: generation)
            return result
        }
        guard let context = expectedContext, let owned else { throw failure("unavailable") }
        try requireAccess(owned)
        let body = try StrictJSONTransport.object(from: payload)
        let identity = try PetInteractionIdentity(jsonObject: body)
        guard let snapshot = currentSnapshot,
              snapshot.providerStatus?.selectionEnabled == true,
              snapshot.routing.foreground == identity,
              snapshot.interactions.contains(where: { $0.identity == identity && $0.isSelectionReady }) else {
            throw failure("stale_context")
        }
        if type == "focus_interaction" {
            guard body["kind"] as? String == "blabee_pet_focus_request" else { throw failure("request_invalid") }
            return try StrictJSONTransport.data(forJSONObject: ["focused": true])
        }
        if type == "dismiss_interaction" {
            let dismissal = PetDismissRequest(identity: identity)
            guard try StrictJSONTransport.data(forJSONObject: body) == dismissal.data(),
                  snapshot.routing.selectionEnabled,
                  snapshot.interactions.contains(where: { $0.identity == identity && $0.foreground && $0.usesRankedNextActions }),
                  !inFlight.contains(context.scopeID), attempted[context.scopeID] != identity else {
                throw failure("operation_unavailable")
            }
            // Selection and dismissal share a mutation slot. Closing a card
            // never creates a selection ID or an execution receipt.
            inFlight.insert(context.scopeID)
            defer { inFlight.remove(context.scopeID) }
            let input: [String: Any] = ["binding": identity.binding.jsonObject,
                "interaction_id": identity.interactionID, "packet_id": identity.packetID,
                "revision": identity.revision]
            let result = try await providerRequest("dismiss_interaction", context: context,
                payload: input, access: owned)
            try requireCurrent(context, generation: generation)
            guard petStrictBooleanValue(result["dismissed"]) == true,
                  let echoed = result["dismissal"] as? [String: Any],
                  try StrictJSONTransport.data(forJSONObject: echoed) == StrictJSONTransport.data(forJSONObject: input) else {
                throw failure("receipt_invalid")
            }
            if currentSnapshot?.routing.foreground == identity { currentSnapshot = nil }
            return try StrictJSONTransport.data(forJSONObject: ["dismissed": true,
                "interaction_id": identity.interactionID, "packet_id": identity.packetID,
                "revision": identity.revision])
        }
        guard type == "select", body["kind"] as? String == "blabee_selection_request",
              !inFlight.contains(context.scopeID), attempted[context.scopeID] != identity else {
            throw failure("operation_unavailable")
        }
        let selection = try PetSelectionRequest(identity: identity,
            selectionID: text(body, "selection_id"), optionID: text(body, "option_id"))
        guard PetProviderContext.isUUID(selection.selectionID) else { throw failure("request_invalid") }
        inFlight.insert(context.scopeID); attempted[context.scopeID] = identity
        defer { inFlight.remove(context.scopeID) }
        let result = try await providerRequest("select", context: context,
            payload: selectionPayload(selection), access: owned)
        try requireCurrent(context, generation: generation)
        guard result["status"] as? String == "awaiting_claude_claim",
              let echoed = result["selection"] as? [String: Any],
              try StrictJSONTransport.data(forJSONObject: echoed) == StrictJSONTransport.data(forJSONObject: selectionPayload(selection)) else {
            throw failure("receipt_invalid")
        }
        let data = try StrictJSONTransport.data(forJSONObject: result)
        selectedReceipts.append((data, selection, context, .channelPending))
        if selectedReceipts.count > 8 { selectedReceipts.removeFirst() }
        return data
    }

    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        let object = try StrictJSONTransport.object(from: data)
        guard Set(object.keys) == ["provider_snapshot_receipt"], let id = object["provider_snapshot_receipt"] as? String,
              let index = receipts.firstIndex(where: { $0.0 == id }) else { throw failure("snapshot_receipt") }
        return receipts.remove(at: index).1
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome {
        try await selectionOutcome(data, request: request, expectedContext: nil)
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest,
                          expectedContext: PetProviderContext?) async throws -> PetSelectionOutcome {
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        let owned = await access()
        try requireCurrent(expectedContext, generation: generation)
        guard owned == currentAccess else { throw failure("service_replaced") }
        if expectedContext?.provider != .claude {
            let result = try await codex.selectionOutcome(data, request: request)
            guard await access() == owned else { throw failure("service_replaced") }
            try requireCurrent(expectedContext, generation: generation)
            return result
        }
        guard let context = expectedContext,
              let index = selectedReceipts.firstIndex(where: { $0.0 == data && $0.1 == request && $0.2 == context }) else {
            throw failure("selection_receipt")
        }
        return selectedReceipts.remove(at: index).3
    }

    func checkConnection(_ expectedContext: PetProviderContext) async throws {
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        guard expectedContext.provider == .claude, let owned = await access() else { throw failure("unavailable") }
        try requireCurrent(expectedContext, generation: generation); try requireAccess(owned)
        _ = try await providerRequest("readiness.begin", context: expectedContext, payload: [:], access: owned)
        try requireCurrent(expectedContext, generation: generation)
    }

    func disconnect(_ expectedContext: PetProviderContext) async throws {
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        guard expectedContext.provider == .claude, let owned = await access() else { throw failure("unavailable") }
        try requireCurrent(expectedContext, generation: generation); try requireAccess(owned)
        let request = try PetProviderDirectoryCodec.request(operation: "disconnect", payload: ["target": expectedContext.target])
        let decoded = try PetProviderDirectoryCodec.decode(await rpc("pet_directory_v1", request, access: owned), matching: request)
        guard decoded.service == expectedContext.serviceIncarnation,
              Set(decoded.result.keys) == ["disconnected"], petStrictBooleanValue(decoded.result["disconnected"]) == true else {
            throw failure("response_invalid")
        }
        try requireCurrent(expectedContext, generation: generation)
        currentSnapshot = nil
    }

    func checkSessionConnection(_ session: PetProviderSession) async throws {
        let owned = try await sessionAccess(session)
        _ = try await providerRequest("readiness.begin", context: session.context, payload: [:], access: owned)
        try await requireSession(session.context, access: owned)
    }

    func disconnectSession(_ session: PetProviderSession) async throws {
        let owned = try await sessionAccess(session)
        let request = try PetProviderDirectoryCodec.request(operation: "disconnect", payload: ["target": session.context.target])
        let result = try PetProviderDirectoryCodec.decode(await rpc("pet_directory_v1", request, access: owned), matching: request)
        guard result.service == session.context.serviceIncarnation,
              Set(result.result.keys) == ["disconnected"], petStrictBooleanValue(result.result["disconnected"]) == true else {
            throw failure("response_invalid")
        }
        try await requireSession(session.context, access: owned)
        if currentContext == session.context { currentSnapshot = nil }
    }

    private func sessionAccess(_ session: PetProviderSession) async throws -> PetProviderServiceAccess {
        guard session.context.provider == .claude, sessions.contains(session) else { throw failure("stale_context") }
        guard let owned = await access() else { throw failure("unavailable") }
        try await requireSession(session.context, access: owned)
        return owned
    }

    private func requireSession(_ context: PetProviderContext, access owned: PetProviderServiceAccess) async throws {
        guard await access() == owned, currentAccess == owned,
              sessions.contains(where: { $0.context == context }) else { throw failure("stale_context") }
    }

    private func snapshot(payload: Data) async throws -> Data {
        let snapshotStarted = monotonicNow()
        let deadlineResult = snapshotStarted.addingReportingOverflow(Self.collectionBudgetNanoseconds)
        let collectionDeadline = deadlineResult.overflow ? UInt64.max : deadlineResult.partialValue
        snapshotGeneration &+= 1
        let requestedSnapshot = snapshotGeneration
        let requestedGeneration = selectionGeneration
        let owned = await access()
        try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
        var diagnostic: String?
        var verifiedDirectory: PetProviderDirectoryStatus?
        var discovered = sessions
        if let owned {
            if currentAccess != owned {
                currentAccess = owned
                attempted.removeAll(); selectedReceipts.removeAll()
                knownArrivalSequences.removeAll(); nextMetadataIndex = 0
                lastBackgroundSessionID = nil; backgroundWasDeferred = false
            }
            do {
                discovered = try await directory(access: owned, deadline: collectionDeadline)
                try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                if let service = discovered.first?.context.serviceIncarnation {
                    verifiedDirectory = .init(serviceGeneration: owned.generation, serviceIncarnation: service)
                }
            } catch {
                try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                diagnostic = PetL10n.text("Unable to verify the Claude session list. Please check again.", korean: "Claude 세션 목록을 확인하지 못했어요. 다시 확인해 주세요.")
            }
        } else {
            currentAccess = nil
            if selectedID == "codex-primary" { discovered = [] }
            else { diagnostic = PetL10n.text("Disconnected. Start again from Claude.", korean: "연결이 끊겼어요. Claude에서 새로 시작해 주세요.") }
        }
        try requireSnapshot(requestedSnapshot, selection: requestedGeneration)

        // Gather every authenticated provider projection without changing the
        // selected context. Publish the complete generation only after all
        // access and overlapping-snapshot fences have passed.
        var projections: [String: PetSnapshot] = [:]
        var scopeDiagnostics: [String: String] = [:]
        var nextBackgroundSessionID = lastBackgroundSessionID
        var deferBackground = false
        if let owned, verifiedDirectory != nil {
            let codexIndex = discovered.firstIndex { $0.context.provider == .codex }
            let selectedClaudeIndex = discovered.firstIndex { $0.id == selectedID && $0.context.provider == .claude }
            let background = discovered.indices.filter {
                discovered[$0].context.provider == .claude && discovered[$0].id != selectedID
                    && discovered[$0].state != "disconnected"
            }
            let start = background.firstIndex { discovered[$0].id == lastBackgroundSessionID }
                .map { ($0 + 1) % max(1, background.count) } ?? 0
            let rotatingBackground = Array(background.dropFirst(start)) + Array(background.prefix(start))
            let foreground = selectedClaudeIndex.flatMap {
                discovered[$0].state == "disconnected" ? nil : [$0]
            } ?? []
            let claudeOrder = backgroundWasDeferred && !rotatingBackground.isEmpty
                ? Array(rotatingBackground.prefix(1)) + foreground + Array(rotatingBackground.dropFirst())
                : foreground + rotatingBackground
            let disconnected = discovered.indices.filter { discovered[$0].state == "disconnected" }
            let pollingOrder = (codexIndex.map { [$0] } ?? []) + claudeOrder + disconnected
            var backgroundAttempts = 0
            var codexReadStarted: UInt64?
            for index in pollingOrder {
                let session = discovered[index]
                if session.state == "disconnected" {
                    projections[session.id] = try unavailable(session, preserveEvents: false)
                    scopeDiagnostics[session.id] = PetL10n.text("Disconnected. Start again from Claude.", korean: "연결이 끊겼어요. Claude에서 새로 시작해 주세요.")
                    continue
                }
                if session.context.provider == .claude {
                    guard monotonicNow() < collectionDeadline else {
                        projections[session.id] = try unavailable(session)
                        scopeDiagnostics[session.id] = PetL10n.text("Rechecking this Claude session's status.", korean: "이 Claude 세션의 상태를 다시 확인하고 있어요.")
                        continue
                    }
                    if session.id != selectedID {
                        backgroundAttempts += 1
                        nextBackgroundSessionID = session.id
                    }
                } else { codexReadStarted = monotonicNow() }
                do {
                    let result = try await providerRequest("snapshot", context: session.context, payload: [:], access: owned)
                    try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                    if session.context.provider == .codex {
                        let value = try projection(result, schema: "blabee.pet.codex.v1")
                        projections[session.id] = try PetSnapshot.parse(StrictJSONTransport.data(forJSONObject: value))
                    } else {
                        let value = try projection(result, schema: "blabee.pet.claude.v1")
                        projections[session.id] = try ClaudePetSnapshotProjector(scopeID: session.context.scopeID,
                            projectID: session.projectID, sessionID: session.sessionID, cwd: session.cwd, product: true).project(value)
                        discovered[index] = PetProviderSession(id: session.id, context: session.context,
                            projectID: session.projectID, sessionID: session.sessionID, cwd: session.cwd,
                            state: try text(value, "readiness_status"), title: session.title,
                            nativeSessionID: session.nativeSessionID)
                        if (value["native_observation"] as? [String: Any])?["status"] as? String == "new_prompt_required" {
                            scopeDiagnostics[session.id] = PetL10n.text("Send a new input to Claude. The previous selection is no longer available.", korean: "Claude에 새 입력을 보내 주세요. 이전 선택은 사용할 수 없어요.")
                        }
                    }
                } catch {
                    try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                    if session.context.provider == .claude {
                        projections[session.id] = try unavailable(session)
                        scopeDiagnostics[session.id] = PetL10n.text("Unable to verify this Claude session's status.", korean: "이 Claude 세션의 상태를 확인하지 못했어요.")
                    } else {
                        scopeDiagnostics[session.id] = PetL10n.text("Unable to verify the Claude connection feature. The Codex connection is preserved.", korean: "Claude 연결 기능을 확인하지 못했어요. Codex 연결은 유지됩니다.")
                    }
                }
            }
            deferBackground = !background.isEmpty && backgroundAttempts == 0
            // The consumer lease is only three seconds. A bounded slow Claude
            // sweep must not postpone Codex's next heartbeat until another UI
            // poll. This is one read, never a selection or delivery retry.
            if let codexIndex, let started = codexReadStarted,
               monotonicNow() >= started,
               monotonicNow() - started >= Self.collectionBudgetNanoseconds {
                let session = discovered[codexIndex]
                do {
                    let result = try await providerRequest("snapshot", context: session.context, payload: [:], access: owned)
                    try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                    let value = try projection(result, schema: "blabee.pet.codex.v1")
                    projections[session.id] = try PetSnapshot.parse(StrictJSONTransport.data(forJSONObject: value))
                    scopeDiagnostics.removeValue(forKey: session.id)
                } catch {
                    try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                }
            }
        }
        try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
        let selected = discovered.first(where: { $0.id == selectedID })
        let displayedContext: PetProviderContext?
        let useLegacyFallback: Bool
        var displayed: PetSnapshot
        if selectedID == "codex-primary" {
            if let selected, let value = projections[selected.id] {
                displayed = value
                displayedContext = selected.context
                useLegacyFallback = false
            } else {
                displayedContext = nil
                useLegacyFallback = true
                diagnostic = diagnostic ?? scopeDiagnostics[selectedID]
                let data = try await codex.request(type: "get_state", payload: payload)
                displayed = try await codex.decodeSnapshot(data)
            }
        } else if let selected {
            displayedContext = selected.context
            useLegacyFallback = false
            displayed = try projections[selected.id] ?? unavailable(selected)
            diagnostic = diagnostic ?? scopeDiagnostics[selected.id]
                ?? (projections[selected.id] == nil ? PetL10n.text("Disconnected. Start again from Claude.", korean: "연결이 끊겼어요. Claude에서 새로 시작해 주세요.") : nil)
        } else {
            // Never redirect a vanished Claude selection to the Codex pool.
            displayedContext = currentContext
            useLegacyFallback = false
            displayed = try emptySnapshot()
            if let former = currentContext {
                displayed.providerStatus = PetProviderStatus(provider: .claude, scopeID: former.scopeID,
                    sessionID: "", cwd: "", bridgeConnected: false, ready: false, selectionEnabled: false, latestOutcome: nil)
            }
            diagnostic = PetL10n.text("Disconnected. Start again from Claude.", korean: "연결이 끊겼어요. Claude에서 새로 시작해 주세요.")
        }

        var inbox: PetProviderInbox?
        var updatedArrivalSequences = knownArrivalSequences
        var updatedMetadataIndex = nextMetadataIndex
        if let owned, let directory = verifiedDirectory, !useLegacyFallback {
            let states = discovered.map { session in
                PetProviderInboxSession(session: session, status: projections[session.id]?.providerStatus,
                    diagnostic: scopeDiagnostics[session.id])
            }
            let values = discovered.flatMap { session in
                (projections[session.id]?.queuedEvents ?? []).map { (session, $0) }
            }
            let identities = try values.map { try PetProviderInboxIdentity(context: $0.0.context, event: $0.1) }
            var sequences = identities.map { updatedArrivalSequences[$0] }
            // At most one small order read per refresh. Larger inboxes rotate
            // their metadata queries while retaining confirmed immutable order.
            if !values.isEmpty {
                let start = updatedMetadataIndex % values.count
                let indices = (0..<min(values.count, PetProviderInboxCodec.maximumRows)).map {
                    (start + $0) % values.count
                }
                updatedMetadataIndex = (start + indices.count) % values.count
                let queries = indices.map {
                    PetProviderInboxCodec.Query(context: values[$0].0.context, reference: values[$0].1.reference)
                }
                do {
                    let request = try PetProviderInboxCodec.request(queries: queries, service: directory.serviceIncarnation)
                    let data = try await rpc("pet_inbox_v1", request, access: owned)
                    let received = try PetProviderInboxCodec.decode(data, matching: request)
                    for (index, sequence) in zip(indices, received) {
                        if let sequence {
                            sequences[index] = sequence
                            updatedArrivalSequences[identities[index]] = sequence
                        }
                    }
                } catch {
                    try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
                }
                try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
            }
            let entries = try zip(values, sequences).map { value, sequence in
                try PetProviderInboxEntry(session: value.0, event: value.1, arrivalSequence: sequence ?? UInt64.max)
            }
            guard Set(entries.map(\.id)).count == entries.count else { throw failure("inbox_duplicate") }
            let codexSettings = discovered.first { $0.context.provider == .codex }
                .flatMap { projections[$0.id] }.map(PetCodexSettingsEvidence.init(snapshot:))
            inbox = PetProviderInbox(entries: entries, sessions: states,
                arrivalOrderComplete: sequences.allSatisfy { $0 != nil }, codexSettings: codexSettings)
            let retained = Set(identities)
            updatedArrivalSequences = updatedArrivalSequences.filter { retained.contains($0.key) }
        }
        let finalAccess = await access()
        try requireSnapshot(requestedSnapshot, selection: requestedGeneration)
        guard finalAccess == owned else { throw failure("stale_context") }
        sessions = discovered
        currentContext = displayedContext
        legacyCodexFallback = useLegacyFallback
        lastBackgroundSessionID = nextBackgroundSessionID
        backgroundWasDeferred = deferBackground
        knownArrivalSequences = updatedArrivalSequences
        nextMetadataIndex = updatedMetadataIndex
        displayed.providerSessions = discovered; displayed.providerContext = displayedContext
        displayed.providerDiagnostic = diagnostic
        displayed.providerDirectory = verifiedDirectory
        displayed.providerInbox = inbox
        currentSnapshot = displayed
        for session in discovered where session.context.provider == .claude {
            if let value = projections[session.id] { knownClaudePresentations[session.id] = value }
        }
        knownClaudePresentations = knownClaudePresentations.filter { id, _ in discovered.contains { $0.id == id } }
        attempted = attempted.filter { scope, _ in discovered.contains(where: { $0.context.scopeID == scope }) }
        let id = UUID().uuidString.lowercased()
        receipts.append((id, displayed)); if receipts.count > 8 { receipts.removeFirst() }
        return try StrictJSONTransport.data(forJSONObject: ["provider_snapshot_receipt": id])
    }

    private func requireSnapshot(_ generation: UInt64, selection: UInt64) throws {
        guard selection == selectionGeneration, generation == snapshotGeneration else { throw failure("stale_context") }
    }

    private func directory(access owned: PetProviderServiceAccess, deadline: UInt64) async throws -> [PetProviderSession] {
        var result: [PetProviderSession] = [], cursor: String?, service: String?
        var seen = Set<String>()
        // Registry supports at most32 active and32 recently disconnected scopes.
        // A defensive page budget also bounds a malformed service response.
        for _ in 0..<4 {
            if cursor != nil, monotonicNow() >= deadline { throw failure("snapshot_budget") }
            let request = try PetProviderDirectoryCodec.request(operation: "list",
                payload: ["after_scope_id": cursor as Any? ?? NSNull()])
            let page = try PetProviderDirectoryCodec.decode(await rpc("pet_directory_v1", request, access: owned), matching: request)
            guard service == nil || service == page.service,
                  Set(page.result.keys) == ["codex_target", "claude_available", "sessions", "next_cursor"],
                  petStrictBooleanValue(page.result["claude_available"]) != nil,
                  let rawCodex = page.result["codex_target"] as? [String: Any],
                  let rows = page.result["sessions"] as? [[String: Any]], rows.count <= PetProviderDirectoryCodec.maximumRows else {
                throw failure("directory_invalid")
            }
            let codexContext = try PetProviderContext(provider: .codex, target: rawCodex)
            guard codexContext.serviceIncarnation == page.service else { throw failure("directory_invalid") }
            if service == nil {
                result.append(PetProviderSession(id: "codex-primary", context: codexContext, projectID: "",
                    sessionID: "", cwd: "", state: "connected", title: PetL10n.text("Codex · Connected tasks", korean: "Codex · 연결된 작업")))
            }
            service = page.service
            for row in rows {
                guard Set(row.keys) == ["provider", "target", "project_id", "session_id", "native_session_id", "cwd", "state"],
                      row["provider"] as? String == "claude", let rawTarget = row["target"] as? [String: Any] else {
                    throw failure("directory_invalid")
                }
                let context = try PetProviderContext(provider: .claude, target: rawTarget)
                let project = try text(row, "project_id"), session = try text(row, "session_id")
                let native = try text(row, "native_session_id"), cwd = try text(row, "cwd"), state = try text(row, "state")
                guard context.serviceIncarnation == service, seen.insert(context.scopeID).inserted,
                      cursor == nil || context.scopeID > cursor!, PetProviderContext.isUUID(native),
                      project.hasPrefix("claude_project_"), session.hasPrefix("claude_session_"),
                      ClaudeCanonicalDirectory.isNormalizedAbsolute(cwd),
                      ["starting", "connected", "disconnected"].contains(state) else { throw failure("directory_invalid") }
                result.append(PetProviderSession(id: "claude:" + context.serviceIncarnation + ":" + context.scopeID,
                    context: context, projectID: project, sessionID: session, cwd: cwd, state: state,
                    title: "Claude · " + URL(fileURLWithPath: cwd).lastPathComponent + " · " + native.prefix(8),
                    nativeSessionID: native))
            }
            if page.result["next_cursor"] is NSNull { return result }
            guard let next = page.result["next_cursor"] as? String, PetProviderContext.isUUID(next),
                  cursor == nil || next > cursor!, rows.last?["target"].flatMap({ $0 as? [String: Any] })?["scope_id"] as? String == next else {
                throw failure("directory_invalid")
            }
            cursor = next
        }
        throw failure("directory_capacity")
    }

    private func providerRequest(_ operation: String, context: PetProviderContext,
                                 payload: [String: Any], access owned: PetProviderServiceAccess) async throws -> [String: Any] {
        let corpus = RuntimeSecretCorpus(); corpus.register(owned.credential)
        let codec = ClaudeProductWireCodec(credentialCorpus: corpus)
        let object: [String: Any] = ["schema_version": "blabee.pet-provider.v1", "kind": "request",
            "request_id": UUID().uuidString.lowercased(), "provider": context.provider == .claude ? "claude" : "codex",
            "role": "selector", "operation": operation, "target": context.target, "payload": payload]
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: object))
        let reply = try await rpc("pet_provider_v1", object, access: owned)
        let decoded = try codec.decodeResponse(reply, matching: request,
            connection: .init(serviceIncarnation: UUID(uuidString: context.serviceIncarnation)!))
        let response = try StrictJSONTransport.object(from: decoded.canonicalJSON)
        guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
            throw failure("request_rejected")
        }
        return result
    }

    private func rpc(_ type: String, _ envelope: [String: Any], access owned: PetProviderServiceAccess) async throws -> Data {
        let data = try StrictJSONTransport.data(forJSONObject: ["auth_token": owned.credential, "envelope": envelope])
        let result = try await codex.request(type: type, payload: data)
        guard await access() == owned else { throw failure("service_replaced") }
        let corpus = RuntimeSecretCorpus(); corpus.register(owned.credential)
        try corpus.assertNoKnownSecret(in: result)
        return result
    }

    private func selectionPayload(_ value: PetSelectionRequest) -> [String: Any] {
        ["packet_id": value.identity.packetID, "revision": value.identity.revision, "option_id": value.optionID,
         "selection_id": value.selectionID, "binding": value.identity.binding.jsonObject]
    }

    private func projection(_ result: [String: Any], schema: String) throws -> [String: Any] {
        guard Set(result.keys) == ["projection"], let projection = result["projection"] as? [String: Any],
              Set(projection.keys) == ["schema_version", "value"], projection["schema_version"] as? String == schema,
              let value = projection["value"] as? [String: Any] else { throw failure("projection_invalid") }
        return value
    }

    private func unavailable(_ session: PetProviderSession, preserveEvents: Bool = true) throws -> PetSnapshot {
        let previous = knownClaudePresentations[session.id]
        // A transient read failure is not evidence that the card was removed.
        // Keep its visual identity disabled until a fresh success or explicit
        // disconnect establishes the provider's current state.
        var value: PetSnapshot
        if preserveEvents, let previous { value = previous }
        else { value = try emptySnapshot(inFlightCount: previous?.routing.inFlightCount ?? 0) }
        value.providerStatus = PetProviderStatus(provider: .claude, scopeID: session.context.scopeID,
            sessionID: session.sessionID, cwd: session.cwd, bridgeConnected: false, ready: false,
            selectionEnabled: false, latestOutcome: previous?.providerStatus?.latestOutcome,
            pendingReportCount: previous?.providerStatus?.pendingReportCount ?? 0)
        return value
    }

    private func emptySnapshot(inFlightCount: Int64 = 0) throws -> PetSnapshot {
        let routing = try PetRoutingSnapshot(jsonObject: ["schema_version": "1.0",
            "kind": "blabee_routing_snapshot", "selection_enabled": false,
            "foreground": NSNull(), "pending": [], "in_flight_count": inFlightCount])
        return PetSnapshot(projects: [], sessions: [], routing: routing, interactions: [],
            permissionRequests: [], permissionNoticeCount: 0,
            managedCommandApprovals: [], managedCommandApprovalNoticeCount: 0)
    }

    private func requireCurrent(_ context: PetProviderContext?, generation: UInt64? = nil) throws {
        guard context == currentContext, generation == nil || generation == selectionGeneration,
              context != nil || (selectedID == "codex-primary" && (currentAccess == nil || legacyCodexFallback)) else {
            throw failure("stale_context")
        }
    }
    private func requireAccess(_ value: PetProviderServiceAccess) throws {
        guard value == currentAccess else { throw failure("service_replaced") }
    }
    private func text(_ value: [String: Any], _ key: String) throws -> String {
        guard let result = value[key] as? String, !result.isEmpty, result.utf8.count <= 4096,
              !result.contains("\0") else { throw failure("value_invalid") }
        return result
    }
    private func failure(_ suffix: String) -> CoordinatorError { CoordinatorError("pet_provider_" + suffix) }
}

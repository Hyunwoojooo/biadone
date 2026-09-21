import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Usage records follow accepted user actions")
@MainActor
struct PetUsageIntegrationTests {
    @Test("Every action counts once after its acknowledgement, including panel and hotkey paths",
          arguments: UsageIntegrationAction.allCases)
    func acceptedActionCountsOnce(_ action: UsageIntegrationAction) async throws {
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()

        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()
        if started {
            #expect(recorded.isEmpty)
            await fixture.perform()
            #expect(await fixture.transport.requestCount(type: action.requestType) == 1)
        }
        await fixture.transport.release()
        await pending.value

        #expect(started)
        #expect(recorded == [action.eventKind])
        #expect(await fixture.backend.requestCount(type: action.requestType) == 1)
        await fixture.perform()
        #expect(recorded == [action.eventKind])
        #expect(await fixture.backend.requestCount(type: action.requestType) == 1)
    }

    @Test("Rejected or mismatched acknowledgements and transport failures never count",
          arguments: UsageIntegrationAction.allCases, [false, true])
    func rejectedActionDoesNotCount(_ action: UsageIntegrationAction, transportFailure: Bool) async throws {
        let fixture = UsageIntegrationFixture(action: action)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        try await fixture.prepare()
        if transportFailure {
            await fixture.backend.enqueueFailure(type: action.requestType, code: "stale_request")
        } else {
            await fixture.backend.enqueue(type: action.requestType, response: try fixture.acknowledgement(matches: false))
        }
        await fixture.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))

        await fixture.perform()

        #expect(recorded.isEmpty)
        #expect(await fixture.backend.requestCount(type: action.requestType) == 1)
    }

    @Test("Snapshot delivery, automatic focus, and repeated refresh are not usage")
    func backgroundRefreshDoesNotCount() async throws {
        let fixture = UsageIntegrationFixture(action: .globalChoice)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        let card = fixture.card
        let unfocused = try petTestSnapshotData(cards: [card])
        let focused = try petTestSnapshotData(cards: [card], foregroundSuffix: card.suffix)
        try fixture.vm.receiveSnapshotDataForTesting(unfocused)
        await fixture.backend.enqueue(type: "get_state", response: unfocused)
        await fixture.backend.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
        await fixture.backend.enqueue(type: "get_state", response: focused)

        await fixture.vm.refresh()
        #expect(await fixture.backend.requestCount(type: "focus_interaction") == 1)
        for _ in 0..<3 {
            try fixture.vm.receiveSnapshotDataForTesting(focused)
            await fixture.backend.enqueue(type: "get_state", response: focused)
            await fixture.vm.refresh()
        }

        #expect(recorded.isEmpty)
        #expect(await fixture.backend.requestCount(type: "select") == 0)
    }

    @Test("A stale panel click cannot count a revised choice")
    func stalePanelChoiceDoesNotCount() async throws {
        let fixture = UsageIntegrationFixture(action: .panelChoice)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        try await fixture.prepare()
        var revised = fixture.card
        revised.revision += 1
        revised.packetID = "packet_usage_revised"
        try fixture.vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [revised]))

        await fixture.perform()

        #expect(recorded.isEmpty)
        #expect(await fixture.backend.requestCount(type: "select") == 0)
    }

    @Test("All native approval decisions use only the fixed approval category",
          arguments: PetPermissionDecision.allCases)
    func nativeApprovalCategory(_ decision: PetPermissionDecision) async throws {
        let fixture = UsageIntegrationFixture(action: .nativeApproval)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        try await fixture.prepare()
        let request = try #require(fixture.vm.pendingPermissionRequest)
        await fixture.backend.enqueue(type: "resolve_permission_request", response:
            try petTestPermissionResolutionResponse(decision, requestID: request.requestID))
        await fixture.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))

        await fixture.vm.resolvePermissionRequest(decision, for: request)

        #expect(recorded == [.approvalResolved])
    }

    @Test("All managed approval decisions use only the fixed approval category",
          arguments: PetManagedCommandApprovalDecision.allCases)
    func managedApprovalCategory(_ decision: PetManagedCommandApprovalDecision) async throws {
        let fixture = UsageIntegrationFixture(action: .managedApproval)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        try await fixture.prepare()
        let request = try #require(fixture.vm.pendingManagedCommandApproval)
        await fixture.backend.enqueue(type: "resolve_managed_command_approval", response:
            try petTestManagedCommandApprovalResolutionResponse(decision, managedRequestID: request.managedRequestID))
        await fixture.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))

        await fixture.vm.resolveManagedCommandApproval(decision, for: request)

        #expect(recorded == [.approvalResolved])
    }

    @Test("An account switch while an action waits never attributes it to the new user",
          arguments: UsageIntegrationAction.allCases)
    func accountSwitchFencesAcceptedAction(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        #expect(account.controller.usageAuthorization()?.userID == UsageIntegrationAccountFixture.firstUser.id)
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true, account: account.controller)
        defer { fixture.vm.stopPolling() }
        var recorded: [PetUsageEventKind] = []
        fixture.vm.onUsageAccepted = { recorded.append($0) }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()

        if started {
            await account.controller.signOut()
            account.service.candidate = account.session(user: UsageIntegrationAccountFixture.secondUser)
            await account.controller.signIn(.github)
            #expect(account.controller.usageAuthorization()?.userID == UsageIntegrationAccountFixture.secondUser.id)
        }
        await fixture.transport.release()
        await pending.value

        #expect(started)
        #expect(recorded.isEmpty)
        #expect(await fixture.backend.requestCount(type: action.requestType) == 1)
        #expect(fixture.vm.lastError == nil)
    }

    @Test("Upload consent and account identity belong to the action's original context",
          arguments: UsageIntegrationAction.allCases, UsageIntegrationContextChange.allCases)
    func recorderFencesChangedContext(_ action: UsageIntegrationAction, change: UsageIntegrationContextChange) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account, enabled: change != .enableAfterAction)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true,
            account: account.controller, usageAnalytics: collection.recorder)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()

        if started {
            #expect(collection.store.usageEvents.isEmpty)
            #expect(collection.service.usageEvents.isEmpty)
            switch change {
            case .unchanged: break
            case .enableAfterAction: collection.recorder.setEnabled(true)
            case .disableAndEnable:
                collection.recorder.setEnabled(false)
                collection.recorder.setEnabled(true)
            case .signOutAndSameAccount:
                await account.controller.signOut()
                await account.controller.signIn(.google)
            case .signOutAndOtherAccount:
                await account.controller.signOut()
                account.service.candidate = account.session(user: UsageIntegrationAccountFixture.secondUser)
                await account.controller.signIn(.github)
            case .refreshSameAccount: await account.controller.refresh()
            }
        }
        await fixture.transport.release()
        await pending.value
        #expect(started)
        #expect(fixture.vm.lastError == nil)
        #expect(await fixture.backend.requestCount(type: action.requestType) == 1)

        if change.permitsOriginalAction {
            #expect(await collection.waitUntilDelivered())
            #expect(collection.service.usageEvents.map(\.kind) == [action.eventKind])
            #expect(collection.service.usageEvents.map(\.userID) == [UsageIntegrationAccountFixture.firstUser.id])
        } else {
            for _ in 0..<20 { await Task.yield() }
            #expect(collection.service.usageEvents.isEmpty)
            #expect(collection.store.usageEvents.isEmpty)
            #expect(collection.store.saved.flatMap { $0 }.filter { $0.kind != .productMetric && $0.kind != .insightMetric }.isEmpty)
        }
        let results = collection.service.events.compactMap(\.product).filter {
            [.featureSucceeded, .featureFailed, .featureCancelled].contains($0.kind)
        }
        #expect(results.count == (change.permitsOriginalAction ? 1 : 0))
    }

    @Test("A stale acknowledgement cannot enter the upload queue",
          arguments: UsageIntegrationAction.allCases)
    func recorderRejectsStaleAcknowledgement(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: action, account: account.controller,
            usageAnalytics: collection.recorder)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        await fixture.backend.enqueue(type: action.requestType, response: try fixture.acknowledgement(matches: false))
        await fixture.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))

        await fixture.perform()
        for _ in 0..<20 { await Task.yield() }

        #expect(collection.service.usageEvents.isEmpty)
        #expect(collection.store.usageEvents.isEmpty)
        #expect(collection.store.saved.flatMap { $0 }.filter { $0.kind != .productMetric && $0.kind != .insightMetric }.isEmpty)
        #expect(await fixture.backend.requestCount(type: action.requestType) == 1)
    }

    @Test("Stored and exchanged sessions authorize usage only after user verification",
          arguments: [false, true])
    func authorizationRequiresVerification(stored: Bool) async throws {
        let fixture = UsageIntegrationAccountFixture(stored: stored)
        defer { fixture.controller.stop() }
        let gate = UsageIntegrationAccountGate()
        fixture.service.userGate = gate
        #expect(fixture.controller.usageAuthorization() == nil)
        let pending = Task {
            if stored { await fixture.controller.restoreIfNeeded() }
            else { await fixture.controller.signIn(.google) }
        }
        await gate.waitUntilEntered()
        #expect(fixture.controller.usageAuthorization() == nil)
        #expect(fixture.store.value != nil)
        gate.release()
        await pending.value

        let authorization = try #require(fixture.controller.usageAuthorization())
        #expect(authorization.userID == fixture.service.candidate.user.id)
        #expect(authorization.accessToken == fixture.service.candidate.accessToken)
        #expect(authorization.expiresAt == fixture.service.candidate.expiresAt)
        fixture.clock.date = authorization.expiresAt
        #expect(fixture.controller.usageAuthorization() == nil)
    }

    @Test("Phase observers see committed state and logout or stop immediately removes authorization")
    func phaseObserverUsesUpdatedState() async throws {
        let fixture = UsageIntegrationAccountFixture(stored: true)
        defer { fixture.controller.stop() }
        var phases: [PetAccountPhase] = []
        var owners: [String?] = []
        fixture.controller.onPhaseChanged = { [weak controller = fixture.controller] phase in
            #expect(controller?.phase == phase)
            phases.append(phase)
            owners.append(controller?.usageAuthorization()?.userID)
        }

        await fixture.controller.restoreIfNeeded()
        await fixture.controller.signOut()
        #expect(fixture.controller.usageAuthorization() == nil)
        fixture.service.candidate = fixture.session(user: UsageIntegrationAccountFixture.secondUser)
        await fixture.controller.signIn(.github)
        #expect(fixture.controller.usageAuthorization() != nil)
        fixture.controller.stop()
        #expect(fixture.controller.usageAuthorization() == nil)

        #expect(phases == [.checking, .signedIn(UsageIntegrationAccountFixture.firstUser),
                           .signingOut, .signedOut, .authorizing(.github),
                           .signedIn(UsageIntegrationAccountFixture.secondUser)])
        #expect(owners == [nil, UsageIntegrationAccountFixture.firstUser.id, nil, nil, nil,
                           UsageIntegrationAccountFixture.secondUser.id])
    }

    @Test("Product attempts and validated results preserve operation, source, and original date",
          arguments: UsageIntegrationAction.allCases)
    func productSuccessPairsAttempt(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true,
            account: account.controller, usageAnalytics: collection.recorder)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()
        #expect(started)
        let queued = collection.store.saved.flatMap { $0 }.compactMap(\.product)
        #expect(queued.contains { $0.kind == .featureStarted })
        #expect(!queued.contains { $0.kind == .featureSucceeded })
        await fixture.perform()
        await fixture.transport.release()
        await pending.value
        #expect(await collection.waitUntilDelivered())

        let records = collection.service.events.compactMap(\.product)
        let attempts = records.filter { $0.kind == .featureStarted }
        let results = records.filter { $0.kind == .featureSucceeded }
        let first = try #require(attempts.first)
        let last = try #require(results.first)
        #expect(attempts.count == 1 && results.count == 1)
        #expect(first.operationID == last.operationID)
        #expect(first.occurredAt == last.occurredAt)
        #expect(first.environment == last.environment)
        #expect(first.inputMethod == (action == .globalChoice ? .keyboard : .button))
        #expect(last.inputMethod == first.inputMethod)
        #expect(first.latencyBucket == .none && last.latencyBucket != .none)
        #expect(records.filter { $0.kind == .firstAction }.count == 1)
        #expect(collection.service.usageEvents.map(\.kind) == [action.eventKind])
    }

    @Test("Failed and malformed responses retain the attempt and record failure without accepted usage",
          arguments: UsageIntegrationAction.allCases, [false, true])
    func productFailurePairsAttempt(_ action: UsageIntegrationAction, transportFailure: Bool) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: action, account: account.controller,
            usageAnalytics: collection.recorder)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        if transportFailure { await fixture.backend.enqueueFailure(type: action.requestType, code: "private-path-must-not-be-sent") }
        else { await fixture.backend.enqueue(type: action.requestType, response: try fixture.acknowledgement(matches: false)) }
        await fixture.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await fixture.perform()
        #expect(await collection.waitUntilDelivered())
        let records = collection.service.events.compactMap(\.product)
        let first = try #require(records.first { $0.kind == .featureStarted })
        let failed = try #require(records.first { $0.kind == .featureFailed })
        #expect(records.filter { $0.kind == .featureFailed }.count == 1)
        #expect(first.operationID == failed.operationID)
        #expect(!records.contains { $0.kind == .featureSucceeded || $0.kind == .firstAction })
        #expect(collection.service.usageEvents.isEmpty)
        let serialized = String(decoding: try JSONEncoder().encode(collection.service.events), as: UTF8.self)
        #expect(!serialized.contains("private-path-must-not-be-sent"))
    }

    @Test("Opt-out while awaiting a result prevents terminal telemetry under the next consent",
          arguments: UsageIntegrationAction.allCases)
    func productResultDoesNotCrossConsent(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true,
            account: account.controller, usageAnalytics: collection.recorder)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()
        collection.recorder.setEnabled(false)
        collection.recorder.setEnabled(true)
        await fixture.transport.release()
        await pending.value
        for _ in 0..<20 { await Task.yield() }
        #expect(started)
        let records = collection.service.events.compactMap(\.product)
        #expect(!records.contains { [.featureSucceeded, .featureFailed, .featureCancelled, .firstAction].contains($0.kind) })
        #expect(collection.service.usageEvents.isEmpty)
    }

    @Test("Account observations do not pretend a cached card is newly received or count as usage")
    func productOnboardingRequiresFreshObservation() async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account, enabled: false)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: .dismissal, account: account.controller,
            usageAnalytics: collection.recorder)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        fixture.vm.observeProductAccountState()
        #expect(collection.service.events.isEmpty)
        collection.recorder.setEnabled(true)
        fixture.vm.observeProductAccountState()
        fixture.vm.observeProductAccountState()
        #expect(await collection.waitUntilDelivered())
        var records = collection.service.events.compactMap(\.product)
        #expect(records.map(\.kind) == [.environmentObserved, .accountReady])
        #expect(records.allSatisfy { $0.environment.uiLanguage == .ko })
        await fixture.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await fixture.vm.refresh()
        #expect(await collection.waitUntilDelivered())
        records = collection.service.events.compactMap(\.product)
        #expect(records.contains { $0.kind == .serviceConnected })
        #expect(!records.contains { $0.kind == .cardReceived || $0.kind == .firstAction })
        #expect(collection.service.usageEvents.isEmpty)
    }

    @Test("A keyboard action preserves its source through risk confirmation")
    func productRiskConfirmationKeepsSource() async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: .globalChoice, account: account.controller,
            usageAnalytics: collection.recorder)
        fixture.card.risk = "high"
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        await fixture.perform()
        #expect(fixture.vm.riskConfirmation != nil)
        #expect(!collection.store.saved.flatMap { $0 }.compactMap(\.product)
            .contains { $0.kind == .featureStarted })
        await fixture.vm.confirmRiskSelection()
        #expect(await collection.waitUntilDelivered())
        let records = collection.service.events.compactMap(\.product)
            .filter { $0.kind == .featureStarted || $0.kind == .featureSucceeded }
        #expect(records.count == 2)
        #expect(records.allSatisfy { $0.inputMethod == .keyboard })
    }

    @Test("A response made obsolete by shutdown is recorded as cancelled, never succeeded",
          arguments: UsageIntegrationAction.allCases)
    func productShutdownEndsAttempt(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true,
            account: account.controller, usageAnalytics: collection.recorder)
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()
        await fixture.vm.shutdownAppOwnedService()
        await fixture.transport.release()
        await pending.value
        #expect(started)
        #expect(await collection.waitUntilDelivered())
        let records = collection.service.events.compactMap(\.product)
        let attempt = try #require(records.first { $0.kind == .featureStarted })
        let cancelled = try #require(records.first { $0.kind == .featureCancelled })
        #expect(attempt.operationID == cancelled.operationID)
        #expect(!records.contains { $0.kind == .featureSucceeded || $0.kind == .featureFailed })
        #expect(collection.service.usageEvents.isEmpty)
    }

    @Test("Only visible cards create one impression and accepted actions create one matching response",
          arguments: UsageIntegrationAction.allCases)
    func visibleCardInsights(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let tracker = PetInsightCardTracker(analytics: collection.recorder, now: { account.clock.date })
        let fixture = UsageIntegrationFixture(action: action, account: account.controller,
            usageAnalytics: collection.recorder, insightCards: tracker)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        #expect(collection.store.events.compactMap(\.insight).isEmpty)
        #expect(collection.service.events.compactMap(\.insight).isEmpty)

        fixture.vm.setPanelVisible(true)
        #expect(await collection.waitUntilDelivered())
        if let snapshot = fixture.vm.snapshot { fixture.vm.applySnapshotForTesting(snapshot) }
        fixture.vm.setPanelVisible(false)
        fixture.vm.setPanelVisible(true)
        #expect(await collection.waitUntilDelivered())
        #expect(collection.service.events.compactMap(\.insight).filter { $0.kind == .cardPresented }.count == 1)

        try await fixture.enqueueAcknowledgement()
        await fixture.perform()
        #expect(await collection.waitUntilDelivered())
        let insights = collection.service.events.compactMap(\.insight)
        let shown = try #require(insights.first { $0.kind == .cardPresented })
        let responded = try #require(insights.first { $0.kind == .cardResponded })
        #expect(insights.filter { $0.kind == .cardResponded }.count == 1)
        #expect(shown.cardID == responded.cardID)
        #expect(shown.occurredAt == responded.occurredAt)
        let expected: PetInsightResponse = switch action {
        case .panelChoice, .globalChoice: .selected
        case .nativeApproval, .managedApproval: .approved
        case .dismissal: .dismissed
        }
        #expect(responded.response == expected)
        let encoded = String(decoding: try JSONEncoder().encode(insights), as: UTF8.self)
        #expect(!encoded.contains(fixture.card.packetID ?? "packet_usage"))
        #expect(!encoded.contains("session_usage"))
    }

    @Test("Settings obscure suggestions while higher priority approvals still count",
          arguments: [UsageIntegrationAction.panelChoice, .nativeApproval, .managedApproval])
    func settingsAndApprovalExposure(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let tracker = PetInsightCardTracker(analytics: collection.recorder, now: { account.clock.date })
        let fixture = UsageIntegrationFixture(action: action, account: account.controller,
            usageAnalytics: collection.recorder, insightCards: tracker)
        defer { fixture.vm.stopPolling() }
        fixture.vm.beginShortcutSettings()
        fixture.vm.setPanelVisible(true)
        try await fixture.prepare()
        for _ in 0..<20 { await Task.yield() }
        let impressions = collection.service.events.compactMap(\.insight).filter { $0.kind == .cardPresented }
        #expect(impressions.count == (action == .panelChoice ? 0 : 1))
        fixture.vm.cancelShortcutSettings()
        #expect(await collection.waitUntilDelivered())
        #expect(collection.service.events.compactMap(\.insight).filter { $0.kind == .cardPresented }.count == 1)
    }

    @Test("A global action on a never-shown card does not fabricate impression or response")
    func unseenGlobalActionHasNoInsight() async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let tracker = PetInsightCardTracker(analytics: collection.recorder, now: { account.clock.date })
        let fixture = UsageIntegrationFixture(action: .globalChoice, account: account.controller,
            usageAnalytics: collection.recorder, insightCards: tracker)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        try await fixture.enqueueAcknowledgement()
        await fixture.perform()
        #expect(await collection.waitUntilDelivered())
        #expect(collection.service.events.compactMap(\.insight).isEmpty)
        #expect(collection.service.usageEvents.count == 1)
    }

    @Test("An accepted old action cannot respond to a new consent's impression",
          arguments: UsageIntegrationAction.allCases)
    func insightConsentFence(_ action: UsageIntegrationAction) async throws {
        let account = UsageIntegrationAccountFixture(stored: true)
        defer { account.controller.stop() }
        await account.controller.restoreIfNeeded()
        let collection = UsageIntegrationRecorder(account: account)
        defer { collection.recorder.stop() }
        let tracker = PetInsightCardTracker(analytics: collection.recorder, now: { account.clock.date })
        let fixture = UsageIntegrationFixture(action: action, blockResponse: true, account: account.controller,
            usageAnalytics: collection.recorder, insightCards: tracker)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        fixture.vm.setPanelVisible(true)
        #expect(await collection.waitUntilDelivered())
        try await fixture.enqueueAcknowledgement()
        let pending = Task { await fixture.perform() }
        let started = await fixture.waitUntilActionStarted()
        collection.recorder.setEnabled(false)
        collection.recorder.setEnabled(true)
        fixture.vm.observeProductAccountState()
        await fixture.transport.release()
        await pending.value
        #expect(started)
        #expect(await collection.waitUntilDelivered())
        #expect(!collection.service.events.compactMap(\.insight).contains { $0.kind == .cardResponded })
    }

    @Test("Feedback editing suppresses global selection and restores it on close")
    func feedbackEditingDoesNotRunChoices() async throws {
        let fixture = UsageIntegrationFixture(action: .globalChoice)
        defer { fixture.vm.stopPolling() }
        try await fixture.prepare()
        fixture.vm.setFeedbackWindowVisible(true)
        await fixture.vm.handleGlobalSlot(1)
        #expect(await fixture.backend.requestCount(type: "select") == 0)
        #expect(fixture.vm.riskConfirmation == nil)
        fixture.vm.setFeedbackWindowVisible(false)
        try await fixture.enqueueAcknowledgement()
        await fixture.perform()
        #expect(await fixture.backend.requestCount(type: "select") == 1)
    }

    @Test("Sharing offers only displayed suggestion text after an explicit action")
    func explicitSuggestionSharing() async throws {
        let fixture = UsageIntegrationFixture(action: .panelChoice)
        defer { fixture.vm.stopPolling() }
        var offers: [String?] = []
        fixture.vm.onFeedbackRequested = { offers.append($0) }
        try await fixture.prepare()
        #expect(offers.isEmpty)
        let current = try #require(fixture.vm.displayInteraction)
        fixture.vm.requestFeedback()
        let text = try #require(offers.first ?? nil)
        #expect(text.contains(current.summary))
        #expect(!text.contains(current.identity.binding.sessionID))
        #expect(!text.contains(current.cwd))
        fixture.vm.beginShortcutSettings()
        fixture.vm.requestFeedback()
        #expect(offers.count == 2 && offers[1] == nil)
    }
}

enum UsageIntegrationAction: CaseIterable, Sendable {
    case panelChoice, globalChoice, nativeApproval, managedApproval, dismissal

    var requestType: String {
        switch self {
        case .panelChoice, .globalChoice: "select"
        case .nativeApproval: "resolve_permission_request"
        case .managedApproval: "resolve_managed_command_approval"
        case .dismissal: "dismiss_interaction"
        }
    }

    var eventKind: PetUsageEventKind {
        switch self {
        case .panelChoice, .globalChoice: .choiceAccepted
        case .nativeApproval, .managedApproval: .approvalResolved
        case .dismissal: .suggestionDismissed
        }
    }
}

enum UsageIntegrationContextChange: CaseIterable, Sendable {
    case unchanged, enableAfterAction, disableAndEnable, signOutAndSameAccount
    case signOutAndOtherAccount, refreshSameAccount

    var permitsOriginalAction: Bool { self == .unchanged || self == .refreshSameAccount }
}

@MainActor
private final class UsageIntegrationFixture {
    let action: UsageIntegrationAction
    var card = PetTestCard(suffix: "usage", rankedActionCount: 2)
    let backend = PetFakeTransport()
    let transport: UsageIntegrationTransport
    let vm: PetViewModel
    private var identity: PetInteractionIdentity?
    private var permission: PetPermissionRequest?
    private var managed: PetManagedCommandApproval?

    init(action: UsageIntegrationAction, blockResponse: Bool = false, account: PetAccountController? = nil,
         usageAnalytics: PetUsageAnalytics? = nil, insightCards: PetInsightCardTracker? = nil) {
        self.action = action
        transport = UsageIntegrationTransport(backend: backend, blockedType: blockResponse ? action.requestType : nil)
        vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                          account: account, usageAnalytics: usageAnalytics, insightCards: insightCards,
                          selectionIDGenerator: { "selection_usage" },
                          permissionResponseIDGenerator: { "permission_response_test" },
                          managedApprovalResponseIDGenerator: { "managed_approval_response_test" })
    }

    func prepare() async throws {
        switch action {
        case .panelChoice, .globalChoice, .dismissal:
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
            let displayed = try #require(vm.displayInteraction?.identity)
            identity = displayed
            if action != .dismissal {
                await backend.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
                await backend.enqueue(type: "get_state", response:
                    try petTestSnapshotData(cards: [card], foregroundSuffix: card.suffix))
                await vm.focus(displayed)
                #expect(vm.focusedInteraction?.identity == identity)
            }
        case .nativeApproval:
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [], permissionRequests: [
                PetTestPermissionRequest(suffix: card.suffix, allowOnceAvailable: true),
            ]))
            let request = try #require(vm.pendingPermissionRequest)
            permission = request
        case .managedApproval:
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [], managedCommandApprovals: [
                PetTestManagedCommandApproval(suffix: card.suffix),
            ]))
            let request = try #require(vm.pendingManagedCommandApproval)
            managed = request
        }
    }

    func perform() async {
        switch action {
        case .panelChoice:
            if let identity { await vm.focusAndRequestPanelSelection(1, interaction: identity) }
        case .globalChoice: await vm.handleGlobalSlot(1)
        case .nativeApproval:
            if let permission { await vm.resolvePermissionRequest(.allowOnce, for: permission) }
        case .managedApproval:
            if let managed { await vm.resolveManagedCommandApproval(.acceptOnce, for: managed) }
        case .dismissal:
            if let identity { await vm.skipDecision(for: identity) }
        }
    }

    func acknowledgement(matches: Bool = true) throws -> Data {
        switch action {
        case .panelChoice, .globalChoice:
            if matches { return try petTestSelectionResponse() }
            return try petTestData(["accepted": false, "outcome": ["kind": "pause"]])
        case .nativeApproval:
            return try petTestPermissionResolutionResponse(.allowOnce,
                requestID: matches ? "permission_usage" : "permission_stale")
        case .managedApproval:
            return try petTestManagedCommandApprovalResolutionResponse(.acceptOnce,
                managedRequestID: matches ? "managed_request_usage" : "managed_request_stale")
        case .dismissal:
            let identity = try #require(identity)
            return try petTestData(["dismissed": true, "interaction_id": identity.interactionID,
                                   "packet_id": identity.packetID, "revision": matches ? identity.revision : identity.revision + 1])
        }
    }

    func enqueueAcknowledgement() async throws {
        await backend.enqueue(type: action.requestType, response: try acknowledgement())
        await backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    }

    func waitUntilActionStarted() async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while ContinuousClock.now < deadline {
            if await transport.isSuspended { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return await transport.isSuspended
    }
}

private actor UsageIntegrationTransport: PetCoordinatorTransport {
    let backend: PetFakeTransport
    private var blockedType: String?
    private var continuation: CheckedContinuation<Void, Never>?
    private var counts: [String: Int] = [:]
    var isSuspended: Bool { continuation != nil }

    init(backend: PetFakeTransport, blockedType: String?) {
        self.backend = backend
        self.blockedType = blockedType
    }

    func request(type: String, payload: Data) async throws -> Data {
        counts[type, default: 0] += 1
        if type == blockedType {
            blockedType = nil
            await withCheckedContinuation { continuation = $0 }
        }
        return try await backend.request(type: type, payload: payload)
    }

    func requestCount(type: String) -> Int { counts[type, default: 0] }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class UsageIntegrationAccountFixture {
    static let firstUser = PetAccountUser(id: "11111111-1111-4111-8111-111111111111", email: "first@example.test")
    static let secondUser = PetAccountUser(id: "22222222-2222-4222-8222-222222222222", email: "second@example.test")
    let clock = UsageIntegrationClock()
    let service: UsageIntegrationAccountService
    let store: UsageIntegrationAccountStore
    let controller: PetAccountController

    init(stored: Bool) {
        let candidate = PetAccountSession(accessToken: "usage-test-access", refreshToken: "usage-test-refresh",
            expiresAt: clock.date.addingTimeInterval(3_600), user: Self.firstUser)
        service = UsageIntegrationAccountService(candidate: candidate)
        store = UsageIntegrationAccountStore(value: stored ? candidate : nil)
        controller = PetAccountController(service: service, store: store, browser: UsageIntegrationAccountBrowser(),
            configuration: PetAccountConfiguration(supabaseURL: URL(string: "https://example.supabase.co")!,
                publishableKey: "test-public-key"), now: { [clock] in clock.date }, automaticRefresh: false,
            makeVerifier: { String(repeating: "a", count: 64) })
    }

    func session(user: PetAccountUser) -> PetAccountSession {
        PetAccountSession(accessToken: "usage-test-other-access", refreshToken: "usage-test-other-refresh",
                          expiresAt: clock.date.addingTimeInterval(3_600), user: user)
    }
}

@MainActor
private final class UsageIntegrationClock {
    var date = Date(timeIntervalSince1970: 1_800_000_000)
}

@MainActor
private final class UsageIntegrationAccountService: PetAccountServicing {
    var candidate: PetAccountSession
    var userGate: UsageIntegrationAccountGate?
    init(candidate: PetAccountSession) { self.candidate = candidate }
    func exchange(code: String, verifier: String) async throws -> PetAccountSession { candidate }
    func refresh(_ session: PetAccountSession) async throws -> PetAccountSession { candidate }
    func user(accessToken: String) async throws -> PetAccountUser {
        let user = candidate.user
        if let userGate { await userGate.suspend() }
        return user
    }
    func signOut(accessToken: String) async throws {}
}

@MainActor
private final class UsageIntegrationAccountStore: PetAccountSessionStoring {
    var value: PetAccountSession?
    init(value: PetAccountSession?) { self.value = value }
    func load() throws -> PetAccountSession? { value }
    func save(_ session: PetAccountSession) throws { value = session }
    func clear() throws { value = nil }
}

@MainActor
private final class UsageIntegrationAccountBrowser: PetAccountBrowsing {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        URL(string: "com.biadone.blabee://auth/callback?code=usage-test-code")!
    }
    func cancel() {}
}

@MainActor
private final class UsageIntegrationAccountGate {
    private var entered = false
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []

    func suspend() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            entered = true
            let waiting = observers
            observers.removeAll()
            waiting.forEach { $0.resume() }
        }
    }

    func waitUntilEntered() async {
        guard !entered else { return }
        await withCheckedContinuation { observers.append($0) }
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class UsageIntegrationRecorder {
    let store = UsageIntegrationEventStore()
    let service = UsageIntegrationUsageService()
    let recorder: PetUsageAnalytics

    init(account: UsageIntegrationAccountFixture, enabled: Bool = true) {
        recorder = PetUsageAnalytics(isEnabled: enabled,
            authorization: { [weak controller = account.controller] in controller?.usageAuthorization() },
            store: store, service: service, now: { [clock = account.clock] in clock.date })
        // Match the application lifecycle binding while keeping all I/O fake.
        account.controller.onPhaseChanged = { [weak recorder] phase in
            switch phase {
            case .signedOut, .signingOut: recorder?.clearIdentity()
            default: recorder?.accountStateChanged()
            }
        }
    }

    func waitUntilDelivered() async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while ContinuousClock.now < deadline {
            if !service.events.isEmpty, store.events.isEmpty { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return !service.events.isEmpty && store.events.isEmpty
    }
}

@MainActor
private final class UsageIntegrationEventStore: PetUsageEventStoring {
    var events: [PetUsageEvent] = []
    var saved: [[PetUsageEvent]] = []
    var usageEvents: [PetUsageEvent] { events.filter { $0.kind != .productMetric && $0.kind != .insightMetric } }
    func load() throws -> [PetUsageEvent] { events }
    func save(_ events: [PetUsageEvent]) throws {
        self.events = events
        saved.append(events)
    }
    func clear() throws { events.removeAll() }
}

@MainActor
private final class UsageIntegrationUsageService: PetUsageSending {
    var events: [PetUsageEvent] = []
    var usageEvents: [PetUsageEvent] { events.filter { $0.kind != .productMetric && $0.kind != .insightMetric } }
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        #expect(event.userID == authorization.userID)
        events.append(event)
        return .accepted
    }
}

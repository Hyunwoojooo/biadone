import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class ActionGenerationPreference: PetAppServicePreferenceStoring {
    var enabled = true
}

@MainActor
private final class ActionGenerationChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = true
    var terminationSummary: String? { nil }
    func stop() async { isRunning = false }
}

@MainActor
private struct ActionGenerationLauncher: AppOwnedServiceLaunching {
    func launch() throws -> any AppOwnedServiceChild { ActionGenerationChild() }
}

@MainActor
private struct ActionGenerationHarness {
    let transport: PetFakeTransport
    let opener = PetFakeApplicationOpener()
    let service: PetAppServiceController
    let viewModel: PetViewModel

    init(
        transport: PetFakeTransport = PetFakeTransport(),
        coordinatorTransport: (any PetCoordinatorTransport)? = nil
    ) {
        self.transport = transport
        service = PetAppServiceController(
            launcher: ActionGenerationLauncher(),
            preference: ActionGenerationPreference(),
            registration: { .notRegistered }
        )
        viewModel = PetViewModel(
            transport: coordinatorTransport ?? transport,
            externalApplicationOpener: opener,
            appService: service,
            processIdentifier: 999,
            selectionIDGenerator: { "selection_generation_test" },
            permissionResponseIDGenerator: { "permission_response_test" },
            managedApprovalResponseIDGenerator: { "managed_approval_response_test" }
        )
        service.startAtAppLaunch()
    }

    func present(_ data: Data) async {
        await transport.enqueue(type: "get_state", response: data)
        await viewModel.refresh()
        #expect(service.state == .ready)
    }

    func restartAndPresent(_ data: Data) async {
        let priorGeneration = service.generation
        await service.restart()
        #expect(service.generation != priorGeneration)
        await present(data)
    }
}

/// Hold individual focus replies so A can finish while B is still awaiting
/// its own focus. The shared fake's global focus gate would release both.
private actor ActionGenerationFocusTransport: PetCoordinatorTransport {
    let fallback: PetFakeTransport
    private var blockedIdentities: Set<String> = []
    private var waiters: [String: [CheckedContinuation<Data, any Error>]] = [:]
    private var rejectSnapshots = false
    private(set) var snapshotCalls = 0

    init(fallback: PetFakeTransport) { self.fallback = fallback }

    func block(_ identity: PetInteractionIdentity) { blockedIdentities.insert(identity.interactionID) }
    func isWaiting(_ identity: PetInteractionIdentity) -> Bool {
        !(waiters[identity.interactionID]?.isEmpty ?? true)
    }
    func pendingCount(_ identity: PetInteractionIdentity) -> Int {
        waiters[identity.interactionID]?.count ?? 0
    }
    func setRejectSnapshots(_ reject: Bool) { rejectSnapshots = reject }

    func complete(_ identity: PetInteractionIdentity, fails: Bool = false) throws {
        blockedIdentities.remove(identity.interactionID)
        let continuations = waiters.removeValue(forKey: identity.interactionID) ?? []
        for continuation in continuations {
            if fails {
                continuation.resume(throwing: PetTestError.injected("old_generation_focus_failure"))
            } else {
                continuation.resume(returning: try petTestFocusResponse())
            }
        }
    }

    func completeFirst(_ identity: PetInteractionIdentity, fails: Bool) throws {
        guard var continuations = waiters[identity.interactionID], !continuations.isEmpty else { return }
        let continuation = continuations.removeFirst()
        waiters[identity.interactionID] = continuations
        if fails {
            continuation.resume(throwing: PetTestError.injected("old_focus_operation_failure"))
        } else {
            continuation.resume(returning: try petTestFocusResponse())
        }
    }

    func request(type: String, payload: Data) async throws -> Data {
        if type == "get_state" {
            snapshotCalls += 1
            if rejectSnapshots { throw PetTestError.injected("unexpected_stale_focus_refresh") }
        }
        if type == "focus_interaction",
           let identity = try petTestObject(payload)["interaction_id"] as? String,
           blockedIdentities.contains(identity) {
            return try await withCheckedThrowingContinuation { continuation in
                waiters[identity, default: []].append(continuation)
            }
        }
        return try await fallback.request(type: type, payload: payload)
    }
}

private func actionGenerationWaitForFocus(
    _ identity: PetInteractionIdentity, transport: ActionGenerationFocusTransport,
    count: Int = 1
) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await transport.pendingCount(identity) >= count { return true }
        await Task.yield()
    }
    return await transport.pendingCount(identity) >= count
}

private enum ActionGenerationApproval: CaseIterable, Sendable {
    case hook
    case managed

    var requestType: String {
        self == .hook ? "resolve_permission_request" : "resolve_managed_command_approval"
    }

    func snapshot() throws -> Data {
        switch self {
        case .hook:
            try petTestSnapshotData(
                cards: [], permissionRequests: [PetTestPermissionRequest(suffix: "generation_a")]
            )
        case .managed:
            try petTestSnapshotData(
                cards: [], managedCommandApprovals: [PetTestManagedCommandApproval(suffix: "generation_a")]
            )
        }
    }

    func setBlocked(_ blocked: Bool, transport: PetFakeTransport) async {
        switch self {
        case .hook: await transport.setNextPermissionResolutionBlocked(blocked)
        case .managed: await transport.setNextManagedApprovalResolutionBlocked(blocked)
        }
    }

    @MainActor
    func begin(on viewModel: PetViewModel) throws -> Task<Void, Never> {
        switch self {
        case .hook:
            let request = try #require(viewModel.pendingPermissionRequest)
            return Task { await viewModel.resolvePermissionRequest(.deny, for: request) }
        case .managed:
            let request = try #require(viewModel.pendingManagedCommandApproval)
            return Task { await viewModel.resolveManagedCommandApproval(.decline, for: request) }
        }
    }

    func successfulResponse() throws -> Data {
        switch self {
        case .hook:
            try petTestPermissionResolutionResponse(.deny, requestID: "permission_generation_a")
        case .managed:
            try petTestManagedCommandApprovalResolutionResponse(
                .decline, managedRequestID: "managed_request_generation_a"
            )
        }
    }
}

private func actionGenerationWaitForRequest(
    _ type: String, transport: PetFakeTransport
) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await transport.requestCount(type: type) > 0 { return true }
        await Task.yield()
    }
    return await transport.requestCount(type: type) > 0
}

@Test("Late approval failures cannot overwrite a restarted service's ready UI",
      arguments: ActionGenerationApproval.allCases)
@MainActor
private func petActionGenerationLateApprovalFailure(_ kind: ActionGenerationApproval) async throws {
    let h = ActionGenerationHarness()
    await h.present(try kind.snapshot())
    await kind.setBlocked(true, transport: h.transport)
    await h.transport.enqueueFailure(type: kind.requestType, code: "old_generation_failure")
    let action = try kind.begin(on: h.viewModel)
    #expect(await actionGenerationWaitForRequest(kind.requestType, transport: h.transport))

    let replacement = try petTestSnapshotData(cards: [])
    await h.restartAndPresent(replacement)
    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.inFlightPermissionRequestID == nil)
    #expect(h.viewModel.inFlightManagedCommandApprovalID == nil)
    let snapshotsBeforeCompletion = await h.transport.requestCount(type: "get_state")
    var attentionChanges: [Bool] = []
    var failureNotifications = 0
    h.viewModel.onAttentionChanged = { attentionChanges.append($0) }
    h.viewModel.onApprovalResolutionFailed = { failureNotifications += 1 }
    // The buggy catch path can fetch a perfectly healthy B snapshot and then
    // overwrite it with A's persistent error. Supply it to isolate that race.
    await h.transport.enqueue(type: "get_state", response: replacement)
    await kind.setBlocked(false, transport: h.transport)
    await action.value

    #expect(h.viewModel.lastError == nil)
    #expect(!h.viewModel.hasPersistentApprovalResolutionError)
    #expect(!h.viewModel.hasAttention)
    #expect(failureNotifications == 0)
    #expect(!attentionChanges.contains(true))
    #expect(await h.transport.requestCount(type: "get_state") == snapshotsBeforeCompletion)
    await h.present(replacement)
    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.presentationState == .ready)
    await h.viewModel.shutdownAppOwnedService()
}

@Test("Late approval successes cannot publish acceptance for a replacement service",
      arguments: ActionGenerationApproval.allCases)
@MainActor
private func petActionGenerationLateApprovalSuccess(_ kind: ActionGenerationApproval) async throws {
    let h = ActionGenerationHarness()
    await h.present(try kind.snapshot())
    await kind.setBlocked(true, transport: h.transport)
    await h.transport.enqueue(type: kind.requestType, response: try kind.successfulResponse())
    let action = try kind.begin(on: h.viewModel)
    #expect(await actionGenerationWaitForRequest(kind.requestType, transport: h.transport))

    let replacement = try petTestSnapshotData(cards: [])
    await h.restartAndPresent(replacement)
    let snapshotsBeforeCompletion = await h.transport.requestCount(type: "get_state")
    var acceptedActions = 0
    h.viewModel.onUsageAccepted = { _ in acceptedActions += 1 }
    await h.transport.enqueue(type: "get_state", response: replacement)
    await kind.setBlocked(false, transport: h.transport)
    await action.value

    #expect(acceptedActions == 0)
    #expect(h.opener.opened.isEmpty)
    #expect(h.viewModel.lastError == nil)
    #expect(await h.transport.requestCount(type: "get_state") == snapshotsBeforeCompletion)
    #expect(h.viewModel.inFlightPermissionRequestID == nil)
    #expect(h.viewModel.inFlightManagedCommandApprovalID == nil)
    await h.viewModel.shutdownAppOwnedService()
}

@Test("Late selection success cannot reopen the old app or change the replacement UI")
@MainActor
func petActionGenerationLateSelectionSuccess() async throws {
    let h = ActionGenerationHarness()
    let card = PetTestCard(suffix: "generation_selection")
    try h.viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
    let identity = try #require(h.viewModel.snapshotInteractions.first?.identity)
    await h.transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await h.transport.enqueue(
        type: "get_state", response: try petTestSnapshotData(cards: [card], foregroundSuffix: card.suffix)
    )
    await h.viewModel.focus(identity)
    #expect(h.viewModel.focusedInteraction?.identity == identity)
    await h.transport.setSelectionBlocked(true)
    await h.transport.enqueue(type: "select", response: try petTestSelectionResponse(kind: "pause"))
    let action = Task { await h.viewModel.requestLegacyPause() }
    #expect(await actionGenerationWaitForRequest("select", transport: h.transport))

    let replacement = try petTestSnapshotData(cards: [])
    await h.restartAndPresent(replacement)
    #expect(h.viewModel.selectionSubmission == nil)
    let snapshotsBeforeCompletion = await h.transport.requestCount(type: "get_state")
    var acceptedActions = 0
    h.viewModel.onUsageAccepted = { _ in acceptedActions += 1 }
    await h.transport.enqueue(type: "get_state", response: replacement)
    await h.transport.setSelectionBlocked(false)
    await action.value

    #expect(h.opener.opened.isEmpty)
    #expect(acceptedActions == 0)
    #expect(h.viewModel.lastTerminalPresentation == nil)
    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.presentationState == .ready)
    #expect(await h.transport.requestCount(type: "get_state") == snapshotsBeforeCompletion)
    await h.viewModel.shutdownAppOwnedService()
}

@Test("Late focus replies cannot clear the replacement service's pending focus",
      arguments: [false, true])
@MainActor
func petActionGenerationLateFocusPreservesPendingFocus(_ fails: Bool) async throws {
    let fallback = PetFakeTransport()
    let transport = ActionGenerationFocusTransport(fallback: fallback)
    let h = ActionGenerationHarness(transport: fallback, coordinatorTransport: transport)
    let oldCard = PetTestCard(suffix: "old_focus")
    try h.viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [oldCard]))
    let oldIdentity = try #require(h.viewModel.snapshotInteractions.first?.identity)
    await transport.block(oldIdentity)
    let oldFocus = Task { await h.viewModel.focus(oldIdentity) }
    #expect(await actionGenerationWaitForFocus(oldIdentity, transport: transport))

    await h.restartAndPresent(try petTestSnapshotData(cards: []))
    let currentCard = PetTestCard(suffix: "replacement_focus")
    try h.viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [currentCard]))
    let currentIdentity = try #require(h.viewModel.snapshotInteractions.first?.identity)
    await transport.block(currentIdentity)
    let currentFocus = Task { await h.viewModel.focus(currentIdentity) }
    #expect(await actionGenerationWaitForFocus(currentIdentity, transport: transport))
    #expect(h.viewModel.pendingFocusIdentity == currentIdentity)
    let snapshotsBeforeCompletion = await transport.snapshotCalls
    // Any read triggered by A is invalid in this phase. Fail it immediately so
    // a buggy A catch cannot recursively join B's intentionally blocked focus.
    await transport.setRejectSnapshots(true)
    try await transport.complete(oldIdentity, fails: fails)
    await oldFocus.value

    #expect(h.viewModel.pendingFocusIdentity == currentIdentity)
    #expect(h.viewModel.snapshotInteractions.first?.identity == currentIdentity)
    #expect(h.viewModel.lastError == nil)
    #expect(await transport.snapshotCalls == snapshotsBeforeCompletion)
    #expect(h.opener.opened.isEmpty)

    await h.viewModel.shutdownAppOwnedService()
    try await transport.complete(currentIdentity)
    await currentFocus.value
}

@Test("Late focus replies cannot clear a replacement selection's foreground authority",
      arguments: [false, true])
@MainActor
func petActionGenerationLateFocusPreservesSelection(_ fails: Bool) async throws {
    let fallback = PetFakeTransport()
    let transport = ActionGenerationFocusTransport(fallback: fallback)
    let h = ActionGenerationHarness(transport: fallback, coordinatorTransport: transport)
    let oldCard = PetTestCard(suffix: "old_focus_selection")
    try h.viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [oldCard]))
    let oldIdentity = try #require(h.viewModel.snapshotInteractions.first?.identity)
    await transport.block(oldIdentity)
    let oldFocus = Task { await h.viewModel.focus(oldIdentity) }
    #expect(await actionGenerationWaitForFocus(oldIdentity, transport: transport))

    await h.restartAndPresent(try petTestSnapshotData(cards: []))
    let currentCard = PetTestCard(suffix: "replacement_selection")
    try h.viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [currentCard]))
    let currentIdentity = try #require(h.viewModel.snapshotInteractions.first?.identity)
    let currentSnapshot = try petTestSnapshotData(cards: [currentCard], foregroundSuffix: currentCard.suffix)
    await fallback.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await fallback.enqueue(type: "get_state", response: currentSnapshot)
    await h.viewModel.focus(currentIdentity)
    #expect(h.viewModel.localForegroundIdentity == currentIdentity)
    await fallback.setSelectionBlocked(true)
    await fallback.enqueue(type: "select", response: try petTestSelectionResponse())
    let currentSelection = Task { await h.viewModel.requestPanelSelection(1) }
    #expect(await actionGenerationWaitForRequest("select", transport: fallback))
    let submission = try #require(h.viewModel.selectionSubmission)
    let snapshotsBeforeCompletion = await transport.snapshotCalls
    // B keeps returning its exact focused identity. A must not revoke B's
    // local authority even after reading this otherwise valid new snapshot.
    await fallback.enqueue(type: "get_state", response: currentSnapshot)
    await fallback.enqueue(type: "get_state", response: currentSnapshot)
    try await transport.complete(oldIdentity, fails: fails)
    await oldFocus.value

    #expect(h.viewModel.localForegroundIdentity == currentIdentity)
    #expect(h.viewModel.selectionSubmission == submission)
    #expect(h.viewModel.lastError == nil)
    #expect(await transport.snapshotCalls == snapshotsBeforeCompletion)
    #expect(h.opener.opened.isEmpty)

    await h.viewModel.shutdownAppOwnedService()
    await fallback.setSelectionBlocked(false)
    await currentSelection.value
}

@Test("Focus invalidation separates same-card waiters without changing the service generation",
      arguments: [false, true])
@MainActor
func petActionGenerationSameGenerationFocusOwnership(_ fails: Bool) async throws {
    let fallback = PetFakeTransport()
    let transport = ActionGenerationFocusTransport(fallback: fallback)
    let h = ActionGenerationHarness(transport: fallback, coordinatorTransport: transport)
    await h.present(try petTestSnapshotData(cards: []))
    let generation = h.service.generation
    let card = PetTestCard(suffix: "same_generation_focus")
    let snapshot = try petTestSnapshotData(cards: [card])
    try h.viewModel.receiveSnapshotDataForTesting(snapshot)
    let identity = try #require(h.viewModel.snapshotInteractions.first?.identity)
    await transport.block(identity)
    let oldFocus = Task { await h.viewModel.focus(identity) }
    #expect(await actionGenerationWaitForFocus(identity, transport: transport))
    var oldWaiterStarted = false
    var oldWaiterCompleted = false
    let oldWaiter = Task {
        oldWaiterStarted = true
        await h.viewModel.focus(identity)
        oldWaiterCompleted = true
    }
    while !oldWaiterStarted { await Task.yield() }

    await fallback.enqueueFailure(type: "get_state", code: "temporary_disconnect")
    await h.viewModel.refresh()
    #expect(h.service.generation == generation)
    #expect(h.viewModel.pendingFocusIdentity == nil)
    // Invalidation must release A's joined callers even if its transport is
    // still waiting. They must not become waiters for a later same-card B.
    for _ in 0..<5 { await Task.yield() }
    #expect(oldWaiterCompleted)

    await fallback.enqueue(type: "get_state", response: snapshot)
    let recovery = Task { await h.viewModel.refresh() }
    #expect(await actionGenerationWaitForFocus(identity, transport: transport, count: 2))
    #expect(h.viewModel.pendingFocusIdentity == identity)
    #expect(h.viewModel.lastError == nil)
    var newWaiterStarted = false
    var newWaiterCompleted = false
    let newWaiter = Task {
        newWaiterStarted = true
        await h.viewModel.focus(identity)
        newWaiterCompleted = true
    }
    while !newWaiterStarted { await Task.yield() }
    let snapshotsBeforeCompletion = await transport.snapshotCalls
    await transport.setRejectSnapshots(true)
    try await transport.completeFirst(identity, fails: fails)
    await oldFocus.value

    #expect(h.service.generation == generation)
    #expect(h.viewModel.pendingFocusIdentity == identity)
    #expect(h.viewModel.snapshotInteractions.first?.identity == identity)
    #expect(h.viewModel.lastError == nil)
    #expect(!newWaiterCompleted)
    #expect(await transport.snapshotCalls == snapshotsBeforeCompletion)

    await h.viewModel.shutdownAppOwnedService()
    try await transport.complete(identity)
    await recovery.value
    await oldWaiter.value
    await newWaiter.value
}

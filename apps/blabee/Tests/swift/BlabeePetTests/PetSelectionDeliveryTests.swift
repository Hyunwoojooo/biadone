import Foundation
import Testing
@testable import BlabeeCoordinator
@testable import CoordinatorSwift

private actor SelectionDeliveryTransport: PetCoordinatorTransport {
    let backend = PetFakeTransport()
    var failure: CoordinatorError?

    func setFailure(_ failure: CoordinatorError?) { self.failure = failure }

    func request(type: String, payload: Data) async throws -> Data {
        let capturedFailure = failure
        let response = try await backend.request(type: type, payload: payload)
        if type == "select", let capturedFailure { throw capturedFailure }
        return response
    }
}

private actor SelectionDeliveryRecheck: CodexPluginSetupManaging {
    var result = CodexPluginCheckResult(state: .installedNeedsHookReview(version: "0.1.3"))
    var block = false
    var waiter: CheckedContinuation<Void, Never>?
    private(set) var checks = 0
    var isWaiting: Bool { waiter != nil }

    func setResult(_ result: CodexPluginCheckResult) { self.result = result }
    func setBlocked(_ block: Bool) {
        self.block = block
        if !block { waiter?.resume(); waiter = nil }
    }
    func inspect() async -> CodexPluginSetupState { result.state }
    func recheckNativeExecutableWithReport() async -> CodexPluginCheckResult {
        checks += 1
        let captured = result
        if block { await withCheckedContinuation { waiter = $0 } }
        return captured
    }
    func connect() async -> CodexPluginSetupState { result.state }
    func disconnect() async -> CodexPluginSetupState { result.state }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState {
        result.state
    }
}

@MainActor
private struct SelectionDeliveryHarness {
    let transport = SelectionDeliveryTransport()
    let recheck = SelectionDeliveryRecheck()
    let opener = PetFakeApplicationOpener()
    let model: PetViewModel

    init() {
        model = PetViewModel(transport: transport, externalApplicationOpener: opener,
            codexPluginSetupManager: recheck, processIdentifier: 999,
            selectionIDGenerator: { "selection_delivery_test" })
    }

    func focus(_ card: PetTestCard) async throws -> PetInteractionIdentity {
        try model.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
        let identity = try #require(model.displayInteraction?.identity)
        await transport.backend.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
        await transport.backend.enqueue(type: "get_state",
            response: try petTestSnapshotData(cards: [card], foregroundSuffix: card.suffix))
        await model.focus(identity)
        #expect(model.focusedInteraction?.identity == identity)
        return identity
    }

    func failSelection(_ failure: CoordinatorError, card: PetTestCard = .init(suffix: "delivery")) async throws {
        _ = try await focus(card)
        await transport.setFailure(failure)
        await transport.backend.enqueue(type: "select", response: try petTestSelectionResponse())
        await transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await model.requestPanelSelection(1)
    }
}

private func deliveryFailure(attempted: Bool = false) -> CoordinatorError {
    let failure = CoordinatorNextTurnDispatchFailure(code: "codex_native_probe_timeout",
        stage: .qualification, commandInvocationAttempted: attempted, elapsedMilliseconds: 15_000,
        cachedFailure: true)
    return CoordinatorError(failure.code, dispatchFailure: failure)
}

@MainActor
private func waitForDeliveryCondition(_ condition: () async -> Bool) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        await Task.yield()
    }
    return await condition()
}

@Test("Selection delivery failures survive successful snapshots and never retry automatically", .petLanguage(.korean),
      arguments: [false, true])
@MainActor
func petSelectionDeliverySnapshotPersistence(_ attempted: Bool) async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(deliveryFailure(attempted: attempted))
    let notice = try #require(h.model.selectionDeliveryNotice)
    #expect(notice.deliveryState == (attempted ? .unknown : .notSubmitted))
    #expect(notice.title == (attempted ? "전달 결과를 확인할 수 없어요" : "Codex로 보내지 못했어요"))
    #expect(notice.selectionID == "selection_delivery_test")
    #expect(notice.requiresCodexRecheck)
    #expect(h.model.hasVisibleStatusMessage && h.model.lastError == nil)

    for _ in 0..<3 {
        await h.transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await h.model.refresh()
        #expect(h.model.selectionDeliveryNotice == notice)
    }
    #expect(await h.transport.backend.requestCount(type: "select") == 1)
    #expect(h.model.selectionSubmission == nil && h.model.localForegroundIdentity == nil)
    h.model.dismissSelectionDeliveryNotice(noticeID: UUID())
    #expect(h.model.selectionDeliveryNotice == notice)
    h.model.dismissSelectionDeliveryNotice(noticeID: notice.id)
    #expect(h.model.selectionDeliveryNotice == nil)
    #expect(await h.transport.backend.requestCount(type: "select") == 1)
}

@Test("A legacy native error code cannot prove that queue submission never happened", .petLanguage(.korean))
@MainActor
func petSelectionDeliveryLegacyCodeIsUnknown() async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(CoordinatorError("codex_native_probe_timeout"))
    let notice = try #require(h.model.selectionDeliveryNotice)
    #expect(notice.deliveryState == .unknown)
    #expect(notice.requiresCodexRecheck)
    #expect(notice.detail.contains("먼저 확인"))
    #expect(h.opener.opened.isEmpty)
}

@Test("A transport timeout stays unknown without a misleading native recheck action", .petLanguage(.korean))
@MainActor
func petSelectionDeliveryTransportFailure() async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(CoordinatorError("operational_transport_timeout"))
    let notice = try #require(h.model.selectionDeliveryNotice)
    #expect(notice.deliveryState == .unknown && !notice.requiresCodexRecheck)
    await h.model.recheckSelectionDeliveryCodex(noticeID: notice.id)
    #expect(await h.recheck.checks == 0)
    await h.transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await h.model.refresh()
    #expect(h.model.selectionDeliveryNotice == notice)
}

@Test("Explicit native recheck updates recovery guidance without resending the old selection", .petLanguage(.korean),
      arguments: [false, true])
@MainActor
func petSelectionDeliveryExplicitRecheck(_ failed: Bool) async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(deliveryFailure())
    let notice = try #require(h.model.selectionDeliveryNotice)
    if failed {
        await h.recheck.setResult(.init(state: .error(code: "codex_native_probe_timeout")))
    }
    await h.model.recheckSelectionDeliveryCodex(noticeID: notice.id)
    let after = try #require(h.model.selectionDeliveryNotice)
    #expect(after.id == notice.id)
    #expect(after.nativeRecheckSucceeded == !failed && after.nativeRecheckFailed == failed)
    #expect(after.detail.contains(failed ? "마치지 못했어요" : "새 카드"))
    #expect(h.model.localForegroundIdentity == nil && h.opener.opened.isEmpty)
    #expect(await h.recheck.checks == 1)
    #expect(await h.transport.backend.requestCount(type: "select") == 1)
}

@Test("Closing the notice while recheck runs prevents a late result from recreating it", .petLanguage(.korean))
@MainActor
func petSelectionDeliveryDismissDuringRecheck() async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(deliveryFailure())
    let notice = try #require(h.model.selectionDeliveryNotice)
    await h.recheck.setBlocked(true)
    let check = Task { await h.model.recheckSelectionDeliveryCodex(noticeID: notice.id) }
    #expect(await waitForDeliveryCondition { await h.recheck.isWaiting })
    h.model.dismissSelectionDeliveryNotice(noticeID: notice.id)
    await h.recheck.setBlocked(false)
    await check.value
    #expect(h.model.selectionDeliveryNotice == nil)
    #expect(await h.transport.backend.requestCount(type: "select") == 1)
}

@Test("Automatic FIFO focus preserves the previous selection notice; explicit navigation dismisses it", .petLanguage(.korean))
@MainActor
func petSelectionDeliveryFIFOOwnership() async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(deliveryFailure())
    let notice = try #require(h.model.selectionDeliveryNotice)
    let next = PetTestCard(suffix: "delivery_successor")
    func sameSession(_ value: Any) -> Any {
        if let object = value as? [String: Any] {
            return object.mapValues { sameSession($0) }.merging(
                object.keys.contains("session_id") ? ["session_id": notice.identity.binding.sessionID] : [:]
            ) { _, replacement in replacement }
        }
        if let array = value as? [Any] { return array.map(sameSession) }
        return value
    }
    let unfocused = try petTestData(sameSession(petTestSnapshotObject(cards: [next])))
    let focused = try petTestData(sameSession(petTestSnapshotObject(cards: [next], foregroundSuffix: next.suffix)))
    await h.transport.backend.enqueue(type: "get_state", response: unfocused)
    await h.transport.backend.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await h.transport.backend.enqueue(type: "get_state", response: focused)
    await h.model.refresh()
    let nextIdentity = try #require(h.model.displayInteraction?.identity)
    #expect(h.model.focusedInteraction?.identity == nextIdentity)
    #expect(h.model.selectionDeliveryNotice == notice)
    #expect(await h.transport.backend.requestCount(type: "select") == 1)
    await h.model.focus(nextIdentity)
    #expect(h.model.selectionDeliveryNotice == nil)
}

@Test("A new explicit selection retires the previous delivery notice without replaying it", .petLanguage(.korean))
@MainActor
func petSelectionDeliveryFreshSelection() async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(deliveryFailure())
    let old = try #require(h.model.selectionDeliveryNotice)
    _ = try await h.focus(.init(suffix: "delivery_fresh"))
    #expect(h.model.selectionDeliveryNotice == nil)
    await h.transport.setFailure(nil)
    await h.transport.backend.enqueue(type: "select", response: try petTestSelectionResponse())
    await h.transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await h.model.requestPanelSelection(1)
    h.model.dismissSelectionDeliveryNotice(noticeID: old.id)
    #expect(h.model.selectionDeliveryNotice == nil)
    #expect(await h.transport.backend.requestCount(type: "select") == 2)
    #expect(await h.recheck.checks == 0)
}

@Test("Dismissing a selection notice preserves a separate approval delivery error", .petLanguage(.korean))
@MainActor
func petSelectionDeliveryPreservesApprovalError() async throws {
    let h = SelectionDeliveryHarness()
    try await h.failSelection(deliveryFailure())
    let notice = try #require(h.model.selectionDeliveryNotice)
    try h.model.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [],
        permissionRequests: [.init(suffix: "delivery_approval")]))
    let approval = try #require(h.model.pendingPermissionRequest)
    await h.transport.backend.enqueueFailure(type: "resolve_permission_request", code: "hook_delivery_failed")
    await h.transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await h.model.resolvePermissionRequest(.deferToCodex, for: approval)
    #expect(h.model.hasPersistentApprovalResolutionError)
    #expect(h.model.selectionDeliveryNotice == notice)
    h.model.dismissSelectionDeliveryNotice(noticeID: notice.id)
    #expect(h.model.selectionDeliveryNotice == nil)
    #expect(h.model.lastError?.contains("hook_delivery_failed") == true)
    #expect(h.model.hasPersistentApprovalResolutionError)
}

@Test("A late selection failure cannot overwrite another card even if the old card reappears", .petLanguage(.korean),
      arguments: [false, true])
@MainActor
func petSelectionDeliveryLateReplyCardFence(_ returnToOriginal: Bool) async throws {
    let h = SelectionDeliveryHarness()
    let card = PetTestCard(suffix: "delivery_old")
    _ = try await h.focus(card)
    await h.transport.setFailure(deliveryFailure())
    await h.transport.backend.enqueue(type: "select", response: try petTestSelectionResponse())
    await h.transport.backend.setSelectionBlocked(true)
    let selection = Task { await h.model.requestPanelSelection(1) }
    #expect(await waitForDeliveryCondition { await h.transport.backend.requestCount(type: "select") == 1 })
    let replacement = PetTestCard(suffix: "delivery_new")
    try h.model.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [replacement]))
    if returnToOriginal {
        try h.model.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
    }
    let displayed = h.model.displayInteraction?.identity
    let reads = await h.transport.backend.requestCount(type: "get_state")
    await h.transport.backend.setSelectionBlocked(false)
    await selection.value
    #expect(h.model.selectionDeliveryNotice == nil && h.model.lastError == nil)
    #expect(h.model.selectionSubmission == nil && h.model.displayInteraction?.identity == displayed)
    #expect(await h.transport.backend.requestCount(type: "get_state") == reads)
    #expect(await h.transport.backend.requestCount(type: "select") == 1)
    #expect(h.opener.opened.isEmpty)
}

@Test("Selection delivery recovery has room for its explanation and explicit actions", .petLanguage(.korean))
func petSelectionDeliveryPanelHeight() {
    var state = PetPanelLayoutState(isExpanded: false, isEditingShortcuts: false,
        isShowingOnboarding: false, actionCount: nil, fifoQueueCount: 0,
        hasPermissionNotice: false, hasStatusMessage: true)
    let ordinary = PetPanelSizePolicy.preferredSize(for: state)
    state.hasSelectionDeliveryNotice = true
    let recovery = PetPanelSizePolicy.preferredSize(for: state)
    #expect(recovery.height == ordinary.height + PetPanelSizePolicy.selectionDeliveryNoticeExtraHeight)
    #expect(recovery.height <= PetPanelSizePolicy.expandedHeight)
}

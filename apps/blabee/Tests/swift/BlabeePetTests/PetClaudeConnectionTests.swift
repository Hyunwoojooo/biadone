import Foundation
import Testing
@testable import BlabeeCoordinator

private let connectionService = PetClaudeConnectionController.ServiceIdentity(
    generation: 4, incarnation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
private let connectionProject = URL(fileURLWithPath: "/tmp/claude connection project")

private actor ConnectionSetupFixture {
    var inspection: ClaudeAutoConnectSetup.Inspection
    private let afterEnable: ClaudeAutoConnectSetup.Inspection?
    private let pauseOperation: Int?
    private var paused: CheckedContinuation<Void, Never>?
    private var pauseObservers: [CheckedContinuation<Void, Never>] = []
    private(set) var operations: [String] = []
    private(set) var enableCount = 0
    private(set) var disableCount = 0
    init(canEnable: Bool = true, canLaunch: Bool = true,
         inspection: ClaudeAutoConnectSetup.Inspection? = nil,
         afterEnable: ClaudeAutoConnectSetup.Inspection? = nil,
         pauseOperation: Int? = nil) {
        self.inspection = inspection ?? .init(isEnabled: false, canEnable: canEnable, canDisable: false,
                           detail: "fixture", canLaunch: canLaunch)
        self.afterEnable = afterEnable; self.pauseOperation = pauseOperation
    }
    func inspect() async -> ClaudeAutoConnectSetup.Inspection {
        let observed = inspection
        await record("inspect")
        return observed
    }
    func enable() async -> ClaudeAutoConnectSetup.Inspection {
        enableCount += 1
        let saved = ClaudeAutoConnectSetup.Inspection(isEnabled: true, canEnable: false, canDisable: true,
                           detail: "saved", canLaunch: true)
        inspection = afterEnable ?? saved
        await record("enable")
        return saved
    }
    func disable() -> ClaudeAutoConnectSetup.Inspection {
        disableCount += 1
        inspection = .init(isEnabled: false, canEnable: true, canDisable: false,
                           detail: "removed", canLaunch: true)
        return inspection
    }
    private func record(_ operation: String) async {
        operations.append(operation)
        guard operations.count == pauseOperation else { return }
        await withCheckedContinuation { continuation in
            paused = continuation
            let observers = pauseObservers
            pauseObservers.removeAll()
            for observer in observers { observer.resume() }
        }
    }
    func waitForPause() async {
        guard paused == nil else { return }
        await withCheckedContinuation { pauseObservers.append($0) }
    }
    func release() {
        paused?.resume(); paused = nil
    }
}

@MainActor
private final class ConnectionHarness {
    let setup: ConnectionSetupFixture
    let controller: PetClaudeConnectionController
    var launches = 0
    var preparations = 0
    var nativeID: UUID?

    init(canEnable: Bool = true, canLaunch: Bool = true,
         waitNoticeNanoseconds: UInt64 = 60_000_000_000) {
        let setup = ConnectionSetupFixture(canEnable: canEnable, canLaunch: canLaunch)
        self.setup = setup
        controller = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.disable() },
            waitNoticeNanoseconds: waitNoticeNanoseconds)
    }

    func start(uncertain: Bool = false, cancelled: Bool = false) async {
        await controller.connect(terminal: .ghostty, prepareService: {
            self.preparations += 1
            return connectionService
        }, launch: { native, terminal in
            self.launches += 1; self.nativeID = native
            if cancelled { return nil }
            let receipt = PetClaudeLauncher.LaunchReceipt(nativeSessionID: native,
                project: connectionProject, terminal: terminal)
            if uncertain { throw PetClaudeLauncher.ConnectionLaunchUnconfirmed(receipt: receipt) }
            return receipt
        })
    }

    func row(native: UUID? = nil, generation: UInt64 = 1, state: String = "connected",
             cwd: String = connectionProject.path,
             service: String = connectionService.incarnation,
             scope: String = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
             epoch: String = "cccccccc-cccc-4ccc-8ccc-cccccccccccc") throws -> PetProviderSession {
        let native = try #require(native ?? nativeID)
        return PetProviderSession(id: "claude:" + scope,
            context: .init(provider: .claude, scopeID: scope, serviceIncarnation: service,
                sessionIncarnation: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                authorityEpoch: epoch, uiGeneration: generation),
            projectID: "claude_project_fixture", sessionID: "claude_session_fixture", cwd: cwd,
            state: state, title: "Claude", nativeSessionID: native.uuidString.lowercased())
    }

    @discardableResult
    func observe(_ rows: [PetProviderSession], selected: PetProviderSession? = nil,
                 ready: Bool = false, bridge: Bool = true, readFailed: Bool = false,
                 serviceGeneration: UInt64 = connectionService.generation,
                 diagnostic: String? = nil) throws -> PetProviderSession? {
        var snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: []))
        snapshot.providerSessions = rows
        snapshot.providerContext = selected?.context
        snapshot.providerDiagnostic = diagnostic
        snapshot.providerDirectory = .init(serviceGeneration: serviceGeneration,
            serviceIncarnation: connectionService.incarnation)
        if let selected {
            snapshot.providerStatus = .init(provider: .claude, scopeID: selected.context.scopeID,
                sessionID: selected.sessionID, cwd: selected.cwd, bridgeConnected: bridge,
                ready: ready, selectionEnabled: ready, latestOutcome: nil)
        }
        return controller.observe(snapshot: snapshot, serviceGeneration: serviceGeneration,
            serviceReady: true, readFailed: readFailed, canSelect: true)
    }
}

@Suite("Claude one-click connection evidence")
@MainActor
struct PetClaudeConnectionTests {
    @Test("Automatic setup is re-inspected and repeated configuration does not repeat its write or launch a session")
    func automaticConfigurationIsNotReadiness() async throws {
        let h = ConnectionHarness()
        let result = try await h.controller.configureAutomaticConnection()
        #expect(result.automaticConnectionReady)
        #expect(h.controller.inspection == result)
        #expect(h.controller.phase == .idle && h.controller.matchedSession == nil)
        #expect(h.preparations == 0 && h.launches == 0 && !h.controller.isWorking)
        #expect(await h.setup.operations == ["inspect", "enable", "inspect"])
        #expect(try await h.controller.configureAutomaticConnection() == result)
        #expect(await h.setup.enableCount == 1)
        #expect(await h.setup.operations == ["inspect", "enable", "inspect", "inspect"])
    }

    @Test("Updating enabled legacy automatic settings writes once and confirms the fresh inspection")
    func updateEnabledAutomaticConfiguration() async throws {
        let old = ClaudeAutoConnectSetup.Inspection(isEnabled: true, canEnable: true,
            canDisable: true, detail: "update required", canLaunch: true, needsSetupRefresh: true)
        let setup = ConnectionSetupFixture(inspection: old)
        let controller = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.disable() })
        #expect(!old.automaticConnectionReady)
        let updated = try await controller.configureAutomaticConnection()
        #expect(updated.automaticConnectionReady && !updated.needsSetupRefresh)
        #expect(controller.inspection == updated && controller.phase == .idle)
        #expect(await setup.operations == ["inspect", "enable", "inspect"])
        #expect(try await controller.configureAutomaticConnection() == updated)
        #expect(await setup.enableCount == 1)
        #expect(await setup.disableCount == 0)
    }

    @Test("Starting a connection refreshes enabled legacy automatic settings exactly once before launch")
    func connectRefreshesEnabledAutomaticConfiguration() async {
        let old = ClaudeAutoConnectSetup.Inspection(isEnabled: true, canEnable: true,
            canDisable: true, detail: "update required", canLaunch: true, needsSetupRefresh: true)
        let setup = ConnectionSetupFixture(inspection: old)
        let controller = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.disable() })
        var preparations = 0
        var launches = 0
        for _ in 0..<2 {
            await controller.connect(terminal: .terminal, prepareService: {
                #expect(await setup.enableCount == 1)
                preparations += 1
                return connectionService
            }, launch: { native, terminal in
                launches += 1
                return .init(nativeSessionID: native, project: connectionProject, terminal: terminal)
            })
        }
        #expect(await setup.operations == ["inspect", "enable"])
        #expect(await setup.enableCount == 1)
        #expect(await setup.disableCount == 0)
        #expect(preparations == 1 && launches == 1)
        #expect(controller.inspection?.automaticConnectionReady == true)
        #expect(controller.inspection?.needsSetupRefresh == false)
        #expect(controller.phase == .waitingForSession && controller.matchedSession == nil)
    }

    @Test("Automatic setup returns fresh saved state instead of an optimistic write receipt")
    func automaticConfigurationRechecksWriterResult() async throws {
        let conflict = ClaudeAutoConnectSetup.Inspection(isEnabled: false, canEnable: false,
            canDisable: false, detail: "changed externally", canLaunch: true, issue: .manualReview)
        let setup = ConnectionSetupFixture(afterEnable: conflict)
        let controller = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.disable() })
        let result = try await controller.configureAutomaticConnection()
        #expect(result == conflict && !result.automaticConnectionReady)
        #expect(controller.inspection == conflict && controller.phase == .idle)
        #expect(await setup.enableCount == 1)
    }

    @Test("Unsupported shells and stale saved executables are returned without changing their setup", arguments: [true, false])
    func automaticConfigurationUnavailable(_ unsupported: Bool) async throws {
        let initial = ClaudeAutoConnectSetup.Inspection(isEnabled: !unsupported, canEnable: false,
            canDisable: !unsupported, detail: "direct launch available", canLaunch: true,
            shellName: unsupported ? "fish" : "zsh", savedExecutableAvailable: unsupported,
            issue: unsupported ? .unsupportedShell : .savedExecutableUnavailable)
        let setup = ConnectionSetupFixture(inspection: initial)
        let controller = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.disable() })
        #expect(try await controller.configureAutomaticConnection() == initial)
        #expect(controller.inspection?.automaticConnectionReady == false)
        #expect(controller.phase == .idle && controller.matchedSession == nil)
        #expect(await setup.enableCount == 0)
        #expect(await setup.disableCount == 0)
    }

    @Test("Automatic configuration preserves an existing launch attempt and its eventual acknowledgement")
    func automaticConfigurationPreservesLaunch() async throws {
        let h = ConnectionHarness()
        await h.start(uncertain: true)
        #expect(h.controller.phase == .waitingForSession && h.controller.launchUnconfirmed)
        _ = try await h.controller.configureAutomaticConnection()
        #expect(h.controller.phase == .waitingForSession && h.controller.launchUnconfirmed)
        #expect(h.launches == 1 && h.preparations == 1)
        let row = try h.row(state: "ready")
        try h.observe([row], selected: row, ready: true)
        _ = try await h.controller.configureAutomaticConnection()
        #expect(h.controller.phase == .connected && h.controller.matchedSession == row)
        #expect(await h.setup.enableCount == 1)
    }

    @Test("Cancellation fences late setup observations and an overlapping request never starts another write", arguments: [1, 2, 3])
    func cancelledAutomaticConfiguration(_ pauseOperation: Int) async throws {
        let setup = ConnectionSetupFixture(pauseOperation: pauseOperation)
        let controller = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.disable() })
        let task = Task { try await controller.configureAutomaticConnection() }
        await setup.waitForPause()
        #expect(controller.isWorking)
        do {
            _ = try await controller.configureAutomaticConnection()
            Issue.record("Concurrent configuration should be rejected")
        } catch is PetClaudeConnectionController.Failure {
        } catch { Issue.record("Unexpected concurrent configuration error: \(error)") }
        task.cancel()
        await setup.release()
        do {
            _ = try await task.value
            Issue.record("Cancelled configuration should not publish a success")
        } catch is CancellationError {
        } catch { Issue.record("Unexpected cancellation error: \(error)") }
        #expect(controller.phase == .idle && controller.inspection == nil && !controller.isWorking)
        #expect(await setup.enableCount == (pauseOperation == 1 ? 0 : 1))
        let retried = try await controller.configureAutomaticConnection()
        #expect(retried.automaticConnectionReady && controller.inspection == retried)
        #expect(await setup.enableCount == 1)
    }

    @Test("Unified inbox ACK checks its exact scope without selecting or stealing the viewed card")
    func inboxAcknowledgementPreservesSelection() async throws {
        let h = ConnectionHarness()
        await h.start()
        let row = try h.row(generation: 2, state: "ready")
        let old = try h.row(generation: 1, state: "ready")
        let other = try h.row(native: UUID(), scope: UUID().uuidString.lowercased())
        var snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: []))
        snapshot.providerSessions = [row, other]
        snapshot.providerContext = other.context
        snapshot.providerDirectory = .init(serviceGeneration: connectionService.generation,
            serviceIncarnation: connectionService.incarnation)
        let status = PetProviderStatus(provider: .claude, scopeID: row.context.scopeID, sessionID: row.sessionID,
            cwd: row.cwd, bridgeConnected: true, ready: true, selectionEnabled: true, latestOutcome: nil)
        snapshot.providerInbox = .init(entries: [], sessions: [
            .init(session: old, status: status, diagnostic: nil),
        ], arrivalOrderComplete: true)
        #expect(h.controller.observe(snapshot: snapshot, serviceGeneration: connectionService.generation,
            serviceReady: true, readFailed: false, canSelect: true) == nil)
        #expect(h.controller.phase == .waitingForAcknowledgement)
        snapshot.providerInbox = .init(entries: [], sessions: [
            .init(session: row, status: status, diagnostic: nil),
        ], arrivalOrderComplete: true)
        #expect(h.controller.observe(snapshot: snapshot, serviceGeneration: connectionService.generation,
            serviceReady: true, readFailed: false, canSelect: true) == nil)
        #expect(h.controller.phase == .connected)
        #expect(snapshot.providerContext == other.context)
        #expect(h.controller.matchedSession == row)
    }

    @Test("First-run observation can confirm the exact inbox ACK with provider selection disabled")
    func firstRunAcknowledgementWithoutSelection() async throws {
        let h = ConnectionHarness()
        await h.start()
        let row = try h.row(state: "ready")
        let other = try h.row(native: UUID(), scope: UUID().uuidString.lowercased())
        var snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: []))
        snapshot.providerSessions = [row, other]
        snapshot.providerContext = other.context
        snapshot.providerDirectory = .init(serviceGeneration: connectionService.generation,
            serviceIncarnation: connectionService.incarnation)
        #expect(h.controller.observe(snapshot: snapshot, serviceGeneration: connectionService.generation,
            serviceReady: true, readFailed: false, canSelect: false) == nil)
        #expect(h.controller.phase == .needsSelection)
        let status = PetProviderStatus(provider: .claude, scopeID: row.context.scopeID, sessionID: row.sessionID,
            cwd: row.cwd, bridgeConnected: true, ready: true, selectionEnabled: true, latestOutcome: nil)
        snapshot.providerInbox = .init(entries: [], sessions: [
            .init(session: row, status: status, diagnostic: nil),
        ], arrivalOrderComplete: true)
        #expect(h.controller.observe(snapshot: snapshot, serviceGeneration: connectionService.generation,
            serviceReady: true, readFailed: false, canSelect: false) == nil)
        #expect(h.controller.phase == .connected && h.controller.matchedSession == row)
        #expect(snapshot.providerContext == other.context)
    }

    @Test("Saved setup and an open terminal do not count as an ACK from this session")
    func setupIsNotReadiness() async throws {
        let h = ConnectionHarness()
        await h.start()
        #expect(h.controller.inspection?.isEnabled == true)
        #expect(h.controller.phase == .waitingForSession)
        #expect(await h.setup.enableCount == 1)
        let unrelated = try h.row(native: UUID(), state: "ready")
        try h.observe([unrelated], selected: unrelated, ready: true)
        #expect(h.controller.phase == .waitingForSession)
        await h.start()
        #expect(h.launches == 1 && h.preparations == 1)
    }

    @Test("Exact session is selected once; only its current generation's ACK completes setup")
    func exactCurrentAcknowledgement() async throws {
        let h = ConnectionHarness()
        await h.start()
        let initial = try h.row()
        #expect(try h.observe([initial]) == initial)
        #expect(try h.observe([initial]) == nil)
        try h.observe([initial], selected: initial)
        #expect(h.controller.phase == .waitingForAcknowledgement)
        let acknowledged = try h.row(generation: 2, state: "ready")
        try h.observe([acknowledged], selected: initial, ready: true)
        #expect(h.controller.phase == .needsSelection)
        try h.observe([acknowledged], selected: acknowledged, ready: true)
        #expect(h.controller.phase == .connected)
        try h.observe([acknowledged])
        #expect(h.controller.phase == .needsSelection)
        #expect(try h.observe([acknowledged]) == nil)
    }

    @Test("A session already selected before the launch receipt does not later steal selection back")
    func initiallySelectedSession() async throws {
        let h = ConnectionHarness()
        await h.start()
        let row = try h.row(state: "ready")
        try h.observe([row], selected: row, ready: true)
        #expect(h.controller.phase == .connected)
        #expect(try h.observe([row]) == nil)
        #expect(h.controller.phase == .needsSelection)
    }

    @Test("Bridge loss, expired readiness, closed session and read failure withdraw success")
    func lossWithdrawsSuccess() async throws {
        let h = ConnectionHarness()
        await h.start()
        let acknowledged = try h.row(state: "ready")
        try h.observe([acknowledged], selected: acknowledged, ready: true)
        #expect(h.controller.phase == .connected)
        try h.observe([acknowledged], selected: acknowledged, ready: true, readFailed: true)
        #expect(h.controller.phase == .unavailable)
        try h.observe([acknowledged], selected: acknowledged, ready: true, bridge: false)
        #expect(h.controller.phase == .waitingForAcknowledgement)
        let expired = try h.row(generation: 2, state: "required")
        try h.observe([expired], selected: expired)
        #expect(h.controller.phase == .needsProbe)
        let closed = try h.row(generation: 3, state: "disconnected")
        try h.observe([closed], selected: closed, ready: true)
        #expect(h.controller.phase == .disconnected)
    }

    @Test("Service replacement retires a launch and late old ACK cannot revive it")
    func serviceReplacement() async throws {
        let h = ConnectionHarness()
        await h.start()
        let row = try h.row(state: "ready")
        try h.observe([row], selected: row, ready: true, serviceGeneration: connectionService.generation + 1)
        guard case .failed = h.controller.phase else { Issue.record("Expected service replacement failure"); return }
        try h.observe([row], selected: row, ready: true)
        #expect(h.controller.phase != .connected && h.controller.matchedSession == nil)
    }

    @Test("Matching native ID does not allow changed authority or ambiguous launch scopes")
    func authorityAndAmbiguity() async throws {
        let h = ConnectionHarness()
        await h.start()
        let initial = try h.row()
        try h.observe([initial], selected: initial)
        let changed = try h.row(state: "ready", epoch: UUID().uuidString.lowercased())
        try h.observe([changed], selected: changed, ready: true)
        guard case .failed = h.controller.phase else { Issue.record("Expected authority replacement failure"); return }
        let other = ConnectionHarness()
        await other.start()
        let first = try other.row(state: "ready")
        let second = try other.row(state: "ready", scope: UUID().uuidString.lowercased())
        try other.observe([first, second], selected: first, ready: true)
        guard case .failed = other.controller.phase else { Issue.record("Expected ambiguous scope failure"); return }
    }

    @Test("Directory rows for another project or service never satisfy this launch")
    func projectAndServiceBinding() async throws {
        let h = ConnectionHarness()
        await h.start()
        let foreignProject = try h.row(state: "ready", cwd: "/tmp/other-project")
        let foreignService = try h.row(state: "ready", service: UUID().uuidString.lowercased())
        try h.observe([foreignProject, foreignService], selected: foreignProject, ready: true)
        #expect(h.controller.phase == .waitingForSession)
    }

    @Test("An unrelated selected projection error does not hide the new session's fresh directory row")
    func unrelatedProjectionFailure() async throws {
        let h = ConnectionHarness()
        await h.start()
        let other = try h.row(native: UUID(), state: "disconnected", scope: UUID().uuidString.lowercased())
        let expected = try h.row()
        #expect(try h.observe([other, expected], selected: other, diagnostic: "old session ended") == expected)
        #expect(h.controller.phase == .needsSelection)
        try h.observe([expected], selected: expected, diagnostic: "this projection unavailable")
        #expect(h.controller.phase == .unavailable)
    }

    @Test("Cached directory rows cannot confirm a connection after directory validation fails")
    func noCachedDirectoryProof() async throws {
        let h = ConnectionHarness()
        await h.start()
        let row = try h.row(state: "ready")
        var snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: []))
        snapshot.providerSessions = [row]
        snapshot.providerContext = row.context
        snapshot.providerStatus = .init(provider: .claude, scopeID: row.context.scopeID,
            sessionID: row.sessionID, cwd: row.cwd, bridgeConnected: true,
            ready: true, selectionEnabled: true, latestOutcome: nil)
        h.controller.observe(snapshot: snapshot, serviceGeneration: connectionService.generation,
            serviceReady: true, readFailed: false, canSelect: true)
        #expect(h.controller.phase == .unavailable)
    }

    @Test("A connection lost after success has a bounded wait and allows explicit recovery")
    func readinessLossRearmsWait() async throws {
        let h = ConnectionHarness(waitNoticeNanoseconds: 1)
        await h.start()
        let row = try h.row(state: "ready")
        try h.observe([row], selected: row, ready: true)
        #expect(h.controller.phase == .connected && !h.controller.delayed)
        try h.observe([row], selected: row, ready: true, readFailed: true)
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !h.controller.delayed, ContinuousClock.now < deadline { await Task.yield() }
        #expect(h.controller.canStart && h.controller.delayed)
        #expect(h.launches == 1)
        await h.start()
        #expect(h.launches == 2 && h.controller.phase == .waitingForSession)
    }

    @Test("Unconfirmed terminal open is not replayed and can still receive its own ACK")
    func uncertainLaunch() async throws {
        let h = ConnectionHarness()
        await h.start(uncertain: true)
        #expect(h.controller.launchUnconfirmed && h.launches == 1)
        await h.start()
        #expect(h.launches == 1)
        let row = try h.row(state: "ready")
        try h.observe([row], selected: row, ready: true)
        #expect(h.controller.phase == .connected && !h.controller.launchUnconfirmed)
    }

    @Test("Unsupported shell can launch directly without writing automatic shell configuration")
    func directLaunchFallback() async {
        let h = ConnectionHarness(canEnable: false)
        await h.start()
        #expect(await h.setup.enableCount == 0)
        #expect(h.launches == 1 && h.controller.inspection?.isEnabled == false)
        #expect(h.controller.phase == .waitingForSession)
    }

    @Test("Unavailable installed launcher stops before service preparation or terminal launch")
    func unavailableRuntime() async {
        let h = ConnectionHarness(canEnable: false, canLaunch: false)
        await h.start()
        #expect(h.preparations == 0 && h.launches == 0)
        guard case .failed = h.controller.phase else { Issue.record("Expected actionable preparation failure"); return }
    }

    @Test("Folder cancellation does not create a pending connection or fabricate success")
    func chooserCancellation() async {
        let h = ConnectionHarness()
        await h.start(cancelled: true)
        #expect(h.controller.phase == .idle && h.controller.matchedSession == nil)
        #expect(h.controller.inspection?.isEnabled == true)
    }

    @Test("Disabling future shell setup leaves the current verified Claude session intact")
    func disableOnlyFutureShells() async throws {
        let h = ConnectionHarness()
        await h.start()
        let row = try h.row(state: "ready")
        try h.observe([row], selected: row, ready: true)
        await h.controller.disableAutomaticConnection()
        #expect(h.controller.phase == .connected && h.controller.inspection?.isEnabled == false)
        #expect(await h.setup.disableCount == 1)
    }

    @Test("Explicitly starting another session rejects the previous session's late ACK")
    func newLaunchDoesNotReuseReadiness() async throws {
        let h = ConnectionHarness()
        await h.start()
        let previous = try h.row(state: "ready")
        try h.observe([previous], selected: previous, ready: true)
        await h.start()
        #expect(h.launches == 2)
        try h.observe([previous], selected: previous, ready: true)
        #expect(h.controller.phase == .waitingForSession)
    }
}

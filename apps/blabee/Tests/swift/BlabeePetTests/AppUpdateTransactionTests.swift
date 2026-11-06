import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private let updateOldIdentity = "sha256:" + String(repeating: "a", count: 64)
private let updateNewIdentity = "sha256:" + String(repeating: "b", count: 64)
private enum UpdateTestFailure: Error, Equatable { case injected }

private func updateSession(_ number: Int, state: UpdateManagedSessionState = .running) -> UpdateManagedSession {
    .init(id: "session-\(number)", threadID: String(format: "00000000-0000-0000-0000-%012d", number),
        cwd: "/private/tmp/project-\(number)", state: state, detail: nil)
}

private func updateJournalFixture(sessions: [UpdateManagedSession] = [updateSession(1), updateSession(2)],
                                  preservingConnections: Bool = false,
                                  userConfirmedClosure: Bool = false) throws -> AppUpdateJournal {
    let version = try #require(PetAppUpdateVersion(version: "0.1.0", build: "41"))
    let name = AppUpdateDownloadPolicy.diskImageName(version)
    let base = URL(string: "https://github.com/test/Blabee/releases/download/blabee-v0.1.0+build.41/")!
    let release = PetAppUpdateRelease(version: version,
        releaseURL: URL(string: "https://github.com/test/Blabee/releases/tag/blabee-v0.1.0+build.41")!,
        installerAssets: .init(dmg: .init(name: name, url: base.appendingPathComponent(name), size: 100),
            checksum: .init(name: name + ".sha256", url: base.appendingPathComponent(name + ".sha256"), size: 100)))
    let root = URL(fileURLWithPath: "/private/tmp/blabee-update-" + UUID().uuidString.lowercased(), isDirectory: true)
    let prepared = AppUpdatePreparedDownload(release: release, workRootURL: root,
        applicationURL: root.appendingPathComponent("Blabee.app"), diskImageURL: root.appendingPathComponent(name),
        sha256: String(repeating: "b", count: 64), runtimeIdentity: updateNewIdentity)
    let jobID = UUID().uuidString.lowercased()
    let helper = preservingConnections || userConfirmedClosure ? "helper-runtime-\(jobID)/Blabee.app" : "helper-runtime/Blabee.app"
    return AppUpdateJournal(schema: userConfirmedClosure ? 3 : (preservingConnections ? 2 : 1), jobID: jobID, nonce: UUID().uuidString.lowercased(),
        parentPID: getpid(), parentStartTime: 1, createdAt: Date(),
        previousIdentity: updateOldIdentity, candidateIdentity: updateNewIdentity,
        download: try .init(prepared), helperApplicationURL: root.appendingPathComponent(helper, isDirectory: true),
        phase: .waitingForExit, sessions: sessions.map { .init(value: $0) }, updatedAt: Date())
}

@MainActor
private final class UpdateTransactionFixture {
    var events: [String] = []
    var records: [AppUpdateJournal] = []
    var current = [updateSession(1), updateSession(2)]
    var identity = updateOldIdentity
    var failPause: String?
    var failResume: String?
    var failInstall = false
    var failNewLaunch = false
    var failOldLaunch = false
    var failSecondVerification = false
    var verificationCount = 0
    var failSaveOnceAt: AppUpdateJournal.Phase?
    var claudeCheckCount = 0
    var blockedClaudeCheck: Int?
    var preservedCheckCount = 0
    var connectionPolicies: [AppUpdateConnectionPolicy] = []
    var blockedPreservedCheck: Int?
    var failServiceHealth = false
    let backup = URL(fileURLWithPath: "/Applications/.Blabee.backup-0123.app")
    var effects: AppUpdateTransactionEffects {
        .init(reverify: { _ in
                self.verificationCount += 1; self.events.append("verify")
                if self.failSecondVerification && self.verificationCount == 2 { throw UpdateTestFailure.injected }
            }, sessions: { self.events.append("preflight"); return self.current },
            pause: { session, _ in
                self.events.append("pause:\(session.id)")
                if self.failPause == session.id { throw UpdateTestFailure.injected }
            }, resume: { session, _ in
                self.events.append("resume:\(session.id)")
                if self.failResume == session.id { throw UpdateTestFailure.injected }
            }, install: { _ in
                self.events.append("install")
                if self.failInstall { throw UpdateTestFailure.injected }
                self.identity = updateNewIdentity
                return .init(destinationURL: AppInstallationService.productionDestinationURL,
                    backupURL: self.backup, identity: updateNewIdentity)
            }, installedIdentity: { self.identity }, openApp: { identity in
                self.events.append(identity == updateOldIdentity ? "open:old" : "open:new")
                if (identity == updateNewIdentity && self.failNewLaunch) || (identity == updateOldIdentity && self.failOldLaunch) {
                    throw UpdateTestFailure.injected
                }
            }, save: { record in
                if self.failSaveOnceAt == record.phase {
                    self.failSaveOnceAt = nil
                    throw UpdateTestFailure.injected
                }
                self.records.append(record)
            }, requireClaudeInactive: {
                self.claudeCheckCount += 1
                if self.blockedClaudeCheck == self.claudeCheckCount {
                    throw AppInstallationError(.claudeRuntimeBlocked)
                }
            }, requirePreservedConnectionsReady: { record in
                self.preservedCheckCount += 1
                self.connectionPolicies.append(record.connectionPolicy)
                self.events.append("preserve-preflight")
                if self.blockedPreservedCheck == self.preservedCheckCount { throw UpdateTestFailure.injected }
            }, requireLaunchedServiceHealthy: { identity in
                #expect(identity == updateNewIdentity)
                self.events.append("health:new")
                if self.failServiceHealth { throw AppUpdateTransactionError.serviceHealthNotConfirmed }
            })
    }
}

@Suite("Automatic update transaction", .petLanguage(.korean)) @MainActor
struct AppUpdateTransactionTests {
    @Test("verify and freeze every session before stopping, then publish and restore")
    func successfulOrdering() async throws {
        let fixture = UpdateTransactionFixture()
        let journal = try updateJournalFixture()
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(journal)
        #expect(result.phase == .succeeded)
        #expect(result.backupURL == fixture.backup)
        #expect(fixture.events == ["verify", "preflight", "pause:session-1", "pause:session-2", "verify",
            "install", "open:new", "resume:session-1", "resume:session-2"])
        #expect(fixture.records.contains { $0.sessions[0].step == .pausing && $0.sessions[1].step == .pending })
        #expect(fixture.records.contains { $0.sessions[0].step == .restoring && $0.sessions[1].step == .paused })
        #expect(result.sessions.allSatisfy { $0.step == .restored })
    }

    @Test("busy and changed session identity prevent every shutdown")
    func preflightFailure() async throws {
        for changed in [false, true] {
            let fixture = UpdateTransactionFixture()
            if changed { fixture.current[1].threadID = UUID().uuidString }
            else { fixture.current[1].state = .busy }
            let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
            #expect(result.phase == .failed)
            #expect(!fixture.events.contains { $0.hasPrefix("pause:") || $0 == "install" })
        }
    }

    @Test("one lost pause acknowledgement restores only already confirmed pauses")
    func partialPauseFailure() async throws {
        let fixture = UpdateTransactionFixture()
        fixture.failPause = "session-2"
        fixture.current.append(updateSession(3))
        let result = await AppUpdateTransactionEngine(effects: fixture.effects)
            .execute(try updateJournalFixture(sessions: fixture.current))
        #expect(result.phase == .recoveryRequired)
        #expect(result.sessions.map(\.step) == [.restored, .uncertain, .pending])
        #expect(fixture.events == ["verify", "preflight", "pause:session-1", "pause:session-2", "resume:session-1", "open:old"])
    }

    @Test("candidate changing after stop prevents publication and restores old sessions")
    func changedAfterPause() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failSecondVerification = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .failed)
        #expect(!fixture.events.contains("install"))
        #expect(result.sessions.allSatisfy { $0.step == .restored })
        #expect(fixture.events.last == "open:old")
    }

    @Test("installed identity changing before shutdown causes no session effects")
    func installedIdentityChanged() async throws {
        let fixture = UpdateTransactionFixture(); fixture.identity = updateNewIdentity
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .recoveryRequired)
        #expect(fixture.events == ["verify"])
    }

    @Test("external runtime guard failure restores paused sessions and opens verified old app")
    func installerBlocked() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failInstall = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .failed)
        #expect(fixture.identity == updateOldIdentity)
        #expect(result.sessions.allSatisfy { $0.step == .restored })
        #expect(fixture.events.last == "open:old")
    }

    @Test("failed old app reopening is recovery required, not a completed abort")
    func oldAppRelaunchFailure() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failInstall = true; fixture.failOldLaunch = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .recoveryRequired)
        #expect(result.sessions.allSatisfy { $0.step == .restored })
        #expect(result.detail.contains("재실행 확인"))
    }

    @Test("new app launch failure preserves new installation and backup without rollback")
    func publishedLaunchFailure() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failNewLaunch = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .recoveryRequired)
        #expect(result.backupURL == fixture.backup)
        #expect(fixture.identity == updateNewIdentity)
        #expect(!fixture.events.contains("open:old"))
        #expect(result.sessions.allSatisfy { $0.step == .restored })
    }

    @Test("a lost restoration acknowledgement is partial, with no retry")
    func partialResume() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failResume = "session-1"
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .partialRestore)
        #expect(result.sessions.map(\.step) == [.uncertain, .restored])
        #expect(fixture.events.filter { $0 == "resume:session-1" }.count == 1)
    }

    @Test("a failed durable pause intent causes no shutdown")
    func pauseIntentWriteFailure() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failSaveOnceAt = .pausing
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .recoveryRequired)
        #expect(!fixture.events.contains { $0.hasPrefix("pause:") || $0.hasPrefix("resume:") || $0 == "install" })
    }

    @Test("a failed durable restore intent never opens an unrecorded duplicate")
    func restoreIntentWriteFailure() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failSaveOnceAt = .restoring
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .partialRestore)
        #expect(!fixture.events.contains("resume:session-1"))
        #expect(fixture.events.filter { $0 == "resume:session-2" }.count == 1)
        #expect(result.sessions.map(\.step) == [.uncertain, .restored])
    }

    @Test("an interrupted receipt write after publication preserves both app identities")
    func publishedRecordWriteFailure() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failSaveOnceAt = .published
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .recoveryRequired)
        #expect(fixture.identity == updateNewIdentity)
        #expect(result.backupURL == fixture.backup)
        #expect(!fixture.events.contains("open:old"))
        #expect(result.sessions.allSatisfy { $0.step == .restored })
    }

    @Test("interrupted transactions are reports, never implicit replay", arguments: [AppUpdateJournal.Phase.pausing, .installing, .restoring])
    func interrupted(_ phase: AppUpdateJournal.Phase) async throws {
        let fixture = UpdateTransactionFixture()
        var journal = try updateJournalFixture(); journal.phase = phase; journal.sessions[0].step = .restoring
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(journal)
        #expect(result.phase == .recoveryRequired)
        #expect(fixture.events.isEmpty)
    }

    @Test("Active or unreadable Claude use state blocks the advisory gate", arguments: [
        ClaudeRuntimePayloadUse.Status.inUse, .unavailable,
    ])
    func claudeAdvisoryFailsClosed(_ status: ClaudeRuntimePayloadUse.Status) throws {
        #expect(throws: AppInstallationError.self) { try AppClaudeRuntimeUpdateGuard.requireClear(status) }
        try AppClaudeRuntimeUpdateGuard.requireClear(.clear)
    }

    @Test("An active Claude registration prevents every Codex pause and installation")
    func claudeBlocksBeforeEffects() async throws {
        let fixture = UpdateTransactionFixture()
        fixture.blockedClaudeCheck = 1
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .failed)
        #expect(result.sessions.allSatisfy { $0.step == .pending })
        #expect(fixture.events == ["open:old"])
        #expect(result.detail.contains(AppInstallationError(.claudeRuntimeBlocked).userMessage))
    }

    @Test("Clear advisory becoming blocked during preflight is checked before the first pause")
    func claudeRaceBeforePause() async throws {
        let fixture = UpdateTransactionFixture()
        fixture.blockedClaudeCheck = 2
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .failed)
        #expect(fixture.claudeCheckCount == 2)
        #expect(result.sessions.allSatisfy { $0.step == .pending })
        #expect(fixture.events == ["verify", "preflight", "open:old"])
        #expect(!fixture.records.contains { $0.phase == .pausing || $0.phase == .installing })
    }

    @Test("A late Claude use blocks the next side effect and restores only already paused Codex", arguments: [3, 4])
    func claudeRaceAfterPause(_ blockedCheck: Int) async throws {
        let fixture = UpdateTransactionFixture()
        fixture.blockedClaudeCheck = blockedCheck
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(try updateJournalFixture())
        #expect(result.phase == .failed)
        #expect(!fixture.events.contains("install"))
        #expect(result.sessions[0].step == .restored)
        #expect(result.sessions[1].step == (blockedCheck == 3 ? .pending : .restored))
        #expect(result.sessions.map(\.value.id) == ["session-1", "session-2"])
        #expect(fixture.events.last == "open:old")
    }

    @Test("preserving update ignores managed registry count and never pauses or restores conversations")
    func preservedConnections() async throws {
        let fixture = UpdateTransactionFixture()
        fixture.current = [updateSession(1, state: .busy), updateSession(3, state: .starting)]
        let journal = try updateJournalFixture(sessions: [], preservingConnections: true)
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(journal)
        #expect(result.phase == .succeeded && result.sessions.isEmpty)
        #expect(fixture.events == ["verify", "preserve-preflight", "verify", "preserve-preflight", "install", "open:new", "health:new"])
        #expect(fixture.claudeCheckCount == 0)
        #expect(result.detail.contains("기존 대화는 종료하지 않았습니다"))
    }

    @Test("changed connection readiness prevents publication without session effects", arguments: [1, 2])
    func preservingPreflightFailsClosed(_ check: Int) async throws {
        let fixture = UpdateTransactionFixture(); fixture.blockedPreservedCheck = check
        let result = await AppUpdateTransactionEngine(effects: fixture.effects)
            .execute(try updateJournalFixture(sessions: [], preservingConnections: true))
        #expect(result.phase == .failed)
        #expect(!fixture.events.contains("install"))
        #expect(!fixture.events.contains { $0.hasPrefix("pause:") || $0.hasPrefix("resume:") })
        #expect(fixture.events.last == "open:old")
    }

    @Test("preserve schema cannot carry implicit legacy shutdown authority")
    func preserveSchemaRejectsSessions() async throws {
        let fixture = UpdateTransactionFixture()
        let journal = try updateJournalFixture(preservingConnections: true)
        #expect(throws: AppUpdateTransactionError.invalidJournal) { try journal.requireValid() }
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(journal)
        #expect(result.phase == .recoveryRequired && fixture.events.isEmpty)
    }

    @Test("a preserving update never falls back to an old app after new launch is uncertain")
    func preservingLaunchUncertain() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failNewLaunch = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects)
            .execute(try updateJournalFixture(sessions: [], preservingConnections: true))
        #expect(result.phase == .recoveryRequired && result.backupURL == fixture.backup)
        #expect(!fixture.events.contains("open:old"))
        #expect(!fixture.events.contains { $0.hasPrefix("pause:") || $0.hasPrefix("resume:") })
    }

    @Test("new process launch without a healthy new service is not update success")
    func preservingServiceUnconfirmed() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failServiceHealth = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects)
            .execute(try updateJournalFixture(sessions: [], preservingConnections: true))
        #expect(result.phase == .recoveryRequired && result.backupURL == fixture.backup)
        #expect(fixture.identity == updateNewIdentity)
        #expect(Array(fixture.events.suffix(2)) == ["open:new", "health:new"])
        #expect(!fixture.events.contains("open:old"))
        #expect(!fixture.records.contains { $0.phase == .succeeded })
        #expect(result.detail.contains("서비스가 정상 실행됐는지 확인하지 못했습니다"))
    }

    @Test("explicit normal shutdown rechecks closed connections and requires healthy relaunch")
    func userConfirmedShutdown() async throws {
        let fixture = UpdateTransactionFixture()
        let journal = try updateJournalFixture(sessions: [], userConfirmedClosure: true)
        try journal.requireValid()
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(journal)
        #expect(result.phase == .succeeded && result.sessions.isEmpty)
        #expect(fixture.events == ["verify", "preserve-preflight", "verify", "preserve-preflight", "install", "open:new", "health:new"])
        #expect(fixture.connectionPolicies == [.userConfirmedSessionClosure, .userConfirmedSessionClosure])
        #expect(result.detail.contains("업데이트와 재실행"))
        #expect(!result.detail.contains("복원"))
    }

    @Test("new connections or unfinished work block confirmed shutdown before publication", arguments: [1, 2])
    func confirmedShutdownRechecks(_ blockedCheck: Int) async throws {
        let fixture = UpdateTransactionFixture(); fixture.blockedPreservedCheck = blockedCheck
        let result = await AppUpdateTransactionEngine(effects: fixture.effects)
            .execute(try updateJournalFixture(sessions: [], userConfirmedClosure: true))
        #expect(result.phase == .failed)
        #expect(!fixture.events.contains("install"))
        #expect(!fixture.events.contains { $0.hasPrefix("pause:") || $0.hasPrefix("resume:") })
    }

    @Test("confirmation cannot grant legacy pause or resume authority")
    func confirmedShutdownRejectsSessionEffects() async throws {
        let fixture = UpdateTransactionFixture()
        let journal = try updateJournalFixture(userConfirmedClosure: true)
        #expect(throws: AppUpdateTransactionError.invalidJournal) { try journal.requireValid() }
        let result = await AppUpdateTransactionEngine(effects: fixture.effects).execute(journal)
        #expect(result.phase == .recoveryRequired && fixture.events.isEmpty)
    }

    @Test("a confirmed-shutdown update still requires the new service to be healthy")
    func confirmedShutdownRequiresService() async throws {
        let fixture = UpdateTransactionFixture(); fixture.failServiceHealth = true
        let result = await AppUpdateTransactionEngine(effects: fixture.effects)
            .execute(try updateJournalFixture(sessions: [], userConfirmedClosure: true))
        #expect(result.phase == .recoveryRequired && fixture.identity == updateNewIdentity)
        #expect(!fixture.records.contains { $0.phase == .succeeded })
        #expect(!fixture.events.contains("open:old"))
    }
}

@Suite("Updated app service health", .petLanguage(.korean)) @MainActor
struct AppUpdateLaunchedServiceHealthTests {
    private func status(pendingCards: Int = 0) throws -> AppUpdateServiceReadiness {
        try .parse(JSONSerialization.data(withJSONObject: [
            "schema_version": "1.0", "kind": "blabee_update_status", "ready": pendingCards == 0,
            "pending_approvals": 0, "pending_deliveries": 0, "pending_cards": pendingCards,
            "pending_queued_actions": 0, "pending_reconciliation": 0, "pending_claim_responses": 0,
            "pending_prompt_contexts": 0, "service_pid": 21, "service_parent_pid": 20,
        ]))
    }

    @Test("new pending work does not make an available new service unhealthy")
    func healthyMayBeBusy() async throws {
        let active = try status(pendingCards: 1)
        #expect(!active.ready)
        let health = AppUpdateLaunchedServiceHealth(probe: { identity in
            #expect(identity == updateNewIdentity)
            return active
        }, sleep: { _ in Issue.record("Healthy service must not wait for work to finish") })
        try await health.requireHealthy(expectedIdentity: updateNewIdentity)
    }

    @Test("service startup is checked again within a bounded read-only window")
    func eventuallyHealthy() async throws {
        let healthy = try status()
        var probes = 0
        var clock: TimeInterval = 0
        let health = AppUpdateLaunchedServiceHealth(probe: { _ in
            probes += 1
            if probes < 3 { throw UpdateTestFailure.injected }
            return healthy
        }, uptime: { clock }, sleep: { _ in clock += 0.5 })
        try await health.requireHealthy(expectedIdentity: updateNewIdentity)
        #expect(probes == 3 && clock == 1)
    }

    @Test("service startup timeout does not become success")
    func healthTimeout() async throws {
        var probes = 0
        var clock: TimeInterval = 0
        let health = AppUpdateLaunchedServiceHealth(probe: { _ in
            probes += 1; throw UpdateTestFailure.injected
        }, uptime: { clock }, sleep: { _ in clock += 0.5 }, timeout: 1)
        await #expect(throws: AppUpdateTransactionError.serviceHealthNotConfirmed) {
            try await health.requireHealthy(expectedIdentity: updateNewIdentity)
        }
        #expect(probes == 3 && clock == 1)
    }

    @Test("wrong signed identity or invalid status is rejected without retrying", arguments: [
        AppUpdateTransactionError.serviceHealthIdentityMismatch, .serviceHealthResponseInvalid,
    ])
    func unverifiedHealth(_ failure: AppUpdateTransactionError) async throws {
        let health = AppUpdateLaunchedServiceHealth(probe: { _ in throw failure },
            sleep: { _ in Issue.record("Invalid identity or shape must fail closed") })
        await #expect(throws: failure) { try await health.requireHealthy(expectedIdentity: updateNewIdentity) }
    }

    @Test("installed app, executing service and parent must all have the exact new identity")
    func exactIdentity() throws {
        try AppUpdateLaunchedServiceHealth.requireIdentity(expected: updateNewIdentity,
            installed: updateNewIdentity, service: updateNewIdentity, parent: updateNewIdentity)
        for component in 0..<3 {
            #expect(throws: AppUpdateTransactionError.serviceHealthIdentityMismatch) {
                try AppUpdateLaunchedServiceHealth.requireIdentity(expected: updateNewIdentity,
                    installed: component == 0 ? updateOldIdentity : updateNewIdentity,
                    service: component == 1 ? updateOldIdentity : updateNewIdentity,
                    parent: component == 2 ? nil : updateNewIdentity)
            }
        }
    }
}

@Suite("Update safe point and progress", .petLanguage(.korean)) @MainActor
struct AppUpdateSafePointTests {
    private let candidate = URL(fileURLWithPath: "/private/tmp/unused-Blabee.app")

    @Test("a transient pending request is inspected again and can become ready")
    func eventuallyReady() async throws {
        var attempts = 0
        var clock: TimeInterval = 0
        var reasons: [String] = []
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            attempts += 1
            if attempts < 3 { throw UpdateTestFailure.injected }
        }, isTransient: { _ in true }, uptime: { clock }, sleep: { _ in clock += 0.5 }, timeout: 30)
        try await waiter.wait(candidateApplicationURL: candidate, onWaiting: { reasons.append($0) })
        #expect(attempts == 3 && reasons.count == 2)
    }

    @Test("readiness waiting is bounded and does not call any approval or installer")
    func readinessTimeout() async throws {
        var attempts = 0
        var clock: TimeInterval = 0
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            attempts += 1; throw UpdateTestFailure.injected
        }, isTransient: { _ in true }, uptime: { clock }, sleep: { _ in clock += 0.5 }, timeout: 1)
        await #expect(throws: AppUpdateTransactionError.safePointTimedOut) {
            try await waiter.wait(candidateApplicationURL: candidate, onWaiting: { _ in })
        }
        #expect(attempts == 3 && clock == 1)
    }

    @Test("visible user-action waiting can continue beyond thirty seconds without restarting installation")
    func interactiveWaiting() async throws {
        var attempts = 0
        var clock: TimeInterval = 0
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            attempts += 1
            if attempts < 3 { throw AppUpdateTransitionError.waiting("Close the connection") }
        }, uptime: { clock }, sleep: { duration in
            #expect(duration == .seconds(2)); clock += 20
        })
        try await waiter.wait(candidateApplicationURL: candidate, waitForUser: true, onWaiting: { _ in })
        #expect(attempts == 3 && clock == 40)
    }

    @Test("an unresponsive service remains bounded even in the user-action window")
    func interactiveTransportTimeout() async throws {
        var attempts = 0
        var clock: TimeInterval = 0
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            attempts += 1; throw AppUpdateTransitionError.serviceUnavailable
        }, uptime: { clock }, sleep: { _ in clock += 20 })
        await #expect(throws: AppUpdateTransactionError.safePointTimedOut) {
            try await waiter.wait(candidateApplicationURL: candidate, waitForUser: true, onWaiting: { _ in })
        }
        #expect(attempts == 3 && clock == 40)
    }

    @Test("unsupported connection does not keep polling")
    func permanentBlocker() async throws {
        var attempts = 0
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            attempts += 1; throw UpdateTestFailure.injected
        }, isTransient: { _ in false }, sleep: { _ in Issue.record("Permanent blockers must not wait") })
        await #expect(throws: UpdateTestFailure.injected) {
            try await waiter.wait(candidateApplicationURL: candidate, onWaiting: { _ in Issue.record("Not transient") })
        }
        #expect(attempts == 1)
    }

    @Test("a late successful readiness response cannot authorize a cancelled update")
    func lateReadinessAfterCancellation() async throws {
        var generation = 1
        var continuation: CheckedContinuation<Void, Never>?
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            await withCheckedContinuation { continuation = $0 }
        }, isTransient: { _ in false })
        let request = generation
        let task = Task {
            try await waiter.wait(candidateApplicationURL: candidate,
                isCurrent: { request == generation }, onWaiting: { _ in })
        }
        while continuation == nil { await Task.yield() }
        generation += 1
        continuation?.resume()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test("a live but stalled helper is reported rather than displayed as progressing forever")
    func stalledProgress() throws {
        var journal = try updateJournalFixture(sessions: [], preservingConnections: true)
        journal.phase = .ready
        let updated = Date(timeIntervalSince1970: 100_000)
        journal.updatedAt = updated
        #expect(!AppUpdateProgressPolicy.isStalled(journal, now: updated.addingTimeInterval(44)))
        #expect(AppUpdateProgressPolicy.isStalled(journal, now: updated.addingTimeInterval(46)))
        journal.phase = .installing
        #expect(!AppUpdateProgressPolicy.isStalled(journal, now: updated.addingTimeInterval(599)))
        #expect(AppUpdateProgressPolicy.isStalled(journal, now: updated.addingTimeInterval(601)))
        journal.phase = .succeeded
        #expect(!AppUpdateProgressPolicy.isStalled(journal, now: updated.addingTimeInterval(100_000)))
    }

    @Test("a harmless concurrent request does not force the user to restart the update")
    func admissionRetriesReadOnlyCollision() async throws {
        let root = URL(fileURLWithPath: "/private/tmp/blabee-update-gate-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let request = try AppUpdateAdmissionGate.acquireRequest(directoryURL: root)
        defer { request.release() }
        var attempts = 0
        var clock: TimeInterval = 0
        let admission = try await AppUpdateHelper.acquireAdmissionWhenReady(candidateApplicationURL: candidate,
            acquire: {
                attempts += 1
                return try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: root)
            }, waiter: .init(requireReady: { _ in }, uptime: { clock }, sleep: { _ in
                request.release(); clock += 0.5
            }))
        defer { admission.release() }
        #expect(attempts == 2)
        #expect(throws: AppUpdateAdmissionError.busy) {
            _ = try AppUpdateAdmissionGate.acquireRequest(directoryURL: root)
        }
    }

    @Test("readiness retry releases the update gate so pending approvals can finish")
    func admissionReleasedBetweenReadinessChecks() async throws {
        let root = URL(fileURLWithPath: "/private/tmp/blabee-update-gate-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var checks = 0
        var clock: TimeInterval = 0
        let admission = try await AppUpdateHelper.acquireAdmissionWhenReady(candidateApplicationURL: candidate,
            acquire: { try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: root) },
            waiter: .init(requireReady: { _ in
                checks += 1
                if checks == 1 { throw AppUpdateAdmissionError.busy }
            }, uptime: { clock }, sleep: { _ in
                let pendingApproval = try AppUpdateAdmissionGate.acquireRequest(directoryURL: root)
                pendingApproval.release()
                clock += 0.5
            }))
        admission.release()
        #expect(checks == 2)
        let request = try AppUpdateAdmissionGate.acquireRequest(directoryURL: root)
        request.release()
    }
}

private actor UpdatePreparationFixture {
    let download: AppUpdatePreparedDownload
    var holdDownload = false
    var continuation: CheckedContinuation<AppUpdatePreparedDownload, Error>?
    var preparations = 0
    var cleanups = 0

    init(download: AppUpdatePreparedDownload) { self.download = download }
    func setHoldDownload() { holdDownload = true }
    func releaseFutureDownloads() { holdDownload = false }
    var isWaiting: Bool { continuation != nil }
    func prepare() async throws -> AppUpdatePreparedDownload {
        preparations += 1
        if holdDownload {
            return try await withCheckedThrowingContinuation { continuation = $0 }
        }
        return download
    }
    func finish() { continuation?.resume(returning: download); continuation = nil }
    func cleanup() { cleanups += 1 }
}

@Suite("Preserving update controller", .petLanguage(.korean)) @MainActor
struct AppUpdatePreservingControllerTests {
    private func fixture(waiter: AppUpdateSafePointWaiter = .init(requireReady: { _ in }),
                         closedWaiter: AppUpdateSafePointWaiter = .init(requireReady: { _ in }),
                         helper: ((AppUpdatePreparedDownload, AppUpdateConnectionPolicy) async throws -> Void)? = nil,
                         terminate: @escaping () -> Void = {}) throws
        -> (AppUpdateTransactionController, UpdatePreparationFixture, PetAppUpdateRelease) {
        let download = try updateJournalFixture(sessions: [], preservingConnections: true).download.prepared()
        let preparation = UpdatePreparationFixture(download: download)
        let current = try #require(PetAppUpdateVersion(version: "0.1.0", build: "40"))
        let controller = AppUpdateTransactionController(
            store: .init(rootURL: download.workRootURL.appendingPathComponent("unused-journal")),
            safePointWaiter: waiter,
            closedSessionsWaiter: closedWaiter,
            prepareDownload: { _ in try await preparation.prepare() },
            cleanupDownload: { _ in await preparation.cleanup() },
            installedVersion: { (version: current, identity: updateOldIdentity) },
            prepareHelper: helper, terminateApplication: terminate)
        return (controller, preparation, download.release)
    }

    @Test("a cancelled late download never changes the newer UI state")
    func lateDownloadAfterCancel() async throws {
        let (controller, preparation, release) = try fixture()
        await preparation.setHoldDownload()
        let request = Task { await controller.prepare(release) }
        while !(await preparation.isWaiting) { await Task.yield() }
        await controller.cancel()
        await preparation.finish()
        await request.value
        #expect(controller.phase == .idle && controller.preparedReview == nil)
        #expect(await preparation.cleanups == 1)
    }

    @Test("a late readiness reply cannot overwrite a newly prepared update or start its helper")
    func cancelledReadinessGeneration() async throws {
        var response: CheckedContinuation<Void, Never>?
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            await withCheckedContinuation { response = $0 }
        }, isTransient: { _ in false })
        let (controller, preparation, release) = try fixture(waiter: waiter)
        await controller.prepare(release)
        let attempt = Task { try await controller.beginInstallation() }
        while response == nil { await Task.yield() }
        #expect(controller.phase == .waitingForSafePoint && controller.canCancel)
        await controller.cancel()
        await controller.prepare(release)
        response?.resume()
        let began = try await attempt.value
        #expect(!began)
        #expect(controller.phase == .review && controller.canBeginInstallation)
        #expect(await preparation.preparations == 2)
    }

    @Test("unsupported connections defer after download and retries reuse the verified preparation")
    func deferredRetryDoesNotDownloadAgain() async throws {
        var readinessChecks = 0
        let waiter = AppUpdateSafePointWaiter(requireReady: { _ in
            readinessChecks += 1; throw UpdateTestFailure.injected
        }, isTransient: { _ in false })
        let (controller, preparation, release) = try fixture(waiter: waiter)
        await controller.prepare(release)
        #expect(controller.phase == .review && controller.preparedReview?.sessions.isEmpty == true)
        for _ in 0..<2 {
            await #expect(throws: UpdateTestFailure.injected) { try await controller.beginInstallation() }
            #expect(controller.phase == .deferred && controller.canBeginInstallation && controller.canCancel)
        }
        #expect(readinessChecks == 2)
        #expect(await preparation.preparations == 1)
    }

    @Test("download never confirms shutdown and duplicate confirmations start one helper")
    func explicitConfirmationAndSingleStart() async throws {
        var staged = 0
        var terminations = 0
        let (controller, preparation, release) = try fixture(helper: { _, policy in
            #expect(policy == .userConfirmedSessionClosure)
            staged += 1
        }, terminate: { terminations += 1 })
        controller.startInteractivePreparation(release)
        controller.startInteractivePreparation(release)
        while controller.phase != .review { await Task.yield() }
        #expect(staged == 0 && terminations == 0)
        #expect(await preparation.preparations == 1)
        controller.confirmClosedSessionsAndInstall()
        controller.confirmClosedSessionsAndInstall()
        while controller.phase != .updating { await Task.yield() }
        #expect(staged == 1 && terminations == 1)
        #expect(!controller.canCancel)
    }

    @Test("closing the window invalidates pending readiness before asynchronous cleanup")
    func closeCancelsReadiness() async throws {
        var response: CheckedContinuation<Void, Never>?
        var staged = 0
        var terminations = 0
        let (controller, _, release) = try fixture(closedWaiter: .init(requireReady: { _ in
            await withCheckedContinuation { response = $0 }
        }), helper: { _, _ in staged += 1 }, terminate: { terminations += 1 })
        controller.startInteractivePreparation(release)
        while controller.phase != .review { await Task.yield() }
        controller.confirmClosedSessionsAndInstall()
        while response == nil { await Task.yield() }
        #expect(controller.phase == .waitingForSessionExit && controller.canCancel)
        controller.cancelInteractiveUpdate()
        #expect(controller.phase == .idle && controller.preparedReview == nil)
        response?.resume()
        for _ in 0..<20 { await Task.yield() }
        #expect(controller.phase == .idle && staged == 0 && terminations == 0)
    }

    @Test("late cancelled download cannot start a newer preparation without fresh confirmation")
    func oldWorkflowCannotStartNewPreparation() async throws {
        var staged = 0
        var terminations = 0
        let (controller, oldPreparation, release) = try fixture(helper: { _, _ in staged += 1 },
            terminate: { terminations += 1 })
        await oldPreparation.setHoldDownload()
        controller.startInteractivePreparation(release)
        while !(await oldPreparation.isWaiting) { await Task.yield() }
        controller.cancelInteractiveUpdate()
        // The same fixture switches subsequent calls to immediate completion,
        // retaining the old pending response until the new review is ready.
        await oldPreparation.releaseFutureDownloads()
        controller.startInteractivePreparation(release)
        while controller.phase != .review { await Task.yield() }
        await oldPreparation.finish()
        for _ in 0..<20 { await Task.yield() }
        #expect(controller.phase == .review && staged == 0 && terminations == 0)
        controller.confirmClosedSessionsAndInstall()
        while controller.phase != .updating { await Task.yield() }
        #expect(staged == 1 && terminations == 1)
    }

    @Test("unverified connections report failure without repeatedly polling or terminating")
    func interactiveVerificationFailure() async throws {
        var inspections = 0
        var staged = 0
        var terminations = 0
        let (controller, _, release) = try fixture(closedWaiter: .init(requireReady: { _ in
            inspections += 1; throw AppUpdateTransitionError.unverified
        }), helper: { _, _ in staged += 1 }, terminate: { terminations += 1 })
        controller.startInteractivePreparation(release)
        while controller.phase != .review { await Task.yield() }
        controller.confirmClosedSessionsAndInstall()
        while controller.phase != .deferred { await Task.yield() }
        #expect(inspections == 1 && staged == 0 && terminations == 0)
        #expect(controller.detail.contains("확인하지 못해"))
    }
}

@Suite("Private update journal", .petLanguage(.korean))
struct AppUpdateJournalTests {
    private func fixture() throws -> (URL, AppUpdateJournalStore) {
        guard let physical = realpath(FileManager.default.temporaryDirectory.path, nil) else {
            throw AppUpdateTransactionError.unsafeJournal
        }
        defer { free(physical) }
        let root = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
            .appendingPathComponent("blabee-update-journal-test-" + UUID().uuidString, isDirectory: true)
        return (root, AppUpdateJournalStore(rootURL: root))
    }

    @Test("roundtrip is private, bounded and nonce-qualified")
    func roundtrip() throws {
        let (root, store) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let journal = try updateJournalFixture()
        try store.save(journal)
        #expect(try store.load(jobID: journal.jobID, nonce: journal.nonce) == journal)
        #expect(try store.latest() == journal)
        #expect(throws: AppUpdateTransactionError.invalidJournal) {
            _ = try store.load(jobID: journal.jobID, nonce: UUID().uuidString.lowercased())
        }
        var info = stat()
        #expect(lstat(root.path, &info) == 0)
        #expect(info.st_mode & 0o777 == 0o700)
        #expect(lstat(try store.journalURL(journal.jobID).path, &info) == 0)
        #expect(info.st_mode & 0o777 == 0o600)
    }

    @Test("schema 2 preserves conversations and retains legacy decoding without converting it")
    func preservingJournalRoundtrip() throws {
        let (root, store) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = try updateJournalFixture()
        try store.save(legacy)
        #expect(try !store.load(jobID: legacy.jobID).preservesConnections)
        let current = try updateJournalFixture(sessions: [], preservingConnections: true)
        try store.save(current)
        let loaded = try store.load(jobID: current.jobID)
        #expect(loaded == current && loaded.preservesConnections && loaded.sessions.isEmpty)
        #expect(loaded.helperApplicationURL.path.contains("helper-runtime-\(loaded.jobID)/Blabee.app"))
        let confirmed = try updateJournalFixture(sessions: [], userConfirmedClosure: true)
        try store.save(confirmed)
        let restored = try store.load(jobID: confirmed.jobID)
        #expect(restored == confirmed && restored.connectionPolicy == .userConfirmedSessionClosure)
        #expect(legacy.connectionPolicy == .preserve && loaded.connectionPolicy == .preserve)
    }

    @Test("physical private tmp path works while the tmp symlink alias remains refused")
    func physicalTemporaryRoot() throws {
        let name = "blabee-update-journal-physical-" + UUID().uuidString
        let root = URL(fileURLWithPath: "/private/tmp/" + name, isDirectory: true)
        let store = AppUpdateJournalStore(rootURL: root)
        defer { try? FileManager.default.removeItem(at: root) }
        let journal = try updateJournalFixture()
        try store.save(journal)
        #expect(try store.load(jobID: journal.jobID) == journal)
        let alias = AppUpdateJournalStore(rootURL: URL(fileURLWithPath: "/tmp/" + name, isDirectory: true))
        #expect(throws: AppUpdateTransactionError.unsafeJournal) {
            _ = try alias.load(jobID: journal.jobID)
        }
    }

    @Test("symlinked root and world-readable record are refused")
    func unsafePermissionsAndSymlink() throws {
        let (root, store) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let journal = try updateJournalFixture()
        try store.save(journal)
        let file = try store.journalURL(journal.jobID)
        #expect(chmod(file.path, 0o644) == 0)
        #expect(throws: AppUpdateTransactionError.unsafeJournal) { _ = try store.load(jobID: journal.jobID) }
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root)
        let linked = AppUpdateJournalStore(rootURL: link)
        #expect(throws: AppUpdateTransactionError.unsafeJournal) { _ = try linked.load(jobID: journal.jobID) }
    }

    @Test("only one detached helper owns the update lock")
    func exclusiveHelper() throws {
        let (root, store) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let lock = try store.acquireHelperLock()
        defer { withExtendedLifetime(lock) {} }
        #expect(throws: AppUpdateTransactionError.updateBusy) { _ = try store.acquireHelperLock() }
    }

    @Test("wrong job identity and arbitrary helper paths fail before writing")
    func mismatchedIdentity() throws {
        let (root, store) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let journal = try updateJournalFixture()
        #expect(throws: AppUpdateTransactionError.invalidJournal) {
            try journal.requireValid(jobID: UUID().uuidString.lowercased())
        }
        #expect(throws: AppUpdateTransactionError.invalidJournal) {
            _ = try store.journalURL("../../Applications/Blabee.app")
        }
    }
}

import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private let updateOldIdentity = "sha256:" + String(repeating: "a", count: 64)
private let updateNewIdentity = "sha256:" + String(repeating: "b", count: 64)
private enum UpdateTestFailure: Error { case injected }

private func updateSession(_ number: Int, state: UpdateManagedSessionState = .running) -> UpdateManagedSession {
    .init(id: "session-\(number)", threadID: String(format: "00000000-0000-0000-0000-%012d", number),
        cwd: "/private/tmp/project-\(number)", state: state, detail: nil)
}

private func updateJournalFixture(sessions: [UpdateManagedSession] = [updateSession(1), updateSession(2)]) throws -> AppUpdateJournal {
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
    return AppUpdateJournal(schema: 1, jobID: UUID().uuidString.lowercased(), nonce: UUID().uuidString.lowercased(),
        parentPID: getpid(), parentStartTime: 1, createdAt: Date(),
        previousIdentity: updateOldIdentity, candidateIdentity: updateNewIdentity,
        download: try .init(prepared), helperApplicationURL: root.appendingPathComponent("helper-runtime/Blabee.app", isDirectory: true),
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
            })
    }
}

@Suite("Automatic update transaction") @MainActor
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
}

@Suite("Private update journal")
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

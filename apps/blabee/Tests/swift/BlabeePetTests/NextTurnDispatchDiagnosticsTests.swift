import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Private next-turn dispatch diagnostics")
struct NextTurnDispatchDiagnosticsTests {
    @Test("An explicitly injected history preserves separate stages across restart")
    func restartPreservesStages() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        #expect(try store.load().isEmpty)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        let started = fixture.record(outcome: .started)
        let failed = fixture.record(outcome: .failed)
        try store.record(started)
        try store.record(failed)
        let restarted = fixture.store(build: "78")
        #expect(try restarted.load().map(\.dispatch) == [started, failed])
        #expect(try restarted.load().map(\.appBuild) == ["77", "77"])
        let accepted = fixture.record(id: "continuation_new", outcome: .accepted)
        try restarted.record(accepted)
        #expect(try store.load().map(\.dispatch) == [started, failed, accepted])
        #expect(try store.load().map(\.appBuild) == ["77", "77", "78"])
        #expect(try store.load().allSatisfy { $0.runtimeIdentity == fixture.runtimeIdentity })
        #expect(try fixture.permissions(fixture.directory) == 0o700)
        #expect(try fixture.permissions(fixture.file) == 0o600)
        #expect(try fixture.permissions(fixture.lockFile) == 0o600)
    }

    @Test("A valid queue receipt containing dot and colon survives restart")
    func acceptedQueueIdentifierSurvivesRestart() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let record = CoordinatorNextTurnDispatchRecord(continuationID: "continuation_test",
            sessionID: fixture.sessionID, occurredAt: fixture.timestamp, outcome: .accepted,
            queuedSubmissionID: "submission.1:queued")
        try fixture.store().record(record)
        #expect(try fixture.store().load().map(\.dispatch) == [record])
    }

    @Test("Queue receipt identifiers retain their first-character and length restrictions", arguments: [
        ".submission", ":submission", "_submission", "-submission", "submission/secret",
        "submission queued", "submission\nqueued", String(repeating: "a", count: 129),
    ])
    func rejectsInvalidQueueIdentifiers(identifier: String) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let record = CoordinatorNextTurnDispatchRecord(continuationID: "continuation_test",
            sessionID: fixture.sessionID, occurredAt: fixture.timestamp, outcome: .accepted,
            queuedSubmissionID: identifier)
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.invalidRecord) {
            try fixture.store().record(record)
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
    }

    @Test("Codex version and binary identity survive restart while older records may omit them", arguments: [true, false])
    func failureMetadataSurvivesRestart(includeMetadata: Bool) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let version = includeMetadata ? "0.157.1" : nil
        let identity = includeMetadata ? String(repeating: "b", count: 64) : nil
        let failure = CoordinatorNextTurnDispatchFailure(code: "codex_native_probe_timeout",
            stage: .qualification, commandInvocationAttempted: false, elapsedMilliseconds: 10_000,
            cachedFailure: true, codexVersion: version, executableIdentity: identity)
        let record = CoordinatorNextTurnDispatchRecord(continuationID: "continuation_test",
            sessionID: fixture.sessionID, occurredAt: fixture.timestamp, outcome: .failed, failure: failure)
        try fixture.store().record(record)
        let restored = try #require(fixture.store().load().first?.dispatch.failure)
        #expect(restored == failure)
        #expect(restored.codexVersion == version)
        #expect(restored.executableIdentity == identity)
    }

    @Test("Count and byte limits retain only the most recent observations")
    func boundedHistory() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        for index in 0..<(NextTurnDispatchDiagnostics.maximumRecords + 3) {
            try store.record(fixture.record(id: "continuation_\(index)"))
        }
        let entries = try store.load()
        #expect(entries.count == NextTurnDispatchDiagnostics.maximumRecords)
        #expect(entries.first?.dispatch.continuationID == "continuation_3")
        #expect(entries.last?.dispatch.continuationID == "continuation_130")
        #expect(try Data(contentsOf: fixture.file).count <= NextTurnDispatchDiagnostics.maximumBytes)
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).sorted()
                == [NextTurnDispatchDiagnostics.lockFileName, NextTurnDispatchDiagnostics.fileName].sorted())
    }

    @Test("Diagnostics allow only typed fields and sanitize non-diagnostic build metadata")
    func payloadPrivacy() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = NextTurnDispatchDiagnostics(directoryURL: fixture.directory,
            appBuild: "/Users/private/secret-token", runtimeIdentity: "env SECRET=value")
        let failure = CoordinatorNextTurnDispatchFailure(code: "stderr: secret-token; cat /Users/private/file",
            stage: .command, commandInvocationAttempted: true, elapsedMilliseconds: 30,
            codexVersion: "stderr: secret-token", executableIdentity: "/Users/private/file")
        try store.record(.init(continuationID: "continuation_test", sessionID: fixture.sessionID,
            occurredAt: fixture.timestamp, outcome: .failed, failure: failure))
        let entry = try #require(store.load().first)
        #expect(entry.appBuild == "unknown")
        #expect(entry.runtimeIdentity == nil)
        #expect(entry.dispatch.failure?.code == "next_turn_dispatch_failed")
        #expect(entry.dispatch.failure?.codexVersion == nil)
        #expect(entry.dispatch.failure?.executableIdentity == nil)
        let bytes = try Data(contentsOf: fixture.file)
        let text = String(decoding: bytes, as: UTF8.self)
        for privateValue in ["/Users/", "secret-token", "SECRET", "stderr", "cat "] {
            #expect(!text.contains(privateValue))
        }
        let root = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        #expect(Set(root.keys) == ["schemaVersion", "entries"])
        let rows = try #require(root["entries"] as? [[String: Any]])
        #expect(Set(rows[0].keys) == ["appBuild", "dispatch"])
    }

    @Test("Invalid identifiers and inconsistent outcomes are rejected before any file creation")
    func invalidRecordHasNoSideEffects() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        for id in ["", "command --flag", "../../secret", "x\nsecret", String(repeating: "a", count: 129)] {
            #expect(throws: NextTurnDispatchDiagnostics.StoreError.invalidRecord) {
                try store.record(fixture.record(id: id))
            }
        }
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.invalidRecord) {
            try store.record(.init(continuationID: "continuation_test", sessionID: fixture.sessionID,
                occurredAt: fixture.timestamp, outcome: .accepted))
        }
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.invalidRecord) {
            try store.record(.init(continuationID: "continuation_test", sessionID: fixture.sessionID,
                occurredAt: "2026-02-31T00:00:00Z", outcome: .started))
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
    }

    @Test("Symlinked directories, history and lock files cannot redirect IO", arguments: ["directory", "history", "lock"])
    func refusesSymlinks(target: String) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        let unrelated = fixture.root.appendingPathComponent("unrelated")
        let original = Data("untouched".utf8)
        try original.write(to: unrelated)
        if target == "directory" {
            try FileManager.default.createSymbolicLink(at: fixture.directory, withDestinationURL: fixture.root)
        } else {
            try store.record(fixture.record())
            let link = target == "history" ? fixture.file : fixture.lockFile
            try FileManager.default.removeItem(at: link)
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: unrelated)
        }
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.record(fixture.record()) }
        #expect(try Data(contentsOf: unrelated) == original)
    }

    @Test("Unsafe permissions are rejected without repairing or overwriting the file", arguments: ["directory", "history", "lock"])
    func refusesUnsafePermissions(target: String) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        try store.record(fixture.record())
        let original = try Data(contentsOf: fixture.file)
        let url = target == "directory" ? fixture.directory : target == "history" ? fixture.file : fixture.lockFile
        try FileManager.default.setAttributes([.posixPermissions: target == "directory" ? 0o755 : 0o644], ofItemAtPath: url.path)
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.record(fixture.record()) }
        #expect(try Data(contentsOf: fixture.file) == original)
    }

    @Test("The actual metadata validator rejects foreign owners and hard links without changing ownership")
    func refusesForeignOwnerMetadataAndHardLinks() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        try store.record(fixture.record())
        var fileInfo = stat()
        #expect(lstat(fixture.file.path, &fileInfo) == 0)
        fileInfo.st_uid = geteuid() == 0 ? 1 : 0
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.unavailable) {
            try NextTurnDispatchDiagnostics.validateFileMetadata(fileInfo)
        }
        var directoryInfo = stat()
        #expect(lstat(fixture.directory.path, &directoryInfo) == 0)
        directoryInfo.st_uid = fileInfo.st_uid
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.unavailable) {
            try NextTurnDispatchDiagnostics.validateDirectoryMetadata(directoryInfo)
        }
        #expect(link(fixture.file.path, fixture.root.appendingPathComponent("hard-link").path) == 0)
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.record(fixture.record()) }
    }

    @Test("Corruption and oversized files fail closed and are not overwritten", arguments: [false, true])
    func refusesCorruptOrOversizedHistory(oversized: Bool) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        try store.record(fixture.record())
        let corrupted = oversized ? Data(repeating: 32, count: NextTurnDispatchDiagnostics.maximumBytes + 1) : Data("{broken".utf8)
        try corrupted.write(to: fixture.file)
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.record(fixture.record()) }
        #expect(try Data(contentsOf: fixture.file) == corrupted)
    }

    @Test("Decoded files repeat code, range, type and exact-key checks", arguments: [
        "code", "elapsed", "extra", "schema", "sessionType", "metadata",
        "codexVersion", "codexVersionType", "executableIdentity", "executableIdentityType",
    ])
    func rejectsForgedDecodedData(field: String) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        try store.record(fixture.record(outcome: .failed))
        var root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: fixture.file)) as? [String: Any])
        var entries = try #require(root["entries"] as? [[String: Any]])
        var dispatch = try #require(entries[0]["dispatch"] as? [String: Any])
        var failure = try #require(dispatch["failure"] as? [String: Any])
        switch field {
        case "code": failure["code"] = "raw stderr /Users/private/token"
        case "elapsed": failure["elapsedMilliseconds"] = -1
        case "extra": failure["command"] = "cat /Users/private/token"
        case "sessionType": dispatch["sessionID"] = 42
        case "metadata": entries[0]["runtimeIdentity"] = "/Users/private/token"
        case "codexVersion": failure["codexVersion"] = "0.157.1 /Users/private/token"
        case "codexVersionType": failure["codexVersion"] = 157
        case "executableIdentity": failure["executableIdentity"] = String(repeating: "A", count: 64)
        case "executableIdentityType": failure["executableIdentity"] = 42
        default: dispatch["schemaVersion"] = 2
        }
        dispatch["failure"] = failure
        entries[0]["dispatch"] = dispatch
        root["entries"] = entries
        let forged = try JSONSerialization.data(withJSONObject: root)
        try forged.write(to: fixture.file)
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.invalidRecord) { try store.load() }
        #expect(throws: (any Error).self) { try store.record(fixture.record()) }
        #expect(try Data(contentsOf: fixture.file) == forged)
    }

    @Test("Oversized record arrays and duplicate JSON keys are not interpreted", arguments: [false, true])
    func rejectsInvalidHistoryShape(duplicateKeys: Bool) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        try store.record(fixture.record())
        let forged: Data
        if duplicateKeys {
            forged = Data("{\"schemaVersion\":1,\"schemaVersion\":1,\"entries\":[]}".utf8)
        } else {
            var root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: fixture.file)) as? [String: Any])
            let entries = try #require(root["entries"] as? [[String: Any]])
            root["entries"] = Array(repeating: entries[0], count: NextTurnDispatchDiagnostics.maximumRecords + 1)
            forged = try JSONSerialization.data(withJSONObject: root)
        }
        try forged.write(to: fixture.file)
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.invalidRecord) { try store.load() }
    }

    @Test("Concurrent callers of one sink preserve every observation without a lost update")
    func concurrentCallsAreSerialized() async throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let store = fixture.store()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<16 {
                group.addTask { try store.record(fixture.record(id: "continuation_\(index)")) }
            }
            try await group.waitForAll()
        }
        let entries = try store.load()
        #expect(entries.count == 16)
        #expect(Set(entries.map(\.dispatch.continuationID)).count == 16)
    }

    @Test("Interrupted writes reuse one bounded pending file and preserve the committed history")
    func recoversBoundedCrashPending() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let initial = fixture.record()
        try fixture.store().record(initial)
        let committed = try Data(contentsOf: fixture.file)
        // Simulate a killed writer's partial file. It is never interpreted as
        // authority or appended history; the next valid observation replaces it.
        try Data(repeating: 120, count: NextTurnDispatchDiagnostics.maximumBytes).write(to: fixture.pendingFile)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.pendingFile.path)
        #expect(try fixture.store().load().map(\.dispatch) == [initial])
        #expect(try Data(contentsOf: fixture.file) == committed)
        for index in 0..<3 {
            if index > 0 {
                try Data("partial-write".utf8).write(to: fixture.pendingFile)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.pendingFile.path)
            }
            try fixture.store().record(fixture.record(id: "continuation_after_crash_\(index)"))
            #expect(!FileManager.default.fileExists(atPath: fixture.pendingFile.path))
            #expect(try Data(contentsOf: fixture.file).count <= NextTurnDispatchDiagnostics.maximumBytes)
            #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).sorted()
                    == [NextTurnDispatchDiagnostics.lockFileName, NextTurnDispatchDiagnostics.fileName].sorted())
        }
        #expect(try fixture.store().load().count == 4)
    }

    @Test("Unsafe orphan files are not truncated and cannot replace committed history", arguments: ["symlink", "hardlink", "mode", "oversized"])
    func rejectsUnsafeCrashPending(kind: String) throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let initial = fixture.record()
        let store = fixture.store()
        try store.record(initial)
        let committed = try Data(contentsOf: fixture.file)
        let unrelated = fixture.root.appendingPathComponent("unrelated")
        let original = Data("untouched".utf8)
        try original.write(to: unrelated)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: unrelated.path)
        switch kind {
        case "symlink":
            try FileManager.default.createSymbolicLink(at: fixture.pendingFile, withDestinationURL: unrelated)
        case "hardlink":
            #expect(link(unrelated.path, fixture.pendingFile.path) == 0)
        case "oversized":
            try Data(repeating: 120, count: NextTurnDispatchDiagnostics.maximumBytes + 1).write(to: fixture.pendingFile)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.pendingFile.path)
        default:
            try original.write(to: fixture.pendingFile)
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: fixture.pendingFile.path)
        }
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.unavailable) {
            try store.record(fixture.record(outcome: .failed))
        }
        #expect(try store.load().map(\.dispatch) == [initial])
        #expect(try Data(contentsOf: fixture.file) == committed)
        #expect(try Data(contentsOf: unrelated) == original)
        #expect(FileManager.default.fileExists(atPath: fixture.pendingFile.path))
    }

    @Test("A separate instance refuses a busy lock and can record after the owner releases it")
    func lockContentionDoesNotOverwrite() throws {
        let fixture = try DispatchDiagnosticsFixture()
        defer { fixture.remove() }
        let first = fixture.store()
        try first.record(fixture.record())
        let file = open(fixture.lockFile.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
        guard file >= 0 else { throw NextTurnDispatchDiagnostics.StoreError.unavailable }
        defer { _ = flock(file, LOCK_UN); close(file) }
        #expect(flock(file, LOCK_EX | LOCK_NB) == 0)
        let second = fixture.store()
        #expect(throws: NextTurnDispatchDiagnostics.StoreError.busy) {
            try second.record(fixture.record(outcome: .failed))
        }
        #expect(flock(file, LOCK_UN) == 0)
        #expect(try first.load().count == 1)
        try second.record(fixture.record(outcome: .failed))
        #expect(try first.load().map(\.dispatch.outcome) == [.started, .failed])
    }
}

private struct DispatchDiagnosticsFixture: Sendable {
    let root: URL
    let sessionID = "01a01ece-22b8-7833-9ebf-8ef8d1addc58"
    let timestamp = "2026-09-29T01:00:00.123Z"
    let runtimeIdentity = "sha256:" + String(repeating: "a", count: 64)
    var directory: URL { root.appendingPathComponent("diagnostics/next-turn", isDirectory: true) }
    var file: URL { directory.appendingPathComponent(NextTurnDispatchDiagnostics.fileName) }
    var lockFile: URL { directory.appendingPathComponent(NextTurnDispatchDiagnostics.lockFileName) }
    var pendingFile: URL { directory.appendingPathComponent(NextTurnDispatchDiagnostics.pendingFileName) }

    init() throws {
        root = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-next-turn-diagnostics-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        // A directory exists only after recording; this parent also makes the
        // directory-symlink fixture exercise a genuine final component.
        try FileManager.default.createDirectory(at: root.appendingPathComponent("diagnostics"),
            withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }

    func store(build: String = "77") -> NextTurnDispatchDiagnostics {
        NextTurnDispatchDiagnostics(directoryURL: directory, appBuild: build, runtimeIdentity: runtimeIdentity)
    }

    func record(id: String = "continuation_test", outcome: CoordinatorNextTurnDispatchRecord.Outcome = .started)
        -> CoordinatorNextTurnDispatchRecord {
        .init(continuationID: id, sessionID: sessionID, occurredAt: timestamp, outcome: outcome,
            failure: outcome == .failed ? .init(code: "codex_native_probe_timeout", stage: .qualification,
                commandInvocationAttempted: false, elapsedMilliseconds: 10_000, cachedFailure: true) : nil,
            queuedSubmissionID: outcome == .accepted ? "019d0000-1111-7222-8333-444455556666" : nil)
    }

    func permissions(_ url: URL) throws -> Int? {
        try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int
    }

    func remove() { try? FileManager.default.removeItem(at: root) }
}

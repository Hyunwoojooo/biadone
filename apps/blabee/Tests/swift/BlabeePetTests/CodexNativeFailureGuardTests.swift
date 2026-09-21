import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private final class NativeFailureFixture {
    let root: URL
    let directory: URL
    let executable: URL

    init() throws {
        root = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-native-failure-\(UUID().uuidString)", isDirectory: true)
        directory = root.appendingPathComponent("failures", isDirectory: true)
        executable = root.appendingPathComponent("codex")
        try FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        try Data("fake executable; never launched".utf8).write(to: executable)
        guard chmod(executable.path, mode_t(0o700)) == 0 else {
            throw CoordinatorError("test_fixture_failed")
        }
    }

    deinit { try? FileManager.default.removeItem(at: root) }

    func makeGuard(revision: String = "native-v1") -> CodexNativeFailureGuard {
        CodexNativeFailureGuard(directoryURL: directory, policyRevision: revision)
    }

    func recordURLs() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("failure-") }
    }

    func recordFailure(code: String = "codex_native_execution_terminated") throws {
        #expect(throws: CoordinatorError(code)) {
            try makeGuard().withAttempt(executable: executable) {
                throw CoordinatorError(code)
            }
        }
    }
}

private final class NativeFailureCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = 0
    func increment() { lock.lock(); stored += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return stored }
}

private final class NativeFailureStorageFaults: @unchecked Sendable {
    enum Mode: Equatable { case unlink, directorySync, restoreFileSync }
    private let lock = NSLock()
    private let mode: Mode
    private var enabled = false
    private var directoryFailures = 0

    init(_ mode: Mode) { self.mode = mode }
    func arm() { lock.lock(); enabled = true; lock.unlock() }

    func inject(_ event: CodexNativeFailureGuard.StorageEvent) throws {
        lock.lock()
        defer { lock.unlock() }
        guard enabled else { return }
        switch event {
        case .unlinkRecord:
            if mode == .unlink { throw CoordinatorError("codex_native_guard_unavailable") }
        case .synchronizeDirectory:
            if mode != .unlink, directoryFailures == 0 {
                directoryFailures += 1
                throw CoordinatorError("codex_native_guard_unavailable")
            }
        case .synchronizeFile:
            if mode == .restoreFileSync {
                throw CoordinatorError("codex_native_guard_unavailable")
            }
        }
    }
}

@Suite("Durable native Codex failure suppression", .serialized)
struct CodexNativeFailureGuardTests {
    @Test("Failure persists across instances and records only safe negative evidence")
    func failurePersistsWithoutSensitiveDiagnostics() throws {
        let fixture = try NativeFailureFixture()
        var attempts = 0
        let code = "codex_native_version_unqualified"
        #expect(throws: CoordinatorError(code, "secret-session-token stdout")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) {
                attempts += 1
                throw CoordinatorError(code, "secret-session-token stdout")
            }
        }
        #expect(throws: CoordinatorError(code)) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        }
        #expect(attempts == 1)
        let record = try #require(try fixture.recordURLs().first)
        let bytes = try Data(contentsOf: record)
        let text = String(decoding: bytes, as: UTF8.self)
        #expect(!text.contains("secret"))
        #expect(!text.contains(fixture.executable.path))
        #expect(bytes.count <= 1_024)
        var info = stat()
        #expect(lstat(record.path, &info) == 0)
        #expect(info.st_mode & 0o777 == 0o600)
        #expect(info.st_nlink == 1)
    }

    @Test("Explicit retry allows one attempt and a new failure blocks again")
    func explicitRetryAndClear() throws {
        let fixture = try NativeFailureFixture()
        try fixture.recordFailure()
        var attempts = 0
        #expect(throws: CoordinatorError("codex_native_signature_invalid")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable, retry: true) {
                attempts += 1
                throw CoordinatorError("codex_native_signature_invalid")
            }
        }
        #expect(throws: CoordinatorError("codex_native_signature_invalid")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        }
        #expect(attempts == 1)
        try fixture.makeGuard().clearFailure(executable: fixture.executable)
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        #expect(attempts == 2)
        #expect(try fixture.recordURLs().isEmpty)
    }

    @Test("Clearing absent storage or executable creates no new state")
    func absentClearIsNoOp() throws {
        let fixture = try NativeFailureFixture()
        try fixture.makeGuard().clearFailure(executable: fixture.executable)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        try fixture.recordFailure()
        try FileManager.default.removeItem(at: fixture.executable)
        try fixture.makeGuard().clearFailure(executable: fixture.executable)
        #expect(try fixture.recordURLs().count == 1)
    }

    @Test("Replacing executable identity or policy invalidates the old failure")
    func replacementAndPolicyInvalidate() throws {
        let fixture = try NativeFailureFixture()
        try fixture.recordFailure()
        try Data("replacement binary".utf8).write(to: fixture.executable, options: .atomic)
        var attempts = 0
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        try fixture.recordFailure()
        try fixture.makeGuard(revision: "native-v2").withAttempt(executable: fixture.executable) {
            attempts += 1
        }
        #expect(attempts == 2)
        #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        }
        #expect(attempts == 2)
    }

    @Test("Mode changes invalidate cached file identity")
    func metadataInvalidates() throws {
        let fixture = try NativeFailureFixture()
        try fixture.recordFailure()
        #expect(chmod(fixture.executable.path, mode_t(0o500)) == 0)
        var attempts = 0
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        #expect(attempts == 1)
    }

    @Test("Symlink aliases share failures while a changed symlink target is rechecked")
    func canonicalAliasesAndRetargeting() throws {
        let fixture = try NativeFailureFixture()
        let alias = fixture.root.appendingPathComponent("codex-alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.executable)
        try fixture.recordFailure()
        var attempts = 0
        #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
            try fixture.makeGuard().withAttempt(executable: alias) { attempts += 1 }
        }
        let replacement = fixture.root.appendingPathComponent("new-codex")
        try Data("new target".utf8).write(to: replacement)
        try FileManager.default.removeItem(at: alias)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: replacement)
        try fixture.makeGuard().withAttempt(executable: alias) { attempts += 1 }
        #expect(attempts == 1)
    }

    @Test("Failure from a replaced executable never blocks its replacement")
    func changedDuringAttemptDoesNotCacheOldFailure() throws {
        let fixture = try NativeFailureFixture()
        #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) {
                try Data("changed during attempt".utf8).write(to: fixture.executable, options: .atomic)
                throw CoordinatorError("codex_native_execution_terminated")
            }
        }
        var attempts = 0
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        #expect(attempts == 1)
    }

    @Test("Success never grants persisted permission and non-native failures are not cached")
    func noPositiveCacheOrUnrelatedFailureCache() throws {
        let fixture = try NativeFailureFixture()
        var attempts = 0
        for _ in 0..<2 {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        }
        #expect(throws: CoordinatorError("unrelated_failure")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) {
                attempts += 1
                throw CoordinatorError("unrelated_failure")
            }
        }
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        #expect(attempts == 4)
        #expect(try fixture.recordURLs().isEmpty)
    }

    @Test("An uncertain durable record precedes callback entry and survives as a block")
    func uncertainAttemptBlocksAutomaticRetry() throws {
        let fixture = try NativeFailureFixture()
        #expect(throws: CoordinatorError("codex_native_execution_uncertain")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) {
                let record = try #require(try fixture.recordURLs().first)
                let contents = try String(contentsOf: record, encoding: .utf8)
                #expect(contents.contains("codex_native_execution_uncertain"))
                throw CoordinatorError("codex_native_execution_uncertain")
            }
        }
        var attempted = false
        #expect(throws: CoordinatorError("codex_native_execution_uncertain")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempted = true }
        }
        #expect(!attempted)
    }

    @Test("Concurrent instances execute a failing native operation only once")
    func concurrentInstancesSuppressDuplicates() throws {
        let fixture = try NativeFailureFixture()
        let first = fixture.makeGuard()
        let second = fixture.makeGuard()
        let executable = fixture.executable
        let attempts = NativeFailureCounter()
        DispatchQueue.concurrentPerform(iterations: 12) { index in
            do {
                try (index % 2 == 0 ? first : second).withAttempt(executable: executable) {
                    attempts.increment()
                    usleep(20_000)
                    throw CoordinatorError("codex_native_execution_terminated")
                }
                Issue.record("A failing operation unexpectedly succeeded")
            } catch let error as CoordinatorError {
                #expect(error.code == "codex_native_execution_terminated")
            } catch { Issue.record("Unexpected error: \(error)") }
        }
        #expect(attempts.value == 1)
    }

    @Test("Symlink and hardlink record redirection fails before callback")
    func unsafeRecordLinksFailClosed() throws {
        for useHardlink in [false, true] {
            let fixture = try NativeFailureFixture()
            try fixture.recordFailure()
            let record = try #require(try fixture.recordURLs().first)
            let target = fixture.root.appendingPathComponent("outside-record")
            try FileManager.default.moveItem(at: record, to: target)
            if useHardlink {
                try FileManager.default.linkItem(at: target, to: record)
            } else {
                try FileManager.default.createSymbolicLink(at: record, withDestinationURL: target)
            }
            let original = try Data(contentsOf: target)
            var attempted = false
            #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
                try fixture.makeGuard().withAttempt(executable: fixture.executable, retry: true) {
                    attempted = true
                }
            }
            #expect(!attempted)
            #expect(try Data(contentsOf: target) == original)
        }
    }

    @Test("Unsafe directory permissions and symlink ancestors fail closed")
    func unsafeDirectoriesFailClosed() throws {
        for symlinked in [false, true] {
            let fixture = try NativeFailureFixture()
            if symlinked {
                let target = fixture.root.appendingPathComponent("target", isDirectory: true)
                try FileManager.default.createDirectory(
                    at: target, withIntermediateDirectories: false,
                    attributes: [.posixPermissions: 0o700]
                )
                try FileManager.default.createSymbolicLink(at: fixture.directory, withDestinationURL: target)
            } else {
                #expect(chmod(fixture.root.path, mode_t(0o777)) == 0)
            }
            var attempted = false
            #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
                try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempted = true }
            }
            #expect(!attempted)
        }
    }

    @Test("Corrupt, oversized and public records fail closed even on explicit retry")
    func invalidRecordsFailClosed() throws {
        for variant in 0..<3 {
            let fixture = try NativeFailureFixture()
            try fixture.recordFailure()
            let record = try #require(try fixture.recordURLs().first)
            if variant == 0 { try Data("{broken".utf8).write(to: record) }
            if variant == 1 { try Data(repeating: 0x41, count: 1_025).write(to: record) }
            if variant == 2 { #expect(chmod(record.path, mode_t(0o644)) == 0) }
            var attempted = false
            #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
                try fixture.makeGuard().withAttempt(executable: fixture.executable, retry: true) {
                    attempted = true
                }
            }
            #expect(!attempted)
        }
    }

    @Test("Capacity is bounded without evicting evidence for a blocked executable")
    func capacityFailsClosedWithoutEviction() throws {
        let fixture = try NativeFailureFixture()
        for index in 0..<32 {
            let executable = fixture.root.appendingPathComponent("codex-\(index)")
            try Data("fake \(index)".utf8).write(to: executable)
            #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
                try fixture.makeGuard().withAttempt(executable: executable) {
                    throw CoordinatorError("codex_native_execution_terminated")
                }
            }
        }
        var attempted = false
        #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempted = true }
        }
        #expect(!attempted)
        #expect(try fixture.recordURLs().count == 32)
        try fixture.makeGuard().clearFailure(executable: fixture.executable)
        #expect(try fixture.recordURLs().count == 32)
        let first = fixture.root.appendingPathComponent("codex-0")
        #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
            try fixture.makeGuard().withAttempt(executable: first) { attempted = true }
        }
        #expect(!attempted)
    }

    @Test("Known success survives unlink and fsync failures without another callback")
    func successfulResultSurvivesCleanupFailure() throws {
        let modes: [NativeFailureStorageFaults.Mode] = [.unlink, .directorySync, .restoreFileSync]
        for mode in modes {
            for recovery in ["retry", "clear", "reset"] {
                let fixture = try NativeFailureFixture()
                let faults = NativeFailureStorageFaults(mode)
                let guardWithFault = CodexNativeFailureGuard(
                    directoryURL: fixture.directory,
                    storageFault: { try faults.inject($0) }
                )
                var attempts = 0
                let result = try guardWithFault.withAttempt(executable: fixture.executable) {
                    attempts += 1
                    faults.arm()
                    return "queue accepted"
                }
                #expect(result == "queue accepted")
                #expect(attempts == 1)
                // The final variant leaves only process-local evidence: unlink
                // succeeded, directory fsync and then restoration fsync failed.
                #expect(try fixture.recordURLs().count == (mode == .restoreFileSync ? 0 : 1))
                let reopened = fixture.makeGuard()
                #expect(throws: CoordinatorError("codex_native_execution_uncertain")) {
                    try reopened.withAttempt(executable: fixture.executable) { attempts += 1 }
                }
                #expect(attempts == 1)
                if recovery == "reset" {
                    try reopened.resetAllFailures()
                    try reopened.withAttempt(executable: fixture.executable) { attempts += 1 }
                } else if recovery == "clear" {
                    try reopened.clearFailure(executable: fixture.executable)
                    try reopened.withAttempt(executable: fixture.executable) { attempts += 1 }
                } else {
                    try reopened.withAttempt(executable: fixture.executable, retry: true) { attempts += 1 }
                }
                #expect(attempts == 2)
                #expect(try fixture.recordURLs().isEmpty)
            }
        }
    }

    @Test("Changed executable invalidates process-local uncertainty after failed restoration")
    func replacementInvalidatesCleanupUncertainty() throws {
        let fixture = try NativeFailureFixture()
        let faults = NativeFailureStorageFaults(.restoreFileSync)
        let guarded = CodexNativeFailureGuard(
            directoryURL: fixture.directory,
            storageFault: { try faults.inject($0) }
        )
        var attempts = 0
        let result = try guarded.withAttempt(executable: fixture.executable) {
            attempts += 1
            faults.arm()
            return 42
        }
        #expect(result == 42)
        try Data("replacement after cleanup failure".utf8)
            .write(to: fixture.executable, options: .atomic)
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempts += 1 }
        #expect(attempts == 2)
    }

    @Test("New directory parent fsync failure prevents callback entry")
    func newDirectoryMustBeDurableBeforeEntry() throws {
        let fixture = try NativeFailureFixture()
        let guarded = CodexNativeFailureGuard(
            directoryURL: fixture.directory,
            storageFault: { event in
                if case .synchronizeDirectory = event {
                    throw CoordinatorError("codex_native_guard_unavailable")
                }
            }
        )
        var attempted = false
        #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
            try guarded.withAttempt(executable: fixture.executable) { attempted = true }
        }
        #expect(!attempted)
        #expect(try fixture.recordURLs().isEmpty)
    }

    @Test("An exhausted store of vanished paths recovers only through explicit reset")
    func explicitResetRecoversVanishedPathsAndOldPolicies() throws {
        let fixture = try NativeFailureFixture()
        var callbacks = 0
        for index in 0..<32 {
            let executable = fixture.root.appendingPathComponent("vanished-\(index)")
            try Data("fake".utf8).write(to: executable)
            #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
                try fixture.makeGuard(revision: "old-policy").withAttempt(executable: executable) {
                    callbacks += 1
                    throw CoordinatorError("codex_native_execution_terminated")
                }
            }
            try FileManager.default.removeItem(at: executable)
        }
        #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
            try fixture.makeGuard().withAttempt(executable: fixture.executable) { callbacks += 1 }
        }
        #expect(callbacks == 32)
        try fixture.makeGuard().resetAllFailures()
        #expect(callbacks == 32)
        #expect(try fixture.recordURLs().isEmpty)
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { callbacks += 1 }
        #expect(callbacks == 33)
    }

    @Test("Reset validates every record before deleting any and preserves other stores")
    func resetValidatesUpfrontAndStaysScoped() throws {
        let fixture = try NativeFailureFixture()
        let other = try NativeFailureFixture()
        try fixture.recordFailure()
        try other.recordFailure()
        let second = fixture.root.appendingPathComponent("second-codex")
        try Data("second".utf8).write(to: second)
        #expect(throws: CoordinatorError("codex_native_signature_invalid")) {
            try fixture.makeGuard().withAttempt(executable: second) {
                throw CoordinatorError("codex_native_signature_invalid")
            }
        }
        let records = try fixture.recordURLs().sorted { $0.lastPathComponent < $1.lastPathComponent }
        let first = try #require(records.first)
        let last = try #require(records.last)
        #expect(records.count == 2)
        let original = try Data(contentsOf: first)
        #expect(chmod(last.path, mode_t(0o644)) == 0)
        #expect(throws: CoordinatorError("codex_native_guard_unavailable")) {
            try fixture.makeGuard().resetAllFailures()
        }
        #expect(try Data(contentsOf: first) == original)
        #expect(try fixture.recordURLs().count == 2)
        #expect(chmod(last.path, mode_t(0o600)) == 0)
        try fixture.makeGuard().resetAllFailures()
        #expect(try fixture.recordURLs().isEmpty)
        #expect(throws: CoordinatorError("codex_native_execution_terminated")) {
            try other.makeGuard().withAttempt(executable: other.executable) {
                Issue.record("Reset escaped its storage directory")
            }
        }
    }

    @Test("In-process contention respects a short wait budget without recording failure")
    func semaphoreContentionUsesRemainingBudget() throws {
        let fixture = try NativeFailureFixture()
        var innerAttempted = false
        try fixture.makeGuard().withAttempt(executable: fixture.executable) {
            let start = DispatchTime.now().uptimeNanoseconds
            #expect(throws: CoordinatorError("codex_native_execution_in_progress")) {
                try fixture.makeGuard().withAttempt(
                    executable: fixture.executable, waitTimeoutMilliseconds: 5
                ) { innerAttempted = true }
            }
            let elapsed = DispatchTime.now().uptimeNanoseconds - start
            #expect(elapsed < 250_000_000)
        }
        #expect(!innerAttempted)
        #expect(try fixture.recordURLs().isEmpty)
    }

    @Test("An independent process lock prevents entry and permits recovery after release")
    func crossProcessLockSuppressesEntry() throws {
        let fixture = try NativeFailureFixture()
        try fixture.makeGuard().withAttempt(executable: fixture.executable) {}
        let child = Process()
        let ready = Pipe()
        let release = Pipe()
        child.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
        child.arguments = [
            "-e",
            """
            open(my $lock, '+<', $ARGV[0]) or die "open";
            flock($lock, 2) or die "lock";
            $| = 1;
            print "locked\\n";
            scalar <STDIN>;
            """,
            fixture.directory.appendingPathComponent(".lock").path,
        ]
        child.standardOutput = ready
        child.standardInput = release
        child.standardError = FileHandle.nullDevice
        try child.run()
        defer {
            if child.isRunning {
                try? release.fileHandleForWriting.write(contentsOf: Data([10]))
                try? release.fileHandleForWriting.close()
                child.waitUntilExit()
            }
        }
        let signal = try ready.fileHandleForReading.read(upToCount: 7)
        #expect(signal == Data("locked\n".utf8))
        var attempted = false
        let start = DispatchTime.now().uptimeNanoseconds
        #expect(throws: CoordinatorError("codex_native_execution_in_progress")) {
            try fixture.makeGuard().withAttempt(
                executable: fixture.executable, waitTimeoutMilliseconds: 25
            ) { attempted = true }
        }
        let elapsed = DispatchTime.now().uptimeNanoseconds - start
        #expect(elapsed < 500_000_000)
        #expect(try fixture.recordURLs().isEmpty)
        #expect(!attempted)
        try release.fileHandleForWriting.write(contentsOf: Data([10]))
        try release.fileHandleForWriting.close()
        child.waitUntilExit()
        #expect(child.terminationStatus == 0)
        try fixture.makeGuard().withAttempt(executable: fixture.executable) { attempted = true }
        #expect(attempted)
    }
}

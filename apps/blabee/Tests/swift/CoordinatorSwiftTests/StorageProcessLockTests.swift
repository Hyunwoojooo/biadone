import Darwin
import Foundation
import Testing
@testable import CoordinatorSwift

private struct ProcessLockFixture: Sendable {
    let root: URL
    var key: URL { root.appendingPathComponent("coordinator.key") }
    var file: URL { root.appendingPathComponent(".blabee-coordinator-freshness.lock") }

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-process-lock-test-\(UUID().uuidString)")
            .resolvingSymlinksInPath()
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
    }

    func clean() { try? FileManager.default.removeItem(at: root) }

    func openFile() throws -> Int32 {
        let descriptor = open(file.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        return try #require(descriptor >= 0 ? descriptor : nil)
    }

    func lock(
        clock: ProcessLockClock,
        timeout: Duration = .milliseconds(12),
        onPause: @escaping @Sendable () -> Void = {}
    ) throws -> StorageProcessLock {
        try StorageProcessLock(
            keyURL: key,
            allowParentCreation: false,
            acquisitionTimeout: timeout,
            now: { clock.now() },
            pause: { duration in
                clock.pause(duration)
                onPause()
            }
        )
    }
}

private final class ProcessLockClock: @unchecked Sendable {
    private let mutex = NSLock()
    private let origin = ContinuousClock.now
    private var elapsed: Duration = .zero
    private var delays: [Duration] = []

    func now() -> ContinuousClock.Instant {
        mutex.lock()
        defer { mutex.unlock() }
        return origin.advanced(by: elapsed)
    }

    func pause(_ duration: Duration) {
        mutex.lock()
        defer { mutex.unlock() }
        elapsed += duration
        delays.append(duration)
    }

    var pauses: [Duration] {
        mutex.lock()
        defer { mutex.unlock() }
        return delays
    }
}

private final class ProcessMutexHolder: @unchecked Sendable {
    private let entered = DispatchSemaphore(value: 0)
    private let release = DispatchSemaphore(value: 0)
    private let finished = DispatchSemaphore(value: 0)
    private var stopped = false

    init(_ writer: StorageProcessLock) throws {
        DispatchQueue.global().async { [self] in
            defer { finished.signal() }
            do {
                try writer.withLock {
                    entered.signal()
                    #expect(release.wait(timeout: .now() + 5) == .success)
                }
            } catch {
                Issue.record("Could not hold the test process mutex: \(error)")
                entered.signal()
            }
        }
        try #require(entered.wait(timeout: .now() + 5) == .success)
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        release.signal()
        #expect(finished.wait(timeout: .now() + 5) == .success)
    }
}

/// A separate process owns only this fixture's lock; stdin EOF releases it.
private final class ExternalProcessLockHolder: @unchecked Sendable {
    private let process = Process()
    private let input = Pipe()
    private var started = false
    private var stopped = false

    init(file: URL) throws {
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-I", "-u", "-c", """
        import fcntl, os, signal, sys
        signal.alarm(10)
        fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sys.stdout.buffer.write(b'L')
        sys.stdout.buffer.flush()
        sys.stdin.buffer.read(1)
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        """, file.path]
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        started = true
        let ready = output.fileHandleForReading.readData(ofLength: 1)
        guard ready == Data([0x4c]) else {
            stop()
            throw CoordinatorError("test_external_lock_unavailable")
        }
    }

    func stop() {
        guard started, !stopped else { return }
        stopped = true
        input.fileHandleForWriting.closeFile()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
    }

    deinit { stop() }
}

private func processLockExpect(_ code: String, operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("Expected \(code)")
    } catch let error as CoordinatorError {
        #expect(error.code == code)
    } catch {
        Issue.record("Unexpected storage lock error: \(error)")
    }
}

private func processLockRun(
    _ lock: StorageProcessLock,
    nonblocking: Bool,
    operation: () throws -> Void
) throws {
    if nonblocking {
        try lock.withNonblockingLock { _ in try operation() }
    } else {
        try lock.withLock(operation)
    }
}

@Test("Process mutex contention expires without later invoking the operation")
func storageProcessLockBoundsProcessMutexWait() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let writer = try StorageProcessLock(keyURL: fixture.key, allowParentCreation: false)
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock)
    var calls = 0

    try writer.withLock {
        processLockExpect("freshness_lock_busy") {
            try contender.withLock { calls += 1 }
        }
    }
    #expect(clock.pauses == [.milliseconds(5), .milliseconds(5), .milliseconds(2)])
    #expect(calls == 0)
    try contender.withLock { calls += 1 }
    #expect(calls == 1)
}

@Test("An external flock owner expires the same bounded acquisition budget")
func storageProcessLockBoundsExternalFileLockWait() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let holder = try ExternalProcessLockHolder(file: fixture.file)
    defer { holder.stop() }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock)
    var calls = 0

    processLockExpect("freshness_lock_busy") {
        try contender.withLock { calls += 1 }
    }
    #expect(clock.pauses == [.milliseconds(5), .milliseconds(5), .milliseconds(2)])
    holder.stop()
    #expect(calls == 0)
    try contender.withLock { calls += 1 }
    #expect(calls == 1)
}

@Test("Releasing an external file lock before the deadline invokes the operation once")
func storageProcessLockSucceedsAfterExternalRelease() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let holder = try ExternalProcessLockHolder(file: fixture.file)
    defer { holder.stop() }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock) { holder.stop() }
    var calls = 0

    let result = try contender.withLock { calls += 1; return 42 }
    #expect(result == 42)
    #expect(calls == 1)
    #expect(clock.pauses == [.milliseconds(5)])
}

@Test("Process mutex and file lock waits share one deadline")
func storageProcessLockSharesAcquisitionDeadline() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let descriptor = try fixture.openFile()
    defer { close(descriptor) }
    defer { _ = flock(descriptor, LOCK_UN) }
    let writer = try StorageProcessLock(keyURL: fixture.key, allowParentCreation: false)
    let holder = try ProcessMutexHolder(writer)
    defer { holder.stop() }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock) {
        if clock.pauses.count == 1 {
            holder.stop()
            #expect(flock(descriptor, LOCK_EX | LOCK_NB) == 0)
        }
    }
    var calls = 0

    processLockExpect("freshness_lock_busy") {
        try contender.withLock { calls += 1 }
    }
    #expect(clock.pauses == [.milliseconds(5), .milliseconds(5), .milliseconds(2)])
    #expect(calls == 0)
}

@Test("Releasing a process mutex before its deadline permits one operation")
func storageProcessLockSucceedsAfterProcessMutexRelease() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let writer = try StorageProcessLock(keyURL: fixture.key, allowParentCreation: false)
    let holder = try ProcessMutexHolder(writer)
    defer { holder.stop() }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock) { holder.stop() }
    var calls = 0

    try contender.withLock { calls += 1 }
    #expect(clock.pauses == [.milliseconds(5)])
    #expect(calls == 1)
}

@Test("A lock released exactly at the deadline never invokes its timed-out operation")
func storageProcessLockRejectsReleaseAtDeadline() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let descriptor = try fixture.openFile()
    defer { close(descriptor) }
    try #require(flock(descriptor, LOCK_EX | LOCK_NB) == 0)
    defer { _ = flock(descriptor, LOCK_UN) }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock, timeout: .milliseconds(5)) {
        #expect(flock(descriptor, LOCK_UN) == 0)
    }
    var calls = 0

    processLockExpect("freshness_lock_busy") {
        try contender.withLock { calls += 1 }
    }
    #expect(clock.pauses == [.milliseconds(5)])
    #expect(calls == 0)
    try contender.withLock { calls += 1 }
    #expect(calls == 1)
}

@Test("Nonblocking recovery does not sleep for an in-process owner")
func storageProcessLockNonblockingRefusesProcessMutex() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let writer = try StorageProcessLock(keyURL: fixture.key, allowParentCreation: false)
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock)
    var calls = 0

    try writer.withLock {
        processLockExpect("freshness_lock_busy") {
            try contender.withNonblockingLock { _ in calls += 1 }
        }
    }
    #expect(clock.pauses.isEmpty)
    #expect(calls == 0)
}

@Test("Nonblocking recovery does not sleep for an external flock owner")
func storageProcessLockNonblockingRefusesExternalFileLock() throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let holder = try ExternalProcessLockHolder(file: fixture.file)
    defer { holder.stop() }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock)
    var calls = 0

    processLockExpect("freshness_lock_busy") {
        try contender.withNonblockingLock { _ in calls += 1 }
    }
    #expect(clock.pauses.isEmpty)
    #expect(calls == 0)
}

@Test("Both acquisition modes release a thrown operation without retrying it", arguments: [false, true])
func storageProcessLockDoesNotRetryOperation(nonblocking: Bool) throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock)
    var calls = 0

    processLockExpect("test_operation_failed") {
        try processLockRun(contender, nonblocking: nonblocking) {
            calls += 1
            throw CoordinatorError("test_operation_failed")
        }
    }
    #expect(calls == 1)
    try processLockRun(contender, nonblocking: nonblocking) { calls += 1 }
    #expect(calls == 2)
    #expect(clock.pauses.isEmpty)
}

private enum ProcessLockFileChange: CaseIterable, Sendable {
    case permissions, hardLink, replacement, symlink

    func apply(to file: URL) {
        let sibling = file.deletingLastPathComponent().appendingPathComponent("other-lock")
        switch self {
        case .permissions:
            #expect(chmod(file.path, mode_t(0o644)) == 0)
        case .hardLink:
            #expect(link(file.path, sibling.path) == 0)
        case .replacement, .symlink:
            #expect(rename(file.path, sibling.path) == 0)
            if self == .symlink {
                #expect(Darwin.symlink(sibling.path, file.path) == 0)
            } else {
                let descriptor = open(file.path, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, mode_t(0o600))
                #expect(descriptor >= 0)
                if descriptor >= 0 { close(descriptor) }
            }
        }
    }
}

@Test("Files changed during flock contention are refused after acquisition", arguments: ProcessLockFileChange.allCases)
private func storageProcessLockRevalidatesFileAfterWait(change: ProcessLockFileChange) throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let descriptor = try fixture.openFile()
    defer { close(descriptor) }
    try #require(flock(descriptor, LOCK_EX | LOCK_NB) == 0)
    defer { _ = flock(descriptor, LOCK_UN) }
    let clock = ProcessLockClock()
    let contender = try fixture.lock(clock: clock) {
        change.apply(to: fixture.file)
        #expect(flock(descriptor, LOCK_UN) == 0)
    }
    var calls = 0

    processLockExpect("freshness_lock_unavailable") {
        try contender.withLock { calls += 1 }
    }
    #expect(clock.pauses == [.milliseconds(5)])
    #expect(calls == 0)
}

@Test("Both acquisition modes reject unsafe files before invoking the operation", arguments: [false, true])
func storageProcessLockRejectsUnsafeFiles(nonblocking: Bool) throws {
    for change in [ProcessLockFileChange.permissions, .hardLink, .symlink] {
        let fixture = try ProcessLockFixture()
        defer { fixture.clean() }
        let descriptor = try fixture.openFile()
        close(descriptor)
        change.apply(to: fixture.file)
        let clock = ProcessLockClock()
        let contender = try fixture.lock(clock: clock)
        var calls = 0

        processLockExpect("freshness_lock_unavailable") {
            try processLockRun(contender, nonblocking: nonblocking) { calls += 1 }
        }
        #expect(calls == 0)
        #expect(clock.pauses.isEmpty)
    }
}

@Test("Both acquisition modes preserve the secure parent walk", arguments: [false, true])
func storageProcessLockRejectsSymlinkParent(nonblocking: Bool) throws {
    let fixture = try ProcessLockFixture()
    defer { fixture.clean() }
    let alias = fixture.root.appendingPathComponent("alias")
    try #require(symlink(fixture.root.path, alias.path) == 0)
    let contender = try StorageProcessLock(
        keyURL: alias.appendingPathComponent("coordinator.key"),
        allowParentCreation: false
    )
    var calls = 0

    processLockExpect("freshness_lock_unavailable") {
        try processLockRun(contender, nonblocking: nonblocking) { calls += 1 }
    }
    #expect(calls == 0)
    #expect(!FileManager.default.fileExists(atPath: fixture.file.path))
}

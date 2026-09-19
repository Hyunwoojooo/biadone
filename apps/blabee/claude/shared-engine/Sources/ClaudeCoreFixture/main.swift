import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Foundation

/// File freshness exists ONLY in this qualification executable. Keeping the
/// anchor beside SQLite deliberately does not claim production rollback
/// protection. The enclosing runtime has an exclusive process lifetime lock.
private final class FixtureFreshnessStore: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "claude-shared-core-fixture"
    private let url: URL

    init(url: URL) { self.url = url }

    func load() throws -> FreshnessStoredRecord? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let record = try FreshnessRecord.decode(Data(contentsOf: url), expectedStorageSlot: storageSlot)
        return try FreshnessStoredRecord(record: record, revision: record.revision)
    }

    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        guard try load() == nil else { throw CoordinatorError("freshness_anchor_conflict") }
        return try save(record)
    }

    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        guard try load()?.revision == expectedRevision else { throw CoordinatorError("freshness_anchor_conflict") }
        return try save(replacement)
    }

    private func save(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        guard record.storageSlot == storageSlot else { throw CoordinatorError("freshness_anchor_corrupt") }
        try record.encoded().write(to: url, options: .atomic)
        guard chmod(url.path, S_IRUSR | S_IWUSR) == 0 else { throw CoordinatorError("fixture_permissions_invalid") }
        return try FreshnessStoredRecord(record: record, revision: record.revision)
    }
}

private func fail(_ code: String) -> Never {
    FileHandle.standardError.write(Data((code + "\n").utf8))
    exit(1)
}

private func assertPrivate(_ url: URL, directory: Bool) throws {
    var info = stat()
    guard lstat(url.path, &info) == 0,
          info.st_uid == getuid(), (info.st_mode & 0o077) == 0,
          (info.st_mode & S_IFMT) == (directory ? S_IFDIR : S_IFREG) else {
        throw CoordinatorError("fixture_permissions_invalid")
    }
}

private func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard arguments.count == 2, arguments[0] == "--fixture-runtime",
          arguments[1].hasPrefix("/") else { throw CoordinatorError("fixture_runtime_required") }
    let runtime = URL(fileURLWithPath: arguments[1], isDirectory: true).standardizedFileURL
    // A caller must deliberately create a private fixture directory. Never
    // fall back to installed product paths, create their parents, or use Keychain.
    try assertPrivate(runtime, directory: true)
    guard runtime.resolvingSymlinksInPath().path == runtime.path else {
        throw CoordinatorError("fixture_symlink_forbidden")
    }
    for name in ["fixture.sqlite", "fixture.sqlite-wal", "fixture.sqlite-shm", "fixture.key",
                 "fixture.key.lock", "fixture.freshness.json", "fixture.owner.lock"] {
        let url = runtime.appendingPathComponent(name)
        var info = stat()
        if lstat(url.path, &info) == 0 { try assertPrivate(url, directory: false) }
        else if errno != ENOENT { throw CoordinatorError("fixture_storage_invalid") }
    }
    let descriptor = open(runtime.appendingPathComponent("fixture.owner.lock").path,
                          O_RDWR | O_CREAT | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw CoordinatorError("fixture_lock_failed") }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { throw CoordinatorError("fixture_runtime_in_use") }
    umask(0o077)
    let freshness = FixtureFreshnessStore(url: runtime.appendingPathComponent("fixture.freshness.json"))
    let adapter = try ClaudeCoreAdapter(
        databaseURL: runtime.appendingPathComponent("fixture.sqlite"),
        keyURL: runtime.appendingPathComponent("fixture.key"), freshnessStore: freshness
    )
    var pending = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        // FileHandle's buffered pipe read may wait for the requested length or
        // EOF. A persistent request/response child must respond to a short line
        // while stdin stays open, so use the available-byte POSIX read contract.
        let count = buffer.withUnsafeMutableBytes { bytes in
            Darwin.read(STDIN_FILENO, bytes.baseAddress, bytes.count)
        }
        if count < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("fixture_read_failed")
        }
        if count == 0 { break }
        for byte in buffer.prefix(count) {
            if byte == 10 {
                guard !pending.isEmpty else { throw CoordinatorError("fixture_empty_frame") }
                let response = adapter.respond(to: pending)
                FileHandle.standardOutput.write(response)
                FileHandle.standardOutput.write(Data([10]))
                pending.removeAll(keepingCapacity: true)
            } else {
                guard pending.count < ClaudeCoreAdapter.maximumMessageBytes else {
                    throw CoordinatorError("request_too_large")
                }
                pending.append(byte)
            }
        }
    }
    guard pending.isEmpty else { throw CoordinatorError("fixture_incomplete_frame") }
}

do { try run() }
catch let error as CoordinatorError {
    let safe = error.code.range(of: "^[a-z0-9_]{1,96}$", options: .regularExpression) != nil
        ? error.code : "fixture_failed"
    fail(safe)
} catch { fail("fixture_failed") }

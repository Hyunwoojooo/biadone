import CoordinatorSwift
import Darwin
import Foundation

/// Bounded local transport observations. This file is not an authority journal:
/// loading it must never authorize a claim, retry, or execution. No cloud upload,
/// credentials, prompt, command, environment, raw output, or user path is stored.
/// The caller explicitly supplies a directory; there is no production default.
final class NextTurnDispatchDiagnostics: @unchecked Sendable {
    static let fileName = "history.json"
    static let lockFileName = ".history.lock"
    static let pendingFileName = ".history.pending"
    static let maximumRecords = 128
    static let maximumBytes = 1_048_576

    struct Entry: Codable, Equatable, Sendable {
        let appBuild: String
        let runtimeIdentity: String?
        let dispatch: CoordinatorNextTurnDispatchRecord
    }

    enum StoreError: Error, Equatable {
        case unavailable, busy, invalidRecord
    }

    private struct History: Codable {
        let schemaVersion: Int
        var entries: [Entry]
    }

    private let directoryURL: URL
    private let appBuild: String
    private let runtimeIdentity: String?
    private let mutex = NSLock()

    init(directoryURL: URL,
         appBuild: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
         runtimeIdentity: String? = nil) {
        self.directoryURL = directoryURL
        self.appBuild = Self.validBuild(appBuild) ? appBuild : "unknown"
        self.runtimeIdentity = runtimeIdentity.flatMap { Self.validRuntimeIdentity($0) ? $0 : nil }
    }

    /// Errors concern diagnostics only. The queue caller must retain its original
    /// result and must not retry or resend work when this best-effort sink fails.
    func record(_ record: CoordinatorNextTurnDispatchRecord) throws {
        try Self.validate(record)
        mutex.lock()
        defer { mutex.unlock() }
        guard let parent = try openDirectory(create: true) else { throw StoreError.unavailable }
        defer { close(parent) }
        try withFileLock(parent) {
            var entries = try readHistory(parent)
            entries.append(Entry(appBuild: appBuild, runtimeIdentity: runtimeIdentity, dispatch: record))
            if entries.count > Self.maximumRecords {
                entries.removeFirst(entries.count - Self.maximumRecords)
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            var data = try encoder.encode(History(schemaVersion: 1, entries: entries))
            while data.count > Self.maximumBytes, entries.count > 1 {
                entries.removeFirst()
                data = try encoder.encode(History(schemaVersion: 1, entries: entries))
            }
            guard data.count <= Self.maximumBytes else { throw StoreError.invalidRecord }
            try replaceHistory(data, parent: parent)
        }
    }

    /// Returns oldest to newest observations, including separate started and
    /// terminal stages for one continuation. Accepted means queue acceptance only.
    func load() throws -> [Entry] {
        mutex.lock()
        defer { mutex.unlock() }
        guard let parent = try openDirectory(create: false) else { return [] }
        defer { close(parent) }
        return try withFileLock(parent) { try readHistory(parent) }
    }

    private func readHistory(_ parent: Int32) throws -> [Entry] {
        let file = openat(parent, Self.fileName, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard file >= 0 else {
            if errno == ENOENT { return [] }
            throw StoreError.unavailable
        }
        defer { close(file) }
        var info = stat()
        guard fstat(file, &info) == 0 else { throw StoreError.unavailable }
        try Self.validateFileMetadata(info)
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = read(file, &buffer, buffer.count)
            if count < 0, errno == EINTR { continue }
            guard count >= 0 else { throw StoreError.unavailable }
            if count == 0 { break }
            guard data.count + count <= Self.maximumBytes else { throw StoreError.unavailable }
            data.append(contentsOf: buffer.prefix(count))
        }
        do {
            let object = try StrictJSONTransport.object(from: data,
                limits: StrictJSONLimits(maximumBytes: Self.maximumBytes, maximumDepth: 8))
            try Self.validateShape(object)
            let history = try JSONDecoder().decode(History.self, from: data)
            guard history.schemaVersion == 1, history.entries.count <= Self.maximumRecords else {
                throw StoreError.invalidRecord
            }
            for entry in history.entries {
                guard Self.validBuild(entry.appBuild),
                      entry.runtimeIdentity.map(Self.validRuntimeIdentity) ?? true else {
                    throw StoreError.invalidRecord
                }
                try Self.validate(entry.dispatch)
            }
            return history.entries
        } catch { throw StoreError.invalidRecord }
    }

    private func replaceHistory(_ data: Data, parent: Int32) throws {
        // A crash can leave at most this one bounded pending file. Reuse it only
        // after checking its inode and metadata; O_TRUNC before validation would
        // corrupt a hard-linked or otherwise unsafe preexisting file.
        let name = Self.pendingFileName
        var file = openat(parent, name,
            O_WRONLY | O_CREAT | O_EXCL | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        let created = file >= 0
        if file < 0, errno == EEXIST {
            file = openat(parent, name, O_WRONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        }
        guard file >= 0 else { throw StoreError.unavailable }
        var removeOnExit = created
        defer {
            if removeOnExit { Self.unlinkPendingIfUnchanged(parent: parent, file: file) }
            close(file)
        }
        try Self.validatePendingIdentity(parent: parent, file: file)
        removeOnExit = true
        guard ftruncate(file, 0) == 0 else { throw StoreError.unavailable }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(file, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw StoreError.unavailable }
                offset += count
            }
        }
        try Self.sync(file)
        try Self.validatePendingIdentity(parent: parent, file: file)
        guard renameat(parent, name, parent, Self.fileName) == 0 else { throw StoreError.unavailable }
        try Self.sync(parent)
    }

    private static func validatePendingIdentity(parent: Int32, file: Int32) throws {
        var opened = stat()
        var current = stat()
        guard fstat(file, &opened) == 0,
              fstatat(parent, pendingFileName, &current, AT_SYMLINK_NOFOLLOW) == 0,
              opened.st_dev == current.st_dev, opened.st_ino == current.st_ino else {
            throw StoreError.unavailable
        }
        try validateFileMetadata(opened)
        try validateFileMetadata(current)
    }

    private static func unlinkPendingIfUnchanged(parent: Int32, file: Int32) {
        var opened = stat()
        var current = stat()
        guard fstat(file, &opened) == 0,
              fstatat(parent, pendingFileName, &current, AT_SYMLINK_NOFOLLOW) == 0,
              opened.st_dev == current.st_dev, opened.st_ino == current.st_ino else { return }
        _ = unlinkat(parent, pendingFileName, 0)
    }

    /// One daemon is the normal writer. A stable, private lock inode also fences
    /// another instance/process. Contention fails immediately: diagnostics must
    /// not wait behind another writer on the selected-work delivery path.
    private func withFileLock<T>(_ parent: Int32, operation: () throws -> T) throws -> T {
        let file = openat(parent, Self.lockFileName,
            O_RDWR | O_CREAT | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard file >= 0 else { throw StoreError.unavailable }
        defer { close(file) }
        var info = stat()
        guard fstat(file, &info) == 0 else { throw StoreError.unavailable }
        try Self.validateFileMetadata(info)
        guard info.st_size == 0 else { throw StoreError.unavailable }
        while flock(file, LOCK_EX | LOCK_NB) != 0 {
            if errno == EINTR { continue }
            if errno == EWOULDBLOCK { throw StoreError.busy }
            throw StoreError.unavailable
        }
        defer { _ = flock(file, LOCK_UN) }
        var current = stat()
        guard fstat(file, &info) == 0,
              fstatat(parent, Self.lockFileName, &current, AT_SYMLINK_NOFOLLOW) == 0,
              info.st_dev == current.st_dev, info.st_ino == current.st_ino else {
            throw StoreError.unavailable
        }
        try Self.validateFileMetadata(info)
        return try operation()
    }

    private func openDirectory(create: Bool) throws -> Int32? {
        guard directoryURL.isFileURL else { throw StoreError.unavailable }
        // These two OS-owned aliases are normalized lexically, never by following
        // arbitrary symlinks. All subsequent path components use O_NOFOLLOW.
        var path = directoryURL.path
        if path == "/tmp" || path.hasPrefix("/tmp/") || path == "/var" || path.hasPrefix("/var/") {
            path = "/private" + path
        }
        guard path.hasPrefix("/"), !path.utf8.contains(0) else { throw StoreError.unavailable }
        let components = path.split(separator: "/").map(String.init)
        guard !components.isEmpty, components.allSatisfy({ $0 != "." && $0 != ".." }) else {
            throw StoreError.unavailable
        }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw StoreError.unavailable }
        do {
            for component in components {
                var next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0, errno == ENOENT {
                    guard create else { close(descriptor); return nil }
                    if mkdirat(descriptor, component, mode_t(0o700)) == 0 {
                        try Self.sync(descriptor)
                    } else if errno != EEXIST { throw StoreError.unavailable }
                    next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw StoreError.unavailable }
                close(descriptor)
                descriptor = next
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0 else { throw StoreError.unavailable }
            try Self.validateDirectoryMetadata(info)
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    static func validateFileMetadata(_ info: stat) throws {
        guard info.st_mode & S_IFMT == S_IFREG, info.st_uid == geteuid(),
              info.st_nlink == 1, info.st_mode & 0o7777 == 0o600,
              info.st_size >= 0, info.st_size <= Self.maximumBytes else { throw StoreError.unavailable }
    }

    static func validateDirectoryMetadata(_ info: stat) throws {
        guard info.st_mode & S_IFMT == S_IFDIR, info.st_uid == geteuid(),
              info.st_mode & 0o7777 == 0o700 else { throw StoreError.unavailable }
    }

    private static func sync(_ descriptor: Int32) throws {
        while fsync(descriptor) != 0 {
            if errno == EINTR { continue }
            throw StoreError.unavailable
        }
    }

    private static func validate(_ record: CoordinatorNextTurnDispatchRecord) throws {
        guard record.schemaVersion == 1, validIdentifier(record.continuationID),
              validIdentifier(record.sessionID), record.occurredAt.utf8.count <= 35,
              (try? RFC3339Instant(record.occurredAt)) != nil else { throw StoreError.invalidRecord }
        switch record.outcome {
        case .started:
            guard record.failure == nil, record.queuedSubmissionID == nil else { throw StoreError.invalidRecord }
        case .accepted:
            guard record.failure == nil, let id = record.queuedSubmissionID, validQueuedSubmissionIdentifier(id) else {
                throw StoreError.invalidRecord
            }
        case .failed:
            guard record.queuedSubmissionID == nil, let failure = record.failure else { throw StoreError.invalidRecord }
            // Codable decoding alone bypasses the failure initializer's code and
            // range restrictions; repeat its strict closed-vocabulary validation.
            guard (try? CoordinatorNextTurnDispatchFailure(jsonObject: failure.jsonObject)) == failure else {
                throw StoreError.invalidRecord
            }
        }
    }

    private static func validIdentifier(_ value: String) -> Bool {
        (1...128).contains(value.utf8.count) && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95
        }
    }

    private static func validQueuedSubmissionIdentifier(_ value: String) -> Bool {
        func alphanumeric(_ byte: UInt8) -> Bool {
            (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte)
        }
        guard (1...128).contains(value.utf8.count), let first = value.utf8.first, alphanumeric(first) else {
            return false
        }
        return value.utf8.allSatisfy { alphanumeric($0) || $0 == 46 || $0 == 95 || $0 == 58 || $0 == 45 }
    }

    private static func validBuild(_ value: String) -> Bool {
        value == "unknown" || ((1...12).contains(value.utf8.count) && value.utf8.allSatisfy { (48...57).contains($0) })
    }

    private static func validRuntimeIdentity(_ value: String) -> Bool {
        value.utf8.count == 71 && value.hasPrefix("sha256:") && value.dropFirst(7).utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    private static func validateShape(_ object: [String: Any]) throws {
        func keys(_ object: [String: Any], required: Set<String>, optional: Set<String> = []) throws {
            let actual = Set(object.keys)
            guard required.isSubset(of: actual), actual.isSubset(of: required.union(optional)) else {
                throw StoreError.invalidRecord
            }
        }
        try keys(object, required: ["schemaVersion", "entries"])
        guard let entries = object["entries"] as? [[String: Any]], entries.count <= maximumRecords else {
            throw StoreError.invalidRecord
        }
        for entry in entries {
            try keys(entry, required: ["appBuild", "dispatch"], optional: ["runtimeIdentity"])
            guard let dispatch = entry["dispatch"] as? [String: Any] else { throw StoreError.invalidRecord }
            try keys(dispatch, required: ["schemaVersion", "continuationID", "sessionID", "occurredAt", "outcome"],
                optional: ["failure", "queuedSubmissionID"])
            if let failure = dispatch["failure"], !(failure is NSNull) {
                guard let object = failure as? [String: Any] else { throw StoreError.invalidRecord }
                try keys(object, required: ["code", "stage", "commandInvocationAttempted", "elapsedMilliseconds", "cachedFailure"],
                    optional: ["exitCode", "terminationSignal", "codexVersion", "executableIdentity"])
            }
        }
    }
}

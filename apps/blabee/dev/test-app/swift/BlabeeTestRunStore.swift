#if BLABEE_TEST_APP
import CoordinatorSwift
import Darwin
import Foundation

struct BlabeeTestRunManifest: Codable, Equatable, Sendable, Identifiable {
    let schemaVersion: Int
    let profile: String
    let storeID: UUID
    let runID: UUID
    let ownerUID: UInt32
    let createdAt: Date
    let scenario: BlabeeTestScenario
    let rootPath: String
    let settingsPath: String
    let logsPath: String
    let resultsPath: String
    let ownedRelativePaths: [String]
    var ownedDefaultsSuiteNames: [String]

    var id: UUID { runID }
    var rootURL: URL { URL(fileURLWithPath: rootPath, isDirectory: true) }
    var settingsURL: URL { URL(fileURLWithPath: settingsPath, isDirectory: true) }
    var logsURL: URL { URL(fileURLWithPath: logsPath, isDirectory: true) }
    var resultsURL: URL { URL(fileURLWithPath: resultsPath, isDirectory: true) }
    /// A reserved namespace, not an assertion that UserDefaults has already created it.
    var defaultsSuiteName: String { "com.biadone.blabee.test.run." + runID.uuidString.lowercased() }
}

struct BlabeeTestRunIssue: Codable, Equatable, Sendable {
    /// Fixed diagnostic code; never a filesystem error description or untrusted file content.
    let code: String
    let runID: UUID?
    /// Only a bounded ASCII filename is exposed. Unknown filenames are represented by nil.
    let entryName: String?
}

struct BlabeeTestRunInventory: Codable, Equatable, Sendable {
    let runs: [BlabeeTestRunManifest]
    let issues: [BlabeeTestRunIssue]
}

/// Fixed, run-bound M2 locations. Preparing them never creates a key, database, or socket.
struct BlabeeTestEnginePaths: Equatable, Sendable {
    let rootURL: URL
    let databaseURL: URL
    let keyURL: URL
    let tokenKeyURL: URL
    let selectorKeyURL: URL
    let authorityRootURL: URL
    let projectURL: URL
    let socketURL: URL
    let freshnessAccount: String
}

enum BlabeeTestRunStoreError: Error, Equatable, LocalizedError {
    case invalidPath
    case unsafeDirectory
    case unsafeFile
    case ownershipMismatch
    case unsupportedManifest
    case missingRun
    case alreadyExists
    case runInUse
    case invalidSnapshot
    case snapshotTooLarge
    case invalidResult
    case resultTooLarge
    case invalidEngineStorage
    case unavailable(Int32)

    var errorDescription: String? {
        switch self {
        case .invalidPath: "The Test data path is invalid or overlaps product data."
        case .unsafeDirectory: "A Test directory has unsafe ownership, permissions, or a symbolic link."
        case .unsafeFile: "A Test file has unsafe ownership, permissions, links, or type."
        case .ownershipMismatch: "The Test ownership marker does not match this store and run."
        case .unsupportedManifest: "The Test manifest profile, schema, or owned resources are invalid."
        case .missingRun: "The selected Test run is unavailable."
        case .alreadyExists: "The Test run already exists; its files were preserved."
        case .runInUse: "Another Test window or app instance owns this run."
        case .invalidSnapshot: "The saved UI simulation belongs to a different run or is invalid."
        case .snapshotTooLarge: "The saved UI simulation exceeds the size limit."
        case .invalidResult: "The saved simulation report belongs to a different run or is invalid."
        case .resultTooLarge: "The saved simulation report exceeds the size limit."
        case .invalidEngineStorage: "The isolated Engine resources are invalid or belong to a different Test run."
        case .unavailable: "The Test store could not complete the operation; existing runs were preserved."
        }
    }
}

/// Locks only the Test run's own file. It never looks up or signals a process.
final class BlabeeTestRunLease: @unchecked Sendable {
    private let lock = NSLock()
    private var descriptor: Int32

    fileprivate init(descriptor: Int32) { self.descriptor = descriptor }

    func release() {
        lock.lock()
        defer { lock.unlock() }
        guard descriptor >= 0 else { return }
        _ = flock(descriptor, LOCK_UN)
        _ = close(descriptor)
        descriptor = -1
    }

    deinit { release() }
}

/// Run-owned M1 files and M2 resource registration; no Engine, key generation, Keychain, or socket operations.
/// Every filesystem operation is relative to a validated directory descriptor.
final class BlabeeTestRunStore: @unchecked Sendable {
    static let schemaVersion = 1
    static let profile = "test"
    static let maximumSnapshotBytes = 256 * 1_024
    static let maximumResultBytes = 256 * 1_024
    static let maximumSocketPathBytes = 103

    let rootURL: URL
    private let lock = NSLock()
    private static let markerName = ".blabee-test-store-v1.json"
    private static let runMarkerName = ".blabee-test-run-v1.json"
    private static let manifestName = "manifest-v1.json"
    private static let lockName = "instance.lock"
    private static let snapshotName = "snapshot-v1.json"
    private static let resultName = "m1-report.json"
    private static let engineResultName = "m2-report.json"
    private static let socketPreparationLock = NSLock()
    private static let engineRegistryName = "engine-resources-v1.json"
    private static let engineRootName = "engine-v1"
    private static let engineMarkerName = ".blabee-test-engine-v1.json"
    private static let socketRootMarkerName = ".blabee-test-sockets-v1.json"
    private static let socketRunMarkerName = ".blabee-test-socket-run-v1.json"
    private static let ownedPaths = [runMarkerName, manifestName, lockName, "settings", "logs", "results"]

    private struct StoreMarker: Codable, Equatable {
        let schemaVersion: Int
        let profile: String
        let storeID: UUID
        let ownerUID: UInt32
        let rootPath: String
    }

    private struct RunMarker: Codable, Equatable {
        let schemaVersion: Int
        let profile: String
        let storeID: UUID
        let runID: UUID
        let ownerUID: UInt32
        let rootPath: String
    }

    private struct SnapshotEnvelope: Codable {
        let schemaVersion: Int
        let profile: String
        let storeID: UUID
        let runID: UUID
        let payload: Data
    }

    private struct EngineResources: Codable, Equatable {
        let schemaVersion: Int
        let profile: String
        let storeID: UUID
        let runID: UUID
        let ownerUID: UInt32
        let runRootPath: String
        let rootPath: String
        let databasePath: String
        let keyPath: String
        let tokenKeyPath: String
        let selectorKeyPath: String
        let authorityRootPath: String
        let projectPath: String
        let socketRootPath: String
        let socketRunPath: String
        let socketPath: String
        let freshnessService: String
        let freshnessAccount: String
    }

    private struct SocketRootMarker: Codable, Equatable {
        let schemaVersion: Int
        let profile: String
        let ownerUID: UInt32
        let rootPath: String
    }

    private struct SocketRunMarker: Codable, Equatable {
        let schemaVersion: Int
        let profile: String
        let storeID: UUID
        let runID: UUID
        let ownerUID: UInt32
        let runRootPath: String
        let socketRootPath: String
        let rootPath: String
    }

    /// Initialization is read-only. The first create explicitly creates the owned store.
    init(rootURL: URL? = nil) throws {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let support else { throw BlabeeTestRunStoreError.invalidPath }
        let chosen = rootURL ?? support.appendingPathComponent("Blabee Test", isDirectory: true)
        try Self.validateAbsolutePath(chosen)
        let path = chosen.path
        let forbidden = [
            "/", FileManager.default.homeDirectoryForCurrentUser.path, support.path,
            support.appendingPathComponent("Blabee").path,
            support.appendingPathComponent("BlabeeUsage").path,
            support.appendingPathComponent("BlabeeDiagnostics").path,
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path,
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude").path,
        ]
        guard !forbidden.contains(where: { path == $0 || ($0 != "/" && path.hasPrefix($0 + "/")) })
                || path == support.appendingPathComponent("Blabee Test").path else {
            throw BlabeeTestRunStoreError.invalidPath
        }
        self.rootURL = chosen
    }

    func create(scenario: BlabeeTestScenario, runID: UUID = UUID(), createdAt: Date = Date()) throws -> BlabeeTestRunManifest {
        try withStore(createIfMissing: true) { root, marker in
            let runs = try Self.openOwnedDirectory("runs", in: root)
            defer { close(runs) }
            let name = runID.uuidString.lowercased()
            guard mkdirat(runs, name, 0o700) == 0 else {
                if errno == EEXIST { throw BlabeeTestRunStoreError.alreadyExists }
                throw BlabeeTestRunStoreError.unavailable(errno)
            }
            let run = try Self.openOwnedDirectory(name, in: runs)
            defer { close(run) }
            let runRoot = rootURL.appendingPathComponent("runs", isDirectory: true).appendingPathComponent(name, isDirectory: true)
            let manifest = BlabeeTestRunManifest(
                schemaVersion: Self.schemaVersion, profile: Self.profile, storeID: marker.storeID,
                runID: runID, ownerUID: geteuid(), createdAt: createdAt, scenario: scenario,
                rootPath: runRoot.path,
                settingsPath: runRoot.appendingPathComponent("settings").path,
                logsPath: runRoot.appendingPathComponent("logs").path,
                resultsPath: runRoot.appendingPathComponent("results").path,
                ownedRelativePaths: Self.ownedPaths, ownedDefaultsSuiteNames: []
            )
            for directory in ["settings", "logs", "results"] {
                guard mkdirat(run, directory, 0o700) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
            }
            try Self.writeExclusive(Data(), name: Self.lockName, in: run)
            try Self.writeExclusive(try Self.encode(Self.runMarker(for: manifest)), name: Self.runMarkerName, in: run)
            try Self.writeExclusive(try Self.encode(manifest), name: Self.manifestName, in: run)
            // A partial new run is preserved on failure, never adopted as a valid run.
            try Self.validateManifest(manifest, marker: marker, rootURL: rootURL, directory: run)
            return manifest
        }
    }

    func resume(runID: UUID) throws -> BlabeeTestRunManifest {
        try withStore(createIfMissing: false) { root, marker in
            try withRun(runID: runID, root: root) { run in
                try loadManifest(directory: run, marker: marker, expectedRunID: runID)
            }
        }
    }

    func validate(_ manifest: BlabeeTestRunManifest) throws {
        let stored = try resume(runID: manifest.runID)
        guard stored == manifest else { throw BlabeeTestRunStoreError.ownershipMismatch }
    }

    /// An uncreated root is a normal first launch; existing invalid roots or runs still fail closed.
    func list() throws -> [BlabeeTestRunManifest] {
        if try rootIsAbsent() { return [] }
        return try withStore(createIfMissing: false) { root, marker in
            let runs = try Self.openOwnedDirectory("runs", in: root)
            defer { close(runs) }
            let names = try Self.entries(in: runs)
            let manifests = try names.map { name in
                guard let id = UUID(uuidString: name), name == id.uuidString.lowercased() else {
                    throw BlabeeTestRunStoreError.unsupportedManifest
                }
                return try withRun(runID: id, root: root) { try loadManifest(directory: $0, marker: marker, expectedRunID: id) }
            }
            return manifests.sorted { $0.createdAt == $1.createdAt ? $0.runID.uuidString < $1.runID.uuidString : $0.createdAt > $1.createdAt }
        }
    }

    /// Lists valid runs while retaining diagnostics for individual incomplete or invalid entries.
    /// Root, store marker, store lock, and runs-directory failures remain fatal.
    func inventory() throws -> BlabeeTestRunInventory {
        if try rootIsAbsent() { return BlabeeTestRunInventory(runs: [], issues: []) }
        return try withStore(createIfMissing: false) { root, marker in
            let runs = try Self.openOwnedDirectory("runs", in: root)
            defer { close(runs) }
            var manifests: [BlabeeTestRunManifest] = []
            var issues: [BlabeeTestRunIssue] = []
            for name in try Self.entries(in: runs).sorted() {
                guard let id = UUID(uuidString: name), name == id.uuidString.lowercased() else {
                    issues.append(Self.issue(code: "unrecognized_run_entry", name: name))
                    continue
                }
                do {
                    let run = try Self.openOwnedDirectory(name, in: runs)
                    defer { close(run) }
                    let manifest = try loadManifest(directory: run, marker: marker, expectedRunID: id)
                    try Self.validateDirectoryIdentity(run, name: name, in: runs)
                    manifests.append(manifest)
                } catch {
                    // No entry is adopted, repaired, removed, resumed, or executed on this path.
                    issues.append(Self.issue(code: "invalid_run", name: name))
                }
            }
            // A replaced or corrupted shared directory must not become a collection of run issues.
            try Self.validateDirectoryIdentity(runs, name: "runs", in: root)
            let sorted = manifests.sorted {
                $0.createdAt == $1.createdAt ? $0.runID.uuidString < $1.runID.uuidString : $0.createdAt > $1.createdAt
            }
            return BlabeeTestRunInventory(runs: sorted, issues: issues)
        }
    }

    private static func issue(code: String, name: String) -> BlabeeTestRunIssue {
        let safe = !name.isEmpty && name.utf8.count <= 64 && name.unicodeScalars.allSatisfy {
            (65...90).contains($0.value) || (97...122).contains($0.value) || (48...57).contains($0.value)
                || $0 == "." || $0 == "_" || $0 == "-"
        }
        return BlabeeTestRunIssue(code: code, runID: UUID(uuidString: name), entryName: safe ? name : nil)
    }

    private static func validateDirectoryIdentity(_ descriptor: Int32, name: String, in parent: Int32) throws {
        let named = try openOwnedDirectory(name, in: parent)
        defer { close(named) }
        var heldInfo = stat(), namedInfo = stat()
        guard fstat(descriptor, &heldInfo) == 0, fstat(named, &namedInfo) == 0,
              heldInfo.st_dev == namedInfo.st_dev, heldInfo.st_ino == namedInfo.st_ino else {
            throw BlabeeTestRunStoreError.ownershipMismatch
        }
    }

    private func rootIsAbsent() throws -> Bool {
        // Only absence of the final component under a validated parent is a new store.
        // ENOENT from a later marker, lock, or runs lookup must never turn corruption into [].
        let parent = try Self.openAbsoluteDirectory(rootURL.deletingLastPathComponent())
        defer { close(parent) }
        var info = stat()
        if fstatat(parent, rootURL.lastPathComponent, &info, AT_SYMLINK_NOFOLLOW) == 0 { return false }
        guard errno == ENOENT else { throw BlabeeTestRunStoreError.unavailable(errno) }
        return true
    }

    /// Call after constructing the explicitly scoped suite and retain the returned manifest.
    func recordDefaultsSuiteUse(for manifest: BlabeeTestRunManifest) throws -> BlabeeTestRunManifest {
        try withValidatedRun(manifest) { run in
            if manifest.ownedDefaultsSuiteNames == [manifest.defaultsSuiteName] { return manifest }
            var updated = manifest
            updated.ownedDefaultsSuiteNames = [manifest.defaultsSuiteName]
            try Self.replaceFile(try Self.encode(updated), name: Self.manifestName, in: run)
            return updated
        }
    }

    func acquireLease(for manifest: BlabeeTestRunManifest) throws -> BlabeeTestRunLease {
        try withValidatedRun(manifest) { run in
            let descriptor = try Self.openOwnedFile(Self.lockName, in: run, flags: O_RDWR)
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
                let issue = errno
                close(descriptor)
                if issue == EWOULDBLOCK || issue == EAGAIN { throw BlabeeTestRunStoreError.runInUse }
                throw BlabeeTestRunStoreError.unavailable(issue)
            }
            var held = stat(), named = stat()
            guard fstat(descriptor, &held) == 0,
                  fstatat(run, Self.lockName, &named, AT_SYMLINK_NOFOLLOW) == 0,
                  held.st_dev == named.st_dev, held.st_ino == named.st_ino else {
                close(descriptor)
                throw BlabeeTestRunStoreError.ownershipMismatch
            }
            return BlabeeTestRunLease(descriptor: descriptor)
        }
    }

    /// Payload is simulation UI progress only. Callers must never serialize tokens or credentials.
    func saveSnapshot(_ payload: Data, for manifest: BlabeeTestRunManifest) throws {
        guard payload.count <= Self.maximumSnapshotBytes else { throw BlabeeTestRunStoreError.snapshotTooLarge }
        try withValidatedRun(manifest) { run in
            let settings = try Self.openOwnedDirectory("settings", in: run)
            defer { close(settings) }
            let envelope = SnapshotEnvelope(schemaVersion: Self.schemaVersion, profile: Self.profile,
                                            storeID: manifest.storeID, runID: manifest.runID, payload: payload)
            try Self.replaceFile(try Self.encode(envelope), name: Self.snapshotName, in: settings)
        }
    }

    func loadSnapshot(for manifest: BlabeeTestRunManifest) throws -> Data? {
        try withValidatedRun(manifest) { run in
            let settings = try Self.openOwnedDirectory("settings", in: run)
            defer { close(settings) }
            guard try Self.fileExists(Self.snapshotName, in: settings) else { return nil }
            let data = try Self.readFile(Self.snapshotName, in: settings, maximumBytes: Self.maximumSnapshotBytes * 2)
            guard let envelope = try? JSONDecoder().decode(SnapshotEnvelope.self, from: data),
                  envelope.schemaVersion == Self.schemaVersion, envelope.profile == Self.profile,
                  envelope.storeID == manifest.storeID, envelope.runID == manifest.runID,
                  envelope.payload.count <= Self.maximumSnapshotBytes else { throw BlabeeTestRunStoreError.invalidSnapshot }
            return envelope.payload
        }
    }

    /// A mode-specific local report, never an authority journal or proof of real provider execution.
    func saveResult(_ payload: Data, for manifest: BlabeeTestRunManifest) throws {
        guard payload.count <= Self.maximumResultBytes else { throw BlabeeTestRunStoreError.resultTooLarge }
        try withValidatedRun(manifest) { run in
            let results = try Self.openOwnedDirectory("results", in: run)
            defer { close(results) }
            let envelope = SnapshotEnvelope(schemaVersion: Self.schemaVersion, profile: Self.profile,
                                            storeID: manifest.storeID, runID: manifest.runID, payload: payload)
            let name = manifest.scenario.usesRealEngine ? Self.engineResultName : Self.resultName
            try Self.replaceFile(try Self.encode(envelope), name: name, in: results)
        }
    }

    func loadResult(for manifest: BlabeeTestRunManifest) throws -> Data? {
        try withValidatedRun(manifest) { run in
            let results = try Self.openOwnedDirectory("results", in: run)
            defer { close(results) }
            let name = manifest.scenario.usesRealEngine ? Self.engineResultName : Self.resultName
            guard try Self.fileExists(name, in: results) else { return nil }
            let data = try Self.readFile(name, in: results, maximumBytes: Self.maximumResultBytes * 2)
            guard let envelope = try? JSONDecoder().decode(SnapshotEnvelope.self, from: data),
                  envelope.schemaVersion == Self.schemaVersion, envelope.profile == Self.profile,
                  envelope.storeID == manifest.storeID, envelope.runID == manifest.runID,
                  envelope.payload.count <= Self.maximumResultBytes else { throw BlabeeTestRunStoreError.invalidResult }
            return envelope.payload
        }
    }

    /// Registers only private directories and ownership markers. Common Engine key stores create secrets later.
    func prepareEngineStorage(for manifest: BlabeeTestRunManifest) throws -> BlabeeTestEnginePaths {
        try engineStorage(for: manifest, suppliedPaths: nil, prepare: true)
    }

    /// Child composition may reopen registered resources without creating or adopting anything.
    func loadEngineStorage(for manifest: BlabeeTestRunManifest) throws -> BlabeeTestEnginePaths {
        try engineStorage(for: manifest, suppliedPaths: nil, prepare: false)
    }

    /// Recomputes every location before inspecting the registered resources; caller-provided paths are never opened.
    func validateEngineStorage(for manifest: BlabeeTestRunManifest, paths: BlabeeTestEnginePaths) throws {
        _ = try engineStorage(for: manifest, suppliedPaths: paths, prepare: false)
    }

    private func engineStorage(for manifest: BlabeeTestRunManifest, suppliedPaths: BlabeeTestEnginePaths?,
                               prepare: Bool) throws -> BlabeeTestEnginePaths {
        try withValidatedRun(manifest) { run in
            guard manifest.scenario.usesRealEngine else { throw BlabeeTestRunStoreError.invalidEngineStorage }
            let paths = try Self.enginePaths(for: manifest)
            if let suppliedPaths { try Self.validateEnginePaths(suppliedPaths, expected: paths) }
            let resources = Self.engineResources(for: manifest, paths: paths)
            let settings = try Self.openOwnedDirectory("settings", in: run)
            defer { close(settings) }
            let registered = try Self.fileExists(Self.engineRegistryName, in: settings)
            if registered {
                try Self.validateBoundFile(Self.engineRegistryName, in: settings, expected: resources)
            } else {
                guard prepare, try Self.fileExists(Self.engineRootName, in: settings) == false else {
                    throw BlabeeTestRunStoreError.invalidEngineStorage
                }
            }
            try Self.validateEngineDirectory(in: settings, resources: resources, create: !registered)
            try Self.validateSocketDirectory(for: manifest, socketURL: paths.socketURL, create: !registered)
            if !registered {
                try Self.writeExclusive(try Self.encode(resources), name: Self.engineRegistryName, in: settings)
            }
            try Self.validateBoundFile(Self.engineRegistryName, in: settings, expected: resources)
            try Self.validateDirectoryIdentity(settings, name: "settings", in: run)
            return paths
        }
    }

    private static func enginePaths(for manifest: BlabeeTestRunManifest) throws -> BlabeeTestEnginePaths {
        let root = manifest.settingsURL.appendingPathComponent(engineRootName, isDirectory: true)
        let storage = root.appendingPathComponent("storage", isDirectory: true)
        return BlabeeTestEnginePaths(
            rootURL: root, databaseURL: storage.appendingPathComponent("coordinator.sqlite"),
            keyURL: storage.appendingPathComponent("storage.key"),
            tokenKeyURL: storage.appendingPathComponent("continuation.key"),
            selectorKeyURL: storage.appendingPathComponent("selector.key"),
            authorityRootURL: root.appendingPathComponent("authority", isDirectory: true),
            projectURL: root.appendingPathComponent("project", isDirectory: true),
            socketURL: try proposedSocketURL(runID: manifest.runID, ownerUID: manifest.ownerUID),
            freshnessAccount: "test-" + manifest.runID.uuidString.lowercased()
        )
    }

    private static func validateEnginePaths(_ paths: BlabeeTestEnginePaths, expected: BlabeeTestEnginePaths) throws {
        let suppliedURLs = [paths.rootURL, paths.databaseURL, paths.keyURL, paths.tokenKeyURL, paths.selectorKeyURL,
                            paths.authorityRootURL, paths.projectURL, paths.socketURL]
        let expectedURLs = [expected.rootURL, expected.databaseURL, expected.keyURL, expected.tokenKeyURL,
                            expected.selectorKeyURL, expected.authorityRootURL, expected.projectURL, expected.socketURL]
        guard paths.freshnessAccount == expected.freshnessAccount,
              zip(suppliedURLs, expectedURLs).allSatisfy({ pair in
                  pair.0.isFileURL && pair.0.absoluteString == pair.1.absoluteString
              }) else { throw BlabeeTestRunStoreError.invalidEngineStorage }
    }

    private static func engineResources(for manifest: BlabeeTestRunManifest,
                                        paths: BlabeeTestEnginePaths) -> EngineResources {
        EngineResources(
            schemaVersion: schemaVersion, profile: profile, storeID: manifest.storeID,
            runID: manifest.runID, ownerUID: manifest.ownerUID, runRootPath: manifest.rootPath,
            rootPath: paths.rootURL.path, databasePath: paths.databaseURL.path, keyPath: paths.keyURL.path,
            tokenKeyPath: paths.tokenKeyURL.path, selectorKeyPath: paths.selectorKeyURL.path,
            authorityRootPath: paths.authorityRootURL.path, projectPath: paths.projectURL.path,
            socketRootPath: paths.socketURL.deletingLastPathComponent().deletingLastPathComponent().path,
            socketRunPath: paths.socketURL.deletingLastPathComponent().path, socketPath: paths.socketURL.path,
            freshnessService: KeychainFreshnessAnchorStore.defaultService,
            freshnessAccount: paths.freshnessAccount
        )
    }

    private static func validateEngineDirectory(in settings: Int32, resources: EngineResources, create: Bool) throws {
        if create {
            guard mkdirat(settings, engineRootName, 0o700) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        }
        let root = try openOwnedDirectory(engineRootName, in: settings)
        defer { close(root) }
        if create {
            try writeExclusive(try encode(resources), name: engineMarkerName, in: root)
            for name in ["storage", "authority", "project"] {
                guard mkdirat(root, name, 0o700) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
            }
        }
        try validateBoundFile(engineMarkerName, in: root, expected: resources)
        for name in ["storage", "authority", "project"] {
            let directory = try openOwnedDirectory(name, in: root)
            defer { close(directory) }
            if name == "storage" {
                for key in ["storage.key", "continuation.key", "selector.key"] {
                    try validateOptionalEngineFile(key, in: directory, isKey: true)
                }
                for file in ["coordinator.sqlite", "coordinator.sqlite-wal", "coordinator.sqlite-shm",
                             "coordinator.sqlite-journal", ".blabee-coordinator-freshness.lock"] {
                    try validateOptionalEngineFile(file, in: directory, isKey: false)
                }
            }
            try validateDirectoryIdentity(directory, name: name, in: root)
        }
        try validateDirectoryIdentity(root, name: engineRootName, in: settings)
    }

    private static func validateOptionalEngineFile(_ name: String, in parent: Int32, isKey: Bool) throws {
        guard try fileExists(name, in: parent) else { return }
        let descriptor = openat(parent, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw BlabeeTestRunStoreError.unsafeFile }
        defer { close(descriptor) }
        var held = stat(), named = stat()
        guard fstat(descriptor, &held) == 0, held.st_mode & S_IFMT == S_IFREG,
              held.st_uid == geteuid(), held.st_nlink == 1, held.st_mode & 0o7022 == 0,
              !isKey || (held.st_mode & 0o7777 == 0o600 && held.st_size == 32),
              fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              held.st_dev == named.st_dev, held.st_ino == named.st_ino else {
            throw BlabeeTestRunStoreError.unsafeFile
        }
    }

    private static func validateSocketDirectory(for manifest: BlabeeTestRunManifest, socketURL: URL,
                                                create: Bool) throws {
        // Distinct stores in one Test process may initialize the UID root concurrently.
        // Other processes still reject any existing root whose complete marker is unavailable.
        socketPreparationLock.lock()
        defer { socketPreparationLock.unlock() }
        let runURL = socketURL.deletingLastPathComponent()
        let rootURL = runURL.deletingLastPathComponent()
        let parent = try openAbsoluteDirectory(rootURL.deletingLastPathComponent())
        defer { close(parent) }
        let rootCreated = create && mkdirat(parent, rootURL.lastPathComponent, 0o700) == 0
        if create && !rootCreated && errno != EEXIST { throw BlabeeTestRunStoreError.unavailable(errno) }
        let root = try openOwnedDirectory(rootURL.lastPathComponent, in: parent)
        defer { close(root) }
        let rootMarker = SocketRootMarker(schemaVersion: schemaVersion, profile: profile,
                                          ownerUID: manifest.ownerUID, rootPath: rootURL.path)
        if rootCreated { try writeExclusive(try encode(rootMarker), name: socketRootMarkerName, in: root) }
        try validateBoundFile(socketRootMarkerName, in: root, expected: rootMarker)
        let runCreated = create && mkdirat(root, runURL.lastPathComponent, 0o700) == 0
        if create && !runCreated && errno != EEXIST { throw BlabeeTestRunStoreError.unavailable(errno) }
        let run = try openOwnedDirectory(runURL.lastPathComponent, in: root)
        defer { close(run) }
        let marker = SocketRunMarker(schemaVersion: schemaVersion, profile: profile, storeID: manifest.storeID,
                                     runID: manifest.runID, ownerUID: manifest.ownerUID,
                                     runRootPath: manifest.rootPath, socketRootPath: rootURL.path,
                                     rootPath: runURL.path)
        if runCreated { try writeExclusive(try encode(marker), name: socketRunMarkerName, in: run) }
        try validateBoundFile(socketRunMarkerName, in: run, expected: marker)
        if try fileExists(socketURL.lastPathComponent, in: run) {
            var info = stat()
            guard fstatat(run, socketURL.lastPathComponent, &info, AT_SYMLINK_NOFOLLOW) == 0,
                  info.st_mode & S_IFMT == S_IFSOCK, info.st_uid == manifest.ownerUID,
                  info.st_mode & 0o7777 == 0o600, info.st_nlink == 1 else {
                throw BlabeeTestRunStoreError.unsafeFile
            }
        }
        if try fileExists("svc.sock.lock", in: run) { close(try openOwnedFile("svc.sock.lock", in: run)) }
        try validateDirectoryIdentity(run, name: runURL.lastPathComponent, in: root)
        try validateDirectoryIdentity(root, name: rootURL.lastPathComponent, in: parent)
    }

    private static func validateBoundFile<T: Codable & Equatable>(_ name: String, in parent: Int32,
                                                                expected: T) throws {
        let data = try readFile(name, in: parent)
        let expectedData = try encode(expected)
        guard let decoded = try? JSONDecoder().decode(T.self, from: data), decoded == expected,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let expectedObject = try? JSONSerialization.jsonObject(with: expectedData) as? [String: Any],
              Set(object.keys) == Set(expectedObject.keys) else {
            throw BlabeeTestRunStoreError.invalidEngineStorage
        }
    }

    /// Fixed short socket location. M1 only calculates it; M2 explicitly registers its directories.
    static func proposedSocketURL(runID: UUID, ownerUID: UInt32 = geteuid(),
                                  temporaryRoot: URL = URL(fileURLWithPath: "/private/tmp", isDirectory: true)) throws -> URL {
        try validateAbsolutePath(temporaryRoot)
        let result = temporaryRoot.appendingPathComponent("blabee-test-\(ownerUID)", isDirectory: true)
            .appendingPathComponent(runID.uuidString.lowercased(), isDirectory: true).appendingPathComponent("svc.sock")
        guard result.path.utf8.count <= maximumSocketPathBytes else { throw BlabeeTestRunStoreError.invalidPath }
        return result
    }

    private func withStore<T>(createIfMissing: Bool, _ operation: (Int32, StoreMarker) throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        let parent = try Self.openAbsoluteDirectory(rootURL.deletingLastPathComponent())
        defer { close(parent) }
        var created = false
        if createIfMissing && mkdirat(parent, rootURL.lastPathComponent, 0o700) == 0 { created = true }
        else if createIfMissing && errno != EEXIST { throw BlabeeTestRunStoreError.unavailable(errno) }
        let root = try Self.openOwnedDirectory(rootURL.lastPathComponent, in: parent)
        defer { close(root) }
        if created {
            guard mkdirat(root, "runs", 0o700) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
            try Self.writeExclusive(Data(), name: ".store.lock", in: root)
            let marker = StoreMarker(schemaVersion: Self.schemaVersion, profile: Self.profile,
                                     storeID: UUID(), ownerUID: geteuid(), rootPath: rootURL.path)
            try Self.writeExclusive(try Self.encode(marker), name: Self.markerName, in: root)
        }
        let storeLock = try Self.openOwnedFile(".store.lock", in: root, flags: O_RDWR)
        defer { close(storeLock) }
        guard flock(storeLock, LOCK_EX) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        defer { _ = flock(storeLock, LOCK_UN) }
        let data = try Self.readFile(Self.markerName, in: root)
        guard let marker = try? JSONDecoder().decode(StoreMarker.self, from: data),
              marker.schemaVersion == Self.schemaVersion, marker.profile == Self.profile,
              marker.ownerUID == geteuid(), marker.rootPath == rootURL.path else {
            throw BlabeeTestRunStoreError.ownershipMismatch
        }
        let value = try operation(root, marker)
        var held = stat(), named = stat()
        let reopened = try Self.openAbsoluteDirectory(rootURL)
        defer { close(reopened) }
        var absolute = stat()
        guard fstat(root, &held) == 0,
              fstatat(parent, rootURL.lastPathComponent, &named, AT_SYMLINK_NOFOLLOW) == 0,
              fstat(reopened, &absolute) == 0,
              held.st_dev == named.st_dev, held.st_ino == named.st_ino,
              held.st_dev == absolute.st_dev, held.st_ino == absolute.st_ino else { throw BlabeeTestRunStoreError.ownershipMismatch }
        return value
    }

    private func withRun<T>(runID: UUID, root: Int32, _ operation: (Int32) throws -> T) throws -> T {
        let runs = try Self.openOwnedDirectory("runs", in: root)
        defer { close(runs) }
        let run = try Self.openOwnedDirectory(runID.uuidString.lowercased(), in: runs)
        defer { close(run) }
        let value = try operation(run)
        var held = stat(), named = stat()
        guard fstat(run, &held) == 0,
              fstatat(runs, runID.uuidString.lowercased(), &named, AT_SYMLINK_NOFOLLOW) == 0,
              held.st_dev == named.st_dev, held.st_ino == named.st_ino else { throw BlabeeTestRunStoreError.ownershipMismatch }
        return value
    }

    private func withValidatedRun<T>(_ manifest: BlabeeTestRunManifest, _ operation: (Int32) throws -> T) throws -> T {
        try withStore(createIfMissing: false) { root, marker in
            try withRun(runID: manifest.runID, root: root) { run in
                guard try loadManifest(directory: run, marker: marker, expectedRunID: manifest.runID) == manifest else {
                    throw BlabeeTestRunStoreError.ownershipMismatch
                }
                return try operation(run)
            }
        }
    }

    private func loadManifest(directory: Int32, marker: StoreMarker, expectedRunID: UUID) throws -> BlabeeTestRunManifest {
        let data = try Self.readFile(Self.manifestName, in: directory)
        guard let manifest = try? JSONDecoder().decode(BlabeeTestRunManifest.self, from: data), manifest.runID == expectedRunID else {
            throw BlabeeTestRunStoreError.unsupportedManifest
        }
        try Self.validateManifest(manifest, marker: marker, rootURL: rootURL, directory: directory)
        return manifest
    }

    private static func validateManifest(_ manifest: BlabeeTestRunManifest, marker: StoreMarker, rootURL: URL, directory: Int32) throws {
        let expectedRoot = rootURL.appendingPathComponent("runs", isDirectory: true)
            .appendingPathComponent(manifest.runID.uuidString.lowercased(), isDirectory: true)
        guard manifest.schemaVersion == schemaVersion, manifest.profile == profile,
              manifest.storeID == marker.storeID, manifest.ownerUID == geteuid(),
              manifest.createdAt.timeIntervalSinceReferenceDate.isFinite,
              manifest.rootPath == expectedRoot.path,
              manifest.settingsPath == expectedRoot.appendingPathComponent("settings").path,
              manifest.logsPath == expectedRoot.appendingPathComponent("logs").path,
              manifest.resultsPath == expectedRoot.appendingPathComponent("results").path,
              manifest.ownedRelativePaths == ownedPaths,
              manifest.ownedDefaultsSuiteNames.isEmpty || manifest.ownedDefaultsSuiteNames == [manifest.defaultsSuiteName] else {
            throw BlabeeTestRunStoreError.unsupportedManifest
        }
        let data = try readFile(runMarkerName, in: directory)
        guard let owned = try? JSONDecoder().decode(RunMarker.self, from: data),
              owned == runMarker(for: manifest) else { throw BlabeeTestRunStoreError.ownershipMismatch }
        for name in ["settings", "logs", "results"] { close(try openOwnedDirectory(name, in: directory)) }
        close(try openOwnedFile(lockName, in: directory))
    }

    private static func runMarker(for manifest: BlabeeTestRunManifest) -> RunMarker {
        RunMarker(schemaVersion: schemaVersion, profile: profile, storeID: manifest.storeID,
                  runID: manifest.runID, ownerUID: manifest.ownerUID, rootPath: manifest.rootPath)
    }

    private static func validateAbsolutePath(_ url: URL) throws {
        guard url.isFileURL, url.path.hasPrefix("/"), !url.path.utf8.contains(0),
              !url.pathComponents.contains(".."), !url.pathComponents.contains("."), url.path != "/" else {
            throw BlabeeTestRunStoreError.invalidPath
        }
    }

    private static func openAbsoluteDirectory(_ url: URL) throws -> Int32 {
        guard url.isFileURL, url.path.hasPrefix("/"), !url.path.utf8.contains(0),
              !url.pathComponents.contains(".."), !url.pathComponents.contains(".") else { throw BlabeeTestRunStoreError.invalidPath }
        var current = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard current >= 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        do {
            for name in url.pathComponents where name != "/" {
                let next = openat(current, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard next >= 0 else { throw BlabeeTestRunStoreError.unsafeDirectory }
                close(current)
                current = next
                var info = stat()
                guard fstat(current, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                      info.st_uid == 0 || info.st_uid == geteuid() else { throw BlabeeTestRunStoreError.unsafeDirectory }
                // Root-owned sticky temporary ancestors are safe to traverse, never adopted as a run.
                let stickyRoot = info.st_uid == 0 && info.st_mode & S_ISVTX != 0
                guard info.st_mode & 0o022 == 0 || stickyRoot else { throw BlabeeTestRunStoreError.unsafeDirectory }
            }
            return current
        } catch { close(current); throw error }
    }

    private static func openOwnedDirectory(_ name: String, in parent: Int32) throws -> Int32 {
        let descriptor = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else {
            if errno == ENOENT { throw BlabeeTestRunStoreError.missingRun }
            throw BlabeeTestRunStoreError.unsafeDirectory
        }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
              info.st_uid == geteuid(), info.st_mode & 0o7777 == 0o700 else {
            close(descriptor)
            throw BlabeeTestRunStoreError.unsafeDirectory
        }
        return descriptor
    }

    private static func openOwnedFile(_ name: String, in parent: Int32, flags: Int32 = O_RDONLY) throws -> Int32 {
        let descriptor = openat(parent, name, flags | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw BlabeeTestRunStoreError.unsafeFile }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == geteuid(), info.st_mode & 0o7777 == 0o600, info.st_nlink == 1 else {
            close(descriptor)
            throw BlabeeTestRunStoreError.unsafeFile
        }
        return descriptor
    }

    private static func fileExists(_ name: String, in parent: Int32) throws -> Bool {
        var info = stat()
        if fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) == 0 { return true }
        guard errno == ENOENT else { throw BlabeeTestRunStoreError.unavailable(errno) }
        return false
    }

    private static func readFile(_ name: String, in parent: Int32, maximumBytes: Int = 65_536) throws -> Data {
        let descriptor = try openOwnedFile(name, in: parent)
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_size >= 0, info.st_size <= maximumBytes else {
            throw BlabeeTestRunStoreError.unsafeFile
        }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw BlabeeTestRunStoreError.unavailable(errno)
            }
            guard result.count + count <= maximumBytes else { throw BlabeeTestRunStoreError.unsafeFile }
            result.append(contentsOf: buffer.prefix(count))
        }
        return result
    }

    private static func writeExclusive(_ data: Data, name: String, in parent: Int32) throws {
        let descriptor = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        defer { close(descriptor) }
        guard fchmod(descriptor, 0o600) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw BlabeeTestRunStoreError.unavailable(errno)
                }
                guard count > 0 else { throw BlabeeTestRunStoreError.unavailable(EIO) }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
    }

    private static func replaceFile(_ data: Data, name: String, in parent: Int32) throws {
        if try fileExists(name, in: parent) { close(try openOwnedFile(name, in: parent)) }
        let temporary = ".write-" + UUID().uuidString.lowercased()
        try writeExclusive(data, name: temporary, in: parent)
        guard renameat(parent, temporary, parent, name) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        guard fsync(parent) == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
    }

    private static func entries(in descriptor: Int32) throws -> [String] {
        let copy = dup(descriptor)
        guard copy >= 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        guard let directory = fdopendir(copy) else { close(copy); throw BlabeeTestRunStoreError.unavailable(errno) }
        defer { closedir(directory) }
        var names: [String] = []
        errno = 0
        while let entry = readdir(directory) {
            var name = entry.pointee.d_name
            let string = withUnsafePointer(to: &name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1) { String(cString: $0) }
            }
            if string != "." && string != ".." { names.append(string) }
            errno = 0
        }
        guard errno == 0 else { throw BlabeeTestRunStoreError.unavailable(errno) }
        return names
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(value)
    }
}
#endif

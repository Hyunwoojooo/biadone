import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation
import SQLite3

/// Per-scope audit storage, never a source of live authority or credentials.
/// The caller authenticates enrollment and the core checkpoint before using
/// this port. A reopened store permits authenticated history reads only.
final class ClaudeSessionMetadataStore: @unchecked Sendable {
    typealias CoreCheckpoint = FreshnessCheckpoint

    struct Mapping: Sendable, Equatable {
        let authority: ClaudeSessionAuthority.Identity
        let coreProjectID: String
        let coreSessionID: String
        let canonicalCWD: String
        let channelSource: String
        let runtimeIdentity: String
    }

    struct Operation: Sendable, Equatable {
        let operationID: UUID
        let replayKey: ClaudeReplayKey?
        let binding: CoordinatorBinding?
        let before: CoreCheckpoint?
        let after: CoreCheckpoint
    }

    struct History: Sendable, Equatable {
        let mapping: Mapping
        let operations: [Operation]
        let metadataCheckpoint: FreshnessCheckpoint
        let coreCheckpoint: CoreCheckpoint
    }

    struct Summary: Sendable, Equatable {
        let mapping: Mapping
        let metadataCheckpoint: FreshnessCheckpoint
        let coreCheckpoint: CoreCheckpoint
        let operationCount: Int64
    }

    enum CrashPoint: String, Sendable, CaseIterable {
        case beforePrepare
        case afterPrepareFreshnessPending
        case afterPrepareSQLiteCommit
        case afterPrepare
        case afterCoreCommit
        case afterFinalizeFreshnessPending
        case afterFinalizeSQLiteCommit
        case afterFinalize
    }

    private struct Verified {
        let mapping: Mapping
        let operationCount: Int64
        let checkpoint: FreshnessCheckpoint
        let core: CoreCheckpoint?
        let preparedOperationID: UUID?
    }

    private enum Format: Int64 {
        case v1 = 1, v2 = 2
        var version: String { "blabee.claude-session-metadata.v\(rawValue)" }
        var headerDomain: String { "blabee.claude-metadata-header.v\(rawValue)" }
        var recordDomain: String { "blabee.claude-metadata-record.v\(rawValue)" }
        var tables: [(String, String)] {
            if self == .v1 { return ClaudeSessionMetadataStore.legacyTables }
            return [ClaudeSessionMetadataStore.legacyTables[0],
                ("metadata_operation_lookup", "CREATE TABLE metadata_operation_lookup (operation_id TEXT PRIMARY KEY, first_sequence INTEGER NOT NULL CHECK(first_sequence > 0)) WITHOUT ROWID"),
                ClaudeSessionMetadataStore.legacyTables[1],
                ("metadata_replay_lookup", "CREATE TABLE metadata_replay_lookup (kind TEXT NOT NULL, replay_id TEXT NOT NULL, first_sequence INTEGER NOT NULL CHECK(first_sequence > 0), PRIMARY KEY(kind, replay_id)) WITHOUT ROWID")]
        }
    }
    // This domain is a transient key-continuity proof, not a persisted header.
    private static let headerDomain = "blabee.claude-metadata-header.v1"
    private static let legacyTables: [(String, String)] = [
        ("metadata_header", "CREATE TABLE metadata_header (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), json BLOB NOT NULL, mac BLOB NOT NULL CHECK(length(mac) = 32))"),
        ("metadata_operations", "CREATE TABLE metadata_operations (sequence INTEGER PRIMARY KEY CHECK(sequence > 0), json BLOB NOT NULL, mac BLOB NOT NULL CHECK(length(mac) = 32))"),
    ]
    private static let applicationID: Int64 = 0x42434d31
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    let databaseURL: URL
    private let keyURL: URL
    private let coreKeyParent: URL
    private let expectedScopeID: UUID
    private let freshnessStore: any FreshnessAnchorStore
    private let secretCorpus: RuntimeSecretCorpus
    private let processLock: StorageProcessLock
    private let historyOnly: Bool
    private let lock = NSLock()
    private var authenticator: SidecarAuthenticator!
    private var database: OpaquePointer?
    private var fileDescriptor: Int32 = -1
    private var quarantined = false

    convenience init(databaseURL: URL, keyURL: URL, coreKeyURL: URL,
                     freshnessStore: any FreshnessAnchorStore,
                     secretCorpus: RuntimeSecretCorpus, creating mapping: Mapping,
                     coreCheckpoint: CoreCheckpoint? = nil) throws {
        try self.init(databaseURL: databaseURL, keyURL: keyURL, coreKeyURL: coreKeyURL,
                      freshnessStore: freshnessStore, secretCorpus: secretCorpus,
                      scopeID: mapping.authority.scopeID, creating: mapping, core: coreCheckpoint)
    }

    convenience init(databaseURL: URL, keyURL: URL, coreKeyURL: URL,
                     freshnessStore: any FreshnessAnchorStore,
                     secretCorpus: RuntimeSecretCorpus, opening expectedScopeID: UUID) throws {
        try self.init(databaseURL: databaseURL, keyURL: keyURL, coreKeyURL: coreKeyURL,
                      freshnessStore: freshnessStore, secretCorpus: secretCorpus,
                      scopeID: expectedScopeID, creating: nil, core: nil)
    }

    private init(databaseURL: URL, keyURL: URL, coreKeyURL: URL,
                 freshnessStore: any FreshnessAnchorStore, secretCorpus: RuntimeSecretCorpus,
                 scopeID: UUID, creating mapping: Mapping?, core: CoreCheckpoint?) throws {
        self.databaseURL = Self.normalized(databaseURL)
        self.keyURL = Self.normalized(keyURL)
        let coreKey = Self.normalized(coreKeyURL)
        coreKeyParent = coreKey.deletingLastPathComponent()
        guard databaseURL.isFileURL, keyURL.isFileURL, coreKeyURL.isFileURL,
              self.databaseURL.deletingLastPathComponent() == self.keyURL.deletingLastPathComponent(),
              self.databaseURL != self.keyURL,
              coreKey.deletingLastPathComponent() != self.keyURL.deletingLastPathComponent() else {
            throw Self.failure("paths_invalid")
        }
        expectedScopeID = scopeID
        self.freshnessStore = freshnessStore
        self.secretCorpus = secretCorpus
        historyOnly = mapping == nil
        processLock = try StorageProcessLock(keyURL: self.keyURL, allowParentCreation: mapping != nil)
        do {
            try processLock.withLock {
                try verifyDistinctLockParents()
                if let mapping {
                    try Self.validate(mapping)
                    try assertPublic(Self.mappingObject(mapping))
                    guard !Self.exists(self.databaseURL), !Self.exists(self.keyURL),
                          try freshnessStore.load() == nil else { throw Self.failure("already_exists") }
                    try rejectSidecars()
                    let initial = try freshnessStore.create(.initializing(storageSlot: freshnessStore.storageSlot))
                    let key = try ExternalStorageKeyStore.loadOrCreate(at: self.keyURL, allowCreate: true)
                    authenticator = SidecarAuthenticator(storageKey: key)
                    try verifyKeyFile()
                    try openDatabase(creating: true)
                    try configure(create: true)
                    let header: [String: Any] = [
                        "schema_version": Format.v2.version,
                        "database_id": initial.record.checkpoint.databaseID,
                        "mapping": Self.mappingObject(mapping),
                        "initial_core": Self.optionalCheckpointObject(core),
                    ]
                    let bytes = try canonical(header)
                    let mac = authenticator.authenticationCode(domain: Format.v2.headerDomain,
                        identity: scopeID.uuidString, canonicalJSON: bytes)
                    try transaction {
                        for (_, sql) in Format.v2.tables { try execute(sql) }
                        try execute("PRAGMA user_version = 2")
                        try execute("PRAGMA application_id = \(Self.applicationID)")
                        try insert(table: "metadata_header", key: 1, bytes: bytes, mac: mac)
                    }
                    // A durable directory entry precedes publication of the anchor.
                    try synchronizeParent()
                    let checkpoint = try FreshnessCheckpoint(databaseID: initial.record.checkpoint.databaseID,
                        generation: 0, sequence: 0, headMAC: mac)
                    _ = try freshnessStore.compareAndSwap(expectedRevision: initial.revision,
                        replacement: .committed(storageSlot: freshnessStore.storageSlot, checkpoint: checkpoint))
                } else {
                    guard Self.exists(self.databaseURL), Self.exists(self.keyURL) else {
                        throw Self.failure("missing")
                    }
                    try rejectSidecars()
                    let key = try ExternalStorageKeyStore.loadOrCreate(at: self.keyURL, allowCreate: false)
                    authenticator = SidecarAuthenticator(storageKey: key)
                    try verifyKeyFile()
                    try openDatabase(creating: false)
                    try configure(create: false)
                    let state = try verify()
                    guard state.core != nil else { throw Self.failure("incomplete") }
                }
            }
        } catch {
            if let database { sqlite3_close(database); self.database = nil }
            if fileDescriptor >= 0 { close(fileDescriptor); fileDescriptor = -1 }
            throw error
        }
    }

    deinit {
        if let database { sqlite3_close(database) }
        if fileDescriptor >= 0 { close(fileDescriptor) }
    }

    /// Holds the metadata thread/process lock across prepare, ONE core call and
    /// finalize. Closures must be synchronous and must not reenter this store.
    /// Core and metadata key parents must differ to avoid nested lock aliasing.
    /// An error after admission quarantines this instance; no core call is retried.
    @discardableResult
    func withMutation<T>(operationID: UUID, binding: CoordinatorBinding? = nil,
                         replayKey: ClaudeReplayKey? = nil,
                         crashPoint: CrashPoint? = nil,
                         readCoreCheckpoint: () throws -> CoreCheckpoint?,
                         _ mutation: () throws -> T) throws -> T {
        try lock.withLock {
            guard !historyOnly else { throw Self.failure("history_only") }
            guard !quarantined else { throw Self.failure("quarantined") }
            return try processLock.withLock {
                let state: Verified
                do {
                    try verifyDistinctLockParents()
                    state = try verify()
                    guard try readCoreCheckpoint() == state.core else { throw Self.failure("core_mismatch") }
                } catch { quarantined = true; throw error }
                if let replayKey {
                    try Self.validateReplayKey(replayKey)
                    try assertPublic(Self.replayObject(replayKey))
                }
                do {
                    if let replayKey, try lookupReplay(replayKey) != nil { throw Self.failure("replay") }
                    guard try lookupOperation(operationID) == nil else { throw Self.failure("operation_replay") }
                } catch {
                    if !["claude_metadata_operation_replay", "claude_metadata_replay"].contains(error.coordinatorError.code) {
                        quarantined = true
                    }
                    throw error
                }
                try validateBinding(binding, mapping: state.mapping)
                if let binding { try assertPublic(binding.jsonObject) }
                do {
                    try crash(.beforePrepare, selected: crashPoint)
                    let prepared = try append(phase: "prepared", operationID: operationID,
                        replayKey: replayKey, binding: binding, core: state.core, previous: state.checkpoint, crashPoint: crashPoint)
                    let preparedState = try verify(allowPrepared: true)
                    guard preparedState.checkpoint == prepared, preparedState.preparedOperationID == operationID else {
                        throw Self.failure("operation_order_invalid")
                    }
                    try crash(.afterPrepare, selected: crashPoint)
                    let result = try mutation()
                    try crash(.afterCoreCommit, selected: crashPoint)
                    guard let after = try readCoreCheckpoint() else { throw Self.failure("core_missing") }
                    try Self.validateProgress(from: state.core, to: after)
                    _ = try append(phase: "finalized", operationID: operationID,
                        replayKey: replayKey, binding: binding, core: after, previous: prepared, crashPoint: crashPoint)
                    _ = try verify()
                    try crash(.afterFinalize, selected: crashPoint)
                    return result
                } catch { quarantined = true; throw error }
            }
        }
    }

    /// Consumes an audit tombstone, never restoring or granting live authority.
    /// Must be called outside an existing metadata mutation bracket.
    func consumeReplayID(_ key: ClaudeReplayKey, operationID: UUID,
                         readCoreCheckpoint: () throws -> CoreCheckpoint?) throws {
        try withMutation(operationID: operationID, replayKey: key,
            readCoreCheckpoint: readCoreCheckpoint) {}
    }

    func authenticatedSummary(coreCheckpoint: CoreCheckpoint) throws -> Summary {
        try lock.withLock {
            guard !quarantined else { throw Self.failure("quarantined") }
            return try processLock.withLock {
                do {
                    let state = try verify()
                    guard state.core == coreCheckpoint else { throw Self.failure("core_mismatch") }
                    return Summary(mapping: state.mapping, metadataCheckpoint: state.checkpoint,
                        coreCheckpoint: coreCheckpoint, operationCount: state.operationCount)
                } catch { quarantined = true; throw error }
            }
        }
    }

    /// Returns only verified audit data. Does not create core events, credentials,
    /// an OwnerHandle/Ticket, a native adapter or a renewable authority instance.
    func authenticatedHistory(coreCheckpoint: CoreCheckpoint) throws -> History {
        try lock.withLock {
            guard !quarantined else { throw Self.failure("quarantined") }
            return try processLock.withLock {
                do {
                    var operations: [Operation] = []
                    let state = try verify(collectOperation: { operations.append($0) })
                    guard state.core == coreCheckpoint else { throw Self.failure("core_mismatch") }
                    return History(mapping: state.mapping, operations: operations,
                        metadataCheckpoint: state.checkpoint, coreCheckpoint: coreCheckpoint)
                } catch { quarantined = true; throw error }
            }
        }
    }

    private func verify(allowPrepared: Bool = false,
                        collectOperation: ((Operation) -> Void)? = nil) throws -> Verified {
        try verifyFileIdentity()
        try verifyKeyFile()
        try rejectSidecars()
        let format = try verifySchema()
        guard let stored = try freshnessStore.load(), stored.record.state == .committed else {
            throw Self.failure("freshness_unconfirmed")
        }
        let header = try singleRow("SELECT singleton, json, mac FROM metadata_header")
        guard header.sequence == 1 else { throw Self.failure("header_invalid") }
        let object = try decode(header.bytes)
        guard Set(object.keys) == ["schema_version", "database_id", "mapping", "initial_core"],
              object["schema_version"] as? String == format.version,
              let databaseID = object["database_id"] as? String,
              let mappingObject = object["mapping"] as? [String: Any],
              authenticator.verify(header.mac, domain: format.headerDomain,
                identity: expectedScopeID.uuidString, canonicalJSON: header.bytes) else {
            throw Self.failure("header_invalid")
        }
        let mapping = try Self.decodeMapping(mappingObject)
        guard mapping.authority.scopeID == expectedScopeID else { throw Self.failure("scope_mismatch") }
        var core = try Self.decodeOptionalCheckpoint(object["initial_core"])
        var checkpoint = try FreshnessCheckpoint(databaseID: databaseID, generation: 0,
            sequence: 0, headMAC: header.mac)
        var pending: (id: UUID, replayKey: ClaudeReplayKey?, binding: CoordinatorBinding?, before: CoreCheckpoint?)?
        var operationCount: Int64 = 0
        var preparedCount: Int64 = 0
        var replayCount: Int64 = 0
        let operationLookup = format == .v2 ? try prepare("SELECT first_sequence FROM metadata_operation_lookup WHERE operation_id = ?") : nil
        defer { if let operationLookup { sqlite3_finalize(operationLookup) } }
        let replayLookup = format == .v2 ? try prepare("SELECT first_sequence FROM metadata_replay_lookup WHERE kind = ? AND replay_id = ?") : nil
        defer { if let replayLookup { sqlite3_finalize(replayLookup) } }
        let recordKeys: Set<String> = ["schema_version", "database_id", "scope_id", "sequence", "previous_mac", "operation_id", "phase", "binding", "core"]
        try scanRows("SELECT sequence, json, mac FROM metadata_operations ORDER BY sequence") { row in
            let next = try Self.nextSequence(checkpoint.sequence)
            let record = try decode(row.bytes)
            guard row.sequence == next,
                  Set(record.keys) == (format == .v2 ? recordKeys.union(["replay_key"]) : recordKeys),
                  record["schema_version"] as? String == format.version,
                  record["database_id"] as? String == databaseID,
                  record["scope_id"] as? String == expectedScopeID.uuidString.lowercased(),
                  ExactJSONInteger.int64(record["sequence"], minimum: 1) == next,
                  record["previous_mac"] as? String == checkpoint.headMAC.base64EncodedString(),
                  let operationID = Self.uuid(record["operation_id"]),
                  let phase = record["phase"] as? String,
                  authenticator.verify(row.mac, domain: format.recordDomain,
                    identity: databaseID, canonicalJSON: row.bytes) else { throw Self.failure("record_invalid") }
            let binding = try Self.decodeBinding(record["binding"])
            try validateBinding(binding, mapping: mapping)
            let recordCore = try Self.decodeOptionalCheckpoint(record["core"])
            let replayKey = format == .v2 ? try Self.decodeReplayKey(record["replay_key"]) : nil
            if phase == "prepared" {
                guard pending == nil, recordCore == core else {
                    throw Self.failure("operation_order_invalid")
                }
                if let operationLookup {
                    guard try firstSequence(operationLookup, values: [operationID.uuidString.lowercased()]) == next else {
                        throw Self.failure("lookup_invalid")
                    }
                } else {
                    // Legacy files have no lookup tables. Verify uniqueness with
                    // a bounded-memory prefix scan; never migrate a history read.
                    try verifyLegacyFirstOperation(operationID, sequence: next)
                }
                preparedCount = try Self.nextSequence(preparedCount)
                if let replayKey, let replayLookup {
                    guard try firstSequence(replayLookup, values: [replayKey.kind.rawValue, replayKey.id]) == next else {
                        throw Self.failure("lookup_invalid")
                    }
                    replayCount = try Self.nextSequence(replayCount)
                }
                pending = (operationID, replayKey, binding, core)
            } else if phase == "finalized", let preparing = pending, let after = recordCore {
                guard preparing.id == operationID, preparing.replayKey == replayKey, preparing.binding == binding else {
                    throw Self.failure("operation_order_invalid")
                }
                try Self.validateProgress(from: preparing.before, to: after)
                collectOperation?(Operation(operationID: operationID, replayKey: replayKey, binding: binding,
                    before: preparing.before, after: after))
                operationCount = try Self.nextSequence(operationCount)
                core = after
                pending = nil
            } else { throw Self.failure("operation_order_invalid") }
            checkpoint = try FreshnessCheckpoint(databaseID: databaseID, generation: next,
                sequence: next, headMAC: row.mac)
        }
        if format == .v2 {
            guard try scalar("SELECT COUNT(*) FROM metadata_operation_lookup") == preparedCount,
                  try scalar("SELECT COUNT(*) FROM metadata_replay_lookup") == replayCount else {
                throw Self.failure("lookup_invalid")
            }
        }
        guard checkpoint == stored.record.checkpoint else { throw Self.failure("rollback_or_fork") }
        guard pending == nil || allowPrepared else { throw Self.failure("incomplete") }
        return Verified(mapping: mapping, operationCount: operationCount, checkpoint: checkpoint, core: core,
                        preparedOperationID: pending?.id)
    }

    private func append(phase: String, operationID: UUID, replayKey: ClaudeReplayKey?, binding: CoordinatorBinding?,
                        core: CoreCheckpoint?, previous: FreshnessCheckpoint,
                        crashPoint: CrashPoint?) throws -> FreshnessCheckpoint {
        try verifyFileIdentity()
        if phase == "finalized" {
            let prepared = try verify(allowPrepared: true)
            guard prepared.checkpoint == previous, prepared.preparedOperationID == operationID else {
                throw Self.failure("operation_order_invalid")
            }
        }
        guard let stored = try freshnessStore.load(), stored.record.state == .committed,
              stored.record.checkpoint == previous else { throw Self.failure("freshness_unconfirmed") }
        let sequence = try Self.nextSequence(previous.sequence)
        let object: [String: Any] = [
            "schema_version": Format.v2.version, "database_id": previous.databaseID,
            "scope_id": expectedScopeID.uuidString.lowercased(), "sequence": sequence,
            "previous_mac": previous.headMAC.base64EncodedString(),
            "operation_id": operationID.uuidString.lowercased(), "phase": phase,
            "replay_key": Self.replayObject(replayKey),
            "binding": binding.map { $0.jsonObject as Any } ?? NSNull(),
            "core": Self.optionalCheckpointObject(core),
        ]
        let bytes = try canonical(object)
        let mac = authenticator.authenticationCode(domain: Format.v2.recordDomain,
            identity: previous.databaseID, canonicalJSON: bytes)
        let next = try FreshnessCheckpoint(databaseID: previous.databaseID, generation: sequence,
            sequence: sequence, headMAC: mac)
        let transition = try FreshnessPendingTransition(from: previous, to: next,
            batchDigest: Data(SHA256.hash(data: bytes)))
        let pending = try freshnessStore.compareAndSwap(expectedRevision: stored.revision,
            replacement: .pending(storageSlot: freshnessStore.storageSlot, transition: transition))
        try crash(phase == "prepared" ? .afterPrepareFreshnessPending : .afterFinalizeFreshnessPending, selected: crashPoint)
        try transaction {
            // The independent-anchor call above is outside SQLite's lock. A
            // competing schema change must not make a fake INSERT appear done.
            guard try verifySchema() == .v2 else { throw Self.failure("schema_invalid") }
            try insert(table: "metadata_operations", key: sequence, bytes: bytes, mac: mac)
            if phase == "prepared" {
                try insertLookup("INSERT INTO metadata_operation_lookup VALUES (?, ?)",
                    values: [operationID.uuidString.lowercased()], sequence: sequence)
                if let replayKey {
                    try insertLookup("INSERT INTO metadata_replay_lookup VALUES (?, ?, ?)",
                        values: [replayKey.kind.rawValue, replayKey.id], sequence: sequence)
                }
            }
        }
        try crash(phase == "prepared" ? .afterPrepareSQLiteCommit : .afterFinalizeSQLiteCommit, selected: crashPoint)
        _ = try freshnessStore.compareAndSwap(expectedRevision: pending.revision,
            replacement: .committed(storageSlot: freshnessStore.storageSlot, checkpoint: next))
        return next
    }

    private static func validateProgress(from: CoreCheckpoint?, to: CoreCheckpoint) throws {
        guard let from else { return }
        guard from.databaseID == to.databaseID,
              (from == to || (to.generation > from.generation && to.sequence > from.sequence)) else {
            throw failure("core_mismatch")
        }
    }

    private static func validate(_ mapping: Mapping) throws {
        for value in [mapping.coreProjectID, mapping.coreSessionID] {
            guard !value.isEmpty, value.unicodeScalars.count <= 512,
                  value == value.precomposedStringWithCanonicalMapping,
                  !value.contains("\0") else { throw failure("mapping_invalid") }
        }
        let cwd = mapping.canonicalCWD
        // Historical metadata remains readable after the project is moved or
        // removed. Active enrollment separately requires the physical directory.
        guard ClaudeCanonicalDirectory.isNormalizedAbsolute(cwd),
              mapping.channelSource.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression)?.upperBound == mapping.channelSource.endIndex,
              OperationalRuntimeIdentity.isValid(mapping.runtimeIdentity) else { throw failure("mapping_invalid") }
    }

    private func validateBinding(_ binding: CoordinatorBinding?, mapping: Mapping) throws {
        if let binding {
            guard binding.projectID == mapping.coreProjectID, binding.sessionID == mapping.coreSessionID else {
                throw Self.failure("binding_mismatch")
            }
        }
    }

    private static func mappingObject(_ mapping: Mapping) -> [String: Any] {
        let identity = mapping.authority
        return ["scope_id": identity.scopeID.uuidString.lowercased(),
            "native_session_id": identity.nativeSessionID.uuidString.lowercased(),
            "session_incarnation": identity.sessionIncarnation.uuidString.lowercased(),
            "service_incarnation": identity.serviceIncarnation.uuidString.lowercased(),
            "owner_connection_id": identity.ownerConnectionID.uuidString.lowercased(),
            "authority_epoch": identity.authorityEpoch.uuidString.lowercased(),
            "core_project_id": mapping.coreProjectID, "core_session_id": mapping.coreSessionID,
            "canonical_cwd": mapping.canonicalCWD, "channel_source": mapping.channelSource,
            "runtime_identity": mapping.runtimeIdentity]
    }

    private static func decodeMapping(_ object: [String: Any]) throws -> Mapping {
        guard Set(object.keys) == ["scope_id", "native_session_id", "session_incarnation", "service_incarnation", "owner_connection_id", "authority_epoch", "core_project_id", "core_session_id", "canonical_cwd", "channel_source", "runtime_identity"],
              let scope = uuid(object["scope_id"]), let native = uuid(object["native_session_id"]),
              let session = uuid(object["session_incarnation"]), let service = uuid(object["service_incarnation"]),
              let owner = uuid(object["owner_connection_id"]), let epoch = uuid(object["authority_epoch"]),
              let project = object["core_project_id"] as? String, let coreSession = object["core_session_id"] as? String,
              let cwd = object["canonical_cwd"] as? String, let source = object["channel_source"] as? String,
              let runtime = object["runtime_identity"] as? String else { throw failure("mapping_invalid") }
        let mapping = Mapping(authority: .init(scopeID: scope, nativeSessionID: native,
            sessionIncarnation: session, serviceIncarnation: service, ownerConnectionID: owner, authorityEpoch: epoch),
            coreProjectID: project, coreSessionID: coreSession, canonicalCWD: cwd,
            channelSource: source, runtimeIdentity: runtime)
        try validate(mapping)
        return mapping
    }

    private static func optionalCheckpointObject(_ checkpoint: CoreCheckpoint?) -> Any {
        guard let checkpoint else { return NSNull() }
        return ["database_id": checkpoint.databaseID, "generation": checkpoint.generation,
                "sequence": checkpoint.sequence, "head_mac": checkpoint.headMAC.base64EncodedString()] as [String: Any]
    }

    private static func decodeOptionalCheckpoint(_ value: Any?) throws -> CoreCheckpoint? {
        if value is NSNull { return nil }
        guard let object = value as? [String: Any],
              Set(object.keys) == ["database_id", "generation", "sequence", "head_mac"],
              let id = object["database_id"] as? String,
              let generation = ExactJSONInteger.int64(object["generation"], minimum: 0),
              let sequence = ExactJSONInteger.int64(object["sequence"], minimum: 0),
              let text = object["head_mac"] as? String, let mac = Data(base64Encoded: text),
              mac.base64EncodedString() == text else { throw failure("checkpoint_invalid") }
        return try FreshnessCheckpoint(databaseID: id, generation: generation, sequence: sequence, headMAC: mac)
    }

    private static func decodeBinding(_ value: Any?) throws -> CoordinatorBinding? {
        if value is NSNull { return nil }
        guard let object = value as? [String: Any], Set(object.keys) == ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id", "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence"] else {
            throw failure("binding_invalid")
        }
        return try CoordinatorBinding(jsonObject: object)
    }

    private static func validateReplayKey(_ key: ClaudeReplayKey) throws {
        _ = try ClaudeReplayKey(kind: key.kind, id: key.id)
    }

    private static func replayObject(_ key: ClaudeReplayKey?) -> Any {
        guard let key else { return NSNull() }
        return ["kind": key.kind.rawValue, "id": key.id]
    }

    private static func decodeReplayKey(_ value: Any?) throws -> ClaudeReplayKey? {
        if value is NSNull { return nil }
        guard let object = value as? [String: Any], Set(object.keys) == ["kind", "id"],
              let kindString = object["kind"] as? String, let kind = ClaudeReplayKind(rawValue: kindString),
              let id = object["id"] as? String else { throw failure("replay_key_invalid") }
        do { return try ClaudeReplayKey(kind: kind, id: id) }
        catch { throw failure("replay_key_invalid") }
    }

    private func lookupOperation(_ id: UUID) throws -> Int64? {
        let statement = try prepare("SELECT first_sequence FROM metadata_operation_lookup WHERE operation_id = ?")
        defer { sqlite3_finalize(statement) }
        return try firstSequence(statement, values: [id.uuidString.lowercased()])
    }

    private func lookupReplay(_ key: ClaudeReplayKey) throws -> Int64? {
        let statement = try prepare("SELECT first_sequence FROM metadata_replay_lookup WHERE kind = ? AND replay_id = ?")
        defer { sqlite3_finalize(statement) }
        return try firstSequence(statement, values: [key.kind.rawValue, key.id])
    }

    private func bindTexts(_ values: [String], to statement: OpaquePointer) throws {
        for (index, value) in values.enumerated() {
            guard value.withCString({ sqlite3_bind_text(statement, Int32(index + 1), $0, -1, Self.transient) }) == SQLITE_OK else {
                throw Self.failure("sqlite_failed")
            }
        }
    }

    private func firstSequence(_ statement: OpaquePointer, values: [String]) throws -> Int64? {
        defer { sqlite3_reset(statement); sqlite3_clear_bindings(statement) }
        try bindTexts(values, to: statement)
        let status = sqlite3_step(statement)
        if status == SQLITE_DONE { return nil }
        guard status == SQLITE_ROW, sqlite3_column_type(statement, 0) == SQLITE_INTEGER,
              sqlite3_column_int64(statement, 0) > 0 else { throw Self.failure("lookup_invalid") }
        let result = sqlite3_column_int64(statement, 0)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw Self.failure("lookup_invalid") }
        return result
    }

    private func insertLookup(_ sql: String, values: [String], sequence: Int64) throws {
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        try bindTexts(values, to: statement)
        guard sqlite3_bind_int64(statement, Int32(values.count + 1), sequence) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_DONE, sqlite3_changes(database) == 1 else {
            throw Self.failure("write_failed")
        }
    }

    private func verifyLegacyFirstOperation(_ id: UUID, sequence: Int64) throws {
        try scanRows("SELECT sequence, json, mac FROM metadata_operations WHERE sequence < \(sequence) ORDER BY sequence") { row in
            let object = try decode(row.bytes)
            guard object["phase"] as? String != "prepared" || Self.uuid(object["operation_id"]) != id else {
                throw Self.failure("operation_order_invalid")
            }
        }
    }

    private static func uuid(_ value: Any?) -> UUID? {
        guard let text = value as? String, let value = UUID(uuidString: text),
              value.uuidString.lowercased() == text else { return nil }
        return value
    }

    private func canonical(_ value: [String: Any]) throws -> Data {
        try assertPublic(value)
        return try StrictJSONTransport.data(forJSONObject: value)
    }

    private func decode(_ bytes: Data) throws -> [String: Any] {
        let object = try StrictJSONTransport.object(from: bytes)
        guard try canonical(object) == bytes else { throw Self.failure("noncanonical") }
        return object
    }

    private func assertPublic(_ value: Any) throws {
        if let text = value as? String {
            guard !secretCorpus.containsKnownSecret(in: Data(text.utf8)) else { throw Self.failure("secret_reflection") }
        } else if let object = value as? [String: Any] {
            for (key, child) in object { try assertPublic(key); try assertPublic(child) }
        } else if let array = value as? [Any] {
            for child in array { try assertPublic(child) }
        }
    }

    private static func nextSequence(_ value: Int64) throws -> Int64 {
        let (next, overflow) = value.addingReportingOverflow(1)
        guard !overflow else { throw failure("sequence_exhausted") }
        return next
    }

    private func crash(_ point: CrashPoint, selected: CrashPoint?) throws {
        if selected == point { throw Self.failure("injected_" + point.rawValue) }
    }

    private static func normalized(_ url: URL) -> URL {
        var path = url.standardizedFileURL.path
        if path == "/var" || path.hasPrefix("/var/") { path = "/private" + path }
        if path == "/tmp" || path.hasPrefix("/tmp/") { path = "/private" + path }
        return URL(fileURLWithPath: path)
    }

    private static func exists(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0 || errno != ENOENT
    }

    private func rejectSidecars() throws {
        for suffix in ["-wal", "-shm", "-journal"] {
            guard !Self.exists(URL(fileURLWithPath: databaseURL.path + suffix)) else { throw Self.failure("unconfirmed_sidecar") }
        }
    }

    private func verifyKeyFile() throws {
        var info = stat()
        guard lstat(keyURL.path, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_uid == geteuid(), info.st_mode & 0o777 == 0o600, info.st_nlink == 1,
              info.st_size == 32 else { throw Self.failure("key_unsafe") }
        let current = SidecarAuthenticator(storageKey: try ExternalStorageKeyStore.loadOrCreate(at: keyURL, allowCreate: false))
        let proof = Data("metadata-key-continuity".utf8)
        guard authenticator.verify(current.authenticationCode(domain: Self.headerDomain,
            identity: expectedScopeID.uuidString, canonicalJSON: proof), domain: Self.headerDomain,
            identity: expectedScopeID.uuidString, canonicalJSON: proof) else { throw Self.failure("key_changed") }
    }

    private func verifyDistinctLockParents() throws {
        var metadata = stat(), core = stat()
        guard stat(keyURL.deletingLastPathComponent().path, &metadata) == 0 else {
            throw Self.failure("paths_invalid")
        }
        if stat(coreKeyParent.path, &core) == 0 {
            // Case-insensitive aliases or a symlink must not conceal the same
            // parent lock and deadlock when the core callback enters its lock.
            guard metadata.st_dev != core.st_dev || metadata.st_ino != core.st_ino else {
                throw Self.failure("paths_invalid")
            }
        } else if errno != ENOENT { throw Self.failure("paths_invalid") }
    }

    private func openDatabase(creating: Bool) throws {
        let flags = (creating ? O_RDWR | O_CREAT | O_EXCL : O_RDONLY) | O_NOFOLLOW | O_CLOEXEC
        fileDescriptor = open(databaseURL.path, flags, mode_t(0o600))
        guard fileDescriptor >= 0 else { throw Self.failure("file_unsafe") }
        try verifyFileIdentity()
        let sqliteFlags = (creating ? SQLITE_OPEN_READWRITE : SQLITE_OPEN_READONLY) | SQLITE_OPEN_FULLMUTEX | SQLITE_OPEN_NOFOLLOW
        guard sqlite3_open_v2(databaseURL.path, &database, sqliteFlags, nil) == SQLITE_OK else { throw Self.failure("sqlite_unavailable") }
        try verifyFileIdentity()
    }

    private func verifyFileIdentity() throws {
        var opened = stat(), entry = stat()
        guard fileDescriptor >= 0, fstat(fileDescriptor, &opened) == 0,
              lstat(databaseURL.path, &entry) == 0,
              opened.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              entry.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              opened.st_uid == geteuid(), entry.st_uid == geteuid(),
              opened.st_mode & 0o777 == 0o600, entry.st_mode & 0o777 == 0o600,
              opened.st_nlink == 1, entry.st_nlink == 1,
              opened.st_dev == entry.st_dev, opened.st_ino == entry.st_ino else { throw Self.failure("file_unsafe") }
    }

    private func configure(create: Bool) throws {
        guard sqlite3_busy_timeout(database, 5000) == SQLITE_OK else { throw Self.failure("sqlite_unavailable") }
        try execute("PRAGMA trusted_schema = OFF")
        if create {
            try execute("PRAGMA journal_mode = DELETE")
            try execute("PRAGMA synchronous = FULL")
        } else { try execute("PRAGMA query_only = ON") }
    }

    private func verifySchema() throws -> Format {
        guard let format = Format(rawValue: try scalar("PRAGMA user_version")),
              try scalar("PRAGMA application_id") == Self.applicationID else { throw Self.failure("schema_invalid") }
        let tables = format.tables
        let statement = try prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name")
        defer { sqlite3_finalize(statement) }
        var count = 0
        while sqlite3_step(statement) == SQLITE_ROW {
            guard count < tables.count,
                  sqlite3_column_type(statement, 0) == SQLITE_TEXT,
                  sqlite3_column_type(statement, 1) == SQLITE_TEXT,
                  sqlite3_column_type(statement, 2) == SQLITE_TEXT,
                  String(cString: sqlite3_column_text(statement, 0)) == "table",
                  String(cString: sqlite3_column_text(statement, 1)) == tables[count].0,
                  String(cString: sqlite3_column_text(statement, 2)) == tables[count].1 else {
                throw Self.failure("schema_invalid")
            }
            count += 1
        }
        guard sqlite3_errcode(database) == SQLITE_OK || sqlite3_errcode(database) == SQLITE_DONE,
              count == tables.count else { throw Self.failure("schema_invalid") }
        return format
    }

    private struct Row { let sequence: Int64; let bytes: Data; let mac: Data }
    private func scanRows(_ sql: String, _ visit: (Row) throws -> Void) throws {
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return }
            guard status == SQLITE_ROW, sqlite3_column_type(statement, 0) == SQLITE_INTEGER,
                  sqlite3_column_type(statement, 1) == SQLITE_BLOB,
                  sqlite3_column_type(statement, 2) == SQLITE_BLOB,
                  sqlite3_column_bytes(statement, 1) > 0, sqlite3_column_bytes(statement, 1) <= 65_536,
                  sqlite3_column_bytes(statement, 2) == 32 else { throw Self.failure("row_invalid") }
            try autoreleasepool {
                try visit(Row(sequence: sqlite3_column_int64(statement, 0),
                    bytes: Data(bytes: sqlite3_column_blob(statement, 1)!, count: Int(sqlite3_column_bytes(statement, 1))),
                    mac: Data(bytes: sqlite3_column_blob(statement, 2)!, count: 32)))
            }
        }
    }

    private func singleRow(_ sql: String) throws -> Row {
        var result: Row?
        try scanRows(sql) { row in
            guard result == nil else { throw Self.failure("row_invalid") }
            result = row
        }
        guard let result else { throw Self.failure("row_invalid") }
        return result
    }

    private func insert(table: String, key: Int64, bytes: Data, mac: Data) throws {
        let statement = try prepare("INSERT INTO \(table) VALUES (?, ?, ?)")
        defer { sqlite3_finalize(statement) }
        guard sqlite3_bind_int64(statement, 1, key) == SQLITE_OK,
              bytes.withUnsafeBytes({ sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), Self.transient) }) == SQLITE_OK,
              mac.withUnsafeBytes({ sqlite3_bind_blob(statement, 3, $0.baseAddress, Int32($0.count), Self.transient) }) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_DONE, sqlite3_changes(database) == 1 else { throw Self.failure("write_failed") }
        let column = table == "metadata_header" ? "singleton" : "sequence"
        let inserted = try singleRow("SELECT \(column), json, mac FROM \(table) WHERE \(column) = \(key)")
        guard inserted.sequence == key,
              inserted.bytes == bytes, inserted.mac == mac else { throw Self.failure("write_failed") }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw Self.failure("sqlite_failed")
        }
        return statement
    }

    private func scalar(_ sql: String) throws -> Int64 {
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW, sqlite3_column_type(statement, 0) == SQLITE_INTEGER else {
            throw Self.failure("sqlite_failed")
        }
        return sqlite3_column_int64(statement, 0)
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw Self.failure("sqlite_failed") }
    }

    private func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try execute("COMMIT")
            return result
        } catch { try? execute("ROLLBACK"); throw error }
    }

    private func synchronizeParent() throws {
        let descriptor = open(databaseURL.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw Self.failure("sync_failed") }
        defer { close(descriptor) }
        guard fsync(descriptor) == 0 else { throw Self.failure("sync_failed") }
    }

    private static func failure(_ suffix: String) -> CoordinatorError {
        CoordinatorError("claude_metadata_" + suffix)
    }
}

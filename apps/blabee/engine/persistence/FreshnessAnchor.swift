import CryptoKit
import Foundation

public struct FreshnessCheckpoint: Sendable, Equatable {
    public let databaseID: String
    public let generation: Int64
    public let sequence: Int64
    public let headMAC: Data

    public init(
        databaseID: String,
        generation: Int64,
        sequence: Int64,
        headMAC: Data
    ) throws {
        guard let uuid = UUID(uuidString: databaseID), uuid.uuidString == databaseID else {
            throw CoordinatorError("freshness_anchor_corrupt", "database identity is invalid")
        }
        try require(generation >= 0, "freshness_anchor_corrupt", "freshness generation is negative")
        try require(sequence >= 0, "freshness_anchor_corrupt", "freshness sequence is negative")
        try require(headMAC.count == 32, "freshness_anchor_corrupt", "freshness head size is invalid")
        self.databaseID = databaseID
        self.generation = generation
        self.sequence = sequence
        self.headMAC = headMAC
    }
}

public struct FreshnessPendingTransition: Sendable, Equatable {
    public let from: FreshnessCheckpoint
    public let to: FreshnessCheckpoint
    public let batchDigest: Data
    public let transitionID: String

    public init(
        from: FreshnessCheckpoint,
        to: FreshnessCheckpoint,
        batchDigest: Data,
        transitionID: String = UUID().uuidString
    ) throws {
        guard let uuid = UUID(uuidString: transitionID), uuid.uuidString == transitionID else {
            throw CoordinatorError("freshness_anchor_corrupt", "transition identity is invalid")
        }
        let (nextGeneration, generationOverflow) = from.generation.addingReportingOverflow(1)
        try require(
            !generationOverflow
                && to.databaseID == from.databaseID
                && to.generation == nextGeneration
                && to.sequence > from.sequence,
            "freshness_anchor_corrupt",
            "pending transition checkpoints are invalid"
        )
        try require(batchDigest.count == 32, "freshness_anchor_corrupt", "batch digest size is invalid")
        self.from = from
        self.to = to
        self.batchDigest = batchDigest
        self.transitionID = transitionID
    }
}

public enum FreshnessState: String, Sendable {
    case initializing
    case committed
    case pending
}

public struct FreshnessRecord: Sendable, Equatable {
    public static let recordVersion = 1

    public let storageSlot: String
    public let state: FreshnessState
    public let checkpoint: FreshnessCheckpoint
    public let pendingTransition: FreshnessPendingTransition?

    public static func initializing(
        storageSlot: String,
        databaseID: String = UUID().uuidString
    ) throws -> FreshnessRecord {
        try FreshnessRecord(
            storageSlot: storageSlot,
            state: .initializing,
            checkpoint: FreshnessCheckpoint(
                databaseID: databaseID,
                generation: 0,
                sequence: 0,
                headMAC: Data(repeating: 0, count: 32)
            ),
            pendingTransition: nil
        )
    }

    public static func committed(
        storageSlot: String,
        checkpoint: FreshnessCheckpoint
    ) throws -> FreshnessRecord {
        try FreshnessRecord(
            storageSlot: storageSlot,
            state: .committed,
            checkpoint: checkpoint,
            pendingTransition: nil
        )
    }

    public static func pending(
        storageSlot: String,
        transition: FreshnessPendingTransition
    ) throws -> FreshnessRecord {
        try FreshnessRecord(
            storageSlot: storageSlot,
            state: .pending,
            checkpoint: transition.from,
            pendingTransition: transition
        )
    }

    private init(
        storageSlot: String,
        state: FreshnessState,
        checkpoint: FreshnessCheckpoint,
        pendingTransition: FreshnessPendingTransition?
    ) throws {
        try Self.validateStorageSlot(storageSlot)
        switch state {
        case .initializing:
            try require(
                checkpoint.generation == 0
                    && checkpoint.sequence == 0
                    && checkpoint.headMAC == Data(repeating: 0, count: 32)
                    && pendingTransition == nil,
                "freshness_anchor_corrupt",
                "initializing record is invalid"
            )
        case .committed:
            try require(pendingTransition == nil, "freshness_anchor_corrupt", "committed record is invalid")
        case .pending:
            try require(
                pendingTransition?.from == checkpoint,
                "freshness_anchor_corrupt",
                "pending record source is invalid"
            )
        }
        self.storageSlot = storageSlot
        self.state = state
        self.checkpoint = checkpoint
        self.pendingTransition = pendingTransition
    }

    public func encoded() throws -> Data {
        let object: [String: Any] = [
            "checkpoint": Self.checkpointObject(checkpoint),
            "pending": pendingTransition.map(Self.pendingObject) ?? NSNull(),
            "record_version": Self.recordVersion,
            "state": state.rawValue,
            "storage_slot": storageSlot,
        ]
        guard JSONSerialization.isValidJSONObject(object) else {
            throw CoordinatorError("freshness_anchor_corrupt", "freshness record is not JSON encodable")
        }
        return try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
    }

    public var revision: Data {
        get throws { Data(SHA256.hash(data: try encoded())) }
    }

    public static func decode(_ data: Data, expectedStorageSlot: String) throws -> FreshnessRecord {
        try validateStorageSlot(expectedStorageSlot)
        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: data, options: [])
        } catch {
            throw CoordinatorError("freshness_anchor_corrupt", "freshness record is not valid JSON")
        }
        guard let object = value as? [String: Any],
              Set(object.keys) == Set(["checkpoint", "pending", "record_version", "state", "storage_slot"]),
              ExactJSONInteger.int64(object["record_version"], minimum: 1) == Int64(recordVersion),
              let storageSlot = object["storage_slot"] as? String,
              storageSlot == expectedStorageSlot,
              let rawState = object["state"] as? String,
              let state = FreshnessState(rawValue: rawState),
              let checkpointObject = object["checkpoint"] as? [String: Any]
        else {
            throw CoordinatorError("freshness_anchor_corrupt", "freshness record shape is invalid")
        }
        let checkpoint = try decodeCheckpoint(checkpointObject)
        let pending: FreshnessPendingTransition?
        if object["pending"] is NSNull {
            pending = nil
        } else if let pendingObject = object["pending"] as? [String: Any] {
            pending = try decodePending(pendingObject)
        } else {
            throw CoordinatorError("freshness_anchor_corrupt", "freshness pending value is invalid")
        }
        let record = try FreshnessRecord(
            storageSlot: storageSlot,
            state: state,
            checkpoint: checkpoint,
            pendingTransition: pending
        )
        let canonical = try record.encoded()
        try require(
            canonical == data,
            "freshness_anchor_corrupt",
            "freshness record is not canonical"
        )
        return record
    }

    private static func checkpointObject(_ checkpoint: FreshnessCheckpoint) -> [String: Any] {
        [
            "database_id": checkpoint.databaseID,
            "generation": checkpoint.generation,
            "head_mac": checkpoint.headMAC.base64EncodedString(),
            "sequence": checkpoint.sequence,
        ]
    }

    private static func pendingObject(_ pending: FreshnessPendingTransition) -> [String: Any] {
        [
            "batch_digest": pending.batchDigest.base64EncodedString(),
            "from": checkpointObject(pending.from),
            "to": checkpointObject(pending.to),
            "transition_id": pending.transitionID,
        ]
    }

    private static func decodeCheckpoint(_ object: [String: Any]) throws -> FreshnessCheckpoint {
        guard Set(object.keys) == Set(["database_id", "generation", "head_mac", "sequence"]),
              let databaseID = object["database_id"] as? String,
              let generation = ExactJSONInteger.int64(object["generation"], minimum: 0),
              let sequence = ExactJSONInteger.int64(object["sequence"], minimum: 0),
              let headText = object["head_mac"] as? String,
              let head = Data(base64Encoded: headText),
              head.base64EncodedString() == headText
        else {
            throw CoordinatorError("freshness_anchor_corrupt", "freshness checkpoint is invalid")
        }
        return try FreshnessCheckpoint(
            databaseID: databaseID,
            generation: generation,
            sequence: sequence,
            headMAC: head
        )
    }

    private static func decodePending(_ object: [String: Any]) throws -> FreshnessPendingTransition {
        guard Set(object.keys) == Set(["batch_digest", "from", "to", "transition_id"]),
              let fromObject = object["from"] as? [String: Any],
              let toObject = object["to"] as? [String: Any],
              let digestText = object["batch_digest"] as? String,
              let digest = Data(base64Encoded: digestText),
              digest.base64EncodedString() == digestText,
              let transitionID = object["transition_id"] as? String
        else {
            throw CoordinatorError("freshness_anchor_corrupt", "freshness pending transition is invalid")
        }
        return try FreshnessPendingTransition(
            from: decodeCheckpoint(fromObject),
            to: decodeCheckpoint(toObject),
            batchDigest: digest,
            transitionID: transitionID
        )
    }

    private static func validateStorageSlot(_ storageSlot: String) throws {
        try require(
            storageSlot.range(
                of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                options: .regularExpression
            ) != nil,
            "freshness_anchor_corrupt",
            "freshness storage slot is invalid"
        )
    }
}

public struct FreshnessStoredRecord: Sendable, Equatable {
    public let record: FreshnessRecord
    public let revision: Data

    public init(record: FreshnessRecord, revision: Data) throws {
        let expectedRevision = try record.revision
        try require(
            revision.count == 32 && revision == expectedRevision,
            "freshness_anchor_corrupt",
            "freshness record revision is invalid"
        )
        self.record = record
        self.revision = revision
    }
}

public protocol FreshnessAnchorStore: Sendable {
    var storageSlot: String { get }
    func load() throws -> FreshnessStoredRecord?
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord
    func compareAndSwap(
        expectedRevision: Data,
        replacement: FreshnessRecord
    ) throws -> FreshnessStoredRecord
}

enum FreshnessBatchDigest {
    static func compute(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) -> Data {
        var input = Data("blabee.freshness-batch.v1".utf8)
        append(Data(String(expectedSequence).utf8), to: &input)
        appendCollection(events, to: &input)
        appendCollection(documents, to: &input)
        appendCollection(verificationRecords, to: &input)
        return Data(SHA256.hash(data: input))
    }

    private static func appendCollection(_ values: [Data], to output: inout Data) {
        append(Data(String(values.count).utf8), to: &output)
        for value in values { append(value, to: &output) }
    }

    private static func append(_ value: Data, to output: inout Data) {
        var length = UInt64(value.count).bigEndian
        withUnsafeBytes(of: &length) { output.append(contentsOf: $0) }
        output.append(value)
    }
}

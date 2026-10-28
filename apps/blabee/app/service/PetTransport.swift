import CoordinatorSwift
import Dispatch
import Foundation

protocol PetCoordinatorTransport: Sendable {
    func request(type: String, payload: Data) async throws -> Data
    func request(type: String, payload: Data, expectedContext: PetProviderContext?) async throws -> Data
    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot
    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome
    func selectionOutcome(_ data: Data, request: PetSelectionRequest,
                          expectedContext: PetProviderContext?) async throws -> PetSelectionOutcome
}

protocol PetProviderControlling: PetCoordinatorTransport {
    func selectSession(_ session: PetProviderSession) async throws
    func checkConnection(_ expectedContext: PetProviderContext) async throws
    func disconnect(_ expectedContext: PetProviderContext) async throws
    func checkSessionConnection(_ session: PetProviderSession) async throws
    func disconnectSession(_ session: PetProviderSession) async throws
}

extension PetProviderControlling {
    func checkSessionConnection(_ session: PetProviderSession) async throws {
        try await checkConnection(session.context)
    }
    func disconnectSession(_ session: PetProviderSession) async throws {
        try await disconnect(session.context)
    }
}

extension PetCoordinatorTransport {
    func request(type: String, payload: Data, expectedContext: PetProviderContext?) async throws -> Data {
        guard expectedContext == nil else { throw PetModelError.invalid("provider_context_unsupported") }
        return try await request(type: type, payload: payload)
    }

    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        try await Task.detached(priority: .utility) { try PetSnapshot.parse(data) }.value
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome {
        let kind = try PetTransportResponse.requireAcceptedSelection(data)
        return kind == "pause" ? .pause : .nextTurn
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest,
                          expectedContext: PetProviderContext?) async throws -> PetSelectionOutcome {
        guard expectedContext == nil else { throw PetModelError.invalid("provider_context_unsupported") }
        return try await selectionOutcome(data, request: request)
    }
}

enum PetTransportTimeoutPolicy {
    // Let a selection finish native qualification + delivery without extending
    // permission arbitration or ordinary snapshot polling deadlines.
    static let selectionResponseTimeoutMilliseconds: Int32 = 60_000
    // Dismissal commits authenticated history too. Its response can outlive
    // an ordinary snapshot read; a timeout must never trigger a mutation retry.
    static let dismissalResponseTimeoutMilliseconds: Int32 = 60_000

    static func responseTimeoutMilliseconds(
        for requestType: String,
        defaultTimeoutMilliseconds: Int32,
        userDecisionTimeoutMilliseconds: Int32,
        selectionTimeoutMilliseconds: Int32 = selectionResponseTimeoutMilliseconds,
        dismissalTimeoutMilliseconds: Int32 = dismissalResponseTimeoutMilliseconds
    ) -> Int32 {
        switch requestType {
        case "pet_provider_snapshot", "pet_directory_v1", "pet_inbox_v1":
            min(defaultTimeoutMilliseconds, 500)
        case "select":
            selectionTimeoutMilliseconds
        case "dismiss_interaction":
            dismissalTimeoutMilliseconds
        case "resolve_permission_request", "resolve_managed_command_approval":
            userDecisionTimeoutMilliseconds
        default:
            defaultTimeoutMilliseconds
        }
    }

    static func operationType(_ type: String, payload: [String: Any]) -> String {
        guard type == "pet_provider_v1", let envelope = payload["envelope"] as? [String: Any],
              envelope["schema_version"] as? String == "blabee.pet-provider.v1",
              let operation = envelope["operation"] as? String else { return type }
        switch operation {
        case "select": return "select"
        case "snapshot": return "pet_provider_snapshot"
        default: return type
        }
    }
}

enum PetTransportRequestPayload {
    /// A Pet snapshot read also acts as a short-lived, process-local consumer
    /// heartbeat. It contains no secret or durable identity; the coordinator
    /// uses it only to avoid holding a Hook approval open when no Pet is
    /// actively polling.
    static func snapshotWithConsumerHeartbeat() throws -> Data {
        try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "1.0",
            "kind": "blabee_pet_snapshot_request",
            "consumer_heartbeat": true,
        ])
    }
}

actor PetUnixDomainSocketTransport: PetCoordinatorTransport {
    private let client: UnixDomainSocketClient
    private let connectTimeoutMilliseconds: Int32
    private let responseTimeoutMilliseconds: Int32
    private let userDecisionResponseTimeoutMilliseconds: Int32
    private let selectionResponseTimeoutMilliseconds: Int32
    private let dismissalResponseTimeoutMilliseconds: Int32

    init(
        socketPath: String,
        connectTimeoutMilliseconds: Int32 = 2_000,
        responseTimeoutMilliseconds: Int32 = 2_000,
        userDecisionResponseTimeoutMilliseconds: Int32 = 12_000,
        selectionResponseTimeoutMilliseconds: Int32 =
            PetTransportTimeoutPolicy.selectionResponseTimeoutMilliseconds,
        dismissalResponseTimeoutMilliseconds: Int32 =
            PetTransportTimeoutPolicy.dismissalResponseTimeoutMilliseconds
    ) throws {
        let resolvedSocketPath = try OperationalSocketPath.resolve(explicitPath: socketPath)
        client = try UnixDomainSocketClient(socketPath: resolvedSocketPath)
        self.connectTimeoutMilliseconds = connectTimeoutMilliseconds
        self.responseTimeoutMilliseconds = responseTimeoutMilliseconds
        self.userDecisionResponseTimeoutMilliseconds = userDecisionResponseTimeoutMilliseconds
        self.selectionResponseTimeoutMilliseconds = selectionResponseTimeoutMilliseconds
        self.dismissalResponseTimeoutMilliseconds = dismissalResponseTimeoutMilliseconds
    }

    func request(type: String, payload: Data) async throws -> Data {
        let client = client
        let connectTimeoutMilliseconds = connectTimeoutMilliseconds
        let defaultTimeout = responseTimeoutMilliseconds
        let userDecisionTimeout = userDecisionResponseTimeoutMilliseconds
        let selectionTimeout = selectionResponseTimeoutMilliseconds
        let dismissalTimeout = dismissalResponseTimeoutMilliseconds
        // A detached Swift task still runs on the cooperative executor. Keep
        // synchronous, deadline-bounded socket I/O on a blocking worker queue
        // so a pending selection cannot starve the Pet heartbeat or actors.
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result {
                    let payloadObject = try StrictJSONTransport.object(
                        from: payload,
                        limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
                    )
                    let operation = PetTransportTimeoutPolicy.operationType(type, payload: payloadObject)
                    let isInboxRead = ["pet_provider_snapshot", "pet_directory_v1", "pet_inbox_v1"].contains(operation)
                    let result = try client.request(
                        type: type,
                        payload: payloadObject,
                        connectTimeoutMilliseconds: isInboxRead ? min(connectTimeoutMilliseconds, 250) : connectTimeoutMilliseconds,
                        responseTimeoutMilliseconds: PetTransportTimeoutPolicy.responseTimeoutMilliseconds(
                            for: operation,
                            defaultTimeoutMilliseconds: defaultTimeout,
                            userDecisionTimeoutMilliseconds: userDecisionTimeout,
                            selectionTimeoutMilliseconds: selectionTimeout,
                            dismissalTimeoutMilliseconds: dismissalTimeout)
                    )
                    return try StrictJSONTransport.data(forJSONObject: result)
                })
            }
        }
    }
}

enum PetTransportResponse {
    static func requireFocused(_ data: Data) throws {
        let object = try StrictJSONTransport.object(from: data)
        guard Set(object.keys) == ["focused"],
              petStrictBooleanValue(object["focused"]) == true
        else {
            throw PetModelError.invalid("focus_response")
        }
    }

    static func requireAcceptedSelection(_ data: Data) throws -> String {
        let object = try StrictJSONTransport.object(from: data)
        guard Set(object.keys) == ["accepted", "outcome"],
              petStrictBooleanValue(object["accepted"]) == true,
              let outcome = object["outcome"] as? [String: Any],
              let kind = outcome["kind"] as? String,
              !kind.isEmpty
        else { throw PetModelError.invalid("selection_response") }
        switch kind {
        case "pause":
            guard Set(outcome.keys) == ["kind"] else {
                throw PetModelError.invalid("selection_response.outcome")
            }
        case "next_turn":
            guard Set(outcome.keys) == [
                "kind", "continuation_id", "queued_submission_id",
            ],
                  let continuationID = outcome["continuation_id"] as? String,
                  !continuationID.isEmpty,
                  let queuedSubmissionID = outcome["queued_submission_id"] as? String,
                  !queuedSubmissionID.isEmpty
            else { throw PetModelError.invalid("selection_response.outcome") }
        default:
            throw PetModelError.invalid("selection_response.outcome.kind")
        }
        return kind
    }

    static func requireResolvedPermission(
        _ data: Data,
        requestID: String,
        responseID: String,
        expectedDecision: PetPermissionDecision
    ) throws {
        let object = try StrictJSONTransport.object(from: data)
        guard Set(object.keys) == [
            "resolved", "request_id", "response_id", "decision",
        ],
              petStrictBooleanValue(object["resolved"]) == true,
              object["request_id"] as? String == requestID,
              object["response_id"] as? String == responseID,
              object["decision"] as? String == expectedDecision.rawValue
        else { throw PetModelError.invalid("permission_resolution_response") }
    }
}

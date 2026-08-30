import CoordinatorSwift
import Foundation

protocol PetCoordinatorTransport: Sendable {
    func request(type: String, payload: Data) async throws -> Data
}

enum PetTransportTimeoutPolicy {
    static func responseTimeoutMilliseconds(
        for requestType: String,
        defaultTimeoutMilliseconds: Int32,
        userDecisionTimeoutMilliseconds: Int32
    ) -> Int32 {
        switch requestType {
        case "select", "resolve_permission_request",
             "resolve_managed_command_approval":
            userDecisionTimeoutMilliseconds
        default:
            defaultTimeoutMilliseconds
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

    init(
        socketPath: String,
        connectTimeoutMilliseconds: Int32 = 2_000,
        responseTimeoutMilliseconds: Int32 = 2_000,
        userDecisionResponseTimeoutMilliseconds: Int32 = 12_000
    ) throws {
        let resolvedSocketPath = try OperationalSocketPath.resolve(explicitPath: socketPath)
        client = try UnixDomainSocketClient(socketPath: resolvedSocketPath)
        self.connectTimeoutMilliseconds = connectTimeoutMilliseconds
        self.responseTimeoutMilliseconds = responseTimeoutMilliseconds
        self.userDecisionResponseTimeoutMilliseconds = userDecisionResponseTimeoutMilliseconds
    }

    func request(type: String, payload: Data) async throws -> Data {
        let client = client
        let connectTimeoutMilliseconds = connectTimeoutMilliseconds
        let responseTimeoutMilliseconds = PetTransportTimeoutPolicy
            .responseTimeoutMilliseconds(
                for: type,
                defaultTimeoutMilliseconds: responseTimeoutMilliseconds,
                userDecisionTimeoutMilliseconds:
                    userDecisionResponseTimeoutMilliseconds
            )
        // UnixDomainSocketClient is deliberately synchronous. Run that bounded
        // I/O away from this actor so a long selection response cannot starve
        // the Pet's 500 ms get_state heartbeat and falsely expire its lease.
        return try await Task.detached(priority: .userInitiated) {
            let payloadObject = try StrictJSONTransport.object(
                from: payload,
                limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
            )
            let result = try client.request(
                type: type,
                payload: payloadObject,
                connectTimeoutMilliseconds: connectTimeoutMilliseconds,
                responseTimeoutMilliseconds: responseTimeoutMilliseconds
            )
            return try StrictJSONTransport.data(forJSONObject: result)
        }.value
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

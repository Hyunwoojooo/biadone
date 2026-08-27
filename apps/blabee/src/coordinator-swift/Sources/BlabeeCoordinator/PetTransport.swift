import CoordinatorSwift
import Foundation

protocol PetCoordinatorTransport: Sendable {
    func request(type: String, payload: Data) async throws -> Data
}

actor PetUnixDomainSocketTransport: PetCoordinatorTransport {
    private let client: UnixDomainSocketClient
    private let connectTimeoutMilliseconds: Int32
    private let responseTimeoutMilliseconds: Int32
    private let selectionResponseTimeoutMilliseconds: Int32

    init(
        socketPath: String,
        connectTimeoutMilliseconds: Int32 = 2_000,
        responseTimeoutMilliseconds: Int32 = 2_000,
        selectionResponseTimeoutMilliseconds: Int32 = 12_000
    ) throws {
        let resolvedSocketPath = try OperationalSocketPath.resolve(explicitPath: socketPath)
        client = try UnixDomainSocketClient(socketPath: resolvedSocketPath)
        self.connectTimeoutMilliseconds = connectTimeoutMilliseconds
        self.responseTimeoutMilliseconds = responseTimeoutMilliseconds
        self.selectionResponseTimeoutMilliseconds = selectionResponseTimeoutMilliseconds
    }

    func request(type: String, payload: Data) async throws -> Data {
        let payloadObject = try StrictJSONTransport.object(
            from: payload,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        let result = try client.request(
            type: type,
            payload: payloadObject,
            connectTimeoutMilliseconds: connectTimeoutMilliseconds,
            responseTimeoutMilliseconds: type == "select"
                ? selectionResponseTimeoutMilliseconds
                : responseTimeoutMilliseconds
        )
        return try StrictJSONTransport.data(forJSONObject: result)
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

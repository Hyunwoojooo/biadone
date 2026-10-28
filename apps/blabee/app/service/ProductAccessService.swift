import CoordinatorSwift
import Foundation

/// Only the app owning the service's private selector capability may supply
/// account credentials. The access token is an input, never a response/journal field.
final class ProductAccessService: @unchecked Sendable {
    static let requestType = "product_access_v1"
    private let credential: String
    private let controller: ProductAccessController

    init(credential: String, controller: ProductAccessController) throws {
        guard AppPetSelectorBootstrap.validCredential(credential) else {
            throw CoordinatorError("product_access_unauthorized")
        }
        self.credential = credential; self.controller = controller
    }

    func handle(_ data: Data) throws -> Data {
        let request = try StrictJSONTransport.object(from: data, limits: .init(maximumBytes: 20_480, maximumDepth: 4))
        guard Set(request.keys) == ["schema_version", "request_id", "auth_token", "operation", "revision", "payload"],
              ExactJSONInteger.int64(request["schema_version"], minimum: 1) == 1,
              let requestID = request["request_id"] as? String, PetProviderContext.isUUID(requestID),
              let token = request["auth_token"] as? String, AppPetSelectorBootstrap.validCredential(token),
              ContinuationTokenMaterial.constantTimeEqual(token, credential),
              let operation = request["operation"] as? String,
              let revision = ExactJSONInteger.int64(request["revision"], minimum: 1),
              let payload = request["payload"] as? [String: Any] else {
            throw CoordinatorError("product_access_unauthorized")
        }
        let snapshot: ProductAccessSnapshot
        switch operation {
        case "update":
            guard Set(payload.keys) == ["user_id", "access_token"],
                  let userID = payload["user_id"] as? String, let accessToken = payload["access_token"] as? String else {
                throw CoordinatorError("product_access_request_invalid")
            }
            snapshot = try controller.update(userID: userID, accessToken: accessToken, revision: revision)
        case "clear":
            guard payload.isEmpty else { throw CoordinatorError("product_access_request_invalid") }
            snapshot = try controller.clear(revision: revision)
        case "status":
            guard payload.isEmpty else { throw CoordinatorError("product_access_request_invalid") }
            snapshot = controller.snapshot()
        case "refresh":
            guard payload.isEmpty, controller.snapshot().revision == revision else {
                throw CoordinatorError("product_access_stale_request")
            }
            snapshot = controller.refresh()
        default: throw CoordinatorError("product_access_request_invalid")
        }
        return try StrictJSONTransport.data(forJSONObject: [
            "schema_version": 1, "request_id": requestID, "revision": snapshot.revision,
            "service_generation": snapshot.serviceGeneration, "state": snapshot.state.rawValue,
            "user_id": snapshot.userID as Any? ?? NSNull(), "remaining_seconds": snapshot.remainingSeconds,
        ])
    }
}

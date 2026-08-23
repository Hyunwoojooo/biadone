import Foundation

/// Exact prompt transport requested after a Pet action is selected.
///
/// A receipt proves only that the transport accepted the prompt. It does not
/// prove that Codex ran the requested action or that the action succeeded.
public struct CoordinatorNextTurnDispatchRequest: Sendable, Equatable {
    public let sessionID: String
    public let message: String
    public let continuationID: String

    public init(
        sessionID: String,
        message: String,
        continuationID: String
    ) {
        self.sessionID = sessionID
        self.message = message
        self.continuationID = continuationID
    }
}

public struct CoordinatorNextTurnDispatchReceipt: Sendable, Equatable {
    public let queuedSubmissionID: String

    public init(queuedSubmissionID: String) {
        self.queuedSubmissionID = queuedSubmissionID
    }
}

public typealias CoordinatorNextTurnDispatcher = @Sendable (
    CoordinatorNextTurnDispatchRequest
) async throws -> CoordinatorNextTurnDispatchReceipt

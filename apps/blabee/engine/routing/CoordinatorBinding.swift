import Foundation

public struct CoordinatorTurnKey: Sendable, Hashable {
    public let projectID: String
    public let sessionID: String
    public let sourceTurnID: String

    public init(projectID: String, sessionID: String, sourceTurnID: String) {
        self.projectID = projectID
        self.sessionID = sessionID
        self.sourceTurnID = sourceTurnID
    }
}

public struct CoordinatorSessionKey: Sendable, Hashable {
    public let projectID: String
    public let sessionID: String

    public init(projectID: String, sessionID: String) {
        self.projectID = projectID
        self.sessionID = sessionID
    }
}

public struct CoordinatorBoundaryKey: Sendable, Hashable {
    public let projectID: String
    public let decisionBoundaryID: String
    public let boundarySequence: Int64

    public init(projectID: String, decisionBoundaryID: String, boundarySequence: Int64) {
        self.projectID = projectID
        self.decisionBoundaryID = decisionBoundaryID
        self.boundarySequence = boundarySequence
    }
}

public struct CoordinatorBindingKey: Sendable, Hashable {
    public let binding: CoordinatorBinding

    public init(binding: CoordinatorBinding) {
        self.binding = binding
    }
}

/// The complete v1 same-turn decision-boundary identity.
public struct CoordinatorBinding: Sendable, Hashable {
    public let projectID: String
    public let sessionID: String
    public let sourceTurnID: String
    public let sourcePromptID: String
    public let episodeID: String
    public let episodeRootPromptID: String
    public let episodeBaselineCheckpointID: String
    public let decisionBoundaryID: String
    public let boundarySequence: Int64

    public init(
        projectID: String,
        sessionID: String,
        sourceTurnID: String,
        sourcePromptID: String,
        episodeID: String,
        episodeRootPromptID: String,
        episodeBaselineCheckpointID: String,
        decisionBoundaryID: String,
        boundarySequence: Int64
    ) throws {
        self.projectID = try Self.identifier(projectID, field: "project_id")
        self.sessionID = try Self.identifier(sessionID, field: "session_id")
        self.sourceTurnID = try Self.identifier(sourceTurnID, field: "source_turn_id")
        self.sourcePromptID = try Self.identifier(sourcePromptID, field: "source_prompt_id")
        self.episodeID = try Self.identifier(episodeID, field: "episode_id")
        self.episodeRootPromptID = try Self.identifier(
            episodeRootPromptID,
            field: "episode_root_prompt_id"
        )
        self.episodeBaselineCheckpointID = try Self.identifier(
            episodeBaselineCheckpointID,
            field: "episode_baseline_checkpoint_id"
        )
        self.decisionBoundaryID = try Self.identifier(
            decisionBoundaryID,
            field: "decision_boundary_id"
        )
        try require(
            boundarySequence > 0,
            "binding_incomplete",
            "boundary_sequence must be a positive integer"
        )
        self.boundarySequence = boundarySequence
    }

    public init(jsonObject: [String: Any]) throws {
        func string(_ key: String) throws -> String {
            guard let value = jsonObject[key] as? String else {
                throw CoordinatorError("binding_incomplete", "\(key) must be a non-empty string")
            }
            return value
        }

        guard let boundarySequence = ExactJSONInteger.int64(
            jsonObject["boundary_sequence"],
            minimum: 1
        ) else {
            throw CoordinatorError(
                "binding_incomplete",
                "boundary_sequence must be a positive integer"
            )
        }

        try self.init(
            projectID: string("project_id"),
            sessionID: string("session_id"),
            sourceTurnID: string("source_turn_id"),
            sourcePromptID: string("source_prompt_id"),
            episodeID: string("episode_id"),
            episodeRootPromptID: string("episode_root_prompt_id"),
            episodeBaselineCheckpointID: string("episode_baseline_checkpoint_id"),
            decisionBoundaryID: string("decision_boundary_id"),
            boundarySequence: boundarySequence
        )
    }

    public var jsonObject: [String: Any] {
        [
            "project_id": projectID,
            "session_id": sessionID,
            "source_turn_id": sourceTurnID,
            "source_prompt_id": sourcePromptID,
            "episode_id": episodeID,
            "episode_root_prompt_id": episodeRootPromptID,
            "episode_baseline_checkpoint_id": episodeBaselineCheckpointID,
            "decision_boundary_id": decisionBoundaryID,
            "boundary_sequence": boundarySequence,
        ]
    }

    public var turnKey: CoordinatorTurnKey {
        CoordinatorTurnKey(
            projectID: projectID,
            sessionID: sessionID,
            sourceTurnID: sourceTurnID
        )
    }

    public var sessionKey: CoordinatorSessionKey {
        CoordinatorSessionKey(projectID: projectID, sessionID: sessionID)
    }

    public var boundaryKey: CoordinatorBoundaryKey {
        CoordinatorBoundaryKey(
            projectID: projectID,
            decisionBoundaryID: decisionBoundaryID,
            boundarySequence: boundarySequence
        )
    }

    public var fullKey: CoordinatorBindingKey {
        CoordinatorBindingKey(binding: self)
    }

    private static func identifier(_ value: String, field: String) throws -> String {
        try require(
            !value.isEmpty,
            "binding_incomplete",
            "\(field) must be a non-empty string"
        )
        try require(
            value.unicodeScalars.count <= 512,
            "\(field)_invalid",
            "\(field) exceeds the v1 identifier limit"
        )
        try require(
            IdentifierNormalization.isNFC(value),
            "\(field)_invalid",
            "\(field) must use NFC normalization"
        )
        return value
    }
}

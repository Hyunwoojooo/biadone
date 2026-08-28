import CoordinatorSwift
import Darwin
import Foundation

private let hookEvents: [String: String] = [
    "SessionStart": "session_start",
    "UserPromptSubmit": "user_prompt_submit",
    "Stop": "stop",
    "PermissionRequest": "permission_request",
]
private let supportedMCPProtocolVersion = "2025-06-18"

func runHookCommand(arguments: [String]) {
    // Hooks are deliberately fail-open. Invalid input, an unavailable daemon,
    // a timeout, and a rejected result all produce exit 0 with empty stdout.
    do {
        guard let eventName = arguments.first,
              let requestType = hookEvents[eventName]
        else { return }
        // A managed App Server broker owns command approval request IDs and
        // responses. Its child Codex process marks that ownership explicitly
        // so the Hook path cannot race a second approval decision.
        if eventName == "PermissionRequest",
           ProcessInfo.processInfo.environment["BLABEE_MANAGED_APPROVALS"] == "1"
        {
            return
        }
        let socketFlag = try optionalSocketFlag(Array(arguments.dropFirst()))
        let socketPath = try OperationalSocketPath.resolve(explicitPath: socketFlag)
        let inputData = try readStandardInput(maximumBytes: 1_048_576)
        let payload = try StrictJSONTransport.object(
            from: inputData,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        let client = try UnixDomainSocketClient(socketPath: socketPath)
        let result = try client.request(
            type: requestType,
            payload: payload,
            connectTimeoutMilliseconds: 2_000,
            responseTimeoutMilliseconds: eventName == "PermissionRequest" ? 55_000 : 5_000
        )
        guard result["enabled"] as? Bool != false else { return }

        if eventName == "PermissionRequest" {
            if Set(result.keys) == ["decision"] {
                guard result["decision"] as? String == "defer_to_codex" else { return }
                return
            }
            guard Set(result.keys) == [
                "decision", "delivery_token", "request_id", "session_id", "turn_id",
            ], let decision = result["decision"] as? String
            else { return }
            let deliveryToken = try permissionDeliveryToken(
                result["delivery_token"]
            )
            let requestID = try permissionDeliveryIdentifier(
                result["request_id"],
                code: "permission_request_id_invalid"
            )
            let sessionID = try permissionDeliveryIdentifier(
                result["session_id"],
                code: "permission_session_id_invalid"
            )
            let turnID = try permissionDeliveryIdentifier(
                result["turn_id"],
                code: "permission_turn_id_invalid"
            )
            switch decision {
            case "allow":
                try writeStandardOutputJSON([
                    "hookSpecificOutput": [
                        "hookEventName": "PermissionRequest",
                        "decision": [
                            "behavior": "allow",
                        ],
                    ],
                ])
            case "deny":
                try writeStandardOutputJSON([
                    "hookSpecificOutput": [
                        "hookEventName": "PermissionRequest",
                        "decision": [
                            "behavior": "deny",
                            "message": "Blabee에서 사용자가 거절했습니다.",
                        ],
                    ],
                ])
            case "defer_to_codex":
                // An empty Hook response is delivered only when stdout reaches
                // EOF. Close it before acknowledging delivery so Pet cannot
                // report success while Codex is still waiting for fallback.
                try FileHandle.standardOutput.close()
            default:
                return
            }
            let acknowledgement = try client.request(
                type: "ack_permission_request_delivery",
                payload: [
                    "schema_version": "1.0",
                    "kind": "blabee_permission_request_delivery_ack",
                    "request_id": requestID,
                    "session_id": sessionID,
                    "turn_id": turnID,
                    "delivery_token": deliveryToken,
                ],
                connectTimeoutMilliseconds: 2_000,
                responseTimeoutMilliseconds: 5_000
            )
            guard acknowledgement.isEmpty else { return }
            return
        }
        if eventName == "Stop" {
            guard result["decision"] as? String == "block",
                  let reason = result["reason"] as? String,
                  !reason.isEmpty
            else { return }
            try writeStandardOutputJSON([
                "decision": "block",
                "reason": reason,
            ])
            return
        }
        if let additionalContext = result["additionalContext"] as? String,
           !additionalContext.isEmpty
        {
            try writeStandardOutputJSON([
                "hookSpecificOutput": [
                    "hookEventName": eventName,
                    "additionalContext": additionalContext,
                ],
            ])
        }
    } catch {
        return
    }
}

private func permissionDeliveryIdentifier(_ value: Any?, code: String) throws -> String {
    guard let value = value as? String,
          !value.isEmpty,
          value.unicodeScalars.count <= 512,
          value.utf8.elementsEqual(
            value.precomposedStringWithCanonicalMapping.utf8
          )
    else { throw CoordinatorError(code) }
    return value
}

private func permissionDeliveryToken(_ value: Any?) throws -> String {
    guard let value = value as? String else {
        throw CoordinatorError("permission_request_delivery_token_invalid")
    }
    let bytes = Array(value.utf8)
    guard bytes.count >= 16,
          bytes.count <= 512,
          bytes.allSatisfy({ byte in
              (0x41...0x5A).contains(byte)
                  || (0x61...0x7A).contains(byte)
                  || (0x30...0x39).contains(byte)
                  || byte == 0x5F
                  || byte == 0x2D
          })
    else { throw CoordinatorError("permission_request_delivery_token_invalid") }
    return value
}

func runMCPCommand(arguments: [String]) throws {
    let socketFlag = try optionalSocketFlag(arguments)
    let socketPath = try OperationalSocketPath.resolve(explicitPath: socketFlag)
    let client = try UnixDomainSocketClient(socketPath: socketPath)
    let reader = StandardInputLineReader(maximumBytes: 1_048_576)

    while let line = try reader.nextLine() {
        if line.isEmpty { continue }
        do {
            let message = try StrictJSONTransport.object(
                from: line,
                limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
            )
            try handleMCPMessage(message, client: client)
        } catch {
            try writeStandardOutputJSON([
                "jsonrpc": "2.0",
                "id": NSNull(),
                "error": ["code": -32700, "message": "parse_error"],
            ])
        }
    }
}

private func handleMCPMessage(
    _ message: [String: Any],
    client: UnixDomainSocketClient
) throws {
    let messageSecretCorpus = RuntimeSecretCorpus()
    messageSecretCorpus.registerKnownSecrets(inJSONObject: message)
    guard message["jsonrpc"] as? String == "2.0",
          let method = message["method"] as? String
    else {
        try writeMCPError(
            id: message["id"],
            code: -32600,
            message: "invalid_request",
            secretCorpus: messageSecretCorpus
        )
        return
    }
    if method.hasPrefix("notifications/") { return }

    switch method {
    case "initialize":
        try writeMCPResult(id: message["id"], value: [
            "protocolVersion": supportedMCPProtocolVersion,
            "capabilities": ["tools": [:] as [String: Any]],
            "serverInfo": ["name": "blabee", "version": "0.1.0"],
        ], secretCorpus: messageSecretCorpus)
    case "ping":
        try writeMCPResult(id: message["id"], value: [:], secretCorpus: messageSecretCorpus)
    case "tools/list":
        try writeMCPResult(
            id: message["id"],
            value: ["tools": [emitDecisionTool()]],
            secretCorpus: messageSecretCorpus
        )
    case "tools/call":
        guard let parameters = message["params"] as? [String: Any],
              parameters["name"] as? String == "emit_decision",
              let arguments = parameters["arguments"] as? [String: Any]
        else {
            try writeMCPError(
                id: message["id"],
                code: -32602,
                message: "invalid_params",
                secretCorpus: messageSecretCorpus
            )
            return
        }
        do {
            try validateEmitDecisionWrapper(arguments)
            let forwarded = try client.request(
                type: "emit_decision",
                payload: arguments,
                connectTimeoutMilliseconds: 5_000,
                responseTimeoutMilliseconds: 5_000
            )
            try messageSecretCorpus.assertNoKnownSecret(inJSONObject: forwarded)
            try writeMCPResult(id: message["id"], value: [
                "content": [[
                    "type": "text",
                    "text": "Decision proposal accepted by Blabee.",
                ]],
                "structuredContent": forwarded,
            ], secretCorpus: messageSecretCorpus)
        } catch {
            let failure = publicEmitDecisionFailure(error)
            try writeMCPResult(id: message["id"], value: [
                "isError": true,
                "content": [[
                    "type": "text",
                    "text": "Blabee coordinator unavailable or rejected the proposal.",
                ]],
                "structuredContent": failure,
            ], secretCorpus: messageSecretCorpus)
        }
    default:
        try writeMCPError(
            id: message["id"],
            code: -32601,
            message: "method_not_found",
            secretCorpus: messageSecretCorpus
        )
    }
}

private func publicEmitDecisionFailure(_ error: Error) -> [String: Any] {
    let code = error.coordinatorError.code
    switch code {
    case "proposal_source_prompt_mismatch":
        return [
            "accepted": false,
            "error_code": code,
            "retryable": true,
        ]
    default:
        return [
            "accepted": false,
            "error_code": "coordinator_unavailable_or_rejected",
            "retryable": false,
        ]
    }
}

private func validateEmitDecisionWrapper(_ wrapper: [String: Any]) throws {
    let wrapperKeys: Set<String> = [
        "project_id",
        "session_id",
        "source_turn_id",
        "source_prompt_id",
        "episode_id",
        "correlation_token",
        "proposal",
    ]
    guard Set(wrapper.keys) == wrapperKeys,
          wrapperKeys.subtracting(Set(["proposal"])).allSatisfy({
              guard let value = wrapper[$0] as? String else { return false }
              return !value.isEmpty
          }),
          let proposal = wrapper["proposal"] as? [String: Any]
    else { throw CoordinatorError("operational_request_invalid") }

    let commonProposalKeys: Set<String> = [
        "schema_version",
        "interaction_kind",
        "proposal_id",
        "correlation_token",
        "task_goal",
        "outcome",
        "reported_side_effects",
    ]
    let rankedProposalKeys = commonProposalKeys.union(["next_actions"])
    let legacyProposalKeys = commonProposalKeys.union([
        "recommended_next",
        "alternative_next",
        "pause_capsule",
    ])
    let suppliedProposalKeys = Set(proposal.keys)
    let rankedActions = proposal["next_actions"] as? [[String: Any]]
    let hasValidProposalShape = suppliedProposalKeys == legacyProposalKeys
        || (suppliedProposalKeys == rankedProposalKeys
            && rankedActions.map { (2...4).contains($0.count) } == true)
    guard hasValidProposalShape,
          proposal["schema_version"] as? String == "1.0",
          proposal["interaction_kind"] as? String == "blabee_decision",
          let proposalID = proposal["proposal_id"] as? String,
          !proposalID.isEmpty,
          let taskGoal = proposal["task_goal"] as? String,
          !taskGoal.isEmpty,
          let outerToken = wrapper["correlation_token"] as? String,
          let innerToken = proposal["correlation_token"] as? String,
          outerToken == innerToken
    else { throw CoordinatorError("operational_request_invalid") }
}

private func emitDecisionTool() -> [String: Any] {
    [
        "name": "emit_decision",
        "title": "Emit Blabee decision",
        "description": "Send two to four ranked next actions for the exact active project, session, prompt episode, and turn.",
        "inputSchema": [
            "type": "object",
            "additionalProperties": false,
            "required": [
                "project_id",
                "session_id",
                "source_turn_id",
                "source_prompt_id",
                "episode_id",
                "correlation_token",
                "proposal",
            ],
            "properties": [
                "project_id": identifierSchema(),
                "session_id": identifierSchema(),
                "source_turn_id": identifierSchema(),
                "source_prompt_id": identifierSchema(),
                "episode_id": identifierSchema(),
                "correlation_token": opaqueTokenSchema(),
                "proposal": [
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "schema_version",
                        "interaction_kind",
                        "proposal_id",
                        "correlation_token",
                        "task_goal",
                        "outcome",
                        "next_actions",
                        "reported_side_effects",
                    ],
                    "properties": [
                        "schema_version": ["const": "1.0"],
                        "interaction_kind": ["const": "blabee_decision"],
                        "proposal_id": identifierSchema(),
                        "correlation_token": opaqueTokenSchema(),
                        "task_goal": nonEmptyStringSchema(),
                        "outcome": [
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["status", "summary"],
                            "properties": [
                                "status": [
                                    "enum": ["completed", "partial", "blocked", "failed"],
                                ],
                                "summary": nonEmptyStringSchema(),
                            ],
                        ] as [String: Any],
                        "next_actions": [
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 4,
                            "items": actionSchema(),
                        ] as [String: Any],
                        "reported_side_effects": [
                            "type": "array",
                            "maxItems": 128,
                            "items": [
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["kind", "summary", "reversibility"],
                                "properties": [
                                    "kind": stableCodeSchema(),
                                    "summary": nonEmptyStringSchema(),
                                    "reversibility": [
                                        "enum": ["reversible", "irreversible", "unknown"],
                                    ],
                                ],
                            ] as [String: Any],
                        ] as [String: Any],
                    ],
                ] as [String: Any],
            ],
        ] as [String: Any],
        "annotations": [
            "readOnlyHint": false,
            "destructiveHint": false,
            "idempotentHint": false,
            "openWorldHint": false,
        ],
    ]
}

private func identifierSchema() -> [String: Any] {
    ["type": "string", "minLength": 1, "maxLength": 512]
}

private func opaqueTokenSchema() -> [String: Any] {
    [
        "type": "string",
        "minLength": 16,
        "maxLength": 1_024,
        "pattern": "^[A-Za-z0-9_-]+$",
    ]
}

private func nonEmptyStringSchema() -> [String: Any] {
    ["type": "string", "minLength": 1, "maxLength": 8_192]
}

private func stableCodeSchema() -> [String: Any] {
    [
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "^[a-z][a-z0-9_]*$",
    ]
}

private func stringListSchema(minimumItems: Int? = nil) -> [String: Any] {
    var schema: [String: Any] = [
        "type": "array",
        "maxItems": 128,
        "items": nonEmptyStringSchema(),
    ]
    if let minimumItems { schema["minItems"] = minimumItems }
    return schema
}

private func actionSchema() -> [String: Any] {
    [
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "objective", "constraints", "done_when"],
        "properties": [
            "title": ["type": "string", "minLength": 1, "maxLength": 256],
            "objective": nonEmptyStringSchema(),
            "constraints": stringListSchema(),
            "done_when": stringListSchema(minimumItems: 1),
        ],
    ]
}

private func writeMCPResult(
    id: Any?,
    value: [String: Any],
    secretCorpus: RuntimeSecretCorpus? = nil
) throws {
    try writeStandardOutputJSON([
        "jsonrpc": "2.0",
        "id": id ?? NSNull(),
        "result": value,
    ], secretCorpus: secretCorpus)
}

private func writeMCPError(
    id: Any?,
    code: Int,
    message: String,
    secretCorpus: RuntimeSecretCorpus? = nil
) throws {
    try writeStandardOutputJSON([
        "jsonrpc": "2.0",
        "id": id ?? NSNull(),
        "error": ["code": code, "message": message],
    ], secretCorpus: secretCorpus)
}

private func optionalSocketFlag(_ arguments: [String]) throws -> String? {
    var socketPath: String?
    var index = 0
    while index < arguments.count {
        guard arguments[index] == "--socket",
              socketPath == nil,
              index + 1 < arguments.count,
              !arguments[index + 1].isEmpty
        else {
            throw CoordinatorError("invalid_arguments", "unsupported adapter argument")
        }
        socketPath = arguments[index + 1]
        index += 2
    }
    return socketPath
}

private func readStandardInput(maximumBytes: Int) throws -> Data {
    var output = Data()
    var buffer = [UInt8](repeating: 0, count: 16 * 1024)
    while true {
        let count = buffer.withUnsafeMutableBytes { bytes in
            Darwin.read(STDIN_FILENO, bytes.baseAddress, bytes.count)
        }
        if count < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("operational_transport_failed")
        }
        if count == 0 { return output }
        output.append(contentsOf: buffer.prefix(count))
        guard output.count <= maximumBytes else {
            throw CoordinatorError("operational_message_too_large")
        }
    }
}

private func writeStandardOutputJSON(
    _ object: [String: Any],
    secretCorpus: RuntimeSecretCorpus? = nil
) throws {
    try secretCorpus?.assertNoKnownSecret(inJSONObject: object)
    var data = try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
    try secretCorpus?.assertNoKnownSecret(in: data)
    data.append(0x0A)
    try FileHandle.standardOutput.write(contentsOf: data)
}

private final class StandardInputLineReader {
    private let maximumBytes: Int
    private var buffer = Data()
    private var reachedEnd = false

    init(maximumBytes: Int) {
        self.maximumBytes = maximumBytes
    }

    func nextLine() throws -> Data? {
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                return line
            }
            if reachedEnd {
                guard !buffer.isEmpty else { return nil }
                defer { buffer.removeAll(keepingCapacity: false) }
                return buffer
            }

            var chunk = [UInt8](repeating: 0, count: 16 * 1024)
            let count = chunk.withUnsafeMutableBytes { bytes in
                Darwin.read(STDIN_FILENO, bytes.baseAddress, bytes.count)
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw CoordinatorError("operational_transport_failed")
            }
            if count == 0 {
                reachedEnd = true
                continue
            }
            buffer.append(contentsOf: chunk.prefix(count))
            guard buffer.count <= maximumBytes else {
                throw CoordinatorError("operational_message_too_large")
            }
        }
    }
}

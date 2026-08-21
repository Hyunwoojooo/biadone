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
            responseTimeoutMilliseconds: eventName == "Stop" ? 125_000 : 5_000
        )
        guard result["enabled"] as? Bool != false else { return }

        if eventName == "PermissionRequest" { return }
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
            try writeMCPResult(id: message["id"], value: [
                "isError": true,
                "content": [[
                    "type": "text",
                    "text": "Blabee coordinator unavailable or rejected the proposal.",
                ]],
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

    let proposalKeys: Set<String> = [
        "schema_version",
        "interaction_kind",
        "proposal_id",
        "correlation_token",
        "task_goal",
        "outcome",
        "recommended_next",
        "alternative_next",
        "pause_capsule",
        "reported_side_effects",
    ]
    guard Set(proposal.keys) == proposalKeys,
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
        "description": "Send one structured Blabee decision proposal for the exact active project, session, prompt episode, and turn.",
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
                        "recommended_next",
                        "alternative_next",
                        "pause_capsule",
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
                        "recommended_next": actionSchema(),
                        "alternative_next": [
                            "oneOf": [actionSchema(), ["type": "null"]],
                        ],
                        "pause_capsule": [
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["resume_first"],
                            "properties": ["resume_first": nonEmptyStringSchema()],
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

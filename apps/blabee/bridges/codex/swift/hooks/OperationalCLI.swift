import CoordinatorSwift
import Darwin
import Foundation
import OSLog

private let hookEvents: [String: String] = [
    "SessionStart": "session_start",
    "UserPromptSubmit": "user_prompt_submit",
    "Stop": "stop",
    "PermissionRequest": "permission_request",
]
private let supportedMCPProtocolVersion = "2025-06-18"

enum HookThreadRoutingPolicy {
    /// Codex 0.154.0 shares `session_id` with the root thread and reports a
    /// spawned thread's own ID in `agent_id` (hook_runtime.rs). Coordinator
    /// sessions and `codex queue` targets must instead identify the thread:
    /// otherwise one child prompt replaces its parent's active turn.
    ///
    /// This is routing identity only, never permission authority. Keep the
    /// command, cwd, turn and metadata byte-exact; qualification and the bound
    /// response checks below still decide whether an allow can be returned.
    static func routedPayload(
        eventName: String, input: [String: Any]
    ) throws -> [String: Any] {
        guard hookEvents[eventName] != nil,
              input["hook_event_name"] as? String == eventName
        else { throw CoordinatorError("hook_thread_event_invalid") }
        _ = try routingIdentifier(input["session_id"])
        guard let agentID = input["agent_id"] else {
            // A partial subagent identity must not silently address the root.
            guard input["agent_type"] == nil else {
                throw CoordinatorError("hook_thread_identity_invalid")
            }
            return input
        }
        var payload = input
        payload["session_id"] = try routingIdentifier(agentID)
        return payload
    }

    private static func routingIdentifier(_ value: Any?) throws -> String {
        guard let value = value as? String,
              !value.isEmpty, value.utf8.count <= 512,
              value.utf8.allSatisfy({ byte in
                  (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
                      || (0x30...0x39).contains(byte) || byte == 0x2D || byte == 0x5F
              })
        else { throw CoordinatorError("hook_thread_identity_invalid") }
        return value
    }
}

struct HookRequestAttempt: Equatable, Sendable {
    let connectTimeoutMilliseconds: Int32
    let responseTimeoutMilliseconds: Int32
}

enum HookRequestOutcome {
    case response([String: Any])
    case queuedPromptUnavailable
    case unavailable
}

/// Fixed transport diagnostics only: no prompt, ref, action, binding, path or
/// error description. A received response does not attest action execution.
enum HookQueuedPromptDiagnostics {
    enum AttemptOutcome: String, Sendable {
        case responseReceived = "response_received"
        case failed
    }

    enum FinalResult: String, Sendable {
        case responseReceived = "response_received"
        case noActionContext = "no_action_context"
        case unavailable
    }

    enum FailureCode: String, Sendable {
        case socketInvalid = "operational_socket_invalid"
        case socketUnavailable = "operational_socket_unavailable"
        case socketUnsafe = "operational_socket_unsafe"
        case connectRefused = "operational_connect_refused"
        case connectFailed = "operational_connect_failed"
        case connectTimeout = "operational_connect_timeout"
        case peerRejected = "operational_peer_rejected"
        case runtimeIdentityInvalid = "operational_runtime_identity_invalid"
        case runtimeIdentityMismatch = "operational_runtime_identity_mismatch"
        case runtimeIdentityUnverified = "operational_runtime_identity_unverified"
        case runtimeRequestNotCompatible = "operational_runtime_request_not_compatible"
        case responseInvalid = "operational_response_invalid"
        case responseTimeout = "operational_response_timeout"
        case transportClosed = "operational_transport_closed"
        case transportFailed = "operational_transport_failed"
        case messageInvalid = "operational_message_invalid"
        case messageTooLarge = "operational_message_too_large"
        case requestTooLarge = "operational_request_too_large"
        case requestFailed = "operational_request_failed"
        case unknown = "queued_hook_unknown_error"
    }

    enum Event: Equatable, Sendable {
        case attemptCompleted(
            attempt: Int, outcome: AttemptOutcome, code: FailureCode?, elapsedMilliseconds: UInt64
        )
        case requestCompleted(result: FinalResult, attempts: Int, elapsedMilliseconds: UInt64)
    }

    private static let logger = Logger(subsystem: "com.biadone.blabee", category: "queued-hook")

    static func record(_ event: Event) {
        switch event {
        case .attemptCompleted(let attempt, let outcome, let code, let elapsed):
            logger.notice("event=queued_hook_attempt_completed attempt=\(attempt, privacy: .public) outcome=\(outcome.rawValue, privacy: .public) code=\(code?.rawValue ?? "none", privacy: .public) elapsed_ms=\(elapsed, privacy: .public)")
        case .requestCompleted(let result, let attempts, let elapsed):
            logger.notice("event=queued_hook_request_completed result=\(result.rawValue, privacy: .public) attempts=\(attempts, privacy: .public) elapsed_ms=\(elapsed, privacy: .public)")
        }
    }

    static func failureCode(for error: Error) -> FailureCode {
        guard let error = error as? CoordinatorError else { return .unknown }
        return FailureCode(rawValue: error.code) ?? .unknown
    }
}

enum HookRequestPolicy {
    private static let queuedPromptPrimaryAttempt = HookRequestAttempt(
        connectTimeoutMilliseconds: 400,
        responseTimeoutMilliseconds: 3_900
    )
    private static let queuedPromptRetryAttempt = HookRequestAttempt(
        connectTimeoutMilliseconds: 400,
        responseTimeoutMilliseconds: 1_900
    )
    private static let ambiguousResponseErrorCodes: Set<String> = [
        "operational_response_timeout",
        "operational_transport_closed",
        "operational_transport_failed",
    ]

    static func perform(
        eventName: String,
        payload: [String: Any],
        onPermissionFailure: (HookPermissionDiagnostics.FailureCode) -> Void = { _ in },
        onQueuedDiagnostic: (HookQueuedPromptDiagnostics.Event) -> Void = { _ in },
        monotonicNowMilliseconds: () -> UInt64 = { DispatchTime.now().uptimeNanoseconds / 1_000_000 },
        request: (HookRequestAttempt) throws -> [String: Any]
    ) -> HookRequestOutcome {
        guard isExactQueuedPromptSubmit(eventName: eventName, payload: payload) else {
            let attempt = HookRequestAttempt(
                connectTimeoutMilliseconds: 2_000,
                responseTimeoutMilliseconds: eventName == "PermissionRequest"
                    ? HookPermissionTimingPolicy.socketResponseTimeoutMilliseconds
                    : 5_000
            )
            do {
                return .response(try request(attempt))
            } catch {
                if eventName == "PermissionRequest" {
                    onPermissionFailure(HookPermissionDiagnostics.failureCode(for: error))
                }
                return .unavailable
            }
        }

        let startedAt = monotonicNowMilliseconds()
        var attempts = 0
        var finalResult = HookQueuedPromptDiagnostics.FinalResult.unavailable
        func elapsedMilliseconds(since start: UInt64) -> UInt64 {
            let now = monotonicNowMilliseconds()
            return now >= start ? now - start : 0
        }
        defer {
            onQueuedDiagnostic(.requestCompleted(
                result: finalResult,
                attempts: attempts,
                elapsedMilliseconds: elapsedMilliseconds(since: startedAt)
            ))
        }
        func queuedRequest(_ attempt: HookRequestAttempt) throws -> [String: Any] {
            attempts += 1
            let attemptStartedAt = monotonicNowMilliseconds()
            do {
                let result = try request(attempt)
                onQueuedDiagnostic(.attemptCompleted(
                    attempt: attempts, outcome: .responseReceived, code: nil,
                    elapsedMilliseconds: elapsedMilliseconds(since: attemptStartedAt)
                ))
                return result
            } catch {
                onQueuedDiagnostic(.attemptCompleted(
                    attempt: attempts, outcome: .failed,
                    code: HookQueuedPromptDiagnostics.failureCode(for: error),
                    elapsedMilliseconds: elapsedMilliseconds(since: attemptStartedAt)
                ))
                throw error
            }
        }

        do {
            let result = try queuedRequest(queuedPromptPrimaryAttempt)
            finalResult = .responseReceived
            return .response(result)
        } catch {
            guard isAmbiguousResponseFailure(error) else { return .unavailable }
        }

        do {
            let result = try queuedRequest(queuedPromptRetryAttempt)
            finalResult = .responseReceived
            return .response(result)
        } catch {
            finalResult = .noActionContext
            return .queuedPromptUnavailable
        }
    }

    private static func isExactQueuedPromptSubmit(
        eventName: String,
        payload: [String: Any]
    ) -> Bool {
        guard eventName == "UserPromptSubmit",
              payload["hook_event_name"] as? String == "UserPromptSubmit",
              let prompt = payload["prompt"] as? String,
              case .exact = QueuedPromptEnvelope.classify(prompt)
        else { return false }
        return true
    }

    private static func isAmbiguousResponseFailure(_ error: Error) -> Bool {
        guard let error = error as? CoordinatorError else { return false }
        return ambiguousResponseErrorCodes.contains(error.code)
    }
}

enum HookPermissionOutputPolicy {
    static func qualifiedPayload(
        _ input: [String: Any], qualification: String?
    ) -> [String: Any] {
        var payload = input
        payload.removeValue(forKey: HookPermissionPolicy.qualificationKey)
        if HookPermissionPolicy.allowsOnce(qualification: qualification) {
            payload[HookPermissionPolicy.qualificationKey] = qualification
        }
        return payload
    }

    static func acceptsResponse(
        _ result: [String: Any], input: [String: Any], currentQualification: String?
    ) -> Bool {
        let baseKeys: Set<String> = [
            "decision", "delivery_token", "request_id", "session_id", "turn_id",
        ]
        guard let decision = result["decision"] as? String,
              equalBytes(result["session_id"], input["session_id"]),
              equalBytes(result["turn_id"], input["turn_id"])
        else { return false }
        switch decision {
        case "deny", "defer_to_codex":
            return Set(result.keys) == baseKeys
        case "allow_once":
            return Set(result.keys) == baseKeys.union([
                "command_preview", "cwd", HookPermissionPolicy.qualificationKey,
            ])
                && HookPermissionPolicy.allowsOnce(qualification: currentQualification)
                && equalBytes(
                    input[HookPermissionPolicy.qualificationKey], currentQualification
                )
                && equalBytes(
                    result[HookPermissionPolicy.qualificationKey], currentQualification
                )
                && input["hook_event_name"] as? String == "PermissionRequest"
                && input["permission_mode"] as? String == "default"
                && input["tool_name"] as? String == "Bash"
                && equalBytes(
                    result["command_preview"],
                    (input["tool_input"] as? [String: Any])?["command"]
                )
                && equalBytes(result["cwd"], input["cwd"])
        default:
            return false
        }
    }

    private static func equalBytes(_ lhs: Any?, _ rhs: Any?) -> Bool {
        guard let lhs = lhs as? String, let rhs = rhs as? String else { return false }
        return lhs.utf8.elementsEqual(rhs.utf8)
    }
}

func runHookCommand(arguments: [String]) {
    // Ordinary Hooks are deliberately fail-open. Only an exact Blabee queued
    // prompt gets one bounded response-loss retry and a safe no-action context
    // when both attempts fail.
    let isPermissionRequest = arguments.first == "PermissionRequest"
    do {
        guard let eventName = arguments.first,
              let requestType = hookEvents[eventName]
        else { return }
        if isPermissionRequest {
            HookPermissionDiagnostics.record(.received)
        }
        // A managed App Server broker owns command approval request IDs and
        // responses. Its child Codex process marks that ownership explicitly
        // so the Hook path cannot race a second approval decision.
        if eventName == "PermissionRequest",
           ProcessInfo.processInfo.environment["BLABEE_MANAGED_APPROVALS"] == "1"
        {
            HookPermissionDiagnostics.record(.managedOwnershipBypass)
            return
        }
        let socketFlag = try optionalSocketFlag(Array(arguments.dropFirst()))
        let socketPath = try OperationalSocketPath.resolve(explicitPath: socketFlag)
        let inputData = try readStandardInput(maximumBytes: 1_048_576)
        let input = try StrictJSONTransport.object(
            from: inputData,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        // Use the same effective thread for admission, response validation and
        // delivery ACK. Native Hook output has no session field to rewrite.
        var payload = try HookThreadRoutingPolicy.routedPayload(
            eventName: eventName, input: input
        )
        // The coordinator may expose Hook allow-once only after attesting the
        // live Codex ancestry. Never trust a caller-supplied marker; derive it
        // locally and omit it when the attestation cannot be established.
        if eventName == "PermissionRequest" {
            let qualification = CodexHookApprovalQualification.currentQualification()
            payload = HookPermissionOutputPolicy.qualifiedPayload(
                payload, qualification: qualification
            )
            HookPermissionDiagnostics.record(
                HookPermissionPolicy.allowsOnce(qualification: qualification)
                    ? .callerQualified : .callerUnqualified
            )
        }
        // Keep initialization failures inside the same diagnostic boundary as
        // request failures, without repeating runtime identity validation.
        let client = Result { try UnixDomainSocketClient(socketPath: socketPath) }
        let outcome = HookRequestPolicy.perform(
            eventName: eventName,
            payload: payload,
            onPermissionFailure: { code in
                HookPermissionDiagnostics.recordFailure(.requestFailed, code: code)
            },
            onQueuedDiagnostic: HookQueuedPromptDiagnostics.record
        ) { attempt in
            try client.get().request(
                type: requestType,
                payload: payload,
                connectTimeoutMilliseconds: attempt.connectTimeoutMilliseconds,
                responseTimeoutMilliseconds: attempt.responseTimeoutMilliseconds
            )
        }
        let result: [String: Any]
        switch outcome {
        case .response(let value):
            result = value
        case .queuedPromptUnavailable:
            try writeStandardOutputJSON([
                "hookSpecificOutput": [
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": QueuedPromptEnvelope.unavailableAdditionalContext,
                ],
            ])
            return
        case .unavailable:
            return
        }
        guard result["enabled"] as? Bool != false else {
            if isPermissionRequest {
                HookPermissionDiagnostics.record(.coordinatorDisabled)
            }
            return
        }

        if eventName == "PermissionRequest" {
            if Set(result.keys) == ["decision"] {
                guard result["decision"] as? String == "defer_to_codex" else {
                    HookPermissionDiagnostics.record(.responseInvalid)
                    return
                }
                HookPermissionDiagnostics.record(.coordinatorDeferred)
                return
            }
            guard let decision = result["decision"] as? String,
                  HookPermissionOutputPolicy.acceptsResponse(
                      result, input: payload,
                      currentQualification: decision == "allow_once"
                          ? CodexHookApprovalQualification.currentQualification() : nil
                  )
            else {
                HookPermissionDiagnostics.record(.responseInvalid)
                return
            }
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
            case "allow_once":
                try writeStandardOutputJSON([
                    "hookSpecificOutput": [
                        "hookEventName": "PermissionRequest",
                        "decision": ["behavior": "allow"],
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
                HookPermissionDiagnostics.record(.coordinatorDeferred)
            default:
                return
            }
            // Finish adapter output before ACK. The launcher buffers this until
            // exit; this does not prove native consumption or command execution.
            try FileHandle.standardOutput.close()
            if decision == "allow_once" {
                HookPermissionDiagnostics.record(.allowOnceOutputPrepared)
            } else if decision == "deny" {
                HookPermissionDiagnostics.record(.denyOutputPrepared)
            }
            let acknowledgement = try client.get().request(
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
            guard acknowledgement.isEmpty else {
                HookPermissionDiagnostics.record(.deliveryAcknowledgementInvalid)
                return
            }
            HookPermissionDiagnostics.record(.deliveryAcknowledgementReceived)
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
        if isPermissionRequest {
            HookPermissionDiagnostics.recordFailure(
                .failed, code: HookPermissionDiagnostics.failureCode(for: error)
            )
        }
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
                // Durable acceptance can finish before the reply reaches MCP.
                // Give this write one bounded wait; never resend on a lost ACK.
                responseTimeoutMilliseconds: 15_000
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
            let errorCode = failure["error_code"] as? String ?? "coordinator_unavailable_or_rejected"
            let retryable = failure["retryable"] as? Bool ?? false
            let explanation = errorCode == "decision_delivery_unconfirmed"
                ? "Blabee did not receive a decision acknowledgement. The proposal may already "
                    + "be stored; a missing acknowledgement does not mean rejection. "
                    + "Do not automatically retry or submit a new proposal. "
                : "Blabee coordinator unavailable or rejected the proposal. "
            try writeMCPResult(id: message["id"], value: [
                "isError": true,
                "content": [[
                    "type": "text",
                    "text": explanation
                        + "error_code=\(errorCode); retryable=\(retryable).",
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
    case "operational_response_timeout",
         "operational_transport_closed",
         "operational_transport_failed":
        return [
            // Kept for envelope compatibility: acceptance was not confirmed,
            // which is not evidence that the durable write was rejected.
            "accepted": false,
            "error_code": "decision_delivery_unconfirmed",
            "retryable": false,
        ]
    case "proposal_source_prompt_mismatch":
        return [
            "accepted": false,
            "error_code": code,
            "retryable": true,
        ]
    case "proposal_session_context_missing",
         "proposal_binding_mismatch":
        return [
            "accepted": false,
            "error_code": "decision_context_invalid_or_expired",
            "retryable": false,
        ]
    case "operational_runtime_identity_mismatch",
         "operational_runtime_request_not_compatible":
        return [
            "accepted": false,
            "error_code": "runtime_compatibility_rejected",
            "retryable": false,
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
    let suppliedKeys = Set(wrapper.keys)
    guard (suppliedKeys == wrapperKeys || suppliedKeys == wrapperKeys.union(["suggestion_kind"])),
          wrapperKeys.subtracting(Set(["proposal"])).allSatisfy({
              guard let value = wrapper[$0] as? String else { return false }
              return !value.isEmpty
          }),
          let proposal = wrapper["proposal"] as? [String: Any]
    else { throw CoordinatorError("operational_request_invalid") }
    if let rawKind = wrapper["suggestion_kind"] {
        guard let value = rawKind as? String, BlabeeSuggestionKind(rawValue: value) != nil else {
            throw CoordinatorError("operational_request_invalid")
        }
    }

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
    let suppliedProposalKeys = Set(proposal.keys)
    let rankedActions = proposal["next_actions"] as? [[String: Any]]
    guard suppliedProposalKeys == rankedProposalKeys,
          rankedActions.map({ (2...4).contains($0.count) }) == true,
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
        "description": "Send two to four ranked next actions for the exact active project, session, prompt episode, and turn. "
            + BlabeeSuggestionContext.cardEligibilityInstructions + " "
            + BlabeeSuggestionContext.cardLanguageInstructions,
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
                "suggestion_kind": [
                    "type": "string",
                    "enum": BlabeeSuggestionKind.allCases.map(\.rawValue),
                    "description": "Presentation category only: current_task for follow-ups to the user's current work; new_suggestion for separately discovered ideas. It does not attest host origin or change session routing. Omit only for legacy callers.",
                ] as [String: Any],
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

final class StandardInputLineReader {
    private let maximumBytes: Int
    private let inputDescriptor: Int32
    private var buffer = Data()
    private var reachedEnd = false

    // The caller owns the descriptor; the reader only borrows it.
    init(maximumBytes: Int, inputDescriptor: Int32 = STDIN_FILENO) {
        self.maximumBytes = maximumBytes
        self.inputDescriptor = inputDescriptor
    }

    func nextLine() throws -> Data? {
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                guard buffer.distance(from: buffer.startIndex, to: newline) <= maximumBytes else {
                    throw CoordinatorError("operational_message_too_large")
                }
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                return line
            }
            guard buffer.count <= maximumBytes else {
                throw CoordinatorError("operational_message_too_large")
            }
            if reachedEnd {
                guard !buffer.isEmpty else { return nil }
                defer { buffer.removeAll(keepingCapacity: false) }
                return buffer
            }

            var chunk = [UInt8](repeating: 0, count: 16 * 1024)
            let count = chunk.withUnsafeMutableBytes { bytes in
                Darwin.read(inputDescriptor, bytes.baseAddress, bytes.count)
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
        }
    }
}

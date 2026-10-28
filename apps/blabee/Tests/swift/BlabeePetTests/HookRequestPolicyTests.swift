import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let queuedReference = String(repeating: "ab", count: 16)
private var readableQueuedAction: [String: Any] {
    [
        "title": "선택한 옵션",
        "objective": "선택한 작업만 수행합니다.",
        "constraints": ["기존 세션을 보존합니다."],
        "done_when": ["검증 결과를 보고합니다."],
    ]
}

private func readableQueuedPromptPayload() throws -> [String: Any] {
    [
        "hook_event_name": "UserPromptSubmit",
        "prompt": try #require(QueuedPromptEnvelope.message(
            reference: queuedReference, action: readableQueuedAction
        )),
    ]
}

private func verifiedReadableQueuedResponse(action: [String: Any] = readableQueuedAction) throws -> [String: Any] {
    let actionJSON = try StrictJSONTransport.data(forJSONObject: action)
    return [
        "enabled": true,
        "prompt_origin": "blabee_next_turn",
        "additionalContext": "Blabee boundary: verified fixture\n\n"
            + QueuedPromptEnvelope.verifiedActionContextMarker
            + String(decoding: actionJSON, as: UTF8.self),
    ]
}

private func queuedPromptPayload() throws -> [String: Any] {
    [
        "hook_event_name": "UserPromptSubmit",
        "prompt": try #require(QueuedPromptEnvelope.message(reference: queuedReference)),
    ]
}

@Test("an exact queued prompt retries one ambiguous response loss", arguments: [
    "operational_response_timeout", "operational_transport_closed", "operational_transport_failed",
])
func exactQueuedPromptRetriesOneAmbiguousResponseLoss(code: String) throws {
    var attempts: [HookRequestAttempt] = []
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var now: UInt64 = 10_000

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload(),
        onQueuedDiagnostic: { diagnostics.append($0) },
        monotonicNowMilliseconds: { now }
    ) { attempt in
        attempts.append(attempt)
        if attempts.count == 1 {
            now += 3_900
            throw CoordinatorError(code, "private error description")
        }
        now += 45
        return ["additionalContext": "verified"]
    }

    guard case .response(let result) = outcome else {
        Issue.record("expected the retry response")
        return
    }
    #expect(result["additionalContext"] as? String == "verified")
    #expect(attempts == [
        HookRequestAttempt(connectTimeoutMilliseconds: 400, responseTimeoutMilliseconds: 3_900),
        HookRequestAttempt(connectTimeoutMilliseconds: 400, responseTimeoutMilliseconds: 1_900),
    ])
    #expect(attempts.reduce(0) {
        $0 + Int($1.connectTimeoutMilliseconds + $1.responseTimeoutMilliseconds)
    } < 7_000)
    #expect(diagnostics == [
        .attemptCompleted(
            attempt: 1, outcome: .failed,
            code: HookQueuedPromptDiagnostics.FailureCode(rawValue: code),
            elapsedMilliseconds: 3_900
        ),
        .attemptCompleted(attempt: 2, outcome: .responseReceived, code: nil, elapsedMilliseconds: 45),
        .requestCompleted(result: .responseReceived, attempts: 2, elapsedMilliseconds: 3_945),
    ])
}

@Test("a queued prompt primary response is preserved without a recovery warning")
func exactQueuedPromptPrimaryResponseHasNoRecoveryContext() throws {
    var attempts = 0
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var now: UInt64 = 100

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload(),
        onQueuedDiagnostic: { diagnostics.append($0) },
        monotonicNowMilliseconds: { now }
    ) { _ in
        attempts += 1
        now += 27
        return ["additionalContext": "verified"]
    }

    guard case .response(let result) = outcome else {
        Issue.record("expected the primary response")
        return
    }
    #expect(result["additionalContext"] as? String == "verified")
    #expect(Set(result.keys) == ["additionalContext"])
    #expect(attempts == 1)
    #expect(diagnostics == [
        .attemptCompleted(attempt: 1, outcome: .responseReceived, code: nil, elapsedMilliseconds: 27),
        .requestCompleted(result: .responseReceived, attempts: 1, elapsedMilliseconds: 27),
    ])
}

@Test("an ordinary human prompt remains one shot")
func humanPromptRemainsOneShot() {
    var attempts: [HookRequestAttempt] = []

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: [
            "hook_event_name": "UserPromptSubmit",
            "prompt": "Please explain this project",
        ]
    ) { attempt in
        attempts.append(attempt)
        throw CoordinatorError("operational_response_timeout")
    }

    guard case .unavailable = outcome else {
        Issue.record("expected silent fail-open for an ordinary prompt")
        return
    }
    #expect(attempts.count == 1)
    #expect(attempts[0].responseTimeoutMilliseconds == 5_000)
}

@Test("two queued prompt response failures select the safe context")
func queuedPromptDoubleFailureSelectsSafeContext() throws {
    var attempts = 0
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var now: UInt64 = 1_000

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload(),
        onQueuedDiagnostic: { diagnostics.append($0) },
        monotonicNowMilliseconds: { now }
    ) { _ in
        attempts += 1
        now += attempts == 1 ? 3_900 : 1_900
        throw CoordinatorError(
            attempts == 1
                ? "operational_transport_closed"
                : "operational_transport_failed"
        )
    }

    guard case .queuedPromptUnavailable = outcome else {
        Issue.record("expected safe queued-prompt recovery context")
        return
    }
    #expect(attempts == 2)
    #expect(diagnostics == [
        .attemptCompleted(attempt: 1, outcome: .failed, code: .transportClosed, elapsedMilliseconds: 3_900),
        .attemptCompleted(attempt: 2, outcome: .failed, code: .transportFailed, elapsedMilliseconds: 1_900),
        .requestCompleted(result: .noActionContext, attempts: 2, elapsedMilliseconds: 5_800),
    ])
    #expect(!QueuedPromptEnvelope.unavailableAdditionalContext.contains(queuedReference))
    #expect(!QueuedPromptEnvelope.unavailableAdditionalContext.contains("sha256:"))
    #expect(!QueuedPromptEnvelope.unavailableAdditionalContext.contains("operational_"))
    #expect(QueuedPromptEnvelope.unavailableAdditionalContext.contains("internal Hook verification"))
    #expect(QueuedPromptEnvelope.unavailableAdditionalContext.contains(
        "does not show that the user's selection deadline expired"
    ))
    #expect(QueuedPromptEnvelope.unavailableAdditionalContext.contains("Do not execute this request"))
    #expect(QueuedPromptEnvelope.unavailableAdditionalContext.contains("or infer or replay an action from its ref"))
    #expect(QueuedPromptEnvelope.unavailableAdditionalContext.contains("select a fresh Blabee action"))
}

@Test("permission timeout uses the shared review budget and never retries")
func permissionRequestTimeoutRemainsOneShot() {
    var attempts: [HookRequestAttempt] = []
    var failures: [HookPermissionDiagnostics.FailureCode] = []

    let outcome = HookRequestPolicy.perform(
        eventName: "PermissionRequest",
        payload: ["hook_event_name": "PermissionRequest"],
        onPermissionFailure: { failures.append($0) }
    ) { attempt in
        attempts.append(attempt)
        throw CoordinatorError("operational_response_timeout")
    }

    guard case .unavailable = outcome else {
        Issue.record("expected permission timeout to defer silently")
        return
    }
    #expect(attempts == [HookRequestAttempt(
        connectTimeoutMilliseconds: 2_000,
        responseTimeoutMilliseconds: HookPermissionTimingPolicy.socketResponseTimeoutMilliseconds
    )])
    #expect(
        Int64(attempts[0].responseTimeoutMilliseconds)
            > HookPermissionTimingPolicy.userDecisionTimeoutMilliseconds
    )
    #expect(failures == [.responseTimeout])
}

@Test("permission failures report only a fixed diagnostic code", arguments: [
    "permission_request_binding_invalid",
    "permission_request_capacity_exceeded",
    "operational_transport_closed",
    "operational_response_timeout command=private-command token=private-token",
])
func permissionRequestFailuresAreBounded(code: String) {
    var attempts = 0
    var failures: [HookPermissionDiagnostics.FailureCode] = []

    let outcome = HookRequestPolicy.perform(
        eventName: "PermissionRequest",
        payload: ["hook_event_name": "PermissionRequest"],
        onPermissionFailure: { failures.append($0) }
    ) { _ in
        attempts += 1
        throw CoordinatorError(code, "private error description")
    }

    guard case .unavailable = outcome else {
        Issue.record("expected permission failure to defer silently")
        return
    }
    #expect(attempts == 1)
    #expect(failures == [HookPermissionDiagnostics.FailureCode(rawValue: code) ?? .unknown])
}

@Test("ordinary Hook failures do not emit permission diagnostics", arguments: [
    "SessionStart", "UserPromptSubmit", "Stop",
])
func ordinaryHookFailuresDoNotEmitPermissionDiagnostics(eventName: String) {
    var failures: [HookPermissionDiagnostics.FailureCode] = []

    let outcome = HookRequestPolicy.perform(
        eventName: eventName,
        payload: ["hook_event_name": eventName],
        onPermissionFailure: { failures.append($0) }
    ) { _ in
        throw CoordinatorError("operational_response_timeout")
    }

    guard case .unavailable = outcome else {
        Issue.record("expected ordinary Hook failure to remain silent")
        return
    }
    #expect(failures.isEmpty)
}

@Test("a nonambiguous queued prompt failure is not retried or copied into diagnostics", arguments: [
    "operational_runtime_identity_unverified",
    "operational_runtime_identity_invalid",
    "operational_runtime_identity_mismatch",
    "operational_connect_timeout",
    "operational_response_timeout command=private-command path=/private/path token=private-token",
])
func queuedPromptIdentityFailureIsNotRetried(code: String) throws {
    var attempts = 0
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var now: UInt64 = 500

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload(),
        onQueuedDiagnostic: { diagnostics.append($0) },
        monotonicNowMilliseconds: { now }
    ) { _ in
        attempts += 1
        now += 19
        throw CoordinatorError(code, "private error description")
    }

    guard case .queuedPromptUnavailable = outcome else {
        Issue.record("expected a nonambiguous failure to remain one shot with safe context")
        return
    }
    #expect(attempts == 1)
    #expect(diagnostics == [
        .attemptCompleted(
            attempt: 1, outcome: .failed,
            code: HookQueuedPromptDiagnostics.FailureCode(rawValue: code) ?? .unknown,
            elapsedMilliseconds: 19
        ),
        .requestCompleted(result: .noActionContext, attempts: 1, elapsedMilliseconds: 19),
    ])
}

@Test("a queued prompt retry reports an unknown error without leaking its description")
func queuedPromptRetryUnknownErrorIsPrivateAndBounded() throws {
    var attempts = 0
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var now: UInt64 = 100

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload(),
        onQueuedDiagnostic: { diagnostics.append($0) },
        monotonicNowMilliseconds: { now }
    ) { _ in
        attempts += 1
        now += 10
        if attempts == 1 { throw CoordinatorError("operational_response_timeout") }
        throw NSError(domain: "private-token", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "private-command /private/path ref=" + queuedReference,
        ])
    }

    guard case .queuedPromptUnavailable = outcome else {
        Issue.record("expected safe recovery after the retry fails")
        return
    }
    #expect(attempts == 2)
    #expect(diagnostics == [
        .attemptCompleted(attempt: 1, outcome: .failed, code: .responseTimeout, elapsedMilliseconds: 10),
        .attemptCompleted(attempt: 2, outcome: .failed, code: .unknown, elapsedMilliseconds: 10),
        .requestCompleted(result: .noActionContext, attempts: 2, elapsedMilliseconds: 20),
    ])
}

@Test("nonqueued prompt failures do not retry or emit queued diagnostics")
func nonqueuedPromptFailuresHaveNoQueuedDiagnostics() {
    var attempts = 0
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var clockReads = 0

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: ["hook_event_name": "UserPromptSubmit", "prompt": "ordinary prompt"],
        onQueuedDiagnostic: { diagnostics.append($0) },
        monotonicNowMilliseconds: { clockReads += 1; return 0 }
    ) { _ in
        attempts += 1
        throw CoordinatorError("operational_response_timeout")
    }

    guard case .unavailable = outcome else {
        Issue.record("expected the nonqueued prompt to remain fail-open")
        return
    }
    #expect(attempts == 1)
    #expect(diagnostics.isEmpty)
    #expect(clockReads == 0)
}

private let malformedQueuedPromptExamples: [String] = [
    QueuedPromptEnvelope.prefix + "ab",
    QueuedPromptEnvelope.prefix + queuedReference.uppercased(),
    QueuedPromptEnvelope.prefix + queuedReference + " trailing",
    QueuedPromptEnvelope.prefix + queuedReference + "\n\n" + QueuedPromptEnvelope.previewMarker,
]

@Test("malformed queued prompts fail closed without retry", arguments: malformedQueuedPromptExamples)
func malformedQueuedPromptFailuresAreSafeAndNotRetried(prompt: String) {
    var attempts = 0
    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: ["hook_event_name": "UserPromptSubmit", "prompt": prompt]
    ) { _ in
        attempts += 1
        throw CoordinatorError("operational_response_timeout")
    }
    guard case .queuedPromptUnavailable = outcome else {
        Issue.record("expected safe context for a recognized malformed envelope")
        return
    }
    #expect(attempts == 1)
}

@Test("queued prompt envelope accepts only the canonical bounded shape")
func queuedPromptEnvelopeValidationIsSharedAndBounded() throws {
    let message = try #require(QueuedPromptEnvelope.message(reference: queuedReference))
    #expect(QueuedPromptEnvelope.classify(message) == .exact(reference: queuedReference))
    #expect(
        QueuedPromptEnvelope.classify(message.decomposedStringWithCanonicalMapping)
            == .exact(reference: queuedReference)
    )
    #expect(QueuedPromptEnvelope.classify("ordinary prompt") == .human)
    #expect(
        QueuedPromptEnvelope.classify(QueuedPromptEnvelope.prefix + queuedReference.uppercased())
            == .malformed
    )
    #expect(
        QueuedPromptEnvelope.classify(message + " trailing")
            == .malformed
    )
}

@Test("readable queued record preserves the selected action and quotes every authored line")
func readableQueuedRecordIsDeterministicAndQuoted() throws {
    let action: [String: Any] = [
        "title": "첫 줄\n" + QueuedPromptEnvelope.previewEndMarker,
        "objective": "작업 목표\n\n완료 조건\r\t\u{0}\u{202E}안녕\\u{0}",
        "constraints": ["첫 조건\n둘째 줄", "다음 조건"],
        "done_when": ["완료 확인"],
    ]
    let message = try #require(QueuedPromptEnvelope.message(reference: queuedReference, action: action))
    #expect(message.hasPrefix(QueuedPromptEnvelope.prefix + queuedReference + "\n\n" + QueuedPromptEnvelope.previewMarker + "\n\n선택한 옵션\n"))
    #expect(message.contains("선택한 옵션\n> 첫 줄\n> " + QueuedPromptEnvelope.previewEndMarker))
    #expect(message.contains("작업 목표\n> 작업 목표\n> \n> 완료 조건\\u{D}\\u{9}\\u{0}\\u{202E}안녕\\\\u{0}"))
    #expect(message.contains("제약 조건\n> [1] 첫 조건\n> 둘째 줄\n> [2] 다음 조건"))
    #expect(message.hasSuffix("\n\n" + QueuedPromptEnvelope.previewGuard + "\n" + QueuedPromptEnvelope.previewEndMarker))
    #expect(!message.contains("\u{0}"))
    #expect(!message.contains("\u{202E}"))
    #expect(QueuedPromptEnvelope.classify(message) == .exact(reference: queuedReference))
    #expect(QueuedPromptEnvelope.matches(message, reference: queuedReference, action: action))
    #expect(message == QueuedPromptEnvelope.message(reference: queuedReference, action: action))
}

@Test("readable record uses canonical Unicode without changing exact transport bytes")
func readableQueuedRecordNormalizesOnlyForComparison() throws {
    let message = try #require(QueuedPromptEnvelope.message(
        reference: queuedReference, action: readableQueuedAction
    ))
    let decomposed = message.decomposedStringWithCanonicalMapping
    #expect(!message.utf8.elementsEqual(decomposed.utf8))
    #expect(QueuedPromptEnvelope.classify(decomposed) == .exact(reference: queuedReference))
    #expect(QueuedPromptEnvelope.matches(decomposed, reference: queuedReference, action: readableQueuedAction))
    var decomposedAction = readableQueuedAction
    decomposedAction["title"] = (readableQueuedAction["title"] as? String)?.decomposedStringWithCanonicalMapping
    #expect(message == QueuedPromptEnvelope.message(reference: queuedReference, action: decomposedAction))
}

@Test("readable record accepts a bounded canonical prompt whose decomposed transport is larger")
func readableQueuedRecordBoundIsCanonicalUTF8() throws {
    var action = readableQueuedAction
    action["objective"] = String(repeating: "한", count: 39_000)
    let message = try #require(QueuedPromptEnvelope.message(reference: queuedReference, action: action))
    let decomposed = message.decomposedStringWithCanonicalMapping
    #expect(message.utf8.count < QueuedPromptEnvelope.maximumMessageBytes)
    #expect(decomposed.utf8.count > QueuedPromptEnvelope.maximumMessageBytes)
    #expect(QueuedPromptEnvelope.classify(decomposed) == .exact(reference: queuedReference))
    #expect(QueuedPromptEnvelope.matches(decomposed, reference: queuedReference, action: action))
}

@Test("readable record rejects invalid and oversized data without truncating it")
func readableQueuedRecordBoundsAndGrammar() throws {
    let message = try #require(QueuedPromptEnvelope.message(reference: queuedReference, action: readableQueuedAction))
    #expect(QueuedPromptEnvelope.message(reference: queuedReference.uppercased(), action: readableQueuedAction) == nil)
    var oversized = readableQueuedAction
    oversized["objective"] = String(repeating: "a", count: QueuedPromptEnvelope.maximumMessageBytes)
    #expect(QueuedPromptEnvelope.message(reference: queuedReference, action: oversized) == nil)
    oversized["objective"] = String(repeating: "\u{0}", count: 30_000)
    #expect(QueuedPromptEnvelope.message(reference: queuedReference, action: oversized) == nil)
    var invalid = readableQueuedAction
    invalid["done_when"] = [String]()
    #expect(QueuedPromptEnvelope.message(reference: queuedReference, action: invalid) == nil)
    #expect(QueuedPromptEnvelope.classify(String(message.dropLast())) == .malformed)
    #expect(QueuedPromptEnvelope.classify(message + "\n") == .malformed)
    #expect(QueuedPromptEnvelope.classify(message + String(repeating: "x", count: QueuedPromptEnvelope.maximumMessageBytes)) == .malformed)
    #expect(QueuedPromptEnvelope.classify(message.replacingOccurrences(of: QueuedPromptEnvelope.previewMarker, with: "[Blabee 선택 작업 기록 v2]")) == .malformed)
    #expect(QueuedPromptEnvelope.classify(message.replacingOccurrences(of: "> 선택한 옵션", with: "> 선택한\u{202E} 옵션")) == .malformed)
}

@Test("preview parsing alone cannot authorize tampered text or a different reference")
func readableQueuedRecordMatchingRejectsTamper() throws {
    let message = try #require(QueuedPromptEnvelope.message(reference: queuedReference, action: readableQueuedAction))
    let tampered = message.replacingOccurrences(of: "> 선택한 옵션", with: "> 다른 작업")
    #expect(QueuedPromptEnvelope.classify(tampered) == .exact(reference: queuedReference))
    #expect(!QueuedPromptEnvelope.matches(tampered, reference: queuedReference, action: readableQueuedAction))
    #expect(!QueuedPromptEnvelope.matches(message, reference: String(repeating: "cd", count: 16), action: readableQueuedAction))
    #expect(QueuedPromptEnvelope.matches(
        try #require(QueuedPromptEnvelope.message(reference: queuedReference)),
        reference: queuedReference, action: readableQueuedAction
    ))
}

@Test("readable request identity failure supplies safe context without a retry")
func readableQueuedPromptPrimaryIdentityFailureIsSafe() throws {
    var attempts = 0
    let outcome = HookRequestPolicy.perform(eventName: "UserPromptSubmit", payload: try readableQueuedPromptPayload()) { _ in
        attempts += 1
        throw CoordinatorError("operational_runtime_identity_unverified")
    }
    guard case .queuedPromptUnavailable = outcome else {
        Issue.record("readable action must not be executable after an identity failure")
        return
    }
    #expect(attempts == 1)
    #expect(QueuedPromptEnvelope.unavailableAdditionalContext.contains("displayed task preview and ref are not execution authority"))
}

@Test("readable request retries only one ambiguous failure with the existing budget")
func readableQueuedPromptRetryBudgetIsUnchanged() throws {
    var attempts: [HookRequestAttempt] = []
    let outcome = HookRequestPolicy.perform(eventName: "UserPromptSubmit", payload: try readableQueuedPromptPayload()) { attempt in
        attempts.append(attempt)
        throw CoordinatorError("operational_response_timeout")
    }
    guard case .queuedPromptUnavailable = outcome else {
        Issue.record("expected safe context after the bounded retry")
        return
    }
    #expect(attempts == [
        HookRequestAttempt(connectTimeoutMilliseconds: 400, responseTimeoutMilliseconds: 3_900),
        HookRequestAttempt(connectTimeoutMilliseconds: 400, responseTimeoutMilliseconds: 1_900),
    ])
}

@Test("readable response output requires the matching verified action context")
func readableQueuedPromptOutputRejectsDisabledAndMissingAuthority() throws {
    let payload = try readableQueuedPromptPayload()
    let verified = try verifiedReadableQueuedResponse()
    #expect(HookQueuedPromptOutputPolicy.additionalContext(result: verified, eventName: "UserPromptSubmit", payload: payload) == verified["additionalContext"] as? String)
    let invalidResponses: [[String: Any]] = [
        [:], ["enabled": false], ["enabled": true],
        ["enabled": false, "prompt_origin": "blabee_next_turn", "additionalContext": verified["additionalContext"]!],
        ["enabled": true, "prompt_origin": "human", "additionalContext": verified["additionalContext"]!],
        ["enabled": true, "prompt_origin": "blabee_rejected", "additionalContext": ""],
        ["enabled": true, "prompt_origin": "blabee_next_turn", "additionalContext": "Unverified context"],
        ["enabled": true, "prompt_origin": "blabee_next_turn", "additionalContext": QueuedPromptEnvelope.verifiedActionContextMarker + "{}"],
    ]
    for result in invalidResponses {
        #expect(HookQueuedPromptOutputPolicy.additionalContext(result: result, eventName: "UserPromptSubmit", payload: payload) == QueuedPromptEnvelope.unavailableAdditionalContext)
    }
    var differentAction = readableQueuedAction
    differentAction["title"] = "다른 옵션"
    #expect(HookQueuedPromptOutputPolicy.additionalContext(result: try verifiedReadableQueuedResponse(action: differentAction), eventName: "UserPromptSubmit", payload: payload) == QueuedPromptEnvelope.unavailableAdditionalContext)
    var malformed = payload
    malformed["prompt"] = (payload["prompt"] as? String)! + " trailing"
    #expect(HookQueuedPromptOutputPolicy.additionalContext(result: verified, eventName: "UserPromptSubmit", payload: malformed) == QueuedPromptEnvelope.unavailableAdditionalContext)
    #expect(HookQueuedPromptOutputPolicy.additionalContext(result: verified, eventName: "PermissionRequest", payload: payload) == nil)
    #expect(HookQueuedPromptOutputPolicy.additionalContext(result: verified, eventName: "UserPromptSubmit", payload: ["prompt": "ordinary human request"]) == nil)
}

@Test("legacy verified actions do not acquire the new preview expansion limit")
func legacyQueuedPromptOutputDoesNotRequireReadableExpansion() throws {
    var action = readableQueuedAction
    let escapedControlText = "record " + String(repeating: "\u{85}", count: 7_500)
    action["objective"] = escapedControlText
    action["constraints"] = [escapedControlText, escapedControlText]
    #expect(try StrictJSONTransport.data(forJSONObject: action).count < 60_000)
    #expect(QueuedPromptEnvelope.message(reference: queuedReference, action: action) == nil)
    let response = try verifiedReadableQueuedResponse(action: action)
    #expect(HookQueuedPromptOutputPolicy.additionalContext(
        result: response, eventName: "UserPromptSubmit", payload: try queuedPromptPayload()
    ) == response["additionalContext"] as? String)
}

@Test("trusted stale replay rejection preserves the no-decision and newer-prompt guards")
func readableQueuedPromptOutputPreservesStaleReplayRejection() throws {
    let payload = try readableQueuedPromptPayload()
    let staleContext = "Blabee ignored a delayed replay of an earlier selection. Do not execute the visible Blabee request. Do not emit a decision for this replay. The newer session prompt remains unchanged."
    let rejected: [String: Any] = [
        "enabled": true,
        "prompt_origin": "blabee_rejected",
        "additionalContext": staleContext,
    ]
    #expect(HookQueuedPromptOutputPolicy.additionalContext(
        result: rejected, eventName: "UserPromptSubmit", payload: payload
    ) == staleContext)
    var disabled = rejected
    disabled["enabled"] = false
    #expect(HookQueuedPromptOutputPolicy.additionalContext(
        result: disabled, eventName: "UserPromptSubmit", payload: payload
    ) == QueuedPromptEnvelope.unavailableAdditionalContext)
}

@Test("queued preview fallback eligibility is known before Hook thread routing can fail")
func readableQueuedPromptFallbackSurvivesRoutingFailure() throws {
    var payload = try readableQueuedPromptPayload()
    payload["session_id"] = "session"
    payload["agent_id"] = "bad/identity"
    #expect(HookRequestPolicy.queuedPromptClassification(eventName: "UserPromptSubmit", payload: payload) == .exact(reference: queuedReference))
    #expect(throws: CoordinatorError.self) {
        _ = try HookThreadRoutingPolicy.routedPayload(eventName: "UserPromptSubmit", input: payload)
    }
}

import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let queuedReference = String(repeating: "ab", count: 16)

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

    guard case .unavailable = outcome else {
        Issue.record("expected a nonambiguous failure to remain one shot")
        return
    }
    #expect(attempts == 1)
    #expect(diagnostics == [
        .attemptCompleted(
            attempt: 1, outcome: .failed,
            code: HookQueuedPromptDiagnostics.FailureCode(rawValue: code) ?? .unknown,
            elapsedMilliseconds: 19
        ),
        .requestCompleted(result: .unavailable, attempts: 1, elapsedMilliseconds: 19),
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

@Test("nonqueued prompt failures do not retry or emit queued diagnostics", arguments: [
    "ordinary prompt",
    QueuedPromptEnvelope.prefix + "ab",
    QueuedPromptEnvelope.prefix + queuedReference.uppercased(),
    QueuedPromptEnvelope.prefix + queuedReference + " trailing",
])
func nonqueuedPromptFailuresHaveNoQueuedDiagnostics(prompt: String) {
    var attempts = 0
    var diagnostics: [HookQueuedPromptDiagnostics.Event] = []
    var clockReads = 0

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: ["hook_event_name": "UserPromptSubmit", "prompt": prompt],
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

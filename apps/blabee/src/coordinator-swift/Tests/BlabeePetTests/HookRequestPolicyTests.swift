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

@Test("an exact queued prompt retries one ambiguous response loss")
func exactQueuedPromptRetriesOneAmbiguousResponseLoss() throws {
    var attempts: [HookRequestAttempt] = []

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload()
    ) { attempt in
        attempts.append(attempt)
        if attempts.count == 1 {
            throw CoordinatorError("operational_response_timeout")
        }
        return ["additionalContext": "verified"]
    }

    guard case .response(let result) = outcome else {
        Issue.record("expected the retry response")
        return
    }
    #expect(result["additionalContext"] as? String == "verified")
    #expect(attempts.count == 2)
    #expect(attempts[0].responseTimeoutMilliseconds == 3_900)
    #expect(attempts[1].responseTimeoutMilliseconds == 1_900)
    #expect(attempts.reduce(0) {
        $0 + Int($1.connectTimeoutMilliseconds + $1.responseTimeoutMilliseconds)
    } < 7_000)
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

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload()
    ) { _ in
        attempts += 1
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
    #expect(!QueuedPromptEnvelope.unavailableAdditionalContext.contains(queuedReference))
    #expect(!QueuedPromptEnvelope.unavailableAdditionalContext.contains("sha256:"))
}

@Test("a nonambiguous queued prompt failure is not retried")
func queuedPromptIdentityFailureIsNotRetried() throws {
    var attempts = 0

    let outcome = HookRequestPolicy.perform(
        eventName: "UserPromptSubmit",
        payload: try queuedPromptPayload()
    ) { _ in
        attempts += 1
        throw CoordinatorError("operational_runtime_identity_mismatch")
    }

    guard case .unavailable = outcome else {
        Issue.record("expected a nonambiguous failure to remain one shot")
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

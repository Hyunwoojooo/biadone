import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("A rejected expanded preview lets Codex correct the proposal without claiming acceptance")
func emitDecisionPreviewTooLargeFailure() {
    let result = publicEmitDecisionFailure(CoordinatorError("queued_prompt_preview_invalid", "private action text"))
    #expect(Set(result.keys) == ["accepted", "error_code", "retryable"])
    #expect(result["accepted"] as? Bool == false)
    #expect(result["error_code"] as? String == "decision_preview_too_large")
    #expect(result["retryable"] as? Bool == true)
}

@Test("Unconfirmed writes and untrusted failures never acquire preview correction retry permission",
      arguments: ["operational_response_timeout", "operational_transport_closed",
                  "operational_transport_failed", "unexpected_private_failure"])
func emitDecisionOtherFailuresKeepRetryPolicy(code: String) {
    let result = publicEmitDecisionFailure(CoordinatorError(code, "private action text"))
    #expect(result["accepted"] as? Bool == false)
    #expect(result["error_code"] as? String == (code.hasPrefix("operational_")
        ? "decision_delivery_unconfirmed" : "coordinator_unavailable_or_rejected"))
    #expect(result["retryable"] as? Bool == false)
}

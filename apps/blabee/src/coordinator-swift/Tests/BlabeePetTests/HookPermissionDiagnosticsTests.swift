import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("permission diagnostics preserve known failure reasons without their messages")
func permissionDiagnosticsPreserveOnlyKnownCodes() {
    let message = "command=private-command cwd=/private/path session=private-session token=private-token"
    #expect(HookPermissionDiagnostics.failureCode(for: CoordinatorError(
        "operational_response_timeout", message
    )) == .responseTimeout)
    #expect(HookPermissionDiagnostics.failureCode(for: CoordinatorError(
        "permission_request_binding_invalid", message
    )) == .permissionBindingInvalid)
    #expect(HookPermissionDiagnostics.failureCode(for: CoordinatorError(
        "permission_request_capacity_exceeded", message
    )) == .permissionCapacityExceeded)
    #expect(HookPermissionDiagnostics.failureCode(for: CoordinatorError(
        "permission_request_delivery_timeout", message
    )) == .deliveryTimeout)
}

@Test("permission diagnostics replace unknown and injected error codes", arguments: [
    "",
    "unknown_error_code",
    "operational_response_timeout\ncommand=private-command",
    "permission_request_binding_invalid token=private-token",
    "cwd=/private/path session=private-session",
    String(repeating: "private-payload", count: 1_024),
])
func permissionDiagnosticsRejectUnknownCodes(code: String) {
    let safeCode = HookPermissionDiagnostics.failureCode(for: CoordinatorError(code))
    #expect(safeCode == .unknown)
    #expect(safeCode.rawValue == "permission_unknown_error")
}

@Test("permission diagnostics never derive a code from a foreign error description")
func permissionDiagnosticsRejectForeignErrors() {
    let error = NSError(
        domain: "operational_response_timeout", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "private-command private-token /private/path"]
    )
    #expect(HookPermissionDiagnostics.failureCode(for: error) == .unknown)
}

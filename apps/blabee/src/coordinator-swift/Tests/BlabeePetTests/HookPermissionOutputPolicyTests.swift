import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private func permissionPolicyInput() -> [String: Any] {
    [
        "hook_event_name": "PermissionRequest",
        "session_id": "session_policy",
        "turn_id": "turn_policy",
        "permission_mode": "default",
        "tool_name": "Bash",
        "tool_input": ["command": "/usr/bin/whoami"],
        "cwd": "/tmp/policy",
        HookPermissionPolicy.qualificationKey: HookPermissionPolicy.qualifiedRuntime,
    ]
}

private func permissionPolicyResponse(_ decision: String = "allow_once") -> [String: Any] {
    var result: [String: Any] = [
        "decision": decision,
        "delivery_token": "delivery_policy_token",
        "request_id": "request_policy",
        "session_id": "session_policy",
        "turn_id": "turn_policy",
    ]
    if decision == "allow_once" {
        result["command_preview"] = "/usr/bin/whoami"
        result["cwd"] = "/tmp/policy"
        result[HookPermissionPolicy.qualificationKey] = HookPermissionPolicy.qualifiedRuntime
    }
    return result
}

@Test("Hook qualification cannot be supplied by the incoming payload")
func hookPermissionInputRemovesUntrustedQualification() {
    for qualification: String? in [nil, "unqualified"] {
        let result = HookPermissionOutputPolicy.qualifiedPayload(
            permissionPolicyInput(), qualification: qualification
        )
        #expect(result[HookPermissionPolicy.qualificationKey] == nil)
        #expect(result["session_id"] as? String == "session_policy")
    }
    var input = permissionPolicyInput()
    input[HookPermissionPolicy.qualificationKey] = "forged"
    let qualified = HookPermissionOutputPolicy.qualifiedPayload(
        input, qualification: HookPermissionPolicy.qualifiedRuntime
    )
    #expect(qualified[HookPermissionPolicy.qualificationKey] as? String
        == HookPermissionPolicy.qualifiedRuntime)
}

@Test("Hook allow requires initial, fresh, and response qualifications")
func hookPermissionAllowRequiresAllQualifications() {
    let qualified = HookPermissionPolicy.qualifiedRuntime
    #expect(HookPermissionOutputPolicy.acceptsResponse(
        permissionPolicyResponse(), input: permissionPolicyInput(),
        currentQualification: qualified
    ))
    for invalid: String? in [nil, "unqualified"] {
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            permissionPolicyResponse(), input: permissionPolicyInput(),
            currentQualification: invalid
        ))
        var input = permissionPolicyInput()
        input[HookPermissionPolicy.qualificationKey] = invalid
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            permissionPolicyResponse(), input: input, currentQualification: qualified
        ))
        var response = permissionPolicyResponse()
        response[HookPermissionPolicy.qualificationKey] = invalid
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: permissionPolicyInput(), currentQualification: qualified
        ))
    }
}

@Test("Hook permission responses bind the exact session, turn, command, and session location")
func hookPermissionResponseRejectsMismatchedBinding() {
    for key in ["session_id", "turn_id", "command_preview", "cwd"] {
        var response = permissionPolicyResponse()
        response[key] = "different"
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: permissionPolicyInput(),
            currentQualification: HookPermissionPolicy.qualifiedRuntime
        ))
    }
    // Swift String equality normalizes Unicode; an approval must not normalize commands.
    let composed = "é"
    let decomposed = "e\u{301}"
    #expect(composed == decomposed)
    for key in ["command_preview", "cwd"] {
        var response = permissionPolicyResponse()
        var input = permissionPolicyInput()
        response[key] = composed
        if key == "cwd" { input["cwd"] = decomposed }
        else { input["tool_input"] = ["command": decomposed] }
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: input,
            currentQualification: HookPermissionPolicy.qualifiedRuntime
        ))
    }
}

@Test("Hook permission output accepts only the exact decision schema")
func hookPermissionResponseRejectsExpandedAuthority() {
    let qualified = HookPermissionPolicy.qualifiedRuntime
    for decision in ["deny", "defer_to_codex"] {
        #expect(HookPermissionOutputPolicy.acceptsResponse(
            permissionPolicyResponse(decision), input: permissionPolicyInput(),
            currentQualification: nil
        ))
        var response = permissionPolicyResponse(decision)
        response["cwd"] = "/tmp/policy"
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: permissionPolicyInput(), currentQualification: qualified
        ))
        response = permissionPolicyResponse(decision)
        response["turn_id"] = "other_turn"
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: permissionPolicyInput(), currentQualification: qualified
        ))
    }
    for decision in ["allow", "acceptForSession", "accept", ""] {
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            permissionPolicyResponse(decision), input: permissionPolicyInput(),
            currentQualification: qualified
        ))
    }
    for key in permissionPolicyResponse().keys {
        var response = permissionPolicyResponse()
        response.removeValue(forKey: key)
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: permissionPolicyInput(), currentQualification: qualified
        ))
    }
    for key in ["updatedPermissions", "rule", "scope", "extra"] {
        var response = permissionPolicyResponse()
        response[key] = "session"
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            response, input: permissionPolicyInput(), currentQualification: qualified
        ))
    }
}

@Test("Hook allow is limited to default Bash PermissionRequest")
func hookPermissionResponseRejectsUnsupportedRequestMode() {
    for (key, value) in [
        ("hook_event_name", "PreToolUse"),
        ("permission_mode", "acceptEdits"),
        ("tool_name", "Write"),
    ] {
        var input = permissionPolicyInput()
        input[key] = value
        #expect(!HookPermissionOutputPolicy.acceptsResponse(
            permissionPolicyResponse(), input: input,
            currentQualification: HookPermissionPolicy.qualifiedRuntime
        ))
    }
}

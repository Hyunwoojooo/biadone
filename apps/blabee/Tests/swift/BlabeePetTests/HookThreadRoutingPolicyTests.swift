import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private func threadRoutingInput(
    event: String = "PermissionRequest", agentID: String? = nil
) -> [String: Any] {
    var input: [String: Any] = [
        "hook_event_name": event,
        "session_id": "root_session",
        "turn_id": "turn_exact",
        "cwd": "/private/tmp/worktree-é",
        "permission_mode": "default",
        "tool_name": "Bash",
        "tool_input": ["command": "printf 'e\u{301}'\n/usr/bin/true"],
    ]
    if let agentID {
        input["agent_id"] = agentID
        input["agent_type"] = "debugger"
    }
    return input
}

@Test("Hook routing preserves root payload and isolates each spawned thread")
func hookThreadRoutingIsolatesRootAndSiblings() throws {
    for event in ["SessionStart", "UserPromptSubmit", "Stop", "PermissionRequest"] {
        for agentID: String? in [nil, "child_one", "child_two", "root_session"] {
            let input = threadRoutingInput(event: event, agentID: agentID)
            let routed = try HookThreadRoutingPolicy.routedPayload(eventName: event, input: input)
            #expect(routed["session_id"] as? String == (agentID ?? "root_session"))
            var restored = routed
            restored["session_id"] = "root_session"
            #expect(try JSONSerialization.data(withJSONObject: restored, options: .sortedKeys)
                == JSONSerialization.data(withJSONObject: input, options: .sortedKeys))
        }
    }
}

@Test("Hook routing rejects malformed or partial thread identity instead of addressing root")
func hookThreadRoutingRejectsAmbiguousIdentity() {
    let invalidIDs: [Any] = [
        "", "child other", "child\n", "child/other", "é", "e\u{301}",
        String(repeating: "a", count: 513), NSNull(), 42, ["id": "child"],
    ]
    for key in ["session_id", "agent_id"] {
        for invalid in invalidIDs {
            var input = threadRoutingInput(agentID: "child")
            input[key] = invalid
            #expect(throws: CoordinatorError.self) {
                try HookThreadRoutingPolicy.routedPayload(eventName: "PermissionRequest", input: input)
            }
        }
    }
    var input = threadRoutingInput()
    input["agent_type"] = "debugger"
    #expect(throws: CoordinatorError.self) {
        try HookThreadRoutingPolicy.routedPayload(eventName: "PermissionRequest", input: input)
    }
}

@Test("Hook routing does not normalize an unexpected event")
func hookThreadRoutingRejectsMismatchedEvent() {
    for event in ["Stop", "SubagentStart", "unknown"] {
        #expect(throws: CoordinatorError.self) {
            try HookThreadRoutingPolicy.routedPayload(
                eventName: event, input: threadRoutingInput(agentID: "child")
            )
        }
    }
}

@Test("subagent permission response binds to the calling child and preserves authority checks")
func hookThreadRoutingKeepsPermissionResponseBoundToChild() throws {
    let nativeInput = threadRoutingInput(agentID: "child_one")
    let routed = try HookThreadRoutingPolicy.routedPayload(eventName: "PermissionRequest", input: nativeInput)
    let qualified = HookPermissionOutputPolicy.qualifiedPayload(
        routed, qualification: HookPermissionPolicy.qualifiedRuntime
    )
    for decision in ["allow_once", "deny", "defer_to_codex"] {
        var response: [String: Any] = [
            "decision": decision, "delivery_token": "delivery_exact_child",
            "request_id": "request_child", "session_id": "child_one", "turn_id": "turn_exact",
        ]
        if decision == "allow_once" {
            response["command_preview"] = (nativeInput["tool_input"] as? [String: Any])?["command"]
            response["cwd"] = nativeInput["cwd"]
            response[HookPermissionPolicy.qualificationKey] = HookPermissionPolicy.qualifiedRuntime
        }
        #expect(HookPermissionOutputPolicy.acceptsResponse(
            response, input: qualified, currentQualification: HookPermissionPolicy.qualifiedRuntime
        ))
        for wrongThread in ["root_session", "child_two"] {
            var wrongResponse = response
            wrongResponse["session_id"] = wrongThread
            #expect(!HookPermissionOutputPolicy.acceptsResponse(
                wrongResponse, input: qualified, currentQualification: HookPermissionPolicy.qualifiedRuntime
            ))
        }
        if decision == "allow_once" {
            #expect(!HookPermissionOutputPolicy.acceptsResponse(
                response, input: qualified, currentQualification: nil
            ))
            let unqualified = HookPermissionOutputPolicy.qualifiedPayload(routed, qualification: nil)
            #expect(!HookPermissionOutputPolicy.acceptsResponse(
                response, input: unqualified, currentQualification: HookPermissionPolicy.qualifiedRuntime
            ))
            for key in ["turn_id", "command_preview", "cwd"] {
                var wrongResponse = response
                wrongResponse[key] = "different"
                #expect(!HookPermissionOutputPolicy.acceptsResponse(
                    wrongResponse, input: qualified, currentQualification: HookPermissionPolicy.qualifiedRuntime
                ))
            }
        }
    }
}

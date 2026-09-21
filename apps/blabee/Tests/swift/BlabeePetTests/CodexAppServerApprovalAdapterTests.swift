import Foundation
import Testing
@testable import BlabeeCoordinator

private struct AppServerAdapterUnexpectedDecider: ManagedCodexApprovalDeciding {
    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        .allowOnce
    }
}

@Test("App Server adapter strictly parses basic command approval requests")
func codexAppServerApprovalAdapterParsesCommandRequest() throws {
    var object = appServerApprovalObjectFixture(
        id: "request-1",
        approvalID: "approval-1",
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        reason: "The command needs write access."
    )
    var params = try #require(object["params"] as? [String: Any])
    params["additionalPermissions"] = NSNull()
    params["commandActions"] = [["command": "swift test", "type": "unknown"]]
    params["environmentId"] = "local"
    params["networkApprovalContext"] = NSNull()
    params["proposedExecpolicyAmendment"] = []
    params["proposedNetworkPolicyAmendments"] = NSNull()
    object["params"] = params
    object["trace"] = ["traceparent": "00-abc-def-01", "tracestate": NSNull()]
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])

    let request = try CodexAppServerApprovalAdapter.parse(data)
    #expect(request.requestID == .string("request-1"))
    #expect(request.jsonRPCVersion == nil)
    #expect(request.threadID == "thread-1")
    #expect(request.turnID == "turn-1")
    #expect(request.itemID == "item-1")
    #expect(request.approvalID == "approval-1")
    #expect(request.startedAtMilliseconds == 1_762_000_000_000)
    #expect(request.environmentID == "local")
    #expect(request.command == "swift test")
    #expect(request.cwd == "/tmp/blabee-adapter")
    #expect(request.reason == "The command needs write access.")
    #expect(request.availableDecisions == [
        .accept, .acceptForSession, .decline, .cancel,
    ])
    #expect(request.forwardingData == data)
}

@Test("App Server adapter accepts bounded official command action metadata")
func codexAppServerApprovalAdapterAcceptsOfficialCommandActions() throws {
    var object = appServerApprovalObjectFixture(id: "actions")
    var params = try #require(object["params"] as? [String: Any])
    params["commandActions"] = [
        [
            "type": "read", "command": "cat Package.swift",
            "name": "Package.swift", "path": "/tmp/blabee-adapter/Package.swift",
        ],
        ["type": "listFiles", "command": "ls", "path": NSNull()],
        ["type": "search", "command": "rg TODO", "path": ".", "query": "TODO"],
        ["type": "unknown", "command": "swift test"],
    ]
    object["params"] = params

    let request = try CodexAppServerApprovalAdapter.parse(
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    )
    #expect(request.environmentID == "local")

    params["environmentId"] = NSNull()
    object["params"] = params
    let localDefault = try CodexAppServerApprovalAdapter.parse(
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    )
    #expect(localDefault.environmentID == nil)
}

@Test("App Server adapter accepts the 0.149.1 wire shape with optional null fields omitted")
func codexAppServerApprovalAdapterAcceptsOmittedOptionalFields() throws {
    let object: [String: Any] = [
        "id": 17,
        "method": CodexAppServerApprovalAdapter.commandApprovalMethod,
        "params": [
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "item-1",
            "startedAtMs": Int64(1_762_000_000_000),
            "environmentId": "local",
            "command": "swift test",
            "cwd": "/tmp/blabee-adapter",
            "commandActions": [["type": "unknown", "command": "swift test"]],
            "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"],
        ],
    ]
    let request = try CodexAppServerApprovalAdapter.parse(
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    )
    #expect(request.environmentID == "local")
    #expect(request.approvalID == nil)
    #expect(request.reason == nil)
}

@Test("App Server adapter accepts 0.150.1 command approvals with an explicit kind")
func codexAppServerApprovalAdapterAcceptsCommandKind() throws {
    var object = appServerApprovalObjectFixture(id: "command-kind")
    var params = try #require(object["params"] as? [String: Any])
    params["kind"] = "command"
    object["params"] = params

    let request = try CodexAppServerApprovalAdapter.parse(
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    )

    #expect(request.requestID == .string("command-kind"))
    #expect(request.command == "swift test")
}

@Test("Managed router leaves write-stdin approval with Codex byte-exactly")
func codexAppServerApprovalRouterForwardsWriteStdinKind() throws {
    var object = appServerApprovalObjectFixture(id: "write-stdin-kind")
    var params = try #require(object["params"] as? [String: Any])
    params["kind"] = "writeStdin"
    object["params"] = params
    let original = try JSONSerialization.data(
        withJSONObject: object,
        options: [.prettyPrinted, .withoutEscapingSlashes]
    )
    let router = ManagedCodexApprovalRouter(decider: AppServerAdapterUnexpectedDecider())
    let context = ManagedCodexConnectionContext(
        brokerEpoch: "epoch-write-stdin",
        connectionID: "connection-write-stdin"
    )

    #expect(router.route(appServerMessage: original, context: context) == .codex(original))
}

@Test("App Server adapter maps one-time allow to accept and preserves request id")
func codexAppServerApprovalAdapterMapsAllowOnce() throws {
    let request = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: Int64.max,
        jsonRPCVersion: "2.0",
        availableDecisions: ["accept", "acceptForSession", "decline"]
    ))

    let outcome = try CodexAppServerApprovalAdapter.resolve(.allowOnce, for: request)
    guard case .respond(let response) = outcome else {
        Issue.record("allow once must synthesize an App Server response")
        return
    }
    #expect(response.requestID == .integer(Int64.max))
    #expect(response.decision == .accept)

    let object = try appServerApprovalObject(response.encodedData())
    #expect((object["id"] as? NSNumber)?.int64Value == Int64.max)
    #expect(object["jsonrpc"] as? String == "2.0")
    let result = try #require(object["result"] as? [String: Any])
    #expect(result["decision"] as? String == "accept")
    #expect(String(data: try response.encodedData(), encoding: .utf8)?.contains(
        "acceptForSession"
    ) == false)
}

@Test("App Server adapter maps deny to decline without adding JSON-RPC metadata")
func codexAppServerApprovalAdapterMapsDeny() throws {
    let request = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: "deny-id",
        jsonRPCVersion: nil,
        availableDecisions: ["decline"]
    ))

    let outcome = try CodexAppServerApprovalAdapter.resolve(.deny, for: request)
    guard case .respond(let response) = outcome else {
        Issue.record("deny must synthesize an App Server response")
        return
    }
    let object = try appServerApprovalObject(response.encodedData())
    #expect(object["id"] as? String == "deny-id")
    #expect(object["jsonrpc"] == nil)
    let result = try #require(object["result"] as? [String: Any])
    #expect(result["decision"] as? String == "decline")
}

@Test("App Server adapter safely narrows 0.149.1 exec-policy choices")
func codexAppServerApprovalAdapterNarrowsExecpolicyChoices() throws {
    let amendment = ["/bin/mkdir", "/Users/example/Library/Caches/blabee-qa"]
    var object = appServerApprovalObjectFixture(
        id: "execpolicy-id",
        availableDecisions: []
    )
    var params = try #require(object["params"] as? [String: Any])
    params["proposedExecpolicyAmendment"] = amendment
    params["availableDecisions"] = [
        "accept",
        [
            "acceptWithExecpolicyAmendment": [
                "execpolicy_amendment": amendment,
            ],
        ],
        "cancel",
    ]
    object["params"] = params
    let original = try JSONSerialization.data(
        withJSONObject: object,
        options: [.prettyPrinted, .withoutEscapingSlashes]
    )
    let request = try CodexAppServerApprovalAdapter.parse(original)
    #expect(request.availableDecisions == [
        .accept, .acceptWithExecpolicyAmendment, .cancel,
    ])

    let allow = try CodexAppServerApprovalAdapter.resolve(.allowOnce, for: request)
    guard case .respond(let allowResponse) = allow else {
        Issue.record("one-time allow must not forward the persistent amendment")
        return
    }
    #expect(allowResponse.decision == .accept)
    let allowObject = try appServerApprovalObject(allowResponse.encodedData())
    let allowResult = try #require(allowObject["result"] as? [String: Any])
    #expect(allowResult["decision"] as? String == "accept")

    let deny = try CodexAppServerApprovalAdapter.resolve(.deny, for: request)
    guard case .respond(let denyResponse) = deny else {
        Issue.record("reject must use the available non-persistent cancel decision")
        return
    }
    #expect(denyResponse.decision == .cancel)

    #expect(
        try CodexAppServerApprovalAdapter.resolve(.decideInCodex, for: request)
            == .forwardToCodex(requestData: original)
    )
}

@Test("App Server adapter forwards the exact request when Codex must decide")
func codexAppServerApprovalAdapterForwardsToCodex() throws {
    var object = appServerApprovalObjectFixture(
        id: "direct-id",
        availableDecisions: ["acceptForSession", "cancel"]
    )
    object["jsonrpc"] = "2.0"
    let original = try JSONSerialization.data(
        withJSONObject: object,
        options: [.prettyPrinted, .withoutEscapingSlashes]
    )
    let request = try CodexAppServerApprovalAdapter.parse(original)

    let outcome = try CodexAppServerApprovalAdapter.resolve(.decideInCodex, for: request)
    #expect(outcome == .forwardToCodex(requestData: original))
}

@Test("App Server adapter gates synthetic decisions on server availability")
func codexAppServerApprovalAdapterChecksAvailableDecisions() throws {
    let declineOnly = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: 11,
        availableDecisions: ["decline"]
    ))
    #expect(throws: CodexAppServerApprovalAdapterError.unavailableDecision("accept")) {
        _ = try CodexAppServerApprovalAdapter.resolve(.allowOnce, for: declineOnly)
    }

    let acceptOnly = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: 12,
        availableDecisions: ["accept", "acceptForSession"]
    ))
    #expect(throws: CodexAppServerApprovalAdapterError.unavailableDecision(
        "decline_or_cancel"
    )) {
        _ = try CodexAppServerApprovalAdapter.resolve(.deny, for: acceptOnly)
    }

    let persistentOnly = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: 13,
        availableDecisions: ["acceptForSession", "cancel"]
    ))
    #expect(throws: CodexAppServerApprovalAdapterError.unavailableDecision("accept")) {
        _ = try CodexAppServerApprovalAdapter.resolve(.allowOnce, for: persistentOnly)
    }
}

@Test("App Server adapter rejects unsupported and malformed approval messages")
func codexAppServerApprovalAdapterRejectsUnsupportedMessages() throws {
    let fileApproval = try appServerApprovalData(
        id: "file",
        method: "item/fileChange/requestApproval"
    )
    #expect(throws: CodexAppServerApprovalAdapterError.unsupportedMethod) {
        _ = try CodexAppServerApprovalAdapter.parse(fileApproval)
    }

    for mutation in [
        { (object: inout [String: Any]) in object["id"] = true },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["command"] = NSNull()
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["command"] = String(repeating: "a", count: 121)
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["command"] = "printf first\nprintf second"
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["cwd"] = "relative/path"
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["kind"] = "future-kind"
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["additionalPermissions"] = ["network": ["enabled": true]]
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["networkApprovalContext"] = ["host": "example.com", "protocol": "https"]
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["proposedExecpolicyAmendment"] = [7]
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["proposedNetworkPolicyAmendments"] = [[
                "action": "allow", "host": "example.com",
            ]]
            object["params"] = params
        },
        { (object: inout [String: Any]) in
            var params = object["params"] as! [String: Any]
            params["availableDecisions"] = [[
                "acceptWithExecpolicyAmendment": ["execpolicy_amendment": []],
            ]]
            object["params"] = params
        },
    ] {
        var object = appServerApprovalObjectFixture(id: "malformed")
        mutation(&object)
        let data = try JSONSerialization.data(withJSONObject: object)
        #expect(throws: (any Error).self) {
            _ = try CodexAppServerApprovalAdapter.parse(data)
        }
    }
}

@Test("Managed router preserves exact bytes for hidden permission and policy requests")
func codexAppServerApprovalRouterForwardsHiddenAuthorityToCodex() throws {
    let mutations: [(inout [String: Any]) -> Void] = [
        { $0["additionalPermissions"] = ["network": ["enabled": true]] },
        { $0["networkApprovalContext"] = ["host": "example.com", "protocol": "https"] },
        { $0["proposedNetworkPolicyAmendments"] = [[
            "action": "allow", "host": "example.com",
        ]] },
    ]
    let router = ManagedCodexApprovalRouter(decider: AppServerAdapterUnexpectedDecider())
    let context = ManagedCodexConnectionContext(
        brokerEpoch: "epoch-hidden-authority",
        connectionID: "connection-hidden-authority"
    )
    for mutation in mutations {
        var object = appServerApprovalObjectFixture(id: "hidden-authority")
        var params = try #require(object["params"] as? [String: Any])
        mutation(&params)
        object["params"] = params
        let original = try JSONSerialization.data(
            withJSONObject: object,
            options: [.prettyPrinted, .withoutEscapingSlashes]
        )
        #expect(router.route(appServerMessage: original, context: context) == .codex(original))
    }
}

@Test("App Server adapter rejects duplicate and display-spoofing input")
func codexAppServerApprovalAdapterRejectsHostileInput() throws {
    let duplicateKey = Data(#"{"id":"first","id":"second","method":"item/commandExecution/requestApproval","params":{"itemId":"item-1","startedAtMs":1,"threadId":"thread-1","turnId":"turn-1","command":"echo ok","cwd":"/tmp","availableDecisions":["accept","decline"]}}"#.utf8)
    #expect(throws: (any Error).self) {
        _ = try CodexAppServerApprovalAdapter.parse(duplicateKey)
    }

    for decisions in [
        ["accept", "accept"],
        ["accept", "surprise"],
    ] {
        let data = try appServerApprovalData(id: "decisions", availableDecisions: decisions)
        #expect(throws: (any Error).self) {
            _ = try CodexAppServerApprovalAdapter.parse(data)
        }
    }

    var nonNFCIdentifier = appServerApprovalObjectFixture(id: "identifier")
    var nonNFCParams = try #require(nonNFCIdentifier["params"] as? [String: Any])
    nonNFCParams["threadId"] = "thread-e\u{301}"
    nonNFCIdentifier["params"] = nonNFCParams
    let nonNFCData = try JSONSerialization.data(withJSONObject: nonNFCIdentifier)
    #expect(throws: (any Error).self) {
        _ = try CodexAppServerApprovalAdapter.parse(nonNFCData)
    }

    for environmentID: Any in [
        "", String(repeating: "e", count: 513), "remote-e\u{301}", 7,
    ] {
        var object = appServerApprovalObjectFixture(id: "environment")
        var params = try #require(object["params"] as? [String: Any])
        params["environmentId"] = environmentID
        object["params"] = params
        let data = try JSONSerialization.data(withJSONObject: object)
        #expect(throws: (any Error).self) {
            _ = try CodexAppServerApprovalAdapter.parse(data)
        }
    }

    var missingEnvironment = appServerApprovalObjectFixture(id: "missing-environment")
    var missingEnvironmentParams = try #require(
        missingEnvironment["params"] as? [String: Any]
    )
    missingEnvironmentParams.removeValue(forKey: "environmentId")
    missingEnvironment["params"] = missingEnvironmentParams
    #expect(throws: (any Error).self) {
        _ = try CodexAppServerApprovalAdapter.parse(
            try JSONSerialization.data(withJSONObject: missingEnvironment)
        )
    }

    let hostileActions: [[Any]] = [
        [["type": "execute", "command": "swift test"]],
        [["type": "unknown", "command": "swift test", "hidden": true]],
        [["type": "read", "command": "cat file", "path": "/tmp/file"]],
        [["type": "listFiles", "command": "ls"]],
        [["type": "search", "command": "rg x", "path": "."]],
        [["type": "search", "command": "rg x", "query": "x\u{202e}txt"]],
        Array(repeating: ["type": "unknown", "command": "true"], count: 33),
    ]
    for actions in hostileActions {
        var object = appServerApprovalObjectFixture(id: "actions")
        var params = try #require(object["params"] as? [String: Any])
        params["commandActions"] = actions
        object["params"] = params
        let data = try JSONSerialization.data(withJSONObject: object)
        #expect(throws: (any Error).self) {
            _ = try CodexAppServerApprovalAdapter.parse(data)
        }
    }

    for command in [
        "printf safe\u{202e}txt",
        "printf zero\u{200b}width",
        "printf split\u{2028}line",
    ] {
        let spoofedCommand = try appServerApprovalData(id: "spoofed", command: command)
        #expect(throws: (any Error).self) {
            _ = try CodexAppServerApprovalAdapter.parse(spoofedCommand)
        }
    }
}

@Test("App Server adapter correlation distinguishes approval callbacks statelessly")
func codexAppServerApprovalAdapterCorrelation() throws {
    let first = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: 21,
        approvalID: "callback-a"
    ))
    let repeated = try CodexAppServerApprovalAdapter.parse(first.forwardingData)
    let second = try CodexAppServerApprovalAdapter.parse(try appServerApprovalData(
        id: 22,
        approvalID: "callback-b"
    ))

    #expect(first.correlation == repeated.correlation)
    #expect(first.correlation != second.correlation)
    #expect(first.itemID == second.itemID)
}

private func appServerApprovalData(
    id: Any,
    method: String = CodexAppServerApprovalAdapter.commandApprovalMethod,
    jsonRPCVersion: String? = nil,
    approvalID: String? = nil,
    availableDecisions: [String] = ["accept", "decline"],
    command: String = "swift test",
    reason: String? = nil,
    trace: [String: Any]? = nil
) throws -> Data {
    var object = appServerApprovalObjectFixture(
        id: id,
        method: method,
        approvalID: approvalID,
        availableDecisions: availableDecisions,
        command: command,
        reason: reason
    )
    if let jsonRPCVersion { object["jsonrpc"] = jsonRPCVersion }
    if let trace { object["trace"] = trace }
    return try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
}

private func appServerApprovalObjectFixture(
    id: Any,
    method: String = CodexAppServerApprovalAdapter.commandApprovalMethod,
    approvalID: String? = nil,
    availableDecisions: [String] = ["accept", "decline"],
    command: String = "swift test",
    reason: String? = nil
) -> [String: Any] {
    [
        "id": id,
        "method": method,
        "params": [
            "additionalPermissions": NSNull(),
            "approvalId": approvalID ?? NSNull(),
            "availableDecisions": availableDecisions,
            "command": command,
            "commandActions": [["command": command, "type": "unknown"]],
            "cwd": "/tmp/blabee-adapter",
            "environmentId": "local",
            "itemId": "item-1",
            "networkApprovalContext": NSNull(),
            "proposedExecpolicyAmendment": NSNull(),
            "proposedNetworkPolicyAmendments": NSNull(),
            "reason": reason ?? NSNull(),
            "startedAtMs": Int64(1_762_000_000_000),
            "threadId": "thread-1",
            "turnId": "turn-1",
        ],
    ]
}

private func appServerApprovalObject(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CodexAppServerApprovalAdapterError.invalid("test.response")
    }
    return object
}

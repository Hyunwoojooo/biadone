import Foundation
import Testing
@testable import BlabeeCoordinator

private func petNativeSubagentSnapshotObject(
    cwdSuffix: String = "",
    deliveryPending: Bool = false
) throws -> [String: Any] {
    var object = petTestSnapshotObject(
        cards: [],
        permissionRequests: [PetTestPermissionRequest(
            suffix: "native_subagent",
            allowOnceAvailable: true,
            deliveryPending: deliveryPending
        )]
    )
    object["sessions"] = [[String: Any]]()
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    requests[0]["binding_source"] = "native_subagent"
    requests[0]["cwd"] = "/tmp/blabee-pet-native_subagent" + cwdSuffix
    object["permission_requests"] = requests
    return object
}

@Test("BlabeePet accepts qualified native child requests without synthesizing a session",
      arguments: ["", "/nested/work", "/nested/../work/."])
func blabeePetNativeSubagentPermissionParsing(cwdSuffix: String) throws {
    let object = try petNativeSubagentSnapshotObject(cwdSuffix: cwdSuffix)
    let snapshot = try PetSnapshot.parse(petTestData(object))
    let request = try #require(snapshot.permissionRequests.first)
    #expect(request.isNativeSubagent)
    #expect(request.allowOnceAvailable)
    #expect(snapshot.sessions.isEmpty)
    #expect(snapshot.interactions.isEmpty)
    let callerCWD = "/tmp/blabee-pet-native_subagent" + cwdSuffix
    #expect(request.cwd.utf8.elementsEqual(callerCWD.utf8))
    let resolution = try PetPermissionResolutionRequest(
        request: request,
        responseID: "native_child_response",
        decision: .allowOnce
    )
    #expect(resolution.jsonObject["session_id"] as? String == request.sessionID)
    #expect(resolution.jsonObject["turn_id"] as? String == request.turnID)
}

@Test("BlabeePet rejects invalid native child markers and unqualified requests",
      arguments: [false, true])
func blabeePetNativeSubagentPermissionRejectsInvalidMarkers(deliveryPending: Bool) throws {
    let invalidMarkers: [Any] = [NSNull(), false, 1, "", "prompt", "NATIVE_SUBAGENT", [], [:]]
    for marker in invalidMarkers {
        var object = try petNativeSubagentSnapshotObject(deliveryPending: deliveryPending)
        var requests = try #require(object["permission_requests"] as? [[String: Any]])
        requests[0]["binding_source"] = marker
        object["permission_requests"] = requests
        #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
    }

    var object = try petNativeSubagentSnapshotObject(deliveryPending: deliveryPending)
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    requests[0]["allow_once_available"] = false
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }

    requests[0]["allow_once_available"] = true
    requests[0]["unexpected"] = true
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}

@Test("BlabeePet preserves native child delivery binding without reopening selection",
      arguments: ["session_registered", "project_disabled", "nested_registered", "nested_disabled"])
@MainActor
func blabeePetNativeSubagentPermissionKeepsDeliveryPendingBinding(change: String) async throws {
    var object = try petNativeSubagentSnapshotObject(
        cwdSuffix: "/nested/work/.", deliveryPending: true
    )
    let originalSnapshot = try PetSnapshot.parse(petTestData(object))
    let original = try #require(originalSnapshot.permissionRequests.first)
    var projects = try #require(object["projects"] as? [[String: Any]])
    switch change {
    case "session_registered":
        object["sessions"] = [[
            "project_id": "project_native_subagent",
            "session_id": "session_native_subagent",
            "source_turn_id": "turn_new_prompt",
            "source_prompt_id": "prompt_new",
            "episode_id": "episode_new",
        ]]
    case "project_disabled":
        projects[0]["enabled"] = false
    default:
        projects.append([
            "project_id": "nested_project",
            "cwd": "/tmp/blabee-pet-native_subagent/nested",
            "enabled": change == "nested_registered",
        ])
    }
    object["projects"] = projects

    let transport = PetFakeTransport()
    let viewModel = PetViewModel(
        transport: transport,
        externalApplicationOpener: PetFakeApplicationOpener(),
        processIdentifier: 999
    )
    defer { viewModel.stopPolling() }
    try viewModel.receiveSnapshotDataForTesting(petTestData(object))
    let request = try #require(viewModel.pendingPermissionRequest)
    #expect(request == original)
    #expect(request.deliveryPending)
    #expect(!viewModel.canActOnDisplayedEvent)
    for decision in PetPermissionDecision.allCases {
        await viewModel.resolvePermissionRequest(decision, for: request)
    }
    #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
    #expect(viewModel.pendingPermissionRequest == original)
}

@Test("BlabeePet rejects foreign native child delivery bindings",
      arguments: ["foreign_cwd", "sibling_prefix", "unknown_project"])
func blabeePetNativeSubagentPermissionRejectsForeignDeliveryBinding(change: String) throws {
    var object = try petNativeSubagentSnapshotObject(deliveryPending: true)
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    switch change {
    case "foreign_cwd":
        requests[0]["cwd"] = "/tmp/foreign-project"
    case "sibling_prefix":
        requests[0]["cwd"] = "/tmp/blabee-pet-native_subagent-sibling"
    default:
        requests[0]["project_id"] = "unknown_project"
    }
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}

@Test("BlabeePet rejects native child requests outside the enabled project boundary")
func blabeePetNativeSubagentPermissionRejectsInvalidProjects() throws {
    for cwd in ["/tmp/foreign-project", "/tmp/blabee-pet-native_subagent-sibling",
                "/tmp/blabee-pet-native_subagent/../foreign-project"] {
        var object = try petNativeSubagentSnapshotObject()
        var requests = try #require(object["permission_requests"] as? [[String: Any]])
        requests[0]["cwd"] = cwd
        object["permission_requests"] = requests
        #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
    }

    var object = try petNativeSubagentSnapshotObject()
    var projects = try #require(object["projects"] as? [[String: Any]])
    projects[0]["enabled"] = false
    object["projects"] = projects
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }

    projects[0]["enabled"] = true
    projects.append([
        "project_id": "foreign_project", "cwd": "/tmp/foreign-project", "enabled": true,
    ])
    object["projects"] = projects
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    requests[0]["project_id"] = "foreign_project"
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}

@Test("BlabeePet binds native child requests to the most specific configured project",
      arguments: [false, true])
func blabeePetNativeSubagentPermissionUsesMostSpecificProject(nestedEnabled: Bool) throws {
    var object = try petNativeSubagentSnapshotObject(cwdSuffix: "/nested/work")
    var projects = try #require(object["projects"] as? [[String: Any]])
    projects.append([
        "project_id": "nested_project",
        "cwd": "/tmp/blabee-pet-native_subagent/nested",
        "enabled": nestedEnabled,
    ])
    object["projects"] = projects
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }

    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    requests[0]["project_id"] = "nested_project"
    object["permission_requests"] = requests
    if nestedEnabled {
        let snapshot = try PetSnapshot.parse(petTestData(object))
        #expect(snapshot.permissionRequests.first?.projectID == "nested_project")
    } else {
        #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
    }
}

@Test("BlabeePet rejects native child requests colliding with any registered session",
      arguments: [false, true])
func blabeePetNativeSubagentPermissionRejectsSessionCollision(otherProject: Bool) throws {
    var object = try petNativeSubagentSnapshotObject()
    var projects = try #require(object["projects"] as? [[String: Any]])
    projects.append([
        "project_id": "foreign_project", "cwd": "/tmp/foreign-project", "enabled": true,
    ])
    object["projects"] = projects
    object["sessions"] = [[
        "project_id": otherProject ? "foreign_project" : "project_native_subagent",
        "session_id": "session_native_subagent",
        "source_turn_id": "turn_native_subagent",
        "source_prompt_id": "prompt_native_subagent",
        "episode_id": "episode_native_subagent",
    ]]
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}

@Test("BlabeePet keeps unmarked permission requests bound to an exact session and cwd")
func blabeePetNativeSubagentPermissionPreservesLegacyBinding() throws {
    var object = petTestSnapshotObject(
        cards: [],
        permissionRequests: [PetTestPermissionRequest(
            suffix: "native_subagent", allowOnceAvailable: true
        )]
    )
    let snapshot = try PetSnapshot.parse(petTestData(object))
    #expect(snapshot.permissionRequests.first?.isNativeSubagent == false)

    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    requests[0]["cwd"] = "/tmp/blabee-pet-native_subagent/nested"
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }

    requests[0]["cwd"] = "/tmp/blabee-pet-native_subagent"
    object["permission_requests"] = requests
    object["sessions"] = [[String: Any]]()
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}

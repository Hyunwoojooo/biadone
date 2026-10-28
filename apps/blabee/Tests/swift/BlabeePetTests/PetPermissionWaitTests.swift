import Foundation
import Testing
@testable import BlabeeCoordinator

private func petPermissionWaitSnapshotObject(
    nativeSubagent: Bool = false,
    remaining: Any? = nil,
    deliveryPending: Bool = false
) throws -> [String: Any] {
    var object = petTestSnapshotObject(
        cards: [],
        permissionRequests: [PetTestPermissionRequest(
            suffix: "wait",
            allowOnceAvailable: true,
            deliveryPending: deliveryPending
        )]
    )
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    if nativeSubagent {
        requests[0]["binding_source"] = "native_subagent"
        object["sessions"] = [[String: Any]]()
    }
    if let remaining { requests[0]["remaining_milliseconds"] = remaining }
    object["permission_requests"] = requests
    return object
}

@Test("BlabeePet accepts optional approval time independently of native child binding", .petLanguage(.korean),
      arguments: [false, true])
func blabeePetPermissionWaitOptionalParsing(nativeSubagent: Bool) throws {
    let oldObject = try petPermissionWaitSnapshotObject(nativeSubagent: nativeSubagent)
    let oldSnapshot = try PetSnapshot.parse(petTestData(oldObject))
    let oldRequest = try #require(oldSnapshot.permissionRequests.first)
    #expect(oldRequest.remainingMilliseconds == nil)
    #expect(oldRequest.approvalWaitMessage == nil)
    #expect(oldRequest.isNativeSubagent == nativeSubagent)

    let remainingValues: [Int64] = [0, 1, 1_000, 299_000, 300_000]
    for remaining in remainingValues {
        let object = try petPermissionWaitSnapshotObject(
            nativeSubagent: nativeSubagent, remaining: remaining
        )
        let snapshot = try PetSnapshot.parse(petTestData(object))
        let request = try #require(snapshot.permissionRequests.first)
        #expect(request.remainingMilliseconds == remaining)
        #expect(request.isNativeSubagent == nativeSubagent)
    }
}

@Test("BlabeePet rejects malformed approval time and keeps exact optional keys", .petLanguage(.korean),
      arguments: [false, true])
func blabeePetPermissionWaitRejectsInvalidValues(nativeSubagent: Bool) throws {
    let invalidValues: [Any] = [true, false, -1, 300_001, 1.5, "1000", NSNull(), [], [:]]
    for remaining in invalidValues {
        let object = try petPermissionWaitSnapshotObject(
            nativeSubagent: nativeSubagent, remaining: remaining
        )
        #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
    }
    var object = try petPermissionWaitSnapshotObject(
        nativeSubagent: nativeSubagent, remaining: 300_000
    )
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    requests[0]["unexpected"] = true
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }

    requests[0].removeValue(forKey: "unexpected")
    let invalidMarkers: [Any] = [NSNull(), "other"]
    for marker in invalidMarkers {
        requests[0]["binding_source"] = marker
        object["permission_requests"] = requests
        #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
    }
}

@Test("BlabeePet approval time rounds up to a compact remaining duration", .petLanguage(.korean),
      arguments: [300_000, 299_000, 1_000, 1, 0])
func blabeePetPermissionWaitMessageBoundaries(remaining: Int) throws {
    let object = try petPermissionWaitSnapshotObject(remaining: remaining)
    let snapshot = try PetSnapshot.parse(petTestData(object))
    let request = try #require(snapshot.permissionRequests.first)
    let duration: String
    switch remaining {
    case 300_000: duration = "5:00"
    case 299_000: duration = "4:59"
    case 0: duration = "0:00"
    default: duration = "0:01"
    }
    #expect(request.approvalWaitMessage == "남은 시간 \(duration) · 시간이 지나면 Codex에서 직접 선택")
}

@Test("BlabeePet hides approval time after a selection is awaiting delivery", .petLanguage(.korean),
      arguments: [false, true])
func blabeePetPermissionWaitHidesDuringDelivery(nativeSubagent: Bool) throws {
    let object = try petPermissionWaitSnapshotObject(
        nativeSubagent: nativeSubagent, remaining: 299_000, deliveryPending: true
    )
    let snapshot = try PetSnapshot.parse(petTestData(object))
    let request = try #require(snapshot.permissionRequests.first)
    #expect(request.remainingMilliseconds == 299_000)
    #expect(request.approvalWaitMessage == nil)
}

@Test("BlabeePet updates approval time without invalidating the displayed selection", .petLanguage(.korean))
@MainActor
func blabeePetPermissionWaitRefreshPreservesSelection() async throws {
    let before = try PetSnapshot.parse(petTestData(petPermissionWaitSnapshotObject(remaining: 300_000)))
    let after = try PetSnapshot.parse(petTestData(petPermissionWaitSnapshotObject(remaining: 299_000)))
    let beforeRequest = try #require(before.permissionRequests.first)
    let afterRequest = try #require(after.permissionRequests.first)
    #expect(before != after)
    #expect(beforeRequest == afterRequest)
    #expect(PetApprovalHead.permission(beforeRequest) == .permission(afterRequest))

    let delivering = try PetSnapshot.parse(petTestData(petPermissionWaitSnapshotObject(
        remaining: 299_000, deliveryPending: true
    )))
    #expect(delivering.permissionRequests.first != beforeRequest)

    let transport = PetFakeTransport()
    let viewModel = PetViewModel(
        transport: transport,
        externalApplicationOpener: PetFakeApplicationOpener(),
        processIdentifier: 999,
        permissionResponseIDGenerator: { "permission_response_test" }
    )
    defer { viewModel.stopPolling() }
    viewModel.applySnapshotForTesting(before)
    viewModel.applySnapshotForTesting(after)
    #expect(viewModel.pendingPermissionRequest?.remainingMilliseconds == 299_000)
    await transport.enqueue(
        type: "resolve_permission_request",
        response: try petTestPermissionResolutionResponse(.allowOnce, requestID: beforeRequest.requestID)
    )
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.resolvePermissionRequest(.allowOnce, for: beforeRequest)
    #expect(await transport.requestCount(type: "resolve_permission_request") == 1)
}

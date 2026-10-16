import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Pet product access")
@MainActor
struct PetAccessControllerTests {
    @Test("Only a verified access token crosses the raw owner-authenticated contract")
    func sendsVerifiedCredential() async throws {
        let f = PetAccessTestFixture()
        f.controller.receiveVerifiedCredential(f.credential)
        #expect(f.controller.state == .checking)
        #expect(f.controller.pollInterval == 1)
        #expect(!f.controller.allowsActions)
        await f.controller.synchronize()
        await f.controller.synchronize()

        let requests = await f.transport.requests
        #expect(requests.map(\.type) == ["product_access_v1", "product_access_v1"])
        let handshake = try petTestObject(requests[0].payload)
        #expect(handshake["operation"] as? String == "status")
        #expect((handshake["payload"] as? [String: Any])?.isEmpty == true)
        let update = try petTestObject(requests[1].payload)
        #expect(Set(update.keys) == ["schema_version", "request_id", "auth_token", "operation", "revision", "payload"])
        #expect(update["schema_version"] as? Int == 1)
        #expect(update["auth_token"] as? String == f.owner.value?.credential)
        #expect(update["operation"] as? String == "update")
        #expect((update["revision"] as? Int ?? 0) >= 1)
        #expect(UUID(uuidString: update["request_id"] as? String ?? "") != nil)
        let payload = try #require(update["payload"] as? [String: Any])
        #expect(Set(payload.keys) == ["user_id", "access_token"])
        #expect(payload["user_id"] as? String == f.credential.userID.uuidString.lowercased())
        #expect(payload["access_token"] as? String == f.credential.accessToken)
        #expect(!String(decoding: requests[1].payload, as: UTF8.self).contains("refresh_token"))
        #expect(f.controller.state == .checking)

        await f.transport.setState(.active, userID: f.credential.userID, remaining: 120)
        await f.controller.synchronize()
        #expect(f.controller.allowsActions)
        #expect(f.controller.pollInterval == 5)
        #expect(f.controller.remainingSeconds == 120)
    }

    @Test("Local monotonic expiry locks actions even before the next status reply")
    func expiresLocally() async {
        let f = PetAccessTestFixture()
        await f.activate(remaining: 2)
        f.owner.nanoseconds += 2_000_000_000
        #expect(f.controller.effectiveState == .expired)
        #expect(f.controller.remainingSeconds == 0)
        #expect(!f.controller.allowsActions)
    }

    @Test("Every denied service state locks an existing grant", arguments: [
        PetAccessState.signedOut, .checking, .suspended, .servicePaused,
        .socialLoginRequired, .unavailable, .expired,
    ])
    func deniedStateLocks(_ state: PetAccessState) async {
        let f = PetAccessTestFixture()
        await f.activate()
        await f.transport.setState(state, userID: f.credential.userID)
        await f.controller.synchronize()
        #expect(f.controller.state == state)
        #expect(!f.controller.allowsActions)
    }

    @Test("Same-user token rotation retains an unexpired grant while the service checks")
    func sameUserRefreshRetainsGrant() async throws {
        let f = PetAccessTestFixture()
        await f.activate()
        let generation = f.controller.actionGeneration
        f.controller.receiveVerifiedCredential(.init(userID: f.credential.userID,
            accessToken: "rotated-test-access", expiresAt: f.credential.expiresAt))
        #expect(f.controller.allowsActions)
        #expect(f.controller.actionGeneration == generation)
        await f.controller.synchronize()
        #expect(f.controller.allowsActions)
        let latest = try #require(await f.transport.requests.last)
        let object = try petTestObject(latest.payload)
        let fields = try #require(object["payload"] as? [String: Any])
        #expect(fields["access_token"] as? String == "rotated-test-access")
    }

    @Test("Logout locks immediately and a delayed active update cannot undo the clear")
    func logoutFencesUpdate() async throws {
        let f = PetAccessTestFixture()
        await f.activate()
        f.controller.receiveVerifiedCredential(.init(userID: f.credential.userID,
            accessToken: "rotated-test-access", expiresAt: f.credential.expiresAt))
        let gate = PetAccessTestGate()
        await f.transport.pauseNextResponse(gate)
        let update = Task { await f.controller.synchronize() }
        await gate.waitUntilEntered()
        let updateRevision = f.controller.revision

        f.controller.invalidateCredential()
        #expect(f.controller.state == .signedOut)
        #expect(!f.controller.allowsActions)
        #expect(f.controller.revision > updateRevision)
        await gate.release()
        await update.value
        #expect(f.controller.state == .signedOut)
        await f.controller.synchronize()
        let request = try #require(await f.transport.requests.last)
        let object = try petTestObject(request.payload)
        #expect(object["operation"] as? String == "clear")
        #expect((object["payload"] as? [String: Any])?.isEmpty == true)
        #expect(!f.controller.allowsActions)
    }

    @Test("Only one request runs while a response is pending")
    func singleFlight() async {
        let f = PetAccessTestFixture()
        let gate = PetAccessTestGate()
        await f.transport.pauseNextResponse(gate)
        let pending = Task { await f.controller.synchronize() }
        await gate.waitUntilEntered()
        await f.controller.synchronize()
        #expect(await f.transport.requests.count == 1)
        await gate.release()
        await pending.value
    }

    @Test("A same-user re-login waits for the clear ACK even across service replacement", arguments: [false, true])
    func reloginCannotOverwriteClearBarrier(replaceService: Bool) async throws {
        let f = PetAccessTestFixture()
        await f.activate()
        let gate = PetAccessTestGate()
        await f.transport.pauseNextResponse(gate)
        let pending = Task { await f.controller.synchronize() }
        await gate.waitUntilEntered()
        let requestsBeforeLogout = await f.transport.requests.count
        f.controller.invalidateCredential()
        let clearRevision = f.controller.revision
        f.controller.receiveVerifiedCredential(.init(userID: f.credential.userID,
            accessToken: "latest-relogin-access", expiresAt: f.credential.expiresAt))
        #expect(f.controller.revision == clearRevision)
        #expect(!f.controller.allowsActions)

        if replaceService {
            f.owner.value = .init(generation: 2, credential: String(repeating: "b", count: 64))
            await f.transport.restart(generation: UUID())
            f.controller.serviceDidChange()
        }
        await gate.release()
        await pending.value
        #expect(!f.controller.allowsActions)
        if replaceService { await f.controller.synchronize() } // New owner status handshake.
        await f.controller.synchronize() // Only clear can cross the barrier.
        #expect(f.controller.state == .checking)
        #expect(!f.controller.allowsActions)
        let afterClear = await f.transport.requests
        let clearRequest = try #require(afterClear.last)
        let clear = try petTestObject(clearRequest.payload)
        #expect(clear["operation"] as? String == "clear")
        #expect((clear["payload"] as? [String: Any])?.isEmpty == true)

        await f.controller.synchronize() // Latest credential follows the ACK.
        let afterUpdate = await f.transport.requests
        let updateRequest = try #require(afterUpdate.last)
        let update = try petTestObject(updateRequest.payload)
        let credential = try #require(update["payload"] as? [String: Any])
        #expect(update["operation"] as? String == "update")
        #expect(credential["access_token"] as? String == "latest-relogin-access")
        #expect((update["revision"] as? Int ?? 0) > (clear["revision"] as? Int ?? 0))
        let operations = try afterUpdate.dropFirst(requestsBeforeLogout).map {
            try petTestObject($0.payload)["operation"] as? String
        }
        #expect(operations == (replaceService ? ["status", "clear", "update"] : ["clear", "update"]))
        #expect(f.controller.state == .checking)
        #expect(!f.controller.allowsActions)
    }

    @Test("A lost mutation reply retries the same request ID and revision")
    func retriesIdenticalMutation() async throws {
        let f = PetAccessTestFixture()
        f.controller.receiveVerifiedCredential(f.credential)
        await f.controller.synchronize()
        await f.transport.loseNextResponse()
        await f.controller.synchronize()
        #expect(f.controller.state == .unavailable)
        await f.controller.synchronize()
        let requests = await f.transport.requests
        let first = try petTestObject(requests[1].payload)
        let retry = try petTestObject(requests[2].payload)
        #expect(first["request_id"] as? String == retry["request_id"] as? String)
        #expect(first["revision"] as? Int == retry["revision"] as? Int)
        #expect(f.controller.state == .checking)
    }

    @Test("A new service UUID locks first and receives the current verified credential once")
    func serviceRestartRebinds() async throws {
        let f = PetAccessTestFixture()
        await f.activate()
        let generation = UUID()
        await f.transport.restart(generation: generation)
        await f.controller.synchronize()
        #expect(f.controller.state == .checking)
        #expect(!f.controller.allowsActions)
        #expect(f.controller.serviceGeneration == generation)
        await f.controller.synchronize()
        await f.controller.synchronize()
        let requests = await f.transport.requests
        let operations = try requests.map { try petTestObject($0.payload)["operation"] as? String }
        #expect(operations.filter { $0 == "update" }.count == 2)
        #expect(Array(operations.suffix(3)) == ["status", "update", "status"])
    }

    @Test("A different app-owned service credential fences the previous owner's reply")
    func ownerChangeFencesReply() async {
        let f = PetAccessTestFixture()
        await f.activate()
        let gate = PetAccessTestGate()
        await f.transport.pauseNextResponse(gate)
        let pending = Task { await f.controller.synchronize() }
        await gate.waitUntilEntered()
        f.owner.value = .init(generation: 2, credential: String(repeating: "b", count: 64))
        #expect(!f.controller.allowsActions)
        f.controller.serviceDidChange()
        await gate.release()
        await pending.value
        #expect(f.controller.state == .checking)
        #expect(f.controller.serviceGeneration == nil)
        #expect(!f.controller.allowsActions)
    }

    @Test("A different account fences an in-flight status and cannot inherit its grant")
    func accountChangeFencesReply() async {
        let f = PetAccessTestFixture()
        await f.activate()
        let gate = PetAccessTestGate()
        await f.transport.pauseNextResponse(gate)
        let pending = Task { await f.controller.synchronize() }
        await gate.waitUntilEntered()
        let other = UUID()
        f.controller.receiveVerifiedCredential(.init(userID: other,
            accessToken: "another-test-access", expiresAt: f.credential.expiresAt))
        await gate.release()
        await pending.value
        #expect(f.controller.state == .checking)
        #expect(f.controller.userID == other)
        #expect(!f.controller.allowsActions)
    }

    @Test("Malformed, stale, and cross-account replies fail closed", arguments: PetAccessTestCorruption.allCases)
    func rejectsInvalidReply(_ corruption: PetAccessTestCorruption) async {
        let f = PetAccessTestFixture()
        await f.activate()
        await f.transport.corruptNextResponse(corruption)
        await f.controller.synchronize()
        #expect(f.controller.state == .unavailable)
        #expect(!f.controller.allowsActions)
    }

    @Test("An explicit retry sends refresh without credentials or a mutation revision")
    func refreshHasEmptyPayload() async throws {
        let f = PetAccessTestFixture()
        await f.activate()
        let revision = f.controller.revision
        f.controller.refresh()
        await f.controller.synchronize()
        let request = try #require(await f.transport.requests.last)
        let object = try petTestObject(request.payload)
        #expect(object["operation"] as? String == "refresh")
        #expect(object["revision"] as? Int == revision)
        #expect((object["payload"] as? [String: Any])?.isEmpty == true)
    }

    @Test("No owned service or expired credential can enable access")
    func unavailableOwnershipAndCredential() async {
        let f = PetAccessTestFixture()
        f.owner.value = nil
        f.controller.receiveVerifiedCredential(f.credential)
        await f.controller.synchronize()
        #expect(f.controller.state == .unavailable)
        #expect(await f.transport.requests.isEmpty)
        f.controller.receiveVerifiedCredential(.init(userID: f.credential.userID,
            accessToken: f.credential.accessToken, expiresAt: PetAccessTestFixture.wallTime))
        #expect(f.controller.state == .signedOut)
        #expect(!f.controller.allowsActions)
    }

    @Test("Blocked actions and approval shortcuts remain unavailable while settings can open")
    func viewModelGuardsActions() async throws {
        let f = PetAccessTestFixture()
        await f.activate()
        let transport = PetFakeTransport()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 productAccess: f.controller)
        defer { model.stopPolling() }
        let backend = PetFakeHotKeyBackend()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults) { [weak model] in
            model?.handleShortcut($0)
        }
        model.attachHotKeyRegistry(registry)
        try model.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "access")],
            permissionRequests: [PetTestPermissionRequest(suffix: "access", allowOnceAvailable: true)]))
        model.setPanelVisible(true)
        let displayed = try #require(model.pendingPermissionRequest)
        let context = model.captureProviderActionContext()
        #expect(model.approvalHead != nil)
        #expect(model.hasAttention)

        f.controller.invalidateCredential()
        #expect(model.isProductAccessBlocked)
        #expect(model.approvalHead == nil)
        #expect(!model.canActOnDisplayedEvent)
        #expect(!model.hasAttention)
        #expect(!model.acceptsProviderAction(context))
        #expect(backend.registrations.values.allSatisfy { $0.shortcut == PetShortcutConfiguration.defaults.toggle })
        await model.resolvePermissionRequest(.allowOnce, for: displayed)
        await model.requestPanelSelection(1)
        model.handleShortcut(.slot1)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(model.snapshot?.permissionRequests.contains(displayed) == true)
        model.showAccessSettings(diagnostics: true)
        #expect(model.isShowingOnboarding)
        #expect(model.accessDiagnosticsRequestID != nil)

        await f.activate()
        #expect(model.productAccessAllowsActions)
        #expect(!model.acceptsProviderAction(context))
    }
}

@MainActor
private final class PetAccessTestOwner {
    var value: PetProviderServiceAccess? = .init(generation: 1, credential: String(repeating: "a", count: 64))
    var nanoseconds: UInt64 = 1_000_000_000
}

@MainActor
private final class PetAccessTestFixture {
    static let wallTime = Date(timeIntervalSince1970: 1_800_000_000)
    let owner = PetAccessTestOwner()
    let transport = PetAccessTestTransport()
    let controller: PetAccessController
    let credential = PetAccountVerifiedCredential(userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        accessToken: "verified-test-access", expiresAt: PetAccessTestFixture.wallTime.addingTimeInterval(3_600))

    init() {
        let owner = owner
        controller = PetAccessController(transport: transport, ownedAccess: { owner.value },
            now: { owner.nanoseconds }, wallNow: { Self.wallTime }, automaticPolling: false)
    }

    func activate(remaining: Int = 300) async {
        controller.receiveVerifiedCredential(credential)
        await controller.synchronize()
        await controller.synchronize()
        await transport.setState(.active, userID: credential.userID, remaining: remaining)
        await controller.synchronize()
    }
}

enum PetAccessTestCorruption: CaseIterable, Sendable {
    case requestID, account, booleanRevision, staleRevision, zeroTTL, excessiveTTL, unknownState, extraKey
}

private actor PetAccessTestTransport: PetCoordinatorTransport {
    struct Request: Sendable { let type: String; let payload: Data }
    private(set) var requests: [Request] = []
    private var generation = UUID()
    private var revision = 0
    private var state: PetAccessState = .signedOut
    private var userID: UUID?
    private var remaining = 0
    private var gate: PetAccessTestGate?
    private var losesReply = false
    private var corruption: PetAccessTestCorruption?

    func setState(_ state: PetAccessState, userID: UUID?, remaining: Int = 0) {
        self.state = state; self.userID = userID; self.remaining = remaining
    }
    func restart(generation: UUID) {
        self.generation = generation; revision = 0
        setState(.signedOut, userID: nil)
    }
    func pauseNextResponse(_ gate: PetAccessTestGate) { self.gate = gate }
    func loseNextResponse() { losesReply = true }
    func corruptNextResponse(_ corruption: PetAccessTestCorruption) { self.corruption = corruption }

    func request(type: String, payload: Data) async throws -> Data {
        requests.append(.init(type: type, payload: payload))
        let input = try petTestObject(payload)
        if input["operation"] as? String == "update" {
            let fields = try #require(input["payload"] as? [String: Any])
            let nextUser = UUID(uuidString: fields["user_id"] as? String ?? "")
            if state != .active || nextUser != userID { state = .checking; remaining = 0 }
            userID = nextUser
            revision = input["revision"] as? Int ?? 0
        } else if input["operation"] as? String == "clear" {
            revision = input["revision"] as? Int ?? 0
            setState(.signedOut, userID: nil)
        }
        var output: [String: Any] = ["schema_version": 1, "request_id": input["request_id"] ?? NSNull(),
            "service_generation": generation.uuidString.lowercased(), "revision": revision,
            "state": state.rawValue, "user_id": userID?.uuidString.lowercased() as Any? ?? NSNull(),
            "remaining_seconds": remaining]
        if let corruption {
            self.corruption = nil
            switch corruption {
            case .requestID: output["request_id"] = UUID().uuidString.lowercased()
            case .account: output["user_id"] = UUID().uuidString.lowercased()
            case .booleanRevision: output["revision"] = true
            case .staleRevision: output["revision"] = max(0, revision - 1)
            case .zeroTTL: output["remaining_seconds"] = 0
            case .excessiveTTL: output["remaining_seconds"] = 301
            case .unknownState: output["state"] = "not-a-state"
            case .extraKey: output["allows_actions"] = true
            }
        }
        let response = try petTestData(output)
        if let gate { self.gate = nil; await gate.suspend() }
        if losesReply { losesReply = false; throw PetTestError.injected("lost_response") }
        return response
    }
}

private actor PetAccessTestGate {
    private var entered = false
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []
    func suspend() async {
        await withCheckedContinuation {
            continuation = $0; entered = true
            let waiting = observers; observers.removeAll()
            waiting.forEach { $0.resume() }
        }
    }
    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { observers.append($0) }
    }
    func release() { continuation?.resume(); continuation = nil }
}

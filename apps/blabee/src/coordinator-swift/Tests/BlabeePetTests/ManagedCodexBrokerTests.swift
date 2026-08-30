import Darwin
import Dispatch
import Foundation
import Testing
import CoordinatorSwift
@testable import BlabeeCoordinator

private struct ManagedCodexFakeDecider: ManagedCodexApprovalDeciding {
    let result: Result<CodexAppServerApprovalDecision, ManagedCodexTestError>

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        try cancellation.check()
        return try result.get()
    }
}

private enum ManagedCodexTestError: Error, Equatable, Sendable {
    case failed(String)
}

private final class ManagedCodexExecutableSequence<Failure: Error & Sendable>:
    @unchecked Sendable
{
    private let lock = NSLock()
    private var outcomes: [Result<URL, Failure>]
    private var count = 0
    private let beforeOutcome: @Sendable (Int) -> Void

    init(
        _ outcomes: [Result<URL, Failure>],
        beforeOutcome: @escaping @Sendable (Int) -> Void = { _ in }
    ) {
        self.outcomes = outcomes
        self.beforeOutcome = beforeOutcome
    }

    func next() throws -> URL {
        lock.lock()
        count += 1
        let call = count
        guard !outcomes.isEmpty else {
            lock.unlock()
            throw ManagedCodexTestError.failed("exhausted")
        }
        let outcome = outcomes.removeFirst()
        lock.unlock()
        beforeOutcome(call)
        return try outcome.get()
    }

    var callCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private final class ManagedCodexSequenceDecider: @unchecked Sendable,
    ManagedCodexApprovalDeciding
{
    private let lock = NSLock()
    private var decisions: [CodexAppServerApprovalDecision]

    init(_ decisions: [CodexAppServerApprovalDecision]) {
        self.decisions = decisions
    }

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        try cancellation.check()
        lock.lock()
        defer { lock.unlock() }
        guard !decisions.isEmpty else { throw ManagedCodexTestError.failed("decision") }
        return decisions.removeFirst()
    }
}

private final class ManagedCodexBlockingDecider: @unchecked Sendable,
    ManagedCodexApprovalDeciding
{
    private let lock = NSLock()
    private let releaseSemaphore = DispatchSemaphore(value: 0)
    private var requestIDs: [CodexAppServerRequestID] = []
    let started = DispatchSemaphore(value: 0)

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        lock.lock()
        requestIDs.append(request.requestID)
        lock.unlock()
        started.signal()
        while releaseSemaphore.wait(timeout: .now() + .milliseconds(10)) != .success {
            try cancellation.check()
        }
        try cancellation.check()
        return .allowOnce
    }

    func release(_ count: Int = 1) {
        for _ in 0..<count { releaseSemaphore.signal() }
    }

    var callCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return requestIDs.count
    }
}

private struct ManagedCodexLateAllowDecider: ManagedCodexApprovalDeciding {
    let delaySeconds: TimeInterval

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        Thread.sleep(forTimeInterval: delaySeconds)
        return .allowOnce
    }
}

private final class ManagedCodexCountingDecider: @unchecked Sendable,
    ManagedCodexApprovalDeciding
{
    private let lock = NSLock()
    private var count = 0

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        try cancellation.check()
        lock.lock()
        count += 1
        lock.unlock()
        return .allowOnce
    }

    var callCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private final class ManagedCodexDeliveryTrackingDecider: @unchecked Sendable,
    ManagedCodexApprovalDeliveryTracking
{
    private let lock = NSLock()
    private var selections: [ManagedCodexApprovalSelection]
    private var acknowledgedDeliveries: [ManagedCodexApprovalDelivery] = []
    private let blockAcknowledgement: Bool
    private let acknowledgementFailure: ManagedCodexTestError?
    let acknowledgementStarted = DispatchSemaphore(value: 0)
    let acknowledgementRelease = DispatchSemaphore(value: 0)

    init(
        _ selections: [ManagedCodexApprovalSelection],
        blockAcknowledgement: Bool = false,
        acknowledgementFailure: ManagedCodexTestError? = nil
    ) {
        self.selections = selections
        self.blockAcknowledgement = blockAcknowledgement
        self.acknowledgementFailure = acknowledgementFailure
    }

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        try selection(
            for: request,
            context: context,
            cancellation: cancellation
        ).decision
    }

    func selection(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> ManagedCodexApprovalSelection {
        try cancellation.check()
        lock.lock()
        defer { lock.unlock() }
        guard !selections.isEmpty else {
            throw ManagedCodexTestError.failed("selection")
        }
        return selections.removeFirst()
    }

    func acknowledgeDelivery(_ delivery: ManagedCodexApprovalDelivery) throws {
        lock.lock()
        acknowledgedDeliveries.append(delivery)
        lock.unlock()
        acknowledgementStarted.signal()
        if blockAcknowledgement {
            _ = acknowledgementRelease.wait(timeout: .now() + .seconds(2))
        }
        if let acknowledgementFailure { throw acknowledgementFailure }
    }

    var acknowledgements: [ManagedCodexApprovalDelivery] {
        lock.lock()
        defer { lock.unlock() }
        return acknowledgedDeliveries
    }
}

private final class ManagedCodexBridgeTestResult: @unchecked Sendable {
    private let lock = NSLock()
    private var storedError: Error?

    func record(_ error: Error) {
        lock.lock()
        storedError = error
        lock.unlock()
    }

    var error: Error? {
        lock.lock()
        defer { lock.unlock() }
        return storedError
    }
}

private final class ManagedCodexBridgeHarness: @unchecked Sendable {
    let client: Int32
    let finished = DispatchGroup()
    let result = ManagedCodexBridgeTestResult()
    private let appServerOutput = Pipe()
    private let appServerInput = Pipe()
    private let bridge: ManagedCodexAppServerBridge

    init(
        decider: any ManagedCodexApprovalDeciding,
        maximumPendingApprovals: Int = 8,
        maximumSeenApprovalRequestIDs: Int = 256,
        maximumTrackedResumeRequestIDs: Int = 32,
        resumeConflictReporter: @escaping ManagedCodexResumeConflictObserver.Reporter = {
            _ in
        },
        approvalWaitNanoseconds: UInt64 = 30_000_000_000
    ) throws {
        finished.enter()
        let token = "harness-token"
        let listener = try ManagedCodexWebSocketListener(expectedToken: token)
        client = try managedCodexConnectClient(port: listener.port)
        try managedCodexTestWrite(Data((
            "GET / HTTP/1.1\r\n"
                + "Host: 127.0.0.1:\(listener.port)\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                + "Sec-WebSocket-Version: 13\r\n"
                + "Authorization: Bearer \(token)\r\n\r\n"
        ).utf8), descriptor: client)
        let connection = try listener.accept(timeoutMilliseconds: 1_000)
        _ = try managedCodexTestReadHeaders(descriptor: client)
        listener.close()
        bridge = try ManagedCodexAppServerBridge(
            connection: connection,
            appServerOutput: appServerOutput.fileHandleForReading,
            appServerInput: appServerInput.fileHandleForWriting,
            approvalRouter: ManagedCodexApprovalRouter(decider: decider),
            brokerEpoch: "epoch-harness",
            maximumPendingApprovals: maximumPendingApprovals,
            maximumSeenApprovalRequestIDs: maximumSeenApprovalRequestIDs,
            maximumTrackedResumeRequestIDs: maximumTrackedResumeRequestIDs,
            resumeConflictReporter: resumeConflictReporter,
            approvalWaitNanoseconds: approvalWaitNanoseconds
        )
    }

    var appServerResponseDescriptor: Int32 {
        appServerInput.fileHandleForReading.fileDescriptor
    }

    func start() {
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            defer { finished.leave() }
            do { try bridge.run() }
            catch { result.record(error) }
        }
    }

    func sendFromAppServer(_ message: Data) throws {
        try appServerOutput.fileHandleForWriting.write(
            contentsOf: message + Data([0x0A])
        )
    }

    func sendFromTUI(_ message: Data) throws {
        try managedCodexTestWrite(
            managedCodexClientFrame(opcode: 0x1, payload: message),
            descriptor: client
        )
    }

    func closeAppServerResponseReader() {
        try? appServerInput.fileHandleForReading.close()
    }

    func stopBridge() {
        bridge.stop()
    }

    func close() {
        bridge.stop()
        try? appServerOutput.fileHandleForWriting.close()
        _ = shutdown(client, SHUT_RDWR)
        Darwin.close(client)
        _ = finished.wait(timeout: .now() + .seconds(2))
        try? appServerInput.fileHandleForReading.close()
    }
}

private final class ManagedCodexFakeCoordinatorServer: @unchecked Sendable {
    let receivedRequest = DispatchSemaphore(value: 0)
    let peerClosed = DispatchSemaphore(value: 0)
    let socketPath: String
    private let descriptor: Int32

    init() throws {
        socketPath = "/tmp/blabee-managed-\(UUID().uuidString.lowercased()).sock"
        _ = unlink(socketPath)
        descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw ManagedCodexTestError.failed("uds socket") }
        var address = sockaddr_un()
        let bytes = Array(socketPath.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            Darwin.close(descriptor)
            throw ManagedCodexTestError.failed("uds path")
        }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            destination.copyBytes(from: bytes)
        }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(
                    descriptor,
                    $0,
                    socklen_t(MemoryLayout<sockaddr_un>.size)
                )
            }
        }
        guard bound == 0,
              chmod(socketPath, 0o600) == 0,
              listen(descriptor, 1) == 0
        else {
            Darwin.close(descriptor)
            _ = unlink(socketPath)
            throw ManagedCodexTestError.failed("uds bind")
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let peer = Darwin.accept(descriptor, nil, nil)
            guard peer >= 0 else {
                receivedRequest.signal()
                peerClosed.signal()
                return
            }
            defer { Darwin.close(peer) }
            var byte: UInt8 = 0
            while Darwin.read(peer, &byte, 1) == 1 {
                if byte == 0x0A {
                    receivedRequest.signal()
                    break
                }
            }
            while true {
                let count = Darwin.read(peer, &byte, 1)
                if count == 0 {
                    peerClosed.signal()
                    return
                }
                if count < 0 && errno == EINTR { continue }
                if count < 0 {
                    peerClosed.signal()
                    return
                }
            }
        }
    }

    func close() {
        _ = shutdown(descriptor, SHUT_RDWR)
        Darwin.close(descriptor)
        _ = unlink(socketPath)
    }
}

@Test("Managed approval production deadlines leave deterministic fallback margins")
func managedCodexApprovalProductionDeadlinesAreOrdered() {
    let policy = ManagedCodexApprovalTimingPolicy.self
    let socketTimeoutNanoseconds =
        UInt64(policy.socketResponseTimeoutMilliseconds) * 1_000_000
    let minimumFallbackMarginNanoseconds: UInt64 = 5_000_000_000

    #expect(policy.userDecisionTimeoutNanoseconds == 120_000_000_000)
    #expect(policy.brokerDeadlineNanoseconds == 130_000_000_000)
    #expect(policy.socketResponseTimeoutMilliseconds == 135_000)
    #expect(
        policy.brokerDeadlineNanoseconds - policy.userDecisionTimeoutNanoseconds
            >= minimumFallbackMarginNanoseconds
    )
    #expect(
        socketTimeoutNanoseconds - policy.brokerDeadlineNanoseconds
            >= minimumFallbackMarginNanoseconds
    )
}

@Test("Managed launcher preserves unexpected App Server failure status")
func managedCodexLauncherResolvesChildExitStatus() {
    #expect(managedCodexResolvedExitStatus(
        tuiStatus: 9,
        appServerStatus: 17,
        appServerTerminatedByBroker: false
    ) == 9)
    #expect(managedCodexResolvedExitStatus(
        tuiStatus: 0,
        appServerStatus: 17,
        appServerTerminatedByBroker: false
    ) == 17)
    #expect(managedCodexResolvedExitStatus(
        tuiStatus: 0,
        appServerStatus: SIGTERM,
        appServerTerminatedByBroker: true
    ) == 0)
}

@Test("Managed approval router synthesizes only one-time accept")
func managedCodexRouterAllowsOnceWithoutSessionGrant() throws {
    let original = try managedCodexApprovalData(id: Int64.max)
    let route = ManagedCodexApprovalRouter(decider: ManagedCodexFakeDecider(
        result: .success(.allowOnce)
    )).route(
        appServerMessage: original,
        context: ManagedCodexConnectionContext(
            brokerEpoch: "epoch-1",
            connectionID: "connection-1"
        )
    )
    guard case .appServer(let response) = route else {
        Issue.record("allow once must be routed back to App Server")
        return
    }
    let object = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
    #expect((object["id"] as? NSNumber)?.int64Value == Int64.max)
    let result = try #require(object["result"] as? [String: Any])
    #expect(result["decision"] as? String == "accept")
    #expect(String(data: response, encoding: .utf8)?.contains("acceptForSession") == false)
}

@Test("Managed approval router restores exact Codex request on direct choice or failure")
func managedCodexRouterFailsBackToOfficialCodex() throws {
    let original = try managedCodexApprovalData(id: "request-1")
    let context = ManagedCodexConnectionContext(
        brokerEpoch: "epoch-1",
        connectionID: "connection-1"
    )
    for result in [
        Result<CodexAppServerApprovalDecision, ManagedCodexTestError>.success(.decideInCodex),
        .failure(.failed("expected")),
    ] {
        let route = ManagedCodexApprovalRouter(
            decider: ManagedCodexFakeDecider(result: result)
        ).route(appServerMessage: original, context: context)
        #expect(route == .codex(original))
    }

    let unrelated = Data(#"{"method":"thread/started","params":{}}"#.utf8)
    let unrelatedRoute = ManagedCodexApprovalRouter(
        decider: ManagedCodexFakeDecider(result: .success(.allowOnce))
    ).route(appServerMessage: unrelated, context: context)
    #expect(unrelatedRoute == .codex(unrelated))
}

@Test("Managed approval coordinator payload carries exact typed binding")
func managedCodexCoordinatorPayloadPreservesBinding() throws {
    let request = try CodexAppServerApprovalAdapter.parse(
        try managedCodexApprovalData(id: Int64.max, approvalID: nil)
    )
    let payload = ManagedCodexApprovalCoordinatorClient.payload(
        for: request,
        context: ManagedCodexConnectionContext(
            brokerEpoch: "epoch-1",
            connectionID: "connection-1"
        )
    )
    #expect(Set(payload.keys) == [
        "schema_version", "kind", "broker_epoch", "connection_id",
        "jsonrpc_request_id", "thread_id", "turn_id", "item_id",
        "approval_id", "environment_id", "cwd", "command_preview",
        "allow_once_available",
        "decline_available",
    ])
    #expect(payload["approval_id"] is NSNull)
    #expect(payload["environment_id"] is NSNull)
    let requestID = try #require(payload["jsonrpc_request_id"] as? [String: Any])
    #expect(requestID["type"] as? String == "integer")
    #expect((requestID["value"] as? NSNumber)?.int64Value == Int64.max)
    #expect(payload["allow_once_available"] as? Bool == true)
    #expect(payload["decline_available"] as? Bool == true)

    let amendment = ["/bin/mkdir", "/Users/example/Library/Caches/blabee-qa"]
    var liveShape = try #require(
        JSONSerialization.jsonObject(
            with: managedCodexApprovalData(id: "live-shape")
        ) as? [String: Any]
    )
    var liveParams = try #require(liveShape["params"] as? [String: Any])
    liveParams["proposedExecpolicyAmendment"] = amendment
    liveParams["availableDecisions"] = [
        "accept",
        [
            "acceptWithExecpolicyAmendment": [
                "execpolicy_amendment": amendment,
            ],
        ],
        "cancel",
    ]
    liveShape["params"] = liveParams
    let liveRequest = try CodexAppServerApprovalAdapter.parse(
        try JSONSerialization.data(withJSONObject: liveShape)
    )
    let livePayload = ManagedCodexApprovalCoordinatorClient.payload(
        for: liveRequest,
        context: ManagedCodexConnectionContext(
            brokerEpoch: "epoch-live",
            connectionID: "connection-live"
        )
    )
    #expect(livePayload["allow_once_available"] as? Bool == true)
    #expect(livePayload["decline_available"] as? Bool == true)
}

@Test("Managed delivery ack payload carries token and exact transport binding")
func managedCodexDeliveryPayloadPreservesBinding() throws {
    let request = try CodexAppServerApprovalAdapter.parse(
        try managedCodexApprovalData(id: Int64.max, approvalID: nil)
    )
    let payload = ManagedCodexApprovalCoordinatorClient.deliveryPayload(
        for: ManagedCodexApprovalDelivery(
            token: "managed_delivery_01",
            request: request,
            context: ManagedCodexConnectionContext(
                brokerEpoch: "epoch-delivery",
                connectionID: "connection-delivery"
            )
        )
    )
    #expect(Set(payload.keys) == [
        "schema_version", "kind", "broker_epoch", "connection_id",
        "jsonrpc_request_id", "thread_id", "turn_id", "item_id",
        "approval_id", "environment_id", "delivery_token",
    ])
    #expect(payload["schema_version"] as? String == "1.0")
    #expect(
        payload["kind"] as? String
            == "blabee_managed_command_approval_delivery_ack"
    )
    #expect(payload["broker_epoch"] as? String == "epoch-delivery")
    #expect(payload["connection_id"] as? String == "connection-delivery")
    #expect(payload["thread_id"] as? String == "thread-1")
    #expect(payload["turn_id"] as? String == "turn-1")
    #expect(payload["item_id"] as? String == "item-1")
    #expect(payload["approval_id"] is NSNull)
    #expect(payload["environment_id"] is NSNull)
    #expect(payload["delivery_token"] as? String == "managed_delivery_01")
    let requestID = try #require(payload["jsonrpc_request_id"] as? [String: Any])
    #expect(requestID["type"] as? String == "integer")
    #expect((requestID["value"] as? NSNumber)?.int64Value == Int64.max)
}

@Test("Managed delivery token accepts only the narrow canonical identifier alphabet")
func managedCodexDeliveryTokenIsStrictlyCanonical() throws {
    let selection = try ManagedCodexApprovalCoordinatorClient.selection(from: [
        "decision": "accept_once",
        "delivery_token": "managed_approval_delivery_01-ABC",
    ])
    #expect(selection == ManagedCodexApprovalSelection(
        decision: .allowOnce,
        deliveryToken: "managed_approval_delivery_01-ABC"
    ))

    for invalidToken in [
        "",
        "too-short",
        "delivery token",
        "delivery/token",
        "delivery.token.that.is.long.enough",
        "delivery:token:that:is:long:enough",
        "delivery\n01",
        "delivery\u{202E}01",
        String(repeating: "a", count: 513),
    ] {
        #expect(throws: ManagedCodexApprovalRuntimeError.invalidCoordinatorResponse) {
            _ = try ManagedCodexApprovalCoordinatorClient.selection(from: [
                "decision": "accept_once",
                "delivery_token": invalidToken,
            ])
        }
    }
    #expect(throws: ManagedCodexApprovalRuntimeError.invalidCoordinatorResponse) {
        _ = try ManagedCodexApprovalCoordinatorClient.selection(from: [
            "decision": "accept_once",
            "delivery_token": "delivery_01",
            "unexpected": true,
        ])
    }
}

@Test("Managed synthetic allow and deny require a delivery token")
func managedCodexSyntheticDecisionsRequireDeliveryToken() throws {
    for decision in ["accept_once", "decline"] {
        #expect(throws: ManagedCodexApprovalRuntimeError.invalidCoordinatorResponse) {
            _ = try ManagedCodexApprovalCoordinatorClient.selection(from: [
                "decision": decision,
            ])
        }
    }

    let decline = try ManagedCodexApprovalCoordinatorClient.selection(from: [
        "decision": "decline",
        "delivery_token": "managed_decline_delivery_01",
    ])
    #expect(decline == ManagedCodexApprovalSelection(
        decision: .deny,
        deliveryToken: "managed_decline_delivery_01"
    ))

    let nativeFallback = try ManagedCodexApprovalCoordinatorClient.selection(from: [
        "decision": "decide_in_codex",
    ])
    #expect(nativeFallback == ManagedCodexApprovalSelection(
        decision: .decideInCodex,
        deliveryToken: nil
    ))

    let selectedNativeFallback = try ManagedCodexApprovalCoordinatorClient.selection(from: [
        "decision": "decide_in_codex",
        "delivery_token": "managed_native_delivery_01",
    ])
    #expect(selectedNativeFallback == ManagedCodexApprovalSelection(
        decision: .decideInCodex,
        deliveryToken: "managed_native_delivery_01"
    ))
}

@Test("Managed WebSocket handshake follows RFC example and requires bearer token")
func managedCodexWebSocketHandshakeIsAuthenticated() throws {
    let request = Data((
        "GET / HTTP/1.1\r\n"
            + "Host: 127.0.0.1\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: keep-alive, Upgrade\r\n"
            + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            + "Sec-WebSocket-Version: 13\r\n"
            + "Authorization: Bearer test-token\r\n\r\n"
    ).utf8)
    let response = try ManagedCodexWebSocketHandshake.response(
        for: request,
        expectedToken: "test-token"
    )
    let responseText = try #require(String(data: response, encoding: .utf8))
    #expect(responseText.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="))
    #expect(throws: ManagedCodexWebSocketError.authenticationFailed) {
        _ = try ManagedCodexWebSocketHandshake.response(
            for: request,
            expectedToken: "different-token"
        )
    }
}

@Test("Managed WebSocket handshake uses one absolute deadline")
func managedCodexWebSocketHandshakeDeadlineIsAbsolute() throws {
    let listener = try ManagedCodexWebSocketListener(expectedToken: "deadline-token")
    defer { listener.close() }
    let client = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(client) }
    try managedCodexTestWrite(Data("G".utf8), descriptor: client)
    let writerFinished = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .utility).async {
        defer { writerFinished.signal() }
        for byte in Array("ET".utf8) {
            usleep(40_000)
            var value = byte
            if Darwin.write(client, &value, 1) <= 0 { return }
        }
    }
    let started = DispatchTime.now().uptimeNanoseconds
    #expect(throws: ManagedCodexWebSocketError.invalidHandshake) {
        _ = try listener.accept(
            timeoutMilliseconds: 500,
            handshakeTimeoutMilliseconds: 100
        )
    }
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000
    #expect(elapsedMilliseconds < 160)
    _ = shutdown(client, SHUT_RDWR)
    _ = writerFinished.wait(timeout: .now() + .seconds(1))
}

@Test("Managed WebSocket parser accepts masked fragmented text and ping")
func managedCodexWebSocketParserHandlesClientFrames() throws {
    var parser = ManagedCodexWebSocketFrameParser()
    let first = managedCodexClientFrame(opcode: 0x1, payload: Data("hel".utf8), fin: false)
    let ping = managedCodexClientFrame(opcode: 0x9, payload: Data("p".utf8))
    let second = managedCodexClientFrame(opcode: 0x0, payload: Data("lo".utf8))
    let split = first.count / 2
    #expect(try parser.append(first.prefix(split)).isEmpty)
    #expect(try parser.append(first.dropFirst(split)).isEmpty)
    #expect(try parser.append(ping) == [.ping(Data("p".utf8))])
    #expect(try parser.append(second) == [.text(Data("hello".utf8))])

    let unmasked = try ManagedCodexWebSocketFrameEncoder.serverFrame(
        opcode: 0x1,
        payload: Data("unsafe".utf8)
    )
    #expect(throws: ManagedCodexWebSocketError.invalidFrame) {
        _ = try parser.append(unmasked)
    }
}

@Test("Managed WebSocket parser accepts Codex extended-length text frames")
func managedCodexWebSocketParserHandlesExtendedClientFrames() throws {
    #expect(
        ManagedCodexWebSocketFrameParser.maximumMessageBytes
            == 128 * 1024 * 1024
    )

    for size in [1_024, 70_000] {
        var parser = ManagedCodexWebSocketFrameParser()
        let payload = Data(repeating: 0x61, count: size)
        let frame = managedCodexClientFrame(opcode: 0x1, payload: payload)
        let split = frame.count / 2
        #expect(try parser.append(frame.prefix(split)).isEmpty)
        #expect(try parser.append(frame.dropFirst(split)) == [.text(payload)])
    }
}

@Test("Managed WebSocket errors retain a safe public coordinator code")
func managedCodexWebSocketErrorsAreNotCollapsedToInternalError() {
    #expect(
        managedCodexCoordinatorError(
            ManagedCodexWebSocketError.messageTooLarge
        ).code == "managed_codex_websocket_message_too_large"
    )
    #expect(
        managedCodexCoordinatorError(
            ManagedCodexWebSocketError.socketFailure("read")
        ).code == "managed_codex_websocket_socket_failure"
    )
}

@Test("Managed launcher owns remote flags and preserves TUI arguments after separator")
func managedCodexLauncherArgumentsAreBounded() throws {
    let parsed = try ManagedCodexLauncherArguments([
        "--codex", "/opt/homebrew/bin/codex",
        "--coordinator-socket", "/tmp/blabee.sock",
        "--", "resume", "thread-1", "--no-alt-screen",
    ])
    #expect(parsed.explicitCodexURL?.path == "/opt/homebrew/bin/codex")
    #expect(parsed.coordinatorSocketPath == "/tmp/blabee.sock")
    #expect(parsed.tuiArguments == ["resume", "thread-1", "--no-alt-screen"])

    for reserved in [
        ["--", "--remote", "ws://elsewhere"],
        ["--", "--remote=ws://elsewhere"],
        ["--", "--remote-auth-token-env", "TOKEN"],
        ["--", "--remote-auth-token-env=TOKEN"],
    ] {
        #expect(throws: (any Error).self) {
            _ = try ManagedCodexLauncherArguments(reserved)
        }
    }
}

@Test("Managed launcher rejects an explicit Codex path when approval owns resolution")
func managedCodexLauncherRejectsExplicitCodexWithApprovalProvider() {
    let provider = ManagedCodexExecutableSequence<CoordinatorError>([
        .success(URL(fileURLWithPath: "/usr/bin/false")),
    ])

    #expect(throws: (any Error).self) {
        _ = try ManagedCodexLauncher().run(
            arguments: [
                "--codex", "/usr/bin/false",
                "--coordinator-socket", "/tmp/blabee-managed-explicit.sock",
                "--",
            ],
            approvedExecutableProvider: provider.next
        )
    }
    #expect(provider.callCount == 0)
}

@Test("Managed launcher resolves approval before starting App Server")
func managedCodexLauncherChecksApprovalBeforeAppServer() {
    let provider = ManagedCodexExecutableSequence<ManagedCodexTestError>([
        .failure(.failed("first-check")),
    ])

    #expect(throws: ManagedCodexTestError.failed("first-check")) {
        _ = try ManagedCodexLauncher().run(
            arguments: [
                "--coordinator-socket", "/tmp/blabee-managed-first.sock",
                "--",
            ],
            approvedExecutableProvider: provider.next
        )
    }
    #expect(provider.callCount == 1)
}

@Test("Managed launcher revalidates before TUI and cleans up App Server on failure")
func managedCodexLauncherRevalidatesBeforeTUIAndCleansUp() throws {
    let fixture = try managedCodexLauncherExecutableFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let provider = ManagedCodexExecutableSequence<CodexRuntimeTrustError>(
        [
            .success(fixture.executable),
            .failure(.approvalDrift),
        ],
        beforeOutcome: { call in
            guard call == 2 else { return }
            let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
            while !FileManager.default.fileExists(atPath: fixture.pidFile.path),
                  DispatchTime.now().uptimeNanoseconds < deadline
            {
                usleep(10_000)
            }
        }
    )

    #expect(throws: CodexRuntimeTrustError.approvalDrift) {
        _ = try ManagedCodexLauncher().run(
            arguments: [
                "--coordinator-socket", "/tmp/blabee-managed-second.sock",
                "--",
            ],
            environment: [
                "BLABEE_TEST_MARKER_FILE": fixture.markerFile.path,
                "BLABEE_TEST_PID_FILE": fixture.pidFile.path,
            ],
            approvedExecutableProvider: provider.next
        )
    }

    #expect(provider.callCount == 2)
    let marker = try String(contentsOf: fixture.markerFile, encoding: .utf8)
    #expect(marker == "app-server\n")
    let pidText = try String(contentsOf: fixture.pidFile, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let pid = try #require(pid_t(pidText))
    let killResult = kill(pid, 0)
    let killError = errno
    #expect(killResult == -1)
    #expect(killError == ESRCH)
}

@Test("Managed launcher accepts and reaps an isolated auxiliary App Server")
func managedCodexAuxiliaryConnectionRoundTripAndCleanup() throws {
    let fixture = try managedCodexAuxiliaryExecutableFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let token = "auxiliary-token"
    let listener = try ManagedCodexWebSocketListener(expectedToken: token)
    let primaryClient = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(primaryClient) }
    try managedCodexTestWrite(Data((
        "GET / HTTP/1.1\r\n"
            + "Host: 127.0.0.1:\(listener.port)\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            + "Sec-WebSocket-Version: 13\r\n"
            + "Authorization: Bearer \(token)\r\n\r\n"
    ).utf8), descriptor: primaryClient)
    let primaryConnection = try listener.accept(timeoutMilliseconds: 1_000)
    defer { primaryConnection.close() }
    _ = try managedCodexTestReadHeaders(descriptor: primaryClient)
    let admission = ManagedCodexListenerAdmission(listener: listener)
    let provider = ManagedCodexExecutableSequence<ManagedCodexTestError>([
        .success(fixture.executable),
        .success(fixture.executable),
    ])

    let broker = ManagedCodexAuxiliaryConnectionBroker(
        admission: admission,
        executable: fixture.executable,
        environment: [
            "BLABEE_TEST_PID_FILE": fixture.pidFile.path,
        ],
        coordinatorSocketPath: "/tmp/blabee-managed-auxiliary.sock",
        brokerEpoch: "epoch-auxiliary-test",
        approvedExecutableProvider: provider.next
    )
    broker.start()
    defer { broker.stopAndWait() }

    let auxiliaryClient = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(auxiliaryClient) }
    try managedCodexTestWrite(Data((
        "GET / HTTP/1.1\r\n"
            + "Host: 127.0.0.1:\(listener.port)\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==\r\n"
            + "Sec-WebSocket-Version: 13\r\n"
            + "Authorization: Bearer \(token)\r\n\r\n"
    ).utf8), descriptor: auxiliaryClient)
    let handshake = try managedCodexTestReadHeaders(descriptor: auxiliaryClient)
    #expect(String(data: handshake, encoding: .utf8)?.hasPrefix(
        "HTTP/1.1 101 Switching Protocols"
    ) == true)

    let request = Data(
        #"{"id":7,"method":"thread/list","params":{}}"#.utf8
    )
    try managedCodexTestWrite(
        managedCodexClientFrame(opcode: 0x1, payload: request),
        descriptor: auxiliaryClient
    )
    #expect(
        try managedCodexTestReadServerText(descriptor: auxiliaryClient)
            == request
    )
    #expect(provider.callCount == 2)

    let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
    while !FileManager.default.fileExists(atPath: fixture.pidFile.path),
          DispatchTime.now().uptimeNanoseconds < deadline
    {
        usleep(10_000)
    }
    let pidText = try String(contentsOf: fixture.pidFile, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let pid = try #require(pid_t(pidText))

    broker.stopAndWait()
    let killResult = kill(pid, 0)
    let killError = errno
    #expect(killResult == -1)
    #expect(killError == ESRCH)
}

@Test("Managed auxiliary admission survives a disconnected handshake peer")
func managedCodexAuxiliaryAdmissionSurvivesHandshakeResponseFailure() throws {
    let fixture = try managedCodexAuxiliaryExecutableFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let token = "auxiliary-retry-token"
    let listener = try ManagedCodexWebSocketListener(expectedToken: token)
    let admission = ManagedCodexListenerAdmission(listener: listener)
    let broker = ManagedCodexAuxiliaryConnectionBroker(
        admission: admission,
        executable: fixture.executable,
        environment: ["BLABEE_TEST_PID_FILE": fixture.pidFile.path],
        coordinatorSocketPath: "/tmp/blabee-managed-auxiliary-retry.sock",
        brokerEpoch: "epoch-auxiliary-retry"
    )
    broker.start()
    defer { broker.stopAndWait() }

    let disconnectedClient = try managedCodexConnectClient(port: listener.port)
    try managedCodexTestWrite(
        managedCodexTestHandshakeRequest(
            port: listener.port,
            token: token,
            key: "dGhlIHNhbXBsZSBub25jZQ=="
        ),
        descriptor: disconnectedClient
    )
    var reset = linger(l_onoff: 1, l_linger: 0)
    _ = setsockopt(
        disconnectedClient,
        SOL_SOCKET,
        SO_LINGER,
        &reset,
        socklen_t(MemoryLayout<linger>.size)
    )
    Darwin.close(disconnectedClient)
    usleep(25_000)

    let healthyClient = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(healthyClient) }
    try managedCodexTestWrite(
        managedCodexTestHandshakeRequest(
            port: listener.port,
            token: token,
            key: "x3JJHMbDL1EzLkh9GBhXDw=="
        ),
        descriptor: healthyClient
    )
    _ = try managedCodexTestReadHeaders(descriptor: healthyClient)
    let request = Data(
        #"{"id":8,"method":"thread/list","params":{}}"#.utf8
    )
    try managedCodexTestWrite(
        managedCodexClientFrame(opcode: 0x1, payload: request),
        descriptor: healthyClient
    )
    #expect(
        try managedCodexTestReadServerText(descriptor: healthyClient)
            == request
    )
}

@Test("Managed auxiliary stop safely interrupts an in-flight accept")
func managedCodexAuxiliaryStopInterruptsAccept() throws {
    let listener = try ManagedCodexWebSocketListener(
        expectedToken: "auxiliary-stop-token"
    )
    let admission = ManagedCodexListenerAdmission(listener: listener)
    let broker = ManagedCodexAuxiliaryConnectionBroker(
        admission: admission,
        executable: URL(fileURLWithPath: "/usr/bin/false"),
        environment: [:],
        coordinatorSocketPath: "/tmp/blabee-managed-auxiliary-stop.sock",
        brokerEpoch: "epoch-auxiliary-stop"
    )
    broker.start()
    usleep(25_000)

    let stopped = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async {
        broker.stopAndWait()
        stopped.signal()
    }
    #expect(stopped.wait(timeout: .now() + .seconds(1)) == .success)
}

@Test("Managed initial primary admission shutdown interrupts accept safely")
func managedCodexInitialAdmissionShutdownInterruptsAccept() throws {
    let listener = try ManagedCodexWebSocketListener(
        expectedToken: "primary-stop-token"
    )
    let admission = ManagedCodexListenerAdmission(listener: listener)
    let finished = DispatchSemaphore(value: 0)
    let result = ManagedCodexBridgeTestResult()
    DispatchQueue.global(qos: .userInitiated).async {
        defer { finished.signal() }
        do {
            let connection = try admission.accept(
                timeoutMilliseconds: 15_000,
                handshakeTimeoutMilliseconds: 500
            )
            connection.close()
        } catch {
            result.record(error)
        }
    }
    usleep(25_000)

    let started = DispatchTime.now().uptimeNanoseconds
    admission.stop()
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000
    #expect(finished.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(result.error != nil)
    #expect(elapsedMilliseconds < 1_000)
}

@Test("Managed admission shutdown is bounded by a slow handshake and full backlog")
func managedCodexAdmissionShutdownWithFullBacklogIsBounded() throws {
    let listener = try ManagedCodexWebSocketListener(
        expectedToken: "backlog-stop-token"
    )
    let admission = ManagedCodexListenerAdmission(listener: listener)
    let slowClient = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(slowClient) }
    let finished = DispatchSemaphore(value: 0)
    let result = ManagedCodexBridgeTestResult()
    DispatchQueue.global(qos: .userInitiated).async {
        defer { finished.signal() }
        do {
            let connection = try admission.accept(
                timeoutMilliseconds: 15_000,
                handshakeTimeoutMilliseconds: 500
            )
            connection.close()
        } catch {
            result.record(error)
        }
    }
    try managedCodexTestWrite(Data("G".utf8), descriptor: slowClient)
    usleep(50_000)

    // The first client is held in the active handshake while this connection
    // occupies the listener's one-entry backlog.
    let backlogClient = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(backlogClient) }
    let started = DispatchTime.now().uptimeNanoseconds
    admission.stop()
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000

    #expect(finished.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(result.error != nil)
    #expect(elapsedMilliseconds < 1_000)
}

@Test("Managed launcher propagates the resolved coordinator socket to both children")
func managedCodexLauncherPropagatesCoordinatorSocket() {
    let inherited = [
        "BLABEE_SOCKET": "/tmp/stale.sock",
        "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
    ]
    let appServer = ManagedCodexLauncher.childEnvironment(
        inherited,
        authenticationToken: nil,
        coordinatorSocketPath: "/tmp/explicit.sock"
    )
    let tui = ManagedCodexLauncher.childEnvironment(
        inherited,
        authenticationToken: "fresh-token",
        coordinatorSocketPath: "/tmp/explicit.sock"
    )
    #expect(appServer["BLABEE_SOCKET"] == "/tmp/explicit.sock")
    #expect(tui["BLABEE_SOCKET"] == "/tmp/explicit.sock")
    #expect(appServer["BLABEE_MANAGED_APPROVALS"] == "1")
    #expect(tui["BLABEE_MANAGED_APPROVALS"] == "1")
    #expect(appServer["BLABEE_MANAGED_CODEX_AUTH_TOKEN"] == nil)
    #expect(tui["BLABEE_MANAGED_CODEX_AUTH_TOKEN"] == "fresh-token")
}

@Test("Managed WebSocket write applies one whole-message monotonic deadline")
func managedCodexWebSocketWriteDeadlineBoundsAStalledPeer() throws {
    var descriptors = [Int32](repeating: -1, count: 2)
    #expect(socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0)
    guard descriptors.allSatisfy({ $0 >= 0 }) else { return }
    defer {
        Darwin.close(descriptors[0])
        Darwin.close(descriptors[1])
    }
    var smallBuffer: Int32 = 1_024
    _ = setsockopt(
        descriptors[0],
        SOL_SOCKET,
        SO_SNDBUF,
        &smallBuffer,
        socklen_t(MemoryLayout<Int32>.size)
    )
    let started = DispatchTime.now().uptimeNanoseconds
    #expect(throws: ManagedCodexWebSocketError.writeTimedOut) {
        try managedCodexWriteAll(
            Data(repeating: 0x61, count: 1_048_576),
            descriptor: descriptors[0],
            timeoutMilliseconds: 100
        )
    }
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000
    #expect(elapsedMilliseconds >= 80)
    #expect(elapsedMilliseconds < 300)
    _ = shutdown(descriptors[0], SHUT_RDWR)
    _ = shutdown(descriptors[1], SHUT_RDWR)
}

@Test("Managed App Server delivery is acknowledged once after response bytes are written")
func managedCodexAppServerDeliveryAckFollowsWrite() throws {
    let decider = ManagedCodexDeliveryTrackingDecider(
        [ManagedCodexApprovalSelection(
            decision: .allowOnce,
            deliveryToken: "delivery_app_server_1"
        )],
        blockAcknowledgement: true
    )
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer {
        decider.acknowledgementRelease.signal()
        harness.close()
    }
    harness.start()
    try harness.sendFromAppServer(
        try managedCodexApprovalData(id: "delivery-app-server")
    )

    #expect(
        decider.acknowledgementStarted.wait(timeout: .now() + .seconds(1))
            == .success
    )
    var readable = pollfd(
        fd: harness.appServerResponseDescriptor,
        events: Int16(POLLIN),
        revents: 0
    )
    #expect(Darwin.poll(&readable, 1, 0) == 1)
    let response = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    #expect(try managedCodexResponseID(response) == "delivery-app-server")
    let acknowledgements = decider.acknowledgements
    #expect(acknowledgements.count == 1)
    #expect(acknowledgements.first?.token == "delivery_app_server_1")
    #expect(acknowledgements.first?.context.brokerEpoch == "epoch-harness")
    #expect(acknowledgements.first?.context.connectionID.isEmpty == false)
    #expect(
        acknowledgements.first?.request.requestID
            == .string("delivery-app-server")
    )
}

@Test("Managed Codex delivery is acknowledged once after the exact request is sent")
func managedCodexDirectDeliveryAckFollowsWrite() throws {
    let decider = ManagedCodexDeliveryTrackingDecider(
        [ManagedCodexApprovalSelection(
            decision: .decideInCodex,
            deliveryToken: "delivery_codex_1"
        )],
        blockAcknowledgement: true
    )
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer {
        decider.acknowledgementRelease.signal()
        harness.close()
    }
    harness.start()
    let request = try managedCodexApprovalData(id: "delivery-codex")
    try harness.sendFromAppServer(request)

    #expect(
        decider.acknowledgementStarted.wait(timeout: .now() + .seconds(1))
            == .success
    )
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == request)
    #expect(decider.acknowledgements.count == 1)
    #expect(decider.acknowledgements.first?.token == "delivery_codex_1")
}

@Test("Managed delivery write failure sends no success acknowledgement")
func managedCodexFailedWriteDoesNotAckDelivery() throws {
    let decider = ManagedCodexDeliveryTrackingDecider([
        ManagedCodexApprovalSelection(
            decision: .allowOnce,
            deliveryToken: "delivery_failed_write_1"
        ),
    ])
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    harness.closeAppServerResponseReader()
    try harness.sendFromAppServer(
        try managedCodexApprovalData(id: "delivery-write-failure")
    )

    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.acknowledgements.isEmpty)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_app_server_closed"
    ))
}

@Test("Native-only approval forwarding never creates a delivery acknowledgement")
func managedCodexNativeOnlyApprovalDoesNotAckDelivery() throws {
    let decider = ManagedCodexDeliveryTrackingDecider([
        ManagedCodexApprovalSelection(
            decision: .allowOnce,
            deliveryToken: "delivery_must_not_be_used"
        ),
    ])
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let unsupported = try managedCodexApprovalData(
        id: "delivery-native-only",
        hasHiddenPermissions: true
    )
    try harness.sendFromAppServer(unsupported)

    #expect(
        try managedCodexTestReadServerText(descriptor: harness.client)
            == unsupported
    )
    #expect(decider.acknowledgements.isEmpty)
}

@Test("Delivery acknowledgement failure does not stop a healthy Codex bridge")
func managedCodexDeliveryAckFailureKeepsBridgeAlive() throws {
    let decider = ManagedCodexDeliveryTrackingDecider(
        [ManagedCodexApprovalSelection(
            decision: .allowOnce,
            deliveryToken: "delivery_ack_failure_1"
        )],
        acknowledgementFailure: .failed("ack")
    )
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    try harness.sendFromAppServer(
        try managedCodexApprovalData(id: "delivery-ack-failure")
    )
    _ = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    #expect(
        decider.acknowledgementStarted.wait(timeout: .now() + .seconds(1))
            == .success
    )

    let notification = Data(
        #"{"method":"thread/started","params":{"threadId":"still-live"}}"#.utf8
    )
    try harness.sendFromAppServer(notification)
    #expect(
        try managedCodexTestReadServerText(descriptor: harness.client)
            == notification
    )
    #expect(decider.acknowledgements.count == 1)
    #expect(harness.result.error == nil)
}

@Test("Managed approval admission fails open immediately when the bounded backlog is full")
func managedCodexApprovalAdmissionIsBounded() throws {
    let decider = ManagedCodexBlockingDecider()
    let harness = try ManagedCodexBridgeHarness(
        decider: decider,
        maximumPendingApprovals: 2
    )
    defer { harness.close() }
    harness.start()

    let first = try managedCodexApprovalData(id: "bounded-1")
    let second = try managedCodexApprovalData(id: "bounded-2")
    let overflow = try managedCodexApprovalData(id: "bounded-3")
    try harness.sendFromAppServer(first)
    #expect(decider.started.wait(timeout: .now() + .seconds(1)) == .success)
    try harness.sendFromAppServer(second)
    try harness.sendFromAppServer(overflow)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == overflow)

    decider.release(2)
    let firstResponse = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    let secondResponse = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    #expect(try managedCodexResponseID(firstResponse) == "bounded-1")
    #expect(try managedCodexResponseID(secondResponse) == "bounded-2")
    #expect(decider.callCount == 2)
}

@Test("Managed approval deadline includes time spent waiting in the serial queue")
func managedCodexApprovalDeadlineStartsAtArrival() throws {
    let decider = ManagedCodexBlockingDecider()
    let harness = try ManagedCodexBridgeHarness(
        decider: decider,
        maximumPendingApprovals: 2,
        approvalWaitNanoseconds: 100_000_000
    )
    defer { harness.close() }
    harness.start()
    let first = try managedCodexApprovalData(id: "deadline-1")
    let second = try managedCodexApprovalData(id: "deadline-2")
    let started = DispatchTime.now().uptimeNanoseconds
    try harness.sendFromAppServer(first)
    #expect(decider.started.wait(timeout: .now() + .seconds(1)) == .success)
    try harness.sendFromAppServer(second)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == first)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == second)
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000
    #expect(elapsedMilliseconds < 300)
}

@Test("Managed approval that resolves after its deadline returns to native Codex")
func managedCodexLateAllowFallsBackToNativeCodex() throws {
    let harness = try ManagedCodexBridgeHarness(
        decider: ManagedCodexLateAllowDecider(delaySeconds: 0.15),
        approvalWaitNanoseconds: 50_000_000
    )
    defer { harness.close() }
    harness.start()
    let request = try managedCodexApprovalData(id: "late-allow")

    try harness.sendFromAppServer(request)

    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == request)
}

@Test("Managed bridge terminates a connection on duplicate approval request IDs")
func managedCodexDuplicateApprovalIDIsNotRoutedTwice() throws {
    let decider = ManagedCodexBlockingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let request = try managedCodexApprovalData(id: "duplicate-id")
    try harness.sendFromAppServer(request)
    #expect(decider.started.wait(timeout: .now() + .seconds(1)) == .success)
    try harness.sendFromAppServer(request)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 1)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Managed approval identity cap permanently falls back to the native TUI")
func managedCodexApprovalIdentityCapDisablesInterceptionWithoutDisconnect() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(
        decider: decider,
        maximumSeenApprovalRequestIDs: 2
    )
    defer { harness.close() }
    harness.start()

    for identifier in ["identity-1", "identity-2"] {
        try harness.sendFromAppServer(try managedCodexApprovalData(id: identifier))
        let response = try managedCodexTestReadLine(
            descriptor: harness.appServerResponseDescriptor
        )
        #expect(try managedCodexResponseID(response) == identifier)
    }
    let capRequest = try managedCodexApprovalData(id: "identity-3")
    let laterRequest = try managedCodexApprovalData(id: "identity-4")
    try harness.sendFromAppServer(capRequest)
    try harness.sendFromAppServer(laterRequest)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == capRequest)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == laterRequest)
    #expect(decider.callCount == 2)
    #expect(harness.result.error == nil)

    // IDs that were already intercepted remain exact-once even after the
    // one-way native-only latch; they must not be surfaced a second time.
    try harness.sendFromAppServer(try managedCodexApprovalData(id: "identity-1"))
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 2)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Managed approval ID cannot bypass exact-once by changing to hidden permissions")
func managedCodexSupportedThenUnsupportedDuplicateIsClosed() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let supported = try managedCodexApprovalData(id: "shape-change-1")
    let unsupported = try managedCodexApprovalData(
        id: "shape-change-1",
        hasHiddenPermissions: true
    )
    try harness.sendFromAppServer(supported)
    _ = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    try harness.sendFromAppServer(unsupported)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 1)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Native-only approval ID cannot later become a managed approval")
func managedCodexUnsupportedThenSupportedDuplicateIsClosed() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let unsupported = try managedCodexApprovalData(
        id: "shape-change-2",
        hasHiddenPermissions: true
    )
    let supported = try managedCodexApprovalData(id: "shape-change-2")
    try harness.sendFromAppServer(unsupported)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == unsupported)
    try harness.sendFromAppServer(supported)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 0)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Large native-only approval ID cannot later become a managed approval")
func managedCodexLargeUnsupportedThenSmallSupportedDuplicateIsClosed() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let large = try managedCodexApprovalData(
        id: "large-shape-change-1",
        futureMetadataBytes: 300_000
    )
    let small = try managedCodexApprovalData(id: "large-shape-change-1")
    try harness.sendFromAppServer(large)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == large)
    try harness.sendFromAppServer(small)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 0)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Managed approval ID cannot bypass exact-once with a large later envelope")
func managedCodexSmallSupportedThenLargeUnsupportedDuplicateIsClosed() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let small = try managedCodexApprovalData(id: "large-shape-change-2")
    let large = try managedCodexApprovalData(
        id: "large-shape-change-2",
        futureMetadataBytes: 300_000
    )
    try harness.sendFromAppServer(small)
    _ = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    try harness.sendFromAppServer(large)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 1)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Deep native-only approval ID cannot later become a managed approval")
func managedCodexDeepUnsupportedThenShallowSupportedDuplicateIsClosed() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let deep = try managedCodexApprovalData(
        id: "deep-shape-change-1",
        futureMetadataDepth: 30
    )
    let shallow = try managedCodexApprovalData(id: "deep-shape-change-1")
    try harness.sendFromAppServer(deep)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == deep)
    try harness.sendFromAppServer(shallow)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 0)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Managed approval ID cannot bypass exact-once with a deep later envelope")
func managedCodexShallowSupportedThenDeepUnsupportedDuplicateIsClosed() throws {
    let decider = ManagedCodexCountingDecider()
    let harness = try ManagedCodexBridgeHarness(decider: decider)
    defer { harness.close() }
    harness.start()
    let shallow = try managedCodexApprovalData(id: "deep-shape-change-2")
    let deep = try managedCodexApprovalData(
        id: "deep-shape-change-2",
        futureMetadataDepth: 30
    )
    try harness.sendFromAppServer(shallow)
    _ = try managedCodexTestReadLine(
        descriptor: harness.appServerResponseDescriptor
    )
    try harness.sendFromAppServer(deep)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(decider.callCount == 1)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_duplicate_approval_request"
    ))
}

@Test("Managed app-server pipe closure becomes a broker error instead of SIGPIPE")
func managedCodexAppServerPipeClosureDoesNotTerminateTheProcess() throws {
    let harness = try ManagedCodexBridgeHarness(
        decider: ManagedCodexCountingDecider()
    )
    defer { harness.close() }
    harness.start()
    harness.closeAppServerResponseReader()
    try harness.sendFromTUI(Data(#"{"id":1}"#.utf8))
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
    #expect(String(describing: harness.result.error).contains(
        "managed_codex_app_server_closed"
    ))
}

@Test("Stopping the managed bridge closes its in-flight coordinator UDS peer")
func managedCodexBridgeStopCancelsCoordinatorRequest() throws {
    let server = try ManagedCodexFakeCoordinatorServer()
    defer { server.close() }
    let client = try ManagedCodexApprovalCoordinatorClient(
        socketPath: server.socketPath,
        connectTimeoutMilliseconds: 1_000,
        responseTimeoutMilliseconds: 5_000
    )
    let harness = try ManagedCodexBridgeHarness(decider: client)
    defer { harness.close() }
    harness.start()
    try harness.sendFromAppServer(
        try managedCodexApprovalData(id: "stop-cancels-uds")
    )
    #expect(server.receivedRequest.wait(timeout: .now() + .seconds(1)) == .success)
    harness.stopBridge()
    #expect(server.peerClosed.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(harness.finished.wait(timeout: .now() + .seconds(2)) == .success)
}

@Test("Managed bridge explains active-writer resume without changing transport bytes")
func managedCodexBridgeObservesResumeConflictTransparently() throws {
    let recorder = ManagedCodexResumeObserverRecorder()
    let harness = try ManagedCodexBridgeHarness(
        decider: ManagedCodexFakeDecider(result: .success(.decideInCodex)),
        resumeConflictReporter: recorder.record
    )
    defer { harness.close() }
    harness.start()

    let request = Data(
        #"{ "id" : 41, "method" : "thread/resume", "params" : { "threadId" : "01a01ece-22b8-7833-9ebf-8ef8d1addc58" } }"#.utf8
    )
    try harness.sendFromTUI(request)
    #expect(
        try managedCodexTestReadLine(
            descriptor: harness.appServerResponseDescriptor
        ) == request
    )

    let response = Data(
        #"{"id":41,"error":{"code":-32600,"message":"thread 01a01ece-22b8-7833-9ebf-8ef8d1addc58 already has an active writer"}}"#.utf8
    )
    try harness.sendFromAppServer(response)
    #expect(try managedCodexTestReadServerText(descriptor: harness.client) == response)
    #expect(recorder.eventReceived.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(recorder.events == [.activeWriter])

    let laterRequest = Data(
        #"{"id":42,"method":"thread/list","params":{}}"#.utf8
    )
    try harness.sendFromTUI(laterRequest)
    #expect(
        try managedCodexTestReadLine(
            descriptor: harness.appServerResponseDescriptor
        ) == laterRequest
    )
    let laterResponse = Data(#"{"id":42,"result":{"data":[]}}"#.utf8)
    try harness.sendFromAppServer(laterResponse)
    #expect(
        try managedCodexTestReadServerText(descriptor: harness.client)
            == laterResponse
    )
    #expect(recorder.events == [.activeWriter])
    #expect(harness.result.error == nil)
}

@Test("Managed bridge performs authenticated socket and pipe round trips then stops")
func managedCodexBridgeSocketPipeRoundTrip() throws {
    let token = "integration-token"
    let listener = try ManagedCodexWebSocketListener(expectedToken: token)
    defer { listener.close() }
    let client = try managedCodexConnectClient(port: listener.port)
    defer { Darwin.close(client) }
    try managedCodexTestWrite(Data((
        "GET / HTTP/1.1\r\n"
            + "Host: 127.0.0.1:\(listener.port)\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            + "Sec-WebSocket-Version: 13\r\n"
            + "Authorization: Bearer \(token)\r\n\r\n"
    ).utf8), descriptor: client)
    let connection = try listener.accept(timeoutMilliseconds: 1_000)
    let handshake = try managedCodexTestReadHeaders(descriptor: client)
    #expect(String(data: handshake, encoding: .utf8)?.hasPrefix(
        "HTTP/1.1 101 Switching Protocols"
    ) == true)

    let appServerOutput = Pipe()
    let appServerInput = Pipe()
    let bridge = try ManagedCodexAppServerBridge(
        connection: connection,
        appServerOutput: appServerOutput.fileHandleForReading,
        appServerInput: appServerInput.fileHandleForWriting,
        approvalRouter: ManagedCodexApprovalRouter(
            decider: ManagedCodexSequenceDecider([
                .allowOnce,
                .deny,
                .decideInCodex,
            ])
        ),
        brokerEpoch: "epoch-integration"
    )
    let finished = DispatchSemaphore(value: 0)
    let result = ManagedCodexBridgeTestResult()
    let tuiMessage = Data(#"{"id":1,"method":"thread/list","params":{}}"#.utf8)
    try managedCodexTestWrite(
        managedCodexClientFrame(opcode: 0x1, payload: tuiMessage),
        descriptor: client
    )
    DispatchQueue.global(qos: .userInitiated).async {
        defer { finished.signal() }
        do { try bridge.run() }
        catch { result.record(error) }
    }

    #expect(try managedCodexTestReadLine(
        descriptor: appServerInput.fileHandleForReading.fileDescriptor
    ) == tuiMessage)

    let notification = Data(#"{"method":"thread/started","params":{"threadId":"t"}}"#.utf8)
    #expect(throws: (any Error).self) {
        _ = try CodexAppServerApprovalAdapter.parse(notification)
    }
    try appServerOutput.fileHandleForWriting.write(contentsOf: notification + Data([0x0A]))
    #expect(try managedCodexTestReadServerText(descriptor: client) == notification)

    let allowRequest = try managedCodexApprovalData(
        id: "allow-request",
        kind: "command"
    )
    try appServerOutput.fileHandleForWriting.write(contentsOf: allowRequest + Data([0x0A]))
    let allowResponse = try managedCodexTestReadLine(
        descriptor: appServerInput.fileHandleForReading.fileDescriptor
    )
    let allowObject = try #require(
        JSONSerialization.jsonObject(with: allowResponse) as? [String: Any]
    )
    let allowResult = try #require(allowObject["result"] as? [String: Any])
    #expect(allowResult["decision"] as? String == "accept")

    let denyRequest = try managedCodexApprovalData(id: "deny-request")
    try appServerOutput.fileHandleForWriting.write(contentsOf: denyRequest + Data([0x0A]))
    let denyResponse = try managedCodexTestReadLine(
        descriptor: appServerInput.fileHandleForReading.fileDescriptor
    )
    let denyObject = try #require(
        JSONSerialization.jsonObject(with: denyResponse) as? [String: Any]
    )
    let denyResult = try #require(denyObject["result"] as? [String: Any])
    #expect(denyResult["decision"] as? String == "decline")

    let directRequest = try managedCodexApprovalData(id: "direct-request")
    try appServerOutput.fileHandleForWriting.write(contentsOf: directRequest + Data([0x0A]))
    #expect(try managedCodexTestReadServerText(descriptor: client) == directRequest)

    bridge.stop()
    if finished.wait(timeout: .now() + .seconds(2)) != .success {
        // Cleanup prevents a failed assertion from leaving a test worker behind;
        // success still specifically requires stop() to close the blocked reader.
        try? appServerOutput.fileHandleForWriting.close()
        _ = finished.wait(timeout: .now() + .seconds(1))
        Issue.record("bridge.stop() did not release both blocking read loops")
    }
    #expect(result.error == nil)
}

private struct ManagedCodexLauncherExecutableFixture {
    let directory: URL
    let executable: URL
    let markerFile: URL
    let pidFile: URL
}

private struct ManagedCodexAuxiliaryExecutableFixture {
    let directory: URL
    let executable: URL
    let pidFile: URL
}

private func managedCodexAuxiliaryExecutableFixture(
) throws -> ManagedCodexAuxiliaryExecutableFixture {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(
            "blabee-managed-auxiliary-\(UUID().uuidString.lowercased())",
            isDirectory: true
        )
    try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: false
    )
    let executable = directory.appendingPathComponent(
        "fake-codex",
        isDirectory: false
    )
    let pidFile = directory.appendingPathComponent(
        "app-server.pid",
        isDirectory: false
    )
    let script = #"""
    #!/bin/sh
    if [ "$1" = "app-server" ]; then
      printf '%s\n' "$$" > "$BLABEE_TEST_PID_FILE"
      trap 'exit 0' TERM INT
      while IFS= read -r line; do
        printf '%s\n' "$line"
      done
      exit 0
    fi
    exit 1
    """#
    try Data(script.utf8).write(to: executable, options: .atomic)
    try FileManager.default.setAttributes(
        [.posixPermissions: NSNumber(value: Int16(0o700))],
        ofItemAtPath: executable.path
    )
    return ManagedCodexAuxiliaryExecutableFixture(
        directory: directory,
        executable: executable,
        pidFile: pidFile
    )
}

private func managedCodexLauncherExecutableFixture(
) throws -> ManagedCodexLauncherExecutableFixture {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(
            "blabee-managed-launcher-\(UUID().uuidString.lowercased())",
            isDirectory: true
        )
    try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: false
    )
    let executable = directory.appendingPathComponent(
        "fake-codex",
        isDirectory: false
    )
    let markerFile = directory.appendingPathComponent(
        "children.log",
        isDirectory: false
    )
    let pidFile = directory.appendingPathComponent(
        "app-server.pid",
        isDirectory: false
    )
    let script = #"""
    #!/bin/sh
    if [ "$1" = "app-server" ]; then
      printf 'app-server\n' >> "$BLABEE_TEST_MARKER_FILE"
      printf '%s\n' "$$" > "$BLABEE_TEST_PID_FILE"
      trap 'exit 0' TERM INT
      while :; do /bin/sleep 1; done
    fi
    printf 'tui\n' >> "$BLABEE_TEST_MARKER_FILE"
    exit 0
    """#
    try Data(script.utf8).write(to: executable, options: .atomic)
    try FileManager.default.setAttributes(
        [.posixPermissions: NSNumber(value: Int16(0o700))],
        ofItemAtPath: executable.path
    )
    return ManagedCodexLauncherExecutableFixture(
        directory: directory,
        executable: executable,
        markerFile: markerFile,
        pidFile: pidFile
    )
}

private func managedCodexApprovalData(
    id: Any,
    approvalID: String? = "approval-1",
    kind: String? = nil,
    hasHiddenPermissions: Bool = false,
    futureMetadataBytes: Int = 0,
    futureMetadataDepth: Int = 0
) throws -> Data {
    var params: [String: Any] = [
        "threadId": "thread-1",
        "turnId": "turn-1",
        "itemId": "item-1",
        "environmentId": NSNull(),
        "startedAtMs": 1_762_000_000_000 as Int64,
        "command": "swift test",
        "cwd": "/tmp/blabee-managed",
        "availableDecisions": ["accept", "acceptForSession", "decline"],
    ]
    if let approvalID { params["approvalId"] = approvalID }
    if let kind { params["kind"] = kind }
    if hasHiddenPermissions {
        params["additionalPermissions"] = ["filesystem.read"]
    }
    if futureMetadataBytes > 0 {
        params["futureMetadata"] = String(
            repeating: "x",
            count: futureMetadataBytes
        )
    }
    if futureMetadataDepth > 0 {
        var nested: Any = "leaf"
        for _ in 0..<futureMetadataDepth { nested = [nested] }
        params["futureMetadata"] = nested
    }
    return try JSONSerialization.data(withJSONObject: [
        "jsonrpc": "2.0",
        "id": id,
        "method": CodexAppServerApprovalAdapter.commandApprovalMethod,
        "params": params,
    ], options: [.sortedKeys, .withoutEscapingSlashes])
}

private func managedCodexResponseID(_ data: Data) throws -> String {
    let object = try #require(
        JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    return try #require(object["id"] as? String)
}

private func managedCodexClientFrame(
    opcode: UInt8,
    payload: Data,
    fin: Bool = true
) -> Data {
    let mask: [UInt8] = [0x12, 0x34, 0x56, 0x78]
    precondition(payload.count <= ManagedCodexWebSocketFrameParser.maximumMessageBytes)
    var frame = Data([((fin ? 0x80 : 0) | opcode)])
    if payload.count <= 125 {
        frame.append(0x80 | UInt8(payload.count))
    } else if payload.count <= Int(UInt16.max) {
        frame.append(0x80 | 126)
        let length = UInt16(payload.count).bigEndian
        withUnsafeBytes(of: length) { frame.append(contentsOf: $0) }
    } else {
        frame.append(0x80 | 127)
        let length = UInt64(payload.count).bigEndian
        withUnsafeBytes(of: length) { frame.append(contentsOf: $0) }
    }
    frame.append(contentsOf: mask)
    frame.append(contentsOf: payload.enumerated().map { index, byte in
        byte ^ mask[index % 4]
    })
    return frame
}

private func managedCodexConnectClient(port: UInt16) throws -> Int32 {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw ManagedCodexTestError.failed("socket") }
    var noSigPipe: Int32 = 1
    _ = setsockopt(
        descriptor,
        SOL_SOCKET,
        SO_NOSIGPIPE,
        &noSigPipe,
        socklen_t(MemoryLayout<Int32>.size)
    )
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(
                descriptor,
                $0,
                socklen_t(MemoryLayout<sockaddr_in>.size)
            )
        }
    }
    guard result == 0 else {
        Darwin.close(descriptor)
        throw ManagedCodexTestError.failed("connect")
    }
    return descriptor
}

private func managedCodexTestWrite(_ data: Data, descriptor: Int32) throws {
    try data.withUnsafeBytes { rawBuffer in
        guard let base = rawBuffer.baseAddress else { return }
        var offset = 0
        while offset < rawBuffer.count {
            let count = Darwin.write(
                descriptor,
                base.advanced(by: offset),
                rawBuffer.count - offset
            )
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw ManagedCodexTestError.failed("write") }
            offset += count
        }
    }
}

private func managedCodexTestHandshakeRequest(
    port: UInt16,
    token: String,
    key: String
) -> Data {
    Data((
        "GET / HTTP/1.1\r\n"
            + "Host: 127.0.0.1:\(port)\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: \(key)\r\n"
            + "Sec-WebSocket-Version: 13\r\n"
            + "Authorization: Bearer \(token)\r\n\r\n"
    ).utf8)
}

private func managedCodexTestReadExact(
    count: Int,
    descriptor: Int32,
    timeoutMilliseconds: Int32 = 2_000
) throws -> Data {
    var result = Data()
    var bytes = [UInt8](repeating: 0, count: max(1, count))
    while result.count < count {
        var item = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        guard poll(&item, 1, timeoutMilliseconds) > 0 else {
            throw ManagedCodexTestError.failed("read timeout")
        }
        let requested = min(bytes.count, count - result.count)
        let readCount = bytes.withUnsafeMutableBytes { buffer in
            Darwin.read(descriptor, buffer.baseAddress, requested)
        }
        guard readCount > 0 else { throw ManagedCodexTestError.failed("read EOF") }
        result.append(contentsOf: bytes[0..<readCount])
    }
    return result
}

private func managedCodexTestReadHeaders(descriptor: Int32) throws -> Data {
    var result = Data()
    while result.count < 16_384 {
        result.append(try managedCodexTestReadExact(count: 1, descriptor: descriptor))
        if result.suffix(4) == Data([13, 10, 13, 10]) { return result }
    }
    throw ManagedCodexTestError.failed("headers too large")
}

private func managedCodexTestReadLine(descriptor: Int32) throws -> Data {
    var result = Data()
    while result.count < 1_048_576 {
        let byte = try managedCodexTestReadExact(count: 1, descriptor: descriptor)
        if byte == Data([0x0A]) { return result }
        result.append(byte)
    }
    throw ManagedCodexTestError.failed("line too large")
}

private func managedCodexTestReadServerText(descriptor: Int32) throws -> Data {
    let header = [UInt8](try managedCodexTestReadExact(count: 2, descriptor: descriptor))
    guard header[0] & 0x0F == 0x1, header[1] & 0x80 == 0 else {
        throw ManagedCodexTestError.failed("invalid server text frame")
    }
    var length = Int(header[1] & 0x7F)
    if length == 126 {
        let extended = [UInt8](try managedCodexTestReadExact(count: 2, descriptor: descriptor))
        length = Int(extended[0]) << 8 | Int(extended[1])
    } else if length == 127 {
        let extended = [UInt8](try managedCodexTestReadExact(count: 8, descriptor: descriptor))
        var value: UInt64 = 0
        for byte in extended { value = value << 8 | UInt64(byte) }
        guard value <= UInt64(Int.max) else {
            throw ManagedCodexTestError.failed("server text length")
        }
        length = Int(value)
    }
    return try managedCodexTestReadExact(count: length, descriptor: descriptor)
}

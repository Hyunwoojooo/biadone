import CoordinatorSwift
import Dispatch
import Foundation

enum ManagedCodexResumeConflictEvent: Sendable, Equatable {
    case activeWriter
}

private enum ManagedCodexResumeJSONRPCIdentity: Hashable {
    case string(String)
    case integer(Int64)

    init?(jsonValue: Any?) {
        if let value = jsonValue as? String {
            guard !value.isEmpty,
                  value.unicodeScalars.count <= 512,
                  !value.contains("\n"),
                  !value.contains("\r"),
                  value.precomposedStringWithCanonicalMapping.utf8
                    .elementsEqual(value.utf8)
            else { return nil }
            self = .string(value)
            return
        }
        guard let value = ExactJSONInteger.int64(jsonValue) else { return nil }
        self = .integer(value)
    }
}

private struct ManagedCodexResumeJSONRPCRequest {
    let identity: ManagedCodexResumeJSONRPCIdentity
    let method: String

    init?(_ data: Data) {
        guard let object = try? StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        ),
              object["result"] == nil,
              object["error"] == nil,
              let method = object["method"] as? String,
              method.unicodeScalars.count <= 128,
              let identity = ManagedCodexResumeJSONRPCIdentity(
                  jsonValue: object["id"]
              )
        else { return nil }
        if let version = object["jsonrpc"] {
            guard version as? String == "2.0" else { return nil }
        }
        self.identity = identity
        self.method = method
    }
}

private struct ManagedCodexResumeJSONRPCResponse {
    let identity: ManagedCodexResumeJSONRPCIdentity
    let event: ManagedCodexResumeConflictEvent?

    init?(_ data: Data) {
        guard let object = try? StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        ),
              object["method"] == nil,
              let identity = ManagedCodexResumeJSONRPCIdentity(
                  jsonValue: object["id"]
              )
        else { return nil }
        if let version = object["jsonrpc"] {
            guard version as? String == "2.0" else { return nil }
        }

        let hasResult = object.keys.contains("result")
        let hasError = object.keys.contains("error")
        guard hasResult != hasError else { return nil }

        self.identity = identity
        if hasError,
           let error = object["error"] as? [String: Any],
           ExactJSONInteger.int64(error["code"]) == -32600,
           let message = error["message"] as? String,
           Self.isCanonicalActiveWriterMessage(message)
        {
            event = .activeWriter
        } else {
            event = nil
        }
    }

    private static func isCanonicalActiveWriterMessage(_ message: String) -> Bool {
        let prefix = "thread "
        let suffix = " already has an active writer"
        guard message.hasPrefix(prefix), message.hasSuffix(suffix) else {
            return false
        }
        let start = message.index(message.startIndex, offsetBy: prefix.count)
        let end = message.index(message.endIndex, offsetBy: -suffix.count)
        guard start <= end else { return false }
        let threadID = message[start..<end]
        let bytes = Array(threadID.utf8)
        guard bytes.count == 36 else { return false }
        let hyphenOffsets: Set<Int> = [8, 13, 18, 23]
        return bytes.enumerated().allSatisfy { offset, byte in
            if hyphenOffsets.contains(offset) { return byte == 0x2D }
            return (byte >= 0x30 && byte <= 0x39)
                || (byte >= 0x61 && byte <= 0x66)
        }
    }
}

/// Observes only enough JSON-RPC metadata to explain Codex's native
/// active-writer result. It never creates, replaces, retries, or suppresses a
/// Codex message.
final class ManagedCodexResumeConflictObserver: @unchecked Sendable {
    typealias Reporter = @Sendable (ManagedCodexResumeConflictEvent) -> Void

    private let lock = NSLock()
    private let maximumTrackedRequestIDs: Int
    private let reporter: Reporter
    private var pendingRequestIDs: Set<ManagedCodexResumeJSONRPCIdentity> = []
    private var ambiguousRequestIDs: Set<ManagedCodexResumeJSONRPCIdentity> = []

    init(
        maximumTrackedRequestIDs: Int = 32,
        reporter: @escaping Reporter = { _ in }
    ) {
        self.maximumTrackedRequestIDs = max(
            1,
            min(64, maximumTrackedRequestIDs)
        )
        self.reporter = reporter
    }

    /// Holds the observation lock across the official App Server write. An
    /// immediate response may already be forwarded to the TUI, but it cannot
    /// inspect correlation state until a successful request write is recorded.
    func forwardRequest(
        _ data: Data,
        using forward: () throws -> Void
    ) rethrows {
        guard let request = ManagedCodexResumeJSONRPCRequest(data) else {
            try forward()
            return
        }

        lock.lock()
        defer { lock.unlock() }
        try forward()

        if pendingRequestIDs.remove(request.identity) != nil {
            ambiguousRequestIDs.insert(request.identity)
            return
        }
        if ambiguousRequestIDs.contains(request.identity) { return }
        guard request.method == "thread/resume" else { return }
        guard pendingRequestIDs.count + ambiguousRequestIDs.count
            < maximumTrackedRequestIDs
        else {
            // Capacity limits observation only. The request has already been
            // forwarded byte-for-byte and remains wholly owned by Codex.
            return
        }
        pendingRequestIDs.insert(request.identity)
    }

    /// Call only after the original response bytes have been accepted by the
    /// TUI connection. Reporting is deliberately outside the lock and cannot
    /// affect transport success.
    func observeForwardedResponse(_ data: Data) {
        guard let response = ManagedCodexResumeJSONRPCResponse(data) else {
            return
        }

        lock.lock()
        if ambiguousRequestIDs.contains(response.identity) {
            // JSON-RPC does not provide enough information to prove which of
            // multiple outstanding requests this response completes. Keep a
            // reused ID quarantined for this bridge lifetime so a delayed old
            // response can never be correlated to a later resume request.
            lock.unlock()
            return
        }
        guard pendingRequestIDs.remove(response.identity) != nil else {
            lock.unlock()
            return
        }
        let event = response.event
        lock.unlock()

        if let event { reporter(event) }
    }
}

/// Emits at most one fixed, privacy-safe explanation for one managed Codex
/// launcher process. Output runs off the bridge queues and is best-effort.
final class ManagedCodexActiveWriterNoticeEmitter: @unchecked Sendable {
    typealias Sink = @Sendable (Data) -> Void

    private static let notice = Data((
        "\n[Blabee 안내] 다른 Codex 클라이언트가 이 세션을 사용 중입니다. "
            + "그 클라이언트에서 사용을 끝낸 뒤 다시 시도하세요. "
            + "Blabee는 세션이나 잠금을 변경하지 않았습니다.\n"
    ).utf8)

    private let lock = NSLock()
    private let queue = DispatchQueue(
        label: "com.biadone.blabee.managed-codex.active-writer-notice",
        qos: .utility
    )
    private let sink: Sink
    private var emitted = false

    init(
        sink: @escaping Sink = { data in
            try? FileHandle.standardError.write(contentsOf: data)
        }
    ) {
        self.sink = sink
    }

    func report(_ event: ManagedCodexResumeConflictEvent) {
        guard event == .activeWriter else { return }
        lock.lock()
        guard !emitted else {
            lock.unlock()
            return
        }
        emitted = true
        lock.unlock()

        let sink = sink
        let notice = Self.notice
        queue.async { sink(notice) }
    }
}

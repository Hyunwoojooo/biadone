import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

private enum ManagedCodexResumeObserverTestError: Error {
    case forwardingFailed
}

final class ManagedCodexResumeObserverRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storedEvents: [ManagedCodexResumeConflictEvent] = []
    private var storedNotices: [Data] = []
    let eventReceived = DispatchSemaphore(value: 0)
    let noticeReceived = DispatchSemaphore(value: 0)

    func record(_ event: ManagedCodexResumeConflictEvent) {
        lock.lock()
        storedEvents.append(event)
        lock.unlock()
        eventReceived.signal()
    }

    func recordNotice(_ data: Data) {
        lock.lock()
        storedNotices.append(data)
        lock.unlock()
        noticeReceived.signal()
    }

    var events: [ManagedCodexResumeConflictEvent] {
        lock.lock()
        defer { lock.unlock() }
        return storedEvents
    }

    var notices: [Data] {
        lock.lock()
        defer { lock.unlock() }
        return storedNotices
    }
}

private let managedCodexResumeThreadID =
    "01a01ece-22b8-7833-9ebf-8ef8d1addc58"

private func managedCodexResumeRequest(
    id: String,
    method: String = "thread/resume"
) -> Data {
    Data(
        #"{"id":\#(id),"method":"\#(method)","params":{"threadId":"\#(managedCodexResumeThreadID)"}}"#.utf8
    )
}

private func managedCodexActiveWriterResponse(
    id: String,
    code: Int = -32600,
    message: String? = nil
) -> Data {
    let resolvedMessage = message
        ?? "thread \(managedCodexResumeThreadID) already has an active writer"
    return Data(
        #"{"id":\#(id),"error":{"code":\#(code),"message":"\#(resolvedMessage)"}}"#.utf8
    )
}

@Test("Resume observer reports one exact active-writer response")
func managedCodexResumeObserverReportsCanonicalConflictOnce() throws {
    let recorder = ManagedCodexResumeObserverRecorder()
    let observer = ManagedCodexResumeConflictObserver(reporter: recorder.record)
    let request = managedCodexResumeRequest(id: "7")
    let response = managedCodexActiveWriterResponse(id: "7")
    var forwardedRequest = Data()

    observer.forwardRequest(request) { forwardedRequest = request }
    observer.observeForwardedResponse(response)
    observer.observeForwardedResponse(response)

    #expect(forwardedRequest == request)
    #expect(recorder.events == [.activeWriter])
}

@Test("Resume observer rejects uncorrelated and noncanonical responses")
func managedCodexResumeObserverRejectsFalseCorrelations() throws {
    let noRequestRecorder = ManagedCodexResumeObserverRecorder()
    ManagedCodexResumeConflictObserver(reporter: noRequestRecorder.record)
        .observeForwardedResponse(managedCodexActiveWriterResponse(id: "1"))
    #expect(noRequestRecorder.events.isEmpty)

    let unrelatedRecorder = ManagedCodexResumeObserverRecorder()
    let unrelated = ManagedCodexResumeConflictObserver(
        reporter: unrelatedRecorder.record
    )
    unrelated.forwardRequest(
        managedCodexResumeRequest(id: "1", method: "thread/list")
    ) {}
    unrelated.observeForwardedResponse(managedCodexActiveWriterResponse(id: "1"))
    #expect(unrelatedRecorder.events.isEmpty)

    let typedIDRecorder = ManagedCodexResumeObserverRecorder()
    let typedID = ManagedCodexResumeConflictObserver(reporter: typedIDRecorder.record)
    typedID.forwardRequest(managedCodexResumeRequest(id: #""1""#)) {}
    typedID.observeForwardedResponse(managedCodexActiveWriterResponse(id: "1"))
    #expect(typedIDRecorder.events.isEmpty)

    let wrongCodeRecorder = ManagedCodexResumeObserverRecorder()
    let wrongCode = ManagedCodexResumeConflictObserver(
        reporter: wrongCodeRecorder.record
    )
    wrongCode.forwardRequest(managedCodexResumeRequest(id: "2")) {}
    wrongCode.observeForwardedResponse(
        managedCodexActiveWriterResponse(id: "2", code: -32601)
    )
    #expect(wrongCodeRecorder.events.isEmpty)

    let wrongMessageRecorder = ManagedCodexResumeObserverRecorder()
    let wrongMessage = ManagedCodexResumeConflictObserver(
        reporter: wrongMessageRecorder.record
    )
    wrongMessage.forwardRequest(managedCodexResumeRequest(id: "3")) {}
    wrongMessage.observeForwardedResponse(
        managedCodexActiveWriterResponse(
            id: "3",
            message: "thread \(managedCodexResumeThreadID) already has an active writer."
        )
    )
    #expect(wrongMessageRecorder.events.isEmpty)

    let successRecorder = ManagedCodexResumeObserverRecorder()
    let success = ManagedCodexResumeConflictObserver(reporter: successRecorder.record)
    success.forwardRequest(managedCodexResumeRequest(id: "4")) {}
    success.observeForwardedResponse(Data(#"{"id":4,"result":{}}"#.utf8))
    success.observeForwardedResponse(managedCodexActiveWriterResponse(id: "4"))
    #expect(successRecorder.events.isEmpty)

    success.forwardRequest(managedCodexResumeRequest(id: "4")) {}
    success.observeForwardedResponse(managedCodexActiveWriterResponse(id: "4"))
    #expect(successRecorder.events == [.activeWriter])
}

@Test("Malformed and over-limit observer inputs remain exact pass-through")
func managedCodexResumeObserverIgnoresHostileInputs() {
    let recorder = ManagedCodexResumeObserverRecorder()
    let observer = ManagedCodexResumeConflictObserver(reporter: recorder.record)
    let malformed = Data(#"{"id":5,"method":"thread/resume""#.utf8)
    let duplicateKey = Data(
        #"{"id":6,"id":6,"method":"thread/resume","params":{}}"#.utf8
    )
    let invalidIDs = [
        Data(#"{"id":null,"method":"thread/resume","params":{}}"#.utf8),
        Data(#"{"id":true,"method":"thread/resume","params":{}}"#.utf8),
        Data(#"{"id":1.5,"method":"thread/resume","params":{}}"#.utf8),
        Data(#"{"id":9223372036854775808,"method":"thread/resume","params":{}}"#.utf8),
    ]
    let oversized = Data((
        #"{"id":7,"method":"thread/resume","params":{"padding":""#
            + String(repeating: "x", count: 1_048_576)
            + #""}}"#
    ).utf8)
    let deep = Data((
        #"{"id":8,"method":"thread/resume","params":{"value":"#
            + String(repeating: "[", count: 73)
            + "0"
            + String(repeating: "]", count: 73)
            + "}}"
    ).utf8)
    let inputs = [malformed, duplicateKey] + invalidIDs + [oversized, deep]
    var forwarded: [Data] = []

    for input in inputs {
        observer.forwardRequest(input) { forwarded.append(input) }
    }
    for id in [5, 6, 7, 8] {
        observer.observeForwardedResponse(
            managedCodexActiveWriterResponse(id: String(id))
        )
    }

    #expect(forwarded == inputs)
    #expect(recorder.events.isEmpty)
}

@Test("Resume observer fails silent for duplicate IDs and capacity overflow")
func managedCodexResumeObserverBoundsAmbiguousState() throws {
    let duplicateRecorder = ManagedCodexResumeObserverRecorder()
    let duplicate = ManagedCodexResumeConflictObserver(
        reporter: duplicateRecorder.record
    )
    duplicate.forwardRequest(managedCodexResumeRequest(id: "1")) {}
    duplicate.forwardRequest(
        managedCodexResumeRequest(id: "1", method: "thread/list")
    ) {}
    duplicate.observeForwardedResponse(managedCodexActiveWriterResponse(id: "1"))
    duplicate.forwardRequest(managedCodexResumeRequest(id: "1")) {}
    duplicate.observeForwardedResponse(managedCodexActiveWriterResponse(id: "1"))
    #expect(duplicateRecorder.events.isEmpty)

    let capacityRecorder = ManagedCodexResumeObserverRecorder()
    let capacity = ManagedCodexResumeConflictObserver(
        maximumTrackedRequestIDs: 1,
        reporter: capacityRecorder.record
    )
    capacity.forwardRequest(managedCodexResumeRequest(id: "1")) {}
    capacity.forwardRequest(managedCodexResumeRequest(id: "2")) {}
    capacity.observeForwardedResponse(managedCodexActiveWriterResponse(id: "2"))
    capacity.observeForwardedResponse(managedCodexActiveWriterResponse(id: "1"))
    #expect(capacityRecorder.events == [.activeWriter])
}

@Test("Resume observer handles an immediate response without racing correlation")
func managedCodexResumeObserverCorrelatesImmediateResponse() throws {
    let recorder = ManagedCodexResumeObserverRecorder()
    let observer = ManagedCodexResumeConflictObserver(reporter: recorder.record)
    let responseStarted = DispatchSemaphore(value: 0)
    let responseFinished = DispatchSemaphore(value: 0)

    observer.forwardRequest(managedCodexResumeRequest(id: "9")) {
        DispatchQueue.global(qos: .userInitiated).async {
            responseStarted.signal()
            observer.observeForwardedResponse(
                managedCodexActiveWriterResponse(id: "9")
            )
            responseFinished.signal()
        }
        #expect(responseStarted.wait(timeout: .now() + .seconds(1)) == .success)
    }

    #expect(responseFinished.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(recorder.events == [.activeWriter])
}

@Test("Failed request forwarding leaves no resumable correlation")
func managedCodexResumeObserverDoesNotTrackFailedForward() {
    let recorder = ManagedCodexResumeObserverRecorder()
    let observer = ManagedCodexResumeConflictObserver(reporter: recorder.record)

    #expect(throws: ManagedCodexResumeObserverTestError.forwardingFailed) {
        try observer.forwardRequest(managedCodexResumeRequest(id: "11")) {
            throw ManagedCodexResumeObserverTestError.forwardingFailed
        }
    }
    observer.observeForwardedResponse(managedCodexActiveWriterResponse(id: "11"))
    #expect(recorder.events.isEmpty)
}

@Test("Active-writer notice is one-shot and contains no session identity")
func managedCodexActiveWriterNoticeIsBoundedAndPrivate() {
    let recorder = ManagedCodexResumeObserverRecorder()
    let emitter = ManagedCodexActiveWriterNoticeEmitter(sink: recorder.recordNotice)

    emitter.report(.activeWriter)
    emitter.report(.activeWriter)

    #expect(recorder.noticeReceived.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(recorder.notices.count == 1)
    let notice = String(data: recorder.notices[0], encoding: .utf8)
    #expect(notice?.contains(managedCodexResumeThreadID) == false)
    #expect(notice?.contains("Blabee는 세션이나 잠금을 변경하지 않았습니다.") == true)
}

@Test("A blocked notice sink never blocks the Codex transport caller")
func managedCodexActiveWriterNoticeRunsOffTransportQueue() {
    let sinkStarted = DispatchSemaphore(value: 0)
    let releaseSink = DispatchSemaphore(value: 0)
    let reportReturned = DispatchSemaphore(value: 0)
    let emitter = ManagedCodexActiveWriterNoticeEmitter { _ in
        sinkStarted.signal()
        _ = releaseSink.wait(timeout: .now() + .seconds(1))
    }

    DispatchQueue.global(qos: .userInitiated).async {
        emitter.report(.activeWriter)
        reportReturned.signal()
    }

    #expect(reportReturned.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(sinkStarted.wait(timeout: .now() + .seconds(1)) == .success)
    releaseSink.signal()
}

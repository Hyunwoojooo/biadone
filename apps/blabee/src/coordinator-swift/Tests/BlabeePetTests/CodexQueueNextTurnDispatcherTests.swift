import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let queueSessionID = "01a01ece-22b8-7833-9ebf-8ef8d1addc58"
private let queueSubmissionID = "019d0000-1111-7222-8333-444455556666"

private final class QueueInvocationRecorder: @unchecked Sendable {
    struct Invocation: Equatable {
        let executable: URL
        let arguments: [String]
        let timeoutMilliseconds: Int
    }

    private let lock = NSLock()
    private var storedInvocation: Invocation?

    func record(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) {
        lock.lock()
        storedInvocation = Invocation(
            executable: executable,
            arguments: arguments,
            timeoutMilliseconds: timeoutMilliseconds
        )
        lock.unlock()
    }

    var invocation: Invocation? {
        lock.lock()
        defer { lock.unlock() }
        return storedInvocation
    }
}

private func queueRequest(message: String = "선택한 작업을 다음 턴에서 실행해.")
    -> CoordinatorNextTurnDispatchRequest
{
    CoordinatorNextTurnDispatchRequest(
        sessionID: queueSessionID,
        message: message,
        continuationID: "continuation_test"
    )
}

private func queueErrorCode(
    _ operation: () async throws -> Void
) async -> String? {
    do {
        try await operation()
        return nil
    } catch {
        return error.coordinatorError.code
    }
}

@Test("Codex queue dispatcher uses an exact shell-free argv and parses the exact receipt")
func codexQueueDispatcherUsesExactArguments() async throws {
    let recorder = QueueInvocationRecorder()
    let executable = URL(fileURLWithPath: "/private/tmp/codex-qualified")
    let message = "다음 턴에서 권장 작업을 실행해."
    let dispatcher = CodexQueueNextTurnDispatcher(
        executableResolver: { executable },
        processRunner: { receivedExecutable, arguments, timeoutMilliseconds in
            recorder.record(
                executable: receivedExecutable,
                arguments: arguments,
                timeoutMilliseconds: timeoutMilliseconds
            )
            return CodexQueueProcessResult(
                exitCode: 0,
                stdout: Data(
                    "Queued message \(queueSubmissionID) for thread \(queueSessionID).\n".utf8
                )
            )
        },
        timeoutMilliseconds: 7_500
    )

    let receipt = try await dispatcher.dispatch(queueRequest(message: message))

    #expect(receipt.queuedSubmissionID == queueSubmissionID)
    #expect(recorder.invocation == QueueInvocationRecorder.Invocation(
        executable: executable,
        arguments: [
            "queue", "--thread", queueSessionID,
            "--message", message,
        ],
        timeoutMilliseconds: 7_500
    ))
}

@Test("an explicit missing Codex executable fails without PATH fallback")
func codexQueueResolverRejectsMissingExplicitExecutable() {
    let missing = URL(
        fileURLWithPath: "/private/tmp/blabee-missing-codex-\(UUID().uuidString)"
    )
    #expect(throws: CoordinatorError("codex_queue_executable_unavailable")) {
        _ = try CodexQueueExecutableResolver.resolve(
            explicitURL: missing,
            environment: [:]
        )
    }
}

@Test("Codex queue nonzero exit maps to a stable public error")
func codexQueueDispatcherRejectsNonzeroExit() async {
    let dispatcher = CodexQueueNextTurnDispatcher(
        executableResolver: { URL(fileURLWithPath: "/private/tmp/codex") },
        processRunner: { _, _, _ in
            CodexQueueProcessResult(exitCode: 17, stdout: Data())
        }
    )

    #expect(await queueErrorCode {
        _ = try await dispatcher.dispatch(queueRequest())
    } == "codex_queue_process_failed")
}

@Test("Codex queue timeout maps to a stable public error")
func codexQueueDispatcherPreservesTimeoutCode() async {
    let dispatcher = CodexQueueNextTurnDispatcher(
        executableResolver: { URL(fileURLWithPath: "/private/tmp/codex") },
        processRunner: { _, _, _ in
            throw CoordinatorError("codex_queue_process_timeout", "private process detail")
        }
    )

    #expect(await queueErrorCode {
        _ = try await dispatcher.dispatch(queueRequest())
    } == "codex_queue_process_timeout")
}

@Test("Codex queue accepts only the exact one-line success shape")
func codexQueueDispatcherRejectsMalformedSuccessOutput() async {
    let malformed = [
        "queued message \(queueSubmissionID) for thread \(queueSessionID).\n",
        "Queued message bad id for thread \(queueSessionID).\n",
        "Queued message \(queueSubmissionID) for thread \(queueSessionID)\n",
        "Queued message \(queueSubmissionID) for thread \(queueSessionID).\nextra\n",
    ]

    for output in malformed {
        let dispatcher = CodexQueueNextTurnDispatcher(
            executableResolver: { URL(fileURLWithPath: "/private/tmp/codex") },
            processRunner: { _, _, _ in
                CodexQueueProcessResult(exitCode: 0, stdout: Data(output.utf8))
            }
        )
        #expect(await queueErrorCode {
            _ = try await dispatcher.dispatch(queueRequest())
        } == "codex_queue_output_invalid")
    }
}

@Test("Codex queue rejects a receipt for a different session")
func codexQueueDispatcherRejectsSessionMismatch() async {
    let dispatcher = CodexQueueNextTurnDispatcher(
        executableResolver: { URL(fileURLWithPath: "/private/tmp/codex") },
        processRunner: { _, _, _ in
            CodexQueueProcessResult(
                exitCode: 0,
                stdout: Data(
                    "Queued message \(queueSubmissionID) for thread other-session.\n".utf8
                )
            )
        }
    )

    #expect(await queueErrorCode {
        _ = try await dispatcher.dispatch(queueRequest())
    } == "codex_queue_session_mismatch")
}

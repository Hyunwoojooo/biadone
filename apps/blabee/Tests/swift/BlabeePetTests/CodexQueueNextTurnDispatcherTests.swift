import CoordinatorSwift
import Darwin
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

private final class QueueCommandInvocationRecorder: @unchecked Sendable {
    struct Invocation: Equatable {
        let arguments: [String]
        let timeoutMilliseconds: Int
    }

    private let lock = NSLock()
    private var storedInvocations: [Invocation] = []

    func record(
        arguments: [String],
        timeoutMilliseconds: Int
    ) {
        lock.lock()
        storedInvocations.append(
            Invocation(
                arguments: arguments,
                timeoutMilliseconds: timeoutMilliseconds
            )
        )
        lock.unlock()
    }

    var invocations: [Invocation] {
        lock.lock()
        defer { lock.unlock() }
        return storedInvocations
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

private func queueFailureEvidence(
    _ dispatcher: CodexQueueNextTurnDispatcher
) async throws -> CoordinatorNextTurnDispatchFailure {
    var failure: CoordinatorNextTurnDispatchFailure?
    do { _ = try await dispatcher.dispatch(queueRequest()) }
    catch { failure = error.coordinatorError.dispatchFailure }
    return try #require(failure)
}

@Test("Codex queue dispatcher uses an exact shell-free argv and parses the exact receipt", .petLanguage(.korean))
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

@Test("Codex queue native command runner receives a readable multiline choice as one exact argument", .petLanguage(.korean))
func codexQueueNativeCommandRunnerUsesExactArgumentsOnce() async throws {
    let recorder = QueueCommandInvocationRecorder()
    let message = try #require(QueuedPromptEnvelope.message(
        reference: String(repeating: "a", count: 32),
        action: [
            "title": "선택 내용 표시", "objective": "제목과 목표를 확인합니다.\n변조된 내용은 거절합니다.",
            "constraints": ["기존 세션 유지", "`echo test`와 $(command)는 표시할 데이터입니다."],
            "done_when": ["정확한 전달 인수가 하나입니다."],
        ]
    ))
    let dispatcher = CodexQueueNextTurnDispatcher(
        commandRunner: { arguments, timeoutMilliseconds in
            recorder.record(
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
        timeoutMilliseconds: 6_500
    )

    let receipt = try await dispatcher.dispatch(queueRequest(message: message))

    #expect(receipt.queuedSubmissionID == queueSubmissionID)
    #expect(recorder.invocations == [
        QueueCommandInvocationRecorder.Invocation(
            arguments: [
                "queue", "--thread", queueSessionID,
                "--message", message,
            ],
            timeoutMilliseconds: 6_500
        ),
    ])
}

@Test("Codex queue preserves native readiness failure without retry", .petLanguage(.korean))
func codexQueueNativeReadinessFailureIsStableAndNotRetried() async {
    let recorder = QueueCommandInvocationRecorder()
    let dispatcher = CodexQueueNextTurnDispatcher(
        commandRunner: { arguments, timeoutMilliseconds in
            recorder.record(
                arguments: arguments,
                timeoutMilliseconds: timeoutMilliseconds
            )
            throw CoordinatorError(
                "codex_native_runtime_not_ready",
                "private readiness detail"
            )
        }
    )

    #expect(await queueErrorCode {
        _ = try await dispatcher.dispatch(queueRequest())
    } == "codex_native_runtime_not_ready")
    #expect(recorder.invocations.count == 1)
}

@Test("Codex queue collapses non-native command errors without retry", .petLanguage(.korean))
func codexQueueForeignCommandFailureIsCollapsedAndNotRetried() async {
    let recorder = QueueCommandInvocationRecorder()
    let dispatcher = CodexQueueNextTurnDispatcher(
        commandRunner: { arguments, timeoutMilliseconds in
            recorder.record(
                arguments: arguments,
                timeoutMilliseconds: timeoutMilliseconds
            )
            throw CoordinatorError(
                "codex_plugin_setup_signature_invalid",
                "private qualification detail"
            )
        }
    )

    #expect(await queueErrorCode {
        _ = try await dispatcher.dispatch(queueRequest())
    } == "codex_queue_process_unavailable")
    #expect(recorder.invocations.count == 1)
}

@Test("an explicit missing Codex executable fails without PATH fallback", .petLanguage(.korean))
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

@Test("Codex queue nonzero exit maps to a stable public error", .petLanguage(.korean))
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

@Test("Codex queue does not retry nonzero or ambiguous native results", .petLanguage(.korean))
func codexQueueNativeTerminalResultsAreNotRetried() async {
    let outcomes: [(CodexQueueProcessResult, String)] = [
        (
            CodexQueueProcessResult(exitCode: 17, stdout: Data()),
            "codex_queue_process_failed"
        ),
        (
            CodexQueueProcessResult(
                exitCode: 0,
                stdout: Data("ambiguous receipt".utf8)
            ),
            "codex_queue_output_invalid"
        ),
    ]

    for (result, expectedError) in outcomes {
        let recorder = QueueCommandInvocationRecorder()
        let dispatcher = CodexQueueNextTurnDispatcher(
            commandRunner: { arguments, timeoutMilliseconds in
                recorder.record(
                    arguments: arguments,
                    timeoutMilliseconds: timeoutMilliseconds
                )
                return result
            }
        )

        #expect(await queueErrorCode {
            _ = try await dispatcher.dispatch(queueRequest())
        } == expectedError)
        #expect(recorder.invocations.count == 1)
    }
}

@Test("Codex queue process runner uses shell signal exit status", .petLanguage(.korean))
func codexQueueProcessRunnerMapsSignalTermination() throws {
    let result = try CodexQueueProcessRunner.run(
        executable: URL(fileURLWithPath: "/bin/sh"),
        arguments: ["-c", "kill -KILL $$"],
        timeoutMilliseconds: 2_000
    )

    #expect(result.exitCode == 128 + SIGKILL)
    #expect(result.terminationSignal == SIGKILL)
}

@Test("Codex queue timeout maps to a stable public error", .petLanguage(.korean))
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

@Test("Codex queue accepts only the exact one-line success shape", .petLanguage(.korean))
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

@Test("Codex queue rejects a receipt for a different session", .petLanguage(.korean))
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

@Test("Queue resolver failures prove this request never invoked the command", .petLanguage(.korean))
func codexQueueResolutionFailureIsNotSubmitted() async throws {
    let recorder = QueueCommandInvocationRecorder()
    let dispatcher = CodexQueueNextTurnDispatcher(
        executableResolver: { throw CoordinatorError("codex_queue_executable_unavailable") },
        processRunner: { _, arguments, timeout in
            recorder.record(arguments: arguments, timeoutMilliseconds: timeout)
            return CodexQueueProcessResult(exitCode: 0, stdout: Data())
        }
    )
    let evidence = try await queueFailureEvidence(dispatcher)
    #expect(evidence.code == "codex_queue_executable_unavailable")
    #expect(evidence.stage == .qualification)
    #expect(evidence.deliveryState == .notSubmitted)
    #expect(!evidence.commandInvocationAttempted)
    #expect(!evidence.cachedFailure)
    #expect(evidence.exitCode == nil)
    #expect(recorder.invocations.isEmpty)
}

@Test("Queue timeout after runner invocation remains unknown and is never retried", .petLanguage(.korean))
func codexQueueTimeoutHasConservativeInvocationEvidence() async throws {
    let recorder = QueueCommandInvocationRecorder()
    let dispatcher = CodexQueueNextTurnDispatcher(commandRunner: { arguments, timeout in
        recorder.record(arguments: arguments, timeoutMilliseconds: timeout)
        throw CoordinatorError("codex_queue_process_timeout", "private prompt and output")
    })
    let evidence = try await queueFailureEvidence(dispatcher)
    #expect(evidence.code == "codex_queue_process_timeout")
    #expect(evidence.stage == .command)
    #expect(evidence.deliveryState == .unknown)
    #expect(evidence.commandInvocationAttempted)
    #expect(evidence.elapsedMilliseconds >= 0)
    #expect(evidence.exitCode == nil)
    #expect(recorder.invocations.count == 1)
    let encoded = try JSONEncoder().encode(evidence)
    #expect(!String(decoding: encoded, as: UTF8.self).contains("private prompt"))
}

@Test("Nonzero queue exits and invalid receipts retain bounded exit evidence without replay", .petLanguage(.korean))
func codexQueueTerminalFailureEvidence() async throws {
    let cases: [(CodexQueueProcessResult, String, CoordinatorNextTurnDispatchFailure.Stage)] = [
        (.init(exitCode: 17, stdout: Data()), "codex_queue_process_failed", .queueExit),
        (.init(exitCode: 128 + SIGKILL, stdout: Data(), terminationSignal: SIGKILL),
         "codex_queue_process_failed", .queueExit),
        (.init(exitCode: 0, stdout: Data("unexpected receipt".utf8)), "codex_queue_output_invalid", .receipt),
        (.init(exitCode: 0, stdout: Data("Queued message test for thread another-session.\n".utf8)),
         "codex_queue_session_mismatch", .receipt),
    ]
    for (result, expectedCode, expectedStage) in cases {
        let recorder = QueueCommandInvocationRecorder()
        let dispatcher = CodexQueueNextTurnDispatcher(commandRunner: { arguments, timeout in
            recorder.record(arguments: arguments, timeoutMilliseconds: timeout)
            return result
        })
        let evidence = try await queueFailureEvidence(dispatcher)
        #expect(evidence.code == expectedCode)
        #expect(evidence.stage == expectedStage)
        #expect(evidence.deliveryState == .unknown)
        #expect(evidence.commandInvocationAttempted)
        #expect(evidence.exitCode == result.exitCode)
        #expect(evidence.terminationSignal == result.terminationSignal)
        #expect(!evidence.cachedFailure)
        #expect(recorder.invocations.count == 1)
    }
}

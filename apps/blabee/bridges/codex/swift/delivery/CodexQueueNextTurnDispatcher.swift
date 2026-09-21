import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

struct CodexQueueProcessResult: Sendable, Equatable {
    let exitCode: Int32
    let stdout: Data
}

typealias CodexQueueExecutableResolving = @Sendable () throws -> URL
typealias CodexQueueProcessRunning = @Sendable (
    _ executable: URL,
    _ arguments: [String],
    _ timeoutMilliseconds: Int
) throws -> CodexQueueProcessResult
typealias CodexQueueCommandRunning = @Sendable (
    _ arguments: [String],
    _ timeoutMilliseconds: Int
) throws -> CodexQueueProcessResult

enum CodexQueueExecutableResolver {
    static func resolve(
        explicitURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        if let explicitURL {
            guard let executable = validatedExecutable(explicitURL) else {
                throw CoordinatorError("codex_queue_executable_unavailable")
            }
            return executable
        }

        var candidates: [URL] = []
        if let path = environment["PATH"] {
            candidates.append(contentsOf: path.split(separator: ":").compactMap { entry in
                let directory = String(entry)
                guard directory.hasPrefix("/") else { return nil }
                return URL(fileURLWithPath: directory, isDirectory: true)
                    .appendingPathComponent("codex", isDirectory: false)
            })
        }
        candidates.append(URL(fileURLWithPath: "/opt/homebrew/bin/codex"))
        candidates.append(URL(fileURLWithPath: "/usr/local/bin/codex"))

        var visited: Set<String> = []
        for candidate in candidates {
            let path = candidate.standardizedFileURL.path
            guard visited.insert(path).inserted,
                  let executable = validatedExecutable(candidate)
            else { continue }
            return executable
        }
        throw CoordinatorError("codex_queue_executable_unavailable")
    }

    private static func validatedExecutable(_ candidate: URL) -> URL? {
        guard candidate.isFileURL, candidate.path.hasPrefix("/") else { return nil }
        let resolved = candidate.standardizedFileURL
            .resolvingSymlinksInPath()
            .standardizedFileURL
        var info = stat()
        guard stat(resolved.path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              access(resolved.path, X_OK) == 0
        else { return nil }
        return resolved
    }
}

enum CodexQueueProcessRunner {
    private static let maximumStandardOutputBytes = 4 * 1_024
    private static let maximumStandardErrorBytes = 64 * 1_024

    private final class DrainBox: @unchecked Sendable {
        private let lock = NSLock()
        private var retained = Data()
        private var bytesSeen = 0
        private var exceededLimit = false

        func append(_ data: Data, limit: Int, retain: Bool) {
            lock.lock()
            defer { lock.unlock() }
            guard !exceededLimit else { return }
            guard data.count <= limit, bytesSeen <= limit - data.count else {
                exceededLimit = true
                retained.removeAll(keepingCapacity: false)
                return
            }
            bytesSeen += data.count
            if retain { retained.append(data) }
        }

        func result() -> (data: Data, exceededLimit: Bool) {
            lock.lock()
            defer { lock.unlock() }
            return (retained, exceededLimit)
        }
    }

    static func run(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) throws -> CodexQueueProcessResult {
        let process = Process()
        let standardOutput = Pipe()
        let standardError = Pipe()
        let outputBox = DrainBox()
        let errorBox = DrainBox()
        let drainGroup = DispatchGroup()
        let terminated = DispatchSemaphore(value: 0)

        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = standardOutput
        process.standardError = standardError
        process.terminationHandler = { _ in terminated.signal() }

        drainGroup.enter()
        DispatchQueue.global(qos: .utility).async {
            while let chunk = try? standardOutput.fileHandleForReading.read(upToCount: 16 * 1_024),
                  !chunk.isEmpty
            {
                outputBox.append(
                    chunk,
                    limit: maximumStandardOutputBytes,
                    retain: true
                )
            }
            drainGroup.leave()
        }
        drainGroup.enter()
        DispatchQueue.global(qos: .utility).async {
            while let chunk = try? standardError.fileHandleForReading.read(upToCount: 16 * 1_024),
                  !chunk.isEmpty
            {
                // Drain but do not retain stderr. It may contain user or runtime details.
                errorBox.append(
                    chunk,
                    limit: maximumStandardErrorBytes,
                    retain: false
                )
            }
            drainGroup.leave()
        }

        do {
            try process.run()
        } catch {
            try? standardOutput.fileHandleForWriting.close()
            try? standardError.fileHandleForWriting.close()
            _ = drainGroup.wait(timeout: .now() + .seconds(1))
            throw CoordinatorError("codex_queue_process_unavailable")
        }
        try? standardOutput.fileHandleForWriting.close()
        try? standardError.fileHandleForWriting.close()

        let deadline = DispatchTime.now() + .milliseconds(max(1, timeoutMilliseconds))
        guard terminated.wait(timeout: deadline) == .success else {
            process.terminate()
            if terminated.wait(timeout: .now() + .milliseconds(500)) != .success {
                kill(process.processIdentifier, SIGKILL)
                _ = terminated.wait(timeout: .now() + .seconds(1))
            }
            _ = drainGroup.wait(timeout: .now() + .seconds(1))
            throw CoordinatorError("codex_queue_process_timeout")
        }
        guard drainGroup.wait(timeout: .now() + .seconds(1)) == .success else {
            throw CoordinatorError("codex_queue_process_output_invalid")
        }

        let output = outputBox.result()
        let errors = errorBox.result()
        guard !output.exceededLimit, !errors.exceededLimit else {
            throw CoordinatorError("codex_queue_process_output_too_large")
        }
        let exitCode: Int32
        switch process.terminationReason {
        case .exit:
            exitCode = process.terminationStatus
        case .uncaughtSignal:
            exitCode = 128 + process.terminationStatus
        @unknown default:
            exitCode = process.terminationStatus
        }
        return CodexQueueProcessResult(
            exitCode: exitCode,
            stdout: output.data
        )
    }
}

struct CodexQueueNextTurnDispatcher: Sendable {
    // Trust checks can involve synchronous Security.framework and notarization
    // work. Keep their overall budget separate from the queue child itself.
    static let nativeOperationTimeoutMilliseconds = 45_000
    static let queueCommandTimeoutMilliseconds = 10_000

    private enum Execution: Sendable {
        case legacy(
            executableResolver: CodexQueueExecutableResolving,
            processRunner: CodexQueueProcessRunning
        )
        case command(CodexQueueCommandRunning)
    }

    private let execution: Execution
    private let timeoutMilliseconds: Int

    init(
        executableResolver: @escaping CodexQueueExecutableResolving,
        processRunner: @escaping CodexQueueProcessRunning,
        timeoutMilliseconds: Int = 10_000
    ) {
        execution = .legacy(
            executableResolver: executableResolver,
            processRunner: processRunner
        )
        self.timeoutMilliseconds = timeoutMilliseconds
    }

    init(
        commandRunner: @escaping CodexQueueCommandRunning,
        timeoutMilliseconds: Int = 10_000
    ) {
        execution = .command(commandRunner)
        self.timeoutMilliseconds = timeoutMilliseconds
    }

    static func live(
        explicitExecutableURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        timeoutMilliseconds: Int = nativeOperationTimeoutMilliseconds
    ) -> CodexQueueNextTurnDispatcher {
        CodexQueueNextTurnDispatcher(
            nativeRuntime: .live(
                explicitExecutableURL: explicitExecutableURL, environment: environment
            ),
            timeoutMilliseconds: timeoutMilliseconds
        )
    }

    init(
        nativeRuntime: CodexNativeRuntime,
        timeoutMilliseconds: Int = nativeOperationTimeoutMilliseconds
    ) {
        self.init(
            commandRunner: { arguments, timeoutMilliseconds in
                let result = try nativeRuntime.perform(
                    arguments: arguments,
                    timeoutMilliseconds: timeoutMilliseconds,
                    commandTimeoutMilliseconds: Self.queueCommandTimeoutMilliseconds
                )
                return CodexQueueProcessResult(
                    exitCode: result.exitCode,
                    stdout: result.stdout
                )
            },
            timeoutMilliseconds: timeoutMilliseconds
        )
    }

    var coordinatorDispatcher: CoordinatorNextTurnDispatcher {
        { request in try await dispatch(request) }
    }

    func dispatch(
        _ request: CoordinatorNextTurnDispatchRequest
    ) async throws -> CoordinatorNextTurnDispatchReceipt {
        let arguments = [
            "queue", "--thread", request.sessionID,
            "--message", request.message,
        ]
        let timeout = timeoutMilliseconds
        let result: CodexQueueProcessResult
        switch execution {
        case let .command(commandRunner):
            do {
                result = try await Task.detached(priority: .utility) {
                    try commandRunner(arguments, timeout)
                }.value
            } catch {
                throw stableError(error, fallbackCode: "codex_queue_process_unavailable")
            }
        case let .legacy(executableResolver, processRunner):
            let executable: URL
            do {
                executable = try executableResolver()
            } catch {
                throw stableError(
                    error,
                    fallbackCode: "codex_queue_executable_unavailable"
                )
            }
            do {
                result = try await Task.detached(priority: .utility) {
                    try processRunner(executable, arguments, timeout)
                }.value
            } catch {
                throw stableError(error, fallbackCode: "codex_queue_process_unavailable")
            }
        }
        guard result.exitCode == 0 else {
            throw CoordinatorError("codex_queue_process_failed")
        }
        let queuedSubmissionID = try parseSuccess(
            result.stdout,
            expectedSessionID: request.sessionID
        )
        return CoordinatorNextTurnDispatchReceipt(
            queuedSubmissionID: queuedSubmissionID
        )
    }

    private func stableError(_ error: Error, fallbackCode: String) -> CoordinatorError {
        let coordinatorError = error.coordinatorError
        guard coordinatorError.code.hasPrefix("codex_queue_")
                || coordinatorError.code.hasPrefix("codex_native_")
        else {
            return CoordinatorError(fallbackCode)
        }
        return CoordinatorError(coordinatorError.code)
    }

    private func parseSuccess(_ data: Data, expectedSessionID: String) throws -> String {
        guard let raw = String(data: data, encoding: .utf8), !raw.isEmpty else {
            throw CoordinatorError("codex_queue_output_invalid")
        }
        let line: String
        if raw.hasSuffix("\n") {
            line = String(raw.dropLast())
        } else {
            line = raw
        }
        guard !line.contains("\n"), !line.contains("\r"), !line.contains("\0") else {
            throw CoordinatorError("codex_queue_output_invalid")
        }

        let prefix = "Queued message "
        let separator = " for thread "
        let suffix = "."
        guard line.hasPrefix(prefix), line.hasSuffix(suffix) else {
            throw CoordinatorError("codex_queue_output_invalid")
        }
        let body = line.dropFirst(prefix.count).dropLast(suffix.count)
        guard let separatorRange = body.range(of: separator),
              body[separatorRange.upperBound...].range(of: separator) == nil
        else { throw CoordinatorError("codex_queue_output_invalid") }

        let queuedSubmissionID = String(body[..<separatorRange.lowerBound])
        let echoedSessionID = String(body[separatorRange.upperBound...])
        guard echoedSessionID == expectedSessionID else {
            throw CoordinatorError("codex_queue_session_mismatch")
        }
        guard queuedSubmissionID.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            options: .regularExpression
        ) != nil else {
            throw CoordinatorError("codex_queue_output_invalid")
        }
        return queuedSubmissionID
    }
}

import Foundation

@MainActor
final class LauncherAgentClient: @unchecked Sendable {
    private struct PendingRequest {
        let continuation: CheckedContinuation<Data, Error>
        let timeoutTask: Task<Void, Never>
    }

    private let configurationResolver: () throws -> LauncherRuntimeConfiguration
    private let processFactory: () -> Process
    private let logHandleFactory: () throws -> FileHandle
    private let requestTimeoutNanoseconds: UInt64
    private let writeQueue = DispatchQueue(
        label: "com.biadone.blabase.launcher-agent-writer"
    )
    private var process: Process?
    private var inputHandle: FileHandle?
    private var outputPipe: Pipe?
    private var errorHandle: FileHandle?
    private var outputBuffer = Data()
    private var pending: [String: PendingRequest] = [:]
    private var restartPolicy = SupervisorRestartPolicy()
    private var restartTask: Task<Void, Never>?
    private var isShuttingDown = false
    private var generation = UUID()
    private var stoppingProcess: Process?

    init(
        configurationResolver: @escaping () throws -> LauncherRuntimeConfiguration = {
            try LauncherRuntimeConfiguration.resolve()
        },
        processFactory: @escaping () -> Process = Process.init,
        logHandleFactory: @escaping () throws -> FileHandle = {
            try LauncherAgentClient.openLogHandle()
        },
        requestTimeoutNanoseconds: UInt64 = 20_000_000_000
    ) {
        self.configurationResolver = configurationResolver
        self.processFactory = processFactory
        self.logHandleFactory = logHandleFactory
        self.requestTimeoutNanoseconds = requestTimeoutNanoseconds
    }

    func getAttention(refresh: Bool) async throws -> LauncherAttentionProjection {
        try await request(
            method: "attention.get",
            parameters: AttentionGetParameters(refresh: refresh),
            resultType: LauncherAttentionProjection.self
        )
    }

    func executeAttention(
        resultId: String,
        candidateId: String
    ) async throws -> LauncherExecutionProjection {
        try await request(
            method: "attention.execute",
            parameters: AttentionExecuteParameters(
                resultId: resultId,
                candidateId: candidateId
            ),
            resultType: LauncherExecutionProjection.self
        )
    }

    func getCommand(_ commandId: String) async throws -> LauncherExecutionProjection {
        try await request(
            method: "command.get",
            parameters: CommandGetParameters(commandId: commandId),
            resultType: LauncherExecutionProjection.self
        )
    }

    func shutdown() {
        let previousProcess = stoppingProcess ?? detachProcess()
        stoppingProcess = nil
        if let previousProcess, previousProcess.isRunning {
            previousProcess.terminate()
        }
    }

    func stopForReconfiguration() async throws {
        let previousProcess = stoppingProcess ?? detachProcess()
        guard let previousProcess, previousProcess.isRunning else {
            stoppingProcess = nil
            resetAfterConfigurationStop()
            return
        }
        stoppingProcess = previousProcess
        previousProcess.terminate()
        for _ in 0..<40 {
            if !previousProcess.isRunning {
                stoppingProcess = nil
                resetAfterConfigurationStop()
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        guard !previousProcess.isRunning else {
            throw LauncherAgentError.invalidRuntime("agent stop timeout")
        }
        stoppingProcess = nil
        resetAfterConfigurationStop()
    }

    private func request<Parameters: Encodable, Result: Decodable>(
        method: String,
        parameters: Parameters,
        resultType: Result.Type
    ) async throws -> Result {
        try startIfNeeded()
        guard let inputHandle else { throw LauncherAgentError.disconnected }
        let requestId = LauncherIPC.requestID()
        let request = LauncherIPCRequest(
            requestId: requestId,
            method: method,
            params: parameters
        )
        var data = try JSONEncoder().encode(request)
        guard data.count <= LauncherIPC.maximumLineBytes else {
            throw LauncherAgentError.responseTooLarge
        }
        data.append(0x0A)
        let requestData = data

        let resultData: Data = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let timeoutTask = Task { [weak self] in
                    guard let self else { return }
                    try? await Task.sleep(
                        nanoseconds: self.requestTimeoutNanoseconds
                    )
                    guard !Task.isCancelled else { return }
                    self.timeout(requestId: requestId)
                }
                pending[requestId] = PendingRequest(
                    continuation: continuation,
                    timeoutTask: timeoutTask
                )
                if Task.isCancelled {
                    finishPending(
                        requestId: requestId,
                        result: .failure(CancellationError())
                    )
                    return
                }
                writeQueue.async { [weak self] in
                    do {
                        try inputHandle.write(contentsOf: requestData)
                    } catch {
                        Task { @MainActor [weak self] in
                            self?.finishPending(
                                requestId: requestId,
                                result: .failure(
                                    LauncherAgentError.disconnected
                                )
                            )
                        }
                    }
                }
            }
        } onCancel: { [weak self] in
            Task { @MainActor [weak self] in
                self?.finishPending(
                    requestId: requestId,
                    result: .failure(CancellationError())
                )
            }
        }
        do {
            return try JSONDecoder().decode(resultType, from: resultData)
        } catch {
            throw LauncherAgentError.invalidResponse
        }
    }

    private func startIfNeeded() throws {
        if let stoppingProcess, stoppingProcess.isRunning {
            throw LauncherAgentError.invalidRuntime("agent still stopping")
        }
        stoppingProcess = nil
        if let process, process.isRunning { return }
        isShuttingDown = false
        restartTask?.cancel()
        restartTask = nil
        let configuration = try configurationResolver()
        let nextProcess = processFactory()
        let input = Pipe()
        let output = Pipe()
        let logHandle = try logHandleFactory()
        let nextGeneration = UUID()

        nextProcess.executableURL = configuration.executableURL
        nextProcess.arguments = configuration.arguments
        nextProcess.currentDirectoryURL = configuration.dataRootURL
        nextProcess.environment = configuration.environment
        nextProcess.standardInput = input
        nextProcess.standardOutput = output
        nextProcess.standardError = logHandle
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor [weak self] in
                self?.receive(data, generation: nextGeneration)
            }
        }
        nextProcess.terminationHandler = { [weak self] terminated in
            let status = terminated.terminationStatus
            Task { @MainActor [weak self] in
                self?.processTerminated(
                    generation: nextGeneration,
                    status: status
                )
            }
        }
        do {
            try nextProcess.run()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            try? logHandle.close()
            throw LauncherAgentError.launchFailed
        }
        generation = nextGeneration
        process = nextProcess
        inputHandle = input.fileHandleForWriting
        outputPipe = output
        errorHandle = logHandle
        outputBuffer.removeAll(keepingCapacity: true)
    }

    private func detachProcess() -> Process? {
        isShuttingDown = true
        generation = UUID()
        restartTask?.cancel()
        restartTask = nil
        failAllPending(with: LauncherAgentError.disconnected)
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        try? inputHandle?.close()
        let previousProcess = process
        process = nil
        inputHandle = nil
        outputPipe = nil
        try? errorHandle?.close()
        errorHandle = nil
        outputBuffer.removeAll(keepingCapacity: false)
        return previousProcess
    }

    private func resetAfterConfigurationStop() {
        restartPolicy = SupervisorRestartPolicy()
        isShuttingDown = false
    }

    private func receive(_ data: Data, generation: UUID) {
        guard generation == self.generation else { return }
        if data.isEmpty {
            outputPipe?.fileHandleForReading.readabilityHandler = nil
            return
        }
        outputBuffer.append(data)
        if outputBuffer.count > LauncherIPC.maximumLineBytes * 2,
           !outputBuffer.contains(0x0A) {
            failAllPending(with: LauncherAgentError.responseTooLarge)
            process?.terminate()
            return
        }
        while let newline = outputBuffer.firstIndex(of: 0x0A) {
            let line = Data(outputBuffer[..<newline])
            outputBuffer.removeSubrange(...newline)
            guard line.count <= LauncherIPC.maximumLineBytes else {
                failAllPending(with: LauncherAgentError.responseTooLarge)
                process?.terminate()
                return
            }
            processResponseLine(line)
        }
    }

    private func processResponseLine(_ data: Data) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any],
            let contract = dictionary["contract"] as? String,
            contract == LauncherIPC.contract,
            let requestId = dictionary["requestId"] as? String,
            let ok = dictionary["ok"] as? Bool
        else {
            failAllPending(with: LauncherAgentError.invalidResponse)
            process?.terminate()
            return
        }
        if ok, let result = dictionary["result"] {
            guard JSONSerialization.isValidJSONObject(result),
                  let resultData = try? JSONSerialization.data(withJSONObject: result)
            else {
                finishPending(
                    requestId: requestId,
                    result: .failure(LauncherAgentError.invalidResponse)
                )
                return
            }
            finishPending(requestId: requestId, result: .success(resultData))
            return
        }
        guard
            let error = dictionary["error"] as? [String: Any],
            let code = error["code"] as? String,
            let message = error["message"] as? String
        else {
            finishPending(
                requestId: requestId,
                result: .failure(LauncherAgentError.invalidResponse)
            )
            return
        }
        finishPending(
            requestId: requestId,
            result: .failure(LauncherAgentError.agent(code: code, message: message))
        )
    }

    private func timeout(requestId: String) {
        finishPending(
            requestId: requestId,
            result: .failure(LauncherAgentError.requestTimedOut)
        )
    }

    private func finishPending(
        requestId: String,
        result: Result<Data, Error>
    ) {
        guard let pending = pending.removeValue(forKey: requestId) else { return }
        pending.timeoutTask.cancel()
        pending.continuation.resume(with: result)
    }

    private func failAllPending(with error: Error) {
        let requests = pending
        pending.removeAll()
        for request in requests.values {
            request.timeoutTask.cancel()
            request.continuation.resume(throwing: error)
        }
    }

    private func processTerminated(generation: UUID, status: Int32) {
        guard generation == self.generation else { return }
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        try? inputHandle?.close()
        inputHandle = nil
        outputPipe = nil
        process = nil
        try? errorHandle?.close()
        errorHandle = nil
        failAllPending(with: LauncherAgentError.disconnected)
        guard !isShuttingDown else { return }
        switch restartPolicy.recordUnexpectedExit(at: Date()) {
        case .stop:
            return
        case .restart(let delay):
            restartTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: delay)
                guard !Task.isCancelled else { return }
                do {
                    try self?.startIfNeeded()
                } catch {
                    // The next user request surfaces the bounded runtime error.
                }
            }
        }
        _ = status
    }

    nonisolated private static func openLogHandle() throws -> FileHandle {
        let fileManager = FileManager.default
        guard let logs = fileManager.urls(
            for: .libraryDirectory,
            in: .userDomainMask
        ).first?.appendingPathComponent("Logs/Blabase", isDirectory: true)
        else {
            throw LauncherAgentError.invalidRuntime("log directory")
        }
        try fileManager.createDirectory(
            at: logs,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: logs.path
        )
        let logURL = logs.appendingPathComponent("launcher-agent.log")
        let rotatedLogURL = logs.appendingPathComponent(
            "launcher-agent.previous.log"
        )
        let logAttributes = try? fileManager.attributesOfItem(
            atPath: logURL.path
        )
        let logSize = (logAttributes?[.size] as? NSNumber)?.uint64Value ?? 0
        if logSize > 1_048_576 {
            try? fileManager.removeItem(at: rotatedLogURL)
            try fileManager.moveItem(at: logURL, to: rotatedLogURL)
            try fileManager.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: rotatedLogURL.path
            )
        }
        if !fileManager.fileExists(atPath: logURL.path) {
            guard fileManager.createFile(
                atPath: logURL.path,
                contents: nil,
                attributes: [.posixPermissions: 0o600]
            ) else {
                throw LauncherAgentError.invalidRuntime("log file")
            }
        }
        try fileManager.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: logURL.path
        )
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()
        return handle
    }
}

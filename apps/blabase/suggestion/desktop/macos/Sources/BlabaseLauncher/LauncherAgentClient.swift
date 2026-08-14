import Foundation
import Darwin

@MainActor
final class LauncherAgentClient: @unchecked Sendable {
    private struct RetirementState {
        let token: UUID
        let task: Task<Bool, Never>
    }

    private struct PendingRequest {
        let continuation: CheckedContinuation<Data, Error>
        let timeoutTask: Task<Void, Never>
    }

    private let configurationResolver: () throws -> LauncherRuntimeConfiguration
    private let processFactory: () -> Process
    private let logHandleFactory: () throws -> FileHandle
    private let requestTimeoutNanoseconds: UInt64
    private let processTerminator:
        (@MainActor (Process) async -> Bool)?
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
    private var lifecycleStopInProgress = false
    private var isPermanentlyShutdown = false
    private var lifecycleEpoch: UInt64 = 0
    private var generation = UUID()
    private var stoppingProcess: Process?
    private var retirementState: RetirementState?

    init(
        configurationResolver: @escaping () throws -> LauncherRuntimeConfiguration = {
            try LauncherRuntimeConfiguration.resolve()
        },
        processFactory: @escaping () -> Process = Process.init,
        logHandleFactory: @escaping () throws -> FileHandle = {
            try LauncherAgentClient.openLogHandle()
        },
        requestTimeoutNanoseconds: UInt64 = 20_000_000_000,
        processTerminator:
            (@MainActor (Process) async -> Bool)? = nil
    ) {
        self.configurationResolver = configurationResolver
        self.processFactory = processFactory
        self.logHandleFactory = logHandleFactory
        self.requestTimeoutNanoseconds = requestTimeoutNanoseconds
        self.processTerminator = processTerminator
    }

    func getAttention(refresh: Bool) async throws -> LauncherAttentionProjection {
        try await request(
            method: "attention.get",
            parameters: AttentionGetParameters(refresh: refresh),
            resultType: LauncherAttentionProjection.self
        )
    }

    func getPreferredProjection(
        refresh: Bool
    ) async throws -> LauncherPreferredProjection {
        try await LauncherPreferredProjectionLoader.load(
            refresh: refresh,
            getWorkBoard: { refresh in
                let data = try await self.requestData(
                    method: "work-board.get",
                    parameters: WorkBoardGetParameters(refresh: refresh),
                    retireSessionOnTimeout: true
                )
                do {
                    return try JSONDecoder().decode(
                        LauncherWorkBoardProjection.self,
                        from: data
                    )
                } catch {
                    throw LauncherWorkBoardLoadError.invalidProjection
                }
            },
            getAttention: { refresh in
                try await self.getAttention(refresh: refresh)
            }
        )
    }

    func getStatus() async throws -> LauncherAgentStatus {
        try await request(
            method: "status.get",
            parameters: StatusGetParameters(),
            resultType: LauncherAgentStatus.self
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

    func shutdown() async throws {
        if !isPermanentlyShutdown {
            lifecycleEpoch &+= 1
            lifecycleStopInProgress = true
            isPermanentlyShutdown = true
        }
        if retirementState == nil, let previousProcess = detachProcess() {
            beginRetirement(previousProcess)
        }
        guard await awaitVerifiedRetirement() else {
            throw LauncherAgentError.invalidRuntime("agent stop timeout")
        }
    }

    func beginConfigurationStop() async throws {
        guard
            !isPermanentlyShutdown,
            !lifecycleStopInProgress
        else {
            throw LauncherAgentError.invalidRuntime("agent shut down")
        }
        lifecycleEpoch &+= 1
        lifecycleStopInProgress = true
        if retirementState == nil, let previousProcess = detachProcess() {
            beginRetirement(previousProcess)
        }
        if retirementState == nil { return }
        guard await awaitVerifiedRetirement() else {
            throw LauncherAgentError.invalidRuntime("agent stop timeout")
        }
    }

    func completeConfigurationChange() {
        guard !isPermanentlyShutdown, lifecycleStopInProgress else { return }
        lifecycleEpoch &+= 1
        resetAfterConfigurationStop()
    }

    func abortConfigurationChange() {
        guard !isPermanentlyShutdown, lifecycleStopInProgress else { return }
        lifecycleEpoch &+= 1
        resetAfterConfigurationStop()
    }

    private func request<Parameters: Encodable, Result: Decodable>(
        method: String,
        parameters: Parameters,
        resultType: Result.Type
    ) async throws -> Result {
        let resultData = try await requestData(
            method: method,
            parameters: parameters
        )
        do {
            return try JSONDecoder().decode(resultType, from: resultData)
        } catch {
            throw LauncherAgentError.invalidResponse
        }
    }

    private func requestData<Parameters: Encodable>(
        method: String,
        parameters: Parameters,
        retireSessionOnTimeout: Bool = false
    ) async throws -> Data {
        try await startIfNeeded()
        guard let inputHandle else { throw LauncherAgentError.disconnected }
        let requestGeneration = generation
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

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let timeoutTask = Task { [weak self] in
                    guard let self else { return }
                    try? await Task.sleep(
                        nanoseconds: self.requestTimeoutNanoseconds
                    )
                    guard !Task.isCancelled else { return }
                    self.timeout(
                        requestId: requestId,
                        requestGeneration: requestGeneration,
                        retireSession: retireSessionOnTimeout
                    )
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
                guard let self else { return }
                let cancellationWon = self.finishPending(
                    requestId: requestId,
                    result: .failure(CancellationError())
                )
                if cancellationWon && retireSessionOnTimeout {
                    self.retireCurrentProcess(
                        expectedGeneration: requestGeneration
                    )
                }
            }
        }
    }

    private func startIfNeeded() async throws {
        guard !isPermanentlyShutdown, !lifecycleStopInProgress else {
            throw LauncherAgentError.disconnected
        }
        let expectedEpoch = lifecycleEpoch
        let expectedRetirementToken = retirementState?.token
        guard await awaitVerifiedRetirement() else {
            throw LauncherAgentError.invalidRuntime("agent still stopping")
        }
        try Task.checkCancellation()
        guard
            expectedEpoch == lifecycleEpoch,
            !isPermanentlyShutdown,
            !lifecycleStopInProgress,
            retirementState == nil ||
                retirementState?.token == expectedRetirementToken
        else {
            throw LauncherAgentError.disconnected
        }
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
        lifecycleStopInProgress = false
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
            retireCurrentProcess()
            return
        }
        while let newline = outputBuffer.firstIndex(of: 0x0A) {
            let line = Data(outputBuffer[..<newline])
            outputBuffer.removeSubrange(...newline)
            guard line.count <= LauncherIPC.maximumLineBytes else {
                failAllPending(with: LauncherAgentError.responseTooLarge)
                retireCurrentProcess()
                return
            }
            processResponseLine(line)
        }
    }

    private func processResponseLine(_ data: Data) {
        let response: LauncherIPCParsedResponse
        do {
            response = try LauncherIPC.parseResponseLine(data)
        } catch {
            failAllPending(with: LauncherAgentError.invalidResponse)
            retireCurrentProcess()
            return
        }
        switch response {
        case .success(let requestId, let resultData):
            finishPending(requestId: requestId, result: .success(resultData))
        case .failure(let requestId, let error):
            finishPending(
                requestId: requestId,
                result: .failure(
                    LauncherAgentError.agent(
                        code: error.code,
                        message: LauncherIPC.displayErrorMessage(
                            error.message
                        )
                    )
                )
            )
        }
    }

    private func timeout(
        requestId: String,
        requestGeneration: UUID,
        retireSession: Bool
    ) {
        let timeoutWon = finishPending(
            requestId: requestId,
            result: .failure(LauncherAgentError.requestTimedOut)
        )
        if timeoutWon && retireSession {
            retireCurrentProcess(expectedGeneration: requestGeneration)
        }
    }

    private func retireCurrentProcess(expectedGeneration: UUID? = nil) {
        if let expectedGeneration, expectedGeneration != generation {
            return
        }
        let retiredProcess = detachProcess()
        if let retiredProcess {
            beginRetirement(retiredProcess)
        }
    }

    private func beginRetirement(_ process: Process) {
        guard retirementState == nil else { return }
        stoppingProcess = process
        let token = UUID()
        let task = Task { [weak self] in
            guard let self else { return false }
            if let processTerminator = self.processTerminator {
                return await processTerminator(process)
            }
            return await self.terminateDetachedProcess(process)
        }
        retirementState = RetirementState(token: token, task: task)
    }

    private func awaitVerifiedRetirement() async -> Bool {
        guard let captured = retirementState else {
            return stoppingProcess?.isRunning != true
        }
        let exited = await captured.task.value
        guard exited else { return false }
        if retirementState?.token == captured.token {
            retirementState = nil
            stoppingProcess = nil
        }
        return true
    }

    private func terminateDetachedProcess(_ process: Process) async -> Bool {
        guard process.isRunning else { return true }
        process.terminate()
        if await waitForExit(process, timeoutNanoseconds: 500_000_000) {
            return true
        }
        if process.isRunning {
            Darwin.kill(process.processIdentifier, SIGKILL)
        }
        return await waitForExit(
            process,
            timeoutNanoseconds: 500_000_000
        )
    }

    private func waitForExit(
        _ process: Process,
        timeoutNanoseconds: UInt64
    ) async -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
        while process.isRunning,
              DispatchTime.now().uptimeNanoseconds < deadline {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return !process.isRunning
    }

    @discardableResult
    private func finishPending(
        requestId: String,
        result: Result<Data, Error>
    ) -> Bool {
        guard let pending = pending.removeValue(forKey: requestId) else {
            return false
        }
        pending.timeoutTask.cancel()
        pending.continuation.resume(with: result)
        return true
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
                    try await self?.startIfNeeded()
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

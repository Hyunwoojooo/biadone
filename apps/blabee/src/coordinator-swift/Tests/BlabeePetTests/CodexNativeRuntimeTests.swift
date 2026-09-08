import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct NativeRuntimeInvocation: Equatable, Sendable {
    let executablePath: String
    let arguments: [String]
    let timeoutMilliseconds: Int
}

private final class NativeRuntimeProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var storedProcessInvocations: [NativeRuntimeInvocation] = []
    private var storedPreflightInvocations: [NativeRuntimeInvocation] = []
    private var storedRevalidationCount = 0

    func recordProcess(executable: URL, arguments: [String], timeoutMilliseconds: Int) {
        lock.lock()
        storedProcessInvocations.append(NativeRuntimeInvocation(
            executablePath: executable.path,
            arguments: arguments,
            timeoutMilliseconds: timeoutMilliseconds
        ))
        lock.unlock()
    }

    func recordPreflight(executable: URL, timeoutMilliseconds: Int) {
        lock.lock()
        storedPreflightInvocations.append(NativeRuntimeInvocation(
            executablePath: executable.path,
            arguments: [],
            timeoutMilliseconds: timeoutMilliseconds
        ))
        lock.unlock()
    }

    func recordRevalidation() {
        lock.lock()
        storedRevalidationCount += 1
        lock.unlock()
    }

    var processInvocations: [NativeRuntimeInvocation] {
        lock.lock()
        defer { lock.unlock() }
        return storedProcessInvocations
    }

    var preflightInvocations: [NativeRuntimeInvocation] {
        lock.lock()
        defer { lock.unlock() }
        return storedPreflightInvocations
    }

    var revalidationCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return storedRevalidationCount
    }

    var versionProbeCount: Int {
        processInvocations.filter { $0.arguments == ["--version"] }.count
    }

    var queueCount: Int {
        processInvocations.filter { $0.arguments.first == "queue" }.count
    }
}

private final class NativeRuntimeFixture {
    let root: URL
    let failureDirectory: URL
    let sourceURL: URL

    init() throws {
        root = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-native-runtime-\(UUID().uuidString)", isDirectory: true)
        failureDirectory = root.appendingPathComponent("failures", isDirectory: true)
        sourceURL = root.appendingPathComponent("codex-fixture", isDirectory: false)
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        guard chmod(root.path, mode_t(0o700)) == 0 else {
            throw CoordinatorError("test_fixture_failed")
        }
        try Data("ordinary fixture bytes; never execute".utf8).write(to: sourceURL)
        guard chmod(sourceURL.path, mode_t(0o600)) == 0 else {
            throw CoordinatorError("test_fixture_failed")
        }
    }

    deinit { try? FileManager.default.removeItem(at: root) }

    func failureGuard() -> CodexNativeFailureGuard {
        CodexNativeFailureGuard(directoryURL: failureDirectory, policyRevision: "runtime-tests-v1")
    }

    func selection() -> CodexPluginSetupQualifiedExecutable {
        .testOnly(url: sourceURL, version: "0.153.4")
    }
}

private func makeNativeRuntime(
    fixture: NativeRuntimeFixture,
    probe: NativeRuntimeProbe,
    candidates: [URL]? = nil,
    qualifier: CodexNativeQualifying? = nil,
    revalidator: CodexPluginSetupExecutableRevalidating? = nil,
    processBehavior: CodexPluginSetupProcessRunning? = nil,
    preflightBehavior: CodexNativePreflight? = nil
) -> CodexNativeRuntime {
    let selectedCandidates = candidates ?? [fixture.sourceURL]
    let resolvedQualifier: CodexNativeQualifying
    if let qualifier {
        resolvedQualifier = qualifier
    } else {
        resolvedQualifier = { sourceURL, runner, preflight, timeout in
            try preflight(sourceURL, timeout)
            let result = try runner(sourceURL, ["--version"], timeout)
            guard result.exitCode == 0 else {
                throw CoordinatorError("managed_codex_version_probe_failed")
            }
            return .testOnly(url: sourceURL, version: "0.153.4")
        }
    }

    let resolvedRunner: CodexPluginSetupProcessRunning = { executable, arguments, timeout in
        probe.recordProcess(
            executable: executable,
            arguments: arguments,
            timeoutMilliseconds: timeout
        )
        if let processBehavior {
            return try processBehavior(executable, arguments, timeout)
        }
        if arguments == ["--version"] {
            return CodexPluginSetupProcessResult(
                exitCode: 0,
                stdout: Data("codex-cli 0.153.4\n".utf8)
            )
        }
        return CodexPluginSetupProcessResult(
            exitCode: 0,
            stdout: Data("{\"status\":\"accepted\"}".utf8)
        )
    }

    let resolvedPreflight: CodexNativePreflight = { executable, timeout in
        probe.recordPreflight(executable: executable, timeoutMilliseconds: timeout)
        try preflightBehavior?(executable, timeout)
    }

    let resolvedRevalidator: CodexPluginSetupExecutableRevalidating = { selection in
        probe.recordRevalidation()
        if let revalidator { return try revalidator(selection) }
        return selection.canonicalURL
    }

    return CodexNativeRuntime(
        candidates: { selectedCandidates },
        qualifier: resolvedQualifier,
        revalidator: resolvedRevalidator,
        processRunner: resolvedRunner,
        preflight: resolvedPreflight,
        failureGuard: fixture.failureGuard()
    )
}

private func capturedCoordinatorCode<T>(_ operation: () throws -> T) -> String? {
    do {
        _ = try operation()
        return nil
    } catch let error as CoordinatorError {
        return error.code
    } catch {
        return "unexpected:\(String(describing: error))"
    }
}

@Suite("Common native Codex runtime", .serialized)
struct CodexNativeRuntimeTests {
    @Test("Missing candidates use the distinct not-installed diagnostic")
    func missingCandidateIsNotInstalled() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            candidates: []
        )

        #expect(capturedCoordinatorCode {
            try runtime.qualify(timeoutMilliseconds: 1_000)
        } == "codex_native_not_installed")
        #expect(probe.preflightInvocations.isEmpty)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("An unsupported version remains a typed unqualified failure")
    func unsupportedVersionRemainsTyped() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            qualifier: { sourceURL, runner, preflight, timeout in
                try preflight(sourceURL, timeout)
                _ = try runner(sourceURL, ["--version"], timeout)
                throw CodexRuntimeTrustError.unsupportedVersion("9.9.9")
            }
        )

        #expect(capturedCoordinatorCode {
            try runtime.qualify(timeoutMilliseconds: 1_000)
        } == "codex_native_version_unqualified")
        #expect(probe.preflightInvocations.count == 1)
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 0)
    }

    @Test("Notarization failure blocks execution, persists, and only explicit retry clears it")
    func notarizationFailurePersistenceAndExplicitRetry() throws {
        let fixture = try NativeRuntimeFixture()
        let firstProbe = NativeRuntimeProbe()
        let failingRuntime = makeNativeRuntime(
            fixture: fixture,
            probe: firstProbe,
            preflightBehavior: { _, _ in
                throw CodexNativeDiagnostic.notarizationUnavailable.error
            }
        )

        #expect(capturedCoordinatorCode {
            try failingRuntime.qualify(timeoutMilliseconds: 1_000)
        } == "codex_native_notarization_unavailable")
        #expect(firstProbe.preflightInvocations.count == 1)
        #expect(firstProbe.processInvocations.isEmpty)

        let secondProbe = NativeRuntimeProbe()
        let recoveredRuntime = makeNativeRuntime(fixture: fixture, probe: secondProbe)
        #expect(capturedCoordinatorCode {
            try recoveredRuntime.qualify(timeoutMilliseconds: 1_000)
        } == "codex_native_notarization_unavailable")
        #expect(secondProbe.preflightInvocations.isEmpty)
        #expect(secondProbe.processInvocations.isEmpty)

        try recoveredRuntime.prepareExplicitRetry()
        let result = try recoveredRuntime.perform(
            arguments: ["queue", "--session", "session-1", "next"],
            timeoutMilliseconds: 1_000
        )
        #expect(result.exitCode == 0)
        #expect(secondProbe.preflightInvocations.count == 2)
        #expect(secondProbe.versionProbeCount == 1)
        #expect(secondProbe.queueCount == 1)
    }

    @Test("A signaled probe remains terminated even after its deadline passes")
    func signaledProbeIsNotMisreportedAsTimeout() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            processBehavior: { _, arguments, timeout in
                if arguments == ["--version"] {
                    usleep(useconds_t((timeout + 10) * 1_000))
                    return CodexPluginSetupProcessResult(
                        exitCode: 137,
                        stdout: Data(),
                        terminationSignal: SIGKILL
                    )
                }
                return CodexPluginSetupProcessResult(exitCode: 0, stdout: Data())
            }
        )

        #expect(capturedCoordinatorCode {
            try runtime.qualify(timeoutMilliseconds: 250)
        } == "codex_native_execution_terminated")
        #expect(probe.preflightInvocations.count == 1)
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 0)
    }

    @Test("An ordinary version-probe exit 137 is launch failure, not a signal")
    func normalProbeExit137IsNotTermination() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            processBehavior: { _, _, _ in
                CodexPluginSetupProcessResult(exitCode: 137, stdout: Data())
            }
        )

        #expect(capturedCoordinatorCode {
            try runtime.qualify(timeoutMilliseconds: 1_000)
        } == "codex_native_launch_unavailable")
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 0)
    }

    @Test("Run returns ordinary nonzero status and does not poison the next explicit run")
    func runReturnsNonzeroWithoutAutomaticRetryOrSuppression() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            processBehavior: { _, _, _ in
                CodexPluginSetupProcessResult(
                    exitCode: 137,
                    stdout: Data("{not-a-receipt".utf8)
                )
            }
        )
        let arguments = ["queue", "--session", "session-2", "next"]

        let first = try runtime.run(
            selection: fixture.selection(),
            arguments: arguments,
            timeoutMilliseconds: 1_000
        )
        #expect(first.exitCode == 137)
        #expect(first.terminationSignal == nil)
        #expect(probe.queueCount == 1)

        let secondInstance = makeNativeRuntime(fixture: fixture, probe: probe)
        let second = try secondInstance.run(
            selection: fixture.selection(),
            arguments: arguments,
            timeoutMilliseconds: 1_000
        )
        #expect(second.exitCode == 0)
        #expect(probe.queueCount == 2)
    }

    @Test("Perform sends one queue command even when the receipt is nonzero and ambiguous")
    func performSendsAtMostOneQueueCommand() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            processBehavior: { _, arguments, _ in
                if arguments == ["--version"] {
                    return CodexPluginSetupProcessResult(
                        exitCode: 0,
                        stdout: Data("codex-cli 0.153.4\n".utf8)
                    )
                }
                return CodexPluginSetupProcessResult(
                    exitCode: 17,
                    stdout: Data("{ambiguous".utf8)
                )
            }
        )

        let result = try runtime.perform(
            arguments: ["queue", "--session", "session-3", "next"],
            timeoutMilliseconds: 1_000
        )
        #expect(result.exitCode == 17)
        #expect(result.stdout == Data("{ambiguous".utf8))
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 1)
        #expect(probe.processInvocations.count == 2)
    }

    @Test("Run revalidates around preflight and sends exactly one command")
    func runRevalidatesAndSendsExactlyOnce() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe)

        let result = try runtime.run(
            selection: fixture.selection(),
            arguments: ["queue", "--session", "session-4", "next"],
            timeoutMilliseconds: 1_000
        )

        #expect(result.exitCode == 0)
        #expect(probe.revalidationCount == 2)
        #expect(probe.preflightInvocations.count == 1)
        #expect(probe.versionProbeCount == 0)
        #expect(probe.queueCount == 1)
        #expect(probe.processInvocations.count == 1)
    }

    @Test("Native dispatcher budgets qualification separately and caps the queue child at ten seconds")
    func dispatcherSeparatesQualificationAndQueueBudgets() async throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let sessionID = "session-budget-test"
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            qualifier: { sourceURL, runner, preflight, timeout in
                #expect(timeout > 40_000 && timeout <= 45_000)
                try preflight(sourceURL, min(timeout, 5_000))
                _ = try runner(sourceURL, ["--version"], min(timeout, 5_000))
                return .testOnly(url: sourceURL, version: "0.153.4")
            },
            processBehavior: { _, arguments, _ in
                CodexPluginSetupProcessResult(
                    exitCode: 0,
                    stdout: Data((arguments == ["--version"]
                        ? "codex-cli 0.153.4\n"
                        : "Queued message submission-budget-test for thread \(sessionID).\n").utf8)
                )
            }
        )
        let dispatcher = CodexQueueNextTurnDispatcher(nativeRuntime: runtime)
        let receipt = try await dispatcher.dispatch(CoordinatorNextTurnDispatchRequest(
            sessionID: sessionID, message: "read-only test action",
            continuationID: "continuation-budget-test"
        ))
        #expect(receipt.queuedSubmissionID == "submission-budget-test")
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 1)
        #expect(probe.revalidationCount == 2)
        #expect(probe.processInvocations.first?.timeoutMilliseconds ?? 0 <= 5_000)
        #expect(probe.processInvocations.last?.timeoutMilliseconds == 10_000)
    }

    @Test("The queue child cannot outlive the remaining overall operation budget")
    func remainingOverallBudgetStillBoundsCommand() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe)
        _ = try runtime.perform(
            arguments: ["queue", "--thread", "session-budget", "--message", "test"],
            timeoutMilliseconds: 1_000, commandTimeoutMilliseconds: 10_000
        )
        let command = try #require(probe.processInvocations.last)
        #expect(command.arguments.first == "queue")
        #expect(command.timeoutMilliseconds > 0 && command.timeoutMilliseconds <= 1_000)
    }

    @Test("Expired trust inspection never starts a queue command or automatically retries it")
    func expiredInspectionDoesNotQueue() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            revalidator: { selection in
                usleep(100_000)
                return selection.canonicalURL
            }
        )
        for _ in 0..<2 {
            #expect(capturedCoordinatorCode {
                try runtime.run(
                    selection: fixture.selection(),
                    arguments: ["queue", "--thread", "session-expired"],
                    timeoutMilliseconds: 50, commandTimeoutMilliseconds: 10_000
                )
            } == "codex_native_probe_timeout")
        }
        #expect(probe.revalidationCount == 1)
        #expect(probe.queueCount == 0)
    }

    @Test("A command timeout is not retried after increasing the qualification budget")
    func commandTimeoutIsStillSuppressed() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            processBehavior: { _, arguments, timeout in
                if arguments.first == "queue" {
                    #expect(timeout == 10_000)
                    throw CoordinatorError("managed_codex_version_probe_timeout")
                }
                return CodexPluginSetupProcessResult(exitCode: 0, stdout: Data())
            }
        )
        for _ in 0..<2 {
            #expect(capturedCoordinatorCode {
                try runtime.perform(
                    arguments: ["queue", "--thread", "session-timeout"],
                    timeoutMilliseconds: 45_000, commandTimeoutMilliseconds: 10_000
                )
            } == "codex_native_probe_timeout")
        }
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 1)
    }

    @Test("A file change across preflight still prevents queue execution")
    func revalidationDriftStillBlocksQueue() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            revalidator: { selection in
                if probe.revalidationCount > 1 {
                    throw CodexRuntimeTrustError.changedDuringQualification
                }
                return selection.canonicalURL
            }
        )
        #expect(capturedCoordinatorCode {
            try runtime.run(
                selection: fixture.selection(), arguments: ["queue"],
                timeoutMilliseconds: 45_000, commandTimeoutMilliseconds: 10_000
            )
        } == "codex_native_binary_changed")
        #expect(probe.revalidationCount == 2)
        #expect(probe.preflightInvocations.count == 1)
        #expect(probe.queueCount == 0)
    }
}

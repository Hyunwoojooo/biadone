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

private func nativeDispatchFailure(
    _ dispatcher: CodexQueueNextTurnDispatcher,
    request: CoordinatorNextTurnDispatchRequest
) async throws -> CoordinatorNextTurnDispatchFailure {
    var observed: CoordinatorNextTurnDispatchFailure?
    do { _ = try await dispatcher.dispatch(request) }
    catch { observed = error.coordinatorError.dispatchFailure }
    return try #require(observed)
}

@Test("Product permission is rechecked after native preparation without poisoning binary trust")
func nativeRuntimeProductAccessBeforeCommand() throws {
    let fixture = try NativeRuntimeFixture(), probe = NativeRuntimeProbe()
    let runtime = makeNativeRuntime(fixture: fixture, probe: probe)
    let result = capturedCoordinatorCode {
        try runtime.perform(arguments: ["queue", "--thread", "fixture"], timeoutMilliseconds: 5_000,
            beforeCommand: { throw CoordinatorError("product_access_changed") })
    }
    #expect(result == "product_access_changed")
    #expect(probe.queueCount == 0)
    // The next explicitly authorized request still qualifies. A denied
    // account did not persist a launch/signature failure against Codex.
    _ = try runtime.perform(arguments: ["queue", "--thread", "fixture"], timeoutMilliseconds: 5_000)
    #expect(probe.queueCount == 1)
}

private func capturedQualificationFailure<T>(
    _ operation: () throws -> T
) throws -> CodexNativeQualificationFailure {
    var observed: CodexNativeQualificationFailure?
    do { _ = try operation() }
    catch { observed = error as? CodexNativeQualificationFailure }
    return try #require(observed)
}

@Suite("Common native Codex runtime", .serialized)
struct CodexNativeRuntimeTests {
    @Test("A native preflight failure and its cached block never submit a queue request")
    func dispatcherRecordsPreflightAndCachedBlockThenExplicitRecovery() async throws {
        let fixture = try NativeRuntimeFixture(), failedProbe = NativeRuntimeProbe()
        let failedRuntime = makeNativeRuntime(fixture: fixture, probe: failedProbe,
            preflightBehavior: { _, _ in throw CodexNativeDiagnostic.notarizationUnavailable.error })
        let request = CoordinatorNextTurnDispatchRequest(
            sessionID: "session-recovery", message: "old action must never be replayed",
            continuationID: "old-continuation")
        let first = try await nativeDispatchFailure(
            CodexQueueNextTurnDispatcher(nativeRuntime: failedRuntime), request: request)
        #expect(first.code == "codex_native_notarization_unavailable")
        #expect(first.stage == .notarization)
        #expect(first.deliveryState == .notSubmitted)
        #expect(!first.commandInvocationAttempted)
        #expect(!first.cachedFailure)
        #expect(first.codexVersion == nil)
        #expect(first.executableIdentity?.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil)
        #expect(failedProbe.queueCount == 0)

        let recoveredProbe = NativeRuntimeProbe()
        let recoveredRuntime = makeNativeRuntime(fixture: fixture, probe: recoveredProbe,
            processBehavior: { _, arguments, _ in
                .init(exitCode: 0, stdout: Data((arguments == ["--version"]
                    ? "codex-cli 0.153.4\n"
                    : "Queued message fresh-submission for thread session-recovery.\n").utf8))
            })
        let dispatcher = CodexQueueNextTurnDispatcher(nativeRuntime: recoveredRuntime)
        let cached = try await nativeDispatchFailure(dispatcher, request: request)
        #expect(cached.code == first.code)
        #expect(cached.stage == .qualification)
        #expect(cached.deliveryState == .notSubmitted)
        #expect(cached.cachedFailure)
        #expect(cached.codexVersion == nil)
        #expect(cached.executableIdentity == first.executableIdentity)
        #expect(recoveredProbe.processInvocations.isEmpty)
        #expect(recoveredProbe.preflightInvocations.isEmpty)

        try recoveredRuntime.prepareExplicitRetry()
        _ = try recoveredRuntime.qualify(timeoutMilliseconds: 1_000)
        #expect(recoveredProbe.queueCount == 0)
        let fresh = CoordinatorNextTurnDispatchRequest(
            sessionID: "session-recovery", message: "fresh explicitly selected action",
            continuationID: "fresh-continuation")
        let receipt = try await dispatcher.dispatch(fresh)
        #expect(receipt.queuedSubmissionID == "fresh-submission")
        #expect(recoveredProbe.queueCount == 1)
        #expect(recoveredProbe.processInvocations.last?.arguments == [
            "queue", "--thread", fresh.sessionID, "--message", fresh.message,
        ])
        #expect(!recoveredProbe.processInvocations.contains { $0.arguments.contains(request.message) })
    }

    @Test("Native command timeout is unknown once and its later cached block submits nothing")
    func dispatcherTimeoutDoesNotImplyNonDeliveryOrReplay() async throws {
        let fixture = try NativeRuntimeFixture(), probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe,
            processBehavior: { _, arguments, _ in
                if arguments.first == "queue" {
                    throw CoordinatorError("managed_codex_version_probe_timeout")
                }
                return .init(exitCode: 0, stdout: Data("codex-cli 0.153.4\n".utf8))
            })
        let dispatcher = CodexQueueNextTurnDispatcher(nativeRuntime: runtime)
        let request = CoordinatorNextTurnDispatchRequest(
            sessionID: "session-timeout", message: "never automatically resend", continuationID: "timeout")
        let first = try await nativeDispatchFailure(dispatcher, request: request)
        #expect(first.code == "codex_native_probe_timeout")
        #expect(first.stage == .command)
        #expect(first.deliveryState == .unknown)
        #expect(first.commandInvocationAttempted)
        #expect(first.exitCode == nil)
        #expect(!first.cachedFailure)
        #expect(first.codexVersion == "0.153.4")
        #expect(first.executableIdentity?.count == 64)
        let blocked = try await nativeDispatchFailure(dispatcher, request: request)
        #expect(blocked.code == first.code)
        #expect(blocked.stage == .qualification)
        #expect(blocked.deliveryState == .notSubmitted)
        #expect(blocked.cachedFailure)
        #expect(blocked.codexVersion == nil)
        #expect(blocked.executableIdentity == first.executableIdentity)
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 1)
    }

    @Test("Permission loss is observed before command invocation and does not poison native trust",
          arguments: [false, true])
    func dispatcherAccessFailureNeverInvokesQueue(initialFailure: Bool) async throws {
        let fixture = try NativeRuntimeFixture(), probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe)
        let dispatcher = CodexQueueNextTurnDispatcher(nativeRuntime: runtime, productAccessCheck: {
            if initialFailure { throw CoordinatorError("product_access_denied") }
            return probe.versionProbeCount == 0 ? 1 : 2
        })
        let failure = try await nativeDispatchFailure(dispatcher, request: .init(
            sessionID: "session-access", message: "not submitted", continuationID: "access"))
        #expect(failure.code == (initialFailure ? "product_access_denied" : "product_access_changed"))
        #expect(failure.stage == .access)
        #expect(failure.deliveryState == .notSubmitted)
        #expect(!failure.cachedFailure)
        #expect(probe.queueCount == 0)
        #expect(probe.versionProbeCount == (initialFailure ? 0 : 1))
        _ = try runtime.qualify(timeoutMilliseconds: 1_000)
        #expect(probe.versionProbeCount == (initialFailure ? 1 : 2))
        #expect(probe.queueCount == 0)
    }

    @Test("The invocation marker follows both access checks and the remaining command deadline")
    func expiredBeforeCommandNeverMarksInvocation() throws {
        let fixture = try NativeRuntimeFixture(), probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe)
        let observations = CodexNativeOperationObservations()
        #expect(capturedCoordinatorCode {
            try runtime.run(selection: fixture.selection(), arguments: ["queue"], timeoutMilliseconds: 30,
                beforeCommand: { usleep(60_000) }, observer: { observations.replace($0) })
        } == "codex_native_probe_timeout")
        #expect(observations.snapshot().stage == .command)
        #expect(!observations.snapshot().commandInvocationAttempted)
        #expect(probe.queueCount == 0)
    }

    @Test("Native signal evidence survives normalization without treating exit 137 as a signal")
    func dispatcherRecordsNativeSignalAndOrdinaryExitSeparately() async throws {
        let signals: [Int32?] = [nil, SIGKILL]
        for signal in signals {
            let fixture = try NativeRuntimeFixture(), probe = NativeRuntimeProbe()
            let runtime = makeNativeRuntime(fixture: fixture, probe: probe,
                processBehavior: { _, arguments, _ in
                    if arguments == ["--version"] {
                        return .init(exitCode: 0, stdout: Data("codex-cli 0.153.4\n".utf8))
                    }
                    return .init(exitCode: 137, stdout: Data(), terminationSignal: signal)
                })
            let failure = try await nativeDispatchFailure(
                CodexQueueNextTurnDispatcher(nativeRuntime: runtime), request: .init(
                    sessionID: "session-signal", message: "selected action", continuationID: "signal"))
            #expect(failure.code == (signal == nil ? "codex_queue_process_failed" : "codex_native_execution_terminated"))
            #expect(failure.stage == (signal == nil ? .queueExit : .command))
            #expect(failure.deliveryState == .unknown)
            #expect(failure.exitCode == 137)
            #expect(failure.terminationSignal == signal)
            #expect(failure.codexVersion == "0.153.4")
            #expect(probe.queueCount == 1)
        }
    }

    @Test("Discovery reports the chosen failure's stage instead of a later rejected candidate")
    func operationEvidenceBelongsToReturnedCandidate() async throws {
        let fixture = try NativeRuntimeFixture(), probe = NativeRuntimeProbe()
        let first = fixture.sourceURL
        let second = fixture.root.appendingPathComponent("second-candidate")
        try Data("inert candidate".utf8).write(to: second)
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe, candidates: [first, second],
            qualifier: { source, _, preflight, timeout in
                try preflight(source, timeout)
                throw CodexRuntimeTrustError.unsupportedVersion("9.9.9")
            }, preflightBehavior: { source, _ in
                if source == first { throw CodexNativeDiagnostic.notarizationUnavailable.error }
            })
        let failure = try await nativeDispatchFailure(
            CodexQueueNextTurnDispatcher(nativeRuntime: runtime), request: .init(
                sessionID: "session-candidates", message: "never sent", continuationID: "candidates"))
        #expect(failure.code == "codex_native_notarization_unavailable")
        #expect(failure.stage == .notarization)
        #expect(!failure.cachedFailure)
        #expect(failure.deliveryState == .notSubmitted)
        #expect(failure.codexVersion == nil)
        #expect(probe.preflightInvocations.map(\.executablePath) == [first.path, second.path])
        #expect(probe.queueCount == 0)
    }

    @Test("Failed qualification keeps the observed version and paths without a second probe")
    func failedQualificationRetainsObservedVersion() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            qualifier: { sourceURL, runner, preflight, timeout in
                try preflight(sourceURL, timeout)
                let result = try runner(sourceURL, ["--version"], timeout)
                _ = try CodexPluginSetupProductionTrust.supportedVersion(from: result)
                return .testOnly(url: sourceURL)
            },
            processBehavior: { _, _, _ in
                .init(exitCode: 0, stdout: Data("codex-cli 9.9.9\n".utf8))
            }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == .versionUnqualified)
        #expect(failure.evidence.sourcePath == fixture.sourceURL.path)
        #expect(failure.evidence.canonicalPath == fixture.sourceURL.path)
        #expect(failure.evidence.codexVersion == "9.9.9")
        #expect(CodexNativeDiagnostic.normalize(failure).code == failure.diagnostic.rawValue)
        #expect(probe.preflightInvocations.count == 1)
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 0)
    }

    @Test("Pre-probe rejection records only the attempted source and never invents a resolved path")
    func failedQualificationBeforeInspectionHasNoProbeEvidence() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            qualifier: { _, _, _, _ in throw CodexNativeDiagnostic.pathUnsafe.error }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == .pathUnsafe)
        #expect(failure.evidence.sourcePath == fixture.sourceURL.path)
        #expect(failure.evidence.canonicalPath == nil)
        #expect(failure.evidence.codexVersion == nil)
        #expect(probe.preflightInvocations.isEmpty)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("Path rejection keeps a bounded reason without changing the public error code",
          arguments: [CodexRuntimePathIssue.untrustedOwner, .groupWritable, .aclUnreadable, .linkUnresolved])
    func failedQualificationRetainsPathReason(_ issue: CodexRuntimePathIssue) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let rejectedPath = fixture.sourceURL.deletingLastPathComponent().path
        let pathDiagnostic = CodexRuntimePathDiagnostic(
            issue: issue, role: .sourceAncestor, path: rejectedPath
        )
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            qualifier: { _, _, _, _ in
                throw CodexRuntimeTrustError.unsafePath(
                    "raw diagnostic must stay private", diagnostic: pathDiagnostic
                )
            }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == .pathUnsafe)
        #expect(CodexNativeDiagnostic.normalize(failure).code == "codex_native_path_unsafe")
        #expect(failure.evidence.pathDiagnostic == pathDiagnostic)
        #expect(failure.evidence.sourcePath == fixture.sourceURL.path)
        #expect(failure.evidence.canonicalPath == nil)
        #expect(failure.evidence.codexVersion == nil)
        #expect(probe.preflightInvocations.isEmpty)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("Mutation and shim failures retain their specific inspection reason",
          arguments: [CodexRuntimeTrustError.changedDuringInspection, .changedDuringQualification,
                      .approvalDrift, .dynamicShim("configured")])
    func failureRetainsStructuralReason(_ trustError: CodexRuntimeTrustError) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            qualifier: { _, _, _, _ in throw trustError }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.evidence.pathDiagnostic == trustError.pathDiagnostic)
        #expect(failure.evidence.pathDiagnostic != nil)
        #expect(failure.diagnostic.error.code == CodexNativeDiagnostic.normalize(trustError).code)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("Path diagnostics stay attached to the first failed candidate and do not block a safe fallback",
          arguments: [false, true])
    func pathDiagnosticPreservesCandidateFallback(secondIsSafe: Bool) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let first = fixture.sourceURL
        let second = fixture.root.appendingPathComponent("second-codex-fixture")
        try Data("inert second fixture".utf8).write(to: second)
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe, candidates: [first, second],
            qualifier: { url, _, _, _ in
                if url == second && secondIsSafe { return .testOnly(url: second) }
                throw CodexRuntimeTrustError.unsafePath(
                    "unsafe candidate",
                    diagnostic: .init(
                        issue: url == first ? .groupWritable : .untrustedOwner,
                        role: .source, path: url.path
                    )
                )
            }
        )
        if secondIsSafe {
            let selection = try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
            #expect(selection.sourceURL == second)
        } else {
            let failure = try capturedQualificationFailure {
                try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
            }
            #expect(failure.evidence.sourcePath == first.path)
            #expect(failure.evidence.pathDiagnostic == .init(
                issue: .groupWritable, role: .source, path: first.path
            ))
        }
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("Dangling preferred links retain diagnosis and never prevent a valid fallback",
          arguments: [false, true])
    func danglingLinkDiagnosisWithoutExecution(hasFallback: Bool) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let dangling = fixture.root.appendingPathComponent("dangling-codex")
        try FileManager.default.createSymbolicLink(
            at: dangling, withDestinationURL: fixture.root.appendingPathComponent("absent-codex")
        )
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            candidates: hasFallback ? [dangling, fixture.sourceURL] : [dangling]
        )
        if hasFallback {
            let selection = try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
            #expect(selection.sourceURL == fixture.sourceURL)
            #expect(probe.versionProbeCount == 1)
            #expect(probe.processInvocations.allSatisfy { $0.executablePath == fixture.sourceURL.path })
        } else {
            let failure = try capturedQualificationFailure {
                try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
            }
            #expect(failure.diagnostic == .pathUnsafe)
            #expect(failure.evidence.sourcePath == dangling.path)
            #expect(failure.evidence.canonicalPath == nil)
            #expect(failure.evidence.pathDiagnostic == .init(
                issue: .linkUnresolved, role: .source, path: dangling.path
            ))
            #expect(probe.processInvocations.isEmpty)
        }
        #expect(!probe.preflightInvocations.contains { $0.executablePath == dangling.path })
    }

    @Test("Unreadable preferred candidates retain path diagnosis and allow a readable fallback",
          .enabled(if: geteuid() != 0), arguments: [false, true])
    func unreadableCandidateDiagnosisAndFallback(hasFallback: Bool) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let unreadable = fixture.root.appendingPathComponent("unreadable-codex")
        try Data("inert unreadable fixture".utf8).write(to: unreadable)
        try #require(chmod(unreadable.path, mode_t(0o000)) == 0)
        defer { _ = chmod(unreadable.path, mode_t(0o600)) }
        try #require(access(unreadable.path, R_OK) != 0)
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            candidates: hasFallback ? [unreadable, fixture.sourceURL] : [unreadable]
        )

        if hasFallback {
            let selection = try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
            #expect(selection.sourceURL == fixture.sourceURL)
            #expect(probe.versionProbeCount == 1)
            #expect(probe.processInvocations.allSatisfy { $0.executablePath == fixture.sourceURL.path })
        } else {
            let failure = try capturedQualificationFailure {
                try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
            }
            #expect(failure.diagnostic == .pathUnsafe)
            #expect(failure.evidence.sourcePath == unreadable.path)
            #expect(failure.evidence.canonicalPath == nil)
            #expect(failure.evidence.pathDiagnostic == .init(
                issue: .inspectionUnavailable, role: .source, path: unreadable.path
            ))
            #expect(!failure.operationObservation.cachedFailure)
            #expect(!failure.operationObservation.commandInvocationAttempted)
            #expect(probe.processInvocations.isEmpty)
        }
        #expect(!probe.preflightInvocations.contains { $0.executablePath == unreadable.path })
        #expect(probe.queueCount == 0)
        let records = try FileManager.default.contentsOfDirectory(
            at: fixture.failureDirectory, includingPropertiesForKeys: nil
        ).filter { $0.lastPathComponent.hasPrefix("failure-") }
        #expect(records.isEmpty)
    }

    @Test("Malformed or unsuccessful version output is never retained as diagnostic evidence",
          arguments: ["malformed", "oversized", "nonzero", "signaled"])
    func failedProbeDoesNotRetainRawOutput(_ scenario: String) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe,
            qualifier: { sourceURL, runner, preflight, timeout in
                try preflight(sourceURL, timeout)
                let result = try runner(sourceURL, ["--version"], timeout)
                let version = try CodexPluginSetupProductionTrust.supportedVersion(from: result)
                return .testOnly(url: sourceURL, version: version)
            },
            processBehavior: { _, _, _ in
                .init(
                    exitCode: scenario == "nonzero" ? 1 : 0,
                    stdout: Data((scenario == "malformed"
                        ? "codex-cli 9.9.9\nTOKEN=private-secret"
                        : scenario == "oversized"
                            ? "codex-cli " + String(repeating: "9", count: 4_096) + ".9.9"
                            : "codex-cli 9.9.9\n").utf8),
                    terminationSignal: scenario == "signaled" ? SIGKILL : nil
                )
            }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.evidence.codexVersion == nil)
        #expect(failure.evidence.canonicalPath == fixture.sourceURL.path)
        #expect(probe.versionProbeCount == 1)
        #expect(probe.queueCount == 0)
    }

    @Test("Discovery keeps observations with the first ordinary failure or the later terminal failure",
          arguments: [false, true])
    func failedCandidatesDoNotMixEvidence(terminalSecond: Bool) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let second = fixture.root.appendingPathComponent("second-codex-fixture")
        try Data("inert second fixture".utf8).write(to: second)
        let first = fixture.sourceURL
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe, candidates: [first, second],
            qualifier: { sourceURL, runner, preflight, timeout in
                try preflight(sourceURL, timeout)
                let result = try runner(sourceURL, ["--version"], timeout)
                _ = try CodexPluginSetupProductionTrust.supportedVersion(from: result)
                return .testOnly(url: sourceURL)
            },
            processBehavior: { _, _, _ in
                .init(exitCode: 0, stdout: Data("codex-cli 9.9.9\n".utf8))
            },
            preflightBehavior: { executable, _ in
                if executable == second {
                    throw (terminalSecond ? CodexNativeDiagnostic.probeTimeout : .notarizationUnavailable).error
                }
            }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == (terminalSecond ? .probeTimeout : .versionUnqualified))
        #expect(failure.evidence.sourcePath == (terminalSecond ? second.path : first.path))
        #expect(failure.evidence.canonicalPath == (terminalSecond ? second.path : first.path))
        #expect(failure.evidence.codexVersion == (terminalSecond ? nil : "9.9.9"))
        #expect(probe.preflightInvocations.map(\.executablePath) == [first.path, second.path])
        #expect(probe.versionProbeCount == 1)
    }

    @Test("Observed terminal failures retain discovery's stop boundary",
          arguments: [CodexNativeDiagnostic.probeTimeout, .guardUnavailable, .executionInProgress])
    func observedTerminalFailureStopsDiscovery(_ diagnostic: CodexNativeDiagnostic) throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let second = fixture.root.appendingPathComponent("never-probed-codex-fixture")
        try Data("inert second fixture".utf8).write(to: second)
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe, candidates: [fixture.sourceURL, second],
            preflightBehavior: { _, _ in throw diagnostic.error }
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == diagnostic)
        #expect(failure.evidence.sourcePath == fixture.sourceURL.path)
        #expect(probe.preflightInvocations.count == 1)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("Unsafe guard storage prevents candidate fallback before any executable inspection")
    func unsafeGuardStorageStopsCandidateFallback() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let second = fixture.root.appendingPathComponent("never-probed-codex-fixture")
        try Data("inert second fixture".utf8).write(to: second)
        try FileManager.default.createDirectory(
            at: fixture.failureDirectory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        try #require(chmod(fixture.failureDirectory.path, mode_t(0o777)) == 0)
        defer { _ = chmod(fixture.failureDirectory.path, mode_t(0o700)) }
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe, candidates: [fixture.sourceURL, second]
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == .guardUnavailable)
        #expect(failure.evidence.sourcePath == fixture.sourceURL.path)
        #expect(failure.evidence.pathDiagnostic == nil)
        #expect(!failure.operationObservation.cachedFailure)
        #expect(probe.preflightInvocations.isEmpty)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("A cached timeout keeps the terminal discovery boundary without probing another candidate")
    func cachedTimeoutStopsCandidateFallback() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let second = fixture.root.appendingPathComponent("never-probed-codex-fixture")
        try Data("inert second fixture".utf8).write(to: second)
        #expect(throws: CodexNativeDiagnostic.probeTimeout.error) {
            try fixture.failureGuard().withAttempt(executable: fixture.sourceURL) {
                throw CodexNativeDiagnostic.probeTimeout.error
            }
        }
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe, candidates: [fixture.sourceURL, second]
        )
        let failure = try capturedQualificationFailure {
            try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        }
        #expect(failure.diagnostic == .probeTimeout)
        #expect(failure.evidence.sourcePath == fixture.sourceURL.path)
        #expect(failure.operationObservation.cachedFailure)
        #expect(!failure.operationObservation.commandInvocationAttempted)
        #expect(probe.preflightInvocations.isEmpty)
        #expect(probe.processInvocations.isEmpty)
    }

    @Test("A failed preferred candidate never contaminates a later qualified selection")
    func laterQualifiedCandidateRemainsAuthoritative() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let second = fixture.root.appendingPathComponent("qualified-codex-fixture")
        try Data("inert second fixture".utf8).write(to: second)
        let first = fixture.sourceURL
        let runtime = makeNativeRuntime(
            fixture: fixture, probe: probe, candidates: [first, second],
            qualifier: { sourceURL, _, _, _ in
                if sourceURL == first { throw CodexRuntimeTrustError.unsupportedVersion("9.9.9") }
                return .testOnly(url: sourceURL, version: "0.155.1")
            }
        )
        let selection = try runtime.qualifyWithEvidence(timeoutMilliseconds: 1_000)
        #expect(selection.sourceURL == second)
        #expect(selection.version == "0.155.1")
        #expect(probe.processInvocations.isEmpty)
    }

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

    @Test("An unreadable selected executable keeps its native path diagnosis without invoking a command",
          .enabled(if: geteuid() != 0))
    func runRejectsUnreadableSelectedExecutable() throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let runtime = makeNativeRuntime(fixture: fixture, probe: probe)
        let selection = fixture.selection()
        try #require(chmod(fixture.sourceURL.path, mode_t(0o000)) == 0)
        defer { _ = chmod(fixture.sourceURL.path, mode_t(0o600)) }
        try #require(access(fixture.sourceURL.path, R_OK) != 0)

        #expect(capturedCoordinatorCode {
            try runtime.run(selection: selection,
                arguments: ["queue", "--session", "unreadable-fixture", "next"],
                timeoutMilliseconds: 1_000)
        } == CodexNativeDiagnostic.pathUnsafe.rawValue)
        #expect(probe.revalidationCount == 0)
        #expect(probe.preflightInvocations.isEmpty)
        #expect(probe.processInvocations.isEmpty)
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

    @Test("Native dispatcher budgets qualification separately and caps the queue child at ten seconds",
          arguments: ["0.153.4", "0.154.0"])
    func dispatcherSeparatesQualificationAndQueueBudgets(version: String) async throws {
        let fixture = try NativeRuntimeFixture()
        let probe = NativeRuntimeProbe()
        let sessionID = "session-budget-test"
        let runtime = makeNativeRuntime(
            fixture: fixture,
            probe: probe,
            qualifier: { sourceURL, runner, preflight, timeout in
                #expect(timeout > 40_000 && timeout <= 45_000)
                try preflight(sourceURL, min(timeout, 5_000))
                let result = try runner(sourceURL, ["--version"], min(timeout, 5_000))
                let qualifiedVersion = try CodexPluginSetupProductionTrust.supportedVersion(from: result)
                #expect(qualifiedVersion == version)
                return .testOnly(url: sourceURL, version: qualifiedVersion)
            },
            processBehavior: { _, arguments, _ in
                CodexPluginSetupProcessResult(
                    exitCode: 0,
                    stdout: Data((arguments == ["--version"]
                        ? "codex-cli \(version)\n"
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

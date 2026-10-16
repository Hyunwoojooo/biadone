import CoordinatorSwift
import Darwin
import Foundation

/// Stable, non-sensitive diagnostics shared by Plugin setup and next-turn delivery.
/// A killed process is not proof of malware or even of Gatekeeper: retain that
/// uncertainty instead of relabelling every launch failure as an unsupported version.
enum CodexNativeDiagnostic: String, CaseIterable, Sendable {
    case notInstalled = "codex_native_not_installed"
    case versionUnqualified = "codex_native_version_unqualified"
    case signatureInvalid = "codex_native_signature_invalid"
    case pathUnsafe = "codex_native_path_unsafe"
    case notarizationUnavailable = "codex_native_notarization_unavailable"
    case executionTerminated = "codex_native_execution_terminated"
    case launchUnavailable = "codex_native_launch_unavailable"
    case probeTimeout = "codex_native_probe_timeout"
    case probeOutputInvalid = "codex_native_probe_output_invalid"
    case binaryChanged = "codex_native_binary_changed"
    case guardUnavailable = "codex_native_guard_unavailable"
    case executionUncertain = "codex_native_execution_uncertain"
    case executionInProgress = "codex_native_execution_in_progress"

    var detail: String {
        switch self {
        case .notInstalled:
            PetL10n.text("Codex executable not found. Install official Codex, then check again.", korean: "Codex 실행 파일을 찾지 못했습니다. 공식 Codex 설치 후 다시 검사하세요.")
        case .versionUnqualified:
            PetL10n.text("Blabee compatibility with the installed Codex version has not been verified yet. Standard Codex settings were not changed.", korean: "설치된 Codex 버전의 Blabee 호환성이 아직 검증되지 않았습니다. 일반 Codex 설정은 변경하지 않았습니다.")
        case .signatureInvalid:
            PetL10n.text("Unable to verify Codex's official signature. Check the official installation and retry.", korean: "Codex의 공식 서명을 확인하지 못했습니다. 공식 설치본을 확인한 뒤 다시 검사하세요.")
        case .pathUnsafe:
            PetL10n.text("Unable to verify ownership or safety of the Codex execution path. Check the official installation path.", korean: "Codex 실행 경로의 소유권 또는 안전성을 확인하지 못했습니다. 공식 설치 경로를 확인하세요.")
        case .notarizationUnavailable:
            PetL10n.text("Codex execution was deferred because Apple notarization could not be verified. Check the network and official installation, then retry. This does not establish that the file is unnotarized or malicious.", korean: "Apple 공증을 확인하지 못해 Codex 실행을 보류했습니다. 네트워크와 공식 설치본을 확인한 뒤 다시 검사하세요. 미공증·악성 파일이라고 확정한 것은 아닙니다.")
        case .executionTerminated:
            PetL10n.text("Codex was forcibly terminated. Check for macOS security warnings. Automatic retries of the same file have stopped; check again after resolving the issue.", korean: "Codex 실행이 강제로 종료되었습니다. macOS 보안 경고 여부를 확인하세요. 같은 파일의 자동 재시도는 중단했으며, 해결 후 다시 검사할 수 있습니다.")
        case .launchUnavailable:
            PetL10n.text("Unable to start Codex. Check installation and macOS security settings, then retry.", korean: "Codex 프로세스를 시작하지 못했습니다. 설치 상태와 macOS 보안 설정을 확인한 뒤 다시 검사하세요.")
        case .probeTimeout:
            PetL10n.text("Codex checking or execution timed out. It will not run again automatically. Check the cause before retrying.", korean: "Codex 검사 또는 실행이 제한 시간을 초과했습니다. 자동으로 다시 실행하지 않습니다. 원인을 확인한 뒤 다시 검사하세요.")
        case .probeOutputInvalid:
            PetL10n.text("Unable to verify Codex's version or check response. Compatibility verification is required.", korean: "Codex의 버전 또는 검사 응답을 확인하지 못했습니다. 호환성 검증이 필요합니다.")
        case .binaryChanged:
            PetL10n.text("Codex files changed during the check. Retry after the update finishes.", korean: "검사 중 Codex 파일이 변경되었습니다. 업데이트가 끝난 뒤 다시 검사하세요.")
        case .guardUnavailable:
            PetL10n.text("Unable to safely verify the Codex retry-protection record. Connection is deferred to avoid repeated execution.", korean: "Codex 재시도 보호 기록을 안전하게 확인하지 못했습니다. 반복 실행을 막기 위해 연결을 보류합니다.")
        case .executionInProgress:
            PetL10n.text("Another Codex check is in progress. Retry after it finishes. This request was not sent.", korean: "다른 Codex 검사가 진행 중입니다. 완료된 뒤 다시 시도하세요. 이번 요청은 전송하지 않았습니다.")
        case .executionUncertain:
            PetL10n.text("Unable to determine whether the previous Codex invocation ended. It will not be resent automatically. Check the original session before retrying.", korean: "이전 Codex 호출의 종료 여부를 확인할 수 없습니다. 자동 재전송하지 않습니다. 원래 세션을 확인한 뒤 다시 검사하세요.")
        }
    }

    var error: CoordinatorError { CoordinatorError(rawValue) }

    static func normalize(_ error: Error) -> CoordinatorError {
        if let failure = error as? CodexNativeQualificationFailure {
            return failure.diagnostic.error
        }
        if let error = error as? CodexRuntimeTrustError {
            switch error {
            case .unsupportedVersion(let version):
                return (version == nil ? Self.probeOutputInvalid : .versionUnqualified).error
            case .changedDuringInspection, .changedDuringQualification, .approvalDrift:
                return Self.binaryChanged.error
            default:
                return Self.pathUnsafe.error
            }
        }
        let code = error.coordinatorError.code
        if let diagnostic = Self(rawValue: code) { return diagnostic.error }
        switch code {
        case "codex_plugin_setup_executable_unavailable", "codex_queue_executable_unavailable":
            return Self.notInstalled.error
        case "codex_plugin_setup_signature_invalid":
            return Self.signatureInvalid.error
        case "codex_plugin_setup_operation_timed_out", "managed_codex_version_probe_timeout":
            return Self.probeTimeout.error
        case "managed_codex_version_probe_output_too_large", "managed_codex_version_probe_output_invalid":
            return Self.probeOutputInvalid.error
        default:
            return Self.launchUnavailable.error
        }
    }
}

/// Request-local observations only. Calling the command runner is not proof
/// that a process spawned, that Codex accepted the message, or that work ran.
struct CodexNativeOperationObservation: Sendable, Equatable {
    var stage: CoordinatorNextTurnDispatchFailure.Stage = .qualification
    var commandInvocationAttempted = false
    var exitCode: Int32?
    var terminationSignal: Int32?
    var cachedFailure = false
    var codexVersion: String?
    var executableIdentity: String?
}

typealias CodexNativeOperationObserving = @Sendable (CodexNativeOperationObservation) -> Void

/// A request can cross a detached task boundary. Never keep mutable captured
/// variables or hold this lock while calling the observer.
final class CodexNativeOperationObservations: @unchecked Sendable {
    private let lock = NSLock()
    private var value: CodexNativeOperationObservation
    private let observer: CodexNativeOperationObserving

    init(stage: CoordinatorNextTurnDispatchFailure.Stage = .qualification,
         codexVersion: String? = nil,
         observer: @escaping CodexNativeOperationObserving = { _ in }) {
        value = .init(stage: stage, codexVersion: codexVersion)
        self.observer = observer
    }

    func snapshot() -> CodexNativeOperationObservation {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func replace(_ observation: CodexNativeOperationObservation) {
        lock.lock()
        value = observation
        lock.unlock()
        observer(observation)
    }

    private func update(_ change: (inout CodexNativeOperationObservation) -> Void) {
        lock.lock()
        change(&value)
        let observed = value
        lock.unlock()
        observer(observed)
    }

    func enter(_ stage: CoordinatorNextTurnDispatchFailure.Stage) {
        update { $0.stage = stage }
    }

    func cachedFailure() { update { $0.cachedFailure = true } }
    func identified(_ identity: String) { update { $0.executableIdentity = identity } }
    func version(_ version: String?) { update { $0.codexVersion = version } }

    func commandInvocationAttempted() {
        update { $0.stage = .command; $0.commandInvocationAttempted = true }
    }

    func returned(exitCode: Int32, terminationSignal: Int32?) {
        update { $0.exitCode = exitCode; $0.terminationSignal = terminationSignal }
    }
}

/// Observations never authorize execution. They belong to the same failed
/// candidate as the diagnostic, even when discovery tries several candidates.
struct CodexNativeQualificationFailure: Error, Sendable {
    let diagnostic: CodexNativeDiagnostic
    let evidence: CodexPluginCheckEvidence
    let operationObservation: CodexNativeOperationObservation

    init(error: Error, evidence: CodexPluginCheckEvidence,
         operationObservation: CodexNativeOperationObservation = .init()) {
        diagnostic = CodexNativeDiagnostic(rawValue: CodexNativeDiagnostic.normalize(error).code)
            ?? .launchUnavailable
        var observed = evidence
        if let trustError = error as? CodexRuntimeTrustError {
            observed.pathDiagnostic = trustError.pathDiagnostic
        }
        self.evidence = observed
        self.operationObservation = operationObservation
    }
}

private final class CodexNativeQualificationObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var evidence: CodexPluginCheckEvidence

    init(sourceURL: URL) {
        evidence = .init(stage: .nativeExecutable, sourcePath: sourceURL.path)
    }

    func recordCanonicalURL(_ executable: URL) {
        lock.lock()
        defer { lock.unlock() }
        evidence.canonicalPath = executable.path
    }

    func recordVersionProbe(executable: URL, result: CodexPluginSetupProcessResult) {
        lock.lock()
        defer { lock.unlock() }
        evidence.canonicalPath = executable.path
        guard result.exitCode == 0, result.terminationSignal == nil else { return }
        evidence.codexVersion = CodexCompatibility.parseVersionOutput(result.stdout)
    }

    func recordFailure(_ error: Error) {
        guard let trustError = error as? CodexRuntimeTrustError else { return }
        lock.lock()
        defer { lock.unlock() }
        evidence.pathDiagnostic = trustError.pathDiagnostic
    }

    func snapshot() -> CodexPluginCheckEvidence {
        lock.lock()
        defer { lock.unlock() }
        return evidence
    }
}

typealias CodexNativeQualifying = @Sendable (
    URL, CodexPluginSetupProcessRunning, CodexNativePreflight, Int
) throws -> CodexPluginSetupQualifiedExecutable
typealias CodexNativePreflight = @Sendable (URL, Int) throws -> Void

/// Blabee's native integration only. Never replaces, copies, signs or wraps the
/// user's `codex`. A successful probe is short-lived evidence, not a launch grant.
struct CodexNativeRuntime: Sendable {
    let candidates: @Sendable () -> [URL]
    let qualifier: CodexNativeQualifying
    let revalidator: CodexPluginSetupExecutableRevalidating
    let processRunner: CodexPluginSetupProcessRunning
    let preflight: CodexNativePreflight
    let failureGuard: CodexNativeFailureGuard

    static func live(
        explicitExecutableURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Self {
        let runner: CodexPluginSetupProcessRunning = { executable, arguments, timeout in
            try CodexPluginSetupProcessRunner.run(
                executable: executable, arguments: arguments,
                timeoutMilliseconds: timeout, environment: environment
            )
        }
        return Self(
            candidates: {
                if let explicitExecutableURL { return [explicitExecutableURL] }
                return CodexPluginSetupExecutableResolver.candidateURLs(environment: environment)
            },
            qualifier: { sourceURL, guardedRunner, preflight, timeout in
                try CodexPluginSetupProductionTrust.qualify(
                    sourceURL: sourceURL, processRunner: guardedRunner,
                    beforeVersionProbe: preflight,
                    deadlineNanoseconds: deadline(after: timeout)
                )
            },
            revalidator: CodexPluginSetupProductionTrust.revalidate,
            processRunner: runner,
            preflight: { executable, timeout in
                // `spctl --assess -t execute` is app-oriented and rejects valid
                // standalone CLIs as "not an app". Use the CLI notarization
                // requirement instead. This does not clear Gatekeeper denials.
                let result = try runner(
                    URL(fileURLWithPath: "/usr/bin/codesign"),
                    ["--verify", "--strict", "-R=notarized", "--check-notarization", executable.path],
                    min(5_000, timeout)
                )
                guard result.exitCode == 0 else {
                    throw CodexNativeDiagnostic.notarizationUnavailable.error
                }
            },
            failureGuard: .live(policyRevision: "native-v1-notarized:" + CodexCompatibility.pluginCLISupportedVersions.sorted().joined(separator: ","))
        )
    }

    static func perform(
        arguments: [String], timeoutMilliseconds: Int,
        commandTimeoutMilliseconds: Int? = nil,
        explicitExecutableURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> CodexPluginSetupProcessResult {
        try live(explicitExecutableURL: explicitExecutableURL, environment: environment)
            .perform(
                arguments: arguments, timeoutMilliseconds: timeoutMilliseconds,
                commandTimeoutMilliseconds: commandTimeoutMilliseconds
            )
    }

    func qualify(
        timeoutMilliseconds: Int,
        observer: @escaping CodexNativeOperationObserving = { _ in }
    ) throws -> CodexPluginSetupQualifiedExecutable {
        do {
            return try qualifyWithEvidence(timeoutMilliseconds: timeoutMilliseconds, observer: observer)
        } catch { throw CodexNativeDiagnostic.normalize(error) }
    }

    /// Shares the ordinary qualification path and subprocess budget. Captures
    /// only paths and bounded numeric version output, with no second probe.
    func qualifyWithEvidence(
        timeoutMilliseconds: Int,
        observer: @escaping CodexNativeOperationObserving = { _ in }
    ) throws -> CodexPluginSetupQualifiedExecutable {
        let end = Self.deadline(after: timeoutMilliseconds)
        observer(.init())
        do {
            return try CodexPluginSetupExecutableResolver.qualifyFirst(
                candidates: candidates(),
                qualifier: { sourceURL in
                    let observation = CodexNativeQualificationObservation(sourceURL: sourceURL)
                    let operation = CodexNativeOperationObservations(observer: observer)
                    observer(operation.snapshot())
                    do {
                        return try failureGuard.withAttempt(
                            executable: sourceURL, waitTimeoutMilliseconds: Self.remaining(end),
                            onCachedFailure: { operation.cachedFailure() },
                            onExecutableIdentity: { operation.identified($0) }
                        ) {
                            do {
                                let runner: CodexPluginSetupProcessRunning = { executable, arguments, timeout in
                                    operation.enter(.qualification)
                                    let result = try processRunner(
                                        executable, arguments, Self.remaining(end, maximum: timeout)
                                    )
                                    operation.returned(exitCode: result.exitCode, terminationSignal: result.terminationSignal)
                                    if arguments == ["--version"] {
                                        observation.recordVersionProbe(executable: executable, result: result)
                                        if result.exitCode == 0, result.terminationSignal == nil {
                                            operation.version(CodexCompatibility.parseVersionOutput(result.stdout))
                                        }
                                    }
                                    try Self.checkTermination(result)
                                    return result
                                }
                                let observedPreflight: CodexNativePreflight = { executable, timeout in
                                    observation.recordCanonicalURL(executable)
                                    operation.enter(.notarization)
                                    try preflight(executable, timeout)
                                    operation.enter(.qualification)
                                }
                                let selection = try qualifier(
                                    sourceURL, runner, observedPreflight, Self.remaining(end)
                                )
                                operation.version(selection.version)
                                return selection
                            } catch {
                                observation.recordFailure(error)
                                throw CodexNativeDiagnostic.normalize(error)
                            }
                        }
                    } catch {
                        // Keep the failure guard's persisted error unchanged;
                        // observations are attached only after it has finished.
                        throw CodexNativeQualificationFailure(
                            error: error, evidence: observation.snapshot(),
                            operationObservation: operation.snapshot()
                        )
                    }
                }
            )
        } catch let failure as CodexNativeQualificationFailure {
            // Discovery can return the first failed candidate after inspecting
            // later candidates. Restore observations belonging to that failure.
            observer(failure.operationObservation)
            throw failure
        } catch {
            observer(.init())
            throw CodexNativeQualificationFailure(error: error, evidence: .init(stage: .nativeExecutable))
        }
    }

    func perform(
        arguments: [String], timeoutMilliseconds: Int,
        commandTimeoutMilliseconds: Int? = nil,
        beforeCommand: @Sendable () throws -> Void = {},
        observer: @escaping CodexNativeOperationObserving = { _ in }
    ) throws -> CodexPluginSetupProcessResult {
        let end = Self.deadline(after: timeoutMilliseconds)
        observer(.init())
        let selection = try qualify(timeoutMilliseconds: Self.remaining(end), observer: observer)
        return try run(
            selection: selection, arguments: arguments,
            timeoutMilliseconds: Self.remaining(end),
            commandTimeoutMilliseconds: commandTimeoutMilliseconds,
            beforeCommand: beforeCommand, observer: observer
        )
    }

    func run(
        selection: CodexPluginSetupQualifiedExecutable,
        arguments: [String], timeoutMilliseconds: Int,
        commandTimeoutMilliseconds: Int? = nil,
        beforeCommand: @Sendable () throws -> Void = {},
        observer: @escaping CodexNativeOperationObserving = { _ in }
    ) throws -> CodexPluginSetupProcessResult {
        let end = Self.deadline(after: timeoutMilliseconds)
        let operation = CodexNativeOperationObservations(
            stage: .revalidation, codexVersion: selection.version, observer: observer)
        observer(operation.snapshot())
        do {
            return try failureGuard.withAttempt(
                executable: selection.sourceURL, waitTimeoutMilliseconds: Self.remaining(end),
                onCachedFailure: { operation.cachedFailure() },
                onExecutableIdentity: { operation.identified($0) }
            ) {
                do {
                    let executable = try revalidator(selection)
                    operation.enter(.notarization)
                    try preflight(executable, Self.remaining(end))
                    // Online assessment can take time: retain the same file identity
                    // through it and revalidate immediately before the actual command.
                    operation.enter(.revalidation)
                    guard try revalidator(selection) == executable else {
                        throw CodexNativeDiagnostic.binaryChanged.error
                    }
                    // Qualification and revalidation share the overall deadline,
                    // but must not enlarge a short side-effecting command's budget.
                    operation.enter(.access)
                    try beforeCommand()
                    operation.enter(.command)
                    let commandTimeout = try Self.remaining(end, maximum: commandTimeoutMilliseconds ?? 45_000)
                    operation.commandInvocationAttempted()
                    let result = try processRunner(executable, arguments, commandTimeout)
                    operation.returned(exitCode: result.exitCode, terminationSignal: result.terminationSignal)
                    try Self.checkTermination(result)
                    return result
                } catch {
                    // Account permission is not evidence of a broken Codex binary.
                    if error.coordinatorError.code.hasPrefix("product_access_") { throw error }
                    throw CodexNativeDiagnostic.normalize(error)
                }
            }
        } catch let error as CodexRuntimeTrustError {
            // Initial identity inspection runs before the guarded callback.
            // Preserve its native diagnosis even if access changed since selection.
            throw CodexNativeDiagnostic.normalize(error)
        }
    }

    /// Only a deliberate user recheck clears failure suppression. It cannot
    /// approve the executable or replay any previously queued message.
    func prepareExplicitRetry() throws {
        // The explicit button also recovers obsolete paths/policy revisions
        // from the bounded store. It does not retry any queued user action.
        try failureGuard.resetAllFailures()
    }

    private static func checkTermination(_ result: CodexPluginSetupProcessResult) throws {
        if result.terminationSignal != nil { throw CodexNativeDiagnostic.executionTerminated.error }
    }

    private static func deadline(after milliseconds: Int) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        let delta = UInt64(max(1, min(milliseconds, 45_000))) * 1_000_000
        return now > UInt64.max - delta ? UInt64.max : now + delta
    }

    private static func remaining(_ end: UInt64, maximum: Int = 45_000) throws -> Int {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < end else { throw CodexNativeDiagnostic.probeTimeout.error }
        return min(max(1, maximum), Int((end - now - 1) / 1_000_000 + 1))
    }
}

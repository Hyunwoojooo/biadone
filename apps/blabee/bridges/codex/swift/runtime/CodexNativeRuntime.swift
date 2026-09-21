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
            "Codex 실행 파일을 찾지 못했습니다. 공식 Codex 설치 후 다시 검사하세요."
        case .versionUnqualified:
            "설치된 Codex 버전의 Blabee 호환성이 아직 검증되지 않았습니다. 일반 Codex 설정은 변경하지 않았습니다."
        case .signatureInvalid:
            "Codex의 공식 서명을 확인하지 못했습니다. 공식 설치본을 확인한 뒤 다시 검사하세요."
        case .pathUnsafe:
            "Codex 실행 경로의 소유권 또는 안전성을 확인하지 못했습니다. 공식 설치 경로를 확인하세요."
        case .notarizationUnavailable:
            "Apple 공증을 확인하지 못해 Codex 실행을 보류했습니다. 네트워크와 공식 설치본을 확인한 뒤 다시 검사하세요. 미공증·악성 파일이라고 확정한 것은 아닙니다."
        case .executionTerminated:
            "Codex 실행이 강제로 종료되었습니다. macOS 보안 경고 여부를 확인하세요. 같은 파일의 자동 재시도는 중단했으며, 해결 후 다시 검사할 수 있습니다."
        case .launchUnavailable:
            "Codex 프로세스를 시작하지 못했습니다. 설치 상태와 macOS 보안 설정을 확인한 뒤 다시 검사하세요."
        case .probeTimeout:
            "Codex 검사 또는 실행이 제한 시간을 초과했습니다. 자동으로 다시 실행하지 않습니다. 원인을 확인한 뒤 다시 검사하세요."
        case .probeOutputInvalid:
            "Codex의 버전 또는 검사 응답을 확인하지 못했습니다. 호환성 검증이 필요합니다."
        case .binaryChanged:
            "검사 중 Codex 파일이 변경되었습니다. 업데이트가 끝난 뒤 다시 검사하세요."
        case .guardUnavailable:
            "Codex 재시도 보호 기록을 안전하게 확인하지 못했습니다. 반복 실행을 막기 위해 연결을 보류합니다."
        case .executionInProgress:
            "다른 Codex 검사가 진행 중입니다. 완료된 뒤 다시 시도하세요. 이번 요청은 전송하지 않았습니다."
        case .executionUncertain:
            "이전 Codex 호출의 종료 여부를 확인할 수 없습니다. 자동 재전송하지 않습니다. 원래 세션을 확인한 뒤 다시 검사하세요."
        }
    }

    var error: CoordinatorError { CoordinatorError(rawValue) }

    static func normalize(_ error: Error) -> CoordinatorError {
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

    func qualify(timeoutMilliseconds: Int) throws -> CodexPluginSetupQualifiedExecutable {
        let end = Self.deadline(after: timeoutMilliseconds)
        do {
            return try CodexPluginSetupExecutableResolver.qualifyFirst(
                candidates: candidates(),
                qualifier: { sourceURL in
                    try failureGuard.withAttempt(
                        executable: sourceURL, waitTimeoutMilliseconds: Self.remaining(end)
                    ) {
                        do {
                            let runner: CodexPluginSetupProcessRunning = { executable, arguments, timeout in
                                let result = try processRunner(
                                    executable, arguments, Self.remaining(end, maximum: timeout)
                                )
                                try Self.checkTermination(result)
                                return result
                            }
                            return try qualifier(sourceURL, runner, preflight, Self.remaining(end))
                        } catch { throw CodexNativeDiagnostic.normalize(error) }
                    }
                }
            )
        } catch { throw CodexNativeDiagnostic.normalize(error) }
    }

    func perform(
        arguments: [String], timeoutMilliseconds: Int,
        commandTimeoutMilliseconds: Int? = nil
    ) throws -> CodexPluginSetupProcessResult {
        let end = Self.deadline(after: timeoutMilliseconds)
        let selection = try qualify(timeoutMilliseconds: Self.remaining(end))
        return try run(
            selection: selection, arguments: arguments,
            timeoutMilliseconds: Self.remaining(end),
            commandTimeoutMilliseconds: commandTimeoutMilliseconds
        )
    }

    func run(
        selection: CodexPluginSetupQualifiedExecutable,
        arguments: [String], timeoutMilliseconds: Int,
        commandTimeoutMilliseconds: Int? = nil
    ) throws -> CodexPluginSetupProcessResult {
        let end = Self.deadline(after: timeoutMilliseconds)
        return try failureGuard.withAttempt(
            executable: selection.sourceURL, waitTimeoutMilliseconds: Self.remaining(end)
        ) {
            do {
                let executable = try revalidator(selection)
                try preflight(executable, Self.remaining(end))
                // Online assessment can take time: retain the same file identity
                // through it and revalidate immediately before the actual command.
                guard try revalidator(selection) == executable else {
                    throw CodexNativeDiagnostic.binaryChanged.error
                }
                // Qualification and revalidation share the overall deadline,
                // but must not enlarge a short side-effecting command's budget.
                let result = try processRunner(
                    executable, arguments,
                    Self.remaining(end, maximum: commandTimeoutMilliseconds ?? 45_000)
                )
                try Self.checkTermination(result)
                return result
            } catch { throw CodexNativeDiagnostic.normalize(error) }
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

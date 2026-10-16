import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

/// Hook trust is independent of installation and of a successful card roundtrip.
enum PetHookReadinessState: Equatable, Sendable {
    case unchecked
    case checking
    case trusted
    case reviewRequired
    case unavailable(code: String)

    var title: String {
        switch self {
        case .unchecked: PetL10n.text("Hook status not checked", korean: "Hook 상태 미확인")
        case .checking: PetL10n.text("Checking Hook status", korean: "Hook 상태 확인 중")
        case .trusted: PetL10n.text("Hook trust verified", korean: "Hook 신뢰 확인됨")
        case .reviewRequired: PetL10n.text("Review Hooks in Codex", korean: "Codex에서 Hook 검토 필요")
        case .unavailable: PetL10n.text("Check Hook status", korean: "Hook 상태 확인 필요")
        }
    }

    var detail: String {
        switch self {
        case .unchecked:
            return PetL10n.text("Plugin installation and Hook trust are separate. Choose a project and check Hook status.", korean: "Plugin 설치와 Hook 신뢰는 별개입니다. 사용할 프로젝트를 선택하고 Hook 상태를 확인하세요.")
        case .checking:
            return PetL10n.text("Checking the selected project's four Blabee Hooks without changing settings.", korean: "선택한 프로젝트의 Blabee Hook 4개를 읽기 전용으로 확인합니다.")
        case .trusted:
            return PetL10n.text("The selected project's four Hooks are enabled and trusted. Verify actual card receipt and delivery to the original conversation with a new request.", korean: "선택한 프로젝트의 Hook 4개가 활성화되고 신뢰된 상태입니다. 실제 카드 수신과 원래 대화로의 선택 전달은 새 요청으로 확인하세요.")
        case .reviewRequired:
            return PetL10n.text("Open /hooks in Codex, review the source and commands of Blabee Hooks, then trust and enable them. You can check again here.", korean: "Codex에서 /hooks를 열고 Blabee Hook의 출처와 명령을 검토한 뒤 신뢰·활성화하세요. 이 화면에서 다시 확인할 수 있습니다.")
        case let .unavailable(code):
            if let diagnostic = CodexNativeDiagnostic(rawValue: code) {
                return diagnostic.detail
            }
            switch code {
            case "hook_project_unavailable":
                return PetL10n.text("The project folder could not be found. Choose a project and check again.", korean: "검사할 프로젝트 폴더를 찾지 못했습니다. 사용할 프로젝트를 선택한 뒤 다시 확인하세요.")
            case "plugin_not_installed", "plugin_disabled":
                return PetL10n.text("Connect and enable the Blabee Plugin before checking Hook status.", korean: "Blabee Plugin을 먼저 연결·활성화한 뒤 Hook 상태를 확인하세요.")
            case "plugin_version_mismatch", "plugin_layout_invalid",
                 "plugin_source_invalid", "plugin_installation_ambiguous",
                 "hook_plugin_identity_mismatch":
                return PetL10n.text("Unable to verify this app's Blabee Plugin. Check installation in Codex connection settings, then retry.", korean: "현재 앱의 Blabee Plugin을 확인하지 못했습니다. Codex 연결 설정에서 설치 상태를 확인한 뒤 다시 검사하세요.")
            case "hook_plugin_changed_during_check":
                return PetL10n.text("The Plugin changed during the check. Check again after connection setup finishes.", korean: "검사 중 Plugin이 변경되었습니다. 연결 작업이 끝난 뒤 다시 확인하세요.")
            default:
                return PetL10n.text("Unable to check Hook status in Codex. Check /hooks or retry shortly. Trust settings were not changed.", korean: "Codex에서 Hook 상태를 확인하지 못했습니다. /hooks에서 확인하거나 잠시 후 다시 검사하세요. 신뢰 설정은 변경하지 않았습니다.")
            }
        }
    }

    var isChecking: Bool { self == .checking }
}

protocol PetHookReadinessManaging: Sendable {
    func inspect(projectURL: URL) async -> PetHookReadinessState
}

struct PetUnavailableHookReadinessManager: PetHookReadinessManaging {
    func inspect(projectURL _: URL) async -> PetHookReadinessState {
        .unavailable(code: "hook_inspection_unavailable")
    }
}

struct PetHookReadinessDependencies: Sendable {
    var qualify: CodexPluginSetupExecutableQualifying
    var run: @Sendable (
        _ selection: CodexPluginSetupQualifiedExecutable,
        _ arguments: [String],
        _ timeoutMilliseconds: Int
    ) throws -> CodexPluginSetupProcessResult
    var inspectHooks: @Sendable (
        _ selection: CodexPluginSetupQualifiedExecutable,
        _ projectURL: URL,
        _ timeoutMilliseconds: Int
    ) throws -> Data
    var monotonicNow: @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }

    static func live(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Self {
        let native = CodexNativeRuntime.live(environment: environment)
        return Self(
            qualify: { try native.qualify(timeoutMilliseconds: $0) },
            run: { selection, arguments, timeout in
                try native.run(
                    selection: selection, arguments: arguments,
                    timeoutMilliseconds: timeout
                )
            },
            inspectHooks: { selection, project, timeout in
                let deadline = DispatchTime.now().uptimeNanoseconds
                    + UInt64(max(1, min(timeout, 5_000))) * 1_000_000
                return try native.failureGuard.withAttempt(
                    executable: selection.sourceURL,
                    waitTimeoutMilliseconds: timeout
                ) {
                    let executable = try native.revalidator(selection)
                    try native.preflight(
                        executable,
                        try remaining(deadline: deadline, maximum: 5_000)
                    )
                    guard try native.revalidator(selection) == executable else {
                        throw CodexNativeDiagnostic.binaryChanged.error
                    }
                    return try DoctorHookTrustInspector.inspect(
                        executable: executable,
                        projectURL: project,
                        timeoutMilliseconds: try remaining(
                            deadline: deadline, maximum: 5_000
                        ),
                        // Inspect the same Codex home/configuration as the
                        // surrounding Plugin queries, including injected HOME.
                        environment: CodexPluginSetupProcessRunner.sanitizedEnvironment(environment)
                    )
                }
            }
        )
    }

    static func remaining(
        deadline: UInt64,
        maximum: Int,
        now: UInt64 = DispatchTime.now().uptimeNanoseconds
    ) throws -> Int {
        guard now < deadline else { throw CoordinatorError("doctor_hook_trust_timeout") }
        return min(maximum, Int((deadline - now - 1) / 1_000_000 + 1))
    }
}

/// An explicit, bounded inspection on a worker actor. Creating this manager or
/// opening settings does not start Codex, run hooks, or approve their commands.
actor PetHookReadinessManager: PetHookReadinessManaging {
    private let dependencies: PetHookReadinessDependencies

    init(dependencies: PetHookReadinessDependencies) {
        self.dependencies = dependencies
    }

    static func live(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> PetHookReadinessManager {
        PetHookReadinessManager(dependencies: .live(environment: environment))
    }

    func inspect(projectURL: URL) async -> PetHookReadinessState {
        if Task.isCancelled { return .unchecked }
        let project = projectURL.standardizedFileURL
        var info = stat()
        guard projectURL.isFileURL,
              project.path.hasPrefix("/"),
              !project.path.contains("\0"),
              stat(project.path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
        else { return .unavailable(code: "hook_project_unavailable") }

        let started = dependencies.monotonicNow()
        let deadline = started > UInt64.max - 30_000_000_000
            ? UInt64.max : started + 30_000_000_000
        let selection: CodexPluginSetupQualifiedExecutable
        do {
            selection = try dependencies.qualify(15_000)
            _ = try PetHookReadinessDependencies.remaining(
                deadline: deadline, maximum: 5_000, now: dependencies.monotonicNow()
            )
        } catch {
            return .unavailable(code: CodexNativeDiagnostic.normalize(error).code)
        }
        if Task.isCancelled { return .unchecked }

        let operations = dependencies
        let doctor = DoctorApplication(dependencies: DoctorDependencies(
            environment: [:], currentExecutableURL: nil,
            currentRuntimeIdentity: "hook-readiness-only",
            installedRuntimeIdentity: { _ in nil },
            processRunner: { executable, arguments, timeout in
                guard executable == selection.canonicalURL,
                      arguments == ["plugin", "list", "--json"]
                else { throw CoordinatorError("hook_inspection_operation_invalid") }
                let result = try operations.run(
                    selection, arguments,
                    PetHookReadinessDependencies.remaining(
                        deadline: deadline, maximum: timeout, now: operations.monotonicNow()
                    )
                )
                guard result.terminationSignal == nil else {
                    throw CodexNativeDiagnostic.executionTerminated.error
                }
                return DoctorProcessResult(exitCode: result.exitCode, stdout: result.stdout)
            },
            codexRuntimeInspector: { _ in .unavailable(reason: nil) },
            hookTrustRequester: { executable, requestedProject, timeout in
                guard executable == selection.canonicalURL, requestedProject == project else {
                    throw CoordinatorError("hook_inspection_operation_invalid")
                }
                return try operations.inspectHooks(
                    selection, project,
                    PetHookReadinessDependencies.remaining(
                        deadline: deadline, maximum: timeout, now: operations.monotonicNow()
                    )
                )
            },
            daemonRequester: { _ in throw CoordinatorError("hook_inspection_operation_invalid") }
        ))
        let check = doctor.inspectPluginHookReadiness(
            codexURL: selection.canonicalURL, projectURL: project
        )
        if Task.isCancelled { return .unchecked }
        guard dependencies.monotonicNow() < deadline else {
            return .unavailable(code: "doctor_hook_trust_timeout")
        }
        if check.status == .pass, check.code == "hook_trust_ok" { return .trusted }
        if check.code == "hook_review_required" { return .reviewRequired }
        return .unavailable(code: check.code)
    }
}

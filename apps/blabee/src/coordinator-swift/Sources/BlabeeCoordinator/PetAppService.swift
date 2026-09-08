import CoordinatorSwift
import Foundation

enum PetAppServiceState: Equatable, Sendable {
    case disabled
    case stopped
    case starting
    case ready
    case reconnecting
    case stopping
    case blocked
    case failed(String)

    var title: String {
        switch self {
        case .disabled: "사용 안 함"
        case .stopped: "서비스 시작 대기"
        case .starting: "서비스 시작 중"
        case .ready: "서비스 연결됨"
        case .reconnecting: "서비스 연결 확인 중"
        case .stopping: "서비스 종료 중"
        case .blocked: "기존 서비스 등록 해제 필요"
        case .failed: "서비스 실행 확인 필요"
        }
    }

    var detail: String {
        switch self {
        case .disabled:
            "한 번 켜면 다음부터 Blabee 앱과 함께 시작합니다. 로그인 자동 시작은 등록하지 않습니다."
        case .stopped:
            "앱 실행형 서비스가 선택되어 있습니다. 서비스 시작을 눌러 연결하세요."
        case .starting:
            "실행 파일과 서비스 연결을 확인하고 있습니다. 아직 준비된 상태가 아닙니다."
        case .ready:
            "이 앱이 시작한 서비스에 연결되었습니다. 패널을 닫아도 유지되고 Blabee 종료 시 함께 종료됩니다."
        case .reconnecting:
            "응답을 확인할 때까지 선택을 중지합니다. 기존 작업을 자동으로 다시 보내지 않습니다."
        case .stopping:
            "이 앱이 시작한 서비스만 종료하고 있습니다. Codex 세션은 종료하지 않습니다."
        case .blocked:
            "아래 macOS 자동 시작 등록을 해제한 뒤 다시 시도하세요. 기존 서비스는 자동으로 변경하지 않습니다."
        case .failed(let code):
            "\(Self.recovery(for: code)) 자동 재시작하지 않습니다. 진단: \(code)"
        }
    }

    private static func recovery(for code: String) -> String {
        switch code {
        case "operational_owner_active":
            "다른 Blabee 서비스가 실행 중입니다. 기존 실행을 직접 종료한 뒤 다시 시도하세요."
        case "app_service_identity_mismatch", "app_service_bundle_unverified",
             "operational_runtime_identity_unverified", "operational_runtime_identity_invalid":
            "앱 실행 파일을 확인할 수 없습니다. 앱을 완전히 종료하고 설치된 Blabee를 다시 여세요."
        case "freshness_anchor_unavailable":
            "Keychain에 접근하지 못했습니다. macOS의 접근 요청과 잠금 상태를 확인한 뒤 다시 시도하세요."
        case "freshness_anchor_missing", "freshness_anchor_corrupt", "freshness_storage_missing",
             "freshness_transition_pending", "freshness_transition_mismatch", "database_integrity_failed":
            "저장 정보 검증에 실패했습니다. 데이터나 Keychain 항목을 삭제하지 말고 진단 코드를 전달해 주세요."
        case "app_service_connection_timeout":
            "서비스 응답 대기 시간이 지났습니다. 아래 서비스 다시 시작을 눌러 재확인하세요."
        case "app_service_stop_incomplete":
            "기존 서비스 종료가 확인되지 않아 새 실행을 막았습니다. 잠시 뒤 종료를 다시 시도하세요."
        case "service_registration_unknown":
            "macOS 서비스 등록 상태를 확인하지 못했습니다. 설정 새로고침 후 다시 시도하세요."
        default:
            "서비스 실행을 확인하지 못했습니다. 다시 시도해도 반복되면 진단 코드를 전달해 주세요."
        }
    }
}

@MainActor
protocol PetAppServicePreferenceStoring: AnyObject {
    var enabled: Bool { get set }
}

@MainActor
final class PetAppServicePreferenceStore: PetAppServicePreferenceStoring {
    private let defaults: UserDefaults
    private static let key = "blabee.appOwnedService.enabled.v1"

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var enabled: Bool {
        get { defaults.bool(forKey: Self.key) }
        set { defaults.set(newValue, forKey: Self.key) }
    }
}

/// Opt-in app lifetime, independent of SMAppService registration. Snapshot
/// polling supplies health evidence; this class never adds another IPC poller,
/// retries a Codex action, or adopts/kills a process it did not launch.
@MainActor
final class PetAppServiceController {
    private let launcher: any AppOwnedServiceLaunching
    private let preference: any PetAppServicePreferenceStoring
    private let registration: @MainActor () -> PetServiceRegistrationState
    private let readinessTimeoutNanoseconds: UInt64
    private var child: (any AppOwnedServiceChild)?
    private var deadline: Task<Void, Never>?
    private var stopTask: Task<Void, Never>?
    private var transitionInProgress = false
    private var shuttingDown = false

    private(set) var enabled: Bool
    private(set) var state: PetAppServiceState
    private(set) var generation: UInt64 = 0
    var onChange: (() -> Void)?

    init(
        launcher: any AppOwnedServiceLaunching,
        preference: any PetAppServicePreferenceStoring,
        registration: @escaping @MainActor () -> PetServiceRegistrationState,
        readinessTimeoutNanoseconds: UInt64 = 12_000_000_000
    ) {
        self.launcher = launcher
        self.preference = preference
        self.registration = registration
        self.readinessTimeoutNanoseconds = readinessTimeoutNanoseconds
        enabled = preference.enabled
        state = preference.enabled ? .stopped : .disabled
    }

    deinit { deadline?.cancel() }

    var hasOwnedChild: Bool { child != nil }
    var isTransitioning: Bool { transitionInProgress }

    var mayQueryCoordinator: Bool {
        guard !shuttingDown, !transitionInProgress else { return false }
        if !enabled { return child == nil }
        guard state == .starting || state == .ready || state == .reconnecting else { return false }
        return child?.isRunning == true && child?.hasPublishedService == true
    }

    func startAtAppLaunch() {
        guard enabled, state == .stopped else { return }
        launchIfAllowed()
    }

    func enable() {
        guard !enabled, !shuttingDown, !transitionInProgress, child == nil else { return }
        enabled = true
        preference.enabled = true
        launchIfAllowed()
    }

    /// Explicit retry/restart only. Generation fencing rejects late snapshots
    /// and deadline callbacks from an earlier instance.
    func restart() async {
        guard enabled, !shuttingDown, !transitionInProgress else { return }
        await stopOwnedChild()
        guard !shuttingDown, child == nil else { return }
        launchIfAllowed()
    }

    func disable() async {
        guard !shuttingDown, !transitionInProgress else { return }
        await stopOwnedChild()
        guard child == nil else { return }
        enabled = false
        preference.enabled = false
        update(.disabled)
    }

    func shutdown() async {
        shuttingDown = true
        // Closing the app is not opting out: remember the user's mode for the
        // next launch. Join an ongoing stop without spinning, even if the
        // caller's task was cancelled.
        await stopOwnedChild()
    }

    func checkChildBeforePolling() {
        guard !transitionInProgress, !shuttingDown,
              let child, !child.isRunning else { return }
        let summary = child.terminationSummary ?? "app_service_exited"
        generation &+= 1
        deadline?.cancel()
        deadline = nil
        self.child = nil
        update(.failed(summary))
    }

    func acceptsSnapshot(generation requestGeneration: UInt64) -> Bool {
        generation == requestGeneration && mayQueryCoordinator
    }

    func receivedVerifiedSnapshot(generation requestGeneration: UInt64) {
        guard enabled, acceptsSnapshot(generation: requestGeneration) else { return }
        deadline?.cancel()
        deadline = nil
        update(.ready)
    }

    func connectionFailed(generation requestGeneration: UInt64) {
        guard enabled, generation == requestGeneration, !shuttingDown,
              !transitionInProgress else { return }
        checkChildBeforePolling()
        guard child != nil, state == .ready else { return }
        update(.reconnecting)
        armDeadline()
    }

    private func launchIfAllowed() {
        guard enabled, !shuttingDown, !transitionInProgress, child == nil else { return }
        generation &+= 1
        switch registration() {
        case .notRegistered, .notFound: break
        case .enabled, .requiresApproval:
            update(.blocked)
            return
        case .unknown:
            update(.failed("service_registration_unknown"))
            return
        }
        update(.starting)
        do {
            child = try launcher.launch()
            armDeadline()
        } catch {
            // Never surface subprocess output, local paths, tokens or prompts.
            let code = (error as? CoordinatorError)?.code ?? "app_service_launch_failed"
            update(.failed(code))
        }
    }

    private func armDeadline() {
        deadline?.cancel()
        let expectedGeneration = generation
        let timeout = readinessTimeoutNanoseconds
        deadline = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: timeout) } catch { return }
            guard let self, self.generation == expectedGeneration,
                  self.state == .starting || self.state == .reconnecting else { return }
            self.deadline = nil
            await self.stopOwnedChild()
            guard !self.shuttingDown else { return }
            if self.child == nil { self.update(.failed("app_service_connection_timeout")) }
        }
    }

    private func stopOwnedChild() async {
        if let stopTask {
            await stopTask.value
            return
        }
        generation &+= 1
        deadline?.cancel()
        deadline = nil
        guard let child else { return }
        transitionInProgress = true
        update(.stopping)
        let task = Task {
            await child.stop()
            transitionInProgress = false
            if child.isRunning {
                // Do not discard ownership or start another process after an
                // uncertain cleanup result.
                update(.failed("app_service_stop_incomplete"))
            } else {
                self.child = nil
                update(enabled ? .stopped : .disabled)
            }
            stopTask = nil
        }
        stopTask = task
        await task.value
    }

    private func update(_ state: PetAppServiceState) {
        guard self.state != state else { return }
        self.state = state
        onChange?()
    }
}

enum PetServicePollingPolicy {
    static func delayNanoseconds(base: UInt64, consecutiveFailures: Int) -> UInt64 {
        let multiplier = UInt64(1 << min(3, max(0, consecutiveFailures)))
        let (delay, overflow) = base.multipliedReportingOverflow(by: multiplier)
        return overflow ? UInt64.max : delay
    }
}

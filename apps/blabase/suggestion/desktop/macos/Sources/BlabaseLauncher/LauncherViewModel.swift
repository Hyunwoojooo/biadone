import AppKit
import Foundation

@MainActor
final class LauncherViewModel: ObservableObject {
    @Published private(set) var state: LauncherScreenState = .loading
    @Published private(set) var isRefreshing = false
    @Published private(set) var isPerformingAction = false
    @Published private(set) var isHotKeyRegistered = false
    @Published private(set) var actionMessage: String?
    @Published private(set) var route: LauncherRoute = .home
    @Published private(set) var isResolvingSourceNavigation = false
    @Published private(set) var sourceNavigationRecoveryMessage: String?

    private let client: LauncherAgentClient
    private let dashboardRootContextClient: DashboardRootContextClient
    private let agentStatusProvider: () async throws -> LauncherAgentStatus
    private let sourceURLOpener: (URL) -> Bool
    private let dashboardBaseURLProvider: () -> URL?
    private let sourceModeProvider: () -> LauncherSourceMode
    private var loadTask: Task<Void, Never>?
    private var actionTask: Task<Void, Never>?
    private var sourceNavigationTask: Task<Void, Never>?
    private var lastSourceNavigationTarget: SourceNavigationTarget?
    private var configurationGeneration = UUID()

    init(
        client: LauncherAgentClient = LauncherAgentClient(),
        dashboardRootContextClient: DashboardRootContextClient =
            DashboardRootContextClient(),
        agentStatusProvider: (() async throws -> LauncherAgentStatus)? = nil,
        sourceURLOpener: @escaping (URL) -> Bool = {
            NSWorkspace.shared.open($0)
        },
        dashboardBaseURLProvider: @escaping () -> URL? = {
            let configured = ProcessInfo.processInfo.environment[
                "BLABASE_DASHBOARD_URL"
            ]
            return configured.flatMap(SafeURLPolicy.dashboardBaseURL)
                ?? SafeURLPolicy.defaultDashboardBaseURL
        },
        sourceModeProvider: @escaping () -> LauncherSourceMode = {
            ProcessInfo.processInfo.environment[
                "BLABASE_LAUNCHER_DATA_ROOT"
            ] == nil ? .managed : .readOnly
        }
    ) {
        self.client = client
        self.dashboardRootContextClient = dashboardRootContextClient
        self.agentStatusProvider = agentStatusProvider ?? {
            try await client.getStatus()
        }
        self.sourceURLOpener = sourceURLOpener
        self.dashboardBaseURLProvider = dashboardBaseURLProvider
        self.sourceModeProvider = sourceModeProvider
    }

    func load(refresh: Bool) {
        if refresh, isRefreshing { return }
        loadTask?.cancel()
        isRefreshing = refresh
        if !refresh, currentProjection == nil {
            state = .loading
        }
        actionMessage = nil
        let generation = configurationGeneration
        loadTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if generation == self.configurationGeneration {
                    self.isRefreshing = false
                }
            }
            do {
                let projection = try await self.client.getAttention(
                    refresh: refresh
                )
                guard
                    !Task.isCancelled,
                    generation == self.configurationGeneration
                else { return }
                self.state = LauncherScreenReducer.loaded(projection)
            } catch {
                guard
                    !Task.isCancelled,
                    generation == self.configurationGeneration
                else { return }
                self.state = .error(Self.message(for: error))
            }
        }
    }

    func performPrimaryAction() {
        guard !isPerformingAction else { return }
        guard let projection = currentProjection,
              let card = projection.card else { return }
        switch card.primaryAction {
        case .openGitHub(let rawURL):
            guard let url = SafeURLPolicy.githubURL(from: rawURL) else {
                actionMessage = "안전한 GitHub 주소인지 확인하지 못했습니다."
                return
            }
            NSWorkspace.shared.open(url)
        case .focusOrResume(let enabled):
            guard enabled else {
                actionMessage = "연결된 Codex 세션과 Local Agent 상태를 확인해주세요."
                return
            }
            execute(
                resultId: projection.resultId,
                candidateId: card.candidateId
            )
        }
    }

    func updateHotKeyRegistration(_ isRegistered: Bool) {
        isHotKeyRegistered = isRegistered
    }

    func prepareForPresentation() {
        route = .home
    }

    func showEvidence() {
        guard currentProjection?.card != nil else { return }
        route = .evidence
    }

    func showHome() {
        route = .home
    }

    func handleCancel() -> Bool {
        let result = LauncherNavigationReducer.cancel(from: route)
        route = result.route
        return result.disposition == .handledInLauncher
    }

    func openDashboard() {
        let path = currentProjection?.dashboardPath ?? "/"
        openDashboard(path: path)
    }

    func openSourceConnections() {
        openSourceConnections(target: .overview)
    }

    func openSourceConnections(_ source: AttentionSource) {
        openSourceConnections(target: .source(source))
    }

    private func openSourceConnections(target: SourceNavigationTarget) {
        guard !isResolvingSourceNavigation else { return }
        lastSourceNavigationTarget = target
        sourceNavigationRecoveryMessage = nil
        guard let baseURL = dashboardBaseURLProvider() else {
            presentSourceNavigationUnavailable()
            return
        }
        isResolvingSourceNavigation = true
        let generation = configurationGeneration
        sourceNavigationTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if generation == self.configurationGeneration {
                    self.isResolvingSourceNavigation = false
                    self.sourceNavigationTask = nil
                }
            }
            do {
                let decision = try await LauncherSourceNavigationHandshake
                    .evaluate(
                        getAgentStatus: {
                            try await self.agentStatusProvider()
                        },
                        getDashboardContext: {
                            try await self.dashboardRootContextClient
                                .getRootContext(baseURL: baseURL)
                        }
                    )
                guard
                    !Task.isCancelled,
                    generation == self.configurationGeneration
                else { return }
                switch decision {
                case .allowed:
                    guard let url = self.sourceNavigationURL(
                        target: target,
                        baseURL: baseURL
                    ) else {
                        self.presentSourceNavigationUnavailable()
                        return
                    }
                    guard self.sourceURLOpener(url) else {
                        self.presentSourceNavigationUnavailable()
                        return
                    }
                    self.sourceNavigationRecoveryMessage = nil
                case .blocked(let reason):
                    self.presentSourceNavigationBlock(reason)
                }
            } catch is CancellationError {
                return
            } catch {
                guard
                    !Task.isCancelled,
                    generation == self.configurationGeneration
                else { return }
                self.presentSourceNavigationUnavailable()
            }
        }
    }

    func retrySourceConnections() {
        guard let target = lastSourceNavigationTarget else { return }
        openSourceConnections(target: target)
    }

    func cancelSourceNavigationForDraftChange() {
        sourceNavigationTask?.cancel()
        sourceNavigationTask = nil
        isResolvingSourceNavigation = false
        sourceNavigationRecoveryMessage = nil
        lastSourceNavigationTarget = nil
    }

    private func openDashboard(path: String) {
        guard let baseURL = dashboardBaseURLProvider() else {
            actionMessage = "허용된 Blabase 대시보드 주소가 아닙니다."
            return
        }
        guard let url = SafeURLPolicy.dashboardURL(
            path: path,
            baseURL: baseURL
        ) else {
            actionMessage = "허용된 Blabase 대시보드 주소가 아닙니다."
            return
        }
        NSWorkspace.shared.open(url)
    }

    func markSetupRequired(_ message: String?) {
        invalidateCurrentWork()
        state = .setupRequired(message)
    }

    func stopForConfigurationChange() async throws {
        invalidateCurrentWork()
        state = .loading
        try await client.stopForReconfiguration()
    }

    func loadAfterConfigurationChange() {
        state = .loading
        load(refresh: false)
    }

    func shutdown() {
        loadTask?.cancel()
        actionTask?.cancel()
        sourceNavigationTask?.cancel()
        client.shutdown()
    }

    var currentProjection: LauncherAttentionProjection? {
        guard case .projection(let projection, _) = state else { return nil }
        return projection
    }

    var sourceMode: LauncherSourceMode {
        sourceModeProvider()
    }

    private func execute(resultId: String, candidateId: String) {
        guard !isPerformingAction else { return }
        isPerformingAction = true
        actionMessage = "Codex 작업을 여는 중입니다."
        let generation = configurationGeneration
        actionTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if generation == self.configurationGeneration {
                    self.isPerformingAction = false
                }
            }
            do {
                var execution = try await self.client.executeAttention(
                    resultId: resultId,
                    candidateId: candidateId
                )
                guard generation == self.configurationGeneration else {
                    return
                }
                self.state = LauncherScreenReducer.executing(
                    execution,
                    from: self.state
                )
                var pollCount = 0
                while !execution.status.isTerminal && pollCount < 40 {
                    try await Task.sleep(nanoseconds: 500_000_000)
                    try Task.checkCancellation()
                    execution = try await self.client.getCommand(
                        execution.commandId
                    )
                    guard generation == self.configurationGeneration else {
                        return
                    }
                    self.state = LauncherScreenReducer.executing(
                        execution,
                        from: self.state
                    )
                    pollCount += 1
                }
                self.actionMessage = Self.executionMessage(execution.status)
            } catch is CancellationError {
                return
            } catch {
                guard
                    !Task.isCancelled,
                    generation == self.configurationGeneration
                else { return }
                self.actionMessage = Self.message(for: error)
            }
        }
    }

    private func invalidateCurrentWork() {
        configurationGeneration = UUID()
        loadTask?.cancel()
        loadTask = nil
        actionTask?.cancel()
        actionTask = nil
        sourceNavigationTask?.cancel()
        sourceNavigationTask = nil
        isRefreshing = false
        isPerformingAction = false
        isResolvingSourceNavigation = false
        actionMessage = nil
        sourceNavigationRecoveryMessage = nil
        lastSourceNavigationTarget = nil
        route = .home
    }

    private func presentSourceNavigationBlock(
        _ reason: LauncherSourceNavigationBlockReason
    ) {
        switch reason {
        case .readOnlyRootRequired:
            sourceNavigationRecoveryMessage =
                "Source 연결은 읽기 전용 데이터와 이를 소유한 대시보드가 확인될 때만 열 수 있습니다. 데이터 설정을 확인한 뒤 다시 시도해주세요."
        case .rootMismatch:
            sourceNavigationRecoveryMessage =
                "읽기 전용 데이터와 웹 대시보드가 서로 다른 저장소를 가리킵니다. 같은 저장소로 맞춘 뒤 다시 시도해주세요."
        case .syncRevisionMismatch:
            sourceNavigationRecoveryMessage =
                "Local Agent와 웹 대시보드의 동기화 버전이 다릅니다. 동기화가 끝난 뒤 다시 확인해주세요."
        }
    }

    private func presentSourceNavigationUnavailable() {
        sourceNavigationRecoveryMessage =
            "Source 연결 상태를 확인하지 못했습니다. 웹 대시보드가 실행 중인지 확인한 뒤 다시 시도해주세요."
    }

    private func sourceNavigationURL(
        target: SourceNavigationTarget,
        baseURL: URL
    ) -> URL? {
        switch target {
        case .overview:
            SafeURLPolicy.dashboardURL(path: "/sources", baseURL: baseURL)
        case .source(let source):
            SafeURLPolicy.sourceConnectionURL(for: source, baseURL: baseURL)
        }
    }

    private static func executionMessage(
        _ status: LauncherExecutionStatus
    ) -> String {
        switch status {
        case .pending, .claimed:
            "작업 열기 요청이 계속 처리 중입니다."
        case .completed:
            "Codex 작업을 열었습니다."
        case .failed:
            "Codex 작업을 열지 못했습니다. 대시보드에서 상태를 확인해주세요."
        case .expired:
            "작업 열기 요청 시간이 만료되었습니다."
        }
    }

    private static func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription
            ?? "현재 작업 제안을 불러오지 못했습니다."
    }
}

private enum SourceNavigationTarget: Sendable {
    case overview
    case source(AttentionSource)
}

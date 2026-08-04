import AppKit
import Foundation

@MainActor
final class LauncherViewModel: ObservableObject {
    @Published private(set) var state: LauncherScreenState = .loading
    @Published private(set) var isRefreshing = false
    @Published private(set) var isPerformingAction = false
    @Published private(set) var isHotKeyRegistered = false
    @Published private(set) var actionMessage: String?

    private let client: LauncherAgentClient
    private let dashboardBaseURLProvider: () -> URL?
    private let sourceModeProvider: () -> LauncherSourceMode
    private var loadTask: Task<Void, Never>?
    private var actionTask: Task<Void, Never>?
    private var configurationGeneration = UUID()

    init(
        client: LauncherAgentClient = LauncherAgentClient(),
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

    func openDashboard() {
        let path = currentProjection?.dashboardPath ?? "/"
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
        isRefreshing = false
        isPerformingAction = false
        actionMessage = nil
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

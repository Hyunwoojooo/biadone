import Combine
import Foundation

/// Recovery presentation only. An error or a diagnostic path never grants
/// permission to install a Plugin; an explicit retry must qualify Codex again.
struct PetCodexConnectionRecovery: Equatable {
    let diagnostic: CodexNativeDiagnostic

    init?(state: CodexPluginSetupState) {
        guard case .error(let code) = state else { return nil }
        switch code {
        case "codex_plugin_setup_executable_unavailable": diagnostic = .notInstalled
        case "codex_plugin_setup_signature_invalid": diagnostic = .signatureInvalid
        default:
            guard let value = CodexNativeDiagnostic(rawValue: code) else { return nil }
            diagnostic = value
        }
    }

    var title: String {
        switch diagnostic {
        case .notInstalled:
            PetL10n.text("Set up Codex first", korean: "Codex 설치부터 준비해 주세요")
        case .pathUnsafe:
            PetL10n.text("Check your Codex installation", korean: "Codex 설치 상태를 확인해 주세요")
        case .versionUnqualified, .probeOutputInvalid:
            PetL10n.text("Check Codex compatibility", korean: "Codex 호환성을 확인해 주세요")
        default:
            PetL10n.text("Resume your Codex connection", korean: "Codex 연결을 이어서 준비하세요")
        }
    }

    var detail: String {
        switch diagnostic {
        case .notInstalled:
            PetL10n.text("Install Codex using the official guide, then return here. Recheck and Connect will verify it and install the Blabee Plugin when needed.", korean: "공식 안내에 따라 Codex를 설치한 뒤 돌아오세요. ‘재검사 후 연결’이 실행 파일을 확인하고 필요한 Blabee Plugin을 연결합니다.")
        case .pathUnsafe:
            PetL10n.text("Blabee could not verify this installation path. This can depend on how Codex was installed and does not mean the file is malicious. Review the installation help below before changing folder permissions.", korean: "이 설치 경로를 확인하지 못했습니다. Codex 설치 방식에 따라 발생할 수 있으며, 악성 파일이라는 뜻은 아닙니다. 폴더 권한을 바꾸기 전에 아래 설치 도움말을 확인하세요.")
        case .versionUnqualified, .probeOutputInvalid:
            PetL10n.text("Blabee could not verify compatibility with this Codex version or version response. Check for a Blabee update before changing Codex. Installing the latest Codex alone may not resolve compatibility.", korean: "현재 Codex 버전 또는 버전 응답의 호환성을 확인하지 못했습니다. Codex를 변경하기 전에 Blabee 업데이트를 확인하세요. Codex를 최신으로 설치하는 것만으로는 호환성이 해결되지 않을 수 있습니다.")
        default:
            diagnostic.detail
        }
    }

    var offersInstallGuide: Bool {
        switch diagnostic {
        case .notInstalled, .pathUnsafe, .signatureInvalid, .launchUnavailable: true
        default: false
        }
    }

    var offersAppUpdate: Bool {
        diagnostic == .versionUnqualified || diagnostic == .probeOutputInvalid
    }

}

enum PetConnectionSetupProvider: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case codex, claude

    var id: String { rawValue }
    var title: String { self == .codex ? "Codex" : "Claude" }
}

enum PetConnectionSetupStatus: Equatable, Sendable {
    case checking, needsInstall, needsAction, available, configuring, configured, failed

    var title: String {
        switch self {
        case .checking: PetL10n.text("Checking", korean: "확인 중")
        case .needsInstall: PetL10n.text("Installation required", korean: "설치 필요")
        case .needsAction: PetL10n.text("Needs attention", korean: "확인 필요")
        case .available: PetL10n.text("Ready to connect", korean: "연결 가능")
        case .configuring: PetL10n.text("Setting up", korean: "설정 중")
        case .configured: PetL10n.text("Setup complete", korean: "설정 완료")
        case .failed: PetL10n.text("Check setup", korean: "설정 확인 필요")
        }
    }
}

/// Transient evidence supplied by the provider's existing readiness checks.
/// A successful settings write never creates session readiness here.
enum PetConnectionSessionEvidence: Equatable, Sendable {
    case notObserved, waitingForSession, waitingForApproval, waitingForAcknowledgement
    case ready, receivingCards, unavailable, disconnected

    var title: String {
        switch self {
        case .notObserved: PetL10n.text("Connection not checked", korean: "연결 확인 전")
        case .waitingForSession: PetL10n.text("Waiting for a new conversation", korean: "새 대화 시작 대기")
        case .waitingForApproval: PetL10n.text("Check in the tool", korean: "도구에서 확인 필요")
        case .waitingForAcknowledgement: PetL10n.text("Waiting for connection response", korean: "연결 응답 대기")
        case .ready: PetL10n.text("Connection verified", korean: "연결 확인 완료")
        case .receivingCards: PetL10n.text("Card received", korean: "카드 수신 확인")
        case .unavailable: PetL10n.text("Check connection status", korean: "연결 상태 확인 필요")
        case .disconnected: PetL10n.text("Conversation ended", korean: "대화 종료됨")
        }
    }
}

struct PetConnectionSetupProviderState: Equatable, Sendable {
    var status: PetConnectionSetupStatus
    var detail: String = ""
    var sessionEvidence: PetConnectionSessionEvidence = .notObserved
}

struct PetConnectionSetupInspection: Equatable, Sendable {
    var serviceReady: Bool
    var providers: [PetConnectionSetupProvider: PetConnectionSetupProviderState]
    var recommendedProviders: Set<PetConnectionSetupProvider> = []
    /// A failure observed in the shared service, separate from a failed setup
    /// operation. Merely rereading provider settings does not resolve it.
    var serviceIssue: String? = nil
}

/// Only selection intent survives app restarts, never settings-success flags,
/// credentials, native session identities, or readiness acknowledgements.
@MainActor
protocol PetConnectionSetupSelectionStoring {
    func load() -> Set<PetConnectionSetupProvider>?
    func save(_ providers: Set<PetConnectionSetupProvider>)
}

@MainActor
final class PetConnectionSetupMemorySelectionStore: PetConnectionSetupSelectionStoring {
    private var providers: Set<PetConnectionSetupProvider>?

    init(selectedProviders: Set<PetConnectionSetupProvider>? = nil) {
        providers = selectedProviders
    }

    func load() -> Set<PetConnectionSetupProvider>? { providers }
    func save(_ providers: Set<PetConnectionSetupProvider>) { self.providers = providers }
}

@MainActor
final class PetConnectionSetupUserDefaultsSelectionStore: PetConnectionSetupSelectionStoring {
    static let defaultKey = "com.biadone.blabee.connection.providers.v1"
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = defaultKey) {
        self.defaults = defaults
        self.key = key
    }

    func load() -> Set<PetConnectionSetupProvider>? {
        guard defaults.object(forKey: key) != nil else { return nil }
        // Preserve an explicit empty choice; unrecognized values do not opt
        // the user into a provider through automatic discovery.
        return Set((defaults.stringArray(forKey: key) ?? []).compactMap(PetConnectionSetupProvider.init(rawValue:)))
    }

    func save(_ providers: Set<PetConnectionSetupProvider>) {
        defaults.set(providers.map(\.rawValue).sorted(), forKey: key)
    }
}

/// App-only orchestration of existing provider setup adapters. It neither
/// launches conversations nor creates claims, probes, or session authority.
@MainActor
final class PetConnectionSetupController: ObservableObject {
    enum Phase: Equatable {
        case idle, checking, preparingService, configuring(PetConnectionSetupProvider)
        case configured, needsAction, failed, cancelled

        var title: String {
            switch self {
            case .idle: PetL10n.text("Prepare Connection", korean: "연결 준비")
            case .checking: PetL10n.text("Checking your environment", korean: "사용 환경 확인 중")
            case .preparingService: PetL10n.text("Preparing Blabee", korean: "Blabee 준비 중")
            case .configuring(let provider): PetL10n.text("Setting up \(provider.title)", korean: "\(provider.title) 설정 중")
            case .configured: PetL10n.text("Setup complete", korean: "설정 완료")
            case .needsAction: PetL10n.text("Needs attention", korean: "확인 필요")
            case .failed: PetL10n.text("Check setup", korean: "설정 확인 필요")
            case .cancelled: PetL10n.text("Setup stopped", korean: "설정 중단됨")
            }
        }
    }

    @Published private(set) var selectedProviders: Set<PetConnectionSetupProvider>
    @Published private(set) var states: [PetConnectionSetupProvider: PetConnectionSetupProviderState] = [:]
    @Published private(set) var serviceReady = false
    @Published private(set) var serviceIssue: String?
    @Published private(set) var isWorking = false
    @Published private(set) var phase: Phase = .idle
    @Published private var detailMessage = PetLocalizedMessage("Choose the tools you want to use.", korean: "사용할 도구를 선택해 주세요.")
    var detail: String { detailMessage.text }
    @Published private(set) var hasCurrentInspection = false
    private(set) var selectionGeneration: UInt64 = 0

    private let store: any PetConnectionSetupSelectionStoring
    private let inspect: @MainActor () async throws -> PetConnectionSetupInspection
    private let prepare: @MainActor () async throws -> Void
    private let configure: @MainActor (PetConnectionSetupProvider) async throws -> Void
    private var hasExplicitSelection: Bool
    private var failures: [PetConnectionSetupProvider: String] = [:]
    // Common preparation/inspection errors must survive ordinary health polls.
    // A poll observing "available" is not evidence that the failed step worked.
    private var operationFailure: String?
    private var operationID: UUID?
    private var operationTask: Task<Void, Never>?
    private var cancellationRequested = false
    private var operationContextIsCurrent: (@MainActor () -> Bool)?

    init(
        store: (any PetConnectionSetupSelectionStoring)? = nil,
        inspect: @escaping @MainActor () async throws -> PetConnectionSetupInspection,
        prepare: @escaping @MainActor () async throws -> Void,
        configure: @escaping @MainActor (PetConnectionSetupProvider) async throws -> Void
    ) {
        let store = store ?? PetConnectionSetupMemorySelectionStore()
        let saved = store.load()
        self.store = store
        selectedProviders = saved ?? []
        hasExplicitSelection = saved != nil
        self.inspect = inspect
        self.prepare = prepare
        self.configure = configure
    }

    deinit { operationTask?.cancel() }

    var canConnect: Bool { !isWorking && !selectedProviders.isEmpty }

    /// Provider order is stable in both action titles and partial-setup copy.
    var availableProviders: [PetConnectionSetupProvider] {
        PetConnectionSetupProvider.allCases.filter {
            selectedProviders.contains($0) && state(for: $0).status == .available
        }
    }

    var pendingProviders: [PetConnectionSetupProvider] {
        PetConnectionSetupProvider.allCases.filter {
            selectedProviders.contains($0) && ![.available, .configured].contains(state(for: $0).status)
        }
    }

    var canFinish: Bool {
        !isWorking && hasCurrentInspection && serviceReady && serviceIssue == nil && !selectedProviders.isEmpty
            && selectedProviders.allSatisfy { state(for: $0).status == .configured }
    }

    func state(for provider: PetConnectionSetupProvider) -> PetConnectionSetupProviderState {
        states[provider] ?? .init(status: .checking, detail: PetL10n.text("Check your environment.", korean: "사용 환경을 확인해 주세요."))
    }

    func setSelected(_ selected: Bool, for provider: PetConnectionSetupProvider) {
        guard !isWorking else { return }
        if selectedProviders.contains(provider) != selected { selectionGeneration &+= 1 }
        if selected { selectedProviders.insert(provider) } else { selectedProviders.remove(provider) }
        hasExplicitSelection = true
        store.save(selectedProviders)
        summarize()
    }

    /// Does not prepare a service or write provider settings.
    func refresh() async { await run(applySettings: false) }

    /// A normal read-only poll can revoke stale readiness without starting a
    /// second setup operation or changing the user's provider selection.
    func receiveObservation(_ inspection: PetConnectionSetupInspection) {
        guard !isWorking else { return }
        apply(inspection, suggestProviders: false)
        summarize()
    }

    func connect(while contextIsCurrent: @escaping @MainActor () -> Bool = { true }) async {
        guard canConnect else { return }
        hasExplicitSelection = true
        store.save(selectedProviders)
        await run(applySettings: true, contextIsCurrent: contextIsCurrent)
    }

    func cancel() {
        guard isWorking else { return }
        cancellationRequested = true
        operationTask?.cancel()
        invalidateInspection()
        phase = .cancelled
        detailMessage = PetLocalizedMessage("Setup stopped. Trying again will check the current state first.", korean: "설정을 중단했습니다. 다시 시도하면 현재 상태부터 확인합니다.")
        // Keep the busy guard until an in-flight adapter returns. A cancelled
        // atomic settings write may still be completing and must not overlap.
    }

    private func run(applySettings: Bool, contextIsCurrent: (@MainActor () -> Bool)? = nil) async {
        guard !isWorking else { return }
        let operation = UUID()
        operationID = operation
        operationContextIsCurrent = contextIsCurrent
        operationFailure = nil
        cancellationRequested = false
        isWorking = true
        invalidateInspection()
        phase = .checking
        detailMessage = PetLocalizedMessage("Checking your environment.", korean: "사용 환경을 확인하고 있어요.")
        if applySettings { failures.removeAll() }
        let task = Task { await perform(operation: operation, applySettings: applySettings) }
        operationTask = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        guard operationID == operation else { return }
        operationTask = nil
        operationID = nil
        operationContextIsCurrent = nil
        isWorking = false
    }

    private func perform(operation: UUID, applySettings: Bool) async {
        do {
            guard try await refreshInspection(operation: operation) else { return }
            guard applySettings, !selectedProviders.isEmpty else { summarize(); return }
            // A known failed service needs its explicit recovery path. Do not
            // rewrite projects or tool settings while that failure is unresolved.
            guard serviceIssue == nil else { summarize(); return }
            let selected = PetConnectionSetupProvider.allCases.filter(selectedProviders.contains)
            let canPrepare = selected.contains { [.available, .configured].contains(state(for: $0).status) }
            let hasPendingConfiguration = selected.contains { state(for: $0).status == .available }
            // Shared prerequisites also include the user-selected project
            // scope. A running service does not imply that scope is prepared.
            if canPrepare, !serviceReady || hasPendingConfiguration {
                phase = .preparingService
                detailMessage = PetLocalizedMessage("Preparing Blabee for the selected tools.", korean: "선택한 도구가 사용할 Blabee를 준비하고 있어요.")
                invalidateInspection()
                try await prepare()
                guard isCurrent(operation) else { return }
                guard try await refreshInspection(operation: operation) else { return }
            }
            // Saved provider settings alone cannot substitute for a current
            // shared-service response. The adapter decides what is ready.
            guard serviceReady, serviceIssue == nil else { summarize(); return }
            for provider in selected {
                guard isCurrent(operation) else { return }
                guard serviceReady, serviceIssue == nil else { summarize(); return }
                guard state(for: provider).status == .available else { continue }
                phase = .configuring(provider)
                detailMessage = PetLocalizedMessage("Preparing connection settings for \(provider.title).", korean: "\(provider.title)의 연결 설정을 준비하고 있어요.")
                var current = state(for: provider)
                current.status = .configuring
                states[provider] = current
                invalidateInspection()
                do {
                    try await configure(provider)
                } catch {
                    guard isCurrent(operation) else { return }
                    failures[provider] = failureDetail(error)
                }
                guard isCurrent(operation) else { return }
                // A write may have succeeded before its response was lost.
                // Observe it before deciding whether any retry is necessary.
                guard try await refreshInspection(operation: operation) else { return }
            }
            summarize()
        } catch {
            guard isCurrent(operation) else { return }
            invalidateInspection()
            let failure = failureDetail(error)
            operationFailure = failure
            if serviceIssue != nil {
                summarize()
            } else {
                phase = .failed
                detailMessage = .verbatim(failure)
            }
        }
    }

    private func refreshInspection(operation: UUID) async throws -> Bool {
        guard isCurrent(operation) else { return false }
        let observed = try await inspect()
        guard isCurrent(operation) else { return false }
        apply(observed, suggestProviders: true)
        return true
    }

    private func apply(_ observed: PetConnectionSetupInspection, suggestProviders: Bool) {
        // A stopped/starting service or an absent response is not proof that a
        // previously observed failure recovered. Only fresh healthy evidence
        // clears it; this state is transient and is never written to preferences.
        let observedIssue = observed.serviceIssue ?? (observed.serviceReady ? nil : serviceIssue)
        let observedServiceReady = observed.serviceReady && observedIssue == nil
        var observedStates = Dictionary(uniqueKeysWithValues: PetConnectionSetupProvider.allCases.map { provider in
            (provider, observed.providers[provider] ?? .init(status: .needsAction, detail: PetL10n.text("Unable to check your environment.", korean: "사용 환경을 확인하지 못했습니다.")))
        })
        for provider in PetConnectionSetupProvider.allCases {
            if !observedServiceReady,
               observedStates[provider]?.sessionEvidence == .ready || observedStates[provider]?.sessionEvidence == .receivingCards {
                observedStates[provider]?.sessionEvidence = .unavailable
            }
            if observedStates[provider]?.status == .configured {
                failures.removeValue(forKey: provider)
            } else if let failure = failures[provider] {
                observedStates[provider]?.status = .failed
                observedStates[provider]?.detail = failure
            }
        }
        // Normal service polling may repeat the same evidence indefinitely.
        // Preserve the Pet's idle behavior instead of invalidating every view.
        if serviceIssue != observedIssue { serviceIssue = observedIssue }
        if serviceReady != observedServiceReady { serviceReady = observedServiceReady }
        if states != observedStates { states = observedStates }
        if suggestProviders, !hasExplicitSelection {
            let recommended = observed.recommendedProviders.filter {
                [.available, .configured].contains(state(for: $0).status)
            }
            if selectedProviders != recommended {
                selectionGeneration &+= 1
                selectedProviders = recommended
            }
        }
        if !hasCurrentInspection { hasCurrentInspection = true }
        if observedServiceReady, !selectedProviders.isEmpty,
           selectedProviders.allSatisfy({ state(for: $0).status == .configured }) {
            operationFailure = nil
        }
    }

    private func isCurrent(_ operation: UUID) -> Bool {
        guard operationID == operation else { return false }
        guard !cancellationRequested, !Task.isCancelled, operationContextIsCurrent?() != false else {
            invalidateInspection()
            phase = .cancelled
            detailMessage = PetLocalizedMessage("Setup stopped. Trying again will check the current state first.", korean: "설정을 중단했습니다. 다시 시도하면 현재 상태부터 확인합니다.")
            return false
        }
        return true
    }

    private func invalidateInspection() {
        hasCurrentInspection = false
        serviceReady = false
        for provider in PetConnectionSetupProvider.allCases where states[provider] != nil {
            states[provider]?.sessionEvidence = .notObserved
        }
    }

    private func summarize() {
        let nextPhase: Phase
        let nextDetail: PetLocalizedMessage
        let selected = PetConnectionSetupProvider.allCases.filter(selectedProviders.contains)
        if let serviceIssue {
            nextPhase = .failed
            nextDetail = .verbatim(serviceIssue)
        } else if selected.isEmpty {
            nextPhase = .idle
            nextDetail = PetLocalizedMessage("Choose the tools you want to use.", korean: "사용할 도구를 선택해 주세요.")
        } else if hasCurrentInspection, serviceReady, selected.allSatisfy({ state(for: $0).status == .configured }) {
            nextPhase = .configured
            nextDetail = PetLocalizedMessage("Setup is ready. Start as usual in a new terminal.", korean: "설정이 준비됐어요. 새 터미널에서 평소처럼 시작하세요.")
        } else if let operationFailure {
            nextPhase = .failed
            nextDetail = .verbatim(operationFailure)
        } else if hasCurrentInspection, !availableProviders.isEmpty, !pendingProviders.isEmpty {
            nextPhase = .needsAction
            let available = availableProviders.map(\.title).joined(separator: ", ")
            let pending = pendingProviders.map(\.title).joined(separator: ", ")
            nextDetail = PetLocalizedMessage("\(available) can connect now. \(pending) still needs attention; you can review it separately or connect it later.", korean: "\(available)는 지금 연결할 수 있어요. \(pending)는 추가 확인이 필요하며, 따로 확인하거나 나중에 연결할 수 있습니다.")
        } else if selected.contains(where: { state(for: $0).status == .failed }) {
            nextPhase = .failed
            nextDetail = PetLocalizedMessage("Some settings could not be checked. Completed tool settings have been kept.", korean: "일부 설정을 확인하지 못했습니다. 준비된 도구의 설정은 유지됩니다.")
        } else if hasCurrentInspection, !availableProviders.isEmpty {
            nextPhase = .idle
            nextDetail = PetLocalizedMessage("The selected tools can connect. Choose Connect to prepare the settings.", korean: "선택한 도구를 연결할 수 있어요. 연결하기를 눌러 설정을 준비하세요.")
        } else {
            nextPhase = .needsAction
            nextDetail = serviceReady ? PetLocalizedMessage("Check the requirements for the selected tools.", korean: "선택한 도구에 필요한 항목을 확인해 주세요.") : PetLocalizedMessage("Check whether Blabee is ready.", korean: "Blabee 준비 상태를 확인해 주세요.")
        }
        if phase != nextPhase { phase = nextPhase }
        if detailMessage != nextDetail { detailMessage = nextDetail }
    }

    private func failureDetail(_ error: any Error) -> String {
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? PetL10n.text("Unable to verify connection settings. Please try again.", korean: "연결 설정을 확인하지 못했습니다. 다시 시도해 주세요.") : String(trimmed.prefix(500))
    }
}

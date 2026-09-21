import AppKit
import Combine
import CoordinatorSwift
import Foundation

struct PetExternalApplicationReference: Sendable, Equatable {
    let processIdentifier: pid_t
    let localizedName: String
}

@MainActor
protocol PetExternalApplicationOpening: AnyObject {
    func captureFrontmostExternalApplication(
        excludingProcessIdentifier: pid_t
    ) -> PetExternalApplicationReference?
    @discardableResult
    func open(_ reference: PetExternalApplicationReference) -> Bool
}

@MainActor
final class PetWorkspaceApplicationOpener: PetExternalApplicationOpening {
    func captureFrontmostExternalApplication(
        excludingProcessIdentifier: pid_t
    ) -> PetExternalApplicationReference? {
        guard let application = NSWorkspace.shared.frontmostApplication,
              application.processIdentifier != excludingProcessIdentifier
        else { return nil }
        return PetExternalApplicationReference(
            processIdentifier: application.processIdentifier,
            localizedName: application.localizedName ?? "Codex"
        )
    }

    func open(_ reference: PetExternalApplicationReference) -> Bool {
        guard let application = NSRunningApplication(
            processIdentifier: reference.processIdentifier
        ) else { return false }
        return application.activate(options: [.activateIgnoringOtherApps])
    }
}

enum PetPresentationState: String, Sendable, Equatable {
    case disconnected
    case malformed
    case ready
    case working
    case permission
    case waiting
    case reminder
    case expired
    case paused
    case recoveryCapable = "recovery_capable"

    var displayTitle: String {
        switch self {
        case .disconnected: "연결 대기"
        case .malformed: "안전하게 중지됨"
        case .ready: "준비됨"
        case .working: "작업 중"
        case .permission: "권한 대기"
        case .waiting: "결정 대기"
        case .reminder: "결정 알림"
        case .expired: "만료됨"
        case .paused: "보류됨"
        case .recoveryCapable: "복구 가능"
        }
    }
}

struct PetRiskConfirmation: Sendable, Equatable {
    let identity: PetInteractionIdentity
    let slot: Int
    let optionID: String
    var inputMethod: PetProductInputMethod = .button
}

struct PetSelectionSubmission: Sendable, Equatable {
    let identity: PetInteractionIdentity
    let slot: Int
    let optionID: String
}

enum PetActionAccessoryPresentation: Sendable, Equatable {
    case shortcut(String)
    case progress
    case suppressed
}

@MainActor
final class PetViewModel: ObservableObject {
    @Published private(set) var provider: PetProvider
    @Published private(set) var providerSessions: [PetProviderSession] = []
    @Published private(set) var isSwitchingProvider = false
    @Published private(set) var isStartingClaude = false
    @Published private(set) var isProviderConnectionOperationInFlight = false
    @Published private(set) var providerReadFailed = false
    private var providerGeneration: UInt64 = 0
    private var providerConnectionOperationID: UUID?
    private let startClaude: (@MainActor () async throws -> Void)?

    /// Captured at the UI event, before an asynchronous task can change the
    /// selected provider. Matching card IDs alone never confer authority.
    struct ProviderActionContext: Sendable, Equatable {
        fileprivate let serviceGeneration: UInt64?
        fileprivate let providerGeneration: UInt64
        let expectedContext: PetProviderContext?
    }
    let automaticAppUpdate: AppUpdateTransactionController
    let account: PetAccountController?
    var firstRunPreferences: PetFirstRunPreferences?
    let usageAnalytics: PetUsageAnalytics?
    let errorDiagnostics: PetErrorDiagnostics?
    let feedback: PetFeedbackController?
    private let insightCards: PetInsightCardTracker?
    private enum InsightCardIdentity: Hashable {
        case suggestion(PetInteractionIdentity)
        case approval(PetApprovalHeadIdentity)
    }
    // These identities stay in memory. Only fresh telemetry UUIDs leave the app.
    private var insightCardKeys: [InsightCardIdentity: String] = [:]
    private var insightOwner: PetProductIdentity?
    private var isApplyingSnapshot = false
    private(set) var isFeedbackWindowVisible = false
    private var lastSnapshotDiagnosticContext: PetErrorContext?
    // Local acceptance observer; remote recording separately requires the
    // consent/identity context captured when the user initiated the action.
    var onUsageAccepted: ((PetUsageEventKind) -> Void)?
    private enum OnboardingOperationDomain {
        case service
        case codexPlugin
        case project
        case legacyShell
    }

    private struct FocusOperation: Sendable {
        let id = UUID()
        let identity: PetInteractionIdentity
        let context: ProviderActionContext
    }

    @Published private(set) var snapshot: PetSnapshot? {
        didSet {
            let priorActionCount = oldValue?.interactions.first?.actionChoices.count
            let currentActionCount = snapshot?.interactions.first?.actionChoices.count
            let priorQueueCount = oldValue?.interactions.count ?? 0
            let currentQueueCount = snapshot?.interactions.count ?? 0
            let priorApprovalHead = oldValue.flatMap {
                PetApprovalHead.first(
                    permissionRequests: $0.permissionRequests,
                    managedCommandApprovals: $0.managedCommandApprovals
                )
            }
            let currentApprovalHead = snapshot.flatMap {
                PetApprovalHead.first(
                    permissionRequests: $0.permissionRequests,
                    managedCommandApprovals: $0.managedCommandApprovals
                )
            }
            let priorApprovalCount = (oldValue?.permissionRequests.count ?? 0)
                + (oldValue?.managedCommandApprovals.count ?? 0)
            let currentApprovalCount = (snapshot?.permissionRequests.count ?? 0)
                + (snapshot?.managedCommandApprovals.count ?? 0)
            if priorActionCount != currentActionCount
                || priorQueueCount != currentQueueCount
                || priorApprovalHead?.identity != currentApprovalHead?.identity
                || priorApprovalCount != currentApprovalCount
            {
                onPanelLayoutChanged?()
            }
            reconcileChoicePreview()
        }
    }
    @Published private(set) var selectedEventReference: PetEventReference? {
        didSet { reconcileInsightPresentation() }
    }
    @Published private(set) var pendingEventFocus: PetEventFocusTarget?
    @Published private(set) var eventNavigationShortcutDiagnostic: String?
    private var confirmedEventFocus: PetEventFocusTarget?
    private var automaticallyFocusingEvent = false

    @Published private(set) var localForegroundIdentity: PetInteractionIdentity?
    @Published private(set) var pendingFocusIdentity: PetInteractionIdentity?
    @Published private(set) var selectionSubmission: PetSelectionSubmission?
    @Published private(set) var inFlightDismissalIdentity: PetInteractionIdentity?
    @Published private(set) var riskConfirmation: PetRiskConfirmation?
    @Published private(set) var choicePreview: PetChoicePreview? {
        didSet {
            guard oldValue != choicePreview else { return }
            onPanelLayoutChanged?()
            onChoicePreviewChanged?(choicePreview != nil)
            reconcileEventNavigationShortcuts()
            reconcileInsightPresentation()
        }
    }
    @Published private(set) var isExpanded = false {
        didSet {
            if oldValue != isExpanded { onPanelLayoutChanged?() }
        }
    }
    @Published private(set) var lastError: String? {
        didSet {
            if (oldValue == nil) != (lastError == nil) { onPanelLayoutChanged?() }
        }
    }
    @Published private(set) var permissionNoticeCount: Int64 = 0
    @Published private(set) var inFlightPermissionRequestID: String?
    @Published private(set) var managedCommandApprovalNoticeCount: Int64 = 0
    @Published private(set) var inFlightManagedCommandApprovalID: String?
    @Published private(set) var lastTerminalPresentation: PetPresentationState?
    @Published private(set) var shortcutDiagnostic: String? {
        didSet {
            if (oldValue == nil) != (shortcutDiagnostic == nil) {
                onPanelLayoutChanged?()
            }
        }
    }
    @Published private(set) var shortcutConfiguration = PetShortcutConfiguration.defaults
    @Published private(set) var approvalShortcutLabels: [PetApprovalShortcutIntent: String] = [:]
    @Published private(set) var approvalShortcutDiagnostic: String?
    @Published private(set) var shortcutDraft = PetShortcutConfiguration.defaults
    // A permission card temporarily replaces the settings view. Keep its selected
    // pane alongside the draft so remounting cannot silently switch tabs.
    @Published private(set) var selectedSettingsTab: PetSettingsTab = .general
    @Published private(set) var isEditingShortcuts = false {
        didSet {
            if oldValue != isEditingShortcuts { onPanelLayoutChanged?() }
            reconcileChoicePreview()
            reconcileApprovalShortcuts()
            reconcileEventNavigationShortcuts()
            reconcileInsightPresentation()
        }
    }
    @Published private(set) var shortcutSettingsError: String?
    @Published private(set) var isShowingOnboarding = false {
        didSet {
            if oldValue != isShowingOnboarding { onPanelLayoutChanged?() }
            reconcileChoicePreview()
            reconcileApprovalShortcuts()
            reconcileEventNavigationShortcuts()
            reconcileInsightPresentation()
        }
    }
    @Published private(set) var onboardingServiceState: PetServiceRegistrationState = .unknown
    @Published private(set) var appOwnedServiceState: PetAppServiceState = .disabled
    @Published private(set) var isAppOwnedServiceEnabled = false
    @Published private(set) var codexPluginSetupState: CodexPluginSetupState = .unchecked
    @Published private var rawCodexHookReadiness: PetHookReadinessState = .unchecked
    @Published private var checkedHookProjectPath: String?
    @Published private(set) var selectedHookProjectPath: String?
    @Published private(set) var isCodexHookCheckInFlight = false
    @Published private(set) var storageRecoveryConfirmation: PetStorageRecoveryConfirmation?
    @Published private(set) var storageRecoveryReceipt: PetStorageRecoveryReceipt?
    @Published private(set) var storageRecoveryError: String?
    @Published private(set) var isStorageRecoveryOperationInFlight = false
    private var hookCheckGeneration = UUID()
    private var storageRecoveryGeneration = UUID()
    @Published private(set) var codexNativeRecheckReport: CodexPluginRecheckReport?
    @Published private(set) var configuredProjectPaths: [String] = []
    @Published private(set) var configuredProjectPathsAreAuthoritative = false
    @Published private(set) var onboardingError: String?
    @Published private(set) var appUpdateState: PetAppUpdateState = .notChecked
    @Published private(set) var appUpdateSettingsRequestID = UUID()
    @Published private(set) var coordinatorTransportError: String?
    @Published private(set) var connectionReceivedCardProjectPaths: Set<String> = []
    @Published private var firstRunSetupSnapshot: PetSnapshot?
    private var firstRunSetupActive = false
    private var firstRunSetupGeneration = UUID()
    private var firstRunRefreshToken: UUID?
    @Published private(set) var suggestionMode: BlabeeSuggestionMode = .smart
    @Published private(set) var suggestionModeDiagnostic: String? {
        didSet {
            if (oldValue == nil) != (suggestionModeDiagnostic == nil) {
                onPanelLayoutChanged?()
            }
        }
    }
    @Published private(set) var isOnboardingServiceOperationInFlight = false
    @Published private(set) var isCodexPluginOperationInFlight = false
    @Published private(set) var isOnboardingProjectOperationInFlight = false
    @Published private(set) var isConfirmingLegacyCodexPluginMigration = false {
        didSet {
            if oldValue != isConfirmingLegacyCodexPluginMigration {
                onPanelLayoutChanged?()
            }
        }
    }
    private var legacyCodexPluginMigrationConfirmation:
        CodexPluginSetupLegacyMigrationConfirmation?

    @Published private(set) var legacyShellCleanupInspection: LegacyCodexShellCleanupInspection?
    @Published private(set) var legacyShellCleanupConfirmation: LegacyCodexShellCleanupConfirmation?
    @Published private(set) var isLegacyShellCleanupOperationInFlight = false
    private var legacyShellConfirmationGeneration = UUID()

    private let transport: any PetCoordinatorTransport
    private let externalApplicationOpener: any PetExternalApplicationOpening
    private let onboardingAdapter: any PetOnboardingAdapting
    private let appService: PetAppServiceController?
    private let codexPluginSetupManager: any CodexPluginSetupManaging
    private let hookReadinessManager: any PetHookReadinessManaging
    private let storageRecoveryManager: any PetStorageRecoveryManaging
    private let legacyShellCleanupManager: any LegacyCodexShellCleanupManaging
    private let suggestionModeStore: any BlabeeSuggestionModeStoring
    private let projectFolderChooser: any PetProjectFolderChoosing
    private let appUpdateChecker: any PetAppUpdateChecking
    private let appUpdateURLOpener: @MainActor (URL) -> Bool
    private let selectionIDGenerator: @Sendable () -> String
    private let permissionResponseIDGenerator: @Sendable () -> String
    private let managedApprovalResponseIDGenerator: @Sendable () -> String
    private let processIdentifier: pid_t
    private var selectionReturnApplication: PetExternalApplicationReference?
    private var permissionReturnApplications: [
        String: PetExternalApplicationReference
    ] = [:]
    private var managedApprovalReturnApplications: [
        String: PetExternalApplicationReference
    ] = [:]
    private var inFlightSelectionIdentity: PetInteractionIdentity?
    private var activeFocusOperation: FocusOperation?
    private var focusWaiters: [UUID: [CheckedContinuation<Bool, Never>]] = [:]
    private var hotKeyRegistry: PetHotKeyRegistry?
    private(set) var isPanelVisible = false
    private let choicePreviewHoldMonitor: PetChoicePreviewHoldMonitor
    private var previewBindingIdentity: PetInteractionIdentity?
    private var pollingTask: Task<Void, Never>?
    private var nextSnapshotRequest: UInt64 = 0
    private var lastAppliedSnapshotRequest: UInt64 = 0
    private var refreshInProgress = false
    private var consecutiveSnapshotFailures = 0
    private var isShuttingDown = false
    private var onboardingRefreshRequested = false
    private var codexPluginRefreshRequested = false
    private var autoFocusAttemptedIdentity: PetInteractionIdentity?
    private var autoFocusAttemptToken: UUID?
    private var persistentApprovalResolutionError: String?

    var onPanelLayoutChanged: (() -> Void)?
    var onPanelToggleRequested: (() -> Void)?
    var onChoicePreviewChanged: ((Bool) -> Void)?
    var onAttentionChanged: ((Bool) -> Void)?
    var onAttentionEvent: (() -> Void)?
    var onApprovalHeadChanged: ((PetApprovalHeadIdentity?) -> Void)?
    var onApprovalResolutionFailed: (() -> Void)?
    var onFeedbackRequested: ((String?) -> Void)?

    init(
        transport: any PetCoordinatorTransport,
        externalApplicationOpener: any PetExternalApplicationOpening,
        provider: PetProvider = .codex,
        startClaude: (@MainActor () async throws -> Void)? = nil,
        onboardingAdapter: any PetOnboardingAdapting = PetUnavailableOnboardingAdapter(),
        appService: PetAppServiceController? = nil,
        codexPluginSetupManager: any CodexPluginSetupManaging = CodexUnavailablePluginSetupManager(),
        hookReadinessManager: any PetHookReadinessManaging = PetUnavailableHookReadinessManager(),
        storageRecoveryManager: any PetStorageRecoveryManaging = PetUnavailableStorageRecoveryManager(),
        legacyShellCleanupManager: any LegacyCodexShellCleanupManaging = LegacyUnavailableCodexShellCleanupManager(),
        suggestionModeStore: any BlabeeSuggestionModeStoring = BlabeeSuggestionModeStore(),
        projectFolderChooser: any PetProjectFolderChoosing = PetUnavailableProjectFolderChooser(),
        appUpdateChecker: any PetAppUpdateChecking = PetGitHubAppUpdateChecker(
            currentVersion: nil, repository: nil
        ),
        appUpdateURLOpener: @escaping @MainActor (URL) -> Bool = { NSWorkspace.shared.open($0) },
        automaticAppUpdate: AppUpdateTransactionController? = nil,
        account: PetAccountController? = nil,
        usageAnalytics: PetUsageAnalytics? = nil,
        errorDiagnostics: PetErrorDiagnostics? = nil,
        feedback: PetFeedbackController? = nil,
        insightCards: PetInsightCardTracker? = nil,
        processIdentifier: pid_t = ProcessInfo.processInfo.processIdentifier,
        selectionIDGenerator: @escaping @Sendable () -> String = {
            "selection_" + UUID().uuidString.lowercased()
        },
        permissionResponseIDGenerator: @escaping @Sendable () -> String = {
            "permission_response_" + UUID().uuidString.lowercased()
        },
        managedApprovalResponseIDGenerator: @escaping @Sendable () -> String = {
            "managed_approval_response_" + UUID().uuidString.lowercased()
        },
        choicePreviewHoldMonitor: PetChoicePreviewHoldMonitor = PetChoicePreviewHoldMonitor()
    ) {
        self.transport = transport
        self.provider = provider
        self.startClaude = startClaude
        self.externalApplicationOpener = externalApplicationOpener
        self.onboardingAdapter = onboardingAdapter
        self.appService = appService
        self.codexPluginSetupManager = codexPluginSetupManager
        self.hookReadinessManager = hookReadinessManager
        self.storageRecoveryManager = storageRecoveryManager
        self.legacyShellCleanupManager = legacyShellCleanupManager
        self.suggestionModeStore = suggestionModeStore
        self.projectFolderChooser = projectFolderChooser
        self.appUpdateChecker = appUpdateChecker
        self.appUpdateURLOpener = appUpdateURLOpener
        self.automaticAppUpdate = automaticAppUpdate ?? AppUpdateTransactionController()
        self.account = account
        self.usageAnalytics = usageAnalytics
        self.errorDiagnostics = errorDiagnostics
        self.feedback = feedback
        self.insightCards = insightCards ?? usageAnalytics.map { PetInsightCardTracker(analytics: $0) }
        self.processIdentifier = processIdentifier
        self.selectionIDGenerator = selectionIDGenerator
        self.permissionResponseIDGenerator = permissionResponseIDGenerator
        self.managedApprovalResponseIDGenerator = managedApprovalResponseIDGenerator
        self.choicePreviewHoldMonitor = choicePreviewHoldMonitor
        selectionReturnApplication = externalApplicationOpener
            .captureFrontmostExternalApplication(
                excludingProcessIdentifier: processIdentifier
            )
        applySuggestionModeLoadResult(suggestionModeStore.load())
        appService?.onChange = { [weak self] in self?.syncAppOwnedServiceState() }
        syncAppOwnedServiceState()
    }

    deinit {
        pollingTask?.cancel()
    }

    var focusedInteraction: PetInteraction? {
        guard let localForegroundIdentity,
              displayInteraction?.identity == localForegroundIdentity,
              snapshot?.routing.foreground == localForegroundIdentity,
              let interaction = snapshot?.interaction(identity: localForegroundIdentity),
              interaction.foreground
        else { return nil }
        return interaction
    }

    var fifoHeadInteraction: PetInteraction? {
        snapshotInteractions.first
    }

    var fifoQueueCount: Int {
        snapshotInteractions.count
    }

    var displayInteractionQueuePosition: Int? {
        guard let displayIdentity = displayInteraction?.identity,
              let index = snapshotInteractions.firstIndex(where: {
                  $0.identity == displayIdentity
              })
        else { return nil }
        return index + 1
    }

    var eventQueue: [PetQueuedEvent] { snapshot?.queuedEvents ?? [] }
    var eventQueueCount: Int { eventQueue.count }

    var displayedEvent: PetQueuedEvent? {
        guard let snapshot else { return nil }
        if let navigation = snapshot.eventNavigation {
            if let selectedEventReference, let event = snapshot.event(reference: selectedEventReference) {
                return event
            }
            if let focused = navigation.focused, let event = snapshot.event(reference: focused) {
                return event
            }
            return eventQueue.first
        }
        if let approval = defaultApprovalHead {
            switch approval {
            case .permission(let request): return .permission(request)
            case .managed(let request): return .managed(request)
            }
        }
        return fifoHeadInteraction.map(PetQueuedEvent.decision)
    }

    var displayedEventQueuePosition: Int? {
        guard let reference = displayedEvent?.reference,
              let index = eventQueue.firstIndex(where: { $0.reference == reference }) else { return nil }
        return index + 1
    }

    var displayInteraction: PetInteraction? {
        guard snapshot?.eventNavigation != nil else { return fifoHeadInteraction }
        guard case .decision(let interaction) = displayedEvent else { return nil }
        return interaction
    }

    private var defaultApprovalHead: PetApprovalHead? {
        guard provider == .codex, let snapshot else { return nil }
        return PetApprovalHead.first(
            permissionRequests: snapshot.permissionRequests,
            managedCommandApprovals: snapshot.managedCommandApprovals
        )
    }

    var approvalHead: PetApprovalHead? {
        guard provider == .codex else { return nil }
        return snapshot?.eventNavigation == nil ? defaultApprovalHead : displayedEvent?.approval
    }

    var eventDeliveryPending: Bool {
        snapshot?.eventNavigation?.deliveryPending
            ?? eventQueue.contains(where: \.deliveryPending)
    }

    var canNavigateEvents: Bool {
        provider == .codex && !isSwitchingProvider && !providerReadFailed
            && snapshot?.eventNavigation != nil && eventQueueCount > 1
            && !isShuttingDown && !isEditingShortcuts && !isShowingOnboarding && !isFeedbackWindowVisible
            && choicePreview == nil && !choicePreviewHoldMonitor.suppressesSelection
            && pendingEventFocus == nil && pendingFocusIdentity == nil
            && selectionSubmission == nil && inFlightSelectionIdentity == nil
            && inFlightDismissalIdentity == nil && riskConfirmation == nil
            && inFlightPermissionRequestID == nil && inFlightManagedCommandApprovalID == nil
            && !eventDeliveryPending
    }

    /// A new visible event never inherits another event's selection authority.
    var canActOnDisplayedEvent: Bool {
        guard !isShuttingDown, pendingEventFocus == nil, !eventDeliveryPending else { return false }
        guard providerAllowsSelection else { return false }
        guard let navigation = snapshot?.eventNavigation else { return true }
        guard let event = displayedEvent, navigation.focused == event.reference else { return false }
        if selectedEventReference != nil {
            return (try? event.focusTarget()) == confirmedEventFocus
        }
        // Default approval-first/FIFO operation remains available without browsing.
        if let approval = event.approval {
            return approval == defaultApprovalHead || (try? event.focusTarget()) == confirmedEventFocus
        }
        if case .decision(let interaction) = event {
            return interaction.identity == fifoHeadInteraction?.identity
                || (try? event.focusTarget()) == confirmedEventFocus
        }
        return false
    }

    func canRequestPanelSelection(_ identity: PetInteractionIdentity) -> Bool {
        canActOnDisplayedEvent && displayInteraction?.identity == identity
            && pendingFocusIdentity == nil && selectionSubmission == nil
            && inFlightDismissalIdentity == nil && inFlightSelectionIdentity == nil
            && inFlightPermissionRequestID == nil && inFlightManagedCommandApprovalID == nil
    }

    var approvalQueueCount: Int {
        (snapshot?.permissionRequests.count ?? 0)
            + (snapshot?.managedCommandApprovals.count ?? 0)
    }

    var pendingPermissionRequest: PetPermissionRequest? {
        guard case .permission(let request) = approvalHead else { return nil }
        return request
    }

    var pendingManagedCommandApproval: PetManagedCommandApproval? {
        guard case .managed(let request) = approvalHead else { return nil }
        return request
    }

    var managedCommandApprovalQueueCount: Int {
        snapshot?.managedCommandApprovals.count ?? 0
    }

    var permissionRequestQueueCount: Int {
        snapshot?.permissionRequests.count ?? 0
    }

    var hasNewPermissionNotice: Bool {
        approvalHead != nil
    }

    /// Shortcut registration diagnostics are not actionable while a permission
    /// card owns the panel. Keep the diagnostic for the normal and settings
    /// screens, but do not let it compete with a time-sensitive approval.
    var visibleShortcutDiagnostic: String? {
        if hasNewPermissionNotice || (provider == .claude && !supportsProviderSessions) { return nil }
        let messages = [shortcutDiagnostic, eventNavigationShortcutDiagnostic].compactMap { $0 }
        return messages.isEmpty ? nil : messages.joined(separator: " · ")
    }

    var hasVisibleStatusMessage: Bool {
        lastError != nil || visibleShortcutDiagnostic != nil || providerDiagnostic != nil
    }

    var hasPersistentApprovalResolutionError: Bool {
        persistentApprovalResolutionError != nil
    }

    var hasAttention: Bool {
        hasNewPermissionNotice
            || (providerAllowsSelection && fifoHeadInteraction?.isSelectionReady == true)
            || hasPersistentApprovalResolutionError
    }

    var presentationState: PetPresentationState {
        if snapshot == nil {
            return lastError == nil ? .disconnected : .malformed
        }
        if provider == .claude {
            if providerReadFailed { return .disconnected }
            guard let status = snapshot?.providerStatus, status.bridgeConnected, status.ready else {
                return .disconnected
            }
            if snapshot?.interactions.isEmpty == false { return .waiting }
            return providerHasPendingResult ? .working : .ready
        }
        if pendingManagedCommandApproval != nil || pendingPermissionRequest != nil {
            return .permission
        }
        if let focusedInteraction {
            if focusedInteraction.isExpired { return .expired }
            if focusedInteraction.reminderDue { return .reminder }
            if focusedInteraction.state == .waiting { return .waiting }
        }
        if let snapshot, snapshot.routing.inFlightCount > 0 { return .working }
        if let lastTerminalPresentation { return lastTerminalPresentation }
        if snapshot?.interactions.isEmpty == false { return .waiting }
        return .ready
    }

    var presentationTitle: String {
        if provider == .claude {
            if providerReadFailed { return "Claude 연결 확인 필요" }
            if let state = selectedProviderSession?.state {
                switch state {
                case "starting": return "Claude 시작 중"
                case "pending": return "연결 확인 중"
                case "disconnected": return "연결 끊김 · 새로 시작"
                case "unavailable": return "Claude 연결 사용 불가"
                default: break
                }
            }
            guard let status = snapshot?.providerStatus else { return "Claude 연결 대기" }
            if !status.bridgeConnected { return "Claude 연결 대기" }
            if !status.ready { return "연결 확인 필요" }
            if snapshot?.interactions.isEmpty == false {
                return status.selectionEnabled ? "결정 대기" : "Claude 응답 대기"
            }
            if supportsProviderSessions {
                if (snapshot?.routing.inFlightCount ?? 0) > 0 { return "전달 대기" }
                if status.pendingReportCount > 0 { return "Claude가 작업 확인" }
            }
            return providerHasPendingResult ? "선택 결과 대기" : "준비됨"
        }
        if isAppOwnedServiceEnabled, appOwnedServiceState != .ready {
            return appOwnedServiceState.title
        }
        return presentationState.displayTitle
    }

    var emptyStateDescription: String {
        if provider == .claude {
            if supportsProviderSessions {
                if providerReadFailed { return "연결 상태를 다시 확인하거나 새 Claude 세션을 시작해 주세요." }
                switch selectedProviderSession?.state {
                case "starting": return "선택한 프로젝트에서 새 Claude 세션을 시작하고 있습니다."
                case "pending": return "Claude의 연결 확인 응답을 기다리고 있습니다."
                case "disconnected": return "이 세션은 종료되었습니다. 메뉴에서 새 Claude 세션을 시작해 주세요."
                case "unavailable": return "이 세션의 연결을 준비하지 못했습니다. 연결 상태를 확인해 주세요."
                default: break
                }
            }
            guard let status = snapshot?.providerStatus, status.bridgeConnected else {
                return supportsProviderSessions ? "선택한 Claude 세션의 연결을 기다리고 있습니다."
                    : "이 창을 연 Claude 세션의 연결을 기다리고 있습니다."
            }
            if !status.ready { return supportsProviderSessions ? "메뉴에서 연결 확인을 선택해 주세요."
                : "같은 Claude 대화창에서 Blabee 연결 확인을 요청해 주세요." }
            if providerHasPendingResult {
                return "선택을 접수했습니다. Claude의 작업 결과 보고를 기다리고 있습니다."
            }
            return "Claude가 제안을 보내면 여기에 표시됩니다."
        }
        if isAppOwnedServiceEnabled, appOwnedServiceState != .ready {
            return appOwnedServiceState.detail
        }
        return snapshot == nil
            ? "설정에서 서비스 연결 상태를 확인해 주세요."
            : "유효한 결정 카드가 생기면 여기에 표시됩니다."
    }

    var isAppOwnedServiceAvailable: Bool { appService != nil }

    var supportsProviderSessions: Bool { transport is any PetProviderControlling }
    var supportsProductSettings: Bool { provider == .codex || supportsProviderSessions }
    var supportsDecisionDismissal: Bool { provider == .codex }
    private var providerAllowsSelection: Bool {
        !isSwitchingProvider && !providerReadFailed && (provider == .codex || (snapshot?.providerStatus?.provider == .claude
            && snapshot?.providerStatus?.selectionEnabled == true)
        )
    }

    var selectedProviderContext: PetProviderContext? { snapshot?.providerContext }
    var selectedProviderSession: PetProviderSession? {
        guard let context = selectedProviderContext else { return nil }
        return providerSessions.first { $0.context == context }
    }
    var providerSessionTitle: String {
        selectedProviderSession?.title ?? provider.displayName
    }
    var canStartClaude: Bool {
        supportsProviderSessions && startClaude != nil && claudeStartGuidance == nil
            && !isStartingClaude && !isShuttingDown
    }
    var claudeStartGuidance: String? {
        guard supportsProviderSessions, startClaude != nil, let appService else { return nil }
        switch appService.state {
        case .ready where appService.petProviderAccess != nil:
            return nil
        case .disabled:
            return "Claude를 사용하려면 설정의 연결 탭에서 ‘앱 실행형 서비스 켜기’를 선택하세요. Codex Plugin 설치는 필요하지 않습니다."
        case .blocked:
            return "진행 중인 Blabee 선택을 마친 뒤 설정의 연결 탭에서 ‘macOS 자동 시작 서비스’를 등록 해제하고 ‘서비스 다시 시작’을 선택하세요."
        case .stopped:
            return "설정의 연결 탭에서 ‘서비스 다시 시작’을 선택한 뒤 Claude를 시작하세요."
        case .starting, .reconnecting, .unresponsive, .stopping:
            return "Claude를 시작하기 전에 서비스 연결을 확인해야 합니다. \(appService.state.detail)"
        case .ready, .failed:
            return "Claude 연결에 필요한 서비스를 확인하지 못했습니다. 설정의 연결 탭에서 서비스 상태를 확인하세요."
        }
    }
    var canControlClaudeConnection: Bool {
        supportsProviderSessions && provider == .claude && selectedProviderContext != nil
            && !isSwitchingProvider && !isProviderConnectionOperationInFlight && !isShuttingDown
    }
    var providerDiagnostic: String? { snapshot?.providerDiagnostic }
    var providerPendingResultDescription: String? {
        guard supportsProviderSessions, provider == .claude, providerHasPendingResult else { return nil }
        if selectedProviderSession?.state == "disconnected" {
            return "결과 미확인 · 종료된 세션의 작업 완료 여부를 확인하지 못했습니다."
        }
        let reports = snapshot?.providerStatus?.pendingReportCount ?? 0
        if reports > 0 { return "Claude가 작업 확인 · \(reports)건의 결과 보고 대기" }
        return "전달 대기 · Claude의 선택 확인을 기다리고 있습니다."
    }

    func captureProviderActionContext() -> ProviderActionContext {
        ProviderActionContext(serviceGeneration: appService?.generation,
                              providerGeneration: providerGeneration,
                              expectedContext: selectedProviderContext)
    }

    func acceptsProviderAction(_ context: ProviderActionContext) -> Bool {
        !isShuttingDown && context.serviceGeneration == appService?.generation
            && context.providerGeneration == providerGeneration
            && context.expectedContext == selectedProviderContext
    }

    func selectProviderSession(_ session: PetProviderSession) async {
        guard let controller = transport as? any PetProviderControlling,
              !isSwitchingProvider, !isShuttingDown,
              providerSessions.contains(where: { $0 == session }),
              session.context != selectedProviderContext else { return }
        invalidateProviderInteractionState()
        provider = session.context.provider
        snapshot = nil
        isSwitchingProvider = true
        let context = captureProviderActionContext()
        defer {
            // The refresh may legitimately adopt a new provider context. Only
            // this serialized switch owns the switching flag.
            isSwitchingProvider = false
            updateHotKeyEligibility()
        }
        do {
            guard acceptsProviderAction(context) else { return }
            try await controller.selectSession(session)
            guard acceptsProviderAction(context) else { return }
            await fetchAndApplySnapshot()
        } catch {
            guard acceptsProviderAction(context) else { return }
            lastError = String(describing: error)
        }
    }

    func startClaudeSession() async {
        if let guidance = claudeStartGuidance {
            lastError = guidance
            return
        }
        guard canStartClaude, let startClaude else { return }
        let context = captureProviderActionContext()
        isStartingClaude = true
        defer { isStartingClaude = false }
        do {
            try await startClaude()
            guard acceptsProviderAction(context) else { return }
            await fetchAndApplySnapshot()
        } catch {
            guard acceptsProviderAction(context) else { return }
            lastError = (error as? PetClaudeLauncher.Failure)?.errorDescription
                ?? "Claude 시작 요청을 확인하지 못했어요."
        }
    }

    func checkClaudeConnection(context: ProviderActionContext? = nil) async {
        await performClaudeConnectionOperation(disconnect: false, context: context)
    }

    func disconnectClaudeSession(context: ProviderActionContext? = nil) async {
        await performClaudeConnectionOperation(disconnect: true, context: context)
    }

    private func performClaudeConnectionOperation(
        disconnect: Bool, context suppliedContext: ProviderActionContext?
    ) async {
        let context = suppliedContext ?? captureProviderActionContext()
        guard acceptsProviderAction(context), canControlClaudeConnection,
              let expectedContext = context.expectedContext,
              let controller = transport as? any PetProviderControlling else { return }
        let operationID = UUID()
        providerConnectionOperationID = operationID
        isProviderConnectionOperationInFlight = true
        defer {
            if providerConnectionOperationID == operationID {
                providerConnectionOperationID = nil
                isProviderConnectionOperationInFlight = false
            }
        }
        do {
            if disconnect { try await controller.disconnect(expectedContext) }
            else { try await controller.checkConnection(expectedContext) }
            guard acceptsProviderAction(context) else { return }
            await fetchAndApplySnapshot()
        } catch {
            guard acceptsProviderAction(context) else { return }
            lastError = String(describing: error)
        }
    }

    private func invalidateProviderInteractionState() {
        providerGeneration &+= 1
        invalidateFocusOperation()
        endChoicePreview()
        selectedEventReference = nil
        confirmedEventFocus = nil
        pendingEventFocus = nil
        automaticallyFocusingEvent = false
        localForegroundIdentity = nil
        pendingFocusIdentity = nil
        inFlightSelectionIdentity = nil
        selectionSubmission = nil
        inFlightDismissalIdentity = nil
        inFlightPermissionRequestID = nil
        inFlightManagedCommandApprovalID = nil
        riskConfirmation = nil
        lastTerminalPresentation = nil
        persistentApprovalResolutionError = nil
        lastError = nil
        providerConnectionOperationID = nil
        isProviderConnectionOperationInFlight = false
        permissionReturnApplications = [:]
        managedApprovalReturnApplications = [:]
        selectionReturnApplication = nil
        updateHotKeyEligibility()
    }
    private var providerHasPendingResult: Bool {
        (snapshot?.routing.inFlightCount ?? 0) > 0
            || (snapshot?.providerStatus?.pendingReportCount ?? 0) > 0
    }

    var canChangeAppOwnedService: Bool {
        appService != nil && !isShuttingDown
            && !isOnboardingConfigurationOperationInFlight
            && appService?.isTransitioning != true
    }

    private func syncAppOwnedServiceState() {
        guard let appService else { return }
        if appOwnedServiceState != appService.state { appOwnedServiceState = appService.state }
        if isAppOwnedServiceEnabled != appService.enabled { isAppOwnedServiceEnabled = appService.enabled }
        if !appService.mayQueryCoordinator {
            if !connectionReceivedCardProjectPaths.isEmpty {
                connectionReceivedCardProjectPaths = []
            }
            let previousApproval = approvalHead?.identity
            invalidateFocusOperation()
            snapshot = nil
            confirmedEventFocus = nil
            pendingEventFocus = nil
            automaticallyFocusingEvent = false
            localForegroundIdentity = nil
            pendingFocusIdentity = nil
            // A new service generation must not inherit an old request's
            // disabled controls. Late completions are fenced at each await.
            inFlightPermissionRequestID = nil
            inFlightManagedCommandApprovalID = nil
            inFlightSelectionIdentity = nil
            selectionSubmission = nil
            inFlightDismissalIdentity = nil
            riskConfirmation = nil
            lastTerminalPresentation = nil
            updateHotKeyEligibility()
            onAttentionChanged?(hasAttention)
            if previousApproval != nil { onApprovalHeadChanged?(nil) }
        }
    }

    var isRecoveryCapable: Bool {
        guard let focusedInteraction else { return false }
        return focusedInteraction.checkpoint.isRecoveryCapable
            && focusedInteraction.choice(slot: 4)?.enabled == true
    }

    var hookReadinessProjectPaths: [String] {
        (configuredProjectPathsAreAuthoritative ? Set(configuredProjectPaths) : activeProjectPaths).sorted()
    }

    var hookReadinessProjectPath: String? {
        if let selectedHookProjectPath, hookReadinessProjectPaths.contains(selectedHookProjectPath) {
            return selectedHookProjectPath
        }
        return hookReadinessProjectPaths.first
    }

    var codexHookReadiness: PetHookReadinessState {
        guard checkedHookProjectPath == hookReadinessProjectPath else { return .unchecked }
        return rawCodexHookReadiness
    }

    var isConnectionSetupReady: Bool {
        guard codexHookReadiness == .trusted else { return false }
        switch connectionReadiness.status {
        case .awaitingVerification, .receiving: return true
        default: return false
        }
    }

    var canCheckCodexHooks: Bool {
        guard !isShuttingDown, !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight,
              !isStorageRecoveryOperationInFlight, hookReadinessProjectPath != nil,
              case .installedNeedsHookReview = codexPluginSetupState else { return false }
        return true
    }

    func selectHookProject(_ path: String) {
        guard hookReadinessProjectPaths.contains(path), path != hookReadinessProjectPath else { return }
        selectedHookProjectPath = path
        invalidateHookReadiness()
    }

    private func invalidateHookReadiness() {
        hookCheckGeneration = UUID()
        checkedHookProjectPath = nil
        rawCodexHookReadiness = .unchecked
    }

    func checkCodexHooks() async {
        guard canCheckCodexHooks, let path = hookReadinessProjectPath else { return }
        let generation = UUID()
        hookCheckGeneration = generation
        isCodexHookCheckInFlight = true
        checkedHookProjectPath = path
        rawCodexHookReadiness = .checking
        defer { isCodexHookCheckInFlight = false }
        let result = await hookReadinessManager.inspect(projectURL: URL(fileURLWithPath: path))
        guard hookCheckGeneration == generation, path == hookReadinessProjectPath,
              !isShuttingDown, !Task.isCancelled else {
            if hookCheckGeneration == generation { invalidateHookReadiness() }
            return
        }
        rawCodexHookReadiness = result
    }

    /// Recovery is exposed only while the service is fully stopped. The engine
    /// independently takes process locks and revalidates the confirmed plan.
    var canPrepareStorageRecovery: Bool {
        guard isAppOwnedServiceAvailable, !isShuttingDown,
              !isOnboardingOperationInFlight, !hasVerifiedServiceConnection,
              appService?.hasOwnedChild == false, appService?.isTransitioning == false,
              onboardingServiceState == .notRegistered || onboardingServiceState == .notFound
        else { return false }
        switch appOwnedServiceState {
        case .disabled, .stopped: return true
        case .failed(let code): return code == "freshness_storage_missing"
        default: return false
        }
    }

    func cancelStorageRecovery() {
        storageRecoveryGeneration = UUID()
        storageRecoveryConfirmation = nil
    }

    func prepareStorageRecovery() async {
        guard (isShowingSettings || firstRunSetupActive), canPrepareStorageRecovery else { return }
        cancelStorageRecovery()
        let generation = storageRecoveryGeneration
        storageRecoveryError = nil
        storageRecoveryReceipt = nil
        isStorageRecoveryOperationInFlight = true
        defer { isStorageRecoveryOperationInFlight = false }
        do {
            let confirmation = try await storageRecoveryManager.prepare()
            guard storageRecoveryGeneration == generation, !isShuttingDown, !Task.isCancelled,
                  isShowingSettings || firstRunSetupActive else { return }
            storageRecoveryConfirmation = confirmation
        } catch {
            guard storageRecoveryGeneration == generation, !isShuttingDown else { return }
            storageRecoveryError = PetStorageRecoveryMessage.failure(error)
        }
    }

    func confirmStorageRecovery() async {
        reloadOnboardingState()
        guard (isShowingSettings || firstRunSetupActive), canPrepareStorageRecovery,
              let confirmation = storageRecoveryConfirmation else { return }
        // Consume once before awaiting; duplicate clicks cannot replay a reset.
        cancelStorageRecovery()
        storageRecoveryError = nil
        isStorageRecoveryOperationInFlight = true
        do {
            storageRecoveryReceipt = try await storageRecoveryManager.recover(confirmation: confirmation)
            invalidateHookReadiness()
            connectionReceivedCardProjectPaths = []
        } catch {
            storageRecoveryError = PetStorageRecoveryMessage.failure(error)
        }
        isStorageRecoveryOperationInFlight = false
        guard storageRecoveryReceipt != nil, !isShuttingDown, !Task.isCancelled else { return }
        // Re-enabling is part of the user's confirmed 'start fresh' action.
        // A later verified snapshot, not the receipt, establishes service health.
        if isAppOwnedServiceEnabled { await restartAppOwnedService() }
        else { await enableAppOwnedService() }
    }

    var activeProjectPaths: Set<String> {
        Set((snapshot ?? firstRunSetupSnapshot)?.projects.filter(\.enabled).map(\.cwd) ?? [])
    }

    /// Installation, a responding service, and a received card are different
    /// evidence. In particular, persisted sessions do not prove Hook trust or
    /// the health of the user's currently focused terminal.
    var connectionReadiness: PetConnectionReadiness {
        let connected = hasVerifiedServiceConnection
        let transitioning = isAppOwnedServiceEnabled && (
            appOwnedServiceState == .starting || appOwnedServiceState == .reconnecting
                || appOwnedServiceState == .stopping
        )
        let serviceIssueRequiresAction = isAppOwnedServiceEnabled && (
            appOwnedServiceState == .blocked || appOwnedServiceState == .unresponsive
        )
        let serviceIssue: String?
        if isAppOwnedServiceEnabled,
           case .failed = appOwnedServiceState {
            serviceIssue = appOwnedServiceState.detail
        } else if serviceIssueRequiresAction {
            serviceIssue = appOwnedServiceState.detail
        } else if coordinatorTransportError != nil, !transitioning {
            serviceIssue = "서비스 응답을 확인하지 못했습니다. 서비스 설정에서 다시 연결해 주세요."
        } else {
            serviceIssue = nil
        }
        return PetConnectionReadiness(
            pluginState: codexPluginSetupState,
            serviceConnected: connected,
            serviceIsTransitioning: transitioning,
            serviceIssue: serviceIssue,
            serviceIssueRequiresAction: serviceIssueRequiresAction,
            configuredProjectPaths: configuredProjectPathsAreAuthoritative
                ? configuredProjectPaths : nil,
            activeProjectPaths: connected ? activeProjectPaths : nil,
            receivedCardProjectPaths: connected ? connectionReceivedCardProjectPaths : [],
            hookReadiness: codexHookReadiness,
            hookProjectPath: hookReadinessProjectPath
        )
    }

    var connectionNextStepTitle: String {
        if connectionReadiness.nextStep == .restartService,
           !isAppOwnedServiceEnabled || !canChangeAppOwnedService {
            return "프로젝트 적용 방법"
        }
        return connectionReadiness.nextStepTitle
    }

    var hasVerifiedServiceConnection: Bool {
        (snapshot != nil || firstRunSetupSnapshot != nil) && coordinatorTransportError == nil
            && (!isAppOwnedServiceEnabled || appOwnedServiceState == .ready)
    }

    var projectSettingsNeedRestart: Bool {
        hasVerifiedServiceConnection && configuredProjectPathsAreAuthoritative
            && Set(configuredProjectPaths) != activeProjectPaths
    }

    var activeOnlyProjectPaths: [String] {
        guard configuredProjectPathsAreAuthoritative else { return [] }
        return activeProjectPaths
            .subtracting(configuredProjectPaths)
            .sorted()
    }

    var isOnboardingOperationInFlight: Bool {
        isOnboardingServiceOperationInFlight
            || isCodexPluginOperationInFlight
            || isOnboardingProjectOperationInFlight
            || isLegacyShellCleanupOperationInFlight
            || isCodexHookCheckInFlight || isStorageRecoveryOperationInFlight
    }

    private var isOnboardingConfigurationOperationInFlight: Bool {
        isOnboardingServiceOperationInFlight || isOnboardingProjectOperationInFlight
            || isStorageRecoveryOperationInFlight
    }

    var canRegisterOnboardingService: Bool {
        (onboardingServiceState == .notRegistered
            || onboardingServiceState == .notFound)
            && !isOnboardingConfigurationOperationInFlight
            && !isAppOwnedServiceEnabled && appService?.hasOwnedChild != true
    }

    var canUnregisterOnboardingService: Bool {
        (onboardingServiceState == .enabled
            || onboardingServiceState == .requiresApproval)
            && !isOnboardingConfigurationOperationInFlight
            && appService?.hasOwnedChild != true
    }

    var canOpenOnboardingSystemSettings: Bool {
        onboardingServiceState == .requiresApproval
            && !isOnboardingConfigurationOperationInFlight
    }

    var onboardingServiceNeedsRuntimeAttention: Bool {
        onboardingServiceState == .enabled && coordinatorTransportError != nil
    }

    var canMutateOnboardingProjects: Bool {
        guard configuredProjectPathsAreAuthoritative else { return false }
        if isAppOwnedServiceEnabled, onboardingServiceState == .notFound {
            return !isOnboardingConfigurationOperationInFlight
        }
        return switch onboardingServiceState {
        case .notRegistered, .enabled, .requiresApproval:
            !isOnboardingConfigurationOperationInFlight
        case .notFound, .unknown:
            false
        }
    }

    var canConnectCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight else { return false }
        return switch codexPluginSetupState {
        case .unchecked, .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable: true
        case .unavailable, .installedNeedsHookReview, .legacyInstallationDetected, .conflict, .error: false
        }
    }

    var canDisconnectCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight else { return false }
        return switch codexPluginSetupState {
        case .marketplaceInstalledNeedsPlugin, .installedNeedsHookReview, .updateAvailable: true
        case .unchecked, .unavailable, .notInstalled, .legacyInstallationDetected, .conflict, .error: false
        }
    }

    var canMigrateLegacyCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight else { return false }
        return switch codexPluginSetupState {
        case .legacyInstallationDetected: true
        case .unchecked, .unavailable, .notInstalled, .marketplaceInstalledNeedsPlugin,
             .installedNeedsHookReview, .updateAvailable, .conflict, .error: false
        }
    }

    func attachHotKeyRegistry(_ registry: PetHotKeyRegistry) {
        endChoicePreview()
        hotKeyRegistry?.onEventNavigationRequested = nil
        hotKeyRegistry?.reconcileEventNavigation(contextID: nil)
        hotKeyRegistry?.onPreviewRequested = nil
        hotKeyRegistry?.reconcilePreviews(eligibleSlots: [])
        hotKeyRegistry?.onApprovalRequested = nil
        hotKeyRegistry?.onApprovalShortcutAvailabilityChanged = nil
        hotKeyRegistry?.reconcileApproval(head: nil)
        hotKeyRegistry = registry
        registry.onEventNavigationRequested = { [weak self] activation in
            guard let context = self?.captureProviderActionContext() else { return }
            Task { [weak self] in
                guard let self, self.acceptsProviderAction(context), self.canNavigateEvents, self.isPanelVisible,
                      self.hotKeyRegistry?.isCurrentEventNavigationActivation(activation) == true,
                      self.eventNavigationContextID == activation.contextID else { return }
                switch activation.direction {
                case .previous: await self.navigateToPreviousEvent()
                case .next: await self.navigateToNextEvent()
                }
            }
        }
        registry.onPreviewRequested = { [weak self] slot in self?.beginChoicePreview(slot: slot) }
        registry.onApprovalRequested = { [weak self] activation in
            // The event carries the displayed request captured by Carbon,
            // rather than looking up a possibly newer FIFO head in this Task.
            guard let context = self?.captureProviderActionContext() else { return }
            Task { [weak self] in
                guard let self, self.acceptsProviderAction(context) else { return }
                await self.handleApprovalShortcut(activation)
            }
        }
        registry.onApprovalShortcutAvailabilityChanged = { [weak self] in
            self?.refreshApprovalShortcutPresentation()
        }
        shortcutConfiguration = registry.configuration
        shortcutDraft = registry.configuration
        shortcutSettingsError = nil
        updateHotKeyEligibility()
    }

    var canSaveShortcutSettings: Bool {
        hotKeyRegistry != nil && shortcutDraft.validationIssue() == nil
            && shortcutDraft.previewValidationIssue() == nil
    }

    var isShowingSettings: Bool { isShowingOnboarding || isEditingShortcuts }

    func selectSettingsTab(_ tab: PetSettingsTab) {
        guard isShowingSettings else { return }
        if tab == .shortcuts, !isEditingShortcuts {
            beginShortcutSettings()
        } else {
            selectedSettingsTab = tab
        }
    }

    func toggleShortcutSettings() {
        if isEditingShortcuts {
            cancelShortcutSettings()
        } else {
            beginShortcutSettings()
        }
    }

    func beginShortcutSettings() {
        guard supportsProductSettings else { return }
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        isShowingOnboarding = false
        shortcutDraft = shortcutConfiguration
        shortcutSettingsError = nil
        selectedSettingsTab = .shortcuts
        isEditingShortcuts = true
        setExpanded(true)
    }

    func cancelShortcutSettings() {
        cancelStorageRecovery()
        if isEditingShortcuts {
            clearLegacyCodexPluginMigrationConfirmation()
            cancelLegacyShellCleanup()
        }
        shortcutDraft = shortcutConfiguration
        shortcutSettingsError = nil
        selectedSettingsTab = .general
        isEditingShortcuts = false
    }

    func toggleOnboarding() async {
        if isShowingOnboarding {
            closeOnboarding()
        } else {
            await beginOnboarding()
        }
    }

    func beginOnboarding() async {
        guard supportsProductSettings else { return }
        cancelShortcutSettings()
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        selectedSettingsTab = .general
        isShowingOnboarding = true
        setExpanded(true)
        await refreshOnboarding()
    }

    func closeOnboarding() {
        cancelStorageRecovery()
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        selectedSettingsTab = .general
        isShowingOnboarding = false
    }

    var appVersionDisplay: String {
        appUpdateChecker.currentVersion?.displayLabel ?? "확인할 수 없음"
    }

    var isCheckingForAppUpdate: Bool { appUpdateState.isChecking }

    func showAppUpdateSettings() {
        cancelShortcutSettings()
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        selectedSettingsTab = .general
        isShowingOnboarding = true
        setExpanded(true)
        appUpdateSettingsRequestID = UUID()
        refreshLocalOnboardingState()
    }

    func checkForAppUpdates() async {
        guard !isCheckingForAppUpdate else { return }
        appUpdateState = .checking
        let productContext = usageAnalytics?.captureContext()
        let result = await appUpdateChecker.checkForUpdates()
        appUpdateState = Task.isCancelled ? .notChecked : result
        if !Task.isCancelled, !isShuttingDown, let release = result.availableRelease,
           let productContext {
            usageAnalytics?.observeUpdateAvailable(
                version: release.version.version, build: release.version.build, context: productContext
            )
        }
    }

    /// Called only after verified account state or an explicit consent change.
    /// Snapshot-derived milestones wait for a new, consent-bound request.
    func observeProductAccountState() {
        usageAnalytics?.observeEnvironment()
        usageAnalytics?.observeMilestone(.accountReady)
        automaticAppUpdate.recoverProductMetrics()
        reconcileInsightPresentation()
    }

    func requestFeedback() {
        let suggestion: String?
        if !isShowingOnboarding, !isEditingShortcuts, approvalHead == nil,
           let interaction = displayInteraction {
            suggestion = ([interaction.summary] + interaction.actionChoices.map(\.displayTitle))
                .joined(separator: "\n")
        } else { suggestion = nil }
        onFeedbackRequested?(suggestion)
    }

    func setFeedbackWindowVisible(_ visible: Bool) {
        guard isFeedbackWindowVisible != visible else { return }
        isFeedbackWindowVisible = visible
        if visible { endChoicePreview() }
        updateHotKeyEligibility()
    }

    func clearInsightIdentity() {
        insightCards?.reset()
        insightCardKeys.removeAll()
        insightOwner = nil
    }

    private func insightKey(for identity: InsightCardIdentity) -> String {
        if let key = insightCardKeys[identity] { return key }
        if insightCardKeys.count >= PetUsageAnalytics.maximumEventCount,
           let oldest = insightCardKeys.keys.first { insightCardKeys.removeValue(forKey: oldest) }
        let key = UUID().uuidString
        insightCardKeys[identity] = key
        return key
    }

    /// Mirrors PetRootView's content priority after snapshot reconciliation.
    /// A received/background card, held preview, or hidden panel is not a view.
    private func reconcileInsightPresentation() {
        guard !isApplyingSnapshot else { return }
        // Temporary token verification pauses observation; it does not turn a
        // previously visible card into another impression. Logout clears below
        // through the explicit application lifecycle callback.
        guard let owner = usageAnalytics?.productIdentity else { return }
        if owner != insightOwner {
            clearInsightIdentity()
            insightOwner = owner
        }
        guard isPanelVisible, !isShuttingDown else { return }
        if let approval = approvalHead {
            insightCards?.present(key: insightKey(for: .approval(approval.identity)), kind: .approval)
        } else if !isShowingOnboarding, !isEditingShortcuts, choicePreview == nil,
                  let interaction = displayInteraction, interaction.isSelectionReady {
            insightCards?.present(key: insightKey(for: .suggestion(interaction.identity)), kind: .suggestion)
        }
    }

    func openAppUpdateLocation() {
        guard let release = appUpdateState.availableRelease else { return }
        if !appUpdateURLOpener(release.releaseURL) {
            appUpdateState = .unavailable("릴리스 페이지를 열지 못했습니다. 기본 브라우저 설정을 확인한 뒤 다시 시도해 주세요.")
        }
    }

    // Shell inspection is explicit and independent of Codex execution/Plugin setup.
    // Merely opening settings never reads or changes the user's shell integration.
    func inspectLegacyShellCleanup() async {
        guard !isLegacyShellCleanupOperationInFlight else { return }
        cancelLegacyShellCleanup()
        await performOnboardingOperation(.legacyShell) {
            legacyShellCleanupInspection = await legacyShellCleanupManager.inspect()
        }
    }

    func prepareLegacyShellCleanup() async {
        guard isShowingSettings, !isLegacyShellCleanupOperationInFlight,
              legacyShellCleanupInspection?.canPrepare == true
        else { return }
        cancelLegacyShellCleanup()
        let generation = legacyShellConfirmationGeneration
        await performOnboardingOperation(.legacyShell) {
            let confirmation = await legacyShellCleanupManager.prepare()
            guard generation == legacyShellConfirmationGeneration, isShowingSettings else { return }
            legacyShellCleanupConfirmation = confirmation
            if confirmation == nil {
                legacyShellCleanupInspection = await legacyShellCleanupManager.inspect()
            }
        }
    }

    func cancelLegacyShellCleanup() {
        legacyShellConfirmationGeneration = UUID()
        legacyShellCleanupConfirmation = nil
    }

    func confirmLegacyShellCleanup() async {
        guard isShowingSettings, !isLegacyShellCleanupOperationInFlight,
              let confirmation = legacyShellCleanupConfirmation
        else { return }
        // Consume the UI confirmation before awaiting; a double click cannot replay it.
        cancelLegacyShellCleanup()
        await performOnboardingOperation(.legacyShell) {
            legacyShellCleanupInspection = await legacyShellCleanupManager.cleanup(confirmation: confirmation)
        }
    }

    func updateSuggestionMode(_ mode: BlabeeSuggestionMode) {
        suggestionModeStore.save(mode)
        suggestionMode = mode
        suggestionModeDiagnostic = nil
    }

    func refreshOnboarding() async {
        refreshLocalOnboardingState()
    }

    private func refreshLocalOnboardingState() {
        guard !isOnboardingServiceOperationInFlight,
              !isOnboardingProjectOperationInFlight
        else {
            onboardingRefreshRequested = true
            return
        }
        reloadOnboardingState()
    }

    func refreshAllOnboardingSettings() async {
        await refreshOnboarding()
        await refreshCodexPluginSetup()
    }

    func beginFirstRunSetup() {
        guard !firstRunSetupActive else { return }
        firstRunSetupActive = true
        firstRunSetupGeneration = UUID()
        firstRunRefreshToken = nil
    }

    func endFirstRunSetup() {
        cancelStorageRecovery()
        firstRunSetupActive = false
        firstRunSetupGeneration = UUID()
        firstRunRefreshToken = nil
        firstRunSetupSnapshot = nil
        cancelShortcutSettings()
    }

    /// The wizard checks service health without claiming to display live cards.
    /// No consumer heartbeat, focus, presentation, or selection is sent here.
    func refreshFirstRunSetup(inspectSettings: Bool = true) async {
        guard firstRunSetupActive, !isShuttingDown, firstRunRefreshToken == nil else { return }
        let setupGeneration = firstRunSetupGeneration
        let token = UUID()
        firstRunRefreshToken = token
        defer { if firstRunRefreshToken == token { firstRunRefreshToken = nil } }
        if inspectSettings { await refreshAllOnboardingSettings() }
        guard firstRunSetupActive, firstRunSetupGeneration == setupGeneration,
              !isShuttingDown, !Task.isCancelled else { return }
        appService?.checkChildBeforePolling()
        guard appService?.mayQueryCoordinator != false else {
            firstRunSetupSnapshot = nil
            return
        }
        let generation = appService?.generation
        let context = captureProviderActionContext()
        do {
            let data = try await transport.request(type: "get_state", payload: Data("{}".utf8), expectedContext: nil)
            guard acceptsProviderAction(context) else { return }
            let parsed = try await transport.decodeSnapshot(data)
            guard acceptsProviderAction(context), firstRunSetupActive, firstRunSetupGeneration == setupGeneration,
                  !isShuttingDown, !Task.isCancelled,
                  generation.map({ appService?.acceptsSnapshot(generation: $0) == true }) ?? true
            else { return }
            if let generation { appService?.receivedVerifiedSnapshot(generation: generation) }
            firstRunSetupSnapshot = parsed
            coordinatorTransportError = nil
        } catch {
            guard acceptsProviderAction(context), firstRunSetupActive, firstRunSetupGeneration == setupGeneration,
                  !isShuttingDown, !Task.isCancelled,
                  generation == appService?.generation else { return }
            firstRunSetupSnapshot = nil
            if supportsProviderSessions, context.expectedContext?.provider == .claude {
                lastError = String(describing: error)
            } else {
                if let generation { appService?.connectionFailed(generation: generation) }
                coordinatorTransportError = String(describing: error)
            }
        }
    }

    func refreshCodexPluginSetup() async {
        invalidateHookReadiness()
        guard !isCodexPluginOperationInFlight else {
            codexPluginRefreshRequested = true
            return
        }
        await performOnboardingOperation(.codexPlugin) {
            codexPluginSetupState = await codexPluginSetupManager.inspect()
            clearLegacyCodexPluginMigrationConfirmation()
        }
    }

    func recheckCodexNativeExecutable() async {
        // Explicit retries are never queued behind another Plugin operation.
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight else { return }
        await performOnboardingOperation(.codexPlugin) {
            let insightContext = usageAnalytics?.captureContext()
            var report = CodexPluginRecheckReport()
            let startedUptime = DispatchTime.now().uptimeNanoseconds
            codexNativeRecheckReport = report
            let result = await codexPluginSetupManager.recheckNativeExecutableWithReport()
            report.completedAt = Date()
            let finishedUptime = DispatchTime.now().uptimeNanoseconds
            report.elapsedSeconds = Double(finishedUptime - startedUptime) / 1_000_000_000
            report.result = result
            codexPluginSetupState = result.state
            codexNativeRecheckReport = report
            clearLegacyCodexPluginMigrationConfirmation()
            if let insightContext {
                let version = PetProductEnvironment.normalizedVersion(result.evidence.codexVersion ?? "unknown")
                let compatibility: PetInsightCompatibility = version == "unknown" ? .unknown
                    : CodexCompatibility.pluginCLISupportedVersions.contains(version) ? .qualified : .unqualified
                let mode: PetInsightConnectionMode
                switch result.state {
                case .installedNeedsHookReview, .updateAvailable: mode = .plugin
                default: mode = .unknown
                }
                usageAnalytics?.observeConnection(codexVersion: version, mode: mode,
                    compatibility: compatibility, context: insightContext)
            }
        }
    }

    func connectCodexPlugin() async {
        guard canConnectCodexPlugin else { return }
        await performOnboardingOperation(.codexPlugin) {
            codexPluginSetupState = await codexPluginSetupManager.connect()
            clearLegacyCodexPluginMigrationConfirmation()
        }
    }

    func disconnectCodexPlugin() async {
        guard canDisconnectCodexPlugin else { return }
        await performOnboardingOperation(.codexPlugin) {
            codexPluginSetupState = await codexPluginSetupManager.disconnect()
            clearLegacyCodexPluginMigrationConfirmation()
        }
    }

    func beginLegacyCodexPluginMigrationConfirmation() {
        guard canMigrateLegacyCodexPlugin,
              case let .legacyInstallationDetected(_, confirmation) = codexPluginSetupState
        else { return }
        legacyCodexPluginMigrationConfirmation = confirmation
        isConfirmingLegacyCodexPluginMigration = true
    }

    func cancelLegacyCodexPluginMigrationConfirmation() {
        clearLegacyCodexPluginMigrationConfirmation()
    }

    func migrateLegacyCodexPlugin() async {
        guard canMigrateLegacyCodexPlugin,
              isConfirmingLegacyCodexPluginMigration,
              let confirmation = legacyCodexPluginMigrationConfirmation,
              case let .legacyInstallationDetected(_, currentConfirmation) = codexPluginSetupState,
              currentConfirmation == confirmation
        else { return }
        clearLegacyCodexPluginMigrationConfirmation()
        await performOnboardingOperation(.codexPlugin) {
            codexPluginSetupState = await codexPluginSetupManager
                .migrateLegacyInstallation(confirmation: confirmation)
        }
    }

    private func clearLegacyCodexPluginMigrationConfirmation() {
        legacyCodexPluginMigrationConfirmation = nil
        isConfirmingLegacyCodexPluginMigration = false
    }

    func registerOnboardingService() async {
        guard canRegisterOnboardingService else { return }
        await performOnboardingOperation(.service) {
            let operationError: String?
            do {
                try onboardingAdapter.registerService()
                operationError = nil
            } catch {
                operationError = String(describing: error)
            }
            reloadOnboardingState(operationError: operationError)
        }
    }

    func enableAppOwnedService() async {
        guard canChangeAppOwnedService, let appService else { return }
        await performOnboardingOperation(.service) {
            appService.enable()
            reloadOnboardingState()
        }
    }

    func restartAppOwnedService() async {
        guard canChangeAppOwnedService, let appService else { return }
        await performOnboardingOperation(.service) {
            await appService.restart()
            reloadOnboardingState()
        }
    }

    func disableAppOwnedService() async {
        guard canChangeAppOwnedService, let appService else { return }
        await performOnboardingOperation(.service) {
            await appService.disable()
            reloadOnboardingState()
        }
    }

    func unregisterOnboardingService() async {
        guard canUnregisterOnboardingService else { return }
        await performOnboardingOperation(.service) {
            let operationError: String?
            do {
                try await onboardingAdapter.unregisterService()
                operationError = nil
            } catch {
                operationError = String(describing: error)
            }
            reloadOnboardingState(operationError: operationError)
        }
    }

    func openOnboardingSystemSettings() async {
        guard canOpenOnboardingSystemSettings else { return }
        await performOnboardingOperation(.service) {
            onboardingAdapter.openSystemSettingsLoginItems()
            reloadOnboardingState()
        }
    }

    func chooseAndEnableProject() async {
        guard canMutateOnboardingProjects else { return }
        await performOnboardingOperation(.project) {
            guard let projectURL = projectFolderChooser.chooseProjectFolder() else { return }
            let operationError: String?
            do {
                try onboardingAdapter.enableProject(at: projectURL.standardizedFileURL.path)
                operationError = nil
            } catch {
                operationError = String(describing: error)
            }
            reloadOnboardingState(operationError: operationError)
        }
    }

    func disableConfiguredProject(_ path: String) async {
        guard canMutateOnboardingProjects,
              configuredProjectPaths.contains(path)
        else { return }
        await performOnboardingOperation(.project) {
            let operationError: String?
            do {
                try onboardingAdapter.disableProject(at: path)
                operationError = nil
            } catch {
                operationError = String(describing: error)
            }
            reloadOnboardingState(operationError: operationError)
        }
    }

    func restoreDefaultShortcutDraft() {
        shortcutDraft = .defaults
        refreshShortcutSettingsValidation()
    }

    func updateShortcutDraft(
        intent: PetShortcutIntent,
        keyCode: UInt32? = nil,
        modifiers: UInt32? = nil
    ) {
        let current = shortcutDraft.shortcut(for: intent)
        shortcutDraft.setShortcut(
            PetShortcut(
                keyCode: keyCode ?? current.keyCode,
                modifiers: modifiers ?? current.modifiers
            ),
            for: intent
        )
        refreshShortcutSettingsValidation()
    }

    func updatePreviewShortcutDraft(_ preset: PetChoicePreviewShortcutPreset) {
        shortcutDraft.previewPreset = preset
        refreshShortcutSettingsValidation()
    }

    func saveShortcutSettings() {
        guard let hotKeyRegistry else {
            shortcutSettingsError = "단축키 등록기가 준비되지 않았습니다."
            return
        }
        if let issue = shortcutDraft.validationIssue() ?? shortcutDraft.previewValidationIssue() {
            shortcutSettingsError = issue.message
            return
        }
        let result = hotKeyRegistry.updateConfiguration(shortcutDraft)
        shortcutConfiguration = hotKeyRegistry.configuration
        switch result {
        case .applied:
            shortcutDraft = hotKeyRegistry.configuration
            shortcutSettingsError = nil
            isEditingShortcuts = false
        case .invalidConfiguration, .registrationRejected, .rollbackFailed:
            shortcutSettingsError = result.errorMessage
        }
        refreshShortcutDiagnostic()
    }

    func shortcutLabel(for intent: PetShortcutIntent) -> String {
        PetShortcutCatalog.displayLabel(for: shortcutConfiguration.shortcut(for: intent))
    }

    func actionShortcutLabel(interaction: PetInteraction, choice: PetChoice) -> String {
        guard choice.enabled, choice.isAction, interaction.isSelectionReady else { return "사용 불가" }
        if requiresRiskConfirmation(interaction: interaction, slot: choice.slot) {
            return "Pet 확인"
        }
        guard let intent = PetShortcutIntent.slot(choice.slot),
              let status = hotKeyRegistry?.statuses[intent]
        else { return "사용 불가" }
        return switch status {
        case .registered:
            shortcutLabel(for: intent)
        case .internalCollision, .systemCollision:
            "충돌"
        case .registrationFailure:
            "등록 실패"
        case .inactive:
            "사용 불가"
        }
    }

    func actionAccessoryPresentation(
        interaction: PetInteraction,
        choice: PetChoice
    ) -> PetActionAccessoryPresentation {
        guard inFlightDismissalIdentity == nil, pendingEventFocus == nil,
              canActOnDisplayedEvent else { return .suppressed }
        guard let submission = selectionSubmission else {
            if provider == .claude && !supportsProviderSessions { return .suppressed }
            return .shortcut(actionShortcutLabel(interaction: interaction, choice: choice))
        }
        guard submission.identity == interaction.identity,
              submission.slot == choice.slot,
              submission.optionID == choice.optionID
        else { return .suppressed }
        return .progress
    }

    func shortcutStatusDescription(for intent: PetShortcutIntent) -> String {
        guard let status = hotKeyRegistry?.statuses[intent] else { return "등록기 준비 중" }
        return switch status {
        case .registered: "등록됨"
        case .inactive:
            intent == .toggle ? "비활성" : "현재 등록 대상 아님"
        case .internalCollision: "설정 내부 충돌"
        case .systemCollision: "macOS 단축키 충돌"
        case .registrationFailure(let status):
            if let status { "등록 실패 (\(status))" } else { "등록 실패" }
        }
    }

    func shortcutDraftStatusDescription(for intent: PetShortcutIntent) -> String {
        guard shortcutDraft.shortcut(for: intent) == shortcutConfiguration.shortcut(for: intent)
        else { return "저장 전" }
        return shortcutStatusDescription(for: intent)
    }

    func shortcutDraftStatusIsProblem(for intent: PetShortcutIntent) -> Bool {
        guard shortcutDraft.shortcut(for: intent) == shortcutConfiguration.shortcut(for: intent)
        else { return false }
        return shortcutStatusIsProblem(for: intent)
    }

    func shortcutStatusIsProblem(for intent: PetShortcutIntent) -> Bool {
        guard let status = hotKeyRegistry?.statuses[intent] else { return false }
        return switch status {
        case .internalCollision, .systemCollision, .registrationFailure: true
        case .registered, .inactive: false
        }
    }

    func startPolling(intervalNanoseconds: UInt64 = 500_000_000) {
        guard pollingTask == nil, !isShuttingDown else { return }
        appService?.startAtAppLaunch()
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                do {
                    let delay = PetServicePollingPolicy.delayNanoseconds(
                        base: intervalNanoseconds,
                        consecutiveFailures: self?.consecutiveSnapshotFailures ?? 0
                    )
                    try await Task.sleep(nanoseconds: delay)
                } catch {
                    return
                }
            }
        }
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
        endChoicePreview()
        choicePreviewHoldMonitor.stop()
        hotKeyRegistry?.reconcilePreviews(eligibleSlots: [])
        setPanelVisible(false)
    }

    func shutdownAppOwnedService() async {
        isShuttingDown = true
        endFirstRunSetup()
        invalidateFocusOperation()
        pendingFocusIdentity = nil
        stopPolling()
        await appService?.shutdown()
    }

    func toggleExpanded() {
        setExpanded(!isExpanded)
    }

    func setExpanded(_ expanded: Bool) {
        guard isExpanded != expanded else { return }
        if !expanded, isEditingShortcuts {
            cancelShortcutSettings()
        }
        if !expanded {
            closeOnboarding()
        }
        isExpanded = expanded
    }

    func handleShortcut(_ intent: PetShortcutIntent) {
        if intent == .toggle {
            requestPanelToggle()
            return
        }
        guard !isFeedbackWindowVisible, let slot = intent.slot else { return }
        guard !choicePreviewHoldMonitor.suppressesSelection,
              let identity = authoritativeSelectionInteraction()?.identity else { return }
        let context = captureProviderActionContext()
        Task { [weak self] in
            guard let self, self.acceptsProviderAction(context),
                  self.authoritativeSelectionInteraction()?.identity == identity else { return }
            await self.handleGlobalSlot(slot)
        }
    }

    func requestPanelToggle() {
        onPanelToggleRequested?()
    }

    func setPanelVisible(_ visible: Bool) {
        guard isPanelVisible != visible else { return }
        isPanelVisible = visible
        reconcileApprovalShortcuts()
        reconcileEventNavigationShortcuts()
        reconcileInsightPresentation()
    }

    private var shortcutApprovalHead: PetApprovalHead? {
        // Approval cards render before settings/onboarding. Keep the draft
        // flags intact while enabling keys for the card actually on screen.
        guard isPanelVisible, !isShuttingDown, !isFeedbackWindowVisible,
              !choicePreviewHoldMonitor.suppressesSelection,
              inFlightPermissionRequestID == nil, inFlightManagedCommandApprovalID == nil,
              canActOnDisplayedEvent,
              let head = approvalHead,
              PetApprovalShortcutIntent.allCases.contains(where: { $0.isAvailable(for: head) })
        else { return nil }
        return head
    }

    func approvalShortcutLabel(number: Int, for head: PetApprovalHead) -> String? {
        guard shortcutApprovalHead == head, let intent = PetApprovalShortcutIntent(rawValue: number)
        else { return nil }
        return approvalShortcutLabels[intent]
    }

    private func handleApprovalShortcut(_ activation: PetApprovalShortcutActivation) async {
        guard shortcutApprovalHead == activation.head,
              hotKeyRegistry?.isCurrentApprovalActivation(activation) == true,
              activation.intent.isAvailable(for: activation.head) else { return }
        switch activation.head {
        case .permission(let request):
            guard let decision = PetPermissionDecision(choiceNumber: activation.intent.rawValue) else { return }
            await resolvePermissionRequest(decision, for: request, inputMethod: .keyboard)
        case .managed(let request):
            let decision: PetManagedCommandApprovalDecision = switch activation.intent {
            case .allowOnce: .acceptOnce
            case .deny: .decline
            case .deferToCodex: .decideInCodex
            }
            await resolveManagedCommandApproval(decision, for: request, inputMethod: .keyboard)
        }
    }

    private func reconcileApprovalShortcuts() {
        hotKeyRegistry?.reconcileApproval(head: shortcutApprovalHead)
        refreshApprovalShortcutPresentation()
    }

    private func refreshApprovalShortcutPresentation() {
        var labels: [PetApprovalShortcutIntent: String] = [:]
        if let head = shortcutApprovalHead {
            for intent in PetApprovalShortcutIntent.allCases {
                labels[intent] = hotKeyRegistry?.approvalShortcutLabel(for: intent, head: head)
            }
        }
        if approvalShortcutLabels != labels { approvalShortcutLabels = labels }
        let diagnostic = shortcutApprovalHead == nil ? nil : hotKeyRegistry?.approvalShortcutDiagnostic
        if approvalShortcutDiagnostic != diagnostic { approvalShortcutDiagnostic = diagnostic }
    }

    func previewShortcutLabel(for slot: Int) -> String {
        shortcutConfiguration.previewPreset.labelPrefix + String(slot)
    }

    var previewHoldKeyName: String { shortcutConfiguration.previewPreset.holdKeyName }
    var isChoicePreviewEnabled: Bool { shortcutConfiguration.previewPreset != .disabled }

    func previewShortcutHint(for slot: Int) -> String {
        guard isChoicePreviewEnabled, hotKeyRegistry?.isPreviewShortcutRegistered(for: slot) == true
        else { return "" }
        return "\(previewShortcutLabel(for: slot))를 누르면 자세히 볼 수 있습니다. \(previewHoldKeyName) 키를 떼면 닫힙니다."
    }

    func beginChoicePreview(slot: Int) {
        let preset = shortcutConfiguration.previewPreset
        guard let interaction = previewableInteraction,
              let choice = interaction.choice(slot: slot), choice.isAction,
              let shortcut = preset.shortcut(for: slot),
              choicePreviewHoldMonitor.begin(keyCode: shortcut.keyCode, preset: preset, onModifierReleased: { [weak self] in
                  self?.endChoicePreview()
              })
        else { return }
        choicePreview = PetChoicePreview(identity: interaction.identity, choice: choice, shortcutPreset: preset)
    }

    func endChoicePreview() {
        if choicePreview != nil { choicePreview = nil }
        choicePreviewHoldMonitor.cancelPreview()
        reconcileEventNavigationShortcuts()
    }

    private var previewableInteraction: PetInteraction? {
        guard !isShuttingDown, !isEditingShortcuts, !isShowingOnboarding, !isFeedbackWindowVisible,
              approvalHead == nil, inFlightPermissionRequestID == nil,
              inFlightManagedCommandApprovalID == nil, selectionSubmission == nil,
              inFlightDismissalIdentity == nil, inFlightSelectionIdentity == nil,
              pendingEventFocus == nil, canActOnDisplayedEvent,
              let interaction = displayInteraction, interaction.isSelectionReady
        else { return nil }
        return interaction
    }

    private func reconcileChoicePreview() {
        let interaction = previewableInteraction
        if previewBindingIdentity != interaction?.identity {
            hotKeyRegistry?.reconcilePreviews(eligibleSlots: [])
            previewBindingIdentity = interaction?.identity
        }
        hotKeyRegistry?.reconcilePreviews(eligibleSlots: Set(interaction?.actionChoices.map(\.slot) ?? []))
        if let preview = choicePreview,
           interaction?.identity != preview.identity
            || interaction?.choice(slot: preview.choice.slot) != preview.choice
            || preview.shortcutPreset != shortcutConfiguration.previewPreset {
            endChoicePreview()
        }
    }

    func acknowledgeApprovalResolutionError() {
        guard persistentApprovalResolutionError != nil else { return }
        persistentApprovalResolutionError = nil
        lastError = nil
        onAttentionChanged?(hasAttention)
    }

    func refresh() async {
        guard !refreshInProgress, !isSwitchingProvider else { return }
        refreshInProgress = true
        defer { refreshInProgress = false }
        await fetchAndApplySnapshot()
    }

    func receiveSnapshotDataForTesting(_ data: Data) throws {
        let parsed = try PetSnapshot.parse(data)
        apply(parsed)
    }

    func applySnapshotForTesting(_ snapshot: PetSnapshot) {
        apply(snapshot)
    }

    private var eventNavigationContextID: String? {
        guard isPanelVisible, canNavigateEvents, let navigation = snapshot?.eventNavigation,
              let target = try? displayedEvent?.focusTarget() else { return nil }
        return String(navigation.revision) + ":" + target.data.base64EncodedString()
    }

    private func reconcileEventNavigationShortcuts() {
        hotKeyRegistry?.reconcileEventNavigation(contextID: eventNavigationContextID)
        let diagnostic = eventNavigationContextID == nil ? nil
            : hotKeyRegistry?.eventNavigationShortcutDiagnostic
        if eventNavigationShortcutDiagnostic != diagnostic {
            eventNavigationShortcutDiagnostic = diagnostic
            onPanelLayoutChanged?()
        }
    }

    func navigateToPreviousEvent() async { await navigateEvent(offset: -1) }
    func navigateToNextEvent() async { await navigateEvent(offset: 1) }

    private func navigateEvent(offset: Int) async {
        guard canNavigateEvents, let position = displayedEventQueuePosition else { return }
        let events = eventQueue
        let index = (position - 1 + offset + events.count) % events.count
        await focusEvent(events[index])
    }

    /// Navigation sends only exact focus authority. No approval, selection,
    /// prompt delivery or dismissal can occur along this path.
    private func focusEvent(_ event: PetQueuedEvent) async {
        guard provider == .codex, snapshot?.eventNavigation != nil, pendingEventFocus == nil,
              pendingFocusIdentity == nil, inFlightDismissalIdentity == nil,
              inFlightSelectionIdentity == nil, inFlightPermissionRequestID == nil,
              inFlightManagedCommandApprovalID == nil, !eventDeliveryPending,
              riskConfirmation == nil, !isShuttingDown,
              let target = try? event.focusTarget(),
              (try? snapshot?.event(reference: target.reference)?.focusTarget()) == target
        else { return }
        let actionContext = captureProviderActionContext()
        if selectedEventReference == nil { selectedEventReference = displayedEvent?.reference }
        pendingEventFocus = target
        endChoicePreview()
        updateHotKeyEligibility()
        lastError = persistentApprovalResolutionError
        defer {
            if acceptsProviderAction(actionContext), pendingEventFocus == target {
                pendingEventFocus = nil
                updateHotKeyEligibility()
            }
        }
        do {
            let response = try await transport.request(type: "focus_event", payload: target.data,
                                                       expectedContext: actionContext.expectedContext)
            guard acceptsProviderAction(actionContext) else { return }
            try PetTransportResponse.requireFocused(response)
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            guard snapshot?.eventNavigation?.focused == target.reference,
                  let current = snapshot?.event(reference: target.reference),
                  try current.focusTarget() == target,
                  !eventDeliveryPending else {
                throw PetModelError.invalid("event_focus_snapshot_authority")
            }
            if case .decision(let interaction) = current {
                guard snapshot?.routing.foreground == interaction.identity, interaction.foreground else {
                    throw PetModelError.invalid("event_focus_snapshot_authority")
                }
                localForegroundIdentity = interaction.identity
                if let application = externalApplicationOpener.captureFrontmostExternalApplication(
                    excludingProcessIdentifier: processIdentifier
                ) { selectionReturnApplication = application }
            } else {
                localForegroundIdentity = nil
            }
            selectedEventReference = target.reference
            confirmedEventFocus = target
            lastTerminalPresentation = nil
            onPanelLayoutChanged?()
            onApprovalHeadChanged?(approvalHead?.identity)
        } catch {
            guard acceptsProviderAction(actionContext) else { return }
            confirmedEventFocus = nil
            localForegroundIdentity = nil
            // Reconcile once after a lost/rejected reply. The old displayed
            // event stays visible; its authority must be acquired again.
            let focusError = String(describing: error)
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            lastError = focusError
        }
    }

    private func reconcileEventSelection(
        previousEvent: PetQueuedEvent?, previousQueue: [PetQueuedEvent]
    ) {
        guard let navigation = snapshot?.eventNavigation else {
            if selectedEventReference != nil { selectedEventReference = nil }
            confirmedEventFocus = nil
            return
        }
        if let reference = selectedEventReference, snapshot?.event(reference: reference) == nil {
            let oldIndex = previousQueue.firstIndex { $0.reference == reference } ?? 0
            selectedEventReference = eventQueue.isEmpty ? nil
                : eventQueue[oldIndex % eventQueue.count].reference
            confirmedEventFocus = nil
        } else if selectedEventReference == nil, navigation.focused == nil, !eventQueue.isEmpty {
            // A removed server focus also occurs after a Pet restart. Never
            // silently turn the fallback preview into action authority.
            let oldIndex = previousQueue.firstIndex { $0.reference == previousEvent?.reference } ?? 0
            selectedEventReference = eventQueue[oldIndex % eventQueue.count].reference
        }
        if let confirmedEventFocus,
           navigation.focused != confirmedEventFocus.reference
            || (try? displayedEvent?.focusTarget()) != confirmedEventFocus {
            self.confirmedEventFocus = nil
        }
        if let riskConfirmation, displayInteraction?.identity != riskConfirmation.identity {
            self.riskConfirmation = nil
        }
    }

    func focus(_ identity: PetInteractionIdentity) async {
        _ = await acquireFocus(identity)
    }

    /// Return success only for this acquisition, never for a later operation
    /// which happens to focus the same card after a disconnect or restart.
    private func acquireFocus(_ identity: PetInteractionIdentity) async -> Bool {
        guard providerAllowsSelection, !isShuttingDown, inFlightDismissalIdentity == nil, pendingEventFocus == nil,
              displayInteraction?.identity == identity else { return false }
        let actionContext = captureProviderActionContext()
        if snapshot?.eventNavigation != nil,
           selectedEventReference != nil || identity != fifoHeadInteraction?.identity {
            guard let event = displayedEvent else { return false }
            await focusEvent(event)
            return acceptsProviderAction(actionContext)
                && focusedInteraction?.identity == identity
        }
        if focusedInteraction?.identity == identity { return true }
        if pendingFocusIdentity == identity {
            guard let operation = activeFocusOperation, operation.identity == identity else { return false }
            let completed = await waitForFocusCompletion(operation)
            return completed && acceptsProviderAction(actionContext)
        }
        guard let interaction = snapshot?.interaction(identity: identity),
              interaction.isSelectionReady,
              pendingFocusIdentity == nil,
              inFlightSelectionIdentity == nil
        else { return false }
        if let previous = activeFocusOperation {
            finishFocusOperation(previous, succeeded: false)
        }
        let operation = FocusOperation(identity: identity, context: actionContext)
        activeFocusOperation = operation
        var succeeded = false
        defer { finishFocusOperation(operation, succeeded: succeeded) }
        if let currentHost = externalApplicationOpener.captureFrontmostExternalApplication(
            excludingProcessIdentifier: processIdentifier
        ) {
            selectionReturnApplication = currentHost
        }
        pendingFocusIdentity = identity
        riskConfirmation = nil
        updateHotKeyEligibility()
        lastError = persistentApprovalResolutionError
        do {
            let response = try await transport.request(
                type: "focus_interaction",
                payload: try PetFocusRequest(identity: identity).data(),
                expectedContext: actionContext.expectedContext
            )
            guard acceptsFocusCompletion(operation) else { return false }
            try PetTransportResponse.requireFocused(response)
            await fetchAndApplySnapshot()
            guard acceptsFocusCompletion(operation) else { return false }
            guard localForegroundIdentity == identity else {
                pendingFocusIdentity = nil
                updateHotKeyEligibility()
                throw PetModelError.invalid("focus_snapshot_authority")
            }
            succeeded = true
        } catch {
            guard acceptsFocusCompletion(operation) else { return false }
            pendingFocusIdentity = nil
            localForegroundIdentity = nil
            riskConfirmation = nil
            lastError = String(describing: error)
            updateHotKeyEligibility()
            await fetchAndApplySnapshot()
        }
        return succeeded && acceptsFocusCompletion(operation)
    }

    func handleGlobalSlot(_ slot: Int) async {
        guard !isFeedbackWindowVisible, !choicePreviewHoldMonitor.suppressesSelection else { return }
        guard let interaction = authoritativeSelectionInteraction(),
              let choice = interaction.choice(slot: slot),
              choice.enabled,
              choice.isAction
        else { return }
        guard !requiresRiskConfirmation(interaction: interaction, slot: slot) else {
            riskConfirmation = PetRiskConfirmation(
                identity: interaction.identity,
                slot: slot,
                optionID: choice.optionID,
                inputMethod: .keyboard
            )
            setExpanded(true)
            updateHotKeyEligibility()
            return
        }
        await submit(interaction: interaction, choice: choice, inputMethod: .keyboard)
    }

    func requestPanelSelection(_ slot: Int) async {
        guard !choicePreviewHoldMonitor.suppressesSelection else { return }
        guard let interaction = authoritativeSelectionInteraction(),
              let choice = interaction.choice(slot: slot),
              choice.enabled,
              choice.isAction
        else { return }
        if requiresRiskConfirmation(interaction: interaction, slot: slot) {
            riskConfirmation = PetRiskConfirmation(
                identity: interaction.identity,
                slot: slot,
                optionID: choice.optionID
            )
            setExpanded(true)
            updateHotKeyEligibility()
            return
        }
        await submit(interaction: interaction, choice: choice)
    }

    func canSkipDecision(_ identity: PetInteractionIdentity) -> Bool {
        guard supportsDecisionDismissal, !isShuttingDown, approvalHead == nil, canActOnDisplayedEvent,
              inFlightPermissionRequestID == nil, inFlightManagedCommandApprovalID == nil,
              selectionSubmission == nil, inFlightSelectionIdentity == nil,
              inFlightDismissalIdentity == nil, pendingFocusIdentity == nil,
              let interaction = displayInteraction,
              interaction.identity == identity, interaction.usesRankedNextActions,
              interaction.isSelectionReady,
              snapshot?.routing.foreground == nil || snapshot?.routing.foreground == identity
        else { return false }
        return true
    }

    func skipDecision(for displayedIdentity: PetInteractionIdentity) async {
        guard canSkipDecision(displayedIdentity) else { return }
        let insightResponse = insightCardKeys[.suggestion(displayedIdentity)].flatMap {
            insightCards?.captureResponse(key: $0, response: .dismissed)
        }
        let actionContext = captureProviderActionContext()
        // Capture the displayed identity before awaiting. Never substitute a new
        // FIFO head when the user clicks a card which has since changed.
        inFlightDismissalIdentity = displayedIdentity
        riskConfirmation = nil
        endChoicePreview()
        updateHotKeyEligibility()
        lastError = persistentApprovalResolutionError
        defer {
            if acceptsProviderAction(actionContext),
               inFlightDismissalIdentity == displayedIdentity {
                inFlightDismissalIdentity = nil
                updateHotKeyEligibility()
            }
        }
        let errorContext = errorDiagnostics?.captureContext()
        var productOperation: PetProductOperation?
        var productFinished = false
        defer {
            if !productFinished { usageAnalytics?.finishFeature(productOperation, outcome: .cancelled) }
        }
        do {
            let request = PetDismissRequest(identity: displayedIdentity)
            let usageOwnerID = account?.usageAuthorization()?.userID
            let usageContext = usageAnalytics?.captureContext()
            let payload = try request.data()
            productOperation = usageAnalytics?.beginFeature(feature: .dismiss, inputMethod: .button)
            let response = try await transport.request(
                type: "dismiss_interaction", payload: payload,
                expectedContext: actionContext.expectedContext
            )
            guard acceptsProviderAction(actionContext) else { return }
            try request.requireDismissed(response)
            usageAnalytics?.finishFeature(productOperation, outcome: .succeeded)
            productFinished = true
            recordAcceptedUsage(.suggestionDismissed, ownerID: usageOwnerID, context: usageContext)
            insightCards?.recordResponse(insightResponse)
            if localForegroundIdentity == displayedIdentity { localForegroundIdentity = nil }
            lastTerminalPresentation = nil
            await fetchAndApplySnapshot()
        } catch {
            guard acceptsProviderAction(actionContext) else { return }
            usageAnalytics?.finishFeature(productOperation, outcome: productFailureOutcome(error))
            productFinished = true
            // A lost response can follow a committed dismissal. Reconcile from
            // the service and require another click; do not silently retry.
            recordDiagnostic(.suggestionDismissFailed, error: error, context: errorContext)
            if localForegroundIdentity == displayedIdentity { localForegroundIdentity = nil }
            let dismissalError = String(describing: error)
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            lastError = dismissalError
        }
    }

    func requestLegacyPause() async {
        guard let interaction = authoritativeSelectionInteraction(),
              let choice = interaction.legacyPauseChoice,
              choice.enabled
        else { return }
        await submit(interaction: interaction, choice: choice)
    }

    func focusAndRequestPanelSelection(
        _ slot: Int,
        interaction identity: PetInteractionIdentity
    ) async {
        guard !choicePreviewHoldMonitor.suppressesSelection else { return }
        guard canActOnDisplayedEvent, pendingEventFocus == nil,
              let interaction = displayInteraction,
              interaction.identity == identity,
              interaction.isSelectionReady,
              let choice = interaction.choice(slot: slot),
              choice.enabled,
              choice.isAction,
              selectionSubmission == nil, inFlightDismissalIdentity == nil
        else { return }
        let submission = PetSelectionSubmission(
            identity: identity,
            slot: slot,
            optionID: choice.optionID
        )
        let actionContext = captureProviderActionContext()
        selectionSubmission = submission
        updateHotKeyEligibility()
        defer {
            if acceptsProviderAction(actionContext),
               selectionSubmission == submission {
                selectionSubmission = nil
                updateHotKeyEligibility()
            }
        }
        if focusedInteraction?.identity != identity {
            guard await acquireFocus(identity) else { return }
        }
        guard acceptsProviderAction(actionContext),
              focusedInteraction?.identity == identity else { return }
        await requestPanelSelection(slot)
    }

    func confirmRiskSelection() async {
        guard let confirmation = riskConfirmation,
              let interaction = authoritativeSelectionInteraction(),
              interaction.identity == confirmation.identity,
              requiresRiskConfirmation(interaction: interaction, slot: confirmation.slot),
              let choice = interaction.choice(slot: confirmation.slot),
              choice.enabled,
              choice.optionID == confirmation.optionID
        else {
            riskConfirmation = nil
            updateHotKeyEligibility()
            return
        }
        riskConfirmation = nil
        await submit(interaction: interaction, choice: choice, inputMethod: confirmation.inputMethod)
    }

    func cancelRiskConfirmation() {
        riskConfirmation = nil
        updateHotKeyEligibility()
    }

    func resolvePermissionRequest(
        _ decision: PetPermissionDecision,
        for displayedRequest: PetPermissionRequest,
        inputMethod: PetProductInputMethod = .button
    ) async {
        guard provider == .codex, canActOnDisplayedEvent, pendingFocusIdentity == nil,
              let request = pendingPermissionRequest,
              request == displayedRequest,
              request.requestID.utf8.elementsEqual(displayedRequest.requestID.utf8),
              decision != .allowOnce || request.allowOnceAvailable,
              !request.deliveryPending,
              inFlightPermissionRequestID == nil,
              inFlightManagedCommandApprovalID == nil
        else { return }
        let insightResponse = insightCardKeys[.approval(.permission(requestID: request.requestID))].flatMap { key in
            decision == .deferToCodex ? nil : insightCards?.captureResponse(
                key: key, response: decision == .allowOnce ? .approved : .denied)
        }
        let actionContext = captureProviderActionContext()
        inFlightPermissionRequestID = request.requestID
        updateHotKeyEligibility()
        defer {
            if acceptsProviderAction(actionContext),
               inFlightPermissionRequestID == request.requestID {
                inFlightPermissionRequestID = nil
                updateHotKeyEligibility()
            }
        }
        lastError = persistentApprovalResolutionError
        let errorContext = errorDiagnostics?.captureContext()
        var productOperation: PetProductOperation?
        var productFinished = false
        defer {
            if !productFinished { usageAnalytics?.finishFeature(productOperation, outcome: .cancelled) }
        }
        do {
            let responseID = permissionResponseIDGenerator()
            let usageOwnerID = account?.usageAuthorization()?.userID
            let usageContext = usageAnalytics?.captureContext()
            let payload = try PetPermissionResolutionRequest(
                request: request, responseID: responseID, decision: decision
            ).data()
            productOperation = usageAnalytics?.beginFeature(feature: .approval, inputMethod: inputMethod)
            let response = try await transport.request(
                type: "resolve_permission_request",
                payload: payload,
                expectedContext: actionContext.expectedContext
            )
            guard acceptsProviderAction(actionContext) else { return }
            try PetTransportResponse.requireResolvedPermission(
                response,
                requestID: request.requestID,
                responseID: responseID,
                expectedDecision: decision
            )
            usageAnalytics?.finishFeature(productOperation, outcome: .succeeded)
            productFinished = true
            recordAcceptedUsage(.approvalResolved, ownerID: usageOwnerID, context: usageContext)
            insightCards?.recordResponse(insightResponse)
            let returnApplication = permissionReturnApplications.removeValue(
                forKey: request.requestID
            )
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            if let returnApplication,
               !externalApplicationOpener.open(returnApplication)
            {
                lastError = "권한 요청 때 감지한 앱을 열 수 없습니다."
            }
        } catch {
            guard acceptsProviderAction(actionContext) else { return }
            usageAnalytics?.finishFeature(productOperation, outcome: productFailureOutcome(error))
            productFinished = true
            recordDiagnostic(.approvalSubmitFailed, error: error, context: errorContext)
            let resolutionError = String(describing: error)
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            persistentApprovalResolutionError = resolutionError
            lastError = resolutionError
            onAttentionChanged?(hasAttention)
            onApprovalResolutionFailed?()
        }
    }

    func resolveManagedCommandApproval(
        _ decision: PetManagedCommandApprovalDecision,
        for displayedRequest: PetManagedCommandApproval,
        inputMethod: PetProductInputMethod = .button
    ) async {
        guard provider == .codex, canActOnDisplayedEvent, pendingFocusIdentity == nil,
              let request = pendingManagedCommandApproval,
              request == displayedRequest,
              request.managedRequestID.utf8.elementsEqual(
                  displayedRequest.managedRequestID.utf8
              ),
              !request.deliveryPending,
              inFlightManagedCommandApprovalID == nil,
              inFlightPermissionRequestID == nil
        else { return }
        if decision == .acceptOnce, !request.allowOnceAvailable { return }
        if decision == .decline, !request.declineAvailable { return }
        let insightResponse = insightCardKeys[.approval(.managed(managedRequestID: request.managedRequestID))].flatMap { key in
            decision == .decideInCodex ? nil : insightCards?.captureResponse(
                key: key, response: decision == .acceptOnce ? .approved : .denied)
        }
        let actionContext = captureProviderActionContext()
        inFlightManagedCommandApprovalID = request.managedRequestID
        updateHotKeyEligibility()
        defer {
            if acceptsProviderAction(actionContext),
               inFlightManagedCommandApprovalID == request.managedRequestID {
                inFlightManagedCommandApprovalID = nil
                updateHotKeyEligibility()
            }
        }
        lastError = persistentApprovalResolutionError
        let errorContext = errorDiagnostics?.captureContext()
        var productOperation: PetProductOperation?
        var productFinished = false
        defer {
            if !productFinished { usageAnalytics?.finishFeature(productOperation, outcome: .cancelled) }
        }
        do {
            let responseID = managedApprovalResponseIDGenerator()
            let usageOwnerID = account?.usageAuthorization()?.userID
            let usageContext = usageAnalytics?.captureContext()
            let payload = try PetManagedCommandApprovalResolutionRequest(
                request: request, responseID: responseID, decision: decision
            ).data()
            productOperation = usageAnalytics?.beginFeature(feature: .approval, inputMethod: inputMethod)
            let response = try await transport.request(
                type: "resolve_managed_command_approval",
                payload: payload,
                expectedContext: actionContext.expectedContext
            )
            guard acceptsProviderAction(actionContext) else { return }
            try requireResolvedManagedCommandApproval(
                response,
                managedRequestID: request.managedRequestID,
                responseID: responseID,
                expectedDecision: decision
            )
            usageAnalytics?.finishFeature(productOperation, outcome: .succeeded)
            productFinished = true
            recordAcceptedUsage(.approvalResolved, ownerID: usageOwnerID, context: usageContext)
            insightCards?.recordResponse(insightResponse)
            let returnApplication = managedApprovalReturnApplications.removeValue(
                forKey: request.managedRequestID
            )
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            if let returnApplication,
               !externalApplicationOpener.open(returnApplication)
            {
                lastError = "관리형 권한 요청 때 감지한 앱을 열 수 없습니다."
            }
        } catch {
            guard acceptsProviderAction(actionContext) else { return }
            usageAnalytics?.finishFeature(productOperation, outcome: productFailureOutcome(error))
            productFinished = true
            recordDiagnostic(.approvalSubmitFailed, error: error, context: errorContext)
            let resolutionError = String(describing: error)
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext) else { return }
            persistentApprovalResolutionError = resolutionError
            lastError = resolutionError
            onAttentionChanged?(hasAttention)
            onApprovalResolutionFailed?()
        }
    }

    private func fetchAndApplySnapshot() async {
        guard !isShuttingDown else { return }
        appService?.checkChildBeforePolling()
        guard appService?.mayQueryCoordinator != false else { return }
        let serviceGeneration = appService?.generation
        let actionContext = captureProviderActionContext()
        nextSnapshotRequest &+= 1
        let requestNumber = nextSnapshotRequest
        let errorContext = errorDiagnostics?.captureContext()
        let productContext = usageAnalytics?.captureContext()
        var receivedResponse = false
        do {
            let payload = try PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
            let data = try await transport.request(type: "get_state", payload: payload, expectedContext: nil)
            guard acceptsProviderAction(actionContext) else { return }
            receivedResponse = true
            let parsed = try await transport.decodeSnapshot(data)
            guard acceptsProviderAction(actionContext),
                  requestNumber >= lastAppliedSnapshotRequest,
                  serviceGeneration.map({ appService?.acceptsSnapshot(generation: $0) == true }) ?? true
            else { return }
            lastAppliedSnapshotRequest = requestNumber
            consecutiveSnapshotFailures = 0
            lastSnapshotDiagnosticContext = nil
            if let serviceGeneration {
                appService?.receivedVerifiedSnapshot(generation: serviceGeneration)
            }
            apply(parsed)
            if coordinatorTransportError != nil { coordinatorTransportError = nil }
            if let productContext {
                if hasVerifiedServiceConnection {
                    usageAnalytics?.observeMilestone(.serviceConnected, context: productContext)
                }
                if parsed.interactions.contains(where: \.isSelectionReady)
                    || !parsed.permissionRequests.isEmpty || !parsed.managedCommandApprovals.isEmpty {
                    usageAnalytics?.observeMilestone(.cardReceived, context: productContext)
                }
            }
            if lastError != persistentApprovalResolutionError {
                lastError = persistentApprovalResolutionError
            }
            await focusFIFOHeadIfNeeded()
        } catch {
            guard acceptsProviderAction(actionContext),
                  requestNumber >= lastAppliedSnapshotRequest,
                  serviceGeneration == appService?.generation else { return }
            lastAppliedSnapshotRequest = requestNumber
            if supportsProviderSessions, provider == .claude {
                // Keep the directory and other providers usable. A scoped
                // read failure does not diagnose the app-owned service.
                invalidateProviderInteractionState()
                providerReadFailed = true
                lastError = String(describing: error)
                updateHotKeyEligibility()
                return
            }
            // A new consent/account context can observe a new failing request
            // during an existing outage, without replaying earlier failures.
            if let errorContext, errorContext != lastSnapshotDiagnosticContext,
               recordDiagnostic(receivedResponse ? .coordinatorResponseInvalid : .coordinatorConnectionFailed,
                                error: error, context: errorContext) {
                lastSnapshotDiagnosticContext = errorContext
            }
            consecutiveSnapshotFailures = min(3, consecutiveSnapshotFailures + 1)
            if let serviceGeneration { appService?.connectionFailed(generation: serviceGeneration) }
            let priorApprovalHeadIdentity = approvalHead?.identity
            invalidateFocusOperation()
            if !connectionReceivedCardProjectPaths.isEmpty {
                connectionReceivedCardProjectPaths = []
            }
            if snapshot != nil { snapshot = nil }
            confirmedEventFocus = nil
            if localForegroundIdentity != nil { localForegroundIdentity = nil }
            if pendingFocusIdentity != nil { pendingFocusIdentity = nil }
            if riskConfirmation != nil { riskConfirmation = nil }
            let message = String(describing: error)
            if coordinatorTransportError != message {
                coordinatorTransportError = message
            }
            if lastError != message { lastError = message }
            updateHotKeyEligibility()
            onAttentionChanged?(hasAttention)
            if priorApprovalHeadIdentity != nil {
                onApprovalHeadChanged?(nil)
            }
        }
    }

    private func apply(_ newSnapshot: PetSnapshot) {
        isApplyingSnapshot = true
        defer {
            isApplyingSnapshot = false
            reconcileInsightPresentation()
        }
        if newSnapshot.providerContext != snapshot?.providerContext {
            invalidateProviderInteractionState()
        }
        if providerReadFailed { providerReadFailed = false }
        if supportsProviderSessions {
            if providerSessions != newSnapshot.providerSessions { providerSessions = newSnapshot.providerSessions }
            if let context = newSnapshot.providerContext, provider != context.provider { provider = context.provider }
        }
        // Keep actual card reception visible after selection consumes the card.
        // This is in-memory observation, not saved sessions or a return receipt.
        // Connection loss/service transitions clear it; removed projects drop out.
        let activePaths = Set(newSnapshot.projects.filter(\.enabled).map(\.cwd))
        let receivedPaths = connectionReceivedCardProjectPaths.intersection(activePaths)
            .union(newSnapshot.interactions.filter(\.isSelectionReady).map(\.cwd))
            .intersection(activePaths)
        if connectionReceivedCardProjectPaths != receivedPaths {
            connectionReceivedCardProjectPaths = receivedPaths
        }
        let priorApprovalHeadIdentity = approvalHead?.identity
        let previousEvent = displayedEvent
        let previousQueue = eventQueue
        let previousActionCount = displayInteraction?.actionChoices.count
        let priorLocalForeground = localForegroundIdentity
        let priorHead = fifoHeadInteraction
        let priorReadyHeadIdentity = priorHead?.isSelectionReady == true
            ? priorHead?.identity
            : nil
        let priorReminderHeadIdentity = priorHead?.isSelectionReady == true
            && priorHead?.reminderDue == true
            ? priorHead?.identity
            : nil
        if snapshot != newSnapshot { snapshot = newSnapshot }
        reconcileEventSelection(previousEvent: previousEvent, previousQueue: previousQueue)
        if previousEvent?.reference != displayedEvent?.reference
            || previousQueue.count != eventQueueCount
            || previousActionCount != displayInteraction?.actionChoices.count {
            onPanelLayoutChanged?()
        }
        if permissionNoticeCount != newSnapshot.permissionNoticeCount {
            permissionNoticeCount = newSnapshot.permissionNoticeCount
        }
        if managedCommandApprovalNoticeCount
            != newSnapshot.managedCommandApprovalNoticeCount
        {
            managedCommandApprovalNoticeCount = newSnapshot
                .managedCommandApprovalNoticeCount
        }
        let activePermissionRequestIDs = Set(
            newSnapshot.permissionRequests.map(\.requestID)
        )
        permissionReturnApplications = permissionReturnApplications.filter {
            activePermissionRequestIDs.contains($0.key)
        }
        let activeManagedApprovalIDs = Set(
            newSnapshot.managedCommandApprovals.map(\.managedRequestID)
        )
        managedApprovalReturnApplications = managedApprovalReturnApplications.filter {
            activeManagedApprovalIDs.contains($0.key)
        }
        let currentApprovalHead = approvalHead
        if currentApprovalHead?.identity != priorApprovalHeadIdentity,
           let currentApprovalHead,
           let application = externalApplicationOpener.captureFrontmostExternalApplication(
               excludingProcessIdentifier: processIdentifier
           )
        {
            switch currentApprovalHead {
            case .permission(let request):
                if permissionReturnApplications[request.requestID] == nil {
                    permissionReturnApplications[request.requestID] = application
                }
            case .managed(let request):
                if managedApprovalReturnApplications[request.managedRequestID] == nil {
                    managedApprovalReturnApplications[request.managedRequestID] = application
                }
            }
        }

        let authoritative = newSnapshot.routing.foreground
        if let localForegroundIdentity,
           authoritative == localForegroundIdentity,
           displayInteraction?.identity == localForegroundIdentity,
           newSnapshot.interaction(identity: localForegroundIdentity) != nil
        {
            // Preserve an exact explicit local identity only while the
            // coordinator continues to expose that immutable identity.
        } else if let pendingFocusIdentity,
                  authoritative == pendingFocusIdentity,
                  displayInteraction?.identity == pendingFocusIdentity,
                  newSnapshot.interaction(identity: pendingFocusIdentity) != nil
        {
            if localForegroundIdentity != pendingFocusIdentity {
                localForegroundIdentity = pendingFocusIdentity
            }
            self.pendingFocusIdentity = nil
            if lastTerminalPresentation != nil { lastTerminalPresentation = nil }
        } else {
            if localForegroundIdentity != nil { localForegroundIdentity = nil }
            if let pendingFocusIdentity,
               newSnapshot.interaction(identity: pendingFocusIdentity) == nil
            {
                invalidateFocusOperation()
                self.pendingFocusIdentity = nil
            }
        }

        if let riskConfirmation,
           newSnapshot.interaction(identity: riskConfirmation.identity)?.choice(
               slot: riskConfirmation.slot
           )?.optionID != riskConfirmation.optionID
        {
            self.riskConfirmation = nil
        }
        if let priorLocalForeground,
           newSnapshot.interaction(identity: priorLocalForeground) == nil
        {
            // Expiry removes the interaction from the authoritative snapshot,
            // so retain a local terminal signal instead of silently falling
            // back to the generic working state.
            if lastTerminalPresentation != .expired {
                lastTerminalPresentation = .expired
            }
        }
        if let autoFocusAttemptedIdentity,
           newSnapshot.interaction(identity: autoFocusAttemptedIdentity) == nil
        {
            self.autoFocusAttemptedIdentity = nil
            autoFocusAttemptToken = nil
        }
        updateHotKeyEligibility()
        onAttentionChanged?(hasAttention)

        let currentHead = newSnapshot.interactions.first
        let currentReadyHeadIdentity = currentHead?.isSelectionReady == true
            ? currentHead?.identity
            : nil
        let receivedNewDecision = currentReadyHeadIdentity != nil
            && currentReadyHeadIdentity != priorReadyHeadIdentity
        let currentReminderHeadIdentity = currentHead?.isSelectionReady == true
            && currentHead?.reminderDue == true
            ? currentHead?.identity
            : nil
        let receivedReminder = currentReminderHeadIdentity != nil
            && currentReminderHeadIdentity != priorReminderHeadIdentity
        if currentApprovalHead?.identity != priorApprovalHeadIdentity {
            onApprovalHeadChanged?(currentApprovalHead?.identity)
        }
        if receivedNewDecision || receivedReminder {
            onAttentionEvent?()
        }
    }

    private func acceptsFocusCompletion(_ operation: FocusOperation) -> Bool {
        activeFocusOperation?.id == operation.id
            && acceptsProviderAction(operation.context)
    }

    private func waitForFocusCompletion(_ operation: FocusOperation) async -> Bool {
        guard acceptsFocusCompletion(operation) else { return false }
        return await withCheckedContinuation { continuation in
            focusWaiters[operation.id, default: []].append(continuation)
        }
    }

    private func finishFocusOperation(_ operation: FocusOperation, succeeded: Bool) {
        guard activeFocusOperation?.id == operation.id else { return }
        activeFocusOperation = nil
        let waiters = focusWaiters.removeValue(forKey: operation.id) ?? []
        for waiter in waiters { waiter.resume(returning: succeeded) }
    }

    private func invalidateFocusOperation() {
        if let operation = activeFocusOperation {
            finishFocusOperation(operation, succeeded: false)
        }
        autoFocusAttemptedIdentity = nil
        autoFocusAttemptToken = nil
    }

    private func focusFIFOHeadIfNeeded() async {
        let actionContext = captureProviderActionContext()
        guard providerAllowsSelection, pendingEventFocus == nil, !automaticallyFocusingEvent, !eventDeliveryPending,
              selectionSubmission == nil || selectedEventReference == nil,
              riskConfirmation == nil,
              inFlightPermissionRequestID == nil, inFlightManagedCommandApprovalID == nil else { return }
        if snapshot?.eventNavigation != nil, let event = displayedEvent,
           selectedEventReference != nil || !canActOnDisplayedEvent {
            guard (try? event.focusTarget()) != confirmedEventFocus else { return }
            automaticallyFocusingEvent = true
            await focusEvent(event)
            if acceptsProviderAction(actionContext) {
                automaticallyFocusingEvent = false
            }
            return
        }
        guard pendingManagedCommandApproval == nil,
              pendingPermissionRequest == nil,
              localForegroundIdentity == nil,
              pendingFocusIdentity == nil,
              inFlightSelectionIdentity == nil, inFlightDismissalIdentity == nil
        else { return }
        guard let head = displayInteraction,
              head.isSelectionReady,
              coordinatorAllowsAutomaticFocus(on: head.identity)
        else { return }
        let identity = head.identity
        guard autoFocusAttemptedIdentity != identity else { return }
        let attemptToken = UUID()
        autoFocusAttemptedIdentity = identity
        autoFocusAttemptToken = attemptToken
        await focus(identity)
        if acceptsProviderAction(actionContext), autoFocusAttemptToken == attemptToken {
            // Keep the marker throughout focus()'s reconciliation fetch so a
            // transient failure cannot recurse or hot-loop. Once the attempt
            // settles, the next poll re-evaluates coordinator authority before
            // retrying this exact FIFO head.
            autoFocusAttemptedIdentity = nil
            autoFocusAttemptToken = nil
        }
    }

    private func coordinatorAllowsAutomaticFocus(
        on identity: PetInteractionIdentity
    ) -> Bool {
        guard let authoritativeForeground = snapshot?.routing.foreground else { return true }
        return authoritativeForeground == identity
    }

    private func authoritativeSelectionInteraction() -> PetInteraction? {
        guard inFlightDismissalIdentity == nil, canActOnDisplayedEvent,
              pendingManagedCommandApproval == nil,
              inFlightManagedCommandApprovalID == nil,
              pendingPermissionRequest == nil,
              inFlightPermissionRequestID == nil,
              let interaction = focusedInteraction,
              displayInteraction?.identity == interaction.identity,
              interaction.isSelectionReady,
              snapshot?.routing.foreground == interaction.identity,
              pendingFocusIdentity == nil
        else { return nil }
        return interaction
    }

    private func submit(
        interaction: PetInteraction, choice: PetChoice, inputMethod: PetProductInputMethod = .button
    ) async {
        guard !choicePreviewHoldMonitor.suppressesSelection else { return }
        guard let current = authoritativeSelectionInteraction(),
              current.identity == interaction.identity,
              current.choice(slot: choice.slot)?.optionID == choice.optionID,
              choice.enabled
        else { return }
        let key = current.identity
        guard inFlightSelectionIdentity == nil else { return }
        let submission = PetSelectionSubmission(
            identity: current.identity,
            slot: choice.slot,
            optionID: choice.optionID
        )
        guard selectionSubmission == nil || selectionSubmission == submission else { return }
        let insightResponse = insightCardKeys[.suggestion(current.identity)].flatMap {
            insightCards?.captureResponse(key: $0, response: .selected)
        }
        let actionContext = captureProviderActionContext()
        if selectionSubmission == nil { selectionSubmission = submission }
        inFlightSelectionIdentity = key
        updateHotKeyEligibility()
        defer {
            if acceptsProviderAction(actionContext),
               selectionSubmission == submission {
                selectionSubmission = nil
                updateHotKeyEligibility()
            }
        }
        lastError = persistentApprovalResolutionError
        let errorContext = errorDiagnostics?.captureContext()
        var productOperation: PetProductOperation?
        var productFinished = false
        defer {
            if !productFinished { usageAnalytics?.finishFeature(productOperation, outcome: .cancelled) }
        }
        do {
            let request = try PetSelectionRequest(
                identity: current.identity,
                selectionID: provider == .claude ? UUID().uuidString.lowercased() : selectionIDGenerator(),
                optionID: choice.optionID
            )
            let usageOwnerID = account?.usageAuthorization()?.userID
            let usageContext = usageAnalytics?.captureContext()
            let payload = try request.data()
            productOperation = usageAnalytics?.beginFeature(feature: .choice, inputMethod: inputMethod)
            let response = try await transport.request(type: "select", payload: payload,
                                                       expectedContext: actionContext.expectedContext)
            guard acceptsProviderAction(actionContext) else { return }
            let outcome = try await transport.selectionOutcome(response, request: request,
                                                               expectedContext: actionContext.expectedContext)
            guard acceptsProviderAction(actionContext) else { return }
            usageAnalytics?.finishFeature(productOperation, outcome: .succeeded)
            productFinished = true
            recordAcceptedUsage(.choiceAccepted, ownerID: usageOwnerID, context: usageContext)
            insightCards?.recordResponse(insightResponse)
            if inFlightSelectionIdentity == key { inFlightSelectionIdentity = nil }
            localForegroundIdentity = nil
            pendingFocusIdentity = nil
            riskConfirmation = nil
            lastTerminalPresentation = outcome == .pause ? .paused : nil
            updateHotKeyEligibility()
            if let selectionReturnApplication {
                _ = externalApplicationOpener.open(selectionReturnApplication)
            }
            await fetchAndApplySnapshot()
        } catch {
            guard acceptsProviderAction(actionContext) else { return }
            usageAnalytics?.finishFeature(productOperation, outcome: productFailureOutcome(error))
            productFinished = true
            recordDiagnostic(.choiceSubmitFailed, error: error, context: errorContext)
            if inFlightSelectionIdentity == key { inFlightSelectionIdentity = nil }
            // A transport or response failure can mean the coordinator committed
            // the immutable selection but the response was lost. Drop local
            // authority before refreshing so a new selection_id cannot be sent
            // against an ambiguous card without another explicit focus action.
            localForegroundIdentity = nil
            pendingFocusIdentity = nil
            riskConfirmation = nil
            lastError = String(describing: error)
            updateHotKeyEligibility()
            await fetchAndApplySnapshot()
        }
    }

    private func productFailureOutcome(_ error: any Error) -> PetProductOutcome {
        Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled
            ? .cancelled : .failed
    }

    @discardableResult
    private func recordDiagnostic(_ code: PetErrorCode, error: any Error, context: PetErrorContext?) -> Bool {
        guard !isShuttingDown, !Task.isCancelled, !(error is CancellationError),
              (error as? URLError)?.code != .cancelled, let context else { return false }
        errorDiagnostics?.record(code: code, context: context)
        return true
    }

    private func recordAcceptedUsage(
        _ kind: PetUsageEventKind, ownerID: String?, context: PetUsageContext?
    ) {
        // A user can sign out or switch accounts while an action is awaiting its
        // response. Never attribute that earlier action to the new account.
        guard !isShuttingDown, ownerID == account?.usageAuthorization()?.userID else { return }
        if let context {
            usageAnalytics?.record(kind, context: context)
            usageAnalytics?.observeMilestone(.firstAction, context: context)
        }
        onUsageAccepted?(kind)
    }

    private func updateHotKeyEligibility() {
        reconcileEventNavigationShortcuts()
        reconcileChoicePreview()
        reconcileApprovalShortcuts()
        guard !isFeedbackWindowVisible, pendingManagedCommandApproval == nil,
              inFlightManagedCommandApprovalID == nil,
              pendingPermissionRequest == nil,
              inFlightPermissionRequestID == nil,
              selectionSubmission == nil,
              let interaction = authoritativeSelectionInteraction(),
              inFlightSelectionIdentity == nil
        else {
            hotKeyRegistry?.reconcile(eligibleSlots: [])
            refreshShortcutDiagnostic()
            return
        }
        let slots = Set<Int>(interaction.choices.compactMap { choice -> Int? in
            guard choice.enabled,
                  choice.isAction,
                  !requiresRiskConfirmation(interaction: interaction, slot: choice.slot)
            else { return nil }
            return choice.slot
        })
        hotKeyRegistry?.reconcile(eligibleSlots: slots)
        refreshShortcutDiagnostic()
    }

    private func refreshShortcutDiagnostic() {
        guard let statuses = hotKeyRegistry?.statuses else {
            setShortcutDiagnosticIfChanged(nil)
            return
        }
        let internalCollisions = statuses.compactMap { intent, status in
            status == .internalCollision ? intent.displayName : nil
        }.sorted()
        let systemCollisions = statuses.compactMap { intent, status in
            status == .systemCollision ? intent.displayName : nil
        }.sorted()
        let registrationFailures = statuses.compactMap { intent, status -> String? in
            guard case .registrationFailure(let osStatus) = status else { return nil }
            if let osStatus { return "\(intent.displayName)(\(osStatus))" }
            return intent.displayName
        }.sorted()
        if !internalCollisions.isEmpty {
            setShortcutDiagnosticIfChanged(
                "단축키 설정 충돌: " + internalCollisions.joined(separator: ", ")
            )
        } else if !systemCollisions.isEmpty {
            setShortcutDiagnosticIfChanged(
                "macOS 단축키 등록 충돌: " + systemCollisions.joined(separator: ", ")
            )
        } else if !registrationFailures.isEmpty {
            setShortcutDiagnosticIfChanged(
                "단축키 등록 실패: " + registrationFailures.joined(separator: ", ")
            )
        } else {
            setShortcutDiagnosticIfChanged(hotKeyRegistry?.previewShortcutDiagnostic)
        }
    }

    private func setShortcutDiagnosticIfChanged(_ diagnostic: String?) {
        if shortcutDiagnostic != diagnostic {
            shortcutDiagnostic = diagnostic
        }
    }

    private func refreshShortcutSettingsValidation() {
        shortcutSettingsError = (shortcutDraft.validationIssue() ?? shortcutDraft.previewValidationIssue())?.message
    }

    private func performOnboardingOperation(
        _ domain: OnboardingOperationDomain,
        operation: () async -> Void
    ) async {
        guard !isOnboardingOperationInFlight(domain) else { return }
        if domain == .codexPlugin { invalidateHookReadiness() }
        if domain == .service || domain == .project { cancelStorageRecovery() }
        setOnboardingOperationInFlight(true, domain: domain)
        defer { finishOnboardingOperation(domain) }
        await operation()
        if domain == .codexPlugin {
            await drainCodexPluginRefreshRequests()
        }
    }

    private func isOnboardingOperationInFlight(
        _ domain: OnboardingOperationDomain
    ) -> Bool {
        switch domain {
        case .service, .project:
            isOnboardingConfigurationOperationInFlight
        case .codexPlugin:
            isCodexPluginOperationInFlight
        case .legacyShell:
            isLegacyShellCleanupOperationInFlight
        }
    }

    private func setOnboardingOperationInFlight(
        _ inFlight: Bool,
        domain: OnboardingOperationDomain
    ) {
        switch domain {
        case .service:
            isOnboardingServiceOperationInFlight = inFlight
        case .codexPlugin:
            isCodexPluginOperationInFlight = inFlight
        case .project:
            isOnboardingProjectOperationInFlight = inFlight
        case .legacyShell:
            isLegacyShellCleanupOperationInFlight = inFlight
        }
    }

    private func finishOnboardingOperation(_ domain: OnboardingOperationDomain) {
        setOnboardingOperationInFlight(false, domain: domain)

        switch domain {
        case .codexPlugin, .legacyShell:
            break
        case .service, .project:
            guard onboardingRefreshRequested,
                  !isOnboardingServiceOperationInFlight,
                  !isOnboardingProjectOperationInFlight
            else { return }
            // Every configuration mutation performs a final authoritative reload.
            // Treat refresh clicks received during that mutation as coalesced into
            // that reload so a successful read cannot erase the mutation error.
            onboardingRefreshRequested = false
        }
    }

    private func drainCodexPluginRefreshRequests() async {
        while codexPluginRefreshRequested {
            codexPluginRefreshRequested = false
            codexPluginSetupState = await codexPluginSetupManager.inspect()
            clearLegacyCodexPluginMigrationConfirmation()
        }
    }

    private func reloadOnboardingState(operationError: String? = nil) {
        let previousHookProject = hookReadinessProjectPath
        defer {
            if previousHookProject != hookReadinessProjectPath { invalidateHookReadiness() }
        }
        onboardingServiceState = onboardingAdapter.serviceRegistrationState()
        applySuggestionModeLoadResult(suggestionModeStore.load())
        do {
            configuredProjectPaths = try onboardingAdapter.configuredProjectPaths()
            configuredProjectPathsAreAuthoritative = true
            onboardingError = operationError
        } catch {
            configuredProjectPaths = []
            configuredProjectPathsAreAuthoritative = false
            let refreshError = String(describing: error)
            if let operationError {
                onboardingError = operationError + "\n상태 새로고침 실패: " + refreshError
            } else {
                onboardingError = refreshError
            }
        }
    }

    private func applySuggestionModeLoadResult(_ result: BlabeeSuggestionModeLoadResult) {
        suggestionMode = result.mode
        suggestionModeDiagnostic = result.diagnostic
    }

    private func requiresRiskConfirmation(
        interaction: PetInteraction,
        slot: Int
    ) -> Bool {
        interaction.choice(slot: slot)?.isAction == true
            && interaction.risk.level.requiresPanelConfirmation
    }
}

private func requireResolvedManagedCommandApproval(
    _ data: Data,
    managedRequestID: String,
    responseID: String,
    expectedDecision: PetManagedCommandApprovalDecision
) throws {
    let object = try StrictJSONTransport.object(from: data)
    guard Set(object.keys) == [
        "resolved", "managed_request_id", "response_id", "decision",
    ],
          petStrictBooleanValue(object["resolved"]) == true,
          object["managed_request_id"] as? String == managedRequestID,
          object["response_id"] as? String == responseID,
          object["decision"] as? String == expectedDecision.rawValue
    else { throw PetModelError.invalid("managed_command_approval_resolution_response") }
}

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
    private enum OnboardingOperationDomain {
        case service
        case codexPlugin
        case project
        case legacyShell
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
    @Published private(set) var localForegroundIdentity: PetInteractionIdentity?
    @Published private(set) var pendingFocusIdentity: PetInteractionIdentity?
    @Published private(set) var selectionSubmission: PetSelectionSubmission?
    @Published private(set) var riskConfirmation: PetRiskConfirmation?
    @Published private(set) var choicePreview: PetChoicePreview? {
        didSet {
            guard oldValue != choicePreview else { return }
            onPanelLayoutChanged?()
            onChoicePreviewChanged?(choicePreview != nil)
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
    @Published private(set) var isEditingShortcuts = false {
        didSet {
            if oldValue != isEditingShortcuts { onPanelLayoutChanged?() }
            reconcileChoicePreview()
            reconcileApprovalShortcuts()
        }
    }
    @Published private(set) var shortcutSettingsError: String?
    @Published private(set) var isShowingOnboarding = false {
        didSet {
            if oldValue != isShowingOnboarding { onPanelLayoutChanged?() }
            reconcileChoicePreview()
            reconcileApprovalShortcuts()
        }
    }
    @Published private(set) var onboardingServiceState: PetServiceRegistrationState = .unknown
    @Published private(set) var appOwnedServiceState: PetAppServiceState = .disabled
    @Published private(set) var isAppOwnedServiceEnabled = false
    @Published private(set) var codexPluginSetupState: CodexPluginSetupState = .unchecked
    @Published private(set) var codexNativeRecheckReport: CodexPluginRecheckReport?
    @Published private(set) var configuredProjectPaths: [String] = []
    @Published private(set) var configuredProjectPathsAreAuthoritative = false
    @Published private(set) var onboardingError: String?
    @Published private(set) var appUpdateState: PetAppUpdateState = .notChecked
    @Published private(set) var appUpdateSettingsRequestID = UUID()
    @Published private(set) var coordinatorTransportError: String?
    @Published private(set) var connectionReceivedCardProjectPaths: Set<String> = []
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
    private var focusWaiters: [PetInteractionIdentity: [CheckedContinuation<Void, Never>]] = [:]
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
    private var persistentApprovalResolutionError: String?

    var onPanelLayoutChanged: (() -> Void)?
    var onPanelToggleRequested: (() -> Void)?
    var onChoicePreviewChanged: ((Bool) -> Void)?
    var onAttentionChanged: ((Bool) -> Void)?
    var onAttentionEvent: (() -> Void)?
    var onApprovalHeadChanged: ((PetApprovalHeadIdentity?) -> Void)?
    var onApprovalResolutionFailed: (() -> Void)?

    init(
        transport: any PetCoordinatorTransport,
        externalApplicationOpener: any PetExternalApplicationOpening,
        onboardingAdapter: any PetOnboardingAdapting = PetUnavailableOnboardingAdapter(),
        appService: PetAppServiceController? = nil,
        codexPluginSetupManager: any CodexPluginSetupManaging = CodexUnavailablePluginSetupManager(),
        legacyShellCleanupManager: any LegacyCodexShellCleanupManaging = LegacyUnavailableCodexShellCleanupManager(),
        suggestionModeStore: any BlabeeSuggestionModeStoring = BlabeeSuggestionModeStore(),
        projectFolderChooser: any PetProjectFolderChoosing = PetUnavailableProjectFolderChooser(),
        appUpdateChecker: any PetAppUpdateChecking = PetGitHubAppUpdateChecker(
            currentVersion: nil, repository: nil
        ),
        appUpdateURLOpener: @escaping @MainActor (URL) -> Bool = { NSWorkspace.shared.open($0) },
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
        self.externalApplicationOpener = externalApplicationOpener
        self.onboardingAdapter = onboardingAdapter
        self.appService = appService
        self.codexPluginSetupManager = codexPluginSetupManager
        self.legacyShellCleanupManager = legacyShellCleanupManager
        self.suggestionModeStore = suggestionModeStore
        self.projectFolderChooser = projectFolderChooser
        self.appUpdateChecker = appUpdateChecker
        self.appUpdateURLOpener = appUpdateURLOpener
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
              fifoHeadInteraction?.identity == localForegroundIdentity,
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

    var displayInteraction: PetInteraction? {
        return fifoHeadInteraction
    }

    var approvalHead: PetApprovalHead? {
        guard let snapshot else { return nil }
        return PetApprovalHead.first(
            permissionRequests: snapshot.permissionRequests,
            managedCommandApprovals: snapshot.managedCommandApprovals
        )
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
        hasNewPermissionNotice ? nil : shortcutDiagnostic
    }

    var hasVisibleStatusMessage: Bool {
        lastError != nil || visibleShortcutDiagnostic != nil
    }

    var hasPersistentApprovalResolutionError: Bool {
        persistentApprovalResolutionError != nil
    }

    var hasAttention: Bool {
        hasNewPermissionNotice
            || fifoHeadInteraction?.isSelectionReady == true
            || hasPersistentApprovalResolutionError
    }

    var presentationState: PetPresentationState {
        if snapshot == nil {
            return lastError == nil ? .disconnected : .malformed
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
        if isAppOwnedServiceEnabled, appOwnedServiceState != .ready {
            return appOwnedServiceState.title
        }
        return presentationState.displayTitle
    }

    var emptyStateDescription: String {
        if isAppOwnedServiceEnabled, appOwnedServiceState != .ready {
            return appOwnedServiceState.detail
        }
        return snapshot == nil
            ? "설정에서 서비스 연결 상태를 확인해 주세요."
            : "유효한 결정 카드가 생기면 여기에 표시됩니다."
    }

    var isAppOwnedServiceAvailable: Bool { appService != nil }

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
            snapshot = nil
            localForegroundIdentity = nil
            pendingFocusIdentity = nil
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

    var activeProjectPaths: Set<String> {
        Set(snapshot?.projects.filter(\.enabled).map(\.cwd) ?? [])
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
        let serviceIssueRequiresAction = isAppOwnedServiceEnabled && appOwnedServiceState == .blocked
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
            receivedCardProjectPaths: connected ? connectionReceivedCardProjectPaths : []
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
        snapshot != nil && coordinatorTransportError == nil
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
    }

    private var isOnboardingConfigurationOperationInFlight: Bool {
        isOnboardingServiceOperationInFlight || isOnboardingProjectOperationInFlight
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
        guard !isCodexPluginOperationInFlight else { return false }
        return switch codexPluginSetupState {
        case .unchecked, .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable: true
        case .unavailable, .installedNeedsHookReview, .legacyInstallationDetected, .conflict, .error: false
        }
    }

    var canDisconnectCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight else { return false }
        return switch codexPluginSetupState {
        case .marketplaceInstalledNeedsPlugin, .installedNeedsHookReview, .updateAvailable: true
        case .unchecked, .unavailable, .notInstalled, .legacyInstallationDetected, .conflict, .error: false
        }
    }

    var canMigrateLegacyCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight else { return false }
        return switch codexPluginSetupState {
        case .legacyInstallationDetected: true
        case .unchecked, .unavailable, .notInstalled, .marketplaceInstalledNeedsPlugin,
             .installedNeedsHookReview, .updateAvailable, .conflict, .error: false
        }
    }

    func attachHotKeyRegistry(_ registry: PetHotKeyRegistry) {
        endChoicePreview()
        hotKeyRegistry?.onPreviewRequested = nil
        hotKeyRegistry?.reconcilePreviews(eligibleSlots: [])
        hotKeyRegistry?.onApprovalRequested = nil
        hotKeyRegistry?.onApprovalShortcutAvailabilityChanged = nil
        hotKeyRegistry?.reconcileApproval(head: nil)
        hotKeyRegistry = registry
        registry.onPreviewRequested = { [weak self] slot in self?.beginChoicePreview(slot: slot) }
        registry.onApprovalRequested = { [weak self] activation in
            // The event carries the displayed request captured by Carbon,
            // rather than looking up a possibly newer FIFO head in this Task.
            Task { [weak self] in await self?.handleApprovalShortcut(activation) }
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

    func toggleShortcutSettings() {
        if isEditingShortcuts {
            cancelShortcutSettings()
        } else {
            beginShortcutSettings()
        }
    }

    func beginShortcutSettings() {
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        isShowingOnboarding = false
        shortcutDraft = shortcutConfiguration
        shortcutSettingsError = nil
        isEditingShortcuts = true
        setExpanded(true)
    }

    func cancelShortcutSettings() {
        shortcutDraft = shortcutConfiguration
        shortcutSettingsError = nil
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
        cancelShortcutSettings()
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        isShowingOnboarding = true
        setExpanded(true)
        await refreshOnboarding()
    }

    func closeOnboarding() {
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
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
        isShowingOnboarding = true
        setExpanded(true)
        appUpdateSettingsRequestID = UUID()
        refreshLocalOnboardingState()
    }

    func checkForAppUpdates() async {
        guard !isCheckingForAppUpdate else { return }
        appUpdateState = .checking
        let result = await appUpdateChecker.checkForUpdates()
        appUpdateState = Task.isCancelled ? .notChecked : result
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
        guard isShowingOnboarding, !isLegacyShellCleanupOperationInFlight,
              legacyShellCleanupInspection?.canPrepare == true
        else { return }
        cancelLegacyShellCleanup()
        let generation = legacyShellConfirmationGeneration
        await performOnboardingOperation(.legacyShell) {
            let confirmation = await legacyShellCleanupManager.prepare()
            guard generation == legacyShellConfirmationGeneration, isShowingOnboarding else { return }
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
        guard isShowingOnboarding, !isLegacyShellCleanupOperationInFlight,
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

    func refreshCodexPluginSetup() async {
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
        guard !isCodexPluginOperationInFlight else { return }
        await performOnboardingOperation(.codexPlugin) {
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
        guard let submission = selectionSubmission else {
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
        guard let slot = intent.slot else { return }
        guard !choicePreviewHoldMonitor.suppressesSelection else { return }
        Task { [weak self] in
            await self?.handleGlobalSlot(slot)
        }
    }

    func requestPanelToggle() {
        onPanelToggleRequested?()
    }

    func setPanelVisible(_ visible: Bool) {
        guard isPanelVisible != visible else { return }
        isPanelVisible = visible
        reconcileApprovalShortcuts()
    }

    private var shortcutApprovalHead: PetApprovalHead? {
        // Approval cards render before settings/onboarding. Keep the draft
        // flags intact while enabling keys for the card actually on screen.
        guard isPanelVisible, !isShuttingDown,
              !choicePreviewHoldMonitor.suppressesSelection,
              inFlightPermissionRequestID == nil, inFlightManagedCommandApprovalID == nil,
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
            await resolvePermissionRequest(decision, for: request)
        case .managed(let request):
            let decision: PetManagedCommandApprovalDecision = switch activation.intent {
            case .allowOnce: .acceptOnce
            case .deny: .decline
            case .deferToCodex: .decideInCodex
            }
            await resolveManagedCommandApproval(decision, for: request)
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
    }

    private var previewableInteraction: PetInteraction? {
        guard !isShuttingDown, !isEditingShortcuts, !isShowingOnboarding,
              approvalHead == nil, inFlightPermissionRequestID == nil,
              inFlightManagedCommandApprovalID == nil, selectionSubmission == nil,
              inFlightSelectionIdentity == nil,
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
        guard !refreshInProgress else { return }
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

    func focus(_ identity: PetInteractionIdentity) async {
        guard fifoHeadInteraction?.identity == identity else { return }
        if focusedInteraction?.identity == identity { return }
        if pendingFocusIdentity == identity {
            await waitForFocusCompletion(identity)
            return
        }
        guard let interaction = snapshot?.interaction(identity: identity),
              interaction.isSelectionReady,
              pendingFocusIdentity == nil,
              inFlightSelectionIdentity == nil
        else { return }
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
                payload: try PetFocusRequest(identity: identity).data()
            )
            try PetTransportResponse.requireFocused(response)
            await fetchAndApplySnapshot()
            guard localForegroundIdentity == identity else {
                pendingFocusIdentity = nil
                updateHotKeyEligibility()
                throw PetModelError.invalid("focus_snapshot_authority")
            }
        } catch {
            pendingFocusIdentity = nil
            localForegroundIdentity = nil
            riskConfirmation = nil
            lastError = String(describing: error)
            updateHotKeyEligibility()
            await fetchAndApplySnapshot()
        }
        resumeFocusWaiters(identity)
    }

    func handleGlobalSlot(_ slot: Int) async {
        guard !choicePreviewHoldMonitor.suppressesSelection else { return }
        guard let interaction = authoritativeSelectionInteraction(),
              let choice = interaction.choice(slot: slot),
              choice.enabled,
              choice.isAction
        else { return }
        guard !requiresRiskConfirmation(interaction: interaction, slot: slot) else {
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
        guard let interaction = fifoHeadInteraction,
              interaction.identity == identity,
              interaction.isSelectionReady,
              let choice = interaction.choice(slot: slot),
              choice.enabled,
              choice.isAction,
              selectionSubmission == nil
        else { return }
        let submission = PetSelectionSubmission(
            identity: identity,
            slot: slot,
            optionID: choice.optionID
        )
        selectionSubmission = submission
        updateHotKeyEligibility()
        defer {
            if selectionSubmission == submission {
                selectionSubmission = nil
                updateHotKeyEligibility()
            }
        }
        if focusedInteraction?.identity != identity {
            await focus(identity)
        }
        guard focusedInteraction?.identity == identity else { return }
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
        await submit(interaction: interaction, choice: choice)
    }

    func cancelRiskConfirmation() {
        riskConfirmation = nil
        updateHotKeyEligibility()
    }

    func resolvePermissionRequest(
        _ decision: PetPermissionDecision,
        for displayedRequest: PetPermissionRequest
    ) async {
        guard let request = pendingPermissionRequest,
              request == displayedRequest,
              request.requestID.utf8.elementsEqual(displayedRequest.requestID.utf8),
              decision != .allowOnce || request.allowOnceAvailable,
              !request.deliveryPending,
              inFlightPermissionRequestID == nil,
              inFlightManagedCommandApprovalID == nil
        else { return }
        inFlightPermissionRequestID = request.requestID
        updateHotKeyEligibility()
        lastError = persistentApprovalResolutionError
        do {
            let responseID = permissionResponseIDGenerator()
            let response = try await transport.request(
                type: "resolve_permission_request",
                payload: try PetPermissionResolutionRequest(
                    request: request,
                    responseID: responseID,
                    decision: decision
                ).data()
            )
            try PetTransportResponse.requireResolvedPermission(
                response,
                requestID: request.requestID,
                responseID: responseID,
                expectedDecision: decision
            )
            let returnApplication = permissionReturnApplications.removeValue(
                forKey: request.requestID
            )
            await fetchAndApplySnapshot()
            if let returnApplication,
               !externalApplicationOpener.open(returnApplication)
            {
                lastError = "권한 요청 때 감지한 앱을 열 수 없습니다."
            }
        } catch {
            let resolutionError = String(describing: error)
            await fetchAndApplySnapshot()
            persistentApprovalResolutionError = resolutionError
            lastError = resolutionError
            onAttentionChanged?(hasAttention)
            onApprovalResolutionFailed?()
        }
        inFlightPermissionRequestID = nil
        updateHotKeyEligibility()
    }

    func resolveManagedCommandApproval(
        _ decision: PetManagedCommandApprovalDecision,
        for displayedRequest: PetManagedCommandApproval
    ) async {
        guard let request = pendingManagedCommandApproval,
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
        inFlightManagedCommandApprovalID = request.managedRequestID
        updateHotKeyEligibility()
        lastError = persistentApprovalResolutionError
        do {
            let responseID = managedApprovalResponseIDGenerator()
            let response = try await transport.request(
                type: "resolve_managed_command_approval",
                payload: try PetManagedCommandApprovalResolutionRequest(
                    request: request,
                    responseID: responseID,
                    decision: decision
                ).data()
            )
            try requireResolvedManagedCommandApproval(
                response,
                managedRequestID: request.managedRequestID,
                responseID: responseID,
                expectedDecision: decision
            )
            let returnApplication = managedApprovalReturnApplications.removeValue(
                forKey: request.managedRequestID
            )
            await fetchAndApplySnapshot()
            if let returnApplication,
               !externalApplicationOpener.open(returnApplication)
            {
                lastError = "관리형 권한 요청 때 감지한 앱을 열 수 없습니다."
            }
        } catch {
            let resolutionError = String(describing: error)
            await fetchAndApplySnapshot()
            persistentApprovalResolutionError = resolutionError
            lastError = resolutionError
            onAttentionChanged?(hasAttention)
            onApprovalResolutionFailed?()
        }
        inFlightManagedCommandApprovalID = nil
        updateHotKeyEligibility()
    }

    private func fetchAndApplySnapshot() async {
        guard !isShuttingDown else { return }
        appService?.checkChildBeforePolling()
        guard appService?.mayQueryCoordinator != false else { return }
        let serviceGeneration = appService?.generation
        nextSnapshotRequest &+= 1
        let requestNumber = nextSnapshotRequest
        do {
            let payload = try PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
            let data = try await transport.request(type: "get_state", payload: payload)
            let parsed = try await Task.detached(priority: .utility) {
                try PetSnapshot.parse(data)
            }.value
            guard !isShuttingDown,
                  requestNumber >= lastAppliedSnapshotRequest,
                  serviceGeneration.map({ appService?.acceptsSnapshot(generation: $0) == true }) ?? true
            else { return }
            lastAppliedSnapshotRequest = requestNumber
            consecutiveSnapshotFailures = 0
            if let serviceGeneration {
                appService?.receivedVerifiedSnapshot(generation: serviceGeneration)
            }
            apply(parsed)
            if coordinatorTransportError != nil { coordinatorTransportError = nil }
            if lastError != persistentApprovalResolutionError {
                lastError = persistentApprovalResolutionError
            }
            await focusFIFOHeadIfNeeded()
        } catch {
            guard !isShuttingDown,
                  requestNumber >= lastAppliedSnapshotRequest,
                  serviceGeneration == appService?.generation else { return }
            lastAppliedSnapshotRequest = requestNumber
            consecutiveSnapshotFailures = min(3, consecutiveSnapshotFailures + 1)
            if let serviceGeneration { appService?.connectionFailed(generation: serviceGeneration) }
            let priorApprovalHeadIdentity = approvalHead?.identity
            if !connectionReceivedCardProjectPaths.isEmpty {
                connectionReceivedCardProjectPaths = []
            }
            if snapshot != nil { snapshot = nil }
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
           newSnapshot.interactions.first?.identity == localForegroundIdentity,
           newSnapshot.interaction(identity: localForegroundIdentity) != nil
        {
            // Preserve an exact explicit local identity only while the
            // coordinator continues to expose that immutable identity.
        } else if let pendingFocusIdentity,
                  authoritative == pendingFocusIdentity,
                  newSnapshot.interactions.first?.identity == pendingFocusIdentity,
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

    private func waitForFocusCompletion(_ identity: PetInteractionIdentity) async {
        await withCheckedContinuation { continuation in
            focusWaiters[identity, default: []].append(continuation)
        }
    }

    private func resumeFocusWaiters(_ identity: PetInteractionIdentity) {
        let waiters = focusWaiters.removeValue(forKey: identity) ?? []
        for waiter in waiters { waiter.resume() }
    }

    private func focusFIFOHeadIfNeeded() async {
        guard pendingManagedCommandApproval == nil,
              pendingPermissionRequest == nil,
              localForegroundIdentity == nil,
              pendingFocusIdentity == nil,
              inFlightSelectionIdentity == nil
        else { return }
        guard let head = fifoHeadInteraction,
              head.isSelectionReady,
              coordinatorAllowsAutomaticFocus(on: head.identity)
        else { return }
        let identity = head.identity
        guard autoFocusAttemptedIdentity != identity else { return }
        autoFocusAttemptedIdentity = identity
        await focus(identity)
        if autoFocusAttemptedIdentity == identity {
            // Keep the marker throughout focus()'s reconciliation fetch so a
            // transient failure cannot recurse or hot-loop. Once the attempt
            // settles, the next poll re-evaluates coordinator authority before
            // retrying this exact FIFO head.
            autoFocusAttemptedIdentity = nil
        }
    }

    private func coordinatorAllowsAutomaticFocus(
        on identity: PetInteractionIdentity
    ) -> Bool {
        guard let authoritativeForeground = snapshot?.routing.foreground else { return true }
        return authoritativeForeground == identity
    }

    private func authoritativeSelectionInteraction() -> PetInteraction? {
        guard pendingManagedCommandApproval == nil,
              inFlightManagedCommandApprovalID == nil,
              pendingPermissionRequest == nil,
              inFlightPermissionRequestID == nil,
              let interaction = focusedInteraction,
              fifoHeadInteraction?.identity == interaction.identity,
              interaction.isSelectionReady,
              snapshot?.routing.foreground == interaction.identity,
              pendingFocusIdentity == nil
        else { return nil }
        return interaction
    }

    private func submit(interaction: PetInteraction, choice: PetChoice) async {
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
        if selectionSubmission == nil { selectionSubmission = submission }
        inFlightSelectionIdentity = key
        updateHotKeyEligibility()
        defer {
            if selectionSubmission == submission {
                selectionSubmission = nil
                updateHotKeyEligibility()
            }
        }
        lastError = persistentApprovalResolutionError
        do {
            let request = try PetSelectionRequest(
                identity: current.identity,
                selectionID: selectionIDGenerator(),
                optionID: choice.optionID
            )
            let response = try await transport.request(type: "select", payload: request.data())
            let outcome = try PetTransportResponse.requireAcceptedSelection(response)
            if inFlightSelectionIdentity == key { inFlightSelectionIdentity = nil }
            localForegroundIdentity = nil
            pendingFocusIdentity = nil
            riskConfirmation = nil
            lastTerminalPresentation = outcome == "pause" ? .paused : nil
            updateHotKeyEligibility()
            if let selectionReturnApplication {
                _ = externalApplicationOpener.open(selectionReturnApplication)
            }
            await fetchAndApplySnapshot()
        } catch {
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

    private func updateHotKeyEligibility() {
        reconcileChoicePreview()
        reconcileApprovalShortcuts()
        guard pendingManagedCommandApproval == nil,
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

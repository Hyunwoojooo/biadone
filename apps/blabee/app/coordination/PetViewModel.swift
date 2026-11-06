import AppKit
import Combine
import CoordinatorSwift
import Dispatch
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
        case .disconnected: PetL10n.text("Waiting for connection", korean: "연결 대기")
        case .malformed: PetL10n.text("Safely stopped", korean: "안전하게 중지됨")
        case .ready: PetL10n.text("Ready", korean: "준비됨")
        case .working: PetL10n.text("Working", korean: "작업 중")
        case .permission: PetL10n.text("Awaiting permission", korean: "권한 대기")
        case .waiting: PetL10n.text("Awaiting decision", korean: "결정 대기")
        case .reminder: PetL10n.text("Decision notification", korean: "결정 알림")
        case .expired: PetL10n.text("Expired", korean: "만료됨")
        case .paused: PetL10n.text("Deferred", korean: "보류됨")
        case .recoveryCapable: PetL10n.text("Recovery available", korean: "복구 가능")
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

/// A selection failure outlives ordinary snapshot reads. It is an observation,
/// never authority to retry a selection or to claim that the work did not run.
struct PetSelectionDeliveryNotice: Sendable, Equatable, Identifiable {
    let id: UUID
    let identity: PetInteractionIdentity
    let selectionID: String
    let provider: PetProvider
    let deliveryState: CoordinatorNextTurnDispatchFailure.DeliveryState
    let code: String?
    let requiresCodexRecheck: Bool
    var nativeRecheckSucceeded = false
    var nativeRecheckFailed = false

    private var previewTooLarge: Bool {
        provider == .codex && deliveryState == .notSubmitted && code == "queued_prompt_preview_invalid"
    }

    var title: String {
        if previewTooLarge { return PetL10n.text("Card content is too long", korean: "카드 내용이 너무 길어요") }
        if nativeRecheckSucceeded { return PetL10n.text("Codex check complete", korean: "Codex 검사를 마쳤어요") }
        return deliveryState == .notSubmitted
            ? PetL10n.text("Unable to send to \(provider.displayName)", korean: "\(provider.displayName)로 보내지 못했어요") : PetL10n.text("Delivery result unknown", korean: "전달 결과를 확인할 수 없어요")
    }

    var detail: String {
        if previewTooLarge {
            return PetL10n.text("Ask Codex for a shorter card, then choose the task again. The selected task was not sent.", korean: "Codex에 내용을 줄인 새 카드를 요청한 뒤 다시 선택해 주세요. 선택한 작업은 전달되지 않았어요.")
        }
        if nativeRecheckSucceeded {
            return deliveryState == .notSubmitted
                ? PetL10n.text("The previous selection was not resent. Request a new card and choose the task you want.", korean: "이전 선택은 다시 보내지 않았어요. 새 카드를 받아 원하는 작업을 선택해 주세요.")
                : PetL10n.text("First check the Codex conversation to see whether the previous task started, then choose a task from a new card.", korean: "이전 작업이 시작됐는지 Codex 대화에서 먼저 확인한 뒤, 새 카드에서 원하는 작업을 선택해 주세요.")
        }
        if nativeRecheckFailed {
            return PetL10n.text("The Codex execution check could not finish. Check the connection in Settings or run the check again.", korean: "Codex 실행 검사를 마치지 못했어요. 설정의 연결 상태를 확인하거나 다시 검사해 주세요.")
        }
        if deliveryState == .unknown {
            return PetL10n.text("First check whether the task started in the \(provider.displayName) conversation. The previous selection will not be resent automatically.", korean: "\(provider.displayName) 대화에서 작업이 시작됐는지 먼저 확인해 주세요. 이전 선택은 자동으로 다시 보내지 않아요.")
        }
        return requiresCodexRecheck
            ? PetL10n.text("Run the Codex execution check again, then request a new card and choose the task you want.", korean: "Codex 실행 검사를 다시 진행해 주세요. 검사 후 새 카드를 받아 원하는 작업을 선택해 주세요.")
            : PetL10n.text("Check the connection, then request a new card and choose the task you want.", korean: "연결 상태를 확인한 뒤 새 카드를 받아 원하는 작업을 선택해 주세요.")
    }
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
    private let connectClaude: (@MainActor (UUID, ClaudeInstalledLauncher.TerminalApplication) async throws -> PetClaudeLauncher.LaunchReceipt?)?
    let claudeConnection: PetClaudeConnectionController
    private let connectionSetupStore: any PetConnectionSetupSelectionStoring
    private let connectionSetupPollLimit: Int
    private let connectionSetupPollIntervalNanoseconds: UInt64
    private var connectionSetupChanges: AnyCancellable?
    private var claudeConnectionChanges: AnyCancellable?
    private var connectionSetupProjectIssue: String?
    @Published private(set) var isContinuingCodexConnectionSetup = false
    @Published private(set) var isCheckingConnectionSetupAfterReturn = false
    private var codexSetupContinuationID: UUID?
    private var codexSetupContinuationTask: Task<Void, Never>?
    private var codexSetupContinuationContext: ConnectionSetupContext?
    private var connectionSetupReturnCheckID: UUID?
    private var connectionSetupReturnCheckTask: Task<Void, Never>?
    private var connectionSetupScopeGeneration: UInt64 = 0

    /// Observations and delayed setup work belong to one UI, selection and
    /// service generation. Neither a matching project alone nor returning to
    /// the foreground confers permission to continue an older setup attempt.
    private struct ConnectionSetupContext: Equatable {
        let action: ProviderActionContext
        let selectedProviders: Set<PetConnectionSetupProvider>
        let selectionGeneration: UInt64
        let scopeGeneration: UInt64
        let projects: [String]
        let projectsAreAuthoritative: Bool
        let hookProject: String?
        let firstRunGeneration: UUID
        let firstRunActive: Bool
        let showingSettings: Bool
        let settingsTab: PetSettingsTab
    }
    lazy var connectionSetup: PetConnectionSetupController = {
        let controller = PetConnectionSetupController(store: connectionSetupStore,
            inspect: { [weak self] in
                guard let self, !self.isShuttingDown else { throw CancellationError() }
                return try await self.inspectConnectionSetup()
            }, prepare: { [weak self] in
                guard let self, !self.isShuttingDown else { throw CancellationError() }
                let context = self.errorDiagnostics?.captureContext()
                let selected = self.connectionSetup.selectedProviders
                do { try await self.prepareConnectionSetup() }
                catch {
                    if !(error is CancellationError) {
                        for provider in selected {
                            self.recordConnectionDiagnostic(.init(provider: provider == .codex ? .codex : .claude,
                                stage: .serviceStart,
                                reason: (error as? PetClaudeConnectionController.Failure)?.reason ?? .serviceUnavailable), context: context)
                        }
                    }
                    throw error
                }
            }, configure: { [weak self] provider in
                guard let self, !self.isShuttingDown else { throw CancellationError() }
                try await self.configureConnectionProvider(provider)
            })
        connectionSetupChanges = controller.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        return controller
    }()

    /// Captured at the UI event, before an asynchronous task can change the
    /// selected provider. Matching card IDs alone never confer authority.
    struct ProviderActionContext: Sendable, Equatable {
        fileprivate let serviceGeneration: UInt64?
        fileprivate let providerGeneration: UInt64
        fileprivate let accessGeneration: UInt64?
        let expectedContext: PetProviderContext?
    }
    let automaticAppUpdate: AppUpdateTransactionController
    let account: PetAccountController?
    // Product assembly always supplies this gate. Standalone rendering and
    // existing transport fixtures can omit the account/service integration.
    let productAccess: PetAccessController?
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
    // An open background feedback window must not disable global shortcuts.
    private(set) var isFeedbackInputActive = false
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

    private struct SelectionOperation: Sendable {
        let id = UUID()
        let submission: PetSelectionSubmission
        let selectionID: String
        let context: ProviderActionContext
    }

    private struct EventFocusOperation: Sendable {
        let id = UUID()
        let target: PetEventFocusTarget
        let retryTarget: FocusRetryTarget
        let displayedReference: PetEventReference?
        let context: ProviderActionContext
    }

    private struct InboxFocusOperation: Sendable {
        let id = UUID()
        let identity: PetProviderInboxIdentity
        let context: PetProviderContext
        let serviceGeneration: UInt64?
    }

    private enum FocusRetryTarget: Sendable, Equatable {
        case interaction(PetInteractionIdentity)
        case approval(PetEventFocusTarget)

        init(event: PetQueuedEvent, target: PetEventFocusTarget) {
            switch event {
            case .decision(let interaction):
                // Both focus endpoints refer to the same immutable decision.
                // Keep packet, revision and the complete session/turn binding.
                self = .interaction(interaction.identity)
            case .permission, .managed:
                // Approval kinds and their full bindings remain distinct.
                self = .approval(target)
            }
        }
    }

    private struct FocusFailure: Sendable {
        let operationID: UUID
        let target: FocusRetryTarget
        let context: ProviderActionContext
        let attempts: Int
        let failedAt: UInt64
        let retryAfter: UInt64
    }

    private struct FocusRequestReservation: Sendable {
        let operationID: UUID
        let target: FocusRetryTarget
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
    private var automaticEventFocusToken: UUID?
    @Published private(set) var selectedInboxIdentity: PetProviderInboxIdentity?
    @Published private(set) var pendingInboxIdentity: PetProviderInboxIdentity?

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
    @Published private(set) var selectionDeliveryNotice: PetSelectionDeliveryNotice? {
        didSet {
            if oldValue != selectionDeliveryNotice {
                onPanelLayoutChanged?()
                onAttentionChanged?(hasAttention)
            }
        }
    }
    private var selectionDeliveryNoticeContext: ProviderActionContext?
    // Losing a snapshot invalidates action authority, but is not evidence of
    // another provider/session. Keep only the notice until an exact context is
    // observed again. The old in-flight operation remains fenced separately.
    private var selectionDeliveryNoticeAwaitingSnapshotRecovery = false
    private var activeSelectionOperation: SelectionOperation?
    private var selectionCompletionInvalidated = false
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
    @Published private(set) var accessDiagnosticsRequestID: UUID?
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
    @Published private var activeCodexConnectionRecovery: PetCodexConnectionRecovery?
    @Published private(set) var configuredProjectPaths: [String] = []
    @Published private(set) var configuredProjectPathsAreAuthoritative = false
    @Published private(set) var configuredProjectScopeExists = false
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
    private var activeEventFocusOperation: EventFocusOperation?
    private var activeInboxFocusOperation: InboxFocusOperation?
    // Independent of snapshot connectivity: a good get_state response is not
    // evidence that a timed-out focus request was acknowledged.
    private var focusFailures: [FocusFailure] = []
    // Ownership may be invalidated while transport is still suspended. Keep
    // that I/O reservation until it actually returns, independently of UI state.
    private var focusRequestsInFlight: [FocusRequestReservation] = []
    private let focusRetryNow: @MainActor () -> UInt64
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
    var onAppUpdateRequested: ((PetAppUpdateRelease?) -> Void)?

    init(
        transport: any PetCoordinatorTransport,
        externalApplicationOpener: any PetExternalApplicationOpening,
        provider: PetProvider = .codex,
        startClaude: (@MainActor () async throws -> Void)? = nil,
        connectClaude: (@MainActor (UUID, ClaudeInstalledLauncher.TerminalApplication) async throws -> PetClaudeLauncher.LaunchReceipt?)? = nil,
        claudeConnection: PetClaudeConnectionController? = nil,
        connectionSetupStore: (any PetConnectionSetupSelectionStoring)? = nil,
        connectionSetupPollLimit: Int = 60,
        connectionSetupPollIntervalNanoseconds: UInt64 = 500_000_000,
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
        productAccess: PetAccessController? = nil,
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
        choicePreviewHoldMonitor: PetChoicePreviewHoldMonitor = PetChoicePreviewHoldMonitor(),
        focusRetryNow: @escaping @MainActor () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }
    ) {
        self.transport = transport
        self.provider = provider
        self.startClaude = startClaude
        self.connectClaude = connectClaude
        self.claudeConnection = claudeConnection ?? PetClaudeConnectionController()
        self.connectionSetupStore = connectionSetupStore ?? PetConnectionSetupMemorySelectionStore()
        self.connectionSetupPollLimit = max(1, connectionSetupPollLimit)
        self.connectionSetupPollIntervalNanoseconds = connectionSetupPollIntervalNanoseconds
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
        self.productAccess = productAccess
        self.usageAnalytics = usageAnalytics
        self.errorDiagnostics = errorDiagnostics
        self.claudeConnection.errorDiagnostics = errorDiagnostics
        self.feedback = feedback
        self.insightCards = insightCards ?? usageAnalytics.map { PetInsightCardTracker(analytics: $0) }
        self.processIdentifier = processIdentifier
        self.selectionIDGenerator = selectionIDGenerator
        self.permissionResponseIDGenerator = permissionResponseIDGenerator
        self.managedApprovalResponseIDGenerator = managedApprovalResponseIDGenerator
        self.choicePreviewHoldMonitor = choicePreviewHoldMonitor
        self.focusRetryNow = focusRetryNow
        selectionReturnApplication = externalApplicationOpener
            .captureFrontmostExternalApplication(
                excludingProcessIdentifier: processIdentifier
            )
        applySuggestionModeLoadResult(suggestionModeStore.load())
        appService?.onChange = { [weak self] in self?.syncAppOwnedServiceState() }
        productAccess?.onChange = { [weak self] in self?.productAccessChanged() }
        claudeConnectionChanges = self.claudeConnection.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
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
    var eventQueueCount: Int { snapshot?.providerInbox?.entries.count ?? eventQueue.count }

    var displayedInboxEntry: PetProviderInboxEntry? {
        guard let context = selectedProviderContext, let event = displayedEvent,
              let id = try? PetProviderInboxIdentity(context: context, event: event) else { return nil }
        return snapshot?.providerInbox?.entries.first { $0.id == id && $0.context == context }
    }

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
        if let inbox = snapshot?.providerInbox {
            guard let id = displayedInboxEntry?.id, let index = inbox.entries.firstIndex(where: { $0.id == id }) else { return nil }
            return index + 1
        }
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
        guard productAccessAllowsActions, provider == .codex else { return nil }
        return snapshot?.eventNavigation == nil ? defaultApprovalHead : displayedEvent?.approval
    }

    var eventDeliveryPending: Bool {
        snapshot?.eventNavigation?.deliveryPending
            ?? eventQueue.contains(where: \.deliveryPending)
    }

    var canNavigateEvents: Bool {
        productAccessAllowsActions && (snapshot?.providerInbox != nil || (provider == .codex && snapshot?.eventNavigation != nil))
            && !isSwitchingProvider && !providerReadFailed && pendingInboxIdentity == nil && eventQueueCount > 1
            && !isShuttingDown && !isEditingShortcuts && !isShowingOnboarding && !isFeedbackInputActive
            && choicePreview == nil && !choicePreviewHoldMonitor.suppressesSelection
            && pendingEventFocus == nil && pendingFocusIdentity == nil
            && selectionSubmission == nil && inFlightSelectionIdentity == nil
            && inFlightDismissalIdentity == nil && riskConfirmation == nil
            && inFlightPermissionRequestID == nil && inFlightManagedCommandApprovalID == nil
            && !eventDeliveryPending
    }

    /// A new visible event never inherits another event's selection authority.
    var canActOnDisplayedEvent: Bool {
        if snapshot?.providerInbox != nil {
            guard pendingInboxIdentity == nil, let selectedInboxIdentity,
                  displayedInboxEntry?.id == selectedInboxIdentity else { return false }
        }
        guard productAccessAllowsActions, !isShuttingDown, pendingEventFocus == nil, !eventDeliveryPending else { return false }
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
        selectionDeliveryNotice != nil || lastError != nil
            || visibleShortcutDiagnostic != nil || providerDiagnostic != nil
    }

    var hasPersistentApprovalResolutionError: Bool {
        persistentApprovalResolutionError != nil
    }

    var hasAttention: Bool {
        productAccessAllowsActions && (hasNewPermissionNotice
            || (providerAllowsSelection && fifoHeadInteraction?.isSelectionReady == true)
            || hasPersistentApprovalResolutionError || selectionDeliveryNotice != nil)
    }

    var productAccessAllowsActions: Bool { productAccess?.allowsActions ?? true }
    var isProductAccessBlocked: Bool { !productAccessAllowsActions }

    private func productAccessChanged() {
        if isProductAccessBlocked {
            invalidateSelectionOperation()
            clearSelectionDeliveryNotice()
            endChoicePreview()
            invalidateFocusOperation()
            invalidateEventFocusOperation()
            invalidateInboxFocusOperation()
            confirmedEventFocus = nil
            riskConfirmation = nil
            pendingFocusIdentity = nil
            localForegroundIdentity = nil
            selectionSubmission = nil
            inFlightSelectionIdentity = nil
            inFlightDismissalIdentity = nil
            inFlightPermissionRequestID = nil
            inFlightManagedCommandApprovalID = nil
        }
        if let context = selectionDeliveryNoticeContext, !selectionDeliveryNoticeOwnerIsCurrent(context) {
            clearSelectionDeliveryNotice()
        }
        objectWillChange.send()
        updateHotKeyEligibility()
        onPanelLayoutChanged?()
        onAttentionChanged?(hasAttention)
        onApprovalHeadChanged?(approvalHead?.identity)
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
        if isProductAccessBlocked, let productAccess { return productAccess.effectiveState.title }
        if provider == .claude {
            if providerReadFailed { return PetL10n.text("Check the Claude connection", korean: "Claude 연결 확인 필요") }
            if let state = selectedProviderSession?.state {
                switch state {
                case "starting": return PetL10n.text("Starting Claude", korean: "Claude 시작 중")
                case "pending": return PetL10n.text("Checking connection", korean: "연결 확인 중")
                case "disconnected": return PetL10n.text("Disconnected · Start again", korean: "연결 끊김 · 새로 시작")
                case "unavailable": return PetL10n.text("Claude connection unavailable", korean: "Claude 연결 사용 불가")
                default: break
                }
            }
            guard let status = snapshot?.providerStatus else { return PetL10n.text("Waiting for Claude connection", korean: "Claude 연결 대기") }
            if !status.bridgeConnected { return PetL10n.text("Waiting for Claude connection", korean: "Claude 연결 대기") }
            if !status.ready { return PetL10n.text("Connection check needed", korean: "연결 확인 필요") }
            if snapshot?.interactions.isEmpty == false {
                return status.selectionEnabled ? PetL10n.text("Awaiting decision", korean: "결정 대기") : PetL10n.text("Waiting for Claude", korean: "Claude 응답 대기")
            }
            if supportsProviderSessions {
                if (snapshot?.routing.inFlightCount ?? 0) > 0 { return PetL10n.text("Awaiting delivery", korean: "전달 대기") }
                if status.pendingReportCount > 0 { return PetL10n.text("Claude acknowledged the task", korean: "Claude가 작업 확인") }
            }
            return providerHasPendingResult ? PetL10n.text("Waiting for selection result", korean: "선택 결과 대기") : PetL10n.text("Ready", korean: "준비됨")
        }
        if isAppOwnedServiceEnabled, appOwnedServiceState != .ready {
            return appOwnedServiceTitle
        }
        return presentationState.displayTitle
    }

    var emptyStateDescription: String {
        if provider == .claude {
            if supportsProviderSessions {
                if providerReadFailed { return PetL10n.text("Recheck the connection or start a new Claude session.", korean: "연결 상태를 다시 확인하거나 새 Claude 세션을 시작해 주세요.") }
                switch selectedProviderSession?.state {
                case "starting": return PetL10n.text("Starting a new Claude session in the selected project.", korean: "선택한 프로젝트에서 새 Claude 세션을 시작하고 있습니다.")
                case "pending": return PetL10n.text("Waiting for Claude's connection check response.", korean: "Claude의 연결 확인 응답을 기다리고 있습니다.")
                case "disconnected": return PetL10n.text("This session ended. Start a new Claude session from the menu.", korean: "이 세션은 종료되었습니다. 메뉴에서 새 Claude 세션을 시작해 주세요.")
                case "unavailable": return PetL10n.text("Unable to prepare this session's connection. Check its connection status.", korean: "이 세션의 연결을 준비하지 못했습니다. 연결 상태를 확인해 주세요.")
                default: break
                }
            }
            guard let status = snapshot?.providerStatus, status.bridgeConnected else {
                return supportsProviderSessions ? PetL10n.text("Waiting for the selected Claude session to connect.", korean: "선택한 Claude 세션의 연결을 기다리고 있습니다.")
                    : PetL10n.text("Waiting for the Claude session that opened this window to connect.", korean: "이 창을 연 Claude 세션의 연결을 기다리고 있습니다.")
            }
            if !status.ready { return supportsProviderSessions ? PetL10n.text("Choose Check Connection from the menu.", korean: "메뉴에서 연결 확인을 선택해 주세요.")
                : PetL10n.text("Request a Blabee connection check in the same Claude conversation.", korean: "같은 Claude 대화창에서 Blabee 연결 확인을 요청해 주세요.") }
            if providerHasPendingResult {
                return PetL10n.text("Selection received. Waiting for Claude to report the result.", korean: "선택을 접수했습니다. Claude의 작업 결과 보고를 기다리고 있습니다.")
            }
            return PetL10n.text("Suggestions from Claude will appear here.", korean: "Claude가 제안을 보내면 여기에 표시됩니다.")
        }
        if isAppOwnedServiceEnabled, appOwnedServiceState != .ready {
            return appOwnedServiceDetail
        }
        return snapshot == nil
            ? PetL10n.text("Check the service connection in Settings.", korean: "설정에서 서비스 연결 상태를 확인해 주세요.")
            : PetL10n.text("Valid decision cards will appear here.", korean: "유효한 결정 카드가 생기면 여기에 표시됩니다.")
    }

    var isAppOwnedServiceAvailable: Bool { appService != nil }

    var supportsProviderSessions: Bool { transport is any PetProviderControlling }
    var supportsProductSettings: Bool { provider == .codex || supportsProviderSessions }
    var supportsDecisionDismissal: Bool { provider == .codex || provider == .claude }
    private var providerAllowsSelection: Bool {
        productAccessAllowsActions && !isSwitchingProvider && !providerReadFailed && (provider == .codex || (snapshot?.providerStatus?.provider == .claude
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
            return PetL10n.text("To use Claude, choose Enable App-Owned Service in Settings → Connection. Installing the Codex Plugin is not required.", korean: "Claude를 사용하려면 설정의 연결 탭에서 ‘앱 실행형 서비스 켜기’를 선택하세요. Codex Plugin 설치는 필요하지 않습니다.")
        case .blocked:
            if needsAppOwnedServiceRestartAfterLegacyCleanup { return appOwnedServiceDetail }
            return PetL10n.text("Finish the current Blabee selection, then unregister the Previous Auto-Start Service and choose Restart Service in Settings → Connection.", korean: "진행 중인 Blabee 선택을 마친 뒤 설정의 연결 탭에서 ‘이전 자동 시작 서비스’를 등록 해제하고 ‘서비스 다시 시작’을 선택하세요.")
        case .stopped:
            return PetL10n.text("Choose Restart Service in Settings → Connection, then start Claude.", korean: "설정의 연결 탭에서 ‘서비스 다시 시작’을 선택한 뒤 Claude를 시작하세요.")
        case .starting, .reconnecting, .unresponsive, .stopping:
            return PetL10n.text("Check the service connection before starting Claude. \(appService.state.detail)", korean: "Claude를 시작하기 전에 서비스 연결을 확인해야 합니다. \(appService.state.detail)")
        case .ready, .failed:
            return PetL10n.text("Unable to verify the service required by Claude. Check service status in Settings → Connection.", korean: "Claude 연결에 필요한 서비스를 확인하지 못했습니다. 설정의 연결 탭에서 서비스 상태를 확인하세요.")
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
            return PetL10n.text("Result unknown · Unable to confirm task completion for the ended session.", korean: "결과 미확인 · 종료된 세션의 작업 완료 여부를 확인하지 못했습니다.")
        }
        let reports = snapshot?.providerStatus?.pendingReportCount ?? 0
        if reports > 0 { return PetL10n.text("Claude acknowledged the task · Waiting for \(reports) result reports", korean: "Claude가 작업 확인 · \(reports)건의 결과 보고 대기") }
        return PetL10n.text("Awaiting delivery · Waiting for Claude to acknowledge the selection.", korean: "전달 대기 · Claude의 선택 확인을 기다리고 있습니다.")
    }

    func captureProviderActionContext() -> ProviderActionContext {
        ProviderActionContext(serviceGeneration: appService?.generation,
                              providerGeneration: providerGeneration,
                              accessGeneration: productAccess?.actionGeneration,
                              expectedContext: selectedProviderContext)
    }

    func acceptsProviderAction(_ context: ProviderActionContext) -> Bool {
        productAccessAllowsActions && acceptsProviderObservation(context)
            && context.accessGeneration == productAccess?.actionGeneration
    }

    private func acceptsProviderObservation(_ context: ProviderActionContext) -> Bool {
        !isShuttingDown && context.serviceGeneration == appService?.generation
            && context.providerGeneration == providerGeneration
            && context.expectedContext == selectedProviderContext
    }

    func selectProviderSession(_ session: PetProviderSession) async {
        await selectProviderSession(session, preservingInboxOperation: nil)
    }

    private func selectProviderSession(
        _ session: PetProviderSession, preservingInboxOperation operationID: UUID?
    ) async {
        guard let controller = transport as? any PetProviderControlling,
              !isSwitchingProvider, !isShuttingDown,
              providerSessions.contains(where: { $0 == session }),
              session.context != selectedProviderContext else { return }
        invalidateProviderInteractionState(preservingInboxOperation: operationID)
        provider = session.context.provider
        snapshot = nil
        isSwitchingProvider = true
        updateClaudeConnection()
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
                ?? PetL10n.text("Unable to verify the Claude launch request.", korean: "Claude 시작 요청을 확인하지 못했어요.")
        }
    }

    var supportsClaudeConnectionSetup: Bool {
        supportsProviderSessions && connectClaude != nil && appService != nil && !isShuttingDown
    }

    func connectClaudeSession(terminal: ClaudeInstalledLauncher.TerminalApplication) async {
        guard supportsClaudeConnectionSetup, !isStartingClaude, !connectionSetup.isWorking,
              !isOnboardingConfigurationOperationInFlight, let connectClaude else { return }
        await claudeConnection.connect(terminal: terminal, prepareService: { [self] in
            try await prepareClaudeConnectionService()
        }, launch: connectClaude)
        // A terminal can answer before the launch RPC returns. Observe the
        // latest directory again after installing the exact launch receipt.
        updateClaudeConnection()
    }

    private func prepareClaudeConnectionService() async throws -> PetClaudeConnectionController.ServiceIdentity {
        guard let appService, !isShuttingDown else { throw PetClaudeLauncher.Failure.serviceChanged }
        if appService.state == .disabled {
            await performOnboardingOperation(.service) {
                appService.enable()
                reloadOnboardingState()
            }
        }
        else if appService.state == .stopped { appService.startAtAppLaunch() }
        let generation = appService.generation
        // First run observes a separate read-only snapshot. It must not wait
        // for normal polling, which begins only after onboarding completes.
        for _ in 0..<600 {
            try Task.checkCancellation()
            guard !isShuttingDown, appService.generation == generation else {
                throw PetClaudeLauncher.Failure.serviceChanged
            }
            if firstRunSetupActive { await refreshFirstRunSetup(inspectSettings: false) }
            try Task.checkCancellation()
            guard !isShuttingDown, appService.generation == generation else {
                throw PetClaudeLauncher.Failure.serviceChanged
            }
            switch appService.state {
            case .ready:
                if appService.petProviderAccess != nil,
                   (firstRunSetupActive ? coordinatorTransportError == nil : !providerReadFailed),
                   let directory = connectionSetupSnapshot?.providerDirectory,
                   directory.serviceGeneration == generation {
                    return .init(generation: generation, incarnation: directory.serviceIncarnation)
                }
            case .starting, .reconnecting: break
            default:
                throw PetClaudeConnectionController.Failure(detail: appService.state.detail)
            }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        throw PetClaudeConnectionController.Failure(detail: PetL10n.text("The service connection check is delayed. Check service status above, then choose Claude connection again.", korean: "서비스 연결 확인이 지연되고 있습니다. 위의 서비스 상태를 확인한 뒤 Claude 연결을 다시 선택해 주세요."))
    }

    func showConnectedClaudeSession() async {
        guard let row = claudeConnection.matchedSession,
              providerSessions.contains(row) else { return }
        await selectProviderSession(row)
        updateClaudeConnection()
    }

    var canRecheckConnectedClaudeSession: Bool {
        guard claudeConnection.phase == .needsProbe,
              let row = claudeConnection.matchedSession else { return false }
        return canControlClaudeSession(row)
    }

    func recheckConnectedClaudeSession() async {
        guard canRecheckConnectedClaudeSession,
              let row = claudeConnection.matchedSession else { return }
        await checkClaudeConnection(session: row)
        updateClaudeConnection()
    }

    private func updateClaudeConnection() {
        let row = claudeConnection.observe(snapshot: connectionSetupSnapshot,
            serviceGeneration: appService?.generation, serviceReady: appService?.state == .ready,
            readFailed: firstRunSetupActive ? coordinatorTransportError != nil : providerReadFailed,
            canSelect: !firstRunSetupActive && !isSwitchingProvider && !isShuttingDown)
        if let row {
            Task { [weak self] in
                guard let self, self.claudeConnection.stillWantsSelection(row) else { return }
                await self.selectProviderSession(row)
            }
        }
    }

    func checkClaudeConnection(context: ProviderActionContext? = nil) async {
        await performClaudeConnectionOperation(disconnect: false, context: context)
    }

    func disconnectClaudeSession(context: ProviderActionContext? = nil) async {
        await performClaudeConnectionOperation(disconnect: true, context: context)
    }

    private var availableClaudeDirectory: PetProviderDirectoryStatus? {
        guard let directory = snapshot?.providerDirectory else { return nil }
        if let appService {
            guard appService.state == .ready, appService.petProviderAccess != nil,
                  directory.serviceGeneration == appService.generation else { return nil }
        }
        return directory
    }

    func canControlClaudeSession(_ session: PetProviderSession) -> Bool {
        guard let directory = availableClaudeDirectory else { return false }
        return supportsProviderSessions && session.context.provider == .claude
            && providerSessions.contains(session) && !isShuttingDown
            && !isProviderConnectionOperationInFlight && !isSwitchingProvider
            && session.context.serviceIncarnation == directory.serviceIncarnation
    }

    // A failed scoped read keeps the directory for navigation and recovery
    // controls, but its cached ACK no longer proves current session readiness.
    private var claudeSettingsDirectoryIsCurrent: Bool {
        !providerReadFailed && availableClaudeDirectory != nil
    }

    var claudeSettingsSummary: PetClaudeSettingsSummary {
        PetClaudeSettingsSummary(
            sessions: snapshot?.providerInbox?.sessions ?? [],
            directoryVerified: claudeSettingsDirectoryIsCurrent,
            serviceConnected: hasVerifiedServiceConnection
        )
    }

    func claudeSessionSettingsStatus(_ entry: PetProviderInboxSession) -> PetClaudeSessionSettingsStatus {
        PetClaudeSessionSettingsStatus(
            session: entry, directoryVerified: claudeSettingsDirectoryIsCurrent,
            serviceConnected: hasVerifiedServiceConnection
        )
    }

    func checkClaudeConnection(session: PetProviderSession) async {
        await controlClaudeSession(session, disconnect: false)
    }

    func disconnectClaudeSession(session: PetProviderSession) async {
        await controlClaudeSession(session, disconnect: true)
    }

    private func controlClaudeSession(_ session: PetProviderSession, disconnect: Bool) async {
        guard canControlClaudeSession(session), let controller = transport as? any PetProviderControlling else { return }
        let generation = appService?.generation
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
            if disconnect { try await controller.disconnectSession(session) }
            else { try await controller.checkSessionConnection(session) }
            guard !isShuttingDown, appService?.generation == generation else { return }
            await fetchAndApplySnapshot()
        } catch {
            guard !isShuttingDown, appService?.generation == generation,
                  providerConnectionOperationID == operationID else { return }
            lastError = String(describing: error)
        }
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

    private func invalidateProviderInteractionState(
        preservingInboxOperation operationID: UUID? = nil,
        preservingSelectionDeliveryNotice: Bool = false
    ) {
        providerGeneration &+= 1
        invalidateSelectionOperation()
        if !preservingSelectionDeliveryNotice { clearSelectionDeliveryNotice() }
        invalidateFocusOperation()
        invalidateEventFocusOperation()
        if activeInboxFocusOperation?.id != operationID { invalidateInboxFocusOperation() }
        endChoicePreview()
        selectedEventReference = nil
        confirmedEventFocus = nil
        pendingEventFocus = nil
        automaticEventFocusToken = nil
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
            && !isContinuingCodexConnectionSetup && !isCheckingConnectionSetupAfterReturn
            && !isOnboardingConfigurationOperationInFlight
            && !connectionSetup.isWorking && !claudeConnection.isWorking
            && appService?.isTransitioning != true
    }

    private func syncAppOwnedServiceState() {
        productAccess?.serviceDidChange()
        guard let appService else { return }
        reconcileSelectionDeliveryState()
        defer { updateClaudeConnection(); publishConnectionSetupObservation() }
        if appOwnedServiceState != appService.state { appOwnedServiceState = appService.state }
        if isAppOwnedServiceEnabled != appService.enabled { isAppOwnedServiceEnabled = appService.enabled }
        if !appService.mayQueryCoordinator {
            if !connectionReceivedCardProjectPaths.isEmpty {
                connectionReceivedCardProjectPaths = []
            }
            let previousApproval = approvalHead?.identity
            invalidateFocusOperation()
            invalidateEventFocusOperation()
            invalidateInboxFocusOperation()
            snapshot = nil
            firstRunSetupSnapshot = nil
            confirmedEventFocus = nil
            pendingEventFocus = nil
            automaticEventFocusToken = nil
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
        connectionSetup.canFinish && hasVerifiedServiceConnection
    }

    func setConnectionProviderSelected(_ provider: PetConnectionSetupProvider, selected: Bool) {
        guard !isOnboardingOperationInFlight, !isShuttingDown else { return }
        connectionSetup.setSelected(selected, for: provider)
    }

    func refreshConnectionSetup() async {
        guard !isOnboardingOperationInFlight, !isShuttingDown else { return }
        await connectionSetup.refresh()
    }

    func connectSelectedProviders() async {
        guard !isOnboardingOperationInFlight, !isShuttingDown else { return }
        connectionSetupProjectIssue = nil
        await connectionSetup.connect()
    }

    /// One explicit recovery action resumes the complete setup flow. Keep the
    /// Plugin-only retry API separate for advanced settings and delivery help.
    func recoverAndContinueCodexSetup() async {
        guard canRetryCodexPluginConnection,
              connectionSetup.selectedProviders.contains(.codex) else { return }
        refreshLocalOnboardingState()
        let operation = UUID()
        codexSetupContinuationID = operation
        codexSetupContinuationContext = captureConnectionSetupContext()
        isContinuingCodexConnectionSetup = true
        activeCodexConnectionRecovery = codexConnectionRecovery
        let task = Task { [weak self] in
            guard let self else { return }
            await runCodexNativeRecheck(connectWhenReady: false,
                requestIsCurrent: { self.acceptsCodexSetupContinuation(operation) })
            guard acceptsCodexSetupContinuation(operation), !Task.isCancelled else { return }
            switch codexPluginSetupState {
            case .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable, .installedNeedsHookReview:
                connectionSetupProjectIssue = nil
                await connectionSetup.connect(while: { self.acceptsCodexSetupContinuation(operation) })
            default:
                break
            }
        }
        codexSetupContinuationTask = task
        await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
        // Retain the single-flight reservation until the adapter returns, even
        // after cancellation: it may be completing an atomic settings write.
        codexSetupContinuationTask = nil
        codexSetupContinuationID = nil
        codexSetupContinuationContext = nil
        isContinuingCodexConnectionSetup = false
        activeCodexConnectionRecovery = nil
        if codexNativeRecheckReport?.isChecking == true { codexNativeRecheckReport = nil }
    }

    func cancelConnectionSetup() {
        codexSetupContinuationID = nil
        codexSetupContinuationTask?.cancel()
        connectionSetupReturnCheckID = nil
        connectionSetupReturnCheckTask?.cancel()
        connectionSetup.cancel()
    }

    var isAwaitingCodexHookReview: Bool {
        guard connectionSetup.selectedProviders.contains(.codex),
              case .installedNeedsHookReview = codexPluginSetupState,
              connectionSetupProjectIssue == nil,
              configuredProjectPathsAreAuthoritative, !configuredProjectPaths.isEmpty,
              hasVerifiedServiceConnection, connectionSetupSnapshot?.codexSettingsEvidence != nil,
              !projectSettingsNeedRestart, codexHookReadiness != .trusted else { return false }
        return true
    }

    /// Returning from Codex can only observe an already prepared connection.
    /// This deliberately avoids normal polling's consumer heartbeat/focus and
    /// never installs, starts a service, accepts trust or launches a session.
    func refreshConnectionSetupAfterReturningToApp() async {
        guard !isOnboardingOperationInFlight, !isShuttingDown,
              firstRunSetupActive || (isShowingSettings && selectedSettingsTab == .connection) else { return }
        refreshLocalOnboardingState()
        guard isAwaitingCodexHookReview, appService?.mayQueryCoordinator != false else { return }
        let operation = UUID()
        let context = captureConnectionSetupContext()
        connectionSetupReturnCheckID = operation
        isCheckingConnectionSetupAfterReturn = true
        let task = Task { [weak self] in
            guard let self else { return }
            @MainActor func isCurrent() -> Bool {
                !Task.isCancelled && connectionSetupReturnCheckID == operation
                    && acceptsConnectionSetupContext(context)
            }
            let plugin = await codexPluginSetupManager.inspect()
            guard isCurrent() else { return }
            let hooks: PetHookReadinessState
            if case .installedNeedsHookReview = plugin, let project = context.hookProject {
                hooks = await hookReadinessManager.inspect(projectURL: URL(fileURLWithPath: project))
            } else {
                hooks = .unchecked
            }
            guard isCurrent() else { return }
            nextSnapshotRequest &+= 1
            let requestNumber = nextSnapshotRequest
            do {
                let data = try await transport.request(type: "get_state", payload: Data("{}".utf8), expectedContext: nil)
                guard isCurrent() else { return }
                let observed = try await transport.decodeSnapshot(data)
                guard isCurrent(), requestNumber >= lastAppliedSnapshotRequest,
                      context.action.serviceGeneration.map({ appService?.acceptsSnapshot(generation: $0) == true }) ?? true
                else { return }
                guard observed.hasVerifiedServiceResponse else {
                    throw PetModelError.invalid("connection_setup_service_response_unverified")
                }
                codexPluginSetupState = plugin
                checkedHookProjectPath = context.hookProject
                rawCodexHookReadiness = hooks
                coordinatorTransportError = nil
                lastAppliedSnapshotRequest = requestNumber
                if context.firstRunActive {
                    firstRunSetupSnapshot = observed
                } else {
                    apply(observed)
                }
                publishConnectionSetupObservation()
            } catch {
                guard isCurrent(), requestNumber >= lastAppliedSnapshotRequest else { return }
                // An observed failure revokes readiness; it never retries the
                // write or restarts the otherwise running service.
                invalidateHookReadiness()
                coordinatorTransportError = String(describing: error)
                lastAppliedSnapshotRequest = requestNumber
                if context.firstRunActive {
                    firstRunSetupSnapshot = nil
                }
                publishConnectionSetupObservation()
            }
        }
        connectionSetupReturnCheckTask = task
        await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
        connectionSetupReturnCheckTask = nil
        connectionSetupReturnCheckID = nil
        isCheckingConnectionSetupAfterReturn = false
    }

    private func captureConnectionSetupContext() -> ConnectionSetupContext {
        .init(action: captureProviderActionContext(), selectedProviders: connectionSetup.selectedProviders,
              selectionGeneration: connectionSetup.selectionGeneration,
              scopeGeneration: connectionSetupScopeGeneration,
              projects: configuredProjectPaths, projectsAreAuthoritative: configuredProjectPathsAreAuthoritative,
              hookProject: hookReadinessProjectPath, firstRunGeneration: firstRunSetupGeneration,
              firstRunActive: firstRunSetupActive, showingSettings: isShowingSettings,
              settingsTab: selectedSettingsTab)
    }

    private func acceptsConnectionSetupContext(_ context: ConnectionSetupContext) -> Bool {
        !isShuttingDown && context == captureConnectionSetupContext()
    }

    private func acceptsCodexSetupContinuation(_ operation: UUID) -> Bool {
        codexSetupContinuationID == operation
            && codexSetupContinuationContext.map(acceptsConnectionSetupContext) == true
    }

    private func requireCurrentSetupContinuation(_ operation: UUID?) throws {
        try Task.checkCancellation()
        guard !isShuttingDown,
              operation.map(acceptsCodexSetupContinuation) != false else { throw CancellationError() }
    }

    private func acceptOwnSetupPrerequisiteChange(_ operation: UUID?) {
        guard let operation, codexSetupContinuationID == operation else { return }
        codexSetupContinuationContext = captureConnectionSetupContext()
    }

    /// A separate user action is required after removing a legacy registration.
    /// Refreshing setup or completing the removal never starts a replacement.
    func restartConnectionSetupService() async {
        guard needsAppOwnedServiceRestartAfterLegacyCleanup, canChangeAppOwnedService else { return }
        await restartAppOwnedService()
        await refreshConnectionSetup()
    }

    func openConnectionInstallGuide(for provider: PetConnectionSetupProvider) {
        let address = provider == .codex
            ? "https://developers.openai.com/codex/cli/"
            : "https://code.claude.com/docs/en/setup"
        if let url = URL(string: address) { _ = appUpdateURLOpener(url) }
    }

    private var connectionSetupSnapshot: PetSnapshot? {
        firstRunSetupActive ? firstRunSetupSnapshot : snapshot
    }

    private var hasVerifiedClaudeDirectory: Bool {
        guard let appService, appService.state == .ready,
              let directory = connectionSetupSnapshot?.providerDirectory else { return false }
        return appService.petProviderAccess != nil && directory.serviceGeneration == appService.generation
    }

    private var observedClaudeSessionEvidence: PetConnectionSessionEvidence {
        guard hasVerifiedServiceConnection, hasVerifiedClaudeDirectory,
              let observed = connectionSetupSnapshot,
              let directory = observed.providerDirectory,
              firstRunSetupActive || !providerReadFailed else { return .unavailable }
        // Ordinary terminal launches have no app-owned launch attempt. Describe
        // their current provider evidence without attributing it to that attempt.
        let entries = (observed.providerInbox?.sessions ?? []).filter {
            $0.session.context.provider == .claude
                && $0.session.context.serviceIncarnation == directory.serviceIncarnation
                && observed.providerSessions.contains($0.session)
        }
        if entries.contains(where: {
            PetClaudeSessionSettingsStatus(session: $0, directoryVerified: true, serviceConnected: true).isReady
        }) { return .ready }
        if entries.contains(where: { $0.session.state != "disconnected" }) { return .waitingForAcknowledgement }
        if !entries.isEmpty { return .disconnected }
        return .waitingForSession
    }

    private var codexProjectScopeIssue: String? {
        if let connectionSetupProjectIssue { return connectionSetupProjectIssue }
        if !configuredProjectPathsAreAuthoritative {
            return PetL10n.text("Unable to verify working folder settings. Please check again.", korean: "작업 폴더 설정을 확인하지 못했습니다. 다시 확인해 주세요.")
        }
        if configuredProjectScopeExists && configuredProjectPaths.isEmpty {
            return PetL10n.text("No working folders are enabled. Add a folder in advanced connection settings to use Codex cards.", korean: "사용할 작업 폴더가 없습니다. Codex 카드를 사용하려면 고급 연결 설정에서 폴더를 추가해 주세요.")
        }
        return nil
    }

    private func currentConnectionSetupInspection() -> PetConnectionSetupInspection {
        let codex: PetConnectionSetupProviderState
        switch codexPluginSetupState {
        case .unchecked:
            codex = .init(status: .checking, detail: PetL10n.text("Check your Codex environment.", korean: "Codex 사용 환경을 확인해 주세요."))
        case .unavailable:
            codex = .init(status: .needsAction, detail: codexPluginSetupState.detail)
        case .error(let code):
            codex = .init(status: code == "codex_native_not_installed" || code == "codex_plugin_setup_executable_unavailable"
                ? .needsInstall : .failed, detail: codexPluginSetupState.detail)
        case .legacyInstallationDetected, .conflict:
            codex = .init(status: .needsAction, detail: codexPluginSetupState.detail)
        case .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable:
            if let issue = codexProjectScopeIssue {
                codex = .init(status: .needsAction, detail: issue)
            } else {
                codex = .init(status: .available, detail: PetL10n.text("Choose Connect to prepare the required Codex settings.", korean: "연결하기를 누르면 필요한 Codex 연결 설정을 준비합니다."))
            }
        case .installedNeedsHookReview:
            if let issue = codexProjectScopeIssue {
                codex = .init(status: .needsAction, detail: issue)
            } else if !configuredProjectScopeExists {
                codex = .init(status: .available, detail: PetL10n.text("Choose Connect to use your home folder and its subfolders. You can change this in advanced settings.", korean: "연결하기를 누르면 홈 폴더와 하위 폴더를 사용합니다. 고급 설정에서 범위를 바꿀 수 있습니다."))
            } else if projectSettingsNeedRestart {
                codex = .init(status: .needsAction, detail: PetL10n.text("The working folder was saved. Finish any active tasks, then restart the service in advanced settings to apply it.", korean: "작업 폴더는 저장됐습니다. 기존 작업을 마친 뒤 고급 설정에서 서비스를 다시 시작해 적용해 주세요."))
            } else if !hasVerifiedServiceConnection {
                codex = .init(status: .available, detail: PetL10n.text("Choose Connect to prepare Blabee and check the Codex connection.", korean: "연결하기를 누르면 Blabee를 준비하고 Codex 연결 상태를 확인합니다."))
            } else if connectionSetupSnapshot?.codexSettingsEvidence == nil {
                codex = .init(status: .needsAction, detail: PetL10n.text("Unable to verify the Codex working folders applied to the current service. Please check again.", korean: "현재 서비스에 적용된 Codex 작업 폴더를 확인하지 못했습니다. 다시 확인해 주세요."))
            } else if codexHookReadiness != .trusted {
                codex = .init(status: .needsAction, detail: codexHookReadiness.detail)
            } else {
                codex = .init(status: .configured, detail: PetL10n.text("Setup is ready. Use a new Codex session in a registered working folder.", korean: "설정이 준비됐습니다. 등록한 작업 폴더의 새 Codex 세션에서 사용하세요."),
                              sessionEvidence: connectionReadiness.status == .receiving ? .receivingCards : .notObserved)
            }
        }

        let claude: PetConnectionSetupProviderState
        if let inspection = claudeConnection.inspection {
            if !supportsClaudeConnectionSetup {
                claude = .init(status: .needsAction, detail: PetL10n.text("Prepare the Claude connection using Blabee installed in Applications.", korean: "응용 프로그램 폴더에 설치된 Blabee에서 Claude 연결을 준비해 주세요."))
            } else if inspection.automaticConnectionReady {
                if hasVerifiedServiceConnection && !hasVerifiedClaudeDirectory {
                    claude = .init(status: .needsAction, detail: PetL10n.text("The Claude connection has not been checked yet. Please check again.", korean: "Claude 연결 상태를 아직 확인하지 못했습니다. 다시 확인해 주세요."))
                } else {
                    claude = .init(status: .configured,
                        detail: PetL10n.text("Setup is ready. Run claude in a new terminal and review sign-in, project trust, and MCP connection approval requests.", korean: "설정이 준비됐습니다. 새 터미널에서 claude를 실행하고 로그인·프로젝트 신뢰·MCP 연결 승인 요청을 확인해 주세요."),
                        sessionEvidence: observedClaudeSessionEvidence)
                }
            } else if inspection.canEnable {
                claude = .init(status: .available, detail: PetL10n.text("Choose Connect to set up automatic connection when running claude in a new zsh terminal.", korean: "연결하기를 누르면 새 zsh 터미널에서 평소 claude 명령으로 연결되도록 설정합니다."))
            } else {
                claude = .init(status: inspection.issue == .executableUnavailable ? .needsInstall : .needsAction,
                               detail: inspection.detail)
            }
        } else {
            claude = .init(status: .checking, detail: PetL10n.text("Check your Claude environment.", korean: "Claude 사용 환경을 확인해 주세요."))
        }
        let states: [PetConnectionSetupProvider: PetConnectionSetupProviderState] = [.codex: codex, .claude: claude]
        let detected = Set(states.compactMap { provider, state in
            state.status == .available || state.status == .configured ? provider : nil
        })
        return .init(serviceReady: hasVerifiedServiceConnection, providers: states, recommendedProviders: detected,
                     serviceIssue: observedAppOwnedServiceIssue)
    }

    private func publishConnectionSetupObservation() {
        connectionSetup.receiveObservation(currentConnectionSetupInspection())
    }

    private func inspectConnectionSetup() async throws -> PetConnectionSetupInspection {
        let continuation = codexSetupContinuationID
        try requireCurrentSetupContinuation(continuation)
        await refreshOnboarding()
        try requireCurrentSetupContinuation(continuation)
        await refreshCodexPluginSetup()
        try requireCurrentSetupContinuation(continuation)
        await claudeConnection.refresh()
        try requireCurrentSetupContinuation(continuation)
        if canInspectCodexHooks { await inspectCodexHooks() }
        try requireCurrentSetupContinuation(continuation)
        await refreshConnectionSetupSnapshot()
        try requireCurrentSetupContinuation(continuation)
        return currentConnectionSetupInspection()
    }

    private func refreshConnectionSetupSnapshot() async {
        if firstRunSetupActive { await refreshFirstRunSetup(inspectSettings: false) }
        else { await refresh() }
    }

    private func prepareConnectionSetup() async throws {
        let continuation = codexSetupContinuationID
        try requireCurrentSetupContinuation(continuation)
        // Only an app-owned service can receive the account credential through
        // its private bootstrap. Never fall back to a newly registered agent.
        guard let appService else {
            throw PetClaudeConnectionController.Failure(detail: PetL10n.text("Prepare the connection using Blabee in Applications.", korean: "응용 프로그램 폴더의 Blabee에서 연결을 준비해 주세요."))
        }
        switch onboardingServiceState {
        case .notRegistered, .notFound: break
        case .enabled, .requiresApproval, .unknown:
            throw PetClaudeConnectionController.Failure(detail: legacyServiceMigrationDetail)
        }
        // Initialize only a missing Codex scope before the first service launch.
        // A saved empty scope is intentional and must not expand on reconnect.
        // Claude uses the cwd of a later user-started session and needs no Codex root.
        if connectionSetup.selectedProviders.contains(.codex),
           connectionSetup.states[.codex]?.status == .available {
            if let issue = codexProjectScopeIssue {
                throw PetClaudeConnectionController.Failure(detail: issue)
            }
            if !configuredProjectScopeExists {
                await performOnboardingOperation(.project) {
                    do {
                        try onboardingAdapter.initializeDefaultProjectScopeIfMissing()
                        reloadOnboardingState()
                    } catch {
                        connectionSetupProjectIssue = PetL10n.text("Unable to save the default working folder. Check the folders in advanced settings and try again.", korean: "기본 작업 폴더를 저장하지 못했습니다. 고급 설정에서 폴더를 확인한 뒤 다시 시도해 주세요.")
                        reloadOnboardingState(operationError: String(describing: error))
                    }
                    acceptOwnSetupPrerequisiteChange(continuation)
                }
            }
            try requireCurrentSetupContinuation(continuation)
            guard configuredProjectScopeExists, configuredProjectPathsAreAuthoritative,
                  !configuredProjectPaths.isEmpty, connectionSetupProjectIssue == nil else {
                throw PetClaudeConnectionController.Failure(detail: codexProjectScopeIssue
                    ?? PetL10n.text("The working folder was not saved. Please check again.", korean: "작업 폴더가 저장되지 않았습니다. 다시 확인해 주세요."))
            }
        }
        try requireCurrentSetupContinuation(continuation)
        if appService.state == .disabled {
            await performOnboardingOperation(.service) {
                appService.enable()
                reloadOnboardingState()
                acceptOwnSetupPrerequisiteChange(continuation)
            }
        } else if appService.state == .stopped {
            appService.startAtAppLaunch()
            acceptOwnSetupPrerequisiteChange(continuation)
        }
        let generation = appService.generation
        for attempt in 0..<connectionSetupPollLimit {
            try requireCurrentSetupContinuation(continuation)
            guard !isShuttingDown, generation == appService.generation else { throw CancellationError() }
            await refreshConnectionSetupSnapshot()
            try requireCurrentSetupContinuation(continuation)
            guard !isShuttingDown, generation == appService.generation else { throw CancellationError() }
            if hasVerifiedServiceConnection { return }
            switch appService.state {
            case .starting, .reconnecting, .ready: break
            default: throw PetClaudeConnectionController.Failure(detail: appService.state.detail)
            }
            if attempt + 1 < connectionSetupPollLimit {
                try await Task.sleep(nanoseconds: connectionSetupPollIntervalNanoseconds)
            }
        }
        throw PetClaudeConnectionController.Failure(detail: PetL10n.text("Unable to confirm a service response. Try reconnecting shortly or check service status in advanced settings.", korean: "서비스 응답을 확인하지 못했습니다. 잠시 뒤 다시 연결하거나 고급 설정에서 서비스 상태를 확인해 주세요."), reason: .serviceTimeout)
    }

    private func configureConnectionProvider(_ provider: PetConnectionSetupProvider) async throws {
        let continuation = codexSetupContinuationID
        try requireCurrentSetupContinuation(continuation)
        let errorContext = errorDiagnostics?.captureContext()
        switch provider {
        case .codex:
            if let connectionSetupProjectIssue {
                recordConnectionDiagnostic(.init(provider: .codex, stage: .configuration, reason: .settingsWriteFailed), context: errorContext)
                throw PetClaudeConnectionController.Failure(detail: connectionSetupProjectIssue)
            }
            if canConfigureCodexPlugin {
                await performOnboardingOperation(.codexPlugin) {
                    let state = await codexPluginSetupManager.connect()
                    guard (try? requireCurrentSetupContinuation(continuation)) != nil else { return }
                    codexPluginSetupState = state
                    clearLegacyCodexPluginMigrationConfirmation()
                }
                try requireCurrentSetupContinuation(continuation)
                recordConnectionDiagnostic(.codex(codexPluginSetupState, stage: .configuration), context: errorContext)
            }
            if canInspectCodexHooks { await inspectCodexHooks() }
            try requireCurrentSetupContinuation(continuation)
        case .claude:
            _ = try await claudeConnection.configureAutomaticConnection()
        }
    }

    var canCheckCodexHooks: Bool {
        canInspectCodexHooks && !connectionSetup.isWorking
            && !isContinuingCodexConnectionSetup && !isCheckingConnectionSetupAfterReturn
    }

    private var canInspectCodexHooks: Bool {
        guard !isShuttingDown, !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight,
              !isCheckingConnectionSetupAfterReturn,
              !isStorageRecoveryOperationInFlight, hookReadinessProjectPath != nil,
              case .installedNeedsHookReview = codexPluginSetupState else { return false }
        return true
    }

    func selectHookProject(_ path: String) {
        guard hookReadinessProjectPaths.contains(path), path != hookReadinessProjectPath else { return }
        connectionSetupScopeGeneration &+= 1
        selectedHookProjectPath = path
        invalidateHookReadiness()
    }

    private func invalidateHookReadiness() {
        hookCheckGeneration = UUID()
        checkedHookProjectPath = nil
        rawCodexHookReadiness = .unchecked
    }

    func checkCodexHooks() async {
        guard canCheckCodexHooks else { return }
        await inspectCodexHooks()
        publishConnectionSetupObservation()
    }

    private func inspectCodexHooks() async {
        guard canInspectCodexHooks, let path = hookReadinessProjectPath else { return }
        let context = captureConnectionSetupContext()
        let errorContext = errorDiagnostics?.captureContext()
        let generation = UUID()
        hookCheckGeneration = generation
        isCodexHookCheckInFlight = true
        checkedHookProjectPath = path
        rawCodexHookReadiness = .checking
        defer { isCodexHookCheckInFlight = false }
        let result = await hookReadinessManager.inspect(projectURL: URL(fileURLWithPath: path))
        guard hookCheckGeneration == generation, path == hookReadinessProjectPath,
              acceptsConnectionSetupContext(context),
              !isShuttingDown, !Task.isCancelled else {
            if hookCheckGeneration == generation { invalidateHookReadiness() }
            return
        }
        rawCodexHookReadiness = result
        if case .unavailable(let code) = result {
            recordConnectionDiagnostic(.codex(.error(code: code), stage: .hookCheck), context: errorContext)
        } else if result == .reviewRequired {
            recordConnectionDiagnostic(.init(provider: .codex, stage: .hookCheck, reason: .hookUntrusted), context: errorContext)
        }
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
        (snapshot ?? firstRunSetupSnapshot)?.codexSettingsEvidence?.activeProjectPaths ?? []
    }

    /// A normal disabled/stopped service can be prepared during onboarding.
    /// Actual failures need their own action and must not be hidden by the
    /// independently discovered installation state of either tool.
    private var observedAppOwnedServiceIssue: String? {
        guard isAppOwnedServiceEnabled else { return nil }
        switch appOwnedServiceState {
        case .failed, .blocked, .unresponsive: return appOwnedServiceDetail
        default: return nil
        }
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
        if let observedAppOwnedServiceIssue {
            serviceIssue = observedAppOwnedServiceIssue
        } else if coordinatorTransportError != nil, !transitioning {
            serviceIssue = PetL10n.text("Unable to confirm a service response. Reconnect in service settings.", korean: "서비스 응답을 확인하지 못했습니다. 서비스 설정에서 다시 연결해 주세요.")
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
            activeProjectPaths: connected
                ? (snapshot ?? firstRunSetupSnapshot)?.codexSettingsEvidence?.activeProjectPaths : nil,
            receivedCardProjectPaths: connected ? connectionReceivedCardProjectPaths : [],
            hookReadiness: codexHookReadiness,
            hookProjectPath: hookReadinessProjectPath
        )
    }

    var connectionNextStepTitle: String {
        if connectionReadiness.nextStep == .restartService,
           !isAppOwnedServiceEnabled || !canChangeAppOwnedService {
            return PetL10n.text("How to apply projects", korean: "프로젝트 적용 방법")
        }
        return connectionReadiness.nextStepTitle
    }

    var hasVerifiedServiceConnection: Bool {
        connectionSetupSnapshot?.hasVerifiedServiceResponse == true && coordinatorTransportError == nil
            && (!isAppOwnedServiceEnabled || appOwnedServiceState == .ready)
    }

    var projectSettingsNeedRestart: Bool {
        guard hasVerifiedServiceConnection, configuredProjectPathsAreAuthoritative,
              let active = (snapshot ?? firstRunSetupSnapshot)?.codexSettingsEvidence?.activeProjectPaths else {
            return false
        }
        return Set(configuredProjectPaths) != active
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
            || connectionSetup.isWorking || claudeConnection.isWorking || isStartingClaude
            || isContinuingCodexConnectionSetup || isCheckingConnectionSetupAfterReturn
    }

    private var isOnboardingConfigurationOperationInFlight: Bool {
        isOnboardingServiceOperationInFlight || isOnboardingProjectOperationInFlight
            || isStorageRecoveryOperationInFlight
    }

    // The legacy agent has no app-owned credential channel and cannot acquire
    // product access. Keep this gate for stale action callbacks, never opt in.
    var canRegisterOnboardingService: Bool { false }

    var needsAppOwnedServiceRestartAfterLegacyCleanup: Bool {
        isAppOwnedServiceEnabled && appOwnedServiceState == .blocked
            && appService?.hasOwnedChild == false
            && (onboardingServiceState == .notRegistered || onboardingServiceState == .notFound)
    }

    var appOwnedServiceTitle: String {
        needsAppOwnedServiceRestartAfterLegacyCleanup ? PetL10n.text("Service restart required", korean: "서비스 다시 시작 필요") : appOwnedServiceState.title
    }

    var appOwnedServiceDetail: String {
        needsAppOwnedServiceRestartAfterLegacyCleanup
            ? PetL10n.text("The previous service is unregistered. Choose Restart Service to reconnect Blabee.", korean: "이전 서비스 등록이 해제된 상태입니다. ‘서비스 다시 시작’을 눌러 Blabee 연결을 이어가세요.")
            : appOwnedServiceState.detail
    }

    var showsLegacyServiceSettings: Bool {
        switch onboardingServiceState {
        case .enabled, .requiresApproval, .unknown: true
        case .notRegistered, .notFound: false
        }
    }

    var legacyServiceMigrationDetail: String {
        switch onboardingServiceState {
        case .enabled, .requiresApproval:
            let next = isAppOwnedServiceEnabled ? PetL10n.text("Restart Service", korean: "서비스 다시 시작") : PetL10n.text("Enable App-Owned Service", korean: "앱 실행형 서비스 켜기")
            return PetL10n.text("The previous auto-start registration is still present. Finish active Blabee selections, choose Unregister, then choose \(next).", korean: "이전 자동 시작 방식의 등록이 남아 있습니다. 진행 중인 Blabee 선택을 마친 뒤 ‘등록 해제’를 누르고 ‘\(next)’를 선택해 주세요.")
        case .unknown:
            return PetL10n.text("Unable to verify the previous service registration. Check its status again before connecting.", korean: "이전 서비스 등록 상태를 확인하지 못했습니다. 상태를 다시 확인한 뒤 연결을 준비해 주세요.")
        case .notRegistered, .notFound:
            return ""
        }
    }

    var canUnregisterOnboardingService: Bool {
        (onboardingServiceState == .enabled
            || onboardingServiceState == .requiresApproval)
            && !isOnboardingConfigurationOperationInFlight
            && !connectionSetup.isWorking && !claudeConnection.isWorking
            && !isContinuingCodexConnectionSetup && !isCheckingConnectionSetupAfterReturn
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
        guard configuredProjectPathsAreAuthoritative, !connectionSetup.isWorking,
              !claudeConnection.isWorking, !isContinuingCodexConnectionSetup,
              !isCheckingConnectionSetupAfterReturn else { return false }
        if isAppOwnedServiceAvailable, onboardingServiceState == .notFound {
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
        canConfigureCodexPlugin && !connectionSetup.isWorking && !claudeConnection.isWorking
            && !isContinuingCodexConnectionSetup && !isCheckingConnectionSetupAfterReturn
    }

    var codexConnectionRecovery: PetCodexConnectionRecovery? {
        activeCodexConnectionRecovery ?? PetCodexConnectionRecovery(state: codexPluginSetupState)
    }

    var canRetryCodexPluginConnection: Bool {
        !isShuttingDown && !isOnboardingOperationInFlight
            && !connectionSetup.isWorking && !claudeConnection.isWorking
            && codexConnectionRecovery != nil
    }

    private var canConfigureCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight else { return false }
        return switch codexPluginSetupState {
        case .unchecked, .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable: true
        case .unavailable, .installedNeedsHookReview, .legacyInstallationDetected, .conflict, .error: false
        }
    }

    var canDisconnectCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight,
              !connectionSetup.isWorking, !claudeConnection.isWorking,
              !isContinuingCodexConnectionSetup, !isCheckingConnectionSetupAfterReturn else { return false }
        return switch codexPluginSetupState {
        case .marketplaceInstalledNeedsPlugin, .installedNeedsHookReview, .updateAvailable: true
        case .unchecked, .unavailable, .notInstalled, .legacyInstallationDetected, .conflict, .error: false
        }
    }

    var canMigrateLegacyCodexPlugin: Bool {
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight,
              !connectionSetup.isWorking, !claudeConnection.isWorking,
              !isContinuingCodexConnectionSetup, !isCheckingConnectionSetupAfterReturn else { return false }
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
        if selectedSettingsTab != tab { cancelConnectionSetup() }
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
        cancelConnectionSetup()
        cancelStorageRecovery()
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        selectedSettingsTab = .general
        isShowingOnboarding = false
    }

    var appVersionDisplay: String {
        appUpdateChecker.currentVersion?.displayLabel ?? PetL10n.text("Unable to verify", korean: "확인할 수 없음")
    }

    var isCheckingForAppUpdate: Bool { appUpdateState.isChecking }

    func showAppUpdateWindow(_ release: PetAppUpdateRelease?) {
        onAppUpdateRequested?(release)
    }

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

    func showAccessSettings(diagnostics: Bool = false) {
        cancelShortcutSettings()
        clearLegacyCodexPluginMigrationConfirmation()
        cancelLegacyShellCleanup()
        selectedSettingsTab = .general
        isShowingOnboarding = true
        setExpanded(true)
        accessDiagnosticsRequestID = diagnostics ? UUID() : nil
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

    func setFeedbackInputActive(_ active: Bool) {
        guard isFeedbackInputActive != active else { return }
        isFeedbackInputActive = active
        if active { endChoicePreview() }
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
            appUpdateState = .unavailable(PetL10n.text("Unable to open the release page. Check your default browser settings and try again.", korean: "릴리스 페이지를 열지 못했습니다. 기본 브라우저 설정을 확인한 뒤 다시 시도해 주세요."))
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
        await claudeConnection.refresh()
        // First-run readiness must stay read-only and must not claim cards or
        // install the normal Pet consumer heartbeat before setup completes.
        if supportsProviderSessions, !firstRunSetupActive {
            await fetchAndApplySnapshot()
        }
    }

    func beginFirstRunSetup() {
        guard !firstRunSetupActive else { return }
        firstRunSetupActive = true
        firstRunSetupGeneration = UUID()
        firstRunRefreshToken = nil
    }

    func endFirstRunSetup() {
        cancelConnectionSetup()
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
        defer {
            if firstRunRefreshToken == token { firstRunRefreshToken = nil }
            if firstRunSetupActive, firstRunSetupGeneration == setupGeneration {
                updateClaudeConnection()
                publishConnectionSetupObservation()
            }
        }
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
        nextSnapshotRequest &+= 1
        let requestNumber = nextSnapshotRequest
        do {
            let data = try await transport.request(type: "get_state", payload: Data("{}".utf8), expectedContext: nil)
            guard acceptsProviderObservation(context) else { return }
            let parsed = try await transport.decodeSnapshot(data)
            guard acceptsProviderObservation(context), firstRunSetupActive, firstRunSetupGeneration == setupGeneration,
                  !isShuttingDown, !Task.isCancelled,
                  requestNumber >= lastAppliedSnapshotRequest,
                  generation.map({ appService?.acceptsSnapshot(generation: $0) == true }) ?? true
            else { return }
            guard parsed.hasVerifiedServiceResponse else {
                throw PetModelError.invalid("first_run_service_response_unverified")
            }
            if let generation { appService?.receivedVerifiedSnapshot(generation: generation) }
            lastAppliedSnapshotRequest = requestNumber
            firstRunSetupSnapshot = parsed
            coordinatorTransportError = nil
        } catch {
            guard acceptsProviderObservation(context), firstRunSetupActive, firstRunSetupGeneration == setupGeneration,
                  !isShuttingDown, !Task.isCancelled,
                  requestNumber >= lastAppliedSnapshotRequest,
                  generation == appService?.generation else { return }
            lastAppliedSnapshotRequest = requestNumber
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
        guard !isCheckingConnectionSetupAfterReturn else { return }
        invalidateHookReadiness()
        guard !isCodexPluginOperationInFlight else {
            codexPluginRefreshRequested = true
            return
        }
        let continuation = codexSetupContinuationID
        await performOnboardingOperation(.codexPlugin) {
            let errorContext = errorDiagnostics?.captureContext()
            let state = await codexPluginSetupManager.inspect()
            guard (try? requireCurrentSetupContinuation(continuation)) != nil else { return }
            codexPluginSetupState = state
            recordConnectionDiagnostic(.codex(codexPluginSetupState, stage: .inspection), context: errorContext)
            clearLegacyCodexPluginMigrationConfirmation()
        }
    }

    func recheckCodexNativeExecutable() async {
        guard !isContinuingCodexConnectionSetup, !isCheckingConnectionSetupAfterReturn else { return }
        await runCodexNativeRecheck(connectWhenReady: false)
    }

    /// Explicit setup action only. Passive refreshes and delivery recovery never
    /// install Plugins, clear a native failure guard, or resend selected work.
    func retryCodexPluginConnection() async {
        guard canRetryCodexPluginConnection else { return }
        activeCodexConnectionRecovery = codexConnectionRecovery
        defer { activeCodexConnectionRecovery = nil }
        await runCodexNativeRecheck(connectWhenReady: true)
    }

    private func runCodexNativeRecheck(connectWhenReady: Bool, requestIsCurrent: (() -> Bool)? = nil) async {
        // Explicit retries are never queued behind another Plugin operation.
        guard !isCodexPluginOperationInFlight, !isCodexHookCheckInFlight else { return }
        defer {
            if !Task.isCancelled, !isShuttingDown, requestIsCurrent?() != false {
                publishConnectionSetupObservation()
            }
        }
        let deliveryNoticeID = selectionDeliveryNotice?.id
        let deliveryContext = selectionDeliveryNoticeContext
        await performOnboardingOperation(.codexPlugin) {
            let errorContext = errorDiagnostics?.captureContext()
            let insightContext = usageAnalytics?.captureContext()
            var report = CodexPluginRecheckReport()
            let startedUptime = DispatchTime.now().uptimeNanoseconds
            codexNativeRecheckReport = report
            let result = await codexPluginSetupManager.recheckNativeExecutableWithReport()
            guard !Task.isCancelled, !isShuttingDown, requestIsCurrent?() != false else { return }
            report.completedAt = Date()
            let finishedUptime = DispatchTime.now().uptimeNanoseconds
            report.elapsedSeconds = Double(finishedUptime - startedUptime) / 1_000_000_000
            report.result = result
            codexPluginSetupState = result.state
            codexNativeRecheckReport = report
            if let deliveryNoticeID, let deliveryContext,
               acceptsProviderAction(deliveryContext),
               selectionDeliveryNotice?.id == deliveryNoticeID {
                let succeeded: Bool = switch result.state {
                case .installedNeedsHookReview, .updateAvailable: true
                default: false
                }
                selectionDeliveryNotice?.nativeRecheckSucceeded = succeeded
                selectionDeliveryNotice?.nativeRecheckFailed = !succeeded
            }
            clearLegacyCodexPluginMigrationConfirmation()
            recordConnectionDiagnostic(.codex(result.state, stage: .nativeExecutable,
                version: result.evidence.codexVersion ?? "unknown"), context: errorContext)
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
            // Keep the fresh check and optional connect under one operation
            // guard, so repeated clicks cannot queue duplicate installations.
            // Only these verified setup states can need a Plugin write.
            if connectWhenReady, !Task.isCancelled, !isShuttingDown {
                switch result.state {
                case .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable:
                    codexPluginSetupState = await codexPluginSetupManager.connect()
                    recordConnectionDiagnostic(.codex(codexPluginSetupState, stage: .configuration),
                                               context: errorContext)
                    switch codexPluginSetupState {
                    case .error, .unavailable, .conflict:
                        // Coalesce refresh clicks made during this attempt. A
                        // passive inspection must not erase the write failure
                        // with an earlier/partial "not installed" observation.
                        codexPluginRefreshRequested = false
                    default:
                        break
                    }
                default:
                    break
                }
            }
        }
    }

    func recheckSelectionDeliveryCodex(noticeID: UUID) async {
        guard selectionDeliveryNotice?.id == noticeID,
              selectionDeliveryNotice?.requiresCodexRecheck == true,
              selectionDeliveryNotice?.nativeRecheckSucceeded == false,
              let context = selectionDeliveryNoticeContext, acceptsProviderAction(context)
        else { return }
        await recheckCodexNativeExecutable()
    }

    func dismissSelectionDeliveryNotice(noticeID: UUID) {
        guard selectionDeliveryNotice?.id == noticeID else { return }
        clearSelectionDeliveryNotice()
    }

    private func clearSelectionDeliveryNotice() {
        if selectionDeliveryNotice != nil { selectionDeliveryNotice = nil }
        selectionDeliveryNoticeContext = nil
        selectionDeliveryNoticeAwaitingSnapshotRecovery = false
    }

    private func selectionDeliveryNoticeOwnerIsCurrent(_ context: ProviderActionContext) -> Bool {
        !isShuttingDown && productAccessAllowsActions
            && context.serviceGeneration == appService?.generation
            && context.accessGeneration == productAccess?.actionGeneration
            && selectionDeliveryNotice?.provider == provider
    }

    private func retainSelectionDeliveryNoticeDuringSnapshotFailure() {
        guard let context = selectionDeliveryNoticeContext,
              selectionDeliveryNoticeOwnerIsCurrent(context),
              selectionDeliveryNoticeAwaitingSnapshotRecovery || acceptsProviderAction(context) else { return }
        selectionDeliveryNoticeAwaitingSnapshotRecovery = true
    }

    private func selectionDisplayMatches(_ identity: PetInteractionIdentity) -> Bool {
        // A consumed card may disappear before its response arrives. Preserve
        // the notice on an empty panel, but never attach it to another card.
        guard let event = displayedEvent else { return true }
        guard case .decision(let interaction) = event else { return false }
        return interaction.identity == identity
    }

    private func acceptsSelectionCompletion(_ operation: SelectionOperation) -> Bool {
        !selectionCompletionInvalidated && activeSelectionOperation?.id == operation.id
            && acceptsProviderAction(operation.context)
            && selectionDisplayMatches(operation.submission.identity)
    }

    private func invalidateSelectionOperation() {
        guard let operation = activeSelectionOperation else { return }
        activeSelectionOperation = nil
        selectionCompletionInvalidated = false
        if inFlightSelectionIdentity == operation.submission.identity { inFlightSelectionIdentity = nil }
        if selectionSubmission == operation.submission { selectionSubmission = nil }
    }

    private func reconcileSelectionDeliveryState() {
        if let operation = activeSelectionOperation {
            if !acceptsProviderAction(operation.context) {
                invalidateSelectionOperation()
            } else if !selectionDisplayMatches(operation.submission.identity) {
                // Retain the physical single-flight reservation until the I/O
                // settles, but fence its result even if this card reappears.
                selectionCompletionInvalidated = true
            }
        }
        if let notice = selectionDeliveryNotice,
           selectionDeliveryNoticeContext.map({
               !selectionDeliveryNoticeOwnerIsCurrent($0)
                   || (!selectionDeliveryNoticeAwaitingSnapshotRecovery && !acceptsProviderAction($0))
           }) != false
                || (displayInteraction.map { $0.identity.binding.sessionID != notice.identity.binding.sessionID } ?? false) {
            clearSelectionDeliveryNotice()
        }
    }

    func connectCodexPlugin() async {
        guard canConnectCodexPlugin else { return }
        await performOnboardingOperation(.codexPlugin) {
            let errorContext = errorDiagnostics?.captureContext()
            codexPluginSetupState = await codexPluginSetupManager.connect()
            recordConnectionDiagnostic(.codex(codexPluginSetupState, stage: .configuration), context: errorContext)
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

    private func recordConnectionDiagnostic(_ diagnostic: PetConnectionDiagnostic?, context: PetErrorContext?) {
        guard !isShuttingDown, !Task.isCancelled, let diagnostic, let context else { return }
        errorDiagnostics?.record(connection: diagnostic, context: context)
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
        // Retained as a fail-closed endpoint for an already captured UI action.
        // Starting an app-owned service remains a separate explicit action.
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
            shortcutSettingsError = PetL10n.text("The shortcut registrar is not ready.", korean: "단축키 등록기가 준비되지 않았습니다.")
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
        guard choice.enabled, choice.isAction, interaction.isSelectionReady else { return PetL10n.text("Unavailable", korean: "사용 불가") }
        if requiresRiskConfirmation(interaction: interaction, slot: choice.slot) {
            return PetL10n.text("Check Pet", korean: "Pet 확인")
        }
        guard let intent = PetShortcutIntent.slot(choice.slot),
              let status = hotKeyRegistry?.statuses[intent]
        else { return PetL10n.text("Unavailable", korean: "사용 불가") }
        return switch status {
        case .registered:
            shortcutLabel(for: intent)
        case .internalCollision, .systemCollision:
            PetL10n.text("Conflict", korean: "충돌")
        case .registrationFailure:
            PetL10n.text("Registration failed", korean: "등록 실패")
        case .inactive:
            PetL10n.text("Unavailable", korean: "사용 불가")
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
        guard let status = hotKeyRegistry?.statuses[intent] else { return PetL10n.text("Preparing registrar", korean: "등록기 준비 중") }
        return switch status {
        case .registered: PetL10n.text("Registered", korean: "등록됨")
        case .inactive:
            intent == .toggle ? PetL10n.text("Inactive", korean: "비활성") : PetL10n.text("Not currently registered", korean: "현재 등록 대상 아님")
        case .internalCollision: PetL10n.text("Conflicting settings", korean: "설정 내부 충돌")
        case .systemCollision: PetL10n.text("macOS shortcut conflict", korean: "macOS 단축키 충돌")
        case .registrationFailure(let status):
            if let status { PetL10n.text("Registration failed (\(status))", korean: "등록 실패 (\(status))") } else { PetL10n.text("Registration failed", korean: "등록 실패") }
        }
    }

    func shortcutDraftStatusDescription(for intent: PetShortcutIntent) -> String {
        guard shortcutDraft.shortcut(for: intent) == shortcutConfiguration.shortcut(for: intent)
        else { return PetL10n.text("Not saved", korean: "저장 전") }
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
        invalidateSelectionOperation()
        clearSelectionDeliveryNotice()
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
        guard productAccessAllowsActions, !isFeedbackInputActive, let slot = intent.slot else { return }
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
        guard isPanelVisible, !isShuttingDown, !isFeedbackInputActive,
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
        let diagnostic: String?
        if isFeedbackInputActive, approvalHead != nil {
            diagnostic = PetL10n.text("Approval shortcuts are paused while you work in the feedback window. Switch to another window to use them again.", korean: "피드백 창에서 작업 중에는 승인 단축키가 잠시 꺼져요. 다른 창으로 전환하면 다시 사용할 수 있어요.")
        } else {
            diagnostic = shortcutApprovalHead == nil ? nil : hotKeyRegistry?.approvalShortcutDiagnostic
        }
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
        return PetL10n.text("Press \(previewShortcutLabel(for: slot)) to see details. Release \(previewHoldKeyName) to close.", korean: "\(previewShortcutLabel(for: slot))를 누르면 자세히 볼 수 있습니다. \(previewHoldKeyName) 키를 떼면 닫힙니다.")
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
        guard !isShuttingDown, !isEditingShortcuts, !isShowingOnboarding, !isFeedbackInputActive,
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
        guard isPanelVisible, canNavigateEvents else { return nil }
        if snapshot?.providerInbox != nil {
            guard let entry = displayedInboxEntry,
                  let data = try? StrictJSONTransport.data(forJSONObject: entry.context.target) else { return nil }
            return "inbox:" + String(providerGeneration) + ":" + data.base64EncodedString() + ":" + entry.id.data.base64EncodedString()
        }
        guard let navigation = snapshot?.eventNavigation,
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
        clearSelectionDeliveryNotice()
        if let entries = snapshot?.providerInbox?.entries, !entries.isEmpty {
            await focusInboxEntry(entries[(position - 1 + offset + entries.count) % entries.count])
            return
        }
        let events = eventQueue
        let index = (position - 1 + offset + events.count) % events.count
        await focusEvent(events[index])
    }

    /// Navigation sends only exact focus authority. No approval, selection,
    /// prompt delivery or dismissal can occur along this path.
    @discardableResult
    private func focusEvent(_ event: PetQueuedEvent) async -> Bool {
        guard productAccessAllowsActions, provider == .codex, snapshot?.eventNavigation != nil, pendingEventFocus == nil,
              pendingFocusIdentity == nil, inFlightDismissalIdentity == nil,
              inFlightSelectionIdentity == nil, inFlightPermissionRequestID == nil,
              inFlightManagedCommandApprovalID == nil, !eventDeliveryPending,
              riskConfirmation == nil, !isShuttingDown,
              let target = try? event.focusTarget(),
              (try? snapshot?.event(reference: target.reference)?.focusTarget()) == target
        else { return false }
        let actionContext = captureProviderActionContext()
        let retryTarget = FocusRetryTarget(event: event, target: target)
        guard !hasFocusRequestInFlight(retryTarget, context: actionContext) else { return false }
        if selectedEventReference == nil { selectedEventReference = displayedEvent?.reference }
        let operation = EventFocusOperation(target: target, retryTarget: retryTarget,
            displayedReference: selectedEventReference, context: actionContext)
        activeEventFocusOperation = operation
        focusRequestsInFlight.append(FocusRequestReservation(operationID: operation.id,
            target: operation.retryTarget, context: actionContext))
        pendingEventFocus = target
        endChoicePreview()
        updateHotKeyEligibility()
        lastError = persistentApprovalResolutionError
        defer {
            focusRequestsInFlight.removeAll { $0.operationID == operation.id }
            if activeEventFocusOperation?.id == operation.id {
                activeEventFocusOperation = nil
                pendingEventFocus = nil
                updateHotKeyEligibility()
            }
        }
        do {
            let response = try await transport.request(type: "focus_event", payload: target.data,
                                                       expectedContext: actionContext.expectedContext)
            guard acceptsEventFocusCompletion(operation) else { return false }
            try PetTransportResponse.requireFocused(response)
            await fetchAndApplySnapshot(requestIsCurrent: { self.acceptsEventFocusCompletion(operation) })
            guard acceptsEventFocusCompletion(operation) else { return false }
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
            clearFocusFailure(operation.retryTarget, context: actionContext)
            lastTerminalPresentation = nil
            onPanelLayoutChanged?()
            onApprovalHeadChanged?(approvalHead?.identity)
            return true
        } catch {
            guard acceptsEventFocusCompletion(operation) else { return false }
            confirmedEventFocus = nil
            localForegroundIdentity = nil
            recordFocusFailure(operation.retryTarget, context: actionContext, operationID: operation.id)
            // Reconcile once after a lost/rejected reply. The old displayed
            // event stays visible; its authority must be acquired again.
            let focusError = String(describing: error)
            await fetchAndApplySnapshot(requestIsCurrent: { self.acceptsEventFocusCompletion(operation) })
            guard acceptsEventFocusCompletion(operation) else { return false }
            lastError = focusError
            return false
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

    func focus(_ identity: PetInteractionIdentity, automatically: Bool = false) async {
        if !automatically, let notice = selectionDeliveryNotice, notice.identity != identity {
            clearSelectionDeliveryNotice()
        }
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
            let acquired = await focusEvent(event)
            return acquired && acceptsProviderAction(actionContext)
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
              !hasFocusRequestInFlight(.interaction(identity), context: actionContext),
              pendingFocusIdentity == nil,
              inFlightSelectionIdentity == nil
        else { return false }
        if let previous = activeFocusOperation {
            finishFocusOperation(previous, succeeded: false)
        }
        let operation = FocusOperation(identity: identity, context: actionContext)
        activeFocusOperation = operation
        focusRequestsInFlight.append(FocusRequestReservation(operationID: operation.id,
            target: .interaction(identity), context: actionContext))
        var succeeded = false
        defer {
            focusRequestsInFlight.removeAll { $0.operationID == operation.id }
            finishFocusOperation(operation, succeeded: succeeded)
        }
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
            await fetchAndApplySnapshot(requestIsCurrent: { self.acceptsFocusCompletion(operation) })
            guard acceptsFocusCompletion(operation) else { return false }
            guard snapshot?.routing.foreground == identity,
                  displayInteraction?.identity == identity,
                  snapshot?.interaction(identity: identity)?.foreground == true else {
                pendingFocusIdentity = nil
                updateHotKeyEligibility()
                throw PetModelError.invalid("focus_snapshot_authority")
            }
            // A snapshot can reflect a request whose reply was lost. Only the
            // exact acknowledged operation may create local selection authority.
            localForegroundIdentity = identity
            pendingFocusIdentity = nil
            lastTerminalPresentation = nil
            clearFocusFailure(.interaction(identity), context: actionContext)
            updateHotKeyEligibility()
            succeeded = true
        } catch {
            guard acceptsFocusCompletion(operation) else { return false }
            pendingFocusIdentity = nil
            localForegroundIdentity = nil
            riskConfirmation = nil
            recordFocusFailure(.interaction(identity), context: actionContext, operationID: operation.id)
            lastError = String(describing: error)
            updateHotKeyEligibility()
            await fetchAndApplySnapshot(requestIsCurrent: { self.acceptsFocusCompletion(operation) })
        }
        return succeeded && acceptsFocusCompletion(operation)
    }

    func handleGlobalSlot(_ slot: Int) async {
        guard !isFeedbackInputActive, !choicePreviewHoldMonitor.suppressesSelection else { return }
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
            // A newer snapshot can arrive while the close is awaiting its
            // receipt. Reconcile only the card that this click was bound to.
            guard displayInteraction?.identity == displayedIdentity else { return }
            if localForegroundIdentity == displayedIdentity { localForegroundIdentity = nil }
            lastTerminalPresentation = nil
            await fetchAndApplySnapshot()
        } catch {
            guard acceptsProviderAction(actionContext),
                  displayInteraction?.identity == displayedIdentity else { return }
            usageAnalytics?.finishFeature(productOperation, outcome: productFailureOutcome(error))
            productFinished = true
            // A lost response can follow a committed dismissal. Reconcile from
            // the service and require another click; do not silently retry.
            recordDiagnostic(.suggestionDismissFailed, error: error, context: errorContext)
            if localForegroundIdentity == displayedIdentity { localForegroundIdentity = nil }
            let dismissalError = String(describing: error)
            await fetchAndApplySnapshot()
            guard acceptsProviderAction(actionContext),
                  displayInteraction?.identity == displayedIdentity else { return }
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
                lastError = PetL10n.text("Unable to open the app detected for the permission request.", korean: "권한 요청 때 감지한 앱을 열 수 없습니다.")
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
                lastError = PetL10n.text("Unable to open the app detected for the managed permission request.", korean: "관리형 권한 요청 때 감지한 앱을 열 수 없습니다.")
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

    private func fetchAndApplySnapshot(requestIsCurrent: (() -> Bool)? = nil) async {
        guard !isShuttingDown, requestIsCurrent?() != false else { return }
        defer { updateClaudeConnection(); publishConnectionSetupObservation() }
        appService?.checkChildBeforePolling()
        guard appService?.mayQueryCoordinator != false else { return }
        let serviceGeneration = appService?.generation
        let observationContext = captureProviderActionContext()
        nextSnapshotRequest &+= 1
        let requestNumber = nextSnapshotRequest
        let errorContext = errorDiagnostics?.captureContext()
        let productContext = usageAnalytics?.captureContext()
        var receivedResponse = false
        do {
            let payload = try PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
            let data = try await transport.request(type: "get_state", payload: payload, expectedContext: nil)
            // Service health must remain observable before login and during
            // suspension. Action-specific callers retain requestIsCurrent.
            guard acceptsProviderObservation(observationContext), requestIsCurrent?() != false else { return }
            receivedResponse = true
            let parsed = try await transport.decodeSnapshot(data)
            guard acceptsProviderObservation(observationContext),
                  requestIsCurrent?() != false,
                  requestNumber >= lastAppliedSnapshotRequest,
                  serviceGeneration.map({ appService?.acceptsSnapshot(generation: $0) == true }) ?? true
            else { return }
            lastAppliedSnapshotRequest = requestNumber
            if parsed.hasVerifiedServiceResponse {
                consecutiveSnapshotFailures = 0
                lastSnapshotDiagnosticContext = nil
                if let serviceGeneration {
                    appService?.receivedVerifiedSnapshot(generation: serviceGeneration)
                }
                if coordinatorTransportError != nil { coordinatorTransportError = nil }
            } else {
                if let serviceGeneration { appService?.connectionFailed(generation: serviceGeneration) }
                coordinatorTransportError = PetL10n.text("Rechecking the service response.", korean: "서비스 응답을 다시 확인하고 있습니다.")
            }
            apply(parsed)
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
            guard acceptsProviderObservation(observationContext),
                  requestIsCurrent?() != false,
                  requestNumber >= lastAppliedSnapshotRequest,
                  serviceGeneration == appService?.generation else { return }
            lastAppliedSnapshotRequest = requestNumber
            retainSelectionDeliveryNoticeDuringSnapshotFailure()
            if supportsProviderSessions, provider == .claude {
                // Keep the directory and other providers usable. A scoped
                // read failure does not diagnose the app-owned service.
                invalidateFocusOperation(recordFailure: true)
                invalidateEventFocusOperation(recordFailure: true)
                invalidateProviderInteractionState(
                    preservingSelectionDeliveryNotice: selectionDeliveryNoticeAwaitingSnapshotRecovery)
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
            let priorApprovalHeadIdentity = approvalHead?.identity
            invalidateFocusOperation(recordFailure: true)
            invalidateEventFocusOperation(recordFailure: true)
            invalidateInboxFocusOperation()
            if let serviceGeneration { appService?.connectionFailed(generation: serviceGeneration) }
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
            publishConnectionSetupObservation()
        }
        let restoresSelectionDeliveryNotice = selectionDeliveryNoticeAwaitingSnapshotRecovery
            && selectionDeliveryNoticeContext.map({
                selectionDeliveryNoticeOwnerIsCurrent($0)
                    && $0.expectedContext == newSnapshot.providerContext
            }) == true
        if newSnapshot.providerContext != snapshot?.providerContext {
            let inboxOperationID = isSwitchingProvider
                && activeInboxFocusOperation?.context == newSnapshot.providerContext
                ? activeInboxFocusOperation?.id : nil
            invalidateProviderInteractionState(preservingInboxOperation: inboxOperationID,
                preservingSelectionDeliveryNotice: restoresSelectionDeliveryNotice)
        }
        if providerReadFailed { providerReadFailed = false }
        if supportsProviderSessions {
            if providerSessions != newSnapshot.providerSessions { providerSessions = newSnapshot.providerSessions }
            if let context = newSnapshot.providerContext, provider != context.provider { provider = context.provider }
        }
        // Keep actual card reception visible after selection consumes the card.
        // This is in-memory observation, not saved sessions or a return receipt.
        // Connection loss/service transitions clear it; removed projects drop out.
        if let evidence = newSnapshot.codexSettingsEvidence {
            let receivedPaths = connectionReceivedCardProjectPaths.intersection(evidence.activeProjectPaths)
                .union(evidence.receivedCardProjectPaths)
            if connectionReceivedCardProjectPaths != receivedPaths {
                connectionReceivedCardProjectPaths = receivedPaths
            }
        }
        let priorApprovalHeadIdentity = approvalHead?.identity
        let previousEvent = displayedEvent
        let previousQueue = eventQueue
        let previousQueueCount = eventQueueCount
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
        if selectionDeliveryNoticeAwaitingSnapshotRecovery {
            if restoresSelectionDeliveryNotice {
                // Informational notice only. Never restore selection/focus
                // authority or allow an old request to publish its late result.
                selectionDeliveryNoticeContext = captureProviderActionContext()
                selectionDeliveryNoticeAwaitingSnapshotRecovery = false
            } else {
                clearSelectionDeliveryNotice()
            }
        }
        reconcileEventSelection(previousEvent: previousEvent, previousQueue: previousQueue)
        reconcileSelectionDeliveryState()
        // Fence an operation as soon as its intended display or immutable
        // target changes, even if a later snapshot returns to that same card.
        if let operation = activeFocusOperation, !acceptsFocusCompletion(operation) {
            invalidateFocusOperation()
            pendingFocusIdentity = nil
        }
        if let operation = activeEventFocusOperation, !acceptsEventFocusCompletion(operation) {
            invalidateEventFocusOperation()
        }
        if let operation = activeInboxFocusOperation,
           newSnapshot.providerInbox?.entries.contains(where: {
               $0.id == operation.identity && $0.context == operation.context
           }) != true {
            invalidateInboxFocusOperation()
        }
        if previousEvent?.reference != displayedEvent?.reference
            || previousQueueCount != eventQueueCount
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
            && displayInteraction?.identity == operation.identity
            && snapshot?.interaction(identity: operation.identity)?.isSelectionReady == true
    }

    private func acceptsEventFocusCompletion(_ operation: EventFocusOperation) -> Bool {
        activeEventFocusOperation?.id == operation.id
            && acceptsProviderAction(operation.context)
            && selectedEventReference == operation.displayedReference
            && (try? snapshot?.event(reference: operation.target.reference)?.focusTarget()) == operation.target
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

    private func invalidateFocusOperation(recordFailure: Bool = false) {
        if let operation = activeFocusOperation {
            if recordFailure {
                recordFocusFailure(.interaction(operation.identity), context: operation.context, operationID: operation.id)
            }
            finishFocusOperation(operation, succeeded: false)
        }
        autoFocusAttemptedIdentity = nil
        autoFocusAttemptToken = nil
    }

    private func invalidateEventFocusOperation(recordFailure: Bool = false) {
        if let operation = activeEventFocusOperation, recordFailure {
            recordFocusFailure(operation.retryTarget, context: operation.context, operationID: operation.id)
        }
        activeEventFocusOperation = nil
        if pendingEventFocus != nil { pendingEventFocus = nil }
        automaticEventFocusToken = nil
    }

    private func invalidateInboxFocusOperation() {
        activeInboxFocusOperation = nil
        if pendingInboxIdentity != nil { pendingInboxIdentity = nil }
    }

    private func mayAutomaticallyFocus(_ target: FocusRetryTarget, context: ProviderActionContext) -> Bool {
        guard !hasFocusRequestInFlight(target, context: context) else { return false }
        guard let failure = focusFailures.first(where: {
            $0.target == target && sameFocusRetryContext($0.context, context)
        }) else {
            return true
        }
        let now = focusRetryNow()
        return now >= failure.failedAt && now >= failure.retryAfter
    }

    private func hasFocusRequestInFlight(_ target: FocusRetryTarget, context: ProviderActionContext) -> Bool {
        focusRequestsInFlight.contains { $0.target == target && sameFocusRetryContext($0.context, context) }
    }

    private func sameFocusRetryContext(_ lhs: ProviderActionContext, _ rhs: ProviderActionContext) -> Bool {
        // providerGeneration is a local completion fence and also changes on a
        // failed read. A restored snapshot must not free the same physical
        // request's I/O slot or cooldown. The provider context includes service,
        // session, authority and UI generations; a real restart changes this key.
        lhs.serviceGeneration == rhs.serviceGeneration && lhs.expectedContext == rhs.expectedContext
    }

    private func recordFocusFailure(
        _ target: FocusRetryTarget, context: ProviderActionContext, operationID: UUID
    ) {
        let prior = focusFailures.first { $0.target == target && sameFocusRetryContext($0.context, context) }
        guard prior?.operationID != operationID else { return }
        let attempts = min(3, (prior?.attempts ?? 0) + 1)
        let now = focusRetryNow()
        let delay = UInt64(1 << attempts) * 1_000_000_000 // 2, 4, then 8 seconds.
        let deadline = now.addingReportingOverflow(delay)
        clearFocusFailure(target, context: context)
        // Only failure metadata is retained; this never caches authority or a
        // selection payload. Bound memory independently of queue size.
        if focusFailures.count >= 64 { focusFailures.removeFirst() }
        focusFailures.append(FocusFailure(operationID: operationID, target: target, context: context,
            attempts: attempts, failedAt: now, retryAfter: deadline.overflow ? UInt64.max : deadline.partialValue))
    }

    private func clearFocusFailure(_ target: FocusRetryTarget, context: ProviderActionContext) {
        focusFailures.removeAll { $0.target == target && sameFocusRetryContext($0.context, context) }
    }

    private func focusFIFOHeadIfNeeded() async {
        guard productAccessAllowsActions else { return }
        if let inbox = snapshot?.providerInbox {
            guard pendingInboxIdentity == nil, !isSwitchingProvider, !isShuttingDown,
                  selectionSubmission == nil, inFlightSelectionIdentity == nil, inFlightDismissalIdentity == nil,
                  inFlightPermissionRequestID == nil, inFlightManagedCommandApprovalID == nil,
                  pendingEventFocus == nil, pendingFocusIdentity == nil,
                  riskConfirmation == nil, choicePreview == nil, !choicePreviewHoldMonitor.suppressesSelection,
                  !eventDeliveryPending else { return }
            guard let target = inbox.entries.first(where: { $0.id == selectedInboxIdentity }) ?? inbox.entries.first else {
                selectedInboxIdentity = nil
                return
            }
            if displayedInboxEntry?.id != target.id || selectedInboxIdentity != target.id {
                await focusInboxEntry(target, automatically: true)
            } else {
                await focusProjectionHeadIfNeeded()
            }
            return
        }
        await focusProjectionHeadIfNeeded()
    }

    private func focusInboxEntry(_ entry: PetProviderInboxEntry, automatically: Bool = false) async {
        guard productAccessAllowsActions, pendingInboxIdentity == nil, !isShuttingDown,
              snapshot?.providerInbox?.entries.contains(entry) == true else { return }
        let operation = InboxFocusOperation(identity: entry.id, context: entry.context,
            serviceGeneration: appService?.generation)
        activeInboxFocusOperation = operation
        pendingInboxIdentity = entry.id
        selectedInboxIdentity = entry.id
        endChoicePreview()
        updateHotKeyEligibility()
        defer {
            if activeInboxFocusOperation?.id == operation.id {
                activeInboxFocusOperation = nil
                pendingInboxIdentity = nil
                updateHotKeyEligibility()
                onPanelLayoutChanged?()
            }
        }
        if selectedProviderContext != entry.context {
            await selectProviderSession(entry.session, preservingInboxOperation: operation.id)
        }
        guard productAccessAllowsActions, !isShuttingDown, activeInboxFocusOperation?.id == operation.id,
              appService?.generation == operation.serviceGeneration,
              pendingInboxIdentity == entry.id,
              selectedInboxIdentity == entry.id,
              let current = snapshot?.providerInbox?.entries.first(where: { $0.id == entry.id }),
              current.context == selectedProviderContext else { return }
        // A failed navigation can leave the desired inbox card different from
        // the displayed card. Polls must honor the same focus failure budget
        // on this path too, using the context adopted after a provider switch.
        // Explicit navigation still bypasses cooldown, never in-flight or
        // acknowledgment checks in focusEvent/acquireFocus.
        if snapshot?.eventNavigation != nil {
            if automatically {
                guard let target = try? current.event.focusTarget(),
                      mayAutomaticallyFocus(FocusRetryTarget(event: current.event, target: target),
                                            context: captureProviderActionContext())
                else { return }
            }
            await focusEvent(current.event)
        } else if case .decision(let interaction) = current.event {
            guard !automatically || mayAutomaticallyFocus(.interaction(interaction.identity),
                                                         context: captureProviderActionContext()) else { return }
            await focus(interaction.identity, automatically: automatically)
        }
    }

    private func focusProjectionHeadIfNeeded() async {
        let actionContext = captureProviderActionContext()
        guard providerAllowsSelection, pendingEventFocus == nil, automaticEventFocusToken == nil, !eventDeliveryPending,
              activeFocusOperation == nil, activeEventFocusOperation == nil,
              selectionSubmission == nil || selectedEventReference == nil,
              riskConfirmation == nil,
              inFlightPermissionRequestID == nil, inFlightManagedCommandApprovalID == nil else { return }
        if snapshot?.eventNavigation != nil, let event = displayedEvent,
           selectedEventReference != nil || !canActOnDisplayedEvent {
            guard let target = try? event.focusTarget(), target != confirmedEventFocus,
                  mayAutomaticallyFocus(FocusRetryTarget(event: event, target: target),
                                        context: actionContext) else { return }
            let attemptToken = UUID()
            automaticEventFocusToken = attemptToken
            await focusEvent(event)
            if automaticEventFocusToken == attemptToken {
                automaticEventFocusToken = nil
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
        guard autoFocusAttemptedIdentity != identity,
              mayAutomaticallyFocus(.interaction(identity), context: actionContext) else { return }
        let attemptToken = UUID()
        autoFocusAttemptedIdentity = identity
        autoFocusAttemptToken = attemptToken
        await focus(identity, automatically: true)
        if acceptsProviderAction(actionContext), autoFocusAttemptToken == attemptToken {
            // Keep the marker throughout focus()'s reconciliation fetch so a
            // transient failure cannot recurse or hot-loop. Once the attempt
            // settles, later polls still honor its separate failure cooldown
            // before re-evaluating authority for this exact FIFO head.
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
        guard productAccessAllowsActions, !choicePreviewHoldMonitor.suppressesSelection else { return }
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
        let operation = SelectionOperation(submission: submission,
            selectionID: provider == .claude ? UUID().uuidString.lowercased() : selectionIDGenerator(),
            context: actionContext)
        activeSelectionOperation = operation
        selectionCompletionInvalidated = false
        clearSelectionDeliveryNotice()
        if selectionSubmission == nil { selectionSubmission = submission }
        inFlightSelectionIdentity = key
        updateHotKeyEligibility()
        defer {
            if activeSelectionOperation?.id == operation.id {
                invalidateSelectionOperation()
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
                selectionID: operation.selectionID,
                optionID: choice.optionID
            )
            let usageOwnerID = account?.usageAuthorization()?.userID
            let usageContext = usageAnalytics?.captureContext()
            let payload = try request.data()
            productOperation = usageAnalytics?.beginFeature(feature: .choice, inputMethod: inputMethod)
            let response = try await transport.request(type: "select", payload: payload,
                                                       expectedContext: actionContext.expectedContext)
            guard acceptsSelectionCompletion(operation) else { return }
            let outcome = try await transport.selectionOutcome(response, request: request,
                                                               expectedContext: actionContext.expectedContext)
            guard acceptsSelectionCompletion(operation) else { return }
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
            await fetchAndApplySnapshot(requestIsCurrent: { self.acceptsSelectionCompletion(operation) })
        } catch {
            guard acceptsSelectionCompletion(operation) else { return }
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
            let failure = (error as? CoordinatorError)?.dispatchFailure
            let code = failure?.code ?? (error as? CoordinatorError)?.code
            let nativeFailure = provider == .codex
                && code.flatMap(CodexNativeDiagnostic.init(rawValue:)) != nil
            selectionDeliveryNoticeContext = actionContext
            selectionDeliveryNotice = PetSelectionDeliveryNotice(id: operation.id,
                identity: current.identity, selectionID: operation.selectionID, provider: provider,
                deliveryState: failure?.deliveryState
                    ?? (provider == .codex && code == "queued_prompt_preview_invalid" ? .notSubmitted : .unknown), code: code,
                requiresCodexRecheck: nativeFailure || (provider == .codex && failure?.cachedFailure == true))
            if nativeFailure, let code {
                recordConnectionDiagnostic(.codex(.error(code: code), stage: .transport), context: errorContext)
            }
            updateHotKeyEligibility()
            await fetchAndApplySnapshot(requestIsCurrent: { self.acceptsSelectionCompletion(operation) })
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
        guard productAccessAllowsActions, !isFeedbackInputActive, pendingManagedCommandApproval == nil,
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
                PetL10n.text("Shortcut settings conflict: ", korean: "단축키 설정 충돌: ") + internalCollisions.joined(separator: ", ")
            )
        } else if !systemCollisions.isEmpty {
            setShortcutDiagnosticIfChanged(
                PetL10n.text("macOS shortcut registration conflict: ", korean: "macOS 단축키 등록 충돌: ") + systemCollisions.joined(separator: ", ")
            )
        } else if !registrationFailures.isEmpty {
            setShortcutDiagnosticIfChanged(
                PetL10n.text("Shortcut registration failed: ", korean: "단축키 등록 실패: ") + registrationFailures.joined(separator: ", ")
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
            let continuation = codexSetupContinuationID
            let state = await codexPluginSetupManager.inspect()
            guard (try? requireCurrentSetupContinuation(continuation)) != nil else { return }
            codexPluginSetupState = state
            clearLegacyCodexPluginMigrationConfirmation()
        }
    }

    private func reloadOnboardingState(operationError: String? = nil) {
        let previousHookProject = hookReadinessProjectPath
        let previousProjects = configuredProjectPaths
        let previousAuthority = configuredProjectPathsAreAuthoritative
        let previousScopeExists = configuredProjectScopeExists
        defer {
            if previousProjects != configuredProjectPaths || previousAuthority != configuredProjectPathsAreAuthoritative
                || previousScopeExists != configuredProjectScopeExists {
                connectionSetupScopeGeneration &+= 1
            }
            if previousHookProject != hookReadinessProjectPath { invalidateHookReadiness() }
            publishConnectionSetupObservation()
        }
        onboardingServiceState = onboardingAdapter.serviceRegistrationState()
        applySuggestionModeLoadResult(suggestionModeStore.load())
        do {
            let saved = try onboardingAdapter.configuredProjectPathsIfPresent()
            configuredProjectPaths = saved ?? []
            configuredProjectScopeExists = saved != nil
            configuredProjectPathsAreAuthoritative = true
            onboardingError = operationError
        } catch {
            configuredProjectPaths = []
            configuredProjectScopeExists = false
            configuredProjectPathsAreAuthoritative = false
            let refreshError = String(describing: error)
            if let operationError {
                onboardingError = operationError + PetL10n.text("\nStatus refresh failed: ", korean: "\n상태 새로고침 실패: ") + refreshError
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

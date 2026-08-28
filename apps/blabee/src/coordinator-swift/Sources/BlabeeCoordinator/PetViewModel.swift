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

@MainActor
final class PetViewModel: ObservableObject {
    @Published private(set) var snapshot: PetSnapshot? {
        didSet {
            let priorActionCount = oldValue?.interactions.first?.actionChoices.count
            let currentActionCount = snapshot?.interactions.first?.actionChoices.count
            let priorQueueCount = oldValue?.interactions.count ?? 0
            let currentQueueCount = snapshot?.interactions.count ?? 0
            let priorPermissionID = oldValue?.permissionRequests.first?.requestID
            let currentPermissionID = snapshot?.permissionRequests.first?.requestID
            let priorPermissionCount = oldValue?.permissionRequests.count ?? 0
            let currentPermissionCount = snapshot?.permissionRequests.count ?? 0
            let priorManagedApprovalID = oldValue?.managedCommandApprovals.first?
                .managedRequestID
            let currentManagedApprovalID = snapshot?.managedCommandApprovals.first?
                .managedRequestID
            let priorManagedApprovalCount = oldValue?.managedCommandApprovals.count ?? 0
            let currentManagedApprovalCount = snapshot?.managedCommandApprovals.count ?? 0
            if priorActionCount != currentActionCount
                || priorQueueCount != currentQueueCount
                || priorPermissionID != currentPermissionID
                || priorPermissionCount != currentPermissionCount
                || priorManagedApprovalID != currentManagedApprovalID
                || priorManagedApprovalCount != currentManagedApprovalCount
            {
                onPanelLayoutChanged?()
            }
        }
    }
    @Published private(set) var localForegroundIdentity: PetInteractionIdentity?
    @Published private(set) var pendingFocusIdentity: PetInteractionIdentity?
    @Published private(set) var riskConfirmation: PetRiskConfirmation?
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
    @Published private(set) var shortcutDraft = PetShortcutConfiguration.defaults
    @Published private(set) var isEditingShortcuts = false {
        didSet {
            if oldValue != isEditingShortcuts { onPanelLayoutChanged?() }
        }
    }
    @Published private(set) var shortcutSettingsError: String?
    @Published private(set) var isShowingOnboarding = false {
        didSet {
            if oldValue != isShowingOnboarding { onPanelLayoutChanged?() }
        }
    }
    @Published private(set) var onboardingServiceState: PetServiceRegistrationState = .unknown
    @Published private(set) var configuredProjectPaths: [String] = []
    @Published private(set) var configuredProjectPathsAreAuthoritative = false
    @Published private(set) var onboardingError: String?
    @Published private(set) var isOnboardingOperationInFlight = false
    @Published private(set) var codexAutoConnectState: CodexAutoConnectState = .unavailable(
        "상태를 확인하지 않았습니다."
    )
    @Published private(set) var codexAutoConnectCanEnable = false
    @Published private(set) var codexAutoConnectError: String? {
        didSet {
            if (oldValue == nil) != (codexAutoConnectError == nil) {
                onPanelLayoutChanged?()
            }
        }
    }
    @Published private(set) var isCodexAutoConnectOperationInFlight = false

    private let transport: any PetCoordinatorTransport
    private let externalApplicationOpener: any PetExternalApplicationOpening
    private let onboardingAdapter: any PetOnboardingAdapting
    private let codexAutoConnectAdapter: any PetCodexAutoConnectAdapting
    private let projectFolderChooser: any PetProjectFolderChoosing
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
    private var pollingTask: Task<Void, Never>?
    private var nextSnapshotRequest: UInt64 = 0
    private var lastAppliedSnapshotRequest: UInt64 = 0
    private var refreshInProgress = false
    private var autoFocusAttemptedIdentity: PetInteractionIdentity?

    var onPanelLayoutChanged: (() -> Void)?
    var onPanelToggleRequested: (() -> Void)?
    var onAttentionChanged: ((Bool) -> Void)?
    var onAttentionEvent: (() -> Void)?
    var onPermissionRequestChanged: ((PetPermissionRequest?) -> Void)?

    init(
        transport: any PetCoordinatorTransport,
        externalApplicationOpener: any PetExternalApplicationOpening,
        onboardingAdapter: any PetOnboardingAdapting = PetUnavailableOnboardingAdapter(),
        codexAutoConnectAdapter: any PetCodexAutoConnectAdapting =
            PetUnavailableCodexAutoConnectAdapter(),
        projectFolderChooser: any PetProjectFolderChoosing = PetUnavailableProjectFolderChooser(),
        processIdentifier: pid_t = ProcessInfo.processInfo.processIdentifier,
        selectionIDGenerator: @escaping @Sendable () -> String = {
            "selection_" + UUID().uuidString.lowercased()
        },
        permissionResponseIDGenerator: @escaping @Sendable () -> String = {
            "permission_response_" + UUID().uuidString.lowercased()
        },
        managedApprovalResponseIDGenerator: @escaping @Sendable () -> String = {
            "managed_approval_response_" + UUID().uuidString.lowercased()
        }
    ) {
        self.transport = transport
        self.externalApplicationOpener = externalApplicationOpener
        self.onboardingAdapter = onboardingAdapter
        self.codexAutoConnectAdapter = codexAutoConnectAdapter
        self.projectFolderChooser = projectFolderChooser
        self.processIdentifier = processIdentifier
        self.selectionIDGenerator = selectionIDGenerator
        self.permissionResponseIDGenerator = permissionResponseIDGenerator
        self.managedApprovalResponseIDGenerator = managedApprovalResponseIDGenerator
        selectionReturnApplication = externalApplicationOpener
            .captureFrontmostExternalApplication(
                excludingProcessIdentifier: processIdentifier
            )
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

    var pendingPermissionRequest: PetPermissionRequest? {
        snapshot?.permissionRequests.first
    }

    var pendingManagedCommandApproval: PetManagedCommandApproval? {
        snapshot?.managedCommandApprovals.first
    }

    var managedCommandApprovalQueueCount: Int {
        snapshot?.managedCommandApprovals.count ?? 0
    }

    var permissionRequestQueueCount: Int {
        snapshot?.permissionRequests.count ?? 0
    }

    var hasNewPermissionNotice: Bool {
        pendingManagedCommandApproval != nil || pendingPermissionRequest != nil
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

    var hasAttention: Bool {
        hasNewPermissionNotice || fifoHeadInteraction?.isSelectionReady == true
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

    var isRecoveryCapable: Bool {
        guard let focusedInteraction else { return false }
        return focusedInteraction.checkpoint.isRecoveryCapable
            && focusedInteraction.choice(slot: 4)?.enabled == true
    }

    var activeProjectPaths: Set<String> {
        Set(snapshot?.projects.filter(\.enabled).map(\.cwd) ?? [])
    }

    var activeOnlyProjectPaths: [String] {
        guard configuredProjectPathsAreAuthoritative else { return [] }
        return activeProjectPaths
            .subtracting(configuredProjectPaths)
            .sorted()
    }

    var canRegisterOnboardingService: Bool {
        onboardingServiceState == .notRegistered && !isSettingsOperationInFlight
    }

    var canUnregisterOnboardingService: Bool {
        (onboardingServiceState == .enabled
            || onboardingServiceState == .requiresApproval)
            && !isSettingsOperationInFlight
    }

    var canOpenOnboardingSystemSettings: Bool {
        onboardingServiceState == .requiresApproval && !isSettingsOperationInFlight
    }

    var canMutateOnboardingProjects: Bool {
        guard configuredProjectPathsAreAuthoritative else { return false }
        return switch onboardingServiceState {
        case .notRegistered, .enabled, .requiresApproval:
            !isSettingsOperationInFlight
        case .notFound, .unknown:
            false
        }
    }

    var canEnableCodexAutoConnect: Bool {
        guard !isSettingsOperationInFlight, codexAutoConnectCanEnable else {
            return false
        }
        return switch codexAutoConnectState {
        case .disabled, .repairRequired:
            true
        case .enabled, .conflict, .unavailable:
            false
        }
    }

    var canDisableCodexAutoConnect: Bool {
        guard !isSettingsOperationInFlight else { return false }
        return switch codexAutoConnectState {
        case .enabled, .repairRequired:
            true
        case .disabled, .conflict, .unavailable:
            false
        }
    }

    var canRepairCodexAutoConnect: Bool {
        guard !isSettingsOperationInFlight, codexAutoConnectCanEnable else {
            return false
        }
        if case .repairRequired = codexAutoConnectState { return true }
        return false
    }

    var canMutateCodexAutoConnect: Bool {
        canEnableCodexAutoConnect || canDisableCodexAutoConnect
    }

    private var isSettingsOperationInFlight: Bool {
        isOnboardingOperationInFlight || isCodexAutoConnectOperationInFlight
    }

    func attachHotKeyRegistry(_ registry: PetHotKeyRegistry) {
        hotKeyRegistry = registry
        shortcutConfiguration = registry.configuration
        shortcutDraft = registry.configuration
        shortcutSettingsError = nil
        updateHotKeyEligibility()
    }

    var canSaveShortcutSettings: Bool {
        hotKeyRegistry != nil && shortcutDraft.validationIssue() == nil
    }

    func toggleShortcutSettings() {
        if isEditingShortcuts {
            cancelShortcutSettings()
        } else {
            beginShortcutSettings()
        }
    }

    func beginShortcutSettings() {
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
            isShowingOnboarding = false
        } else {
            await beginOnboarding()
        }
    }

    func beginOnboarding() async {
        cancelShortcutSettings()
        isShowingOnboarding = true
        setExpanded(true)
        await refreshOnboarding()
    }

    func closeOnboarding() {
        isShowingOnboarding = false
    }

    func refreshOnboarding() async {
        guard !isSettingsOperationInFlight else { return }
        isOnboardingOperationInFlight = true
        reloadOnboardingState()
        await reloadCodexAutoConnectState()
        isOnboardingOperationInFlight = false
    }

    func refreshCodexAutoConnect() async {
        guard !isSettingsOperationInFlight else { return }
        isCodexAutoConnectOperationInFlight = true
        await reloadCodexAutoConnectState()
        isCodexAutoConnectOperationInFlight = false
    }

    func enableCodexAutoConnect() async {
        guard canEnableCodexAutoConnect else { return }
        isCodexAutoConnectOperationInFlight = true
        let operationError: String?
        do {
            try await codexAutoConnectAdapter.enable()
            operationError = nil
        } catch {
            operationError = String(describing: error)
        }
        applyCodexAutoConnectSnapshot(
            codexAutoConnectAdapter.snapshot,
            operationError: operationError
        )
        isCodexAutoConnectOperationInFlight = false
    }

    func disableCodexAutoConnect() async {
        guard canDisableCodexAutoConnect else { return }
        isCodexAutoConnectOperationInFlight = true
        let operationError: String?
        do {
            try await codexAutoConnectAdapter.disable()
            operationError = nil
        } catch {
            operationError = String(describing: error)
        }
        applyCodexAutoConnectSnapshot(
            codexAutoConnectAdapter.snapshot,
            operationError: operationError
        )
        isCodexAutoConnectOperationInFlight = false
    }

    func registerOnboardingService() async {
        guard canRegisterOnboardingService else { return }
        isOnboardingOperationInFlight = true
        let operationError: String?
        do {
            try onboardingAdapter.registerService()
            operationError = nil
        } catch {
            operationError = String(describing: error)
        }
        reloadOnboardingState(operationError: operationError)
        isOnboardingOperationInFlight = false
    }

    func unregisterOnboardingService() async {
        guard canUnregisterOnboardingService else { return }
        isOnboardingOperationInFlight = true
        let operationError: String?
        do {
            try await onboardingAdapter.unregisterService()
            operationError = nil
        } catch {
            operationError = String(describing: error)
        }
        reloadOnboardingState(operationError: operationError)
        isOnboardingOperationInFlight = false
    }

    func openOnboardingSystemSettings() async {
        guard canOpenOnboardingSystemSettings else { return }
        isOnboardingOperationInFlight = true
        onboardingAdapter.openSystemSettingsLoginItems()
        reloadOnboardingState()
        isOnboardingOperationInFlight = false
    }

    func chooseAndEnableProject() async {
        guard canMutateOnboardingProjects else { return }
        isOnboardingOperationInFlight = true
        guard let projectURL = projectFolderChooser.chooseProjectFolder() else {
            isOnboardingOperationInFlight = false
            return
        }
        let operationError: String?
        do {
            try onboardingAdapter.enableProject(at: projectURL.standardizedFileURL.path)
            operationError = nil
        } catch {
            operationError = String(describing: error)
        }
        reloadOnboardingState(operationError: operationError)
        isOnboardingOperationInFlight = false
    }

    func disableConfiguredProject(_ path: String) async {
        guard canMutateOnboardingProjects,
              configuredProjectPaths.contains(path)
        else { return }
        isOnboardingOperationInFlight = true
        let operationError: String?
        do {
            try onboardingAdapter.disableProject(at: path)
            operationError = nil
        } catch {
            operationError = String(describing: error)
        }
        reloadOnboardingState(operationError: operationError)
        isOnboardingOperationInFlight = false
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

    func saveShortcutSettings() {
        guard let hotKeyRegistry else {
            shortcutSettingsError = "단축키 등록기가 준비되지 않았습니다."
            return
        }
        if let issue = shortcutDraft.validationIssue() {
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
        guard pollingTask == nil else { return }
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
            }
        }
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
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
        Task { [weak self] in
            await self?.handleGlobalSlot(slot)
        }
    }

    func requestPanelToggle() {
        onPanelToggleRequested?()
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
        lastError = nil
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
        guard fifoHeadInteraction?.identity == identity else { return }
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

    func resolvePermissionRequest(_ decision: PetPermissionDecision) async {
        guard let request = pendingPermissionRequest,
              inFlightPermissionRequestID == nil
        else { return }
        inFlightPermissionRequestID = request.requestID
        updateHotKeyEligibility()
        lastError = nil
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
            lastError = String(describing: error)
            await fetchAndApplySnapshot()
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
              inFlightManagedCommandApprovalID == nil
        else { return }
        if decision == .acceptOnce, !request.allowOnceAvailable { return }
        if decision == .decline, !request.declineAvailable { return }
        inFlightManagedCommandApprovalID = request.managedRequestID
        updateHotKeyEligibility()
        lastError = nil
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
            lastError = String(describing: error)
            await fetchAndApplySnapshot()
        }
        inFlightManagedCommandApprovalID = nil
        updateHotKeyEligibility()
    }

    private func fetchAndApplySnapshot() async {
        nextSnapshotRequest &+= 1
        let requestNumber = nextSnapshotRequest
        do {
            let payload = try StrictJSONTransport.data(forJSONObject: [:])
            let data = try await transport.request(type: "get_state", payload: payload)
            let parsed = try await Task.detached(priority: .utility) {
                try PetSnapshot.parse(data)
            }.value
            guard requestNumber >= lastAppliedSnapshotRequest else { return }
            lastAppliedSnapshotRequest = requestNumber
            apply(parsed)
            lastError = nil
            await focusFIFOHeadIfNeeded()
        } catch {
            guard requestNumber >= lastAppliedSnapshotRequest else { return }
            lastAppliedSnapshotRequest = requestNumber
            snapshot = nil
            localForegroundIdentity = nil
            pendingFocusIdentity = nil
            riskConfirmation = nil
            lastError = String(describing: error)
            updateHotKeyEligibility()
            onAttentionChanged?(hasAttention)
        }
    }

    private func apply(_ newSnapshot: PetSnapshot) {
        let priorPermissionHeadID = snapshot?.permissionRequests.first?.requestID
        let priorManagedApprovalHeadID = snapshot?.managedCommandApprovals.first?
            .managedRequestID
        let priorLocalForeground = localForegroundIdentity
        let priorHead = fifoHeadInteraction
        let priorReadyHeadIdentity = priorHead?.isSelectionReady == true
            ? priorHead?.identity
            : nil
        let priorReminderHeadIdentity = priorHead?.isSelectionReady == true
            && priorHead?.reminderDue == true
            ? priorHead?.identity
            : nil
        snapshot = newSnapshot
        permissionNoticeCount = newSnapshot.permissionNoticeCount
        managedCommandApprovalNoticeCount = newSnapshot
            .managedCommandApprovalNoticeCount
        let activePermissionRequestIDs = Set(
            newSnapshot.permissionRequests.map(\.requestID)
        )
        permissionReturnApplications = permissionReturnApplications.filter {
            activePermissionRequestIDs.contains($0.key)
        }
        let currentPermissionHeadID = newSnapshot.permissionRequests.first?.requestID
        if let currentPermissionHeadID,
           currentPermissionHeadID != priorPermissionHeadID,
           permissionReturnApplications[currentPermissionHeadID] == nil,
           let application = externalApplicationOpener
               .captureFrontmostExternalApplication(
                   excludingProcessIdentifier: processIdentifier
               )
        {
            permissionReturnApplications[currentPermissionHeadID] = application
        }
        let activeManagedApprovalIDs = Set(
            newSnapshot.managedCommandApprovals.map(\.managedRequestID)
        )
        managedApprovalReturnApplications = managedApprovalReturnApplications.filter {
            activeManagedApprovalIDs.contains($0.key)
        }
        let currentManagedApprovalHeadID = newSnapshot.managedCommandApprovals.first?
            .managedRequestID
        if let currentManagedApprovalHeadID,
           currentManagedApprovalHeadID != priorManagedApprovalHeadID,
           managedApprovalReturnApplications[currentManagedApprovalHeadID] == nil,
           let application = externalApplicationOpener
               .captureFrontmostExternalApplication(
                   excludingProcessIdentifier: processIdentifier
               )
        {
            managedApprovalReturnApplications[currentManagedApprovalHeadID] = application
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
            localForegroundIdentity = pendingFocusIdentity
            self.pendingFocusIdentity = nil
            lastTerminalPresentation = nil
        } else {
            localForegroundIdentity = nil
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
            lastTerminalPresentation = .expired
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
        let receivedManagedApproval = currentManagedApprovalHeadID != nil
            && currentManagedApprovalHeadID != priorManagedApprovalHeadID
        if currentPermissionHeadID != priorPermissionHeadID {
            onPermissionRequestChanged?(newSnapshot.permissionRequests.first)
        }
        if receivedManagedApproval || receivedNewDecision || receivedReminder {
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
        guard let current = authoritativeSelectionInteraction(),
              current.identity == interaction.identity,
              current.choice(slot: choice.slot)?.optionID == choice.optionID,
              choice.enabled
        else { return }
        let key = current.identity
        guard inFlightSelectionIdentity == nil else { return }
        inFlightSelectionIdentity = key
        updateHotKeyEligibility()
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
        guard pendingManagedCommandApproval == nil,
              inFlightManagedCommandApprovalID == nil,
              pendingPermissionRequest == nil,
              inFlightPermissionRequestID == nil,
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
            shortcutDiagnostic = nil
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
            shortcutDiagnostic = "단축키 설정 충돌: " + internalCollisions.joined(separator: ", ")
        } else if !systemCollisions.isEmpty {
            shortcutDiagnostic = "macOS 단축키 등록 충돌: " + systemCollisions.joined(separator: ", ")
        } else if !registrationFailures.isEmpty {
            shortcutDiagnostic = "단축키 등록 실패: " + registrationFailures.joined(separator: ", ")
        } else {
            shortcutDiagnostic = nil
        }
    }

    private func refreshShortcutSettingsValidation() {
        shortcutSettingsError = shortcutDraft.validationIssue()?.message
    }

    private func reloadOnboardingState(operationError: String? = nil) {
        onboardingServiceState = onboardingAdapter.serviceRegistrationState()
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

    private func reloadCodexAutoConnectState(operationError: String? = nil) async {
        await codexAutoConnectAdapter.refresh()
        applyCodexAutoConnectSnapshot(
            codexAutoConnectAdapter.snapshot,
            operationError: operationError
        )
    }

    private func applyCodexAutoConnectSnapshot(
        _ snapshot: PetCodexAutoConnectSnapshot,
        operationError: String? = nil
    ) {
        codexAutoConnectState = snapshot.state
        codexAutoConnectCanEnable = snapshot.canEnable
        codexAutoConnectError = operationError
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

import AppKit
import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation

struct PetArguments: Sendable, Equatable {
    let socketPath: String

    init(
        _ values: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws {
        var explicitSocketPath: String?
        var index = 0
        while index < values.count {
            guard values[index] == "--socket",
                  explicitSocketPath == nil,
                  index + 1 < values.count,
                  !values[index + 1].isEmpty
            else { throw CoordinatorError("invalid_arguments", "pet accepts only --socket ABS") }
            explicitSocketPath = values[index + 1]
            index += 2
        }
        socketPath = try OperationalSocketPath.resolve(
            explicitPath: explicitSocketPath,
            environment: environment
        )
    }
}

/// Process-lifetime authority for the one user-visible Pet. Every dogfood and
/// installed app build shares this fixed per-user lease, so opening a second
/// bundle cannot create another menu-bar icon.
final class PetProcessLease: @unchecked Sendable {
    private let descriptor: Int32

    init() throws {
        descriptor = try Self.acquire(runtimeRootURL: Self.defaultRuntimeRootURL)
    }

    init(runtimeRootURL: URL) throws {
        descriptor = try Self.acquire(runtimeRootURL: runtimeRootURL)
    }

    deinit {
        _ = flock(descriptor, LOCK_UN)
        close(descriptor)
    }

    private static var defaultRuntimeRootURL: URL {
        // HOME is intentionally ignored so independently launched builds for
        // the same macOS account still contend on one user-visible Pet lease.
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(
                "Library/Application Support/\(BlabeeProductProfile.current.applicationSupportDirectoryName)/runtime/pet",
                isDirectory: true
            )
    }

    private static func acquire(runtimeRootURL: URL) throws -> Int32 {
        let parent = try UnixDomainSocketServer.openSecureRuntimeDirectory(
            runtimeRootURL.standardizedFileURL
        )
        defer { close(parent) }
        do {
            return try UnixDomainSocketServer.openAndAcquireOwnerLease(
                parentDescriptor: parent,
                name: "instance-v1.lock"
            )
        } catch let error as CoordinatorError where error.code == "operational_owner_active" {
            throw CoordinatorError(
                "pet_already_running",
                "another Blabee Pet is already running"
            )
        }
    }
}

@MainActor
final class PetApplicationDelegate: NSObject, NSApplicationDelegate {
    private let arguments: PetArguments
    private let startupOverride: (@MainActor () throws -> Void)?
    private let stopApplicationAfterStartupFailure: @MainActor () -> Void
    private var viewModel: PetViewModel?
    private var menuBarController: PetMenuBarController?
    private var firstRunController: PetFirstRunController?
    private var firstRunWindow: PetFirstRunWindowController?
    private var firstRunPreferences: PetFirstRunPreferences?
    private var terminationInProgress = false
    private(set) var startupError: Error?

    init(
        arguments: PetArguments,
        startupOverride: (@MainActor () throws -> Void)? = nil,
        stopApplicationAfterStartupFailure: @escaping @MainActor () -> Void = {
            let application = NSApplication.shared
            application.stop(nil)
            if let wakeEvent = NSEvent.otherEvent(
                with: .applicationDefined,
                location: .zero,
                modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: 0,
                context: nil,
                subtype: 0,
                data1: 0,
                data2: 0
            ) {
                application.postEvent(wakeEvent, atStart: false)
            }
        }
    ) {
        self.arguments = arguments
        self.startupOverride = startupOverride
        self.stopApplicationAfterStartupFailure = stopApplicationAfterStartupFailure
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        PetStartupDiagnostics.record(.delegateDidFinishLaunching)
        do {
            if let startupOverride {
                try startupOverride()
            } else {
                try startProductionPet()
            }
        } catch {
            PetStartupDiagnostics.recordFailure(
                .startupFailed,
                code: (error as? CoordinatorError)?.code ?? "pet_startup_failed"
            )
            startupError = error
            stopApplicationAfterStartupFailure()
        }
    }

    func rethrowStartupError() throws {
        if let startupError { throw startupError }
    }

    func applicationWillTerminate(_ notification: Notification) {
        viewModel?.feedback?.stop()
        viewModel?.errorDiagnostics?.stop()
        viewModel?.usageAnalytics?.stop()
        viewModel?.account?.stop()
        viewModel?.stopPolling()
        menuBarController?.stop()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let viewModel else { return .terminateNow }
        guard !terminationInProgress else { return .terminateLater }
        terminationInProgress = true
        Task {
            await viewModel.shutdownAppOwnedService()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        firstRunPreferences?.reloadLaunchAtLoginStatus()
        guard let account = viewModel?.account else { return }
        Task { await account.refresh() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if firstRunController?.isComplete == false { firstRunWindow?.show() }
        return true
    }

    private func startProductionPet() throws {
        let legacyTransport = try PetUnixDomainSocketTransport(socketPath: arguments.socketPath)
        let opener = PetWorkspaceApplicationOpener()
        let onboardingAdapter: any PetOnboardingAdapting
        do {
            onboardingAdapter = try PetLiveOnboardingAdapter()
            PetStartupDiagnostics.record(.onboardingReady)
        } catch {
            PetStartupDiagnostics.recordFailure(
                .onboardingFallback,
                code: (error as? CoordinatorError)?.code ?? "pet_onboarding_unavailable"
            )
            onboardingAdapter = PetUnavailableOnboardingAdapter(
                reason: "제품 앱 온보딩 환경을 확인할 수 없습니다: \(error)"
            )
        }
        let suggestionModeStore = BlabeeSuggestionModeStore()
        let codexPluginSetupManager = CodexPluginSetupManager.live()
        let account = PetAccountController.live()
        let usageAnalytics = PetUsageAnalytics.live { [weak account] in
            account?.usageAuthorization()
        }
        let errorDiagnostics = PetErrorDiagnostics.live { [weak account] in
            account?.usageAuthorization()
        }
        let feedback = PetFeedbackController.live { [weak account] in
            account?.usageAuthorization()
        }
        account.errorDiagnostics = errorDiagnostics
        let appService: PetAppServiceController?
        if onboardingAdapter is PetLiveOnboardingAdapter {
            appService = PetAppServiceController(
                launcher: AppOwnedServiceProcessLauncher(socketPath: arguments.socketPath),
                preference: PetAppServicePreferenceStore(),
                registration: { onboardingAdapter.serviceRegistrationState() },
                errorDiagnostics: errorDiagnostics
            )
        } else {
            // Raw developer Pet invocations never start a product service.
            appService = nil
            PetStartupDiagnostics.record(.appServiceUnavailable)
        }
        let transport = PetProviderTransport(codex: legacyTransport, access: { [weak appService] in
            await MainActor.run { appService?.petProviderAccess }
        })
        let viewModel = PetViewModel(
            transport: transport,
            externalApplicationOpener: opener,
            startClaude: { [weak appService, socketPath = arguments.socketPath] in
                guard let owned = appService?.petProviderAccess else { throw PetClaudeLauncher.Failure.serviceChanged }
                let runtime = try OperationalRuntimeIdentity.requireCurrent()
                try await PetClaudeLauncher.startLive(socketPath: socketPath, runtimeIdentity: runtime,
                    validateService: { [weak appService] in
                        guard appService?.petProviderAccess == owned else { throw PetClaudeLauncher.Failure.serviceChanged }
                    })
            },
            onboardingAdapter: onboardingAdapter,
            appService: appService,
            codexPluginSetupManager: codexPluginSetupManager,
            hookReadinessManager: PetHookReadinessManager.live(),
            storageRecoveryManager: onboardingAdapter is PetLiveOnboardingAdapter
                ? PetStorageRecoveryManager.live(socketPath: arguments.socketPath)
                : PetUnavailableStorageRecoveryManager(),
            legacyShellCleanupManager: onboardingAdapter is PetLiveOnboardingAdapter
                ? LegacyCodexShellCleanupManager.live()
                : LegacyUnavailableCodexShellCleanupManager(),
            suggestionModeStore: suggestionModeStore,
            projectFolderChooser: PetOpenPanelProjectFolderChooser(),
            appUpdateChecker: PetGitHubAppUpdateChecker.live(),
            account: account,
            usageAnalytics: usageAnalytics,
            errorDiagnostics: errorDiagnostics,
            feedback: feedback
        )
        let feedbackWindow = PetFeedbackWindowController(controller: feedback)
        feedbackWindow.onVisibilityChanged = { [weak viewModel] visible in
            viewModel?.setFeedbackWindowVisible(visible)
        }
        viewModel.onFeedbackRequested = { suggestion in
            feedbackWindow.show(suggestion: suggestion)
        }
        PetStartupDiagnostics.record(.viewModelReady)
        viewModel.automaticAppUpdate.productMetrics = .live(analytics: usageAnalytics)
        usageAnalytics.onConsentChanged = { [weak viewModel] in
            viewModel?.observeProductAccountState()
        }
        self.viewModel = viewModel
        let preferences = PetFirstRunPreferences()
        firstRunPreferences = preferences
        viewModel.firstRunPreferences = preferences
        preferences.applyAppearance()
        // Developer CLI invocations do not consume or modify product onboarding.
        if ProductInvocationResolver.isStandardInstalledApp(.live()) {
            firstRunController = PetFirstRunController()
        }
        let store = PetUserDefaultsShortcutStore()
        let backend = CarbonPetHotKeyBackend()
        let registry = try PetHotKeyRegistry(
            backend: backend,
            configuration: store.load() ?? .defaults,
            store: store
        ) { [weak self, weak viewModel] intent in
            if self?.firstRunController?.isComplete == false {
                if intent == .toggle { self?.firstRunWindow?.show() }
                return
            }
            viewModel?.handleShortcut(intent)
        }
        viewModel.attachHotKeyRegistry(registry)
        account.onPhaseChanged = { [weak self, weak usageAnalytics, weak viewModel, weak feedback, weak feedbackWindow] phase in
            if case .signedIn(let user) = phase {
                self?.firstRunController?.synchronizeAccount(id: user.id, email: user.email)
            } else {
                self?.firstRunController?.synchronizeAccount(
                    id: nil, email: nil, isVerifying: phase == .checking
                )
            }
            switch phase {
            case .signedOut, .signingOut:
                feedbackWindow?.close()
                feedback?.clearIdentity()
                usageAnalytics?.clearIdentity()
                viewModel?.clearInsightIdentity()
                viewModel?.automaticAppUpdate.productMetrics?.clearIdentity()
            default:
                usageAnalytics?.accountStateChanged()
                feedback?.accountStateChanged()
            }
            if case .signedIn = phase { viewModel?.observeProductAccountState() }
        }
        account.onSignInCompleted = { [weak self] in
            if self?.firstRunController?.isComplete == false {
                self?.firstRunWindow?.show()
            } else {
                self?.menuBarController?.showAccountAfterSignIn()
            }
        }
        Task { await account.restoreIfNeeded() }
        if let firstRunController, !firstRunController.isComplete {
            viewModel.beginFirstRunSetup()
            let window = PetFirstRunWindowController(
                controller: firstRunController, viewModel: viewModel, preferences: preferences
            )
            window.onFinish = { [weak self] deferred in self?.finishFirstRun(connectionDeferred: deferred) }
            window.onClose = { NSApplication.shared.terminate(nil) }
            firstRunController.onComplete = { [weak self] in
                guard let self else { return }
                self.firstRunWindow?.closeAfterCompletion()
                self.firstRunWindow = nil
                self.startNormalPet(showPanel: true)
            }
            firstRunWindow = window
            window.show()
        } else {
            startNormalPet()
        }
    }

    private func finishFirstRun(connectionDeferred: Bool) {
        guard let viewModel, let firstRunController,
              !viewModel.isOnboardingOperationInFlight,
              case .signedIn = viewModel.account?.phase else { return }
        let ready = viewModel.isConnectionSetupReady
        firstRunController.finishSetup(isReady: ready, connectionDeferred: connectionDeferred) { usage, diagnostics in
            viewModel.usageAnalytics?.setEnabled(usage)
            viewModel.errorDiagnostics?.setEnabled(diagnostics)
        }
    }

    private func startNormalPet(showPanel: Bool = false) {
        guard menuBarController == nil, let viewModel else { return }
        viewModel.endFirstRunSetup()
        menuBarController = PetMenuBarController(viewModel: viewModel)
        PetStartupDiagnostics.record(.menuBarReady)
        viewModel.startPolling()
        PetStartupDiagnostics.record(.pollingStarted)
        if showPanel { viewModel.requestPanelToggle() }
    }
}

@MainActor
func runPet(arguments rawArguments: [String]) throws {
    let arguments = try PetArguments(rawArguments)
    let processLease = try PetProcessLease()
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = PetApplicationDelegate(arguments: arguments)
    application.delegate = delegate
    application.run()
    withExtendedLifetime((delegate, processLease)) {}
    try delegate.rethrowStartupError()
}

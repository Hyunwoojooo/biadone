import AppKit
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
                "Library/Application Support/Blabee/runtime/pet",
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
        do {
            if let startupOverride {
                try startupOverride()
            } else {
                try startProductionPet()
            }
        } catch {
            startupError = error
            stopApplicationAfterStartupFailure()
        }
    }

    func rethrowStartupError() throws {
        if let startupError { throw startupError }
    }

    func applicationWillTerminate(_ notification: Notification) {
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

    private func startProductionPet() throws {
        let transport = try PetUnixDomainSocketTransport(socketPath: arguments.socketPath)
        let opener = PetWorkspaceApplicationOpener()
        let onboardingAdapter: any PetOnboardingAdapting
        do {
            onboardingAdapter = try PetLiveOnboardingAdapter()
        } catch {
            onboardingAdapter = PetUnavailableOnboardingAdapter(
                reason: "제품 앱 온보딩 환경을 확인할 수 없습니다: \(error)"
            )
        }
        let suggestionModeStore = BlabeeSuggestionModeStore()
        let codexPluginSetupManager = CodexPluginSetupManager.live()
        let appService: PetAppServiceController?
        if onboardingAdapter is PetLiveOnboardingAdapter {
            appService = PetAppServiceController(
                launcher: AppOwnedServiceProcessLauncher(socketPath: arguments.socketPath),
                preference: PetAppServicePreferenceStore(),
                registration: { onboardingAdapter.serviceRegistrationState() }
            )
        } else {
            // Raw developer Pet invocations never start a product service.
            appService = nil
        }
        let viewModel = PetViewModel(
            transport: transport,
            externalApplicationOpener: opener,
            onboardingAdapter: onboardingAdapter,
            appService: appService,
            codexPluginSetupManager: codexPluginSetupManager,
            legacyShellCleanupManager: onboardingAdapter is PetLiveOnboardingAdapter
                ? LegacyCodexShellCleanupManager.live()
                : LegacyUnavailableCodexShellCleanupManager(),
            suggestionModeStore: suggestionModeStore,
            projectFolderChooser: PetOpenPanelProjectFolderChooser()
        )
        let store = PetUserDefaultsShortcutStore()
        let backend = CarbonPetHotKeyBackend()
        let registry = try PetHotKeyRegistry(
            backend: backend,
            configuration: store.load() ?? .defaults,
            store: store
        ) { [weak viewModel] intent in
            viewModel?.handleShortcut(intent)
        }
        viewModel.attachHotKeyRegistry(registry)
        let menuBarController = PetMenuBarController(viewModel: viewModel)
        self.viewModel = viewModel
        self.menuBarController = menuBarController
        viewModel.startPolling()
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

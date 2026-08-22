import AppKit
import CoordinatorSwift
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

@MainActor
final class PetApplicationDelegate: NSObject, NSApplicationDelegate {
    private let arguments: PetArguments
    private let startupOverride: (@MainActor () throws -> Void)?
    private let stopApplicationAfterStartupFailure: @MainActor () -> Void
    private var viewModel: PetViewModel?
    private var panelController: PetPanelController?
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
        panelController?.stopObservingScreenChanges()
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
        let viewModel = PetViewModel(
            transport: transport,
            externalApplicationOpener: opener,
            onboardingAdapter: onboardingAdapter,
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
        let panelController = PetPanelController(viewModel: viewModel)
        self.viewModel = viewModel
        self.panelController = panelController
        panelController.showWithoutActivation()
        viewModel.startPolling()
    }
}

@MainActor
func runPet(arguments rawArguments: [String]) throws {
    let arguments = try PetArguments(rawArguments)
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = PetApplicationDelegate(arguments: arguments)
    application.delegate = delegate
    application.run()
    withExtendedLifetime(delegate) {}
    try delegate.rethrowStartupError()
}

#if BLABEE_TEST_APP
import AppKit
import BlabeeProductSupport
import Combine
import CoordinatorSwift
import Foundation
import SwiftUI

enum BlabeeTestLaunchError: Error, Equatable, LocalizedError {
    case unsupportedArguments, invalidBundle, transitionCancelled
    var errorDescription: String? {
        switch self {
        case .unsupportedArguments: "Blabee Test only supports its development app and owned Engine service. Product commands are disabled."
        case .invalidBundle: "This executable must be opened from a correctly assembled Blabee Test.app."
        case .transitionCancelled: "The Test transition was cancelled. Existing run files were preserved."
        }
    }
}

enum BlabeeTestLaunchPolicy {
    static func validate(arguments: [String], bundleURL: URL, info: [String: Any]) throws {
        guard arguments.isEmpty else { throw BlabeeTestLaunchError.unsupportedArguments }
        guard BlabeeProductProfile.current.isTestApp,
              bundleURL.lastPathComponent == "Blabee Test.app",
              info["CFBundleIdentifier"] as? String == "com.biadone.blabee.test",
              info["CFBundleExecutable"] as? String == "blabee-coordinator",
              info["BlabeeDistributionProfile"] as? String == "blabee-test",
              info["BlabeeTestMode"] as? String == "isolated-development",
              info["BlabeeTestMilestone"] as? String == "M2",
              let simulation = info["BlabeeTestSimulationOnly"] as? NSNumber,
              CFGetTypeID(simulation) == CFBooleanGetTypeID(), !simulation.boolValue,
              let engine = info["BlabeeTestEngineEnabled"] as? NSNumber,
              CFGetTypeID(engine) == CFBooleanGetTypeID(), engine.boolValue
        else { throw BlabeeTestLaunchError.invalidBundle }
    }
}

enum BlabeeTestPage: String, CaseIterable, Identifiable {
    case onboarding, connection, cards, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .onboarding: PetL10n.text("Onboarding", korean: "온보딩")
        case .connection: PetL10n.text("Connection", korean: "연결")
        case .cards: PetL10n.text("Cards", korean: "카드")
        case .settings: PetL10n.text("Settings", korean: "설정")
        }
    }
}

/// Owns the active run, never a product process. A failed transition cannot
/// publish a partially initialized composition or reactivate its predecessor.
@MainActor
final class BlabeeTestWorkspaceController: ObservableObject {
    @Published private(set) var composition: BlabeeTestComposition?
    @Published private(set) var run: BlabeeTestRunManifest?
    @Published private(set) var availableRuns: [BlabeeTestRunManifest] = []
    @Published private(set) var inventoryIssues: [BlabeeTestRunIssue] = []
    @Published private(set) var isTransitioning = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var resultMessage: String?
    @Published private(set) var engineReport: BlabeeTestEngineReport?
    @Published private(set) var engineError: String?
    @Published private(set) var isEngineOperationInFlight = false
    private var engineOperationID: UUID?
    @Published private(set) var viewGeneration = UUID()
    @Published private(set) var isRunActive = false
    private(set) var isCardPollingActive = false
    @Published private(set) var page: BlabeeTestPage = .onboarding
    var onRequestClose: (@MainActor () -> Void)?
    let store: BlabeeTestRunStore
    private var lease: BlabeeTestRunLease?
    private let drain: @MainActor (BlabeeTestComposition) async throws -> Void
    private let refreshCards: @MainActor (PetViewModel) async -> Void
    private let makeComposition: @MainActor (BlabeeTestRunStore, BlabeeTestRunManifest) throws -> BlabeeTestComposition
    private let readEngineReport: @MainActor (BlabeeTestEngineSession) async throws -> BlabeeTestEngineReport

    init(store: BlabeeTestRunStore,
         drain: @escaping @MainActor (BlabeeTestComposition) async throws -> Void = { try await $0.drain() },
         refreshCards: @escaping @MainActor (PetViewModel) async -> Void = { await $0.refresh() },
         makeComposition: @escaping @MainActor (BlabeeTestRunStore, BlabeeTestRunManifest) throws -> BlabeeTestComposition = {
             try BlabeeTestComposition(store: $0, run: $1)
         },
         readEngineReport: @escaping @MainActor (BlabeeTestEngineSession) async throws -> BlabeeTestEngineReport = {
             try await $0.report()
         }) throws {
        self.store = store
        self.drain = drain
        self.refreshCards = refreshCards
        self.makeComposition = makeComposition
        self.readEngineReport = readEngineReport
        let inventory = try store.inventory()
        availableRuns = inventory.runs
        inventoryIssues = inventory.issues
    }

    func startNew(scenario: BlabeeTestScenario) async {
        await transition { try self.store.create(scenario: scenario) }
    }

    func resume(_ selected: BlabeeTestRunManifest) async {
        await transition { try self.store.resume(runID: selected.runID) }
    }

    private func transition(prepare: () throws -> BlabeeTestRunManifest) async {
        guard !isTransitioning else { return }
        isTransitioning = true
        errorMessage = nil
        resultMessage = nil
        engineReport = nil
        engineError = nil
        engineOperationID = nil
        isEngineOperationInFlight = false
        let operation = UUID()
        viewGeneration = operation
        isRunActive = false
        isCardPollingActive = false
        let previous = composition
        previous?.invalidate()
        defer { if viewGeneration == operation { isTransitioning = false } }
        do {
            if let previous { try await drain(previous) }
            try Task.checkCancellation()
            guard viewGeneration == operation else { throw BlabeeTestLaunchError.transitionCancelled }
            // Retain the old lease on drain failure; only a successful stop can
            // release it. Old run files are never deleted by this transition.
            lease?.release()
            lease = nil
            var candidate = try prepare()
            let candidateLease = try store.acquireLease(for: candidate)
            candidate = try store.recordDefaultsSuiteUse(for: candidate)
            guard let defaults = UserDefaults(suiteName: candidate.defaultsSuiteName) else {
                throw BlabeeTestRunStoreError.invalidSnapshot
            }
            try store.validate(candidate)
            PetLocalization.shared.bindTestRunDefaults(defaults)
            let prepared = try makeComposition(store, candidate)
            let inventory = try store.inventory()
            try Task.checkCancellation()
            guard viewGeneration == operation else {
                prepared.invalidate()
                throw BlabeeTestLaunchError.transitionCancelled
            }
            // Publish one consistent run/composition pair after all preparation.
            lease = candidateLease
            run = candidate
            composition = prepared
            isRunActive = true
            page = candidate.scenario.usesRealEngine ? .cards
                : [.freshInstall, .loginCancelled, .loginFailed].contains(candidate.scenario) ? .onboarding : .connection
            availableRuns = inventory.runs
            inventoryIssues = inventory.issues
            // Initialization may intentionally wait on a simulated response.
            // Keep cancellation, reset, and Release Response available meanwhile.
            isTransitioning = false
            await prepared.activate()
            try Task.checkCancellation()
            guard viewGeneration == operation, isRunActive else { return }
            await showPage(page, expectedGeneration: operation)
        } catch {
            guard viewGeneration == operation else { return }
            // A previous composition remains fenced even when its files remain.
            composition?.invalidate()
            isRunActive = false
            PetLocalization.shared.bindTestRunDefaults(nil)
            errorMessage = error.localizedDescription
        }
    }

    func replayOnboarding() {
        guard isRunActive, !isTransitioning, let composition else { return }
        do {
            viewGeneration = UUID()
            isCardPollingActive = false
            try composition.replayOnboarding()
            page = .onboarding
            resultMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func showPage(_ selected: BlabeeTestPage, expectedGeneration: UUID? = nil) async {
        guard isRunActive, expectedGeneration.map({ $0 == viewGeneration }) ?? true,
              let composition else { return }
        let expected = UUID()
        viewGeneration = expected
        page = selected
        bindPanelClose(to: composition, generation: expected)
        isCardPollingActive = false
        composition.viewModel.stopPolling()
        if selected == .cards {
            composition.viewModel.endFirstRunSetup()
            composition.viewModel.setPanelVisible(true)
            await refreshCards(composition.viewModel)
            guard expected == viewGeneration, isRunActive, page == selected,
                  self.composition === composition, composition.isActive else { return }
            isCardPollingActive = true
            composition.viewModel.startPolling(intervalNanoseconds: 1_000_000_000)
        } else {
            composition.viewModel.beginFirstRunSetup()
            await composition.viewModel.refreshFirstRunSetup()
        }
    }

    private func bindPanelClose(to composition: BlabeeTestComposition, generation: UUID) {
        composition.viewModel.onPanelToggleRequested = { [weak self, weak composition] in
            guard let self, let composition, self.isRunActive, composition.isActive,
                  self.composition === composition, self.viewGeneration == generation,
                  self.page == .cards else { return }
            self.onRequestClose?()
        }
    }

    func saveResult() async {
        guard isRunActive, !isTransitioning, let composition, let run else { return }
        let expected = viewGeneration
        let metrics = await composition.simulationMetrics()
        guard expected == viewGeneration, isRunActive else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            if let engine = composition.engineSession {
                let report = try await readEngineReport(engine)
                guard expected == viewGeneration, isRunActive, self.composition === composition else { return }
                try store.saveResult(encoder.encode(report), for: run)
                engineReport = report
            } else {
                let result = BlabeeTestM1Report(runID: run.runID, scenario: run.scenario, createdAt: Date(), metrics: metrics)
                try store.saveResult(encoder.encode(result), for: run)
            }
            resultMessage = PetL10n.text("Report saved in this run's results folder.", korean: "이 실행의 results 폴더에 검증 기록을 저장했습니다.")
        } catch {
            guard expected == viewGeneration, isRunActive, self.composition === composition else { return }
            errorMessage = error.localizedDescription
        }
    }

    func engineAction(_ operation: String) async {
        guard isRunActive, !isTransitioning, !isEngineOperationInFlight,
              let composition, let engine = composition.engineSession, let run else { return }
        let expected = viewGeneration
        let action = UUID()
        engineOperationID = action
        isEngineOperationInFlight = true
        engineError = nil
        if page == .cards {
            composition.viewModel.stopPolling()
            isCardPollingActive = false
        }
        defer { if engineOperationID == action { isEngineOperationInFlight = false } }
        do {
            let report: BlabeeTestEngineReport
            switch operation {
            case "seed": report = try await engine.seed()
            case "claim": report = try await engine.claim()
            default: report = try await engine.report()
            }
            guard expected == viewGeneration, isRunActive, self.composition === composition,
                  engineOperationID == action, report.runID == run.runID,
                  report.storeID == run.storeID, report.launchID == engine.launchID else { return }
            engineReport = report
            if operation == "seed" || page == .cards { await showPage(.cards, expectedGeneration: expected) }
        } catch {
            guard expected == viewGeneration, isRunActive, self.composition === composition,
                  engineOperationID == action else { return }
            engineError = error.localizedDescription
            if page == .cards { await showPage(.cards, expectedGeneration: expected) }
        }
    }

    @discardableResult
    func shutdown() async -> Bool {
        viewGeneration = UUID()
        isRunActive = false
        isCardPollingActive = false
        composition?.invalidate()
        do { try await composition?.drain() }
        catch { errorMessage = error.localizedDescription; return false }
        lease?.release()
        lease = nil
        PetLocalization.shared.bindTestRunDefaults(nil)
        return true
    }
}

struct BlabeeTestM1Report: Encodable, Sendable {
    let schemaVersion = 1
    let milestone = "M1"
    let evidence = "UI simulation only; live Engine, OAuth and provider execution are unverified."
    let runID: UUID
    let scenario: BlabeeTestScenario
    let createdAt: Date
    let metrics: BlabeeTestSimulationMetrics
}

@MainActor
struct BlabeeTestWorkspaceView: View {
    @ObservedObject var controller: BlabeeTestWorkspaceController
    @ObservedObject private var localization = PetLocalization.shared
    @State private var selectedScenario: BlabeeTestScenario = .freshInstall
    @State private var selectedRunID: UUID?

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Blabee Test", systemImage: "testtube.2").font(.headline)
                    Text(controller.run?.scenario.usesRealEngine == true
                         ? PetL10n.text("TEST · REAL ENGINE", korean: "TEST · 실제 Engine")
                         : PetL10n.text("TEST · SIMULATION", korean: "TEST · 시뮬레이션"))
                        .font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.indigo.opacity(0.12), in: Capsule())
                    Spacer(minLength: 4)
                    PetLanguagePicker(localization: localization, compact: true)
                }
                HStack(spacing: 8) {
                    Picker(PetL10n.text("Next Scenario", korean: "다음 시나리오"), selection: $selectedScenario) {
                        ForEach(BlabeeTestScenario.allCases, id: \.self) { item in
                            Text(item.localizedTitle).tag(item)
                        }
                    }.labelsHidden().frame(maxWidth: .infinity)
                    Button(PetL10n.text("New Test", korean: "새 테스트 시작")) {
                        Task { await controller.startNew(scenario: selectedScenario) }
                    }.buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("test-new-run")
                }
                if let run = controller.run {
                    HStack(spacing: 8) {
                        Text("Run \(run.runID.uuidString.prefix(8)) · \(run.scenario.localizedTitle)")
                            .font(.caption.monospaced()).foregroundStyle(.secondary)
                        Spacer()
                        Button(PetL10n.text("Replay Onboarding", korean: "온보딩 다시 보기")) {
                            controller.replayOnboarding()
                        }.disabled(!controller.isRunActive)
                            .accessibilityIdentifier("test-replay-onboarding")
                    }
                }
            }.padding(14)
                .disabled(controller.isTransitioning)
            Divider()
            if let message = controller.errorMessage {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.orange)
                    .textSelection(.enabled).padding(12).frame(maxWidth: .infinity, alignment: .leading)
            }
            if !controller.inventoryIssues.isEmpty {
                Label(PetL10n.text("\(controller.inventoryIssues.count) saved test record(s) could not be verified. They were preserved and will not be resumed.", korean: "저장된 테스트 기록 \(controller.inventoryIssues.count)개를 확인하지 못했습니다. 기록은 보존하며 이어보기에 사용하지 않습니다."),
                      systemImage: "doc.badge.ellipsis")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.vertical, 6)
            }
            if let composition = controller.composition, controller.isRunActive {
                Picker(PetL10n.text("Screen", korean: "화면"), selection: Binding(
                    get: { controller.page },
                    set: { page in
                        let expected = controller.viewGeneration
                        Task { await controller.showPage(page, expectedGeneration: expected) }
                    }
                )) {
                    ForEach(BlabeeTestPage.allCases) { page in Text(page.title).tag(page) }
                }.pickerStyle(.segmented).padding(.horizontal, 14).padding(.vertical, 9)
                    .disabled(controller.isTransitioning)
                if composition.engineSession != nil { engineControls }
                BlabeeTestSharedScreen(composition: composition, controller: controller,
                                       generation: controller.viewGeneration)
                    .id(controller.viewGeneration)
                    .disabled(controller.isTransitioning)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                HStack {
                    if controller.run.map({ [.pluginPreparing, .delayedResponse].contains($0.scenario) }) == true {
                        Button(PetL10n.text("Release Response", korean: "지연 응답 보내기")) {
                            Task { await composition.releaseDelayedResponse() }
                        }
                    }
                    Text(controller.resultMessage ?? PetL10n.text("Provider execution and sign-in remain simulated.", korean: "Codex·Claude 실행과 로그인은 모의 동작입니다."))
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    Button(PetL10n.text("Save Report", korean: "결과 저장")) { Task { await controller.saveResult() } }
                }.padding(12).disabled(controller.isTransitioning)
            } else {
                chooser
            }
            if controller.isTransitioning {
                ProgressView(PetL10n.text("Preparing an isolated test…", korean: "독립된 테스트를 준비하고 있습니다…"))
                    .padding(10)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .environment(\.openURL, OpenURLAction { _ in .discarded })
        .accessibilityIdentifier("blabee-test-workspace")
    }

    private var chooser: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "testtube.2").font(.system(size: 36)).foregroundStyle(.indigo)
            Text(PetL10n.text("Repeat setup without resetting your Mac", korean: "Mac을 초기화하지 않고 설정을 반복하세요"))
                .font(.title2.bold())
            Text(PetL10n.text("Choose a scenario above and start a new test. UI scenarios simulate setup; M2 uses the real Engine with isolated storage. Provider execution and sign-in stay simulated.", korean: "위에서 시나리오를 고르고 새 테스트를 시작하세요. UI 시나리오는 설정을 재현하고 M2는 독립 저장소와 실제 Engine을 사용합니다. Codex·Claude 실행과 로그인은 모의 동작입니다."))
                .foregroundStyle(.secondary)
            if !controller.availableRuns.isEmpty {
                Divider()
                Picker(PetL10n.text("Previous Test", korean: "이전 테스트"), selection: $selectedRunID) {
                    Text(PetL10n.text("Choose a saved run", korean: "저장된 실행 선택")).tag(Optional<UUID>.none)
                    ForEach(controller.availableRuns.prefix(30)) { run in
                        Text("\(run.scenario.localizedTitle) · \(run.runID.uuidString.prefix(8))")
                            .tag(Optional(run.runID))
                    }
                }
                Button(PetL10n.text("Resume Selected Test", korean: "선택한 테스트 이어보기")) {
                    guard let selected = controller.availableRuns.first(where: { $0.runID == selectedRunID }) else { return }
                    selectedScenario = selected.scenario
                    Task { await controller.resume(selected) }
                }.disabled(selectedRunID == nil || controller.isTransitioning)
                Text(PetL10n.text("Saved screens are restored only after you choose a run. No previous action is sent again.", korean: "실행을 직접 고른 뒤에만 화면을 복원합니다. 이전 작업을 다시 전송하지 않습니다."))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var engineControls: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(PetL10n.text("M2 · Swift Engine with isolated SQLite and freshness", korean: "M2 · 독립 SQLite·freshness를 사용하는 실제 Swift Engine"))
                .font(.caption.bold())
            HStack {
                Button(PetL10n.text("Create Test Card", korean: "테스트 카드 만들기")) { Task { await controller.engineAction("seed") } }
                Button(PetL10n.text("Verify Claim / Retry", korean: "Claim 검증·재시도")) { Task { await controller.engineAction("claim") } }
                Button(PetL10n.text("Check Engine", korean: "Engine 확인")) { Task { await controller.engineAction("report") } }
                if controller.isEngineOperationInFlight { ProgressView().controlSize(.small) }
            }.disabled(controller.isTransitioning || controller.isEngineOperationInFlight)
            if let report = controller.engineReport {
                Text("SQLite: \(report.integrityCheck) · Events: \(report.eventCount) · Claims: \(report.claimCount) · Provider execution: \(report.providerExecutionCount)")
                    .font(.caption.monospaced())
            }
            if let error = controller.engineError { Text(error).font(.caption).foregroundStyle(.red) }
        }.padding(.horizontal, 14).padding(.vertical, 9)
    }
}

@MainActor
private struct BlabeeTestSharedScreen: View {
    @ObservedObject var composition: BlabeeTestComposition
    @ObservedObject var controller: BlabeeTestWorkspaceController
    let generation: UUID
    private var isCurrent: Bool {
        controller.isRunActive && composition.isActive
            && controller.composition === composition && controller.viewGeneration == generation
    }

    var body: some View {
        switch controller.page {
        case .onboarding:
            PetFirstRunView(controller: composition.firstRun, viewModel: composition.viewModel,
                            preferences: composition.preferences,
                            onFinish: { deferred in
                guard isCurrent else { return }
                if composition.firstRun.finishSetup(isReady: composition.viewModel.isConnectionSetupReady,
                                                    connectionDeferred: deferred) {
                    Task { await controller.showPage(.cards, expectedGeneration: generation) }
                }
            }, onClose: {
                guard isCurrent else { return }
                Task { await controller.showPage(.connection, expectedGeneration: generation) }
            })
        case .connection:
            ScrollView {
                PetConnectionSetupView(viewModel: composition.viewModel).padding(20)
            }
        case .cards:
            PetRootView(viewModel: composition.viewModel, usesSystemGlassSurface: false)
        case .settings:
            PetSettingsView(viewModel: composition.viewModel).padding(20)
        }
    }
}

extension BlabeeTestScenario {
    var localizedTitle: String {
        switch self {
        case .freshInstall: PetL10n.text("Fresh Install", korean: "처음 설치")
        case .codexMissing: PetL10n.text("Codex Not Installed", korean: "Codex 미설치")
        case .pluginPreparing: PetL10n.text("Plugin Preparing", korean: "Plugin 준비 중")
        case .hookPending: PetL10n.text("Hook Review Pending", korean: "Hook 검토 대기")
        case .connectionFailed: PetL10n.text("Connection Failed", korean: "연결 실패")
        case .connected: PetL10n.text("Connected", korean: "연결 완료")
        case .delayedResponse: PetL10n.text("Delayed Response", korean: "늦은 응답")
        case .loginCancelled: PetL10n.text("Login Cancelled", korean: "로그인 취소")
        case .loginFailed: PetL10n.text("Login Failed", korean: "로그인 실패")
        case .engineIsolation: PetL10n.text("M2 · Real Engine", korean: "M2 · 실제 Engine")
        }
    }
}

@MainActor
private final class BlabeeTestApplicationDelegate: NSObject, NSApplicationDelegate {
    let controller: BlabeeTestWorkspaceController
    private var window: NSWindow?
    private var statusItem: NSStatusItem?
    private var terminating = false
    init(controller: BlabeeTestWorkspaceController) { self.controller = controller }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 780),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Blabee Test · UI Simulation / Isolated Engine"
        window.contentMinSize = NSSize(width: 460, height: 550)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: BlabeeTestWorkspaceView(controller: controller))
        window.center()
        self.window = window
        controller.onRequestClose = { [weak self] in self?.window?.orderOut(nil) }
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "Blabee TEST"
        status.button?.target = self
        status.button?.action = #selector(showWindow)
        statusItem = status
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Show Blabee Test", action: #selector(showWindow), keyEquivalent: "0").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Blabee Test", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let item = NSMenuItem()
        item.submenu = appMenu
        menu.addItem(item)
        NSApplication.shared.mainMenu = menu
        showWindow()
    }

    @objc private func showWindow() {
        window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow(); return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        terminating = true
        Task {
            let stopped = await controller.shutdown()
            if !stopped { terminating = false }
            sender.reply(toApplicationShouldTerminate: stopped)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
    }
}

@MainActor
func runBlabeeTestApplication(arguments: [String]) throws {
    try BlabeeTestLaunchPolicy.validate(arguments: arguments, bundleURL: Bundle.main.bundleURL,
                                        info: Bundle.main.infoDictionary ?? [:])
    let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore())
    let delegate = BlabeeTestApplicationDelegate(controller: controller)
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    application.delegate = delegate
    withExtendedLifetime(delegate) { application.run() }
}

/// A failed check still owns its run until the directly created child exits.
/// Report a cleanup timeout once, then keep the event loop and lease alive so
/// another Test instance cannot adopt storage that the child still uses.
@MainActor
func drainBlabeeTestEngineCheck(
    session: BlabeeTestEngineSession?, lease: BlabeeTestRunLease?,
    onPendingCleanup: @MainActor (String) -> Void,
    wait: @MainActor () async -> Void = { try? await Task.sleep(for: .milliseconds(100)) }
) async -> String? {
    var cleanupCode: String?
    while true {
        do {
            try await session?.drain()
            lease?.release()
            return cleanupCode
        } catch {
            if cleanupCode == nil {
                let code = (error as? CoordinatorError)?.code ?? "test_engine_cleanup_failed"
                cleanupCode = code
                onPendingCleanup(code)
            }
            await wait()
        }
    }
}

/// Developer acceptance on a newly created /private/tmp run. Requests and
/// normal shutdown are bounded; failed cleanup retains ownership until exit.
/// This command exists only in the Test compilation and cannot adopt a saved run.
@MainActor
func runBlabeeTestEngineCheck(arguments: [String]) throws {
    _ = try BlabeeTestEngineBundleGuard.currentExecutable()
    let prefix = "blabee-test-m2-check-"
    guard arguments.count == 2, arguments[0] == "--store-root" else {
        throw CoordinatorError("test_engine_check_arguments_invalid")
    }
    let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
    guard root.path == arguments[1], root.deletingLastPathComponent().path == "/private/tmp",
          root.lastPathComponent.hasPrefix(prefix),
          let checkID = UUID(uuidString: String(root.lastPathComponent.dropFirst(prefix.count))),
          root.lastPathComponent == prefix + checkID.uuidString.lowercased() else {
        throw CoordinatorError("test_engine_check_arguments_invalid")
    }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                            attributes: [.posixPermissions: 0o700])
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    Task { @MainActor in
        var session: BlabeeTestEngineSession?
        var lease: BlabeeTestRunLease?
        var ownedRunID: String?
        do {
            let store = try BlabeeTestRunStore(rootURL: root.appendingPathComponent("test-store"))
            let run = try store.create(scenario: .engineIsolation)
            ownedRunID = run.runID.uuidString.lowercased()
            lease = try store.acquireLease(for: run)
            let engine = try BlabeeTestEngineSession(store: store, run: run)
            session = engine
            _ = try engine.start()
            let initial = try await engine.report()
            guard initial.eventCount == 0 else { throw CoordinatorError("test_engine_check_initial_state") }
            _ = try await engine.seed()
            let snapshot = try await engine.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
            guard let card = try PetSnapshot.parse(snapshot).interactions.first,
                  let choice = card.actionChoices.first else {
                throw CoordinatorError("test_engine_check_card_missing")
            }
            _ = try await engine.request(type: "focus_interaction", payload: StrictJSONTransport.data(
                forJSONObject: PetFocusRequest(identity: card.identity).jsonObject))
            let selection = try PetSelectionRequest(identity: card.identity,
                selectionID: "m2_check_selection_" + checkID.uuidString.lowercased(), optionID: choice.optionID)
            _ = try await engine.request(type: "select", payload: StrictJSONTransport.data(forJSONObject: selection.jsonObject))
            let queued = try await engine.report()
            guard queued.fixtureQueueCount == 1, queued.claimCount == 0 else {
                throw CoordinatorError("test_engine_check_queue")
            }
            let claim = try await engine.claim()
            let retry = try await engine.claim()
            guard claim.claimCount == 1, retry.claimCount == 1,
                  claim.eventCount == retry.eventCount,
                  retry.lastClaimPromptOrigin == "blabee_next_turn" else {
                throw CoordinatorError("test_engine_check_claim")
            }
            let firstLaunch = engine.launchID
            await engine.ownedChild?.stop()
            _ = try engine.start()
            let restarted = try await engine.report()
            guard engine.launchID != firstLaunch, restarted.claimCount == 1,
                  restarted.fixtureQueueCount == 0, restarted.eventCount == retry.eventCount else {
                throw CoordinatorError("test_engine_check_restart")
            }
            do {
                _ = try await engine.claim()
                throw CoordinatorError("test_engine_check_replayed_action")
            } catch let error as CoordinatorError where error.code == "blabee_test_engine_no_queued_action" {}
            try await engine.drain()
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try store.saveResult(encoder.encode(restarted), for: run)
            lease?.release()
            let result: [String: Any] = [
                "kind": "blabee_test_engine_live_check", "status": "passed",
                "run_id": run.runID.uuidString.lowercased(), "run_root": run.rootPath,
                "freshness_account": engine.paths.freshnessAccount, "freshness_backend": "Keychain",
                "integrity_check": restarted.integrityCheck, "queue_count_before_claim": queued.fixtureQueueCount,
                "claim_count": retry.claimCount, "same_turn_retry_added_events": retry.eventCount - claim.eventCount,
                "restart_queue_count": restarted.fixtureQueueCount, "restart_claim_count": restarted.claimCount,
                "child_stopped": engine.ownedChild == nil,
                "provider_execution_count": restarted.providerExecutionCount,
            ]
            try FileHandle.standardOutput.write(contentsOf: StrictJSONTransport.data(forJSONObject: result))
            exit(0)
        } catch {
            let code = (error as? CoordinatorError)?.code ?? "test_engine_check_failed"
            let cleanupCode = await drainBlabeeTestEngineCheck(session: session, lease: lease) { cleanup in
                let pending: [String: Any] = [
                    "kind": "blabee_test_engine_live_check", "status": "cleanup_pending", "code": code,
                    "cleanup_code": cleanup, "child_stopped": false, "run_id": ownedRunID ?? "not_created",
                ]
                if var data = try? StrictJSONTransport.data(forJSONObject: pending) {
                    data.append(0x0a)
                    try? FileHandle.standardOutput.write(contentsOf: data)
                }
            }
            var result: [String: Any] = ["kind": "blabee_test_engine_live_check", "status": "failed",
                "code": code, "child_stopped": true, "run_id": ownedRunID ?? "not_created"]
            if let cleanupCode { result["cleanup_code"] = cleanupCode }
            if let data = try? StrictJSONTransport.data(forJSONObject: result) {
                try? FileHandle.standardOutput.write(contentsOf: data)
            }
            exit(1)
        }
    }
    application.run()
}
#endif

import AppKit
import BlabeeProductSupport
import CoordinatorSwift
import Foundation
import SwiftUI

/// The installed-only entry prevents a translocated Launch Services result from
/// recursively opening the installer. It creates no Pet/service state on failure.
enum AppInstallationEntry {
    static func validateInstalledLaunch(
        arguments: [String],
        environment: ProductInvocationEnvironment,
        currentIdentity: () throws -> String = { try OperationalRuntimeIdentity.requireCurrent() },
        installedIdentity: (URL) -> String? = { OperationalRuntimeIdentity.installedIdentity(forExecutable: $0) },
        canonicalURL: (URL) -> URL = { $0.resolvingSymlinksInPath().standardizedFileURL }
    ) throws {
        guard arguments.isEmpty,
              ProductInvocationResolver.isStandardInstalledApp(environment),
              let appURL = environment.bundleURL,
              let executableURL = environment.executableURL,
              canonicalURL(appURL) == appURL.standardizedFileURL,
              canonicalURL(executableURL) == executableURL.standardizedFileURL
        else { throw CoordinatorError("app_installation_unexpected_launch_location") }
        let running = try currentIdentity()
        guard OperationalRuntimeIdentity.isValid(running), installedIdentity(executableURL) == running
        else { throw CoordinatorError("app_installation_launch_identity_mismatch") }
    }
}

enum AppInstallationPhase: Equatable {
    case idle, inspecting, ready, waitingForSafePoint, installing, opening, failed, launched

    var isBusy: Bool { self == .inspecting || self == .waitingForSafePoint || self == .installing || self == .opening }
}

enum AppInstallationPrimaryAction: Equatable {
    case install, confirmReplacement, openExisting

    static func forComparison(_ comparison: AppInstallationComparison) -> Self {
        switch comparison {
        case .freshInstall: .install
        case .upgrade, .sameVersion: .confirmReplacement
        case .sameIdentity, .downgrade, .unknown: .openExisting
        }
    }
}

@MainActor
final class AppInstallationViewModel: ObservableObject {
    @Published private(set) var phase: AppInstallationPhase = .idle
    @Published private(set) var plan: AppInstallationPlan?
    @Published private(set) var receipt: AppInstallationReceipt?
    @Published private(set) var message: String?
    @Published private(set) var recoveryURL: URL?
    @Published var showsReplacementConfirmation = false
    @Published private(set) var canConfirmLegacyQuit = false
    @Published var showsLegacyQuitConfirmation = false
    @Published private(set) var requiresFinderRecovery = false

    let sourceURL: URL
    private let inspect: @Sendable () throws -> AppInstallationPlan
    private let install: @Sendable (AppInstallationPlan, Bool, Bool) throws -> AppInstallationReceipt
    private let openInstalled: @MainActor (URL, String) async throws -> Void
    private let showInFinder: @MainActor (URL) throws -> Void
    private let didLaunch: @MainActor () -> Void
    private let safePointWaiter: AppUpdateSafePointWaiter
    private var replacementRequested = false
    private var legacyReplacementRequested = false

    init(
        sourceURL: URL,
        inspect: @escaping @Sendable () throws -> AppInstallationPlan,
        install: @escaping @Sendable (AppInstallationPlan, Bool, Bool) throws -> AppInstallationReceipt,
        openInstalled: @escaping @MainActor (URL, String) async throws -> Void,
        showInFinder: @escaping @MainActor (URL) throws -> Void = { _ in },
        didLaunch: @escaping @MainActor () -> Void = {},
        safePointWaiter: AppUpdateSafePointWaiter = .init(requireReady: { _ in })
    ) {
        self.sourceURL = sourceURL
        self.inspect = inspect
        self.install = install
        self.openInstalled = openInstalled
        self.showInFinder = showInFinder
        self.didLaunch = didLaunch
        self.safePointWaiter = safePointWaiter
    }

    static func live(sourceURL: URL, didLaunch: @escaping @MainActor () -> Void) -> AppInstallationViewModel {
        let opener = AppInstallationApplicationOpener()
        let guardProcess = AppInstallationProcessGuard()
        let service: @Sendable () throws -> AppInstallationService = {
            guard let identity = try? OperationalRuntimeIdentity.requireCurrent() else {
                throw AppInstallationError(.invalidSource)
            }
            return AppInstallationService.live(
                expectedSourceIdentity: identity,
                activityGuard: { try guardProcess.requireInactive($0) }
            )
        }
        return AppInstallationViewModel(
            sourceURL: sourceURL,
            inspect: { try service().inspect(source: sourceURL) },
            install: { try service().install($0, replacementApproved: $1, legacyQuitConfirmed: $2) },
            openInstalled: { try await opener.openInstalled(applicationURL: $0, expectedIdentity: $1) },
            showInFinder: { try opener.showInFinder($0) },
            didLaunch: didLaunch,
            safePointWaiter: .init()
        )
    }

    var primaryTitle: String {
        if requiresFinderRecovery { return PetL10n.text("Recover Installation in Finder", korean: "Finder에서 설치 복구") }
        if receipt != nil { return PetL10n.text("Reopen Installed Blabee", korean: "설치된 Blabee 다시 열기") }
        guard let plan else { return PetL10n.text("Install in Applications and Start", korean: "응용 프로그램에 설치하고 시작") }
        return AppInstallationPrimaryAction.forComparison(plan.comparison) == .openExisting
            ? PetL10n.text("Open Installed Blabee", korean: "설치된 Blabee 열기") : PetL10n.text("Install in Applications and Start", korean: "응용 프로그램에 설치하고 시작")
    }

    var title: String {
        if requiresFinderRecovery { return PetL10n.text("Check the installed app's launch", korean: "설치된 앱 실행을 확인해 주세요") }
        if receipt != nil || plan?.existing != nil { return PetL10n.text("Blabee is already installed", korean: "설치된 Blabee가 있습니다") }
        return PetL10n.text("Blabee needs to be installed", korean: "Blabee 설치가 필요합니다")
    }

    var explanation: String {
        if requiresFinderRecovery {
            return PetL10n.text("The app is installed, but launch from that location could not be confirmed. Finish installation in Finder without repeating the same launch.", korean: "앱은 설치되어 있지만 설치된 위치에서 실행됐는지 확인하지 못했습니다. 같은 실행을 반복하지 않고 Finder에서 설치를 마무리합니다.")
        }
        if receipt != nil || plan?.existing != nil {
            return PetL10n.text("The app in Applications has been verified. Check its version and build below, then open or update it.", korean: "응용 프로그램 폴더의 앱을 확인했습니다. 아래 버전과 빌드를 확인하고 설치된 앱을 열거나 업데이트하세요.")
        }
        return PetL10n.text("Install the app in Applications to set up the Codex connection. Codex itself and existing conversations will remain unchanged.", korean: "앱을 응용 프로그램 폴더에 설치하면 Codex 연결을 설정할 수 있습니다. Codex 자체와 기존 대화는 변경하지 않습니다.")
    }

    var finderRecoveryInstructions: String {
        PetL10n.text("1. Save your work and exit Blabee and connected Codex sessions normally. Close this installation window too.\n", korean: "1. 작업을 저장하고 Blabee와 연결된 Codex 세션을 정상 종료합니다. 이 설치 창도 닫습니다.\n")
            + PetL10n.text("2. In Finder, move Blabee.app from Applications to a temporary folder, then move it back and launch it. Simply reopening it is not the same step.\n", korean: "2. Finder에서 응용 프로그램의 Blabee.app을 임시 폴더로 옮긴 뒤, 다시 응용 프로그램으로 옮겨 실행합니다. 단순히 다시 여는 것과 다른 단계입니다.\n")
            + PetL10n.text("3. If it still does not launch, download the latest notarized DMG and drag the app into Applications using Finder. If macOS security warnings repeat, record them and contact support.", korean: "3. 계속 실행되지 않으면 공증된 최신 DMG를 다시 받아 Finder에서 앱을 응용 프로그램으로 드래그해 설치하세요. macOS 보안 경고가 반복되면 내용을 기록해 문의해 주세요.")
    }

    var progressText: String {
        switch phase {
        case .inspecting: PetL10n.text("Checking the app and installation location…", korean: "앱과 설치 위치를 확인하고 있습니다…")
        case .waitingForSafePoint: PetL10n.text("Waiting for active requests to finish…", korean: "진행 중인 요청이 끝나기를 기다립니다…")
        case .installing: PetL10n.text("Copying and verifying the entire app…", korean: "앱 전체를 복사하고 검증하고 있습니다…")
        case .opening: PetL10n.text("Opening installed Blabee…", korean: "설치된 Blabee를 열고 있습니다…")
        default: ""
        }
    }

    var replacementExplanation: String {
        guard let plan, let existing = plan.existing else { return "" }
        return PetL10n.text("Replace the existing \(existing.version) (build \(existing.build)) with ", korean: "기존 \(existing.version) (빌드 \(existing.build))을 ")
            + PetL10n.text("\(plan.source.version) (build \(plan.source.build)). ", korean: "\(plan.source.version) (빌드 \(plan.source.build))으로 교체합니다. ")
            + PetL10n.text("The existing app will be preserved in a separate backup in Applications. User data and Codex will remain unchanged.", korean: "기존 앱은 응용 프로그램 폴더의 별도 백업에 보존합니다. 사용자 데이터와 Codex는 변경하지 않습니다.")
    }

    var legacyReplacementExplanation: String {
        PetL10n.text("macOS could not identify some process executables, so it is not confirmed that all previous Blabee processes have closed. ", korean: "macOS가 일부 프로세스의 실행 파일을 확인하지 못해, 기존 Blabee가 모두 종료됐는지는 확인되지 않았습니다. ")
            + PetL10n.text("Save your work and close Blabee and connected Codex sessions before continuing. ", korean: "작업을 저장하고 Blabee와 연결된 Codex 세션을 종료한 뒤 진행하세요. ")
            + PetL10n.text("Any unfinished work may lose its connection or encounter errors.\n\n", korean: "종료하지 않은 작업이 있으면 연결이 중단되거나 오류가 날 수 있습니다.\n\n")
            + replacementExplanation
    }

    func refresh() async {
        guard !phase.isBusy, phase != .launched, !requiresFinderRecovery else { return }
        // After publication, a retry must open the same installation, never copy again.
        guard receipt == nil else { return }
        phase = .inspecting
        message = nil
        recoveryURL = nil
        plan = nil
        showsReplacementConfirmation = false
        replacementRequested = false
        canConfirmLegacyQuit = false
        cancelLegacyReplacement()
        let inspect = self.inspect
        do {
            plan = try await Task.detached(priority: .userInitiated) { try inspect() }.value
            phase = .ready
        } catch { record(error) }
    }

    func performPrimary() async {
        guard !phase.isBusy, phase != .launched else { return }
        if requiresFinderRecovery {
            if let destination = receipt?.destinationURL ?? plan?.destinationURL {
                reveal(destination)
            }
            return
        }
        if let receipt {
            await open(applicationURL: receipt.destinationURL, identity: receipt.identity)
            return
        }
        guard let plan else { return }
        switch AppInstallationPrimaryAction.forComparison(plan.comparison) {
        case .install:
            await performInstall(plan, replacementApproved: false)
        case .confirmReplacement:
            replacementRequested = true
            showsReplacementConfirmation = true
        case .openExisting:
            guard let existing = plan.existing else { return }
            await open(applicationURL: plan.destinationURL, identity: existing.runtimeIdentity)
        }
    }

    func confirmReplacement() async {
        // SwiftUI may dismiss the dialog binding before invoking its action.
        guard replacementRequested, !phase.isBusy, let plan,
              AppInstallationPrimaryAction.forComparison(plan.comparison) == .confirmReplacement
        else { return }
        showsReplacementConfirmation = false
        replacementRequested = false
        await performInstall(plan, replacementApproved: true)
    }

    func cancelReplacement() {
        showsReplacementConfirmation = false
        replacementRequested = false
    }

    func prepareLegacyReplacement() async {
        guard canConfirmLegacyQuit, !phase.isBusy, phase != .launched, receipt == nil else { return }
        // A failed transaction invalidated the previous plan. Inspect again
        // before showing the exact versions and requesting one-use consent.
        await refresh()
        guard phase == .ready, let plan, plan.existing != nil,
              AppInstallationPrimaryAction.forComparison(plan.comparison) == .confirmReplacement
        else { return }
        legacyReplacementRequested = true
        showsLegacyQuitConfirmation = true
    }

    func confirmLegacyReplacement() async {
        guard legacyReplacementRequested, !phase.isBusy, phase != .launched,
              receipt == nil, let plan, plan.existing != nil,
              AppInstallationPrimaryAction.forComparison(plan.comparison) == .confirmReplacement
        else { return }
        cancelLegacyReplacement()
        await performInstall(plan, replacementApproved: true, legacyQuitConfirmed: true)
    }

    func cancelLegacyReplacement() {
        showsLegacyQuitConfirmation = false
        legacyReplacementRequested = false
    }

    func reveal(_ url: URL) {
        guard !phase.isBusy else { return }
        do { try showInFinder(url) } catch { record(error) }
    }

    private func performInstall(
        _ plan: AppInstallationPlan,
        replacementApproved: Bool,
        legacyQuitConfirmed: Bool = false
    ) async {
        phase = .installing
        message = nil
        canConfirmLegacyQuit = false
        cancelLegacyReplacement()
        let install = self.install
        do {
            if plan.existing != nil {
                phase = .waitingForSafePoint
                try await safePointWaiter.wait(candidateApplicationURL: sourceURL) { reason in
                    self.message = reason
                }
                phase = .installing
                message = nil
            }
            let receipt = try await Task.detached(priority: .userInitiated) {
                try install(plan, replacementApproved, legacyQuitConfirmed)
            }.value
            self.receipt = receipt
            recoveryURL = receipt.backupURL
            await open(applicationURL: receipt.destinationURL, identity: receipt.identity)
        } catch {
            // A new click must inspect and reconfirm after any failed transaction.
            self.plan = nil
            record(error)
            canConfirmLegacyQuit = receipt == nil && plan.existing != nil
                && AppInstallationPrimaryAction.forComparison(plan.comparison) == .confirmReplacement
                && (error as? AppInstallationError)?.code == .activityInspectionIncomplete
        }
    }

    private func open(applicationURL: URL, identity: String) async {
        phase = .opening
        message = nil
        do {
            try await openInstalled(applicationURL, identity)
            phase = .launched
            didLaunch()
        } catch {
            record(error)
            // installed-pet can reject the location and exit before the parent
            // sees its path. Neither result proves translocation specifically.
            // Preserve the installation/receipt and require user-mediated
            // recovery rather than offer another identical launch or copy.
            switch error as? AppInstallationPlatformError {
            case .launchedApplicationMismatch, .launchedProcessExited, .launchFailed, .launchTimedOut:
                requiresFinderRecovery = true
            default:
                break
            }
        }
    }

    private func record(_ error: Error) {
        phase = .failed
        if let error = error as? AppInstallationError {
            message = error.userMessage
            recoveryURL = error.recoveryURL ?? recoveryURL
        } else if let error = error as? AppInstallationPlatformError {
            message = error.userMessage
        } else if error is AppUpdateAdmissionError || error is AppUpdateTransactionError
                    || error is AppUpdateTransitionError {
            message = AppUpdateTransactionEngine.message(error)
        } else {
            message = PetL10n.text("Unable to verify installation. Copy Blabee into Applications using Finder, then open it.", korean: "설치를 확인하지 못했습니다. Finder에서 Blabee를 응용 프로그램 폴더로 복사한 뒤 열어 주세요.")
        }
    }
}

private struct AppInstallationView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var model: AppInstallationViewModel
    let close: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "app.badge.checkmark")
                    .font(.system(size: 38)).foregroundStyle(.tint).accessibilityHidden(true)
                Text(model.title).font(.blabee(.title, weight: .semibold))
                Text(model.explanation)
                    .foregroundStyle(.secondary)
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(PetL10n.text("Install location: /Applications/Blabee.app", korean: "설치 위치: /Applications/Blabee.app")).font(.blabee(.body, weight: .medium))
                        Text(PetL10n.text("Current location: \(model.sourceURL.path)", korean: "현재 위치: \(model.sourceURL.path)"))
                            .font(.blabee(.caption)).foregroundStyle(.secondary).textSelection(.enabled)
                        if let plan = model.plan {
                            Text(PetL10n.text("This app: \(plan.source.version) · Build \(plan.source.build)", korean: "이 앱: \(plan.source.version) · 빌드 \(plan.source.build)"))
                            if let existing = plan.existing {
                                Text(PetL10n.text("Installed app: \(existing.version) · Build \(existing.build)", korean: "설치된 앱: \(existing.version) · 빌드 \(existing.build)"))
                                if AppInstallationPrimaryAction.forComparison(plan.comparison) == .openExisting {
                                    Text(PetL10n.text("Keep the existing app and open installed Blabee.", korean: "기존 앱을 보존하고 설치된 Blabee를 엽니다.")).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
                if model.phase.isBusy {
                    HStack { ProgressView().controlSize(.small); Text(model.progressText) }
                        .accessibilityElement(children: .combine)
                }
                if let message = model.message {
                    Label(message, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                }
                if model.requiresFinderRecovery {
                    GroupBox(PetL10n.text("Finish Installation in Finder", korean: "Finder에서 설치 마무리")) {
                        Text(model.finderRecoveryInstructions)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(6)
                    }
                }
                if let recovery = model.recoveryURL {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(PetL10n.text("Preserved App or Recovery Files", korean: "보존된 앱 또는 복구 자료")).font(.blabee(.caption, weight: .semibold))
                        Text(recovery.path).font(.blabee(.caption)).textSelection(.enabled)
                        Button(PetL10n.text("View Recovery Files in Finder", korean: "Finder에서 복구 자료 확인")) { model.reveal(recovery) }
                    }
                }
                Button(model.primaryTitle) { Task { await model.performPrimary() } }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(model.phase.isBusy || (model.plan == nil && model.receipt == nil))
                if model.canConfirmLegacyQuit {
                    Button(PetL10n.text("Confirm Closed and Replace", korean: "종료 확인 후 교체")) { Task { await model.prepareLegacyReplacement() } }
                        .controlSize(.large).disabled(model.phase.isBusy)
                }
                HStack {
                    Button(PetL10n.text("Open Applications Folder", korean: "응용 프로그램 폴더 열기")) {
                        model.reveal(URL(fileURLWithPath: "/Applications", isDirectory: true))
                    }
                    if model.receipt == nil && !model.requiresFinderRecovery {
                        Button(PetL10n.text("Check Again", korean: "다시 확인")) { Task { await model.refresh() } }
                    }
                    Spacer()
                    Button(PetL10n.text("Close", korean: "닫기"), action: close)
                }.disabled(model.phase.isBusy)
                Text(PetL10n.text("Review any permission request from macOS. If automatic installation fails, you can copy the app using Finder.", korean: "macOS가 권한을 요청하면 직접 확인해 주세요. 자동 설치가 안 되면 Finder에서 앱을 복사할 수 있습니다."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }.padding(28)
        }
        .font(.blabee(.body))
        .frame(width: 580, height: 570)
        .task { await model.refresh() }
        .confirmationDialog(PetL10n.text("Back up and replace existing Blabee?", korean: "기존 Blabee를 백업하고 교체할까요?"), isPresented: $model.showsReplacementConfirmation) {
            Button(PetL10n.text("Back Up and Replace", korean: "백업하고 교체")) { Task { await model.confirmReplacement() } }
            Button(PetL10n.text("Cancel", korean: "취소"), role: .cancel) { model.cancelReplacement() }
        } message: { Text(model.replacementExplanation) }
        .confirmationDialog(PetL10n.text("Have you closed Blabee and connected Codex sessions?", korean: "Blabee와 연결된 Codex 세션을 종료했나요?"), isPresented: $model.showsLegacyQuitConfirmation) {
            Button(PetL10n.text("Closed — Back Up and Replace", korean: "종료했으며, 백업하고 교체")) { Task { await model.confirmLegacyReplacement() } }
            Button(PetL10n.text("Cancel", korean: "취소"), role: .cancel) { model.cancelLegacyReplacement() }
        } message: { Text(model.legacyReplacementExplanation) }
    }
}

@MainActor
private final class AppInstallationApplicationDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var model: AppInstallationViewModel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let model = AppInstallationViewModel.live(sourceURL: Bundle.main.bundleURL) {
            NSApplication.shared.terminate(nil)
        }
        self.model = model
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 570),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = PetL10n.text("Install Blabee", korean: "Blabee 설치")
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = NSHostingView(rootView: AppInstallationView(model: model) {
            NSApplication.shared.terminate(nil)
        })
        self.window = window
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { model?.phase.isBusy != true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        model?.phase.isBusy == true ? .terminateCancel : .terminateNow
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@MainActor
func runAppInstallation() {
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    let menu = NSMenu()
    let item = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: PetL10n.text("Quit Blabee", korean: "Blabee 종료"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.submenu = appMenu
    menu.addItem(item)
    application.mainMenu = menu
    let delegate = AppInstallationApplicationDelegate()
    application.delegate = delegate
    application.run()
    withExtendedLifetime(delegate) {}
}

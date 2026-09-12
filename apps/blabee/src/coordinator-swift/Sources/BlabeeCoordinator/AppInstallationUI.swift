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
    case idle, inspecting, ready, installing, opening, failed, launched

    var isBusy: Bool { self == .inspecting || self == .installing || self == .opening }
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

    let sourceURL: URL
    private let inspect: @Sendable () throws -> AppInstallationPlan
    private let install: @Sendable (AppInstallationPlan, Bool, Bool) throws -> AppInstallationReceipt
    private let openInstalled: @MainActor (URL, String) async throws -> Void
    private let showInFinder: @MainActor (URL) throws -> Void
    private let didLaunch: @MainActor () -> Void
    private var replacementRequested = false
    private var legacyReplacementRequested = false

    init(
        sourceURL: URL,
        inspect: @escaping @Sendable () throws -> AppInstallationPlan,
        install: @escaping @Sendable (AppInstallationPlan, Bool, Bool) throws -> AppInstallationReceipt,
        openInstalled: @escaping @MainActor (URL, String) async throws -> Void,
        showInFinder: @escaping @MainActor (URL) throws -> Void = { _ in },
        didLaunch: @escaping @MainActor () -> Void = {}
    ) {
        self.sourceURL = sourceURL
        self.inspect = inspect
        self.install = install
        self.openInstalled = openInstalled
        self.showInFinder = showInFinder
        self.didLaunch = didLaunch
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
            didLaunch: didLaunch
        )
    }

    var primaryTitle: String {
        if receipt != nil { return "설치된 Blabee 다시 열기" }
        guard let plan else { return "응용 프로그램에 설치하고 시작" }
        return AppInstallationPrimaryAction.forComparison(plan.comparison) == .openExisting
            ? "설치된 Blabee 열기" : "응용 프로그램에 설치하고 시작"
    }

    var progressText: String {
        switch phase {
        case .inspecting: "앱과 설치 위치를 확인하고 있습니다…"
        case .installing: "앱 전체를 복사하고 검증하고 있습니다…"
        case .opening: "설치된 Blabee를 열고 있습니다…"
        default: ""
        }
    }

    var replacementExplanation: String {
        guard let plan, let existing = plan.existing else { return "" }
        return "기존 \(existing.version) (빌드 \(existing.build))을 "
            + "\(plan.source.version) (빌드 \(plan.source.build))으로 교체합니다. "
            + "기존 앱은 응용 프로그램 폴더의 별도 백업에 보존합니다. 사용자 데이터와 Codex는 변경하지 않습니다."
    }

    var legacyReplacementExplanation: String {
        "macOS가 일부 프로세스의 실행 파일을 확인하지 못해, 기존 Blabee가 모두 종료됐는지는 확인되지 않았습니다. "
            + "작업을 저장하고 Blabee와 연결된 Codex 세션을 종료한 뒤 진행하세요. "
            + "종료하지 않은 작업이 있으면 연결이 중단되거나 오류가 날 수 있습니다.\n\n"
            + replacementExplanation
    }

    func refresh() async {
        guard !phase.isBusy, phase != .launched else { return }
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
        } catch { record(error) }
    }

    private func record(_ error: Error) {
        phase = .failed
        if let error = error as? AppInstallationError {
            message = error.userMessage
            recoveryURL = error.recoveryURL ?? recoveryURL
        } else if let error = error as? AppInstallationPlatformError {
            message = error.userMessage
        } else {
            message = "설치를 확인하지 못했습니다. Finder에서 Blabee를 응용 프로그램 폴더로 복사한 뒤 열어 주세요."
        }
    }
}

private struct AppInstallationView: View {
    @ObservedObject var model: AppInstallationViewModel
    let close: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "app.badge.checkmark")
                    .font(.system(size: 38)).foregroundStyle(.tint).accessibilityHidden(true)
                Text("Blabee 설치가 필요합니다").font(.title).fontWeight(.semibold)
                Text("앱을 응용 프로그램 폴더에 설치하면 Codex 연결을 설정할 수 있습니다. Codex 자체와 기존 대화는 변경하지 않습니다.")
                    .foregroundStyle(.secondary)
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("설치 위치: /Applications/Blabee.app").fontWeight(.medium)
                        Text("현재 위치: \(model.sourceURL.path)")
                            .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        if let plan = model.plan {
                            Text("이 앱: \(plan.source.version) · 빌드 \(plan.source.build)")
                            if let existing = plan.existing {
                                Text("설치된 앱: \(existing.version) · 빌드 \(existing.build)")
                                if AppInstallationPrimaryAction.forComparison(plan.comparison) == .openExisting {
                                    Text("기존 앱을 보존하고 설치된 Blabee를 엽니다.").foregroundStyle(.secondary)
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
                if let recovery = model.recoveryURL {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("보존된 앱 또는 복구 자료").font(.caption).fontWeight(.semibold)
                        Text(recovery.path).font(.caption).textSelection(.enabled)
                        Button("Finder에서 복구 자료 확인") { model.reveal(recovery) }
                    }
                }
                Button(model.primaryTitle) { Task { await model.performPrimary() } }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(model.phase.isBusy || (model.plan == nil && model.receipt == nil))
                if model.canConfirmLegacyQuit {
                    Button("종료 확인 후 교체") { Task { await model.prepareLegacyReplacement() } }
                        .controlSize(.large).disabled(model.phase.isBusy)
                }
                HStack {
                    Button("응용 프로그램 폴더 열기") {
                        model.reveal(URL(fileURLWithPath: "/Applications", isDirectory: true))
                    }
                    if model.receipt == nil {
                        Button("다시 확인") { Task { await model.refresh() } }
                    }
                    Spacer()
                    Button("닫기", action: close)
                }.disabled(model.phase.isBusy)
                Text("macOS가 권한을 요청하면 직접 확인해 주세요. 자동 설치가 안 되면 Finder에서 앱을 복사할 수 있습니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(28)
        }
        .frame(width: 580, height: 570)
        .task { await model.refresh() }
        .confirmationDialog("기존 Blabee를 백업하고 교체할까요?", isPresented: $model.showsReplacementConfirmation) {
            Button("백업하고 교체") { Task { await model.confirmReplacement() } }
            Button("취소", role: .cancel) { model.cancelReplacement() }
        } message: { Text(model.replacementExplanation) }
        .confirmationDialog("Blabee와 연결된 Codex 세션을 종료했나요?", isPresented: $model.showsLegacyQuitConfirmation) {
            Button("종료했으며, 백업하고 교체") { Task { await model.confirmLegacyReplacement() } }
            Button("취소", role: .cancel) { model.cancelLegacyReplacement() }
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
        window.title = "Blabee 설치"
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
    appMenu.addItem(withTitle: "Blabee 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.submenu = appMenu
    menu.addItem(item)
    application.mainMenu = menu
    let delegate = AppInstallationApplicationDelegate()
    application.delegate = delegate
    application.run()
    withExtendedLifetime(delegate) {}
}

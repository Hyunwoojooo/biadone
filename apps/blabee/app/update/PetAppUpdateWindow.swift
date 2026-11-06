import AppKit
import Combine
import SwiftUI

/// An application-owned window survives the floating panel disappearing while
/// the user saves work or closes sessions in another application.
@MainActor
final class PetAppUpdateWindowController: NSWindowController, NSWindowDelegate {
    let controller: AppUpdateTransactionController
    private var closeRequested = false
    private var phaseObservation: AnyCancellable?
    private var languageObservation: AnyCancellable?
    private var resultPollingTask: Task<Void, Never>?

    init(controller: AppUpdateTransactionController) {
        self.controller = controller
        super.init(window: nil)
        languageObservation = PetLocalization.shared.$language.dropFirst().sink { [weak self] _ in
            self?.window?.title = PetL10n.text("Blabee Update", korean: "Blabee 업데이트")
        }
        phaseObservation = controller.$phase.sink { [weak self] phase in
            // @Published delivers before the backing property changes, so use
            // the emitted phase for the title-bar button. The delegate still
            // checks canCancel, including the helper's process state.
            self?.window?.standardWindowButton(.closeButton)?.isEnabled =
                ![.startingHelper, .updating].contains(phase)
            self?.observeResultIfNeeded(phase)
        }
    }

    required init?(coder: NSCoder) { nil }

    deinit { resultPollingTask?.cancel() }

    func show(release: PetAppUpdateRelease? = nil) {
        if window == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 560),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.title = PetL10n.text("Blabee Update", korean: "Blabee 업데이트")
            window.minSize = NSSize(width: 460, height: 400)
            window.isReleasedWhenClosed = false
            window.hidesOnDeactivate = false
            window.contentView = NSHostingView(rootView: PetAppUpdateWindowView(
                controller: controller, onClose: { [weak self] in self?.close() }))
            window.delegate = self
            window.center()
            self.window = window
        }
        closeRequested = false
        window?.standardWindowButton(.closeButton)?.isEnabled = controller.canCancel
        window?.deminiaturize(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        observeResultIfNeeded(controller.phase)
        prepareIfNeeded(release)
    }

    /// Kept separate from showing an AppKit window so preparation/reopen policy
    /// can be checked using inert dependencies without presenting UI.
    func prepareIfNeeded(_ release: PetAppUpdateRelease?) {
        guard let release, release.installerAssets != nil, controller.canPrepare else { return }
        controller.startInteractivePreparation(release)
    }

    /// Cancel synchronously before the window disappears. This invalidates the
    /// operation even when the download or readiness check returns late.
    @discardableResult
    func requestClose() -> Bool {
        guard controller.canCancel else { return false }
        guard !closeRequested else { return true }
        closeRequested = true
        resultPollingTask?.cancel()
        resultPollingTask = nil
        switch controller.phase {
        case .idle, .preparing, .review, .waitingForSafePoint, .waitingForSessionExit, .deferred,
             .preparingConnectionRecovery, .connectionRestartRequired:
            controller.cancelInteractiveUpdate()
        case .failed where controller.preparedReview != nil:
            controller.cancelInteractiveUpdate()
        default:
            // Closing a result must preserve recovery restrictions and the
            // completed result. It is not a new cancellation or retry.
            break
        }
        return true
    }

    override func close() {
        guard requestClose() else { return }
        super.close()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { requestClose() }

    func windowWillClose(_ notification: Notification) {
        // Covers a programmatic AppKit close that does not ask the delegate.
        // A normal application termination during helper handoff cannot cancel.
        requestClose()
        resultPollingTask?.cancel()
        resultPollingTask = nil
    }

    private func observeResultIfNeeded(_ phase: AppUpdateTransactionController.Phase) {
        guard phase == .updating, window != nil, !closeRequested else {
            resultPollingTask?.cancel()
            resultPollingTask = nil
            return
        }
        guard resultPollingTask == nil else { return }
        resultPollingTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) }
                catch { return }
                guard let self, self.controller.phase == .updating else { return }
                // Read-only recovery observation, never an installation retry.
                self.controller.loadLastResult()
            }
        }
    }
}

@MainActor
struct PetAppUpdateWindowView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: AppUpdateTransactionController
    let onClose: () -> Void

    private var showsSessionInstructions: Bool {
        controller.preparedReview != nil
            && [.review, .deferred, .waitingForSessionExit, .waitingForSafePoint].contains(controller.phase)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Label(PetL10n.text("Update Blabee", korean: "Blabee 업데이트"), systemImage: "arrow.down.circle")
                    .font(.blabee(.title2, weight: .semibold))
                if let review = controller.preparedReview {
                    Text("\(review.currentVersion.displayLabel) → \(review.release.version.displayLabel)")
                        .font(.blabee(.callout)).foregroundStyle(.secondary)
                }
            }
            .padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 10) {
                        if controller.isBusy { ProgressView().controlSize(.small) }
                        VStack(alignment: .leading, spacing: 7) {
                            Text(PetAppUpdatePresentation.title(for: controller.phase))
                                .font(.blabee(.headline))
                            if !controller.detail.isEmpty {
                                Text(controller.detail)
                                    .font(.blabee(.callout)).foregroundStyle(.secondary)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .accessibilityIdentifier("app-update-window-status")

                    if showsSessionInstructions {
                        PetAppUpdateSessionInstructionsView()
                        ForEach(controller.preparedReview?.blockers ?? [], id: \.self) { blocker in
                            Label(blocker, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Text(PetAppUpdatePresentation.returnExplanation)
                            .font(.blabee(.caption)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if showsSessionInstructions || controller.phase == .preparingConnectionRecovery {
                        DisclosureGroup(PetAppUpdatePresentation.connectionRecoveryTitle) {
                            PetAppUpdateConnectionRecoveryInstructionsView(
                                canPrepare: controller.canPrepareConnectionRecovery,
                                prepare: controller.prepareConnectionRecoveryAfterRestart)
                        }
                        .font(.blabee(.callout))
                    }
                    if [.startingHelper, .updating].contains(controller.phase) {
                        Text(PetAppUpdatePresentation.restartExplanation)
                            .font(.blabee(.callout))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if [.failed, .recoveryRequired].contains(controller.phase) {
                        Button(PetL10n.text("Check Update Status", korean: "업데이트 상태 다시 확인")) {
                            controller.loadLastResult()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            Divider()
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    closeButton
                    Spacer(minLength: 0)
                    confirmationButton
                }
                VStack(alignment: .trailing, spacing: 10) {
                    confirmationButton
                    closeButton
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(20)
        }
        .frame(minWidth: 420, minHeight: 360)
        .accessibilityIdentifier("app-update-window")
    }

    private var closeButton: some View {
        Button(controller.isBusy || controller.preparedReview != nil
               ? PetL10n.text("Cancel Update", korean: "업데이트 취소")
               : PetL10n.text("Close", korean: "닫기"), action: onClose)
            .disabled(!controller.canCancel)
            .keyboardShortcut(.cancelAction)
            .accessibilityIdentifier("cancel-interactive-update")
    }

    @ViewBuilder
    private var confirmationButton: some View {
        if [.review, .deferred].contains(controller.phase) {
            Button(PetAppUpdatePresentation.confirmationTitle) {
                controller.confirmClosedSessionsAndInstall()
            }
            .buttonStyle(.borderedProminent)
            .disabled(!controller.canBeginInstallation)
            .accessibilityIdentifier("confirm-closed-sessions-update")
        }
    }
}

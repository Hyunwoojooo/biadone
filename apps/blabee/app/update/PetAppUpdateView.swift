import SwiftUI

/// Feedback is presentation-only; the release/error stays in the model after the label expires.
struct PetAppUpdateCheckFeedback: Equatable {
    static let duration: TimeInterval = 3
    private let updateAvailable: Bool
    let expiresAt: Date

    init?(state: PetAppUpdateState, now: Date = .now) {
        switch state {
        case .available: updateAvailable = true
        case .upToDate: updateAvailable = false
        case .notChecked, .checking, .noPublishedRelease, .unavailable: return nil
        }
        expiresAt = now.addingTimeInterval(Self.duration)
    }

    func title(at now: Date = .now) -> String? {
        guard now < expiresAt else { return nil }
        return updateAvailable
            ? PetL10n.text("Update Available", korean: "업데이트 가능")
            : PetL10n.text("Up to Date", korean: "최신 버전")
    }
}

struct PetAppUpdateCheckButton: View {
    @ObservedObject private var localization = PetLocalization.shared
    let state: PetAppUpdateState
    let checkForUpdates: () -> Void
    @State private var feedback: PetAppUpdateCheckFeedback?

    var body: some View {
        Button(action: checkForUpdates) {
            Text(state.isChecking ? PetL10n.text("Checking…", korean: "확인 중…") : feedback?.title() ?? PetL10n.text("Check for Updates", korean: "업데이트 확인"))
                .frame(minWidth: 84)
        }
            .font(.blabee(.caption))
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(state.isChecking)
            .accessibilityIdentifier("check-app-updates")
            .task(id: state) {
                feedback = PetAppUpdateCheckFeedback(state: state)
                guard feedback != nil else { return }
                do { try await Task.sleep(for: .seconds(PetAppUpdateCheckFeedback.duration)) }
                catch { return }
                feedback = nil
            }
    }
}

struct PetAppUpdateView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var viewModel: PetViewModel
    var showsCheckForUpdates = true

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PetAppUpdateStatusView(
                state: viewModel.appUpdateState,
                currentVersion: viewModel.appVersionDisplay,
                checkForUpdates: { Task { await viewModel.checkForAppUpdates() } },
                openUpdateLocation: viewModel.openAppUpdateLocation,
                showsCheckForUpdates: showsCheckForUpdates
            )
            PetAutomaticAppUpdateView(
                controller: viewModel.automaticAppUpdate,
                release: viewModel.appUpdateState.availableRelease,
                openUpdateWindow: viewModel.showAppUpdateWindow
            )
        }
    }
}

struct PetAppUpdateStatusView: View {
    @ObservedObject private var localization = PetLocalization.shared
    let state: PetAppUpdateState
    let currentVersion: String
    let checkForUpdates: () -> Void
    let openUpdateLocation: () -> Void
    var showsCheckForUpdates = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(PetL10n.text("App Update", korean: "앱 업데이트"))
                    .font(.blabee(.body, weight: .semibold))
                Text(PetL10n.text("Current version \(currentVersion)", korean: "현재 버전 \(currentVersion)"))
                    .font(.blabee(.caption))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(alignment: .top, spacing: 10) {
                if state.isChecking {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: state.symbolName)
                        .foregroundStyle(state.isFailure ? Color.orange : Color.accentColor)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 7) {
                    Text(state.title)
                        .font(.blabee(.callout, weight: .semibold))
                    if let latestVersion = state.latestVersionDisplay {
                        Text(PetL10n.text("Update version \(latestVersion)", korean: "업데이트 버전 \(latestVersion)"))
                            .font(.blabee(.caption, weight: .medium))
                    }
                    Text(state.detail)
                        .font(.blabee(.caption))
                        .foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("app-update-status")

            updateActions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var updateActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { updateButtons }
                .fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 10) { updateButtons }
        }
    }

    @ViewBuilder
    private var updateButtons: some View {
        if showsCheckForUpdates {
            PetAppUpdateCheckButton(state: state, checkForUpdates: checkForUpdates)
        }
        if let actionTitle = state.locationActionTitle {
            Button(actionTitle, action: openUpdateLocation)
                .buttonStyle(.borderedProminent)
                .disabled(state.isChecking)
                .accessibilityIdentifier("open-app-update-location")
        }
    }
}

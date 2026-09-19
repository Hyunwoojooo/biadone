import SwiftUI

/// Feedback is presentation-only; the release/error stays in the model after the label expires.
struct PetAppUpdateCheckFeedback: Equatable {
    static let duration: TimeInterval = 3
    private let resultTitle: String
    let expiresAt: Date

    init?(state: PetAppUpdateState, now: Date = .now) {
        switch state {
        case .available: resultTitle = "업데이트 가능"
        case .upToDate: resultTitle = "최신 버전"
        case .notChecked, .checking, .noPublishedRelease, .unavailable: return nil
        }
        expiresAt = now.addingTimeInterval(Self.duration)
    }

    func title(at now: Date = .now) -> String? {
        now < expiresAt ? resultTitle : nil
    }
}

struct PetAppUpdateCheckButton: View {
    let state: PetAppUpdateState
    let checkForUpdates: () -> Void
    @State private var feedback: PetAppUpdateCheckFeedback?

    var body: some View {
        Button(action: checkForUpdates) {
            Text(state.isChecking ? "확인 중…" : feedback?.title() ?? "업데이트 확인")
                .frame(minWidth: 84)
        }
            .font(.caption)
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
                release: viewModel.appUpdateState.availableRelease
            )
        }
    }
}

struct PetAppUpdateStatusView: View {
    let state: PetAppUpdateState
    let currentVersion: String
    let checkForUpdates: () -> Void
    let openUpdateLocation: () -> Void
    var showsCheckForUpdates = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("앱 업데이트")
                    .font(.body.weight(.semibold))
                Text("현재 버전 \(currentVersion)")
                    .font(.caption)
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
                        .font(.callout.weight(.semibold))
                    if let latestVersion = state.latestVersionDisplay {
                        Text("업데이트 버전 \(latestVersion)")
                            .font(.caption.weight(.medium))
                    }
                    Text(state.detail)
                        .font(.caption)
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

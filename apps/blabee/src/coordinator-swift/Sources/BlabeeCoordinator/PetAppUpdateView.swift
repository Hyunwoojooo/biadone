import SwiftUI

struct PetAppUpdateView: View {
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        PetAppUpdateStatusView(
            state: viewModel.appUpdateState,
            currentVersion: viewModel.appVersionDisplay,
            checkForUpdates: { Task { await viewModel.checkForAppUpdates() } },
            openUpdateLocation: viewModel.openAppUpdateLocation
        )
    }
}

struct PetAppUpdateStatusView: View {
    let state: PetAppUpdateState
    let currentVersion: String
    let checkForUpdates: () -> Void
    let openUpdateLocation: () -> Void

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
        Button("업데이트 확인", action: checkForUpdates)
            .buttonStyle(.bordered)
            .disabled(state.isChecking)
            .accessibilityIdentifier("check-app-updates")
        if let actionTitle = state.locationActionTitle {
            Button(actionTitle, action: openUpdateLocation)
                .buttonStyle(.borderedProminent)
                .disabled(state.isChecking)
                .accessibilityIdentifier("open-app-update-location")
        }
    }
}

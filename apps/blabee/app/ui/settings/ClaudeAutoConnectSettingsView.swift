import AppKit
import SwiftUI

/// Configuration and verified session readiness are deliberately separate.
/// The controller lives with the model so closing settings does not lose a
/// pending launch or mistake another conversation's ACK for this one.
struct ClaudeAutoConnectSettingsView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject private var viewModel: PetViewModel
    @ObservedObject private var connection: PetClaudeConnectionController
    @State private var terminals: [ClaudeInstalledLauncher.TerminalApplication] = []
    @State private var terminal: ClaudeInstalledLauncher.TerminalApplication = .terminal
    @State private var ghosttyNeedsUpdate = false
    @State private var didDetectTerminals = false

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        connection = viewModel.claudeConnection
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            currentConnections
            Divider()
            Text(PetL10n.text("New Claude Connection", korean: "새 Claude 연결")).font(.blabee(.body, weight: .semibold))
            Text(PetL10n.text("Choose a working folder to prepare the required settings and open a new connected Claude window.", korean: "작업 폴더를 선택하면 필요한 설정을 준비하고 연결된 새 Claude 창을 엽니다."))
                .font(.blabee(.caption)).foregroundStyle(.secondary)
            if !terminals.isEmpty {
                Picker(PetL10n.text("Terminal to use", korean: "사용할 터미널"), selection: $terminal) {
                    ForEach(terminals, id: \.self) { item in Text(item.label).tag(item) }
                }
                .disabled(connection.isWorking)
            } else {
                Text(PetL10n.text("No supported terminal found. Install Terminal or Ghostty, then check again.", korean: "지원하는 터미널을 찾지 못했습니다. Terminal 또는 Ghostty를 설치한 뒤 다시 확인해 주세요."))
                    .font(.blabee(.caption))
            }
            if ghosttyNeedsUpdate {
                Text(PetL10n.text("Ghostty connections require version 1.3 or later. You can use Terminal now.", korean: "Ghostty로 연결하려면 1.3 이상이 필요합니다. 지금은 Terminal로 연결할 수 있습니다."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            if connection.phase != .idle {
                Label(PetL10n.text("New Connection · \(connection.phase.title)", korean: "새 연결 · \(connection.phase.title)"),
                      systemImage: connection.phase == .connected ? "checkmark.circle.fill" : "circle.dotted")
                    .font(.blabee(.caption, weight: .semibold))
                    .foregroundStyle(connection.phase == .connected ? Color.green : Color.primary)
                    .accessibilityIdentifier("claude-connection-status")
                Text(connection.detail).font(.blabee(.caption))
            }
            if let inspection = connection.inspection {
                Text(inspection.isEnabled ? PetL10n.text("Terminal auto-connect settings: saved", korean: "터미널 자동 연결 설정: 저장됨") : PetL10n.text("Terminal auto-connect settings: not saved", korean: "터미널 자동 연결 설정: 저장 안 됨"))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
                if !inspection.isEnabled, !inspection.canEnable, inspection.canLaunch {
                    Text(inspection.detail).font(.blabee(.caption)).foregroundStyle(.secondary)
                }
            }
            if connection.launchUnconfirmed {
                Text(PetL10n.text("Unable to confirm the window-opening response. Check any opened Claude window and macOS app-control prompts. Checking for the same session's response will continue.", korean: "창 열기 응답을 확인하지 못했습니다. 이미 열린 Claude 창과 macOS의 앱 제어 허용 요청을 확인해 주세요. 같은 세션의 연결 응답을 계속 확인합니다."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            if connection.delayed, connection.isWaiting {
                Text(PetL10n.text("No response yet. Check requests in the opened Claude window, then choose New Claude Connection if needed.", korean: "아직 응답이 없습니다. 열린 Claude 창의 요청을 확인한 뒤, 필요하면 새 Claude 연결을 선택해 주세요."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Button(connection.phase == .idle ? PetL10n.text("Claude connection", korean: "Claude 연결") : PetL10n.text("New Claude Connection", korean: "새 Claude 연결")) {
                    Task { await viewModel.connectClaudeSession(terminal: terminal) }
                }
                .buttonStyle(.borderedProminent).petCapsuleButtonBorder()
                .disabled(!connection.canStart || terminals.isEmpty || !viewModel.supportsClaudeConnectionSetup)
                .accessibilityIdentifier("claude-connect")
                if connection.phase == .needsSelection {
                    Button(PetL10n.text("View Connected Session", korean: "연결한 세션 보기")) { Task { await viewModel.showConnectedClaudeSession() } }
                        .disabled(viewModel.isSwitchingProvider)
                }
                if connection.phase == .needsProbe {
                    Button(PetL10n.text("Recheck Connection", korean: "연결 다시 확인")) { Task { await viewModel.recheckConnectedClaudeSession() } }
                        .disabled(!viewModel.canControlClaudeConnection)
                }
                if connection.isWorking { ProgressView().controlSize(.small) }
            }
            .buttonStyle(.bordered).petCapsuleButtonBorder()
            DisclosureGroup(PetL10n.text("Terminal Auto-Connect Settings", korean: "터미널 자동 연결 설정")) {
                VStack(alignment: .leading, spacing: 8) {
                    if let inspection = connection.inspection {
                        Text(inspection.isEnabled ? PetL10n.text("Auto-connect settings saved", korean: "자동 연결 설정 저장됨") : PetL10n.text("Auto-connect settings not saved", korean: "자동 연결 설정 저장 안 됨"))
                            .font(.blabee(.caption, weight: .semibold))
                        Text(inspection.detail).font(.blabee(.caption))
                        if inspection.canDisable {
                            Button(PetL10n.text("Disable Terminal Auto-Connect", korean: "터미널 자동 연결 끄기")) {
                                Task { await connection.disableAutomaticConnection() }
                            }.disabled(connection.isWorking)
                        }
                    }
                    Button(PetL10n.text("Recheck Environment", korean: "사용 환경 다시 확인")) {
                        detectTerminals()
                        Task { await viewModel.refreshAllOnboardingSettings() }
                    }.disabled(connection.isWorking)
                    Text(PetL10n.text("Current terminals and conversations will remain open. Disabling auto-connect applies to launches in new terminals.", korean: "현재 터미널과 실행 중인 대화는 유지됩니다. 자동 연결을 끄면 이후 새 터미널의 실행부터 적용됩니다."))
                        .font(.blabee(.caption)).foregroundStyle(.secondary)
                }
                .padding(.top, 6)
            }
            .font(.blabee(.caption))
        }
        .fixedSize(horizontal: false, vertical: true)
        // Both this detail pane and the shared setup card may appear in the
        // same update. Use one guarded inspection so neither loses discovery.
        .task { detectTerminals(); await viewModel.refreshConnectionSetup() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("claude-auto-connect-settings")
    }

    private var sessionEntries: [PetProviderInboxSession] {
        (viewModel.snapshot?.providerInbox?.sessions ?? []).filter {
            $0.session.context.provider == .claude && $0.session.state != "disconnected"
        }
    }

    private var directoryVerified: Bool { viewModel.snapshot?.providerDirectory != nil }

    private var currentConnections: some View {
        let summary = PetClaudeSettingsSummary(
            sessions: sessionEntries, directoryVerified: directoryVerified,
            serviceConnected: viewModel.hasVerifiedServiceConnection
        )
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(PetL10n.text("Claude Connection Status", korean: "Claude 연결 상태")).font(.blabee(.body, weight: .semibold))
                Spacer(minLength: 0)
                PetSettingsStatusBadge(tone: summary.tone, title: summary.title)
            }
            .accessibilityIdentifier("claude-session-summary")
            Text(summary.detail).font(.blabee(.caption)).foregroundStyle(.secondary)
            ForEach(sessionEntries, id: \.session.id) { entry in
                currentSession(entry)
            }
        }
    }

    private func currentSession(_ entry: PetProviderInboxSession) -> some View {
        let session = entry.session
        let status = PetClaudeSessionSettingsStatus(
            session: entry, directoryVerified: directoryVerified,
            serviceConnected: viewModel.hasVerifiedServiceConnection
        )
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(session.title).font(.blabee(.caption, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                PetSettingsStatusBadge(tone: status.tone, title: status.title)
            }
            Text(session.cwd).font(.blabee(.caption2)).foregroundStyle(.secondary)
                .lineLimit(1).truncationMode(.middle).help(session.cwd)
            Text(status.detail).font(.blabee(.caption)).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button(PetL10n.text("Check Connection", korean: "연결 확인")) {
                    Task { await viewModel.checkClaudeConnection(session: session) }
                }
                Button(PetL10n.text("Disconnect", korean: "연결 해제")) {
                    Task { await viewModel.disconnectClaudeSession(session: session) }
                }
            }
            .buttonStyle(.bordered).petCapsuleButtonBorder()
            .disabled(!viewModel.canControlClaudeSession(session))
        }
        .padding(12)
        .petInsetSurface(cornerRadius: PetPanelVisualStyle.rowRadius)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("claude-settings-session-\(session.id)")
    }

    private func detectTerminals() {
        var installed = Set<String>()
        ghosttyNeedsUpdate = false
        for item in ClaudeInstalledLauncher.TerminalApplication.allCases {
            guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: item.bundleID) else { continue }
            if item == .ghostty {
                let version = Bundle(url: url)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
                guard PetClaudeLauncher.supportsGhosttyVersion(version) else {
                    ghosttyNeedsUpdate = true
                    continue
                }
            }
            installed.insert(item.bundleID)
        }
        let running = Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
        terminals = PetClaudeLauncher.availableTerminals(installedBundleIDs: installed)
        if (!didDetectTerminals || !terminals.contains(terminal)),
           let recommended = PetClaudeLauncher.recommendedTerminal(installedBundleIDs: installed, runningBundleIDs: running) {
            terminal = recommended
        }
        didDetectTerminals = true
    }
}

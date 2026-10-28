import AppKit
import SwiftUI

struct CodexPluginRecheckReportView: View {
    @ObservedObject private var localization = PetLocalization.shared
    let report: CodexPluginRecheckReport
    @State private var copiedReportID: UUID?
    @State private var copyFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                if report.isChecking {
                    ProgressView().controlSize(.small)
                }
                Text(report.title).font(.blabee(.caption, weight: .semibold))
            }
            .accessibilityIdentifier("codex-native-recheck-status")

            Text(PetL10n.text("Started: \(report.startedAt.formatted(date: .abbreviated, time: .standard))", korean: "시작: \(report.startedAt.formatted(date: .abbreviated, time: .standard))"))
            if let completedAt = report.completedAt {
                let seconds = String(format: "%.1f", report.elapsedSeconds ?? 0)
                Text(PetL10n.text("Completed: \(completedAt.formatted(date: .abbreviated, time: .standard)) · \(seconds)s", korean: "완료: \(completedAt.formatted(date: .abbreviated, time: .standard)) · \(seconds)초"))
            } else {
                TimelineView(.periodic(from: report.startedAt, by: 1)) { context in
                    let seconds = String(format: "%.0f", max(0, context.date.timeIntervalSince(report.startedAt)))
                    Text(PetL10n.text("Elapsed: \(seconds)s · Checking the executable and Plugin status.", korean: "경과: \(seconds)초 · 실행 파일과 Plugin 상태를 확인하고 있습니다."))
                }
            }

            if let result = report.result {
                Text(result.state.title).font(.blabee(.caption2, weight: .medium))
                Text("\(result.failed ? PetL10n.text("Stage where verification stopped", korean: "확인이 멈춘 단계") : PetL10n.text("Last verified stage", korean: "마지막 확인 단계")): \(result.evidence.stage.title)")
                if let code = result.evidence.errorCode {
                    Text(PetL10n.text("Error code: \(code)", korean: "오류 코드: \(code)")).font(.caption2.monospaced())
                } else if result.failed {
                    Text(PetL10n.text("Error code: unknown", korean: "오류 코드: 미확인"))
                }
                if let diagnostic = result.evidence.pathDiagnostic {
                    Text(diagnostic.issue.detail)
                    Text(diagnostic.issue.recovery).foregroundStyle(.secondary)
                    Text(PetL10n.text("Path check: \(diagnostic.issue.rawValue) · \(diagnostic.role.title)", korean: "경로 검사: \(diagnostic.issue.rawValue) · \(diagnostic.role.title)"))
                        .font(.caption2.monospaced())
                    if diagnostic.path != nil {
                        inspectedPath(PetL10n.text("Path where verification stopped", korean: "확인이 멈춘 경로"), diagnostic.path)
                    }
                }
                Text(PetL10n.text("Codex version: \(result.evidence.codexVersion ?? "Unknown")", korean: "Codex 버전: \(result.evidence.codexVersion ?? "미확인")"))
                Text(PetL10n.text("Observed installation layout: \(result.evidence.installationLayout.title)", korean: "확인한 설치 경로 형태: \(result.evidence.installationLayout.title)"))
                inspectedPath(PetL10n.text("Selected path", korean: "선택 경로"), result.evidence.sourcePath)
                inspectedPath(PetL10n.text("Resolved target (not proof of verification)", korean: "실제 연결 대상 (검증 통과를 의미하지 않음)"), result.evidence.resolvedTargetPath)
                Text(PetL10n.text("This is the last Check Again result. Hook trust, service connection, and selection delivery require separate verification.", korean: "이 기록은 마지막 ‘다시 검사’ 결과입니다. Hook 신뢰·서비스 연결·선택 반환은 별도 확인이 필요합니다."))
                    .foregroundStyle(.secondary)

                Button {
                    let text = report.sanitizedDiagnosticText(
                        appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
                    )
                    NSPasteboard.general.clearContents()
                    if NSPasteboard.general.setString(text, forType: .string) {
                        copiedReportID = report.id
                        copyFailed = false
                    } else {
                        copiedReportID = nil
                        copyFailed = true
                    }
                } label: {
                    Label(copiedReportID == report.id ? PetL10n.text("Diagnostics Copied", korean: "진단 정보 복사됨") : PetL10n.text("Copy Diagnostics", korean: "진단 정보 복사"), systemImage: "doc.on.doc")
                }
                .help(PetL10n.text("Copies only check results, excluding user paths and raw logs.", korean: "사용자 경로와 원문 로그를 제외한 검사 결과만 복사합니다."))
                if copyFailed { Text(PetL10n.text("Unable to copy to the clipboard.", korean: "클립보드에 복사하지 못했습니다.")).foregroundStyle(.red) }
            }
        }
        .font(.blabee(.caption2))
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
        .onChange(of: report.id) { _ in
            copiedReportID = nil
            copyFailed = false
        }
    }

    private func inspectedPath(_ title: String, _ path: String?) -> some View {
        let displayPath = path.flatMap { value in
            value.utf8.count <= 4096
                && !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
                ? value : nil
        } ?? PetL10n.text("Unverified", korean: "미확인")
        return Text("\(title): \(displayPath)")
            .font(.caption2.monospaced())
    }
}

/// Shared by first-run setup and settings. Historical reports remain labeled
/// as such; current recovery eligibility comes only from the current state.
struct CodexConnectionRecoveryView: View {
    @ObservedObject var viewModel: PetViewModel
    @ObservedObject private var localization = PetLocalization.shared
    let showsReport: Bool
    let emphasizesAction: Bool
    @State private var installationHelpExpanded: Bool
    @State private var diagnosticsExpanded: Bool

    init(viewModel: PetViewModel, showsReport: Bool = false, initiallyExpanded: Bool = false,
         emphasizesAction: Bool = true) {
        self.viewModel = viewModel
        self.showsReport = showsReport
        self.emphasizesAction = emphasizesAction
        _installationHelpExpanded = State(initialValue: initiallyExpanded)
        _diagnosticsExpanded = State(initialValue: initiallyExpanded)
    }

    var body: some View {
        if let recovery = viewModel.codexConnectionRecovery {
            VStack(alignment: .leading, spacing: 10) {
                Text(recovery.title).font(.blabee(.callout, weight: .semibold))
                Text(recovery.detail)
                    .font(.blabee(.caption))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if recovery.offersInstallGuide {
                    DisclosureGroup(PetL10n.text("Codex Installation Help", korean: "Codex 설치 도움말"), isExpanded: $installationHelpExpanded) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(PetL10n.text("1. Review your installation using the official Codex guide. Blabee needs a verifiable native Codex executable.", korean: "1. 공식 Codex 안내에서 설치 방법을 확인하세요. Blabee가 검증할 수 있는 native Codex 실행 파일이 필요합니다."))
                            Text(PetL10n.text("2. Return here and choose Recheck and Connect. If verification succeeds, Blabee connects its Plugin when needed.", korean: "2. 돌아와서 ‘재검사 후 연결’을 누르세요. 검사가 통과하면 필요한 Blabee Plugin을 연결합니다."))
                            Text(PetL10n.text("3. Use a new Codex conversation in your working folder. Review any sign-in and /hooks approval requests in Codex.", korean: "3. 작업 폴더에서 새 Codex 대화를 시작하세요. 로그인과 /hooks 승인 요청은 Codex에서 확인해 주세요."))
                            Text(PetL10n.text("If the check still fails, copy its diagnostics below for support. Folder permissions do not need to be changed just to collect diagnostics.", korean: "검사가 계속 실패하면 아래 진단 정보를 복사해 전달해 주세요. 진단 정보를 모으기 위해 폴더 권한을 변경할 필요는 없습니다."))
                        }
                        .font(.blabee(.caption))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 6)
                    }
                    .font(.blabee(.caption))
                    Button(PetL10n.text("Open Official Codex Guide", korean: "공식 Codex 설치 안내 열기")) {
                        viewModel.openConnectionInstallGuide(for: .codex)
                    }
                    .disabled(viewModel.isOnboardingOperationInFlight)
                    .accessibilityIdentifier("codex-connection-install-guide")
                }

                if recovery.offersAppUpdate {
                    Button(PetL10n.text("Check Blabee Updates", korean: "Blabee 업데이트 확인")) {
                        Task { await viewModel.checkForAppUpdates() }
                    }
                    .disabled(viewModel.isOnboardingOperationInFlight || viewModel.isCheckingForAppUpdate)
                    .accessibilityIdentifier("codex-connection-check-app-update")
                    Text(viewModel.appUpdateState.title)
                        .font(.blabee(.caption)).foregroundStyle(.secondary)
                    if viewModel.appUpdateState.availableRelease != nil {
                        Button(PetL10n.text("Open Blabee Download", korean: "Blabee 다운로드 열기")) {
                            viewModel.openAppUpdateLocation()
                        }
                    }
                }

                Button {
                    Task { await viewModel.retryCodexPluginConnection() }
                } label: {
                    Label(PetL10n.text("Recheck and Connect", korean: "재검사 후 연결"), systemImage: "arrow.clockwise")
                }
                .buttonStyle(PetOnboardingActionButtonStyle(emphasized: emphasizesAction))
                .disabled(!viewModel.canRetryCodexPluginConnection)
                .accessibilityIdentifier("codex-connection-recheck-connect")
                if viewModel.isCodexPluginOperationInFlight {
                    ProgressView(PetL10n.text("Checking Codex and preparing the Plugin…", korean: "Codex 검사 및 Plugin 연결 준비 중…"))
                        .font(.blabee(.caption)).controlSize(.small)
                }
                if showsReport, let report = viewModel.codexNativeRecheckReport {
                    DisclosureGroup(PetL10n.text("Last Check · Copy Diagnostics", korean: "최근 검사 · 진단 정보 복사"), isExpanded: $diagnosticsExpanded) {
                        CodexPluginRecheckReportView(report: report)
                    }
                    .font(.blabee(.caption))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("codex-connection-recovery")
        }
    }
}

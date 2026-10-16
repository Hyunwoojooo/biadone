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
                inspectedPath(PetL10n.text("Selected path", korean: "선택 경로"), result.evidence.sourcePath)
                inspectedPath(PetL10n.text("Actual executable", korean: "실제 실행 파일"), result.evidence.canonicalPath)
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

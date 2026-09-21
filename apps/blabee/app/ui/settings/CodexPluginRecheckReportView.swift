import AppKit
import SwiftUI

struct CodexPluginRecheckReportView: View {
    let report: CodexPluginRecheckReport
    @State private var copiedReportID: UUID?
    @State private var copyFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                if report.isChecking {
                    ProgressView().controlSize(.small)
                }
                Text(report.title).font(.caption.weight(.semibold))
            }
            .accessibilityIdentifier("codex-native-recheck-status")

            Text("시작: \(report.startedAt.formatted(date: .abbreviated, time: .standard))")
            if let completedAt = report.completedAt {
                Text("완료: \(completedAt.formatted(date: .abbreviated, time: .standard)) · \(report.elapsedSeconds ?? 0, specifier: "%.1f")초")
            } else {
                TimelineView(.periodic(from: report.startedAt, by: 1)) { context in
                    Text("경과: \(max(0, context.date.timeIntervalSince(report.startedAt)), specifier: "%.0f")초 · 실행 파일과 Plugin 상태를 확인하고 있습니다.")
                }
            }

            if let result = report.result {
                Text(result.state.title).fontWeight(.medium)
                Text("\(result.failed ? "확인이 멈춘 단계" : "마지막 확인 단계"): \(result.evidence.stage.title)")
                if let code = result.evidence.errorCode {
                    Text("오류 코드: \(code)").font(.caption2.monospaced())
                } else if result.failed {
                    Text("오류 코드: 미확인")
                }
                Text("Codex 버전: \(result.evidence.codexVersion ?? "미확인")")
                inspectedPath("선택 경로", result.evidence.sourcePath)
                inspectedPath("실제 실행 파일", result.evidence.canonicalPath)
                Text("이 기록은 마지막 ‘다시 검사’ 결과입니다. Hook 신뢰·서비스 연결·선택 반환은 별도 확인이 필요합니다.")
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
                    Label(copiedReportID == report.id ? "진단 정보 복사됨" : "진단 정보 복사", systemImage: "doc.on.doc")
                }
                .help("사용자 경로와 원문 로그를 제외한 검사 결과만 복사합니다.")
                if copyFailed { Text("클립보드에 복사하지 못했습니다.").foregroundStyle(.red) }
            }
        }
        .font(.caption2)
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
        } ?? "미확인"
        return Text("\(title): \(displayPath)")
            .font(.caption2.monospaced())
    }
}

import SwiftUI

struct PetErrorDiagnosticsView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var diagnostics: PetErrorDiagnostics

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(PetL10n.text("Send Error Diagnostics", korean: "오류 진단 보내기"), isOn: Binding(
                get: { diagnostics.isEnabled }, set: { diagnostics.setEnabled($0) }
            ))
            .font(.blabee(.body))
            .foregroundStyle(.primary)
            .accessibilityIdentifier("error-diagnostics-enabled")
            Text(PetL10n.text("Help improve Blabee's stability by sending error diagnostics for the account signed in on this Mac. This is separate from usage statistics.", korean: "이 Mac에서 로그인한 계정의 오류 진단을 보내 Blabee의 안정성 개선에 참여합니다. 사용 통계 설정과 별도로 적용됩니다."))
            Text(PetL10n.text("We send your user ID, predefined error codes, occurrence times, app and macOS versions, provider (Codex or Claude), connection failure stage, cause, and tool version. Conversations, code, commands, file paths, and raw logs are not sent.", korean: "사용자 ID·정해진 오류 코드·발생 시각·앱·macOS 버전과 Codex·Claude 종류·연결 실패 단계·원인·도구 버전을 보냅니다. 대화·코드·명령·파일 경로·로그 원문은 보내지 않습니다."))
            Text(PetL10n.text("Repeated errors are rate-limited. Diagnostics older than 30 days are cleaned up daily and are also deleted with your account. Turning this off stops resending queued records.", korean: "반복 오류는 전송 횟수를 제한합니다. 30일 지난 진단은 매일 정리하며, 계정 삭제 시에도 함께 삭제됩니다. 전송을 끄면 대기 기록을 다시 보내지 않습니다."))
            if diagnostics.isEnabled {
                Text(PetL10n.text("\(diagnostics.pendingEventCount) pending submissions", korean: "전송 대기 \(diagnostics.pendingEventCount)건"))
                    .accessibilityIdentifier("error-diagnostics-pending")
                if let sent = diagnostics.lastAcceptedAt {
                    Text(PetL10n.text("Latest delivery response: \(sent.formatted(date: .omitted, time: .standard))", korean: "최근 전송 응답: \(sent.formatted(date: .omitted, time: .standard))"))
                }
                if let id = diagnostics.lastRecordedEventID {
                    Text(PetL10n.text("Diagnostic ID for support: \(id.uuidString.lowercased())", korean: "문의용 진단 ID: \(id.uuidString.lowercased())"))
                        .textSelection(.enabled)
                }
                Text(PetL10n.text("Only errors occurring after sign-in are sent. A connection timeout can include waiting for user confirmation and does not always indicate a failure.", korean: "로그인 후 발생한 오류부터 전송합니다. 연결 대기 시간 초과는 사용자 확인을 기다리는 경우도 포함하므로 실제 장애로 단정하지 않습니다."))
            }
        }
        .font(.blabee(.caption))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}

import SwiftUI

struct PetErrorDiagnosticsView: View {
    @ObservedObject var diagnostics: PetErrorDiagnostics

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("오류 진단 보내기", isOn: Binding(
                get: { diagnostics.isEnabled }, set: { diagnostics.setEnabled($0) }
            ))
            .font(.body)
            .foregroundStyle(.primary)
            .accessibilityIdentifier("error-diagnostics-enabled")
            Text("이 Mac에서 로그인한 계정의 오류 진단을 보내 Blabee의 안정성 개선에 참여합니다. 사용 통계 설정과 별도로 적용됩니다.")
            Text("사용자 ID·정해진 오류 코드·발생 시각·앱 버전·macOS 버전을 보냅니다. 대화·코드·명령·파일 경로·로그 원문은 보내지 않습니다.")
            Text("반복 오류는 전송 횟수를 제한합니다. 30일 지난 진단은 매일 정리하며, 계정 삭제 시에도 함께 삭제됩니다. 전송을 끄면 대기 기록을 다시 보내지 않습니다.")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}

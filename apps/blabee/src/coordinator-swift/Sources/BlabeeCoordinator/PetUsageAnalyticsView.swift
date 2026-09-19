import SwiftUI

struct PetUsageAnalyticsView: View {
    @ObservedObject var analytics: PetUsageAnalytics

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("사용 통계 보내기", isOn: Binding(
                get: { analytics.isEnabled }, set: { analytics.setEnabled($0) }
            ))
            .font(.body)
            .foregroundStyle(.primary)
            .accessibilityIdentifier("usage-analytics-enabled")
            Text("이 Mac에서 로그인한 계정의 사용 통계를 보내 Blabee 개선에 참여합니다. 수집 항목이 추가되어 이전에 켰더라도 다시 선택해야 합니다.")
            Text("사용자 ID와 관측 시각을 기준으로 기능 사용 횟수·활동 날짜, 로그인 후 설정 단계, 기능 요청의 시도·성공·실패·취소, 버튼·단축키 사용을 기록합니다.")
            Text("요청 응답 속도는 1초 미만·1~3초·3초 초과 구간으로만 기록합니다. 앱 버전, macOS 주요 버전, 실제 화면 언어와 업데이트 제안·시도·결과도 포함합니다.")
            Text("실제로 표시된 제안·승인 카드의 노출, 접수된 선택·건너뛰기·승인·거절과 반응 시간 구간(5초 미만·5~30초·30초 초과)을 기록합니다. 확인된 Codex 버전·연결 방식·호환 상태도 포함합니다.")
            Text("질문·답변·제안 원문, 코드·명령·파일 경로와 작업 시간은 자동 전송하지 않습니다. 원문 공유는 별도 피드백 화면에서 검토하고 직접 제출합니다. 오류 진단 전송도 별도 설정입니다.")
            Text("날짜별 통계는 계정 삭제 시 함께 삭제됩니다. 전송을 끄면 대기 중인 기록도 다시 보내지 않습니다. 끄기 전 서버에 집계된 통계는 유지됩니다.")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}

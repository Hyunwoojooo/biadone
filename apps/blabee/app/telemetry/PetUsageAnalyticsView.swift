import SwiftUI

struct PetUsageAnalyticsView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var analytics: PetUsageAnalytics
    @State private var confirmingDeletion = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(PetL10n.text("Send Usage Statistics", korean: "사용 통계 보내기"), isOn: Binding(
                get: { analytics.isEnabled }, set: { analytics.setEnabled($0) }
            ))
            .font(.blabee(.body))
            .foregroundStyle(.primary)
            .accessibilityIdentifier("usage-analytics-enabled")
            Text(PetL10n.text("Help improve Blabee by sending usage statistics for the account signed in on this Mac. New categories have been added, so you must opt in again even if this was previously enabled.", korean: "이 Mac에서 로그인한 계정의 사용 통계를 보내 Blabee 개선에 참여합니다. 수집 항목이 추가되어 이전에 켰더라도 다시 선택해야 합니다."))
            Text(PetL10n.text("Using your user ID and observation time, we record feature counts, active dates, setup stages after sign-in, request attempts, successes, failures, cancellations, and button or shortcut use.", korean: "사용자 ID와 관측 시각을 기준으로 기능 사용 횟수·활동 날짜, 로그인 후 설정 단계, 기능 요청의 시도·성공·실패·취소, 버튼·단축키 사용을 기록합니다."))
            Text(PetL10n.text("Response times are recorded only in ranges: under 1 second, 1–3 seconds, and over 3 seconds. App version, major macOS version, displayed UI language, and update offers, attempts, and results are included.", korean: "요청 응답 속도는 1초 미만·1~3초·3초 초과 구간으로만 기록합니다. 앱 버전, macOS 주요 버전, 실제 화면 언어와 업데이트 제안·시도·결과도 포함합니다."))
            Text(PetL10n.text("We record displayed suggestion and approval cards, accepted choices, skips, approvals, denials, and response-time ranges (under 5 seconds, 5–30 seconds, and over 30 seconds). Verified Codex version, connection method, and compatibility status are included.", korean: "실제로 표시된 제안·승인 카드의 노출, 접수된 선택·건너뛰기·승인·거절과 반응 시간 구간(5초 미만·5~30초·30초 초과)을 기록합니다. 확인된 Codex 버전·연결 방식·호환 상태도 포함합니다."))
            Text(PetL10n.text("Questions, answers, suggestion text, code, commands, file paths, and working time are not sent automatically. Share original text only after reviewing and submitting it in the feedback window. Error diagnostics are a separate setting.", korean: "질문·답변·제안 원문, 코드·명령·파일 경로와 작업 시간은 자동 전송하지 않습니다. 원문 공유는 별도 피드백 화면에서 검토하고 직접 제출합니다. 오류 진단 전송도 별도 설정입니다."))
            Text(PetL10n.text("Turning this off also stops resending queued records. Statistics already aggregated on the server remain until you delete them below; duplicate-check receipts are removed automatically within nine days. To delete your account, contact us through Feedback.", korean: "전송을 끄면 대기 중인 기록도 다시 보내지 않습니다. 서버에 집계된 통계는 아래에서 삭제할 때까지 유지되고, 중복 확인용 수신 기록은 9일 안에 자동 삭제됩니다. 계정 삭제는 피드백으로 요청해 주세요."))
            HStack(spacing: 8) {
                Button(PetL10n.text("Delete My Statistics on the Server…", korean: "서버의 내 사용 통계 삭제…")) {
                    confirmingDeletion = true
                }
                .disabled(analytics.serverDeletion == .deleting)
                .accessibilityIdentifier("usage-analytics-delete")
                if let status = deletionStatus { Text(status) }
            }
            .confirmationDialog(PetL10n.text("Delete your usage statistics on the server?", korean: "서버의 내 사용 통계를 삭제할까요?"),
                                isPresented: $confirmingDeletion) {
                Button(PetL10n.text("Delete", korean: "삭제"), role: .destructive) {
                    Task { await analytics.deleteServerStatistics() }
                }
            } message: {
                Text(PetL10n.text("Daily statistics and product observations for this account are deleted, and records waiting on this Mac are discarded. Sending stays as set above.", korean: "이 계정의 날짜별 통계와 제품 관측 기록을 삭제하고, 이 Mac에서 대기 중인 기록도 버립니다. 전송 설정은 위 선택대로 유지됩니다."))
            }
        }
        .font(.blabee(.caption))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }

    private var deletionStatus: String? {
        switch analytics.serverDeletion {
        case .idle: nil
        case .deleting: PetL10n.text("Deleting…", korean: "삭제하는 중…")
        case .deleted: PetL10n.text("Deleted.", korean: "삭제했습니다.")
        case .signInRequired: PetL10n.text("Sign in again, then retry.", korean: "다시 로그인한 뒤 시도해 주세요.")
        case .failed: PetL10n.text("Could not delete. Try again shortly.", korean: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.")
        }
    }
}

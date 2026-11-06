import SwiftUI

struct PetFeedbackView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: PetFeedbackController

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(PetL10n.text("Make Blabee Better", korean: "Blabee를 더 편하게"))
                        .font(.blabee(.title2, weight: .semibold))
                    Text(PetL10n.text("Tell us what helped or what could be improved. You can also send just a rating or use case.", korean: "도움이 된 점이나 아쉬운 점을 알려 주세요. 평가나 사용 목적만 선택해서 보낼 수도 있습니다."))
                        .foregroundStyle(.secondary)
                    Text(PetL10n.text("Only the content you review and submit here is shared, regardless of automatic usage statistics settings.", korean: "자동 사용 통계 설정과 관계없이, 여기서 확인하고 보내는 내용만 공유됩니다."))
                        .font(.blabee(.caption)).foregroundStyle(.secondary)
                }

                if controller.isSignedIn || controller.hasKnownAccount {
                    if !controller.isSignedIn {
                        Text(PetL10n.text("Checking sign-in status. Your draft is kept while sending is temporarily paused.", korean: "로그인 상태를 확인하고 있습니다. 작성한 내용은 유지되며 전송은 잠시 기다립니다."))
                            .font(.blabee(.caption)).foregroundStyle(.secondary)
                    }
                    if let preview = controller.preview { review(preview) }
                    else { editor.id(controller.editingSessionID) }
                } else {
                    Label(PetL10n.text("Sign in under Settings → Account to send feedback and view your submission history.", korean: "설정의 계정 메뉴에서 로그인하면 피드백을 보내고 제출 내역을 확인할 수 있습니다."),
                          systemImage: "person.crop.circle")
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                }

                if let status = controller.status {
                    Text(status).font(.blabee(.callout)).textSelection(.enabled)
                        .accessibilityIdentifier("feedback-status")
                }

                VStack(alignment: .leading, spacing: 6) {
                    Label(PetL10n.text("Kept for 30 days · Delete anytime", korean: "30일 보관 · 직접 삭제 가능"), systemImage: "lock.shield")
                        .font(.blabee(.callout, weight: .medium))
                    Text(PetL10n.text("Shared ratings and content are hidden from queries after 30 days and cleaned up daily. You can delete them earlier from the history below. Drafts are not saved to this Mac's disk.", korean: "공유한 평가와 내용은 30일 후 조회에서 제외되며 매일 정리합니다. 그 전에 아래 제출 내역에서 직접 삭제할 수 있습니다. 입력 중인 내용은 이 Mac의 디스크에 저장하지 않습니다."))
                        .font(.blabee(.caption)).foregroundStyle(.secondary)
                    Text(PetL10n.text("Closing this window clears your draft. If sending has already started, check the result in your submission history.", korean: "창을 닫으면 작성 중인 내용을 지웁니다. 이미 전송이 시작된 내용은 제출 내역에서 결과를 확인해 주세요."))
                        .font(.blabee(.caption)).foregroundStyle(.secondary)
                }
                Divider()
                history
            }
            .padding(28)
            .frame(maxWidth: 780, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .font(.blabee(.body))
        .background(Color(nsColor: .windowBackgroundColor))
        .accessibilityIdentifier("feedback-window-content")
        .environment(\.locale, PetL10n.language.locale)
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 20) {
            GroupBox {
                VStack(alignment: .leading, spacing: 14) {
                    Picker(PetL10n.text("How was your Blabee experience?", korean: "Blabee 사용은 어땠나요?"), selection: Binding(
                        get: { controller.draft.rating }, set: { value in
                            var draft = controller.draft
                            draft.rating = value
                            if !PetFeedbackReason.allowed(for: value).contains(draft.reason) { draft.reason = .none }
                            controller.draft = draft
                        })) {
                        ForEach(PetFeedbackRating.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .accessibilityIdentifier("feedback-rating")
                    if controller.draft.rating != .none {
                        Picker(PetL10n.text("Reason (optional)", korean: "이유 (선택)"), selection: $controller.draft.reason) {
                            ForEach(PetFeedbackReason.allowed(for: controller.draft.rating), id: \.self) { Text($0.title).tag($0) }
                        }
                        .accessibilityIdentifier("feedback-reason")
                    }
                    Picker(PetL10n.text("What do you mainly use it for? (optional)", korean: "주로 어떤 작업에 사용하나요? (선택)"), selection: $controller.draft.usePurpose) {
                        ForEach(PetFeedbackPurpose.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .accessibilityIdentifier("feedback-purpose")
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(PetL10n.text("Content to share (optional)", korean: "공유할 내용 (선택)")).font(.blabee(.headline))
                Text(PetL10n.text("Paste only what you want to share. Conversations, files, and logs are not imported automatically.", korean: "공유하고 싶은 부분만 직접 붙여 넣어 주세요. 대화, 파일, 로그를 자동으로 가져오지 않습니다."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
                if controller.suggestedContent != nil {
                    Button(PetL10n.text("Add Current Suggestion", korean: "현재 제안 추가"), action: controller.includeOfferedSuggestion)
                        .accessibilityIdentifier("feedback-include-suggestion")
                }
            }
            textEditor(PetL10n.text("Question", korean: "질문"), value: $controller.draft.question, identifier: "feedback-question")
            textEditor(PetL10n.text("Answer", korean: "답변"), value: $controller.draft.answer, identifier: "feedback-answer")
            textEditor(PetL10n.text("Blabee suggestion", korean: "Blabee 제안"), value: $controller.draft.suggestion, identifier: "feedback-suggestion")
            textEditor(PetL10n.text("Your comments", korean: "남기고 싶은 의견"), value: $controller.draft.note, identifier: "feedback-note")

            HStack {
                Text(PetL10n.text("Review redactions and the content to be sent on the next screen.", korean: "다음 화면에서 민감정보 가림 결과와 전송 내용을 확인합니다."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
                Spacer(minLength: 16)
                Button(PetL10n.text("Review Submission", korean: "전송 내용 확인"), action: controller.preparePreview)
                    .buttonStyle(.borderedProminent)
                    .disabled(!controller.isSignedIn)
                    .accessibilityIdentifier("feedback-review")
            }
        }
        .disabled(controller.isSubmitting)
    }

    private func textEditor(_ title: String, value: Binding<String>, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title + PetL10n.text(" (optional)", korean: " (선택)")).font(.blabee(.callout, weight: .medium))
            TextEditor(text: value)
                .font(.blabee(.body))
                .padding(6)
                .frame(minHeight: 84, maxHeight: 120)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.15)))
                .accessibilityLabel(title)
                .accessibilityIdentifier(identifier)
        }
    }

    private func review(_ preview: PetFeedbackController.Preview) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text(PetL10n.text("Submission Preview", korean: "전송할 내용 미리보기")).font(.blabee(.headline))
                Spacer()
                Button(PetL10n.text("Edit", korean: "수정하기"), action: controller.editPreview)
                    .disabled(controller.isSubmitting)
                    .accessibilityIdentifier("feedback-edit-preview")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(PetL10n.text("Rating: ", korean: "평가: ") + preview.draft.rating.title)
                Text(PetL10n.text("Reason: ", korean: "이유: ") + preview.draft.reason.title)
                Text(PetL10n.text("Use case: ", korean: "사용 목적: ") + preview.draft.usePurpose.title)
                Text(PetL10n.text("App environment: Blabee \(preview.environment.appVersion) (\(preview.environment.appBuild)) · macOS \(preview.environment.osMajor) · \(language(preview.environment.uiLanguage))", korean: "앱 환경: Blabee \(preview.environment.appVersion) (\(preview.environment.appBuild)) · macOS \(preview.environment.osMajor) · \(language(preview.environment.uiLanguage))"))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            .font(.blabee(.callout))
            ForEach(contentSections(preview.draft), id: \.0) { title, content in
                VStack(alignment: .leading, spacing: 8) {
                    Text(title).font(.blabee(.callout, weight: .semibold))
                    Text(content).font(.blabee(.body)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(14)
                .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
            }
            if preview.draft.hasContent {
                Text(preview.redactions > 0
                     ? PetL10n.text("\(preview.redactions) email addresses, credentials, or personal paths were redacted. Check for sensitive information the automatic check may have missed.", korean: "이메일·인증 정보·개인 경로 \(preview.redactions)곳을 가렸습니다. 자동으로 찾지 못한 민감정보가 없는지 직접 확인해 주세요.")
                     : PetL10n.text("Automatic checks may miss sensitive information. Review names, contact details, secret keys, and private work yourself.", korean: "자동으로 찾지 못한 민감정보가 있을 수 있습니다. 이름, 연락처, 비밀키, 비공개 작업 내용 등을 직접 확인해 주세요."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
                Toggle(PetL10n.text("I have reviewed the content above and agree to share the displayed text to improve Blabee.", korean: "위 내용을 확인했으며, 표시된 원문을 Blabee 개선을 위해 공유하는 데 동의합니다."),
                       isOn: $controller.contentConsent)
                    .toggleStyle(.checkbox)
                    .disabled(controller.isSubmitting)
                    .accessibilityIdentifier("feedback-content-consent")
            }
            Text(PetL10n.text("The content above will be sent using the currently signed-in account.", korean: "현재 로그인한 계정으로 위 내용을 보냅니다."))
                .font(.blabee(.caption)).foregroundStyle(.secondary)
            HStack {
                if controller.isSubmitting { ProgressView().controlSize(.small) }
                Spacer()
                Button(controller.hasPendingRetry ? PetL10n.text("Resend Same Content", korean: "같은 내용으로 다시 보내기") : PetL10n.text("Send Feedback", korean: "피드백 보내기")) {
                    Task { await controller.submit() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!controller.canSubmit)
                .accessibilityIdentifier("feedback-submit")
            }
        }
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(PetL10n.text("My Feedback", korean: "내가 보낸 피드백")).font(.blabee(.headline))
                Spacer()
                if controller.isLoading { ProgressView().controlSize(.small) }
                Button(PetL10n.text("Refresh", korean: "새로 고침")) { Task { await controller.refreshHistory() } }
                    .disabled(!controller.isSignedIn || controller.isLoading || controller.deletingID != nil)
                    .accessibilityIdentifier("feedback-refresh-history")
            }
            Text(PetL10n.text("Only submission dates and selected options are shown. Shared original text is not downloaded again.", korean: "제출한 날짜와 선택 항목만 표시합니다. 공유한 원문을 다시 내려받지 않습니다."))
                .font(.blabee(.caption)).foregroundStyle(.secondary)
            if controller.summaries.isEmpty && !controller.isLoading {
                Text(PetL10n.text("No submissions in the last 30 days.", korean: "최근 30일 이내의 제출 내역이 없습니다."))
                    .font(.blabee(.callout)).foregroundStyle(.secondary)
            }
            ForEach(controller.summaries) { item in
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.receivedAt, format: .dateTime.year().month().day().hour().minute())
                            .font(.blabee(.callout, weight: .medium))
                        Text([item.rating.title, item.usePurpose.title, item.hasContent ? PetL10n.text("Includes shared content", korean: "공유한 내용 포함") : PetL10n.text("Selected options only", korean: "선택 항목만 공유")].joined(separator: " · "))
                            .font(.blabee(.caption)).foregroundStyle(.secondary)
                        Text(PetL10n.text("Retained until: ", korean: "보관 기한: ") + item.expiresAt.formatted(.dateTime.year().month().day()))
                            .font(.blabee(.caption)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if controller.deletingID == item.id { ProgressView().controlSize(.small) }
                    Button(PetL10n.text("Delete", korean: "삭제"), role: .destructive) { Task { await controller.delete(item.id) } }
                        .disabled(!controller.isSignedIn || controller.deletingID != nil || controller.isSubmitting)
                        .accessibilityLabel(PetL10n.text("Delete feedback from \(item.receivedAt.formatted(date: .abbreviated, time: .shortened))", korean: "\(item.receivedAt.formatted(date: .abbreviated, time: .shortened)) 피드백 삭제"))
                }
                .padding(12)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            if let status = controller.historyStatus {
                Text(status).font(.blabee(.caption)).accessibilityIdentifier("feedback-history-status")
            }
        }
    }

    private func contentSections(_ draft: PetFeedbackDraft) -> [(String, String)] {
        [(PetL10n.text("Question", korean: "질문"), draft.question), (PetL10n.text("Answer", korean: "답변"), draft.answer), (PetL10n.text("Blabee suggestion", korean: "Blabee 제안"), draft.suggestion), (PetL10n.text("Feedback", korean: "의견"), draft.note)]
            .filter { !$0.1.isEmpty }
    }
    private func language(_ value: PetProductUILanguage) -> String {
        switch value { case .ko: PetL10n.text("Korean", korean: "한국어"); case .en: PetL10n.text("English", korean: "영어"); case .other: PetL10n.text("Other language", korean: "기타 언어"); case .unknown: PetL10n.text("Language unknown", korean: "언어 정보 없음") }
    }
}

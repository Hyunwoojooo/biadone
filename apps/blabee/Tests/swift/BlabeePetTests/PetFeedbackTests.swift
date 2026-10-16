import Foundation
import Testing
@testable import BlabeeCoordinator

private enum FeedbackValues {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let user = "00000000-0000-0000-0000-000000000001"
    static let other = "00000000-0000-0000-0000-000000000002"
    static let environment = PetProductEnvironment(appVersion: "0.1.0", appBuild: "55", osMajor: "15", uiLanguage: .ko)
    static func auth(_ user: String = user) -> PetUsageAuthorization {
        .init(userID: user, accessToken: "feedback-test-only-token", expiresAt: now.addingTimeInterval(3_600))
    }
    static func payload(note: String = "") -> PetFeedbackPayload {
        var draft = PetFeedbackDraft(); draft.rating = .helpful; draft.note = note
        return .init(submissionID: UUID(), draft: draft, contentConsent: !note.isEmpty, environment: environment)
    }
    static func summary(_ id: UUID = UUID(), expired: Bool = false) -> PetFeedbackSummary {
        .init(submissionID: id, receivedAt: now.addingTimeInterval(-3_600),
              expiresAt: expired ? now.addingTimeInterval(-1) : now.addingTimeInterval(29 * 86_400),
              rating: .helpful, reason: .none, usePurpose: .development, hasContent: true)
    }
}

@MainActor
private final class FeedbackGate {
    private var isEntered = false
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation; isEntered = true
            for observer in observers { observer.resume() }; observers = []
        }
    }
    func entered() async {
        if isEntered { return }
        await withCheckedContinuation { observers.append($0) }
    }
    func release() { continuation?.resume(); continuation = nil }
}

@MainActor
private final class FeedbackService: PetFeedbackServing {
    var submissions: [PetFeedbackPayload] = []
    var submissionOwners: [String] = []
    var deleted: [UUID] = []
    var listCalls = 0
    var rows: [PetFeedbackSummary] = []
    var submitErrors: [PetFeedbackError] = []
    var submitGate: FeedbackGate?
    var listGate: FeedbackGate?
    var deleteGate: FeedbackGate?
    var wrongReceipt = false
    func submit(_ payload: PetFeedbackPayload, authorization: PetUsageAuthorization) async throws -> UUID {
        submissions.append(payload); submissionOwners.append(authorization.userID)
        if let submitGate { await submitGate.wait() }
        if !submitErrors.isEmpty { throw submitErrors.removeFirst() }
        return wrongReceipt ? UUID() : payload.submissionID
    }
    func list(authorization: PetUsageAuthorization) async throws -> [PetFeedbackSummary] {
        listCalls += 1
        let result = rows
        if let listGate { await listGate.wait() }
        return result
    }
    func delete(_ id: UUID, authorization: PetUsageAuthorization) async throws {
        deleted.append(id)
        if let deleteGate { await deleteGate.wait() }
        rows.removeAll { $0.id == id }
    }
}

@MainActor
private final class FeedbackAuth { var value: PetUsageAuthorization? = FeedbackValues.auth() }

@MainActor
private final class FeedbackFixture {
    let auth = FeedbackAuth()
    let service = FeedbackService()
    let controller: PetFeedbackController
    init() {
        controller = PetFeedbackController(service: service, authorization: { [auth] in auth.value },
            now: { FeedbackValues.now }, environment: FeedbackValues.environment)
    }
    func review(note: String = "") {
        controller.draft.rating = .helpful
        controller.draft.note = note
        controller.preparePreview()
        if !note.isEmpty { controller.contentConsent = true }
    }
}

@Suite("Manual feedback validation", .petLanguage(.korean))
struct PetFeedbackValidationTests {
    @Test("empty content and invalid reasons are rejected")
    func emptyAndInvalidReason() {
        var draft = PetFeedbackDraft()
        #expect(draft.validationMessage != nil)
        draft.rating = .helpful; draft.reason = .irrelevant
        #expect(draft.validationMessage != nil)
        draft.reason = .nextStepClear
        #expect(draft.validationMessage == nil)
    }

    @Test("text limits measure UTF8 bytes and reject nulls", arguments: ["question", "answer", "suggestion", "note"])
    func byteAndControlBounds(field: String) {
        var draft = PetFeedbackDraft(); draft.rating = .helpful
        let limit = field == "note" ? 2_000 : 8_000
        let key: WritableKeyPath<PetFeedbackDraft, String>
        switch field { case "question": key = \.question; case "answer": key = \.answer
        case "suggestion": key = \.suggestion; default: key = \.note }
        draft[keyPath: key] = String(repeating: "a", count: limit)
        #expect(draft.validationMessage == nil)
        draft[keyPath: key] += "한"
        #expect(draft.validationMessage != nil)
        draft[keyPath: key] = "text\0hidden"
        #expect(draft.validationMessage != nil)
        draft[keyPath: key] = "line1\nline2\tcolumn"
        #expect(draft.validationMessage == nil)
    }

    @Test("every free-text field requires consent", arguments: ["question", "answer", "suggestion", "note"])
    func contentConsent(field: String) {
        var draft = PetFeedbackDraft()
        switch field { case "question": draft.question = "질문"; case "answer": draft.answer = "답변"
        case "suggestion": draft.suggestion = "제안"; default: draft.note = "의견" }
        #expect(!PetFeedbackPayload(submissionID: UUID(), draft: draft, contentConsent: false,
                                    environment: FeedbackValues.environment).isValid)
        #expect(PetFeedbackPayload(submissionID: UUID(), draft: draft, contentConsent: true,
                                   environment: FeedbackValues.environment).isValid)
    }

    @Test("common secrets emails and home paths are removed before preview", arguments: [
        "person@example.com", "/Users/alice/private/project.swift", "/home/alice/secret.txt", "~/private/token",
        #"C:\Users\alice\secret.txt"#, "sk-proj-" + String(repeating: "a", count: 32),
        "ghp_" + String(repeating: "b", count: 36), "github_pat_" + String(repeating: "c", count: 40),
        "sb_secret_" + String(repeating: "d", count: 24), "AKIA" + String(repeating: "A", count: 16),
        "Authorization: Bearer confidential-value", "\"password\": \"two word secret\"",
        "access_token=confidential-value", "eyJabcdefghij.abcdefghijk.abcdefghijk",
        "-----BEGIN PRIVATE KEY-----\nconfidential-data\n-----END PRIVATE KEY-----"
    ])
    func redaction(secret: String) {
        var draft = PetFeedbackDraft(); draft.note = "before " + secret + " after"
        let result = PetFeedbackRedactor.redact(draft)
        #expect(result.replacements > 0)
        #expect(!result.draft.note.contains(secret))
        #expect(result.draft.note.hasPrefix("before ") && result.draft.note.hasSuffix(" after"))
    }
}

@Suite("Manual feedback controller", .petLanguage(.korean)) @MainActor
struct PetFeedbackControllerTests {
    @Test("raw text needs redacted preview then a fresh content checkbox")
    func previewAndConsentSequence() async throws {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.controller.draft.note = "이메일 person@example.com 확인"
        f.controller.contentConsent = true
        await f.controller.submit()
        #expect(f.service.submissions.isEmpty)
        f.controller.preparePreview()
        #expect(f.controller.preview?.draft.note == "이메일 [이메일 가림] 확인")
        #expect(!f.controller.contentConsent)
        await f.controller.submit()
        #expect(f.service.submissions.isEmpty)
        f.controller.contentConsent = true
        await f.controller.submit()
        #expect(f.service.submissions.count == 1)
        #expect(f.service.submissions[0].draft.note == "이메일 [이메일 가림] 확인")
        #expect(f.controller.draft == PetFeedbackDraft())
    }

    @Test("editing any field invalidates preview and content consent")
    func editInvalidatesReview() {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.review(note: "공유한 내용")
        f.controller.draft.usePurpose = .learning
        #expect(f.controller.preview == nil && !f.controller.contentConsent && !f.controller.canSubmit)
    }

    @Test("selection-only feedback works without automatic telemetry or content consent")
    func selectionOnly() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.review()
        #expect(f.controller.canSubmit && !f.controller.contentConsent)
        await f.controller.submit()
        #expect(f.service.submissions.count == 1)
        #expect(!f.service.submissions[0].contentConsent && !f.service.submissions[0].draft.hasContent)
    }

    @Test("uncertain retry sends the same immutable payload and edited content gets a new UUID")
    func retryIdentity() async throws {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.service.submitErrors = [.uncertain, .uncertain]
        f.review(note: "첫 내용")
        await f.controller.submit()
        await f.controller.submit()
        #expect(f.service.submissions.count == 2)
        #expect(f.service.submissions[0] == f.service.submissions[1])
        f.controller.draft.note = "다른 내용"
        f.controller.preparePreview(); f.controller.contentConsent = true
        await f.controller.submit()
        #expect(f.service.submissions[2].submissionID != f.service.submissions[0].submissionID)
        #expect(f.service.submissions[2].draft.note == "다른 내용")
    }

    @Test("offered suggestion stays out until explicitly included")
    func explicitSuggestion() {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.controller.offerSuggestion("공유할 제안")
        #expect(f.controller.draft.suggestion.isEmpty)
        f.controller.includeOfferedSuggestion()
        #expect(f.controller.draft.suggestion == "공유할 제안" && f.controller.suggestedContent == nil)
        #expect(f.controller.preview == nil && !f.controller.contentConsent)
    }

    @Test("explicit suggestion inclusion preserves existing edits and enforces the field limit")
    func suggestionDoesNotOverwrite() {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.controller.draft.suggestion = "직접 작성한 내용"
        f.controller.offerSuggestion("현재 제안")
        f.controller.includeOfferedSuggestion()
        #expect(f.controller.draft.suggestion == "직접 작성한 내용\n\n현재 제안")
        f.controller.draft.suggestion = String(repeating: "a", count: 8_000)
        f.controller.offerSuggestion("현재 제안")
        f.controller.includeOfferedSuggestion()
        #expect(f.controller.draft.suggestion.utf8.count == 8_000 && f.controller.suggestedContent != nil)
    }

    @Test("logout same-user login account switch and window close fence late submissions", arguments: ["logout", "switch", "close", "stop"])
    func lateSubmissionFence(change: String) async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let gate = FeedbackGate(); f.service.submitGate = gate
        f.review(note: "이전 계정 내용")
        let task = Task { await f.controller.submit() }
        await gate.entered()
        switch change {
        case "logout": f.controller.clearIdentity(); f.controller.accountStateChanged()
        case "switch": f.auth.value = FeedbackValues.auth(FeedbackValues.other); f.controller.accountStateChanged()
        case "stop": f.controller.stop()
        default: f.controller.close()
        }
        gate.release(); await task.value
        #expect(f.controller.draft == PetFeedbackDraft())
        #expect(f.controller.status == nil && f.controller.preview == nil)
        #expect(!f.controller.isSubmitting && !f.controller.hasPendingRetry)
        #expect(f.service.submissionOwners == [FeedbackValues.user])
        #expect(f.service.listCalls == 0)
    }

    @Test("an unnoticed identity switch is checked again at the response boundary")
    func responseRechecksAuth() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let gate = FeedbackGate(); f.service.submitGate = gate
        f.review(note: "비공개 작성 중 내용")
        let task = Task { await f.controller.submit() }
        await gate.entered()
        f.auth.value = FeedbackValues.auth(FeedbackValues.other)
        gate.release(); await task.value
        #expect(f.controller.draft == PetFeedbackDraft() && f.controller.status == nil)
        #expect(!f.controller.isSubmitting)
    }

    @Test("temporary authentication checks preserve the reviewed draft and pause submission")
    func temporarilyUnverified() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.review(note: "내용")
        let preview = f.controller.preview
        f.auth.value = nil
        await f.controller.submit()
        #expect(f.service.submissions.isEmpty)
        #expect(!f.controller.isSignedIn && f.controller.draft.note == "내용")
        #expect(f.controller.preview == preview && f.controller.contentConsent)
        f.auth.value = FeedbackValues.auth(); f.controller.accountStateChanged()
        #expect(f.controller.canSubmit && f.controller.preview == preview)
        f.auth.value = nil; f.controller.accountStateChanged()
        f.auth.value = FeedbackValues.auth(FeedbackValues.other); f.controller.accountStateChanged()
        #expect(f.controller.draft == PetFeedbackDraft() && f.controller.preview == nil)
    }

    @Test("submit completion during verification keeps a retry and clears the busy state")
    func submitCompletesDuringChecking() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let gate = FeedbackGate(); f.service.submitGate = gate
        f.review(note: "보존할 작성 내용")
        let task = Task { await f.controller.submit() }
        await gate.entered()
        f.auth.value = nil; f.controller.accountStateChanged()
        #expect(f.controller.draft.note == "보존할 작성 내용")
        gate.release(); await task.value
        #expect(!f.controller.isSubmitting && f.controller.hasPendingRetry)
        #expect(f.controller.status == PetFeedbackError.uncertain.localizedDescription)
        f.auth.value = FeedbackValues.auth(); f.controller.accountStateChanged()
        f.service.submitGate = nil
        await f.controller.submit()
        #expect(f.service.submissions.count == 2 && f.service.submissions[0] == f.service.submissions[1])
    }

    @Test("list and delete completion during verification clear their busy state", arguments: [false, true])
    func historyCompletesDuringChecking(deleting: Bool) async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let row = FeedbackValues.summary(); f.service.rows = [row]
        await f.controller.refreshHistory()
        let gate = FeedbackGate()
        if deleting { f.service.deleteGate = gate } else { f.service.listGate = gate }
        let task = Task {
            if deleting { await f.controller.delete(row.id) } else { await f.controller.refreshHistory() }
        }
        await gate.entered()
        f.auth.value = nil; f.controller.accountStateChanged()
        gate.release(); await task.value
        #expect(!f.controller.isLoading && f.controller.deletingID == nil)
        #expect(f.controller.summaries == [row])
    }

    @Test("identity close and successful submission rotate the editor identity")
    func editorIdentityChanges() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        var previous = f.controller.editingSessionID
        f.controller.draft.note = "입력 중"
        #expect(f.controller.editingSessionID == previous)
        f.controller.close()
        #expect(f.controller.editingSessionID != previous)
        previous = f.controller.editingSessionID
        f.controller.clearIdentity()
        #expect(f.controller.editingSessionID != previous)
        f.controller.accountStateChanged()
        previous = f.controller.editingSessionID
        f.review()
        await f.controller.submit()
        #expect(f.controller.editingSessionID != previous)
    }

    @Test("expired summaries are excluded and only listed IDs can be deleted")
    func listAndDelete() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let row = FeedbackValues.summary()
        f.service.rows = [row, FeedbackValues.summary(expired: true)]
        await f.controller.refreshHistory()
        #expect(f.controller.summaries == [row])
        await f.controller.delete(UUID())
        #expect(f.service.deleted.isEmpty)
        await f.controller.delete(row.id)
        #expect(f.service.deleted == [row.id] && f.controller.summaries.isEmpty)
    }

    @Test("late list results cannot undo a completed delete")
    func listDeleteRace() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let row = FeedbackValues.summary(); f.service.rows = [row]
        await f.controller.refreshHistory()
        let gate = FeedbackGate(); f.service.listGate = gate
        let listing = Task { await f.controller.refreshHistory() }
        await gate.entered()
        await f.controller.delete(row.id)
        gate.release(); await listing.value
        #expect(f.controller.summaries.isEmpty)
        #expect(f.controller.historyStatus == "제출한 피드백을 삭제했습니다.")
    }

    @Test("late delete results cannot change the next account's state")
    func deleteIdentityFence() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let row = FeedbackValues.summary(); f.service.rows = [row]
        await f.controller.refreshHistory()
        let gate = FeedbackGate(); f.service.deleteGate = gate
        let deleting = Task { await f.controller.delete(row.id) }
        await gate.entered()
        f.controller.clearIdentity(); f.controller.accountStateChanged()
        gate.release(); await deleting.value
        #expect(f.controller.summaries.isEmpty && f.controller.historyStatus == nil && f.controller.deletingID == nil)
    }

    @Test("cancelled old list cleanup cannot clear the next list's cancellation slot")
    func oldListCannotClearNewSlot() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        let first = FeedbackValues.summary(), second = FeedbackValues.summary()
        f.service.rows = [first, second]
        await f.controller.refreshHistory()
        let gateA = FeedbackGate(); f.service.listGate = gateA
        let listA = Task { await f.controller.refreshHistory() }
        await gateA.entered()
        await f.controller.delete(first.id)
        let gateB = FeedbackGate(); f.service.listGate = gateB
        let listB = Task { await f.controller.refreshHistory() }
        await gateB.entered()
        gateA.release(); await listA.value
        #expect(f.controller.isLoading)
        await f.controller.delete(second.id)
        gateB.release(); await listB.value
        #expect(f.controller.summaries.isEmpty && !f.controller.isLoading)
    }

    @Test("mismatched receipt does not clear the draft as if submission succeeded")
    func mismatchedReceipt() async {
        let f = FeedbackFixture(); defer { f.controller.stop() }
        f.service.wrongReceipt = true; f.review(note: "보존할 내용")
        await f.controller.submit()
        #expect(f.controller.draft.note == "보존할 내용")
        #expect(f.controller.hasPendingRetry && f.controller.status == PetFeedbackError.uncertain.localizedDescription)
    }
}

@Suite("Manual feedback HTTP service", .petLanguage(.korean)) @MainActor
struct PetFeedbackServiceTests {
    @Test("submit sends only the reviewed fields and public environment")
    func requestShape() async throws {
        let payload = FeedbackValues.payload(note: "검토한 내용")
        var captured: URLRequest?
        let service = PetSupabaseFeedbackService(transport: { request in
            captured = request
            return (try JSONEncoder().encode(payload.submissionID), HTTPURLResponse(url: request.url!, statusCode: 200,
                         httpVersion: nil, headerFields: nil)!)
        }, now: { FeedbackValues.now })
        #expect(try await service.submit(payload, authorization: FeedbackValues.auth()) == payload.submissionID)
        let request = try #require(captured)
        #expect(request.url?.path == "/rest/v1/rpc/submit_blabee_feedback")
        #expect(request.httpMethod == "POST" && !request.httpShouldHandleCookies)
        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        let bytes = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        #expect(Set(body.keys) == ["p_submission_id", "p_rating", "p_reason", "p_use_purpose", "p_question", "p_answer",
            "p_suggestion", "p_note", "p_content_consent", "p_policy_version", "p_app_version", "p_app_build", "p_os_major", "p_ui_language"])
        #expect(body["p_note"] as? String == "검토한 내용")
        #expect(body["p_content_consent"] as? Bool == true)
        #expect(!String(decoding: try #require(request.httpBody), as: UTF8.self).contains("feedback-test-only-token"))
    }

    @Test("unsafe base URLs fail before transport", arguments: [
        "http://example.com", "https://user:password@example.com", "https://example.com:443",
        "https://example.com/subpath", "https://example.com/?query=x", "https://example.com/#fragment"
    ])
    func unsafeURL(url: String) async {
        var calls = 0
        let service = PetSupabaseFeedbackService(configuration: .init(supabaseURL: URL(string: url)!, publishableKey: "public-key"),
            transport: { _ in calls += 1; throw URLError(.badURL) }, now: { FeedbackValues.now })
        do { _ = try await service.submit(FeedbackValues.payload(), authorization: FeedbackValues.auth()); Issue.record("Expected rejection") }
        catch { #expect(error as? PetFeedbackError == .invalidInput) }
        #expect(calls == 0)
    }

    @Test("invalid headers expired authentication and invalid payload never reach transport", arguments: ["header", "expired", "payload"])
    func invalidRequest(kind: String) async {
        var calls = 0
        let service = PetSupabaseFeedbackService(transport: { _ in calls += 1; throw URLError(.badURL) }, now: { FeedbackValues.now })
        let auth = PetUsageAuthorization(userID: FeedbackValues.user,
            accessToken: kind == "header" ? "token\r\nInjected: value" : "test-token",
            expiresAt: FeedbackValues.now.addingTimeInterval(kind == "expired" ? -1 : 60))
        let payload = kind == "payload" ? PetFeedbackPayload(submissionID: UUID(), draft: .init(), contentConsent: false,
                                                           environment: FeedbackValues.environment) : FeedbackValues.payload()
        do { _ = try await service.submit(payload, authorization: auth); Issue.record("Expected rejection") }
        catch { #expect(error is PetFeedbackError) }
        #expect(calls == 0)
    }

    @Test("redirected oversized and incorrect successful responses cannot acknowledge submission", arguments: ["url", "size", "uuid"])
    func invalidResponse(kind: String) async {
        let payload = FeedbackValues.payload()
        let service = PetSupabaseFeedbackService(transport: { request in
            let url = kind == "url" ? URL(string: "https://other.example.com/")! : request.url!
            let data = kind == "size" ? Data(repeating: 32, count: 4_097) : try JSONEncoder().encode(UUID())
            return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, now: { FeedbackValues.now })
        do { _ = try await service.submit(payload, authorization: FeedbackValues.auth()); Issue.record("Expected rejection") }
        catch { #expect(error is PetFeedbackError) }
    }

    @Test("server errors expose fixed messages without raw response content", arguments: [401, 409, 429, 503])
    func genericServerErrors(status: Int) async {
        let service = PetSupabaseFeedbackService(transport: { request in
            (Data(#"{"message":"private /Users/alice/token secret"}"#.utf8),
             HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }, now: { FeedbackValues.now })
        do { _ = try await service.submit(FeedbackValues.payload(), authorization: FeedbackValues.auth()); Issue.record("Expected rejection") }
        catch { #expect(!error.localizedDescription.contains("alice") && !error.localizedDescription.contains("token")) }
    }

    @Test("boolean delete results are idempotent", arguments: [false, true])
    func deleteRequest(alreadyPresent: Bool) async throws {
        let id = UUID()
        var captured: URLRequest?
        let service = PetSupabaseFeedbackService(transport: { request in
            captured = request
            return (try JSONEncoder().encode(alreadyPresent), HTTPURLResponse(url: request.url!, statusCode: 200,
                     httpVersion: nil, headerFields: nil)!)
        }, now: { FeedbackValues.now })
        try await service.delete(id, authorization: FeedbackValues.auth())
        let request = try #require(captured)
        #expect(request.url?.path == "/rest/v1/rpc/delete_blabee_feedback")
        let bytes = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: String])
        #expect(body == ["p_submission_id": id.uuidString.lowercased()])
    }

    @Test("summary timestamps accept PostgREST fractions and timezone offsets", arguments: [false, true])
    func listTimestamps(fractional: Bool) async throws {
        let id = UUID().uuidString.lowercased()
        let received = fractional ? "2027-01-15T08:00:00.123456+00:00" : "2027-01-15T08:00:00+00:00"
        let expires = fractional ? "2027-02-14T08:00:00.123456+00:00" : "2027-02-14T08:00:00+00:00"
        let row: [String: Any] = ["submission_id": id, "received_at": received, "expires_at": expires,
                                "rating": "helpful", "reason": "none", "use_purpose": "development", "has_content": true]
        let service = PetSupabaseFeedbackService(transport: { request in
            #expect(request.url?.path == "/rest/v1/rpc/list_blabee_feedback")
            return (try JSONSerialization.data(withJSONObject: [row]), HTTPURLResponse(url: request.url!, statusCode: 200,
                     httpVersion: nil, headerFields: nil)!)
        }, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let rows = try await service.list(authorization: FeedbackValues.auth())
        #expect(rows.count == 1 && rows[0].hasContent)
    }

    @Test("summary API rejects more than 320 rows")
    func listBound() async {
        let rows = (0..<321).map { _ in
            ["submission_id": UUID().uuidString, "received_at": "2027-01-15T08:00:00Z",
             "expires_at": "2027-02-14T08:00:00Z", "rating": "helpful", "reason": "none", "use_purpose": "none",
             "has_content": false] as [String: Any]
        }
        let service = PetSupabaseFeedbackService(transport: { request in
            (try JSONSerialization.data(withJSONObject: rows), HTTPURLResponse(url: request.url!, statusCode: 200,
                 httpVersion: nil, headerFields: nil)!)
        }, now: { FeedbackValues.now })
        do { _ = try await service.list(authorization: FeedbackValues.auth()); Issue.record("Expected bounded list rejection") }
        catch { #expect(error as? PetFeedbackError == .invalidResponse) }
    }
}

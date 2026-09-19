import Combine
import Foundation

enum PetFeedbackRating: String, CaseIterable, Codable, Sendable {
    case none, helpful, unhelpful
    var title: String { switch self { case .none: "선택하지 않음"; case .helpful: "도움이 됐어요"; case .unhelpful: "아쉬웠어요" } }
}

enum PetFeedbackReason: String, CaseIterable, Codable, Sendable {
    case none
    case nextStepClear = "next_step_clear", easierAction = "easier_action"
    case irrelevant, alreadyDone = "already_done", repetitive, didNotWork = "did_not_work"
    var title: String {
        switch self {
        case .none: "선택하지 않음"
        case .nextStepClear: "다음 할 일이 명확해졌어요"
        case .easierAction: "작업을 실행하기 편했어요"
        case .irrelevant: "현재 작업과 관련이 없었어요"
        case .alreadyDone: "이미 끝낸 작업이었어요"
        case .repetitive: "비슷한 제안이 반복됐어요"
        case .didNotWork: "기능이 제대로 작동하지 않았어요"
        }
    }
    static func allowed(for rating: PetFeedbackRating) -> [Self] {
        switch rating {
        case .none: [.none]
        case .helpful: [.none, .nextStepClear, .easierAction]
        case .unhelpful: [.none, .irrelevant, .alreadyDone, .repetitive, .didNotWork]
        }
    }
}

enum PetFeedbackPurpose: String, CaseIterable, Codable, Sendable {
    case none, development, debugging, writing, learning, other
    var title: String {
        switch self {
        case .none: "선택하지 않음"; case .development: "개발"; case .debugging: "문제 해결"
        case .writing: "글쓰기"; case .learning: "학습"; case .other: "기타"
        }
    }
}

/// User-entered content is memory-only. No initializer reads files, clipboard,
/// conversations, logs, or the automatic analytics queue.
struct PetFeedbackDraft: Equatable, Sendable {
    var rating: PetFeedbackRating = .none
    var reason: PetFeedbackReason = .none
    var usePurpose: PetFeedbackPurpose = .none
    var question = ""
    var answer = ""
    var suggestion = ""
    var note = ""

    var hasContent: Bool { [question, answer, suggestion, note].contains { !$0.isEmpty } }
    var validationMessage: String? {
        guard PetFeedbackReason.allowed(for: rating).contains(reason) else { return "평가에 맞는 이유를 선택해 주세요." }
        for (label, value, limit) in [("질문", question, 8_000), ("답변", answer, 8_000),
                                       ("Blabee 제안", suggestion, 8_000), ("의견", note, 2_000)] {
            if value.utf8.count > limit { return "\(label) 내용이 너무 깁니다. 공유할 부분만 짧게 남겨 주세요." }
            if value.unicodeScalars.contains(where: { $0.value < 32 && ![9, 10, 13].contains($0.value) }) {
                return "\(label)에 보낼 수 없는 제어 문자가 있습니다. 해당 내용을 지워 주세요."
            }
        }
        if rating == .none && usePurpose == .none && !hasContent { return "평가, 사용 목적, 의견 중 하나 이상을 입력해 주세요." }
        return nil
    }
}

enum PetFeedbackRedactor {
    struct Result: Equatable { let draft: PetFeedbackDraft; let replacements: Int }

    static func redact(_ draft: PetFeedbackDraft) -> Result {
        var result = draft
        var count = 0
        result.question = redact(draft.question, count: &count)
        result.answer = redact(draft.answer, count: &count)
        result.suggestion = redact(draft.suggestion, count: &count)
        result.note = redact(draft.note, count: &count)
        return Result(draft: result, replacements: count)
    }

    private static func redact(_ input: String, count: inout Int) -> String {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let patterns: [(String, String)] = [
            (#"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"#, "[비밀키 가림]"),
            (#"(?i)\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s\"'<>]+"#, "[인증 정보 가림]"),
            (#"(?i)[\"']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\b[\"']?\s*[:=]\s*(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s\"',;]+)"#, "[인증 정보 가림]"),
            (#"\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b"#, "[토큰 가림]"),
            (#"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"#, "[토큰 가림]"),
            (#"(?i)[?&](?:access_token|token|api_key|key|secret)=[^&\s#]+"#, "[인증 정보 가림]"),
            (#"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#, "[이메일 가림]"),
            // Keep the regex equivalent without resembling an embedded local
            // home-directory path to the release binary's privacy scanner.
            (#"(?:/[U]sers/|/home/|~/)[^\s\"'<>]+"#, "[개인 경로 가림]"),
            (#"(?i)[A-Z]:\\Users\\[^\s\"'<>]+"#, "[개인 경로 가림]"),
        ]
        for (pattern, replacement) in patterns {
            guard let expression = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(value.startIndex..., in: value)
            count += expression.numberOfMatches(in: value, range: range)
            value = expression.stringByReplacingMatches(in: value, range: range, withTemplate: replacement)
        }
        return value
    }
}

struct PetFeedbackPayload: Equatable, Sendable {
    let submissionID: UUID
    let draft: PetFeedbackDraft
    let contentConsent: Bool
    let environment: PetProductEnvironment

    var isValid: Bool { draft.validationMessage == nil && (!draft.hasContent || contentConsent) }
    var parameters: [String: Any] {
        ["p_submission_id": submissionID.uuidString.lowercased(), "p_rating": draft.rating.rawValue,
         "p_reason": draft.reason.rawValue, "p_use_purpose": draft.usePurpose.rawValue,
         "p_question": draft.question, "p_answer": draft.answer, "p_suggestion": draft.suggestion,
         "p_note": draft.note, "p_content_consent": contentConsent, "p_policy_version": 1,
         "p_app_version": environment.appVersion, "p_app_build": environment.appBuild,
         "p_os_major": environment.osMajor, "p_ui_language": environment.uiLanguage.rawValue]
    }
}

struct PetFeedbackSummary: Equatable, Identifiable, Sendable, Decodable {
    let submissionID: UUID
    let receivedAt: Date
    let expiresAt: Date
    let rating: PetFeedbackRating
    let reason: PetFeedbackReason
    let usePurpose: PetFeedbackPurpose
    let hasContent: Bool
    var id: UUID { submissionID }

    enum CodingKeys: String, CodingKey {
        case submissionID = "submission_id", receivedAt = "received_at", expiresAt = "expires_at"
        case rating, reason, usePurpose = "use_purpose", hasContent = "has_content"
    }

    init(submissionID: UUID, receivedAt: Date, expiresAt: Date, rating: PetFeedbackRating,
         reason: PetFeedbackReason, usePurpose: PetFeedbackPurpose, hasContent: Bool) {
        self.submissionID = submissionID; self.receivedAt = receivedAt; self.expiresAt = expiresAt
        self.rating = rating; self.reason = reason; self.usePurpose = usePurpose; self.hasContent = hasContent
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        submissionID = try values.decode(UUID.self, forKey: .submissionID)
        guard let received = Self.date(try values.decode(String.self, forKey: .receivedAt)),
              let expires = Self.date(try values.decode(String.self, forKey: .expiresAt)),
              expires > received, expires.timeIntervalSince(received) <= 31 * 86_400 else {
            throw PetFeedbackError.invalidResponse
        }
        receivedAt = received; expiresAt = expires
        rating = try values.decode(PetFeedbackRating.self, forKey: .rating)
        reason = try values.decode(PetFeedbackReason.self, forKey: .reason)
        usePurpose = try values.decode(PetFeedbackPurpose.self, forKey: .usePurpose)
        hasContent = try values.decode(Bool.self, forKey: .hasContent)
        guard PetFeedbackReason.allowed(for: rating).contains(reason) else { throw PetFeedbackError.invalidResponse }
    }

    private static func date(_ value: String) -> Date? {
        guard value.utf8.count <= 40 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

enum PetFeedbackError: Error, LocalizedError, Equatable {
    case unauthenticated, invalidInput, rateLimited, unavailable, uncertain, invalidResponse
    var errorDescription: String? {
        switch self {
        case .unauthenticated: "로그인 상태를 확인한 뒤 다시 시도해 주세요."
        case .invalidInput: "전송할 내용을 다시 확인해 주세요."
        case .rateLimited: "하루에 피드백 10개까지 보낼 수 있습니다. 나중에 다시 보내 주세요."
        case .unavailable: "이 제출을 처리할 수 없습니다. 제출 내역을 확인하거나 새 피드백을 작성해 주세요."
        case .uncertain: "전송 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하거나 제출 내역을 확인해 주세요."
        case .invalidResponse: "서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
    }
}

@MainActor
protocol PetFeedbackServing {
    func submit(_ payload: PetFeedbackPayload, authorization: PetUsageAuthorization) async throws -> UUID
    func list(authorization: PetUsageAuthorization) async throws -> [PetFeedbackSummary]
    func delete(_ submissionID: UUID, authorization: PetUsageAuthorization) async throws
}

@MainActor
final class PetSupabaseFeedbackService: PetFeedbackServing {
    private let configuration: PetAccountConfiguration
    private let transport: PetAccountHTTPTransport
    private let now: @MainActor () -> Date

    init(configuration: PetAccountConfiguration = .current, transport: PetAccountHTTPTransport? = nil,
         now: @escaping @MainActor () -> Date = Date.init) {
        self.configuration = configuration; self.now = now
        if let transport { self.transport = transport }
        else { let client = PetAccountHTTPClient(); self.transport = { try await client.send($0) } }
    }

    func submit(_ payload: PetFeedbackPayload, authorization: PetUsageAuthorization) async throws -> UUID {
        guard payload.isValid else { throw PetFeedbackError.invalidInput }
        let data = try await request("submit_blabee_feedback", parameters: payload.parameters,
                                     authorization: authorization, maximumResponseBytes: 4_096)
        guard let result = try? JSONDecoder().decode(UUID.self, from: data), result == payload.submissionID else {
            throw PetFeedbackError.uncertain
        }
        return result
    }

    func list(authorization: PetUsageAuthorization) async throws -> [PetFeedbackSummary] {
        let data = try await request("list_blabee_feedback", parameters: [:], authorization: authorization,
                                     maximumResponseBytes: 256 * 1_024)
        guard let rows = try? JSONDecoder().decode([PetFeedbackSummary].self, from: data), rows.count <= 320,
              Set(rows.map(\.submissionID)).count == rows.count else { throw PetFeedbackError.invalidResponse }
        return rows.filter { $0.expiresAt > now() }.sorted { $0.receivedAt > $1.receivedAt }
    }

    func delete(_ submissionID: UUID, authorization: PetUsageAuthorization) async throws {
        let data = try await request("delete_blabee_feedback", parameters: ["p_submission_id": submissionID.uuidString.lowercased()],
                                     authorization: authorization, maximumResponseBytes: 4_096)
        guard (try? JSONDecoder().decode(Bool.self, from: data)) != nil else { throw PetFeedbackError.uncertain }
    }

    private func request(_ endpoint: String, parameters: [String: Any], authorization: PetUsageAuthorization,
                         maximumResponseBytes: Int) async throws -> Data {
        guard PetFeedbackValidation.authorization(authorization, at: now()) else { throw PetFeedbackError.unauthenticated }
        guard var parts = URLComponents(url: configuration.supabaseURL, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.port == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/", PetFeedbackValidation.header(configuration.publishableKey) else {
            throw PetFeedbackError.invalidInput
        }
        parts.path = "/rest/v1/rpc/" + endpoint
        guard let url = parts.url else { throw PetFeedbackError.invalidInput }
        let body = try JSONSerialization.data(withJSONObject: parameters, options: [.sortedKeys])
        guard body.count <= 65_536 else { throw PetFeedbackError.invalidInput }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "POST"; request.httpShouldHandleCookies = false; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authorization.accessToken)", forHTTPHeaderField: "Authorization")
        let data: Data, response: HTTPURLResponse
        do {
            try Task.checkCancellation()
            (data, response) = try await transport(request)
            try Task.checkCancellation()
        } catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch { throw PetFeedbackError.uncertain }
        guard response.url == url, data.count <= maximumResponseBytes else { throw PetFeedbackError.invalidResponse }
        switch response.statusCode {
        case 200: return data
        case 401, 403: throw PetFeedbackError.unauthenticated
        case 429: throw PetFeedbackError.rateLimited
        case 408, 425, 500...599: throw PetFeedbackError.uncertain
        default:
            let code = (try? JSONDecoder().decode(ServerErrorCode.self, from: data))?.code
            if code == "P0001" { throw PetFeedbackError.rateLimited }
            if code == "22023" || response.statusCode == 409 { throw PetFeedbackError.unavailable }
            throw PetFeedbackError.invalidInput
        }
    }
    private struct ServerErrorCode: Decodable { let code: String }
}

private enum PetFeedbackValidation {
    static func header(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 65_536 && value.utf8.allSatisfy { (33...126).contains($0) }
    }
    static func authorization(_ value: PetUsageAuthorization, at instant: Date) -> Bool {
        UUID(uuidString: value.userID) != nil && instant.timeIntervalSince1970.isFinite
            && value.expiresAt.timeIntervalSince1970.isFinite && value.expiresAt > instant && header(value.accessToken)
    }
}

@MainActor
final class PetFeedbackController: ObservableObject {
    struct Preview: Equatable { let draft: PetFeedbackDraft; let environment: PetProductEnvironment; let redactions: Int }
    @Published var draft = PetFeedbackDraft() { didSet { if draft != oldValue { draftChanged() } } }
    @Published private(set) var preview: Preview?
    @Published var contentConsent = false
    @Published private(set) var isSignedIn = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var isLoading = false
    @Published private(set) var deletingID: UUID?
    @Published private(set) var summaries: [PetFeedbackSummary] = []
    @Published private(set) var status: String?
    @Published private(set) var historyStatus: String?
    @Published private(set) var suggestedContent: String?
    @Published private(set) var editingSessionID = UUID()
    private let service: any PetFeedbackServing
    private let authorization: @MainActor () -> PetUsageAuthorization?
    private let now: @MainActor () -> Date
    private let makeID: @MainActor () -> UUID
    private let environment: PetProductEnvironment
    private var owner: String?
    private var generation: UInt64 = 0
    private var draftRevision: UInt64 = 0
    private var stopped = false
    private var pending: PetFeedbackPayload?
    private var submitTask: Task<Void, Never>?
    private var listTask: Task<Void, Never>?
    private var deleteTask: Task<Void, Never>?
    private var submitAttemptID: UUID?
    private var listAttemptID: UUID?
    private var deleteAttemptID: UUID?

    static func live(authorization: @escaping @MainActor () -> PetUsageAuthorization?) -> PetFeedbackController {
        .init(service: PetSupabaseFeedbackService(), authorization: authorization)
    }

    init(service: any PetFeedbackServing, authorization: @escaping @MainActor () -> PetUsageAuthorization?,
         now: @escaping @MainActor () -> Date = Date.init, makeID: @escaping @MainActor () -> UUID = UUID.init,
         environment: PetProductEnvironment = .current) {
        self.service = service; self.authorization = authorization; self.now = now
        self.makeID = makeID; self.environment = environment
        accountStateChanged()
    }

    var canSubmit: Bool { isSignedIn && !isSubmitting && preview != nil && (preview?.draft.hasContent != true || contentConsent) }
    var hasPendingRetry: Bool { pending != nil }
    var hasKnownAccount: Bool { !stopped && owner != nil }

    func accountStateChanged() {
        guard !stopped else { return }
        guard let user = currentAuthorization()?.userID else {
            // Scheduled token verification pauses sending. Explicit logout uses
            // clearIdentity and must remain distinct from this temporary state.
            isSignedIn = false
            return
        }
        if user != owner { reset(); owner = user }
        isSignedIn = true
    }

    func clearIdentity() { reset(); owner = nil; isSignedIn = false }
    func stop() { stopped = true; clearIdentity() }
    func close() { reset() }

    func offerSuggestion(_ value: String?) {
        // Kept only for an explicit user button. Never silently merged into a draft.
        suggestedContent = value.flatMap { $0.utf8.count <= 8_000 && !$0.isEmpty ? $0 : nil }
    }

    func includeOfferedSuggestion() {
        guard !isSubmitting, let suggestedContent else { return }
        let combined = draft.suggestion.isEmpty ? suggestedContent : draft.suggestion + "\n\n" + suggestedContent
        guard combined.utf8.count <= 8_000 else {
            status = "기존 제안에서 공유할 부분만 남긴 뒤 현재 제안을 추가해 주세요."
            return
        }
        draft.suggestion = combined
        self.suggestedContent = nil
    }

    func preparePreview() {
        accountStateChanged()
        guard isSignedIn, !isSubmitting else { return }
        if let message = draft.validationMessage { status = message; return }
        let result = PetFeedbackRedactor.redact(draft)
        if let message = result.draft.validationMessage { status = message; return }
        draft = result.draft
        preview = Preview(draft: result.draft, environment: environment, redactions: result.replacements)
        contentConsent = false
        status = nil
    }

    func editPreview() { preview = nil; contentConsent = false }

    func submit() async {
        guard !Task.isCancelled else { return }
        accountStateChanged()
        guard canSubmit, let preview, preview.draft == draft, let auth = currentAuthorization() else { return }
        let payload = pending ?? PetFeedbackPayload(submissionID: makeID(), draft: preview.draft,
                                                    contentConsent: preview.draft.hasContent && contentConsent,
                                                    environment: preview.environment)
        guard payload.isValid else { status = PetFeedbackError.invalidInput.localizedDescription; return }
        pending = payload
        let epoch = generation, revision = draftRevision
        let attempt = UUID(); submitAttemptID = attempt
        isSubmitting = true; status = nil
        let task = Task { [weak self] in
            guard let self else { return }
            defer {
                if sameLifetime(auth, epoch: epoch), draftRevision == revision, submitAttemptID == attempt {
                    isSubmitting = false; submitTask = nil; submitAttemptID = nil
                    if currentAuthorization() == nil, pending != nil {
                        isSignedIn = false
                        status = PetFeedbackError.uncertain.localizedDescription
                    }
                }
            }
            do {
                let receipt = try await service.submit(payload, authorization: auth)
                guard receipt == payload.submissionID else { throw PetFeedbackError.uncertain }
                guard current(auth, epoch: epoch), draftRevision == revision, !Task.isCancelled else { return }
                pending = nil; draft = PetFeedbackDraft(); self.preview = nil; contentConsent = false
                editingSessionID = UUID()
                status = "피드백을 보냈습니다. 의견을 공유해 주셔서 감사합니다."
            } catch {
                guard current(auth, epoch: epoch), draftRevision == revision, !Task.isCancelled else { return }
                if error is CancellationError { status = "전송을 중단했습니다. 제출 내역에서 결과를 확인할 수 있습니다." }
                else { status = (error as? PetFeedbackError ?? .uncertain).localizedDescription }
            }
            guard current(auth, epoch: epoch) else { return }
            isSubmitting = false; submitTask = nil
        }
        submitTask = task
        await task.value
        if current(auth, epoch: epoch), pending == nil { await refreshHistory() }
    }

    func refreshHistory() async {
        guard !Task.isCancelled else { return }
        accountStateChanged()
        guard !isLoading, deletingID == nil, let auth = currentAuthorization() else { return }
        let epoch = generation
        let attempt = UUID(); listAttemptID = attempt
        isLoading = true; historyStatus = nil
        let task = Task { [weak self] in
            guard let self else { return }
            defer {
                if sameLifetime(auth, epoch: epoch), listAttemptID == attempt {
                    isLoading = false; listTask = nil; listAttemptID = nil
                }
            }
            do {
                let rows = try await service.list(authorization: auth)
                guard current(auth, epoch: epoch), !Task.isCancelled else { return }
                guard rows.count <= 320 else { throw PetFeedbackError.invalidResponse }
                summaries = rows.filter { $0.expiresAt > now() }
            } catch {
                guard current(auth, epoch: epoch), !Task.isCancelled else { return }
                historyStatus = "제출 내역을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요."
            }
            guard current(auth, epoch: epoch) else { return }
            isLoading = false; listTask = nil
        }
        listTask = task
        await task.value
    }

    func delete(_ id: UUID) async {
        guard !Task.isCancelled else { return }
        accountStateChanged()
        guard !isSubmitting, deletingID == nil, summaries.contains(where: { $0.id == id }),
              let auth = currentAuthorization() else { return }
        let epoch = generation
        let attempt = UUID(); deleteAttemptID = attempt
        // A pending list response must not reintroduce a row removed by this request.
        listTask?.cancel(); listTask = nil; listAttemptID = nil; isLoading = false
        deletingID = id; historyStatus = nil
        let task = Task { [weak self] in
            guard let self else { return }
            defer {
                if sameLifetime(auth, epoch: epoch), deleteAttemptID == attempt {
                    deletingID = nil; deleteTask = nil; deleteAttemptID = nil
                    if currentAuthorization() == nil {
                        isSignedIn = false
                        historyStatus = "삭제 결과를 확인하지 못했습니다. 로그인 확인 후 내역을 새로 고쳐 주세요."
                    }
                }
            }
            do {
                try await service.delete(id, authorization: auth)
                guard current(auth, epoch: epoch), !Task.isCancelled else { return }
                summaries.removeAll { $0.id == id }
                if pending?.submissionID == id { pending = nil; preview = nil; contentConsent = false }
                historyStatus = "제출한 피드백을 삭제했습니다."
            } catch {
                guard current(auth, epoch: epoch), !Task.isCancelled else { return }
                historyStatus = "삭제 결과를 확인하지 못했습니다. 내역을 새로 고친 뒤 다시 시도해 주세요."
            }
            guard current(auth, epoch: epoch) else { return }
            deletingID = nil; deleteTask = nil
        }
        deleteTask = task
        await task.value
    }

    private func currentAuthorization() -> PetUsageAuthorization? {
        guard !stopped, let value = authorization(), PetFeedbackValidation.authorization(value, at: now()),
              let user = UUID(uuidString: value.userID)?.uuidString.lowercased() else { return nil }
        return .init(userID: user, accessToken: value.accessToken, expiresAt: value.expiresAt)
    }
    private func current(_ auth: PetUsageAuthorization, epoch: UInt64) -> Bool {
        guard sameLifetime(auth, epoch: epoch) else { return false }
        guard let currentAuth = currentAuthorization() else { isSignedIn = false; return false }
        guard currentAuth.userID == auth.userID else {
            accountStateChanged()
            return false
        }
        return true
    }
    private func sameLifetime(_ auth: PetUsageAuthorization, epoch: UInt64) -> Bool {
        !stopped && generation == epoch && owner == auth.userID
    }
    private func draftChanged() {
        draftRevision &+= 1
        preview = nil; contentConsent = false; pending = nil; status = nil
        submitTask?.cancel(); submitTask = nil; submitAttemptID = nil; isSubmitting = false
    }
    private func reset() {
        generation &+= 1
        submitTask?.cancel(); listTask?.cancel(); deleteTask?.cancel()
        submitTask = nil; listTask = nil; deleteTask = nil
        submitAttemptID = nil; listAttemptID = nil; deleteAttemptID = nil
        isSubmitting = false; isLoading = false; deletingID = nil
        draft = PetFeedbackDraft(); preview = nil; contentConsent = false; pending = nil
        editingSessionID = UUID()
        summaries = []; status = nil; historyStatus = nil; suggestedContent = nil
    }
}

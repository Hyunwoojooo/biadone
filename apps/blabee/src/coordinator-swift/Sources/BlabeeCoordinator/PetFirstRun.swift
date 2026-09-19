import Combine
import Darwin
import Foundation

enum PetFirstRunStep: String, Codable, CaseIterable {
    case tutorial, signIn, terms, setup
}

/// Placeholder acknowledgements are deliberately distinguishable from acceptance
/// of published terms. Supplying any production key requires all three valid keys.
struct PetFirstRunLegalDocuments: Equatable {
    let termsURL: URL?
    let privacyURL: URL?
    let version: String
    let isPlaceholder: Bool
    let termsText: String
    let privacyText: String

    static let placeholder = PetFirstRunLegalDocuments(
        termsURL: nil, privacyURL: nil, version: "draft-onboarding-v1", isPlaceholder: true,
        termsText: "임시 서비스 이용약관입니다. 온보딩 화면과 동작을 확인하기 위한 예시이며, 정식 서비스 이용약관은 추후 제공됩니다.",
        privacyText: "임시 개인정보 안내입니다. 온보딩 화면과 동작을 확인하기 위한 예시이며, 수집 항목·이용 목적·보관 기간을 포함한 정식 안내는 추후 제공됩니다."
    )

    static var current: PetFirstRunLegalDocuments? {
        configured(info: Bundle.main.infoDictionary ?? [:])
    }

    static func configured(info: [String: Any]) -> PetFirstRunLegalDocuments? {
        let keys = ["BlabeeTermsURL", "BlabeePrivacyURL", "BlabeeLegalDocumentVersion"]
        guard keys.contains(where: { info[$0] != nil }) else { return .placeholder }
        guard let terms = info[keys[0]] as? String, let privacy = info[keys[1]] as? String,
              let version = info[keys[2]] as? String,
              !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let termsURL = publishedURL(terms), let privacyURL = publishedURL(privacy)
        else { return nil }
        return PetFirstRunLegalDocuments(
            termsURL: termsURL, privacyURL: privacyURL, version: version,
            isPlaceholder: false, termsText: "", privacyText: ""
        )
    }

    private static func publishedURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil
        else { return nil }
        return url
    }
}

struct PetFirstRunConsentReceipt: Codable, Equatable {
    let accountID: String
    let documentVersion: String
    let isPlaceholder: Bool
    let acceptedAt: Date
    let usageStatisticsEnabled: Bool
    let errorDiagnosticsEnabled: Bool
}

struct PetFirstRunState: Codable, Equatable {
    var schemaVersion = 1
    var step: PetFirstRunStep = .tutorial
    var tutorialIndex = 0
    var accountID: String?
    var consentReceipt: PetFirstRunConsentReceipt?
    var setupDeferred = false
    var completedAt: Date?
}

@MainActor
protocol PetFirstRunStoring {
    func load() throws -> PetFirstRunState?
    func save(_ state: PetFirstRunState) throws
}

enum PetFirstRunStorageError: Error {
    case invalidState, invalidFile
}

/// This per-user file is independent of app/build versions and the Coordinator
/// journal. It contains no credentials, OAuth tokens, or remembered login proof.
@MainActor
struct PetFirstRunFileStore: PetFirstRunStoring {
    let url: URL

    static func live() -> PetFirstRunFileStore {
        PetFirstRunFileStore(url: FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Blabee/onboarding/state-v1.json"))
    }

    func load() throws -> PetFirstRunState? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        try validateFile()
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 65_536 else {
            throw PetFirstRunStorageError.invalidFile
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(PetFirstRunState.self, from: Data(contentsOf: url))
    }

    func save(_ state: PetFirstRunState) throws {
        let manager = FileManager.default
        let directory = url.deletingLastPathComponent()
        try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700])
        let attributes = try manager.attributesOfItem(atPath: directory.path)
        guard attributes[.type] as? FileAttributeType == .typeDirectory else {
            throw PetFirstRunStorageError.invalidFile
        }
        if manager.fileExists(atPath: url.path) { try validateFile() }
        let temporary = directory.appendingPathComponent(".onboarding-\(UUID().uuidString).tmp")
        defer { try? manager.removeItem(at: temporary) }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(state).write(to: temporary, options: .withoutOverwriting)
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        try handle.synchronize()
        guard Darwin.rename(temporary.path, url.path) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }

    private func validateFile() throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular else {
            throw PetFirstRunStorageError.invalidFile
        }
    }
}

@MainActor
final class PetFirstRunController: ObservableObject {
    static let tutorialCount = 3

    @Published private(set) var step: PetFirstRunStep = .tutorial
    @Published private(set) var tutorialIndex = 0
    @Published private(set) var isComplete = false
    @Published private(set) var accountID: String?
    @Published private(set) var accountEmail: String?
    @Published private(set) var errorMessage = ""
    @Published private(set) var isStorageLoaded = false
    @Published var acceptsTerms = false
    @Published var usageStatisticsEnabled = false
    @Published var errorDiagnosticsEnabled = false

    let legalDocuments: PetFirstRunLegalDocuments?
    var onComplete: (() -> Void)?
    private let store: any PetFirstRunStoring
    private let now: () -> Date
    private var state = PetFirstRunState()

    init(
        store: any PetFirstRunStoring = PetFirstRunFileStore.live(),
        legalDocuments: PetFirstRunLegalDocuments? = .current,
        now: @escaping () -> Date = Date.init,
        onComplete: (() -> Void)? = nil
    ) {
        self.store = store
        self.legalDocuments = legalDocuments
        self.now = now
        self.onComplete = onComplete
        retryLoading()
    }

    var canContinueAfterSignIn: Bool { accountID != nil && isStorageLoaded }
    var canAcceptTerms: Bool { accountID != nil && acceptsTerms && legalDocuments != nil && isStorageLoaded }
    var canRetryLoading: Bool { !isStorageLoaded }
    var setupDeferred: Bool { state.setupDeferred }

    func retryLoading() {
        guard !isStorageLoaded else { return }
        do {
            let loaded = try store.load() ?? PetFirstRunState()
            guard loaded.schemaVersion == 1,
                  (0..<Self.tutorialCount).contains(loaded.tutorialIndex) else {
                throw PetFirstRunStorageError.invalidState
            }
            state = loaded
            isStorageLoaded = true
            isComplete = loaded.completedAt != nil
            tutorialIndex = loaded.tutorialIndex
            // Stored IDs are never evidence that the current session is signed in.
            step = !isComplete && loaded.step != .tutorial ? .signIn : loaded.step
            restoreConsentDrafts()
            errorMessage = ""
        } catch {
            errorMessage = "온보딩 진행 상태를 읽지 못했습니다. 저장 위치를 확인하고 다시 시도해주세요."
        }
    }

    func advanceTutorial() {
        guard !isComplete, step == .tutorial else { return }
        var next = state
        if tutorialIndex + 1 < Self.tutorialCount { next.tutorialIndex += 1 }
        else { next.step = .signIn }
        if persist(next) { step = next.step; tutorialIndex = next.tutorialIndex }
    }

    func skipTutorial() {
        guard !isComplete, step == .tutorial else { return }
        var next = state
        next.step = .signIn
        if persist(next) { step = .signIn }
    }

    /// Callers supply an ID only for PetAccountPhase.signedIn after server-side
    /// identity verification. Refresh/checking temporarily removes this proof.
    func synchronizeAccount(id: String?, email: String?, isVerifying: Bool = false) {
        let verifiedID = id.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        accountID = verifiedID
        accountEmail = verifiedID == nil ? nil : email
        guard !isComplete else { return }
        guard let verifiedID else {
            // Activation and token refresh temporarily remove verification. Keep
            // the current scene while all account-dependent actions stay gated.
            if !isVerifying && (step == .terms || step == .setup) { step = .signIn }
            return
        }
        guard state.accountID != verifiedID else { return }
        // Revocation takes effect in memory even when its disk write fails. A
        // switch back must not resurrect an earlier account's accepted receipt.
        state.consentReceipt = nil
        var next = state
        next.accountID = verifiedID
        next.consentReceipt = nil
        if step != .tutorial { next.step = .signIn }
        acceptsTerms = false
        usageStatisticsEnabled = false
        errorDiagnosticsEnabled = false
        if step != .tutorial { step = .signIn }
        _ = persist(next)
    }

    @discardableResult
    func continueAfterSignIn() -> Bool {
        guard !isComplete, step == .signIn else { return false }
        guard let accountID else { return fail("소셜 계정 로그인을 완료해주세요.") }
        var next = state
        next.accountID = accountID
        next.step = validReceipt(for: accountID) ? .setup : .terms
        if next.step == .terms {
            next.consentReceipt = nil
            acceptsTerms = false
        }
        guard persist(next) else { return false }
        step = next.step
        return true
    }

    @discardableResult
    func acceptTerms() -> Bool {
        guard !isComplete, step == .terms else { return false }
        guard let accountID else { return fail("소셜 계정 로그인을 다시 확인해주세요.") }
        guard let legalDocuments else { return fail("약관 문서 설정을 확인할 수 없습니다.") }
        guard acceptsTerms else { return fail("약관과 개인정보 안내를 확인하고 동의해주세요.") }
        var next = state
        next.accountID = accountID
        next.consentReceipt = PetFirstRunConsentReceipt(
            accountID: accountID, documentVersion: legalDocuments.version,
            isPlaceholder: legalDocuments.isPlaceholder, acceptedAt: now(),
            usageStatisticsEnabled: usageStatisticsEnabled,
            errorDiagnosticsEnabled: errorDiagnosticsEnabled
        )
        next.step = .setup
        guard persist(next) else { return false }
        step = .setup
        return true
    }

    func back() {
        guard !isComplete else { return }
        var next = state
        switch step {
        case .tutorial:
            guard tutorialIndex > 0 else { return }
            next.tutorialIndex -= 1
        case .signIn: next.step = .tutorial
        case .terms: next.step = .signIn
        case .setup: next.step = .terms
        }
        guard persist(next) else { return }
        step = next.step
        tutorialIndex = next.tutorialIndex
    }

    @discardableResult
    func finishSetup(
        isReady: Bool,
        connectionDeferred: Bool = false,
        applyOptionalConsents: (Bool, Bool) throws -> Void = { _, _ in }
    ) -> Bool {
        guard !isComplete, step == .setup else { return false }
        guard let accountID, validReceipt(for: accountID), let receipt = state.consentReceipt else {
            return fail("로그인과 약관 동의를 다시 확인해주세요.")
        }
        guard isReady || connectionDeferred else { return fail("연결 설정을 완료하거나 나중에 연결을 선택해주세요.") }
        guard isStorageLoaded else { return fail("온보딩 진행 상태를 먼저 읽어야 합니다.") }
        do {
            try applyOptionalConsents(receipt.usageStatisticsEnabled, receipt.errorDiagnosticsEnabled)
        } catch {
            return fail("선택한 설정을 저장하지 못했습니다. 다시 시도해주세요.")
        }
        var next = state
        next.setupDeferred = connectionDeferred
        next.completedAt = now()
        guard persist(next) else { return false }
        isComplete = true
        onComplete?()
        return true
    }

    private func validReceipt(for accountID: String) -> Bool {
        guard let receipt = state.consentReceipt, let legalDocuments else { return false }
        return receipt.accountID == accountID
            && receipt.documentVersion == legalDocuments.version
            && receipt.isPlaceholder == legalDocuments.isPlaceholder
    }

    private func restoreConsentDrafts() {
        guard let receipt = state.consentReceipt, let id = state.accountID, validReceipt(for: id) else { return }
        acceptsTerms = true
        usageStatisticsEnabled = receipt.usageStatisticsEnabled
        errorDiagnosticsEnabled = receipt.errorDiagnosticsEnabled
    }

    private func persist(_ next: PetFirstRunState) -> Bool {
        guard isStorageLoaded else { return fail("온보딩 진행 상태를 먼저 읽어야 합니다.") }
        do {
            try store.save(next)
            state = next
            errorMessage = ""
            return true
        } catch {
            return fail("온보딩 진행 상태를 저장하지 못했습니다. 다시 시도해주세요.")
        }
    }

    private func fail(_ message: String) -> Bool {
        errorMessage = message
        return false
    }
}

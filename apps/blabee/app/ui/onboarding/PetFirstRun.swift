import Combine
import CoreFoundation
import Darwin
import Foundation

enum PetFirstRunStep: String, Codable, CaseIterable {
    case tutorial, signIn, terms, setup
}

/// Deferred documents never create an acceptance receipt. Otherwise, placeholder
/// acknowledgements remain distinguishable from acceptance of published terms.
struct PetFirstRunLegalDocuments: Equatable {
    let termsURL: URL?
    let privacyURL: URL?
    let version: String
    let isPlaceholder: Bool
    let isDeferred: Bool
    let termsText: String
    let privacyText: String

    static var placeholder: PetFirstRunLegalDocuments { PetFirstRunLegalDocuments(
        termsURL: nil, privacyURL: nil, version: "draft-onboarding-v1", isPlaceholder: true, isDeferred: false,
        termsText: PetL10n.text("These are placeholder Terms of Service for reviewing onboarding screens and behavior. Official Terms of Service will be provided later.", korean: "임시 서비스 이용약관입니다. 온보딩 화면과 동작을 확인하기 위한 예시이며, 정식 서비스 이용약관은 추후 제공됩니다."),
        privacyText: PetL10n.text("This is a placeholder Privacy Notice for reviewing onboarding screens and behavior. An official notice covering collected data, purposes, and retention periods will be provided later.", korean: "임시 개인정보 안내입니다. 온보딩 화면과 동작을 확인하기 위한 예시이며, 수집 항목·이용 목적·보관 기간을 포함한 정식 안내는 추후 제공됩니다.")
    ) }

    static let deferred = PetFirstRunLegalDocuments(
        termsURL: nil, privacyURL: nil, version: "", isPlaceholder: false, isDeferred: true,
        termsText: "", privacyText: ""
    )

    static var current: PetFirstRunLegalDocuments? {
        configured(info: Bundle.main.infoDictionary ?? [:])
    }

    static func configured(info: [String: Any]) -> PetFirstRunLegalDocuments? {
        let keys = ["BlabeeTermsURL", "BlabeePrivacyURL", "BlabeeLegalDocumentVersion"]
        if let flag = info["BlabeeLegalDocumentsDeferred"] {
            // Property-list Booleans bridge through NSNumber. Numbers and strings
            // must not silently opt an app into the deferred flow.
            guard let flag = flag as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { return nil }
            if flag.boolValue {
                guard !keys.contains(where: { info[$0] != nil }) else { return nil }
                return .deferred
            }
        }
        guard keys.contains(where: { info[$0] != nil }) else { return .placeholder }
        guard let terms = info[keys[0]] as? String, let privacy = info[keys[1]] as? String,
              let version = info[keys[2]] as? String,
              !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let termsURL = publishedURL(terms), let privacyURL = publishedURL(privacy)
        else { return nil }
        return PetFirstRunLegalDocuments(
            termsURL: termsURL, privacyURL: privacyURL, version: version,
            isPlaceholder: false, isDeferred: false, termsText: "", privacyText: ""
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

struct PetFirstRunDataSharingPreferences: Codable, Equatable {
    let accountID: String
    let savedAt: Date
    let usageStatisticsEnabled: Bool
    let errorDiagnosticsEnabled: Bool
}

struct PetFirstRunState: Codable, Equatable {
    var schemaVersion = 1
    var step: PetFirstRunStep = .tutorial
    var tutorialIndex = 0
    var accountID: String?
    var consentReceipt: PetFirstRunConsentReceipt?
    var dataSharingPreferences: PetFirstRunDataSharingPreferences?
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
    var onDiagnosticsConsentChanged: ((Bool) -> Void)?
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
    var legalDocumentsDeferred: Bool { legalDocuments?.isDeferred == true }
    var canAcceptTerms: Bool {
        accountID != nil && acceptsTerms && legalDocuments != nil && !legalDocumentsDeferred && isStorageLoaded
    }
    var canSaveDataSharingPreferences: Bool {
        accountID != nil && legalDocumentsDeferred && isStorageLoaded
    }
    var canFinishSetup: Bool {
        guard let accountID, isStorageLoaded else { return false }
        return savedDataSharingOptions(for: accountID) != nil
    }
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
            errorMessage = PetL10n.text("Unable to read onboarding progress. Check the storage location and try again.", korean: "온보딩 진행 상태를 읽지 못했습니다. 저장 위치를 확인하고 다시 시도해주세요.")
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
            if !isVerifying { onDiagnosticsConsentChanged?(false) }
            return
        }
        onDiagnosticsConsentChanged?(step == .setup
            && savedDataSharingOptions(for: verifiedID)?.errorDiagnosticsEnabled == true)
        guard state.accountID != verifiedID else { return }
        // Revocation takes effect in memory even when its disk write fails. A
        // switch back must not resurrect an earlier account's saved choices.
        state.consentReceipt = nil
        state.dataSharingPreferences = nil
        var next = state
        next.accountID = verifiedID
        next.consentReceipt = nil
        next.dataSharingPreferences = nil
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
        guard let accountID else { return fail(PetL10n.text("Complete social account sign-in.", korean: "소셜 계정 로그인을 완료해주세요.")) }
        var next = state
        next.accountID = accountID
        next.step = savedDataSharingOptions(for: accountID) != nil ? .setup : .terms
        if next.step == .terms {
            next.consentReceipt = nil
            next.dataSharingPreferences = nil
            acceptsTerms = false
            usageStatisticsEnabled = false
            errorDiagnosticsEnabled = false
        }
        guard persist(next) else { return false }
        step = next.step
        onDiagnosticsConsentChanged?(step == .setup
            && savedDataSharingOptions(for: accountID)?.errorDiagnosticsEnabled == true)
        return true
    }

    @discardableResult
    func acceptTerms() -> Bool {
        guard !isComplete, step == .terms else { return false }
        guard let accountID else { return fail(PetL10n.text("Verify social account sign-in again.", korean: "소셜 계정 로그인을 다시 확인해주세요.")) }
        guard let legalDocuments else { return fail(PetL10n.text("Unable to verify legal document settings.", korean: "약관 문서 설정을 확인할 수 없습니다.")) }
        guard !legalDocuments.isDeferred else { return fail(PetL10n.text("Save your data-sharing settings.", korean: "데이터 공유 설정을 저장해주세요.")) }
        guard acceptsTerms else { return fail(PetL10n.text("Review and agree to the terms and privacy notice.", korean: "약관과 개인정보 안내를 확인하고 동의해주세요.")) }
        var next = state
        next.accountID = accountID
        next.consentReceipt = PetFirstRunConsentReceipt(
            accountID: accountID, documentVersion: legalDocuments.version,
            isPlaceholder: legalDocuments.isPlaceholder, acceptedAt: now(),
            usageStatisticsEnabled: usageStatisticsEnabled,
            errorDiagnosticsEnabled: errorDiagnosticsEnabled
        )
        next.dataSharingPreferences = nil
        next.step = .setup
        guard persist(next) else { return false }
        step = .setup
        // The saved, account-bound choice applies before the first connection
        // attempt. Draft toggles and failed receipt writes cannot enable it.
        onDiagnosticsConsentChanged?(next.consentReceipt?.errorDiagnosticsEnabled == true)
        return true
    }

    @discardableResult
    func saveDataSharingPreferences() -> Bool {
        guard !isComplete, step == .terms else { return false }
        guard let accountID else { return fail(PetL10n.text("Verify social account sign-in again.", korean: "소셜 계정 로그인을 다시 확인해주세요.")) }
        guard legalDocumentsDeferred else { return fail(PetL10n.text("Unable to verify data-sharing settings.", korean: "데이터 공유 설정을 확인할 수 없습니다.")) }
        var next = state
        next.accountID = accountID
        next.consentReceipt = nil
        next.dataSharingPreferences = PetFirstRunDataSharingPreferences(
            accountID: accountID, savedAt: now(),
            usageStatisticsEnabled: usageStatisticsEnabled,
            errorDiagnosticsEnabled: errorDiagnosticsEnabled
        )
        next.step = .setup
        guard persist(next) else { return false }
        acceptsTerms = false
        step = .setup
        onDiagnosticsConsentChanged?(next.dataSharingPreferences?.errorDiagnosticsEnabled == true)
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
        if step != .setup { onDiagnosticsConsentChanged?(false) }
    }

    @discardableResult
    func finishSetup(
        isReady: Bool,
        connectionDeferred: Bool = false,
        applyOptionalConsents: (Bool, Bool) throws -> Void = { _, _ in }
    ) -> Bool {
        guard !isComplete, step == .setup else { return false }
        guard let accountID, let options = savedDataSharingOptions(for: accountID) else {
            return fail(legalDocumentsDeferred
                ? PetL10n.text("Recheck sign-in and data-sharing settings.", korean: "로그인과 데이터 공유 설정을 다시 확인해주세요.")
                : PetL10n.text("Recheck sign-in and terms acceptance.", korean: "로그인과 약관 동의를 다시 확인해주세요."))
        }
        guard isReady || connectionDeferred else { return fail(PetL10n.text("Complete connection setup or choose Connect Later.", korean: "연결 설정을 완료하거나 나중에 연결을 선택해주세요.")) }
        guard isStorageLoaded else { return fail(PetL10n.text("Onboarding progress must be read first.", korean: "온보딩 진행 상태를 먼저 읽어야 합니다.")) }
        do {
            try applyOptionalConsents(options.usageStatisticsEnabled, options.errorDiagnosticsEnabled)
        } catch {
            return fail(PetL10n.text("Unable to save the selected settings. Please try again.", korean: "선택한 설정을 저장하지 못했습니다. 다시 시도해주세요."))
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
        guard let receipt = state.consentReceipt, let legalDocuments, !legalDocuments.isDeferred else { return false }
        return receipt.accountID == accountID
            && receipt.documentVersion == legalDocuments.version
            && receipt.isPlaceholder == legalDocuments.isPlaceholder
    }

    private func savedDataSharingOptions(for accountID: String)
        -> (usageStatisticsEnabled: Bool, errorDiagnosticsEnabled: Bool)? {
        guard let legalDocuments else { return nil }
        if legalDocuments.isDeferred {
            guard let preferences = state.dataSharingPreferences, preferences.accountID == accountID else { return nil }
            return (preferences.usageStatisticsEnabled, preferences.errorDiagnosticsEnabled)
        }
        guard validReceipt(for: accountID), let receipt = state.consentReceipt else { return nil }
        return (receipt.usageStatisticsEnabled, receipt.errorDiagnosticsEnabled)
    }

    private func restoreConsentDrafts() {
        guard let id = state.accountID, let options = savedDataSharingOptions(for: id) else { return }
        acceptsTerms = !legalDocumentsDeferred
        usageStatisticsEnabled = options.usageStatisticsEnabled
        errorDiagnosticsEnabled = options.errorDiagnosticsEnabled
    }

    private func persist(_ next: PetFirstRunState) -> Bool {
        guard isStorageLoaded else { return fail(PetL10n.text("Onboarding progress must be read first.", korean: "온보딩 진행 상태를 먼저 읽어야 합니다.")) }
        do {
            try store.save(next)
            state = next
            errorMessage = ""
            return true
        } catch {
            return fail(PetL10n.text("Unable to save onboarding progress. Please try again.", korean: "온보딩 진행 상태를 저장하지 못했습니다. 다시 시도해주세요."))
        }
    }

    private func fail(_ message: String) -> Bool {
        errorMessage = message
        return false
    }
}

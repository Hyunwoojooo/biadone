import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Pet first-run lifecycle")
@MainActor
struct PetFirstRunTests {
    @Test("Deferred documents save disabled preferences without creating legal acceptance")
    func deferredPreferencesDefaultToDisabled() {
        let fixture = FirstRunFixture(legalDocuments: .deferred)
        fixture.advanceToTerms()
        #expect(fixture.controller.legalDocumentsDeferred)
        #expect(!fixture.controller.acceptsTerms)
        #expect(!fixture.controller.canAcceptTerms)
        #expect(fixture.controller.canSaveDataSharingPreferences)
        #expect(!fixture.controller.usageStatisticsEnabled)
        #expect(!fixture.controller.errorDiagnosticsEnabled)
        #expect(!fixture.controller.acceptTerms())
        #expect(fixture.controller.saveDataSharingPreferences())
        #expect(fixture.controller.step == .setup)
        #expect(fixture.controller.canFinishSetup)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(fixture.store.value?.dataSharingPreferences == PetFirstRunDataSharingPreferences(
            accountID: FirstRunFixture.accountID, savedAt: FirstRunFixture.date,
            usageStatisticsEnabled: false, errorDiagnosticsEnabled: false
        ))
        var applied: [Bool] = []
        #expect(fixture.controller.finishSetup(isReady: false, connectionDeferred: true) { applied = [$0, $1] })
        #expect(applied == [false, false])
        #expect(fixture.controller.isComplete)
        #expect(fixture.store.value?.consentReceipt == nil)
        let saves = fixture.store.saveCount
        for documents in [PetFirstRunLegalDocuments?.none, .placeholder, .deferred, publishedDocuments] {
            let resumed = PetFirstRunController(store: fixture.store, legalDocuments: documents)
            #expect(resumed.isComplete)
            resumed.synchronizeAccount(id: "different-user", email: nil)
            resumed.back()
            #expect(resumed.isComplete)
        }
        #expect(fixture.store.saveCount == saves)
    }

    @Test("Deferred opt-in activates only after saving and resumes only with verified matching identity")
    func deferredSavedChoicesAndResume() {
        let fixture = FirstRunFixture(legalDocuments: .deferred)
        var consents: [Bool] = []
        fixture.controller.onDiagnosticsConsentChanged = { consents.append($0) }
        fixture.advanceToTerms()
        fixture.controller.usageStatisticsEnabled = true
        fixture.controller.errorDiagnosticsEnabled = true
        fixture.store.failSave = true
        #expect(!fixture.controller.saveDataSharingPreferences())
        #expect(fixture.controller.step == .terms)
        #expect(fixture.store.value?.dataSharingPreferences == nil)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(!consents.contains(true))
        #expect(!fixture.controller.canFinishSetup)
        fixture.store.failSave = false
        #expect(fixture.controller.saveDataSharingPreferences())
        #expect(consents.last == true)
        #expect(fixture.store.value?.dataSharingPreferences?.errorDiagnosticsEnabled == true)
        let resumed = PetFirstRunController(store: fixture.store, legalDocuments: .deferred)
        var resumedConsents: [Bool] = []
        resumed.onDiagnosticsConsentChanged = { resumedConsents.append($0) }
        #expect(resumed.step == .signIn)
        #expect(resumed.accountID == nil)
        #expect(!resumed.acceptsTerms)
        #expect(resumed.usageStatisticsEnabled)
        #expect(resumed.errorDiagnosticsEnabled)
        #expect(!resumed.canFinishSetup)
        #expect(!resumed.continueAfterSignIn())
        #expect(!resumed.finishSetup(isReady: true))
        #expect(resumedConsents.isEmpty)
        resumed.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(resumedConsents.last == false)
        #expect(resumed.continueAfterSignIn())
        #expect(resumed.step == .setup)
        #expect(resumedConsents.last == true)
        // Unsaved edits must not replace the choices that authorized setup.
        resumed.usageStatisticsEnabled = false
        resumed.errorDiagnosticsEnabled = false
        var applied: [Bool] = []
        #expect(resumed.finishSetup(isReady: true) { applied = [$0, $1] })
        #expect(applied == [true, true])
        #expect(fixture.store.value?.consentReceipt == nil)
    }

    @Test("Account switches revoke deferred choices even if the revocation write fails", arguments: [false, true])
    func deferredAccountSwitchRevokesSavedChoices(writeFails: Bool) {
        let fixture = FirstRunFixture(legalDocuments: .deferred)
        fixture.advanceToTerms()
        fixture.controller.usageStatisticsEnabled = true
        fixture.controller.errorDiagnosticsEnabled = true
        #expect(fixture.controller.saveDataSharingPreferences())
        var consents: [Bool] = []
        fixture.controller.onDiagnosticsConsentChanged = { consents.append($0) }
        fixture.store.failSave = writeFails
        fixture.controller.synchronizeAccount(id: "different-user", email: nil)
        #expect(consents.last == false)
        #expect(fixture.controller.step == .signIn)
        #expect(!fixture.controller.acceptsTerms)
        #expect(!fixture.controller.usageStatisticsEnabled)
        #expect(!fixture.controller.errorDiagnosticsEnabled)
        #expect(!fixture.controller.canFinishSetup)
        if !writeFails { #expect(fixture.store.value?.dataSharingPreferences == nil) }
        fixture.controller.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        fixture.store.failSave = false
        #expect(fixture.controller.continueAfterSignIn())
        #expect(fixture.controller.step == .terms)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(fixture.store.value?.dataSharingPreferences == nil)
        #expect(!fixture.controller.finishSetup(isReady: true))
        #expect(!consents.contains(true))
    }

    @Test("Deferred preferences cannot bypass published terms, placeholders, or invalid document configuration")
    func deferredChoicesDoNotReplaceLegalAcceptance() {
        let fixture = FirstRunFixture(legalDocuments: .deferred)
        fixture.advanceToTerms()
        fixture.controller.usageStatisticsEnabled = true
        fixture.controller.errorDiagnosticsEnabled = true
        #expect(fixture.controller.saveDataSharingPreferences())
        for documents in [PetFirstRunLegalDocuments?.none, .placeholder, publishedDocuments] {
            let store = FirstRunMemoryStore(value: fixture.store.value)
            let resumed = PetFirstRunController(store: store, legalDocuments: documents)
            var consents: [Bool] = []
            resumed.onDiagnosticsConsentChanged = { consents.append($0) }
            #expect(!resumed.acceptsTerms)
            #expect(!resumed.usageStatisticsEnabled)
            #expect(!resumed.errorDiagnosticsEnabled)
            resumed.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
            #expect(resumed.continueAfterSignIn())
            #expect(resumed.step == .terms)
            #expect(!resumed.canAcceptTerms)
            #expect(!resumed.canSaveDataSharingPreferences)
            #expect(!resumed.saveDataSharingPreferences())
            #expect(!resumed.finishSetup(isReady: true))
            #expect(!consents.contains(true))
            #expect(store.value?.consentReceipt == nil)
            #expect(store.value?.dataSharingPreferences == nil)
            resumed.acceptsTerms = true
            #expect(resumed.acceptTerms() == (documents != nil))
            #expect(store.value?.dataSharingPreferences == nil)
        }
    }

    @Test("A legal receipt cannot substitute for saved deferred preferences")
    func receiptDoesNotSkipDeferredChoices() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        let resumed = PetFirstRunController(store: fixture.store, legalDocuments: .deferred)
        #expect(!resumed.acceptsTerms)
        resumed.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(resumed.continueAfterSignIn())
        #expect(resumed.step == .terms)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(fixture.store.value?.dataSharingPreferences == nil)
        #expect(!resumed.canFinishSetup)
    }

    private var publishedDocuments: PetFirstRunLegalDocuments? {
        PetFirstRunLegalDocuments.configured(info: [
            "BlabeeTermsURL": "https://example.test/terms",
            "BlabeePrivacyURL": "https://example.test/privacy",
            "BlabeeLegalDocumentVersion": "published-v1",
        ])
    }

    @Test("Persisted diagnostic consent takes effect before setup, and account changes revoke it")
    func diagnosticsDuringSetup() {
        let fixture = FirstRunFixture()
        var consents: [Bool] = []
        fixture.controller.onDiagnosticsConsentChanged = { consents.append($0) }
        fixture.advanceToTerms()
        fixture.controller.acceptsTerms = true
        fixture.controller.errorDiagnosticsEnabled = true
        #expect(!consents.contains(true))
        fixture.store.failSave = true
        #expect(!fixture.controller.acceptTerms())
        #expect(!consents.contains(true))
        fixture.store.failSave = false
        #expect(fixture.controller.acceptTerms())
        #expect(consents.last == true)
        #expect(!fixture.controller.isComplete)
        fixture.controller.synchronizeAccount(id: "other-account", email: nil)
        #expect(consents.last == false)
    }

    @Test("The three tutorial scenes resume until completion is explicitly saved")
    func tutorialResumes() {
        let store = FirstRunMemoryStore()
        let controller = PetFirstRunController(store: store)
        #expect(controller.step == .tutorial)
        #expect(controller.tutorialIndex == 0)
        #expect(!controller.isComplete)
        controller.advanceTutorial()
        controller.advanceTutorial()
        let resumed = PetFirstRunController(store: store)
        #expect(resumed.step == .tutorial)
        #expect(resumed.tutorialIndex == 2)
        resumed.advanceTutorial()
        #expect(resumed.step == .signIn)
        #expect(store.value?.completedAt == nil)
    }

    @Test("Skipping tutorial never skips verified sign-in or terms")
    func skipOnlyTutorial() {
        let fixture = FirstRunFixture()
        fixture.controller.skipTutorial()
        #expect(fixture.controller.step == .signIn)
        #expect(!fixture.controller.continueAfterSignIn())
        #expect(!fixture.controller.acceptTerms())
        #expect(!fixture.controller.finishSetup(isReady: true))
        #expect(fixture.store.value?.completedAt == nil)
    }

    @Test("An explicit verified sign-in and consent precede setup; completion fires once")
    func completesOnce() {
        let fixture = FirstRunFixture()
        var completions = 0
        fixture.controller.onComplete = { completions += 1 }
        fixture.advanceToTerms()
        #expect(fixture.controller.step == .terms)
        #expect(!fixture.controller.acceptTerms())
        fixture.controller.acceptsTerms = true
        fixture.controller.usageStatisticsEnabled = true
        #expect(fixture.controller.acceptTerms())
        #expect(fixture.controller.step == .setup)
        #expect(fixture.store.value?.completedAt == nil)
        var preferences: [Bool] = []
        #expect(fixture.controller.finishSetup(isReady: true) { preferences = [$0, $1] })
        #expect(preferences == [true, false])
        #expect(fixture.store.value?.completedAt == FirstRunFixture.date)
        #expect(fixture.controller.isComplete)
        #expect(completions == 1)
        #expect(!fixture.controller.finishSetup(isReady: true))
        #expect(completions == 1)
    }

    @Test("Completed onboarding never reappears after logout, expiry, or document updates")
    func completionSurvivesAccountAndDocumentChanges() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        #expect(fixture.controller.finishSetup(isReady: true))
        let resumed = PetFirstRunController(store: fixture.store, legalDocuments: nil)
        #expect(resumed.isComplete)
        resumed.synchronizeAccount(id: nil, email: nil)
        resumed.synchronizeAccount(id: "different-user", email: "different@example.test")
        resumed.back()
        #expect(resumed.isComplete)
        #expect(fixture.store.value?.consentReceipt?.accountID == FirstRunFixture.accountID)
    }

    @Test("A persisted identity is not login proof, but matching verified identity resumes setup")
    func resumeRequiresVerifiedIdentity() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        let resumed = PetFirstRunController(store: fixture.store)
        #expect(resumed.step == .signIn)
        #expect(resumed.accountID == nil)
        #expect(!resumed.continueAfterSignIn())
        #expect(!resumed.finishSetup(isReady: true))
        resumed.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(resumed.step == .signIn)
        #expect(resumed.continueAfterSignIn())
        #expect(resumed.step == .setup)
    }

    @Test("A different verified account invalidates consent and optional drafts")
    func accountChangeInvalidatesConsent() {
        let fixture = FirstRunFixture()
        fixture.advanceToTerms()
        fixture.controller.acceptsTerms = true
        fixture.controller.usageStatisticsEnabled = true
        fixture.controller.errorDiagnosticsEnabled = true
        #expect(fixture.controller.acceptTerms())
        fixture.controller.synchronizeAccount(id: "different-user", email: nil)
        #expect(fixture.controller.step == .signIn)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(!fixture.controller.acceptsTerms)
        #expect(!fixture.controller.usageStatisticsEnabled)
        #expect(!fixture.controller.errorDiagnosticsEnabled)
        #expect(fixture.controller.continueAfterSignIn())
        #expect(fixture.controller.step == .terms)
    }

    @Test("Failed account-switch persistence cannot restore a previous account's acceptance")
    func accountSwitchFailureStillRevokesInMemory() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        fixture.store.failSave = true
        fixture.controller.synchronizeAccount(id: "different-user", email: nil)
        #expect(fixture.controller.step == .signIn)
        #expect(!fixture.controller.errorMessage.isEmpty)
        fixture.controller.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        fixture.store.failSave = false
        #expect(fixture.controller.continueAfterSignIn())
        #expect(fixture.controller.step == .terms)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(!fixture.controller.finishSetup(isReady: true))
    }

    @Test("Temporary account verification loss blocks finish without erasing the bound receipt")
    func temporaryAccountLoss() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        let receipt = fixture.store.value?.consentReceipt
        fixture.controller.synchronizeAccount(id: nil, email: nil)
        #expect(fixture.controller.step == .signIn)
        #expect(!fixture.controller.finishSetup(isReady: true, connectionDeferred: true))
        #expect(fixture.store.value?.consentReceipt == receipt)
        fixture.controller.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(fixture.controller.continueAfterSignIn())
        #expect(fixture.controller.step == .setup)
    }

    @Test("Transient account checking preserves the current scene while blocking consent and completion",
          arguments: [PetFirstRunStep.terms, .setup])
    func checkingRetainsSceneWithoutLoginProof(_ step: PetFirstRunStep) {
        let fixture = FirstRunFixture()
        fixture.advanceToTerms()
        fixture.controller.acceptsTerms = true
        if step == .setup { #expect(fixture.controller.acceptTerms()) }
        fixture.controller.synchronizeAccount(id: nil, email: nil, isVerifying: true)
        #expect(fixture.controller.step == step)
        #expect(fixture.controller.accountID == nil)
        #expect(!fixture.controller.canAcceptTerms)
        #expect(!fixture.controller.acceptTerms())
        #expect(!fixture.controller.finishSetup(isReady: true))
        #expect(!fixture.controller.isComplete)
        fixture.controller.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(fixture.controller.step == step)
        if step == .terms { #expect(fixture.controller.acceptTerms()) }
        #expect(fixture.controller.finishSetup(isReady: true))
    }

    @Test("New documents require fresh acceptance for incomplete onboarding")
    func changedDocumentsInvalidateIncompleteConsent() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        fixture.store.value?.dataSharingPreferences = PetFirstRunDataSharingPreferences(
            accountID: FirstRunFixture.accountID, savedAt: FirstRunFixture.date,
            usageStatisticsEnabled: true, errorDiagnosticsEnabled: true
        )
        let documents = PetFirstRunLegalDocuments.configured(info: [
            "BlabeeTermsURL": "https://example.test/terms",
            "BlabeePrivacyURL": "https://example.test/privacy",
            "BlabeeLegalDocumentVersion": "2026-09-18",
        ])
        let resumed = PetFirstRunController(store: fixture.store, legalDocuments: documents)
        resumed.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(resumed.continueAfterSignIn())
        #expect(resumed.step == .terms)
        #expect(!resumed.acceptsTerms)
        #expect(!resumed.usageStatisticsEnabled)
        #expect(!resumed.errorDiagnosticsEnabled)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(fixture.store.value?.dataSharingPreferences == nil)
    }

    @Test("Placeholder acknowledgements retain their draft identity and timestamp")
    func receiptDistinguishesPlaceholder() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        #expect(fixture.store.value?.consentReceipt?.isPlaceholder == true)
        #expect(fixture.store.value?.consentReceipt?.documentVersion == "draft-onboarding-v1")
        #expect(fixture.store.value?.consentReceipt?.accountID == FirstRunFixture.accountID)
        #expect(fixture.store.value?.consentReceipt?.acceptedAt == FirstRunFixture.date)
    }

    @Test("Incomplete setup requires readiness or an explicit deferred connection")
    func deferredConnectionIsExplicit() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        #expect(!fixture.controller.finishSetup(isReady: false))
        #expect(!fixture.controller.isComplete)
        #expect(fixture.controller.finishSetup(isReady: false, connectionDeferred: true))
        #expect(fixture.controller.isComplete)
        #expect(fixture.controller.setupDeferred)
        #expect(fixture.store.value?.setupDeferred == true)
    }

    @Test("Saving consent failure keeps terms visible without recording acceptance")
    func consentSaveFailure() {
        let fixture = FirstRunFixture()
        fixture.advanceToTerms()
        fixture.controller.acceptsTerms = true
        fixture.store.failSave = true
        #expect(!fixture.controller.acceptTerms())
        #expect(fixture.controller.step == .terms)
        #expect(fixture.store.value?.consentReceipt == nil)
        #expect(!fixture.controller.errorMessage.isEmpty)
    }

    @Test("Completion-save failure cannot complete or invoke the callback")
    func completionSaveFailure() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        var completions = 0
        fixture.controller.onComplete = { completions += 1 }
        fixture.store.failSave = true
        #expect(!fixture.controller.finishSetup(isReady: true))
        #expect(!fixture.controller.isComplete)
        #expect(fixture.store.value?.completedAt == nil)
        #expect(completions == 0)
        fixture.store.failSave = false
        #expect(fixture.controller.finishSetup(isReady: true))
        #expect(completions == 1)
    }

    @Test("Preference application failure leaves completion pending")
    func preferenceFailure() {
        let fixture = FirstRunFixture()
        fixture.advanceToSetup()
        #expect(!fixture.controller.finishSetup(isReady: true) { _, _ in throw FirstRunFailure.expected })
        #expect(!fixture.controller.isComplete)
        #expect(fixture.store.value?.completedAt == nil)
    }

    @Test("Read failure does not overwrite unknown state and can be retried")
    func loadFailureIsClosed() {
        let store = FirstRunMemoryStore()
        store.failLoad = true
        let controller = PetFirstRunController(store: store)
        #expect(!controller.isStorageLoaded)
        #expect(controller.canRetryLoading)
        controller.skipTutorial()
        controller.synchronizeAccount(id: FirstRunFixture.accountID, email: nil)
        #expect(controller.step == .tutorial)
        #expect(store.saveCount == 0)
        #expect(!controller.errorMessage.isEmpty)
        store.failLoad = false
        controller.retryLoading()
        #expect(controller.isStorageLoaded)
        #expect(!controller.canRetryLoading)
        controller.skipTutorial()
        #expect(controller.step == .signIn)
    }

    @Test("Unknown state versions and invalid tutorial indexes fail closed")
    func invalidStateIsClosed() {
        for state in [PetFirstRunState(schemaVersion: 2), PetFirstRunState(tutorialIndex: 99)] {
            let store = FirstRunMemoryStore(value: state)
            let controller = PetFirstRunController(store: store)
            controller.skipTutorial()
            #expect(!controller.errorMessage.isEmpty)
            #expect(store.saveCount == 0)
        }
    }

    @Test("Back navigation preserves the tutorial and supports revisiting accepted terms")
    func backNavigation() {
        let fixture = FirstRunFixture()
        fixture.controller.advanceTutorial()
        fixture.controller.back()
        #expect(fixture.controller.tutorialIndex == 0)
        fixture.advanceToSetup()
        fixture.controller.back()
        #expect(fixture.controller.step == .terms)
        fixture.controller.back()
        #expect(fixture.controller.step == .signIn)
        fixture.controller.back()
        #expect(fixture.controller.step == .tutorial)
    }

    @Test("Unconfigured documents use visible placeholders, but malformed production keys fail closed")
    func legalConfigurationValidation() {
        #expect(PetFirstRunLegalDocuments.configured(info: [:])?.isPlaceholder == true)
        #expect(PetFirstRunLegalDocuments.configured(info: ["BlabeeTermsURL": "https://example.test"]) == nil)
        for url in ["http://example.test/terms", "file:///terms", "https://name:password@example.test/terms"] {
            #expect(PetFirstRunLegalDocuments.configured(info: [
                "BlabeeTermsURL": url, "BlabeePrivacyURL": "https://example.test/privacy",
                "BlabeeLegalDocumentVersion": "v1",
            ]) == nil)
        }
        let fixture = FirstRunFixture(legalDocuments: nil)
        fixture.advanceToTerms()
        fixture.controller.acceptsTerms = true
        #expect(!fixture.controller.acceptTerms())
        #expect(fixture.store.value?.consentReceipt == nil)
    }

    @Test("Document deferral requires an explicit Boolean and forbids every document key")
    func deferredConfigurationValidation() throws {
        let documents = try #require(PetFirstRunLegalDocuments.configured(info: ["BlabeeLegalDocumentsDeferred": true]))
        #expect(documents == .deferred)
        #expect(!documents.isPlaceholder)
        #expect(documents.termsURL == nil)
        #expect(documents.privacyURL == nil)
        #expect(PetFirstRunLegalDocuments.configured(info: ["BlabeeLegalDocumentsDeferred": false]) == .placeholder)
        #expect(PetFirstRunLegalDocuments.configured(info: ["BlabeeLegalDocumentsDeferred": NSNumber(value: true)]) == .deferred)
        let invalidFlags: [Any] = ["true", "false", 1, 0, NSNumber(value: 1), NSNull()]
        for flag in invalidFlags {
            #expect(PetFirstRunLegalDocuments.configured(info: ["BlabeeLegalDocumentsDeferred": flag]) == nil)
        }
        for key in ["BlabeeTermsURL", "BlabeePrivacyURL", "BlabeeLegalDocumentVersion"] {
            let values: [Any] = ["", "https://example.test/document", NSNull()]
            for value in values {
                #expect(PetFirstRunLegalDocuments.configured(info: [
                    "BlabeeLegalDocumentsDeferred": true, key: value,
                ]) == nil)
            }
        }
        var published: [String: Any] = [
            "BlabeeTermsURL": "https://example.test/terms",
            "BlabeePrivacyURL": "https://example.test/privacy",
            "BlabeeLegalDocumentVersion": "published-v1",
            "BlabeeLegalDocumentsDeferred": false,
        ]
        #expect(PetFirstRunLegalDocuments.configured(info: published) == publishedDocuments)
        published["BlabeeLegalDocumentsDeferred"] = true
        #expect(PetFirstRunLegalDocuments.configured(info: published) == nil)
        published["BlabeeLegalDocumentsDeferred"] = "false"
        #expect(PetFirstRunLegalDocuments.configured(info: published) == nil)
    }

    @Test("Schema-v1 JSON without preferences retains its terms step, receipt, and completion")
    func legacyJSONStillDecodes() throws {
        for completion in ["", #", "completedAt": "2026-09-18T00:00:00Z""#] {
            let json = """
            {"schemaVersion":1,"step":"terms","tutorialIndex":2,"accountID":"verified-social-account",
             "consentReceipt":{"accountID":"verified-social-account","documentVersion":"draft-onboarding-v1",
               "isPlaceholder":true,"acceptedAt":"2026-09-18T00:00:00Z",
               "usageStatisticsEnabled":false,"errorDiagnosticsEnabled":true},"setupDeferred":false\(completion)}
            """
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let state = try decoder.decode(PetFirstRunState.self, from: Data(json.utf8))
            #expect(state.schemaVersion == 1)
            #expect(state.step == .terms)
            #expect(state.dataSharingPreferences == nil)
            #expect(state.consentReceipt?.isPlaceholder == true)
            #expect(state.consentReceipt?.errorDiagnosticsEnabled == true)
            let store = FirstRunMemoryStore(value: state)
            let resumed = PetFirstRunController(store: store, legalDocuments: .deferred)
            #expect(resumed.isComplete == !completion.isEmpty)
            #expect(store.saveCount == 0)
        }
    }

    @Test("Atomic file persistence survives replacement without retaining tokens or email")
    func atomicFilePersistence() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PetFirstRunFileStore(url: directory.appendingPathComponent("state-v1.json"))
        #expect(try store.load() == nil)
        var state = PetFirstRunState(step: .signIn, tutorialIndex: 2)
        try store.save(state)
        #expect(try store.load() == state)
        state.completedAt = FirstRunFixture.date
        try store.save(state)
        #expect(try store.load() == state)
        let contents = try String(contentsOf: store.url, encoding: .utf8)
        #expect(!contents.contains("accessToken"))
        #expect(!contents.contains("refreshToken"))
        #expect(!contents.contains("email"))
        let mode = try FileManager.default.attributesOfItem(atPath: store.url.path)[.posixPermissions] as? NSNumber
        #expect(mode?.intValue == 0o600)
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path) == ["state-v1.json"])
    }
}

@MainActor
private final class FirstRunMemoryStore: PetFirstRunStoring {
    var value: PetFirstRunState?
    var failLoad = false
    var failSave = false
    var saveCount = 0

    init(value: PetFirstRunState? = nil) { self.value = value }
    func load() throws -> PetFirstRunState? {
        if failLoad { throw FirstRunFailure.expected }
        return value
    }
    func save(_ state: PetFirstRunState) throws {
        if failSave { throw FirstRunFailure.expected }
        value = state
        saveCount += 1
    }
}

private enum FirstRunFailure: Error { case expected }

@MainActor
private struct FirstRunFixture {
    static let date = Date(timeIntervalSince1970: 1_790_000_000)
    static let accountID = "verified-social-account"
    let store = FirstRunMemoryStore()
    let controller: PetFirstRunController

    init(legalDocuments: PetFirstRunLegalDocuments? = .placeholder) {
        controller = PetFirstRunController(store: store, legalDocuments: legalDocuments, now: { Self.date })
    }

    func advanceToTerms() {
        controller.skipTutorial()
        controller.synchronizeAccount(id: Self.accountID, email: "verified@example.test")
        #expect(controller.step == .signIn)
        #expect(controller.continueAfterSignIn())
    }

    func advanceToSetup() {
        advanceToTerms()
        controller.acceptsTerms = true
        #expect(controller.acceptTerms())
    }
}

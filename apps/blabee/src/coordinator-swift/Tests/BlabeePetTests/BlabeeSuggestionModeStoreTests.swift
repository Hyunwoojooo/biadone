import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private func suggestionModeDefaults() -> (UserDefaults, String) {
    let suiteName = "com.biadone.blabee.tests.suggestion-mode." + UUID().uuidString
    let defaults = UserDefaults(suiteName: suiteName)!
    defaults.removePersistentDomain(forName: suiteName)
    return (defaults, suiteName)
}

private final class PetFakeSuggestionModeStore: BlabeeSuggestionModeStoring, @unchecked Sendable {
    private(set) var result: BlabeeSuggestionModeLoadResult
    private(set) var savedModes: [BlabeeSuggestionMode] = []

    init(_ result: BlabeeSuggestionModeLoadResult) {
        self.result = result
    }

    func load() -> BlabeeSuggestionModeLoadResult { result }

    func save(_ mode: BlabeeSuggestionMode) {
        savedModes.append(mode)
        result = BlabeeSuggestionModeLoadResult(mode: mode, diagnostic: nil)
    }
}

@Test("Suggestion mode defaults to smart when no preference exists")
func suggestionModeStoreMissingDefaultsToSmart() {
    let (defaults, suiteName) = suggestionModeDefaults()
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let result = BlabeeSuggestionModeStore(defaults: defaults).load()

    #expect(result.mode == .smart)
    #expect(result.diagnostic == nil)
}

@Test("Suggestion mode fails closed for invalid persisted values")
func suggestionModeStoreInvalidFailsClosed() {
    let (defaults, suiteName) = suggestionModeDefaults()
    defer { defaults.removePersistentDomain(forName: suiteName) }
    defaults.set("future_mode", forKey: BlabeeSuggestionModeStore.defaultKey)

    let result = BlabeeSuggestionModeStore(defaults: defaults).load()

    #expect(result.mode == .actionOnly)
    #expect(result.diagnostic?.contains("작업만") == true)
}

@Test("Suggestion mode saves and restores all supported values")
func suggestionModeStoreRoundTripsSupportedValues() {
    let (defaults, suiteName) = suggestionModeDefaults()
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let store = BlabeeSuggestionModeStore(defaults: defaults)

    for mode in BlabeeSuggestionMode.allCases {
        store.save(mode)
        let result = store.load()
        #expect(result.mode == mode)
        #expect(result.diagnostic == nil)
    }
}

@Test("Pet exposes invalid-mode diagnostics and saves a replacement immediately")
@MainActor
func petSuggestionModeReplacesInvalidPreference() {
    let store = PetFakeSuggestionModeStore(
        BlabeeSuggestionModeLoadResult(
            mode: .actionOnly,
            diagnostic: "invalid suggestion mode"
        )
    )
    let viewModel = PetViewModel(
        transport: PetFakeTransport(),
        externalApplicationOpener: PetFakeApplicationOpener(),
        suggestionModeStore: store,
        processIdentifier: 999
    )

    #expect(viewModel.suggestionMode == .actionOnly)
    #expect(viewModel.suggestionModeDiagnostic == "invalid suggestion mode")

    viewModel.updateSuggestionMode(.always)

    #expect(viewModel.suggestionMode == .always)
    #expect(viewModel.suggestionModeDiagnostic == nil)
    #expect(store.savedModes == [.always])
    #expect(store.load().mode == .always)
}

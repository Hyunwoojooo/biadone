import Testing
@testable import BlabeeCoordinator

/// Keep existing Korean copy assertions explicit and independent of the user's
/// saved preference. Task-local scope also covers child tasks, without changing
/// UserDefaults or racing parallel tests of the English UI.
struct PetLanguageTestTrait: SuiteTrait, TestTrait, TestScoping {
    let language: PetUILanguage
    var isRecursive: Bool { true }

    func provideScope(for test: Test, testCase: Test.Case?,
                      performing function: @Sendable () async throws -> Void) async throws {
        try await PetL10n.$languageOverride.withValue(language, operation: function)
    }
}

extension Trait where Self == PetLanguageTestTrait {
    static func petLanguage(_ language: PetUILanguage) -> Self { Self(language: language) }
}

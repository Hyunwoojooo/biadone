import Foundation
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

/// AppKit may evaluate SwiftUI bodies outside a test's TaskLocal. Mirror the
/// requested render language in this test process's volatile argument domain,
/// never in the user's persistent preferences. Render suites use the serial
/// Swift test command; restore the entire prior domain before leaving a render.
@MainActor
func petRenderLanguageOverride(_ language: PetUILanguage) -> () -> Void {
    let defaults = UserDefaults.standard
    let previous = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
    var arguments = previous
    arguments[PetUILanguage.preferenceKey] = language.rawValue
    defaults.setVolatileDomain(arguments, forName: UserDefaults.argumentDomain)
    return { defaults.setVolatileDomain(previous, forName: UserDefaults.argumentDomain) }
}

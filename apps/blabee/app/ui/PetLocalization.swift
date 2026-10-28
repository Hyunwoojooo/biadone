import Combine
import Foundation
import SwiftUI

/// App chrome only. Provider messages, command previews, and user input retain
/// their original language and exact contents.
enum PetUILanguage: String, CaseIterable, Identifiable, Sendable {
    case english = "en"
    case korean = "ko"

    static let preferenceKey = "com.biadone.blabee.pet.ui-language.v1"
    var id: String { rawValue }
    var title: String { self == .english ? "English" : "한국어" }
    var locale: Locale { Locale(identifier: rawValue) }

    static func load(from defaults: UserDefaults) -> Self {
        defaults.string(forKey: preferenceKey).flatMap(Self.init(rawValue:)) ?? .english
    }
}

/// Each view observes the same preference. Changing it invalidates presentation
/// without replacing view identity, resetting forms, or restarting transports.
@MainActor
final class PetLocalization: ObservableObject {
    #if BLABEE_TEST_APP
    static let shared = PetLocalization(testWithoutPersistence: ())
    #else
    static let shared = PetLocalization()
    #endif
    @Published private(set) var language: PetUILanguage
    private var defaults: UserDefaults?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        language = PetUILanguage.load(from: defaults)
    }

    func setLanguage(_ language: PetUILanguage) {
        if defaults?.string(forKey: PetUILanguage.preferenceKey) != language.rawValue {
            defaults?.set(language.rawValue, forKey: PetUILanguage.preferenceKey)
        }
        #if BLABEE_TEST_APP
        BlabeeTestLanguageState.shared.set(language)
        #endif
        guard language != self.language else { return }
        self.language = language
    }

    #if BLABEE_TEST_APP
    private init(testWithoutPersistence: Void) {
        defaults = nil
        language = .english
    }

    /// Bound by the Test bootstrap only after run ownership has been checked.
    /// The initial scenario chooser has no persistence and never reads .standard.
    func bindTestRunDefaults(_ defaults: UserDefaults?) {
        self.defaults = defaults
        language = defaults.map { PetUILanguage.load(from: $0) } ?? .english
        BlabeeTestLanguageState.shared.set(language)
    }
    #endif
}

#if BLABEE_TEST_APP
/// Background model messages use this locked presentation value rather than
/// falling back to the product's standard preferences in a Test build.
private final class BlabeeTestLanguageState: @unchecked Sendable {
    static let shared = BlabeeTestLanguageState()
    private let lock = NSLock()
    private var value: PetUILanguage = .english
    func get() -> PetUILanguage { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ language: PetUILanguage) { lock.lock(); defer { lock.unlock() }; value = language }
}
#endif

enum PetL10n {
    // Allows isolated, parallel tests of both languages without modifying the
    // user's preferences. Child tasks inherit this presentation-only override.
    @TaskLocal static var languageOverride: PetUILanguage?

    static var language: PetUILanguage {
        #if BLABEE_TEST_APP
        languageOverride ?? BlabeeTestLanguageState.shared.get()
        #else
        languageOverride ?? PetUILanguage.load(from: .standard)
        #endif
    }

    /// Only call with app-owned literals. Lazy branches preserve interpolation
    /// types and evaluate the selected message once, without parsing user text.
    static func text(_ english: @autoclosure () -> String, korean: @autoclosure () -> String) -> String {
        language == .korean ? korean() : english()
    }
}

/// For app-owned messages kept in transient model state. Resolve at display
/// time so a language switch does not rerun setup or replace the model.
struct PetLocalizedMessage: Equatable, Sendable {
    let english: String
    let korean: String

    init(_ english: String, korean: String) {
        self.english = english
        self.korean = korean
    }

    static func verbatim(_ text: String) -> Self { .init(text, korean: text) }
    var text: String { PetL10n.text(english, korean: korean) }
}

struct PetLanguagePicker: View {
    @ObservedObject var localization: PetLocalization
    var compact = false

    var body: some View {
        HStack(spacing: 12) {
            if !compact {
                Text(PetL10n.text("Language", korean: "언어"))
                    .font(.blabee(size: 14, weight: .medium))
                Spacer(minLength: 8)
            }
            Picker(PetL10n.text("Language", korean: "언어"), selection: Binding(
                get: { localization.language }, set: localization.setLanguage
            )) {
                ForEach(PetUILanguage.allCases) { language in
                    Text(verbatim: language.title).tag(language)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(width: compact ? 112 : 132)
            .accessibilityIdentifier("settings-ui-language")
        }
    }
}

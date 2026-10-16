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
    static let shared = PetLocalization()
    @Published private(set) var language: PetUILanguage
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        language = PetUILanguage.load(from: defaults)
    }

    func setLanguage(_ language: PetUILanguage) {
        if defaults.string(forKey: PetUILanguage.preferenceKey) != language.rawValue {
            defaults.set(language.rawValue, forKey: PetUILanguage.preferenceKey)
        }
        guard language != self.language else { return }
        self.language = language
    }
}

enum PetL10n {
    // Allows isolated, parallel tests of both languages without modifying the
    // user's preferences. Child tasks inherit this presentation-only override.
    @TaskLocal static var languageOverride: PetUILanguage?

    static var language: PetUILanguage {
        languageOverride ?? PetUILanguage.load(from: .standard)
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

    var body: some View {
        HStack(spacing: 12) {
            Text(PetL10n.text("Language", korean: "언어"))
                .font(.blabee(size: 14, weight: .medium))
            Spacer(minLength: 8)
            Picker(PetL10n.text("Language", korean: "언어"), selection: Binding(
                get: { localization.language }, set: localization.setLanguage
            )) {
                ForEach(PetUILanguage.allCases) { language in
                    Text(verbatim: language.title).tag(language)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(width: 132)
            .accessibilityIdentifier("settings-ui-language")
        }
    }
}

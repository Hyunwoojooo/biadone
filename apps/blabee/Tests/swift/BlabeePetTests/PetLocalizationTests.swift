import Combine
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("App UI language")
@MainActor
struct PetLocalizationTests {
    private func withDefaults(_ body: (UserDefaults) throws -> Void) throws {
        let name = "blabee-ui-language-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        try body(defaults)
    }

    @Test("New and existing installations without a preference use English regardless of macOS language")
    func englishDefault() throws {
        try withDefaults { defaults in
            defaults.set(["ko-KR"], forKey: "AppleLanguages")
            let preferences = PetLocalization(defaults: defaults)
            #expect(preferences.language == .english)
            #expect(defaults.object(forKey: PetUILanguage.preferenceKey) == nil)
            #expect(defaults.stringArray(forKey: "AppleLanguages") == ["ko-KR"])
        }
    }

    @Test("Explicit selection persists across controller recreation and publishes once", arguments: PetUILanguage.allCases)
    func persists(_ language: PetUILanguage) throws {
        try withDefaults { defaults in
            let preferences = PetLocalization(defaults: defaults)
            let systemLanguages = defaults.stringArray(forKey: "AppleLanguages")
            var changes: [PetUILanguage] = []
            let subscription = preferences.$language.dropFirst().sink { changes.append($0) }
            defer { subscription.cancel() }
            preferences.setLanguage(language)
            preferences.setLanguage(language)
            #expect(defaults.string(forKey: PetUILanguage.preferenceKey) == language.rawValue)
            #expect(PetLocalization(defaults: defaults).language == language)
            #expect(changes == (language == .english ? [] : [.korean]))
            #expect(defaults.stringArray(forKey: "AppleLanguages") == systemLanguages)
        }
    }

    @Test("An unknown preference falls back without destroying it; an explicit choice replaces it")
    func unknownPreference() throws {
        try withDefaults { defaults in
            defaults.set("future-language", forKey: PetUILanguage.preferenceKey)
            let preferences = PetLocalization(defaults: defaults)
            #expect(preferences.language == .english)
            #expect(defaults.string(forKey: PetUILanguage.preferenceKey) == "future-language")
            preferences.setLanguage(.english)
            #expect(defaults.string(forKey: PetUILanguage.preferenceKey) == "en")
        }
    }

    @Test("Settings, approvals, menu and diagnostics resolve in the selected language without changing action IDs")
    func appChrome() {
        PetL10n.$languageOverride.withValue(.english) {
            #expect(PetSettingsTab.general.title == "General")
            #expect(PetSettingsTab.connection.title == "Connection")
            #expect(PetMenuBarInteractionPolicy.quitMenuTitle == "Quit Blabee")
            #expect(PetAppServiceState.ready.title == "Service connected")
            #expect(PetFirstRunTheme.system.title == "System")
            #expect(PetProductEnvironment.current.uiLanguage == .en)
        }
        PetL10n.$languageOverride.withValue(.korean) {
            #expect(PetSettingsTab.general.title == "일반")
            #expect(PetSettingsTab.connection.title == "연결")
            #expect(PetMenuBarInteractionPolicy.quitMenuTitle == "Blabee 종료")
            #expect(PetAppServiceState.ready.title == "서비스 연결됨")
            #expect(PetFirstRunTheme.system.title == "시스템 설정")
            #expect(PetProductEnvironment.current.uiLanguage == .ko)
        }
        #expect(PetSettingsTab.connection.rawValue == "connection")
        #expect(PetUILanguage.allCases.map(\.title) == ["English", "한국어"])
    }

    @Test("Interpolated user content is preserved and only the selected branch is evaluated")
    func exactContent() {
        let content = "사용자 원문 /tmp/한글 \"quoted\" %{0} \\n 😀"
        var evaluations = 0
        func payload() -> String { evaluations += 1; return content }
        PetL10n.$languageOverride.withValue(.english) {
            #expect(PetL10n.text("Session: \(payload())", korean: "세션: \(payload())") == "Session: " + content)
        }
        #expect(evaluations == 1)
        PetL10n.$languageOverride.withValue(.korean) {
            #expect(PetL10n.text("Session: \(payload())", korean: "세션: \(payload())") == "세션: " + content)
        }
        #expect(evaluations == 2)
    }

    @Test("An active update result changes language without restarting its three-second lifetime")
    func updateFeedback() throws {
        let start = Date(timeIntervalSince1970: 1_000)
        let feedback = try #require(PetAppUpdateCheckFeedback(state: .upToDate, now: start))
        PetL10n.$languageOverride.withValue(.english) {
            #expect(feedback.title(at: start) == "Up to Date")
        }
        PetL10n.$languageOverride.withValue(.korean) {
            #expect(feedback.title(at: start.addingTimeInterval(2)) == "최신 버전")
        }
        #expect(feedback.title(at: start.addingTimeInterval(3)) == nil)
    }
}

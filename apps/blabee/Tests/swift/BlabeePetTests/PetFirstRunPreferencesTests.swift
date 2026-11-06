import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class FirstRunLoginItemFake: PetLoginItemManaging {
    var status: PetLaunchAtLoginStatus = .notRegistered
    var statusAfterRegister: PetLaunchAtLoginStatus = .enabled
    var statusAfterUnregister: PetLaunchAtLoginStatus = .notRegistered
    var registrationError: Error?
    var unregistrationError: Error?
    var registerCalls = 0
    var unregisterCalls = 0
    var openSettingsCalls = 0

    func register() throws {
        registerCalls += 1
        if let registrationError { throw registrationError }
        status = statusAfterRegister
    }

    func unregister() throws {
        unregisterCalls += 1
        if let unregistrationError { throw unregistrationError }
        status = statusAfterUnregister
    }

    func openSettings() { openSettingsCalls += 1 }
}

@Suite("First-run appearance and main app login preferences")
@MainActor
struct PetFirstRunPreferencesTests {
    @Test("Initialization only reads settings and appearance is explicitly applied at startup")
    func initializationIsReadOnly() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        var appliedThemes: [PetFirstRunTheme] = []
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem) { appliedThemes.append($0) }

        #expect(preferences.theme == .system)
        #expect(defaults.object(forKey: PetFirstRunPreferences.themeKey) == nil)
        #expect(!preferences.launchAtLoginEnabled)
        #expect(loginItem.registerCalls == 0)
        #expect(loginItem.unregisterCalls == 0)
        #expect(appliedThemes.isEmpty)
        preferences.applyAppearance()
        #expect(appliedThemes == [.system])
    }

    @Test("Every theme persists across relaunch and selection applies it immediately", arguments: PetFirstRunTheme.allCases)
    func themePersists(theme: PetFirstRunTheme) throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var appliedThemes: [PetFirstRunTheme] = []
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunLoginItemFake()) { appliedThemes.append($0) }

        preferences.setTheme(theme)
        #expect(preferences.theme == theme)
        #expect(defaults.string(forKey: PetFirstRunPreferences.themeKey) == theme.rawValue)
        #expect(appliedThemes == [theme])

        let relaunched = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunLoginItemFake()) { appliedThemes.append($0) }
        #expect(relaunched.theme == theme)
        #expect(appliedThemes == [theme])
        relaunched.applyAppearance()
        #expect(appliedThemes == [theme, theme])
    }

    @Test("Unknown stored themes fall back to system without changing storage")
    func unknownThemeFallsBack() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("future-theme", forKey: PetFirstRunPreferences.themeKey)
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunLoginItemFake(), applyTheme: { _ in })
        #expect(preferences.theme == .system)
        #expect(defaults.string(forKey: PetFirstRunPreferences.themeKey) == "future-theme")
    }

    @Test("Only explicit changes register or unregister and repeated choices are idempotent")
    func loginItemChangesFollowUserAction() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in })

        preferences.setLaunchAtLogin(false)
        #expect(loginItem.unregisterCalls == 0)
        preferences.setLaunchAtLogin(true)
        preferences.setLaunchAtLogin(true)
        #expect(loginItem.registerCalls == 1)
        #expect(preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError == nil)
        preferences.setLaunchAtLogin(false)
        preferences.setLaunchAtLogin(false)
        #expect(loginItem.unregisterCalls == 1)
        #expect(!preferences.launchAtLoginEnabled)
    }

    @Test("Registration awaiting macOS consent is not reported enabled and can be revoked")
    func approvalRemainsDistinct() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        loginItem.statusAfterRegister = .requiresApproval
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in })

        preferences.setLaunchAtLogin(true)
        #expect(preferences.launchAtLoginStatus == .requiresApproval)
        #expect(!preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError == nil)
        preferences.setLaunchAtLogin(true)
        #expect(loginItem.registerCalls == 1)
        #expect(loginItem.openSettingsCalls == 0)
        preferences.openLoginItemsSettings()
        #expect(loginItem.openSettingsCalls == 1)
        preferences.setLaunchAtLogin(false)
        #expect(loginItem.unregisterCalls == 1)
        #expect(preferences.launchAtLoginStatus == .notRegistered)
    }

    @Test("Returning from System Settings refreshes actual approval without registering")
    func reflectsExternalSettingsChanges() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        loginItem.status = .requiresApproval
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in })
        loginItem.status = .enabled
        preferences.reloadLaunchAtLoginStatus()
        #expect(preferences.launchAtLoginEnabled)
        loginItem.status = .requiresApproval
        preferences.reloadLaunchAtLoginStatus()
        #expect(!preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginStatus == .requiresApproval)
        #expect(loginItem.registerCalls == 0)
        #expect(loginItem.unregisterCalls == 0)
    }

    @Test("Registration failure keeps actual OS status and exposes a recoverable error")
    func registrationFailureIsVisible() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        loginItem.registrationError = NSError(domain: "FirstRunTest", code: 1, userInfo: [NSLocalizedDescriptionKey: "Registration denied"])
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in })
        preferences.setLaunchAtLogin(true)
        #expect(preferences.launchAtLoginStatus == .notRegistered)
        #expect(!preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError?.contains("Registration denied") == true)
        loginItem.registrationError = nil
        preferences.setLaunchAtLogin(true)
        #expect(preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError == nil)
    }

    @Test("Failed unregister does not pretend login launch has been disabled")
    func unregistrationFailureIsVisible() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        loginItem.status = .enabled
        loginItem.unregistrationError = NSError(domain: "FirstRunTest", code: 2)
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in })
        preferences.setLaunchAtLogin(false)
        #expect(preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError != nil)
        loginItem.status = .notRegistered
        preferences.reloadLaunchAtLoginStatus()
        #expect(!preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError == nil)
    }

    @Test("A successful API call without the expected state is not reported as success")
    func unchangedRegistrationStatusIsVisible() throws {
        let suite = "com.biadone.blabee.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunLoginItemFake()
        loginItem.statusAfterRegister = .notRegistered
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in })
        preferences.setLaunchAtLogin(true)
        #expect(!preferences.launchAtLoginEnabled)
        #expect(preferences.launchAtLoginError != nil)
    }
}

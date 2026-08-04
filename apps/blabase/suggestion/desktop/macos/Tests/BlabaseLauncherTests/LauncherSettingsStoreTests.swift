import Foundation
import XCTest
@testable import BlabaseLauncher

@MainActor
final class LauncherSettingsStoreTests: XCTestCase {
    func testDashboardOnlyApplyDoesNotRestartAgent() throws {
        XCTAssertEqual(
            LauncherSettingsApplyPlan.make(
                previousChoice: .managedDefault,
                nextChoice: .managedDefault,
                isAgentActive: true
            ),
            LauncherSettingsApplyPlan(
                stopCurrentAgent: false,
                loadAttention: false
            )
        )
    }

    func testDataRootChangeStopsBeforeReload() throws {
        XCTAssertEqual(
            LauncherSettingsApplyPlan.make(
                previousChoice: .managedDefault,
                nextChoice: .existingReadOnly(path: "/private/tmp/blabase"),
                isAgentActive: true
            ),
            LauncherSettingsApplyPlan(
                stopCurrentAgent: true,
                loadAttention: true
            )
        )
    }

    func testSettingsTransactionStopsBeforePersistAndLoad() async throws {
        var events: [String] = []

        try await LauncherSettingsTransaction.run(
            plan: LauncherSettingsApplyPlan(
                stopCurrentAgent: true,
                loadAttention: true
            ),
            isTerminating: { false },
            stopAgent: { events.append("stop") },
            activateDataRoot: { events.append("activate") },
            persist: { events.append("persist") },
            loadAttention: { events.append("load") }
        )

        XCTAssertEqual(events, ["stop", "activate", "persist", "load"])
    }

    func testStopFailureDoesNotPersistSettings() async throws {
        var events: [String] = []

        do {
            try await LauncherSettingsTransaction.run(
                plan: LauncherSettingsApplyPlan(
                    stopCurrentAgent: true,
                    loadAttention: true
                ),
                isTerminating: { false },
                stopAgent: {
                    events.append("stop")
                    throw LauncherAgentError.invalidRuntime("stop failed")
                },
                activateDataRoot: { events.append("activate") },
                persist: { events.append("persist") },
                loadAttention: { events.append("load") }
            )
            XCTFail("Expected stop failure.")
        } catch {
            XCTAssertEqual(events, ["stop"])
        }
    }

    func testPersistsVersionedSettingsAndReloadsThem() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }
        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )
        let prepared = try store.prepare(
            dataRootChoice: .existingReadOnly(path: fixture.dataRoot.path),
            dashboardBaseURLText: "http://localhost:3102/"
        )

        store.persist(prepared)
        let reloaded = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [
                "BLABASE_LAUNCHER_DATA_ROOT": fixture.legacyRoot.path,
                "BLABASE_DASHBOARD_URL": "http://127.0.0.1:9999"
            ],
            fileManager: fixture.fileManager
        )

        XCTAssertEqual(
            reloaded.currentSnapshot,
            LauncherSettingsSnapshot(
                schemaVersion: 1,
                revision: 1,
                dataRootChoice: .existingReadOnly(
                    path: fixture.dataRoot
                        .resolvingSymlinksInPath()
                        .standardizedFileURL.path
                ),
                dashboardBaseURLString: "http://localhost:3102",
                onboardingCompleted: true
            )
        )
        XCTAssertFalse(reloaded.requiresSetup)
        XCTAssertNil(reloaded.legacyDashboardBaseURLString)
    }

    func testUnknownSettingsVersionFailsClosed() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }
        let unsupported = LauncherSettingsSnapshot(
            schemaVersion: 99,
            revision: 1,
            dataRootChoice: .managedDefault,
            dashboardBaseURLString: "https://app.blabase.com",
            onboardingCompleted: true
        )
        fixture.defaults.set(
            try LauncherSettingsStore.encode(unsupported),
            forKey: LauncherSettingsStore.storageKey
        )

        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )

        XCTAssertTrue(store.requiresSetup)
        XCTAssertNil(store.currentSnapshot)
    }

    func testRevisionExhaustionFailsClosedWithoutOverflow() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }
        let snapshot = LauncherSettingsSnapshot(
            schemaVersion: LauncherSettingsSnapshot.currentSchemaVersion,
            revision: LauncherSettingsSnapshot.maximumRevision,
            dataRootChoice: .existingReadOnly(
                path: fixture.dataRoot
                    .resolvingSymlinksInPath()
                    .standardizedFileURL.path
            ),
            dashboardBaseURLString: "https://app.blabase.com",
            onboardingCompleted: true
        )
        fixture.defaults.set(
            try LauncherSettingsStore.encode(snapshot),
            forKey: LauncherSettingsStore.storageKey
        )
        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )

        XCTAssertThrowsError(
            try store.prepare(
                dataRootChoice: snapshot.dataRootChoice,
                dashboardBaseURLText: snapshot.dashboardBaseURLString
            )
        )
        XCTAssertEqual(store.currentSnapshot, snapshot)
    }

    func testMissingSavedRootDoesNotFallBackToManagedDefault() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }
        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )
        store.persist(
            try store.prepare(
                dataRootChoice: .existingReadOnly(path: fixture.dataRoot.path),
                dashboardBaseURLText: "https://app.blabase.com"
            )
        )
        try fixture.fileManager.removeItem(at: fixture.dataRoot)

        let reloaded = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )

        XCTAssertTrue(reloaded.requiresSetup)
        XCTAssertNil(reloaded.currentDataRootChoice)
        guard case .setupRequired(let draft, _, _) = reloaded.loadResult else {
            return XCTFail("Expected setup-required state.")
        }
        XCTAssertEqual(
            draft?.dataRootChoice,
            .existingReadOnly(
                path: fixture.dataRoot
                    .resolvingSymlinksInPath()
                    .standardizedFileURL.path
            )
        )
    }

    func testInvalidDashboardDoesNotReplaceValidSettings() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }
        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )
        store.persist(
            try store.prepare(
                dataRootChoice: .managedDefault,
                dashboardBaseURLText: "https://app.blabase.com"
            )
        )
        let previous = store.currentSnapshot

        XCTAssertThrowsError(
            try store.prepare(
                dataRootChoice: .managedDefault,
                dashboardBaseURLText: "https://evil.example/private"
            )
        )
        XCTAssertEqual(store.currentSnapshot, previous)
    }

    func testLegacyEnvironmentIsOnlyAnUnpersistedFirstRunCandidate() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }

        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [
                "BLABASE_LAUNCHER_DATA_ROOT": fixture.legacyRoot.path,
                "BLABASE_DASHBOARD_URL": "http://localhost:3102"
            ],
            fileManager: fixture.fileManager
        )

        guard case .setupRequired(_, let legacyPath, _) = store.loadResult else {
            return XCTFail("Expected setup-required state.")
        }
        XCTAssertEqual(
            legacyPath,
            fixture.legacyRoot
                .resolvingSymlinksInPath()
                .standardizedFileURL.path
        )
        XCTAssertEqual(
            store.legacyDashboardBaseURLString,
            "http://localhost:3102"
        )
        XCTAssertNil(fixture.defaults.data(
            forKey: LauncherSettingsStore.storageKey
        ))
    }

    func testSettingsNeverPersistSnapshotContents() throws {
        let fixture = try makeFixture(markerContents: "secret-token-value")
        defer { fixture.cleanup() }
        let store = LauncherSettingsStore(
            userDefaults: fixture.defaults,
            environment: [:],
            fileManager: fixture.fileManager
        )
        store.persist(
            try store.prepare(
                dataRootChoice: .existingReadOnly(path: fixture.dataRoot.path),
                dashboardBaseURLText: "https://app.blabase.com"
            )
        )

        let persisted = try XCTUnwrap(
            fixture.defaults.data(forKey: LauncherSettingsStore.storageKey)
        )
        XCTAssertNil(String(data: persisted, encoding: .utf8)?.range(
            of: "secret-token-value"
        ))
    }

    private func makeFixture(
        markerContents: String = "{}"
    ) throws -> SettingsFixture {
        let fileManager = FileManager.default
        let temporaryRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "blabase-settings-tests-\(UUID().uuidString)",
            isDirectory: true
        )
        let dataRoot = temporaryRoot.appendingPathComponent(
            "selected",
            isDirectory: true
        )
        let legacyRoot = temporaryRoot.appendingPathComponent(
            "legacy",
            isDirectory: true
        )
        try createMarker(
            at: dataRoot,
            contents: markerContents,
            fileManager: fileManager
        )
        try createMarker(
            at: legacyRoot,
            contents: "{}",
            fileManager: fileManager
        )
        let suiteName = "BlabaseLauncherTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        return SettingsFixture(
            fileManager: fileManager,
            temporaryRoot: temporaryRoot,
            dataRoot: dataRoot,
            legacyRoot: legacyRoot,
            defaults: defaults,
            suiteName: suiteName
        )
    }

    private func createMarker(
        at dataRoot: URL,
        contents: String,
        fileManager: FileManager
    ) throws {
        let marker = dataRoot.appendingPathComponent(
            ".local/sync/latest.json"
        )
        try fileManager.createDirectory(
            at: marker.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        XCTAssertTrue(
            fileManager.createFile(
                atPath: marker.path,
                contents: Data(contents.utf8)
            )
        )
    }
}

private struct SettingsFixture {
    let fileManager: FileManager
    let temporaryRoot: URL
    let dataRoot: URL
    let legacyRoot: URL
    let defaults: UserDefaults
    let suiteName: String

    func cleanup() {
        defaults.removePersistentDomain(forName: suiteName)
        try? fileManager.removeItem(at: temporaryRoot)
    }
}

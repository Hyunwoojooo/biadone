#if BLABEE_TEST_APP
import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private func withBlabeeTestRunFixture(_ body: (URL, BlabeeTestRunStore) throws -> Void) throws {
    let parent = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent("blabee-test-run-tests-" + UUID().uuidString.lowercased(), isDirectory: true)
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: parent) }
    let store = try BlabeeTestRunStore(rootURL: parent.appendingPathComponent("owned-store", isDirectory: true))
    try body(parent, store)
}

private func mutateBlabeeTestJSON(_ url: URL, _ mutate: (inout [String: Any]) -> Void) throws {
    var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    mutate(&object)
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]).write(to: url)
    #expect(chmod(url.path, 0o600) == 0)
}

@Suite("Blabee Test run isolation (M1 file fixtures only)")
struct BlabeeTestRunStoreTests {
    @Test("An uncreated store lists no runs without writing during first launch")
    func initializationHasNoWrites() throws {
        try withBlabeeTestRunFixture { _, store in
            #expect(!FileManager.default.fileExists(atPath: store.rootURL.path))
            let firstListing = try store.list()
            let secondListing = try store.list()
            let inventory = try store.inventory()
            #expect(firstListing.isEmpty && secondListing.isEmpty)
            #expect(inventory == BlabeeTestRunInventory(runs: [], issues: []))
            #expect(!FileManager.default.fileExists(atPath: store.rootURL.path))
        }
    }

    @Test("New runs have distinct private resources and never claim a socket or defaults prematurely")
    func createRuns() throws {
        try withBlabeeTestRunFixture { _, store in
            let first = try store.create(scenario: .freshInstall, createdAt: Date(timeIntervalSince1970: 10))
            let second = try store.create(scenario: .connected, createdAt: Date(timeIntervalSince1970: 20))
            #expect(first.runID != second.runID)
            #expect(first.settingsURL != second.settingsURL)
            #expect(first.profile == "test")
            #expect(first.ownedDefaultsSuiteNames.isEmpty)
            #expect(first.ownedRelativePaths == [".blabee-test-run-v1.json", "manifest-v1.json", "instance.lock", "settings", "logs", "results"])
            #expect(first.ownedRelativePaths.allSatisfy { !$0.hasPrefix("/") && !$0.contains("..") })
            #expect(try store.list().map(\.runID) == [second.runID, first.runID])
            for directory in [store.rootURL, first.rootURL, first.settingsURL, first.logsURL, first.resultsURL] {
                var info = stat()
                #expect(lstat(directory.path, &info) == 0)
                #expect(info.st_uid == geteuid())
                #expect(info.st_mode & 0o7777 == 0o700)
            }
        }
    }

    @Test("Resume and UI snapshot survive a new store object; no action is executed")
    func resumeSnapshot() throws {
        try withBlabeeTestRunFixture { _, store in
            let run = try store.create(scenario: .hookPending)
            let updated = try store.recordDefaultsSuiteUse(for: run)
            #expect(updated.ownedDefaultsSuiteNames == [run.defaultsSuiteName])
            #expect(try store.recordDefaultsSuiteUse(for: updated) == updated)
            #expect(run.defaultsSuiteName == "com.biadone.blabee.test.run." + run.runID.uuidString.lowercased())
            let payload = Data(#"{"onboardingStep":3,"simulatedLogin":true}"#.utf8)
            try store.saveSnapshot(payload, for: updated)
            let reopened = try BlabeeTestRunStore(rootURL: store.rootURL)
            let resumed = try reopened.resume(runID: run.runID)
            #expect(resumed == updated)
            #expect(try reopened.loadSnapshot(for: resumed) == payload)
            try reopened.validate(resumed)
            #expect(throws: BlabeeTestRunStoreError.ownershipMismatch) { try reopened.validate(run) }
        }
    }

    @Test("Creating another run preserves earlier UI data and sibling product sentinels")
    func freshRunPreservesPriorData() throws {
        try withBlabeeTestRunFixture { parent, store in
            let productSentinel = parent.appendingPathComponent("product-sentinel")
            try Data("untouched".utf8).write(to: productSentinel)
            let old = try store.create(scenario: .connectionFailed)
            let payload = Data("previous UI progress".utf8)
            try store.saveSnapshot(payload, for: old)
            let next = try store.create(scenario: .freshInstall)
            #expect(try store.loadSnapshot(for: old) == payload)
            #expect(try store.loadSnapshot(for: next) == nil)
            #expect(try Data(contentsOf: productSentinel) == Data("untouched".utf8))
        }
    }

    @Test("Run ID collisions do not overwrite the original manifest or snapshot")
    func collisionPreservesRun() throws {
        try withBlabeeTestRunFixture { _, store in
            let id = UUID()
            let run = try store.create(scenario: .loginCancelled, runID: id)
            let payload = Data("saved".utf8)
            try store.saveSnapshot(payload, for: run)
            #expect(throws: BlabeeTestRunStoreError.alreadyExists) { _ = try store.create(scenario: .connected, runID: id) }
            #expect(try store.resume(runID: id) == run)
            #expect(try store.loadSnapshot(for: run) == payload)
        }
    }

    @Test("Unmarked existing roots are not adopted or modified")
    func existingRootRequiresMarker() throws {
        try withBlabeeTestRunFixture { _, store in
            try FileManager.default.createDirectory(at: store.rootURL, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let sentinel = store.rootURL.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.inventory() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.list() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.create(scenario: .freshInstall) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: store.rootURL.path) == ["sentinel"])
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
        }
    }

    @Test("Missing resources in an existing owned store are not mistaken for first launch",
          arguments: ["runs", ".blabee-test-store-v1.json", ".store.lock"])
    func existingStoreMissingResourceIsAnError(name: String) throws {
        try withBlabeeTestRunFixture { _, store in
            _ = try store.create(scenario: .freshInstall)
            try FileManager.default.removeItem(at: store.rootURL.appendingPathComponent(name))
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.inventory() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.list() }
            #expect(FileManager.default.fileExists(atPath: store.rootURL.path))
            #expect(!FileManager.default.fileExists(atPath: store.rootURL.appendingPathComponent(name).path))
        }
    }

    @Test("Root symbolic links and symbolic-link ancestors never redirect writes")
    func rejectRootLinks() throws {
        try withBlabeeTestRunFixture { parent, store in
            let outside = parent.appendingPathComponent("outside", isDirectory: true)
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try FileManager.default.createSymbolicLink(at: store.rootURL, withDestinationURL: outside)
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.inventory() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.list() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.create(scenario: .freshInstall) }
            let nested = try BlabeeTestRunStore(rootURL: store.rootURL.appendingPathComponent("nested", isDirectory: true))
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try nested.inventory() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try nested.list() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try nested.create(scenario: .freshInstall) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
        }
    }

    @Test("Settings symbolic links cannot redirect UI progress to a sibling file")
    func rejectSettingsLink() throws {
        try withBlabeeTestRunFixture { parent, store in
            let run = try store.create(scenario: .freshInstall)
            let outside = parent.appendingPathComponent("outside", isDirectory: true)
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let sentinel = outside.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            try FileManager.default.removeItem(at: run.settingsURL)
            try FileManager.default.createSymbolicLink(at: run.settingsURL, withDestinationURL: outside)
            #expect(throws: BlabeeTestRunStoreError.self) { try store.saveSnapshot(Data("bad".utf8), for: run) }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.resume(runID: run.runID) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path) == ["sentinel"])
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
        }
    }

    @Test("Owned directories and files require exact private modes", arguments: ["root", "run", "manifest"])
    func rejectUnsafeModes(target: String) throws {
        try withBlabeeTestRunFixture { _, store in
            let run = try store.create(scenario: .freshInstall)
            let url = target == "root" ? store.rootURL : target == "run" ? run.rootURL : run.rootURL.appendingPathComponent("manifest-v1.json")
            #expect(chmod(url.path, target == "manifest" ? 0o644 : 0o755) == 0)
            if target == "root" {
                #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.inventory() }
            } else {
                let inventory = try store.inventory()
                #expect(inventory.runs.isEmpty)
                #expect(inventory.issues == [BlabeeTestRunIssue(code: "invalid_run", runID: run.runID, entryName: run.runID.uuidString.lowercased())])
            }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.list() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.resume(runID: run.runID) }
        }
    }

    @Test("Unknown profiles, schema, owner IDs, paths, defaults suites, and traversal fail closed",
          arguments: ["profile", "schemaVersion", "ownerUID", "rootPath", "settingsPath", "ownedRelativePaths", "ownedDefaultsSuiteNames"])
    func rejectManifestChanges(field: String) throws {
        try withBlabeeTestRunFixture { _, store in
            let run = try store.create(scenario: .freshInstall)
            try mutateBlabeeTestJSON(run.rootURL.appendingPathComponent("manifest-v1.json")) { object in
                switch field {
                case "profile": object[field] = "production"
                case "schemaVersion": object[field] = 99
                case "ownerUID": object[field] = UInt64(geteuid()) + 1
                case "rootPath": object[field] = store.rootURL.path
                case "settingsPath": object[field] = run.rootURL.path + "/../settings"
                case "ownedRelativePaths": object[field] = ["../../product"]
                default: object[field] = ["com.biadone.blabee"]
                }
            }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.resume(runID: run.runID) }
        }
    }

    @Test("A copied run marker and manifest cannot substitute a different requested run")
    func rejectCopiedRunIdentity() throws {
        try withBlabeeTestRunFixture { _, store in
            let first = try store.create(scenario: .freshInstall)
            let second = try store.create(scenario: .connected)
            for name in ["manifest-v1.json", ".blabee-test-run-v1.json"] {
                let data = try Data(contentsOf: second.rootURL.appendingPathComponent(name))
                try data.write(to: first.rootURL.appendingPathComponent(name))
            }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.resume(runID: first.runID) }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.list() }
            #expect(try store.resume(runID: second.runID) == second)
        }
    }

    @Test("A store marker remains bound to its original root")
    func rejectMovedStoreMarker() throws {
        try withBlabeeTestRunFixture { parent, store in
            _ = try store.create(scenario: .freshInstall)
            let moved = parent.appendingPathComponent("moved-store", isDirectory: true)
            try FileManager.default.moveItem(at: store.rootURL, to: moved)
            let copied = try BlabeeTestRunStore(rootURL: moved)
            #expect(throws: BlabeeTestRunStoreError.ownershipMismatch) { _ = try copied.list() }
        }
    }

    @Test("Store ownership markers reject unknown profiles, schemas, owners, and paths",
          arguments: ["profile", "schemaVersion", "ownerUID", "rootPath"])
    func rejectStoreMarkerChanges(field: String) throws {
        try withBlabeeTestRunFixture { _, store in
            let run = try store.create(scenario: .freshInstall)
            try mutateBlabeeTestJSON(store.rootURL.appendingPathComponent(".blabee-test-store-v1.json")) { object in
                switch field {
                case "profile": object[field] = "production"
                case "schemaVersion": object[field] = 2
                case "ownerUID": object[field] = UInt64(geteuid()) + 1
                default: object[field] = "/private/tmp/not-this-store"
                }
            }
            #expect(throws: BlabeeTestRunStoreError.ownershipMismatch) { _ = try store.resume(runID: run.runID) }
            #expect(throws: BlabeeTestRunStoreError.ownershipMismatch) { _ = try store.inventory() }
        }
    }

    @Test("Even the same run UUID cannot import another store's authority marker")
    func rejectOtherStoreRun() throws {
        try withBlabeeTestRunFixture { parent, store in
            let id = UUID()
            let first = try store.create(scenario: .freshInstall, runID: id)
            let otherStore = try BlabeeTestRunStore(rootURL: parent.appendingPathComponent("other-store", isDirectory: true))
            let second = try otherStore.create(scenario: .connected, runID: id)
            for name in ["manifest-v1.json", ".blabee-test-run-v1.json"] {
                let data = try Data(contentsOf: first.rootURL.appendingPathComponent(name))
                try data.write(to: second.rootURL.appendingPathComponent(name))
            }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try otherStore.resume(runID: id) }
            #expect(try store.resume(runID: id) == first)
        }
    }

    @Test("Snapshot envelopes are run-bound and over-size writes preserve the previous snapshot")
    func rejectSnapshotReuseAndOversize() throws {
        try withBlabeeTestRunFixture { _, store in
            let first = try store.create(scenario: .freshInstall)
            let second = try store.create(scenario: .connected)
            let payload = Data("bounded progress".utf8)
            try store.saveSnapshot(payload, for: first)
            #expect(throws: BlabeeTestRunStoreError.snapshotTooLarge) {
                try store.saveSnapshot(Data(repeating: 0, count: BlabeeTestRunStore.maximumSnapshotBytes + 1), for: first)
            }
            #expect(try store.loadSnapshot(for: first) == payload)
            let bytes = try Data(contentsOf: first.settingsURL.appendingPathComponent("snapshot-v1.json"))
            let destination = second.settingsURL.appendingPathComponent("snapshot-v1.json")
            try bytes.write(to: destination)
            #expect(chmod(destination.path, 0o600) == 0)
            #expect(throws: BlabeeTestRunStoreError.invalidSnapshot) { _ = try store.loadSnapshot(for: second) }
        }
    }

    @Test("Simulation reports are separate, bounded, and tied to the exact run")
    func simulationReports() throws {
        try withBlabeeTestRunFixture { _, store in
            let first = try store.create(scenario: .freshInstall)
            let second = try store.create(scenario: .connected)
            #expect(try store.loadResult(for: first) == nil)
            let payload = Data(#"{"level":"ui-simulation","providerValidated":false}"#.utf8)
            try store.saveResult(payload, for: first)
            #expect(try store.loadResult(for: first) == payload)
            #expect(try store.loadSnapshot(for: first) == nil)
            #expect(throws: BlabeeTestRunStoreError.resultTooLarge) {
                try store.saveResult(Data(repeating: 0, count: BlabeeTestRunStore.maximumResultBytes + 1), for: first)
            }
            #expect(try store.loadResult(for: first) == payload)
            let bytes = try Data(contentsOf: first.resultsURL.appendingPathComponent("m1-report.json"))
            let destination = second.resultsURL.appendingPathComponent("m1-report.json")
            try bytes.write(to: destination)
            #expect(chmod(destination.path, 0o600) == 0)
            #expect(throws: BlabeeTestRunStoreError.invalidResult) { _ = try store.loadResult(for: second) }
        }
    }

    @Test("Snapshot symlinks and hard-linked manifests are not followed or overwritten")
    func rejectUnsafeFiles() throws {
        try withBlabeeTestRunFixture { parent, store in
            let run = try store.create(scenario: .freshInstall)
            let sentinel = parent.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            try FileManager.default.createSymbolicLink(at: run.settingsURL.appendingPathComponent("snapshot-v1.json"), withDestinationURL: sentinel)
            #expect(throws: BlabeeTestRunStoreError.unsafeFile) { try store.saveSnapshot(Data("bad".utf8), for: run) }
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
            let manifestURL = run.rootURL.appendingPathComponent("manifest-v1.json")
            #expect(link(manifestURL.path, parent.appendingPathComponent("hard-link").path) == 0)
            #expect(throws: BlabeeTestRunStoreError.unsafeFile) { _ = try store.resume(runID: run.runID) }
        }
    }

    @Test("Run leases reject a second instance, allow independent runs, and release explicitly")
    func leaseExclusion() throws {
        try withBlabeeTestRunFixture { _, store in
            let first = try store.create(scenario: .freshInstall)
            let second = try store.create(scenario: .connected)
            let lease = try store.acquireLease(for: first)
            defer { lease.release() }
            let secondInstance = try BlabeeTestRunStore(rootURL: store.rootURL)
            #expect(throws: BlabeeTestRunStoreError.runInUse) { _ = try secondInstance.acquireLease(for: first) }
            let otherLease = try secondInstance.acquireLease(for: second)
            otherLease.release()
            lease.release()
            lease.release()
            let reacquired = try secondInstance.acquireLease(for: first)
            reacquired.release()
        }
    }

    @Test("Run leases release on deinitialization and reject a replaced lock symlink")
    func leaseLifetimeAndLink() throws {
        try withBlabeeTestRunFixture { parent, store in
            let run = try store.create(scenario: .freshInstall)
            do { let lease = try store.acquireLease(for: run); withExtendedLifetime(lease) {} }
            let reopened = try store.acquireLease(for: run)
            reopened.release()
            let sentinel = parent.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            let lockFile = run.rootURL.appendingPathComponent("instance.lock")
            try FileManager.default.removeItem(at: lockFile)
            try FileManager.default.createSymbolicLink(at: lockFile, withDestinationURL: sentinel)
            #expect(throws: BlabeeTestRunStoreError.unsafeFile) { _ = try store.acquireLease(for: run) }
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
        }
    }

    @Test("An unrecognized run entry makes listing fail without deleting it")
    func incompleteRunsArePreserved() throws {
        try withBlabeeTestRunFixture { _, store in
            let valid = try store.create(scenario: .freshInstall)
            let unknown = store.rootURL.appendingPathComponent("runs/partial", isDirectory: true)
            try FileManager.default.createDirectory(at: unknown, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            #expect(throws: BlabeeTestRunStoreError.unsupportedManifest) { _ = try store.list() }
            let inventory = try store.inventory()
            #expect(inventory.runs == [valid])
            #expect(inventory.issues == [BlabeeTestRunIssue(code: "unrecognized_run_entry", runID: nil, entryName: "partial")])
            #expect(FileManager.default.fileExists(atPath: unknown.path))
            #expect(try store.resume(runID: valid.runID) == valid)
        }
    }

    @Test("An incomplete UUID run remains diagnostic while valid runs and new tests stay available")
    func inventoryAllowsRecoveryWithoutAdoptingPartialRuns() throws {
        try withBlabeeTestRunFixture { _, store in
            let valid = try store.create(scenario: .freshInstall, createdAt: Date(timeIntervalSince1970: 10))
            let partialID = UUID()
            let partial = store.rootURL.appendingPathComponent("runs", isDirectory: true)
                .appendingPathComponent(partialID.uuidString.lowercased(), isDirectory: true)
            try FileManager.default.createDirectory(at: partial, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let before = try store.inventory()
            #expect(before.runs == [valid])
            #expect(before.issues == [BlabeeTestRunIssue(code: "invalid_run", runID: partialID, entryName: partialID.uuidString.lowercased())])
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.list() }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.resume(runID: partialID) }
            let next = try store.create(scenario: .connected, createdAt: Date(timeIntervalSince1970: 20))
            let after = try store.inventory()
            #expect(after.runs == [next, valid])
            #expect(after.issues == before.issues)
            #expect(FileManager.default.fileExists(atPath: partial.path))
            #expect(try FileManager.default.contentsOfDirectory(atPath: partial.path).isEmpty)
            #expect(try store.resume(runID: valid.runID) == valid)
        }
    }

    @Test("Inventory diagnostics omit unsafe entry names and untrusted file contents")
    func inventoryRedactsUnsafeNames() throws {
        try withBlabeeTestRunFixture { _, store in
            let valid = try store.create(scenario: .freshInstall)
            let unsafeName = "unsafe\nprivate-content"
            let entry = store.rootURL.appendingPathComponent("runs", isDirectory: true).appendingPathComponent(unsafeName)
            try Data("not diagnostic output".utf8).write(to: entry)
            let inventory = try store.inventory()
            #expect(inventory.runs == [valid])
            #expect(inventory.issues == [BlabeeTestRunIssue(code: "unrecognized_run_entry", runID: nil, entryName: nil)])
            #expect(try Data(contentsOf: entry) == Data("not diagnostic output".utf8))
        }
    }

    @Test("Future socket paths use full run identity and reject excess UTF-8 bytes")
    func shortSocketPaths() throws {
        let id = UUID()
        let socket = try BlabeeTestRunStore.proposedSocketURL(runID: id)
        #expect(socket.path.contains(id.uuidString.lowercased()))
        #expect(socket.path.utf8.count <= 103)
        let unicodeRoot = URL(fileURLWithPath: "/private/tmp/" + String(repeating: "한", count: 20), isDirectory: true)
        #expect(throws: BlabeeTestRunStoreError.invalidPath) {
            _ = try BlabeeTestRunStore.proposedSocketURL(runID: id, temporaryRoot: unicodeRoot)
        }
    }

    @Test("Product data and traversal are rejected using path values without opening product files")
    func rejectProductAndTraversalPaths() throws {
        let support = try #require(FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first)
        #expect(throws: BlabeeTestRunStoreError.invalidPath) {
            _ = try BlabeeTestRunStore(rootURL: support.appendingPathComponent("Blabee"))
        }
        #expect(throws: BlabeeTestRunStoreError.invalidPath) {
            _ = try BlabeeTestRunStore(rootURL: URL(fileURLWithPath: "/private/tmp/scope/../elsewhere"))
        }
    }

    @Test("Scenario names are unique stable simulation presets")
    func scenarioContract() throws {
        let simulations = BlabeeTestScenario.allCases.filter { !$0.usesRealEngine }
        #expect(simulations.map(\.rawValue) == ["freshInstall", "codexMissing", "pluginPreparing", "hookPending",
                                                 "connectionFailed", "connected", "delayedResponse", "loginCancelled", "loginFailed"])
        #expect(Set(simulations.map(\.rawValue)).count == 9)
        for scenario in simulations {
            #expect(!scenario.displayName.isEmpty)
            #expect(!scenario.summary.isEmpty)
            #expect(try JSONDecoder().decode(BlabeeTestScenario.self, from: JSONEncoder().encode(scenario)) == scenario)
        }
    }
}

private func withBlabeeTestEngineFixture(
    _ body: (URL, BlabeeTestRunStore, BlabeeTestRunManifest, BlabeeTestEnginePaths) throws -> Void
) throws {
    try withBlabeeTestRunFixture { parent, store in
        let run = try store.create(scenario: .engineIsolation)
        let paths = try store.prepareEngineStorage(for: run)
        // Only this random run's Test-owned socket directory is removed, never the shared UID root.
        defer { try? FileManager.default.removeItem(at: paths.socketURL.deletingLastPathComponent()) }
        try body(parent, store, run, paths)
    }
}

private func blabeeTestEnginePaths(_ paths: BlabeeTestEnginePaths, replacing field: String,
                                   with url: URL, freshnessAccount: String? = nil) -> BlabeeTestEnginePaths {
    BlabeeTestEnginePaths(
        rootURL: field == "rootURL" ? url : paths.rootURL,
        databaseURL: field == "databaseURL" ? url : paths.databaseURL,
        keyURL: field == "keyURL" ? url : paths.keyURL,
        tokenKeyURL: field == "tokenKeyURL" ? url : paths.tokenKeyURL,
        selectorKeyURL: field == "selectorKeyURL" ? url : paths.selectorKeyURL,
        authorityRootURL: field == "authorityRootURL" ? url : paths.authorityRootURL,
        projectURL: field == "projectURL" ? url : paths.projectURL,
        socketURL: field == "socketURL" ? url : paths.socketURL,
        freshnessAccount: freshnessAccount ?? paths.freshnessAccount
    )
}

@Suite("Blabee Test run-owned Engine resources (M2 registration only)", .serialized)
struct BlabeeTestEngineStorageTests {
    @Test("M2 is explicit and preserves all nine M1 presets")
    func explicitEngineMode() {
        #expect(BlabeeTestScenario.allCases.count == 10)
        #expect(BlabeeTestScenario.allCases.filter(\.usesRealEngine) == [.engineIsolation])
        #expect(!BlabeeTestScenario.engineIsolation.displayName.isEmpty)
        #expect(!BlabeeTestScenario.engineIsolation.summary.isEmpty)
    }

    @Test("M1 runs never prepare or import real Engine resources",
          arguments: BlabeeTestScenario.allCases.filter { !$0.usesRealEngine })
    func rejectSimulationResources(scenario: BlabeeTestScenario) throws {
        try withBlabeeTestRunFixture { _, store in
            let run = try store.create(scenario: scenario)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.prepareEngineStorage(for: run) }
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.loadEngineStorage(for: run) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: run.settingsURL.path).isEmpty)
        }
    }

    @Test("Preparation registers fixed run resources without creating DB, secrets, socket, or changing manifest v1")
    func prepareDirectoriesOnly() throws {
        try withBlabeeTestEngineFixture { _, store, run, paths in
            #expect(paths.rootURL == run.settingsURL.appendingPathComponent("engine-v1", isDirectory: true))
            let storage = paths.rootURL.appendingPathComponent("storage", isDirectory: true)
            #expect(paths.databaseURL == storage.appendingPathComponent("coordinator.sqlite"))
            #expect(paths.keyURL == storage.appendingPathComponent("storage.key"))
            #expect(paths.tokenKeyURL == storage.appendingPathComponent("continuation.key"))
            #expect(paths.selectorKeyURL == storage.appendingPathComponent("selector.key"))
            #expect(paths.authorityRootURL == paths.rootURL.appendingPathComponent("authority", isDirectory: true))
            #expect(paths.projectURL == paths.rootURL.appendingPathComponent("project", isDirectory: true))
            #expect(paths.socketURL == (try BlabeeTestRunStore.proposedSocketURL(runID: run.runID)))
            #expect(paths.freshnessAccount == "test-" + run.runID.uuidString.lowercased())
            #expect(paths.freshnessAccount != "primary")
            for url in [paths.rootURL, storage, paths.authorityRootURL, paths.projectURL,
                        paths.socketURL.deletingLastPathComponent()] {
                var info = stat()
                #expect(lstat(url.path, &info) == 0)
                #expect(info.st_uid == geteuid() && info.st_mode & 0o7777 == 0o700)
            }
            for url in [paths.databaseURL, paths.keyURL, paths.tokenKeyURL, paths.selectorKeyURL, paths.socketURL] {
                #expect(!FileManager.default.fileExists(atPath: url.path))
            }
            #expect(try store.resume(runID: run.runID) == run)
            #expect(run.schemaVersion == 1)
            #expect(run.ownedRelativePaths == [".blabee-test-run-v1.json", "manifest-v1.json", "instance.lock", "settings", "logs", "results"])
            let registryURL = run.settingsURL.appendingPathComponent("engine-resources-v1.json")
            let original = try Data(contentsOf: registryURL)
            let object = try #require(JSONSerialization.jsonObject(with: original) as? [String: Any])
            #expect(object["freshnessService"] as? String == KeychainFreshnessAnchorStore.defaultService)
            #expect(object["freshnessAccount"] as? String == paths.freshnessAccount)
            #expect(object["runRootPath"] as? String == run.rootPath)
            #expect(object["socketRunPath"] as? String == paths.socketURL.deletingLastPathComponent().path)
            #expect(try store.prepareEngineStorage(for: run) == paths)
            let reopened = try BlabeeTestRunStore(rootURL: store.rootURL)
            #expect(try reopened.loadEngineStorage(for: run) == paths)
            try reopened.validateEngineStorage(for: run, paths: paths)
            #expect(try Data(contentsOf: registryURL) == original)
        }
    }

    @Test("M2 local reports use their own name and preserve the existing bounded run envelope")
    func modeSpecificReports() throws {
        try withBlabeeTestEngineFixture { _, store, run, _ in
            #expect(try store.loadResult(for: run) == nil)
            let payload = Data(#"{"level":"isolated-engine","providerValidated":false}"#.utf8)
            try store.saveResult(payload, for: run)
            #expect(try store.loadResult(for: run) == payload)
            #expect(FileManager.default.fileExists(atPath: run.resultsURL.appendingPathComponent("m2-report.json").path))
            #expect(!FileManager.default.fileExists(atPath: run.resultsURL.appendingPathComponent("m1-report.json").path))
            #expect(throws: BlabeeTestRunStoreError.resultTooLarge) {
                try store.saveResult(Data(repeating: 0, count: BlabeeTestRunStore.maximumResultBytes + 1), for: run)
            }
            #expect(try store.loadResult(for: run) == payload)
            #expect(try store.loadSnapshot(for: run) == nil)
        }
    }

    @Test("Unprepared M2 resources cannot be loaded and an unmarked Engine root is preserved")
    func rejectUnregisteredEngineDirectory() throws {
        try withBlabeeTestRunFixture { _, store in
            let run = try store.create(scenario: .engineIsolation)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.loadEngineStorage(for: run) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: run.settingsURL.path).isEmpty)
            let engine = run.settingsURL.appendingPathComponent("engine-v1", isDirectory: true)
            try FileManager.default.createDirectory(at: engine, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let sentinel = engine.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.prepareEngineStorage(for: run) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: engine.path) == ["sentinel"])
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
        }
    }

    @Test("Every supplied Engine path and freshness account must equal the recomputed run value",
          arguments: ["rootURL", "databaseURL", "keyURL", "tokenKeyURL", "selectorKeyURL", "authorityRootURL",
                      "projectURL", "socketURL", "freshnessAccount"])
    func rejectSuppliedPathChanges(field: String) throws {
        try withBlabeeTestEngineFixture { parent, store, run, paths in
            let outside = parent.appendingPathComponent("never-created")
            let changed = blabeeTestEnginePaths(paths, replacing: field, with: outside,
                                               freshnessAccount: field == "freshnessAccount" ? "primary" : nil)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { try store.validateEngineStorage(for: run, paths: changed) }
            #expect(!FileManager.default.fileExists(atPath: outside.path))
            try store.validateEngineStorage(for: run, paths: paths)
        }
    }

    @Test("A file URL with the expected path but added URL components is not the fixed resource URL")
    func rejectResourceURLComponents() throws {
        try withBlabeeTestEngineFixture { _, store, run, paths in
            let changedURL = try #require(URL(string: paths.databaseURL.absoluteString + "?unregistered=true"))
            #expect(changedURL.path == paths.databaseURL.path)
            let changed = blabeeTestEnginePaths(paths, replacing: "databaseURL", with: changedURL)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { try store.validateEngineStorage(for: run, paths: changed) }
        }
    }

    @Test("A different run or store cannot borrow Engine paths or the short socket marker")
    func rejectOtherRunAndStore() throws {
        try withBlabeeTestEngineFixture { parent, store, run, paths in
            let other = try store.create(scenario: .engineIsolation)
            let otherPaths = try store.prepareEngineStorage(for: other)
            defer { try? FileManager.default.removeItem(at: otherPaths.socketURL.deletingLastPathComponent()) }
            #expect(paths.databaseURL != otherPaths.databaseURL && paths.keyURL != otherPaths.keyURL)
            #expect(paths.authorityRootURL != otherPaths.authorityRootURL && paths.socketURL != otherPaths.socketURL)
            #expect(paths.freshnessAccount != otherPaths.freshnessAccount)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { try store.validateEngineStorage(for: other, paths: paths) }
            let secondStore = try BlabeeTestRunStore(rootURL: parent.appendingPathComponent("other-store", isDirectory: true))
            let copiedID = try secondStore.create(scenario: .engineIsolation, runID: run.runID)
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try secondStore.prepareEngineStorage(for: copiedID) }
            #expect(!FileManager.default.fileExists(atPath: copiedID.settingsURL.appendingPathComponent("engine-resources-v1.json").path))
            try store.validateEngineStorage(for: run, paths: paths)
        }
    }

    @Test("The Engine registry rejects altered identity, fixed paths, primary account, service, and unknown fields",
          arguments: ["schemaVersion", "profile", "storeID", "runID", "ownerUID", "runRootPath", "rootPath",
                      "databasePath", "keyPath", "tokenKeyPath", "selectorKeyPath", "authorityRootPath", "projectPath",
                      "socketRootPath", "socketRunPath", "socketPath", "freshnessService", "freshnessAccount", "unknown"])
    func rejectRegistryChanges(field: String) throws {
        try withBlabeeTestEngineFixture { _, store, run, paths in
            try mutateBlabeeTestJSON(run.settingsURL.appendingPathComponent("engine-resources-v1.json")) { object in
                switch field {
                case "schemaVersion": object[field] = 99
                case "ownerUID": object[field] = UInt64(geteuid()) + 1
                case "storeID", "runID": object[field] = UUID().uuidString
                case "profile": object[field] = "production"
                case "freshnessAccount": object[field] = "primary"
                default: object[field] = "unregistered"
                }
            }
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.loadEngineStorage(for: run) }
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { try store.validateEngineStorage(for: run, paths: paths) }
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.prepareEngineStorage(for: run) }
        }
    }

    @Test("Engine and socket run markers remain bound to their exact store, run root, profile, and UID",
          arguments: ["engine/storeID", "engine/runID", "engine/runRootPath", "engine/profile", "engine/ownerUID",
                      "socket/storeID", "socket/runID", "socket/runRootPath", "socket/profile", "socket/ownerUID"])
    func rejectMarkerChanges(target: String) throws {
        try withBlabeeTestEngineFixture { _, store, run, _ in
            let paths = try store.loadEngineStorage(for: run)
            let components = target.split(separator: "/")
            let marker = components[0] == "engine" ? paths.rootURL.appendingPathComponent(".blabee-test-engine-v1.json")
                : paths.socketURL.deletingLastPathComponent().appendingPathComponent(".blabee-test-socket-run-v1.json")
            let field = String(components[1])
            try mutateBlabeeTestJSON(marker) { object in
                switch field {
                case "ownerUID": object[field] = UInt64(geteuid()) + 1
                case "storeID", "runID": object[field] = UUID().uuidString
                default: object[field] = "wrong-binding"
                }
            }
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.loadEngineStorage(for: run) }
        }
    }

    @Test("Registered resources that disappear are never recreated or re-registered",
          arguments: ["authority", "engine-marker", "registry", "socket-marker"])
    func rejectMissingRegisteredResource(target: String) throws {
        try withBlabeeTestEngineFixture { _, store, run, paths in
            let url: URL
            switch target {
            case "authority": url = paths.authorityRootURL
            case "engine-marker": url = paths.rootURL.appendingPathComponent(".blabee-test-engine-v1.json")
            case "registry": url = run.settingsURL.appendingPathComponent("engine-resources-v1.json")
            default: url = paths.socketURL.deletingLastPathComponent().appendingPathComponent(".blabee-test-socket-run-v1.json")
            }
            try FileManager.default.removeItem(at: url)
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.loadEngineStorage(for: run) }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.prepareEngineStorage(for: run) }
            #expect(!FileManager.default.fileExists(atPath: url.path))
        }
    }

    @Test("Links in registered Engine directories, markers, registry, or socket directories never redirect reads",
          arguments: ["root", "storage", "authority", "project", "registry", "engine-marker", "socket-run", "socket-marker"])
    func rejectEngineLinks(target: String) throws {
        try withBlabeeTestEngineFixture { parent, store, run, paths in
            let outside = parent.appendingPathComponent("outside", isDirectory: true)
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let sentinel = outside.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            let destination: URL
            switch target {
            case "root": destination = paths.rootURL
            case "storage": destination = paths.databaseURL.deletingLastPathComponent()
            case "authority": destination = paths.authorityRootURL
            case "project": destination = paths.projectURL
            case "registry": destination = run.settingsURL.appendingPathComponent("engine-resources-v1.json")
            case "engine-marker": destination = paths.rootURL.appendingPathComponent(".blabee-test-engine-v1.json")
            case "socket-run": destination = paths.socketURL.deletingLastPathComponent()
            default: destination = paths.socketURL.deletingLastPathComponent().appendingPathComponent(".blabee-test-socket-run-v1.json")
            }
            try FileManager.default.removeItem(at: destination)
            try FileManager.default.createSymbolicLink(at: destination, withDestinationURL: outside)
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.loadEngineStorage(for: run) }
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.prepareEngineStorage(for: run) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path) == ["sentinel"])
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
        }
    }

    @Test("World-writable Engine and socket directories are rejected without permission repair",
          arguments: ["root", "storage", "authority", "project", "socket-run"])
    func rejectEnginePermissions(target: String) throws {
        try withBlabeeTestEngineFixture { _, store, run, paths in
            let url = target == "root" ? paths.rootURL : target == "storage" ? paths.databaseURL.deletingLastPathComponent()
                : target == "authority" ? paths.authorityRootURL : target == "project" ? paths.projectURL
                : paths.socketURL.deletingLastPathComponent()
            #expect(chmod(url.path, 0o777) == 0)
            #expect(throws: BlabeeTestRunStoreError.unsafeDirectory) { _ = try store.loadEngineStorage(for: run) }
            var info = stat()
            #expect(lstat(url.path, &info) == 0 && info.st_mode & 0o7777 == 0o777)
        }
    }

    @Test("Existing key, token key, selector key, and database symlinks are rejected without reading their targets",
          arguments: ["storage.key", "continuation.key", "selector.key", "coordinator.sqlite"])
    func rejectEngineFileLinks(name: String) throws {
        try withBlabeeTestEngineFixture { parent, store, run, paths in
            let sentinel = parent.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            let file = paths.databaseURL.deletingLastPathComponent().appendingPathComponent(name)
            try FileManager.default.createSymbolicLink(at: file, withDestinationURL: sentinel)
            #expect(throws: BlabeeTestRunStoreError.unsafeFile) { _ = try store.loadEngineStorage(for: run) }
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
        }
    }

    @Test("Existing Engine keys require protected metadata and the common 32-byte shape",
          arguments: ["short", "mode", "hard-link"])
    func rejectUnsafeExistingKeys(change: String) throws {
        try withBlabeeTestEngineFixture { parent, store, run, paths in
            // Synthetic fixture bytes are never passed to an Engine or a credential store.
            try Data(repeating: 0x5a, count: change == "short" ? 31 : 32).write(to: paths.keyURL)
            #expect(chmod(paths.keyURL.path, change == "mode" ? 0o644 : 0o600) == 0)
            if change == "hard-link" {
                #expect(link(paths.keyURL.path, parent.appendingPathComponent("key-link").path) == 0)
            }
            #expect(throws: BlabeeTestRunStoreError.unsafeFile) { _ = try store.loadEngineStorage(for: run) }
        }
    }

    @Test("Preparation never adopts an existing non-socket entry at the registered socket location")
    func rejectSocketEntry() throws {
        try withBlabeeTestEngineFixture { _, store, run, paths in
            try Data("preserve".utf8).write(to: paths.socketURL)
            #expect(chmod(paths.socketURL.path, 0o600) == 0)
            #expect(throws: BlabeeTestRunStoreError.unsafeFile) { _ = try store.prepareEngineStorage(for: run) }
            #expect(try Data(contentsOf: paths.socketURL) == Data("preserve".utf8))
        }
    }

    @Test("Unmarked short socket run directories are preserved, and partial preparation is never adopted")
    func rejectUnmarkedSocketRun() throws {
        try withBlabeeTestEngineFixture { _, store, _, _ in
            let run = try store.create(scenario: .engineIsolation)
            let socketRun = try BlabeeTestRunStore.proposedSocketURL(runID: run.runID).deletingLastPathComponent()
            try FileManager.default.createDirectory(at: socketRun, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: socketRun) }
            let sentinel = socketRun.appendingPathComponent("sentinel")
            try Data("keep".utf8).write(to: sentinel)
            #expect(throws: BlabeeTestRunStoreError.self) { _ = try store.prepareEngineStorage(for: run) }
            #expect(try FileManager.default.contentsOfDirectory(atPath: socketRun.path) == ["sentinel"])
            #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
            #expect(FileManager.default.fileExists(atPath: run.settingsURL.appendingPathComponent("engine-v1").path))
            #expect(!FileManager.default.fileExists(atPath: run.settingsURL.appendingPathComponent("engine-resources-v1.json").path))
            #expect(throws: BlabeeTestRunStoreError.invalidEngineStorage) { _ = try store.prepareEngineStorage(for: run) }
        }
    }
}
#endif

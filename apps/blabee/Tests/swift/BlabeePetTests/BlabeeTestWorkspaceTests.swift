#if BLABEE_TEST_APP
import AppKit
import Foundation
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@MainActor
@Suite("Blabee Test workspace", .serialized)
struct BlabeeTestWorkspaceTests {
    private var validInfo: [String: Any] {
        ["CFBundleIdentifier": "com.biadone.blabee.test", "CFBundleExecutable": "blabee-coordinator",
         "BlabeeDistributionProfile": "blabee-test", "BlabeeTestMode": "isolated-development",
         "BlabeeTestMilestone": "M2", "BlabeeTestSimulationOnly": false, "BlabeeTestEngineEnabled": true]
    }

    @Test("Only the assembled simulation bundle may start, with no product CLI arguments")
    func launchAdmission() throws {
        let bundle = URL(fileURLWithPath: "/private/tmp/Blabee Test.app")
        try BlabeeTestLaunchPolicy.validate(arguments: [], bundleURL: bundle, info: validInfo)
        for arguments in [["service"], ["pet"], ["claude-auto-launch"], ["--test"], ["--socket", "/private/tmp/any.sock"]] {
            #expect(throws: BlabeeTestLaunchError.unsupportedArguments) {
                try BlabeeTestLaunchPolicy.validate(arguments: arguments, bundleURL: bundle, info: validInfo)
            }
        }
        for key in ["CFBundleIdentifier", "BlabeeDistributionProfile", "BlabeeTestMode", "BlabeeTestMilestone"] {
            var invalid = validInfo
            invalid[key] = "production"
            #expect(throws: BlabeeTestLaunchError.invalidBundle) {
                try BlabeeTestLaunchPolicy.validate(arguments: [], bundleURL: bundle, info: invalid)
            }
        }
        var invalid = validInfo
        invalid["BlabeeTestSimulationOnly"] = 1
        #expect(throws: BlabeeTestLaunchError.invalidBundle) {
            try BlabeeTestLaunchPolicy.validate(arguments: [], bundleURL: bundle, info: invalid)
        }
    }

    @Test("Starting again creates a new run and fences the previous UI")
    func resetIsNewRun() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore(rootURL: root))
        #expect(controller.composition == nil && controller.availableRuns.isEmpty)
        await controller.startNew(scenario: .freshInstall)
        let first = try #require(controller.run)
        let old = try #require(controller.composition)
        let generation = controller.viewGeneration
        await controller.startNew(scenario: .codexMissing)
        let second = try #require(controller.run)
        #expect(first.runID != second.runID && first.defaultsSuiteName != second.defaultsSuiteName)
        #expect(!old.isActive && controller.isRunActive && controller.errorMessage == nil)
        #expect(controller.page == .connection)
        await controller.showPage(.cards, expectedGeneration: generation)
        #expect(controller.page == .connection)
        #expect(try controller.store.list().count == 2)
        #expect(FileManager.default.fileExists(atPath: first.rootPath))
        await controller.shutdown()
    }

    @Test("Reset remains available while simulated activation is waiting for a response")
    func resetDuringDelayedActivation() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore(rootURL: root))
        let activation = Task { await controller.startNew(scenario: .delayedResponse) }
        for _ in 0..<500 {
            if let metrics = await controller.composition?.simulationMetrics(), metrics.snapshotRequests > 0 { break }
            await Task.yield()
        }
        let previous = try #require(controller.composition)
        let previousRun = try #require(controller.run)
        #expect((await previous.simulationMetrics()).snapshotRequests > 0)
        #expect(controller.isRunActive && !controller.isTransitioning)
        await controller.startNew(scenario: .freshInstall)
        await activation.value
        #expect(controller.isRunActive && !controller.isTransitioning)
        #expect(controller.run?.runID != previousRun.runID)
        #expect(controller.run?.scenario == .freshInstall && controller.page == .onboarding)
        #expect(!previous.isActive && controller.errorMessage == nil)
        await controller.shutdown()
    }

    @Test("A drain failure preserves files and cannot publish or revive a run")
    func failedDrainCannotPublish() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore(rootURL: root), drain: { _ in
            throw BlabeeTestLaunchError.transitionCancelled
        })
        await controller.startNew(scenario: .freshInstall)
        let previous = try #require(controller.run)
        let composition = try #require(controller.composition)
        await controller.startNew(scenario: .connected)
        #expect(!controller.isRunActive && !composition.isActive)
        #expect(controller.run?.runID == previous.runID && controller.errorMessage != nil)
        #expect(try controller.store.list().count == 1)
        #expect(throws: BlabeeTestRunStoreError.runInUse) { try controller.store.acquireLease(for: previous) }
        await controller.shutdown()
    }

    @Test("Restoring a saved run is explicit and refuses another instance's lease")
    func explicitResume() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let store = try BlabeeTestRunStore(rootURL: root)
        let first = try BlabeeTestWorkspaceController(store: store)
        await first.startNew(scenario: .freshInstall)
        let saved = try #require(first.run)
        let second = try BlabeeTestWorkspaceController(store: store)
        #expect(second.composition == nil && second.availableRuns.count == 1)
        await second.resume(saved)
        #expect(!second.isRunActive && second.errorMessage != nil)
        await first.shutdown()
        await second.resume(saved)
        #expect(second.isRunActive && second.run?.runID == saved.runID)
        let metrics = await second.composition?.simulationMetrics()
        #expect(metrics?.selections == 0 && metrics?.skips == 0)
        await second.shutdown()
    }

    @Test("A late card refresh cannot restart polling after switching screens")
    func pageResponseFence() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let gate = BlabeeTestWorkspaceRefreshGate()
        let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore(rootURL: root),
            refreshCards: { _ in await gate.pause() })
        await controller.startNew(scenario: .freshInstall)
        let original = controller.viewGeneration
        let cards = Task { await controller.showPage(.cards, expectedGeneration: original) }
        await gate.waitForEntry()
        await controller.showPage(.connection)
        #expect(controller.page == .connection && !controller.isCardPollingActive)
        gate.release()
        await cards.value
        #expect(controller.page == .connection && !controller.isCardPollingActive)
        await controller.showPage(.onboarding, expectedGeneration: original)
        #expect(controller.page == .connection)
        await controller.shutdown()
    }

    @Test("The card close button targets only the current Test window and preserves its run")
    func cardCloseCallbackFence() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore(rootURL: root))
        var closeRequests = 0
        controller.onRequestClose = { closeRequests += 1 }
        await controller.startNew(scenario: .freshInstall)
        await controller.showPage(.cards)
        let composition = try #require(controller.composition)
        let run = try #require(controller.run)
        let oldClose = try #require(composition.viewModel.onPanelToggleRequested)
        composition.viewModel.requestPanelToggle()
        #expect(closeRequests == 1 && controller.run?.runID == run.runID && controller.isRunActive)
        await controller.showPage(.connection)
        oldClose()
        #expect(closeRequests == 1)
        await controller.startNew(scenario: .freshInstall)
        oldClose()
        #expect(closeRequests == 1 && controller.run?.runID != run.runID)
        await controller.showPage(.cards)
        controller.composition?.viewModel.requestPanelToggle()
        #expect(closeRequests == 2)
        await controller.shutdown()
    }

    @Test("An incomplete run is preserved without preventing a fresh test or relaunch")
    func partialRunDoesNotBlockWorkspace() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let store = try BlabeeTestRunStore(rootURL: root)
        let existing = try store.create(scenario: .freshInstall)
        let partial = root.appendingPathComponent("runs/\(UUID().uuidString.lowercased())")
        try FileManager.default.createDirectory(at: partial, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        let controller = try BlabeeTestWorkspaceController(store: store)
        #expect(controller.availableRuns.count == 1 && controller.inventoryIssues.count == 1)
        await controller.startNew(scenario: .freshInstall)
        #expect(controller.isRunActive && controller.run?.runID != existing.runID)
        #expect(controller.inventoryIssues.count == 1)
        #expect(FileManager.default.fileExists(atPath: partial.path))
        await controller.shutdown()
        let relaunched = try BlabeeTestWorkspaceController(store: store)
        #expect(relaunched.composition == nil && relaunched.availableRuns.count == 2)
        #expect(relaunched.inventoryIssues.count == 1)
    }

    @Test("A report records simulation metrics separately from onboarding progress")
    func localSimulationReport() async throws {
        let root = temporaryRoot()
        defer { cleanupTemporaryRoot(root) }
        let store = try BlabeeTestRunStore(rootURL: root)
        let controller = try BlabeeTestWorkspaceController(store: store)
        await controller.startNew(scenario: .freshInstall)
        let run = try #require(controller.run)
        await controller.saveResult()
        let bytes = try #require(try store.loadResult(for: run))
        let object = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        #expect(object["milestone"] as? String == "M1")
        #expect((object["evidence"] as? String)?.contains("unverified") == true)
        #expect(object["runID"] as? String == run.runID.uuidString)
        #expect(controller.resultMessage != nil)
        await controller.shutdown()
    }

    @Test("Language persistence is rebound to the active test run")
    func languageScope() {
        let name = "com.biadone.blabee.test.run." + UUID().uuidString.lowercased()
        let defaults = UserDefaults(suiteName: name)!
        defer {
            PetLocalization.shared.bindTestRunDefaults(nil)
            defaults.removePersistentDomain(forName: name)
        }
        PetLocalization.shared.bindTestRunDefaults(defaults)
        PetLocalization.shared.setLanguage(.korean)
        #expect(defaults.string(forKey: PetUILanguage.preferenceKey) == "ko")
        #expect(PetL10n.language == .korean)
        PetLocalization.shared.bindTestRunDefaults(nil)
        #expect(PetL10n.language == .english)
    }

    @Test("Shared screens and Test controls render in both languages at compact and normal sizes",
          .enabled(if: ProcessInfo.processInfo.environment["BLABEE_TEST_APP_RENDERS"] == "1"))
    func renderWorkspace() async throws {
        let root = temporaryRoot()
        let output = URL(fileURLWithPath: "/private/tmp/blabee-test-app-ui-\(UUID().uuidString.lowercased())")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { cleanupTemporaryRoot(root) }
        let controller = try BlabeeTestWorkspaceController(store: BlabeeTestRunStore(rootURL: root))
        for scenario in [BlabeeTestScenario.freshInstall, .codexMissing, .connected] {
            await controller.startNew(scenario: scenario)
            let composition = try #require(controller.composition)
            if scenario == .connected { await controller.showPage(.cards) }
            for language in PetUILanguage.allCases {
                PetLocalization.shared.setLanguage(language)
                let dark = language == .korean
                let size = scenario == .connected ? NSSize(width: 560, height: 780) : NSSize(width: 460, height: 550)
                let view = BlabeeTestWorkspaceView(controller: controller)
                    .frame(width: size.width, height: size.height)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .environment(\.petAirForceOpaqueSurfaces, true)
                let host = NSHostingView(rootView: view)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: size.width, height: size.height),
                                      styleMask: .borderless, backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                host.frame = NSRect(origin: .zero, size: size)
                for _ in 0..<5 {
                    host.layoutSubtreeIfNeeded()
                    window.displayIfNeeded()
                    try await Task.sleep(for: .milliseconds(20))
                }
                let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.effectiveAppearance.performAsCurrentDrawingAppearance {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                }
                #expect(host.fittingSize.width <= size.width + 1)
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                let data = try #require(bitmap.representation(using: .png, properties: [:]))
                try data.write(to: output.appendingPathComponent("\(scenario.rawValue)-\(language.rawValue).png"))
                #expect(composition.isActive)
                window.contentView = nil
                window.close()
            }
        }
        await controller.shutdown()
        print("Blabee Test UI renders: \(output.path)")
    }

    private func cleanupTemporaryRoot(_ root: URL) {
        if let store = try? BlabeeTestRunStore(rootURL: root), let inventory = try? store.inventory() {
            for run in inventory.runs where run.ownedDefaultsSuiteNames == [run.defaultsSuiteName] {
                UserDefaults(suiteName: run.defaultsSuiteName)?.removePersistentDomain(forName: run.defaultsSuiteName)
            }
        }
        try? FileManager.default.removeItem(at: root)
    }

    private func temporaryRoot() -> URL {
        URL(fileURLWithPath: "/private/tmp/blabee-test-workspace-\(UUID().uuidString.lowercased())", isDirectory: true)
    }
}

@MainActor
private final class BlabeeTestWorkspaceRefreshGate {
    private var entered = false
    private var pending: CheckedContinuation<Void, Never>?
    private var observer: CheckedContinuation<Void, Never>?
    func pause() async {
        entered = true
        await withCheckedContinuation { continuation in
            pending = continuation
            observer?.resume()
            observer = nil
        }
    }
    func waitForEntry() async {
        guard !entered else { return }
        await withCheckedContinuation { observer = $0 }
    }
    func release() { pending?.resume(); pending = nil }
}
#endif

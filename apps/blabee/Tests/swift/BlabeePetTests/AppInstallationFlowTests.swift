import AppKit
import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation
import SwiftUI
import Testing
@testable import BlabeeCoordinator

private let installationFlowIdentity = "sha256:" + String(repeating: "a", count: 64)
private let installationFlowPreviousIdentity = "sha256:" + String(repeating: "b", count: 64)

private struct InstallationFlowFixture {
    let root: URL
    let source: URL
    let target: URL
    let service: AppInstallationService

    init(existingBuild: String? = nil) throws {
        guard let resolved = realpath(FileManager.default.temporaryDirectory.path, nil) else {
            throw AppInstallationError(.invalidDestination)
        }
        defer { free(resolved) }
        root = URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
            .appendingPathComponent("blabee-install-flow-" + UUID().uuidString)
        source = root.appendingPathComponent("Downloads/Blabee.app")
        target = root.appendingPathComponent("Applications/Blabee.app")
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.writeBundle(source, build: "19")
        if let existingBuild { try Self.writeBundle(target, build: existingBuild) }
        service = AppInstallationService(destinationURL: target, expectedSourceIdentity: installationFlowIdentity,
            validator: { app in
                let data = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
                let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String]
                return plist?["CFBundleVersion"] == "19" ? installationFlowIdentity : installationFlowPreviousIdentity
            })
    }

    private static func writeBundle(_ app: URL, build: String) throws {
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
        let plist = ["CFBundleIdentifier": "com.biadone.blabee", "CFBundleName": "Blabee",
                     "CFBundleExecutable": "blabee-coordinator", "CFBundleShortVersionString": "0.1.0", "CFBundleVersion": build]
        try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            .write(to: contents.appendingPathComponent("Info.plist"))
        let executable = contents.appendingPathComponent("MacOS/blabee-coordinator")
        try Data("fixture".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    }

    func rewriteExistingBuild(_ build: String) throws {
        let infoURL = target.appendingPathComponent("Contents/Info.plist")
        var info = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: infoURL), format: nil)
            as? [String: String])
        info["CFBundleVersion"] = build
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: infoURL)
    }

    func remove() { try? FileManager.default.removeItem(at: root) }
}

private final class InstallationFlowCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func increment() { lock.withLock { count += 1 } }
    var value: Int { lock.withLock { count } }
}

private final class InstallationLegacyConfirmationRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var confirmations: [Bool] = []
    func record(_ confirmed: Bool) { lock.withLock { confirmations.append(confirmed) } }
    var values: [Bool] { lock.withLock { confirmations } }
}

@Suite("DMG Claude connection recovery", .petLanguage(.korean)) @MainActor
struct AppInstallationConnectionRecoveryTests {
    @Test("preparation is single flight and cannot publish, launch, or continue before restart")
    func preparationRequiresRestart() async throws {
        var response: CheckedContinuation<ClaudeRuntimePayloadUse.RecoveryPreparation, Never>?
        let f = try InstallationRecoveryFixture(recovery: {
            await withCheckedContinuation { response = $0 }
        })
        defer { f.files.remove() }
        await f.model.refresh()
        await f.model.performPrimary()
        #expect(f.model.showsReplacementConfirmation)
        f.model.prepareConnectionRecoveryAfterRestart()
        f.model.prepareConnectionRecoveryAfterRestart()
        await f.model.confirmReplacement()
        try await waitUntil { response != nil }
        #expect(f.model.phase == .preparingConnectionRecovery)
        #expect(f.effects.recoveryCalls == 1 && f.effects.installs.value == 0)
        #expect(!f.model.canPerformPrimary && f.model.canClose)
        #expect(!f.model.showsReplacementConfirmation)
        response?.resume(returning: .restartRequired(outstandingUseCount: 1))
        try await waitUntil { f.model.phase == .connectionRestartRequired }
        await f.model.performPrimary()
        await f.model.confirmReplacement()
        await f.model.refresh()
        f.model.prepareConnectionRecoveryAfterRestart()
        #expect(f.model.phase == .connectionRestartRequired)
        #expect(f.model.connectionRecoveryMessage == PetAppUpdatePresentation.connectionRecoveryRestartInstructions)
        #expect(f.model.receipt == nil && f.model.plan?.comparison == .upgrade)
        #expect(f.effects.recoveryCalls == 1 && f.effects.installs.value == 0 && f.effects.opens == 0)
        #expect(f.model.requestClose())
        #expect(f.model.phase == .connectionRestartRequired)
    }

    @Test("preparing during a readiness wait fences its late success and requires a fresh confirmation")
    func preparationFencesInstallationWait() async throws {
        var response: CheckedContinuation<Void, Never>?
        var waits = 0
        let f = try InstallationRecoveryFixture(waiter: .init(requireReady: { _ in
            waits += 1
            if waits == 1 { await withCheckedContinuation { response = $0 } }
        }))
        defer { f.files.remove() }
        await f.model.refresh()
        await f.model.performPrimary()
        let pendingInstall = Task { await f.model.confirmReplacement() }
        try await waitUntil { response != nil }
        #expect(f.model.phase == .waitingForSafePoint)
        f.model.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { f.model.phase == .ready }
        response?.resume()
        await pendingInstall.value
        #expect(f.model.phase == .ready && f.model.canPerformPrimary)
        #expect(f.model.connectionRecoveryMessage == PetAppUpdatePresentation.connectionRecoveryClear)
        #expect(f.effects.installs.value == 0 && f.effects.opens == 0 && f.model.receipt == nil)
        await f.model.performPrimary()
        await f.model.confirmReplacement()
        #expect(waits == 2 && f.effects.installs.value == 1 && f.effects.opens == 1)
        #expect(f.model.phase == .launched)
    }

    @Test("close before recovery starts prevents preparation")
    func closeBeforePreparationStarts() async throws {
        let f = try InstallationRecoveryFixture()
        defer { f.files.remove() }
        await f.model.refresh()
        f.model.prepareConnectionRecoveryAfterRestart()
        #expect(f.model.requestClose())
        for _ in 0..<5 { await Task.yield() }
        #expect(f.effects.recoveryCalls == 0 && f.effects.installs.value == 0 && f.effects.opens == 0)
        #expect(f.model.phase == .failed)
    }

    @Test("cancelled preparation cannot overwrite a later inspection", arguments: [false, true])
    func cancelledPreparationCannotOverwriteInspection(fails: Bool) async throws {
        var response: CheckedContinuation<ClaudeRuntimePayloadUse.RecoveryPreparation, any Error>?
        let f = try InstallationRecoveryFixture(recovery: {
            try await withCheckedThrowingContinuation { response = $0 }
        })
        defer { f.files.remove() }
        await f.model.refresh()
        f.model.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { response != nil }
        #expect(f.model.requestClose())
        await f.model.refresh()
        if fails { response?.resume(throwing: AppUpdateAdmissionError.unavailable) }
        else { response?.resume(returning: .restartRequired(outstandingUseCount: 1)) }
        for _ in 0..<10 { await Task.yield() }
        #expect(f.model.phase == .ready && f.model.connectionRecoveryMessage == nil)
        #expect(f.model.message == nil && f.model.plan?.comparison == .upgrade)
        #expect(f.effects.installs.value == 0 && f.effects.opens == 0)
    }

    @Test("failed preparation can be retried explicitly without publishing")
    func preparationFailureIsRetryable() async throws {
        var attempts = 0
        let f = try InstallationRecoveryFixture(recovery: {
            attempts += 1
            if attempts == 1 { throw AppUpdateAdmissionError.unavailable }
            return .clear
        })
        defer { f.files.remove() }
        await f.model.refresh()
        f.model.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { f.model.phase == .failed }
        #expect(f.model.canPrepareConnectionRecovery)
        f.model.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { f.model.phase == .ready }
        #expect(attempts == 2 && f.effects.installs.value == 0 && f.effects.opens == 0)
    }

    @Test("a fresh reinstall blocked by leftover Claude records exposes recovery")
    func freshInstallCanPrepareRecoveryAfterClaudeBlock() async throws {
        let files = try InstallationFlowFixture()
        defer { files.remove() }
        let service = files.service, source = files.source
        var recoveryCalls = 0
        let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
            install: { _, _, _ in throw AppInstallationError(.claudeRuntimeBlocked) },
            openInstalled: { _, _ in Issue.record("A blocked fresh install must not launch") },
            prepareConnectionRecovery: {
                recoveryCalls += 1
                return .restartRequired(outstandingUseCount: 1)
            })
        await model.refresh()
        #expect(!model.showsConnectionRecovery)
        await model.performPrimary()
        #expect(model.phase == .failed && model.canPrepareConnectionRecovery)
        model.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { model.phase == .connectionRestartRequired }
        #expect(recoveryCalls == 1 && model.receipt == nil)
        #expect(!FileManager.default.fileExists(atPath: files.target.path))
    }

    @Test("fresh install transition failure exposes recovery before the later Claude guard",
          arguments: [ClaudeRuntimePayloadUse.Status.inUse, .unavailable])
    func freshInstallTransitionOrderingOffersRecovery(_ status: ClaudeRuntimePayloadUse.Status) async throws {
        let files = try InstallationFlowFixture()
        defer { files.remove() }
        let transitionCalls = InstallationFlowCounter()
        let claudeCalls = InstallationFlowCounter()
        let copyCalls = InstallationFlowCounter()
        let service = AppInstallationService(destinationURL: files.target,
            expectedSourceIdentity: installationFlowIdentity, validator: { _ in installationFlowIdentity },
            claudeInstallationGuard: { claudeCalls.increment(); return () },
            updateTransitionGuard: { _ in
                transitionCalls.increment()
                try AppUpdateTransitionPreflight.recoverAndRequireClaudeReady(recover: { 0 }, inspect: {
                    .init(status: status, outstandingUseCount: status == .inUse ? 1 : nil,
                          referencedRuntimeIdentities: [])
                })
                return ()
            }, copyBundle: { _, _ in copyCalls.increment() })
        let source = files.source
        var recoveryCalls = 0
        let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
            install: { plan, approved, legacy in
                try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacy)
            }, openInstalled: { _, _ in Issue.record("A failed transition must never open the app") },
            prepareConnectionRecovery: {
                recoveryCalls += 1
                return .restartRequired(outstandingUseCount: 1)
            })
        await model.refresh()
        #expect(model.plan?.comparison == .freshInstall && !model.showsConnectionRecovery)
        await model.performPrimary()
        #expect(transitionCalls.value == 1 && claudeCalls.value == 0 && copyCalls.value == 0)
        #expect(model.phase == .failed && model.canPrepareConnectionRecovery)
        model.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { model.phase == .connectionRestartRequired }
        #expect(recoveryCalls == 1 && model.receipt == nil && !model.canPerformPrimary)
        #expect(!FileManager.default.fileExists(atPath: files.target.path))
        let entries = try FileManager.default.contentsOfDirectory(atPath: files.target.deletingLastPathComponent().path)
        #expect(!entries.contains { $0.hasPrefix(".Blabee.install-") })
    }

    @Test("the actual DMG view renders restart instructions in both languages")
    func installerRecoveryViewRenders() async throws {
        for language in PetUILanguage.allCases {
            try await PetL10n.$languageOverride.withValue(language) {
                let f = try InstallationRecoveryFixture(recovery: { .restartRequired(outstandingUseCount: 1) })
                defer { f.files.remove() }
                await f.model.refresh()
                f.model.prepareConnectionRecoveryAfterRestart()
                try await waitUntil { f.model.phase == .connectionRestartRequired }
                let host = NSHostingView(rootView: AppInstallationView(model: f.model, close: {}))
                #expect(abs(host.fittingSize.width - 580) < 0.01)
                #expect(abs(host.fittingSize.height - 570) < 0.01)
                host.frame = NSRect(origin: .zero, size: host.fittingSize)
                host.layoutSubtreeIfNeeded()
                let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.cacheDisplay(in: host.bounds, to: bitmap)
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                #expect(f.model.connectionRecoveryMessage == PetAppUpdatePresentation.connectionRecoveryRestartInstructions)
                #expect(f.effects.installs.value == 0 && f.effects.opens == 0)
            }
        }
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !condition(), ContinuousClock.now < deadline { await Task.yield() }
        #expect(condition())
    }
}

@MainActor
private final class InstallationRecoveryEffects {
    let installs = InstallationFlowCounter()
    var recoveryCalls = 0
    var opens = 0
}

@MainActor
private struct InstallationRecoveryFixture {
    let files: InstallationFlowFixture
    let effects: InstallationRecoveryEffects
    let model: AppInstallationViewModel

    init(recovery: @escaping @MainActor () async throws -> ClaudeRuntimePayloadUse.RecoveryPreparation = { .clear },
         waiter: AppUpdateSafePointWaiter = .init(requireReady: { _ in })) throws {
        let files = try InstallationFlowFixture(existingBuild: "18")
        self.files = files
        let service = files.service, source = files.source
        let effects = InstallationRecoveryEffects()
        self.effects = effects
        let installs = effects.installs
        model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
            install: { plan, approved, legacy in
                installs.increment()
                return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacy)
            }, openInstalled: { _, _ in effects.opens += 1 }, safePointWaiter: waiter,
            prepareConnectionRecovery: {
                effects.recoveryCalls += 1
                return try await recovery()
            })
    }
}

@Test("an installed matching app is not described as missing", .petLanguage(.korean)) @MainActor
func appInstallationExistingAppHasAccurateTitle() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "19")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { _, _, _ in Issue.record("Matching apps must not be recopied"); throw AppInstallationError(.copyFailed) },
        openInstalled: { _, _ in Issue.record("Inspection must not launch") })
    await model.refresh()
    #expect(model.plan?.comparison == .sameIdentity)
    #expect(model.title == "설치된 Blabee가 있습니다")
    #expect(model.primaryTitle == "설치된 Blabee 열기")
}

@Test("unexpected location and early exit enter Finder recovery without repeating launch or copy", .petLanguage(.korean),
      arguments: [AppInstallationPlatformError.launchedApplicationMismatch, .launchedProcessExited, .launchFailed, .launchTimedOut])
@MainActor
func appInstallationLaunchFailureUsesFinderRecovery(_ failure: AppInstallationPlatformError) async throws {
    for existingBuild in [String?.none, "19", "18"] {
        let fixture = try InstallationFlowFixture(existingBuild: existingBuild)
        defer { fixture.remove() }
        let service = fixture.service, source = fixture.source
        let installs = InstallationFlowCounter()
        var opens = 0
        var revealed: [URL] = []
        let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
            install: { plan, approved, legacy in
                installs.increment()
                return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacy)
            }, openInstalled: { _, _ in opens += 1; throw failure },
            showInFinder: { revealed.append($0) })
        await model.refresh()
        await model.performPrimary()
        if model.showsReplacementConfirmation { await model.confirmReplacement() }
        #expect(model.phase == .failed && model.requiresFinderRecovery)
        #expect(model.primaryTitle == "Finder에서 설치 복구")
        #expect(model.title == "설치된 앱 실행을 확인해 주세요")
        #expect(model.receipt != nil || model.plan?.existing != nil)
        let receipt = model.receipt?.identity
        let backup = model.receipt?.backupURL
        if existingBuild == "18" { #expect(backup != nil && model.recoveryURL == backup) }
        await model.refresh()
        await model.performPrimary()
        await model.performPrimary()
        await model.confirmReplacement()
        #expect(opens == 1)
        #expect(installs.value == (existingBuild == "19" ? 0 : 1))
        #expect(revealed == [fixture.target, fixture.target])
        #expect(model.receipt?.identity == receipt)
        #expect(model.receipt?.backupURL == backup)
        #expect(FileManager.default.fileExists(atPath: fixture.target.path))
    }
}

@Test("installed-only launch rejects translocation, aliases, extra arguments and identity mismatch", .petLanguage(.korean))
func appInstallationInstalledEntryIsStrict() throws {
    let app = URL(fileURLWithPath: "/Applications/Blabee.app", isDirectory: true)
    func environment(_ app: URL) -> ProductInvocationEnvironment {
        ProductInvocationEnvironment(bundleIdentifier: "com.biadone.blabee", bundleName: "Blabee",
            bundleExecutable: "blabee-coordinator", bundleURL: app,
            executableURL: app.appendingPathComponent("Contents/MacOS/blabee-coordinator"))
    }
    try AppInstallationEntry.validateInstalledLaunch(arguments: [], environment: environment(app),
        currentIdentity: { installationFlowIdentity }, installedIdentity: { _ in installationFlowIdentity }, canonicalURL: { $0 })
    for path in ["/Volumes/Blabee/Blabee.app", "/private/translocated/Blabee.app", "/Applications/Blabee 2.app"] {
        #expect(throws: CoordinatorError.self) {
            try AppInstallationEntry.validateInstalledLaunch(arguments: [], environment: environment(URL(fileURLWithPath: path)),
                currentIdentity: { installationFlowIdentity }, installedIdentity: { _ in installationFlowIdentity }, canonicalURL: { $0 })
        }
    }
    #expect(throws: CoordinatorError.self) {
        try AppInstallationEntry.validateInstalledLaunch(arguments: ["--socket", "/tmp/test.sock"], environment: environment(app),
            currentIdentity: { installationFlowIdentity }, installedIdentity: { _ in installationFlowIdentity }, canonicalURL: { $0 })
    }
    #expect(throws: CoordinatorError.self) {
        try AppInstallationEntry.validateInstalledLaunch(arguments: [], environment: environment(app),
            currentIdentity: { installationFlowIdentity }, installedIdentity: { _ in installationFlowPreviousIdentity }, canonicalURL: { $0 })
    }
    #expect(throws: CoordinatorError.self) {
        try AppInstallationEntry.validateInstalledLaunch(arguments: [], environment: environment(app),
            currentIdentity: { installationFlowIdentity }, installedIdentity: { _ in installationFlowIdentity },
            canonicalURL: { _ in URL(fileURLWithPath: "/tmp/Blabee.app") })
    }
}

@Test("installation primary policy never automatically downgrades or replaces an unknown version", .petLanguage(.korean))
func appInstallationPrimaryPolicy() {
    #expect(AppInstallationPrimaryAction.forComparison(.freshInstall) == .install)
    #expect(AppInstallationPrimaryAction.forComparison(.upgrade) == .confirmReplacement)
    #expect(AppInstallationPrimaryAction.forComparison(.sameVersion) == .confirmReplacement)
    for comparison in [AppInstallationComparison.sameIdentity, .downgrade, .unknown] {
        #expect(AppInstallationPrimaryAction.forComparison(comparison) == .openExisting)
    }
}

@Test("DMG replacement uses the same bounded readiness checks and preserves the precise blocker", .petLanguage(.korean))
@MainActor
func appInstallationReadinessBlocksBeforeCopy() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    let reason = "이전 연결의 종료를 확인한 뒤 다시 시도해 주세요."
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { _, _, _ in installs.increment(); throw AppInstallationError(.copyFailed) },
        openInstalled: { _, _ in Issue.record("Blocked readiness must not open an app") },
        safePointWaiter: .init(requireReady: { _ in
            throw AppUpdateTransactionError.transitionBlocked(reason)
        }, isTransient: { _ in false }))
    await model.refresh()
    await model.performPrimary()
    await model.confirmReplacement()
    #expect(model.phase == .failed && model.message == reason)
    #expect(installs.value == 0 && model.receipt == nil && model.plan == nil)
    #expect(!model.canConfirmLegacyQuit)
}

@Test("DMG safe-point retry finishes before the single replacement", .petLanguage(.korean))
@MainActor
func appInstallationWaitsForRequestCompletion() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    var inspections = 0
    var clock: TimeInterval = 0
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { plan, approved, legacy in
            installs.increment()
            return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacy)
        }, openInstalled: { _, _ in },
        safePointWaiter: .init(requireReady: { _ in
            inspections += 1
            if inspections == 1 { throw AppUpdateAdmissionError.busy }
        }, isTransient: { _ in true }, uptime: { clock }, sleep: { _ in clock += 0.5 }))
    await model.refresh()
    await model.performPrimary()
    await model.confirmReplacement()
    #expect(inspections == 2 && installs.value == 1 && model.phase == .launched)
}

@Test("inspection and cancellation never copy or launch an app", .petLanguage(.korean)) @MainActor
func appInstallationInspectionHasNoImplicitEffects() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let installs = InstallationFlowCounter()
    var opens = 0
    let service = fixture.service, source = fixture.source
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { plan, approved, legacyQuitConfirmed in
            #expect(!legacyQuitConfirmed)
            installs.increment()
            return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacyQuitConfirmed)
        },
        openInstalled: { _, _ in opens += 1 })
    await model.refresh()
    #expect(model.phase == .ready)
    #expect(installs.value == 0 && opens == 0)
    await model.confirmReplacement()
    #expect(installs.value == 0)
    await model.performPrimary()
    #expect(model.showsReplacementConfirmation)
    model.cancelReplacement()
    await model.confirmReplacement()
    #expect(installs.value == 0 && opens == 0)
}

@Test("confirmed replacement remains valid after SwiftUI dismisses the binding", .petLanguage(.korean)) @MainActor
func appInstallationConfirmationBindingOrder() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    var opened: URL?
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { plan, approved, legacyQuitConfirmed in
            #expect(approved)
            #expect(!legacyQuitConfirmed)
            installs.increment()
            return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacyQuitConfirmed)
        }, openInstalled: { url, _ in opened = url })
    await model.refresh()
    await model.performPrimary()
    model.showsReplacementConfirmation = false
    await model.confirmReplacement()
    #expect(installs.value == 1 && opened == fixture.target)
    #expect(model.phase == .launched && model.receipt?.backupURL != nil)
    await model.performPrimary()
    #expect(installs.value == 1)
}

@Test("launch failure retains the installed receipt and retry opens without reinstalling", .petLanguage(.korean)) @MainActor
func appInstallationOpenFailureRetriesOnlyLaunch() async throws {
    let fixture = try InstallationFlowFixture()
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    var opens = 0
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { plan, approved, legacyQuitConfirmed in
            #expect(!legacyQuitConfirmed)
            installs.increment()
            return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacyQuitConfirmed)
        },
        openInstalled: { _, _ in opens += 1; if opens == 1 { throw AppInstallationPlatformError.processInspectionIncomplete } })
    await model.refresh()
    await model.performPrimary()
    #expect(model.phase == .failed && model.receipt != nil)
    #expect(!model.canConfirmLegacyQuit)
    await model.prepareLegacyReplacement()
    await model.confirmLegacyReplacement()
    #expect(!model.showsLegacyQuitConfirmation && installs.value == 1)
    #expect(FileManager.default.fileExists(atPath: fixture.target.path))
    await model.refresh()
    #expect(model.receipt != nil)
    await model.performPrimary()
    #expect(installs.value == 1 && opens == 2 && model.phase == .launched)
}

@Test("failed copy clears the stale plan and cannot retry without inspection", .petLanguage(.korean)) @MainActor
func appInstallationFailedCopyRequiresRefresh() async throws {
    let fixture = try InstallationFlowFixture()
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    var opens = 0
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { _, _, _ in installs.increment(); throw AppInstallationError(.copyFailed) },
        openInstalled: { _, _ in opens += 1 })
    await model.refresh()
    await model.performPrimary()
    await model.performPrimary()
    #expect(installs.value == 1 && opens == 0 && model.plan == nil && model.phase == .failed)
    await model.refresh()
    #expect(model.phase == .ready)
}

@Test("same installed build is opened without copying or requesting replacement", .petLanguage(.korean)) @MainActor
func appInstallationExistingBuildIsReused() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "19")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    var opens = 0
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { _, _, _ in installs.increment(); throw AppInstallationError(.copyFailed) },
        openInstalled: { url, identity in
            #expect(url == fixture.target && identity == installationFlowIdentity)
            opens += 1
        })
    await model.refresh()
    #expect(model.primaryTitle == "설치된 Blabee 열기")
    await model.performPrimary()
    #expect(installs.value == 0 && opens == 1 && !model.showsReplacementConfirmation)
}

@Test("repeated clicks cannot begin a second installation while the first is busy", .petLanguage(.korean)) @MainActor
func appInstallationBusyPreventsDuplicateSubmission() async throws {
    let fixture = try InstallationFlowFixture()
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    let started = AsyncStream<Void>.makeStream()
    let release = DispatchSemaphore(value: 0)
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { plan, approved, legacyQuitConfirmed in
            #expect(!legacyQuitConfirmed)
            installs.increment()
            started.continuation.yield(())
            started.continuation.finish()
            guard release.wait(timeout: .now() + 3) == .success else {
                throw AppInstallationError(.deadlineExceeded)
            }
            return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacyQuitConfirmed)
        }, openInstalled: { _, _ in })
    await model.refresh()
    // Finish the stream even if inspection failed, so a regression cannot hang tests.
    guard model.phase == .ready else { Issue.record("fixture inspection failed"); return }
    let firstClick = Task { await model.performPrimary() }
    for await _ in started.stream { break }
    #expect(model.phase == .installing)
    await model.performPrimary()
    await model.refresh()
    #expect(installs.value == 1)
    release.signal()
    await firstClick.value
    #expect(model.phase == .launched && installs.value == 1)
}

@Test("legacy recovery is unavailable for active apps, enumeration failures, copy failures and fresh installs", .petLanguage(.korean),
      arguments: ["active", "enumeration", "copy", "fresh"]) @MainActor
func appInstallationLegacyRecoveryEligibility(reason: String) async throws {
    let fixture = try InstallationFlowFixture(existingBuild: reason == "fresh" ? nil : "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let installs = InstallationFlowCounter()
    let code: AppInstallationError.Code
    switch reason {
    case "active": code = .destinationActive
    case "enumeration": code = .activityInspectionUnavailable
    case "copy": code = .copyFailed
    default: code = .activityInspectionIncomplete
    }
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { _, _, legacyQuitConfirmed in
            #expect(!legacyQuitConfirmed)
            installs.increment()
            throw AppInstallationError(code)
        }, openInstalled: { _, _ in Issue.record("A failed installation must not launch") })
    await model.refresh()
    await model.performPrimary()
    await model.confirmReplacement()
    #expect(installs.value == 1 && !model.canConfirmLegacyQuit)
    await model.prepareLegacyReplacement()
    await model.confirmLegacyReplacement()
    #expect(installs.value == 1 && !model.showsLegacyQuitConfirmation)
}

@Test("legacy recovery reinspects and requires one explicit confirmation even after binding dismissal", .petLanguage(.korean)) @MainActor
func appInstallationLegacyRecoveryConfirmation() async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let inspections = InstallationFlowCounter()
    let confirmations = InstallationLegacyConfirmationRecorder()
    var opens = 0
    let model = AppInstallationViewModel(sourceURL: source,
        inspect: { inspections.increment(); return try service.inspect(source: source) },
        install: { plan, approved, legacyQuitConfirmed in
            #expect(approved)
            confirmations.record(legacyQuitConfirmed)
            guard legacyQuitConfirmed else { throw AppInstallationError(.activityInspectionIncomplete) }
            return try service.install(plan, replacementApproved: approved, legacyQuitConfirmed: legacyQuitConfirmed)
        }, openInstalled: { _, _ in opens += 1 })
    await model.refresh()
    await model.prepareLegacyReplacement()
    await model.confirmLegacyReplacement()
    #expect(inspections.value == 1 && confirmations.values.isEmpty)
    await model.performPrimary()
    await model.confirmReplacement()
    #expect(model.canConfirmLegacyQuit && model.plan == nil && confirmations.values == [false])
    await model.confirmLegacyReplacement()
    #expect(confirmations.values == [false])

    await model.prepareLegacyReplacement()
    #expect(inspections.value == 2 && model.showsLegacyQuitConfirmation)
    #expect(confirmations.values == [false] && opens == 0)
    #expect(model.plan?.existing?.build == "18")
    model.showsLegacyQuitConfirmation = false
    await model.confirmLegacyReplacement()
    #expect(confirmations.values == [false, true])
    #expect(model.receipt?.backupURL != nil && model.phase == .launched && opens == 1)
    #expect(!model.canConfirmLegacyQuit && !model.showsLegacyQuitConfirmation)
    await model.confirmLegacyReplacement()
    await model.performPrimary()
    #expect(confirmations.values == [false, true] && opens == 1)
}

@Test("cancellation, refresh and a failed legacy retry clear one-use confirmation", .petLanguage(.korean),
      arguments: ["cancel", "refresh", "failure"]) @MainActor
func appInstallationLegacyRecoveryConsentDoesNotPersist(reset: String) async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let confirmations = InstallationLegacyConfirmationRecorder()
    let model = AppInstallationViewModel(sourceURL: source, inspect: { try service.inspect(source: source) },
        install: { _, approved, legacyQuitConfirmed in
            #expect(approved)
            confirmations.record(legacyQuitConfirmed)
            throw AppInstallationError(legacyQuitConfirmed ? .copyFailed : .activityInspectionIncomplete)
        }, openInstalled: { _, _ in Issue.record("A failed installation must not launch") })
    await model.refresh()
    await model.performPrimary()
    await model.confirmReplacement()
    await model.prepareLegacyReplacement()
    #expect(model.showsLegacyQuitConfirmation && confirmations.values == [false])
    switch reset {
    case "cancel": model.cancelLegacyReplacement()
    case "refresh": await model.refresh()
    default:
        await model.confirmLegacyReplacement()
        #expect(model.phase == .failed && model.plan == nil && !model.canConfirmLegacyQuit)
    }
    let expected: [Bool] = reset == "failure" ? [false, true] : [false]
    #expect(!model.showsLegacyQuitConfirmation)
    await model.confirmLegacyReplacement()
    #expect(confirmations.values == expected)

    if reset == "failure" { await model.refresh() }
    await model.performPrimary()
    await model.confirmReplacement()
    #expect(confirmations.values == expected + [false])
}

@Test("fresh recovery inspection rejects a changed comparison or absent destination", .petLanguage(.korean),
      arguments: ["19", "20", "preview", "absent"]) @MainActor
func appInstallationLegacyRecoveryRechecksComparison(build: String) async throws {
    let fixture = try InstallationFlowFixture(existingBuild: "18")
    defer { fixture.remove() }
    let service = fixture.service, source = fixture.source
    let inspections = InstallationFlowCounter()
    let installs = InstallationFlowCounter()
    let model = AppInstallationViewModel(sourceURL: source,
        inspect: { inspections.increment(); return try service.inspect(source: source) },
        install: { _, _, legacyQuitConfirmed in
            #expect(!legacyQuitConfirmed)
            installs.increment()
            throw AppInstallationError(.activityInspectionIncomplete)
        }, openInstalled: { _, _ in Issue.record("Recovery preparation must not launch") })
    await model.refresh()
    await model.performPrimary()
    await model.confirmReplacement()
    #expect(model.canConfirmLegacyQuit)
    if build == "absent" { try FileManager.default.removeItem(at: fixture.target) }
    else { try fixture.rewriteExistingBuild(build) }
    await model.prepareLegacyReplacement()
    #expect(inspections.value == 2 && !model.showsLegacyQuitConfirmation && !model.canConfirmLegacyQuit)
    await model.confirmLegacyReplacement()
    #expect(installs.value == 1 && model.receipt == nil)
}

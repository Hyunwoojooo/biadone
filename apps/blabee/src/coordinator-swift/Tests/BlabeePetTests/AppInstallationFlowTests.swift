import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation
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

@Test("installed-only launch rejects translocation, aliases, extra arguments and identity mismatch")
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

@Test("installation primary policy never automatically downgrades or replaces an unknown version")
func appInstallationPrimaryPolicy() {
    #expect(AppInstallationPrimaryAction.forComparison(.freshInstall) == .install)
    #expect(AppInstallationPrimaryAction.forComparison(.upgrade) == .confirmReplacement)
    #expect(AppInstallationPrimaryAction.forComparison(.sameVersion) == .confirmReplacement)
    for comparison in [AppInstallationComparison.sameIdentity, .downgrade, .unknown] {
        #expect(AppInstallationPrimaryAction.forComparison(comparison) == .openExisting)
    }
}

@Test("inspection and cancellation never copy or launch an app") @MainActor
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

@Test("confirmed replacement remains valid after SwiftUI dismisses the binding") @MainActor
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

@Test("launch failure retains the installed receipt and retry opens without reinstalling") @MainActor
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

@Test("failed copy clears the stale plan and cannot retry without inspection") @MainActor
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

@Test("same installed build is opened without copying or requesting replacement") @MainActor
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

@Test("repeated clicks cannot begin a second installation while the first is busy") @MainActor
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

@Test("legacy recovery is unavailable for active apps, enumeration failures, copy failures and fresh installs",
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

@Test("legacy recovery reinspects and requires one explicit confirmation even after binding dismissal") @MainActor
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

@Test("cancellation, refresh and a failed legacy retry clear one-use confirmation",
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

@Test("fresh recovery inspection rejects a changed comparison or absent destination",
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

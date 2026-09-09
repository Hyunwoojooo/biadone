import AppKit
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("App installation process guard")
struct AppInstallationProcessGuardTests {
    private let application = URL(fileURLWithPath: "/Applications/Blabee.app")

    @Test("every executable inside the installed bundle blocks replacement", arguments: [
        "Contents/MacOS/blabee-coordinator",
        "Contents/Helpers/blabee-service",
        "Contents/Resources/mcp-server",
    ])
    func executableUsersBlock(_ relativePath: String) {
        let executable = application.appendingPathComponent(relativePath)
        let guarder = AppInstallationProcessGuard(snapshot: { [.running(executableURL: executable)] })
        #expect(throws: AppInstallationPlatformError.applicationActive) {
            try guarder.requireInactive(application)
        }
    }

    @Test("source installer and similarly prefixed bundles do not block")
    func excludesOtherBundles() throws {
        let guarder = AppInstallationProcessGuard(snapshot: {
            [
                .running(executableURL: URL(fileURLWithPath:
                    "/Volumes/Blabee/Blabee.app/Contents/MacOS/blabee-coordinator")),
                .running(executableURL: URL(fileURLWithPath:
                    "/Applications/Blabee.app.backup/Contents/MacOS/blabee-coordinator")),
                .running(executableURL: URL(fileURLWithPath: "/usr/libexec/runningboardd")),
                .exited,
            ]
        })
        try guarder.requireInactive(application)
    }

    @Test("unknown live executable evidence fails closed")
    func unknownProcessBlocks() {
        let guarder = AppInstallationProcessGuard(snapshot: { [.unavailable] })
        #expect(throws: AppInstallationPlatformError.processInspectionUnavailable) {
            try guarder.requireInactive(application)
        }
    }

    @Test("known active executable is reported before an unrelated inspection gap")
    func activeProcessWinsOverGap() {
        let executable = application.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        let guarder = AppInstallationProcessGuard(snapshot: {
            [.unavailable, .running(executableURL: executable)]
        })
        #expect(throws: AppInstallationPlatformError.applicationActive) {
            try guarder.requireInactive(application)
        }
    }

    @Test("process enumeration failures have sanitized errors")
    func enumerationErrorsAreSanitized() {
        let guarder = AppInstallationProcessGuard(snapshot: {
            throw NSError(domain: "/private/sensitive-user/source.app secret-token", code: 1)
        })
        #expect(throws: AppInstallationPlatformError.processInspectionUnavailable) {
            try guarder.requireInactive(application)
        }
        let message = AppInstallationPlatformError.processInspectionUnavailable.localizedDescription
        #expect(!message.contains("sensitive-user"))
        #expect(!message.contains("secret-token"))
    }

    @Test("canonical bundle paths include symlinked executable aliases")
    func canonicalPathsBlock() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-install-platform-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = directory.appendingPathComponent("Blabee.app")
        let targetExecutable = target.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        try FileManager.default.createDirectory(
            at: targetExecutable.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try Data("fixture".utf8).write(to: targetExecutable)
        let alias = directory.appendingPathComponent("alias.app")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: target)
        let executable = alias.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        let guarder = AppInstallationProcessGuard(snapshot: { [.running(executableURL: executable)] })
        #expect(throws: AppInstallationPlatformError.applicationActive) {
            try guarder.requireInactive(target)
        }
    }

    @Test("the process guard can be used as a Sendable installation callback")
    func sendableCallback() throws {
        let guarder = AppInstallationProcessGuard(snapshot: { [] })
        let callback: @Sendable (URL) throws -> Void = guarder.requireInactive
        try callback(application)
    }
}

@Suite("App installation process snapshot")
struct AppInstallationProcessReaderTests {
    private let token = AppInstallationProcessReader.Token(
        processID: 42, parentProcessID: 1, effectiveUserID: 0
    )
    private let executable = URL(fileURLWithPath:
        "/Applications/Blabee.app/Contents/MacOS/blabee-coordinator")

    @Test("non-GUI and other-user executable users are inspected")
    func allExecutableUsers() throws {
        let token = token
        let executable = executable
        let reader = AppInstallationProcessReader(
            processIDs: { [0, 42, 42] },
            state: { _ in .running(token) },
            executableURL: { _ in executable },
            protectedExecutableURL: { _ in nil }
        )
        #expect(try reader.snapshot() == [.running(executableURL: executable)])
    }

    @Test("a PID that exits between path reads does not block")
    func exitedPIDRace() {
        let sequence = InstallationLockedSequence([
            AppInstallationProcessReader.State.running(token), .exited,
        ])
        let executable = executable
        let reader = AppInstallationProcessReader(
            processIDs: { [42] },
            state: { _ in sequence.next() },
            executableURL: { _ in executable },
            protectedExecutableURL: { _ in nil }
        )
        #expect(reader.observe(42) == .exited)
    }

    @Test("changed process identity is retried before using its executable")
    func recycledPIDIsReinspected() {
        let nextToken = AppInstallationProcessReader.Token(
            processID: 42, parentProcessID: 100, effectiveUserID: 501
        )
        let sequence = InstallationLockedSequence([
            AppInstallationProcessReader.State.running(token),
            .running(nextToken), .running(nextToken),
        ])
        let executable = executable
        let reader = AppInstallationProcessReader(
            processIDs: { [42] },
            state: { _ in sequence.next() },
            executableURL: { _ in executable },
            protectedExecutableURL: { _ in nil }
        )
        #expect(reader.observe(42) == .running(executableURL: executable))
        #expect(sequence.readCount == 5)
    }

    @Test("a concurrent exec with unchanged PID is reinspected")
    func concurrentExecIsReinspected() {
        let token = token
        let paths = InstallationLockedSequence<URL?>([
            URL(fileURLWithPath: "/bin/sleep"), executable, executable,
        ])
        let reader = AppInstallationProcessReader(
            processIDs: { [42] },
            state: { _ in .running(token) },
            executableURL: { _ in paths.next() },
            protectedExecutableURL: { _ in nil }
        )
        #expect(reader.observe(42) == .running(executableURL: executable))
        #expect(paths.readCount == 4)
    }

    @Test("unreadable paths of live potentially relevant processes remain unknown")
    func unreadableLivePath() {
        let token = token
        let reader = AppInstallationProcessReader(
            processIDs: { [42] },
            state: { _ in .running(token) },
            executableURL: { _ in nil },
            protectedExecutableURL: { _ in nil }
        )
        #expect(reader.observe(42) == .unavailable)
    }

    @Test("protected unrelated processes can use their dynamic-code executable path")
    func protectedUnrelatedProcess() throws {
        let token = token
        let systemExecutable = URL(fileURLWithPath: "/usr/libexec/runningboardd")
        let reader = AppInstallationProcessReader(
            processIDs: { [42] },
            state: { _ in .running(token) },
            executableURL: { _ in nil },
            protectedExecutableURL: { _ in systemExecutable }
        )
        let guarder = AppInstallationProcessGuard(snapshot: { try reader.snapshot() })
        try guarder.requireInactive(URL(fileURLWithPath: "/Applications/Blabee.app"))
        #expect(reader.observe(42) == .running(executableURL: systemExecutable))
    }

    @Test("unknown process state is not inferred from an executable name")
    func unknownStateFailsClosed() {
        let reader = AppInstallationProcessReader(
            processIDs: { [42] },
            state: { _ in .unavailable },
            executableURL: { _ in URL(fileURLWithPath: "/usr/libexec/runningboardd") },
            protectedExecutableURL: { _ in nil }
        )
        #expect(reader.observe(42) == .unavailable)
    }
}

@Suite("Installed app opening")
@MainActor
struct AppInstallationApplicationOpenerTests {
    private let identity = "sha256:" + String(repeating: "a", count: 64)
    private let application = URL(fileURLWithPath: "/Applications/Blabee.app")
    private var executable: URL {
        application.appendingPathComponent("Contents/MacOS/blabee-coordinator")
    }

    @Test("opens the exact installed app with substitution disabled and verifies it twice")
    func exactLaunch() async throws {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication()
        var identityReads: [URL] = []
        let executable = executable
        let opener = AppInstallationApplicationOpener(
            workspace: workspace,
            installedIdentity: { url in identityReads.append(url); return identity },
            runningIdentity: { processID, url in
                #expect(processID == 42)
                #expect(url == executable)
                return identity
            },
            processObservation: { _ in .running(executableURL: executable) }
        )
        try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        #expect(workspace.openedURLs == [application])
        #expect(workspace.configuration?.allowsRunningApplicationSubstitution == false)
        #expect(workspace.configuration?.activates == true)
        #expect(workspace.configuration?.arguments == ["installed-pet"])
        #expect(identityReads == [executable, executable])
        #expect(workspace.shownFolders.isEmpty)
    }

    @Test("changed identity before opening prevents any launch")
    func identityMismatchBeforeLaunch() async {
        let workspace = InstallationWorkspaceStub()
        let opener = AppInstallationApplicationOpener(
            workspace: workspace, installedIdentity: { _ in nil },
            runningIdentity: { _, _ in nil },
            processObservation: { _ in .unavailable }
        )
        await #expect(throws: AppInstallationPlatformError.identityMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
        #expect(workspace.openedURLs.isEmpty)
    }

    @Test("identity is revalidated after the app finishes launching")
    func identityMismatchAfterLaunch() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication()
        var reads = 0
        let executable = executable
        let opener = AppInstallationApplicationOpener(
            workspace: workspace,
            installedIdentity: { _ in reads += 1; return reads == 1 ? identity : nil },
            runningIdentity: { _, _ in identity },
            processObservation: { _ in .running(executableURL: executable) }
        )
        await #expect(throws: AppInstallationPlatformError.identityMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
        #expect(workspace.openedURLs.count == 1)
    }

    @Test("a source installer returned for the shared bundle identifier is rejected")
    func substitutedSourceIsRejected() async {
        let workspace = InstallationWorkspaceStub()
        let source = URL(fileURLWithPath: "/Volumes/Blabee/Blabee.app")
        workspace.application = runningApplication(bundleURL: source)
        let opener = makeOpener(workspace: workspace)
        await #expect(throws: AppInstallationPlatformError.launchedApplicationMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
    }

    @Test("a returned executable outside the exact installed destination is rejected")
    func returnedExecutableMismatch() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication(executableURL: URL(fileURLWithPath: "/bin/sh"))
        let opener = makeOpener(workspace: workspace)
        await #expect(throws: AppInstallationPlatformError.launchedApplicationMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
    }

    @Test("the kernel executable must also match the returned app")
    func kernelExecutableMismatch() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication()
        let opener = AppInstallationApplicationOpener(
            workspace: workspace, installedIdentity: { _ in identity },
            runningIdentity: { _, _ in identity },
            processObservation: { _ in .running(executableURL: URL(fileURLWithPath: "/bin/sh")) }
        )
        await #expect(throws: AppInstallationPlatformError.launchedApplicationMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
    }

    @Test("a launched process that already exited is not success")
    func exitedPIDIsRejected() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication()
        let opener = AppInstallationApplicationOpener(
            workspace: workspace, installedIdentity: { _ in identity },
            runningIdentity: { _, _ in identity },
            processObservation: { _ in .exited }
        )
        await #expect(throws: AppInstallationPlatformError.launchedProcessExited) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
    }

    @Test("a missing workspace callback times out and ignores a delayed callback")
    func delayedWorkspaceCallback() async {
        let workspace = InstallationWorkspaceStub()
        workspace.delaysCompletion = true
        let opener = makeOpener(workspace: workspace, timeout: .milliseconds(10))
        await #expect(throws: AppInstallationPlatformError.launchTimedOut) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
        workspace.completion?(.success(runningApplication()))
        #expect(workspace.openedURLs == [application])
        #expect(workspace.shownFolders.isEmpty)
    }

    @Test("an application that never finishes launching has a bounded wait")
    func launchDoesNotFinish() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication(isFinishedLaunching: false)
        let opener = makeOpener(workspace: workspace, timeout: .milliseconds(10))
        await #expect(throws: AppInstallationPlatformError.launchTimedOut) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
        #expect(workspace.openedURLs == [application])
    }

    @Test("waiting allows the app to reach finished-launching state")
    func waitsUntilLaunchFinishes() async throws {
        let workspace = InstallationWorkspaceStub()
        var reads = 0
        let initial = runningApplication(isFinishedLaunching: false).snapshot()
        let finished = runningApplication().snapshot()
        workspace.application = AppInstallationRunningApplication(snapshot: {
            reads += 1
            return reads == 1 ? initial : finished
        })
        let opener = makeOpener(workspace: workspace)
        try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        #expect(reads == 2)
    }

    @Test("folder opening only occurs through the explicit helper")
    func finderRequiresExplicitCall() throws {
        let workspace = InstallationWorkspaceStub()
        let opener = makeOpener(workspace: workspace)
        #expect(workspace.openedURLs.isEmpty)
        #expect(workspace.shownFolders.isEmpty)
        let folder = FileManager.default.temporaryDirectory
        try opener.showInFinder(folder)
        #expect(workspace.shownFolders == [folder])
        #expect(workspace.openedURLs.isEmpty)
    }

    @Test("an app recovery directory is revealed without an application launch request")
    func finderRevealsRecoveryApp() throws {
        let workspace = InstallationWorkspaceStub()
        let opener = makeOpener(workspace: workspace)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-install-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let recoveryApp = directory.appendingPathComponent("Blabee.backup.app")
        try FileManager.default.createDirectory(at: recoveryApp, withIntermediateDirectories: true)
        try opener.showInFinder(recoveryApp)
        #expect(workspace.shownFolders == [recoveryApp])
        #expect(workspace.openedURLs.isEmpty)
    }

    @Test("same installed path and disk identity cannot qualify an older running process")
    func oldRunningIdentityAtSamePath() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication()
        let executable = executable
        let opener = AppInstallationApplicationOpener(
            workspace: workspace, installedIdentity: { _ in identity },
            runningIdentity: { _, _ in "sha256:" + String(repeating: "b", count: 64) },
            processObservation: { _ in .running(executableURL: executable) }
        )
        await #expect(throws: AppInstallationPlatformError.runningIdentityMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
    }

    @Test("unavailable running identity fails closed despite matching installed evidence")
    func unavailableRunningIdentity() async {
        let workspace = InstallationWorkspaceStub()
        workspace.application = runningApplication()
        let executable = executable
        let opener = AppInstallationApplicationOpener(
            workspace: workspace, installedIdentity: { _ in identity },
            runningIdentity: { _, _ in nil },
            processObservation: { _ in .running(executableURL: executable) }
        )
        await #expect(throws: AppInstallationPlatformError.runningIdentityMismatch) {
            try await opener.openInstalled(applicationURL: application, expectedIdentity: identity)
        }
    }

    private func makeOpener(
        workspace: InstallationWorkspaceStub, timeout: Duration = .seconds(1)
    ) -> AppInstallationApplicationOpener {
        let executable = executable
        return AppInstallationApplicationOpener(
            workspace: workspace, installedIdentity: { _ in identity },
            runningIdentity: { _, _ in identity },
            processObservation: { _ in .running(executableURL: executable) },
            timeout: timeout, pollInterval: .milliseconds(1)
        )
    }

    private func runningApplication(
        bundleURL: URL? = nil, executableURL: URL? = nil, isFinishedLaunching: Bool = true
    ) -> AppInstallationRunningApplication {
        let snapshot = AppInstallationRunningApplication.Snapshot(
            processID: 42, bundleURL: bundleURL ?? application,
            executableURL: executableURL ?? executable,
            isTerminated: false, isFinishedLaunching: isFinishedLaunching
        )
        return AppInstallationRunningApplication(snapshot: { snapshot })
    }
}

private final class InstallationLockedSequence<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private let values: [Value]
    private var count = 0

    init(_ values: [Value]) { self.values = values }

    var readCount: Int { lock.withLock { count } }

    func next() -> Value {
        lock.withLock {
            let value = values[min(count, values.count - 1)]
            count += 1
            return value
        }
    }
}

@MainActor
private final class InstallationWorkspaceStub: AppInstallationWorkspaceOpening {
    var openedURLs: [URL] = []
    var shownFolders: [URL] = []
    var configuration: NSWorkspace.OpenConfiguration?
    var application: AppInstallationRunningApplication?
    var delaysCompletion = false
    var completion: (@MainActor @Sendable (
        Result<AppInstallationRunningApplication, AppInstallationPlatformError>
    ) -> Void)?

    func openApplication(
        at applicationURL: URL,
        configuration: NSWorkspace.OpenConfiguration,
        completion: @escaping @MainActor @Sendable (
            Result<AppInstallationRunningApplication, AppInstallationPlatformError>
        ) -> Void
    ) {
        openedURLs.append(applicationURL)
        self.configuration = configuration
        self.completion = completion
        if !delaysCompletion {
            completion(application.map(Result.success) ?? .failure(.launchFailed))
        }
    }

    func showInFinder(_ folderURL: URL) -> Bool {
        shownFolders.append(folderURL)
        return true
    }
}

import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Pet Claude project launcher", .petLanguage(.korean), .serialized)
@MainActor
struct PetClaudeLauncherTests {
    @Test("A project alias becomes the exact canonical cwd without changing project configuration")
    func canonicalProjectAndService() throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let alias = fixture.root.appendingPathComponent("project-alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.project)
        let config = fixture.project.appendingPathComponent("codex-config-sentinel")
        let contents = Data("existing Codex configuration\n".utf8)
        try contents.write(to: config)
        let before = try FileManager.default.contentsOfDirectory(atPath: fixture.project.path)
        let plan = try fixture.launcher().makePlan(project: alias, service: fixture.runtime.service)
        #expect(plan.project.path == fixture.project.path)
        #expect(plan.service == fixture.runtime.service)
        #expect(plan.ownerSocketPath == fixture.root.appendingPathComponent("runtime/claude-owner.sock").path)
        #expect(plan.options.sessionSocketPath == fixture.runtime.service.socketPath)
        #expect(plan.options.runtimeIdentity == fixture.runtime.service.runtimeIdentity)
        #expect(plan.options.channelSource == "blabee-claude")
        #expect(plan.options.configurationRoot == nil)
        #expect(!plan.options.observeSession && plan.options.claudeArguments.isEmpty)
        #expect(plan.nativeSessionID == nil && plan.terminal == .terminal)
        #expect(try Data(contentsOf: config) == contents)
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.project.path) == before)
    }

    @Test("Missing bundled components and CLI stop before any Terminal call",
           arguments: ["coordinator", "payload", "hook", "mcp", "node", "claude", "project"])
    func missingComponents(component: String) async throws {
        let fixture = try PetClaudeLaunchFixture(omitting: component)
        defer { fixture.cleanup() }
        let observed = PetClaudeLaunchObservations()
        let launcher = fixture.launcher(openTerminal: { _ in observed.opened() })
        let failure: PetClaudeLauncher.Failure
        switch component {
        case "coordinator": failure = .productUnavailable
        case "node": failure = .nodeUnavailable
        case "claude": failure = .claudeUnavailable
        case "project": failure = .projectUnavailable
        default: failure = .payloadUnavailable
        }
        await #expect(throws: failure) {
            try await launcher.start(projectFolderChooser: PetClaudeTestFolderChooser(fixture.project),
                                     service: fixture.runtime.service)
        }
        #expect(observed.openCount == 0)
        #expect(!failure.localizedDescription.contains(fixture.root.path))
    }

    @Test("Bundle resources cannot silently resolve to a developer source or outside Node",
           arguments: ["payload", "node"])
    func escapedBundleResource(component: String) throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let path = component == "payload" ? fixture.payload : fixture.node
        let outside = fixture.root.appendingPathComponent("external-" + component)
        try FileManager.default.moveItem(at: path, to: outside)
        try FileManager.default.createSymbolicLink(at: path, withDestinationURL: outside)
        #expect(throws: component == "payload" ? PetClaudeLauncher.Failure.payloadUnavailable : .nodeUnavailable) {
            try fixture.launcher().makePlan(project: fixture.project, service: fixture.runtime.service)
        }
    }

    @Test("Canceling folder choice has no resolver, validator or Terminal side effects")
    func cancel() async throws {
        let observed = PetClaudeLaunchObservations()
        let launcher = PetClaudeLauncher(resolveRuntime: {
            observed.resolved()
            throw PetClaudeLauncher.Failure.productUnavailable
        }, openTerminal: { _ in observed.opened() })
        var validationCount = 0
        try await launcher.start(projectFolderChooser: PetClaudeTestFolderChooser(nil),
            service: .init(socketPath: "/unused.sock", runtimeIdentity: "unused"),
            validateService: { validationCount += 1 })
        #expect(validationCount == 0)
        #expect(observed.resolveCount == 0 && observed.openCount == 0)
    }

    @Test("A same-binary service restart while the chooser is open prevents launch")
    func serviceAccessChangedDuringChoice() async throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let observed = PetClaudeLaunchObservations()
        let launcher = PetClaudeLauncher(resolveRuntime: {
            observed.resolved()
            return fixture.runtime
        }, openTerminal: { _ in observed.opened() })
        var access = UUID()
        let expectedAccess = access
        let chooser = PetClaudeTestFolderChooser(fixture.project) { access = UUID() }
        await #expect(throws: PetClaudeLauncher.Failure.serviceChanged) {
            try await launcher.start(projectFolderChooser: chooser, service: fixture.runtime.service,
                validateService: {
                    guard access == expectedAccess else { throw PetClaudeLauncher.Failure.serviceChanged }
                })
        }
        #expect(observed.resolveCount == 0 && observed.openCount == 0)
    }

    @Test("A runtime resolver returning a different service cannot redirect a captured start",
           arguments: ["socket", "identity"])
    func mismatchedService(field: String) throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let expected = PetClaudeLauncher.ServiceContext(
            socketPath: field == "socket" ? fixture.root.appendingPathComponent("other.sock").path : fixture.runtime.service.socketPath,
            runtimeIdentity: field == "identity" ? "sha256:" + String(repeating: "b", count: 64) : fixture.runtime.service.runtimeIdentity)
        #expect(throws: PetClaudeLauncher.Failure.serviceChanged) {
            try fixture.launcher().makePlan(project: fixture.project, service: expected)
        }
    }

    @Test("CLI discovery uses only approved native locations and respects their priority")
    func nativeCLICandidates() throws {
        let home = URL(fileURLWithPath: "/Users/example")
        #expect(PetClaudeLauncher.claudeCandidates(homeDirectory: home).map(\.path) == [
            "/Users/example/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
        ])
        let fixture = try PetClaudeLaunchFixture(omitting: "claude")
        defer { fixture.cleanup() }
        let second = fixture.root.appendingPathComponent("second-claude")
        let third = fixture.root.appendingPathComponent("third-claude")
        try fixture.writeFile(second, executable: true)
        try fixture.writeFile(third, executable: true)
        let base = fixture.runtime
        let launcher = PetClaudeLauncher(resolveRuntime: {
            .init(bundleURL: base.bundleURL, coordinatorExecutable: base.coordinatorExecutable,
                  service: base.service, claudeCandidates: base.claudeCandidates + [second, third])
        }, openTerminal: { _ in })
        #expect(try launcher.makePlan(project: fixture.project, service: base.service).claudeExecutable == second)
    }

    @Test("PATH discovery preserves updater symlinks and excludes malformed or recursive shim candidates")
    func environmentCLICandidates() throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let home = fixture.root.appendingPathComponent("home")
        let version = fixture.root.appendingPathComponent("versions/claude-current")
        try fixture.writeFile(version, executable: true)
        let upstream = home.appendingPathComponent(".local/bin/claude")
        try FileManager.default.createDirectory(at: upstream.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: upstream, withDestinationURL: version)
        let custom = fixture.root.appendingPathComponent("custom tools/bin/claude")
        try fixture.writeFile(custom, executable: true)
        let shim = home.appendingPathComponent("Library/Application Support/Blabee/shell/claude-v1/bin/claude")
        try fixture.writeFile(shim, executable: true)
        let alias = fixture.root.appendingPathComponent("shim-alias/bin/claude")
        try FileManager.default.createDirectory(at: alias.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: shim)
        let path = ["", "relative/bin", custom.deletingLastPathComponent().path,
                    shim.deletingLastPathComponent().path, alias.deletingLastPathComponent().path,
                    upstream.deletingLastPathComponent().path, custom.deletingLastPathComponent().path,
                    "/invalid\npath"].joined(separator: ":")
        let candidates = PetClaudeLauncher.claudeCandidates(homeDirectory: home, environment: ["PATH": path])
        #expect(candidates.map(\.path) == [upstream.path, "/opt/homebrew/bin/claude", "/usr/local/bin/claude", custom.path])
        #expect(candidates.first != version)
        // A copied public symlink must not turn discovery back into our shim.
        try FileManager.default.removeItem(at: upstream)
        try FileManager.default.createSymbolicLink(at: upstream, withDestinationURL: shim)
        let redirected = PetClaudeLauncher.claudeCandidates(homeDirectory: home, environment: ["PATH": path])
        #expect(!redirected.contains(upstream) && !redirected.contains(shim) && !redirected.contains(alias))
        #expect(redirected.contains(custom))
    }

    @Test("The CP-05 Terminal boundary receives shell-like paths as argv off the main thread")
    func safeTerminalArgumentsOffMainQueue() async throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let observed = PetClaudeLaunchObservations()
        let runtime = fixture.runtime
        let launcher = PetClaudeLauncher(resolveRuntime: {
            observed.resolved()
            return runtime
        }, openTerminal: { plan in
            try ClaudeInstalledLauncher.openInTerminal(plan.options, coordinatorExecutable: plan.coordinatorExecutable,
                runner: { executable, arguments, _ in
                    observed.opened(executable: executable, arguments: arguments)
                    return .init(exitCode: 0, stdout: Data(), stderr: Data())
                })
        })
        try await launcher.start(projectFolderChooser: PetClaudeTestFolderChooser(fixture.project), service: runtime.service)
        #expect(observed.resolveCount == 1 && observed.openCount == 1)
        #expect(!observed.ranOnMainThread)
        #expect(observed.executable?.path == "/usr/bin/osascript")
        let arguments = observed.arguments
        #expect(Array(arguments.prefix(3)) == ["-e", ClaudeInstalledLaunchConfiguration.terminalScript, "--"])
        let cwdIndex = try #require(arguments.firstIndex(of: "--cwd"))
        #expect(arguments[cwdIndex + 1] == fixture.project.path)
        #expect(!arguments[1].contains(fixture.project.path))
        #expect(arguments.filter { $0 == fixture.project.path }.count == 1)
        #expect(arguments.contains(runtime.service.socketPath))
        #expect(arguments.contains(runtime.service.runtimeIdentity))
        #expect(!arguments.contains("--strict-mcp-config") && !arguments.contains("--permission-mode"))
    }

    @Test("Connection launch targets one new observed native session in the selected terminal",
           arguments: ClaudeInstalledLauncher.TerminalApplication.allCases)
    func connectionReceipt(terminal: ClaudeInstalledLauncher.TerminalApplication) async throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let alias = fixture.root.appendingPathComponent("project-alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.project)
        let nativeSessionID = UUID()
        let observed = PetClaudeLaunchObservations()
        let launcher = fixture.launcher(openTerminal: { plan in
            #expect(plan.nativeSessionID == nativeSessionID && plan.terminal == terminal)
            #expect(plan.options.observeSession)
            #expect(plan.options.claudeArguments == ["--session-id", nativeSessionID.uuidString.lowercased()])
            try ClaudeInstalledLauncher.openInTerminal(plan.options, coordinatorExecutable: plan.coordinatorExecutable,
                terminal: plan.terminal, runner: { executable, arguments, _ in
                    observed.opened(executable: executable, arguments: arguments)
                    return .init(exitCode: 0, stdout: Data(), stderr: Data())
                })
        })
        var validationCount = 0
        let receipt = try await launcher.startConnection(projectFolderChooser: PetClaudeTestFolderChooser(alias),
            service: fixture.runtime.service, nativeSessionID: nativeSessionID, terminal: terminal,
            validateService: { validationCount += 1 })
        #expect(receipt == .init(nativeSessionID: nativeSessionID, project: fixture.project, terminal: terminal))
        #expect(validationCount == 1 && observed.openCount == 1 && !observed.ranOnMainThread)
        #expect(observed.executable?.path == "/usr/bin/osascript")
        #expect(observed.arguments[1] == ClaudeInstalledLauncher.terminalScript(for: terminal))
        #expect(Array(observed.arguments.suffix(4)) == ["--observe-session", "--", "--session-id", nativeSessionID.uuidString.lowercased()])
        #expect(!observed.arguments.contains("--resume") && !observed.arguments.contains("--continue"))
        #expect(!observed.arguments[1].contains(fixture.project.path))
    }

    @Test("Connection folder cancellation returns no launch receipt and has no side effects")
    func cancelConnection() async throws {
        let observed = PetClaudeLaunchObservations()
        let launcher = PetClaudeLauncher(resolveRuntime: {
            observed.resolved()
            throw PetClaudeLauncher.Failure.productUnavailable
        }, openTerminal: { _ in observed.opened() })
        var validationCount = 0
        let receipt = try await launcher.startConnection(projectFolderChooser: PetClaudeTestFolderChooser(nil),
            service: .init(socketPath: "/unused.sock", runtimeIdentity: "unused"), nativeSessionID: UUID(),
            terminal: .ghostty, validateService: { validationCount += 1 })
        #expect(receipt == nil && validationCount == 0)
        #expect(observed.resolveCount == 0 && observed.openCount == 0)
    }

    @Test("An unconfirmed connection launch preserves its receipt without retrying")
    func unconfirmedConnection() async throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let observed = PetClaudeLaunchObservations()
        let launcher = fixture.launcher(openTerminal: { _ in
            observed.opened()
            throw PetClaudeLauncher.Failure.terminalUnconfirmed
        })
        let nativeSessionID = UUID()
        let expected = PetClaudeLauncher.ConnectionLaunchUnconfirmed(receipt: .init(nativeSessionID: nativeSessionID,
                                                                                   project: fixture.project, terminal: .ghostty))
        await #expect(throws: expected) {
            try await launcher.startConnection(projectFolderChooser: PetClaudeTestFolderChooser(fixture.project),
                service: fixture.runtime.service, nativeSessionID: nativeSessionID, terminal: .ghostty)
        }
        #expect(observed.openCount == 1)
        #expect(!expected.localizedDescription.contains(fixture.root.path))
    }

    @Test("Connection launch revalidates service access after folder selection")
    func connectionServiceChangedDuringChoice() async throws {
        let fixture = try PetClaudeLaunchFixture()
        defer { fixture.cleanup() }
        let observed = PetClaudeLaunchObservations()
        let launcher = PetClaudeLauncher(resolveRuntime: {
            observed.resolved()
            return fixture.runtime
        }, openTerminal: { _ in observed.opened() })
        await #expect(throws: PetClaudeLauncher.Failure.serviceChanged) {
            try await launcher.startConnection(projectFolderChooser: PetClaudeTestFolderChooser(fixture.project),
                service: fixture.runtime.service, nativeSessionID: UUID(), terminal: .terminal,
                validateService: { throw PetClaudeLauncher.Failure.serviceChanged })
        }
        #expect(observed.resolveCount == 0 && observed.openCount == 0)
    }

    @Test("Terminal recommendation uses installed and running application metadata only")
    func terminalDiscovery() {
        let terminal = ClaudeInstalledLauncher.TerminalApplication.terminal
        let ghostty = ClaudeInstalledLauncher.TerminalApplication.ghostty
        let both: Set<String> = [terminal.bundleID, ghostty.bundleID]
        #expect(PetClaudeLauncher.availableTerminals(installedBundleIDs: both) == [.terminal, .ghostty])
        #expect(PetClaudeLauncher.availableTerminals(installedBundleIDs: [ghostty.bundleID]) == [.ghostty])
        #expect(PetClaudeLauncher.availableTerminals(installedBundleIDs: []).isEmpty)
        #expect(PetClaudeLauncher.recommendedTerminal(installedBundleIDs: both,
                                                     runningBundleIDs: [ghostty.bundleID]) == .ghostty)
        #expect(PetClaudeLauncher.recommendedTerminal(installedBundleIDs: both,
                                                     runningBundleIDs: [terminal.bundleID]) == .terminal)
        #expect(PetClaudeLauncher.recommendedTerminal(installedBundleIDs: both, runningBundleIDs: []) == .terminal)
        #expect(PetClaudeLauncher.recommendedTerminal(installedBundleIDs: [terminal.bundleID],
                                                     runningBundleIDs: [ghostty.bundleID]) == .terminal)
        #expect(PetClaudeLauncher.recommendedTerminal(installedBundleIDs: [], runningBundleIDs: both) == nil)
    }

    @Test("Ghostty surface configuration is available from numeric version 1.3",
           arguments: ["1.3", "1.3.0", "1.3.1", "1.10.0", "2.0", "2.4.1"])
    func supportedGhosttyVersion(version: String) {
        #expect(PetClaudeLauncher.supportsGhosttyVersion(version))
    }

    @Test("Unknown, old and malformed Ghostty versions do not claim AppleScript support")
    func unsupportedGhosttyVersions() {
        let versions: [String?] = [nil, "", "1.2", "1.2.99", "0.99.0", "1", "2", "v1.3.1", "1.3-beta",
                                   "1.3.1-preview", "1..3", ".1.3", "1.3.", "1.3.1.0", " 1.3", "1.3\n",
                                   "+1.3", "-1.3", "1.٣", String(repeating: "9", count: 30) + ".0"]
        for version in versions { #expect(!PetClaudeLauncher.supportsGhosttyVersion(version)) }
    }
}

private final class PetClaudeLaunchFixture: @unchecked Sendable {
    let root: URL
    let project: URL
    let payload: URL
    let node: URL
    let runtime: PetClaudeLauncher.QualifiedRuntime
    private var runtimeFixture: ClaudeRuntimePayloadFixture?

    init(omitting: String? = nil) throws {
        root = URL(fileURLWithPath: "/private/tmp/pcl-\(UUID().uuidString.prefix(8))")
        project = root.appendingPathComponent("프로젝트 ' ; $(touch nowhere)", isDirectory: true)
        let bundle = root.appendingPathComponent(BlabeeProductProfile.current.appBundleName, isDirectory: true)
        let coordinator = bundle.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        payload = bundle.appendingPathComponent("Contents/Resources/claude/payload", isDirectory: true)
        node = bundle.appendingPathComponent("Contents/Resources/claude/node/bin/node")
        let cli = root.appendingPathComponent("native-claude")
        runtime = .init(bundleURL: bundle, coordinatorExecutable: coordinator,
                        service: .init(socketPath: root.appendingPathComponent("runtime/blabee.sock").path,
                                       runtimeIdentity: "sha256:" + String(repeating: "a", count: 64)),
                        claudeCandidates: [cli])
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        do {
            try FileManager.default.createDirectory(at: root.appendingPathComponent("runtime"), withIntermediateDirectories: true)
            if omitting != "project" { try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true) }
            if omitting != "coordinator" { try writeFile(coordinator, executable: true) }
            runtimeFixture = try ClaudeRuntimePayloadFixture(runtimeRoot: payload.deletingLastPathComponent())
            switch omitting {
            case "payload": try FileManager.default.removeItem(at: payload)
            case "hook": try FileManager.default.removeItem(at: payload.appendingPathComponent("src/session-v2-hook.mjs"))
            case "mcp": try FileManager.default.removeItem(at: payload.appendingPathComponent("src/session-v2-mcp.mjs"))
            case "node": try FileManager.default.removeItem(at: node)
            default: break
            }
            if omitting != "claude" { try writeFile(cli, executable: true) }
        } catch { cleanup(); throw error }
    }

    func writeFile(_ path: URL, executable: Bool = false) throws {
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture, never executed\n".utf8).write(to: path)
        try FileManager.default.setAttributes([.posixPermissions: executable ? 0o700 : 0o600], ofItemAtPath: path.path)
    }

    func launcher(openTerminal: @escaping PetClaudeLauncher.TerminalOpener = { _ in }) -> PetClaudeLauncher {
        let runtime = runtime
        return .init(resolveRuntime: { runtime }, openTerminal: openTerminal)
    }
    func cleanup() { runtimeFixture?.cleanup(); try? FileManager.default.removeItem(at: root) }
}

@MainActor
private final class PetClaudeTestFolderChooser: PetProjectFolderChoosing {
    let project: URL?
    let onChoose: () -> Void
    init(_ project: URL?, onChoose: @escaping () -> Void = {}) {
        self.project = project
        self.onChoose = onChoose
    }
    func chooseProjectFolder() -> URL? { onChoose(); return project }
}

private final class PetClaudeLaunchObservations: @unchecked Sendable {
    private let lock = NSLock()
    private var resolutions = 0
    private var openings = 0
    private var mainThread = false
    private var binary: URL?
    private var argv: [String] = []
    func resolved() { lock.withLock { resolutions += 1; mainThread = mainThread || Thread.isMainThread } }
    func opened(executable: URL? = nil, arguments: [String] = []) {
        lock.withLock { openings += 1; mainThread = mainThread || Thread.isMainThread; binary = executable; argv = arguments }
    }
    var resolveCount: Int { lock.withLock { resolutions } }
    var openCount: Int { lock.withLock { openings } }
    var ranOnMainThread: Bool { lock.withLock { mainThread } }
    var executable: URL? { lock.withLock { binary } }
    var arguments: [String] { lock.withLock { argv } }
}

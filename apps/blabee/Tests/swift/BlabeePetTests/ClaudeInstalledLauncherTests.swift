#if BLABEE_JOURNAL_TEST_HARNESS
import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Installed Claude launcher", .petLanguage(.korean), .serialized)
struct ClaudeInstalledLauncherTests {
    @Test("Observed enrollment preserves the native conversation while creating fresh authorities")
    func observedEnrollment() throws {
        let fixture = try InstalledLauncherFixture()
        defer { fixture.cleanup() }
        let native = UUID()
        let observed = ClaudeInstalledOwnerConnection.ObservedSession(nativeSessionID: native, source: "resume")
        let first = try fixture.connect(observed: observed), second = try fixture.connect(observed: observed)
        defer { first.close(); second.close() }
        #expect(first.identity.nativeSessionID == native)
        #expect(second.identity.nativeSessionID == native)
        #expect(first.identity.scopeID != second.identity.scopeID)
        #expect(first.identity.sessionIncarnation != second.identity.sessionIncarnation)
        #expect(first.coreSessionID != second.coreSessionID)
    }

    @Test("An observed enrollment cannot substitute a different native conversation in its private grant")
    func observedGrantMismatch() throws {
        let fixture = try InstalledLauncherFixture(fault: "wrong_native")
        defer { fixture.cleanup() }
        #expect(throws: (any Error).self) {
            try fixture.connect(observed: .init(nativeSessionID: UUID(), source: "startup"))
        }
    }

    @Test("Automatic configuration leaves Claude's session selection and argument delimiter intact")
    func observedConfiguration() throws {
        let root = URL(fileURLWithPath: "/private/tmp/literal ' 한글")
        let documents = try ClaudeInstalledLaunchConfiguration.documents(nodeExecutable: root.appendingPathComponent("node"),
            payloadRoot: root, observeSession: true)
        let hooks = try #require(StrictJSONTransport.object(from: documents.settings)["hooks"] as? [String: [[String: Any]]])
        for (event, groups) in hooks {
            let command = try #require((groups.first?["hooks"] as? [[String: Any]])?.first)
            #expect(command["args"] as? [String] == [root.appendingPathComponent("src/auto-connect-hook.mjs").path])
            #expect(command["timeout"] as? Int == (event == "Stop" ? 660 : 12))
            #expect(command["asyncRewake"] as? Bool == (event == "Stop" ? true : nil))
            #expect(command["async"] == nil)
        }
        let servers = try #require(StrictJSONTransport.object(from: documents.mcp)["mcpServers"] as? [String: [String: Any]])
        let server = try #require(servers["blabee-claude"])
        #expect(server["args"] as? [String] == [root.appendingPathComponent("src/auto-connect-mcp.mjs").path])
        let environment = try #require(server["env"] as? [String: String])
        #expect(environment["BLABEE_CLAUDE_BOOTSTRAP_HOOK_TOKEN"] == "")
        #expect(environment[ClaudeInstalledLaunchConfiguration.prefix + "HOOK_TOKEN"] == "")
        #expect(environment["CLAUDE_CODE_SESSION_ID"] == nil)
        for forwarded in [[String](), ["--resume"], ["--resume", UUID().uuidString.lowercased()], ["--continue"], ["hello prompt"],
                          ["--model", "sonnet", "hello prompt"],
                          ["--", "literal --settings and $(untouched)"]] {
            let args = ClaudeInstalledLaunchConfiguration.arguments(settings: root.appendingPathComponent("settings"),
                mcp: root.appendingPathComponent("mcp"), claudeArguments: forwarded)
            #expect(!args.contains("--session-id"))
            #expect(!args.contains("--fork-session"))
            #expect(Array(args.dropFirst(4)) == forwarded)
            #expect(Array(args.prefix(4)) == ["--mcp-config", root.appendingPathComponent("mcp").path,
                "--settings", root.appendingPathComponent("settings").path])
            #expect(!args.contains("--dangerously-load-development-channels"))
        }
    }

    @Test("Real private enrollment grants only child role environments and EOF is scoped")
    func privateGrantAndScopedEOF() throws {
        let fixture = try InstalledLauncherFixture()
        defer { fixture.cleanup() }
        let first = try fixture.connect(), second = try fixture.connect()
        defer { first.close(); second.close() }
        #expect(first.descriptorIsCloseOnExecTesting)
        #expect(second.descriptorIsCloseOnExecTesting)
        let environment = try first.childEnvironment(sessionSocketPath: fixture.root.appendingPathComponent("session.sock").path)
        let prefix = ClaudeInstalledLaunchConfiguration.prefix
        #expect(Set(environment.keys) == Set(["SOCKET", "RUNTIME_IDENTITY", "CWD", "CHANNEL_SOURCE", "SCOPE_ID",
            "NATIVE_SESSION_ID", "SESSION_INCARNATION", "SERVICE_INCARNATION", "OWNER_CONNECTION_ID", "AUTHORITY_EPOCH",
            "HOOK_TOKEN", "BRIDGE_TOKEN"].map { prefix + $0 }))
        #expect(environment[prefix + "HOOK_TOKEN"] == fixture.state.hook)
        #expect(environment[prefix + "BRIDGE_TOKEN"] == fixture.state.bridge)
        #expect(!environment.values.contains(fixture.state.owner))
        #expect(first.identity.scopeID != second.identity.scopeID)
        first.close()
        try fixture.waitForDisconnects(1)
        #expect(fixture.state.disconnected == [first.identity.ownerConnectionID])
        let controller = try fixture.controller(second)
        controller.end(reason: .childExited)
        try fixture.waitForDisconnects(2)
        #expect(controller.snapshot().terminalReason == .ended)
        #expect(fixture.state.operations == ["end"])
        #expect(!second.descriptorIsCloseOnExecTesting)
    }

    @Test("Unexpected grant fields, tokens and public/grant binding differences fail closed",
           arguments: ["selector", "short_token", "duplicate_token", "wrong_scope", "wrong_core", "secret_response"])
    func malformedGrant(fault: String) throws {
        let fixture = try InstalledLauncherFixture(fault: fault)
        defer { fixture.cleanup() }
        #expect(throws: (any Error).self) { try fixture.connect() }
        try fixture.waitForDisconnects(1)
        #expect(fixture.state.operations.isEmpty)
    }

    @Test("Client refuses a changed kernel peer between challenge and grant")
    func peerChanged() throws {
        let fixture = try InstalledLauncherFixture()
        defer { fixture.cleanup() }
        let peer = InstalledPeerCounter()
        #expect(throws: (any Error).self) {
            try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: fixture.socket,
                runtimeIdentity: fixture.identity, canonicalCWD: fixture.root.path, clock: fixture.state.clock,
                peerVerifier: { try peer.observe($0) })
        }
        try fixture.waitForDisconnects(1)
        #expect(fixture.state.enrollments == 0)
    }

    @Test("Owner renewal uses the same open socket and service EOF is observed once")
    func renewalAndEOF() throws {
        let fixture = try InstalledLauncherFixture()
        defer { fixture.cleanup() }
        let connection = try fixture.connect()
        defer { connection.close() }
        let controller = try fixture.controller(connection)
        defer { controller.stop() }
        fixture.state.clock.advance(ClaudeSessionAuthority.recommendedRenewalIntervalNanoseconds)
        controller.tick()
        #expect(controller.snapshot().renewalSequence == 1)
        #expect(fixture.state.enrollments == 1)
        #expect(fixture.state.operations == ["renew"])
        let notification = InstalledNotification()
        try connection.startEOFMonitor { notification.notify(); controller.stop() }
        fixture.endpoint.stop()
        #expect(notification.ready.wait(timeout: .now() + 3) == .success)
        #expect(notification.count == 1)
        #expect(throws: (any Error).self) { try connection.exchange(Data("{}".utf8)) }
    }

    @Test("Hook/MCP JSON preserves argument boundaries and contains no capabilities")
    func configurationIsPublic() throws {
        let session = UUID()
        let root = URL(fileURLWithPath: "/private/tmp/한 글 ' $(touch nowhere)")
        let node = root.appendingPathComponent("node")
        let documents = try ClaudeInstalledLaunchConfiguration.documents(nodeExecutable: node,
            payloadRoot: root, nativeSessionID: session)
        let settings = try StrictJSONTransport.object(from: documents.settings)
        let hooks = try #require(settings["hooks"] as? [String: Any])
        #expect(Set(hooks.keys) == ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"])
        for (event, value) in hooks {
            let groups = try #require(value as? [[String: Any]])
            let commands = try #require(groups.first?["hooks"] as? [[String: Any]])
            #expect(commands.first?["command"] as? String == node.path)
            #expect(commands.first?["args"] as? [String] == [root.appendingPathComponent("src/session-v2-hook.mjs").path,
                "--expected-session-id", session.uuidString.lowercased()])
            #expect(commands.first?["timeout"] as? Int == (event == "Stop" ? 660 : 5))
            #expect(commands.first?["asyncRewake"] as? Bool == (event == "Stop" ? true : nil))
            #expect(commands.first?["async"] == nil)
        }
        let mcp = try StrictJSONTransport.object(from: documents.mcp)
        let servers = try #require(mcp["mcpServers"] as? [String: [String: Any]])
        let environment = try #require(servers["blabee-claude"]?["env"] as? [String: String])
        let prefix = ClaudeInstalledLaunchConfiguration.prefix
        #expect(Set(environment.keys) == Set((ClaudeInstalledLaunchConfiguration.publicEnvironmentNames
            + ["HOOK_TOKEN", "BRIDGE_TOKEN"]).map { prefix + $0 }))
        #expect(environment[prefix + "HOOK_TOKEN"] == "")
        for name in ClaudeInstalledLaunchConfiguration.publicEnvironmentNames + ["BRIDGE_TOKEN"] {
            #expect(environment[prefix + name] == "${" + prefix + name + "}")
        }
        let arguments = ClaudeInstalledLaunchConfiguration.arguments(nativeSessionID: session,
            settings: root.appendingPathComponent("settings.json"), mcp: root.appendingPathComponent("mcp.json"))
        #expect(!arguments.contains("--strict-mcp-config"))
        #expect(!arguments.contains("--permission-mode"))
        #expect(arguments == ["--session-id", session.uuidString.lowercased(), "--mcp-config", root.appendingPathComponent("mcp.json").path,
            "--settings", root.appendingPathComponent("settings.json").path])
        #expect(!arguments.contains("--dangerously-load-development-channels"))
        #expect(!String(decoding: documents.mcp, as: UTF8.self).contains("OWNER_TOKEN"))
    }

    @Test("Inherited stale bridge and loader overrides are removed without dropping user MCP variables")
    func environmentIsolation() {
        let value = ClaudeInstalledLaunchConfiguration.cleanEnvironment([
            "BLABEE_OLD": "old", "BLABEE_CLAUDE_SESSION_V2_OWNER_TOKEN": "owner",
            "BLABEE_CLAUDE_SESSION_V2_HOOK_TOKEN": "hook", "NODE_OPTIONS": "bad", "NODE_PATH": "bad",
            "DYLD_INSERT_LIBRARIES": "bad", "__XPC_DYLD_LIBRARY_PATH": "bad", "LD_PRELOAD": "bad",
            "ENV": "bad", "BASH_ENV": "bad", "CLAUDECODE": "1", "HOME": "/somewhere", "MCP_USER_KEY": "retained"])
        #expect(value == ["HOME": "/somewhere", "MCP_USER_KEY": "retained", "MCP_PROTOCOL_NEGOTIATION": "legacy"])
    }

    @Test("Compatibility gates reject old, malformed and unexpected major versions")
    func versionGates() {
        for text in ["2.1.282 (Claude Code)\n", "2.1.283\n", "2.2.0"] {
            #expect(ClaudeInstalledLaunchConfiguration.supportsVersion(Data(text.utf8)))
        }
        for text in ["2.1.247", "2.1.248", "2.1.276", "2.1.281", "3.0.0", "1.99.999", "2.1.282\nextra", "x2.1.282", "2.1.282-preview"] {
            #expect(!ClaudeInstalledLaunchConfiguration.supportsVersion(Data(text.utf8)))
        }
        for text in ["v22.0.0\n", "v24.4.1"] { #expect(ClaudeInstalledLaunchConfiguration.supportsNodeVersion(Data(text.utf8))) }
        for text in ["v20.99.0", "22.0.0", "v22.0.0\nextra"] { #expect(!ClaudeInstalledLaunchConfiguration.supportsNodeVersion(Data(text.utf8))) }
    }

    @Test("Private session-only public files are removed when launch scope ends")
    func configurationCleanup() throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        var files: ClaudeInstalledConfigurationFiles? = try ClaudeInstalledConfigurationFiles(root: root,
            documents: .init(settings: Data("{}".utf8), mcp: Data("{}".utf8)))
        let directory = try #require(files?.directory)
        for (url, expected) in [(directory, mode_t(0o700)), (files!.settings, 0o600), (files!.mcp, 0o600)] {
            var info = stat()
            #expect(lstat(url.path, &info) == 0)
            #expect(info.st_mode & 0o777 == expected)
        }
        files = nil
        #expect(!FileManager.default.fileExists(atPath: directory.path))
    }

    @Test("Canonical launch paths agree with registry realpath and reject aliased owner cwd")
    func canonicalPaths() throws {
        let fixture = try InstalledLauncherFixture()
        defer { fixture.cleanup() }
        #expect(try ClaudeInstalledLaunchConfiguration.canonicalDirectory(fixture.root).path == fixture.root.path)
        let file = fixture.root.appendingPathComponent("file")
        try Data().write(to: file)
        #expect(try ClaudeInstalledLaunchConfiguration.canonicalFile(file).path == file.path)
        let alias = fixture.root.appendingPathComponent("alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.root)
        #expect(try ClaudeInstalledLaunchConfiguration.canonicalDirectory(alias).path == fixture.root.path)
        #expect(throws: CoordinatorError("claude_installed_configuration_invalid")) {
            try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: fixture.socket,
                runtimeIdentity: fixture.identity, canonicalCWD: alias.path, clock: fixture.state.clock)
        }
        #expect(fixture.state.enrollments == 0)
    }

    @Test("Existing unrelated MCP configuration is preserved; Blabee name collision is explicit")
    func mcpCollision() throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let user = root.appendingPathComponent(".claude.json")
        let other = Data("{\"mcpServers\":{\"other\":{\"command\":\"unchanged\"}}}".utf8)
        try other.write(to: user)
        let managed = root.appendingPathComponent("absent-managed.json")
        try ClaudeInstalledLaunchConfiguration.requireNoMCPCollision(cwd: root, environment: ["HOME": root.path], managedConfiguration: managed)
        #expect(try Data(contentsOf: user) == other)
        let project = root.appendingPathComponent(".mcp.json")
        try Data("{\"mcpServers\":{\"blabee-claude\":{\"command\":\"existing\"}}}".utf8).write(to: project)
        #expect(throws: CoordinatorError("claude_installed_mcp_name_collision")) {
            try ClaudeInstalledLaunchConfiguration.requireNoMCPCollision(cwd: root, environment: ["HOME": root.path], managedConfiguration: managed)
        }
        #expect(try Data(contentsOf: user) == other)
    }

    @Test("Git-root local servers and managed MCP policy are checked before registration")
    func inheritedMCPCollision() throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let project = root.appendingPathComponent("repo"), child = project.appendingPathComponent("child")
        try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
        try Data().write(to: project.appendingPathComponent(".git"))
        let custom = root.appendingPathComponent("custom")
        try FileManager.default.createDirectory(at: custom, withIntermediateDirectories: false)
        try JSONSerialization.data(withJSONObject: ["projects": [project.path: [
            "mcpServers": ["blabee-claude": ["command": "existing"]]]]]).write(to: custom.appendingPathComponent(".claude.json"))
        let managed = root.appendingPathComponent("managed.json")
        #expect(throws: CoordinatorError("claude_installed_mcp_name_collision")) {
            try ClaudeInstalledLaunchConfiguration.requireNoMCPCollision(cwd: child,
                environment: ["HOME": root.path, "CLAUDE_CONFIG_DIR": custom.path], managedConfiguration: managed)
        }
        try Data("{\"mcpServers\":{\"other\":{\"command\":\"managed\"}}}".utf8).write(to: managed)
        #expect(throws: CoordinatorError("claude_installed_managed_mcp_configuration_active")) {
            try ClaudeInstalledLaunchConfiguration.requireNoMCPCollision(cwd: child,
                environment: ["HOME": root.path], managedConfiguration: managed)
        }
    }

    @Test("Unexpected large SCM_RIGHTS response is rejected before Darwin externalizes hidden descriptors")
    func unexpectedRightsDoNotLeak() throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("unique-file")
        let descriptor = open(file.path, O_RDWR | O_CREAT | O_EXCL, 0o600)
        guard descriptor >= 0 else { throw installedTestFailure() }
        defer { Darwin.close(descriptor) }
        var identity = stat()
        guard fstat(descriptor, &identity) == 0 else { throw installedTestFailure() }
        var sockets: [Int32] = [-1, -1]
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else { throw installedTestFailure() }
        defer { for value in sockets where value >= 0 { Darwin.close(value) } }
        let aligned = (MemoryLayout<cmsghdr>.size + 3) & ~3
        let count = 128
        var controls = [UInt32](repeating: 0, count: (aligned + count * 4) / 4)
        let frame = Data("{}\n".utf8)
        let sent = controls.withUnsafeMutableBytes { control in
            control.storeBytes(of: cmsghdr(cmsg_len: socklen_t(control.count), cmsg_level: SOL_SOCKET, cmsg_type: SCM_RIGHTS), as: cmsghdr.self)
            for index in 0..<count { control.storeBytes(of: descriptor, toByteOffset: aligned + index * 4, as: Int32.self) }
            return frame.withUnsafeBytes { bytes in
                var vector = iovec(iov_base: UnsafeMutableRawPointer(mutating: bytes.baseAddress!), iov_len: bytes.count)
                return withUnsafeMutablePointer(to: &vector) { pointer in
                    var header = msghdr()
                    header.msg_iov = pointer; header.msg_iovlen = 1
                    header.msg_control = control.baseAddress; header.msg_controllen = socklen_t(control.count)
                    return sendmsg(sockets[1], &header, 0)
                }
            }
        }
        #expect(sent == frame.count)
        #expect(throws: (any Error).self) { try ClaudeInstalledOwnerConnection.readFrameTesting(sockets[0]) }
        Darwin.close(sockets[0]); sockets[0] = -1
        var matches = 0
        // Match our unique temporary inode, not the changing process-wide FD
        // total of other parallel test suites.
        for fd in 0..<Int32(min(getdtablesize(), 16_384)) {
            var info = stat()
            if fstat(fd, &info) == 0, info.st_dev == identity.st_dev, info.st_ino == identity.st_ino { matches += 1 }
        }
        #expect(matches == 1)
    }

    @Test("Terminal source is constant while shell-like paths remain individual argv data")
    func terminalArguments() {
        let path = URL(fileURLWithPath: "/private/tmp/a ' ; $(do-not-run) 한글")
        let options = ClaudeInstalledLauncher.Options(ownerSocketPath: "/private/tmp/o.sock",
            sessionSocketPath: "/private/tmp/s.sock", runtimeIdentity: "sha256:" + String(repeating: "a", count: 64),
            cwd: path, claudeExecutable: path, nodeExecutable: path, payloadRoot: path)
        let arguments = ClaudeInstalledLauncher.terminalArguments(options, coordinatorExecutable: path)
        #expect(arguments.first == path.path)
        #expect(arguments[1] == "claude-installed-launcher")
        #expect(!arguments.contains("--terminal"))
        #expect(!ClaudeInstalledLaunchConfiguration.terminalScript.contains(path.path))
        #expect(ClaudeInstalledLaunchConfiguration.terminalScript.contains("quoted form of"))
        #expect(!ClaudeInstalledLaunchConfiguration.terminalScript.contains("set commandText to \"exec\""))
    }

    @Test("Selected terminal receives only argv data and never consumes an existing window",
           arguments: ClaudeInstalledLauncher.TerminalApplication.allCases)
    func selectedTerminalTransport(terminal: ClaudeInstalledLauncher.TerminalApplication) throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("payload/src")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        for name in ["session-v2-hook.mjs", "session-v2-mcp.mjs", "auto-connect-hook.mjs", "auto-connect-mcp.mjs"] {
            try Data().write(to: source.appendingPathComponent(name))
        }
        let executable = URL(fileURLWithPath: "/usr/bin/true")
        let nativeSessionID = UUID().uuidString.lowercased()
        let options = ClaudeInstalledLauncher.Options(ownerSocketPath: root.appendingPathComponent("owner.sock").path,
            sessionSocketPath: root.appendingPathComponent("session.sock").path,
            runtimeIdentity: "sha256:" + String(repeating: "a", count: 64), cwd: root,
            claudeExecutable: executable, nodeExecutable: executable, payloadRoot: source.deletingLastPathComponent(),
            observeSession: true, claudeArguments: ["--session-id", nativeSessionID])
        var calls = 0
        try ClaudeInstalledLauncher.openInTerminal(options, coordinatorExecutable: executable, terminal: terminal,
            runner: { command, arguments, _ in
                calls += 1
                #expect(command.path == "/usr/bin/osascript")
                #expect(arguments[0] == "-e" && arguments[2] == "--")
                #expect(arguments[1].contains("quoted form of"))
                #expect(!arguments[1].contains(root.path))
                #expect(Array(arguments.suffix(4)) == ["--observe-session", "--", "--session-id", nativeSessionID])
                if terminal == .ghostty {
                    #expect(arguments[3] == root.path)
                    #expect(arguments[1].contains("new surface configuration"))
                    #expect(arguments[1].contains("new window with configuration"))
                    #expect(!arguments[1].contains("do script"))
                } else {
                    #expect(arguments[1] == ClaudeInstalledLaunchConfiguration.terminalScript)
                    #expect(!arguments[1].contains("in selected tab"))
                }
                return .init(exitCode: 0, stdout: Data(), stderr: Data())
            })
        #expect(calls == 1)
    }

    @Test("Denied or uncertain terminal opens are never retried or redirected",
           arguments: ClaudeInstalledLauncher.TerminalApplication.allCases, ["denied", "timeout", "throw"])
    func unconfirmedTerminalOpen(terminal: ClaudeInstalledLauncher.TerminalApplication, outcome: String) throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("payload/src")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        for name in ["session-v2-hook.mjs", "session-v2-mcp.mjs"] {
            try Data().write(to: source.appendingPathComponent(name))
        }
        let executable = URL(fileURLWithPath: "/usr/bin/true")
        let options = ClaudeInstalledLauncher.Options(ownerSocketPath: root.appendingPathComponent("owner.sock").path,
            sessionSocketPath: root.appendingPathComponent("session.sock").path,
            runtimeIdentity: "sha256:" + String(repeating: "a", count: 64), cwd: root,
            claudeExecutable: executable, nodeExecutable: executable, payloadRoot: source.deletingLastPathComponent())
        var calls = 0
        #expect(throws: CoordinatorError("claude_installed_terminal_open_unconfirmed")) {
            try ClaudeInstalledLauncher.openInTerminal(options, coordinatorExecutable: executable, terminal: terminal,
                runner: { _, _, _ in
                    calls += 1
                    if outcome == "throw" { throw installedTestFailure() }
                    return .init(exitCode: outcome == "denied" ? 1 : 0, stdout: Data(), stderr: Data(),
                                 terminationSignal: outcome == "timeout" ? SIGTERM : nil)
                })
        }
        #expect(calls == 1)
    }

    @Test("Owned child closes unrelated descriptors and preserves literal argv, then is reaped")
    func childDescriptorsAndExit() throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let inherited = open("/dev/null", O_RDONLY)
        guard inherited >= 0 else { throw installedTestFailure() }
        defer { Darwin.close(inherited) }
        // Intentionally clear CLOEXEC: the launcher must apply CLOEXEC_DEFAULT.
        #expect(fcntl(inherited, F_SETFD, 0) == 0)
        let output = root.appendingPathComponent("out")
        let out = open(output.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        guard out >= 0 else { throw installedTestFailure() }
        defer { Darwin.close(out) }
        let literal = "literal ' $(no-command) ; 한글"
        let script = "test ! -e /dev/fd/\(inherited) || exit 90; printf '%s' \"$1\"; exit 23"
        let child = try ClaudeInstalledChild(executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", script, "fixture", literal], cwd: root, environment: ["PATH": "/usr/bin:/bin"],
            standardDescriptors: [inherited, out, out])
        defer { child.terminateAndReap() }
        #expect(getpgid(child.pid) == child.pid)
        try child.resume()
        let result = try waitForChild(child)
        #expect(result == 23)
        #expect(try String(contentsOf: output, encoding: .utf8) == literal)
        #expect(try child.pollExit() == 23)
    }

    @Test("A stopped owned child is observed separately from exit and resumes in its original group")
    func childStopIsNotExit() throws {
        let root = try installedTestDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let null = open("/dev/null", O_RDWR)
        guard null >= 0 else { throw installedTestFailure() }
        defer { Darwin.close(null) }
        let child = try ClaudeInstalledChild(executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "kill -STOP $$; exit 7"], cwd: root, environment: ["PATH": "/usr/bin:/bin"],
            standardDescriptors: [null, null, null])
        defer { child.terminateAndReap() }
        try child.resume()
        let deadline = DispatchTime.now().uptimeNanoseconds + 3_000_000_000
        var stopped: Int32?
        while DispatchTime.now().uptimeNanoseconds < deadline {
            #expect(try child.pollExit() == nil)
            stopped = child.takeStopSignal()
            if stopped != nil { break }
            usleep(5_000)
        }
        #expect(stopped == SIGSTOP)
        guard stopped != nil else { throw installedTestFailure() }
        #expect(getpgid(child.pid) == child.pid)
        try child.resume()
        #expect(try waitForChild(child) == 7)
    }

    @Test("Service EOF leaves the existing child alive until its own exit")
    func disconnectDoesNotKillChild() throws {
        let fixture = try InstalledLauncherFixture()
        defer { fixture.cleanup() }
        let connection = try fixture.connect()
        defer { connection.close() }
        let null = open("/dev/null", O_RDWR)
        guard null >= 0 else { throw installedTestFailure() }
        defer { Darwin.close(null) }
        let child = try ClaudeInstalledChild(executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "sleep 30"], cwd: fixture.root, environment: ["PATH": "/usr/bin:/bin"],
            standardDescriptors: [null, null, null])
        defer { child.terminateAndReap() }
        try child.resume()
        let notification = InstalledNotification()
        try connection.startEOFMonitor { notification.notify() }
        fixture.endpoint.stop()
        #expect(notification.ready.wait(timeout: .now() + 3) == .success)
        #expect(try child.pollExit() == nil)
        child.send(SIGTERM)
        #expect(try waitForChild(child) == 128 + SIGTERM)
    }
}

private func waitForChild(_ child: ClaudeInstalledChild) throws -> Int32 {
    let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
    while DispatchTime.now().uptimeNanoseconds < deadline {
        if let result = try child.pollExit() { return result }
        usleep(5_000)
    }
    throw installedTestFailure()
}
private func installedTestDirectory() throws -> URL {
    let url = URL(fileURLWithPath: "/private/tmp/bil-" + UUID().uuidString.lowercased().prefix(10))
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    return url
}
private func installedTestFailure() -> CoordinatorError { CoordinatorError("installed_launcher_fixture_failed") }

private final class InstalledNotification: @unchecked Sendable {
    let ready = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func notify() { lock.withLock { value += 1 }; ready.signal() }
}
private final class InstalledPeerCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    func observe(_ descriptor: Int32) throws -> ClaudeSessionEnrollment.PeerIdentity {
        let value = try ClaudeSessionEnrollment.testingPeer(descriptor)
        return lock.withLock {
            calls += 1
            return ClaudeSessionEnrollment.testingIdentity(pid: value.pid, startTime: value.startTime + (calls > 1 ? 1 : 0))
        }
    }
}
private final class InstalledClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 1_000_000_000_000
    func nowNanoseconds() -> UInt64 { lock.withLock { value } }
    func advance(_ amount: UInt64) { lock.withLock { value += amount } }
}
private final class InstalledEnrollmentState: @unchecked Sendable {
    let clock = InstalledClock()
    let service = UUID()
    let corpus = RuntimeSecretCorpus()
    let hook = String(repeating: "a", count: 64), bridge = String(repeating: "b", count: 64), owner = String(repeating: "c", count: 64)
    let fault: String?
    private let lock = NSLock()
    private var ended: [UUID] = []
    private var enrolled = 0
    private var controls: [String] = []
    init(fault: String?) { self.fault = fault; for value in [hook, bridge, owner] { corpus.register(value) } }
    var disconnected: [UUID] { lock.withLock { ended } }
    var enrollments: Int { lock.withLock { enrolled } }
    var operations: [String] { lock.withLock { controls } }
    func disconnect(_ id: UUID) { lock.withLock { ended.append(id) } }

    func enroll(_ connectionID: UUID, _ request: ClaudeProductWireCodec.Envelope,
                _ deliver: @Sendable (Data) throws -> Void) throws -> Data {
        lock.withLock { enrolled += 1 }
        let requestObject = try StrictJSONTransport.object(from: request.canonicalJSON)
        let payload = requestObject["payload"] as! [String: Any]
        let native = (payload["native_session_id"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
        let authority = ClaudeSessionRegistry.authorityObject(.init(scopeID: UUID(), nativeSessionID: native,
            sessionIncarnation: UUID(), serviceIncarnation: service, ownerConnectionID: connectionID, authorityEpoch: UUID()))
        let project = "claude_project_" + UUID().uuidString.lowercased()
        let session = "claude_session_" + UUID().uuidString.lowercased()
        var roles = ["hook": hook, "bridge": bridge, "owner": owner]
        if fault == "selector" { roles["selector"] = String(repeating: "d", count: 64) }
        if fault == "short_token" { roles["hook"] = "abc" }
        if fault == "duplicate_token" { roles["bridge"] = hook }
        var grantAuthority = authority
        if fault == "wrong_scope" { grantAuthority["scope_id"] = UUID().uuidString.lowercased() }
        if fault == "wrong_native" { grantAuthority["native_session_id"] = UUID().uuidString.lowercased() }
        try deliver(StrictJSONTransport.data(forJSONObject: ["schema_version": "blabee.claude-private-grant.v1",
            "authority": grantAuthority, "core_project_id": project,
            "core_session_id": fault == "wrong_core" ? "claude_session_" + UUID().uuidString.lowercased() : session,
            "role_capabilities": roles]))
        var result: [String: Any] = ["core_session_id": session, "grant_delivery": "private_pipe",
            "grant_pipe_id": payload["grant_pipe_id"]!, "lease": [
                "deadline_nanoseconds": String(clock.nowNanoseconds() + ClaudeSessionAuthority.leaseDurationNanoseconds), "renewal_sequence": "0"]]
        if fault == "secret_response" { result["core_session_id"] = owner }
        var response = requestObject
        response.removeValue(forKey: "payload"); response["kind"] = "response"
        response["authority"] = authority; response["ok"] = true; response["result"] = result
        return try StrictJSONTransport.data(forJSONObject: response)
    }
    func control(_ connectionID: UUID, _ request: ClaudeProductWireCodec.Envelope) throws -> Data {
        lock.withLock { controls.append(request.operation) }
        var response = try StrictJSONTransport.object(from: request.canonicalJSON)
        let payload = response.removeValue(forKey: "payload") as! [String: String]
        response["kind"] = "response"; response["ok"] = true
        if request.operation == "end" { response["result"] = ["ended": true] }
        else { response["result"] = ["lease": [
            "deadline_nanoseconds": String(clock.nowNanoseconds() + ClaudeSessionAuthority.leaseDurationNanoseconds),
            "renewal_sequence": payload["renewal_sequence"]!]] }
        return try StrictJSONTransport.data(forJSONObject: response)
    }
}

private final class InstalledLauncherFixture {
    let root: URL
    let identity = "sha256:" + String(repeating: "f", count: 64)
    let socket: String
    let state: InstalledEnrollmentState
    let endpoint: ClaudeSessionEnrollment
    init(fault: String? = nil) throws {
        root = try installedTestDirectory()
        socket = root.appendingPathComponent("owner.sock").path
        state = InstalledEnrollmentState(fault: fault)
        let state = self.state
        endpoint = try ClaudeSessionEnrollment.makeTesting(socketPath: socket, runtimeIdentity: identity,
            serviceIncarnation: state.service, secretCorpus: state.corpus,
            enroll: { try state.enroll($0, $1, $2) }, control: { try state.control($0, $1) },
            disconnected: { state.disconnect($0) })
        try endpoint.start()
    }
    deinit { cleanup() }
    func cleanup() { endpoint.stop(); try? FileManager.default.removeItem(at: root) }
    func connect(observed: ClaudeInstalledOwnerConnection.ObservedSession? = nil) throws -> ClaudeInstalledOwnerConnection {
        try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: socket, runtimeIdentity: identity,
            canonicalCWD: root.path, observedSession: observed, clock: state.clock)
    }
    func controller(_ connection: ClaudeInstalledOwnerConnection) throws -> ClaudeOwnerRenewalController {
        try ClaudeOwnerRenewalController(identity: connection.identity, initialDeadlineNanoseconds: connection.initialDeadlineNanoseconds,
            clock: state.clock, secretCorpus: connection.secretCorpus, exchange: { try connection.exchange($0) },
            disconnected: { _ in connection.close() })
    }
    func waitForDisconnects(_ count: Int) throws {
        let deadline = DispatchTime.now().uptimeNanoseconds + 3_000_000_000
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if state.disconnected.count == count { return }
            usleep(5_000)
        }
        throw installedTestFailure()
    }
}
#endif

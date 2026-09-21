import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct ClaudeShellFixture: Sendable {
    let home: URL
    let startup: URL
    let coordinator: URL
    let claude: URL
    let firstVersion: URL
    let original: Data?
    var directory: URL { home.appendingPathComponent("Library/Application Support/Blabee/shell/claude-v1") }
    var shim: URL { directory.appendingPathComponent("bin/claude") }

    init(startupBytes: Data? = Data("# User settings\nexport EDITOR=vim\n".utf8),
         customDotDirectory: Bool = false, quotedPaths: Bool = false) throws {
        let name = quotedPaths ? "blabee-claude-auto-' space-$literal-`literal`-" : "blabee-claude-auto-"
        home = URL(fileURLWithPath: "/private/tmp", isDirectory: true).appendingPathComponent(name + UUID().uuidString)
        startup = (customDotDirectory ? home.appendingPathComponent("dot files") : home).appendingPathComponent(".zshrc")
        coordinator = home.appendingPathComponent("app bin/blabee-coordinator")
        claude = home.appendingPathComponent(".local/bin/claude")
        firstVersion = home.appendingPathComponent("releases/first/claude")
        original = startupBytes
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for directory in [startup.deletingLastPathComponent(), coordinator.deletingLastPathComponent(),
                          claude.deletingLastPathComponent(), firstVersion.deletingLastPathComponent()] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        if let startupBytes { try startupBytes.write(to: startup) }
        try Self.executable(coordinator, body: "printf '%s\\0' \"$@\"\nexit 37\n")
        try Self.executable(firstVersion, body: "printf '%s\\0' 'first' \"$@\"\nexit 23\n")
        try FileManager.default.createSymbolicLink(at: claude, withDestinationURL: firstVersion)
    }

    func manager(environment: [String: String] = [:], beforeStartupReplace: (@Sendable () throws -> Void)? = nil) -> ClaudeAutoConnectSetup {
        ClaudeAutoConnectSetup(homeURL: home, environment: environment, coordinatorExecutable: coordinator,
                               claudeExecutable: claude, beforeStartupReplace: beforeStartupReplace)
    }
    func remove() { try? FileManager.default.removeItem(at: home) }
    static func executable(_ path: URL, body: String) throws {
        try Data(("#!/bin/sh\n" + body).utf8).write(to: path)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path.path)
    }
    func backups() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory.appendingPathComponent("backups"), includingPropertiesForKeys: nil)
    }
    func run(_ executable: URL, arguments: [String], environment: [String: String] = [:]) throws -> (Int32, Data, Data) {
        let process = Process(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = ["HOME": home.path, "PATH": "/usr/bin:/bin"] .merging(environment) { _, new in new }
        process.standardOutput = stdout; process.standardError = stderr
        process.currentDirectoryURL = home
        try process.run()
        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let error = stderr.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, output, error)
    }
}

private func claudeShellFields(_ data: Data) -> [String] {
    var fields = String(decoding: data, as: UTF8.self).components(separatedBy: "\0")
    if fields.last == "" { fields.removeLast() }
    return fields
}
private func claudeShellQuote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }

@Suite("Claude automatic shell setup")
struct ClaudeAutoConnectSetupTests {
    @Test("Inspect is read only; enable and disable preserve exact startup bytes", arguments: ["# no newline", "# with newline\n", ""])
    func reversibleStartup(_ source: String) async throws {
        let fixture = try ClaudeShellFixture(startupBytes: Data(source.utf8))
        defer { fixture.remove() }
        let manager = fixture.manager()
        #expect((await manager.inspect()).canEnable)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        let enabled = await manager.enable()
        #expect(enabled.isEnabled, "\(enabled.detail)")
        #expect(enabled.canDisable)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: fixture.claude.path) == fixture.firstVersion.path)
        let startup = try Data(contentsOf: fixture.startup)
        #expect(startup == Data((source + ClaudeAutoConnectSetup.managedBlock(binPath: fixture.shim.deletingLastPathComponent().path)).utf8))
        #expect((await manager.enable()).isEnabled)
        #expect(try Data(contentsOf: fixture.startup) == startup)
        #expect(try fixture.backups().count == 1)
        let disabled = await manager.disable()
        #expect(!disabled.isEnabled && disabled.canEnable)
        #expect(try Data(contentsOf: fixture.startup) == Data(source.utf8))
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
        #expect(!(await manager.disable()).isEnabled)
        #expect(try fixture.backups().count == 2)
        for backup in try fixture.backups() {
            let attributes = try FileManager.default.attributesOfItem(atPath: backup.path)
            #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        }
    }

    @Test("A startup file created by setup is removed only while otherwise empty")
    func missingStartup() async throws {
        let fixture = try ClaudeShellFixture(startupBytes: nil)
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        #expect(!(await fixture.manager().disable()).isEnabled)
        #expect(!FileManager.default.fileExists(atPath: fixture.startup.path))
    }

    @Test("Disable preserves changes before and after the exact managed block", arguments: [true, false])
    func preserveNewEdits(_ originallyMissing: Bool) async throws {
        let fixture = try ClaudeShellFixture(startupBytes: originallyMissing ? nil : Data("# before".utf8))
        defer { fixture.remove() }
        let manager = fixture.manager()
        #expect((await manager.enable()).isEnabled)
        var bytes = Data("# user prefix\n".utf8)
        bytes.append(try Data(contentsOf: fixture.startup))
        bytes.append(Data("alias mine='printf own'\n".utf8))
        try bytes.write(to: fixture.startup)
        #expect((await manager.disable()).canEnable)
        #expect(try Data(contentsOf: fixture.startup) == Data(("# user prefix\n" + (originallyMissing ? "" : "# before") + "alias mine='printf own'\n").utf8))
    }

    @Test("Shim preserves exact argv, quoting, exit status and original updater symlink")
    func quotedShimAndUpdater() async throws {
        let fixture = try ClaudeShellFixture(quotedPaths: true)
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        let arguments = ["--resume", "", "a b", "a'b", "$(do-not-run)", "`do-not-run`", "line\nbreak", "--", "끝"]
        let routed = try fixture.run(fixture.shim, arguments: arguments)
        #expect(routed.0 == 37)
        #expect(claudeShellFields(routed.1) == ["claude-auto-launch", "--claude-bin", fixture.claude.path, "--"] + arguments)
        #expect(routed.2.isEmpty)
        try FileManager.default.removeItem(at: fixture.coordinator)
        let first = try fixture.run(fixture.shim, arguments: arguments)
        #expect(first.0 == 23)
        #expect(claudeShellFields(first.1) == ["first"] + arguments)
        let updated = fixture.home.appendingPathComponent("releases/updated-claude")
        try ClaudeShellFixture.executable(updated, body: "printf '%s\\0' 'updated' \"$@\"\nexit 24\n")
        try FileManager.default.removeItem(at: fixture.claude)
        try FileManager.default.createSymbolicLink(at: fixture.claude, withDestinationURL: updated)
        let second = try fixture.run(fixture.shim, arguments: arguments)
        #expect(second.0 == 24)
        #expect(claudeShellFields(second.1) == ["updated"] + arguments)
        #expect((await fixture.manager().inspect()).canDisable)
        try FileManager.default.removeItem(at: fixture.claude)
        let missing = try fixture.run(fixture.shim, arguments: [])
        #expect(missing.0 == 127)
    }

    @Test("Managed zsh block skips existing aliases or functions with a warning", arguments: ["alias", "function", "none"])
    func zshConflictGuard(_ kind: String) async throws {
        let fixture = try ClaudeShellFixture(quotedPaths: true)
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        let initial: String
        switch kind {
        case "alias": initial = "alias claude='printf alias-ok'\n"
        case "function": initial = "function claude { printf function-ok; }\n"
        default: initial = ""
        }
        let command = initial + "source " + claudeShellQuote(fixture.startup.path)
            + "\nsource " + claudeShellQuote(fixture.startup.path)
            + "\nbuiltin print -rn -- \"$PATH\""
        let result = try fixture.run(URL(fileURLWithPath: "/bin/zsh"), arguments: ["-f", "-c", command])
        #expect(result.0 == 0)
        let path = String(decoding: result.1, as: UTF8.self).components(separatedBy: ":")
        if kind == "none" {
            #expect(path.first == fixture.shim.deletingLastPathComponent().path)
            #expect(path.filter { $0 == fixture.shim.deletingLastPathComponent().path }.count == 1)
            #expect(result.2.isEmpty)
        } else {
            #expect(path == ["/usr/bin", "/bin"])
            #expect(String(decoding: result.2, as: UTF8.self).contains("alias/function exists"))
        }
    }

    @Test("Startup restores shim priority after a user PATH prepend and removes only its own duplicates")
    func inheritedPathOrdering() async throws {
        let fixture = try ClaudeShellFixture(startupBytes: Data("export PATH=\"$HOME/.local/bin:$PATH\"\n".utf8), quotedPaths: true)
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        let bin = fixture.shim.deletingLastPathComponent().path
        let command = "source " + claudeShellQuote(fixture.startup.path) + "\nbuiltin print -rn -- \"$PATH\""
        let inherited = "/usr/bin:" + bin + ":/bin:/usr/bin:" + bin
        let result = try fixture.run(URL(fileURLWithPath: "/bin/zsh"), arguments: ["-f", "-c", command], environment: ["PATH": inherited])
        #expect(result.0 == 0)
        #expect(String(decoding: result.1, as: UTF8.self).components(separatedBy: ":") == [
            bin, fixture.claude.deletingLastPathComponent().path, "/usr/bin", "/bin", "/usr/bin",
        ])
        #expect(result.2.isEmpty)
    }

    @Test("Home-local explicit ZDOTDIR changes only its real startup file")
    func customDotDirectory() async throws {
        let fixture = try ClaudeShellFixture(customDotDirectory: true)
        defer { fixture.remove() }
        let homeStartup = fixture.home.appendingPathComponent(".zshrc")
        let homeBytes = Data("# independent HOME startup\n".utf8)
        try homeBytes.write(to: homeStartup)
        let manager = fixture.manager(environment: ["ZDOTDIR": fixture.startup.deletingLastPathComponent().path])
        #expect((await manager.enable()).isEnabled)
        #expect(try Data(contentsOf: homeStartup) == homeBytes)
        #expect((await manager.disable()).canEnable)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
        #expect(try Data(contentsOf: homeStartup) == homeBytes)
    }

    @Test("Setup refuses unsafe startup and managed paths without changing startup", arguments: [
        "startup-symlink", "startup-hardlink", "startup-permissions", "root-symlink", "root-permissions",
        "foreign-shim", "dynamic-dotdir", "external-dotdir", "relative-dotdir", "empty-dotdir", "oversized-startup",
    ])
    func unsafeSetup(_ variation: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        var environment: [String: String] = [:]
        switch variation {
        case "startup-symlink":
            let target = fixture.home.appendingPathComponent("startup-target")
            try FileManager.default.moveItem(at: fixture.startup, to: target)
            try FileManager.default.createSymbolicLink(at: fixture.startup, withDestinationURL: target)
        case "startup-hardlink": try FileManager.default.linkItem(at: fixture.startup, to: fixture.home.appendingPathComponent("startup-link"))
        case "startup-permissions": try FileManager.default.setAttributes([.posixPermissions: 0o666], ofItemAtPath: fixture.startup.path)
        case "root-symlink":
            try FileManager.default.createDirectory(at: fixture.directory.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let target = fixture.home.appendingPathComponent("managed-target")
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try FileManager.default.createSymbolicLink(at: fixture.directory, withDestinationURL: target)
        case "root-permissions": try FileManager.default.createDirectory(at: fixture.directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o755])
        case "foreign-shim":
            try FileManager.default.createDirectory(at: fixture.shim.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try ClaudeShellFixture.executable(fixture.shim, body: "exit 0\n")
        case "dynamic-dotdir": try Data("export ZDOTDIR=\"$HOME/dots\"\n".utf8).write(to: fixture.home.appendingPathComponent(".zshenv"))
        case "external-dotdir": environment["ZDOTDIR"] = "/private/tmp"
        case "relative-dotdir": environment["ZDOTDIR"] = "dotfiles"
        case "empty-dotdir": environment["ZDOTDIR"] = ""
        default: try Data(repeating: 97, count: 256 * 1_024 + 1).write(to: fixture.startup)
        }
        let bytes = try Data(contentsOf: fixture.startup)
        let result = await fixture.manager(environment: environment).enable()
        #expect(!result.isEnabled && !result.canEnable && !result.canDisable)
        #expect(result.detail == ClaudeAutoConnectSetup.manualReviewDetail)
        #expect(try Data(contentsOf: fixture.startup) == bytes)
    }

    @Test("Edited or duplicate managed content is never treated as owned", arguments: ["shim", "duplicate", "edited-block", "shim-symlink", "shim-hardlink"])
    func ownedContentConflicts(_ variation: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let manager = fixture.manager()
        #expect((await manager.enable()).isEnabled)
        switch variation {
        case "shim":
            var bytes = try Data(contentsOf: fixture.shim); bytes.append(Data("# user modification\n".utf8)); try bytes.write(to: fixture.shim)
        case "duplicate":
            var bytes = try Data(contentsOf: fixture.startup)
            bytes.append(Data(ClaudeAutoConnectSetup.managedBlock(binPath: fixture.shim.deletingLastPathComponent().path).utf8))
            try bytes.write(to: fixture.startup)
        case "edited-block":
            let text = try String(contentsOf: fixture.startup, encoding: .utf8).replacingOccurrences(of: "    export PATH\n", with: "    export OTHER_PATH\n")
            try Data(text.utf8).write(to: fixture.startup)
        case "shim-symlink":
            let target = fixture.directory.appendingPathComponent("user-shim")
            try FileManager.default.moveItem(at: fixture.shim, to: target)
            try FileManager.default.createSymbolicLink(at: fixture.shim, withDestinationURL: target)
        default: try FileManager.default.linkItem(at: fixture.shim, to: fixture.directory.appendingPathComponent("shim-link"))
        }
        let startup = try Data(contentsOf: fixture.startup), shim = try Data(contentsOf: fixture.shim)
        #expect((await manager.disable()).detail == ClaudeAutoConnectSetup.manualReviewDetail)
        #expect(try Data(contentsOf: fixture.startup) == startup)
        #expect(try Data(contentsOf: fixture.shim) == shim)
    }

    @Test("Concurrent editor changes before replacement are preserved")
    func editorRace() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let updated = Data("# concurrently saved user settings\n".utf8)
        let manager = fixture.manager(beforeStartupReplace: { try updated.write(to: fixture.startup, options: .atomic) })
        #expect((await manager.enable()).detail == ClaudeAutoConnectSetup.manualReviewDetail)
        #expect(try Data(contentsOf: fixture.startup) == updated)
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
        #expect((await fixture.manager().inspect()).canEnable)
    }

    @Test("Concurrent setup managers share a lock and do not duplicate the managed block")
    func concurrentEnable() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let first = fixture.manager(), second = fixture.manager()
        async let a = first.enable()
        async let b = second.enable()
        let results = await [a, b]
        #expect(results.allSatisfy { $0.isEnabled })
        #expect((await fixture.manager().inspect()).isEnabled)
        #expect(try fixture.backups().count == 1)
        #expect((await first.disable()).canEnable)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
    }
}

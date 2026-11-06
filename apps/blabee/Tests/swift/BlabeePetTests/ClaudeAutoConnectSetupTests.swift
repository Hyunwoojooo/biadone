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

    func manager(environment: [String: String] = [:], requiresInstalledRuntime: Bool = false,
                 loginShell: String? = "/bin/zsh",
                 claudeCandidates: (@Sendable () -> [URL])? = nil,
                 beforeStartupReplace: (@Sendable () throws -> Void)? = nil) -> ClaudeAutoConnectSetup {
        ClaudeAutoConnectSetup(homeURL: home, environment: environment, coordinatorExecutable: coordinator,
                               claudeExecutable: claude, requiresInstalledRuntime: requiresInstalledRuntime,
                               loginShell: loginShell, claudeCandidates: claudeCandidates,
                               beforeStartupReplace: beforeStartupReplace)
    }
    func remove() { try? FileManager.default.removeItem(at: home) }
    static func executable(_ path: URL, body: String) throws {
        try Data(("#!/bin/sh\n" + body).utf8).write(to: path)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path.path)
    }
    func backups() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory.appendingPathComponent("backups"), includingPropertiesForKeys: nil)
    }
    func writeOrphanedBlock(suffix: String = "", legacy: Bool = false) throws -> Data {
        var bytes = original ?? Data()
        let bin = shim.deletingLastPathComponent().path
        bytes.append(Data((legacy ? claudeLegacyManagedBlock(binPath: bin)
            : ClaudeAutoConnectSetup.managedBlock(binPath: bin)).utf8))
        bytes.append(Data(suffix.utf8))
        try bytes.write(to: startup)
        return bytes
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

/// Fixed pre-migration bytes from the 2026-10-20 before snapshot. Keep this
/// independent of the current generator so changing it cannot bless old bytes.
private func claudeLegacyManagedBlock(binPath: String) -> String {
    let bin = claudeShellQuote(binPath), shim = claudeShellQuote(binPath + "/claude")
    return "\n# >>> Blabee Claude Auto Connect v1 >>>\n"
        + "if (( ${+aliases[claude]} || ${+functions[claude]} )); then\n"
        + "  builtin print -ru2 -- '[Blabee] claude alias/function exists; automatic connection was skipped.'\n"
        + "elif [[ -x " + shim + " ]]; then\n"
        + "  () {\n    builtin emulate -L zsh\n"
        + "    local _blabee_claude_entry\n    local -a _blabee_claude_remaining=()\n"
        + "    for _blabee_claude_entry in \"${path[@]}\"; do\n"
        + "      [[ \"$_blabee_claude_entry\" == " + bin + " ]] || _blabee_claude_remaining+=(\"$_blabee_claude_entry\")\n"
        + "    done\n    path=(" + bin + " \"${_blabee_claude_remaining[@]}\")\n"
        + "    export PATH\n  }\nfi\n# <<< Blabee Claude Auto Connect v1 <<<\n"
}

@Suite("Claude automatic shell setup", .petLanguage(.korean))
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
        #expect(enabled.canLaunch)
        #expect(enabled.shellName == "zsh")
        #expect(enabled.automaticConnectionReady && enabled.savedExecutableAvailable && enabled.issue == nil)
        #expect(enabled.detail.contains("설정이 저장되었습니다"))
        #expect(enabled.detail.contains("연결 여부는 별도로 확인"))
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: fixture.claude.path) == fixture.firstVersion.path)
        let startup = try Data(contentsOf: fixture.startup)
        #expect(startup == Data((source + ClaudeAutoConnectSetup.managedBlock(binPath: fixture.shim.deletingLastPathComponent().path)).utf8))
        #expect((await manager.enable()).isEnabled)
        #expect(try Data(contentsOf: fixture.startup) == startup)
        #expect(try fixture.backups().count == 1)
        let disabled = await manager.disable()
        #expect(!disabled.isEnabled && disabled.canEnable)
        #expect(!disabled.automaticConnectionReady)
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

    @Test("Inspecting an exact orphan block is read only and offers explicit repair", arguments: [true, false])
    func orphanInspectionIsReadOnly(_ managedDirectoryExists: Bool) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let bytes = try fixture.writeOrphanedBlock(suffix: "# Other user settings\n")
        if managedDirectoryExists {
            try FileManager.default.createDirectory(at: fixture.shim.deletingLastPathComponent(),
                withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        let before = try FileManager.default.attributesOfItem(atPath: fixture.startup.path)
        let manager = fixture.manager()
        for _ in 0..<2 {
            let result = await manager.inspect()
            #expect(!result.isEnabled && result.canEnable && !result.canDisable && result.canLaunch)
            #expect(!result.automaticConnectionReady && result.issue == nil)
        }
        let after = try FileManager.default.attributesOfItem(atPath: fixture.startup.path)
        #expect(try Data(contentsOf: fixture.startup) == bytes)
        #expect(before[.systemFileNumber] as? NSNumber == after[.systemFileNumber] as? NSNumber)
        #expect(before[.modificationDate] as? Date == after[.modificationDate] as? Date)
        #expect(FileManager.default.fileExists(atPath: fixture.directory.path) == managedDirectoryExists)
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.appendingPathComponent(".setup.lock").path))
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.appendingPathComponent("backups").path))
    }

    @Test("Explicit orphan repair restores one shim without duplicating the block or removing user content", arguments: [true, false])
    func restoreOrphanedBlock(_ originallyMissing: Bool) async throws {
        let fixture = try ClaudeShellFixture(startupBytes: originallyMissing ? nil : Data("# User prefix\n".utf8))
        defer { fixture.remove() }
        let suffix = originallyMissing ? "" : "alias mine='printf own'\n"
        let bytes = try fixture.writeOrphanedBlock(suffix: suffix)
        let manager = fixture.manager()
        let restored = await manager.enable()
        #expect(restored.isEnabled && restored.canDisable && restored.automaticConnectionReady)
        #expect(try Data(contentsOf: fixture.startup) == bytes)
        #expect(try fixture.backups().count == 1)
        let shim = try Data(contentsOf: fixture.shim)
        let inode = try FileManager.default.attributesOfItem(atPath: fixture.shim.path)[.systemFileNumber] as? NSNumber
        #expect((await manager.enable()).automaticConnectionReady)
        #expect((await manager.inspect()).automaticConnectionReady)
        #expect(try Data(contentsOf: fixture.startup) == bytes)
        #expect(try Data(contentsOf: fixture.shim) == shim)
        #expect(try FileManager.default.attributesOfItem(atPath: fixture.shim.path)[.systemFileNumber] as? NSNumber == inode)
        #expect(try fixture.backups().count == 1)
        #expect((await manager.disable()).canEnable)
        var expected = fixture.original ?? Data()
        expected.append(Data(suffix.utf8))
        // A missing shim cannot prove the old startup-origin flag. Preserve the
        // already-present startup file even when removing its block leaves it empty.
        #expect(try Data(contentsOf: fixture.startup) == expected)
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
    }

    @Test("Orphan repair refuses edited, duplicate, foreign, or unsafe configuration", arguments: [
        "edited", "duplicate", "foreign-block", "foreign-reference", "foreign-shim", "startup-permissions", "startup-symlink",
    ])
    func orphanRepairRejectsUnownedContent(_ variation: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        var source = String(decoding: try fixture.writeOrphanedBlock(), as: UTF8.self)
        switch variation {
        case "edited": source = source.replacingOccurrences(of: "    export PATH\n", with: "    export OTHER_PATH\n")
        case "duplicate": source += ClaudeAutoConnectSetup.managedBlock(binPath: fixture.shim.deletingLastPathComponent().path)
        case "foreign-block": source = ClaudeAutoConnectSetup.managedBlock(binPath: fixture.home.appendingPathComponent("foreign-bin").path)
        case "foreign-reference": source += "# shell/claude-v1/foreign\n"
        default: break
        }
        try Data(source.utf8).write(to: fixture.startup)
        if variation == "foreign-shim" {
            try FileManager.default.createDirectory(at: fixture.shim.deletingLastPathComponent(),
                withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try ClaudeShellFixture.executable(fixture.shim, body: "exit 0\n")
        } else if variation == "startup-permissions" {
            try FileManager.default.setAttributes([.posixPermissions: 0o666], ofItemAtPath: fixture.startup.path)
        } else if variation == "startup-symlink" {
            let target = fixture.home.appendingPathComponent("startup-target")
            try FileManager.default.moveItem(at: fixture.startup, to: target)
            try FileManager.default.createSymbolicLink(at: fixture.startup, withDestinationURL: target)
        }
        let shim = try? Data(contentsOf: fixture.shim)
        let manager = fixture.manager()
        for result in [await manager.inspect(), await manager.enable(), await manager.disable()] {
            #expect(!result.isEnabled && !result.canEnable && !result.canDisable && result.canLaunch)
            #expect(result.issue == .manualReview)
        }
        #expect(try Data(contentsOf: fixture.startup) == Data(source.utf8))
        #expect((try? Data(contentsOf: fixture.shim)) == shim)
    }

    @Test("An editor race during orphan repair preserves user changes and rolls back only the exact new shim", arguments: [
        "user-content", "edited-block", "removed-block", "foreign-shim",
    ])
    func orphanRepairPreservesConcurrentChanges(_ variation: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let original = try fixture.writeOrphanedBlock()
        let updated: Data
        if variation == "edited-block" {
            updated = Data(String(decoding: original, as: UTF8.self)
                .replacingOccurrences(of: "    export PATH\n", with: "    export OTHER_PATH\n").utf8)
        } else if variation == "removed-block" {
            updated = Data("# Concurrently saved user settings\n".utf8)
        } else {
            updated = original + Data("# Concurrently saved user suffix\n".utf8)
        }
        let foreignShim = Data("#!/bin/sh\n# Concurrent replacement\nexit 0\n".utf8)
        let manager = fixture.manager(beforeStartupReplace: {
            try updated.write(to: fixture.startup, options: .atomic)
            if variation == "foreign-shim" { try foreignShim.write(to: fixture.shim, options: .atomic) }
        })
        let result = await manager.enable()
        #expect(!result.isEnabled && !result.canEnable && result.issue == .manualReview)
        #expect(try Data(contentsOf: fixture.startup) == updated)
        if variation == "foreign-shim" {
            #expect(try Data(contentsOf: fixture.shim) == foreignShim)
        } else {
            #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
        }
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

    @Test("Login PATH changes still route exact arguments without changing the caller PATH", arguments: ["prepend", "reset"])
    func loginPathChanges(_ change: String) async throws {
        let fixture = try ClaudeShellFixture(quotedPaths: true)
        defer { fixture.remove() }
        let login = change == "prepend" ? "export PATH=\"$HOME/.local/bin:$PATH\"\n"
            : "export PATH=\"$HOME/.local/bin:/usr/bin:/bin\"\n"
        try Data(login.utf8).write(to: fixture.home.appendingPathComponent(".zlogin"))
        #expect((await fixture.manager().enable()).automaticConnectionReady)
        let arguments = ["--resume", "", "a b", "a'b", "$(do-not-run)", "`do-not-run`", "line\nbreak", "--", "끝"]
        let command = "before=$PATH\nclaude \"$@\"\nresult=$?\nbuiltin printf '%s\\0' \"$before\" \"$PATH\"\nexit \"$result\""
        let result = try fixture.run(URL(fileURLWithPath: "/bin/zsh"),
            arguments: ["-d", "-l", "-i", "-c", command, "blabee-shell-fixture"] + arguments,
            environment: ["ZDOTDIR": fixture.home.path, "TERM": "dumb"])
        let fields = claudeShellFields(result.1)
        #expect(result.0 == 37)
        #expect(Array(fields.dropLast(2)) == ["claude-auto-launch", "--claude-bin", fixture.claude.path, "--"] + arguments)
        let paths = Array(fields.suffix(2))
        #expect(paths.count == 2 && paths.first == paths.last)
        #expect(paths.first?.components(separatedBy: ":").first == fixture.claude.deletingLastPathComponent().path)
        if change == "reset" {
            #expect(paths.first == fixture.claude.deletingLastPathComponent().path + ":/usr/bin:/bin")
        }
        #expect(result.2.isEmpty)
    }

    @Test("User aliases and either function syntax survive before or after setup and re-sourcing",
          arguments: ["alias", "short-function", "function"])
    func userDefinitionsSurviveResourcing(_ kind: String) async throws {
        let definition: String
        if kind == "alias" {
            definition = "alias claude='builtin printf \"%s\\0\" user-alias'\n"
        } else {
            let declaration = kind == "short-function" ? "claude()" : "function claude"
            definition = declaration + " { builtin printf '%s\\0' user-function \"$@\"; return 43; }\n"
        }
        for after in [false, true] {
            let fixture = try ClaudeShellFixture(startupBytes: Data((after ? "# User settings\n" : definition).utf8),
                                                quotedPaths: true)
            defer { fixture.remove() }
            #expect((await fixture.manager().enable()).automaticConnectionReady)
            if after { try Data(definition.utf8).write(to: fixture.home.appendingPathComponent(".zlogin")) }
            let command = "source " + claudeShellQuote(fixture.startup.path)
                + "\nsource " + claudeShellQuote(fixture.startup.path) + "\nclaude \"$@\""
            let arguments = ["", "literal $(unchanged)", "a'b"]
            let result = try fixture.run(URL(fileURLWithPath: "/bin/zsh"),
                arguments: ["-d", "-l", "-i", "-c", command, "blabee-shell-fixture"] + arguments,
                environment: ["ZDOTDIR": fixture.home.path, "TERM": "dumb"])
            #expect(result.0 == (kind == "alias" ? 0 : 43))
            #expect(claudeShellFields(result.1) == [kind == "alias" ? "user-alias" : "user-function"] + arguments)
            #expect(String(decoding: result.2, as: UTF8.self).contains("alias/function exists"))
        }
    }

    @Test("A function retained in an open shell finds upstream after the managed shim disappears")
    func retainedFunctionAfterShimRemoval() async throws {
        let fixture = try ClaudeShellFixture(quotedPaths: true)
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).automaticConnectionReady)
        let arguments = ["--resume", "", "literal $HOME", "a'b"]
        // This fixture removes only its temporary shim in the same shell.
        // Production disable's exact ownership/removal is checked separately.
        let command = "source " + claudeShellQuote(fixture.startup.path)
            + "\nPATH=" + claudeShellQuote(fixture.claude.deletingLastPathComponent().path + ":/usr/bin:/bin")
            + "\n/bin/rm -- " + claudeShellQuote(fixture.shim.path)
            + "\n(( ${+functions[claude]} )) || exit 90\nclaude \"$@\""
        let result = try fixture.run(URL(fileURLWithPath: "/bin/zsh"),
            arguments: ["-f", "-c", command, "blabee-shell-fixture"] + arguments)
        #expect(result.0 == 23)
        #expect(claudeShellFields(result.1) == ["first"] + arguments)
        #expect(result.2.isEmpty)
    }

    @Test("Legacy setup inspection is read only and explicit migration preserves its location and shim")
    func legacyInspectionAndMigration() async throws {
        let fixture = try ClaudeShellFixture(startupBytes: Data("# User prefix without newline".utf8), quotedPaths: true)
        defer { fixture.remove() }
        let manager = fixture.manager()
        #expect((await manager.enable()).automaticConnectionReady)
        let suffix = "# User suffix\nalias mine='printf own'\n"
        let legacy = try fixture.writeOrphanedBlock(suffix: suffix, legacy: true)
        let startupMetadata = try FileManager.default.attributesOfItem(atPath: fixture.startup.path)
        let shim = try Data(contentsOf: fixture.shim)
        let shimInode = try FileManager.default.attributesOfItem(atPath: fixture.shim.path)[.systemFileNumber] as? NSNumber
        for _ in 0..<2 {
            let observed = await manager.inspect()
            #expect(observed.isEnabled && observed.canEnable && observed.canDisable && observed.canLaunch)
            #expect(observed.needsSetupRefresh && !observed.automaticConnectionReady && observed.issue == nil)
        }
        #expect(try Data(contentsOf: fixture.startup) == legacy)
        let afterInspect = try FileManager.default.attributesOfItem(atPath: fixture.startup.path)
        #expect(afterInspect[.systemFileNumber] as? NSNumber == startupMetadata[.systemFileNumber] as? NSNumber)
        #expect(afterInspect[.modificationDate] as? Date == startupMetadata[.modificationDate] as? Date)
        #expect(try fixture.backups().count == 1)
        let migrated = await manager.enable()
        #expect(migrated.isEnabled && migrated.canDisable && !migrated.canEnable)
        #expect(migrated.automaticConnectionReady && !migrated.needsSetupRefresh)
        let expected = (fixture.original ?? Data())
            + Data(ClaudeAutoConnectSetup.managedBlock(binPath: fixture.shim.deletingLastPathComponent().path).utf8)
            + Data(suffix.utf8)
        #expect(try Data(contentsOf: fixture.startup) == expected)
        #expect(try Data(contentsOf: fixture.shim) == shim)
        #expect(try FileManager.default.attributesOfItem(atPath: fixture.shim.path)[.systemFileNumber] as? NSNumber == shimInode)
        #expect(try fixture.backups().count == 2)
        #expect((await manager.enable()).automaticConnectionReady)
        #expect(try Data(contentsOf: fixture.startup) == expected)
        #expect(try fixture.backups().count == 2)
        #expect((await manager.disable()).canEnable)
        #expect(try Data(contentsOf: fixture.startup) == (fixture.original ?? Data()) + Data(suffix.utf8))
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
    }

    @Test("A legacy migration editor race preserves the original shim and the new user bytes")
    func legacyMigrationEditorRace() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).automaticConnectionReady)
        let legacy = try fixture.writeOrphanedBlock(legacy: true)
        let shim = try Data(contentsOf: fixture.shim)
        let inode = try FileManager.default.attributesOfItem(atPath: fixture.shim.path)[.systemFileNumber] as? NSNumber
        let updated = legacy + Data("# Concurrent user edit\n".utf8)
        let manager = fixture.manager(beforeStartupReplace: { try updated.write(to: fixture.startup, options: .atomic) })
        let result = await manager.enable()
        #expect(!result.isEnabled && result.issue == .manualReview)
        #expect(try Data(contentsOf: fixture.startup) == updated)
        #expect(try Data(contentsOf: fixture.shim) == shim)
        #expect(try FileManager.default.attributesOfItem(atPath: fixture.shim.path)[.systemFileNumber] as? NSNumber == inode)
        #expect((await fixture.manager().inspect()).needsSetupRefresh)
    }

    @Test("An orphan legacy block is explicitly repaired and migrated without duplicating user content")
    func legacyOrphanRepair() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let suffix = "# User suffix\n"
        let legacy = try fixture.writeOrphanedBlock(suffix: suffix, legacy: true)
        let manager = fixture.manager()
        let observed = await manager.inspect()
        #expect(!observed.isEnabled && observed.canEnable && !observed.canDisable && !observed.automaticConnectionReady)
        #expect(try Data(contentsOf: fixture.startup) == legacy)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        let repaired = await manager.enable()
        #expect(repaired.automaticConnectionReady && !repaired.needsSetupRefresh)
        let expected = (fixture.original ?? Data())
            + Data(ClaudeAutoConnectSetup.managedBlock(binPath: fixture.shim.deletingLastPathComponent().path).utf8)
            + Data(suffix.utf8)
        #expect(try Data(contentsOf: fixture.startup) == expected)
        #expect((await manager.enable()).automaticConnectionReady)
        #expect(try fixture.backups().count == 1)
        #expect((await manager.disable()).canEnable)
        #expect(try Data(contentsOf: fixture.startup) == (fixture.original ?? Data()) + Data(suffix.utf8))
    }

    @Test("Legacy refresh stays unavailable for unsupported shells or an unavailable saved CLI",
          arguments: ["unsupported-shell", "saved-cli"])
    func legacyRefreshReadiness(_ variation: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).automaticConnectionReady)
        let legacy = try fixture.writeOrphanedBlock(legacy: true)
        let shim = try Data(contentsOf: fixture.shim)
        let manager: ClaudeAutoConnectSetup
        if variation == "saved-cli" {
            try FileManager.default.removeItem(at: fixture.firstVersion)
            let replacement = fixture.home.appendingPathComponent("replacement-claude")
            try ClaudeShellFixture.executable(replacement, body: "exit 0\n")
            manager = ClaudeAutoConnectSetup(homeURL: fixture.home, coordinatorExecutable: fixture.coordinator,
                                             claudeExecutable: replacement)
        } else {
            manager = fixture.manager(environment: ["SHELL": "/bin/bash"])
        }
        for result in [await manager.inspect(), await manager.enable()] {
            #expect(result.isEnabled && result.canDisable && result.canLaunch && !result.canEnable)
            #expect(result.needsSetupRefresh && !result.automaticConnectionReady)
            #expect(result.issue == (variation == "saved-cli" ? .savedExecutableUnavailable : .unsupportedShell))
        }
        #expect(try Data(contentsOf: fixture.startup) == legacy)
        #expect(try Data(contentsOf: fixture.shim) == shim)
        #expect(try fixture.backups().count == 1)
        #expect(!(await manager.disable()).isEnabled)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
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
        #expect(result.canLaunch)
        #expect(!result.automaticConnectionReady && result.issue == .manualReview)
        #expect(result.detail.hasPrefix(ClaudeAutoConnectSetup.manualReviewDetail))
        #expect(result.detail.contains("새 Claude 세션을 열 수 있습니다"))
        #expect(try Data(contentsOf: fixture.startup) == bytes)
    }

    @Test("Edited or duplicate managed content is never treated as owned", arguments: [
        "shim", "duplicate", "edited-block", "shim-symlink", "shim-hardlink",
        "mixed-blocks", "legacy-duplicate", "legacy-edited",
    ])
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
        case "mixed-blocks":
            let bytes = try Data(contentsOf: fixture.startup)
                + Data(claudeLegacyManagedBlock(binPath: fixture.shim.deletingLastPathComponent().path).utf8)
            try bytes.write(to: fixture.startup)
        case "legacy-duplicate":
            let block = claudeLegacyManagedBlock(binPath: fixture.shim.deletingLastPathComponent().path)
            _ = try fixture.writeOrphanedBlock(suffix: block, legacy: true)
        case "legacy-edited":
            let bytes = try fixture.writeOrphanedBlock(legacy: true)
            let text = String(decoding: bytes, as: UTF8.self)
                .replacingOccurrences(of: "    export PATH\n", with: "    export OTHER_PATH\n")
            try Data(text.utf8).write(to: fixture.startup)
        case "shim-symlink":
            let target = fixture.directory.appendingPathComponent("user-shim")
            try FileManager.default.moveItem(at: fixture.shim, to: target)
            try FileManager.default.createSymbolicLink(at: fixture.shim, withDestinationURL: target)
        default: try FileManager.default.linkItem(at: fixture.shim, to: fixture.directory.appendingPathComponent("shim-link"))
        }
        let startup = try Data(contentsOf: fixture.startup), shim = try Data(contentsOf: fixture.shim)
        #expect((await manager.inspect()).issue == .manualReview)
        #expect((await manager.enable()).issue == .manualReview)
        #expect((await manager.disable()).detail.hasPrefix(ClaudeAutoConnectSetup.manualReviewDetail))
        let otherShell = fixture.manager(environment: ["SHELL": "/bin/bash"])
        #expect(!(await otherShell.inspect()).canDisable)
        #expect((await otherShell.disable()).detail.hasPrefix(ClaudeAutoConnectSetup.manualReviewDetail))
        #expect(try Data(contentsOf: fixture.startup) == startup)
        #expect(try Data(contentsOf: fixture.shim) == shim)
    }

    @Test("Concurrent editor changes before replacement are preserved")
    func editorRace() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let updated = Data("# concurrently saved user settings\n".utf8)
        let manager = fixture.manager(beforeStartupReplace: { try updated.write(to: fixture.startup, options: .atomic) })
        #expect((await manager.enable()).detail.hasPrefix(ClaudeAutoConnectSetup.manualReviewDetail))
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

    @Test("Other and unknown shells keep startup untouched while allowing direct launch", arguments: [
        "/bin/bash", "/opt/homebrew/bin/fish", "zsh", "", "/bin/zsh\n",
    ])
    func unsupportedShellCanLaunch(_ shell: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let manager = fixture.manager(environment: ["SHELL": shell])
        for result in [await manager.inspect(), await manager.enable(), await manager.disable()] {
            #expect(!result.isEnabled && !result.canEnable && !result.canDisable)
            #expect(result.canLaunch)
            #expect(!result.automaticConnectionReady && result.issue == .unsupportedShell)
            #expect(result.detail.contains("새 Claude 세션을 열 수 있습니다"))
        }
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
    }

    @Test("Changing the account shell preserves exact-owned setup and explicit cleanup", arguments: ["/bin/bash", ""])
    func changedShellPreservesCleanup(_ shell: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        let startup = try Data(contentsOf: fixture.startup), shim = try Data(contentsOf: fixture.shim)
        let manager = fixture.manager(environment: ["SHELL": shell])
        for inspection in [await manager.inspect(), await manager.enable()] {
            #expect(inspection.isEnabled && inspection.canDisable && !inspection.canEnable)
            #expect(inspection.canLaunch)
            #expect(!inspection.automaticConnectionReady && inspection.issue == .unsupportedShell)
            #expect(inspection.detail.contains("저장된 설정은 zsh용"))
        }
        #expect(try Data(contentsOf: fixture.startup) == startup)
        #expect(try Data(contentsOf: fixture.shim) == shim)
        let disabled = await manager.disable()
        #expect(!disabled.isEnabled && !disabled.canDisable && !disabled.canEnable && disabled.canLaunch)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
        #expect(!FileManager.default.fileExists(atPath: fixture.shim.path))
    }

    @Test("Missing GUI shell uses an injected account shell without reading the real account")
    func accountShellFallback() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let supported = await fixture.manager(loginShell: "/bin/zsh").inspect()
        #expect(supported.canEnable && supported.canLaunch && supported.shellName == "zsh")
        let other = await fixture.manager(loginShell: "/bin/bash").inspect()
        #expect(!other.canEnable && other.canLaunch && other.shellName == "bash")
        let unknown = await fixture.manager(loginShell: nil).inspect()
        #expect(!unknown.canEnable && unknown.canLaunch && unknown.shellName == "알 수 없는 셸")
        let explicit = await fixture.manager(environment: ["SHELL": "/bin/bash"], loginShell: "/bin/zsh").inspect()
        #expect(!explicit.canEnable && explicit.shellName == "bash")
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
    }

    @Test("An unavailable installed runtime is rejected before saving shell configuration")
    func unavailableInstalledRuntime() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let manager = fixture.manager(requiresInstalledRuntime: true)
        let inspection = await manager.inspect()
        #expect(!inspection.isEnabled && !inspection.canEnable && !inspection.canLaunch)
        #expect(!inspection.automaticConnectionReady && inspection.issue == .installedRuntimeUnavailable)
        let result = await manager.enable()
        #expect(!result.isEnabled && !result.canEnable && !result.canLaunch)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
    }

    @Test("Saved setup does not hide an unavailable runtime or executable", arguments: ["runtime", "coordinator", "claude"])
    func savedSetupRevalidatesLaunch(_ missing: String) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        let startup = try Data(contentsOf: fixture.startup)
        if missing == "coordinator" { try FileManager.default.removeItem(at: fixture.coordinator) }
        if missing == "claude" { try FileManager.default.removeItem(at: fixture.firstVersion) }
        let manager = fixture.manager(requiresInstalledRuntime: missing == "runtime")
        let result = await manager.inspect()
        #expect(result.isEnabled && result.canDisable && !result.canEnable && !result.canLaunch)
        #expect(!result.automaticConnectionReady)
        #expect(result.issue == (missing == "runtime" ? .installedRuntimeUnavailable : .executableUnavailable))
        #expect(try Data(contentsOf: fixture.startup) == startup)
        let disabled = await manager.disable()
        #expect(!disabled.isEnabled && !disabled.canEnable && !disabled.canLaunch)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
    }

    @Test("A newly discovered CLI can launch even when the saved shim points at an old missing CLI")
    func savedExecutableDiffersFromDiscoveredCLI() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        #expect((await fixture.manager().enable()).isEnabled)
        let startup = try Data(contentsOf: fixture.startup), shim = try Data(contentsOf: fixture.shim)
        try FileManager.default.removeItem(at: fixture.firstVersion)
        let newClaude = fixture.home.appendingPathComponent("new-claude")
        try ClaudeShellFixture.executable(newClaude, body: "exit 0\n")
        let manager = ClaudeAutoConnectSetup(homeURL: fixture.home, coordinatorExecutable: fixture.coordinator,
            claudeExecutable: newClaude)
        let result = await manager.inspect()
        #expect(result.isEnabled && result.canDisable && result.canLaunch)
        #expect(!result.savedExecutableAvailable && !result.automaticConnectionReady)
        #expect(result.issue == .savedExecutableUnavailable)
        #expect(result.detail.contains("이전에 설정한 Claude 실행 파일"))
        #expect(!(await manager.enable()).automaticConnectionReady)
        #expect(try Data(contentsOf: fixture.startup) == startup)
        #expect(try Data(contentsOf: fixture.shim) == shim)
    }

    @Test("The same setup actor discovers a newly installed CLI and preserves its public symlink", arguments: [true, false])
    func refreshAfterInstallation(_ inspectBeforeEnable: Bool) async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        try FileManager.default.removeItem(at: fixture.firstVersion)
        let newPublicPath = fixture.home.appendingPathComponent("other-bin/claude")
        let newTarget = fixture.home.appendingPathComponent("releases/new-claude")
        let manager = fixture.manager(claudeCandidates: { [fixture.claude, newPublicPath] })
        let missing = await manager.inspect()
        #expect(!missing.canLaunch && !missing.canEnable)
        #expect(!missing.automaticConnectionReady && missing.issue == .executableUnavailable)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        try FileManager.default.createDirectory(at: newPublicPath.deletingLastPathComponent(),
            withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try ClaudeShellFixture.executable(newTarget, body: "exit 0\n")
        try FileManager.default.createSymbolicLink(at: newPublicPath, withDestinationURL: newTarget)
        if inspectBeforeEnable {
            let refreshed = await manager.inspect()
            #expect(refreshed.canLaunch && refreshed.canEnable && !refreshed.isEnabled)
            #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        }
        let enabled = await manager.enable()
        #expect(enabled.isEnabled && enabled.canLaunch)
        #expect(enabled.automaticConnectionReady && enabled.issue == nil)
        #expect(try Data(contentsOf: fixture.shim) == ClaudeAutoConnectSetup.shimBytes(
            coordinator: fixture.coordinator.path, claude: newPublicPath.path,
            startup: fixture.startup.path, originallyMissing: false))
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: newPublicPath.path) == newTarget.path)
        #expect((await manager.disable()).canEnable)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
    }

    @Test("A cancelled caller cannot create automatic shell setup when its actor call starts")
    func cancelledBeforeEnable() async throws {
        let fixture = try ClaudeShellFixture()
        defer { fixture.remove() }
        let manager = fixture.manager()
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return await manager.enable()
        }
        let result = await task.value
        #expect(!result.isEnabled && result.canEnable && !result.automaticConnectionReady)
        #expect(try Data(contentsOf: fixture.startup) == fixture.original)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
    }
}

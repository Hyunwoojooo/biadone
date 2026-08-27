import Darwin
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Codex auto-connect")
struct CodexAutoConnectTests {
    @Test("command mode has stable status, enable, and disable JSON")
    func commandModeRoundTrip() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let application = CodexAutoConnectCommandApplication(manager: fixture.manager)

        let status = try application.run(arguments: ["status"])
        #expect(try String(decoding: status.outputData(), as: UTF8.self) == "{\"detail\":null,\"ok\":true,\"operation\":\"status\",\"schema_version\":\"1.0\",\"state\":\"disabled\"}\n")

        let enabled = try application.run(arguments: ["enable"])
        #expect(try String(decoding: enabled.outputData(), as: UTF8.self) == "{\"detail\":null,\"ok\":true,\"operation\":\"enable\",\"schema_version\":\"1.0\",\"state\":\"enabled\"}\n")
        #expect(fixture.manager.state() == .enabled)

        let disabled = try application.run(arguments: ["disable"])
        #expect(try String(decoding: disabled.outputData(), as: UTF8.self) == "{\"detail\":null,\"ok\":true,\"operation\":\"disable\",\"schema_version\":\"1.0\",\"state\":\"disabled\"}\n")
        #expect(fixture.manager.state() == .disabled)
    }

    @Test("command mode rejects missing, extra, and unsupported arguments")
    func commandModeRejectsOtherArguments() {
        for arguments in [[], ["status", "extra"], ["repair"]] {
            #expect(throws: CoordinatorError.self) {
                _ = try CodexAutoConnectCommandOperation(arguments: arguments)
            }
        }
    }

    @Test("state is read-only and reports a clean installation as disabled")
    func stateDoesNotMutate() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }

        #expect(fixture.manager.state() == .disabled)
        #expect(!FileManager.default.fileExists(atPath: fixture.applicationSupport.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
    }

    @Test("clean disabled state is unavailable when official Codex cannot be discovered")
    func cleanStateWithoutOfficialCodexIsUnavailable() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: nil
        )

        #expect(!manager.canEnable)
        guard case .unavailable = manager.state() else {
            Issue.record("clean state without Codex must be unavailable")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        try manager.disable()
        #expect(!FileManager.default.fileExists(atPath: fixture.applicationSupport.path))
    }

    @Test("enable and disable are idempotent for a previously missing zshrc")
    func missingZshRCEnableDisable() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }

        try fixture.manager.enable()
        let first = try Data(contentsOf: fixture.zshRC)
        try fixture.manager.enable()
        #expect(try Data(contentsOf: fixture.zshRC) == first)
        #expect(fixture.manager.state() == .enabled)
        #expect(String(decoding: first, as: UTF8.self)
            .components(separatedBy: ">>> Blabee Codex Auto Connect v1 >>>").count == 2)

        try fixture.manager.disable()
        try fixture.manager.disable()
        #expect(fixture.manager.state() == .disabled)
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
    }

    @Test("existing zshrc bytes survive an enable-disable round trip")
    func preservesExistingZshRC() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export SAMPLE='untouched'".utf8)
        try original.write(to: fixture.zshRC)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o640],
            ofItemAtPath: fixture.zshRC.path
        )

        try fixture.manager.enable()
        try fixture.manager.disable()

        #expect(try Data(contentsOf: fixture.zshRC) == original)
        let attributes = try FileManager.default.attributesOfItem(atPath: fixture.zshRC.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o640)
    }

    @Test("bytes appended after the owned marker survive repair and disable")
    func preservesSuffixAfterMarker() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let prefix = Data("export PREFIX=without-newline".utf8)
        let suffix = Data("export SUFFIX=kept\n".utf8)
        try prefix.write(to: fixture.zshRC)
        try fixture.manager.enable()
        var installed = try Data(contentsOf: fixture.zshRC)
        installed.append(suffix)
        try installed.write(to: fixture.zshRC, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.zshRC.path)

        #expect(fixture.manager.state() == .enabled)
        try fixture.manager.enable()
        #expect(try Data(contentsOf: fixture.zshRC) == installed)
        try fixture.manager.disable()

        var expected = prefix
        expected.append(0x0A)
        expected.append(suffix)
        #expect(try Data(contentsOf: fixture.zshRC) == expected)
    }

    @Test("zshrc extended attributes and mode survive inode replacement")
    func preservesZshRCMetadata() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export METADATA=kept\n".utf8)
        let attributeName = "com.biadone.blabee.auto-connect-test"
        let attributeValue = Data("opaque-test-value".utf8)
        try original.write(to: fixture.zshRC)
        try FileManager.default.setAttributes([.posixPermissions: 0o640], ofItemAtPath: fixture.zshRC.path)
        try setExtendedAttribute(attributeName, value: attributeValue, at: fixture.zshRC)

        try fixture.manager.enable()
        #expect(try extendedAttribute(attributeName, at: fixture.zshRC) == attributeValue)
        var attributes = try FileManager.default.attributesOfItem(atPath: fixture.zshRC.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o640)

        try fixture.manager.disable()
        #expect(try Data(contentsOf: fixture.zshRC) == original)
        #expect(try extendedAttribute(attributeName, at: fixture.zshRC) == attributeValue)
        attributes = try FileManager.default.attributesOfItem(atPath: fixture.zshRC.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o640)
    }

    @Test("stale owned generated content is reported and repaired")
    func repairsStaleManagedFile() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        var stale = try String(contentsOf: fixture.managed, encoding: .utf8)
        stale = stale.replacingOccurrences(of: fixture.coordinator.path, with: "/missing/coordinator")
        try Data(stale.utf8).write(to: fixture.managed, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.managed.path)

        guard case .repairRequired = fixture.manager.state() else {
            Issue.record("expected repairRequired")
            return
        }
        try fixture.manager.enable()
        #expect(fixture.manager.state() == .enabled)
        #expect(try String(contentsOf: fixture.managed, encoding: .utf8).contains(fixture.coordinator.path))
    }

    @Test("duplicate or malformed markers fail closed before creating managed code")
    func malformedMarkersFailClosed() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let malformed = """
        # >>> Blabee Codex Auto Connect v1 >>>
        source '/tmp/one'
        # <<< Blabee Codex Auto Connect v1 <<<
        # >>> Blabee Codex Auto Connect v1 >>>
        source '/tmp/two'
        # <<< Blabee Codex Auto Connect v1 <<<
        """
        try Data(malformed.utf8).write(to: fixture.zshRC)

        guard case .conflict = fixture.manager.state() else {
            Issue.record("expected conflict")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try fixture.manager.enable() }
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
    }

    @Test("a malformed owned managed file is not silently overwritten or deleted")
    func malformedManagedFileFailsClosed() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(
            at: fixture.managed.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("# Blabee Codex Auto Connect v1\nbroken\n".utf8).write(to: fixture.managed)

        guard case .conflict = fixture.manager.state() else {
            Issue.record("expected conflict")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try fixture.manager.enable() }
        #expect(throws: CodexAutoConnectError.self) { try fixture.manager.disable() }
        #expect(try String(contentsOf: fixture.managed, encoding: .utf8).contains("broken"))
    }

    @Test(arguments: ["symlink", "hardlink", "directory", "oversize", "writable"])
    func unsafeZshRCFilesFailClosed(kind: String) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        switch kind {
        case "symlink":
            let target = fixture.root.appendingPathComponent("target")
            try Data().write(to: target)
            try FileManager.default.createSymbolicLink(at: fixture.zshRC, withDestinationURL: target)
        case "hardlink":
            let target = fixture.root.appendingPathComponent("target")
            try Data().write(to: target)
            #expect(link(target.path, fixture.zshRC.path) == 0)
        case "directory":
            try FileManager.default.createDirectory(at: fixture.zshRC, withIntermediateDirectories: false)
        case "oversize":
            try Data(repeating: 0x41, count: 256 * 1_024 + 1).write(to: fixture.zshRC)
        case "writable":
            try Data().write(to: fixture.zshRC)
            try FileManager.default.setAttributes([.posixPermissions: 0o666], ofItemAtPath: fixture.zshRC.path)
        default: Issue.record("unknown fixture")
        }

        guard case .conflict = fixture.manager.state() else {
            Issue.record("expected conflict for \(kind)")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try fixture.manager.enable() }
    }

    @Test("a symlinked shell directory fails closed before touching its target")
    func symlinkedShellDirectoryFailsClosed() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(
            at: fixture.applicationSupport,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let target = fixture.root.appendingPathComponent("foreign shell", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: fixture.applicationSupport.appendingPathComponent("shell"),
            withDestinationURL: target
        )

        #expect(throws: CodexAutoConnectError.self) { try fixture.manager.enable() }
        #expect(!FileManager.default.fileExists(atPath: target.appendingPathComponent("v1").path))
    }

    @Test("spaces and apostrophes are escaped and argv routing is exact")
    func exactZshRouting() throws {
        let fixture = try AutoConnectFixture(
            rootName: "Blabee auto connect's fixture \(UUID().uuidString)"
        )
        defer { fixture.remove() }
        try fixture.manager.enable()

        let log = fixture.root.appendingPathComponent("argv log")
        let environment = ["BLABEE_TEST_LOG": log.path, "BLABEE_SOCKET": "/stale/socket"]
        #expect(try fixture.runCodex([], environment: environment) == 0)
        #expect(try fixture.runCodex(["resume", "thread id", "*[x]"], environment: environment) == 0)
        #expect(try fixture.runCodex(["exec", "two words"], environment: environment) == 0)
        #expect(try fixture.runCodex(["plugin", "list"], environment: environment) == 0)
        #expect(try fixture.runCodex(["--version"], environment: environment) == 0)

        let lines = try String(contentsOf: log, encoding: .utf8)
        #expect(lines.contains("coordinator:<managed-codex><--codex><\(fixture.official.path)><-->"))
        #expect(lines.contains("coordinator:<managed-codex><--codex><\(fixture.official.path)><--><resume><thread id><*[x]>") )
        #expect(lines.contains("official:<exec><two words>"))
        #expect(lines.contains("official:<plugin><list>"))
        #expect(lines.contains("official:<--version>"))
        #expect(lines.contains("socket:unset"))
        #expect(lines.components(separatedBy: "official-socket:unset").count - 1 == 3)
    }

    @Test("missing coordinator falls back once, but a started failure never reruns Codex")
    func fallbackBoundary() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let log = fixture.root.appendingPathComponent("log")
        let environment = [
            "BLABEE_TEST_LOG": log.path,
            "BLABEE_SOCKET": "/stale/socket",
            "BLABEE_MANAGED_APPROVALS": "stale-approvals",
            "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
        ]

        try FileManager.default.removeItem(at: fixture.coordinator)
        #expect(try fixture.runCodex(["resume"], environment: environment) == 0)
        var text = try String(contentsOf: log, encoding: .utf8)
        #expect(text.components(separatedBy: "official:").count - 1 == 1)
        #expect(text.contains("official-socket:unset"))

        try fixture.writeExecutable(
            fixture.coordinator,
            body: "printf 'coordinator-failed:' >> \"$BLABEE_TEST_LOG\"\nexit 17"
        )
        #expect(try fixture.runCodex([], environment: environment) == 17)
        text = try String(contentsOf: log, encoding: .utf8)
        #expect(text.components(separatedBy: "official:").count - 1 == 1)
        #expect(text.contains("coordinator-failed:"))
    }

    @Test("all managed runtime variables are cleared on managed direct and fallback paths")
    func clearsAllManagedRuntimeVariables() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let log = fixture.root.appendingPathComponent("environment log")
        let environment = [
            "BLABEE_TEST_LOG": log.path,
            "BLABEE_SOCKET": "/stale/socket",
            "BLABEE_MANAGED_APPROVALS": "stale-approvals",
            "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
        ]

        #expect(try fixture.runCodex([], environment: environment) == 0)
        #expect(try fixture.runCodex(["--version"], environment: environment) == 0)
        try FileManager.default.removeItem(at: fixture.coordinator)
        #expect(try fixture.runCodex(["resume"], environment: environment) == 0)

        let text = try String(contentsOf: log, encoding: .utf8)
        #expect(text.components(separatedBy: "coordinator-env:<unset><unset><unset>").count - 1 == 1)
        #expect(text.components(separatedBy: "official-env:<unset><unset><unset>").count - 1 == 2)
        #expect(!text.contains("stale-approvals"))
        #expect(!text.contains("stale-token"))
        #expect(!text.contains("/stale/socket"))
    }

    @Test("file-lock contention times out instead of waiting forever")
    func lockContentionTimesOut() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        try fixture.manager.disable()
        let lockURL = fixture.applicationSupport
            .appendingPathComponent("shell/v1/.codex-auto-connect.lock")
        let holder = open(lockURL.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
        guard holder >= 0 else { throw AutoConnectFixtureError.raceSetup }
        defer {
            _ = flock(holder, LOCK_UN)
            close(holder)
        }
        guard flock(holder, LOCK_EX | LOCK_NB) == 0 else {
            throw AutoConnectFixtureError.raceSetup
        }
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            lockAttemptLimit: 3,
            lockRetryMicroseconds: 1_000
        )

        do {
            try manager.enable()
            Issue.record("lock contention must fail closed")
        } catch let error as CodexAutoConnectError {
            #expect(error.localizedDescription.contains("시간이 초과"))
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
    }

    @Test("disable mutation also times out behind the cross-process file lock")
    func disableUsesSameBoundedLock() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let zshRCBefore = try Data(contentsOf: fixture.zshRC)
        let managedBefore = try Data(contentsOf: fixture.managed)
        let lockURL = fixture.applicationSupport
            .appendingPathComponent("shell/v1/.codex-auto-connect.lock")
        let holder = open(lockURL.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
        guard holder >= 0 else { throw AutoConnectFixtureError.raceSetup }
        defer {
            _ = flock(holder, LOCK_UN)
            close(holder)
        }
        guard flock(holder, LOCK_EX | LOCK_NB) == 0 else {
            throw AutoConnectFixtureError.raceSetup
        }
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            lockAttemptLimit: 3,
            lockRetryMicroseconds: 1_000
        )

        do {
            try manager.disable()
            Issue.record("contended disable must fail closed")
        } catch let error as CodexAutoConnectError {
            #expect(error.localizedDescription.contains("시간이 초과"))
        }
        #expect(try Data(contentsOf: fixture.zshRC) == zshRCBefore)
        #expect(try Data(contentsOf: fixture.managed) == managedBefore)
    }

    @Test("a restarted manager can disable after the official Codex moved")
    func disableDoesNotRequireOfficialDiscovery() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export UNRELATED=kept\n".utf8)
        try original.write(to: fixture.zshRC)
        try fixture.manager.enable()
        try FileManager.default.removeItem(at: fixture.official)

        let restarted = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: nil
        )
        guard case .repairRequired = restarted.state() else {
            Issue.record("missing installed Codex must require repair")
            return
        }
        #expect(!restarted.canEnable)
        try restarted.disable()
        #expect(try Data(contentsOf: fixture.zshRC) == original)
        guard case .unavailable = restarted.state() else {
            Issue.record("clean state without a discovered Codex must be unavailable")
            return
        }
    }

    @Test("an in-place destination change is detected immediately before replacement")
    func detectsExistingDestinationRace() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try Data("export ORIGINAL=1\n".utf8).write(to: fixture.zshRC)
        let raced = Data("export RACED=1\n".utf8)
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            beforeDestinationReplace: { destination in
                guard destination.lastPathComponent == ".zshrc" else { return }
                let descriptor = open(destination.path, O_WRONLY | O_TRUNC)
                guard descriptor >= 0 else { throw AutoConnectFixtureError.raceSetup }
                defer { close(descriptor) }
                try raced.withUnsafeBytes { bytes in
                    guard let base = bytes.baseAddress,
                          Darwin.write(descriptor, base, bytes.count) == bytes.count
                    else { throw AutoConnectFixtureError.raceSetup }
                }
                _ = fsync(descriptor)
            }
        )

        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        #expect(try Data(contentsOf: fixture.zshRC) == raced)
    }

    @Test("no-replace rename preserves a concurrently created destination")
    func newDestinationUsesExclusiveRename() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let foreign = Data("foreign managed file\n".utf8)
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            beforeDestinationReplace: { destination in
                guard destination.lastPathComponent == "codex-auto-connect.zsh" else { return }
                try foreign.write(to: destination)
            }
        )

        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        #expect(try Data(contentsOf: fixture.managed) == foreign)
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
    }

    @Test("an existing codex alias is preserved and exposed as a runtime conflict")
    func runtimeAliasConflict() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-f", "-c",
            "alias codex='print untouched'; source \"$1\"; print -- \"$BLABEE_CODEX_AUTO_CONNECT_CONFLICT\"; alias codex",
            "test", fixture.managed.path,
        ]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        process.waitUntilExit()
        let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        #expect(text.contains("alias"))
        #expect(text.contains("print untouched"))
    }

    @Test("re-sourcing refreshes Blabee's wrapper but preserves a later user function")
    func runtimeFunctionOwnership() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-f", "-c",
            "source \"$1\"; source \"$1\"; function codex { print user-function; }; source \"$1\"; print -- \"$BLABEE_CODEX_AUTO_CONNECT_CONFLICT\"; codex",
            "test", fixture.managed.path,
        ]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        process.waitUntilExit()
        let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        #expect(text.contains("function"))
        #expect(text.contains("user-function"))
    }

    @Test("the zshrc guard is quiet when the managed file is temporarily missing")
    func missingManagedFileSourcesQuietlyAndDisablesSerially() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export KEEP=1\n".utf8)
        try original.write(to: fixture.zshRC)
        try fixture.manager.enable()
        try FileManager.default.removeItem(at: fixture.managed)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-f", fixture.zshRC.path]
        let error = Pipe()
        process.standardError = error
        try process.run()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
        #expect(error.fileHandleForReading.readDataToEndOfFile().isEmpty)

        try fixture.manager.disable()
        #expect(try Data(contentsOf: fixture.zshRC) == original)
        #expect(fixture.manager.state() == .disabled)
    }

    @Test("live discovery ignores recursive entries and stores a stable Codex symlink")
    func liveDiscoveryUsesStableEntry() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let recursiveDirectory = fixture.root.appendingPathComponent("recursive", isDirectory: true)
        let officialDirectory = fixture.root.appendingPathComponent("stable", isDirectory: true)
        try FileManager.default.createDirectory(at: recursiveDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: officialDirectory, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: recursiveDirectory.appendingPathComponent("codex"),
            withDestinationURL: fixture.coordinator
        )
        let stableEntry = officialDirectory.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(at: stableEntry, withDestinationURL: fixture.official)
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": "relative:\(recursiveDirectory.path):\(officialDirectory.path)"]
        )

        try manager.enable()
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        #expect(try String(contentsOf: managed, encoding: .utf8).contains(stableEntry.path))
    }

    @Test("official Codex cannot recurse into the coordinator")
    func rejectsRecursiveOfficialPath() throws {
        let fixture = try AutoConnectFixture(officialIsCoordinator: true)
        defer { fixture.remove() }
        #expect(!fixture.manager.canEnable)
        #expect(throws: CodexAutoConnectError.self) { try fixture.manager.enable() }
        guard case .unavailable = fixture.manager.state() else {
            Issue.record("recursive official path must be unavailable")
            return
        }
    }
}

private final class AutoConnectFixture {
    let root: URL
    let home: URL
    let applicationSupport: URL
    let coordinator: URL
    let official: URL
    let manager: CodexAutoConnectManager

    var zshRC: URL { home.appendingPathComponent(".zshrc") }
    var managed: URL {
        applicationSupport.appendingPathComponent("shell/v1/codex-auto-connect.zsh")
    }

    init(rootName: String = UUID().uuidString, officialIsCoordinator: Bool = false) throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(rootName, isDirectory: true)
        home = root.appendingPathComponent("home", isDirectory: true)
        applicationSupport = root.appendingPathComponent("Application Support/Blabee", isDirectory: true)
        coordinator = root.appendingPathComponent("bin/Blabee coordinator")
        official = officialIsCoordinator ? coordinator : root.appendingPathComponent("bin/official codex")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.createDirectory(at: coordinator.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        manager = CodexAutoConnectManager(
            homeURL: home,
            applicationSupportURL: applicationSupport,
            coordinatorURL: coordinator,
            officialCodexURL: official
        )
        try writeExecutable(
            coordinator,
            body: "printf 'coordinator-env:<%s><%s><%s>\\n' \"${BLABEE_SOCKET-unset}\" \"${BLABEE_MANAGED_APPROVALS-unset}\" \"${BLABEE_MANAGED_CODEX_AUTH_TOKEN-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'socket:%s\\n' \"${BLABEE_SOCKET-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'coordinator:' >> \"$BLABEE_TEST_LOG\"\nfor value in \"$@\"; do printf '<%s>' \"$value\" >> \"$BLABEE_TEST_LOG\"; done\nprintf '\\n' >> \"$BLABEE_TEST_LOG\""
        )
        if !officialIsCoordinator {
            try writeExecutable(
                official,
                body: "printf 'official-env:<%s><%s><%s>\\n' \"${BLABEE_SOCKET-unset}\" \"${BLABEE_MANAGED_APPROVALS-unset}\" \"${BLABEE_MANAGED_CODEX_AUTH_TOKEN-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'official-socket:%s\\n' \"${BLABEE_SOCKET-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'official:' >> \"$BLABEE_TEST_LOG\"\nfor value in \"$@\"; do printf '<%s>' \"$value\" >> \"$BLABEE_TEST_LOG\"; done\nprintf '\\n' >> \"$BLABEE_TEST_LOG\""
            )
        }
    }

    func writeExecutable(_ url: URL, body: String) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(("#!/bin/zsh\nset -eu\n" + body + "\n").utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    func runCodex(_ arguments: [String], environment: [String: String]) throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-f", "-c", "source \"$1\"; shift; codex \"$@\"", "test", managed.path,
        ] + arguments
        process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }
}

private enum AutoConnectFixtureError: Error {
    case raceSetup
    case extendedAttribute
}

private func setExtendedAttribute(_ name: String, value: Data, at url: URL) throws {
    let result = value.withUnsafeBytes { bytes in
        setxattr(url.path, name, bytes.baseAddress, bytes.count, 0, 0)
    }
    guard result == 0 else { throw AutoConnectFixtureError.extendedAttribute }
}

private func extendedAttribute(_ name: String, at url: URL) throws -> Data {
    let size = getxattr(url.path, name, nil, 0, 0, 0)
    guard size >= 0 else { throw AutoConnectFixtureError.extendedAttribute }
    var bytes = [UInt8](repeating: 0, count: size)
    let read = getxattr(url.path, name, &bytes, bytes.count, 0, 0)
    guard read == size else { throw AutoConnectFixtureError.extendedAttribute }
    return Data(bytes)
}

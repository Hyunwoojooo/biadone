import Darwin
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let supportedCodexVersionReader: @Sendable (URL) -> String? = { _ in "0.150.1" }

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
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
        #expect(FileManager.default.fileExists(
            atPath: fixture.applicationSupport
                .appendingPathComponent("shell/v1/.codex-auto-connect.lock")
                .path
        ))
    }

    @Test("unsupported Codex versions fail closed before user shell files are written")
    func unsupportedVersionCannotEnable() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: { _ in "0.147.0" }
        )

        #expect(!manager.canEnable)
        guard case let .unavailable(reason) = manager.state() else {
            Issue.record("unsupported Codex must be unavailable")
            return
        }
        #expect(reason.contains("0.147.0"))
        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
    }

    @Test("enable requalifies Codex after an earlier supported snapshot")
    func enableRequalifiesVersionBeforeWriting() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let versions = CodexVersionSequenceProbe(["0.150.1", "0.147.0"])
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: { url in versions.read(for: url) }
        )

        #expect(manager.canEnable)
        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        #expect(versions.callCount == 2)
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
    }

    @Test("one inspection uses one Codex qualification for state and availability")
    func inspectionUsesOneQualification() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let versions = CodexVersionSequenceProbe(["0.150.1", "0.147.0"])
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: { url in versions.read(for: url) }
        )

        let inspection = manager.inspection()
        #expect(inspection.state == .disabled)
        #expect(inspection.canEnable)
        #expect(versions.callCount == 1)
    }

    @Test("installed state skips version checks and reports later identity drift generically")
    func installedStateUsesFastIdentityCheck() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let versions = CodexVersionSequenceProbe(["0.147.0"])
        let restarted = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: { url in versions.read(for: url) }
        )

        #expect(restarted.state() == .enabled)
        #expect(versions.callCount == 0)

        try fixture.writeExecutable(fixture.official, body: "exit 0")
        guard case let .repairRequired(reason) = restarted.state() else {
            Issue.record("changed installed Codex must require repair")
            return
        }
        #expect(reason.contains("마지막 승인 이후 변경"))
        #expect(!reason.contains("0.147.0"))
        #expect(versions.callCount == 0)
        try restarted.disable()
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
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

    @Test("zshrc user metadata survives while system provenance may rotate")
    func preservesZshRCMetadata() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export METADATA=kept\n".utf8)
        let attributeName = "com.biadone.blabee.auto-connect-test"
        let attributeValue = Data("opaque-test-value".utf8)
        let provenanceName = "com.apple.provenance"
        let provenanceSeed = Data([0x01, 0x02, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])
        try original.write(to: fixture.zshRC)
        try FileManager.default.setAttributes([.posixPermissions: 0o640], ofItemAtPath: fixture.zshRC.path)
        try setExtendedAttribute(attributeName, value: attributeValue, at: fixture.zshRC)
        try setExtendedAttribute(provenanceName, value: provenanceSeed, at: fixture.zshRC)
        let provenanceBytes = try extendedAttribute(provenanceName, at: fixture.zshRC).count

        try fixture.manager.enable()
        #expect(try extendedAttribute(attributeName, at: fixture.zshRC) == attributeValue)
        #expect(try extendedAttribute(provenanceName, at: fixture.zshRC).count == provenanceBytes)
        var attributes = try FileManager.default.attributesOfItem(atPath: fixture.zshRC.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o640)

        try fixture.manager.disable()
        #expect(try Data(contentsOf: fixture.zshRC) == original)
        #expect(try extendedAttribute(attributeName, at: fixture.zshRC) == attributeValue)
        #expect(try extendedAttribute(provenanceName, at: fixture.zshRC).count == provenanceBytes)
        attributes = try FileManager.default.attributesOfItem(atPath: fixture.zshRC.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o640)
    }

    @Test("a stable launcher for an older official Codex is reported and repaired")
    func repairsStaleStableLauncher() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        var stale = try String(contentsOf: fixture.stableLauncher, encoding: .utf8)
        stale = stale.replacingOccurrences(of: fixture.official.path, with: "/missing/codex")
        try Data(stale.utf8).write(to: fixture.stableLauncher, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: fixture.stableLauncher.path
        )

        guard case .repairRequired = fixture.manager.state() else {
            Issue.record("expected repairRequired")
            return
        }
        try fixture.manager.enable()
        #expect(fixture.manager.state() == .enabled)
        #expect(try String(contentsOf: fixture.stableLauncher, encoding: .utf8)
            .contains(fixture.official.path))
    }

    @Test("enable repairs a non-executable owned stable launcher to mode 0700")
    func repairsStableLauncherMode() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fixture.stableLauncher.path
        )

        guard case let .repairRequired(reason) = fixture.manager.state() else {
            Issue.record("a non-executable stable launcher must require repair")
            return
        }
        #expect(reason.contains("고정 실행기"))
        try fixture.manager.enable()

        var info = stat()
        #expect(lstat(fixture.stableLauncher.path, &info) == 0)
        #expect(info.st_mode & 0o777 == 0o700)
        #expect(fixture.manager.state() == .enabled)
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

    @Test("spaces and apostrophes are escaped and native Codex argv routing is exact")
    func exactZshRouting() throws {
        let fixture = try AutoConnectFixture(
            rootName: "Blabee auto connect's fixture \(UUID().uuidString)"
        )
        defer { fixture.remove() }
        try fixture.manager.enable()

        let log = fixture.root.appendingPathComponent("argv log")
        let environment = [
            "BLABEE_TEST_LOG": log.path,
            "BLABEE_COORDINATOR_BINARY": "/stale/coordinator",
            "BLABEE_SOCKET": "/stale/socket",
            "BLABEE_MANAGED_APPROVALS": "stale-approvals",
            "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
            "BLABEE_RUNTIME_IDENTITY": "sha256:stale-runtime",
        ]
        #expect(try fixture.runCodex([], environment: environment) == 0)
        #expect(try fixture.runCodex(["resume", "thread id", "*[x]"], environment: environment) == 0)
        #expect(try fixture.runCodex(["fork", "thread id"], environment: environment) == 0)
        #expect(try fixture.runCodex(["exec", "two words"], environment: environment) == 0)
        #expect(try fixture.runCodex(["plugin", "list"], environment: environment) == 0)
        #expect(try fixture.runCodex(["write a short plan", "--full-auto"], environment: environment) == 0)
        #expect(try fixture.runCodex(["-C", "/tmp/work path", "resume"], environment: environment) == 0)
        #expect(try fixture.runCodex(["--remote", "ws://127.0.0.1:4321", "resume"], environment: environment) == 0)
        #expect(try fixture.runCodex(["--version"], environment: environment) == 0)

        let lines = try String(contentsOf: log, encoding: .utf8)
        let records = lines.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        #expect(records.filter { $0.hasPrefix("official:") }.count == 9)
        #expect(records.contains("official:"))
        #expect(records.contains("official:<resume><thread id><*[x]>"))
        #expect(records.contains("official:<fork><thread id>"))
        #expect(records.contains("official:<exec><two words>"))
        #expect(records.contains("official:<plugin><list>"))
        #expect(records.contains("official:<write a short plan><--full-auto>"))
        #expect(records.contains("official:<-C></tmp/work path><resume>"))
        #expect(records.contains("official:<--remote><ws://127.0.0.1:4321><resume>"))
        #expect(records.contains("official:<--version>"))
        #expect(!lines.contains("coordinator:"))
        #expect(records.filter { $0 == "official-env:<unset><unset><unset><unset><unset>" }.count == 9)
        #expect(!lines.contains("/stale/socket"))
        #expect(!lines.contains("stale-runtime"))
    }

    @Test("an already-open shell keeps native Codex working after auto-connect is disabled")
    func openShellSurvivesDisable() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()

        let cachedManaged = fixture.root.appendingPathComponent("cached-open-shell.zsh")
        try Data(contentsOf: fixture.managed).write(to: cachedManaged)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: cachedManaged.path
        )
        let cachedText = try String(contentsOf: cachedManaged, encoding: .utf8)
        #expect(cachedText.contains(fixture.official.path))
        #expect(!cachedText.contains("local _blabee_launcher="))
        #expect(!cachedText.contains(fixture.coordinator.path))
        let installedStableLauncher = try Data(contentsOf: fixture.stableLauncher)
        try fixture.manager.disable()

        #expect(fixture.manager.state() == .disabled)
        #expect(try Data(contentsOf: fixture.stableLauncher) == installedStableLauncher)

        let log = fixture.root.appendingPathComponent("open shell log")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-f", "-c", "source \"$1\"; codex --version", "test", cachedManaged.path,
        ]
        process.environment = ProcessInfo.processInfo.environment.merging(
            ["BLABEE_TEST_LOG": log.path]
        ) { _, new in new }
        try process.run()
        process.waitUntilExit()

        #expect(process.terminationStatus == 0)

        // A shell that sourced the previous stable-launcher-backed function
        // keeps calling this path after disable. It must now be a native-only
        // pass-through rather than a dependency on the coordinator.
        let legacyOpenShell = Process()
        legacyOpenShell.executableURL = fixture.stableLauncher
        legacyOpenShell.arguments = ["resume"]
        legacyOpenShell.environment = ProcessInfo.processInfo.environment.merging(
            ["BLABEE_TEST_LOG": log.path]
        ) { _, new in new }
        try legacyOpenShell.run()
        legacyOpenShell.waitUntilExit()

        #expect(legacyOpenShell.terminationStatus == 0)
        let records = try String(contentsOf: log, encoding: .utf8)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        #expect(records.filter { $0 == "official:<--version>" }.count == 1)
        #expect(records.filter { $0 == "official:<resume>" }.count == 1)
        #expect(!records.contains { $0.hasPrefix("coordinator:") })
    }

    @Test("the native v4 function ignores a malformed executable stable launcher")
    func nativeFunctionIgnoresMalformedStableLauncher() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let log = fixture.root.appendingPathComponent("malformed stable log")
        try fixture.writeExecutable(
            fixture.stableLauncher,
            body: "printf 'malformed-stable\\n' >> \"$BLABEE_TEST_LOG\"\nexit 88"
        )

        #expect(try fixture.runCodex(["fork", "thread id"], environment: [
            "BLABEE_TEST_LOG": log.path,
        ]) == 0)

        let records = try String(contentsOf: log, encoding: .utf8)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        #expect(records.filter { $0 == "official:<fork><thread id>" }.count == 1)
        #expect(!records.contains("malformed-stable"))
    }

    @Test("the legacy native stable launcher preserves a nonzero exit exactly once")
    func legacyStableLauncherPreservesNonzeroExit() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let log = fixture.root.appendingPathComponent("legacy nonzero log")
        try fixture.writeExecutable(
            fixture.official,
            body: "printf 'official-nonzero:' >> \"$BLABEE_TEST_LOG\"\nfor value in \"$@\"; do printf '<%s>' \"$value\" >> \"$BLABEE_TEST_LOG\"; done\nprintf '\\n' >> \"$BLABEE_TEST_LOG\"\nexit 29"
        )

        let process = Process()
        process.executableURL = fixture.stableLauncher
        process.arguments = ["resume", "thread id"]
        process.environment = ProcessInfo.processInfo.environment.merging([
            "BLABEE_TEST_LOG": log.path,
        ]) { _, new in new }
        try process.run()
        process.waitUntilExit()

        #expect(process.terminationReason == .exit)
        #expect(process.terminationStatus == 29)
        let records = try String(contentsOf: log, encoding: .utf8)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        #expect(records.filter { $0 == "official-nonzero:<resume><thread id>" }.count == 1)
    }

    @Test("missing or failed coordinator leaves native Codex available exactly once")
    func coordinatorFailurePreservesNativeCodex() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let log = fixture.root.appendingPathComponent("log")
        let environment = [
            "BLABEE_TEST_LOG": log.path,
            "BLABEE_COORDINATOR_BINARY": "/stale/coordinator",
            "BLABEE_SOCKET": "/stale/socket",
            "BLABEE_MANAGED_APPROVALS": "stale-approvals",
            "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
            "BLABEE_RUNTIME_IDENTITY": "sha256:stale-runtime",
        ]

        try FileManager.default.removeItem(at: fixture.coordinator)
        let staleResult = try fixture.runCodexCapturingError(
            ["resume", "thread id"],
            environment: environment
        )
        #expect(staleResult.status == 0)
        #expect(staleResult.error.isEmpty)

        try fixture.writeExecutable(
            fixture.coordinator,
            body: "printf 'coordinator-failed:' >> \"$BLABEE_TEST_LOG\"\nexit 17"
        )
        #expect(try fixture.runCodex(["exec", "two words"], environment: environment) == 0)
        let text = try String(contentsOf: log, encoding: .utf8)
        let records = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        #expect(records.filter { $0.hasPrefix("official:") }.count == 2)
        #expect(records.filter { $0 == "official:<resume><thread id>" }.count == 1)
        #expect(records.filter { $0 == "official:<exec><two words>" }.count == 1)
        #expect(records.filter { $0 == "official-env:<unset><unset><unset><unset><unset>" }.count == 2)
        #expect(!text.contains("coordinator-failed:"))
        #expect(!text.contains("/stale/socket"))
        #expect(!text.contains("stale-approvals"))
        #expect(!text.contains("stale-token"))
        #expect(!text.contains("stale-runtime"))
        #expect(!text.contains("/stale/coordinator"))
    }

    @Test("missing Blabee runtime files do not block an already-sourced native Codex function")
    func missingBlabeeRuntimePreservesNativeCodex() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()

        let cachedManaged = fixture.root.appendingPathComponent("cached-native-function.zsh")
        try Data(contentsOf: fixture.managed).write(to: cachedManaged)
        try FileManager.default.removeItem(at: fixture.coordinator)
        try FileManager.default.removeItem(
            at: fixture.applicationSupport.appendingPathComponent("shell", isDirectory: true)
        )

        let log = fixture.root.appendingPathComponent("runtime-missing log")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-f", "-c", "source \"$1\"; shift; codex \"$@\"",
            "test", cachedManaged.path, "exec", "after-runtime-loss",
        ]
        process.environment = ProcessInfo.processInfo.environment.merging(
            ["BLABEE_TEST_LOG": log.path]
        ) { _, new in new }
        try process.run()
        process.waitUntilExit()

        #expect(process.terminationStatus == 0)
        let records = try String(contentsOf: log, encoding: .utf8)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        #expect(records.filter { $0 == "official:<exec><after-runtime-loss>" }.count == 1)
        #expect(!records.contains { $0.hasPrefix("coordinator:") })
    }

    @Test("a missing stable launcher falls back to native Codex exactly once")
    func missingStableLauncherPreservesNativeCodex() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        try FileManager.default.removeItem(at: fixture.stableLauncher)

        let log = fixture.root.appendingPathComponent("official fallback log")
        let result = try fixture.runCodexCapturingError(
            ["resume", "thread id"],
            environment: ["BLABEE_TEST_LOG": log.path]
        )

        #expect(result.status == 0)
        #expect(result.error.isEmpty)
        let records = try String(contentsOf: log, encoding: .utf8)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        #expect(records.filter { $0 == "official:<resume><thread id>" }.count == 1)
        guard case .repairRequired = fixture.manager.state() else {
            Issue.record("a missing stable launcher must require repair")
            return
        }
    }

    @Test("native passthrough preserves argv and clears all managed runtime variables")
    func clearsAllManagedRuntimeVariables() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let log = fixture.root.appendingPathComponent("environment log")
        let environment = [
            "BLABEE_TEST_LOG": log.path,
            "BLABEE_COORDINATOR_BINARY": "/stale/coordinator",
            "BLABEE_SOCKET": "/stale/socket",
            "BLABEE_MANAGED_APPROVALS": "stale-approvals",
            "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
            "BLABEE_RUNTIME_IDENTITY": "sha256:stale-runtime",
        ]

        #expect(try fixture.runCodex([], environment: environment) == 0)
        #expect(try fixture.runCodex(["--version"], environment: environment) == 0)
        try FileManager.default.removeItem(at: fixture.coordinator)
        #expect(try fixture.runCodex(["resume"], environment: environment) == 0)

        let text = try String(contentsOf: log, encoding: .utf8)
        let records = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        #expect(records.filter { $0 == "official-env:<unset><unset><unset><unset><unset>" }.count == 3)
        #expect(records.filter { $0.hasPrefix("official:") }.count == 3)
        #expect(records.filter { $0 == "official:" }.count == 1)
        #expect(records.filter { $0 == "official:<--version>" }.count == 1)
        #expect(records.filter { $0 == "official:<resume>" }.count == 1)
        #expect(!text.contains("coordinator-env:"))
        #expect(!text.contains("stale-approvals"))
        #expect(!text.contains("stale-token"))
        #expect(!text.contains("stale-runtime"))
        #expect(!text.contains("/stale/socket"))
        #expect(!text.contains("/stale/coordinator"))
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
            codexVersionReader: supportedCodexVersionReader,
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
            codexVersionReader: supportedCodexVersionReader,
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

    @Test("clean disable is serialized behind the same persistent lock")
    func cleanDisableUsesPersistentLock() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
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
            officialCodexURL: nil,
            lockAttemptLimit: 3,
            lockRetryMicroseconds: 1_000
        )

        do {
            try manager.disable()
            Issue.record("clean disable must wait for the stable lock")
        } catch let error as CodexAutoConnectError {
            #expect(error.localizedDescription.contains("시간이 초과"))
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
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

    @Test(arguments: ["v1", "v2", "v3"])
    func legacyMetadataRequiresRepairButRemainsRemovable(schema: String) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export LEGACY=kept\n".utf8)
        try original.write(to: fixture.zshRC)
        try fixture.manager.enable()
        let legacy = legacyManagedData(
            schema: schema,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: URL(fileURLWithPath: normalizedStablePath(fixture.official)),
            zshRCURL: fixture.zshRC,
            zshRCWasMissing: false
        )
        try legacy.write(to: fixture.managed, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fixture.managed.path
        )

        guard case let .repairRequired(reason) = fixture.manager.state() else {
            Issue.record("legacy \(schema) installation must require a v4 repair")
            return
        }
        if schema == "v3" {
            #expect(reason.contains("이전 자동 연결 실행 경로"))
        }
        try fixture.manager.disable()
        #expect(try Data(contentsOf: fixture.zshRC) == original)
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
    }

    @Test("an already-sourced v3 shell can still launch native Codex during v4 repair")
    func legacyV3KeepsNativePassThroughDuringRepair() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export LEGACY=kept\n".utf8)
        try original.write(to: fixture.zshRC)
        try fixture.manager.enable()
        let legacy = legacyManagedData(
            schema: "v3",
            coordinatorURL: fixture.coordinator,
            officialCodexURL: URL(
                fileURLWithPath: normalizedStablePath(fixture.official),
                isDirectory: false
            ),
            zshRCURL: fixture.zshRC,
            zshRCWasMissing: false
        )
        try legacy.write(to: fixture.managed, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fixture.managed.path
        )

        let actualNativePath = normalizedStablePath(
            try fixture.manager.nativeCodexForLaunch()
        )
        let expectedNativePath = normalizedStablePath(fixture.official)
        #expect(actualNativePath == expectedNativePath)

        var damaged = legacy
        damaged.append(Data("# unexpected drift\n".utf8))
        try damaged.write(to: fixture.managed, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fixture.managed.path
        )
        #expect(throws: CodexAutoConnectError.self) {
            _ = try fixture.manager.nativeCodexForLaunch()
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
            codexVersionReader: supportedCodexVersionReader,
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

    @Test("a second save during mismatch is quarantined and the pre-exchange save is restored")
    func mismatchPreservesBothSavesWithRecoveryPath() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try Data("export ORIGINAL=1\n".utf8).write(to: fixture.zshRC)
        let raced = Data("export RACED=1\n".utf8)
        let later = Data("export LATER=1\n".utf8)
        let zshRC = fixture.zshRC
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: supportedCodexVersionReader,
            beforeDestinationReplace: { destination in
                guard destination == zshRC else { return }
                try raced.write(to: destination, options: .atomic)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o600],
                    ofItemAtPath: destination.path
                )
            },
            afterPathMutation: { destination in
                guard destination == zshRC else { return }
                try later.write(to: destination, options: .atomic)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o600],
                    ofItemAtPath: destination.path
                )
            }
        )

        do {
            try manager.enable()
            Issue.record("two overlapping saves must fail closed")
        } catch let error as CodexAutoConnectError {
            #expect(error.localizedDescription.contains(fixture.home.path))
            #expect(error.localizedDescription.contains(".tmp"))
        }
        #expect(try Data(contentsOf: fixture.zshRC) == raced)
        let recoveryFiles = try FileManager.default.contentsOfDirectory(
            at: fixture.home,
            includingPropertiesForKeys: nil
        ).filter {
            $0.lastPathComponent.hasPrefix("..zshrc.")
                && $0.lastPathComponent.hasSuffix(".tmp")
        }
        #expect(recoveryFiles.count == 1)
        if let recovery = recoveryFiles.first {
            #expect(try Data(contentsOf: recovery) == later)
        }
    }

    @Test("a replacement of the prepared temporary path cannot be installed")
    func preparedTemporaryReplacementFailsClosed() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export ORIGINAL=1\n".utf8)
        let substitute = Data("export SUBSTITUTE=must-be-preserved\n".utf8)
        try original.write(to: fixture.zshRC)
        let zshRC = fixture.zshRC
        let home = fixture.home
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: supportedCodexVersionReader,
            beforeDestinationReplace: { destination in
                guard destination == zshRC else { return }
                let temporaryFiles = try FileManager.default.contentsOfDirectory(
                    at: home,
                    includingPropertiesForKeys: nil
                ).filter {
                    $0.lastPathComponent.hasPrefix("..zshrc.")
                        && $0.lastPathComponent.hasSuffix(".tmp")
                }
                guard temporaryFiles.count == 1, let temporary = temporaryFiles.first else {
                    throw AutoConnectFixtureError.raceSetup
                }
                try FileManager.default.removeItem(at: temporary)
                try substitute.write(to: temporary)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o600],
                    ofItemAtPath: temporary.path
                )
            }
        )

        var errorDescription = ""
        do {
            try manager.enable()
            Issue.record("a substituted prepared path must never install successfully")
        } catch let error as CodexAutoConnectError {
            errorDescription = error.localizedDescription
        }

        #expect(try Data(contentsOf: fixture.zshRC) == original)
        let recoveryFiles = try FileManager.default.contentsOfDirectory(
            at: fixture.home,
            includingPropertiesForKeys: nil
        ).filter {
            $0.lastPathComponent.hasPrefix("..zshrc.")
                && $0.lastPathComponent.hasSuffix(".tmp")
        }
        #expect(recoveryFiles.count == 1)
        if let recovery = recoveryFiles.first {
            #expect(try Data(contentsOf: recovery) == substitute)
            #expect(errorDescription.contains(fixture.home.path))
            #expect(errorDescription.contains(recovery.lastPathComponent))
        }
    }

    @Test(arguments: ["symlink", "oversize"])
    func unsafeDisplacedDestinationIsRestoredByRawIdentity(kind: String) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let original = Data("export ORIGINAL=1\n".utf8)
        let symlinkTargetData = Data("export SYMLINK_TARGET=1\n".utf8)
        let symlinkTarget = fixture.root.appendingPathComponent("symlink target")
        try original.write(to: fixture.zshRC)
        try symlinkTargetData.write(to: symlinkTarget)
        let zshRC = fixture.zshRC
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: supportedCodexVersionReader,
            beforeDestinationReplace: { destination in
                guard destination == zshRC else { return }
                switch kind {
                case "symlink":
                    try FileManager.default.removeItem(at: destination)
                    try FileManager.default.createSymbolicLink(
                        at: destination,
                        withDestinationURL: symlinkTarget
                    )
                case "oversize":
                    try Data(repeating: 0x41, count: 256 * 1_024 + 1)
                        .write(to: destination, options: .atomic)
                default:
                    throw AutoConnectFixtureError.raceSetup
                }
            }
        )

        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        switch kind {
        case "symlink":
            var info = stat()
            #expect(lstat(fixture.zshRC.path, &info) == 0)
            #expect(info.st_mode & mode_t(S_IFMT) == mode_t(S_IFLNK))
            #expect(try Data(contentsOf: fixture.zshRC) == symlinkTargetData)
        case "oversize":
            #expect(try Data(contentsOf: fixture.zshRC).count == 256 * 1_024 + 1)
        default:
            Issue.record("unknown fixture")
        }
        let recoveryFiles = try FileManager.default.contentsOfDirectory(
            at: fixture.home,
            includingPropertiesForKeys: nil
        ).filter {
            $0.lastPathComponent.hasPrefix("..zshrc.")
                && $0.lastPathComponent.hasSuffix(".tmp")
        }
        #expect(recoveryFiles.isEmpty)
    }

    @Test("metadata changed immediately before exchange is copied from the captured old inode")
    func latestMetadataAtExchangeIsPreserved() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let attributeName = "com.biadone.blabee.auto-connect-late-metadata"
        let initialAttribute = Data("initial".utf8)
        let lateAttribute = Data("late".utf8)
        try Data("export METADATA=1\n".utf8).write(to: fixture.zshRC)
        try setExtendedAttribute(attributeName, value: initialAttribute, at: fixture.zshRC)
        try replaceAccessControlList(
            with: "user:\(NSUserName()) allow read",
            at: fixture.zshRC
        )
        let initialACL = try accessControlList(at: fixture.zshRC)
        let lateACL = AccessControlListProbe()
        let zshRC = fixture.zshRC
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: supportedCodexVersionReader,
            beforeDestinationReplace: { destination in
                guard destination == zshRC else { return }
                try setExtendedAttribute(attributeName, value: lateAttribute, at: destination)
                try replaceAccessControlList(
                    with: "user:\(NSUserName()) allow read,write",
                    at: destination
                )
                lateACL.value = try accessControlList(at: destination)
            }
        )

        try manager.enable()

        #expect(try extendedAttribute(attributeName, at: fixture.zshRC) == lateAttribute)
        #expect(lateACL.value != nil)
        #expect(lateACL.value != initialACL)
        #expect(try accessControlList(at: fixture.zshRC) == lateACL.value)
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
            codexVersionReader: supportedCodexVersionReader,
            beforeDestinationReplace: { destination in
                guard destination.lastPathComponent == "codex-auto-connect.zsh" else { return }
                try foreign.write(to: destination)
            }
        )

        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        #expect(try Data(contentsOf: fixture.managed) == foreign)
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
    }

    @Test("a save after the atomic exchange is quarantined while the original is restored")
    func laterSaveAfterAtomicExchangeIsQuarantined() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try Data("export ORIGINAL=1\n".utf8).write(to: fixture.zshRC)
        let laterSave = Data("export LATER_SAVE=1\n".utf8)
        let zshRC = fixture.zshRC
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: supportedCodexVersionReader,
            afterPathMutation: { destination in
                guard destination == zshRC else { return }
                try laterSave.write(to: destination, options: .atomic)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o600],
                    ofItemAtPath: destination.path
                )
            }
        )

        var errorDescription = ""
        do {
            try manager.enable()
            Issue.record("a post-exchange save must fail closed")
        } catch let error as CodexAutoConnectError {
            errorDescription = error.localizedDescription
        }
        #expect(try Data(contentsOf: fixture.zshRC) == Data("export ORIGINAL=1\n".utf8))
        let recoveryFiles = try FileManager.default.contentsOfDirectory(
            at: fixture.home,
            includingPropertiesForKeys: nil
        ).filter {
            $0.lastPathComponent.hasPrefix("..zshrc.")
                && $0.lastPathComponent.hasSuffix(".tmp")
        }
        #expect(recoveryFiles.count == 1)
        if let recovery = recoveryFiles.first {
            #expect(try Data(contentsOf: recovery) == laterSave)
            #expect(errorDescription.contains(fixture.home.path))
            #expect(errorDescription.contains(recovery.lastPathComponent))
        }
    }

    @Test("unlink removes only the captured inode and preserves a later same-name save")
    func unlinkPreservesLaterSameNameSave() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        try fixture.manager.enable()
        let laterSave = Data("export USER_SAVE=kept\n".utf8)
        let zshRC = fixture.zshRC
        let manager = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: fixture.applicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: fixture.official,
            codexVersionReader: supportedCodexVersionReader,
            afterPathMutation: { original in
                guard original == zshRC else { return }
                try laterSave.write(to: original)
                try FileManager.default.setAttributes(
                    [.posixPermissions: 0o600],
                    ofItemAtPath: original.path
                )
            }
        )

        try manager.disable()
        #expect(try Data(contentsOf: fixture.zshRC) == laterSave)
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
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

    @Test("live discovery ignores recursive entries and stores the normalized stable source")
    func liveDiscoveryUsesNormalizedStableSource() throws {
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
            environment: ["PATH": "relative:\(recursiveDirectory.path):\(officialDirectory.path)"],
            versionReader: supportedCodexVersionReader
        )

        try manager.enable()
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        #expect(try managedOfficialCodexPath(managed) == normalizedStablePath(stableEntry))
    }

    @Test("live discovery skips an earlier unsupported Codex candidate")
    func liveDiscoverySkipsUnsupportedCandidate() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let unsupportedDirectory = fixture.root.appendingPathComponent("unsupported", isDirectory: true)
        let supportedDirectory = fixture.root.appendingPathComponent("supported", isDirectory: true)
        try FileManager.default.createDirectory(at: unsupportedDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: supportedDirectory, withIntermediateDirectories: true)
        let unsupportedEntry = unsupportedDirectory.appendingPathComponent("codex")
        let supportedEntry = supportedDirectory.appendingPathComponent("codex")
        try fixture.writeExecutable(unsupportedEntry, body: "exit 0")
        try fixture.writeExecutable(supportedEntry, body: "exit 0")
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": "\(unsupportedDirectory.path):\(supportedDirectory.path)"],
            versionReader: { candidate in
                candidate.standardizedFileURL == unsupportedEntry.standardizedFileURL
                    ? "0.147.0" : "0.150.1"
            }
        )

        try manager.enable()
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        #expect(try managedOfficialCodexPath(managed) == normalizedStablePath(supportedEntry))
        #expect(try managedOfficialCodexPath(managed) != normalizedStablePath(unsupportedEntry))
    }

    @Test("absolute ZDOTDIR is persisted and reused when a later process lacks the environment")
    func absoluteZDOTDIRRoundTrip() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let zDotDirectory = fixture.home.appendingPathComponent("zsh config", isDirectory: true)
        try FileManager.default.createDirectory(
            at: zDotDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let discoveryDirectory = fixture.root.appendingPathComponent("zdot-codex-bin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: discoveryDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createSymbolicLink(
            at: discoveryDirectory.appendingPathComponent("codex"),
            withDestinationURL: fixture.official
        )
        let environment = [
            "PATH": discoveryDirectory.path,
            "ZDOTDIR": zDotDirectory.path,
        ]
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: environment,
            versionReader: supportedCodexVersionReader
        )
        let selectedZshRC = zDotDirectory.appendingPathComponent(".zshrc")
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )

        try manager.enable()
        #expect(FileManager.default.fileExists(atPath: selectedZshRC.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.zshRC.path))
        #expect(try String(contentsOf: managed, encoding: .utf8).contains(
            Data(selectedZshRC.path.utf8).base64EncodedString()
        ))

        try Data("export ZDOTDIR=$HOME/unknown-at-runtime\n".utf8).write(
            to: fixture.home.appendingPathComponent(".zshenv")
        )
        let restarted = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": discoveryDirectory.path],
            versionReader: supportedCodexVersionReader
        )
        #expect(restarted.state() == .enabled)
        try restarted.disable()
        #expect(!FileManager.default.fileExists(atPath: selectedZshRC.path))
        #expect(!FileManager.default.fileExists(atPath: managed.path))
    }

    @Test("relative ZDOTDIR or indirect zshenv configuration fails closed")
    func unsupportedZDOTDIRFailsClosed() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let relative = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": fixture.official.deletingLastPathComponent().path, "ZDOTDIR": "relative"],
            versionReader: supportedCodexVersionReader
        )
        guard case .unavailable = relative.state() else {
            Issue.record("relative ZDOTDIR must be unavailable")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try relative.enable() }

        try Data("source \"$HOME/.config/zsh/environment\"\n".utf8).write(
            to: fixture.home.appendingPathComponent(".zshenv")
        )
        let dynamic = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": fixture.official.deletingLastPathComponent().path],
            versionReader: supportedCodexVersionReader
        )
        guard case .unavailable = dynamic.state() else {
            Issue.record("indirect .zshenv configuration must be unavailable without installed metadata")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try dynamic.enable() }
    }

    @Test("explicit ZDOTDIR still rejects executable initial zshenv content")
    func explicitZDOTDIRStartupFileFailsClosed() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let zDotDirectory = fixture.home.appendingPathComponent("explicit-zdot", isDirectory: true)
        try FileManager.default.createDirectory(
            at: zDotDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try Data("source /tmp/dynamic-zdotdir\n".utf8).write(
            to: zDotDirectory.appendingPathComponent(".zshenv")
        )
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: [
                "PATH": fixture.official.deletingLastPathComponent().path,
                "ZDOTDIR": zDotDirectory.path,
            ],
            versionReader: supportedCodexVersionReader
        )

        guard case let .unavailable(reason) = manager.state() else {
            Issue.record("explicit ZDOTDIR with executable .zshenv must be unavailable")
            return
        }
        #expect(reason.contains("초기 ZDOTDIR"))
        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
        #expect(!FileManager.default.fileExists(
            atPath: zDotDirectory.appendingPathComponent(".zshrc").path
        ))
    }

    @Test("a v2 managed file without its zshrc path is never treated as legacy")
    func damagedV2PathDoesNotRepairHomeZshRC() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let zDotDirectory = fixture.home.appendingPathComponent("custom-zdotdir", isDirectory: true)
        try FileManager.default.createDirectory(
            at: zDotDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let discoveryDirectory = fixture.root.appendingPathComponent("v2-codex-bin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: discoveryDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createSymbolicLink(
            at: discoveryDirectory.appendingPathComponent("codex"),
            withDestinationURL: fixture.official
        )
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: [
                "PATH": discoveryDirectory.path,
                "ZDOTDIR": zDotDirectory.path,
            ],
            versionReader: supportedCodexVersionReader
        )
        try manager.enable()
        let selectedZshRC = zDotDirectory.appendingPathComponent(".zshrc")
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        let homeContents = Data("export HOME_FILE_MUST_STAY=1\n".utf8)
        try homeContents.write(to: fixture.zshRC)
        let damaged = try String(contentsOf: managed, encoding: .utf8)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.hasPrefix("# zshrc-path-base64: ") }
            .joined(separator: "\n")
        try Data(damaged.utf8).write(to: managed, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: managed.path
        )

        let restarted = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": discoveryDirectory.path],
            versionReader: supportedCodexVersionReader
        )
        guard case .conflict = restarted.state() else {
            Issue.record("a damaged v2 file must be a conflict")
            return
        }
        #expect(throws: CodexAutoConnectError.self) { try restarted.enable() }
        #expect(throws: CodexAutoConnectError.self) { try restarted.disable() }
        #expect(try Data(contentsOf: fixture.zshRC) == homeContents)
        #expect(try String(contentsOf: selectedZshRC, encoding: .utf8).contains(
            ">>> Blabee Codex Auto Connect v1 >>>"
        ))
    }

    @Test(arguments: [".local/bin", ".nvm/versions/node/v22.1.0/bin"])
    func liveDiscoveryUsesKnownUserInstallLocations(relativeDirectory: String) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let directory = fixture.home.appendingPathComponent(relativeDirectory, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let stableEntry = directory.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(at: stableEntry, withDestinationURL: fixture.official)
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": "relative"],
            versionReader: supportedCodexVersionReader
        )

        try manager.enable()
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        #expect(try managedOfficialCodexPath(managed) == normalizedStablePath(stableEntry))
    }

    @Test(arguments: [".volta/bin", ".asdf/shims"])
    func liveDiscoveryExcludesDynamicShims(relativeDirectory: String) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let shimDirectory = fixture.home.appendingPathComponent(relativeDirectory, isDirectory: true)
        let stableDirectory = fixture.home.appendingPathComponent(".local/bin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: shimDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: stableDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let shim = shimDirectory.appendingPathComponent("codex")
        let stable = stableDirectory.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(at: shim, withDestinationURL: fixture.official)
        try FileManager.default.createSymbolicLink(at: stable, withDestinationURL: fixture.official)
        let versionPaths = CodexVersionPathProbe()
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": shimDirectory.path],
            versionReader: { url in versionPaths.read(for: url) }
        )

        try manager.enable()
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        #expect(try managedOfficialCodexPath(managed) == normalizedStablePath(stable))
        #expect(try managedOfficialCodexPath(managed) != shim.path)
        #expect(!versionPaths.paths.contains(shim.standardizedFileURL.path))
    }

    @Test(arguments: ["ASDF_DATA_DIR", "VOLTA_HOME"])
    func liveDiscoveryReportsCustomDynamicShimRoots(environmentName: String) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let customRoot = fixture.home.appendingPathComponent(
            "custom-\(environmentName.lowercased())",
            isDirectory: true
        )
        let shimDirectory = customRoot.appendingPathComponent(
            environmentName == "ASDF_DATA_DIR" ? "shims" : "bin",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: shimDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let shim = shimDirectory.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(at: shim, withDestinationURL: fixture.official)
        let versionPaths = CodexVersionPathProbe()
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: [
                "PATH": shimDirectory.path,
                environmentName: customRoot.path,
            ],
            versionReader: { url in
                _ = versionPaths.read(for: url)
                return nil
            }
        )

        guard case let .unavailable(reason) = manager.state() else {
            Issue.record("custom dynamic shim must be unavailable")
            return
        }
        #expect(reason.contains(environmentName))
        #expect(reason.contains("실제 Codex 실행 파일"))
        #expect(!versionPaths.paths.contains(shim.standardizedFileURL.path))
        #expect(throws: CodexAutoConnectError.self) { try manager.enable() }
    }

    @Test("refresh never executes a custom shim persisted by an older installation")
    func persistedCustomShimIsRejectedBeforeVersionProbe() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let customVoltaHome = fixture.home.appendingPathComponent(
            "custom-volta-home",
            isDirectory: true
        )
        let shimDirectory = customVoltaHome.appendingPathComponent("bin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: shimDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let persistedShim = shimDirectory.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(
            at: persistedShim,
            withDestinationURL: fixture.official
        )
        let liveApplicationSupport = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee",
            isDirectory: true
        )
        let liveManaged = liveApplicationSupport.appendingPathComponent(
            "shell/v1/codex-auto-connect.zsh",
            isDirectory: false
        )

        // Simulate metadata written by an older build that did not recognize
        // a custom VOLTA_HOME as a dynamic shim root.
        let legacyWriter = CodexAutoConnectManager(
            homeURL: fixture.home,
            applicationSupportURL: liveApplicationSupport,
            coordinatorURL: fixture.coordinator,
            officialCodexURL: persistedShim,
            codexVersionReader: supportedCodexVersionReader
        )
        try legacyWriter.enable()

        let versionPaths = CodexVersionPathProbe()
        let refreshed = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: [
                "PATH": fixture.official.deletingLastPathComponent().path,
                "VOLTA_HOME": customVoltaHome.path,
            ],
            versionReader: { url in versionPaths.read(for: url) }
        )

        guard case let .repairRequired(reason) = refreshed.state() else {
            Issue.record("persisted custom shim must require repair")
            return
        }
        #expect(reason.contains("shim"))
        #expect(!versionPaths.paths.contains(persistedShim.standardizedFileURL.path))
        try refreshed.disable()
        #expect(!FileManager.default.fileExists(atPath: liveManaged.path))
    }

    @Test("a real unsupported candidate takes precedence over an excluded shim")
    func liveDiscoveryReportsStableQualificationBeforeShimExclusion() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let unsupportedDirectory = fixture.root.appendingPathComponent("unsupported-bin", isDirectory: true)
        let asdfData = fixture.home.appendingPathComponent("custom-asdf", isDirectory: true)
        let shimDirectory = asdfData.appendingPathComponent("shims", isDirectory: true)
        try FileManager.default.createDirectory(
            at: unsupportedDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: shimDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let unsupported = unsupportedDirectory.appendingPathComponent("codex")
        try fixture.writeExecutable(unsupported, body: "exit 0")
        try FileManager.default.createSymbolicLink(
            at: shimDirectory.appendingPathComponent("codex"),
            withDestinationURL: fixture.official
        )
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: [
                "PATH": "\(unsupportedDirectory.path):\(shimDirectory.path)",
                "ASDF_DATA_DIR": asdfData.path,
            ],
            versionReader: { candidate in
                candidate.standardizedFileURL == unsupported.standardizedFileURL
                    ? "0.147.0" : nil
            }
        )

        guard case let .unavailable(reason) = manager.state() else {
            Issue.record("unsupported real candidate must remain the primary diagnosis")
            return
        }
        #expect(reason.contains("0.147.0"))
        #expect(!reason.contains("shim"))
    }

    @Test("live discovery never executes a candidate from a writable directory")
    func liveDiscoveryRejectsUnsafeWritableCandidateBeforeVersion() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let unsafeDirectory = fixture.root.appendingPathComponent("unsafe-bin", isDirectory: true)
        let stableDirectory = fixture.home.appendingPathComponent(".local/bin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: unsafeDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o777]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o777],
            ofItemAtPath: unsafeDirectory.path
        )
        try FileManager.default.createDirectory(
            at: stableDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let unsafe = unsafeDirectory.appendingPathComponent("codex")
        let stable = stableDirectory.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(at: unsafe, withDestinationURL: fixture.official)
        try FileManager.default.createSymbolicLink(at: stable, withDestinationURL: fixture.official)
        let versionPaths = CodexVersionPathProbe()
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": unsafeDirectory.path],
            versionReader: { url in versionPaths.read(for: url) }
        )

        try manager.enable()
        #expect(!versionPaths.paths.contains(unsafe.standardizedFileURL.path))
        #expect(versionPaths.paths.contains(fixture.official.standardizedFileURL.path))
    }

    @Test(arguments: [0o770, 0o750])
    func liveDiscoveryRejectsGroupWritableOrACLCandidateBeforeVersion(mode: Int) throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let unsafeDirectory = fixture.root.appendingPathComponent(
            "group-or-acl-bin-\(mode)",
            isDirectory: true
        )
        let stableDirectory = fixture.home.appendingPathComponent(".local/bin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: unsafeDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: stableDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let unsafeExecutable = unsafeDirectory.appendingPathComponent("codex")
        try fixture.writeExecutable(unsafeExecutable, body: "exit 0")
        if mode == 0o770 {
            try FileManager.default.setAttributes(
                [.posixPermissions: mode],
                ofItemAtPath: unsafeDirectory.path
            )
        } else {
            try replaceAccessControlList(
                with: "user:\(NSUserName()) allow read,write",
                at: unsafeDirectory
            )
        }
        try FileManager.default.createSymbolicLink(
            at: stableDirectory.appendingPathComponent("codex"),
            withDestinationURL: fixture.official
        )
        let versionPaths = CodexVersionPathProbe()
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": unsafeDirectory.path],
            versionReader: { url in versionPaths.read(for: url) }
        )

        try manager.enable()
        #expect(!versionPaths.paths.contains(unsafeExecutable.standardizedFileURL.path))
        #expect(versionPaths.paths.contains(fixture.official.standardizedFileURL.path))
    }

    @Test("live discovery honors an absolute NVM_BIN outside the GUI PATH")
    func liveDiscoveryUsesNVMEnvironment() throws {
        let fixture = try AutoConnectFixture()
        defer { fixture.remove() }
        let nvmBin = fixture.root.appendingPathComponent("active nvm/bin", isDirectory: true)
        try FileManager.default.createDirectory(at: nvmBin, withIntermediateDirectories: true)
        let stableEntry = nvmBin.appendingPathComponent("codex")
        try FileManager.default.createSymbolicLink(at: stableEntry, withDestinationURL: fixture.official)
        let manager = try CodexAutoConnectManager.live(
            homeURL: fixture.home,
            coordinatorURL: fixture.coordinator,
            environment: ["PATH": "relative", "NVM_BIN": nvmBin.path],
            versionReader: supportedCodexVersionReader
        )

        try manager.enable()
        let managed = fixture.home.appendingPathComponent(
            "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh"
        )
        #expect(try managedOfficialCodexPath(managed) == normalizedStablePath(stableEntry))
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
    var stableLauncher: URL {
        applicationSupport.appendingPathComponent("shell/v1/codex-stable-launcher")
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
            officialCodexURL: official,
            codexVersionReader: supportedCodexVersionReader
        )
        try writeExecutable(
            coordinator,
            body: "printf 'coordinator-env:<%s><%s><%s><%s><%s>\\n' \"${BLABEE_COORDINATOR_BINARY-unset}\" \"${BLABEE_SOCKET-unset}\" \"${BLABEE_MANAGED_APPROVALS-unset}\" \"${BLABEE_MANAGED_CODEX_AUTH_TOKEN-unset}\" \"${BLABEE_RUNTIME_IDENTITY-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'socket:%s\\n' \"${BLABEE_SOCKET-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'coordinator:' >> \"$BLABEE_TEST_LOG\"\nfor value in \"$@\"; do printf '<%s>' \"$value\" >> \"$BLABEE_TEST_LOG\"; done\nprintf '\\n' >> \"$BLABEE_TEST_LOG\""
        )
        if !officialIsCoordinator {
            try writeExecutable(
                official,
                body: "if [[ ${1-} == --version ]]; then\n  printf 'codex-cli 0.150.1\\n'\n  if [[ -z ${BLABEE_TEST_LOG-} ]]; then exit 0; fi\nfi\nprintf 'official-env:<%s><%s><%s><%s><%s>\\n' \"${BLABEE_COORDINATOR_BINARY-unset}\" \"${BLABEE_SOCKET-unset}\" \"${BLABEE_MANAGED_APPROVALS-unset}\" \"${BLABEE_MANAGED_CODEX_AUTH_TOKEN-unset}\" \"${BLABEE_RUNTIME_IDENTITY-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'official-socket:%s\\n' \"${BLABEE_SOCKET-unset}\" >> \"$BLABEE_TEST_LOG\"\nprintf 'official:' >> \"$BLABEE_TEST_LOG\"\nfor value in \"$@\"; do printf '<%s>' \"$value\" >> \"$BLABEE_TEST_LOG\"; done\nprintf '\\n' >> \"$BLABEE_TEST_LOG\""
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

    func runCodexCapturingError(
        _ arguments: [String],
        environment: [String: String]
    ) throws -> (status: Int32, error: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-f", "-c", "source \"$1\"; shift; codex \"$@\"", "test", managed.path,
        ] + arguments
        process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
        let error = Pipe()
        process.standardError = error
        try process.run()
        process.waitUntilExit()
        return (
            process.terminationStatus,
            String(decoding: error.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }
}

private enum AutoConnectFixtureError: Error {
    case raceSetup
    case extendedAttribute
    case accessControlList
    case managedMetadata
}

private func normalizedStablePath(_ url: URL) -> String {
    let stable = url.standardizedFileURL
    guard let resolvedParent = realpath(stable.deletingLastPathComponent().path, nil) else {
        return stable.path
    }
    defer { free(resolvedParent) }
    return URL(
        fileURLWithPath: String(cString: resolvedParent),
        isDirectory: true
    ).appendingPathComponent(stable.lastPathComponent, isDirectory: false).path
}

private func managedOfficialCodexPath(_ managed: URL) throws -> String {
    let prefix = "# official-codex-path-base64: "
    let contents = try String(contentsOf: managed, encoding: .utf8)
    guard let line = contents.split(separator: "\n").first(where: { $0.hasPrefix(prefix) }),
          let data = Data(base64Encoded: String(line.dropFirst(prefix.count))),
          let path = String(data: data, encoding: .utf8)
    else {
        throw AutoConnectFixtureError.managedMetadata
    }
    return path
}

private func legacyManagedData(
    schema: String,
    coordinatorURL: URL,
    officialCodexURL: URL,
    zshRCURL: URL,
    zshRCWasMissing: Bool
) -> Data {
    let coordinator = shellQuoteForFixture(coordinatorURL.path)
    let official = shellQuoteForFixture(officialCodexURL.path)
    let header = "# Blabee Codex Auto Connect \(schema)\n"
    let coordinatorMetadata = Data(coordinatorURL.path.utf8).base64EncodedString()
    let officialMetadata = Data(officialCodexURL.path.utf8).base64EncodedString()
    let zshRCMetadata = schema == "v1"
        ? ""
        : "# zshrc-path-base64: \(Data(zshRCURL.path.utf8).base64EncodedString())\n"
    if schema == "v3" {
        return Data((
            header
                + "# Generated by Blabee. Do not edit.\n"
                + "# zshrc-origin: \(zshRCWasMissing ? "missing" : "present")\n"
                + "# coordinator-path-base64: \(coordinatorMetadata)\n"
                + "# official-codex-path-base64: \(officialMetadata)\n"
                + zshRCMetadata
                + "\n"
                + "if (( $+aliases[codex] )); then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
                + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v2 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v3 \"$@\"' ]]; then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\n"
                + "else\n"
                + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
                + "  function _blabee_codex_auto_connect_v3 {\n"
                + "    local _blabee_coordinator=\(coordinator)\n"
                + "    local _blabee_official=\(official)\n"
                + "    if [[ ! -x \"$_blabee_coordinator\" ]]; then\n"
                + "      print -u2 -- \"Blabee 실행기를 찾을 수 없어 Codex를 자동 실행하지 않았습니다. Blabee를 복구하거나 $_blabee_official 을 직접 실행하세요.\"\n"
                + "      return 127\n"
                + "    fi\n"
                + "    (\n"
                + "      unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "      exec \"$_blabee_coordinator\" codex-launch -- \"$@\"\n"
                + "    )\n"
                + "  }\n"
                + "  function codex { _blabee_codex_auto_connect_v3 \"$@\" }\n"
                + "fi\n"
        ).utf8)
    }
    return Data((
        header
            + "# Generated by Blabee. Do not edit.\n"
            + "# zshrc-origin: \(zshRCWasMissing ? "missing" : "present")\n"
            + "# coordinator-path-base64: \(coordinatorMetadata)\n"
            + "# official-codex-path-base64: \(officialMetadata)\n"
            + zshRCMetadata
            + "\n"
            + "if (( $+aliases[codex] )); then\n"
            + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
            + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]]; then\n"
            + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\n"
            + "else\n"
            + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
            + "  function _blabee_codex_auto_connect_v1 {\n"
            + "    local _blabee_coordinator=\(coordinator)\n"
            + "    local _blabee_official=\(official)\n"
            + "    if (( $# == 0 )) || [[ $1 == resume ]]; then\n"
            + "      if [[ ! -x \"$_blabee_coordinator\" ]]; then\n"
            + "        (\n"
            + "          unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
            + "          command \"$_blabee_official\" \"$@\"\n"
            + "        )\n"
            + "        return $?\n"
            + "      fi\n"
            + "      (\n"
            + "        unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
            + "        command \"$_blabee_coordinator\" managed-codex --codex \"$_blabee_official\" -- \"$@\"\n"
            + "      )\n"
            + "      return $?\n"
            + "    fi\n"
            + "    (\n"
            + "      unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
            + "      command \"$_blabee_official\" \"$@\"\n"
            + "    )\n"
            + "  }\n"
            + "  function codex { _blabee_codex_auto_connect_v1 \"$@\" }\n"
            + "fi\n"
    ).utf8)
}

private func shellQuoteForFixture(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

private final class AccessControlListProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var storedValue: Data?

    var value: Data? {
        get { lock.withLock { storedValue } }
        set { lock.withLock { storedValue = newValue } }
    }
}

private final class CodexVersionSequenceProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let versions: [String?]
    private var calls = 0

    init(_ versions: [String?]) {
        self.versions = versions
    }

    var callCount: Int {
        lock.withLock { calls }
    }

    func read(for _: URL) -> String? {
        lock.withLock {
            let index = min(calls, max(0, versions.count - 1))
            calls += 1
            return versions.isEmpty ? nil : versions[index]
        }
    }
}

private final class CodexVersionPathProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var recordedPaths: [String] = []

    var paths: [String] {
        lock.withLock { recordedPaths }
    }

    func read(for url: URL) -> String? {
        lock.withLock {
            recordedPaths.append(url.standardizedFileURL.path)
        }
        return "0.150.1"
    }
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

private func replaceAccessControlList(with entry: String, at url: URL) throws {
    for arguments in [["-N", url.path], ["+a", entry, url.path]] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/chmod")
        process.arguments = arguments
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw AutoConnectFixtureError.accessControlList
        }
    }
}

private func accessControlList(at url: URL) throws -> Data? {
    let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else { throw AutoConnectFixtureError.accessControlList }
    defer { close(descriptor) }
    errno = 0
    guard let acl = acl_get_fd(descriptor) else {
        if errno == ENOENT { return nil }
        throw AutoConnectFixtureError.accessControlList
    }
    defer { acl_free(UnsafeMutableRawPointer(acl)) }
    var length: ssize_t = 0
    guard let text = acl_to_text(acl, &length), length >= 0 else {
        throw AutoConnectFixtureError.accessControlList
    }
    defer { acl_free(text) }
    return Data(bytes: text, count: Int(length))
}

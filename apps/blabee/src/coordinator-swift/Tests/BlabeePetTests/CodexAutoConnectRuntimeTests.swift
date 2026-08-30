import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Codex auto-connect runtime approval", .serialized)
struct CodexAutoConnectRuntimeTests {
    @Test("unchanged launches use the durable approval without another version probe")
    func unchangedFastPath() throws {
        let fixture = try AutoConnectRuntimeFixture(versions: ["0.150.1"])
        defer { fixture.remove() }

        try fixture.manager.enable()
        let approvalBefore = try Data(contentsOf: fixture.approval)
        let first = try fixture.manager.approvedCodexForLaunch()
        let second = try fixture.manager.approvedCodexForLaunch()

        #expect(fixture.versions.callCount == 1)
        #expect(first == second)
        #expect(first.canonicalURL == first.stableSourceURL)
        #expect(try Data(contentsOf: fixture.approval) == approvalBefore)
        #expect(try fileMode(fixture.approval) == 0o600)
    }

    @Test("a supported executable change is requalified once and published")
    func supportedDriftRequalifiesOnce() throws {
        let fixture = try AutoConnectRuntimeFixture(
            versions: ["0.150.1", "0.151.0"]
        )
        defer { fixture.remove() }

        try fixture.manager.enable()
        let before = try Data(contentsOf: fixture.approval)
        try fixture.replaceOfficial(marker: "supported-update")

        let updated = try fixture.manager.approvedCodexForLaunch()
        _ = try fixture.manager.approvedCodexForLaunch()

        #expect(fixture.versions.callCount == 2)
        #expect(updated.qualifiedVersion == "0.151.0")
        #expect(try Data(contentsOf: fixture.approval) != before)
    }

    @Test("an unsupported executable change is blocked without replacing approval")
    func unsupportedDriftFailsClosed() throws {
        let fixture = try AutoConnectRuntimeFixture(
            versions: ["0.150.1", "0.147.0"]
        )
        defer { fixture.remove() }

        try fixture.manager.enable()
        let before = try Data(contentsOf: fixture.approval)
        try fixture.replaceOfficial(marker: "unsupported-update")

        #expect(throws: CodexAutoConnectError.self) {
            _ = try fixture.manager.approvedCodexForLaunch()
        }
        #expect(fixture.versions.callCount == 2)
        #expect(try Data(contentsOf: fixture.approval) == before)
    }

    @Test("disable removes managed state but keeps a native-only stable launcher")
    func disableRemovesRuntimeApproval() throws {
        let fixture = try AutoConnectRuntimeFixture(versions: ["0.150.1"])
        defer { fixture.remove() }

        try fixture.manager.enable()
        #expect(FileManager.default.fileExists(atPath: fixture.approval.path))
        #expect(FileManager.default.fileExists(atPath: fixture.managed.path))
        #expect(FileManager.default.fileExists(atPath: fixture.stableLauncher.path))
        let stableLauncherBeforeDisable = try Data(contentsOf: fixture.stableLauncher)

        try fixture.manager.disable()

        #expect(!FileManager.default.fileExists(atPath: fixture.approval.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.managed.path))
        #expect(try Data(contentsOf: fixture.stableLauncher) == stableLauncherBeforeDisable)
        #expect(fixture.manager.state() == .disabled)
    }

    @Test("runtime authority allows deny-only ACLs and rejects permission grants")
    func runtimeAuthorityACLPolicy() throws {
        let fixture = try AutoConnectRuntimeFixture(versions: ["0.150.1"])
        defer { fixture.remove() }
        try fixture.manager.enable()
        let shellDirectory = fixture.approval.deletingLastPathComponent()

        try addAutoConnectRuntimeACL(
            "group:everyone deny delete",
            to: fixture.approval
        )
        try addAutoConnectRuntimeACL(
            "group:everyone deny delete",
            to: shellDirectory
        )
        _ = try fixture.manager.approvedCodexForLaunch()

        try addAutoConnectRuntimeACL(
            "user:\(NSUserName()) allow read",
            to: fixture.approval
        )
        #expect(throws: CodexAutoConnectError.self) {
            _ = try fixture.manager.approvedCodexForLaunch()
        }
    }

    @Test("a permission-granting ACL on the private shell directory fails closed")
    func runtimeDirectoryGrantFailsClosed() throws {
        let fixture = try AutoConnectRuntimeFixture(versions: ["0.150.1"])
        defer { fixture.remove() }
        try fixture.manager.enable()
        try addAutoConnectRuntimeACL(
            "user:\(NSUserName()) allow read",
            to: fixture.approval.deletingLastPathComponent()
        )

        #expect(throws: CodexAutoConnectError.self) {
            _ = try fixture.manager.approvedCodexForLaunch()
        }
        #expect(fixture.manager.state() != .enabled)
    }

    @Test("state never reports enabled for a group-writable private shell directory")
    func stateRejectsGroupWritableRuntimeDirectory() throws {
        let fixture = try AutoConnectRuntimeFixture(versions: ["0.150.1"])
        defer { fixture.remove() }
        try fixture.manager.enable()
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o770],
            ofItemAtPath: fixture.approval.deletingLastPathComponent().path
        )

        #expect(fixture.manager.state() != .enabled)
        #expect(throws: CodexAutoConnectError.self) {
            _ = try fixture.manager.approvedCodexForLaunch()
        }
    }

    @Test("managed provider qualifies once then reuses the pinned executable")
    func managedProviderQualifiesOnce() throws {
        let fixture = try AutoConnectRuntimeFixture(
            versions: ["0.150.1", "0.151.0"]
        )
        defer { fixture.remove() }

        try fixture.manager.enable()
        try fixture.replaceOfficial(marker: "supported-before-first-managed-launch")
        let provider = CodexAutoConnectApprovedExecutableProvider(
            manager: fixture.manager
        )
        let executableProvider: ManagedCodexExecutableProvider = provider.next

        let first = try executableProvider()
        let second = try executableProvider()

        #expect(first == second)
        #expect(fixture.versions.callCount == 2)
    }

    @Test("managed provider rejects a newly qualified executable after pinning")
    func managedProviderRejectsLaterReplacement() throws {
        let fixture = try AutoConnectRuntimeFixture(
            versions: ["0.150.1", "0.151.0"]
        )
        defer { fixture.remove() }

        try fixture.manager.enable()
        let provider = CodexAutoConnectApprovedExecutableProvider(
            manager: fixture.manager
        )
        let pinned = try provider.next()

        try fixture.replaceOfficial(marker: "supported-after-managed-launch")
        let replacement = try fixture.manager.approvedCodexForLaunch()
        #expect(replacement.canonicalURL == pinned)
        #expect(replacement.qualifiedVersion == "0.151.0")

        #expect(throws: CodexAutoConnectError.self) {
            _ = try provider.next()
        }
        #expect(fixture.versions.callCount == 2)
    }

    @Test("concurrent first managed requests share one pinned qualification")
    func managedProviderSerializesConcurrentFirstCalls() async throws {
        let fixture = try AutoConnectRuntimeFixture(
            versions: ["0.150.1", "0.151.0"]
        )
        defer { fixture.remove() }

        try fixture.manager.enable()
        try fixture.replaceOfficial(marker: "concurrent-supported-update")
        let provider = CodexAutoConnectApprovedExecutableProvider(
            manager: fixture.manager
        )

        let paths = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<16 {
                group.addTask {
                    try provider.next().path
                }
            }
            var values: [String] = []
            for try await value in group {
                values.append(value)
            }
            return values
        }

        #expect(Set(paths).count == 1)
        #expect(fixture.versions.callCount == 2)
    }

    private func fileMode(_ url: URL) throws -> mode_t {
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            throw AutoConnectRuntimeFixtureError.statFailed
        }
        return info.st_mode & 0o7777
    }
}

private final class AutoConnectRuntimeFixture {
    let root: URL
    let home: URL
    let applicationSupport: URL
    let coordinator: URL
    let official: URL
    let versions: AutoConnectRuntimeVersionProbe
    let manager: CodexAutoConnectManager

    var approval: URL {
        applicationSupport.appendingPathComponent(
            "shell/v1/codex-runtime-approval.json",
            isDirectory: false
        )
    }

    var managed: URL {
        applicationSupport.appendingPathComponent(
            "shell/v1/codex-auto-connect.zsh",
            isDirectory: false
        )
    }

    var stableLauncher: URL {
        applicationSupport.appendingPathComponent(
            "shell/v1/codex-stable-launcher",
            isDirectory: false
        )
    }

    init(versions rawVersions: [String?]) throws {
        let temporaryRoot = FileManager.default.temporaryDirectory
            .resolvingSymlinksInPath()
        root = temporaryRoot.appendingPathComponent(
            "blabee-runtime-manager-\(UUID().uuidString)",
            isDirectory: true
        )
        home = root.appendingPathComponent("home", isDirectory: true)
        applicationSupport = root.appendingPathComponent(
            "Application Support/Blabee",
            isDirectory: true
        )
        coordinator = root.appendingPathComponent("bin/blabee-coordinator")
        official = root.appendingPathComponent("bin/codex")
        versions = AutoConnectRuntimeVersionProbe(rawVersions)

        try FileManager.default.createDirectory(
            at: home,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: coordinator.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try Self.writeExecutable(coordinator, marker: "coordinator")
        try Self.writeExecutable(official, marker: "initial")

        manager = CodexAutoConnectManager(
            homeURL: home,
            applicationSupportURL: applicationSupport,
            coordinatorURL: coordinator,
            officialCodexURL: official,
            officialCodexSourceURL: official,
            codexVersionReader: { [versions] url in versions.read(url) }
        )
    }

    func replaceOfficial(marker: String) throws {
        let replacement = official.deletingLastPathComponent().appendingPathComponent(
            ".codex-\(UUID().uuidString)"
        )
        try Self.writeExecutable(replacement, marker: marker)
        guard rename(replacement.path, official.path) == 0 else {
            throw AutoConnectRuntimeFixtureError.replaceFailed
        }
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static func writeExecutable(_ url: URL, marker: String) throws {
        let data = Data("#!/bin/zsh\nprintf '%s\\n' '\(marker)'\n".utf8)
        try data.write(to: url, options: .withoutOverwriting)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: url.path
        )
    }
}

private final class AutoConnectRuntimeVersionProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let versions: [String?]
    private var calls = 0

    init(_ versions: [String?]) {
        self.versions = versions
    }

    var callCount: Int {
        lock.withLock { calls }
    }

    func read(_ url: URL) -> String? {
        lock.withLock {
            guard !versions.isEmpty else { return nil }
            let index = min(calls, versions.count - 1)
            calls += 1
            _ = url
            return versions[index]
        }
    }
}

private enum AutoConnectRuntimeFixtureError: Error {
    case aclSetup(String)
    case replaceFailed
    case statFailed
}

private func addAutoConnectRuntimeACL(_ rule: String, to url: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/chmod")
    process.arguments = ["+a", rule, url.path]
    process.standardOutput = Pipe()
    let error = Pipe()
    process.standardError = error
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        let message = String(
            data: error.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? "unknown chmod error"
        throw AutoConnectRuntimeFixtureError.aclSetup(message)
    }
}

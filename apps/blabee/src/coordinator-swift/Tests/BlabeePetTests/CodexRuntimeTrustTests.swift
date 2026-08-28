import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("CodexRuntimeTrust", .serialized)
struct CodexRuntimeTrustTests {
    @Test("unchanged strict path qualifies once and revalidates without a version read")
    func strictUnchangedApproval() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let gate = fixture.gate(monitored: false)
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        let approval = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )
        let executable = try gate.revalidate(approval: approval)

        #expect(versions.callCount == 1)
        #expect(executable.stableSourceURL.path == fixture.source.path)
        #expect(executable.canonicalURL.path == fixture.target.path)
        #expect(executable.qualifiedVersion == "0.150.1")
        #expect(executable.targetIdentity == approval.targetIdentity)
    }

    @Test("non-Homebrew group-writable ancestry is rejected before version execution")
    func nonHomebrewGroupWriteFailsBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: true)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try fixture.gate(monitored: false).qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
        }
        #expect(versions.callCount == 0)
    }

    @Test("configured dynamic shim roots are rejected before version execution")
    func dynamicShimFailsBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let gate = CodexRuntimeTrustGate(
            monitoredEntries: [],
            dynamicShimRootURLs: [fixture.source.deletingLastPathComponent()]
        )

        do {
            _ = try gate.qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
            Issue.record("dynamic shim unexpectedly qualified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .dynamicShim("configured"))
        }
        #expect(versions.callCount == 0)
    }

    @Test("an exact monitored Homebrew-style source accepts 0775 ancestors")
    func monitoredHomebrewGroupWriteIsRevalidated() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: true)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let gate = fixture.gate(monitored: true)

        let approval = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )
        let executable = try gate.revalidate(approval: approval)

        #expect(versions.callCount == 1)
        #expect(executable.canonicalURL.path == fixture.target.path)
        #expect(approval.sourceAncestors.contains { $0.identity.mode & 0o020 != 0 })
        #expect(approval.canonicalAncestors.contains { $0.identity.mode & 0o020 != 0 })
    }

    @Test("a monitored Homebrew exception never covers ancestors above its prefix")
    func monitoredHomebrewRejectsGroupWriteAbovePrefix() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o770],
            ofItemAtPath: fixture.root.path
        )
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try fixture.gate(monitored: true).qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
        }
        #expect(versions.callCount == 0)
    }

    @Test("identity drift requests a full qualification and a new approval")
    func driftRequiresFullQualification() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let gate = fixture.gate(monitored: false)
        let versions = RuntimeTrustVersionProbe(["0.150.1", "0.150.1"])
        let first = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )

        try fixture.replaceTargetBody("printf 'updated-runtime-trust-fixture\\n'")
        do {
            _ = try gate.revalidate(approval: first)
            Issue.record("drifted approval unexpectedly revalidated")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .approvalDrift)
        }
        #expect(versions.callCount == 1)

        let second = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )
        #expect(versions.callCount == 2)
        #expect(second.targetIdentity != first.targetIdentity)
        _ = try gate.revalidate(approval: second)
        #expect(versions.callCount == 2)
    }

    @Test("mutation during version qualification cannot publish an approval")
    func mutationDuringQualificationFailsClosed() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let gate = fixture.gate(monitored: false)

        do {
            _ = try gate.qualify(sourceURL: fixture.source) { _ in
                try fixture.replaceTargetBody("printf 'changed-during-version\\n'")
                return "0.150.1"
            }
            Issue.record("a moving executable unexpectedly qualified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .changedDuringQualification)
        }
    }

    @Test("unsupported versions fail after structural inspection")
    func unsupportedVersionFailsClosed() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.149.0"])

        do {
            _ = try fixture.gate(monitored: false).qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
            Issue.record("unsupported Codex unexpectedly qualified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .unsupportedVersion("0.149.0"))
        }
        #expect(versions.callCount == 1)
    }

    @Test("world-writable targets and extended ACLs fail before version execution")
    func targetMetadataFailsClosed() throws {
        let writable = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { writable.remove() }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o777],
            ofItemAtPath: writable.target.path
        )
        let writableVersions = RuntimeTrustVersionProbe(["0.150.1"])
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try writable.gate(monitored: false).qualify(
                sourceURL: writable.source,
                versionReader: { writableVersions.read($0) }
            )
        }
        #expect(writableVersions.callCount == 0)

        let acl = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { acl.remove() }
        try addRuntimeTrustACL(at: acl.target)
        let aclVersions = RuntimeTrustVersionProbe(["0.150.1"])
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try acl.gate(monitored: false).qualify(
                sourceURL: acl.source,
                versionReader: { aclVersions.read($0) }
            )
        }
        #expect(aclVersions.callCount == 0)
    }

    @Test("deny-only ancestor ACLs are allowed but permission grants are not")
    func denyOnlyAncestorACLIsSafe() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try addRuntimeTrustACL(
            at: fixture.prefix,
            rule: "group:everyone deny delete"
        )
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        _ = try fixture.gate(monitored: false).qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )

        #expect(versions.callCount == 1)
    }

    @Test("approval JSON is exact and requires a current-user 0600 record")
    func strictCodableRecord() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let approval = try fixture.gate(monitored: false).qualify(
            sourceURL: fixture.source,
            versionReader: { _ in "0.150.1" }
        )
        let encoded = try approval.encodedData()

        let decoded = try CodexRuntimeApproval.decodeStrict(
            from: encoded,
            fileMode: 0o600,
            fileOwner: geteuid()
        )
        #expect(decoded == approval)
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try CodexRuntimeApproval.decodeStrict(
                from: encoded,
                fileMode: 0o640,
                fileOwner: geteuid()
            )
        }
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try CodexRuntimeApproval.decodeStrict(
                from: encoded,
                fileMode: 0o600,
                fileOwner: geteuid() + 1
            )
        }

        var object = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        object["unexpected"] = true
        let unknownField = try JSONSerialization.data(withJSONObject: object)
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try CodexRuntimeApproval.decodeStrict(
                from: unknownField,
                fileMode: 0o600,
                fileOwner: geteuid()
            )
        }
    }
}

private final class RuntimeTrustFixture: @unchecked Sendable {
    let root: URL
    let prefix: URL
    let source: URL
    let canonicalRoot: URL
    let target: URL

    init(groupWritableAncestors: Bool) throws {
        // Resolve `/var` before constructing the fixture so every lexical
        // ancestor is a real directory and `/var` itself is not mistaken for
        // a symbolic-link ancestor. Deny-only macOS home ACLs are covered by
        // a separate test and are intentionally allowed.
        let temporaryPath = FileManager.default.temporaryDirectory.path
        let realTemporaryPath = temporaryPath.hasPrefix("/var/")
            ? "/private" + temporaryPath
            : temporaryPath
        let base = URL(fileURLWithPath: realTemporaryPath, isDirectory: true)
            .appendingPathComponent("codex-runtime-trust-tests", isDirectory: true)
        try RuntimeTrustFixture.makeDirectory(base, mode: 0o700)
        root = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        prefix = root.appendingPathComponent("homebrew", isDirectory: true)
        source = prefix.appendingPathComponent("bin/codex", isDirectory: false)
        canonicalRoot = prefix.appendingPathComponent("Cellar", isDirectory: true)
        target = canonicalRoot.appendingPathComponent(
            "codex/0.150.1/bin/codex",
            isDirectory: false
        )

        let directories = [
            root,
            prefix,
            source.deletingLastPathComponent(),
            canonicalRoot,
            canonicalRoot.appendingPathComponent("codex", isDirectory: true),
            canonicalRoot.appendingPathComponent("codex/0.150.1", isDirectory: true),
            target.deletingLastPathComponent(),
        ]
        for directory in directories {
            try Self.makeDirectory(
                directory,
                mode: groupWritableAncestors && directory != root ? 0o775 : 0o700
            )
        }
        try replaceTargetBody("printf 'runtime-trust-fixture\\n'")
        try FileManager.default.createSymbolicLink(
            at: source,
            withDestinationURL: target
        )
    }

    func gate(monitored: Bool) -> CodexRuntimeTrustGate {
        CodexRuntimeTrustGate(
            monitoredEntries: monitored ? [
                CodexRuntimeMonitoredEntry(
                    stableSourceURL: source,
                    canonicalRootURLs: [canonicalRoot]
                ),
            ] : []
        )
    }

    func replaceTargetBody(_ body: String) throws {
        try Data(("#!/bin/zsh\nset -eu\n" + body + "\n").utf8).write(to: target)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: target.path
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static func makeDirectory(_ url: URL, mode: Int) throws {
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: mode]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: mode],
            ofItemAtPath: url.path
        )
    }
}

private final class RuntimeTrustVersionProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let versions: [String?]
    private var calls = 0

    init(_ versions: [String?]) {
        self.versions = versions
    }

    var callCount: Int {
        lock.withLock { calls }
    }

    func read(_ _: URL) -> String? {
        lock.withLock {
            let index = min(calls, max(0, versions.count - 1))
            calls += 1
            return versions.isEmpty ? nil : versions[index]
        }
    }
}

private func addRuntimeTrustACL(
    at url: URL,
    rule: String = "user:\(NSUserName()) allow read"
) throws {
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
        throw RuntimeTrustFixtureError.aclSetup(message)
    }
}

private enum RuntimeTrustFixtureError: Error {
    case aclSetup(String)
}

import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Immutable Claude runtime payload", .serialized)
struct ClaudeRuntimePayloadTests {
    @Test("The unified app retains the existing immutable Claude payload store")
    func payloadStorePreservesBlabee() {
        let home = URL(fileURLWithPath: "/Users/example", isDirectory: true)
        #expect(ClaudeRuntimePayload.storeRootURL(homeDirectory: home).path
            == "/Users/example/Library/Application Support/Blabee/claude-runtime")
        #expect(ClaudeRuntimePayload.defaultStoreRootURL == ClaudeRuntimePayload.storeRootURL(
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser))
    }

    @Test("Packaged Node reports exactly the manifest version without unqualified output")
    func exactNodeVersion() {
        #expect(ClaudeRuntimePayload.supportedNodeVersion == "22.23.2")
        for output in ["v22.23.2", "v22.23.2\n"] {
            #expect(ClaudeRuntimePayload.supportsNodeVersion(Data(output.utf8)))
        }
        for output in ["v22.22.0\n", "v22.23.3\n", "v24.0.0\n", "22.23.2\n",
                       "v22.23.2-preview\n", " v22.23.2\n", "v22.23.2 \n",
                       "v22.23.2\nextra", "v22.23.2\n\n", "v22.23.2\0", ""] {
            #expect(!ClaudeRuntimePayload.supportsNodeVersion(Data(output.utf8)))
        }
        #expect(!ClaudeRuntimePayload.supportsNodeVersion(Data([0xff, 0xfe])))
    }

    @Test("Canonical manifest digest agrees with an independent sorted UTF-8 JSON implementation")
    func digestInteroperability() throws {
        let fixture = try ClaudeRuntimePayloadFixture(architecture: "arm64")
        defer { fixture.cleanup() }
        // Generated independently with Python json.dumps(sort_keys=True,
        // separators=(',', ':'), ensure_ascii=False) and hashlib.sha256.
        let expected = "sha256:bebee91f4dec15c5c971299436b02bfb97f1f0123b4e078c8eb6f69c6eb8d1b3"
        let manifest = try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot, expectedArchitecture: "arm64")
        #expect(manifest.payloadDigest == expected)
        #expect(manifest.files.count == 52)
        #expect(manifest.files.filter(\.executable).map(\.path) == ["node/bin/node"])
        #expect(throws: CoordinatorError("claude_runtime_payload_invalid")) {
            try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot, expectedArchitecture: "x64")
        }
    }

    @Test("The signed manifest byte pin rejects a freshly resealed source even when its digest already exists")
    func manifestPin() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let manifestURL = fixture.runtimeRoot.appendingPathComponent("manifest.json")
        let pin = SHA256.hash(data: try Data(contentsOf: manifestURL)).map { String(format: "%02x", $0) }.joined()
        _ = try ClaudeRuntimePayload.prepare(bundleRootURL: fixture.runtimeRoot, storeRootURL: fixture.storeRoot, expectedManifestSHA256: pin)
        let path = "payload/src/session-v2-hook.mjs"
        try fixture.replaceFile(path, data: Data("new self-consistent source\n".utf8))
        let newCopy = try fixture.prepare()
        #expect(FileManager.default.fileExists(atPath: newCopy.rootURL.path))
        #expect(throws: CoordinatorError("claude_runtime_payload_invalid")) {
            try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot, expectedManifestSHA256: pin)
        }
        #expect(throws: CoordinatorError("claude_runtime_payload_invalid")) {
            try ClaudeRuntimePayload.prepare(bundleRootURL: fixture.runtimeRoot, storeRootURL: fixture.storeRoot, expectedManifestSHA256: pin)
        }
    }

    @Test("Root-owned admin-writable system ancestors do not weaken runtime/store leaf policy")
    func trustedSystemAncestors() {
        var value = stat()
        value.st_uid = 0; value.st_mode = mode_t(S_IFDIR) | 0o775
        #expect(ClaudePayloadFS.permitsAncestor(value))
        value.st_mode = mode_t(S_IFDIR) | 0o777
        #expect(!ClaudePayloadFS.permitsAncestor(value))
        value.st_mode = mode_t(S_IFDIR) | 0o1777
        #expect(ClaudePayloadFS.permitsAncestor(value))
        value.st_uid = geteuid(); value.st_mode = mode_t(S_IFDIR) | 0o775
        #expect(!ClaudePayloadFS.permitsAncestor(value))
    }

    @Test("Self-consistent manifests still require the pinned Mach-O, entitlement and package metadata policy",
           arguments: ["node", "entitlements", "package"])
    func metadataPolicy(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        switch kind {
        case "node": try fixture.replaceFile("node/bin/node", data: Data(repeating: 0, count: 32))
        case "entitlements": try fixture.replaceFile("node/Node.entitlements", data: Data("<plist/>\n".utf8))
        default: try fixture.replaceFile("payload/node_modules/zod/package.json", data: Data("{\"name\":\"zod\",\"version\":\"0.0.0\"}".utf8))
        }
        #expect(throws: (any Error).self) { try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot) }
    }

    @Test("Manifest version, unknown fields, typed booleans, integer bounds and ordering fail closed",
           arguments: ["version", "unknown", "digest", "boolean", "negative", "fraction", "oversize", "unsorted", "duplicate", "escape", "mode", "missing"])
    func invalidManifest(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        var files = try #require(fixture.manifestObject["files"] as? [[String: Any]])
        switch kind {
        case "version": fixture.manifestObject["node_version"] = "22.23.3"
        case "unknown": fixture.manifestObject["credential"] = "not-allowed"
        case "digest": fixture.manifestObject["payload_digest"] = "sha256:" + String(repeating: "0", count: 64)
        case "boolean": files[0]["executable"] = 0
        case "negative": files[0]["size"] = -1
        case "fraction": files[0]["size"] = 0.5
        case "oversize": files[0]["size"] = 268_435_457
        case "unsorted": files.reverse()
        case "duplicate": files.insert(files[0], at: 0)
        case "escape": files[0]["path"] = "node/../bin/node"
        case "mode": files[0]["executable"] = true
        default: files.removeLast()
        }
        fixture.manifestObject["files"] = files
        try fixture.writeManifest(recalculateDigest: kind != "digest")
        #expect(throws: (any Error).self) { try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot) }
    }

    @Test("Duplicate JSON keys and unindexed files or directories are rejected",
           arguments: ["duplicate_key", "unindexed_file", "unindexed_directory"])
    func extraContent(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        if kind == "duplicate_key" {
            let path = fixture.runtimeRoot.appendingPathComponent("manifest.json")
            let data = try Data(contentsOf: path)
            try (Data("{\"bridge_version\":\"0.1.0\",".utf8) + data.dropFirst()).write(to: path)
        } else if kind == "unindexed_file" {
            try Data("unlisted".utf8).write(to: fixture.runtimeRoot.appendingPathComponent("payload/unlisted.mjs"))
        } else {
            try FileManager.default.createDirectory(at: fixture.runtimeRoot.appendingPathComponent("extra"), withIntermediateDirectories: false)
        }
        #expect(throws: (any Error).self) { try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot) }
    }

    @Test("Byte changes, symlinks, hardlinks, special files and mixed permission profiles are rejected",
           arguments: ["bytes", "symlink", "hardlink", "fifo", "writable", "mixed", "executable"])
    func unsafeTree(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let file = fixture.runtimeRoot.appendingPathComponent("payload/src/session-v2-hook.mjs")
        switch kind {
        case "bytes": try Data("tamper".utf8).write(to: file)
        case "symlink":
            let original = fixture.container.appendingPathComponent("external")
            try FileManager.default.moveItem(at: file, to: original)
            try FileManager.default.createSymbolicLink(at: file, withDestinationURL: original)
        case "hardlink": #expect(link(file.path, fixture.container.appendingPathComponent("second-link").path) == 0)
        case "fifo":
            try FileManager.default.removeItem(at: file)
            #expect(mkfifo(file.path, 0o644) == 0)
        case "writable": #expect(chmod(file.path, 0o666) == 0)
        case "mixed": #expect(chmod(file.path, 0o400) == 0)
        default: #expect(chmod(file.path, 0o755) == 0)
        }
        #expect(throws: (any Error).self) { try ClaudeRuntimePayload.qualify(rootURL: fixture.runtimeRoot) }
    }

    @Test("Preparation publishes a verified read-only copy once and never overwrites a tampered digest")
    func immutableCopy() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let first = try fixture.prepare()
        let second = try fixture.prepare()
        #expect(first == second)
        #expect(first.rootURL.path.hasPrefix(fixture.storeRoot.appendingPathComponent("payloads").path + "/"))
        let source = fixture.runtimeRoot.appendingPathComponent("node/bin/node")
        var a = stat(), b = stat()
        #expect(lstat(source.path, &a) == 0 && lstat(first.nodeExecutable.path, &b) == 0)
        #expect(a.st_ino != b.st_ino && b.st_nlink == 1 && b.st_mode & 0o7777 == 0o500)
        #expect(try ClaudeRuntimePayload.qualify(rootURL: first.rootURL).payloadDigest == first.digest)
        let target = first.payloadRoot.appendingPathComponent("src/session-v2-hook.mjs")
        #expect(chmod(target.path, 0o600) == 0)
        try Data("corrupted".utf8).write(to: target)
        #expect(chmod(target.path, 0o400) == 0)
        #expect(throws: (any Error).self) { try fixture.prepare() }
        #expect(try Data(contentsOf: target) == Data("corrupted".utf8))
    }

    @Test("The optional actual packaged payload uses the same native qualifier",
           .enabled(if: ProcessInfo.processInfo.environment["BLABEE_CLAUDE_PACKAGED_RUNTIME"] != nil))
    func actualPackagedRuntime() throws {
        let path = try #require(ProcessInfo.processInfo.environment["BLABEE_CLAUDE_PACKAGED_RUNTIME"])
        let manifest = try ClaudeRuntimePayload.qualify(rootURL: URL(fileURLWithPath: path))
        #expect(manifest.files.count > 33)
        #expect(manifest.nodeVersion == "22.23.2" && manifest.mcpSDKVersion == "1.30.0")
    }
}

/// Shared by isolated Pet/installer tests. These are synthetic bytes, never an
/// executed Node runtime or a signed product bundle. Explicit roots only.
final class ClaudeRuntimePayloadFixture: @unchecked Sendable {
    let container: URL
    let runtimeRoot: URL
    let storeRoot: URL
    let architecture: String
    var manifestObject: [String: Any]

    init(runtimeRoot: URL? = nil, architecture: String = ClaudeRuntimePayload.currentArchitecture) throws {
        container = URL(fileURLWithPath: "/private/tmp/brp-\(UUID().uuidString.lowercased())", isDirectory: true)
        self.runtimeRoot = runtimeRoot ?? container.appendingPathComponent("runtime", isDirectory: true)
        storeRoot = container.appendingPathComponent("store", isDirectory: true)
        self.architecture = architecture
        manifestObject = [:]
        guard !FileManager.default.fileExists(atPath: self.runtimeRoot.path) else {
            throw CoordinatorError("claude_payload_fixture_exists")
        }
        try FileManager.default.createDirectory(at: container, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            var paths = Set(ClaudeRuntimePayload.sourceNames.map { "payload/src/" + $0 })
            paths.formUnion(["node/bin/node", "node/LICENSE", "node/Node.entitlements", "payload/package.json", "payload/package-lock.json"])
            for package in ClaudeRuntimePayload.packageNames {
                paths.insert("payload/node_modules/" + package + "/package.json")
                paths.insert("payload/node_modules/" + package + (package == "require-from-string" ? "/license" : "/LICENSE"))
                paths.formUnion((ClaudeRuntimePayload.packageEntries[package] ?? []).map { "payload/node_modules/" + package + "/" + $0 })
            }
            var files: [[String: Any]] = []
            for path in paths.sorted() {
                let file = self.runtimeRoot.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                       attributes: [.posixPermissions: 0o755])
                let data = try fixtureBytes(path)
                try data.write(to: file)
                #expect(chmod(file.path, path == "node/bin/node" ? 0o755 : 0o644) == 0)
                files.append(["path": path, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
                              "size": data.count, "executable": path == "node/bin/node"])
            }
            manifestObject = ["schema_version": "blabee.claude-runtime.v1", "bridge_version": "0.1.0",
                "node_version": "22.23.2", "node_arch": architecture, "mcp_sdk_version": "1.30.0",
                "mcp_protocol_negotiation": "legacy", "channel_mode": "development-preview",
                "channel_source": "blabee-claude", "channel_selector": "server:blabee-claude",
                "contract_versions": ["owner": "blabee.claude-owner.v1", "session": "blabee.claude-session.v2", "pet": "blabee.pet-provider.v1"],
                "files": files]
            try writeManifest()
        } catch { cleanup(); throw error }
    }
    private func fixtureBytes(_ path: String) throws -> Data {
        func json(_ object: [String: Any]) throws -> Data {
            try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) + Data([10])
        }
        if path == "node/bin/node" {
            var data = [UInt8](repeating: 0, count: 32)
            for (offset, word) in [(0, UInt32(0xfeedfacf)), (4, architecture == "arm64" ? UInt32(0x0100000c) : UInt32(0x01000007)), (12, UInt32(2))] {
                for index in 0..<4 { data[offset + index] = UInt8((word >> (index * 8)) & 0xff) }
            }
            return Data(data)
        }
        if path == "node/Node.entitlements" { return Data(ClaudeRuntimePayload.nodeEntitlements.utf8) }
        if path == "payload/package.json" {
            return try json(["name": "blabee-claude-bridge", "version": "0.1.0", "type": "module",
                             "dependencies": ["@modelcontextprotocol/sdk": "1.30.0"]])
        }
        if path == "payload/package-lock.json" {
            var packages: [String: Any] = ["": ["dependencies": ["@modelcontextprotocol/sdk": "1.30.0"]]]
            for (name, version) in ClaudeRuntimePayload.packageVersions { packages["node_modules/" + name] = ["version": version] }
            return try json(["version": "0.1.0", "lockfileVersion": 3, "packages": packages])
        }
        for (name, version) in ClaudeRuntimePayload.packageVersions where path == "payload/node_modules/" + name + "/package.json" {
            return try json(["name": name, "version": version])
        }
        return Data(("fixture:" + path + "\n").utf8)
    }
    func replaceFile(_ path: String, data: Data) throws {
        try data.write(to: runtimeRoot.appendingPathComponent(path))
        var files = try #require(manifestObject["files"] as? [[String: Any]])
        let index = try #require(files.firstIndex { $0["path"] as? String == path })
        files[index]["size"] = data.count
        files[index]["sha256"] = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        manifestObject["files"] = files
        try writeManifest()
    }
    func writeManifest(recalculateDigest: Bool = true) throws {
        if recalculateDigest {
            var body = manifestObject
            body.removeValue(forKey: "payload_digest")
            manifestObject["payload_digest"] = "sha256:" + SHA256.hash(data: try JSONSerialization.data(withJSONObject: body,
                options: [.sortedKeys, .withoutEscapingSlashes])).map { String(format: "%02x", $0) }.joined()
        }
        let path = runtimeRoot.appendingPathComponent("manifest.json")
        try (JSONSerialization.data(withJSONObject: manifestObject, options: [.sortedKeys, .withoutEscapingSlashes]) + Data([10])).write(to: path)
        guard chmod(path.path, 0o644) == 0 else { throw CoordinatorError("claude_payload_fixture_failed") }
    }
    func prepare() throws -> ClaudeRuntimePayload.Prepared {
        try ClaudeRuntimePayload.prepare(bundleRootURL: runtimeRoot, storeRootURL: storeRoot, expectedArchitecture: architecture)
    }
    func cleanup() {
        for root in [runtimeRoot, container] {
            // Only fixture-owned trees; chmod directories to permit teardown
            // of immutable copies. Never follow a symlink introduced by a test.
            if let entries = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
                for case let path as URL in entries {
                    var metadata = stat()
                    if lstat(path.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR { _ = chmod(path.path, 0o700) }
                }
            }
            _ = chmod(root.path, 0o700)
            try? FileManager.default.removeItem(at: root)
        }
    }
}

import BlabeeProductSupport
import CoordinatorSwift
import CoreFoundation
import CryptoKit
import Darwin
import Foundation

/// Byte qualification is separate from the caller's signed-bundle identity
/// check. Both are required by the product launcher; a manifest is not a grant.
enum ClaudeRuntimePayload {
    struct FileEntry: Equatable, Sendable {
        let path: String
        let sha256: String
        let size: Int64
        let executable: Bool
    }
    struct Manifest: Equatable, Sendable {
        let bridgeVersion: String
        let nodeVersion: String
        let nodeArchitecture: String
        let mcpSDKVersion: String
        let files: [FileEntry]
        let payloadDigest: String
        let data: Data
    }
    struct Prepared: Equatable, Sendable {
        let rootURL: URL
        let nodeExecutable: URL
        let payloadRoot: URL
        let digest: String
    }

    static let maximumFileCount = 900
    static let supportedNodeVersion = "22.23.2"
    static let maximumFileBytes: Int64 = 256 * 1024 * 1024
    static let maximumTotalBytes: Int64 = 384 * 1024 * 1024
    static let maximumDepth = 64
    static let maximumManifestBytes = 2 * 1024 * 1024
    static let sourceNames: Set<String> = [
        "auto-connect-client.mjs", "auto-connect-hook.mjs", "auto-connect-mcp.mjs",
        "session-v2-client.mjs", "session-v2-context.mjs", "session-v2-hook.mjs", "session-v2-mcp.mjs",
        "session-v2-tools.mjs", "session-v2-lifecycle.mjs", "session-v2-channel-poller.mjs",
        "session-v2-waiter.mjs",
        "product-context.mjs", "product-tools.mjs", "native-session-client.mjs", "product-core-client.mjs",
    ]
    static let packageNames: Set<String> = [
        "@modelcontextprotocol/sdk", "zod", "zod-to-json-schema", "ajv", "ajv-formats",
        "fast-deep-equal", "fast-uri", "json-schema-traverse", "require-from-string",
    ]
    static let packageVersions = ["@modelcontextprotocol/sdk": "1.30.0", "zod": "4.6.2", "zod-to-json-schema": "3.25.2",
        "ajv": "8.20.0", "ajv-formats": "3.0.1", "fast-deep-equal": "3.1.3", "fast-uri": "3.1.7",
        "json-schema-traverse": "1.0.0", "require-from-string": "2.0.2"]
    static let packageEntries = ["@modelcontextprotocol/sdk": ["dist/esm/server/index.js", "dist/esm/server/stdio.js", "dist/esm/types.js"],
        "zod": ["index.js", "v3/index.js", "v4/index.js", "v4-mini/index.js"],
        "zod-to-json-schema": ["dist/esm/index.js", "dist/esm/package.json"], "ajv": ["dist/ajv.js"],
        "ajv-formats": ["dist/index.js"], "fast-deep-equal": ["index.js"], "fast-uri": ["index.js"],
        "json-schema-traverse": ["index.js"], "require-from-string": ["index.js"]]
    static let nodeEntitlements = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
    \t<key>com.apple.security.cs.allow-jit</key>
    \t<true/>
    </dict>
    </plist>

    """
    static var defaultStoreRootURL: URL {
        storeRootURL(homeDirectory: FileManager.default.homeDirectoryForCurrentUser)
    }
    static func storeRootURL(homeDirectory: URL) -> URL {
        homeDirectory.appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(BlabeeProductProfile.current.applicationSupportDirectoryName, isDirectory: true)
            .appendingPathComponent("claude-runtime", isDirectory: true)
    }
    static var currentArchitecture: String {
        #if arch(arm64)
        "arm64"
        #elseif arch(x86_64)
        "x64"
        #else
        "unsupported"
        #endif
    }

    /// The bundled executable must report the exact version pinned by the
    /// manifest. Node's optional final LF is the only output framing accepted.
    static func supportsNodeVersion(_ output: Data) -> Bool {
        let version = Data(("v" + supportedNodeVersion).utf8)
        return output == version || output == version + Data([10])
    }

    /// rootURL is Contents/Resources/claude, or an already prepared digest
    /// directory. A tree must use one complete bundled or immutable mode set.
    static func qualify(rootURL: URL, expectedArchitecture: String? = nil,
                        expectedManifestSHA256: String? = nil) throws -> Manifest {
        do {
            guard let root = try ClaudePayloadFS.openAbsoluteDirectory(rootURL, create: false) else { throw invalid() }
            defer { close(root) }
            let mode = try Profile(root: ClaudePayloadFS.info(root))
            return try qualify(root: root, profile: mode, expectedArchitecture: expectedArchitecture ?? currentArchitecture,
                               expectedManifestSHA256: expectedManifestSHA256)
        } catch { throw invalid() }
    }

    /// bundleRootURL means Contents/Resources/claude. It never means a checkout
    /// or a global Node installation. No published/old/uncertain payload is GC'd.
    static func prepare(bundleRootURL: URL, storeRootURL: URL = defaultStoreRootURL,
                        expectedArchitecture: String? = nil, expectedManifestSHA256: String? = nil) throws -> Prepared {
        let architecture = expectedArchitecture ?? currentArchitecture
        let manifest = try qualify(rootURL: bundleRootURL, expectedArchitecture: architecture, expectedManifestSHA256: expectedManifestSHA256)
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: true)
        defer { admission.release() }
        try admission.verify()
        let payloads = try ClaudePayloadFS.privateDirectory(parent: admission.root, name: "payloads", create: true)
        defer { close(payloads) }
        let name = String(manifest.payloadDigest.dropFirst(7))
        let destination = storeRootURL.appendingPathComponent("payloads/" + name, isDirectory: true)
        var existing = stat()
        if fstatat(payloads, name, &existing, AT_SYMLINK_NOFOLLOW) == 0 {
            let prepared = prepared(at: destination, digest: manifest.payloadDigest)
            try verifyPrepared(prepared, storeRootURL: storeRootURL, expectedArchitecture: architecture)
            return prepared
        }
        guard errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
        let temporaryName = ".preparing-" + UUID().uuidString.lowercased()
        guard mkdirat(payloads, temporaryName, 0o700) == 0 else { throw ClaudePayloadFS.unavailable() }
        try ClaudePayloadFS.sync(payloads)
        let temporary = openat(payloads, temporaryName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard temporary >= 0 else { throw ClaudePayloadFS.unavailable() }
        defer { close(temporary) }
        // A failure leaves this unpublished directory for explicit diagnosis;
        // never infer that an uncertain previous payload is safe to delete.
        guard let source = try ClaudePayloadFS.openAbsoluteDirectory(bundleRootURL, create: false) else { throw invalid() }
        defer { close(source) }
        let sourceProfile = try Profile(root: ClaudePayloadFS.info(source))
        for file in manifest.files {
            let sourceFD = try openFile(root: source, file: file, profile: sourceProfile)
            defer { close(sourceFD) }
            let parentPath = file.path.split(separator: "/").dropLast().map(String.init)
            let targetParent = try ClaudePayloadFS.makeRelativeDirectories(root: temporary, components: parentPath)
            defer { close(targetParent) }
            let leaf = String(file.path.split(separator: "/").last!)
            let target = openat(targetParent, leaf, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard target >= 0 else { throw ClaudePayloadFS.unavailable() }
            defer { close(target) }
            let before = try ClaudePayloadFS.info(sourceFD)
            let digest = try ClaudePayloadFS.hash(sourceFD, expectedSize: file.size, copyingTo: target)
            guard digest == file.sha256, ClaudePayloadFS.same(before, try ClaudePayloadFS.info(sourceFD)) else { throw invalid() }
            guard fchmod(target, file.executable ? 0o500 : 0o400) == 0 else { throw ClaudePayloadFS.unavailable() }
            try ClaudePayloadFS.sync(target)
            try ClaudePayloadFS.sync(targetParent)
        }
        try ClaudePayloadFS.writeNew(parent: temporary, name: "manifest.json", data: manifest.data, finalMode: 0o400)
        try freezeDirectories(temporary)
        let copied = try qualify(root: temporary, profile: .immutable, expectedArchitecture: architecture)
        guard copied.payloadDigest == manifest.payloadDigest else { throw invalid() }
        try admission.verify()
        // RENAME_EXCL prevents replacement even if a noncooperating process has
        // created this digest since the first lookup. Existing trees are never repaired.
        guard renameatx_np(payloads, temporaryName, payloads, name, UInt32(RENAME_EXCL)) == 0 else {
            throw ClaudePayloadFS.unavailable()
        }
        try ClaudePayloadFS.sync(payloads)
        return prepared(at: destination, digest: manifest.payloadDigest)
    }

    static func verifyPrepared(_ prepared: Prepared, storeRootURL: URL,
                               expectedArchitecture: String? = nil) throws {
        guard validDigest(prepared.digest) else { throw invalid() }
        let root = storeRootURL.appendingPathComponent("payloads/" + String(prepared.digest.dropFirst(7)), isDirectory: true)
        guard prepared == Self.prepared(at: root, digest: prepared.digest),
              let descriptor = try ClaudePayloadFS.openAbsoluteDirectory(root, create: false) else { throw invalid() }
        defer { close(descriptor) }
        guard try Profile(root: ClaudePayloadFS.info(descriptor)) == .immutable else { throw invalid() }
        let manifest = try qualify(root: descriptor, profile: .immutable,
                                   expectedArchitecture: expectedArchitecture ?? currentArchitecture)
        guard manifest.payloadDigest == prepared.digest else { throw invalid() }
    }

    static func validDigest(_ value: String) -> Bool {
        value.hasPrefix("sha256:") && validHash(String(value.dropFirst(7)))
    }
    static func validHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func prepared(at root: URL, digest: String) -> Prepared {
        .init(rootURL: root, nodeExecutable: root.appendingPathComponent("node/bin/node"),
              payloadRoot: root.appendingPathComponent("payload", isDirectory: true), digest: digest)
    }

    private enum Profile: Equatable {
        case bundled, immutable
        init(root: stat) throws {
            guard root.st_mode & S_IFMT == S_IFDIR else { throw invalid() }
            switch root.st_mode & 0o7777 {
            case 0o755: self = .bundled
            case 0o500: self = .immutable
            default: throw invalid()
            }
            try require(root, directory: true)
        }
        var directoryMode: mode_t { self == .bundled ? 0o755 : 0o500 }
        func require(_ info: stat, directory: Bool, executable: Bool = false) throws {
            let mode: mode_t = directory ? directoryMode : (self == .bundled ? (executable ? 0o755 : 0o644) : (executable ? 0o500 : 0o400))
            guard info.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG),
                  info.st_mode & 0o7777 == mode,
                  info.st_uid == geteuid() || (self == .bundled && info.st_uid == 0),
                  directory || info.st_nlink == 1 else { throw invalid() }
        }
    }

    private static func qualify(root: Int32, profile: Profile, expectedArchitecture: String,
                                expectedManifestSHA256: String? = nil) throws -> Manifest {
        try profile.require(ClaudePayloadFS.info(root), directory: true)
        let manifestFD = try ClaudePayloadFS.openRegular(parent: root, name: "manifest.json")
        defer { close(manifestFD) }
        try profile.require(ClaudePayloadFS.info(manifestFD), directory: false)
        let data = try ClaudePayloadFS.read(manifestFD, maximumBytes: maximumManifestBytes)
        if let pin = expectedManifestSHA256 {
            guard validHash(pin), SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == pin else { throw invalid() }
        }
        let manifest = try parseManifest(data, expectedArchitecture: expectedArchitecture)
        let allowed = Set(manifest.files.map(\.path) + ["manifest.json"])
        var expectedDirectories: Set<String> = []
        for file in manifest.files {
            let pieces = file.path.split(separator: "/")
            for count in 1..<pieces.count { expectedDirectories.insert(pieces.prefix(count).joined(separator: "/")) }
        }
        var found: Set<String> = [], directories: Set<String> = []
        try inventory(root: root, prefix: "", profile: profile, allowed: allowed,
                      expectedDirectories: expectedDirectories, files: &found, directories: &directories)
        guard found == allowed, directories == expectedDirectories else { throw invalid() }
        for file in manifest.files {
            let descriptor = try openFile(root: root, file: file, profile: profile)
            defer { close(descriptor) }
            let before = try ClaudePayloadFS.info(descriptor)
            if file.executable {
                var header = [UInt8](repeating: 0, count: 32)
                let count = header.withUnsafeMutableBytes { pread(descriptor, $0.baseAddress, $0.count, 0) }
                func word(_ offset: Int) -> UInt32 { (0..<4).reduce(0) { $0 | UInt32(header[offset + $1]) << (8 * $1) } }
                guard count == 32, word(0) == 0xfeedfacf, word(12) == 2,
                      word(4) == (expectedArchitecture == "arm64" ? 0x0100000c : 0x01000007) else { throw invalid() }
            }
            guard try ClaudePayloadFS.hash(descriptor, expectedSize: file.size) == file.sha256,
                  ClaudePayloadFS.same(before, try ClaudePayloadFS.info(descriptor)) else { throw invalid() }
        }
        try validatePackageMetadata(root: root, profile: profile, manifest: manifest)
        return manifest
    }

    private static func validatePackageMetadata(root: Int32, profile: Profile, manifest: Manifest) throws {
        let entries = Dictionary(uniqueKeysWithValues: manifest.files.map { ($0.path, $0) })
        func bytes(_ path: String) throws -> Data {
            guard let entry = entries[path] else { throw invalid() }
            let fd = try openFile(root: root, file: entry, profile: profile)
            defer { close(fd) }
            let data = try ClaudePayloadFS.read(fd, maximumBytes: maximumManifestBytes)
            guard SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == entry.sha256 else { throw invalid() }
            return data
        }
        func object(_ path: String) throws -> [String: Any] { try StrictJSONTransport.object(from: bytes(path)) }
        guard try bytes("node/Node.entitlements") == Data(nodeEntitlements.utf8) else { throw invalid() }
        let bridge = try object("payload/package.json"), lock = try object("payload/package-lock.json")
        guard bridge["name"] as? String == "blabee-claude-bridge", bridge["version"] as? String == "0.1.0",
              bridge["type"] as? String == "module", (bridge["dependencies"] as? [String: Any])?["@modelcontextprotocol/sdk"] as? String == "1.30.0",
              ExactJSONInteger.int64(lock["lockfileVersion"]) == 3, lock["version"] as? String == "0.1.0",
              let packages = lock["packages"] as? [String: [String: Any]],
              (packages[""]?["dependencies"] as? [String: Any])?["@modelcontextprotocol/sdk"] as? String == "1.30.0" else { throw invalid() }
        for (name, version) in packageVersions {
            let package = try object("payload/node_modules/" + name + "/package.json")
            guard package["name"] as? String == name, package["version"] as? String == version,
                  packages["node_modules/" + name]?["version"] as? String == version else { throw invalid() }
        }
    }

    private static func parseManifest(_ data: Data, expectedArchitecture: String) throws -> Manifest {
        let object = try StrictJSONTransport.object(from: data, limits: .init(maximumBytes: maximumManifestBytes, maximumDepth: 8))
        guard try StrictJSONTransport.data(forJSONObject: object) + Data([10]) == data else { throw invalid() }
        let keys: Set<String> = ["schema_version", "bridge_version", "node_version", "node_arch", "mcp_sdk_version",
            "mcp_protocol_negotiation", "delivery_mode", "contract_versions", "files", "payload_digest"]
        guard Set(object.keys) == keys,
              object["schema_version"] as? String == "blabee.claude-runtime.v2",
              object["bridge_version"] as? String == "0.1.0", object["node_version"] as? String == supportedNodeVersion,
              let architecture = object["node_arch"] as? String, ["arm64", "x64"].contains(architecture), architecture == expectedArchitecture,
              object["mcp_sdk_version"] as? String == "1.30.0", object["mcp_protocol_negotiation"] as? String == "legacy",
              object["delivery_mode"] as? String == "mcp-hook-v1",
              let contracts = object["contract_versions"] as? [String: String],
              contracts == ["owner": "blabee.claude-owner.v1", "session": "blabee.claude-session.v3", "pet": "blabee.pet-provider.v1"],
              let rawFiles = object["files"] as? [[String: Any]], !rawFiles.isEmpty, rawFiles.count <= maximumFileCount,
              let digest = object["payload_digest"] as? String, validDigest(digest) else { throw invalid() }
        var files: [FileEntry] = [], total: Int64 = 0, previous: String?
        for value in rawFiles {
            guard Set(value.keys) == ["path", "sha256", "size", "executable"],
                  let path = value["path"] as? String, allowedPath(path),
                  previous.map({ $0.utf8.lexicographicallyPrecedes(path.utf8) }) ?? true,
                  let hash = value["sha256"] as? String, validHash(hash),
                  let size = ExactJSONInteger.int64(value["size"], minimum: 0), size <= maximumFileBytes,
                  let bool = value["executable"] as? NSNumber, CFGetTypeID(bool) == CFBooleanGetTypeID(),
                  bool.boolValue == (path == "node/bin/node") else { throw invalid() }
            total += size
            guard total <= maximumTotalBytes else { throw invalid() }
            files.append(.init(path: path, sha256: hash, size: size, executable: bool.boolValue))
            previous = path
        }
        var required = Set(sourceNames.map { "payload/src/" + $0 })
        required.formUnion(["node/bin/node", "node/LICENSE", "node/Node.entitlements", "payload/package.json", "payload/package-lock.json"])
        required.formUnion(packageNames.map { "payload/node_modules/" + $0 + "/package.json" })
        required.formUnion(packageNames.map { "payload/node_modules/" + $0 + ($0 == "require-from-string" ? "/license" : "/LICENSE") })
        for (name, paths) in packageEntries { required.formUnion(paths.map { "payload/node_modules/" + name + "/" + $0 }) }
        guard required.isSubset(of: Set(files.map(\.path))) else { throw invalid() }
        guard !files.contains(where: { ($0.path.hasSuffix("/LICENSE") || $0.path.hasSuffix("/license")) && $0.size == 0 }) else { throw invalid() }
        var body = object
        body.removeValue(forKey: "payload_digest")
        let calculated = "sha256:" + SHA256.hash(data: try StrictJSONTransport.data(forJSONObject: body)).map { String(format: "%02x", $0) }.joined()
        guard calculated == digest else { throw invalid() }
        return .init(bridgeVersion: "0.1.0", nodeVersion: supportedNodeVersion, nodeArchitecture: architecture,
                     mcpSDKVersion: "1.30.0", files: files, payloadDigest: digest, data: data)
    }

    private static func allowedPath(_ path: String) -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.isEmpty, path.utf8.count <= 1024, parts.count <= maximumDepth,
              path.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                  || [95, 64, 46, 43, 47, 45].contains($0) }),
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return false }
        if ["node/bin/node", "node/LICENSE", "node/Node.entitlements", "payload/package.json", "payload/package-lock.json"].contains(path) { return true }
        if path.hasPrefix("payload/src/") { return sourceNames.contains(String(path.dropFirst("payload/src/".count))) }
        for package in packageNames where path.hasPrefix("payload/node_modules/" + package + "/") {
            let relative = String(path.dropFirst(("payload/node_modules/" + package + "/").count))
            if relative == "package.json" || relative == (package == "require-from-string" ? "license" : "LICENSE") { return true }
            let suffix = URL(fileURLWithPath: relative).pathExtension
            switch package {
            case "@modelcontextprotocol/sdk":
                return relative.hasPrefix("dist/esm/") && !relative.split(separator: "/").contains("examples") && ["js", "json"].contains(suffix)
            case "zod":
                return !relative.hasPrefix("src/") && relative != "tsconfig.json" && ["js", "cjs", "json"].contains(suffix)
            case "zod-to-json-schema": return relative.hasPrefix("dist/esm/") && ["js", "json"].contains(suffix)
            case "ajv", "ajv-formats": return relative.hasPrefix("dist/") && ["js", "json"].contains(suffix)
            case "fast-deep-equal": return ["index.js", "react.js", "es6/index.js", "es6/react.js"].contains(relative)
            case "fast-uri": return relative == "index.js" || (relative.hasPrefix("lib/") && suffix == "js")
            case "json-schema-traverse", "require-from-string": return relative == "index.js"
            default: return false
            }
        }
        return false
    }

    private static func openFile(root: Int32, file: FileEntry, profile: Profile) throws -> Int32 {
        let pieces = file.path.split(separator: "/").map(String.init)
        var parent = fcntl(root, F_DUPFD_CLOEXEC, 3)
        guard parent >= 0 else { throw invalid() }
        defer { close(parent) }
        for piece in pieces.dropLast() {
            let child = try ClaudePayloadFS.openDirectory(parent: parent, name: piece)
            do { try profile.require(ClaudePayloadFS.info(child), directory: true) }
            catch { close(child); throw error }
            close(parent); parent = child
        }
        let fileFD = try ClaudePayloadFS.openRegular(parent: parent, name: pieces.last!)
        do {
            let info = try ClaudePayloadFS.info(fileFD)
            try profile.require(info, directory: false, executable: file.executable)
            guard info.st_size == file.size else { throw invalid() }
            return fileFD
        } catch { close(fileFD); throw error }
    }

    private static func inventory(root: Int32, prefix: String, profile: Profile, allowed: Set<String>,
                                  expectedDirectories: Set<String>, files: inout Set<String>, directories: inout Set<String>) throws {
        let before = try ClaudePayloadFS.info(root)
        for name in try ClaudePayloadFS.names(root) {
            let path = prefix.isEmpty ? name : prefix + "/" + name
            var info = stat()
            guard fstatat(root, name, &info, AT_SYMLINK_NOFOLLOW) == 0 else { throw invalid() }
            if info.st_mode & S_IFMT == S_IFDIR {
                guard expectedDirectories.contains(path), directories.insert(path).inserted else { throw invalid() }
                try profile.require(info, directory: true)
                let child = try ClaudePayloadFS.openDirectory(parent: root, name: name)
                defer { close(child) }
                try inventory(root: child, prefix: path, profile: profile, allowed: allowed,
                              expectedDirectories: expectedDirectories, files: &files, directories: &directories)
            } else {
                guard allowed.contains(path), files.insert(path).inserted else { throw invalid() }
                try profile.require(info, directory: false, executable: path == "node/bin/node")
            }
        }
        guard ClaudePayloadFS.same(before, try ClaudePayloadFS.info(root)) else { throw invalid() }
    }

    private static func freezeDirectories(_ root: Int32) throws {
        for name in try ClaudePayloadFS.names(root) {
            var info = stat()
            guard fstatat(root, name, &info, AT_SYMLINK_NOFOLLOW) == 0 else { throw invalid() }
            if info.st_mode & S_IFMT == S_IFDIR {
                let child = try ClaudePayloadFS.openDirectory(parent: root, name: name)
                defer { close(child) }
                try freezeDirectories(child)
            }
        }
        guard fchmod(root, 0o500) == 0 else { throw ClaudePayloadFS.unavailable() }
        try ClaudePayloadFS.sync(root)
    }
    private static func invalid() -> CoordinatorError { CoordinatorError("claude_runtime_payload_invalid") }
}

/// Descriptor-relative primitives shared only by payload preparation/use.
/// Never follows a symlink or returns raw filesystem diagnostics.
enum ClaudePayloadFS {
    static func unavailable() -> CoordinatorError { CoordinatorError("claude_runtime_unavailable") }
    static func info(_ fd: Int32) throws -> stat {
        var value = stat(); guard fstat(fd, &value) == 0 else { throw unavailable() }; return value
    }
    static func same(_ a: stat, _ b: stat) -> Bool {
        a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_mode == b.st_mode && a.st_uid == b.st_uid
            && a.st_nlink == b.st_nlink && a.st_size == b.st_size
            && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec
            && a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
    }
    static func sync(_ fd: Int32) throws { guard fsync(fd) == 0 else { throw unavailable() } }
    static func permitsAncestor(_ value: stat) -> Bool {
        guard value.st_mode & S_IFMT == S_IFDIR, value.st_uid == geteuid() || value.st_uid == 0 else { return false }
        // Standard /Applications is root:admin 0775. Root-owned group-writable
        // ancestors are valid; the actual runtime/store leaf is checked separately.
        if value.st_mode & 0o002 != 0 { return value.st_uid == 0 && value.st_mode & 0o1000 != 0 }
        return value.st_mode & 0o020 == 0 || value.st_uid == 0
    }
    static func openAbsoluteDirectory(_ url: URL, create: Bool) throws -> Int32? {
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard url.isFileURL, url.path.hasPrefix("/"), url.path.utf8.count <= 4096, !parts.isEmpty,
              !url.path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw unavailable() }
        var parent = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else { throw unavailable() }
        do {
            for part in parts {
                var child = openat(parent, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if child < 0, errno == ENOENT {
                    guard create else { close(parent); return nil }
                    guard mkdirat(parent, part, 0o700) == 0 || errno == EEXIST else { throw unavailable() }
                    try sync(parent)
                    child = openat(parent, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard child >= 0 else { throw unavailable() }
                let value: stat
                do { value = try info(child) } catch { close(child); throw error }
                guard permitsAncestor(value) else { close(child); throw unavailable() }
                close(parent); parent = child
            }
            return parent
        } catch { close(parent); throw error }
    }
    static func openDirectory(parent: Int32, name: String) throws -> Int32 {
        var before = stat()
        guard fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW) == 0, before.st_mode & S_IFMT == S_IFDIR else { throw unavailable() }
        let fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw unavailable() }
        do { guard same(before, try info(fd)) else { throw unavailable() }; return fd }
        catch { close(fd); throw error }
    }
    static func privateDirectory(parent: Int32, name: String, create: Bool) throws -> Int32 {
        var metadata = stat()
        if fstatat(parent, name, &metadata, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT, create, mkdirat(parent, name, 0o700) == 0 else { throw unavailable() }
            try sync(parent)
        }
        let fd = try openDirectory(parent: parent, name: name)
        do {
            let value = try info(fd)
            guard value.st_uid == geteuid(), value.st_mode & 0o7777 == 0o700 else { throw unavailable() }
            return fd
        } catch { close(fd); throw error }
    }
    static func openRegular(parent: Int32, name: String) throws -> Int32 {
        var before = stat()
        guard fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW) == 0,
              before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1 else { throw unavailable() }
        let fd = openat(parent, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw unavailable() }
        do { guard same(before, try info(fd)) else { throw unavailable() }; return fd }
        catch { close(fd); throw error }
    }
    static func names(_ fd: Int32) throws -> [String] {
        let copy = fcntl(fd, F_DUPFD_CLOEXEC, 3)
        guard copy >= 0 else { throw unavailable() }
        guard let stream = fdopendir(copy) else { close(copy); throw unavailable() }
        defer { closedir(stream) }
        rewinddir(stream)
        var values: [String] = []
        while true {
            errno = 0
            guard let entry = readdir(stream) else { guard errno == 0 else { throw unavailable() }; break }
            let name = withUnsafePointer(to: entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(validatingCString: $0) }
            }
            guard let name else { throw unavailable() }
            if name == "." || name == ".." { continue }
            values.append(name)
            guard values.count <= 10_000 else { throw unavailable() }
        }
        return values.sorted()
    }
    static func read(_ fd: Int32, maximumBytes: Int) throws -> Data {
        let before = try info(fd)
        guard before.st_size >= 0, before.st_size <= maximumBytes else { throw unavailable() }
        var output = Data(), buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count < 0 && errno == EINTR { continue }
            guard count >= 0, output.count + count <= maximumBytes else { throw unavailable() }
            if count == 0 { break }
            output.append(contentsOf: buffer.prefix(count))
        }
        guard output.count == before.st_size, same(before, try info(fd)) else { throw unavailable() }
        return output
    }
    static func hash(_ fd: Int32, expectedSize: Int64, copyingTo output: Int32? = nil) throws -> String {
        var hash = SHA256(), buffer = [UInt8](repeating: 0, count: 64 * 1024), total: Int64 = 0
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count < 0 && errno == EINTR { continue }
            guard count >= 0 else { throw unavailable() }
            if count == 0 { break }
            total += Int64(count)
            guard total <= expectedSize else { throw unavailable() }
            let data = Data(buffer.prefix(count))
            hash.update(data: data)
            if let output { try write(output, data: data) }
        }
        guard total == expectedSize else { throw unavailable() }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    static func write(_ fd: Int32, data: Data) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw unavailable() }; offset += count
            }
        }
    }
    static func writeNew(parent: Int32, name: String, data: Data, finalMode: mode_t = 0o600) throws {
        let fd = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw unavailable() }
        defer { close(fd) }
        try write(fd, data: data)
        guard fchmod(fd, finalMode) == 0 else { throw unavailable() }
        try sync(fd); try sync(parent)
    }
    static func makeRelativeDirectories(root: Int32, components: [String]) throws -> Int32 {
        var parent = fcntl(root, F_DUPFD_CLOEXEC, 3)
        guard parent >= 0 else { throw unavailable() }
        do {
            for part in components {
                let child = try privateDirectory(parent: parent, name: part, create: true)
                close(parent); parent = child
            }
            return parent
        } catch { close(parent); throw error }
    }
}

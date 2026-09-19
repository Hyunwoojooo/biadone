import CryptoKit
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Automatic update downloads and verification")
struct AppUpdateDownloadTests {
    @Test("Only pinned GitHub HTTPS asset redirects are allowed", arguments: [
        "http://release-assets.githubusercontent.com/asset", "https://evil.example/asset",
        "https://release-assets.githubusercontent.com.evil.example/asset", "https://user@objects.githubusercontent.com/a",
        "https://objects.githubusercontent.com:444/a", "https://objects.githubusercontent.com/a#fragment",
        "https://github.com/other/repo/releases/download/tag/a.dmg", "file:///tmp/a.dmg",
    ])
    func rejectsRedirect(_ value: String) throws {
        let release = try fixtureRelease()
        let original = try #require(release.installerAssets?.dmg.url)
        #expect(!AppUpdateDownloadPolicy.allowsRedirect(try #require(URL(string: value)), original: original))
        #expect(AppUpdateDownloadPolicy.allowsRedirect(original, original: original))
        #expect(AppUpdateDownloadPolicy.allowsRedirect(try #require(URL(string: "https://release-assets.githubusercontent.com/a?sig=abc")), original: original))
    }

    @Test("Checksum record binds exactly one lowercase digest to the advertised filename", arguments: [
        "wrong-name", "uppercase", "second-line", "path", "carriage-return", "binary-marker",
    ])
    func rejectsChecksumRecord(_ mutation: String) throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("checksum")
        let name = "Blabee-0.1.0-arm64-r41.dmg"
        let digest = String(repeating: "a", count: 64)
        let record: String
        switch mutation {
        case "wrong-name": record = digest + "  other.dmg\n"
        case "uppercase": record = digest.uppercased() + "  " + name + "\n"
        case "second-line": record = digest + "  " + name + "\n" + digest + "  " + name + "\n"
        case "path": record = digest + "  ../" + name + "\n"
        case "carriage-return": record = digest + "  " + name + "\r\n"
        default: record = digest + " *" + name + "\n"
        }
        try Data(record.utf8).write(to: url)
        #expect(throws: AppUpdateDownloadError.checksumMismatch) {
            try AppUpdateDownloadPreparer.readChecksum(url, expectedName: name)
        }
    }

    @Test("Complete verified app is staged and reverified without installing or executing it")
    func preparesWholeApp() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root)
        let preparer = fixture.preparer
        let prepared = try await preparer.prepare(fixture.release)
        #expect(prepared.applicationURL.deletingLastPathComponent() == prepared.workRootURL)
        #expect(try Data(contentsOf: prepared.applicationURL.appendingPathComponent("Contents/Resources/resource.txt")) == Data("whole-app-resource".utf8))
        #expect(!FileManager.default.fileExists(atPath: prepared.workRootURL.appendingPathComponent("mount").path))
        try await preparer.reverify(prepared)
        let calls = fixture.commands.calls
        #expect(calls.filter { $0.arguments.first == "attach" }.count == 1)
        #expect(calls.filter { $0.arguments.first == "detach" }.count == 1)
        #expect(calls.allSatisfy { ["/usr/bin/codesign", "/usr/sbin/spctl", "/usr/bin/hdiutil"].contains($0.executable) })
        #expect(calls.filter { $0.arguments.first == "--verify" }.allSatisfy { $0.arguments.contains(where: { $0.contains("1.2.840.113635.100.6.2.6") && $0.contains("1.2.840.113635.100.6.1.13") && $0.contains("VN7AMDG677") }) })
        try await preparer.cleanup(prepared)
        #expect(!FileManager.default.fileExists(atPath: prepared.workRootURL.path))
    }

    @Test("Default temporary staging survives helper copy and journal download roundtrip")
    func defaultTemporaryDirectoryInteroperatesWithHelperAndJournal() async throws {
        // Do not supply a fixture parent: exercise the production temp-directory default.
        // Network, signature verification and runtime inspection remain injected.
        let fixture = try DownloadFixture()
        let prepared = try await fixture.preparer.prepare(fixture.release)
        defer { try? FileManager.default.removeItem(at: prepared.workRootURL) }
        let helperParent = prepared.workRootURL.appendingPathComponent("helper-runtime", isDirectory: true)
        try FileManager.default.createDirectory(at: helperParent, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        let helper = try AppUpdateRuntimeCopy.prepare(
            sourceURL: prepared.applicationURL, in: helperParent,
            expectedIdentity: prepared.runtimeIdentity,
            validator: { app in
                (try? AppUpdateDownloadPreparer.hashFile(app.appendingPathComponent("Contents/Resources/resource.txt")))
                    .map { "sha256:" + $0 }
            }
        )
        #expect(helper.path == helperParent.appendingPathComponent("Blabee.app").path)
        #expect(try Data(contentsOf: helper.appendingPathComponent("Contents/Resources/resource.txt")) == Data("whole-app-resource".utf8))

        // Exercise the same no-follow traversal that stores the helper's durable journal.
        do {
            let store = AppUpdateJournalStore(rootURL: prepared.workRootURL.appendingPathComponent("journal", isDirectory: true))
            let lease = try store.acquireHelperLock()
            withExtendedLifetime(lease) { #expect(FileManager.default.fileExists(atPath: store.rootURL.path)) }
        }
        let record = try AppUpdateJournal.Download(prepared)
        let decoded = try JSONDecoder().decode(AppUpdateJournal.Download.self, from: JSONEncoder().encode(record))
        let restored = try decoded.prepared()
        #expect(restored.workRootURL.path == prepared.workRootURL.path)
        #expect(restored.applicationURL.path == prepared.applicationURL.path)
        #expect(restored.runtimeIdentity == prepared.runtimeIdentity)
        try await fixture.preparer.reverify(restored)
        try await fixture.preparer.cleanup(restored)
        #expect(!FileManager.default.fileExists(atPath: prepared.workRootURL.path))
    }

    @Test("Tampered image and dishonest response size fail before mount", arguments: ["hash", "size", "redirect", "http", "symlink"])
    func rejectsTamperedDownload(_ failure: String) async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root, downloadFailure: failure)
        await #expect(throws: (any Error).self) { try await fixture.preparer.prepare(fixture.release) }
        #expect(fixture.commands.calls.isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Trust, notarization and advertised app version failures clean mounts and staging", arguments: [
        "signature", "adhoc", "team", "timestamp", "runtime", "gatekeeper", "notarization-source", "version", "app-symlink",
        "copy-substitution", "invalid-runtime", "invalid-attach-plist", "wrong-mount",
    ])
    func rejectsInvalidCandidate(_ failure: String) async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root, commandFailure: failure)
        await #expect(throws: (any Error).self) { try await fixture.preparer.prepare(fixture.release) }
        if ["version", "app-symlink", "runtime", "copy-substitution", "invalid-runtime", "invalid-attach-plist", "wrong-mount"].contains(failure) {
            #expect(fixture.commands.calls.contains { $0.arguments.first == "detach" })
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Detach failure retains owned staging for recovery")
    func retainsOnDetachFailure() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root, commandFailure: "detach")
        await #expect(throws: AppUpdateDownloadError.cleanupFailed) { try await fixture.preparer.prepare(fixture.release) }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 1)
    }

    @Test("Reverification catches bytes modified after preparation")
    func rejectsStagedTampering() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root)
        let prepared = try await fixture.preparer.prepare(fixture.release)
        try Data("tampered image".utf8).write(to: prepared.diskImageURL)
        await #expect(throws: (any Error).self) { try await fixture.preparer.reverify(prepared) }
    }

    @Test("Another signed app with the same version and build cannot replace the verified candidate")
    func rejectsSameVersionRuntimeSubstitution() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root)
        let prepared = try await fixture.preparer.prepare(fixture.release)
        #expect(OperationalRuntimeIdentity.isValid(prepared.runtimeIdentity))
        // The injected signature and Gatekeeper checks still accept this app and
        // its Info.plist retains the same version/build; its sealed identity changes.
        try Data("different-signed-build-same-version".utf8).write(
            to: prepared.applicationURL.appendingPathComponent("Contents/Resources/resource.txt")
        )
        await #expect(throws: AppUpdateDownloadError.runtimeIdentityMismatch) {
            try await fixture.preparer.reverify(prepared)
        }
    }

    @Test("Cancellation after download writes removes partial private staging")
    func cancelsPartialDownload() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root, downloadFailure: "cancel")
        await #expect(throws: CancellationError.self) { try await fixture.preparer.prepare(fixture.release) }
        #expect(fixture.commands.calls.isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Cancellation before prepare has no filesystem or process effects")
    func cancelledPrepare() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root)
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await fixture.preparer.prepare(fixture.release)
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(fixture.commands.calls.isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("Cleanup refuses unrelated paths")
    func refusesUnownedCleanup() async throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try DownloadFixture(root: root)
        let forged = AppUpdatePreparedDownload(release: fixture.release, workRootURL: root,
            applicationURL: root.appendingPathComponent("Blabee.app"), diskImageURL: root.appendingPathComponent("a.dmg"), sha256: "", runtimeIdentity: "")
        await #expect(throws: AppUpdateDownloadError.unsafeStaging) { try await fixture.preparer.cleanup(forged) }
        #expect(FileManager.default.fileExists(atPath: root.path))
    }
}

private func temporaryRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("update-download-test-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    return root
}

private let fixtureImage = Data("fixture-image".utf8)
private var fixtureDigest: String { SHA256.hash(data: fixtureImage).map { String(format: "%02x", $0) }.joined() }
private func fixtureRelease() throws -> PetAppUpdateRelease {
    let version = try #require(PetAppUpdateVersion(version: "0.1.0", build: "41"))
    let name = AppUpdateDownloadPolicy.diskImageName(version)
    let base = "https://github.com/Hyunwoojooo/biadone/releases/"
    let tag = "blabee-v0.1.0%2Bbuild.41"
    let record = fixtureDigest + "  " + name + "\n"
    return PetAppUpdateRelease(version: version, releaseURL: try #require(URL(string: base + "tag/" + tag)), installerAssets: PetAppUpdateInstallerAssets(
        dmg: PetAppUpdateAsset(name: name, url: try #require(URL(string: base + "download/" + tag + "/" + name)), size: Int64(fixtureImage.count)),
        checksum: PetAppUpdateAsset(name: name + ".sha256", url: try #require(URL(string: base + "download/" + tag + "/" + name + ".sha256")), size: Int64(record.utf8.count))
    ))
}

private struct DownloadFixture: Sendable {
    let release: PetAppUpdateRelease
    let preparer: AppUpdateDownloadPreparer
    let commands: DownloadCommandFixture

    init(root: URL? = nil, downloadFailure: String = "", commandFailure: String = "") throws {
        let release = try fixtureRelease()
        self.release = release
        commands = DownloadCommandFixture(failure: commandFailure)
        let runner = commands
        let download: AppUpdateDownloadPreparer.Download = { asset, destination in
            let isImage = asset.name.hasSuffix(".dmg")
            let data = isImage ? fixtureImage : Data((fixtureDigest + "  " + AppUpdateDownloadPolicy.diskImageName(release.version) + "\n").utf8)
            if downloadFailure == "symlink" {
                try FileManager.default.createSymbolicLink(at: destination, withDestinationURL: URL(fileURLWithPath: "/dev/null"))
            } else if downloadFailure == "hash", isImage {
                try Data(repeating: 88, count: data.count).write(to: destination)
            } else { try data.write(to: destination) }
            if downloadFailure == "cancel" { throw CancellationError() }
            return AppUpdateDownloadedFile(statusCode: downloadFailure == "http" ? 404 : 200,
                finalURL: downloadFailure == "redirect" ? URL(string: "https://evil.example/a")! : asset.url,
                byteCount: asset.size + (downloadFailure == "size" ? 1 : 0))
        }
        let run: AppUpdateDownloadPreparer.Run = { executable, args, timeout in try runner.run(executable, args, timeout) }
        let inspector: AppUpdateDownloadPreparer.RuntimeInspector = { app in
            if commandFailure == "invalid-runtime" { return "unverified" }
            if commandFailure == "copy-substitution", app.deletingLastPathComponent().lastPathComponent != "mount" {
                return "sha256:" + String(repeating: "b", count: 64)
            }
            return "sha256:" + (try AppUpdateDownloadPreparer.hashFile(app.appendingPathComponent("Contents/Resources/resource.txt")))
        }
        if let root {
            preparer = AppUpdateDownloadPreparer(temporaryDirectory: root, download: download, run: run, runtimeInspector: inspector)
        } else {
            preparer = AppUpdateDownloadPreparer(download: download, run: run, runtimeInspector: inspector)
        }
    }
}

private final class DownloadCommandFixture: @unchecked Sendable {
    struct Call { let executable: String; let arguments: [String] }
    private let lock = NSLock()
    private var recorded: [Call] = []
    private let failure: String
    var calls: [Call] { lock.lock(); defer { lock.unlock() }; return recorded }
    init(failure: String) { self.failure = failure }

    func run(_ executable: String, _ args: [String], _ timeout: Int) throws -> ManagedCodexVersionProbeResult {
        lock.lock(); recorded.append(Call(executable: executable, arguments: args)); lock.unlock()
        func result(_ stdout: Data = Data(), stderr: String = "", exit: Int32 = 0) -> ManagedCodexVersionProbeResult {
            .init(exitCode: exit, stdout: stdout, stderr: Data(stderr.utf8))
        }
        if executable == "/usr/bin/hdiutil", args.first == "attach" {
            let index = try #require(args.firstIndex(of: "-mountpoint"))
            let mount = URL(fileURLWithPath: args[index + 1], isDirectory: true)
            let app = mount.appendingPathComponent("Blabee.app", isDirectory: true)
            let resources = app.appendingPathComponent("Contents/Resources", isDirectory: true)
            try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
            let executable = app.appendingPathComponent("Contents/MacOS/blabee-coordinator")
            try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("fixture executable is never run".utf8).write(to: executable)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
            try Data("whole-app-resource".utf8).write(to: resources.appendingPathComponent("resource.txt"))
            if failure == "app-symlink" {
                try FileManager.default.createSymbolicLink(at: resources.appendingPathComponent("bad"), withDestinationURL: URL(fileURLWithPath: "/tmp"))
            }
            let info = ["CFBundleIdentifier": "com.biadone.blabee", "CFBundleExecutable": "blabee-coordinator", "CFBundleShortVersionString": "0.1.0", "CFBundleVersion": failure == "version" ? "40" : "41"]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: app.appendingPathComponent("Contents/Info.plist"))
            if failure == "invalid-attach-plist" { return result(Data("not a plist".utf8)) }
            return result(try PropertyListSerialization.data(fromPropertyList: ["system-entities": [["mount-point": failure == "wrong-mount" ? "/unexpected/mount" : mount.path]]], format: .xml, options: 0))
        }
        if args.first == "detach" { return result(exit: failure == "detach" ? 1 : 0) }
        if executable == "/usr/sbin/spctl" {
            return result(stderr: failure == "notarization-source" ? "source=Developer ID\n" : "source=Notarized Developer ID\n", exit: failure == "gatekeeper" ? 1 : 0)
        }
        if args.first == "--verify" { return result(exit: failure == "signature" ? 1 : 0) }
        if args.first == "--display" {
            let app = args.last?.hasSuffix(".app") == true
            var lines = ["Identifier=" + (app ? "com.biadone.blabee" : "com.biadone.blabee.dmg"),
                "TeamIdentifier=" + (failure == "team" ? "WRONGTEAM1" : "VN7AMDG677"),
                "Authority=Developer ID Application: Hyunwoo Joo (VN7AMDG677)",
                "Timestamp=" + (failure == "timestamp" ? "none" : "Sep 13, 2026"),
                "CodeDirectory v=20500 flags=" + (failure == "runtime" ? "0x0(none)" : "0x10000(runtime)")]
            if failure == "adhoc" { lines.append("Signature=adhoc") }
            return result(stderr: lines.joined(separator: "\n") + "\n")
        }
        throw AppUpdateDownloadError.invalidImage
    }
}

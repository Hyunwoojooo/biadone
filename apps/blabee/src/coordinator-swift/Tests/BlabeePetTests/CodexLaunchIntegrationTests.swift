import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Codex launch executable integration", .serialized)
struct CodexLaunchIntegrationTests {
    @Test("passthrough preserves process semantics and uses the unchanged approval fast path")
    func passthroughRoundTrip() throws {
        let fixture = try CodexLaunchIntegrationFixture()
        defer { fixture.remove() }

        try fixture.manager.enable()
        let approvalBefore = try Data(contentsOf: fixture.approval)
        let approvalIdentityBefore = try fileIdentity(fixture.approval)

        let process = Process()
        process.executableURL = fixture.coordinator
        process.arguments = [
            "codex-launch", "--", "probe-mode", "two words", "*[x]",
        ]
        process.currentDirectoryURL = fixture.workingDirectory
        process.environment = ProcessInfo.processInfo.environment.merging([
            "HOME": fixture.home.path,
            "BLABEE_LAUNCH_CAPTURE": fixture.capture.path,
            "BLABEE_FAKE_EXIT_CODE": "37",
            "BLABEE_SOCKET": "/stale/socket",
            "BLABEE_MANAGED_APPROVALS": "stale-approvals",
            "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "stale-token",
        ]) { _, fixtureValue in fixtureValue }
        let output = Pipe()
        let error = Pipe()
        process.standardOutput = output
        process.standardError = error

        try process.run()
        process.waitUntilExit()
        output.fileHandleForWriting.closeFile()
        error.fileHandleForWriting.closeFile()

        #expect(process.terminationReason == .exit)
        #expect(process.terminationStatus == 37)
        #expect(output.fileHandleForReading.readDataToEndOfFile().isEmpty)
        #expect(error.fileHandleForReading.readDataToEndOfFile().isEmpty)
        #expect(try Data(contentsOf: fixture.approval) == approvalBefore)
        #expect(try fileIdentity(fixture.approval) == approvalIdentityBefore)

        let capture = try String(contentsOf: fixture.capture, encoding: .utf8)
        #expect(capture.contains(
            "cwd=<\(try physicalPath(fixture.workingDirectory))>"
        ))
        #expect(capture.contains("argc=<3>"))
        #expect(capture.contains("arg=<probe-mode>"))
        #expect(capture.contains("arg=<two words>"))
        #expect(capture.contains("arg=<*[x]>"))
        #expect(capture.contains("env=<unset><unset><unset>"))
        #expect(!capture.contains("--version"))
    }
}

private final class CodexLaunchIntegrationFixture {
    let root: URL
    let home: URL
    let applicationSupport: URL
    let coordinator: URL
    let official: URL
    let workingDirectory: URL
    let capture: URL
    let manager: CodexAutoConnectManager

    var approval: URL {
        applicationSupport.appendingPathComponent(
            "shell/v1/codex-runtime-approval.json",
            isDirectory: false
        )
    }

    init() throws {
        let temporaryRoot = FileManager.default.temporaryDirectory
            .resolvingSymlinksInPath()
        root = temporaryRoot.appendingPathComponent(
            "blabee-codex-launch-integration-\(UUID().uuidString)",
            isDirectory: true
        )
        home = root.appendingPathComponent("home", isDirectory: true)
        applicationSupport = home.appendingPathComponent(
            "Library/Application Support/Blabee",
            isDirectory: true
        )
        coordinator = try Self.coordinatorExecutable()
        official = root.appendingPathComponent("bin/fake-codex", isDirectory: false)
        workingDirectory = root.appendingPathComponent(
            "working directory with spaces",
            isDirectory: true
        )
        capture = root.appendingPathComponent("launch capture", isDirectory: false)

        try FileManager.default.createDirectory(
            at: home,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: official.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.createDirectory(
            at: workingDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try Self.writeFakeCodex(at: official)

        manager = CodexAutoConnectManager(
            homeURL: home,
            applicationSupportURL: applicationSupport,
            coordinatorURL: coordinator,
            officialCodexURL: official,
            officialCodexSourceURL: official,
            codexVersionReader: { _ in "0.150.1" }
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static func coordinatorExecutable() throws -> URL {
        let productsDirectory = Bundle(for: CodexLaunchIntegrationBundleToken.self)
            .bundleURL.deletingLastPathComponent()
        let candidate = productsDirectory.appendingPathComponent(
            "blabee-coordinator",
            isDirectory: false
        )
        var info = stat()
        guard lstat(candidate.path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_uid == geteuid(),
              info.st_mode & 0o111 != 0,
              access(candidate.path, X_OK) == 0
        else {
            throw CodexLaunchIntegrationFixtureError.coordinatorMissing(candidate.path)
        }
        return candidate.standardizedFileURL
    }

    private static func writeFakeCodex(at url: URL) throws {
        let script = """
        #!/bin/zsh
        set -eu
        {
          printf 'cwd=<%s>\\n' "$PWD"
          printf 'argc=<%s>\\n' "$#"
          for value in "$@"; do printf 'arg=<%s>\\n' "$value"; done
          printf 'env=<%s><%s><%s>\\n' \
            "${BLABEE_SOCKET-unset}" \
            "${BLABEE_MANAGED_APPROVALS-unset}" \
            "${BLABEE_MANAGED_CODEX_AUTH_TOKEN-unset}"
        } > "$BLABEE_LAUNCH_CAPTURE"
        exit "$BLABEE_FAKE_EXIT_CODE"
        """
        try Data(script.utf8).write(to: url, options: .withoutOverwriting)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: url.path
        )
    }
}

private final class CodexLaunchIntegrationBundleToken {}

private enum CodexLaunchIntegrationFixtureError: Error {
    case coordinatorMissing(String)
    case pathResolutionFailed(String)
}

private func physicalPath(_ url: URL) throws -> String {
    guard let pointer = realpath(url.path, nil) else {
        throw CodexLaunchIntegrationFixtureError.pathResolutionFailed(url.path)
    }
    defer { free(pointer) }
    return String(cString: pointer)
}

private struct CodexLaunchIntegrationFileIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
    let modificationSeconds: Int64
    let modificationNanoseconds: Int64
    let changeSeconds: Int64
    let changeNanoseconds: Int64
}

private func fileIdentity(_ url: URL) throws -> CodexLaunchIntegrationFileIdentity {
    var info = stat()
    guard lstat(url.path, &info) == 0 else {
        throw CodexLaunchIntegrationFixtureError.pathResolutionFailed(url.path)
    }
    return CodexLaunchIntegrationFileIdentity(
        device: info.st_dev,
        inode: info.st_ino,
        modificationSeconds: Int64(info.st_mtimespec.tv_sec),
        modificationNanoseconds: Int64(info.st_mtimespec.tv_nsec),
        changeSeconds: Int64(info.st_ctimespec.tv_sec),
        changeNanoseconds: Int64(info.st_ctimespec.tv_nsec)
    )
}

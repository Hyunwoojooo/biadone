import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("App update runtime copy")
struct AppUpdateRuntimeCopyTests {
    private let identity = "sha256:" + String(repeating: "a", count: 64)

    @Test("Helper copy preserves source bytes and uses an independent executable inode")
    func independentInode() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: f.destination, expectedIdentity: identity) { _ in identity }
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        #expect(try Data(contentsOf: executable) == Data("inert fixture".utf8))
        let runtime = try AppRuntimeUseLease.acquire(executableURL: executable, use: .runtime)
        let installation = try AppRuntimeUseLease.acquire(executableURL: f.executable, use: .installation)
        try runtime.verify(at: executable)
        try installation.verify(at: f.executable)
    }

    @Test("Helper copy rejects source identity drift and preserves the original app")
    func sourceDrift() throws {
        let f = try Fixture()
        defer { f.remove() }
        var checks = 0
        #expect(throws: (any Error).self) {
            try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: f.destination, expectedIdentity: identity) { _ in
                checks += 1
                return checks == 1 ? identity : nil
            }
        }
        #expect(try Data(contentsOf: f.executable) == Data("inert fixture".utf8))
    }

    @Test("Untrusted copy cannot become a helper")
    func copiedIdentityRejected() throws {
        let f = try Fixture()
        defer { f.remove() }
        #expect(throws: (any Error).self) {
            try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: f.destination, expectedIdentity: identity) { app in
                app == f.source ? identity : nil
            }
        }
    }

    @Test("Existing destinations and symlink parents are never overwritten")
    func unsafeDestinations() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = f.destination.appendingPathComponent("Blabee.app")
        try Data("keep".utf8).write(to: app)
        #expect(throws: (any Error).self) {
            try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: f.destination, expectedIdentity: identity) { _ in identity }
        }
        #expect(try Data(contentsOf: app) == Data("keep".utf8))
        let link = f.root.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: f.destination)
        #expect(throws: (any Error).self) {
            try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: link, expectedIdentity: identity) { _ in identity }
        }
    }

    @Test("Shared helper directories and symlink source contents are rejected")
    func privateAndRegularOnly() throws {
        let f = try Fixture()
        defer { f.remove() }
        #expect(chmod(f.destination.path, 0o755) == 0)
        #expect(throws: (any Error).self) {
            try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: f.destination, expectedIdentity: identity) { _ in identity }
        }
        #expect(chmod(f.destination.path, 0o700) == 0)
        try FileManager.default.createSymbolicLink(at: f.source.appendingPathComponent("external"), withDestinationURL: f.destination)
        #expect(throws: (any Error).self) {
            try AppUpdateRuntimeCopy.prepare(sourceURL: f.source, in: f.destination, expectedIdentity: identity) { _ in identity }
        }
    }

    private struct Fixture {
        let root: URL, source: URL, destination: URL, executable: URL
        init() throws {
            guard let physical = realpath(FileManager.default.temporaryDirectory.path, nil) else {
                throw CocoaError(.fileReadUnknown)
            }
            defer { free(physical) }
            root = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
                .appendingPathComponent("blabee-runtime-copy-test-" + UUID().uuidString)
            source = root.appendingPathComponent("Blabee.app")
            destination = root.appendingPathComponent("helper")
            executable = source.appendingPathComponent(AppRuntimeUseLease.executablePath)
            try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try Data("inert fixture".utf8).write(to: executable)
            guard chmod(executable.path, 0o700) == 0 else { throw CocoaError(.fileWriteUnknown) }
        }
        func remove() { try? FileManager.default.removeItem(at: root) }
    }
}

import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("AppRuntimeUseLease", .serialized)
struct AppRuntimeUseLeaseTests {
    @Test("another account may run a readable signed app but cannot gain installation ownership")
    func crossAccountRuntimePolicy() {
        var metadata = stat()
        metadata.st_mode = mode_t(S_IFREG) | 0o755
        metadata.st_uid = geteuid() == 999 ? 998 : 999
        #expect(AppRuntimeUseLease.permitsMetadata(metadata, use: .runtime))
        #expect(!AppRuntimeUseLease.permitsMetadata(metadata, use: .installation))
        metadata.st_mode |= 0o002
        #expect(!AppRuntimeUseLease.permitsMetadata(metadata, use: .runtime))
    }

    @Test("shared runtime users block replacement until the last user closes")
    func sharedUsers() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        var first: AppRuntimeUseLease? = try .acquire(executableURL: fixture.executable, use: .runtime)
        var second: AppRuntimeUseLease? = try .acquire(executableURL: fixture.executable, use: .runtime)
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        }
        withExtendedLifetime(first) {}
        first = nil
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        }
        withExtendedLifetime(second) {}
        second = nil
        let exclusive = try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        try exclusive.verify(at: fixture.executable)
    }

    @Test("an installer lease blocks late runtime starts without waiting")
    func lateStart() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let lease = try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        defer { withExtendedLifetime(lease) {} }
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .runtime)
        }
        #expect(throws: CoordinatorError.self) {
            try AppRuntimeUseLease.acquireCurrent(executableURL: fixture.executable, verifyRunningCode: { _ in
                Issue.record("running code verification must not run while an installer owns the lease")
            })
        }
    }

    @Test("a copied bundle has an independent inode but hardlink aliases contend")
    func inodeScope() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let copy = fixture.root.appendingPathComponent("copy")
        try FileManager.default.copyItem(at: fixture.executable, to: copy)
        let alias = fixture.root.appendingPathComponent("hardlink")
        #expect(link(fixture.executable.path, alias.path) == 0)
        let lease = try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .runtime)
        defer { withExtendedLifetime(lease) {} }
        let independent = try AppRuntimeUseLease.acquire(executableURL: copy, use: .installation)
        try independent.verify(at: copy)
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: alias, use: .installation)
        }
    }

    @Test("an open lease follows backup renames, not a same-byte replacement at its old path")
    func renameAndSameByteReplacement() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let lease = try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        let backup = fixture.root.appendingPathComponent("backup")
        try FileManager.default.moveItem(at: fixture.executable, to: backup)
        try lease.verify(at: backup)
        try FileManager.default.copyItem(at: backup, to: fixture.executable)
        #expect(throws: AppRuntimeUseLeaseError.changed) { try lease.verify(at: fixture.executable) }
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: backup, use: .runtime)
        }
        withExtendedLifetime(lease) {}
    }

    @Test("packaged symlink invocations cannot disable runtime leasing")
    func symlinkInvocation() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let alias = fixture.root.appendingPathComponent("blabee-alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.executable)
        #expect(AppRuntimeUseLease.packagedExecutable(alias) == fixture.executable)
        let lease = try AppRuntimeUseLease.acquireCurrent(executableURL: alias, verifyRunningCode: { url in
            #expect(url == fixture.executable)
        })
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        }
        withExtendedLifetime(lease) {}
    }

    @Test("a standalone runtime keeps its inode leased when its folder becomes an app")
    func standaloneInvocation() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let app = fixture.root.appendingPathComponent("Blabee.app")
        let unbundled = fixture.root.appendingPathComponent("Blabee-without-suffix")
        try FileManager.default.moveItem(at: app, to: unbundled)
        let unbundledExecutable = unbundled.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let lease = try AppRuntimeUseLease.acquireCurrent(executableURL: unbundledExecutable, verifyRunningCode: { _ in })
        defer { withExtendedLifetime(lease) {} }
        try FileManager.default.moveItem(at: unbundled, to: app)
        try lease.verify(at: fixture.executable)
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        }
    }

    @Test("an outside hardlink invocation retains the installed inode after the alias is removed")
    func removedHardlinkInvocation() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let alias = fixture.root.appendingPathComponent("outside-coordinator")
        #expect(link(fixture.executable.path, alias.path) == 0)
        let lease = try AppRuntimeUseLease.acquireCurrent(executableURL: alias, verifyRunningCode: { _ in })
        defer { withExtendedLifetime(lease) {} }
        try FileManager.default.removeItem(at: alias)
        try lease.verify(at: fixture.executable)
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        }
    }

    @Test("missing executable provenance never silently disables runtime leasing")
    func missingExecutableProvenance() {
        #expect(throws: CoordinatorError.self) {
            try AppRuntimeUseLease.acquireCurrent(executableURL: nil)
        }
    }

    @Test("identity validation happens under SH, and failed validation releases the lease")
    func signatureUnderLease() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        #expect(throws: CoordinatorError.self) {
            try AppRuntimeUseLease.acquireCurrent(executableURL: fixture.executable, verifyRunningCode: { _ in
                #expect(throws: AppRuntimeUseLeaseError.busy) {
                    try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
                }
                throw AppRuntimeUseLeaseError.changed
            })
        }
        let recovered = try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        try recovered.verify(at: fixture.executable)
    }

    @Test("a file exchanged during running-code validation cannot continue under the wrong inode")
    func startupReplacementRace() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        #expect(throws: CoordinatorError.self) {
            try AppRuntimeUseLease.acquireCurrent(executableURL: fixture.executable, verifyRunningCode: { _ in
                let old = fixture.root.appendingPathComponent("old")
                try FileManager.default.moveItem(at: fixture.executable, to: old)
                try FileManager.default.copyItem(at: old, to: fixture.executable)
            })
        }
    }

    @Test("missing, nonregular, symlink and writable executables fail closed")
    func invalidTargets() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        for url in [fixture.root, fixture.root.appendingPathComponent("missing")] {
            #expect(throws: AppRuntimeUseLeaseError.unavailable) {
                try AppRuntimeUseLease.acquire(executableURL: url, use: .runtime)
            }
        }
        let alias = fixture.root.appendingPathComponent("alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.executable)
        #expect(throws: AppRuntimeUseLeaseError.unavailable) {
            try AppRuntimeUseLease.acquire(executableURL: alias, use: .installation)
        }
        #expect(chmod(fixture.executable.path, 0o777) == 0)
        #expect(throws: AppRuntimeUseLeaseError.unavailable) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .runtime)
        }
    }

    @Test("read-only executable handles use real interprocess flock and release after process exit")
    func processExitReleasesLease() throws {
        let fixture = try RuntimeLeaseFixture()
        defer { fixture.remove() }
        let source = fixture.root.appendingPathComponent("locker.c")
        let helper = fixture.root.appendingPathComponent("locker")
        // A bounded, isolated OS-lock peer. It never reads product settings or
        // touches installed apps; compiling uses the existing Xcode toolchain.
        try Data(#"""
        #include <sys/file.h>
        #include <fcntl.h>
        #include <unistd.h>
        int main(int argc, char **argv) {
            if (argc != 2) return 10;
            int fd = open(argv[1], O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
            if (fd < 0 || flock(fd, LOCK_SH | LOCK_NB)) return 11;
            if (write(1, "locked\n", 7) != 7) return 12;
            char byte;
            (void)read(0, &byte, 1);
            return 0;
        }
        """#.utf8).write(to: source)
        let compiler = Process()
        compiler.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        compiler.arguments = ["clang", source.path, "-o", helper.path]
        try compiler.run()
        compiler.waitUntilExit()
        #expect(compiler.terminationStatus == 0)
        #expect(chmod(fixture.executable.path, 0o555) == 0)
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        process.executableURL = helper
        process.arguments = [fixture.executable.path]
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        defer {
            if process.isRunning { process.terminate(); process.waitUntilExit() }
        }
        #expect(try output.fileHandleForReading.read(upToCount: 7) == Data("locked\n".utf8))
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        }
        process.terminate()
        process.waitUntilExit()
        let exclusive = try AppRuntimeUseLease.acquire(executableURL: fixture.executable, use: .installation)
        try exclusive.verify(at: fixture.executable)
    }
}

private struct RuntimeLeaseFixture: Sendable {
    let root: URL
    let executable: URL

    init() throws {
        root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("blabee-runtime-lease-test-" + UUID().uuidString, isDirectory: true)
        executable = root.appendingPathComponent("Blabee.app/Contents/MacOS/blabee-coordinator")
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("isolated fixture, not executed".utf8).write(to: executable)
        guard chmod(executable.path, 0o755) == 0 else { throw AppRuntimeUseLeaseError.unavailable }
    }

    func remove() {
        guard root.lastPathComponent.hasPrefix("blabee-runtime-lease-test-") else { return }
        try? FileManager.default.removeItem(at: root)
    }
}

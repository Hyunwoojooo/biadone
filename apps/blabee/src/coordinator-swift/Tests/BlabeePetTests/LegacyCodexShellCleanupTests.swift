import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct LegacyCleanupFixture: Sendable {
    let home: URL
    let directory: URL
    let wrapper: URL
    let startup: URL
    let original: Data

    init(customDotDirectory: Bool = false) throws {
        home = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-legacy-cleanup-" + UUID().uuidString, isDirectory: true)
        directory = home.appendingPathComponent("Library/Application Support/Blabee/shell/v1")
        wrapper = directory.appendingPathComponent("codex-auto-connect.zsh")
        startup = (customDotDirectory ? home.appendingPathComponent("dot files") : home).appendingPathComponent(".zshrc")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: home.path)
        try FileManager.default.createDirectory(at: startup.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        original = LegacyCodexShellCleanupManager.generatedV4(
            official: home.appendingPathComponent("old codex/0.152.0/codex").path,
            coordinator: directory.appendingPathComponent("codex-stable-launcher").path,
            startup: startup.path, originallyMissing: false
        )
        try original.write(to: wrapper)
        try Data(("# Existing user settings\nexport EDITOR=vim\n" + LegacyCodexShellCleanupManager.managedBlock(wrapperPath: wrapper.path) + "alias mine='true'\n").utf8).write(to: startup)
    }
    func manager(
        environment: [String: String] = [:],
        beforeMove: (@Sendable () throws -> Void)? = nil,
        afterMove: (@Sendable () throws -> Void)? = nil,
        lockAttempts: Int = 50
    ) -> LegacyCodexShellCleanupManager {
        LegacyCodexShellCleanupManager(homeURL: home, environment: environment, beforeMove: beforeMove, afterMove: afterMove, lockAttempts: lockAttempts)
    }
    func remove() { try? FileManager.default.removeItem(at: home) }
    func backups() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.lastPathComponent.contains(".blabee-backup-") }
    }
}

@Test("Legacy shell inspection and confirmation are read only; cleanup preserves startup bytes and backs up exact wrapper")
func legacyCodexShellCleanupExactV4() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let manager = fixture.manager()
    let startup = try Data(contentsOf: fixture.startup)
    let inspection = await manager.inspect()
    #expect(inspection.status == .available, "\(inspection.detail)")
    let confirmation = try #require(await manager.prepare())
    #expect(try Data(contentsOf: fixture.wrapper) == fixture.original)
    #expect(!FileManager.default.fileExists(atPath: fixture.directory.appendingPathComponent(".legacy-shell-cleanup.lock").path))
    let result = await manager.cleanup(confirmation: confirmation)
    #expect(result.status == .cleaned)
    #expect(try Data(contentsOf: fixture.startup) == startup)
    #expect(!FileManager.default.fileExists(atPath: fixture.wrapper.path))
    let backup = try #require(result.backupPath)
    #expect(try Data(contentsOf: URL(fileURLWithPath: backup)) == fixture.original)
    #expect((await manager.inspect()).status == .notFound)
    #expect((await manager.cleanup(confirmation: confirmation)).status == .manualReview)
    #expect(try fixture.backups().count == 1)
}

@Test("Legacy shell cleanup never creates directories on absent inspection")
func legacyCodexShellCleanupAbsent() async throws {
    let home = URL(fileURLWithPath: "/private/tmp", isDirectory: true).appendingPathComponent("blabee-missing-" + UUID().uuidString)
    let manager = LegacyCodexShellCleanupManager(homeURL: home)
    #expect((await manager.inspect()).status == .notFound)
    #expect(await manager.prepare() == nil)
    #expect(!FileManager.default.fileExists(atPath: home.path))
}

@Test("Legacy shell cleanup refuses edited body, mismatched metadata, older generator and duplicated connections", arguments: ["body", "metadata", "v3", "unconditional", "duplicate", "startup-missing"])
func legacyCodexShellCleanupOwnership(_ variation: String) async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    switch variation {
    case "body":
        var bytes = fixture.original; bytes.append(Data("# edited\n".utf8)); try bytes.write(to: fixture.wrapper)
    case "metadata":
        let text = String(decoding: fixture.original, as: UTF8.self).replacingOccurrences(of: "local _blabee_official=", with: "local _blabee_official='/different'; # ")
        try Data(text.utf8).write(to: fixture.wrapper)
    case "v3":
        try Data(String(decoding: fixture.original, as: UTF8.self).replacingOccurrences(of: "Connect v4", with: "Connect v3").utf8).write(to: fixture.wrapper)
    case "unconditional":
        var bytes = try Data(contentsOf: fixture.startup); bytes.append(Data("source '\(fixture.wrapper.path)'\n".utf8)); try bytes.write(to: fixture.startup)
    case "duplicate":
        var bytes = try Data(contentsOf: fixture.startup); bytes.append(Data(LegacyCodexShellCleanupManager.managedBlock(wrapperPath: fixture.wrapper.path).utf8)); try bytes.write(to: fixture.startup)
    default: try FileManager.default.removeItem(at: fixture.startup)
    }
    let manager = fixture.manager()
    let before = try Data(contentsOf: fixture.wrapper)
    #expect((await manager.inspect()).status == .manualReview)
    #expect(await manager.prepare() == nil)
    #expect(try Data(contentsOf: fixture.wrapper) == before)
    #expect(try fixture.backups().isEmpty)
}

@Test("Legacy shell cleanup resolves explicit private ZDOTDIR without changing HOME startup")
func legacyCodexShellCleanupZDOTDIR() async throws {
    let fixture = try LegacyCleanupFixture(customDotDirectory: true)
    defer { fixture.remove() }
    let homeStartup = fixture.home.appendingPathComponent(".zshrc")
    let homeBytes = Data("# independent startup\n".utf8)
    try homeBytes.write(to: homeStartup)
    let manager = fixture.manager(environment: ["ZDOTDIR": fixture.startup.deletingLastPathComponent().path])
    let confirmation = try #require(await manager.prepare())
    #expect(confirmation.startupPath == fixture.startup.path)
    #expect((await manager.cleanup(confirmation: confirmation)).status == .cleaned)
    #expect(try Data(contentsOf: homeStartup) == homeBytes)
}

@Test("Legacy shell cleanup refuses uncertain ZDOTDIR and links or unsafe permissions", arguments: ["dynamic", "empty", "relative", "external", "symlink", "hardlink", "directory-mode", "public-backup-directory", "file-mode", "startup-symlink"])
func legacyCodexShellCleanupUnsafe(_ variation: String) async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    var environment: [String: String] = [:]
    switch variation {
    case "dynamic": try Data("export ZDOTDIR=\"$HOME/dots\"\n".utf8).write(to: fixture.home.appendingPathComponent(".zshenv"))
    case "empty": environment["ZDOTDIR"] = ""
    case "relative": environment["ZDOTDIR"] = "dots"
    case "external": environment["ZDOTDIR"] = "/private/tmp/other"
    case "symlink":
        let target = fixture.directory.appendingPathComponent("target")
        try FileManager.default.moveItem(at: fixture.wrapper, to: target)
        try FileManager.default.createSymbolicLink(at: fixture.wrapper, withDestinationURL: target)
    case "hardlink": try FileManager.default.linkItem(at: fixture.wrapper, to: fixture.directory.appendingPathComponent("link"))
    case "directory-mode": try FileManager.default.setAttributes([.posixPermissions: 0o775], ofItemAtPath: fixture.directory.path)
    case "public-backup-directory": try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.directory.path)
    case "file-mode": try FileManager.default.setAttributes([.posixPermissions: 0o666], ofItemAtPath: fixture.wrapper.path)
    default:
        let target = fixture.home.appendingPathComponent("startup-target")
        try FileManager.default.moveItem(at: fixture.startup, to: target)
        try FileManager.default.createSymbolicLink(at: fixture.startup, withDestinationURL: target)
    }
    #expect((await fixture.manager(environment: environment).inspect()).status == .manualReview)
    #expect(try fixture.backups().isEmpty)
}

@Test("Legacy shell confirmation is bound to both wrapper and user startup snapshots", arguments: [true, false])
func legacyCodexShellCleanupConfirmationDrift(_ editWrapper: Bool) async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let manager = fixture.manager()
    let confirmation = try #require(await manager.prepare())
    let target = editWrapper ? fixture.wrapper : fixture.startup
    var bytes = try Data(contentsOf: target); bytes.append(Data("# user update\n".utf8)); try bytes.write(to: target)
    #expect((await manager.cleanup(confirmation: confirmation)).status == .manualReview)
    #expect(try Data(contentsOf: target) == bytes)
    #expect(try fixture.backups().isEmpty)
}

@Test("Legacy shell final rename race restores editor replacement without losing bytes")
func legacyCodexShellCleanupBeforeMoveRace() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let replacement = Data("# editor replacement\n".utf8)
    let manager = fixture.manager(beforeMove: { try replacement.write(to: fixture.wrapper, options: .atomic) })
    let confirmation = try #require(await manager.prepare())
    #expect((await manager.cleanup(confirmation: confirmation)).status == .manualReview)
    #expect(try Data(contentsOf: fixture.wrapper) == replacement)
    #expect(try fixture.backups().isEmpty)
}

@Test("Legacy shell startup changes after move cause exclusive restoration without startup overwrite")
func legacyCodexShellCleanupStartupRace() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let replacement = Data("# concurrently saved startup\n".utf8)
    let manager = fixture.manager(afterMove: { try replacement.write(to: fixture.startup, options: .atomic) })
    let confirmation = try #require(await manager.prepare())
    #expect((await manager.cleanup(confirmation: confirmation)).status == .manualReview)
    #expect(try Data(contentsOf: fixture.wrapper) == fixture.original)
    #expect(try Data(contentsOf: fixture.startup) == replacement)
}

@Test("Legacy shell race preserves both backup and new wrapper when exclusive restoration conflicts")
func legacyCodexShellCleanupRecoveryConflict() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let replacement = Data("# new wrapper written concurrently\n".utf8)
    let manager = fixture.manager(afterMove: { try replacement.write(to: fixture.wrapper, options: .atomic) })
    let confirmation = try #require(await manager.prepare())
    let result = await manager.cleanup(confirmation: confirmation)
    #expect(result.status == .recoveryRequired)
    #expect(try Data(contentsOf: fixture.wrapper) == replacement)
    #expect(try Data(contentsOf: URL(fileURLWithPath: #require(result.backupPath))) == fixture.original)
}

@Test("Legacy shell cleanup is serialized across managers and absent judgments do not recreate wrappers", arguments: Array(0..<64))
func legacyCodexShellCleanupTwoManagers(_ iteration: Int) async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let first = fixture.manager(), second = fixture.manager()
    let firstConfirmation = try #require(await first.prepare())
    let secondConfirmation = try #require(await second.prepare())
    async let a = first.cleanup(confirmation: firstConfirmation)
    async let b = second.cleanup(confirmation: secondConfirmation)
    let results = await [a, b]
    #expect(results.filter { $0.status == .cleaned }.count == 1, "\(results)")
    #expect(results.filter { $0.status == .notFound }.count == 1, "\(results)")
    #expect(try fixture.backups().count == 1)
}

@Test("Legacy shell busy lock returns a bounded error and does not mutate wrapper")
func legacyCodexShellCleanupBusyLock() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let manager = fixture.manager(lockAttempts: 1)
    let confirmation = try #require(await manager.prepare())
    let lock = open(fixture.directory.appendingPathComponent(".legacy-shell-cleanup.lock").path, O_CREAT | O_RDWR, 0o600)
    #expect(lock >= 0)
    defer { flock(lock, LOCK_UN); close(lock) }
    #expect(flock(lock, LOCK_EX | LOCK_NB) == 0)
    let result = await manager.cleanup(confirmation: confirmation)
    #expect(result.status == .manualReview)
    #expect(result.detail.contains("다른 정리"))
    #expect(try Data(contentsOf: fixture.wrapper) == fixture.original)
}

@Test("Legacy shell existing lock open still rejects links, writable permissions and nonempty files", arguments: ["symlink", "hardlink", "mode", "data", "fifo"])
func legacyCodexShellCleanupUnsafeExistingLock(_ kind: String) async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let manager = fixture.manager()
    let confirmation = try #require(await manager.prepare())
    let lock = fixture.directory.appendingPathComponent(".legacy-shell-cleanup.lock")
    let target = fixture.directory.appendingPathComponent("user-owned-target")
    let targetBytes = Data("do not alter".utf8)
    try targetBytes.write(to: target)
    if kind == "symlink" {
        try FileManager.default.createSymbolicLink(at: lock, withDestinationURL: target)
    } else if kind == "hardlink" {
        try FileManager.default.linkItem(at: target, to: lock)
    } else if kind == "fifo" {
        #expect(mkfifo(lock.path, 0o600) == 0)
    } else {
        try (kind == "data" ? targetBytes : Data()).write(to: lock)
        try FileManager.default.setAttributes([.posixPermissions: kind == "mode" ? 0o666 : 0o600], ofItemAtPath: lock.path)
    }
    #expect((await manager.cleanup(confirmation: confirmation)).status == .manualReview)
    #expect(try Data(contentsOf: fixture.wrapper) == fixture.original)
    #expect(try Data(contentsOf: target) == targetBytes)
    #expect(try fixture.backups().isEmpty)
}

@Test("Legacy shell directory rotation preserves backup and reports its actual location")
func legacyCodexShellCleanupDirectoryRotation() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let moved = fixture.directory.deletingLastPathComponent().appendingPathComponent("rotated")
    let manager = fixture.manager(beforeMove: {
        try FileManager.default.moveItem(at: fixture.directory, to: moved)
        try FileManager.default.createDirectory(at: fixture.directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    })
    let confirmation = try #require(await manager.prepare())
    let result = await manager.cleanup(confirmation: confirmation)
    #expect(result.status == .recoveryRequired)
    let backup = try #require(result.backupPath)
    #expect(backup.hasPrefix(moved.path + "/"))
    #expect(try Data(contentsOf: URL(fileURLWithPath: backup)) == fixture.original)
    #expect(!FileManager.default.fileExists(atPath: fixture.wrapper.path))
}

@Test("Legacy shell final rename race restores unsafe replacements without following or reading them", arguments: ["symlink", "fifo", "hardlink"])
func legacyCodexShellCleanupUnsafeReplacementRace(_ kind: String) async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let target = fixture.directory.appendingPathComponent("replacement-target")
    let targetBytes = Data("untouched replacement target".utf8)
    try targetBytes.write(to: target)
    let manager = fixture.manager(beforeMove: {
        try FileManager.default.removeItem(at: fixture.wrapper)
        if kind == "symlink" {
            try FileManager.default.createSymbolicLink(at: fixture.wrapper, withDestinationURL: target)
        } else if kind == "hardlink" {
            try FileManager.default.linkItem(at: target, to: fixture.wrapper)
        } else {
            guard mkfifo(fixture.wrapper.path, 0o600) == 0 else { throw CocoaError(.fileWriteUnknown) }
        }
    })
    let confirmation = try #require(await manager.prepare())
    #expect((await manager.cleanup(confirmation: confirmation)).status == .manualReview)
    #expect(try Data(contentsOf: target) == targetBytes)
    var state = stat()
    #expect(lstat(fixture.wrapper.path, &state) == 0)
    #expect(try fixture.backups().isEmpty)
}

@Test("Legacy shell reprepare invalidates an earlier confirmation without consuming the latest one")
func legacyCodexShellCleanupStaleConfirmation() async throws {
    let fixture = try LegacyCleanupFixture()
    defer { fixture.remove() }
    let manager = fixture.manager()
    let first = try #require(await manager.prepare())
    let second = try #require(await manager.prepare())
    #expect(first.id != second.id)
    #expect((await manager.cleanup(confirmation: first)).status == .manualReview)
    #expect((await manager.cleanup(confirmation: second)).status == .cleaned)
}

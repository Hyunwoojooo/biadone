import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Update managed Codex durable root preflight")
struct UpdateManagedCodexPersistenceTests {
    @Test("advertised but unmaterialized fresh thread is refused without mutations")
    func freshThread() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        #expect(throws: (any Error).self) { try fixture.check() }
        #expect(!FileManager.default.fileExists(atPath: fixture.path.path))
    }

    @Test("owned materialized rollout qualifies; final barrier must still run")
    func materializedThread() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        try Data("fixture persistence metadata\n".utf8).write(to: fixture.path)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.path.path)
        try fixture.check()
        try FileManager.default.removeItem(at: fixture.path)
        #expect(throws: (any Error).self) { try fixture.check() }
    }

    @Test(arguments: ["empty", "symlink", "hardlink", "wrong-id", "outside", "writable"])
    func rejectsUnqualifiedPersistence(kind: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var path = fixture.path
        if kind == "outside" { path = fixture.base.appendingPathComponent(fixture.path.lastPathComponent) }
        try Data((kind == "empty" ? "" : "fixture\n").utf8).write(to: path)
        try FileManager.default.setAttributes([.posixPermissions: kind == "writable" ? 0o666 : 0o600], ofItemAtPath: path.path)
        if kind == "symlink" {
            let target = fixture.base.appendingPathComponent("target.jsonl")
            try FileManager.default.moveItem(at: path, to: target)
            try FileManager.default.createSymbolicLink(at: path, withDestinationURL: target)
        } else if kind == "hardlink" {
            try FileManager.default.linkItem(at: path, to: fixture.base.appendingPathComponent("second.jsonl"))
        }
        #expect(throws: (any Error).self) {
            try UpdateManagedCodexPersistence.requireRoot(
                threadID: kind == "wrong-id" ? UUID().uuidString : fixture.id,
                rolloutPath: path.path, codexHome: fixture.home.path)
        }
    }

    struct Fixture {
        let id = UUID().uuidString.lowercased()
        let base: URL
        let home: URL
        let path: URL
        init() throws {
            base = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("blabee-durable-" + UUID().uuidString)
            home = base.appendingPathComponent("home")
            let directory = home.appendingPathComponent("sessions/2026/09/16")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            path = directory.appendingPathComponent("rollout-fixture-" + id + ".jsonl")
        }
        func check() throws {
            try UpdateManagedCodexPersistence.requireRoot(threadID: id, rolloutPath: path.path, codexHome: home.path)
        }
        func cleanup() { try? FileManager.default.removeItem(at: base) }
    }
}

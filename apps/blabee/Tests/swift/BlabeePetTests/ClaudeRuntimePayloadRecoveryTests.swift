import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Claude payload recovery across a proven Mac restart", .serialized)
struct ClaudeRuntimePayloadRecoveryTests {
    private static let bootA = "11111111-1111-4111-8111-111111111111"
    private static let bootB = "22222222-2222-4222-8222-222222222222"
    private static let bootC = "33333333-3333-4333-8333-333333333333"
    private static let identity = "sha256:" + String(repeating: "a", count: 64)

    @Test("Missing-store recovery is read-only and preparation creates no state")
    func missingStore() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        #expect(try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == .clear)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 0)
        #expect(!FileManager.default.fileExists(atPath: fixture.storeRoot.path))
    }

    @Test("Losing an owner on the same boot cannot release evidence; a later boot can")
    func bootBoundUse() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let prepared = try fixture.prepare()
        _ = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: Self.identity,
            storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        let before = try contents(fixture)
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .inUse)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == 0)
        #expect(throws: CoordinatorError("claude_runtime_in_use")) {
            try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        }
        #expect(try contents(fixture) == before)
        let guardToken = try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB })
        guardToken.release()
        #expect(try contents(fixture).isEmpty)
        #expect(FileManager.default.fileExists(atPath: prepared.nodeExecutable.path))
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 0)
    }

    @Test("New use admission recovers only previous-boot evidence before registering")
    func beginRecoversPriorBoot() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let prepared = try fixture.prepare()
        _ = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: Self.identity,
            storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        let firstNames = try contents(fixture)
        let owner = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: Self.identity,
            storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        #expect(try contents(fixture).count == 1)
        #expect(try contents(fixture) != firstNames)
        try owner.complete()
    }

    @Test("Unavailable or invalid boot evidence fails closed without altering records",
           arguments: ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000", "throw"])
    func invalidBoot(value: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        _ = try ClaudeRuntimePayloadUse.begin(prepared: fixture.prepare(), runtimeIdentity: Self.identity,
            storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        let before = try contents(fixture)
        let provider: ClaudeRuntimePayloadUse.BootSessionIDProvider = {
            if value == "throw" { throw CoordinatorError("test_boot_unavailable") }
            return value
        }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: provider)
        }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: provider)
        }
        #expect(try contents(fixture) == before)
    }

    @Test("Legacy preparation pins records without deleting them; only a later boot recovers")
    func legacyPreparation() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let record = try addRecord(fixture)
        let data = try Data(contentsOf: record)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == 0)
        #expect(try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == .restartRequired(outstandingUseCount: 1))
        #expect(try Data(contentsOf: record) == data)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == 0)
        #expect(throws: CoordinatorError("claude_runtime_in_use")) {
            try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        }
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 1)
        #expect(try contents(fixture).isEmpty)
        #expect(!FileManager.default.fileExists(atPath: marker(fixture).path))
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .clear)
    }

    @Test("Recovery preserves new unlisted current-boot and legacy records")
    func unlistedRecords() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let old = try addRecord(fixture)
        _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA })
        let new = try addRecord(fixture, boot: Self.bootB)
        let newLegacy = try addRecord(fixture)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 1)
        #expect(!FileManager.default.fileExists(atPath: old.path))
        #expect(try contents(fixture) == Set([new.lastPathComponent, newLegacy.lastPathComponent]))
        #expect(throws: CoordinatorError("claude_runtime_in_use")) {
            try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        }
    }

    @Test("All targets are checked before deletion, including replacement with identical bytes",
           arguments: ["content", "inode", "mode", "symlink", "hardlink", "directory"])
    func changedTarget(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let first = try addRecord(fixture), second = try addRecord(fixture)
        _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA })
        let original = try Data(contentsOf: second)
        switch kind {
        case "content": try (original + Data([32])).write(to: second)
        case "inode":
            try FileManager.default.moveItem(at: second, to: fixture.container.appendingPathComponent("old-record"))
            try writePrivate(original, to: second)
        case "mode": #expect(chmod(second.path, 0o644) == 0)
        case "symlink":
            let outside = fixture.container.appendingPathComponent("outside-record")
            try FileManager.default.moveItem(at: second, to: outside)
            try FileManager.default.createSymbolicLink(at: second, withDestinationURL: outside)
        case "hardlink": #expect(link(second.path, fixture.container.appendingPathComponent("hardlink").path) == 0)
        default:
            let uses = fixture.storeRoot.appendingPathComponent("uses")
            try FileManager.default.moveItem(at: uses, to: fixture.container.appendingPathComponent("old-uses"))
            try FileManager.default.createDirectory(at: uses, withIntermediateDirectories: false,
                                                   attributes: [.posixPermissions: 0o700])
            try writePrivate(Data(contentsOf: fixture.container.appendingPathComponent("old-uses/" + first.lastPathComponent)), to: first)
            try writePrivate(original, to: second)
        }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        }
        #expect(FileManager.default.fileExists(atPath: first.path))
        #expect(FileManager.default.fileExists(atPath: second.path))
        #expect(FileManager.default.fileExists(atPath: marker(fixture).path))
    }

    @Test("A crash between exact unlinks is idempotent; missing targets are not replaced by new ones")
    func interruptedRecovery() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let first = try addRecord(fixture), second = try addRecord(fixture)
        _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA })
        try FileManager.default.removeItem(at: first)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 1)
        #expect(!FileManager.default.fileExists(atPath: second.path))
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 0)
        // Also simulate a crash after the final unlink and before marker unlink.
        let third = try addRecord(fixture)
        _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA })
        try FileManager.default.removeItem(at: third)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 0)
        #expect(!FileManager.default.fileExists(atPath: marker(fixture).path))
    }

    @Test("Explicit re-preparation pins changed valid evidence without deleting it and requires another boot",
           arguments: ["device", "inode", "content", "directory"])
    func reprepareChangedEvidence(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let record = try addRecord(fixture)
        _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA })
        if kind == "device" {
            var value = try StrictJSONTransport.object(from: Data(contentsOf: marker(fixture)))
            value["uses_device"] = "-1"
            try writePrivate(StrictJSONTransport.data(forJSONObject: value), to: marker(fixture))
        } else if kind == "inode" {
            let data = try Data(contentsOf: record)
            try FileManager.default.moveItem(at: record, to: fixture.container.appendingPathComponent("prior-record"))
            try writePrivate(data, to: record)
        } else if kind == "content" {
            try (Data(contentsOf: record) + Data([32])).write(to: record)
        } else {
            let uses = fixture.storeRoot.appendingPathComponent("uses")
            let old = fixture.container.appendingPathComponent("prior-uses")
            try FileManager.default.moveItem(at: uses, to: old)
            try FileManager.default.createDirectory(at: uses, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try writePrivate(Data(contentsOf: old.appendingPathComponent(record.lastPathComponent)), to: record)
        }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        }
        let currentBytes = try Data(contentsOf: record)
        #expect(try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == .restartRequired(outstandingUseCount: 1))
        #expect(try Data(contentsOf: record) == currentBytes)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 0)
        #expect(try Data(contentsOf: record) == currentBytes)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootC }) == 1)
        #expect(!FileManager.default.fileExists(atPath: record.path))
    }

    @Test("Known partial registration is retained on this boot and recovered on the next",
           arguments: [false, true])
    func partialRegistration(legacy: Bool) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        _ = try addRecord(fixture)
        let existing = try contents(fixture)
        for name in existing { try FileManager.default.removeItem(at: fixture.storeRoot.appendingPathComponent("uses/" + name)) }
        let name = ".registering-" + (legacy ? "" : Self.bootA + "-") + UUID().uuidString.lowercased()
        let partial = fixture.storeRoot.appendingPathComponent("uses/" + name)
        try writePrivate(Data("{\"schema_version\":".utf8), to: partial)
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .unavailable)
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == 0)
        if legacy {
            _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
                bootSessionID: { Self.bootA })
        }
        #expect(try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootB }) == 1)
        #expect(try contents(fixture).isEmpty)
    }

    @Test("A complete partial record cannot contradict its boot/name binding")
    func partialBootMismatch() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let file = try addRecord(fixture, boot: Self.bootB)
        let name = ".registering-" + Self.bootA + "-" + String(file.lastPathComponent.dropLast(5))
        let partial = file.deletingLastPathComponent().appendingPathComponent(name)
        try FileManager.default.moveItem(at: file, to: partial)
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        }
        #expect(FileManager.default.fileExists(atPath: partial.path))
    }

    @Test("A truncated unpublished marker can be retried without releasing uses")
    func interruptedMarkerPublication() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let file = try addRecord(fixture)
        let pending = fixture.storeRoot.appendingPathComponent(ClaudeRuntimePayloadUse.recoveryTemporaryName)
        try writePrivate(Data("{\"schema_version\":".utf8), to: pending)
        #expect(try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA }) == .restartRequired(outstandingUseCount: 1))
        #expect(FileManager.default.fileExists(atPath: file.path))
        #expect(!FileManager.default.fileExists(atPath: pending.path))
        #expect(FileManager.default.fileExists(atPath: marker(fixture).path))
    }

    @Test("Malformed, linked, permissive and unknown recovery state fails closed",
           arguments: ["marker-corrupt", "marker-symlink", "marker-hardlink", "marker-mode", "temp-symlink", "temp-hardlink", "temp-mode", "unknown"])
    func invalidRecoveryState(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let record = try addRecord(fixture)
        _ = try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot,
            bootSessionID: { Self.bootA })
        let file = kind.hasPrefix("temp") ? fixture.storeRoot.appendingPathComponent(ClaudeRuntimePayloadUse.recoveryTemporaryName) : marker(fixture)
        if kind.hasPrefix("temp") { try writePrivate(Data(), to: file) }
        if kind.hasSuffix("corrupt") { try writePrivate(Data("{}".utf8), to: file) }
        else if kind.hasSuffix("symlink") {
            let outside = fixture.container.appendingPathComponent("outside-marker")
            try FileManager.default.moveItem(at: file, to: outside)
            try FileManager.default.createSymbolicLink(at: file, withDestinationURL: outside)
        } else if kind.hasSuffix("hardlink") {
            #expect(link(file.path, fixture.container.appendingPathComponent("hardlink-marker").path) == 0)
        } else if kind.hasSuffix("mode") { #expect(chmod(file.path, 0o644) == 0) }
        else { try writePrivate(Data(), to: fixture.storeRoot.appendingPathComponent("unexpected.json")) }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        }
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .unavailable)
        #expect(FileManager.default.fileExists(atPath: record.path))
    }

    @Test("Preparation and recovery cannot cross a held installation admission")
    func admissionContention() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let record = try addRecord(fixture)
        let held = try ClaudePayloadAdmission.acquire(rootURL: fixture.storeRoot, create: false)
        defer { held.release() }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.prepareRecoveryAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.recoverAfterRestart(storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootB })
        }
        #expect(FileManager.default.fileExists(atPath: record.path))
        #expect(!FileManager.default.fileExists(atPath: marker(fixture).path))
    }

    @Test("Root and lock substitution invalidate admission", arguments: [false, true])
    func admissionSubstitution(replaceRoot: Bool) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        _ = try addRecord(fixture)
        let held = try ClaudePayloadAdmission.acquire(rootURL: fixture.storeRoot, create: false)
        defer { held.release() }
        if replaceRoot {
            try FileManager.default.moveItem(at: fixture.storeRoot, to: fixture.container.appendingPathComponent("old-root"))
            try FileManager.default.createDirectory(at: fixture.storeRoot, withIntermediateDirectories: false,
                                                   attributes: [.posixPermissions: 0o700])
        } else {
            let lock = fixture.storeRoot.appendingPathComponent("admission.lock")
            try FileManager.default.moveItem(at: lock, to: fixture.container.appendingPathComponent("old-lock"))
            try writePrivate(Data(), to: lock)
        }
        #expect(throws: (any Error).self) { try held.verify() }
    }

    @Test("Owner cleanup rejects an identical-data replacement inode")
    func replacedOwnedFile() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let owner = try ClaudeRuntimePayloadUse.begin(prepared: fixture.prepare(), runtimeIdentity: Self.identity,
            storeRootURL: fixture.storeRoot, bootSessionID: { Self.bootA })
        let name = try #require(contents(fixture).first)
        let file = fixture.storeRoot.appendingPathComponent("uses/" + name)
        let data = try Data(contentsOf: file)
        try FileManager.default.moveItem(at: file, to: fixture.container.appendingPathComponent("old-owned-record"))
        try writePrivate(data, to: file)
        #expect(throws: (any Error).self) { try owner.complete() }
        #expect(FileManager.default.fileExists(atPath: file.path))
    }

    private func marker(_ fixture: ClaudeRuntimePayloadFixture) -> URL {
        fixture.storeRoot.appendingPathComponent(ClaudeRuntimePayloadUse.recoveryMarkerName)
    }
    private func contents(_ fixture: ClaudeRuntimePayloadFixture) throws -> Set<String> {
        Set(try FileManager.default.contentsOfDirectory(atPath: fixture.storeRoot.appendingPathComponent("uses").path))
    }
    private func writePrivate(_ data: Data, to file: URL) throws {
        try data.write(to: file)
        guard chmod(file.path, 0o600) == 0 else { throw CoordinatorError("fixture_permissions") }
    }
    private func addRecord(_ fixture: ClaudeRuntimePayloadFixture, boot: String? = nil) throws -> URL {
        let prepared = try fixture.prepare()
        let uses = fixture.storeRoot.appendingPathComponent("uses")
        if !FileManager.default.fileExists(atPath: uses.path) {
            try FileManager.default.createDirectory(at: uses, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        }
        let id = UUID().uuidString.lowercased()
        var value = ["schema_version": "blabee.claude-runtime-use.v1", "use_id": id,
                     "payload_digest": prepared.digest, "runtime_identity": Self.identity]
        if let boot { value["schema_version"] = "blabee.claude-runtime-use.v2"; value["boot_session_id"] = boot }
        let url = uses.appendingPathComponent(id + ".json")
        try writePrivate(StrictJSONTransport.data(forJSONObject: value), to: url)
        return url
    }
}

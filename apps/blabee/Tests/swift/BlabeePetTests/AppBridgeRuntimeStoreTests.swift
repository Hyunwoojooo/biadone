import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("App bridge runtime store")
struct AppBridgeRuntimeStoreTests {
    @Test("A verified generation is reused with independent executable and complete resources")
    func copiesAndReuses() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let first = try metadata(executable)
        let lockURL = f.store.appendingPathComponent(AppBridgeRuntimeStore.admissionFileName)
        let firstLock = try metadata(lockURL)
        #expect(app == f.generation.appendingPathComponent("Blabee.app"))
        #expect(try f.prepare() == app)
        #expect(try metadata(executable).st_ino == first.st_ino)
        #expect(try metadata(lockURL).st_ino == firstLock.st_ino)
        #expect(try first.st_ino != metadata(f.executable).st_ino)
        #expect(first.st_mode & 0o7777 == 0o500)
        #expect(try metadata(app.appendingPathComponent("Contents/Resources/payload.txt")).st_mode & 0o7777 == 0o400)
        #expect(f.validate(app) == f.identity)
        let runtime = try AppRuntimeUseLease.acquire(executableURL: executable, use: .runtime)
        let installedReplacement = try AppRuntimeUseLease.acquire(executableURL: f.executable, use: .installation)
        try runtime.verify(at: executable)
        try installedReplacement.verify(at: f.executable)
    }

    @Test("Source executable remains leased throughout validation and copying")
    func sourceStaysLeased() throws {
        let f = try Fixture()
        defer { f.remove() }
        var checks = 0
        _ = try AppBridgeRuntimeStore.prepare(sourceURL: f.source, storeRootURL: f.store, expectedIdentity: f.identity) { app in
            #expect(throws: AppRuntimeUseLeaseError.busy) {
                try AppRuntimeUseLease.acquire(executableURL: f.executable, use: .installation)
            }
            checks += 1
            return f.validate(app)
        }
        #expect(checks >= 4)
        let released = try AppRuntimeUseLease.acquire(executableURL: f.executable, use: .installation)
        try released.verify(at: f.executable)
    }

    @Test("Concurrent preparation publishes and reuses exactly one generation", arguments: 0..<20)
    func concurrentPreparation(_: Int) async throws {
        let f = try Fixture()
        defer { f.remove() }
        let apps = try await withThrowingTaskGroup(of: URL.self) { group in
            for _ in 0..<8 { group.addTask { try f.prepare() } }
            var result: [URL] = []
            for try await app in group { result.append(app) }
            return result
        }
        #expect(apps.count == 8)
        #expect(Set(apps).count == 1)
        #expect(try Set(FileManager.default.contentsOfDirectory(atPath: f.store.path)) == [
            AppBridgeRuntimeStore.admissionFileName, String(f.identity.dropFirst(7))
        ])
    }

    @Test("Incomplete, tampered and hard-linked generations are rejected without repair")
    func invalidGenerationIsNeverRepaired() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let resource = app.appendingPathComponent("Contents/Resources/payload.txt")
        #expect(chmod(resource.path, 0o600) == 0)
        try Data("changed".utf8).write(to: resource)
        #expect(chmod(resource.path, 0o400) == 0)
        #expect(throws: (any Error).self) { try f.prepare() }
        #expect(try Data(contentsOf: resource) == Data("changed".utf8))
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.verifiedCurrentAppURL(executableURL: app.appendingPathComponent(AppRuntimeUseLease.executablePath),
                                                          storeRootURL: f.store, expectedIdentity: f.identity, validator: f.validate)
        }
        let partial = try Fixture()
        defer { partial.remove() }
        try FileManager.default.createDirectory(at: partial.generation, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data("keep partial".utf8).write(to: partial.generation.appendingPathComponent("marker"))
        #expect(throws: (any Error).self) { try partial.prepare() }
        #expect(try Data(contentsOf: partial.generation.appendingPathComponent("marker")) == Data("keep partial".utf8))
        let hard = try Fixture()
        defer { hard.remove() }
        let hardApp = try hard.prepare()
        let executable = hardApp.appendingPathComponent(AppRuntimeUseLease.executablePath)
        #expect(link(executable.path, hard.root.appendingPathComponent("alias").path) == 0)
        #expect(throws: (any Error).self) { try hard.prepare() }
    }

    @Test("Symlink and shared storage paths fail closed")
    func rejectsUnsafeStorage() throws {
        let f = try Fixture()
        defer { f.remove() }
        try FileManager.default.createDirectory(at: f.store, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
        #expect(throws: (any Error).self) { try f.prepare() }
        #expect(chmod(f.store.path, 0o700) == 0)
        let alias = f.root.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: f.store)
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.prepare(sourceURL: f.source, storeRootURL: alias, expectedIdentity: f.identity, validator: f.validate)
        }
        try FileManager.default.createSymbolicLink(at: f.generation, withDestinationURL: f.source)
        #expect(throws: (any Error).self) { try f.prepare() }
        #expect(f.validate(f.source) == f.identity)
    }

    @Test("Signature failure leaves only an unpublished stage and never changes the source")
    func failedPublication() throws {
        let f = try Fixture()
        defer { f.remove() }
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.prepare(sourceURL: f.source, storeRootURL: f.store, expectedIdentity: f.identity) { app in
                app.path == f.source.path ? f.identity : nil
            }
        }
        #expect(!FileManager.default.fileExists(atPath: f.generation.path))
        #expect(f.validate(f.source) == f.identity)
        #expect(try FileManager.default.contentsOfDirectory(atPath: f.store.path).contains { $0.hasPrefix(".staging-") })
        #expect(try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate).isEmpty)
        #expect(f.validate(try f.prepare()) == f.identity)
        #expect(try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate).isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: f.store.path).contains { $0.hasPrefix(".staging-") })
    }

    @Test("Only exact validated store membership avoids bootstrap recursion")
    func exactMembership() throws {
        let f = try Fixture()
        defer { f.remove() }
        #expect(try AppBridgeRuntimeStore.verifiedCurrentAppURL(executableURL: f.executable, storeRootURL: f.store,
                                                              expectedIdentity: f.identity, validator: f.validate) == nil)
        let app = try f.prepare()
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        #expect(try AppBridgeRuntimeStore.verifiedCurrentAppURL(executableURL: executable, storeRootURL: f.store,
                                                              expectedIdentity: f.identity, validator: f.validate) == app)
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.verifiedCurrentAppURL(executableURL: executable, storeRootURL: f.store,
                                                          expectedIdentity: "sha256:" + String(repeating: "b", count: 64), validator: f.validate)
        }
        let alias = f.root.appendingPathComponent("outside-alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: executable)
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.verifiedCurrentAppURL(executableURL: alias, storeRootURL: f.store,
                                                          expectedIdentity: f.identity, validator: f.validate)
        }
    }

    @Test("Exec handoff closes only a verified inherited lock after the runtime is leased")
    func execHandoff() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let admission = try AppBridgeRuntimeStore.acquireRuntimeAdmission(appURL: app, storeRootURL: f.store,
                                                                          expectedIdentity: f.identity, validator: f.validate)
        let parentDescriptor = try admission.prepareForExec()
        #expect(fcntl(parentDescriptor, F_GETFD) & FD_CLOEXEC == 0)
        // dup models the separately owned descriptor in the exec child without
        // closing Admission's descriptor in this same test process.
        let inherited = dup(parentDescriptor)
        #expect(inherited >= 3)
        let runtime = try AppRuntimeUseLease.acquire(executableURL: executable, use: .runtime)
        let completed = try AppBridgeRuntimeStore.completeExecAdmission(descriptor: inherited, executableURL: executable,
                                                                       runtimeLease: runtime, storeRootURL: f.store,
                                                                       expectedIdentity: f.identity, validator: f.validate)
        #expect(completed == app)
        #expect(fcntl(inherited, F_GETFD) == -1)
        #expect(fcntl(parentDescriptor, F_GETFD) >= 0)
        try runtime.verify(at: executable)
        withExtendedLifetime(admission) {}
    }

    @Test("Inventory cannot miss a runtime in the CLOEXEC-to-target-lease handoff gap")
    func inventoryExcludesExecGap() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        var admission: AppBridgeRuntimeStore.Admission? = try AppBridgeRuntimeStore.acquireRuntimeAdmission(
            appURL: app, storeRootURL: f.store, expectedIdentity: f.identity, validator: f.validate
        )
        let handoff = dup(try #require(admission).prepareForExec())
        guard handoff >= 3 else { throw CocoaError(.fileReadUnknown) }
        var ownsHandoff = true
        defer { if ownsHandoff { close(handoff) } }
        withExtendedLifetime(admission) {}
        admission = nil // exec closed normal source/target leases; only inherited store SH remains.
        do {
            let otherwiseInvisible = try AppRuntimeUseLease.acquire(executableURL: executable, use: .installation)
            try otherwiseInvisible.verify(at: executable)
        }
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate)
        }
        let target = try AppRuntimeUseLease.acquire(executableURL: executable, use: .runtime)
        _ = try AppBridgeRuntimeStore.completeExecAdmission(descriptor: handoff, executableURL: executable,
            runtimeLease: target, storeRootURL: f.store, expectedIdentity: f.identity, validator: f.validate)
        ownsHandoff = false
        #expect(try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate) == [f.identity])
        withExtendedLifetime(target) {}
    }

    @Test("Staging remains blocked if its native executable is active or origin record is tampered")
    func uncertainStagingIsPreserved() throws {
        let f = try Fixture()
        defer { f.remove() }
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.prepare(sourceURL: f.source, storeRootURL: f.store, expectedIdentity: f.identity) { app in
                app.path == f.source.path ? f.identity : nil
            }
        }
        let stageName = try #require(FileManager.default.contentsOfDirectory(atPath: f.store.path).first { $0.hasPrefix(".staging-") })
        let stage = f.store.appendingPathComponent(stageName)
        let executable = stage.appendingPathComponent("Blabee.app").appendingPathComponent(AppRuntimeUseLease.executablePath)
        #expect(try Data(contentsOf: executable) == Data("inert executable".utf8))
        var runtime: AppRuntimeUseLease? = try .acquire(executableURL: executable, use: .runtime)
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate)
        }
        withExtendedLifetime(runtime) {}
        runtime = nil
        #expect(try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate).isEmpty)
        let origin = stage.appendingPathComponent(".staging-origin")
        #expect(chmod(origin.path, 0o600) == 0)
        try Data("unknown origin".utf8).write(to: origin)
        #expect(chmod(origin.path, 0o400) == 0)
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate)
        }
        #expect(FileManager.default.fileExists(atPath: executable.path))
    }

    @Test("An untrusted FD is never closed by exec handoff")
    func invalidHandoffPreservesDescriptors() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let runtime = try AppRuntimeUseLease.acquire(executableURL: executable, use: .runtime)
        let unrelated = open(f.executable.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard unrelated >= 3 else { throw CocoaError(.fileReadUnknown) }
        defer { close(unrelated) }
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.completeExecAdmission(descriptor: unrelated, executableURL: executable,
                                                           runtimeLease: runtime, storeRootURL: f.store,
                                                           expectedIdentity: f.identity, validator: f.validate)
        }
        #expect(fcntl(unrelated, F_GETFD) >= 0)
    }

    @Test("Active generations survive GC and are reported independently of installed app use")
    func activeRuntimeProtection() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
        var runtime: AppRuntimeUseLease? = try .acquire(executableURL: executable, use: .runtime)
        #expect(try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate) == [f.identity])
        #expect(try AppBridgeRuntimeStore.collectUnused(storeRootURL: f.store, keepingIdentities: [], validator: f.validate,
                                                       providerUseGuard: { _ in NSObject() }).isEmpty)
        #expect(FileManager.default.fileExists(atPath: executable.path))
        withExtendedLifetime(runtime) {}
        runtime = nil
        #expect(try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate).isEmpty)
        #expect(try AppBridgeRuntimeStore.collectUnused(storeRootURL: f.store, keepingIdentities: [], validator: f.validate,
                                                       providerUseGuard: { _ in NSObject() }) == [f.identity])
        #expect(!FileManager.default.fileExists(atPath: app.path))
        #expect(f.validate(f.source) == f.identity)
    }

    @Test("GC preserves retained, unverified and unknown-provider generations")
    func conservativeCollection() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        #expect(try AppBridgeRuntimeStore.collectUnused(storeRootURL: f.store, keepingIdentities: [], validator: f.validate).isEmpty)
        #expect(try AppBridgeRuntimeStore.collectUnused(storeRootURL: f.store, keepingIdentities: [f.identity], validator: f.validate,
                                                       providerUseGuard: { _ in NSObject() }).isEmpty)
        #expect(try AppBridgeRuntimeStore.collectUnused(storeRootURL: f.store, keepingIdentities: [], validator: f.validate,
                                                       providerUseGuard: { _ in throw CoordinatorError("provider_use_unknown") }).isEmpty)
        #expect(try AppBridgeRuntimeStore.collectUnused(storeRootURL: f.store, keepingIdentities: [], validator: { _ in nil },
                                                       providerUseGuard: { _ in NSObject() }).isEmpty)
        let unknown = f.store.appendingPathComponent("unknown-owner")
        try FileManager.default.createDirectory(at: unknown, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        #expect(throws: (any Error).self) {
            try AppBridgeRuntimeStore.activeRuntimeIdentities(storeRootURL: f.store, validator: f.validate)
        }
        #expect(FileManager.default.fileExists(atPath: app.path))
    }

    @Test("A replaced admission lock cannot be used for an exec handoff")
    func lockReplacement() throws {
        let f = try Fixture()
        defer { f.remove() }
        let app = try f.prepare()
        let admission = try AppBridgeRuntimeStore.acquireRuntimeAdmission(appURL: app, storeRootURL: f.store,
                                                                          expectedIdentity: f.identity, validator: f.validate)
        let lockURL = f.store.appendingPathComponent(AppBridgeRuntimeStore.admissionFileName)
        try FileManager.default.moveItem(at: lockURL, to: f.root.appendingPathComponent("old-lock"))
        #expect(FileManager.default.createFile(atPath: lockURL.path, contents: Data(), attributes: [.posixPermissions: 0o600]))
        #expect(throws: (any Error).self) { try admission.prepareForExec() }
    }

    private func metadata(_ url: URL) throws -> stat {
        var value = stat()
        guard lstat(url.path, &value) == 0 else { throw CocoaError(.fileReadUnknown) }
        return value
    }

    private struct Fixture: Sendable {
        let root: URL, source: URL, store: URL, executable: URL, generation: URL
        let identity = "sha256:" + String(repeating: "a", count: 64)
        init() throws {
            guard let path = AppUpdateRuntimeCopy.physicalPath(FileManager.default.temporaryDirectory) else { throw CocoaError(.fileReadUnknown) }
            root = URL(fileURLWithPath: path, isDirectory: true).appendingPathComponent("blabee-bridge-runtime-" + UUID().uuidString)
            source = root.appendingPathComponent("Blabee.app")
            store = root.appendingPathComponent("runtimes")
            executable = source.appendingPathComponent(AppRuntimeUseLease.executablePath)
            generation = store.appendingPathComponent(String(identity.dropFirst(7)))
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
            let resources = source.appendingPathComponent("Contents/Resources")
            try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
            try Data("inert executable".utf8).write(to: executable)
            try Data("complete resource".utf8).write(to: resources.appendingPathComponent("payload.txt"))
            guard chmod(executable.path, 0o700) == 0 else { throw CocoaError(.fileWriteUnknown) }
        }
        func prepare() throws -> URL {
            try AppBridgeRuntimeStore.prepare(sourceURL: source, storeRootURL: store, expectedIdentity: identity, validator: validate)
        }
        func validate(_ app: URL) -> String? {
            guard (try? Data(contentsOf: app.appendingPathComponent(AppRuntimeUseLease.executablePath))) == Data("inert executable".utf8),
                  (try? Data(contentsOf: app.appendingPathComponent("Contents/Resources/payload.txt"))) == Data("complete resource".utf8)
            else { return nil }
            return identity
        }
        func remove() {
            // Fixtures include intentionally immutable/malformed trees. Unfreeze
            // only owned regular paths below this unique temporary root.
            func thaw(_ url: URL) {
                var value = stat()
                guard lstat(url.path, &value) == 0 else { return }
                if value.st_mode & S_IFMT == S_IFDIR {
                    _ = chmod(url.path, 0o700)
                    for child in (try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)) ?? [] { thaw(child) }
                } else if value.st_mode & S_IFMT == S_IFREG { _ = chmod(url.path, 0o600) }
            }
            thaw(root)
            try? FileManager.default.removeItem(at: root)
        }
    }
}

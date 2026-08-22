import CoordinatorSwift
import BlabeeProductSupport
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct ProductSettingsFixture: Sendable {
    let root: URL
    let applicationSupport: URL
    let bundle: URL

    init() throws {
        root = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("psw-\(UUID().uuidString)", isDirectory: true)
        applicationSupport = root.appendingPathComponent("Application Support", isDirectory: true)
        bundle = root.appendingPathComponent("Blabee.app", isDirectory: true)
        try FileManager.default.createDirectory(
            at: applicationSupport,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: bundle.appendingPathComponent(
                "Contents/Resources/Contracts/v1",
                isDirectory: true
            ),
            withIntermediateDirectories: true
        )
    }

    var productDirectory: URL {
        applicationSupport.appendingPathComponent("Blabee", isDirectory: true)
    }

    var configDirectory: URL {
        productDirectory.appendingPathComponent("config", isDirectory: true)
    }

    var configFile: URL {
        configDirectory.appendingPathComponent("service.json", isDirectory: false)
    }

    var lockFile: URL {
        configDirectory.appendingPathComponent(".service.json.lock", isDirectory: false)
    }

    func environment(identifier: String? = "com.biadone.blabee") -> ProductServiceEnvironment {
        ProductServiceEnvironment(
            invocation: ProductInvocationEnvironment(
                bundleIdentifier: identifier,
                bundleName: "Blabee",
                bundleExecutable: "blabee-coordinator",
                bundleURL: bundle,
                executableURL: bundle.appendingPathComponent(
                    "Contents/MacOS/blabee-coordinator",
                    isDirectory: false
                )
            ),
            resourceURL: bundle.appendingPathComponent("Contents/Resources", isDirectory: true),
            applicationSupportURL: applicationSupport
        )
    }

    func project(_ name: String) throws -> URL {
        let url = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        return URL(fileURLWithPath: "/private" + url.path, isDirectory: true)
    }

    func prepareSecureConfigDirectory() throws {
        try FileManager.default.createDirectory(
            at: configDirectory,
            withIntermediateDirectories: true
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: productDirectory.path
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: configDirectory.path
        )
    }

    func writeConfigData(_ data: Data) throws {
        try prepareSecureConfigDirectory()
        try data.write(to: configFile)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: configFile.path
        )
    }

    func temporaryConfigEntries() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: configDirectory.path)
            .filter { $0.hasPrefix(".service.json.") && $0.hasSuffix(".tmp") }
    }
}

private struct RunningSettingsHelper {
    let process: Process
    let input: Pipe
    let output: Pipe
    let error: Pipe
}

private final class ProductSettingsTestBundleToken: NSObject {}

private final class ProductSettingsTaskResults: @unchecked Sendable {
    private let lock = NSLock()
    private var storedErrors: [String] = []

    func record(_ error: Error) {
        lock.lock()
        storedErrors.append(error.coordinatorError.code)
        lock.unlock()
    }

    var errors: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storedErrors
    }
}

private func metadata(_ url: URL) throws -> stat {
    var info = stat()
    guard lstat(url.path, &info) == 0 else {
        throw CoordinatorError("test_metadata_failed")
    }
    return info
}

private func settingsErrorCode<T>(_ operation: () throws -> T) -> String? {
    do {
        _ = try operation()
        return nil
    } catch let error as CoordinatorError {
        return error.code
    } catch {
        return "unexpected_error"
    }
}

private func settingsHelperExecutable() throws -> URL {
    let productsDirectory = Bundle(for: ProductSettingsTestBundleToken.self)
        .bundleURL.deletingLastPathComponent()
    let candidate = productsDirectory.appendingPathComponent("BlabeeSettingsTestHelper")
    var info = stat()
    guard lstat(candidate.path, &info) == 0,
          info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
          info.st_uid == geteuid(),
          info.st_mode & 0o111 != 0,
          access(candidate.path, X_OK) == 0
    else {
        throw CoordinatorError("test_helper_missing", candidate.path)
    }
    return candidate
}

private func startSettingsHelper(
    fixture: ProductSettingsFixture,
    action: ProductServiceSettingsAction,
    project: String,
    synchronization: String,
    restrictiveUmask: Bool = false
) throws -> RunningSettingsHelper {
    let process = Process()
    let input = Pipe()
    let output = Pipe()
    let error = Pipe()
    process.executableURL = try settingsHelperExecutable()
    process.arguments = [
        "--fixture-root", fixture.root.path,
        "--action", action.rawValue,
        "--project", project,
        "--synchronization", synchronization,
    ] + (restrictiveUmask ? ["--restrictive-umask"] : [])
    process.standardInput = input
    process.standardOutput = output
    process.standardError = error
    try process.run()
    input.fileHandleForReading.closeFile()
    output.fileHandleForWriting.closeFile()
    error.fileHandleForWriting.closeFile()
    return RunningSettingsHelper(process: process, input: input, output: output, error: error)
}

private func readHelperEvent(
    _ helper: RunningSettingsHelper,
    timeoutMilliseconds: Int32 = 5_000
) throws -> String {
    let descriptor = helper.output.fileHandleForReading.fileDescriptor
    var bytes: [UInt8] = []
    while bytes.count < 128 {
        var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        while true {
            let result = Darwin.poll(&pollDescriptor, 1, timeoutMilliseconds)
            if result < 0, errno == EINTR { continue }
            guard result > 0 else { throw CoordinatorError("test_helper_timeout") }
            break
        }
        var byte: UInt8 = 0
        let count = Darwin.read(descriptor, &byte, 1)
        if count < 0, errno == EINTR { continue }
        guard count == 1 else { throw CoordinatorError("test_helper_output_failed") }
        if byte == 0x0A {
            guard let value = String(bytes: bytes, encoding: .utf8) else {
                throw CoordinatorError("test_helper_output_failed")
            }
            return value
        }
        bytes.append(byte)
    }
    throw CoordinatorError("test_helper_output_failed")
}

private func helperHasOutput(
    _ helper: RunningSettingsHelper,
    timeoutMilliseconds: Int32
) throws -> Bool {
    let descriptor = helper.output.fileHandleForReading.fileDescriptor
    var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
    while true {
        let result = Darwin.poll(&pollDescriptor, 1, timeoutMilliseconds)
        if result < 0, errno == EINTR { continue }
        guard result >= 0 else { throw CoordinatorError("test_helper_output_failed") }
        return result > 0
    }
}

private func releaseHelper(_ helper: RunningSettingsHelper) throws {
    try helper.input.fileHandleForWriting.write(contentsOf: Data([0x01]))
}

@discardableResult
private func waitForHelper(
    _ helper: RunningSettingsHelper,
    expectSuccess: Bool
) throws -> String {
    helper.input.fileHandleForWriting.closeFile()
    helper.process.waitUntilExit()
    let errorData = helper.error.fileHandleForReading.readDataToEndOfFile()
    let errorText = String(data: errorData, encoding: .utf8) ?? ""
    if expectSuccess {
        guard helper.process.terminationReason == .exit,
              helper.process.terminationStatus == 0
        else {
            throw CoordinatorError("test_helper_failed", errorText)
        }
    } else {
        guard helper.process.terminationReason == .exit,
              helper.process.terminationStatus != 0
        else {
            throw CoordinatorError("test_helper_unexpected_success")
        }
    }
    return errorText
}

@Suite("product service settings writer", .serialized)
struct ProductServiceSettingsWriterTests {
    @Test("first enable creates exact secure files and deterministic output under a restrictive umask")
    func firstEnableCreatesSecureConfiguration() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")

        let helper = try startSettingsHelper(
            fixture: fixture,
            action: .enable,
            project: project.path,
            synchronization: "none",
            restrictiveUmask: true
        )
        try waitForHelper(helper, expectSuccess: true)

        let configuration = try ProductServiceBootstrap.resolve(
            environment: fixture.environment()
        )
        #expect(configuration.enabledProjectPaths == [project.path])
        let productInfo = try metadata(fixture.productDirectory)
        let directoryInfo = try metadata(fixture.configDirectory)
        let configInfo = try metadata(fixture.configFile)
        let lockInfo = try metadata(fixture.lockFile)
        #expect(productInfo.st_mode & 0o7777 == 0o700)
        #expect(directoryInfo.st_mode & 0o7777 == 0o700)
        #expect(configInfo.st_mode & 0o7777 == 0o600)
        #expect(configInfo.st_nlink == 1)
        #expect(lockInfo.st_mode & 0o7777 == 0o600)
        #expect(lockInfo.st_nlink == 1)

        let result = try ProductProjectSettingsCommand.run(
            arguments: ["enable", "--project", project.path],
            environment: fixture.environment()
        )
        #expect(result.changed == false)
        #expect(result.status == "enabled")
        #expect(result.project == project.path)
        #expect(result.enabledProjects == [project.path])
        let output = try result.outputData()
        #expect(output.last == 0x0A)
        let decoded = try StrictJSONTransport.object(from: Data(output.dropLast()))
        #expect(Set(decoded.keys) == Set([
            "changed", "enabled_projects", "project", "status",
        ]))
        let repeatedOutput = try result.outputData()
        #expect(output == repeatedOutput)
    }

    @Test("command rejects loose arguments and lookalike bundles before touching settings")
    func commandFailsClosedOutsideExactProductBundle() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")

        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", project.path],
                environment: fixture.environment(identifier: "com.example.blabee")
            )
        } == "product_service_bundle_invalid")
        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", project.path],
                environment: fixture.environment()
            )
        } == "invalid_arguments")
        #expect(!FileManager.default.fileExists(atPath: fixture.productDirectory.path))
    }

    @Test("writer rejects a group or other writable Application Support parent")
    func writableApplicationSupportParentFailsClosed() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o777],
            ofItemAtPath: fixture.applicationSupport.path
        )

        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", project.path],
                environment: fixture.environment()
            )
        } == "product_service_config_unsafe")
        #expect(!FileManager.default.fileExists(atPath: fixture.productDirectory.path))
    }

    @Test("enable validates real directories while disable can remove a deleted stale path")
    func projectValidationAndStaleDisable() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")
        let symlink = fixture.root.appendingPathComponent("project-link", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: project)
        let realAncestor = try fixture.project("real-ancestor")
        let nestedProject = realAncestor.appendingPathComponent("nested", isDirectory: true)
        try FileManager.default.createDirectory(at: nestedProject, withIntermediateDirectories: false)
        let ancestorSymlink = fixture.root.appendingPathComponent(
            "ancestor-link",
            isDirectory: true
        )
        try FileManager.default.createSymbolicLink(
            at: ancestorSymlink,
            withDestinationURL: realAncestor
        )
        let projectThroughAncestorSymlink = ancestorSymlink.appendingPathComponent(
            "nested",
            isDirectory: true
        )

        for invalid in ["relative", "/", fixture.root.appendingPathComponent("missing").path,
                        symlink.path, projectThroughAncestorSymlink.path, "/tmp/nul\0suffix",
                        "/" + String(repeating: "x", count: 4_096)] {
            #expect(settingsErrorCode {
                try ProductProjectSettingsCommand.run(
                    arguments: ["enable", "--project", invalid],
                    environment: fixture.environment()
                )
            } == "project_settings_project_invalid")
        }

        let systemAliasPath = project.path.replacingOccurrences(
            of: "/private/tmp/",
            with: "/tmp/",
            options: .anchored
        )
        #expect(systemAliasPath != project.path)
        let enabled = try ProductProjectSettingsCommand.run(
            arguments: ["enable", "--project", systemAliasPath],
            environment: fixture.environment()
        )
        #expect(enabled.project == project.path)
        try FileManager.default.removeItem(at: project)
        let disabled = try ProductProjectSettingsCommand.run(
            arguments: ["disable", "--project", project.path + "/../project"],
            environment: fixture.environment()
        )
        #expect(disabled.changed)
        #expect(disabled.status == "disabled")
        #expect(disabled.project == project.path)
        #expect(disabled.enabledProjects == [])
    }

    @Test("idempotent mutations do not replace the config inode")
    func idempotentMutationDoesNotRewrite() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")
        let absent = fixture.root.appendingPathComponent("deleted-project").path

        _ = try ProductProjectSettingsCommand.run(
            arguments: ["enable", "--project", project.path],
            environment: fixture.environment()
        )
        let originalData = try Data(contentsOf: fixture.configFile)
        let originalInfo = try metadata(fixture.configFile)
        let enabledAgain = try ProductProjectSettingsCommand.run(
            arguments: ["enable", "--project", project.path],
            environment: fixture.environment()
        )
        let disabledAbsent = try ProductProjectSettingsCommand.run(
            arguments: ["disable", "--project", absent],
            environment: fixture.environment()
        )
        let finalInfo = try metadata(fixture.configFile)
        #expect(!enabledAgain.changed)
        #expect(!disabledAbsent.changed)
        #expect(try Data(contentsOf: fixture.configFile) == originalData)
        #expect(finalInfo.st_dev == originalInfo.st_dev)
        #expect(finalInfo.st_ino == originalInfo.st_ino)
    }

    @Test("malformed and unsafe existing config entries are never overwritten")
    func malformedAndUnsafeConfigRemainUntouched() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")
        let malformed = Data(#"{"schema_version":"1.0","enabled_projects":[]"#.utf8)
        try fixture.writeConfigData(malformed)

        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", project.path],
                environment: fixture.environment()
            )
        } == "product_service_config_invalid")
        #expect(try Data(contentsOf: fixture.configFile) == malformed)
        #expect(try fixture.temporaryConfigEntries().isEmpty)

        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: fixture.configFile.path
        )
        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", project.path],
                environment: fixture.environment()
            )
        } == "product_service_config_unsafe")
        #expect(try Data(contentsOf: fixture.configFile) == malformed)
        #expect(try fixture.temporaryConfigEntries().isEmpty)
    }

    @Test("hard-linked config and special lock files fail closed")
    func hardLinksAndSpecialLocksAreRejected() throws {
        let hardLinkFixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: hardLinkFixture.root) }
        let hardLinkProject = try hardLinkFixture.project("project")
        let nextProject = try hardLinkFixture.project("next")
        _ = try ProductProjectSettingsCommand.run(
            arguments: ["enable", "--project", hardLinkProject.path],
            environment: hardLinkFixture.environment()
        )
        let configAlias = hardLinkFixture.root.appendingPathComponent("config-alias")
        guard link(hardLinkFixture.configFile.path, configAlias.path) == 0 else {
            throw CoordinatorError("test_link_failed")
        }
        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", nextProject.path],
                environment: hardLinkFixture.environment()
            )
        } == "product_service_config_unsafe")

        let lockFixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: lockFixture.root) }
        let lockProject = try lockFixture.project("project")
        try lockFixture.prepareSecureConfigDirectory()
        guard mkfifo(lockFixture.lockFile.path, mode_t(0o600)) == 0 else {
            throw CoordinatorError("test_fifo_failed")
        }
        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", lockProject.path],
                environment: lockFixture.environment()
            )
        } == "product_service_config_unsafe")
        #expect(!FileManager.default.fileExists(atPath: lockFixture.configFile.path))
    }

    @Test("failure before rename preserves old config and failure after rename leaves complete JSON")
    func atomicWriteFailureSeams() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try fixture.project("first")
        let second = try fixture.project("second")
        let third = try fixture.project("third")
        _ = try ProductProjectSettingsCommand.run(
            arguments: ["enable", "--project", first.path],
            environment: fixture.environment()
        )
        let oldData = try Data(contentsOf: fixture.configFile)
        let oldInfo = try metadata(fixture.configFile)

        let beforeRenameWriter = ProductServiceSettingsWriter { point in
            if point == .beforeRename {
                throw CoordinatorError("test_before_rename_failure")
            }
        }
        #expect(settingsErrorCode {
            try beforeRenameWriter.update(
                action: .enable,
                project: second.path,
                environment: fixture.environment()
            )
        } == "test_before_rename_failure")
        let preservedInfo = try metadata(fixture.configFile)
        #expect(try Data(contentsOf: fixture.configFile) == oldData)
        #expect(preservedInfo.st_ino == oldInfo.st_ino)
        #expect(try fixture.temporaryConfigEntries().isEmpty)

        let afterRenameWriter = ProductServiceSettingsWriter { point in
            if point == .afterRenameBeforeDirectorySync {
                throw CoordinatorError("test_after_rename_failure")
            }
        }
        #expect(settingsErrorCode {
            try afterRenameWriter.update(
                action: .enable,
                project: third.path,
                environment: fixture.environment()
            )
        } == "product_service_config_durability_uncertain")
        let dataAfterRestart = try Data(contentsOf: fixture.configFile)
        _ = try StrictJSONTransport.object(from: dataAfterRestart)
        let afterRestart = try ProductServiceBootstrap.resolve(
            environment: fixture.environment()
        ).enabledProjectPaths
        #expect(afterRestart == [first.path, third.path])
        #expect(try fixture.temporaryConfigEntries().isEmpty)

        let retrySyncFailureWriter = ProductServiceSettingsWriter { point in
            if point == .beforeIdempotentDirectorySync {
                throw CoordinatorError("test_idempotent_sync_failure")
            }
        }
        #expect(settingsErrorCode {
            try retrySyncFailureWriter.update(
                action: .enable,
                project: third.path,
                environment: fixture.environment()
            )
        } == "product_service_config_durability_uncertain")

        let retry = try ProductServiceSettingsWriter().update(
            action: .enable,
            project: third.path,
            environment: fixture.environment()
        )
        #expect(!retry.changed)
        #expect(retry.enabledProjects == [first.path, third.path])
        _ = try StrictJSONTransport.object(from: Data(contentsOf: fixture.configFile))
        #expect(try fixture.temporaryConfigEntries().isEmpty)
    }

    @Test("writer rejects an encoded config over 64 KiB without replacing the old file")
    func encodedSizeLimitPreservesExistingConfig() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let project = try fixture.project("project")
        var selectedData: Data?

        for pathLength in 3_900...ProductServiceBootstrap.maximumProjectPathBytes {
            let paths = (0..<16).map { index -> String in
                let prefix = String(format: "/oversize/%02d/", index)
                return prefix + String(repeating: "x", count: pathLength - prefix.utf8.count)
            }.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
            let current = try StrictJSONTransport.data(forJSONObject: [
                "enabled_projects": paths,
                "schema_version": "1.0",
            ])
            let updated = try StrictJSONTransport.data(forJSONObject: [
                "enabled_projects": (paths + [project.path]).sorted {
                    $0.utf8.lexicographicallyPrecedes($1.utf8)
                },
                "schema_version": "1.0",
            ])
            if current.count <= ProductServiceBootstrap.maximumConfigBytes,
               updated.count > ProductServiceBootstrap.maximumConfigBytes
            {
                selectedData = current
                break
            }
        }
        guard let selectedData else {
            throw CoordinatorError("test_fixture_failed", "could not construct a bounded config")
        }
        try fixture.writeConfigData(selectedData)
        let oldInfo = try metadata(fixture.configFile)

        #expect(settingsErrorCode {
            try ProductProjectSettingsCommand.run(
                arguments: ["enable", "--project", project.path],
                environment: fixture.environment()
            )
        } == "product_service_config_invalid")
        let finalInfo = try metadata(fixture.configFile)
        #expect(try Data(contentsOf: fixture.configFile) == selectedData)
        #expect(finalInfo.st_dev == oldInfo.st_dev)
        #expect(finalInfo.st_ino == oldInfo.st_ino)
        #expect(try fixture.temporaryConfigEntries().isEmpty)
    }

    @Test("a waiter rejects replacement of the persistent lock name")
    func lockNameReplacementFailsClosed() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try fixture.project("first")
        let second = try fixture.project("second")
        _ = try ProductServiceSettingsWriter().update(
            action: .disable,
            project: fixture.root.appendingPathComponent("not-enabled").path,
            environment: fixture.environment()
        )

        let holder = try startSettingsHelper(
            fixture: fixture,
            action: .enable,
            project: first.path,
            synchronization: "before-rename"
        )
        #expect(try readHelperEvent(holder) == "before_rename")
        let waiter = try startSettingsHelper(
            fixture: fixture,
            action: .enable,
            project: second.path,
            synchronization: "observe-lock"
        )
        #expect(try readHelperEvent(waiter) == "before_lock")
        #expect(try !helperHasOutput(waiter, timeoutMilliseconds: 200))

        let displaced = fixture.configDirectory.appendingPathComponent(
            ".service.json.lock.displaced",
            isDirectory: false
        )
        guard rename(fixture.lockFile.path, displaced.path) == 0 else {
            throw CoordinatorError("test_lock_replace_failed")
        }
        let replacement = open(
            fixture.lockFile.path,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard replacement >= 0 else { throw CoordinatorError("test_lock_replace_failed") }
        guard fchmod(replacement, mode_t(0o600)) == 0 else {
            close(replacement)
            throw CoordinatorError("test_lock_replace_failed")
        }
        close(replacement)

        try releaseHelper(holder)
        try waitForHelper(holder, expectSuccess: true)
        let waiterError = try waitForHelper(waiter, expectSuccess: false)
        #expect(waiterError.contains("helper_failed:product_service_config_unsafe"))
        let enabled = try ProductServiceBootstrap.resolve(
            environment: fixture.environment()
        ).enabledProjectPaths
        #expect(enabled == [first.path])
        #expect(!enabled.contains(second.path))
    }

    @Test("overlapping writers in one process wait at the process mutex and retain both projects")
    func inProcessOverlapUsesProcessMutex() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try fixture.project("first")
        let second = try fixture.project("second")
        let firstAtRename = DispatchSemaphore(value: 0)
        let releaseFirst = DispatchSemaphore(value: 0)
        let secondBeforeProcessMutex = DispatchSemaphore(value: 0)
        let secondBeforeFileLock = DispatchSemaphore(value: 0)
        let results = ProductSettingsTaskResults()
        let group = DispatchGroup()
        let queue = DispatchQueue(
            label: "com.biadone.blabee.tests.settings-overlap",
            attributes: .concurrent
        )

        group.enter()
        queue.async {
            defer { group.leave() }
            do {
                let writer = ProductServiceSettingsWriter { point in
                    if point == .beforeRename {
                        firstAtRename.signal()
                        guard releaseFirst.wait(timeout: .now() + 5) == .success else {
                            throw CoordinatorError("test_overlap_timeout")
                        }
                    }
                }
                _ = try writer.update(
                    action: .enable,
                    project: first.path,
                    environment: fixture.environment()
                )
            } catch {
                results.record(error)
            }
        }
        guard firstAtRename.wait(timeout: .now() + 5) == .success else {
            throw CoordinatorError("test_overlap_timeout")
        }

        group.enter()
        queue.async {
            defer { group.leave() }
            do {
                let writer = ProductServiceSettingsWriter(eventObserver: { event in
                    if event == .beforeProcessMutex {
                        secondBeforeProcessMutex.signal()
                    } else if event == .beforeFileLock {
                        secondBeforeFileLock.signal()
                    }
                })
                _ = try writer.update(
                    action: .enable,
                    project: second.path,
                    environment: fixture.environment()
                )
            } catch {
                results.record(error)
            }
        }
        guard secondBeforeProcessMutex.wait(timeout: .now() + 5) == .success else {
            throw CoordinatorError("test_overlap_timeout")
        }
        #expect(secondBeforeFileLock.wait(timeout: .now() + .milliseconds(200)) == .timedOut)
        releaseFirst.signal()
        guard group.wait(timeout: .now() + 5) == .success else {
            throw CoordinatorError("test_overlap_timeout")
        }
        #expect(secondBeforeFileLock.wait(timeout: .now()) == .success)
        #expect(results.errors.isEmpty)

        let enabled = try ProductServiceBootstrap.resolve(
            environment: fixture.environment()
        ).enabledProjectPaths
        #expect(enabled == [first.path, second.path])
    }

    @Test("overlapping writers in separate processes retain both projects")
    func crossProcessOverlapDoesNotLoseUpdates() throws {
        let fixture = try ProductSettingsFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try fixture.project("first")
        let second = try fixture.project("second")

        // Initialize the persistent lock before launching independent helpers.
        _ = try ProductServiceSettingsWriter().update(
            action: .disable,
            project: fixture.root.appendingPathComponent("not-enabled").path,
            environment: fixture.environment()
        )

        let firstHelper = try startSettingsHelper(
            fixture: fixture,
            action: .enable,
            project: first.path,
            synchronization: "before-rename"
        )
        #expect(try readHelperEvent(firstHelper) == "before_rename")

        let secondHelper = try startSettingsHelper(
            fixture: fixture,
            action: .enable,
            project: second.path,
            synchronization: "observe-lock"
        )
        #expect(try readHelperEvent(secondHelper) == "before_lock")
        #expect(try !helperHasOutput(secondHelper, timeoutMilliseconds: 200))

        try releaseHelper(firstHelper)
        #expect(try readHelperEvent(secondHelper) == "lock_acquired")
        try waitForHelper(firstHelper, expectSuccess: true)
        try waitForHelper(secondHelper, expectSuccess: true)

        let enabled = try ProductServiceBootstrap.resolve(
            environment: fixture.environment()
        ).enabledProjectPaths
        #expect(enabled == [first.path, second.path])
    }
}

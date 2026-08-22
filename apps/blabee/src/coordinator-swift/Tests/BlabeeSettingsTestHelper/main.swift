import CoordinatorSwift
import BlabeeProductSupport
import Darwin
import Foundation

private struct HelperArguments {
    enum Synchronization: String {
        case none
        case beforeRename = "before-rename"
        case observeLock = "observe-lock"
    }

    let fixtureRoot: URL
    let action: ProductServiceSettingsAction
    let project: String
    let synchronization: Synchronization
    let restrictiveUmask: Bool

    init(_ values: [String]) throws {
        var raw: [String: String] = [:]
        var restrictiveUmask = false
        var index = 0
        while index < values.count {
            let flag = values[index]
            if flag == "--restrictive-umask" {
                guard !restrictiveUmask else { throw CoordinatorError("invalid_arguments") }
                restrictiveUmask = true
                index += 1
                continue
            }
            guard index + 1 < values.count,
                  ["--fixture-root", "--action", "--project", "--synchronization"].contains(flag),
                  raw[flag] == nil
            else { throw CoordinatorError("invalid_arguments") }
            raw[flag] = values[index + 1]
            index += 2
        }
        guard let rootPath = raw["--fixture-root"],
              let actionValue = raw["--action"],
              let action = ProductServiceSettingsAction(rawValue: actionValue),
              let project = raw["--project"],
              let synchronizationValue = raw["--synchronization"],
              let synchronization = Synchronization(rawValue: synchronizationValue),
              raw.count == 4
        else { throw CoordinatorError("invalid_arguments") }

        let root = URL(fileURLWithPath: rootPath, isDirectory: true).standardizedFileURL
        let normalizedRoot = Self.normalizedSystemAlias(root.path)
        let normalizedProject = Self.normalizedSystemAlias(
            URL(fileURLWithPath: project, isDirectory: true).standardizedFileURL.path
        )
        guard (normalizedRoot.hasPrefix("/private/tmp/") || normalizedRoot.hasPrefix("/tmp/")),
              normalizedRoot != "/private/tmp",
              normalizedRoot != "/tmp",
              normalizedProject.hasPrefix(normalizedRoot + "/")
        else { throw CoordinatorError("test_fixture_path_unsafe") }

        fixtureRoot = root
        self.action = action
        self.project = project
        self.synchronization = synchronization
        self.restrictiveUmask = restrictiveUmask
    }

    private static func normalizedSystemAlias(_ path: String) -> String {
        if path == "/tmp" { return "/private/tmp" }
        if path.hasPrefix("/tmp/") { return "/private" + path }
        return path
    }
}

private func writeEvent(_ value: String) throws {
    try FileHandle.standardOutput.write(contentsOf: Data((value + "\n").utf8))
}

private func waitForRelease() throws {
    var byte: UInt8 = 0
    while Darwin.read(STDIN_FILENO, &byte, 1) != 1 {
        if errno == EINTR { continue }
        throw CoordinatorError("test_release_failed")
    }
}

private func environment(root: URL) -> ProductServiceEnvironment {
    let bundle = root.appendingPathComponent("Blabee.app", isDirectory: true)
    return ProductServiceEnvironment(
        invocation: ProductInvocationEnvironment(
            bundleIdentifier: "com.biadone.blabee",
            bundleName: "Blabee",
            bundleExecutable: "blabee-coordinator",
            bundleURL: bundle,
            executableURL: bundle.appendingPathComponent(
                "Contents/MacOS/blabee-coordinator",
                isDirectory: false
            )
        ),
        resourceURL: bundle.appendingPathComponent("Contents/Resources", isDirectory: true),
        applicationSupportURL: root.appendingPathComponent(
            "Application Support",
            isDirectory: true
        )
    )
}

do {
    let arguments = try HelperArguments(Array(CommandLine.arguments.dropFirst()))
    if arguments.restrictiveUmask {
        _ = umask(mode_t(0o777))
    }
    let writer = ProductServiceSettingsWriter(
        failureInjector: { point in
            if point == .beforeRename, arguments.synchronization == .beforeRename {
                try writeEvent("before_rename")
                try waitForRelease()
            }
        },
        eventObserver: { event in
            guard arguments.synchronization == .observeLock else { return }
            if event == .beforeFileLock {
                try? writeEvent("before_lock")
            } else if event == .fileLockAcquired {
                try? writeEvent("lock_acquired")
            }
        }
    )
    _ = try writer.update(
        action: arguments.action,
        project: arguments.project,
        environment: environment(root: arguments.fixtureRoot)
    )
} catch {
    let failure = error.coordinatorError
    let data = ("helper_failed:\(failure.code)\n").data(using: .utf8) ?? Data()
    try? FileHandle.standardError.write(contentsOf: data)
    exit(1)
}

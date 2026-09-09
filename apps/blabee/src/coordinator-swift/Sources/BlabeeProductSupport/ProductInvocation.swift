import Foundation

package struct ProductInvocationEnvironment: Equatable {
    package let bundleIdentifier: String?
    package let bundleName: String?
    package let bundleExecutable: String?
    package let bundleURL: URL?
    package let executableURL: URL?

    package init(
        bundleIdentifier: String?,
        bundleName: String?,
        bundleExecutable: String?,
        bundleURL: URL?,
        executableURL: URL?
    ) {
        self.bundleIdentifier = bundleIdentifier
        self.bundleName = bundleName
        self.bundleExecutable = bundleExecutable
        self.bundleURL = bundleURL
        self.executableURL = executableURL
    }

    package static func live(bundle: Bundle = .main) -> ProductInvocationEnvironment {
        ProductInvocationEnvironment(
            bundleIdentifier: bundle.bundleIdentifier,
            bundleName: bundle.object(forInfoDictionaryKey: "CFBundleName") as? String,
            bundleExecutable: bundle.object(forInfoDictionaryKey: "CFBundleExecutable") as? String,
            bundleURL: bundle.bundleURL,
            executableURL: bundle.executableURL
        )
    }
}

package enum ProductInvocationResolver {
    package static func mode(
        commandLineArguments: [String],
        environment: ProductInvocationEnvironment
    ) -> String? {
        guard isNoUserArgumentLaunch(commandLineArguments) else {
            return commandLineArguments.count > 1 ? commandLineArguments[1] : nil
        }
        return isInstallationCandidateAppBundle(environment) ? "pet" : nil
    }

    /// Only implicit GUI launches enter onboarding. Explicit developer commands
    /// and background helpers retain their original dispatch.
    package static func requiresInstallation(
        commandLineArguments: [String],
        environment: ProductInvocationEnvironment
    ) -> Bool {
        isNoUserArgumentLaunch(commandLineArguments)
            && isInstallationCandidateAppBundle(environment)
            && !isStandardInstalledApp(environment)
    }

    package static func isStandardInstalledApp(
        _ environment: ProductInvocationEnvironment
    ) -> Bool {
        isExpectedAppBundle(environment)
            && environment.bundleURL?.standardizedFileURL.path == "/Applications/Blabee.app"
    }

    private static func isNoUserArgumentLaunch(_ arguments: [String]) -> Bool {
        arguments.count == 1
            || (arguments.count == 2 && isLaunchServicesProcessSerialNumber(arguments[1]))
    }

    private static func isLaunchServicesProcessSerialNumber(_ value: String) -> Bool {
        guard value.hasPrefix("-psn_") else { return false }
        let fields = value.dropFirst(5).split(separator: "_", omittingEmptySubsequences: false)
        guard fields.count == 2 else { return false }
        return fields.allSatisfy { field in
            !field.isEmpty && field.utf8.allSatisfy { byte in
                byte >= 48 && byte <= 57
            }
        }
    }

    package static func isExpectedAppBundle(
        _ environment: ProductInvocationEnvironment
    ) -> Bool {
        isInstallationCandidateAppBundle(environment)
            && environment.bundleURL?.standardizedFileURL.lastPathComponent == "Blabee.app"
    }

    // Renaming a downloaded app must not strand the user. This is routing only;
    // the installer independently verifies the running code and signed bundle.
    package static func isInstallationCandidateAppBundle(
        _ environment: ProductInvocationEnvironment
    ) -> Bool {
        guard environment.bundleIdentifier == "com.biadone.blabee",
              environment.bundleName == "Blabee",
              environment.bundleExecutable == "blabee-coordinator",
              let rawBundleURL = environment.bundleURL,
              rawBundleURL.isFileURL,
              let rawExecutableURL = environment.executableURL,
              rawExecutableURL.isFileURL,
              let bundleURL = environment.bundleURL?.standardizedFileURL,
              let executableURL = environment.executableURL?.standardizedFileURL,
              bundleURL.pathExtension == "app"
        else {
            return false
        }
        let expectedExecutable = bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("MacOS", isDirectory: true)
            .appendingPathComponent("blabee-coordinator", isDirectory: false)
            .standardizedFileURL
        return executableURL == expectedExecutable
    }
}

import Foundation

struct ProductInvocationEnvironment: Equatable {
    let bundleIdentifier: String?
    let bundleName: String?
    let bundleExecutable: String?
    let bundleURL: URL?
    let executableURL: URL?

    static func live(bundle: Bundle = .main) -> ProductInvocationEnvironment {
        ProductInvocationEnvironment(
            bundleIdentifier: bundle.bundleIdentifier,
            bundleName: bundle.object(forInfoDictionaryKey: "CFBundleName") as? String,
            bundleExecutable: bundle.object(forInfoDictionaryKey: "CFBundleExecutable") as? String,
            bundleURL: bundle.bundleURL,
            executableURL: bundle.executableURL
        )
    }
}

enum ProductInvocationResolver {
    static func mode(
        commandLineArguments: [String],
        environment: ProductInvocationEnvironment
    ) -> String? {
        let isNoUserArgumentLaunch = commandLineArguments.count == 1
            || (commandLineArguments.count == 2
                && isLaunchServicesProcessSerialNumber(commandLineArguments[1]))
        guard isNoUserArgumentLaunch else {
            return commandLineArguments.count > 1 ? commandLineArguments[1] : nil
        }
        return isExpectedAppBundle(environment) ? "pet" : nil
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

    static func isExpectedAppBundle(
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
              bundleURL.lastPathComponent == "Blabee.app",
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

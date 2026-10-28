import Foundation

#if BLABEE_CLAUDE_PREVIEW
#error("BLABEE_CLAUDE_PREVIEW is obsolete; build the unified Blabee app.")
#endif

/// The build fixes the identity before any service or account is constructed.
/// Environment variables and launch arguments cannot switch execution profiles.
package enum BlabeeProductProfile: String, Sendable, CaseIterable {
#if BLABEE_TEST_APP
    case blabeeTest = "blabee-test"

    package static let current: Self = .blabeeTest
    package var isTestApp: Bool { true }
#else
    case blabee

    package static let current: Self = .blabee
    package var isTestApp: Bool { false }
#endif

    package var profileID: String { rawValue }
    package var displayName: String { isTestApp ? "Blabee Test" : "Blabee" }
    package var appBundleName: String { displayName + ".app" }
    package var bundleIdentifier: String {
        isTestApp ? "com.biadone.blabee.test" : "com.biadone.blabee"
    }
    package var installedAppPath: String { "/Applications/" + appBundleName }
    package var applicationSupportDirectoryName: String { displayName }
    package var primaryFreshnessAccount: String {
        // M1 never constructs a real authority. A later Engine milestone must
        // provide a run-bound test-<UUID> slot instead of inheriting "primary".
        precondition(!isTestApp, "The Test app requires an explicit run-bound freshness account.")
        return "primary"
    }
    package var serviceLabel: String { bundleIdentifier + ".coordinator" }
    package var servicePlistName: String { serviceLabel + ".plist" }

    package func matchesDistributionMarker(_ marker: String?) -> Bool {
        marker == profileID || (!isTestApp && marker == nil)
    }

    package func distributionData() throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: [
            "schema_version": "blabee.distribution-profile.v1",
            "profile_id": profileID,
            "bundle_identifier": bundleIdentifier,
        ], options: [.sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        return data
    }
}

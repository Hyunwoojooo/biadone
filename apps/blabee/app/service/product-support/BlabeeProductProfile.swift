import Foundation

#if BLABEE_CLAUDE_PREVIEW
#error("BLABEE_CLAUDE_PREVIEW is obsolete; build the unified Blabee app.")
#endif

/// One installed app owns the common engine and both provider bridges.
/// Environment variables and launch arguments cannot select another product.
package enum BlabeeProductProfile: String, Sendable, CaseIterable {
    case blabee

    package static let current: Self = .blabee

    package var profileID: String { rawValue }
    package var displayName: String { "Blabee" }
    package var appBundleName: String { displayName + ".app" }
    package var bundleIdentifier: String { "com.biadone.blabee" }
    package var installedAppPath: String { "/Applications/" + appBundleName }
    package var applicationSupportDirectoryName: String { "Blabee" }
    package var primaryFreshnessAccount: String { "primary" }
    package var serviceLabel: String { bundleIdentifier + ".coordinator" }
    package var servicePlistName: String { serviceLabel + ".plist" }

    package func matchesDistributionMarker(_ marker: String?) -> Bool {
        marker == nil || marker == profileID
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

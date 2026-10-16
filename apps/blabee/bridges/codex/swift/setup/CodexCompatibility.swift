import Foundation

/// Codex CLI versions qualified for each Blabee integration capability.
///
/// Keep parsing and qualification separate so callers can run `codex --version`
/// on an appropriate worker and then apply the same fail-closed policy.
enum CodexCompatibility {
    static let alphaBaselineVersion = "0.148.0"
    static let maximumVersionOutputBytes = 4_096

    enum CapabilityProfile: Hashable, Sendable {
        case managedAppServer
        case pluginCLI
    }

    /// One version-to-capability matrix keeps feature-specific qualification
    /// explicit without duplicating version literals across independent
    /// allowlists. A version is approved only for the capabilities listed here.
    private static let capabilityMatrix: [String: Set<CapabilityProfile>] = [
        "0.149.1": [.managedAppServer],
        "0.150.1": [.managedAppServer],
        "0.151.0": [.managedAppServer, .pluginCLI],
        "0.152.0": [.pluginCLI],
        "0.152.1": [.pluginCLI],
        "0.153.0": [.pluginCLI],
        "0.153.1": [.pluginCLI],
        "0.153.2": [.pluginCLI],
        "0.153.3": [.pluginCLI],
        "0.153.4": [.pluginCLI],
        "0.154.0": [.pluginCLI],
        "0.155.0": [.managedAppServer, .pluginCLI],
        "0.155.1": [.managedAppServer, .pluginCLI],
        "0.156.0": [.managedAppServer, .pluginCLI],
        "0.156.1": [.managedAppServer, .pluginCLI],
        "0.157.0": [.managedAppServer, .pluginCLI],
        "0.157.1": [.managedAppServer, .pluginCLI],
        "0.158.0": [.managedAppServer, .pluginCLI],
        "0.159.0": [.managedAppServer, .pluginCLI],
        "0.159.1": [.managedAppServer, .pluginCLI],
        "0.159.2": [.managedAppServer, .pluginCLI],
        "0.159.3": [.managedAppServer, .pluginCLI],
        "0.160.0": [.managedAppServer, .pluginCLI],
        "0.160.1": [.managedAppServer, .pluginCLI],
        "0.161.0": [.managedAppServer, .pluginCLI],
        "0.162.0": [.managedAppServer, .pluginCLI],
        "0.162.1": [.managedAppServer, .pluginCLI],
        "0.163.0": [.managedAppServer, .pluginCLI],
    ]

    static let supportedVersions = supportedVersions(for: .managedAppServer)
    static let pluginCLISupportedVersions = supportedVersions(for: .pluginCLI)

    static func supportedVersions(
        for capability: CapabilityProfile
    ) -> Set<String> {
        Set(capabilityMatrix.compactMap { version, capabilities in
            capabilities.contains(capability) ? version : nil
        })
    }

    enum Qualification: Equatable, Sendable {
        case supported(version: String)
        case alphaQualificationRequired(version: String)
        case notAllowlisted(version: String)
        case unavailable

        var isApprovedForManagedUse: Bool {
            if case .supported = self { return true }
            return false
        }

        var diagnosticCode: String {
            switch self {
            case .supported:
                return "codex_version_supported"
            case .alphaQualificationRequired:
                return "codex_alpha_qualification_required"
            case .notAllowlisted:
                return "codex_version_not_allowlisted"
            case .unavailable:
                return "codex_version_unavailable"
            }
        }
    }

    static func parseVersionOutput(_ data: Data) -> String? {
        guard data.count <= maximumVersionOutputBytes,
              let output = String(data: data, encoding: .utf8)
        else { return nil }
        return parseVersionOutput(output)
    }

    static func parseVersionOutput(_ output: String) -> String? {
        guard output.utf8.count <= maximumVersionOutputBytes else { return nil }
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "codex-cli "
        guard trimmed.hasPrefix(prefix) else { return nil }

        let version = String(trimmed.dropFirst(prefix.count))
        guard version.range(
            of: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
            options: .regularExpression
        ) != nil else { return nil }
        return version
    }

    static func qualify(version: String?) -> Qualification {
        guard let version else { return .unavailable }
        if supportedVersions.contains(version) {
            return .supported(version: version)
        }
        if version == alphaBaselineVersion {
            return .alphaQualificationRequired(version: version)
        }
        return .notAllowlisted(version: version)
    }
}

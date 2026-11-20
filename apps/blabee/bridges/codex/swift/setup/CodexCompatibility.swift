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
        /// The App Server owns runtime workspace roots, so managed TUI overrides
        /// are routed to it (`ManagedCodexLauncher`). Audited from 0.156.0.
        case serverOwnedWorkspaceRoots
        /// Update-time managed session lifecycle (`UpdateManagedCodexProfile`).
        case updateLifecycle
    }

    /// One version-to-capability matrix keeps feature-specific qualification
    /// explicit without duplicating version literals across independent
    /// allowlists. A version is approved only for the capabilities listed here.
    private static let capabilityMatrix: [String: Set<CapabilityProfile>] = Dictionary(
        uniqueKeysWithValues: CodexQualificationData.releases.map { ($0.version, $0.capabilities) }
    )

    static let supportedVersions = supportedVersions(for: .managedAppServer)
    static let pluginCLISupportedVersions = supportedVersions(for: .pluginCLI)

    static func supportedVersions(
        for capability: CapabilityProfile
    ) -> Set<String> {
        Set(capabilityMatrix.compactMap { version, capabilities in
            capabilities.contains(capability) ? version : nil
        })
    }

    /// Plugin/Hook path only (suggestion cards, `codex queue`, Plugin setup).
    /// The managed path keeps `qualify(version:)`, and command approval keeps
    /// the exact CDHash list: neither is widened by `unreviewedNewer`.
    /// Design: docs/features/CODEX_UNREVIEWED_VERSION_DESIGN.md.
    enum PluginAdmission: Equatable, Sendable {
        case reviewed
        /// Not registered, but newer than every registered Plugin release in
        /// the same major version and not on the blocklist.
        case unreviewedNewer
        case rejected
    }

    static let blockedPluginVersions = CodexQualificationData.blockedPluginVersions

    static func pluginAdmission(version: String) -> PluginAdmission {
        pluginAdmission(version: version, registered: pluginCLISupportedVersions, blocked: blockedPluginVersions)
    }

    static func pluginAdmission(
        version: String, registered: Set<String>, blocked: Set<String>
    ) -> PluginAdmission {
        if registered.contains(version) { return .reviewed }
        guard !blocked.contains(version), let candidate = stableComponents(version),
              let newest = registered.compactMap(stableComponents).max(by: precedes),
              candidate[0] == newest[0], precedes(newest, candidate)
        else { return .rejected }
        return .unreviewedNewer
    }

    /// Any rule or list change gives failure records a new policy, so a
    /// version rejected under the old rule is examined again.
    static var pluginPolicyRevision: String {
        pluginPolicyRevision(registered: pluginCLISupportedVersions, blocked: blockedPluginVersions)
    }

    static func pluginPolicyRevision(registered: Set<String>, blocked: Set<String>) -> String {
        "native-v2-newer:" + registered.sorted().joined(separator: ",")
            + "|blocked:" + blocked.sorted().joined(separator: ",")
    }

    /// Exactly `X.Y.Z` in ASCII digits without leading zeros; anything else,
    /// including a component that does not fit `Int`, is not a stable version.
    private static func stableComponents(_ version: String) -> [Int]? {
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var components: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.utf8.allSatisfy({ (0x30...0x39).contains($0) }),
                  part == "0" || part.utf8.first != 0x30, let value = Int(part)
            else { return nil }
            components.append(value)
        }
        return components
    }

    private static func precedes(_ lhs: [Int], _ rhs: [Int]) -> Bool {
        lhs.lexicographicallyPrecedes(rhs)
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

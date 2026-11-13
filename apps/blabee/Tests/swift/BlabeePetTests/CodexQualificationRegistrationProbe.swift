import Foundation
import Testing
@testable import BlabeeCoordinator

/// Opt-in measurement used by scripts/codex/register-version.mjs. It inspects
/// an extracted official Codex package with production executable verification
/// and writes exactly what the qualification catalog compares. It never edits
/// the catalog; the script writes a JSON record for human review.
@Test("Codex registration probe (opt-in)",
      .enabled(if: ProcessInfo.processInfo.environment["BLABEE_CODEX_REGISTER_PACKAGE"] != nil))
func codexQualificationRegistrationProbe() throws {
    let environment = ProcessInfo.processInfo.environment
    let package = URL(fileURLWithPath: try #require(environment["BLABEE_CODEX_REGISTER_PACKAGE"]))
    let output = URL(fileURLWithPath: try #require(environment["BLABEE_CODEX_REGISTER_OUTPUT"]))
    let inspection = try ManagedCodexRuntimeBundleInspector.inspect(
        executableURL: package.appendingPathComponent("bin/codex"),
        executableVerification: .production
    )
    let summary = ManagedCodexRuntimeBundleQualificationCatalog.registrationSummaryForTesting(inspection)
    let object: [String: Any] = [
        "version": inspection.manifest.version,
        "target": inspection.manifest.target,
        "exec_server": inspection.manifest.execServer as Any? ?? NSNull(),
        "file_digests": summary.fileDigests,
        "executable_teams": summary.executableTeams.sorted(),
        "fingerprint": summary.fingerprint,
    ]
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .prettyPrinted])
        .write(to: output, options: .withoutOverwriting)
}

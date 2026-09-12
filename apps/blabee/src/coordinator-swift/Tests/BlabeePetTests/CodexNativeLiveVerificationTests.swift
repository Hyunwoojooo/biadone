import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private func measuredNativeStage<T>(_ label: String, operation: () throws -> T) rethrows -> T {
    let start = DispatchTime.now().uptimeNanoseconds
    defer {
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        print("NATIVE_LIVE_STAGE \(label) elapsed_ms=\(Int(elapsed))")
    }
    return try operation()
}

/// Opt-in installed-runtime verification. Uses isolated failure records and only
/// invokes --version; it never submits a message or changes the user's Codex.
@Test(.enabled(if: ProcessInfo.processInfo.environment["BLABEE_NATIVE_LIVE_VERIFY"] == "1"))
func codexNativeInstalledRuntimeVerification() async throws {
    let source = try #require(ProcessInfo.processInfo.environment["BLABEE_NATIVE_LIVE_EXECUTABLE"])
    let budget = Int(ProcessInfo.processInfo.environment["BLABEE_NATIVE_LIVE_TIMEOUT_MS"] ?? "45000") ?? 45_000
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-native-live-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: root, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let live = CodexNativeRuntime.live(explicitExecutableURL: URL(fileURLWithPath: source))
    let runtime = CodexNativeRuntime(
        candidates: live.candidates,
        qualifier: { source, runner, preflight, timeout in
            try measuredNativeStage("qualify budget_ms=\(timeout)") {
                try live.qualifier(source, runner, preflight, timeout)
            }
        },
        revalidator: { selection in
            try measuredNativeStage("revalidate") { try live.revalidator(selection) }
        },
        processRunner: { executable, arguments, timeout in
            try measuredNativeStage("process \(arguments.first ?? "") budget_ms=\(timeout)") {
                try live.processRunner(executable, arguments, timeout)
            }
        },
        preflight: { executable, timeout in
            try measuredNativeStage("notarization budget_ms=\(timeout)") {
                try live.preflight(executable, timeout)
            }
        },
        failureGuard: CodexNativeFailureGuard(
            directoryURL: root.appendingPathComponent("failures", isDirectory: true),
            policyRevision: "isolated-live-verification-v1"
        )
    )
    let result = try await Task.detached(priority: .utility) {
        try measuredNativeStage("total budget_ms=\(budget)") {
            try runtime.perform(arguments: ["--version"], timeoutMilliseconds: budget)
        }
    }.value
    #expect(result.exitCode == 0)
    let version = try #require(CodexCompatibility.parseVersionOutput(result.stdout))
    if let expectedVersion = ProcessInfo.processInfo.environment["BLABEE_NATIVE_LIVE_EXPECTED_VERSION"] {
        #expect(version == expectedVersion)
    }
    print("NATIVE_LIVE_VERSION \(version)")
}

import CoordinatorSwift
import Darwin
import Foundation

/// Keep the Marketplace/installed entrypoint stable. Only long-lived clients
/// reexec; the GUI and the sole authoritative service remain in the installed app.
enum AppBridgeRuntimeBootstrap {
    static let admissionEnvironmentKey = "BLABEE_BRIDGE_RUNTIME_ADMISSION_FD"
    static let transitionEnvironmentKey = "BLABEE_BRIDGE_UPDATE_ADMISSION_FD"

    static func requiresDetachedRuntime(commandLine: [String]) -> Bool {
        guard commandLine.count >= 2 else { return false }
        return ["mcp", "claude-installed-launcher"].contains(commandLine[1])
    }

    /// A copied/direct target returns its still-held request admission. The
    /// caller releases it only AFTER acquireCurrent + completeExecAdmission.
    /// This also covers the gap between this function returning and main taking
    /// ownership of the long-lived executable lease.
    static func reexecIfNeeded(commandLine: [String]) throws -> AppUpdateAdmissionLease? {
        guard requiresDetachedRuntime(commandLine: commandLine),
              let executable = AppRuntimeUseLease.packagedExecutable(Bundle.main.executableURL)
        else { return nil }
        let environment = ProcessInfo.processInfo.environment
        let inheritedTransition = environment[transitionEnvironmentKey]
        guard (inheritedTransition == nil) == (environment[admissionEnvironmentKey] == nil) else {
            throw CoordinatorError("bridge_runtime_admission_unverified")
        }
        // Direct copied launches participate too. An exec target adopts the
        // existing request admission before considering its membership; it must
        // not disappear from the updater's inventory during CLOEXEC cleanup.
        let transition = try acquireStartupAdmission(inheritedDescriptor: inheritedTransition)
        if inheritedTransition != nil { unsetenv(transitionEnvironmentKey) }
        let sourceLease = try AppRuntimeUseLease.acquireCurrent(executableURL: executable)
        defer { withExtendedLifetime(sourceLease) {} }
        let identity = try OperationalRuntimeIdentity.requireCurrent()
        if try AppBridgeRuntimeStore.verifiedCurrentAppURL(
            executableURL: executable, expectedIdentity: identity
        ) != nil { return transition }
        guard inheritedTransition == nil else { throw CoordinatorError("bridge_runtime_admission_unverified") }

        // The updater can now prevent a new installed bootstrap from creating
        // another generation between its inventory and app replacement.
        defer { withExtendedLifetime(transition) {} }
        let copied = try AppBridgeRuntimeStore.prepareCurrent()
        let source = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        var forwarded = Array(commandLine.dropFirst(2))
        if commandLine[1] == "claude-installed-launcher" {
            forwarded = try ClaudeInstalledLauncherArguments.rebasedForRuntimeCopy(
                forwarded, sourceBundleURL: source, copiedBundleURL: copied
            )
        }
        // GC is optional and conservative. It cannot remove a running native
        // generation or any generation with uncertain Claude child usage.
        try? AppBridgeRuntimeStore.collectUnused(keepingIdentities: [identity], providerUseGuard: { _ in
            try ClaudeRuntimePayloadUse.acquireInstallationGuard()
        })
        let admission = try AppBridgeRuntimeStore.acquireRuntimeAdmission(
            appURL: copied, expectedIdentity: identity
        )
        defer { withExtendedLifetime(admission) {} }
        try sourceLease.verify(at: executable)
        let descriptor = try admission.prepareForExec()
        let transitionDescriptor = try transition.prepareForExec()
        defer { unsetenv(admissionEnvironmentKey); unsetenv(transitionEnvironmentKey) }
        guard setenv(admissionEnvironmentKey, String(descriptor), 1) == 0,
              setenv(transitionEnvironmentKey, String(transitionDescriptor), 1) == 0 else {
            throw CoordinatorError("bridge_runtime_exec_unavailable")
        }
        let target = copied.appendingPathComponent(AppRuntimeUseLease.executablePath).path
        let arguments = [target, commandLine[1]] + forwarded
        let storage = arguments.map { strdup($0) }
        defer { storage.forEach { free($0) } }
        guard storage.allSatisfy({ $0 != nil }) else {
            throw CoordinatorError("bridge_runtime_exec_unavailable")
        }
        var argv = storage + [nil]
        _ = argv.withUnsafeMutableBufferPointer { execv(target, $0.baseAddress!) }
        // Only a failed exec reaches this path. Installed/copy/store leases
        // close normally; a still-running installed parent is never retained.
        throw CoordinatorError("bridge_runtime_exec_unavailable")
    }

    static func acquireStartupAdmission(
        inheritedDescriptor raw: String?, directoryURL: URL = AppUpdateAdmissionGate.defaultDirectoryURL
    ) throws -> AppUpdateAdmissionLease {
        guard let raw else { return try AppUpdateAdmissionGate.acquireRequest(directoryURL: directoryURL) }
        guard let descriptor = Int32(raw), descriptor >= 3, String(descriptor) == raw else {
            throw CoordinatorError("bridge_runtime_admission_unverified")
        }
        return try AppUpdateAdmissionGate.adoptInheritedRequest(descriptor: descriptor, directoryURL: directoryURL)
    }

    static func completeExecAdmission(runtimeLease: AppRuntimeUseLease) throws {
        guard let raw = ProcessInfo.processInfo.environment[admissionEnvironmentKey] else { return }
        guard let descriptor = Int32(raw), descriptor >= 3, String(descriptor) == raw,
              let executable = AppRuntimeUseLease.packagedExecutable(Bundle.main.executableURL)
        else { throw CoordinatorError("bridge_runtime_admission_unverified") }
        _ = try AppBridgeRuntimeStore.completeExecAdmission(
            descriptor: descriptor, executableURL: executable, runtimeLease: runtimeLease,
            expectedIdentity: OperationalRuntimeIdentity.requireCurrent()
        )
        unsetenv(admissionEnvironmentKey)
    }
}

import Foundation

struct LauncherRuntimeConfiguration: Equatable, Sendable {
    let executableURL: URL
    let arguments: [String]
    let dataRootURL: URL
    let environment: [String: String]

    static func resolve(
        dataRootChoice: LauncherDataRootChoice? = nil,
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> LauncherRuntimeConfiguration {
        let resolvedDataRoot = try resolveDataRoot(
            choice: dataRootChoice,
            environment: environment,
            fileManager: fileManager
        )
        let dataRoot = resolvedDataRoot.url
        var childEnvironment = sanitizedChildEnvironment(environment)
        childEnvironment["BLABASE_LAUNCHER_SOURCE_MODE"] =
            resolvedDataRoot.sourceMode.rawValue

#if DEBUG
        if let executable = environment["BLABASE_LAUNCHER_AGENT_EXECUTABLE"] {
            guard
                executable.hasPrefix("/"),
                fileManager.isExecutableFile(atPath: executable)
            else {
                throw LauncherAgentError.invalidRuntime("relative executable")
            }
            let extraArguments = try decodeDevelopmentArguments(
                environment["BLABASE_LAUNCHER_AGENT_ARGUMENTS_JSON"]
            )
            return LauncherRuntimeConfiguration(
                executableURL: URL(fileURLWithPath: executable),
                arguments: extraArguments + ["--data-root", dataRoot.path],
                dataRootURL: dataRoot,
                environment: childEnvironment
            )
        }
#endif

        guard let resources = bundle.resourceURL else {
            throw LauncherAgentError.runtimeUnavailable
        }
        let runtime = resources.appendingPathComponent("runtime", isDirectory: true)
        let node = runtime.appendingPathComponent("bin/node", isDirectory: false)
        let agent = runtime.appendingPathComponent(
            "launcher-agent.mjs",
            isDirectory: false
        )
        let manifest = runtime.appendingPathComponent(
            "manifest.json",
            isDirectory: false
        )
        guard
            fileManager.isExecutableFile(atPath: node.path),
            fileManager.isReadableFile(atPath: agent.path),
            fileManager.isReadableFile(atPath: manifest.path)
        else {
            throw LauncherAgentError.runtimeUnavailable
        }
        let provenanceEnvironment = try validatedRuntimeEnvironment(
            manifestData: Data(contentsOf: manifest)
        )
        for (key, value) in provenanceEnvironment {
            childEnvironment[key] = value
        }
        return LauncherRuntimeConfiguration(
            executableURL: node,
            arguments: [agent.path, "--data-root", dataRoot.path],
            dataRootURL: dataRoot,
            environment: childEnvironment
        )
    }

    static func sanitizedChildEnvironment(
        _ environment: [String: String]
    ) -> [String: String] {
        environment.filter { key, _ in
            key != "NODE_OPTIONS"
                && key != "NODE_PATH"
                && key != "LD_PRELOAD"
                && !key.hasPrefix("DYLD_")
                && key != "BLABASE_LAUNCHER_AGENT_EXECUTABLE"
                && key != "BLABASE_LAUNCHER_AGENT_ARGUMENTS_JSON"
                && key != "BLABASE_LAUNCHER_DATA_ROOT"
                && key != "BLABASE_DASHBOARD_URL"
                && key != "BLABASE_SHOW_ON_LAUNCH"
                && key != "BLABASE_LAUNCHER_SOURCE_MODE"
                && key != "BLABASE_CODE_COMMIT_SHA"
                && key != "BLABASE_CODE_FINGERPRINT_SHA256"
                && key != "CF_PAGES_COMMIT_SHA"
                && key != "VERCEL_GIT_COMMIT_SHA"
                && key != "GITHUB_SHA"
        }
    }

    static func validatedRuntimeEnvironment(
        manifestData: Data
    ) throws -> [String: String] {
        let manifest: LauncherRuntimeManifest
        do {
            manifest = try JSONDecoder().decode(
                LauncherRuntimeManifest.self,
                from: manifestData
            )
        } catch {
            throw LauncherAgentError.invalidRuntime("runtime manifest")
        }
        guard
            manifest.contract == "blabase-launcher-runtime-manifest-v1",
            isLowercaseHex(manifest.agentSha256, length: 64)
        else {
            throw LauncherAgentError.invalidRuntime("runtime manifest")
        }
        switch manifest.codeState {
        case "clean_commit", "declared_commit":
            guard
                let commit = manifest.codeCommitSha,
                isLowercaseHex(commit, length: 40),
                manifest.codeFingerprintSha256 == nil
            else {
                throw LauncherAgentError.invalidRuntime("code provenance")
            }
            return ["BLABASE_CODE_COMMIT_SHA": commit]
        case "dirty_worktree":
            guard
                manifest.codeCommitSha == nil,
                let fingerprint = manifest.codeFingerprintSha256,
                isLowercaseHex(fingerprint, length: 64)
            else {
                throw LauncherAgentError.invalidRuntime("code provenance")
            }
            return ["BLABASE_CODE_FINGERPRINT_SHA256": fingerprint]
        default:
            throw LauncherAgentError.invalidRuntime("code provenance")
        }
    }

    private static func resolveDataRoot(
        choice: LauncherDataRootChoice?,
        environment: [String: String],
        fileManager: FileManager
    ) throws -> ResolvedLauncherDataRoot {
        do {
            if let choice {
                switch choice {
                case .managedDefault:
                    return try LauncherDataRootPolicy.resolveManagedDefault(
                        fileManager: fileManager
                    )
                case .existingReadOnly(let path):
                    let root = try LauncherDataRootPolicy.validateExistingRoot(
                        path: path,
                        fileManager: fileManager
                    )
                    return ResolvedLauncherDataRoot(
                        url: root,
                        sourceMode: .readOnly
                    )
                }
            }
            if let override = environment["BLABASE_LAUNCHER_DATA_ROOT"] {
                return try LauncherDataRootPolicy.resolveLegacyOverride(
                    path: override,
                    fileManager: fileManager
                )
            }
            return try LauncherDataRootPolicy.resolveManagedDefault(
                fileManager: fileManager
            )
        } catch let error as LauncherAgentError {
            throw error
        } catch {
            throw LauncherAgentError.invalidRuntime(
                (error as? LocalizedError)?.errorDescription
                    ?? "invalid data root"
            )
        }
    }

    private static func decodeDevelopmentArguments(
        _ rawValue: String?
    ) throws -> [String] {
        guard let rawValue, !rawValue.isEmpty else { return [] }
        guard let data = rawValue.data(using: .utf8) else {
            throw LauncherAgentError.invalidRuntime("argument encoding")
        }
        do {
            let values = try JSONDecoder().decode([String].self, from: data)
            guard values.allSatisfy({ !$0.contains("\0") }) else {
                throw LauncherAgentError.invalidRuntime("argument contents")
            }
            return values
        } catch let error as LauncherAgentError {
            throw error
        } catch {
            throw LauncherAgentError.invalidRuntime("argument JSON")
        }
    }

    private static func isLowercaseHex(
        _ value: String,
        length: Int
    ) -> Bool {
        value.utf8.count == length && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }
}

private struct LauncherRuntimeManifest: Decodable {
    let contract: String
    let codeState: String
    let codeCommitSha: String?
    let codeFingerprintSha256: String?
    let agentSha256: String
}

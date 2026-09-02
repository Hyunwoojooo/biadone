import Darwin
import CryptoKit
import Foundation
import Testing
@testable import BlabeeCoordinator
@testable import CoordinatorSwift

private func doctorBundledPluginRoot() -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Plugin/blabee", isDirectory: true)
}

private final class DoctorFakeProcesses {
    var versionOutput = "codex-cli 0.148.0\n"
    var pluginInstalled: Any = true
    var pluginEnabled: Any = true
    var pluginVersion = "0.1.0"
    var pluginSourceKind = "local"
    var pluginPresent = true
    var duplicatePlugin = false
    var malformedPluginList = false
    var pluginPath = ""
    var invocations: [[String]] = []
    var hookTrustStatus = "trusted"
    var hookTrustIsManaged = false
    var hookTrustEnabled = true
    var hookTrustPluginID = "blabee@test"
    var hookTrustSource = "plugin"
    var hookTrustMissingEvent: String?
    var hookTrustDuplicateEvent: String?
    var hookTrustSourcePath: String?
    var hookTrustMalformed = false
    var hookTrustThrows = false
    var hookTrustCWD: String?
    var hookTrustErrors: [Any] = []
    var hookTrustWarnings: Any = [String]()
    var hookTrustCurrentHash: String?
    var hookTrustInvocations = 0

    func run(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) throws -> DoctorProcessResult {
        #expect(executable.path.hasPrefix("/"))
        #expect(timeoutMilliseconds == 5_000)
        invocations.append(arguments)
        if arguments == ["--version"] {
            return DoctorProcessResult(exitCode: 0, stdout: Data(versionOutput.utf8))
        }
        guard arguments == ["plugin", "list", "--json"] else {
            throw CoordinatorError("unexpected_test_process")
        }
        if malformedPluginList {
            return DoctorProcessResult(exitCode: 0, stdout: Data("[]".utf8))
        }
        let installed: [[String: Any]]
        if pluginPresent {
            installed = [[
                "pluginId": "blabee@test",
                "name": "blabee",
                "installed": pluginInstalled,
                "enabled": pluginEnabled,
                "version": pluginVersion,
                "source": ["source": pluginSourceKind, "path": pluginPath],
            ]]
        } else {
            installed = []
        }
        let records = duplicatePlugin ? installed + installed : installed
        let data = try JSONSerialization.data(
            withJSONObject: ["installed": records, "available": []],
            options: [.sortedKeys]
        )
        return DoctorProcessResult(exitCode: 0, stdout: data)
    }

    func inspectHooks(
        executable: URL,
        projectURL: URL,
        timeoutMilliseconds: Int
    ) throws -> Data {
        #expect(executable.path.hasPrefix("/"))
        #expect(timeoutMilliseconds == 5_000)
        hookTrustInvocations += 1
        if hookTrustThrows {
            throw CoordinatorError("doctor_hook_trust_timeout")
        }
        if hookTrustMalformed { return Data("[]".utf8) }

        let sourcePath = hookTrustSourcePath
            ?? URL(fileURLWithPath: pluginPath, isDirectory: true)
                .appendingPathComponent("hooks/hooks.json").path
        let events = ["permissionRequest", "sessionStart", "userPromptSubmit", "stop"]
        var hooks = events.compactMap { event -> [String: Any]? in
            guard event != hookTrustMissingEvent else { return nil }
            return [
                "currentHash": hookTrustCurrentHash ?? "trusted-hash-\(event)",
                "enabled": hookTrustEnabled,
                "eventName": event,
                "isManaged": hookTrustIsManaged,
                "pluginId": hookTrustPluginID,
                "source": hookTrustSource,
                "sourcePath": sourcePath,
                "trustStatus": hookTrustStatus,
            ]
        }
        if let duplicate = hookTrustDuplicateEvent,
           let hook = hooks.first(where: { $0["eventName"] as? String == duplicate })
        {
            hooks.append(hook)
        }
        return try StrictJSONTransport.data(forJSONObject: [
            "jsonrpc": "2.0",
            "id": 2,
            "result": [
                "data": [[
                    "cwd": hookTrustCWD ?? projectURL.standardizedFileURL.path,
                    "errors": hookTrustErrors,
                    "hooks": hooks,
                    "warnings": hookTrustWarnings,
                ]],
            ],
        ])
    }
}

private final class DoctorFixture {
    let root: URL
    let app: URL
    let embeddedCoordinator: URL
    let codexPackage: URL
    let codex: URL
    let codeModeHost: URL
    let ripgrep: URL
    let plugin: URL
    var runtimeIdentityManifest: URL {
        app.appendingPathComponent("Contents/Resources/assembly-manifest.json")
    }
    var runtimeCoordinatorPath: URL {
        plugin.appendingPathComponent("runtime/coordinator-path")
    }
    let processes = DoctorFakeProcesses()

    init() throws {
        root = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("bdt-\(UUID().uuidString.prefix(8))", isDirectory: true)
        app = root.appendingPathComponent("Blabee.app", isDirectory: true)
        embeddedCoordinator = app.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        codexPackage = root.appendingPathComponent("codex-package", isDirectory: true)
        codex = codexPackage.appendingPathComponent("bin/codex")
        codeModeHost = codexPackage.appendingPathComponent("bin/codex-code-mode-host")
        ripgrep = codexPackage.appendingPathComponent("codex-path/rg")
        plugin = root.appendingPathComponent("plugin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: embeddedCoordinator.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try writeAppPlist(executable: "blabee-coordinator")
        try makeExecutable(embeddedCoordinator)
        try writeCodexPackage(version: "0.148.0")
        try writePlugin()
        try writeRuntimeIdentity()
        processes.pluginPath = plugin.path
    }

    deinit {
        try? FileManager.default.removeItem(at: root)
    }

    func arguments(
        project: String = "/tmp/blabee-doctor-enabled",
        json: Bool = true,
        includePluginOverride: Bool = true,
        codexURL: URL? = nil,
        pluginOverrideURL: URL? = nil
    ) throws -> DoctorArguments {
        var values = [
            "--codex", (codexURL ?? codex).path,
            "--app", app.path,
            "--socket", root.appendingPathComponent("daemon.sock").path,
            "--project", project,
        ]
        if includePluginOverride {
            values.append(contentsOf: ["--plugin", (pluginOverrideURL ?? plugin).path])
        }
        if json { values.append("--json") }
        return try DoctorArguments(values, environment: [:], currentDirectoryPath: project)
    }

    func dependencies(
        daemonProjects: [[String: Any]]? = [["cwd": "/tmp/blabee-doctor-enabled", "enabled": true]],
        daemonReconciliation: [String: Any]? = nil,
        currentExecutableURL: URL? = nil,
        currentRuntimeIdentity: String? = nil,
        installedRuntimeIdentity: ((URL) -> String?)? = nil,
        path: String? = nil
    ) -> DoctorDependencies {
        let effectiveExecutableURL = currentExecutableURL ?? embeddedCoordinator
        let installedRuntimeIdentity = installedRuntimeIdentity ?? { executableURL in
            OperationalRuntimeIdentity.manifestIdentity(forExecutable: executableURL)
        }
        return DoctorDependencies(
            environment: [
                "PATH": path ?? "\(root.path):\(embeddedCoordinator.deletingLastPathComponent().path)",
            ],
            currentExecutableURL: effectiveExecutableURL,
            currentRuntimeIdentity: currentRuntimeIdentity
                ?? installedRuntimeIdentity(
                    effectiveExecutableURL.resolvingSymlinksInPath()
                )
                ?? OperationalRuntimeIdentity.resolve(
                    executableURL: effectiveExecutableURL, environment: [:]
                ),
            installedRuntimeIdentity: installedRuntimeIdentity,
            processRunner: processes.run,
            codexRuntimeInspector: { executableURL in
                DoctorDependencies.inspectCodexRuntime(
                    executableURL, executableVerification: .trustedTestFixture
                )
            },
            hookTrustRequester: processes.inspectHooks,
            daemonRequester: { _ in
                guard let daemonProjects else { throw CoordinatorError("daemon_unavailable") }
                var status: [String: Any] = [
                    "schema_version": daemonReconciliation == nil ? "1.0" : "1.1",
                    "kind": "blabee_doctor_status",
                    "projects": daemonProjects,
                ]
                if let daemonReconciliation {
                    status["reconciliation"] = daemonReconciliation
                }
                return try StrictJSONTransport.data(forJSONObject: status)
            }
        )
    }

    func writePlugin() throws {
        try FileManager.default.createDirectory(
            at: plugin.appendingPathComponent(".codex-plugin", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: plugin.appendingPathComponent("hooks", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: plugin.appendingPathComponent("scripts", isDirectory: true),
            withIntermediateDirectories: true
        )
        let decisionSkill = plugin.appendingPathComponent(
            "skills/blabee-decision", isDirectory: true
        )
        let agents = decisionSkill.appendingPathComponent("agents", isDirectory: true)
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let bundledPlugin = doctorBundledPluginRoot()
        try Data(contentsOf: bundledPlugin.appendingPathComponent("skills/blabee-decision/SKILL.md"))
            .write(to: decisionSkill.appendingPathComponent("SKILL.md"))
        try Data(contentsOf: bundledPlugin.appendingPathComponent(
            "skills/blabee-decision/agents/openai.yaml"
        )).write(to: agents.appendingPathComponent("openai.yaml"))
        try Data(contentsOf: bundledPlugin.appendingPathComponent(".codex-plugin/plugin.json"))
            .write(to: plugin.appendingPathComponent(".codex-plugin/plugin.json"))
        try writeMCP(includeEnvironment: true)
        try writeHooks()
        try makeExecutable(
            plugin.appendingPathComponent("scripts/blabee-launcher"),
            data: Data(contentsOf: bundledPlugin
                .appendingPathComponent("scripts/blabee-launcher"))
        )
        try writeRuntimeCoordinatorPath(embeddedCoordinator.path)
    }

    func writeRuntimeCoordinatorPath(_ path: String) throws {
        try FileManager.default.createDirectory(
            at: runtimeCoordinatorPath.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("\(path)\n".utf8).write(to: runtimeCoordinatorPath)
    }

    func writeRuntimeIdentity() throws {
        try FileManager.default.createDirectory(
            at: runtimeIdentityManifest.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try writeJSON([
            "schema_version": OperationalRuntimeIdentity.assemblyManifestSchemaVersion,
            "bundle_identifier": "com.biadone.blabee",
            "hash_phase": "assembled_payload_before_optional_code_signing",
            "compatible_previous_runtimes": [],
            "files": [
                [
                    "path": "Contents/MacOS/blabee-coordinator",
                    "sha256": String(repeating: "a", count: 64),
                    "size": 1,
                    "mode": "0700",
                ],
                [
                    "path": "Contents/Resources/Plugin/blabee/scripts/blabee-launcher",
                    "sha256": String(repeating: "b", count: 64),
                    "size": 1,
                    "mode": "0755",
                ],
            ],
        ], to: runtimeIdentityManifest)
    }

    func writeCodexPackage(version: String) throws {
        try FileManager.default.createDirectory(
            at: codex.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: ripgrep.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: codexPackage.appendingPathComponent("codex-resources", isDirectory: true),
            withIntermediateDirectories: true
        )
        #if arch(arm64)
            let cpuType: UInt32 = 0x0100_000C
        #else
            let cpuType: UInt32 = 0x0100_0007
        #endif
        let machOFixture = Data([
            0xcf, 0xfa, 0xed, 0xfe,
            UInt8(cpuType & 0xff), UInt8((cpuType >> 8) & 0xff),
            UInt8((cpuType >> 16) & 0xff), UInt8((cpuType >> 24) & 0xff),
        ])
        if !FileManager.default.fileExists(atPath: codex.path) {
            try makeExecutable(codex, data: machOFixture)
        }
        if !FileManager.default.fileExists(atPath: codeModeHost.path) {
            try makeExecutable(codeModeHost, data: machOFixture)
        }
        if !FileManager.default.fileExists(atPath: ripgrep.path) {
            try makeExecutable(ripgrep, data: machOFixture)
        }
        try writeJSON([
            "layoutVersion": 1,
            "version": version,
            "target": ManagedCodexRuntimeBundleInspector.expectedTarget,
            "variant": "codex",
            "entrypoint": "bin/codex",
            "resourcesDir": "codex-resources",
            "pathDir": "codex-path",
        ], to: codexPackage.appendingPathComponent("codex-package.json"))
    }

    func writeMCP(includeEnvironment: Bool) throws {
        var server: [String: Any] = [
            "command": "./scripts/blabee-launcher",
            "args": ["mcp"],
            "cwd": ".",
        ]
        if includeEnvironment { server["env_vars"] = ["BLABEE_SOCKET"] }
        try writeJSON([
            "mcpServers": ["blabee": server],
        ], to: plugin.appendingPathComponent(".mcp.json"))
    }

    func writeHooks(
        userPromptCommand: String? = nil,
        stopTimeout: Int = 8
    ) throws {
        let userPromptCommand = userPromptCommand
            ?? DoctorApplication.expectedHookCommand(event: "UserPromptSubmit")
        try writeJSON([
            "description": "Blabee test hooks",
            "hooks": [
                "SessionStart": [[
                    "matcher": "startup|resume|clear|compact",
                    "hooks": [[
                        "type": "command",
                        "command": DoctorApplication.expectedHookCommand(event: "SessionStart"),
                        "timeout": 8,
                        "statusMessage": "Blabee 프로젝트 연결 확인 중",
                        "additionalContextLimit": 600,
                    ]],
                ]],
                "UserPromptSubmit": [[
                    "hooks": [[
                        "type": "command",
                        "command": userPromptCommand,
                        "timeout": 8,
                        "statusMessage": "Blabee 작업 경계 연결 중",
                        "additionalContextLimit": 65_536,
                    ]],
                ]],
                "Stop": [[
                    "hooks": [[
                        "type": "command",
                        "command": DoctorApplication.expectedHookCommand(event: "Stop"),
                        "timeout": stopTimeout,
                        "statusMessage": "Blabee 결정 저장 중",
                    ]],
                ]],
                "PermissionRequest": [[
                    "hooks": [[
                        "type": "command",
                        "command": DoctorApplication.expectedHookCommand(event: "PermissionRequest"),
                        "timeout": 60,
                        "statusMessage": "Blabee에서 권한 요청 확인 중",
                    ]],
                ]],
            ],
        ], to: plugin.appendingPathComponent("hooks/hooks.json"))
    }

    func writeAppPlist(executable: String?) throws {
        var object: [String: Any] = ["CFBundlePackageType": "APPL"]
        if let executable { object["CFBundleExecutable"] = executable }
        let plist = try PropertyListSerialization.data(
            fromPropertyList: object,
            format: .xml,
            options: 0
        )
        try plist.write(to: app.appendingPathComponent("Contents/Info.plist"))
    }

    private func makeExecutable(_ url: URL, data: Data = Data("fixture\n".utf8)) throws {
        try data.write(to: url)
        guard chmod(url.path, mode_t(0o700)) == 0 else {
            throw CoordinatorError("test_chmod_failed")
        }
    }

    func writeJSON(_ object: Any, to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try data.write(to: url)
    }
}

private func doctorCheck(_ execution: DoctorExecution, id: String) throws -> DoctorCheck {
    try #require(execution.report.checks.first(where: { $0.id == id }))
}

private func doctorFixtureTree(_ root: URL) throws -> [String] {
    let enumerator = try #require(FileManager.default.enumerator(
        at: root,
        includingPropertiesForKeys: nil
    ))
    var result: [String] = []
    while let url = enumerator.nextObject() as? URL {
        let relative = String(url.path.dropFirst(root.path.count + 1))
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            throw CoordinatorError("test_snapshot_failed")
        }
        let fileType = info.st_mode & S_IFMT
        let kind = fileType == S_IFDIR ? "d"
            : fileType == S_IFREG ? "f"
            : fileType == S_IFLNK ? "l" : "o"
        let digest: String
        if fileType == S_IFREG {
            digest = SHA256.hash(data: try Data(contentsOf: url))
                .map { String(format: "%02x", $0) }.joined()
        } else {
            digest = "-"
        }
        result.append([
            relative, kind, String(info.st_mode), String(info.st_uid),
            String(info.st_gid), String(info.st_nlink), String(info.st_dev),
            String(info.st_ino), String(info.st_size),
            String(info.st_mtimespec.tv_sec),
            String(info.st_mtimespec.tv_nsec),
            String(info.st_ctimespec.tv_sec),
            String(info.st_ctimespec.tv_nsec), digest,
        ].joined(separator: "|"))
    }
    return result.sorted()
}

private func expectDoctorArgumentFailure(_ values: [String]) {
    do {
        _ = try DoctorArguments(
            values,
            environment: ["BLABEE_SOCKET": "/tmp/blabee-doctor.sock"],
            currentDirectoryPath: "/tmp/project"
        )
        Issue.record("expected invalid_arguments for \(values)")
    } catch let error as CoordinatorError {
        #expect(error.code == "invalid_arguments")
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

// The production inspector intentionally fails closed if any named ancestor
// changes during inspection. These tests create and delete `/tmp` fixtures,
// so the suite is serialized to keep unrelated fixture churn from simulating
// an ancestor-path ABA attack.
@Suite(.serialized)
struct DoctorApplicationTestSuite {

@Test("Doctor arguments accept only unique absolute allowlisted flags")
func doctorArgumentsFailClosed() throws {
    let arguments = try DoctorArguments([
        "--json",
        "--codex", "/tmp/codex",
        "--app", "/tmp/Blabee.app",
        "--plugin", "/tmp/plugin",
        "--socket", "/tmp/blabee.sock",
        "--project", "/tmp/project",
    ], environment: [:], currentDirectoryPath: "/tmp/default")
    #expect(arguments.json)
    #expect(arguments.codexURL?.path == "/tmp/codex")
    #expect(arguments.projectURL.path == "/tmp/project")

    for invalid in [
        ["--codex", "relative/codex"],
        ["--codex", "/tmp/one", "--codex", "/tmp/two"],
        ["--app"],
        ["--unknown", "/tmp/value"],
        ["positional"],
        ["--json", "--json"],
        ["--socket", "relative.sock"],
    ] {
        expectDoctorArgumentFailure(invalid)
    }
}

@Test("Doctor keeps the alpha baseline pending and rejects every unapproved Codex version")
func doctorCodexVersionPolicy() throws {
    let fixture = try DoctorFixture()
    #expect(DoctorApplication.supportedVersions == ["0.149.1", "0.150.1", "0.151.0"])
    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").status == .actionRequired)
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_alpha_qualification_required")
    #expect(try doctorCheck(execution, id: "codex_runtime_version").status == .actionRequired)

    for supportedVersion in ["0.149.1", "0.150.1", "0.151.0"] {
        try fixture.writeCodexPackage(version: supportedVersion)
        execution = DoctorApplication(dependencies: fixture.dependencies())
            .run(arguments: try fixture.arguments())
        #expect(
            try doctorCheck(execution, id: "codex_version").status == .pass,
            "version=\(supportedVersion)"
        )
        #expect(try doctorCheck(execution, id: "codex_version").code
            == "codex_version_supported", "version=\(supportedVersion)")
        #expect(try doctorCheck(execution, id: "codex_runtime_version").status
            == .actionRequired, "version=\(supportedVersion)")
        #expect(try doctorCheck(execution, id: "codex_runtime_version").code
            == "codex_runtime_live_version_required", "version=\(supportedVersion)")
    }

    try fixture.writeCodexPackage(version: "0.149.0")
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_version_not_allowlisted")
    #expect(execution.exitCode == 1)

    let missingCodex = fixture.root.appendingPathComponent("missing-codex")
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments(codexURL: missingCodex))
    #expect(try doctorCheck(execution, id: "codex_executable").code == "codex_executable_missing")
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_version_unavailable")
}

@Test("Doctor separates semantic version support from exact bundle qualification")
func doctorSeparatesVersionSupportFromBundleQualification() throws {
    let fixture = try DoctorFixture()
    var dependencies = fixture.dependencies()

    dependencies.codexRuntimeInspector = { _ in
        .validated(DoctorCodexRuntimeBundleSummary(
            manifestVersion: "0.150.1",
            target: "aarch64-apple-darwin",
            buildQualification: .required
        ))
    }
    var execution = DoctorApplication(dependencies: dependencies)
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_runtime_layout").status == .pass)
    #expect(try doctorCheck(execution, id: "codex_version").code
        == "codex_version_supported")
    #expect(try doctorCheck(execution, id: "codex_runtime_identity").code
        == "codex_runtime_build_qualification_required")
    #expect(try doctorCheck(execution, id: "codex_runtime_version").code
        == "codex_runtime_build_qualification_required")
    #expect(try doctorCheck(execution, id: "codex_code_mode_compatibility").status
        == .actionRequired)

    dependencies.codexRuntimeInspector = { _ in
        .validated(DoctorCodexRuntimeBundleSummary(
            manifestVersion: "0.151.0",
            target: "aarch64-apple-darwin",
            buildQualification: .fingerprintMismatch
        ))
    }
    execution = DoctorApplication(dependencies: dependencies)
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_runtime_identity").code
        == "codex_runtime_build_fingerprint_mismatch")
    #expect(try doctorCheck(execution, id: "codex_runtime_version").code
        == "codex_runtime_build_fingerprint_mismatch")
    #expect(try doctorCheck(execution, id: "codex_code_mode_compatibility").status
        == .fail)

    dependencies.codexRuntimeInspector = { _ in
        .validated(DoctorCodexRuntimeBundleSummary(
            manifestVersion: "0.152.0",
            target: "aarch64-apple-darwin",
            buildQualification: .required
        ))
    }
    execution = DoctorApplication(dependencies: dependencies)
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").code
        == "codex_version_not_allowlisted")
    #expect(try doctorCheck(execution, id: "codex_runtime_version").code
        == "codex_runtime_version_not_allowlisted")
    #expect(try doctorCheck(execution, id: "codex_code_mode_compatibility").status
        == .fail)
}

@Test("Doctor fails closed for missing host malformed manifest unsafe identity and version mismatch")
func doctorCodexRuntimeBundleFailsClosed() throws {
    let missingHost = try DoctorFixture()
    try FileManager.default.removeItem(at: missingHost.codeModeHost)
    var execution = DoctorApplication(dependencies: missingHost.dependencies())
        .run(arguments: try missingHost.arguments())
    #expect(try doctorCheck(execution, id: "codex_runtime_layout").code
        == "codex_runtime_layout_invalid")
    #expect(try doctorCheck(execution, id: "codex_runtime_identity").code
        == "codex_runtime_identity_unverified")
    #expect(try doctorCheck(execution, id: "codex_code_mode_compatibility").status == .fail)

    let malformedManifest = try DoctorFixture()
    try Data("{".utf8).write(
        to: malformedManifest.codexPackage.appendingPathComponent("codex-package.json")
    )
    execution = DoctorApplication(dependencies: malformedManifest.dependencies())
        .run(arguments: try malformedManifest.arguments())
    #expect(try doctorCheck(execution, id: "codex_runtime_layout").code
        == "codex_runtime_layout_invalid")

    let unsafeIdentity = try DoctorFixture()
    guard chmod(unsafeIdentity.codeModeHost.path, mode_t(0o722)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    execution = DoctorApplication(dependencies: unsafeIdentity.dependencies())
        .run(arguments: try unsafeIdentity.arguments())
    #expect(try doctorCheck(execution, id: "codex_runtime_identity").code
        == "codex_runtime_identity_invalid")

    let mismatchedVersion = try DoctorFixture()
    var mismatchedDependencies = mismatchedVersion.dependencies()
    mismatchedDependencies.codexRuntimeInspector = { _ in .versionMismatch }
    execution = DoctorApplication(dependencies: mismatchedDependencies)
        .run(arguments: try mismatchedVersion.arguments())
    #expect(try doctorCheck(execution, id: "codex_runtime_version").code
        == "codex_runtime_version_mismatch")
    #expect(try doctorCheck(execution, id: "codex_code_mode_compatibility").status
        == .fail)
}

@Test("Doctor runtime inspection is read only and creates no persistent artifact")
func doctorCodexRuntimeInspectionIsReadOnly() throws {
    let fixture = try DoctorFixture()
    let before = try doctorFixtureTree(fixture.root)

    _ = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())

    #expect(try doctorFixtureTree(fixture.root) == before)
}

@Test("Static Doctor requires explicit plugin source and never claims live installation")
func doctorPluginStateRequiresLiveQualification() throws {
    let fixture = try DoctorFixture()

    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments(includePluginOverride: false))
    #expect(try doctorCheck(execution, id: "plugin_installation").code
        == "plugin_source_discovery_required")
    #expect(try doctorCheck(execution, id: "plugin_layout").code
        == "plugin_layout_source_required")

    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code
        == "plugin_installation_live_verification_required")
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_ok")
}

@Test("Doctor validates plugin layout without following a manifest symlink")
func doctorPluginLayoutFailsClosed() throws {
    let fixture = try DoctorFixture()
    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_ok")

    let manifest = fixture.plugin.appendingPathComponent(".codex-plugin/plugin.json")
    let target = fixture.root.appendingPathComponent("external-manifest.json")
    try FileManager.default.moveItem(at: manifest, to: target)
    try FileManager.default.createSymbolicLink(at: manifest, withDestinationURL: target)
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let ancestorFixture = try DoctorFixture()
    let hooksDirectory = ancestorFixture.plugin.appendingPathComponent("hooks", isDirectory: true)
    let externalHooks = ancestorFixture.root.appendingPathComponent("external-hooks", isDirectory: true)
    try FileManager.default.moveItem(at: hooksDirectory, to: externalHooks)
    try FileManager.default.createSymbolicLink(at: hooksDirectory, withDestinationURL: externalHooks)
    execution = DoctorApplication(dependencies: ancestorFixture.dependencies())
        .run(arguments: try ancestorFixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")
}

@Test("Static Doctor validates an explicit override without claiming installed source identity")
func doctorPluginOverrideIsOnlyAStaticSource() throws {
    let installed = try DoctorFixture()
    let override = try DoctorFixture()
    let execution = DoctorApplication(dependencies: installed.dependencies())
        .run(arguments: try installed.arguments(pluginOverrideURL: override.plugin))
    #expect(try doctorCheck(execution, id: "plugin_installation").code
        == "plugin_installation_live_verification_required")
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_ok")
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_identity_mismatch")
}

@Test("Doctor rejects launcher Hook and MCP contract drift")
func doctorPluginExactContractRejectsDrift() throws {
    let missingLauncher = try DoctorFixture()
    try FileManager.default.removeItem(
        at: missingLauncher.plugin.appendingPathComponent("scripts/blabee-launcher")
    )
    var execution = DoctorApplication(dependencies: missingLauncher.dependencies())
        .run(arguments: try missingLauncher.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let legacyCommand = try DoctorFixture()
    try legacyCommand.writeHooks(
        userPromptCommand: "\"$PLUGIN_ROOT/scripts/blabee-launcher\" hook UserPromptSubmit"
    )
    execution = DoctorApplication(dependencies: legacyCommand.dependencies())
        .run(arguments: try legacyCommand.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let changedCommand = try DoctorFixture()
    let weakenedGuard = DoctorApplication.expectedHookCommand(event: "UserPromptSubmit")
        .replacingOccurrences(of: " && [ ! -L \"$PLUGIN_ROOT/scripts/blabee-launcher\" ]", with: "")
    try changedCommand.writeHooks(userPromptCommand: weakenedGuard)
    execution = DoctorApplication(dependencies: changedCommand.dependencies())
        .run(arguments: try changedCommand.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let changedScriptsGuard = try DoctorFixture()
    let weakenedScriptsGuard = DoctorApplication.expectedHookCommand(event: "UserPromptSubmit")
        .replacingOccurrences(of: " && [ ! -L \"$PLUGIN_ROOT/scripts\" ]", with: "")
    try changedScriptsGuard.writeHooks(userPromptCommand: weakenedScriptsGuard)
    execution = DoctorApplication(dependencies: changedScriptsGuard.dependencies())
        .run(arguments: try changedScriptsGuard.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let changedTimeout = try DoctorFixture()
    try changedTimeout.writeHooks(stopTimeout: 7)
    execution = DoctorApplication(dependencies: changedTimeout.dependencies())
        .run(arguments: try changedTimeout.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let missingEnvironment = try DoctorFixture()
    try missingEnvironment.writeMCP(includeEnvironment: false)
    execution = DoctorApplication(dependencies: missingEnvironment.dependencies())
        .run(arguments: try missingEnvironment.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let changedLauncher = try DoctorFixture()
    let launcher = changedLauncher.plugin.appendingPathComponent("scripts/blabee-launcher")
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: launcher)
    guard chmod(launcher.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    execution = DoctorApplication(dependencies: changedLauncher.dependencies())
        .run(arguments: try changedLauncher.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")
}

@Test("Doctor Hook contract matches the bundled version 0.1.0 Plugin")
func doctorHookContractMatchesBundledPlugin() throws {
    let data = try Data(contentsOf: doctorBundledPluginRoot()
        .appendingPathComponent("hooks/hooks.json"))
    let document = try #require(
        JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    let hooks = try #require(document["hooks"] as? [String: Any])
    for event in ["SessionStart", "UserPromptSubmit", "Stop", "PermissionRequest"] {
        let registrations = try #require(hooks[event] as? [[String: Any]])
        let commands = try #require(registrations.first?["hooks"] as? [[String: Any]])
        let command = try #require(commands.first?["command"] as? String)
        #expect(command == DoctorApplication.expectedHookCommand(event: event))
    }
}

@Test("Doctor launcher digest matches the bundled version 0.1.0 contract")
func doctorLauncherDigestMatchesBundledContract() throws {
    let launcher = doctorBundledPluginRoot().appendingPathComponent("scripts/blabee-launcher")
    let digest = SHA256.hash(data: try Data(contentsOf: launcher))
        .map { String(format: "%02x", $0) }
        .joined()
    #expect(digest == DoctorApplication.launcherSHA256)
}

@Test("Doctor manifest digest matches the bundled version 0.1.0 bytes")
func doctorManifestDigestMatchesBundledContract() throws {
    let manifest = doctorBundledPluginRoot().appendingPathComponent(".codex-plugin/plugin.json")
    let data = try Data(contentsOf: manifest)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    #expect(digest == DoctorApplication.pluginManifestSHA256)
}

@Test("Doctor rejects a structurally valid default prompt drift")
func doctorManifestDefaultPromptDriftFailsClosed() throws {
    let fixture = try DoctorFixture()
    let manifestURL = fixture.plugin.appendingPathComponent(".codex-plugin/plugin.json")
    let data = try Data(contentsOf: manifestURL)
    var manifest = try #require(
        JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    var interface = try #require(manifest["interface"] as? [String: Any])
    interface["defaultPrompt"] = ["A structurally valid but unbundled prompt"]
    manifest["interface"] = interface
    try fixture.writeJSON(manifest, to: manifestURL)

    let execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")
}

@Test("Doctor Plugin skill payload requires exact files and non-symlink ancestors")
func doctorPluginSkillPayloadFailsClosed() throws {
    let missingSkill = try DoctorFixture()
    try FileManager.default.removeItem(
        at: missingSkill.plugin.appendingPathComponent("skills/blabee-decision/SKILL.md")
    )
    var execution = DoctorApplication(dependencies: missingSkill.dependencies())
        .run(arguments: try missingSkill.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let symlinkedAgents = try DoctorFixture()
    let agents = symlinkedAgents.plugin.appendingPathComponent(
        "skills/blabee-decision/agents", isDirectory: true
    )
    let externalAgents = symlinkedAgents.root.appendingPathComponent(
        "external-agents", isDirectory: true
    )
    try FileManager.default.moveItem(at: agents, to: externalAgents)
    try FileManager.default.createSymbolicLink(at: agents, withDestinationURL: externalAgents)
    execution = DoctorApplication(dependencies: symlinkedAgents.dependencies())
        .run(arguments: try symlinkedAgents.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let driftedAgent = try DoctorFixture()
    try Data("model: drifted\n".utf8).write(to: driftedAgent.plugin.appendingPathComponent(
        "skills/blabee-decision/agents/openai.yaml"
    ))
    execution = DoctorApplication(dependencies: driftedAgent.dependencies())
        .run(arguments: try driftedAgent.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let extraSkill = try DoctorFixture()
    let evil = extraSkill.plugin.appendingPathComponent("skills/evil", isDirectory: true)
    try FileManager.default.createDirectory(at: evil, withIntermediateDirectories: false)
    try Data("evil\n".utf8).write(to: evil.appendingPathComponent("SKILL.md"))
    execution = DoctorApplication(dependencies: extraSkill.dependencies())
        .run(arguments: try extraSkill.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")
}

@Test("Doctor skill digests match the bundled version 0.1.0 files")
func doctorSkillDigestsMatchBundledContract() throws {
    let bundledPlugin = doctorBundledPluginRoot()
    let cases = [
        ("skills/blabee-decision/SKILL.md", DoctorApplication.skillSHA256),
        ("skills/blabee-decision/agents/openai.yaml", DoctorApplication.skillAgentSHA256),
    ]
    for (relativePath, expected) in cases {
        let data = try Data(contentsOf: bundledPlugin.appendingPathComponent(relativePath))
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #expect(digest == expected)
    }
}

@Test("Doctor app bundle requires the exact embedded executable name")
func doctorAppBundleExecutableContract() throws {
    let missing = try DoctorFixture()
    try missing.writeAppPlist(executable: nil)
    var execution = DoctorApplication(dependencies: missing.dependencies())
        .run(arguments: try missing.arguments())
    #expect(try doctorCheck(execution, id: "app_bundle").code == "app_bundle_invalid")

    let mismatched = try DoctorFixture()
    try mismatched.writeAppPlist(executable: "Blabee")
    execution = DoctorApplication(dependencies: mismatched.dependencies())
        .run(arguments: try mismatched.arguments())
    #expect(try doctorCheck(execution, id: "app_bundle").code == "app_bundle_invalid")
}

@Test("Doctor MCP runtime validates the plugin locator without requiring a PATH shim")
func doctorMCPRuntimeIdentity() throws {
    let fixture = try DoctorFixture()
    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code == "mcp_runtime_ok")
    #expect(try doctorCheck(execution, id: "blabee_build_identity").code
        == "blabee_build_identity_ok")

    execution = DoctorApplication(dependencies: fixture.dependencies(
        path: fixture.root.appendingPathComponent("missing-path").path
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code == "mcp_runtime_ok")

    let missing = try DoctorFixture()
    try FileManager.default.removeItem(at: missing.runtimeCoordinatorPath)
    execution = DoctorApplication(dependencies: missing.dependencies())
        .run(arguments: try missing.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_locator_missing")
    #expect(try doctorCheck(execution, id: "blabee_build_identity").code
        == "blabee_build_identity_plugin_locator_required")

    let mismatchedFixture = try DoctorFixture()
    let mismatched = mismatchedFixture.root.appendingPathComponent("blabee-coordinator")
    try Data("mismatched\n".utf8).write(to: mismatched)
    guard chmod(mismatched.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    try mismatchedFixture.writeRuntimeCoordinatorPath(mismatched.path)
    execution = DoctorApplication(dependencies: mismatchedFixture.dependencies())
        .run(arguments: try mismatchedFixture.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_identity_mismatch")

    let malformed = try DoctorFixture()
    try Data("\(malformed.embeddedCoordinator.path)\n/second/path\n".utf8)
        .write(to: malformed.runtimeCoordinatorPath)
    execution = DoctorApplication(dependencies: malformed.dependencies())
        .run(arguments: try malformed.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_locator_invalid")

    let linked = try DoctorFixture()
    let locatorTarget = linked.root.appendingPathComponent("linked-coordinator-path")
    try Data("\(linked.embeddedCoordinator.path)\n".utf8).write(to: locatorTarget)
    try FileManager.default.removeItem(at: linked.runtimeCoordinatorPath)
    try FileManager.default.createSymbolicLink(
        at: linked.runtimeCoordinatorPath,
        withDestinationURL: locatorTarget
    )
    execution = DoctorApplication(dependencies: linked.dependencies())
        .run(arguments: try linked.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_locator_invalid")

    let missingIdentity = try DoctorFixture()
    try FileManager.default.removeItem(at: missingIdentity.runtimeIdentityManifest)
    execution = DoctorApplication(dependencies: missingIdentity.dependencies())
        .run(arguments: try missingIdentity.arguments())
    #expect(try doctorCheck(execution, id: "coordinator_runtime").code
        == "coordinator_runtime_identity_unverified")
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_identity_manifest_invalid")

    let booleanSize = try DoctorFixture()
    var booleanManifest = try #require(
        try JSONSerialization.jsonObject(
            with: Data(contentsOf: booleanSize.runtimeIdentityManifest)
        ) as? [String: Any]
    )
    var booleanFiles = try #require(booleanManifest["files"] as? [[String: Any]])
    booleanFiles[0]["size"] = true
    booleanManifest["files"] = booleanFiles
    try booleanSize.writeJSON(booleanManifest, to: booleanSize.runtimeIdentityManifest)
    execution = DoctorApplication(dependencies: booleanSize.dependencies())
        .run(arguments: try booleanSize.arguments())
    #expect(try doctorCheck(execution, id: "coordinator_runtime").code
        == "coordinator_runtime_identity_unverified")

    let unsorted = try DoctorFixture()
    var unsortedManifest = try #require(
        try JSONSerialization.jsonObject(
            with: Data(contentsOf: unsorted.runtimeIdentityManifest)
        ) as? [String: Any]
    )
    unsortedManifest["files"] = Array(try #require(
        unsortedManifest["files"] as? [[String: Any]]
    ).reversed())
    try unsorted.writeJSON(unsortedManifest, to: unsorted.runtimeIdentityManifest)
    execution = DoctorApplication(dependencies: unsorted.dependencies())
        .run(arguments: try unsorted.arguments())
    #expect(try doctorCheck(execution, id: "coordinator_runtime").code
        == "coordinator_runtime_identity_unverified")
}

@Test("Doctor does not claim Plugin build identity without an explicit locator")
func doctorBuildIdentityRequiresExplicitPluginLocator() throws {
    let fixture = try DoctorFixture()
    let execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments(includePluginOverride: false))

    let identity = try doctorCheck(execution, id: "blabee_build_identity")
    #expect(identity.status == .actionRequired)
    #expect(identity.code == "blabee_build_identity_plugin_locator_required")
}

@Test("Doctor distinguishes exact descendant other and unavailable daemon project scopes")
func doctorProjectScopeAndDaemonStatus() throws {
    let fixture = try DoctorFixture()
    for project in ["/tmp/blabee-doctor-enabled", "/tmp/blabee-doctor-enabled/child"] {
        let execution = DoctorApplication(dependencies: fixture.dependencies())
            .run(arguments: try fixture.arguments(project: project))
        #expect(try doctorCheck(execution, id: "daemon_status").status == .pass)
        #expect(try doctorCheck(execution, id: "project_scope").status == .pass)
    }

    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments(project: "/tmp/other-project"))
    #expect(try doctorCheck(execution, id: "project_scope").code == "project_not_enabled")

    execution = DoctorApplication(dependencies: fixture.dependencies(daemonProjects: nil))
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "daemon_status").code == "daemon_unavailable")
    #expect(try doctorCheck(execution, id: "project_scope").code == "project_scope_unavailable")

    execution = DoctorApplication(dependencies: fixture.dependencies(daemonProjects: [[
        "cwd": "/tmp/blabee-doctor-enabled",
        "enabled": true,
        "project_id": "must_not_be_accepted",
    ]])).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "daemon_status").code == "daemon_status_malformed")

    execution = DoctorApplication(dependencies: fixture.dependencies(daemonProjects: [[
        "cwd": "/tmp/blabee-doctor-enabled",
        "enabled": 1,
    ]])).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "daemon_status").code == "daemon_status_malformed")
}

@Test("Doctor accepts legacy status and classifies bounded reconciliation states")
func doctorReconciliationStatus() throws {
    let fixture = try DoctorFixture()

    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "reconciliation_status").status == .actionRequired)
    #expect(try doctorCheck(execution, id: "reconciliation_status").code
        == "reconciliation_status_legacy")

    execution = DoctorApplication(dependencies: fixture.dependencies(
        daemonReconciliation: [
            "state": "healthy",
            "consecutive_failure_count": 0,
            "quarantined_initial_activation_count": 0,
            "last_error_code": NSNull(),
            "milliseconds_until_retry": NSNull(),
        ]
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "reconciliation_status").status == .pass)
    #expect(try doctorCheck(execution, id: "reconciliation_status").code
        == "reconciliation_healthy")

    execution = DoctorApplication(dependencies: fixture.dependencies(
        daemonReconciliation: [
            "state": "retrying",
            "consecutive_failure_count": 2,
            "quarantined_initial_activation_count": 0,
            "last_error_code": "freshness_anchor_unavailable",
            "milliseconds_until_retry": 500,
        ]
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "reconciliation_status").status == .actionRequired)
    #expect(try doctorCheck(execution, id: "reconciliation_status").code
        == "reconciliation_retrying")

    execution = DoctorApplication(dependencies: fixture.dependencies(
        daemonReconciliation: [
            "state": "quarantined",
            "consecutive_failure_count": 5,
            "quarantined_initial_activation_count": 1,
            "last_error_code": "database_integrity_failed",
            "milliseconds_until_retry": NSNull(),
        ]
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "reconciliation_status").status == .fail)
    #expect(try doctorCheck(execution, id: "reconciliation_status").code
        == "reconciliation_quarantined")
    let output = try #require(String(data: execution.outputData(), encoding: .utf8))
    #expect(!output.contains("database_integrity_failed"))

    execution = DoctorApplication(dependencies: fixture.dependencies(
        daemonReconciliation: [
            "state": "healthy",
            "consecutive_failure_count": true,
            "quarantined_initial_activation_count": 0,
            "last_error_code": NSNull(),
            "milliseconds_until_retry": NSNull(),
        ]
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "daemon_status").code == "daemon_unavailable")
    #expect(try doctorCheck(execution, id: "reconciliation_status").code
        == "reconciliation_status_unavailable")
}

@Test("Doctor JSON is deterministic redacted and leaves live checks pending")
func doctorJSONIsDeterministicAndRedacted() throws {
    let fixture = try DoctorFixture()
    let execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    let first = try execution.outputData()
    let repeatedExecution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    let second = try repeatedExecution.outputData()
    #expect(first == second)
    let text = try #require(String(data: first, encoding: .utf8))
    #expect(text.contains("\"kind\":\"blabee_doctor_report\""))
    #expect(text.contains("\"overall_status\":\"action_required\""))
    #expect(!text.contains(fixture.root.path))
    #expect(!text.contains("project_id"))
    let checkIDs = Set(execution.report.checks.map(\.id))
    #expect(checkIDs.isSuperset(of: [
        "codex_runtime_layout",
        "codex_runtime_identity",
        "codex_runtime_version",
        "codex_code_mode_compatibility",
        "blabee_build_identity",
    ]))
    #expect(try doctorCheck(execution, id: "hook_trust").status == .actionRequired)
    #expect(try doctorCheck(execution, id: "hook_trust").code
        == "hook_trust_live_verification_required")
    #expect(fixture.processes.invocations.isEmpty)
    #expect(fixture.processes.hookTrustInvocations == 0)
    #expect(execution.exitCode == 2)

    let mismatched = DoctorApplication(dependencies: fixture.dependencies(
        currentExecutableURL: fixture.codex
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(mismatched, id: "coordinator_runtime").code
        == "coordinator_runtime_identity_unverified")

    let currentSymlink = fixture.root.appendingPathComponent("current-coordinator-link")
    try FileManager.default.createSymbolicLink(
        at: currentSymlink,
        withDestinationURL: fixture.embeddedCoordinator
    )
    let symlinked = DoctorApplication(dependencies: fixture.dependencies(
        currentExecutableURL: currentSymlink
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(symlinked, id: "coordinator_runtime").code
        == "coordinator_runtime_ok")
}

@Test("Doctor keeps code-mode action required after every static check passes")
func doctorRequiresLiveCodeModeSmokeAfterStaticChecksPass() throws {
    let fixture = try DoctorFixture()
    try fixture.writeCodexPackage(version: "0.151.0")
    let execution = DoctorApplication(dependencies: fixture.dependencies(
        daemonReconciliation: [
            "state": "healthy",
            "consecutive_failure_count": 0,
            "quarantined_initial_activation_count": 0,
            "last_error_code": NSNull(),
            "milliseconds_until_retry": NSNull(),
        ]
    )).run(arguments: try fixture.arguments())

    #expect(execution.report.overallStatus == .actionRequired)
    #expect(execution.exitCode == 2)
    #expect(try doctorCheck(execution, id: "hook_trust").code
        == "hook_trust_live_verification_required")
    #expect(try doctorCheck(execution, id: "codex_runtime_version").code
        == "codex_runtime_live_version_required")
    #expect(try doctorCheck(execution, id: "codex_code_mode_compatibility").code
        == "codex_code_mode_live_qualification_required")
    #expect(try doctorCheck(execution, id: "plugin_installation").status
        == .actionRequired)
    #expect(fixture.processes.invocations.isEmpty)
    #expect(fixture.processes.hookTrustInvocations == 0)
}

@Test("Static Doctor never spawns Codex or requests live Hook state")
func doctorStaticRunDoesNotSpawnCodexOrInspectLiveHooks() throws {
    let fixture = try DoctorFixture()
    let execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").code
        == "codex_alpha_qualification_required")
    #expect(try doctorCheck(execution, id: "plugin_installation").code
        == "plugin_installation_live_verification_required")
    #expect(try doctorCheck(execution, id: "hook_trust").code
        == "hook_trust_live_verification_required")
    #expect(fixture.processes.invocations.isEmpty)
    #expect(fixture.processes.hookTrustInvocations == 0)
}

@Test("Doctor compares the process-captured identity after the app is replaced")
func doctorRejectsAReplacedBundleForAnOlderRunningProcess() throws {
    let fixture = try DoctorFixture()
    let oldIdentity = try #require(
        OperationalRuntimeIdentity.manifestIdentity(
            forExecutable: fixture.embeddedCoordinator
        )
    )
    let dependencies = fixture.dependencies(currentRuntimeIdentity: oldIdentity)

    try fixture.writeRuntimeIdentity()
    var object = try #require(
        try JSONSerialization.jsonObject(
            with: Data(contentsOf: fixture.runtimeIdentityManifest)
        ) as? [String: Any]
    )
    object["hash_phase"] = "assembled_payload_before_optional_code_signing"
    var files = try #require(object["files"] as? [[String: Any]])
    files[0]["sha256"] = String(repeating: "c", count: 64)
    object["files"] = files
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        .write(to: fixture.runtimeIdentityManifest)

    let execution = DoctorApplication(dependencies: dependencies)
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "coordinator_runtime").code
        == "coordinator_runtime_identity_unverified")
}

@Test("Doctor process runner drains stderr and captures stdout without a shell command")
func doctorProcessRunnerDrainsBothPipes() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bdp-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let executable = root.appendingPathComponent("fixture-runner")
    let script = """
    #!/bin/sh
    if [ "$1" != "fixed-argument" ]; then
      exit 7
    fi
    index=0
    while [ "$index" -lt 4096 ]; do
      printf 'bounded-stderr-line-%04d-xxxxxxxxxxxxxxxx\n' "$index" >&2
      index=$((index + 1))
    done
    printf 'doctor-stdout-ok\n'
    """
    try Data(script.utf8).write(to: executable)
    guard chmod(executable.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }

    let result = try DoctorProcessRunner.run(
        executable: executable,
        arguments: ["fixed-argument"],
        timeoutMilliseconds: 5_000
    )
    #expect(result.exitCode == 0)
    #expect(String(data: result.stdout, encoding: .utf8) == "doctor-stdout-ok\n")
}

@Test("Doctor Hook trust inspector follows the bounded App Server handshake")
func doctorHookTrustInspectorUsesOfficialHandshake() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bdh-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let executable = root.appendingPathComponent("fake-codex")
    let script = #"""
    #!/bin/sh
    [ "$1" = "app-server" ] || exit 11
    [ "$2" = "--listen" ] || exit 12
    [ "$3" = "stdio://" ] || exit 13
    IFS= read -r initialize || exit 14
    case "$initialize" in *'"method":"initialize"'*) ;; *) exit 15 ;; esac
    printf '%s\n' '{"id":1,"result":{}}'
    IFS= read -r initialized || exit 16
    case "$initialized" in *'"method":"initialized"'*) ;; *) exit 17 ;; esac
    IFS= read -r hooks || exit 18
    case "$hooks" in *'"method":"hooks/list"'*) ;; *) exit 19 ;; esac
    printf '%s\n' '{"method":"server/notice","params":{}}'
    printf '%s\n' '{"id":2,"result":{"data":[]}}'
    while IFS= read -r ignored; do :; done
    """#
    try Data(script.utf8).write(to: executable)
    guard chmod(executable.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }

    let response = try DoctorHookTrustInspector.inspect(
        executable: executable,
        projectURL: root,
        timeoutMilliseconds: 2_000
    )
    let object = try StrictJSONTransport.object(from: response)
    #expect(ExactJSONInteger.int64(object["id"]) == 2)
}

@Test("Doctor Hook trust inspector times out and reaps its exact child")
func doctorHookTrustInspectorReapsTimedOutChild() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bdht-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let executable = root.appendingPathComponent("fake-codex")
    let pidFile = root.appendingPathComponent("pid")
    let script = #"""
    #!/bin/sh
    printf '%s' "$$" > '\#(pidFile.path)'
    IFS= read -r initialize || exit 21
    printf '%s\n' '{"id":1,"result":{}}'
    IFS= read -r initialized || exit 22
    IFS= read -r hooks || exit 23
    while IFS= read -r ignored; do :; done
    """#
    try Data(script.utf8).write(to: executable)
    guard chmod(executable.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }

    do {
        _ = try DoctorHookTrustInspector.inspect(
            executable: executable,
            projectURL: root,
            timeoutMilliseconds: 300
        )
        Issue.record("timed-out Hook inspector unexpectedly completed")
    } catch {
        #expect(error.coordinatorError.code == "doctor_hook_trust_timeout")
    }
    // A very short timeout can fire before the fixture reaches its first
    // instruction. If it did start, its exact PID must already be gone.
    if let pidText = try? String(contentsOf: pidFile, encoding: .utf8),
       let pid = Int32(pidText)
    {
        #expect(kill(pid, 0) == -1)
        #expect(errno == ESRCH)
    }
}

private actor DoctorTransportSpy: CoordinatorOperationalHandling {
    private var handleCalls = 0
    private var doctorCalls = 0

    func handle(type: String, payload: Data) async throws -> Data {
        handleCalls += 1
        throw CoordinatorError("generic_handle_forbidden")
    }

    func doctorStatus(payload: Data) async throws -> Data {
        let object = try StrictJSONTransport.object(from: payload)
        guard object.isEmpty else { throw CoordinatorError("doctor_status_payload_invalid") }
        doctorCalls += 1
        return try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "1.0",
            "kind": "blabee_doctor_status",
            "projects": [],
        ])
    }

    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }

    func counts() -> (handle: Int, doctor: Int) { (handleCalls, doctorCalls) }
}

private actor RuntimeCompatibilityTransportSpy: CoordinatorOperationalHandling {
    private var handledTypes: [String] = []
    private var doctorCalls = 0

    func handle(type: String, payload: Data) async throws -> Data {
        _ = try StrictJSONTransport.object(from: payload)
        handledTypes.append(type)
        if type == "emit_decision" {
            throw CoordinatorError("runtime_compatibility_fixture_failure")
        }
        return try StrictJSONTransport.data(forJSONObject: ["handled_type": type])
    }

    func doctorStatus(payload: Data) async throws -> Data {
        _ = try StrictJSONTransport.object(from: payload)
        doctorCalls += 1
        return try StrictJSONTransport.data(forJSONObject: ["doctor": true])
    }

    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }

    func counts() -> (handledTypes: [String], doctor: Int) {
        (handledTypes, doctorCalls)
    }
}

@Test("UDS doctor_status uses its dedicated read-only protocol method")
func doctorStatusUsesDedicatedUDSDispatch() async throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bdu-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    defer { try? FileManager.default.removeItem(at: root) }
    let socketPath = root.appendingPathComponent("daemon.sock").path
    let server = try UnixDomainSocketServer(socketPath: socketPath)
    let spy = DoctorTransportSpy()
    let corpus = RuntimeSecretCorpus()
    try server.activate()
    let runTask = Task.detached { try server.run(application: spy, secretCorpus: corpus) }
    let client = try UnixDomainSocketClient(socketPath: socketPath)
    let result = try client.request(
        type: "doctor_status",
        payload: [:],
        connectTimeoutMilliseconds: 1_000,
        responseTimeoutMilliseconds: 2_000
    )
    #expect(result["kind"] as? String == "blabee_doctor_status")
    server.stop()
    try await runTask.value
    let counts = await spy.counts()
    #expect(counts.handle == 0)
    #expect(counts.doctor == 1)
}

@Test("UDS runtime identity rejects mismatched clients without replacing the server")
func udsRuntimeIdentityBoundary() async throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bdi-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    defer { try? FileManager.default.removeItem(at: root) }
    let serverIdentity = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    let clientIdentity = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    let socketPath = root.appendingPathComponent("daemon.sock").path
    let server = try UnixDomainSocketServer(
        socketPath: socketPath,
        runtimeIdentity: serverIdentity
    )
    let spy = DoctorTransportSpy()
    let corpus = RuntimeSecretCorpus()
    try server.activate()
    let runTask = Task.detached { try server.run(application: spy, secretCorpus: corpus) }
    defer { server.stop() }

    let mismatched = try UnixDomainSocketClient(
        socketPath: socketPath,
        runtimeIdentity: clientIdentity
    )
    do {
        _ = try mismatched.request(
            type: "doctor_status",
            payload: [:],
            connectTimeoutMilliseconds: 1_000,
            responseTimeoutMilliseconds: 2_000
        )
        Issue.record("mismatched runtime unexpectedly reached the coordinator")
    } catch let error as CoordinatorError {
        #expect(error.code == "operational_runtime_identity_mismatch")
    }

    let matching = try UnixDomainSocketClient(
        socketPath: socketPath,
        runtimeIdentity: serverIdentity
    )
    let result = try matching.request(
        type: "doctor_status",
        payload: [:],
        connectTimeoutMilliseconds: 1_000,
        responseTimeoutMilliseconds: 2_000
    )
    #expect(result["kind"] as? String == "blabee_doctor_status")
    server.stop()
    try await runTask.value
    let counts = await spy.counts()
    #expect(counts.handle == 0)
    #expect(counts.doctor == 1)
}

@Test("UDS admits only signed previous Hook operations and echoes the old identity")
func udsRuntimeIdentityCompatibilityBoundary() async throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bdc-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    defer { try? FileManager.default.removeItem(at: root) }
    let currentIdentity = "sha256:" + String(repeating: "1", count: 64)
    let previousIdentity = "sha256:" + String(repeating: "2", count: 64)
    let unknownIdentity = "sha256:" + String(repeating: "3", count: 64)
    let socketPath = root.appendingPathComponent("daemon.sock").path
    let server = try UnixDomainSocketServer(
        socketPath: socketPath,
        runtimeIdentity: currentIdentity,
        compatiblePreviousRuntimes: [
            OperationalRuntimeCompatibilityPolicy(
                runtimeIdentity: previousIdentity,
                allowedRequestTypes: [
                    "emit_decision", "session_start", "stop", "user_prompt_submit",
                ]
            ),
        ]
    )
    let spy = RuntimeCompatibilityTransportSpy()
    let corpus = RuntimeSecretCorpus()
    try server.activate()
    let runTask = Task.detached { try server.run(application: spy, secretCorpus: corpus) }
    defer { server.stop() }

    let previous = try UnixDomainSocketClient(
        socketPath: socketPath,
        runtimeIdentity: previousIdentity
    )
    let safeResult = try previous.request(
        type: "session_start",
        payload: [:],
        connectTimeoutMilliseconds: 1_000,
        responseTimeoutMilliseconds: 2_000
    )
    #expect(safeResult["handled_type"] as? String == "session_start")

    do {
        _ = try previous.request(
            type: "doctor_status",
            payload: [:],
            connectTimeoutMilliseconds: 1_000,
            responseTimeoutMilliseconds: 2_000
        )
        Issue.record("previous runtime reached a blocked operation")
    } catch let error as CoordinatorError {
        #expect(error.code == "operational_runtime_request_not_compatible")
    }

    do {
        _ = try previous.request(
            type: "emit_decision",
            payload: [:],
            connectTimeoutMilliseconds: 1_000,
            responseTimeoutMilliseconds: 2_000
        )
        Issue.record("fixture application error unexpectedly succeeded")
    } catch let error as CoordinatorError {
        // Seeing the application error proves the response echoed the old
        // accepted identity; otherwise the client reports identity mismatch.
        #expect(error.code == "runtime_compatibility_fixture_failure")
    }

    let unknown = try UnixDomainSocketClient(
        socketPath: socketPath,
        runtimeIdentity: unknownIdentity
    )
    do {
        _ = try unknown.request(
            type: "session_start",
            payload: [:],
            connectTimeoutMilliseconds: 1_000,
            responseTimeoutMilliseconds: 2_000
        )
        Issue.record("unknown runtime unexpectedly reached the coordinator")
    } catch let error as CoordinatorError {
        #expect(error.code == "operational_runtime_identity_mismatch")
    }

    let current = try UnixDomainSocketClient(
        socketPath: socketPath,
        runtimeIdentity: currentIdentity
    )
    let currentResult = try current.request(
        type: "doctor_status",
        payload: [:],
        connectTimeoutMilliseconds: 1_000,
        responseTimeoutMilliseconds: 2_000
    )
    #expect(currentResult["doctor"] as? Bool == true)

    server.stop()
    try await runTask.value
    let counts = await spy.counts()
    #expect(counts.handledTypes == ["session_start", "emit_decision"])
    #expect(counts.doctor == 1)
}

}

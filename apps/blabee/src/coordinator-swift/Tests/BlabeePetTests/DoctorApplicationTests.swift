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
}

private final class DoctorFixture {
    let root: URL
    let app: URL
    let embeddedCoordinator: URL
    let codex: URL
    let plugin: URL
    let processes = DoctorFakeProcesses()

    init() throws {
        root = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("bdt-\(UUID().uuidString.prefix(8))", isDirectory: true)
        app = root.appendingPathComponent("Blabee.app", isDirectory: true)
        embeddedCoordinator = app.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        codex = root.appendingPathComponent("codex")
        plugin = root.appendingPathComponent("plugin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: embeddedCoordinator.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try writeAppPlist(executable: "blabee-coordinator")
        try makeExecutable(embeddedCoordinator)
        try makeExecutable(codex)
        try writePlugin()
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
        currentExecutableURL: URL? = nil,
        path: String? = nil
    ) -> DoctorDependencies {
        DoctorDependencies(
            environment: [
                "PATH": path ?? "\(root.path):\(embeddedCoordinator.deletingLastPathComponent().path)",
            ],
            currentExecutableURL: currentExecutableURL ?? embeddedCoordinator,
            processRunner: processes.run,
            daemonRequester: { _ in
                guard let daemonProjects else { throw CoordinatorError("daemon_unavailable") }
                return try StrictJSONTransport.data(forJSONObject: [
                    "schema_version": "1.0",
                    "kind": "blabee_doctor_status",
                    "projects": daemonProjects,
                ])
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
            data: DoctorApplication.bundledLauncherData
        )
    }

    func writeMCP(includeEnvironment: Bool) throws {
        var server: [String: Any] = [
            "command": "blabee-coordinator",
            "args": ["mcp"],
        ]
        if includeEnvironment { server["env_vars"] = ["BLABEE_SOCKET"] }
        try writeJSON([
            "mcpServers": ["blabee": server],
        ], to: plugin.appendingPathComponent(".mcp.json"))
    }

    func writeHooks(
        userPromptCommand: String = "\"$PLUGIN_ROOT/scripts/blabee-launcher\" hook UserPromptSubmit",
        stopTimeout: Int = 130
    ) throws {
        try writeJSON([
            "description": "Blabee test hooks",
            "hooks": [
                "SessionStart": [[
                    "matcher": "startup|resume|clear|compact",
                    "hooks": [[
                        "type": "command",
                        "command": "\"$PLUGIN_ROOT/scripts/blabee-launcher\" hook SessionStart",
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
                        "additionalContextLimit": 1_200,
                    ]],
                ]],
                "Stop": [[
                    "hooks": [[
                        "type": "command",
                        "command": "\"$PLUGIN_ROOT/scripts/blabee-launcher\" hook Stop",
                        "timeout": stopTimeout,
                        "statusMessage": "Blabee에서 다음 결정 대기 중",
                    ]],
                ]],
                "PermissionRequest": [[
                    "hooks": [[
                        "type": "command",
                        "command": "\"$PLUGIN_ROOT/scripts/blabee-launcher\" hook PermissionRequest",
                        "timeout": 8,
                        "statusMessage": "Blabee에 권한 요청 알림 전송 중",
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
    #expect(DoctorApplication.supportedVersions.isEmpty)
    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").status == .actionRequired)
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_alpha_qualification_required")

    fixture.processes.versionOutput = "codex-cli 0.149.0\n"
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_version_not_allowlisted")
    #expect(execution.exitCode == 1)

    fixture.processes.versionOutput = "Codex version unknown\n"
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_version_unavailable")
    #expect(fixture.processes.invocations.contains(["--version"]))
    #expect(fixture.processes.invocations.contains(["plugin", "list", "--json"]))

    let missingCodex = fixture.root.appendingPathComponent("missing-codex")
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments(codexURL: missingCodex))
    #expect(try doctorCheck(execution, id: "codex_executable").code == "codex_executable_missing")
    #expect(try doctorCheck(execution, id: "codex_version").code == "codex_version_unavailable")
}

@Test("Doctor fails closed for missing disabled ambiguous or malformed plugin state")
func doctorPluginStateFailsClosed() throws {
    let fixture = try DoctorFixture()

    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments(includePluginOverride: false))
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_enabled")
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_ok")

    fixture.processes.pluginEnabled = false
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_disabled")

    fixture.processes.pluginEnabled = true
    fixture.processes.pluginInstalled = false
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_not_installed")

    fixture.processes.pluginInstalled = 1
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_not_installed")

    fixture.processes.pluginInstalled = true
    fixture.processes.pluginEnabled = 1
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_disabled")

    fixture.processes.pluginEnabled = true
    fixture.processes.pluginPresent = false
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_not_installed")

    fixture.processes.pluginPresent = true
    fixture.processes.duplicatePlugin = true
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_installation_ambiguous")

    fixture.processes.duplicatePlugin = false
    fixture.processes.pluginVersion = "0.1.1"
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_version_mismatch")

    fixture.processes.pluginVersion = "0.1.0"
    fixture.processes.pluginSourceKind = "remote"
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_source_invalid")

    fixture.processes.pluginSourceKind = "local"
    fixture.processes.malformedPluginList = true
    execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_list_malformed")
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

@Test("Doctor rejects an override that differs from the installed plugin source identity")
func doctorPluginOverrideMustMatchInstalledSource() throws {
    let installed = try DoctorFixture()
    let override = try DoctorFixture()
    let execution = DoctorApplication(dependencies: installed.dependencies())
        .run(arguments: try installed.arguments(pluginOverrideURL: override.plugin))
    #expect(try doctorCheck(execution, id: "plugin_installation").code == "plugin_enabled")
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")
    #expect(execution.exitCode == 1)
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

    let changedCommand = try DoctorFixture()
    try changedCommand.writeHooks(userPromptCommand: "blabee-launcher hook UserPromptSubmit")
    execution = DoctorApplication(dependencies: changedCommand.dependencies())
        .run(arguments: try changedCommand.arguments())
    #expect(try doctorCheck(execution, id: "plugin_layout").code == "plugin_layout_invalid")

    let changedTimeout = try DoctorFixture()
    try changedTimeout.writeHooks(stopTimeout: 129)
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

@Test("Doctor launcher bytes match the bundled version 0.1.0 contract")
func doctorLauncherBytesMatchBundledContract() throws {
    let launcher = doctorBundledPluginRoot().appendingPathComponent("scripts/blabee-launcher")
    #expect(try Data(contentsOf: launcher) == DoctorApplication.bundledLauncherData)
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

@Test("Doctor MCP runtime must resolve to the embedded coordinator identity")
func doctorMCPRuntimeIdentity() throws {
    let fixture = try DoctorFixture()
    var execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code == "mcp_runtime_ok")

    execution = DoctorApplication(dependencies: fixture.dependencies(
        path: fixture.root.appendingPathComponent("missing-path").path
    )).run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code == "mcp_runtime_missing")

    let mismatched = fixture.root.appendingPathComponent("blabee-coordinator")
    try Data("mismatched\n".utf8).write(to: mismatched)
    guard chmod(mismatched.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    execution = DoctorApplication(dependencies: fixture.dependencies(path: fixture.root.path))
        .run(arguments: try fixture.arguments())
    #expect(try doctorCheck(execution, id: "mcp_runtime").code
        == "mcp_runtime_identity_mismatch")
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

@Test("Doctor JSON is deterministic redacted and always requires explicit hook review")
func doctorJSONIsDeterministicAndRedacted() throws {
    let fixture = try DoctorFixture()
    let execution = DoctorApplication(dependencies: fixture.dependencies())
        .run(arguments: try fixture.arguments())
    let first = try execution.outputData()
    let second = try execution.outputData()
    #expect(first == second)
    let text = try #require(String(data: first, encoding: .utf8))
    #expect(text.contains("\"kind\":\"blabee_doctor_report\""))
    #expect(text.contains("\"overall_status\":\"action_required\""))
    #expect(!text.contains(fixture.root.path))
    #expect(!text.contains("project_id"))
    #expect(try doctorCheck(execution, id: "hook_trust").status == .actionRequired)
    #expect(try doctorCheck(execution, id: "hook_trust").summary.contains("/hooks"))
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

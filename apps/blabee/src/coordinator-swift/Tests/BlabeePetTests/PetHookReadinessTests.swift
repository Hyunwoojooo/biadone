import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator
@testable import CoordinatorSwift

private enum HookReadinessScenario: String, CaseIterable, Sendable {
    case trusted, managed, untrusted, changed, disabled, missing, duplicate
    case wrongPlugin, wrongSource, wrongProject, emptyHash, malformed
    case pluginMissing, pluginDisabled, pluginIdentityMismatch, contractChanged
    case installationChanges, hookFileChanges, qualifierFails, requesterFails
}

private final class HookReadinessFixture: @unchecked Sendable {
    let root: URL
    let codex: URL
    let plugin: URL
    let scenario: HookReadinessScenario
    private let lock = NSLock()
    private var calls: [[String]] = []

    var invocations: [[String]] { lock.withLock { calls } }

    init(_ scenario: HookReadinessScenario = .trusted) throws {
        self.scenario = scenario
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-hook-readiness-\(UUID().uuidString)", isDirectory: true)
        codex = root.appendingPathComponent("codex")
        plugin = root.appendingPathComponent("plugin", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("never executed\n".utf8).write(to: codex)
        guard chmod(codex.path, 0o700) == 0 else {
            throw CoordinatorError("fixture_chmod_failed")
        }
        let bundled = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Plugin/blabee")
        try FileManager.default.copyItem(at: bundled, to: plugin)
        if scenario == .contractChanged { try changeHookContract() }
    }

    deinit { try? FileManager.default.removeItem(at: root) }

    func changeHookContract() throws {
        let url = plugin.appendingPathComponent("hooks/hooks.json")
        let data = try String(contentsOf: url, encoding: .utf8)
            .replacingOccurrences(of: "\"timeout\": 320", with: "\"timeout\": 15")
        try Data(data.utf8).write(to: url)
    }

    func manager() -> PetHookReadinessManager {
        PetHookReadinessManager(dependencies: PetHookReadinessDependencies(
            qualify: { [self] timeout in
                #expect(timeout == 15_000)
                lock.withLock { calls.append(["qualify"]) }
                if scenario == .qualifierFails {
                    throw CodexNativeDiagnostic.signatureInvalid.error
                }
                return .testOnly(url: codex, version: "0.154.0")
            },
            run: { [self] selection, arguments, timeout in
                #expect(selection.canonicalURL == codex)
                #expect((1...5_000).contains(timeout))
                #expect(arguments == ["plugin", "list", "--json"])
                let listCount = lock.withLock {
                    calls.append(arguments)
                    return calls.filter { $0 == arguments }.count
                }
                let path = scenario == .installationChanges && listCount > 1
                    ? root.appendingPathComponent("replacement").path : plugin.path
                let entries: [[String: Any]] = scenario == .pluginMissing ? [] : [[
                    "pluginId": scenario == .pluginIdentityMismatch ? "blabee@other" : "blabee@blabee-app",
                    "name": "blabee", "installed": true,
                    "enabled": scenario != .pluginDisabled,
                    "version": "0.1.1",
                    "source": ["source": "local", "path": path],
                ]]
                return CodexPluginSetupProcessResult(
                    exitCode: 0,
                    stdout: try JSONSerialization.data(withJSONObject: ["installed": entries])
                )
            },
            inspectHooks: { [self] selection, project, timeout in
                #expect(selection.canonicalURL == codex)
                #expect(project == root.standardizedFileURL)
                #expect((1...5_000).contains(timeout))
                lock.withLock { calls.append(["hooks/list"]) }
                if scenario == .requesterFails {
                    throw CoordinatorError("doctor_hook_trust_timeout")
                }
                if scenario == .malformed { return Data("{}".utf8) }
                if scenario == .hookFileChanges { try changeHookContract() }
                return try response(project: project)
            }
        ))
    }

    private func response(project: URL) throws -> Data {
        let events = ["permissionRequest", "sessionStart", "userPromptSubmit", "stop"]
        var hooks: [[String: Any]] = events.compactMap { event in
            if scenario == .missing && event == "permissionRequest" { return nil }
            let trust: String = switch scenario {
            case .managed: "managed"
            case .untrusted: "untrusted"
            case .changed: "changed"
            default: "trusted"
            }
            return [
                "eventName": event, "enabled": scenario != .disabled,
                "isManaged": scenario == .managed,
                "trustStatus": trust,
                "pluginId": scenario == .wrongPlugin ? "another@plugin" : "blabee@blabee-app",
                "source": "plugin",
                "sourcePath": scenario == .wrongSource
                    ? root.appendingPathComponent("elsewhere/hooks/hooks.json").path
                    : plugin.appendingPathComponent("hooks/hooks.json").path,
                "currentHash": scenario == .emptyHash ? "" : "codex-owned-hash-\(event)",
            ]
        }
        if scenario == .duplicate { hooks.append(hooks[0]) }
        return try JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0", "id": 2,
            "result": ["data": [[
                "cwd": scenario == .wrongProject ? root.appendingPathComponent("another").path : project.path,
                "errors": [], "warnings": [], "hooks": hooks,
            ]]],
        ])
    }
}

@Test("Hook check is explicit and inspects only plugin metadata and hook trust")
func petHookReadinessExplicitInspection() async throws {
    let fixture = try HookReadinessFixture()
    let manager = fixture.manager()
    #expect(fixture.invocations.isEmpty)
    let state = await manager.inspect(projectURL: fixture.root)
    #expect(state == .trusted)
    #expect(fixture.invocations == [
        ["qualify"], ["plugin", "list", "--json"],
        ["hooks/list"], ["plugin", "list", "--json"],
    ])
    #expect(state.detail.contains("새 요청으로 확인"))
}

@Test("Hook trust reports fail closed for untrusted, disabled, stale, or wrong metadata",
      arguments: [
        HookReadinessScenario.untrusted, .changed, .disabled, .missing,
        .duplicate, .wrongPlugin, .wrongSource, .emptyHash,
      ])
private func petHookReadinessNeedsReview(_ scenario: HookReadinessScenario) async throws {
    let fixture = try HookReadinessFixture(scenario)
    let result = await fixture.manager().inspect(projectURL: fixture.root)
    #expect(result == .reviewRequired)
    #expect(result.detail.contains("/hooks"))
    #expect(fixture.invocations.filter { $0 == ["plugin", "list", "--json"] }.count == 1)
}

@Test("Managed Hook trust from Codex is accepted independently of command approval")
func petHookReadinessManagedTrust() async throws {
    let fixture = try HookReadinessFixture(.managed)
    let result = await fixture.manager().inspect(projectURL: fixture.root)
    #expect(result == .trusted)
}

@Test("Hook inspection rejects malformed and wrong-project responses",
      arguments: [HookReadinessScenario.malformed, .wrongProject, .requesterFails])
private func petHookReadinessUnavailable(_ scenario: HookReadinessScenario) async throws {
    let fixture = try HookReadinessFixture(scenario)
    let result = await fixture.manager().inspect(projectURL: fixture.root)
    #expect(result == .unavailable(code: "hook_trust_unavailable"))
}

@Test("Plugin installation failures never start the Hook inspector",
      arguments: [
        (HookReadinessScenario.pluginMissing, "plugin_not_installed"),
        (.pluginDisabled, "plugin_disabled"),
        (.pluginIdentityMismatch, "hook_plugin_identity_mismatch"),
        (.contractChanged, "plugin_layout_invalid"),
      ])
private func petHookReadinessInstallationPrerequisites(
    scenario: HookReadinessScenario, code: String
) async throws {
    let fixture = try HookReadinessFixture(scenario)
    let result = await fixture.manager().inspect(projectURL: fixture.root)
    #expect(result == .unavailable(code: code))
    #expect(!fixture.invocations.contains(["hooks/list"]))
}

@Test("Plugin replacement during inspection cannot produce a trusted result",
      arguments: [HookReadinessScenario.installationChanges, .hookFileChanges])
private func petHookReadinessChangedDuringInspection(_ scenario: HookReadinessScenario) async throws {
    let fixture = try HookReadinessFixture(scenario)
    let result = await fixture.manager().inspect(projectURL: fixture.root)
    #expect(result == .unavailable(code: "hook_plugin_changed_during_check"))
}

@Test("Unqualified Codex and missing project stop before subprocess inspection")
func petHookReadinessPrerequisiteFailures() async throws {
    let fixture = try HookReadinessFixture(.qualifierFails)
    let manager = fixture.manager()
    #expect(await manager.inspect(projectURL: fixture.root.appendingPathComponent("missing"))
        == .unavailable(code: "hook_project_unavailable"))
    #expect(fixture.invocations.isEmpty)
    #expect(await manager.inspect(projectURL: fixture.root)
        == .unavailable(code: "codex_native_signature_invalid"))
    #expect(fixture.invocations == [["qualify"]])
}

@Test("Hook inspection never executes a request after its overall deadline")
func petHookReadinessOverallDeadline() async throws {
    let fixture = try HookReadinessFixture()
    let clock = HookReadinessClock()
    let manager = PetHookReadinessManager(dependencies: PetHookReadinessDependencies(
        qualify: { _ in
            clock.advance()
            return .testOnly(url: fixture.codex)
        },
        run: { _, _, _ in
            Issue.record("Expired inspection ran a subprocess")
            throw CoordinatorError("unexpected_process")
        },
        inspectHooks: { _, _, _ in
            Issue.record("Expired inspection queried Hook trust")
            throw CoordinatorError("unexpected_hooks")
        },
        monotonicNow: { clock.now }
    ))
    let result = await manager.inspect(projectURL: fixture.root)
    guard case .unavailable = result else {
        Issue.record("Expected unavailable after inspection deadline")
        return
    }
}

private final class HookReadinessClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0
    var now: UInt64 { lock.withLock { value } }
    func advance() { lock.withLock { value = 31_000_000_000 } }
}

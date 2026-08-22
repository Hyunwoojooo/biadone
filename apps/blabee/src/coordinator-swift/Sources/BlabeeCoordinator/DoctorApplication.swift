import CoordinatorSwift
import CoreFoundation
import CryptoKit
import Darwin
import Dispatch
import Foundation

enum DoctorStatus: String {
    case pass
    case actionRequired = "action_required"
    case fail
}

struct DoctorCheck: Equatable {
    let id: String
    let status: DoctorStatus
    let code: String
    let summary: String

    var jsonObject: [String: Any] {
        [
            "id": id,
            "status": status.rawValue,
            "code": code,
            "summary": summary,
        ]
    }
}

struct DoctorReport {
    let checks: [DoctorCheck]

    var overallStatus: DoctorStatus {
        if checks.contains(where: { $0.status == .fail }) { return .fail }
        if checks.contains(where: { $0.status == .actionRequired }) { return .actionRequired }
        return .pass
    }

    func jsonData() throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: [
            "schema_version": "1.0",
            "kind": "blabee_doctor_report",
            "overall_status": overallStatus.rawValue,
            "checks": checks.map(\.jsonObject),
        ], options: [.sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        return data
    }

    func humanData() -> Data {
        let overall: String
        switch overallStatus {
        case .pass: overall = "통과"
        case .actionRequired: overall = "사용자 조치 필요"
        case .fail: overall = "실패"
        }
        var lines = ["Blabee Doctor: \(overall)"]
        lines.append(contentsOf: checks.map { check in
            let label: String
            switch check.status {
            case .pass: label = "통과"
            case .actionRequired: label = "조치 필요"
            case .fail: label = "실패"
            }
            return "[\(label)] \(check.summary)"
        })
        return Data((lines.joined(separator: "\n") + "\n").utf8)
    }
}

struct DoctorExecution {
    let report: DoctorReport
    let json: Bool

    var exitCode: Int32 {
        switch report.overallStatus {
        case .pass: return 0
        case .actionRequired: return 2
        case .fail: return 1
        }
    }

    func outputData() throws -> Data {
        try json ? report.jsonData() : report.humanData()
    }
}

struct DoctorArguments: Equatable {
    let json: Bool
    let codexURL: URL?
    let appURL: URL
    let pluginURL: URL?
    let socketPath: String
    let projectURL: URL

    init(
        _ values: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath
    ) throws {
        var json = false
        var paths: [String: String] = [:]
        let pathFlags = Set(["--codex", "--app", "--plugin", "--socket", "--project"])
        var index = 0
        while index < values.count {
            let flag = values[index]
            if flag == "--json" {
                guard !json else { throw CoordinatorError("invalid_arguments") }
                json = true
                index += 1
                continue
            }
            guard pathFlags.contains(flag), paths[flag] == nil,
                  index + 1 < values.count
            else { throw CoordinatorError("invalid_arguments") }
            let value = values[index + 1]
            guard value.hasPrefix("/"), !value.contains("\0") else {
                throw CoordinatorError("invalid_arguments")
            }
            paths[flag] = URL(fileURLWithPath: value).standardizedFileURL.path
            index += 2
        }

        guard currentDirectoryPath.hasPrefix("/") else {
            throw CoordinatorError("invalid_arguments")
        }
        self.json = json
        codexURL = paths["--codex"].map(URL.init(fileURLWithPath:))
        appURL = URL(fileURLWithPath: paths["--app"] ?? "/Applications/Blabee.app", isDirectory: true)
        pluginURL = paths["--plugin"].map { URL(fileURLWithPath: $0, isDirectory: true) }
        socketPath = try OperationalSocketPath.resolve(
            explicitPath: paths["--socket"],
            environment: environment
        )
        projectURL = URL(
            fileURLWithPath: paths["--project"] ?? currentDirectoryPath,
            isDirectory: true
        ).standardizedFileURL
    }
}

struct DoctorProcessResult {
    let exitCode: Int32
    let stdout: Data
}

struct DoctorDependencies {
    var environment: [String: String]
    var currentExecutableURL: URL?
    var processRunner: (_ executable: URL, _ arguments: [String], _ timeoutMilliseconds: Int) throws -> DoctorProcessResult
    var daemonRequester: (_ socketPath: String) throws -> Data

    static func live() -> DoctorDependencies {
        DoctorDependencies(
            environment: ProcessInfo.processInfo.environment,
            currentExecutableURL: Bundle.main.executableURL,
            processRunner: DoctorProcessRunner.run,
            daemonRequester: { socketPath in
                let client = try UnixDomainSocketClient(socketPath: socketPath)
                let result = try client.request(
                    type: "doctor_status",
                    payload: [:],
                    connectTimeoutMilliseconds: 1_000,
                    responseTimeoutMilliseconds: 2_000
                )
                return try StrictJSONTransport.data(forJSONObject: result)
            }
        )
    }
}

struct DoctorApplication {
    static let alphaBaselineVersion = "0.148.0"
    static let supportedVersions: Set<String> = []
    static let pluginManifestSHA256 = "bd79518e44c26997fef395fea055420f968d9e09de9a7a8bd8f6b5f24dde66f3"
    static let skillSHA256 = "d902f84629685fecde57bb283e7126fdfa7013fd45ceb75ce902cbf512fc2003"
    static let skillAgentSHA256 = "48f8357783a6f96d1d387501e78ba2ed6785c9945a80d1a45c14dff341ee9520"
    static let bundledLauncherData = Data(("""
    #!/bin/sh

    mode=${1:-}

    if [ "${BLABEE_COORDINATOR_BINARY+x}" = "x" ]; then
      coordinator_binary=$BLABEE_COORDINATOR_BINARY
    else
      coordinator_binary=/Applications/Blabee.app/Contents/MacOS/blabee-coordinator
    fi

    case "$coordinator_binary" in
      /*) ;;
      *) coordinator_binary= ;;
    esac

    if [ -n "$coordinator_binary" ] && [ -f "$coordinator_binary" ] && [ -x "$coordinator_binary" ]; then
      exec "$coordinator_binary" "$@"
    fi

    if [ "$mode" = "hook" ]; then
      # Blabee availability must never prevent normal Codex use.
      exit 0
    fi

    if [ "$mode" = "mcp" ]; then
      printf '%s\\n' '{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Blabee coordinator binary is unavailable."}}'
      exit 127
    fi

    exit 64
    """ + "\n").utf8)

    let dependencies: DoctorDependencies

    init(dependencies: DoctorDependencies = .live()) {
        self.dependencies = dependencies
    }

    func run(arguments: DoctorArguments) -> DoctorExecution {
        var checks: [DoctorCheck] = []

        checks.append(checkCoordinatorRuntime(appURL: arguments.appURL))
        checks.append(checkAppBundle(arguments.appURL))
        checks.append(checkEmbeddedCoordinator(arguments.appURL))

        let codexURL: URL?
        if let explicitCodex = arguments.codexURL {
            codexURL = resolvedExecutable(explicitCodex)
        } else {
            codexURL = resolveExecutable(
                named: "codex",
                path: dependencies.environment["PATH"]
            )
        }
        checks.append(checkCodexExecutable(codexURL))

        let version = codexURL.flatMap { readCodexVersion(at: $0) }
        checks.append(checkCodexVersion(version))

        let pluginInspection = codexURL.map(inspectPluginInstallation(at:))
            ?? PluginInspection(check: DoctorCheck(
                id: "plugin_installation",
                status: .fail,
                code: "plugin_status_unavailable",
                summary: "Blabee 플러그인 설치 상태를 확인할 수 없습니다."
            ), sourceURL: nil)
        checks.append(pluginInspection.check)

        let pluginURL = arguments.pluginURL ?? pluginInspection.sourceURL
        checks.append(checkPluginLayout(
            pluginURL,
            installedSourceURL: pluginInspection.sourceURL,
            requireInstalledSourceMatch: arguments.pluginURL != nil
                && pluginInspection.check.status == .pass
        ))
        checks.append(checkMCPRuntime(appURL: arguments.appURL))
        checks.append(DoctorCheck(
            id: "hook_trust",
            status: .actionRequired,
            code: "hook_review_required",
            summary: "Codex에서 /hooks를 실행해 현재 Blabee Hook 해시를 직접 검토하세요."
        ))

        let daemonInspection = inspectDaemon(socketPath: arguments.socketPath)
        checks.append(daemonInspection.check)
        checks.append(checkProjectScope(arguments.projectURL, projects: daemonInspection.projects))

        return DoctorExecution(report: DoctorReport(checks: checks), json: arguments.json)
    }
}

private extension DoctorApplication {
    struct PluginInspection {
        let check: DoctorCheck
        let sourceURL: URL?
    }

    struct DoctorProject {
        let cwd: String
        let enabled: Bool
    }

    struct DaemonInspection {
        let check: DoctorCheck
        let projects: [DoctorProject]?
    }

    func checkCoordinatorRuntime(appURL: URL) -> DoctorCheck {
        let embeddedURL = appURL.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        guard let url = dependencies.currentExecutableURL,
              let resolved = resolvedExecutable(url),
              isExecutableRegularFile(embeddedURL, allowingSymlink: false),
              sameFile(resolved, embeddedURL)
        else {
            return DoctorCheck(
                id: "coordinator_runtime", status: .fail,
                code: "coordinator_runtime_identity_unverified",
                summary: "현재 coordinator와 앱 내장 실행 파일의 동일성을 확인하지 못했습니다."
            )
        }
        return DoctorCheck(
            id: "coordinator_runtime", status: .pass,
            code: "coordinator_runtime_ok",
            summary: "현재 coordinator가 앱 내장 실행 파일과 동일합니다."
        )
    }

    func checkAppBundle(_ appURL: URL) -> DoctorCheck {
        let infoURL = appURL.appendingPathComponent("Contents/Info.plist")
        guard isDirectoryWithoutSymlink(appURL),
              isDirectoryWithoutSymlink(appURL.appendingPathComponent("Contents")),
              isDirectoryWithoutSymlink(appURL.appendingPathComponent("Contents/MacOS")),
              let data = boundedFileData(infoURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil),
              let object = plist as? [String: Any],
              object["CFBundlePackageType"] as? String == "APPL",
              object["CFBundleExecutable"] as? String == "blabee-coordinator"
        else {
            return DoctorCheck(
                id: "app_bundle", status: .fail,
                code: "app_bundle_invalid",
                summary: "Blabee 앱 번들 또는 Info.plist가 올바르지 않습니다."
            )
        }
        return DoctorCheck(
            id: "app_bundle", status: .pass,
            code: "app_bundle_ok",
            summary: "Blabee 앱 번들을 확인했습니다."
        )
    }

    func checkEmbeddedCoordinator(_ appURL: URL) -> DoctorCheck {
        let binary = appURL.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        guard isExecutableRegularFile(binary, allowingSymlink: false) else {
            return DoctorCheck(
                id: "embedded_coordinator", status: .fail,
                code: "embedded_coordinator_missing",
                summary: "앱에 내장된 blabee-coordinator 실행 파일이 없습니다."
            )
        }
        return DoctorCheck(
            id: "embedded_coordinator", status: .pass,
            code: "embedded_coordinator_ok",
            summary: "앱에 내장된 blabee-coordinator를 확인했습니다."
        )
    }

    func checkCodexExecutable(_ url: URL?) -> DoctorCheck {
        guard let url, isExecutableRegularFile(url, allowingSymlink: false) else {
            return DoctorCheck(
                id: "codex_executable", status: .fail,
                code: "codex_executable_missing",
                summary: "실행 가능한 Codex CLI를 찾지 못했습니다."
            )
        }
        return DoctorCheck(
            id: "codex_executable", status: .pass,
            code: "codex_executable_ok",
            summary: "실행 가능한 Codex CLI를 확인했습니다."
        )
    }

    func readCodexVersion(at url: URL) -> String? {
        guard isExecutableRegularFile(url, allowingSymlink: false),
              let result = try? dependencies.processRunner(url, ["--version"], 5_000),
              result.exitCode == 0,
              result.stdout.count <= 4_096,
              let output = String(data: result.stdout, encoding: .utf8)
        else { return nil }
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

    func checkCodexVersion(_ version: String?) -> DoctorCheck {
        guard let version else {
            return DoctorCheck(
                id: "codex_version", status: .fail,
                code: "codex_version_unavailable",
                summary: "Codex CLI 버전을 안전하게 확인하지 못했습니다."
            )
        }
        if Self.supportedVersions.contains(version) {
            return DoctorCheck(
                id: "codex_version", status: .pass,
                code: "codex_version_supported",
                summary: "지원 승인된 Codex CLI 버전입니다."
            )
        }
        if version == Self.alphaBaselineVersion {
            return DoctorCheck(
                id: "codex_version", status: .actionRequired,
                code: "codex_alpha_qualification_required",
                summary: "Codex CLI alpha 기준 버전은 추가 호환성 승인이 필요합니다."
            )
        }
        return DoctorCheck(
            id: "codex_version", status: .fail,
            code: "codex_version_not_allowlisted",
            summary: "이 Codex CLI 버전은 지원 allowlist에 없습니다."
        )
    }

    func inspectPluginInstallation(at codexURL: URL) -> PluginInspection {
        guard isExecutableRegularFile(codexURL, allowingSymlink: false),
              let result = try? dependencies.processRunner(
                codexURL, ["plugin", "list", "--json"], 5_000
              ),
              result.exitCode == 0,
              result.stdout.count <= 4 * 1_048_576,
              let object = try? StrictJSONTransport.object(
                from: result.stdout,
                limits: StrictJSONLimits(maximumBytes: 4 * 1_048_576, maximumDepth: 32)
              ),
              let installed = object["installed"] as? [[String: Any]]
        else {
            return PluginInspection(check: DoctorCheck(
                id: "plugin_installation", status: .fail,
                code: "plugin_list_malformed",
                summary: "Codex 플러그인 설치 목록을 확인하지 못했습니다."
            ), sourceURL: nil)
        }
        let matches = installed.filter { entry in
            guard entry["name"] as? String == "blabee",
                  let pluginID = entry["pluginId"] as? String,
                  pluginID.hasPrefix("blabee@"),
                  pluginID.count > "blabee@".count
            else { return false }
            return true
        }
        guard matches.count == 1 else {
            return PluginInspection(check: DoctorCheck(
                id: "plugin_installation", status: .fail,
                code: matches.isEmpty ? "plugin_not_installed" : "plugin_installation_ambiguous",
                summary: matches.isEmpty
                    ? "Codex에 Blabee 플러그인이 설치되어 있지 않습니다."
                    : "Blabee 플러그인 설치 항목이 중복되어 있습니다."
            ), sourceURL: nil)
        }
        let entry = matches[0]
        let source = entry["source"] as? [String: Any]
        let sourcePath = source?["path"] as? String
        let sourceURL: URL? = {
            guard let source,
                  Set(source.keys) == Set(["source", "path"]),
                  source["source"] as? String == "local",
                  let sourcePath,
                  sourcePath.hasPrefix("/"),
                  !sourcePath.contains("\0")
            else { return nil }
            return URL(fileURLWithPath: sourcePath, isDirectory: true).standardizedFileURL
        }()
        guard strictBool(entry["installed"]) == true else {
            return PluginInspection(check: DoctorCheck(
                id: "plugin_installation", status: .fail,
                code: "plugin_not_installed",
                summary: "Codex에 Blabee 플러그인이 설치되어 있지 않습니다."
            ), sourceURL: sourceURL)
        }
        guard strictBool(entry["enabled"]) == true else {
            return PluginInspection(check: DoctorCheck(
                id: "plugin_installation", status: .fail,
                code: "plugin_disabled",
                summary: "Codex의 Blabee 플러그인이 비활성화되어 있습니다."
            ), sourceURL: sourceURL)
        }
        guard entry["version"] as? String == "0.1.0" else {
            return PluginInspection(check: DoctorCheck(
                id: "plugin_installation", status: .fail,
                code: "plugin_version_mismatch",
                summary: "설치된 Blabee 플러그인 버전이 번들 계약과 다릅니다."
            ), sourceURL: sourceURL)
        }
        guard sourceURL != nil else {
            return PluginInspection(check: DoctorCheck(
                id: "plugin_installation", status: .fail,
                code: "plugin_source_invalid",
                summary: "설치된 Blabee 플러그인의 local source를 확인할 수 없습니다."
            ), sourceURL: nil)
        }
        return PluginInspection(check: DoctorCheck(
            id: "plugin_installation", status: .pass,
            code: "plugin_enabled",
            summary: "Codex의 Blabee 플러그인이 설치 및 활성화되어 있습니다."
        ), sourceURL: sourceURL)
    }

    func checkPluginLayout(
        _ pluginURL: URL?,
        installedSourceURL: URL?,
        requireInstalledSourceMatch: Bool
    ) -> DoctorCheck {
        guard let pluginURL,
              !requireInstalledSourceMatch
                || installedSourceURL.map({ sameDirectory(pluginURL, $0) }) == true,
              isDirectoryWithoutSymlink(pluginURL),
              isDirectoryWithoutSymlink(pluginURL.appendingPathComponent(".codex-plugin")),
              isDirectoryWithoutSymlink(pluginURL.appendingPathComponent("hooks")),
              isDirectoryWithoutSymlink(pluginURL.appendingPathComponent("scripts")),
              validatePluginManifest(pluginURL),
              validatePluginMCP(pluginURL),
              validatePluginSkills(pluginURL),
              boundedFileData(
                pluginURL.appendingPathComponent("scripts/blabee-launcher"),
                requireExecutable: true
              ) == Self.bundledLauncherData,
              validatePluginHooks(pluginURL)
        else {
            return DoctorCheck(
                id: "plugin_layout", status: .fail,
                code: "plugin_layout_invalid",
                summary: "Blabee manifest, MCP 또는 Hook 구조가 올바르지 않습니다."
            )
        }
        return DoctorCheck(
            id: "plugin_layout", status: .pass,
            code: "plugin_layout_ok",
            summary: "Blabee manifest, MCP 및 Hook 구조를 확인했습니다."
        )
    }

    func checkMCPRuntime(appURL: URL) -> DoctorCheck {
        let embedded = appURL.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        guard let resolved = resolveExecutable(
            named: "blabee-coordinator",
            path: dependencies.environment["PATH"]
        ) else {
            return DoctorCheck(
                id: "mcp_runtime", status: .fail,
                code: "mcp_runtime_missing",
                summary: "PATH에서 blabee-coordinator를 찾지 못했습니다."
            )
        }
        guard sameFile(resolved, embedded) else {
            return DoctorCheck(
                id: "mcp_runtime", status: .fail,
                code: "mcp_runtime_identity_mismatch",
                summary: "PATH의 coordinator가 앱 내장 실행 파일과 다릅니다."
            )
        }
        return DoctorCheck(
            id: "mcp_runtime", status: .pass,
            code: "mcp_runtime_ok",
            summary: "MCP coordinator가 앱 내장 실행 파일과 동일합니다."
        )
    }

    func validatePluginManifest(_ pluginURL: URL) -> Bool {
        guard let data = boundedFileData(
            pluginURL.appendingPathComponent(".codex-plugin/plugin.json")
        ),
        sha256Hex(data) == Self.pluginManifestSHA256,
        let manifest = try? StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 32)
        ),
        Set(manifest.keys) == Set([
            "name", "version", "description", "author", "skills", "interface", "mcpServers",
        ]),
        manifest["name"] as? String == "blabee",
        manifest["version"] as? String == "0.1.0",
        (manifest["description"] as? String)?.isEmpty == false,
        manifest["skills"] as? String == "./skills/",
        manifest["mcpServers"] as? String == "./.mcp.json",
        let author = manifest["author"] as? [String: Any],
        Set(author.keys) == Set(["name"]),
        author["name"] as? String == "BiaDone",
        let interface = manifest["interface"] as? [String: Any],
        Set(interface.keys) == Set([
            "displayName", "shortDescription", "longDescription", "developerName",
            "category", "capabilities", "defaultPrompt",
        ]),
        interface["displayName"] as? String == "Blabee",
        interface["developerName"] as? String == "BiaDone",
        (interface["shortDescription"] as? String)?.isEmpty == false,
        (interface["longDescription"] as? String)?.isEmpty == false,
        (interface["category"] as? String)?.isEmpty == false,
        (interface["capabilities"] as? [Any])?.isEmpty == true,
        let prompts = interface["defaultPrompt"] as? [String],
        prompts.count == 1,
        prompts[0].isEmpty == false
        else { return false }
        return true
    }

    func validatePluginSkills(_ pluginURL: URL) -> Bool {
        let skills = pluginURL.appendingPathComponent("skills", isDirectory: true)
        let decision = skills.appendingPathComponent("blabee-decision", isDirectory: true)
        let agents = decision.appendingPathComponent("agents", isDirectory: true)
        guard directoryEntries(skills) == Set(["blabee-decision"]),
              directoryEntries(decision) == Set(["SKILL.md", "agents"]),
              directoryEntries(agents) == Set(["openai.yaml"]),
              let skill = boundedFileData(decision.appendingPathComponent("SKILL.md")),
              sha256Hex(skill) == Self.skillSHA256,
              let agent = boundedFileData(agents.appendingPathComponent("openai.yaml")),
              sha256Hex(agent) == Self.skillAgentSHA256
        else { return false }
        return true
    }

    func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func validatePluginMCP(_ pluginURL: URL) -> Bool {
        guard let mcp = jsonObject(at: pluginURL.appendingPathComponent(".mcp.json")),
              Set(mcp.keys) == Set(["mcpServers"]),
              let servers = mcp["mcpServers"] as? [String: Any],
              Set(servers.keys) == Set(["blabee"]),
              let blabee = servers["blabee"] as? [String: Any],
              Set(blabee.keys) == Set(["command", "args", "env_vars"]),
              blabee["command"] as? String == "blabee-coordinator",
              (blabee["args"] as? [String]) == ["mcp"],
              (blabee["env_vars"] as? [String]) == ["BLABEE_SOCKET"]
        else { return false }
        return true
    }

    func validatePluginHooks(_ pluginURL: URL) -> Bool {
        guard let hooksFile = jsonObject(
            at: pluginURL.appendingPathComponent("hooks/hooks.json")
        ),
        Set(hooksFile.keys) == Set(["description", "hooks"]),
        (hooksFile["description"] as? String)?.isEmpty == false,
        let hooks = hooksFile["hooks"] as? [String: Any],
        Set(hooks.keys) == Set(["SessionStart", "UserPromptSubmit", "Stop", "PermissionRequest"])
        else { return false }

        return validateHook(
            hooks["SessionStart"], event: "SessionStart",
            matcher: "startup|resume|clear|compact", timeout: 8,
            statusMessage: "Blabee 프로젝트 연결 확인 중", additionalContextLimit: 600
        ) && validateHook(
            hooks["UserPromptSubmit"], event: "UserPromptSubmit",
            matcher: nil, timeout: 8,
            statusMessage: "Blabee 작업 경계 연결 중", additionalContextLimit: 1_200
        ) && validateHook(
            hooks["Stop"], event: "Stop",
            matcher: nil, timeout: 130,
            statusMessage: "Blabee에서 다음 결정 대기 중", additionalContextLimit: nil
        ) && validateHook(
            hooks["PermissionRequest"], event: "PermissionRequest",
            matcher: nil, timeout: 8,
            statusMessage: "Blabee에 권한 요청 알림 전송 중", additionalContextLimit: nil
        )
    }

    func validateHook(
        _ raw: Any?,
        event: String,
        matcher: String?,
        timeout: Int,
        statusMessage: String,
        additionalContextLimit: Int?
    ) -> Bool {
        guard let entries = raw as? [[String: Any]], entries.count == 1 else { return false }
        let entry = entries[0]
        let expectedEntryKeys: Set<String> = matcher == nil ? ["hooks"] : ["matcher", "hooks"]
        guard Set(entry.keys) == expectedEntryKeys,
              (matcher == nil ? entry["matcher"] == nil : entry["matcher"] as? String == matcher),
              let commands = entry["hooks"] as? [[String: Any]], commands.count == 1
        else { return false }

        let command = commands[0]
        var expectedCommandKeys: Set<String> = ["type", "command", "timeout", "statusMessage"]
        if additionalContextLimit != nil { expectedCommandKeys.insert("additionalContextLimit") }
        guard Set(command.keys) == expectedCommandKeys,
              command["type"] as? String == "command",
              command["command"] as? String
                == "\"$PLUGIN_ROOT/scripts/blabee-launcher\" hook \(event)",
              command["timeout"] as? Int == timeout,
              command["statusMessage"] as? String == statusMessage
        else { return false }
        if let additionalContextLimit {
            return command["additionalContextLimit"] as? Int == additionalContextLimit
        }
        return command["additionalContextLimit"] == nil
    }

    func inspectDaemon(socketPath: String) -> DaemonInspection {
        guard let data = try? dependencies.daemonRequester(socketPath),
              let object = try? StrictJSONTransport.object(from: data),
              Set(object.keys) == Set(["schema_version", "kind", "projects"]),
              object["schema_version"] as? String == "1.0",
              object["kind"] as? String == "blabee_doctor_status",
              let rawProjects = object["projects"] as? [[String: Any]]
        else {
            return DaemonInspection(check: DoctorCheck(
                id: "daemon_status", status: .fail,
                code: "daemon_unavailable",
                summary: "Blabee daemon의 읽기 전용 상태를 확인하지 못했습니다."
            ), projects: nil)
        }
        var projects: [DoctorProject] = []
        var previousPath: String?
        for raw in rawProjects {
            guard Set(raw.keys) == Set(["cwd", "enabled"]),
                  let cwd = raw["cwd"] as? String, cwd.hasPrefix("/"),
                  !cwd.contains("\0"),
                  let enabled = strictBool(raw["enabled"]), enabled,
                  URL(fileURLWithPath: cwd, isDirectory: true).standardizedFileURL.path == cwd,
                  previousPath.map({ $0.utf8.lexicographicallyPrecedes(cwd.utf8) }) ?? true
            else {
                return DaemonInspection(check: DoctorCheck(
                    id: "daemon_status", status: .fail,
                    code: "daemon_status_malformed",
                    summary: "Blabee daemon 진단 응답이 올바르지 않습니다."
                ), projects: nil)
            }
            projects.append(DoctorProject(
                cwd: cwd,
                enabled: enabled
            ))
            previousPath = cwd
        }
        return DaemonInspection(check: DoctorCheck(
            id: "daemon_status", status: .pass,
            code: "daemon_status_ok",
            summary: "Blabee daemon의 읽기 전용 상태를 확인했습니다."
        ), projects: projects)
    }

    func checkProjectScope(_ projectURL: URL, projects: [DoctorProject]?) -> DoctorCheck {
        guard let projects else {
            return DoctorCheck(
                id: "project_scope", status: .fail,
                code: "project_scope_unavailable",
                summary: "현재 프로젝트의 Blabee 활성화 범위를 확인하지 못했습니다."
            )
        }
        let requested = projectURL.standardizedFileURL.path
        let matched = projects.contains { project in
            guard project.enabled else { return false }
            if project.cwd == "/" { return requested.hasPrefix("/") }
            return requested == project.cwd || requested.hasPrefix(project.cwd + "/")
        }
        guard matched else {
            return DoctorCheck(
                id: "project_scope", status: .fail,
                code: "project_not_enabled",
                summary: "현재 프로젝트가 활성화된 Blabee 프로젝트 범위에 없습니다."
            )
        }
        return DoctorCheck(
            id: "project_scope", status: .pass,
            code: "project_scope_ok",
            summary: "현재 프로젝트가 활성화된 Blabee 프로젝트 범위에 있습니다."
        )
    }

    func strictBool(_ value: Any?) -> Bool? {
        guard let value else { return nil }
        let object = value as AnyObject
        guard CFGetTypeID(object) == CFBooleanGetTypeID() else { return nil }
        return (object as? NSNumber)?.boolValue
    }

    func resolveExecutable(named name: String, path: String?) -> URL? {
        guard let path else { return nil }
        for directory in path.split(separator: ":", omittingEmptySubsequences: false) {
            let rawDirectory = String(directory)
            guard rawDirectory.hasPrefix("/") else { continue }
            let candidate = URL(fileURLWithPath: rawDirectory, isDirectory: true)
                .appendingPathComponent(name)
                .standardizedFileURL
            if let resolved = resolvedExecutable(candidate) { return resolved }
        }
        return nil
    }

    func resolvedExecutable(_ url: URL) -> URL? {
        let resolved = url.resolvingSymlinksInPath().standardizedFileURL
        return isExecutableRegularFile(resolved, allowingSymlink: false) ? resolved : nil
    }

    func isExecutableRegularFile(_ url: URL, allowingSymlink: Bool) -> Bool {
        var info = stat()
        let result = allowingSymlink ? stat(url.path, &info) : lstat(url.path, &info)
        return result == 0
            && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && FileManager.default.isExecutableFile(atPath: url.path)
    }

    func sameFile(_ left: URL, _ right: URL) -> Bool {
        var leftInfo = stat()
        var rightInfo = stat()
        return stat(left.path, &leftInfo) == 0
            && stat(right.path, &rightInfo) == 0
            && leftInfo.st_dev == rightInfo.st_dev
            && leftInfo.st_ino == rightInfo.st_ino
    }

    func sameDirectory(_ left: URL, _ right: URL) -> Bool {
        var leftInfo = stat()
        var rightInfo = stat()
        return lstat(left.path, &leftInfo) == 0
            && lstat(right.path, &rightInfo) == 0
            && leftInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && rightInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && leftInfo.st_dev == rightInfo.st_dev
            && leftInfo.st_ino == rightInfo.st_ino
    }

    func isDirectoryWithoutSymlink(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0
            && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
    }

    func directoryEntries(_ url: URL) -> Set<String>? {
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { return nil }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
        else {
            close(descriptor)
            return nil
        }
        guard let directory = fdopendir(descriptor) else {
            close(descriptor)
            return nil
        }
        defer { closedir(directory) }

        var result: Set<String> = []
        errno = 0
        while let entry = readdir(directory) {
            let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(
                    to: CChar.self,
                    capacity: Int(entry.pointee.d_namlen) + 1
                ) { String(validatingCString: $0) }
            }
            guard let name else { return nil }
            if name != "." && name != ".." { result.insert(name) }
            errno = 0
        }
        guard errno == 0 else { return nil }
        return result
    }

    func boundedFileData(_ url: URL, requireExecutable: Bool = false) -> Data? {
        let maximumBytes = 1_048_576
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }

        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              !requireExecutable || info.st_mode & 0o111 != 0,
              info.st_size >= 0,
              info.st_size <= off_t(maximumBytes)
        else { return nil }
        let expectedBytes = Int(info.st_size)
        var data = Data()
        data.reserveCapacity(expectedBytes)
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        while true {
            let count = buffer.withUnsafeMutableBytes { bytes in
                Darwin.read(descriptor, bytes.baseAddress, bytes.count)
            }
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                return nil
            }
            guard data.count <= maximumBytes - count else { return nil }
            data.append(contentsOf: buffer.prefix(count))
        }
        guard data.count == expectedBytes else { return nil }
        return data
    }

    func jsonObject(at url: URL) -> [String: Any]? {
        guard let data = boundedFileData(url) else { return nil }
        return try? StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 32)
        )
    }
}

enum DoctorProcessRunner {
    private final class DrainBox: @unchecked Sendable {
        private let lock = NSLock()
        private var value = Data()
        private var bytesSeen = 0
        private var exceededLimit = false

        func append(_ data: Data, limit: Int, retain: Bool) {
            lock.lock()
            if data.count > limit || bytesSeen > limit - data.count {
                exceededLimit = true
            } else {
                bytesSeen += data.count
            }
            if retain, !exceededLimit {
                value.append(data)
            }
            lock.unlock()
        }

        func result() -> (data: Data, exceededLimit: Bool) {
            lock.lock()
            defer { lock.unlock() }
            return (value, exceededLimit)
        }
    }

    static func run(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) throws -> DoctorProcessResult {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        let outputBox = DrainBox()
        let errorBox = DrainBox()
        let drainGroup = DispatchGroup()
        let terminated = DispatchSemaphore(value: 0)
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = errors
        process.terminationHandler = { _ in terminated.signal() }

        drainGroup.enter()
        DispatchQueue.global(qos: .utility).async {
            while let chunk = try? output.fileHandleForReading.read(upToCount: 64 * 1_024),
                  !chunk.isEmpty
            {
                outputBox.append(chunk, limit: 4 * 1_048_576, retain: true)
            }
            drainGroup.leave()
        }
        drainGroup.enter()
        DispatchQueue.global(qos: .utility).async {
            while let chunk = try? errors.fileHandleForReading.read(upToCount: 64 * 1_024),
                  !chunk.isEmpty
            {
                // Drain stderr so the child cannot block, but never retain or report it.
                errorBox.append(chunk, limit: 1_048_576, retain: false)
            }
            drainGroup.leave()
        }
        do {
            try process.run()
        } catch {
            try? output.fileHandleForWriting.close()
            try? errors.fileHandleForWriting.close()
            _ = drainGroup.wait(timeout: .now() + .seconds(1))
            throw CoordinatorError("doctor_process_unavailable")
        }
        try? output.fileHandleForWriting.close()
        try? errors.fileHandleForWriting.close()
        let timeout = DispatchTime.now() + .milliseconds(max(1, timeoutMilliseconds))
        guard terminated.wait(timeout: timeout) == .success else {
            process.terminate()
            if terminated.wait(timeout: .now() + .milliseconds(500)) != .success {
                kill(process.processIdentifier, SIGKILL)
                _ = terminated.wait(timeout: .now() + .seconds(1))
            }
            _ = drainGroup.wait(timeout: .now() + .seconds(1))
            throw CoordinatorError("doctor_process_timeout")
        }
        guard drainGroup.wait(timeout: .now() + .seconds(1)) == .success else {
            throw CoordinatorError("doctor_process_output_invalid")
        }
        let stdout = outputBox.result()
        let stderr = errorBox.result()
        guard !stdout.exceededLimit, !stderr.exceededLimit else {
            throw CoordinatorError("doctor_process_output_too_large")
        }
        return DoctorProcessResult(exitCode: process.terminationStatus, stdout: stdout.data)
    }
}

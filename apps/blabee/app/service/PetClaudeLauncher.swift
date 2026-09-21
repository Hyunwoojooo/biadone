import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

/// Product assembly only. Selecting a Claude project never enables a Codex
/// project or edits its service, plugin, shell or MCP configuration.
struct PetClaudeLauncher: Sendable {
    struct ServiceContext: Equatable, Sendable {
        let socketPath: String
        let runtimeIdentity: String
    }

    /// The resolver supplies a verified current product bundle and service.
    /// This in-process value is not an IPC credential or a path override.
    struct QualifiedRuntime: Sendable {
        let bundleURL: URL
        let coordinatorExecutable: URL
        let service: ServiceContext
        let claudeCandidates: [URL]
        let claudeManifestSHA256: String?

        init(bundleURL: URL, coordinatorExecutable: URL, service: ServiceContext,
             claudeCandidates: [URL], claudeManifestSHA256: String? = nil) {
            self.bundleURL = bundleURL; self.coordinatorExecutable = coordinatorExecutable
            self.service = service; self.claudeCandidates = claudeCandidates
            self.claudeManifestSHA256 = claudeManifestSHA256
        }
    }

    /// Public launch inputs only; enrollment and all capabilities belong to
    /// the native owner after it starts in Terminal.
    struct LaunchPlan: Sendable {
        let coordinatorExecutable: URL
        let ownerSocketPath: String
        let service: ServiceContext
        let project: URL
        let claudeExecutable: URL
        let nodeExecutable: URL
        let payloadRoot: URL

        var options: ClaudeInstalledLauncher.Options {
            .init(ownerSocketPath: ownerSocketPath, sessionSocketPath: service.socketPath,
                  runtimeIdentity: service.runtimeIdentity, cwd: project,
                  claudeExecutable: claudeExecutable, nodeExecutable: nodeExecutable,
                  payloadRoot: payloadRoot)
        }
    }

    enum Failure: Error, LocalizedError, Equatable, Sendable {
        case productUnavailable
        case serviceChanged
        case projectUnavailable
        case payloadUnavailable
        case nodeUnavailable
        case claudeUnavailable
        case terminalUnconfirmed

        var errorDescription: String? {
            switch self {
            case .productUnavailable:
                "설치된 \(BlabeeProductProfile.current.displayName) 앱에서 Claude 시작을 실행해 주세요."
            case .serviceChanged:
                "\(BlabeeProductProfile.current.displayName) 서비스 연결이 바뀌었습니다. 연결 상태를 확인한 뒤 다시 시작해 주세요."
            case .projectUnavailable:
                "선택한 프로젝트 폴더를 사용할 수 없습니다. 폴더를 다시 선택해 주세요."
            case .payloadUnavailable:
                "이 \(BlabeeProductProfile.current.displayName) 앱에는 Claude 연결 파일이 포함되어 있지 않습니다. Claude 연결을 지원하는 앱이 필요합니다."
            case .nodeUnavailable:
                "이 \(BlabeeProductProfile.current.displayName) 앱에는 Claude 연결용 실행 환경이 포함되어 있지 않습니다. Claude 연결을 지원하는 앱이 필요합니다."
            case .claudeUnavailable:
                "지원하는 설치 위치에서 Claude Code를 찾지 못했습니다. Claude Code를 설치한 뒤 다시 시작해 주세요."
            case .terminalUnconfirmed:
                "Claude 시작 요청을 확인하지 못했습니다. Terminal에 이미 열린 창이 있는지 확인해 주세요."
            }
        }
    }

    typealias RuntimeResolver = @Sendable () throws -> QualifiedRuntime
    typealias TerminalOpener = @Sendable (LaunchPlan) throws -> Void
    private let resolveRuntime: RuntimeResolver
    private let openTerminal: TerminalOpener

    init(resolveRuntime: @escaping RuntimeResolver = Self.liveRuntime,
         openTerminal: @escaping TerminalOpener = Self.openLiveTerminal) {
        self.resolveRuntime = resolveRuntime
        self.openTerminal = openTerminal
    }

    @MainActor
    static func startLive(socketPath: String, runtimeIdentity: String,
                          projectFolderChooser: (any PetProjectFolderChoosing)? = nil,
                          validateService: @MainActor () throws -> Void = {}) async throws {
        try await Self().start(projectFolderChooser: projectFolderChooser ?? PetOpenPanelProjectFolderChooser(),
                               service: .init(socketPath: socketPath, runtimeIdentity: runtimeIdentity),
                               validateService: validateService)
    }

    @MainActor
    func start(projectFolderChooser: any PetProjectFolderChoosing, service: ServiceContext,
               validateService: @MainActor () throws -> Void = {}) async throws {
        guard let project = projectFolderChooser.chooseProjectFolder() else { return }
        try validateService()
        try Task.checkCancellation()
        // The chooser is main-actor UI; signature/filesystem checks and the
        // bounded osascript invocation must not block Pet or a cooperative task.
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result {
                    let plan = try makePlan(project: project, service: service)
                    try openTerminal(plan)
                })
            }
        }
    }

    func makePlan(project: URL, service: ServiceContext) throws -> LaunchPlan {
        let runtime: QualifiedRuntime
        do { runtime = try resolveRuntime() }
        catch let failure as Failure { throw failure }
        catch { throw Failure.productUnavailable }
        guard runtime.service == service, OperationalRuntimeIdentity.isValid(service.runtimeIdentity),
              validSocketPath(service.socketPath) else { throw Failure.serviceChanged }

        let canonicalProject: URL
        do { canonicalProject = try ClaudeInstalledLaunchConfiguration.canonicalDirectory(project) }
        catch { throw Failure.projectUnavailable }
        let bundle: URL
        let executable: URL
        do {
            bundle = try ClaudeInstalledLaunchConfiguration.canonicalDirectory(runtime.bundleURL)
            executable = try ClaudeInstalledLaunchConfiguration.canonicalFile(runtime.coordinatorExecutable, executable: true)
            guard executable.path == bundle.appendingPathComponent("Contents/MacOS/blabee-coordinator").path else {
                throw Failure.productUnavailable
            }
        } catch { throw Failure.productUnavailable }

        // Verify the entire sealed resource descriptor before opening Terminal.
        // The native owner repeats qualification and creates its immutable copy
        // while the common executable usage lease is held.
        let claudeRoot = bundle.appendingPathComponent("Contents/Resources/claude", isDirectory: true)
        let payload = claudeRoot.appendingPathComponent("payload", isDirectory: true)
        do {
            guard try ClaudeInstalledLaunchConfiguration.canonicalDirectory(payload).path == payload.path else {
                throw Failure.payloadUnavailable
            }
            for name in ["session-v2-hook.mjs", "session-v2-mcp.mjs"] {
                _ = try bundledFile(payload.appendingPathComponent("src/" + name))
            }
        } catch { throw Failure.payloadUnavailable }
        let node: URL
        do { node = try bundledFile(claudeRoot.appendingPathComponent("node/bin/node"), executable: true) }
        catch { throw Failure.nodeUnavailable }
        do {
            _ = try ClaudeRuntimePayload.qualify(rootURL: claudeRoot,
                expectedArchitecture: ClaudeInstalledLauncher.runtimeArchitecture,
                expectedManifestSHA256: runtime.claudeManifestSHA256)
        } catch { throw Failure.payloadUnavailable }

        guard let claude = runtime.claudeCandidates.lazy.compactMap({ candidate in
            try? ClaudeInstalledLaunchConfiguration.canonicalFile(candidate, executable: true)
        }).first else { throw Failure.claudeUnavailable }
        let owner = URL(fileURLWithPath: service.socketPath).deletingLastPathComponent()
            .appendingPathComponent("claude-owner.sock").path
        guard validSocketPath(owner) else { throw Failure.serviceChanged }
        return LaunchPlan(coordinatorExecutable: executable, ownerSocketPath: owner, service: service,
                          project: canonicalProject, claudeExecutable: claude, nodeExecutable: node, payloadRoot: payload)
    }

    static func claudeCandidates(homeDirectory: URL) -> [URL] {
        [homeDirectory.appendingPathComponent(".local/bin/claude"),
         URL(fileURLWithPath: "/opt/homebrew/bin/claude"), URL(fileURLWithPath: "/usr/local/bin/claude")]
    }

    private static func liveRuntime() throws -> QualifiedRuntime {
        let environment = try ProductServiceEnvironment.live()
        let configuration = try ProductServiceBootstrap.resolve(environment: environment)
        let current = try OperationalRuntimeIdentity.requireCurrent()
        guard ProductInvocationResolver.isStandardInstalledApp(environment.invocation),
              let bundle = environment.invocation.bundleURL,
              let executable = environment.invocation.executableURL,
              OperationalRuntimeIdentity.installedIdentity(forExecutable: executable) == current else {
            throw Failure.productUnavailable
        }
        return QualifiedRuntime(bundleURL: bundle, coordinatorExecutable: executable,
                                service: .init(socketPath: configuration.socketPath, runtimeIdentity: current),
                                claudeCandidates: claudeCandidates(homeDirectory: FileManager.default.homeDirectoryForCurrentUser),
                                claudeManifestSHA256: try ClaudeInstalledLauncher.signedManifestPin(executable: executable,
                                                                                                   runtimeIdentity: current))
    }

    private static func openLiveTerminal(_ plan: LaunchPlan) throws {
        do { try ClaudeInstalledLauncher.openInTerminal(plan.options, coordinatorExecutable: plan.coordinatorExecutable) }
        catch { throw Failure.terminalUnconfirmed }
        // An unconfirmed open may already have opened a window. Never retry.
    }

    private func bundledFile(_ url: URL, executable: Bool = false) throws -> URL {
        let canonical = try ClaudeInstalledLaunchConfiguration.canonicalFile(url, executable: executable)
        guard canonical.path == url.path else { throw Failure.payloadUnavailable }
        return canonical
    }

    private func validSocketPath(_ path: String) -> Bool {
        path.hasPrefix("/") && path.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path)
            && !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
            && !path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().contains(where: {
                $0.isEmpty || $0 == "." || $0 == ".."
            })
    }
}

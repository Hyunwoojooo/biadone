import Testing
@testable import BlabeeCoordinator

@Suite("Pet settings connection readiness")
struct PetConnectionReadinessTests {
    private let gannet = "/projects/gannet"
    private let platy = "/projects/platy"

    private func readiness(
        pluginState: CodexPluginSetupState = .installedNeedsHookReview(version: "0.1.0"),
        serviceConnected: Bool = true,
        serviceIsTransitioning: Bool = false,
        serviceIssue: String? = nil,
        configuredProjectPaths: [String]? = ["/projects/gannet"],
        activeProjectPaths: Set<String>? = ["/projects/gannet"],
        receivedCardProjectPaths: Set<String> = []
    ) -> PetConnectionReadiness {
        PetConnectionReadiness(
            pluginState: pluginState,
            serviceConnected: serviceConnected,
            serviceIsTransitioning: serviceIsTransitioning,
            serviceIssue: serviceIssue,
            configuredProjectPaths: configuredProjectPaths,
            activeProjectPaths: activeProjectPaths,
            receivedCardProjectPaths: receivedCardProjectPaths
        )
    }

    @Test("Installed Plugin is confirmed without automatically judging Hook operation or selection return")
    func installationIsNotEndToEndVerification() {
        let model = readiness()
        #expect(model.status == .awaitingVerification)
        #expect(model.title == "설정 준비됨 · 동작 확인 필요")
        #expect(model.nextStep == .verifyInCodex)
        #expect(model.checks.map(\.id) == ["service", "plugin", "projects", "card"])
        #expect(model.checks.map(\.state) == [.confirmed, .confirmed, .confirmed, .pending])
        #expect(model.checks[1].detail.contains("설치됨"))
        #expect(model.checks[3].detail.contains("이 앱에서 확인한 카드 수신 기록이 없습니다"))
        #expect(model.checks[3].detail.contains("Codex 반환은 자동 판정하지 않습니다"))
        #expect(model.detail.contains("/hooks"))
    }

    @Test("App-observed card reception is scoped to active projects, not a currently pending card")
    func cardEvidenceIsScoped() {
        let model = readiness(receivedCardProjectPaths: [gannet, "/projects/unregistered"])
        #expect(model.status == .receiving)
        #expect(model.title == "선택 카드 수신 확인")
        #expect(model.detail.contains("gannet 프로젝트"))
        #expect(model.detail.contains("이 앱에서"))
        #expect(model.detail.contains("선택 카드 수신을 확인했습니다"))
        #expect(!model.detail.contains("현재 서비스의"))
        #expect(!model.detail.contains("unregistered"))
        #expect(model.detail.contains("다른 프로젝트"))
        #expect(model.checks[3].detail.contains("Hook 전체 상태"))
        #expect(model.checks[3].detail.contains("Codex 반환은 자동 판정하지 않습니다"))
        #expect(model.checks[3].state == .confirmed)
        #expect(readiness(receivedCardProjectPaths: [platy]).status == .awaitingVerification)
    }

    @Test("Multiple received projects are ordered deterministically and remain scoped")
    func multipleCardProjects() {
        let model = readiness(
            configuredProjectPaths: [platy, gannet], activeProjectPaths: [gannet, platy],
            receivedCardProjectPaths: [platy, gannet]
        )
        #expect(model.status == .receiving)
        #expect(model.detail.contains("gannet 외 1개 프로젝트"))
    }

    @Test("A service issue overrides stale connected/card evidence")
    func serviceIssueDominates() {
        let model = readiness(
            pluginState: .notInstalled, serviceIssue: "socket unavailable",
            configuredProjectPaths: [], receivedCardProjectPaths: [gannet]
        )
        #expect(model.status == .needsAttention)
        #expect(model.nextStep == .service)
        #expect(model.detail == "socket unavailable")
        #expect(model.checks.count == 4)
        #expect(model.checks[0].state == .attention)
        #expect(model.checks[3].state == .pending)
    }

    @Test("Disconnected or restarting service does not reuse live evidence or report a project mismatch")
    func disconnectedOrTransitioningService() {
        let disconnected = readiness(
            serviceConnected: false, configuredProjectPaths: [platy],
            receivedCardProjectPaths: [gannet]
        )
        #expect(disconnected.status == .needsSetup)
        #expect(disconnected.nextStep == .service)
        #expect(disconnected.checks[2].state == .pending)
        #expect(disconnected.checks[3].state == .pending)

        let transitioning = readiness(
            serviceIsTransitioning: true, receivedCardProjectPaths: [gannet]
        )
        #expect(transitioning.status == .checking)
        #expect(transitioning.nextStep == .service)
        #expect(transitioning.checks[0].state == .checking)
        #expect(transitioning.checks[2].state == .pending)
        #expect(transitioning.checks[3].state == .pending)
        #expect(readiness(serviceIssue: "  \n ").status == .awaitingVerification)
    }

    @Test("Missing Plugin takes precedence over project configuration and received cards")
    func pluginInstallationNeeded() {
        for state: CodexPluginSetupState in [.notInstalled, .marketplaceInstalledNeedsPlugin] {
            let model = readiness(
                pluginState: state, configuredProjectPaths: [],
                receivedCardProjectPaths: [gannet]
            )
            #expect(model.status == .needsSetup)
            #expect(model.nextStep == .installPlugin)
            #expect(model.checks[1].state == .pending)
            #expect(model.checks.count == 4)
        }
    }

    @Test("Unknown Plugin state asks for inspection, not installation or success")
    func uncheckedPlugin() {
        let model = readiness(pluginState: .unchecked, receivedCardProjectPaths: [gannet])
        #expect(model.status == .checking)
        #expect(model.nextStep == .refresh)
        #expect(model.checks[1].state == .pending)
    }

    @Test("A Plugin update is actionable without claiming the currently installed version is ready")
    func pluginUpdate() {
        let model = readiness(pluginState: .updateAvailable(installedVersion: "0.1.0", bundledVersion: "0.1.1"))
        #expect(model.status == .needsSetup)
        #expect(model.nextStep == .installPlugin)
        #expect(model.nextStepTitle == "Plugin 업데이트")
        #expect(model.checks[1].state == .attention)
    }

    @Test("Unavailable, failed, conflicting, and legacy Plugin states route to their existing diagnostics")
    func pluginProblems() {
        let legacy = CodexPluginSetupLegacyMigrationConfirmation(
            marketplaceName: "legacy", marketplaceRootPath: "/legacy", pluginSelector: "blabee@legacy",
            pluginRootPath: "/legacy/blabee", pluginIsInstalled: true, pluginVersion: "0.1.0",
            filesystemIdentity: .allMissing
        )
        let states: [CodexPluginSetupState] = [
            .unavailable(reason: "Codex missing"), .conflict(reason: "Plugin conflict"),
            .error(code: "test_check_failed"),
            .legacyInstallationDetected(marketplaceName: "legacy", confirmation: legacy),
        ]
        for state in states {
            let model = readiness(pluginState: state, receivedCardProjectPaths: [gannet])
            #expect(model.status == .needsAttention)
            #expect(model.nextStep == .pluginDetails)
            #expect(model.detail == state.detail)
            #expect(model.checks[1].state == .attention)
        }
    }

    @Test("No configured projects asks to add the actual Codex working folder")
    func noProjects() {
        let model = readiness(configuredProjectPaths: [], activeProjectPaths: [])
        #expect(model.status == .needsSetup)
        #expect(model.nextStep == .projects)
        #expect(model.checks[2].state == .pending)
        #expect(model.checks[3].state == .pending)
    }

    @Test("Unknown configuration or active snapshot is not treated as an empty project list")
    func unknownProjectState() {
        let models = [
            readiness(configuredProjectPaths: nil),
            readiness(activeProjectPaths: nil),
            readiness(configuredProjectPaths: nil, activeProjectPaths: nil),
            readiness(configuredProjectPaths: nil, receivedCardProjectPaths: [gannet]),
            readiness(activeProjectPaths: nil, receivedCardProjectPaths: [gannet]),
        ]
        for model in models {
            #expect(model.status == .checking)
            #expect(model.nextStep == .refresh)
            #expect(model.checks[2].state == .pending)
        }
        #expect(models[4].checks[3].state == .pending)
    }

    @Test("Added and removed projects both need restart, including removal of the final project")
    func unappliedProjectChanges() {
        let configurations = [[gannet, platy], [platy], []]
        for configured in configurations {
            let model = readiness(configuredProjectPaths: configured)
            #expect(model.status == .needsRestart)
            #expect(model.nextStep == .restartService)
            #expect(model.checks[2].state == .attention)
        }
    }

    @Test("Project comparison is set-based, while distinct sibling folders remain distinct")
    func projectSetComparison() {
        let ready = readiness(
            configuredProjectPaths: [gannet, platy, gannet], activeProjectPaths: [platy, gannet]
        )
        #expect(ready.status == .awaitingVerification)
        #expect(ready.checks[2].detail.contains("2개"))
        let sibling = readiness(configuredProjectPaths: ["/other/gannet"])
        #expect(sibling.status == .needsRestart)
    }
}

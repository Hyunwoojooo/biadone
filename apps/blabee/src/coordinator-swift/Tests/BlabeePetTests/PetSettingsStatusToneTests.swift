import Testing
@testable import BlabeeCoordinator

@Suite("Pet settings status tones")
struct PetSettingsStatusToneTests {
    private func readiness(
        pluginState: CodexPluginSetupState = .installedNeedsHookReview(version: "0.1.0"),
        serviceConnected: Bool = true,
        serviceIsTransitioning: Bool = false,
        serviceIssue: String? = nil,
        configuredProjectPaths: [String]? = ["/projects/gannet"],
        receivedCardProjectPaths: Set<String> = []
    ) -> PetConnectionReadiness {
        PetConnectionReadiness(
            pluginState: pluginState,
            serviceConnected: serviceConnected,
            serviceIsTransitioning: serviceIsTransitioning,
            serviceIssue: serviceIssue,
            configuredProjectPaths: configuredProjectPaths,
            activeProjectPaths: ["/projects/gannet"],
            receivedCardProjectPaths: receivedCardProjectPaths
        )
    }

    @Test("Every app service state distinguishes confirmed connection, action, failure, and transition")
    func appServiceStates() {
        let cases: [(PetAppServiceState, PetSettingsStatusTone)] = [
            (.disabled, .neutral),
            (.stopped, .actionNeeded),
            (.starting, .neutral),
            (.ready, .confirmed),
            (.reconnecting, .neutral),
            (.stopping, .neutral),
            (.blocked, .actionNeeded),
            (.failed("app_service_connection_timeout"), .error),
        ]
        for (state, expectedTone) in cases {
            #expect(PetSettingsStatusTone.appService(state) == expectedTone)
        }
    }

    @Test("Automatic service registration states preserve approval and unknown distinctions")
    func automaticServiceStates() {
        let cases: [(PetServiceRegistrationState, PetSettingsStatusTone)] = [
            (.notRegistered, .neutral),
            (.enabled, .confirmed),
            (.requiresApproval, .actionNeeded),
            (.notFound, .neutral),
            (.unknown, .neutral),
        ]
        for (state, expectedTone) in cases {
            #expect(PetSettingsStatusTone.automaticService(state, needsRuntimeAttention: false) == expectedTone)
            #expect(PetSettingsStatusTone.automaticService(state, needsRuntimeAttention: true) == .error)
        }
    }

    @Test("Confirmed registration does not imply that the service is running")
    func registrationIsNotRunningEvidence() {
        let model = readiness(serviceConnected: false)
        #expect(PetSettingsStatusTone.automaticService(.enabled, needsRuntimeAttention: false) == .confirmed)
        #expect(model.status == .needsSetup)
        #expect(PetSettingsStatusTone.connection(model) == .actionNeeded)
        #expect(PetSettingsStatusTone.check(model.checks[0].state) == .actionNeeded)
        #expect(model.nextStep == .service)
    }

    @Test("Every Plugin state distinguishes installation, setup actions, and failed checks")
    func codexPluginStates() {
        let legacy = CodexPluginSetupLegacyMigrationConfirmation(
            marketplaceName: "legacy", marketplaceRootPath: "/legacy", pluginSelector: "blabee@legacy",
            pluginRootPath: "/legacy/blabee", pluginIsInstalled: true, pluginVersion: "0.1.0",
            filesystemIdentity: .allMissing
        )
        let cases: [(CodexPluginSetupState, PetSettingsStatusTone)] = [
            (.unchecked, .neutral),
            (.unavailable(reason: "Codex missing"), .actionNeeded),
            (.notInstalled, .actionNeeded),
            (.marketplaceInstalledNeedsPlugin, .actionNeeded),
            (.legacyInstallationDetected(marketplaceName: "legacy", confirmation: legacy), .actionNeeded),
            (.installedNeedsHookReview(version: "0.1.0"), .confirmed),
            (.updateAvailable(installedVersion: "0.1.0", bundledVersion: "0.1.1"), .actionNeeded),
            (.conflict(reason: "Plugin conflict"), .error),
            (.error(code: "test_check_failed"), .error),
        ]
        for (state, expectedTone) in cases {
            #expect(PetSettingsStatusTone.codexPlugin(state) == expectedTone)
            let model = readiness(pluginState: state)
            #expect(PetSettingsStatusTone.check(model.checks[1].state) == expectedTone)
        }
    }

    @Test("Installed Plugin remains neutral for overall verification and does not infer Hook trust")
    func installationIsNotHookTrustEvidence() {
        let state = CodexPluginSetupState.installedNeedsHookReview(version: "0.1.0")
        let model = readiness(pluginState: state)
        #expect(PetSettingsStatusTone.codexPlugin(state) == .confirmed)
        #expect(model.status == .awaitingVerification)
        #expect(PetSettingsStatusTone.connection(model) == .neutral)
        #expect(PetSettingsStatusTone.check(model.checks[3].state) == .neutral)
        #expect(model.nextStep == .verifyInCodex)
        #expect(state.detail.contains("Hook 신뢰 완료 여부를 자동 확인할 수 없습니다"))
        #expect(model.checks[3].detail.contains("Codex 반환은 자동 판정하지 않습니다"))
    }

    @Test("Every connection status uses its recommendation and failure evidence")
    func connectionStates() {
        let cases: [(PetConnectionReadiness, PetConnectionReadiness.Status, PetSettingsStatusTone)] = [
            (readiness(serviceIsTransitioning: true), .checking, .neutral),
            (readiness(serviceConnected: false), .needsSetup, .actionNeeded),
            (readiness(configuredProjectPaths: ["/projects/platy"]), .needsRestart, .actionNeeded),
            (readiness(pluginState: .unavailable(reason: "Codex missing")), .needsAttention, .actionNeeded),
            (readiness(pluginState: .error(code: "test_check_failed")), .needsAttention, .error),
            (readiness(), .awaitingVerification, .neutral),
            (readiness(receivedCardProjectPaths: ["/projects/gannet"]), .receiving, .confirmed),
        ]
        for (model, expectedStatus, expectedTone) in cases {
            #expect(model.status == expectedStatus)
            #expect(PetSettingsStatusTone.connection(model) == expectedTone)
        }
    }

    @Test("Runtime or Plugin errors override otherwise confirmed settings and observed cards")
    func errorsOverrideConfirmedEvidence() {
        let serviceFailure = readiness(
            serviceIsTransitioning: true, serviceIssue: "  socket unavailable \n",
            receivedCardProjectPaths: ["/projects/gannet"]
        )
        #expect(serviceFailure.status == .needsAttention)
        #expect(serviceFailure.nextStep == .service)
        #expect(serviceFailure.checks[0].state == .failed)
        #expect(serviceFailure.checks[1].state == .confirmed)
        #expect(serviceFailure.checks[3].state == .pending)
        #expect(PetSettingsStatusTone.connection(serviceFailure) == .error)

        let pluginConflict = readiness(
            pluginState: .conflict(reason: "Plugin conflict"),
            receivedCardProjectPaths: ["/projects/gannet"]
        )
        #expect(pluginConflict.status == .needsAttention)
        #expect(pluginConflict.nextStep == .pluginDetails)
        #expect(pluginConflict.checks[0].state == .confirmed)
        #expect(pluginConflict.checks[1].state == .failed)
        #expect(pluginConflict.checks[3].state == .confirmed)
        #expect(PetSettingsStatusTone.connection(pluginConflict) == .error)
    }

    @Test("Every checklist state has a distinct presentation category")
    func checkStates() {
        let cases: [(PetConnectionReadiness.CheckState, PetSettingsStatusTone)] = [
            (.confirmed, .confirmed),
            (.pending, .neutral),
            (.attention, .actionNeeded),
            (.checking, .neutral),
            (.failed, .error),
        ]
        for (state, expectedTone) in cases {
            #expect(PetSettingsStatusTone.check(state) == expectedTone)
        }
    }

    @Test("Status labels describe the meaning independently of color")
    func labels() {
        #expect(PetSettingsStatusTone.confirmed.label == "확인 완료")
        #expect(PetSettingsStatusTone.actionNeeded.label == "조치 필요")
        #expect(PetSettingsStatusTone.error.label == "오류")
        #expect(PetSettingsStatusTone.neutral.label == "미확인·미사용")
    }
}

import Testing
@testable import BlabeeCoordinator

@Suite("Pet settings status tones", .petLanguage(.korean))
struct PetSettingsStatusToneTests {
    private func readiness(
        pluginState: CodexPluginSetupState = .installedNeedsHookReview(version: "0.1.0"),
        serviceConnected: Bool = true,
        serviceIsTransitioning: Bool = false,
        serviceIssue: String? = nil,
        configuredProjectPaths: [String]? = ["/projects/gannet"],
        receivedCardProjectPaths: Set<String> = [],
        hookReadiness: PetHookReadinessState = .trusted
    ) -> PetConnectionReadiness {
        PetConnectionReadiness(
            pluginState: pluginState,
            serviceConnected: serviceConnected,
            serviceIsTransitioning: serviceIsTransitioning,
            serviceIssue: serviceIssue,
            configuredProjectPaths: configuredProjectPaths,
            activeProjectPaths: ["/projects/gannet"],
            receivedCardProjectPaths: receivedCardProjectPaths,
            hookReadiness: hookReadiness
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
            (.unresponsive, .actionNeeded),
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
        #expect(state.detail.contains("/hooks"))
        #expect(state.detail.contains("현재 신뢰 상태를 확인"))
        #expect(model.checks[3].detail.contains("Codex 반환은 자동 판정하지 않습니다"))
    }

    @Test("Shared service status is independent of missing Codex setup")
    func commonServiceDoesNotRequireCodex() {
        let claudeOnly = readiness(pluginState: .notInstalled, configuredProjectPaths: [])
        #expect(PetSettingsStatusTone.connection(claudeOnly) == .actionNeeded)
        #expect(PetSettingsStatusTone.commonService(claudeOnly) == .confirmed)
        #expect(PetSettingsStatusTone.commonService(readiness(serviceConnected: false)) == .actionNeeded)
        #expect(PetSettingsStatusTone.commonService(readiness(serviceIsTransitioning: true)) == .neutral)
        #expect(PetSettingsStatusTone.commonService(readiness(serviceIssue: "socket unavailable")) == .error)
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

    @Test("The compact Codex summary reflects prerequisites without treating configuration as a live connection")
    func compactCodexSummary() {
        let cases: [(PetConnectionReadiness, String, PetSettingsStatusTone)] = [
            (readiness(serviceIsTransitioning: true), "확인 중", .neutral),
            (readiness(serviceConnected: false), "연결 설정 필요", .actionNeeded),
            (readiness(pluginState: .notInstalled), "연결 설정 필요", .actionNeeded),
            (readiness(configuredProjectPaths: []), "설정 적용 필요", .actionNeeded),
            (readiness(configuredProjectPaths: ["/projects/changed"]), "설정 적용 필요", .actionNeeded),
            (readiness(configuredProjectPaths: nil), "확인 중", .neutral),
            (readiness(hookReadiness: .unchecked), "승인 확인 전", .neutral),
            (readiness(hookReadiness: .reviewRequired), "확인 필요", .actionNeeded),
            (readiness(), "설정 준비됨", .neutral),
            (readiness(receivedCardProjectPaths: ["/projects/gannet"]), "카드 수신 확인", .confirmed),
            (readiness(serviceIssue: "fixture failure", receivedCardProjectPaths: ["/projects/gannet"]), "확인 필요", .error),
            (readiness(pluginState: .error(code: "fixture_failure"), receivedCardProjectPaths: ["/projects/gannet"]), "확인 필요", .error),
        ]
        for (readiness, title, tone) in cases {
            let summary = PetCodexSettingsSummary(readiness: readiness)
            #expect(summary.title == title)
            #expect(summary.tone == tone)
            #expect(!summary.title.contains("연결됨"))
        }
        let receivedWithoutTrust = PetCodexSettingsSummary(readiness: readiness(
            receivedCardProjectPaths: ["/projects/gannet"], hookReadiness: .unchecked
        ))
        #expect(receivedWithoutTrust.title == "승인 확인 전")
        #expect(receivedWithoutTrust.tone == .neutral)
    }

    @Test("The English summary distinguishes prepared setup from observed cards", .petLanguage(.english))
    func englishCompactCodexSummary() {
        #expect(PetCodexSettingsSummary(readiness: readiness()).title == "Setup ready")
        #expect(PetCodexSettingsSummary(readiness: readiness(hookReadiness: .unchecked)).title == "Approval not verified")
        #expect(PetCodexSettingsSummary(readiness: readiness(receivedCardProjectPaths: ["/projects/gannet"])).title == "Cards received")
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

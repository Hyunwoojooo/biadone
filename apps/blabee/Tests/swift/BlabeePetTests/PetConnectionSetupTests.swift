import Foundation
import Testing
@testable import BlabeeCoordinator

private struct SetupFixtureError: Error, LocalizedError {
    var errorDescription: String? { "fixture 설정 실패" }
}

@MainActor
private final class SetupOperationGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var entered = false
    private var released = false

    func wait() async {
        entered = true
        guard !released else { return }
        // Deliberately non-cooperative: an atomic adapter may finish its write
        // after cancellation. Its result must still be fenced by the caller.
        await withCheckedContinuation { continuation = $0 }
    }

    func release() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class SetupFixture {
    var serviceReady = false
    var serviceIssue: String?
    var providers: [PetConnectionSetupProvider: PetConnectionSetupProviderState] = [
        .codex: .init(status: .available, detail: "Codex 발견"),
        .claude: .init(status: .available, detail: "Claude 개발용 연결 경로 확인 필요")
    ]
    var recommended: Set<PetConnectionSetupProvider> = [.codex, .claude]
    var calls: [String] = []
    var failingProviders: Set<PetConnectionSetupProvider> = []
    var writesBeforeFailure: Set<PetConnectionSetupProvider> = []
    var configurationHasNoEffect = false
    var preparationHasNoEffect = false
    var preparationFails = false
    var inspectionFails = false
    var disconnectAfterProvider: PetConnectionSetupProvider?
    var inspectionGate: SetupOperationGate?
    var configurationGate: SetupOperationGate?

    func inspection() -> PetConnectionSetupInspection {
        .init(serviceReady: serviceReady, providers: providers, recommendedProviders: recommended,
              serviceIssue: serviceIssue)
    }

    func makeController(store: (any PetConnectionSetupSelectionStoring)? = nil) -> PetConnectionSetupController {
        PetConnectionSetupController(store: store, inspect: {
            self.calls.append("inspect")
            if self.inspectionFails { throw SetupFixtureError() }
            let observed = self.inspection()
            if let gate = self.inspectionGate { await gate.wait() }
            return observed
        }, prepare: {
            self.calls.append("prepare")
            if self.preparationFails { throw SetupFixtureError() }
            if !self.preparationHasNoEffect { self.serviceReady = true }
        }, configure: { provider in
            self.calls.append("configure:" + provider.rawValue)
            if let gate = self.configurationGate { await gate.wait() }
            if !self.failingProviders.contains(provider) || self.writesBeforeFailure.contains(provider) {
                if !self.configurationHasNoEffect {
                    self.providers[provider] = .init(status: .configured, detail: "저장 및 재검사 완료",
                                                     sessionEvidence: .waitingForSession)
                }
            }
            if self.disconnectAfterProvider == provider { self.serviceReady = false }
            if self.failingProviders.contains(provider) { throw SetupFixtureError() }
        })
    }
}

@MainActor
private func setupWaitUntil(_ predicate: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while !predicate(), ContinuousClock.now < deadline { await Task.yield() }
    return predicate()
}

@Suite("Provider-independent connection setup", .petLanguage(.korean))
@MainActor
struct PetConnectionSetupTests {
    @Test("Changing presentation language preserves setup intent and does not rerun adapters")
    func languagePreservesSetup() async {
        let fixture = SetupFixture()
        let controller = fixture.makeController()
        PetL10n.$languageOverride.withValue(.english) {
            #expect(controller.detail == "Choose the tools you want to use.")
        }
        PetL10n.$languageOverride.withValue(.korean) {
            #expect(controller.detail == "사용할 도구를 선택해 주세요.")
        }
        #expect(fixture.calls.isEmpty)
        await controller.refresh()
        let calls = fixture.calls
        let selection = controller.selectedProviders
        let phase = controller.phase
        PetL10n.$languageOverride.withValue(.english) {
            #expect(controller.detail == "The selected tools can connect. Choose Connect to prepare the settings.")
        }
        PetL10n.$languageOverride.withValue(.korean) {
            #expect(controller.detail == "선택한 도구를 연결할 수 있어요. 연결하기를 눌러 설정을 준비하세요.")
        }
        #expect(fixture.calls == calls)
        #expect(controller.phase == phase && controller.selectedProviders == selection)
        #expect(!controller.canFinish)
    }

    @Test("Inspection is read-only and only suggests discovered, configurable providers")
    func inspectionDoesNotMutate() async {
        let fixture = SetupFixture()
        fixture.providers[.claude] = .init(status: .needsInstall, detail: "Claude 설치 필요")
        let controller = fixture.makeController()

        await controller.refresh()

        #expect(fixture.calls == ["inspect"])
        #expect(controller.selectedProviders == [.codex])
        #expect(controller.state(for: .claude).status == .needsInstall)
        #expect(!controller.canFinish)
    }

    @Test("An explicit provider choice, including no providers, is not replaced by discovery")
    func selectionIsNotOverwritten() async {
        let fixture = SetupFixture()
        let controller = fixture.makeController()
        await controller.refresh()
        controller.setSelected(false, for: .codex)
        fixture.recommended = [.codex]
        await controller.refresh()
        #expect(controller.selectedProviders == [.claude])
        controller.setSelected(false, for: .claude)
        await controller.refresh()
        await controller.connect()
        #expect(controller.selectedProviders.isEmpty)
        #expect(!controller.canConnect && !controller.canFinish)
        #expect(fixture.calls.allSatisfy { $0 == "inspect" })
    }

    @Test("Prepare and provider configuration run in order with fresh observations")
    func sequentialSetup() async {
        let fixture = SetupFixture()
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))

        await controller.connect()

        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect", "configure:claude", "inspect"])
        #expect(controller.canFinish)
        #expect(controller.phase == .configured)
        #expect(controller.state(for: .codex).sessionEvidence == .waitingForSession)
        #expect(controller.state(for: .claude).sessionEvidence == .waitingForSession)
    }

    @Test("Claude-only setup neither configures Codex nor requires it to be installed")
    func claudeOnlySetup() async {
        let fixture = SetupFixture()
        fixture.providers[.codex] = .init(status: .needsInstall)
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]))

        await controller.connect()

        #expect(controller.canFinish)
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:claude", "inspect"])
        #expect(controller.state(for: .codex).status == .needsInstall)
    }

    @Test("A failed provider does not stop another and its failure survives later observations")
    func independentFailureAndRetry() async {
        let fixture = SetupFixture()
        fixture.failingProviders = [.codex]
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))

        await controller.connect()
        await controller.refresh()

        #expect(controller.state(for: .codex).status == .failed)
        #expect(controller.state(for: .codex).detail == "fixture 설정 실패")
        #expect(controller.state(for: .claude).status == .configured)
        #expect(controller.phase == .failed && !controller.canFinish)
        fixture.failingProviders = []
        fixture.calls = []

        await controller.connect()

        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect"])
        #expect(controller.canFinish)
    }

    @Test("Retry reinspects successful providers instead of trusting a prior completion flag")
    func retryRechecksExternalChanges() async {
        let fixture = SetupFixture()
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        await controller.connect()
        fixture.providers[.codex] = .init(status: .available, detail: "설정이 외부에서 해제됨")
        fixture.calls = []

        await controller.connect()

        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect"])
        #expect(controller.canFinish)
    }

    @Test("A lost write response is resolved by inspection and never automatically replayed")
    func uncertainWriteInspectedBeforeRetry() async {
        let fixture = SetupFixture()
        fixture.failingProviders = [.codex]
        fixture.writesBeforeFailure = [.codex]
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))

        await controller.connect()
        await controller.connect()

        #expect(fixture.calls.filter { $0 == "configure:codex" }.count == 1)
        #expect(controller.state(for: .codex).status == .configured)
        #expect(controller.canFinish)
    }

    @Test("A configure return without observed settings does not mark the provider configured")
    func configureReturnIsNotEvidence() async {
        let fixture = SetupFixture()
        fixture.configurationHasNoEffect = true
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))

        await controller.connect()

        #expect(controller.state(for: .codex).status == .available)
        #expect(controller.state(for: .codex).sessionEvidence == .notObserved)
        #expect(!controller.canFinish)
    }

    @Test("Shared service readiness is required even when provider settings are complete")
    func settingsNeedSharedService() async {
        let fixture = SetupFixture()
        fixture.preparationHasNoEffect = true
        fixture.providers[.claude] = .init(status: .configured, sessionEvidence: .waitingForSession)
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]))

        await controller.connect()

        #expect(fixture.calls == ["inspect", "prepare", "inspect"])
        #expect(controller.state(for: .claude).status == .configured)
        #expect(!controller.serviceReady && !controller.canFinish)
        fixture.serviceReady = true
        controller.receiveObservation(fixture.inspection())
        #expect(controller.canFinish)
        fixture.serviceReady = false
        controller.receiveObservation(fixture.inspection())
        #expect(!controller.canFinish)
    }

    @Test("An observed service failure remains visible across refresh and polling without setup writes")
    func observedServiceFailureSurvivesRefresh() async {
        let fixture = SetupFixture()
        fixture.serviceIssue = "저장소 확인 필요: freshness_storage_missing"
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))

        await controller.refresh()
        #expect(controller.serviceIssue == fixture.serviceIssue)
        #expect(controller.phase == .failed && controller.detail == fixture.serviceIssue)
        for _ in 0..<3 {
            await controller.refresh()
            controller.receiveObservation(fixture.inspection())
            #expect(controller.phase == .failed && controller.detail == fixture.serviceIssue)
        }
        await controller.connect()

        #expect(fixture.calls == Array(repeating: "inspect", count: 5))
        #expect(controller.state(for: .codex).status == .available)
        #expect(!controller.canFinish && !controller.serviceReady)
        fixture.inspectionFails = true
        await controller.refresh()
        #expect(controller.serviceIssue == fixture.serviceIssue && controller.detail == fixture.serviceIssue)
        #expect(fixture.calls.allSatisfy { $0 == "inspect" })
    }

    @Test("Only fresh healthy service evidence clears an observed issue even when tool setup is unfinished")
    func serviceIssueClearsOnlyAfterHealthyObservation() async {
        let fixture = SetupFixture()
        let issue = "저장소 확인 필요: freshness_storage_missing"
        fixture.serviceIssue = issue
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        await controller.refresh()
        fixture.serviceIssue = nil
        // A service restart's stopped/starting observation cannot claim recovery.
        controller.receiveObservation(fixture.inspection())
        await controller.refresh()
        await controller.connect()
        #expect(controller.serviceIssue == issue && controller.detail == issue)
        #expect(fixture.calls.allSatisfy { $0 == "inspect" })

        fixture.serviceReady = true
        controller.receiveObservation(fixture.inspection())
        #expect(controller.serviceIssue == nil && controller.phase == .idle)
        #expect(controller.availableProviders == [.codex] && !controller.canFinish)
        fixture.calls = []
        await controller.connect()
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect"])
        #expect(controller.canFinish)
    }

    @Test("A service issue overrides contradictory ready flags and revokes session evidence")
    func serviceIssueRevokesReadiness() {
        let fixture = SetupFixture()
        fixture.serviceReady = true
        fixture.providers[.claude] = .init(status: .configured, sessionEvidence: .ready)
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]))
        controller.receiveObservation(fixture.inspection())
        #expect(controller.canFinish)
        fixture.serviceIssue = "공통 서비스 오류"
        controller.receiveObservation(fixture.inspection())
        #expect(!controller.canFinish && !controller.serviceReady)
        #expect(controller.state(for: .claude).sessionEvidence == .unavailable)
        #expect(controller.phase == .failed && controller.detail == fixture.serviceIssue)
        controller.setSelected(false, for: .claude)
        #expect(controller.detail == fixture.serviceIssue)
    }

    @Test("A newly observed service failure stops configuration after preparation or between tools",
          arguments: [false, true])
    func serviceIssueStopsLaterWrites(afterCodex: Bool) async {
        let fixture = SetupFixture()
        var configured: [PetConnectionSetupProvider] = []
        var prepares = 0
        let controller = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]),
            inspect: { fixture.inspection() },
            prepare: {
                prepares += 1
                fixture.serviceReady = true
                if !afterCodex { fixture.serviceIssue = "공통 서비스 오류" }
            },
            configure: { provider in
                configured.append(provider)
                fixture.providers[provider] = .init(status: .configured)
                fixture.serviceIssue = "공통 서비스 오류"
            }
        )
        await controller.connect()
        #expect(prepares == 1)
        #expect(configured == (afterCodex ? [.codex] : []))
        #expect(controller.phase == .failed && !controller.canFinish)
        #expect(controller.serviceIssue == fixture.serviceIssue)
    }

    @Test("Mixed availability identifies both tools and configures only the actionable provider",
          arguments: [PetConnectionSetupStatus.needsAction, .needsInstall, .failed])
    func mixedAvailabilityRemainsActionable(_ pending: PetConnectionSetupStatus) async {
        let fixture = SetupFixture()
        fixture.providers[.claude] = .init(status: pending, detail: "Claude 추가 확인 필요")
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))
        await controller.refresh()
        #expect(controller.availableProviders == [.codex])
        #expect(controller.pendingProviders == [.claude])
        #expect(controller.canConnect && !controller.canFinish)
        #expect(controller.phase == .needsAction)
        PetL10n.$languageOverride.withValue(.english) {
            #expect(controller.detail == "Codex can connect now. Claude still needs attention; you can review it separately or connect it later.")
        }
        #expect(controller.detail.contains("Codex는 지금 연결"))
        #expect(controller.detail.contains("Claude는 추가 확인"))
        fixture.calls = []
        await controller.connect()
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect"])
        #expect(controller.state(for: .codex).status == .configured)
        #expect(controller.state(for: .claude).status == pending)
        #expect(controller.pendingProviders == [.claude] && controller.availableProviders.isEmpty)
        #expect(!controller.canFinish)
        controller.setSelected(false, for: .claude)
        #expect(controller.canFinish)
    }

    @Test("Missing installation and external required actions are displayed without mutation")
    func requiredActionRemainsExplicit() async {
        let fixture = SetupFixture()
        fixture.providers[.codex] = .init(status: .needsInstall, detail: "Codex 설치 필요")
        fixture.providers[.claude] = .init(status: .needsAction, detail: "Claude 공개 배포 조건 확인 필요")
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))

        await controller.connect()

        #expect(fixture.calls == ["inspect"])
        #expect(controller.state(for: .claude).detail == "Claude 공개 배포 조건 확인 필요")
        #expect(!controller.canFinish)
    }

    @Test("Duplicate connect, refresh, and provider changes are ignored during a write")
    func duplicateOperationsAreGuarded() async throws {
        let fixture = SetupFixture()
        fixture.serviceReady = true
        let gate = SetupOperationGate()
        fixture.configurationGate = gate
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        let task = Task { await controller.connect() }
        guard await setupWaitUntil({ gate.entered }) else {
            gate.release(); await task.value
            Issue.record("Configure gate was not entered")
            return
        }

        await controller.connect()
        await controller.refresh()
        controller.setSelected(true, for: .claude)
        controller.receiveObservation(.init(serviceReady: false, providers: [:]))
        #expect(controller.selectedProviders == [.codex])
        #expect(controller.state(for: .codex).status == .configuring)
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex"])
        gate.release()
        await task.value
        #expect(controller.canFinish)
    }

    @Test("Cancellation fences a late write, prevents overlap, and retries from inspection")
    func cancellationFencesLateWrite() async {
        let fixture = SetupFixture()
        fixture.serviceReady = true
        let gate = SetupOperationGate()
        fixture.configurationGate = gate
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))
        let task = Task { await controller.connect() }
        guard await setupWaitUntil({ gate.entered }) else {
            gate.release(); await task.value
            Issue.record("Configure gate was not entered")
            return
        }

        controller.cancel()
        await controller.connect()
        #expect(controller.isWorking)
        #expect(!controller.canFinish)
        gate.release()
        await task.value

        #expect(controller.phase == .cancelled)
        #expect(!controller.isWorking && !controller.hasCurrentInspection)
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex"])
        #expect(controller.state(for: .codex).status != .configured)
        fixture.configurationGate = nil
        fixture.calls = []
        await controller.connect()
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:claude", "inspect"])
        #expect(controller.canFinish)
    }

    @Test("Caller task cancellation prevents configuration after a late inspection")
    func parentTaskCancellationFencesInspection() async {
        let fixture = SetupFixture()
        let gate = SetupOperationGate()
        fixture.inspectionGate = gate
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        let task = Task { await controller.connect() }
        guard await setupWaitUntil({ gate.entered }) else {
            gate.release(); await task.value
            Issue.record("Inspection gate was not entered")
            return
        }

        task.cancel()
        gate.release()
        await task.value

        #expect(fixture.calls == ["inspect"])
        #expect(controller.phase == .cancelled)
        #expect(!controller.canFinish && !controller.hasCurrentInspection)
    }

    @Test("A failed inspection revokes previous finish eligibility and session evidence")
    func inspectionFailureRevokesReadiness() async {
        let fixture = SetupFixture()
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        await controller.connect()
        fixture.providers[.codex]?.sessionEvidence = .ready
        await controller.refresh()
        #expect(controller.state(for: .codex).sessionEvidence == .ready)
        fixture.inspectionFails = true

        await controller.refresh()

        #expect(controller.phase == .failed)
        #expect(!controller.canFinish && !controller.serviceReady)
        #expect(controller.state(for: .codex).sessionEvidence == .notObserved)
    }

    @Test("Common preparation and inspection failures survive ordinary available-state polls",
          arguments: ["prepare", "inspect"])
    func commonFailureSurvivesHealthPolling(stage: String) async {
        let fixture = SetupFixture()
        fixture.preparationFails = stage == "prepare"
        fixture.inspectionFails = stage == "inspect"
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        await controller.connect()
        let calls = fixture.calls
        #expect(controller.phase == .failed && controller.detail == "fixture 설정 실패")

        for _ in 0..<3 { controller.receiveObservation(fixture.inspection()) }
        fixture.serviceReady = true
        controller.receiveObservation(fixture.inspection())

        #expect(controller.phase == .failed && controller.detail == "fixture 설정 실패")
        #expect(controller.state(for: .codex).status == .available)
        #expect(!controller.canFinish)
        #expect(fixture.calls == calls)
    }

    @Test("Only a fresh ready-service observation for every selected provider clears a common failure")
    func completeObservationClearsCommonFailure() async {
        let fixture = SetupFixture()
        fixture.preparationFails = true
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))
        await controller.connect()
        let calls = fixture.calls

        fixture.serviceReady = true
        fixture.providers[.codex] = .init(status: .configured, sessionEvidence: .ready)
        controller.receiveObservation(fixture.inspection())
        #expect(controller.phase == .failed && controller.detail == "fixture 설정 실패")
        #expect(!controller.canFinish)

        fixture.serviceReady = false
        fixture.providers[.claude] = .init(status: .configured, sessionEvidence: .ready)
        controller.receiveObservation(fixture.inspection())
        #expect(controller.phase == .failed && controller.detail == "fixture 설정 실패")
        #expect(!controller.canFinish)
        #expect(controller.state(for: .claude).sessionEvidence == .unavailable)

        fixture.serviceReady = true
        controller.receiveObservation(fixture.inspection())
        #expect(controller.phase == .configured && controller.canFinish)
        #expect(controller.detail != "fixture 설정 실패")
        #expect(fixture.calls == calls)
    }

    @Test("An explicit refresh or connect starts a new common-failure attempt",
          arguments: [false, true])
    func explicitActionClearsCommonFailure(connect: Bool) async {
        let fixture = SetupFixture()
        fixture.preparationFails = true
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))
        await controller.connect()
        fixture.preparationFails = false
        fixture.calls = []

        if connect { await controller.connect() } else { await controller.refresh() }

        #expect(controller.detail != "fixture 설정 실패")
        #expect(controller.phase == (connect ? .configured : .idle))
        #expect(controller.canFinish == connect)
        if !connect { #expect(fixture.calls == ["inspect"]) }
    }

    @Test("Refreshing a common failure does not erase an earlier provider configuration failure")
    func commonFailureRetryPreservesProviderFailure() async {
        let fixture = SetupFixture()
        fixture.failingProviders = [.codex]
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))
        await controller.connect()
        fixture.inspectionFails = true
        await controller.refresh()
        #expect(controller.detail == "fixture 설정 실패")
        fixture.inspectionFails = false
        fixture.calls = []

        await controller.refresh()

        #expect(controller.phase == .failed && !controller.canFinish)
        #expect(controller.detail != "fixture 설정 실패")
        #expect(controller.state(for: .codex).status == .failed)
        #expect(controller.state(for: .codex).detail == "fixture 설정 실패")
        #expect(controller.state(for: .claude).status == .configured)
        #expect(fixture.calls == ["inspect"])
    }

    @Test("Restart restores only selection intent and requires fresh evidence")
    func restartDoesNotRestoreAuthority() async {
        let fixture = SetupFixture()
        let store = PetConnectionSetupMemorySelectionStore()
        let first = fixture.makeController(store: store)
        first.setSelected(true, for: .claude)
        await first.connect()
        #expect(first.canFinish)

        let restored = fixture.makeController(store: store)

        #expect(restored.selectedProviders == [.claude])
        #expect(restored.states.isEmpty)
        #expect(!restored.canFinish && !restored.hasCurrentInspection && !restored.serviceReady)
        #expect(restored.state(for: .claude).sessionEvidence == .notObserved)
        fixture.providers[.claude] = .init(status: .needsAction, detail: "설정 변경 확인 필요")
        await restored.refresh()
        #expect(!restored.canFinish)
        #expect(restored.selectedProviders == [.claude])
    }

    @Test("Observation updates do not select recommended providers")
    func pollingDoesNotChooseProviders() async {
        let fixture = SetupFixture()
        let controller = fixture.makeController()

        controller.receiveObservation(fixture.inspection())

        #expect(controller.selectedProviders.isEmpty)
        #expect(fixture.calls.isEmpty)
        await controller.refresh()
        #expect(controller.selectedProviders == [.codex, .claude])
    }

    @Test("An already running service still prepares common scope before provider configuration")
    func runningServiceStillPreparesScope() async {
        let fixture = SetupFixture()
        fixture.serviceReady = true
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]))

        await controller.connect()

        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect"])
        fixture.calls = []
        await controller.connect()
        #expect(fixture.calls == ["inspect"])
    }

    @Test("Shared service loss between providers stops further configuration until a fresh retry")
    func serviceLossStopsNextProvider() async {
        let fixture = SetupFixture()
        fixture.serviceReady = true
        fixture.disconnectAfterProvider = .codex
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]))

        await controller.connect()

        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:codex", "inspect"])
        #expect(!controller.canFinish)
        #expect(controller.state(for: .claude).status == .available)
        fixture.disconnectAfterProvider = nil
        fixture.calls = []
        await controller.connect()
        #expect(fixture.calls == ["inspect", "prepare", "inspect", "configure:claude", "inspect"])
        #expect(controller.canFinish)
    }

    @Test("A service-disconnected observation cannot retain session-ready evidence")
    func serviceLossRevokesSessionEvidence() {
        let fixture = SetupFixture()
        fixture.providers[.claude] = .init(status: .configured, sessionEvidence: .ready)
        let controller = fixture.makeController(store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]))

        controller.receiveObservation(fixture.inspection())

        #expect(controller.state(for: .claude).sessionEvidence == .unavailable)
        #expect(!controller.canFinish)
    }

    @Test("Persistent storage contains only provider intent and preserves an empty selection")
    func userDefaultsContainsOnlySelection() async throws {
        let suite = "BlabeeConnectionSetupTests." + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PetConnectionSetupUserDefaultsSelectionStore(defaults: defaults, key: "selection")
        #expect(store.load() == nil)
        store.save([.claude, .codex])
        #expect(defaults.stringArray(forKey: "selection") == ["claude", "codex"])
        #expect(store.load() == [.claude, .codex])
        store.save([])
        let fixture = SetupFixture()
        let controller = fixture.makeController(store: store)
        await controller.refresh()
        #expect(controller.selectedProviders.isEmpty)
        #expect(!controller.canFinish)
        defaults.set(["unsupported-provider"], forKey: "selection")
        #expect(store.load() == [])
    }
}

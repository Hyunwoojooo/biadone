import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class EventGenerationPreference: PetAppServicePreferenceStoring {
    var enabled = true
}

@MainActor
private final class EventGenerationChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = true
    var terminationSummary: String? { nil }
    func stop() async { isRunning = false }
}

@MainActor
private struct EventGenerationLauncher: AppOwnedServiceLaunching {
    func launch() throws -> any AppOwnedServiceChild { EventGenerationChild() }
}

private enum EventGenerationOutcome: Sendable {
    case success(Data)
    case failure
}

/// Hold only an explicitly named action. Automatic focus and state reads stay
/// responsive, including the replacement service's initial focus handshake.
private actor EventGenerationTransport: PetCoordinatorTransport {
    let backend = PetFakeTransport()
    private let actionType: String
    private var snapshot: Data?
    private var outcomes: [String: EventGenerationOutcome] = [:]
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]
    private var started: Set<String> = []

    init(actionType: String) { self.actionType = actionType }

    func setSnapshot(_ data: Data) { snapshot = data }

    func hold(_ interactionID: String, outcome: EventGenerationOutcome) {
        outcomes[interactionID] = outcome
    }

    func hasStarted(_ interactionID: String) -> Bool { started.contains(interactionID) }

    func release(_ interactionID: String) {
        waiters.removeValue(forKey: interactionID)?.resume()
    }

    func request(type: String, payload: Data) async throws -> Data {
        if type == actionType {
            let object = try petTestObject(payload)
            let target = type == "focus_event" ? object["target"] as? [String: Any] : object
            if let interactionID = target?["interaction_id"] as? String,
               let outcome = outcomes.removeValue(forKey: interactionID) {
                started.insert(interactionID)
                await withCheckedContinuation { waiters[interactionID] = $0 }
                switch outcome {
                case .success(let data): return data
                case .failure: throw PetTestError.injected("old_event_generation_failure")
                }
            }
        }
        // Reconciliation always sees healthy current-service data. A stale
        // action cannot be hidden by a missing mock response or transport error.
        if type == "get_state", let snapshot {
            await backend.enqueue(type: type, response: snapshot)
        } else if type == "focus_interaction" || type == "focus_event" {
            await backend.enqueue(type: type, response: try petTestFocusResponse())
        }
        return try await backend.request(type: type, payload: payload)
    }
}

private func eventGenerationSnapshot(
    cards: [PetTestCard], focused: String?, revision: Int64 = 1
) throws -> Data {
    var object = petTestSnapshotObject(cards: cards, foregroundSuffix: focused)
    let reference = focused.map {
        PetEventReference(kind: .decision, eventID: "interaction_" + $0)
    }
    object["event_navigation"] = [
        "events": cards.map {
            PetEventReference(kind: .decision, eventID: "interaction_" + $0.suffix).jsonObject
        },
        "focused": reference?.jsonObject as Any? ?? NSNull(),
        "revision": revision,
        "delivery_pending": false,
    ]
    return try petTestData(object)
}

private func eventGenerationDismissed(_ identity: PetInteractionIdentity) throws -> Data {
    try petTestData([
        "dismissed": true, "interaction_id": identity.interactionID,
        "packet_id": identity.packetID, "revision": identity.revision,
    ])
}

private func eventGenerationWaitForStart(
    _ interactionID: String, transport: EventGenerationTransport
) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await transport.hasStarted(interactionID) { return true }
        await Task.yield()
    }
    return await transport.hasStarted(interactionID)
}

@MainActor
private struct EventGenerationHarness {
    let transport: EventGenerationTransport
    let service: PetAppServiceController
    let viewModel: PetViewModel

    init(actionType: String) {
        transport = EventGenerationTransport(actionType: actionType)
        service = PetAppServiceController(
            launcher: EventGenerationLauncher(), preference: EventGenerationPreference(),
            registration: { .notRegistered }
        )
        viewModel = PetViewModel(
            transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            appService: service, processIdentifier: 999
        )
        service.startAtAppLaunch()
    }

    func present(_ data: Data) async {
        await transport.setSnapshot(data)
        await viewModel.refresh()
        #expect(service.state == .ready)
    }

    func restartAndPresent(_ data: Data) async {
        let generation = service.generation
        await service.restart()
        #expect(service.generation != generation)
        await present(data)
    }
}

@Test("Late event focus cannot overwrite a restarted service or clear its newer focus",
      arguments: [false, true])
@MainActor
func petEventActionGenerationLateFocus(fails: Bool) async throws {
    let h = EventGenerationHarness(actionType: "focus_event")
    let originalCards = ["focus_a_first", "focus_a_target"].map {
        PetTestCard(suffix: $0, rankedActionCount: 2)
    }
    let oldTarget = "interaction_focus_a_target"
    await h.present(try eventGenerationSnapshot(cards: originalCards, focused: originalCards[0].suffix))
    await h.transport.hold(oldTarget, outcome: fails ? .failure : .success(try petTestFocusResponse()))
    let oldAction = Task { await h.viewModel.navigateToNextEvent() }
    #expect(await eventGenerationWaitForStart(oldTarget, transport: h.transport))

    let replacementCards = ["focus_b_first", "focus_b_target"].map {
        PetTestCard(suffix: $0, rankedActionCount: 2)
    }
    let newTarget = "interaction_focus_b_target"
    await h.transport.hold(newTarget, outcome: .success(try petTestFocusResponse()))
    await h.restartAndPresent(try eventGenerationSnapshot(
        cards: replacementCards, focused: replacementCards[0].suffix
    ))
    #expect(h.viewModel.pendingEventFocus == nil)
    #expect(h.viewModel.canNavigateEvents)
    #expect(h.viewModel.canActOnDisplayedEvent)
    #expect(h.viewModel.focusedInteraction?.identity.interactionID == "interaction_focus_b_first")
    let newAction = Task { await h.viewModel.navigateToNextEvent() }
    let newActionStarted = await eventGenerationWaitForStart(newTarget, transport: h.transport)
    #expect(newActionStarted)
    let snapshotsBeforeOldCompletion = await h.transport.backend.requestCount(type: "get_state")

    await h.transport.release(oldTarget)
    await oldAction.value

    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.focusedInteraction?.identity.interactionID == "interaction_focus_b_first")
    #expect(await h.transport.backend.requestCount(type: "get_state") == snapshotsBeforeOldCompletion)
    if newActionStarted {
        #expect(h.viewModel.pendingEventFocus?.reference.eventID == newTarget)
        #expect(!h.viewModel.canNavigateEvents)
        #expect(!h.viewModel.canActOnDisplayedEvent)
    }

    await h.transport.setSnapshot(try eventGenerationSnapshot(
        cards: replacementCards, focused: replacementCards[1].suffix, revision: 2
    ))
    await h.transport.release(newTarget)
    await newAction.value
    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.pendingEventFocus == nil)
    #expect(h.viewModel.focusedInteraction?.identity.interactionID == newTarget)
    #expect(h.viewModel.canNavigateEvents)
    #expect(h.viewModel.canActOnDisplayedEvent)
    await h.viewModel.shutdownAppOwnedService()
}

@Test("Late dismissal cannot emit usage or clear a restarted service's newer dismissal",
      arguments: [false, true])
@MainActor
func petEventActionGenerationLateDismissal(fails: Bool) async throws {
    let h = EventGenerationHarness(actionType: "dismiss_interaction")
    let original = PetTestCard(suffix: "dismiss_a", rankedActionCount: 2)
    await h.present(try eventGenerationSnapshot(cards: [original], focused: original.suffix))
    let oldIdentity = try #require(h.viewModel.displayInteraction?.identity)
    await h.transport.hold(
        oldIdentity.interactionID,
        outcome: fails ? .failure : .success(try eventGenerationDismissed(oldIdentity))
    )
    let oldAction = Task { await h.viewModel.skipDecision(for: oldIdentity) }
    #expect(await eventGenerationWaitForStart(oldIdentity.interactionID, transport: h.transport))

    let replacement = PetTestCard(suffix: "dismiss_b", rankedActionCount: 2)
    await h.restartAndPresent(try eventGenerationSnapshot(cards: [replacement], focused: replacement.suffix))
    let newIdentity = try #require(h.viewModel.displayInteraction?.identity)
    #expect(h.viewModel.inFlightDismissalIdentity == nil)
    #expect(h.viewModel.canSkipDecision(newIdentity))
    #expect(h.viewModel.focusedInteraction?.identity == newIdentity)
    var acceptedUsage = 0
    h.viewModel.onUsageAccepted = { _ in acceptedUsage += 1 }
    await h.transport.hold(newIdentity.interactionID, outcome: .success(try eventGenerationDismissed(newIdentity)))
    let newAction = Task { await h.viewModel.skipDecision(for: newIdentity) }
    let newActionStarted = await eventGenerationWaitForStart(newIdentity.interactionID, transport: h.transport)
    #expect(newActionStarted)
    let snapshotsBeforeOldCompletion = await h.transport.backend.requestCount(type: "get_state")

    await h.transport.release(oldIdentity.interactionID)
    await oldAction.value

    #expect(acceptedUsage == 0)
    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.focusedInteraction?.identity == newIdentity)
    #expect(await h.transport.backend.requestCount(type: "get_state") == snapshotsBeforeOldCompletion)
    if newActionStarted {
        #expect(h.viewModel.inFlightDismissalIdentity == newIdentity)
        #expect(!h.viewModel.canSkipDecision(newIdentity))
    }

    await h.transport.setSnapshot(try eventGenerationSnapshot(cards: [], focused: nil, revision: 2))
    await h.transport.release(newIdentity.interactionID)
    await newAction.value
    #expect(acceptedUsage == 1)
    #expect(h.viewModel.lastError == nil)
    #expect(h.viewModel.inFlightDismissalIdentity == nil)
    #expect(h.viewModel.snapshotInteractions.isEmpty)
    await h.viewModel.shutdownAppOwnedService()
}

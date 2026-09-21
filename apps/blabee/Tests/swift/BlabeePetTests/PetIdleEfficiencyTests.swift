import Carbon
import Combine
import Foundation
import Testing
@testable import BlabeeCoordinator

private final class PetIdleTestHotKeyReference: PetHotKeyReference, @unchecked Sendable {
    let eventID: UInt32

    init(eventID: UInt32) {
        self.eventID = eventID
    }
}

private final class PetIdleTestHotKeyBackend: PetHotKeyBackend, @unchecked Sendable {
    private(set) var attempts: [(shortcut: PetShortcut, eventID: UInt32)] = []
    private var active: [UInt32: PetShortcut] = [:]
    var failures: [PetShortcut: OSStatus] = [:]

    func installHandler(
        _ handler: @escaping @Sendable (PetHotKeyEvent) -> Void
    ) throws {}

    func register(
        event: PetHotKeyEvent,
        shortcut: PetShortcut,
        exclusive: Bool
    ) throws -> PetHotKeyReference {
        attempts.append((shortcut: shortcut, eventID: event.id))
        if let status = failures[shortcut] {
            throw PetHotKeyBackendError.registration(status)
        }
        active[event.id] = shortcut
        return PetIdleTestHotKeyReference(eventID: event.id)
    }

    func unregister(_ reference: PetHotKeyReference) {
        guard let reference = reference as? PetIdleTestHotKeyReference else { return }
        active.removeValue(forKey: reference.eventID)
    }

    func attemptCount(for shortcut: PetShortcut) -> Int {
        attempts.count { $0.shortcut == shortcut }
    }
}

@Test("BlabeePet does not republish an identical snapshot but preserves heartbeat callbacks")
@MainActor
func blabeePetIdenticalSnapshotDoesNotRepublish() throws {
    let viewModel = PetViewModel(
        transport: PetFakeTransport(),
        externalApplicationOpener: PetFakeApplicationOpener()
    )
    let snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: []))
    viewModel.applySnapshotForTesting(snapshot)

    var publicationCount = 0
    var attentionCallbackCount = 0
    let observation = viewModel.objectWillChange.sink {
        publicationCount += 1
    }
    viewModel.onAttentionChanged = { _ in
        attentionCallbackCount += 1
    }

    viewModel.applySnapshotForTesting(snapshot)

    #expect(publicationCount == 0)
    #expect(attentionCallbackCount == 1)
    withExtendedLifetime(observation) {}
}

@Test("BlabeePet does not republish the same disconnect error on every poll")
@MainActor
func blabeePetRepeatedDisconnectDoesNotRepublish() async {
    let transport = PetFakeTransport()
    let viewModel = PetViewModel(
        transport: transport,
        externalApplicationOpener: PetFakeApplicationOpener()
    )
    await transport.enqueueFailure(type: "get_state", code: "same_disconnect")
    await viewModel.refresh()

    var publicationCount = 0
    var attentionCallbackCount = 0
    let observation = viewModel.objectWillChange.sink {
        publicationCount += 1
    }
    viewModel.onAttentionChanged = { _ in
        attentionCallbackCount += 1
    }
    await transport.enqueueFailure(type: "get_state", code: "same_disconnect")

    await viewModel.refresh()

    #expect(publicationCount == 0)
    #expect(attentionCallbackCount == 1)
    #expect(viewModel.lastError?.contains("same_disconnect") == true)
    withExtendedLifetime(observation) {}
}

@Test("BlabeePet suppresses identical failed shortcut registration until explicit apply")
@MainActor
func blabeePetFailedHotKeyRegistrationRetriesOnlyOnExplicitApply() throws {
    let defaults = PetShortcutConfiguration.defaults
    let backend = PetIdleTestHotKeyBackend()
    backend.failures[defaults.toggle] = OSStatus(eventHotKeyExistsErr)
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults
    ) { _ in }

    #expect(backend.attemptCount(for: defaults.toggle) == 1)
    registry.reconcile(eligibleSlots: [])
    registry.reconcile(eligibleSlots: [])
    #expect(backend.attemptCount(for: defaults.toggle) == 1)
    #expect(registry.statuses[.toggle] == .systemCollision)

    let retryResult = registry.updateConfiguration(defaults)
    guard case .registrationRejected(let failures) = retryResult else {
        Issue.record("an explicit retry must report its persistent collision")
        return
    }
    let allFailuresAreRetries = failures.allSatisfy { $0.isRetryAttempt }
    #expect(allFailuresAreRetries)
    #expect(retryResult.errorMessage?.contains("등록 재시도에 실패") == true)
    #expect(retryResult.errorMessage?.contains("복원") == false)
    #expect(backend.attemptCount(for: defaults.toggle) == 2)
    registry.reconcile(eligibleSlots: [])
    #expect(backend.attemptCount(for: defaults.toggle) == 2)

    backend.failures.removeValue(forKey: defaults.toggle)
    #expect(registry.updateConfiguration(defaults) == .applied)
    #expect(backend.attemptCount(for: defaults.toggle) == 3)
    if case .registered = registry.statuses[.toggle] {
        // Explicit Save/Apply is allowed to retry a previously failed binding.
    } else {
        Issue.record("explicit apply must retry the failed toggle binding")
    }
}

@Test("BlabeePet retries a failed shortcut once when eligibility changes")
@MainActor
func blabeePetFailedHotKeyRegistrationRetriesOncePerEligibilityPlan() throws {
    let defaults = PetShortcutConfiguration.defaults
    let backend = PetIdleTestHotKeyBackend()
    backend.failures[defaults.slot1] = OSStatus(paramErr)
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults
    ) { _ in }

    registry.reconcile(eligibleSlots: [1])
    #expect(backend.attemptCount(for: defaults.slot1) == 1)
    #expect(registry.statuses[.slot1] == .registrationFailure(status: OSStatus(paramErr)))

    registry.reconcile(eligibleSlots: [1])
    registry.reconcile(eligibleSlots: [1])
    #expect(backend.attemptCount(for: defaults.slot1) == 1)

    registry.reconcile(eligibleSlots: [1, 2])
    #expect(backend.attemptCount(for: defaults.slot1) == 2)
    registry.reconcile(eligibleSlots: [1, 2])
    #expect(backend.attemptCount(for: defaults.slot1) == 2)
    if case .registered = registry.statuses[.slot2] {
        // Existing successful transitions remain active while slot 1 is suppressed.
    } else {
        Issue.record("an unrelated eligible shortcut must still register")
    }
}

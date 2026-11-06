import Combine
import CoordinatorSwift
import Foundation

enum PetAccessState: String, CaseIterable, Sendable, Equatable {
    case signedOut = "signed_out"
    case checking
    case active
    case suspended
    case servicePaused = "service_paused"
    case socialLoginRequired = "social_login_required"
    case unavailable
    case expired
}

/// UI mirror of the service's HTTPS-verified, process-local grant. The UI never
/// authorizes the service or stores tokens, and a refresh token cannot enter it.
@MainActor
final class PetAccessController: ObservableObject {
    @Published private(set) var state: PetAccessState = .signedOut
    @Published private(set) var userID: UUID?
    private(set) var actionGeneration: UInt64 = 0
    private(set) var serviceGeneration: UUID?
    private(set) var revision = 0
    var onChange: (() -> Void)?

    private struct Mutation {
        let operation: String
        let revision: Int
        let requestID: UUID
    }
    private struct Reply {
        let revision: Int
        let generation: UUID
        let state: PetAccessState
        let userID: UUID?
        let remaining: Int
    }
    private let transport: any PetCoordinatorTransport
    private let ownedAccess: @MainActor () -> PetProviderServiceAccess?
    private let now: @MainActor () -> UInt64
    private let wallNow: @MainActor () -> Date
    private let automaticPolling: Bool
    private let sleep: @MainActor (TimeInterval) async throws -> Void
    private var credential: PetAccountVerifiedCredential?
    private var owner: PetProviderServiceAccess?
    private var mutation: Mutation?
    private var uiGeneration: UInt64 = 0
    private var serviceRevision = 0
    private var grantDeadline: UInt64?
    private var lastMonotonicInstant: UInt64?
    private var grantClockInvalidated = false
    private var wantsRefresh = false
    private var started = false
    private var stopped = false
    private var inFlight = false
    private var needsTick = false
    private var worker: Task<Void, Never>?
    private var timer: Task<Void, Never>?
    private var expiry: Task<Void, Never>?

    init(transport: any PetCoordinatorTransport,
         ownedAccess: @escaping @MainActor () -> PetProviderServiceAccess?,
         now: @escaping @MainActor () -> UInt64 = { SystemCoordinatorContinuousClock().nowNanoseconds() },
         wallNow: @escaping @MainActor () -> Date = Date.init,
         automaticPolling: Bool = true,
         sleep: @escaping @MainActor (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }) {
        self.transport = transport
        self.ownedAccess = ownedAccess
        self.now = now
        self.wallNow = wallNow
        self.automaticPolling = automaticPolling
        self.sleep = sleep
    }

    var effectiveState: PetAccessState {
        if state == .active && remainingSeconds == 0 { return .expired }
        return state
    }
    var allowsActions: Bool { !stopped && owner != nil && ownedAccess() == owner && effectiveState == .active }
    var remainingSeconds: Int {
        let remaining = remainingNanoseconds
        // The deadline already removes the server's rounding allowance. Ceil
        // only this local remainder so a fractional final second stays usable.
        return Int(remaining / 1_000_000_000 + (remaining % 1_000_000_000 == 0 ? 0 : 1))
    }
    var pollInterval: TimeInterval { effectiveState == .checking ? 1 : 5 }

    private var remainingNanoseconds: UInt64 {
        guard let deadline = grantDeadline, !grantClockInvalidated,
              let instant = observeMonotonicInstant(), deadline > instant else { return 0 }
        return deadline - instant
    }

    private func observeMonotonicInstant() -> UInt64? {
        let instant = now()
        if let previous = lastMonotonicInstant, instant < previous {
            // A later clock recovery cannot revive this cached grant. Only a
            // fresh, fenced service reply may establish another deadline.
            grantClockInvalidated = true
            return nil
        }
        lastMonotonicInstant = instant
        return instant
    }

    func start() {
        guard !started, !stopped else { return }
        started = true
        requestTick()
    }

    func receiveVerifiedCredential(_ value: PetAccountVerifiedCredential) {
        guard !stopped else { return }
        guard (8...16_384).contains(value.accessToken.utf8.count),
              value.accessToken.utf8.allSatisfy({ (33...126).contains($0) }), value.expiresAt > wallNow() else {
            invalidateCredential()
            return
        }
        let preservesGrant = credential?.userID == value.userID && allowsActions
        uiGeneration &+= 1
        credential = value
        // Logout is a service-side revocation barrier. A quick re-login may
        // replace the pending credential, but cannot skip the clear ACK.
        if mutation?.operation != "clear", !advanceMutation("update") { return }
        if !preservesGrant { publish(.checking, userID: value.userID) }
        requestTick()
    }

    func invalidateCredential() {
        guard !stopped else { return }
        uiGeneration &+= 1
        credential = nil
        wantsRefresh = false
        _ = advanceMutation("clear")
        publish(.signedOut, userID: nil)
        requestTick()
    }

    func refresh() {
        guard !stopped else { return }
        wantsRefresh = true
        requestTick()
    }

    /// Called on app-owned service transitions; the actual owner credential is
    /// part of every response fence, independently of the server UUID.
    func serviceDidChange() {
        guard !stopped else { return }
        if owner != ownedAccess() {
            replaceOwner(ownedAccess())
            requestTick()
        }
    }

    func stop() {
        stopped = true
        uiGeneration &+= 1
        worker?.cancel(); worker = nil
        timer?.cancel(); timer = nil
        expiry?.cancel(); expiry = nil
        credential = nil
        mutation = nil
        publish(.signedOut, userID: nil)
        onChange = nil
    }

    /// Single-flight seam also used by deterministic tests. Retry a lost
    /// mutation with its exact revision/request ID; never replay a UI action.
    func synchronize() async {
        guard !stopped, !inFlight else { return }
        inFlight = true
        defer { inFlight = false }
        let currentOwner = ownedAccess()
        if currentOwner != owner { replaceOwner(currentOwner) }
        guard let owned = currentOwner else {
            publish(credential == nil ? .signedOut : .unavailable, userID: credential?.userID)
            return
        }
        guard owned.credential.utf8.count == 64,
              owned.credential.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            publish(.unavailable, userID: credential?.userID)
            return
        }
        let fence = uiGeneration
        let expectedCredential = credential
        let knownGeneration = serviceGeneration
        // Learn a new service's revision before sending a mutation; an old
        // service's late response cannot bind the replacement service.
        let pending = knownGeneration == nil ? nil : mutation
        let operation = pending?.operation ?? (wantsRefresh && knownGeneration != nil ? "refresh" : "status")
        let requestID = pending?.requestID ?? UUID()
        let requestRevision = pending?.revision ?? max(1, revision)
        let refreshWasRequested = wantsRefresh
        do {
            var fields: [String: Any] = [:]
            if operation == "update", let expectedCredential {
                fields = ["user_id": expectedCredential.userID.uuidString.lowercased(), "access_token": expectedCredential.accessToken]
            }
            let data = try StrictJSONTransport.data(forJSONObject: ["schema_version": 1,
                "request_id": requestID.uuidString.lowercased(), "auth_token": owned.credential,
                "operation": operation, "revision": requestRevision, "payload": fields])
            guard let requestStartedAt = observeMonotonicInstant() else {
                throw PetModelError.invalid("product_access_clock")
            }
            let response = try await transport.request(type: "product_access_v1", payload: data)
            guard !stopped, uiGeneration == fence, ownedAccess() == owned, owner == owned,
                  credential == expectedCredential else { return }
            guard let receivedAt = observeMonotonicInstant(), receivedAt >= requestStartedAt else {
                throw PetModelError.invalid("product_access_clock")
            }
            let reply = try decode(response, requestID: requestID)
            if knownGeneration != reply.generation {
                serviceGeneration = reply.generation
                serviceRevision = reply.revision
                revision = max(revision, reply.revision)
                uiGeneration &+= 1
                publish(credential == nil ? .signedOut : .checking, userID: credential?.userID)
                if credential != nil || mutation != nil {
                    _ = advanceMutation(nextCredentialOperation)
                    needsTick = true
                }
                return
            }
            guard reply.revision >= serviceRevision else { throw PetModelError.invalid("product_access_revision") }
            serviceRevision = reply.revision
            if let pending {
                if reply.revision != pending.revision {
                    _ = advanceMutation(nextCredentialOperation)
                    publish(credential == nil ? .signedOut : .checking, userID: credential?.userID)
                    needsTick = true
                    return
                }
                if pending.operation == "clear" {
                    guard reply.state == .signedOut, reply.userID == nil, reply.remaining == 0 else {
                        throw PetModelError.invalid("product_access_clear_ack")
                    }
                }
                mutation = nil
            }
            revision = max(revision, reply.revision)
            if refreshWasRequested { wantsRefresh = false }
            if pending?.operation == "clear", credential != nil {
                _ = advanceMutation("update")
                publish(.checking, userID: credential?.userID)
                needsTick = true
                return
            }
            guard let credential else {
                publish(.signedOut, userID: nil)
                return
            }
            guard reply.userID == nil || reply.userID == credential.userID else {
                throw PetModelError.invalid("product_access_identity")
            }
            if reply.state == .active {
                guard reply.userID == credential.userID, reply.remaining > 0 else {
                    throw PetModelError.invalid("product_access_grant")
                }
                // The service rounds remaining_seconds UP. Start the proven
                // lower-bound budget at request admission, not response arrival:
                // transport delay and up to one second of rounding cannot renew
                // an expired grant. A genuine newer grant can still extend it.
                let (budget, budgetOverflow) = UInt64(reply.remaining - 1)
                    .multipliedReportingOverflow(by: 1_000_000_000)
                let (deadline, deadlineOverflow) = requestStartedAt.addingReportingOverflow(budget)
                guard !budgetOverflow, !deadlineOverflow else {
                    throw PetModelError.invalid("product_access_deadline")
                }
                if deadline <= receivedAt {
                    publish(.expired, userID: reply.userID)
                } else {
                    publish(.active, userID: reply.userID, deadline: deadline)
                }
            } else {
                publish(reply.state, userID: reply.userID)
            }
        } catch {
            guard !stopped, uiGeneration == fence, ownedAccess() == owned, credential == expectedCredential else { return }
            publish(.unavailable, userID: credential?.userID)
        }
    }

    private func replaceOwner(_ value: PetProviderServiceAccess?) {
        uiGeneration &+= 1
        actionGeneration &+= 1
        owner = value
        serviceGeneration = nil
        serviceRevision = 0
        if credential != nil || mutation != nil { _ = advanceMutation(nextCredentialOperation) }
        publish(credential == nil ? .signedOut : .checking, userID: credential?.userID)
    }

    private var nextCredentialOperation: String {
        mutation?.operation == "clear" || credential == nil ? "clear" : "update"
    }

    @discardableResult
    private func advanceMutation(_ operation: String) -> Bool {
        let base = max(revision, serviceRevision)
        guard base < Int.max else {
            mutation = nil
            publish(.unavailable, userID: credential?.userID)
            return false
        }
        revision = base + 1
        mutation = .init(operation: operation, revision: revision, requestID: UUID())
        return true
    }

    private func publish(_ next: PetAccessState, userID nextUserID: UUID?, deadline nextDeadline: UInt64? = nil) {
        let previouslyAllowed = allowsActions
        let previousUser = userID
        expiry?.cancel(); expiry = nil
        grantDeadline = nil
        var publishedState = next
        if next == .active {
            if let deadline = nextDeadline, let instant = observeMonotonicInstant() {
                if deadline > instant {
                    grantDeadline = deadline
                    grantClockInvalidated = false
                } else {
                    publishedState = .expired
                }
            } else {
                publishedState = .unavailable
            }
        }
        userID = nextUserID
        state = publishedState
        if previouslyAllowed != allowsActions || previousUser != nextUserID { actionGeneration &+= 1 }
        onChange?()
        if publishedState == .active, automaticPolling, let deadline = grantDeadline {
            let sleep = sleep
            expiry = Task { [weak self] in
                while !Task.isCancelled {
                    guard self?.grantDeadline == deadline,
                          let remaining = self?.remainingNanoseconds else { return }
                    guard remaining > 0 else {
                        self?.publish(.expired, userID: self?.userID)
                        return
                    }
                    do { try await sleep(TimeInterval(remaining) / 1_000_000_000) }
                    catch { return }
                    // A timer can wake early. Recheck the current deadline and
                    // sleep only its remainder instead of expiring prematurely.
                }
            }
        }
    }

    private func requestTick() {
        guard automaticPolling, started, !stopped else { return }
        timer?.cancel(); timer = nil
        guard worker == nil else { needsTick = true; return }
        needsTick = false
        worker = Task { [weak self] in
            guard let self else { return }
            await self.synchronize()
            self.worker = nil
            guard !self.stopped else { return }
            if self.needsTick { self.requestTick() }
            else { self.schedulePoll() }
        }
    }

    private func schedulePoll() {
        guard automaticPolling, started, !stopped else { return }
        let delay = pollInterval, sleep = sleep
        timer = Task { [weak self] in
            do { try await sleep(delay) } catch { return }
            guard !Task.isCancelled else { return }
            self?.timer = nil
            self?.requestTick()
        }
    }

    private func decode(_ data: Data, requestID: UUID) throws -> Reply {
        let value = try StrictJSONTransport.object(from: data)
        guard Set(value.keys) == ["schema_version", "request_id", "revision", "service_generation", "state", "user_id", "remaining_seconds"],
              ExactJSONInteger.int64(value["schema_version"]) == 1,
              value["request_id"] as? String == requestID.uuidString.lowercased(),
              let revision = ExactJSONInteger.int64(value["revision"], minimum: 0), revision <= Int64(Int.max),
              let rawGeneration = value["service_generation"] as? String, let generation = UUID(uuidString: rawGeneration),
              let rawState = value["state"] as? String, let state = PetAccessState(rawValue: rawState),
              let remaining = ExactJSONInteger.int64(value["remaining_seconds"], minimum: 0), remaining <= 300 else {
            throw PetModelError.invalid("product_access_response")
        }
        let userID: UUID?
        if value["user_id"] is NSNull { userID = nil }
        else if let text = value["user_id"] as? String, let id = UUID(uuidString: text) { userID = id }
        else { throw PetModelError.invalid("product_access_identity") }
        guard state != .active || (remaining > 0 && userID != nil) else { throw PetModelError.invalid("product_access_grant") }
        return Reply(revision: Int(revision), generation: generation, state: state, userID: userID, remaining: Int(remaining))
    }
}

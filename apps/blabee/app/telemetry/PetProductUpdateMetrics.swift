import Foundation

/// Local provenance for one observed update. The journal job ID never enters a
/// telemetry payload; its separate operation ID is generated only for metrics.
struct PetProductUpdateMarker: Codable, Equatable, Sendable {
    static let maximumAge: TimeInterval = 7 * 24 * 60 * 60
    let schema: Int
    let identity: PetProductIdentity
    let operationID: UUID
    let occurredAt: Date
    let environment: PetProductEnvironment
    let targetVersion: String
    let targetBuild: String
    var journalJobID: String?

    func payload(_ kind: PetProductMetricKind) -> PetProductMetricPayload {
        .init(kind: kind, occurredAt: occurredAt, operationID: operationID,
              feature: .appUpdate, environment: environment,
              targetVersion: targetVersion, targetBuild: targetBuild)
    }

    func isValid(at instant: Date) -> Bool {
        schema == 1 && UUID(uuidString: identity.userID)?.uuidString.lowercased() == identity.userID
            && instant.timeIntervalSince1970.isFinite && occurredAt.timeIntervalSince1970.isFinite
            && occurredAt >= instant.addingTimeInterval(-Self.maximumAge)
            && occurredAt <= instant.addingTimeInterval(300)
            && PetAppUpdateVersion(version: targetVersion, build: targetBuild) != nil
            && PetProductEnvironment.normalizedVersion(targetVersion) == targetVersion
            && PetProductEnvironment.normalizedVersion(targetBuild) == targetBuild
            && (journalJobID == nil || UUID(uuidString: journalJobID!)?.uuidString.lowercased() == journalJobID)
            && payload(.updateStarted).isValid
    }
}

@MainActor
protocol PetProductUpdateMarkerStoring {
    func load() -> Data?
    func save(_ data: Data)
    func clear()
}

@MainActor
struct PetProductUpdateDefaultsStore: PetProductUpdateMarkerStoring {
    static let preferenceKey = "blabee.usageAnalytics.productUpdateMarker.v2"
    let defaults: UserDefaults

    func load() -> Data? { defaults.data(forKey: Self.preferenceKey) }
    func save(_ data: Data) { defaults.set(data, forKey: Self.preferenceKey) }
    func clear() { defaults.removeObject(forKey: Self.preferenceKey) }
}

/// The updater supplies only this narrow local observation. It never gives the
/// analytics queue a journal, session list, path, URL, or diagnostic message.
struct PetProductUpdateObservation: Equatable, Sendable {
    enum Result: Equatable, Sendable { case pending, targetRunning, failed }
    let journalJobID: String
    let targetVersion: String
    let targetBuild: String
    let result: Result
}

@MainActor
final class PetProductUpdateMetrics {
    static let maximumMarkerBytes = 4_096
    private let analytics: PetUsageAnalytics
    private let store: any PetProductUpdateMarkerStoring
    private let now: @MainActor () -> Date
    private let makeOperationID: @MainActor () -> UUID
    private var marker: PetProductUpdateMarker?
    private var activeContext: PetUsageContext?

    static func live(analytics: PetUsageAnalytics) -> PetProductUpdateMetrics {
        .init(analytics: analytics, store: PetProductUpdateDefaultsStore(defaults: .standard))
    }

    init(analytics: PetUsageAnalytics, store: any PetProductUpdateMarkerStoring,
         now: @escaping @MainActor () -> Date = Date.init,
         makeOperationID: @escaping @MainActor () -> UUID = UUID.init) {
        self.analytics = analytics
        self.store = store
        self.now = now
        self.makeOperationID = makeOperationID
        if let data = store.load(), data.count <= Self.maximumMarkerBytes,
           let loaded = try? JSONDecoder().decode(PetProductUpdateMarker.self, from: data),
           loaded.isValid(at: now()), analytics.isEnabled {
            marker = loaded
        } else {
            store.clear()
        }
    }

    /// Called when the user starts downloading/verifying a proposed update.
    /// Enabling collection later never creates an attempt for existing work.
    @discardableResult
    func start(target: PetAppUpdateVersion) -> UUID? {
        if let active = marker, activeContext != nil {
            finish(.cancelled, operationID: active.operationID)
        } else {
            clear()
        }
        guard let context = analytics.captureContext(), let identity = analytics.productIdentity else { return nil }
        let candidate = PetProductUpdateMarker(schema: 1, identity: identity,
            operationID: makeOperationID(), occurredAt: now(), environment: analytics.productEnvironment,
            targetVersion: target.version, targetBuild: target.build, journalJobID: nil)
        guard candidate.isValid(at: now()) else { return nil }
        marker = candidate
        activeContext = context
        persist(candidate)
        analytics.recordProduct(candidate.payload(.updateStarted), context: context)
        return candidate.operationID
    }

    /// Match only the installer job created by this observed operation.
    func attachJournal(_ jobID: String, operationID: UUID?) {
        guard let operationID, var current = currentMarker(), current.operationID == operationID,
              UUID(uuidString: jobID)?.uuidString.lowercased() == jobID else { return }
        current.journalJobID = jobID
        marker = current
        persist(current)
    }

    /// A helper becoming ready is deliberately not an outcome. Only explicit
    /// cancellation/failure can finish in the source process.
    func finish(_ outcome: PetProductOutcome, operationID: UUID?) {
        guard outcome != .succeeded, let operationID, let current = currentMarker(),
              current.operationID == operationID else { return }
        let context = activeContext
        clear()
        guard analytics.productIdentity == current.identity, let context else { return }
        let kind: PetProductMetricKind = outcome == .cancelled ? .updateCancelled : .updateFailed
        analytics.recordProduct(current.payload(kind), context: context)
    }

    /// Run after verified authentication/consent and at update-result refresh.
    /// Old journals without our marker cannot become new analytics events.
    func recover(observe: (String) -> PetProductUpdateObservation?) {
        guard let current = currentMarker() else { return }
        guard let identity = analytics.productIdentity else { return }
        guard identity == current.identity else { clear(); return }
        guard let jobID = current.journalJobID else {
            // A restart during preparation leaves an unknown outcome, not a failure.
            if activeContext == nil { clear() }
            return
        }
        guard let observation = observe(jobID), observation.journalJobID == jobID,
              observation.targetVersion == current.targetVersion,
              observation.targetBuild == current.targetBuild else { return }
        let kind: PetProductMetricKind
        switch observation.result {
        case .pending: return
        case .targetRunning: kind = .updateSucceeded
        case .failed: kind = .updateFailed
        }
        let context = activeContext ?? analytics.captureContext()
        // Remove before enqueueing: restart/repeated reads must not replay an outcome.
        clear()
        guard let context else { return }
        analytics.recordProduct(current.payload(kind), context: context)
    }

    /// Explicit logout discards provenance immediately; temporary authentication
    /// checks instead call recover and retain it until the same account returns.
    func clearIdentity() { clear() }

    private func currentMarker() -> PetProductUpdateMarker? {
        guard let current = marker else { return nil }
        guard analytics.isEnabled, current.isValid(at: now()) else { clear(); return nil }
        if let identity = analytics.productIdentity, identity != current.identity { clear(); return nil }
        return current
    }

    private func persist(_ value: PetProductUpdateMarker) {
        guard let data = try? JSONEncoder().encode(value), data.count <= Self.maximumMarkerBytes else { return }
        store.save(data)
    }

    private func clear() {
        marker = nil
        activeContext = nil
        store.clear()
    }
}

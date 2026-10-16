import Combine
import Darwin
import Foundation

enum PetUsageEventKind: String, CaseIterable, Codable, Sendable {
    case choiceAccepted = "choice_accepted"
    case approvalResolved = "approval_resolved"
    case suggestionDismissed = "suggestion_dismissed"
    case productMetric = "product_metric"
    case insightMetric = "insight_metric"
}

// Deliberately not Codable: credentials belong only to the current send attempt.
struct PetUsageAuthorization: Sendable {
    let userID: String
    let accessToken: String
    let expiresAt: Date
}

struct PetUsageEvent: Codable, Equatable, Sendable {
    let userID: String
    let eventID: UUID
    let kind: PetUsageEventKind
    let occurredAt: Date
    let product: PetProductMetricPayload?
    let insight: PetInsightMetricPayload?

    init(userID: String, eventID: UUID, kind: PetUsageEventKind, occurredAt: Date,
         product: PetProductMetricPayload? = nil, insight: PetInsightMetricPayload? = nil) {
        self.userID = userID
        self.eventID = eventID
        self.kind = kind
        self.occurredAt = occurredAt
        self.product = product
        self.insight = insight
    }

    var hasValidPayload: Bool {
        if kind == .productMetric {
            return insight == nil && product?.isValid == true && product?.occurredAt == occurredAt
        }
        if kind == .insightMetric {
            return product == nil && insight?.isValid == true && insight?.occurredAt == occurredAt
        }
        return product == nil && insight == nil
    }
}

struct PetUsageContext: Equatable, Sendable {
    fileprivate let userID: String
    fileprivate let epoch: UInt64
}

enum PetUsageDelivery: Sendable { case accepted, discard, retry, waitForAuthorization }

@MainActor
protocol PetUsageSending {
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery
}

@MainActor
protocol PetUsageEventStoring {
    func load() throws -> [PetUsageEvent]
    func save(_ events: [PetUsageEvent]) throws
    func clear() throws
    func invalidate() throws
}

extension PetUsageEventStoring {
    // In-memory stores can erase directly. The live file store is wrapped in a
    // persisted generation so a failed unlink cannot revive invalidated events.
    func invalidate() throws { try clear() }
}

/// Optional, best-effort counts and fixed product metrics. It never controls
/// whether an action succeeds or records user content or background runtime.
@MainActor
final class PetUsageAnalytics: ObservableObject {
    // New collection categories require fresh consent; legacy opt-in is ignored.
    static let enabledPreferenceKey = "blabee.usageAnalytics.enabled.v3"
    static let outboxGenerationPreferenceKey = "blabee.usageAnalytics.outboxGeneration"
    static let consentIDPreferenceKey = "blabee.usageAnalytics.consentID.v3"
    static let productIdentityPreferenceKey = "blabee.usageAnalytics.identity.v3"
    static let maximumEventCount = 256
    static let maximumEventAge: TimeInterval = 7 * 24 * 60 * 60

    @Published private(set) var isEnabled: Bool
    var onConsentChanged: (() -> Void)?
    private let productEnvironmentOverride: PetProductEnvironment?
    var productEnvironment: PetProductEnvironment { productEnvironmentOverride ?? .current }

    private let authorization: @MainActor () -> PetUsageAuthorization?
    private let store: any PetUsageEventStoring
    private let service: any PetUsageSending
    private let savePreference: @MainActor (Bool) -> Void
    private let now: @MainActor () -> Date
    private let sleep: @MainActor (TimeInterval) async throws -> Void
    private let makeEventID: @MainActor () -> UUID
    private let monotonicNow: @MainActor () -> TimeInterval
    private let saveConsentID: @MainActor (UUID) -> Void
    private let saveProductIdentity: @MainActor (PetProductIdentity?) -> Void
    private var consentID: UUID
    private var persistedProductOwner: String?
    private var productObservations = Set<PetProductMetricKind>()
    private var environmentObservedDay: Int?
    private var updateObservedDay: Int?
    private var observedUpdateTargets = Set<String>()
    private var productOperations: [UUID: PetProductOperation] = [:]
    private var connectionObservedDay: Int?
    private var observedConnections = Set<String>()
    private var insightTrackers: [PetInsightWeakCardTracker] = []
    private var events: [PetUsageEvent] = []
    private var owner: String?
    private var authorizationBlocked = false
    private var isStopped = false
    private var generation: UInt64 = 0
    private var contextEpoch: UInt64 = 0
    private var flushTask: Task<Void, Never>?
    private var nextRetryDelay: TimeInterval = 30

    static func live(defaults: UserDefaults = .standard,
                     authorization: @escaping @MainActor () -> PetUsageAuthorization?) -> PetUsageAnalytics {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/BlabeeUsage", isDirectory: true)
        let generation = defaults.string(forKey: outboxGenerationPreferenceKey).flatMap(UUID.init(uuidString:)) ?? UUID()
        let store = PetUsageGenerationStore(generation: generation, saveGeneration: {
            defaults.set($0.uuidString, forKey: outboxGenerationPreferenceKey)
        }, makeStore: { PetUsageFileStore(directory: directory, generation: $0) })
        let consentID = defaults.string(forKey: consentIDPreferenceKey).flatMap(UUID.init(uuidString:)) ?? UUID()
        let identity = defaults.data(forKey: productIdentityPreferenceKey).flatMap {
            try? JSONDecoder().decode(PetProductIdentity.self, from: $0)
        }
        return PetUsageAnalytics(
            isEnabled: defaults.bool(forKey: enabledPreferenceKey),
            authorization: authorization, store: store,
            service: PetSupabaseUsageService(),
            savePreference: { defaults.set($0, forKey: enabledPreferenceKey) },
            consentID: consentID, persistedProductIdentity: identity,
            saveConsentID: { defaults.set($0.uuidString, forKey: consentIDPreferenceKey) },
            saveProductIdentity: { identity in
                if let identity, let data = try? JSONEncoder().encode(identity) {
                    defaults.set(data, forKey: productIdentityPreferenceKey)
                } else { defaults.removeObject(forKey: productIdentityPreferenceKey) }
            }
        )
    }

    init(
        isEnabled: Bool = false,
        authorization: @escaping @MainActor () -> PetUsageAuthorization?,
        store: any PetUsageEventStoring,
        service: any PetUsageSending,
        savePreference: @escaping @MainActor (Bool) -> Void = { _ in },
        now: @escaping @MainActor () -> Date = Date.init,
        sleep: @escaping @MainActor (TimeInterval) async throws -> Void = { delay in
            try await Task.sleep(for: .seconds(delay))
        },
        makeEventID: @escaping @MainActor () -> UUID = UUID.init,
        productEnvironment: PetProductEnvironment? = nil,
        monotonicNow: @escaping @MainActor () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        consentID: UUID = UUID(),
        persistedProductIdentity: PetProductIdentity? = nil,
        saveConsentID: @escaping @MainActor (UUID) -> Void = { _ in },
        saveProductIdentity: @escaping @MainActor (PetProductIdentity?) -> Void = { _ in }
    ) {
        self.isEnabled = isEnabled
        self.authorization = authorization
        self.store = store
        self.service = service
        self.savePreference = savePreference
        self.now = now
        self.sleep = sleep
        self.makeEventID = makeEventID
        self.productEnvironmentOverride = productEnvironment
        self.monotonicNow = monotonicNow
        self.consentID = consentID
        self.saveConsentID = saveConsentID
        self.saveProductIdentity = saveProductIdentity
        self.persistedProductOwner = persistedProductIdentity.flatMap {
            $0.consentID == consentID ? UUID(uuidString: $0.userID)?.uuidString.lowercased() : nil
        }
        saveConsentID(consentID)
        if isEnabled {
            events = (try? store.load()) ?? []
            prune()
        } else {
            try? store.invalidate()
        }
        accountStateChanged()
    }

    func setEnabled(_ enabled: Bool) {
        guard !isStopped, isEnabled != enabled else { return }
        isEnabled = enabled
        savePreference(enabled)
        if enabled { accountStateChanged() }
        else { clearIdentity() }
        onConsentChanged?()
    }

    func record(_ kind: PetUsageEventKind) {
        guard let context = captureContext() else { return }
        record(kind, context: context)
    }

    func captureContext() -> PetUsageContext? {
        guard isEnabled, !isStopped, let auth = currentAuthorization() else { return nil }
        adoptOwner(auth.userID)
        return PetUsageContext(userID: auth.userID, epoch: contextEpoch)
    }

    /// Capture before awaiting the product action, and record only after its
    /// acknowledgment. Consent and identity must belong to that same operation.
    func record(_ kind: PetUsageEventKind, context: PetUsageContext) {
        guard kind != .productMetric, kind != .insightMetric,
              isEnabled, !isStopped, let auth = currentAuthorization() else { return }
        adoptOwner(auth.userID)
        guard context.userID == auth.userID, context.epoch == contextEpoch else { return }
        prune()
        events.append(PetUsageEvent(userID: auth.userID, eventID: makeEventID(), kind: kind, occurredAt: now()))
        if events.count > Self.maximumEventCount { events.removeFirst(events.count - Self.maximumEventCount) }
        trimToStorageBudget()
        persist()
        beginFlushing()
    }

    var productIdentity: PetProductIdentity? {
        guard let context = captureContext() else { return nil }
        return PetProductIdentity(userID: context.userID, consentID: consentID)
    }

    func observeEnvironment() {
        guard let context = captureContext() else { return }
        let date = now()
        guard PetUsageValidation.isDate(date) else { return }
        let day = Int(floor(date.timeIntervalSince1970 / 86_400))
        guard environmentObservedDay != day else { return }
        environmentObservedDay = day
        recordProduct(.init(kind: .environmentObserved, occurredAt: date, environment: productEnvironment), context: context)
    }

    /// Called only for a currently observed, consented stage, never to recreate
    /// the account's earlier setup history. Server first dates deduplicate launches.
    func observeMilestone(_ kind: PetProductMetricKind) {
        guard let context = captureContext() else { return }
        observeMilestone(kind, context: context)
    }

    func observeMilestone(_ kind: PetProductMetricKind, context: PetUsageContext) {
        guard kind.isMilestone, isCurrent(context), productObservations.insert(kind).inserted else { return }
        recordProduct(.init(kind: kind, occurredAt: now(), environment: productEnvironment), context: context)
    }

    func observeUpdateAvailable(version: String, build: String, context: PetUsageContext) {
        guard isCurrent(context) else { return }
        let date = now()
        guard PetUsageValidation.isDate(date) else { return }
        let day = Int(floor(date.timeIntervalSince1970 / 86_400))
        if updateObservedDay != day {
            updateObservedDay = day
            observedUpdateTargets.removeAll()
        }
        let version = PetProductEnvironment.normalizedVersion(version)
        let build = PetProductEnvironment.normalizedVersion(build)
        let key = "\(version):\(build)"
        guard observedUpdateTargets.count < Self.maximumEventCount, observedUpdateTargets.insert(key).inserted else { return }
        recordProduct(.init(kind: .updateAvailable, occurredAt: date, feature: .appUpdate,
            environment: productEnvironment, targetVersion: version, targetBuild: build), context: context)
    }

    func recordProduct(_ payload: PetProductMetricPayload, context: PetUsageContext) {
        guard payload.isValid, isCurrent(context) else { return }
        let instant = now()
        guard payload.occurredAt >= instant.addingTimeInterval(-Self.maximumEventAge),
              payload.occurredAt <= instant.addingTimeInterval(300) else { return }
        prune()
        events.append(PetUsageEvent(userID: context.userID, eventID: makeEventID(), kind: .productMetric,
                                    occurredAt: payload.occurredAt, product: payload))
        if events.count > Self.maximumEventCount { events.removeFirst(events.count - Self.maximumEventCount) }
        trimToStorageBudget()
        persist()
        beginFlushing()
    }

    @discardableResult
    func recordInsight(_ payload: PetInsightMetricPayload, context: PetUsageContext) -> Bool {
        guard payload.isValid, isCurrent(context) else { return false }
        let instant = now()
        guard payload.occurredAt >= instant.addingTimeInterval(-Self.maximumEventAge),
              payload.occurredAt <= instant.addingTimeInterval(300) else { return false }
        prune()
        events.append(PetUsageEvent(userID: context.userID, eventID: makeEventID(), kind: .insightMetric,
                                    occurredAt: payload.occurredAt, insight: payload))
        if events.count > Self.maximumEventCount { events.removeFirst(events.count - Self.maximumEventCount) }
        trimToStorageBudget()
        persist()
        beginFlushing()
        return true
    }

    func observeConnection(codexVersion: String = "unknown", mode: PetInsightConnectionMode = .unknown,
                           compatibility: PetInsightCompatibility = .unknown, context: PetUsageContext) {
        guard mode != .none, compatibility != .none, isCurrent(context) else { return }
        let date = now()
        guard PetUsageValidation.isDate(date) else { return }
        let day = Int(floor(date.timeIntervalSince1970 / 86_400))
        if connectionObservedDay != day {
            connectionObservedDay = day
            observedConnections.removeAll()
        }
        let version = PetProductEnvironment.normalizedVersion(codexVersion)
        let key = "\(version):\(mode.rawValue):\(compatibility.rawValue)"
        guard observedConnections.count < Self.maximumEventCount, observedConnections.insert(key).inserted else { return }
        recordInsight(.init(kind: .connectionObserved, occurredAt: date, environment: productEnvironment,
                            codexVersion: version, connectionMode: mode, compatibility: compatibility), context: context)
    }

    func registerInsightTracker(_ tracker: PetInsightCardTracker) {
        insightTrackers.removeAll { $0.value == nil }
        insightTrackers.append(PetInsightWeakCardTracker(tracker))
    }

    private func resetInsightTrackers() {
        insightTrackers.removeAll { $0.value == nil }
        insightTrackers.forEach { $0.value?.reset() }
    }

    func beginFeature(feature: PetProductFeature, inputMethod: PetProductInputMethod) -> PetProductOperation? {
        guard [.choice, .approval, .dismiss].contains(feature), [.button, .keyboard].contains(inputMethod),
              let context = captureContext() else { return nil }
        let operation = PetProductOperation(context: context, operationID: makeEventID(), occurredAt: now(),
            startedAtUptime: monotonicNow(), feature: feature, inputMethod: inputMethod, environment: productEnvironment)
        if productOperations.count >= Self.maximumEventCount,
           let oldest = productOperations.values.min(by: { $0.occurredAt < $1.occurredAt }) {
            productOperations.removeValue(forKey: oldest.operationID)
        }
        productOperations[operation.operationID] = operation
        recordProduct(.init(kind: .featureStarted, occurredAt: operation.occurredAt, operationID: operation.operationID,
            feature: feature, inputMethod: inputMethod, environment: operation.environment), context: context)
        return operation
    }

    func finishFeature(_ operation: PetProductOperation?, outcome: PetProductOutcome) {
        guard let supplied = operation,
              let operation = productOperations.removeValue(forKey: supplied.operationID),
              operation.context == supplied.context else { return }
        guard isCurrent(operation.context) else { return }
        let kind: PetProductMetricKind
        switch outcome {
        case .succeeded: kind = .featureSucceeded
        case .failed: kind = .featureFailed
        case .cancelled: kind = .featureCancelled
        }
        let bucket = PetProductLatencyBucket.elapsed(monotonicNow() - operation.startedAtUptime)
        recordProduct(.init(kind: kind, occurredAt: operation.occurredAt, operationID: operation.operationID,
            feature: operation.feature, inputMethod: operation.inputMethod, latencyBucket: bucket,
            environment: operation.environment), context: operation.context)
    }

    private func isCurrent(_ context: PetUsageContext) -> Bool {
        guard isEnabled, !isStopped, let auth = currentAuthorization() else { return false }
        adoptOwner(auth.userID)
        return context.userID == auth.userID && context.epoch == contextEpoch
    }

    /// A temporarily unverified/expired session pauses delivery. Explicit logout
    /// must use clearIdentity(), including the transition into signingOut.
    func accountStateChanged() {
        guard !isStopped else { return }
        prune()
        guard isEnabled, let auth = currentAuthorization() else {
            cancelFlush()
            return
        }
        adoptOwner(auth.userID)
        authorizationBlocked = false
        beginFlushing()
    }

    func clearIdentity() {
        contextEpoch &+= 1
        cancelFlush()
        owner = nil
        authorizationBlocked = false
        events.removeAll()
        rotateProductIdentity()
        try? store.invalidate()
    }

    func stop() {
        isStopped = true
        contextEpoch &+= 1
        resetInsightTrackers()
        cancelFlush()
    }

    private func currentAuthorization() -> PetUsageAuthorization? {
        let instant = now()
        guard instant.timeIntervalSince1970.isFinite,
              let value = authorization(), let userID = UUID(uuidString: value.userID),
              value.expiresAt.timeIntervalSince1970.isFinite, value.expiresAt > instant,
              PetUsageValidation.isHeaderValue(value.accessToken)
        else { return nil }
        return PetUsageAuthorization(userID: userID.uuidString.lowercased(), accessToken: value.accessToken,
                                     expiresAt: value.expiresAt)
    }

    private func adoptOwner(_ userID: String) {
        guard owner != userID else { return }
        if owner != nil || events.contains(where: { $0.userID.caseInsensitiveCompare(userID) != .orderedSame }) {
            try? store.invalidate()
        }
        if let previous = persistedProductOwner, previous != userID { rotateProductIdentity() }
        contextEpoch &+= 1
        cancelFlush()
        owner = userID
        persistedProductOwner = userID
        saveProductIdentity(PetProductIdentity(userID: userID, consentID: consentID))
        authorizationBlocked = false
        events.removeAll { $0.userID.caseInsensitiveCompare(userID) != .orderedSame }
        persist()
    }

    private func rotateProductIdentity() {
        consentID = UUID()
        saveConsentID(consentID)
        persistedProductOwner = nil
        saveProductIdentity(nil)
        productObservations.removeAll()
        environmentObservedDay = nil
        updateObservedDay = nil
        observedUpdateTargets.removeAll()
        productOperations.removeAll()
        connectionObservedDay = nil
        observedConnections.removeAll()
        resetInsightTrackers()
    }

    private func prune() {
        let instant = now()
        let prior = events
        var seen = Set<UUID>()
        events = events.filter {
            UUID(uuidString: $0.userID) != nil
                && $0.hasValidPayload
                && PetUsageValidation.isDate($0.occurredAt)
                && $0.occurredAt >= instant.addingTimeInterval(-Self.maximumEventAge)
                && $0.occurredAt <= instant.addingTimeInterval(300)
                && seen.insert($0.eventID).inserted
        }
        events = Array(events.suffix(Self.maximumEventCount))
        trimToStorageBudget()
        if events != prior { persist() }
    }

    private func trimToStorageBudget() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        while !events.isEmpty,
              ((try? encoder.encode(events).count) ?? Int.max) > PetUsageFileStore.maximumBytes {
            events.removeFirst()
        }
    }

    private func persist() {
        if events.isEmpty { try? store.clear() }
        else { try? store.save(events) }
    }

    private func cancelFlush() {
        generation &+= 1
        flushTask?.cancel()
        // Retain the slot until the cancelled attempt actually finishes, even
        // when a transport ignores cancellation. A new identity cannot overlap it.
        nextRetryDelay = 30
    }

    private func beginFlushing() {
        guard flushTask == nil, isEnabled, !isStopped, !authorizationBlocked,
              !events.isEmpty, currentAuthorization() != nil else { return }
        let attemptGeneration = generation
        flushTask = Task { [weak self] in
            guard let self else { return }
            await flush(generation: attemptGeneration)
            flushTask = nil
            if generation != attemptGeneration { beginFlushing() }
        }
    }

    private func flush(generation attemptGeneration: UInt64) async {
        while isEnabled, !isStopped, generation == attemptGeneration, !Task.isCancelled {
            prune()
            guard let auth = currentAuthorization(), let event = events.first else { return }
            guard event.userID.caseInsensitiveCompare(auth.userID) == .orderedSame else {
                adoptOwner(auth.userID)
                return
            }
            let result: PetUsageDelivery
            do {
                result = try await service.send(event, authorization: auth)
            } catch {
                guard !Task.isCancelled, generation == attemptGeneration else { return }
                // Unexpected analytics/transport errors are also best effort.
                result = .retry
            }
            guard !Task.isCancelled, generation == attemptGeneration, isEnabled, !isStopped else { return }
            guard let current = currentAuthorization(), current.userID == auth.userID else { return }
            switch result {
            case .accepted, .discard:
                events.removeAll { $0.eventID == event.eventID }
                persist()
                nextRetryDelay = 30
            case .waitForAuthorization:
                authorizationBlocked = true
                return
            case .retry:
                let delay = nextRetryDelay
                nextRetryDelay = min(300, nextRetryDelay * 2)
                do { try await sleep(delay) }
                catch { return }
            }
        }
    }
}

@MainActor
final class PetSupabaseUsageService: PetUsageSending {
    private let configuration: PetAccountConfiguration
    private let transport: PetAccountHTTPTransport
    private let now: @MainActor () -> Date

    init(
        configuration: PetAccountConfiguration = .current,
        transport: PetAccountHTTPTransport? = nil,
        now: @escaping @MainActor () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.now = now
        if let transport { self.transport = transport }
        else {
            let client = PetAccountHTTPClient()
            self.transport = { try await client.send($0) }
        }
    }

    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        guard let owner = UUID(uuidString: authorization.userID),
              authorization.expiresAt > now(),
              PetUsageValidation.isHeaderValue(authorization.accessToken)
        else { return .waitForAuthorization }
        guard UUID(uuidString: event.userID) == owner, PetUsageValidation.isDate(event.occurredAt), event.hasValidPayload,
              var parts = URLComponents(url: configuration.supabaseURL, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.query == nil, parts.fragment == nil, parts.path.isEmpty || parts.path == "/",
              PetUsageValidation.isHeaderValue(configuration.publishableKey)
        else { return .discard }
        switch event.kind {
        case .productMetric: parts.path = "/rest/v1/rpc/record_blabee_product_event"
        case .insightMetric: parts.path = "/rest/v1/rpc/record_blabee_insight_event"
        default: parts.path = "/rest/v1/rpc/record_blabee_usage"
        }
        guard let url = parts.url else { return .discard }

        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let payload: [String: Any]
        if let insight = event.insight {
            payload = [
                "p_event_id": event.eventID.uuidString.lowercased(),
                "p_occurred_at": formatter.string(from: event.occurredAt),
                "p_metric_kind": insight.kind.rawValue,
                "p_card_id": insight.cardID.map { $0.uuidString.lowercased() as Any } ?? NSNull(),
                "p_card_kind": insight.cardKind.rawValue,
                "p_response": insight.response.rawValue,
                "p_reaction_bucket": insight.reactionBucket.rawValue,
                "p_app_version": insight.environment.appVersion,
                "p_app_build": insight.environment.appBuild,
                "p_os_major": insight.environment.osMajor,
                "p_ui_language": insight.environment.uiLanguage.rawValue,
                "p_codex_version": insight.codexVersion,
                "p_connection_mode": insight.connectionMode.rawValue,
                "p_compatibility": insight.compatibility.rawValue,
            ]
        } else if let product = event.product {
            payload = [
                "p_event_id": event.eventID.uuidString.lowercased(),
                "p_occurred_at": formatter.string(from: event.occurredAt),
                "p_metric_kind": product.kind.rawValue,
                "p_operation_id": product.operationID.map { $0.uuidString.lowercased() as Any } ?? NSNull(),
                "p_feature": product.feature.rawValue,
                "p_input_method": product.inputMethod.rawValue,
                "p_latency_bucket": product.latencyBucket.rawValue,
                "p_app_version": product.environment.appVersion,
                "p_app_build": product.environment.appBuild,
                "p_os_major": product.environment.osMajor,
                "p_ui_language": product.environment.uiLanguage.rawValue,
                "p_target_version": product.targetVersion,
                "p_target_build": product.targetBuild,
            ]
        } else {
            payload = [
                "p_event_id": event.eventID.uuidString.lowercased(),
                "p_event_kind": event.kind.rawValue,
                "p_occurred_at": formatter.string(from: event.occurredAt),
            ]
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authorization.accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let data: Data
        let response: HTTPURLResponse
        do {
            try Task.checkCancellation()
            (data, response) = try await transport(request)
            try Task.checkCancellation()
        } catch is CancellationError { throw CancellationError() }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch { return .retry }
        guard response.url == url, data.count <= 4_096 else { return .discard }
        switch response.statusCode {
        case 200:
            // false is an already-recorded event, not a failed delivery.
            return (try? JSONDecoder().decode(Bool.self, from: data)) == nil ? .discard : .accepted
        case 401, 403: return .waitForAuthorization
        case 408, 425, 429, 500...599: return .retry
        default: return .discard
        }
    }
}

private enum PetUsageValidation {
    static func isHeaderValue(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 65_536 && value.utf8.allSatisfy { (33...126).contains($0) }
    }

    static func isDate(_ value: Date) -> Bool {
        value.timeIntervalSince1970.isFinite && (0...253_402_300_799).contains(value.timeIntervalSince1970)
    }
}

/// Keep invalidation outside the removable JSON file. A failed deletion may leave
/// an old private file, but a later launch can only read the current generation.
@MainActor
final class PetUsageGenerationStore: PetUsageEventStoring {
    private let saveGeneration: @MainActor (UUID) -> Void
    private let makeStore: @MainActor (UUID) -> any PetUsageEventStoring
    private var current: any PetUsageEventStoring

    init(
        generation: UUID,
        saveGeneration: @escaping @MainActor (UUID) -> Void,
        makeStore: @escaping @MainActor (UUID) -> any PetUsageEventStoring
    ) {
        self.saveGeneration = saveGeneration
        self.makeStore = makeStore
        self.current = makeStore(generation)
        saveGeneration(generation)
    }

    func load() throws -> [PetUsageEvent] { try current.load() }
    func save(_ events: [PetUsageEvent]) throws { try current.save(events) }
    func clear() throws { try current.clear() }
    func invalidate() throws {
        let previous = current
        let generation = UUID()
        saveGeneration(generation)
        current = makeStore(generation)
        try previous.clear()
    }
}

/// A separate private JSON outbox; no Coordinator SQLite tables or credentials.
/// Every path component is opened without following links, and each write uses a
/// new private inode and rename relative to an already-open directory descriptor.
@MainActor
final class PetUsageFileStore: PetUsageEventStoring {
    static let fileName = "pending-events.json"
    static let maximumBytes = 131_072
    private let directory: URL
    private let fileName: String

    init(directory: URL, generation: UUID? = nil) {
        self.directory = directory
        self.fileName = generation.map { "pending-\($0.uuidString.lowercased()).json" } ?? Self.fileName
    }

    func load() throws -> [PetUsageEvent] {
        guard let parent = try openDirectory(create: false) else { return [] }
        defer { close(parent) }
        let file = openat(parent, fileName, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard file >= 0 else {
            if errno == ENOENT { return [] }
            throw StoreError.unavailable
        }
        defer { close(file) }
        try validateFile(file)
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = read(file, &buffer, buffer.count)
            if count < 0, errno == EINTR { continue }
            guard count >= 0 else { throw StoreError.unavailable }
            if count == 0 { break }
            guard data.count + count <= Self.maximumBytes else { throw StoreError.unavailable }
            data.append(contentsOf: buffer.prefix(count))
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        let events = try decoder.decode([PetUsageEvent].self, from: data)
        guard events.count <= PetUsageAnalytics.maximumEventCount else { throw StoreError.unavailable }
        return events
    }

    func save(_ events: [PetUsageEvent]) throws {
        guard events.count <= PetUsageAnalytics.maximumEventCount else { throw StoreError.unavailable }
        if events.isEmpty { try clear(); return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        let data = try encoder.encode(events)
        guard data.count <= Self.maximumBytes, let parent = try openDirectory(create: true) else {
            throw StoreError.unavailable
        }
        defer { close(parent) }
        let existing = openat(parent, fileName, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        if existing >= 0 {
            defer { close(existing) }
            try validateFile(existing)
        } else if errno != ENOENT { throw StoreError.unavailable }
        let name = ".pending-\(UUID().uuidString).tmp"
        let file = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard file >= 0 else { throw StoreError.unavailable }
        defer { close(file); unlinkat(parent, name, 0) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(file, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw StoreError.unavailable }
                offset += count
            }
        }
        guard fsync(file) == 0, renameat(parent, name, parent, fileName) == 0 else {
            throw StoreError.unavailable
        }
    }

    func clear() throws {
        guard let parent = try openDirectory(create: false) else { return }
        defer { close(parent) }
        guard unlinkat(parent, fileName, 0) == 0 || errno == ENOENT else { throw StoreError.unavailable }
    }

    private func validateFile(_ descriptor: Int32) throws {
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == geteuid(), info.st_nlink == 1, info.st_mode & 0o077 == 0,
              info.st_size >= 0, info.st_size <= Self.maximumBytes else { throw StoreError.unavailable }
    }

    private func openDirectory(create: Bool) throws -> Int32? {
        guard directory.isFileURL, directory.path.hasPrefix("/") else { throw StoreError.unavailable }
        let components = directory.path.split(separator: "/").map(String.init)
        guard !components.isEmpty, components.allSatisfy({ $0 != "." && $0 != ".." }) else {
            throw StoreError.unavailable
        }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw StoreError.unavailable }
        do {
            for component in components {
                var next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0, errno == ENOENT {
                    guard create else { close(descriptor); return nil }
                    guard mkdirat(descriptor, component, 0o700) == 0 || errno == EEXIST else {
                        throw StoreError.unavailable
                    }
                    next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw StoreError.unavailable }
                close(descriptor)
                descriptor = next
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                  info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else { throw StoreError.unavailable }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private enum StoreError: Error { case unavailable }
}

import Combine
import Darwin
import Foundation

enum PetErrorCode: String, CaseIterable, Codable, Sendable {
    case accountServiceUnavailable = "account_service_unavailable"
    case accountInvalidResponse = "account_invalid_response"
    case accountRateLimited = "account_rate_limited"
    case accountStorageUnavailable = "account_storage_unavailable"
    case accountRefreshFailed = "account_refresh_failed"
    case coordinatorConnectionFailed = "coordinator_connection_failed"
    case coordinatorResponseInvalid = "coordinator_response_invalid"
    case choiceSubmitFailed = "choice_submit_failed"
    case approvalSubmitFailed = "approval_submit_failed"
    case suggestionDismissFailed = "suggestion_dismiss_failed"
    case appServiceFailed = "app_service_failed"
    case appServiceTimeout = "app_service_timeout"
    case appServiceExited = "app_service_exited"
    case connectionFailed = "connection_failed"
}

struct PetErrorEnvironment: Codable, Equatable, Sendable {
    let appVersion: String
    let appBuild: String
    let osVersion: String

    static var current: PetErrorEnvironment {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return PetErrorEnvironment(
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
            osVersion: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        )
    }

    init(appVersion: String, appBuild: String, osVersion: String) {
        self.appVersion = Self.normalizedVersion(appVersion)
        self.appBuild = Self.normalizedVersion(appBuild)
        self.osVersion = Self.normalizedVersion(osVersion)
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(appVersion: try values.decode(String.self, forKey: .appVersion),
                  appBuild: try values.decode(String.self, forKey: .appBuild),
                  osVersion: try values.decode(String.self, forKey: .osVersion))
    }

    static func normalizedVersion(_ value: String) -> String {
        guard value != "unknown" else { return value }
        let groups = value.split(separator: ".", omittingEmptySubsequences: false)
        guard value.utf8.count <= 27, (1...4).contains(groups.count), groups.allSatisfy({ group in
            (1...6).contains(group.utf8.count) && group.utf8.allSatisfy { (48...57).contains($0) }
        }) else { return "unknown" }
        return value
    }
}

struct PetErrorEvent: Codable, Equatable, Sendable {
    let userID: String
    let eventID: UUID
    let code: PetErrorCode
    let occurredAt: Date
    let environment: PetErrorEnvironment
    var connection: PetConnectionDiagnostic? = nil
}

struct PetErrorContext: Equatable, Sendable {
    fileprivate let userID: String
    fileprivate let epoch: UInt64
}

enum PetErrorDelivery: Sendable { case accepted, discard, retry, waitForAuthorization }

@MainActor
protocol PetErrorSending {
    func send(_ event: PetErrorEvent, authorization: PetUsageAuthorization) async throws -> PetErrorDelivery
}

@MainActor
protocol PetErrorEventStoring {
    func load() throws -> [PetErrorEvent]
    func save(_ events: [PetErrorEvent]) throws
    func clear() throws
    func invalidate() throws
}

extension PetErrorEventStoring {
    // In-memory stores can erase directly. The live file store is wrapped in a
    // persisted generation so a failed unlink cannot revive invalidated events.
    func invalidate() throws { try clear() }
}

/// Optional sampled diagnostics, independent of usage analytics. Error inputs
/// use closed codes/context: no descriptions, requests, paths or account data.
@MainActor
final class PetErrorDiagnostics: ObservableObject {
    static let enabledPreferenceKey = "blabee.errorDiagnostics.enabled"
    static let outboxGenerationPreferenceKey = "blabee.errorDiagnostics.outboxGeneration"
    static let maximumEventCount = 256
    static let maximumEventAge: TimeInterval = 7 * 24 * 60 * 60
    static let duplicateWindow: TimeInterval = 60
    static let maximumEventsPerHour = 50

    @Published private(set) var isEnabled: Bool
    @Published private(set) var pendingEventCount = 0
    @Published private(set) var lastAcceptedAt: Date?
    @Published private(set) var lastRecordedEventID: UUID?

    private let authorization: @MainActor () -> PetUsageAuthorization?
    private let store: any PetErrorEventStoring
    private let service: any PetErrorSending
    private let savePreference: @MainActor (Bool) -> Void
    private let now: @MainActor () -> Date
    private let sleep: @MainActor (TimeInterval) async throws -> Void
    private let makeEventID: @MainActor () -> UUID
    private let environment: PetErrorEnvironment
    private var events: [PetErrorEvent] = []
    private var owner: String?
    private var authorizationBlocked = false
    private var isStopped = false
    private var generation: UInt64 = 0
    private var contextEpoch: UInt64 = 0
    private var flushTask: Task<Void, Never>?
    private var nextRetryDelay: TimeInterval = 30
    // Intentionally in memory: limits reset on process restart or identity reset.
    // Persisted pending events keep their IDs; the server enforces its daily cap.
    private struct SamplingKey: Hashable {
        let code: PetErrorCode
        let connection: PetConnectionDiagnostic?
    }
    private var lastRecorded: [SamplingKey: Date] = [:]
    private var recentRecords: [Date] = []

    static func live(authorization: @escaping @MainActor () -> PetUsageAuthorization?) -> PetErrorDiagnostics {
        let defaults = UserDefaults.standard
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/BlabeeDiagnostics", isDirectory: true)
        let generation = defaults.string(forKey: outboxGenerationPreferenceKey).flatMap(UUID.init(uuidString:)) ?? UUID()
        let store = PetErrorGenerationStore(generation: generation, saveGeneration: {
            defaults.set($0.uuidString, forKey: outboxGenerationPreferenceKey)
        }, makeStore: { PetErrorFileStore(directory: directory, generation: $0) })
        return PetErrorDiagnostics(
            isEnabled: defaults.bool(forKey: enabledPreferenceKey),
            authorization: authorization, store: store,
            service: PetSupabaseErrorService(),
            savePreference: { defaults.set($0, forKey: enabledPreferenceKey) }
        )
    }

    init(
        isEnabled: Bool = false,
        authorization: @escaping @MainActor () -> PetUsageAuthorization?,
        store: any PetErrorEventStoring,
        service: any PetErrorSending,
        savePreference: @escaping @MainActor (Bool) -> Void = { _ in },
        now: @escaping @MainActor () -> Date = Date.init,
        sleep: @escaping @MainActor (TimeInterval) async throws -> Void = { delay in
            try await Task.sleep(for: .seconds(delay))
        },
        makeEventID: @escaping @MainActor () -> UUID = UUID.init,
        environment: PetErrorEnvironment = .current
    ) {
        self.isEnabled = isEnabled
        self.authorization = authorization
        self.store = store
        self.service = service
        self.savePreference = savePreference
        self.now = now
        self.sleep = sleep
        self.makeEventID = makeEventID
        self.environment = environment
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
    }

    func record(code: PetErrorCode) {
        guard let context = captureContext() else { return }
        record(code: code, context: context)
    }

    func captureContext() -> PetErrorContext? {
        guard isEnabled, !isStopped, let auth = currentAuthorization() else { return nil }
        adoptOwner(auth.userID)
        return PetErrorContext(userID: auth.userID, epoch: contextEpoch)
    }

    /// A refresh failure may finish while the account is temporarily unverified.
    /// Its captured owner remains valid until explicit logout, account replacement,
    /// opt-out, or stop invalidates the epoch. Delivery still requires fresh auth.
    func record(code: PetErrorCode, context: PetErrorContext) {
        guard code != .connectionFailed else { return }
        record(code: code, connection: nil, context: context)
    }

    func record(connection: PetConnectionDiagnostic, context: PetErrorContext) {
        record(code: .connectionFailed, connection: connection, context: context)
    }

    private func record(code: PetErrorCode, connection: PetConnectionDiagnostic?, context: PetErrorContext) {
        guard isEnabled, !isStopped else { return }
        if let auth = currentAuthorization() { adoptOwner(auth.userID) }
        guard context.userID == owner, context.epoch == contextEpoch else { return }
        let instant = now()
        guard PetErrorValidation.isDate(instant) else { return }
        recentRecords.removeAll { $0 <= instant.addingTimeInterval(-3_600) }
        guard recentRecords.count < Self.maximumEventsPerHour else { return }
        let key = SamplingKey(code: code, connection: connection)
        if let last = lastRecorded[key], instant.timeIntervalSince(last) < Self.duplicateWindow { return }
        lastRecorded[key] = instant
        recentRecords.append(instant)
        prune()
        let eventID = makeEventID()
        events.append(PetErrorEvent(userID: context.userID, eventID: eventID, code: code,
                                    occurredAt: instant, environment: environment, connection: connection))
        lastRecordedEventID = eventID
        if events.count > Self.maximumEventCount { events.removeFirst(events.count - Self.maximumEventCount) }
        persist()
        beginFlushing()
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
        pendingEventCount = 0
        lastAcceptedAt = nil
        lastRecordedEventID = nil
        authorizationBlocked = false
        events.removeAll()
        lastRecorded.removeAll()
        recentRecords.removeAll()
        try? store.invalidate()
    }

    func stop() {
        isStopped = true
        contextEpoch &+= 1
        cancelFlush()
    }

    private func currentAuthorization() -> PetUsageAuthorization? {
        let instant = now()
        guard instant.timeIntervalSince1970.isFinite,
              let value = authorization(), let userID = UUID(uuidString: value.userID),
              value.expiresAt.timeIntervalSince1970.isFinite, value.expiresAt > instant,
              PetErrorValidation.isHeaderValue(value.accessToken)
        else { return nil }
        return PetUsageAuthorization(userID: userID.uuidString.lowercased(), accessToken: value.accessToken,
                                     expiresAt: value.expiresAt)
    }

    private func adoptOwner(_ userID: String) {
        guard owner != userID else { return }
        if owner != nil || events.contains(where: { $0.userID.caseInsensitiveCompare(userID) != .orderedSame }) {
            try? store.invalidate()
        }
        contextEpoch &+= 1
        cancelFlush()
        owner = userID
        lastAcceptedAt = nil
        lastRecordedEventID = nil
        authorizationBlocked = false
        lastRecorded.removeAll()
        recentRecords.removeAll()
        events.removeAll { $0.userID.caseInsensitiveCompare(userID) != .orderedSame }
        persist()
    }

    private func prune() {
        let instant = now()
        let prior = events
        var seen = Set<UUID>()
        events = events.filter {
            UUID(uuidString: $0.userID) != nil
                && PetErrorValidation.isDate($0.occurredAt)
                && $0.occurredAt >= instant.addingTimeInterval(-Self.maximumEventAge)
                && $0.occurredAt <= instant.addingTimeInterval(300)
                && seen.insert($0.eventID).inserted
        }
        events = Array(events.suffix(Self.maximumEventCount))
        if events != prior { persist() }
    }

    private func persist() {
        if pendingEventCount != events.count { pendingEventCount = events.count }
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
            let result: PetErrorDelivery
            do {
                result = try await service.send(event, authorization: auth)
            } catch {
                guard !Task.isCancelled, generation == attemptGeneration else { return }
                // Diagnostics failures never recursively create more diagnostics.
                result = .retry
            }
            guard !Task.isCancelled, generation == attemptGeneration, isEnabled, !isStopped else { return }
            guard let current = currentAuthorization(), current.userID == auth.userID else { return }
            switch result {
            case .accepted, .discard:
                if case .accepted = result { lastAcceptedAt = now() }
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
final class PetSupabaseErrorService: PetErrorSending {
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

    func send(_ event: PetErrorEvent, authorization: PetUsageAuthorization) async throws -> PetErrorDelivery {
        guard let owner = UUID(uuidString: authorization.userID),
              authorization.expiresAt > now(),
              PetErrorValidation.isHeaderValue(authorization.accessToken)
        else { return .waitForAuthorization }
        guard UUID(uuidString: event.userID) == owner, PetErrorValidation.isDate(event.occurredAt),
              var parts = URLComponents(url: configuration.supabaseURL, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.query == nil, parts.fragment == nil, parts.path.isEmpty || parts.path == "/",
              PetErrorValidation.isHeaderValue(configuration.publishableKey)
        else { return .discard }
        guard (event.code == .connectionFailed) == (event.connection != nil) else { return .discard }
        parts.path = event.connection == nil
            ? "/rest/v1/rpc/record_blabee_error" : "/rest/v1/rpc/record_blabee_connection_error"
        guard let url = parts.url else { return .discard }

        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var payload = [
            "p_event_id": event.eventID.uuidString.lowercased(),
            "p_error_code": event.code.rawValue,
            "p_occurred_at": formatter.string(from: event.occurredAt),
            "p_app_version": event.environment.appVersion,
            "p_app_build": event.environment.appBuild,
            "p_os_version": event.environment.osVersion,
        ]
        if let connection = event.connection {
            payload.removeValue(forKey: "p_error_code")
            payload["p_provider"] = connection.provider.rawValue
            payload["p_stage"] = connection.stage.rawValue
            payload["p_reason"] = connection.reason.rawValue
            payload["p_tool_version"] = connection.toolVersion
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authorization.accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)
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
            // false acknowledges a duplicate or a server rate discard. Retrying
            // it would overstate diagnostics and consume the server's rate budget.
            return (try? JSONDecoder().decode(Bool.self, from: data)) == nil ? .discard : .accepted
        case 401, 403: return .waitForAuthorization
        case 408, 425, 429, 500...599: return .retry
        default: return .discard
        }
    }
}

private enum PetErrorValidation {
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
final class PetErrorGenerationStore: PetErrorEventStoring {
    private let saveGeneration: @MainActor (UUID) -> Void
    private let makeStore: @MainActor (UUID) -> any PetErrorEventStoring
    private var current: any PetErrorEventStoring

    init(
        generation: UUID,
        saveGeneration: @escaping @MainActor (UUID) -> Void,
        makeStore: @escaping @MainActor (UUID) -> any PetErrorEventStoring
    ) {
        self.saveGeneration = saveGeneration
        self.makeStore = makeStore
        self.current = makeStore(generation)
        saveGeneration(generation)
    }

    func load() throws -> [PetErrorEvent] { try current.load() }
    func save(_ events: [PetErrorEvent]) throws { try current.save(events) }
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
final class PetErrorFileStore: PetErrorEventStoring {
    static let fileName = "pending-errors.json"
    static let maximumBytes = 131_072
    private let directory: URL
    private let fileName: String

    init(directory: URL, generation: UUID? = nil) {
        self.directory = directory
        self.fileName = generation.map { "pending-\($0.uuidString.lowercased()).json" } ?? Self.fileName
    }

    func load() throws -> [PetErrorEvent] {
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
        let events = try decoder.decode([PetErrorEvent].self, from: data)
        guard events.count <= PetErrorDiagnostics.maximumEventCount else { throw StoreError.unavailable }
        return events
    }

    func save(_ events: [PetErrorEvent]) throws {
        guard events.count <= PetErrorDiagnostics.maximumEventCount else { throw StoreError.unavailable }
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

import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Dispatch
import Foundation

/// A fresh launcher-owned session of the common Coordinator executable. The
/// launcher supplies its grant over an inherited private pipe, never argv,
/// a model-visible settings file, or an unauthenticated registration endpoint.
@MainActor
func runClaudeNativeHost(arguments rawArguments: [String], testing: Bool = false) throws {
    var arguments = rawArguments
    let showsPet = arguments.last == "--pet"
    if showsPet { arguments.removeLast() }
    var values: [String: String] = [:]
    let supported: Set<String> = ["--runtime", "--contracts", "--grant-fd", "--owner-fd"]
    guard arguments.count == 8 else { throw CoordinatorError("claude_session_host_arguments") }
    for index in stride(from: 0, to: arguments.count, by: 2) {
        guard supported.contains(arguments[index]), values[arguments[index]] == nil else {
            throw CoordinatorError("claude_session_host_arguments")
        }
        values[arguments[index]] = arguments[index + 1]
    }
    guard values["--grant-fd"] == "3", values["--owner-fd"] == "4", let runtimePath = values["--runtime"],
          let contractsPath = values["--contracts"], runtimePath.hasPrefix("/"),
          contractsPath.hasPrefix("/") else { throw CoordinatorError("claude_session_host_arguments") }
    try watchClaudeNativeOwner(descriptor: 4)
    let runtime = try ClaudeBridgeConfiguration.normalizedURL(URL(fileURLWithPath: runtimePath))
    guard !runtime.path.contains("/Library/Application Support/Blabee/"),
          !runtime.path.hasSuffix("/Library/Application Support/Blabee") else {
        throw CoordinatorError("claude_session_host_runtime_invalid")
    }
    try ContractPin.verify(contractsDirectory: URL(fileURLWithPath: contractsPath))
    let grant = try readClaudeNativeGrant(descriptor: 3)
    let store = try ClaudeBridgeConfiguration.privateChild(of: runtime, name: "native-storage")
    let authority = try ClaudeBridgeConfiguration.privateChild(of: runtime, name: "native-authority")
    // A restarted process must never re-enroll a previously issued grant. This
    // non-secret, exclusive marker deliberately requires a fresh session root.
    let marker = open(runtime.appendingPathComponent("native-session.used").path,
                      O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
    guard marker >= 0 else { throw CoordinatorError("claude_session_runtime_consumed") }
    close(marker)
    let database = store.appendingPathComponent("coordinator.sqlite3")
    let lease = try CoordinatorAuthorityLease(
        databaseURL: database, authorityRootURL: authority, includesPrimaryNamespace: false
    )
    let socket = try OperationalSocketPath.resolve(
        explicitPath: runtime.appendingPathComponent("native.sock").path
    )
    let server = try UnixDomainSocketServer(socketPath: socket)
    let freshness: any FreshnessAnchorStore
    #if BLABEE_JOURNAL_TEST_HARNESS
    if testing { freshness = RoundTripHarnessFreshnessAnchorStore() }
    else {
        let digest = SHA256.hash(data: Data(database.path.utf8)).map { String(format: "%02x", $0) }.joined()
        freshness = try KeychainFreshnessAnchorStore(account: "claude-native-v1-" + digest)
    }
    #else
    guard !testing else { throw CoordinatorError("claude_session_host_arguments") }
    let digest = SHA256.hash(data: Data(database.path.utf8)).map { String(format: "%02x", $0) }.joined()
    freshness = try KeychainFreshnessAnchorStore(account: "claude-native-v1-" + digest)
    #endif
    let journal = try SQLiteJournal(
        databaseURL: database, keyURL: store.appendingPathComponent("coordinator.key"),
        freshnessStore: freshness
    )
    for token in [grant.scope.bridgeToken, grant.scope.selectionToken, grant.hookToken, grant.controlToken] {
        journal.secretCorpus.register(token)
    }
    let adapter = try ClaudeCoreAdapter(journal: journal)
    let session = try ClaudeNativeSession(grant: grant, adapter: adapter, secretCorpus: journal.secretCorpus)
    let application = ClaudeNativeOperationalApplication(session: session)
    let petTransport: ClaudePetTransport? = showsPet ? try ClaudePetTransport(
        scopeID: grant.scope.scopeID, projectID: grant.scope.projectID,
        sessionID: grant.scope.sessionID, cwd: grant.cwd,
        selectionToken: grant.scope.selectionToken,
        handle: { payload in try session.handle(payload: payload) }
    ) : nil
    try server.activate()
    let ready = try StrictJSONTransport.data(forJSONObject: [
        "ready": true, "schema_version": "blabee.claude-native-host.v1",
        "scope_id": grant.scope.scopeID, "session_id": grant.scope.sessionID,
        "runtime_identity": try OperationalRuntimeIdentity.requireCurrent(),
    ])
    try journal.secretCorpus.assertNoKnownSecret(in: ready)
    try FileHandle.standardOutput.write(contentsOf: ready + Data([10]))
    try withExtendedLifetime(lease) {
        if let petTransport {
            try runClaudePet(transport: petTransport) {
                try server.run(application: application, secretCorpus: journal.secretCorpus)
            }
        } else {
            try server.run(application: application, secretCorpus: journal.secretCorpus)
        }
    }
}

/// The owner never writes to this private pipe. EOF (including owner SIGKILL)
/// ends this fresh host, even during bootstrap. No credential or restart path
/// survives; only the exclusive, non-secret consumed-runtime marker remains.
private func watchClaudeNativeOwner(descriptor: Int32) throws {
    var info = stat()
    guard fstat(descriptor, &info) == 0,
          [mode_t(S_IFIFO), mode_t(S_IFSOCK)].contains(info.st_mode & mode_t(S_IFMT)),
          fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0 else {
        throw CoordinatorError("claude_session_owner_pipe_required")
    }
    DispatchQueue.global(qos: .utility).async {
        while true {
            var waiting = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
            let available = poll(&waiting, 1, 1000)
            if available < 0 {
                if errno == EINTR { continue }
                Darwin._exit(78)
            }
            if available == 0 { continue }
            var byte: UInt8 = 0
            let count = Darwin.read(descriptor, &byte, 1)
            if count < 0 && (errno == EINTR || errno == EAGAIN) { continue }
            Darwin._exit(count == 0 ? 0 : 78)
        }
    }
}

private struct ClaudeNativeOperationalApplication: CoordinatorOperationalHandling {
    let session: ClaudeNativeSession

    func handle(type: String, payload: Data) async throws -> Data {
        // The low-level bridge-v1 path must not bypass native readiness or role
        // policy for this session. There is deliberately no fallback endpoint.
        guard type == "claude_session_v1" else { throw CoordinatorError("claude_session_forbidden") }
        return try session.handle(payload: payload)
    }

    func doctorStatus(payload: Data) async throws -> Data { throw CoordinatorError("claude_session_forbidden") }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

private func readClaudeNativeGrant(descriptor: Int32) throws -> ClaudeNativeGrant {
    defer { close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0,
          [mode_t(S_IFIFO), mode_t(S_IFSOCK)].contains(info.st_mode & mode_t(S_IFMT)) else {
        throw CoordinatorError("claude_session_grant_pipe_required")
    }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
    while true {
        guard DispatchTime.now().uptimeNanoseconds < deadline else {
            throw CoordinatorError("claude_session_grant_unavailable")
        }
        var waiting = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        let available = poll(&waiting, 1, 100)
        if available < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("claude_session_grant_unavailable")
        }
        if available == 0 { continue }
        let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
        if count < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("claude_session_grant_unavailable")
        }
        if count == 0 { break }
        guard data.count + count <= 16 * 1024 else { throw CoordinatorError("claude_session_grant_invalid") }
        data.append(contentsOf: buffer.prefix(count))
    }
    let object: [String: Any]
    do {
        object = try StrictJSONTransport.object(
            from: data, limits: StrictJSONLimits(maximumBytes: 16 * 1024, maximumDepth: 4)
        )
    } catch { throw CoordinatorError("claude_session_grant_invalid") }
    guard Set(object.keys) == ["schema_version", "scope_id", "project_id", "session_id", "cwd", "expires_at",
                               "bridge_token", "selection_token", "hook_token", "control_token"],
          object["schema_version"] as? String == "blabee.claude-native-grant.v1",
          let scopeID = object["scope_id"] as? String, let projectID = object["project_id"] as? String,
          let sessionID = object["session_id"] as? String, let cwd = object["cwd"] as? String,
          let bridge = object["bridge_token"] as? String, let selection = object["selection_token"] as? String,
          let hook = object["hook_token"] as? String, let control = object["control_token"] as? String,
          let expiry = object["expires_at"] as? String else { throw CoordinatorError("claude_session_grant_invalid") }
    let dateParser = ISO8601DateFormatter()
    dateParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let expiresAt = dateParser.date(from: expiry),
          expiresAt > Date(), expiresAt.timeIntervalSinceNow <= 24 * 60 * 60 else {
        throw CoordinatorError("claude_session_grant_invalid")
    }
    let cwdURL = try ClaudeBridgeConfiguration.normalizedURL(URL(fileURLWithPath: cwd))
    var cwdInfo = stat()
    guard cwd.hasPrefix("/"), cwdURL.path == cwd, cwdURL.resolvingSymlinksInPath().path == cwd,
          lstat(cwd, &cwdInfo) == 0, cwdInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) else {
        throw CoordinatorError("claude_session_grant_invalid")
    }
    return try ClaudeNativeGrant(
        scope: ClaudeBridgeScope(scopeID: scopeID, projectID: projectID, sessionID: sessionID,
                                 bridgeToken: bridge, selectionToken: selection, expiresAt: expiresAt),
        cwd: cwd, hookToken: hook, controlToken: control
    )
}

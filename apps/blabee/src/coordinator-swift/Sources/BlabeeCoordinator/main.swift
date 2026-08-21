import CoordinatorSwift
import Darwin
import Foundation

private struct Arguments {
    let database: URL
    let key: URL
    let contracts: URL

    init(_ values: [String]) throws {
        var databasePath: String?
        var keyPath: String?
        var contractsPath: String?
        var index = 1
        while index < values.count {
            let flag = values[index]
            guard index + 1 < values.count else {
                throw CoordinatorError("invalid_arguments", "an argument value is missing")
            }
            let value = values[index + 1]
            switch flag {
            case "--database": databasePath = value
            case "--key": keyPath = value
            case "--contracts": contractsPath = value
            default: throw CoordinatorError("invalid_arguments", "unsupported argument")
            }
            index += 2
        }
        guard let databasePath, let keyPath, let contractsPath else {
            throw CoordinatorError("invalid_arguments", "--database, --key, and --contracts are required")
        }
        database = URL(fileURLWithPath: databasePath)
        key = URL(fileURLWithPath: keyPath)
        contracts = URL(fileURLWithPath: contractsPath)
    }
}

private struct DaemonArguments {
    let database: URL
    let key: URL
    let contracts: URL
    let socketPath: String
    let enabledProjectPaths: [String]

    init(_ values: [String]) throws {
        var databasePath: String?
        var keyPath: String?
        var contractsPath: String?
        var socketPath: String?
        var enabledProjectPaths: [String] = []
        var index = 0
        while index < values.count {
            let flag = values[index]
            guard index + 1 < values.count, !values[index + 1].isEmpty else {
                throw CoordinatorError("invalid_arguments", "an argument value is missing")
            }
            let value = values[index + 1]
            switch flag {
            case "--database":
                guard databasePath == nil else { throw CoordinatorError("invalid_arguments") }
                databasePath = value
            case "--key":
                guard keyPath == nil else { throw CoordinatorError("invalid_arguments") }
                keyPath = value
            case "--contracts":
                guard contractsPath == nil else { throw CoordinatorError("invalid_arguments") }
                contractsPath = value
            case "--socket":
                guard socketPath == nil else { throw CoordinatorError("invalid_arguments") }
                socketPath = value
            case "--enabled-project":
                guard value.hasPrefix("/") else {
                    throw CoordinatorError("invalid_arguments", "enabled project path must be absolute")
                }
                let standardized = URL(fileURLWithPath: value, isDirectory: true)
                    .standardizedFileURL.path
                enabledProjectPaths.append(standardized)
            default:
                throw CoordinatorError("invalid_arguments", "unsupported daemon argument")
            }
            index += 2
        }
        guard let databasePath, let keyPath, let contractsPath else {
            throw CoordinatorError(
                "invalid_arguments",
                "--database, --key, and --contracts are required"
            )
        }
        database = URL(fileURLWithPath: databasePath)
        key = URL(fileURLWithPath: keyPath)
        contracts = URL(fileURLWithPath: contractsPath)
        self.socketPath = try OperationalSocketPath.resolve(explicitPath: socketPath)
        self.enabledProjectPaths = Array(Set(enabledProjectPaths)).sorted()
    }
}

private struct FreshnessRuntimeConfiguration {
    let store: KeychainFreshnessAnchorStore
    let deleteForTesting: Bool

    init(environment: [String: String]) throws {
        let testNamespaceEnabled = environment["BLABEE_T007B_ENABLE_KEYCHAIN_TEST_NAMESPACE"] == "1"
        let requestedAccount = environment["BLABEE_T007B_KEYCHAIN_ACCOUNT"]
        let deleteRequested = environment["BLABEE_T007B_DELETE_KEYCHAIN_TEST_ANCHOR"] == "1"

        if requestedAccount != nil || deleteRequested {
            guard testNamespaceEnabled else {
                throw CoordinatorError(
                    "invalid_arguments",
                    "Keychain test namespace requires its exact enable gate"
                )
            }
        }
        let account: String
        if testNamespaceEnabled {
            guard let requestedAccount,
                  requestedAccount.hasPrefix("test-"),
                  requestedAccount != "primary",
                  requestedAccount.range(
                    of: "^test-[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$",
                    options: .regularExpression
                  ) != nil
            else {
                throw CoordinatorError("invalid_arguments", "a safe test Keychain account is required")
            }
            account = requestedAccount
        } else {
            account = "primary"
        }
        store = try KeychainFreshnessAnchorStore(
            account: account,
            allowsTestDeletion: testNamespaceEnabled
        )
        deleteForTesting = deleteRequested
    }
}

private func requiredString(_ object: [String: Any], _ key: String) throws -> String {
    guard let value = object[key] as? String, !value.isEmpty else {
        throw CoordinatorError("invalid_request", "\(key) must be a non-empty string")
    }
    return value
}

private func requiredSafeRequestID(
    _ object: [String: Any],
    secretCorpus: RuntimeSecretCorpus
) throws -> String {
    let value = try requiredString(object, "request_id")
    let safePattern = "^[A-Za-z][A-Za-z0-9_.:-]{0,127}$"
    guard value.range(of: safePattern, options: .regularExpression) != nil,
          !secretCorpus.containsKnownSecret(in: Data(value.utf8))
    else { throw CoordinatorError("invalid_request", "request_id is not a safe correlation identifier") }
    return value
}

private func requiredInteger(_ object: [String: Any], _ key: String) throws -> Int64 {
    guard let value = ExactJSONInteger.int64(object[key], minimum: 0) else {
        throw CoordinatorError("invalid_request", "\(key) must be a non-negative integer")
    }
    return value
}

private func objectArrayData(_ object: [String: Any], _ key: String) throws -> [Data] {
    guard let values = object[key] as? [Any] else {
        throw CoordinatorError("invalid_request", "\(key) must be an array")
    }
    return try values.map { value in
        guard value is [String: Any] else {
            throw CoordinatorError("invalid_request", "\(key) items must be objects")
        }
        return try StrictJSONTransport.data(forJSONObject: value)
    }
}

private func optionalObjectArrayData(_ object: [String: Any], _ key: String) throws -> [Data] {
    if object[key] == nil { return [] }
    return try objectArrayData(object, key)
}

private func decodeDocuments(_ values: [Data]) throws -> [Any] {
    try values.map { try JSONSerialization.jsonObject(with: $0) }
}

private func sqliteResult(_ health: JournalHealth) -> [String: Any] {
    [
        "journal_mode": health.sqlite.journalMode,
        "synchronous": health.sqlite.synchronous,
        "foreign_keys": health.sqlite.foreignKeys,
        "busy_timeout_ms": health.sqlite.busyTimeoutMilliseconds,
        "integrity_check": health.integrityCheck,
    ]
}

private func healthResult(_ health: JournalHealth) -> [String: Any] {
    [
        "schema_version": health.schemaVersion,
        "journal_sequence": health.journalSequence,
        "sqlite": sqliteResult(health),
    ]
}

private func response(
    journal: SQLiteJournal,
    routing: CoordinatorRoutingApplication?,
    request: [String: Any]
) throws -> (requestID: String, operation: String, result: [String: Any]) {
    let requestID = try requiredSafeRequestID(request, secretCorpus: journal.secretCorpus)
    let operation = try requiredString(request, "op")
    switch operation {
    case "health", "initialize":
        return (requestID, operation, healthResult(try journal.health()))
    case "load":
        let snapshot = try journal.load()
        return (requestID, operation, [
            "events": try decodeDocuments(snapshot.events),
            "documents": try decodeDocuments(snapshot.documents),
            "verification_records": try decodeDocuments(snapshot.verificationRecords),
            "journal_sequence": snapshot.journalSequence,
        ])
    case "execute_command":
        guard let command = request["command"] as? [String: Any] else {
            throw CoordinatorError(
                "coordinator_command_invalid",
                "execute_command requires an object command"
            )
        }
        let commandData = try StrictJSONTransport.data(forJSONObject: command)
        let execution: CoordinatorSemanticExecutionResult
        if let routing {
            execution = try routing.executeCommand(commandData)
        } else {
            execution = try CoordinatorSemanticApplication(journal: journal).execute(
                command: commandData
            )
        }
        return (requestID, operation, [
            "first_sequence": execution.commit.firstSequence,
            "last_sequence": execution.commit.lastSequence,
            "event_count": execution.commit.eventCount,
            "effects": try decodeDocuments(execution.effects),
        ])
    case "set_foreground":
        guard let routing else { throw CoordinatorError("routing_unavailable") }
        guard let target = request["target"] as? [String: Any] else {
            throw CoordinatorError("foreground_target_invalid")
        }
        let snapshot = try routing.setForeground(
            StrictJSONTransport.data(forJSONObject: target)
        )
        guard let result = try JSONSerialization.jsonObject(
            with: snapshot.canonicalJSON
        ) as? [String: Any] else { throw CoordinatorError("routing_snapshot_invalid") }
        return (requestID, operation, result)
    case "clear_foreground":
        guard let routing else { throw CoordinatorError("routing_unavailable") }
        let snapshot = try routing.clearForeground()
        guard let result = try JSONSerialization.jsonObject(
            with: snapshot.canonicalJSON
        ) as? [String: Any] else { throw CoordinatorError("routing_snapshot_invalid") }
        return (requestID, operation, result)
    case "route_selection":
        guard let routing else { throw CoordinatorError("routing_unavailable") }
        guard let command = request["command"] as? [String: Any] else {
            throw CoordinatorError("route_selection_command_invalid")
        }
        let execution = try routing.routeSelection(
            StrictJSONTransport.data(forJSONObject: command)
        )
        return (requestID, operation, [
            "first_sequence": execution.commit.firstSequence,
            "last_sequence": execution.commit.lastSequence,
            "event_count": execution.commit.eventCount,
            "effects": try decodeDocuments(execution.effects),
        ])
    case "route_consume_pet_action":
        guard let routing else { throw CoordinatorError("routing_unavailable") }
        guard let command = request["command"] as? [String: Any] else {
            throw CoordinatorError("route_consume_command_invalid")
        }
        let execution = try routing.routeConsumePetAction(
            StrictJSONTransport.data(forJSONObject: command)
        )
        return (requestID, operation, [
            "first_sequence": execution.commit.firstSequence,
            "last_sequence": execution.commit.lastSequence,
            "event_count": execution.commit.eventCount,
            "effects": try decodeDocuments(execution.effects),
        ])
    case "routing_snapshot":
        guard let routing else { throw CoordinatorError("routing_unavailable") }
        let snapshot = try routing.snapshot()
        guard var result = try JSONSerialization.jsonObject(
            with: snapshot.canonicalJSON
        ) as? [String: Any] else { throw CoordinatorError("routing_snapshot_invalid") }
        result["notices"] = try decodeDocuments(routing.drainNotices())
        return (requestID, operation, result)
    case "process_time":
        guard let routing else { throw CoordinatorError("routing_unavailable") }
        return (requestID, operation, [
            "notices": try decodeDocuments(routing.processTime()),
        ])
    #if BLABEE_JOURNAL_TEST_HARNESS
    case "append":
        let expected = try requiredInteger(request, "expected_sequence")
        let events = try objectArrayData(request, "events")
        let documents = try optionalObjectArrayData(request, "documents")
        let verifications = try optionalObjectArrayData(request, "verification_records")
        let crashPoint: JournalCrashPoint?
        if let raw = request["crash_point"] {
            guard ProcessInfo.processInfo.environment["BLABEE_T007B_ENABLE_CRASH_INJECTION"] == "1" else {
                throw CoordinatorError("invalid_request", "crash injection is disabled")
            }
            guard let value = raw as? String, let parsed = JournalCrashPoint(rawValue: value) else {
                throw CoordinatorError("invalid_request", "invalid crash_point")
            }
            crashPoint = parsed
        } else {
            crashPoint = nil
        }
        let appended = try journal.append(
            expectedSequence: expected,
            events: events,
            documents: documents,
            verificationRecords: verifications,
            crashPoint: crashPoint
        )
        return (requestID, operation, [
            "first_sequence": appended.firstSequence,
            "last_sequence": appended.lastSequence,
            "event_count": appended.eventCount,
        ])
    #else
    case "append":
        throw CoordinatorError(
            "semantic_command_required",
            "raw journal append is unavailable in the product adapter"
        )
    #endif
    case "integrity":
        let integrity = try journal.integrity()
        return (requestID, operation, [
            "integrity_check": integrity.integrityCheck,
            "quick_check": integrity.quickCheck,
            "sidecars_verified": integrity.sidecarsVerified,
        ])
    case "diagnostics":
        let health = try journal.health()
        return (requestID, operation, [
            "database_configured": true,
            "freshness_anchor_configured": true,
            "key_configured": true,
            "schema_version": health.schemaVersion,
            "journal_sequence": health.journalSequence,
            "sqlite": sqliteResult(health),
        ])
    case "validate":
        let contractName = try requiredString(request, "contract")
        guard let contract = V1Contract(rawValue: contractName), let document = request["document"] as? [String: Any] else {
            throw CoordinatorError("invalid_request", "validate requires a supported contract and object document")
        }
        let data = try StrictJSONTransport.data(forJSONObject: document)
        _ = try V1IngressValidator().validate(data, as: contract)
        return (requestID, operation, ["valid": true, "contract": contract.rawValue])
    default:
        throw CoordinatorError("invalid_request", "unsupported operation")
    }
}

private func writeJSON(
    _ object: [String: Any],
    to handle: FileHandle,
    secretCorpus: RuntimeSecretCorpus? = nil
) throws {
    try secretCorpus?.assertNoKnownSecret(inJSONObject: object)
    var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    try secretCorpus?.assertNoKnownSecret(in: data)
    data.append(0x0A)
    try handle.write(contentsOf: data)
}

private func semanticIssuedTokens(
    in response: [String: Any]
) throws -> (tokens: [String], redacted: [String: Any]) {
    guard var result = response["result"] as? [String: Any],
          var effects = result["effects"] as? [[String: Any]]
    else { return ([], response) }

    var tokens: [String] = []
    for index in effects.indices {
        let kind = effects[index]["kind"] as? String
        guard kind == "pet_action_envelope_ready" || kind == "format_repair_envelope_ready"
        else { continue }
        guard var envelope = effects[index]["envelope"] as? [String: Any],
              let token = envelope["continuation_token"] as? String
        else {
            throw CoordinatorError("continuation_envelope_invalid")
        }
        let envelopeData = try StrictJSONTransport.data(forJSONObject: envelope)
        _ = try V1IngressValidator().validate(envelopeData, as: .continuationEnvelope)
        guard !tokens.contains(token) else {
            throw CoordinatorError("token_fingerprint_duplicate")
        }
        tokens.append(token)
        envelope["continuation_token"] = "redacted-issued-token"
        effects[index]["envelope"] = envelope
    }
    result["effects"] = effects
    var redacted = response
    redacted["result"] = result
    return (tokens, redacted)
}

private func occurrenceCount(of needle: Data, in haystack: Data) -> Int {
    guard !needle.isEmpty else { return 0 }
    var count = 0
    var cursor = haystack.startIndex
    while cursor < haystack.endIndex,
          let range = haystack.range(of: needle, in: cursor..<haystack.endIndex)
    {
        count += 1
        cursor = range.upperBound
    }
    return count
}

private func writeProtocolResponse(
    _ object: [String: Any],
    operation: String,
    to handle: FileHandle,
    secretCorpus: RuntimeSecretCorpus,
    requestSecretCorpus: RuntimeSecretCorpus? = nil
) throws {
    try requestSecretCorpus?.assertNoKnownSecret(inJSONObject: object)
    if let requestSecretCorpus {
        let requestCheckData = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        try requestSecretCorpus.assertNoKnownSecret(in: requestCheckData)
    }
    guard operation == "execute_command" || operation == "route_selection" else {
        try writeJSON(object, to: handle, secretCorpus: secretCorpus)
        return
    }
    let issued = try semanticIssuedTokens(in: object)
    try secretCorpus.assertNoKnownSecret(inJSONObject: issued.redacted)
    var data = try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
    try requestSecretCorpus?.assertNoKnownSecret(in: data)
    for token in issued.tokens {
        guard occurrenceCount(of: Data(token.utf8), in: data) == 1 else {
            throw CoordinatorError(
                "raw_continuation_token_forbidden",
                "issued token must appear exactly once in its semantic effect"
            )
        }
        secretCorpus.register(token)
    }
    data.append(0x0A)
    try handle.write(contentsOf: data)
}

private func logError(_ error: CoordinatorError, secretCorpus: RuntimeSecretCorpus? = nil) {
    let object: [String: Any] = [
        "level": "error",
        "error": ["code": error.code, "message": "request failed"],
    ]
    try? writeJSON(object, to: .standardError, secretCorpus: secretCorpus)
}

private func handleLine(
    _ line: Data,
    journal: SQLiteJournal,
    routing: CoordinatorRoutingApplication?
) throws {
    if line.isEmpty { return }
    var requestID: String?
    let requestSecretCorpus = RuntimeSecretCorpus()
    do {
        let request = try StrictJSONTransport.object(from: line)
        requestSecretCorpus.registerKnownSecrets(inJSONObject: request)
        let localSafeRequestID = try requiredSafeRequestID(
            request,
            secretCorpus: requestSecretCorpus
        )
        _ = try requiredSafeRequestID(request, secretCorpus: journal.secretCorpus)
        requestID = localSafeRequestID
        let handled = try response(journal: journal, routing: routing, request: request)
        let output: [String: Any] = [
            "request_id": handled.requestID,
            "ok": true,
            "result": handled.result,
        ]
        try writeProtocolResponse(
            output,
            operation: handled.operation,
            to: .standardOutput,
            secretCorpus: journal.secretCorpus,
            requestSecretCorpus: requestSecretCorpus
        )
    } catch {
        var failure = error.coordinatorError
        if requestID == nil,
           failure.code == "contract_validation_failed",
           let recovery = try? StrictJSONTransport.recoverRequestCorrelation(from: line),
           let recoveredRequestID = recovery.requestID,
           let safeRequestID = try? requiredSafeRequestID(
               ["request_id": recoveredRequestID],
               secretCorpus: journal.secretCorpus
           )
        {
            requestID = safeRequestID
            if recovery.ignoredIntegerRangeViolation {
                failure = CoordinatorError(
                    "invalid_request",
                    "request contains an integer outside the supported transport range"
                )
            }
        }
        let safeRequestID = requestID ?? "unknown"
        let failureOutput: [String: Any] = [
            "request_id": safeRequestID,
            "ok": false,
            "error": ["code": failure.code, "message": "request failed"],
        ]
        do {
            try requestSecretCorpus.assertNoKnownSecret(inJSONObject: failureOutput)
            let failureData = try JSONSerialization.data(
                withJSONObject: failureOutput,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
            try requestSecretCorpus.assertNoKnownSecret(in: failureData)
        } catch {
            logError(failure, secretCorpus: journal.secretCorpus)
            return
        }
        try writeJSON(
            failureOutput,
            to: .standardOutput,
            secretCorpus: journal.secretCorpus
        )
        logError(failure, secretCorpus: journal.secretCorpus)
    }
}

private func runLegacyCoordinator(arguments rawArguments: [String]) throws {
    let arguments = try Arguments(rawArguments)
    try ContractPin.verify(contractsDirectory: arguments.contracts)
    let authorityLease: CoordinatorAuthorityLease?
    #if BLABEE_JOURNAL_TEST_HARNESS
    let environment = ProcessInfo.processInfo.environment
    if environment["BLABEE_T011_ENABLE_AUTHORITY_TEST_LEASE"] == "1" {
        guard let rootPath = environment["BLABEE_T011_AUTHORITY_TEST_ROOT"],
              rootPath.hasPrefix("/tmp/") || rootPath.hasPrefix("/private/tmp/")
        else {
            throw CoordinatorError("invalid_arguments")
        }
        authorityLease = try CoordinatorAuthorityLease(
            databaseURL: arguments.database,
            testAuthorityRootURL: URL(fileURLWithPath: rootPath, isDirectory: true)
        )
    } else {
        authorityLease = nil
    }
    #else
    authorityLease = try CoordinatorAuthorityLease(databaseURL: arguments.database)
    #endif
    // Keep the storage authority for the complete legacy process lifetime.
    // Test-harness builds retain their existing cross-process CAS semantics.
    defer { withExtendedLifetime(authorityLease) {} }
    let freshness = try FreshnessRuntimeConfiguration(environment: ProcessInfo.processInfo.environment)
    if freshness.deleteForTesting {
        try freshness.store.deleteForTesting()
        return
    }
    let journal = try SQLiteJournal(
        databaseURL: arguments.database,
        keyURL: arguments.key,
        freshnessStore: freshness.store
    )
    #if BLABEE_JOURNAL_TEST_HARNESS
    let routing: CoordinatorRoutingApplication? = nil
    #else
    let routing: CoordinatorRoutingApplication? = try CoordinatorRoutingApplication(
        journal: journal
    )
    #endif
    var input = Data()
    var readBuffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
        var descriptor = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
        let timeout = routing?.millisecondsUntilNextDeadline() ?? -1
        let pollResult = Darwin.poll(&descriptor, 1, timeout)
        if pollResult < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("transport_read_failed", "cannot poll NDJSON input")
        }
        if pollResult == 0 {
            try routing?.processTimeKeepingNotices()
            continue
        }
        // stdin may stay readable indefinitely, including under malformed or
        // incomplete request floods. Advance due work before reading/parsing
        // every readable cycle so input validity cannot starve the scheduler.
        try routing?.processTimeKeepingNotices()
        let bytesRead = readBuffer.withUnsafeMutableBytes { pointer in
            Darwin.read(STDIN_FILENO, pointer.baseAddress, pointer.count)
        }
        if bytesRead < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("transport_read_failed", "cannot read NDJSON request")
        }
        if bytesRead == 0 {
            if !input.isEmpty {
                try handleLine(input, journal: journal, routing: routing)
            }
            break
        }
        input.append(contentsOf: readBuffer.prefix(bytesRead))
        guard input.count <= 16 * 1024 * 1024 + 64 * 1024 else {
            throw CoordinatorError(
                "contract_validation_failed",
                "NDJSON request line exceeds the transport limit"
            )
        }
        while let newline = input.firstRange(of: Data([0x0A])) {
            let line = Data(input[..<newline.lowerBound])
            input.removeSubrange(...newline.lowerBound)
            try handleLine(line, journal: journal, routing: routing)
        }
    }
}

private func runDaemon(arguments rawArguments: [String]) throws {
    let arguments = try DaemonArguments(rawArguments)
    try ContractPin.verify(contractsDirectory: arguments.contracts)
    let authorityLease = try CoordinatorAuthorityLease(databaseURL: arguments.database)
    // Acquire the process-lifetime owner lease before storage initialization.
    // The socket itself is published only after the full application is ready.
    let server = try UnixDomainSocketServer(socketPath: arguments.socketPath)
    let freshness = try FreshnessRuntimeConfiguration(
        environment: ProcessInfo.processInfo.environment
    )
    if freshness.deleteForTesting {
        try freshness.store.deleteForTesting()
        exit(0)
    }
    let journal = try SQLiteJournal(
        databaseURL: arguments.database,
        keyURL: arguments.key,
        freshnessStore: freshness.store
    )
    let routing = try CoordinatorRoutingApplication(journal: journal)
    let operational = CoordinatorOperationalApplication(
        routing: routing,
        enabledProjectPaths: arguments.enabledProjectPaths,
        secretCorpus: journal.secretCorpus
    )
    try server.activate()
    try withExtendedLifetime(authorityLease) {
        try server.run(application: operational, secretCorpus: journal.secretCorpus)
    }
}

#if BLABEE_JOURNAL_TEST_HARNESS
private struct OperationalRoundTripFixtureArguments {
    let fixtureRoot: URL
    let database: URL
    let key: URL
    let contracts: URL
    let enabledProject: URL
    let socketPath: String
    let authorityRoot: URL

    init(_ values: [String]) throws {
        var raw: [String: String] = [:]
        let supported = Set([
            "--fixture-root", "--database", "--key", "--contracts",
            "--enabled-project", "--socket", "--authority-root",
        ])
        var index = 0
        while index < values.count {
            guard index + 1 < values.count,
                  supported.contains(values[index]),
                  raw[values[index]] == nil,
                  !values[index + 1].isEmpty
            else { throw CoordinatorError("invalid_arguments") }
            raw[values[index]] = values[index + 1]
            index += 2
        }
        guard raw.count == supported.count,
              let fixtureRootPath = raw["--fixture-root"],
              let databasePath = raw["--database"],
              let keyPath = raw["--key"],
              let contractsPath = raw["--contracts"],
              let enabledProjectPath = raw["--enabled-project"],
              let socketPath = raw["--socket"],
              let authorityRootPath = raw["--authority-root"],
              [
                  fixtureRootPath, databasePath, keyPath, contractsPath,
                  enabledProjectPath, socketPath, authorityRootPath,
              ].allSatisfy({ $0.hasPrefix("/") })
        else { throw CoordinatorError("invalid_arguments") }

        fixtureRoot = URL(fileURLWithPath: fixtureRootPath, isDirectory: true).standardizedFileURL
        database = URL(fileURLWithPath: databasePath).standardizedFileURL
        key = URL(fileURLWithPath: keyPath).standardizedFileURL
        contracts = URL(fileURLWithPath: contractsPath, isDirectory: true).standardizedFileURL
        enabledProject = URL(
            fileURLWithPath: enabledProjectPath,
            isDirectory: true
        ).standardizedFileURL
        self.socketPath = try OperationalSocketPath.resolve(explicitPath: socketPath)
        authorityRoot = URL(
            fileURLWithPath: authorityRootPath,
            isDirectory: true
        ).standardizedFileURL

        guard fixtureRoot.path.hasPrefix("/tmp/")
                || fixtureRoot.path.hasPrefix("/private/tmp/")
        else { throw CoordinatorError("operational_test_path_unsafe") }
        let directChildren = [
            database, key, contracts, enabledProject,
            URL(fileURLWithPath: self.socketPath), authorityRoot,
        ]
        guard directChildren.allSatisfy({
            $0.deletingLastPathComponent().standardizedFileURL.path == fixtureRoot.path
        }) else {
            throw CoordinatorError("operational_test_path_unsafe")
        }
        try Self.requireSecureDirectory(fixtureRoot)
        try Self.requireSecureDirectory(contracts)
        try Self.requireSecureDirectory(enabledProject)
        try Self.requireSecureDirectory(authorityRoot)
        try Self.requireMissing(database)
        try Self.requireMissing(key)
        try Self.requireMissing(URL(fileURLWithPath: self.socketPath))
    }

    private static func requireSecureDirectory(_ url: URL) throws {
        var info = stat()
        guard lstat(url.path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              info.st_mode & 0o777 == 0o700,
              info.st_uid == geteuid()
        else { throw CoordinatorError("operational_test_path_unsafe") }
    }

    private static func requireMissing(_ url: URL) throws {
        var info = stat()
        guard lstat(url.path, &info) != 0, errno == ENOENT else {
            throw CoordinatorError("operational_test_path_unsafe")
        }
    }
}

private func runOperationalRoundTripFixture(arguments rawArguments: [String]) throws {
    let arguments = try OperationalRoundTripFixtureArguments(rawArguments)
    try ContractPin.verify(contractsDirectory: arguments.contracts)
    let authorityLease = try CoordinatorAuthorityLease(
        databaseURL: arguments.database,
        testAuthorityRootURL: arguments.authorityRoot
    )
    let server = try UnixDomainSocketServer(socketPath: arguments.socketPath)
    let freshness = RoundTripHarnessFreshnessAnchorStore()
    let tokenRecorder = RoundTripHarnessTokenRecorder()
    let journal = try SQLiteJournal(
        databaseURL: arguments.database,
        keyURL: arguments.key,
        freshnessStore: freshness
    )
    let routing = try CoordinatorRoutingApplication(
        journal: journal,
        tokenGenerator: tokenRecorder.generate
    )
    let operational = CoordinatorOperationalApplication(
        routing: routing,
        enabledProjectPaths: [arguments.enabledProject.path],
        secretCorpus: journal.secretCorpus
    )
    try server.activate()
    try writeJSON(
        ["ready": true],
        to: .standardOutput,
        secretCorpus: journal.secretCorpus
    )
    try withExtendedLifetime(authorityLease) {
        try server.run(application: operational, secretCorpus: journal.secretCorpus)
    }
    try tokenRecorder.assertNoRawToken(inDatabaseAt: arguments.database)
}

private func runTransportFixture(arguments: [String]) throws {
    var socketFlag: String?
    var authorityDatabase: URL?
    var authorityRoot: URL?
    var index = 0
    while index < arguments.count {
        guard index + 1 < arguments.count, !arguments[index + 1].isEmpty else {
            throw CoordinatorError("invalid_arguments")
        }
        switch arguments[index] {
        case "--socket":
            guard socketFlag == nil else { throw CoordinatorError("invalid_arguments") }
            socketFlag = arguments[index + 1]
        case "--authority-database":
            guard authorityDatabase == nil else { throw CoordinatorError("invalid_arguments") }
            authorityDatabase = URL(fileURLWithPath: arguments[index + 1])
        case "--authority-root":
            guard authorityRoot == nil else { throw CoordinatorError("invalid_arguments") }
            authorityRoot = URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
        default:
            throw CoordinatorError("invalid_arguments")
        }
        index += 2
    }
    guard let socketFlag else { throw CoordinatorError("invalid_arguments") }
    guard (authorityDatabase == nil) == (authorityRoot == nil) else {
        throw CoordinatorError("invalid_arguments")
    }
    let socketPath = try OperationalSocketPath.resolve(explicitPath: socketFlag)
    let authorityLease: CoordinatorAuthorityLease?
    if let authorityDatabase, let authorityRoot {
        authorityLease = try CoordinatorAuthorityLease(
            databaseURL: authorityDatabase,
            testAuthorityRootURL: authorityRoot
        )
    } else {
        authorityLease = nil
    }
    let secretCorpus = RuntimeSecretCorpus()
    let server = try UnixDomainSocketServer(socketPath: socketPath)
    try server.activate()
    try writeJSON(
        ["ready": true],
        to: .standardOutput,
        secretCorpus: secretCorpus
    )
    try withExtendedLifetime(authorityLease) {
        try server.run(
            application: FixtureTransportHandler(),
            secretCorpus: secretCorpus
        )
    }
}
#endif

do {
    let commandLine = CommandLine.arguments
    let mode = commandLine.count > 1 ? commandLine[1] : nil
    switch mode {
    case "daemon":
        try runDaemon(arguments: Array(commandLine.dropFirst(2)))
    case "hook":
        runHookCommand(arguments: Array(commandLine.dropFirst(2)))
    case "mcp":
        try runMCPCommand(arguments: Array(commandLine.dropFirst(2)))
    #if BLABEE_JOURNAL_TEST_HARNESS
    case "transport-test-server":
        try runTransportFixture(arguments: Array(commandLine.dropFirst(2)))
    case "operational-roundtrip-test-server":
        try runOperationalRoundTripFixture(arguments: Array(commandLine.dropFirst(2)))
    #endif
    default:
        try runLegacyCoordinator(arguments: commandLine)
    }
} catch {
    logError(error.coordinatorError)
    exit(1)
}

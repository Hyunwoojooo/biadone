#if BLABEE_JOURNAL_TEST_HARNESS
import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Foundation

/// Exercises the real product hub, UDS and SQLite. Only the freshness store
/// and Codex dispatch dependency are replaced; no installed runtime is used.
func runClaudeBridgeRoundTripFixture(arguments: [String]) throws {
    var values: [String: String] = [:]
    let keys: Set<String> = ["--fixture-root", "--contracts", "--socket", "--config"]
    guard arguments.count == keys.count * 2 || arguments.count == keys.count * 2 + 2 else {
        throw CoordinatorError("invalid_arguments")
    }
    for index in stride(from: 0, to: arguments.count, by: 2) {
        let key = arguments[index]
        let value = arguments[index + 1]
        guard values[key] == nil,
              (keys.contains(key) && value.hasPrefix("/") && !value.contains("\0"))
                || (key == "--config-policy" && value == "optional")
        else { throw CoordinatorError("invalid_arguments") }
        values[key] = value
    }
    guard keys.isSubset(of: Set(values.keys)) else { throw CoordinatorError("invalid_arguments") }
    let required = values["--config-policy"] != "optional"
    let root = try ClaudeBridgeConfiguration.normalizedURL(URL(fileURLWithPath: values["--fixture-root"]!))
    let contracts = try ClaudeBridgeConfiguration.normalizedURL(URL(fileURLWithPath: values["--contracts"]!))
    let configuration = try ClaudeBridgeConfiguration.normalizedURL(URL(fileURLWithPath: values["--config"]!))
    let socketURL = try ClaudeBridgeConfiguration.normalizedURL(URL(fileURLWithPath: values["--socket"]!))
    guard ClaudeCanonicalDirectory.matches(root.path),
          [configuration, socketURL].allSatisfy({ $0.path.hasPrefix(root.path + "/") })
    else { throw CoordinatorError("invalid_arguments") }
    // Validate credentials/configuration before publishing the server or writing
    // a journal. The constructor repeats validation at its actual trust boundary.
    if required { _ = try ClaudeBridgeConfiguration.load(at: configuration, required: true) }
    try ContractPin.verify(contractsDirectory: contracts)
    let store = try ClaudeBridgeConfiguration.privateChild(of: root, name: "codex-store")
    let authority = try ClaudeBridgeConfiguration.privateChild(of: root, name: "codex-authority")
    let database = store.appendingPathComponent("coordinator.sqlite3")
    let lease = try CoordinatorAuthorityLease(databaseURL: database, testAuthorityRootURL: authority)
    let server = try UnixDomainSocketServer(socketPath: socketURL.path)
    let journal = try SQLiteJournal(
        databaseURL: database, keyURL: store.appendingPathComponent("coordinator.key"),
        freshnessStore: RoundTripHarnessFreshnessAnchorStore()
    )
    let routing = try CoordinatorRoutingApplication(journal: journal)
    let codex = CoordinatorOperationalApplication(
        routing: routing, enabledProjectPaths: [root.path], secretCorpus: journal.secretCorpus,
        nextTurnDispatcher: { _ in throw CoordinatorError("claude_fixture_codex_dispatch_forbidden") }
    )
    let application = try ClaudeBridgeCoordinator(
        codex: codex, configurationURL: configuration, configurationRequired: required,
        secretCorpus: journal.secretCorpus,
        freshnessFactory: { _ in RoundTripHarnessFreshnessAnchorStore() }
    )
    try server.activate()
    try FileHandle.standardOutput.write(contentsOf: Data("{\"ready\":true}\n".utf8))
    try withExtendedLifetime(lease) {
        try server.run(application: application, secretCorpus: journal.secretCorpus)
    }
}
#endif

import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator
@testable import CoordinatorSwift

@Test("Installed Plugin copy does not claim to know Codex Hook trust")
func installedPluginCopyKeepsHookTrustUnknown() {
    let state = CodexPluginSetupState.installedNeedsHookReview(version: "0.1.0")
    #expect(state.title == "Plugin 설치됨 · Hook 상태 확인")
    #expect(state.detail.contains("자동 확인할 수 없습니다"))
    #expect(state.detail.contains("/hooks"))
    #expect(!state.title.contains("검토 필요"))
}

private struct CodexPluginSetupInvocation: Equatable {
    let executable: String
    let arguments: [String]
    let timeoutMilliseconds: Int
}

private final class CodexPluginSetupFakeCLI: @unchecked Sendable {
    private let lock = NSLock()

    var marketplaceRoot: String
    var pluginRoot: String
    var bundledVersion = "0.1.0"
    var marketplaces: [(name: String, root: String)] = []
    var plugins: [[String: Any]] = []
    var pluginAddExitCode: Int32 = 0
    var pluginAddCreatesPlugin = true
    var marketplaceAddCreatesMarketplace = true
    var marketplaceAddReceiptName = CodexPluginSetupManager.marketplaceName
    var marketplaceAddReceiptRoot: String
    var marketplaceAddReceiptAlreadyAdded: Any? = false
    var pluginRemoveCreatesEffect = true
    var marketplaceRemoveCreatesEffect = true
    var malformedMutationArguments: [String]?
    var malformedMarketplaceListOnCall: Int?
    var malformedPluginListOnCall: Int?
    var pluginAppendedOnListCall: (call: Int, plugin: [String: Any])?
    private var marketplaceListCalls = 0
    private var pluginListCalls = 0
    private(set) var invocations: [CodexPluginSetupInvocation] = []

    init(marketplaceRoot: String, pluginRoot: String) {
        self.marketplaceRoot = marketplaceRoot
        self.pluginRoot = pluginRoot
        marketplaceAddReceiptRoot = marketplaceRoot
    }

    func installOwned(version: String = "0.1.0", enabled: Bool = true) {
        lock.lock()
        marketplaces = [(CodexPluginSetupManager.marketplaceName, marketplaceRoot)]
        plugins = [ownedPlugin(version: version, enabled: enabled)]
        lock.unlock()
    }

    func snapshotInvocations() -> [CodexPluginSetupInvocation] {
        lock.lock()
        defer { lock.unlock() }
        return invocations
    }

    func run(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) throws -> CodexPluginSetupProcessResult {
        lock.lock()
        defer { lock.unlock() }
        invocations.append(CodexPluginSetupInvocation(
            executable: executable.path,
            arguments: arguments,
            timeoutMilliseconds: timeoutMilliseconds
        ))

        switch arguments {
        case ["plugin", "marketplace", "list", "--json"]:
            marketplaceListCalls += 1
            if malformedMarketplaceListOnCall == marketplaceListCalls {
                return success(["marketplaces": "not-an-array"])
            }
            return success([
                "marketplaces": marketplaces.map {
                    ["name": $0.name, "root": $0.root, "futureField": true] as [String: Any]
                },
                "futureTopLevel": "allowed",
            ])

        case ["plugin", "list", "--json"]:
            pluginListCalls += 1
            if let pending = pluginAppendedOnListCall,
               pending.call == pluginListCalls
            {
                plugins.append(pending.plugin)
                pluginAppendedOnListCall = nil
            }
            if malformedPluginListOnCall == pluginListCalls {
                return CodexPluginSetupProcessResult(
                    exitCode: 0,
                    stdout: Data("[]".utf8)
                )
            }
            return success([
                "installed": plugins,
                "available": [],
                "futureTopLevel": "allowed",
            ])

        case [
            "plugin", "marketplace", "add", marketplaceRoot, "--json",
        ]:
            let existed = marketplaces.contains {
                $0.name == CodexPluginSetupManager.marketplaceName
            }
            if !existed, marketplaceAddCreatesMarketplace {
                marketplaces.append((CodexPluginSetupManager.marketplaceName, marketplaceRoot))
            }
            var receipt: [String: Any] = [
                "marketplaceName": marketplaceAddReceiptName,
                "installedRoot": marketplaceAddReceiptRoot,
            ]
            if let alreadyAdded = marketplaceAddReceiptAlreadyAdded {
                receipt["alreadyAdded"] = alreadyAdded
            }
            return mutationSuccess(receipt, arguments: arguments)

        case ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"]:
            if pluginAddExitCode == 0, pluginAddCreatesPlugin {
                plugins = [ownedPlugin(version: bundledVersion, enabled: true)]
            }
            let normal = CodexPluginSetupProcessResult(
                exitCode: pluginAddExitCode,
                stdout: try StrictJSONTransport.data(forJSONObject: [
                    "pluginId": CodexPluginSetupManager.pluginSelector,
                    "version": bundledVersion,
                ])
            )
            return malformedMutationArguments == arguments
                ? malformedMutationResult(exitCode: pluginAddExitCode)
                : normal

        case ["plugin", "remove", CodexPluginSetupManager.pluginSelector, "--json"]:
            if pluginRemoveCreatesEffect {
                plugins.removeAll {
                    $0["pluginId"] as? String == CodexPluginSetupManager.pluginSelector
                }
            }
            return mutationSuccess([
                "pluginId": CodexPluginSetupManager.pluginSelector,
            ], arguments: arguments)

        case [
            "plugin", "marketplace", "remove", CodexPluginSetupManager.marketplaceName,
            "--json",
        ]:
            if marketplaceRemoveCreatesEffect {
                marketplaces.removeAll { $0.name == CodexPluginSetupManager.marketplaceName }
            }
            return mutationSuccess([
                "marketplaceName": CodexPluginSetupManager.marketplaceName,
            ], arguments: arguments)

        default:
            throw CoordinatorError("unexpected_codex_plugin_setup_invocation")
        }
    }

    private func ownedPlugin(version: String, enabled: Bool) -> [String: Any] {
        [
            "pluginId": CodexPluginSetupManager.pluginSelector,
            "name": CodexPluginSetupManager.pluginName,
            "marketplaceName": CodexPluginSetupManager.marketplaceName,
            "version": version,
            "installed": true,
            "enabled": enabled,
            "source": [
                "source": "local",
                "path": pluginRoot,
                "futureField": "allowed",
            ],
            "futureField": "allowed",
        ]
    }

    private func success(_ object: [String: Any]) -> CodexPluginSetupProcessResult {
        CodexPluginSetupProcessResult(
            exitCode: 0,
            stdout: try! StrictJSONTransport.data(forJSONObject: object)
        )
    }

    private func mutationSuccess(
        _ object: [String: Any],
        arguments: [String]
    ) -> CodexPluginSetupProcessResult {
        guard malformedMutationArguments != arguments else {
            return malformedMutationResult(exitCode: 0)
        }
        return success(object)
    }

    private func malformedMutationResult(exitCode: Int32) -> CodexPluginSetupProcessResult {
        CodexPluginSetupProcessResult(exitCode: exitCode, stdout: Data("[]".utf8))
    }
}

private final class CodexPluginSetupFixture {
    let root: URL
    let pluginRoot: URL
    let executable = URL(fileURLWithPath: "/tmp/blabee-fake-codex")
    let fake: CodexPluginSetupFakeCLI

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-plugin-setup-\(UUID().uuidString)", isDirectory: true)
        pluginRoot = root.appendingPathComponent("Plugin/blabee", isDirectory: true)
        let marketplaceDirectory = root
            .appendingPathComponent(".agents/plugins", isDirectory: true)
        let pluginManifestDirectory = pluginRoot
            .appendingPathComponent(".codex-plugin", isDirectory: true)
        try FileManager.default.createDirectory(
            at: marketplaceDirectory,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: pluginManifestDirectory,
            withIntermediateDirectories: true
        )
        try StrictJSONTransport.data(forJSONObject: [
            "name": CodexPluginSetupManager.marketplaceName,
            "interface": ["displayName": "Blabee"],
            "plugins": [[
                "name": CodexPluginSetupManager.pluginName,
                "source": ["source": "local", "path": "./Plugin/blabee"],
                "futureField": true,
            ]],
            "futureField": true,
        ]).write(
            to: marketplaceDirectory.appendingPathComponent("marketplace.json")
        )
        try StrictJSONTransport.data(forJSONObject: [
            "name": CodexPluginSetupManager.pluginName,
            "version": "0.1.0",
            "futureField": true,
        ]).write(
            to: pluginManifestDirectory.appendingPathComponent("plugin.json")
        )
        fake = CodexPluginSetupFakeCLI(
            marketplaceRoot: root.path,
            pluginRoot: pluginRoot.path
        )
    }

    deinit {
        try? FileManager.default.removeItem(at: root)
    }

    func manager(
        requireStandardApplicationRoot: Bool = false,
        resolver: CodexPluginSetupExecutableResolving? = nil,
        processRunner: CodexPluginSetupProcessRunning? = nil,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil
    ) -> CodexPluginSetupManager {
        let selectedResolver = resolver ?? { [executable] in executable }
        let selectedRunner = processRunner ?? fake.run
        return CodexPluginSetupManager(
            marketplaceRoot: root,
            requireStandardApplicationRoot: requireStandardApplicationRoot,
            executableResolver: selectedResolver,
            processRunner: selectedRunner,
            bundleRevalidator: bundleRevalidator,
            mutationLock: mutationLock
        )
    }

    func manager(
        qualifier: @escaping CodexPluginSetupExecutableQualifying,
        revalidator: @escaping CodexPluginSetupExecutableRevalidating,
        processRunner: CodexPluginSetupProcessRunning? = nil,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil
    ) -> CodexPluginSetupManager {
        let selectedRunner = processRunner ?? fake.run
        return CodexPluginSetupManager(
            marketplaceRoot: root,
            executableQualifier: qualifier,
            executableRevalidator: revalidator,
            processRunner: selectedRunner,
            bundleRevalidator: bundleRevalidator,
            mutationLock: mutationLock
        )
    }
}

private final class CodexPluginSetupTrustProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var qualificationCount = 0
    private var revalidationCount = 0

    func qualify(_ executable: URL) -> CodexPluginSetupQualifiedExecutable {
        lock.lock()
        qualificationCount += 1
        lock.unlock()
        return .testOnly(url: executable)
    }

    func revalidate(
        _ selection: CodexPluginSetupQualifiedExecutable
    ) -> URL {
        lock.lock()
        revalidationCount += 1
        lock.unlock()
        return selection.canonicalURL
    }

    func snapshot() -> (qualifications: Int, revalidations: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (qualificationCount, revalidationCount)
    }
}

private final class CodexPluginSetupProcessProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func record() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    func snapshot() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private final class CodexPluginSetupBundleProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let failureCall: Int?
    private var count = 0

    init(failureCall: Int? = nil) {
        self.failureCall = failureCall
    }

    func validate() throws {
        lock.lock()
        count += 1
        let shouldFail = count == failureCall
        lock.unlock()
        if shouldFail {
            throw CoordinatorError("codex_plugin_setup_bundle_identity_invalid")
        }
    }

    func snapshot() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private final class CodexPluginSetupOperationProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var errorCode: String?

    func record(_ error: Error?) {
        lock.lock()
        errorCode = (error as? CoordinatorError)?.code
            ?? error.map { String(describing: $0) }
        lock.unlock()
    }

    func snapshot() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return errorCode
    }
}

private func pluginSetupMutationArguments(
    _ fixture: CodexPluginSetupFixture
) -> [[String]] {
    fixture.fake.snapshotInvocations().compactMap { invocation in
        switch invocation.arguments {
        case ["plugin", "marketplace", "list", "--json"],
             ["plugin", "list", "--json"]:
            return nil
        default:
            return invocation.arguments
        }
    }
}

@Test("Passive Codex Plugin inspection never mutates configuration")
func codexPluginSetupPassiveInspectionDoesNotMutate() async throws {
    let fixture = try CodexPluginSetupFixture()
    let state = await fixture.manager().inspect()

    #expect(state == .notInstalled)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
    #expect(fixture.fake.snapshotInvocations().map(\.arguments) == [
        ["plugin", "marketplace", "list", "--json"],
        ["plugin", "list", "--json"],
    ])
    #expect(fixture.fake.snapshotInvocations().allSatisfy {
        $0.executable == fixture.executable.path && $0.timeoutMilliseconds == 5_000
    })
}

@Test("Connect uses only exact official Codex Plugin argv and verifies post-state")
func codexPluginSetupConnectsWithExactArguments() async throws {
    let fixture = try CodexPluginSetupFixture()
    let state = await fixture.manager().connect()

    #expect(state == .installedNeedsHookReview(version: "0.1.0"))
    #expect(state.title.contains("Hook"))
    #expect(state.detail.contains("새 Codex 세션"))
    #expect(state.detail.contains("/hooks"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
    #expect(fixture.fake.snapshotInvocations()
        .filter { pluginSetupMutationArguments(fixture).contains($0.arguments) }
        .allSatisfy { $0.timeoutMilliseconds == 15_000 })
}

@Test("Repeated connect is idempotent after exact installation")
func codexPluginSetupConnectIsIdempotent() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned()
    let manager = fixture.manager()

    #expect(await manager.connect() == .installedNeedsHookReview(version: "0.1.0"))
    #expect(await manager.connect() == .installedNeedsHookReview(version: "0.1.0"))
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Malformed Codex JSON fails closed without mutation")
func codexPluginSetupRejectsMalformedJSON() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.malformedMarketplaceListOnCall = 1

    #expect(await fixture.manager().connect() == .error(code: "marketplace_list_malformed"))
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Plugin installed and enabled fields accept only JSON booleans")
func codexPluginSetupRejectsCoercedPluginBooleans() async throws {
    let scenarios: [(field: String, value: Any)] = [
        ("installed", 1),
        ("enabled", 0),
        ("installed", "true"),
        ("enabled", "false"),
    ]
    for scenario in scenarios {
        let fixture = try CodexPluginSetupFixture()
        fixture.fake.installOwned()
        fixture.fake.plugins[0][scenario.field] = scenario.value

        #expect(await fixture.manager().connect() == .error(
            code: "plugin_list_malformed"
        ))
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
}

@Test("Same marketplace name with a different root is a conflict")
func codexPluginSetupRejectsMarketplaceRootConflict() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.marketplaces = [
        (CodexPluginSetupManager.marketplaceName, "/tmp/not-owned-by-blabee"),
    ]

    let state = await fixture.manager().connect()
    guard case .conflict = state else {
        Issue.record("Expected a fail-closed marketplace conflict, got \(state)")
        return
    }
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Blabee from another marketplace is never removed automatically")
func codexPluginSetupRejectsOtherMarketplacePlugin() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.marketplaces = [("team-marketplace", "/tmp/team-marketplace")]
    fixture.fake.plugins = [[
        "pluginId": "blabee@team-marketplace",
        "name": "blabee",
        "marketplaceName": "team-marketplace",
        "version": "9.0.0",
        "installed": true,
        "enabled": true,
        "source": ["source": "local", "path": "/tmp/team-marketplace/blabee"],
    ]]

    let state = await fixture.manager().disconnect()
    guard case .conflict = state else {
        Issue.record("Expected a fail-closed plugin conflict, got \(state)")
        return
    }
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Foreign Plugin in the owned marketplace is always a conflict")
func codexPluginSetupRejectsForeignPluginInOwnedMarketplace() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.marketplaces = [
        (CodexPluginSetupManager.marketplaceName, fixture.root.path),
    ]
    fixture.fake.plugins = [pluginSetupForeignMarketplacePlugin()]

    guard case .conflict = await fixture.manager().disconnect() else {
        Issue.record("Expected a fail-closed foreign Plugin conflict")
        return
    }
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Disconnect rechecks for foreign marketplace Plugins before removal")
func codexPluginSetupDisconnectBlocksLateForeignPlugin() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned()
    fixture.fake.pluginAppendedOnListCall = (
        call: 2,
        plugin: pluginSetupForeignMarketplacePlugin()
    )

    guard case .conflict = await fixture.manager().disconnect() else {
        Issue.record("Expected a late foreign Plugin conflict")
        return
    }
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

private func pluginSetupForeignMarketplacePlugin() -> [String: Any] {
    [
        "pluginId": "foreign@\(CodexPluginSetupManager.marketplaceName)",
        "name": "foreign",
        "marketplaceName": CodexPluginSetupManager.marketplaceName,
        "version": "1.0.0",
        "installed": true,
        "enabled": true,
        "source": ["source": "local", "path": "/tmp/foreign-plugin"],
    ]
}

@Test("Failed plugin add cleans only the marketplace created by this call")
func codexPluginSetupCleansUnambiguousPartialInstall() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.pluginAddExitCode = 19
    fixture.fake.pluginAddCreatesPlugin = false

    #expect(await fixture.manager().connect() == .error(code: "plugin_add_failed"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
        [
            "plugin", "marketplace", "remove", CodexPluginSetupManager.marketplaceName,
            "--json",
        ],
    ])
}

@Test("Automatic cleanup stops when a foreign marketplace Plugin appears")
func codexPluginSetupCleanupBlocksLateForeignPlugin() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.pluginAddExitCode = 19
    fixture.fake.pluginAddCreatesPlugin = false
    fixture.fake.pluginAppendedOnListCall = (
        call: 5,
        plugin: pluginSetupForeignMarketplacePlugin()
    )

    guard case .conflict = await fixture.manager().connect() else {
        Issue.record("Expected cleanup to stop at a late foreign Plugin conflict")
        return
    }
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
}

@Test("Marketplace-only state is explicit and connect retries only plugin add")
func codexPluginSetupRetriesMarketplaceOnlyInstall() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.marketplaces = [
        (CodexPluginSetupManager.marketplaceName, fixture.root.path),
    ]
    let manager = fixture.manager()

    #expect(await manager.inspect() == .marketplaceInstalledNeedsPlugin)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
    #expect(await manager.connect() == .installedNeedsHookReview(version: "0.1.0"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
}

@Test("Plugin add exit zero without effect is not installation success")
func codexPluginSetupRejectsNoEffectPluginAdd() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.pluginAddCreatesPlugin = false

    #expect(await fixture.manager().connect() == .error(code: "plugin_add_not_applied"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
        [
            "plugin", "marketplace", "remove", CodexPluginSetupManager.marketplaceName,
            "--json",
        ],
    ])
}

@Test("Marketplace already-added receipt is never treated as cleanup ownership")
func codexPluginSetupDoesNotClaimIdempotentMarketplaceAdd() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.marketplaceAddReceiptAlreadyAdded = true
    fixture.fake.pluginAddExitCode = 19
    fixture.fake.pluginAddCreatesPlugin = false

    #expect(await fixture.manager().connect() == .marketplaceInstalledNeedsPlugin)
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
}

@Test("Marketplace add receipt fields must exactly match the Codex contract")
func codexPluginSetupRejectsInvalidMarketplaceAddReceiptFields() async throws {
    for scenario in [
        "missing", "string-bool", "numeric-bool", "wrong-name", "wrong-root",
    ] {
        let fixture = try CodexPluginSetupFixture()
        fixture.fake.pluginAddExitCode = 19
        fixture.fake.pluginAddCreatesPlugin = false
        switch scenario {
        case "missing":
            fixture.fake.marketplaceAddReceiptAlreadyAdded = nil
        case "string-bool":
            fixture.fake.marketplaceAddReceiptAlreadyAdded = "false"
        case "numeric-bool":
            fixture.fake.marketplaceAddReceiptAlreadyAdded = 0
        case "wrong-name":
            fixture.fake.marketplaceAddReceiptName = "other-marketplace"
        case "wrong-root":
            fixture.fake.marketplaceAddReceiptRoot = "/tmp/not-blabee-resources"
        default:
            Issue.record("Unexpected scenario: \(scenario)")
        }

        #expect(await fixture.manager().connect() == .error(
            code: "marketplace_add_unverified"
        ))
        #expect(pluginSetupMutationArguments(fixture) == [
            ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ])
    }
}

@Test("Malformed marketplace mutation JSON cannot authorize cleanup")
func codexPluginSetupRejectsMalformedMutationReceipt() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.malformedMutationArguments = [
        "plugin", "marketplace", "add", fixture.root.path, "--json",
    ]
    fixture.fake.pluginAddExitCode = 19
    fixture.fake.pluginAddCreatesPlugin = false

    #expect(await fixture.manager().connect() == .error(
        code: "marketplace_add_unverified"
    ))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
    ])
}

@Test("Ambiguous post-install state is never deleted")
func codexPluginSetupDoesNotCleanAmbiguousPartialInstall() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.pluginAddExitCode = 19
    fixture.fake.pluginAddCreatesPlugin = false
    fixture.fake.malformedMarketplaceListOnCall = 4

    #expect(await fixture.manager().connect() == .error(code: "marketplace_list_malformed"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
}

@Test("Marketplace remove exit zero without effect preserves cleanup-needed state")
func codexPluginSetupRejectsNoEffectMarketplaceRemove() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.marketplaces = [
        (CodexPluginSetupManager.marketplaceName, fixture.root.path),
    ]
    fixture.fake.marketplaceRemoveCreatesEffect = false

    #expect(await fixture.manager().disconnect() == .marketplaceInstalledNeedsPlugin)
    #expect(pluginSetupMutationArguments(fixture) == [[
        "plugin", "marketplace", "remove", CodexPluginSetupManager.marketplaceName,
        "--json",
    ]])
}

@Test("Disconnect removes only the exact owned plugin and marketplace")
func codexPluginSetupDisconnectsOwnedInstallation() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned()

    #expect(await fixture.manager().disconnect() == .notInstalled)
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "remove", CodexPluginSetupManager.pluginSelector, "--json"],
        [
            "plugin", "marketplace", "remove", CodexPluginSetupManager.marketplaceName,
            "--json",
        ],
    ])
}

@Test("Disconnect rechecks ownership immediately before destructive cleanup")
func codexPluginSetupDisconnectRechecksOwnershipBeforeRemoval() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned()
    fixture.fake.malformedPluginListOnCall = 2

    #expect(await fixture.manager().disconnect() == .error(
        code: "plugin_list_malformed"
    ))
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Installed version and enabled flag must match bundled plugin")
func codexPluginSetupReportsUpdateAvailable() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned(version: "0.0.9", enabled: false)

    #expect(await fixture.manager().inspect() == .updateAvailable(
        installedVersion: "0.0.9",
        bundledVersion: "0.1.0"
    ))
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Update reinstalls in place without removing the last working plugin first")
func codexPluginSetupUpdatesWithoutDestructivePreRemoval() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned(version: "0.0.9", enabled: true)

    #expect(await fixture.manager().connect() == .installedNeedsHookReview(version: "0.1.0"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
}

@Test("Failed update preserves the previously installed plugin")
func codexPluginSetupFailedUpdatePreservesOldPlugin() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned(version: "0.0.9", enabled: true)
    fixture.fake.pluginAddExitCode = 19
    fixture.fake.pluginAddCreatesPlugin = false

    #expect(await fixture.manager().connect() == .error(code: "plugin_update_add_failed"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
    #expect(await fixture.manager().inspect() == .updateAvailable(
        installedVersion: "0.0.9",
        bundledVersion: "0.1.0"
    ))
}

@Test("Update exit zero without effect remains update available")
func codexPluginSetupRejectsNoEffectUpdate() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned(version: "0.0.9", enabled: true)
    fixture.fake.pluginAddCreatesPlugin = false

    #expect(await fixture.manager().connect() == .updateAvailable(
        installedVersion: "0.0.9",
        bundledVersion: "0.1.0"
    ))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
}

@Test("Every Plugin CLI call revalidates the selected Codex identity")
func codexPluginSetupRevalidatesBeforeEveryInvocation() async throws {
    let fixture = try CodexPluginSetupFixture()
    let probe = CodexPluginSetupTrustProbe()
    let executable = fixture.executable
    let manager = fixture.manager(
        qualifier: { probe.qualify(executable) },
        revalidator: probe.revalidate
    )

    #expect(await manager.connect() == .installedNeedsHookReview(version: "0.1.0"))
    let counts = probe.snapshot()
    #expect(counts.qualifications == 4)
    #expect(counts.revalidations == fixture.fake.snapshotInvocations().count * 2)
    #expect(counts.revalidations == 20)
}

@Test("Revalidation drift prevents Codex Plugin subprocess execution")
func codexPluginSetupRevalidationFailureFailsClosed() async throws {
    let fixture = try CodexPluginSetupFixture()
    let executable = fixture.executable
    let manager = fixture.manager(
        qualifier: { .testOnly(url: executable) },
        revalidator: { _ in
            throw CodexRuntimeTrustError.approvalDrift
        }
    )

    #expect(await manager.connect() == .error(code: "marketplace_list_failed"))
    #expect(fixture.fake.snapshotInvocations().isEmpty)
}

@Test("Bundle identity drift immediately before mutation prevents execution")
func codexPluginSetupBundleDriftBeforeMutationFailsClosed() async throws {
    let fixture = try CodexPluginSetupFixture()
    let probe = CodexPluginSetupBundleProbe(failureCall: 2)
    let manager = fixture.manager(bundleRevalidator: probe.validate)

    #expect(await manager.connect() == .error(code: "marketplace_add_failed"))
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
    #expect(probe.snapshot() == 2)
}

@Test("Bundle identity drift after mutation cannot be reported as success")
func codexPluginSetupBundleDriftAfterMutationFailsClosed() async throws {
    let fixture = try CodexPluginSetupFixture()
    let probe = CodexPluginSetupBundleProbe(failureCall: 3)
    let manager = fixture.manager(bundleRevalidator: probe.validate)

    #expect(await manager.connect() == .error(code: "marketplace_add_unverified"))
    #expect(pluginSetupMutationArguments(fixture) == [[
        "plugin", "marketplace", "add", fixture.root.path, "--json",
    ]])
    #expect(probe.snapshot() == 3)
}

@Test("Plugin subprocess environment removes ambient override variables")
func codexPluginSetupProcessEnvironmentIsSanitized() {
    let sanitized = CodexPluginSetupProcessRunner.sanitizedEnvironment([
        "HOME": "/Users/example",
        "PATH": "/usr/bin:/bin",
        "LANG": "ko_KR.UTF-8",
        "CODEX_HOME": "/tmp/attacker-codex-home",
        "DYLD_INSERT_LIBRARIES": "/tmp/injected.dylib",
        "LD_PRELOAD": "/tmp/injected.so",
        "NODE_OPTIONS": "--require=/tmp/injected.js",
        "BLABEE_MANAGED_CODEX_AUTH_TOKEN": "must-not-leak",
        "UNRELATED_SECRET": "must-not-leak",
    ])

    #expect(sanitized == [
        "HOME": "/Users/example",
        "PATH": "/usr/bin:/bin",
        "LANG": "ko_KR.UTF-8",
    ])
}

@Test("Mutation lock contention fails closed within its bounded deadline")
func codexPluginSetupMutationLockHasBoundedContention() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-lock-\(UUID().uuidString)", isDirectory: true)
    let lockURL = root.appendingPathComponent("runtime/plugin.lock", isDirectory: false)
    defer { try? FileManager.default.removeItem(at: root) }

    let holder = CodexPluginSetupMutationLock(
        lockURL: lockURL,
        timeoutMilliseconds: 1_000
    )
    let contender = CodexPluginSetupMutationLock(
        lockURL: lockURL,
        timeoutMilliseconds: 50
    )
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    let finished = DispatchSemaphore(value: 0)
    let holderResult = CodexPluginSetupOperationProbe()
    DispatchQueue.global(qos: .userInitiated).async {
        defer { finished.signal() }
        do {
            try holder.withLock {
                entered.signal()
                _ = release.wait(timeout: .now() + .seconds(2))
            }
            holderResult.record(nil)
        } catch {
            holderResult.record(error)
        }
    }
    guard entered.wait(timeout: .now() + .seconds(1)) == .success else {
        release.signal()
        _ = finished.wait(timeout: .now() + .seconds(1))
        Issue.record("Lock holder did not enter its critical section")
        return
    }

    let started = DispatchTime.now().uptimeNanoseconds
    do {
        try contender.withLock {}
        Issue.record("Contended mutation lock unexpectedly succeeded")
    } catch let error as CoordinatorError {
        #expect(error.code == "codex_plugin_setup_lock_unavailable")
    }
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000
    #expect(elapsedMilliseconds < 500)
    release.signal()
    #expect(finished.wait(timeout: .now() + .seconds(1)) == .success)
    #expect(holderResult.snapshot() == nil)
}

@Test("Mutation lock serializes separate Blabee processes")
func codexPluginSetupMutationLockSerializesProcesses() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-lock-process-\(UUID().uuidString)", isDirectory: true)
    let lockURL = root.appendingPathComponent("runtime/plugin.lock", isDirectory: false)
    defer { try? FileManager.default.removeItem(at: root) }

    let initializer = CodexPluginSetupMutationLock(lockURL: lockURL)
    try initializer.withLock {}
    let holder = Process()
    let holderOutput = Pipe()
    holder.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    holder.arguments = [
        "-MFcntl=:flock",
        "-e",
        #"open(my $fh, "+<", $ARGV[0]) or exit 2; flock($fh, LOCK_EX) or exit 3; $| = 1; print "ready\n"; select(undef, undef, undef, 0.3);"#,
        lockURL.path,
    ]
    holder.standardOutput = holderOutput
    try holder.run()
    defer {
        if holder.isRunning { holder.terminate() }
        holder.waitUntilExit()
    }
    let ready = holderOutput.fileHandleForReading.readData(ofLength: 6)
    guard String(data: ready, encoding: .utf8) == "ready\n" else {
        Issue.record("Child process did not acquire the filesystem lock")
        return
    }

    let contender = CodexPluginSetupMutationLock(
        lockURL: lockURL,
        timeoutMilliseconds: 50
    )
    #expect(throws: CoordinatorError.self) {
        try contender.withLock {}
    }
    holder.waitUntilExit()
    #expect(holder.terminationStatus == 0)
}

@Test("Mutation lock rejects a symbolic-link ancestor")
func codexPluginSetupMutationLockRejectsSymlinkAncestor() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-lock-link-\(UUID().uuidString)", isDirectory: true)
    let real = root.appendingPathComponent("real", isDirectory: true)
    let alias = root.appendingPathComponent("alias", isDirectory: true)
    try FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: real)
    defer { try? FileManager.default.removeItem(at: root) }

    let lock = CodexPluginSetupMutationLock(
        lockURL: alias.appendingPathComponent("runtime/plugin.lock"),
        timeoutMilliseconds: 50
    )
    #expect(throws: CoordinatorError.self) {
        try lock.withLock {}
    }
}

@Test("Mutation lock rejects a writable untrusted ancestor")
func codexPluginSetupMutationLockRejectsUnsafeAncestorMode() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-lock-mode-\(UUID().uuidString)", isDirectory: true)
    let unsafe = root.appendingPathComponent("unsafe", isDirectory: true)
    try FileManager.default.createDirectory(at: unsafe, withIntermediateDirectories: true)
    #expect(chmod(unsafe.path, mode_t(0o777)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let lock = CodexPluginSetupMutationLock(
        lockURL: unsafe.appendingPathComponent("runtime/plugin.lock"),
        timeoutMilliseconds: 50
    )
    #expect(throws: CoordinatorError.self) {
        try lock.withLock {}
    }
}

@Test("Mutation lock rejects grant ACLs on every ancestor")
func codexPluginSetupMutationLockRejectsAncestorGrantACL() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-lock-acl-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try pluginSetupAddACL(
        at: root,
        rule: "user:\(NSUserName()) allow read"
    )
    defer {
        try? pluginSetupRemoveACL(at: root)
        try? FileManager.default.removeItem(at: root)
    }

    let lock = CodexPluginSetupMutationLock(
        lockURL: root.appendingPathComponent("runtime/plugin.lock"),
        timeoutMilliseconds: 50
    )
    #expect(throws: CoordinatorError.self) {
        try lock.withLock {}
    }
}

@Test("Mutation lock permits deny-only ACLs on ancestors")
func codexPluginSetupMutationLockPermitsAncestorDenyACL() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-lock-deny-acl-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try pluginSetupAddACL(at: root, rule: "group:everyone deny delete")
    defer {
        try? pluginSetupRemoveACL(at: root)
        try? FileManager.default.removeItem(at: root)
    }

    let lock = CodexPluginSetupMutationLock(
        lockURL: root.appendingPathComponent("runtime/plugin.lock"),
        timeoutMilliseconds: 50
    )
    try lock.withLock {}
}

@Test("Mutation lock rejects grant ACLs on the lock file")
func codexPluginSetupMutationLockRejectsLockFileGrantACL() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-file-acl-\(UUID().uuidString)", isDirectory: true)
    let lockURL = root.appendingPathComponent("runtime/plugin.lock")
    let lock = CodexPluginSetupMutationLock(lockURL: lockURL)
    try lock.withLock {}
    try pluginSetupAddACL(
        at: lockURL,
        rule: "user:\(NSUserName()) allow read"
    )
    defer {
        try? pluginSetupRemoveACL(at: lockURL)
        try? FileManager.default.removeItem(at: root)
    }

    #expect(throws: CoordinatorError.self) {
        try lock.withLock {}
    }
}

@Test("Mutation lock permits deny-only ACLs on the lock file")
func codexPluginSetupMutationLockPermitsLockFileDenyACL() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-file-deny-acl-\(UUID().uuidString)", isDirectory: true)
    let lockURL = root.appendingPathComponent("runtime/plugin.lock")
    let lock = CodexPluginSetupMutationLock(lockURL: lockURL)
    try lock.withLock {}
    try pluginSetupAddACL(at: lockURL, rule: "group:everyone deny delete")
    defer {
        try? pluginSetupRemoveACL(at: lockURL)
        try? FileManager.default.removeItem(at: root)
    }

    try lock.withLock {}
}

private func pluginSetupAddACL(at url: URL, rule: String) throws {
    try pluginSetupRunChmod(["+a", rule, url.path])
}

private func pluginSetupRemoveACL(at url: URL) throws {
    try pluginSetupRunChmod(["-N", url.path])
}

private func pluginSetupRunChmod(_ arguments: [String]) throws {
    let process = Process()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/chmod")
    process.arguments = arguments
    process.standardOutput = Pipe()
    process.standardError = errors
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        let message = String(
            data: errors.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? "unknown chmod error"
        throw CoordinatorError(
            "codex_plugin_setup_acl_fixture_failed",
            message
        )
    }
}

@Test("Every inspect rediscovers the Codex executable")
func codexPluginSetupRediscoversExecutable() async throws {
    let fixture = try CodexPluginSetupFixture()
    final class ResolverCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        func resolve(_ executable: URL) -> URL {
            lock.lock()
            count += 1
            lock.unlock()
            return executable
        }
        func snapshot() -> Int {
            lock.lock()
            defer { lock.unlock() }
            return count
        }
    }
    let counter = ResolverCounter()
    let executable = fixture.executable
    let manager = fixture.manager(resolver: {
        counter.resolve(executable)
    })

    _ = await manager.inspect()
    _ = await manager.inspect()
    #expect(counter.snapshot() == 2)
}

@Test("Production manager refuses nonstandard app locations before running Codex")
func codexPluginSetupLiveLocationFailsClosed() async throws {
    let fixture = try CodexPluginSetupFixture()

    let state = await fixture.manager(requireStandardApplicationRoot: true).connect()
    guard case let .unavailable(reason) = state else {
        Issue.record("Expected unavailable state, got \(state)")
        return
    }
    #expect(reason.contains("/Applications"))
    #expect(fixture.fake.snapshotInvocations().isEmpty)
}

@Test("Bundled manifests reject symbolic links without invoking Codex")
func codexPluginSetupManifestRejectsSymbolicLink() async throws {
    let fixture = try CodexPluginSetupFixture()
    let manifest = fixture.root
        .appendingPathComponent(".agents/plugins/marketplace.json")
    let target = fixture.root.appendingPathComponent("marketplace-target.json")
    try FileManager.default.copyItem(at: manifest, to: target)
    try FileManager.default.removeItem(at: manifest)
    try FileManager.default.createSymbolicLink(at: manifest, withDestinationURL: target)

    guard case .unavailable = await fixture.manager().inspect() else {
        Issue.record("Expected symbolic-link manifest to fail closed")
        return
    }
    #expect(fixture.fake.snapshotInvocations().isEmpty)
}

@Test("Bundled manifests reject FIFOs without blocking or invoking Codex")
func codexPluginSetupManifestRejectsFIFO() async throws {
    let fixture = try CodexPluginSetupFixture()
    let manifest = fixture.pluginRoot
        .appendingPathComponent(".codex-plugin/plugin.json")
    try FileManager.default.removeItem(at: manifest)
    #expect(mkfifo(manifest.path, mode_t(0o600)) == 0)

    let started = DispatchTime.now().uptimeNanoseconds
    guard case .unavailable = await fixture.manager().inspect() else {
        Issue.record("Expected FIFO manifest to fail closed")
        return
    }
    let elapsedMilliseconds = (
        DispatchTime.now().uptimeNanoseconds - started
    ) / 1_000_000
    #expect(elapsedMilliseconds < 500)
    #expect(fixture.fake.snapshotInvocations().isEmpty)
}

@Test("Codex discovery sorts nvm versions by numeric semver descending")
func codexPluginSetupSortsNVMVersionsNumerically() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-nvm-\(UUID().uuidString)", isDirectory: true)
    let v22Executable = root
        .appendingPathComponent(".nvm/versions/node/v22.14.0/bin/codex", isDirectory: false)
    let v9Executable = root
        .appendingPathComponent(".nvm/versions/node/v9.11.2/bin/codex", isDirectory: false)
    try FileManager.default.createDirectory(
        at: v22Executable.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
        at: v9Executable.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: v22Executable)
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: v9Executable)
    #expect(chmod(v22Executable.path, mode_t(0o700)) == 0)
    #expect(chmod(v9Executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let candidates = CodexPluginSetupExecutableResolver.candidateURLs(environment: [
        "HOME": root.path,
        "PATH": "/does/not/exist",
    ], fixedCandidates: [])
    let nvmCandidates = candidates.filter { $0.path.contains("/.nvm/versions/node/") }
    #expect(nvmCandidates.map(\.path) == [v22Executable.path, v9Executable.path])
}

@Test("Unsupported preferred Codex candidate falls through to supported candidate")
func codexPluginSetupFallsThroughUnsupportedCandidate() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-fallback-\(UUID().uuidString)", isDirectory: true)
    let unsupported = root.appendingPathComponent("preferred-codex")
    let supported = root.appendingPathComponent("fallback-codex")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("unsupported".utf8).write(to: unsupported)
    try Data("supported".utf8).write(to: supported)
    defer { try? FileManager.default.removeItem(at: root) }

    var attempted: [String] = []
    let selected = try CodexPluginSetupExecutableResolver.qualifyFirst(
        candidates: [unsupported, supported],
        qualifier: { candidate in
            attempted.append(candidate.path)
            guard candidate == supported else {
                throw CodexRuntimeTrustError.unsupportedVersion("0.150.1")
            }
            return .testOnly(url: candidate, version: "0.152.1")
        }
    )

    #expect(attempted == [unsupported.path, supported.path])
    #expect(selected.canonicalURL.path == supported.path)
    #expect(selected.version == "0.152.1")
}

@Test("Production Plugin CLI allowlist is explicit")
func codexPluginSetupProductionAllowlistIsExplicit() {
    #expect(CodexPluginSetupProductionTrust.supportedPluginCLIVersions == [
        "0.151.0", "0.152.0", "0.152.1",
    ])
}

@Test("Production Plugin CLI version gate rejects unsupported canonical output")
func codexPluginSetupProductionVersionGateRejectsUnsupportedVersion() throws {
    let unsupported = CodexPluginSetupProcessResult(
        exitCode: 0,
        stdout: Data("codex-cli 0.150.1\n".utf8)
    )
    #expect(throws: CodexRuntimeTrustError.unsupportedVersion("0.150.1")) {
        try CodexPluginSetupProductionTrust.supportedVersion(from: unsupported)
    }
    let supported = CodexPluginSetupProcessResult(
        exitCode: 0,
        stdout: Data("codex-cli 0.152.1\n".utf8)
    )
    #expect(try CodexPluginSetupProductionTrust.supportedVersion(from: supported) == "0.152.1")
}

@Test("Production qualification rejects a signed non-Codex binary before execution")
func codexPluginSetupProductionRejectsNonCodexSignatureBeforeExecution() {
    let probe = CodexPluginSetupProcessProbe()
    #expect(throws: (any Error).self) {
        try CodexPluginSetupProductionTrust.qualify(
            sourceURL: URL(fileURLWithPath: "/usr/bin/true"),
            processRunner: { _, _, _ in
                probe.record()
                return CodexPluginSetupProcessResult(
                    exitCode: 0,
                    stdout: Data("codex-cli 0.152.1\n".utf8)
                )
            }
        )
    }
    #expect(probe.snapshot() == 0)
}

@Test("NVM candidate cap is applied after numeric sorting")
func codexPluginSetupNVMCapDoesNotHideNewestVersion() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-nvm-cap-\(UUID().uuidString)", isDirectory: true)
    let versionsRoot = root.appendingPathComponent(".nvm/versions/node", isDirectory: true)
    for major in 1 ... 140 {
        try FileManager.default.createDirectory(
            at: versionsRoot.appendingPathComponent("v\(major).0.0", isDirectory: true),
            withIntermediateDirectories: true
        )
    }
    defer { try? FileManager.default.removeItem(at: root) }

    let candidates = CodexPluginSetupExecutableResolver.candidateURLs(environment: [
        "HOME": root.path,
        "PATH": "/does/not/exist",
    ], fixedCandidates: [])
    let nvmCandidates = candidates.filter { $0.path.contains("/.nvm/versions/node/") }
    #expect(nvmCandidates.count == 64)
    #expect(nvmCandidates.first?.path.contains("/v140.0.0/") == true)
    #expect(nvmCandidates.last?.path.contains("/v77.0.0/") == true)
}

@Test("Oversized NVM version directories fail closed without candidates")
func codexPluginSetupRejectsOversizedNVMDirectory() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-nvm-oversized-\(UUID().uuidString)", isDirectory: true)
    let versionsRoot = root.appendingPathComponent(".nvm/versions/node", isDirectory: true)
    for major in 1 ... 257 {
        try FileManager.default.createDirectory(
            at: versionsRoot.appendingPathComponent("v\(major).0.0", isDirectory: true),
            withIntermediateDirectories: true
        )
    }
    defer { try? FileManager.default.removeItem(at: root) }

    let candidates = CodexPluginSetupExecutableResolver.candidateURLs(environment: [
        "HOME": root.path,
        "PATH": "/does/not/exist",
    ], fixedCandidates: [])
    #expect(candidates.filter { $0.path.contains("/.nvm/versions/node/") }.isEmpty)
}

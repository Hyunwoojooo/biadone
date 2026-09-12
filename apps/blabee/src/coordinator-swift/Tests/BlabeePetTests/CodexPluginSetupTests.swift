import Darwin
import CryptoKit
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

        case let arguments
            where arguments.count == 4
                && arguments[0] == "plugin"
                && arguments[1] == "remove"
                && arguments[3] == "--json":
            let selector = arguments[2]
            if pluginRemoveCreatesEffect {
                plugins.removeAll {
                    $0["pluginId"] as? String == selector
                }
            }
            return mutationSuccess([
                "pluginId": selector,
            ], arguments: arguments)

        case let arguments
            where arguments.count == 5
                && arguments[0] == "plugin"
                && arguments[1] == "marketplace"
                && arguments[2] == "remove"
                && arguments[4] == "--json":
            let marketplaceName = arguments[3]
            if marketplaceRemoveCreatesEffect {
                marketplaces.removeAll { $0.name == marketplaceName }
            }
            return mutationSuccess([
                "marketplaceName": marketplaceName,
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
        mutationLock: CodexPluginSetupMutationLock? = nil,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow = {
            DispatchTime.now().uptimeNanoseconds
        },
        operationTimeoutMilliseconds: Int = 45_000
    ) -> CodexPluginSetupManager {
        let selectedResolver = resolver ?? { [executable] in executable }
        let selectedRunner = processRunner ?? fake.run
        return CodexPluginSetupManager(
            marketplaceRoot: root,
            requireStandardApplicationRoot: requireStandardApplicationRoot,
            executableResolver: selectedResolver,
            processRunner: selectedRunner,
            bundleRevalidator: bundleRevalidator,
            mutationLock: mutationLock,
            monotonicNow: monotonicNow,
            operationTimeoutMilliseconds: operationTimeoutMilliseconds
        )
    }

    func manager(
        qualifier: @escaping CodexPluginSetupExecutableQualifying,
        revalidator: @escaping CodexPluginSetupExecutableRevalidating,
        processRunner: CodexPluginSetupProcessRunning? = nil,
        nativeRuntime: CodexNativeRuntime? = nil,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow = {
            DispatchTime.now().uptimeNanoseconds
        },
        operationTimeoutMilliseconds: Int = 45_000
    ) -> CodexPluginSetupManager {
        let selectedRunner = processRunner ?? fake.run
        return CodexPluginSetupManager(
            marketplaceRoot: root,
            executableQualifier: qualifier,
            executableRevalidator: revalidator,
            processRunner: selectedRunner,
            nativeRuntime: nativeRuntime,
            bundleRevalidator: bundleRevalidator,
            mutationLock: mutationLock,
            monotonicNow: monotonicNow,
            operationTimeoutMilliseconds: operationTimeoutMilliseconds
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

private final class CodexPluginSetupManualClock: @unchecked Sendable {
    private let lock = NSLock()
    private var nanoseconds: UInt64 = 0

    func now() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return nanoseconds
    }

    func advance(milliseconds: UInt64) {
        lock.lock()
        nanoseconds += milliseconds * 1_000_000
        lock.unlock()
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

private final class CodexPluginSetupBundleActionProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let actionCall: Int
    private let action: @Sendable () throws -> Void
    private var count = 0
    private var actionWasRun = false

    init(
        actionCall: Int,
        action: @escaping @Sendable () throws -> Void
    ) {
        self.actionCall = actionCall
        self.action = action
    }

    func validate() throws {
        lock.lock()
        count += 1
        let shouldRun = count == actionCall && !actionWasRun
        if shouldRun {
            actionWasRun = true
        }
        lock.unlock()
        if shouldRun {
            try action()
        }
    }

    func snapshot() -> (calls: Int, actionWasRun: Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (count, actionWasRun)
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

private struct CodexPluginSetupPinnedValidationCall: Equatable {
    let executable: String
    let expectedIdentity: CodexRuntimeFileIdentity
    let expectedVersion: String?
}

private final class CodexPluginSetupFallbackTrustProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let artifact: CodexPluginSetupPinnedArtifact
    private let reportedVersion: String
    private let trustSnapshot: CodexRuntimeTrustSnapshot
    private var inspectedPaths: [String] = []
    private var signaturePaths: [String] = []
    private var pinnedCalls: [CodexPluginSetupPinnedValidationCall] = []
    private var processInvocations: [CodexPluginSetupInvocation] = []

    init(
        artifact: CodexPluginSetupPinnedArtifact,
        reportedVersion: String = "0.153.2",
        trustSnapshot: CodexRuntimeTrustSnapshot
    ) {
        self.artifact = artifact
        self.reportedVersion = reportedVersion
        self.trustSnapshot = trustSnapshot
    }

    func inspect(_ executable: URL) throws -> CodexRuntimeTrustSnapshot {
        lock.lock()
        inspectedPaths.append(executable.path)
        lock.unlock()
        return trustSnapshot
    }

    func rejectSignature(_ executable: URL) throws {
        lock.lock()
        signaturePaths.append(executable.path)
        lock.unlock()
        throw CoordinatorError("codex_plugin_setup_signature_invalid")
    }

    func rejectSignatureUnexpectedly(_ executable: URL) throws {
        lock.lock()
        signaturePaths.append(executable.path)
        lock.unlock()
        throw CoordinatorError("unexpected_signature_validator_failure")
    }

    func acceptSignature(_ executable: URL) throws {
        lock.lock()
        signaturePaths.append(executable.path)
        lock.unlock()
    }

    func acceptPinned(
        _ executable: URL,
        _ expectedIdentity: CodexRuntimeFileIdentity,
        _ expectedVersion: String?
    ) throws -> CodexPluginSetupPinnedArtifact {
        lock.lock()
        pinnedCalls.append(CodexPluginSetupPinnedValidationCall(
            executable: executable.path,
            expectedIdentity: expectedIdentity,
            expectedVersion: expectedVersion
        ))
        lock.unlock()
        return artifact
    }

    func runVersion(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) throws -> CodexPluginSetupProcessResult {
        lock.lock()
        processInvocations.append(CodexPluginSetupInvocation(
            executable: executable.path,
            arguments: arguments,
            timeoutMilliseconds: timeoutMilliseconds
        ))
        lock.unlock()
        return CodexPluginSetupProcessResult(
            exitCode: 0,
            stdout: Data("codex-cli \(reportedVersion)\n".utf8)
        )
    }

    func snapshot() -> (
        inspectedPaths: [String],
        signaturePaths: [String],
        pinnedCalls: [CodexPluginSetupPinnedValidationCall],
        processInvocations: [CodexPluginSetupInvocation]
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (inspectedPaths, signaturePaths, pinnedCalls, processInvocations)
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

private func codexPluginSetupLegacyRoot(
    _ fixture: CodexPluginSetupFixture
) -> URL {
    fixture.root
        .appendingPathComponent("legacy-output", isDirectory: true)
        .appendingPathComponent("marketplace", isDirectory: true)
}

private func codexPluginSetupLegacyMarketplaceName(
    marketplaceRoot: URL
) -> String {
    let outputRoot = marketplaceRoot.standardizedFileURL.deletingLastPathComponent()
    let suffix = SHA256.hash(data: Data(outputRoot.path.utf8))
        .prefix(6)
        .map { String(format: "%02x", $0) }
        .joined()
    return "blabee-local-dogfood-\(suffix)"
}

private func codexPluginSetupLegacyPlugin(
    marketplaceName: String? = nil,
    marketplaceRoot: URL,
    pluginID: String? = nil,
    sourcePath: URL? = nil,
    enabled: Bool = true
) -> [String: Any] {
    let marketplaceName = marketplaceName
        ?? codexPluginSetupLegacyMarketplaceName(marketplaceRoot: marketplaceRoot)
    return [
        "pluginId": pluginID ?? "blabee@\(marketplaceName)",
        "name": CodexPluginSetupManager.pluginName,
        "marketplaceName": marketplaceName,
        "version": "0.1.0",
        "installed": true,
        "enabled": enabled,
        "source": [
            "source": "local",
            "path": (sourcePath ?? marketplaceRoot
                .appendingPathComponent("plugins/blabee", isDirectory: true)).path,
        ],
    ]
}

private func codexPluginSetupLegacyMigrationConfirmation(
    marketplaceName: String? = nil,
    marketplaceRoot: URL,
    pluginSelector: String? = nil,
    pluginRoot: URL? = nil,
    pluginIsInstalled: Bool = true,
    pluginVersion: String? = "0.1.0"
) -> CodexPluginSetupLegacyMigrationConfirmation {
    let marketplaceName = marketplaceName
        ?? codexPluginSetupLegacyMarketplaceName(marketplaceRoot: marketplaceRoot)
    return CodexPluginSetupLegacyMigrationConfirmation(
        marketplaceName: marketplaceName,
        marketplaceRootPath: marketplaceRoot.standardizedFileURL.path,
        pluginSelector: pluginSelector ?? "blabee@\(marketplaceName)",
        pluginRootPath: (pluginRoot ?? marketplaceRoot
            .appendingPathComponent("plugins/blabee", isDirectory: true))
            .standardizedFileURL.path,
        pluginIsInstalled: pluginIsInstalled,
        pluginVersion: pluginIsInstalled ? pluginVersion : nil,
        filesystemIdentity: .allMissing
    )
}

private func codexPluginSetupCreateLegacyFilesystem(
    marketplaceRoot: URL,
    marker: String
) throws {
    let marketplaceManifest = marketplaceRoot.appendingPathComponent(
        ".agents/plugins/marketplace.json",
        isDirectory: false
    )
    let pluginManifest = marketplaceRoot.appendingPathComponent(
        "plugins/blabee/.codex-plugin/plugin.json",
        isDirectory: false
    )
    try FileManager.default.createDirectory(
        at: marketplaceManifest.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
        at: pluginManifest.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try Data("marketplace-\(marker)".utf8).write(to: marketplaceManifest)
    try Data("plugin-\(marker)".utf8).write(to: pluginManifest)
}

@Test("Legacy dogfood connection is detected but never changed automatically")
func codexPluginSetupDetectsLegacyWithoutAutomaticMutation() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    fixture.fake.marketplaces = [
        (legacyName, legacyRoot.path),
    ]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: legacyRoot
    )]
    let manager = fixture.manager()
    let expected = CodexPluginSetupState.legacyInstallationDetected(
        marketplaceName: legacyName,
        confirmation: codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot
        )
    )

    #expect(await manager.inspect() == expected)
    #expect(await manager.connect() == expected)
    #expect(await manager.disconnect() == expected)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Orphaned legacy marketplace is actionable but never changed automatically")
func codexPluginSetupDetectsOrphanedLegacyWithoutAutomaticMutation() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    fixture.fake.marketplaces = [
        (legacyName, legacyRoot.path),
    ]
    let manager = fixture.manager()
    let expected = CodexPluginSetupState.legacyInstallationDetected(
        marketplaceName: legacyName,
        confirmation: codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot,
            pluginIsInstalled: false
        )
    )

    #expect(await manager.inspect() == expected)
    #expect(await manager.connect() == expected)
    #expect(await manager.disconnect() == expected)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Ambiguous orphaned legacy marketplaces remain fail closed")
func codexPluginSetupRejectsAmbiguousOrphanedLegacyMarketplaces() async throws {
    for scenario in ["duplicate", "extra-plugin", "current-marketplace"] {
        let fixture = try CodexPluginSetupFixture()
        let legacyRoot = codexPluginSetupLegacyRoot(fixture)
        let legacyName = codexPluginSetupLegacyMarketplaceName(
            marketplaceRoot: legacyRoot
        )
        fixture.fake.marketplaces = [
            (legacyName, legacyRoot.path),
        ]
        switch scenario {
        case "duplicate":
            fixture.fake.marketplaces.append((
                legacyName,
                legacyRoot.path
            ))
        case "extra-plugin":
            fixture.fake.plugins = [[
                "pluginId": "other@\(legacyName)",
                "name": "other",
                "marketplaceName": legacyName,
                "version": "1.0.0",
                "installed": true,
                "enabled": true,
                "source": [
                    "source": "local",
                    "path": legacyRoot.appendingPathComponent("plugins/other").path,
                ],
            ]]
        case "current-marketplace":
            fixture.fake.marketplaces.append((
                CodexPluginSetupManager.marketplaceName,
                fixture.root.path
            ))
        default:
            Issue.record("Unexpected orphaned legacy scenario")
        }

        let confirmation = codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot,
            pluginIsInstalled: false
        )
        guard case .conflict = await fixture.manager().migrateLegacyInstallation(
            confirmation: confirmation
        ) else {
            Issue.record("Expected fail-closed orphan conflict for \(scenario)")
            continue
        }
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
}

@Test("Explicit legacy migration removes only the exact legacy pair then installs blabee-app")
func codexPluginSetupMigratesExactLegacyInstallation() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    let legacySelector = "blabee@\(legacyName)"
    fixture.fake.marketplaces = [
        (legacyName, legacyRoot.path),
    ]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: legacyRoot
    )]
    let probe = CodexPluginSetupTrustProbe()
    let executable = fixture.executable
    let manager = fixture.manager(
        qualifier: { _ in probe.qualify(executable) },
        revalidator: probe.revalidate
    )

    #expect(await manager.migrateLegacyInstallation(
        confirmation: codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot
        )
    )
        == .installedNeedsHookReview(version: "0.1.0"))
    #expect(pluginSetupMutationArguments(fixture) == [
        ["plugin", "remove", legacySelector, "--json"],
        [
            "plugin", "marketplace", "remove",
            legacyName, "--json",
        ],
        ["plugin", "marketplace", "add", fixture.root.path, "--json"],
        ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
    ])
    #expect(probe.snapshot().qualifications == 1)
}

@Test("Legacy migration confirmation rejects a replacement target before mutation")
func codexPluginSetupLegacyMigrationRejectsReplacedConfirmedTarget() async throws {
    let fixture = try CodexPluginSetupFixture()
    let originalRoot = codexPluginSetupLegacyRoot(fixture)
    let originalName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: originalRoot
    )
    fixture.fake.marketplaces = [(originalName, originalRoot.path)]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: originalRoot
    )]
    let manager = fixture.manager()
    let originalConfirmation = codexPluginSetupLegacyMigrationConfirmation(
        marketplaceRoot: originalRoot
    )
    #expect(await manager.inspect() == .legacyInstallationDetected(
        marketplaceName: originalName,
        confirmation: originalConfirmation
    ))

    let replacementRoot = fixture.root
        .appendingPathComponent("replacement-output", isDirectory: true)
        .appendingPathComponent("marketplace", isDirectory: true)
    let replacementName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: replacementRoot
    )
    fixture.fake.marketplaces = [(replacementName, replacementRoot.path)]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: replacementRoot
    )]
    let replacementState = CodexPluginSetupState.legacyInstallationDetected(
        marketplaceName: replacementName,
        confirmation: codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: replacementRoot
        )
    )

    #expect(await manager.migrateLegacyInstallation(
        confirmation: originalConfirmation
    ) == replacementState)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Legacy migration confirmation rejects same-path file identity replacement")
func codexPluginSetupLegacyMigrationRejectsSamePathIdentityReplacement() async throws {
    for scenario in [
        "marketplace-directory", "marketplace-manifest",
        "plugin-directory", "plugin-manifest",
    ] {
        let fixture = try CodexPluginSetupFixture()
        let legacyRoot = codexPluginSetupLegacyRoot(fixture)
        let legacyName = codexPluginSetupLegacyMarketplaceName(
            marketplaceRoot: legacyRoot
        )
        try codexPluginSetupCreateLegacyFilesystem(
            marketplaceRoot: legacyRoot,
            marker: "original"
        )
        fixture.fake.marketplaces = [(legacyName, legacyRoot.path)]
        fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
            marketplaceRoot: legacyRoot
        )]
        let manager = fixture.manager()
        guard case let .legacyInstallationDetected(_, originalConfirmation) =
            await manager.inspect()
        else {
            Issue.record("Expected an exact legacy installation before replacement")
            continue
        }

        let pluginRoot = legacyRoot.appendingPathComponent(
            "plugins/blabee",
            isDirectory: true
        )
        switch scenario {
        case "marketplace-directory":
            try FileManager.default.removeItem(at: legacyRoot)
            try codexPluginSetupCreateLegacyFilesystem(
                marketplaceRoot: legacyRoot,
                marker: "replacement"
            )
        case "marketplace-manifest":
            try Data("marketplace-replacement-with-different-size".utf8).write(
                to: legacyRoot.appendingPathComponent(
                    ".agents/plugins/marketplace.json",
                    isDirectory: false
                )
            )
        case "plugin-directory":
            try FileManager.default.removeItem(at: pluginRoot)
            try codexPluginSetupCreateLegacyFilesystem(
                marketplaceRoot: legacyRoot,
                marker: "replacement"
            )
        case "plugin-manifest":
            try Data("plugin-replacement-with-different-size".utf8).write(
                to: pluginRoot.appendingPathComponent(
                    ".codex-plugin/plugin.json",
                    isDirectory: false
                )
            )
        default:
            Issue.record("Unexpected same-path replacement scenario")
        }

        let state = await manager.migrateLegacyInstallation(
            confirmation: originalConfirmation
        )
        guard case let .legacyInstallationDetected(
            returnedName,
            replacementConfirmation
        ) = state else {
            Issue.record("Expected replacement identity to require a new confirmation")
            continue
        }
        #expect(returnedName == legacyName)
        #expect(replacementConfirmation != originalConfirmation)
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
}

@Test("Legacy migration rechecks target identity after mutation trust preflight")
func codexPluginSetupLegacyMigrationRejectsSwapAfterTrustPreflight() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    try codexPluginSetupCreateLegacyFilesystem(
        marketplaceRoot: legacyRoot,
        marker: "original"
    )
    fixture.fake.marketplaces = [(legacyName, legacyRoot.path)]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: legacyRoot
    )]

    let legacyManifest = legacyRoot.appendingPathComponent(
        "plugins/blabee/.codex-plugin/plugin.json",
        isDirectory: false
    )
    let probe = CodexPluginSetupBundleActionProbe(actionCall: 2) {
        try Data("plugin-swapped-after-trust-preflight".utf8).write(
            to: legacyManifest
        )
    }
    let manager = fixture.manager(bundleRevalidator: probe.validate)
    guard case let .legacyInstallationDetected(_, confirmation) =
        await manager.inspect()
    else {
        Issue.record("Expected an exact legacy installation before migration")
        return
    }

    guard case .conflict = await manager.migrateLegacyInstallation(
        confirmation: confirmation
    ) else {
        Issue.record("Expected a same-path swap after trust preflight to fail closed")
        return
    }
    let probeState = probe.snapshot()
    #expect(probeState.calls == 2)
    #expect(probeState.actionWasRun)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Legacy marketplace removal rechecks identity after mutation trust preflight")
func codexPluginSetupLegacyMarketplaceRemovalRejectsSwapAfterTrustPreflight() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    try codexPluginSetupCreateLegacyFilesystem(
        marketplaceRoot: legacyRoot,
        marker: "original"
    )
    fixture.fake.marketplaces = [(legacyName, legacyRoot.path)]
    fixture.fake.plugins = []

    let legacyManifest = legacyRoot.appendingPathComponent(
        ".agents/plugins/marketplace.json",
        isDirectory: false
    )
    let probe = CodexPluginSetupBundleActionProbe(actionCall: 2) {
        try Data("marketplace-swapped-after-trust-preflight".utf8).write(
            to: legacyManifest
        )
    }
    let manager = fixture.manager(bundleRevalidator: probe.validate)
    guard case let .legacyInstallationDetected(_, confirmation) =
        await manager.inspect()
    else {
        Issue.record("Expected an orphaned legacy Marketplace before migration")
        return
    }

    guard case .conflict = await manager.migrateLegacyInstallation(
        confirmation: confirmation
    ) else {
        Issue.record("Expected a Marketplace swap after trust preflight to fail closed")
        return
    }
    let probeState = probe.snapshot()
    #expect(probeState.calls == 2)
    #expect(probeState.actionWasRun)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Legacy migration rejects duplicate or inexact ownership shapes")
func codexPluginSetupRejectsAmbiguousLegacyInstallations() async throws {
    for scenario in [
        "duplicate-marketplace", "wrong-source", "disabled", "extra-plugin",
        "uppercase-suffix", "forged-suffix", "wrong-marketplace-path",
        "wrong-selector",
    ] {
        let fixture = try CodexPluginSetupFixture()
        let legacyRoot = codexPluginSetupLegacyRoot(fixture)
        var marketplaceName = codexPluginSetupLegacyMarketplaceName(
            marketplaceRoot: legacyRoot
        )
        var plugin = codexPluginSetupLegacyPlugin(marketplaceRoot: legacyRoot)
        fixture.fake.marketplaces = [(marketplaceName, legacyRoot.path)]
        switch scenario {
        case "duplicate-marketplace":
            fixture.fake.marketplaces.append((marketplaceName, legacyRoot.path))
        case "wrong-source":
            plugin = codexPluginSetupLegacyPlugin(
                marketplaceRoot: legacyRoot,
                sourcePath: legacyRoot.appendingPathComponent("Plugin/blabee")
            )
        case "disabled":
            plugin = codexPluginSetupLegacyPlugin(
                marketplaceRoot: legacyRoot,
                enabled: false
            )
        case "extra-plugin":
            fixture.fake.plugins.append([
                "pluginId": "other@\(marketplaceName)",
                "name": "other",
                "marketplaceName": marketplaceName,
                "version": "1.0.0",
                "installed": true,
                "enabled": true,
                "source": [
                    "source": "local",
                    "path": legacyRoot.appendingPathComponent("plugins/other").path,
                ],
            ])
        case "uppercase-suffix":
            marketplaceName = "blabee-local-dogfood-16D56627DFE5"
            fixture.fake.marketplaces = [(marketplaceName, legacyRoot.path)]
            plugin = codexPluginSetupLegacyPlugin(
                marketplaceName: marketplaceName,
                marketplaceRoot: legacyRoot
            )
        case "forged-suffix":
            marketplaceName = String(marketplaceName.dropLast())
                + (marketplaceName.last == "0" ? "1" : "0")
            fixture.fake.marketplaces = [(marketplaceName, legacyRoot.path)]
            plugin = codexPluginSetupLegacyPlugin(
                marketplaceName: marketplaceName,
                marketplaceRoot: legacyRoot
            )
        case "wrong-marketplace-path":
            let malformedRoot = legacyRoot.deletingLastPathComponent()
                .appendingPathComponent("legacy-marketplace", isDirectory: true)
            fixture.fake.marketplaces = [(marketplaceName, malformedRoot.path)]
            plugin = codexPluginSetupLegacyPlugin(
                marketplaceName: marketplaceName,
                marketplaceRoot: malformedRoot
            )
        case "wrong-selector":
            plugin = codexPluginSetupLegacyPlugin(
                marketplaceRoot: legacyRoot,
                pluginID: "blabee@wrong-marketplace"
            )
        default:
            Issue.record("Unexpected legacy scenario")
        }
        fixture.fake.plugins.append(plugin)

        let confirmation = codexPluginSetupLegacyMigrationConfirmation(
            marketplaceName: marketplaceName,
            marketplaceRoot: legacyRoot
        )
        guard case .conflict = await fixture.manager().migrateLegacyInstallation(
            confirmation: confirmation
        ) else {
            Issue.record("Expected fail-closed legacy conflict for \(scenario)")
            continue
        }
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
}

@Test("Legacy migration makes partial removal failures explicit")
func codexPluginSetupReportsLegacyPartialFailures() async throws {
    do {
        let fixture = try CodexPluginSetupFixture()
        let legacyRoot = codexPluginSetupLegacyRoot(fixture)
        let legacyName = codexPluginSetupLegacyMarketplaceName(
            marketplaceRoot: legacyRoot
        )
        fixture.fake.marketplaces = [
            (legacyName, legacyRoot.path),
        ]
        fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
            marketplaceRoot: legacyRoot
        )]
        fixture.fake.pluginRemoveCreatesEffect = false

        #expect(await fixture.manager().migrateLegacyInstallation(
            confirmation: codexPluginSetupLegacyMigrationConfirmation(
                marketplaceRoot: legacyRoot
            )
        )
            == .error(code: "legacy_plugin_remove_not_applied"))
        #expect(pluginSetupMutationArguments(fixture).count == 1)
    }

    do {
        let fixture = try CodexPluginSetupFixture()
        let legacyRoot = codexPluginSetupLegacyRoot(fixture)
        let legacyName = codexPluginSetupLegacyMarketplaceName(
            marketplaceRoot: legacyRoot
        )
        fixture.fake.marketplaces = [
            (legacyName, legacyRoot.path),
        ]
        fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
            marketplaceRoot: legacyRoot
        )]
        fixture.fake.marketplaceRemoveCreatesEffect = false

        let manager = fixture.manager()
        let installedConfirmation = codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot
        )
        let orphanedConfirmation = codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot,
            pluginIsInstalled: false
        )
        #expect(await manager.migrateLegacyInstallation(
            confirmation: installedConfirmation
        )
            == .error(code: "legacy_marketplace_remove_not_applied"))
        #expect(pluginSetupMutationArguments(fixture).count == 2)
        let expected = CodexPluginSetupState.legacyInstallationDetected(
            marketplaceName: legacyName,
            confirmation: orphanedConfirmation
        )
        #expect(await manager.inspect() == expected)
        #expect(await manager.connect() == expected)
        #expect(pluginSetupMutationArguments(fixture).count == 2)

        fixture.fake.marketplaceRemoveCreatesEffect = true
        #expect(await manager.migrateLegacyInstallation(
            confirmation: installedConfirmation
        ) == expected)
        #expect(pluginSetupMutationArguments(fixture).count == 2)
        #expect(await manager.migrateLegacyInstallation(
            confirmation: orphanedConfirmation
        )
            == .installedNeedsHookReview(version: "0.1.0"))
        #expect(pluginSetupMutationArguments(fixture) == [
            [
                "plugin", "remove",
                "blabee@\(legacyName)", "--json",
            ],
            [
                "plugin", "marketplace", "remove",
                legacyName, "--json",
            ],
            [
                "plugin", "marketplace", "remove",
                legacyName, "--json",
            ],
            ["plugin", "marketplace", "add", fixture.root.path, "--json"],
            ["plugin", "add", CodexPluginSetupManager.pluginSelector, "--json"],
        ])
    }
}

@Test("Legacy migration timeout requires a fresh orphan confirmation before resuming")
func codexPluginSetupLegacyTimeoutResumesAtMarketplaceRemoval() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    fixture.fake.marketplaces = [
        (legacyName, legacyRoot.path),
    ]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: legacyRoot
    )]
    let clock = CodexPluginSetupManualClock()
    let fake = fixture.fake
    let legacyRemove = [
        "plugin", "remove",
        "blabee@\(legacyName)", "--json",
    ]
    let manager = fixture.manager(
        processRunner: { executable, arguments, timeout in
            let result = try fake.run(
                executable: executable,
                arguments: arguments,
                timeoutMilliseconds: timeout
            )
            if arguments == legacyRemove {
                clock.advance(milliseconds: 10)
            }
            return result
        },
        monotonicNow: clock.now,
        operationTimeoutMilliseconds: 10
    )

    let installedConfirmation = codexPluginSetupLegacyMigrationConfirmation(
        marketplaceRoot: legacyRoot
    )
    let orphanedConfirmation = codexPluginSetupLegacyMigrationConfirmation(
        marketplaceRoot: legacyRoot,
        pluginIsInstalled: false
    )
    #expect(await manager.migrateLegacyInstallation(
        confirmation: installedConfirmation
    )
        == .error(code: "codex_plugin_setup_operation_timed_out"))
    #expect(pluginSetupMutationArguments(fixture) == [legacyRemove])
    let orphanedState = CodexPluginSetupState.legacyInstallationDetected(
        marketplaceName: legacyName,
        confirmation: orphanedConfirmation
    )
    #expect(await manager.inspect() == orphanedState)
    #expect(await manager.migrateLegacyInstallation(
        confirmation: installedConfirmation
    ) == orphanedState)
    #expect(pluginSetupMutationArguments(fixture) == [legacyRemove])
    #expect(await manager.migrateLegacyInstallation(
        confirmation: orphanedConfirmation
    )
        == .installedNeedsHookReview(version: "0.1.0"))
    #expect(pluginSetupMutationArguments(fixture).filter { $0 == legacyRemove }.count == 1)
}

@Test("Legacy migration rechecks ownership before its first destructive command")
func codexPluginSetupLegacyMigrationRejectsLateOwnershipDrift() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    fixture.fake.marketplaces = [
        (legacyName, legacyRoot.path),
    ]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: legacyRoot
    )]
    fixture.fake.pluginAppendedOnListCall = (call: 2, plugin: [
        "pluginId": "other@\(legacyName)",
        "name": "other",
        "marketplaceName": legacyName,
        "version": "1.0.0",
        "installed": true,
        "enabled": true,
        "source": [
            "source": "local",
            "path": legacyRoot.appendingPathComponent("plugins/other").path,
        ],
    ])

    guard case .conflict = await fixture.manager().migrateLegacyInstallation(
        confirmation: codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot
        )
    ) else {
        Issue.record("Expected late legacy ownership drift to fail closed")
        return
    }
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Legacy migration rechecks ownership before removing the marketplace")
func codexPluginSetupLegacyMigrationRejectsDriftAfterPluginRemoval() async throws {
    let fixture = try CodexPluginSetupFixture()
    let legacyRoot = codexPluginSetupLegacyRoot(fixture)
    let legacyName = codexPluginSetupLegacyMarketplaceName(
        marketplaceRoot: legacyRoot
    )
    fixture.fake.marketplaces = [
        (legacyName, legacyRoot.path),
    ]
    fixture.fake.plugins = [codexPluginSetupLegacyPlugin(
        marketplaceRoot: legacyRoot
    )]
    fixture.fake.pluginAppendedOnListCall = (call: 3, plugin: [
        "pluginId": "blabee@unexpected-marketplace",
        "name": CodexPluginSetupManager.pluginName,
        "marketplaceName": "unexpected-marketplace",
        "version": "0.1.0",
        "installed": true,
        "enabled": true,
        "source": [
            "source": "local",
            "path": "/tmp/unexpected-marketplace/plugins/blabee",
        ],
    ])

    guard case .conflict = await fixture.manager().migrateLegacyInstallation(
        confirmation: codexPluginSetupLegacyMigrationConfirmation(
            marketplaceRoot: legacyRoot
        )
    ) else {
        Issue.record("Expected Marketplace removal to reject late Blabee drift")
        return
    }
    #expect(pluginSetupMutationArguments(fixture) == [[
        "plugin", "remove",
        "blabee@\(legacyName)", "--json",
    ]])
}

@Test("Unrelated remote Plugin without a source path is tolerated")
func codexPluginSetupToleratesUnrelatedRemotePluginWithoutPath() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.plugins = [[
        "pluginId": "remote-tool@public-marketplace",
        "name": "remote-tool",
        "marketplaceName": "public-marketplace",
        "version": "1.0.0",
        "installed": true,
        "enabled": true,
        "source": ["source": "remote"],
    ]]

    #expect(await fixture.manager().inspect() == .notInstalled)
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
}

@Test("Remote Blabee Plugin without a source path is a conflict")
func codexPluginSetupRejectsRemoteBlabeePluginWithoutPath() async throws {
    for (pluginID, name) in [
        ("blabee@public-marketplace", "remote-tool"),
        ("remote-tool@public-marketplace", CodexPluginSetupManager.pluginName),
    ] {
        let fixture = try CodexPluginSetupFixture()
        fixture.fake.plugins = [[
            "pluginId": pluginID,
            "name": name,
            "marketplaceName": "public-marketplace",
            "version": "1.0.0",
            "installed": true,
            "enabled": true,
            "source": ["source": "remote"],
        ]]

        guard case .conflict = await fixture.manager().inspect() else {
            Issue.record("Expected a fail-closed remote Blabee Plugin conflict")
            continue
        }
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
}

@Test("Local Plugin without an absolute source path remains malformed")
func codexPluginSetupRejectsLocalPluginWithoutPath() async throws {
    for source: [String: Any] in [
        ["source": "local"],
        ["source": "local", "path": "relative/plugin"],
    ] {
        let fixture = try CodexPluginSetupFixture()
        fixture.fake.plugins = [[
            "pluginId": "local-tool@team-marketplace",
            "name": "local-tool",
            "marketplaceName": "team-marketplace",
            "version": "1.0.0",
            "installed": true,
            "enabled": true,
            "source": source,
        ]]

        #expect(await fixture.manager().inspect() == .error(
            code: "plugin_list_malformed"
        ))
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
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
        qualifier: { _ in probe.qualify(executable) },
        revalidator: probe.revalidate
    )

    #expect(await manager.connect() == .installedNeedsHookReview(version: "0.1.0"))
    let counts = probe.snapshot()
    #expect(counts.qualifications == 1)
    #expect(counts.revalidations == fixture.fake.snapshotInvocations().count * 2)
    #expect(counts.revalidations == 20)
}

@Test("Revalidation drift prevents Codex Plugin subprocess execution")
func codexPluginSetupRevalidationFailureFailsClosed() async throws {
    let fixture = try CodexPluginSetupFixture()
    let executable = fixture.executable
    let manager = fixture.manager(
        qualifier: { _ in .testOnly(url: executable) },
        revalidator: { _ in
            throw CodexRuntimeTrustError.approvalDrift
        }
    )

    #expect(await manager.connect() == .error(code: "marketplace_list_failed"))
    #expect(fixture.fake.snapshotInvocations().isEmpty)
}

@Test("One operation deadline bounds all repeated Plugin CLI steps")
func codexPluginSetupUsesSharedOperationDeadline() async throws {
    let fixture = try CodexPluginSetupFixture()
    let clock = CodexPluginSetupManualClock()
    let fake = fixture.fake
    let manager = fixture.manager(
        processRunner: { executable, arguments, timeout in
            let result = try fake.run(
                executable: executable,
                arguments: arguments,
                timeoutMilliseconds: timeout
            )
            clock.advance(milliseconds: 6)
            return result
        },
        monotonicNow: clock.now,
        operationTimeoutMilliseconds: 10
    )

    #expect(await manager.connect()
        == .error(code: "codex_plugin_setup_operation_timed_out"))
    let invocations = fixture.fake.snapshotInvocations()
    #expect(invocations.map(\.arguments) == [
        ["plugin", "marketplace", "list", "--json"],
        ["plugin", "list", "--json"],
    ])
    #expect(invocations.map(\.timeoutMilliseconds) == [10, 4])
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
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
        "0.151.0", "0.152.0", "0.152.1", "0.153.2", "0.153.4", "0.154.0",
    ])
}

@Test("Production pinned executable catalog is exact for Codex 0.153.2 arm64")
func codexPluginSetupPinnedExecutableCatalogIsExact() throws {
    let artifact = CodexPluginSetupPinnedArtifact(
        version: "0.153.2",
        architecture: CodexPluginSetupPinnedExecutableTrust.arm64CPUType,
        executableBytes: 220_551_344,
        executableSHA256: "195ace4100a634a9df39147f493e730e666b5bd87795f3c9f3251d8542400424"
    )
    #expect(CodexPluginSetupPinnedExecutableTrust.officialArtifacts == [artifact])
    #expect(CodexPluginSetupPinnedExecutableTrust.matchingArtifact(
        version: "0.153.2",
        architecture: artifact.architecture,
        executableBytes: artifact.executableBytes,
        executableSHA256: artifact.executableSHA256
    ) == artifact)
    #expect(CodexPluginSetupPinnedExecutableTrust.matchingArtifact(
        version: "0.153.2",
        architecture: artifact.architecture,
        executableBytes: artifact.executableBytes,
        executableSHA256: String(repeating: "0", count: 64)
    ) == nil)
    #expect(CodexPluginSetupPinnedExecutableTrust.matchingArtifact(
        version: "0.153.1",
        architecture: artifact.architecture,
        executableBytes: artifact.executableBytes,
        executableSHA256: artifact.executableSHA256
    ) == nil)
    #expect(CodexPluginSetupPinnedExecutableTrust.matchingArtifact(
        version: "0.153.2",
        architecture: artifact.architecture,
        executableBytes: artifact.executableBytes - 1,
        executableSHA256: artifact.executableSHA256
    ) == nil)
    #expect(CodexPluginSetupPinnedExecutableTrust.matchingArtifact(
        version: "0.153.2",
        architecture: 0x0100_0007,
        executableBytes: artifact.executableBytes,
        executableSHA256: artifact.executableSHA256
    ) == nil)
}

@Test("Production trust binds one pinned hash to a stable qualification snapshot")
func codexPluginSetupProductionTrustOrchestratesPinnedFallback() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-trust-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let artifact = try #require(
        CodexPluginSetupPinnedExecutableTrust.officialArtifacts.first
    )
    let targetIdentity = try codexPluginSetupFileIdentity(at: executable)
    let sourceIdentitySentinel = CodexRuntimeFileIdentity(
        device: targetIdentity.device,
        inode: targetIdentity.inode &+ 1,
        mode: targetIdentity.mode,
        owner: targetIdentity.owner,
        group: targetIdentity.group,
        size: targetIdentity.size,
        modificationSeconds: targetIdentity.modificationSeconds,
        modificationNanoseconds: targetIdentity.modificationNanoseconds,
        changeSeconds: targetIdentity.changeSeconds,
        changeNanoseconds: targetIdentity.changeNanoseconds
    )
    let trustSnapshot = try codexPluginSetupTrustSnapshot(
        at: executable,
        sourceIdentity: sourceIdentitySentinel
    )
    let probe = CodexPluginSetupFallbackTrustProbe(
        artifact: artifact,
        trustSnapshot: trustSnapshot
    )
    let qualified = try CodexPluginSetupProductionTrust.qualify(
        sourceURL: executable,
        processRunner: probe.runVersion,
        trustInspector: probe.inspect,
        signatureValidator: probe.rejectSignature,
        pinnedExecutableValidator: probe.acceptPinned
    )

    #expect(probe.snapshot().inspectedPaths == [
        executable.path, executable.path, executable.path,
    ])

    #expect(qualified.version == "0.153.2")
    #expect(qualified.sourceURL.path == executable.path)
    #expect(try CodexPluginSetupProductionTrust.revalidate(
        qualified,
        trustInspector: probe.inspect,
        signatureValidator: probe.rejectSignature,
        pinnedExecutableValidator: probe.acceptPinned
    ) == qualified.canonicalURL)

    let snapshot = probe.snapshot()
    #expect(snapshot.inspectedPaths == [
        executable.path,
        executable.path,
        executable.path,
        executable.path,
    ])
    #expect(snapshot.signaturePaths == [
        qualified.canonicalURL.path,
    ])
    #expect(snapshot.pinnedCalls == [
        CodexPluginSetupPinnedValidationCall(
            executable: qualified.canonicalURL.path,
            expectedIdentity: trustSnapshot.targetIdentity,
            expectedVersion: nil
        ),
    ])
    #expect(snapshot.pinnedCalls.first?.expectedIdentity == targetIdentity)
    #expect(snapshot.pinnedCalls.first?.expectedIdentity != sourceIdentitySentinel)
    #expect(snapshot.processInvocations == [CodexPluginSetupInvocation(
        executable: qualified.canonicalURL.path,
        arguments: ["--version"],
        timeoutMilliseconds: 5_000
    )])
}

@Test("Valid official signatures never invoke the pinned hash fallback")
func codexPluginSetupProductionTrustKeepsValidSignaturePath() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-signed-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let trustSnapshot = try codexPluginSetupTrustSnapshot(at: executable)
    let probe = CodexPluginSetupFallbackTrustProbe(
        artifact: try #require(
            CodexPluginSetupPinnedExecutableTrust.officialArtifacts.first
        ),
        trustSnapshot: trustSnapshot
    )
    let qualified = try CodexPluginSetupProductionTrust.qualify(
        sourceURL: executable,
        processRunner: probe.runVersion,
        trustInspector: probe.inspect,
        signatureValidator: probe.acceptSignature,
        pinnedExecutableValidator: probe.acceptPinned
    )

    #expect(try CodexPluginSetupProductionTrust.revalidate(
        qualified,
        trustInspector: probe.inspect,
        signatureValidator: probe.acceptSignature,
        pinnedExecutableValidator: probe.acceptPinned
    ) == qualified.canonicalURL)

    let snapshot = probe.snapshot()
    #expect(snapshot.signaturePaths == [
        qualified.canonicalURL.path,
        qualified.canonicalURL.path,
        qualified.canonicalURL.path,
    ])
    #expect(snapshot.pinnedCalls.isEmpty)
    #expect(snapshot.processInvocations == [CodexPluginSetupInvocation(
        executable: qualified.canonicalURL.path,
        arguments: ["--version"],
        timeoutMilliseconds: 5_000
    )])
}

@Test("Pinned fallback handles only an explicit invalid-signature result")
func codexPluginSetupProductionTrustDoesNotMaskUnexpectedSignatureErrors() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-signature-error-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let probe = CodexPluginSetupFallbackTrustProbe(
        artifact: try #require(
            CodexPluginSetupPinnedExecutableTrust.officialArtifacts.first
        ),
        trustSnapshot: try codexPluginSetupTrustSnapshot(at: executable)
    )
    #expect(throws: CoordinatorError("unexpected_signature_validator_failure")) {
        try CodexPluginSetupProductionTrust.qualify(
            sourceURL: executable,
            processRunner: probe.runVersion,
            trustInspector: probe.inspect,
            signatureValidator: probe.rejectSignatureUnexpectedly,
            pinnedExecutableValidator: probe.acceptPinned
        )
    }

    let snapshot = probe.snapshot()
    #expect(snapshot.signaturePaths == [executable.path])
    #expect(snapshot.pinnedCalls.isEmpty)
    #expect(snapshot.processInvocations.isEmpty)
}

@Test("Production qualification forwards one absolute deadline to its version probe")
func codexPluginSetupProductionQualificationUsesSharedDeadline() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-deadline-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let clock = CodexPluginSetupManualClock()
    let probe = CodexPluginSetupFallbackTrustProbe(
        artifact: try #require(
            CodexPluginSetupPinnedExecutableTrust.officialArtifacts.first
        ),
        trustSnapshot: try codexPluginSetupTrustSnapshot(at: executable)
    )
    #expect(throws: CoordinatorError("codex_plugin_setup_operation_timed_out")) {
        try CodexPluginSetupProductionTrust.qualify(
            sourceURL: executable,
            processRunner: { executable, arguments, timeout in
                let result = try probe.runVersion(
                    executable: executable,
                    arguments: arguments,
                    timeoutMilliseconds: timeout
                )
                clock.advance(milliseconds: 10)
                return result
            },
            trustInspector: probe.inspect,
            signatureValidator: probe.acceptSignature,
            pinnedExecutableValidator: probe.acceptPinned,
            deadlineNanoseconds: 10_000_000,
            monotonicNow: clock.now
        )
    }
    #expect(probe.snapshot().processInvocations.map(\.timeoutMilliseconds) == [10])
}

@Test("Pinned selection rejects structural drift before reusing hash evidence")
func codexPluginSetupPinnedSelectionRejectsSnapshotDrift() throws {
    let temporaryPath = FileManager.default.temporaryDirectory.path
    let canonicalTemporaryPath = temporaryPath.hasPrefix("/var/")
        ? "/private" + temporaryPath
        : temporaryPath
    let root = URL(fileURLWithPath: canonicalTemporaryPath, isDirectory: true)
        .appendingPathComponent("blabee-plugin-pin-drift-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: root.path
    )
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let gate = CodexRuntimeTrustGate(monitoredEntries: [])
    let initial = try gate.inspect(sourceURL: executable)
    let probe = CodexPluginSetupFallbackTrustProbe(
        artifact: try #require(
            CodexPluginSetupPinnedExecutableTrust.officialArtifacts.first
        ),
        trustSnapshot: initial
    )
    let qualified = try CodexPluginSetupProductionTrust.qualify(
        sourceURL: executable,
        processRunner: probe.runVersion,
        trustInspector: gate.inspect,
        signatureValidator: probe.rejectSignature,
        pinnedExecutableValidator: probe.acceptPinned
    )

    var changed = try Data(contentsOf: executable)
    changed[changed.index(before: changed.endIndex)] ^= 0x01
    try changed.write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)

    #expect(throws: CodexRuntimeTrustError.approvalDrift) {
        try CodexPluginSetupProductionTrust.revalidate(
            qualified,
            trustInspector: gate.inspect,
            signatureValidator: probe.rejectSignature,
            pinnedExecutableValidator: probe.acceptPinned
        )
    }
    let snapshot = probe.snapshot()
    #expect(snapshot.pinnedCalls.count == 1)
    #expect(snapshot.signaturePaths.count == 1)
}

@Test("Pinned 0.153.2 bytes cannot report a different supported version")
func codexPluginSetupProductionTrustRejectsPinnedVersionMismatch() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-version-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    defer { try? FileManager.default.removeItem(at: root) }

    let artifact = try #require(
        CodexPluginSetupPinnedExecutableTrust.officialArtifacts.first
    )
    let probe = CodexPluginSetupFallbackTrustProbe(
        artifact: artifact,
        reportedVersion: "0.152.1",
        trustSnapshot: try codexPluginSetupTrustSnapshot(at: executable)
    )
    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupProductionTrust.qualify(
            sourceURL: executable,
            processRunner: probe.runVersion,
            trustInspector: probe.inspect,
            signatureValidator: probe.rejectSignature,
            pinnedExecutableValidator: probe.acceptPinned
        )
    }

    let snapshot = probe.snapshot()
    #expect(snapshot.inspectedPaths == [executable.path, executable.path])
    #expect(snapshot.signaturePaths.count == 1)
    #expect(snapshot.pinnedCalls.map(\.expectedVersion) == [nil])
    #expect(snapshot.processInvocations.map(\.arguments) == [["--version"]])
}

@Test("Pinned executable revalidation rejects identity and content changes")
func codexPluginSetupPinnedExecutableRejectsMutation() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-pin-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let bytes = Data([
        0xCF, 0xFA, 0xED, 0xFE,
        0x0C, 0x00, 0x00, 0x01,
        0x42, 0x4C, 0x41, 0x42, 0x45, 0x45,
    ])
    try bytes.write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    let initialIdentity = try codexPluginSetupFileIdentity(at: executable)
    let digest = SHA256.hash(data: bytes)
        .map { String(format: "%02x", $0) }.joined()
    let artifact = CodexPluginSetupPinnedArtifact(
        version: "0.153.2",
        architecture: CodexPluginSetupPinnedExecutableTrust.arm64CPUType,
        executableBytes: Int64(bytes.count),
        executableSHA256: digest
    )

    #expect(try CodexPluginSetupPinnedExecutableTrust.validate(
        executable: executable,
        expectedIdentity: initialIdentity,
        expectedVersion: "0.153.2",
        artifacts: [artifact]
    ) == artifact)
    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: initialIdentity,
            expectedVersion: "0.153.1",
            artifacts: [artifact]
        )
    }

    let hardlink = root.appendingPathComponent("codex-hardlink", isDirectory: false)
    try FileManager.default.linkItem(at: executable, to: hardlink)
    let linkedIdentity = try codexPluginSetupFileIdentity(at: executable)
    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: linkedIdentity,
            expectedVersion: "0.153.2",
            artifacts: [artifact]
        )
    }
    try FileManager.default.removeItem(at: hardlink)
    let originalIdentity = try codexPluginSetupFileIdentity(at: executable)
    #expect(try CodexPluginSetupPinnedExecutableTrust.validate(
        executable: executable,
        expectedIdentity: originalIdentity,
        expectedVersion: "0.153.2",
        artifacts: [artifact]
    ) == artifact)

    let handle = try FileHandle(forWritingTo: executable)
    try handle.seek(toOffset: UInt64(bytes.count - 1))
    try handle.write(contentsOf: Data([0x00]))
    try handle.synchronize()
    try handle.close()

    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: originalIdentity,
            expectedVersion: "0.153.2",
            artifacts: [artifact]
        )
    }
    let changedIdentity = try codexPluginSetupFileIdentity(at: executable)
    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: changedIdentity,
            expectedVersion: "0.153.2",
            artifacts: [artifact]
        )
    }
}

@Test("Pinned executable hashing covers multiple chunks and exact EOF")
func codexPluginSetupPinnedExecutableStreamsAndRejectsSizeChanges() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-stream-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    var bytes = Data(repeating: 0xA5, count: 1024 * 1024 + 17)
    bytes.replaceSubrange(0 ..< 8, with: [
        0xCF, 0xFA, 0xED, 0xFE,
        0x0C, 0x00, 0x00, 0x01,
    ])
    try bytes.write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    let digest = SHA256.hash(data: bytes)
        .map { String(format: "%02x", $0) }.joined()
    let artifact = CodexPluginSetupPinnedArtifact(
        version: "0.153.2",
        architecture: CodexPluginSetupPinnedExecutableTrust.arm64CPUType,
        executableBytes: Int64(bytes.count),
        executableSHA256: digest
    )
    let originalIdentity = try codexPluginSetupFileIdentity(at: executable)
    #expect(try CodexPluginSetupPinnedExecutableTrust.validate(
        executable: executable,
        expectedIdentity: originalIdentity,
        expectedVersion: "0.153.2",
        artifacts: [artifact]
    ) == artifact)

    let appendHandle = try FileHandle(forWritingTo: executable)
    try appendHandle.seekToEnd()
    try appendHandle.write(contentsOf: Data([0xFF]))
    try appendHandle.synchronize()
    try appendHandle.close()
    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: try codexPluginSetupFileIdentity(at: executable),
            expectedVersion: "0.153.2",
            artifacts: [artifact]
        )
    }

    let truncateHandle = try FileHandle(forWritingTo: executable)
    try truncateHandle.truncate(atOffset: UInt64(bytes.count - 1))
    try truncateHandle.synchronize()
    try truncateHandle.close()
    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: try codexPluginSetupFileIdentity(at: executable),
            expectedVersion: "0.153.2",
            artifacts: [artifact]
        )
    }
}

@Test("Pinned executable rejects a deterministic append at the exact EOF boundary")
func codexPluginSetupPinnedExecutableRejectsExactEOFRace() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-eof-race-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    var bytes = Data(repeating: 0x7A, count: 4_097)
    bytes.replaceSubrange(0 ..< 8, with: [
        0xCF, 0xFA, 0xED, 0xFE,
        0x0C, 0x00, 0x00, 0x01,
    ])
    try bytes.write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    let artifact = CodexPluginSetupPinnedArtifact(
        version: "0.153.2",
        architecture: CodexPluginSetupPinnedExecutableTrust.arm64CPUType,
        executableBytes: Int64(bytes.count),
        executableSHA256: SHA256.hash(data: bytes)
            .map { String(format: "%02x", $0) }.joined()
    )
    let identity = try codexPluginSetupFileIdentity(at: executable)

    #expect(throws: CoordinatorError("codex_plugin_setup_signature_invalid")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: identity,
            expectedVersion: "0.153.2",
            artifacts: [artifact],
            beforeExactEOFCheck: {
                let handle = try FileHandle(forWritingTo: executable)
                try handle.seekToEnd()
                try handle.write(contentsOf: Data([0xFF]))
                try handle.synchronize()
                try handle.close()
            }
        )
    }
    #expect(try codexPluginSetupFileIdentity(at: executable).size
        == Int64(bytes.count + 1))
}

@Test("Pinned executable hashing stops at the shared operation deadline")
func codexPluginSetupPinnedExecutableHonorsOperationDeadline() throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("blabee-plugin-hash-deadline-\(UUID().uuidString)", isDirectory: true)
    let executable = root.appendingPathComponent("codex", isDirectory: false)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    var bytes = Data(repeating: 0x42, count: 4_097)
    bytes.replaceSubrange(0 ..< 8, with: [
        0xCF, 0xFA, 0xED, 0xFE,
        0x0C, 0x00, 0x00, 0x01,
    ])
    try bytes.write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    let artifact = CodexPluginSetupPinnedArtifact(
        version: "0.153.2",
        architecture: CodexPluginSetupPinnedExecutableTrust.arm64CPUType,
        executableBytes: Int64(bytes.count),
        executableSHA256: SHA256.hash(data: bytes)
            .map { String(format: "%02x", $0) }.joined()
    )
    let clock = CodexPluginSetupManualClock()

    #expect(throws: CoordinatorError("codex_plugin_setup_operation_timed_out")) {
        try CodexPluginSetupPinnedExecutableTrust.validate(
            executable: executable,
            expectedIdentity: try codexPluginSetupFileIdentity(at: executable),
            expectedVersion: "0.153.2",
            artifacts: [artifact],
            beforeExactEOFCheck: { clock.advance(milliseconds: 10) },
            deadlineNanoseconds: 10_000_000,
            monotonicNow: clock.now
        )
    }
}

private func codexPluginSetupFileIdentity(
    at url: URL
) throws -> CodexRuntimeFileIdentity {
    var info = stat()
    guard lstat(url.path, &info) == 0 else {
        throw CoordinatorError("test_file_identity_unavailable")
    }
    return CodexRuntimeFileIdentity(
        device: UInt64(bitPattern: Int64(info.st_dev)),
        inode: UInt64(info.st_ino),
        mode: UInt32(info.st_mode),
        owner: UInt32(info.st_uid),
        group: UInt32(info.st_gid),
        size: Int64(info.st_size),
        modificationSeconds: Int64(info.st_mtimespec.tv_sec),
        modificationNanoseconds: Int64(info.st_mtimespec.tv_nsec),
        changeSeconds: Int64(info.st_ctimespec.tv_sec),
        changeNanoseconds: Int64(info.st_ctimespec.tv_nsec)
    )
}

private func codexPluginSetupTrustSnapshot(
    at url: URL,
    sourceIdentity: CodexRuntimeFileIdentity? = nil
) throws -> CodexRuntimeTrustSnapshot {
    let identity = try codexPluginSetupFileIdentity(at: url)
    return CodexRuntimeTrustSnapshot(
        stableSourcePath: url.path,
        canonicalPath: url.path,
        sourceIdentity: sourceIdentity ?? identity,
        targetIdentity: identity,
        sourceAncestors: [],
        canonicalAncestors: []
    )
}

@Test("Production Plugin CLI version gate rejects unsupported canonical output")
func codexPluginSetupProductionVersionGateRejectsUnsupportedVersion() throws {
    for version in ["0.150.1", "0.154.1", "0.154.10", "0.155.0"] {
        let unsupported = CodexPluginSetupProcessResult(
            exitCode: 0,
            stdout: Data("codex-cli \(version)\n".utf8)
        )
        #expect(throws: CodexRuntimeTrustError.unsupportedVersion(version)) {
            try CodexPluginSetupProductionTrust.supportedVersion(from: unsupported)
        }
    }
    for version in ["0.153.2", "0.153.4", "0.154.0"] {
        let supported = CodexPluginSetupProcessResult(
            exitCode: 0,
            stdout: Data("codex-cli \(version)\n".utf8)
        )
        #expect(try CodexPluginSetupProductionTrust.supportedVersion(from: supported) == version)
    }
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

@Test("Native qualification diagnostics remain typed Plugin errors")
func codexPluginSetupNativeQualificationPreservesDiagnostic() async throws {
    for diagnostic in CodexNativeDiagnostic.allCases {
        let fixture = try CodexPluginSetupFixture()
        let manager = fixture.manager(
            qualifier: { _ in throw diagnostic.error },
            revalidator: { $0.canonicalURL }
        )

        #expect(await manager.inspect() == .error(code: diagnostic.rawValue))
        #expect(fixture.fake.snapshotInvocations().isEmpty)
    }
}

@Test("Plugin inspection preserves native preflight failure memory until explicit recheck")
func codexPluginSetupNativePreflightRecheckOnlyResetsFailureMemory() async throws {
    let fixture = try CodexPluginSetupFixture()
    let executable = fixture.root.appendingPathComponent("native-codex-fixture")
    let config = fixture.root.appendingPathComponent("user-codex-config-fixture")
    let executableBytes = Data("inert Codex fixture, never executed".utf8)
    let configBytes = Data("existing user configuration must stay unchanged".utf8)
    try executableBytes.write(to: executable)
    try configBytes.write(to: config)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    let memory = CodexNativeFailureGuard(
        directoryURL: fixture.root.appendingPathComponent("native-failures")
    )
    let preflightProbe = CodexPluginSetupProcessProbe()
    let fake = fixture.fake
    let runtime = CodexNativeRuntime(
        candidates: { [executable] },
        qualifier: { url, _, _, _ in .testOnly(url: url) },
        revalidator: { $0.canonicalURL },
        processRunner: fake.run,
        preflight: { _, _ in
            preflightProbe.record()
            if preflightProbe.snapshot() == 1 {
                throw CodexNativeDiagnostic.notarizationUnavailable.error
            }
        },
        failureGuard: memory
    )
    let manager = fixture.manager(
        qualifier: { _ in .testOnly(url: executable) },
        revalidator: { $0.canonicalURL },
        nativeRuntime: runtime
    )

    #expect(await manager.inspect() == .error(
        code: CodexNativeDiagnostic.notarizationUnavailable.rawValue
    ))
    #expect(await manager.inspect() == .error(
        code: CodexNativeDiagnostic.notarizationUnavailable.rawValue
    ))
    #expect(preflightProbe.snapshot() == 1)
    #expect(fake.snapshotInvocations().isEmpty)

    #expect(await manager.recheckNativeExecutable() == .notInstalled)
    #expect(preflightProbe.snapshot() == 3)
    #expect(fake.snapshotInvocations().map(\.arguments) == [
        ["plugin", "marketplace", "list", "--json"],
        ["plugin", "list", "--json"],
    ])
    #expect(pluginSetupMutationArguments(fixture).isEmpty)
    #expect(try Data(contentsOf: executable) == executableBytes)
    #expect(try Data(contentsOf: config) == configBytes)

    // Clearing negative memory never becomes a positive trust receipt: later
    // ordinary inspection still performs both native preflight checks.
    #expect(await manager.inspect() == .notInstalled)
    #expect(preflightProbe.snapshot() == 5)
}

@Test("Explicit recheck report uses the same inspection and retains qualified executable evidence")
func codexPluginCheckReportUsesSingleInspection() async throws {
    let fixture = try CodexPluginSetupFixture()
    fixture.fake.installOwned()
    let executable = fixture.executable
    let probe = CodexPluginSetupTrustProbe()
    let manager = fixture.manager(
        qualifier: { _ in probe.qualify(executable) },
        revalidator: probe.revalidate
    )
    let result = await manager.recheckNativeExecutableWithReport()
    #expect(result.state == .installedNeedsHookReview(version: "0.1.0"))
    #expect(result.statusCode == "plugin_installed_hook_trust_unknown")
    #expect(result.evidence.stage == .installationValidation)
    #expect(result.evidence.sourcePath == executable.path)
    #expect(result.evidence.canonicalPath == executable.path)
    #expect(result.evidence.codexVersion == "0.152.1")
    #expect(result.evidence.errorCode == nil)
    #expect(probe.snapshot().qualifications == 1)
    #expect(fixture.fake.snapshotInvocations().map(\.arguments) == [
        ["plugin", "marketplace", "list", "--json"],
        ["plugin", "list", "--json"],
    ])
}

@Test("Explicit recheck report identifies failed list stage without probing again", arguments: [false, true])
func codexPluginCheckReportIdentifiesFailedListStage(failPluginList: Bool) async throws {
    let fixture = try CodexPluginSetupFixture()
    if failPluginList {
        fixture.fake.malformedPluginListOnCall = 1
    } else {
        fixture.fake.malformedMarketplaceListOnCall = 1
    }
    let result = await fixture.manager().recheckNativeExecutableWithReport()
    #expect(result.failed)
    #expect(result.evidence.stage == (failPluginList ? .pluginList : .marketplaceList))
    #expect(result.evidence.sourcePath == fixture.executable.path)
    #expect(result.evidence.codexVersion == "0.152.1")
    #expect(result.evidence.errorCode != nil)
    #expect(fixture.fake.snapshotInvocations().count == (failPluginList ? 2 : 1))
}

@Test("Explicit recheck report does not invent a selection when native qualification fails")
func codexPluginCheckReportQualificationFailureKeepsSelectionUnknown() async throws {
    let fixture = try CodexPluginSetupFixture()
    let manager = fixture.manager(resolver: {
        throw CoordinatorError("codex_plugin_setup_executable_unavailable")
    })
    let result = await manager.recheckNativeExecutableWithReport()
    #expect(result.failed)
    #expect(result.evidence.stage == .nativeExecutable)
    #expect(result.evidence.sourcePath == nil)
    #expect(result.evidence.canonicalPath == nil)
    #expect(result.evidence.codexVersion == nil)
    #expect(result.evidence.errorCode == "codex_plugin_setup_executable_unavailable")
    #expect(fixture.fake.snapshotInvocations().isEmpty)
}

@Test("Prepared Plugin mutation keeps native errors instead of generic add failure")
func codexPluginSetupNativeMutationPreservesDiagnostic() async throws {
    for diagnostic in [
        CodexNativeDiagnostic.executionTerminated,
        .notarizationUnavailable,
        .binaryChanged,
        .guardUnavailable,
    ] {
        let fixture = try CodexPluginSetupFixture()
        let fake = fixture.fake
        let mutationProbe = CodexPluginSetupProcessProbe()
        let manager = fixture.manager(processRunner: { executable, arguments, timeout in
            if arguments.starts(with: ["plugin", "marketplace", "add"]) {
                mutationProbe.record()
                throw diagnostic.error
            }
            return try fake.run(
                executable: executable,
                arguments: arguments,
                timeoutMilliseconds: timeout
            )
        })

        #expect(await manager.connect() == .error(code: diagnostic.rawValue))
        #expect(mutationProbe.snapshot() == 1)
        #expect(pluginSetupMutationArguments(fixture).isEmpty)
    }
}

@Test("Production version preflight rejects changed executable before the version process starts")
func codexPluginSetupProductionPreflightRejectsChangedIdentityBeforeVersion() throws {
    let fixture = try CodexPluginSetupFixture()
    let executable = fixture.root.appendingPathComponent("changing-native-codex-fixture")
    try Data("inert before".utf8).write(to: executable)
    #expect(chmod(executable.path, mode_t(0o700)) == 0)
    let processProbe = CodexPluginSetupProcessProbe()
    let preflightProbe = CodexPluginSetupProcessProbe()

    #expect(throws: CodexRuntimeTrustError.changedDuringQualification) {
        try CodexPluginSetupProductionTrust.qualify(
            sourceURL: executable,
            processRunner: { _, _, _ in
                processProbe.record()
                return CodexPluginSetupProcessResult(
                    exitCode: 0,
                    stdout: Data("codex-cli 0.153.2\n".utf8)
                )
            },
            trustInspector: { try codexPluginSetupTrustSnapshot(at: $0) },
            signatureValidator: { _ in },
            pinnedExecutableValidator: { _, _, _ in
                throw CoordinatorError("unexpected_pinned_fallback")
            },
            beforeVersionProbe: { url, _ in
                preflightProbe.record()
                try Data("inert changed during native preflight".utf8).write(to: url)
            }
        )
    }
    #expect(preflightProbe.snapshot() == 1)
    #expect(processProbe.snapshot() == 0)
}

@Test("Production version gate separates signal termination, ordinary exit 137 and malformed output")
func codexPluginSetupProductionVersionGatePreservesNativeFailureType() throws {
    let validVersion = Data("codex-cli 0.153.2\n".utf8)
    let killed = CodexPluginSetupProcessResult(
        exitCode: 137,
        stdout: validVersion,
        terminationSignal: SIGKILL
    )
    #expect(throws: CodexNativeDiagnostic.executionTerminated.error) {
        try CodexPluginSetupProductionTrust.supportedVersion(from: killed)
    }

    let ordinary137 = CodexPluginSetupProcessResult(exitCode: 137, stdout: validVersion)
    #expect(throws: CodexNativeDiagnostic.launchUnavailable.error) {
        try CodexPluginSetupProductionTrust.supportedVersion(from: ordinary137)
    }

    let malformed = CodexPluginSetupProcessResult(exitCode: 0, stdout: Data("not a version".utf8))
    #expect(throws: CodexNativeDiagnostic.probeOutputInvalid.error) {
        try CodexPluginSetupProductionTrust.supportedVersion(from: malformed)
    }
}

@Test("Unsafe alias does not exclude a safe candidate for the same canonical Codex file")
func codexPluginSetupResolverKeepsSafeSourceAfterUnsafeAlias() throws {
    let fixture = try CodexPluginSetupFixture()
    let safe = fixture.root.appendingPathComponent("safe-fixed-codex")
    let unsafeDirectory = fixture.root.appendingPathComponent("unsafe-alias-parent")
    let alias = unsafeDirectory.appendingPathComponent("codex")
    try Data("inert candidate fixture, never executed".utf8).write(to: safe)
    try FileManager.default.createDirectory(
        at: unsafeDirectory,
        withIntermediateDirectories: true
    )
    #expect(chmod(unsafeDirectory.path, mode_t(0o777)) == 0)
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: safe)
    #expect(alias.resolvingSymlinksInPath() == safe.resolvingSymlinksInPath())

    var attempted: [String] = []
    let selected = try CodexPluginSetupExecutableResolver.qualifyFirst(
        candidates: [alias, alias, safe],
        qualifier: { candidate in
            attempted.append(candidate.path)
            if candidate == alias {
                throw CodexNativeDiagnostic.pathUnsafe.error
            }
            return .testOnly(url: candidate, version: "0.153.2")
        }
    )

    #expect(attempted == [alias.path, safe.path])
    #expect(selected.sourceURL == safe)
    #expect(selected.version == "0.153.2")
}

@Test("Dangling and nonregular preferred Codex candidates do not hide a valid file")
func codexPluginSetupSkipsDanglingAndNonregularCandidates() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-plugin-dangling-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let dangling = root.appendingPathComponent("dangling")
    let directory = root.appendingPathComponent("directory", isDirectory: true)
    let safe = root.appendingPathComponent("safe")
    try FileManager.default.createSymbolicLink(
        at: dangling, withDestinationURL: root.appendingPathComponent("absent")
    )
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    try Data("fixture only".utf8).write(to: safe)
    var attempted: [URL] = []
    let result = try CodexPluginSetupExecutableResolver.qualifyFirst(
        candidates: [dangling, directory, safe],
        qualifier: {
            attempted.append($0)
            return .testOnly(url: $0)
        }
    )
    #expect(attempted == [safe])
    #expect(result.sourceURL == safe)
}

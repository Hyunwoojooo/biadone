import Foundation

@main
@MainActor
enum LauncherModelSmoke {
    static func main() async throws {
        try expect(
            LauncherShortcut.displayName == "⇧ Space",
            "Shift-Space shortcut"
        )
        try expect(
            LauncherNavigationReducer.cancel(from: .evidence) ==
                LauncherCancelResult(
                    route: .home,
                    disposition: .handledInLauncher
                ),
            "evidence cancel returns home"
        )
        try expect(
            LauncherNavigationReducer.cancel(from: .home) ==
                LauncherCancelResult(
                    route: .home,
                    disposition: .closePanel
                ),
            "home cancel closes panel"
        )
        let partialCoverage = LauncherSourceCoverage.make(
            unavailableSources: [.notion, .googleCalendar]
        )
        try expect(
            partialCoverage.availableSources == [.github, .codex],
            "source coverage canonical order"
        )
        try expect(
            partialCoverage.compactSummary == "평가 범위 2/4",
            "source coverage summary"
        )
        let disconnectedDiagnostics = [
            AttentionSourceDiagnostic(
                source: .github,
                state: .missing,
                signalCount: 0,
                candidateSetComplete: false,
                reasonCode: .snapshotMissing
            ),
            AttentionSourceDiagnostic(
                source: .codex,
                state: .disconnected,
                signalCount: 0,
                candidateSetComplete: false,
                reasonCode: .connectorDisconnected
            ),
            AttentionSourceDiagnostic(
                source: .notion,
                state: .unevaluated,
                signalCount: 0,
                candidateSetComplete: nil,
                reasonCode: nil
            ),
            AttentionSourceDiagnostic(
                source: .googleCalendar,
                state: .unevaluated,
                signalCount: 0,
                candidateSetComplete: nil,
                reasonCode: nil
            )
        ]
        try expect(
            LauncherPresentation.shouldOfferDataConnectionCheck(
                sourceDiagnostics: disconnectedDiagnostics
            ),
            "primary source recovery action"
        )
        let oneDisconnectedDiagnostics = [
            AttentionSourceDiagnostic(
                source: .github,
                state: .available,
                signalCount: 1,
                candidateSetComplete: true,
                reasonCode: nil
            ),
            disconnectedDiagnostics[1],
            disconnectedDiagnostics[2],
            disconnectedDiagnostics[3]
        ]
        try expect(
            LauncherPresentation.shouldOfferDataConnectionCheck(
                sourceDiagnostics: oneDisconnectedDiagnostics
            ),
            "single primary source recovery action"
        )
        try expect(
            LauncherPresentation.sourceDiagnosticDisplay(
                disconnectedDiagnostics[1]
            ).stateLabel == "연결 안 됨",
            "exact source diagnostic state"
        )
        try expect(
            LauncherIPC.requestID(
                uuid: UUID(
                    uuidString: "11111111-2222-3333-4444-555555555555"
                )!
            ) == "request-11111111-2222-3333-4444-555555555555",
            "request ID"
        )
        try expect(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/issues/42"
            ) != nil,
            "exact GitHub destination"
        )
        try expect(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/issues/42?token=private"
            ) == nil,
            "GitHub query rejection"
        )
        try expect(
            SafeURLPolicy.dashboardURL(
                path: "/",
                baseURL: URL(string: "https://evil.example")!
            ) == nil,
            "dashboard host rejection"
        )
        try expect(
            SafeURLPolicy.dashboardBaseURL(
                from: "http://localhost:3102"
            )?.absoluteString == "http://localhost:3102",
            "local dashboard base"
        )
        try expect(
            SafeURLPolicy.dashboardURL(
                path: "/sources",
                baseURL: URL(string: "http://localhost:3102")!
            )?.absoluteString == "http://localhost:3102/sources",
            "local source connection destination"
        )
        try expect(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://app.blabase.com/private"
            ) == nil,
            "dashboard base path rejection"
        )
        try expect(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://app.blabase.com?token=private"
            ) == nil,
            "dashboard base query rejection"
        )
        try expect(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://user:password@app.blabase.com"
            ) == nil,
            "dashboard credential rejection"
        )
        try expect(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://app.blabase.com#private"
            ) == nil,
            "dashboard fragment rejection"
        )

        let settings = LauncherSettingsSnapshot(
            schemaVersion: LauncherSettingsSnapshot.currentSchemaVersion,
            revision: 1,
            dataRootChoice: .existingReadOnly(
                path: "/private/tmp/blabase-existing"
            ),
            dashboardBaseURLString: "https://app.blabase.com",
            onboardingCompleted: true
        )
        let decodedSettings = try LauncherSettingsStore.decode(
            LauncherSettingsStore.encode(settings)
        )
        try expect(decodedSettings == settings, "settings round trip")
        try expectThrows("unknown settings version") {
            _ = try LauncherSettingsStore.decode(
                LauncherSettingsStore.encode(
                    LauncherSettingsSnapshot(
                        schemaVersion: 99,
                        revision: 1,
                        dataRootChoice: .managedDefault,
                        dashboardBaseURLString: "https://app.blabase.com",
                        onboardingCompleted: true
                    )
                )
            )
        }

        let fileManager = FileManager.default
        let dataRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "blabase-launcher-smoke-\(UUID().uuidString)",
            isDirectory: true
        )
        let marker = dataRoot.appendingPathComponent(
            ".local/connectors/github/snapshot.json"
        )
        try fileManager.createDirectory(
            at: marker.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard fileManager.createFile(atPath: marker.path, contents: Data()) else {
            throw SmokeError.failed("data root marker")
        }
        defer { try? fileManager.removeItem(at: dataRoot) }
        let validatedDataRoot = try LauncherDataRootPolicy.validateExistingRoot(
            path: dataRoot.path,
            fileManager: fileManager
        )
        try expect(
            validatedDataRoot ==
                dataRoot.resolvingSymlinksInPath().standardizedFileURL,
            "existing data root"
        )
        try expectThrows("direct local selection") {
            _ = try LauncherDataRootPolicy.validateExistingRoot(
                path: dataRoot.appendingPathComponent(".local").path,
                fileManager: fileManager
            )
        }
        let invalidMarkerRoot = fileManager.temporaryDirectory
            .appendingPathComponent(
                "blabase-launcher-invalid-marker-\(UUID().uuidString)",
                isDirectory: true
            )
        let invalidMarker = invalidMarkerRoot.appendingPathComponent(
            ".local/sync/latest.json",
            isDirectory: true
        )
        try fileManager.createDirectory(
            at: invalidMarker,
            withIntermediateDirectories: true
        )
        defer { try? fileManager.removeItem(at: invalidMarkerRoot) }
        try expectThrows("directory store marker") {
            _ = try LauncherDataRootPolicy.validateExistingRoot(
                path: invalidMarkerRoot.path,
                fileManager: fileManager
            )
        }

        let settingsPersistence = InMemorySettingsPersistence()
        let settingsStore = LauncherSettingsStore(
            persistence: settingsPersistence,
            environment: [:],
            fileManager: fileManager
        )
        try expect(settingsStore.requiresSetup, "fresh setup required")
        settingsStore.persist(
            try settingsStore.prepare(
                dataRootChoice: .existingReadOnly(path: dataRoot.path),
                dashboardBaseURLText: "http://localhost:3102/"
            )
        )
        let reloadedSettings = LauncherSettingsStore(
            persistence: settingsPersistence,
            environment: [
                "BLABASE_LAUNCHER_DATA_ROOT":
                    dataRoot.appendingPathComponent("legacy").path
            ],
            fileManager: fileManager
        )
        try expect(!reloadedSettings.requiresSetup, "settings persistence")
        try expect(
            reloadedSettings.currentDataRootChoice ==
                .existingReadOnly(path: validatedDataRoot.path),
            "persisted root precedence"
        )
        try expect(
            LauncherDataRootSelectionPolicy
                .dashboardBaseURLStringForExistingRoot(
                    current: "https://app.blabase.com"
                ) == "http://localhost:3102",
            "existing root local dashboard default"
        )
        try expect(
            LauncherDataRootSelectionPolicy
                .dashboardBaseURLStringForExistingRoot(
                    current: "http://127.0.0.1:3199"
                ) == "http://127.0.0.1:3199",
            "existing root explicit dashboard retention"
        )
        try expect(
            LauncherSettingsApplyPlan.make(
                previousChoice: .managedDefault,
                nextChoice: .managedDefault,
                isAgentActive: true
            ) == LauncherSettingsApplyPlan(
                stopCurrentAgent: false,
                loadAttention: false
            ),
            "dashboard-only apply plan"
        )
        try expect(
            LauncherSettingsApplyPlan.make(
                previousChoice: .managedDefault,
                nextChoice: .existingReadOnly(path: validatedDataRoot.path),
                isAgentActive: true
            ) == LauncherSettingsApplyPlan(
                stopCurrentAgent: true,
                loadAttention: true
            ),
            "data-root apply plan"
        )
        var transactionEvents: [String] = []
        try await LauncherSettingsTransaction.run(
            plan: LauncherSettingsApplyPlan(
                stopCurrentAgent: true,
                loadAttention: true
            ),
            isTerminating: { false },
            stopAgent: { transactionEvents.append("stop") },
            activateDataRoot: { transactionEvents.append("activate") },
            persist: { transactionEvents.append("persist") },
            loadAttention: { transactionEvents.append("load") }
        )
        try expect(
            transactionEvents == ["stop", "activate", "persist", "load"],
            "settings transaction order"
        )
        transactionEvents.removeAll()
        do {
            try await LauncherSettingsTransaction.run(
                plan: LauncherSettingsApplyPlan(
                    stopCurrentAgent: true,
                    loadAttention: true
                ),
                isTerminating: { false },
                stopAgent: {
                    transactionEvents.append("stop")
                    throw SmokeError.failed("expected stop failure")
                },
                activateDataRoot: { transactionEvents.append("activate") },
                persist: { transactionEvents.append("persist") },
                loadAttention: { transactionEvents.append("load") }
            )
            throw SmokeError.failed("settings stop failure")
        } catch SmokeError.failed(let label) where label == "expected stop failure" {
            try expect(
                transactionEvents == ["stop"],
                "settings failure remains unpersisted"
            )
        }

        let exhaustedPersistence = InMemorySettingsPersistence()
        exhaustedPersistence.set(
            try LauncherSettingsStore.encode(
                LauncherSettingsSnapshot(
                    schemaVersion: LauncherSettingsSnapshot.currentSchemaVersion,
                    revision: LauncherSettingsSnapshot.maximumRevision,
                    dataRootChoice: .existingReadOnly(
                        path: validatedDataRoot.path
                    ),
                    dashboardBaseURLString: "https://app.blabase.com",
                    onboardingCompleted: true
                )
            ),
            forKey: LauncherSettingsStore.storageKey
        )
        let exhaustedStore = LauncherSettingsStore(
            persistence: exhaustedPersistence,
            environment: [:],
            fileManager: fileManager
        )
        try expectThrows("settings revision exhaustion") {
            _ = try exhaustedStore.prepare(
                dataRootChoice: .existingReadOnly(path: validatedDataRoot.path),
                dashboardBaseURLText: "https://app.blabase.com"
            )
        }

        let agentLog = dataRoot.appendingPathComponent("agent-smoke.log")
        guard fileManager.createFile(atPath: agentLog.path, contents: Data()) else {
            throw SmokeError.failed("agent log")
        }
        var launchCount = 0
        let agentClient = LauncherAgentClient(
            configurationResolver: {
                launchCount += 1
                return LauncherRuntimeConfiguration(
                    executableURL: URL(fileURLWithPath: "/bin/sh"),
                    arguments: [
                        "-c",
                        "while IFS= read -r line; do :; done"
                    ],
                    dataRootURL: dataRoot,
                    environment: ["PATH": "/usr/bin:/bin"]
                )
            },
            logHandleFactory: {
                try FileHandle(forWritingTo: agentLog)
            },
            requestTimeoutNanoseconds: 5_000_000_000
        )
        let firstRequest = Task {
            try await agentClient.getAttention(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        try await agentClient.stopForReconfiguration()
        do {
            _ = try await firstRequest.value
            throw SmokeError.failed("pending request cancellation")
        } catch is SmokeError {
            throw SmokeError.failed("pending request cancellation")
        } catch {
            try expect(
                error as? LauncherAgentError == .disconnected,
                "pending request disconnected"
            )
        }
        let secondRequest = Task {
            try await agentClient.getAttention(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        try await agentClient.stopForReconfiguration()
        _ = try? await secondRequest.value
        try expect(launchCount == 2, "agent restart after configuration")
        agentClient.shutdown()
        let validProjectionString = #"""
        {
          "contract":"blabase-launcher-attention-v2",
          "resultId":"attention_result_11111111111111111111111111111111",
          "asOf":"2026-08-03T00:00:00.000Z",
          "decisionStatus":"insufficient_evidence",
          "decisionReasonCodes":["DECISION_RELEVANT_COVERAGE_INSUFFICIENT"],
          "candidateCounts":{"eligible":0,"reviewRequired":0,"ineligible":0},
          "sourceDiagnostics":[
            {"source":"github","state":"missing","signalCount":0,"candidateSetComplete":false,"reasonCode":"SNAPSHOT_MISSING"},
            {"source":"codex","state":"available","signalCount":2,"candidateSetComplete":true,"reasonCode":null},
            {"source":"notion","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null},
            {"source":"google_calendar","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null}
          ],
          "card":null,
          "clarificationQuestion":null,
          "scopeStatement":"연결되고 갱신된 source만 평가했습니다.",
          "unavailableSources":["github"],
          "dashboardPath":"/"
        }
        """#
        let validProjection = Data(validProjectionString.utf8)
        _ = try JSONDecoder().decode(
            LauncherAttentionProjection.self,
            from: validProjection
        )
        try expectThrows("projection invariant") {
            let invalidProjection = Data(
                validProjectionString.replacingOccurrences(
                    of: #""dashboardPath":"/""#,
                    with: #""dashboardPath":"/private""#
                ).utf8
            )
            _ = try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: invalidProjection
            )
        }

        let childEnvironment =
            LauncherRuntimeConfiguration.sanitizedChildEnvironment([
                "PATH": "/usr/bin",
                "GITHUB_APP_CLIENT_ID": "connector-config",
                "NODE_OPTIONS": "--require=/tmp/untrusted.js",
                "DYLD_INSERT_LIBRARIES": "/tmp/untrusted.dylib",
                "BLABASE_LAUNCHER_SOURCE_MODE": "managed",
                "BLABASE_CODE_COMMIT_SHA": String(repeating: "a", count: 40),
                "GITHUB_SHA": String(repeating: "b", count: 40)
            ])
        try expect(childEnvironment["PATH"] == "/usr/bin", "PATH retention")
        try expect(
            childEnvironment["GITHUB_APP_CLIENT_ID"] == "connector-config",
            "connector environment retention"
        )
        try expect(childEnvironment["NODE_OPTIONS"] == nil, "Node injection")
        try expect(
            childEnvironment["DYLD_INSERT_LIBRARIES"] == nil,
            "dynamic-loader injection"
        )
        try expect(
            childEnvironment["BLABASE_LAUNCHER_SOURCE_MODE"] == nil,
            "source-mode injection"
        )
        try expect(
            childEnvironment["BLABASE_CODE_COMMIT_SHA"] == nil,
            "provenance injection"
        )
        try expect(
            childEnvironment["GITHUB_SHA"] == nil,
            "ambient CI provenance injection"
        )
        try expect(
            childEnvironment["BLABASE_LAUNCHER_DATA_ROOT"] == nil,
            "data-root environment removal"
        )

        let manifest = Data(
            """
            {
              "contract":"blabase-launcher-runtime-manifest-v1",
              "codeState":"dirty_worktree",
              "codeFingerprintSha256":"\(String(repeating: "b", count: 64))",
              "agentSha256":"\(String(repeating: "c", count: 64))"
            }
            """.utf8
        )
        let runtimeEnvironment = try LauncherRuntimeConfiguration
            .validatedRuntimeEnvironment(manifestData: manifest)
        try expect(
            runtimeEnvironment["BLABASE_CODE_FINGERPRINT_SHA256"] ==
                String(repeating: "b", count: 64),
            "runtime fingerprint provenance"
        )

        var policy = SupervisorRestartPolicy(
            maximumRestarts: 1,
            window: 60,
            delaysNanoseconds: [1]
        )
        let now = Date(timeIntervalSince1970: 1_000)
        try expect(
            policy.recordUnexpectedExit(at: now) ==
                .restart(afterNanoseconds: 1),
            "bounded restart first attempt"
        )
        try expect(
            policy.recordUnexpectedExit(at: now) == .stop,
            "bounded restart stop"
        )

        print("Blabase launcher model smoke passed")
    }

    private static func expect(
        _ condition: @autoclosure () -> Bool,
        _ label: String
    ) throws {
        guard condition() else {
            throw SmokeError.failed(label)
        }
    }

    private static func expectThrows(
        _ label: String,
        _ action: () throws -> Void
    ) throws {
        do {
            try action()
            throw SmokeError.failed(label)
        } catch is SmokeError {
            throw SmokeError.failed(label)
        } catch {
            return
        }
    }
}

private enum SmokeError: Error {
    case failed(String)
}

@MainActor
private final class InMemorySettingsPersistence: LauncherSettingsPersistence {
    private var values: [String: Any] = [:]

    func object(forKey defaultName: String) -> Any? {
        values[defaultName]
    }

    func set(_ value: Any?, forKey defaultName: String) {
        values[defaultName] = value
    }
}

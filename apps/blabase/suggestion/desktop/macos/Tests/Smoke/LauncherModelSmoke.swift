import Darwin
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
        let emptyWorkBoard = try JSONDecoder().decode(
            LauncherWorkBoardProjection.self,
            from: Data(
                #"{"contract":"blabase-launcher-work-board-v1","generatedAt":"2026-08-13T09:00:00.000Z","mode":"full","prominentLane":"none","continuationStatus":"empty","items":[]}"#.utf8
            )
        )
        try expect(
            emptyWorkBoard.items.isEmpty &&
                LauncherWorkBoardPresentation.emptyLaneText ==
                    "표시할 제안 없음",
            "strict empty Work Board"
        )
        let publicTitleBoard = #"{"contract":"blabase-launcher-work-board-v1","generatedAt":"2026-08-13T09:00:00.000Z","mode":"full","prominentLane":"attention","continuationStatus":"empty","items":[{"lane":"attention","title":"CI/CD 결과 확인","evidenceBand":"verified_attention","caveatCodes":[],"expiresAt":null,"capability":"display","action":null}]}"#
        _ = try JSONDecoder().decode(
            LauncherWorkBoardProjection.self,
            from: Data(publicTitleBoard.utf8)
        )
        for privateTitle in ["session_private", "result_private"] {
            try expectThrows("private Work Board namespace") {
                _ = try JSONDecoder().decode(
                    LauncherWorkBoardProjection.self,
                    from: Data(
                        publicTitleBoard.replacingOccurrences(
                            of: "CI/CD 결과 확인",
                            with: privateTitle
                        ).utf8
                    )
                )
            }
        }
        let initialReadOnlyStatus = try JSONDecoder().decode(
            LauncherAgentStatus.self,
            from: Data(
                #"{"contract":"blabase-launcher-status-v1","rootId":null,"sourceMode":"read_only","mutationAuthority":"none","syncRevision":"sync-1"}"#.utf8
            )
        )
        let refreshedReadOnlyStatus = try JSONDecoder().decode(
            LauncherAgentStatus.self,
            from: Data(
                #"{"contract":"blabase-launcher-status-v1","rootId":"root_11111111111111111111111111111111","sourceMode":"read_only","mutationAuthority":"none","syncRevision":"sync-1"}"#.utf8
            )
        )
        let dashboardRootContext = try JSONDecoder().decode(
            DashboardRootContext.self,
            from: Data(
                #"{"contract":"blabase-root-context-v1","rootId":"root_11111111111111111111111111111111","mutationAuthority":"dashboard","syncRevision":"sync-1"}"#.utf8
            )
        )
        var rootHandshakeEvents: [String] = []
        var rootHandshakeStatuses = [
            initialReadOnlyStatus,
            refreshedReadOnlyStatus
        ]
        let rootHandshakeDecision = try await
            LauncherSourceNavigationHandshake.evaluate(
                getAgentStatus: {
                    rootHandshakeEvents.append("agent")
                    return rootHandshakeStatuses.removeFirst()
                },
                getDashboardContext: {
                    rootHandshakeEvents.append("dashboard")
                    return dashboardRootContext
                }
            )
        try expect(
            rootHandshakeEvents == ["agent", "dashboard", "agent"],
            "first-use root handshake order"
        )
        try expect(
            rootHandshakeDecision == .allowed,
            "matching root and revision navigation"
        )
        try expectThrows("unknown launcher status field") {
            _ = try JSONDecoder().decode(
                LauncherAgentStatus.self,
                from: Data(
                    #"{"contract":"blabase-launcher-status-v1","rootId":"root_11111111111111111111111111111111","sourceMode":"read_only","mutationAuthority":"none","syncRevision":"sync-1","dataRootPath":"/private/root"}"#.utf8
                )
            )
        }
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
            SafeURLPolicy.sourceConnectionURL(
                for: .github,
                baseURL: URL(string: "http://localhost:3102")!
            )?.absoluteString ==
                "http://localhost:3102/sources?source=github&entry=launcher#source-github",
            "fixed GitHub source destination"
        )
        try expect(
            SafeURLPolicy.sourceConnectionURL(
                for: .googleCalendar,
                baseURL: URL(string: "http://localhost:3102")!
            )?.absoluteString ==
                "http://localhost:3102/sources?source=google-calendar&entry=launcher#source-google-calendar",
            "fixed calendar source destination"
        )
        try expect(
            SafeURLPolicy.dashboardURL(
                path: "/sources?returnTo=/private",
                baseURL: URL(string: "http://localhost:3102")!
            ) == nil,
            "arbitrary dashboard query rejection"
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
        try expect(
            LauncherSettingsApplyPlan.make(
                previousChoice: .managedDefault,
                nextChoice: .existingReadOnly(path: validatedDataRoot.path),
                isAgentActive: false
            ) == LauncherSettingsApplyPlan(
                stopCurrentAgent: true,
                loadAttention: true
            ),
            "inactive retry still stops before data-root change"
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
        try await agentClient.beginConfigurationStop()
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
        agentClient.completeConfigurationChange()
        let secondRequest = Task {
            try await agentClient.getAttention(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        try await agentClient.beginConfigurationStop()
        _ = try? await secondRequest.value
        try expect(launchCount == 2, "agent restart after configuration")
        agentClient.completeConfigurationChange()
        try await agentClient.shutdown()

        let canonicalRequestId = LauncherIPC.requestID(
            uuid: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        )
        let validEnvelope = Data(
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(canonicalRequestId)","ok":true,"result":{"contract":"blabase-launcher-work-board-v1"}}"#.utf8
        )
        guard case .success(let parsedRequestId, _) =
            try LauncherIPC.parseResponseLine(validEnvelope)
        else {
            throw SmokeError.failed("strict IPC envelope")
        }
        try expect(
            parsedRequestId == canonicalRequestId,
            "canonical IPC request identity"
        )
        for hostileEnvelope in [
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(canonicalRequestId)","ok":true,"result":{},"extra":true}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(canonicalRequestId)","ok":true,"result":{},"error":{"code":"FAILED","message":"bounded"}}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"bad","ok":false,"error":{"code":"FAILED","message":"bounded"}}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(canonicalRequestId)","ok":false,"error":{"code":"lowercase","message":"bounded"}}"#
        ] {
            try expectThrows("strict IPC envelope mutation") {
                _ = try LauncherIPC.parseResponseLine(
                    Data(hostileEnvelope.utf8)
                )
            }
        }
        for unsafeMessage in [
            "private_target_secret",
            "/Users/private/work",
            "https://private.example.test/path",
            "token=private-token-value"
        ] {
            let compatibleUnsafeError = try JSONSerialization.data(
                withJSONObject: [
                    "contract": "blabase-launcher-ipc-v1",
                    "requestId": canonicalRequestId,
                    "ok": false,
                    "error": [
                        "code": "INVALID_REQUEST",
                        "message": unsafeMessage
                    ]
                ]
            )
            guard case .failure(_, let parsedError) =
                try LauncherIPC.parseResponseLine(compatibleUnsafeError)
            else {
                throw SmokeError.failed("compatible IPC error payload")
            }
            try expect(
                parsedError.code == "INVALID_REQUEST" &&
                    LauncherIPC.displayErrorMessage(parsedError.message) ==
                        "Local Agent 요청을 처리하지 못했습니다.",
                "unsafe IPC v1 message is accepted and display-sanitized"
            )
        }
        for (code, message) in [
            (String(repeating: "A", count: 121), "bounded"),
            ("FAILED", String(repeating: "가", count: 501)),
            ("FAILED", "line\nbreak")
        ] {
            let hostileError = try JSONSerialization.data(
                withJSONObject: [
                    "contract": "blabase-launcher-ipc-v1",
                    "requestId": canonicalRequestId,
                    "ok": false,
                    "error": ["code": code, "message": message]
                ]
            )
            try expectThrows("strict IPC error payload") {
                _ = try LauncherIPC.parseResponseLine(hostileError)
            }
        }

        let termTrappingAgent = #"""
        IFS= read -r line || exit 1
        trap 'printf trapped > "$1"; printf "late\n"' TERM
        while :; do :; done
        """#
        var hungLaunchCount = 0
        var hungProcesses: [Process] = []
        var hungTermMarkers: [URL] = []
        let hungClient = LauncherAgentClient(
            configurationResolver: {
                hungLaunchCount += 1
                let marker = dataRoot.appendingPathComponent(
                    "hung-term-\(hungLaunchCount).marker"
                )
                hungTermMarkers.append(marker)
                return LauncherRuntimeConfiguration(
                    executableURL: URL(fileURLWithPath: "/bin/sh"),
                    arguments: [
                        "-c",
                        termTrappingAgent,
                        "launcher-term-fake",
                        marker.path
                    ],
                    dataRootURL: dataRoot,
                    environment: ["PATH": "/usr/bin:/bin"]
                )
            },
            processFactory: {
                let process = Process()
                hungProcesses.append(process)
                return process
            },
            logHandleFactory: {
                try FileHandle(forWritingTo: agentLog)
            },
            requestTimeoutNanoseconds: 20_000_000
        )
        do {
            _ = try await hungClient.getPreferredProjection(refresh: true)
            throw SmokeError.failed("hung Board timeout")
        } catch is SmokeError {
            throw SmokeError.failed("hung Board timeout")
        } catch {
            try expect(
                error as? LauncherAgentError == .requestTimedOut,
                "hung Board surfaces timeout"
            )
        }
        try expect(hungLaunchCount == 1, "hung Board launched once")
        var mainActorHeartbeat = 0
        let heartbeatTask = Task {
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 25_000_000)
                mainActorHeartbeat += 1
            }
        }
        try await hungClient.beginConfigurationStop()
        _ = await heartbeatTask.value
        try expect(
            hungProcesses.count == 1 && !hungProcesses[0].isRunning,
            "hung Board timeout kills the retired process"
        )
        try expect(
            fileManager.fileExists(atPath: hungTermMarkers[0].path),
            "hung Board timeout reaches TERM trap before SIGKILL"
        )
        try expect(
            mainActorHeartbeat >= 10,
            "retirement wait yields the main actor"
        )
        hungClient.completeConfigurationChange()
        let freshGenerationRequest = Task {
            try await hungClient.getAttention(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        try await hungClient.beginConfigurationStop()
        _ = try? await freshGenerationRequest.value
        try expect(
            hungLaunchCount == 2,
            "Board timeout retires the agent generation"
        )
        try expect(
            hungProcesses.count == 2 && !hungProcesses[1].isRunning,
            "configuration stop kills a TERM-trapping agent"
        )
        try expect(
            fileManager.fileExists(atPath: hungTermMarkers[1].path),
            "configuration stop reaches TERM trap before SIGKILL"
        )
        hungClient.completeConfigurationChange()

        let shutdownRequest = Task {
            try await hungClient.getAttention(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        try await hungClient.shutdown()
        _ = try? await shutdownRequest.value
        try expect(
            hungLaunchCount == 3 &&
                hungProcesses.count == 3 &&
                !hungProcesses[2].isRunning,
            "app shutdown kills a TERM-trapping agent"
        )
        try expect(
            fileManager.fileExists(atPath: hungTermMarkers[2].path),
            "app shutdown reaches TERM trap before SIGKILL"
        )

        var cancellationLaunchCount = 0
        var cancellationProcesses: [Process] = []
        var cancellationTermMarkers: [URL] = []
        let successfulStatusAgent = #"""
        IFS= read -r line
        request_id=$(printf '%s' "$line" | /usr/bin/sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p')
        printf '{"contract":"blabase-launcher-ipc-v1","requestId":"%s","ok":true,"result":{"contract":"blabase-launcher-status-v1","rootId":null,"sourceMode":"read_only","mutationAuthority":"none","syncRevision":null}}\n' "$request_id"
        """#
        let cancellationClient = LauncherAgentClient(
            configurationResolver: {
                cancellationLaunchCount += 1
                let marker = dataRoot.appendingPathComponent(
                    "cancel-term-\(cancellationLaunchCount).marker"
                )
                cancellationTermMarkers.append(marker)
                return LauncherRuntimeConfiguration(
                    executableURL: URL(fileURLWithPath: "/bin/sh"),
                    arguments: [
                        "-c",
                        cancellationLaunchCount == 1
                            ? termTrappingAgent
                            : successfulStatusAgent,
                        "launcher-cancel-fake",
                        marker.path
                    ],
                    dataRootURL: dataRoot,
                    environment: ["PATH": "/usr/bin:/bin"]
                )
            },
            processFactory: {
                let process = Process()
                cancellationProcesses.append(process)
                return process
            },
            logHandleFactory: {
                try FileHandle(forWritingTo: agentLog)
            },
            requestTimeoutNanoseconds: 5_000_000_000
        )
        let cancelledBoard = Task {
            try await cancellationClient.getPreferredProjection(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        cancelledBoard.cancel()
        do {
            _ = try await cancelledBoard.value
            throw SmokeError.failed("cancelled Board request")
        } catch is CancellationError {
            // Expected: cancellation owns and retires the old generation.
        }
        let freshStatus = try await cancellationClient.getStatus()
        try expect(
            cancellationLaunchCount == 2 &&
                freshStatus.sourceMode == .readOnly,
            "request after Board cancellation uses a fresh process"
        )
        try expect(
            cancellationProcesses.count == 2 &&
                !cancellationProcesses[0].isRunning &&
                fileManager.fileExists(
                    atPath: cancellationTermMarkers[0].path
                ),
            "cancelled Board verifies old exit before a fresh process"
        )
        try await cancellationClient.shutdown()
        try expect(
            cancellationProcesses.count == 2 &&
                !cancellationProcesses[1].isRunning,
            "fresh cancellation-test process exits on shutdown"
        )

        var failedRetirementLaunchCount = 0
        var failedRetirementProcesses: [Process] = []
        let failedRetirementClient = LauncherAgentClient(
            configurationResolver: {
                failedRetirementLaunchCount += 1
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
            processFactory: {
                let process = Process()
                failedRetirementProcesses.append(process)
                return process
            },
            logHandleFactory: {
                try FileHandle(forWritingTo: agentLog)
            },
            requestTimeoutNanoseconds: 5_000_000_000,
            processTerminator: { _ in false }
        )
        let failedRetirementRequest = Task {
            try await failedRetirementClient.getPreferredProjection(
                refresh: false
            )
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        failedRetirementRequest.cancel()
        _ = try? await failedRetirementRequest.value
        do {
            _ = try await failedRetirementClient.getStatus()
            throw SmokeError.failed("failed retirement replacement")
        } catch SmokeError.failed(let label)
            where label == "failed retirement replacement" {
            throw SmokeError.failed(label)
        } catch {
            try expect(
                error as? LauncherAgentError ==
                    .invalidRuntime("agent still stopping"),
                "unverified retirement surfaces bounded runtime error"
            )
        }
        try expect(
            failedRetirementLaunchCount == 1,
            "unverified retirement cannot launch a replacement"
        )
        if let failedProcess = failedRetirementProcesses.first,
           failedProcess.isRunning {
            Darwin.kill(failedProcess.processIdentifier, SIGKILL)
        }

        let nextDataRoot = dataRoot.appendingPathComponent("next-root")
        try fileManager.createDirectory(
            at: nextDataRoot,
            withIntermediateDirectories: false
        )
        var activeHeldRoot = dataRoot
        var heldLaunchCount = 0
        var heldProcesses: [Process] = []
        var heldTermination: CheckedContinuation<Bool, Never>?
        let heldClient = LauncherAgentClient(
            configurationResolver: {
                heldLaunchCount += 1
                return LauncherRuntimeConfiguration(
                    executableURL: URL(fileURLWithPath: "/bin/sh"),
                    arguments: [
                        "-c",
                        heldLaunchCount == 1
                            ? "IFS= read -r line || exit 1; while :; do :; done"
                            : successfulStatusAgent
                    ],
                    dataRootURL: activeHeldRoot,
                    environment: ["PATH": "/usr/bin:/bin"]
                )
            },
            processFactory: {
                let process = Process()
                heldProcesses.append(process)
                return process
            },
            logHandleFactory: {
                try FileHandle(forWritingTo: agentLog)
            },
            requestTimeoutNanoseconds: 5_000_000_000,
            processTerminator: { process in
                guard process.isRunning else { return true }
                return await withCheckedContinuation { continuation in
                    heldTermination = continuation
                }
            }
        )
        let heldBoard = Task {
            try await heldClient.getPreferredProjection(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        heldBoard.cancel()
        _ = try? await heldBoard.value
        for _ in 0..<100 where heldTermination == nil {
            await Task.yield()
        }
        try expect(heldTermination != nil, "held retirement started")
        let waitingOldRootRequest = Task {
            try await heldClient.getStatus()
        }
        await Task.yield()
        let stopHeldClient = Task {
            try await heldClient.beginConfigurationStop()
        }
        waitingOldRootRequest.cancel()
        if heldProcesses[0].isRunning {
            Darwin.kill(heldProcesses[0].processIdentifier, SIGKILL)
        }
        for _ in 0..<100 where heldProcesses[0].isRunning {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        heldTermination?.resume(returning: true)
        heldTermination = nil
        try await stopHeldClient.value
        _ = try? await waitingOldRootRequest.value
        try expect(
            heldLaunchCount == 1,
            "config stop epoch blocks waiting old-root launch"
        )
        do {
            _ = try await heldClient.getStatus()
            throw SmokeError.failed("pre-activation old-root launch")
        } catch SmokeError.failed(let label)
            where label == "pre-activation old-root launch" {
            throw SmokeError.failed(label)
        } catch {
            try expect(
                error as? LauncherAgentError == .disconnected &&
                    heldLaunchCount == 1,
                "completed stop holds gate until root activation"
            )
        }
        heldClient.abortConfigurationChange()
        let oldRootStatus = try await heldClient.getStatus()
        try expect(
            heldLaunchCount == 2 &&
                oldRootStatus.sourceMode == .readOnly &&
                heldProcesses[1].currentDirectoryURL?.standardizedFileURL.path ==
                    dataRoot.standardizedFileURL.path,
            "activation abort can restart only the unchanged old root"
        )
        let retryPlan = LauncherSettingsApplyPlan.make(
            previousChoice: .managedDefault,
            nextChoice: .existingReadOnly(path: nextDataRoot.path),
            isAgentActive: false
        )
        try expect(
            retryPlan.stopCurrentAgent,
            "root-change retry ignores stale activity flag"
        )
        for _ in 0..<100 where heldProcesses[1].isRunning {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        try await heldClient.beginConfigurationStop()
        activeHeldRoot = nextDataRoot
        heldClient.completeConfigurationChange()
        let nextRootStatus = try await heldClient.getStatus()
        try expect(
                heldLaunchCount == 3 &&
                nextRootStatus.sourceMode == .readOnly &&
                heldProcesses[2].currentDirectoryURL?.standardizedFileURL.path ==
                    nextDataRoot.standardizedFileURL.path,
            "post-config request launches only on the new root"
        )
        try await heldClient.shutdown()

        var shutdownRaceLaunchCount = 0
        var shutdownRaceProcesses: [Process] = []
        var shutdownRaceTermination: CheckedContinuation<Bool, Never>?
        let shutdownRaceClient = LauncherAgentClient(
            configurationResolver: {
                shutdownRaceLaunchCount += 1
                return LauncherRuntimeConfiguration(
                    executableURL: URL(fileURLWithPath: "/bin/sh"),
                    arguments: [
                        "-c",
                        "IFS= read -r line || exit 1; while :; do :; done"
                    ],
                    dataRootURL: dataRoot,
                    environment: ["PATH": "/usr/bin:/bin"]
                )
            },
            processFactory: {
                let process = Process()
                shutdownRaceProcesses.append(process)
                return process
            },
            logHandleFactory: {
                try FileHandle(forWritingTo: agentLog)
            },
            requestTimeoutNanoseconds: 5_000_000_000,
            processTerminator: { process in
                guard process.isRunning else { return true }
                return await withCheckedContinuation { continuation in
                    shutdownRaceTermination = continuation
                }
            }
        )
        let shutdownRaceBoard = Task {
            try await shutdownRaceClient.getPreferredProjection(refresh: false)
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        shutdownRaceBoard.cancel()
        _ = try? await shutdownRaceBoard.value
        for _ in 0..<100 where shutdownRaceTermination == nil {
            await Task.yield()
        }
        let shutdownWaitingRequest = Task {
            try await shutdownRaceClient.getStatus()
        }
        await Task.yield()
        let permanentShutdown = Task {
            try await shutdownRaceClient.shutdown()
        }
        shutdownWaitingRequest.cancel()
        // The injected terminator reports success only after the fake process
        // has actually exited, mirroring the production verifier.
        let shutdownRaceProcess = shutdownRaceProcesses[0]
        if shutdownRaceProcess.isRunning {
            Darwin.kill(shutdownRaceProcess.processIdentifier, SIGKILL)
        }
        for _ in 0..<100 where shutdownRaceProcess.isRunning {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        shutdownRaceTermination?.resume(returning: true)
        shutdownRaceTermination = nil
        try await permanentShutdown.value
        _ = try? await shutdownWaitingRequest.value
        do {
            _ = try await shutdownRaceClient.getStatus()
            throw SmokeError.failed("post-shutdown replacement")
        } catch SmokeError.failed(let label)
            where label == "post-shutdown replacement" {
            throw SmokeError.failed(label)
        } catch {
            try expect(
                error as? LauncherAgentError == .disconnected,
                "permanent shutdown gate rejects future requests"
            )
        }
        try expect(
            shutdownRaceLaunchCount == 1,
            "shutdown epoch blocks every waiting replacement launch"
        )

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
        let validAttentionProjection = try JSONDecoder().decode(
            LauncherAttentionProjection.self,
            from: validProjection
        )
        var unsafeFallbackRefreshes: [Bool] = []
        let unsafeFallback = try await LauncherPreferredProjectionLoader.load(
            refresh: true,
            getWorkBoard: { _ in
                throw LauncherAgentError.agent(
                    code: "INVALID_REQUEST",
                    message: "/Users/private/work"
                )
            },
            getAttention: { refresh in
                unsafeFallbackRefreshes.append(refresh)
                return validAttentionProjection
            }
        )
        guard case .attention = unsafeFallback else {
            throw SmokeError.failed("unsafe compatible fallback")
        }
        try expect(
            unsafeFallbackRefreshes == [true] &&
                LauncherAgentError.agent(
                    code: "INVALID_REQUEST",
                    message: "/Users/private/work"
                ).errorDescription ==
                    "Local Agent 요청을 처리하지 못했습니다.",
            "unsafe compatible error falls back once without raw display"
        )
        var degradedRefreshes: [Bool] = []
        let degraded = try await LauncherPreferredProjectionLoader.load(
            refresh: true,
            getWorkBoard: { _ in
                throw LauncherAgentError.agent(
                    code: "WORK_BOARD_RUN_FAILED",
                    message: "bounded"
                )
            },
            getAttention: { refresh in
                degradedRefreshes.append(refresh)
                return validAttentionProjection
            }
        )
        guard case .degradedAttention = degraded else {
            throw SmokeError.failed("degraded Attention fallback")
        }
        try expect(
            degradedRefreshes == [false] &&
                LauncherWorkBoardPresentation.degradedAttentionText ==
                    "Work Board를 불러오지 못해 기존 Attention을 표시합니다",
            "bounded degraded Attention fallback"
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
                "BLABASE_LAUNCHER_WORK_BOARD_ENABLED": "true",
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
            childEnvironment["BLABASE_LAUNCHER_WORK_BOARD_ENABLED"] == "true",
            "Work Board rollout flag retention"
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

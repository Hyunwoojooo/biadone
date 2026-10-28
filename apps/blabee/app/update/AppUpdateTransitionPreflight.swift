import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation

/// Explicit normal-shutdown consent is different from proving that an agent's
/// task completed. The disconnected path never completes or replays that task.
enum AppUpdateConnectionPolicy: Equatable, Sendable {
    case preserve
    case userConfirmedSessionClosure
}

enum AppUpdateTransitionError: Error, Equatable, LocalizedError {
    case waiting(String), reconnect(String), serviceUnavailable, unverified
    var errorDescription: String? {
        switch self {
        case .waiting(let reason), .reconnect(let reason): reason
        case .serviceUnavailable:
            PetL10n.text("Waiting for Blabee's service to respond. If this continues, check the connection settings before retrying the update.", korean: "Blabee 서비스의 응답을 기다립니다. 계속 응답이 없으면 연결 설정을 확인한 뒤 업데이트를 다시 시도해 주세요.")
        case .unverified:
            PetL10n.text("Unable to verify active Blabee connections. The update is postponed; your conversations are kept open.", korean: "사용 중인 Blabee 연결을 확인하지 못해 업데이트 적용을 보류합니다. 대화는 그대로 유지됩니다.")
        }
    }
}

struct AppUpdateServiceReadiness: Decodable, Equatable, Sendable {
    let schemaVersion: String
    let kind: String
    let ready: Bool
    let pendingApprovals: Int
    let pendingDeliveries: Int
    let pendingCards: Int
    let pendingQueuedActions: Int
    let pendingReconciliation: Int
    let pendingClaimResponses: Int
    let pendingPromptContexts: Int
    let servicePID: Int32
    let serviceParentPID: Int32

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version", kind, ready
        case pendingApprovals = "pending_approvals", pendingDeliveries = "pending_deliveries"
        case pendingCards = "pending_cards", pendingQueuedActions = "pending_queued_actions"
        case pendingReconciliation = "pending_reconciliation", pendingClaimResponses = "pending_claim_responses"
        case pendingPromptContexts = "pending_prompt_contexts"
        case servicePID = "service_pid", serviceParentPID = "service_parent_pid"
    }

    static func parse(_ data: Data) throws -> Self {
        let value = try JSONDecoder().decode(Self.self, from: data)
        let counts = [value.pendingApprovals, value.pendingDeliveries, value.pendingCards,
                      value.pendingQueuedActions, value.pendingReconciliation, value.pendingClaimResponses,
                      value.pendingPromptContexts]
        guard value.schemaVersion == "1.0", value.kind == "blabee_update_status",
              value.servicePID > 0, value.serviceParentPID > 0,
              counts.allSatisfy({ (0...100_000).contains($0) }),
              value.ready == counts.allSatisfy({ $0 == 0 })
        else { throw AppUpdateTransitionError.unverified }
        return value
    }

    func requireReady(policy: AppUpdateConnectionPolicy = .preserve) throws {
        guard ready else {
            if pendingApprovals > 0 || pendingDeliveries > 0 {
                throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "Finish the pending approval and its delivery before updating.",
                    korean: "대기 중인 승인과 응답 전달이 끝난 뒤 업데이트합니다."))
            }
            if pendingQueuedActions > 0 || pendingClaimResponses > 0 {
                throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "Waiting for the selected task to reach its conversation. It will not be sent again automatically.",
                    korean: "선택한 작업이 대화에 전달되기를 기다립니다. 작업을 자동으로 다시 보내지 않습니다."))
            }
            if pendingPromptContexts > 0, policy == .preserve {
                throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "Waiting for the current Codex task to finish. If that conversation was interrupted, reconnect Blabee before retrying.",
                    korean: "진행 중인 Codex 작업이 끝나기를 기다립니다. 대화가 중단된 상태라면 Blabee를 다시 연결한 뒤 재시도해 주세요."))
            }
            if pendingCards > 0 || pendingReconciliation > 0 {
                throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "Finish or skip the pending Blabee choices before updating. Closing the panel alone does not finish them.",
                    korean: "Blabee에 남은 선택을 처리하거나 건너뛴 뒤 업데이트합니다. 패널을 닫는 것만으로는 처리되지 않습니다."))
            }
            // UserPromptSubmit/Stop bookkeeping is volatile and does not prove
            // that a native Codex host is still alive. Only the separate,
            // explicitly confirmed normal-shutdown flow may leave it behind.
            // The caller also requires clear bridge/Claude/legacy use; the
            // helper repeats this under exclusive admission before shutdown.
            guard policy == .userConfirmedSessionClosure else {
                throw AppUpdateTransitionError.unverified
            }
            return
        }
    }
}

/// Shared by the downloaded updater and DMG installation. Observations alone
/// are not a reservation: repeat UNDER AppUpdateAdmissionGate before shutdown.
enum AppUpdateTransitionPreflight {
    static func isTransient(_ error: Error) -> Bool {
        if error as? AppUpdateAdmissionError == .busy { return true }
        if case .waiting = error as? AppUpdateTransitionError { return true }
        if error as? AppUpdateTransitionError == .serviceUnavailable { return true }
        return false
    }

    /// Keep transport outages separate from malformed or unbound responses.
    /// In particular, invalid identity/schema must never become an endless
    /// request to close sessions in the interactive window.
    static func serviceReadiness(request: () throws -> [String: Any]) throws -> AppUpdateServiceReadiness {
        let response: [String: Any]
        do { response = try request() }
        catch let error as CoordinatorError where [
            "operational_connect_failed", "operational_connect_timeout", "operational_connect_refused",
            "operational_socket_unavailable",
            "operational_response_timeout", "operational_transport_closed", "operational_transport_failed",
        ].contains(error.code) {
            throw AppUpdateTransitionError.serviceUnavailable
        }
        catch { throw AppUpdateTransitionError.unverified }
        do { return try .parse(StrictJSONTransport.data(forJSONObject: response)) }
        catch { throw AppUpdateTransitionError.unverified }
    }

    static func requireReady(candidateApplicationURL: URL,
                             policy: AppUpdateConnectionPolicy = .preserve) async throws {
        try await Task.detached(priority: .utility) {
            try requireReadySynchronously(candidateApplicationURL: candidateApplicationURL, policy: policy)
        }.value
    }

    static func requireRuntimeConnections(
        candidate: OperationalRuntimeIdentitySnapshot, activeIdentities: Set<String>,
        policy: AppUpdateConnectionPolicy
    ) throws {
        if policy == .userConfirmedSessionClosure {
            guard activeIdentities.isEmpty else {
                throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "A Blabee connection is still open. Save your work and close the connected Codex and Claude sessions normally. This window will check again automatically.",
                    korean: "Blabee 연결이 아직 열려 있습니다. 작업을 저장하고 연결된 Codex·Claude 세션을 정상 종료해 주세요. 이 창에서 자동으로 다시 확인합니다."))
            }
        } else {
            try requireCompatibleRuntimes(candidate: candidate, activeIdentities: activeIdentities)
        }
    }

    static func requireCompatibleRuntimes(
        candidate: OperationalRuntimeIdentitySnapshot, activeIdentities: Set<String>
    ) throws {
        // Long-lived MCP uses only these four contracts. Approval is always
        // handled by fresh installed Hook clients, never by an allowlisted old client.
        let required: Set<String> = ["emit_decision", "session_start", "stop", "user_prompt_submit"]
        for identity in activeIdentities where identity != candidate.runtimeIdentity {
            guard let allowed = candidate.allowedRequestTypes(forCompatibleIdentity: identity),
                  required.isSubset(of: allowed) else {
                throw AppUpdateTransitionError.reconnect(PetL10n.text(
                    "An older Blabee connection is not compatible with this update. Reconnect that Codex connection, then retry. Conversations will not be closed automatically.",
                    korean: "이 업데이트와 호환되지 않는 이전 Blabee 연결이 있습니다. 해당 Codex 연결을 다시 연결한 뒤 재시도해 주세요. 대화를 자동 종료하지 않습니다."))
            }
        }
    }

    static func requireClaudeReady(_ inspection: ClaudeRuntimePayloadUse.UpdateInspection) throws {
        switch inspection.status {
        case .clear:
            guard inspection.outstandingUseCount == 0 else { throw AppUpdateTransitionError.unverified }
        case .inUse:
            throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "Claude still has an unreleased Blabee connection. Save your work and close the connected Claude session normally. If it has already closed, use Prepare Connection Recovery, then restart your Mac and retry.",
                    korean: "Claude의 Blabee 연결이 아직 종료되지 않았습니다. 작업을 저장하고 연결된 Claude 세션을 정상 종료해 주세요. 이미 종료했다면 ‘연결 복구 준비’를 누른 뒤 Mac을 재시작하고 다시 시도해 주세요."))
        case .unavailable: throw AppUpdateTransitionError.unverified
        }
    }

    /// Update preparation may remove only evidence proved to belong to an
    /// earlier kernel boot. Inspection itself remains read-only. Re-enumerate
    /// after recovery so a newly registered use still blocks replacement.
    static func recoverAndRequireClaudeReady(
        recover: () throws -> Int = { try ClaudeRuntimePayloadUse.recoverAfterRestart() },
        inspect: () -> ClaudeRuntimePayloadUse.UpdateInspection = { ClaudeRuntimePayloadUse.inspectForUpdate() }
    ) throws {
        do { _ = try recover() }
        catch { throw AppUpdateTransitionError.unverified }
        try requireClaudeReady(inspect())
    }

    static func requireReadySynchronously(candidateApplicationURL: URL,
                                         policy: AppUpdateConnectionPolicy = .preserve) throws {
        let candidateExecutable = candidateApplicationURL.appendingPathComponent(AppRuntimeUseLease.executablePath)
        guard let candidate = OperationalRuntimeIdentity.installedSnapshot(forExecutable: candidateExecutable) else {
            throw AppUpdateTransitionError.unverified
        }
        try recoverAndRequireClaudeReady()
        do {
            try requireRuntimeConnections(candidate: candidate,
                activeIdentities: AppBridgeRuntimeStore.activeRuntimeIdentities(), policy: policy)
        } catch let error as AppUpdateTransitionError { throw error }
        catch let error as CoordinatorError where error.code == "app_bridge_runtime_store_busy" {
            throw AppUpdateTransitionError.waiting(PetL10n.text(
                "Waiting for a Blabee connection to finish starting.",
                korean: "Blabee 연결 시작이 끝나기를 기다립니다."))
        }
        catch let error as CoordinatorError where error.code == "app_bridge_runtime_staging_unverified" {
            throw AppUpdateTransitionError.reconnect(PetL10n.text(
                "An unfinished connection runtime needs inspection. The files are preserved; contact support if retrying does not resolve this.",
                korean: "완료되지 않은 연결 실행 사본의 확인이 필요합니다. 파일은 보존했습니다. 재시도 후에도 계속되면 지원팀에 문의해 주세요."))
        }
        catch { throw AppUpdateTransitionError.unverified }
        // Legacy managed supervisors also run copied apps, but their approval
        // protocol is not in the old-MCP allowlist. Keeping them open must not
        // silently turn into broken approvals or an automatic stop/resume.
        let registry = UpdateManagedCodexRegistry()
        if FileManager.default.fileExists(atPath: registry.directoryURL.path) {
            for record in try registry.records() {
                if try UpdateManagedCodexProcessIdentity.isAlive(pid: record.hostPID, startTime: record.hostStartTime) {
                    if policy == .userConfirmedSessionClosure {
                        throw AppUpdateTransitionError.waiting(PetL10n.text(
                            "A managed Codex session is still open. Save your work and close it normally. The update will continue after its connection closes.",
                            korean: "Codex 관리 세션이 아직 열려 있습니다. 작업을 저장하고 정상 종료해 주세요. 연결이 닫히면 업데이트가 이어집니다."))
                    }
                    throw AppUpdateTransitionError.reconnect(PetL10n.text(
                        "A legacy managed Codex connection requires a normal disconnect before this update. Save it and close that connection, then retry.",
                        korean: "이전 자동 복원 방식의 Codex 연결은 이번 업데이트 전에 정상 종료가 필요합니다. 작업을 저장하고 해당 연결을 종료한 뒤 재시도해 주세요."))
                }
            }
        }

        let installed = AppInstallationService.productionDestinationURL.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let reader = AppInstallationProcessReader.live
        var permitted = Set<Int32>()
        let socketPath = OperationalSocketPath.defaultPath(homeDirectory: FileManager.default.homeDirectoryForCurrentUser)
        var socketInfo = stat()
        if lstat(socketPath, &socketInfo) == 0 {
            guard let identity = OperationalRuntimeIdentity.installedIdentity(forExecutable: installed) else {
                throw AppUpdateTransitionError.unverified
            }
            let status = try serviceReadiness {
                let client = try UnixDomainSocketClient(socketPath: socketPath, runtimeIdentity: identity)
                return try client.request(type: "update_status", payload: [:],
                    connectTimeoutMilliseconds: 500, responseTimeoutMilliseconds: 2_000)
            }
            try status.requireReady(policy: policy)
            guard case .running(let service) = reader.state(status.servicePID),
                  service.effectiveUserID == geteuid(), service.parentProcessID == status.serviceParentPID,
                  AppUpdateHelper.runningIdentity(status.servicePID, executable: installed) == identity,
                  AppUpdateHelper.runningIdentity(status.serviceParentPID, executable: installed) == identity
            else { throw AppUpdateTransitionError.unverified }
            permitted = [status.servicePID, status.serviceParentPID]
        } else if errno != ENOENT { throw AppUpdateTransitionError.unverified }

        // The invoking installed GUI may be before service startup/after its
        // normal shutdown. This exemption cannot authorize file replacement;
        // installation still needs EX ownership of its executable inode.
        if let identity = OperationalRuntimeIdentity.installedIdentity(forExecutable: installed),
           AppUpdateHelper.runningIdentity(getpid(), executable: installed) == identity {
            permitted.insert(getpid())
        }
        for pid in try reader.processIDs() where pid > 0 && !permitted.contains(pid) {
            guard case .running(let token) = reader.state(pid), token.effectiveUserID == geteuid() else { continue }
            if case .running(let executable) = reader.observe(pid),
               executable.path == installed.path || executable.path.hasPrefix(AppInstallationService.productionDestinationURL.path + "/") {
                throw AppUpdateTransitionError.waiting(PetL10n.text(
                    "A connection still uses the installed Blabee files (process \(pid)). Let its current request finish; older connections may need one normal disconnect before retrying.",
                    korean: "설치된 Blabee 파일을 사용하는 연결이 남아 있습니다(프로세스 \(pid)). 요청이 끝나기를 기다리거나 이전 연결을 한 번 정상 종료한 뒤 재시도해 주세요."))
            }
        }
    }
}

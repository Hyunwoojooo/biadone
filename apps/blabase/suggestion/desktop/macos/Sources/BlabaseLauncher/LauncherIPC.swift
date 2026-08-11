import Foundation

enum LauncherIPC {
    static let contract = "blabase-launcher-ipc-v1"
    static let maximumLineBytes = 64 * 1024

    static func requestID(uuid: UUID = UUID()) -> String {
        "request-\(uuid.uuidString.lowercased())"
    }
}

struct AttentionGetParameters: Encodable, Sendable {
    let refresh: Bool
}

struct AttentionExecuteParameters: Encodable, Sendable {
    let resultId: String
    let candidateId: String
    let explicitUserAction = true
}

struct CommandGetParameters: Encodable, Sendable {
    let commandId: String
}

struct StatusGetParameters: Encodable, Sendable {}

enum LauncherAgentMutationAuthority: String, Decodable, Equatable, Sendable {
    case launcherAgent = "launcher_agent"
    case none
}

struct LauncherAgentStatus: Decodable, Equatable, Sendable {
    static let contract = "blabase-launcher-status-v1"

    let rootId: String?
    let sourceMode: LauncherSourceMode
    let mutationAuthority: LauncherAgentMutationAuthority
    let syncRevision: String?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case contract
        case rootId
        case sourceMode
        case mutationAuthority
        case syncRevision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let dynamicContainer = try decoder.container(
            keyedBy: LauncherDynamicCodingKey.self
        )
        guard
            Set(dynamicContainer.allKeys.map(\.stringValue)) ==
                Set(CodingKeys.allCases.map(\.rawValue))
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription: "Launcher status fields do not match v1."
            )
        }
        let decodedContract = try container.decode(
            String.self,
            forKey: .contract
        )
        guard decodedContract == Self.contract else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription: "Unsupported launcher status contract."
            )
        }
        rootId = try container.decodeIfPresent(String.self, forKey: .rootId)
        sourceMode = try container.decode(
            LauncherSourceMode.self,
            forKey: .sourceMode
        )
        mutationAuthority = try container.decode(
            LauncherAgentMutationAuthority.self,
            forKey: .mutationAuthority
        )
        syncRevision = try container.decodeIfPresent(
            String.self,
            forKey: .syncRevision
        )
        if let rootId, !LauncherRootIdentity.isCanonical(rootId) {
            throw DecodingError.dataCorruptedError(
                forKey: .rootId,
                in: container,
                debugDescription: "Invalid launcher root identity."
            )
        }
        if let syncRevision,
           !LauncherRootIdentity.isCanonicalSyncRevision(syncRevision) {
            throw DecodingError.dataCorruptedError(
                forKey: .syncRevision,
                in: container,
                debugDescription: "Invalid launcher sync revision."
            )
        }
        switch sourceMode {
        case .managed:
            guard mutationAuthority == .launcherAgent, rootId != nil else {
                throw DecodingError.dataCorruptedError(
                    forKey: .mutationAuthority,
                    in: container,
                    debugDescription: "Managed launcher authority is invalid."
                )
            }
        case .readOnly:
            guard mutationAuthority == .none else {
                throw DecodingError.dataCorruptedError(
                    forKey: .mutationAuthority,
                    in: container,
                    debugDescription: "Read-only launcher authority is invalid."
                )
            }
        }
    }
}

enum DashboardMutationAuthority: String, Decodable, Equatable, Sendable {
    case dashboard
}

struct DashboardRootContext: Decodable, Equatable, Sendable {
    static let contract = "blabase-root-context-v1"

    let rootId: String
    let mutationAuthority: DashboardMutationAuthority
    let syncRevision: String?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case contract
        case rootId
        case mutationAuthority
        case syncRevision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let dynamicContainer = try decoder.container(
            keyedBy: LauncherDynamicCodingKey.self
        )
        guard
            Set(dynamicContainer.allKeys.map(\.stringValue)) ==
                Set(CodingKeys.allCases.map(\.rawValue))
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription:
                    "Dashboard root context fields do not match v1."
            )
        }
        let decodedContract = try container.decode(
            String.self,
            forKey: .contract
        )
        guard decodedContract == Self.contract else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription: "Unsupported dashboard root context contract."
            )
        }
        rootId = try container.decode(String.self, forKey: .rootId)
        mutationAuthority = try container.decode(
            DashboardMutationAuthority.self,
            forKey: .mutationAuthority
        )
        syncRevision = try container.decodeIfPresent(
            String.self,
            forKey: .syncRevision
        )
        guard LauncherRootIdentity.isCanonical(rootId) else {
            throw DecodingError.dataCorruptedError(
                forKey: .rootId,
                in: container,
                debugDescription: "Invalid dashboard root identity."
            )
        }
        if let syncRevision,
           !LauncherRootIdentity.isCanonicalSyncRevision(syncRevision) {
            throw DecodingError.dataCorruptedError(
                forKey: .syncRevision,
                in: container,
                debugDescription: "Invalid dashboard sync revision."
            )
        }
    }
}

enum LauncherSourceNavigationBlockReason: Equatable, Sendable {
    case readOnlyRootRequired
    case rootMismatch
    case syncRevisionMismatch
}

enum LauncherSourceNavigationDecision: Equatable, Sendable {
    case allowed
    case blocked(LauncherSourceNavigationBlockReason)
}

enum LauncherSourceNavigationPolicy {
    static func evaluate(
        agentStatus: LauncherAgentStatus,
        dashboardContext: DashboardRootContext
    ) -> LauncherSourceNavigationDecision {
        guard
            agentStatus.sourceMode == .readOnly,
            agentStatus.mutationAuthority == .none,
            let agentRootId = agentStatus.rootId
        else {
            return .blocked(.readOnlyRootRequired)
        }
        guard
            dashboardContext.mutationAuthority == .dashboard,
            agentRootId == dashboardContext.rootId
        else {
            return .blocked(.rootMismatch)
        }
        guard agentStatus.syncRevision == dashboardContext.syncRevision else {
            return .blocked(.syncRevisionMismatch)
        }
        return .allowed
    }

    static func allowsSourceNavigation(
        agentStatus: LauncherAgentStatus,
        dashboardContext: DashboardRootContext
    ) -> Bool {
        evaluate(
            agentStatus: agentStatus,
            dashboardContext: dashboardContext
        ) == .allowed
    }
}

@MainActor
enum LauncherSourceNavigationHandshake {
    static func evaluate(
        getAgentStatus: () async throws -> LauncherAgentStatus,
        getDashboardContext: () async throws -> DashboardRootContext
    ) async throws -> LauncherSourceNavigationDecision {
        let initialAgentStatus = try await getAgentStatus()
        guard
            initialAgentStatus.sourceMode == .readOnly,
            initialAgentStatus.mutationAuthority == .none
        else {
            return .blocked(.readOnlyRootRequired)
        }

        // The dashboard is the authority that publishes a missing root marker
        // for an existing read-only store. Always re-read the agent afterwards.
        let dashboardContext = try await getDashboardContext()
        let refreshedAgentStatus = try await getAgentStatus()
        return LauncherSourceNavigationPolicy.evaluate(
            agentStatus: refreshedAgentStatus,
            dashboardContext: dashboardContext
        )
    }
}

private enum LauncherRootIdentity {
    static func isCanonical(_ value: String) -> Bool {
        guard value.utf8.count == 37 else { return false }
        return value.range(
            of: #"^root_[a-f0-9]{32}$"#,
            options: .regularExpression
        ) == (value.startIndex..<value.endIndex)
    }

    static func isCanonicalSyncRevision(_ value: String) -> Bool {
        guard (1...128).contains(value.utf8.count) else { return false }
        return value.range(
            of: #"^[A-Za-z0-9][A-Za-z0-9._:-]*$"#,
            options: .regularExpression
        ) == (value.startIndex..<value.endIndex)
    }
}

private struct LauncherDynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

struct LauncherIPCRequest<Parameters: Encodable>: Encodable {
    let contract = LauncherIPC.contract
    let requestId: String
    let method: String
    let params: Parameters
}

struct LauncherIPCErrorPayload: Decodable, Error, Equatable, Sendable {
    let code: String
    let message: String
}

struct LauncherIPCResponseEnvelope: Decodable, Sendable {
    let contract: String
    let requestId: String?
    let ok: Bool
    let error: LauncherIPCErrorPayload?

    private enum CodingKeys: String, CodingKey {
        case contract
        case requestId
        case ok
        case error
    }
}

enum LauncherAgentError: LocalizedError, Equatable, Sendable {
    case runtimeUnavailable
    case invalidRuntime(String)
    case launchFailed
    case disconnected
    case requestTimedOut
    case invalidResponse
    case responseTooLarge
    case agent(code: String, message: String)

    var errorDescription: String? {
        switch self {
        case .runtimeUnavailable:
            "Blabase Local Agent를 찾지 못했습니다. 앱을 다시 설치해주세요."
        case .invalidRuntime:
            "Blabase Local Agent 구성이 올바르지 않습니다."
        case .launchFailed:
            "Blabase Local Agent를 시작하지 못했습니다."
        case .disconnected:
            "Blabase Local Agent 연결이 종료되었습니다."
        case .requestTimedOut:
            "작업 제안 응답 시간이 초과되었습니다."
        case .invalidResponse:
            "Blabase Local Agent 응답 형식을 확인할 수 없습니다."
        case .responseTooLarge:
            "Blabase Local Agent 응답 크기 제한을 초과했습니다."
        case .agent(_, let message):
            message
        }
    }
}

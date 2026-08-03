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

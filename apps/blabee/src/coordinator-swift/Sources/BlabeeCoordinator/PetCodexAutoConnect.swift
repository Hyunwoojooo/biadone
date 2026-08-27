import BlabeeProductSupport
import CoordinatorSwift
import Dispatch
import Foundation

extension CodexAutoConnectState {
    var displayTitle: String {
        switch self {
        case .disabled:
            "연결 안 됨"
        case .enabled:
            "연결 설정됨"
        case .repairRequired:
            "다시 연결 필요"
        case .conflict:
            "설정 충돌"
        case .unavailable:
            "사용할 수 없음"
        }
    }

    var displayDescription: String {
        switch self {
        case .disabled:
            "새 터미널에서 평소처럼 codex를 실행해도 아직 Blabee를 거치지 않습니다."
        case .enabled:
            "새 터미널에서 기존 codex alias나 함수와 충돌하지 않으면 codex와 codex resume이 Blabee를 거칩니다."
        case .repairRequired(let reason):
            reason
        case .conflict(let reason):
            reason
        case .unavailable(let reason):
            reason
        }
    }
}

@MainActor
protocol PetCodexAutoConnectAdapting: AnyObject {
    var canEnable: Bool { get }
    func state() -> CodexAutoConnectState
    func enable() async throws
    func disable() async throws
}

/// Serializes the small shell-integration mutations away from MainActor. The
/// underlying manager uses bounded file IO and `flock`, so even legitimate lock
/// contention must never freeze Pet rendering or input handling.
final class PetCodexAutoConnectMutationWorker: @unchecked Sendable {
    private let queue = DispatchQueue(
        label: "com.biadone.blabee.pet.codex-auto-connect-mutations",
        qos: .userInitiated
    )
    private let enableOperation: @Sendable () throws -> Void
    private let disableOperation: @Sendable () throws -> Void

    init(manager: CodexAutoConnectManager) {
        enableOperation = { try manager.enable() }
        disableOperation = { try manager.disable() }
    }

    init(
        enableOperation: @escaping @Sendable () throws -> Void,
        disableOperation: @escaping @Sendable () throws -> Void
    ) {
        self.enableOperation = enableOperation
        self.disableOperation = disableOperation
    }

    func enable() async throws {
        try await perform(enableOperation)
    }

    func disable() async throws {
        try await perform(disableOperation)
    }

    private func perform(
        _ operation: @escaping @Sendable () throws -> Void
    ) async throws {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    try operation()
                    continuation.resume(returning: ())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

@MainActor
final class PetLiveCodexAutoConnectAdapter: PetCodexAutoConnectAdapting {
    private let manager: CodexAutoConnectManager
    private let mutationWorker: PetCodexAutoConnectMutationWorker

    init() throws {
        guard ProductInvocationResolver.isExpectedAppBundle(
            ProductInvocationEnvironment.live()
        ) else {
            throw CoordinatorError(
                "pet_codex_auto_connect_unavailable",
                "Codex 자동 연결은 정확한 Blabee 앱 번들에서만 사용할 수 있습니다."
            )
        }
        let manager = try CodexAutoConnectManager.live()
        self.manager = manager
        mutationWorker = PetCodexAutoConnectMutationWorker(manager: manager)
    }

    init(manager: CodexAutoConnectManager) {
        self.manager = manager
        mutationWorker = PetCodexAutoConnectMutationWorker(manager: manager)
    }

    var canEnable: Bool { manager.canEnable }

    func state() -> CodexAutoConnectState {
        manager.state()
    }

    func enable() async throws {
        try await mutationWorker.enable()
    }

    func disable() async throws {
        try await mutationWorker.disable()
    }
}

@MainActor
final class PetUnavailableCodexAutoConnectAdapter: PetCodexAutoConnectAdapting {
    private let reason: String

    init(reason: String = "제품 앱 환경에서만 Codex 자동 연결을 설정할 수 있습니다.") {
        self.reason = reason
    }

    var canEnable: Bool { false }

    func state() -> CodexAutoConnectState {
        .unavailable(reason)
    }

    func enable() async throws {
        throw CoordinatorError("pet_codex_auto_connect_unavailable", reason)
    }

    func disable() async throws {
        throw CoordinatorError("pet_codex_auto_connect_unavailable", reason)
    }
}

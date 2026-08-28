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
    var snapshot: PetCodexAutoConnectSnapshot { get }
    func refresh() async
    func enable() async throws
    func disable() async throws
}

struct PetCodexAutoConnectSnapshot: Sendable, Equatable {
    let state: CodexAutoConnectState
    let canEnable: Bool

    static func unavailable(_ reason: String) -> Self {
        Self(state: .unavailable(reason), canEnable: false)
    }

    fileprivate init(manager: CodexAutoConnectManager) {
        let inspection = manager.inspection()
        state = inspection.state
        canEnable = inspection.canEnable
    }

    init(state: CodexAutoConnectState, canEnable: Bool) {
        self.state = state
        self.canEnable = canEnable
    }
}

struct PetCodexAutoConnectMutationOutcome: Sendable, Equatable {
    let snapshot: PetCodexAutoConnectSnapshot
    let errorDescription: String?
}

/// Serializes discovery, inspection, and shell-integration mutations away from
/// MainActor. The underlying manager uses bounded file IO and `flock`, so even
/// legitimate lock contention must never freeze Pet rendering or input handling.
final class PetCodexAutoConnectMutationWorker: @unchecked Sendable {
    private let queue = DispatchQueue(
        label: "com.biadone.blabee.pet.codex-auto-connect-mutations",
        qos: .userInitiated
    )
    private let refreshOperation: @Sendable () -> PetCodexAutoConnectSnapshot
    private let enableOperation: @Sendable () -> PetCodexAutoConnectMutationOutcome
    private let disableOperation: @Sendable () -> PetCodexAutoConnectMutationOutcome

    init(
        managerFactory: @escaping @Sendable () throws -> CodexAutoConnectManager
    ) {
        refreshOperation = {
            do {
                return PetCodexAutoConnectSnapshot(manager: try managerFactory())
            } catch {
                return .unavailable(String(describing: error))
            }
        }
        enableOperation = {
            Self.mutate(managerFactory: managerFactory) { manager in
                try manager.enable()
            }
        }
        disableOperation = {
            Self.mutate(managerFactory: managerFactory) { manager in
                try manager.disable()
            }
        }
    }

    init(
        refreshOperation: @escaping @Sendable () -> PetCodexAutoConnectSnapshot,
        enableOperation: @escaping @Sendable () -> PetCodexAutoConnectMutationOutcome,
        disableOperation: @escaping @Sendable () -> PetCodexAutoConnectMutationOutcome
    ) {
        self.refreshOperation = refreshOperation
        self.enableOperation = enableOperation
        self.disableOperation = disableOperation
    }

    func refresh() async -> PetCodexAutoConnectSnapshot {
        await perform(refreshOperation)
    }

    func enable() async -> PetCodexAutoConnectMutationOutcome {
        await perform(enableOperation)
    }

    func disable() async -> PetCodexAutoConnectMutationOutcome {
        await perform(disableOperation)
    }

    private func perform<Result: Sendable>(
        _ operation: @escaping @Sendable () -> Result
    ) async -> Result {
        await withCheckedContinuation { continuation in
            queue.async {
                continuation.resume(returning: operation())
            }
        }
    }

    private static func mutate(
        managerFactory: @Sendable () throws -> CodexAutoConnectManager,
        operation: @Sendable (CodexAutoConnectManager) throws -> Void
    ) -> PetCodexAutoConnectMutationOutcome {
        do {
            let manager = try managerFactory()
            let operationError: Error?
            do {
                try operation(manager)
                operationError = nil
            } catch {
                operationError = error
            }

            // Discovery and compatibility can change while the mutation is
            // running. Never derive the UI result from the stale manager that
            // authorized the operation; rebuild after both success and failure.
            do {
                let snapshot = PetCodexAutoConnectSnapshot(manager: try managerFactory())
                return PetCodexAutoConnectMutationOutcome(
                    snapshot: snapshot,
                    errorDescription: operationError.map { String(describing: $0) }
                )
            } catch {
                let refreshDescription = String(describing: error)
                return PetCodexAutoConnectMutationOutcome(
                    snapshot: .unavailable(refreshDescription),
                    errorDescription: operationError.map { String(describing: $0) }
                        ?? refreshDescription
                )
            }
        } catch {
            let description = String(describing: error)
            return PetCodexAutoConnectMutationOutcome(
                snapshot: .unavailable(description),
                errorDescription: description
            )
        }
    }
}

@MainActor
final class PetLiveCodexAutoConnectAdapter: PetCodexAutoConnectAdapting {
    private let mutationWorker: PetCodexAutoConnectMutationWorker
    private(set) var snapshot = PetCodexAutoConnectSnapshot.unavailable(
        "상태를 새로고침하지 않았습니다."
    )

    init() throws {
        guard ProductInvocationResolver.isExpectedAppBundle(
            ProductInvocationEnvironment.live()
        ) else {
            throw CoordinatorError(
                "pet_codex_auto_connect_unavailable",
                "Codex 자동 연결은 정확한 Blabee 앱 번들에서만 사용할 수 있습니다."
            )
        }
        mutationWorker = PetCodexAutoConnectMutationWorker {
            try CodexAutoConnectManager.live()
        }
    }

    init(
        managerFactory: @escaping @Sendable () throws -> CodexAutoConnectManager
    ) {
        mutationWorker = PetCodexAutoConnectMutationWorker(
            managerFactory: managerFactory
        )
    }

    func refresh() async {
        snapshot = await mutationWorker.refresh()
    }

    func enable() async throws {
        let outcome = await mutationWorker.enable()
        snapshot = outcome.snapshot
        if let errorDescription = outcome.errorDescription {
            throw CoordinatorError(
                "pet_codex_auto_connect_enable_failed",
                errorDescription
            )
        }
    }

    func disable() async throws {
        let outcome = await mutationWorker.disable()
        snapshot = outcome.snapshot
        if let errorDescription = outcome.errorDescription {
            throw CoordinatorError(
                "pet_codex_auto_connect_disable_failed",
                errorDescription
            )
        }
    }
}

@MainActor
final class PetUnavailableCodexAutoConnectAdapter: PetCodexAutoConnectAdapting {
    private let reason: String
    let snapshot: PetCodexAutoConnectSnapshot

    init(reason: String = "제품 앱 환경에서만 Codex 자동 연결을 설정할 수 있습니다.") {
        self.reason = reason
        snapshot = .unavailable(reason)
    }

    func refresh() async {}

    func enable() async throws {
        throw CoordinatorError("pet_codex_auto_connect_unavailable", reason)
    }

    func disable() async throws {
        throw CoordinatorError("pet_codex_auto_connect_unavailable", reason)
    }
}

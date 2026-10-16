import BlabeeProductSupport
import CoordinatorSwift
import Foundation

extension CoordinatorAuthorityLease: StorageRecoveryAuthority {}

struct PetStorageRecoveryConfirmation: Equatable, Sendable {
    let id: UUID
    let backupDirectoryURL: URL
    let residualFileNames: [String]
}

struct PetStorageRecoveryReceipt: Equatable, Sendable {
    let backupDirectoryURL: URL
}

protocol PetStorageRecoveryManaging: Sendable {
    func prepare() async throws -> PetStorageRecoveryConfirmation
    func recover(confirmation: PetStorageRecoveryConfirmation) async throws -> PetStorageRecoveryReceipt
}

struct PetUnavailableStorageRecoveryManager: PetStorageRecoveryManaging {
    func prepare() async throws -> PetStorageRecoveryConfirmation {
        throw CoordinatorError("storage_recovery_unavailable")
    }

    func recover(confirmation: PetStorageRecoveryConfirmation) async throws -> PetStorageRecoveryReceipt {
        throw CoordinatorError("storage_recovery_unavailable")
    }
}

/// An explicit user operation, never a startup repair. The actor retains the
/// opaque engine plan so a forged or replayed UI confirmation cannot reset data.
actor PetStorageRecoveryManager: PetStorageRecoveryManaging {
    private let makeRecovery: @Sendable () throws -> MissingStorageRecovery
    private var pending: (MissingStorageRecovery, MissingStorageRecoveryPlan)?

    init(makeRecovery: @escaping @Sendable () throws -> MissingStorageRecovery) {
        self.makeRecovery = makeRecovery
    }

    static func live(socketPath: String) -> PetStorageRecoveryManager {
        PetStorageRecoveryManager {
            let environment = try ProductServiceEnvironment.live()
            let configuration = try ProductServiceBootstrap.resolve(environment: environment)
            guard ProductInvocationResolver.isStandardInstalledApp(environment.invocation),
                  configuration.socketPath == socketPath,
                  let executable = environment.invocation.executableURL,
                  let installed = OperationalRuntimeIdentity.installedIdentity(forExecutable: executable),
                  installed == (try OperationalRuntimeIdentity.requireCurrent())
            else { throw CoordinatorError("storage_recovery_unavailable") }
            let database = configuration.database
            return MissingStorageRecovery(
                databaseURL: database,
                keyURL: configuration.key,
                backupRootURL: database.deletingLastPathComponent().deletingLastPathComponent()
                    .appendingPathComponent("recovery", isDirectory: true),
                freshnessStore: try KeychainFreshnessAnchorStore(account: BlabeeProductProfile.current.primaryFreshnessAccount),
                acquireAuthority: { try CoordinatorAuthorityLease(databaseURL: database) }
            )
        }
    }

    func prepare() throws -> PetStorageRecoveryConfirmation {
        pending = nil
        let recovery = try makeRecovery()
        let plan = try recovery.prepare()
        pending = (recovery, plan)
        return confirmation(for: plan)
    }

    func recover(confirmation: PetStorageRecoveryConfirmation) throws -> PetStorageRecoveryReceipt {
        guard let (recovery, plan) = pending else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
        pending = nil
        guard confirmation == self.confirmation(for: plan) else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
        let receipt = try recovery.execute(plan)
        return .init(backupDirectoryURL: receipt.backupDirectoryURL)
    }

    private func confirmation(for plan: MissingStorageRecoveryPlan) -> PetStorageRecoveryConfirmation {
        .init(id: plan.recoveryID, backupDirectoryURL: plan.backupDirectoryURL,
              residualFileNames: plan.residualFileNames)
    }
}

enum PetStorageRecoveryMessage {
    static func failure(_ error: any Error) -> String {
        let code = (error as? CoordinatorError)?.code ?? "storage_recovery_failed"
        let detail: String
        switch code {
        case "storage_recovery_not_eligible":
            detail = PetL10n.text("This is not a missing-storage state that can be recovered automatically. Healthy or partially remaining storage will not be changed.", korean: "자동으로 복구할 수 있는 저장소 유실 상태가 아닙니다. 정상 데이터나 일부만 남은 저장소는 변경하지 않습니다.")
        case "storage_recovery_plan_changed":
            detail = PetL10n.text("Storage changed after verification. Check recovery eligibility again.", korean: "확인 후 저장 상태가 달라졌습니다. 복구 가능 여부를 다시 확인해 주세요.")
        case "storage_recovery_busy", "operational_owner_active":
            detail = PetL10n.text("Another \(BlabeeProductProfile.current.displayName) service is using the storage. Close that service normally and check again.", korean: "다른 \(BlabeeProductProfile.current.displayName) 서비스가 저장소를 사용 중입니다. 해당 서비스를 정상 종료한 뒤 다시 확인하세요.")
        case "freshness_anchor_unavailable":
            detail = PetL10n.text("Unable to access Keychain. Check its lock state and access permissions.", korean: "Keychain에 접근할 수 없습니다. 잠금 상태와 접근 허용을 확인해 주세요.")
        case "storage_recovery_unavailable":
            detail = PetL10n.text("Run storage recovery from the installed \(BlabeeProductProfile.current.displayName) app.", korean: "설치된 \(BlabeeProductProfile.current.displayName) 앱에서 저장소 복구를 실행해 주세요.")
        default:
            detail = PetL10n.text("Recovery could not finish. Do not delete preserved files or Keychain items manually. Share the diagnostic code with support.", korean: "복구를 완료하지 못했습니다. 보관한 파일이나 Keychain 항목을 직접 삭제하지 말고 진단 코드를 전달해 주세요.")
        }
        return PetL10n.text("\(detail) diagnostic: \(code)", korean: "\(detail) 진단: \(code)")
    }
}

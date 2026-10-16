import AppKit
import Combine
import CoordinatorSwift
import Darwin
import Foundation
import Security

enum AppUpdateTransactionError: Error, LocalizedError, Equatable {
    case invalidJournal, unsafeJournal, updateBusy, changedSinceReview, sessionsNotReady
    case helperUnverified, helperNotReady, parentDidNotExit, recoveryRequired
    case safePointTimedOut
    case serviceHealthNotConfirmed, serviceHealthIdentityMismatch, serviceHealthResponseInvalid
    case transitionBlocked(String)
    var errorDescription: String? {
        switch self {
        case .invalidJournal: PetL10n.text("Unable to verify the version, session, or task identifiers in the update record.", korean: "업데이트 기록의 버전, 세션 또는 작업 식별자를 확인하지 못했습니다.")
        case .unsafeJournal: PetL10n.text("Unable to verify ownership and permissions for the update record folder.", korean: "업데이트 기록 폴더의 소유권과 접근 권한을 확인하지 못했습니다.")
        case .updateBusy: PetL10n.text("Another update is in progress.", korean: "다른 업데이트 작업이 진행 중입니다.")
        case .changedSinceReview: PetL10n.text("The app or Codex sessions changed after verification. Check for updates again.", korean: "확인 이후 앱이나 Codex 세션이 변경되었습니다. 업데이트를 다시 확인해 주세요.")
        case .sessionsNotReady: PetL10n.text("Some Codex sessions are busy or cannot be verified for restoration. Finish those tasks first.", korean: "작업 중이거나 복원을 확인할 수 없는 Codex 세션이 있습니다. 먼저 작업을 마무리해 주세요.")
        case .helperUnverified: PetL10n.text("Unable to verify the update helper's location or signature.", korean: "업데이트 도우미의 실행 위치 또는 서명을 확인하지 못했습니다.")
        case .helperNotReady: PetL10n.text("The update helper was not ready, so Blabee was not closed.", korean: "업데이트 도우미가 준비되지 않아 Blabee를 종료하지 않았습니다.")
        case .parentDidNotExit: PetL10n.text("The update stopped because Blabee did not exit normally.", korean: "Blabee가 정상 종료되지 않아 업데이트를 중단했습니다.")
        case .recoveryRequired: PetL10n.text("Unable to determine whether the previous update completed. Check the preserved apps and session state first.", korean: "이전 업데이트의 완료 여부를 확인할 수 없습니다. 보존된 앱과 세션 상태를 먼저 확인해 주세요.")
        case .safePointTimedOut: PetL10n.text("The update could not reach a safe restart point within 30 seconds. Your conversations are still running. Finish the pending request, then retry the update.", korean: "30초 안에 안전하게 재시작할 시점을 확인하지 못했습니다. 대화는 계속 실행 중입니다. 대기 중인 요청을 마친 뒤 업데이트를 다시 시도해 주세요.")
        case .serviceHealthNotConfirmed: PetL10n.text("The new app is installed, but its service did not become verifiably available within 30 seconds. Check Blabee's connection settings. Conversations will not be restarted automatically.", korean: "새 앱은 설치됐지만 30초 안에 서비스가 정상 실행됐는지 확인하지 못했습니다. Blabee 연결 설정을 확인해 주세요. 대화를 자동으로 다시 실행하지 않습니다.")
        case .serviceHealthIdentityMismatch: PetL10n.text("The installed app or running service does not match the verified update. The apps have been preserved; check the installation before continuing.", korean: "설치된 앱 또는 실행 중인 서비스가 검증한 업데이트와 일치하지 않습니다. 앱은 보존했으며 설치 상태 확인이 필요합니다.")
        case .serviceHealthResponseInvalid: PetL10n.text("The new app is installed, but its service returned an unverified status response. Check Blabee's connection settings.", korean: "새 앱은 설치됐지만 서비스 상태 응답을 검증하지 못했습니다. Blabee 연결 설정을 확인해 주세요.")
        case .transitionBlocked(let reason): reason
        }
    }
}

struct AppUpdatePreparedReview: Sendable {
    let release: PetAppUpdateRelease
    let currentVersion: PetAppUpdateVersion
    let sessions: [UpdateManagedSession]
    let blockers: [String]
    var canInstall: Bool { blockers.isEmpty }
}

/// All side effects are ordered here. Injection permits failure tests without touching a user session.
@MainActor
struct AppUpdateTransactionEffects {
    var reverify: (AppUpdateJournal) async throws -> Void
    var sessions: () async throws -> [UpdateManagedSession]
    var pause: (UpdateManagedSession, String) async throws -> Void
    var resume: (UpdateManagedSession, String) async throws -> Void
    var install: (AppUpdateJournal) async throws -> AppInstallationReceipt
    var installedIdentity: () -> String?
    var openApp: (String) async throws -> Void
    var save: (AppUpdateJournal) throws -> Void
    // Fixtures inject an inert or controlled check. The live helper explicitly
    // supplies the persistent Claude payload-use inspection below.
    var requireClaudeInactive: () throws -> Void = {}
    var requirePreservedConnectionsReady: (AppUpdateJournal) async throws -> Void = { _ in
        throw AppUpdateTransactionError.changedSinceReview
    }
    var requireLaunchedServiceHealthy: (String) async throws -> Void = { _ in
        throw AppUpdateTransactionError.serviceHealthNotConfirmed
    }
}

@MainActor
struct AppUpdateTransactionEngine {
    let effects: AppUpdateTransactionEffects

    func execute(_ initial: AppUpdateJournal) async -> AppUpdateJournal {
        var journal = initial
        // A crashed pausing/installing/restoring record is deliberately never replayed.
        guard [1, 2].contains(journal.schema),
              !journal.preservesConnections || journal.sessions.isEmpty,
              journal.phase == .waitingForExit,
              journal.sessions.allSatisfy({ $0.step == .pending }) else {
            journal.phase = .recoveryRequired
            journal.detail = AppUpdateTransactionError.recoveryRequired.localizedDescription
            try? persist(&journal)
            return journal
        }
        var installationAttempted = false
        do {
            if !journal.preservesConnections { try effects.requireClaudeInactive() }
            try await effects.reverify(journal)
            guard effects.installedIdentity() == journal.previousIdentity else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            if journal.preservesConnections {
                try await effects.requirePreservedConnectionsReady(journal)
            } else {
                let current = try await effects.sessions()
                try Self.preflight(frozen: journal.sessions.map(\.value), current: current)
            }
            for index in journal.sessions.indices {
                // A clear review is advisory, not a promise that no new
                // Claude owner started while async preflight was suspended.
                try effects.requireClaudeInactive()
                journal.phase = .pausing; journal.sessions[index].step = .pausing
                journal.detail = PetL10n.text("Saving Codex sessions and closing them normally.", korean: "Codex 세션을 저장하고 정상 종료하는 중입니다.")
                try persist(&journal)
                try await effects.pause(journal.sessions[index].value, journal.jobID)
                journal.sessions[index].step = .paused
                try persist(&journal)
            }
            // Reverify again after shutdown; download validation never authorizes a changed candidate.
            try await effects.reverify(journal)
            guard effects.installedIdentity() == journal.previousIdentity else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            if journal.preservesConnections {
                try await effects.requirePreservedConnectionsReady(journal)
            } else { try effects.requireClaudeInactive() }
            journal.phase = .installing; journal.detail = PetL10n.text("Backing up the existing Blabee app and installing the new version.", korean: "기존 Blabee를 백업하고 새 버전을 설치하는 중입니다.")
            try persist(&journal)
            installationAttempted = true
            let receipt = try await effects.install(journal)
            journal.backupURL = receipt.backupURL
            journal.phase = .published; journal.detail = PetL10n.text("The new Blabee app is installed. Checking its launch.", korean: "새 Blabee 설치를 마쳤습니다. 실행을 확인하는 중입니다.")
            try persist(&journal)
            try await effects.openApp(journal.candidateIdentity)
            if journal.preservesConnections {
                journal.detail = PetL10n.text("The new Blabee app opened. Verifying its service connection.", korean: "새 Blabee 앱을 열었습니다. 서비스 연결을 확인하는 중입니다.")
                try persist(&journal)
                try await effects.requireLaunchedServiceHealthy(journal.candidateIdentity)
            }
            await restoreConfirmed(&journal)
            if journal.sessions.allSatisfy({ $0.step == .restored }) {
                journal.phase = .succeeded
                journal.detail = journal.preservesConnections
                    ? PetL10n.text("Blabee was updated. Existing conversations were left running.", korean: "Blabee 업데이트를 완료했습니다. 기존 대화는 종료하지 않았습니다.")
                    : PetL10n.text("Blabee was updated and Codex sessions were restored.", korean: "Blabee 업데이트와 Codex 세션 복원을 완료했습니다.")
            } else {
                journal.phase = .partialRestore
                journal.detail = PetL10n.text("Blabee was updated, but some Codex session restorations could not be confirmed. They will not be retried automatically to avoid duplicate sessions.", korean: "Blabee 업데이트를 마쳤지만 일부 Codex 세션 복원을 확인하지 못했습니다. 중복 실행을 막기 위해 자동 재시도하지 않습니다.")
            }
            try persist(&journal)
        } catch {
            let failure = Self.message(error)
            let identity = effects.installedIdentity()
            let published = installationAttempted && identity == journal.candidateIdentity
            if let installationError = error as? AppInstallationError,
               let recovery = installationError.recoveryURL,
               recovery.lastPathComponent.hasPrefix(".Blabee.backup-") {
                journal.backupURL = recovery
            }
            // If pause acknowledgement was lost, do not assume shutdown happened and spawn a duplicate.
            for index in journal.sessions.indices where journal.sessions[index].step == .pausing {
                journal.sessions[index].step = .uncertain
            }
            if !published, identity == journal.previousIdentity {
                // Pre-publication failure may restore only sessions whose pause acknowledgement was durable.
                await restoreConfirmed(&journal)
                var relaunchFailure: String?
                do { try await effects.openApp(journal.previousIdentity) }
                catch { relaunchFailure = Self.message(error) }
                journal.phase = relaunchFailure != nil || journal.sessions.contains(where: { [.uncertain, .restoring].contains($0.step) })
                    ? .recoveryRequired : .failed
                journal.detail = failure + PetL10n.text(" The existing app and backup have been preserved.", korean: " 기존 앱과 백업을 보존했습니다.")
                    + (relaunchFailure.map { PetL10n.text(" App relaunch check: ", korean: " 앱 재실행 확인: ") + $0 } ?? "")
            } else if published {
                // No post-publication rollback. Preserve both apps and recover only confirmed paused sessions.
                await restoreConfirmed(&journal)
                journal.phase = .recoveryRequired
                journal.detail = failure + PetL10n.text(" The new app and existing app backup have been preserved. Check the app in Finder.", korean: " 새 앱과 기존 앱 백업을 보존했습니다. Finder에서 앱 실행을 확인해 주세요.")
            } else {
                journal.phase = .recoveryRequired
                journal.detail = failure + PetL10n.text(" Automatic restoration stopped because the installation path changed. Apps and session records have been preserved.", korean: " 설치 경로가 변경되어 자동 복원을 중단했습니다. 앱과 세션 기록을 보존했습니다.")
            }
            try? persist(&journal)
        }
        return journal
    }

    static func preflight(frozen: [UpdateManagedSession], current: [UpdateManagedSession]) throws {
        guard frozen.count == current.count, Set(frozen.map(\.id)).count == frozen.count else {
            throw AppUpdateTransactionError.changedSinceReview
        }
        for session in frozen {
            guard let actual = current.first(where: { $0.id == session.id }),
                  actual.threadID == session.threadID, actual.cwd == session.cwd,
                  let thread = actual.threadID, UUID(uuidString: thread) != nil,
                  actual.state == .running else { throw AppUpdateTransactionError.sessionsNotReady }
        }
    }

    private func restoreConfirmed(_ journal: inout AppUpdateJournal) async {
        for index in journal.sessions.indices where journal.sessions[index].step == .paused {
            do {
                journal.phase = .restoring; journal.sessions[index].step = .restoring
                journal.detail = PetL10n.text("Restoring saved Codex sessions.", korean: "저장한 Codex 세션을 복원하는 중입니다.")
                try persist(&journal) // Durable intent before an action that must not be repeated blindly.
                try await effects.resume(journal.sessions[index].value, journal.jobID)
                journal.sessions[index].step = .restored
                try persist(&journal)
            } catch {
                journal.sessions[index].step = .uncertain
                try? persist(&journal)
            }
        }
    }

    private func persist(_ journal: inout AppUpdateJournal) throws {
        journal.updatedAt = Date()
        try effects.save(journal)
    }

    static func message(_ error: Error) -> String {
        String(error.localizedDescription.unicodeScalars.filter {
            !CharacterSet.controlCharacters.contains($0) || $0 == "\n"
        }.prefix(2_048).map(String.init).joined())
    }
}

/// Availability after launch is distinct from update readiness. A healthy new
/// service may already have received new cards or approvals; never require idle
/// state here, and never send those actions again to test the connection.
@MainActor
struct AppUpdateLaunchedServiceHealth {
    var probe: (String) async throws -> AppUpdateServiceReadiness = {
        try await Self.inspectInstalledService(expectedIdentity: $0)
    }
    var uptime: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    var sleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    var timeout: TimeInterval = 30

    func requireHealthy(expectedIdentity: String) async throws {
        let deadline = uptime() + timeout
        while true {
            try Task.checkCancellation()
            do {
                _ = try await probe(expectedIdentity)
                try Task.checkCancellation()
                guard uptime() <= deadline else { throw AppUpdateTransactionError.serviceHealthNotConfirmed }
                return
            } catch {
                if error is CancellationError { throw error }
                if let failure = error as? AppUpdateTransactionError,
                   [.serviceHealthIdentityMismatch, .serviceHealthResponseInvalid].contains(failure) {
                    throw failure
                }
                guard uptime() < deadline else { throw AppUpdateTransactionError.serviceHealthNotConfirmed }
                try await sleep(.milliseconds(500))
            }
        }
    }

    nonisolated static func requireIdentity(
        expected: String, installed: String?, service: String?, parent: String?
    ) throws {
        guard OperationalRuntimeIdentity.isValid(expected), installed == expected,
              service == expected, parent == expected else {
            throw AppUpdateTransactionError.serviceHealthIdentityMismatch
        }
    }

    nonisolated private static func inspectInstalledService(
        expectedIdentity: String
    ) async throws -> AppUpdateServiceReadiness {
        try await Task.detached(priority: .utility) {
            let executable = AppInstallationService.productionDestinationURL
                .appendingPathComponent(AppRuntimeUseLease.executablePath)
            guard OperationalRuntimeIdentity.installedIdentity(forExecutable: executable) == expectedIdentity else {
                throw AppUpdateTransactionError.serviceHealthIdentityMismatch
            }
            let socketPath = OperationalSocketPath.defaultPath(homeDirectory: FileManager.default.homeDirectoryForCurrentUser)
            let client = try UnixDomainSocketClient(socketPath: socketPath, runtimeIdentity: expectedIdentity)
            // The client binds request ID, expected runtime identity, private
            // socket ownership and peer UID before exposing this result.
            let response = try client.request(type: "update_status", payload: [:],
                connectTimeoutMilliseconds: 250, responseTimeoutMilliseconds: 1_000)
            let status: AppUpdateServiceReadiness
            do { status = try .parse(StrictJSONTransport.data(forJSONObject: response)) }
            catch { throw AppUpdateTransactionError.serviceHealthResponseInvalid }
            let reader = AppInstallationProcessReader.live
            let serviceState = reader.state(status.servicePID)
            let parentState = reader.state(status.serviceParentPID)
            guard case .running(let service) = serviceState,
                  case .running(let parent) = parentState,
                  service.processID == status.servicePID, parent.processID == status.serviceParentPID,
                  service.effectiveUserID == geteuid(), parent.effectiveUserID == geteuid(),
                  service.parentProcessID == status.serviceParentPID else {
                throw AppUpdateTransactionError.serviceHealthNotConfirmed
            }
            try requireIdentity(expected: expectedIdentity,
                installed: OperationalRuntimeIdentity.installedIdentity(forExecutable: executable),
                service: AppUpdateHelper.runningIdentity(status.servicePID, executable: executable),
                parent: AppUpdateHelper.runningIdentity(status.serviceParentPID, executable: executable))
            guard reader.state(status.servicePID) == serviceState,
                  reader.state(status.serviceParentPID) == parentState else {
                throw AppUpdateTransactionError.serviceHealthNotConfirmed
            }
            return status
        }.value
    }
}

/// Waiting never replays an approval or dispatch. Only the read-only readiness
/// inspection is repeated; permanent compatibility errors stop immediately.
@MainActor
struct AppUpdateSafePointWaiter {
    var requireReady: (URL) async throws -> Void = {
        try await AppUpdateTransitionPreflight.requireReady(candidateApplicationURL: $0)
    }
    var isTransient: (Error) -> Bool = AppUpdateTransitionPreflight.isTransient
    var uptime: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    var sleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    var timeout: TimeInterval = 30

    func wait(candidateApplicationURL: URL, isCurrent: () -> Bool = { true },
              onWaiting: (String) -> Void) async throws {
        let deadline = uptime() + timeout
        while true {
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
            do {
                try await requireReady(candidateApplicationURL)
                try Task.checkCancellation()
                guard isCurrent() else { throw CancellationError() }
                return
            } catch {
                if error is CancellationError { throw error }
                guard isTransient(error) else { throw error }
                onWaiting(AppUpdateTransactionEngine.message(error))
                guard uptime() < deadline else { throw AppUpdateTransactionError.safePointTimedOut }
                try await sleep(.milliseconds(500))
            }
        }
    }
}

/// A live PID alone is not evidence that the update is still making progress.
/// Timeout reporting never kills a helper, rolls back an app, or replays work.
enum AppUpdateProgressPolicy {
    static func isStalled(_ journal: AppUpdateJournal, now: Date) -> Bool {
        guard !journal.phase.isTerminal else { return false }
        let limit: TimeInterval
        switch journal.phase {
        case .prepared: limit = 600 // Bounded signature/notary checks.
        case .waitingForExit: limit = 900 // Two independent candidate reverifications.
        case .ready: limit = 45 // The helper gives its parent 30 seconds to exit.
        case .pausing, .restoring: limit = 300
        case .installing: limit = 600
        case .published: limit = 60
        case .succeeded, .failed, .partialRestore, .recoveryRequired: return false
        }
        let age = now.timeIntervalSince(journal.updatedAt)
        return age > limit || age < -60
    }

    static var stalledMessage: String {
        PetL10n.text("The update helper has not reported progress within the expected time. Apps and conversation records have been preserved. Check status again; this update will not be restarted automatically.", korean: "정해진 시간 안에 업데이트 도우미의 진행 상태를 확인하지 못했습니다. 앱과 대화 기록은 보존했습니다. 상태를 다시 확인해 주세요. 업데이트를 자동으로 다시 실행하지 않습니다.")
    }
}

@MainActor
final class AppUpdateTransactionController: ObservableObject {
    enum Phase: Equatable {
        case idle, preparing, review, waitingForSafePoint, deferred, startingHelper, updating
        case succeeded, failed, partialRestore, recoveryRequired
    }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var detail = ""
    @Published private(set) var preparedReview: AppUpdatePreparedReview?
    @Published private(set) var lastResult: AppUpdateJournal?
    var productMetrics: PetProductUpdateMetrics?
    var isBusy: Bool { [.preparing, .waitingForSafePoint, .startingHelper, .updating].contains(phase) }
    var canPrepare: Bool {
        !isBusy && phase != .recoveryRequired && preparedReview == nil && helperProcess?.isRunning != true
    }
    var canBeginInstallation: Bool {
        [.review, .deferred].contains(phase) && preparedReview?.canInstall == true && helperProcess?.isRunning != true
    }
    var canCancel: Bool { ![.startingHelper, .updating].contains(phase) && helperProcess?.isRunning != true }
    private let downloader: AppUpdateDownloadPreparer
    private let store: AppUpdateJournalStore
    private var prepared: AppUpdatePreparedDownload?
    private var frozenIdentity: String?
    private var generation = 0
    private var helperProcess: Process?
    private var productUpdateOperation: UUID?
    private let safePointWaiter: AppUpdateSafePointWaiter
    private let prepareDownload: @Sendable (PetAppUpdateRelease) async throws -> AppUpdatePreparedDownload
    private let cleanupDownload: @Sendable (AppUpdatePreparedDownload) async throws -> Void
    private let installedVersion: () throws -> (version: PetAppUpdateVersion, identity: String)

    init(downloader: AppUpdateDownloadPreparer = .init(), store: AppUpdateJournalStore = .live(),
         safePointWaiter: AppUpdateSafePointWaiter = .init(),
         prepareDownload: (@Sendable (PetAppUpdateRelease) async throws -> AppUpdatePreparedDownload)? = nil,
         cleanupDownload: (@Sendable (AppUpdatePreparedDownload) async throws -> Void)? = nil,
         installedVersion: (() throws -> (version: PetAppUpdateVersion, identity: String))? = nil) {
        self.downloader = downloader; self.store = store
        self.safePointWaiter = safePointWaiter
        self.prepareDownload = prepareDownload ?? { try await downloader.prepare($0) }
        self.cleanupDownload = cleanupDownload ?? { try await downloader.cleanup($0) }
        self.installedVersion = installedVersion ?? Self.currentInstalledVersion
    }

    func prepare(_ release: PetAppUpdateRelease) async {
        guard !isBusy, helperProcess?.isRunning != true else { return }
        productUpdateOperation = productMetrics?.start(target: release.version)
        generation += 1
        let request = generation
        phase = .preparing; detail = PetL10n.text("Downloading the update and verifying its signature and notarization.", korean: "업데이트를 다운로드하고 서명과 공증을 확인하는 중입니다.")
        preparedReview = nil
        let old = prepared
        prepared = nil
        if let old { try? await cleanupDownload(old) }
        guard request == generation else { return }
        do {
            if let previous = try store.latest(), !previous.phase.isTerminal {
                throw AppUpdateTransactionError.recoveryRequired
            }
            let current = try installedVersion()
            guard release.version > current.version else { throw AppUpdateTransactionError.changedSinceReview }
            let download = try await prepareDownload(release)
            guard request == generation else { try? await cleanupDownload(download); return }
            prepared = download
            frozenIdentity = current.identity
            preparedReview = .init(release: release, currentVersion: current.version, sessions: [], blockers: [])
            phase = .review
            detail = PetL10n.text("The download is verified. Checking whether Blabee can restart while keeping your conversations open.", korean: "다운로드 검증을 마쳤습니다. 대화를 유지한 채 Blabee를 재시작할 수 있는지 확인합니다.")
        } catch {
            if request == generation {
                phase = .failed; detail = AppUpdateTransactionEngine.message(error)
                productMetrics?.finish(Task.isCancelled || error is CancellationError
                    || (error as? URLError)?.code == .cancelled ? .cancelled : .failed,
                    operationID: productUpdateOperation)
            }
        }
    }

    /// True means a verified copied helper acknowledged durable readiness. The caller may now terminate NSApp normally.
    func beginInstallation() async throws -> Bool {
        guard canBeginInstallation, let review = preparedReview,
              let prepared, let frozenIdentity else { throw AppUpdateTransactionError.sessionsNotReady }
        if phase == .deferred { productUpdateOperation = productMetrics?.start(target: review.release.version) }
        let request = generation
        phase = .waitingForSafePoint
        detail = PetL10n.text("Checking active requests and connection compatibility. Your conversations will remain open.", korean: "진행 중인 요청과 연결 호환성을 확인합니다. 대화는 계속 실행됩니다.")
        var pendingJournal: AppUpdateJournal?
        var helperStarted = false
        var confirmedPreExitFailure = false
        do {
            try await safePointWaiter.wait(candidateApplicationURL: prepared.applicationURL,
                isCurrent: { request == self.generation }) { reason in
                guard request == self.generation else { return }
                self.detail = reason
            }
            guard request == generation else { return false }
            phase = .startingHelper; detail = PetL10n.text("Preparing the update helper.", korean: "업데이트 도우미를 준비하는 중입니다.")
            try await downloader.reverify(prepared)
            let current = try installedVersion()
            guard current.identity == frozenIdentity, current.version == review.currentVersion else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            let jobID = UUID().uuidString.lowercased()
            // A failed attempt's helper is retained as evidence. A retry uses a
            // fresh destination instead of overwriting or trusting that copy.
            let helperParent = prepared.workRootURL.appendingPathComponent("helper-runtime-\(jobID)", isDirectory: true)
            guard mkdir(helperParent.path, 0o700) == 0 else { throw AppUpdateTransactionError.unsafeJournal }
            let helper = try await Task.detached { try AppUpdateRuntimeCopy.prepareCurrent(in: helperParent) }.value
            try await downloader.reverify(prepared)
            guard let candidateIdentity = OperationalRuntimeIdentity.installedIdentity(
                forExecutable: prepared.applicationURL.appendingPathComponent(AppRuntimeUseLease.executablePath)),
                  candidateIdentity == prepared.runtimeIdentity else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            let now = Date()
            let journal = AppUpdateJournal(schema: 2, jobID: jobID,
                nonce: UUID().uuidString.lowercased(), parentPID: getpid(),
                parentStartTime: try UpdateManagedCodexProcessIdentity.startTime(pid: getpid()), createdAt: now,
                previousIdentity: frozenIdentity, candidateIdentity: candidateIdentity,
                download: try .init(prepared), helperApplicationURL: helper,
                sessions: [], updatedAt: now)
            try store.save(journal)
            pendingJournal = journal
            productMetrics?.attachJournal(journal.jobID, operationID: productUpdateOperation)
            let process = Process()
            process.executableURL = helper.appendingPathComponent(AppRuntimeUseLease.executablePath)
            process.arguments = ["update-helper", "--job-id", journal.jobID, "--nonce", journal.nonce]
            process.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
            process.currentDirectoryURL = helperParent
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            process.terminationHandler = { [weak self] _ in
                Task { @MainActor in self?.objectWillChange.send() }
            }
            try process.run(); helperStarted = true; helperProcess = process
            let deadline = ContinuousClock.now.advanced(by: .seconds(600))
            while ContinuousClock.now < deadline {
                let progress = try store.load(jobID: journal.jobID, nonce: journal.nonce)
                if progress.phase == .ready, progress.helperPID == process.processIdentifier,
                   let start = progress.helperStartTime,
                   try UpdateManagedCodexProcessIdentity.isAlive(pid: process.processIdentifier, startTime: start),
                   AppUpdateHelper.runningIdentity(process.processIdentifier,
                       executable: process.executableURL!) == frozenIdentity {
                    phase = .updating; detail = PetL10n.text("The update helper is ready. Closing Blabee normally.", korean: "업데이트 도우미가 준비되었습니다. Blabee를 정상 종료합니다.")
                    return true
                }
                if progress.phase.isTerminal {
                    // The parent is still running: a failed readiness check
                    // cannot have reached the helper's installation phase.
                    confirmedPreExitFailure = progress.phase == .failed
                    throw AppUpdateTransactionError.transitionBlocked(progress.detail)
                }
                guard process.isRunning, !progress.phase.isTerminal else {
                    throw AppUpdateTransactionError.helperNotReady
                }
                try await Task.sleep(for: .milliseconds(100))
            }
            throw AppUpdateTransactionError.helperNotReady
        } catch {
            if !helperStarted, var journal = pendingJournal {
                journal.phase = .failed; journal.updatedAt = Date()
                journal.detail = AppUpdateTransactionEngine.message(error)
                try? store.save(journal)
            }
            guard request == generation else { return false }
            phase = !helperStarted || confirmedPreExitFailure ? .deferred : .failed
            let waitingReason = detail
            detail = AppUpdateTransactionEngine.message(error)
            if error as? AppUpdateTransactionError == .safePointTimedOut {
                detail += "\n" + waitingReason
            }
            productMetrics?.finish(Task.isCancelled || error is CancellationError
                || (error as? URLError)?.code == .cancelled ? .cancelled : .failed,
                operationID: productUpdateOperation)
            throw error
        }
    }

    func cancel() async {
        guard canCancel else { return }
        productMetrics?.finish(.cancelled, operationID: productUpdateOperation)
        productUpdateOperation = nil
        generation += 1
        let cancelled = prepared
        prepared = nil; preparedReview = nil; frozenIdentity = nil
        phase = .idle; detail = PetL10n.text("Update cancelled.", korean: "업데이트를 취소했습니다.")
        if let cancelled { try? await cleanupDownload(cancelled) }
    }

    /// Startup only reports persisted state. It never retries an interrupted stop, install, or resume.
    func loadLastResult() {
        guard ![.preparing, .review, .waitingForSafePoint, .deferred, .startingHelper].contains(phase) else { return }
        recoverProductMetrics()
        do {
            guard let journal = try store.latest() else { return }
            lastResult = journal; detail = journal.detail
            if AppUpdateProgressPolicy.isStalled(journal, now: Date()) {
                phase = .recoveryRequired
                detail = AppUpdateProgressPolicy.stalledMessage
                return
            }
            switch journal.phase {
            case .succeeded: phase = .succeeded
            case .failed: phase = .failed
            case .partialRestore: phase = .partialRestore
            case .recoveryRequired: phase = .recoveryRequired
            default:
                if let pid = journal.helperPID, let start = journal.helperStartTime,
                   try UpdateManagedCodexProcessIdentity.isAlive(pid: pid, startTime: start),
                   AppUpdateHelper.runningIdentity(pid, executable: journal.helperApplicationURL
                    .appendingPathComponent(AppRuntimeUseLease.executablePath)) == journal.previousIdentity {
                    phase = .updating
                } else {
                    phase = .recoveryRequired
                    detail = PetL10n.text("An interrupted update record exists. Nothing will run automatically to avoid duplicate restoration. Check Blabee and Codex session status.", korean: "중단된 업데이트 기록이 있습니다. 중복 복원을 막기 위해 자동 실행하지 않습니다. 앱과 Codex 세션 상태를 확인해 주세요.")
                }
            }
        } catch { phase = .recoveryRequired; detail = AppUpdateTransactionEngine.message(error) }
    }

    /// This read-only observation never changes installation or restore behavior.
    func recoverProductMetrics() {
        productMetrics?.recover { jobID in
            guard let journal = try? store.load(jobID: jobID) else { return nil }
            let mayHavePublished = [.installing, .published, .restoring, .succeeded, .partialRestore, .recoveryRequired]
                .contains(journal.phase)
            let current = mayHavePublished ? (try? Self.currentInstalledVersion()) : nil
            let targetRunning = current?.version.version == journal.download.version
                && current?.version.build == journal.download.build
                && current?.identity == journal.candidateIdentity
            let result: PetProductUpdateObservation.Result
            // Schema 2 succeeds only after the new service was observed, not
            // merely because the GUI process has the target version on disk.
            if targetRunning && (!journal.preservesConnections || journal.phase == .succeeded) {
                result = .targetRunning
            } else if journal.phase == .failed {
                result = .failed
            } else {
                // Recovery-required can mean publication happened but launch
                // could not be confirmed. Preserve that uncertainty as pending.
                result = .pending
            }
            return .init(journalJobID: journal.jobID, targetVersion: journal.download.version,
                         targetBuild: journal.download.build, result: result)
        }
    }

    private static func currentInstalledVersion() throws -> (version: PetAppUpdateVersion, identity: String) {
        let installed = AppInstallationService.productionDestinationURL
        guard Bundle.main.bundleURL.resolvingSymlinksInPath().path == installed.path,
              let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
              let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
              let parsed = PetAppUpdateVersion(version: version, build: build),
              let identity = OperationalRuntimeIdentity.installedIdentity(
                forExecutable: installed.appendingPathComponent(AppRuntimeUseLease.executablePath)),
              try OperationalRuntimeIdentity.requireCurrent() == identity else {
            throw AppUpdateTransactionError.changedSinceReview
        }
        return (parsed, identity)
    }
}

@MainActor
enum AppUpdateHelper {
    static func acquireAdmissionWhenReady(
        candidateApplicationURL: URL,
        acquire: @escaping () throws -> AppUpdateAdmissionLease = { try AppUpdateAdmissionGate.acquireForUpdate() },
        waiter: AppUpdateSafePointWaiter = .init()
    ) async throws -> AppUpdateAdmissionLease {
        var acquired: AppUpdateAdmissionLease?
        var gatedWaiter = waiter
        let check = waiter.requireReady
        gatedWaiter.requireReady = { candidate in
            let attempt = try acquire()
            do {
                try await check(candidate)
                acquired = attempt
            } catch {
                // Pending approvals must be able to finish between attempts.
                attempt.release()
                throw error
            }
        }
        do {
            try await gatedWaiter.wait(candidateApplicationURL: candidateApplicationURL, onWaiting: { _ in })
            guard let acquired else { throw AppUpdateAdmissionError.unavailable }
            return acquired
        } catch {
            acquired?.release()
            throw error
        }
    }

    static func run(arguments: [String],
                    requireClaudeInactive: @escaping @Sendable () throws -> Void = AppClaudeRuntimeUpdateGuard.requireLiveClear) async -> Int32 {
        let store = AppUpdateJournalStore.live()
        guard arguments.count == 4, arguments[0] == "--job-id", arguments[2] == "--nonce" else { return 2 }
        let jobID = arguments[1], nonce = arguments[3]
        var loaded: AppUpdateJournal?
        var parentExited = false
        var admission: AppUpdateAdmissionLease?
        defer { admission?.release() }
        do {
            let lock = try store.acquireHelperLock()
            defer { withExtendedLifetime(lock) {} }
            var journal = try store.load(jobID: jobID, nonce: nonce)
            loaded = journal
            guard journal.phase == .prepared, Date().timeIntervalSince(journal.createdAt) >= 0,
                  Date().timeIntervalSince(journal.createdAt) < 120,
                  getppid() == journal.parentPID,
                  try UpdateManagedCodexProcessIdentity.isAlive(pid: journal.parentPID, startTime: journal.parentStartTime),
                  let executable = Bundle.main.executableURL,
                  AppUpdateRuntimeCopy.physicalPath(executable) == journal.helperApplicationURL
                    .appendingPathComponent(AppRuntimeUseLease.executablePath).path,
                  !executable.path.hasPrefix(AppInstallationService.productionDestinationURL.path + "/"),
                  try OperationalRuntimeIdentity.requireCurrent() == journal.previousIdentity,
                  runningIdentity(getpid(), executable: executable) == journal.previousIdentity else {
                throw AppUpdateTransactionError.helperUnverified
            }
            let prepared = try journal.download.prepared()
            let downloader = AppUpdateDownloadPreparer()
            try await downloader.reverify(prepared)
            guard installedIdentity() == journal.previousIdentity,
                  OperationalRuntimeIdentity.installedIdentity(forExecutable: prepared.applicationURL
                    .appendingPathComponent(AppRuntimeUseLease.executablePath)) == journal.candidateIdentity else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            let sessions = UpdateManagedCodexSessions.live()
            if journal.preservesConnections {
                // A snapshot poll may have started since the UI check. Retry
                // acquisition briefly, and recheck while new work is fenced.
                admission = try await acquireAdmissionWhenReady(candidateApplicationURL: prepared.applicationURL)
            } else {
                try AppUpdateTransactionEngine.preflight(frozen: journal.sessions.map(\.value),
                    current: try await sessions.sessions())
                try requireClaudeInactive()
            }
            journal.helperPID = getpid()
            journal.helperStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
            journal.phase = .ready; journal.updatedAt = Date()
            journal.detail = PetL10n.text("The helper is ready and waiting for Blabee to close normally.", korean: "도우미가 준비되어 Blabee의 정상 종료를 기다립니다.")
            try store.save(journal); loaded = journal
            let deadline = ContinuousClock.now.advanced(by: .seconds(30))
            while ContinuousClock.now < deadline {
                if !journal.preservesConnections { try requireClaudeInactive() }
                if try !UpdateManagedCodexProcessIdentity.isAlive(pid: journal.parentPID, startTime: journal.parentStartTime) {
                    parentExited = true; break
                }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard parentExited else { throw AppUpdateTransactionError.parentDidNotExit }
            journal.phase = .waitingForExit; journal.updatedAt = Date()
            try store.save(journal)
            let effects = AppUpdateTransactionEffects(
                reverify: { record in
                    try await downloader.reverify(try record.download.prepared())
                    guard OperationalRuntimeIdentity.installedIdentity(forExecutable: prepared.applicationURL
                        .appendingPathComponent(AppRuntimeUseLease.executablePath)) == record.candidateIdentity else {
                        throw AppUpdateTransactionError.changedSinceReview
                    }
                },
                sessions: { try await sessions.sessions() },
                pause: { try await sessions.pause($0, transactionID: $1) },
                resume: { try await sessions.resume($0, transactionID: $1) },
                install: { record in
                    let service = AppInstallationService.live(expectedSourceIdentity: record.candidateIdentity,
                        activityGuard: AppInstallationProcessGuard().requireInactive,
                        updateAdmission: admission)
                    return try await Task.detached {
                        let plan = try service.inspect(source: prepared.applicationURL)
                        guard plan.existing?.runtimeIdentity == record.previousIdentity,
                              plan.source.version == record.download.version,
                              plan.source.build == record.download.build,
                              plan.comparison == .upgrade else { throw AppUpdateTransactionError.changedSinceReview }
                        return try service.install(plan, replacementApproved: true, legacyQuitConfirmed: false)
                    }.value
                },
                installedIdentity: installedIdentity,
                openApp: {
                    // Installation has finished (or failed before publication).
                    // The new service needs ingress to establish its generation.
                    admission?.release(); admission = nil
                    try await AppInstallationApplicationOpener().openInstalled(
                        applicationURL: AppInstallationService.productionDestinationURL, expectedIdentity: $0)
                },
                save: { try store.save($0) },
                requireClaudeInactive: requireClaudeInactive,
                requirePreservedConnectionsReady: { record in
                    try await AppUpdateTransitionPreflight.requireReady(
                        candidateApplicationURL: record.download.prepared().applicationURL)
                }, requireLaunchedServiceHealthy: { identity in
                    try await AppUpdateLaunchedServiceHealth().requireHealthy(expectedIdentity: identity)
                })
            let result = await AppUpdateTransactionEngine(effects: effects).execute(journal)
            return result.phase == .succeeded ? 0 : 1
        } catch {
            if var journal = loaded, journal.phase == .prepared || journal.phase == .ready {
                journal.phase = .failed; journal.detail = AppUpdateTransactionEngine.message(error)
                if parentExited, installedIdentity() == journal.previousIdentity {
                    do {
                        admission?.release(); admission = nil
                        try await AppInstallationApplicationOpener().openInstalled(
                            applicationURL: AppInstallationService.productionDestinationURL,
                            expectedIdentity: journal.previousIdentity)
                    } catch { journal.phase = .recoveryRequired; journal.detail += " " + AppUpdateTransactionEngine.message(error) }
                }
                journal.updatedAt = Date(); try? store.save(journal)
            }
            return 1
        }
    }

    private static func installedIdentity() -> String? {
        OperationalRuntimeIdentity.installedIdentity(forExecutable: AppInstallationService.productionDestinationURL
            .appendingPathComponent(AppRuntimeUseLease.executablePath))
    }

    /// Bind the acknowledgement to the exact executing signed helper, not just the file now at that path.
    nonisolated static func runningIdentity(_ pid: Int32, executable: URL) -> String? {
        guard case .running(let observed) = AppInstallationProcessReader.live.observe(pid),
              observed.resolvingSymlinksInPath().path == executable.resolvingSymlinksInPath().path,
              let before = signature(pid) else { return nil }
        let verifier = OperationalCodeSignatureVerifier(runningCode: { before },
            installedCode: OperationalCodeSignatureVerifier.live.installedCode)
        let identity = OperationalRuntimeIdentity.resolveSnapshot(executableURL: executable,
            environment: [:], signatureVerifier: verifier)?.runtimeIdentity
        guard signature(pid) == before else { return nil }
        return identity
    }

    nonisolated private static func signature(_ pid: Int32) -> OperationalCodeSignatureEvidence? {
        var code: SecCode?
        guard pid > 0,
              SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary,
                SecCSFlags(), &code) == errSecSuccess, let code,
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess else { return nil }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(unsafeBitCast(code, to: SecStaticCode.self), SecCSFlags(),
                &information) == errSecSuccess,
              let dictionary = information as? [CFString: Any],
              let identifier = dictionary[kSecCodeInfoIdentifier] as? String,
              let cdHash = dictionary[kSecCodeInfoUnique] as? Data,
              let executable = dictionary[kSecCodeInfoMainExecutable] as? URL,
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess else { return nil }
        return .init(identifier: identifier, cdHash: cdHash, executableURL: executable)
    }
}

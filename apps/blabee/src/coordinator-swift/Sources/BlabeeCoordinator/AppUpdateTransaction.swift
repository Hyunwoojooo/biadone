import AppKit
import Combine
import Darwin
import Foundation
import Security

enum AppUpdateTransactionError: Error, LocalizedError, Equatable {
    case invalidJournal, unsafeJournal, updateBusy, changedSinceReview, sessionsNotReady
    case helperUnverified, helperNotReady, parentDidNotExit, recoveryRequired
    var errorDescription: String? {
        switch self {
        case .invalidJournal: "업데이트 기록의 버전, 세션 또는 작업 식별자를 확인하지 못했습니다."
        case .unsafeJournal: "업데이트 기록 폴더의 소유권과 접근 권한을 확인하지 못했습니다."
        case .updateBusy: "다른 업데이트 작업이 진행 중입니다."
        case .changedSinceReview: "확인 이후 앱이나 Codex 세션이 변경되었습니다. 업데이트를 다시 확인해 주세요."
        case .sessionsNotReady: "작업 중이거나 복원을 확인할 수 없는 Codex 세션이 있습니다. 먼저 작업을 마무리해 주세요."
        case .helperUnverified: "업데이트 도우미의 실행 위치 또는 서명을 확인하지 못했습니다."
        case .helperNotReady: "업데이트 도우미가 준비되지 않아 Blabee를 종료하지 않았습니다."
        case .parentDidNotExit: "Blabee가 정상 종료되지 않아 업데이트를 중단했습니다."
        case .recoveryRequired: "이전 업데이트의 완료 여부를 확인할 수 없습니다. 보존된 앱과 세션 상태를 먼저 확인해 주세요."
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
}

@MainActor
struct AppUpdateTransactionEngine {
    let effects: AppUpdateTransactionEffects

    func execute(_ initial: AppUpdateJournal) async -> AppUpdateJournal {
        var journal = initial
        // A crashed pausing/installing/restoring record is deliberately never replayed.
        guard journal.phase == .waitingForExit,
              journal.sessions.allSatisfy({ $0.step == .pending }) else {
            journal.phase = .recoveryRequired
            journal.detail = AppUpdateTransactionError.recoveryRequired.localizedDescription
            try? persist(&journal)
            return journal
        }
        var installationAttempted = false
        do {
            try await effects.reverify(journal)
            guard effects.installedIdentity() == journal.previousIdentity else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            let current = try await effects.sessions()
            try Self.preflight(frozen: journal.sessions.map(\.value), current: current)
            for index in journal.sessions.indices {
                journal.phase = .pausing; journal.sessions[index].step = .pausing
                journal.detail = "Codex 세션을 저장하고 정상 종료하는 중입니다."
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
            journal.phase = .installing; journal.detail = "기존 Blabee를 백업하고 새 버전을 설치하는 중입니다."
            try persist(&journal)
            installationAttempted = true
            let receipt = try await effects.install(journal)
            journal.backupURL = receipt.backupURL
            journal.phase = .published; journal.detail = "새 Blabee 설치를 마쳤습니다. 실행을 확인하는 중입니다."
            try persist(&journal)
            try await effects.openApp(journal.candidateIdentity)
            await restoreConfirmed(&journal)
            if journal.sessions.allSatisfy({ $0.step == .restored }) {
                journal.phase = .succeeded; journal.detail = "Blabee 업데이트와 Codex 세션 복원을 완료했습니다."
            } else {
                journal.phase = .partialRestore
                journal.detail = "Blabee 업데이트를 마쳤지만 일부 Codex 세션 복원을 확인하지 못했습니다. 중복 실행을 막기 위해 자동 재시도하지 않습니다."
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
                journal.detail = failure + " 기존 앱과 백업을 보존했습니다."
                    + (relaunchFailure.map { " 앱 재실행 확인: " + $0 } ?? "")
            } else if published {
                // No post-publication rollback. Preserve both apps and recover only confirmed paused sessions.
                await restoreConfirmed(&journal)
                journal.phase = .recoveryRequired
                journal.detail = failure + " 새 앱과 기존 앱 백업을 보존했습니다. Finder에서 앱 실행을 확인해 주세요."
            } else {
                journal.phase = .recoveryRequired
                journal.detail = failure + " 설치 경로가 변경되어 자동 복원을 중단했습니다. 앱과 세션 기록을 보존했습니다."
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
                journal.detail = "저장한 Codex 세션을 복원하는 중입니다."
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

@MainActor
final class AppUpdateTransactionController: ObservableObject {
    enum Phase: Equatable {
        case idle, preparing, review, startingHelper, updating, succeeded, failed, partialRestore, recoveryRequired
    }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var detail = ""
    @Published private(set) var preparedReview: AppUpdatePreparedReview?
    @Published private(set) var lastResult: AppUpdateJournal?
    var productMetrics: PetProductUpdateMetrics?
    var isBusy: Bool { [.preparing, .startingHelper, .updating].contains(phase) || helperProcess?.isRunning == true }
    var canBeginInstallation: Bool { phase == .review && preparedReview?.canInstall == true }
    private let downloader: AppUpdateDownloadPreparer
    private let store: AppUpdateJournalStore
    private var prepared: AppUpdatePreparedDownload?
    private var frozenIdentity: String?
    private var generation = 0
    private var helperProcess: Process?
    private var productUpdateOperation: UUID?

    init(downloader: AppUpdateDownloadPreparer = .init(), store: AppUpdateJournalStore = .live()) {
        self.downloader = downloader; self.store = store
    }

    func prepare(_ release: PetAppUpdateRelease) async {
        guard !isBusy else { return }
        productUpdateOperation = productMetrics?.start(target: release.version)
        generation += 1
        let request = generation
        phase = .preparing; detail = "업데이트를 다운로드하고 서명과 공증을 확인하는 중입니다."
        preparedReview = nil
        let old = prepared
        prepared = nil
        if let old { try? await downloader.cleanup(old) }
        guard request == generation else { return }
        do {
            if let previous = try store.latest(), !previous.phase.isTerminal {
                throw AppUpdateTransactionError.recoveryRequired
            }
            let current = try Self.currentInstalledVersion()
            guard release.version > current.version else { throw AppUpdateTransactionError.changedSinceReview }
            let download = try await downloader.prepare(release)
            guard request == generation else { try? await downloader.cleanup(download); return }
            prepared = download
            let sessions = try await UpdateManagedCodexSessions.live().sessions()
            let blockers = sessions.compactMap { session -> String? in
                guard session.state == .running, let thread = session.threadID, UUID(uuidString: thread) != nil else {
                    return "\(session.cwd): 작업 종료 또는 세션 저장을 확인해야 합니다."
                }
                return nil
            }
            guard request == generation else { try? await downloader.cleanup(download); return }
            frozenIdentity = current.identity
            preparedReview = .init(release: release, currentVersion: current.version, sessions: sessions, blockers: blockers)
            phase = .review
            detail = blockers.isEmpty
                ? "확인하면 Blabee와 관리 중인 Codex 세션을 정상 종료한 뒤 업데이트하고 복원합니다. 외부에서 실행한 연결 프로세스가 남으면 설치를 중단합니다."
                : "진행 중인 Codex 작업을 먼저 마무리해 주세요."
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
        guard phase == .review, let review = preparedReview, review.canInstall,
              let prepared, let frozenIdentity else { throw AppUpdateTransactionError.sessionsNotReady }
        phase = .startingHelper; detail = "업데이트 도우미를 준비하는 중입니다."
        var pendingJournal: AppUpdateJournal?
        var helperStarted = false
        do {
            try await downloader.reverify(prepared)
            let current = try Self.currentInstalledVersion()
            guard current.identity == frozenIdentity, current.version == review.currentVersion else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            let sessions = try await UpdateManagedCodexSessions.live().sessions()
            try AppUpdateTransactionEngine.preflight(frozen: review.sessions, current: sessions)
            let helperParent = prepared.workRootURL.appendingPathComponent("helper-runtime", isDirectory: true)
            guard mkdir(helperParent.path, 0o700) == 0 else { throw AppUpdateTransactionError.unsafeJournal }
            let helper = try await Task.detached { try AppUpdateRuntimeCopy.prepareCurrent(in: helperParent) }.value
            try await downloader.reverify(prepared)
            guard let candidateIdentity = OperationalRuntimeIdentity.installedIdentity(
                forExecutable: prepared.applicationURL.appendingPathComponent(AppRuntimeUseLease.executablePath)),
                  candidateIdentity == prepared.runtimeIdentity else {
                throw AppUpdateTransactionError.changedSinceReview
            }
            let now = Date()
            let journal = AppUpdateJournal(schema: 1, jobID: UUID().uuidString.lowercased(),
                nonce: UUID().uuidString.lowercased(), parentPID: getpid(),
                parentStartTime: try UpdateManagedCodexProcessIdentity.startTime(pid: getpid()), createdAt: now,
                previousIdentity: frozenIdentity, candidateIdentity: candidateIdentity,
                download: try .init(prepared), helperApplicationURL: helper,
                sessions: sessions.map { .init(value: $0) }, updatedAt: now)
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
            try process.run(); helperStarted = true; helperProcess = process
            let deadline = ContinuousClock.now.advanced(by: .seconds(45))
            while ContinuousClock.now < deadline {
                let progress = try store.load(jobID: journal.jobID, nonce: journal.nonce)
                if progress.phase == .ready, progress.helperPID == process.processIdentifier,
                   let start = progress.helperStartTime,
                   try UpdateManagedCodexProcessIdentity.isAlive(pid: process.processIdentifier, startTime: start),
                   AppUpdateHelper.runningIdentity(process.processIdentifier,
                       executable: process.executableURL!) == frozenIdentity {
                    phase = .updating; detail = "업데이트 도우미가 준비되었습니다. Blabee를 정상 종료합니다."
                    return true
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
            phase = .failed; detail = AppUpdateTransactionEngine.message(error)
            productMetrics?.finish(Task.isCancelled || error is CancellationError
                || (error as? URLError)?.code == .cancelled ? .cancelled : .failed,
                operationID: productUpdateOperation)
            throw error
        }
    }

    func cancel() async {
        guard phase != .updating, phase != .startingHelper, helperProcess?.isRunning != true else { return }
        productMetrics?.finish(.cancelled, operationID: productUpdateOperation)
        productUpdateOperation = nil
        generation += 1
        let cancelled = prepared
        prepared = nil; preparedReview = nil; frozenIdentity = nil
        phase = .idle; detail = "업데이트를 취소했습니다."
        if let cancelled { try? await downloader.cleanup(cancelled) }
    }

    /// Startup only reports persisted state. It never retries an interrupted stop, install, or resume.
    func loadLastResult() {
        guard ![.preparing, .review, .startingHelper].contains(phase) else { return }
        recoverProductMetrics()
        do {
            guard let journal = try store.latest() else { return }
            lastResult = journal; detail = journal.detail
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
                    detail = "중단된 업데이트 기록이 있습니다. 중복 복원을 막기 위해 자동 실행하지 않습니다. 앱과 Codex 세션 상태를 확인해 주세요."
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
            if targetRunning {
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
    static func run(arguments: [String]) async -> Int32 {
        let store = AppUpdateJournalStore.live()
        guard arguments.count == 4, arguments[0] == "--job-id", arguments[2] == "--nonce" else { return 2 }
        let jobID = arguments[1], nonce = arguments[3]
        var loaded: AppUpdateJournal?
        var parentExited = false
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
            try AppUpdateTransactionEngine.preflight(frozen: journal.sessions.map(\.value),
                current: try await sessions.sessions())
            journal.helperPID = getpid()
            journal.helperStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
            journal.phase = .ready; journal.updatedAt = Date()
            journal.detail = "도우미가 준비되어 Blabee의 정상 종료를 기다립니다."
            try store.save(journal); loaded = journal
            let deadline = ContinuousClock.now.advanced(by: .seconds(30))
            while ContinuousClock.now < deadline {
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
                        activityGuard: AppInstallationProcessGuard().requireInactive)
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
                openApp: { try await AppInstallationApplicationOpener().openInstalled(
                    applicationURL: AppInstallationService.productionDestinationURL, expectedIdentity: $0) },
                save: { try store.save($0) })
            let result = await AppUpdateTransactionEngine(effects: effects).execute(journal)
            return result.phase == .succeeded ? 0 : 1
        } catch {
            if var journal = loaded, journal.phase == .prepared || journal.phase == .ready {
                journal.phase = .failed; journal.detail = AppUpdateTransactionEngine.message(error)
                if parentExited, installedIdentity() == journal.previousIdentity {
                    do {
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
    static func runningIdentity(_ pid: Int32, executable: URL) -> String? {
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

    private static func signature(_ pid: Int32) -> OperationalCodeSignatureEvidence? {
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

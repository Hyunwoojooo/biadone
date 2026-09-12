import AppKit
import Darwin
import Foundation
import Security

enum AppInstallationPlatformError: Error, Equatable, Sendable, LocalizedError {
    case applicationActive
    case processInspectionIncomplete
    case processInspectionUnavailable
    case invalidDestination
    case identityMismatch
    case runningIdentityMismatch
    case launchFailed
    case launchTimedOut
    case launchedApplicationMismatch
    case launchedProcessExited
    case folderOpenFailed

    var userMessage: String {
        switch self {
        case .applicationActive:
            return AppInstallationError(.destinationActive).userMessage
        case .processInspectionIncomplete:
            return AppInstallationError(.activityInspectionIncomplete).userMessage
        case .processInspectionUnavailable:
            return AppInstallationError(.activityInspectionUnavailable).userMessage
        case .invalidDestination:
            return "설치된 앱의 위치를 확인할 수 없습니다. 응용 프로그램 폴더에서 Blabee를 확인하세요."
        case .identityMismatch:
            return "설치된 앱의 무결성을 확인할 수 없습니다. 설치를 다시 확인하세요."
        case .runningIdentityMismatch:
            return "현재 실행 중인 Blabee를 확인할 수 없습니다. Blabee를 종료한 뒤 설치된 앱을 다시 열어 주세요."
        case .launchFailed:
            return "설치된 Blabee를 열지 못했습니다. 다시 시도하거나 Finder에서 직접 열어 주세요."
        case .launchTimedOut:
            return "앱 실행 확인 시간이 초과되었습니다. 설치된 앱은 유지됩니다. macOS 확인 창을 확인하거나 Finder에서 직접 열어 주세요."
        case .launchedApplicationMismatch:
            return "설치된 위치의 Blabee가 열렸는지 확인할 수 없습니다. Finder에서 설치된 앱을 직접 열어 주세요."
        case .launchedProcessExited:
            return "Blabee가 실행 확인 전에 종료되었습니다. 설치된 앱을 다시 열어 주세요."
        case .folderOpenFailed:
            return "Finder에서 폴더를 열지 못했습니다. 응용 프로그램 폴더를 직접 열어 주세요."
        }
    }

    var errorDescription: String? { userMessage }
}

enum AppInstallationProcessObservation: Equatable, Sendable {
    case running(executableURL: URL)
    case exited
    case unresolvedExecutable
    case unavailable
}

/// A read-only, bounded observation of user-space executable users, across all
/// UIDs. This is not a lock against an external launch after the observation.
/// It deliberately neither parses arguments/environment nor creates leases.
struct AppInstallationProcessGuard: Sendable {
    private let snapshot: @Sendable () throws -> [AppInstallationProcessObservation]

    init(
        snapshot: @escaping @Sendable () throws -> [AppInstallationProcessObservation]
            = { try AppInstallationProcessReader.live.snapshot() }
    ) {
        self.snapshot = snapshot
    }

    func requireInactive(_ appURL: URL) throws {
        guard appURL.isFileURL else { throw AppInstallationPlatformError.invalidDestination }
        let target = appURL.resolvingSymlinksInPath().standardizedFileURL.path
        let observations: [AppInstallationProcessObservation]
        do { observations = try snapshot() }
        catch { throw AppInstallationPlatformError.processInspectionUnavailable }
        var hasUnavailableEvidence = false
        var hasUnresolvedExecutable = false
        for observation in observations {
            switch observation {
            case .running(let executableURL):
                guard executableURL.isFileURL else {
                    hasUnavailableEvidence = true
                    continue
                }
                let path = executableURL.resolvingSymlinksInPath().standardizedFileURL.path
                if path == target || path.hasPrefix(target + "/") {
                    throw AppInstallationPlatformError.applicationActive
                }
            case .exited:
                break
            case .unresolvedExecutable:
                hasUnresolvedExecutable = true
            case .unavailable:
                hasUnavailableEvidence = true
            }
        }
        if hasUnavailableEvidence {
            throw AppInstallationPlatformError.processInspectionUnavailable
        }
        if hasUnresolvedExecutable {
            // Enumeration succeeded, but some live executable paths could not
            // be resolved (for example after another app unlinked an update).
            // Keep this distinct from being unable to enumerate processes.
            throw AppInstallationPlatformError.processInspectionIncomplete
        }
    }
}

/// Short BSD information and PIDPATHINFO intentionally support other users'
/// processes. Full PROC_PIDTBSDINFO is not used: it can reject unrelated system
/// processes solely because they belong to another UID.
struct AppInstallationProcessReader: Sendable {
    struct Token: Equatable, Sendable {
        let processID: Int32
        let parentProcessID: Int32
        let effectiveUserID: UInt32
    }

    enum State: Equatable, Sendable {
        case running(Token)
        case exited
        case unavailable
    }

    let processIDs: @Sendable () throws -> [Int32]
    let state: @Sendable (Int32) -> State
    let executableURL: @Sendable (Int32) -> URL?
    let protectedExecutableURL: @Sendable (Int32) -> URL?

    static let live = AppInstallationProcessReader(
        processIDs: liveProcessIDs,
        state: liveState,
        executableURL: liveExecutableURL,
        protectedExecutableURL: liveProtectedExecutableURL
    )

    func snapshot() throws -> [AppInstallationProcessObservation] {
        try Set(processIDs()).filter { $0 > 0 }.sorted().map(observe)
    }

    func observe(_ processID: Int32) -> AppInstallationProcessObservation {
        guard processID > 0 else { return .unavailable }
        var sawExecutable = false
        // Re-read the kernel path and process state to tolerate an exited PID
        // and retry a recycled PID or concurrent exec. No process-name or UID
        // heuristic exempts a live process whose executable remains unknown.
        for _ in 0..<3 {
            let before = state(processID)
            if before == .exited { return .exited }
            guard case .running(let token) = before,
                  token.processID == processID
            else { return .unavailable }
            let first = resolvedExecutableURL(processID)
            sawExecutable = sawExecutable || first != nil
            let middle = state(processID)
            if middle == .exited { return .exited }
            guard middle == before else { continue }
            let second = resolvedExecutableURL(processID)
            sawExecutable = sawExecutable || second != nil
            let after = state(processID)
            if after == .exited { return .exited }
            guard after == before else { continue }
            if first == nil, second == nil, !sawExecutable { return .unresolvedExecutable }
            guard let first, let second else { continue }
            guard first == second else { continue }
            return .running(executableURL: second)
        }
        return .unavailable
    }

    private func resolvedExecutableURL(_ processID: Int32) -> URL? {
        guard let url = executableURL(processID) ?? protectedExecutableURL(processID),
              url.isFileURL, !url.path.utf8.contains(0)
        else { return nil }
        return url.resolvingSymlinksInPath().standardizedFileURL
    }

    private static func liveProcessIDs() throws -> [Int32] {
        let stride = MemoryLayout<Int32>.stride
        let maximumCount = 65_536
        var requestedBytes = Int(proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0))
        guard requestedBytes > 0 else {
            throw AppInstallationPlatformError.processInspectionUnavailable
        }
        for _ in 0..<3 {
            let count = requestedBytes / stride + 256
            guard count <= maximumCount else {
                throw AppInstallationPlatformError.processInspectionUnavailable
            }
            var buffer = [Int32](repeating: 0, count: count)
            let returnedBytes = buffer.withUnsafeMutableBytes { bytes in
                proc_listpids(UInt32(PROC_ALL_PIDS), 0, bytes.baseAddress, Int32(bytes.count))
            }
            guard returnedBytes > 0, Int(returnedBytes) % stride == 0 else {
                throw AppInstallationPlatformError.processInspectionUnavailable
            }
            if Int(returnedBytes) < count * stride {
                return Array(buffer.prefix(Int(returnedBytes) / stride))
            }
            requestedBytes = count * stride * 2
        }
        throw AppInstallationPlatformError.processInspectionUnavailable
    }

    private static func liveState(_ processID: Int32) -> State {
        var info = proc_bsdshortinfo()
        let size = Int32(MemoryLayout<proc_bsdshortinfo>.stride)
        errno = 0
        let count = proc_pidinfo(processID, PROC_PIDT_SHORTBSDINFO, 0, &info, size)
        if count != size { return errno == ESRCH ? .exited : .unavailable }
        if info.pbsi_status == UInt32(SZOMB) { return .exited }
        guard let reportedID = Int32(exactly: info.pbsi_pid), reportedID == processID,
              let parentID = Int32(exactly: info.pbsi_ppid)
        else { return .unavailable }
        return .running(Token(
            processID: reportedID,
            parentProcessID: parentID,
            effectiveUserID: info.pbsi_uid
        ))
    }

    private static func liveExecutableURL(_ processID: Int32) -> URL? {
        // PROC_PIDPATHINFO_MAXSIZE is 4 * MAXPATHLEN and is not imported by
        // newer Swift SDKs. The existing runtime qualification uses the same bound.
        var buffer = [UInt8](repeating: 0, count: 4 * 1_024)
        let count = buffer.withUnsafeMutableBytes { bytes in
            proc_pidpath(processID, bytes.baseAddress, UInt32(bytes.count))
        }
        guard count > 0, let end = buffer.firstIndex(of: 0), end > 0,
              let path = String(bytes: buffer[..<end], encoding: .utf8),
              path.hasPrefix("/")
        else { return nil }
        return URL(fileURLWithPath: path)
    }

    private static func liveProtectedExecutableURL(_ processID: Int32) -> URL? {
        // Some platform policy can deny libproc path inspection. A dynamic
        // Security guest object can still identify its exact executable; never
        // infer the executable from a process name or a static code object.
        var code: SecCode?
        let attributes = [kSecGuestAttributePid: NSNumber(value: processID)] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &code)
                == errSecSuccess, let code,
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess
        else { return nil }
        var information: CFDictionary?
        let dynamicCode = unsafeBitCast(code, to: SecStaticCode.self)
        guard SecCodeCopySigningInformation(dynamicCode, SecCSFlags(), &information)
                == errSecSuccess,
              let dictionary = information as? [CFString: Any],
              let url = dictionary[kSecCodeInfoMainExecutable] as? URL,
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess
        else { return nil }
        return url
    }
}

struct AppInstallationRunningApplication: Sendable {
    struct Snapshot: Equatable, Sendable {
        let processID: Int32
        let bundleURL: URL?
        let executableURL: URL?
        let isTerminated: Bool
        let isFinishedLaunching: Bool
    }

    let snapshot: @MainActor @Sendable () -> Snapshot
}

@MainActor
protocol AppInstallationWorkspaceOpening {
    func openApplication(
        at applicationURL: URL,
        configuration: NSWorkspace.OpenConfiguration,
        completion: @escaping @MainActor @Sendable (
            Result<AppInstallationRunningApplication, AppInstallationPlatformError>
        ) -> Void
    )
    func showInFinder(_ folderURL: URL) -> Bool
}

@MainActor
private struct AppInstallationLiveWorkspace: AppInstallationWorkspaceOpening {
    func openApplication(
        at applicationURL: URL,
        configuration: NSWorkspace.OpenConfiguration,
        completion: @escaping @MainActor @Sendable (
            Result<AppInstallationRunningApplication, AppInstallationPlatformError>
        ) -> Void
    ) {
        NSWorkspace.shared.openApplication(at: applicationURL, configuration: configuration) {
            application, error in
            Task { @MainActor in
                guard error == nil, let application else {
                    completion(.failure(.launchFailed))
                    return
                }
                completion(.success(AppInstallationRunningApplication(snapshot: {
                    .init(
                        processID: application.processIdentifier,
                        bundleURL: application.bundleURL,
                        executableURL: application.executableURL,
                        isTerminated: application.isTerminated,
                        isFinishedLaunching: application.isFinishedLaunching
                    )
                })))
            }
        }
    }

    func showInFinder(_ folderURL: URL) -> Bool {
        // A recovery URL may itself be an .app directory. Opening that URL
        // would execute the backup; reveal/select it in Finder instead.
        NSWorkspace.shared.activateFileViewerSelecting([folderURL])
        return true
    }
}

/// Opening success proves an app launch, not service or Hook readiness. A
/// timeout can race a delayed launch or a macOS confirmation panel, so this
/// helper never rolls back, deletes an app, or accepts a confirmation panel.
@MainActor
final class AppInstallationApplicationOpener {
    private let workspace: any AppInstallationWorkspaceOpening
    private let installedIdentity: (URL) -> String?
    private let runningIdentity: (Int32, URL) -> String?
    private let processObservation: @Sendable (Int32) -> AppInstallationProcessObservation
    private let timeout: Duration
    private let pollInterval: Duration

    init(
        workspace: any AppInstallationWorkspaceOpening = AppInstallationLiveWorkspace(),
        installedIdentity: @escaping (URL) -> String?
            = OperationalRuntimeIdentity.installedIdentity(forExecutable:),
        runningIdentity: @escaping (Int32, URL) -> String? = liveRunningIdentity,
        processObservation: @escaping @Sendable (Int32) -> AppInstallationProcessObservation
            = { AppInstallationProcessReader.live.observe($0) },
        timeout: Duration = .seconds(15),
        pollInterval: Duration = .milliseconds(100)
    ) {
        self.workspace = workspace
        self.installedIdentity = installedIdentity
        self.runningIdentity = runningIdentity
        self.processObservation = processObservation
        self.timeout = timeout
        self.pollInterval = pollInterval
    }

    func openInstalled(applicationURL: URL, expectedIdentity: String) async throws {
        guard applicationURL.isFileURL, applicationURL.pathExtension.lowercased() == "app",
              timeout > .zero, pollInterval > .zero
        else { throw AppInstallationPlatformError.invalidDestination }
        let destination = applicationURL.resolvingSymlinksInPath().standardizedFileURL
        let executable = destination.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        try requireIdentity(expectedIdentity, executable: executable)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.allowsRunningApplicationSubstitution = false
        configuration.activates = true
        configuration.arguments = ["installed-pet"]
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        let application = try await requestLaunch(
            destination, configuration: configuration, deadline: deadline
        )
        while clock.now < deadline {
            try Task.checkCancellation()
            let snapshot = application.snapshot()
            if snapshot.isTerminated { throw AppInstallationPlatformError.launchedProcessExited }
            guard snapshot.processID > 0,
                  canonical(snapshot.bundleURL) == destination,
                  canonical(snapshot.executableURL) == executable
            else { throw AppInstallationPlatformError.launchedApplicationMismatch }
            switch processObservation(snapshot.processID) {
            case .running(let url):
                guard canonical(url) == executable else {
                    throw AppInstallationPlatformError.launchedApplicationMismatch
                }
            case .exited:
                throw AppInstallationPlatformError.launchedProcessExited
            case .unavailable, .unresolvedExecutable:
                throw AppInstallationPlatformError.processInspectionUnavailable
            }
            if snapshot.isFinishedLaunching {
                try requireIdentity(expectedIdentity, executable: executable)
                guard runningIdentity(snapshot.processID, executable) == expectedIdentity else {
                    throw AppInstallationPlatformError.runningIdentityMismatch
                }
                return
            }
            try await clock.sleep(until: min(clock.now.advanced(by: pollInterval), deadline))
        }
        throw AppInstallationPlatformError.launchTimedOut
    }

    /// Call only in response to the user's Finder button; initialization and
    /// installation do not open a folder automatically.
    func showInFinder(_ folderURL: URL) throws {
        var isDirectory: ObjCBool = false
        guard folderURL.isFileURL,
              FileManager.default.fileExists(atPath: folderURL.path, isDirectory: &isDirectory),
              isDirectory.boolValue, workspace.showInFinder(folderURL)
        else { throw AppInstallationPlatformError.folderOpenFailed }
    }

    private func requireIdentity(_ expected: String, executable: URL) throws {
        guard OperationalRuntimeIdentity.isValid(expected),
              canonical(executable) == executable,
              installedIdentity(executable) == expected
        else { throw AppInstallationPlatformError.identityMismatch }
    }

    private func canonical(_ url: URL?) -> URL? {
        guard let url, url.isFileURL else { return nil }
        return url.resolvingSymlinksInPath().standardizedFileURL
    }

    private nonisolated static func liveRunningIdentity(_ processID: Int32, _ executable: URL) -> String? {
        guard let before = runningSignatureEvidence(processID) else { return nil }
        let verifier = OperationalCodeSignatureVerifier(
            runningCode: { before },
            installedCode: OperationalCodeSignatureVerifier.live.installedCode
        )
        let identity = OperationalRuntimeIdentity.resolveSnapshot(
            executableURL: executable, environment: [:], signatureVerifier: verifier
        )?.runtimeIdentity
        // The disk bundle may have been replaced at the same pathname while
        // an older process remained alive. Bind launch success to its dynamic
        // signature, and re-read that guest after the installed comparison.
        guard runningSignatureEvidence(processID) == before else { return nil }
        return identity
    }

    private nonisolated static func runningSignatureEvidence(
        _ processID: Int32
    ) -> OperationalCodeSignatureEvidence? {
        guard processID > 0 else { return nil }
        var code: SecCode?
        let attributes = [kSecGuestAttributePid: NSNumber(value: processID)] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &code)
                == errSecSuccess, let code,
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess
        else { return nil }
        let dynamicCode = unsafeBitCast(code, to: SecStaticCode.self)
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(dynamicCode, SecCSFlags(), &information)
                == errSecSuccess,
              let dictionary = information as? [CFString: Any],
              let identifier = dictionary[kSecCodeInfoIdentifier] as? String,
              let cdHash = dictionary[kSecCodeInfoUnique] as? Data,
              let executableURL = dictionary[kSecCodeInfoMainExecutable] as? URL,
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess
        else { return nil }
        return OperationalCodeSignatureEvidence(
            identifier: identifier, cdHash: cdHash, executableURL: executableURL
        )
    }

    private func requestLaunch(
        _ url: URL,
        configuration: NSWorkspace.OpenConfiguration,
        deadline: ContinuousClock.Instant
    ) async throws -> AppInstallationRunningApplication {
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            let completion = LaunchCompletion(continuation)
            completion.timeoutTask = Task { @MainActor in
                do { try await ContinuousClock().sleep(until: deadline) }
                catch { return }
                completion.finish(.failure(.launchTimedOut))
            }
            workspace.openApplication(at: url, configuration: configuration) { result in
                completion.finish(result)
            }
        }
    }

    @MainActor
    private final class LaunchCompletion {
        private var continuation: CheckedContinuation<AppInstallationRunningApplication, any Error>?
        var timeoutTask: Task<Void, Never>?

        init(_ continuation: CheckedContinuation<AppInstallationRunningApplication, any Error>) {
            self.continuation = continuation
        }

        func finish(_ result: Result<AppInstallationRunningApplication, AppInstallationPlatformError>) {
            guard let continuation else { return }
            self.continuation = nil
            timeoutTask?.cancel()
            timeoutTask = nil
            continuation.resume(with: result.mapError { $0 as any Error })
        }
    }
}

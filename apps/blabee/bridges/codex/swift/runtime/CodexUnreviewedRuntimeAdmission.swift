import CoordinatorSwift
import Darwin
import Foundation

/// Decides whether a session run by an OpenAI-signed Codex that is not
/// registered may use Blabee's basic features (suggestion cards and next-turn
/// delivery). Design: docs/features/CODEX_UNREVIEWED_VERSION_DESIGN.md.
///
/// The verdict only chooses whether a session is turned on and what the Pet
/// says. It grants nothing: delivery qualifies its executable again every
/// time, command approval still needs a registered CDHash, and the path the
/// Hook reported is never executed unless the ordinary native qualification
/// (path safety, OpenAI signature, notarization, version rule) accepts it.
final class CodexUnreviewedRuntimeAdmission: @unchecked Sendable {
    enum Verdict: Equatable, Sendable {
        /// The session's own Codex passed the same qualification delivery uses.
        case eligible
        /// The session's Codex has a version Blabee does not accept.
        case ineligible
        /// Not known yet, or not knowable for this file right now.
        case undetermined
    }

    /// Blocking qualification of the Codex a Hook reported. Runs only on the
    /// scheduler, never on the caller of `verdict(forExecutablePath:)`.
    /// `nil` means the file could not be examined right now (the failure guard
    /// was busy): nothing is remembered and the next request asks again.
    typealias Check = @Sendable (_ hookExecutablePath: String) -> Verdict?

    enum CandidateOutcome: Equatable, Sendable {
        case qualified(canonicalPath: String)
        case failed(code: String)
    }

    /// Only a version answer is final. Every other failure (path, signature,
    /// notarization lookup, timeouts, launch problems) may differ later and
    /// must not show "unsupported version".
    static let versionRejectionCodes: Set<String> = [
        CodexNativeDiagnostic.versionUnqualified.rawValue,
        CodexNativeDiagnostic.probeOutputInvalid.rawValue,
    ]
    /// The failure guard waits at most two seconds for another check or a
    /// delivery. Treating that as an answer would keep a session off for the
    /// whole recheck interval.
    static let busyCodes: Set<String> = [
        CodexNativeDiagnostic.executionInProgress.rawValue,
        CodexNativeDiagnostic.guardUnavailable.rawValue,
    ]

    /// The failure guard's lifetime for environmental failures.
    static let defaultRecheckNanoseconds: UInt64 = 600 * 1_000_000_000
    static let maximumEntries = 32

    private struct Entry {
        var verdict: Verdict
        var checkedAt: UInt64
    }

    private let check: Check
    private let fileKey: @Sendable (String) -> String?
    private let now: @Sendable () -> UInt64
    private let schedule: @Sendable (@escaping @Sendable () -> Void) -> Void
    private let recheckNanoseconds: UInt64

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    /// Insertion order, oldest first, for the size bound.
    private var order: [String] = []
    private var inFlight: Set<String> = []

    init(
        check: @escaping Check = CodexUnreviewedRuntimeAdmission.liveCheck,
        fileKey: @escaping @Sendable (String) -> String? = {
            CodexNotarizationCache.key(for: URL(fileURLWithPath: $0, isDirectory: false))
        },
        now: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
        schedule: @escaping @Sendable (@escaping @Sendable () -> Void) -> Void = { work in
            DispatchQueue.global(qos: .utility).async(execute: work)
        },
        recheckNanoseconds: UInt64 = CodexUnreviewedRuntimeAdmission.defaultRecheckNanoseconds
    ) {
        self.check = check
        self.fileKey = fileKey
        self.now = now
        self.schedule = schedule
        self.recheckNanoseconds = recheckNanoseconds
    }

    /// Never blocks and never runs the check inline. An eligible file stays
    /// eligible until the file changes; any other answer is examined again no
    /// more often than the recheck interval, one check per file at a time.
    func verdict(forExecutablePath path: String?) -> Verdict {
        guard let path, let safePath = CodexSessionRuntimeHint.safeAbsolutePath(path),
              let key = fileKey(safePath)
        else { return .undetermined }

        let instant = now()
        lock.lock()
        let entry = entries[key]
        let isDue = entry.map {
            $0.verdict != .eligible && instant >= $0.checkedAt
                && instant - $0.checkedAt >= recheckNanoseconds
        } ?? true
        let startsCheck = isDue && inFlight.insert(key).inserted
        lock.unlock()

        if startsCheck {
            schedule { [self] in runCheck(path: safePath, key: key) }
        }
        return entry?.verdict ?? .undetermined
    }

    private func runCheck(path: String, key: String) {
        let verdict = check(path)
        // The answer describes the file that was examined. If it was replaced
        // meanwhile, drop it; the new file is checked on the next request.
        let unchanged = fileKey(path) == key
        let instant = now()
        lock.lock()
        defer { lock.unlock() }
        inFlight.remove(key)
        guard unchanged, let verdict else { return }
        if entries.updateValue(Entry(verdict: verdict, checkedAt: instant), forKey: key) == nil {
            order.append(key)
            if order.count > Self.maximumEntries {
                entries.removeValue(forKey: order.removeFirst())
            }
        }
    }

    /// Judges the Codex that ran the Hook through every path that is that same
    /// file, in delivery order: the reported path first, then the fixed
    /// candidates. On Homebrew the kernel path lies under the group-writable
    /// Caskroom and is refused as unsafe, while `/opt/homebrew/bin/codex`
    /// reaches the same file through the monitored symlink; its answer, not
    /// the first failure, is the answer for this Codex. A candidate that is a
    /// different file (another install) says nothing about the session.
    static func verdict(
        hookExecutablePath: String,
        candidates: [String],
        fileIdentity: (String) -> String?,
        qualify: (String) -> CandidateOutcome
    ) -> Verdict? {
        guard let hookIdentity = fileIdentity(hookExecutablePath) else { return .undetermined }
        var examined: Set<String> = []
        var versionRejected = false
        for candidate in [hookExecutablePath] + candidates
        where examined.insert(candidate).inserted && fileIdentity(candidate) == hookIdentity {
            switch qualify(candidate) {
            case .qualified(let canonicalPath):
                return fileIdentity(canonicalPath) == hookIdentity ? .eligible : .undetermined
            case .failed(let code):
                if busyCodes.contains(code) { return nil }
                if versionRejectionCodes.contains(code) { versionRejected = true }
            }
        }
        return versionRejected ? .ineligible : .undetermined
    }

    /// Device and inode of the regular file a path leads to (symlinks
    /// followed). Exact for hard links, case variants and normalization, where
    /// comparing path strings is not.
    static func liveFileIdentity(_ path: String) -> String? {
        var info = stat()
        guard stat(path, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else { return nil }
        return "\(info.st_dev):\(info.st_ino)"
    }

    static let liveCheck: Check = { liveVerdict(hookExecutablePath: $0) }

    /// `runtime` and `observer` exist for the opt-in installed-runtime
    /// verification, which uses isolated failure records.
    static func liveVerdict(
        hookExecutablePath path: String,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        runtime: (URL, [String: String]) -> CodexNativeRuntime = {
            CodexNativeRuntime.live(explicitExecutableURL: $0, environment: $1)
        },
        observer: (String, CandidateOutcome) -> Void = { _, _ in }
    ) -> Verdict? {
        verdict(
            hookExecutablePath: path,
            candidates: CodexPluginSetupExecutableResolver.candidateURLs(environment: environment).map(\.path),
            fileIdentity: liveFileIdentity,
            qualify: { candidate in
                let outcome: CandidateOutcome
                do {
                    let selection = try runtime(URL(fileURLWithPath: candidate, isDirectory: false), environment)
                        .qualify(timeoutMilliseconds: 10_000)
                    outcome = .qualified(canonicalPath: selection.canonicalURL.path)
                } catch {
                    outcome = .failed(code: error.coordinatorError.code)
                }
                observer(candidate, outcome)
                return outcome
            }
        )
    }
}

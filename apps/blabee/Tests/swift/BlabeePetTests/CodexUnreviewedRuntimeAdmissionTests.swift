import Foundation
import Testing
@testable import BlabeeCoordinator

/// Deterministic collaborators: the test decides when a scheduled check runs,
/// what the clock says and which file identity a path currently has.
private final class AdmissionHarness: @unchecked Sendable {
    typealias Verdict = CodexUnreviewedRuntimeAdmission.Verdict
    private let lock = NSLock()
    private var pending: [@Sendable () -> Void] = []
    private var clock: UInt64 = 1_000
    private var keys: [String: String] = [:]
    private var answers: [String: Verdict] = [:]
    private var busy: Set<String> = []
    private var checked: [String] = []
    private var duringCheck: (@Sendable () -> Void)?

    func makeStore(recheckNanoseconds: UInt64 = 100) -> CodexUnreviewedRuntimeAdmission {
        CodexUnreviewedRuntimeAdmission(
            check: { [self] path in
                let (answer, hook) = lock.withLock { () -> (Verdict?, (@Sendable () -> Void)?) in
                    checked.append(path)
                    return (busy.contains(path) ? nil : answers[path] ?? .undetermined, duringCheck)
                }
                hook?()
                return answer
            },
            fileKey: { [self] path in lock.withLock { keys[path] } },
            now: { [self] in lock.withLock { clock } },
            schedule: { [self] work in lock.withLock { pending.append(work) } },
            recheckNanoseconds: recheckNanoseconds
        )
    }

    func setFile(_ path: String, key: String?, answer: Verdict = .undetermined) {
        lock.withLock { keys[path] = key; answers[path] = answer }
    }
    func setAnswer(_ path: String, _ answer: Verdict) { lock.withLock { answers[path] = answer } }
    func setBusy(_ path: String, _ isBusy: Bool) { lock.withLock { if isBusy { busy.insert(path) } else { busy.remove(path) } } }
    func setKey(_ path: String, _ key: String?) { lock.withLock { keys[path] = key } }
    func advance(_ nanoseconds: UInt64) { lock.withLock { clock += nanoseconds } }
    func onCheck(_ hook: (@Sendable () -> Void)?) { lock.withLock { duringCheck = hook } }
    var scheduledCount: Int { lock.withLock { pending.count } }
    var checkedPaths: [String] { lock.withLock { checked } }

    /// Runs every check scheduled so far and returns how many ran.
    @discardableResult
    func runScheduled() -> Int {
        let work = lock.withLock { () -> [@Sendable () -> Void] in
            defer { pending.removeAll() }
            return pending
        }
        work.forEach { $0() }
        return work.count
    }
}

@Suite("Unreviewed Codex runtime admission")
struct CodexUnreviewedRuntimeAdmissionTests {
    private let codex = "/opt/codex/0.172.0/bin/codex"

    @Test("an unknown file is undetermined and checked once, never inline")
    func unknownFileIsUndeterminedAndCheckedOnce() {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: .eligible)
        let store = harness.makeStore()

        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        #expect(harness.checkedPaths.isEmpty)
        #expect(harness.scheduledCount == 1)
        // A check that has not returned must not pile up further checks.
        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        harness.advance(1_000_000)
        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        #expect(harness.scheduledCount == 1)
    }

    @Test("an eligible file is remembered for the life of the store")
    func eligibleIsRemembered() {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: .eligible)
        let store = harness.makeStore()
        _ = store.verdict(forExecutablePath: codex)
        #expect(harness.runScheduled() == 1)

        #expect(store.verdict(forExecutablePath: codex) == .eligible)
        harness.advance(10_000)
        #expect(store.verdict(forExecutablePath: codex) == .eligible)
        #expect(harness.scheduledCount == 0)
        #expect(harness.checkedPaths == [codex])
    }

    @Test("other verdicts are checked again only after the interval",
          arguments: [CodexUnreviewedRuntimeAdmission.Verdict.ineligible, .undetermined])
    func otherVerdictsAreRecheckedAfterTheInterval(first: CodexUnreviewedRuntimeAdmission.Verdict) {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: first)
        let store = harness.makeStore(recheckNanoseconds: 100)
        _ = store.verdict(forExecutablePath: codex)
        harness.runScheduled()

        #expect(store.verdict(forExecutablePath: codex) == first)
        harness.advance(99)
        #expect(store.verdict(forExecutablePath: codex) == first)
        #expect(harness.scheduledCount == 0)

        harness.advance(1)
        harness.setAnswer(codex, .eligible)
        // The stale answer is still returned while the new check runs.
        #expect(store.verdict(forExecutablePath: codex) == first)
        #expect(store.verdict(forExecutablePath: codex) == first)
        #expect(harness.scheduledCount == 1)
        harness.runScheduled()
        #expect(store.verdict(forExecutablePath: codex) == .eligible)
        #expect(harness.checkedPaths == [codex, codex])
    }

    @Test("a replaced file is checked again instead of reusing its old verdict")
    func changedFileIsCheckedAgain() {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: .eligible)
        let store = harness.makeStore()
        _ = store.verdict(forExecutablePath: codex)
        harness.runScheduled()
        #expect(store.verdict(forExecutablePath: codex) == .eligible)

        harness.setFile(codex, key: "k2", answer: .ineligible)
        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        #expect(harness.runScheduled() == 1)
        #expect(store.verdict(forExecutablePath: codex) == .ineligible)
    }

    @Test("a missing, unreadable or unsafe path is undetermined without any check")
    func missingOrUnsafePathIsUndeterminedWithoutACheck() {
        let harness = AdmissionHarness()
        harness.setFile("/gone/codex", key: nil, answer: .eligible)
        harness.setFile("relative/codex", key: "k", answer: .eligible)
        harness.setFile("/a/../b/codex", key: "k", answer: .eligible)
        harness.setFile("/a/./codex", key: "k", answer: .eligible)
        let store = harness.makeStore()

        for path in [nil, "", "/gone/codex", "relative/codex", "/a/../b/codex", "/a/./codex", "/nul\u{0}/codex",
                     "/" + String(repeating: "a", count: 4_096)] as [String?] {
            #expect(store.verdict(forExecutablePath: path) == .undetermined)
        }
        #expect(harness.scheduledCount == 0)
        #expect(harness.checkedPaths.isEmpty)
    }

    @Test("a result for a file that changed during its check is discarded")
    func resultOfAChangedFileIsDiscarded() {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: .eligible)
        let store = harness.makeStore()
        _ = store.verdict(forExecutablePath: codex)
        harness.onCheck { harness.setKey("/opt/codex/0.172.0/bin/codex", "k2") }
        harness.runScheduled()
        harness.onCheck(nil)

        // Neither identity is eligible: the new one is unknown and checked afresh.
        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        #expect(harness.scheduledCount == 1)
        harness.setKey(codex, "k1")
        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
    }

    @Test("remembered files are bounded and the oldest is forgotten first")
    func entriesAreBounded() {
        let harness = AdmissionHarness()
        let store = harness.makeStore()
        let paths = (0...CodexUnreviewedRuntimeAdmission.maximumEntries).map { "/opt/codex/\($0)/bin/codex" }
        for (index, path) in paths.enumerated() {
            harness.setFile(path, key: "k\(index)", answer: .eligible)
            _ = store.verdict(forExecutablePath: path)
            harness.runScheduled()
            #expect(store.verdict(forExecutablePath: path) == .eligible)
        }
        #expect(store.verdict(forExecutablePath: paths[0]) == .undetermined)
        #expect(store.verdict(forExecutablePath: paths[paths.count - 1]) == .eligible)
    }

    @Test("a check that could not examine the file is asked again on the next request, not after the interval")
    func busyCheckIsRetriedOnTheNextRequest() {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: .eligible)
        harness.setBusy(codex, true)
        let store = harness.makeStore(recheckNanoseconds: 1_000_000)

        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        #expect(harness.runScheduled() == 1)
        // Nothing was learned, so nothing is remembered: the very next request tries again.
        #expect(store.verdict(forExecutablePath: codex) == .undetermined)
        #expect(harness.scheduledCount == 1)
        harness.setBusy(codex, false)
        harness.runScheduled()
        #expect(store.verdict(forExecutablePath: codex) == .eligible)
        #expect(harness.checkedPaths == [codex, codex])
    }

    @Test("a busy recheck keeps the earlier answer and stays due")
    func busyRecheckKeepsTheEarlierAnswer() {
        let harness = AdmissionHarness()
        harness.setFile(codex, key: "k1", answer: .ineligible)
        let store = harness.makeStore(recheckNanoseconds: 100)
        _ = store.verdict(forExecutablePath: codex)
        harness.runScheduled()
        #expect(store.verdict(forExecutablePath: codex) == .ineligible)

        harness.advance(100)
        harness.setBusy(codex, true)
        #expect(store.verdict(forExecutablePath: codex) == .ineligible)
        #expect(harness.runScheduled() == 1)
        #expect(store.verdict(forExecutablePath: codex) == .ineligible)
        #expect(harness.scheduledCount == 1)
    }
}

/// The session's Codex is judged through every candidate path that is the
/// same file, in delivery order; other installs say nothing about it.
@Suite("Unreviewed Codex candidate evaluation")
struct CodexUnreviewedRuntimeCandidateTests {
    private typealias Admission = CodexUnreviewedRuntimeAdmission
    private let hook = "/opt/homebrew/Caskroom/codex/0.172.0/bin/codex"
    private let homebrew = "/opt/homebrew/bin/codex"
    private let other = "/usr/local/bin/codex"

    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var paths: [String] = []
        func record(_ path: String) { lock.withLock { paths.append(path) } }
        var recorded: [String] { lock.withLock { paths } }
    }

    private func evaluate(
        identities: [String: String], outcomes: [String: Admission.CandidateOutcome], calls: Calls = Calls(),
        candidates: [String]? = nil
    ) -> Admission.Verdict? {
        Admission.verdict(
            hookExecutablePath: hook, candidates: candidates ?? [homebrew, other],
            fileIdentity: { identities[$0] },
            qualify: { path in
                calls.record(path)
                return outcomes[path] ?? .failed(code: "codex_native_not_installed")
            }
        )
    }

    private var sameFile: [String: String] { [hook: "1:10", homebrew: "1:10", other: "1:99"] }

    @Test("Homebrew: the Caskroom path is unsafe on its own but the monitored symlink qualifies the same file")
    func homebrewNewerVersionIsEligible() {
        let calls = Calls()
        let verdict = evaluate(identities: sameFile, outcomes: [
            hook: .failed(code: "codex_native_path_unsafe"),
            homebrew: .qualified(canonicalPath: hook),
            other: .qualified(canonicalPath: "/usr/local/Cellar/codex/bin/codex"),
        ], calls: calls)
        #expect(verdict == .eligible)
        #expect(calls.recorded == [hook, homebrew])
    }

    @Test("Homebrew: a version rejection found through the symlink is not hidden by the unsafe Caskroom path",
          arguments: ["codex_native_version_unqualified", "codex_native_probe_output_invalid"])
    func homebrewRejectedVersionIsIneligible(code: String) {
        let verdict = evaluate(identities: sameFile, outcomes: [
            hook: .failed(code: "codex_native_path_unsafe"), homebrew: .failed(code: code),
        ])
        #expect(verdict == .ineligible)
    }

    @Test("another install that qualifies says nothing about the session's own Codex")
    func otherInstallIsNotConsulted() {
        let calls = Calls()
        let verdict = evaluate(identities: [hook: "1:10", homebrew: "1:99", other: "1:98"], outcomes: [
            hook: .failed(code: "codex_native_probe_output_invalid"),
            homebrew: .qualified(canonicalPath: "/opt/homebrew/Caskroom/codex/0.171.0/bin/codex"),
        ], calls: calls)
        #expect(verdict == .ineligible)
        #expect(calls.recorded == [hook])
    }

    @Test("a busy failure guard or storage means not examined, and stops at once",
          arguments: ["codex_native_execution_in_progress", "codex_native_guard_unavailable"])
    func busyIsNotAVerdict(code: String) {
        let calls = Calls()
        let verdict = evaluate(identities: sameFile, outcomes: [
            hook: .failed(code: code), homebrew: .qualified(canonicalPath: hook),
        ], calls: calls)
        #expect(verdict == nil)
        #expect(calls.recorded == [hook])
    }

    @Test("failures that are neither a version answer nor busy leave the verdict undetermined")
    func otherFailuresAreUndetermined() {
        let other = CodexNativeDiagnostic.allCases.map(\.rawValue).filter {
            !Admission.versionRejectionCodes.contains($0) && !Admission.busyCodes.contains($0)
        } + ["something_new"]
        #expect(other.count == CodexNativeDiagnostic.allCases.count - 3)
        for code in other {
            let verdict = evaluate(identities: sameFile, outcomes: [
                hook: .failed(code: "codex_native_path_unsafe"), homebrew: .failed(code: code),
            ])
            #expect(verdict == .undetermined, "\(code)")
        }
        #expect(Admission.versionRejectionCodes == ["codex_native_version_unqualified", "codex_native_probe_output_invalid"])
        #expect(Admission.busyCodes == ["codex_native_execution_in_progress", "codex_native_guard_unavailable"])
    }

    @Test("a hook path that is not a file, a qualified file that is another file, and repeated candidates")
    func edges() {
        let calls = Calls()
        #expect(evaluate(identities: [homebrew: "1:10"], outcomes: [homebrew: .qualified(canonicalPath: hook)],
                         calls: calls) == .undetermined)
        #expect(calls.recorded.isEmpty)

        // Qualification resolved to a different file than the one running the session.
        #expect(evaluate(identities: [hook: "1:10", "/elsewhere/codex": "1:11"],
                         outcomes: [hook: .qualified(canonicalPath: "/elsewhere/codex")]) == .undetermined)

        let repeated = Calls()
        #expect(evaluate(identities: sameFile, outcomes: [
            hook: .failed(code: "codex_native_path_unsafe"), homebrew: .failed(code: "codex_native_signature_invalid"),
        ], calls: repeated, candidates: [hook, homebrew, homebrew]) == .undetermined)
        #expect(repeated.recorded == [hook, homebrew])
    }

    @Test("the background check allows as long as the other native qualifications do")
    func liveQualificationTimeout() {
        // A shorter limit times out first on a cold start, and that failure is
        // cached for ten minutes for delivery and the Pet's own check too.
        #expect(CodexUnreviewedRuntimeAdmission.liveQualificationTimeoutMilliseconds >= 15_000)
    }

    @Test("the live file identity follows symlinks and tells files apart")
    func liveFileIdentity() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-admission-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("codex"), link = root.appendingPathComponent("link")
        let second = root.appendingPathComponent("second")
        try Data("a".utf8).write(to: file)
        try Data("a".utf8).write(to: second)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)

        let identity = try #require(Admission.liveFileIdentity(file.path))
        #expect(Admission.liveFileIdentity(link.path) == identity)
        #expect(Admission.liveFileIdentity(second.path) != identity)
        #expect(Admission.liveFileIdentity(root.path) == nil)
        #expect(Admission.liveFileIdentity(root.appendingPathComponent("missing").path) == nil)
    }
}

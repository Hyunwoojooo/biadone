import Foundation

/// The Codex executable and CODEX_HOME a session's own Hook observed (audit
/// CDX-6). The executable comes only from the Hook's signed-ancestry check of
/// an OpenAI-signed Codex, registered or not, in a session that is on. It is
/// a preference, never a trust grant: delivery still qualifies it like any
/// discovered candidate. CODEX_HOME is the Hook's unverified configuration
/// value (wrappers need it too); it only selects the Codex configuration the
/// same user could already edit.
struct CodexSessionRuntimeHint: Sendable, Equatable {
    let executablePath: String?
    let codexHome: String?

    init?(executablePath: String?, codexHome: String?) {
        let executablePath = executablePath.flatMap(Self.safeAbsolutePath)
        let codexHome = codexHome.flatMap(Self.safeAbsolutePath)
        guard executablePath != nil || codexHome != nil else { return nil }
        self.executablePath = executablePath
        self.codexHome = codexHome
    }

    static func safeAbsolutePath(_ value: String) -> String? {
        guard value.hasPrefix("/"), value.utf8.count <= 4_096, !value.contains("\0"),
              !value.split(separator: "/").contains(where: { $0 == ".." || $0 == "." })
        else { return nil }
        return value
    }
}

/// Bounded, in-memory only. A service restart forgets hints until the next
/// SessionStart or prompt, and delivery then uses the fixed candidate list.
final class CodexSessionRuntimeHints: @unchecked Sendable {
    static let maximumSessions = 1_024

    private let lock = NSLock()
    private var hints: [String: CodexSessionRuntimeHint] = [:]
    private var order: [String] = []

    /// Field-wise: a later report without an attested executable (for example
    /// an unreadable lineage) keeps the one already recorded.
    func record(sessionID: String, hint: CodexSessionRuntimeHint) {
        lock.lock()
        defer { lock.unlock() }
        let merged = hints[sessionID].flatMap {
            CodexSessionRuntimeHint(executablePath: hint.executablePath ?? $0.executablePath,
                                    codexHome: hint.codexHome ?? $0.codexHome)
        } ?? hint
        if hints.updateValue(merged, forKey: sessionID) == nil {
            order.append(sessionID)
            if order.count > Self.maximumSessions {
                hints.removeValue(forKey: order.removeFirst())
            }
        }
    }

    func hint(for sessionID: String) -> CodexSessionRuntimeHint? {
        lock.lock()
        defer { lock.unlock() }
        return hints[sessionID]
    }
}

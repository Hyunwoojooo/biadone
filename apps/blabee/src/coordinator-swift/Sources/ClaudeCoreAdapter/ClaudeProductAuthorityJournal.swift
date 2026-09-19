import CoordinatorSwift
import Foundation

/// Admission checks for the product adapter's isolated journal. The concrete
/// journal MUST also install the same authority's final append-commit gate.
/// This wrapper deliberately does not hold the authority lock around journal
/// preparation, and never nests a second fence around that concrete gate.
final class ClaudeProductAuthorityJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let journal: any CoordinatorSemanticJournalPort
    private let authority: ClaudeSessionAuthority

    init(journal: any CoordinatorSemanticJournalPort, authority: ClaudeSessionAuthority) {
        self.journal = journal
        self.authority = authority
    }

    func load() throws -> JournalSnapshot {
        try authorize()
        return try journal.load()
    }

    func append(expectedSequence: Int64, events: [Data], documents: [Data],
                verificationRecords: [Data]) throws -> JournalAppendResult {
        try authorize()
        return try journal.append(expectedSequence: expectedSequence, events: events,
            documents: documents, verificationRecords: verificationRecords)
    }

    private func authorize() throws {
        do { _ = try authority.authorize(identity: authority.identity) }
        catch { throw CoordinatorError("claude_bridge_unauthorized") }
    }
}

import CoordinatorSwift
import Foundation

/// Provider metadata namespaces. These are audit identifiers, never tokens or
/// restorable execution grants. Existing core/v1 journal contracts are unchanged.
public enum ClaudeReplayKind: String, Sendable, CaseIterable {
    case prompt, proposal, selection
    case hookRequest = "hook_request"
}

public struct ClaudeReplayKey: Sendable, Equatable {
    public let kind: ClaudeReplayKind
    public let id: String

    public init(kind: ClaudeReplayKind, id: String) throws {
        if kind == .proposal {
            // Match the existing proposal text grammar. Whitespace within a
            // nonblank ID is meaningful and remains part of the replay key.
            guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  id.utf8.count <= 256, !id.contains("\0"),
                  id == id.precomposedStringWithCanonicalMapping else {
                throw CoordinatorError("claude_replay_key_invalid")
            }
        } else {
            guard let value = UUID(uuidString: id), value.uuidString.lowercased() == id else {
                throw CoordinatorError("claude_replay_key_invalid")
            }
        }
        self.kind = kind
        self.id = id
    }
}

/// Synchronous scope-bound admission into authenticated provider metadata.
/// The registry fixes scope/authority/storage when constructing this port.
/// Implementations atomically consume a new key and operation ID before native
/// state advances; a duplicate throws `claude_metadata_replay`. Storage failure
/// must fail closed. No response retry, authority restoration or secret storage.
public protocol ClaudeNativeReplayPort: Sendable {
    func consume(_ key: ClaudeReplayKey, operationID: UUID) throws
}

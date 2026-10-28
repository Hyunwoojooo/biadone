import CoordinatorSwift
import Darwin
import Foundation

/// Native 0.154 advertises a rollout pathname before it materializes a new
/// thread. `thread/closed` plus a clean exit alone cannot make that UUID resumable.
/// This is read-only preflight evidence, followed by the full shutdown barrier.
enum UpdateManagedCodexPersistence {
    static func requireRoot(threadID: String?, rolloutPath: String?, codexHome: String) throws {
        guard let threadID, let id = UUID(uuidString: threadID), let rolloutPath,
              UpdateManagedCodexArguments.safeText(rolloutPath), rolloutPath.hasPrefix("/"),
              let resolved = realpath(rolloutPath, nil) else { throw unavailable() }
        defer { free(resolved) }
        let physical = String(cString: resolved)
        let home = try UpdateManagedCodexPath.canonicalDirectory(codexHome)
        guard physical.hasPrefix(home + "/sessions/") || physical.hasPrefix(home + "/archived_sessions/"),
              physical.hasSuffix("-" + id.uuidString.lowercased() + ".jsonl") else {
            throw unavailable()
        }
        // O_NOFOLLOW rejects a symlink at the actual advertised path. The
        // resolved parent must still be inside this native instance's CODEX_HOME.
        let descriptor = open(rolloutPath, O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw unavailable() }
        defer { close(descriptor) }
        var info = stat(), named = stat()
        guard fstat(descriptor, &info) == 0, lstat(rolloutPath, &named) == 0,
              info.st_mode & S_IFMT == S_IFREG, named.st_mode & S_IFMT == S_IFREG,
              info.st_uid == geteuid(), info.st_nlink == 1, info.st_size > 0,
              info.st_mode & 0o022 == 0,
              info.st_dev == named.st_dev, info.st_ino == named.st_ino,
              info.st_size == named.st_size else { throw unavailable() }
    }

    private static func unavailable() -> CoordinatorError {
        CoordinatorError("update_managed_root_not_persisted",
            PetL10n.text("Saved conversation history has not been verified yet. This session was not closed. Continue the conversation or close it yourself, then check for updates again.", korean: "아직 저장된 대화 기록을 확인하지 못했습니다. 이 세션은 종료하지 않았습니다. 대화를 진행하거나 직접 닫은 뒤 업데이트를 다시 확인하세요."))
    }
}

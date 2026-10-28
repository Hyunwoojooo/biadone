import CoordinatorSwift
import Darwin
import Foundation

enum UpdateManagedCodexTerminalError: Error, LocalizedError, Equatable {
    case invalidCommand
    case automationDenied
    case timedOut
    case launchFailed

    var errorDescription: String? {
        switch self {
        case .invalidCommand:
            return PetL10n.text("Unable to verify the Codex restore command file.", korean: "Codex 복원 명령 파일을 확인하지 못했습니다.")
        case .automationDenied:
            return PetL10n.text("Terminal control permission is required. Allow Blabee to access Terminal in System Settings → Privacy & Security → Automation. A new window was not opened again to avoid duplicates.", korean: "Terminal 제어 권한이 필요합니다. 시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 Blabee의 Terminal 접근을 허용해 주세요. 중복 실행을 막기 위해 새 창을 다시 열지 않았습니다.")
        case .timedOut:
            return PetL10n.text("The Terminal window-opening response timed out. It may already be open, so it was not retried. Check the restore status in Terminal.", korean: "Terminal 창 열기 응답 시간이 지났습니다. 창이 이미 열렸을 수 있어 다시 실행하지 않았습니다. Terminal에서 복원 상태를 확인해 주세요.")
        case .launchFailed:
            return PetL10n.text("Unable to confirm whether the Terminal window opened. It was not retried to avoid duplicates. Check the restore status in Terminal.", korean: "Terminal 창을 열었는지 확인하지 못했습니다. 중복 실행을 막기 위해 다시 실행하지 않았습니다. Terminal에서 복원 상태를 확인해 주세요.")
        }
    }
}

/// A single Apple event opens a new window. Never target the selected tab: it
/// may contain unrelated work, even if a previous busy/TTY check was clear.
enum UpdateManagedCodexTerminal {
    typealias Runner = (URL, [String], Int, Int) throws -> ManagedCodexVersionProbeResult

    static let script = """
    on run argv
        if (count of argv) is not 1 then error "Invalid restore arguments"
        tell application id "com.apple.Terminal"
            do script (item 1 of argv)
        end tell
    end run
    """

    static func open(commandURL: URL, runner: Runner = run) throws {
        try validateCommand(commandURL)
        // The path is data passed through argv, never AppleScript source. The
        // shell receives one quoted executable path, including any apostrophe.
        let command = "exec " + (try UpdateManagedCodexArguments.shellQuote(commandURL.path))
        let result: ManagedCodexVersionProbeResult
        do {
            result = try runner(URL(fileURLWithPath: "/usr/bin/osascript"),
                ["-e", script, "--", command], 30_000, 16 * 1_024)
        } catch let error as CoordinatorError where error.code == "managed_codex_version_probe_timeout" {
            throw UpdateManagedCodexTerminalError.timedOut
        } catch {
            throw UpdateManagedCodexTerminalError.launchFailed
        }
        // Signal termination leaves delivery uncertain even when partial stderr
        // contains a denial code. It cannot authorize initial-record cleanup.
        guard result.terminationSignal == nil else {
            throw UpdateManagedCodexTerminalError.launchFailed
        }
        guard result.exitCode == 0 else {
            let diagnostic = String(decoding: result.stderr, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            // osascript terminates its diagnostic with the Apple event code;
            // a code echoed inside a command/path is not a denial receipt.
            if diagnostic.hasSuffix("(-1743)") || diagnostic.hasSuffix("(-1744)") {
                throw UpdateManagedCodexTerminalError.automationDenied
            }
            if diagnostic.hasSuffix("(-1712)") {
                throw UpdateManagedCodexTerminalError.timedOut
            }
            throw UpdateManagedCodexTerminalError.launchFailed
        }
    }

    private static func run(_ executable: URL, _ arguments: [String], _ timeout: Int,
                            _ outputLimit: Int) throws -> ManagedCodexVersionProbeResult {
        try ManagedCodexVersionProbeRunner.run(executable: executable, arguments: arguments,
            timeoutMilliseconds: timeout, outputLimit: outputLimit)
    }

    private static func validateCommand(_ url: URL) throws {
        guard url.isFileURL, url.path.hasPrefix("/"), url.pathExtension == "command",
              UpdateManagedCodexArguments.safeText(url.path),
              url.standardizedFileURL.path == url.resolvingSymlinksInPath().path else {
            throw UpdateManagedCodexTerminalError.invalidCommand
        }
        var file = stat()
        var directory = stat()
        guard lstat(url.path, &file) == 0, file.st_mode & S_IFMT == S_IFREG,
              file.st_uid == getuid(), file.st_nlink == 1,
              file.st_mode & 0o777 == 0o700, file.st_size > 0, file.st_size <= 16 * 1_024,
              lstat(url.deletingLastPathComponent().path, &directory) == 0,
              directory.st_mode & S_IFMT == S_IFDIR, directory.st_uid == getuid(),
              directory.st_mode & 0o777 == 0o700 else {
            throw UpdateManagedCodexTerminalError.invalidCommand
        }
    }
}

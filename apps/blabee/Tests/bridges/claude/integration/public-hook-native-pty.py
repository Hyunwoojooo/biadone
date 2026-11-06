"""Opt-in real Claude PTY, driven only by ClaudePublicHookNativeTests.

Credentials remain in the separately supplied temporary CLAUDE_CONFIG_DIR.
Never reads authentication files, changes HOME, or operates installed apps.
Only the exact fresh-project trust prompt is answered; other approval remains
untouched and causes the bounded qualification to fail.
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import stat
import struct
import sys
import termios
import tempfile
import time

ANSI = re.compile(r"\x1b(?:\][^\x07]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])")
UUID = re.compile(r"\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b")


def private_json(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise RuntimeError("private_control_required")
        if info.st_size > 16384:
            raise RuntimeError("control_limit")
        with os.fdopen(descriptor, "r", closefd=False) as stream:
            return json.load(stream)
    finally:
        os.close(descriptor)


def save(path, value):
    data = value if isinstance(value, str) else json.dumps(value, sort_keys=True) + "\n"
    descriptor, temporary = tempfile.mkstemp(prefix=".driver-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def note_error(report, stage, error):
    # Never retain exception messages, filenames, arguments, or traceback text.
    line = None
    trace = error.__traceback__
    while trace is not None:
        if trace.tb_frame.f_code.co_filename == __file__:
            line = trace.tb_lineno
        trace = trace.tb_next
    errors = report.setdefault("errors", [])
    if len(errors) < 12:
        value = {"stage": stage, "type": type(error).__name__, "driver_line": line}
        if isinstance(error, OSError) and isinstance(error.errno, int):
            value["errno"] = error.errno
        errors.append(value)


class Evidence:
    def __init__(self, path, output, report):
        self.path, self.output, self.report = path, output, report
        self.started = time.monotonic()
        self.last_saved = 0
        self.last_phase = None

    def snapshot(self, force=False):
        now = time.monotonic()
        if not force and self.last_phase == self.report["phase"] and now - self.last_saved < 1:
            return
        self.last_saved, self.last_phase = now, self.report["phase"]
        self.report["elapsed_ms"] = int((now - self.started) * 1000)
        try:
            save(self.path / "pty-redacted.txt", redact(self.output))
        except BaseException as error:
            note_error(self.report, "save_screen", error)
        # A screen-write failure must not prevent writing the small counters.
        try:
            save(self.path / "driver.json", self.report)
        except BaseException as error:
            note_error(self.report, "save_report", error)
            try:
                save(self.path / "driver-errors.json", {"errors": self.report.get("errors", [])})
            except BaseException:
                pass

    def finish(self, cleanup, close_terminal):
        self.report["cleanup_started"] = True
        self.snapshot(force=True)
        # These operations are independent: either may fail without suppressing
        # the other's cleanup or the final bounded/redacted evidence snapshot.
        for stage, operation in [("cleanup", cleanup), ("close_terminal", close_terminal)]:
            try:
                operation()
            except BaseException as error:
                self.report["ok"] = False
                note_error(self.report, stage, error)
        self.report["finalized"] = True
        self.snapshot(force=True)


def screen_state(output, project):
    screen = ANSI.sub("", output.decode("utf-8", "replace"))
    # Ink uses cursor-forward escapes in place of some literal spaces.
    compact = re.sub(r"\s+", "", screen)
    version_at = compact.rfind("ClaudeCodev2.1.282")
    owned_project = str(project) in screen
    return {"owned_project_seen": owned_project,
            "trust_prompt": owned_project and "Accessingworkspace:" in compact
            and "Quicksafetycheck:" in compact and "Yes,Itrustthisfolder" in compact and "❯No,exit" in compact,
            "version_seen": version_at >= 0,
            "ready": version_at >= 0 and "❯" in compact[version_at:]}


def exit_status(status):
    # Portable to the system Python; never throw on a stopped/continued status.
    if status is None:
        return "unavailable", None
    if os.WIFEXITED(status):
        return "exited", os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return "signaled", -os.WTERMSIG(status)
    if os.WIFSTOPPED(status):
        return "stopped", None
    return "nonterminal", None


def send(master, data):
    while data:
        count = os.write(master, data)
        if count <= 0:
            raise RuntimeError("pty_write_failed")
        data = data[count:]


def process_exists(pid, group=False, report=None):
    error_number = None
    try:
        (os.killpg if group else os.kill)(pid, 0)
        present = True
    except ProcessLookupError:
        present = False
    except PermissionError as error:
        # EPERM from an observation is not evidence of either life or absence.
        present, error_number = None, error.errno
    if report is not None:
        report.setdefault("cleanup_probes", {})["group" if group else "pid"] = {
            "state": "unknown" if present is None else ("present" if present else "absent"),
            "errno": error_number}
    return present


def observe_terminal(master, report, stage):
    try:
        modes = termios.tcgetattr(master)
        report.setdefault("terminal_modes", {})[stage] = {
            "iflag": modes[0], "oflag": modes[1], "lflag": modes[3],
            "ICRNL": bool(modes[0] & termios.ICRNL), "INLCR": bool(modes[0] & termios.INLCR),
            "IGNCR": bool(modes[0] & termios.IGNCR), "OPOST": bool(modes[1] & termios.OPOST),
            "ONLCR": bool(modes[1] & termios.ONLCR), "ICANON": bool(modes[3] & termios.ICANON),
            "ECHO": bool(modes[3] & termios.ECHO), "ISIG": bool(modes[3] & termios.ISIG)}
    except BaseException as error:
        note_error(report, "terminal_" + stage, error)


def redact(data):
    text = ANSI.sub("", data.decode("utf-8", "replace"))
    # Exact inherited fixture capabilities first, then transient references and
    # account/path identifiers. No raw terminal output is ever written to disk.
    secrets = [value for key, value in os.environ.items()
               if key.startswith("BLABEE_") and key.endswith("_TOKEN") and value]
    for value in secrets:
        text = text.replace(value, "[capability]")
    for name in ("CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_CACHE_DIR", "HOME"):
        if os.environ.get(name):
            text = text.replace(os.environ[name], "[private-path]")
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        text = text.replace(str(Path(os.environ["CLAUDE_CONFIG_DIR"]).parent), "[auth-root]")
    text = UUID.sub("[id]", text)
    text = re.sub(r"\b[0-9a-fA-F]{32,}\b", "[reference]", text)
    text = re.sub(r"\b[A-Za-z0-9_-]{40,}\b", "[reference]", text)
    text = re.sub(r"[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[account]", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text[-262144:]


def main():
    launch_path, control_path, project_path, evidence_path = sys.argv[1:]
    project, evidence = Path(project_path), Path(evidence_path)
    output = bytearray()
    report = {"ok": False, "real_model": True, "candidate_version": "2.1.282", "phase": "setup",
              "prompts_sent": 0, "trust_confirmations": 0, "native_version_seen": False,
              "output_bytes": 0, "output_truncated": False, "cleanup_signals": [], "native_exit": None,
              "wait_status_unavailable": False}
    recorder = Evidence(evidence, output, report)
    recorder.snapshot(force=True)
    status = None
    master, pid = None, None
    stopped = False

    def interrupted(signum, frame):
        raise InterruptedError("fixture_terminated")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    # Foundation's test-process launcher may inherit SIGCHLD=SIG_IGN. Reset it
    # before fork so the kernel retains our child's exit status for waitpid.
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    try:
        launch = private_json(launch_path)
        executable, arguments = launch["executable"], launch["arguments"]
        if executable != "/Users/joo/.local/share/claude/versions/2.1.282":
            raise RuntimeError("candidate_mismatch")
        if (arguments.count("--strict-mcp-config") != 1 or "-p" in arguments
                or any("dangerously" in argument for argument in arguments)
                or arguments[arguments.index("--tools") + 1] != ""):
            raise RuntimeError("native_arguments_invalid")
        run_root = evidence.parent.resolve(strict=True)
        for name in ("CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_CACHE_DIR"):
            authentication = Path(os.environ[name]).resolve(strict=True)
            if os.path.commonpath([str(run_root), str(authentication)]) == str(run_root):
                raise RuntimeError("authentication_must_be_outside_evidence")
        report["phase"] = "launch"
        recorder.snapshot()
        pid, master = pty.fork()
        if pid == 0:
            try:
                os.chdir(project)
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
                os.execve(executable, [executable] + arguments, dict(os.environ))
            except BaseException:
                os._exit(99)
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
        deadline = time.monotonic() + 180
        startup_deadline = time.monotonic() + 30
        observe_terminal(master, report, "spawned")
        sequence = 0
        ready = False
        while time.monotonic() < deadline:
            readable, _, _ = select.select([master], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(master, 16384)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                if chunk:
                    report["output_bytes"] += len(chunk)
                    output.extend(chunk)
                    if len(output) > 2 * 1024 * 1024:
                        del output[:len(output) - 2 * 1024 * 1024]
                        report["output_truncated"] = True
                    state = screen_state(output, project)
                    report["screen_markers"] = state
                    report["native_version_seen"] |= state["version_seen"]
                    if report["trust_confirmations"] == 0 and state["trust_prompt"]:
                        # Native starts on No; move to Yes exactly once for our
                        # new, empty project. Never answer any tool approval.
                        # The first paint precedes the native input listener's
                        # mount; the direct PTY probe waited before its first key.
                        time.sleep(1)
                        observe_terminal(master, report, "before_trust")
                        send(master, b"\x1b[B")
                        report.setdefault("trust_input_bytes", []).append("1b5b42")
                        # Match the separately observed native key cadence;
                        # allow the selected option's render to commit first.
                        time.sleep(1)
                        observe_terminal(master, report, "after_down")
                        send(master, b"\r")
                        report["trust_input_bytes"].append("0d")
                        observe_terminal(master, report, "after_enter")
                        report["trust_confirmations"] = 1
                        report["phase"] = "trust_input_sent"
                        startup_deadline = min(startup_deadline, time.monotonic() + 15)
                    ready = ready or state["ready"]
            recorder.snapshot()
            try:
                observed, value = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                report["wait_status_unavailable"] = True
                raise RuntimeError("owned_child_not_waitable")
            if observed == pid:
                status = value
                report["wait_status"] = value
                break
            if not ready:
                if time.monotonic() >= startup_deadline:
                    report["phase"] = "startup_timeout"
                    raise TimeoutError("native_startup_not_ready")
                continue
            try:
                command = private_json(control_path)
            except FileNotFoundError:
                continue
            current = command.get("sequence")
            if current == sequence:
                continue
            if not isinstance(current, int) or current != sequence + 1:
                raise RuntimeError("control_sequence_invalid")
            kind = command.get("kind")
            if kind == "prompt":
                text = command.get("text")
                if not isinstance(text, str) or len(text.encode("utf-8")) > 12000 or "\x1b" in text:
                    raise RuntimeError("prompt_invalid")
                if report["prompts_sent"] >= 3:
                    raise RuntimeError("prompt_count_exceeded")
                send(master, b"\x1b[200~" + text.encode("utf-8") + b"\x1b[201~")
                time.sleep(0.3)
                send(master, b"\r")
                report["prompts_sent"] += 1
                report["phase"] = "prompt_" + str(report["prompts_sent"])
            elif kind == "stop":
                send(master, b"/exit\r")
                stopped = True
                report["phase"] = "exit_requested"
                deadline = min(deadline, time.monotonic() + 4)
            else:
                raise RuntimeError("control_kind_invalid")
            sequence = current
            recorder.snapshot()
        report["ok"] = stopped and report["prompts_sent"] == 3 and report["native_version_seen"]
        if not stopped:
            report["phase"] = "native_exited_early" if status is not None else "timeout"
    except BaseException as error:
        report["ok"] = False
        note_error(report, "run", error)
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        def cleanup():
            nonlocal status
            if pid is None or pid <= 0:
                return
            # pty.fork creates exactly this owned session/process group. Signal
            # it even after its leader exits to end its remaining MCP/Hook
            # children, and never search or kill unrelated process names.
            for signum, grace in [(signal.SIGTERM, 2), (signal.SIGKILL, 2)]:
                try:
                    os.killpg(pid, signum)
                    report["cleanup_signals"].append(signal.Signals(signum).name)
                except ProcessLookupError:
                    pass
                finish = time.monotonic() + grace
                while time.monotonic() < finish:
                    if exit_status(status)[0] not in ("exited", "signaled"):
                        try:
                            observed, value = os.waitpid(pid, os.WNOHANG)
                            if observed == pid:
                                status = value
                                report["wait_status"] = value
                        except ChildProcessError:
                            report["wait_status_unavailable"] = True
                    if process_exists(pid, report=report) is False and process_exists(pid, group=True, report=report) is False:
                        break
                    time.sleep(0.05)
                if process_exists(pid, report=report) is False and process_exists(pid, group=True, report=report) is False:
                    break
            report["wait_status"] = status
            report["native_exit_kind"], report["native_exit"] = exit_status(status)
            report["owned_child_reaped"] = report["native_exit_kind"] in ("exited", "signaled")
            child = process_exists(pid, report=report)
            group = process_exists(pid, group=True, report=report)
            report["owned_child_absent"] = None if child is None else not child
            report["owned_process_group_absent"] = None if group is None else not group
            report["ok"] = report["ok"] and report["owned_child_absent"] is True and report["owned_process_group_absent"] is True
        recorder.finish(cleanup, lambda: os.close(master) if master is not None else None)
    return 0 if report["ok"] else 1


def self_test():
    """Synthetic strings/files only: no fork, exec, signals, or auth-file reads."""
    project = Path("/private/tmp/synthetic-owned/work/project")
    trust = ("Accessing workspace:\n" + str(project) + "\nQuick safety check:\n"
             "❯ No, exit\nYes, I trust this folder\n")
    for sample in (trust, trust.replace(" ", "\x1b[1C"), trust.replace(" ", "")):
        state = screen_state(sample.encode(), project)
        assert state["trust_prompt"] and not state["ready"]
    assert not screen_state(trust.encode(), Path("/private/tmp/other-project"))["trust_prompt"]
    assert not screen_state(trust.replace("❯ No, exit", "No, exit").encode(), project)["trust_prompt"]
    # Multiple OSC strings must not consume the native header between them.
    header = "\x1b]8;;https://example.invalid\x1b\\Claude\x1b[1CCode\x1b[1Cv2.1.282\x1b]8;;\x1b\\\n❯"
    assert screen_state(header.encode(), project)["ready"]
    assert not screen_state(b"ClaudeCodev2.1.282", project)["ready"]
    assert exit_status(23 << 8) == ("exited", 23)
    assert exit_status(signal.SIGTERM) == ("signaled", -signal.SIGTERM)
    assert exit_status((signal.SIGSTOP << 8) | 0x7f) == ("stopped", None)
    from unittest.mock import patch
    probes = {}
    with patch("os.kill", side_effect=PermissionError(errno.EPERM, "synthetic-no-process-call")):
        assert process_exists(123, report=probes) is None
    assert probes["cleanup_probes"]["pid"] == {"state": "unknown", "errno": errno.EPERM}
    with tempfile.TemporaryDirectory(prefix="blabee-hook-driver-selftest-") as temporary:
        root = Path(temporary)
        output = bytearray((trust + "\n" + "a" * 64 + "\nfixture@example.invalid").encode())
        report = {"ok": True, "phase": "setup"}
        recorder = Evidence(root, output, report)
        recorder.snapshot()
        assert private_json(root / "driver.json")["phase"] == "setup"
        report["phase"] = "trusted_workspace"
        recorder.snapshot()  # phase change persists without waiting one second
        assert private_json(root / "driver.json")["phase"] == "trusted_workspace"

        def failed_cleanup():
            raise ValueError("synthetic-do-not-log-this-message")

        def failed_close():
            raise OSError("synthetic-do-not-log-this-message")

        recorder.finish(failed_cleanup, failed_close)
        saved = private_json(root / "driver.json")
        assert saved["ok"] is False and saved["finalized"] is True
        assert [error["stage"] for error in saved["errors"]] == ["cleanup", "close_terminal"]
        assert all(set(error) == {"stage", "type", "driver_line"} and isinstance(error["driver_line"], int)
                   for error in saved["errors"])
        assert "synthetic-do-not-log-this-message" not in (root / "driver.json").read_text()
        redacted = (root / "pty-redacted.txt").read_text()
        assert "a" * 64 not in redacted and "fixture@example.invalid" not in redacted
        assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in root.iterdir())
        # A screen-write failure still permits the independent JSON report.
        (root / "pty-redacted.txt").unlink()
        (root / "pty-redacted.txt").mkdir()
        recorder.snapshot(force=True)
        assert private_json(root / "driver.json")["errors"][-1]["stage"] == "save_screen"
    print(json.dumps({"self_test": "passed", "native_processes_started": 0,
                      "checks": ["ANSI markers", "OSC boundaries", "wait statuses", "atomic private files",
                                 "phase snapshots", "cleanup and close failures", "independent output saving", "redaction",
                                 "EPERM remains unknown"]}))
    return 0


if __name__ == "__main__":
    try:
        exit_code = self_test() if sys.argv[1:] == ["--self-test"] else main()
    except BaseException as error:
        # Even setup errors must not disclose credentials, paths, or argv.
        diagnostic = {}
        note_error(diagnostic, "entry", error)
        sys.stderr.write(json.dumps(diagnostic) + "\n")
        exit_code = 1
    sys.exit(exit_code)

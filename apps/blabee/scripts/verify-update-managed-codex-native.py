#!/usr/bin/env python3
"""Opt-in native lifecycle contract; no turns, auth, user config or network.

The expected executable digest must come from a separately verified official
GitHub release asset. This test does not grant production runtime qualification.
It runs fresh test-owned children in an OS network-deny sandbox and records the
actual JSON wire order, diagnostics, EOFs and exact-UUID cold resume.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import subprocess
import sys
import tempfile
import time


MAX_LINE = 8 * 1024 * 1024
ALLOWED_METHODS = {"initialize", "initialized", "thread/start", "thread/resume", "thread/unsubscribe", "thread/section/move"}


class Wire:
    def __init__(self, command, environment, cwd, label, transcript):
        self.child = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        self.selector = selectors.DefaultSelector()
        self.buffers = {"stdout": bytearray(), "stderr": bytearray()}
        self.eof = set()
        self.messages = []
        self.diagnostics = []
        self.label = label
        self.transcript = transcript
        self.forced_cleanup = False
        for stream in ["stdout", "stderr"]:
            pipe = getattr(self.child, stream)
            os.set_blocking(pipe.fileno(), False)
            self.selector.register(pipe, selectors.EVENT_READ, stream)

    def event(self, kind, value=None):
        self.transcript.append({"phase": self.label, "at": time.monotonic(), "kind": kind, "value": value})

    def send(self, value):
        assert value.get("method") in ALLOWED_METHODS, "test may not submit turns or arbitrary methods"
        self.event("send", value)
        self.child.stdin.write(json.dumps(value, separators=(",", ":")).encode() + b"\n")
        self.child.stdin.flush()

    def pump(self, seconds=0.1):
        for key, _ in self.selector.select(seconds):
            stream = key.data
            data = os.read(key.fileobj.fileno(), 65536)
            if not data:
                self.selector.unregister(key.fileobj)
                assert not self.buffers[stream], f"truncated {stream} JSON line"
                self.eof.add(stream)
                self.event(stream + "_eof")
                continue
            buffer = self.buffers[stream]
            buffer.extend(data)
            assert len(buffer) <= MAX_LINE, "oversized JSON line"
            while b"\n" in buffer:
                line, _, remaining = buffer.partition(b"\n")
                self.buffers[stream] = buffer = bytearray(remaining)
                if not line:
                    raise AssertionError(f"empty {stream} line")
                try:
                    decoded = json.loads(line)
                except Exception:
                    self.event(stream + "_invalid", line.decode(errors="replace"))
                    raise
                self.event(stream, decoded)
                (self.messages if stream == "stdout" else self.diagnostics).append(decoded)

    def until(self, predicate, timeout=20):
        deadline = time.monotonic() + timeout
        while not predicate():
            assert time.monotonic() < deadline, "native protocol wait timed out"
            if self.child.poll() is not None and self.eof == {"stdout", "stderr"}:
                raise AssertionError("app-server exited before required protocol evidence")
            self.pump()

    def response(self, identity):
        self.until(lambda: any(message.get("id") == identity and "method" not in message for message in self.messages))
        response = next(message for message in self.messages if message.get("id") == identity and "method" not in message)
        assert "error" not in response, response
        return response["result"]

    def close(self):
        if self.child.stdin and not self.child.stdin.closed:
            self.child.stdin.close()
            self.event("stdin_closed")
        deadline = time.monotonic() + 15
        while self.child.poll() is None or self.eof != {"stdout", "stderr"}:
            assert time.monotonic() < deadline, "server exit/EOF timeout"
            self.pump()
        self.event("exit", self.child.returncode)
        assert self.child.returncode == 0, "native app-server exit was not clean"

    def cleanup(self):
        # Failure cleanup affects only a freshly spawned test-owned Popen, never
        # an observed PID or existing user process. A forced cleanup is not a pass.
        if self.child.poll() is None:
            try:
                self.child.stdin.close()
                self.child.wait(timeout=5)
            except Exception:
                self.forced_cleanup = True
                self.child.terminate()
                try:
                    self.child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.child.kill()
                    self.child.wait(timeout=3)
        self.selector.close()


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def run(args):
    executable = Path(args.codex).resolve(strict=True)
    assert digest(executable) == args.expected_sha256, "native executable digest mismatch"
    work_root = Path(args.work_dir)
    assert work_root.is_absolute() and work_root.is_dir(), "work directory must be an existing absolute directory"
    work = Path(tempfile.mkdtemp(prefix="blabee-native-update-contract-", dir=work_root.resolve(strict=True)))
    work.chmod(0o700)
    home, cwd, temporary = [work / part for part in ["codex-home", "cwd", "tmp"]]
    for directory in [home, cwd, temporary]:
        directory.mkdir(mode=0o700)
    catalog = work / "models.json"
    shutil.copyfile(args.catalog, catalog)
    model = json.loads(catalog.read_text())["models"][0]["slug"]
    (home / "config.toml").write_text(
        'model_provider = "isolated"\n'
        + "model = " + json.dumps(model) + "\n"
        + "model_catalog_json = " + json.dumps(str(catalog)) + "\n"
        + 'thread_unload_delay_secs = 0\n'
        + '[features]\nshell_snapshot = false\n'
        + '[model_providers.isolated]\nname = "Offline lifecycle fixture"\n'
        + 'base_url = "http://127.0.0.1:9/v1"\nwire_api = "responses"\n'
        + 'requires_openai_auth = false\n'
    )
    (home / "config.toml").chmod(0o600)
    # Block all network and user-home reads/writes at the OS boundary. Only the
    # dedicated temporary tree is writable; no inherited credentials are passed.
    sandbox = work / "network-denied.sb"
    sandbox.write_text('(version 1)\n(allow default)\n(deny network*)\n'
        + '(deny file-write* (require-not (subpath ' + json.dumps(str(work)) + ')))\n'
        + '(deny file-read-data (subpath ' + json.dumps(str(Path.home())) + '))\n')
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "CODEX_HOME": str(home),
                   "TMPDIR": str(temporary), "RUST_LOG": "warn", "LOG_FORMAT": "json", "TERM": "dumb"}
    prefix = ["/usr/bin/sandbox-exec", "-f", str(sandbox), str(executable)]
    version = subprocess.run(prefix + ["--version"], cwd=cwd, env=environment,
                             capture_output=True, timeout=10)
    report = {"work": str(work), "expected_version": args.expected_version,
              "executable_sha256": args.expected_sha256, "catalog_sha256": digest(catalog),
              "version_exit": version.returncode, "version_stdout": version.stdout.decode(errors="replace"),
              "version_stderr": version.stderr.decode(errors="replace"),
              "network": "OS-denied", "turns_submitted": 0, "passed": False, "transcript": []}
    output = work / "result.json"
    try:
        assert version.returncode == 0 and version.stdout.decode().strip() == f"codex-cli {args.expected_version}", "native version probe failed"
        root = None
        for phase in ["start", "cold_resume"]:
            wire = Wire(prefix + ["app-server", "--listen", "stdio://"], environment, cwd,
                        phase, report["transcript"])
            try:
                wire.send({"id": 1, "method": "initialize", "params": {
                    "clientInfo": {"name": "blabee_update_contract", "version": "0.1.0"},
                    "capabilities": {"experimentalApi": True}}})
                initialized = wire.response(1)
                assert Path(initialized["codexHome"]).resolve() == home, "wrong Codex home"
                wire.send({"method": "initialized"})
                if root is None:
                    wire.send({"id": 2, "method": "thread/start", "params": {
                        "cwd": str(cwd), "ephemeral": False, "model": model, "modelProvider": "isolated"}})
                else:
                    wire.send({"id": 2, "method": "thread/resume", "params": {"threadId": root, "cwd": str(cwd)}})
                response = wire.response(2)
                assert Path(response["cwd"]).resolve() == cwd, "wrong writable cwd"
                assert response["thread"]["ephemeral"] is False
                assert root is None or response["thread"]["id"] == root, "wrong restored thread"
                root = response["thread"]["id"]
                rollout = Path(response["thread"]["path"])
                if phase == "start":
                    report["fresh_thread_advertised_path_exists"] = rollout.exists()
                    # Test-only metadata operation materializes this private empty
                    # fixture without a prompt, model turn, or network request.
                    wire.send({"id": 3, "method": "thread/section/move",
                               "params": {"threadId": root, "sectionId": None}})
                    wire.response(3)
                    assert rollout.is_file() and rollout.stat().st_size > 0, "fixture was not persisted"
                    report["fixture_materialization"] = "thread/section/move null, test-owned thread only"
                wire.send({"id": "blabee-update-unsubscribe", "method": "thread/unsubscribe", "params": {"threadId": root}})
                ack = wire.response("blabee-update-unsubscribe")
                assert ack["status"] == "unsubscribed", ack
                wire.until(lambda: any(message.get("method") == "thread/closed"
                    and message.get("params", {}).get("threadId") == root for message in wire.messages))
                wire.close()
                for diagnostic in wire.diagnostics:
                    assert isinstance(diagnostic.get("fields", {}).get("message"), str), "unexpected diagnostics schema"
                    text = diagnostic["fields"]["message"].lower()
                    assert not any(word in text for word in ["persist", "rollout", "shutdown", "flush", "database"]), diagnostic
                report[phase] = {"thread_id": root, "closed": True, "both_eof": True,
                                 "exit": wire.child.returncode, "diagnostic_count": len(wire.diagnostics)}
            finally:
                wire.cleanup()
                assert not wire.forced_cleanup, "test-owned process required forced cleanup"
        report["passed"] = True
    except Exception as error:
        report["error"] = repr(error)
    finally:
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        output.chmod(0o600)
        print(json.dumps({"passed": report["passed"], "result": str(output), "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


def stable_version(value):
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", value):
        raise argparse.ArgumentTypeError("expected version must be an exact stable release")
    return value


def sha256_argument(value):
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise argparse.ArgumentTypeError("expected SHA-256 must contain 64 lowercase hexadecimal characters")
    return value


def parse_arguments(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="explicit opt-in to test-owned native child launch")
    parser.add_argument("--codex", required=True)
    parser.add_argument("--expected-version", required=True, type=stable_version)
    parser.add_argument("--expected-sha256", required=True, type=sha256_argument)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--work-dir", default="/private/tmp", help="existing absolute directory for a fresh private evidence folder")
    options = parser.parse_args(arguments)
    if not options.execute:
        parser.error("--execute is required; no process was launched")
    return options


if __name__ == "__main__":
    sys.exit(run(parse_arguments()))

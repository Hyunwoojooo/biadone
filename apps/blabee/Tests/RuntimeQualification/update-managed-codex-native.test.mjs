import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("../../scripts/verify-update-managed-codex-native.py", import.meta.url));

function python(source, args = []) {
  const bootstrap = `
import argparse, contextlib, hashlib, importlib.util, io, json, subprocess, sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
spec = importlib.util.spec_from_file_location("lifecycle_verifier", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
`;
  const result = spawnSync("python3", ["-I", "-B", "-c", bootstrap + source, verifier, ...args], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "blabee-lifecycle-checker-fixture-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "codex"), "inert fixture; never executed", { mode: 0o600 });
  await writeFile(join(directory, "models.json"), JSON.stringify({ models: [{ slug: "offline-fixture" }] }), { mode: 0o600 });
  return directory;
}

test("lifecycle checker requires explicit execution, exact stable version and complete digest before launch", () => {
  python(`
base = ["--codex", "/not-executed/codex", "--catalog", "/not-read/models.json", "--expected-sha256", "a" * 64]
with mock.patch.object(module.subprocess, "run") as run, mock.patch.object(module.subprocess, "Popen") as popen:
    for version in ["0.154.0", "0.155.0", "0.155.1"]:
        parsed = module.parse_arguments(base + ["--execute", "--expected-version", version])
        assert parsed.expected_version == version
    invalid = [base + ["--execute"], base + ["--expected-version", "0.155.1"]]
    invalid += [base + ["--execute", "--expected-version", value] for value in ["latest", "0.155", "v0.155.1", "0.155.1-alpha.1", "00.155.1", "0.155.1\\n"]]
    invalid += [base[:-1] + [value, "--execute", "--expected-version", "0.155.1"] for value in ["a" * 63, "g" * 64]]
    for arguments in invalid:
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                module.parse_arguments(arguments)
                raise AssertionError("unsafe arguments accepted")
            except SystemExit as error:
                assert error.code == 2
    run.assert_not_called()
    popen.assert_not_called()
`);
});

test("lifecycle wire refuses model turns and arbitrary RPCs before writing any bytes", () => {
  python(`
wire = object.__new__(module.Wire)
wire.child = SimpleNamespace(stdin=io.BytesIO())
wire.label, wire.transcript = "fixture", []
for method in ["turn/start", "turn/steer", "thread/fork", "command/exec", "plugin/install"]:
    try:
        wire.send({"id": 1, "method": method, "params": {}})
        raise RuntimeError("unsafe RPC was sent")
    except AssertionError:
        pass
assert wire.child.stdin.getvalue() == b""
assert wire.transcript == []
wire.send({"id": 1, "method": "initialize", "params": {}})
assert json.loads(wire.child.stdin.getvalue())["method"] == "initialize"
`);
});

test("wrong executable digest fails before creating a run or launching any process", async (t) => {
  const directory = await fixture(t);
  python(`
directory = Path(sys.argv[2])
args = SimpleNamespace(codex=str(directory / "codex"), expected_sha256="0" * 64,
    expected_version="0.155.1", catalog=str(directory / "models.json"), work_dir=str(directory))
before = set(directory.iterdir())
with mock.patch.object(module.subprocess, "run") as run, mock.patch.object(module.subprocess, "Popen") as popen:
    try:
        module.run(args)
        raise RuntimeError("wrong digest accepted")
    except AssertionError as error:
        assert "digest mismatch" in str(error)
    run.assert_not_called()
    popen.assert_not_called()
assert set(directory.iterdir()) == before
`, [directory]);
});

test("wrong exact version records failed evidence and never starts an App Server", async (t) => {
  const directory = await fixture(t);
  python(`
directory = Path(sys.argv[2])
executable = directory / "codex"
args = SimpleNamespace(codex=str(executable), expected_sha256=module.digest(executable),
    expected_version="0.155.1", catalog=str(directory / "models.json"), work_dir=str(directory))
for stdout in [b"codex-cli 0.155.0\\n", b"codex-cli 0.155.10\\n"]:
    result = subprocess.CompletedProcess([], 0, stdout=stdout, stderr=b"")
    with mock.patch.object(module.subprocess, "run", return_value=result) as run, mock.patch.object(module, "Wire") as wire:
        with contextlib.redirect_stdout(io.StringIO()) as output:
            assert module.run(args) == 1
        wire.assert_not_called()
        run.assert_called_once()
        command = run.call_args.args[0]
        assert command[:2] == ["/usr/bin/sandbox-exec", "-f"]
        assert command[-1] == "--version"
        environment = run.call_args.kwargs["env"]
        assert set(environment) == {"PATH", "CODEX_HOME", "TMPDIR", "RUST_LOG", "LOG_FORMAT", "TERM"}
        assert Path(environment["CODEX_HOME"]).is_relative_to(directory)
        sandbox = Path(command[2]).read_text()
        assert "(deny network*)" in sandbox and "(deny file-read-data" in sandbox
        evidence = json.loads(Path(json.loads(output.getvalue())["result"]).read_text())
        assert evidence["expected_version"] == "0.155.1"
        assert evidence["passed"] is False and evidence["turns_submitted"] == 0
        assert evidence["transcript"] == []
        assert evidence["catalog_sha256"] == module.digest(directory / "models.json")
` , [directory]);
});

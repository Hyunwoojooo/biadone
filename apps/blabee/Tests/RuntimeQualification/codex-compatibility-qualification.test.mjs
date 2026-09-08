import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { isolatedEnvironment, parseArguments, qualifyCodexCompatibility, runBounded } from "../../scripts/qualify-codex-compatibility.mjs";

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "blabee-codex-qualification-fixture-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtimeDir = join(directory, "runtime");
  const executables = ["bin/codex", "bin/codex-code-mode-host", "codex-path/rg", "codex-resources/zsh/bin/zsh"];
  for (const name of executables) {
    await mkdir(dirname(join(runtimeDir, name)), { recursive: true, mode: 0o700 });
    // Inert fixture bytes are never executed. Only the injected runner sees them.
    await writeFile(join(runtimeDir, name), `fixture:${name}`, { mode: 0o700 });
  }
  const manifest = { layoutVersion: 1, version: "0.153.4", target: "aarch64-apple-darwin", variant: "codex", entrypoint: "bin/codex", resourcesDir: "codex-resources", pathDir: "codex-path" };
  await writeFile(join(runtimeDir, "codex-package.json"), JSON.stringify(manifest), { mode: 0o600 });
  const calls = [];
  let installed = false;
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    let stdout = "";
    if (args[0] === "--version") stdout = "codex-cli 0.153.4\n";
    else if (args[0] === "queue") stdout = "Usage: codex queue [OPTIONS]\n";
    else if (args[0] === "plugin") {
      if (args[1] === "add") installed = true;
      if (args[1] === "remove") installed = false;
      if (args[1] === "list") stdout = JSON.stringify({ installed: installed ? [{ name: "blabee", marketplaceName: "blabee-qualification", version: "0.1.0", installed: true, enabled: true, source: { source: "local", path: "/fixture" } }] : [] });
      else if (args[1] === "marketplace" && args[2] === "list") stdout = '{"marketplaces":[]}';
      else stdout = "{}";
    }
    return { code: 0, signal: null, reason: null, error: null, stdout, stderr: "" };
  };
  return { runtimeDir, manifest, calls, run, options: { runtimeDir, expectedVersion: "0.153.4" }, dependencies: { run, platform: "darwin", arch: "arm64" } };
}

test("fixture evidence binds package contract checks without claiming real runtime or E2E approval", async (t) => {
  const f = await fixture(t);
  const report = await qualifyCodexCompatibility(f.options, f.dependencies);
  assert.equal(report.status, "fixture_passed", JSON.stringify(report.failure));
  assert.equal(report.evidenceMode, "fixture");
  assert.equal(report.package.files.length, 5);
  assert.ok(report.package.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(report.testedCapabilities.includes("code-mode-host-present"));
  assert.deepEqual(report.publication, { productionEligible: false, approvalRequired: true, catalogChanged: false });
  assert.ok(report.unverified.includes("LLM completion"));
  const codexCalls = f.calls.filter((call) => call.command.endsWith("/bin/codex"));
  assert.deepEqual(codexCalls.map((call) => call.args), [["--version"], ["plugin", "marketplace", "list", "--json"], ["plugin", "list", "--json"], ["queue", "--help"]]);
  assert.equal(f.calls.filter((call) => call.command === "/usr/bin/codesign").length, 8);
  assert.equal(f.calls.some((call) => call.command.includes("spctl")), false);
  assert.ok(f.calls.some((call) => call.args.some((arg) => arg.startsWith("-R=anchor apple generic"))));
  assert.equal(f.calls.some((call) => call.args.includes("-R")), false);
  assert.ok(f.calls.some((call) => call.args.includes("-R=notarized") && call.args.includes("--check-notarization")));
  const env = f.calls[0].options.env;
  assert.ok(env.CODEX_HOME.includes("blabee-codex-qualification-"));
  await assert.rejects(readFile(join(env.CODEX_HOME, "config.toml")), { code: "ENOENT" });
  assert.ok(f.calls.every((call) => call.options.env === env));
});

test("isolated environment does not inherit secrets, loader settings, user home or session authority", () => {
  const env = isolatedEnvironment("/private/tmp/example");
  assert.deepEqual(Object.keys(env).sort(), ["CODEX_HOME", "LANG", "LC_ALL", "NO_COLOR", "PATH", "TERM", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"].sort());
  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
});

test("missing companion host or symlink fails before any child is launched", async (t) => {
  for (const kind of ["missing", "symlink"]) {
    const f = await fixture(t);
    const host = join(f.runtimeDir, "bin/codex-code-mode-host");
    await rm(host);
    if (kind === "symlink") await symlink(join(f.runtimeDir, "bin/codex"), host);
    const report = await qualifyCodexCompatibility(f.options, f.dependencies);
    assert.equal(report.failure.code, "package_layout_invalid");
    assert.equal(f.calls.length, 0);
  }
});

test("manifest version, target, writable files and unexpected payloads fail closed", async (t) => {
  for (const kind of ["version", "target", "writable", "extra"]) {
    const f = await fixture(t);
    if (kind === "version" || kind === "target") {
      f.manifest[kind] = "wrong";
      await writeFile(join(f.runtimeDir, "codex-package.json"), JSON.stringify(f.manifest));
    } else if (kind === "writable") await chmod(join(f.runtimeDir, "bin/codex"), 0o777);
    else await writeFile(join(f.runtimeDir, "unexpected"), "extra");
    const report = await qualifyCodexCompatibility(f.options, f.dependencies);
    assert.equal(report.status, "failed");
    assert.equal(f.calls.length, 0);
  }
});

test("signature and notarization failures never launch candidate CLI", async (t) => {
  for (const notarization of [false, true]) {
    const f = await fixture(t);
    const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
      const result = await f.run(...args);
      return args[1].includes("-R=notarized") === notarization ? { ...result, code: 1 } : result;
    } });
    assert.equal(report.failure.code, notarization ? "notarization_unverified" : "signature_invalid");
    assert.equal(f.calls.some((call) => call.command.endsWith("/bin/codex")), false);
  }
});

test("terminated version probe stops immediately without retrying plugin commands", async (t) => {
  for (const failure of [{ signal: "SIGKILL", code: null }, { signal: "SIGKILL", code: 137 }]) {
    const f = await fixture(t);
    const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
      const result = await f.run(...args);
      return args[1][0] === "--version" ? { ...result, ...failure } : result;
    } });
    assert.equal(report.failure.code, "execution_terminated");
    assert.equal(f.calls.filter((call) => call.command.endsWith("/bin/codex")).length, 1);
    assert.match(report.failure.detail, /possible but not proven/);
  }
});

test("CLI contract validation rejects non-exact version, malformed JSON and false queue help", async (t) => {
  for (const [argsText, stdout, code] of [["--version", "codex-cli 0.153.40", "version_mismatch"], ["plugin list --json", "{}", "cli_contract_malformed"], ["queue --help", "unknown command", "cli_contract_malformed"]]) {
    const f = await fixture(t);
    const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
      const result = await f.run(...args);
      return args[1].join(" ") === argsText ? { ...result, stdout } : result;
    } });
    assert.equal(report.failure.code, code);
  }
});

test("changing a companion after signature inspection invalidates evidence before execution", async (t) => {
  const f = await fixture(t);
  const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
    const result = await f.run(...args);
    await writeFile(join(f.runtimeDir, "bin/codex-code-mode-host"), "different bytes");
    return result;
  } });
  assert.equal(report.failure.code, "package_changed");
  assert.equal(f.calls.length, 1);
});

test("optional plugin lifecycle and Hook harness remain isolated and explicitly limited", async (t) => {
  const f = await fixture(t);
  const report = await qualifyCodexCompatibility({ ...f.options, pluginLifecycle: true, hookTests: true }, f.dependencies);
  assert.equal(report.status, "fixture_passed", JSON.stringify(report.failure));
  assert.equal(report.evidenceMode, "fixture");
  assert.ok(report.testedCapabilities.includes("isolated-local-plugin-install-inspect-remove"));
  assert.ok(report.testedCapabilities.includes("hook-contract-unit-tests"));
  assert.match(report.hookHarness.scope, /no live Codex events/);
  assert.ok(f.calls.find((call) => call.args[0] === "--test").options.timeoutMs <= 60_000);
  assert.equal(f.calls.filter((call) => call.args[0] === "queue").length, 1);
});

test("CLI input requires explicit output and refuses runtime package writes and duplicate flags", () => {
  assert.throws(() => parseArguments(["--evidence", "relative.json"]), /absolute/);
  assert.throws(() => parseArguments(["--runtime-dir", "/runtime", "--evidence", "/runtime/evidence.json"]), /outside/);
  assert.throws(() => parseArguments(["--evidence", "/tmp/a", "--expected-version", "0.1.0", "--expected-version", "0.2.0"]), /Repeated/);
  assert.throws(() => parseArguments(["--evidence", "/tmp/a", "--skip-signature"]), /Unknown/);
});

test("process runner caps output and terminates a hanging child without touching Codex", async () => {
  const overflow = await runBounded(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)"], { env: {}, timeoutMs: 2_000, outputLimit: 100 });
  assert.equal(overflow.reason, "output_limit");
  assert.equal(Buffer.byteLength(overflow.stdout), 100);
  const timeout = await runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], { env: {}, timeoutMs: 100 });
  assert.equal(timeout.reason, "timeout");
  assert.notEqual(timeout.signal, null);
});

test("process runner kills inherited-group descendants even after successful direct-child exit", async () => {
  const script = "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);c.unref()";
  const result = await runBounded(process.execPath, ["-e", script], { env: {}, timeoutMs: 2_000 });
  assert.equal(result.code, 0);
  const pid = Number(result.stdout.trim());
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("only the default checker reports runtime evidence; any injected runner or host remains fixture evidence", async () => {
  const invalidOptions = { expectedVersion: "invalid", evidenceMode: "runtime" };
  const runtimeReport = await qualifyCodexCompatibility(invalidOptions);
  assert.equal(runtimeReport.evidenceMode, "runtime");
  assert.equal(runtimeReport.status, "failed");
  assert.equal(runtimeReport.failure.code, "invalid_input");
  const mustNotRun = () => { throw new Error("Invalid input must not launch any process"); };
  for (const dependencies of [{ run: mustNotRun }, { platform: "darwin" }, { arch: "arm64" }, Object.create({ run: mustNotRun })]) {
    const report = await qualifyCodexCompatibility(invalidOptions, dependencies);
    assert.equal(report.evidenceMode, "fixture");
    assert.equal(report.status, "failed");
    assert.equal(report.failure.code, "invalid_input");
    assert.equal(report.publication.productionEligible, false);
  }
});

test("an ordinary exit 137 is a command failure without claiming signal termination", async (t) => {
  const exited = await runBounded(process.execPath, ["-e", "process.exit(137)"], { env: {}, timeoutMs: 2_000 });
  assert.equal(exited.code, 137);
  assert.equal(exited.signal, null);
  const f = await fixture(t);
  const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
    const result = await f.run(...args);
    return args[1][0] === "--version" ? exited : result;
  } });
  assert.equal(report.failure.code, "command_failed");
  assert.equal(f.calls.filter((call) => call.command.endsWith("/bin/codex")).length, 1);
  assert.doesNotMatch(report.failure.detail, /OS blocking|terminated/);
});

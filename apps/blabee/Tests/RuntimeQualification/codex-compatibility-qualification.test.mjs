import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { isolatedEnvironment, parseArguments, qualifyCodexCompatibility, runBounded } from "../../scripts/qualify-codex-compatibility.mjs";

const sourcePluginManifest = JSON.parse(await readFile(
  new URL("../../bridges/codex/plugin/.codex-plugin/plugin.json", import.meta.url), "utf8",
));

const voiceRoot = "codex-resources/voice";
const voiceFixtureFiles = [
  "bin/codex-voice-host", "NOTICE.md", "runtime.json", "sources.json",
  "lib/libffi.8.dylib", "lib/libgio-2.0.0.dylib", "lib/libglib-2.0.0.dylib", "lib/libgmodule-2.0.0.dylib",
  "lib/libgobject-2.0.0.dylib", "lib/libgstapp-1.0.0.dylib", "lib/libgstaudio-1.0.0.dylib", "lib/libgstbase-1.0.0.dylib",
  "lib/libgstnet-1.0.0.dylib", "lib/libgstpbutils-1.0.0.dylib", "lib/libgstreamer-1.0.0.dylib", "lib/libgstrtp-1.0.0.dylib",
  "lib/libgsttag-1.0.0.dylib", "lib/libgstvideo-1.0.0.dylib", "lib/libintl.8.dylib", "lib/libopus.0.dylib",
  "lib/libpcre2-8.0.dylib", "lib/libz.1.dylib", "plugins/libgstapp.dylib", "plugins/libgstaudioconvert.dylib",
  "plugins/libgstaudioresample.dylib", "plugins/libgstcoreelements.dylib", "plugins/libgstopus.dylib",
  "plugins/libgstrtp.dylib", "plugins/libgstrtpmanager.dylib", "licenses/LGPL-2.1.txt", "licenses/Opus.txt",
  "licenses/PCRE2.md", "licenses/libffi.txt", "licenses/proxy-libintl.txt", "licenses/sljit.txt", "licenses/zlib.txt",
].map((path) => `${voiceRoot}/${path}`);

async function fixture(t, { voice = false, version = voice ? "0.163.0" : "0.153.4", bundledShell = version !== "0.163.0" } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "blabee-codex-qualification-fixture-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtimeDir = join(directory, "runtime");
  const executables = ["bin/codex", "bin/codex-code-mode-host", "codex-path/rg"];
  if (bundledShell) executables.push("codex-resources/zsh/bin/zsh");
  for (const name of executables) {
    await mkdir(dirname(join(runtimeDir, name)), { recursive: true, mode: 0o700 });
    // Inert fixture bytes are never executed. Only the injected runner sees them.
    await writeFile(join(runtimeDir, name), `fixture:${name}`, { mode: 0o700 });
  }
  const manifest = { layoutVersion: 1, version, target: "aarch64-apple-darwin", variant: "codex", entrypoint: "bin/codex", resourcesDir: "codex-resources", pathDir: "codex-path" };
  await writeFile(join(runtimeDir, "codex-package.json"), JSON.stringify(manifest), { mode: 0o600 });
  if (voice) {
    for (const name of voiceFixtureFiles) {
      await mkdir(dirname(join(runtimeDir, name)), { recursive: true, mode: 0o700 });
      // runtime.json deliberately has executable bits; dylibs deliberately do not.
      const mode = name.endsWith("/codex-voice-host") || name.endsWith("/runtime.json") ? 0o700 : 0o600;
      await writeFile(join(runtimeDir, name), `fixture:${name}`, { mode });
    }
    const hashes = Object.fromEntries(await Promise.all(["bin/codex", ...voiceFixtureFiles].map(async (name) => [name, createHash("sha256").update(await readFile(join(runtimeDir, name))).digest("hex")])));
    await writeFile(join(runtimeDir, voiceRoot, "manifest.json"), JSON.stringify({ schemaVersion: 1, appVersion: version, appTarget: manifest.target, voiceTarget: manifest.target, sha256: hashes }), { mode: 0o600 });
  }
  const calls = [];
  let installed = false;
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    let stdout = "";
    if (args[0] === "--version") stdout = `codex-cli ${version}\n`;
    else if (args[0] === "queue") stdout = "Usage: codex queue [OPTIONS]\n";
    else if (args[0] === "plugin") {
      if (args[1] === "add") installed = true;
      if (args[1] === "remove") installed = false;
      if (args[1] === "list") stdout = JSON.stringify({ installed: installed ? [{ name: "blabee", marketplaceName: "blabee-qualification", version: sourcePluginManifest.version, installed: true, enabled: true, source: { source: "local", path: "/fixture" } }] : [] });
      else if (args[1] === "marketplace" && args[2] === "list") stdout = '{"marketplaces":[]}';
      else stdout = "{}";
    }
    return { code: 0, signal: null, reason: null, error: null, stdout, stderr: "" };
  };
  return { runtimeDir, manifest, calls, run, options: { runtimeDir, expectedVersion: version }, dependencies: { run, platform: "darwin", arch: "arm64" } };
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

for (const version of ["0.155.0", "0.155.1", "0.156.0", "0.156.1", "0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.1", "0.159.2", "0.159.3", "0.160.0", "0.160.1", "0.161.0", "0.162.0", "0.162.1", "0.163.0"]) {
  test(`${version} arm64 requires the complete voice layout and verifies every native resource before CLI execution`, async (t) => {
    const f = await fixture(t, { voice: true, version });
    const report = await qualifyCodexCompatibility(f.options, f.dependencies);
    assert.equal(report.status, "fixture_passed", JSON.stringify(report.failure));
    assert.equal(report.package.manifest.version, version);
    assert.equal(report.package.files.length, version === "0.163.0" ? 41 : 42);
    assert.ok(report.testedCapabilities.includes("voice-resource-manifest"));
    assert.ok(report.unverified.includes("voice capture and audio processing"));
    const trustCalls = f.calls.filter((call) => call.command === "/usr/bin/codesign");
    const expectedTrustChecks = version === "0.163.0" ? 58 : 60;
    assert.equal(trustCalls.length, expectedTrustChecks);
    assert.ok(f.calls.slice(0, expectedTrustChecks).every((call) => call.command === "/usr/bin/codesign"));
    assert.equal(trustCalls.some((call) => call.args.at(-1).endsWith("/zsh/bin/zsh")), version !== "0.163.0");
    for (const path of voiceFixtureFiles.filter((name) => name.endsWith(".dylib") || name.endsWith("/codex-voice-host"))) {
      const checks = trustCalls.filter((call) => call.args.at(-1) === join(f.runtimeDir, path));
      assert.equal(checks.length, 2, path);
      assert.ok(checks.some((call) => call.args.some((argument) => argument.includes('certificate leaf[subject.OU] = "2DC432GLL2"') && argument.includes('identifier "com.openai.codex.voice'))));
      assert.ok(checks.some((call) => call.args.includes("-R=notarized") && call.args.includes("--check-notarization")));
    }
    assert.equal(trustCalls.some((call) => call.args.at(-1).endsWith("/runtime.json")), false);
    assert.deepEqual(report.publication, { productionEligible: false, approvalRequired: true, catalogChanged: false });
  });
}

for (const [version, unreviewedVersion] of [
  ["0.156.0", "0.156.2"], ["0.156.1", "0.156.2"],
  ["0.157.0", "0.157.2"], ["0.157.1", "0.157.2"],
  ["0.158.0", "0.158.1"], ["0.159.0", "0.159.4"],
  ["0.159.1", "0.159.4"], ["0.159.2", "0.159.4"],
  ["0.159.3", "0.159.4"], ["0.160.0", "0.160.2"],
  ["0.160.1", "0.160.2"], ["0.161.0", "0.161.1"],
  ["0.162.0", "0.162.2"], ["0.162.1", "0.162.2"],
  ["0.163.0", "0.163.1"],
]) {
  test(`${version} voice layout rejects omitted resources, unknown files and unreviewed version or target combinations`, async (t) => {
    for (const kind of ["host", "library", "license", "manifest", "extra", "version", "target", "entire-voice-layout"]) {
      const f = await fixture(t, { voice: kind !== "entire-voice-layout", version: kind === "version" ? unreviewedVersion : version, bundledShell: version !== "0.163.0" });
      const missing = { host: "bin/codex-voice-host", library: "lib/libopus.0.dylib", license: "licenses/Opus.txt", manifest: "manifest.json" }[kind];
      if (missing) await rm(join(f.runtimeDir, voiceRoot, missing));
      if (kind === "extra") await writeFile(join(f.runtimeDir, voiceRoot, "plugins/unreviewed.dylib"), "extra");
      if (kind === "target") f.dependencies.arch = "x64";
      const report = await qualifyCodexCompatibility(f.options, f.dependencies);
      assert.equal(report.failure.code, "package_layout_invalid", kind);
      assert.equal(f.calls.length, 0, kind);
    }
  });

  test(`${version} voice metadata must bind every declared resource hash to the exact version and target`, async (t) => {
    for (const kind of ["version", "target", "hash", "missing-hash", "extra-hash", "oversized"]) {
      const f = await fixture(t, { voice: true, version });
      const path = join(f.runtimeDir, voiceRoot, "manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      if (kind === "version") manifest.appVersion = unreviewedVersion;
      if (kind === "target") manifest.voiceTarget = "x86_64-apple-darwin";
      if (kind === "hash") manifest.sha256[`${voiceRoot}/runtime.json`] = "0".repeat(64);
      if (kind === "missing-hash") delete manifest.sha256[`${voiceRoot}/licenses/Opus.txt`];
      if (kind === "extra-hash") manifest.sha256[`${voiceRoot}/extra`] = "0".repeat(64);
      await writeFile(path, kind === "oversized" ? " ".repeat(16_385) : JSON.stringify(manifest));
      const report = await qualifyCodexCompatibility(f.options, f.dependencies);
      assert.equal(report.failure.code, kind === "oversized" ? "package_layout_invalid" : "package_manifest_mismatch", kind);
      assert.equal(f.calls.length, 0, kind);
    }
  });

  test(`${version} added native signature or notarization failures stop before candidate CLI execution`, async (t) => {
    for (const path of ["bin/codex-voice-host", "lib/libopus.0.dylib", "plugins/libgstopus.dylib"]) {
      for (const notarization of [false, true]) {
        const f = await fixture(t, { voice: true, version });
        const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
          const result = await f.run(...args);
          return args[1].at(-1) === join(f.runtimeDir, voiceRoot, path) && args[1].includes("-R=notarized") === notarization ? { ...result, code: 1 } : result;
        } });
        assert.equal(report.failure.code, notarization ? "notarization_unverified" : "signature_invalid", path);
        assert.equal(f.calls.some((call) => call.command.endsWith("/bin/codex")), false, path);
      }
    }
  });
}

test("retired bundled shell and partial older packages fail before any child is launched", async (t) => {
  for (const [version, bundledShell, voice] of [
    ["0.163.0", true, true],
    ["0.162.1", false, true],
    ["0.155.0", false, true],
    ["0.153.4", false, false],
  ]) {
    const f = await fixture(t, { version, bundledShell, voice });
    const report = await qualifyCodexCompatibility(f.options, f.dependencies);
    assert.equal(report.failure.code, "package_layout_invalid", version);
    assert.equal(f.calls.length, 0, version);
  }
});

test("added voice resources retain link and write-permission protections", async (t) => {
  for (const kind of ["symlink", "hardlink", "writable"]) {
    const f = await fixture(t, { voice: true });
    const path = join(f.runtimeDir, voiceRoot, "lib/libopus.0.dylib");
    if (kind === "writable") await chmod(path, 0o666);
    else {
      await rm(path);
      await (kind === "symlink" ? symlink : link)(join(f.runtimeDir, "bin/codex"), path);
    }
    const report = await qualifyCodexCompatibility(f.options, f.dependencies);
    assert.equal(report.failure.code, "package_layout_invalid", kind);
    assert.equal(f.calls.length, 0, kind);
  }
});

test("voice data changes during trust checks invalidate the full package fingerprint", async (t) => {
  const f = await fixture(t, { voice: true });
  const report = await qualifyCodexCompatibility(f.options, { ...f.dependencies, run: async (...args) => {
    const result = await f.run(...args);
    await writeFile(join(f.runtimeDir, voiceRoot, "runtime.json"), "changed data");
    return result;
  } });
  assert.equal(report.failure.code, "package_changed");
  assert.equal(f.calls.length, 1);
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

test("plugin lifecycle rejects an installed version that differs from the source payload", async (t) => {
  const f = await fixture(t);
  const report = await qualifyCodexCompatibility({ ...f.options, pluginLifecycle: true }, {
    ...f.dependencies,
    run: async (...args) => {
      const result = await f.run(...args);
      if (args[1][0] === "plugin" && args[1][1] === "list") {
        const value = JSON.parse(result.stdout);
        for (const plugin of value.installed) plugin.version = `${sourcePluginManifest.version}-mismatch`;
        return { ...result, stdout: JSON.stringify(value) };
      }
      return result;
    },
  });
  assert.equal(report.status, "failed");
  assert.equal(report.failure.code, "cli_contract_malformed");
  assert.equal(report.publication.productionEligible, false);
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

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const requiredFiles = ["bin/codex", "bin/codex-code-mode-host", "codex-package.json", "codex-path/rg", "codex-resources/zsh/bin/zsh"];
const executableFiles = requiredFiles.filter((name) => name !== "codex-package.json");
const expectedTeam = "2DC432GLL2";

function fail(code, message) {
  throw Object.assign(new Error(message), { qualificationCode: code });
}

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Every child gets a new process group. Even successful probes must not leave
// descendants behind. Output and elapsed time are bounded without shell parsing.
export function runBounded(command, args, { env, cwd, timeoutMs = 15_000, outputLimit = 65_536 } = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { env, cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const buffers = { stdout: [], stderr: [] };
    let bytes = 0;
    let reason = null;
    let cleanupTimer;
    let closed = false;
    let cleaned = false;
    let result = { code: null, signal: null, error: null };
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) {
        if (error.code !== "ESRCH") result.error = `cleanup_${error.code}`;
      }
    };
    const finish = () => {
      if (!closed || !cleaned) return;
      clearTimeout(deadline);
      resolveResult({ ...result, reason, stdout: Buffer.concat(buffers.stdout).toString("utf8"), stderr: Buffer.concat(buffers.stderr).toString("utf8") });
    };
    const cleanup = () => {
      if (cleanupTimer || cleaned) return;
      signalGroup("SIGTERM");
      cleanupTimer = setTimeout(() => {
        signalGroup("SIGKILL");
        cleaned = true;
        finish();
      }, 150);
    };
    const deadline = setTimeout(() => { reason ??= "timeout"; cleanup(); }, timeoutMs);
    for (const channel of ["stdout", "stderr"]) {
      child[channel].on("data", (chunk) => {
        const remaining = Math.max(0, outputLimit - bytes);
        if (remaining > 0) buffers[channel].push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        if (bytes > outputLimit) { reason ??= "output_limit"; cleanup(); }
      });
    }
    child.once("error", (error) => { result.error = error.code ?? "spawn_error"; });
    child.once("exit", (code, signal) => { result.code = code; result.signal = signal; cleanup(); });
    child.once("close", (code, signal) => {
      result.code = code;
      result.signal = signal;
      closed = true;
      cleanup();
      finish();
    });
  });
}

export function isolatedEnvironment(directory) {
  // Deliberately do not spread process.env: API keys, DYLD_*, shell config,
  // native CODEX_HOME, proxies, and live session identifiers cannot leak in.
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    CODEX_HOME: join(directory, "codex-home"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    TMPDIR: join(directory, "tmp"),
    NO_COLOR: "1", TERM: "dumb", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8",
  };
}

async function snapshotTree(root) {
  const files = [];
  let entries = 0;
  let totalBytes = 0;
  async function visit(path) {
    if (++entries > 128) fail("package_layout_invalid", "Package exceeds 128 entries");
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail("package_layout_invalid", "Symlink or special file in package");
    if ((info.mode & 0o022) !== 0) fail("package_layout_invalid", "Package entry is writable by group or others");
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
    } else {
      totalBytes += info.size;
      if (info.nlink !== 1 || totalBytes > 1_073_741_824) fail("package_layout_invalid", "Hard link or oversized package");
      files.push({ path: relative(root, path), bytes: info.size, mode: info.mode & 0o777, sha256: await sha256(path) });
    }
  }
  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function fingerprint(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function processFailure(result, capability) {
  if (result.reason) fail(result.reason, `${capability}: ${result.reason}`);
  if (result.error) fail("spawn_failed", `${capability}: ${result.error}`);
  if (result.signal) fail("execution_terminated", `${capability}: terminated (${result.signal}); OS blocking is possible but not proven`);
  if (result.code !== 0) fail("command_failed", `${capability}: exit ${result.code}`);
}

function objectOutput(result, capability) {
  try {
    const value = JSON.parse(result.stdout);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* A zero exit status does not establish the JSON contract. */ }
  fail("cli_contract_malformed", `${capability}: expected a JSON object`);
}

export async function qualifyCodexCompatibility(options, dependencies = {}) {
  const evidenceMode = ["run", "platform", "arch"].some((key) => dependencies[key] !== undefined) ? "fixture" : "runtime";
  const run = dependencies.run ?? runBounded;
  const hostPlatform = dependencies.platform ?? platform();
  const hostArch = dependencies.arch ?? arch();
  const expectedTarget = `${hostArch === "arm64" ? "aarch64" : hostArch === "x64" ? "x86_64" : "unsupported"}-apple-darwin`;
  const report = {
    schemaVersion: "blabee.codex-compatibility-qualification.v1",
    capabilityContract: "blabee.codex-account-free-smoke.v1",
    evidenceMode,
    createdAt: new Date().toISOString(),
    sourceRevision: options.sourceRevision ?? null,
    host: { platform: hostPlatform, arch: hostArch, osRelease: release(), node: process.version },
    expectedVersion: options.expectedVersion ?? null,
    status: "failed", failure: null, package: null, checks: [], testedCapabilities: [],
    unverified: ["live Codex Hook event delivery", "Pet UI decisions", "LLM completion", "live queue delivery", "installed end-to-end workflow"],
    publication: { productionEligible: false, approvalRequired: true, catalogChanged: false },
  };
  let temporaryRoot;
  try {
    if (!versionPattern.test(options.expectedVersion ?? "")) fail("invalid_input", "An exact stable --expected-version is required");
    if (!options.runtimeDir || !isAbsolute(options.runtimeDir)) fail("invalid_input", "An explicit absolute --runtime-dir is required");
    if (hostPlatform !== "darwin" || !["arm64", "x64"].includes(hostArch)) fail("unsupported_host", "Qualification requires a native macOS runner");
    const runtimeRoot = resolve(options.runtimeDir);
    if (await realpath(runtimeRoot) !== runtimeRoot) fail("package_layout_invalid", "Runtime root or ancestor is a symlink; provide its canonical path");
    const files = await snapshotTree(runtimeRoot);
    if (JSON.stringify(files.map((file) => file.path).sort()) !== JSON.stringify([...requiredFiles].sort())) fail("package_layout_invalid", "Expected the complete five-file official Codex package");
    if (files.some((file) => executableFiles.includes(file.path) && (file.mode & 0o111) === 0)) fail("package_layout_invalid", "A required executable is not executable");
    const manifestFile = files.find((file) => file.path === "codex-package.json");
    if (manifestFile.bytes > 16_384) fail("package_layout_invalid", "Package manifest is oversized");
    let manifest;
    try { manifest = JSON.parse(await readFile(join(runtimeRoot, "codex-package.json"), "utf8")); }
    catch { fail("package_layout_invalid", "Package manifest is not valid JSON"); }
    const expectedManifest = { layoutVersion: 1, version: options.expectedVersion, target: expectedTarget, variant: "codex", entrypoint: "bin/codex", resourcesDir: "codex-resources", pathDir: "codex-path" };
    if (!manifest || Object.entries(expectedManifest).some(([key, value]) => manifest[key] !== value)) fail("package_manifest_mismatch", "Manifest version, target, or layout does not match the requested package");
    const originalFingerprint = fingerprint(files);
    report.package = { manifest, files, fingerprint: originalFingerprint, releaseProvenance: options.releaseEvidence ? { suppliedByCaller: true, record: options.releaseEvidence } : null };
    report.testedCapabilities.push("complete-package-layout", "code-mode-host-present");
    temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "blabee-codex-qualification-")));
    const env = isolatedEnvironment(temporaryRoot);
    for (const path of [env.CODEX_HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.TMPDIR]) await mkdir(path, { mode: 0o700 });
    async function unchanged() {
      if (fingerprint(await snapshotTree(runtimeRoot)) !== originalFingerprint) fail("package_changed", "Package bytes or permissions changed during qualification");
    }
    async function probe(capability, command, args, settings = {}) {
      await unchanged();
      const result = await run(command, args, { env, cwd: temporaryRoot, timeoutMs: 15_000, outputLimit: 65_536, ...settings });
      report.checks.push({ capability, executable: command === join(runtimeRoot, "bin/codex") ? "bin/codex" : command, arguments: args.map((arg) => arg.replaceAll(temporaryRoot, "<isolated>").replaceAll(runtimeRoot, "<runtime>")), code: result.code, signal: result.signal, reason: result.reason ?? null, outputSha256: createHash("sha256").update(`${result.stdout}\0${result.stderr}`).digest("hex") });
      processFailure(result, capability);
      await unchanged();
      return result;
    }
    for (const file of executableFiles) {
      const executable = join(runtimeRoot, file);
      const requirement = `anchor apple generic and certificate leaf[subject.OU] = "${expectedTeam}"${file.startsWith("bin/") ? ` and identifier "${file.slice(4)}"` : ""}`;
      try { await probe(`signature:${file}`, "/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", `-R=${requirement}`, executable]); }
      catch (error) { if (error.qualificationCode === "command_failed") error.qualificationCode = "signature_invalid"; throw error; }
      try { await probe(`notarization:${file}`, "/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", "-R=notarized", "--check-notarization", executable]); }
      catch (error) { if (error.qualificationCode === "command_failed") error.qualificationCode = "notarization_unverified"; throw error; }
    }
    report.testedCapabilities.push("official-signature", "notarization");
    const codex = join(runtimeRoot, "bin/codex");
    const version = await probe("exact-version", codex, ["--version"]);
    if (version.stdout.trim() !== `codex-cli ${options.expectedVersion}`) fail("version_mismatch", "CLI version did not exactly match the manifest and requested version");
    report.testedCapabilities.push("exact-version");
    const marketplaces = objectOutput(await probe("marketplace-list-json", codex, ["plugin", "marketplace", "list", "--json"]), "marketplace-list-json");
    if (!Array.isArray(marketplaces.marketplaces) || marketplaces.marketplaces.length !== 0) fail("cli_contract_malformed", "Isolated marketplace list must be empty");
    const plugins = objectOutput(await probe("plugin-list-json", codex, ["plugin", "list", "--json"]), "plugin-list-json");
    if (!Array.isArray(plugins.installed) || plugins.installed.length !== 0) fail("cli_contract_malformed", "Isolated installed plugin list must be empty");
    report.testedCapabilities.push("isolated-plugin-read-only-json");
    const queue = await probe("queue-help", codex, ["queue", "--help"]);
    if (!/Usage:/i.test(queue.stdout) || !/\bqueue\b/.test(queue.stdout)) fail("cli_contract_malformed", "Missing queue help contract");
    report.testedCapabilities.push("queue-help-only");
    if (options.pluginLifecycle) {
      const marketplaceRoot = join(temporaryRoot, "marketplace");
      const sourcePlugin = join(projectRoot, "Plugin/blabee");
      const pluginFiles = await snapshotTree(sourcePlugin);
      await mkdir(join(marketplaceRoot, ".agents/plugins"), { recursive: true });
      await cp(sourcePlugin, join(marketplaceRoot, "plugins/blabee"), { recursive: true });
      const name = "blabee-qualification";
      const selector = `blabee@${name}`;
      await writeFile(join(marketplaceRoot, ".agents/plugins/marketplace.json"), JSON.stringify({ name, interface: { displayName: "Isolated Blabee Qualification" }, plugins: [{ name: "blabee", source: { source: "local", path: "./plugins/blabee" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }] }));
      objectOutput(await probe("isolated-marketplace-add", codex, ["plugin", "marketplace", "add", marketplaceRoot, "--json"]), "isolated-marketplace-add");
      objectOutput(await probe("isolated-plugin-add", codex, ["plugin", "add", selector, "--json"]), "isolated-plugin-add");
      const installed = objectOutput(await probe("isolated-installed-plugin", codex, ["plugin", "list", "--json"]), "isolated-installed-plugin");
      const pluginManifest = JSON.parse(await readFile(join(sourcePlugin, ".codex-plugin/plugin.json"), "utf8"));
      if (!Array.isArray(installed.installed) || installed.installed.length !== 1 || !installed.installed.some((entry) => entry.name === "blabee" && entry.marketplaceName === name && entry.version === pluginManifest.version && entry.installed === true && entry.enabled === true && entry.source?.source === "local")) fail("cli_contract_malformed", "Installed plugin identity or enabled state did not match");
      objectOutput(await probe("isolated-plugin-remove", codex, ["plugin", "remove", selector, "--json"]), "isolated-plugin-remove");
      objectOutput(await probe("isolated-marketplace-remove", codex, ["plugin", "marketplace", "remove", name, "--json"]), "isolated-marketplace-remove");
      const removed = objectOutput(await probe("isolated-plugin-removed", codex, ["plugin", "list", "--json"]), "isolated-plugin-removed");
      if (!Array.isArray(removed.installed) || removed.installed.length !== 0) fail("cli_contract_malformed", "Plugin removal was not observed");
      const removedMarketplace = objectOutput(await probe("isolated-marketplace-removed", codex, ["plugin", "marketplace", "list", "--json"]), "isolated-marketplace-removed");
      if (!Array.isArray(removedMarketplace.marketplaces) || removedMarketplace.marketplaces.length !== 0) fail("cli_contract_malformed", "Marketplace removal was not observed");
      if (fingerprint(await snapshotTree(sourcePlugin)) !== fingerprint(pluginFiles)) fail("package_changed", "Plugin source changed during qualification");
      report.plugin = { version: pluginManifest.version, sourceFingerprint: fingerprint(pluginFiles) };
      report.testedCapabilities.push("isolated-local-plugin-install-inspect-remove");
    }
    if (options.hookTests) {
      const testPath = join(projectRoot, "Tests/CoordinatorOperational/plugin-package.test.mjs");
      report.hookHarness = { path: relative(projectRoot, testPath), sha256: await sha256(testPath), pluginSourceFingerprint: fingerprint(await snapshotTree(join(projectRoot, "Plugin/blabee"))), scope: "repository Hook contracts with fixture coordinators; no live Codex events" };
      await probe("hook-contract-unit-tests", process.execPath, ["--test", "--test-concurrency=1", testPath], { timeoutMs: 60_000, outputLimit: 262_144 });
      report.testedCapabilities.push("hook-contract-unit-tests");
    }
    await unchanged();
    report.status = evidenceMode === "fixture" ? "fixture_passed" : "smoke_passed";
  } catch (error) {
    report.failure = { code: error.qualificationCode ?? "qualification_io_failed", detail: String(error.message).slice(0, 1_000) };
  } finally {
    if (temporaryRoot) {
      try { await rm(temporaryRoot, { recursive: true, force: true }); }
      catch { report.status = "failed"; report.failure = { code: "cleanup_failed", detail: "Isolated qualification directory could not be removed" }; }
    }
  }
  return report;
}

export function parseArguments(args) {
  const options = {};
  const values = { "--runtime-dir": "runtimeDir", "--expected-version": "expectedVersion", "--evidence": "evidence", "--release-evidence": "releaseEvidencePath", "--source-revision": "sourceRevision" };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--plugin-lifecycle") options.pluginLifecycle = true;
    else if (argument === "--hook-tests") options.hookTests = true;
    else if (values[argument] && args[index + 1] && !args[index + 1].startsWith("--")) {
      if (options[values[argument]] !== undefined) fail("invalid_input", `Repeated argument: ${argument}`);
      options[values[argument]] = args[++index];
    } else fail("invalid_input", `Unknown or incomplete argument: ${argument}`);
  }
  if (!options.evidence || !isAbsolute(options.evidence)) fail("invalid_input", "An absolute --evidence output file is required");
  if (options.runtimeDir && (resolve(options.evidence) === resolve(options.runtimeDir) || resolve(options.evidence).startsWith(`${resolve(options.runtimeDir)}/`))) fail("invalid_input", "Evidence must be outside the runtime package");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const outputParent = await realpath(dirname(options.evidence));
    const candidateRoot = options.runtimeDir ? resolve(options.runtimeDir) : null;
    if (candidateRoot && (outputParent === candidateRoot || outputParent.startsWith(`${candidateRoot}/`))) fail("invalid_input", "Evidence parent resolves inside the runtime package");
    if (options.releaseEvidencePath) options.releaseEvidence = JSON.parse(await readFile(options.releaseEvidencePath, "utf8"));
    const report = await qualifyCodexCompatibility(options);
    // Exclusive create prevents accidental overwrite of an earlier report or a
    // symlink target. Every run produces a separately addressable evidence file.
    await writeFile(options.evidence, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    process.stdout.write(`${report.status}: ${options.evidence}\n`);
    process.exitCode = report.status === "smoke_passed" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.qualificationCode ?? "qualification_io_failed"}: ${String(error.message).slice(0, 1_000)}\n`);
    process.exitCode = 1;
  }
}

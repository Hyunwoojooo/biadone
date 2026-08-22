import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { prepareLocalDogfood } from "../../scripts/prepare-local-dogfood.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const preparationScript = join(repositoryRoot, "scripts", "prepare-local-dogfood.mjs");

function compareNames(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function regularFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const metadata = await lstat(path);
    assert.equal(metadata.isSymbolicLink(), false, `unexpected symlink: ${path}`);
    if (metadata.isDirectory()) {
      files.push(...await regularFiles(root, path));
      continue;
    }
    assert.equal(metadata.isFile(), true, `unexpected special file: ${path}`);
    files.push(relative(root, path).split(sep).join("/"));
  }
  return files;
}

async function makeWorkspace(t, prefix = "blabee-local-dogfood-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const binary = join(root, "fixture coordinator");
  await writeFile(
    binary,
    [
      "#!/bin/sh",
      "if [ \"${1-}\" = doctor ]; then printf 'path=%s\\n' \"$PATH\"; fi",
      "printf 'socket=%s;args=%s\\n' \"${BLABEE_SOCKET-unset}\" \"$*\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return {
    root,
    binary,
    output: join(root, "prepared dogfood"),
  };
}

function runCodex(args, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("codex", args, {
      cwd: repositoryRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({
      code,
      signal,
      stdout,
      stderr,
    }));
  });
}

async function expectCodexJSON(args, env) {
  const result = await runCodex(args, env);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  assert.doesNotMatch(result.stderr, /panic|backtrace/i);
  return JSON.parse(result.stdout);
}

function containsJSONValue(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(value)) {
    return value.some((entry) => containsJSONValue(entry, expected));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => containsJSONValue(entry, expected));
  }
  return false;
}

test("preparation creates a self-contained app, marketplace, shims, and safe runbook", async (t) => {
  const fixture = await makeWorkspace(t);
  const fakeHome = join(fixture.root, "unused-home");
  const fakeCodexHome = join(fakeHome, ".codex");
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.HOME = fakeHome;
  process.env.CODEX_HOME = fakeCodexHome;
  let result;
  try {
    result = await prepareLocalDogfood({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }

  const canonicalOutput = join(await realpath(fixture.root), "prepared dogfood");
  assert.equal(result.output, canonicalOutput);
  assert.equal(result.summaryPath, join(canonicalOutput, "dogfood-summary.json"));
  assert.equal((await lstat(canonicalOutput)).mode & 0o777, 0o700);

  const app = join(canonicalOutput, "Blabee.app");
  const bundledCoordinator = join(
    app,
    "Contents",
    "MacOS",
    "blabee-coordinator",
  );
  const bundledPlugin = join(
    app,
    "Contents",
    "Resources",
    "Plugin",
    "blabee",
  );
  const marketplace = join(canonicalOutput, "marketplace");
  const marketplacePlugin = join(marketplace, "plugins", "blabee");
  const marketplaceManifestPath = join(
    marketplace,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const coordinatorShim = join(canonicalOutput, "bin", "blabee-coordinator");
  const codexLauncher = join(canonicalOutput, "bin", "codex-with-blabee");
  const projectSettingsLauncher = join(
    canonicalOutput,
    "bin",
    "blabee-project-settings",
  );
  const serviceLauncher = join(canonicalOutput, "bin", "blabee-service");
  const petLauncher = join(canonicalOutput, "bin", "blabee-pet");
  for (const path of [
    bundledCoordinator,
    marketplaceManifestPath,
    coordinatorShim,
    codexLauncher,
    projectSettingsLauncher,
    serviceLauncher,
    petLauncher,
    result.summaryPath,
  ]) {
    const metadata = await lstat(path);
    assert.equal(metadata.isFile(), true, path);
    assert.equal(metadata.isSymbolicLink(), false, path);
  }
  assert.equal((await lstat(coordinatorShim)).mode & 0o777, 0o755);
  assert.equal((await lstat(codexLauncher)).mode & 0o777, 0o755);
  assert.equal((await lstat(projectSettingsLauncher)).mode & 0o777, 0o755);
  assert.equal((await lstat(serviceLauncher)).mode & 0o777, 0o755);
  assert.equal((await lstat(petLauncher)).mode & 0o777, 0o755);

  const doctorRun = await execFile(
    coordinatorShim,
    ["doctor", "--project", canonicalOutput],
    { env: { PATH: "/usr/bin:/bin", BLABEE_SOCKET: "/tmp/stale-blabee.sock" } },
  );
  assert.equal(
    doctorRun.stdout,
    [
      `path=${join(app, "Contents", "MacOS")}:/usr/bin:/bin`,
      `socket=/tmp/stale-blabee.sock;args=doctor --app ${app} --project ${canonicalOutput}`,
      "",
    ].join("\n"),
  );

  const bundledFiles = await regularFiles(bundledPlugin);
  const marketplaceFiles = await regularFiles(marketplacePlugin);
  assert.deepEqual(marketplaceFiles, bundledFiles);
  for (const path of bundledFiles) {
    assert.equal(
      await digest(join(marketplacePlugin, path)),
      await digest(join(bundledPlugin, path)),
      `marketplace copy drift: ${path}`,
    );
  }

  const marketplaceManifest = JSON.parse(await readFile(marketplaceManifestPath, "utf8"));
  const expectedMarketplaceSuffix = createHash("sha256")
    .update(canonicalOutput, "utf8")
    .digest("hex")
    .slice(0, 12);
  const marketplaceName = `blabee-local-dogfood-${expectedMarketplaceSuffix}`;
  const pluginSelector = `blabee@${marketplaceName}`;
  assert.deepEqual(marketplaceManifest, {
    name: marketplaceName,
    interface: { displayName: `Blabee Local Dogfood ${expectedMarketplaceSuffix}` },
    plugins: [{
      name: "blabee",
      source: { source: "local", path: "./plugins/blabee" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
  });
  assert.equal(
    resolve(marketplace, marketplaceManifest.plugins[0].source.path),
    marketplacePlugin,
  );

  const summary = JSON.parse(await readFile(result.summaryPath, "utf8"));
  assert.deepEqual(summary, result.summary);
  assert.equal(summary.schema_version, "blabee.local-dogfood-preparation.v1");
  assert.equal(summary.preparation_only, true);
  assert.deepEqual(summary.codex.marketplace_add.argv, [
    "codex",
    "plugin",
    "marketplace",
    "add",
    marketplace,
    "--json",
  ]);
  assert.deepEqual(summary.codex.plugin_add.argv, [
    "codex",
    "plugin",
    "add",
    pluginSelector,
    "--json",
  ]);
  assert.equal(summary.codex.hook_trust.required, true);
  assert.equal(summary.codex.hook_trust.review_command, "/hooks");
  assert.equal(summary.codex.hook_trust.bypass_hook_trust, false);
  assert.equal(summary.codex.marketplace_identity_suffix, expectedMarketplaceSuffix);
  assert.equal(summary.codex.launch.environment.BLABEE_SOCKET, "unset_by_launcher");
  assert.deepEqual(summary.runtime.project_enable.argv_prefix, [
    projectSettingsLauncher,
    "enable",
    "--project",
  ]);
  assert.equal(summary.runtime.project_enable.run_before, "service");
  assert.equal(summary.runtime.project_enable.automatic, false);
  assert.deepEqual(summary.runtime.service.argv, [serviceLauncher]);
  assert.deepEqual(summary.runtime.pet.argv, [petLauncher]);
  assert.deepEqual(
    summary.runbook.steps.map((step) => [step.order, step.id]),
    [
      [1, "preflight_marketplaces"],
      [2, "add_marketplace"],
      [3, "add_plugin"],
      [4, "enable_target_project"],
      [5, "start_foreground_service"],
      [6, "launch_codex_in_target_project"],
      [7, "review_and_trust_hooks"],
      [8, "launch_pet"],
      [9, "submit_representative_prompt"],
    ],
  );
  for (const step of summary.runbook.steps) {
    assert.equal(typeof step.automatic, "boolean", `${step.id}.automatic`);
    assert.equal(typeof step.interactive, "boolean", `${step.id}.interactive`);
    assert.equal(typeof step.keep_running, "boolean", `${step.id}.keep_running`);
    assert.equal(typeof step.stop_instruction, "string", `${step.id}.stop_instruction`);
  }
  assert.equal(summary.runbook.steps[4].keep_running, true);
  assert.match(summary.runbook.steps[4].stop_instruction, /ctrl_c/);
  assert.equal(summary.runbook.steps[6].input, "/hooks");
  assert.equal(summary.runbook.steps[6].trust_bypass_allowed, false);
  assert.deepEqual(
    summary.cleanup.steps.map((step) => [step.order, step.id]),
    [
      [1, "exit_codex"],
      [2, "close_pet"],
      [3, "stop_foreground_service"],
      [4, "disable_target_project"],
      [5, "remove_plugin"],
      [6, "remove_marketplace"],
    ],
  );
  assert.deepEqual(summary.cleanup.steps[3].argv_prefix, [
    projectSettingsLauncher,
    "disable",
    "--project",
  ]);
  assert.equal(summary.cleanup.completeness, "partial_state_reversal_only");
  assert.equal(summary.cleanup.retained_state.automatically_deleted, false);
  for (const key of [
    "application_support",
    "database",
    "coordinator_key_file",
    "keychain_item",
  ]) {
    assert.match(summary.cleanup.retained_state[key], /may_remain/);
  }
  assert.equal(summary.cleanup.output_root.exact_path, canonicalOutput);
  assert.equal(summary.cleanup.output_root.automatically_deleted, false);
  assert.equal(summary.safety.cleanup_exact_root, canonicalOutput);
  assert.equal(summary.safety.automatic_failure_cleanup, false);
  assert.equal(summary.safety.failed_partial_output_preserved_for_inspection, true);
  for (const key of [
    "codex_home_modified",
    "application_support_modified",
    "applications_directory_modified",
    "keychain_modified",
    "launchd_modified",
    "service_started",
    "pet_started",
  ]) {
    assert.equal(summary.safety[key], false, key);
  }
  await assert.rejects(lstat(fakeCodexHome), { code: "ENOENT" });
  await assert.rejects(
    lstat(join(fakeHome, "Library", "Application Support", "Blabee")),
    { code: "ENOENT" },
  );

  const coordinatorRun = await execFile(coordinatorShim, ["health", "--json"]);
  assert.equal(coordinatorRun.stdout, "socket=unset;args=health --json\n");
  const staleSocketEnvironment = {
    ...process.env,
    BLABEE_SOCKET: "/tmp/stale-blabee.sock",
  };
  const projectSettingsRun = await execFile(
    projectSettingsLauncher,
    ["enable", "--project", "/tmp/target-project"],
    { env: staleSocketEnvironment },
  );
  assert.equal(
    projectSettingsRun.stdout,
    "socket=unset;args=project-settings enable --project /tmp/target-project\n",
  );
  const serviceRun = await execFile(serviceLauncher, [], {
    env: staleSocketEnvironment,
  });
  assert.equal(serviceRun.stdout, "socket=unset;args=service\n");
  const petRun = await execFile(petLauncher, [], {
    env: staleSocketEnvironment,
  });
  assert.equal(petRun.stdout, "socket=unset;args=\n");

  const fakeBin = join(fixture.root, "fake-bin");
  await mkdir(fakeBin);
  const fakeCodex = join(fakeBin, "codex");
  await writeFile(fakeCodex, [
    "#!/bin/sh",
    "printf '%s\\n' \"$BLABEE_COORDINATOR_BINARY\"",
    "printf '%s\\n' \"$PATH\"",
    "printf '%s\\n' \"${BLABEE_SOCKET-unset}\"",
    "printf '%s\\n' \"$*\"",
    "",
  ].join("\n"), { mode: 0o700 });
  const launched = await execFile(codexLauncher, ["resume", "session-id"], {
    env: { PATH: fakeBin, BLABEE_SOCKET: "/tmp/stale-blabee.sock" },
  });
  const launchLines = launched.stdout.trimEnd().split("\n");
  assert.equal(launchLines[0], bundledCoordinator);
  assert.equal(launchLines[1], `${join(canonicalOutput, "bin")}:${fakeBin}`);
  assert.equal(launchLines[2], "unset");
  assert.equal(launchLines[3], "resume session-id");

  const generatedText = await Promise.all([
    readFile(coordinatorShim, "utf8"),
    readFile(codexLauncher, "utf8"),
    readFile(projectSettingsLauncher, "utf8"),
    readFile(serviceLauncher, "utf8"),
    readFile(petLauncher, "utf8"),
    readFile(result.summaryPath, "utf8"),
  ]).then((values) => values.join("\n"));
  assert.doesNotMatch(generatedText, /dangerously-bypass-hook-trust/);

  const cliOutput = join(fixture.root, "prepared from cli");
  const cli = await execFile(process.execPath, [
    preparationScript,
    "--binary",
    fixture.binary,
    "--output",
    cliOutput,
  ]);
  assert.deepEqual(JSON.parse(cli.stdout), {
    output: join(await realpath(fixture.root), "prepared from cli"),
    summary: join(await realpath(fixture.root), "prepared from cli", "dogfood-summary.json"),
  });
});

test("two prepared marketplaces coexist and complete the real Codex lifecycle in an isolated CODEX_HOME", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-local-dogfood-codex-");
  const first = await prepareLocalDogfood({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
  });
  const second = await prepareLocalDogfood({
    binaryPath: fixture.binary,
    outputPath: join(fixture.root, "second prepared dogfood"),
  });
  assert.match(first.summary.codex.marketplace_name, /^blabee-local-dogfood-[0-9a-f]{12}$/);
  assert.match(second.summary.codex.marketplace_name, /^blabee-local-dogfood-[0-9a-f]{12}$/);
  assert.notEqual(first.summary.codex.marketplace_name, second.summary.codex.marketplace_name);
  const codexHome = join(fixture.root, "isolated-codex-home");
  await mkdir(codexHome, { mode: 0o700 });
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    NO_COLOR: "1",
  };

  const firstMarketplaceAdd = await expectCodexJSON(
    first.summary.codex.marketplace_add.argv.slice(1),
    env,
  );
  assert.equal(
    containsJSONValue(firstMarketplaceAdd, first.summary.codex.marketplace_name),
    true,
  );
  const secondMarketplaceAdd = await expectCodexJSON(
    second.summary.codex.marketplace_add.argv.slice(1),
    env,
  );
  assert.equal(
    containsJSONValue(secondMarketplaceAdd, second.summary.codex.marketplace_name),
    true,
  );
  const bothMarketplaces = await expectCodexJSON(
    ["plugin", "marketplace", "list", "--json"],
    env,
  );
  assert.equal(containsJSONValue(bothMarketplaces, first.summary.codex.marketplace_name), true);
  assert.equal(containsJSONValue(bothMarketplaces, second.summary.codex.marketplace_name), true);

  const pluginAdd = await expectCodexJSON(
    first.summary.codex.plugin_add.argv.slice(1),
    env,
  );
  assert.equal(containsJSONValue(pluginAdd, "blabee"), true);
  const installed = await expectCodexJSON(["plugin", "list", "--json"], env);
  assert.equal(containsJSONValue(installed, "blabee"), true);
  assert.equal(containsJSONValue(installed, "0.1.0"), true);

  const pluginRemove = await expectCodexJSON(
    first.summary.cleanup.steps.find((step) => step.id === "remove_plugin").argv.slice(1),
    env,
  );
  assert.equal(containsJSONValue(pluginRemove, "blabee"), true);
  const firstMarketplaceRemove = await expectCodexJSON(
    first.summary.cleanup.steps.find((step) => step.id === "remove_marketplace").argv.slice(1),
    env,
  );
  assert.equal(
    containsJSONValue(firstMarketplaceRemove, first.summary.codex.marketplace_name),
    true,
  );
  const secondMarketplaceRemove = await expectCodexJSON(
    second.summary.cleanup.steps.find((step) => step.id === "remove_marketplace").argv.slice(1),
    env,
  );
  assert.equal(
    containsJSONValue(secondMarketplaceRemove, second.summary.codex.marketplace_name),
    true,
  );
});

test("preparation rejects unsafe or existing roots and preserves its failed root", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-local-dogfood-safety-");
  await assert.rejects(
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: "relative-output" }),
    /--output must be an explicit absolute path/,
  );
  await assert.rejects(
    prepareLocalDogfood({
      binaryPath: fixture.binary,
      outputPath: "/Library/blabee-local-dogfood-test",
    }),
    /must be a child of the Blabee repository or a system temporary directory/,
  );

  const existingDirectory = join(fixture.root, "existing-directory");
  await mkdir(existingDirectory);
  await assert.rejects(
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: existingDirectory }),
    /output already exists/,
  );

  const existingFile = join(fixture.root, "existing-file");
  await writeFile(existingFile, "preserve me\n");
  await assert.rejects(
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: existingFile }),
    /output already exists/,
  );
  assert.equal(await readFile(existingFile, "utf8"), "preserve me\n");

  const existingLink = join(fixture.root, "existing-link");
  await symlink(existingFile, existingLink);
  await assert.rejects(
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: existingLink }),
    /output already exists/,
  );
  assert.equal((await lstat(existingLink)).isSymbolicLink(), true);

  const linkedBinary = join(fixture.root, "linked-binary");
  await symlink(fixture.binary, linkedBinary);
  const failedOutput = join(fixture.root, "failed-output");
  await assert.rejects(
    prepareLocalDogfood({ binaryPath: linkedBinary, outputPath: failedOutput }),
    /must be a regular file, not a symlink or special file/,
  );
  assert.equal((await lstat(failedOutput)).isDirectory(), true);
  assert.deepEqual(await readdir(failedOutput), []);
});

test("repeated and concurrent preparation never replace a completed output", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-local-dogfood-race-");
  await prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: fixture.output });
  const summaryPath = join(fixture.output, "dogfood-summary.json");
  const originalDigest = await digest(summaryPath);
  await assert.rejects(
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /output already exists/,
  );
  assert.equal(await digest(summaryPath), originalDigest);

  const concurrentOutput = join(fixture.root, "concurrent-output");
  const outcomes = await Promise.allSettled([
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: concurrentOutput }),
    prepareLocalDogfood({ binaryPath: fixture.binary, outputPath: concurrentOutput }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.match(rejected.reason.message, /(output already exists|EEXIST)/);
  assert.equal((await lstat(join(concurrentOutput, "Blabee.app"))).isDirectory(), true);
});

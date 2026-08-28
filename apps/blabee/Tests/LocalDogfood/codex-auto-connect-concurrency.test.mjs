import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultCoordinator = join(
  repositoryRoot,
  "src/coordinator-swift/.build/release/blabee-coordinator",
);

function startCommand(coordinator, arguments_, environment) {
  let child;
  const result = new Promise((resolveResult, reject) => {
    child = spawn(coordinator, arguments_, {
      cwd: repositoryRoot,
      env: environment,
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
  return { child, result };
}

function run(coordinator, operation, environment) {
  return startCommand(
    coordinator,
    ["codex-auto-connect", operation],
    environment,
  ).result;
}

function startLaunch(coordinator, arguments_, environment) {
  return startCommand(
    coordinator,
    ["codex-launch", "--", ...arguments_],
    environment,
  );
}

async function assertSuccessful(result, operation) {
  assert.equal(result.signal, null, `${operation} terminated by ${result.signal}`);
  assert.equal(result.code, 0, `${operation}\n${result.stderr}\n${result.stdout}`);
  assert.doesNotMatch(result.stderr, /panic|backtrace/i);
  return JSON.parse(result.stdout);
}

async function collectRecoveryArtifacts(root, current = root) {
  const artifacts = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...await collectRecoveryArtifacts(root, path));
      continue;
    }
    if (/\.(tmp|recovery|delete|remove|discard)(\.|$)/.test(entry.name)) {
      artifacts.push(path.slice(root.length + 1));
    }
  }
  return artifacts;
}

async function waitFor(predicate, description, timeoutMilliseconds = 3_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${description}`);
}

async function readRuntimeApproval(home) {
  const path = join(
    home,
    "Library/Application Support/Blabee/shell/v1/codex-runtime-approval.json",
  );
  const metadata = await lstat(path);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.mode & 0o777, 0o600);
  const data = await readFile(path);
  const approval = JSON.parse(data.toString("utf8"));
  assert.equal(approval.schema_version, 1);
  assert.equal(approval.policy_version, 1);
  assert.equal(typeof approval.stable_source_path, "string");
  assert.equal(typeof approval.canonical_path, "string");
  assert.equal(typeof approval.qualified_version, "string");
  assert.ok(Array.isArray(approval.source_ancestors));
  assert.ok(Array.isArray(approval.canonical_ancestors));
  return { path, data, approval };
}

test("recovery artifact scan covers every atomic cleanup suffix", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blabee-auto-connect-artifact-scan-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".managed.1.remove"), "remove");
  await writeFile(join(root, ".managed.2.discard"), "discard");

  assert.deepEqual(
    (await collectRecoveryArtifacts(root)).sort(),
    [".managed.1.remove", ".managed.2.discard"],
  );
});

test("separate enable and disable processes serialize without a partial install", async (t) => {
  const coordinator = process.env.BLABEE_COORDINATOR_BINARY ?? defaultCoordinator;
  try {
    await access(coordinator, constants.X_OK);
  } catch {
    t.skip(`release coordinator is unavailable: ${coordinator}`);
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "blabee-auto-connect-process-race-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const home = join(root, "home");
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true, mode: 0o700 });
  const codex = join(bin, "codex");
  await writeFile(
    codex,
    [
      "#!/bin/sh",
      "if [ \"${1-}\" = --version ]; then",
      "  /bin/sleep 0.05",
      "  printf 'codex-cli 0.150.1\\n'",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const environment = {
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
  };
  const initial = await assertSuccessful(
    await run(coordinator, "enable", environment),
    "initial enable",
  );
  assert.equal(initial.state, "enabled");

  const operations = ["disable", "enable", "disable", "enable", "disable", "enable"];
  const results = await Promise.all(
    operations.map((operation) => run(coordinator, operation, environment)),
  );
  for (let index = 0; index < results.length; index += 1) {
    await assertSuccessful(results[index], operations[index]);
  }

  const status = await assertSuccessful(
    await run(coordinator, "status", environment),
    "final status",
  );
  assert.ok(["enabled", "disabled"].includes(status.state), status.state);

  const zshRC = join(home, ".zshrc");
  const managed = join(
    home,
    "Library/Application Support/Blabee/shell/v1/codex-auto-connect.zsh",
  );
  const approval = join(
    home,
    "Library/Application Support/Blabee/shell/v1/codex-runtime-approval.json",
  );
  if (status.state === "enabled") {
    assert.equal((await lstat(zshRC)).isFile(), true);
    assert.equal((await lstat(managed)).isFile(), true);
    assert.match(await readFile(zshRC, "utf8"), /Blabee Codex Auto Connect v1/);
    assert.match(await readFile(managed, "utf8"), /Blabee Codex Auto Connect v3/);
    const runtime = await readRuntimeApproval(home);
    assert.equal(runtime.path, approval);
    assert.equal(
      await realpath(runtime.approval.stable_source_path),
      await realpath(codex),
    );
    assert.equal(runtime.approval.canonical_path, await realpath(codex));
    assert.equal(runtime.approval.qualified_version, "0.150.1");
  } else {
    await assert.rejects(lstat(zshRC), { code: "ENOENT" });
    await assert.rejects(lstat(managed), { code: "ENOENT" });
    await assert.rejects(lstat(approval), { code: "ENOENT" });
  }
  assert.deepEqual(await collectRecoveryArtifacts(home), []);
});

test("separate launch processes serialize one supported drift into a complete approval", async (t) => {
  const coordinator = process.env.BLABEE_COORDINATOR_BINARY ?? defaultCoordinator;
  try {
    await access(coordinator, constants.X_OK);
  } catch {
    t.skip(`release coordinator is unavailable: ${coordinator}`);
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "blabee-auto-connect-drift-race-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const home = join(root, "home");
  const bin = join(home, "bin");
  const gate = join(root, "version-gate");
  const release = join(gate, "release");
  await mkdir(bin, { recursive: true, mode: 0o700 });
  await mkdir(gate, { mode: 0o700 });
  const codex = join(bin, "codex");
  await writeFile(
    codex,
    [
      "#!/bin/sh",
      "if [ \"${1-}\" = --version ]; then",
      "  printf 'codex-cli 0.150.1\\n'",
      "  exit 0",
      "fi",
      "printf 'initial:%s\\n' \"$*\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const environment = {
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    BLABEE_TEST_VERSION_GATE: gate,
  };
  const initial = await assertSuccessful(
    await run(coordinator, "enable", environment),
    "initial enable",
  );
  assert.equal(initial.state, "enabled");
  const before = await readRuntimeApproval(home);

  const replacement = join(bin, `.codex-supported-drift-${process.pid}`);
  await writeFile(
    replacement,
    [
      "#!/bin/sh",
      "if [ \"${1-}\" = --version ]; then",
      "  : > \"${BLABEE_TEST_VERSION_GATE:?}/entered.$$\"",
      "  while [ ! -e \"$BLABEE_TEST_VERSION_GATE/release\" ]; do",
      "    /bin/sleep 0.01",
      "  done",
      "  printf 'codex-cli 0.150.1\\n'",
      "  exit 0",
      "fi",
      "printf 'updated:%s\\n' \"$*\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  await rename(replacement, codex);

  const first = startLaunch(coordinator, ["--help"], environment);
  const second = startLaunch(coordinator, ["--help"], environment);
  try {
    await waitFor(
      async () => (await readdir(gate)).some((entry) => entry.startsWith("entered.")),
      "the drift qualification process to enter its version gate",
    );
    assert.doesNotThrow(() => process.kill(first.child.pid, 0));
    assert.doesNotThrow(() => process.kill(second.child.pid, 0));
  } finally {
    await writeFile(release, "release");
  }

  const results = await Promise.all([first.result, second.result]);
  for (const result of results) {
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "updated:--help\n");
    assert.doesNotMatch(result.stderr, /panic|backtrace/i);
  }

  const versionEntries = (await readdir(gate))
    .filter((entry) => entry.startsWith("entered."));
  assert.equal(versionEntries.length, 1, versionEntries.join(","));
  const after = await readRuntimeApproval(home);
  assert.notDeepEqual(after.data, before.data);
  assert.equal(
    after.approval.stable_source_path,
    before.approval.stable_source_path,
  );
  assert.equal(after.approval.canonical_path, await realpath(codex));
  assert.equal(after.approval.qualified_version, "0.150.1");
  assert.deepEqual(await collectRecoveryArtifacts(home), []);
});

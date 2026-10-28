import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const requestedApp = process.env.BLABEE_RUNTIME_USE_LEASE_APP;
const protocol = "blabee.runtime-use-lease.v1";
const environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" };
const executablePath = (app) => join(app, "Contents", "MacOS", "blabee-coordinator");
const initialize = `${JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lease-test", version: "1" } },
})}\n`;

const flockHelperSource = String.raw`
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 3) return 64;
    if (strcmp(argv[1], "readonly") == 0) {
        struct statfs volume;
        if (statfs(argv[2], &volume) != 0) return 70;
        if ((volume.f_flags & MNT_RDONLY) == 0) return 71;
        puts("readonly");
        return 0;
    }
    if (strcmp(argv[1], "probe") != 0 && strcmp(argv[1], "hold") != 0) return 64;
    int fd = open(argv[2], O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
    struct stat value;
    if (fd < 0 || fstat(fd, &value) != 0 || !S_ISREG(value.st_mode)) return 70;
    if ((fcntl(fd, F_GETFL) & O_ACCMODE) != O_RDONLY) return 71;
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) {
        int code = errno;
        close(fd);
        if (code == EWOULDBLOCK) { puts("busy"); return 75; }
        return 72;
    }
    if (strcmp(argv[1], "hold") == 0) {
        puts("held");
        fflush(stdout);
        char byte;
        while (read(STDIN_FILENO, &byte, 1) > 0) {}
    } else {
        puts("acquired");
    }
    close(fd);
    return 0;
}
`;

async function boundedCommand(binary, argumentsList, options = {}) {
  try {
    const result = await execFile(binary, argumentsList, {
      env: environment, maxBuffer: 64 * 1024, timeout: 10_000, killSignal: "SIGKILL", ...options,
    });
    return { code: 0, ...result };
  } catch (error) {
    if (Number.isInteger(error.code) && !error.killed) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
    throw error;
  }
}

async function successfulCommand(binary, argumentsList, options) {
  const result = await boundedCommand(binary, argumentsList, options);
  assert.equal(result.code, 0, `${binary}: ${result.stderr}`);
  return result;
}

function startOwnedProcess(t, binary, argumentsList) {
  const child = spawn(binary, argumentsList, { env: environment, stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, stdout: "", stderr: "", exited: false, code: null, error: undefined };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data) => { state.stdout += data; });
  child.stderr.on("data", (data) => { state.stderr += data; });
  child.on("error", (error) => { state.error = error; });
  child.on("close", (code) => { state.code = code; state.exited = true; });
  child.stdin.on("error", (error) => { if (error.code !== "EPIPE") state.error = error; });
  t.after(async () => {
    child.stdin.end();
    const deadline = Date.now() + 2_000;
    while (!state.exited && Date.now() < deadline) await delay(20);
    if (!state.exited) child.kill("SIGTERM");
    const killDeadline = Date.now() + 1_000;
    while (!state.exited && Date.now() < killDeadline) await delay(20);
    if (!state.exited) child.kill("SIGKILL");
    await waitFor(state, () => state.exited, "owned process cleanup");
  });
  return state;
}

async function waitFor(state, predicate, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (state.error) throw state.error;
    assert.ok(state.stdout.length + state.stderr.length < 64 * 1024, "bounded child output");
    if (predicate()) return;
    assert.equal(state.exited, false, `${label}: child exited ${state.code}: ${state.stderr}`);
    await delay(20);
  }
  assert.fail(`${label}: timed out; stdout=${state.stdout}; stderr=${state.stderr}`);
}

async function startMCP(t, executable, socketPath) {
  const started = Date.now();
  const state = startOwnedProcess(t, executable, ["mcp", "--socket", socketPath]);
  state.child.stdin.write(initialize);
  await waitFor(state, () => state.stdout.includes("\n"), "MCP initialize");
  const response = JSON.parse(state.stdout.trim());
  assert.equal(response.id, 1);
  assert.equal(response.result?.serverInfo?.name, "blabee");
  assert.equal(state.stderr, "");
  assert.equal(state.exited, false);
  state.initializeMilliseconds = Date.now() - started;
  t.diagnostic?.(`MCP initialize: ${state.initializeMilliseconds} ms; explicit socket ${socketPath}`);
  return state;
}

async function closeNormally(state) {
  state.child.stdin.end();
  await waitFor(state, () => state.exited, "normal stdin-close exit");
  assert.equal(state.code, 0, state.stderr);
  assert.equal(state.stderr, "");
}

async function expectLease(helper, executable, expected) {
  const result = await boundedCommand(helper, ["probe", executable]);
  assert.equal(result.code, expected === "busy" ? 75 : 0, result.stderr);
  assert.equal(result.stdout, `${expected}\n`);
  assert.equal(result.stderr, "");
}

async function verifyRuntimeLifetime(t, helper, executable, socketPath) {
  await expectLease(helper, executable, "acquired");
  const first = await startMCP(t, executable, socketPath);
  await expectLease(helper, executable, "busy");
  const second = await startMCP(t, executable, socketPath);
  await closeNormally(first);
  await expectLease(helper, executable, "busy");
  await closeNormally(second);
  await expectLease(helper, executable, "acquired");
}

async function verifyExclusiveStartup(t, helper, app, socketPath, expectedIdentity) {
  const executable = executablePath(app);
  const holder = startOwnedProcess(t, helper, ["hold", executable]);
  await waitFor(holder, () => holder.stdout === "held\n", "exclusive holder");
  const blocked = startOwnedProcess(t, executable, ["mcp", "--socket", socketPath]);
  blocked.child.stdin.end();
  await waitFor(blocked, () => blocked.exited, "blocked MCP startup");
  assert.equal(blocked.code, 1);
  assert.equal(blocked.stdout, "");
  assert.match(blocked.stderr, /app_runtime_installation_in_progress/u);

  const query = await successfulCommand(executable, ["runtime-use-lease-protocol"]);
  assert.equal(query.stdout, `${protocol}\n`);
  assert.equal(query.stderr, "");
  const identity = await successfulCommand(executable, ["runtime-identity", "--app", app]);
  assert.equal(JSON.parse(identity.stdout).runtime_identity, expectedIdentity);
  assert.equal(identity.stderr, "");
  for (const [argumentsList, expectedError] of [
    [["runtime-use-lease-protocol", "extra"], "app_runtime_use_lease_protocol_arguments_invalid"],
    [["runtime-identity"], "runtime_identity_inspection_arguments_invalid"],
    [["runtime-identity", "--app", app, "extra"], "runtime_identity_inspection_arguments_invalid"],
  ]) {
    const malformed = await boundedCommand(executable, argumentsList);
    assert.equal(malformed.code, 1);
    assert.equal(malformed.stdout, "");
    assert.ok(malformed.stderr.includes(expectedError), malformed.stderr);
    assert.equal(malformed.stderr.includes("app_runtime_installation_in_progress"), false);
  }
  await closeNormally(holder);
  await expectLease(helper, executable, "acquired");
}

test("native runtime executable leases hold through MCP lifetime and read-only DMG use", {
  skip: process.platform !== "darwin" || !requestedApp
    ? "opt in with BLABEE_RUNTIME_USE_LEASE_APP=/absolute/path/Blabee.app on macOS"
    : false,
  timeout: 180_000,
}, async (t) => {
  assert.ok(isAbsolute(requestedApp));
  const sourceExecutable = executablePath(requestedApp);
  const sourceBefore = createHash("sha256").update(await readFile(sourceExecutable)).digest("hex");
  await successfulCommand("/usr/bin/codesign", ["--verify", "--deep", "--strict", requestedApp]);
  const sourceIdentity = JSON.parse((await successfulCommand(sourceExecutable, [
    "runtime-identity", "--app", requestedApp,
  ])).stdout);
  const root = await mkdtemp("/private/tmp/blabee-native-lease-");
  let mountNeedsDetach = false;
  t.after(async () => {
    assert.equal(mountNeedsDetach, false, `owned mount needs recovery; retained ${root}`);
    await rm(root, { recursive: true, force: true });
  });
  const socketPath = join(root, "absent.sock");
  const helper = join(root, "flock-readonly");
  await writeFile(join(root, "flock-readonly.c"), flockHelperSource);
  await successfulCommand("/usr/bin/clang", [join(root, "flock-readonly.c"), "-o", helper]);
  const copy = join(root, "copied", "Blabee.app");
  await mkdir(dirname(copy));
  await cp(requestedApp, copy, { recursive: true, preserveTimestamps: true });
  const copiedExecutable = executablePath(copy);
  assert.notEqual((await lstat(copiedExecutable)).ino, (await lstat(sourceExecutable)).ino);
  await successfulCommand("/usr/bin/codesign", ["--verify", "--deep", "--strict", copy]);

  await t.test("copied signed main uses shared leases and releases only after all MCP processes exit", async (subtest) => {
    await verifyRuntimeLifetime(subtest, helper, copiedExecutable, socketPath);
  });
  await t.test("exclusive lease blocks normal dispatch but strict stateless queries remain available", async (subtest) => {
    await verifyExclusiveStartup(subtest, helper, copy, socketPath, sourceIdentity.runtime_identity);
  });
  await t.test("a non-app bundle started before rename remains leased after becoming an app", async (subtest) => {
    const renamed = join(root, "copied", "Blabee.runtime-backup");
    await rename(copy, renamed);
    let restored = false;
    subtest.after(async () => { if (!restored) await rename(renamed, copy); });
    const live = await startMCP(subtest, executablePath(renamed), socketPath);
    await expectLease(helper, executablePath(renamed), "busy");
    await rename(renamed, copy);
    restored = true;
    await expectLease(helper, copiedExecutable, "busy");
    await closeNormally(live);
    await expectLease(helper, copiedExecutable, "acquired");
  });
  await t.test("read-only mounted DMG supports shared runtime and exclusive startup conflict", async (subtest) => {
    const volume = join(root, "volume");
    const image = join(root, "runtime-use-lease.dmg");
    const mount = join(root, "mounted");
    await mkdir(volume);
    await mkdir(mount);
    await cp(requestedApp, join(volume, "Blabee.app"), { recursive: true, preserveTimestamps: true });
    await successfulCommand("/usr/bin/hdiutil", [
      "create", "-srcfolder", volume, "-volname", "Blabee Lease Test", "-fs", "HFS+",
      "-format", "UDZO", "-nospotlight", "-noanyowners", image,
    ], { timeout: 60_000 });
    mountNeedsDetach = true;
    const processCleanups = [];
    const processScope = {
      after: (cleanup) => processCleanups.push(cleanup),
      diagnostic: (message) => subtest.diagnostic(message),
    };
    try {
      await successfulCommand("/usr/bin/hdiutil", [
        "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, image,
      ], { timeout: 30_000 });
      assert.equal((await successfulCommand(helper, ["readonly", mount])).stdout, "readonly\n");
      const mountedApp = join(mount, "Blabee.app");
      await verifyRuntimeLifetime(processScope, helper, executablePath(mountedApp), socketPath);
      await verifyExclusiveStartup(processScope, helper, mountedApp, socketPath, sourceIdentity.runtime_identity);
    } finally {
      const cleanupResults = await Promise.allSettled(processCleanups.map((cleanup) => cleanup()));
      await successfulCommand("/usr/bin/hdiutil", ["detach", mount], { timeout: 30_000 });
      mountNeedsDetach = false;
      assert.deepEqual(cleanupResults.filter((result) => result.status === "rejected"), []);
    }
  });
  await assert.rejects(lstat(socketPath), { code: "ENOENT" });
  assert.equal(createHash("sha256").update(await readFile(sourceExecutable)).digest("hex"), sourceBefore);
  t.diagnostic(JSON.stringify({ app: requestedApp, runtimeIdentity: sourceIdentity.runtime_identity, binarySHA256: sourceBefore }));
});

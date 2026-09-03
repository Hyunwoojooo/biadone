import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { assembleMacOSApp } from "../../scripts/build-macos-app.mjs";
import {
  attachAndVerifyDMG,
  buildInternalDMG,
  internalDMGTesting,
  recoverInterruptedPublish,
  snapshotExecutable,
  verifyInternalAppBundle,
} from "../../scripts/build-internal-dmg.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagingScript = join(repositoryRoot, "scripts", "build-internal-dmg.mjs");
const expectedNotice = [
  "BLABEE INTERNAL TEST BUILD",
  "",
  "The enclosed Blabee.app is ad-hoc signed.",
  "This disk image is unsigned and is not notarized by Apple.",
  "It is intended only for approved internal testing on macOS 13 or later.",
  "Drag Blabee.app to Applications, then follow the team's test instructions.",
  "Do not redistribute this disk image as a public release.",
  "",
].join("\n");

async function makeWorkspace(t, prefix = "blabee-internal-dmg-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const binary = join(root, "blabee-coordinator");
  await copyFile("/usr/bin/true", binary);
  await chmod(binary, 0o700);
  return {
    root,
    binary,
    output: join(root, "Blabee-internal-test.dmg"),
  };
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function attachReadonly(t, dmg, root) {
  const mountPoint = await mkdtemp(join(root, "mounted-"));
  let attached = false;
  t.after(async () => {
    if (attached) {
      await execFile("/usr/bin/hdiutil", ["detach", mountPoint]);
      attached = false;
    }
    await rm(mountPoint, { recursive: true, force: true });
  });
  await execFile(
    "/usr/bin/hdiutil",
    [
      "attach",
      "-readonly",
      "-nobrowse",
      "-noautoopen",
      "-mountpoint",
      mountPoint,
      dmg,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  attached = true;
  return {
    mountPoint,
    async detach() {
      await execFile("/usr/bin/hdiutil", ["detach", mountPoint]);
      attached = false;
    },
  };
}

function hiddenPackagingArtifacts(names) {
  return names.filter((name) => (
    name.startsWith(".blabee-internal-dmg-work-")
    || (name.startsWith(".Blabee-") && name.includes(".staged"))
    || name.endsWith(".blabee-internal-dmg.lock")
    || name.includes(".blabee-internal-dmg-transaction.json")
  ));
}

async function prepareInterruptedTransaction(destination, parent, suffix) {
  const workRoot = await mkdtemp(join(parent, `.blabee-internal-dmg-work-${suffix}-`));
  await chmod(workRoot, 0o700);
  const workRootIdentity = await internalDMGTesting.captureDirectoryIdentity(
    workRoot,
    "test work root",
  );
  const stagedDMG = join(workRoot, "artifact.staged.dmg");
  const stagedChecksum = join(workRoot, "artifact.staged.dmg.sha256");
  await writeFile(stagedDMG, `transactional DMG bytes ${suffix}`);
  const sha256 = await digest(stagedDMG);
  await writeFile(stagedChecksum, `${sha256}  ${basename(destination.output)}\n`);
  await internalDMGTesting.createPublishTransaction({
    destination,
    workRoot,
    workRootIdentity,
    stagedDMG,
    stagedChecksum,
    sha256,
  });
  return { workRoot, stagedDMG, stagedChecksum };
}

test("internal DMG CLI reports help without creating an artifact", async () => {
  const { stdout, stderr } = await execFile(process.execPath, [packagingScript, "--help"]);
  assert.match(stdout, /internal testing only/u);
  assert.match(stdout, /--binary \/absolute\/path/u);
  assert.equal(stderr, "");
});

test("internal DMG contains only the signed app, Applications link, and test notice", {
  skip: process.platform !== "darwin" ? "requires macOS hdiutil and codesign" : false,
  timeout: 120_000,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  const { stdout, stderr } = await execFile(
    process.execPath,
    [
      packagingScript,
      "--binary",
      fixture.binary,
      "--output",
      fixture.output,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(stderr, "");
  assert.equal(stdout.endsWith("\n"), true);
  assert.equal(stdout.slice(0, -1).includes("\n"), false);
  const result = JSON.parse(stdout);

  assert.equal(result.schema_version, "blabee.internal-dmg.v1");
  const canonicalOutput = join(await realpath(fixture.root), basename(fixture.output));
  assert.equal(result.artifact, canonicalOutput);
  assert.equal(result.checksum_artifact, `${canonicalOutput}.sha256`);
  assert.equal(result.volume_name, "Blabee Internal Test");
  assert.equal(result.app_signing, "adhoc");
  assert.equal(result.dmg_signing, "unsigned");
  assert.equal(result.notarized, false);
  assert.equal(result.public_distribution_ready, false);
  assert.equal(result.app.bundle_identifier, "com.biadone.blabee");
  assert.equal(result.app.version, "0.1.0");
  assert.equal(result.app.build, "1");
  assert.equal(result.app.minimum_system_version, "13.0");
  assert.ok(result.app.architectures.length >= 1);

  assert.equal((await lstat(fixture.output)).isFile(), true);
  assert.equal((await lstat(`${fixture.output}.sha256`)).isFile(), true);
  const expectedDigest = await digest(fixture.output);
  assert.equal(result.sha256, expectedDigest);
  assert.equal(
    await readFile(`${fixture.output}.sha256`, "utf8"),
    `${expectedDigest}  ${basename(fixture.output)}\n`,
  );
  await execFile("/usr/bin/hdiutil", ["verify", fixture.output], {
    maxBuffer: 4 * 1024 * 1024,
  });

  const mounted = await attachReadonly(t, fixture.output, fixture.root);
  assert.deepEqual(
    (await readdir(mounted.mountPoint)).sort(),
    ["Applications", "Blabee.app", "INTERNAL_TESTING.txt"].sort(),
  );
  assert.equal(await readlink(join(mounted.mountPoint, "Applications")), "/Applications");
  assert.equal(
    await readFile(join(mounted.mountPoint, "INTERNAL_TESTING.txt"), "utf8"),
    expectedNotice,
  );
  const mountedApp = await verifyInternalAppBundle(join(mounted.mountPoint, "Blabee.app"));
  assert.deepEqual(mountedApp.architectures, result.app.architectures);
  await mounted.detach();
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("unsafe output names, paths, and pre-existing file or symlink outputs are rejected", {
  skip: process.platform !== "darwin" ? "requires macOS path semantics" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-inputs-");

  await assert.rejects(
    buildInternalDMG({ binaryPath: "relative", outputPath: fixture.output }),
    /--binary must be an explicit absolute path/u,
  );
  await assert.rejects(
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: "relative.dmg" }),
    /--output must be an explicit absolute path/u,
  );
  await assert.rejects(
    buildInternalDMG({
      binaryPath: fixture.binary,
      outputPath: join(fixture.root, "Blabee internal.dmg"),
    }),
    /conservative ASCII/u,
  );
  await assert.rejects(
    buildInternalDMG({
      binaryPath: fixture.binary,
      outputPath: "/Applications/Blabee-internal-test.dmg",
    }),
    /inside the Blabee repository|direct writes to \/Applications/u,
  );

  await writeFile(fixture.output, "keep me");
  await assert.rejects(
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /DMG output already exists/u,
  );
  assert.equal(await readFile(fixture.output, "utf8"), "keep me");
  await rm(fixture.output);

  await writeFile(`${fixture.output}.sha256`, "keep checksum");
  await assert.rejects(
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /checksum output already exists/u,
  );
  assert.equal(await readFile(`${fixture.output}.sha256`, "utf8"), "keep checksum");
  assert.equal(await lstat(fixture.output).catch((error) => error.code), "ENOENT");
  await rm(`${fixture.output}.sha256`);

  await symlink("/path/that/does/not/exist", fixture.output);
  await assert.rejects(
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /DMG output already exists/u,
  );
  assert.equal((await lstat(fixture.output)).isSymbolicLink(), true);
});

test("unsigned app bundles and non-Mach-O input are rejected and cleaned", {
  skip: process.platform !== "darwin" ? "requires macOS codesign and lipo" : false,
  timeout: 120_000,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-invalid-");
  const unsignedApp = join(fixture.root, "unsigned", "Blabee.app");
  await mkdir(dirname(unsignedApp), { recursive: true });
  await assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: unsignedApp,
    adhocSign: false,
  });
  await assert.rejects(
    verifyInternalAppBundle(unsignedApp),
    /code object is not signed|not signed at all|code has no resources|CSSMERR_TP_NOT_TRUSTED/u,
  );

  const scriptBinary = join(fixture.root, "not-mach-o");
  await writeFile(scriptBinary, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await assert.rejects(
    buildInternalDMG({ binaryPath: scriptBinary, outputPath: fixture.output }),
    /can't figure out the architecture type|not an object file|lipo/u,
  );
  assert.equal(await lstat(fixture.output).catch((error) => error.code), "ENOENT");
  assert.equal(await lstat(`${fixture.output}.sha256`).catch((error) => error.code), "ENOENT");
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("concurrent builders never overwrite and leave one complete artifact pair", {
  skip: process.platform !== "darwin" ? "requires macOS hdiutil and codesign" : false,
  timeout: 180_000,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-race-");
  const results = await Promise.allSettled([
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(
    rejected[0].reason.message,
    /appeared during packaging|already exists|locked by active process|output lock exists but could not be verified/u,
  );
  const checksum = await readFile(`${fixture.output}.sha256`, "utf8");
  assert.equal(checksum, `${await digest(fixture.output)}  ${basename(fixture.output)}\n`);
  await execFile("/usr/bin/hdiutil", ["verify", fixture.output], {
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("partial attach failure detaches the new device entry without force", {
  skip: process.platform !== "darwin" ? "requires macOS mountpoint identity" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-partial-attach-");
  const dmg = join(fixture.root, "partial.dmg");
  await writeFile(dmg, "fixture");
  const snapshots = [new Set(), new Set(["/dev/disk999"]), new Set()];
  const calls = [];
  const attachFailure = new Error("attach failed after allocating a device");

  await assert.rejects(
    attachAndVerifyDMG(dmg, fixture.root, {}, {
      execute: async (command, args) => {
        calls.push([command, ...args]);
        if (args[0] === "attach") throw attachFailure;
        if (args[0] === "detach") return { stdout: "", stderr: "" };
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
      snapshotDevices: async () => snapshots.shift(),
      verifyMounted: async () => {
        throw new Error("mount verification must not run for a partial attach");
      },
    }),
    (error) => error === attachFailure,
  );
  const detach = calls.find((call) => call[1] === "detach");
  assert.deepEqual(detach, ["/usr/bin/hdiutil", "detach", "/dev/disk999"]);
  assert.equal(detach.includes("-force"), false);
  assert.equal(await lstat(join(fixture.root, "mounted")).catch((error) => error.code), "ENOENT");
});

test("checksum-only interrupted publish is recovered transactionally on the next run", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-transaction-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const outputLock = await internalDMGTesting.acquireOutputLock(destination);
  const workRoot = await mkdtemp(join(fixture.root, ".blabee-internal-dmg-work-test-"));
  await chmod(workRoot, 0o700);
  const workRootIdentity = await internalDMGTesting.captureDirectoryIdentity(
    workRoot,
    "test work root",
  );
  const stagedDMG = join(workRoot, "artifact.staged.dmg");
  const stagedChecksum = join(workRoot, "artifact.staged.dmg.sha256");
  await writeFile(stagedDMG, "transactional DMG bytes");
  const sha256 = await digest(stagedDMG);
  await writeFile(stagedChecksum, `${sha256}  ${basename(fixture.output)}\n`);
  await internalDMGTesting.createPublishTransaction({
    destination,
    workRoot,
    workRootIdentity,
    stagedDMG,
    stagedChecksum,
    sha256,
  });
  await internalDMGTesting.publishExclusive(
    stagedChecksum,
    destination.checksum,
    "checksum output",
  );

  const recovered = await recoverInterruptedPublish(destination, outputLock);
  assert.deepEqual(recovered, { recovered: true, committed: false });
  await internalDMGTesting.releaseOutputLock(destination, outputLock);
  for (const path of [
    destination.output,
    destination.checksum,
    destination.transaction,
    destination.lock,
    workRoot,
  ]) {
    assert.equal(await lstat(path).catch((error) => error.code), "ENOENT", path);
  }
});

test("pinned executable detects in-copy mutation and remains stable after source replacement", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-snapshot-");
  const workRoot = join(fixture.root, "work");
  await mkdir(workRoot, { mode: 0o700 });
  let mutated = false;
  await assert.rejects(
    snapshotExecutable(fixture.binary, workRoot, {
      afterSnapshotChunk: async () => {
        if (mutated) return;
        mutated = true;
        await writeFile(fixture.binary, "changed during snapshot");
        await chmod(fixture.binary, 0o700);
      },
    }),
    /changed while its pinned snapshot/u,
  );
  assert.equal(
    await lstat(join(workRoot, "blabee-coordinator.pinned")).catch((error) => error.code),
    "ENOENT",
  );

  await copyFile("/usr/bin/true", fixture.binary);
  await chmod(fixture.binary, 0o700);
  const pinned = await snapshotExecutable(fixture.binary, workRoot);
  const pinnedDigest = await digest(pinned.path);
  assert.equal(pinned.sha256, pinnedDigest);
  await writeFile(fixture.binary, "replacement after pinning");
  assert.equal(await digest(pinned.path), pinnedDigest);
});

test("identity and cleanup diagnostics preserve the primary failure", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-identity-");
  const parent = join(fixture.root, "parent");
  const moved = join(fixture.root, "parent-moved");
  await mkdir(parent);
  const identity = await internalDMGTesting.captureDirectoryIdentity(parent, "test parent");
  await rename(parent, moved);
  await mkdir(parent);
  await assert.rejects(
    internalDMGTesting.assertDirectoryIdentity(parent, identity, "test parent"),
    (error) => error.preservePackagingWork === true && /identity changed/u.test(error.message),
  );

  const primary = new Error("primary packaging failure");
  const cleanup = new Error("injected cleanup failure");
  const combined = internalDMGTesting.errorWithCleanup(primary, [cleanup]);
  assert.ok(combined instanceof AggregateError);
  assert.equal(combined.cause, primary);
  assert.equal(combined.errors[0], primary);
  assert.equal(combined.errors[1], cleanup);
  assert.match(combined.message, /primary packaging failure; cleanup errors:/u);
});

test("active output lock blocks recovery and a second builder without touching active work", {
  skip: process.platform !== "darwin" ? "builder is macOS-only" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-active-lock-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const ownership = await internalDMGTesting.acquireOutputLock(destination);
  const interrupted = await prepareInterruptedTransaction(destination, fixture.root, "active");

  await assert.rejects(
    recoverInterruptedPublish(destination),
    /requires output-lock ownership proof/u,
  );
  await assert.rejects(
    buildInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    new RegExp(`locked by active process ${process.pid}`, "u"),
  );
  assert.equal((await lstat(interrupted.workRoot)).isDirectory(), true);
  assert.equal((await lstat(destination.transaction)).isFile(), true);

  await recoverInterruptedPublish(destination, ownership);
  await internalDMGTesting.releaseOutputLock(destination, ownership);
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("dead-owner lock is removed once and its interrupted transaction can recover", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-stale-lock-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  await internalDMGTesting.acquireOutputLock(destination, {
    ownerPID: 2_000_000_000,
    nonce: "11111111-1111-4111-8111-111111111111",
  });
  await prepareInterruptedTransaction(destination, fixture.root, "stale");

  const ownership = await internalDMGTesting.acquireOutputLock(destination, {
    processKill: () => {
      const error = new Error("no such process");
      error.code = "ESRCH";
      throw error;
    },
  });
  const recovered = await recoverInterruptedPublish(destination, ownership);
  assert.deepEqual(recovered, { recovered: true, committed: false });
  await internalDMGTesting.releaseOutputLock(destination, ownership);
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("initializing or invalid output lock is rejected without removing active work", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-unverified-lock-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const activeWork = join(fixture.root, ".blabee-internal-dmg-work-active-owner");
  await mkdir(activeWork, { mode: 0o700 });
  await writeFile(join(activeWork, "sentinel"), "preserve");
  await writeFile(destination.lock, "initializing");

  await assert.rejects(
    internalDMGTesting.acquireOutputLock(destination),
    (error) => (
      /output lock exists but could not be verified; refusing automatic removal/u.test(error.message)
      && error.cause instanceof Error
    ),
  );
  assert.equal(await readFile(destination.lock, "utf8"), "initializing");
  assert.equal(await readFile(join(activeWork, "sentinel"), "utf8"), "preserve");
});

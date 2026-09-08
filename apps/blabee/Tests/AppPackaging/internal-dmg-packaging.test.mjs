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
  truncate,
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
  preflightInternalDMGOutput,
  recoverInterruptedPublish,
  snapshotExecutable,
  verifyInternalAppBundle,
} from "../../scripts/build-internal-dmg.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagingScript = join(repositoryRoot, "scripts", "build-internal-dmg.mjs");
const testBuildNumber = "2";
const expectedNotice = [
  "BLABEE INTERNAL TEST BUILD",
  "",
  "The enclosed Blabee.app is ad-hoc signed.",
  "This disk image is unsigned and is not notarized by Apple.",
  "It is intended only for approved internal testing on macOS 13 or later.",
  "Drag Blabee.app to Applications, then follow the team's test instructions.",
  "Do not redistribute this disk image as a public release.",
  "",
  "내부 테스트 설정:",
  "1. 설정에서 관찰할 프로젝트를 추가합니다.",
  "2. 기존 macOS 자동 시작 서비스가 등록되어 있으면 먼저 등록 해제합니다.",
  "3. 앱 실행형 서비스 켜기를 선택하고 서비스 연결됨을 확인합니다.",
  "4. Codex 연결하기를 누른 뒤 새 Codex 세션의 /hooks에서 직접 검토하고 신뢰합니다.",
  "패널 X는 화면만 닫습니다. 메뉴바 우클릭의 Blabee 종료는 앱과 소유 서비스를 종료합니다.",
  "",
  "알려진 제한: 첫 Keychain 승인 대기로 시작 기한을 넘을 수 있습니다.",
  "예상된 Blabee 요청인지 확인하고, 실패 시 상태를 기록한 뒤 서비스 다시 시작을 사용합니다.",
  "암호 요청이 반복되면 중단하며 Keychain 항목 삭제나 보안 우회를 하지 않습니다.",
  "서비스 메모리 증가가 관찰되어 조사 중입니다. 장시간 안정성 및 다른 Mac 설치 검증은 미완료입니다.",
  "macOS 자동 시작 서비스의 서명 문제를 해결한 빌드가 아니며 앱 실행형 모드는 명시적 opt-in입니다.",
  "상세 절차와 검증 경계는 함께 전달된 INTERNAL_TEST_INSTALL_GUIDE.md를 확인하세요.",
  "",
].join("\n");

async function makeWorkspace(t, prefix = "blabee-internal-dmg-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const binary = join(root, "blabee-coordinator");
  if (process.platform === "darwin") {
    const source = join(root, "coordinator-fixture.c");
    await writeFile(source, "int main(void) { return 0; }\n");
    await execFile("/usr/bin/clang", ["-arch", "arm64", source, "-o", binary]);
  } else {
    await copyFile("/usr/bin/true", binary);
  }
  await chmod(binary, 0o700);
  return {
    root,
    binary,
    output: join(root, "Blabee-internal-test-r2.dmg"),
  };
}

function buildTestInternalDMG(options) {
  return buildInternalDMG({ ...options, buildNumber: testBuildNumber });
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

async function prepareInterruptedTransaction(
  destination,
  parent,
  suffix,
  buildNumber = testBuildNumber,
) {
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
    buildNumber,
    destination,
    workRoot,
    workRootIdentity,
    stagedDMG,
    stagedChecksum,
    sha256,
  });
  return { workRoot, stagedDMG, stagedChecksum };
}

async function rewriteInterruptedTransaction(destination, transform) {
  const payload = JSON.parse(await readFile(destination.transaction, "utf8"));
  transform(payload);
  await writeFile(destination.transaction, `${JSON.stringify(payload)}\n`, "utf8");
}

test("fresh-build preflight preserves a recoverable interrupted publish", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-preflight-recovery-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  await prepareInterruptedTransaction(destination, fixture.root, "preflight");
  const resolved = await preflightInternalDMGOutput(fixture.output, {
    buildNumber: testBuildNumber,
  });
  assert.equal(resolved.output, destination.output);
  assert.equal((await lstat(destination.transaction)).isFile(), true);
});

test("low-level internal DMG CLI directs users to the fresh source builder", async () => {
  const { stdout, stderr } = await execFile(process.execPath, [packagingScript, "--help"]);
  assert.match(stdout, /Direct build-internal-dmg\.mjs CLI packaging is disabled/u);
  assert.match(stdout, /npm run build:internal-dmg/u);
  assert.match(stdout, /--build-number 2/u);
  assert.match(stdout, /Blabee-internal-r2\.dmg/u);
  assert.doesNotMatch(stdout, /--binary \/absolute\/path/u);
  assert.equal(stderr, "");
});

test("low-level internal DMG CLI cannot package a supplied prebuilt binary", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-disabled-low-level-dmg-cli-");
  await assert.rejects(
    execFile(
      process.execPath,
      [packagingScript, "--binary", fixture.binary, "--output", fixture.output],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /direct prebuilt-binary DMG packaging is disabled/u);
      assert.match(error.stderr, /npm run build:internal-dmg/u);
      return true;
    },
  );
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
});

test("internal DMG contains only the signed app, Applications link, and test notice", {
  skip: process.platform !== "darwin" ? "requires macOS hdiutil and codesign" : false,
  timeout: 120_000,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  const result = await buildTestInternalDMG({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
  });

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
  assert.equal(result.app.build, testBuildNumber);
  assert.equal(result.app.minimum_system_version, "13.0");
  assert.deepEqual(result.app.architectures, ["arm64"]);

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
  const mountedApp = await verifyInternalAppBundle(
    join(mounted.mountPoint, "Blabee.app"),
    { expectedBuildNumber: testBuildNumber },
  );
  assert.deepEqual(mountedApp.architectures, result.app.architectures);
  await mounted.detach();
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("low-level internal DMG API requires a canonical build matching the output suffix", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-build-number-");
  await assert.rejects(
    buildInternalDMG({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      platform: "darwin",
    }),
    /build number must be a canonical integer from 1 through 9999/u,
  );
  await assert.rejects(
    buildInternalDMG({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      buildNumber: "02",
      platform: "darwin",
    }),
    /canonical integer from 1 through 9999/u,
  );
  await assert.rejects(
    buildInternalDMG({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      buildNumber: "3",
      platform: "darwin",
    }),
    /--output basename must end with -r3\.dmg/u,
  );
});

test("internal app verification rejects universal and non-arm64 executables", {
  skip: process.platform !== "darwin" ? "requires macOS lipo and codesign" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-architecture-");
  const x86Binary = join(fixture.root, "coordinator-x86_64");
  await execFile("/usr/bin/lipo", [
    "/usr/bin/true",
    "-thin",
    "x86_64",
    "-output",
    x86Binary,
  ]);
  await chmod(x86Binary, 0o700);

  for (const [name, binaryPath] of [
    ["universal", "/usr/bin/true"],
    ["x86_64", x86Binary],
  ]) {
    const appPath = join(fixture.root, name, "Blabee.app");
    await mkdir(dirname(appPath), { recursive: true });
    await assembleMacOSApp({
      binaryPath,
      outputPath: appPath,
      adhocSign: true,
      bundleVersion: testBuildNumber,
    });
    await assert.rejects(
      verifyInternalAppBundle(appPath, { expectedBuildNumber: testBuildNumber }),
      /main executable must contain exactly the arm64 architecture/u,
      name,
    );
  }
});

test("unsafe output names, paths, and pre-existing file or symlink outputs are rejected", {
  skip: process.platform !== "darwin" ? "requires macOS path semantics" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-inputs-");

  await assert.rejects(
    buildTestInternalDMG({ binaryPath: "relative", outputPath: fixture.output }),
    /--binary must be an explicit absolute path/u,
  );
  await assert.rejects(
    buildTestInternalDMG({ binaryPath: fixture.binary, outputPath: "relative-r2.dmg" }),
    /--output must be an explicit absolute path/u,
  );
  await assert.rejects(
    buildTestInternalDMG({
      binaryPath: fixture.binary,
      outputPath: join(fixture.root, "Blabee internal-r2.dmg"),
    }),
    /conservative ASCII/u,
  );
  await assert.rejects(
    buildTestInternalDMG({
      binaryPath: fixture.binary,
      outputPath: "/Applications/Blabee-internal-test-r2.dmg",
    }),
    /inside the Blabee repository|direct writes to \/Applications/u,
  );

  await writeFile(fixture.output, "keep me");
  await assert.rejects(
    buildTestInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /DMG output already exists/u,
  );
  assert.equal(await readFile(fixture.output, "utf8"), "keep me");
  await rm(fixture.output);

  await writeFile(`${fixture.output}.sha256`, "keep checksum");
  await assert.rejects(
    buildTestInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /checksum output already exists/u,
  );
  assert.equal(await readFile(`${fixture.output}.sha256`, "utf8"), "keep checksum");
  assert.equal(await lstat(fixture.output).catch((error) => error.code), "ENOENT");
  await rm(`${fixture.output}.sha256`);

  await symlink("/path/that/does/not/exist", fixture.output);
  await assert.rejects(
    buildTestInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
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
    buildTestInternalDMG({ binaryPath: scriptBinary, outputPath: fixture.output }),
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
  let prePublishValidationCount = 0;
  const prePublishValidation = async () => {
    const workRootName = (await readdir(fixture.root)).find(
      (name) => name.startsWith(".blabee-internal-dmg-work-"),
    );
    assert.notEqual(workRootName, undefined);
    const workEntries = await readdir(join(fixture.root, workRootName));
    assert.ok(workEntries.includes("artifact.staged.dmg"));
    assert.ok(workEntries.includes("artifact.staged.dmg.sha256"));
    prePublishValidationCount += 1;
  };
  const results = await Promise.allSettled([
    buildTestInternalDMG({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      prePublishValidation,
    }),
    buildTestInternalDMG({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      prePublishValidation,
    }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(prePublishValidationCount, 1);
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

test("pre-publish validation rejection leaves no artifact or packaging residue", {
  skip: process.platform !== "darwin" ? "requires macOS hdiutil and codesign" : false,
  timeout: 120_000,
}, async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-prepublish-");
  let validationCount = 0;
  const compatiblePreviousApps = [];
  const packaging = buildTestInternalDMG({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    compatiblePreviousApps,
    prePublishValidation: async () => {
      validationCount += 1;
      throw new Error("release inputs changed before publish");
    },
  });
  compatiblePreviousApps.push("relative-mutation-after-call");
  await assert.rejects(
    packaging,
    /release inputs changed before publish/u,
  );
  assert.equal(validationCount, 1);
  assert.equal(await lstat(fixture.output).catch((error) => error.code), "ENOENT");
  assert.equal(await lstat(`${fixture.output}.sha256`).catch((error) => error.code), "ENOENT");
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
    buildNumber: testBuildNumber,
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

  const recovered = await recoverInterruptedPublish(destination, outputLock, {
    buildNumber: testBuildNumber,
  });
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

test("v2 completed recovery keeps the exact build-bound artifact pair", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-v2-completed-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const outputLock = await internalDMGTesting.acquireOutputLock(destination);
  const interrupted = await prepareInterruptedTransaction(
    destination,
    fixture.root,
    "v2-completed",
  );
  await internalDMGTesting.publishExclusive(
    interrupted.stagedChecksum,
    destination.checksum,
    "checksum output",
  );
  await internalDMGTesting.publishExclusive(
    interrupted.stagedDMG,
    destination.output,
    "DMG output",
  );

  const recovered = await recoverInterruptedPublish(destination, outputLock, {
    buildNumber: testBuildNumber,
  });
  assert.deepEqual(recovered, { recovered: true, committed: true });
  assert.equal(
    await readFile(destination.checksum, "utf8"),
    `${await digest(destination.output)}  ${basename(destination.output)}\n`,
  );
  assert.equal(await lstat(destination.transaction).catch((error) => error.code), "ENOENT");
  assert.equal(await lstat(interrupted.workRoot).catch((error) => error.code), "ENOENT");
  await internalDMGTesting.releaseOutputLock(destination, outputLock);
});

test("interrupted transaction recovery rejects mismatched build and architecture metadata", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-transaction-contract-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const outputLock = await internalDMGTesting.acquireOutputLock(destination);
  await prepareInterruptedTransaction(destination, fixture.root, "contract");

  await rewriteInterruptedTransaction(destination, (payload) => {
    payload.build_number = "1";
  });
  await assert.rejects(
    recoverInterruptedPublish(destination, outputLock, { buildNumber: testBuildNumber }),
    /transaction build number differs from the requested build/u,
  );

  await rewriteInterruptedTransaction(destination, (payload) => {
    payload.build_number = testBuildNumber;
    payload.expected_architecture = "x86_64";
  });
  await assert.rejects(
    recoverInterruptedPublish(destination, outputLock, { buildNumber: testBuildNumber }),
    /transaction architecture differs from the internal DMG target/u,
  );
  await internalDMGTesting.releaseOutputLock(destination, outputLock);
});

test("legacy v1 completed output cannot be recovered under a current build suffix", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-legacy-recovery-");
  const currentBuildNumber = "8";
  const output = join(fixture.root, `Blabee-internal-test-r${currentBuildNumber}.dmg`);
  const destination = await internalDMGTesting.resolveOutput(output);
  const outputLock = await internalDMGTesting.acquireOutputLock(destination);
  const interrupted = await prepareInterruptedTransaction(
    destination,
    fixture.root,
    "legacy",
    currentBuildNumber,
  );
  await rewriteInterruptedTransaction(destination, (payload) => {
    payload.schema_version = "blabee.internal-dmg-publish.v1";
    delete payload.build_number;
    delete payload.expected_architecture;
  });
  await internalDMGTesting.publishExclusive(
    interrupted.stagedChecksum,
    destination.checksum,
    "checksum output",
  );
  await internalDMGTesting.publishExclusive(
    interrupted.stagedDMG,
    destination.output,
    "DMG output",
  );

  await assert.rejects(
    recoverInterruptedPublish(destination, outputLock, {
      buildNumber: currentBuildNumber,
    }),
    /legacy interrupted publish transactions cannot be recovered/u,
  );
  assert.equal((await lstat(destination.output)).isFile(), true);
  assert.equal((await lstat(destination.checksum)).isFile(), true);
  assert.equal((await lstat(destination.transaction)).isFile(), true);
  await internalDMGTesting.releaseOutputLock(destination, outputLock);
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

test("pinned executable cleanup preserves a replacement at its destination", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-snapshot-cleanup-race-");
  const workRoot = join(fixture.root, "work");
  const snapshotPath = join(workRoot, "blabee-coordinator.pinned");
  await mkdir(workRoot, { mode: 0o700 });
  await assert.rejects(
    snapshotExecutable(fixture.binary, workRoot, {
      afterSnapshotChunk: async () => {
        await rename(snapshotPath, `${snapshotPath}.original`);
        await writeFile(snapshotPath, "replacement must survive");
        throw new Error("injected snapshot failure");
      },
    }),
    /injected snapshot failure/u,
  );
  assert.equal(await readFile(snapshotPath, "utf8"), "replacement must survive");
  assert.equal((await lstat(`${snapshotPath}.original`)).isFile(), true);
});

test("pinned executable bounds its initial extent and rejects concurrent append growth", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-append-bound-");
  const workRoot = join(fixture.root, "work");
  await mkdir(workRoot, { mode: 0o700 });
  let appended = false;
  await assert.rejects(
    snapshotExecutable(fixture.binary, workRoot, {
      afterSnapshotChunk: async () => {
        if (appended) return;
        appended = true;
        await writeFile(fixture.binary, "growth", { flag: "a" });
      },
    }),
    /grew beyond its initial size while its pinned snapshot was being created/u,
  );
  assert.equal(
    await lstat(join(workRoot, "blabee-coordinator.pinned")).catch((error) => error.code),
    "ENOENT",
  );

  const oversized = join(fixture.root, "oversized-coordinator");
  await writeFile(oversized, "x", { mode: 0o700 });
  await truncate(oversized, (512 * 1024 * 1024) + 1);
  await assert.rejects(
    snapshotExecutable(oversized, workRoot),
    /exceeds the 536870912-byte coordinator limit/u,
  );
  assert.equal(
    await lstat(join(workRoot, "blabee-coordinator.pinned")).catch((error) => error.code),
    "ENOENT",
  );
});

test("pinned executable open rejects FIFO and symlink replacement without blocking", {
  skip: process.platform !== "darwin" ? "requires macOS FIFO open semantics" : false,
  timeout: 2_000,
}, async (t) => {
  for (const replacement of ["fifo", "symlink"]) {
    const fixture = await makeWorkspace(
      t,
      `blabee-internal-dmg-${replacement}-open-race-`,
    );
    const workRoot = join(fixture.root, "work");
    await mkdir(workRoot, { mode: 0o700 });
    await assert.rejects(
      snapshotExecutable(fixture.binary, workRoot, {
        afterBinaryLstat: async () => {
          await rename(fixture.binary, `${fixture.binary}.original`);
          if (replacement === "fifo") {
            await execFile("/usr/bin/mkfifo", [fixture.binary]);
          } else {
            await symlink("/usr/bin/true", fixture.binary);
          }
        },
      }),
      replacement === "fifo"
        ? /--binary changed while it was being opened/u
        : /ELOOP|symbolic links?/iu,
    );
    assert.equal(
      await lstat(join(workRoot, "blabee-coordinator.pinned"))
        .catch((error) => error.code),
      "ENOENT",
    );
  }
});

test("DMG hashing bounds its initial extent and rejects oversized sparse artifacts", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-hash-bound-");
  const artifact = join(fixture.root, "artifact.dmg");
  await writeFile(artifact, Buffer.alloc((64 * 1024) + 1, 0x41));
  let appended = false;
  await assert.rejects(
    internalDMGTesting.streamSHA256(artifact, {
      afterReadChunk: async () => {
        if (appended) return;
        appended = true;
        await writeFile(artifact, "growth", { flag: "a" });
      },
    }),
    /grew beyond its initial size while it was being hashed/u,
  );

  const oversized = join(fixture.root, "oversized.dmg");
  await writeFile(oversized, "x");
  await truncate(oversized, (1024 * 1024 * 1024) + 1);
  await assert.rejects(
    internalDMGTesting.streamSHA256(oversized),
    /exceeds the 1073741824-byte limit/u,
  );
});

test("DMG hashing rejects FIFO and symlink replacement without blocking", {
  skip: process.platform !== "darwin" ? "requires macOS FIFO open semantics" : false,
  timeout: 2_000,
}, async (t) => {
  for (const replacement of ["fifo", "symlink"]) {
    const fixture = await makeWorkspace(
      t,
      `blabee-internal-dmg-hash-${replacement}-race-`,
    );
    const artifact = join(fixture.root, "artifact.dmg");
    await writeFile(artifact, "artifact");
    await assert.rejects(
      internalDMGTesting.streamSHA256(artifact, {
        afterLstat: async () => {
          await rename(artifact, `${artifact}.original`);
          if (replacement === "fifo") {
            await execFile("/usr/bin/mkfifo", [artifact]);
          } else {
            await symlink("/usr/bin/true", artifact);
          }
        },
      }),
      replacement === "fifo"
        ? /changed while it was being opened for hashing/u
        : /ELOOP|symbolic links?/iu,
    );
  }
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
    buildTestInternalDMG({ binaryPath: fixture.binary, outputPath: fixture.output }),
    new RegExp(`locked by active process ${process.pid}`, "u"),
  );
  assert.equal((await lstat(interrupted.workRoot)).isDirectory(), true);
  assert.equal((await lstat(destination.transaction)).isFile(), true);

  await recoverInterruptedPublish(destination, ownership, {
    buildNumber: testBuildNumber,
  });
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
  const recovered = await recoverInterruptedPublish(destination, ownership, {
    buildNumber: testBuildNumber,
  });
  assert.deepEqual(recovered, { recovered: true, committed: false });
  await internalDMGTesting.releaseOutputLock(destination, ownership);
  assert.deepEqual(hiddenPackagingArtifacts(await readdir(fixture.root)), []);
});

test("stale output-lock recovery fails closed when the lock path is replaced", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-stale-lock-race-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  await internalDMGTesting.acquireOutputLock(destination, {
    ownerPID: 2_000_000_000,
    nonce: "22222222-2222-4222-8222-222222222222",
  });
  await assert.rejects(
    internalDMGTesting.acquireOutputLock(destination, {
      processKill: () => {
        const error = new Error("no such process");
        error.code = "ESRCH";
        throw error;
      },
      beforeStaleLockRemoval: async () => {
        await rename(destination.lock, `${destination.lock}.original`);
        await writeFile(destination.lock, "replacement must survive");
      },
    }),
    (error) => (
      error.preservePackagingWork === true
      && /stale internal DMG output lock changed before cleanup \(identityMismatch\)/u
        .test(error.message)
    ),
  );
  assert.equal(await readFile(destination.lock, "utf8"), "replacement must survive");
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

test("output lock reads reject concurrent append growth", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-lock-append-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  await internalDMGTesting.acquireOutputLock(destination);
  let appended = false;
  await assert.rejects(
    internalDMGTesting.readOutputLock(destination, {
      afterReadChunk: async () => {
        if (appended) return;
        appended = true;
        await writeFile(destination.lock, " ", { flag: "a" });
      },
    }),
    /grew beyond its initial size while it was being read/u,
  );
});

test("output lock reads reject FIFO and symlink replacement without blocking", {
  skip: process.platform !== "darwin" ? "requires macOS FIFO open semantics" : false,
  timeout: 2_000,
}, async (t) => {
  for (const replacement of ["fifo", "symlink"]) {
    const fixture = await makeWorkspace(
      t,
      `blabee-internal-dmg-lock-${replacement}-race-`,
    );
    const destination = await internalDMGTesting.resolveOutput(fixture.output);
    await internalDMGTesting.acquireOutputLock(destination);
    await assert.rejects(
      internalDMGTesting.readOutputLock(destination, {
        afterLstat: async () => {
          await rename(destination.lock, `${destination.lock}.original`);
          if (replacement === "fifo") {
            await execFile("/usr/bin/mkfifo", [destination.lock]);
          } else {
            await symlink("/usr/bin/true", destination.lock);
          }
        },
      }),
      replacement === "fifo"
        ? /changed while it was being opened/u
        : /ELOOP|symbolic links?/iu,
    );
  }
});

test("output-lock release reports replacement instead of claiming success", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-lock-release-race-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const ownership = await internalDMGTesting.acquireOutputLock(destination);
  await assert.rejects(
    internalDMGTesting.releaseOutputLock(destination, ownership, {
      beforeRemoval: async () => {
        await rename(destination.lock, `${destination.lock}.original`);
        await writeFile(destination.lock, "replacement must survive");
      },
    }),
    (error) => (
      error.preservePackagingWork === true
      && /internal DMG output lock changed before cleanup \(identityMismatch\)/u
        .test(error.message)
    ),
  );
  assert.equal(await readFile(destination.lock, "utf8"), "replacement must survive");
});

test("interrupted recovery preserves evidence when its transaction marker is replaced", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-marker-cleanup-race-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const outputLock = await internalDMGTesting.acquireOutputLock(destination);
  const interrupted = await prepareInterruptedTransaction(
    destination,
    fixture.root,
    "marker-cleanup",
  );
  await assert.rejects(
    recoverInterruptedPublish(destination, outputLock, {
      buildNumber: testBuildNumber,
      beforeTransactionMarkerCleanup: async () => {
        await rename(destination.transaction, `${destination.transaction}.original`);
        await writeFile(destination.transaction, "replacement must survive");
      },
    }),
    (error) => (
      error.preservePackagingWork === true
      && /transaction marker changed before cleanup \(identityMismatch\)/u
        .test(error.message)
    ),
  );
  assert.equal(await readFile(destination.transaction, "utf8"), "replacement must survive");
  assert.equal((await lstat(interrupted.workRoot)).isDirectory(), true);
  await internalDMGTesting.releaseOutputLock(destination, outputLock);
});

test("checksum-only recovery preserves a replacement at the published checksum path", async (t) => {
  const fixture = await makeWorkspace(t, "blabee-internal-dmg-checksum-cleanup-race-");
  const destination = await internalDMGTesting.resolveOutput(fixture.output);
  const outputLock = await internalDMGTesting.acquireOutputLock(destination);
  const interrupted = await prepareInterruptedTransaction(
    destination,
    fixture.root,
    "checksum-cleanup",
  );
  await internalDMGTesting.publishExclusive(
    interrupted.stagedChecksum,
    destination.checksum,
    "checksum output",
  );

  await assert.rejects(
    recoverInterruptedPublish(destination, outputLock, {
      buildNumber: testBuildNumber,
      beforeChecksumOnlyCleanup: async () => {
        await rename(destination.checksum, `${destination.checksum}.original`);
        await writeFile(destination.checksum, "replacement must survive");
      },
    }),
    (error) => (
      error.preservePackagingWork === true
      && /published checksum changed before cleanup \(identityMismatch\)/u.test(error.message)
    ),
  );
  assert.equal(await readFile(destination.checksum, "utf8"), "replacement must survive");
  assert.equal((await lstat(`${destination.checksum}.original`)).isFile(), true);
  assert.equal((await lstat(destination.transaction)).isFile(), true);
  assert.equal((await lstat(interrupted.workRoot)).isDirectory(), true);
  await internalDMGTesting.releaseOutputLock(destination, outputLock);
});

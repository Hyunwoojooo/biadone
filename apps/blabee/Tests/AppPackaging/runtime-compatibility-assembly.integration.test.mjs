import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assembleMacOSApp,
  inspectSignedRuntimeIdentity,
} from "../../scripts/build-macos-app.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const swiftPackageRoot = join(repositoryRoot, "src", "coordinator-swift");

async function buildRealCoordinator() {
  const moduleCache = join(
    swiftPackageRoot,
    ".build",
    "blabee-runtime-compatibility-module-cache",
  );
  await mkdir(moduleCache, { recursive: true });
  const environment = {
    ...process.env,
    DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
    CLANG_MODULE_CACHE_PATH: moduleCache,
    SWIFTPM_MODULECACHE_OVERRIDE: moduleCache,
  };
  await execFile(
    "/usr/bin/xcrun",
    [
      "swift",
      "build",
      "--package-path",
      swiftPackageRoot,
      "--disable-sandbox",
      "--configuration",
      "debug",
      "--product",
      "blabee-coordinator",
    ],
    {
      env: environment,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  const { stdout } = await execFile(
    "/usr/bin/xcrun",
    [
      "swift",
      "build",
      "--package-path",
      swiftPackageRoot,
      "--disable-sandbox",
      "--configuration",
      "debug",
      "--show-bin-path",
    ],
    {
      env: environment,
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    },
  );
  return join(stdout.trim(), "blabee-coordinator");
}

async function signApp(appPath) {
  await execFile(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--options",
      "runtime",
      appPath,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  await execFile(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { maxBuffer: 1024 * 1024 },
  );
}

async function rewriteAsLegacyV1(appPath, { bundleIdentifier } = {}) {
  const manifestPath = join(
    appPath,
    "Contents",
    "Resources",
    "assembly-manifest.json",
  );
  const current = JSON.parse(await readFile(manifestPath, "utf8"));
  if (bundleIdentifier !== undefined) {
    const infoPath = join(appPath, "Contents", "Info.plist");
    const original = await readFile(infoPath, "utf8");
    const updated = original.replace(
      "<string>com.biadone.blabee</string>",
      `<string>${bundleIdentifier}</string>`,
    );
    assert.notEqual(updated, original);
    await writeFile(infoPath, updated);
    const infoEntry = current.files.find(
      (entry) => entry.path === "Contents/Info.plist",
    );
    const infoData = await readFile(infoPath);
    infoEntry.sha256 = createHash("sha256").update(infoData).digest("hex");
    infoEntry.size = infoData.length;
  }
  const legacy = {
    schema_version: "blabee.macos-app-assembly.v1",
    bundle_identifier: current.bundle_identifier,
    hash_phase: current.hash_phase,
    files: current.files,
  };
  await writeFile(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`, {
    mode: 0o644,
  });
}

async function makeLegacyApp(coordinator, root, name, options = {}) {
  const parent = join(root, name);
  await mkdir(parent);
  const app = join(parent, "Blabee.app");
  await assembleMacOSApp({
    binaryPath: coordinator,
    outputPath: app,
    adhocSign: false,
  });
  await rewriteAsLegacyV1(app, options);
  if (options.signed !== false) await signApp(app);
  return app;
}

test("real signed v1 and v2 apps enforce the previous-runtime verification boundary", {
  skip: process.platform !== "darwin" ? "Security.framework and codesign require macOS" : false,
  timeout: 240_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blabee-runtime-compatibility-integration-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const coordinator = await buildRealCoordinator();

  const signedLegacy = await makeLegacyApp(
    coordinator,
    root,
    "signed-legacy",
  );
  const legacyInspection = await inspectSignedRuntimeIdentity({
    coordinatorBinaryPath: coordinator,
    appPath: signedLegacy,
  });
  assert.match(legacyInspection.runtimeIdentity, /^sha256:[0-9a-f]{64}$/u);

  const v2Parent = join(root, "signed-v2");
  await mkdir(v2Parent);
  const signedV2 = join(v2Parent, "Blabee.app");
  const assembledV2 = await assembleMacOSApp({
    binaryPath: coordinator,
    outputPath: signedV2,
    adhocSign: true,
    compatiblePreviousApps: [signedLegacy],
  });
  assert.deepEqual(assembledV2.manifest.compatible_previous_runtimes, [{
    runtime_identity: legacyInspection.runtimeIdentity,
    allowed_request_types: [
      "emit_decision",
      "session_start",
      "stop",
      "user_prompt_submit",
    ],
  }]);
  const v2Inspection = await inspectSignedRuntimeIdentity({
    coordinatorBinaryPath: coordinator,
    appPath: signedV2,
  });
  assert.match(v2Inspection.runtimeIdentity, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(v2Inspection.runtimeIdentity, legacyInspection.runtimeIdentity);

  const unsignedLegacy = await makeLegacyApp(
    coordinator,
    root,
    "unsigned-legacy",
    { signed: false },
  );
  await assert.rejects(
    inspectSignedRuntimeIdentity({
      coordinatorBinaryPath: coordinator,
      appPath: unsignedLegacy,
    }),
    /identity inspection failed/,
  );

  const mutatedLegacy = await makeLegacyApp(
    coordinator,
    root,
    "mutated-legacy",
  );
  const iconPath = join(
    mutatedLegacy,
    "Contents",
    "Resources",
    "BlabeeMenuBar.svg",
  );
  await writeFile(
    iconPath,
    Buffer.concat([await readFile(iconPath), Buffer.from("\n<!-- tampered -->\n")]),
  );
  await assert.rejects(
    inspectSignedRuntimeIdentity({
      coordinatorBinaryPath: coordinator,
      appPath: mutatedLegacy,
    }),
    /identity inspection failed/,
  );

  const wrongIdentifier = await makeLegacyApp(
    coordinator,
    root,
    "wrong-identifier",
    { bundleIdentifier: "com.example.not-blabee" },
  );
  await assert.rejects(
    inspectSignedRuntimeIdentity({
      coordinatorBinaryPath: coordinator,
      appPath: wrongIdentifier,
    }),
    /identity inspection failed/,
  );

  const invalidV2Parent = join(root, "invalid-v2-policy");
  await mkdir(invalidV2Parent);
  const invalidV2 = join(invalidV2Parent, "Blabee.app");
  await assembleMacOSApp({
    binaryPath: coordinator,
    outputPath: invalidV2,
    adhocSign: false,
  });
  const invalidV2ManifestPath = join(
    invalidV2,
    "Contents",
    "Resources",
    "assembly-manifest.json",
  );
  const invalidV2Manifest = JSON.parse(await readFile(invalidV2ManifestPath, "utf8"));
  invalidV2Manifest.compatible_previous_runtimes = [{
    runtime_identity: `sha256:${"A".repeat(64)}`,
    allowed_request_types: ["emit_decision"],
  }];
  await writeFile(
    invalidV2ManifestPath,
    `${JSON.stringify(invalidV2Manifest, null, 2)}\n`,
  );
  await signApp(invalidV2);
  await assert.rejects(
    inspectSignedRuntimeIdentity({
      coordinatorBinaryPath: coordinator,
      appPath: invalidV2,
    }),
    /identity inspection failed/,
  );

  assert.equal((await lstat(signedV2)).isDirectory(), true);
});

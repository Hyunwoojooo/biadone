import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildFreshInternalDMG,
  fingerprintReleaseInputs,
  freshInternalDMGTesting,
  makeSwiftReleaseBuildArguments,
  selectFullXcodeToolchain,
} from "../../scripts/build-fresh-internal-dmg.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const buildScript = join(repositoryRoot, "scripts", "build-fresh-internal-dmg.mjs");
const testBuildNumber = "2";

async function makeSourceFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "blabee-fresh-dmg-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "src", "coordinator-swift");
  await mkdir(join(packageRoot, "Sources", "BlabeeCoordinator"), { recursive: true });
  await mkdir(join(root, "Contracts", "v1"), { recursive: true });
  await mkdir(join(root, "Plugin", "blabee"), { recursive: true });
  await mkdir(join(root, "Packaging", "macos"), { recursive: true });
  await writeFile(join(packageRoot, "Package.swift"), "// swift-tools-version: 6.0\n");
  await writeFile(
    join(packageRoot, "Sources", "BlabeeCoordinator", "main.swift"),
    "print(\"test\")\n",
  );
  await writeFile(join(root, "Contracts", "v1", "contract.json"), "{}\n");
  await writeFile(join(root, "Plugin", "blabee", "plugin.json"), "{}\n");
  await writeFile(join(root, "Packaging", "macos", "Info.plist"), "plist\n");
  return { root, packageRoot, output: join(root, "Blabee-internal-r2.dmg") };
}

async function makeExternalWorkRoot(t, name) {
  const parent = await mkdtemp(join(tmpdir(), `blabee-${name}-`));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const work = join(parent, name);
  await mkdir(work, { mode: 0o700 });
  return work;
}

test("fresh internal DMG CLI documents source build and rejects prebuilt binary arguments", async () => {
  const { stdout, stderr } = await execFile(process.execPath, [buildScript, "--help"]);
  assert.match(stdout, /Builds the current Swift source/u);
  assert.match(stdout, /Prebuilt --binary inputs are intentionally unsupported/u);
  assert.equal(stderr, "");
  assert.throws(
    () => freshInternalDMGTesting.parseCLIArguments(["--binary", "/tmp/old"]),
    /unsupported argument: --binary/u,
  );
});

test("the documented npm command always enters the fresh build pipeline", async () => {
  const packageJSON = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(
    packageJSON.scripts["build:internal-dmg"],
    "node scripts/build-fresh-internal-dmg.mjs",
  );
});

test("fresh internal DMG CLI accepts one output and at most two previous apps", () => {
  assert.deepEqual(
    freshInternalDMGTesting.parseCLIArguments([
      "--build-number",
      testBuildNumber,
      "--output",
      "/tmp/Blabee-r2.dmg",
      "--compatible-previous-app",
      "/tmp/old-1/Blabee.app",
      "--compatible-previous-app",
      "/tmp/old-2/Blabee.app",
    ]),
    {
      outputPath: "/tmp/Blabee-r2.dmg",
      buildNumber: testBuildNumber,
      compatiblePreviousApps: [
        "/tmp/old-1/Blabee.app",
        "/tmp/old-2/Blabee.app",
      ],
      help: false,
    },
  );
  assert.throws(
    () => freshInternalDMGTesting.parseCLIArguments([
      "--build-number", testBuildNumber,
      "--output", "/tmp/one-r2.dmg", "--output", "/tmp/two-r2.dmg",
    ]),
    /--output may be provided only once/u,
  );
});

test("fresh internal DMG CLI requires a canonical build number matching the output", () => {
  assert.throws(
    () => freshInternalDMGTesting.parseCLIArguments([
      "--output", "/tmp/Blabee-r2.dmg",
    ]),
    /--build-number is required/u,
  );
  for (const value of ["0", "01", "10000", "1.5", "+2"]) {
    assert.throws(
      () => freshInternalDMGTesting.parseCLIArguments([
        "--build-number", value,
        "--output", "/tmp/Blabee-r2.dmg",
      ]),
      /canonical integer from 1 through 9999/u,
      value,
    );
  }
  assert.throws(
    () => freshInternalDMGTesting.parseCLIArguments([
      "--build-number", "3",
      "--output", "/tmp/Blabee-r2.dmg",
    ]),
    /--output basename must end with -r3\.dmg/u,
  );
  for (const value of ["1", "9999"]) {
    assert.equal(
      freshInternalDMGTesting.parseCLIArguments([
        "--build-number", value,
        "--output", `/tmp/Blabee-r${value}.dmg`,
      ]).buildNumber,
      value,
    );
  }
});

test("toolchain selection skips Command Line Tools and falls back to a matching full Xcode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blabee-xcode-selection-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const developerDirectory = join(root, "Xcode.app", "Contents", "Developer");
  const swift = join(
    developerDirectory,
    "Toolchains",
    "XcodeDefault.xctoolchain",
    "usr",
    "bin",
    "swift",
  );
  const sdk = join(
    developerDirectory,
    "Platforms",
    "MacOSX.platform",
    "Developer",
    "SDKs",
    "MacOSX.test.sdk",
  );
  const xcodebuild = join(developerDirectory, "usr", "bin", "xcodebuild");
  await mkdir(dirname(swift), { recursive: true });
  await mkdir(sdk, { recursive: true });
  await mkdir(dirname(xcodebuild), { recursive: true });
  await writeFile(swift, "swift");
  await writeFile(xcodebuild, "xcodebuild");
  await chmod(swift, 0o700);
  await chmod(xcodebuild, 0o700);

  const invocations = [];
  const runner = async (file, args, options) => {
    invocations.push({ file, args, developerDirectory: options?.env?.DEVELOPER_DIR });
    if (file === "/usr/bin/xcode-select") {
      return { stdout: "/Library/Developer/CommandLineTools\n", stderr: "" };
    }
    if (args[0] === "--find") return { stdout: `${swift}\n`, stderr: "" };
    if (args.includes("--show-sdk-path")) return { stdout: `${sdk}\n`, stderr: "" };
    if (args.includes("-print-target-info")) {
      return { stdout: JSON.stringify({ target: { triple: "arm64-apple-macosx15.0" } }), stderr: "" };
    }
    return { stdout: "Xcode test\n", stderr: "" };
  };

  const selected = await selectFullXcodeToolchain({
    platform: "darwin",
    environment: {
      SDKROOT: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
      SWIFT_EXEC: "/tmp/untrusted-swift",
      TOOLCHAINS: "stale-toolchain",
    },
    fallbackDeveloperDirectory: developerDirectory,
    runner,
  });
  assert.equal(selected.developerDirectory, await realpath(developerDirectory));
  assert.equal(selected.swift, await realpath(swift));
  assert.equal(selected.sdk, await realpath(sdk));
  assert.equal(selected.environment.SDKROOT, await realpath(sdk));
  assert.equal("SWIFT_EXEC" in selected.environment, false);
  assert.equal("TOOLCHAINS" in selected.environment, false);
  assert.ok(invocations.some((item) => item.file === "/usr/bin/xcode-select"));
  assert.ok(
    invocations
      .filter((item) => item.file === "/usr/bin/xcrun")
      .every((item) => item.developerDirectory === selected.developerDirectory),
  );
});

test("toolchain selection fails clearly when only Command Line Tools are available", async () => {
  const runner = async (file) => {
    if (file === "/usr/bin/xcode-select") {
      return { stdout: "/Library/Developer/CommandLineTools\n", stderr: "" };
    }
    throw new Error("unexpected probe");
  };
  await assert.rejects(
    selectFullXcodeToolchain({
      platform: "darwin",
      environment: {},
      fallbackDeveloperDirectory: "/Applications/Missing-Xcode.app/Contents/Developer",
      runner,
    }),
    /no usable full Xcode toolchain.*Command Line Tools alone are not used/u,
  );
});

test("release build arguments pin package and output to the fresh scratch path", () => {
  const args = makeSwiftReleaseBuildArguments({
    sourceRoot: "/workspace/blabee",
    packageRoot: "/workspace/blabee/src/coordinator-swift",
    scratchPath: "/private/tmp/fresh/swift-build",
  });
  assert.deepEqual(args.slice(0, 4), ["--sdk", "macosx", "swift", "build"]);
  assert.deepEqual(args.slice(args.indexOf("--package-path"), args.indexOf("--package-path") + 2), [
    "--package-path", "/workspace/blabee/src/coordinator-swift",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--scratch-path"), args.indexOf("--scratch-path") + 2), [
    "--scratch-path", "/private/tmp/fresh/swift-build",
  ]);
  assert.ok(args.includes("--product"));
  assert.ok(args.includes("blabee-coordinator"));
  assert.deepEqual(args.slice(args.indexOf("--arch"), args.indexOf("--arch") + 2), [
    "--arch", "arm64",
  ]);
  assert.ok(args.includes("/workspace/blabee=/blabee"));
  assert.equal(args.includes(".build/release/blabee-coordinator"), false);
});

test("fresh coordinator build pins its SDK and removes compiler override variables", async (t) => {
  const fixture = await makeSourceFixture(t);
  const workRoot = join(fixture.root, "build-environment-work");
  await mkdir(workRoot);
  const binaryDirectory = join(workRoot, "swift-build", "arm64", "release");
  const binary = join(binaryDirectory, "blabee-coordinator");
  const invocations = [];
  const runner = async (file, args, options) => {
    invocations.push({ args, environment: options?.env });
    if (file === "/usr/bin/lipo") {
      return { stdout: "arm64\n", stderr: "" };
    }
    if (args.includes("--show-bin-path")) {
      return { stdout: `${binaryDirectory}\n`, stderr: "" };
    }
    await mkdir(binaryDirectory, { recursive: true });
    await writeFile(binary, "fresh coordinator", { mode: 0o700 });
    return { stdout: "", stderr: "" };
  };
  const { buildFreshCoordinator } = await import(
    "../../scripts/build-fresh-internal-dmg.mjs"
  );
  await buildFreshCoordinator({
    sourceRoot: fixture.root,
    packageRoot: fixture.packageRoot,
    workRoot,
    toolchain: {
      developerDirectory: "/tmp/Xcode.app/Contents/Developer",
      sdk: "/tmp/Xcode.app/Contents/Developer/SDKs/MacOSX.sdk",
      environment: {
        SDKROOT: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
        SWIFT_EXEC: "/tmp/untrusted-swift",
        SWIFT_DRIVER_SWIFT_EXEC: "/tmp/untrusted-driver",
        TOOLCHAINS: "stale-toolchain",
      },
    },
    runner,
  });
  assert.equal(invocations.length, 3);
  for (const invocation of invocations.slice(0, 2)) {
    assert.deepEqual(invocation.args.slice(0, 4), ["--sdk", "macosx", "swift", "build"]);
    assert.equal(
      invocation.environment.SDKROOT,
      "/tmp/Xcode.app/Contents/Developer/SDKs/MacOSX.sdk",
    );
    assert.equal("SWIFT_EXEC" in invocation.environment, false);
    assert.equal("SWIFT_DRIVER_SWIFT_EXEC" in invocation.environment, false);
    assert.equal("TOOLCHAINS" in invocation.environment, false);
  }
  assert.deepEqual(invocations[2].args, ["-archs", await realpath(binary)]);
});

test("fresh coordinator build rejects universal and non-arm64 output", async (t) => {
  const fixture = await makeSourceFixture(t);
  for (const architectureOutput of ["x86_64", "x86_64 arm64"]) {
    const name = architectureOutput.replaceAll(" ", "-");
    const workRoot = join(fixture.root, `wrong-architecture-${name}`);
    const binaryDirectory = join(workRoot, "swift-build", "release");
    const binary = join(binaryDirectory, "blabee-coordinator");
    await mkdir(workRoot);
    const runner = async (file, args) => {
      if (file === "/usr/bin/lipo") {
        return { stdout: `${architectureOutput}\n`, stderr: "" };
      }
      if (args.includes("--show-bin-path")) {
        return { stdout: `${binaryDirectory}\n`, stderr: "" };
      }
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(binary, "fresh coordinator", { mode: 0o700 });
      return { stdout: "", stderr: "" };
    };
    const { buildFreshCoordinator } = await import(
      "../../scripts/build-fresh-internal-dmg.mjs"
    );
    await assert.rejects(
      buildFreshCoordinator({
        sourceRoot: fixture.root,
        packageRoot: fixture.packageRoot,
        workRoot,
        toolchain: {
          developerDirectory: "/tmp/Xcode.app/Contents/Developer",
          sdk: "/tmp/Xcode.app/Contents/Developer/SDKs/MacOSX.sdk",
          environment: {},
        },
        runner,
      }),
      /fresh coordinator must contain exactly the arm64 architecture/u,
      architectureOutput,
    );
  }
});

test("fresh coordinator scans local-path markers across bounded read chunks", async (t) => {
  const fixture = await makeSourceFixture(t);
  const workRoot = join(fixture.root, "streaming-marker-work");
  await mkdir(workRoot);
  const binaryDirectory = join(workRoot, "swift-build", "arm64", "release");
  const binary = join(binaryDirectory, "blabee-coordinator");
  const runner = async (_file, args) => {
    if (args.includes("--show-bin-path")) {
      return { stdout: `${binaryDirectory}\n`, stderr: "" };
    }
    await mkdir(binaryDirectory, { recursive: true });
    await writeFile(
      binary,
      Buffer.concat([
        Buffer.alloc((64 * 1024) - 3, 0x41),
        Buffer.from("/Users/private/build", "utf8"),
      ]),
      { mode: 0o700 },
    );
    return { stdout: "", stderr: "" };
  };
  const { buildFreshCoordinator } = await import(
    "../../scripts/build-fresh-internal-dmg.mjs"
  );
  await assert.rejects(
    buildFreshCoordinator({
      sourceRoot: fixture.root,
      packageRoot: fixture.packageRoot,
      workRoot,
      toolchain: {
        developerDirectory: "/tmp/Xcode.app/Contents/Developer",
        sdk: "/tmp/Xcode.app/Contents/Developer/SDKs/MacOSX.sdk",
        environment: {},
      },
      runner,
    }),
    /fresh coordinator output contains a local \/Users path/u,
  );
});

test("pipeline packages only the binary produced inside its fresh build transaction", async (t) => {
  const fixture = await makeSourceFixture(t);
  const calls = [];
  let preflightRequest;
  let workRoot;
  const result = await buildFreshInternalDMG({
    outputPath: fixture.output,
    buildNumber: testBuildNumber,
    sourceRoot: fixture.root,
    platform: "darwin",
  }, {
    selectToolchain: async () => ({
      developerDirectory: "/tmp/Xcode.app/Contents/Developer",
      environment: {},
    }),
    fingerprintInputs: async () => ({ sha256: "same", files: 2 }),
    preflightOutput: async (outputPath, options) => {
      preflightRequest = { outputPath, options };
    },
    makeWorkRoot: async () => {
      workRoot = await makeExternalWorkRoot(t, "fresh-work");
      return workRoot;
    },
    buildCoordinator: async ({ workRoot }) => {
      const binaryPath = join(workRoot, "swift-build", "release", "blabee-coordinator");
      await mkdir(dirname(binaryPath), { recursive: true });
      await writeFile(binaryPath, "fresh binary", { mode: 0o700 });
      return { binaryPath };
    },
    packageDMG: async (options) => {
      await options.prePublishValidation();
      calls.push({
        ...options,
        packageManifest: await readFile(
          join(options.sourceRoot, "src", "coordinator-swift", "Package.swift"),
          "utf8",
        ),
      });
      return { artifact: options.outputPath, input: await readFile(options.binaryPath, "utf8") };
    },
  });
  assert.equal(result.input, "fresh binary");
  assert.deepEqual(preflightRequest, {
    outputPath: fixture.output,
    options: { buildNumber: testBuildNumber },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].buildNumber, testBuildNumber);
  assert.match(calls[0].sourceRoot, /fresh-work\/release-source$/u);
  assert.notEqual(calls[0].sourceRoot, await realpath(fixture.root));
  assert.equal(calls[0].packageManifest, "// swift-tools-version: 6.0\n");
  assert.match(calls[0].binaryPath, /fresh-work\/swift-build\/release\/blabee-coordinator$/u);
  await assert.rejects(readFile(dirname(dirname(calls[0].binaryPath))), /EISDIR|ENOENT/u);
});

test("transient live-source changes cannot affect the snapshotted artifact", async (t) => {
  const fixture = await makeSourceFixture(t);
  const liveSource = join(
    fixture.root,
    "src",
    "coordinator-swift",
    "Sources",
    "BlabeeCoordinator",
    "main.swift",
  );
  const baseline = await readFile(liveSource, "utf8");
  const result = await buildFreshInternalDMG({
    outputPath: fixture.output,
    buildNumber: testBuildNumber,
    sourceRoot: fixture.root,
    platform: "darwin",
  }, {
    selectToolchain: async () => ({
      developerDirectory: "/tmp/Xcode.app/Contents/Developer",
      environment: {},
    }),
    makeWorkRoot: async () => makeExternalWorkRoot(t, "aba-work"),
    buildCoordinator: async ({ sourceRoot, workRoot }) => {
      const binaryPath = join(workRoot, "swift-build", "release", "blabee-coordinator");
      await mkdir(dirname(binaryPath), { recursive: true });
      await writeFile(liveSource, "print(\"transient\")\n");
      try {
        const snapshottedSource = await readFile(
          join(
            sourceRoot,
            "src",
            "coordinator-swift",
            "Sources",
            "BlabeeCoordinator",
            "main.swift",
          ),
          "utf8",
        );
        await writeFile(binaryPath, snapshottedSource, { mode: 0o700 });
      } finally {
        await writeFile(liveSource, baseline);
      }
      return { binaryPath };
    },
    packageDMG: async (options) => {
      await options.prePublishValidation();
      return { input: await readFile(options.binaryPath, "utf8") };
    },
  });
  assert.equal(result.input, baseline);
  assert.equal(await readFile(liveSource, "utf8"), baseline);
});

test("pipeline refuses to package when live inputs change during the fresh build", async (t) => {
  const fixture = await makeSourceFixture(t);
  let fingerprintCall = 0;
  let packaged = false;
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: fixture.output,
      buildNumber: testBuildNumber,
      sourceRoot: fixture.root,
      platform: "darwin",
    }, {
      selectToolchain: async () => ({
        developerDirectory: "/tmp/Xcode.app/Contents/Developer",
        environment: {},
      }),
      fingerprintInputs: async () => {
        fingerprintCall += 1;
        return {
          sha256: fingerprintCall === 5 ? "changed" : "same",
          files: 2,
        };
      },
      makeWorkRoot: async () => makeExternalWorkRoot(t, "changing-work"),
      buildCoordinator: async ({ workRoot }) => ({
        binaryPath: join(workRoot, "blabee-coordinator"),
      }),
      packageDMG: async () => {
        packaged = true;
      },
    }),
    /release inputs changed in the live source during the fresh build.*no DMG was published/u,
  );
  assert.equal(packaged, false);
});

test("invalid output is rejected before Xcode discovery or a fresh build", async (t) => {
  const fixture = await makeSourceFixture(t);
  let selectedToolchain = false;
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: join(fixture.root, "missing-parent", "Blabee-r2.dmg"),
      buildNumber: testBuildNumber,
      sourceRoot: fixture.root,
      platform: "darwin",
    }, {
      selectToolchain: async () => {
        selectedToolchain = true;
      },
    }),
    /ENOENT/u,
  );
  assert.equal(selectedToolchain, false);
});

test("invalid or mismatched build numbers are rejected before output and Xcode work", async (t) => {
  const fixture = await makeSourceFixture(t);
  let preflighted = false;
  let selectedToolchain = false;
  const dependencies = {
    preflightOutput: async () => { preflighted = true; },
    selectToolchain: async () => { selectedToolchain = true; },
  };
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: fixture.output,
      buildNumber: "02",
      sourceRoot: fixture.root,
      platform: "darwin",
    }, dependencies),
    /canonical integer from 1 through 9999/u,
  );
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: fixture.output,
      buildNumber: "3",
      sourceRoot: fixture.root,
      platform: "darwin",
    }, dependencies),
    /--output basename must end with -r3\.dmg/u,
  );
  assert.equal(preflighted, false);
  assert.equal(selectedToolchain, false);
});

test("pipeline detects packaged resource changes before publishing", async (t) => {
  const fixture = await makeSourceFixture(t);
  let packaged = false;
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: fixture.output,
      buildNumber: testBuildNumber,
      sourceRoot: fixture.root,
      platform: "darwin",
    }, {
      selectToolchain: async () => ({
        developerDirectory: "/tmp/Xcode.app/Contents/Developer",
        environment: {},
      }),
      makeWorkRoot: async () => makeExternalWorkRoot(t, "resource-changing-work"),
      buildCoordinator: async ({ workRoot }) => ({
        binaryPath: join(workRoot, "blabee-coordinator"),
      }),
      packageDMG: async (options) => {
        await writeFile(
          join(fixture.root, "Plugin", "blabee", "plugin.json"),
          "{\"changed\":true}\n",
        );
        await options.prePublishValidation();
        packaged = true;
      },
    }),
    /release inputs changed in the live source during DMG assembly.*no DMG was published/u,
  );
  assert.equal(packaged, false);
});

test("fresh scratch cleanup refuses a path replacement", async (t) => {
  const fixture = await makeSourceFixture(t);
  let workRoot;
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: fixture.output,
      buildNumber: testBuildNumber,
      sourceRoot: fixture.root,
      platform: "darwin",
    }, {
      preflightOutput: async () => {},
      selectToolchain: async () => ({
        developerDirectory: "/tmp/Xcode.app/Contents/Developer",
        environment: {},
      }),
      fingerprintInputs: async () => ({ sha256: "same", files: 4 }),
      makeWorkRoot: async () => {
        workRoot = await makeExternalWorkRoot(t, "replacement-work");
        return workRoot;
      },
      buildCoordinator: async () => ({ binaryPath: join(workRoot, "binary") }),
      packageDMG: async () => {
        await rename(workRoot, `${workRoot}.original`);
        await mkdir(workRoot, { mode: 0o700 });
        return { artifact: fixture.output };
      },
    }),
    /fresh build work root identity changed; refusing recursive cleanup/u,
  );
  assert.equal((await readFile(workRoot).catch((error) => error.code)), "EISDIR");
  assert.equal((await readFile(`${workRoot}.original`).catch((error) => error.code)), "EISDIR");
});

test("release input traversal stops at its entry limit and cleans the work root", async (t) => {
  const fixture = await makeSourceFixture(t);
  for (let index = 0; index < 1_025; index += 1) {
    await writeFile(
      join(fixture.root, "Contracts", "v1", `excess-${String(index).padStart(4, "0")}.json`),
      "{}\n",
    );
  }
  let workRoot;
  await assert.rejects(
    buildFreshInternalDMG({
      outputPath: fixture.output,
      buildNumber: testBuildNumber,
      sourceRoot: fixture.root,
      platform: "darwin",
    }, {
      selectToolchain: async () => ({
        developerDirectory: "/tmp/Xcode.app/Contents/Developer",
        environment: {},
      }),
      makeWorkRoot: async () => {
        workRoot = await makeExternalWorkRoot(t, "entry-limit-work");
        return workRoot;
      },
    }),
    /exceeds the 1024-entry traversal limit/u,
  );
  await assert.rejects(lstat(workRoot), { code: "ENOENT" });
});

test("fresh work-root inspection rejects replacement between lstat and realpath", async (t) => {
  const fixture = await makeSourceFixture(t);
  const workRoot = await makeExternalWorkRoot(t, "inspection-race-work");
  const originalWorkRoot = `${workRoot}.original`;
  let replaced = false;
  await assert.rejects(
    freshInternalDMGTesting.captureFreshWorkRoot(workRoot, fixture.root, {
      realpathImpl: async (path) => {
        const resolved = await realpath(path);
        if (path === workRoot && !replaced) {
          await rename(workRoot, originalWorkRoot);
          await mkdir(workRoot, { mode: 0o700 });
          replaced = true;
        }
        return resolved;
      },
    }),
    /fresh build work root identity changed while it was being inspected/u,
  );
  assert.equal((await lstat(workRoot)).isDirectory(), true);
  assert.equal((await lstat(originalWorkRoot)).isDirectory(), true);
});

test("release fingerprints reject excessive trees before hashing file contents", async (t) => {
  const fixture = await makeSourceFixture(t);
  for (let index = 0; index < 1_025; index += 1) {
    await writeFile(
      join(fixture.root, "Plugin", "blabee", `entry-${String(index).padStart(4, "0")}.json`),
      "{}\n",
    );
  }
  await assert.rejects(
    fingerprintReleaseInputs(fixture.root),
    /Plugin\/blabee exceeds the 1024-entry traversal limit/u,
  );
});

test("fingerprint and snapshot opens reject FIFO replacement without blocking", {
  skip: process.platform !== "darwin" ? "requires macOS FIFO open semantics" : false,
  timeout: 2_000,
}, async (t) => {
  const fixture = await makeSourceFixture(t);
  const hashSource = join(fixture.root, "hash-source");
  await writeFile(hashSource, "hash me\n");
  await assert.rejects(
    freshInternalDMGTesting.hashStableRegularFile(
      hashSource,
      "hash source",
      createHash("sha256"),
      { bytes: 0, entries: 0 },
      {
        afterLstat: async () => {
          await rename(hashSource, `${hashSource}.original`);
          await execFile("/usr/bin/mkfifo", [hashSource]);
        },
      },
    ),
    /hash source changed while it was being opened/u,
  );

  const copySource = join(fixture.root, "copy-source");
  const copyDestination = join(fixture.root, "copy-destination");
  await writeFile(copySource, "copy me\n");
  await assert.rejects(
    freshInternalDMGTesting.copyStableRegularFile(
      copySource,
      copyDestination,
      "copy source",
      { bytes: 0, entries: 0 },
      {
        afterLstat: async () => {
          await rename(copySource, `${copySource}.original`);
          await execFile("/usr/bin/mkfifo", [copySource]);
        },
      },
    ),
    /copy source changed while it was being opened for snapshotting/u,
  );
  await assert.rejects(lstat(copyDestination), { code: "ENOENT" });
});

test("fresh input readers reject append growth beyond the bounded initial extent", async (t) => {
  const fixture = await makeSourceFixture(t);
  const initialBytes = Buffer.alloc((64 * 1024) + 1, 0x41);

  const hashSource = join(fixture.root, "growing-hash-source");
  await writeFile(hashSource, initialBytes);
  let hashAppended = false;
  const hashBudget = { bytes: 0, entries: 0 };
  await assert.rejects(
    freshInternalDMGTesting.hashStableRegularFile(
      hashSource,
      "growing hash source",
      createHash("sha256"),
      hashBudget,
      {
        afterReadChunk: async () => {
          if (hashAppended) return;
          hashAppended = true;
          await writeFile(hashSource, "growth", { flag: "a" });
        },
      },
    ),
    /grew beyond its initial size while it was being read/u,
  );
  assert.deepEqual(hashBudget, { bytes: 0, entries: 0 });

  const markerSource = join(fixture.root, "growing-marker-source");
  await writeFile(markerSource, initialBytes);
  const markerMetadata = await lstat(markerSource);
  let markerAppended = false;
  await assert.rejects(
    freshInternalDMGTesting.stableRegularFileContainsMarker(
      markerSource,
      markerMetadata,
      "growing marker source",
      Buffer.from("/Users/", "utf8"),
      {
        afterReadChunk: async () => {
          if (markerAppended) return;
          markerAppended = true;
          await writeFile(markerSource, "growth", { flag: "a" });
        },
      },
    ),
    /grew beyond its initial size while it was being inspected/u,
  );

  const copySource = join(fixture.root, "growing-copy-source");
  const copyDestination = join(fixture.root, "growing-copy-destination");
  await writeFile(copySource, initialBytes);
  let copyAppended = false;
  const copyBudget = { bytes: 0, entries: 0 };
  await assert.rejects(
    freshInternalDMGTesting.copyStableRegularFile(
      copySource,
      copyDestination,
      "growing copy source",
      copyBudget,
      {
        afterSnapshotChunk: async () => {
          if (copyAppended) return;
          copyAppended = true;
          await writeFile(copySource, "growth", { flag: "a" });
        },
      },
    ),
    /grew beyond its initial size while it was being snapshotted/u,
  );
  assert.deepEqual(copyBudget, { bytes: 0, entries: 0 });
  await assert.rejects(lstat(copyDestination), { code: "ENOENT" });
});

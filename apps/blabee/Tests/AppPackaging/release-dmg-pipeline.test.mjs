import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { buildFreshInternalDMG } from "../../scripts/build-fresh-internal-dmg.mjs";
import { buildReleaseDMG, releaseDMGTesting } from "../../scripts/build-release-dmg.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const identity = "Developer ID Application: Example Developer (TEAMID1234)";
const otherIdentity = "Developer ID Application: Other Developer (OTHERID123)";
const teamID = "TEAMID1234";
const signing = { identity, teamID };
const parse = releaseDMGTesting.parseCLIArguments;
const validArguments = [
  "--identity", identity,
  "--team-id", teamID,
  "--build-number", "39",
  "--output", "/tmp/Blabee-0.1.0-r39.dmg",
];

async function makePipelineFixture(t) {
  const sourceRoot = await mkdtemp(join(tmpdir(), "blabee-release-pipeline-source-"));
  const workRoot = await mkdtemp(join(tmpdir(), "blabee-release-pipeline-work-"));
  t.after(async () => {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  });
  const packageRoot = join(sourceRoot, "src", "coordinator-swift");
  await mkdir(join(packageRoot, "Sources", "BlabeeCoordinator"), { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
  await mkdir(join(sourceRoot, "Packaging", "macos"), { recursive: true });
  await writeFile(join(packageRoot, "Package.swift"), "// swift-tools-version: 6.0\n");
  await writeFile(join(packageRoot, "Sources", "BlabeeCoordinator", "main.swift"), "print(\"release fixture\")\n");
  await writeFile(join(sourceRoot, "Contracts", "v1", "contract.json"), "{}\n");
  await writeFile(join(sourceRoot, "Plugin", "blabee", "plugin.json"), "{}\n");
  await writeFile(join(sourceRoot, "Packaging", "macos", "Info.plist"), "plist fixture\n");
  return {
    sourceRoot,
    workRoot,
    options: {
      ...signing,
      sourceRoot,
      platform: "darwin",
      outputPath: join(sourceRoot, "Blabee-0.1.0-r39.dmg"),
      buildNumber: "39",
    },
    dependencies: {
      preflightOutput: async () => {},
      selectToolchain: async () => ({ environment: {} }),
      makeWorkRoot: async () => workRoot,
      buildCoordinator: async ({ workRoot, sourceRoot }) => {
        const binaryPath = join(workRoot, "swift-build", "blabee-coordinator");
        await mkdir(dirname(binaryPath), { recursive: true });
        const source = await readFile(join(sourceRoot, "src", "coordinator-swift", "Sources", "BlabeeCoordinator", "main.swift"), "utf8");
        await writeFile(binaryPath, source, { mode: 0o700 });
        return { binaryPath };
      },
    },
  };
}

test("release command documents explicit signing and remaining notarization", async () => {
  const { stdout, stderr } = await execFile(process.execPath, [
    join(repositoryRoot, "scripts", "build-release-dmg.mjs"), "--help",
  ]);
  assert.match(stdout, /--identity/u);
  assert.match(stdout, /--team-id/u);
  assert.match(stdout, /No ad-hoc signing fallback/u);
  assert.match(stdout, /must still pass notarize:dmg/u);
  assert.equal(stderr, "");
  const packageJSON = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJSON.scripts["build:release-dmg"], "node scripts/build-release-dmg.mjs");
  assert.equal(packageJSON.scripts["notarize:dmg"], "node scripts/notarize-dmg.mjs");
  assert.equal(packageJSON.scripts["build:internal-dmg"], "node scripts/build-fresh-internal-dmg.mjs");
  assert.equal(packageJSON.scripts["build:macos-app"], "node scripts/build-macos-app.mjs");
});

test("release CLI requires each option and rejects duplicate or unsupported options", () => {
  for (let index = 0; index < validArguments.length; index += 2) {
    const omitted = validArguments.filter((_, current) => current !== index && current !== index + 1);
    assert.throws(() => parse(omitted), { message: `${validArguments[index]} is required` });
    assert.throws(() => parse([...validArguments, validArguments[index], validArguments[index + 1]]), /may be provided only once/u);
  }
  for (const option of ["--binary", "--adhoc-sign", "--sign", "--unknown"]) {
    assert.throws(() => parse([...validArguments, option, "/tmp/value"]), /unsupported argument/u);
  }
  assert.throws(() => parse(["--identity"]), /--identity requires a value/u);
});

test("release CLI accepts at most two compatibility bundles and enforces build suffix", () => {
  const options = parse([
    ...validArguments,
    "--compatible-previous-app", "/tmp/first/Blabee.app",
    "--compatible-previous-app", "/tmp/second/Blabee.app",
  ]);
  assert.equal(options.identity, identity);
  assert.equal(options.teamID, teamID);
  assert.deepEqual(options.compatiblePreviousApps, ["/tmp/first/Blabee.app", "/tmp/second/Blabee.app"]);
  assert.throws(() => parse([
    ...validArguments,
    ...Array.from({ length: 3 }, () => ["--compatible-previous-app", "/tmp/Blabee.app"]).flat(),
  ]), /at most 2 times/u);
  assert.throws(() => parse(validArguments.map((value) => value === "39" ? "039" : value)), /canonical integer/u);
  assert.throws(() => parse(validArguments.map((value) => value === "39" ? "40" : value)), /-r40\.dmg/u);
});

test("release signing cannot be omitted, downgraded to ad-hoc, or assigned another team", async () => {
  let preflightCalls = 0;
  for (const options of [
    {}, { identity }, { teamID }, { identity: "-", teamID }, { identity, teamID: "OTHERID123" },
  ]) {
    await assert.rejects(buildReleaseDMG({
      ...options,
      platform: "darwin",
      sourceRoot: "/missing-source-should-not-be-read",
      outputPath: "/tmp/Blabee-r39.dmg",
      buildNumber: "39",
    }, { preflightOutput: async () => { preflightCalls += 1; } }));
  }
  assert.equal(preflightCalls, 0);
  assert.throws(() => parse(validArguments.map((value) => value === identity ? "-" : value)));
});

test("release wrapper preserves the fresh source transaction and forwards mandatory signing", async (t) => {
  const fixture = await makePipelineFixture(t);
  let packagedOptions;
  const result = await buildReleaseDMG({
    ...fixture.options,
    compatiblePreviousApps: ["/tmp/previous/Blabee.app"],
  }, {
    ...fixture.dependencies,
    packageDMG: async (options) => {
      await options.prePublishValidation();
      packagedOptions = options;
      return { artifact: options.outputPath, contents: await readFile(options.binaryPath, "utf8") };
    },
  });
  assert.deepEqual(packagedOptions.releaseSigning, signing);
  assert.equal(Object.isFrozen(packagedOptions.releaseSigning), true);
  assert.notEqual(packagedOptions.sourceRoot, fixture.sourceRoot);
  assert.match(packagedOptions.sourceRoot, /release-source$/u);
  assert.deepEqual(packagedOptions.compatiblePreviousApps, ["/tmp/previous/Blabee.app"]);
  assert.equal(result.contents, "print(\"release fixture\")\n");
  await assert.rejects(lstat(fixture.workRoot), { code: "ENOENT" });
});

test("fresh pipeline snapshots signing and compatibility options before asynchronous work", async (t) => {
  const fixture = await makePipelineFixture(t);
  const releaseSigning = { ...signing };
  const compatiblePreviousApps = ["/tmp/previous/Blabee.app"];
  let packagedOptions;
  const build = buildFreshInternalDMG({
    ...fixture.options, releaseSigning, compatiblePreviousApps,
  }, {
    ...fixture.dependencies,
    packageDMG: async (options) => { packagedOptions = options; return {}; },
  });
  releaseSigning.identity = otherIdentity;
  releaseSigning.teamID = "OTHERID123";
  compatiblePreviousApps[0] = "/tmp/replaced/Blabee.app";
  await build;
  assert.deepEqual(packagedOptions.releaseSigning, signing);
  assert.deepEqual(packagedOptions.compatiblePreviousApps, ["/tmp/previous/Blabee.app"]);
});

test("release packaging failure cleans the fresh work root without an ad-hoc retry", async (t) => {
  const fixture = await makePipelineFixture(t);
  let packageCalls = 0;
  await assert.rejects(buildReleaseDMG(fixture.options, {
    ...fixture.dependencies,
    packageDMG: async (options) => {
      packageCalls += 1;
      assert.deepEqual(options.releaseSigning, signing);
      throw new Error("Developer ID signing failed");
    },
  }), /Developer ID signing failed/u);
  assert.equal(packageCalls, 1);
  await assert.rejects(lstat(fixture.workRoot), { code: "ENOENT" });
});

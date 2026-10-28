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
import { makeClaudeRuntimeFixture } from "./claude-runtime-fixtures.mjs";
import { refreshClaudeRuntimeManifest } from "../../scripts/prepare-claude-runtime.mjs";

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
const publishedLegalPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>BlabeeTermsURL</key><string>https://biadone.com/legal/blabee/terms</string>
<key>BlabeePrivacyURL</key><string>https://biadone.com/legal/blabee/privacy</string>
<key>BlabeeLegalDocumentVersion</key><string>2026-09-23</string>
</dict></plist>`;

test("public release API rejects internal signing options before toolchain or packaging work", async () => {
  for (const options of [{ internalClaudeSigning: signing },
    { claudeRuntimeDirectory: "/runtime", internalClaudeSigning: signing }]) {
    let calls = 0;
    await assert.rejects(buildReleaseDMG({ ...signing, ...options }, { selectToolchain: async () => { calls++; } }), /public release cannot include/u);
    assert.equal(calls, 0);
  }
});

async function makePipelineFixture(t) {
  const sourceRoot = await mkdtemp(join(tmpdir(), "blabee-release-pipeline-source-"));
  const workRoot = await mkdtemp(join(tmpdir(), "blabee-release-pipeline-work-"));
  t.after(async () => {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  });
  const packageRoot = sourceRoot;
  await mkdir(join(packageRoot, "app", "entrypoints"), { recursive: true });
  for (const directory of ["engine", "bridges/codex/swift", "bridges/claude/swift", "Tests/swift"]) {
    await mkdir(join(packageRoot, directory), { recursive: true });
  }
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "bridges", "codex", "plugin"), { recursive: true });
  await mkdir(join(sourceRoot, "Packaging", "macos"), { recursive: true });
  await writeFile(join(packageRoot, "Package.swift"), "// swift-tools-version: 6.0\n");
  await writeFile(join(packageRoot, "app", "entrypoints", "main.swift"), "print(\"release fixture\")\n");
  await writeFile(join(sourceRoot, "Contracts", "v1", "contract.json"), "{}\n");
  await writeFile(join(sourceRoot, "bridges", "codex", "plugin", "plugin.json"), "{}\n");
  await writeFile(join(sourceRoot, "Packaging", "macos", "Info.plist"), publishedLegalPlist);
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
        const source = await readFile(join(sourceRoot, "app", "entrypoints", "main.swift"), "utf8");
        await writeFile(binaryPath, source, { mode: 0o700 });
        return { binaryPath };
      },
    },
  };
}

test("fresh internal pipeline forwards Claude into the same app without a public signing capability", async t => {
  const fixture = await makePipelineFixture(t);
  const runtime = await makeClaudeRuntimeFixture(t, { legacy: true });
  const result = await buildFreshInternalDMG({ ...fixture.options, internalClaudeSigning: signing,
    claudeRuntimeDirectory: runtime.outputDirectory }, { ...fixture.dependencies, packageDMG: async options => {
    assert.deepEqual(options.internalClaudeSigning, signing);
    assert.equal(options.claudeRuntimeDirectory, runtime.outputDirectory);
    assert.equal(Object.hasOwn(options, "releaseSigning"), false);
    assert.equal(options.outputPath, fixture.options.outputPath);
    await options.prePublishValidation();
    return { artifact: options.outputPath };
  } });
  assert.equal(result.artifact, fixture.options.outputPath);
});

test("public pipeline includes only a verified MCP/Hook runtime and keeps explicit release signing", async t => {
  const fixture = await makePipelineFixture(t);
  const runtime = await makeClaudeRuntimeFixture(t);
  const parsed = parse([...validArguments, "--claude-runtime-directory", runtime.outputDirectory]);
  assert.equal(parsed.claudeRuntimeDirectory, runtime.outputDirectory);
  await buildReleaseDMG({ ...fixture.options, claudeRuntimeDirectory: runtime.outputDirectory }, {
    ...fixture.dependencies, packageDMG: async options => {
      assert.deepEqual(options.releaseSigning, signing);
      assert.equal(options.internalClaudeSigning, undefined);
      assert.equal(options.claudeRuntimeDirectory, runtime.outputDirectory);
      await options.prePublishValidation();
      return {};
    },
  });
});

test("public pipeline rejects historical development runtime before build or signing", async t => {
  const fixture = await makePipelineFixture(t);
  const runtime = await makeClaudeRuntimeFixture(t, { legacy: true });
  let calls = 0;
  const dependencies = { ...fixture.dependencies, selectToolchain: async () => { calls++; }, packageDMG: async () => { calls++; } };
  await assert.rejects(buildReleaseDMG({ ...fixture.options, claudeRuntimeDirectory: runtime.outputDirectory }, dependencies), /development Channels/u);
  await assert.rejects(buildFreshInternalDMG({ ...fixture.options, releaseSigning: signing,
    claudeRuntimeDirectory: runtime.outputDirectory }, dependencies), /development Channels/u);
  assert.equal(calls, 0);
});

test("fresh internal runtime digest changes before packaging or publication are terminal", async t => {
  for (const phase of ["build", "publish"]) await t.test(phase, async subtest => {
    const fixture = await makePipelineFixture(subtest);
    const runtime = await makeClaudeRuntimeFixture(subtest, { legacy: true });
    const changeRuntime = async () => {
      const node = join(runtime.outputDirectory, "node/bin/node");
      await writeFile(node, Buffer.concat([await readFile(node), Buffer.from("changed valid runtime")]));
      await refreshClaudeRuntimeManifest(runtime.outputDirectory);
    };
    let packageCalls = 0;
    await assert.rejects(buildFreshInternalDMG({ ...fixture.options, internalClaudeSigning: signing,
      claudeRuntimeDirectory: runtime.outputDirectory }, { ...fixture.dependencies,
      buildCoordinator: async options => {
        const result = await fixture.dependencies.buildCoordinator(options);
        if (phase === "build") await changeRuntime();
        return result;
      },
      packageDMG: async options => {
        packageCalls++;
        await changeRuntime();
        await options.prePublishValidation();
        assert.fail("changed runtime must never be published");
      },
    }), /Claude runtime changed/u);
    assert.equal(packageCalls, phase === "build" ? 0 : 1);
    await assert.rejects(lstat(fixture.options.outputPath), { code: "ENOENT" });
  });
});

test("release command documents explicit signing and remaining notarization", async () => {
  const { stdout, stderr } = await execFile(process.execPath, [
    join(repositoryRoot, "scripts", "build-release-dmg.mjs"), "--help",
  ]);
  assert.match(stdout, /--identity/u);
  assert.match(stdout, /--team-id/u);
  assert.match(stdout, /No ad-hoc signing fallback/u);
  assert.match(stdout, /must still pass notarize:dmg/u);
  assert.match(stdout, /BlabeeTermsURL.*BlabeePrivacyURL.*BlabeeLegalDocumentVersion/u);
  assert.equal(stderr, "");
  const packageJSON = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJSON.scripts["build:release-dmg"], "node scripts/build-release-dmg.mjs");
  assert.equal(packageJSON.scripts["notarize:dmg"], "node scripts/notarize-dmg.mjs");
  assert.equal(packageJSON.scripts["build:internal-dmg"], "node scripts/build-fresh-internal-dmg.mjs");
  assert.equal(packageJSON.scripts["build:macos-app"], "node scripts/build-macos-app.mjs");
});

test("public release rejects missing or dummy legal metadata before toolchain and signing work", async t => {
  for (const metadata of ["<plist version=\"1.0\"><dict/></plist>",
    publishedLegalPlist.replace("2026-09-23", "draft-onboarding-v1")]) {
    const fixture = await makePipelineFixture(t);
    await writeFile(join(fixture.sourceRoot, "Packaging", "macos", "Info.plist"), metadata);
    let calls = 0;
    await assert.rejects(buildReleaseDMG(fixture.options, {
      ...fixture.dependencies,
      preflightOutput: async () => { calls++; },
      selectToolchain: async () => { calls++; },
      packageDMG: async () => { calls++; },
    }), /public release.*Blabee(?:TermsURL|LegalDocumentVersion)/u);
    assert.equal(calls, 0);
    await assert.rejects(lstat(fixture.options.outputPath), { code: "ENOENT" });
  }
});

test("explicitly deferred documents survive the release snapshot without inventing consent metadata", async t => {
  const fixture = await makePipelineFixture(t);
  const plist = '<plist version="1.0"><dict><key>BlabeeLegalDocumentsDeferred</key><true/></dict></plist>';
  await writeFile(join(fixture.sourceRoot, "Packaging", "macos", "Info.plist"), plist);
  let packageCalls = 0;
  await buildReleaseDMG(fixture.options, {
    ...fixture.dependencies,
    packageDMG: async options => {
      packageCalls++;
      assert.deepEqual(options.releaseSigning, signing);
      assert.notEqual(options.sourceRoot, fixture.sourceRoot);
      assert.equal(await readFile(join(options.sourceRoot, "Packaging", "macos", "Info.plist"), "utf8"), plist);
      await options.prePublishValidation();
      return {};
    },
  });
  assert.equal(packageCalls, 1);
});

test("deferred mode cannot hide partial or published document metadata before the build", async t => {
  const fixture = await makePipelineFixture(t);
  const plist = publishedLegalPlist.replace("</dict>", "<key>BlabeeLegalDocumentsDeferred</key><true/></dict>");
  await writeFile(join(fixture.sourceRoot, "Packaging", "macos", "Info.plist"), plist);
  let calls = 0;
  await assert.rejects(buildReleaseDMG(fixture.options, {
    ...fixture.dependencies,
    preflightOutput: async () => { calls++; },
    selectToolchain: async () => { calls++; },
    packageDMG: async () => { calls++; },
  }), /BlabeeLegalDocumentsDeferred cannot be combined/u);
  assert.equal(calls, 0);
});

test("release wrapper snapshots compatibility inputs before asynchronous legal inspection", async t => {
  const fixture = await makePipelineFixture(t);
  const previousApps = ["/tmp/previous/Blabee.app"];
  let captured;
  const build = buildReleaseDMG({ ...fixture.options, compatiblePreviousApps: previousApps }, {
    ...fixture.dependencies,
    packageDMG: async options => { captured = options.compatiblePreviousApps; return {}; },
  });
  previousApps[0] = "/tmp/replaced/Blabee.app";
  await build;
  assert.deepEqual(captured, ["/tmp/previous/Blabee.app"]);
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

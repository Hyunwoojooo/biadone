import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BLABEE_TEST_APP_PROFILE, buildTestApp, makeTestSwiftBuildArguments,
  testAppIcon, verifyCompiledTestAppProfile } from "../../scripts/build-test-app.mjs";
import { verifyCompiledDistributionProfile } from "../../scripts/distribution-profiles.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const profileResponse = (profile = "blabee-test", bundle = "com.biadone.blabee.test") => ({
  stdout: `${JSON.stringify({ schema_version: "blabee.distribution-profile.v1", profile_id: profile,
    bundle_identifier: bundle })}\n`, stderr: "",
});

async function fixture(t, { profile = profileResponse(), escapedOutput = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "blabee-test-app-packaging-")));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const fonts = join(source, "Packaging", "macos", "Resources", "Fonts", "Pretendard");
  await mkdir(fonts, { recursive: true });
  await writeFile(join(fonts, "PretendardVariable.ttf"), "fixture-font");
  await writeFile(join(fonts, "LICENSE.txt"), "fixture-license");
  const sentinel = join(root, "Blabee.app.sentinel");
  await writeFile(sentinel, "preserve product");
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "/usr/bin/xcrun") {
      const scratch = args[args.indexOf("--scratch-path") + 1];
      const directory = escapedOutput ? join(root, "escaped") : join(scratch, "arm64-apple-macosx", "debug");
      if (!args.includes("--show-bin-path")) {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "blabee-coordinator"), "fixture-binary", { mode: 0o755 });
      }
      return { stdout: args.includes("--show-bin-path") ? `${directory}\n` : "", stderr: "" };
    }
    if (args[0] === "distribution-profile") return profile;
    if (command === "/usr/bin/codesign") return { stdout: "", stderr: "" };
    assert.fail(`unexpected tool: ${command}`);
  };
  return { root, source, calls, runner, sentinel };
}

test("test Swift compilation keeps existing targets with an explicit flag and separate scratch", () => {
  const args = makeTestSwiftBuildArguments({ sourceRoot: "/src", scratchPath: "/test-only/scratch" });
  assert.deepEqual(args, ["--sdk", "macosx", "swift", "build", "--package-path", "/src", "--scratch-path",
    "/test-only/scratch", "--configuration", "debug", "--jobs", "1", "--disable-keychain", "--disable-netrc",
    "-Xswiftc", "-DBLABEE_TEST_APP", "--product", "blabee-coordinator"]);
  assert.throws(() => makeTestSwiftBuildArguments({ configuration: "production" }), /configuration/u);
  assert.equal(BLABEE_TEST_APP_PROFILE.bundleName, "Blabee Test.app");
  assert.notEqual(BLABEE_TEST_APP_PROFILE.bundleIdentifier, "com.biadone.blabee");
});

test("the production and test distribution probes reject the opposite compiled identity", async () => {
  for (const requireExplicit of [false, true]) {
    await assert.rejects(verifyCompiledDistributionProfile("/fixture/binary", { requireExplicit,
      runner: async () => profileResponse() }), /does not match/u);
  }
  await assert.rejects(verifyCompiledTestAppProfile("/fixture/binary", {
    runner: async () => profileResponse("blabee", "com.biadone.blabee") }), /not the Blabee Test/u);
  const calls = [];
  await verifyCompiledTestAppProfile("/fixture/binary", { runner: async (...args) => {
    calls.push(args); return profileResponse();
  } });
  assert.deepEqual(calls[0][1], ["distribution-profile"]);
  assert.deepEqual(Object.keys(calls[0][2].env).sort(), ["LANG", "LC_ALL", "PATH"]);
});

test("the Test profile rejects legacy, duplicate keys, unknown fields, mixed markers, and stderr", async () => {
  const valid = profileResponse();
  for (const result of [
    { stdout: "", stderr: "unsupported command" },
    { stdout: valid.stdout.replace('"profile_id":', '"profile_id":"blabee", "profile_id":'), stderr: "" },
    { stdout: valid.stdout.replace('"bundle_identifier":', '"extra":true,"bundle_identifier":'), stderr: "" },
    { stdout: valid.stdout.trim(), stderr: "" },
    { ...valid, stderr: "warning" },
    { stdout: ` ${valid.stdout}${" ".repeat(4096)}`, stderr: "" },
    profileResponse("blabee-test", "com.biadone.blabee"),
  ]) await assert.rejects(verifyCompiledTestAppProfile("/fixture/binary", { runner: async () => result }));
});

test("assembly only contains the test binary, shared fonts, distinct icon, and static metadata", async t => {
  const value = await fixture(t);
  const result = await buildTestApp({ sourceRoot: value.source, buildID: "m1-test", platform: "darwin", runner: value.runner });
  assert.equal(result.bundlePath, join(value.source, "build", "test-app", "m1-test", "Blabee Test.app"));
  assert.ok(result.scratchPath.startsWith(`${result.outputRoot}/`));
  assert.deepEqual((await readdir(join(result.bundlePath, "Contents"))).sort(), ["Info.plist", "MacOS", "Resources"]);
  assert.deepEqual(await readdir(join(result.bundlePath, "Contents", "MacOS")), ["blabee-coordinator"]);
  const resources = join(result.bundlePath, "Contents", "Resources");
  assert.deepEqual((await readdir(resources)).sort(), ["BlabeeTest.icns", "Fonts", "TestAppManifest.json"]);
  const info = await readFile(join(result.bundlePath, "Contents", "Info.plist"), "utf8");
  assert.match(info, /<string>com\.biadone\.blabee\.test<\/string>/u);
  assert.match(info, /<key>BlabeeDistributionProfile<\/key><string>blabee-test<\/string>/u);
  assert.match(info, /<key>BlabeeTestMode<\/key><string>isolated-development<\/string>/u);
  assert.match(info, /<key>BlabeeTestEngineEnabled<\/key><true\/>/u);
  assert.doesNotMatch(info, /BlabeeUpdateRepository|CFBundleURLTypes|NSAppleEventsUsageDescription|LaunchAgent/u);
  const manifest = JSON.parse(await readFile(join(resources, "TestAppManifest.json"), "utf8"));
  assert.equal(manifest.simulation_only, false);
  assert.equal(manifest.milestone, "M2");
  assert.equal(manifest.keychain_policy, "run_scoped_freshness_only");
  assert.equal(manifest.build_id, "m1-test");
  assert.equal(manifest.capabilities.keychain, true);
  assert.ok(Object.entries(manifest.capabilities).every(([key, value]) => value === (key === "keychain")));
  assert.equal(await readFile(value.sentinel, "utf8"), "preserve product");
  assert.equal((await lstat(join(result.bundlePath, "Contents", "MacOS", "blabee-coordinator"))).mode & 0o777, 0o755);
  assert.equal(value.calls.length, 5);
  const compile = value.calls[0];
  assert.equal(compile.options.env.HOME, join(result.outputRoot, "tool-home"));
  assert.equal(compile.options.env.CLANG_MODULE_CACHE_PATH, join(result.outputRoot, "module-cache"));
  assert.equal(compile.options.env.SWIFTPM_MODULECACHE_OVERRIDE, compile.options.env.CLANG_MODULE_CACHE_PATH);
  assert.equal(compile.options.env.CODEX_HOME, undefined);
  assert.equal(compile.options.env.CLAUDE_CONFIG_DIR, undefined);
  assert.deepEqual(value.calls.slice(-2).map(call => call.args.slice(0, -1)), [
    ["--force", "--sign", "-"], ["--verify", "--strict"],
  ]);
  const before = value.calls.length;
  await assert.rejects(buildTestApp({ sourceRoot: value.source, buildID: "m1-test", platform: "darwin", runner: value.runner }), /EEXIST/u);
  assert.equal(value.calls.length, before);
});

test("a production binary cannot become a test bundle and failure preserves product state", async t => {
  const value = await fixture(t, { profile: profileResponse("blabee", "com.biadone.blabee") });
  await assert.rejects(buildTestApp({ sourceRoot: value.source, buildID: "mixed", platform: "darwin", runner: value.runner }), /not the Blabee Test/u);
  const output = join(value.source, "build", "test-app", "mixed");
  assert.equal((await readdir(output)).includes("Blabee Test.app"), false);
  assert.match(await readFile(join(output, "BUILD_FAILED.txt"), "utf8"), /No product installation was modified/u);
  assert.equal(await readFile(value.sentinel, "utf8"), "preserve product");
  assert.ok(value.calls.every(call => call.command !== "/usr/bin/codesign"));
});

test("escaping Swift output and symlinked build parents are rejected before packaging", async t => {
  const escaped = await fixture(t, { escapedOutput: true });
  await assert.rejects(buildTestApp({ sourceRoot: escaped.source, buildID: "escape", platform: "darwin", runner: escaped.runner }), /escaped/u);
  const linked = await fixture(t);
  await mkdir(join(linked.root, "outside"));
  await symlink(join(linked.root, "outside"), join(linked.source, "build"));
  await assert.rejects(buildTestApp({ sourceRoot: linked.source, buildID: "linked", platform: "darwin", runner: linked.runner }), /symlink/u);
  assert.equal(linked.calls.length, 0);
  assert.deepEqual(await readdir(join(linked.root, "outside")), []);
});

test("unsafe build IDs and unsupported platforms perform no build calls", async t => {
  const value = await fixture(t);
  for (const buildID of ["..", "../Blabee.app", "/Applications/Blabee.app", "a/b", "a\\0b", "a".repeat(65)]) {
    await assert.rejects(buildTestApp({ sourceRoot: value.source, buildID, platform: "darwin", runner: value.runner }), /build ID/u);
  }
  await assert.rejects(buildTestApp({ sourceRoot: value.source, buildID: "valid", platform: "linux", runner: value.runner }), /macOS/u);
  assert.equal(value.calls.length, 0);
});

test("the deterministic icon contains a standalone TEST PNG representation", () => {
  const icon = testAppIcon();
  assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icon.readUInt32BE(4), icon.length);
  assert.equal(icon.subarray(8, 12).toString("ascii"), "ic08");
  assert.deepEqual(icon.subarray(16, 24), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(icon, testAppIcon());
});

test("each Test source belongs to one existing target and release commands keep their original path", async () => {
  const packageText = await readFile(join(repository, "Package.swift"), "utf8");
  for (const file of ["BlabeeTestRunStore.swift", "BlabeeTestScenarios.swift", "BlabeeTestApplication.swift", "BlabeeTestComposition.swift", "BlabeeTestEngineCore.swift", "BlabeeTestEngineService.swift"]) {
    assert.equal(packageText.split(`"dev/test-app/swift/${file}"`).length - 1, 1, file);
  }
  assert.doesNotMatch(packageText, /"dev",/u);
  assert.match(packageText, /hasBlabeeTestAppSourceDirectory \? blabeeTestAppSources : \[\]/u);
  const profile = await readFile(join(repository, "app", "service", "product-support", "BlabeeProductProfile.swift"), "utf8");
  assert.match(profile, /#if BLABEE_TEST_APP\s+case blabeeTest = "blabee-test"/u);
  assert.doesNotMatch(profile, /ProcessInfo|CommandLine|environment\[/u);
  const commands = JSON.parse(await readFile(join(repository, "package.json"), "utf8")).scripts;
  assert.equal(commands["build:macos-app"], "node scripts/build-macos-app.mjs");
  assert.equal(commands["build:test-app"], "node scripts/build-test-app.mjs");
  assert.match(commands["test:swift:test-app"], /blabee-coordinator-swift-tests\.lock/u);
  assert.match(commands["test:swift:test-app"], /--scratch-path \/tmp\/blabee-test-app-swift-tests/u);
  assert.match(commands["test:swift:test-app"], /-DBLABEE_TEST_APP --filter 'BlabeeTest\(Profile\|RunStore\|Composition\|Workspace\|Engine\|EngineService\|EngineStorage\)Tests'/u);
  for (const variable of ["BLABEE_NATIVE_LIVE_VERIFY", "BLABEE_NATIVE_LIVE_EXECUTABLE", "BLABEE_PUBLIC_HOOK_NATIVE",
    "BLABEE_CLAUDE_PACKAGED_RUNTIME", "BLABEE_TEST_RECOVERY_KEYCHAIN", "BLABEE_SQLITE_RECEIPT_BENCHMARK",
    "BLABEE_SQLITE_QUEUED_CLAIM_BENCHMARK"]) {
    assert.ok(commands["test:swift:test-app"].includes(`-u ${variable} `));
  }
});

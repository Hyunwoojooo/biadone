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
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assembleMacOSApp,
  macOSAppAssemblyTestSupport,
} from "../../scripts/build-macos-app.mjs";
import { CLAUDE_NODE_ENTITLEMENTS, verifyClaudeRuntimeDirectory } from "../../scripts/prepare-claude-runtime.mjs";
import { makeClaudeRuntimeFixture } from "./claude-runtime-fixtures.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assemblyScript = join(repositoryRoot, "scripts", "build-macos-app.mjs");
const execFile = promisify(execFileCallback);
const launchAgentFileName = "com.biadone.blabee.coordinator.plist";
const appIconFileName = "Blabee.icns";
const menuBarIconFileName = "BlabeeMenuBar.svg";
const codexMarketplaceFileName = "CodexMarketplace.json";
const entitlementsFileName = "Blabee.entitlements";
const canonicalEntitlements = join(repositoryRoot, "Packaging", "macos", entitlementsFileName);
const canonicalLaunchAgent = join(
  repositoryRoot,
  "Packaging",
  "macos",
  "LaunchAgents",
  launchAgentFileName,
);
const canonicalAppIcon = join(
  repositoryRoot,
  "Packaging",
  "macos",
  "Resources",
  appIconFileName,
);
const canonicalMenuBarIcon = join(
  repositoryRoot,
  "Packaging",
  "macos",
  "Resources",
  menuBarIconFileName,
);
const canonicalCodexMarketplace = join(
  repositoryRoot,
  "Packaging",
  "macos",
  "Resources",
  codexMarketplaceFileName,
);
const defaultInspectedRuntimeIdentity = `sha256:${"f".repeat(64)}`;
const defaultInspectedManifestDigest = `sha256:${"e".repeat(64)}`;
const runtimeUseLeaseProtocol = "blabee.runtime-use-lease.v1";
const protocolQueryShell = [
  'if [ "$#" -eq 1 ] && [ "${1-}" = runtime-use-lease-protocol ]; then',
  `  printf '${runtimeUseLeaseProtocol}\\n'`,
  "  exit 0",
  "fi",
  'if [ "$#" -eq 1 ] && [ "${1-}" = distribution-profile ]; then exit 2; fi',
].join("\n");

async function mode(path) {
  return (await lstat(path)).mode & 0o777;
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

async function filesystemEntryCount(path) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory()) return 1;
  const entries = await readdir(path);
  let count = 1;
  for (const entry of entries) {
    count += await filesystemEntryCount(join(path, entry));
  }
  return count;
}

function compareNames(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function assertTreeParity(source, destination) {
  const sourceFiles = await regularFiles(source);
  const destinationFiles = await regularFiles(destination);
  assert.deepEqual(destinationFiles, sourceFiles);
  for (const path of sourceFiles) {
    assert.equal(
      await digest(join(destination, path)),
      await digest(join(source, path)),
      `content drift: ${path}`,
    );
  }
  return sourceFiles;
}

async function makeWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), "blabee-t012-app-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const binary = join(root, "blabee-coordinator");
  await writeFile(
    binary,
    [
      "#!/bin/sh",
      protocolQueryShell,
      'if [ "${1-}" = runtime-identity ] && [ "${2-}" = --app ]; then',
      `  identity='${defaultInspectedRuntimeIdentity}'`,
      '  if [ -f "$3/runtime-identity.txt" ]; then identity=$(/bin/cat "$3/runtime-identity.txt"); fi',
      '  if [ -f "$3/Contents/Resources/runtime-identity.txt" ]; then identity=$(/bin/cat "$3/Contents/Resources/runtime-identity.txt"); fi',
      `  manifest_digest='${defaultInspectedManifestDigest}'`,
      '  if [ -f "$3/manifest-digest.txt" ]; then manifest_digest=$(/bin/cat "$3/manifest-digest.txt"); fi',
      '  if [ -f "$3/Contents/Resources/manifest-digest.txt" ]; then manifest_digest=$(/bin/cat "$3/Contents/Resources/manifest-digest.txt"); fi',
      '  printf \'{"assembly_manifest_sha256":"%s","runtime_identity":"%s","schema_version":"blabee.runtime-identity-inspection.v2"}\\n\' "$manifest_digest" "$identity"',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return { root, binary, output: join(root, "Blabee.app") };
}

async function makePreviousApp(root, parentName, runtimeIdentity) {
  const app = join(root, parentName, "Blabee.app");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "runtime-identity.txt"), `${runtimeIdentity}\n`);
  await writeFile(
    join(app, "assembly-manifest.json"),
    `${JSON.stringify({
      compatible_previous_runtimes: [{
        runtime_identity: `sha256:${"0".repeat(64)}`,
      }],
    })}\n`,
  );
  return app;
}

async function makeLeasePreviousApp(root, parentName, runtimeIdentity, {
  probeBody = `puts("${runtimeUseLeaseProtocol}"); return 0;`,
  protocol = runtimeUseLeaseProtocol,
} = {}) {
  const app = join(root, parentName, "Blabee.app");
  const macOS = join(app, "Contents", "MacOS");
  const resources = join(app, "Contents", "Resources");
  const pluginScripts = join(resources, "Plugin", "blabee", "scripts");
  await mkdir(macOS, { recursive: true });
  await mkdir(pluginScripts, { recursive: true });
  await writeFile(join(resources, "runtime-identity.txt"), `${runtimeIdentity}\n`);
  const source = join(root, `${parentName}-lease-probe.c`);
  await writeFile(source, [
    "#include <errno.h>",
    "#include <limits.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <string.h>",
    "#include <unistd.h>",
    "#include <sys/stat.h>",
    "#include <sys/socket.h>",
    "#include <sys/wait.h>",
    "#include <netinet/in.h>",
    "#include <spawn.h>",
    "#include <mach/mach.h>",
    "#include <servers/bootstrap.h>",
    "int main(int argc, char **argv) {",
    '  if (argc != 2 || strcmp(argv[1], "runtime-use-lease-protocol") != 0) return 2;',
    probeBody,
    "}",
    "",
  ].join("\n"));
  await execFile("/usr/bin/clang", [source, "-o", join(macOS, "blabee-coordinator")], { timeout: 30_000 });
  await copyFile(
    join(repositoryRoot, "bridges", "codex", "plugin", "scripts", "blabee-launcher"),
    join(pluginScripts, "blabee-launcher"),
  );
  await chmod(join(pluginScripts, "blabee-launcher"), 0o755);
  await copyFile(join(repositoryRoot, "Packaging", "macos", "Info.plist"), join(app, "Contents", "Info.plist"));
  const info = await readAppInfo(app);
  if (protocol === null || protocol === undefined) delete info.BlabeeRuntimeUseLeaseProtocol;
  else info.BlabeeRuntimeUseLeaseProtocol = protocol;
  info.BlabeeRuntimeUseLeasePreviousIdentities = [`sha256:${"0".repeat(64)}`];
  await writeFile(join(app, "Contents", "Info.plist"), JSON.stringify(info));
  await execFile("/usr/bin/plutil", ["-convert", "xml1", join(app, "Contents", "Info.plist")]);
  await execFile("/usr/bin/codesign", [
    "--force", "--sign", "-", "--timestamp=none", "--options", "runtime", app,
  ]);
  return app;
}

async function readAppInfo(app) {
  const { stdout } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", join(app, "Contents", "Info.plist")],
  );
  return JSON.parse(stdout);
}

async function waitForPath(path) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await lstat(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForStagingPath(root) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const entry = (await readdir(root)).find((candidate) =>
      candidate.startsWith(".Blabee.app.staging-"));
    if (entry !== undefined) return join(root, entry);
    await delay(10);
  }
  throw new Error(`timed out waiting for a staging directory in ${root}`);
}

async function assembleWithPrivateProbeScratch(fixture, options, directoryName = "private-probe-temporary") {
  const scratch = join(fixture.root, directoryName);
  await mkdir(scratch);
  fixture.output = join(scratch, "Blabee.app");
  const previousTMPDIR = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  try {
    return await assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output, ...options });
  } finally {
    if (previousTMPDIR === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTMPDIR;
    assert.deepEqual((await readdir(scratch)).filter((entry) => entry.includes("blabee-runtime-use-lease-")), []);
  }
}

async function copyCanonicalPackagingSupport(sourceRoot) {
  const directory = join(sourceRoot, "Packaging", "macos", "LaunchAgents");
  await mkdir(directory, { recursive: true });
  await copyFile(canonicalLaunchAgent, join(directory, launchAgentFileName));
  await copyFile(canonicalEntitlements, join(sourceRoot, "Packaging", "macos", entitlementsFileName));
  const resources = join(sourceRoot, "Packaging", "macos", "Resources");
  await mkdir(resources, { recursive: true });
  await copyFile(canonicalAppIcon, join(resources, appIconFileName));
  await copyFile(canonicalMenuBarIcon, join(resources, menuBarIconFileName));
  await copyFile(
    canonicalCodexMarketplace,
    join(resources, codexMarketplaceFileName),
  );
}

test("file handle cleanup preserves the primary error and reports every close error", async () => {
  const primaryError = new Error("primary read failure");
  const firstCloseError = new Error("first close failure");
  const secondCloseError = new Error("second close failure");
  let successfulCloseAttempted = false;

  await assert.rejects(
    macOSAppAssemblyTestSupport.closeFileHandlesPreservingPrimary([
      { close: async () => { throw firstCloseError; } },
      { close: async () => { successfulCloseAttempted = true; } },
      { close: async () => { throw secondCloseError; } },
    ], primaryError),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.cause, primaryError);
      assert.equal(error.errors[0], primaryError);
      assert.deepEqual(error.errors.slice(1), [firstCloseError, secondCloseError]);
      assert.deepEqual(error.closeErrors, [firstCloseError, secondCloseError]);
      assert.match(error.message, /primary read failure/);
      return true;
    },
  );
  assert.equal(successfulCloseAttempted, true);
});

test("stable open fails promptly when a regular path becomes a FIFO after inspection", {
  skip: process.platform !== "darwin" ? "macOS packaging race contract" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  const source = join(fixture.root, "open-race-source");
  const original = join(fixture.root, "open-race-source.original");
  await writeFile(source, "trusted payload\n");

  await assert.rejects(
    Promise.race([
      macOSAppAssemblyTestSupport.openStableRegularFile(
        source,
        "open-race source",
        1024,
        async () => {
          await rename(source, original);
          await execFile("/usr/bin/mkfifo", [source]);
        },
      ),
      delay(1_000).then(() => {
        throw new Error("stable open race timed out");
      }),
    ]),
    /changed while it was being opened/,
  );
  assert.equal(await readFile(original, "utf8"), "trusted payload\n");
});

test("assembler creates the required Blabee.app payload and deterministic manifest", async (t) => {
  const fixture = await makeWorkspace(t);
  const result = await assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
  });

  assert.equal(result.output, join(await realpath(fixture.root), "Blabee.app"));
  assert.equal(result.signed, false);
  assert.equal(result.bundleVersion, "1");
  const contents = join(fixture.output, "Contents");
  const executable = join(contents, "MacOS", "blabee-coordinator");
  const infoPlist = join(contents, "Info.plist");
  const launchAgent = join(contents, "Library", "LaunchAgents", launchAgentFileName);
  const appIcon = join(contents, "Resources", appIconFileName);
  const menuBarIcon = join(contents, "Resources", menuBarIconFileName);
  const entitlements = join(contents, "Resources", entitlementsFileName);
  const codexMarketplace = join(
    contents,
    "Resources",
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const contract = join(contents, "Resources", "Contracts", "v1", "manifest.json");
  const plugin = join(
    contents,
    "Resources",
    "Plugin",
    "blabee",
    ".codex-plugin",
    "plugin.json",
  );
  const launcher = join(
    contents,
    "Resources",
    "Plugin",
    "blabee",
    "scripts",
    "blabee-launcher",
  );
  for (const path of [
    executable,
    infoPlist,
    launchAgent,
    appIcon,
    menuBarIcon,
    entitlements,
    codexMarketplace,
    contract,
    plugin,
    launcher,
  ]) {
    assert.equal((await lstat(path)).isFile(), true, path);
    assert.equal((await lstat(path)).isSymbolicLink(), false, path);
  }
  assert.equal(await readFile(executable, "utf8"), await readFile(fixture.binary, "utf8"));
  assert.equal(await mode(executable), 0o755);
  assert.equal(await mode(infoPlist), 0o644);
  assert.equal(await mode(join(contents, "Library")), 0o755);
  assert.equal(await mode(join(contents, "Library", "LaunchAgents")), 0o755);
  assert.equal(await mode(launchAgent), 0o644);
  assert.equal(await mode(appIcon), 0o644);
  assert.equal(await mode(menuBarIcon), 0o644);
  assert.equal(await mode(entitlements), 0o644);
  assert.equal(await mode(codexMarketplace), 0o644);
  assert.equal(await mode(contract), 0o644);
  assert.equal(await mode(plugin), 0o644);
  assert.equal(await mode(launcher), 0o755);

  const { stdout: plistJSON } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", infoPlist],
  );
  const plist = JSON.parse(plistJSON);
  assert.equal(plist.BlabeeUpdateRepository, "Hyunwoojooo/biadone");
  assert.equal(plist.BlabeeRuntimeUseLeaseProtocol, runtimeUseLeaseProtocol);
  assert.deepEqual(plist.BlabeeRuntimeUseLeasePreviousIdentities, []);
  assert.deepEqual(
    Object.fromEntries([
      "CFBundleDisplayName",
      "CFBundleExecutable",
      "CFBundleIconFile",
      "CFBundleIdentifier",
      "CFBundleName",
      "CFBundlePackageType",
      "CFBundleShortVersionString",
      "CFBundleVersion",
      "LSMinimumSystemVersion",
      "LSUIElement",
      "NSHighResolutionCapable",
      "NSAppleEventsUsageDescription",
      "NSPrincipalClass",
    ].map((key) => [key, plist[key]])),
    {
      CFBundleDisplayName: "Blabee",
      CFBundleExecutable: "blabee-coordinator",
      CFBundleIconFile: appIconFileName,
      CFBundleIdentifier: "com.biadone.blabee",
      CFBundleName: "Blabee",
      CFBundlePackageType: "APPL",
      CFBundleShortVersionString: "0.1.0",
      CFBundleVersion: "1",
      LSMinimumSystemVersion: "13.0",
      LSUIElement: true,
      NSHighResolutionCapable: true,
      NSAppleEventsUsageDescription: "Codex 관리 세션을 시작하거나 복원할 때 Terminal의 새 창을 엽니다.",
      NSPrincipalClass: "NSApplication",
    },
  );

  const { stdout: launchAgentJSON } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", launchAgent],
  );
  const launchAgentValues = JSON.parse(launchAgentJSON);
  assert.deepEqual(launchAgentValues, {
    Label: "com.biadone.blabee.coordinator",
    BundleProgram: "Contents/MacOS/blabee-coordinator",
    ProgramArguments: ["Contents/MacOS/blabee-coordinator", "service"],
    RunAtLoad: true,
  });
  const launchTarget = join(fixture.output, launchAgentValues.BundleProgram);
  const launchTargetMetadata = await lstat(launchTarget);
  assert.equal(launchTargetMetadata.isSymbolicLink(), false);
  assert.equal(launchTargetMetadata.isFile(), true);
  assert.notEqual(launchTargetMetadata.mode & 0o111, 0);
  assert.equal(await digest(launchAgent), await digest(canonicalLaunchAgent));
  assert.equal(await digest(appIcon), await digest(canonicalAppIcon));
  assert.equal(await digest(menuBarIcon), await digest(canonicalMenuBarIcon));
  assert.equal(await digest(entitlements), await digest(canonicalEntitlements));
  const { stdout: entitlementsJSON } = await execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", entitlements]);
  assert.deepEqual(JSON.parse(entitlementsJSON), { "com.apple.security.automation.apple-events": true });
  assert.equal(
    await digest(codexMarketplace),
    await digest(canonicalCodexMarketplace),
  );
  const marketplace = JSON.parse(await readFile(codexMarketplace, "utf8"));
  assert.equal(marketplace.name, "blabee-app");
  assert.deepEqual(marketplace.plugins, [{
    name: "blabee",
    source: { source: "local", path: "./Plugin/blabee" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  }]);

  const sourceContracts = join(repositoryRoot, "Contracts", "v1");
  const bundledContracts = join(contents, "Resources", "Contracts", "v1");
  const contractFiles = await assertTreeParity(sourceContracts, bundledContracts);
  const sourcePlugin = join(repositoryRoot, "bridges", "codex", "plugin");
  const bundledPlugin = join(contents, "Resources", "Plugin", "blabee");
  const pluginFiles = await assertTreeParity(sourcePlugin, bundledPlugin);
  const allBundleFiles = await regularFiles(fixture.output);
  const expectedBundleFiles = [
    "Contents/Info.plist",
    `Contents/Library/LaunchAgents/${launchAgentFileName}`,
    "Contents/MacOS/blabee-coordinator",
    "Contents/Resources/.agents/plugins/marketplace.json",
    `Contents/Resources/${appIconFileName}`,
    `Contents/Resources/${menuBarIconFileName}`,
    `Contents/Resources/${entitlementsFileName}`,
    "Contents/Resources/assembly-manifest.json",
    ...contractFiles.map((path) => `Contents/Resources/Contracts/v1/${path}`),
    ...pluginFiles.map((path) => `Contents/Resources/Plugin/blabee/${path}`),
  ].sort(compareNames);
  assert.deepEqual(allBundleFiles, expectedBundleFiles);

  const manifestPath = join(contents, "Resources", "assembly-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(Object.keys(manifest), [
    "schema_version",
    "bundle_identifier",
    "hash_phase",
    "compatible_previous_runtimes",
    "files",
  ]);
  assert.equal(manifest.schema_version, "blabee.macos-app-assembly.v2");
  assert.equal(manifest.bundle_identifier, "com.biadone.blabee");
  assert.equal(
    manifest.hash_phase,
    "assembled_payload_before_optional_code_signing",
  );
  assert.deepEqual(manifest.compatible_previous_runtimes, []);
  const paths = manifest.files.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort(compareNames));
  assert.equal(paths.includes("Contents/Resources/assembly-manifest.json"), false);
  assert.deepEqual(
    paths,
    expectedBundleFiles.filter(
      (path) => path !== "Contents/Resources/assembly-manifest.json",
    ),
  );
  const binaryEntry = manifest.files.find(
    (entry) => entry.path === "Contents/MacOS/blabee-coordinator",
  );
  assert.deepEqual(binaryEntry, {
    path: "Contents/MacOS/blabee-coordinator",
    sha256: await digest(executable),
    size: (await lstat(executable)).size,
    mode: "0755",
  });
  const launchAgentEntry = manifest.files.find(
    (entry) => entry.path === `Contents/Library/LaunchAgents/${launchAgentFileName}`,
  );
  assert.deepEqual(launchAgentEntry, {
    path: `Contents/Library/LaunchAgents/${launchAgentFileName}`,
    sha256: await digest(launchAgent),
    size: (await lstat(launchAgent)).size,
    mode: "0644",
  });
  const appIconEntry = manifest.files.find(
    (entry) => entry.path === `Contents/Resources/${appIconFileName}`,
  );
  assert.deepEqual(appIconEntry, {
    path: `Contents/Resources/${appIconFileName}`,
    sha256: await digest(appIcon),
    size: (await lstat(appIcon)).size,
    mode: "0644",
  });
  for (const entry of manifest.files) {
    const path = join(fixture.output, ...entry.path.split("/"));
    const metadata = await lstat(path);
    assert.equal(entry.sha256, await digest(path), `manifest hash: ${entry.path}`);
    assert.equal(entry.size, metadata.size, `manifest size: ${entry.path}`);
    assert.equal(
      entry.mode,
      (metadata.mode & 0o777).toString(8).padStart(4, "0"),
      `manifest mode: ${entry.path}`,
    );
  }

  const fixtureEntries = await readdir(fixture.root);
  const leftovers = fixtureEntries.filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(
    fixtureEntries.filter((entry) => entry.includes(".cleanup-")),
    [],
  );
});

test("assembler changes only the staged Info.plist for an explicit bundle version", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceInfoPlist = join(repositoryRoot, "Packaging", "macos", "Info.plist");
  const sourceBefore = await readFile(sourceInfoPlist);
  const result = await assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    bundleVersion: "42",
  });
  const stagedInfoPlist = join(fixture.output, "Contents", "Info.plist");
  const { stdout } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", stagedInfoPlist],
  );
  assert.equal(JSON.parse(stdout).CFBundleVersion, "42");
  assert.equal(result.bundleVersion, "42");
  assert.deepEqual(await readFile(sourceInfoPlist), sourceBefore);
  const infoEntry = result.manifest.files.find(
    (entry) => entry.path === "Contents/Info.plist",
  );
  assert.equal(infoEntry.sha256, await digest(stagedInfoPlist));
});

test("assembler embeds only directly inspected previous runtime identities in sorted v2 policy", async (t) => {
  const fixture = await makeWorkspace(t);
  const firstIdentity = `sha256:${"1".repeat(64)}`;
  const secondIdentity = `sha256:${"2".repeat(64)}`;
  const secondApp = await makePreviousApp(
    fixture.root,
    "previous-second",
    secondIdentity,
  );
  const firstApp = await makePreviousApp(
    fixture.root,
    "previous-first",
    firstIdentity,
  );

  const result = await assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    compatiblePreviousApps: [secondApp, firstApp],
  });
  const expectedPolicies = [firstIdentity, secondIdentity].map((identity) => ({
    runtime_identity: identity,
    allowed_request_types: [
      "emit_decision",
      "session_start",
      "stop",
      "user_prompt_submit",
    ],
  }));
  assert.deepEqual(result.manifest.compatible_previous_runtimes, expectedPolicies);
  assert.deepEqual(result.compatiblePreviousApps, [
    await realpath(firstApp),
    await realpath(secondApp),
  ]);
  const manifest = JSON.parse(await readFile(
    join(fixture.output, "Contents", "Resources", "assembly-manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.compatible_previous_runtimes, expectedPolicies);
  assert.equal(
    manifest.compatible_previous_runtimes.some(
      (entry) => entry.runtime_identity === `sha256:${"0".repeat(64)}`,
    ),
    false,
  );
  assert.deepEqual((await readAppInfo(fixture.output)).BlabeeRuntimeUseLeasePreviousIdentities, []);
});

test("assembler rejects legacy, malformed, oversized, noisy, and unsuccessful source protocol replies", async (t) => {
  const cases = [
    ["legacy", "exit 0"],
    ["missing newline", `printf '${runtimeUseLeaseProtocol}'`],
    ["extra newline", `printf '${runtimeUseLeaseProtocol}\\n\\n'`],
    ["carriage return", `printf '${runtimeUseLeaseProtocol}\\r\\n'`],
    ["invalid UTF-8", "printf '\\377\\n'"],
    ["oversized", "/usr/bin/head -c 4097 /dev/zero"],
    ["stderr", `printf '${runtimeUseLeaseProtocol}\\n'; printf 'unexpected\\n' >&2`],
    ["nonzero status", `printf '${runtimeUseLeaseProtocol}\\n'; exit 1`],
  ];
  for (const [label, reply] of cases) {
    const fixture = await makeWorkspace(t);
    await writeFile(fixture.binary, `#!/bin/sh\n${reply}\n`, { mode: 0o700 });
    await assert.rejects(
      assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output }),
      /runtime use lease protocol probe/,
      label,
    );
    await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
    assert.deepEqual((await readdir(fixture.root)).filter((entry) => entry.startsWith(".Blabee.app.staging-")), []);
  }
});

test("assembler bounds a stuck source protocol query", { timeout: 12_000 }, async (t) => {
  const fixture = await makeWorkspace(t);
  await writeFile(fixture.binary, "#!/bin/sh\nexec /bin/sleep 30\n", { mode: 0o700 });
  const started = Date.now();
  await assert.rejects(
    assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /runtime use lease protocol probe failed/,
  );
  assert.ok(Date.now() - started < 10_000);
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
});

test("assembler probes its staged executable before populating Info.plist with a clean environment", async (t) => {
  const fixture = await makeWorkspace(t);
  const probeRecord = join(fixture.root, "protocol-probe-record");
  const source = [
    "#!/bin/sh",
    '[ "$#" -eq 1 ] && [ "$1" = runtime-use-lease-protocol ] || exit 1',
    '[ ! -f "${0%/MacOS/*}/Info.plist" ] || exit 2',
    '[ -z "${BLABEE_COORDINATOR_BINARY-}" ] || exit 3',
    `printf '%s\\n' "$0" > '${probeRecord}'`,
    `printf '${runtimeUseLeaseProtocol}\\n'`,
    "",
  ].join("\n");
  await writeFile(fixture.binary, source, { mode: 0o700 });
  await execFile(process.execPath, [
    assemblyScript, "--binary", fixture.binary, "--output", fixture.output,
  ], {
    env: { ...process.env, BLABEE_COORDINATOR_BINARY: "/untrusted/override" },
  });
  const probedPath = (await readFile(probeRecord, "utf8")).trim();
  assert.notEqual(probedPath, fixture.binary);
  assert.match(probedPath, /\.Blabee\.app\.staging-[^/]+\/Contents\/MacOS\/blabee-coordinator$/u);
  assert.equal(await readFile(join(fixture.output, "Contents", "MacOS", "blabee-coordinator"), "utf8"), source);
  assert.equal((await readAppInfo(fixture.output)).BlabeeRuntimeUseLeaseProtocol, runtimeUseLeaseProtocol);
});

test("assembler admits only explicit verified previous lease identities using a private copy", async (t) => {
  const fixture = await makeWorkspace(t);
  const identities = ["1", "2"].map((digit) => `sha256:${digit.repeat(64)}`);
  const first = await makeLeasePreviousApp(fixture.root, "lease-first", identities[0], {
    probeBody: [
      'if (strstr(argv[0], "/blabee-runtime-use-lease-") == NULL) return 3;',
      'const char *suffix = strstr(argv[0], "/Blabee.app/Contents/MacOS/blabee-coordinator");',
      "if (suffix == NULL) return 4;",
      "char scratch[PATH_MAX];",
      'snprintf(scratch, sizeof scratch, "%.*s", (int)(suffix - argv[0]), argv[0]);',
      "struct stat metadata;",
      "if (lstat(scratch, &metadata) != 0 || (metadata.st_mode & 0777) != 0700) return 5;",
      'if (getenv("HOME") != NULL || getenv("BLABEE_COORDINATOR_BINARY") != NULL) return 6;',
      `puts("${runtimeUseLeaseProtocol}"); return 0;`,
    ].join("\n"),
  });
  const second = await makeLeasePreviousApp(fixture.root, "lease-second", identities[1]);
  const originalFiles = await regularFiles(first);
  const originalDigests = await Promise.all(originalFiles.map((path) => digest(join(first, path))));
  const result = await assembleWithPrivateProbeScratch(fixture, {
    compatiblePreviousApps: [second, first],
  });
  const info = await readAppInfo(result.output);
  assert.deepEqual(info.BlabeeRuntimeUseLeasePreviousIdentities, identities);
  assert.equal(info.BlabeeRuntimeUseLeasePreviousIdentities.includes(`sha256:${"0".repeat(64)}`), false);
  assert.deepEqual(result.manifest.compatible_previous_runtimes.map((entry) => entry.runtime_identity), identities);
  assert.deepEqual(await regularFiles(first), originalFiles);
  assert.deepEqual(await Promise.all(originalFiles.map((path) => digest(join(first, path)))), originalDigests);
  assert.equal(result.manifest.files.find((entry) => entry.path === "Contents/Info.plist").sha256,
    await digest(join(result.output, "Contents", "Info.plist")));
});

test("previous lease probe preserves the signed Mach-O bundle context", {
  skip: process.platform !== "darwin" ? "requires macOS codesign and clang" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  const identity = `sha256:${"7".repeat(64)}`;
  const previous = await makeLeasePreviousApp(fixture.root, "signed-previous", identity, {
    probeBody: [
      'if (strstr(argv[0], "/blabee-runtime-use-lease-") == NULL) return 3;',
      'if (strstr(argv[0], "/Blabee.app/Contents/MacOS/blabee-coordinator") == NULL) return 4;',
      'if (access("../Info.plist", R_OK) != 0) return 5;',
      'if (access("../_CodeSignature/CodeResources", R_OK) != 0) return 6;',
      'if (access("../Resources/runtime-identity.txt", R_OK) != 0) return 7;',
      `puts("${runtimeUseLeaseProtocol}"); return 0;`,
    ].join("\n"),
  });
  const previousCoordinator = join(previous, "Contents", "MacOS", "blabee-coordinator");
  await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", previous]);

  const detached = join(fixture.root, "detached-coordinator");
  await copyFile(previousCoordinator, detached);
  await chmod(detached, 0o700);
  await assert.rejects(
    execFile("/usr/bin/codesign", ["--verify", "--strict", detached]),
    (error) => {
      assert.match(error.stderr, /invalid Info\.plist/u);
      return true;
    },
  );

  const originalFiles = await regularFiles(previous);
  const originalDigests = await Promise.all(originalFiles.map((path) => digest(join(previous, path))));
  const result = await assembleWithPrivateProbeScratch(fixture, {
    compatiblePreviousApps: [previous],
  });
  assert.deepEqual((await readAppInfo(result.output)).BlabeeRuntimeUseLeasePreviousIdentities, [identity]);
  assert.deepEqual(await regularFiles(previous), originalFiles);
  assert.deepEqual(await Promise.all(originalFiles.map((path) => digest(join(previous, path)))), originalDigests);
  await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", previous]);
});

test("a previous probe cannot write, fork, spawn, use network or contact Mach services", async (t) => {
  const fixture = await makeWorkspace(t);
  const identity = `sha256:${"8".repeat(64)}`;
  const forbiddenWrite = join(fixture.root, "probe-must-not-write");
  const previous = await makeLeasePreviousApp(fixture.root, "confined-previous", identity, {
    probeBody: [
      `FILE *output = fopen(${JSON.stringify(forbiddenWrite)}, "w");`,
      "if (output != NULL) { fclose(output); return 3; }",
      "if (errno != EPERM && errno != EACCES) return 4;",
      'output = fopen("../Resources/runtime-identity.txt", "w");',
      "if (output != NULL) { fclose(output); return 5; }",
      "if (errno != EPERM && errno != EACCES) return 6;",
      "pid_t child = fork();",
      "if (child == 0) _exit(7);",
      "if (child > 0) { waitpid(child, NULL, 0); return 8; }",
      "if (errno != EPERM && errno != EACCES) return 9;",
      'char *arguments[] = { argv[0], "unexpected-command", NULL };',
      "char *environment[] = { NULL };",
      "int spawned = posix_spawn(&child, argv[0], NULL, NULL, arguments, environment);",
      "if (spawned == 0) { waitpid(child, NULL, 0); return 10; }",
      "if (spawned != EPERM && spawned != EACCES) return 11;",
      'arguments[0] = "/usr/bin/true";',
      "spawned = posix_spawn(&child, arguments[0], NULL, NULL, arguments, environment);",
      "if (spawned == 0) { waitpid(child, NULL, 0); return 12; }",
      "if (spawned != EPERM && spawned != EACCES) return 13;",
      "int connection = socket(AF_INET, SOCK_STREAM, 0);",
      "if (connection >= 0) {",
      "  struct sockaddr_in destination = {0};",
      "  destination.sin_family = AF_INET;",
      "  destination.sin_port = htons(9);",
      "  destination.sin_addr.s_addr = htonl(INADDR_LOOPBACK);",
      "  int connected = connect(connection, (struct sockaddr *)&destination, sizeof destination);",
      "  int failure = errno;",
      "  close(connection);",
      "  if (connected == 0 || (failure != EPERM && failure != EACCES)) return 14;",
      "} else if (errno != EPERM && errno != EACCES) return 15;",
      "mach_port_t service = MACH_PORT_NULL;",
      'if (bootstrap_look_up(bootstrap_port, "com.apple.cfprefsd.agent", &service) != BOOTSTRAP_NOT_PRIVILEGED) return 16;',
      `puts("${runtimeUseLeaseProtocol}"); return 0;`,
    ].join("\n"),
  });
  const result = await assembleWithPrivateProbeScratch(fixture, {
    compatiblePreviousApps: [previous],
  }, 'scratch "with\\quotes"');
  assert.deepEqual((await readAppInfo(result.output)).BlabeeRuntimeUseLeasePreviousIdentities, [identity]);
  await assert.rejects(lstat(forbiddenWrite), { code: "ENOENT" });
  await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", previous]);
});

test("a stuck previous protocol query is bounded and its private bundle is removed", { timeout: 12_000 }, async (t) => {
  const fixture = await makeWorkspace(t);
  const identity = `sha256:${"9".repeat(64)}`;
  const previous = await makeLeasePreviousApp(fixture.root, "stuck-previous", identity, {
    probeBody: "for (;;) sleep(30);",
  });
  const started = Date.now();
  const result = await assembleWithPrivateProbeScratch(fixture, {
    compatiblePreviousApps: [previous],
  });
  assert.ok(Date.now() - started < 10_000);
  assert.deepEqual((await readAppInfo(result.output)).BlabeeRuntimeUseLeasePreviousIdentities, []);
  assert.deepEqual(result.manifest.compatible_previous_runtimes.map((entry) => entry.runtime_identity), [identity]);
  await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", previous]);
});

test("a previous protocol marker alone cannot approve lease admission", async (t) => {
  const cases = [
    ["legacy marker", { protocol: null }],
    ["wrong output", { probeBody: 'puts("wrong"); return 0;' }],
    ["oversized output", { probeBody: "char bytes[4097] = {0}; fwrite(bytes, 1, sizeof bytes, stdout); return 0;" }],
    ["extra executable", {}],
    ["different launcher", {}],
    ["symlink asset", {}],
    ["excessive inventory", {}],
  ];
  for (const [label, options] of cases) {
    const fixture = await makeWorkspace(t);
    const identity = `sha256:${"3".repeat(64)}`;
    const previous = await makeLeasePreviousApp(fixture.root, "previous", identity, options);
    if (label === "extra executable") {
      await writeFile(join(previous, "Contents", "MacOS", "unknown-helper"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    } else if (label === "different launcher") {
      await writeFile(join(previous, "Contents", "Resources", "Plugin", "blabee", "scripts", "blabee-launcher"), "#!/bin/sh\nexit 0\n");
    } else if (label === "symlink asset") {
      await symlink(fixture.binary, join(previous, "Contents", "Resources", "linked-asset"));
    } else if (label === "excessive inventory") {
      for (let index = 0; index < 1025; index += 1) {
        await writeFile(join(previous, "Contents", "Resources", `asset-${index}`), "");
      }
    }
    const result = await assembleWithPrivateProbeScratch(fixture, {
      compatiblePreviousApps: [previous],
    });
    assert.deepEqual((await readAppInfo(result.output)).BlabeeRuntimeUseLeasePreviousIdentities, [], label);
    assert.deepEqual(result.manifest.compatible_previous_runtimes.map((entry) => entry.runtime_identity), [identity], label);
  }
});

test("assembler rejects a previous identity or manifest digest changing across its copied probe", async (t) => {
  for (const changedFile of ["runtime-identity.txt", "manifest-digest.txt"]) {
    const fixture = await makeWorkspace(t);
    const identity = `sha256:${"4".repeat(64)}`;
    const previous = await makeLeasePreviousApp(fixture.root, "previous", identity);
    const inspectionRecord = join(fixture.root, "previous-inspection-started");
    const inspector = await readFile(fixture.binary, "utf8");
    await writeFile(fixture.binary, inspector.replace("#!/bin/sh\n", [
      "#!/bin/sh",
      'if [ "${1-}" = runtime-identity ]; then',
      `  if [ -f '${inspectionRecord}' ]; then`,
      `    printf 'sha256:${"5".repeat(64)}\\n' > '${join(previous, "Contents", "Resources", changedFile)}'`,
      "  else",
      `    printf 'inspected\\n' > '${inspectionRecord}'`,
      "  fi",
      "fi",
      "",
    ].join("\n")));
    await assert.rejects(
      assembleMacOSApp({
        binaryPath: fixture.binary,
        outputPath: fixture.output,
        compatiblePreviousApps: [previous],
      }),
      /compatible previous app changed during lease inspection/,
      changedFile,
    );
    await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  }
});

test("assembler inspects and packages one private coordinator snapshot during source replacement", async (t) => {
  const fixture = await makeWorkspace(t);
  const previousIdentity = `sha256:${"6".repeat(64)}`;
  const previousApp = await makePreviousApp(
    fixture.root,
    "snapshot-previous",
    previousIdentity,
  );
  const inspectorStarted = join(fixture.root, "snapshot-inspector-started");
  const releaseInspector = join(fixture.root, "snapshot-inspector-release");
  const inspectedInode = join(fixture.root, "snapshot-inspector-inode");
  const originalBinary = [
    "#!/bin/sh",
    protocolQueryShell,
    'if [ "${1-}" = runtime-identity ]; then',
    `  /usr/bin/touch '${inspectorStarted}'`,
    `  /usr/bin/stat -f '%i' "$0" > '${inspectedInode}'`,
    `  while [ ! -f '${releaseInspector}' ]; do /bin/sleep 0.01; done`,
    `  printf '%s\\n' '${JSON.stringify({
      assembly_manifest_sha256: defaultInspectedManifestDigest,
      runtime_identity: previousIdentity,
      schema_version: "blabee.runtime-identity-inspection.v2",
    })}'`,
    "  exit 0",
    "fi",
    "exit 0",
    "",
  ].join("\n");
  await writeFile(fixture.binary, originalBinary, { mode: 0o700 });

  const assembly = assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    compatiblePreviousApps: [previousApp],
  });
  await waitForPath(inspectorStarted);
  const replacementBinary = "#!/bin/sh\nprintf 'replacement coordinator\\n'\n";
  await writeFile(fixture.binary, replacementBinary, { mode: 0o700 });
  await writeFile(releaseInspector, "release\n");
  const result = await assembly;
  const packagedCoordinator = join(
    result.output,
    "Contents",
    "MacOS",
    "blabee-coordinator",
  );

  assert.equal(
    await readFile(packagedCoordinator, "utf8"),
    originalBinary,
  );
  assert.equal(
    (await lstat(packagedCoordinator)).ino,
    Number((await readFile(inspectedInode, "utf8")).trim()),
  );
  assert.equal(
    result.manifest.compatible_previous_runtimes[0].runtime_identity,
    previousIdentity,
  );
});

test("assembler snapshots compatible previous app input before its first await", async (t) => {
  const fixture = await makeWorkspace(t);
  const identities = ["8", "9", "a"].map(
    (character) => `sha256:${character.repeat(64)}`,
  );
  const apps = await Promise.all(identities.map((identity, index) =>
    makePreviousApp(fixture.root, `snapshot-input-${index}`, identity)));
  const inspectorStarted = join(fixture.root, "input-inspector-started");
  const releaseInspector = join(fixture.root, "input-inspector-release");
  await writeFile(
    fixture.binary,
    [
      "#!/bin/sh",
      protocolQueryShell,
      `  /usr/bin/touch '${inspectorStarted}'`,
      `  while [ ! -f '${releaseInspector}' ]; do /bin/sleep 0.01; done`,
      '  identity=$(/bin/cat "$3/runtime-identity.txt")',
      `  printf '{"assembly_manifest_sha256":"${defaultInspectedManifestDigest}","runtime_identity":"%s","schema_version":"blabee.runtime-identity-inspection.v2"}\\n' "$identity"`,
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const callerOwnedApps = [apps[0]];
  const assembly = assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    compatiblePreviousApps: callerOwnedApps,
  });
  await waitForPath(inspectorStarted);
  callerOwnedApps.push(apps[1], apps[2]);
  await writeFile(releaseInspector, "release\n");
  const result = await assembly;
  assert.deepEqual(
    result.manifest.compatible_previous_runtimes.map(
      (entry) => entry.runtime_identity,
    ),
    [identities[0]],
  );
});

test("assembler rejects unsafe, duplicate, excessive, and malformed previous app inspection", async (t) => {
  const relativeFixture = await makeWorkspace(t);
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: relativeFixture.binary,
      outputPath: relativeFixture.output,
      compatiblePreviousApps: ["Blabee.app"],
    }),
    /compatible previous app must be an explicit absolute path/,
  );

  const excessiveFixture = await makeWorkspace(t);
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: excessiveFixture.binary,
      outputPath: excessiveFixture.output,
      compatiblePreviousApps: ["/tmp/a/Blabee.app", "/tmp/b/Blabee.app", "/tmp/c/Blabee.app"],
    }),
    /at most 2 compatible previous apps/,
  );

  const duplicatePathFixture = await makeWorkspace(t);
  const duplicatePathApp = await makePreviousApp(
    duplicatePathFixture.root,
    "duplicate-path",
    `sha256:${"3".repeat(64)}`,
  );
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: duplicatePathFixture.binary,
      outputPath: duplicatePathFixture.output,
      compatiblePreviousApps: [duplicatePathApp, duplicatePathApp],
    }),
    /compatible previous app was provided more than once/,
  );

  const duplicateIdentityFixture = await makeWorkspace(t);
  const duplicateIdentity = `sha256:${"4".repeat(64)}`;
  const duplicateIdentityA = await makePreviousApp(
    duplicateIdentityFixture.root,
    "duplicate-identity-a",
    duplicateIdentity,
  );
  const duplicateIdentityB = await makePreviousApp(
    duplicateIdentityFixture.root,
    "duplicate-identity-b",
    duplicateIdentity,
  );
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: duplicateIdentityFixture.binary,
      outputPath: duplicateIdentityFixture.output,
      compatiblePreviousApps: [duplicateIdentityA, duplicateIdentityB],
    }),
    /duplicate runtime identity/,
  );

  const malformedFixture = await makeWorkspace(t);
  const malformedApp = await makePreviousApp(
    malformedFixture.root,
    "malformed-inspection",
    `sha256:${"5".repeat(64)}`,
  );
  await writeFile(
    malformedFixture.binary,
    `#!/bin/sh\n${protocolQueryShell}\nprintf '{"runtime_identity":"not-verified"}\\n'\n`,
    { mode: 0o700 },
  );
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: malformedFixture.binary,
      outputPath: malformedFixture.output,
      compatiblePreviousApps: [malformedApp],
    }),
    /unexpected keys/,
  );

  const invalidIdentities = [
    ["encoded newline", `sha256:${"6".repeat(64)}\n`],
    ["encoded carriage return", `sha256:${"6".repeat(64)}\r`],
    ["unicode line separator", `sha256:${"6".repeat(64)}\u2028`],
    ["unicode paragraph separator", `sha256:${"6".repeat(64)}\u2029`],
    ["uppercase hex", `sha256:${"A".repeat(64)}`],
    ["overlength hex", `sha256:${"6".repeat(65)}`],
  ];
  for (const [label, runtimeIdentity] of invalidIdentities) {
    const invalidFixture = await makeWorkspace(t);
    const invalidApp = await makePreviousApp(
      invalidFixture.root,
      `invalid-${label.replaceAll(" ", "-")}`,
      `sha256:${"6".repeat(64)}`,
    );
    const response = JSON.stringify({
      assembly_manifest_sha256: defaultInspectedManifestDigest,
      runtime_identity: runtimeIdentity,
      schema_version: "blabee.runtime-identity-inspection.v2",
    });
    await writeFile(
      invalidFixture.binary,
      `#!/bin/sh\n${protocolQueryShell}\nprintf '%s\\n' '${response}'\n`,
      { mode: 0o700 },
    );
    await assert.rejects(
      assembleMacOSApp({
        binaryPath: invalidFixture.binary,
        outputPath: invalidFixture.output,
        compatiblePreviousApps: [invalidApp],
      }),
      /invalid identity/,
      label,
    );
  }
});

test("assembler CLI accepts one or two previous apps and rejects a third or raw identity", async (t) => {
  const fixture = await makeWorkspace(t);
  const help = await execFile(process.execPath, [assemblyScript, "--help"]);
  assert.match(help.stdout, /may be repeated at most twice/);
  assert.match(help.stdout, /raw runtime identity values are not accepted/);
  assert.match(help.stdout, /--bundle-version 1/u);
  const previousApps = await Promise.all(["b", "c", "d"].map(
    (character, index) => makePreviousApp(
      fixture.root,
      `cli-previous-${index}`,
      `sha256:${character.repeat(64)}`,
    ),
  ));
  for (const count of [1, 2]) {
    const output = join(fixture.root, `cli-${count}`, "Blabee.app");
    await mkdir(join(fixture.root, `cli-${count}`));
    const argumentsList = [
      assemblyScript,
      "--binary",
      fixture.binary,
      "--output",
      output,
      "--bundle-version",
      String(count + 1),
    ];
    for (const app of previousApps.slice(0, count)) {
      argumentsList.push("--compatible-previous-app", app);
    }
    const result = await execFile(process.execPath, argumentsList);
    assert.deepEqual(JSON.parse(result.stdout), {
      output: join(await realpath(join(fixture.root, `cli-${count}`)), "Blabee.app"),
      signed: false,
    });
    const manifest = JSON.parse(await readFile(
      join(output, "Contents", "Resources", "assembly-manifest.json"),
      "utf8",
    ));
    assert.equal(manifest.compatible_previous_runtimes.length, count);
    const { stdout: plistJSON } = await execFile(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", join(output, "Contents", "Info.plist")],
    );
    assert.equal(JSON.parse(plistJSON).CFBundleVersion, String(count + 1));
  }

  const rejectedOutput = join(fixture.root, "cli-rejected", "Blabee.app");
  await mkdir(join(fixture.root, "cli-rejected"));
  await assert.rejects(
    execFile(process.execPath, [
      assemblyScript,
      "--binary",
      fixture.binary,
      "--output",
      rejectedOutput,
      ...previousApps.flatMap((app) => ["--compatible-previous-app", app]),
    ]),
    /may be provided at most 2 times/,
  );
  await assert.rejects(
    execFile(process.execPath, [
      assemblyScript,
      "--binary",
      fixture.binary,
      "--output",
      rejectedOutput,
      "--compatible-previous-runtime-identity",
      `sha256:${"e".repeat(64)}`,
    ]),
    /unsupported argument/,
  );
});

test("assembler rejects Info.plist value type drift and cleans staging", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-info-drift");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "bridges", "codex", "plugin"), { recursive: true });
  await copyCanonicalPackagingSupport(sourceRoot);
  const canonicalInfo = await readFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    "utf8",
  );
  await writeFile(
    join(infoDirectory, "Info.plist"),
    canonicalInfo.replace(
      "<key>LSUIElement</key>\n\t<true/>",
      "<key>LSUIElement</key>\n\t<string>true</string>",
    ),
  );

  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      sourceRoot,
    }),
    /Info\.plist LSUIElement must be true \(boolean\)/,
  );
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  const cleanupEntries = await readdir(fixture.root);
  const leftovers = cleanupEntries.filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(
    cleanupEntries.filter((entry) => entry.includes(".cleanup-")),
    [],
  );
});

test("assembler cleanup opt-out preserves its exact partial staging tree", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-preserve-partial");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "bridges", "codex", "plugin"), { recursive: true });
  await copyCanonicalPackagingSupport(sourceRoot);
  const canonicalInfo = await readFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    "utf8",
  );
  await writeFile(
    join(infoDirectory, "Info.plist"),
    canonicalInfo.replace(
      "<key>LSUIElement</key>\n\t<true/>",
      "<key>LSUIElement</key>\n\t<string>true</string>",
    ),
  );

  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      sourceRoot,
      cleanupOnFailure: false,
    }),
    /Info\.plist LSUIElement must be true \(boolean\)/,
  );
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.equal(leftovers.length, 1);
  const preservedInfo = join(
    fixture.root,
    leftovers[0],
    "Contents",
    "Info.plist",
  );
  assert.equal((await lstat(preservedInfo)).isFile(), true);
});

test("assembler rejects LaunchAgent key, type, and service argv drift", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-launch-agent-drift");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "bridges", "codex", "plugin"), { recursive: true });
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await copyCanonicalPackagingSupport(sourceRoot);
  const fixtureLaunchAgent = join(
    sourceRoot,
    "Packaging",
    "macos",
    "LaunchAgents",
    launchAgentFileName,
  );
  const canonical = await readFile(canonicalLaunchAgent, "utf8");
  const mutations = [
    {
      content: canonical.replace(
        "\t<key>RunAtLoad</key>",
        "\t<key>KeepAlive</key>\n\t<true/>\n\t<key>RunAtLoad</key>",
      ),
      pattern: /must contain exactly/,
    },
    {
      content: canonical.replace("\t\t<string>service<\/string>", "\t\t<string>daemon<\/string>"),
      pattern: /ProgramArguments must be/,
    },
    {
      content: canonical.replace("\t<true\/>\n<\/dict>", "\t<string>true<\/string>\n<\/dict>"),
      pattern: /RunAtLoad must be true \(boolean\)/,
    },
  ];
  for (const mutation of mutations) {
    await writeFile(fixtureLaunchAgent, mutation.content);
    await assert.rejects(
      assembleMacOSApp({
        binaryPath: fixture.binary,
        outputPath: fixture.output,
        sourceRoot,
      }),
      mutation.pattern,
    );
    await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  }
});

test("assembler rejects Codex marketplace identity and plugin source drift", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-marketplace-drift");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "bridges", "codex", "plugin"), { recursive: true });
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await copyCanonicalPackagingSupport(sourceRoot);
  const fixtureMarketplace = join(
    sourceRoot,
    "Packaging",
    "macos",
    "Resources",
    codexMarketplaceFileName,
  );
  const canonical = await readFile(canonicalCodexMarketplace, "utf8");
  const mutations = [
    canonical.replace('"name": "blabee-app"', '"name": "other-marketplace"'),
    canonical.replace('"path": "./Plugin/blabee"', '"path": "../../outside"'),
  ];
  for (const content of mutations) {
    await writeFile(fixtureMarketplace, content);
    await assert.rejects(
      assembleMacOSApp({
        binaryPath: fixture.binary,
        outputPath: fixture.output,
        sourceRoot,
      }),
      /Codex marketplace manifest (identity|plugin contract) is invalid/,
    );
    await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  }
});

test("assembler bounds and strictly decodes Codex marketplace JSON", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-strict-marketplace");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "bridges", "codex", "plugin"), { recursive: true });
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await copyCanonicalPackagingSupport(sourceRoot);
  const fixtureMarketplace = join(
    sourceRoot,
    "Packaging",
    "macos",
    "Resources",
    codexMarketplaceFileName,
  );
  const canonical = await readFile(canonicalCodexMarketplace, "utf8");
  const cases = [
    {
      name: "oversized input",
      content: Buffer.alloc((64 * 1024) + 1, 0x20),
      pattern: /exceeds the 65536-byte limit/,
    },
    {
      name: "invalid UTF-8",
      content: Buffer.concat([
        Buffer.from(canonical.slice(0, -2), "utf8"),
        Buffer.from([0xC3, 0x28]),
        Buffer.from("}\n", "utf8"),
      ]),
      pattern: /must be valid UTF-8/,
    },
    {
      name: "escaped duplicate top-level key",
      content: canonical.replace(
        "{",
        "{\n  \"\\u006eame\": \"blabee-app\",",
      ),
      pattern: /contains duplicate JSON object keys/,
    },
    {
      name: "duplicate nested key",
      content: canonical.replace(
        '"source": "local",',
        '"source": "local", "source": "local",',
      ),
      pattern: /contains duplicate JSON object keys/,
    },
  ];

  for (const invalidCase of cases) {
    await writeFile(fixtureMarketplace, invalidCase.content);
    await assert.rejects(
      assembleMacOSApp({
        binaryPath: fixture.binary,
        outputPath: fixture.output,
        sourceRoot,
      }),
      invalidCase.pattern,
      invalidCase.name,
    );
    await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  }
});

test("assembler rejects implicit destinations, unsafe output, existing output, and invalid binaries", async (t) => {
  const fixture = await makeWorkspace(t);
  for (const bundleVersion of ["0", "01", "10000", "1.5"]) {
    await assert.rejects(
      assembleMacOSApp({
        binaryPath: fixture.binary,
        outputPath: fixture.output,
        bundleVersion,
      }),
      /bundle version must be a canonical integer from 1 through 9999/u,
    );
  }
  await assert.rejects(
    assembleMacOSApp({ binaryPath: "relative-binary", outputPath: fixture.output }),
    /--binary must be an explicit absolute path/,
  );
  await assert.rejects(
    assembleMacOSApp({ binaryPath: fixture.binary, outputPath: "Blabee.app" }),
    /--output must be an explicit absolute path/,
  );
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: "/Applications/Blabee.app",
    }),
    /direct writes to \/Applications are not supported/,
  );
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: "/Library/Blabee.app",
    }),
    /must be inside the Blabee repository or a system temporary directory/,
  );

  await mkdir(fixture.output);
  await assert.rejects(
    assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output }),
    /output already exists/,
  );
  await rm(fixture.output, { recursive: true });

  const linkedBinary = join(fixture.root, "linked-coordinator");
  await symlink(fixture.binary, linkedBinary);
  await assert.rejects(
    assembleMacOSApp({ binaryPath: linkedBinary, outputPath: fixture.output }),
    /must be a regular file, not a symlink or special file/,
  );

  const nonExecutable = join(fixture.root, "non-executable");
  await writeFile(nonExecutable, "not executable\n", { mode: 0o600 });
  await assert.rejects(
    assembleMacOSApp({ binaryPath: nonExecutable, outputPath: fixture.output }),
    /must already be executable/,
  );
});

test("concurrent assemblers never replace or mix the final app", async (t) => {
  const fixture = await makeWorkspace(t);
  const outcomes = await Promise.allSettled([
    assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output }),
    assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.match(rejected.reason.message, /output (already exists|appeared during assembly)/);
  assert.equal(
    await readFile(join(fixture.output, "Contents", "MacOS", "blabee-coordinator"), "utf8"),
    await readFile(fixture.binary, "utf8"),
  );
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("an output created after assembly starts is preserved and blocks publish", async (t) => {
  const fixture = await makeWorkspace(t);
  const previousApp = await makePreviousApp(
    fixture.root,
    "publish-race-previous",
    `sha256:${"6".repeat(64)}`,
  );
  const inspectorStarted = join(fixture.root, "publish-inspector-started");
  const releaseInspector = join(fixture.root, "publish-inspector-release");
  await writeFile(
    fixture.binary,
    [
      "#!/bin/sh",
      protocolQueryShell,
      'if [ "${1-}" = runtime-identity ] && [ "${2-}" = --app ]; then',
      `  touch '${inspectorStarted}'`,
      `  while [ ! -f '${releaseInspector}' ]; do /bin/sleep 0.01; done`,
      `  printf '{"assembly_manifest_sha256":"${defaultInspectedManifestDigest}","runtime_identity":"${defaultInspectedRuntimeIdentity}","schema_version":"blabee.runtime-identity-inspection.v2"}\\n'`,
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const assembly = assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    compatiblePreviousApps: [previousApp],
  });
  try {
    await waitForPath(inspectorStarted);
    await mkdir(fixture.output);
    await writeFile(join(fixture.output, "external-sentinel.txt"), "preserve me\n");
  } finally {
    await writeFile(releaseInspector, "release\n");
  }

  await assert.rejects(assembly, /output appeared during assembly/);
  assert.equal(
    await readFile(join(fixture.output, "external-sentinel.txt"), "utf8"),
    "preserve me\n",
  );
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("resource symlinks fail closed and the exact staging directory is cleaned", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  const contracts = join(sourceRoot, "Contracts", "v1");
  const plugin = join(sourceRoot, "bridges", "codex", "plugin");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(contracts, { recursive: true });
  await mkdir(plugin, { recursive: true });
  await copyCanonicalPackagingSupport(sourceRoot);
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await writeFile(join(contracts, "manifest.json"), "{}\n");
  const outside = join(fixture.root, "outside.txt");
  await writeFile(outside, "must not be copied\n");
  await symlink(outside, join(plugin, "escape"));

  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      sourceRoot,
    }),
    /resource input must not be a symlink/,
  );
  assert.equal(await lstat(outside).then((value) => value.isFile()), true);
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("intermediate source path symlinks cannot import external packaging trees", async (t) => {
  for (const component of ["Packaging", "Contracts", "bridges"]) {
    await t.test(component, async (t) => {
      const fixture = await makeWorkspace(t);
      const sourceRoot = join(fixture.root, `source-${component.toLowerCase()}`);
      const infoDirectory = join(sourceRoot, "Packaging", "macos");
      const contracts = join(sourceRoot, "Contracts", "v1");
      const plugin = join(sourceRoot, "bridges", "codex", "plugin");
      await mkdir(infoDirectory, { recursive: true });
      await mkdir(contracts, { recursive: true });
      await mkdir(plugin, { recursive: true });
      await copyCanonicalPackagingSupport(sourceRoot);
      await copyFile(
        join(repositoryRoot, "Packaging", "macos", "Info.plist"),
        join(infoDirectory, "Info.plist"),
      );
      await writeFile(join(contracts, "manifest.json"), "{}\n");
      await writeFile(join(plugin, "external-marker.txt"), "outside source root\n");

      const sourceComponent = join(sourceRoot, component);
      const externalComponent = join(
        fixture.root,
        `external-${component.toLowerCase()}`,
      );
      await rename(sourceComponent, externalComponent);
      await symlink(externalComponent, sourceComponent);

      await assert.rejects(
        assembleMacOSApp({
          binaryPath: fixture.binary,
          outputPath: fixture.output,
          sourceRoot,
        }),
        /must not contain symlink path components/,
      );
      await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
      const leftovers = (await readdir(fixture.root)).filter((entry) =>
        entry.startsWith(".Blabee.app.staging-"));
      assert.deepEqual(leftovers, []);
    });
  }
});

test("resource copies reject a file larger than the bounded descriptor snapshot", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-oversized-resource");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  const contracts = join(sourceRoot, "Contracts", "v1");
  const plugin = join(sourceRoot, "bridges", "codex", "plugin");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(contracts, { recursive: true });
  await mkdir(plugin, { recursive: true });
  await copyCanonicalPackagingSupport(sourceRoot);
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await writeFile(join(contracts, "manifest.json"), "{}\n");
  const oversized = join(plugin, "oversized-resource.bin");
  await writeFile(oversized, "");
  await truncate(oversized, (512 * 1024 * 1024) + 1);

  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      sourceRoot,
    }),
    /exceeds the 536870912-byte limit/,
  );
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("source preflight bounds total payload entries and cumulative bytes", async (t) => {
  async function makeBoundedSource(fixture, suffix) {
    const sourceRoot = join(fixture.root, suffix);
    const infoDirectory = join(sourceRoot, "Packaging", "macos");
    const contracts = join(sourceRoot, "Contracts", "v1");
    const plugin = join(sourceRoot, "bridges", "codex", "plugin");
    await mkdir(infoDirectory, { recursive: true });
    await mkdir(contracts, { recursive: true });
    await mkdir(plugin, { recursive: true });
    await copyCanonicalPackagingSupport(sourceRoot);
    await copyFile(
      join(repositoryRoot, "Packaging", "macos", "Info.plist"),
      join(infoDirectory, "Info.plist"),
    );
    await writeFile(join(contracts, "manifest.json"), "{}\n");
    return { sourceRoot, plugin };
  }

  const fileCountFixture = await makeWorkspace(t);
  const fileCountSource = await makeBoundedSource(
    fileCountFixture,
    "source-file-count-limit",
  );
  for (let index = 0; index < 1019; index += 1) {
    await writeFile(
      join(fileCountSource.plugin, `payload-${String(index).padStart(4, "0")}.txt`),
      "x",
    );
  }
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fileCountFixture.binary,
      outputPath: fileCountFixture.output,
      sourceRoot: fileCountSource.sourceRoot,
    }),
    /packaged payload exceeds the 1024-entry limit/,
  );
  await assert.rejects(lstat(fileCountFixture.output), { code: "ENOENT" });

  const directoryCountFixture = await makeWorkspace(t);
  const directoryCountSource = await makeBoundedSource(
    directoryCountFixture,
    "source-directory-count-limit",
  );
  for (let index = 0; index < 1025; index += 1) {
    await mkdir(
      join(
        directoryCountSource.plugin,
        `empty-${String(index).padStart(4, "0")}`,
      ),
    );
  }
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: directoryCountFixture.binary,
      outputPath: directoryCountFixture.output,
      sourceRoot: directoryCountSource.sourceRoot,
    }),
    /packaged payload exceeds the 1024-entry limit/,
  );
  await assert.rejects(lstat(directoryCountFixture.output), { code: "ENOENT" });

  const byteCountFixture = await makeWorkspace(t);
  const byteCountSource = await makeBoundedSource(
    byteCountFixture,
    "source-byte-count-limit",
  );
  for (const name of ["large-a.bin", "large-b.bin"]) {
    const path = join(byteCountSource.plugin, name);
    await writeFile(path, "");
    await truncate(path, 256 * 1024 * 1024);
  }
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: byteCountFixture.binary,
      outputPath: byteCountFixture.output,
      sourceRoot: byteCountSource.sourceRoot,
    }),
    /packaged payload exceeds the 536870912-byte cumulative limit/,
  );
  await assert.rejects(lstat(byteCountFixture.output), { code: "ENOENT" });
});

test("final payload entry budget reserves the assembly manifest", async (t) => {
  async function makeBoundarySource(fixture, suffix, emptyDirectoryCount) {
    const sourceRoot = join(fixture.root, suffix);
    const infoDirectory = join(sourceRoot, "Packaging", "macos");
    const contracts = join(sourceRoot, "Contracts", "v1");
    const plugin = join(sourceRoot, "bridges", "codex", "plugin");
    await mkdir(infoDirectory, { recursive: true });
    await mkdir(contracts, { recursive: true });
    await mkdir(plugin, { recursive: true });
    await copyCanonicalPackagingSupport(sourceRoot);
    await copyFile(
      join(repositoryRoot, "Packaging", "macos", "Info.plist"),
      join(infoDirectory, "Info.plist"),
    );
    await writeFile(join(contracts, "manifest.json"), "{}\n");
    for (let index = 0; index < emptyDirectoryCount; index += 1) {
      await mkdir(join(plugin, `empty-${String(index).padStart(4, "0")}`));
    }
    return sourceRoot;
  }

  const acceptedFixture = await makeWorkspace(t);
  const acceptedSource = await makeBoundarySource(
    acceptedFixture,
    "source-final-entry-boundary-accepted",
    1003,
  );
  await assembleMacOSApp({
    binaryPath: acceptedFixture.binary,
    outputPath: acceptedFixture.output,
    sourceRoot: acceptedSource,
  });
  assert.equal(await filesystemEntryCount(acceptedFixture.output), 1024);

  const rejectedFixture = await makeWorkspace(t);
  const rejectedSource = await makeBoundarySource(
    rejectedFixture,
    "source-final-entry-boundary-rejected",
    1004,
  );
  await assert.rejects(
    assembleMacOSApp({
      binaryPath: rejectedFixture.binary,
      outputPath: rejectedFixture.output,
      sourceRoot: rejectedSource,
    }),
    /packaged payload exceeds the 1024-entry limit at/,
  );
  await assert.rejects(lstat(rejectedFixture.output), { code: "ENOENT" });
  const leftovers = (await readdir(rejectedFixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("post-signing entry budget includes generated code-signature entries", {
  skip: process.platform !== "darwin" ? "codesign is available only on macOS" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-signed-entry-boundary");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  const contracts = join(sourceRoot, "Contracts", "v1");
  const plugin = join(sourceRoot, "bridges", "codex", "plugin");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(contracts, { recursive: true });
  await mkdir(plugin, { recursive: true });
  await copyCanonicalPackagingSupport(sourceRoot);
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await writeFile(join(contracts, "manifest.json"), "{}\n");
  for (let index = 0; index < 1003; index += 1) {
    await mkdir(join(plugin, `empty-${String(index).padStart(4, "0")}`));
  }

  await assert.rejects(
    assembleMacOSApp({
      binaryPath: fixture.binary,
      outputPath: fixture.output,
      sourceRoot,
      adhocSign: true,
    }),
    /packaged payload exceeds the 1024-entry limit at/,
  );
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-")
      || entry.includes(".cleanup-"));
  assert.deepEqual(leftovers, []);
});

test("failure cleanup preserves a staging path whose reserved identity changed", async (t) => {
  const fixture = await makeWorkspace(t);
  const previousApp = await makePreviousApp(
    fixture.root,
    "cleanup-previous",
    `sha256:${"7".repeat(64)}`,
  );
  const inspectorStarted = join(fixture.root, "cleanup-inspector-started");
  const releaseInspector = join(fixture.root, "cleanup-inspector-release");
  await writeFile(
    fixture.binary,
    [
      "#!/bin/sh",
      protocolQueryShell,
      `touch '${inspectorStarted}'`,
      `while [ ! -f '${releaseInspector}' ]; do /bin/sleep 0.01; done`,
      "printf 'not-json\\n'",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const assembly = assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    compatiblePreviousApps: [previousApp],
  });
  await waitForPath(inspectorStarted);
  const staging = await waitForStagingPath(fixture.root);
  const originalStaging = `${staging}.original`;
  await rename(staging, originalStaging);
  await mkdir(staging);
  const sentinel = join(staging, "must-not-be-deleted.txt");
  await writeFile(sentinel, "external replacement\n");
  await writeFile(releaseInspector, "release\n");

  await assert.rejects(
    assembly,
    /cleanup failed safely: cleanup refused because the staging reservation identity changed/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "external replacement\n");
  assert.equal((await lstat(originalStaging)).isDirectory(), true);
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
});

test("an ad-hoc signed app rejects a mutated bundled LaunchAgent", {
  skip: process.platform !== "darwin" ? "codesign is available only on macOS" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  await assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
    adhocSign: true,
  });
  await execFile(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", fixture.output],
  );
  const launchAgent = join(
    fixture.output,
    "Contents",
    "Library",
    "LaunchAgents",
    launchAgentFileName,
  );
  const original = await readFile(launchAgent, "utf8");
  await writeFile(launchAgent, original.replace("\t<true\/>\n<\/dict>", "\t<false/>\n<\/dict>"));
  await assert.rejects(execFile(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", fixture.output],
  ));
});

test("ad-hoc Mach-O app signing embeds only the Terminal automation entitlement", {
  skip: process.platform !== "darwin" ? "requires macOS codesign and clang" : false,
}, async (t) => {
  const fixture = await makeWorkspace(t);
  const source = join(fixture.root, "lease-probe.c");
  await writeFile(source, 'int main(void) { __builtin_printf("blabee.runtime-use-lease.v1\\n"); return 0; }\n');
  await execFile("/usr/bin/clang", [source, "-o", fixture.binary], { timeout: 30_000 });
  await assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output, adhocSign: true });
  const { stdout } = await execFile("/usr/bin/codesign", ["--display", "--entitlements", "-", "--xml", fixture.output]);
  const decoded = join(fixture.root, "signed-entitlements.plist");
  await writeFile(decoded, stdout);
  const { stdout: json } = await execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", decoded]);
  assert.deepEqual(JSON.parse(json), { "com.apple.security.automation.apple-events": true });
});

test("explicit Claude preview runtime is copied and indexed without changing assembly v2 schema", {
  skip: process.platform !== "darwin" ? "app assembly requires macOS plutil" : false,
}, async t => {
  const fixture = await makeWorkspace(t);
  const runtime = await makeClaudeRuntimeFixture(t);
  const result = await assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output,
    claudeRuntimeDirectory: runtime.outputDirectory });
  const copied = join(fixture.output, "Contents", "Resources", "claude");
  assert.deepEqual(await verifyClaudeRuntimeDirectory(copied), runtime.manifest);
  assert.equal(result.manifest.schema_version, "blabee.macos-app-assembly.v2");
  assert.deepEqual(Object.keys(result.manifest).sort(), ["bundle_identifier", "compatible_previous_runtimes", "files", "hash_phase", "schema_version"]);
  const nodeEntry = result.manifest.files.find(file => file.path === "Contents/Resources/claude/node/bin/node");
  assert.equal(nodeEntry.mode, "0755");
  assert.equal(nodeEntry.sha256, await digest(join(copied, "node/bin/node")));
  const claudeDescriptor = result.manifest.files.find(file => file.path === "Contents/Resources/claude/manifest.json");
  assert.equal(claudeDescriptor.sha256, await digest(join(copied, "manifest.json")));
  assert.ok(result.manifest.files.some(file => file.path === "Contents/Resources/Plugin/blabee/scripts/blabee-launcher"));
});

test("Developer ID assembly explicitly rejects unqualified Claude preview before publishing output", async t => {
  const fixture = await makeWorkspace(t);
  const runtime = await makeClaudeRuntimeFixture(t);
  await assert.rejects(assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output,
    claudeRuntimeDirectory: runtime.outputDirectory,
    releaseSigning: { identity: "Developer ID Application: Blabee Test (ABCDEFGHIJ)", teamID: "ABCDEFGHIJ" },
  }), /development-preview Claude runtime cannot be packaged in a Developer ID release/u);
  await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
});

const internalClaudeSigning = Object.freeze({ identity: "Developer ID Application: Blabee Test (ABCDEFGHIJ)", teamID: "ABCDEFGHIJ" });

async function internalClaudeAssemblyRunner(onSign) {
  const calls = [];
  const appleEvents = await readFile(canonicalEntitlements, "utf8");
  return { calls, async runner(command, args) {
    calls.push({ command, args });
    const target = args.at(-1);
    const node = target.endsWith("/node/bin/node");
    if (args.includes("--sign")) await onSign(target, node);
    if (args.includes("--display") && args.includes("--entitlements")) {
      return { stdout: node ? CLAUDE_NODE_ENTITLEMENTS : appleEvents, stderr: "" };
    }
    if (args.includes("--display")) {
      return { stdout: "", stderr: [
        `Identifier=${node ? "com.biadone.blabee.claude-node" : "com.biadone.blabee"}`,
        "CodeDirectory v=20500 flags=0x10000(runtime) hashes=1+7 location=embedded",
        `Authority=${internalClaudeSigning.identity}`, `TeamIdentifier=${internalClaudeSigning.teamID}`,
        "Timestamp=Sep 21, 2026 at 12:00:00 PM",
      ].join("\n") };
    }
    return { stdout: "", stderr: "" };
  } };
}

async function internalClaudeAssemblyFixture(t) {
  const fixture = await makeWorkspace(t);
  fixture.output = join(fixture.root, "Blabee.app");
  const runtime = await makeClaudeRuntimeFixture(t);
  const source = join(fixture.root, "preview-lease-probe.c");
  await writeFile(source, [
    '#include <stdio.h>', '#include <string.h>',
    'int main(int argc, char **argv) {',
    'if (argc == 2 && strcmp(argv[1], "distribution-profile") == 0) {',
    `puts(${JSON.stringify(JSON.stringify({ schema_version: "blabee.distribution-profile.v1", profile_id: "blabee",
      bundle_identifier: "com.biadone.blabee" }))}); return 0; }`,
    'puts("blabee.runtime-use-lease.v1"); return 0; }', '',
  ].join("\n"));
  await execFile("/usr/bin/clang", [source, "-o", fixture.binary], { timeout: 30_000 });
  return { ...fixture, runtime };
}

test("unified internal Claude assembly signs only staged Node before both manifests and enclosing app", {
  skip: process.platform !== "darwin" ? "requires macOS plutil and a tiny clang fixture" : false,
}, async t => {
  const fixture = await internalClaudeAssemblyFixture(t);
  const sourceNode = await readFile(join(fixture.runtime.outputDirectory, "node/bin/node"));
  const sourceDescriptor = await readFile(join(fixture.runtime.outputDirectory, "manifest.json"));
  const sourceBinary = await readFile(fixture.binary);
  const order = [];
  const captured = await internalClaudeAssemblyRunner(async (target, node) => {
    assert.notEqual(target, fixture.binary);
    assert.equal(target.startsWith(fixture.runtime.outputDirectory), false);
    order.push(node ? "node" : "app");
    if (node) {
      const resources = resolve(dirname(target), "../../..");
      await assert.rejects(lstat(join(resources, "assembly-manifest.json")), { code: "ENOENT" });
      await writeFile(target, Buffer.concat([await readFile(target), Buffer.from("signed-node-fixture")]));
    } else {
      const resources = join(target, "Contents", "Resources");
      const descriptor = await verifyClaudeRuntimeDirectory(join(resources, "claude"));
      assert.notEqual(descriptor.payload_digest, fixture.runtime.manifest.payload_digest);
      const assembly = JSON.parse(await readFile(join(resources, "assembly-manifest.json"), "utf8"));
      assert.equal(assembly.schema_version, "blabee.macos-app-assembly.v2");
      assert.equal(assembly.bundle_identifier, "com.biadone.blabee");
      assert.equal(assembly.files.find(file => file.path === "Contents/Resources/claude/node/bin/node").sha256,
        await digest(join(resources, "claude/node/bin/node")));
      assert.equal(assembly.files.find(file => file.path === "Contents/Resources/claude/manifest.json").sha256,
        await digest(join(resources, "claude/manifest.json")));
    }
  });
  const result = await assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output,
    claudeRuntimeDirectory: fixture.runtime.outputDirectory, bundleVersion: "1", internalClaudeSigning: internalClaudeSigning },
  { internalClaudeSigningRunner: captured.runner });
  assert.equal(result.signed, true);
  assert.equal(result.bundleVersion, "1");
  const { stdout: plistJSON } = await execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(result.output, "Contents/Info.plist")]);
  const plist = JSON.parse(plistJSON);
  assert.equal(plist.CFBundleIdentifier, "com.biadone.blabee");
  assert.equal(plist.CFBundleName, "Blabee");
  assert.equal(plist.CFBundleDisplayName, "Blabee");
  assert.equal(plist.CFBundleShortVersionString, "0.1.0");
  assert.equal(plist.CFBundleVersion, "1");
  assert.equal(plist.BlabeeDistributionProfile, "blabee");
  assert.equal(Object.hasOwn(plist, "BlabeeUpdateRepository"), true);
  assert.match(plist.NSAppleEventsUsageDescription, /Claude Code/u);
  assert.deepEqual(await readdir(join(result.output, "Contents/Library/LaunchAgents")), ["com.biadone.blabee.coordinator.plist"]);
  const { stdout: agentJSON } = await execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-",
    join(result.output, "Contents/Library/LaunchAgents/com.biadone.blabee.coordinator.plist")]);
  assert.equal(JSON.parse(agentJSON).Label, "com.biadone.blabee.coordinator");
  assert.deepEqual(order, ["node", "app"]);
  assert.equal(captured.calls.filter(call => call.args.includes("--sign")).some(call => call.args.includes("--deep")), false);
  assert.deepEqual(await readFile(join(fixture.runtime.outputDirectory, "node/bin/node")), sourceNode);
  assert.deepEqual(await readFile(join(fixture.runtime.outputDirectory, "manifest.json")), sourceDescriptor);
  assert.deepEqual(await readFile(fixture.binary), sourceBinary);
});

test("unified internal Claude signing failure publishes nothing and never changes input runtime or binary", {
  skip: process.platform !== "darwin" ? "requires macOS plutil and a tiny clang fixture" : false,
}, async t => {
  for (const failAt of ["node", "app"]) {
    await t.test(failAt, async subtest => {
      const fixture = await internalClaudeAssemblyFixture(subtest);
      const sourceNode = await readFile(join(fixture.runtime.outputDirectory, "node/bin/node"));
      const sourceDescriptor = await readFile(join(fixture.runtime.outputDirectory, "manifest.json"));
      const sourceBinary = await readFile(fixture.binary);
      const captured = await internalClaudeAssemblyRunner(async (target, node) => {
        if ((node ? "node" : "app") === failAt) throw new Error(`injected ${failAt} signing failure`);
        if (node) await writeFile(target, Buffer.concat([await readFile(target), Buffer.from("signed-node-fixture")]));
      });
      await assert.rejects(assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output,
        claudeRuntimeDirectory: fixture.runtime.outputDirectory, bundleVersion: "42", internalClaudeSigning: internalClaudeSigning },
      { internalClaudeSigningRunner: captured.runner }), /injected .* signing failure/u);
      await assert.rejects(lstat(fixture.output), { code: "ENOENT" });
      assert.equal((await readdir(fixture.root)).some(name => name.startsWith(".Blabee.app.staging-")), false);
      assert.deepEqual(await readFile(join(fixture.runtime.outputDirectory, "node/bin/node")), sourceNode);
      assert.deepEqual(await readFile(join(fixture.runtime.outputDirectory, "manifest.json")), sourceDescriptor);
      assert.deepEqual(await readFile(fixture.binary), sourceBinary);
    });
  }
});

test("unified internal Claude preserves a caller-owned existing output before any signer runs", async t => {
  const fixture = await makeWorkspace(t);
  fixture.output = join(fixture.root, "Blabee.app");
  const runtime = await makeClaudeRuntimeFixture(t);
  await mkdir(fixture.output);
  const sentinel = join(fixture.output, "caller-owned.txt");
  await writeFile(sentinel, "keep this output\n");
  let calls = 0;
  await assert.rejects(assembleMacOSApp({ binaryPath: fixture.binary, outputPath: fixture.output,
    claudeRuntimeDirectory: runtime.outputDirectory, bundleVersion: "42", internalClaudeSigning: internalClaudeSigning },
  { internalClaudeSigningRunner: async () => { calls++; throw new Error("must not sign"); } }), /output already exists/u);
  assert.equal(calls, 0);
  assert.equal(await readFile(sentinel, "utf8"), "keep this output\n");
});

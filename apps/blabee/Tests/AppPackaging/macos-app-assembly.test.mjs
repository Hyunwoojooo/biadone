import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assemblyScript = join(repositoryRoot, "scripts", "build-macos-app.mjs");
const execFile = promisify(execFileCallback);
const launchAgentFileName = "com.biadone.blabee.coordinator.plist";
const menuBarIconFileName = "BlabeeMenuBar.svg";
const codexMarketplaceFileName = "CodexMarketplace.json";
const canonicalLaunchAgent = join(
  repositoryRoot,
  "Packaging",
  "macos",
  "LaunchAgents",
  launchAgentFileName,
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
      'if [ "${1-}" = runtime-identity ] && [ "${2-}" = --app ]; then',
      `  identity='${defaultInspectedRuntimeIdentity}'`,
      '  if [ -f "$3/runtime-identity.txt" ]; then identity=$(/bin/cat "$3/runtime-identity.txt"); fi',
      `  printf '{"assembly_manifest_sha256":"${defaultInspectedManifestDigest}","runtime_identity":"%s","schema_version":"blabee.runtime-identity-inspection.v2"}\\n' "$identity"`,
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

async function copyCanonicalPackagingSupport(sourceRoot) {
  const directory = join(sourceRoot, "Packaging", "macos", "LaunchAgents");
  await mkdir(directory, { recursive: true });
  await copyFile(canonicalLaunchAgent, join(directory, launchAgentFileName));
  const resources = join(sourceRoot, "Packaging", "macos", "Resources");
  await mkdir(resources, { recursive: true });
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
  const menuBarIcon = join(contents, "Resources", menuBarIconFileName);
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
    menuBarIcon,
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
  assert.equal(await mode(menuBarIcon), 0o644);
  assert.equal(await mode(codexMarketplace), 0o644);
  assert.equal(await mode(contract), 0o644);
  assert.equal(await mode(plugin), 0o644);
  assert.equal(await mode(launcher), 0o755);

  const { stdout: plistJSON } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", infoPlist],
  );
  const plist = JSON.parse(plistJSON);
  assert.deepEqual(
    Object.fromEntries([
      "CFBundleDisplayName",
      "CFBundleExecutable",
      "CFBundleIdentifier",
      "CFBundleName",
      "CFBundlePackageType",
      "CFBundleShortVersionString",
      "CFBundleVersion",
      "LSMinimumSystemVersion",
      "LSUIElement",
      "NSHighResolutionCapable",
      "NSPrincipalClass",
    ].map((key) => [key, plist[key]])),
    {
      CFBundleDisplayName: "Blabee",
      CFBundleExecutable: "blabee-coordinator",
      CFBundleIdentifier: "com.biadone.blabee",
      CFBundleName: "Blabee",
      CFBundlePackageType: "APPL",
      CFBundleShortVersionString: "0.1.0",
      CFBundleVersion: "1",
      LSMinimumSystemVersion: "13.0",
      LSUIElement: true,
      NSHighResolutionCapable: true,
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
  assert.equal(await digest(menuBarIcon), await digest(canonicalMenuBarIcon));
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
  const sourcePlugin = join(repositoryRoot, "Plugin", "blabee");
  const bundledPlugin = join(contents, "Resources", "Plugin", "blabee");
  const pluginFiles = await assertTreeParity(sourcePlugin, bundledPlugin);
  const allBundleFiles = await regularFiles(fixture.output);
  const expectedBundleFiles = [
    "Contents/Info.plist",
    `Contents/Library/LaunchAgents/${launchAgentFileName}`,
    "Contents/MacOS/blabee-coordinator",
    "Contents/Resources/.agents/plugins/marketplace.json",
    `Contents/Resources/${menuBarIconFileName}`,
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
    "#!/bin/sh\nprintf '{\"runtime_identity\":\"not-verified\"}\\n'\n",
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
      `#!/bin/sh\nprintf '%s\\n' '${response}'\n`,
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
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
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
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
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
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
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
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
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
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
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
  const plugin = join(sourceRoot, "Plugin", "blabee");
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
  for (const component of ["Packaging", "Contracts", "Plugin"]) {
    await t.test(component, async (t) => {
      const fixture = await makeWorkspace(t);
      const sourceRoot = join(fixture.root, `source-${component.toLowerCase()}`);
      const infoDirectory = join(sourceRoot, "Packaging", "macos");
      const contracts = join(sourceRoot, "Contracts", "v1");
      const plugin = join(sourceRoot, "Plugin", "blabee");
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
  const plugin = join(sourceRoot, "Plugin", "blabee");
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
    const plugin = join(sourceRoot, "Plugin", "blabee");
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
    const plugin = join(sourceRoot, "Plugin", "blabee");
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
    1005,
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
    1006,
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
  const plugin = join(sourceRoot, "Plugin", "blabee");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(contracts, { recursive: true });
  await mkdir(plugin, { recursive: true });
  await copyCanonicalPackagingSupport(sourceRoot);
  await copyFile(
    join(repositoryRoot, "Packaging", "macos", "Info.plist"),
    join(infoDirectory, "Info.plist"),
  );
  await writeFile(join(contracts, "manifest.json"), "{}\n");
  for (let index = 0; index < 1005; index += 1) {
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

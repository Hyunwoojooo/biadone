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
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { assembleMacOSApp } from "../../scripts/build-macos-app.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const launchAgentFileName = "com.biadone.blabee.coordinator.plist";
const canonicalLaunchAgent = join(
  repositoryRoot,
  "Packaging",
  "macos",
  "LaunchAgents",
  launchAgentFileName,
);

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
  await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return { root, binary, output: join(root, "Blabee.app") };
}

async function copyCanonicalLaunchAgent(sourceRoot) {
  const directory = join(sourceRoot, "Packaging", "macos", "LaunchAgents");
  await mkdir(directory, { recursive: true });
  await copyFile(canonicalLaunchAgent, join(directory, launchAgentFileName));
}

test("assembler creates the required Blabee.app payload and deterministic manifest", async (t) => {
  const fixture = await makeWorkspace(t);
  const result = await assembleMacOSApp({
    binaryPath: fixture.binary,
    outputPath: fixture.output,
  });

  assert.equal(result.output, join(await realpath(fixture.root), "Blabee.app"));
  assert.equal(result.signed, false);
  const contents = join(fixture.output, "Contents");
  const executable = join(contents, "MacOS", "blabee-coordinator");
  const infoPlist = join(contents, "Info.plist");
  const launchAgent = join(contents, "Library", "LaunchAgents", launchAgentFileName);
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
  for (const path of [executable, infoPlist, launchAgent, contract, plugin, launcher]) {
    assert.equal((await lstat(path)).isFile(), true, path);
    assert.equal((await lstat(path)).isSymbolicLink(), false, path);
  }
  assert.equal(await readFile(executable, "utf8"), "#!/bin/sh\nexit 0\n");
  assert.equal(await mode(executable), 0o755);
  assert.equal(await mode(infoPlist), 0o644);
  assert.equal(await mode(join(contents, "Library")), 0o755);
  assert.equal(await mode(join(contents, "Library", "LaunchAgents")), 0o755);
  assert.equal(await mode(launchAgent), 0o644);
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
    "Contents/Resources/assembly-manifest.json",
    ...contractFiles.map((path) => `Contents/Resources/Contracts/v1/${path}`),
    ...pluginFiles.map((path) => `Contents/Resources/Plugin/blabee/${path}`),
  ].sort(compareNames);
  assert.deepEqual(allBundleFiles, expectedBundleFiles);

  const manifestPath = join(contents, "Resources", "assembly-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schema_version, "blabee.macos-app-assembly.v1");
  assert.equal(manifest.bundle_identifier, "com.biadone.blabee");
  assert.equal(
    manifest.hash_phase,
    "assembled_payload_before_optional_code_signing",
  );
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
    size: 17,
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

  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("assembler rejects Info.plist value type drift and cleans staging", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-info-drift");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
  await copyCanonicalLaunchAgent(sourceRoot);
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
  const leftovers = (await readdir(fixture.root)).filter((entry) =>
    entry.startsWith(".Blabee.app.staging-"));
  assert.deepEqual(leftovers, []);
});

test("assembler cleanup opt-out preserves its exact partial staging tree", async (t) => {
  const fixture = await makeWorkspace(t);
  const sourceRoot = join(fixture.root, "source-preserve-partial");
  const infoDirectory = join(sourceRoot, "Packaging", "macos");
  await mkdir(infoDirectory, { recursive: true });
  await mkdir(join(sourceRoot, "Contracts", "v1"), { recursive: true });
  await mkdir(join(sourceRoot, "Plugin", "blabee"), { recursive: true });
  await copyCanonicalLaunchAgent(sourceRoot);
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
  await copyCanonicalLaunchAgent(sourceRoot);
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

test("assembler rejects implicit destinations, unsafe output, existing output, and invalid binaries", async (t) => {
  const fixture = await makeWorkspace(t);
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
    "#!/bin/sh\nexit 0\n",
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
  await copyCanonicalLaunchAgent(sourceRoot);
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

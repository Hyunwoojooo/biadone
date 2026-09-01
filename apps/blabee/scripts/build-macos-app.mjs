#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = resolve(dirname(scriptPath), "..");
const bundleName = "Blabee.app";
const menuBarIconFileName = "BlabeeMenuBar.svg";
const launchAgentFileName = "com.biadone.blabee.coordinator.plist";
const launchAgentRelativePath = join(
  "Contents",
  "Library",
  "LaunchAgents",
  launchAgentFileName,
);
const launcherRelativePath = join(
  "Contents",
  "Resources",
  "Plugin",
  "blabee",
  "scripts",
  "blabee-launcher",
);
const requiredInfoPlistValues = Object.freeze({
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
});
const requiredLaunchAgentValues = Object.freeze({
  Label: "com.biadone.blabee.coordinator",
  BundleProgram: "Contents/MacOS/blabee-coordinator",
  ProgramArguments: ["Contents/MacOS/blabee-coordinator", "service"],
  RunAtLoad: true,
});
const runtimeIdentityInspectionSchemaVersion =
  "blabee.runtime-identity-inspection.v2";
const runtimeIdentityPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumCompatiblePreviousApps = 2;
const compatiblePreviousRequestTypes = Object.freeze([
  "emit_decision",
  "session_start",
  "stop",
  "user_prompt_submit",
]);

function isCanonicalSHA256(value) {
  return typeof value === "string"
    && value.length === 71
    && Buffer.byteLength(value, "utf8") === 71
    && runtimeIdentityPattern.test(value);
}

function fail(message) {
  throw new Error(message);
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    fail(`${label} must be an explicit absolute path`);
  }
  if (value.includes("\0")) {
    fail(`${label} contains an invalid null byte`);
  }
  return resolve(value);
}

function isWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function assertWithin(root, candidate, label) {
  if (!isWithin(root, candidate)) {
    fail(`${label} escapes the source root`);
  }
}

function compareNames(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function pathExistsWithoutFollowing(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function requireDirectory(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a real directory, not a symlink or special file`);
  }
}

async function requireRegularFile(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must be a regular file, not a symlink or special file`);
  }
}

async function requireExecutableFile(path, label) {
  await requireRegularFile(path, label);
  const metadata = await lstat(path);
  if ((metadata.mode & 0o111) === 0) {
    fail(`${label} must already be executable`);
  }
}

async function copyFileWithMode(source, destination, mode) {
  await requireRegularFile(source, source);
  await copyFile(source, destination);
  await chmod(destination, mode);
}

async function validateInfoPlist(path) {
  await execFile("/usr/bin/plutil", ["-lint", path], { maxBuffer: 1024 * 1024 });
  const { stdout } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path],
    { maxBuffer: 1024 * 1024 },
  );
  let values;
  try {
    values = JSON.parse(stdout);
  } catch {
    fail("Info.plist could not be decoded as a property list dictionary");
  }
  if (values === null || Array.isArray(values) || typeof values !== "object") {
    fail("Info.plist must contain a property list dictionary");
  }
  for (const [key, expected] of Object.entries(requiredInfoPlistValues)) {
    if (typeof values[key] !== typeof expected || values[key] !== expected) {
      fail(`Info.plist ${key} must be ${JSON.stringify(expected)} (${typeof expected})`);
    }
  }
}

async function validateLaunchAgentPlist(path) {
  await execFile("/usr/bin/plutil", ["-lint", path], { maxBuffer: 1024 * 1024 });
  const { stdout } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path],
    { maxBuffer: 1024 * 1024 },
  );
  let values;
  try {
    values = JSON.parse(stdout);
  } catch {
    fail("LaunchAgent plist could not be decoded as a property list dictionary");
  }
  if (values === null || Array.isArray(values) || typeof values !== "object") {
    fail("LaunchAgent plist must contain a property list dictionary");
  }
  const actualKeys = Object.keys(values).sort(compareNames);
  const expectedKeys = Object.keys(requiredLaunchAgentValues).sort(compareNames);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail("LaunchAgent plist must contain exactly Label, BundleProgram, ProgramArguments, and RunAtLoad");
  }
  for (const key of ["Label", "BundleProgram"]) {
    if (typeof values[key] !== "string" || values[key] !== requiredLaunchAgentValues[key]) {
      fail(`LaunchAgent plist ${key} must be ${JSON.stringify(requiredLaunchAgentValues[key])}`);
    }
  }
  if (
    !Array.isArray(values.ProgramArguments)
    || values.ProgramArguments.length !== requiredLaunchAgentValues.ProgramArguments.length
    || values.ProgramArguments.some((value, index) => (
      typeof value !== "string" || value !== requiredLaunchAgentValues.ProgramArguments[index]
    ))
  ) {
    fail(`LaunchAgent plist ProgramArguments must be ${JSON.stringify(requiredLaunchAgentValues.ProgramArguments)}`);
  }
  if (typeof values.RunAtLoad !== "boolean" || values.RunAtLoad !== true) {
    fail("LaunchAgent plist RunAtLoad must be true (boolean)");
  }
}

async function copyTreeStrict(sourceRoot, source, destination, destinationRelativeRoot) {
  assertWithin(sourceRoot, source, source);
  await requireDirectory(source, source);
  await mkdir(destination, { recursive: true, mode: 0o755 });
  await chmod(destination, 0o755);

  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    const destinationRelative = join(destinationRelativeRoot, entry.name);
    assertWithin(sourceRoot, sourceEntry, sourceEntry);

    const metadata = await lstat(sourceEntry);
    if (metadata.isSymbolicLink()) {
      fail(`resource input must not be a symlink: ${sourceEntry}`);
    }
    if (metadata.isDirectory()) {
      await copyTreeStrict(
        sourceRoot,
        sourceEntry,
        destinationEntry,
        destinationRelative,
      );
      continue;
    }
    if (!metadata.isFile()) {
      fail(`resource input must be a regular file or directory: ${sourceEntry}`);
    }
    const mode = destinationRelative === launcherRelativePath ? 0o755 : 0o644;
    await copyFile(sourceEntry, destinationEntry);
    await chmod(destinationEntry, mode);
  }
}

async function sha256(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

async function collectManifestFiles(bundleRoot, current = bundleRoot) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      fail(`assembled bundle unexpectedly contains a symlink: ${path}`);
    }
    if (metadata.isDirectory()) {
      files.push(...await collectManifestFiles(bundleRoot, path));
      continue;
    }
    if (!metadata.isFile()) {
      fail(`assembled bundle unexpectedly contains a special file: ${path}`);
    }
    const pathFromBundle = relative(bundleRoot, path).split(sep).join("/");
    if (pathFromBundle === "Contents/Resources/assembly-manifest.json") continue;
    files.push({
      path: pathFromBundle,
      sha256: await sha256(path),
      size: metadata.size,
      mode: (metadata.mode & 0o777).toString(8).padStart(4, "0"),
    });
  }
  return files.sort((left, right) => compareNames(left.path, right.path));
}

async function writeAssemblyManifest(bundleRoot, compatiblePreviousRuntimes) {
  const manifestPath = join(bundleRoot, "Contents", "Resources", "assembly-manifest.json");
  const manifest = {
    schema_version: "blabee.macos-app-assembly.v2",
    bundle_identifier: "com.biadone.blabee",
    hash_phase: "assembled_payload_before_optional_code_signing",
    compatible_previous_runtimes: compatiblePreviousRuntimes,
    files: await collectManifestFiles(bundleRoot),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await chmod(manifestPath, 0o644);
  return manifest;
}

function snapshotCompatiblePreviousApps(values) {
  if (!Array.isArray(values)) {
    fail("compatible previous apps must be an array");
  }
  const snapshot = Array.from(values);
  if (snapshot.length > maximumCompatiblePreviousApps) {
    fail(`at most ${maximumCompatiblePreviousApps} compatible previous apps are supported`);
  }
  return Object.freeze(snapshot);
}

export async function inspectSignedRuntimeIdentity({
  coordinatorBinaryPath,
  appPath,
} = {}) {
  const coordinator = requireAbsolutePath(
    coordinatorBinaryPath,
    "runtime identity inspector binary",
  );
  const requestedApp = requireAbsolutePath(appPath, "compatible previous app");
  if (basename(requestedApp) !== bundleName) {
    fail(`compatible previous app must end with ${bundleName}`);
  }
  await requireExecutableFile(coordinator, "runtime identity inspector binary");
  await requireDirectory(requestedApp, "compatible previous app");
  const canonicalApp = await realpath(requestedApp);
  if (basename(canonicalApp) !== bundleName) {
    fail(`compatible previous app must resolve to ${bundleName}`);
  }

  let result;
  try {
    result = await execFile(
      coordinator,
      ["runtime-identity", "--app", canonicalApp],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
      },
    );
  } catch (error) {
    fail(`compatible previous app identity inspection failed: ${error.message}`);
  }
  if (result.stderr !== "") {
    fail("compatible previous app identity inspection wrote unexpected stderr");
  }
  if (
    typeof result.stdout !== "string"
    || !result.stdout.endsWith("\n")
    || result.stdout.slice(0, -1).includes("\n")
  ) {
    fail("compatible previous app identity inspection returned invalid framing");
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout.slice(0, -1));
  } catch {
    fail("compatible previous app identity inspection returned invalid JSON");
  }
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    fail("compatible previous app identity inspection must return a JSON object");
  }
  const keys = Object.keys(payload).sort(compareNames);
  if (
    JSON.stringify(keys)
    !== JSON.stringify([
      "assembly_manifest_sha256",
      "runtime_identity",
      "schema_version",
    ])
  ) {
    fail("compatible previous app identity inspection returned unexpected keys");
  }
  if (payload.schema_version !== runtimeIdentityInspectionSchemaVersion) {
    fail("compatible previous app identity inspection returned an unsupported schema");
  }
  if (!isCanonicalSHA256(payload.runtime_identity)) {
    fail("compatible previous app identity inspection returned an invalid identity");
  }
  if (!isCanonicalSHA256(payload.assembly_manifest_sha256)) {
    fail("compatible previous app identity inspection returned an invalid manifest digest");
  }
  return {
    app: canonicalApp,
    runtimeIdentity: payload.runtime_identity,
    assemblyManifestSHA256: payload.assembly_manifest_sha256,
  };
}

async function resolveCompatiblePreviousRuntimes(coordinator, values) {
  const inspected = [];
  const seenApps = new Set();
  const seenIdentities = new Set();
  for (const value of values) {
    const result = await inspectSignedRuntimeIdentity({
      coordinatorBinaryPath: coordinator,
      appPath: value,
    });
    if (seenApps.has(result.app)) {
      fail(`compatible previous app was provided more than once: ${result.app}`);
    }
    seenApps.add(result.app);
    if (seenIdentities.has(result.runtimeIdentity)) {
      fail(`compatible previous apps resolved to a duplicate runtime identity: ${result.runtimeIdentity}`);
    }
    seenIdentities.add(result.runtimeIdentity);
    inspected.push(result);
  }
  inspected.sort((left, right) => compareNames(left.runtimeIdentity, right.runtimeIdentity));
  return {
    apps: inspected.map((entry) => entry.app),
    policies: inspected.map((entry) => ({
      runtime_identity: entry.runtimeIdentity,
      allowed_request_types: [...compatiblePreviousRequestTypes],
    })),
  };
}

async function adhocSignAndVerify(bundlePath) {
  if (process.platform !== "darwin") {
    fail("--adhoc-sign is supported only on macOS");
  }
  await execFile(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--options",
      "runtime",
      bundlePath,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  await execFile(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", bundlePath],
    { maxBuffer: 1024 * 1024 },
  );
}

export async function assembleMacOSApp({
  binaryPath,
  outputPath,
  sourceRoot = defaultSourceRoot,
  adhocSign = false,
  cleanupOnFailure = true,
  compatiblePreviousApps = [],
} = {}) {
  const compatiblePreviousAppsSnapshot = snapshotCompatiblePreviousApps(
    compatiblePreviousApps,
  );
  const binary = requireAbsolutePath(binaryPath, "--binary");
  const requestedOutput = requireAbsolutePath(outputPath, "--output");
  const requestedSourceRoot = requireAbsolutePath(sourceRoot, "source root");

  if (basename(requestedOutput) !== bundleName) {
    fail(`--output must end with ${bundleName}`);
  }
  const lowerOutput = requestedOutput.toLocaleLowerCase("en-US");
  if (lowerOutput === "/applications/blabee.app" || lowerOutput.startsWith("/applications/")) {
    fail("direct writes to /Applications are not supported by this assembler");
  }

  await requireExecutableFile(binary, "--binary");
  await requireDirectory(requestedSourceRoot, "source root");
  const canonicalSourceRoot = await realpath(requestedSourceRoot);
  const sourceInfoPlist = join(canonicalSourceRoot, "Packaging", "macos", "Info.plist");
  const sourceLaunchAgentDirectory = join(
    canonicalSourceRoot,
    "Packaging",
    "macos",
    "LaunchAgents",
  );
  const sourceLaunchAgent = join(sourceLaunchAgentDirectory, launchAgentFileName);
  const sourceMenuBarIcon = join(
    canonicalSourceRoot,
    "Packaging",
    "macos",
    "Resources",
    menuBarIconFileName,
  );
  const sourceContracts = join(canonicalSourceRoot, "Contracts", "v1");
  const sourcePlugin = join(canonicalSourceRoot, "Plugin", "blabee");
  assertWithin(canonicalSourceRoot, sourceInfoPlist, "Info.plist");
  assertWithin(canonicalSourceRoot, sourceLaunchAgent, "LaunchAgent plist");
  assertWithin(canonicalSourceRoot, sourceMenuBarIcon, "menu-bar icon");
  assertWithin(canonicalSourceRoot, sourceContracts, "Contracts/v1");
  assertWithin(canonicalSourceRoot, sourcePlugin, "Plugin/blabee");
  await requireRegularFile(sourceInfoPlist, "Info.plist");
  await requireDirectory(sourceLaunchAgentDirectory, "LaunchAgents");
  await requireRegularFile(sourceLaunchAgent, "LaunchAgent plist");
  await requireRegularFile(sourceMenuBarIcon, "menu-bar icon");
  await validateLaunchAgentPlist(sourceLaunchAgent);
  await requireDirectory(sourceContracts, "Contracts/v1");
  await requireDirectory(sourcePlugin, "Plugin/blabee");

  const requestedParent = dirname(requestedOutput);
  const canonicalParent = await realpath(requestedParent);
  await requireDirectory(canonicalParent, "--output parent");
  const output = join(canonicalParent, bundleName);
  const canonicalRepositoryRoot = await realpath(defaultSourceRoot);
  const canonicalSystemTempRoot = await realpath(tmpdir());
  const canonicalSlashTmpRoot = await realpath("/tmp");
  if (![canonicalRepositoryRoot, canonicalSystemTempRoot, canonicalSlashTmpRoot]
    .some((root) => isWithin(root, output))) {
    fail("--output must be inside the Blabee repository or a system temporary directory");
  }
  const lowerCanonicalOutput = output.toLocaleLowerCase("en-US");
  if (
    lowerCanonicalOutput === "/applications/blabee.app"
    || lowerCanonicalOutput.startsWith("/applications/")
  ) {
    fail("direct writes to /Applications are not supported by this assembler");
  }
  if (await pathExistsWithoutFollowing(output)) {
    fail(`output already exists: ${output}`);
  }

  const staging = join(
    canonicalParent,
    `.${bundleName}.staging-${process.pid}-${randomUUID()}`,
  );
  let stagingCreated = false;
  let outputReserved = false;
  try {
    await mkdir(staging, { mode: 0o700 });
    stagingCreated = true;
    const contents = join(staging, "Contents");
    const macOS = join(contents, "MacOS");
    const resources = join(contents, "Resources");
    const launchAgents = join(contents, "Library", "LaunchAgents");
    await mkdir(macOS, { recursive: true, mode: 0o755 });
    await mkdir(resources, { recursive: true, mode: 0o755 });
    await mkdir(launchAgents, { recursive: true, mode: 0o755 });
    await chmod(staging, 0o755);
    await chmod(contents, 0o755);
    await chmod(macOS, 0o755);
    await chmod(resources, 0o755);
    await chmod(join(contents, "Library"), 0o755);
    await chmod(launchAgents, 0o755);

    const stagedCoordinator = join(macOS, "blabee-coordinator");
    await copyFileWithMode(binary, stagedCoordinator, 0o755);
    const compatiblePrevious = await resolveCompatiblePreviousRuntimes(
      stagedCoordinator,
      compatiblePreviousAppsSnapshot,
    );

    await copyFileWithMode(
      sourceInfoPlist,
      join(contents, "Info.plist"),
      0o644,
    );
    await validateInfoPlist(join(contents, "Info.plist"));
    await copyFileWithMode(
      sourceLaunchAgent,
      join(staging, launchAgentRelativePath),
      0o644,
    );
    await validateLaunchAgentPlist(join(staging, launchAgentRelativePath));
    await copyFileWithMode(
      sourceMenuBarIcon,
      join(resources, menuBarIconFileName),
      0o644,
    );
    await copyTreeStrict(
      canonicalSourceRoot,
      sourceContracts,
      join(resources, "Contracts", "v1"),
      join("Contents", "Resources", "Contracts", "v1"),
    );
    await copyTreeStrict(
      canonicalSourceRoot,
      sourcePlugin,
      join(resources, "Plugin", "blabee"),
      join("Contents", "Resources", "Plugin", "blabee"),
    );
    const manifest = await writeAssemblyManifest(
      staging,
      compatiblePrevious.policies,
    );
    if (adhocSign) await adhocSignAndVerify(staging);

    try {
      await mkdir(output, { mode: 0o700 });
      outputReserved = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail(`output appeared during assembly: ${output}`);
      }
      throw error;
    }
    await rename(join(staging, "Contents"), join(output, "Contents"));
    await chmod(output, 0o755);
    await rmdir(staging);
    stagingCreated = false;
    outputReserved = false;
    return {
      output,
      signed: adhocSign,
      manifest,
      compatiblePreviousApps: compatiblePrevious.apps,
    };
  } catch (error) {
    if (cleanupOnFailure) {
      if (outputReserved) {
        await rm(output, { recursive: true, force: true });
      }
      if (stagingCreated) {
        await rm(staging, { recursive: true, force: true });
      }
    }
    throw error;
  }
}

function parseCLIArguments(values) {
  let binaryPath;
  let outputPath;
  const compatiblePreviousApps = [];
  let adhocSign = false;
  let help = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--adhoc-sign") {
      if (adhocSign) fail("--adhoc-sign may be provided only once");
      adhocSign = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      help = true;
      continue;
    }
    if (
      value !== "--binary"
      && value !== "--output"
      && value !== "--compatible-previous-app"
    ) {
      fail(`unsupported argument: ${value}`);
    }
    if (index + 1 >= values.length || values[index + 1].startsWith("--")) {
      fail(`${value} requires a value`);
    }
    const argument = values[index + 1];
    index += 1;
    if (value === "--binary") {
      if (binaryPath !== undefined) fail("--binary may be provided only once");
      binaryPath = argument;
    } else if (value === "--output") {
      if (outputPath !== undefined) fail("--output may be provided only once");
      outputPath = argument;
    } else {
      compatiblePreviousApps.push(argument);
      if (compatiblePreviousApps.length > maximumCompatiblePreviousApps) {
        fail(`--compatible-previous-app may be provided at most ${maximumCompatiblePreviousApps} times`);
      }
    }
  }
  return {
    binaryPath,
    outputPath,
    adhocSign,
    help,
    compatiblePreviousApps,
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-macos-app.mjs --binary /absolute/path/to/blabee-coordinator --output /absolute/path/to/Blabee.app [--compatible-previous-app /absolute/path/to/Blabee.app] [--adhoc-sign]",
    "",
    "--compatible-previous-app may be repeated at most twice; raw runtime identity values are not accepted.",
    "The output parent must already exist. The script never writes to /Applications.",
  ].join("\n");
}

async function main() {
  const options = parseCLIArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await assembleMacOSApp(options);
  process.stdout.write(`${JSON.stringify({ output: result.output, signed: result.signed })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`blabee app assembly failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

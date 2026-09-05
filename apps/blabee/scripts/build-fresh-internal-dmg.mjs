#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
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
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildInternalDMG,
  preflightInternalDMGOutput,
} from "./build-internal-dmg.mjs";
import {
  requireInternalBuildNumber,
  requireInternalDMGOutputBuildSuffix,
} from "./internal-build-number.mjs";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = resolve(dirname(scriptPath), "..");
const defaultFallbackDeveloperDirectory = "/Applications/Xcode.app/Contents/Developer";
const coordinatorProductName = "blabee-coordinator";
const requiredCoordinatorArchitecture = "arm64";
const maximumCompatiblePreviousApps = 2;
const maximumCoordinatorBytes = 512 * 1024 * 1024;
const maximumReleaseInputBytes = 512 * 1024 * 1024;
const maximumReleaseInputEntries = 1024;
const maximumReleaseInputFileBytes = 512 * 1024 * 1024;
const fingerprintBufferBytes = 64 * 1024;

function fail(message) {
  throw new Error(message);
}

function requireDarwin(platform = process.platform) {
  if (platform !== "darwin") {
    fail("fresh internal DMG builds are supported only on macOS");
  }
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    fail(`${label} must be an explicit absolute path`);
  }
  if (value.includes("\0")) fail(`${label} contains an invalid null byte`);
  return resolve(value);
}

function isWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === ""
    || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

async function requireDirectory(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a real directory, not a symlink or special file`);
  }
}

async function requireExecutableFile(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must be a regular file, not a symlink or special file`);
  }
  if ((metadata.mode & 0o111) === 0) fail(`${label} must be executable`);
  return metadata;
}

async function captureFreshWorkRoot(path, sourceRoot, {
  lstatImpl = lstat,
  realpathImpl = realpath,
} = {}) {
  const requested = requireAbsolutePath(path, "fresh build work root");
  const metadata = await lstatImpl(requested, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail("fresh build work root must be a real directory");
  }
  if ((metadata.mode & 0o077n) !== 0n) {
    fail("fresh build work root must be private to the current user");
  }
  if (typeof process.getuid === "function" && metadata.uid !== BigInt(process.getuid())) {
    fail("fresh build work root must be owned by the current user");
  }
  const canonical = await realpathImpl(requested);
  const canonicalSource = await realpathImpl(sourceRoot);
  const canonicalSystemTemp = await realpathImpl(tmpdir());
  const canonicalSlashTmp = await realpathImpl("/tmp");
  const metadataAfterResolution = await lstatImpl(requested, { bigint: true });
  if (
    metadataAfterResolution.isSymbolicLink()
    || !metadataAfterResolution.isDirectory()
    || !matchesFreshWorkRoot(metadataAfterResolution, metadata)
    || metadataAfterResolution.mode !== metadata.mode
    || metadataAfterResolution.uid !== metadata.uid
  ) {
    fail("fresh build work root identity changed while it was being inspected");
  }
  if (isWithin(canonicalSource, canonical)) {
    fail("fresh build work root must be outside the source repository");
  }
  if (![canonicalSystemTemp, canonicalSlashTmp].some((root) => isWithin(root, canonical))) {
    fail("fresh build work root must be inside a system temporary directory");
  }
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    realpath: canonical,
  });
}

function matchesFreshWorkRoot(metadata, expected) {
  return metadata.dev === expected.dev && metadata.ino === expected.ino;
}

async function removeFreshWorkRoot(path, expected) {
  const metadata = await lstat(path, { bigint: true });
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || !matchesFreshWorkRoot(metadata, expected)
    || await realpath(path) !== expected.realpath
  ) {
    fail(`fresh build work root identity changed; refusing recursive cleanup: ${path}`);
  }
  const quarantine = join(
    dirname(path),
    `.${basename(path)}.cleanup-${process.pid}-${randomUUID()}`,
  );
  await rename(path, quarantine);
  const quarantined = await lstat(quarantine, { bigint: true });
  if (
    quarantined.isSymbolicLink()
    || !quarantined.isDirectory()
    || !matchesFreshWorkRoot(quarantined, expected)
  ) {
    fail(`quarantined fresh build work root identity changed: ${quarantine}`);
  }
  await rm(quarantine, { recursive: true, force: false });
}

function looksLikeFullXcodeDeveloperDirectory(path) {
  const contents = dirname(path);
  const app = dirname(contents);
  return basename(contents) === "Contents" && basename(app).endsWith(".app");
}

function oneLinePath(stdout, label) {
  const lines = String(stdout).trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1 || !isAbsolute(lines[0])) {
    fail(`${label} did not return one absolute path`);
  }
  return resolve(lines[0]);
}

function pinnedToolchainEnvironment(
  baseEnvironment,
  developerDirectory,
  sdk = null,
) {
  const environment = { ...baseEnvironment };
  for (const name of [
    "SDKROOT",
    "SWIFT_EXEC",
    "SWIFT_DRIVER_SWIFT_EXEC",
    "TOOLCHAINS",
  ]) {
    delete environment[name];
  }
  environment.DEVELOPER_DIR = developerDirectory;
  if (sdk !== null) environment.SDKROOT = sdk;
  return environment;
}

async function inspectFullXcodeDeveloperDirectory(candidate, {
  runner = execFile,
  baseEnvironment = process.env,
} = {}) {
  const requested = requireAbsolutePath(candidate, "Xcode developer directory");
  if (!looksLikeFullXcodeDeveloperDirectory(requested)) {
    fail("Command Line Tools alone are not a full Xcode toolchain");
  }
  await requireDirectory(requested, "Xcode developer directory");
  const developerDirectory = await realpath(requested);
  if (!looksLikeFullXcodeDeveloperDirectory(developerDirectory)) {
    fail("Xcode developer directory must resolve inside an Xcode .app bundle");
  }
  const xcodebuild = join(developerDirectory, "usr", "bin", "xcodebuild");
  await requireExecutableFile(xcodebuild, "Xcode xcodebuild");
  const environment = pinnedToolchainEnvironment(
    baseEnvironment,
    developerDirectory,
  );
  const options = {
    env: environment,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  };

  await runner("/usr/bin/xcrun", ["xcodebuild", "-version"], options);
  const swiftResult = await runner("/usr/bin/xcrun", ["--find", "swift"], options);
  const sdkResult = await runner(
    "/usr/bin/xcrun",
    ["--sdk", "macosx", "--show-sdk-path"],
    options,
  );
  const targetResult = await runner(
    "/usr/bin/xcrun",
    ["--sdk", "macosx", "swift", "-print-target-info"],
    options,
  );

  const swift = await realpath(oneLinePath(swiftResult.stdout, "xcrun --find swift"));
  const sdk = await realpath(oneLinePath(sdkResult.stdout, "xcrun --show-sdk-path"));
  if (!isWithin(developerDirectory, swift) || !isWithin(developerDirectory, sdk)) {
    fail("Xcode selected Swift and macOS SDK from different developer directories");
  }
  await requireExecutableFile(swift, "Xcode Swift compiler");
  await requireDirectory(sdk, "Xcode macOS SDK");

  let targetInfo;
  try {
    targetInfo = JSON.parse(targetResult.stdout);
  } catch {
    fail("Xcode Swift target information is not valid JSON");
  }
  const targetTriple = targetInfo?.target?.triple;
  if (typeof targetTriple !== "string" || !targetTriple.includes("-apple-macos")) {
    fail("Xcode Swift compiler did not report a macOS target");
  }
  const pinnedEnvironment = pinnedToolchainEnvironment(
    baseEnvironment,
    developerDirectory,
    sdk,
  );
  return Object.freeze({
    developerDirectory,
    swift,
    sdk,
    targetTriple,
    environment: pinnedEnvironment,
  });
}

export async function selectFullXcodeToolchain({
  platform = process.platform,
  environment = process.env,
  fallbackDeveloperDirectory = defaultFallbackDeveloperDirectory,
  runner = execFile,
} = {}) {
  requireDarwin(platform);
  const candidates = [];
  if (typeof environment.DEVELOPER_DIR === "string" && environment.DEVELOPER_DIR.length > 0) {
    candidates.push(environment.DEVELOPER_DIR);
  }
  try {
    const active = await runner(
      "/usr/bin/xcode-select",
      ["-p"],
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10_000 },
    );
    candidates.push(oneLinePath(active.stdout, "xcode-select -p"));
  } catch (error) {
    candidates.push(null);
  }
  candidates.push(fallbackDeveloperDirectory);

  const failures = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (candidate === null) {
      failures.push("xcode-select -p failed");
      continue;
    }
    let normalized;
    try {
      normalized = requireAbsolutePath(candidate, "Xcode developer directory");
    } catch (error) {
      failures.push(`${String(candidate)}: ${error.message}`);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    try {
      return await inspectFullXcodeDeveloperDirectory(normalized, {
        runner,
        baseEnvironment: environment,
      });
    } catch (error) {
      failures.push(`${normalized}: ${error.message}`);
    }
  }

  fail([
    "no usable full Xcode toolchain was found",
    "Install or open Xcode.app, then retry. Command Line Tools alone are not used for Blabee release builds.",
    `Checked: ${failures.join("; ")}`,
  ].join(". "));
}

function sameStableFileMetadata(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function stableReadOnlyFlags() {
  const noFollow = Number.isInteger(fileSystemConstants.O_NOFOLLOW)
    ? fileSystemConstants.O_NOFOLLOW
    : 0;
  const nonBlocking = Number.isInteger(fileSystemConstants.O_NONBLOCK)
    ? fileSystemConstants.O_NONBLOCK
    : 0;
  return fileSystemConstants.O_RDONLY | noFollow | nonBlocking;
}

async function hashStableRegularFile(
  path,
  label,
  hash,
  budget,
  { afterLstat = null, afterReadChunk = null } = {},
) {
  const pathBefore = await lstat(path);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    fail(`${label} must be a regular file, not a symlink or special file`);
  }
  if (pathBefore.size > maximumReleaseInputFileBytes) {
    fail(`${label} exceeds the ${maximumReleaseInputFileBytes}-byte file limit`);
  }
  if (budget.entries + 1 > maximumReleaseInputEntries) {
    fail(`release inputs exceed the ${maximumReleaseInputEntries}-file limit`);
  }
  if (budget.bytes + pathBefore.size > maximumReleaseInputBytes) {
    fail(`release inputs exceed the ${maximumReleaseInputBytes}-byte limit`);
  }
  if (afterLstat !== null) await afterLstat();
  const handle = await open(path, stableReadOnlyFlags());
  try {
    const openedBefore = await handle.stat();
    if (!sameStableFileMetadata(pathBefore, openedBefore)) {
      fail(`${label} changed while it was being opened`);
    }
    const buffer = Buffer.allocUnsafe(fingerprintBufferBytes);
    let position = 0;
    let chunkIndex = 0;
    while (position < openedBefore.size) {
      const requestedBytes = Math.min(buffer.length, openedBefore.size - position);
      const { bytesRead } = await handle.read(buffer, 0, requestedBytes, position);
      if (bytesRead === 0) fail(`${label} ended before its initial size was read`);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      if (afterReadChunk !== null) {
        await afterReadChunk({ bytesRead, chunkIndex, position });
      }
      chunkIndex += 1;
    }
    const appendProbe = Buffer.allocUnsafe(1);
    const { bytesRead: appendedBytes } = await handle.read(
      appendProbe,
      0,
      1,
      openedBefore.size,
    );
    if (appendedBytes !== 0) {
      fail(`${label} grew beyond its initial size while it was being read`);
    }
    const openedAfter = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      !sameStableFileMetadata(openedBefore, openedAfter)
      || !sameStableFileMetadata(openedAfter, pathAfter)
      || position !== openedBefore.size
    ) {
      fail(`${label} changed while it was being read`);
    }
    budget.entries += 1;
    budget.bytes += position;
    return position;
  } finally {
    await handle.close();
  }
}

async function stableRegularFileContainsMarker(
  path,
  metadata,
  label,
  marker,
  { afterReadChunk = null } = {},
) {
  const handle = await open(path, stableReadOnlyFlags());
  try {
    const openedBefore = await handle.stat();
    if (!sameStableFileMetadata(metadata, openedBefore)) {
      fail(`${label} changed while it was being opened for inspection`);
    }
    const buffer = Buffer.allocUnsafe(fingerprintBufferBytes);
    let carry = Buffer.alloc(0);
    let position = 0;
    let chunkIndex = 0;
    let found = false;
    while (position < openedBefore.size) {
      const requestedBytes = Math.min(buffer.length, openedBefore.size - position);
      const { bytesRead } = await handle.read(buffer, 0, requestedBytes, position);
      if (bytesRead === 0) fail(`${label} ended before its initial size was inspected`);
      position += bytesRead;
      const bytes = carry.length === 0
        ? buffer.subarray(0, bytesRead)
        : Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      if (bytes.includes(marker)) found = true;
      const carryLength = Math.min(marker.length - 1, bytes.length);
      carry = carryLength === 0
        ? Buffer.alloc(0)
        : Buffer.from(bytes.subarray(bytes.length - carryLength));
      if (afterReadChunk !== null) {
        await afterReadChunk({ bytesRead, chunkIndex, position });
      }
      chunkIndex += 1;
    }
    const appendProbe = Buffer.allocUnsafe(1);
    const { bytesRead: appendedBytes } = await handle.read(
      appendProbe,
      0,
      1,
      openedBefore.size,
    );
    if (appendedBytes !== 0) {
      fail(`${label} grew beyond its initial size while it was being inspected`);
    }
    const openedAfter = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      !sameStableFileMetadata(openedBefore, openedAfter)
      || !sameStableFileMetadata(openedAfter, pathAfter)
      || position !== openedBefore.size
    ) {
      fail(`${label} changed while it was being inspected`);
    }
    return found;
  } finally {
    await handle.close();
  }
}

async function collectTreeInputFiles(
  root,
  relativeDirectory = "",
  excludedRootEntries = new Set(),
  label = "input tree",
  traversal = { traversalEntries: 0 },
) {
  const directory = relativeDirectory === "" ? root : join(root, relativeDirectory);
  await requireDirectory(directory, `${label} ${relativeDirectory || "."}`);
  const entries = [];
  const stream = await opendir(directory);
  for await (const entry of stream) {
    if (relativeDirectory === "" && excludedRootEntries.has(entry.name)) {
      continue;
    }
    traversal.traversalEntries = (traversal.traversalEntries ?? 0) + 1;
    if (traversal.traversalEntries > maximumReleaseInputEntries) {
      fail(`${label} exceeds the ${maximumReleaseInputEntries}-entry traversal limit`);
    }
    entries.push(entry);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory === ""
      ? entry.name
      : join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`${label} must not contain a symlink: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collectTreeInputFiles(
        root,
        relativePath,
        excludedRootEntries,
        label,
        traversal,
      ));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      fail(`${label} must contain only regular files or directories: ${relativePath}`);
    }
  }
  return files;
}

async function fingerprintTree(
  root,
  label,
  excludedRootEntries = new Set(),
  budget = { bytes: 0, entries: 0 },
) {
  const requestedRoot = requireAbsolutePath(root, label);
  await requireDirectory(requestedRoot, label);
  const canonicalRoot = await realpath(requestedRoot);
  const files = await collectTreeInputFiles(
    canonicalRoot,
    "",
    excludedRootEntries,
    label,
    budget,
  );
  const hash = createHash("sha256");
  for (const relativePath of files) {
    const normalizedPath = relativePath.split(sep).join("/");
    hash.update(Buffer.from(`${Buffer.byteLength(normalizedPath, "utf8")}:`, "utf8"));
    hash.update(Buffer.from(normalizedPath, "utf8"));
    const sizeHash = createHash("sha256");
    const bytes = await hashStableRegularFile(
      join(canonicalRoot, relativePath),
      `${label} ${relativePath}`,
      sizeHash,
      budget,
    );
    hash.update(Buffer.from(`:${bytes}:`, "utf8"));
    hash.update(sizeHash.digest());
  }
  return Object.freeze({ sha256: hash.digest("hex"), files: files.length });
}

export async function fingerprintSwiftPackageInputs(packageRoot) {
  const fingerprint = await fingerprintTree(
    packageRoot,
    "Swift package root",
    new Set([".build", ".swiftpm", "docs", ".gitignore", "README.md"]),
  );
  const packageManifest = join(requireAbsolutePath(packageRoot, "Swift package root"), "Package.swift");
  const manifestMetadata = await lstat(packageManifest);
  if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile()) {
    fail("Swift package root is missing a regular Package.swift");
  }
  return fingerprint;
}

function releaseInputSpecifications(sourceRoot) {
  return [
    {
      label: "Swift package",
      relativePath: join("src", "coordinator-swift"),
      path: join(sourceRoot, "src", "coordinator-swift"),
      excluded: new Set([".build", ".swiftpm", "docs", ".gitignore", "README.md"]),
    },
    {
      label: "Contracts/v1",
      relativePath: join("Contracts", "v1"),
      path: join(sourceRoot, "Contracts", "v1"),
      excluded: new Set(),
    },
    {
      label: "Plugin/blabee",
      relativePath: join("Plugin", "blabee"),
      path: join(sourceRoot, "Plugin", "blabee"),
      excluded: new Set(),
    },
    {
      label: "Packaging/macos",
      relativePath: join("Packaging", "macos"),
      path: join(sourceRoot, "Packaging", "macos"),
      excluded: new Set(),
    },
  ];
}

export async function fingerprintReleaseInputs(sourceRoot) {
  const requestedSource = requireAbsolutePath(sourceRoot, "source root");
  await requireDirectory(requestedSource, "source root");
  const canonicalSource = await realpath(requestedSource);
  const inputs = releaseInputSpecifications(canonicalSource);
  const hash = createHash("sha256");
  let files = 0;
  const budget = { bytes: 0, entries: 0 };
  for (const input of inputs) {
    const fingerprint = await fingerprintTree(
      input.path,
      input.label,
      input.excluded ?? new Set(),
      budget,
    );
    hash.update(Buffer.from(`${input.label}:${fingerprint.files}:${fingerprint.sha256}\n`, "utf8"));
    files += fingerprint.files;
  }
  return Object.freeze({ sha256: hash.digest("hex"), files });
}

async function copyStableRegularFile(
  source,
  destination,
  label,
  budget,
  { afterLstat = null, afterSnapshotChunk = null } = {},
) {
  const pathBefore = await lstat(source);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    fail(`${label} must be a regular file, not a symlink or special file`);
  }
  if (pathBefore.size > maximumReleaseInputFileBytes) {
    fail(`${label} exceeds the ${maximumReleaseInputFileBytes}-byte file limit`);
  }
  if (budget.entries + 1 > maximumReleaseInputEntries) {
    fail(`release snapshot exceeds the ${maximumReleaseInputEntries}-file limit`);
  }
  if (budget.bytes + pathBefore.size > maximumReleaseInputBytes) {
    fail(`release snapshot exceeds the ${maximumReleaseInputBytes}-byte limit`);
  }

  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if (afterLstat !== null) await afterLstat();
  const sourceHandle = await open(source, stableReadOnlyFlags());
  let destinationHandle;
  let destinationIdentity;
  let operationError = null;
  try {
    const openedBefore = await sourceHandle.stat();
    if (!sameStableFileMetadata(pathBefore, openedBefore)) {
      fail(`${label} changed while it was being opened for snapshotting`);
    }
    destinationHandle = await open(
      destination,
      fileSystemConstants.O_WRONLY
        | fileSystemConstants.O_CREAT
        | fileSystemConstants.O_EXCL,
      pathBefore.mode & 0o777,
    );
    destinationIdentity = await destinationHandle.stat();
    const buffer = Buffer.allocUnsafe(fingerprintBufferBytes);
    let sourcePosition = 0;
    let destinationPosition = 0;
    let chunkIndex = 0;
    while (sourcePosition < openedBefore.size) {
      const requestedBytes = Math.min(
        buffer.length,
        openedBefore.size - sourcePosition,
      );
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        requestedBytes,
        sourcePosition,
      );
      if (bytesRead === 0) fail(`${label} ended before its initial size was snapshotted`);
      sourcePosition += bytesRead;
      let writtenFromBuffer = 0;
      while (writtenFromBuffer < bytesRead) {
        const { bytesWritten } = await destinationHandle.write(
          buffer,
          writtenFromBuffer,
          bytesRead - writtenFromBuffer,
          destinationPosition,
        );
        if (bytesWritten <= 0) fail(`${label} snapshot write made no progress`);
        writtenFromBuffer += bytesWritten;
        destinationPosition += bytesWritten;
      }
      if (afterSnapshotChunk !== null) {
        await afterSnapshotChunk({ bytesRead, chunkIndex, position: sourcePosition });
      }
      chunkIndex += 1;
    }
    const appendProbe = Buffer.allocUnsafe(1);
    const { bytesRead: appendedBytes } = await sourceHandle.read(
      appendProbe,
      0,
      1,
      openedBefore.size,
    );
    if (appendedBytes !== 0) {
      fail(`${label} grew beyond its initial size while it was being snapshotted`);
    }
    await destinationHandle.chmod(pathBefore.mode & 0o777);
    const openedAfter = await sourceHandle.stat();
    const pathAfter = await lstat(source);
    if (
      !sameStableFileMetadata(openedBefore, openedAfter)
      || !sameStableFileMetadata(openedAfter, pathAfter)
      || sourcePosition !== openedBefore.size
      || destinationPosition !== openedBefore.size
    ) {
      fail(`${label} changed while it was being snapshotted`);
    }
    budget.entries += 1;
    budget.bytes += sourcePosition;
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  for (const handle of [destinationHandle, sourceHandle]) {
    if (handle === undefined) continue;
    try {
      await handle.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (operationError !== null && destinationIdentity !== undefined) {
    try {
      const destinationAfter = await lstat(destination);
      if (
        destinationAfter.isSymbolicLink()
        || !destinationAfter.isFile()
        || destinationAfter.dev !== destinationIdentity.dev
        || destinationAfter.ino !== destinationIdentity.ino
      ) {
        fail(`${label} partial snapshot identity changed; refusing cleanup`);
      }
      await rm(destination, { force: false });
    } catch (error) {
      if (error?.code !== "ENOENT") cleanupErrors.push(error);
    }
  }
  if (operationError !== null) {
    if (cleanupErrors.length === 0) throw operationError;
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      `${operationError.message}; partial snapshot cleanup failed: ${cleanupErrors.map((error) => error.message).join("; ")}`,
      { cause: operationError },
    );
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `${label} snapshot handle cleanup failed`);
  }
}

export async function snapshotReleaseInputs(sourceRoot, snapshotRoot) {
  const requestedSource = requireAbsolutePath(sourceRoot, "source root");
  const requestedSnapshot = requireAbsolutePath(snapshotRoot, "release source snapshot");
  await requireDirectory(requestedSource, "source root");
  const canonicalSource = await realpath(requestedSource);
  await mkdir(requestedSnapshot, { mode: 0o700 });
  const canonicalSnapshot = await realpath(requestedSnapshot);
  if (isWithin(canonicalSource, canonicalSnapshot)) {
    fail("release source snapshot must be outside the live source repository");
  }

  const budget = { bytes: 0, entries: 0, traversalEntries: 0 };
  for (const input of releaseInputSpecifications(canonicalSource)) {
    const files = await collectTreeInputFiles(
      input.path,
      "",
      input.excluded,
      input.label,
      budget,
    );
    const destinationRoot = join(canonicalSnapshot, input.relativePath);
    await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
    for (const relativePath of files) {
      await copyStableRegularFile(
        join(input.path, relativePath),
        join(destinationRoot, relativePath),
        `${input.label} ${relativePath}`,
        budget,
      );
    }
  }
  return canonicalSnapshot;
}

export function makeSwiftReleaseBuildArguments({
  sourceRoot,
  packageRoot,
  scratchPath,
  showBinPath = false,
}) {
  const argumentsList = [
    "--sdk",
    "macosx",
    "swift",
    "build",
    "--package-path",
    packageRoot,
    "--scratch-path",
    scratchPath,
    "--configuration",
    "release",
    "--arch",
    requiredCoordinatorArchitecture,
    "--disable-sandbox",
  ];
  if (showBinPath) {
    argumentsList.push("--show-bin-path");
  } else {
    argumentsList.push(
      "--product",
      coordinatorProductName,
      "-debug-info-format",
      "none",
      "-Xswiftc",
      "-file-prefix-map",
      "-Xswiftc",
      `${sourceRoot}=/blabee`,
    );
  }
  return argumentsList;
}

async function requireFreshCoordinatorArchitecture(binaryPath, runner = execFile) {
  const { stdout, stderr } = await runner(
    "/usr/bin/lipo",
    ["-archs", binaryPath],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 },
  );
  if (stderr !== "") fail("fresh coordinator architecture inspection wrote unexpected stderr");
  const architectures = String(stdout).trim().split(/\s+/u).filter(Boolean);
  if (
    architectures.length !== 1
    || architectures[0] !== requiredCoordinatorArchitecture
  ) {
    fail(`fresh coordinator must contain exactly the ${requiredCoordinatorArchitecture} architecture`);
  }
  return requiredCoordinatorArchitecture;
}

export async function buildFreshCoordinator({
  sourceRoot,
  packageRoot,
  workRoot,
  toolchain,
  runner = execFile,
} = {}) {
  const source = requireAbsolutePath(sourceRoot, "source root");
  const packagePath = requireAbsolutePath(packageRoot, "Swift package root");
  const work = requireAbsolutePath(workRoot, "fresh build work root");
  await requireDirectory(work, "fresh build work root");
  const scratchPath = join(work, "swift-build");
  const moduleCache = join(work, "module-cache");
  await mkdir(moduleCache, { mode: 0o700 });
  const environment = {
    ...pinnedToolchainEnvironment(
      toolchain.environment ?? process.env,
      toolchain.developerDirectory,
      toolchain.sdk ?? null,
    ),
    CLANG_MODULE_CACHE_PATH: moduleCache,
    SWIFTPM_MODULECACHE_OVERRIDE: moduleCache,
  };
  const executionOptions = {
    env: environment,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600_000,
  };
  await runner(
    "/usr/bin/xcrun",
    makeSwiftReleaseBuildArguments({
      sourceRoot: source,
      packageRoot: packagePath,
      scratchPath,
    }),
    executionOptions,
  );
  const binPathResult = await runner(
    "/usr/bin/xcrun",
    makeSwiftReleaseBuildArguments({
      sourceRoot: source,
      packageRoot: packagePath,
      scratchPath,
      showBinPath: true,
    }),
    executionOptions,
  );
  const binary = join(
    oneLinePath(binPathResult.stdout, "swift build --show-bin-path"),
    coordinatorProductName,
  );
  const canonicalWork = await realpath(work);
  const canonicalBinary = await realpath(binary);
  if (!isWithin(canonicalWork, canonicalBinary)) {
    fail("fresh coordinator output escaped the unique build work root");
  }
  const metadata = await requireExecutableFile(canonicalBinary, "fresh coordinator output");
  if (metadata.size > maximumCoordinatorBytes) {
    fail(`fresh coordinator output exceeds the ${maximumCoordinatorBytes}-byte limit`);
  }
  const privatePathMarker = Buffer.from("/Users/", "utf8");
  if (await stableRegularFileContainsMarker(
    canonicalBinary,
    metadata,
    "fresh coordinator output",
    privatePathMarker,
  )) {
    fail("fresh coordinator output contains a local /Users path");
  }
  await requireFreshCoordinatorArchitecture(canonicalBinary, runner);
  return Object.freeze({ binaryPath: canonicalBinary, scratchPath });
}

function cleanupError(primaryError, cleanupFailure) {
  if (primaryError === null) return cleanupFailure;
  return new AggregateError(
    [primaryError, cleanupFailure],
    `${primaryError.message}; fresh build cleanup failed: ${cleanupFailure.message}`,
    { cause: primaryError },
  );
}

function requireMatchingReleaseFingerprint(expected, actual, phase) {
  if (expected.sha256 !== actual.sha256 || expected.files !== actual.files) {
    fail(`release inputs changed ${phase}; no DMG was published`);
  }
}

export async function buildFreshInternalDMG({
  outputPath,
  buildNumber,
  compatiblePreviousApps = [],
  sourceRoot = defaultSourceRoot,
  platform = process.platform,
} = {}, dependencies = {}) {
  requireDarwin(platform);
  const normalizedBuildNumber = requireInternalBuildNumber(
    buildNumber,
    "build number",
  );
  const source = requireAbsolutePath(sourceRoot, "source root");
  const output = requireAbsolutePath(outputPath, "--output");
  requireInternalDMGOutputBuildSuffix(output, normalizedBuildNumber);
  if (!Array.isArray(compatiblePreviousApps)) {
    fail("compatible previous apps must be an array");
  }
  if (compatiblePreviousApps.length > maximumCompatiblePreviousApps) {
    fail(`compatible previous apps may contain at most ${maximumCompatiblePreviousApps} entries`);
  }
  const previousApps = compatiblePreviousApps.map((path) => (
    requireAbsolutePath(path, "--compatible-previous-app")
  ));
  await requireDirectory(source, "source root");
  const canonicalSource = await realpath(source);
  const packageRoot = join(canonicalSource, "src", "coordinator-swift");
  await requireDirectory(packageRoot, "Swift package root");

  const selectToolchain = dependencies.selectToolchain ?? selectFullXcodeToolchain;
  const preflightOutput = dependencies.preflightOutput ?? preflightInternalDMGOutput;
  const fingerprintInputs = dependencies.fingerprintInputs ?? fingerprintReleaseInputs;
  const snapshotInputs = dependencies.snapshotInputs ?? snapshotReleaseInputs;
  const buildCoordinator = dependencies.buildCoordinator ?? buildFreshCoordinator;
  const packageDMG = dependencies.packageDMG ?? buildInternalDMG;
  const makeWorkRoot = dependencies.makeWorkRoot
    ?? (() => mkdtemp(join(tmpdir(), "blabee-fresh-internal-dmg-")));
  const inspectWorkRoot = dependencies.inspectWorkRoot ?? captureFreshWorkRoot;
  const removeWorkRoot = dependencies.removeWorkRoot
    ?? removeFreshWorkRoot;

  await preflightOutput(output, { buildNumber: normalizedBuildNumber });
  const toolchain = await selectToolchain({ platform });
  const workRoot = await makeWorkRoot();
  const workRootIdentity = await inspectWorkRoot(workRoot, canonicalSource);
  let primaryError = null;
  let result;
  try {
    const before = await fingerprintInputs(canonicalSource);
    const snapshotSource = await snapshotInputs(
      canonicalSource,
      join(workRoot, "release-source"),
    );
    const snapshotBeforeBuild = await fingerprintInputs(snapshotSource);
    requireMatchingReleaseFingerprint(
      before,
      snapshotBeforeBuild,
      "while creating the private source snapshot",
    );
    requireMatchingReleaseFingerprint(
      before,
      await fingerprintInputs(canonicalSource),
      "while creating the private source snapshot",
    );
    const snapshotPackageRoot = join(snapshotSource, "src", "coordinator-swift");
    const coordinator = await buildCoordinator({
      sourceRoot: snapshotSource,
      packageRoot: snapshotPackageRoot,
      workRoot,
      toolchain,
    });
    requireMatchingReleaseFingerprint(
      snapshotBeforeBuild,
      await fingerprintInputs(snapshotSource),
      "inside the private snapshot during the fresh build",
    );
    requireMatchingReleaseFingerprint(
      before,
      await fingerprintInputs(canonicalSource),
      "in the live source during the fresh build",
    );
    result = await packageDMG({
      binaryPath: coordinator.binaryPath,
      outputPath: output,
      buildNumber: normalizedBuildNumber,
      compatiblePreviousApps: previousApps,
      platform,
      sourceRoot: snapshotSource,
      prePublishValidation: async () => {
        requireMatchingReleaseFingerprint(
          snapshotBeforeBuild,
          await fingerprintInputs(snapshotSource),
          "inside the private snapshot during DMG assembly",
        );
        requireMatchingReleaseFingerprint(
          before,
          await fingerprintInputs(canonicalSource),
          "in the live source during DMG assembly",
        );
      },
    });
  } catch (error) {
    primaryError = error;
  }

  try {
    await removeWorkRoot(workRoot, workRootIdentity);
  } catch (error) {
    primaryError = cleanupError(primaryError, error);
  }
  if (primaryError !== null) throw primaryError;
  return result;
}

function parseCLIArguments(values) {
  let outputPath;
  let buildNumber;
  let help = false;
  const compatiblePreviousApps = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      help = true;
      continue;
    }
    if (
      value !== "--output"
      && value !== "--build-number"
      && value !== "--compatible-previous-app"
    ) {
      fail(`unsupported argument: ${value}`);
    }
    if (index + 1 >= values.length || values[index + 1].startsWith("--")) {
      fail(`${value} requires a value`);
    }
    const argument = values[index + 1];
    index += 1;
    if (value === "--output") {
      if (outputPath !== undefined) fail("--output may be provided only once");
      outputPath = argument;
    } else if (value === "--build-number") {
      if (buildNumber !== undefined) fail("--build-number may be provided only once");
      buildNumber = requireInternalBuildNumber(argument, "--build-number");
    } else {
      compatiblePreviousApps.push(argument);
      if (compatiblePreviousApps.length > maximumCompatiblePreviousApps) {
        fail(`--compatible-previous-app may be provided at most ${maximumCompatiblePreviousApps} times`);
      }
    }
  }
  if (!help && buildNumber === undefined) fail("--build-number is required");
  if (!help && outputPath !== undefined) {
    requireInternalDMGOutputBuildSuffix(outputPath, buildNumber);
  }
  return { outputPath, buildNumber, compatiblePreviousApps, help };
}

function usage() {
  return [
    "Usage:",
    "  npm run build:internal-dmg -- --build-number 2 --output /absolute/path/to/Blabee-internal-r2.dmg [--compatible-previous-app /absolute/path/to/Blabee.app]",
    "",
    "Builds the current Swift source in a new private scratch directory, then packages it.",
    "A usable full Xcode toolchain is required; Command Line Tools alone are not used.",
    "Prebuilt --binary inputs are intentionally unsupported to prevent stale DMG contents.",
    "--build-number is a required canonical integer from 1 through 9999 and must match the output -rN.dmg suffix.",
  ].join("\n");
}

export const freshInternalDMGTesting = Object.freeze({
  captureFreshWorkRoot,
  copyStableRegularFile,
  hashStableRegularFile,
  inspectFullXcodeDeveloperDirectory,
  parseCLIArguments,
  stableRegularFileContainsMarker,
});

async function main() {
  const options = parseCLIArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await buildFreshInternalDMG(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`fresh Blabee internal DMG build failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

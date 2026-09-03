#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  rmdir,
  symlink,
  unlink,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { assembleMacOSApp } from "./build-macos-app.mjs";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const bundleName = "Blabee.app";
const checksumSuffix = ".sha256";
const volumeName = "Blabee Internal Test";
const internalNoticeName = "INTERNAL_TESTING.txt";
const schemaVersion = "blabee.internal-dmg.v1";
const maximumCompatiblePreviousApps = 2;
const requiredPlistValues = Object.freeze({
  CFBundleExecutable: "blabee-coordinator",
  CFBundleIdentifier: "com.biadone.blabee",
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: "0.1.0",
  CFBundleVersion: "1",
  LSMinimumSystemVersion: "13.0",
});
const internalNotice = [
  "BLABEE INTERNAL TEST BUILD",
  "",
  "The enclosed Blabee.app is ad-hoc signed.",
  "This disk image is unsigned and is not notarized by Apple.",
  "It is intended only for approved internal testing on macOS 13 or later.",
  "Drag Blabee.app to Applications, then follow the team's test instructions.",
  "Do not redistribute this disk image as a public release.",
  "",
].join("\n");

function fail(message) {
  throw new Error(message);
}

function requireDarwin(platform = process.platform) {
  if (platform !== "darwin") {
    fail("internal DMG packaging is supported only on macOS");
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
  return metadata;
}

function preservationError(message) {
  const error = new Error(message);
  error.preservePackagingWork = true;
  return error;
}

async function captureDirectoryIdentity(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a real directory, not a symlink or special file`);
  }
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    realpath: await realpath(path),
  };
}

async function assertDirectoryIdentity(path, expected, label) {
  let actual;
  try {
    actual = await captureDirectoryIdentity(path, label);
  } catch (error) {
    throw preservationError(`${label} identity could not be revalidated: ${error.message}`);
  }
  if (
    actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.realpath !== expected.realpath
  ) {
    throw preservationError(`${label} identity changed during packaging; files are preserved for inspection`);
  }
}

function statIdentity(metadata) {
  return { dev: metadata.dev, ino: metadata.ino };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFileMetadata(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export async function snapshotExecutable(binaryPath, workRoot, {
  afterSnapshotChunk = null,
} = {}) {
  const binary = requireAbsolutePath(binaryPath, "--binary");
  const requestedWorkRoot = requireAbsolutePath(workRoot, "work root");
  await requireDirectory(requestedWorkRoot, "work root");
  const pathMetadata = await lstat(binary);
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    fail("--binary must be a regular file, not a symlink or special file");
  }
  if ((pathMetadata.mode & 0o111) === 0) fail("--binary must already be executable");

  const source = await open(binary, "r");
  const snapshotPath = join(requestedWorkRoot, "blabee-coordinator.pinned");
  let destination = null;
  try {
    const before = await source.stat();
    if (!before.isFile() || !sameIdentity(before, pathMetadata)) {
      fail("--binary changed while it was being opened");
    }
    destination = await open(snapshotPath, "wx", 0o700);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    let chunkIndex = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          chunk,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten === 0) fail("pinned binary snapshot write made no progress");
        written += result.bytesWritten;
      }
      position += bytesRead;
      if (afterSnapshotChunk !== null) {
        await afterSnapshotChunk({ chunkIndex, bytesRead, position });
      }
      chunkIndex += 1;
    }
    const after = await source.stat();
    if (!sameStableFileMetadata(before, after) || position !== before.size) {
      fail("--binary changed while its pinned snapshot was being created");
    }
    const pathAfter = await lstat(binary);
    if (pathAfter.isSymbolicLink() || !sameIdentity(pathAfter, before)) {
      fail("--binary path changed while its pinned snapshot was being created");
    }
    await destination.chmod(0o700);
    await destination.sync();
    const digest = hash.digest("hex");
    return { path: snapshotPath, sha256: digest, size: position };
  } catch (error) {
    try {
      if (destination !== null) await destination.close();
    } catch {
      // The caller owns work-root cleanup; keep the primary snapshot error.
    }
    destination = null;
    try {
      await unlink(snapshotPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        throw new AggregateError(
          [error, cleanupError],
          `${error.message}; pinned snapshot cleanup failed: ${cleanupError.message}`,
          { cause: error },
        );
      }
    }
    throw error;
  } finally {
    try {
      if (destination !== null) await destination.close();
    } finally {
      await source.close();
    }
  }
}

async function decodePlist(path) {
  await execFile("/usr/bin/plutil", ["-lint", path], { maxBuffer: 1024 * 1024 });
  const { stdout } = await execFile(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  let values;
  try {
    values = JSON.parse(stdout);
  } catch {
    fail("Info.plist could not be decoded");
  }
  if (values === null || Array.isArray(values) || typeof values !== "object") {
    fail("Info.plist must contain a dictionary");
  }
  return values;
}

async function inspectArchitectures(executablePath) {
  const { stdout, stderr } = await execFile(
    "/usr/bin/lipo",
    ["-archs", executablePath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (stderr !== "") fail("lipo wrote unexpected stderr");
  const architectures = stdout.trim().split(/\s+/u).filter(Boolean);
  if (
    architectures.length === 0
    || architectures.some((value) => !/^[A-Za-z0-9_]+$/u.test(value))
  ) {
    fail("main executable has an invalid architecture list");
  }
  return architectures;
}

async function verifyAdHocSignature(appPath) {
  await execFile(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const result = await execFile(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", appPath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const details = `${result.stdout}${result.stderr}`;
  if (!details.split(/\r?\n/u).includes("Signature=adhoc")) {
    fail("Blabee.app must have an ad-hoc code signature");
  }
}

export async function verifyInternalAppBundle(appPath) {
  const requestedApp = requireAbsolutePath(appPath, "Blabee.app");
  if (basename(requestedApp) !== bundleName) {
    fail(`app bundle must end with ${bundleName}`);
  }
  await requireDirectory(requestedApp, "Blabee.app");
  const canonicalApp = await realpath(requestedApp);
  if (basename(canonicalApp) !== bundleName) {
    fail(`app bundle must resolve to ${bundleName}`);
  }
  const infoPlist = join(canonicalApp, "Contents", "Info.plist");
  await requireRegularFile(infoPlist, "Info.plist");
  const plist = await decodePlist(infoPlist);
  for (const [key, expected] of Object.entries(requiredPlistValues)) {
    if (typeof plist[key] !== typeof expected || plist[key] !== expected) {
      fail(`Info.plist ${key} must be ${JSON.stringify(expected)}`);
    }
  }
  const executable = join(
    canonicalApp,
    "Contents",
    "MacOS",
    requiredPlistValues.CFBundleExecutable,
  );
  const executableMetadata = await requireRegularFile(executable, "main executable");
  if ((executableMetadata.mode & 0o111) === 0) {
    fail("main executable must be executable");
  }
  const architectures = await inspectArchitectures(executable);
  await verifyAdHocSignature(canonicalApp);
  return {
    appPath: canonicalApp,
    architectures,
    bundleIdentifier: plist.CFBundleIdentifier,
    version: plist.CFBundleShortVersionString,
    build: plist.CFBundleVersion,
    minimumSystemVersion: plist.LSMinimumSystemVersion,
  };
}

async function streamSHA256(path) {
  await requireRegularFile(path, "DMG artifact");
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function inspectLinkIdentity(path) {
  const metadata = await lstat(path);
  return { dev: metadata.dev, ino: metadata.ino };
}

async function removeIfSameLink(path, identity) {
  if (identity === null) return;
  try {
    const metadata = await lstat(path);
    if (metadata.dev === identity.dev && metadata.ino === identity.ino) {
      await unlink(path);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function publishExclusive(source, destination, label) {
  try {
    await link(source, destination);
  } catch (error) {
    if (error?.code === "EEXIST") fail(`${label} appeared during packaging: ${destination}`);
    throw error;
  }
  return inspectLinkIdentity(source);
}

async function verifyMountedVolume(mountPoint, expectedApp) {
  const names = (await readdir(mountPoint)).sort();
  const expectedNames = ["Applications", bundleName, internalNoticeName].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    fail(`mounted DMG root must contain exactly ${expectedNames.join(", ")}`);
  }
  const applications = join(mountPoint, "Applications");
  const applicationsMetadata = await lstat(applications);
  if (!applicationsMetadata.isSymbolicLink()) {
    fail("Applications must be a symbolic link");
  }
  if (await readlink(applications) !== "/Applications") {
    fail("Applications link must target /Applications");
  }
  const notice = await readFile(join(mountPoint, internalNoticeName), "utf8");
  if (notice !== internalNotice) fail(`${internalNoticeName} content changed`);
  const mountedApp = await verifyInternalAppBundle(join(mountPoint, bundleName));
  if (
    mountedApp.bundleIdentifier !== expectedApp.bundleIdentifier
    || mountedApp.version !== expectedApp.version
    || mountedApp.build !== expectedApp.build
    || mountedApp.minimumSystemVersion !== expectedApp.minimumSystemVersion
    || JSON.stringify(mountedApp.architectures) !== JSON.stringify(expectedApp.architectures)
  ) {
    fail("mounted Blabee.app metadata differs from the assembled app");
  }
  return mountedApp;
}

async function attachedDeviceEntriesForImage(dmgPath, workRoot, phase, execute = execFile) {
  const { stdout } = await execute(
    "/usr/bin/hdiutil",
    ["info", "-plist"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const plistPath = join(workRoot, `.hdiutil-info-${phase}-${randomUUID()}.plist`);
  const handle = await open(plistPath, "wx", 0o600);
  try {
    await handle.writeFile(stdout, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  let payload;
  let primaryError = null;
  try {
    const result = await execute(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", plistPath],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    payload = JSON.parse(result.stdout);
  } catch (error) {
    primaryError = error;
  }
  let cleanupError = null;
  try {
    await unlink(plistPath);
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError !== null && cleanupError !== null) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${primaryError.message}; hdiutil info cleanup failed: ${cleanupError.message}`,
      { cause: primaryError },
    );
  }
  if (primaryError !== null) throw primaryError;
  if (cleanupError !== null) throw cleanupError;
  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.images)) {
    fail("hdiutil info returned an invalid plist payload");
  }
  const targetImage = await realpath(dmgPath);
  const devices = new Set();
  for (const image of payload.images) {
    if (image === null || Array.isArray(image) || typeof image !== "object") continue;
    if (typeof image["image-path"] !== "string") continue;
    let imagePath;
    try {
      imagePath = await realpath(image["image-path"]);
    } catch {
      imagePath = resolve(image["image-path"]);
    }
    if (imagePath !== targetImage || !Array.isArray(image["system-entities"])) continue;
    for (const entity of image["system-entities"]) {
      const device = entity?.["dev-entry"];
      if (typeof device === "string" && /^\/dev\/disk[0-9]+(?:s[0-9]+)?$/u.test(device)) {
        devices.add(device);
      }
    }
  }
  return devices;
}

function newDeviceEntries(before, after) {
  return [...after].filter((device) => !before.has(device)).sort();
}

function preferredDetachDevice(devices) {
  return devices.find((device) => /^\/dev\/disk[0-9]+$/u.test(device))
    ?? devices[0]
    ?? null;
}

export async function attachAndVerifyDMG(dmgPath, workRoot, expectedApp, {
  execute = execFile,
  snapshotDevices = attachedDeviceEntriesForImage,
  verifyMounted = verifyMountedVolume,
} = {}) {
  const mountPoint = join(workRoot, "mounted");
  await mkdir(mountPoint, { mode: 0o700 });
  await chmod(mountPoint, 0o700);
  const unmountedDevice = (await lstat(mountPoint)).dev;
  let devicesBefore;
  try {
    devicesBefore = await snapshotDevices(dmgPath, workRoot, "before", execute);
  } catch (error) {
    await rmdir(mountPoint);
    throw new Error(`DMG device baseline could not be captured: ${error.message}`, { cause: error });
  }
  let verificationError = null;
  let mountedApp = null;
  let attachCommandError = null;
  try {
    await execute(
      "/usr/bin/hdiutil",
      [
        "attach",
        "-readonly",
        "-nobrowse",
        "-noautoopen",
        "-mountpoint",
        mountPoint,
        dmgPath,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    attachCommandError = error;
  }

  let attachmentState = "unknown";
  try {
    attachmentState = (await lstat(mountPoint)).dev === unmountedDevice
      ? "unmounted"
      : "mounted";
  } catch (error) {
    verificationError = new Error(`DMG mount state could not be inspected: ${error.message}`);
  }
  let devicesAfter = null;
  let deviceSnapshotError = null;
  try {
    devicesAfter = await snapshotDevices(dmgPath, workRoot, "after-attach", execute);
  } catch (error) {
    deviceSnapshotError = error;
  }
  const newDevices = devicesAfter === null
    ? []
    : newDeviceEntries(devicesBefore, devicesAfter);
  if (attachCommandError !== null) {
    verificationError = attachCommandError;
  } else if (attachmentState === "mounted") {
    try {
      mountedApp = await verifyMounted(mountPoint, expectedApp);
    } catch (error) {
      verificationError = error;
    }
  } else if (attachmentState === "unmounted") {
    verificationError = new Error("hdiutil reported success without mounting the DMG");
  }

  let detachError = null;
  const detachTarget = attachmentState === "mounted"
    ? mountPoint
    : preferredDetachDevice(newDevices) ?? mountPoint;
  const mustAttemptDetach = attachmentState !== "unmounted"
    || newDevices.length > 0
    || deviceSnapshotError !== null;
  if (mustAttemptDetach) {
    try {
      await execute(
        "/usr/bin/hdiutil",
        ["detach", detachTarget],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
      const detachedDevice = (await lstat(mountPoint)).dev;
      if (detachedDevice !== unmountedDevice) {
        fail("hdiutil reported success but the DMG remains mounted");
      }
      attachmentState = "unmounted";
      if (deviceSnapshotError !== null) {
        throw new Error(`DMG device state could not be proven after detach: ${deviceSnapshotError.message}`);
      }
      const devicesAfterDetach = await snapshotDevices(
        dmgPath,
        workRoot,
        "after-detach",
        execute,
      );
      const remainingDevices = newDeviceEntries(devicesBefore, devicesAfterDetach);
      if (remainingDevices.length > 0) {
        throw new Error(`DMG device remains attached after detach: ${remainingDevices.join(", ")}`);
      }
    } catch (error) {
      detachError = error;
    }
  }
  if (attachmentState !== "unmounted" || detachError !== null) {
    const suffix = verificationError === null
      ? ""
      : `; validation also failed: ${verificationError.message}`;
    const error = preservationError(
      `DMG could not be detached normally; artifact will not be published and inspection files are preserved at ${workRoot} (mount: ${mountPoint}, image: ${dmgPath})${suffix}`,
    );
    error.cause = detachError ?? verificationError;
    throw error;
  }
  await rmdir(mountPoint);
  if (verificationError !== null) throw verificationError;
  return mountedApp;
}

async function resolveOutput(outputPath) {
  const requested = requireAbsolutePath(outputPath, "--output");
  if (!requested.toLocaleLowerCase("en-US").endsWith(".dmg")) {
    fail("--output must end with .dmg");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.dmg$/u.test(basename(requested))) {
    fail("--output filename must use conservative ASCII letters, numbers, dots, underscores, or hyphens");
  }
  const requestedParent = dirname(requested);
  const canonicalParent = await realpath(requestedParent);
  await requireDirectory(canonicalParent, "--output parent");
  const output = join(canonicalParent, basename(requested));
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const canonicalSystemTempRoot = await realpath(tmpdir());
  const canonicalSlashTmpRoot = await realpath("/tmp");
  if (![canonicalRepositoryRoot, canonicalSystemTempRoot, canonicalSlashTmpRoot]
    .some((root) => isWithin(root, output))) {
    fail("--output must be inside the Blabee repository or a system temporary directory");
  }
  const lowerOutput = output.toLocaleLowerCase("en-US");
  if (lowerOutput === "/applications" || lowerOutput.startsWith("/applications/")) {
    fail("direct writes to /Applications are not supported");
  }
  const checksum = `${output}${checksumSuffix}`;
  return {
    output,
    checksum,
    parent: canonicalParent,
    parentIdentity: await captureDirectoryIdentity(canonicalParent, "--output parent"),
    transaction: join(
      canonicalParent,
      `.${basename(output)}.blabee-internal-dmg-transaction.json`,
    ),
    lock: join(
      canonicalParent,
      `.${basename(output)}.blabee-internal-dmg.lock`,
    ),
  };
}

function validateLockPayload(payload, destination) {
  const expectedKeys = [
    "lock_identity",
    "nonce",
    "output",
    "pid",
    "schema_version",
  ].sort();
  if (
    payload === null
    || Array.isArray(payload)
    || typeof payload !== "object"
    || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(expectedKeys)
    || payload.schema_version !== "blabee.internal-dmg-lock.v1"
    || payload.output !== basename(destination.output)
    || !Number.isSafeInteger(payload.pid)
    || payload.pid <= 0
    || typeof payload.nonce !== "string"
    || !/^[0-9a-f-]{36}$/u.test(payload.nonce)
  ) {
    fail("internal DMG output lock is invalid; refusing automatic removal");
  }
  return {
    ...payload,
    lock_identity: requireRecordedIdentity(payload.lock_identity, "output lock"),
  };
}

async function readOutputLock(destination) {
  const pathMetadata = await lstat(destination.lock);
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    fail("internal DMG output lock must be a regular file; refusing automatic removal");
  }
  const handle = await open(destination.lock, "r");
  let payload;
  let handleMetadata;
  try {
    handleMetadata = await handle.stat();
    if (!sameIdentity(pathMetadata, handleMetadata)) {
      fail("internal DMG output lock changed while it was opened");
    }
    payload = validateLockPayload(JSON.parse(await handle.readFile("utf8")), destination);
    const after = await handle.stat();
    if (!sameStableFileMetadata(handleMetadata, after)) {
      fail("internal DMG output lock changed while it was read");
    }
  } finally {
    await handle.close();
  }
  if (!sameIdentity(payload.lock_identity, handleMetadata)) {
    fail("internal DMG output lock identity does not match its payload");
  }
  return { payload, identity: statIdentity(handleMetadata) };
}

async function createOutputLock(destination, ownerPID, nonce) {
  await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
  const handle = await open(destination.lock, "wx", 0o600);
  let identity;
  try {
    identity = statIdentity(await handle.stat());
    await handle.writeFile(`${JSON.stringify({
      schema_version: "blabee.internal-dmg-lock.v1",
      output: basename(destination.output),
      pid: ownerPID,
      nonce,
      lock_identity: identity,
    })}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error.message}; output lock close failed: ${cleanupError.message}`,
        { cause: error },
      );
    }
    await removeIfSameLink(destination.lock, identity ?? null);
    throw error;
  }
  await handle.close();
  return { path: destination.lock, identity, nonce, pid: ownerPID };
}

function ownerIsAlive(pid, processKill) {
  try {
    processKill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export async function acquireOutputLock(destination, {
  ownerPID = process.pid,
  nonce = randomUUID(),
  processKill = process.kill.bind(process),
} = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await createOutputLock(destination, ownerPID, nonce);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    let existing;
    try {
      existing = await readOutputLock(destination);
    } catch (error) {
      throw new Error(
        "internal DMG output lock exists but could not be verified; refusing automatic removal",
        { cause: error },
      );
    }
    if (ownerIsAlive(existing.payload.pid, processKill)) {
      fail(`internal DMG output is locked by active process ${existing.payload.pid}`);
    }
    if (attempt !== 0) {
      fail("internal DMG output lock changed during stale-lock recovery");
    }
    await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
    await removeIfSameLink(destination.lock, existing.identity);
  }
  fail("internal DMG output lock could not be acquired");
}

async function assertOutputLockOwnership(destination, ownership) {
  if (
    ownership === null
    || ownership?.path !== destination.lock
    || !Number.isSafeInteger(ownership?.pid)
    || ownership.pid <= 0
    || typeof ownership?.nonce !== "string"
  ) {
    fail("interrupted publish recovery requires output-lock ownership proof");
  }
  const current = await readOutputLock(destination);
  if (
    !sameIdentity(current.identity, ownership.identity)
    || current.payload.nonce !== ownership.nonce
    || current.payload.pid !== ownership.pid
  ) {
    throw preservationError("internal DMG output-lock ownership changed");
  }
}

export async function releaseOutputLock(destination, ownership) {
  await assertOutputLockOwnership(destination, ownership);
  await removeIfSameLink(destination.lock, ownership.identity);
}

function requireRecordedIdentity(value, label) {
  if (
    value === null
    || Array.isArray(value)
    || typeof value !== "object"
    || !Number.isSafeInteger(value.dev)
    || !Number.isSafeInteger(value.ino)
  ) {
    fail(`${label} has an invalid recorded identity`);
  }
  return { dev: value.dev, ino: value.ino };
}

function requireRecordedDirectoryIdentity(value, label) {
  const identity = requireRecordedIdentity(value, label);
  if (typeof value.realpath !== "string" || !isAbsolute(value.realpath)) {
    fail(`${label} has an invalid recorded real path`);
  }
  return { ...identity, realpath: value.realpath };
}

async function requirePathIdentity(path, expected, label, type) {
  const metadata = await lstat(path);
  const validType = type === "directory" ? metadata.isDirectory() : metadata.isFile();
  if (metadata.isSymbolicLink() || !validType || !sameIdentity(metadata, expected)) {
    throw preservationError(`${label} identity does not match the interrupted transaction`);
  }
  return metadata;
}

function validateTransactionPayload(payload, destination) {
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    fail("interrupted publish transaction must contain a JSON object");
  }
  const expectedKeys = [
    "checksum",
    "checksum_identity",
    "detached_verified",
    "dmg_identity",
    "output",
    "parent_identity",
    "schema_version",
    "sha256",
    "transaction_identity",
    "work_root",
    "work_root_identity",
  ].sort();
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(expectedKeys)) {
    fail("interrupted publish transaction contains unexpected fields");
  }
  if (payload.schema_version !== "blabee.internal-dmg-publish.v1") {
    fail("interrupted publish transaction has an unsupported schema");
  }
  if (
    payload.output !== basename(destination.output)
    || payload.checksum !== basename(destination.checksum)
  ) {
    fail("interrupted publish transaction targets different output paths");
  }
  if (
    typeof payload.work_root !== "string"
    || !/^\.blabee-internal-dmg-work-[A-Za-z0-9-]+$/u.test(payload.work_root)
  ) {
    fail("interrupted publish transaction has an invalid work-root name");
  }
  if (payload.detached_verified !== true || !/^[0-9a-f]{64}$/u.test(payload.sha256)) {
    fail("interrupted publish transaction lacks verified detach or checksum evidence");
  }
  return {
    ...payload,
    parent_identity: requireRecordedDirectoryIdentity(payload.parent_identity, "parent"),
    work_root_identity: requireRecordedDirectoryIdentity(payload.work_root_identity, "work root"),
    transaction_identity: requireRecordedIdentity(payload.transaction_identity, "transaction"),
    dmg_identity: requireRecordedIdentity(payload.dmg_identity, "DMG"),
    checksum_identity: requireRecordedIdentity(payload.checksum_identity, "checksum"),
  };
}

async function readTransactionPayload(destination) {
  const markerMetadata = await requireRegularFile(
    destination.transaction,
    "interrupted publish transaction",
  );
  let payload;
  try {
    payload = JSON.parse(await readFile(destination.transaction, "utf8"));
  } catch (error) {
    throw preservationError(`interrupted publish transaction is unreadable: ${error.message}`);
  }
  return {
    payload: validateTransactionPayload(payload, destination),
    markerIdentity: statIdentity(markerMetadata),
  };
}

export async function recoverInterruptedPublish(destination, lockOwnership) {
  await assertOutputLockOwnership(destination, lockOwnership);
  await assertDirectoryIdentity(
    destination.parent,
    destination.parentIdentity,
    "--output parent",
  );
  if (!await pathExistsWithoutFollowing(destination.transaction)) return { recovered: false };
  const { payload, markerIdentity } = await readTransactionPayload(destination);
  if (!sameIdentity(markerIdentity, payload.transaction_identity)) {
    throw preservationError("interrupted publish transaction marker identity changed");
  }
  if (!sameIdentity(payload.parent_identity, destination.parentIdentity)) {
    throw preservationError("interrupted publish transaction parent identity changed");
  }
  const workRoot = join(destination.parent, payload.work_root);
  const workRootExists = await pathExistsWithoutFollowing(workRoot);
  const stagedDMG = join(workRoot, "artifact.staged.dmg");
  const stagedChecksum = join(workRoot, "artifact.staged.dmg.sha256");
  if (workRootExists) {
    await requirePathIdentity(
      workRoot,
      payload.work_root_identity,
      "interrupted transaction work root",
      "directory",
    );
    const transactionSource = join(workRoot, "publish-transaction.json");
    await requirePathIdentity(
      transactionSource,
      payload.transaction_identity,
      "interrupted transaction source",
      "file",
    );
    await requirePathIdentity(stagedDMG, payload.dmg_identity, "staged DMG", "file");
    await requirePathIdentity(
      stagedChecksum,
      payload.checksum_identity,
      "staged checksum",
      "file",
    );
    if (await streamSHA256(stagedDMG) !== payload.sha256) {
      throw preservationError("staged DMG checksum differs from the interrupted transaction");
    }
    if (
      await readFile(stagedChecksum, "utf8")
      !== `${payload.sha256}  ${basename(destination.output)}\n`
    ) {
      throw preservationError("staged checksum content differs from the interrupted transaction");
    }
  }

  const dmgExists = await pathExistsWithoutFollowing(destination.output);
  const checksumExists = await pathExistsWithoutFollowing(destination.checksum);
  if (dmgExists) {
    await requirePathIdentity(destination.output, payload.dmg_identity, "published DMG", "file");
    if (await streamSHA256(destination.output) !== payload.sha256) {
      throw preservationError("published DMG checksum differs from the interrupted transaction");
    }
  }
  if (checksumExists) {
    await requirePathIdentity(
      destination.checksum,
      payload.checksum_identity,
      "published checksum",
      "file",
    );
    if (
      await readFile(destination.checksum, "utf8")
      !== `${payload.sha256}  ${basename(destination.output)}\n`
    ) {
      throw preservationError("published checksum content differs from the interrupted transaction");
    }
  }
  if (dmgExists && !checksumExists) {
    throw preservationError("interrupted transaction contains a DMG without its checksum; manual inspection is required");
  }
  if (checksumExists && !dmgExists) {
    await unlink(destination.checksum);
  }
  await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
  if (workRootExists) {
    await assertDirectoryIdentity(workRoot, payload.work_root_identity, "transaction work root");
    await rm(workRoot, { recursive: true, force: false });
  }
  await removeIfSameLink(destination.transaction, markerIdentity);
  return { recovered: true, committed: dmgExists && checksumExists };
}

async function assertOutputsAbsent(destination) {
  for (const [path, label] of [
    [destination.output, "DMG output"],
    [destination.checksum, "checksum output"],
  ]) {
    if (await pathExistsWithoutFollowing(path)) fail(`${label} already exists: ${path}`);
  }
}

async function createPublishTransaction({
  destination,
  workRoot,
  workRootIdentity,
  stagedDMG,
  stagedChecksum,
  sha256,
}) {
  await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
  await assertDirectoryIdentity(workRoot, workRootIdentity, "packaging work root");
  const dmgIdentity = statIdentity(await requireRegularFile(stagedDMG, "staged DMG"));
  const checksumIdentity = statIdentity(
    await requireRegularFile(stagedChecksum, "staged checksum"),
  );
  const transactionSource = join(workRoot, "publish-transaction.json");
  const handle = await open(transactionSource, "wx", 0o600);
  const transactionIdentity = statIdentity(await handle.stat());
  const payload = {
    schema_version: "blabee.internal-dmg-publish.v1",
    output: basename(destination.output),
    checksum: basename(destination.checksum),
    work_root: basename(workRoot),
    parent_identity: { ...destination.parentIdentity },
    work_root_identity: { ...workRootIdentity },
    transaction_identity: transactionIdentity,
    dmg_identity: dmgIdentity,
    checksum_identity: checksumIdentity,
    sha256,
    detached_verified: true,
  };
  try {
    await handle.writeFile(`${JSON.stringify(payload)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  let markerIdentity = null;
  try {
    markerIdentity = await publishExclusive(
      transactionSource,
      destination.transaction,
      "publish transaction",
    );
  } catch (error) {
    try {
      await unlink(transactionSource);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        throw new AggregateError(
          [error, cleanupError],
          `${error.message}; transaction cleanup failed: ${cleanupError.message}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
  return { transactionSource, markerIdentity, payload };
}

function cleanupDiagnostic(label, error) {
  return new Error(`${label}: ${error.message}`, { cause: error });
}

function errorWithCleanup(primaryError, cleanupErrors) {
  if (cleanupErrors.length === 0) return primaryError;
  const primary = primaryError
    ?? new Error("internal DMG packaging completed but cleanup did not finish");
  return new AggregateError(
    [primary, ...cleanupErrors],
    `${primary.message}; cleanup errors: ${cleanupErrors.map((error) => error.message).join("; ")}`,
    { cause: primary },
  );
}

export async function buildInternalDMG({
  binaryPath,
  outputPath,
  compatiblePreviousApps = [],
  platform = process.platform,
} = {}) {
  requireDarwin(platform);
  const binary = requireAbsolutePath(binaryPath, "--binary");
  if (!Array.isArray(compatiblePreviousApps)) {
    fail("compatible previous apps must be an array");
  }
  const previousApps = Array.from(compatiblePreviousApps);
  if (previousApps.length > maximumCompatiblePreviousApps) {
    fail(`at most ${maximumCompatiblePreviousApps} compatible previous apps are supported`);
  }
  const destination = await resolveOutput(outputPath);
  const outputLock = await acquireOutputLock(destination);
  const token = `${process.pid}-${randomUUID()}`;
  let workRoot = null;
  let workRootIdentity = null;
  let stagedDMG = null;
  let stagedChecksum = null;
  let dmgPublishedIdentity = null;
  let checksumPublishedIdentity = null;
  let transactionMarkerIdentity = null;
  let published = false;
  let preserveWorkRoot = false;
  let primaryError = null;
  let result = null;
  try {
    const recovery = await recoverInterruptedPublish(destination, outputLock);
    if (recovery.committed === true) {
      fail(`a previous internal DMG transaction completed successfully: ${destination.output}`);
    }
    await assertOutputsAbsent(destination);
    await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
    workRoot = await mkdtemp(join(destination.parent, `.blabee-internal-dmg-work-${token}-`));
    await chmod(workRoot, 0o700);
    workRootIdentity = await captureDirectoryIdentity(workRoot, "packaging work root");
    await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
    await assertDirectoryIdentity(workRoot, workRootIdentity, "packaging work root");
    const pinnedBinary = await snapshotExecutable(binary, workRoot);
    const volumeRoot = join(workRoot, "volume");
    stagedDMG = join(workRoot, "artifact.staged.dmg");
    stagedChecksum = join(workRoot, "artifact.staged.dmg.sha256");
    await mkdir(volumeRoot, { mode: 0o700 });
    await chmod(volumeRoot, 0o700);
    const appResult = await assembleMacOSApp({
      binaryPath: pinnedBinary.path,
      outputPath: join(volumeRoot, bundleName),
      adhocSign: true,
      compatiblePreviousApps: previousApps,
    });
    const assembledApp = await verifyInternalAppBundle(appResult.output);
    await symlink("/Applications", join(volumeRoot, "Applications"));
    const noticeHandle = await open(
      join(volumeRoot, internalNoticeName),
      "wx",
      0o600,
    );
    try {
      await noticeHandle.writeFile(internalNotice, "utf8");
      await noticeHandle.sync();
    } finally {
      await noticeHandle.close();
    }
    await chmod(join(volumeRoot, internalNoticeName), 0o644);

    await execFile(
      "/usr/bin/hdiutil",
      [
        "create",
        "-srcfolder",
        volumeRoot,
        "-volname",
        volumeName,
        "-fs",
        "HFS+",
        "-format",
        "UDZO",
        "-nospotlight",
        "-noanyowners",
        stagedDMG,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    await requireRegularFile(stagedDMG, "created DMG");
    await execFile(
      "/usr/bin/hdiutil",
      ["verify", stagedDMG],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    const mountedApp = await attachAndVerifyDMG(stagedDMG, workRoot, assembledApp);
    const sha256 = await streamSHA256(stagedDMG);
    const checksumLine = `${sha256}  ${basename(destination.output)}\n`;
    const checksumHandle = await open(stagedChecksum, "wx", 0o600);
    try {
      await checksumHandle.writeFile(checksumLine, "utf8");
      await checksumHandle.sync();
    } finally {
      await checksumHandle.close();
    }
    await chmod(stagedChecksum, 0o644);

    await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
    await assertDirectoryIdentity(workRoot, workRootIdentity, "packaging work root");
    const transaction = await createPublishTransaction({
      destination,
      workRoot,
      workRootIdentity,
      stagedDMG,
      stagedChecksum,
      sha256,
    });
    transactionMarkerIdentity = transaction.markerIdentity;
    checksumPublishedIdentity = await publishExclusive(
      stagedChecksum,
      destination.checksum,
      "checksum output",
    );
    dmgPublishedIdentity = await publishExclusive(
      stagedDMG,
      destination.output,
      "DMG output",
    );
    published = true;

    result = {
      schema_version: schemaVersion,
      artifact: destination.output,
      checksum_artifact: destination.checksum,
      sha256,
      input_binary_sha256: pinnedBinary.sha256,
      volume_name: volumeName,
      app: {
        bundle_identifier: mountedApp.bundleIdentifier,
        version: mountedApp.version,
        build: mountedApp.build,
        minimum_system_version: mountedApp.minimumSystemVersion,
        architectures: mountedApp.architectures,
      },
      app_signing: "adhoc",
      dmg_signing: "unsigned",
      notarized: false,
      public_distribution_ready: false,
    };
  } catch (error) {
    primaryError = error;
    preserveWorkRoot = error?.preservePackagingWork === true;
  }

  const cleanupErrors = [];
  if (workRoot !== null && !preserveWorkRoot) {
    try {
      await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
      await assertDirectoryIdentity(workRoot, workRootIdentity, "packaging work root");
    } catch (error) {
      cleanupErrors.push(cleanupDiagnostic("cleanup identity verification failed", error));
      preserveWorkRoot = true;
    }
  }
  if (!published && !preserveWorkRoot) {
    for (const [path, identity, label] of [
      [destination.output, dmgPublishedIdentity, "DMG rollback failed"],
      [destination.checksum, checksumPublishedIdentity, "checksum rollback failed"],
    ]) {
      try {
        await removeIfSameLink(path, identity);
      } catch (error) {
        cleanupErrors.push(cleanupDiagnostic(label, error));
        preserveWorkRoot = true;
      }
    }
  }
  let workRootRemoved = workRoot === null;
  if (workRoot !== null && !preserveWorkRoot) {
    try {
      await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
      await assertDirectoryIdentity(workRoot, workRootIdentity, "packaging work root");
      await rm(workRoot, { recursive: true, force: false });
      workRootRemoved = true;
    } catch (error) {
      cleanupErrors.push(cleanupDiagnostic(
        `packaging work-root cleanup failed; preserved path: ${workRoot}`,
        error,
      ));
      preserveWorkRoot = true;
    }
  }
  if (workRootRemoved && transactionMarkerIdentity !== null) {
    try {
      await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
      await removeIfSameLink(destination.transaction, transactionMarkerIdentity);
    } catch (error) {
      cleanupErrors.push(cleanupDiagnostic(
        `publish transaction cleanup failed; recoverable marker: ${destination.transaction}`,
        error,
      ));
    }
  }
  try {
    await assertDirectoryIdentity(destination.parent, destination.parentIdentity, "--output parent");
    await releaseOutputLock(destination, outputLock);
  } catch (error) {
    cleanupErrors.push(cleanupDiagnostic(
      `output lock cleanup failed; lock path: ${destination.lock}`,
      error,
    ));
  }

  if (primaryError !== null || cleanupErrors.length > 0) {
    throw errorWithCleanup(primaryError, cleanupErrors);
  }
  return result;
}

export const internalDMGTesting = Object.freeze({
  assertDirectoryIdentity,
  captureDirectoryIdentity,
  createPublishTransaction,
  acquireOutputLock,
  errorWithCleanup,
  publishExclusive,
  releaseOutputLock,
  resolveOutput,
});

function parseCLIArguments(values) {
  let binaryPath;
  let outputPath;
  let help = false;
  const compatiblePreviousApps = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
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
  return { binaryPath, outputPath, compatiblePreviousApps, help };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-internal-dmg.mjs --binary /absolute/path/to/blabee-coordinator --output /absolute/path/to/Blabee-internal.dmg [--compatible-previous-app /absolute/path/to/Blabee.app]",
    "",
    "Creates an ad-hoc signed, non-notarized DMG for approved internal testing only.",
    "--compatible-previous-app may be repeated at most twice.",
    "The output parent must already exist; the script never writes to /Applications.",
    "Both the .dmg and matching .dmg.sha256 path must not already exist.",
  ].join("\n");
}

async function main() {
  const options = parseCLIArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await buildInternalDMG(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`blabee internal DMG packaging failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

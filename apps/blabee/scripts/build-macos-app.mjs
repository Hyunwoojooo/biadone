#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { constants as fileSystemConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  writeFile,
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
import { TextDecoder, promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = resolve(dirname(scriptPath), "..");
const bundleName = "Blabee.app";
const menuBarIconFileName = "BlabeeMenuBar.svg";
const codexMarketplaceFileName = "CodexMarketplace.json";
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
const codexMarketplaceRelativePath = join(
  "Contents",
  "Resources",
  ".agents",
  "plugins",
  "marketplace.json",
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
const maximumCodexMarketplaceBytes = 64 * 1024;
const maximumPackagedFileBytes = 512 * 1024 * 1024;
const maximumPackagedPayloadBytes = 512 * 1024 * 1024;
const maximumPackagedPayloadEntries = 1024;
const copyBufferBytes = 64 * 1024;
const strictUTF8Decoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

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

async function requireNoSymlinkComponents(root, candidate, label) {
  assertWithin(root, candidate, label);
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "") return;
  let current = root;
  for (const component of pathFromRoot.split(sep)) {
    current = join(current, component);
    const metadata = await lstat(current, { bigint: true });
    if (metadata.isSymbolicLink()) {
      fail(`${label} must not contain symlink path components: ${current}`);
    }
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

function sameFileNode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFileSnapshot(left, right) {
  return sameFileNode(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function directoryOwnership(metadata) {
  return Object.freeze({ dev: metadata.dev, ino: metadata.ino });
}

function matchesDirectoryOwnership(metadata, expected) {
  return metadata.dev === expected.dev && metadata.ino === expected.ino;
}

async function closeFileHandles(handles) {
  const results = await Promise.allSettled(
    handles.filter((handle) => handle !== undefined).map((handle) => handle.close()),
  );
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "multiple file handles failed to close");
  }
}

async function closeFileHandlesPreservingPrimary(handles, primaryError) {
  try {
    await closeFileHandles(handles);
  } catch (closeError) {
    if (primaryError === undefined) throw closeError;
    const closeErrors = closeError instanceof AggregateError
      ? [...closeError.errors]
      : [closeError];
    const primaryMessage = primaryError instanceof Error
      ? primaryError.message
      : String(primaryError);
    const combined = new AggregateError(
      [primaryError, ...closeErrors],
      `${primaryMessage}; file handle cleanup also failed`,
      { cause: primaryError },
    );
    combined.closeErrors = closeErrors;
    throw combined;
  }
}

async function openStableRegularFile(
  path,
  label,
  maximumBytes,
  afterPathInspection,
) {
  if (
    !Number.isInteger(fileSystemConstants.O_NOFOLLOW)
    || !Number.isInteger(fileSystemConstants.O_NONBLOCK)
  ) {
    fail("secure nonblocking no-follow file opens are unavailable on this platform");
  }
  const pathMetadata = await lstat(path, { bigint: true });
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    fail(`${label} must be a regular file, not a symlink or special file`);
  }
  if (afterPathInspection !== undefined) await afterPathInspection();

  let handle;
  try {
    handle = await open(
      path,
      fileSystemConstants.O_RDONLY
        | fileSystemConstants.O_NONBLOCK
        | fileSystemConstants.O_NOFOLLOW,
    );
  } catch (error) {
    if (error?.code === "ELOOP") {
      fail(`${label} must be a regular file, not a symlink or special file`);
    }
    throw error;
  }

  try {
    const openedMetadata = await handle.stat({ bigint: true });
    if (!openedMetadata.isFile() || !sameFileNode(pathMetadata, openedMetadata)) {
      fail(`${label} changed while it was being opened`);
    }
    if (openedMetadata.size > BigInt(maximumBytes)) {
      fail(`${label} exceeds the ${maximumBytes}-byte limit`);
    }
    return { handle, metadata: openedMetadata };
  } catch (error) {
    await closeFileHandlesPreservingPrimary([handle], error);
    throw error;
  }
}

export const macOSAppAssemblyTestSupport = Object.freeze({
  closeFileHandlesPreservingPrimary,
  openStableRegularFile,
});

async function verifyStableOpenFile(path, label, handle, expectedMetadata) {
  const openedMetadata = await handle.stat({ bigint: true });
  if (!openedMetadata.isFile() || !sameStableFileSnapshot(expectedMetadata, openedMetadata)) {
    fail(`${label} changed while it was being read`);
  }
  let currentPathMetadata;
  try {
    currentPathMetadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`${label} changed while it was being read`);
    }
    throw error;
  }
  if (
    currentPathMetadata.isSymbolicLink()
    || !currentPathMetadata.isFile()
    || !sameFileNode(expectedMetadata, currentPathMetadata)
  ) {
    fail(`${label} changed while it was being read`);
  }
}

async function readBoundedRegularFile(path, label, maximumBytes) {
  const { handle, metadata } = await openStableRegularFile(
    path,
    label,
    maximumBytes,
  );
  let primaryError;
  try {
    const expectedBytes = Number(metadata.size);
    const bytes = Buffer.alloc(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        expectedBytes - offset,
        offset,
      );
      if (bytesRead === 0) fail(`${label} changed while it was being read`);
      offset += bytesRead;
    }
    const trailing = Buffer.alloc(1);
    const { bytesRead: trailingBytesRead } = await handle.read(
      trailing,
      0,
      1,
      expectedBytes,
    );
    if (trailingBytesRead !== 0) fail(`${label} changed while it was being read`);
    await verifyStableOpenFile(path, label, handle, metadata);
    return bytes;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeFileHandlesPreservingPrimary([handle], primaryError);
  }
}

async function copyFileWithMode(
  source,
  destination,
  mode,
  maximumBytes = maximumPackagedFileBytes,
  payloadBudget,
  requireSourceExecutable = false,
  requiredSourceRoot,
) {
  if (requiredSourceRoot !== undefined) {
    await requireNoSymlinkComponents(requiredSourceRoot, source, source);
  }
  const { handle: sourceHandle, metadata } = await openStableRegularFile(
    source,
    source,
    maximumBytes,
  );
  let destinationHandle;
  let primaryError;
  try {
    if (payloadBudget !== undefined) {
      consumePayloadBudget(payloadBudget, metadata.size, source);
    }
    if (requireSourceExecutable && (Number(metadata.mode) & 0o111) === 0) {
      fail(`${source} must already be executable`);
    }
    destinationHandle = await open(
      destination,
      fileSystemConstants.O_WRONLY
        | fileSystemConstants.O_CREAT
        | fileSystemConstants.O_EXCL
        | fileSystemConstants.O_NONBLOCK
        | fileSystemConstants.O_NOFOLLOW,
      mode,
    );
    const buffer = Buffer.alloc(copyBufferBytes);
    const expectedBytes = Number(metadata.size);
    let offset = 0;
    while (offset < expectedBytes) {
      const requestedBytes = Math.min(buffer.length, expectedBytes - offset);
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        requestedBytes,
        offset,
      );
      if (bytesRead === 0) fail(`${source} changed while it was being read`);
      let written = 0;
      while (written < bytesRead) {
        const { bytesWritten } = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          offset + written,
        );
        if (bytesWritten === 0) fail(`could not finish copying ${source}`);
        written += bytesWritten;
      }
      offset += bytesRead;
    }
    const trailing = Buffer.alloc(1);
    const { bytesRead: trailingBytesRead } = await sourceHandle.read(
      trailing,
      0,
      1,
      expectedBytes,
    );
    if (trailingBytesRead !== 0) fail(`${source} changed while it was being read`);
    await verifyStableOpenFile(source, source, sourceHandle, metadata);
    if (requiredSourceRoot !== undefined) {
      await requireNoSymlinkComponents(requiredSourceRoot, source, source);
    }
    await destinationHandle.chmod(mode);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeFileHandlesPreservingPrimary(
      [destinationHandle, sourceHandle],
      primaryError,
    );
  }
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

function scanStrictJSON(text, label, maximumDepth = 64) {
  let index = 0;

  function invalid(detail) {
    fail(`${label} must be valid JSON${detail === undefined ? "" : `: ${detail}`}`);
  }

  function skipWhitespace() {
    while (
      index < text.length
      && (text[index] === " "
        || text[index] === "\t"
        || text[index] === "\n"
        || text[index] === "\r")
    ) {
      index += 1;
    }
  }

  function parseUnicodeEscape() {
    const digits = text.slice(index, index + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(digits)) invalid("invalid Unicode escape");
    index += 4;
    return Number.parseInt(digits, 16);
  }

  function parseString(decode) {
    if (text[index] !== '"') invalid("object key must be a string");
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        if (!decode) return undefined;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          invalid("invalid string");
        }
      }
      if (text.charCodeAt(index) < 0x20) invalid("unescaped control character");
      if (character !== "\\") {
        index += 1;
        continue;
      }

      index += 1;
      if (index >= text.length) invalid("unterminated escape");
      const escaped = text[index];
      if ('"\\/bfnrt'.includes(escaped)) {
        index += 1;
        continue;
      }
      if (escaped !== "u") invalid("invalid escape");
      index += 1;
      const first = parseUnicodeEscape();
      if (first >= 0xD800 && first <= 0xDBFF) {
        if (text[index] !== "\\" || text[index + 1] !== "u") {
          invalid("unpaired Unicode surrogate");
        }
        index += 2;
        const second = parseUnicodeEscape();
        if (second < 0xDC00 || second > 0xDFFF) {
          invalid("unpaired Unicode surrogate");
        }
      } else if (first >= 0xDC00 && first <= 0xDFFF) {
        invalid("unpaired Unicode surrogate");
      }
    }
    invalid("unterminated string");
  }

  function parseNumber() {
    const remainder = text.slice(index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(remainder);
    if (match === null) invalid("invalid number");
    index += match[0].length;
  }

  function consumeLiteral(literal) {
    if (!text.startsWith(literal, index)) invalid("invalid token");
    index += literal.length;
  }

  function parseArray(depth) {
    if (depth > maximumDepth) invalid("nesting is too deep");
    index += 1;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (true) {
      parseValue(depth);
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index] !== ",") invalid("missing comma in array");
      index += 1;
      skipWhitespace();
    }
  }

  function parseObject(depth) {
    if (depth > maximumDepth) invalid("nesting is too deep");
    index += 1;
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    const keys = new Set();
    while (true) {
      const key = parseString(true).normalize("NFC");
      if (keys.has(key)) fail(`${label} contains duplicate JSON object keys`);
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") invalid("missing colon after object key");
      index += 1;
      skipWhitespace();
      parseValue(depth);
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index] !== ",") invalid("missing comma in object");
      index += 1;
      skipWhitespace();
    }
  }

  function parseValue(depth) {
    if (index >= text.length) invalid("unexpected end of input");
    switch (text[index]) {
      case "{": parseObject(depth + 1); break;
      case "[": parseArray(depth + 1); break;
      case '"': parseString(false); break;
      case "t": consumeLiteral("true"); break;
      case "f": consumeLiteral("false"); break;
      case "n": consumeLiteral("null"); break;
      default: parseNumber(); break;
    }
  }

  skipWhitespace();
  parseValue(0);
  skipWhitespace();
  if (index !== text.length) invalid("trailing content");
}

async function validateCodexMarketplace(path) {
  const label = "Codex marketplace manifest";
  const bytes = await readBoundedRegularFile(
    path,
    label,
    maximumCodexMarketplaceBytes,
  );
  if (bytes.length === 0) {
    fail(`${label} must be between 1 byte and 64 KiB`);
  }
  let text;
  try {
    text = strictUTF8Decoder.decode(bytes);
  } catch {
    fail(`${label} must be valid UTF-8`);
  }
  scanStrictJSON(text, label);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} must be valid JSON`);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("Codex marketplace manifest must be an object");
  }
  if (
    value.name !== "blabee-app"
    || value.interface?.displayName !== "Blabee"
    || !Array.isArray(value.plugins)
    || value.plugins.length !== 1
  ) {
    fail("Codex marketplace manifest identity is invalid");
  }
  const plugin = value.plugins[0];
  if (
    plugin?.name !== "blabee"
    || plugin?.source?.source !== "local"
    || plugin?.source?.path !== "./Plugin/blabee"
    || plugin?.policy?.installation !== "AVAILABLE"
    || plugin?.policy?.authentication !== "ON_INSTALL"
    || plugin?.category !== "Productivity"
  ) {
    fail("Codex marketplace manifest plugin contract is invalid");
  }
}

async function copyTreeStrict(
  sourceRoot,
  source,
  destination,
  destinationRelativeRoot,
  payloadBudget,
) {
  assertWithin(sourceRoot, source, source);
  await requireNoSymlinkComponents(sourceRoot, source, source);
  const directoryBefore = await lstat(source, { bigint: true });
  if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
    fail(`${source} must be a real directory, not a symlink or special file`);
  }
  if (payloadBudget !== undefined) {
    consumePayloadEntry(payloadBudget, source);
  }
  await mkdir(destination, { recursive: true, mode: 0o755 });
  await chmod(destination, 0o755);

  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    const destinationRelative = join(destinationRelativeRoot, entry.name);
    assertWithin(sourceRoot, sourceEntry, sourceEntry);
    await requireNoSymlinkComponents(sourceRoot, sourceEntry, sourceEntry);

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
        payloadBudget,
      );
      continue;
    }
    if (!metadata.isFile()) {
      fail(`resource input must be a regular file or directory: ${sourceEntry}`);
    }
    const mode = destinationRelative === launcherRelativePath ? 0o755 : 0o644;
    await copyFileWithMode(
      sourceEntry,
      destinationEntry,
      mode,
      maximumPackagedFileBytes,
      payloadBudget,
      false,
      sourceRoot,
    );
  }

  const directoryAfter = await lstat(source, { bigint: true });
  await requireNoSymlinkComponents(sourceRoot, source, source);
  if (
    directoryAfter.isSymbolicLink()
    || !directoryAfter.isDirectory()
    || !sameFileNode(directoryBefore, directoryAfter)
    || directoryBefore.mtimeNs !== directoryAfter.mtimeNs
    || directoryBefore.ctimeNs !== directoryAfter.ctimeNs
  ) {
    fail(`resource directory changed while it was being copied: ${source}`);
  }
}

async function inspectSourcePayload(path, budget) {
  const metadataBefore = await lstat(path, { bigint: true });
  if (metadataBefore.isSymbolicLink()) {
    fail(`resource input must not be a symlink: ${path}`);
  }
  if (metadataBefore.isFile()) {
    if (metadataBefore.size > BigInt(maximumPackagedFileBytes)) {
      fail(`${path} exceeds the ${maximumPackagedFileBytes}-byte limit`);
    }
    consumePayloadBudget(budget, metadataBefore.size, path);
    return;
  }
  if (!metadataBefore.isDirectory()) {
    fail(`resource input must be a regular file or directory: ${path}`);
  }
  consumePayloadEntry(budget, path);

  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    await inspectSourcePayload(join(path, entry.name), budget);
  }
  const metadataAfter = await lstat(path, { bigint: true });
  if (
    metadataAfter.isSymbolicLink()
    || !metadataAfter.isDirectory()
    || !sameFileNode(metadataBefore, metadataAfter)
    || metadataBefore.mtimeNs !== metadataAfter.mtimeNs
    || metadataBefore.ctimeNs !== metadataAfter.ctimeNs
  ) {
    fail(`resource directory changed while it was being inspected: ${path}`);
  }
}

async function validateSourcePayloadBudget(paths) {
  const budget = makePayloadBudget();
  for (const path of paths) {
    await inspectSourcePayload(path, budget);
  }
}

async function inspectManifestFile(path) {
  const { handle, metadata } = await openStableRegularFile(
    path,
    path,
    maximumPackagedFileBytes,
  );
  let primaryError;
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(copyBufferBytes);
    const expectedBytes = Number(metadata.size);
    let offset = 0;
    while (offset < expectedBytes) {
      const requestedBytes = Math.min(buffer.length, expectedBytes - offset);
      const { bytesRead } = await handle.read(buffer, 0, requestedBytes, offset);
      if (bytesRead === 0) fail(`${path} changed while it was being hashed`);
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const trailing = Buffer.alloc(1);
    const { bytesRead: trailingBytesRead } = await handle.read(
      trailing,
      0,
      1,
      expectedBytes,
    );
    if (trailingBytesRead !== 0) fail(`${path} changed while it was being hashed`);
    await verifyStableOpenFile(path, path, handle, metadata);
    return {
      sha256: hash.digest("hex"),
      size: Number(metadata.size),
      mode: (Number(metadata.mode) & 0o777).toString(8).padStart(4, "0"),
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeFileHandlesPreservingPrimary([handle], primaryError);
  }
}

function makePayloadBudget() {
  return { bytes: 0n, entries: 0 };
}

function consumePayloadEntry(budget, label) {
  budget.entries += 1;
  if (budget.entries > maximumPackagedPayloadEntries) {
    fail(
      `packaged payload exceeds the ${maximumPackagedPayloadEntries}-entry limit at ${label}`,
    );
  }
}

function consumePayloadBudget(budget, size, label) {
  consumePayloadEntry(budget, label);
  budget.bytes += size;
  if (budget.bytes > BigInt(maximumPackagedPayloadBytes)) {
    fail(`packaged payload exceeds the ${maximumPackagedPayloadBytes}-byte cumulative limit at ${label}`);
  }
}

async function collectManifestFiles(
  bundleRoot,
  current = bundleRoot,
  budget = makePayloadBudget(),
) {
  consumePayloadEntry(budget, current);
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
      files.push(...await collectManifestFiles(bundleRoot, path, budget));
      continue;
    }
    if (!metadata.isFile()) {
      fail(`assembled bundle unexpectedly contains a special file: ${path}`);
    }
    const pathFromBundle = relative(bundleRoot, path).split(sep).join("/");
    if (pathFromBundle === "Contents/Resources/assembly-manifest.json") {
      consumePayloadEntry(budget, pathFromBundle);
      continue;
    }
    const snapshot = await inspectManifestFile(path);
    consumePayloadBudget(budget, BigInt(snapshot.size), pathFromBundle);
    files.push({
      path: pathFromBundle,
      ...snapshot,
    });
  }
  return files.sort((left, right) => compareNames(left.path, right.path));
}

async function validateFinalBundleTree(
  bundleRoot,
  current = bundleRoot,
  budget = makePayloadBudget(),
) {
  assertWithin(bundleRoot, current, current);
  const directoryBefore = await lstat(current, { bigint: true });
  if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
    fail(`final app tree contains a non-directory component: ${current}`);
  }
  consumePayloadEntry(
    budget,
    relative(bundleRoot, current).split(sep).join("/") || bundleName,
  );
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink()) {
      fail(`final app tree unexpectedly contains a symlink: ${path}`);
    }
    if (metadata.isDirectory()) {
      await validateFinalBundleTree(bundleRoot, path, budget);
      continue;
    }
    if (!metadata.isFile()) {
      fail(`final app tree unexpectedly contains a special file: ${path}`);
    }
    const snapshot = await inspectManifestFile(path);
    consumePayloadBudget(
      budget,
      BigInt(snapshot.size),
      relative(bundleRoot, path).split(sep).join("/"),
    );
  }
  const directoryAfter = await lstat(current, { bigint: true });
  if (
    directoryAfter.isSymbolicLink()
    || !directoryAfter.isDirectory()
    || !sameFileNode(directoryBefore, directoryAfter)
    || directoryBefore.mtimeNs !== directoryAfter.mtimeNs
    || directoryBefore.ctimeNs !== directoryAfter.ctimeNs
  ) {
    fail(`final app directory changed while it was being verified: ${current}`);
  }
}

async function writeAssemblyManifest(bundleRoot, compatiblePreviousRuntimes) {
  const manifestPath = join(bundleRoot, "Contents", "Resources", "assembly-manifest.json");
  const payloadBudget = makePayloadBudget();
  consumePayloadEntry(
    payloadBudget,
    "Contents/Resources/assembly-manifest.json",
  );
  const manifest = {
    schema_version: "blabee.macos-app-assembly.v2",
    bundle_identifier: "com.biadone.blabee",
    hash_phase: "assembled_payload_before_optional_code_signing",
    compatible_previous_runtimes: compatiblePreviousRuntimes,
    files: await collectManifestFiles(bundleRoot, bundleRoot, payloadBudget),
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

async function captureOwnedDirectory(path, label) {
  const metadata = await lstat(path, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} reservation is not a real directory`);
  }
  return directoryOwnership(metadata);
}

async function verifyOwnedDirectory(path, expectedOwnership, label) {
  const metadata = await lstat(path, { bigint: true });
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || !matchesDirectoryOwnership(metadata, expectedOwnership)
  ) {
    fail(`${label} reservation identity changed: ${path}`);
  }
  return metadata;
}

async function verifyOwnedDirectoryEntries(
  path,
  expectedOwnership,
  expectedNames,
  label,
) {
  const before = await verifyOwnedDirectory(path, expectedOwnership, label);
  const names = (await readdir(path)).sort(compareNames);
  const expected = [...expectedNames].sort(compareNames);
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`${label} contains unexpected entries: ${path}`);
  }
  const after = await verifyOwnedDirectory(path, expectedOwnership, label);
  if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    fail(`${label} changed while its entries were being verified: ${path}`);
  }
}

async function verifyPathAbsent(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  fail(`${label} unexpectedly still exists: ${path}`);
}

async function verifyPublishedOutput(
  output,
  outputOwnership,
  contentsOwnership,
  expectedOutputMode,
) {
  const before = await verifyOwnedDirectory(output, outputOwnership, "output");
  if (
    expectedOutputMode !== undefined
    && (Number(before.mode) & 0o777) !== expectedOutputMode
  ) {
    fail(`output mode is not ${expectedOutputMode.toString(8)}: ${output}`);
  }
  const names = (await readdir(output)).sort(compareNames);
  if (JSON.stringify(names) !== JSON.stringify(["Contents"])) {
    fail(`output contains unexpected entries: ${output}`);
  }
  const contentsMetadata = await verifyOwnedDirectory(
    join(output, "Contents"),
    contentsOwnership,
    "published Contents",
  );
  if ((Number(contentsMetadata.mode) & 0o777) !== 0o755) {
    fail(`published Contents mode is not 755: ${join(output, "Contents")}`);
  }
  const after = await verifyOwnedDirectory(output, outputOwnership, "output");
  if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    fail(`output changed while its published contents were being verified: ${output}`);
  }
}

async function removeOwnedDirectory(path, expectedOwnership, label) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || !matchesDirectoryOwnership(metadata, expectedOwnership)
  ) {
    fail(`cleanup refused because the ${label} reservation identity changed: ${path}`);
  }
  const quarantine = join(
    dirname(path),
    `.${basename(path)}.cleanup-${process.pid}-${randomUUID()}`,
  );
  await rename(path, quarantine);
  const quarantineMetadata = await lstat(quarantine, { bigint: true });
  if (
    quarantineMetadata.isSymbolicLink()
    || !quarantineMetadata.isDirectory()
    || !matchesDirectoryOwnership(quarantineMetadata, expectedOwnership)
  ) {
    fail(`cleanup refused because the quarantined ${label} identity changed: ${quarantine}`);
  }
  await rm(quarantine, { recursive: true, force: true });
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
  const sourceCodexMarketplace = join(
    canonicalSourceRoot,
    "Packaging",
    "macos",
    "Resources",
    codexMarketplaceFileName,
  );
  const sourceContracts = join(canonicalSourceRoot, "Contracts", "v1");
  const sourcePlugin = join(canonicalSourceRoot, "Plugin", "blabee");
  assertWithin(canonicalSourceRoot, sourceInfoPlist, "Info.plist");
  assertWithin(canonicalSourceRoot, sourceLaunchAgent, "LaunchAgent plist");
  assertWithin(canonicalSourceRoot, sourceMenuBarIcon, "menu-bar icon");
  assertWithin(
    canonicalSourceRoot,
    sourceCodexMarketplace,
    "Codex marketplace manifest",
  );
  assertWithin(canonicalSourceRoot, sourceContracts, "Contracts/v1");
  assertWithin(canonicalSourceRoot, sourcePlugin, "Plugin/blabee");
  for (const [path, label] of [
    [sourceInfoPlist, "Info.plist"],
    [sourceLaunchAgent, "LaunchAgent plist"],
    [sourceMenuBarIcon, "menu-bar icon"],
    [sourceCodexMarketplace, "Codex marketplace manifest"],
    [sourceContracts, "Contracts/v1"],
    [sourcePlugin, "Plugin/blabee"],
  ]) {
    await requireNoSymlinkComponents(canonicalSourceRoot, path, label);
  }
  await requireRegularFile(sourceInfoPlist, "Info.plist");
  await requireDirectory(sourceLaunchAgentDirectory, "LaunchAgents");
  await requireRegularFile(sourceLaunchAgent, "LaunchAgent plist");
  await requireRegularFile(sourceMenuBarIcon, "menu-bar icon");
  await validateCodexMarketplace(sourceCodexMarketplace);
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
  await validateSourcePayloadBudget([
    binary,
    sourceInfoPlist,
    sourceLaunchAgent,
    sourceMenuBarIcon,
    sourceCodexMarketplace,
    sourceContracts,
    sourcePlugin,
  ]);

  const staging = join(
    canonicalParent,
    `.${bundleName}.staging-${process.pid}-${randomUUID()}`,
  );
  let stagingCreated = false;
  let stagingOwnership;
  let outputReserved = false;
  let outputOwnership;
  try {
    await mkdir(staging, { mode: 0o700 });
    stagingOwnership = await captureOwnedDirectory(staging, "staging");
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

    const copiedPayloadBudget = makePayloadBudget();
    const stagedCoordinator = join(macOS, "blabee-coordinator");
    await copyFileWithMode(
      binary,
      stagedCoordinator,
      0o755,
      maximumPackagedFileBytes,
      copiedPayloadBudget,
      true,
    );
    const compatiblePrevious = await resolveCompatiblePreviousRuntimes(
      stagedCoordinator,
      compatiblePreviousAppsSnapshot,
    );

    await copyFileWithMode(
      sourceInfoPlist,
      join(contents, "Info.plist"),
      0o644,
      maximumPackagedFileBytes,
      copiedPayloadBudget,
      false,
      canonicalSourceRoot,
    );
    await validateInfoPlist(join(contents, "Info.plist"));
    await copyFileWithMode(
      sourceLaunchAgent,
      join(staging, launchAgentRelativePath),
      0o644,
      maximumPackagedFileBytes,
      copiedPayloadBudget,
      false,
      canonicalSourceRoot,
    );
    await validateLaunchAgentPlist(join(staging, launchAgentRelativePath));
    await copyFileWithMode(
      sourceMenuBarIcon,
      join(resources, menuBarIconFileName),
      0o644,
      maximumPackagedFileBytes,
      copiedPayloadBudget,
      false,
      canonicalSourceRoot,
    );
    const codexMarketplaceDirectory = join(resources, ".agents", "plugins");
    await mkdir(codexMarketplaceDirectory, { recursive: true, mode: 0o755 });
    await chmod(join(resources, ".agents"), 0o755);
    await chmod(codexMarketplaceDirectory, 0o755);
    await copyFileWithMode(
      sourceCodexMarketplace,
      join(staging, codexMarketplaceRelativePath),
      0o644,
      maximumCodexMarketplaceBytes,
      copiedPayloadBudget,
      false,
      canonicalSourceRoot,
    );
    await validateCodexMarketplace(join(staging, codexMarketplaceRelativePath));
    await copyTreeStrict(
      canonicalSourceRoot,
      sourceContracts,
      join(resources, "Contracts", "v1"),
      join("Contents", "Resources", "Contracts", "v1"),
      copiedPayloadBudget,
    );
    await copyTreeStrict(
      canonicalSourceRoot,
      sourcePlugin,
      join(resources, "Plugin", "blabee"),
      join("Contents", "Resources", "Plugin", "blabee"),
      copiedPayloadBudget,
    );
    const manifest = await writeAssemblyManifest(
      staging,
      compatiblePrevious.policies,
    );
    if (adhocSign) await adhocSignAndVerify(staging);
    await validateFinalBundleTree(staging);
    const contentsOwnership = await captureOwnedDirectory(contents, "staged Contents");
    await verifyOwnedDirectoryEntries(
      staging,
      stagingOwnership,
      ["Contents"],
      "staging",
    );

    try {
      await mkdir(output, { mode: 0o700 });
      outputOwnership = await captureOwnedDirectory(output, "output");
      outputReserved = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail(`output appeared during assembly: ${output}`);
      }
      throw error;
    }
    await verifyOwnedDirectoryEntries(
      staging,
      stagingOwnership,
      ["Contents"],
      "staging",
    );
    await verifyOwnedDirectory(contents, contentsOwnership, "staged Contents");
    await verifyOwnedDirectoryEntries(output, outputOwnership, [], "output");
    await rename(contents, join(output, "Contents"));
    await verifyOwnedDirectoryEntries(staging, stagingOwnership, [], "staging");
    await verifyPublishedOutput(output, outputOwnership, contentsOwnership);
    await chmod(output, 0o755);
    await verifyOwnedDirectoryEntries(staging, stagingOwnership, [], "staging");
    await verifyPublishedOutput(output, outputOwnership, contentsOwnership, 0o755);
    await rmdir(staging);
    stagingCreated = false;
    await verifyPathAbsent(staging, "staging");
    await verifyPublishedOutput(output, outputOwnership, contentsOwnership, 0o755);
    outputReserved = false;
    return {
      output,
      signed: adhocSign,
      manifest,
      compatiblePreviousApps: compatiblePrevious.apps,
    };
  } catch (error) {
    if (cleanupOnFailure) {
      const cleanupFailures = [];
      if (outputReserved) {
        try {
          await removeOwnedDirectory(output, outputOwnership, "output");
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (stagingCreated) {
        try {
          await removeOwnedDirectory(staging, stagingOwnership, "staging");
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (cleanupFailures.length > 0) {
        const failureDetails = cleanupFailures.map(
          (cleanupError) => cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
        ).join("; ");
        const originalMessage = error instanceof Error ? error.message : String(error);
        const combined = new Error(
          `${originalMessage}; cleanup failed safely: ${failureDetails}`,
          { cause: error },
        );
        combined.cleanupErrors = cleanupFailures;
        throw combined;
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

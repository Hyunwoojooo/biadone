#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const CLAUDE_RUNTIME_SCHEMA = "blabee.claude-runtime.v2";
export const CLAUDE_RUNTIME_DELIVERY_MODE = "mcp-hook-v1";
export const CLAUDE_RUNTIME_NODE_VERSION = "22.23.2";
export const CLAUDE_RUNTIME_LIMITS = Object.freeze({ files: 900, fileBytes: 256 * 1024 * 1024,
  totalBytes: 384 * 1024 * 1024, depth: 64, manifestBytes: 1024 * 1024 });
export const CLAUDE_RUNTIME_SOURCE_FILES = Object.freeze([
  "auto-connect-client.mjs", "auto-connect-hook.mjs", "auto-connect-mcp.mjs",
  "native-session-client.mjs", "product-context.mjs", "product-core-client.mjs", "product-tools.mjs",
  "session-v2-channel-poller.mjs", "session-v2-client.mjs", "session-v2-context.mjs",
  "session-v2-hook.mjs", "session-v2-lifecycle.mjs", "session-v2-mcp.mjs", "session-v2-tools.mjs",
  "session-v2-waiter.mjs",
]);
// This is the pinned stdio/server runtime closure, not the SDK's unrelated HTTP
// integrations. Keep package licenses and export/type metadata beside the code.
export const CLAUDE_RUNTIME_PACKAGES = Object.freeze({
  "@modelcontextprotocol/sdk": "1.30.0", zod: "4.6.2", "zod-to-json-schema": "3.25.2",
  ajv: "8.20.0", "ajv-formats": "3.0.1", "fast-deep-equal": "3.1.3", "fast-uri": "3.1.7",
  "json-schema-traverse": "1.0.0", "require-from-string": "2.0.2",
});
export const CLAUDE_NODE_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.cs.allow-jit</key>
\t<true/>
</dict>
</plist>
`;
const requiredPackageEntries = Object.freeze({
  "@modelcontextprotocol/sdk": ["dist/esm/server/index.js", "dist/esm/server/stdio.js", "dist/esm/types.js"],
  zod: ["index.js", "v3/index.js", "v4/index.js", "v4-mini/index.js"],
  "zod-to-json-schema": ["dist/esm/index.js", "dist/esm/package.json"],
  ajv: ["dist/ajv.js"], "ajv-formats": ["dist/index.js"], "fast-deep-equal": ["index.js"],
  "fast-uri": ["index.js"], "json-schema-traverse": ["index.js"], "require-from-string": ["index.js"],
});
const fixedManifest = Object.freeze({
  schema_version: CLAUDE_RUNTIME_SCHEMA, bridge_version: "0.1.0", node_version: CLAUDE_RUNTIME_NODE_VERSION,
  mcp_sdk_version: "1.30.0", mcp_protocol_negotiation: "legacy", delivery_mode: CLAUDE_RUNTIME_DELIVERY_MODE,
  contract_versions: { owner: "blabee.claude-owner.v1", session: "blabee.claude-session.v3", pet: "blabee.pet-provider.v1" },
});
// Read-only compatibility for historical internal artifacts. Preparation emits
// only v2; neither signing nor resealing may promote a v1 Channels payload.
const developmentManifest = Object.freeze({
  schema_version: "blabee.claude-runtime.v1", bridge_version: "0.1.0", node_version: CLAUDE_RUNTIME_NODE_VERSION,
  mcp_sdk_version: "1.30.0", mcp_protocol_negotiation: "legacy", channel_mode: "development-preview",
  channel_source: "blabee-claude", channel_selector: "server:blabee-claude",
  contract_versions: { owner: "blabee.claude-owner.v1", session: "blabee.claude-session.v2", pet: "blabee.pet-provider.v1" },
});
const sourcePaths = new Set(CLAUDE_RUNTIME_SOURCE_FILES.map(name => `payload/src/${name}`));
const developmentSourcePaths = new Set([...sourcePaths].filter(path => path !== "payload/src/session-v2-waiter.mjs"));
const decoder = new TextDecoder("utf-8", { fatal: true });
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const fail = message => { throw new Error(`Claude runtime: ${message}`); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameSnapshot = (a, b) => sameNode(a, b) && a.size === b.size && a.mode === b.mode
  && a.nlink === b.nlink && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const licenseName = name => name === "require-from-string" ? "license" : "LICENSE";

export function canonicalClaudeRuntimeJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalClaudeRuntimeJSON).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonicalClaudeRuntimeJSON(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`${label} has unexpected fields`);
}

function absolute(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || /[\x00-\x1f\x7f]/u.test(value)) fail(`${label} requires an explicit absolute path`);
  return resolve(value);
}

function pathAllowed(path, allowedSources = sourcePaths) {
  if (typeof path !== "string" || path.length > 1024 || !/^[A-Za-z0-9_@.+/-]+$/u.test(path)
      || path.split("/").some(part => !part || part === "." || part === "..")
      || path.split("/").length > CLAUDE_RUNTIME_LIMITS.depth) return false;
  if (["node/bin/node", "node/LICENSE", "node/Node.entitlements", "payload/package.json", "payload/package-lock.json"].includes(path)
      || allowedSources.has(path)) return true;
  for (const name of Object.keys(CLAUDE_RUNTIME_PACKAGES)) {
    const prefix = `payload/node_modules/${name}/`;
    if (path.startsWith(prefix)) return packageFileAllowed(name, path.slice(prefix.length));
  }
  return false;
}

function packageFileAllowed(name, path) {
  if (path === "package.json" || path === licenseName(name)) return true;
  if (name === "@modelcontextprotocol/sdk") return path.startsWith("dist/esm/")
    && /\.(?:js|json)$/u.test(path) && !path.includes("/examples/");
  if (name === "zod") return !path.startsWith("src/") && path !== "tsconfig.json" && /\.(?:js|cjs|json)$/u.test(path);
  if (name === "zod-to-json-schema") return path.startsWith("dist/esm/") && /\.(?:js|json)$/u.test(path);
  if (name === "ajv" || name === "ajv-formats") return path.startsWith("dist/") && /\.(?:js|json)$/u.test(path);
  if (name === "fast-deep-equal") return ["index.js", "react.js", "es6/index.js", "es6/react.js"].includes(path);
  if (name === "fast-uri") return path === "index.js" || (path.startsWith("lib/") && path.endsWith(".js"));
  return path === "index.js";
}

async function canonicalDirectory(path, label, expectedMode) {
  const requested = absolute(path, label);
  const before = await lstat(requested, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory()) fail(`${label} must be a real directory`);
  const canonical = await realpath(requested);
  const after = await lstat(canonical, { bigint: true });
  if (!sameSnapshot(before, after)) fail(`${label} changed while resolving it`);
  if (expectedMode !== undefined && Number(after.mode & 0o7777n) !== expectedMode) fail(`${label} has an invalid mode`);
  return canonical;
}

async function noSymlinkComponents(root, path) {
  const child = relative(root, path);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) fail("source path escapes its root");
  let current = root;
  for (const component of child.split(sep).filter(Boolean)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) fail(`symlink component: ${current}`);
  }
}

// Every byte is read through a no-follow descriptor, with inode/link count and
// metadata checked both before and after. Sources are never executed by prepare.
async function inspectFile(path, { root, maximumBytes = CLAUDE_RUNTIME_LIMITS.fileBytes,
  mode, destination, collect = false } = {}) {
  if (root) await noSymlinkComponents(root, path);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail(`not a single-link regular file: ${path}`);
  if (before.size > BigInt(maximumBytes)) fail(`file exceeds byte limit: ${path}`);
  if (mode !== undefined && Number(before.mode & 0o7777n) !== mode) fail(`invalid file mode: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let output;
  try {
    if (!sameSnapshot(before, await handle.stat({ bigint: true }))) fail(`file changed while opening: ${path}`);
    if (destination) output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash("sha256");
    const chunks = [];
    const header = Buffer.alloc(32);
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < Number(before.size)) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      if (!bytesRead) fail(`file shortened while reading: ${path}`);
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      if (offset < header.length) bytes.copy(header, offset, 0, Math.min(bytesRead, header.length - offset));
      if (collect) chunks.push(Buffer.from(bytes));
      if (output) {
        let written = 0;
        while (written < bytesRead) {
          const count = (await output.write(bytes, written, bytesRead - written, offset + written)).bytesWritten;
          if (!count) fail(`file could not be copied: ${path}`);
          written += count;
        }
      }
      offset += bytesRead;
    }
    if ((await handle.read(buffer, 0, 1, offset)).bytesRead !== 0
        || !sameSnapshot(before, await handle.stat({ bigint: true }))
        || !sameSnapshot(before, await lstat(path, { bigint: true }))) fail(`file changed while reading: ${path}`);
    if (root) await noSymlinkComponents(root, path);
    return { sha256: hash.digest("hex"), size: offset, header, metadata: before,
      bytes: collect ? Buffer.concat(chunks) : undefined };
  } finally {
    await Promise.all([handle.close(), output?.close()]);
  }
}

async function readJSON(path, root) {
  const { bytes } = await inspectFile(path, { root, collect: true, maximumBytes: CLAUDE_RUNTIME_LIMITS.manifestBytes });
  try { return JSON.parse(decoder.decode(bytes)); } catch { fail(`invalid JSON: ${path}`); }
}

function validateNodeHeader(header, size, arch) {
  if (size < 32 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(12) !== 2
      || header.readUInt32LE(4) !== (arch === "arm64" ? 0x0100000c : 0x01000007)) {
    fail("Node must be a standalone 64-bit macOS executable matching node_arch");
  }
}

function validateManifest(manifest) {
  const fixed = manifest?.schema_version === "blabee.claude-runtime.v1" ? developmentManifest : fixedManifest;
  const allowedSources = fixed === developmentManifest ? developmentSourcePaths : sourcePaths;
  exactKeys(manifest, [...Object.keys(fixed), "node_arch", "files", "payload_digest"], "manifest");
  for (const [key, expected] of Object.entries(fixed)) {
    if (canonicalClaudeRuntimeJSON(manifest[key]) !== canonicalClaudeRuntimeJSON(expected)) {
      fail(key === "channel_mode" ? "channel mode is not qualified; only explicit development-preview is supported" : `unsupported ${key}`);
    }
  }
  if (!["arm64", "x64"].includes(manifest.node_arch)) fail("unsupported node_arch");
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > CLAUDE_RUNTIME_LIMITS.files) fail("invalid file count");
  let previous = "";
  let total = 0;
  for (const entry of manifest.files) {
    exactKeys(entry, ["path", "sha256", "size", "executable"], "file entry");
    if (!pathAllowed(entry.path, allowedSources) || compare(previous, entry.path) >= 0) fail("unknown, duplicate, or unsorted file path");
    if (!/^[0-9a-f]{64}$/u.test(entry.sha256) || typeof entry.sha256 !== "string"
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > CLAUDE_RUNTIME_LIMITS.fileBytes
        || entry.executable !== (entry.path === "node/bin/node")) fail("invalid file descriptor");
    previous = entry.path;
    total += entry.size;
  }
  if (total > CLAUDE_RUNTIME_LIMITS.totalBytes) fail("payload exceeds total byte limit");
  const paths = new Set(manifest.files.map(entry => entry.path));
  const required = ["node/bin/node", "node/LICENSE", "node/Node.entitlements", "payload/package.json", "payload/package-lock.json", ...allowedSources];
  for (const name of Object.keys(CLAUDE_RUNTIME_PACKAGES)) {
    for (const child of ["package.json", licenseName(name), ...requiredPackageEntries[name]]) required.push(`payload/node_modules/${name}/${child}`);
  }
  if (required.some(path => !paths.has(path))) fail("runtime is missing a required entry or license");
  if (manifest.files.some(entry => (entry.path === "node/LICENSE" || /\/(?:LICENSE|license)$/u.test(entry.path)) && entry.size === 0)) fail("runtime license is empty");
  const { payload_digest: digest, ...body } = manifest;
  if (digest !== `sha256:${sha256(canonicalClaudeRuntimeJSON(body))}`) fail("payload digest mismatch");
}

function manifestBody(arch, files) { return { ...fixedManifest, node_arch: arch, files }; }
function seal(body) { return { ...body, payload_digest: `sha256:${sha256(canonicalClaudeRuntimeJSON(body))}` }; }

async function validatePackageMetadata(root) {
  const bridge = await readJSON(join(root, "payload/package.json"), root);
  const lock = await readJSON(join(root, "payload/package-lock.json"), root);
  if (bridge.name !== "blabee-claude-bridge" || bridge.version !== "0.1.0" || bridge.type !== "module"
      || bridge.dependencies?.["@modelcontextprotocol/sdk"] !== "1.30.0"
      || lock.lockfileVersion !== 3 || lock.version !== "0.1.0"
      || lock.packages?.[""]?.dependencies?.["@modelcontextprotocol/sdk"] !== "1.30.0") fail("bridge package/lock version mismatch");
  for (const [name, version] of Object.entries(CLAUDE_RUNTIME_PACKAGES)) {
    const metadata = await readJSON(join(root, "payload/node_modules", name, "package.json"), root);
    if (metadata.name !== name || metadata.version !== version || lock.packages?.[`node_modules/${name}`]?.version !== version) fail(`package/lock version mismatch: ${name}`);
  }
}

async function inspectRuntime(directory, { permitResignedNode = false } = {}) {
  const root = await canonicalDirectory(directory, "runtime directory", 0o755);
  const manifestRead = await inspectFile(join(root, "manifest.json"), { root, mode: 0o644,
    maximumBytes: CLAUDE_RUNTIME_LIMITS.manifestBytes, collect: true });
  let manifest;
  try { manifest = JSON.parse(decoder.decode(manifestRead.bytes)); } catch { fail("manifest is not valid UTF-8 JSON"); }
  validateManifest(manifest);
  // Canonical serialization also rejects duplicate JSON keys and BOMs.
  if (manifestRead.bytes.toString("utf8") !== `${canonicalClaudeRuntimeJSON(manifest)}\n`) fail("manifest serialization is not canonical");
  const indexed = new Map(manifest.files.map(entry => [entry.path, entry]));
  const directories = new Set([""]);
  for (const path of indexed.keys()) {
    let current = dirname(path);
    while (current !== ".") { directories.add(current); current = dirname(current); }
  }
  const found = [];
  const snapshots = [];
  let seenEntries = 0;
  let actualBytes = 0;
  async function walk(current, path = "") {
    const before = await lstat(current, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || Number(before.mode & 0o7777n) !== 0o755 || !directories.has(path)) fail(`unexpected directory: ${path}`);
    for (const name of (await readdir(current)).sort(compare)) {
      if (++seenEntries > CLAUDE_RUNTIME_LIMITS.files + directories.size + 1) fail("runtime has unexpected entries");
      const child = path ? `${path}/${name}` : name;
      const target = join(current, name);
      const metadata = await lstat(target);
      if (metadata.isDirectory()) { await walk(target, child); continue; }
      if (child === "manifest.json") continue;
      const expected = indexed.get(child);
      if (!expected) fail(`unindexed file: ${child}`);
      const result = await inspectFile(target, { root, mode: expected.executable ? 0o755 : 0o644,
        maximumBytes: Math.min(CLAUDE_RUNTIME_LIMITS.fileBytes, CLAUDE_RUNTIME_LIMITS.totalBytes - actualBytes) });
      snapshots.push({ path: target, metadata: result.metadata });
      actualBytes += result.size;
      if (actualBytes > CLAUDE_RUNTIME_LIMITS.totalBytes) fail("payload exceeds total byte limit");
      if (!(permitResignedNode && child === "node/bin/node")
          && (result.sha256 !== expected.sha256 || result.size !== expected.size)) fail(`file digest mismatch: ${child}`);
      if (child === "node/bin/node") validateNodeHeader(result.header, result.size, manifest.node_arch);
      found.push({ path: child, sha256: result.sha256, size: result.size, executable: expected.executable });
    }
    if (!sameSnapshot(before, await lstat(current, { bigint: true }))) fail(`directory changed while verifying: ${path}`);
    snapshots.push({ path: current, metadata: before });
  }
  await walk(root);
  found.sort((a, b) => compare(a.path, b.path));
  if (found.length !== manifest.files.length) fail("indexed file is missing");
  const entitlements = await inspectFile(join(root, "node/Node.entitlements"), { root, collect: true, maximumBytes: 4096 });
  if (entitlements.bytes.toString("utf8") !== CLAUDE_NODE_ENTITLEMENTS) fail("Node entitlements must contain only allow-jit");
  await validatePackageMetadata(root);
  for (const snapshot of snapshots) {
    if (!sameSnapshot(snapshot.metadata, await lstat(snapshot.path, { bigint: true }))) fail("runtime changed during verification");
  }
  const after = await inspectFile(join(root, "manifest.json"), { root, mode: 0o644, maximumBytes: CLAUDE_RUNTIME_LIMITS.manifestBytes });
  if (after.sha256 !== manifestRead.sha256) fail("manifest changed while verifying");
  return { root, manifest, files: found };
}

export async function verifyClaudeRuntimeDirectory(directory) {
  return (await inspectRuntime(directory)).manifest;
}

export function requirePublicClaudeRuntime(manifest) {
  if (manifest?.schema_version !== CLAUDE_RUNTIME_SCHEMA || manifest.delivery_mode !== CLAUDE_RUNTIME_DELIVERY_MODE
      || manifest.contract_versions?.session !== "blabee.claude-session.v3") {
    fail("public distribution requires mcp-hook-v1; development Channels payloads are not permitted");
  }
  return manifest;
}

export async function verifyPublicClaudeRuntimeDirectory(directory) {
  return requirePublicClaudeRuntime(await verifyClaudeRuntimeDirectory(directory));
}

async function writeExclusive(path, bytes, mode = 0o644) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.chmod(mode); } finally { await handle.close(); }
}

export async function refreshClaudeRuntimeManifest(directory) {
  // Post-signing reseal is deliberately limited to Node bytes. Changed source,
  // policy, licenses, permissions, or file membership must fail closed.
  const { root, manifest, files } = await inspectRuntime(directory, { permitResignedNode: true });
  const { payload_digest: previousDigest, ...body } = manifest;
  const next = seal({ ...body, files });
  const staged = join(root, `.manifest-${randomUUID()}`);
  await writeExclusive(staged, `${canonicalClaudeRuntimeJSON(next)}\n`);
  try { await rename(staged, join(root, "manifest.json")); } catch (error) { await rm(staged, { force: true }); throw error; }
  return verifyClaudeRuntimeDirectory(root);
}

export async function prepareClaudeRuntime({ bridgeRoot, nodeBinaryPath, nodeLicensePath,
  nodeVersion, nodeArch, outputDirectory } = {}) {
  if (nodeVersion !== CLAUDE_RUNTIME_NODE_VERSION || !["arm64", "x64"].includes(nodeArch)) fail("an explicit pinned Node version and macOS architecture are required");
  const bridge = await canonicalDirectory(bridgeRoot, "bridge root");
  const requestedOutput = absolute(outputDirectory, "output directory");
  const parent = await canonicalDirectory(dirname(requestedOutput), "output parent");
  const output = join(parent, basename(requestedOutput));
  if (relative(bridge, output) === "" || !relative(bridge, output).startsWith("..")) fail("output must be outside the source bridge tree");
  const nodeInput = absolute(nodeBinaryPath, "Node binary");
  const licenseInput = absolute(nodeLicensePath, "Node license");
  const sources = new Map([["node/bin/node", nodeInput], ["node/LICENSE", licenseInput],
    ["payload/package.json", join(bridge, "package.json")], ["payload/package-lock.json", join(bridge, "package-lock.json")]]);
  for (const name of CLAUDE_RUNTIME_SOURCE_FILES) sources.set(`payload/src/${name}`, join(bridge, "src", name));
  let inspectedEntries = 0;
  for (const name of Object.keys(CLAUDE_RUNTIME_PACKAGES)) {
    const packageRoot = join(bridge, "node_modules", name);
    await noSymlinkComponents(bridge, packageRoot);
    async function collect(current, child = "") {
      const before = await lstat(current, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink() || child.split("/").length > CLAUDE_RUNTIME_LIMITS.depth) fail(`invalid package directory: ${name}`);
      for (const entry of (await readdir(current)).sort(compare)) {
        if (++inspectedEntries > 20_000) fail("installed package tree exceeds entry limit");
        const path = child ? `${child}/${entry}` : entry;
        const target = join(current, entry);
        const metadata = await lstat(target);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) fail(`installed package contains a link or special file: ${name}/${path}`);
        if (metadata.isDirectory()) { await collect(target, path); continue; }
        if (packageFileAllowed(name, path)) sources.set(`payload/node_modules/${name}/${path}`, target);
      }
      if (!sameSnapshot(before, await lstat(current, { bigint: true }))) fail(`package directory changed: ${name}`);
    }
    await collect(packageRoot);
  }
  if (sources.size + 1 > CLAUDE_RUNTIME_LIMITS.files) fail("runtime exceeds file count limit");
  // mkdir is the exclusive reservation: an existing output is never replaced.
  await mkdir(output, { mode: 0o700 });
  const owned = await lstat(output, { bigint: true });
  try {
    const files = [];
    const sourceSnapshots = [];
    let total = Buffer.byteLength(CLAUDE_NODE_ENTITLEMENTS);
    async function makeParents(path) {
      const parts = dirname(path).split("/");
      let current = output;
      for (const part of parts) {
        current = join(current, part);
        try { await mkdir(current, { mode: 0o755 }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
        const metadata = await lstat(current);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("output directory was replaced");
        await chmod(current, 0o755);
      }
    }
    for (const [path, source] of [...sources].sort(([a], [b]) => compare(a, b))) {
      if (!pathAllowed(path)) fail(`unsupported source path: ${path}`);
      await makeParents(path);
      const root = path.startsWith("payload/") ? bridge : await realpath(dirname(source));
      const canonicalSource = path.startsWith("payload/") ? source : join(root, basename(source));
      const result = await inspectFile(canonicalSource, { root, destination: join(output, path),
        maximumBytes: Math.min(CLAUDE_RUNTIME_LIMITS.fileBytes, CLAUDE_RUNTIME_LIMITS.totalBytes - total) });
      sourceSnapshots.push({ path: canonicalSource, root, metadata: result.metadata });
      const executable = path === "node/bin/node";
      if (executable) validateNodeHeader(result.header, result.size, nodeArch);
      total += result.size;
      if (total > CLAUDE_RUNTIME_LIMITS.totalBytes) fail("runtime exceeds total byte limit");
      await chmod(join(output, path), executable ? 0o755 : 0o644);
      files.push({ path, sha256: result.sha256, size: result.size, executable });
    }
    for (const source of sourceSnapshots) {
      await noSymlinkComponents(source.root, source.path);
      if (!sameSnapshot(source.metadata, await lstat(source.path, { bigint: true }))) fail(`source changed during preparation: ${source.path}`);
    }
    const entitlementPath = "node/Node.entitlements";
    await writeExclusive(join(output, entitlementPath), CLAUDE_NODE_ENTITLEMENTS);
    files.push({ path: entitlementPath, sha256: sha256(CLAUDE_NODE_ENTITLEMENTS), size: Buffer.byteLength(CLAUDE_NODE_ENTITLEMENTS), executable: false });
    files.sort((a, b) => compare(a.path, b.path));
    await writeExclusive(join(output, "manifest.json"), `${canonicalClaudeRuntimeJSON(seal(manifestBody(nodeArch, files)))}\n`);
    await chmod(output, 0o755);
    const manifest = await verifyClaudeRuntimeDirectory(output);
    return { outputDirectory: output, manifest };
  } catch (error) {
    const current = await lstat(output, { bigint: true }).catch(() => undefined);
    if (current?.isDirectory() && !current.isSymbolicLink() && sameNode(owned, current)) await rm(output, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const names = { "--bridge-root": "bridgeRoot", "--node-binary": "nodeBinaryPath", "--node-license": "nodeLicensePath",
    "--node-version": "nodeVersion", "--node-arch": "nodeArch", "--output": "outputDirectory" };
  const options = {};
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    process.stdout.write("Usage: node scripts/prepare-claude-runtime.mjs --bridge-root /absolute/bridge --node-binary /absolute/node --node-license /absolute/LICENSE --node-version 22.23.2 --node-arch arm64|x64 --output /absolute/new-runtime\n");
    return;
  }
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    if (!key || Object.hasOwn(options, key) || !args[index + 1] || args[index + 1].startsWith("--")) fail("invalid or repeated argument");
    options[key] = args[index + 1];
  }
  const result = await prepareClaudeRuntime(options);
  process.stdout.write(`${JSON.stringify({ output: result.outputDirectory, payload_digest: result.manifest.payload_digest, files: result.manifest.files.length })}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

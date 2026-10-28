#!/usr/bin/env node
// Offline integrity and path-policy check for a stable public export. This is
// not a content/secrets audit or evidence about the installed Blabee product.
import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "1.0";
const APP_RELEASE = "0.1.0+build.85";
const MANIFEST_PATH = "PUBLIC_SOURCES.json";
const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const IGNORED_NAMES = new Set([".git", "node_modules"]);
const ROOT_FILES = new Set([
  ".gitignore",
  "README.md",
  "README.ko.md",
  "LICENSE",
  "NOTICE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "CHANGELOG.ko.md",
  "package.json",
  "package-lock.json",
  "PUBLIC_SCOPE.md",
  MANIFEST_PATH,
]);
const PUBLIC_DIRECTORIES = [
  "Contracts/v1",
  "bridges/codex/plugin",
  "bridges/claude/src",
  "Tests/Contracts",
  "Tests/bridges/claude",
  "Tests/Public",
  "Fixtures/v1",
  "examples",
  "scripts",
  "docs",
  ".github",
];
const PUBLIC_FILES = new Set([
  "Tests/CoordinatorOperational/plugin-package.test.mjs",
]);
const PRIVATE_COMPONENTS = new Set([
  "app", "engine", "supabase", "account-web", "dev", "build",
  ".git", "node_modules", ".aws", ".ssh", ".gnupg", ".codex", ".claude",
  ".npmrc", ".netrc", ".pypirc", ".auth",
]);

export class PublicSourcesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicSourcesError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PublicSourcesError(code, message);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validatePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || /[\\\x00-\x1f\x7f:]/u.test(relativePath)
    || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    fail("INVALID_PATH", "Paths must be relative, canonical POSIX paths.");
  }
  const components = relativePath.split("/");
  if (components.some((component) => component === "" || component === "." || component === ".."
    || component.trim() !== component || component.endsWith(".")
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(component))) {
    fail("INVALID_PATH", "Paths must be relative, canonical POSIX paths.");
  }
  for (const component of components) {
    const name = component.toLowerCase();
    if (PRIVATE_COMPONENTS.has(name) || name.startsWith(".env")
      || /^\.?(?:credentials?|secrets?|tokens?)(?:[._-]|$)/u.test(name)
      || /^(?:auth|oauth|service[-_]account)(?:[._-].*)?\.(?:json|ya?ml|toml)$/u.test(name)
      || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/u.test(name)
      || /\.(?:db|db3|sqlite|sqlite3|mdb|kdbx)(?:-(?:wal|shm|journal))?$/u.test(name)
      || /\.(?:pem|key|p8|p12|pfx|keystore|keychain|keychain-db|mobileprovision)$/u.test(name)) {
      fail("FORBIDDEN_PATH", "Private implementation or credential paths are excluded.");
    }
  }
}

function isPublicFile(relativePath) {
  return ROOT_FILES.has(relativePath) || PUBLIC_FILES.has(relativePath)
    || PUBLIC_DIRECTORIES.some((directory) => relativePath.startsWith(`${directory}/`));
}

function isPublicDirectory(relativePath) {
  return PUBLIC_DIRECTORIES.some((directory) => relativePath === directory
    || directory.startsWith(`${relativePath}/`) || relativePath.startsWith(`${directory}/`))
    || [...PUBLIC_FILES].some((filename) => filename.startsWith(`${relativePath}/`));
}

function pathKey(relativePath) {
  // Reject case/Unicode aliases even on a case-sensitive export filesystem.
  return relativePath.normalize("NFC").toLowerCase();
}

function resolveInside(root, relativePath) {
  const filename = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, filename);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("INVALID_PATH", "Paths must stay inside the public export.");
  }
  return filename;
}

async function inventory(root) {
  const files = new Map();
  const seen = new Set();
  async function visit(relativeDirectory) {
    const directory = relativeDirectory ? resolveInside(root, relativeDirectory) : root;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      // These local-only entries are never followed, read, or manifest-declared.
      if (IGNORED_NAMES.has(entry.name)) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      validatePath(relativePath);
      const key = pathKey(relativePath);
      if (seen.has(key)) fail("DUPLICATE_PATH", "Public paths must be unique across platforms.");
      seen.add(key);
      const stat = await lstat(resolveInside(root, relativePath));
      if (stat.isSymbolicLink()) fail("SYMLINK", "Symbolic links are excluded from public files.");
      if (stat.isDirectory()) {
        if (!isPublicDirectory(relativePath)) fail("OUTSIDE_SCOPE", "A directory is outside the public scope.");
        await visit(relativePath);
      } else if (stat.isFile()) {
        if (!isPublicFile(relativePath)) fail("OUTSIDE_SCOPE", "A file is outside the public scope.");
        files.set(relativePath, stat);
      } else {
        fail("NON_REGULAR_FILE", "Only regular public files and directories are allowed.");
      }
    }
  }
  await visit("");
  return files;
}

async function readRegularFile(filename) {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail("NON_REGULAR_FILE", "Only regular public files are allowed.");
    return { bytes: await handle.readFile(), stat };
  } finally {
    await handle.close();
  }
}

async function verify(root) {
  if (typeof root !== "string" || root.length === 0) fail("INVALID_ROOT", "An export directory is required.");
  const absoluteRoot = path.resolve(root);
  const rootStat = await lstat(absoluteRoot);
  if (rootStat.isSymbolicLink()) fail("SYMLINK", "The export root must not be a symbolic link.");
  if (!rootStat.isDirectory()) fail("INVALID_ROOT", "The export root must be a directory.");
  const actualFiles = await inventory(absoluteRoot);
  if (!actualFiles.has(MANIFEST_PATH)) fail("MISSING_MANIFEST", "The public source manifest is required.");
  const { bytes } = await readRegularFile(resolveInside(absoluteRoot, MANIFEST_PATH));
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    // JSON.parse can include source fragments in its error message. Discard it.
    fail("INVALID_MANIFEST", "The public source manifest must be valid JSON.");
  }
  if (!exactKeys(manifest, ["schema_version", "app_release", "files"])
    || manifest.schema_version !== SCHEMA_VERSION || manifest.app_release !== APP_RELEASE
    || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail("INVALID_MANIFEST", "The public source manifest has an unsupported shape or release.");
  }
  const declared = new Set();
  const aliases = new Set();
  for (const entry of manifest.files) {
    if (!exactKeys(entry, ["path", "sha256", "mode", "origin"])
      || typeof entry.sha256 !== "string" || !/^[a-f\d]{64}$/iu.test(entry.sha256)
      || !["0644", "0755"].includes(entry.mode)
      || !["source", "public-template"].includes(entry.origin)) {
      fail("INVALID_ENTRY", "A public source entry has an unsupported shape.");
    }
    validatePath(entry.path);
    if (entry.path === MANIFEST_PATH) fail("MANIFEST_SELF_ENTRY", "The manifest must exclude itself.");
    if (!isPublicFile(entry.path)) fail("OUTSIDE_SCOPE", "A declared file is outside the public scope.");
    const key = pathKey(entry.path);
    if (aliases.has(key)) fail("DUPLICATE_PATH", "Manifest paths must be unique across platforms.");
    aliases.add(key);
    declared.add(entry.path);
  }
  for (const filename of actualFiles.keys()) {
    if (filename !== MANIFEST_PATH && !declared.has(filename)) {
      fail("UNLISTED_FILE", "A public file is missing from the manifest.");
    }
  }
  for (const entry of manifest.files) {
    if (!actualFiles.has(entry.path)) fail("MISSING_FILE", "A declared public file is missing.");
    const { bytes: contents, stat } = await readRegularFile(resolveInside(absoluteRoot, entry.path));
    if (process.platform !== "win32" && (stat.mode & 0o7777) !== Number.parseInt(entry.mode, 8)) {
      fail("MODE_MISMATCH", "A public file has different permissions than declared.");
    }
    if (createHash("sha256").update(contents).digest("hex") !== entry.sha256.toLowerCase()) {
      fail("HASH_MISMATCH", "A public file has different bytes than declared.");
    }
  }
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    appRelease: APP_RELEASE,
    fileCount: declared.size,
    // Windows does not represent POSIX execute/group/other bits faithfully.
    modeChecked: process.platform !== "win32",
  };
}

/** Verify a stable export; never launches apps, subprocesses, or network calls. */
export async function verifyPublicSources(root = DEFAULT_ROOT) {
  try {
    return await verify(root);
  } catch (error) {
    if (error instanceof PublicSourcesError) throw error;
    // Filesystem exceptions can reveal local paths. Do not forward them.
    fail("FILESYSTEM_ERROR", "The public export could not be inspected.");
  }
}

let invokedAsCli = false;
if (process.argv[1]) {
  try {
    // macOS temporary-directory ancestors may themselves have symlink aliases.
    invokedAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    // Entry-point detection must not turn an inspection/programming error into
    // a successful CLI that never verified anything. Keep diagnostics fixed.
    process.stderr.write("Public sources verification failed [CLI_DETECTION_ERROR]: The CLI entry point could not be inspected.\n");
    process.exitCode = 1;
  }
}

if (invokedAsCli) {
  if (process.argv.length > 3) {
    process.stderr.write("Usage: node scripts/verify-public-sources.mjs [export-root]\n");
    process.exitCode = 1;
  } else if (process.argv[2] === "--help") {
    process.stdout.write("Usage: node scripts/verify-public-sources.mjs [export-root]\n"
      + "Checks public path policy and manifest integrity; does not audit file contents or the product.\n");
  } else {
    try {
      const result = await verifyPublicSources(process.argv[2] ?? DEFAULT_ROOT);
      process.stdout.write(`Public sources verified: ${result.fileCount} files (${result.appRelease}).\n`);
      if (!result.modeChecked) process.stdout.write("POSIX permission comparison is unavailable on Windows.\n");
    } catch (error) {
      process.stderr.write(`Public sources verification failed [${error.code}]: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

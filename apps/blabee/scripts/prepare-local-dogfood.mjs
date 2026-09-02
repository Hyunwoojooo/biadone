#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
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
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assembleMacOSApp,
  inspectSignedRuntimeIdentity,
} from "./build-macos-app.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const appRelativePath = "Blabee.app";
const coordinatorRelativePath = join(
  appRelativePath,
  "Contents",
  "MacOS",
  "blabee-coordinator",
);
const bundledPluginRelativePath = join(
  appRelativePath,
  "Contents",
  "Resources",
  "Plugin",
  "blabee",
);

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
  return child === "" || (
    child !== ".."
    && !child.startsWith(`..${sep}`)
    && !isAbsolute(child)
  );
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

async function requireRealDirectory(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a real directory, not a symlink or special file`);
  }
}

async function resolveSafeOutputRoot(value) {
  const requested = requireAbsolutePath(value, "--output");
  const requestedParent = dirname(requested);
  const canonicalParent = await realpath(requestedParent);
  await requireRealDirectory(canonicalParent, "--output parent");

  const outputRoot = join(canonicalParent, basename(requested));
  const allowedRoots = [...new Set(await Promise.all([
    realpath(repositoryRoot),
    realpath(tmpdir()),
    realpath("/tmp"),
  ]))];
  if (!allowedRoots.some((root) => outputRoot !== root && isWithin(root, outputRoot))) {
    fail("--output must be a child of the Blabee repository or a system temporary directory");
  }
  if (await pathExistsWithoutFollowing(outputRoot)) {
    fail(`output already exists: ${outputRoot}`);
  }
  return outputRoot;
}

async function copyTreeStrict(source, destination) {
  const sourceMetadata = await lstat(source);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    fail(`plugin source must be a real directory: ${source}`);
  }
  await mkdir(destination, { mode: 0o755 });
  await chmod(destination, 0o755);

  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    const metadata = await lstat(sourceEntry);
    if (metadata.isSymbolicLink()) {
      fail(`plugin source must not contain a symlink: ${sourceEntry}`);
    }
    if (metadata.isDirectory()) {
      await copyTreeStrict(sourceEntry, destinationEntry);
      continue;
    }
    if (!metadata.isFile()) {
      fail(`plugin source must contain only regular files and directories: ${sourceEntry}`);
    }
    await copyFile(sourceEntry, destinationEntry);
    await chmod(destinationEntry, metadata.mode & 0o777);
  }
}

async function writeNewFile(path, content, mode) {
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode });
  await chmod(path, mode);
}

function makeMarketplaceIdentity(outputRoot) {
  const suffix = createHash("sha256")
    .update(outputRoot, "utf8")
    .digest("hex")
    .slice(0, 12);
  const name = `blabee-local-dogfood-${suffix}`;
  return { name, selector: `blabee@${name}`, suffix };
}

function wrapperPreamble() {
  return [
    "#!/bin/sh",
    "set -eu",
    'case "$0" in',
    '  */*) BLABEE_DOGFOOD_LAUNCHER_DIR=${0%/*} ;;',
    '  *) BLABEE_DOGFOOD_LAUNCHER_DIR=. ;;',
    "esac",
    'BLABEE_DOGFOOD_BIN_DIR=$(CDPATH= cd -P "$BLABEE_DOGFOOD_LAUNCHER_DIR" && pwd)',
    'BLABEE_DOGFOOD_ROOT=$(CDPATH= cd -P "$BLABEE_DOGFOOD_BIN_DIR/.." && pwd)',
    'case "${HOME-}" in /*) : ;; *) /usr/bin/printf \'%s\\n\' \'blabee_home_unavailable\' >&2; exit 1 ;; esac',
    'BLABEE_DOGFOOD_SHARED_RUNTIME="$HOME/Library/Application Support/Blabee/runtime"',
    'BLABEE_DOGFOOD_SHARED_ROTATION_LOCK="$BLABEE_DOGFOOD_SHARED_RUNTIME/dogfood-rotation.lock"',
    'if [ -d "$BLABEE_DOGFOOD_SHARED_ROTATION_LOCK" ]; then',
    "  /usr/bin/printf '%s\\n' 'blabee_launch_deferred_rotation_in_progress' >&2",
    "  exit 75",
    "fi",
  ];
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function coordinatorWrapper() {
  return [
    ...wrapperPreamble(),
    "unset BLABEE_RUNTIME_IDENTITY",
    "unset BLABEE_SOCKET",
    'BLABEE_DOGFOOD_APP="$BLABEE_DOGFOOD_ROOT/Blabee.app"',
    'if [ "${1-}" = "doctor" ]; then',
    "  shift",
    '  export PATH="$BLABEE_DOGFOOD_APP/Contents/MacOS${PATH:+:$PATH}"',
    '  exec "$BLABEE_DOGFOOD_APP/Contents/MacOS/blabee-coordinator" doctor --app "$BLABEE_DOGFOOD_APP" "$@"',
    "fi",
    'exec "$BLABEE_DOGFOOD_ROOT/Blabee.app/Contents/MacOS/blabee-coordinator" "$@"',
    "",
  ].join("\n");
}

function productRuntimeWrapper(prefixArguments) {
  const quotedArguments = prefixArguments.map((argument) => `'${argument}'`).join(" ");
  return [
    ...wrapperPreamble(),
    "unset BLABEE_RUNTIME_IDENTITY",
    "unset BLABEE_SOCKET",
    `exec "$BLABEE_DOGFOOD_ROOT/Blabee.app/Contents/MacOS/blabee-coordinator" ${quotedArguments}${quotedArguments ? " " : ""}"$@"`,
    "",
  ].join("\n");
}

function managedCodexWrapper() {
  return [
    ...wrapperPreamble(),
    "unset BLABEE_LOADER_ENVIRONMENT",
    "if BLABEE_LOADER_ENVIRONMENT=$(/usr/bin/env); then",
    "  :",
    "else",
    "  /usr/bin/printf '%s\\n' 'managed_codex_environment_unsafe' >&2",
    "  exit 1",
    "fi",
    "BLABEE_LOADER_SCAN_STATUS=0",
    "if LC_ALL=C GREP_OPTIONS= /usr/bin/grep -Eq '^(DYLD_|__XPC_DYLD_|LD_)' <<BLABEE_LOADER_ENVIRONMENT_EOF",
    "$BLABEE_LOADER_ENVIRONMENT",
    "BLABEE_LOADER_ENVIRONMENT_EOF",
    "then",
    "  :",
    "else",
    "  BLABEE_LOADER_SCAN_STATUS=$?",
    "fi",
    'if [ "$BLABEE_LOADER_SCAN_STATUS" -ne 1 ]; then',
    "  /usr/bin/printf '%s\\n' 'managed_codex_environment_unsafe' >&2",
    "  exit 1",
    "fi",
    "unset BLABEE_LOADER_ENVIRONMENT",
    "unset BLABEE_LOADER_SCAN_STATUS",
    "unset BLABEE_RUNTIME_IDENTITY",
    "unset BLABEE_SOCKET",
    'export BLABEE_COORDINATOR_BINARY="$BLABEE_DOGFOOD_ROOT/Blabee.app/Contents/MacOS/blabee-coordinator"',
    'export PATH="$BLABEE_DOGFOOD_BIN_DIR${PATH:+:$PATH}"',
    'if [ -d "$BLABEE_DOGFOOD_SHARED_ROTATION_LOCK" ]; then',
    "  /usr/bin/printf '%s\\n' 'blabee_launch_deferred_rotation_in_progress' >&2",
    "  exit 75",
    "fi",
    'exec "$BLABEE_COORDINATOR_BINARY" managed-codex -- "$@"',
    "",
  ].join("\n");
}

function rotationPreflightWrapper() {
  return [
    "#!/bin/sh",
    "set -eu",
    "if [ \"$#\" -ne 0 ]; then",
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_preflight_usage_error' >&2",
    "  exit 64",
    "fi",
    "BLABEE_ROTATION_PS=/bin/ps",
    "if BLABEE_ROTATION_SNAPSHOT=$(\"$BLABEE_ROTATION_PS\" -axo pid=,ppid=,ucomm=,args=); then",
    "  :",
    "else",
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_preflight_unavailable' >&2",
    "  exit 1",
    "fi",
    "if BLABEE_ROTATION_BLOCKERS=$(/usr/bin/printf '%s\\n' \"$BLABEE_ROTATION_SNAPSHOT\" | /usr/bin/awk -v self_pid=\"$$\" '",
    "  {",
    "    pid = $1",
    "    ppid = $2",
    "    command = $3",
    "    if (pid == self_pid) next",
    "    basename = command",
    "    sub(/^.*\\//, \"\", basename)",
    "    if (basename == \"codex\" || basename ~ /^codex-[A-Za-z0-9._-]+$/) {",
    "      printf \"codex:%s\\n\", pid",
    "      next",
    "    }",
    "    if (basename == \"blabee-pet\") {",
    "      printf \"blabee_reference:%s\\n\", pid",
    "      next",
    "    }",
    "    if ($0 ~ /(^|[[:space:]])([^[:space:]]*\\/)?codex(\\.js)?([[:space:]]|$)/) {",
    "      printf \"codex:%s\\n\", pid",
    "      next",
    "    }",
    "    if ($0 ~ /blabee-coordinator[[:space:]]+(mcp|managed-codex|service|pet)([[:space:]]|$)/ || $0 ~ /(^|[[:space:]])[^[:space:]]*(blabee-codex|codex-with-blabee|blabee-pet)([[:space:]]|$)/ || $0 ~ /\\/\\.codex\\/plugins\\/cache\\/blabee-local-dogfood-/ || $0 ~ /blabee-local-dogfood-.*\\/marketplace\\/plugins\\/blabee/) {",
    "      printf \"blabee_reference:%s\\n\", pid",
    "    }",
    "  }",
    "'); then",
    "  :",
    "else",
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_preflight_unavailable' >&2",
    "  exit 1",
    "fi",
    "unset BLABEE_ROTATION_SNAPSHOT",
    "if [ -n \"$BLABEE_ROTATION_BLOCKERS\" ]; then",
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_deferred_active_references' >&2",
    "  /usr/bin/printf '%s\\n' \"$BLABEE_ROTATION_BLOCKERS\" >&2",
    "  exit 75",
    "fi",
    "unset BLABEE_ROTATION_BLOCKERS",
    "/usr/bin/printf '%s\\n' 'blabee_rotation_preflight_ok'",
    "",
  ].join("\n");
}

function rotationMutationWrapper({ outputRoot, pluginSelector, marketplaceName }) {
  const expectedRoot = shellSingleQuote(outputRoot);
  const quotedPluginSelector = shellSingleQuote(pluginSelector);
  const quotedMarketplaceName = shellSingleQuote(marketplaceName);
  return [
    "#!/bin/sh",
    "set -eu",
    'case "$0" in',
    '  */*) BLABEE_DOGFOOD_LAUNCHER_DIR=${0%/*} ;;',
    '  *) BLABEE_DOGFOOD_LAUNCHER_DIR=. ;;',
    "esac",
    'BLABEE_DOGFOOD_BIN_DIR=$(CDPATH= cd -P "$BLABEE_DOGFOOD_LAUNCHER_DIR" && pwd)',
    'BLABEE_DOGFOOD_ROOT=$(CDPATH= cd -P "$BLABEE_DOGFOOD_BIN_DIR/.." && pwd)',
    `BLABEE_ROTATION_EXPECTED_ROOT=${expectedRoot}`,
    'if [ "$BLABEE_DOGFOOD_ROOT" != "$BLABEE_ROTATION_EXPECTED_ROOT" ]; then',
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_root_identity_mismatch' >&2",
    "  exit 1",
    "fi",
    "if [ \"$#\" -ne 1 ]; then",
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_usage_error' >&2",
    "  exit 64",
    "fi",
    "BLABEE_ROTATION_ACTION=$1",
    'case "$BLABEE_ROTATION_ACTION" in',
    "  remove-plugin|remove-marketplace|cleanup-output-root) : ;;",
    "  *)",
    "    /usr/bin/printf '%s\\n' 'blabee_rotation_usage_error' >&2",
    "    exit 64",
    "    ;;",
    "esac",
    'case "${HOME-}" in /*) : ;; *) /usr/bin/printf \'%s\\n\' \'blabee_home_unavailable\' >&2; exit 1 ;; esac',
    'BLABEE_DOGFOOD_SHARED_RUNTIME="$HOME/Library/Application Support/Blabee/runtime"',
    'BLABEE_ROTATION_LOCK="$BLABEE_DOGFOOD_SHARED_RUNTIME/dogfood-rotation.lock"',
    'BLABEE_ROTATION_OWNER_FILE="$BLABEE_ROTATION_LOCK/owner"',
    "BLABEE_ROTATION_PS=/bin/ps",
    '/bin/mkdir -p "$BLABEE_DOGFOOD_SHARED_RUNTIME"',
    '/bin/chmod 700 "$BLABEE_DOGFOOD_SHARED_RUNTIME"',
    "blabee_rotation_canonical_lstart() {",
    "  LC_ALL=C /usr/bin/awk '",
    "    NR != 1 { invalid = 1; next }",
    "    {",
    "      if (NF != 5 || $1 !~ /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ || $2 !~ /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/ || $3 !~ /^[0-9][0-9]?$/ || $3 < 1 || $3 > 31 || $5 !~ /^[0-9][0-9][0-9][0-9]$/) { invalid = 1; next }",
    "      if (split($4, clock, \":\") != 3 || clock[1] !~ /^[0-9][0-9]$/ || clock[2] !~ /^[0-9][0-9]$/ || clock[3] !~ /^[0-9][0-9]$/ || clock[1] > 23 || clock[2] > 59 || clock[3] > 60) { invalid = 1; next }",
    "      canonical = sprintf(\"%s %s %2d %s %s\", $1, $2, $3, $4, $5)",
    "      if ($0 != canonical) { invalid = 1; next }",
    "    }",
    "    END { if (NR != 1 || invalid) exit 1; print canonical }",
    "  '",
    "}",
    'if BLABEE_ROTATION_OWNER_START_RAW=$(LC_ALL=C "$BLABEE_ROTATION_PS" -p "$$" -o lstart=); then :; else',
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_lock_identity_unavailable' >&2",
    "  exit 1",
    "fi",
    'if BLABEE_ROTATION_OWNER_START=$(/usr/bin/printf \'%s\\n\' "$BLABEE_ROTATION_OWNER_START_RAW" | blabee_rotation_canonical_lstart); then :; else',
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_lock_identity_unavailable' >&2",
    "  exit 1",
    "fi",
    "unset BLABEE_ROTATION_OWNER_START_RAW",
    "blabee_rotation_write_owner() {",
    '  BLABEE_ROTATION_OWNER_TMP="$BLABEE_ROTATION_LOCK/owner.$$"',
    '  /usr/bin/printf \'%s\\n%s\\n\' "$$" "$BLABEE_ROTATION_OWNER_START" > "$BLABEE_ROTATION_OWNER_TMP"',
    '  /bin/chmod 600 "$BLABEE_ROTATION_OWNER_TMP"',
    '  /bin/mv -f "$BLABEE_ROTATION_OWNER_TMP" "$BLABEE_ROTATION_OWNER_FILE"',
    "}",
    "blabee_rotation_acquire() {",
    '  if /bin/mkdir "$BLABEE_ROTATION_LOCK" 2>/dev/null; then',
    "    blabee_rotation_write_owner",
    "    return 0",
    "  fi",
    '  if [ ! -f "$BLABEE_ROTATION_OWNER_FILE" ]; then return 75; fi',
    '  if [ "$(LC_ALL=C /usr/bin/awk \'END { print NR }\' "$BLABEE_ROTATION_OWNER_FILE")" != "2" ]; then return 75; fi',
    '  BLABEE_ROTATION_STALE_PID=$(/usr/bin/sed -n \'1p\' "$BLABEE_ROTATION_OWNER_FILE")',
    '  BLABEE_ROTATION_STALE_START=$(/usr/bin/sed -n \'2p\' "$BLABEE_ROTATION_OWNER_FILE")',
    '  case "$BLABEE_ROTATION_STALE_PID" in \'\'|*[!0-9]*) return 75 ;; esac',
    '  if BLABEE_ROTATION_STALE_START_CANONICAL=$(/usr/bin/printf \'%s\\n\' "$BLABEE_ROTATION_STALE_START" | blabee_rotation_canonical_lstart); then :; else return 75; fi',
    '  if [ "$BLABEE_ROTATION_STALE_START_CANONICAL" != "$BLABEE_ROTATION_STALE_START" ]; then return 75; fi',
    '  if BLABEE_ROTATION_PROCESS_SNAPSHOT=$(LC_ALL=C "$BLABEE_ROTATION_PS" -axo pid=,lstart= 2>/dev/null); then :; else return 75; fi',
    "  BLABEE_ROTATION_OWNER_LOOKUP_STATUS=0",
    '  if BLABEE_ROTATION_LIVE_START=$(/usr/bin/printf \'%s\\n\' "$BLABEE_ROTATION_PROCESS_SNAPSHOT" | /usr/bin/awk -v owner_pid="$BLABEE_ROTATION_STALE_PID" \'',
    "    $1 == owner_pid {",
    "      line = $0",
    "      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, \"\", line)",
    "      print line",
    "      found = 1",
    "      exit 0",
    "    }",
    "    END { if (!found) exit 1 }",
    "  '); then",
    '    if BLABEE_ROTATION_LIVE_START_CANONICAL=$(/usr/bin/printf \'%s\\n\' "$BLABEE_ROTATION_LIVE_START" | blabee_rotation_canonical_lstart); then :; else return 75; fi',
    '    if [ "$BLABEE_ROTATION_LIVE_START_CANONICAL" != "$BLABEE_ROTATION_LIVE_START" ]; then return 75; fi',
    '    if [ "$BLABEE_ROTATION_LIVE_START" = "$BLABEE_ROTATION_STALE_START" ]; then return 75; fi',
    "  else",
    "    BLABEE_ROTATION_OWNER_LOOKUP_STATUS=$?",
    '    if [ "$BLABEE_ROTATION_OWNER_LOOKUP_STATUS" -ne 1 ]; then return 75; fi',
    "  fi",
    "  unset BLABEE_ROTATION_PROCESS_SNAPSHOT",
    "  unset BLABEE_ROTATION_OWNER_LOOKUP_STATUS",
    '  if [ "$BLABEE_ROTATION_STALE_PID" != "$(/usr/bin/sed -n \'1p\' "$BLABEE_ROTATION_OWNER_FILE")" ] || [ "$BLABEE_ROTATION_STALE_START" != "$(/usr/bin/sed -n \'2p\' "$BLABEE_ROTATION_OWNER_FILE")" ]; then return 75; fi',
    '  /bin/rm -f "$BLABEE_ROTATION_OWNER_FILE"',
    '  if ! /bin/rmdir "$BLABEE_ROTATION_LOCK" 2>/dev/null; then return 75; fi',
    '  if ! /bin/mkdir "$BLABEE_ROTATION_LOCK" 2>/dev/null; then return 75; fi',
    "  blabee_rotation_write_owner",
    "}",
    "if blabee_rotation_acquire; then :; else",
    "  /usr/bin/printf '%s\\n' 'blabee_rotation_deferred_lock_held' >&2",
    "  exit 75",
    "fi",
    "blabee_rotation_cleanup() {",
    '  if [ -f "$BLABEE_ROTATION_OWNER_FILE" ] && [ "$(/usr/bin/sed -n \'1p\' "$BLABEE_ROTATION_OWNER_FILE")" = "$$" ] && [ "$(/usr/bin/sed -n \'2p\' "$BLABEE_ROTATION_OWNER_FILE")" = "$BLABEE_ROTATION_OWNER_START" ]; then',
    '    /bin/rm -f "$BLABEE_ROTATION_OWNER_FILE"',
    '    /bin/rmdir "$BLABEE_ROTATION_LOCK" 2>/dev/null || :',
    "  fi",
    "}",
    "trap blabee_rotation_cleanup EXIT",
    "trap 'exit 129' HUP",
    "trap 'exit 130' INT",
    "trap 'exit 143' TERM",
    '"$BLABEE_DOGFOOD_BIN_DIR/blabee-rotation-preflight" >/dev/null',
    "BLABEE_ROTATION_CODEX=/usr/bin/env",
    'case "$BLABEE_ROTATION_ACTION" in',
    "  remove-plugin)",
    `    "$BLABEE_ROTATION_CODEX" codex plugin remove ${quotedPluginSelector} --json`,
    "    ;;",
    "  remove-marketplace)",
    `    "$BLABEE_ROTATION_CODEX" codex plugin marketplace remove ${quotedMarketplaceName} --json`,
    "    ;;",
    "  cleanup-output-root)",
    '    if [ ! -f "$BLABEE_DOGFOOD_ROOT/dogfood-summary.json" ] || [ ! -d "$BLABEE_DOGFOOD_ROOT/Blabee.app" ] || [ ! -x "$BLABEE_DOGFOOD_BIN_DIR/blabee-rotation" ]; then',
    "      /usr/bin/printf '%s\\n' 'blabee_rotation_output_identity_mismatch' >&2",
    "      exit 1",
    "    fi",
    '    /bin/rm -rf "$BLABEE_DOGFOOD_ROOT"',
    "    ;;",
    "esac",
    "",
  ].join("\n");
}

function makeSummary(outputRoot, {
  signed,
  marketplaceIdentity,
  assemblyManifestSHA256,
  wireRuntimeIdentity,
  compatiblePreviousApps,
  compatiblePreviousRuntimes,
}) {
  const app = join(outputRoot, appRelativePath);
  const coordinator = join(outputRoot, coordinatorRelativePath);
  const marketplace = join(outputRoot, "marketplace");
  const marketplaceManifest = join(
    marketplace,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const marketplacePlugin = join(marketplace, "plugins", "blabee");
  const coordinatorShim = join(outputRoot, "bin", "blabee-coordinator");
  const managedCodexLauncher = join(outputRoot, "bin", "blabee-codex");
  const rotationPreflightLauncher = join(
    outputRoot,
    "bin",
    "blabee-rotation-preflight",
  );
  const rotationLauncher = join(outputRoot, "bin", "blabee-rotation");
  const runtimeIdentityManifest = join(
    app,
    "Contents",
    "Resources",
    "assembly-manifest.json",
  );
  const projectSettingsLauncher = join(outputRoot, "bin", "blabee-project-settings");
  const serviceLauncher = join(outputRoot, "bin", "blabee-service");
  const petLauncher = join(outputRoot, "bin", "blabee-pet");
  const marketplaceAddArgv = [
    "codex",
    "plugin",
    "marketplace",
    "add",
    marketplace,
    "--json",
  ];
  const pluginAddArgv = [
    "codex",
    "plugin",
    "add",
    marketplaceIdentity.selector,
    "--json",
  ];
  const projectEnableArgvPrefix = [
    projectSettingsLauncher,
    "enable",
    "--project",
  ];
  const projectDisableArgvPrefix = [
    projectSettingsLauncher,
    "disable",
    "--project",
  ];
  const pluginRemoveGuardedArgv = [rotationLauncher, "remove-plugin"];
  const marketplaceRemoveGuardedArgv = [rotationLauncher, "remove-marketplace"];
  const outputRootCleanupGuardedArgv = [rotationLauncher, "cleanup-output-root"];
  return {
    schema_version: "blabee.local-dogfood-preparation.v2",
    preparation_only: true,
    signed,
    paths: {
      output_root: outputRoot,
      app,
      coordinator,
      coordinator_shim: coordinatorShim,
      managed_codex_launcher: managedCodexLauncher,
      rotation_preflight_launcher: rotationPreflightLauncher,
      rotation_launcher: rotationLauncher,
      runtime_identity_manifest: runtimeIdentityManifest,
      project_settings_launcher: projectSettingsLauncher,
      service_launcher: serviceLauncher,
      pet_launcher: petLauncher,
      marketplace,
      marketplace_manifest: marketplaceManifest,
      marketplace_plugin: marketplacePlugin,
    },
    codex: {
      marketplace_name: marketplaceIdentity.name,
      marketplace_identity_suffix: marketplaceIdentity.suffix,
      plugin_selector: marketplaceIdentity.selector,
      marketplace_add: {
        argv: marketplaceAddArgv,
        automatic: false,
      },
      plugin_add: {
        argv: pluginAddArgv,
        automatic: false,
      },
      managed_launch: {
        argv: [managedCodexLauncher],
        environment: {
          BLABEE_COORDINATOR_BINARY: coordinator,
          BLABEE_SOCKET: "unset_by_launcher",
          PATH_prepend: join(outputRoot, "bin"),
        },
        automatic: false,
      },
      hook_trust: {
        required: true,
        review_command: "/hooks",
        bypass_hook_trust: false,
      },
      cleanup_if_installed_later: {
        mutation_entrypoint: rotationLauncher,
        raw_mutation_argv_exposed: false,
        plugin_remove_argv: pluginRemoveGuardedArgv,
        marketplace_remove_argv: marketplaceRemoveGuardedArgv,
        output_root_cleanup_argv: outputRootCleanupGuardedArgv,
        preflight_runs_inside_each_mutation: true,
        on_preflight_failure: "defer_cleanup_without_mutation",
      },
    },
    runtime: {
      identity: {
        strategy: "process_cached_signed_code_and_manifest_v1",
        source_manifest_schema_version: "blabee.macos-app-assembly.v2",
        assembly_manifest_sha256: assemblyManifestSHA256,
        wire_runtime_identity: wireRuntimeIdentity,
        compatible_previous_apps: compatiblePreviousApps,
        compatible_previous_runtimes: compatiblePreviousRuntimes,
        manifest: runtimeIdentityManifest,
        resolved_at_process_start: true,
      },
      project_enable: {
        argv_prefix: projectEnableArgvPrefix,
        project_path_requirement: "append_one_explicit_absolute_project_path",
        run_before: "service",
        automatic: false,
        modifies_application_support_when_run: true,
      },
      service: {
        argv: [serviceLauncher],
        automatic: false,
        foreground: true,
        may_use_login_keychain: true,
      },
      pet: {
        argv: [petLauncher],
        automatic: false,
      },
    },
    runbook: {
      project_path_binding: "one_explicit_absolute_target_project_path_reused_by_all_project_steps",
      steps: [
        {
          order: 1,
          id: "preflight_marketplaces",
          argv: ["codex", "plugin", "marketplace", "list", "--json"],
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 2,
          id: "add_marketplace",
          argv: marketplaceAddArgv,
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 3,
          id: "add_plugin",
          argv: pluginAddArgv,
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 4,
          id: "enable_target_project",
          argv_prefix: projectEnableArgvPrefix,
          append_argument: "explicit_absolute_target_project_path",
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 5,
          id: "start_foreground_service",
          argv: [serviceLauncher],
          terminal_requirement: "dedicated_terminal",
          automatic: false,
          interactive: true,
          keep_running: true,
          stop_instruction: "press_ctrl_c_in_the_service_terminal",
        },
        {
          order: 6,
          id: "launch_codex_in_target_project",
          argv: ["codex"],
          cwd_requirement: "same_explicit_absolute_target_project_path",
          automatic: false,
          interactive: true,
          keep_running: true,
          stop_instruction: "exit_the_codex_session",
        },
        {
          order: 7,
          id: "review_and_trust_hooks",
          input: "/hooks",
          verification: "review_exact_hook_definition_hash_before_trust",
          trust_bypass_allowed: false,
          automatic: false,
          interactive: true,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 8,
          id: "launch_pet",
          argv: [petLauncher],
          automatic: false,
          interactive: true,
          keep_running: true,
          stop_instruction: "close_pet_or_terminate_its_foreground_process",
        },
        {
          order: 9,
          id: "submit_representative_prompt",
          target: "the_running_codex_session",
          instruction: "submit_a_representative_task_that_should_reach_a_decision_boundary",
          automatic: false,
          interactive: true,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
      ],
    },
    cleanup: {
      completeness: "partial_state_reversal_only",
      automatic: false,
      guard: {
        strategy: "locked_fail_closed_mutation_wrapper_v1",
        argv: [rotationPreflightLauncher],
        mutation_entrypoint: rotationLauncher,
        preflight_destructive: false,
        fail_closed: true,
        blocked_exit_code: 75,
        success_stdout: "blabee_rotation_preflight_ok",
        checks: [
          "active_codex_processes",
          "blabee_mcp_processes",
          "blabee_plugin_cache_process_references",
        ],
        required_before: [
          "replace_foreground_service_after_manual_stop",
          "remove_plugin",
          "remove_marketplace",
          "remove_or_replace_output_root",
        ],
        repeat_immediately_before_each_required_action: true,
        supported_launcher_lock: {
          path: "$HOME/Library/Application Support/Blabee/runtime/dogfood-rotation.lock",
          scope: "per_user_shared_across_dogfood_roots",
          mutation_holds_lock_through_completion: true,
          launchers_refuse_while_held: true,
          stale_owner_recovery: "pid_and_process_start_time_must_prove_owner_gone",
          limitations: [
            "native_or_external_launchers_can_race_after_the_process_snapshot",
            "ownerless_or_malformed_lock_requires_manual_inspection",
          ],
        },
        foreground_service_is_blocker: true,
        service_stop_mode: "manual_ctrl_c_before_guarded_mutations",
        on_blocked: "defer_rotation_without_mutation",
        preflight_terminates_processes: false,
      },
      steps: [
        {
          order: 1,
          id: "exit_codex",
          automatic: false,
          interactive: true,
          keep_running: false,
          stop_instruction: "exit_the_codex_session",
        },
        {
          order: 2,
          id: "close_pet",
          automatic: false,
          interactive: true,
          keep_running: false,
          stop_instruction: "close_pet_or_terminate_its_foreground_process",
        },
        {
          order: 3,
          id: "stop_foreground_service",
          automatic: false,
          interactive: true,
          keep_running: false,
          stop_instruction: "press_ctrl_c_in_the_service_terminal",
        },
        {
          order: 4,
          id: "disable_target_project",
          argv_prefix: projectDisableArgvPrefix,
          append_argument: "same_explicit_absolute_target_project_path",
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 5,
          id: "remove_plugin",
          argv: pluginRemoveGuardedArgv,
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 6,
          id: "remove_marketplace",
          argv: marketplaceRemoveGuardedArgv,
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
      ],
      retained_state: {
        automatically_deleted: false,
        application_support: "may_remain_after_runtime_execution",
        database: "may_remain_after_runtime_execution",
        coordinator_key_file: "may_remain_after_runtime_execution",
        keychain_item: "may_remain_after_runtime_execution",
      },
      output_root: {
        exact_path: outputRoot,
        automatically_deleted: false,
        cleanup_argv: outputRootCleanupGuardedArgv,
        raw_remove_argv_exposed: false,
        instruction: "run_only_the_pinned_rotation_cleanup_entrypoint",
      },
    },
    safety: {
      writes_limited_to_output_root: true,
      codex_home_modified: false,
      application_support_modified: false,
      applications_directory_modified: false,
      keychain_modified: false,
      launchd_modified: false,
      service_started: false,
      pet_started: false,
      automatic_failure_cleanup: false,
      failed_partial_output_preserved_for_inspection: true,
      cleanup_exact_root: outputRoot,
    },
  };
}

export async function prepareLocalDogfood({
  binaryPath,
  outputPath,
  adhocSign = true,
  compatiblePreviousApps = [],
} = {}) {
  if (adhocSign !== true) {
    fail("local dogfood must be ad-hoc signed");
  }
  const outputRoot = await resolveSafeOutputRoot(outputPath);
  await mkdir(outputRoot, { mode: 0o700 });
  await chmod(outputRoot, 0o700);

  const appPath = join(outputRoot, appRelativePath);
  const assembled = await assembleMacOSApp({
    binaryPath,
    outputPath: appPath,
    adhocSign,
    cleanupOnFailure: false,
    compatiblePreviousApps,
  });
  const packagedCoordinator = join(outputRoot, coordinatorRelativePath);
  const inspectedRuntime = await inspectSignedRuntimeIdentity({
    coordinatorBinaryPath: packagedCoordinator,
    appPath,
  });

  const marketplaceRoot = join(outputRoot, "marketplace");
  const marketplaceConfigDirectory = join(
    marketplaceRoot,
    ".agents",
    "plugins",
  );
  const marketplacePluginsDirectory = join(marketplaceRoot, "plugins");
  await mkdir(marketplaceConfigDirectory, { recursive: true, mode: 0o755 });
  await mkdir(marketplacePluginsDirectory, { mode: 0o755 });
  const marketplacePlugin = join(marketplacePluginsDirectory, "blabee");
  await copyTreeStrict(
    join(outputRoot, bundledPluginRelativePath),
    marketplacePlugin,
  );
  const marketplaceRuntimeDirectory = join(marketplacePlugin, "runtime");
  await mkdir(marketplaceRuntimeDirectory, { mode: 0o700 });
  await chmod(marketplaceRuntimeDirectory, 0o700);
  await writeNewFile(
    join(marketplaceRuntimeDirectory, "coordinator-path"),
    `${join(outputRoot, coordinatorRelativePath)}\n`,
    0o600,
  );

  const marketplaceIdentity = makeMarketplaceIdentity(outputRoot);
  const marketplaceManifest = {
    name: marketplaceIdentity.name,
    interface: {
      displayName: `Blabee Local Dogfood ${marketplaceIdentity.suffix}`,
    },
    plugins: [{
      name: "blabee",
      source: { source: "local", path: "./plugins/blabee" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
  };
  await writeNewFile(
    join(marketplaceConfigDirectory, "marketplace.json"),
    `${JSON.stringify(marketplaceManifest, null, 2)}\n`,
    0o644,
  );

  const binDirectory = join(outputRoot, "bin");
  await mkdir(binDirectory, { mode: 0o755 });
  await writeNewFile(
    join(binDirectory, "blabee-coordinator"),
    coordinatorWrapper(),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "blabee-project-settings"),
    productRuntimeWrapper(["project-settings"]),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "blabee-service"),
    productRuntimeWrapper(["service"]),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "blabee-pet"),
    productRuntimeWrapper(["pet"]),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "blabee-codex"),
    managedCodexWrapper(),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "blabee-rotation-preflight"),
    rotationPreflightWrapper(),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "blabee-rotation"),
    rotationMutationWrapper({
      outputRoot,
      pluginSelector: marketplaceIdentity.selector,
      marketplaceName: marketplaceIdentity.name,
    }),
    0o755,
  );

  const summary = makeSummary(outputRoot, {
    signed: assembled.signed,
    marketplaceIdentity,
    assemblyManifestSHA256: inspectedRuntime.assemblyManifestSHA256,
    wireRuntimeIdentity: inspectedRuntime.runtimeIdentity,
    compatiblePreviousApps: assembled.compatiblePreviousApps,
    compatiblePreviousRuntimes: assembled.manifest.compatible_previous_runtimes,
  });
  const summaryPath = join(outputRoot, "dogfood-summary.json");
  await writeNewFile(
    summaryPath,
    `${JSON.stringify(summary, null, 2)}\n`,
    0o644,
  );
  return { output: outputRoot, summaryPath, summary };
}

function parseCLIArguments(values) {
  let binaryPath;
  let outputPath;
  const compatiblePreviousApps = [];
  const adhocSign = true;
  let adhocSignFlagSeen = false;
  let help = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--adhoc-sign") {
      if (adhocSignFlagSeen) fail("--adhoc-sign may be provided only once");
      adhocSignFlagSeen = true;
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
      if (compatiblePreviousApps.length > 2) {
        fail("--compatible-previous-app may be provided at most 2 times");
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
    "  node scripts/prepare-local-dogfood.mjs --binary /absolute/path/to/blabee-coordinator --output /absolute/path/to/dogfood-root [--compatible-previous-app /absolute/path/to/Blabee.app] [--adhoc-sign]",
    "",
    "--compatible-previous-app may be repeated at most twice; raw runtime identity values are not accepted.",
    "The output parent must already exist. Preparation only writes inside a new output root.",
    "Local dogfood is always ad-hoc signed; --adhoc-sign remains as a compatibility flag.",
    "It does not install a Codex plugin, start Blabee, touch Keychain, or register launchd.",
    "On failure it preserves the exact partial output root for inspection and manual cleanup.",
  ].join("\n");
}

async function main() {
  const options = parseCLIArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await prepareLocalDogfood(options);
  process.stdout.write(`${JSON.stringify({
    output: result.output,
    summary: result.summaryPath,
  })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`blabee local dogfood preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

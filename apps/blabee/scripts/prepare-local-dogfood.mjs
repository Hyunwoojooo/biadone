#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
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

import { assembleMacOSApp } from "./build-macos-app.mjs";

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
  ];
}

function coordinatorWrapper() {
  return [
    ...wrapperPreamble(),
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
    "unset BLABEE_SOCKET",
    `exec "$BLABEE_DOGFOOD_ROOT/Blabee.app/Contents/MacOS/blabee-coordinator" ${quotedArguments}${quotedArguments ? " " : ""}"$@"`,
    "",
  ].join("\n");
}

function codexWrapper() {
  return [
    ...wrapperPreamble(),
    "unset BLABEE_SOCKET",
    'export BLABEE_COORDINATOR_BINARY="$BLABEE_DOGFOOD_ROOT/Blabee.app/Contents/MacOS/blabee-coordinator"',
    'export PATH="$BLABEE_DOGFOOD_BIN_DIR${PATH:+:$PATH}"',
    'exec codex "$@"',
    "",
  ].join("\n");
}

function makeSummary(outputRoot, { signed, marketplaceIdentity }) {
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
  const codexLauncher = join(outputRoot, "bin", "codex-with-blabee");
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
  const pluginRemoveArgv = [
    "codex",
    "plugin",
    "remove",
    marketplaceIdentity.selector,
    "--json",
  ];
  const marketplaceRemoveArgv = [
    "codex",
    "plugin",
    "marketplace",
    "remove",
    marketplaceIdentity.name,
    "--json",
  ];
  return {
    schema_version: "blabee.local-dogfood-preparation.v1",
    preparation_only: true,
    signed,
    paths: {
      output_root: outputRoot,
      app,
      coordinator,
      coordinator_shim: coordinatorShim,
      codex_launcher: codexLauncher,
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
      launch: {
        argv: [codexLauncher],
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
        plugin_remove_argv: pluginRemoveArgv,
        marketplace_remove_argv: marketplaceRemoveArgv,
      },
    },
    runtime: {
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
          argv: [codexLauncher],
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
          argv: pluginRemoveArgv,
          automatic: false,
          interactive: false,
          keep_running: false,
          stop_instruction: "not_applicable",
        },
        {
          order: 6,
          id: "remove_marketplace",
          argv: marketplaceRemoveArgv,
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
        instruction: "inspect_then_manually_remove_only_this_exact_root_when_no_process_uses_it",
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
  adhocSign = false,
} = {}) {
  const outputRoot = await resolveSafeOutputRoot(outputPath);
  await mkdir(outputRoot, { mode: 0o700 });
  await chmod(outputRoot, 0o700);

  const appPath = join(outputRoot, appRelativePath);
  const assembled = await assembleMacOSApp({
    binaryPath,
    outputPath: appPath,
    adhocSign,
    cleanupOnFailure: false,
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
    productRuntimeWrapper([]),
    0o755,
  );
  await writeNewFile(
    join(binDirectory, "codex-with-blabee"),
    codexWrapper(),
    0o755,
  );

  const summary = makeSummary(outputRoot, {
    signed: assembled.signed,
    marketplaceIdentity,
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
    if (value !== "--binary" && value !== "--output") {
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
    } else {
      if (outputPath !== undefined) fail("--output may be provided only once");
      outputPath = argument;
    }
  }
  return { binaryPath, outputPath, adhocSign, help };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/prepare-local-dogfood.mjs --binary /absolute/path/to/blabee-coordinator --output /absolute/path/to/dogfood-root [--adhoc-sign]",
    "",
    "The output parent must already exist. Preparation only writes inside a new output root.",
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

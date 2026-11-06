#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildFreshInternalDMG } from "./build-fresh-internal-dmg.mjs";
import { validateReleaseLegalDocumentsAtSourceRoot } from "./build-macos-app.mjs";
import {
  requireInternalBuildNumber,
  requireInternalDMGOutputBuildSuffix,
} from "./internal-build-number.mjs";
import { normalizeReleaseSigning } from "./release-signing.mjs";
import { verifyPublicClaudeRuntimeDirectory } from "./prepare-claude-runtime.mjs";

const maximumCompatiblePreviousApps = 2;

export async function buildReleaseDMG({
  identity,
  teamID,
  outputPath,
  buildNumber,
  compatiblePreviousApps = [],
  claudeRuntimeDirectory,
  internalClaudeSigning,
  sourceRoot,
  platform = process.platform,
} = {}, dependencies = {}) {
  if (internalClaudeSigning !== undefined) {
    throw new Error("public release cannot include internal Claude signing");
  }
  // Release builds always require an explicit certificate and team, even when
  // the caller accidentally omits every signing option.
  const releaseSigning = normalizeReleaseSigning({ identity, teamID });
  const previousApps = Array.isArray(compatiblePreviousApps)
    ? [...compatiblePreviousApps] : compatiblePreviousApps;
  if (claudeRuntimeDirectory !== undefined) await verifyPublicClaudeRuntimeDirectory(claudeRuntimeDirectory);
  // Fail before the Swift build or signing prompts. The assembler validates
  // the private staged copy again immediately before Developer ID signing.
  await validateReleaseLegalDocumentsAtSourceRoot(sourceRoot);
  return buildFreshInternalDMG({
    outputPath,
    buildNumber,
    compatiblePreviousApps: previousApps,
    releaseSigning,
    ...(claudeRuntimeDirectory === undefined ? {} : { claudeRuntimeDirectory }),
    sourceRoot,
    platform,
  }, dependencies);
}

function parseCLIArguments(values) {
  const options = { compatiblePreviousApps: [], help: false };
  const names = new Map([
    ["--identity", "identity"],
    ["--team-id", "teamID"],
    ["--output", "outputPath"],
    ["--build-number", "buildNumber"],
    ["--claude-runtime-directory", "claudeRuntimeDirectory"],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (!names.has(flag) && flag !== "--compatible-previous-app") {
      throw new Error(`unsupported argument: ${flag}`);
    }
    if (index + 1 >= values.length || values[index + 1].startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    const value = values[index + 1];
    index += 1;
    if (flag === "--compatible-previous-app") {
      options.compatiblePreviousApps.push(value);
      if (options.compatiblePreviousApps.length > maximumCompatiblePreviousApps) {
        throw new Error(`--compatible-previous-app may be provided at most ${maximumCompatiblePreviousApps} times`);
      }
    } else {
      const name = names.get(flag);
      if (options[name] !== undefined) throw new Error(`${flag} may be provided only once`);
      options[name] = value;
    }
  }
  if (!options.help) {
    for (const [flag, name] of names) {
      if (name !== "claudeRuntimeDirectory" && options[name] === undefined) throw new Error(`${flag} is required`);
    }
    normalizeReleaseSigning({ identity: options.identity, teamID: options.teamID });
    options.buildNumber = requireInternalBuildNumber(options.buildNumber, "--build-number");
    requireInternalDMGOutputBuildSuffix(options.outputPath, options.buildNumber);
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    '  npm run build:release-dmg -- --identity "Developer ID Application: Your Name (TEAMID1234)" --team-id TEAMID1234 --build-number 39 --output /absolute/path/to/Blabee-0.1.0-r39.dmg [--compatible-previous-app /absolute/path/to/Blabee.app]',
    "",
    "Builds current Swift source in a private snapshot using a full Xcode toolchain.",
    "Signs the app with Developer ID, Hardened Runtime, and a secure timestamp, then signs its DMG.",
    "An explicit Developer ID Application certificate and matching Team ID are required.",
    "Use --claude-runtime-directory /absolute/mcp-hook-runtime to bundle the verified ordinary MCP/Hook runtime; development Channels are rejected.",
    "Packaging/macos/Info.plist must contain published HTTPS BlabeeTermsURL and BlabeePrivacyURL plus a non-placeholder BlabeeLegalDocumentVersion, or explicitly set BlabeeLegalDocumentsDeferred=true with all three document keys absent.",
    "Deferred documents show optional data-sharing settings without recording legal acceptance; this is not a legal-readiness check.",
    "No ad-hoc signing fallback is used. Prebuilt --binary inputs are unsupported.",
    "The required build number is a canonical integer from 1 through 9999 matching the output -rN.dmg suffix.",
    "The signed DMG must still pass notarize:dmg before public distribution.",
  ].join("\n");
}

export const releaseDMGTesting = Object.freeze({ parseCLIArguments });

async function main() {
  const options = parseCLIArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await buildReleaseDMG(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Blabee release DMG build failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

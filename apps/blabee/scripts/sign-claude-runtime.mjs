import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { refreshClaudeRuntimeManifest, requirePublicClaudeRuntime, verifyClaudeRuntimeDirectory } from "./prepare-claude-runtime.mjs";
import { claudeNodeIdentifier, normalizeReleaseSigning, verifyDeveloperIDSignature,
  verifyEmbeddedSigningEntitlements } from "./release-signing.mjs";

const execFile = promisify(execFileCallback);

// Ad-hoc packaging is only for isolated validation, never a public fallback.
export async function signClaudeRuntimeAdhoc(directory, { runner = execFile } = {}) {
  if (typeof runner !== "function") throw new Error("Claude Node signing requires a command runner");
  await verifyClaudeRuntimeDirectory(directory);
  const node = join(directory, "node", "bin", "node");
  const options = { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" } };
  await runner("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", "--options", "runtime",
    "--identifier", "com.biadone.blabee.claude-node", "--entitlements", join(directory, "node", "Node.entitlements"), node], options);
  await runner("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", node], options);
  return refreshClaudeRuntimeManifest(directory);
}

export async function signClaudeRuntimeInternal(directory, signing, { runner = execFile } = {}) {
  return signClaudeRuntimeDeveloperID(directory, signing, { runner, internalPreview: true });
}

export async function signClaudeRuntimeRelease(directory, signing, { runner = execFile } = {}) {
  return signClaudeRuntimeDeveloperID(directory, signing, { runner, internalPreview: false });
}

async function signClaudeRuntimeDeveloperID(directory, signing, { runner, internalPreview }) {
  if (typeof runner !== "function") throw new Error("Claude Node signing requires a command runner");
  const run = (command, args, options) => runner(command, args, { ...options, timeout: 30_000 });
  const normalized = normalizeReleaseSigning(signing);
  if (normalized === null) throw new Error("Claude signing requires an explicit Developer ID identity and Team ID");
  const before = await verifyClaudeRuntimeDirectory(directory);
  if (internalPreview) {
    if (before.channel_mode !== "development-preview") throw new Error("internal Claude signing requires a development preview runtime");
  } else requirePublicClaudeRuntime(before);
  const node = join(directory, "node", "bin", "node");
  const options = { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" } };
  await run("/usr/bin/codesign", ["--force", "--sign", normalized.identity, "--options", "runtime", "--timestamp",
    "--identifier", claudeNodeIdentifier, "--entitlements", join(directory, "node", "Node.entitlements"), node], options);
  await verifyDeveloperIDSignature(node, { teamID: normalized.teamID, kind: "executable", identifier: claudeNodeIdentifier, runner: run });
  await verifyEmbeddedSigningEntitlements(node, "com.apple.security.cs.allow-jit", { runner: run });
  return refreshClaudeRuntimeManifest(directory);
}

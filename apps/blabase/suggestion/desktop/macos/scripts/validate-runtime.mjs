import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const runtimeRoot = process.argv[2];
if (!runtimeRoot) throw new Error("runtime root is required");

const root = resolve(runtimeRoot);
const manifest = JSON.parse(
  readFileSync(join(root, "manifest.json"), "utf8")
);
const exactFields = {
  contract: "blabase-launcher-runtime-manifest-v1",
  codeRootStrategy: "manifest_parent_directory",
  nodeRelativePath: "bin/node",
  agentRelativePath: "launcher-agent.mjs",
  nodeLicenseRelativePath: "LICENSE.node",
  thirdPartyNoticesRelativePath: "THIRD_PARTY_NOTICES.txt",
  defaultDataRootRelativeToHome: "Library/Application Support/Blabase",
  dataRootOverrideEnvironment: "BLABASE_LAUNCHER_DATA_ROOT",
  defaultSourceMode: "managed",
  dataRootOverrideSourceMode: "read_only",
  minimumNodeMajor: 20
};
for (const [key, expected] of Object.entries(exactFields)) {
  if (manifest[key] !== expected) {
    throw new Error(`unexpected runtime manifest field: ${key}`);
  }
}
if (
  !Array.isArray(manifest.requiredArguments) ||
  manifest.requiredArguments.length !== 2 ||
  manifest.requiredArguments[0] !== "--data-root" ||
  manifest.requiredArguments[1] !== "<absolute-data-root>"
) {
  throw new Error("unexpected runtime manifest arguments");
}

const lowerHex = (value, length) =>
  typeof value === "string" &&
  value.length === length &&
  /^[a-f0-9]+$/.test(value);
if (
  manifest.codeState === "clean_commit" ||
  manifest.codeState === "declared_commit"
) {
  if (
    !lowerHex(manifest.codeCommitSha, 40) ||
    manifest.codeFingerprintSha256 !== undefined
  ) {
    throw new Error("invalid commit provenance");
  }
} else if (manifest.codeState === "dirty_worktree") {
  if (
    manifest.codeCommitSha !== undefined ||
    !lowerHex(manifest.codeFingerprintSha256, 64)
  ) {
    throw new Error("invalid fingerprint provenance");
  }
} else {
  throw new Error("unavailable code provenance");
}

const agent = readFileSync(join(root, "launcher-agent.mjs"));
const actualAgentSha256 = createHash("sha256")
  .update(agent)
  .digest("hex");
if (
  !lowerHex(manifest.agentSha256, 64) ||
  manifest.agentSha256 !== actualAgentSha256
) {
  throw new Error("launcher agent hash mismatch");
}

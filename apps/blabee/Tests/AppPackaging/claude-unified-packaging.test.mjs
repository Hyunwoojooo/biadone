import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assembleMacOSApp } from "../../scripts/build-macos-app.mjs";
import { BLABEE_PROFILE, verifyCompiledDistributionProfile } from "../../scripts/distribution-profiles.mjs";
import { buildInternalDMG, internalDMGTesting, recoverInterruptedPublish } from "../../scripts/build-internal-dmg.mjs";
import { freshInternalDMGTesting } from "../../scripts/build-fresh-internal-dmg.mjs";
import { makeClaudeRuntimeFixture } from "./claude-runtime-fixtures.mjs";

const signing = { identity: "Developer ID Application: Blabee Test (ABCDEFGHIJ)", teamID: "ABCDEFGHIJ" };
const profileJSON = (profile = "blabee", bundle = "com.biadone.blabee") => `${JSON.stringify({
  schema_version: "blabee.distribution-profile.v1", profile_id: profile, bundle_identifier: bundle })}\n`;

test("Codex and Claude retain one app, service, Node namespace and common DMG identity", () => {
  assert.equal(BLABEE_PROFILE.bundleName, "Blabee.app");
  assert.equal(BLABEE_PROFILE.bundleIdentifier, "com.biadone.blabee");
  assert.equal(BLABEE_PROFILE.serviceLabel, "com.biadone.blabee.coordinator");
  assert.equal(BLABEE_PROFILE.nodeIdentifier, "com.biadone.blabee.claude-node");
  assert.equal(BLABEE_PROFILE.dmgIdentifier, "com.biadone.blabee.dmg");
});

test("compiled profile probe binds unified app and refuses obsolete preview relabeling", async () => {
  const calls = [];
  const runner = async (path, args, options) => { calls.push({ path, args, options }); return { stdout: profileJSON(), stderr: "" }; };
  assert.equal((await verifyCompiledDistributionProfile("/tmp/binary", { runner, requireExplicit: true })).legacy, false);
  assert.deepEqual(calls[0].args, ["distribution-profile"]);
  assert.equal(calls[0].options.timeout, 5000);
  await assert.rejects(verifyCompiledDistributionProfile("/tmp/binary", {
    runner: async () => ({ stdout: profileJSON("claude-preview", "com.biadone.blabee.claude-preview"), stderr: "" }),
  }), /does not match/u);
});

test("legacy no-Claude input compatibility never weakens explicit Claude or malformed profile validation", async () => {
  for (const runner of [
    async () => ({ stdout: "", stderr: "" }),
    async () => ({ stdout: "blabee.runtime-use-lease.v1\n", stderr: "" }),
    async () => { throw Object.assign(new Error("old command"), { code: 2, stdout: "", stderr: "unsupported command: distribution-profile" }); },
  ]) {
    assert.equal((await verifyCompiledDistributionProfile("/tmp/binary", { runner })).legacy, true);
    await assert.rejects(verifyCompiledDistributionProfile("/tmp/binary", { runner, requireExplicit: true }), /compiled Blabee/u);
  }
  for (const stdout of ["{", "{}\n", "profile_id=blabee\n", profileJSON().trim(),
    profileJSON().replace('{', '{"profile_id":"blabee",'), profileJSON().replace('"bundle_identifier"', '"extra"')]) {
    await assert.rejects(verifyCompiledDistributionProfile("/tmp/binary", { runner: async () => ({ stdout, stderr: "" }) }), /profile/u);
  }
  await assert.rejects(verifyCompiledDistributionProfile("/tmp/binary", {
    runner: async () => { throw Object.assign(new Error("timeout"), { killed: true, signal: "SIGKILL" }); },
  }), /probe failed/u);
});

test("the existing fresh internal CLI requires the complete Claude capability trio", async () => {
  const base = ["--output", "/tmp/Blabee-internal-r62.dmg", "--build-number", "62"];
  const trio = ["--claude-runtime-directory", "/runtime", "--internal-signing-identity", signing.identity, "--internal-signing-team-id", signing.teamID];
  const parsed = freshInternalDMGTesting.parseCLIArguments([...base, ...trio]);
  assert.equal(parsed.buildNumber, "62");
  assert.equal(parsed.outputPath, "/tmp/Blabee-internal-r62.dmg");
  assert.deepEqual(parsed.internalClaudeSigning, signing);
  assert.equal(parsed.claudeRuntimeDirectory, "/runtime");
  for (const partial of [trio.slice(0, 2), trio.slice(2), trio.slice(0, 4)]) {
    assert.throws(() => freshInternalDMGTesting.parseCLIArguments([...base, ...partial]));
  }
  assert.equal(Object.hasOwn(freshInternalDMGTesting.parseCLIArguments(base), "internalClaudeSigning"), false);
  await assert.rejects(buildInternalDMG({ ...parsed, releaseSigning: signing }), /public release cannot include/u);
  await assert.rejects(buildInternalDMG({ claudeRuntimeDirectory: "/runtime" }), /requires explicit Developer ID/u);
  await assert.rejects(buildInternalDMG({ internalClaudeSigning: signing }), /requires both/u);
});

test("unified publish recovery retains its original schema and rejects retired preview receipts", async t => {
  const root = await mkdtemp(join(tmpdir(), "blabee-unified-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = await internalDMGTesting.resolveOutput(join(root, "Blabee-internal-r62.dmg"));
  const lock = await internalDMGTesting.acquireOutputLock(destination);
  const workRoot = await mkdtemp(join(root, BLABEE_PROFILE.workPrefix));
  const workRootIdentity = await internalDMGTesting.captureDirectoryIdentity(workRoot, "fixture work");
  const stagedDMG = join(workRoot, "artifact.staged.dmg");
  const stagedChecksum = join(workRoot, "artifact.staged.dmg.sha256");
  const bytes = Buffer.from("isolated transaction fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(stagedDMG, bytes);
  await writeFile(stagedChecksum, `${sha256}  Blabee-internal-r62.dmg\n`);
  const receipt = await internalDMGTesting.createPublishTransaction({ destination, workRoot, workRootIdentity,
    stagedDMG, stagedChecksum, sha256, buildNumber: "62" });
  assert.equal(receipt.payload.schema_version, "blabee.internal-dmg-publish.v2");
  assert.equal(Object.hasOwn(receipt.payload, "profile_id"), false);
  assert.throws(() => internalDMGTesting.validateTransactionPayload({ ...receipt.payload,
    schema_version: "blabee.claude-preview-dmg-publish.v1", profile_id: "claude-preview" }, destination, "62"), /unsupported schema/u);
  assert.equal(JSON.parse(await readFile(destination.transaction, "utf8")).schema_version, receipt.payload.schema_version);
  assert.deepEqual(await recoverInterruptedPublish(destination, lock, { buildNumber: "62" }), { recovered: true, committed: false });
  await assert.rejects(lstat(destination.transaction), { code: "ENOENT" });
  await internalDMGTesting.releaseOutputLock(destination, lock);
});

test("both unified assembler modes reject the retired compiled profile before signing or publication", {
  skip: process.platform !== "darwin" ? "assembler requires macOS" : false,
}, async t => {
  const fixture = await makeClaudeRuntimeFixture(t, { legacy: true });
  const binary = join(fixture.root, "obsolete-binary");
  await writeFile(binary, `#!/bin/sh\nif [ "$1" = distribution-profile ]; then\n  printf '%s\\n' '${profileJSON("claude-preview", "com.biadone.blabee.claude-preview").trim()}'\nelse\n  printf 'blabee.runtime-use-lease.v1\\n'\nfi\n`, { mode: 0o755 });
  for (const includesClaude of [false, true]) {
    let signerCalls = 0;
    const outputPath = join(fixture.root, "Blabee.app");
    await assert.rejects(assembleMacOSApp({ binaryPath: binary, outputPath,
      ...(includesClaude ? { internalClaudeSigning: signing, claudeRuntimeDirectory: fixture.outputDirectory, bundleVersion: "62" } : {}) },
    { internalClaudeSigningRunner: async () => { signerCalls++; } }), /compiled distribution profile does not match/u);
    assert.equal(signerCalls, 0);
    await assert.rejects(lstat(outputPath), { code: "ENOENT" });
  }
});

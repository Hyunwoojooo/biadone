import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { assembleMacOSApp } from "../../scripts/build-macos-app.mjs";
import { macOSAppAssemblyTestSupport } from "../../scripts/build-macos-app.mjs";
const parseInternalArguments = macOSAppAssemblyTestSupport.parseCLIArguments;
import { CLAUDE_NODE_ENTITLEMENTS, verifyClaudeRuntimeDirectory } from "../../scripts/prepare-claude-runtime.mjs";
import { signClaudeRuntimeInternal } from "../../scripts/sign-claude-runtime.mjs";
import { claudeNodeIdentifier, signInternalClaudeApp, signReleaseApp,
  verifyDeveloperIDSignature, verifyEmbeddedSigningEntitlements } from "../../scripts/release-signing.mjs";
import { fixtureFile, makeClaudeRuntimeFixture } from "./claude-runtime-fixtures.mjs";

const signing = Object.freeze({ identity: "Developer ID Application: Blabee Test (ABCDEFGHIJ)", teamID: "ABCDEFGHIJ" });
const appEntitlements = new URL("../../Packaging/macos/Blabee.entitlements", import.meta.url);
const signatureDisplay = (identifier, changes = {}) => {
  const values = { Identifier: identifier, Authority: signing.identity, TeamIdentifier: signing.teamID,
    Timestamp: "Sep 21, 2026 at 12:00:00 PM", ...changes };
  return [`CodeDirectory v=20500 flags=${values.flags ?? "0x10000(runtime)"} hashes=1+7 location=embedded`,
    ...Object.entries(values).filter(([key, value]) => key !== "flags" && value !== null).map(([key, value]) => `${key}=${value}`)].join("\n");
};

async function makePreviewApp(t) {
  const fixture = await makeClaudeRuntimeFixture(t);
  const app = join(fixture.root, "Blabee.app");
  const runtime = join(app, "Contents", "Resources", "claude");
  const main = join(app, "Contents", "MacOS", "blabee-coordinator");
  await mkdir(dirname(runtime), { recursive: true });
  await cp(fixture.outputDirectory, runtime, { recursive: true });
  await fixtureFile(main, Buffer.from("cffaedfe00000000", "hex"), 0o755);
  await fixtureFile(join(app, "Contents", "Resources", "Blabee.entitlements"), await readFile(appEntitlements));
  await fixtureFile(join(app, "Contents", "Resources", "Plugin", "blabee", "scripts", "blabee-launcher"), "#!/bin/sh\nexit 0\n", 0o755);
  return { ...fixture, app, runtime, main, node: join(runtime, "node/bin/node") };
}

async function mockSigner({ node, nodeDisplay = {}, nodeEntitlements = CLAUDE_NODE_ENTITLEMENTS,
  signingFailure, onSign } = {}) {
  const calls = [];
  const appleEvents = await readFile(appEntitlements, "utf8");
  return { calls, async runner(command, args, options) {
    calls.push({ command, args, options });
    const target = args.at(-1);
    if (args.includes("--sign")) {
      if (signingFailure) throw signingFailure;
      if (target === node) await writeFile(node, Buffer.concat([await readFile(node), Buffer.from("signed-preview-fixture")]));
      await onSign?.(target);
    }
    if (args.includes("--entitlements") && args.includes("--display")) return { stdout: target === node ? nodeEntitlements : appleEvents, stderr: "" };
    if (args.includes("--display")) return { stdout: "", stderr: signatureDisplay(target === node ? claudeNodeIdentifier : "com.biadone.blabee", target === node ? nodeDisplay : {}) };
    return { stdout: "", stderr: "" };
  } };
}

test("internal Claude admission requires explicit runtime/version and mutually exclusive signing mode", async () => {
  for (const modes of [
    { adhocSign: true, internalClaudeSigning: signing },
    { releaseSigning: signing, internalClaudeSigning: signing },
    { adhocSign: true, releaseSigning: signing, internalClaudeSigning: signing },
  ]) await assert.rejects(assembleMacOSApp(modes), /cannot be combined/u);
  for (const options of [
    {}, { claudeRuntimeDirectory: "/runtime" }, { claudeRuntimeDirectory: "/runtime", bundleVersion: undefined },
    { bundleVersion: "42" },
  ]) await assert.rejects(assembleMacOSApp({ ...options, internalClaudeSigning: signing }), /explicit Claude runtime directory and bundle version/u);
});

test("internal Claude CLI requires six explicit arguments and cannot request general release or ad-hoc modes", () => {
  const args = ["--binary", "/binary", "--output", "/output/Blabee.app", "--claude-runtime-directory", "/runtime",
    "--bundle-version", "42", "--internal-signing-identity", signing.identity, "--internal-signing-team-id", signing.teamID];
  const options = parseInternalArguments(args);
  assert.deepEqual(options, { binaryPath: "/binary", outputPath: "/output/Blabee.app", claudeRuntimeDirectory: "/runtime",
    bundleVersion: "42", internalClaudeSigning: signing, adhocSign: false, help: false, compatiblePreviousApps: [] });
  for (const invalid of [args.slice(0, -2), [...args, "--adhoc-sign"], [...args, "--release-signing", signing.identity],
    [...args, "--bundle-version", "43"], args.map(value => value === "42" ? "0042" : value)]) {
    assert.throws(() => parseInternalArguments(invalid));
  }
});

test("internal Node signing uses Developer ID, verifies chain/identity/runtime/time/allow-jit, then reseals only staging", async t => {
  const fixture = await makePreviewApp(t);
  const sourceNode = await readFile(join(fixture.outputDirectory, "node/bin/node"));
  const sourceManifest = await readFile(join(fixture.outputDirectory, "manifest.json"));
  const captured = await mockSigner(fixture);
  const signed = await signClaudeRuntimeInternal(fixture.runtime, signing, captured);
  assert.notEqual(signed.payload_digest, fixture.manifest.payload_digest);
  assert.deepEqual(await readFile(join(fixture.outputDirectory, "node/bin/node")), sourceNode);
  assert.deepEqual(await readFile(join(fixture.outputDirectory, "manifest.json")), sourceManifest);
  assert.deepEqual(captured.calls[0].args, ["--force", "--sign", signing.identity, "--options", "runtime", "--timestamp",
    "--identifier", claudeNodeIdentifier, "--entitlements", join(fixture.runtime, "node/Node.entitlements"), fixture.node]);
  assert.equal(captured.calls.some(call => call.args.includes("--deep")), false);
  assert.match(captured.calls[1].args[captured.calls[1].args.indexOf("--test-requirement") + 1], /anchor apple generic.*subject\.OU\] = "ABCDEFGHIJ"/u);
  assert.deepEqual(captured.calls.at(-1).args, ["--display", "--entitlements", "-", "--xml", fixture.node]);
  assert.deepEqual(await verifyClaudeRuntimeDirectory(fixture.runtime), signed);
});

test("internal app signer verifies the exact Node first and keeps general release nested-code rejection", async t => {
  const fixture = await makePreviewApp(t);
  const captured = await mockSigner(fixture);
  await assert.rejects(signReleaseApp(fixture.app, signing, { ...captured, internalClaude: true }), /unsupported executable code|public release/u);
  assert.equal(captured.calls.length, 0);
  await signClaudeRuntimeInternal(fixture.runtime, signing, captured);
  const signedDigest = (await verifyClaudeRuntimeDirectory(fixture.runtime)).payload_digest;
  captured.calls.length = 0;
  const signature = await signInternalClaudeApp(fixture.app, signing, captured);
  assert.equal(signature.team_id, signing.teamID);
  assert.equal(captured.calls[0].args.at(-1), fixture.node);
  const enclosing = captured.calls.findIndex(call => call.args.includes("--sign"));
  assert.equal(enclosing, 3);
  assert.equal(captured.calls[enclosing].args.at(-1), fixture.app);
  assert.equal(captured.calls[enclosing].args.includes("--deep"), false);
  assert.equal(captured.calls.at(-1).args.at(-1), fixture.app);
  assert.equal((await verifyClaudeRuntimeDirectory(fixture.runtime)).payload_digest, signedDigest);
});

for (const [name, changes, expected] of [
  ["foreign team", { TeamIdentifier: "ZZZZZZZZZZ" }, /Team ID/u],
  ["wrong identifier", { Identifier: "com.example.node" }, /identifier/u],
  ["wrong authority", { Authority: "Apple Development: Blabee Test (ABCDEFGHIJ)" }, /Developer ID/u],
  ["missing timestamp", { Timestamp: null }, /Timestamp/u],
  ["non-hardened", { flags: "0x0(none)" }, /Hardened Runtime/u],
]) {
  test(`internal app refuses ${name} Node before enclosing signing`, async t => {
    const fixture = await makePreviewApp(t);
    const captured = await mockSigner({ ...fixture, nodeDisplay: changes });
    await assert.rejects(signInternalClaudeApp(fixture.app, signing, captured), expected);
    assert.equal(captured.calls.some(call => call.args.includes("--sign")), false);
  });
}

test("expanded, duplicate, false and entity-containing embedded entitlements are denied", async () => {
  for (const xml of [
    CLAUDE_NODE_ENTITLEMENTS.replace("</dict>", "<key>com.apple.security.automation.apple-events</key><true/></dict>"),
    CLAUDE_NODE_ENTITLEMENTS.replace("</dict>", "<key>com.apple.security.cs.allow-jit</key><true/></dict>"),
    CLAUDE_NODE_ENTITLEMENTS.replace("<true/>", "<false/>"),
    CLAUDE_NODE_ENTITLEMENTS.replace("allow-jit", "allow&#45;jit"),
  ]) await assert.rejects(verifyEmbeddedSigningEntitlements("/tmp/node", "com.apple.security.cs.allow-jit", {
    runner: async () => ({ stdout: xml }),
  }), /must contain only/u);
});

test("internal app denies expanded Node entitlements and arbitrary nested code before app signing", async t => {
  for (const variant of ["entitlements", "mach-o", "script", "bundle"]) {
    await t.test(variant, async subtest => {
      const fixture = await makePreviewApp(subtest);
      const captured = await mockSigner({ ...fixture, nodeEntitlements: variant === "entitlements"
        ? CLAUDE_NODE_ENTITLEMENTS.replace("</dict>", "<key>extra</key><true/></dict>") : CLAUDE_NODE_ENTITLEMENTS });
      const unexpected = join(fixture.app, "Contents", "Resources", "extra");
      if (variant === "mach-o") await fixtureFile(unexpected, Buffer.from("cffaedfe00000000", "hex"));
      if (variant === "script") await fixtureFile(unexpected, "#!/bin/sh\n", 0o755);
      if (variant === "bundle") await mkdir(`${unexpected}.app`);
      await assert.rejects(signInternalClaudeApp(fixture.app, signing, captured), /must contain only|unsupported executable code|unsupported nested code/u);
      assert.equal(captured.calls.some(call => call.args.includes("--sign")), false);
    });
  }
});

test("Node signing or trust failure never falls back or rewrites the descriptor", async t => {
  const fixture = await makePreviewApp(t);
  const descriptor = await readFile(join(fixture.runtime, "manifest.json"));
  const captured = await mockSigner({ ...fixture, signingFailure: new Error("User interaction is not allowed.") });
  await assert.rejects(signClaudeRuntimeInternal(fixture.runtime, signing, captured), /User interaction/u);
  assert.equal(captured.calls.length, 1);
  assert.equal(captured.calls[0].args.includes("-"), false);
  assert.deepEqual(await readFile(join(fixture.runtime, "manifest.json")), descriptor);
  await assert.rejects(verifyDeveloperIDSignature(fixture.node, { kind: "executable", identifier: claudeNodeIdentifier,
    teamID: signing.teamID, runner: async () => { throw new Error("trusted chain failed"); } }), /trusted chain/u);
});

test("enclosing signing cannot modify the previously sealed Node runtime", async t => {
  const fixture = await makePreviewApp(t);
  const captured = await mockSigner({ ...fixture, onSign: async target => {
    if (target === fixture.app) await writeFile(fixture.node, Buffer.concat([await readFile(fixture.node), Buffer.from("unexpected") ]));
  } });
  await assert.rejects(signInternalClaudeApp(fixture.app, signing, captured), /digest mismatch/u);
});

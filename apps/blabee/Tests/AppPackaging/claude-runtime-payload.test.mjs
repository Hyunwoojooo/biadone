import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, lstat, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalClaudeRuntimeJSON, CLAUDE_NODE_ENTITLEMENTS, CLAUDE_RUNTIME_LIMITS,
  prepareClaudeRuntime, refreshClaudeRuntimeManifest, verifyClaudeRuntimeDirectory,
} from "../../scripts/prepare-claude-runtime.mjs";
import { signClaudeRuntimeAdhoc } from "../../scripts/sign-claude-runtime.mjs";
import { fixtureFile, makeClaudeRuntimeFixture } from "./claude-runtime-fixtures.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
async function rewriteManifest(directory, mutate) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  mutate(manifest);
  const { payload_digest, ...body } = manifest;
  manifest.payload_digest = `sha256:${digest(canonicalClaudeRuntimeJSON(body))}`;
  await writeFile(join(directory, "manifest.json"), `${canonicalClaudeRuntimeJSON(manifest)}\n`);
}

test("prepares deterministic, indexed runtime with licenses and only explicit Node executable", async t => {
  const fixture = await makeClaudeRuntimeFixture(t);
  const second = await prepareClaudeRuntime({ ...fixture.options, outputDirectory: join(fixture.root, "runtime-two") });
  assert.deepEqual(second.manifest, fixture.manifest);
  assert.equal(fixture.manifest.channel_mode, "development-preview");
  assert.match(fixture.manifest.payload_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(fixture.manifest.files.filter(file => file.executable).length, 1);
  assert.equal(fixture.manifest.files.find(file => file.executable).path, "node/bin/node");
  assert.equal(fixture.manifest.files.some(file => /unrelated|ignored|README|product-mcp/u.test(file.path)), false);
  assert.equal(fixture.manifest.files.filter(file => /\/(?:LICENSE|license)$/u.test(file.path)).length, 10);
  for (const file of fixture.manifest.files) {
    const path = join(fixture.outputDirectory, file.path);
    assert.equal(digest(await readFile(path)), file.sha256);
    assert.equal((await lstat(path)).nlink, 1);
    assert.equal((await lstat(path)).mode & 0o7777, file.executable ? 0o755 : 0o644);
  }
  await assert.rejects(prepareClaudeRuntime(fixture.options), /EEXIST/u);
  assert.deepEqual(await verifyClaudeRuntimeDirectory(fixture.outputDirectory), fixture.manifest);
});

test("rejects unpinned versions, missing Node license, mismatched architecture and dependency versions", async t => {
  const fixture = await makeClaudeRuntimeFixture(t, { prepared: false });
  await assert.rejects(prepareClaudeRuntime({ ...fixture.options, nodeVersion: "22.0.0" }), /pinned/u);
  await assert.rejects(prepareClaudeRuntime({ ...fixture.options, nodeLicensePath: undefined }), /explicit/u);
  await assert.rejects(prepareClaudeRuntime({ ...fixture.options, nodeArch: "x64" }), /architecture|node_arch/u);
  await fixtureFile(join(fixture.bridgeRoot, "node_modules", "ajv", "package.json"), '{"name":"ajv","version":"8.0.0"}');
  await assert.rejects(prepareClaudeRuntime(fixture.options), /version mismatch/u);
  await assert.rejects(lstat(fixture.outputDirectory), { code: "ENOENT" });
});

test("preparation refuses linked source files and preserves existing caller-owned output", async t => {
  const fixture = await makeClaudeRuntimeFixture(t, { prepared: false });
  const source = join(fixture.bridgeRoot, "src/session-v2-hook.mjs");
  const external = join(fixture.root, "other-source.mjs");
  await fixtureFile(external, "export {};\n");
  await rm(source);
  await link(external, source);
  await assert.rejects(prepareClaudeRuntime(fixture.options), /regular file/u);
  await rm(source);
  await symlink(external, source);
  await assert.rejects(prepareClaudeRuntime(fixture.options), /symlink/u);
  await rm(source);
  await fixtureFile(source, "export {};\n");
  await fixtureFile(join(fixture.outputDirectory, "sentinel"), "caller-owned\n");
  await assert.rejects(prepareClaudeRuntime(fixture.options), /EEXIST/u);
  assert.equal(await readFile(join(fixture.outputDirectory, "sentinel"), "utf8"), "caller-owned\n");
});

for (const mutation of ["unknown-file", "unknown-directory", "tampered-source", "script-executable", "node-mode", "symlink", "hardlink"]) {
  test(`qualified runtime rejects ${mutation}`, async t => {
    const fixture = await makeClaudeRuntimeFixture(t);
    const source = join(fixture.outputDirectory, "payload/src/session-v2-mcp.mjs");
    if (mutation === "unknown-file") await fixtureFile(join(fixture.outputDirectory, "payload/.env"), "unexpected\n");
    if (mutation === "unknown-directory") await fixtureFile(join(fixture.outputDirectory, "extra/file"), "unexpected\n");
    if (mutation === "tampered-source") await writeFile(source, "changed\n");
    if (mutation === "script-executable") await chmod(source, 0o755);
    if (mutation === "node-mode") await chmod(join(fixture.outputDirectory, "node/bin/node"), 0o644);
    if (mutation === "symlink") { await rm(source); await symlink(join(fixture.bridgeRoot, "src/session-v2-mcp.mjs"), source); }
    if (mutation === "hardlink") { await rm(source); await link(join(fixture.bridgeRoot, "src/session-v2-mcp.mjs"), source); }
    await assert.rejects(verifyClaudeRuntimeDirectory(fixture.outputDirectory), /Claude runtime/u);
  });
}

test("manifest rejects unqualified mode, unknown keys, duplicates, unsorted paths and byte bounds", async t => {
  const fixture = await makeClaudeRuntimeFixture(t);
  const original = await readFile(join(fixture.outputDirectory, "manifest.json"));
  for (const mutate of [
    value => { value.channel_mode = "approved-plugin"; },
    value => { value.extra = true; },
    value => { value.files.reverse(); },
    value => { value.files.push(value.files[0]); },
    value => { value.files[0].size = CLAUDE_RUNTIME_LIMITS.fileBytes + 1; },
    value => { value.node_arch = "x64"; },
  ]) {
    await writeFile(join(fixture.outputDirectory, "manifest.json"), original);
    await rewriteManifest(fixture.outputDirectory, mutate);
    await assert.rejects(verifyClaudeRuntimeDirectory(fixture.outputDirectory), /Claude runtime/u);
  }
  const text = original.toString("utf8").replace('"channel_mode":"development-preview"', '"channel_mode":"development-preview","channel_mode":"development-preview"');
  await writeFile(join(fixture.outputDirectory, "manifest.json"), text);
  await assert.rejects(verifyClaudeRuntimeDirectory(fixture.outputDirectory), /canonical/u);
});

test("reseal accepts only Node byte changes and indexes the newly signed bytes", async t => {
  const fixture = await makeClaudeRuntimeFixture(t);
  const nodePath = join(fixture.outputDirectory, "node/bin/node");
  const signedBytes = Buffer.concat([await readFile(nodePath), Buffer.from("fixture-signature")]);
  await writeFile(nodePath, signedBytes);
  await assert.rejects(verifyClaudeRuntimeDirectory(fixture.outputDirectory), /digest/u);
  const updated = await refreshClaudeRuntimeManifest(fixture.outputDirectory);
  assert.notEqual(updated.payload_digest, fixture.manifest.payload_digest);
  assert.equal(updated.files.find(file => file.path === "node/bin/node").sha256, digest(signedBytes));
  assert.deepEqual(updated.files.filter(file => file.path !== "node/bin/node"), fixture.manifest.files.filter(file => file.path !== "node/bin/node"));
  await writeFile(join(fixture.outputDirectory, "payload/src/session-v2-hook.mjs"), "tampered\n");
  await assert.rejects(refreshClaudeRuntimeManifest(fixture.outputDirectory), /digest/u);
});

test("Node signing uses separate allow-jit policy then verifies and reseals without Apple events", async t => {
  const fixture = await makeClaudeRuntimeFixture(t);
  const calls = [];
  const result = await signClaudeRuntimeAdhoc(fixture.outputDirectory, { runner: async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("--sign")) {
      const path = args.at(-1);
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("signed") ]));
    }
    return { stdout: "", stderr: "" };
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "/usr/bin/codesign");
  assert.deepEqual(calls[0].args.slice(0, 7), ["--force", "--sign", "-", "--timestamp=none", "--options", "runtime", "--identifier"]);
  assert.equal(calls[0].args.at(-2), join(fixture.outputDirectory, "node/Node.entitlements"));
  assert.equal(calls[1].args[0], "--verify");
  assert.equal(calls[0].options.timeout, 30_000);
  assert.equal(await readFile(join(fixture.outputDirectory, "node/Node.entitlements"), "utf8"), CLAUDE_NODE_ENTITLEMENTS);
  assert.equal(CLAUDE_NODE_ENTITLEMENTS.includes("apple-events"), false);
  assert.notEqual(result.payload_digest, fixture.manifest.payload_digest);
});

test("signing failures do not rewrite the descriptor", async t => {
  const fixture = await makeClaudeRuntimeFixture(t);
  const before = await readFile(join(fixture.outputDirectory, "manifest.json"));
  await assert.rejects(signClaudeRuntimeAdhoc(fixture.outputDirectory, { runner: async () => { throw new Error("signing denied"); } }), /signing denied/u);
  assert.deepEqual(await readFile(join(fixture.outputDirectory, "manifest.json")), before);
});

test("installed dependency subset loads fixed and automatic Hook/MCP entrypoints without checkout imports", async t => {
  const fixture = await makeClaudeRuntimeFixture(t, { prepared: false });
  const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../bridges/claude");
  const result = await prepareClaudeRuntime({ ...fixture.options, bridgeRoot });
  assert.ok(result.manifest.files.length < 600);
  for (const name of ["session-v2-hook.mjs", "session-v2-mcp.mjs", "auto-connect-hook.mjs", "auto-connect-mcp.mjs"]) {
    const module = await import(pathToFileURL(join(result.outputDirectory, "payload/src", name)).href);
    assert.ok(Object.keys(module).length > 0);
  }
});

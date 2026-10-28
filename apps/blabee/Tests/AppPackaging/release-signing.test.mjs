import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assembleMacOSApp } from "../../scripts/build-macos-app.mjs";
import {
  appSigningEntitlementsFileName,
  normalizeReleaseSigning,
  signReleaseApp,
  signReleaseDMG,
  verifyDeveloperIDSignature,
} from "../../scripts/release-signing.mjs";

const canonicalEntitlements = new URL("../../Packaging/macos/Blabee.entitlements", import.meta.url);

const signing = Object.freeze({
  identity: "Developer ID Application: Blabee Test (ABCDEFGHIJ)",
  teamID: "ABCDEFGHIJ",
});

function display({
  kind = "app",
  teamID = signing.teamID,
  authority = signing.identity,
  timestamp = "Sep 12, 2026 at 12:00:00 PM",
  identifier = kind === "app" ? "com.biadone.blabee" : "com.biadone.blabee.dmg",
  flags = kind === "app" ? "0x10000(runtime)" : "0x0(none)",
  extra = [],
} = {}) {
  return [
    `Identifier=${identifier}`,
    `CodeDirectory v=20500 size=100 flags=${flags} hashes=1+7 location=embedded`,
    `Authority=${authority}`,
    "Authority=Developer ID Certification Authority",
    "Authority=Apple Root CA",
    ...(timestamp === null ? [] : [`Timestamp=${timestamp}`]),
    `TeamIdentifier=${teamID}`,
    ...extra,
  ].join("\n");
}

function captureRunner(details = display(), failure = null) {
  const calls = [];
  return {
    calls,
    async runner(file, args, options) {
      calls.push({ file, args: [...args], options });
      if (failure !== null) throw failure;
      return { stdout: "", stderr: args.includes("--display") ? details : "" };
    },
  };
}

async function makeApp(t) {
  const root = await mkdtemp(join(tmpdir(), "blabee-release-signing-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "Blabee.app");
  const main = join(app, "Contents", "MacOS", "blabee-coordinator");
  const launcher = join(app, "Contents", "Resources", "Plugin", "blabee", "scripts", "blabee-launcher");
  await mkdir(dirname(main), { recursive: true });
  await mkdir(dirname(launcher), { recursive: true });
  await writeFile(main, Buffer.from("cffaedfe00000000", "hex"), { mode: 0o755 });
  await writeFile(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await copyFile(canonicalEntitlements, join(app, "Contents", "Resources", appSigningEntitlementsFileName));
  return { root, app, main, launcher };
}

test("release signing requires a matching Developer ID Application identity and immutable Team ID", () => {
  const input = { ...signing };
  const normalized = normalizeReleaseSigning(input);
  input.identity = "-";
  input.teamID = "ZZZZZZZZZZ";
  assert.deepEqual(normalized, signing);
  assert.ok(Object.isFrozen(normalized));
  assert.equal(normalizeReleaseSigning(null), null);
  assert.equal(normalizeReleaseSigning(undefined), null);
  for (const value of [
    false, [], {}, { teamID: signing.teamID }, { identity: signing.identity },
    { ...signing, identity: "-" },
    { ...signing, identity: "Developer ID Installer: Blabee Test (ABCDEFGHIJ)" },
    { ...signing, identity: `${signing.identity}\n` },
    { ...signing, teamID: "abc" },
    { ...signing, teamID: "ZZZZZZZZZZ" },
    { ...signing, adhoc: true },
  ]) {
    assert.throws(() => normalizeReleaseSigning(value));
  }
});

test("assembler rejects simultaneous ad-hoc and Developer ID modes before filesystem work", async () => {
  await assert.rejects(assembleMacOSApp({
    adhocSign: true,
    releaseSigning: signing,
  }), /cannot be combined/u);
});

test("app signing uses secure timestamp and Hardened Runtime, then verifies the Apple certificate chain", async (t) => {
  const { app } = await makeApp(t);
  const captured = captureRunner();
  const verified = await signReleaseApp(app, signing, captured);
  assert.deepEqual(captured.calls[0].args, [
    "--force", "--sign", signing.identity, "--options", "runtime", "--timestamp",
    "--entitlements", join(app, "Contents", "Resources", appSigningEntitlementsFileName), app,
  ]);
  assert.equal(captured.calls[0].file, "/usr/bin/codesign");
  assert.equal(captured.calls[0].args.includes("--deep"), false);
  assert.equal(captured.calls[0].args.includes("--timestamp=none"), false);
  const verification = captured.calls[1].args;
  assert.ok(verification.includes("--deep"));
  assert.ok(verification.includes("--strict"));
  const requirement = verification[verification.indexOf("--test-requirement") + 1];
  assert.match(requirement, /^=anchor apple generic and /u);
  assert.match(requirement, /certificate 1\[field\.1\.2\.840\.113635\.100\.6\.2\.6\] exists/u);
  assert.match(requirement, /certificate leaf\[field\.1\.2\.840\.113635\.100\.6\.1\.13\] exists/u);
  assert.match(requirement, /certificate leaf\[subject\.OU\] = "ABCDEFGHIJ"$/u);
  assert.equal(captured.calls[2].args[0], "--display");
  assert.equal(verified.team_id, signing.teamID);
  assert.equal(verified.hardened_runtime, true);
});

test("DMG signing uses the release identifier and requires a timestamp without app runtime flags", async () => {
  const captured = captureRunner(display({ kind: "dmg" }));
  const verified = await signReleaseDMG("/tmp/Blabee.dmg", signing, captured);
  assert.deepEqual(captured.calls[0].args, [
    "--force", "--sign", signing.identity, "--timestamp", "--identifier", "com.biadone.blabee.dmg", "/tmp/Blabee.dmg",
  ]);
  assert.equal(captured.calls[1].args.includes("--deep"), false);
  assert.equal(captured.calls[0].args.includes("--entitlements"), false);
  assert.equal(verified.kind, "dmg");
  assert.equal(verified.identifier, "com.biadone.blabee.dmg");
  assert.equal(verified.hardened_runtime, false);
});

test("app signing refuses missing or expanded entitlements before invoking codesign", async (t) => {
  for (const kind of ["missing", "expanded", "symlink"]) {
    await t.test(kind, async (subtest) => {
      const { app } = await makeApp(subtest);
      const path = join(app, "Contents", "Resources", appSigningEntitlementsFileName);
      if (kind === "expanded") {
        const source = await readFile(path, "utf8");
        await writeFile(path, source.replace("</dict>", "<key>com.apple.security.cs.disable-library-validation</key><true/></dict>"));
      } else {
        await rm(path);
        if (kind === "symlink") await symlink(canonicalEntitlements, path);
      }
      const captured = captureRunner();
      await assert.rejects(signReleaseApp(app, signing, captured));
      assert.deepEqual(captured.calls, []);
    });
  }
});

test("signature verification rejects ad-hoc, foreign team, missing timestamp, wrong authority, and missing app runtime", async (t) => {
  for (const [name, options, message] of [
    ["ad-hoc", { extra: ["Signature=adhoc"] }, /must not be ad-hoc/u],
    ["foreign team", { teamID: "ZZZZZZZZZZ" }, /Team ID does not match/u],
    ["missing timestamp", { timestamp: null, extra: ["Signed Time=Sep 12, 2026"] }, /one Timestamp field/u],
    ["empty timestamp", { timestamp: "" }, /secure timestamp/u],
    ["invalid timestamp", { timestamp: "none" }, /secure timestamp/u],
    ["wrong authority", { authority: "Apple Development: Blabee Test (ABCDEFGHIJ)" }, /Developer ID Application authority/u],
    ["missing runtime", { flags: "0x0(none)" }, /Hardened Runtime/u],
    ["wrong identifier", { identifier: "com.other.app" }, /identifier does not match/u],
    ["duplicate team", { extra: [`TeamIdentifier=${signing.teamID}`] }, /one TeamIdentifier field/u],
  ]) {
    await t.test(name, async () => {
      const captured = captureRunner(display(options));
      await assert.rejects(verifyDeveloperIDSignature("/tmp/Blabee.app", {
        teamID: signing.teamID, runner: captured.runner,
      }), message);
    });
  }
});

test("a failed trusted-chain requirement is fatal and never accepted through displayed metadata", async () => {
  const captured = captureRunner(display(), new Error("code failed to satisfy specified code requirement(s)"));
  await assert.rejects(verifyDeveloperIDSignature("/tmp/Blabee.app", {
    teamID: signing.teamID, runner: captured.runner,
  }), /failed to satisfy/u);
  assert.equal(captured.calls.length, 1);
  assert.equal(captured.calls[0].args.includes("--display"), false);
});

test("signature verification rejects malformed options without invoking codesign", async () => {
  const captured = captureRunner();
  for (const [path, options] of [
    ["Blabee.app", { teamID: signing.teamID }],
    ["/tmp/Blabee.app\0", { teamID: signing.teamID }],
    ["/tmp/Blabee.app", { teamID: 'ABCDEFGHIJ" or true' }],
    ["/tmp/Blabee.app", { teamID: signing.teamID, kind: "installer" }],
    ["/tmp/Blabee.app", { teamID: signing.teamID, identifier: "" }],
  ]) {
    await assert.rejects(verifyDeveloperIDSignature(path, { ...options, runner: captured.runner }));
  }
  assert.deepEqual(captured.calls, []);
});

test("release signing does not fall back to ad-hoc when the private key is unavailable", async () => {
  const captured = captureRunner(display({ kind: "dmg" }), new Error("User interaction is not allowed."));
  await assert.rejects(signReleaseDMG("/tmp/Blabee.dmg", signing, captured), /User interaction is not allowed/u);
  assert.equal(captured.calls.length, 1);
  assert.equal(captured.calls[0].args.includes("-"), false);
});

test("release signing rejects unknown Mach-O code even when its executable permission is absent", async (t) => {
  const { app } = await makeApp(t);
  const injected = join(app, "Contents", "Resources", "extra.dat");
  await writeFile(injected, Buffer.from("cffaedfe00000000", "hex"), { mode: 0o644 });
  const captured = captureRunner();
  await assert.rejects(signReleaseApp(app, signing, captured), /unsupported executable code/u);
  assert.deepEqual(captured.calls, []);
});

test("new nested bundles require an explicit signing plan", async (t) => {
  const { app } = await makeApp(t);
  await mkdir(join(app, "Contents", "Resources", "Helper.app"));
  const captured = captureRunner();
  await assert.rejects(signReleaseApp(app, signing, captured), /unsupported nested code/u);
  assert.deepEqual(captured.calls, []);
});

test("release app layout rejects unsupported executable scripts and symlinks", async (t) => {
  for (const kind of ["script", "symlink"]) {
    await t.test(kind, async (subtest) => {
      const { app, main } = await makeApp(subtest);
      const injected = join(app, "Contents", "Resources", "helper");
      if (kind === "script") {
        await writeFile(injected, "#!/bin/sh\nexit 0\n");
        await chmod(injected, 0o755);
      } else {
        await symlink(main, injected);
      }
      const captured = captureRunner();
      await assert.rejects(signReleaseApp(app, signing, captured), /unsupported executable code|must not contain a symlink/u);
      assert.deepEqual(captured.calls, []);
    });
  }
});

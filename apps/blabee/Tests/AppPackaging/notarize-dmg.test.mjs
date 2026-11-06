import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { internalClaudeNotice } from "../../scripts/build-internal-dmg.mjs";
import { notarizeDMG, parseNotarizeArguments, verifyInternalPreviewDMGPayload, verifyPublicDMGPayload } from "../../scripts/notarize-dmg.mjs";

const submissionID = "12345678-1234-1234-1234-123456789abc";
const teamID = "VN7AMDG677";
const originalBytes = "signed release DMG contents";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "blabee-notarization-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dmgPath = join(root, "Blabee-0.1.0-build.39.dmg");
  const checksum = `${sha256(originalBytes)}  ${basename(dmgPath)}\n`;
  await writeFile(dmgPath, originalBytes);
  await writeFile(`${dmgPath}.sha256`, checksum);
  const control = { status: "Accepted", logSHA: sha256(originalBytes) };
  const calls = [];
  const json = (value) => ({ stdout: JSON.stringify(value), stderr: "" });
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    if (control.beforeRun) await control.beforeRun(file, args, options);
    if (args[0] === "notarytool") {
      assert.equal(file, "/usr/bin/xcrun");
      assert.equal(args[args.indexOf("--keychain-profile") + 1], "blabee-notary");
      assert.equal(args.includes("--password"), false);
      assert.equal(args.includes("--apple-id"), false);
      if (args[1] === "submit") {
        assert.ok(args.includes("--no-wait"));
        if (control.submitError) throw control.submitError;
        return json({ id: submissionID, message: "Successfully uploaded file" });
      }
      assert.equal(args[2], submissionID);
      if (args[1] === "wait") {
        assert.equal(args[args.indexOf("--timeout") + 1], "45s");
        if (control.waitError) throw control.waitError;
        return json({ id: submissionID, status: control.status });
      }
      if (args[1] === "info") return json({ id: submissionID, status: control.status });
      if (args[1] === "log") return json({ jobId: submissionID.toUpperCase(), status: control.status, sha256: control.logSHA, issues: control.status === "Invalid" ? [{ severity: "error" }] : [] });
    }
    if (args[0] === "stapler") {
      assert.equal(file, "/usr/bin/xcrun");
      if (args[1] === "staple") {
        assert.notEqual(args[2], dmgPath, "the submitted DMG is preserved until candidate validation succeeds");
        assert.equal(await readFile(dmgPath, "utf8"), originalBytes);
        assert.equal(await readFile(`${dmgPath}.sha256`, "utf8"), checksum);
        await appendFile(args[2], " with stapled ticket");
        if (control.stapleError) throw new Error("staple failed after changing the candidate");
        return { stdout: "The staple and validate action worked!", stderr: "" };
      }
      if (control.validateError) throw new Error("ticket validation failed");
      return { stdout: "The validate action worked!", stderr: "" };
    }
    if (file === "/usr/sbin/spctl") {
      assert.deepEqual(args.slice(0, -1), ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2"]);
      if (control.gatekeeperError) throw new Error("Gatekeeper rejected candidate");
      return { stdout: "", stderr: "accepted\nsource=Notarized Developer ID" };
    }
    throw new Error(`unexpected command ${file} ${args.join(" ")}`);
  };
  const signatureVerifier = async (path, options) => {
    calls.push({ verify: path });
    assert.equal(options.teamID, teamID);
    assert.equal(options.kind, "dmg");
    assert.equal(options.identifier, "com.biadone.blabee.dmg");
    assert.equal(options.runner, runner);
    if (control.signatureError) throw new Error("invalid Developer ID signature");
    return { kind: "dmg", team_id: teamID, identifier: options.identifier, timestamp: "secure timestamp", hardened_runtime: false };
  };
  const publicPayloadVerifier = async (path, options) => {
    calls.push({ payload: path });
    assert.equal(path, dmgPath);
    assert.equal(options.teamID, teamID);
    await control.beforePayload?.();
    if (control.payloadError) throw control.payloadError;
  };
  const internalPreviewPayloadVerifier = async (path, options) => {
    calls.push({ internalPayload: path });
    assert.equal(path, dmgPath);
    assert.equal(options.teamID, teamID);
    await control.beforePayload?.();
    if (control.payloadError) throw control.payloadError;
    return { distribution_mode: "internal-preview", claude_channel_mode: "development-preview", public_distribution_ready: false };
  };
  const options = { dmgPath, teamID, platform: "darwin", keychainPath: join(root, "login.keychain-db"), runner, signatureVerifier, publicPayloadVerifier, internalPreviewPayloadVerifier };
  return {
    root, dmgPath, control, calls, options, checksum,
    run: (overrides = {}) => notarizeDMG({ ...options, ...overrides }),
    state: async () => JSON.parse(await readFile(`${dmgPath}.notarization.json`, "utf8")),
    submissions: () => calls.filter((call) => call.args?.[0] === "notarytool" && call.args[1] === "submit"),
    assertOriginal: async () => {
      assert.equal(await readFile(dmgPath, "utf8"), originalBytes);
      assert.equal(await readFile(`${dmgPath}.sha256`, "utf8"), checksum);
    },
  };
}

test("Accepted notarization validates the stapled candidate and publishes the final checksum", async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.phase, "complete");
  assert.equal(result.status, "Accepted");
  assert.equal(result.submission_id, submissionID);
  assert.equal(result.submitted_sha256, sha256(originalBytes));
  assert.equal(result.final_sha256, sha256(`${originalBytes} with stapled ticket`));
  assert.equal(result.notarized, true);
  assert.equal(result.distribution_security_verified, true);
  assert.equal(result.clean_mac_validation, "not_performed");
  assert.equal(result.pending, false);
  assert.equal(await readFile(`${f.dmgPath}.sha256`, "utf8"), `${result.final_sha256}  ${basename(f.dmgPath)}\n`);
  assert.equal((await f.state()).final_sha256, result.final_sha256);
  assert.deepEqual(f.calls.map((call) => call.verify ? "verify" : call.payload ? "qualify public payload" : call.args[0] === "notarytool" ? call.args[1] : call.args[0] === "stapler" ? `stapler ${call.args[1]}` : "Gatekeeper"), ["verify", "qualify public payload", "submit", "wait", "log", "stapler staple", "stapler validate", "verify", "Gatekeeper"]);
  assert.equal((await readdir(f.root)).some((name) => name.endsWith(".lock") || name.endsWith(".tmp")), false);
});

test("Invalid preserves the submitted DMG and pre-notary checksum and saves Apple's log", async (t) => {
  const f = await fixture(t);
  f.control.status = "Invalid";
  await assert.rejects(f.run(), /Apple notarization Invalid/);
  await f.assertOriginal();
  assert.equal((await f.state()).phase, "invalid");
  assert.equal((await f.state()).notarized, false);
  assert.equal(JSON.parse(await readFile(`${f.dmgPath}.notarization.log.json`)).issues[0].severity, "error");
  assert.equal(f.calls.some((call) => call.args?.[0] === "stapler"), false);
});

test("a timed-out wait queries the same ID and returns pending without publishing", async (t) => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  f.control.waitError = new Error("notarytool wait timed out");
  const result = await f.run();
  assert.equal(result.pending, true);
  assert.equal(result.phase, "submitted");
  assert.equal(result.submission_id, submissionID);
  assert.equal(result.distribution_security_verified, false);
  await f.assertOriginal();
  assert.equal(f.calls.some((call) => call.args?.[1] === "info"), true);
  assert.equal(f.calls.some((call) => call.args?.[0] === "stapler"), false);
});

test("pending resumes the recorded submission without another upload", async (t) => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  await f.run();
  f.control.status = "Accepted";
  const result = await f.run({ resume: true });
  assert.equal(result.phase, "complete");
  assert.equal(f.submissions().length, 1);
});

test("existing state requires explicit resume and a completed resume stays idempotent", async (t) => {
  const f = await fixture(t);
  await f.run();
  await assert.rejects(f.run(), /state already exists/);
  const result = await f.run({ resume: true });
  assert.equal(result.phase, "complete");
  assert.equal(f.submissions().length, 1);
  assert.equal(f.calls.filter((call) => call.args?.[0] === "stapler" && call.args[1] === "staple").length, 1);
});

test("resume refuses changed DMG bytes before contacting Apple", async (t) => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  await f.run();
  await appendFile(f.dmgPath, " changed");
  const networkCalls = f.calls.filter((call) => call.args?.[0] === "notarytool").length;
  await assert.rejects(f.run({ resume: true }), /DMG bytes changed since submission/);
  assert.equal(f.calls.filter((call) => call.args?.[0] === "notarytool").length, networkCalls);
});

test("changes during upload retain the submission ID and never staple another artifact", async (t) => {
  const f = await fixture(t);
  f.control.beforeRun = async (_file, args) => {
    if (args[0] === "notarytool" && args[1] === "submit") await appendFile(f.dmgPath, " concurrent edit");
  };
  await assert.rejects(f.run(), /DMG bytes changed/);
  assert.equal((await f.state()).submission_id, submissionID);
  assert.equal(f.calls.some((call) => call.args?.[1] === "wait"), false);
  assert.equal(await readFile(`${f.dmgPath}.sha256`, "utf8"), f.checksum);
});

test("candidate mutation during Gatekeeper validation cannot publish an unverified digest", async (t) => {
  const f = await fixture(t);
  f.control.beforeRun = async (file, args) => {
    if (file === "/usr/sbin/spctl") await appendFile(args.at(-1), " changed during validation");
  };
  await assert.rejects(f.run(), /DMG bytes changed/);
  await f.assertOriginal();
  assert.equal((await f.state()).distribution_security_verified, false);
});

test("a partial stapler failure preserves the original and can retry the same Accepted submission", async (t) => {
  const f = await fixture(t);
  f.control.stapleError = true;
  await assert.rejects(f.run(), /staple failed/);
  await f.assertOriginal();
  assert.equal((await f.state()).phase, "accepted");
  assert.equal((await f.state()).notarized, false);
  f.control.stapleError = false;
  assert.equal((await f.run({ resume: true })).phase, "complete");
  assert.equal(f.submissions().length, 1);
});

for (const [property, message] of [["validateError", /ticket validation failed/], ["gatekeeperError", /Gatekeeper rejected/]]) {
  test(`${property} cannot publish the candidate or update the checksum`, async (t) => {
    const f = await fixture(t);
    f.control[property] = true;
    await assert.rejects(f.run(), message);
    await f.assertOriginal();
    assert.equal((await f.state()).distribution_security_verified, false);
  });
}

test("an uncertain upload is never repeated and can recover an explicitly matched submission", async (t) => {
  const f = await fixture(t);
  f.control.submitError = new Error("connection closed during upload");
  await assert.rejects(f.run(), /check notarytool history/);
  assert.equal((await f.state()).phase, "submission_unknown");
  await assert.rejects(f.run({ resume: true }), /previous upload outcome is unknown/);
  assert.equal(f.submissions().length, 1);
  f.control.submitError = null;
  const result = await f.run({ submissionID });
  assert.equal(result.adopted_submission, true);
  assert.equal(result.phase, "complete");
  assert.equal(f.submissions().length, 1);
});

test("a failed submit that returned an ID saves that ID for resume", async (t) => {
  const f = await fixture(t);
  f.control.submitError = Object.assign(new Error("submit output transport failed"), { stdout: JSON.stringify({ id: submissionID }) });
  await assert.rejects(f.run(), /resume submission/);
  assert.equal((await f.state()).submission_id, submissionID);
  f.control.submitError = null;
  assert.equal((await f.run({ resume: true })).phase, "complete");
  assert.equal(f.submissions().length, 1);
});

for (const logSHA of [undefined, "a".repeat(64)]) {
  test(`adopting a submission rejects ${logSHA ? "mismatched" : "missing"} Apple archive digest`, async (t) => {
    const f = await fixture(t);
    f.control.logSHA = logSHA;
    await assert.rejects(f.run({ submissionID }), /SHA-256/);
    await f.assertOriginal();
    assert.equal(f.submissions().length, 0);
    assert.equal(f.calls.some((call) => call.args?.[0] === "stapler"), false);
  });
}

test("incorrect Developer ID is rejected before any network calls", async (t) => {
  const f = await fixture(t);
  f.control.signatureError = true;
  await assert.rejects(f.run(), /invalid Developer ID/);
  assert.equal(f.calls.some((call) => call.args), false);
  await f.assertOriginal();
});

test("mismatched team and submission ID cannot reuse stored state", async (t) => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  await f.run();
  const before = await readFile(`${f.dmgPath}.notarization.json`, "utf8");
  await assert.rejects(f.run({ resume: true, teamID: "AAAAAAAAAA", signatureVerifier: async () => ({}),
    publicPayloadVerifier: async () => {} }), /state does not match/);
  assert.equal(await readFile(`${f.dmgPath}.notarization.json`, "utf8"), before);
  await assert.rejects(f.run({ submissionID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }), /differs from the recorded/);
});

test("a live notarization lock is preserved and prevents a second operation", async (t) => {
  const f = await fixture(t);
  const lockPath = `${f.dmgPath}.notarization.lock`;
  await mkdir(lockPath);
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }));
  await assert.rejects(f.run({ resume: true }), /notarization is locked/);
  assert.equal(JSON.parse(await readFile(join(lockPath, "owner.json"))).pid, process.pid);
  assert.equal(f.calls.length, 0);
});

test("resume recovers a dead lock and a DMG replacement interrupted before checksum publication", async (t) => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  await f.run();
  const state = await f.state();
  state.phase = "publishing";
  state.status = "Accepted";
  const stapledBytes = `${originalBytes} with stapled ticket`;
  state.pending_sha256 = sha256(stapledBytes);
  await writeFile(`${f.dmgPath}.notarization.json`, JSON.stringify(state));
  await writeFile(`${f.dmgPath}.notarization.log.json`, JSON.stringify({ jobId: submissionID, status: "Accepted", sha256: sha256(originalBytes) }));
  await writeFile(f.dmgPath, stapledBytes);
  const lockPath = `${f.dmgPath}.notarization.lock`;
  await mkdir(lockPath);
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: 2147483647 }));
  await writeFile(join(lockPath, "candidate.dmg"), "interrupted candidate");
  const result = await f.run({ resume: true });
  assert.equal(result.phase, "complete");
  assert.equal(result.final_sha256, sha256(stapledBytes));
  assert.equal(f.submissions().length, 1);
  assert.equal(await readFile(`${f.dmgPath}.sha256`, "utf8"), `${result.final_sha256}  ${basename(f.dmgPath)}\n`);
});

test("resume restaples safely when publication was interrupted before replacing the DMG", async (t) => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  await f.run();
  const state = await f.state();
  state.phase = "publishing";
  state.status = "Accepted";
  state.pending_sha256 = sha256(`${originalBytes} with stapled ticket`);
  await writeFile(`${f.dmgPath}.notarization.json`, JSON.stringify(state));
  f.control.status = "Accepted";
  const result = await f.run({ resume: true });
  assert.equal(result.phase, "complete");
  assert.equal(f.submissions().length, 1);
});

test("completed resume rejects a missing Apple log instead of returning an incomplete artifact set", async (t) => {
  const f = await fixture(t);
  await f.run();
  await rm(`${f.dmgPath}.notarization.log.json`);
  await assert.rejects(f.run({ resume: true }), /Apple notarization log does not match/);
  assert.equal(f.submissions().length, 1);
});

test("DMG and checksum symlinks or hard links are rejected without touching their targets", async (t) => {
  for (const target of ["dmg", "checksum", "hard-link"]) {
    const f = await fixture(t);
    const victim = join(f.root, "keep.bin");
    await writeFile(victim, "preserve me");
    const path = target === "checksum" ? `${f.dmgPath}.sha256` : f.dmgPath;
    await rm(path);
    if (target === "hard-link") await link(victim, path);
    else await symlink(victim, path);
    await assert.rejects(f.run(), /regular file/);
    assert.equal(await readFile(victim, "utf8"), "preserve me");
    assert.equal(f.calls.length, 0);
  }
});

test("strict CLI parsing supports resume and rejects credential-bearing or duplicate options", () => {
  assert.deepEqual(parseNotarizeArguments(["--dmg", "/a/Blabee.dmg", "--team-id", teamID, "--resume", "--timeout", "45"]), { dmgPath: "/a/Blabee.dmg", teamID, resume: true, timeout: 45 });
  assert.throws(() => parseNotarizeArguments(["--password", "do-not-accept"]), /invalid/);
  assert.throws(() => parseNotarizeArguments(["--dmg", "/a.dmg", "--dmg", "/b.dmg"]), /duplicate/);
  assert.throws(() => parseNotarizeArguments(["--resume", "--resume"]), /duplicate/);
  for (const distributionMode of ["public", "internal-preview"]) {
    assert.deepEqual(parseNotarizeArguments(["--distribution-mode", distributionMode]), { distributionMode });
  }
  assert.throws(() => parseNotarizeArguments(["--distribution-mode", "internal-preview", "--distribution-mode", "public"]), /duplicate/);
  assert.throws(() => parseNotarizeArguments(["--distribution-mode"]), /invalid/);
  assert.ok(Number.isNaN(parseNotarizeArguments(["--timeout", "45junk"]).timeout));
});

test("public remains the default and never invokes the internal preview verifier", async t => {
  for (const distributionMode of [undefined, "public"]) {
    const f = await fixture(t);
    const result = await f.run({ distributionMode, internalPreviewPayloadVerifier: null });
    assert.equal(result.distribution_mode, "public");
    assert.equal(f.calls.filter(call => call.payload).length, 1);
    assert.equal(f.calls.some(call => call.internalPayload), false);
  }
});

test("explicit internal preview invokes only its verifier and remains private after Accepted and completed resume", async t => {
  const f = await fixture(t);
  const options = { distributionMode: "internal-preview", publicPayloadVerifier: null };
  const result = await f.run(options);
  assert.equal(result.phase, "complete");
  assert.equal(result.status, "Accepted");
  assert.equal(result.notarized, true);
  assert.equal(result.distribution_security_verified, true);
  assert.equal(result.distribution_mode, "internal-preview");
  assert.equal(result.claude_channel_mode, "development-preview");
  assert.equal(result.public_distribution_ready, false);
  assert.equal(result.clean_mac_validation, "not_performed");
  const resumed = await f.run({ ...options, resume: true });
  assert.equal(resumed.distribution_mode, "internal-preview");
  assert.equal(resumed.claude_channel_mode, "development-preview");
  assert.equal(resumed.public_distribution_ready, false);
  assert.equal((await f.state()).public_distribution_ready, false);
  assert.equal(f.calls.filter(call => call.internalPayload).length, 2);
  assert.equal(f.calls.some(call => call.payload), false);
  assert.equal(f.submissions().length, 1);
  assert.equal(f.calls.filter(call => call.args?.[0] === "stapler" && call.args[1] === "staple").length, 1);
});

test("invalid distribution modes fail without network calls, state, or artifact changes", async t => {
  for (const distributionMode of [null, "", "internal", "development-preview", "INTERNAL-PREVIEW", " internal-preview", "internal-preview\n", 0, {}]) {
    const f = await fixture(t);
    await assert.rejects(f.run({ distributionMode }), /distribution.*mode/iu);
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.state(), { code: "ENOENT" });
    await f.assertOriginal();
    assert.equal((await readdir(f.root)).some(name => name.endsWith(".lock")), false);
  }
});

test("each distribution mode requires its selected payload verifier before any operation", async t => {
  for (const [distributionMode, verifier] of [["public", "publicPayloadVerifier"], ["internal-preview", "internalPreviewPayloadVerifier"]]) {
    const f = await fixture(t);
    await assert.rejects(f.run({ distributionMode, [verifier]: null }), /payload verifier/iu);
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.state(), { code: "ENOENT" });
  }
});

test("resume and adoption cannot change either recorded distribution mode", async t => {
  for (const [recordedMode, requestedMode] of [["public", "internal-preview"], ["internal-preview", "public"]]) {
    for (const continuation of [{ resume: true }, { submissionID }]) {
      const f = await fixture(t);
      f.control.status = "In Progress";
      await f.run({ distributionMode: recordedMode });
      const before = await readFile(`${f.dmgPath}.notarization.json`, "utf8");
      const notaryCalls = f.calls.filter(call => call.args?.[0] === "notarytool").length;
      await assert.rejects(f.run({ ...continuation, distributionMode: requestedMode }), /distribution|mode|state/iu);
      assert.equal(f.calls.filter(call => call.args?.[0] === "notarytool").length, notaryCalls);
      assert.equal(await readFile(`${f.dmgPath}.notarization.json`, "utf8"), before);
      await f.assertOriginal();
    }
  }
});

test("completed and interrupted-publication states also reject a mode switch before any notary or staple call", async t => {
  for (const phase of ["complete", "publishing"]) {
    for (const [recordedMode, requestedMode] of [["public", "internal-preview"], ["internal-preview", undefined]]) {
      const f = await fixture(t);
      if (phase === "publishing") f.control.status = "In Progress";
      await f.run({ distributionMode: recordedMode });
      if (phase === "publishing") {
        await writeFile(`${f.dmgPath}.notarization.json`, JSON.stringify({ ...await f.state(),
          phase, status: "Accepted", pending_sha256: sha256(`${originalBytes} with stapled ticket`) }));
      }
      const before = await readFile(`${f.dmgPath}.notarization.json`, "utf8");
      const dmg = await readFile(f.dmgPath, "utf8");
      const checksum = await readFile(`${f.dmgPath}.sha256`, "utf8");
      const commandCalls = f.calls.filter(call => call.args).length;
      await assert.rejects(f.run({ resume: true, distributionMode: requestedMode }), /distribution|mode|state/iu);
      assert.equal(f.calls.filter(call => call.args).length, commandCalls);
      assert.equal(await readFile(`${f.dmgPath}.notarization.json`, "utf8"), before);
      assert.equal(await readFile(f.dmgPath, "utf8"), dmg);
      assert.equal(await readFile(`${f.dmgPath}.sha256`, "utf8"), checksum);
    }
  }
});

test("legacy state with no distribution mode can resume only through the public path", async t => {
  const f = await fixture(t);
  f.control.status = "In Progress";
  await f.run();
  const state = await f.state();
  delete state.distribution_mode;
  await writeFile(`${f.dmgPath}.notarization.json`, JSON.stringify(state));
  const before = await readFile(`${f.dmgPath}.notarization.json`, "utf8");
  const notaryCalls = f.calls.filter(call => call.args?.[0] === "notarytool").length;
  await assert.rejects(f.run({ resume: true, distributionMode: "internal-preview" }), /distribution|mode|state/iu);
  assert.equal(f.calls.filter(call => call.args?.[0] === "notarytool").length, notaryCalls);
  assert.equal(await readFile(`${f.dmgPath}.notarization.json`, "utf8"), before);
  f.control.status = "Accepted";
  assert.equal((await f.run({ resume: true })).phase, "complete");
  assert.equal(f.submissions().length, 1);
});

test("internal pending and uncertain uploads resume or adopt without promoting or reuploading", async t => {
  for (const uncertain of [false, true]) {
    const f = await fixture(t);
    if (uncertain) {
      f.control.submitError = new Error("connection closed during upload");
      await assert.rejects(f.run({ distributionMode: "internal-preview" }), /check notarytool history/u);
      f.control.submitError = null;
    } else {
      f.control.status = "In Progress";
      const pending = await f.run({ distributionMode: "internal-preview" });
      assert.equal(pending.pending, true);
      assert.equal(pending.public_distribution_ready, false);
      f.control.status = "Accepted";
    }
    const result = await f.run({ distributionMode: "internal-preview", ...(uncertain ? { submissionID } : { resume: true }) });
    assert.equal(result.phase, "complete");
    assert.equal(result.distribution_mode, "internal-preview");
    assert.equal(result.claude_channel_mode, "development-preview");
    assert.equal(result.public_distribution_ready, false);
    assert.equal(f.submissions().length, 1);
  }
});

test("inconsistent static distribution metadata is rejected without rewriting state or contacting Apple", async t => {
  const cases = [
    ["internal-preview", { public_distribution_ready: true }],
    ["internal-preview", { public_distribution_ready: undefined }],
    ["internal-preview", { claude_channel_mode: "approved-plugin" }],
    ["internal-preview", { claude_channel_mode: undefined }],
    ["internal-preview", { distribution_mode: undefined }],
    ["public", { distribution_mode: "unknown" }],
    ["public", { distribution_mode: null }],
    ["public", { claude_channel_mode: "development-preview" }],
    ["public", { claude_channel_mode: null }],
  ];
  for (const [distributionMode, altered] of cases) {
    const f = await fixture(t);
    f.control.status = "In Progress";
    await f.run({ distributionMode });
    await writeFile(`${f.dmgPath}.notarization.json`, JSON.stringify({ ...await f.state(), ...altered }));
    const before = await readFile(`${f.dmgPath}.notarization.json`, "utf8");
    const notaryCalls = f.calls.filter(call => call.args?.[0] === "notarytool").length;
    await assert.rejects(f.run({ resume: true, distributionMode }), /distribution|mode|state|metadata/iu);
    assert.equal(f.calls.filter(call => call.args?.[0] === "notarytool").length, notaryCalls);
    assert.equal(await readFile(`${f.dmgPath}.notarization.json`, "utf8"), before);
    await f.assertOriginal();
  }
});

test("failed internal qualification or inspection changes cannot create state or upload", async t => {
  for (const message of ["invalid Claude runtime descriptor", "DMG detach state unknown"]) {
    const f = await fixture(t);
    f.control.payloadError = new Error(message);
    await assert.rejects(f.run({ distributionMode: "internal-preview" }), error => error.message === message);
    assert.equal(f.calls.some(call => call.args), false);
    await assert.rejects(f.state(), { code: "ENOENT" });
    await f.assertOriginal();
  }
  const f = await fixture(t);
  f.control.beforePayload = () => appendFile(f.dmgPath, "changed during internal inspection");
  await assert.rejects(f.run({ distributionMode: "internal-preview" }), /DMG bytes changed/u);
  assert.equal(f.submissions().length, 0);
  await assert.rejects(f.state(), { code: "ENOENT" });
});

test("internal verifier receipts cannot omit or promote the private distribution metadata", async t => {
  const valid = { distribution_mode: "internal-preview", claude_channel_mode: "development-preview", public_distribution_ready: false };
  for (const payload of [undefined, {}, { ...valid, distribution_mode: "public" },
    { ...valid, claude_channel_mode: "approved-plugin" }, { ...valid, public_distribution_ready: true }]) {
    const f = await fixture(t);
    await assert.rejects(f.run({ distributionMode: "internal-preview", internalPreviewPayloadVerifier: async () => payload }), /internal.*(?:payload|qualification|receipt)|distribution/iu);
    assert.equal(f.calls.some(call => call.args), false);
    await assert.rejects(f.state(), { code: "ENOENT" });
    await f.assertOriginal();
  }
});

test("development Channels or uncertain payload qualification prevents every notary command and state write", async t => {
  for (const message of ["development Channels payload cannot be notarized", "DMG detach state unknown"]) {
    const f = await fixture(t);
    f.control.payloadError = new Error(message);
    await assert.rejects(f.run(), error => error.message === message);
    assert.equal(f.calls.some(call => call.args), false);
    await assert.rejects(f.state(), { code: "ENOENT" });
    await f.assertOriginal();
  }
});

test("public MCP/Hook receipt persists through accepted notarization and cannot change on resume", async t => {
  const f = await fixture(t);
  const publicPayloadVerifier = async () => ({ claude_delivery_mode: "mcp-hook-v1" });
  const result = await f.run({ publicPayloadVerifier });
  assert.equal(result.claude_delivery_mode, "mcp-hook-v1");
  assert.equal(result.claude_channel_mode, undefined);
  const resumed = await f.run({ resume: true, publicPayloadVerifier });
  assert.equal(resumed.claude_delivery_mode, "mcp-hook-v1");
  assert.equal(f.submissions().length, 1);
  await assert.rejects(f.run({ resume: true }), /delivery mode differs/u);
});

test("public notary refuses development or unknown Claude receipts before state or upload", async t => {
  for (const payload of [{ claude_channel_mode: "development-preview" }, { claude_delivery_mode: "development-preview" }]) {
    const f = await fixture(t);
    await assert.rejects(f.run({ publicPayloadVerifier: async () => payload }), /public payload qualification/u);
    assert.equal(f.submissions().length, 0);
    await assert.rejects(f.state(), { code: "ENOENT" });
  }
});

test("DMG bytes are rebound after payload qualification before upload", async t => {
  const f = await fixture(t);
  f.control.beforePayload = () => appendFile(f.dmgPath, "changed during inspection");
  await assert.rejects(f.run(), /DMG bytes changed/u);
  assert.equal(f.submissions().length, 0);
  await assert.rejects(f.state(), { code: "ENOENT" });
});

test("public payload inspection checks actual mounted tree and never enables internal Claude capability", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "blabee-public-payload-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mounted = join(root, "mounted-fixture");
  const app = join(mounted, "Blabee.app");
  await mkdir(join(app, "Contents/Resources"), { recursive: true });
  await symlink("/Applications", join(mounted, "Applications"));
  await writeFile(join(mounted, "README.txt"), "public release\n");
  const authority = `Developer ID Application: Test (${teamID})`;
  let appCalls = 0;
  let entitlementCalls = 0;
  let runtimeManifest = { schema_version: "blabee.claude-runtime.v1", node_arch: "arm64", channel_mode: "development-preview" };
  let workRoot;
  const dependencies = { teamID,
    mountVerifier: async (_dmg, work, expected, options) => {
      workRoot = work;
      assert.equal(expected, null);
      return options.verifyMounted(mounted);
    },
    runner: async (command, args, options) => {
      assert.equal(command, "/usr/bin/plutil");
      assert.equal(options.timeout, 120_000);
      assert.deepEqual(args, ["-extract", "CFBundleVersion", "raw", "-o", "-", join(app, "Contents/Info.plist")]);
      return { stdout: "62\n", stderr: "" };
    },
    appSignatureVerifier: async (path, options) => {
      assert.equal(path, app);
      assert.equal(options.identifier, "com.biadone.blabee");
      return { authority };
    },
    appEntitlementsVerifier: async (path, key) => {
      entitlementCalls++;
      assert.equal(path, app);
      assert.equal(key, "com.apple.security.automation.apple-events");
    },
    internalRuntimeVerifier: async path => {
      assert.equal(path, join(app, "Contents/Resources/claude"));
      return runtimeManifest;
    },
    appVerifier: async (path, options) => {
      appCalls++;
      assert.equal(path, app);
      assert.deepEqual(options, { expectedBuildNumber: "62", releaseSigning: { identity: authority, teamID } });
      return { bundleIdentifier: "com.biadone.blabee", build: "62" };
    },
  };
  const result = await verifyPublicDMGPayload(join(root, "Blabee-r62.dmg"), dependencies);
  assert.equal(result.bundleIdentifier, "com.biadone.blabee");
  assert.equal(appCalls, 1);
  assert.equal(entitlementCalls, 0);
  await assert.rejects(lstat(workRoot), { code: "ENOENT" });
  await mkdir(join(app, "Contents/Resources/claude"));
  await assert.rejects(verifyPublicDMGPayload(join(root, "renamed-public.dmg"), dependencies), /development Channels/u);
  assert.equal(appCalls, 1);
  await assert.rejects(lstat(workRoot), { code: "ENOENT" });
  runtimeManifest = { schema_version: "blabee.claude-runtime.v2", node_arch: "arm64", delivery_mode: "mcp-hook-v1",
    contract_versions: { session: "blabee.claude-session.v3" } };
  const unified = await verifyPublicDMGPayload(join(root, "unified-public.dmg"), dependencies);
  assert.equal(unified.claude_delivery_mode, "mcp-hook-v1");
  assert.equal(appCalls, 2);
  assert.equal(entitlementCalls, 1);
  await assert.rejects(lstat(workRoot), { code: "ENOENT" });
});

async function internalPayloadFixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "blabee-internal-payload-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mounted = join(root, "mounted-fixture");
  const app = join(mounted, "Blabee.app");
  const claude = join(app, "Contents/Resources/claude");
  const notice = join(mounted, "INTERNAL_TESTING.txt");
  await mkdir(claude, { recursive: true });
  await symlink("/Applications", join(mounted, "Applications"));
  await writeFile(notice, internalClaudeNotice);
  const authority = `Developer ID Application: Test (${teamID})`;
  const control = {};
  const calls = [];
  const workRoots = [];
  let execute;
  const dependencies = {
    teamID,
    mountVerifier: async (_dmg, work, expected, options) => {
      workRoots.push(work);
      execute = options.execute;
      assert.equal(expected, null);
      return options.verifyMounted(mounted);
    },
    runner: async (command, args, options) => {
      calls.push("version");
      assert.equal(command, "/usr/bin/plutil");
      assert.equal(options.timeout, 120_000);
      assert.deepEqual(args, ["-extract", "CFBundleVersion", "raw", "-o", "-", join(app, "Contents/Info.plist")]);
      return { stdout: "73\n", stderr: "" };
    },
    appSignatureVerifier: async (path, options) => {
      calls.push("signature");
      assert.equal(path, app);
      assert.deepEqual(options, { teamID, kind: "app", identifier: "com.biadone.blabee", runner: execute });
      if (control.signatureError) throw control.signatureError;
      return { authority };
    },
    appEntitlementsVerifier: async (path, entitlement, options) => {
      calls.push("entitlements");
      assert.equal(path, app);
      assert.equal(entitlement, "com.apple.security.automation.apple-events");
      assert.deepEqual(options, { runner: execute });
      if (control.entitlementsError) throw control.entitlementsError;
    },
    internalRuntimeVerifier: async path => {
      calls.push("runtime");
      assert.equal(path, claude);
      if (control.runtimeError) throw control.runtimeError;
      return { node_arch: "arm64", channel_mode: "development-preview", ...control.runtimeMetadata };
    },
    appVerifier: async (path, options) => {
      calls.push("app");
      assert.equal(path, app);
      assert.deepEqual(options, { expectedBuildNumber: "73", internalClaudeSigning: { identity: authority, teamID } });
      if (control.appError) throw control.appError;
      return { bundleIdentifier: "com.biadone.blabee", build: "73", ...control.appMetadata };
    },
  };
  return { root, mounted, app, claude, notice, calls, control, dependencies,
    verify: () => verifyInternalPreviewDMGPayload(join(root, "Blabee-r73.dmg"), dependencies),
    assertInspectionCleaned: async () => {
      assert.ok(workRoots.length > 0);
      for (const workRoot of workRoots) await assert.rejects(lstat(workRoot), { code: "ENOENT" });
    },
  };
}

test("internal payload inspection binds the verified identity to internal signing and retains private receipt metadata", async t => {
  const f = await internalPayloadFixture(t);
  f.control.appMetadata = { distribution_mode: "public", claude_channel_mode: "approved-plugin", public_distribution_ready: true };
  const result = await f.verify();
  assert.deepEqual(result, { bundleIdentifier: "com.biadone.blabee", build: "73",
    distribution_mode: "internal-preview", claude_channel_mode: "development-preview", public_distribution_ready: false });
  assert.deepEqual(f.calls.slice().sort(), ["app", "entitlements", "runtime", "signature", "version"].sort());
  await f.assertInspectionCleaned();
});

test("internal payload requires the exact root layout, Applications link, and approved notice", async t => {
  const cases = [
    ["public notice", async f => { await rm(f.notice); await writeFile(join(f.mounted, "README.txt"), internalClaudeNotice); }],
    ["extra root file", f => writeFile(join(f.mounted, "unexpected.txt"), "extra")],
    ["wrong Applications target", async f => { await rm(join(f.mounted, "Applications")); await symlink(f.root, join(f.mounted, "Applications")); }],
    ["Applications directory", async f => { await rm(join(f.mounted, "Applications")); await mkdir(join(f.mounted, "Applications")); }],
    ["symlink notice", async f => {
      const target = join(f.root, "external-notice.txt");
      await writeFile(target, internalClaudeNotice); await rm(f.notice); await symlink(target, f.notice);
    }],
    ["hard-linked notice", async f => {
      const target = join(f.root, "external-notice.txt");
      await writeFile(target, internalClaudeNotice); await rm(f.notice); await link(target, f.notice);
    }],
    ["directory notice", async f => { await rm(f.notice); await mkdir(f.notice); }],
    ["oversized notice", f => writeFile(f.notice, "x".repeat(64 * 1024 + 1))],
    ["empty notice", f => writeFile(f.notice, "")],
    ["same-size changed notice", f => writeFile(f.notice, internalClaudeNotice.replace("Developer ID", "Developer XX"))],
    ["stale notarization notice", f => writeFile(f.notice, [
      "BLABEE — INTERNAL DEVELOPMENT CHANNELS BUILD", "",
      "Blabee.app contains the common engine with Codex and Claude bridges.",
      "The app and disk image are Developer ID signed. This image is not notarized.",
      "Claude uses explicitly enabled development Channels; no approved-plugin or public-release qualification is claimed.", "",
    ].join("\n"))],
    ["changed notice", f => appendFile(f.notice, "Public distribution is ready.\n")],
  ];
  for (const [label, alter] of cases) {
    const f = await internalPayloadFixture(t);
    await alter(f);
    await assert.rejects(f.verify(), /exactly|Applications link|notice/iu, label);
    assert.equal(f.calls.length, 0, `${label} must fail before signature, runtime, or app inspection`);
    await f.assertInspectionCleaned();
  }
});

test("internal payload requires real app directories and an existing real Claude subtree", async t => {
  const cases = [
    ["missing Claude runtime", f => rm(f.claude, { recursive: true })],
    ["file Claude runtime", async f => { await rm(f.claude, { recursive: true }); await writeFile(f.claude, "not a directory"); }],
    ["symlink Claude runtime", async f => { await rm(f.claude, { recursive: true }); await symlink(f.root, f.claude); }],
    ...["", "Contents", "Contents/Resources"].map(relative => [`symlink ${relative || "app"}`, async f => {
      const selected = join(f.app, relative);
      await rm(selected, { recursive: true });
      await symlink(f.root, selected);
    }]),
  ];
  for (const [label, alter] of cases) {
    const f = await internalPayloadFixture(t);
    await alter(f);
    await assert.rejects(f.verify(), /real director|requires.*Claude runtime/iu, label);
    assert.equal(f.calls.length, 0);
    await f.assertInspectionCleaned();
  }
});

test("internal signature, entitlement, runtime, and app failures stop notarization before state or network", async t => {
  for (const property of ["signatureError", "entitlementsError", "runtimeError", "appError"]) {
    const payload = await internalPayloadFixture(t);
    const f = await fixture(t);
    const error = new Error(`rejected ${property}`);
    payload.control[property] = error;
    await assert.rejects(f.run({ distributionMode: "internal-preview",
      internalPreviewPayloadVerifier: dmg => verifyInternalPreviewDMGPayload(dmg, payload.dependencies) }), actual => actual === error);
    assert.equal(f.calls.some(call => call.args), false);
    await assert.rejects(f.state(), { code: "ENOENT" });
    await f.assertOriginal();
    await payload.assertInspectionCleaned();
  }
});

test("internal runtime metadata must retain arm64 and development-preview before upload", async t => {
  for (const runtimeMetadata of [{ node_arch: "x64" }, { node_arch: undefined },
    { channel_mode: "approved-plugin" }, { channel_mode: undefined }]) {
    const payload = await internalPayloadFixture(t);
    const f = await fixture(t);
    payload.control.runtimeMetadata = runtimeMetadata;
    await assert.rejects(f.run({ distributionMode: "internal-preview",
      internalPreviewPayloadVerifier: dmg => verifyInternalPreviewDMGPayload(dmg, payload.dependencies) }), /arm64|development-preview|runtime/iu);
    assert.equal(f.calls.some(call => call.args), false);
    await assert.rejects(f.state(), { code: "ENOENT" });
    await f.assertOriginal();
    await payload.assertInspectionCleaned();
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { notarizeDMG, parseNotarizeArguments } from "../../scripts/notarize-dmg.mjs";

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
  const options = { dmgPath, teamID, platform: "darwin", keychainPath: join(root, "login.keychain-db"), runner, signatureVerifier };
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
  assert.deepEqual(f.calls.map((call) => call.verify ? "verify" : call.args[0] === "notarytool" ? call.args[1] : call.args[0] === "stapler" ? `stapler ${call.args[1]}` : "Gatekeeper"), ["verify", "submit", "wait", "log", "stapler staple", "stapler validate", "verify", "Gatekeeper"]);
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
  await assert.rejects(f.run({ resume: true, teamID: "AAAAAAAAAA", signatureVerifier: async () => ({}) }), /state does not match/);
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
  assert.ok(Number.isNaN(parseNotarizeArguments(["--timeout", "45junk"]).timeout));
});

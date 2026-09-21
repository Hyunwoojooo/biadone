#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { verifyDeveloperIDSignature } from "./release-signing.mjs";
import { attachAndVerifyDMG, verifyInternalAppBundle } from "./build-internal-dmg.mjs";
import { requireInternalBuildNumber } from "./internal-build-number.mjs";

const execFile = promisify(execFileCallback);
const schema = "blabee.dmg-notarization.v1";
const identifier = "com.biadone.blabee.dmg";
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const shaPattern = /^[a-f0-9]{64}$/;
const phases = new Set(["submitting", "submission_unknown", "submitted", "accepted", "invalid", "publishing", "complete"]);
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function fail(message) { throw new Error(message); }
function absolute(value, name) {
  if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n]/.test(value)) fail(`${name} must be an explicit absolute path`);
  return resolve(value);
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function stableFile(a, b) { return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function requireOwnedRegular(metadata, name) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (process.getuid && metadata.uid !== process.getuid())) {
    fail(`${name} must be an owned regular file without symlinks or hard links`);
  }
}
async function existingRegular(path) {
  try {
    const metadata = await lstat(path);
    requireOwnedRegular(metadata, path);
    return metadata;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function digest(path) {
  const before = await lstat(path);
  requireOwnedRegular(before, path);
  if (before.size > 2 * 1024 ** 3) fail("DMG exceeds the 2 GiB notarization limit");
  const handle = await open(path, fileFlags);
  try {
    if (!stableFile(before, await handle.stat())) fail("DMG changed before reading");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(128 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      if (position > 2 * 1024 ** 3) fail("DMG grew beyond the notarization size limit");
    }
    if (!stableFile(before, await handle.stat()) || !stableFile(before, await lstat(path))) fail("DMG changed while reading");
    return hash.digest("hex");
  } finally { await handle.close(); }
}
async function readJSON(path) {
  const before = await existingRegular(path);
  if (before === null) return null;
  if (before.size > 16 * 1024 ** 2) fail(`${path} exceeds the JSON size limit`);
  const handle = await open(path, fileFlags);
  try {
    if (!stableFile(before, await handle.stat())) fail(`${path} changed before reading`);
    const data = JSON.parse(await handle.readFile("utf8"));
    if (!stableFile(before, await handle.stat()) || !stableFile(before, await lstat(path))) fail(`${path} changed while reading`);
    return data;
  } finally { await handle.close(); }
}
async function atomicWrite(path, text, assertParent) {
  await assertParent();
  const previous = await existingRegular(path);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    await assertParent();
    const current = await existingRegular(path);
    if ((previous === null) !== (current === null) || (previous && !stableFile(previous, current))) fail(`${path} changed before publication`);
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
async function acquireLock(lockPath, resume, assertParent) {
  const ownerPath = join(lockPath, "owner.json");
  const candidatePath = join(lockPath, "candidate.dmg");
  async function removeContents(expected) {
    await assertParent();
    const current = await lstat(lockPath);
    if (!sameFile(expected, current) || !current.isDirectory() || current.isSymbolicLink()) fail("notarization lock changed");
    const names = await readdir(lockPath);
    if (names.some((name) => name !== "owner.json" && name !== "candidate.dmg")) fail("notarization lock has unexpected contents; inspect it manually");
    for (const name of names) {
      const path = join(lockPath, name);
      await existingRegular(path);
      await unlink(path);
    }
    await rmdir(lockPath);
  }
  try { await mkdir(lockPath, { mode: 0o700 }); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const metadata = await lstat(lockPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (process.getuid && metadata.uid !== process.getuid())) fail("unsafe notarization lock");
    const owner = await readJSON(ownerPath);
    if (!resume || !owner || processAlive(owner.pid)) fail("notarization is locked; use --resume after the recorded process exits");
    await removeContents(metadata);
    await mkdir(lockPath, { mode: 0o700 });
  }
  const metadata = await lstat(lockPath);
  const owner = await open(ownerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await owner.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() })); await owner.sync(); } finally { await owner.close(); }
  return {
    candidatePath,
    assert: async () => {
      await assertParent();
      const current = await lstat(lockPath);
      if (!sameFile(metadata, current) || !current.isDirectory() || current.isSymbolicLink()) fail("notarization lock changed");
    },
    release: () => removeContents(metadata),
  };
}
function parseResponse(stdout, label) {
  try {
    const result = JSON.parse(String(stdout));
    if (result && typeof result === "object" && !Array.isArray(result)) return result;
  } catch {}
  fail(`${label} did not return a JSON object`);
}
function requireSubmissionID(value) {
  if (typeof value !== "string" || !uuidPattern.test(value)) fail("submission ID must be a UUID");
  return value.toLowerCase();
}
function validateState(state, { dmgPath, teamID, keychainProfile, keychainPath }) {
  if (state.schema !== schema || state.dmg !== dmgPath || state.team_id !== teamID || state.keychain_profile !== keychainProfile || state.keychain !== keychainPath
      || !phases.has(state.phase) || !shaPattern.test(state.submitted_sha256)) fail("notarization state does not match this DMG, team, or Keychain profile");
  if (state.submission_id !== null) requireSubmissionID(state.submission_id);
  for (const key of ["pending_sha256", "final_sha256"]) if (state[key] != null && !shaPattern.test(state[key])) fail(`invalid ${key} in notarization state`);
  if (["submitted", "accepted", "invalid", "publishing", "complete"].includes(state.phase) && !state.submission_id) fail("notarization state is missing its submission ID");
  if (state.phase === "complete" && !state.final_sha256) fail("completed notarization state is missing its final checksum");
  if (["accepted", "publishing", "complete"].includes(state.phase) && state.status !== "Accepted") fail("notarization state has no Accepted result for this phase");
}
function validateLog(log, state) {
  if (!log || requireSubmissionID(log.jobId) !== state.submission_id || log.status !== state.status) fail("Apple notarization log does not match the recorded submission and result");
  if (state.adopted_submission && !log.sha256) fail("cannot recover this submission without Apple's archive SHA-256 in its log");
  if (log.sha256 && String(log.sha256).toLowerCase() !== state.submitted_sha256) fail("Apple notarization log SHA-256 does not match the submitted DMG");
}

// A common product identifier is not evidence that an internal development
// Channels payload is eligible for public distribution. Inspect sealed content
// before any upload, using the same read-only attach/verified-detach lifecycle.
export async function verifyPublicDMGPayload(dmgPath, {
  teamID,
  runner = execFile,
  mountVerifier = attachAndVerifyDMG,
  appVerifier = verifyInternalAppBundle,
  appSignatureVerifier = verifyDeveloperIDSignature,
} = {}) {
  const workRoot = await realpath(await mkdtemp(join(tmpdir(), "blabee-notary-qualification-")));
  const ownership = await lstat(workRoot);
  const execute = (command, args, options) => runner(command, args, { ...options, timeout: 120_000 });
  let primaryError;
  let result;
  try {
    result = await mountVerifier(dmgPath, workRoot, null, { execute, verifyMounted: async mountPoint => {
      const app = join(mountPoint, "Blabee.app");
      for (const path of [app, join(app, "Contents"), join(app, "Contents", "Resources")]) {
        const metadata = await lstat(path);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("public DMG app must contain real directories");
      }
      const hasClaude = await lstat(join(app, "Contents", "Resources", "claude")).then(() => true, error => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (hasClaude) fail("development Channels payload cannot be notarized for public distribution");
      if (JSON.stringify((await readdir(mountPoint)).sort()) !== JSON.stringify(["Applications", "Blabee.app", "README.txt"])) {
        fail("public DMG must contain exactly Applications, Blabee.app and README.txt");
      }
      const applications = join(mountPoint, "Applications");
      if (!(await lstat(applications)).isSymbolicLink() || await readlink(applications) !== "/Applications") fail("public DMG Applications link is invalid");
      const notice = await lstat(join(mountPoint, "README.txt"));
      if (!notice.isFile() || notice.isSymbolicLink() || notice.nlink !== 1 || notice.size > 64 * 1024) fail("public DMG notice is invalid");
      const signature = await appSignatureVerifier(app, { teamID, kind: "app", identifier: "com.biadone.blabee", runner: execute });
      const version = await execute("/usr/bin/plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", join(app, "Contents", "Info.plist")], { encoding: "utf8", maxBuffer: 1024 });
      if (version.stderr !== "") fail("public DMG app version wrote unexpected diagnostics");
      const buildNumber = requireInternalBuildNumber(version.stdout.trim(), "public app build number");
      return appVerifier(app, { expectedBuildNumber: buildNumber, releaseSigning: { identity: signature.authority, teamID } });
    } });
  } catch (error) {
    primaryError = error;
  }
  if (!primaryError?.preservePackagingWork) {
    try {
      const after = await lstat(workRoot);
      if (!sameFile(ownership, after) || !after.isDirectory() || after.isSymbolicLink()) fail("notarization inspection directory identity changed");
      await rmdir(workRoot);
    } catch (cleanupError) {
      throw new AggregateError([...(primaryError ? [primaryError] : []), cleanupError], `notarization inspection cleanup failed; preserved ${workRoot}`, { cause: primaryError ?? cleanupError });
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

export async function notarizeDMG({
  dmgPath,
  teamID,
  keychainProfile = "blabee-notary",
  keychainPath = join(homedir(), "Library", "Keychains", "login.keychain-db"),
  submissionID = null,
  resume = false,
  timeout = 45,
  runner = execFile,
  signatureVerifier = verifyDeveloperIDSignature,
  publicPayloadVerifier = verifyPublicDMGPayload,
  platform = process.platform,
} = {}) {
  if (platform !== "darwin") fail("DMG notarization is supported only on macOS");
  if (typeof publicPayloadVerifier !== "function") fail("public payload verifier is required");
  dmgPath = absolute(dmgPath, "--dmg");
  if (!dmgPath.endsWith(".dmg")) fail("--dmg must end with .dmg");
  if (typeof teamID !== "string" || !/^[A-Z0-9]{10}$/.test(teamID)) fail("--team-id must be a 10-character Apple Team ID");
  if (typeof keychainProfile !== "string" || !keychainProfile.trim() || keychainProfile.startsWith("-") || /[\0\r\n]/.test(keychainProfile)) fail("invalid Keychain profile");
  keychainPath = absolute(keychainPath, "--keychain");
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) fail("--timeout must be an integer from 1 to 3600 seconds");
  if (submissionID !== null) submissionID = requireSubmissionID(submissionID);
  const parentPath = dirname(dmgPath);
  const parent = await lstat(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (process.getuid && parent.uid !== process.getuid())) fail("DMG parent must be an owned real directory");
  if (await realpath(parentPath) !== parentPath) fail("DMG path must not contain symlinked directories; use its canonical absolute path");
  const assertParent = async () => {
    const current = await lstat(parentPath);
    if (!sameFile(parent, current) || !current.isDirectory() || current.isSymbolicLink() || await realpath(parentPath) !== parentPath) fail("DMG parent directory changed");
  };
  const paths = { state: `${dmgPath}.notarization.json`, log: `${dmgPath}.notarization.log.json`, checksum: `${dmgPath}.sha256`, lock: `${dmgPath}.notarization.lock` };
  for (const path of [dmgPath, paths.state, paths.log, paths.checksum]) await existingRegular(path);
  const lock = await acquireLock(paths.lock, resume || submissionID !== null, assertParent);
  let state;
  let stateValidated = false;
  const save = async () => {
    state.updated_at = new Date().toISOString();
    await atomicWrite(paths.state, `${JSON.stringify(state, null, 2)}\n`, assertParent);
  };
  const assertDigest = async (expected, path = dmgPath) => {
    await assertParent();
    if (await digest(path) !== expected) fail("DMG bytes changed; refusing to use the notarization submission for a different artifact");
  };
  const verify = (path) => signatureVerifier(path, { teamID, kind: "dmg", identifier, runner });
  const credentials = ["--keychain-profile", keychainProfile, "--keychain", keychainPath];
  const notary = (command, args = []) => runner("/usr/bin/xcrun", ["notarytool", command, ...args, ...credentials, "--output-format", "json"], { maxBuffer: 16 * 1024 ** 2, timeout: command === "wait" ? (timeout + 30) * 1000 : 15 * 60 * 1000 });
  const gatekeeper = async (path) => {
    const result = await runner("/usr/sbin/spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", path], { maxBuffer: 1024 * 1024, timeout: 120000 });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  };
  const validateTicket = (path) => runner("/usr/bin/xcrun", ["stapler", "validate", path], { maxBuffer: 1024 * 1024, timeout: 120000 });
  try {
    const initialSHA = await digest(dmgPath);
    await verify(dmgPath);
    await assertDigest(initialSHA);
    await publicPayloadVerifier(dmgPath, { teamID, runner });
    await assertDigest(initialSHA);
    state = await readJSON(paths.state);
    if (state) {
      validateState(state, { dmgPath, teamID, keychainProfile, keychainPath });
      stateValidated = true;
      if (!resume && submissionID === null) fail("notarization state already exists; use --resume to continue without uploading again");
      if (submissionID && state.submission_id && state.submission_id !== submissionID) fail("--submission-id differs from the recorded submission");
      const expected = state.phase === "complete" ? state.final_sha256 : state.submitted_sha256;
      if (initialSHA !== expected && !(state.phase === "publishing" && initialSHA === state.pending_sha256)) fail("DMG bytes changed since submission; restore the submitted artifact before resuming");
      if (!state.submission_id) {
        if (!submissionID) fail("previous upload outcome is unknown; find its ID with notarytool history and pass --submission-id; no automatic re-upload is allowed");
        state.submission_id = submissionID;
        state.adopted_submission = true;
        state.phase = "submitted";
        await save();
      }
    } else {
      if (resume && !submissionID) fail("--resume requires an existing notarization state or an explicit --submission-id");
      state = {
        schema, dmg: dmgPath, team_id: teamID, keychain_profile: keychainProfile, keychain: keychainPath,
        phase: submissionID ? "submitted" : "submitting", submission_id: submissionID, submitted_sha256: initialSHA,
        adopted_submission: submissionID !== null, notarized: false, distribution_security_verified: false,
        log: paths.log, checksum: paths.checksum, clean_mac_validation: "not_performed", created_at: new Date().toISOString(),
      };
      stateValidated = true;
      await save();
      if (!submissionID) {
        try {
          const response = parseResponse((await notary("submit", [dmgPath, "--no-wait"])).stdout, "notarytool submit");
          state.submission_id = requireSubmissionID(response.id);
          state.phase = "submitted";
          await save();
        } catch (error) {
          if (!state.submission_id) {
            try { state.submission_id = requireSubmissionID(parseResponse(error.stdout, "notarytool submit").id); } catch {}
          }
          state.phase = state.submission_id ? "submitted" : "submission_unknown";
          await save();
          throw new Error(`notarytool submit did not complete reliably; ${state.submission_id ? `resume submission ${state.submission_id}` : "check notarytool history and recover with --submission-id; do not upload again"}. ${error.message}`, { cause: error });
        }
        await assertDigest(state.submitted_sha256);
      }
    }

    if (state.phase === "complete" || (state.phase === "publishing" && initialSHA === state.pending_sha256)) {
      validateLog(await readJSON(paths.log), state);
      await validateTicket(dmgPath);
      state.signature = await verify(dmgPath);
      state.gatekeeper = await gatekeeper(dmgPath);
      await assertDigest(state.final_sha256 ?? state.pending_sha256);
    } else {
      if (state.phase === "submitted") {
        let response;
        try { response = parseResponse((await notary("wait", [state.submission_id, "--timeout", `${timeout}s`])).stdout, "notarytool wait"); }
        catch (error) {
          try { response = parseResponse(error.stdout, "notarytool wait"); } catch {}
          if (!response?.status) response = parseResponse((await notary("info", [state.submission_id])).stdout, "notarytool info");
        }
        if (requireSubmissionID(response.id) !== state.submission_id) fail("Apple response refers to a different submission ID");
        state.status = response.status;
        if (response.status === "Accepted") state.phase = "accepted";
        else if (response.status === "Invalid" || response.status === "Rejected") state.phase = "invalid";
        else if (response.status !== "In Progress") fail(`unrecognized notarization status: ${response.status}`);
        await save();
        await assertDigest(state.submitted_sha256);
        if (state.phase === "submitted") return { ...state, pending: true, state_file: paths.state };
      }
      const log = parseResponse((await notary("log", [state.submission_id])).stdout, "notarytool log");
      await atomicWrite(paths.log, `${JSON.stringify(log, null, 2)}\n`, assertParent);
      validateLog(log, state);
      if (state.phase === "invalid") fail(`Apple notarization ${state.status}; inspect ${paths.log}`);
      await assertDigest(state.submitted_sha256);
      await lock.assert();
      await copyFile(dmgPath, lock.candidatePath, constants.COPYFILE_EXCL);
      await assertDigest(state.submitted_sha256, lock.candidatePath);
      await lock.assert();
      await runner("/usr/bin/xcrun", ["stapler", "staple", lock.candidatePath], { maxBuffer: 1024 * 1024, timeout: 120000 });
      const candidateSHA = await digest(lock.candidatePath);
      await validateTicket(lock.candidatePath);
      state.signature = await verify(lock.candidatePath);
      state.gatekeeper = await gatekeeper(lock.candidatePath);
      await assertDigest(candidateSHA, lock.candidatePath);
      state.pending_sha256 = candidateSHA;
      const candidate = await open(lock.candidatePath, fileFlags);
      try { await candidate.sync(); } finally { await candidate.close(); }
      state.phase = "publishing";
      await save();
      await assertDigest(state.submitted_sha256);
      await assertDigest(state.pending_sha256, lock.candidatePath);
      await lock.assert();
      await rename(lock.candidatePath, dmgPath);
      await assertDigest(state.pending_sha256);
    }
    const finalSHA = state.final_sha256 ?? state.pending_sha256;
    await atomicWrite(paths.checksum, `${finalSHA}  ${basename(dmgPath)}\n`, assertParent);
    await assertDigest(finalSHA);
    state.final_sha256 = finalSHA;
    delete state.pending_sha256;
    delete state.last_error;
    state.phase = "complete";
    state.status = "Accepted";
    state.notarized = true;
    state.distribution_security_verified = true;
    state.completed_at ??= new Date().toISOString();
    await save();
    return { ...state, pending: false, state_file: paths.state };
  } catch (error) {
    if (state && stateValidated) {
      state.last_error = String(error.message).slice(0, 4000);
      await save().catch(() => {});
    }
    throw error;
  } finally { await lock.release(); }
}

export function parseNotarizeArguments(args) {
  const options = {};
  const names = new Map([["--dmg", "dmgPath"], ["--team-id", "teamID"], ["--keychain-profile", "keychainProfile"], ["--keychain", "keychainPath"], ["--submission-id", "submissionID"], ["--timeout", "timeout"]]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--resume") { if (options.resume) fail("duplicate --resume"); options.resume = true; continue; }
    const name = names.get(flag);
    if (!name || options[name] !== undefined || index + 1 >= args.length) fail(`invalid or duplicate argument: ${flag}`);
    const value = args[++index];
    options[name] = name === "timeout" ? (/^[1-9][0-9]*$/.test(value) ? Number(value) : NaN) : value;
  }
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node scripts/notarize-dmg.mjs --dmg /absolute/Blabee.dmg --team-id TEAMID [--keychain-profile blabee-notary] [--keychain /absolute/login.keychain-db] [--resume | --submission-id UUID] [--timeout 45]\nThe default Keychain is ~/Library/Keychains/login.keychain-db. Exit 2 means Apple is still processing; resume the same submission.\n");
  } else {
    try {
      const result = await notarizeDMG(parseNotarizeArguments(process.argv.slice(2)));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.pending) process.exitCode = 2;
    } catch (error) {
      process.stderr.write(`DMG notarization failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

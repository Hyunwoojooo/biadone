import { execFile as execFileCallback } from "node:child_process";
import { constants as fileSystemConstants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const appIdentifier = "com.biadone.blabee";
const dmgIdentifier = "com.biadone.blabee.dmg";
const mainExecutable = "Contents/MacOS/blabee-coordinator";
const resourceLauncher = "Contents/Resources/Plugin/blabee/scripts/blabee-launcher";
export const appSigningEntitlementsFileName = "Blabee.entitlements";
// Keep the signing policy narrower than arbitrary caller-provided entitlements.
// The staged resource is part of the assembly manifest and the code seal.
const appSigningEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.automation.apple-events</key>
\t<true/>
</dict>
</plist>
`;
const machOMagic = new Set([
  "feedface", "cefaedfe", "feedfacf", "cffaedfe",
  "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
]);

function requireTeamID(value) {
  if (typeof value !== "string" || !/^[A-Z0-9]{10}$/u.test(value)) {
    throw new Error("release Team ID must contain exactly 10 uppercase letters or digits");
  }
  return value;
}

export function normalizeReleaseSigning(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).sort().join(",") !== "identity,teamID"
  ) {
    throw new Error("release signing must provide exactly identity and teamID");
  }
  const teamID = requireTeamID(value.teamID);
  const identity = value.identity;
  if (
    typeof identity !== "string"
    || /[\x00-\x1f\x7f]/u.test(identity)
    || !/^Developer ID Application: \S(?:.*\S)? \([A-Z0-9]{10}\)$/u.test(identity)
    || !identity.endsWith(` (${teamID})`)
  ) {
    throw new Error("release identity must be a Developer ID Application certificate matching the Team ID");
  }
  return Object.freeze({ identity, teamID });
}

function requirePath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw new Error("release signing requires an absolute artifact path without null bytes");
  }
  return path;
}

function requireRunner(runner) {
  if (typeof runner !== "function") throw new Error("release signing runner must be a function");
  return runner;
}

export async function validateAppSigningEntitlements(path) {
  requirePath(path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== Buffer.byteLength(appSigningEntitlements)) {
    throw new Error("app signing entitlements must contain only the approved Apple events permission");
  }
  const handle = await open(path, fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW | fileSystemConstants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new Error("app signing entitlements changed during inspection");
    }
    const data = Buffer.alloc(metadata.size + 1);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    if (bytesRead !== metadata.size || data.subarray(0, bytesRead).toString("utf8") !== appSigningEntitlements) {
      throw new Error("app signing entitlements must contain only the approved Apple events permission");
    }
  } finally {
    await handle.close();
  }
  return path;
}

function commandOptions() {
  return {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
  };
}

function singleField(lines, name) {
  const matches = lines.filter((line) => line.startsWith(`${name}=`));
  if (matches.length !== 1) throw new Error(`code signature must contain one ${name} field`);
  return matches[0].slice(name.length + 1);
}

// Apple TN3127: both the Developer ID CA and Application leaf OIDs are
// necessary. A matching display name or TeamIdentifier alone is not trust.
function developerIDRequirement(teamID) {
  return [
    "anchor apple generic",
    "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
    "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
    `certificate leaf[subject.OU] = "${teamID}"`,
  ].join(" and ");
}

export async function verifyDeveloperIDSignature(path, {
  teamID,
  kind = "app",
  identifier = kind === "dmg" ? dmgIdentifier : appIdentifier,
  runner = execFile,
} = {}) {
  requirePath(path);
  requireTeamID(teamID);
  requireRunner(runner);
  if (kind !== "app" && kind !== "dmg") throw new Error("release signature kind must be app or dmg");
  if (typeof identifier !== "string" || !/^[A-Za-z0-9.-]+$/u.test(identifier)) {
    throw new Error("release signature identifier is invalid");
  }
  await runner("/usr/bin/codesign", [
    "--verify", ...(kind === "app" ? ["--deep"] : []), "--strict", "--verbose=2",
    "--test-requirement", `=${developerIDRequirement(teamID)}`, path,
  ], commandOptions());
  const result = await runner("/usr/bin/codesign", [
    "--display", "--verbose=4", path,
  ], commandOptions());
  const lines = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split(/\r?\n/u);
  if (lines.includes("Signature=adhoc")) throw new Error("release artifact must not be ad-hoc signed");
  if (singleField(lines, "TeamIdentifier") !== teamID) {
    throw new Error("release signature Team ID does not match the required team");
  }
  if (singleField(lines, "Identifier") !== identifier) {
    throw new Error("release signature identifier does not match the required identifier");
  }
  const authority = lines.find((line) => line.startsWith("Authority="))?.slice("Authority=".length);
  if (
    typeof authority !== "string"
    || !authority.startsWith("Developer ID Application: ")
    || !authority.endsWith(` (${teamID})`)
  ) {
    throw new Error("release signature must use a Developer ID Application authority from the required team");
  }
  const timestamp = singleField(lines, "Timestamp");
  if (timestamp.trim() === "" || /^(?:none|n\/a|not set)$/iu.test(timestamp.trim())) {
    throw new Error("release signature must include a secure timestamp");
  }
  const codeDirectory = lines.find((line) => line.startsWith("CodeDirectory "));
  const flags = codeDirectory?.match(/\bflags=0x([A-Fa-f0-9]+)\b/u)?.[1];
  const hardenedRuntime = flags !== undefined && (BigInt(`0x${flags}`) & 0x10000n) !== 0n;
  if (kind === "app" && !hardenedRuntime) {
    throw new Error("release app signature must enable Hardened Runtime");
  }
  return {
    kind,
    identifier,
    team_id: teamID,
    authority,
    timestamp,
    hardened_runtime: hardenedRuntime,
  };
}

async function validateReleaseAppCodeLayout(appPath) {
  let entries = 0;
  let foundMain = false;
  const inspect = async (directory, depth) => {
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || depth > 64) {
      throw new Error("release app code layout contains an invalid directory");
    }
    for (const name of await readdir(directory)) {
      entries += 1;
      if (entries > 10000) throw new Error("release app code layout exceeds its entry limit");
      const path = join(directory, name);
      const child = await lstat(path);
      if (child.isSymbolicLink()) throw new Error(`release app must not contain a symlink: ${path}`);
      if (child.isDirectory()) {
        if (/\.(?:app|framework|xpc|appex|bundle)$/iu.test(name)) {
          throw new Error(`release app contains unsupported nested code: ${path}`);
        }
        await inspect(path, depth + 1);
        continue;
      }
      if (!child.isFile()) throw new Error(`release app contains a special file: ${path}`);
      const pathInApp = relative(appPath, path).split(sep).join("/");
      const handle = await open(path, fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW);
      let prefix;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== child.dev || opened.ino !== child.ino) {
          throw new Error(`release app code changed during inspection: ${path}`);
        }
        const buffer = Buffer.alloc(4);
        const { bytesRead } = await handle.read(buffer, 0, 4, 0);
        prefix = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      const isMachO = machOMagic.has(prefix.toString("hex"));
      if (pathInApp === mainExecutable) {
        if (!isMachO || (child.mode & 0o111) === 0) {
          throw new Error("release app main executable must be executable Mach-O code");
        }
        foundMain = true;
      } else if (isMachO || ((child.mode & 0o111) !== 0 && pathInApp !== resourceLauncher)) {
        throw new Error(`release app contains unsupported executable code: ${path}`);
      } else if (pathInApp === resourceLauncher && prefix.subarray(0, 2).toString() !== "#!") {
        throw new Error("release app resource launcher must remain a script");
      }
    }
  };
  await inspect(appPath, 0);
  if (!foundMain) throw new Error("release app main executable is missing");
}

export async function signReleaseApp(path, signing, { runner = execFile } = {}) {
  requirePath(path);
  requireRunner(runner);
  const normalized = normalizeReleaseSigning(signing);
  if (normalized === null) throw new Error("release app signing requires a Developer ID identity and Team ID");
  // There is currently one Mach-O target, the main executable signed with its
  // enclosing bundle. New nested code must gain an explicit inside-out signing
  // plan; --deep signing would conceal omissions in that plan.
  await validateReleaseAppCodeLayout(path);
  const entitlements = await validateAppSigningEntitlements(join(path, "Contents", "Resources", appSigningEntitlementsFileName));
  await runner("/usr/bin/codesign", [
    "--force", "--sign", normalized.identity, "--options", "runtime", "--timestamp",
    "--entitlements", entitlements, path,
  ], commandOptions());
  return verifyDeveloperIDSignature(path, { teamID: normalized.teamID, kind: "app", runner });
}

export async function signReleaseDMG(path, signing, { runner = execFile } = {}) {
  requirePath(path);
  requireRunner(runner);
  const normalized = normalizeReleaseSigning(signing);
  if (normalized === null) throw new Error("release DMG signing requires a Developer ID identity and Team ID");
  await runner("/usr/bin/codesign", [
    "--force", "--sign", normalized.identity, "--timestamp", "--identifier", dmgIdentifier, path,
  ], commandOptions());
  return verifyDeveloperIDSignature(path, { teamID: normalized.teamID, kind: "dmg", runner });
}

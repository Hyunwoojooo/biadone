import { execFile as execFileCallback } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
export const BLABEE_PROFILE = Object.freeze({ id: "blabee", bundleName: "Blabee.app", name: "Blabee",
  bundleIdentifier: "com.biadone.blabee", serviceLabel: "com.biadone.blabee.coordinator",
  dmgIdentifier: "com.biadone.blabee.dmg", marketingVersion: "0.1.0",
  nodeIdentifier: "com.biadone.blabee.claude-node",
  transactionSchema: "blabee.internal-dmg-publish.v2", workPrefix: ".blabee-internal-dmg-work-" });
export async function verifyCompiledDistributionProfile(binary, { runner = execFile, requireExplicit = false } = {}) {
  const profile = BLABEE_PROFILE;
  if (!isAbsolute(binary) || typeof runner !== "function") throw new Error("invalid distribution profile probe");
  let result;
  let succeeded = true;
  try {
    result = await runner(binary, ["distribution-profile"], { cwd: dirname(binary),
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" },
      encoding: "utf8", maxBuffer: 4096, timeout: 5000, killSignal: "SIGKILL" });
  } catch (error) {
    if (error.killed || error.signal || !Number.isInteger(error.code)) throw new Error("distribution profile probe failed");
    succeeded = false;
    result = error;
  }
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (Buffer.byteLength(stdout, "utf8") > 4096 || Buffer.byteLength(stderr, "utf8") > 4096) {
    throw new Error("distribution profile response exceeds its limit");
  }
  const text = stdout.trim();
  if (text.startsWith("{") || text.startsWith("[") || /blabee\.distribution-profile|profile_id|bundle_identifier|claude-preview/u.test(`${stdout}${stderr}`)) {
    let value;
    try { value = JSON.parse(stdout); } catch { throw new Error("malformed distribution profile response"); }
    if (!succeeded || stderr !== "" || value === null || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== "bundle_identifier,profile_id,schema_version"
        || value.schema_version !== "blabee.distribution-profile.v1" || value.profile_id !== profile.id
        || value.bundle_identifier !== profile.bundleIdentifier || !stdout.endsWith("\n")) {
      throw new Error("compiled distribution profile does not match the requested app");
    }
    // All three fields are fixed strings. Normalize string escapes and spacing
    // while retaining source key order, so JSON.parse cannot hide duplicate keys.
    const normalized = stdout.replace(/"(?:\\.|[^"\\])*"|\s+/gu,
      token => token.startsWith('"') ? JSON.stringify(JSON.parse(token)) : "");
    if (normalized !== JSON.stringify(value)) throw new Error("malformed distribution profile response");
    return { legacy: false, ...value };
  }
  if (requireExplicit) throw new Error("bundled Claude requires the compiled Blabee distribution profile");
  return { legacy: true, profile_id: BLABEE_PROFILE.id };
}

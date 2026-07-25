import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export const CODEX_APP_SERVER_TIMEOUT_MS = 15_000;
export const CODEX_LOOKBACK_DAYS = 30;
export const CODEX_THREAD_LIMIT = 100;

export type CodexBinaryResolution =
  | {
      ok: true;
      binaryPath: string;
    }
  | {
      ok: false;
      reason: "missing" | "invalid_override";
    };

export async function resolveCodexBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform
): Promise<CodexBinaryResolution> {
  const override = env.BLABASE_CODEX_BINARY_PATH?.trim();
  if (override) {
    if (!isAbsolute(override) || !(await isExecutable(override))) {
      return { ok: false, reason: "invalid_override" };
    }
    return { ok: true, binaryPath: override };
  }

  const candidates = new Set<string>();
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (directory && isAbsolute(directory)) {
      candidates.add(join(directory, "codex"));
    }
  }

  if (env.HOME) {
    candidates.add(join(env.HOME, ".local", "bin", "codex"));
  }
  candidates.add("/opt/homebrew/bin/codex");
  candidates.add("/usr/local/bin/codex");
  if (platform === "darwin") {
    candidates.add("/Applications/Codex.app/Contents/Resources/codex");
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return { ok: true, binaryPath: candidate };
    }
  }
  return { ok: false, reason: "missing" };
}

export function isLocalCodexRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return new URL(request.url).hostname === "localhost";
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

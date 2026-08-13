import { readFileSync } from "node:fs";
import { types as utilTypes } from "node:util";

import type { LocalReadMode } from "./localReadMode";

const ALLOWED_SHARED_ENV_KEYS = new Set([
  "BLABASE_CODEX_BINARY_PATH",
  "BLABASE_LLM_PROVIDER",
  "CHATGPT_SHARE_FETCHER_SECRET",
  "CHATGPT_SHARE_FETCHER_URL",
  "DASHSCOPE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_REDIRECT_URI",
  "GITHUB_APP_SLUG",
  "GOOGLE_CALENDAR_CREDENTIALS_PATH",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "NOTION_OAUTH_CLIENT_ID",
  "NOTION_OAUTH_CLIENT_SECRET",
  "NOTION_OAUTH_REDIRECT_URI",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "QWEN_BASE_URL",
  "QWEN_MODEL"
]);

let loadedPath: string | null = null;

export type SharedLocalEnvSnapshotOptions = {
  cwd?: string;
  mode?: LocalReadMode;
};

/**
 * Creates a request-local environment view without reading accessor properties
 * or mutating the supplied object. Preserve mode is deliberately declared-only:
 * it never consults `.env.local`, a shared env file, or the legacy module cache.
 */
export function createSharedLocalEnvSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  options: SharedLocalEnvSnapshotOptions = {}
): NodeJS.ProcessEnv {
  const mode = options.mode ?? "maintain";
  const snapshot = copyOwnEnvironmentData(env, mode);
  if (mode === "preserve") return snapshot;

  const cwd = options.cwd ?? process.cwd();
  const filePath =
    snapshot.BLABASE_SHARED_ENV_PATH?.trim() ??
    readLocalPointerFile(cwd);
  if (!filePath) return snapshot;

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return snapshot;
  }

  const values = parseSharedEnvText(contents);
  for (const [key, value] of Object.entries(values)) {
    if (ALLOWED_SHARED_ENV_KEYS.has(key) && !snapshot[key]) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

export function loadSharedLocalEnv(
  env: NodeJS.ProcessEnv = process.env
): void {
  const filePath =
    env.BLABASE_SHARED_ENV_PATH?.trim() ?? readLocalPointerFile();
  if (!filePath || loadedPath === filePath) return;

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    // A local pointer may be present in a production bundle, while the pointed
    // file intentionally does not exist in the Worker runtime.
    return;
  }

  const values = parseSharedEnvText(contents);
  for (const [key, value] of Object.entries(values)) {
    if (ALLOWED_SHARED_ENV_KEYS.has(key) && !env[key]) {
      env[key] = value;
    }
  }
  loadedPath = filePath;
}

function readLocalPointerFile(cwd = process.cwd()): string | undefined {
  try {
    const localValues = parseSharedEnvText(
      readFileSync(`${cwd}/.env.local`, "utf8")
    );
    return localValues.BLABASE_SHARED_ENV_PATH?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function copyOwnEnvironmentData(
  env: NodeJS.ProcessEnv,
  mode: LocalReadMode
): NodeJS.ProcessEnv {
  if (utilTypes.isProxy(env)) {
    throw new TypeError("Environment snapshot rejected an unsafe object.");
  }

  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  try {
    descriptors = Object.getOwnPropertyDescriptors(env);
    prototype = Object.getPrototypeOf(env);
  } catch {
    throw new TypeError("Environment snapshot rejected an unsafe object.");
  }

  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (
    mode === "preserve" &&
    (descriptorKeys.some((key) => typeof key !== "string") ||
      descriptorKeys.some((key) => {
        const descriptor = descriptors[key];
        return (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          (typeof descriptor.value !== "string" &&
            descriptor.value !== undefined)
        );
      }) ||
      hasEnumerableInheritedEnvironmentData(prototype))
  ) {
    throw new TypeError("Environment snapshot rejected an unsafe object.");
  }

  const snapshot = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of descriptorKeys) {
    if (typeof key !== "string") continue;
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      (typeof descriptor.value !== "string" &&
        descriptor.value !== undefined)
    ) {
      continue;
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true
    });
  }
  return snapshot;
}

function hasEnumerableInheritedEnvironmentData(
  prototype: object | null
): boolean {
  let current = prototype;
  while (current !== null && current !== Object.prototype) {
    if (utilTypes.isProxy(current)) return true;
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(current);
      current = Object.getPrototypeOf(current);
    } catch {
      return true;
    }
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => descriptors[key]?.enumerable === true
      )
    ) {
      return true;
    }
  }
  return false;
}

export function parseSharedEnvText(text: string): Record<string, string> {
  const output: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    output[key] = parseValue(normalized.slice(separator + 1).trim());
  }

  return output;
}

function parseValue(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if (
    (quote !== `"` && quote !== `'`) ||
    value[value.length - 1] !== quote
  ) {
    return value;
  }
  const unquoted = value.slice(1, -1);
  if (quote === `'`) return unquoted;
  return unquoted
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, `"`)
    .replace(/\\\\/g, "\\");
}

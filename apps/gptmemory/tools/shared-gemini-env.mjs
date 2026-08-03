import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GEMINI_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_BASE_URL",
];
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BLABASE_POINTER_FILE = resolve(
  moduleDirectory,
  "../../blabase/suggestion/.env.local",
);

/**
 * Reuse the private Gemini environment already referenced by Blabase without
 * copying the secret into this project. Only the three Gemini keys are read,
 * existing process values win, and no value is logged.
 */
export async function loadSharedGeminiEnv(
  env = process.env,
  {
    readTextFile = (path) => readFile(path, "utf8"),
    blabasePointerFile = DEFAULT_BLABASE_POINTER_FILE,
  } = {},
) {
  if (hasConfiguredKey(env)) return {};

  let sharedPath =
    env.GPTMEMORY_SHARED_ENV_PATH?.trim() ||
    env.BLABASE_SHARED_ENV_PATH?.trim() ||
    "";

  if (!sharedPath) {
    const pointerText = await readOptionalText(
      blabasePointerFile,
      readTextFile,
    );
    if (pointerText) {
      sharedPath =
        parseEnvText(pointerText).BLABASE_SHARED_ENV_PATH?.trim() || "";
    }
  }

  if (!sharedPath) return {};
  const sharedText = await readOptionalText(sharedPath, readTextFile);
  if (!sharedText) return {};

  const parsed = parseEnvText(sharedText);
  const loaded = {};
  for (const key of GEMINI_ENV_KEYS) {
    if (!env[key] && parsed[key]) loaded[key] = parsed[key];
  }
  return loaded;
}

export function parseEnvText(text) {
  const output = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
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

function hasConfiguredKey(env) {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

async function readOptionalText(path, readTextFile) {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

function parseValue(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  if (
    (quote !== '"' && quote !== "'") ||
    value[value.length - 1] !== quote
  ) {
    return value;
  }

  const unquoted = value.slice(1, -1);
  if (quote === "'") return unquoted;
  return unquoted
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

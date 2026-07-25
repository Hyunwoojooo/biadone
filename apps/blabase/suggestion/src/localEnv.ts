import { readFileSync } from "node:fs";

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

function readLocalPointerFile(): string | undefined {
  try {
    const localValues = parseSharedEnvText(
      readFileSync(`${process.cwd()}/.env.local`, "utf8")
    );
    return localValues.BLABASE_SHARED_ENV_PATH?.trim() || undefined;
  } catch {
    return undefined;
  }
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

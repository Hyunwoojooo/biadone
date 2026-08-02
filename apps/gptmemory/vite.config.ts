import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const DEV_FETCHER_BINDINGS_ENV = "GPTMEMORY_DEV_FETCHER_BINDINGS";
const FETCHER_URL_ENV = "CHATGPT_SHARE_FETCHER_URL";
const FETCHER_SECRET_ENV = "CHATGPT_SHARE_FETCHER_SECRET";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

function getDevFetcherSecrets(): { required: string[] } | undefined {
  if (process.env[DEV_FETCHER_BINDINGS_ENV] !== "1") return undefined;

  const fetcherUrl = process.env[FETCHER_URL_ENV];
  const fetcherSecret = process.env[FETCHER_SECRET_ENV];
  if (!fetcherUrl || !fetcherSecret) {
    throw new Error(
      "GPTMemory dev fetcher bindings require both URL and secret.",
    );
  }

  return {
    required: [FETCHER_URL_ENV, FETCHER_SECRET_ENV],
  };
}

const devFetcherSecrets = getDevFetcherSecrets();

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  ...(devFetcherSecrets ? { secrets: devFetcherSecrets } : {}),
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});

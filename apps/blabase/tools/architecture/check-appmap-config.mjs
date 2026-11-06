import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const projectRoot = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../.."
);
const require = createRequire(import.meta.url);
const appmapEntry = require.resolve("appmap-node");
const { Config } = require(join(dirname(appmapEntry), "config.js"));
const config = new Config(projectRoot);
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8")
);

const failures = [];
const excluded = [
  "src/core/extractors/providers/openai.ts",
  "src/core/golden-sheet/serviceAccount.ts",
  "src/app/generated/client.generated.ts",
  "src/app/page.module.css",
  "suggestion/src/connectors/github/oauth.ts",
  "suggestion/src/connectors/notion/localStore.ts",
  "suggestion/src/generated/contracts.ts",
  "suggestion/app/page.module.css",
  "suggestion/tests/fixtures/private.json"
];
const included = [
  "src/core/adapters/chatgpt-share/index.ts",
  "src/core/adapters/chatgpt-share/normalizeConversation.ts",
  "tests/integration/chatgptShareAdapter.test.ts"
];

for (const relativePath of excluded) {
  if (config.packages.match(resolve(projectRoot, relativePath))) {
    failures.push(`expected AppMap exclusion: ${relativePath}`);
  }
}

for (const relativePath of included) {
  if (!existsSync(resolve(projectRoot, relativePath))) {
    failures.push(`missing reviewed AppMap source: ${relativePath}`);
    continue;
  }
  if (!config.packages.match(resolve(projectRoot, relativePath))) {
    failures.push(`expected AppMap instrumentation: ${relativePath}`);
  }
}

for (const configuredPackage of config.packages) {
  for (const exclusion of configuredPackage.exclude ?? []) {
    if (exclusion.includes("*")) {
      failures.push(`unsupported glob-like AppMap exclusion: ${exclusion}`);
    }
  }
}

const devTraceCommand = packageJson.scripts?.["arch:trace:dev"] ?? "";
if (
  !devTraceCommand.includes("appmap-dev-guard.mjs") ||
  devTraceCommand.includes("appmap-node")
) {
  failures.push(
    "arch:trace:dev must remain fail-closed behind the privacy guard"
  );
}

const fixtureTraceCommand = packageJson.scripts?.["arch:trace:test"] ?? "";
if (!fixtureTraceCommand.includes("chatgptShareAdapter.test.ts")) {
  failures.push(
    "arch:trace:test must remain scoped to the reviewed fixture test"
  );
}

if (failures.length > 0) {
  console.error("AppMap safety configuration failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `AppMap safety configuration valid: ${excluded.length} exclusions, ${included.length} instrumented paths, dev trace fail-closed`
  );
}

import { mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = resolve(projectRoot, "artifacts/architecture");
const depcruise = resolve(projectRoot, "node_modules/.bin/depcruise");
const inputs = [
  "src",
  "tests",
  "tools",
  "suggestion/app",
  "suggestion/src",
  "suggestion/tests",
  "suggestion/tools",
  "suggestion/e2e",
  "suggestion/playwright.config.ts",
  "suggestion/middleware.ts",
  "suggestion/desktop/macos/scripts"
];
const suggestionInputs = [
  "app",
  "src",
  "tests",
  "tools",
  "e2e",
  "playwright.config.ts",
  "middleware.ts",
  "desktop/macos/scripts"
];
const scriptEntryFiles = [
  "eslint.config.mjs",
  "dependency-cruiser.config.mjs",
  "dependency-cruiser.suggestion.config.mjs",
  "dependency-cruiser.scripts.config.mjs",
  "suggestion/eslint.config.mjs"
];
const scriptSearchRoots = [
  "tools",
  "design-mockups",
  "suggestion/tools",
  "suggestion/desktop/macos/scripts"
];
const ignoredDirectoryNames = new Set([
  "node_modules",
  ".next",
  ".local",
  "artifacts",
  "coverage",
  "tmp"
]);

function discoverJavaScriptFiles(relativeDirectory) {
  const entries = readdirSync(resolve(projectRoot, relativeDirectory), {
    withFileTypes: true
  });
  return entries.flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      return ignoredDirectoryNames.has(entry.name)
        ? []
        : discoverJavaScriptFiles(relativePath);
    }
    return /\.(mjs|cjs|js)$/.test(entry.name) ? [relativePath] : [];
  });
}

const scriptInputs = [
  ...scriptEntryFiles,
  ...scriptSearchRoots.flatMap(discoverJavaScriptFiles)
].sort();

mkdirSync(outputRoot, { recursive: true });

function run(args) {
  const result = spawnSync(depcruise, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function captureJson(args) {
  const result = spawnSync(depcruise, ["--output-type", "json", ...args], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout);
}

function assertScriptCoverage(report) {
  const moduleBySource = new Map(
    report.modules.map((module) => [module.source, module])
  );
  const failures = [];

  for (const scriptInput of scriptInputs) {
    if (!moduleBySource.has(scriptInput)) {
      failures.push(`missing JS/MJS source: ${scriptInput}`);
    }
  }

  const expectedDependencies = new Map([
    [
      "suggestion/desktop/macos/scripts/bundle-agent.mjs",
      ["esbuild", "fs/promises"]
    ],
    ["tools/architecture/check-model-links.mjs", ["fs/promises", "path"]]
  ]);
  for (const [source, expected] of expectedDependencies) {
    const actual = new Set(
      (moduleBySource.get(source)?.dependencies ?? []).map(
        (dependency) => dependency.module
      )
    );
    for (const dependency of expected) {
      if (!actual.has(dependency)) {
        failures.push(`missing dependency edge: ${source} -> ${dependency}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("JS/MJS dependency coverage failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `JS/MJS dependency coverage valid: ${scriptInputs.length} entries, 4 sentinel edges`
  );
}

const mode = process.argv[2];

if (mode === "check-scripts") {
  run(["--config", "dependency-cruiser.scripts.config.mjs", ...scriptInputs]);
  assertScriptCoverage(
    captureJson([
      "--config",
      "dependency-cruiser.scripts.config.mjs",
      ...scriptInputs
    ])
  );
} else if (mode === "graph") {
  run([
    "--config",
    "dependency-cruiser.config.mjs",
    "--output-type",
    "mermaid",
    "--output-to",
    "artifacts/architecture/dependencies.mmd",
    "--collapse",
    "^(src/(?:app|components|core)|suggestion/(?:app|src)|tests|tools|suggestion/(?:tests|tools))",
    ...inputs
  ]);
  run([
    "--config",
    "dependency-cruiser.config.mjs",
    "--output-type",
    "mermaid",
    "--output-to",
    "artifacts/architecture/dependencies-main.mmd",
    "--include-only",
    "^(src|tests|tools)/",
    "--collapse",
    "^(src/(?:app|components)|src/core/[^/]+|tests/(?:integration|unit)|tools/[^/]+)",
    ...inputs
  ]);
  run([
    "--config",
    "dependency-cruiser.suggestion.config.mjs",
    "--output-type",
    "mermaid",
    "--output-to",
    "artifacts/architecture/dependencies-suggestion.mmd",
    "--include-only",
    "^(app|src)/",
    "--collapse",
    "^(app|src/[^/]+)",
    ...suggestionInputs
  ]);
  run([
    "--config",
    "dependency-cruiser.scripts.config.mjs",
    "--output-type",
    "mermaid",
    "--output-to",
    "artifacts/architecture/dependencies-scripts.mmd",
    "--collapse",
    "^(tools/[^/]+|design-mockups/[^/]+|suggestion/(?:tools|desktop/macos/scripts)|[^/]+\\.mjs)",
    ...scriptInputs
  ]);
} else if (mode === "report") {
  run([
    "--config",
    "dependency-cruiser.config.mjs",
    "--output-type",
    "err-html",
    "--output-to",
    "artifacts/architecture/dependency-report.html",
    ...inputs
  ]);
  run([
    "--config",
    "dependency-cruiser.suggestion.config.mjs",
    "--output-type",
    "err-html",
    "--output-to",
    "artifacts/architecture/dependency-report-suggestion.html",
    ...suggestionInputs
  ]);
  run([
    "--config",
    "dependency-cruiser.scripts.config.mjs",
    "--output-type",
    "err-html",
    "--output-to",
    "artifacts/architecture/dependency-report-scripts.html",
    ...scriptInputs
  ]);
  run([
    "--config",
    "dependency-cruiser.config.mjs",
    "--output-type",
    "json",
    "--output-to",
    "artifacts/architecture/dependency-cruiser.json",
    ...inputs
  ]);
  run([
    "--config",
    "dependency-cruiser.suggestion.config.mjs",
    "--output-type",
    "json",
    "--output-to",
    "artifacts/architecture/dependency-cruiser-suggestion.json",
    ...suggestionInputs
  ]);
  run([
    "--config",
    "dependency-cruiser.scripts.config.mjs",
    "--output-type",
    "json",
    "--output-to",
    "artifacts/architecture/dependency-cruiser-scripts.json",
    ...scriptInputs
  ]);
} else {
  console.error(
    "Usage: node tools/architecture/dependency-artifacts.mjs <check-scripts|graph|report>"
  );
  process.exit(2);
}

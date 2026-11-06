import repositoryConfig from "./dependency-cruiser.config.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const repositoryRule = (name) =>
  repositoryConfig.forbidden.find((rule) => rule.name === name);

/** @type {import('dependency-cruiser').IConfiguration} */
const suggestionConfig = {
  ...repositoryConfig,
  forbidden: [
    repositoryRule("no-circular-dependencies"),
    {
      name: "no-production-to-tests",
      comment:
        "Suggestion production modules must not import tests or e2e code.",
      severity: "error",
      from: {
        path: [
          "^(app|src|tools|desktop/macos/scripts)(/|$)",
          "^middleware\\.ts$"
        ]
      },
      to: { path: "^(tests|e2e)(/|$)" }
    },
    {
      name: "no-production-to-test-fixtures",
      comment: "Suggestion fixtures and mocks are test inputs only.",
      severity: "error",
      from: {
        path: [
          "^(app|src|tools|desktop/macos/scripts)(/|$)",
          "^middleware\\.ts$"
        ]
      },
      to: { path: "(^|/)(tests?/fixtures|__fixtures__|__mocks__)/" }
    },
    repositoryRule("no-unresolvable-imports"),
    repositoryRule("no-undeclared-packages"),
    {
      name: "no-production-dev-dependencies",
      comment:
        "Suggestion runtime code must not import devDependency-only packages.",
      severity: "error",
      from: {
        path: ["^(app|src|desktop/macos/scripts)(/|$)", "^middleware\\.ts$"]
      },
      to: { dependencyTypes: ["npm-dev"] }
    },
    {
      name: "ui-does-not-import-server-integrations",
      comment:
        "Suggestion non-API app modules importing server integration roots require review.",
      severity: "warn",
      from: { path: "^app/", pathNot: "^app/api/" },
      to: {
        preCompilationOnly: false,
        path: "^src/(connectors|middleware|managedCodex|sync)/"
      }
    }
  ],
  options: {
    ...repositoryConfig.options,
    baseDir: resolve(projectRoot, "suggestion"),
    tsConfig: { fileName: "tsconfig.json" },
    includeOnly: {
      path: "^(app|src|tests|tools|e2e|desktop/macos/scripts)(/|$)|^(playwright\\.config\\.ts|middleware\\.ts)$"
    }
  }
};

export default suggestionConfig;

import repositoryConfig from "./dependency-cruiser.config.mjs";

const repositoryRule = (name) =>
  repositoryConfig.forbidden.find((rule) => rule.name === name);
const {
  tsConfig: _tsConfig,
  tsPreCompilationDeps: _tsPreCompilationDeps,
  exclude: _exclude,
  includeOnly: _includeOnly,
  ...scriptOptions
} = repositoryConfig.options;

/** @type {import('dependency-cruiser').IConfiguration} */
const scriptsConfig = {
  forbidden: [
    repositoryRule("no-circular-dependencies"),
    repositoryRule("no-unresolvable-imports"),
    {
      name: "no-undeclared-script-packages",
      comment: "Executable scripts must declare external packages.",
      severity: "error",
      from: { pathNot: "(^|/)eslint\\.config\\.mjs$" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] }
    },
    {
      name: "eslint-config-transitive-package",
      comment:
        "Existing FlatCompat imports rely on eslint-config-next's transitive @eslint/eslintrc package.",
      severity: "warn",
      from: { path: "(^|/)eslint\\.config\\.mjs$" },
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] }
    }
  ],
  options: scriptOptions
};

export default scriptsConfig;

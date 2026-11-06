/** @type {import('dependency-cruiser').IConfiguration} */
const dependencyCruiserConfig = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      comment:
        "Existing cycles are reported first; promote to error after the baseline is clean and reviewed.",
      severity: "warn",
      from: {},
      to: { circular: true }
    },
    {
      name: "no-production-to-tests",
      comment:
        "Production modules must not depend on test implementation files.",
      severity: "error",
      from: {
        path: "^(src|tools|suggestion/(app|src|tools|desktop/macos/scripts))/"
      },
      to: {
        path: "^(tests|suggestion/tests)/"
      }
    },
    {
      name: "no-production-to-test-fixtures",
      comment:
        "Checked-in fixtures are test inputs, not production dependencies.",
      severity: "error",
      from: {
        path: "^(src|tools|suggestion/(app|src|tools|desktop/macos/scripts))/"
      },
      to: {
        path: "(^|/)(tests?/fixtures|__fixtures__|__mocks__)/"
      }
    },
    {
      name: "no-unresolvable-imports",
      comment: "Imports must resolve to a file or a declared platform module.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: "no-undeclared-packages",
      comment:
        "External imports must be declared in the applicable package.json.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] }
    },
    {
      name: "no-production-dev-dependencies",
      comment:
        "Runtime code must not import a package available only as a devDependency.",
      severity: "error",
      from: {
        path: "^(src|suggestion/(app|src|desktop/macos/scripts))/"
      },
      to: { dependencyTypes: ["npm-dev"] }
    },
    {
      name: "core-does-not-depend-on-ui",
      comment:
        "The main domain/adapter layer must remain independent of App Router and React UI modules.",
      severity: "error",
      from: { path: "^src/core/" },
      to: { path: "^src/(app|components)/" }
    },
    {
      name: "main-does-not-depend-on-suggestion",
      comment:
        "The two npm applications are operationally separate; main runtime code must not reach into suggestion internals.",
      severity: "error",
      from: { path: "^(src|tools)/" },
      to: { path: "^suggestion/" }
    },
    {
      name: "suggestion-does-not-depend-on-main-internals",
      comment:
        "Legacy suggestion ingestion intentionally imports the main conversation adapter/types; keep this visible until a shared package boundary is approved.",
      severity: "warn",
      from: { path: "^suggestion/(app|src|tools)/" },
      to: { path: "^(src|tools)/" }
    },
    {
      name: "ui-does-not-import-server-storage",
      comment:
        "UI components should reach server persistence through routes/services, not the main server store implementation.",
      severity: "warn",
      from: { path: "^src/components/" },
      to: { path: "^src/core/(storage|golden-sheet)/" }
    },
    {
      name: "client-does-not-import-server-integrations",
      comment:
        "Known client UI roots must not import network/provider or credential-bearing server integrations.",
      severity: "warn",
      from: {
        path: ["^src/components/", "^suggestion/app/"],
        pathNot: "^suggestion/app/api/"
      },
      to: {
        preCompilationOnly: false,
        path: [
          "^src/core/(adapters|extractors/providers|golden-sheet|storage)/",
          "^suggestion/src/(connectors|middleware|managedCodex|sync)/"
        ]
      }
    }
  ],
  options: {
    combinedDependencies: true,
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: "specify",
    exclude: { path: "\\.(mjs|cjs|js)$" },
    includeOnly: {
      path: "^(src|tests|tools)(/|$)|^suggestion/(app|src|tests|tools|e2e|desktop/macos/scripts)(/|$)|^suggestion/(playwright\\.config\\.ts|middleware\\.ts)$"
    },
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg"
      ]
    },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "require", "node", "default"],
      exportsFields: ["exports"]
    },
    reporterOptions: {
      mermaid: { minify: false },
      markdown: {
        title: "## Blabase dependency-cruiser report",
        showTitle: true,
        showSummary: true,
        collapseDetails: true,
        showFooter: true
      }
    },
    progress: { type: "none" }
  }
};

export default dependencyCruiserConfig;

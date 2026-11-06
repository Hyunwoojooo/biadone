import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: [
      "tests/dayflowEvidenceContracts.test.ts",
      "tests/dayflowEvidenceExtraction.test.ts",
      "tests/dayflowAblationEvaluation.test.ts"
    ],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true
  }
});

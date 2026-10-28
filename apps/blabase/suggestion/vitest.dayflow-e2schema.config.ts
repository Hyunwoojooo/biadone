import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    clearMocks: true,
    environment: "node",
    include: ["tests/dayflowPreprocessedEvidenceV0_1.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});

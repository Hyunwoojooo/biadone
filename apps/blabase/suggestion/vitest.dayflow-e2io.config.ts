import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    clearMocks: true,
    environment: "node",
    include: ["tests/dayflowEvidenceBundleImport.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});

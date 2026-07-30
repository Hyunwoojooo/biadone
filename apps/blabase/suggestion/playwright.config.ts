import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  reporter: [["line"]],
  use: {
    baseURL: "http://localhost:3199",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "node tools/start-isolated-e2e-server.mjs",
    url: "http://localhost:3199/api/sync/status",
    reuseExistingServer: false,
    timeout: 120_000
  }
});

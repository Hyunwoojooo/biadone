import { defineConfig, devices } from "@playwright/test";

const rawPort = process.env.PLAYWRIGHT_PORT ?? "4173";
if (!/^\d+$/.test(rawPort)) {
  throw new Error("PLAYWRIGHT_PORT must be a numeric TCP port");
}

const port = Number(rawPort);
const baseURL = `http://127.0.0.1:${port}`;
const browserChannel = process.env.PLAYWRIGHT_CHANNEL?.trim();

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/blabee-playwright-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory .`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  },
  projects: [
    {
      name: browserChannel ? `chromium-${browserChannel}` : "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel ? { channel: browserChannel } : {})
      }
    }
  ]
});

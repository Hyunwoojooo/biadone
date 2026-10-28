import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 }
];

for (const viewport of viewports) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} keeps the primary experience intact`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });

    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response?.ok()).toBe(true);

    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator("#hero-title")).toBeVisible();
    await expect(page.locator(".hero .button-yellow")).toBeVisible();
    await expect(page.locator("[data-product-demo]")).toBeVisible();
    await expect(page.locator("[data-product-demo]")).toHaveAttribute("data-demo-state", "decision");
    await expect(page.locator("[data-choice]")).toHaveCount(4);

    const layout = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));

    expect(layout.background).toBe("rgb(0, 0, 0)");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);

    if (viewport.width === 390) {
      const demoBounds = await page.evaluate(() => {
        const terminalLog = document.querySelector(".terminal-log");
        const decisionPanel = document.querySelector(".decision-panel");
        if (!terminalLog || !decisionPanel) return null;

        const terminalLogBox = terminalLog.getBoundingClientRect();
        const decisionPanelBox = decisionPanel.getBoundingClientRect();
        return {
          terminalLogBottom: terminalLogBox.bottom,
          decisionPanelTop: decisionPanelBox.top
        };
      });

      expect(demoBounds).not.toBeNull();
      expect(demoBounds.decisionPanelTop).toBeGreaterThanOrEqual(demoBounds.terminalLogBottom);
    }
  });
}

import { expect, test } from "@playwright/test";

test.describe("reduced motion", () => {
  test("keeps a stable, interactive decision state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response?.ok()).toBe(true);

    const html = page.locator("html");
    const demo = page.locator("[data-product-demo]");
    const choices = page.locator("[data-choice]");

    await expect(html).toHaveAttribute("data-motion", "reduced");
    await expect(demo).toHaveAttribute("data-demo-state", "decision");
    await expect(choices).toHaveCount(4);

    for (const choice of await choices.all()) {
      await expect(choice).toBeVisible();
      await expect(choice).toBeEnabled();
    }

    await page.waitForTimeout(5_250);
    await expect(demo).toHaveAttribute("data-demo-state", "decision");
    await expect(demo).not.toHaveAttribute("data-selected-choice", /.+/);
  });
});

test.describe("asset failure", () => {
  test("missing local GSAP files degrade to visible static content", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.route(/\/js\/vendor\/(?:gsap|ScrollTrigger)\.min\.js(?:\?.*)?$/, (route) => route.abort());

    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response?.ok()).toBe(true);

    await expect(page.locator("html")).toHaveAttribute("data-motion", "static");
    await expect(page.locator("#hero-title")).toBeVisible();
    await expect(page.locator("[data-product-demo]")).toHaveAttribute("data-demo-state", "decision");

    const choices = page.locator("[data-choice]");
    await expect(choices).toHaveCount(4);
    for (const choice of await choices.all()) {
      await expect(choice).toBeVisible();
      await expect(choice).toBeEnabled();
    }

    expect(pageErrors).toEqual([]);
  });
});

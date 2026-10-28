import { expect, test } from "@playwright/test";

test("the rendered page is English-only", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-locale], .language-switch")).toHaveCount(0);
  await expect(page.locator("meta[property='og:locale']")).toHaveAttribute("content", "en_US");
  await expect(page.locator("meta[property='og:locale:alternate']")).toHaveCount(0);

  const visibleCopy = await page.locator("body").innerText();
  expect(visibleCopy).not.toMatch(/[\u3131-\u318E\uAC00-\uD7A3]/);
});

test("the first Tab exposes the skip link inside the viewport", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);

  await page.keyboard.press("Tab");

  const skipLink = page.locator(".skip-link");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  const box = await skipLink.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the beta form fails closed", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);

    const fallback = page.locator("[data-no-js-form-message]");
    await expect(fallback).toBeVisible();
    await expect(fallback).not.toBeEmpty();

    await expect(page.locator("[data-beta-form] [data-js-required]")).not.toHaveCount(0);

    const formControls = page.locator("[data-beta-form] input, [data-beta-form] button, [data-beta-form] select, [data-beta-form] textarea");
    expect(await formControls.count()).toBeGreaterThan(0);
    for (const control of await formControls.all()) {
      await expect(control).toBeDisabled();
    }
  });
});

test("social preview metadata resolves to the shipped 1200x630 image", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);

  const ogImage = await page.locator("meta[property='og:image']").getAttribute("content");
  const twitterImage = await page.locator("meta[name='twitter:image']").getAttribute("content");

  expect(ogImage).toBeTruthy();
  expect(twitterImage).toBe(ogImage);

  const publicURL = new URL(ogImage);
  expect(publicURL.origin).toBe("https://blabee.com");

  const localPath = `${publicURL.pathname}${publicURL.search}`;
  const imageResponse = await page.request.get(localPath);
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()["content-type"]).toMatch(/^image\//);

  const dimensions = await page.evaluate((src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Could not load social image: ${src}`));
    image.src = src;
  }), localPath);

  expect(dimensions).toEqual({ width: 1200, height: 630 });
});

test("robots.txt and sitemap.xml expose the canonical public URL", async ({ request }) => {
  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.ok()).toBe(true);
  expect(robotsResponse.headers()["content-type"]).toMatch(/^text\/plain/);
  const robots = await robotsResponse.text();
  expect(robots).toMatch(/^User-agent:\s*\*/m);
  expect(robots).toMatch(/^Allow:\s*\/$/m);
  expect(robots).toMatch(/^Sitemap:\s*https:\/\/blabee\.com\/sitemap\.xml$/m);

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  expect(sitemapResponse.headers()["content-type"]).toMatch(/^(?:application|text)\/xml/);
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toMatch(/<urlset\b/);
  expect(sitemap).toMatch(/<loc>https:\/\/blabee\.com\/<\/loc>/);
});

test("the custom 404 page is English and excluded from indexing", async ({ page }) => {
  const response = await page.goto("/404.html", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
  await expect(page.locator("#not-found-title")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
});

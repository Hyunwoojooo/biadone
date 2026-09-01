import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const fullPageMaterialRegions = [
  {
    name: "benefits",
    surface: ".section-benefits .section-grid",
    deck: ".editorial-list",
    row: ".editorial-row",
  },
  {
    name: "how it works",
    surface: ".section-how > .container",
    deck: ".steps-list",
    row: ".steps-list > li",
  },
  {
    name: "private beta scope",
    surface: ".section-beta-scope .section-grid",
    deck: ".scope-table",
    row: ".scope-table > div",
  },
  {
    name: "FAQ",
    surface: ".section-faq .section-grid",
    deck: ".faq-list",
    row: ".faq-list details",
  },
  { name: "signup", surface: ".signup-grid", deck: ".signup-form", row: null },
  { name: "footer", surface: ".footer-inner", deck: null, row: null },
];

function observeErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    requestErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) requestErrors.push(`${response.status()} ${response.url()}`);
  });

  return { consoleErrors, pageErrors, requestErrors };
}

for (const viewport of viewports) {
  test(`liquid glass ${viewport.name} ${viewport.width}x${viewport.height} stays usable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = observeErrors(page);

    const response = await page.goto("/liquid-glass/", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toHaveClass(/\bliquid-glass\b/);
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator("#hero-title")).toBeVisible();
    await expect(page.locator("[data-product-demo]")).toBeVisible();
    await expect(page.locator("[data-choice]")).toHaveCount(4);

    const layout = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.background).toBe("rgb(0, 0, 0)");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);

    const glass = await page.locator(".demo-window").evaluate((element) => {
      const styles = getComputedStyle(element);
      const supportsBackdrop =
        CSS.supports("backdrop-filter", "blur(1px)") ||
        CSS.supports("-webkit-backdrop-filter", "blur(1px)");
      return {
        radius: styles.borderRadius,
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        backdrop: styles.backdropFilter || styles.webkitBackdropFilter,
        supportsBackdrop,
      };
    });

    expect(glass.radius).toBe(viewport.width <= 760 ? "24px" : "30px");
    expect(`${glass.backgroundColor} ${glass.backgroundImage}`).not.toBe("rgba(0, 0, 0, 0) none");
    if (glass.supportsBackdrop) {
      expect(glass.backdrop).toContain("blur(");
    } else {
      expect(glass.backgroundColor).toBe("rgb(17, 18, 22)");
      expect(glass.backdrop).toBe("none");
    }

    for (const { surface } of fullPageMaterialRegions) {
      await expect(page.locator(surface)).toBeVisible();
    }

    const materialEvidence = await page.evaluate((regions) => {
      const transparent = "rgba(0, 0, 0, 0)";
      const supportsBackdrop =
        CSS.supports("backdrop-filter", "blur(1px)") ||
        CSS.supports("-webkit-backdrop-filter", "blur(1px)");

      function alpha(color) {
        if (!color || color === "transparent" || color === transparent) return 0;
        const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/i);
        return rgba ? Number(rgba[1]) : 1;
      }

      function readStyle(element, pseudo = null) {
        if (!element) return null;
        const styles = getComputedStyle(element, pseudo);
        const backgroundAlpha = alpha(styles.backgroundColor);
        const backdrop = styles.backdropFilter || styles.webkitBackdropFilter || "none";
        const activePseudo = pseudo === null || !["none", "normal", ""].includes(styles.content);
        const borderWidths = [
          styles.borderTopWidth,
          styles.borderRightWidth,
          styles.borderBottomWidth,
          styles.borderLeftWidth,
        ].map(Number.parseFloat);
        const borderColors = [
          styles.borderTopColor,
          styles.borderRightColor,
          styles.borderBottomColor,
          styles.borderLeftColor,
        ].map(alpha);
        return {
          activePseudo,
          backgroundColor: styles.backgroundColor,
          translucent:
            activePseudo &&
            (styles.backgroundImage !== "none" || (backgroundAlpha > 0 && backgroundAlpha < 1)),
          blur: activePseudo && backdrop.includes("blur("),
          radius: activePseudo ? parseFloat(styles.borderTopLeftRadius) : 0,
          rim:
            activePseudo &&
            (borderWidths.some((width, index) => width > 0 && borderColors[index] > 0) ||
              styles.boxShadow !== "none"),
          divider: activePseudo && borderWidths.some((width) => width > 0),
        };
      }

      return {
        supportsBackdrop,
        regions: regions.map(({ name, surface, deck, row }) => {
          return {
            name,
            surface: readStyle(document.querySelector(surface)),
            deck: deck ? readStyle(document.querySelector(deck)) : null,
            row: row ? readStyle(document.querySelector(row)) : null,
          };
        }),
      };
    }, fullPageMaterialRegions);

    for (const region of materialEvidence.regions) {
      const expectedSurfaceRadius =
        region.name === "footer"
          ? viewport.width <= 760 ? 18 : 20
          : viewport.width <= 760 ? 24 : viewport.width <= 900 ? 26 : 30;

      expect(region.surface, `${region.name} primary glass surface must exist`).not.toBeNull();
      expect(region.surface.radius, `${region.name} must preserve its responsive glass radius`).toBe(expectedSurfaceRadius);
      expect(region.surface.rim, `${region.name} must render a glass rim or material shadow`).toBe(true);
      if (materialEvidence.supportsBackdrop) {
        expect(region.surface.translucent, `${region.name} must render a translucent or gradient glass fill`).toBe(true);
        expect(region.surface.blur, `${region.name} must render backdrop blur when supported`).toBe(true);
      } else {
        expect(region.surface.backgroundColor).toBe("rgb(17, 18, 22)");
        expect(region.surface.blur).toBe(false);
      }

      if (region.deck) {
        expect(region.deck.translucent, `${region.name} must render a continuous inset deck`).toBe(true);
        expect(region.deck.radius, `${region.name} inset deck must use the section radius`).toBe(20);
        expect(region.deck.rim, `${region.name} inset deck must retain a visible rim`).toBe(true);
        expect(region.deck.blur, `${region.name} inset deck must not stack another backdrop blur`).toBe(false);
      }

      if (region.row) {
        expect(region.row.translucent, `${region.name} rows must remain readable on the shared deck`).toBe(true);
        expect(region.row.radius, `${region.name} rows must remain continuous rather than floating cards`).toBe(0);
        expect(region.row.divider, `${region.name} rows must retain a separating rim`).toBe(true);
        expect(region.row.blur, `${region.name} rows must not stack another backdrop blur`).toBe(false);
      }
    }

    if (viewport.width === 390) {
      const demoBounds = await page.evaluate(() => {
        const terminalLog = document.querySelector(".terminal-log");
        const decisionPanel = document.querySelector(".decision-panel");
        if (!terminalLog || !decisionPanel) return null;
        const terminalLogBox = terminalLog.getBoundingClientRect();
        const decisionPanelBox = decisionPanel.getBoundingClientRect();
        return {
          terminalLogBottom: terminalLogBox.bottom,
          decisionPanelTop: decisionPanelBox.top,
        };
      });
      expect(demoBounds).not.toBeNull();
      expect(demoBounds.decisionPanelTop).toBeGreaterThanOrEqual(demoBounds.terminalLogBottom);
    }

    if (viewport.name === "desktop") {
      const heroPanelBounds = await page.evaluate(() => {
        const copy = document.querySelector(".hero-copy");
        const demo = document.querySelector(".demo-window");
        if (!copy || !demo) return null;

        const copyBox = copy.getBoundingClientRect();
        const demoBox = demo.getBoundingClientRect();
        return {
          copy: { top: copyBox.top, height: copyBox.height, bottom: copyBox.bottom },
          demo: { top: demoBox.top, height: demoBox.height, bottom: demoBox.bottom },
        };
      });

      expect(heroPanelBounds).not.toBeNull();
      for (const edge of ["top", "height", "bottom"]) {
        expect(
          Math.abs(heroPanelBounds.copy[edge] - heroPanelBounds.demo[edge]),
          `desktop hero ${edge} alignment must stay within 1px`,
        ).toBeLessThanOrEqual(1);
      }
    }

    await page.keyboard.press("Tab");
    const skipLink = page.locator(".skip-link");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    const skipLinkBox = await skipLink.boundingBox();
    expect(skipLinkBox).not.toBeNull();
    expect(skipLinkBox.x).toBeGreaterThanOrEqual(0);
    expect(skipLinkBox.y).toBeGreaterThanOrEqual(0);
    expect(skipLinkBox.x + skipLinkBox.width).toBeLessThanOrEqual(viewport.width);
    expect(skipLinkBox.y + skipLinkBox.height).toBeLessThanOrEqual(viewport.height);

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.requestErrors).toEqual([]);
  });
}

test("liquid-glass interactions keep Option+2, FAQ, and fail-closed signup behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = observeErrors(page);

  const response = await page.goto("/liquid-glass/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const demo = page.locator("[data-product-demo]");
  await demo.focus();
  await page.keyboard.press("Alt+2");
  await expect(demo).toHaveAttribute("data-selected-choice", "2");
  await expect(demo).toHaveAttribute("data-demo-state", "review");
  await expect(page.locator('[data-choice="2"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-demo-details]")).toBeVisible();

  const faqItems = page.locator(".faq-list details");
  await faqItems.nth(0).locator("summary").click();
  await expect(faqItems.nth(0)).toHaveAttribute("open", "");
  await faqItems.nth(1).locator("summary").click();
  await expect(faqItems.nth(1)).toHaveAttribute("open", "");
  await expect(faqItems.nth(0)).not.toHaveAttribute("open", "");

  const form = page.locator("[data-beta-form]");
  await form.locator('input[name="email"]').fill("tester@example.com");
  await form.locator('button[type="submit"]').click();
  await expect(form.locator("[data-form-error]")).toBeVisible();
  await expect(form.locator("[data-form-success]")).toBeHidden();
  await expect(form.locator('button[type="submit"]')).toBeEnabled();

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.requestErrors).toEqual([]);
});

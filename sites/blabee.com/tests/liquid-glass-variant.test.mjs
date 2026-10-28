import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COPY } from "../js/content.js";

const root = new URL("../", import.meta.url);
const [rootHtml, variantHtml, variantCss] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("liquid-glass/index.html", root), "utf8"),
  readFile(new URL("css/liquid-glass.css", root), "utf8"),
]);

function attributeValues(markup, tagName, attributeName) {
  return [...markup.matchAll(new RegExp(`<${tagName}\\b[^>]*\\b${attributeName}=["']([^"']+)["'][^>]*>`, "gi"))]
    .map((match) => match[1]);
}

function assertRootRelative(values, label) {
  assert.ok(values.length > 0, `${label} references must be present`);
  for (const value of values) {
    assert.match(value, /^\/(?!\/)/, `${label} reference must be root-relative: ${value}`);
  }
}

function alphaColorSource(red, green, blue, alphaSource) {
  return [
    `rgba\\(\\s*${red}\\s*,\\s*${green}\\s*,\\s*${blue}\\s*,\\s*${alphaSource}\\s*\\)`,
    `rgb\\(\\s*${red}\\s+${green}\\s+${blue}\\s*\\/\\s*${alphaSource}\\s*\\)`,
  ].join("|");
}

function cssRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
    selector: selector.trim(),
    declarations: declarations.trim(),
  }));
}

function materialRulesFor(selectorFragment) {
  return cssRules(variantCss).filter(({ selector, declarations }) =>
    selector.includes(".liquid-glass") &&
    selector.includes(selectorFragment) &&
    /(?:backdrop-filter|box-shadow|border(?:-\w+)?\s*:|background\s*:\s*(?:rgba?\(|(?:linear|radial)-gradient|var\(--glass))/i.test(declarations)
  );
}

test("the liquid-glass comparison route is isolated and excluded from indexing", () => {
  assert.match(variantHtml, /<body\s+class=["'][^"']*\bliquid-glass\b[^"']*["']/i);
  assert.match(variantHtml, /<meta\s+name=["']robots["']\s+content=["']noindex,\s*follow["']\s*\/?>/i);
  assert.match(variantHtml, /<link\s+rel=["']canonical["']\s+href=["']https:\/\/blabee\.com\/["']\s*\/?>/i);
  assert.match(variantHtml, /<meta\s+property=["']og:url["']\s+content=["']https:\/\/blabee\.com\/["']\s*\/?>/i);

  const baseCssPosition = variantHtml.indexOf("/css/style.css");
  const overrideCssPosition = variantHtml.indexOf("/css/liquid-glass.css");
  assert.ok(baseCssPosition >= 0, "the variant must load the base stylesheet");
  assert.ok(overrideCssPosition > baseCssPosition, "the glass override must load after the base stylesheet");
  assert.doesNotMatch(rootHtml, /liquid-glass\.css/i);
});

test("all executable and visual variant assets are local and root-relative", () => {
  const stylesheetHrefs = [...variantHtml.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);
  const faviconHrefs = [...variantHtml.matchAll(/<link\b[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);
  const scriptSources = attributeValues(variantHtml, "script", "src");
  const svgSources = attributeValues(variantHtml, "img", "src").filter((source) => /\.svg(?:[?#]|$)/i.test(source));

  assertRootRelative(stylesheetHrefs, "stylesheet");
  assertRootRelative(faviconHrefs, "favicon");
  assertRootRelative(scriptSources, "script");
  assertRootRelative(svgSources, "SVG");

  assert.doesNotMatch(variantHtml, /<style\b/i);
  assert.doesNotMatch(variantHtml, /\sstyle\s*=/i);
  assert.doesNotMatch(variantHtml, /\son[a-z]+\s*=/i);

  const scriptTags = [...variantHtml.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scriptTags.length > 0, "the shared scripts must be present");
  for (const [, attributes] of scriptTags) {
    assert.match(attributes, /\bsrc=["']\/(?!\/)/i, "inline or external scripts are not allowed");
  }

  assert.doesNotMatch(stylesheetHrefs.join("\n"), /^https?:|^\/\//im);
  assert.doesNotMatch(scriptSources.join("\n"), /^https?:|^\/\//im);
});

test("the comparison route preserves the complete product narrative and interaction hooks", () => {
  for (const className of [
    "site-header",
    "hero",
    "section-benefits",
    "section-how",
    "section-beta-scope",
    "section-faq",
    "site-footer",
  ]) {
    assert.match(variantHtml, new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`));
  }
  assert.match(variantHtml, /\bid=["']beta["']/);

  assert.equal((variantHtml.match(/data-choice=["'][1-4]["']/g) ?? []).length, 4);
  assert.match(variantHtml, /class=["'](?=[^"']*\bdemo-window\b)(?=[^"']*\bglass-panel\b)[^"']*["']/i);
  assert.match(variantHtml, /class=["'](?=[^"']*\bdecision-panel\b)(?=[^"']*\bglass-panel\b)[^"']*["']/i);
  assert.equal((variantHtml.match(/class=["'](?=[^"']*\bdecision-option\b)(?=[^"']*\bglass-inset\b)[^"']*["']/gi) ?? []).length, 4);
  assert.match(variantHtml, /class=["'](?=[^"']*\bsignup-form\b)(?=[^"']*\bglass-soft\b)[^"']*["']/i);
  for (const choice of ["1", "2", "3", "4"]) {
    assert.match(variantHtml, new RegExp(`data-choice=["']${choice}["']`));
    assert.match(variantHtml, new RegExp(`<kbd\\b[^>]*>⌥${choice}<\\/kbd>`));
  }
  assert.match(variantHtml, /Review auth architecture/);

  for (const hook of [
    "data-beta-form",
    "data-submit-label",
    "data-no-js-form-message",
    "data-form-error",
    "data-form-success",
    "data-js-required",
  ]) {
    assert.match(variantHtml, new RegExp(`\\b${hook}\\b`));
  }
  for (const key of ["signup.loading", "signup.error", "signup.successTitle", "signup.successBody"]) {
    assert.ok(COPY[key], `${key} must remain available to the shared form runtime`);
  }
  assert.match(variantHtml, /<script\s+type=["']module["']\s+src=["']\/js\/main\.js(?:\?[^"']*)?["']/i);
});

test("glass tokens derive from the Blabee app surface system", () => {
  for (const [nameSource, value] of [
    ["glass-(?:radius-panel|panel-radius)", "30px"],
    ["glass-(?:radius-section|section-radius)", "20px"],
    ["glass-(?:radius-row|row-radius)", "18px"],
    ["glass-(?:radius-key|key-radius)", "8px"],
    ["glass-rim-width", "0.75px"],
    ["glass-blur", "28px"],
    ["glass-saturation", "135%"],
  ]) {
    assert.match(variantCss, new RegExp(`--${nameSource}:\\s*${value.replace(".", "\\.")}\\s*;`, "i"));
  }

  for (const [tokenSource, colorSource] of [
    ["glass-(?:inset|inset-fill)", alphaColorSource(255, 255, 255, "0\\.065")],
    ["glass-inset-emphasized", alphaColorSource(255, 255, 255, "0\\.10?")],
    ["glass-inset-rim", alphaColorSource(255, 255, 255, "0\\.13")],
    ["glass-accent-rim", alphaColorSource(254, 231, 21, "0\\.32")],
    ["glass-panel-fill", alphaColorSource(8, 9, 11, "0\\.68")],
  ]) {
    assert.match(variantCss, new RegExp(`--${tokenSource}:\\s*(?:${colorSource})\\s*;`, "i"));
  }

  for (const rimStop of [
    alphaColorSource(255, 255, 255, "0\\.24"),
    alphaColorSource(255, 255, 255, "0\\.08"),
    alphaColorSource(0, 0, 0, "0\\.34"),
  ]) {
    assert.match(variantCss, new RegExp(`(?:${rimStop})`, "i"));
  }
});

test("liquid glass material spans every major narrative section", () => {
  const regions = [
    { name: "benefits", surface: ".section-benefits .section-grid", inset: [".editorial-list", ".editorial-row"] },
    { name: "how it works", surface: ".section-how > .container", inset: [".steps-list"] },
    { name: "private beta scope", surface: ".section-beta-scope .section-grid", inset: [".scope-table"] },
    { name: "FAQ", surface: ".section-faq .section-grid", inset: [".faq-list"] },
    { name: "signup", surface: ".signup-grid", inset: [".signup-form"] },
    { name: "footer", surface: ".footer-inner", inset: [] },
  ];

  for (const { name, surface, inset } of regions) {
    assert.ok(
      materialRulesFor(surface).length > 0,
      `${name} primary surface must receive a body.liquid-glass-scoped material layer`,
    );
    if (inset.length > 0) {
      assert.ok(
        inset.some((selector) => materialRulesFor(selector).length > 0),
        `${name} content must include a scoped glass deck or inset surface`,
      );
    }
  }

  assert.ok(
    materialRulesFor(".hero-copy::before").length > 0,
    "the hero copy must keep a scoped, weak glass reading pane",
  );

  assert.doesNotMatch(
    variantCss,
    /(?:^|})\s*\.(?:section-benefits|section-how|section-beta-scope|section-faq|signup-section|site-footer)(?=[\s:{,.#>+~])/m,
    "full-page material overrides must remain isolated under .liquid-glass",
  );
});

test("glass remains legible with blur unsupported or reduced transparency requested", () => {
  assert.match(variantCss, /(?:^|\s)backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturation\)\)/i);
  assert.match(variantCss, /-webkit-backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturation\)\)/i);

  const unsupportedStart = variantCss.indexOf("@supports not");
  const reducedTransparencyStart = variantCss.indexOf("@media (prefers-reduced-transparency: reduce)");
  assert.ok(unsupportedStart >= 0, "an unsupported-backdrop fallback must be present");
  assert.ok(reducedTransparencyStart > unsupportedStart, "a reduced-transparency fallback must be present");

  const unsupportedFallback = variantCss.slice(unsupportedStart, reducedTransparencyStart);
  const reducedTransparencyFallback = variantCss.slice(reducedTransparencyStart);
  assert.match(unsupportedFallback, /#111216/i);
  assert.match(reducedTransparencyFallback, /#111216/i);
  assert.match(reducedTransparencyFallback, /backdrop-filter:\s*none/i);
  assert.match(reducedTransparencyFallback, /-webkit-backdrop-filter:\s*none/i);
  assert.match(reducedTransparencyFallback, /#1c1d22/i);
});

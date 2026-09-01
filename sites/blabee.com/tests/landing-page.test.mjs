import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COPY } from "../js/content.js";

const root = new URL("../", import.meta.url);
const [html, notFound, css, javascript, svg, socialImage, robots, sitemap, headers, packageJson, gsapVendor, scrollTriggerVendor] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("404.html", root), "utf8"),
  readFile(new URL("css/style.css", root), "utf8"),
  readFile(new URL("js/main.js", root), "utf8"),
  readFile(new URL("assets/blabee-menu-bar.svg", root), "utf8"),
  readFile(new URL("assets/og-blabee.png", root)),
  readFile(new URL("robots.txt", root), "utf8"),
  readFile(new URL("sitemap.xml", root), "utf8"),
  readFile(new URL("_headers", root), "utf8"),
  readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  readFile(new URL("js/vendor/gsap.min.js", root), "utf8"),
  readFile(new URL("js/vendor/ScrollTrigger.min.js", root), "utf8")
]);

test("the published experience is English-only", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Blabee — One small decision\. Don’t go back to the terminal\.<\/title>/);
  assert.match(html, /One small decision\./);
  assert.match(html, /Don’t go back to the terminal\./);
  assert.doesNotMatch(html, /data-locale=|language-switch|og:locale:alternate/);
  assert.doesNotMatch(html, /[\u3131-\u318E\uAC00-\uD7A3]/);
  assert.doesNotMatch(Object.values(COPY).join("\n"), /[\u3131-\u318E\uAC00-\uD7A3]/);
  assert.doesNotMatch(javascript, /applyLocale|LOCALE_STORAGE_KEY|data-i18n/);
});

test("the demo and claims match the current ranked-action runtime", () => {
  assert.equal((html.match(/data-choice="[1-4]"/g) ?? []).length, 4);
  assert.equal((html.match(/<kbd>⌥[1-4]<\/kbd>/g) ?? []).length, 4);
  assert.equal(COPY["demo.choice2"], "Review auth architecture");
  assert.equal(COPY["demo.choice3"], "Add session rotation tests");
  assert.equal(COPY["demo.choice4"], "Inspect auth edge cases");
  assert.match(COPY["how.step1Body"], /two to four/);
  assert.match(COPY["faq.a1"], /Codex creates the choices/);
  assert.match(COPY["faq.a2"], /original Codex session/);
  assert.match(COPY["faq.a4"], /Codex-first/);
  assert.match(COPY["faq.a5"], /does not add a separate LLM API key/);
  assert.doesNotMatch(`${html}\n${Object.values(COPY).join("\n")}`, /Restore pre-prompt|Pause this task|\brollback\b/i);
  assert.match(javascript, /if \(!event\.altKey/);
  assert.match(javascript, /\^Digit\(\[1-4\]\)\$/);
});

test("all required narrative sections and form states are present", () => {
  for (const marker of [
    "class=\"site-header\"",
    "class=\"hero\"",
    "section-benefits",
    "section-how",
    "section-beta-scope",
    "section-faq",
    "id=\"beta\"",
    "class=\"site-footer\""
  ]) {
    assert.match(html, new RegExp(marker));
  }

  for (const key of ["signup.loading", "signup.error", "signup.successTitle", "signup.successBody"]) {
    assert.ok(COPY[key]);
  }

  assert.match(javascript, /if \(!endpoint\) \{[\s\S]*renderFormState\("error"\)/);
  assert.match(javascript, /if \(!response\.ok\) throw new Error/);
  assert.match(javascript, /button\.disabled = !choicesAreAvailable/);
  assert.match(html, /data-no-js-form-message/);
  assert.match(html, /required disabled data-js-required/);
  assert.match(html, /type="submit" disabled data-js-required/);
  assert.doesNotMatch(html, /\bnovalidate\b/);
  assert.match(javascript, /jsRequiredControls\.forEach/);
});

test("the visual system uses the approved screen color approximations without generic effects", () => {
  assert.match(css, /--jet: #000000;/i);
  assert.match(css, /--jet-deep: #000000;/i);
  assert.match(css, /--ink: #000000;/i);
  assert.match(css, /--yellow: #fee715;/i);
  assert.match(html, /meta name="theme-color" content="#000000"/i);
  assert.match(css, /body \{[\s\S]*background: var\(--jet\)/);
  assert.match(css, /\.site-header \{[\s\S]*background: rgba\(0, 0, 0, 0\.94\)/);
  assert.match(css, /\.site-header\.is-scrolled \{[\s\S]*background: rgba\(0, 0, 0, 0\.98\)/);
  assert.match(css, /\.section-how \{\s*background: var\(--jet\);\s*\}/);
  assert.match(css, /\.section-faq \{\s*background: var\(--jet\);\s*\}/);
  assert.match(css, /\.signup-section \{[\s\S]*?background: var\(--jet\);/);
  assert.match(css, /\.site-footer \{[\s\S]*?background: var\(--jet\);/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|#fff(?:fff)?\b/i);
});

test("the canonical product mark and supplied accessibility metadata are wired", () => {
  assert.match(svg, /viewBox="0 0 28 24"/);
  assert.match(html, /assets\/blabee-menu-bar\.svg/);
  assert.match(html, /href="favicon\.ico"/);
  assert.equal(COPY["metadata.brandAria"], "Blabee home");
  assert.match(COPY["metadata.demoAria"], /same agent session/);
});

test("social discovery assets use the canonical public URLs", () => {
  assert.match(html, /property="og:image" content="https:\/\/blabee\.com\/assets\/og-blabee\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:image" content="https:\/\/blabee\.com\/assets\/og-blabee\.png"/);
  assert.equal(socialImage.readUInt32BE(16), 1200);
  assert.equal(socialImage.readUInt32BE(20), 630);
  assert.match(robots, /Sitemap: https:\/\/blabee\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/blabee\.com\/<\/loc>/);
  assert.match(notFound, /meta name="robots" content="noindex, follow"/);
  assert.match(notFound, /<html lang="en">/);
  assert.match(notFound, /href="\/css\/style\.css\?/);
  assert.match(notFound, /src="\/assets\/blabee-menu-bar\.svg"/);
});

test("deployment headers keep a strict self-hosted CSP and revalidating caches", () => {
  assert.match(headers, /Content-Security-Policy: default-src 'self';[\s\S]*script-src 'self'; style-src 'self'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.doesNotMatch(headers, /'unsafe-inline'|'unsafe-eval'/);
  assert.match(headers, /\/assets\/\*[\s\S]*Cache-Control: public, max-age=3600, must-revalidate/);
  assert.doesNotMatch(headers, /\bimmutable\b/);
});

test("GSAP and ScrollTrigger are pinned, self-hosted, and retain their license banners", () => {
  assert.equal(packageJson.dependencies?.gsap, "3.15.0");
  assert.match(html, /src="js\/vendor\/gsap\.min\.js(?:\?[^\"]*)?"/);
  assert.match(html, /src="js\/vendor\/ScrollTrigger\.min\.js(?:\?[^\"]*)?"/);
  assert.doesNotMatch(html, /src="https?:\/\/[^\"]*(?:gsap|ScrollTrigger)/i);

  for (const vendor of [gsapVendor, scrollTriggerVendor]) {
    assert.match(vendor, /3\.15\.0/);
    assert.match(vendor, /https:\/\/gsap\.com/);
    assert.match(vendor, /standard-license/);
  }
});

test("motion is progressive, reduced-motion safe, and manual choices stop autoplay", () => {
  assert.match(javascript, /gsap\.registerPlugin\(\s*ScrollTrigger\s*\)/);
  assert.match(javascript, /gsap\.matchMedia\(\)/);
  assert.match(javascript, /prefers-reduced-motion:\s*reduce/);
  assert.match(javascript, /function stopDemoAutoplay\s*\(/);
  assert.match(javascript, /stopDemoAutoplay\(\)/);
  assert.doesNotMatch(javascript, /demoTimers/);
  assert.doesNotMatch(javascript, /(?:window\.)?setTimeout\s*\(/);
  assert.match(html, /class="terminal" aria-live="off"/);
});

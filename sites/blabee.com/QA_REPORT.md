# Blabee Landing Page QA Report

Date: 2026-09-01

## Result

The English-only static landing page is implemented, staged through an explicit public-file allowlist, and deployed to a Cloudflare Pages preview. The pure `#000000` canvas, Blazing Yellow interaction signals, deterministic social card, responsive layout, progressive GSAP motion, no-JavaScript form guard, discovery files, response headers, and custom 404 all pass local and public-origin checks.

An isolated PetView Liquid Glass comparison is also deployed at `/liquid-glass/`. The canonical root remains unchanged; the comparison route retains the existing composition and now carries the app-derived material language through the hero, benefits, how-it-works, private-beta scope, FAQ, signup, and footer. Each major region uses one outer glass sheet with a continuous, non-blurred inset deck so the page reads as one system rather than a collection of floating cards. It is marked `noindex, follow`, points canonical and Open Graph URLs back to `https://blabee.com/`, and is excluded from the sitemap.

The public copy was also corrected against the current Blabee runtime: it now shows the default `Option+1`–`Option+4` shortcuts, describes two to four ranked actions, and no longer presents pause or rollback as enabled fixed slots. Detailed source evidence is in `PRODUCT_RUNTIME_AUDIT.md`.

## Automated checks

- `npm run check` — passed
- `npm run build:public` — passed; the generated `dist/` contains only the approved public allowlist
- `npm test` — 19/19 passed
- `npm run test:e2e` — 15/15 passed in actual Chromium
- GSAP Core and ScrollTrigger 3.15.0 — exact dependency, self-hosted vendor files, and retained Standard License banners verified
- Social PNG — exact 1200 × 630 RGB image with a `#000000` background; metadata uses absolute `https://blabee.com/` URLs
- `robots.txt`, `sitemap.xml`, and a noindex custom `404.html` — canonical discovery and soft-404 handling verified
- CSP — self-only scripts/styles/assets, no `unsafe-inline` or `unsafe-eval`
- Asset caching — short revalidation policy; the previous one-year immutable policy for non-fingerprinted filenames was removed

## Browser checks

Verified locally and again on `https://blabee-landing-preview.pages.dev/`:

- 390 × 844 mobile — no horizontal overflow; header CTA, hero CTA, and the product interaction remain legible
- 768 × 1024 tablet — intentional stacked hero, full-width demo, no horizontal overflow
- 1440 × 900 desktop — balanced split hero, complete ranked-action surface, no horizontal overflow

Every viewport rendered `rgb(0, 0, 0)`, reported the exact viewport width as its scroll width, and produced no page, console, request, or unexpected HTTP errors. Reduced motion, missing-GSAP fallback, no-JavaScript form behavior, and the custom 404 were also exercised.

The same 390 × 844, 768 × 1024, and 1440 × 900 matrix was run against `/liquid-glass/` locally, followed by a final 1440 × 900 Chromium pass on the stable public preview. The full-page material resolves to 30-pixel desktop, 26-pixel tablet, and 24-pixel mobile outer-section radii, uses supported backdrop blur in Chromium, and keeps inner editorial rows continuous without nested blur. Hero, benefits, how-it-works, private-beta scope, FAQ, signup, and footer were all visually reviewed. The in-flow mobile decision panel and Option+2 review, FAQ, first-Tab, CTA, and fail-closed form behavior remain intact.

The desktop Liquid Glass hero now uses a shared grid row for its reading pane and product-demo window. Their top edge, rendered height, and bottom edge match exactly on both the local and stable public preview at 1440 × 900 and the additional 2048 × 1024 wide-screen check; the caption remains below the aligned panels. The 1100-pixel breakpoint and narrower layouts retain the existing stacked composition.

The first public pass found two responsive accessibility defects and the second deployment corrected both:

- The first `Tab` now exposes the skip link at `12,12` with a visible 3-pixel Blazing Yellow outline.
- At 390 pixels, the terminal log ends at `834px` and the in-flow decision panel starts at `952px`, leaving 117.5 pixels of separation instead of overlapping the log.

## Interaction and resilience checks

- English is the only published language; the KO/EN switch, Korean dictionary, locale storage, and alternate OG locale were removed
- Default demo keycaps and focused keyboard handling use `Option+1` through `Option+4`
- Choice 2 transitions into the supplied review state
- Manual selection stops autoplay and remains authoritative
- Reduced-motion emulation keeps a stable, useful decision state for more than the autoplay window
- Aborted GSAP and ScrollTrigger requests fall back to visible static content with no page exception
- Hidden autoplay choices are removed from keyboard focus until available
- The terminal animation remains `aria-live="off"`; the figure retains its accessible description
- With JavaScript disabled, all form controls remain disabled and a visible explanation is rendered, preventing fallback GET submission of an email address
- With JavaScript enabled but no configured endpoint, submission shows the approved error and never a fake success
- FAQ behavior, CTA navigation, focus states, and responsive reflow pass

## Visual rubric

| Category | Result | Evidence |
| --- | --- | --- |
| Brand specificity | Pass | Pure black canvas, Blazing Yellow decision signals, canonical Blabee mark |
| Hero comprehension | Pass | Codex, macOS, shortcut, same-session outcome, and beta CTA appear in the opening composition |
| Product prominence | Pass | Terminal and ranked-action surface dominate the visual system |
| Typography and spacing | Pass | Consistent system sans/mono hierarchy and responsive rhythm |
| Responsive composition | Pass | Chromium-checked at all target viewports without overflow |
| Motion resilience | Pass | Normal, reduced-motion, and missing-GSAP paths are covered |
| Accessibility basics | Pass | Semantic structure, focus states, contrast, English labels, keyboard interaction, and no-JS fallback |
| Content truth | Pass with one product decision | Current shortcut, ranked-action, same-session, and no-rollback behavior are reflected; Smart-mode positioning remains a product narrative choice |
| SEO and social | Pass | Canonical metadata, 1200 × 630 image, robots, sitemap, and a noindex 404 page are present |
| Conversion | Needs launch input | A real beta application endpoint is still absent |
| Liquid Glass comparison | Pass for preview | Every major narrative region uses the app-derived outer-sheet and continuous-inset hierarchy; fallbacks and reduced preferences remain isolated under `.liquid-glass` |

## Deployment review

- The dedicated `blabee-landing-preview` Pages project serves the stable preview at `https://blabee-landing-preview.pages.dev/`; the current immutable deployment URL is `https://227ffb6f.blabee-landing-preview.pages.dev/`.
- The comparison is available at `https://blabee-landing-preview.pages.dev/liquid-glass/` and `https://227ffb6f.blabee-landing-preview.pages.dev/liquid-glass/`.
- `scripts/build-public.mjs` stages only `index.html`, `liquid-glass/`, `404.html`, `_headers`, `css/`, `js/`, `assets/`, `favicon.ico`, `robots.txt`, and `sitemap.xml`. Internal docs, tests, scripts, package files, and environment material are not uploaded.
- Both public origins return `200`, matching ETags, the `20260901b` Liquid Glass CSS cache key, and the expected content types. A nested missing route returns the styled custom `404` with `no-store`.
- The strict self-hosted CSP, frame denial, referrer policy, permissions policy, MIME sniffing protection, HTML revalidation, and one-hour asset cache policies are present on the public origin.
- No custom domain or DNS was changed. Canonical, sitemap, and social metadata still target `https://blabee.com/` and must be rechecked after that domain is connected.
- The SHA-256 hashes of canonical `index.html`, `css/style.css`, `js/main.js`, and `js/content.js` match their pre-variant baselines exactly.
- If the future beta API is cross-origin, add only its exact origin to `connect-src` and configure API CORS. `form-action` does not govern `fetch()`.

## Remaining release gates

1. Configure and integration-test the real beta application endpoint.
2. Connect the approved `blabee.com` custom domain and recheck canonical URLs, social-card fetching, redirects, and TLS.
3. Decide whether public copy should explain Smart mode explicitly; the current generalized wording is truthful across current modes.
4. Compare the canonical and Liquid Glass directions and choose one before connecting the production domain. If the comparison route remains long-term, replace duplicated HTML with a small static template step or strengthen full content-parity tests.

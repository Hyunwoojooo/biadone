# Blabee subpath integration — 2026-09-21

## Scope and source

- Target: `https://biadone.com/blabee/`; `/blabee` redirects there.
- Source branch: `blabee-landing-page`, commit `cafbe8f8b2735b8592018c37ee4b01706134cba9`.
- Source inspected in an isolated clone at `/tmp/biadone-blabee-landing-20260921`; the active repository branch was not switched.
- Imported 29 public files into `blabee/`. Twenty-four match the upstream public build byte for byte; five HTML files only change internal paths and canonical/social URLs.
- Includes the 35.8-second demo, poster, English WebVTT captions, and English/Korean draft policy pages/downloads. Separate 15-second promotional MP4/SRT files remain excluded, matching upstream's public build.
- Root changes: three Blabee links, desktop navigation breakpoint moved to 1280px, readable mobile CTA text, scoped `_headers`, `/blabee` redirect, deployment allowlist and `--prepare-only`, README.

## Verification

- Upstream `npm run check`, `npm test` (4/4), and `npm run build:public`: passed.
- `bash -n scripts/deploy-cloudflare.sh` and `git diff --check`: passed.
- All 112 same-origin HTML asset/link/anchor references resolve. No imported symlinks or private configuration; every public file is below 25 MiB.
- `--prepare-only` produced 35 upload files, with no README, AGENTS, QA report, scripts, caches, environment files, or promotional media.
- Local Wrangler 4.127.1 Pages runtime parsed one redirect and five scoped header rules. `/blabee` returns 301; `/blabee/` returns 200; an unknown Blabee path returns the nested 404. Blabee CSP/noindex headers do not apply to the parent homepage.
- Chromium checks at 1440×900, 768×1024, and 390×844: landing renders, images load, video starts with duration 35.8s and resolution 1920×1200, VTT loads, policy language navigation and Korean Markdown download work, and no page errors, console errors, local HTTP errors, or horizontal page overflow occur.
- With the endpoint blank, valid form input shows failure, never success, and makes zero POST requests. Invalid email remains invalid; with JavaScript disabled the form remains disabled.
- The compatibility URL `/blabee/liquid-glass/light/` renders, and the interactive sample accepts a choice.
- Main navigation checks at 390, 1024, 1280, and 1440px cover menu visibility, Blabee navigation, and desktop spacing. Mobile primary CTA text uses the intended light color.
- Screenshots inspected separately: desktop/tablet/mobile landing, mobile video/form, policy page, parent desktop/mobile menu. The crowded parent header at 1024px was corrected during this pass.
- Independent read-only source/path/deployment review found no blocking integration defect.

Temporary browser scripts and screenshots are in `/tmp/blabee-route-browser-qa.cjs`, `/tmp/blabee-root-nav-qa.cjs`, and `/tmp/blabee-route-qa/`.

## Production verification

- Deployed with user approval on 2026-09-21. Public address: `https://biadone.com/blabee/`; immutable deployment: `https://98f166f7.biadone.pages.dev`.
- Verified 32 served files against local source (29 Blabee files plus the root HTML/CSS/JS). Non-HTML files match SHA-256 exactly. HTML on the immutable deployment matches exactly; the custom domain matches after decoding only its existing Cloudflare email-protection transformations.
- `/blabee` returns 301 to `/blabee/`, which returns 200. Blabee's nested 404, draft download attachment header, scoped CSP, and `noindex` work. The root page does not receive Blabee's CSP.
- Desktop 1440×900 and mobile 390×844: landing and images render without horizontal overflow, the 35.8-second 1920×1200 demo plays, English/Korean policy navigation works, and the parent navigation reaches Blabee.
- The MP4 serves `206 Partial Content` for a byte-range request with `Content-Range: bytes 0-1023/15282645`. The deployed VTT matches the local file exactly.
- No application JavaScript errors or failed same-origin asset requests were observed. **Known platform warning:** Cloudflare injects an external analytics beacon from `static.cloudflareinsights.com`; the preserved `script-src 'self'` CSP blocks it. This is recorded separately from application failures. Analytics collection was not enabled by relaxing CSP.
- The deployed beta form still has an empty endpoint. No live signup submissions were made.
- Production screenshots and detailed results: `/tmp/blabee-production-qa/`; verification script: `/tmp/blabee-production-qa.cjs`.

## Remaining boundaries

- Production deployment completed on 2026-09-21 after explicit user approval, using `./scripts/deploy-cloudflare.sh` and Wrangler 4.135.0. Deployment: `https://98f166f7.biadone.pages.dev`, project `biadone`, branch `main`. No commit or push was performed.
- The beta API remains disconnected; no signup data is saved. Policy drafts and search `noindex` remain unchanged in intent.
- Local Pages returned 200 for byte-range requests, while the production test returned 206 as recorded above. This does not establish seeking behavior on every browser.
- No new production dependencies were added. Existing root-site CDN dependencies remain.

The site's deployment approval requirement was satisfied by the user's instruction to deploy.

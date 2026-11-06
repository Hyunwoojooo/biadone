# Blabee short promotional links — 2026-10-17

- Public sharing addresses: `/blabee/reddit`, `/blabee/x`, `/blabee/instagram`,
  and `/blabee/youtube`. Both slash variants redirect with HTTP 302 to the
  existing campaign tags; Cloudflare parses nine total redirect rules.
- The landing page captures attribution before using `history.replaceState`
  to remove its four UTM fields from the visible URL. It preserves unrelated
  query parameters, anchors, and existing history state. Cache version `b`
  connects both landing entry points to the changed modules.
- Reload/history restoration prefers valid cached tags over an original external
  referrer, while fresh tagged/external navigation keeps existing precedence.
  Review identified this potential loss after URL cleanup; the fix has unit
  coverage. Chromium cleared the referrer on normal reload, so browser QA also
  explicitly simulates a retained external referrer rather than claiming that
  all browsers behave identically.
- Unit tests: 24/24 passed. Local attribution browser checks cover eight short
  route variants, clean URL/reload/signup, retained-referrer simulation, query/
  anchor/history-state preservation, and the previous privacy/failure scenarios.
  The form suite also passed at 1440, 768, and 390px plus the compatibility URL.
- Browser plugin not available; existing Playwright 1.62.1 was used against
  local Wrangler 4.151.1 at `http://127.0.0.1:8810`. API writes are intercepted.
  Evidence: `/tmp/blabee-short-links-local/` and
  `/tmp/blabee-short-links-local-form/`. No new dependency or database migration.
- With JavaScript blocked, the tagged destination can remain visible. Cosmetic
  URL cleanup does not erase the original network request. Without session
  storage, a later clean reload cannot recover a previously removed campaign.
- Production deployment: `https://9042855d.biadone.pages.dev`, Wrangler 4.151.1,
  project `biadone`, branch `main`. All 20 attribution browser scenarios passed
  on `https://biadone.com` with writes intercepted. The eight short-route
  variants return 302 with the intended tags; `www` works. Three served modules
  match local bytes and both HTML entry points serve version `20261017b`.
  Production evidence: `/tmp/blabee-short-links-production/`.

---

# Blabee referral measurement — 2026-10-17

## Change

- Added UTM/referrer-host attribution, one best-effort view request per visible
  document, and first-signup attribution. The page remains static, uses the
  existing public Supabase key, and adds no production dependency.
- Added private daily counters, nullable signup attribution, two narrowly scoped
  public submission RPCs, and an owner-only source report. Existing applicants
  and the legacy email-only RPC are preserved.
- Added ready-to-share Reddit, X, Instagram, and YouTube links in `TRACKING.md`.
  Updated both landing URLs, EN/KO website measurement notices, exact CSP
  endpoints, and private operator/test documentation.

## Local verification

- Unit tests: 21/21 passed for email signup and source normalization, cache,
  privacy signals, request payloads, acknowledgements, timeout, and failure.
- `tests/landing-sql.test.mjs`: passed in isolated PGlite with both migrations
  and SQL fixture suites. Checks anonymous/authenticated execution, denied table
  access, RLS, normalization, duplicate first-source preservation, old/opted-out
  requests, and report boundaries under a non-UTC session timezone. No site
  dependency was installed; the isolated runner lives outside the public files.
- Browser form checks passed at 1440, 768, and 390px and the compatibility URL.
  Ten attribution scenarios passed: UTM allowlisting, policy-page round trips,
  campaign replacement, reload/visibility counting, analytics failure, GPC/DNT,
  and unavailable storage. All API writes were intercepted; no real applicants
  or views were created by these browser tests. Desktop/mobile screenshots were
  inspected; no application errors, broken local assets, CSP failures, or
  horizontal overflow were found.
- Local Pages 301 `/blabee` redirect preserves all four UTM parameters.
  Runtime: Wrangler 4.137.0, compatibility date 2026-09-28 (the cached workerd's
  latest supported date); a later compatibility date could not start locally.
- Independent review found one disclosure mismatch around the 30-minute cache.
  EN/KO text now states the reuse window and next-check cleanup, rather than
  promising timed deletion. An open page retains its assigned signup source.
- Artifacts: `/tmp/blabee-tracking-local-form/` and
  `/tmp/blabee-tracking-local-attribution/`.

## Production database verification

- Preflight confirmed the existing signup table/RPC and absence of tracking
  objects. Applied only `202610170001_blabee_landing_attribution.sql` through
  the existing project's SQL Editor; no credential/environment changes or
  migration replay. Supabase CLI migration history was not changed.
- Under the actual `anon` role, four platform sources produced four groups and
  five views; repeated normalized email requests kept the initial Reddit source.
  Direct anonymous table access failed. All fixture work was rolled back.
- Owner-side checks confirmed both tables have RLS, no anon/authenticated direct
  table privileges, the intended RPC grants, denied service-role execution, the
  preserved legacy RPC, and zero remaining verification fixtures.
- Browser-to-API successful insert handling is tested with intercepted responses;
  actual database inserts/counters are tested in the rolled-back SQL transaction.
  This distinction avoids leaving synthetic leads or analytics in production.

## Production site verification

- Deployed through the previously authorized Cloudflare Pages workflow,
  Wrangler 4.151.1, project `biadone`, branch `main`:
  `https://c9e0872f.biadone.pages.dev`. Upload contained 38 allowlisted files
  (36 assets and two rule files); private docs/SQL/tests were excluded.
- The actual `biadone.com` domain and `www` serve the new entry version. Eight
  changed JavaScript/Markdown assets match local SHA-256 hashes. Both landing
  URLs and policy URLs return 200; all four platform redirects preserve UTM.
  JavaScript MIME, exact API CSP endpoints, `noindex`, and root header scope pass.
- The full form suite and all ten attribution browser scenarios also passed on
  the production domain, with every Supabase write intercepted. No application
  errors or broken local assets. The existing Cloudflare-injected analytics
  beacon is still blocked by the preserved CSP; the new Supabase tracking RPCs
  are allowed and do not depend on that beacon.
- Live HTTP to the new signup RPC returned 400 / SQLSTATE 22023 for an invalid
  email, with working CORS; the view RPC's OPTIONS preflight returned 200.
  No valid email or page-view event was sent by this HTTP probe.
- Saved and reloaded the private SQL report named “Blabee 홍보 경로별 방문·베타 신청”
  at `https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/sql/6d90b1e1-c936-48cd-852f-594991229a62`.
  It runs successfully and preserves older signup rows as `unmeasured`.
- Production browser artifacts: `/tmp/blabee-tracking-production-form/` and
  `/tmp/blabee-tracking-production-attribution/`.
- Inspected production mobile form and EN/KO measurement notices. Both policy
  anchors work at 390px without horizontal overflow; no layout change was needed.

## Measurement boundaries

- Visits mean page views, including reloads, not unique people. Signup counts are
  first email requests; the report is not a matched-cohort conversion rate.
- Old/opted-out/legacy signups are `unmeasured`. Previously collected sources
  cannot be reconstructed. Referrer omission is `direct_or_unknown`, not proof
  of a typed URL. Copied tagged links retain their original source tag.
- Browser blockers can lower counts; bots can inflate counts. No CAPTCHA or
  server-side per-visitor rate limit was added. The app/legal draft terms remain
  separate from the current factual website measurement notice.

---

# Historical beta signup — 2026-09-24

## Current change

- Both landing URLs now ask only for email. Removed the coding-agent fieldset,
  explanatory note, and unused fieldset styling/copy.
- Added the public Supabase RPC client, explicit acknowledgement handling,
  timeout/retry behavior, disabled pending/success controls, and cache-version
  updates. The existing static site architecture and dependencies are unchanged.
- Added a separate private `blabee_marketing.beta_requests` table with normalized
  email uniqueness and first-request timestamp; RLS and revoked direct grants
  protect the email list. The public function can only register valid emails.
- Site-local SQL and tests are excluded from the public upload. There are 37
  upload files: 35 assets plus `_headers` and `_redirects`.

## Current verification

- `node --test tests/beta-signup.test.mjs`: 4/4 passed, covering request payload,
  response acknowledgement, rejected configuration, timeout, and retry.
- JavaScript syntax checks: 5/5 passed. `git diff --check`: passed.
- Migration and `supabase/tests/beta_requests.sql` passed in isolated PGlite,
  including anonymous/authenticated calls, invalid inputs, deduplication,
  timestamp preservation, direct-access denial, and RLS defense. All fixtures
  rolled back. PGlite was installed only under `/tmp`, not as a site dependency.
- `tests/beta-form.browser.cjs` passed on local Wrangler 4.135.0 at 1440, 768,
  and 390px, plus the compatibility URL. Verified validation, failure/retry,
  pending/success states, duplicate-click prevention, no-JavaScript behavior,
  JavaScript MIME, and CSP. No application errors, broken local assets, Supabase
  CSP violations, or horizontal overflow. Desktop/mobile screenshots inspected.
- Independent source/permissions review found no remaining substantive issue.
  A stale entry-script cache version found during review was corrected before release.

## Current production verification

- Supabase preflight found no conflicting marketing schema/table/function.
  Applied only `supabase/migrations/202609240001_blabee_beta_requests.sql` through
  the existing Blabee project's SQL Editor. Did not replay app analytics SQL or
  change credentials/environment files.
- Live owner query confirmed RLS enabled; anonymous/authenticated direct table
  access denied; RPC execution allowed only for the intended public client roles.
- Local browser to live Supabase: valid submission and duplicate both returned
  HTTP 200 `{ "accepted": true }`; the normalized test email had exactly one row.
- Deployed using the previously authorized Cloudflare Pages workflow, Wrangler
  4.137.0, project `biadone`, branch `main`. Immutable deployment:
  `https://fcfda27f.biadone.pages.dev`.
- Both `https://biadone.com/blabee/` and `/blabee/liquid-glass/light/` submitted
  successfully to live Supabase and showed success without application errors.
  Only a generated `example.invalid` test address was submitted; no real person
  was subscribed and no email was sent.
- Repeated production submissions kept the same single row and first timestamp.
  Removed exactly that generated test row after verification. The served `.mjs`
  module returns HTTP 200 with `application/javascript` and the intended CSP.
- Screenshots/results: `/tmp/blabee-beta-qa/`. The public request function does
  not verify inbox ownership, send invitations, or impose a CAPTCHA/rate limit.
  The existing policy drafts and `noindex` remain in place.

---

# Historical subpath integration — 2026-09-21

The sections below record the initial deployment before the beta API was connected.

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

# Blabee tracking links

The landing page measures **page views by referral source** and **new beta email
requests by their first signup source**. It does not count unique people.

## Share a tagged link

Use the same campaign name across channels, and different content names for
different posts or placements. Values are lowercase ASCII slugs, at most 80
characters: letters, numbers, `.`, `_`, and `-`. Do not put personal information
in tracking parameters. Invalid values are discarded, not truncated.

| Placement | Example link |
|---|---|
| Reddit post | `https://biadone.com/blabee/?utm_source=reddit&utm_medium=social&utm_campaign=mac-beta&utm_content=post-01` |
| X post | `https://biadone.com/blabee/?utm_source=x&utm_medium=social&utm_campaign=mac-beta&utm_content=post-01` |
| Instagram profile | `https://biadone.com/blabee/?utm_source=instagram&utm_medium=social&utm_campaign=mac-beta&utm_content=bio` |
| YouTube video description | `https://biadone.com/blabee/?utm_source=youtube&utm_medium=social&utm_campaign=mac-beta&utm_content=video-01` |

Copy the **complete URL**, including everything after `?`, when sharing it.
Keep `utm_source` fixed for each platform. Change only `utm_content` for each
post or placement, for example `post-02`, `story-01`, or `video-02`. The source
identifies the tag on the shared link; if someone reposts that link elsewhere,
it still carries the original platform tag. A profile link cannot identify
which untagged post led someone to the profile.

- `utm_source`: channel or publication.
- `utm_medium`: channel type, such as `social`, `community`, or `email`.
- `utm_campaign`: campaign shared across channels.
- `utm_content`: individual link/post/placement.

If a valid UTM source is missing, an external referring hostname is used when
the browser provides one. If neither is available, the source is
`direct_or_unknown`; this does **not** prove the visitor typed the address.
Apps, bookmarks, browser settings, copied links, and links with `noreferrer`
can all omit the referrer. A tagged link is more reliable for identifying a
particular post. Previously collected email addresses cannot be backfilled with
their historical source.

## Read the report

Open the saved owner-only [Blabee referral report](https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/sql/6d90b1e1-c936-48cd-852f-594991229a62)
and click **Run** to refresh it. A Supabase project-owner login is required;
this is not a publicly shared applicant report. Sources appear once measured.

Run [`supabase/reports/landing-sources.sql`](supabase/reports/landing-sources.sql)
in the existing Blabee Supabase project's SQL Editor as the project owner.
The report returns `source`, `source_type`, `medium`, `campaign`, `content`,
`page_views`, and `new_beta_requests`. It contains no email addresses and can be
exported from SQL Editor. The default range is the most recent 30 UTC calendar
days, including today; change `start_day` and exclusive `end_day` to adjust it.

This report combines page views and signups in the selected date range. It is
not a matched visitor-cohort conversion rate: a signup may follow an earlier
visit outside the date range, analytics may be blocked, and multiple page views
can belong to the same person. Historical/opted-out/legacy signups have source
`unmeasured`, which is different from a measured `direct_or_unknown` visit.

The private tables remain accessible only to the project owner:

- `blabee_marketing.landing_daily_views`: UTC day, normalized source metadata,
  and a page-view counter. There are no per-visitor event rows or visitor IDs.
- `blabee_marketing.beta_requests`: email, first signup time, and optional
  source metadata. Duplicate submissions do not replace the first source or
  increment the signup count.

## Measurement behavior and limits

- One best-effort POST per visible landing document. Reloads are new page views;
  background documents wait until visible. Hash navigation does not add views.
  Failed/uncertain requests are not automatically retried to avoid double counts.
- A source is kept in tab-scoped `sessionStorage` and can be reused on a new
  landing document within 30 minutes, allowing a policy-page round trip. Expired
  cache data is discarded when next checked, not by a background deletion timer.
  An open landing document retains its assigned source for its beta request.
  A new tagged or externally referred entry replaces the cache. It contains only
  source fields and an expiry, no visitor identifier; it does not track across
  tabs or devices.
- The page sends only the four allowlisted UTM values and the referring hostname.
  Full URLs, unrelated query parameters, IP addresses, and user-agent strings are
  not stored in these analytics tables. Hosting/API request logs are independent.
- When Global Privacy Control or Do Not Track is enabled, the page skips visit
  measurement and sends the beta request without source metadata. Local cache
  failures and analytics failures do not block beta signup.
- Counts are browser-reported measurements, not fraud-resistant clicks or unique
  users. Blockers can reduce counts and bots can inflate them. No CAPTCHA or
  server-side per-visitor rate limit has been introduced by this change.
- The legal/app-policy drafts remain separate from the factual website
  measurement section. This implementation is not a legal compliance review.

## Database rollout

Applied on 2026-10-17, followed by Cloudflare Pages deployment
`https://c9e0872f.biadone.pages.dev`; the production route is
`https://biadone.com/blabee/`. See `QA_REPORT.md` for verification boundaries.

Apply only the new additive migration
`supabase/migrations/202610170001_blabee_landing_attribution.sql` after inspecting
the live schema. Do not replay the September migration. The existing
`request_blabee_beta(text)` stays available for already-open/cached pages.

The new frontend uses `request_blabee_beta_tracked(text,jsonb)` with optional
source data and `record_blabee_landing_view(jsonb)` for the daily counter. Both
are `SECURITY DEFINER`, have an empty search path, and grant execution only to
`anon`/`authenticated`. There is no public report/list endpoint. RLS and revoked
direct privileges protect both tables. The public publishable key is unchanged.

Apply the DB change before the site deployment. Deploy only the existing public
allowlist; this document, SQL, reports, and tests must remain private. If the
frontend is rolled back, leave the additive DB objects in place and preserve
collected data; old email-only submissions continue working.

## Verification

```sh
node --test tests/beta-signup.test.mjs tests/landing-attribution.test.mjs
# Optional isolated SQL checks, using a PGlite installation outside this site:
PGLITE_MODULE=/path/to/pglite/dist/index.js node --test tests/landing-sql.test.mjs
```

The SQL fixtures in `supabase/tests/landing_attribution.sql` and the existing
beta SQL tests are for an isolated, initially empty database after both
migrations. They roll back their fixtures and temporary grants. Browser tests
`tests/beta-form.browser.cjs` and `tests/landing-attribution.browser.cjs` use an
existing Playwright install and intercept **all** Supabase requests. They must
not insert real analytics or applicants during routine checks.

References: [Cloudflare Web Analytics limits](https://developers.cloudflare.com/web-analytics/faq/),
[browser referrers](https://developer.mozilla.org/en-US/docs/Web/API/Document/referrer),
[Supabase database functions](https://supabase.com/docs/guides/database/functions).

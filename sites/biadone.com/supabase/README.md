# Blabee beta requests and referral measurement

The static `/blabee/` page submits an email to the existing Blabee Supabase project
`vulnkqyqqbucvbhwjswr`. It does not create an Auth account or send email.

## Database and API

- Private table: `blabee_marketing.beta_requests` (`email` primary key,
  `created_at`, nullable `attribution`).
- Current public RPC: `public.request_blabee_beta_tracked(p_email text, p_attribution jsonb default null)`.
- Request: `POST https://vulnkqyqqbucvbhwjswr.supabase.co/rest/v1/rpc/request_blabee_beta_tracked`,
  with the public `apikey` header and JSON `{ "p_email": "person@example.com" }`.
  Optional `p_attribution` contains only `utm_source`, `utm_medium`,
  `utm_campaign`, `utm_content`, and `referrer_host`; the server normalizes and
  allowlists these fields. The legacy `request_blabee_beta(p_email text)` remains
  available for already-open/cached clients.
- Success: HTTP 200 and `{ "accepted": true }`. The browser requires both.
- Emails are trimmed/lowercased and validated on the server. Duplicate requests
  return the same response and preserve the first request timestamp and source.
- No email list is available to public clients. Schema/table privileges are
  revoked and RLS is enabled without client policies. The narrowly scoped
  `SECURITY DEFINER` function has an empty search path and only grants execution
  to `anon` and `authenticated`.

`blabee/js/beta-config.js` uses the same **public publishable key** as the existing
Blabee account web build. It is intended for browser use; no secret/service-role
key or environment file is used. `_headers` allows the legacy/signup/view RPC
URLs in the Blabee page's `connect-src` policy. The site adds no production dependency.

`record_blabee_landing_view(p_attribution jsonb)` increments a UTC daily counter
in the private `blabee_marketing.landing_daily_views` table. Counts are page
views, not unique people. No visitor ID, full URL, IP, or user agent is stored
in these tables. Visit measurement is independent of signup, has no automatic
retry, and is skipped with GPC/DNT. See [TRACKING.md](../TRACKING.md) for sharing
links, source priority, privacy behavior, owner reports, and measurement limits.

## Database rollout

The app's earlier analytics migrations were managed separately through SQL Editor.
Do not run those migrations again or use an unreviewed `supabase db push`.

The September migration below is **historical and already applied**. Do not
replay it on production. For a fresh isolated database only:

1. Open the isolated database as the trusted database owner.
2. Check that `blabee_marketing`, its `beta_requests` table, and
   `public.request_blabee_beta(text)` are absent. If they already exist, inspect
   their definitions before deciding what to change.
3. Apply `migrations/202609240001_blabee_beta_requests.sql` once. Its transaction
   creates only the new marketing schema/table/function and refreshes the API
   schema cache. It deliberately fails on a naming collision.
4. Verify the RPC and grants, then deploy the static site using the normal site
   deployment script with the user's deployment authorization.

Future database changes belong in new migrations. Do not edit an applied migration.
SQL files, tests, and this README are outside the deployment allowlist.

For the October tracking upgrade, inspect the existing schema and apply only
`migrations/202610170001_blabee_landing_attribution.sql`. It adds counters and
optional signup attribution, preserves the legacy RPC/data, enables RLS, and
revokes direct client access. Apply it before deploying the new frontend. Do
not run an unreviewed full migration replay. Deployment evidence is recorded in
[QA_REPORT.md](../QA_REPORT.md).

Applied through the Blabee project's SQL Editor on 2026-09-24. Live browser
submissions from the deployed site returned HTTP 200 with `accepted: true`.
Owner-side verification confirmed one normalized row across duplicate requests,
RLS enabled, denied direct client access, and the intended RPC grants. This
manual application is recorded here; Supabase CLI migration history was not changed.

The additive tracking migration was applied through the same SQL Editor on
2026-10-17. Scoped live `anon` calls verified four platform counters and
duplicate first-source preservation inside a rolled-back transaction. Owner
checks confirmed RLS, denied direct table access, intended function grants, and
no remaining fixtures. Live HTTP checked invalid-email rejection and CORS;
successful browser submissions were intercepted for QA. The saved owner report
is linked from [TRACKING.md](../TRACKING.md).

## Read applications

The project owner can use SQL Editor or Table Editor (schema `blabee_marketing`):

```sql
select email, created_at, attribution
from blabee_marketing.beta_requests
order by created_at desc;
```

Email, first application time, and optional first-signup source are stored.
`attribution IS NULL` means unmeasured, including older/opted-out/legacy requests;
it must not be labeled a direct visit. No coding agent choice, account ID, IP
address, or user agent is included in the request table. Infrastructure request
logs are managed independently by the providers.
Applicant verification, automatic invitation emails, CAPTCHA, and application
rate limits are not implemented. Unique email storage prevents duplicate rows,
but does not limit submissions using different email addresses.

## Checks

```sh
node --test tests/beta-signup.test.mjs tests/landing-attribution.test.mjs
# Optional SQL runner with an external PGlite install:
PGLITE_MODULE=/path/to/pglite/dist/index.js node --test tests/landing-sql.test.mjs
```

Run `supabase/tests/beta_requests.sql` after the migration in an **isolated**
PostgreSQL database with Supabase's `anon`, `authenticated`, and `service_role`
roles. It checks validation, normalization, duplicate timestamps, permissions,
and RLS; test rows and temporary grants are rolled back. It assumes an empty
test table and must not be run against the production applicants table.

`tests/beta-form.browser.cjs` and `tests/landing-attribution.browser.cjs` use an
existing Playwright install with a local Cloudflare Pages preview. They intercept
all analytics/signup requests and never store real views or leads. Set
`PLAYWRIGHT_MODULE` when Playwright is outside the default module path;
`BASE_URL` and `OUTPUT_DIR` are optional. It covers desktop/tablet/mobile, both
landing URLs, validation, retry, pending/success states, JavaScript MIME, CSP,
and disabled controls when JavaScript is unavailable. Attribution checks cover
UTM allowlisting, policy round trips, new campaigns, reloads, visibility,
analytics failure, GPC/DNT, and unavailable session storage. The isolated SQL
runner also executes the report against UTC boundary fixtures.

Design references: [Supabase database functions](https://supabase.com/docs/guides/database/functions),
[row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security),
and [publishable API keys](https://supabase.com/docs/guides/getting-started/api-keys).

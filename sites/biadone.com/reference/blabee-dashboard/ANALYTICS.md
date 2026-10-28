# Blabee landing analytics revision

Requested 2026-10-17. Revise the existing static, authenticated dashboard in place.

## Scope and presentation

- Remove post management and the promotional heading, introduction, create-post action, and green notice.
- Preserve the minimal Google login screen and both server and database owner checks.
- Cloudflare metrics cover host `biadone.com`, exact paths `/blabee` and `/blabee/` only. Never include the admin page, policy pages, assets, sibling products, or a prefix match.
- Show page views and Visits, their time series, hour of day, and country, browser, and operating system rankings. These are counts, not unique people. Do not copy screenshot values into operational data.
- Keep beta requests and source attribution as a separate Supabase section. The existing source covers combined Blabee landing pages; do not mix its page views with the exact-path Cloudflare metric.
- Keep UTC calendar filters and label UTC on times. Add a one-day preset alongside seven days, thirty days, and custom dates. Use the same effective period across each Cloudflare component.
- No new framework, production dependency, public collector, source migration, or historical backfill.

## Private API contract

`GET /blabee/admin/api/admin/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD` uses UTC dates with an exclusive end and the existing maximum 90-day request validation. Provider retention may further restrict supported ranges. The server clips the effective end to now. Channel and campaign filters apply only to Supabase; they must not silently filter these Cloudflare charts.

```json
{
  "version": 1,
  "provider": "cloudflare",
  "generated_at": "ISO timestamp",
  "timezone": "UTC",
  "scope": {"id":"blabee_main", "host":"biadone.com", "paths":["/blabee","/blabee/"], "label":"biadone.com/blabee/"},
  "range": {"start_day":"YYYY-MM-DD", "end_day":"YYYY-MM-DD", "start_at":"ISO timestamp", "end_at":"ISO timestamp"},
  "grain": "hour",
  "status": "not_configured",
  "message": "Cloudflare connection status, or null when ready",
  "source": {"dataset":null, "sampled":null, "sample_interval":null, "bots":"included", "truncated":false, "incomplete":false},
  "diagnostic_code": "missing_token",
  "comparison": {"status":"unavailable", "start_at":null, "end_at":null},
  "metrics": {
    "page_views":{"value":null,"previous_value":null,"change_percent":null,"status":"unavailable"},
    "visits":{"value":null,"previous_value":null,"change_percent":null,"status":"unavailable"}
  },
  "series": [],
  "hourly": {"status":"unavailable","rows":[]},
  "breakdowns": {
    "countries":{"status":"unavailable","rows":[]},
    "browsers":{"status":"unavailable","rows":[]},
    "operating_systems":{"status":"unavailable","rows":[]}
  }
}
```

- Top-level status: `ready`, `empty`, `not_configured`, `rate_limited`, `unsupported_range`, or `unavailable`.
- Metric and component status: `ready`, `empty`, `partial`, or `unavailable`.
- Series row: `{bucket_start, bucket_end, page_views, visits}`. Grain is `hour` or `day`; source hourly data may be combined into days for long selections without inventing missing observations. A complete timestamp grid includes nulls for unobserved buckets, and the plot breaks there instead of interpolating across them.
- Hourly row: `{hour, page_views, visits}`. Hours are 0–23 UTC, summed across the selected period.
- Breakdown row: `{id, label, value}`. Values are page views for the selected period; unknown is an explicit category. Truncated top lists are not complete populations.
- Comparison status uses `ready`, `empty`, `partial`, or `unavailable`. Comparisons use an equal elapsed duration, including when today is partial. A zero or unavailable previous value yields `change_percent: null`, never infinity.
- `source.incomplete` distinguishes incomplete or inconsistent detailed counts from row-limit truncation. An unsampled, untruncated detail sum that differs from the total is partial rather than silently complete. Diagnostics are fixed categories, never raw provider error bodies.
- Failed provider requests may add `diagnostic_stage` (`token_format`, `settings`, or `data`), a fixed nonsecret `diagnostic_revision`, and at most three `diagnostic_trace` entries: `{endpoint, http_status, error_codes, transport_error?}`. Endpoints are fixed labels `settings`, `data`, `token_account`, or `token_user`; each includes at most five bounded numeric codes and optional `network`/`timeout`. The same safe trace is appended to the message for troubleshooting. Successful responses do not include this trace. Token values, identifiers, headers, queries, and raw error messages are never returned.
- Missing credentials, provider errors, unverified coverage, unsupported dimensions, and measured empty results remain distinguishable. Never turn missing data into zero.
- Authorize the real Supabase JWT and the database allowlist before upstream access. Do not expose Cloudflare credentials or arbitrary GraphQL/query access.
- Browser initialization requires the existing overview RPC success, validates every response, and rechecks token/request generation/page activity. A Cloudflare-only outage does not hide otherwise authorized beta data. Auth failures clear the entire private screen.

## Evidence and connection

Cloudflare API access was verified through the existing connector with a real read-only GraphQL query. Use zone `ea37fec2cfe3490e5ff1622f3d260567` and dataset `httpRequestsAdaptiveGroups`. The server fixes the host and two paths, `clientRequestHTTPMethodName: "GET"`, `requestSource: "eyeball"`, `edgeResponseContentTypeName: "html"`, and status `200 <= edgeResponseStatus < 300`. Do not substitute RUM data: the same-period RUM query returned no records.

The inspected period `2026-10-10T00:00:00Z` to `2026-10-17T13:35:00Z` returned 186 page views, 158 Visits, 61 hourly rows, 21 countries, 12 browsers, and 6 operating systems. Each breakdown and the hourly series summed to 186. The average sample interval was approximately 1.069. These numbers are a dated source check, not a fixed dashboard fixture. Live country categories included `T1`; preserve such classifications rather than rejecting non-ISO codes.

The actual settings allowed a 30-day query and a 31-day lookback, with a 10,000-row maximum and 40 fields. Fetch and validate current settings rather than silently stretching those bounds. Exclude an unsupported comparison alias without discarding the current period. Do not multiply returned aggregates by sample intervals.

A separate runtime read credential is needed for GraphQL. The original `CF_ANALYTICS_API_TOKEN` was rejected both in production and in the user's independent local verification. The user created a fresh read-only token and stored it in Production as `CF_ANALYTICS_API_TOKEN_V2`. A project metadata read confirmed the new key exists with type `secret_text`; its value was neither read nor copied. The new binding takes precedence whenever present, including when unusable; only installations without it use the legacy name. Use this secret only on the server. Do not read or copy MCP OAuth credentials. Provider authorization must be tested independently of connector access; see CONNECTION.md for the final runtime result.

The public landing currently sends `script-src 'self'`, so browser-beacon collection must not be assumed to work. Prefer a verified supported source and disclose any coverage boundary. Do not loosen the public CSP or change the UTM collector as part of this UI revision.

Official definitions: [Web Analytics metrics](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/), [dimensions](https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/), [API authentication](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).

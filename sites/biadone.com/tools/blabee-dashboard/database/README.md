# Dashboard database boundary

Applied to Supabase project `vulnkqyqqbucvbhwjswr` on 2026-10-17:
`001` as `20261017120311_blabee_dashboard_owner_api_v1`, and `002` as
`20261017120319_blabee_dashboard_enroll_owner_v1`. Those initial steps enrolled
one owner. Additional-admin migration `004` was applied separately as
`20261017125044_blabee_dashboard_additional_admins_v1`; three confirmed requested
administrators are now enrolled. Do not replay these files or the tracking migration on
this project. The instructions below describe first-time installation elsewhere.
See the [live connection record](../../../reference/blabee-dashboard/CONNECTION.md)
for SQL checks, unchanged source hashes, and actual owner-JWT HTTP evidence.

Run `000_preflight.sql` read-only first and inspect the source columns, existing
dashboard objects, confirmed owner count, and source function hashes. The UTM
migration is managed independently and must not be rerun to install this tool.
Run `001_dashboard.sql` once as the trusted database owner only after review.
It adds a private schema and two owner-guarded public RPCs; it never changes
the independently maintained `blabee_marketing` schema or its ingestion RPCs.
Its final `NOTIFY pgrst, 'reload schema'` becomes visible on commit so PostgREST
can discover the newly installed RPCs.

The install starts with **zero allowed owners**. `002_enroll_owner.sql` separately
enrolls exactly the existing, email-confirmed `biadone.official@gmail.com` account;
it aborts if that account cannot be selected unambiguously. Configure the same
UID in the Cloudflare API. Creating a normal product account grants no access.
Use the authenticated user's JWT with a public Supabase key when calling these
RPCs. Anonymous and service-role execution is revoked. Raw dashboard tables have
RLS with no client policies, no schema usage, and no client table grants.

After enrollment, run `003_verify_connection.sql` read-only. It checks the
actual grants, RLS, owner registration, unchanged source function hashes, and
recorded-count agreement within one UTC repeatable-read snapshot. It also
executes both RPCs as the authenticated SQL role with a transaction-local owner
claim. No traffic, signup, or registry fixtures are inserted. This is a database
check; a real owner JWT through the Pages API must still verify the deployed
connection. Without a confirmed enrolled account, the script fails closed at
the owner-only RPC and the connection remains pending.

## Additional administrators

`004_enroll_additional_admins.sql` was applied on 2026-10-17 as
`20261017125044_blabee_dashboard_additional_admins_v1` for the separately requested
administrator addition. It enrolled only these reviewed, existing accounts:

| Account | Expected Auth UID |
|---|---|
| `hyunwoojoo.33@gmail.com` | `338752c1-9293-47eb-ab45-b9832348860f` |
| `hn7742@gmail.com` | `642f7cfe-003e-4d63-9bfa-c25056b1325a` |

Before inserting either UID, the script checks that each email matches exactly
one row across all `auth.users` records, ignoring case, and that the row has a
confirmed email and the expected UID. A missing, unconfirmed, duplicate, or
mismatched account aborts the whole transaction. Re-execution is idempotent.
It preserves the original administrator (`b0723835-2e5f-488c-b12e-dc50bf1cdc66`)
and every existing allowlist row. It creates no Auth account, changes no table
or RPC grants, and does not touch source measurements. Do not rerun `001`, `002`,
or the tracking migration for this addition.

The database addition uses the existing dashboard administrator guard; it does
not automatically update the Pages API's configured administrator identities.
That configuration and an actual JWT check for each account are separate
connection steps. After applying `004`, three allowlist rows are expected when
the original administrator was the only previously enrolled account; the
one-owner count noted in the initial `003` verification describes first setup.

## Read contract

`public.blabee_dashboard_overview(p_start_day date, p_end_day date)` accepts an
inclusive start and exclusive end, at most 90 UTC calendar days. Future days
are rejected. It returns `daily` attribution rows containing `page_views` and
`new_beta_requests`, plus `coverage`, `capabilities`, `range`, and `scope`.
Null signup attribution is `unmeasured`, separate from `direct_or_unknown`.
Rows contain counts only; signup emails and account records never leave SQL.
Both supported landing versions are reported as `Blabee 랜딩 합산`; the upstream
counter cannot isolate the main `/blabee` page. Missing tracking objects are
reported as unavailable, while legacy signup counts remain usable.

Sparse counters and successful queries do not prove complete collection.
Missing daily values remain null by default, including before tracking exists.
The trusted database owner may insert `source_bounds` records with metric
`page_views` or `new_beta_requests`, verified UTC start/end dates and a concrete
`evidence_note`, after independently verifying completeness. Within that
verified interval, absent counts on completed dates can be zero. Today's absent
counts remain null and today is never a fully verified reporting period.
Bounds outside the requested interval do not validate that interval.
`collector_status` always remains `unknown`; no heartbeat exists upstream.

`public.blabee_dashboard_posts(p_action, p_post, p_post_id)` accepts `list`,
`create`, `update`, and `delete`. `p_post_id` is a UUID for update/delete.
Writable fields are `channel`, `title`, `url`, `published_at`,
`published_offset_minutes`, `content_format`, `link_placement`, `notes`,
`external_refs`, `source`, `medium`, `campaign`, and `content`. The last four
are either all absent/null (no mapping), or all strings (explicit mapping,
including empty dimension strings). Values are stored as supplied; no UTM
normalization, generation, or automatic matching is performed. Shared mappings
are allowed and must be displayed as ambiguous rather than counted repeatedly.
Mapping strings follow the source system's lowercase ASCII tag alphabet.
`published_at` must include a UTC offset; seconds may be omitted, as in
`2026-10-17T12:30Z`. Its instant and original offset minutes are preserved.
Notes allow up to 4,000 UTF-16 code units, matching the Pages API; other text
limits and prohibited controls also apply to direct RPC callers. Updates may
provide only the fields being changed.
HTTP(S) URLs are stored but never fetched by the database. List order is newest
publication first. A delete affects only a registry row and leaves source data.

## Isolated SQL checks

Use an existing PGlite installation outside the production source:

```sh
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tools/blabee-dashboard/tests/database.test.mjs
```

The tests create disposable in-memory databases, stub only the Supabase Auth
schema/roles, execute the real source and dashboard SQL, and exercise RPCs under
anonymous/authenticated/service roles. They do not contact a live database.

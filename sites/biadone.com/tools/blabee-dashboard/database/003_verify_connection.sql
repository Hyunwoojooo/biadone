-- Read-only verification after 001_dashboard.sql and successful 002 enrollment.
-- Run as the trusted database owner. Never insert test traffic or applicants.
-- These SQL checks verify database grants and aggregates; an actual owner JWT
-- through Pages/Supabase is still required to verify the deployed connection.
begin isolation level repeatable read read only;

-- Expected: EXECUTE only for authenticated; both RPCs are SECURITY DEFINER with
-- an empty search_path. Their allowlist check still independently restricts UID.
select r.rolname, p.oid::regprocedure::text as rpc, p.prosecdef, p.proconfig,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') = (r.rolname = 'authenticated') as grants_match
from pg_roles r cross join pg_proc p
where r.rolname in ('anon', 'authenticated', 'service_role')
  and p.oid in (
    'public.blabee_dashboard_overview(date,date)'::regprocedure,
    'public.blabee_dashboard_posts(text,jsonb,uuid)'::regprocedure
  )
order by rpc, r.rolname;

-- Expected: three tables x three roles, RLS enabled, no schema usage/raw grants.
select r.rolname, c.relname, c.relrowsecurity,
       has_schema_privilege(r.rolname, n.oid, 'USAGE') as schema_usage,
       has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as raw_access,
       (select count(*) from pg_policy where polrelid = c.oid) as client_policy_count
from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
where r.rolname in ('anon', 'authenticated', 'service_role')
  and n.nspname = 'blabee_dashboard' and c.relkind = 'r'
order by c.relname, r.rolname;

-- Expected on first connection: one requested owner, zero verified bounds,
-- zero posts. Later normal use can legitimately change the last two counts.
select
  (select count(*) from blabee_dashboard.owner_allowlist) as owner_count,
  (select count(*) from blabee_dashboard.owner_allowlist a join auth.users u on u.id = a.user_id
    where lower(u.email) = 'biadone.official@gmail.com' and u.email_confirmed_at is not null) as requested_owner_count,
  (select count(*) from blabee_dashboard.source_bounds) as verified_bounds_count,
  (select count(*) from blabee_dashboard.posts) as posts_count;

-- Must match the preflight hashes. Live traffic may change row counts while
-- deployment runs, so before/after traffic totals are not an immutability test.
select p.oid::regprocedure::text as object_name,
       md5(pg_get_functiondef(p.oid)) as definition_hash, p.proacl as function_acl
from pg_proc p
where p.oid in (
  'public.request_blabee_beta(text)'::regprocedure,
  'public.request_blabee_beta_tracked(text,jsonb)'::regprocedure,
  'public.record_blabee_landing_view(jsonb)'::regprocedure,
  'blabee_marketing.normalize_attribution(jsonb)'::regprocedure
)
order by object_name;

-- This is a local transaction claim used only to test the guarded SQL, not a
-- minted or verified external JWT. Missing enrollment clears the claim and
-- causes the owner guard to fail closed. Claims and role changes are rolled back.
with requested_owner as (
  select a.user_id from blabee_dashboard.owner_allowlist a join auth.users u on u.id = a.user_id
  where lower(u.email) = 'biadone.official@gmail.com' and u.email_confirmed_at is not null
)
select
  set_config('request.jwt.claim.sub', coalesce((select user_id::text from requested_owner), ''), true) as verified_owner_uid,
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', (select user_id::text from requested_owner), 'role', 'authenticated'
  )::text, true) is not null as local_claims_set;

-- Compare recorded counts within one repeatable-read snapshot. COALESCE here
-- reconciles stored observations only: it does not prove zero unmeasured visits.
-- UTC today is included; the end is exclusive and both sources use that range.
with bounds as (
  select (now() at time zone 'UTC')::date - 6 as start_day,
         (now() at time zone 'UTC')::date + 1 as end_day
), payload as (
  select public.blabee_dashboard_overview(start_day, end_day) as value from bounds
), rpc_counts as (
  select coalesce(sum((row ->> 'page_views')::bigint), 0) as page_views,
         coalesce(sum((row ->> 'new_beta_requests')::bigint), 0) as new_beta_requests
  from payload, jsonb_array_elements(value -> 'daily') row
), raw_counts as (
  select
    (select coalesce(sum(v.views), 0) from blabee_marketing.landing_daily_views v, bounds b
      where v.day >= b.start_day and v.day < b.end_day) as page_views,
    (select count(*) from blabee_marketing.beta_requests q, bounds b
      where q.created_at >= (b.start_day::timestamp at time zone 'UTC')
        and q.created_at < (b.end_day::timestamp at time zone 'UTC')) as new_beta_requests
)
select raw_counts.page_views as recorded_views, rpc_counts.page_views as rpc_recorded_views,
       raw_counts.new_beta_requests as recorded_signups, rpc_counts.new_beta_requests as rpc_recorded_signups,
       raw_counts.page_views = rpc_counts.page_views as views_match,
       raw_counts.new_beta_requests = rpc_counts.new_beta_requests as signups_match,
       (select value -> 'coverage' from payload) as coverage
from raw_counts, rpc_counts;

-- Exercise the actual authenticated SQL role without returning registry content.
-- Expected: both calls succeed for the enrolled UID. Raw tables remain private.
set local role authenticated;
select jsonb_array_length(public.blabee_dashboard_overview(
  (now() at time zone 'UTC')::date - 6, (now() at time zone 'UTC')::date + 1
) -> 'daily') as authenticated_daily_rows;
select jsonb_array_length(public.blabee_dashboard_posts('list') -> 'posts') as authenticated_post_rows;

rollback;

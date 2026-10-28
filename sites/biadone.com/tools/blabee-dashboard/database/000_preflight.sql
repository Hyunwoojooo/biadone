-- Read-only preflight for the existing project. Do not reapply the UTM migration.
-- Run as the trusted database owner before 001_dashboard.sql.
-- Expected: source objects exist, dashboard objects are absent, and exactly one
-- existing confirmed owner account is found. Missing owner enrollment can be
-- resolved separately; do not describe the connection as complete before it is.
begin read only;

select current_database() as database_name, current_user as database_role,
       now() as checked_at, (now() at time zone 'UTC')::date as today_utc;

select
  to_regclass('blabee_marketing.landing_daily_views') as views_table,
  to_regclass('blabee_marketing.beta_requests') as signup_table,
  to_regprocedure('public.record_blabee_landing_view(jsonb)') as ingestion_rpc,
  to_regprocedure('public.request_blabee_beta_tracked(text,jsonb)') as tracked_signup_rpc,
  to_regprocedure('public.request_blabee_beta(text)') as legacy_signup_rpc,
  to_regnamespace('blabee_dashboard') as dashboard_schema,
  to_regprocedure('public.blabee_dashboard_overview(date,date)') as overview_rpc,
  to_regprocedure('public.blabee_dashboard_posts(text,jsonb,uuid)') as posts_rpc;

-- Expected types: day=date, attribution=jsonb, views=bigint,
-- created_at=timestamp with time zone. Signup attribution must remain nullable.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'blabee_marketing'
  and ((table_name = 'landing_daily_views' and column_name in ('day', 'attribution', 'views'))
    or (table_name = 'beta_requests' and column_name in ('created_at', 'attribution')))
order by table_name, ordinal_position;

-- Only the explicitly requested owner is inspected. No applicant emails leave SQL.
select count(*) as confirmed_owner_matches, array_agg(id order by id) as owner_uids
from auth.users
where lower(email) = 'biadone.official@gmail.com' and email_confirmed_at is not null;

-- Record these hashes and compare with 003. Dashboard installation must leave
-- all source ingestion/normalization functions unchanged.
select p.oid::regprocedure::text as object_name,
       md5(pg_get_functiondef(p.oid)) as definition_hash, p.proacl as function_acl
from pg_proc p
where p.oid in (
  to_regprocedure('public.request_blabee_beta(text)'),
  to_regprocedure('public.request_blabee_beta_tracked(text,jsonb)'),
  to_regprocedure('public.record_blabee_landing_view(jsonb)'),
  to_regprocedure('blabee_marketing.normalize_attribution(jsonb)')
)
order by object_name;

rollback;

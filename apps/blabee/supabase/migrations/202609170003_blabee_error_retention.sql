-- Apply as postgres after 202609170002_blabee_errors.sql on Supabase.
-- pg_cron is Supabase's bundled scheduler, not an app/SDK dependency.
-- Only this feature's expired diagnostics and quota rows are removed.
begin;

create extension if not exists pg_cron;

-- UTC by default on Supabase. Named scheduling is idempotent for this owner.
-- At daily cadence records can remain for up to about 31 days between runs.
select cron.schedule(
    'blabee-error-retention-daily',
    '17 3 * * *',
    'select blabee_analytics.prune_error_events();'
);

commit;

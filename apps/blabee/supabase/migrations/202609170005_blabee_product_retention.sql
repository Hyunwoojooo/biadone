-- Apply as postgres after 202609170004_blabee_product_metrics.sql on Supabase.
-- pg_cron was enabled by the existing error retention migration. This named
-- job does not replace or modify the error-diagnostics housekeeping job.
begin;

-- UTC on the configured Supabase project. Daily cadence retains temporary
-- receipts/operation state for up to roughly nine days between runs.
select cron.schedule(
    'blabee-product-retention-daily',
    '27 3 * * *',
    'select blabee_analytics.prune_product_event_receipts();'
);

commit;

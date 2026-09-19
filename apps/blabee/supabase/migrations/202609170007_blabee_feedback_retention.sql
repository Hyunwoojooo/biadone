-- Apply as postgres after 202609170006. pg_cron already enabled by 0003.
-- Preserve existing error/product jobs. Feedback content is logically hidden at
-- 30 days; daily physical cleanup can lag by less than a day.
begin;
select cron.schedule(
    'blabee-feedback-retention-daily',
    '37 3 * * *',
    'select blabee_analytics.prune_feedback_data();'
);
commit;

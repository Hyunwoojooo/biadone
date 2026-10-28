-- Owner-only report: daily page views and NEW beta requests, grouped by source.
-- Edit the half-open UTC date range below. No email addresses are returned.
-- Views are page loads, not unique people or verified clicks. Old/opted-out
-- signups remain "unmeasured". This is not a cohort conversion-rate calculation.
with date_range as (
  select ((now() at time zone 'UTC')::date - 29) as start_day,
         ((now() at time zone 'UTC')::date + 1) as end_day
), events as (
  select day, attribution, views as page_views, 0::bigint as beta_requests
  from blabee_marketing.landing_daily_views, date_range
  where day >= start_day and day < end_day
  union all
  select (created_at at time zone 'UTC')::date, attribution, 0::bigint, 1::bigint
  from blabee_marketing.beta_requests, date_range
  where created_at >= start_day::timestamp at time zone 'UTC'
    and created_at < end_day::timestamp at time zone 'UTC'
)
select coalesce(attribution ->> 'source', 'unmeasured') as source,
       coalesce(attribution ->> 'source_type', 'unmeasured') as source_type,
       coalesce(attribution ->> 'medium', '') as medium,
       coalesce(attribution ->> 'campaign', '') as campaign,
       coalesce(attribution ->> 'content', '') as content,
       sum(page_views) as page_views,
       sum(beta_requests) as new_beta_requests
from events
group by 1, 2, 3, 4, 5
order by page_views desc, new_beta_requests desc, source, campaign, content;

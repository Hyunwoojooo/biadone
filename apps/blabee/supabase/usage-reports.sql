-- PRIVILEGED REPORTS: run individually in Supabase SQL Editor as postgres.
-- Do not create public views or expose these queries through a client API.
-- Email is joined from auth.users for this report, never copied into analytics.
-- Only opted-in actions observed after an upgraded app starts collection are
-- included; historical usage is not backfilled. Offline/dropped
-- events, logged-out use, and unavailable collection are absent. Counts are not
-- billing measures. Lack of activity is not proof of uninstall or churn.

-- 1. Per-account totals, including accounts with no observed action.
-- "First observed use" differs from account creation / first login.
with usage_by_user as (
    select
        user_id,
        min(first_used_at) as first_observed_use_at,
        max(last_used_at) as last_observed_use_at,
        sum(action_count) as observed_action_count,
        count(distinct activity_date) as active_utc_days
    from blabee_analytics.daily_activity
    group by user_id
)
select
    users.id as user_id,
    users.email,
    users.created_at as account_created_at,
    usage.first_observed_use_at,
    usage.last_observed_use_at,
    coalesce(usage.observed_action_count, 0) as observed_action_count,
    coalesce(usage.active_utc_days, 0) as active_utc_days
from auth.users as users
left join usage_by_user as usage on usage.user_id = users.id
order by usage.last_observed_use_at desc nulls last, users.id;

-- 2. The latest 30 UTC calendar dates (today is partial), including zero days.
-- 7/30-day users are distinct users in inclusive calendar-date windows, not
-- sums of daily users. Future UTC dates allowed by clock skew appear when due.
with report_dates as (
    select (pg_catalog.now() at time zone 'UTC')::date - offset_days as activity_date
    from pg_catalog.generate_series(0, 29) as offsets(offset_days)
)
select
    dates.activity_date,
    (
        select count(distinct activity.user_id)
        from blabee_analytics.daily_activity as activity
        where activity.activity_date = dates.activity_date
    ) as observed_daily_users,
    (
        select coalesce(sum(activity.action_count), 0)
        from blabee_analytics.daily_activity as activity
        where activity.activity_date = dates.activity_date
    ) as observed_action_count,
    (
        select count(distinct activity.user_id)
        from blabee_analytics.daily_activity as activity
        where activity.activity_date between dates.activity_date - 6 and dates.activity_date
    ) as observed_7_day_users,
    (
        select count(distinct activity.user_id)
        from blabee_analytics.daily_activity as activity
        where activity.activity_date between dates.activity_date - 29 and dates.activity_date
    ) as observed_30_day_users
from report_dates as dates
order by dates.activity_date desc;

-- 3. Last-use gap by UTC calendar date; these are observation labels, not churn.
with last_use as (
    select user_id, max(last_used_at) as last_observed_use_at
    from blabee_analytics.daily_activity
    group by user_id
), gaps as (
    select
        users.id as user_id,
        users.email,
        last_use.last_observed_use_at,
        greatest(
            0,
            (pg_catalog.now() at time zone 'UTC')::date
                - (last_use.last_observed_use_at at time zone 'UTC')::date
        ) as utc_days_since_last_use
    from auth.users as users
    left join last_use on last_use.user_id = users.id
)
select
    user_id,
    email,
    last_observed_use_at,
    case when last_observed_use_at is not null then utc_days_since_last_use end
        as utc_days_since_last_use,
    case
        when last_observed_use_at is null then 'no_observed_usage'
        when utc_days_since_last_use <= 6 then 'observed_within_7_days'
        when utc_days_since_last_use <= 29 then 'no_observed_use_for_7_to_29_days'
        else 'no_observed_use_for_30_plus_days'
    end as observation_status
from gaps
order by last_observed_use_at desc nulls last, user_id;

-- 4. Exact-day D7 retention: action on first observed date + 7 UTC dates.
-- Include a cohort only after its full D7 UTC date AND the accepted seven-day
-- late-arrival window have closed. Cohorts use observed use, not signup date.
-- Late first observations can move a user between cohorts until that window
-- closes. Account deletion removes the account from historical reports too.
with cohorts as (
    select user_id, min(activity_date) as first_observed_date
    from blabee_analytics.daily_activity
    group by user_id
), matured as (
    select user_id, first_observed_date
    from cohorts
    where first_observed_date + 15 <= (pg_catalog.now() at time zone 'UTC')::date
)
select
    cohort.first_observed_date,
    count(*) as observed_cohort_users,
    count(*) filter (where exists (
        select 1
        from blabee_analytics.daily_activity as activity
        where activity.user_id = cohort.user_id
            and activity.activity_date = cohort.first_observed_date + 7
    )) as observed_d7_returning_users,
    round(
        100.0 * count(*) filter (where exists (
            select 1
            from blabee_analytics.daily_activity as activity
            where activity.user_id = cohort.user_id
                and activity.activity_date = cohort.first_observed_date + 7
        )) / count(*),
        1
    ) as observed_d7_retention_percent
from matured as cohort
group by cohort.first_observed_date
order by cohort.first_observed_date desc;

-- Maintenance (run separately as postgres; no client execute permission):
-- select blabee_analytics.prune_usage_event_receipts();
-- Daily aggregates are intentionally retained until the auth account is deleted.

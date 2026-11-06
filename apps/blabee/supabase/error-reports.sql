-- PRIVILEGED REPORTS: run each SELECT individually as postgres in SQL Editor.
-- Never expose these reports through a public view or client API. Email is
-- joined from auth.users only in the administrator report, never copied here.
-- These are observed, opted-in reports: logged-out/offline/dropped events and
-- unsupported crashes are absent. Each user is capped at 200 accepted distinct
-- errors per UTC receipt day. Suppressed errors are not counted or retried.
-- Counts are therefore NOT exact failures or a product failure rate. There is
-- no denominator of attempted operations and no claim of complete coverage.
-- Windows use received_at (server time) to match 30-day receipt retention;
-- occurred_at remains the client-reported failure time and may arrive late.

-- 1. Issues received in the last 7 and 30 elapsed days, split by app/OS version.
-- Each event belongs to both windows if it arrived in the most recent 7 days.
with windows as (
    select * from (values (7), (30)) as periods(received_window_days)
)
select
    windows.received_window_days,
    errors.error_code,
    errors.app_version,
    errors.app_build,
    errors.os_version,
    count(*) as observed_error_count,
    count(distinct errors.user_id) as observed_affected_users,
    max(errors.occurred_at) as last_observed_error_at,
    max(errors.received_at) as last_received_at
from windows
join blabee_analytics.error_events as errors
    on errors.received_at >= pg_catalog.now()
        - pg_catalog.make_interval(hours => windows.received_window_days * 24)
    and errors.received_at <= pg_catalog.now()
group by windows.received_window_days, errors.error_code,
    errors.app_version, errors.app_build, errors.os_version
order by windows.received_window_days, observed_affected_users desc,
    observed_error_count desc, errors.error_code, errors.app_version,
    errors.app_build, errors.os_version;

-- 2. Most recent observed error per account, limited to the last 30 receipt days.
-- Users without a retained observed error are omitted; absence means unknown.
with latest_errors as (
    select distinct on (errors.user_id)
        errors.user_id, errors.event_id, errors.error_code, errors.occurred_at,
        errors.received_at, errors.app_version, errors.app_build, errors.os_version
    from blabee_analytics.error_events as errors
    where errors.received_at >= pg_catalog.now() - interval '720 hours'
        and errors.received_at <= pg_catalog.now()
    order by errors.user_id, errors.occurred_at desc,
        errors.received_at desc, errors.event_id desc
)
select
    latest.user_id,
    users.email,
    latest.error_code,
    latest.occurred_at as last_observed_error_at,
    latest.received_at,
    latest.app_version,
    latest.app_build,
    latest.os_version
from latest_errors as latest
join auth.users as users on users.id = latest.user_id
order by latest.occurred_at desc, latest.user_id;

-- 3. The latest 30 UTC receipt dates, including zero dates (today is partial).
with report_dates as (
    select (pg_catalog.now() at time zone 'UTC')::date - offset_days as received_date
    from pg_catalog.generate_series(0, 29) as offsets(offset_days)
)
select
    dates.received_date,
    count(errors.event_id) as observed_error_count,
    count(distinct errors.user_id) as observed_affected_users
from report_dates as dates
left join blabee_analytics.error_events as errors
    on errors.received_at >= dates.received_date::timestamp at time zone 'UTC'
    and errors.received_at < (dates.received_date + 1)::timestamp at time zone 'UTC'
    and errors.received_at <= pg_catalog.now()
group by dates.received_date
order by dates.received_date desc;

-- Maintenance (run separately/schedule as postgres; no client permission):
-- select blabee_analytics.prune_error_events();
-- Migration 202609170002 provides cleanup; companion 202609170003 schedules it.

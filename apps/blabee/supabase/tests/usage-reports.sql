-- Report fixtures/assertions for an EMPTY, DISPOSABLE database after migration.
-- This script leaves a transaction open. In the same connection, execute the
-- four actual queries in ../usage-reports.sql, pass their JSON result arrays to
-- pg_temp.assert_usage_reports(users, daily, gaps, retention), then ROLLBACK.
-- A driver must not substitute copies of the report queries. No pgTAP needed.
begin;
set local timezone = 'Pacific/Honolulu';

do $test$
begin
    if exists (select 1 from auth.users)
        or exists (select 1 from blabee_analytics.daily_activity)
        or exists (select 1 from blabee_analytics.event_receipts) then
        raise exception 'Report fixtures require an empty disposable database';
    end if;
end;
$test$;

create temporary table usage_report_expected_users (
    user_id uuid primary key,
    email text not null,
    observed_action_count numeric not null,
    active_utc_days bigint not null,
    first_observed_use_at timestamptz,
    last_observed_use_at timestamptz,
    utc_days_since_last_use integer,
    observation_status text not null
) on commit drop;

create function pg_temp.usage_fixture_time(days_ago integer, seconds_after_midnight integer)
returns timestamptz language sql stable set search_path = '' as $function$
    select (((pg_catalog.now() at time zone 'UTC')::date - days_ago)::timestamp
        + pg_catalog.make_interval(secs => seconds_after_midnight)) at time zone 'UTC';
$function$;

-- A and B share a mature cohort. Only A returns on exact D7; B returns on D6.
-- C is immature. D has an account but no observed activity.
insert into usage_report_expected_users values
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760011', 'usage-a@example.invalid', 10, 2,
        pg_temp.usage_fixture_time(20, 43200), pg_temp.usage_fixture_time(13, 36120),
        13, 'no_observed_use_for_7_to_29_days'),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760012', 'usage-b@example.invalid', 6, 2,
        pg_temp.usage_fixture_time(20, 50400), pg_temp.usage_fixture_time(14, 54000),
        14, 'no_observed_use_for_7_to_29_days'),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760013', 'usage-c@example.invalid', 5, 2,
        pg_temp.usage_fixture_time(2, 32400), pg_temp.usage_fixture_time(0, 0),
        0, 'observed_within_7_days'),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760014', 'usage-d@example.invalid', 0, 0,
        null, null, null, 'no_observed_usage');

insert into auth.users (id, email, created_at, updated_at)
select user_id, email, pg_temp.usage_fixture_time(30, 0), pg_temp.usage_fixture_time(30, 0)
from usage_report_expected_users;

-- Historical aggregate fixtures are inserted by the owner, not the bounded RPC.
insert into blabee_analytics.daily_activity
    (user_id, activity_date, event_kind, action_count, first_used_at, last_used_at)
select
    events.user_id::uuid,
    (pg_catalog.now() at time zone 'UTC')::date - events.days_ago,
    events.event_kind,
    events.action_count,
    pg_temp.usage_fixture_time(events.days_ago, events.first_second),
    pg_temp.usage_fixture_time(events.days_ago, events.last_second)
from (values
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760011', 20, 'choice_accepted', 2, 43200, 43260),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760011', 20, 'approval_resolved', 1, 46800, 46800),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760011', 13, 'choice_accepted', 3, 32400, 32460),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760011', 13, 'approval_resolved', 4, 36000, 36120),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760012', 20, 'choice_accepted', 5, 50400, 50580),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760012', 14, 'suggestion_dismissed', 1, 54000, 54000),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760013', 2, 'choice_accepted', 2, 32400, 32580),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760013', 0, 'approval_resolved', 3, 0, 0)
) as events(user_id, days_ago, event_kind, action_count, first_second, last_second);

create temporary table usage_report_expected_dates (
    days_ago integer primary key,
    observed_daily_users bigint not null,
    observed_action_count numeric not null,
    observed_7_day_users bigint not null,
    observed_30_day_users bigint not null
) on commit drop;
insert into usage_report_expected_dates values
    (0, 1, 3, 1, 3),
    (2, 1, 2, 1, 3),
    (6, 0, 0, 0, 2),
    (7, 0, 0, 1, 2),
    (8, 0, 0, 2, 2),
    (12, 0, 0, 2, 2),
    (13, 1, 7, 2, 2),
    (14, 1, 1, 2, 2),
    (20, 2, 8, 2, 2),
    (29, 0, 0, 0, 0);

create function pg_temp.assert_usage_reports(
    p_users jsonb, p_daily jsonb, p_gaps jsonb, p_retention jsonb
)
returns void language plpgsql set search_path = '' as $function$
declare
    v_today date := (pg_catalog.now() at time zone 'UTC')::date;
begin
    if pg_catalog.jsonb_array_length(p_users) is distinct from 4 then
        raise exception 'Account report must include all four fixture users';
    end if;
    if exists (
        select 1 from pg_temp.usage_report_expected_users as expected
        full join pg_catalog.jsonb_to_recordset(p_users) as actual(
            user_id uuid, email text, observed_action_count numeric, active_utc_days bigint,
            first_observed_use_at timestamptz, last_observed_use_at timestamptz
        ) on actual.user_id = expected.user_id
        where actual.user_id is null or expected.user_id is null
            or actual.email is distinct from expected.email
            or actual.observed_action_count is distinct from expected.observed_action_count
            or actual.active_utc_days is distinct from expected.active_utc_days
            or actual.first_observed_use_at is distinct from expected.first_observed_use_at
            or actual.last_observed_use_at is distinct from expected.last_observed_use_at
    ) then
        raise exception 'Account totals, distinct days, email, or first/last observations incorrect';
    end if;
    raise notice 'PASS: actual account report totals, distinct days, and first/last observations';

    if pg_catalog.jsonb_array_length(p_daily) is distinct from 30
        or (select count(distinct activity_date) from pg_catalog.jsonb_to_recordset(p_daily)
            as dates(activity_date date)) <> 30
        or exists (select 1 from pg_catalog.jsonb_to_recordset(p_daily)
            as dates(activity_date date)
            where activity_date is null or activity_date not between v_today - 29 and v_today)
    then
        raise exception 'Daily report must include exactly the latest thirty UTC dates';
    end if;
    if exists (
        select 1 from pg_temp.usage_report_expected_dates as expected
        left join pg_catalog.jsonb_to_recordset(p_daily) as actual(
            activity_date date, observed_daily_users bigint, observed_action_count numeric,
            observed_7_day_users bigint, observed_30_day_users bigint
        ) on actual.activity_date = v_today - expected.days_ago
        where actual.activity_date is null
            or actual.observed_daily_users is distinct from expected.observed_daily_users
            or actual.observed_action_count is distinct from expected.observed_action_count
            or actual.observed_7_day_users is distinct from expected.observed_7_day_users
            or actual.observed_30_day_users is distinct from expected.observed_30_day_users
    ) then
        raise exception 'Daily totals, zero days, or distinct 7/30-day user windows incorrect';
    end if;
    raise notice 'PASS: actual daily report, zero days, and distinct 7/30-day window edges';

    if pg_catalog.jsonb_array_length(p_gaps) is distinct from 4 then
        raise exception 'Last-use report must include all four fixture users';
    end if;
    if exists (
        select 1 from pg_temp.usage_report_expected_users as expected
        full join pg_catalog.jsonb_to_recordset(p_gaps) as actual(
            user_id uuid, email text, last_observed_use_at timestamptz,
            utc_days_since_last_use integer, observation_status text
        ) on actual.user_id = expected.user_id
        where actual.user_id is null or expected.user_id is null
            or actual.email is distinct from expected.email
            or actual.last_observed_use_at is distinct from expected.last_observed_use_at
            or actual.utc_days_since_last_use is distinct from expected.utc_days_since_last_use
            or actual.observation_status is distinct from expected.observation_status
    ) then
        raise exception 'Last-use gaps or no_observed_usage classification incorrect';
    end if;
    raise notice 'PASS: actual last-use gap report preserves no_observed_usage';

    if pg_catalog.jsonb_array_length(p_retention) is distinct from 1
        or not exists (
            select 1 from pg_catalog.jsonb_to_recordset(p_retention) as actual(
                first_observed_date date, observed_cohort_users bigint,
                observed_d7_returning_users bigint, observed_d7_retention_percent numeric
            )
            where first_observed_date = v_today - 20
                and observed_cohort_users = 2 and observed_d7_returning_users = 1
                and observed_d7_retention_percent = 50.0
        )
    then
        raise exception 'Exact D7 must count A only, with A/B denominator and no immature C or inactive D';
    end if;
    raise notice 'PASS: actual D7 report has mature denominator 2, exact-day returns 1, retention 50 percent';
end;
$function$;

-- The driver now runs the original reports and this assertion function, then
-- rolls back. No fixture, helper, privilege, or usage row should persist.

-- Actual report fixtures for an EMPTY DISPOSABLE database after both migrations.
-- This script leaves a transaction open. In the same connection, execute the
-- three original queries in ../error-reports.sql, pass their JSON result arrays
-- to pg_temp.assert_error_reports(issues, latest, daily), then ROLLBACK.
-- A driver must not substitute rewritten copies of the reports.
begin;
set local timezone = 'Pacific/Honolulu';

do $test$
begin
    if exists (select 1 from auth.users)
        or exists (select 1 from blabee_analytics.error_events)
        or exists (select 1 from blabee_analytics.error_ingest_days) then
        raise exception 'Error report fixtures require an empty disposable database';
    end if;
end;
$test$;

create function pg_temp.error_fixture_midnight(days_ago integer)
returns timestamptz language sql stable set search_path = '' as $function$
    select ((pg_catalog.now() at time zone 'UTC')::date - days_ago)::timestamp at time zone 'UTC';
$function$;

insert into auth.users (id, email, created_at, updated_at) values
    ('a943920f-ef2b-4c53-9924-e7f10d200011', 'error-report-a@example.invalid', now(), now()),
    ('a943920f-ef2b-4c53-9924-e7f10d200012', 'error-report-b@example.invalid', now(), now()),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', 'error-report-c@example.invalid', now(), now()),
    ('a943920f-ef2b-4c53-9924-e7f10d200014', 'error-report-d@example.invalid', now(), now());

-- Trusted-owner fixtures include histories older than the seven-day RPC bound.
insert into blabee_analytics.error_events values
    ('a943920f-ef2b-4c53-9924-e7f10d200011', '00000000-0000-4000-8000-000000000001',
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0),
        'coordinator_connection_failed', '1', '49', '15.6'),
    ('a943920f-ef2b-4c53-9924-e7f10d200011', '00000000-0000-4000-8000-000000000002',
        pg_temp.error_fixture_midnight(1), pg_temp.error_fixture_midnight(1),
        'coordinator_connection_failed', '1', '49', '15.6'),
    ('a943920f-ef2b-4c53-9924-e7f10d200012', '00000000-0000-4000-8000-000000000003',
        pg_temp.error_fixture_midnight(1), pg_temp.error_fixture_midnight(0),
        'coordinator_connection_failed', '1', '49', '15.6'),
    ('a943920f-ef2b-4c53-9924-e7f10d200012', '00000000-0000-4000-8000-000000000004',
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0),
        'app_service_failed', '2', '50', '26'),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', '00000000-0000-4000-8000-000000000005',
        pg_temp.error_fixture_midnight(11), pg_temp.error_fixture_midnight(9),
        'coordinator_connection_failed', '1', '48', '15.5'),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', '00000000-0000-4000-8000-000000000006',
        now() - interval '168 hours', now() - interval '168 hours',
        'account_refresh_failed', '1', '49', 'unknown'),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', '00000000-0000-4000-8000-000000000007',
        now() - interval '168 hours 1 microsecond', now() - interval '168 hours 1 microsecond',
        'account_refresh_failed', '1', '49', 'unknown'),
    ('a943920f-ef2b-4c53-9924-e7f10d200011', '00000000-0000-4000-8000-000000000008',
        now() - interval '720 hours', now() - interval '720 hours',
        'approval_submit_failed', 'unknown', 'unknown', 'unknown'),
    ('a943920f-ef2b-4c53-9924-e7f10d200011', '00000000-0000-4000-8000-000000000009',
        now() - interval '720 hours 1 microsecond', now() - interval '720 hours 1 microsecond',
        'approval_submit_failed', 'unknown', 'unknown', 'unknown'),
    ('a943920f-ef2b-4c53-9924-e7f10d200011', '00000000-0000-4000-8000-000000000010',
        now(), now() + interval '1 hour', 'app_service_failed', 'unknown', 'unknown', 'unknown'),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', '00000000-0000-4000-8000-000000000011',
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0),
        'coordinator_connection_failed', '1', '49', '26'),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', '00000000-0000-4000-8000-000000000012',
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0),
        'coordinator_connection_failed', '2', '49', '15.6');

create temporary table error_report_expected_issues (
    received_window_days integer,
    error_code text,
    app_version text,
    app_build text,
    os_version text,
    observed_error_count bigint,
    observed_affected_users bigint,
    last_observed_error_at timestamptz,
    last_received_at timestamptz
) on commit drop;

insert into error_report_expected_issues
select periods.days, rows.error_code, rows.app_version, rows.app_build,
    rows.os_version, rows.events, rows.users, rows.occurred_at, rows.received_at
from (values (7), (30)) as periods(days)
cross join (values
    ('coordinator_connection_failed', '1', '49', '15.6', 3, 2,
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0)),
    ('coordinator_connection_failed', '1', '49', '26', 1, 1,
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0)),
    ('coordinator_connection_failed', '2', '49', '15.6', 1, 1,
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0)),
    ('app_service_failed', '2', '50', '26', 1, 1,
        pg_temp.error_fixture_midnight(0), pg_temp.error_fixture_midnight(0))
) as rows(error_code, app_version, app_build, os_version, events, users, occurred_at, received_at);

insert into error_report_expected_issues values
    (7, 'account_refresh_failed', '1', '49', 'unknown', 1, 1,
        now() - interval '168 hours', now() - interval '168 hours'),
    (30, 'account_refresh_failed', '1', '49', 'unknown', 2, 1,
        now() - interval '168 hours', now() - interval '168 hours'),
    (30, 'coordinator_connection_failed', '1', '48', '15.5', 1, 1,
        pg_temp.error_fixture_midnight(11), pg_temp.error_fixture_midnight(9)),
    (30, 'approval_submit_failed', 'unknown', 'unknown', 'unknown', 1, 1,
        now() - interval '720 hours', now() - interval '720 hours');

create temporary table error_report_expected_latest (
    user_id uuid,
    email text,
    error_code text,
    app_version text,
    app_build text,
    os_version text
) on commit drop;
insert into error_report_expected_latest values
    ('a943920f-ef2b-4c53-9924-e7f10d200011', 'error-report-a@example.invalid',
        'coordinator_connection_failed', '1', '49', '15.6'),
    ('a943920f-ef2b-4c53-9924-e7f10d200012', 'error-report-b@example.invalid',
        'app_service_failed', '2', '50', '26'),
    ('a943920f-ef2b-4c53-9924-e7f10d200013', 'error-report-c@example.invalid',
        'coordinator_connection_failed', '2', '49', '15.6');

create function pg_temp.assert_error_reports(p_issues jsonb, p_latest jsonb, p_daily jsonb)
returns void language plpgsql set search_path = '' as $function$
declare
    v_today date := (pg_catalog.now() at time zone 'UTC')::date;
    v_edge_date date := ((pg_catalog.now() - interval '168 hours 1 microsecond') at time zone 'UTC')::date;
begin
    if pg_catalog.jsonb_array_length(p_issues) is distinct from 12 or exists (
        select 1 from pg_temp.error_report_expected_issues as expected
        full join pg_catalog.jsonb_to_recordset(p_issues) as actual(
            received_window_days integer, error_code text, app_version text,
            app_build text, os_version text, observed_error_count bigint,
            observed_affected_users bigint, last_observed_error_at timestamptz,
            last_received_at timestamptz
        ) using (received_window_days, error_code, app_version, app_build, os_version)
        where expected.error_code is null or actual.error_code is null
            or actual.observed_error_count is distinct from expected.observed_error_count
            or actual.observed_affected_users is distinct from expected.observed_affected_users
            or actual.last_observed_error_at is distinct from expected.last_observed_error_at
            or actual.last_received_at is distinct from expected.last_received_at
    ) then
        raise exception 'Issue report groups, distinct affected users, version splits, or 7/30-day edges incorrect';
    end if;
    raise notice 'PASS: actual grouped issue report, exact 7/30-day receipt boundaries, and affected users';

    if pg_catalog.jsonb_array_length(p_latest) is distinct from 3 or exists (
        select 1 from pg_temp.error_report_expected_latest as expected
        full join pg_catalog.jsonb_to_recordset(p_latest) as actual(
            user_id uuid, email text, error_code text, last_observed_error_at timestamptz,
            received_at timestamptz, app_version text, app_build text, os_version text
        ) using (user_id)
        where expected.user_id is null or actual.user_id is null
            or actual.email is distinct from expected.email
            or actual.error_code is distinct from expected.error_code
            or actual.app_version is distinct from expected.app_version
            or actual.app_build is distinct from expected.app_build
            or actual.os_version is distinct from expected.os_version
            or actual.last_observed_error_at is distinct from pg_temp.error_fixture_midnight(0)
            or actual.received_at is distinct from pg_temp.error_fixture_midnight(0)
    ) then
        raise exception 'Latest per-user error/email report, deterministic ties, or future receipt exclusion incorrect';
    end if;
    raise notice 'PASS: actual latest error per user, separate email join, no-observation omission, and tie order';

    if pg_catalog.jsonb_array_length(p_daily) is distinct from 30
        or (select count(distinct received_date) from pg_catalog.jsonb_to_recordset(p_daily)
            as actual(received_date date)) <> 30
        or exists (select 1 from pg_catalog.jsonb_to_recordset(p_daily)
            as actual(received_date date)
            where received_date is null or received_date not between v_today - 29 and v_today)
        or (select sum(observed_error_count) from pg_catalog.jsonb_to_recordset(p_daily)
            as actual(observed_error_count bigint)) <> 9
        or exists (
            select 1 from pg_catalog.jsonb_to_recordset(p_daily)
                as actual(received_date date, observed_error_count bigint, observed_affected_users bigint)
            where observed_error_count is distinct from case
                when received_date = v_today then 5
                when received_date in (v_today - 1, v_today - 9) then 1
                when received_date = v_today - 7 then case when v_edge_date = v_today - 7 then 2 else 1 end
                when received_date = v_edge_date then 1
                else 0 end::bigint
                or observed_affected_users is distinct from case
                    when received_date = v_today then 3
                    when received_date in (v_today - 1, v_today - 7, v_today - 9, v_edge_date) then 1
                    else 0 end::bigint
        )
    then
        raise exception 'Daily report must contain 30 UTC dates including zero days, receipt-day late arrivals, and 9 events';
    end if;
    raise notice 'PASS: actual daily UTC report, zero days, late-arrival receipt dates, and future exclusion';
end;
$function$;

-- The driver executes the original report SELECTs and this assertion function,
-- then rolls back every fixture and helper in the same connection.

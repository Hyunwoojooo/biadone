-- Disposable owner-only fixtures for the ACTUAL SELECTs in product-reports.sql.
-- Driver executes those unchanged queries, passes result JSON to assertions,
-- and rolls back this entire transaction (including these temporary helpers).
begin;
set local timezone = 'Pacific/Honolulu';

insert into auth.users (id, email, created_at, updated_at) values
    ('c812fa00-0000-4000-8000-000000000001', 'report-product-one@example.invalid', now(), now()),
    ('c812fa00-0000-4000-8000-000000000002', 'report-product-two@example.invalid', now(), now()),
    ('c812fa00-0000-4000-8000-000000000003', 'report-future@example.invalid', now(), now()),
    ('c812fa00-0000-4000-8000-000000000004', 'report-no-observation@example.invalid', now(), now());

insert into blabee_analytics.product_milestones (user_id, milestone, first_observed_date)
select fixtures.user_id::uuid, fixtures.milestone,
    (now() at time zone 'UTC')::date + fixtures.date_offset
from (values
    ('c812fa00-0000-4000-8000-000000000001', 'account_ready', -6),
    ('c812fa00-0000-4000-8000-000000000001', 'service_connected', -5),
    ('c812fa00-0000-4000-8000-000000000001', 'card_received', -5),
    ('c812fa00-0000-4000-8000-000000000001', 'first_action', -4),
    ('c812fa00-0000-4000-8000-000000000002', 'account_ready', -2),
    ('c812fa00-0000-4000-8000-000000000003', 'first_action', 1)
) as fixtures(user_id, milestone, date_offset);

insert into blabee_analytics.product_operation_days (
    user_id, operation_date, feature, input_method, app_version, app_build, os_major,
    ui_language, target_version, target_build, outcome, latency_bucket, operation_count
)
select fixtures.user_id::uuid, (now() at time zone 'UTC')::date + fixtures.date_offset,
    fixtures.feature, fixtures.input_method, '1.0.0', '55', '15', 'ko',
    fixtures.target_version, fixtures.target_build, fixtures.outcome, fixtures.latency_bucket, fixtures.count
from (values
    -- Choice/button: 7 attempts, 3 success / 1 failure / 1 cancelled / 2 pending.
    ('c812fa00-0000-4000-8000-000000000001', 0, 'choice', 'button', 'none', 'none', 'succeeded', 'under_1s', 2),
    ('c812fa00-0000-4000-8000-000000000001', 0, 'choice', 'button', 'none', 'none', 'failed', 'over_3s', 1),
    ('c812fa00-0000-4000-8000-000000000002', 0, 'choice', 'button', 'none', 'none', 'pending', 'none', 2),
    ('c812fa00-0000-4000-8000-000000000002', 0, 'choice', 'button', 'none', 'none', 'cancelled', 'unknown', 1),
    ('c812fa00-0000-4000-8000-000000000002', -29, 'choice', 'button', 'none', 'none', 'succeeded', 'under_1s', 1),
    -- Keyboard is separate. Pending-only/cancelled-only groups have NULL resolved rate.
    ('c812fa00-0000-4000-8000-000000000001', 0, 'choice', 'keyboard', 'none', 'none', 'succeeded', '1_to_3s', 1),
    ('c812fa00-0000-4000-8000-000000000001', 0, 'approval', 'keyboard', 'none', 'none', 'pending', 'none', 1),
    ('c812fa00-0000-4000-8000-000000000002', 0, 'dismiss', 'button', 'none', 'none', 'cancelled', 'unknown', 1),
    -- Excluded old/future/zero rows.
    ('c812fa00-0000-4000-8000-000000000001', -30, 'choice', 'button', 'none', 'none', 'succeeded', 'under_1s', 100),
    ('c812fa00-0000-4000-8000-000000000003', 1, 'choice', 'button', 'none', 'none', 'succeeded', 'under_1s', 100),
    ('c812fa00-0000-4000-8000-000000000003', 0, 'choice', 'button', 'none', 'none', 'pending', 'none', 0),
    -- Target 60: 5 attempts: 2 succeeded, 1 failed, 1 cancelled, 1 pending.
    ('c812fa00-0000-4000-8000-000000000001', 0, 'app_update', 'none', '1.1', '60', 'succeeded', 'none', 2),
    ('c812fa00-0000-4000-8000-000000000001', 0, 'app_update', 'none', '1.1', '60', 'failed', 'none', 1),
    ('c812fa00-0000-4000-8000-000000000002', 0, 'app_update', 'none', '1.1', '60', 'cancelled', 'none', 1),
    ('c812fa00-0000-4000-8000-000000000002', -29, 'app_update', 'none', '1.1', '60', 'pending', 'none', 1),
    -- Target 62: operation without observed proposal must still appear.
    ('c812fa00-0000-4000-8000-000000000002', 0, 'app_update', 'none', '1.1', '62', 'pending', 'none', 1),
    ('c812fa00-0000-4000-8000-000000000003', 1, 'app_update', 'none', '1.1', '60', 'succeeded', 'none', 100),
    ('c812fa00-0000-4000-8000-000000000001', -30, 'app_update', 'none', '1.1', '60', 'succeeded', 'none', 100)
) as fixtures(user_id, date_offset, feature, input_method, target_version, target_build, outcome, latency_bucket, count);

insert into blabee_analytics.product_environment_days (
    user_id, observed_date, app_version, app_build, os_major, ui_language
)
select fixtures.user_id::uuid, (now() at time zone 'UTC')::date + fixtures.date_offset,
    '1.0.0', fixtures.app_build, '15', fixtures.ui_language
from (values
    ('c812fa00-0000-4000-8000-000000000001', 0, '55', 'ko'),
    ('c812fa00-0000-4000-8000-000000000001', -1, '55', 'ko'),
    ('c812fa00-0000-4000-8000-000000000002', -29, '55', 'ko'),
    ('c812fa00-0000-4000-8000-000000000001', 0, '56', 'ko'),
    ('c812fa00-0000-4000-8000-000000000002', 0, '55', 'en'),
    ('c812fa00-0000-4000-8000-000000000003', 1, '55', 'ko'),
    ('c812fa00-0000-4000-8000-000000000003', -30, '55', 'ko')
) as fixtures(user_id, date_offset, app_build, ui_language);

insert into blabee_analytics.product_update_offer_days (
    user_id, observed_date, target_version, target_build, app_version, app_build, os_major, ui_language
)
select fixtures.user_id::uuid, (now() at time zone 'UTC')::date + fixtures.date_offset,
    '1.1', fixtures.target_build, '1.0.0', '55', '15', 'ko'
from (values
    ('c812fa00-0000-4000-8000-000000000001', 0, '60'),
    ('c812fa00-0000-4000-8000-000000000001', -1, '60'),
    ('c812fa00-0000-4000-8000-000000000002', -29, '60'),
    ('c812fa00-0000-4000-8000-000000000001', 0, '61'),
    ('c812fa00-0000-4000-8000-000000000003', 1, '60'),
    ('c812fa00-0000-4000-8000-000000000003', -30, '60')
) as fixtures(user_id, date_offset, target_build);

-- Legacy counts are intentionally huge: product rates must never use them.
insert into blabee_analytics.daily_activity values
    ('c812fa00-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date,
        'choice_accepted', 999999, now(), now());
insert into blabee_analytics.error_events values
    ('c812fa00-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
        now(), now(), 'choice_submit_failed', '1.0.0', '55', '15.6');

create function pg_temp.assert_product_reports(
    p_stages jsonb, p_features jsonb, p_latency jsonb, p_environment jsonb, p_updates jsonb
)
returns void language plpgsql as $function$
declare
    v_today date := (now() at time zone 'UTC')::date;
    v_actual record;
begin
    if jsonb_array_length(p_stages) <> 2 or not exists (
        select 1 from jsonb_to_recordset(p_stages) as actual(
            user_id uuid, email text, account_ready_date date, service_connected_date date,
            card_received_date date, first_action_date date)
        where user_id = 'c812fa00-0000-4000-8000-000000000001'
            and email = 'report-product-one@example.invalid'
            and account_ready_date = v_today - 6 and service_connected_date = v_today - 5
            and card_received_date = v_today - 5 and first_action_date = v_today - 4
    ) or not exists (
        select 1 from jsonb_to_recordset(p_stages) as actual(
            user_id uuid, account_ready_date date, service_connected_date date, card_received_date date, first_action_date date)
        where user_id = 'c812fa00-0000-4000-8000-000000000002'
            and account_ready_date = v_today - 2 and service_connected_date is null
            and card_received_date is null and first_action_date is null
    ) then raise exception 'Actual onboarding report changed dates, filled unknowns or included future/no-observation users'; end if;
    raise notice 'PASS: actual onboarding report dates, separate email join, unknown/missing and future handling';

    select * into v_actual from jsonb_to_recordset(p_features) as actual(
        feature text, input_method text, app_version text, app_build text, os_major text, ui_language text,
        observed_attempts bigint, observed_succeeded bigint, observed_failed bigint,
        observed_cancelled bigint, observed_pending bigint, observed_users bigint,
        observed_success_per_attempt_percent numeric, observed_success_among_success_or_failure_percent numeric)
    where feature = 'choice' and input_method = 'button';
    if jsonb_array_length(p_features) <> 4 or v_actual.observed_attempts is distinct from 7::bigint
        or v_actual.observed_succeeded is distinct from 3::bigint or v_actual.observed_failed is distinct from 1::bigint
        or v_actual.observed_cancelled is distinct from 1::bigint or v_actual.observed_pending is distinct from 2::bigint
        or v_actual.observed_users is distinct from 2::bigint
        or v_actual.observed_success_per_attempt_percent is distinct from 42.9
        or v_actual.observed_success_among_success_or_failure_percent is distinct from 75.0
        or v_actual.app_version is distinct from '1.0.0' or v_actual.app_build is distinct from '55'
        or v_actual.os_major is distinct from '15' or v_actual.ui_language is distinct from 'ko'
        or (select count(*) from jsonb_to_recordset(p_features) as actual(
            feature text, observed_success_among_success_or_failure_percent numeric)
            where feature in ('approval', 'dismiss') and observed_success_among_success_or_failure_percent is null) <> 2
        or not exists (select 1 from jsonb_to_recordset(p_features) as actual(
            feature text, input_method text, observed_attempts bigint, observed_success_per_attempt_percent numeric)
            where feature = 'choice' and input_method = 'keyboard'
                and observed_attempts = 1 and observed_success_per_attempt_percent = 100.0)
    then raise exception 'Actual feature report lost paired denominator/cancellation/pending/input separation or window boundaries'; end if;
    raise notice 'PASS: actual feature rates use paired attempts, split inputs, cancellation/pending and zero resolved denominator';

    if jsonb_array_length(p_latency) <> 5 or (select sum(observed_operations)
        from jsonb_to_recordset(p_latency) as actual(observed_operations bigint)) <> 7
        or not exists (select 1 from jsonb_to_recordset(p_latency) as actual(
            feature text, input_method text, outcome text, latency_bucket text, observed_operations bigint)
            where feature = 'choice' and input_method = 'button' and outcome = 'succeeded'
                and latency_bucket = 'under_1s' and observed_operations = 3)
        or exists (select 1 from jsonb_to_recordset(p_latency) as actual(feature text, outcome text, latency_bucket text)
            where feature = 'app_update' or outcome = 'pending' or latency_bucket = 'none')
        or (select sum(observed_operations) from jsonb_to_recordset(p_latency)
            as actual(outcome text, latency_bucket text, observed_operations bigint)
            where outcome = 'cancelled' and latency_bucket = 'unknown') <> 2
    then raise exception 'Actual latency report merged outcomes, included pending/update, or omitted unknown'; end if;
    raise notice 'PASS: actual latency buckets retain outcome/unknown and exclude pending/update durations';

    if jsonb_array_length(p_environment) <> 3 or not exists (
        select 1 from jsonb_to_recordset(p_environment) as actual(
            app_build text, ui_language text, observed_users bigint, observed_user_environment_days bigint, last_observed_date date)
        where app_build = '55' and ui_language = 'ko' and observed_users = 2
            and observed_user_environment_days = 3 and last_observed_date = v_today
    ) or (select sum(observed_users) from jsonb_to_recordset(p_environment) as actual(observed_users bigint)) <> 4
        or (select sum(observed_user_environment_days) from jsonb_to_recordset(p_environment)
            as actual(observed_user_environment_days bigint)) <> 5
    then raise exception 'Actual environment report confused unique users with user-days or lost environment dimensions'; end if;
    raise notice 'PASS: actual environment report distinct users, repeated days and version/language cohorts';

    select * into v_actual from jsonb_to_recordset(p_updates) as actual(
        target_version text, target_build text, observed_offered_users bigint, observed_offer_user_days bigint,
        observed_attempts bigint, observed_succeeded bigint, observed_failed bigint,
        observed_cancelled bigint, observed_pending bigint,
        observed_success_per_attempt_percent numeric, observed_success_among_success_or_failure_percent numeric)
    where target_version = '1.1' and target_build = '60';
    if jsonb_array_length(p_updates) <> 3 or v_actual.observed_offered_users is distinct from 2::bigint
        or v_actual.observed_offer_user_days is distinct from 3::bigint or v_actual.observed_attempts is distinct from 5::bigint
        or v_actual.observed_succeeded is distinct from 2::bigint or v_actual.observed_failed is distinct from 1::bigint
        or v_actual.observed_cancelled is distinct from 1::bigint or v_actual.observed_pending is distinct from 1::bigint
        or v_actual.observed_success_per_attempt_percent is distinct from 40.0
        or v_actual.observed_success_among_success_or_failure_percent is distinct from 66.7
        or not exists (select 1 from jsonb_to_recordset(p_updates) as actual(
            target_build text, observed_offered_users bigint, observed_attempts bigint, observed_success_per_attempt_percent numeric)
            where target_build = '61' and observed_offered_users = 1 and observed_attempts = 0
                and observed_success_per_attempt_percent is null)
        or not exists (select 1 from jsonb_to_recordset(p_updates) as actual(
            target_build text, observed_offered_users bigint, observed_attempts bigint, observed_pending bigint,
            observed_success_among_success_or_failure_percent numeric)
            where target_build = '62' and observed_offered_users = 0 and observed_attempts = 1 and observed_pending = 1
                and observed_success_among_success_or_failure_percent is null)
    then raise exception 'Actual update report lost independent offers/attempts or outcome denominators'; end if;
    raise notice 'PASS: actual update report independent offers/operations, target-only joins and correct censored denominators';
end;
$function$;

-- PRIVILEGED REPORTS: run each SELECT separately as postgres in SQL Editor.
-- Never expose these reports via a public view/client API. Email is joined
-- only in the administrator query, never copied into product metrics tables.
-- Only opted-in observations are present. Offline use, consent/account changes,
-- dropped events and the 1000-receipt/user/day cap can censor either side of a
-- request. These reports are not exact product reliability, billing or churn.
-- Attempts are reconstructed from this feature's operation state; do not divide
-- existing accepted-action counts or rate-limited diagnostics by these attempts.
-- UTC day windows include today (partial); future UTC dates appear when due.

-- 1. First observed onboarding dates. Stages need not arrive in order and
-- service_connected is NOT proof of a connected Codex session. Missing = unknown.
select
    users.id as user_id,
    users.email,
    min(stages.first_observed_date) filter (where stages.milestone = 'account_ready')
        as account_ready_date,
    min(stages.first_observed_date) filter (where stages.milestone = 'service_connected')
        as service_connected_date,
    min(stages.first_observed_date) filter (where stages.milestone = 'card_received')
        as card_received_date,
    min(stages.first_observed_date) filter (where stages.milestone = 'first_action')
        as first_action_date
from auth.users as users
join blabee_analytics.product_milestones as stages on stages.user_id = users.id
where stages.first_observed_date <= (pg_catalog.now() at time zone 'UTC')::date
group by users.id, users.email
order by account_ready_date desc nulls last, users.id;

-- 2. Feature outcomes over the latest 30 UTC start dates, by environment/input.
-- The first percentage keeps ALL observed attempts as its denominator. The
-- second includes succeeded+failed only; cancellations and pending stay visible.
with outcomes as (
    select
        feature, input_method, app_version, app_build, os_major, ui_language,
        sum(operation_count) as observed_attempts,
        coalesce(sum(operation_count) filter (where outcome = 'succeeded'), 0) as observed_succeeded,
        coalesce(sum(operation_count) filter (where outcome = 'failed'), 0) as observed_failed,
        coalesce(sum(operation_count) filter (where outcome = 'cancelled'), 0) as observed_cancelled,
        coalesce(sum(operation_count) filter (where outcome = 'pending'), 0) as observed_pending,
        count(distinct user_id) as observed_users
    from blabee_analytics.product_operation_days
    where feature <> 'app_update' and operation_count > 0
        and operation_date between (pg_catalog.now() at time zone 'UTC')::date - 29
            and (pg_catalog.now() at time zone 'UTC')::date
    group by feature, input_method, app_version, app_build, os_major, ui_language
)
select *,
    round(100.0 * observed_succeeded / nullif(observed_attempts, 0), 1)
        as observed_success_per_attempt_percent,
    round(100.0 * observed_succeeded / nullif(observed_succeeded + observed_failed, 0), 1)
        as observed_success_among_success_or_failure_percent
from outcomes
order by observed_attempts desc, feature, input_method, app_version, app_build, os_major, ui_language;

-- 3. Request/acknowledgment latency buckets over the same 30 UTC start dates.
-- Cancelled and unknown measurements remain separate. No task duration or
-- working-time measurement is present; a bucket is not an exact percentile.
select
    feature, input_method, app_version, app_build, os_major, ui_language,
    outcome, latency_bucket, sum(operation_count) as observed_operations
from blabee_analytics.product_operation_days
where feature <> 'app_update' and outcome <> 'pending' and operation_count > 0
    and operation_date between (pg_catalog.now() at time zone 'UTC')::date - 29
        and (pg_catalog.now() at time zone 'UTC')::date
group by feature, input_method, app_version, app_build, os_major, ui_language, outcome, latency_bucket
order by feature, input_method, app_version, app_build, os_major, ui_language, outcome, latency_bucket;

-- 4. Environment adoption over 30 UTC observation dates. The same user can be
-- present in multiple environments; do not sum these users as a unique total.
-- ui_language describes displayed UI, never residence/nationality/location.
select
    app_version, app_build, os_major, ui_language,
    count(distinct user_id) as observed_users,
    count(*) as observed_user_environment_days,
    max(observed_date) as last_observed_date
from blabee_analytics.product_environment_days
where observed_date between (pg_catalog.now() at time zone 'UTC')::date - 29
    and (pg_catalog.now() at time zone 'UTC')::date
group by app_version, app_build, os_major, ui_language
order by observed_users desc, app_version, app_build, os_major, ui_language;

-- 5. Update proposals and operations by target, over 30 UTC dates. A verified
-- target-app launch is success; starting the installer is not. Offers and
-- operations are independent observations, so no offer-to-install conversion
-- rate is inferred. Cancellation/pending differ from failure.
with offers as (
    select target_version, target_build,
        count(distinct user_id) as observed_offered_users,
        count(*) as observed_offer_user_days
    from blabee_analytics.product_update_offer_days
    where observed_date between (pg_catalog.now() at time zone 'UTC')::date - 29
        and (pg_catalog.now() at time zone 'UTC')::date
    group by target_version, target_build
), operations as (
    select target_version, target_build,
        sum(operation_count) as observed_attempts,
        coalesce(sum(operation_count) filter (where outcome = 'succeeded'), 0) as observed_succeeded,
        coalesce(sum(operation_count) filter (where outcome = 'failed'), 0) as observed_failed,
        coalesce(sum(operation_count) filter (where outcome = 'cancelled'), 0) as observed_cancelled,
        coalesce(sum(operation_count) filter (where outcome = 'pending'), 0) as observed_pending
    from blabee_analytics.product_operation_days
    where feature = 'app_update' and operation_count > 0
        and operation_date between (pg_catalog.now() at time zone 'UTC')::date - 29
            and (pg_catalog.now() at time zone 'UTC')::date
    group by target_version, target_build
)
select
    coalesce(offers.target_version, operations.target_version) as target_version,
    coalesce(offers.target_build, operations.target_build) as target_build,
    coalesce(offers.observed_offered_users, 0) as observed_offered_users,
    coalesce(offers.observed_offer_user_days, 0) as observed_offer_user_days,
    coalesce(operations.observed_attempts, 0) as observed_attempts,
    coalesce(operations.observed_succeeded, 0) as observed_succeeded,
    coalesce(operations.observed_failed, 0) as observed_failed,
    coalesce(operations.observed_cancelled, 0) as observed_cancelled,
    coalesce(operations.observed_pending, 0) as observed_pending,
    round(100.0 * operations.observed_succeeded / nullif(operations.observed_attempts, 0), 1)
        as observed_success_per_attempt_percent,
    round(100.0 * operations.observed_succeeded
        / nullif(operations.observed_succeeded + operations.observed_failed, 0), 1)
        as observed_success_among_success_or_failure_percent
from offers
full join operations using (target_version, target_build)
order by target_version, target_build;

-- Maintenance is scheduled separately by migration 202609170005.
-- select blabee_analytics.prune_product_event_receipts();

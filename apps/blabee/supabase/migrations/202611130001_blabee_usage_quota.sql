-- Apply as postgres after 202609270001_blabee_access_control.sql on Supabase.
-- Requires 202609170001 (usage), 202609170004 (product metrics), 202609170006
-- (insight observations) and pg_cron (enabled by 202609170003).
-- blabee_analytics stays out of the exposed API schemas. Audit 2026-11-11:
--   DB-1  record_blabee_usage is the only ingest RPC without a daily quota.
--   DB-3  usage receipts are pruned only by hand.
--   DB-4  the consent text promises deletion, but no deletion path exists.
-- The RPC name, arguments and boolean result are unchanged, so released apps
-- keep working: false already means "not newly recorded" to the client.
begin;

-- One user/receipt-day counter, mirroring product_ingest_days.
create table blabee_analytics.usage_ingest_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    received_date date not null,
    accepted_count integer not null,
    primary key (user_id, received_date),
    check (pg_catalog.isfinite(received_date)),
    check (accepted_count between 0 and 1000)
);
create index usage_ingest_days_received_date_idx
    on blabee_analytics.usage_ingest_days (received_date);
revoke all on table blabee_analytics.usage_ingest_days
    from public, anon, authenticated, service_role;
alter table blabee_analytics.usage_ingest_days enable row level security;

create or replace function public.record_blabee_usage(
    p_event_id uuid,
    p_event_kind text,
    p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_received_at timestamptz := pg_catalog.now();
    v_received_date date := (pg_catalog.now() at time zone 'UTC')::date;
    v_accepted_count integer;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication required';
    end if;

    if p_event_id is null then
        raise exception using errcode = '22023', message = 'Invalid usage event identifier';
    end if;
    if p_event_kind is null or p_event_kind not in (
        'choice_accepted', 'approval_resolved', 'suggestion_dismissed'
    ) then
        raise exception using errcode = '22023', message = 'Invalid usage event kind';
    end if;
    -- Hours make the seven-day bound independent of the caller's timezone/DST.
    if p_occurred_at is null
        or not pg_catalog.isfinite(p_occurred_at)
        or p_occurred_at < v_received_at - interval '168 hours'
        or p_occurred_at > v_received_at + interval '5 minutes'
    then
        raise exception using errcode = '22023', message = 'Usage event time outside accepted range';
    end if;

    -- One user/receipt-day lock bounds new receipts atomically without locking
    -- auth.users or other users. Duplicate IDs never consume quota.
    insert into blabee_analytics.usage_ingest_days (user_id, received_date, accepted_count)
    values (v_user_id, v_received_date, 0)
    on conflict (user_id, received_date) do nothing;
    select accepted_count into v_accepted_count
    from blabee_analytics.usage_ingest_days
    where user_id = v_user_id and received_date = v_received_date
    for update;
    if v_accepted_count >= 1000 then
        return false;
    end if;

    -- Concurrent retries serialize on the unique key. A duplicate cannot reach
    -- the aggregate update, even if its kind or timestamp was changed.
    insert into blabee_analytics.event_receipts (user_id, event_id, received_at)
    values (v_user_id, p_event_id, v_received_at)
    on conflict (user_id, event_id) do nothing;

    if not found then
        return false;
    end if;

    update blabee_analytics.usage_ingest_days
    set accepted_count = accepted_count + 1
    where user_id = v_user_id and received_date = v_received_date;

    -- The receipt, counter and aggregate are one transaction.
    insert into blabee_analytics.daily_activity as activity (
        user_id, activity_date, event_kind, action_count, first_used_at, last_used_at
    ) values (
        v_user_id, (p_occurred_at at time zone 'UTC')::date, p_event_kind,
        1, p_occurred_at, p_occurred_at
    )
    on conflict (user_id, activity_date, event_kind) do update
    set action_count = activity.action_count + 1,
        first_used_at = least(activity.first_used_at, excluded.first_used_at),
        last_used_at = greatest(activity.last_used_at, excluded.last_used_at);

    return true;
end;
$function$;

-- create or replace keeps the existing grants; restate them for clarity.
revoke all on function public.record_blabee_usage(uuid, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.record_blabee_usage(uuid, text, timestamptz)
    to authenticated;

-- Receipts survive strictly more than eight days, exceeding the seven-day
-- accepted retry window. Quota counters older than nine days are removed.
create or replace function blabee_analytics.prune_usage_event_receipts()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_deleted bigint;
begin
    delete from blabee_analytics.event_receipts
    where received_at < pg_catalog.now() - interval '192 hours';
    get diagnostics v_deleted = row_count;
    delete from blabee_analytics.usage_ingest_days
    where received_date < (pg_catalog.now() at time zone 'UTC')::date - 9;
    return v_deleted;
end;
$function$;

revoke all on function blabee_analytics.prune_usage_event_receipts()
    from public, anon, authenticated, service_role;

-- Deletes the caller's long-lived usage-statistics aggregates and day-level
-- observations (everything collected under the usage-statistics consent).
-- Short-lived receipts and quota counters stay until housekeeping (at most
-- about nine days) so a deleted account cannot reset its quota or have
-- already-received events counted twice. Feedback and error diagnostics have
-- their own consent and deletion paths and are not touched.
create function public.delete_my_blabee_usage()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_total bigint := 0;
    v_count bigint;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication required';
    end if;
    delete from blabee_analytics.daily_activity where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    delete from blabee_analytics.product_environment_days where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    delete from blabee_analytics.product_milestones where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    delete from blabee_analytics.product_update_offer_days where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    delete from blabee_analytics.product_operation_days where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    delete from blabee_analytics.connection_observation_days where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    delete from blabee_analytics.card_observation_days where user_id = v_user_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    return v_total;
end;
$function$;

revoke all on function public.delete_my_blabee_usage() from public, anon, authenticated;
grant execute on function public.delete_my_blabee_usage() to authenticated;

comment on table blabee_analytics.usage_ingest_days is
    'Per-user UTC receipt-day counter bounding record_blabee_usage to 1000 new events.';
comment on function public.delete_my_blabee_usage() is
    'Deletes the caller''s usage aggregates and day observations. Returns the deleted row count.';

-- UTC on the configured project; after the other three Blabee jobs.
select cron.schedule(
    'blabee-usage-retention-daily',
    '7 3 * * *',
    'select blabee_analytics.prune_usage_event_receipts();'
);

commit;

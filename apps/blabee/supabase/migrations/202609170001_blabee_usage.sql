-- Apply as the trusted database migration owner (normally postgres).
-- These are observed, client-reported actions, never billing or entitlement data.
-- Keep blabee_analytics outside the Supabase exposed-schema list.
begin;

create schema blabee_analytics;
revoke all on schema blabee_analytics from public, anon, authenticated;

-- Only retry identifiers are retained here; no action content or email is stored.
create table blabee_analytics.event_receipts (
    user_id uuid not null references auth.users (id) on delete cascade,
    event_id uuid not null,
    received_at timestamptz not null default pg_catalog.now(),
    primary key (user_id, event_id),
    constraint event_receipts_finite_time check (pg_catalog.isfinite(received_at))
);

create index event_receipts_received_at_idx
    on blabee_analytics.event_receipts (received_at);

-- Aggregates remain until account deletion. UTC activity dates count actual
-- recorded actions, not app launches, background uptime, or session duration.
create table blabee_analytics.daily_activity (
    user_id uuid not null references auth.users (id) on delete cascade,
    activity_date date not null,
    event_kind text not null,
    action_count bigint not null,
    first_used_at timestamptz not null,
    last_used_at timestamptz not null,
    primary key (user_id, activity_date, event_kind),
    constraint daily_activity_known_kind check (
        event_kind in ('choice_accepted', 'approval_resolved', 'suggestion_dismissed')
    ),
    constraint daily_activity_positive_count check (action_count > 0),
    constraint daily_activity_valid_times check (
        pg_catalog.isfinite(first_used_at)
        and pg_catalog.isfinite(last_used_at)
        and first_used_at <= last_used_at
        and (first_used_at at time zone 'UTC')::date = activity_date
        and (last_used_at at time zone 'UTC')::date = activity_date
    )
);

-- The primary keys already index both account-deletion foreign keys.
create index daily_activity_date_user_idx
    on blabee_analytics.daily_activity (activity_date, user_id);

revoke all on all tables in schema blabee_analytics from public, anon, authenticated;
alter table blabee_analytics.event_receipts enable row level security;
alter table blabee_analytics.daily_activity enable row level security;
-- Deliberately no client policies. Only the trusted owner/RPC can write and
-- privileged SQL can report. The function owner must also own these tables.

create function public.record_blabee_usage(
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

    -- Concurrent retries serialize on the unique key. A duplicate cannot reach
    -- the aggregate update, even if its kind or timestamp was changed.
    insert into blabee_analytics.event_receipts (user_id, event_id, received_at)
    values (v_user_id, p_event_id, v_received_at)
    on conflict (user_id, event_id) do nothing;

    if not found then
        return false;
    end if;

    -- The receipt and aggregate are one transaction: either both persist or
    -- neither does. UPSERT avoids lost increments from simultaneous new events.
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

revoke all on function public.record_blabee_usage(uuid, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.record_blabee_usage(uuid, text, timestamptz)
    to authenticated;

-- Run manually or schedule as the privileged owner. Receipts survive strictly
-- more than eight days, exceeding the seven-day accepted retry window.
-- Reusing an event ID with a new timestamp after pruning is a new observation;
-- clients must keep the original ID AND timestamp for every retry.
create function blabee_analytics.prune_usage_event_receipts()
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
    return v_deleted;
end;
$function$;

revoke all on function blabee_analytics.prune_usage_event_receipts()
    from public, anon, authenticated, service_role;

comment on schema blabee_analytics is
    'Private Blabee observed usage aggregates. Not an exposed API schema.';
comment on table blabee_analytics.daily_activity is
    'UTC action counts and first/last observed use; retained until auth user deletion. Not billing data.';
comment on function public.record_blabee_usage(uuid, text, timestamptz) is
    'Records one authenticated action. True means newly recorded; false means duplicate. No user ID parameter.';

commit;

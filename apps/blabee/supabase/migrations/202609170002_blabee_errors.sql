-- Apply after 202609170001_blabee_usage.sql as the trusted migration owner.
-- Optional, structured diagnostics only. Never send log messages or contents.
-- Keep blabee_analytics outside the Supabase exposed-schema list.
begin;

create table blabee_analytics.error_events (
    user_id uuid not null references auth.users (id) on delete cascade,
    event_id uuid not null,
    occurred_at timestamptz not null,
    received_at timestamptz not null default pg_catalog.now(),
    error_code text not null,
    app_version text not null,
    app_build text not null,
    os_version text not null,
    primary key (user_id, event_id),
    constraint error_events_finite_times check (
        pg_catalog.isfinite(occurred_at) and pg_catalog.isfinite(received_at)
    ),
    constraint error_events_known_code check (error_code in (
        'account_service_unavailable', 'account_invalid_response',
        'account_rate_limited', 'account_storage_unavailable',
        'account_refresh_failed', 'coordinator_connection_failed',
        'coordinator_response_invalid', 'choice_submit_failed',
        'approval_submit_failed', 'suggestion_dismiss_failed',
        'app_service_failed', 'app_service_timeout', 'app_service_exited'
    )),
    constraint error_events_safe_versions check (
        pg_catalog.length(app_version) <= 27
        and app_version ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
        and pg_catalog.length(app_build) <= 27
        and app_build ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
        and pg_catalog.length(os_version) <= 27
        and os_version ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
    )
);

create index error_events_received_at_idx
    on blabee_analytics.error_events (received_at);
create index error_events_user_occurred_at_idx
    on blabee_analytics.error_events (user_id, occurred_at desc, received_at desc, event_id desc);

-- A row lock for one user/day makes the quota atomic without globally locking
-- ingestion or locking auth.users. Only accepted distinct events consume quota.
create table blabee_analytics.error_ingest_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    received_date date not null,
    accepted_count integer not null,
    primary key (user_id, received_date),
    constraint error_ingest_days_finite_date check (pg_catalog.isfinite(received_date)),
    constraint error_ingest_days_bounded_count check (accepted_count between 0 and 200)
);
create index error_ingest_days_received_date_idx
    on blabee_analytics.error_ingest_days (received_date);

revoke all on blabee_analytics.error_events, blabee_analytics.error_ingest_days
    from public, anon, authenticated, service_role;
alter table blabee_analytics.error_events enable row level security;
alter table blabee_analytics.error_ingest_days enable row level security;
-- Deliberately no client policies. The RPC owner must also own these tables.

create function public.record_blabee_error(
    p_event_id uuid,
    p_error_code text,
    p_occurred_at timestamptz,
    p_app_version text,
    p_app_build text,
    p_os_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_received_at timestamptz := pg_catalog.now();
    v_received_date date := (v_received_at at time zone 'UTC')::date;
    v_accepted_count integer;
    v_version text;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication required';
    end if;
    if p_event_id is null then
        raise exception using errcode = '22023', message = 'Invalid error event identifier';
    end if;
    if p_error_code is null or p_error_code not in (
        'account_service_unavailable', 'account_invalid_response',
        'account_rate_limited', 'account_storage_unavailable',
        'account_refresh_failed', 'coordinator_connection_failed',
        'coordinator_response_invalid', 'choice_submit_failed',
        'approval_submit_failed', 'suggestion_dismiss_failed',
        'app_service_failed', 'app_service_timeout', 'app_service_exited'
    ) then
        raise exception using errcode = '22023', message = 'Invalid error code';
    end if;
    foreach v_version in array array[p_app_version, p_app_build, p_os_version] loop
        if v_version is null or pg_catalog.length(v_version) > 27
            or v_version !~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
        then
            raise exception using errcode = '22023', message = 'Invalid diagnostic version';
        end if;
    end loop;
    if p_occurred_at is null or not pg_catalog.isfinite(p_occurred_at)
        or p_occurred_at < v_received_at - interval '168 hours'
        or p_occurred_at > v_received_at + interval '5 minutes'
    then
        raise exception using errcode = '22023', message = 'Error event time outside accepted range';
    end if;

    insert into blabee_analytics.error_ingest_days (user_id, received_date, accepted_count)
    values (v_user_id, v_received_date, 0)
    on conflict (user_id, received_date) do nothing;

    select accepted_count into v_accepted_count
    from blabee_analytics.error_ingest_days
    where user_id = v_user_id and received_date = v_received_date
    for update;

    if v_accepted_count >= 200 then
        -- False acknowledges suppression so clients do not retry an error storm.
        return false;
    end if;

    insert into blabee_analytics.error_events (
        user_id, event_id, occurred_at, received_at, error_code,
        app_version, app_build, os_version
    ) values (
        v_user_id, p_event_id, p_occurred_at, v_received_at, p_error_code,
        p_app_version, p_app_build, p_os_version
    )
    on conflict (user_id, event_id) do nothing;

    if not found then
        return false;
    end if;

    -- The row lock remains held until commit. The event and quota increment
    -- either both persist or both roll back; duplicates never consume quota.
    update blabee_analytics.error_ingest_days
    set accepted_count = accepted_count + 1
    where user_id = v_user_id and received_date = v_received_date;
    return true;
end;
$function$;

revoke all on function public.record_blabee_error(uuid, text, timestamptz, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.record_blabee_error(uuid, text, timestamptz, text, text, text)
    to authenticated;

-- Run/schedule as the trusted owner. Retention uses server receipt time, not
-- the client clock. Daily quota rows keep the cutoff date until its full end.
create function blabee_analytics.prune_error_events()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_cutoff timestamptz := pg_catalog.now() - interval '720 hours';
    v_deleted bigint;
begin
    delete from blabee_analytics.error_events where received_at < v_cutoff;
    get diagnostics v_deleted = row_count;
    delete from blabee_analytics.error_ingest_days
    where received_date < (v_cutoff at time zone 'UTC')::date;
    return v_deleted;
end;
$function$;

revoke all on function blabee_analytics.prune_error_events()
    from public, anon, authenticated, service_role;

comment on table blabee_analytics.error_events is
    'Opt-in allowlisted diagnostics; prune after 30 receipt days. No raw logs, email, paths, or tokens. Account deletion cascades.';
comment on table blabee_analytics.error_ingest_days is
    'Private per-user UTC receipt-day cap of 200 accepted distinct errors. Suppressed events are not counted.';
comment on function public.record_blabee_error(uuid, text, timestamptz, text, text, text) is
    'Authenticated structured diagnostic only. True means new record; false acknowledges duplicate or daily suppression. No user ID parameter.';

commit;

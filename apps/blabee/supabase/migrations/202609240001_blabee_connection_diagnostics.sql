-- Append-only upgrade after 202609170002. Existing clients/RPC remain valid.
-- This adds structured context to the existing 30-day error retention stream.
begin;

alter table blabee_analytics.error_events
    add column connection_provider text,
    add column connection_stage text,
    add column connection_reason text,
    add column tool_version text;

alter table blabee_analytics.error_events drop constraint error_events_known_code;
alter table blabee_analytics.error_events add constraint error_events_known_code check (error_code in (
    'account_service_unavailable', 'account_invalid_response', 'account_rate_limited',
    'account_storage_unavailable', 'account_refresh_failed', 'coordinator_connection_failed',
    'coordinator_response_invalid', 'choice_submit_failed', 'approval_submit_failed',
    'suggestion_dismiss_failed', 'app_service_failed', 'app_service_timeout', 'app_service_exited',
    'connection_failed'
));

alter table blabee_analytics.error_events add constraint error_events_connection_context check (
    (error_code <> 'connection_failed' and connection_provider is null
        and connection_stage is null and connection_reason is null and tool_version is null)
    or (error_code = 'connection_failed'
        and connection_provider is not null and connection_provider in ('codex', 'claude')
        and connection_stage is not null and connection_stage in (
            'inspection', 'configuration', 'service_start', 'native_executable', 'plugin_check',
            'hook_check', 'terminal_launch', 'session_handshake', 'transport')
        and connection_reason is not null and connection_reason in (
            'executable_missing', 'executable_unsafe', 'executable_untrusted', 'unsupported_version',
            'runtime_missing', 'plugin_missing', 'plugin_conflict', 'plugin_check_failed',
            'hook_untrusted', 'unsupported_shell', 'settings_conflict', 'settings_write_failed',
            'service_unavailable', 'service_timeout', 'terminal_unavailable', 'launch_failed',
            'handshake_timeout', 'connection_lost', 'invalid_response', 'operation_failed')
        and tool_version is not null and pg_catalog.length(tool_version) <= 27
        and tool_version ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$')
);
create index error_events_connection_received_idx
    on blabee_analytics.error_events (connection_provider, received_at desc)
    where connection_provider is not null;

create function public.record_blabee_connection_error(
    p_event_id uuid, p_occurred_at timestamptz,
    p_app_version text, p_app_build text, p_os_version text,
    p_provider text, p_stage text, p_reason text, p_tool_version text
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
    if p_provider is null or p_provider not in ('codex', 'claude')
        or p_stage is null or p_stage not in (
            'inspection', 'configuration', 'service_start', 'native_executable', 'plugin_check',
            'hook_check', 'terminal_launch', 'session_handshake', 'transport')
        or p_reason is null or p_reason not in (
            'executable_missing', 'executable_unsafe', 'executable_untrusted', 'unsupported_version',
            'runtime_missing', 'plugin_missing', 'plugin_conflict', 'plugin_check_failed',
            'hook_untrusted', 'unsupported_shell', 'settings_conflict', 'settings_write_failed',
            'service_unavailable', 'service_timeout', 'terminal_unavailable', 'launch_failed',
            'handshake_timeout', 'connection_lost', 'invalid_response', 'operation_failed')
    then
        raise exception using errcode = '22023', message = 'Invalid connection diagnostic';
    end if;
    foreach v_version in array array[p_app_version, p_app_build, p_os_version, p_tool_version] loop
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

    -- Share the legacy RPC's row lock, quota and user/event deduplication key.
    -- Both endpoints together permit 200 distinct accepted events per UTC day.
    insert into blabee_analytics.error_ingest_days (user_id, received_date, accepted_count)
    values (v_user_id, v_received_date, 0) on conflict (user_id, received_date) do nothing;
    select accepted_count into v_accepted_count from blabee_analytics.error_ingest_days
    where user_id = v_user_id and received_date = v_received_date for update;
    if v_accepted_count >= 200 then return false; end if;

    insert into blabee_analytics.error_events (
        user_id, event_id, occurred_at, received_at, error_code, app_version, app_build, os_version,
        connection_provider, connection_stage, connection_reason, tool_version
    ) values (
        v_user_id, p_event_id, p_occurred_at, v_received_at, 'connection_failed',
        p_app_version, p_app_build, p_os_version, p_provider, p_stage, p_reason, p_tool_version
    ) on conflict (user_id, event_id) do nothing;
    if not found then return false; end if;
    update blabee_analytics.error_ingest_days set accepted_count = accepted_count + 1
    where user_id = v_user_id and received_date = v_received_date;
    return true;
end;
$function$;

revoke all on function public.record_blabee_connection_error(uuid,timestamptz,text,text,text,text,text,text,text)
    from public, anon, authenticated, service_role;
grant execute on function public.record_blabee_connection_error(uuid,timestamptz,text,text,text,text,text,text,text)
    to authenticated;
comment on function public.record_blabee_connection_error(uuid,timestamptz,text,text,text,text,text,text,text) is
    'Opt-in allowlisted connection diagnostics. Auth-owned; shares error quota/deduplication/retention. No paths, logs, session IDs or credentials.';
commit;

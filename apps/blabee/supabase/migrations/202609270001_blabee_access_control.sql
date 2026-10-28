-- Apply once as the trusted migration owner, after reconciling migration history.
-- Product access is independent of analytics, billing and the local journal.
-- Keep blabee_access OUTSIDE the Supabase exposed-schema list.
begin;

create schema blabee_access;
revoke all on schema blabee_access from public, anon, authenticated, service_role;

create table blabee_access.user_access (
    user_id uuid primary key references auth.users (id) on delete cascade,
    status text not null default 'active' check (status in ('active', 'suspended')),
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    updated_by uuid,
    reason text,
    constraint user_access_reason check (reason is null or (
        reason = pg_catalog.btrim(reason, E' \t\n\r')
        and pg_catalog.length(reason) between 1 and 500
    ))
);

create table blabee_access.service_control (
    singleton boolean primary key default true check (singleton),
    paused boolean not null default false,
    updated_at timestamptz not null default pg_catalog.now(),
    updated_by uuid,
    reason text,
    constraint service_control_reason check (reason is null or (
        reason = pg_catalog.btrim(reason, E' \t\n\r')
        and pg_catalog.length(reason) between 1 and 500
    ))
);
insert into blabee_access.service_control (singleton) values (true);

-- Membership is server-owned. No JWT metadata field grants administrator rights.
-- Retaining a disabled row lets grant/revoke serialize on the same primary key.
create table blabee_access.admin_users (
    user_id uuid primary key references auth.users (id) on delete cascade,
    enabled boolean not null,
    updated_at timestamptz not null default pg_catalog.now(),
    reason text not null check (
        reason = pg_catalog.btrim(reason, E' \t\n\r')
        and pg_catalog.length(reason) between 1 and 500
    )
);

-- UUID snapshots deliberately have no auth.users FK: deleting an account must
-- not erase the record of an administrator's decision. No credentials are stored.
create table blabee_access.audit_events (
    id bigint generated always as identity primary key,
    actor_user_id uuid,
    actor_session_id uuid,
    actor_database_role text not null,
    target_user_id uuid,
    action text not null check (action in (
        'set_user_access', 'set_service_access', 'set_admin_membership'
    )),
    before_state text not null,
    after_state text not null,
    reason text not null check (
        reason = pg_catalog.btrim(reason, E' \t\n\r')
        and pg_catalog.length(reason) between 1 and 500
    ),
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    constraint audit_actor_pair check (
        (actor_user_id is null) = (actor_session_id is null)
    ),
    constraint audit_state_shape check (
        (action = 'set_user_access' and target_user_id is not null
            and before_state in ('active', 'suspended')
            and after_state in ('active', 'suspended'))
        or (action = 'set_service_access' and target_user_id is null
            and before_state in ('running', 'paused')
            and after_state in ('running', 'paused'))
        or (action = 'set_admin_membership' and target_user_id is not null
            and actor_user_id is null
            and before_state in ('enabled', 'disabled')
            and after_state in ('enabled', 'disabled'))
    )
);
create index audit_events_created_idx on blabee_access.audit_events (created_at desc, id desc);
create index audit_events_target_idx
    on blabee_access.audit_events (target_user_id, created_at desc, id desc)
    where target_user_id is not null;

alter table blabee_access.user_access enable row level security;
alter table blabee_access.service_control enable row level security;
alter table blabee_access.admin_users enable row level security;
alter table blabee_access.audit_events enable row level security;
-- No client policies. Only the owner and the explicitly granted public RPCs act.
revoke all on all tables in schema blabee_access from public, anon, authenticated, service_role;
revoke all on all sequences in schema blabee_access from public, anon, authenticated, service_role;

-- PostgREST verifies the JWT signature before these claims reach PostgreSQL.
-- This additional live lookup detects logout, account deletion and Auth bans
-- even while a previously issued JWT has not yet expired.
create function blabee_access.require_session()
returns table (
    user_id uuid, session_id uuid, server_now timestamptz,
    token_expires_at timestamptz, session_expires_at timestamptz,
    has_social_login boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_claims jsonb;
    v_user_id uuid;
    v_session_id uuid;
    v_claim_user_id uuid;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_token_expires_at timestamptz;
    v_session_expires_at timestamptz;
    v_social boolean := false;
begin
    begin
        v_claims := auth.jwt();
        v_user_id := auth.uid();
        v_claim_user_id := (v_claims ->> 'sub')::uuid;
        v_session_id := (v_claims ->> 'session_id')::uuid;
        v_token_expires_at := pg_catalog.to_timestamp((v_claims ->> 'exp')::double precision);
    exception when data_exception then
        raise exception using errcode = '28000', message = 'Valid account session required';
    end;
    if v_user_id is null or v_session_id is null
        or v_claim_user_id is distinct from v_user_id
        or pg_catalog.jsonb_typeof(v_claims) is distinct from 'object'
        or v_claims ->> 'role' is distinct from 'authenticated'
        or v_claims -> 'is_anonymous' is distinct from 'false'::jsonb
        or pg_catalog.jsonb_typeof(v_claims -> 'exp') is distinct from 'number'
        or v_token_expires_at is null or not pg_catalog.isfinite(v_token_expires_at)
        or v_token_expires_at <= v_now
    then
        raise exception using errcode = '28000', message = 'Valid account session required';
    end if;

    select s.not_after into v_session_expires_at
    from auth.sessions as s
    join auth.users as u on u.id = s.user_id
    where s.id = v_session_id and s.user_id = v_user_id
        and u.is_anonymous is false and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= v_now)
        and (s.not_after is null or s.not_after > v_now);
    if not found then
        raise exception using errcode = '28000', message = 'Valid account session required';
    end if;

    -- A linked social identity alone must not authorize a password/OTP session.
    -- Conversely, a stale OAuth JWT must not survive unlinking every allowed identity.
    if pg_catalog.jsonb_typeof(v_claims -> 'amr') = 'array' then
        v_social := exists (
            select 1 from pg_catalog.jsonb_array_elements(v_claims -> 'amr') as method(value)
            where method.value ->> 'method' = 'oauth'
        ) and exists (
            select 1 from auth.identities as identity
            where identity.user_id = v_user_id and identity.provider in ('google', 'github')
        );
    end if;
    return query select v_user_id, v_session_id, v_now,
        v_token_expires_at, v_session_expires_at, v_social;
end;
$function$;

create function public.get_blabee_access(p_nonce uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
    v_session record;
    v_status text;
    v_paused boolean;
    v_expires_at timestamptz;
begin
    select * into strict v_session from blabee_access.require_session();
    if p_nonce is null then
        raise exception using errcode = '22023', message = 'Request nonce required';
    end if;

    if not v_session.has_social_login then
        v_status := 'social_login_required';
    else
        -- First social login is allowed automatically. Never overwrite an
        -- administrator's suspension, including a concurrent first-use insert.
        insert into blabee_access.user_access (user_id)
        values (v_session.user_id) on conflict (user_id) do nothing;
        select access.status into strict v_status
        from blabee_access.user_access as access where access.user_id = v_session.user_id;
        select control.paused into v_paused
        from blabee_access.service_control as control where control.singleton;
        if not found then
            raise exception using errcode = '55000', message = 'Access configuration unavailable';
        end if;
        if v_status = 'active' and v_paused then v_status := 'service_paused'; end if;
        if v_status = 'active' then
            v_expires_at := least(v_session.server_now + interval '300 seconds',
                v_session.token_expires_at, v_session.session_expires_at);
        end if;
    end if;

    return pg_catalog.jsonb_build_object(
        'schema_version', 1, 'request_nonce', p_nonce,
        'user_id', v_session.user_id, 'session_id', v_session.session_id,
        'status', v_status, 'server_now', v_session.server_now,
        'access_expires_at', v_expires_at, 'refresh_after_seconds', 60
    );
end;
$function$;

create function public.admin_set_blabee_user_access(p_user_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
    v_session record;
    v_before text;
    v_reason text := pg_catalog.btrim(p_reason, E' \t\n\r');
    v_now timestamptz;
    v_audit_id bigint;
begin
    select * into strict v_session from blabee_access.require_session();
    -- Do not require product access here: an administrator must be able to
    -- resume service while the whole service or their own product account is paused.
    perform 1 from blabee_access.admin_users as admin
    where admin.user_id = v_session.user_id and admin.enabled for share;
    if not found or not v_session.has_social_login then
        raise exception using errcode = '42501', message = 'Administrator access required';
    end if;
    if p_user_id is null or p_status is null or p_status not in ('active', 'suspended')
        or v_reason is null or pg_catalog.length(v_reason) not between 1 and 500
    then
        raise exception using errcode = '22023', message = 'Invalid access change';
    end if;
    if not exists (select 1 from auth.users as u where u.id = p_user_id) then
        raise exception using errcode = '22023', message = 'Account not found';
    end if;
    insert into blabee_access.user_access (user_id)
    values (p_user_id) on conflict (user_id) do nothing;
    select access.status into strict v_before from blabee_access.user_access as access
    where access.user_id = p_user_id for update;
    v_now := pg_catalog.clock_timestamp();
    update blabee_access.user_access set status = p_status,
        updated_at = v_now, updated_by = v_session.user_id, reason = v_reason
    where user_id = p_user_id;
    insert into blabee_access.audit_events (
        actor_user_id, actor_session_id, actor_database_role, target_user_id,
        action, before_state, after_state, reason, created_at
    ) values (
        v_session.user_id, v_session.session_id, session_user, p_user_id,
        'set_user_access', v_before, p_status, v_reason, v_now
    ) returning id into v_audit_id;
    return pg_catalog.jsonb_build_object('user_id', p_user_id, 'status', p_status,
        'changed', v_before <> p_status, 'updated_at', v_now, 'audit_id', v_audit_id);
end;
$function$;

create function public.admin_set_blabee_service_access(p_paused boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
    v_session record;
    v_before boolean;
    v_reason text := pg_catalog.btrim(p_reason, E' \t\n\r');
    v_now timestamptz;
    v_audit_id bigint;
begin
    select * into strict v_session from blabee_access.require_session();
    perform 1 from blabee_access.admin_users as admin
    where admin.user_id = v_session.user_id and admin.enabled for share;
    if not found or not v_session.has_social_login then
        raise exception using errcode = '42501', message = 'Administrator access required';
    end if;
    if p_paused is null or v_reason is null or pg_catalog.length(v_reason) not between 1 and 500 then
        raise exception using errcode = '22023', message = 'Invalid service access change';
    end if;
    select control.paused into v_before from blabee_access.service_control as control
    where control.singleton for update;
    if not found then
        raise exception using errcode = '55000', message = 'Access configuration unavailable';
    end if;
    v_now := pg_catalog.clock_timestamp();
    update blabee_access.service_control set paused = p_paused,
        updated_at = v_now, updated_by = v_session.user_id, reason = v_reason
    where singleton;
    insert into blabee_access.audit_events (
        actor_user_id, actor_session_id, actor_database_role, target_user_id,
        action, before_state, after_state, reason, created_at
    ) values (
        v_session.user_id, v_session.session_id, session_user, null,
        'set_service_access', case when v_before then 'paused' else 'running' end,
        case when p_paused then 'paused' else 'running' end, v_reason, v_now
    ) returning id into v_audit_id;
    return pg_catalog.jsonb_build_object('paused', p_paused,
        'changed', v_before <> p_paused, 'updated_at', v_now, 'audit_id', v_audit_id);
end;
$function$;

-- SQL Editor/bootstrap only. SECURITY INVOKER and no API role grants; the
-- trusted database owner is the recorded actor, never a fabricated user JWT.
create function blabee_access.set_admin_membership(p_user_id uuid, p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set timezone = 'UTC'
as $function$
declare
    v_before boolean;
    v_reason text := pg_catalog.btrim(p_reason, E' \t\n\r');
    v_now timestamptz;
    v_audit_id bigint;
begin
    if p_user_id is null or p_enabled is null
        or v_reason is null or pg_catalog.length(v_reason) not between 1 and 500
    then
        raise exception using errcode = '22023', message = 'Invalid administrator change';
    end if;
    if not exists (select 1 from auth.users as u where u.id = p_user_id) then
        raise exception using errcode = '22023', message = 'Account not found';
    end if;
    insert into blabee_access.admin_users (user_id, enabled, reason)
    values (p_user_id, false, v_reason) on conflict (user_id) do nothing;
    select admin.enabled into strict v_before from blabee_access.admin_users as admin
    where admin.user_id = p_user_id for update;
    v_now := pg_catalog.clock_timestamp();
    update blabee_access.admin_users set enabled = p_enabled, updated_at = v_now, reason = v_reason
    where user_id = p_user_id;
    insert into blabee_access.audit_events (
        actor_database_role, target_user_id, action, before_state, after_state, reason, created_at
    ) values (
        session_user, p_user_id, 'set_admin_membership',
        case when v_before then 'enabled' else 'disabled' end,
        case when p_enabled then 'enabled' else 'disabled' end, v_reason, v_now
    ) returning id into v_audit_id;
    return pg_catalog.jsonb_build_object('user_id', p_user_id, 'enabled', p_enabled,
        'changed', v_before <> p_enabled, 'updated_at', v_now, 'audit_id', v_audit_id);
end;
$function$;

revoke all on all functions in schema blabee_access from public, anon, authenticated, service_role;
revoke all on function public.get_blabee_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_blabee_user_access(uuid,text,text)
    from public, anon, authenticated, service_role;
revoke all on function public.admin_set_blabee_service_access(boolean,text)
    from public, anon, authenticated, service_role;
grant execute on function public.get_blabee_access(uuid) to authenticated;
grant execute on function public.admin_set_blabee_user_access(uuid,text,text) to authenticated;
grant execute on function public.admin_set_blabee_service_access(boolean,text) to authenticated;

comment on schema blabee_access is
    'Private product access authority and administrator audit. Never expose as a REST schema.';
comment on function public.get_blabee_access(uuid) is
    'Authenticated self-only social access check. Nonce-bound HTTPS response; maximum 300s in-memory lease. Denials have no lease.';
comment on table blabee_access.audit_events is
    'Administrator decision history, retained across account deletion. Null actor user/session denotes a trusted database-owner operation; no JWTs or secrets.';
commit;

-- Disposable database only, after 202609270001. All fixture writes roll back.
begin;

create function pg_temp.use_access_session(p_user_id uuid, p_session_id uuid, p_extra jsonb default '{}')
returns void language plpgsql as $test$
begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', (pg_catalog.jsonb_build_object(
        'sub', p_user_id, 'session_id', p_session_id, 'role', 'authenticated',
        'is_anonymous', false,
        'exp', pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()))::bigint + 3600,
        'amr', '[{"method":"oauth"}]'::jsonb
    ) || p_extra)::text, true);
end;
$test$;

create function pg_temp.expect_access_error(p_sql text, p_code text)
returns void language plpgsql as $test$
declare v_code text;
begin
    begin
        execute p_sql;
    exception when others then
        get stacked diagnostics v_code = returned_sqlstate;
        if v_code = p_code then return; end if;
        raise exception 'Expected SQLSTATE %, got % for %', p_code, v_code, p_sql;
    end;
    raise exception 'Expected SQLSTATE %, but statement succeeded: %', p_code, p_sql;
end;
$test$;

create function pg_temp.assert_access(p_status text)
returns jsonb language plpgsql as $test$
declare
    v_nonce uuid := gen_random_uuid();
    v_result jsonb := public.get_blabee_access(v_nonce);
    v_now timestamptz := (v_result ->> 'server_now')::timestamptz;
    v_expires timestamptz := (v_result ->> 'access_expires_at')::timestamptz;
begin
    if (select pg_catalog.array_agg(key order by key) from pg_catalog.jsonb_object_keys(v_result) as key)
        <> array['access_expires_at','refresh_after_seconds','request_nonce','schema_version',
            'server_now','session_id','status','user_id']
        or v_result -> 'schema_version' is distinct from '1'::jsonb
        or v_result -> 'refresh_after_seconds' is distinct from '60'::jsonb
        or v_result ->> 'request_nonce' is distinct from v_nonce::text
        or v_result ->> 'user_id' is distinct from auth.uid()::text
        or v_result ->> 'session_id' is distinct from auth.jwt() ->> 'session_id'
        or v_result ->> 'status' is distinct from p_status
        or v_now is null or not pg_catalog.isfinite(v_now)
        or v_now > pg_catalog.clock_timestamp()
    then raise exception 'Access wire contract mismatch: %', v_result; end if;
    if p_status = 'active' then
        if v_expires is null or v_expires <= v_now or v_expires > v_now + interval '300 seconds'
            or v_expires > pg_catalog.to_timestamp((auth.jwt() ->> 'exp')::double precision)
        then raise exception 'Active lease exceeded a bound: %', v_result; end if;
    elsif v_result -> 'access_expires_at' is distinct from 'null'::jsonb then
        raise exception 'Denied access returned a lease: %', v_result;
    end if;
    return v_result;
end;
$test$;

insert into auth.users (id, email) values
 ('a1000000-0000-4000-8000-000000000001', 'access-one@example.invalid'),
 ('a1000000-0000-4000-8000-000000000002', 'access-two@example.invalid'),
 ('a1000000-0000-4000-8000-000000000003', 'access-admin@example.invalid'),
 ('a1000000-0000-4000-8000-000000000004', 'access-new@example.invalid'),
 ('a1000000-0000-4000-8000-000000000005', 'access-deleted@example.invalid'),
 ('a1000000-0000-4000-8000-000000000006', 'access-anonymous@example.invalid');
insert into auth.sessions (id, user_id)
select ('b' || pg_catalog.substr(id::text, 2))::uuid, id from auth.users;
insert into auth.identities (user_id, provider)
select id, case when id = 'a1000000-0000-4000-8000-000000000002' then 'github' else 'google' end
from auth.users;
update auth.users set is_anonymous = true where id = 'a1000000-0000-4000-8000-000000000006';

do $test$
declare v_table regclass; v_function regprocedure; v_role text;
begin
    foreach v_table in array array[
        'blabee_access.user_access'::regclass, 'blabee_access.service_control'::regclass,
        'blabee_access.admin_users'::regclass, 'blabee_access.audit_events'::regclass
    ] loop
        if not (select relrowsecurity from pg_class where oid = v_table)
            or exists (select 1 from pg_policy where polrelid = v_table)
        then raise exception 'Private table RLS boundary invalid: %', v_table; end if;
        foreach v_role in array array['anon','authenticated','service_role'] loop
            if has_schema_privilege(v_role, 'blabee_access', 'USAGE')
                or has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            then raise exception 'Direct private access granted: % %', v_role, v_table; end if;
        end loop;
    end loop;
    foreach v_function in array array[
        'public.get_blabee_access(uuid)'::regprocedure,
        'public.admin_set_blabee_user_access(uuid,text,text)'::regprocedure,
        'public.admin_set_blabee_service_access(boolean,text)'::regprocedure
    ] loop
        if not exists (select 1 from pg_proc where oid = v_function and prosecdef
            and proconfig @> array['search_path=""'])
            or has_function_privilege('anon', v_function, 'execute')
            or has_function_privilege('service_role', v_function, 'execute')
            or not has_function_privilege('authenticated', v_function, 'execute')
        then raise exception 'Public RPC privilege boundary invalid: %', v_function; end if;
    end loop;
    foreach v_role in array array['anon','authenticated','service_role'] loop
        if has_function_privilege(v_role, 'blabee_access.require_session()', 'execute')
            or has_function_privilege(v_role, 'blabee_access.set_admin_membership(uuid,boolean,text)', 'execute')
        then raise exception 'Private helper executable by %', v_role; end if;
    end loop;
end;
$test$;
select 'private permissions' as access_test_passed;

set local role anon;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '42501');
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true,''forged'')', '42501');
reset role;
set local role service_role;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '42501');
select pg_temp.expect_access_error('select * from blabee_access.user_access', '42501');
reset role;
set local request.jwt.claims = '';
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
    '{"user_metadata":{"is_admin":true,"role":"admin"},"app_metadata":{"role":"admin"}}');
set local role authenticated;
select pg_temp.expect_access_error('select * from blabee_access.audit_events', '42501');
select pg_temp.expect_access_error('update blabee_access.service_control set paused = false', '42501');
select pg_temp.expect_access_error('insert into blabee_access.admin_users(user_id,enabled,reason) values (auth.uid(),true,''forged'')', '42501');
select pg_temp.expect_access_error('select blabee_access.set_admin_membership(auth.uid(),true,''forged'')', '42501');
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(auth.uid(),''active'',''forged'')', '42501');
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(false,''forged'')', '42501');
reset role;
select 'anonymous and untrusted clients' as access_test_passed;

set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(null)', '22023');
select pg_temp.assert_access('active');
select pg_temp.assert_access('active');
reset role;
do $test$
begin
    if (select count(*) from blabee_access.user_access) <> 1
        or (select status from blabee_access.user_access where user_id = 'a1000000-0000-4000-8000-000000000001') <> 'active'
        or exists (select 1 from blabee_access.audit_events)
    then raise exception 'First lookup did not provision only its own default account'; end if;
end;
$test$;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_access('active');
reset role;
select 'nonce and automatic provisioning' as access_test_passed;

select blabee_access.set_admin_membership('a1000000-0000-4000-8000-000000000003', true, '  Test bootstrap  ');
do $test$
begin
    if not exists (select 1 from blabee_access.audit_events where action = 'set_admin_membership'
        and actor_user_id is null and actor_session_id is null and actor_database_role = session_user
        and target_user_id = 'a1000000-0000-4000-8000-000000000003'
        and before_state = 'disabled' and after_state = 'enabled' and reason = 'Test bootstrap')
    then raise exception 'Bootstrap did not identify the trusted database operator'; end if;
end;
$test$;
select 'owner bootstrap audit' as access_test_passed;

select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_set_blabee_user_access('a1000000-0000-4000-8000-000000000001', 'suspended', '  Test account suspension  ');
reset role;
do $test$
begin
    if not exists (select 1 from blabee_access.audit_events where action = 'set_user_access'
        and actor_user_id = 'a1000000-0000-4000-8000-000000000003'
        and actor_session_id = 'b1000000-0000-4000-8000-000000000003'
        and target_user_id = 'a1000000-0000-4000-8000-000000000001'
        and before_state = 'active' and after_state = 'suspended' and reason = 'Test account suspension'
        and created_at <= clock_timestamp())
    then raise exception 'Administrator identity or decision audit missing'; end if;
end;
$test$;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_access('suspended');
select pg_temp.assert_access('suspended');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_access('active');
reset role;
select 'individual suspension and audit' as access_test_passed;

select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_set_blabee_service_access(true, 'Test maintenance');
select pg_temp.assert_access('service_paused');
select public.admin_set_blabee_user_access(auth.uid(), 'suspended', 'Test administrator product suspension');
select pg_temp.assert_access('suspended');
select public.admin_set_blabee_service_access(false, 'Test recovery while product suspended');
select public.admin_set_blabee_user_access(auth.uid(), 'active', 'Test administrator recovery');
select pg_temp.assert_access('active');
reset role;
do $test$
begin
    if (select status from blabee_access.user_access where user_id = 'a1000000-0000-4000-8000-000000000001') <> 'suspended'
    then raise exception 'Global resume cleared an individual suspension'; end if;
end;
$test$;
set local role authenticated;
select public.admin_set_blabee_user_access('a1000000-0000-4000-8000-000000000001', 'active', 'Test resume');
select public.admin_set_blabee_service_access(true, 'Test global account precedence');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_access('service_paused');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_set_blabee_service_access(false, 'Test maintenance complete');
reset role;
select 'global pause and administrator recovery' as access_test_passed;

set local role authenticated;
select public.admin_set_blabee_user_access('a1000000-0000-4000-8000-000000000004', 'suspended', 'Suspend before first use');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.assert_access('suspended');
reset role;
select 'suspension before first use' as access_test_passed;

select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000005',
    '{"amr":[{"method":"password"}]}');
set local role authenticated;
select pg_temp.assert_access('social_login_required');
reset role;
do $test$
begin
    if exists (select 1 from blabee_access.user_access where user_id = 'a1000000-0000-4000-8000-000000000005')
    then raise exception 'Non-social first use provisioned an active account'; end if;
end;
$test$;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002',
    '{"amr":[{"method":"password"}],"user_metadata":{"provider":"google"}}');
set local role authenticated;
select pg_temp.assert_access('social_login_required');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', '{"amr":null}');
set local role authenticated;
select pg_temp.assert_access('social_login_required');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', '{"amr":{"method":"oauth"}}');
set local role authenticated;
select pg_temp.assert_access('social_login_required');
reset role;
update auth.identities set provider = 'email' where user_id = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002',
    '{"app_metadata":{"provider":"github","providers":["github"]}}');
set local role authenticated;
select pg_temp.assert_access('social_login_required');
reset role;
update auth.identities set provider = 'github' where user_id = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002',
    '{"amr":[{"method":"token_refresh"},{"method":"oauth"}]}');
set local role authenticated;
select pg_temp.assert_access('active');
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
select 'social authentication required' as access_test_passed;

set local role authenticated;
do $test$
declare v_extra jsonb;
begin
    foreach v_extra in array array[
        '{"role":"anon"}'::jsonb, '{"is_anonymous":true}'::jsonb, '{"is_anonymous":null}'::jsonb,
        '{"exp":0}'::jsonb, '{"exp":null}'::jsonb, '{"exp":"Infinity"}'::jsonb,
        '{"exp":1e400}'::jsonb, '{"session_id":null}'::jsonb,
        '{"session_id":"not-a-uuid"}'::jsonb, '{"sub":"not-a-uuid"}'::jsonb
    ] loop
        perform pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002',
            'b1000000-0000-4000-8000-000000000002', v_extra);
        perform pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
    end loop;
end;
$test$;
reset role;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002');
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
select 'invalid claims' as access_test_passed;

select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
delete from auth.sessions where id = 'b1000000-0000-4000-8000-000000000002';
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
insert into auth.sessions(id,user_id) values ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');
select 'logout and session ownership' as access_test_passed;

update auth.users set banned_until = now() + interval '1 hour' where id = 'a1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
update auth.users set banned_until = now() - interval '1 second' where id = 'a1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.assert_access('active');
reset role;
update auth.users set deleted_at = now() where id = 'a1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
update auth.users set banned_until = null, deleted_at = null where id = 'a1000000-0000-4000-8000-000000000002';
select 'Auth ban and soft deletion' as access_test_passed;

select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002',
    jsonb_build_object('exp', floor(extract(epoch from clock_timestamp()))::bigint + 90));
set local role authenticated;
do $test$
declare v_result jsonb := pg_temp.assert_access('active');
begin
    if (v_result ->> 'access_expires_at')::timestamptz
        <> to_timestamp((auth.jwt() ->> 'exp')::double precision)
    then raise exception 'Lease did not stop at JWT expiration'; end if;
end;
$test$;
reset role;
select set_config('test.access_session_expiry', (clock_timestamp() + interval '30 seconds')::text, true);
update auth.sessions set not_after = current_setting('test.access_session_expiry')::timestamptz
where id = 'b1000000-0000-4000-8000-000000000002';
set local role authenticated;
do $test$
declare v_result jsonb := pg_temp.assert_access('active');
begin
    if (v_result ->> 'access_expires_at')::timestamptz <> current_setting('test.access_session_expiry')::timestamptz
    then raise exception 'Lease did not stop at session expiration'; end if;
end;
$test$;
reset role;
update auth.sessions set not_after = now() - interval '1 second' where id = 'b1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
update auth.sessions set not_after = null where id = 'b1000000-0000-4000-8000-000000000002';
select 'bounded lease lifetime' as access_test_passed;

select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(null,''active'',''reason'')', '22023');
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(auth.uid(),''unknown'',''reason'')', '22023');
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(auth.uid(),''active'',null)', '22023');
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(gen_random_uuid(),''active'',''reason'')', '22023');
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(null,''reason'')', '22023');
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true, E'' \t\n\r '')', '22023');
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true,repeat(''x'',501))', '22023');
do $test$
declare v_result jsonb := public.admin_set_blabee_service_access(false, 'No-op is still audited');
begin
    if v_result -> 'changed' is distinct from 'false'::jsonb or v_result ->> 'audit_id' is null
    then raise exception 'Idempotent set did not report unchanged and record the attempt'; end if;
end;
$test$;
reset role;
select 'administrator input validation' as access_test_passed;

alter table blabee_access.audit_events add constraint test_block_user_audit check (action <> 'set_user_access') not valid;
set local role authenticated;
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(''a1000000-0000-4000-8000-000000000005'',''suspended'',''Must roll back'')', '23514');
reset role;
do $test$
begin
    if exists (select 1 from blabee_access.user_access where user_id = 'a1000000-0000-4000-8000-000000000005')
    then raise exception 'Audit failure left first-use provisioning or state changes behind'; end if;
end;
$test$;
alter table blabee_access.audit_events drop constraint test_block_user_audit;
alter table blabee_access.audit_events add constraint test_block_service_audit check (action <> 'set_service_access') not valid;
set local role authenticated;
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true,''Must roll back'')', '23514');
reset role;
do $test$
begin
    if (select paused from blabee_access.service_control where singleton)
    then raise exception 'Audit failure left global pause changed'; end if;
end;
$test$;
alter table blabee_access.audit_events drop constraint test_block_service_audit;
select 'audit failure rolls back changes' as access_test_passed;

-- Auth bans and non-social sessions apply equally to an allowlisted administrator.
update auth.users set banned_until = now() + interval '1 hour' where id = 'a1000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true,''Banned admin'')', '28000');
reset role;
update auth.users set banned_until = null where id = 'a1000000-0000-4000-8000-000000000003';
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003',
    '{"amr":[{"method":"password"}]}');
set local role authenticated;
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true,''Non-social admin'')', '42501');
reset role;
select blabee_access.set_admin_membership('a1000000-0000-4000-8000-000000000003', false, 'Revoke administrator');
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect_access_error('select public.admin_set_blabee_service_access(true,''Revoked admin'')', '42501');
select pg_temp.expect_access_error('select public.admin_set_blabee_user_access(auth.uid(),''active'',''Revoked admin'')', '42501');
reset role;
select 'administrator revocation' as access_test_passed;

delete from auth.users where id = 'a1000000-0000-4000-8000-000000000001';
delete from auth.users where id = 'a1000000-0000-4000-8000-000000000003';
do $test$
begin
    if exists (select 1 from blabee_access.user_access
        where user_id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003'))
        or exists (select 1 from blabee_access.admin_users where user_id = 'a1000000-0000-4000-8000-000000000003')
        or not exists (select 1 from blabee_access.audit_events
            where target_user_id = 'a1000000-0000-4000-8000-000000000001'
                and actor_user_id = 'a1000000-0000-4000-8000-000000000003')
    then raise exception 'Account deletion did not cascade state while retaining administrator history'; end if;
end;
$test$;
select pg_temp.use_access_session('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_access_error('select public.get_blabee_access(gen_random_uuid())', '28000');
reset role;
select 'account deletion preserves audit' as access_test_passed;
rollback;

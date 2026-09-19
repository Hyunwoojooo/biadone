-- Run after both analytics migrations in a DISPOSABLE database as the owner.
-- Requires Supabase auth.users/auth.uid() and anon/authenticated/service_role.
-- All fixtures and temporary privilege/schema changes are rolled back.
-- Single-connection tests cover quota state and atomicity; they do not replace
-- a concurrent-session PostgreSQL load test of the per-user/day row lock.
begin;
set local timezone = 'Asia/Seoul';

insert into auth.users (id, email, created_at, updated_at) values
    ('a943920f-ef2b-4c53-9924-e7f10d200001', 'error-one@example.invalid', now(), now()),
    ('a943920f-ef2b-4c53-9924-e7f10d200002', 'error-two@example.invalid', now(), now()),
    ('a943920f-ef2b-4c53-9924-e7f10d200003', 'error-three@example.invalid', now(), now()),
    ('a943920f-ef2b-4c53-9924-e7f10d200004', 'error-four@example.invalid', now(), now());

do $test$
declare
    v_rpc regprocedure := 'public.record_blabee_error(uuid,text,timestamptz,text,text,text)'::regprocedure;
begin
    if not exists (
        select 1 from pg_catalog.pg_proc
        where oid = v_rpc and prosecdef and proconfig @> array['search_path=""']
            and proargnames = array[
                'p_event_id', 'p_error_code', 'p_occurred_at',
                'p_app_version', 'p_app_build', 'p_os_version'
            ]::text[]
    ) then
        raise exception 'RPC security settings or bounded argument contract changed';
    end if;
    if has_function_privilege('anon', v_rpc, 'execute')
        or has_function_privilege('service_role', v_rpc, 'execute')
        or not has_function_privilege('authenticated', v_rpc, 'execute')
        or has_function_privilege('authenticated', 'blabee_analytics.prune_error_events()', 'execute')
        or has_function_privilege('service_role', 'blabee_analytics.prune_error_events()', 'execute')
    then
        raise exception 'Only authenticated callers may ingest; only owner may prune';
    end if;
    if exists (
        select 1 from pg_catalog.pg_class
        where oid in ('blabee_analytics.error_events'::regclass,
            'blabee_analytics.error_ingest_days'::regclass) and not relrowsecurity
    ) or (
        select count(*) from pg_catalog.pg_constraint
        where contype = 'p' and (
            (conrelid = 'blabee_analytics.error_events'::regclass
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, event_id)')
            or (conrelid = 'blabee_analytics.error_ingest_days'::regclass
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, received_date)')
        )
    ) <> 2 then
        raise exception 'Private tables require RLS and user-scoped concurrency keys';
    end if;
    if (select array_agg(attname::text order by attnum) from pg_catalog.pg_attribute
        where attrelid = 'blabee_analytics.error_events'::regclass and attnum > 0 and not attisdropped)
        is distinct from array['user_id', 'event_id', 'occurred_at', 'received_at',
            'error_code', 'app_version', 'app_build', 'os_version']::text[]
    then
        raise exception 'Unexpected diagnostic payload column';
    end if;
    raise notice 'PASS: strict RPC fields, ACL, empty search path, RLS, and user-scoped keys';
end;
$test$;

set local role anon;
do $test$
begin
    begin
        perform public.record_blabee_error('00000000-0000-4000-8000-000000000001',
            'account_service_unavailable', now(), '1.0.0', '49', '15.6');
        raise exception 'Anonymous diagnostic accepted';
    exception when insufficient_privilege then null;
    end;
    raise notice 'PASS: anonymous RPC denied';
end;
$test$;
reset role;

set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"authenticated"}';
set local role authenticated;
do $test$
begin
    begin
        perform public.record_blabee_error('00000000-0000-4000-8000-000000000001',
            'account_service_unavailable', now(), '1.0.0', '49', '15.6');
        raise exception 'Authenticated role without a user accepted';
    exception when invalid_authorization_specification then null;
    end;
    raise notice 'PASS: missing auth.uid rejected';
end;
$test$;
reset role;

set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200001';
set local request.jwt.claims = '{"sub":"a943920f-ef2b-4c53-9924-e7f10d200001","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    if public.record_blabee_error('00000000-0000-4000-8000-000000000001',
        'account_service_unavailable', now() - interval '1 hour', '1.0.0', '49', '15.6') is not true
        or public.record_blabee_error('00000000-0000-4000-8000-000000000001',
        'account_service_unavailable', now() - interval '1 hour', '1.0.0', '49', '15.6') is not false
        or public.record_blabee_error('00000000-0000-4000-8000-000000000001',
        'app_service_failed', now(), '2', '50', '26') is not false
    then
        raise exception 'First event or retry acknowledgement incorrect';
    end if;
end;
$test$;
reset role;
do $test$
begin
    if (select count(*) from blabee_analytics.error_events
        where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200001') <> 1
        or not exists (select 1 from blabee_analytics.error_events
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200001'
                and error_code = 'account_service_unavailable'
                and occurred_at = now() - interval '1 hour'
                and received_at = now() and app_version = '1.0.0' and app_build = '49')
        or (select accepted_count from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200001'
                and received_date = (now() at time zone 'UTC')::date) <> 1
    then
        raise exception 'Retry changed the event or consumed quota';
    end if;
    raise notice 'PASS: immutable idempotent record and quota independent of client occurrence time';
end;
$test$;

set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200002';
set local request.jwt.claims = '{"sub":"a943920f-ef2b-4c53-9924-e7f10d200002","role":"authenticated"}';
set local role authenticated;
do $test$
declare
    v_code text;
    v_version text;
    v_time timestamptz;
    v_index integer := 100;
begin
    if public.record_blabee_error('00000000-0000-4000-8000-000000000001',
        'account_service_unavailable', now(), '1', '49', '15') is not true then
        raise exception 'Another user incorrectly shares the event deduplication key';
    end if;
    foreach v_code in array array[
        'account_service_unavailable', 'account_invalid_response',
        'account_rate_limited', 'account_storage_unavailable',
        'account_refresh_failed', 'coordinator_connection_failed',
        'coordinator_response_invalid', 'choice_submit_failed',
        'approval_submit_failed', 'suggestion_dismiss_failed',
        'app_service_failed', 'app_service_timeout', 'app_service_exited'
    ] loop
        v_index := v_index + 1;
        if public.record_blabee_error(md5('valid-code-' || v_index)::uuid,
            v_code, now(), 'unknown', 'unknown', 'unknown') is not true then
            raise exception 'Allowed diagnostic code rejected';
        end if;
    end loop;
    foreach v_code in array array[null::text, '', 'arbitrary_error', 'ACCOUNT_REFRESH_FAILED',
        'account_service_unavailable: token=secret', '/Users/test/private-file'] loop
        begin
            perform public.record_blabee_error('00000000-0000-4000-8000-000000000090',
                v_code, now(), '1', '49', '15');
            raise exception 'Unbounded/null error code accepted';
        exception when invalid_parameter_value then null;
        end;
    end loop;
    foreach v_version in array array[null::text, '', 'Unknown', 'v1.2', '1.2-beta',
        '1.2.3.4.5', '1234567', '1..2', '.1', '1.', ' 1', '1 ', E'1\n', E'1\r', E'1\t',
        'token=secret', '/Users/test', '１２.３'] loop
        for v_index in 1..3 loop
            begin
                perform public.record_blabee_error('00000000-0000-4000-8000-000000000090',
                    'app_service_failed', now(),
                    case when v_index = 1 then v_version else '1' end,
                    case when v_index = 2 then v_version else '49' end,
                    case when v_index = 3 then v_version else '15' end);
                raise exception 'Unbounded/null version accepted';
            exception when invalid_parameter_value then null;
            end;
        end loop;
    end loop;
    foreach v_version in array array['1', '0.01', '12.0.1', '123456.123456.123456.123456'] loop
        if public.record_blabee_error(md5('valid-version-' || v_version)::uuid,
            'app_service_failed', now(), v_version, v_version, v_version) is not true then
            raise exception 'Allowed numeric version grammar rejected';
        end if;
    end loop;
    foreach v_time in array array[null::timestamptz, 'infinity'::timestamptz, '-infinity'::timestamptz,
        now() - interval '168 hours 1 microsecond', now() + interval '5 minutes 1 microsecond'] loop
        begin
            perform public.record_blabee_error('00000000-0000-4000-8000-000000000090',
                'app_service_failed', v_time, '1', '49', '15');
            raise exception 'Unbounded/null event time accepted';
        exception when invalid_parameter_value then null;
        end;
    end loop;
    begin
        perform public.record_blabee_error(null, 'app_service_failed', now(), '1', '49', '15');
        raise exception 'Null event ID accepted';
    exception when invalid_parameter_value then null;
    end;
    if public.record_blabee_error('00000000-0000-4000-8000-000000000091',
        'app_service_failed', now() - interval '168 hours', '1', '49', '15') is not true
        or public.record_blabee_error('00000000-0000-4000-8000-000000000092',
        'app_service_failed', now() + interval '5 minutes', '1', '49', '15') is not true then
        raise exception 'Inclusive event time boundary rejected';
    end if;
    raise notice 'PASS: all 13 codes, strict version grammar, null/infinite/input bounds, inclusive time edges';
end;
$test$;

do $test$
declare
    v_sql text;
begin
    foreach v_sql in array array[
        'select * from blabee_analytics.error_events',
        'select * from blabee_analytics.error_ingest_days',
        'update blabee_analytics.error_events set app_build = ''999''',
        'delete from blabee_analytics.error_events',
        'insert into blabee_analytics.error_ingest_days (user_id, received_date, accepted_count)
            values (''a943920f-ef2b-4c53-9924-e7f10d200001'', current_date, 0)',
        'select blabee_analytics.prune_error_events()'
    ] loop
        begin
            execute v_sql;
            raise exception 'Direct client read/write/spoof/maintenance allowed';
        exception when insufficient_privilege then null;
        end;
    end loop;
    raise notice 'PASS: direct client data access, ownership spoofing, and maintenance denied';
end;
$test$;
reset role;

do $test$
begin
    if (select count(*) from blabee_analytics.error_events
        where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200002') <> 20
        or (select accepted_count from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200002'
                and received_date = (now() at time zone 'UTC')::date) <> 20
        or (select count(*) from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200002') <> 1
        or (select count(*) from blabee_analytics.error_events
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200001') <> 1
    then
        raise exception 'Rejected inputs changed data, another user, or quota occurrence-day bucketing';
    end if;
    raise notice 'PASS: rejected inputs leave state unchanged; quotas use UTC received day';
end;
$test$;

-- No policies means RLS still blocks clients if grants are accidentally added.
grant usage on schema blabee_analytics to authenticated;
grant select, insert, update, delete on blabee_analytics.error_events,
    blabee_analytics.error_ingest_days to authenticated;
set local role authenticated;
do $test$
declare
    v_rows bigint;
begin
    if exists (select 1 from blabee_analytics.error_events)
        or exists (select 1 from blabee_analytics.error_ingest_days) then
        raise exception 'RLS leaked diagnostic rows after accidental grants';
    end if;
    update blabee_analytics.error_ingest_days set accepted_count = 0;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'RLS allowed direct quota reset'; end if;
    delete from blabee_analytics.error_events;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'RLS allowed direct event deletion'; end if;
    begin
        insert into blabee_analytics.error_ingest_days (user_id, received_date, accepted_count)
        values ('a943920f-ef2b-4c53-9924-e7f10d200001', (now() at time zone 'UTC')::date + 1, 0);
        raise exception 'RLS allowed direct ownership spoofing';
    exception when insufficient_privilege then null;
    end;
    begin
        perform blabee_analytics.prune_error_events();
        raise exception 'Schema grant leaked maintenance permission';
    exception when insufficient_privilege then null;
    end;
    raise notice 'PASS: RLS and maintenance ACL survive accidental table/schema grants';
end;
$test$;
reset role;
revoke all on blabee_analytics.error_events, blabee_analytics.error_ingest_days from authenticated;
revoke all on schema blabee_analytics from authenticated;

set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200001';
set local request.jwt.claims = '{"sub":"a943920f-ef2b-4c53-9924-e7f10d200001","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    for v_index in 2..200 loop
        if public.record_blabee_error(md5('quota-' || v_index)::uuid,
            'coordinator_connection_failed', now(), '1', '49', '15') is not true then
            raise exception 'Quota suppressed an event before the 200-record boundary';
        end if;
    end loop;
    if public.record_blabee_error('00000000-0000-4000-8000-000000000201',
        'coordinator_connection_failed', now(), '1', '49', '15') is not false
        or public.record_blabee_error('00000000-0000-4000-8000-000000000001',
        'account_service_unavailable', now() - interval '1 hour', '1.0.0', '49', '15.6') is not false then
        raise exception 'Quota suppression or duplicate did not acknowledge false';
    end if;
end;
$test$;
reset role;
set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200002';
set local request.jwt.claims = '{"sub":"a943920f-ef2b-4c53-9924-e7f10d200002","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    if public.record_blabee_error('00000000-0000-4000-8000-000000000201',
        'coordinator_connection_failed', now(), '1', '49', '15') is not true then
        raise exception 'One user quota blocked another user';
    end if;
end;
$test$;
reset role;
do $test$
begin
    if (select count(*) from blabee_analytics.error_events
        where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200001') <> 200
        or (select accepted_count from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200001') <> 200
        or (select accepted_count from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200002') <> 21
    then
        raise exception 'Quota must stop at exactly 200 accepted distinct events per user';
    end if;
    raise notice 'PASS: exact 200-event boundary, terminal suppression, and independent user quotas';
end;
$test$;

-- A failed quota update must roll back the event and newly created quota row.
alter table blabee_analytics.error_ingest_days add constraint errors_test_force_quota_failure
    check (user_id <> 'a943920f-ef2b-4c53-9924-e7f10d200003'::uuid or accepted_count = 0);
set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200003';
set local request.jwt.claims = '{"sub":"a943920f-ef2b-4c53-9924-e7f10d200003","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    begin
        perform public.record_blabee_error('00000000-0000-4000-8000-000000000301',
            'app_service_failed', now(), '1', '49', '15');
        raise exception 'Expected injected quota failure did not occur';
    exception when check_violation then null;
    end;
end;
$test$;
reset role;
alter table blabee_analytics.error_ingest_days drop constraint errors_test_force_quota_failure;
do $test$
begin
    if exists (select 1 from blabee_analytics.error_events
        where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200003')
        or exists (select 1 from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200003') then
        raise exception 'Failed quota update persisted event or counter';
    end if;
    if public.record_blabee_error('00000000-0000-4000-8000-000000000301',
        'app_service_failed', now(), '1', '49', '15') is not true then
        raise exception 'Rolled-back event ID cannot be retried';
    end if;
    delete from auth.users where id = 'a943920f-ef2b-4c53-9924-e7f10d200003';
    if exists (select 1 from blabee_analytics.error_events
        where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200003')
        or exists (select 1 from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200003') then
        raise exception 'Account deletion failed to cascade to event and quota rows';
    end if;
    raise notice 'PASS: event/quota transaction rollback, retry, and account deletion cascade';
end;
$test$;

-- Previous UTC receipt days do not consume today's quota; retries still
-- deduplicate globally by (user_id,event_id) while the event is retained.
insert into blabee_analytics.error_ingest_days values
    ('a943920f-ef2b-4c53-9924-e7f10d200004', (now() at time zone 'UTC')::date - 1, 200);
insert into blabee_analytics.error_events values
    ('a943920f-ef2b-4c53-9924-e7f10d200004', '00000000-0000-4000-8000-000000000401',
        now() - interval '24 hours', now() - interval '24 hours', 'app_service_failed', '1', '48', '15');
set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200004';
set local request.jwt.claims = '{"sub":"a943920f-ef2b-4c53-9924-e7f10d200004","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    if public.record_blabee_error('00000000-0000-4000-8000-000000000401',
        'app_service_failed', now() - interval '24 hours', '1', '48', '15') is not false
        or public.record_blabee_error('00000000-0000-4000-8000-000000000402',
        'app_service_failed', now(), '1', '49', '15') is not true then
        raise exception 'Next receipt day did not reset quota while preserving ID deduplication';
    end if;
end;
$test$;
reset role;
do $test$
begin
    if (select accepted_count from blabee_analytics.error_ingest_days
        where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200004'
            and received_date = (now() at time zone 'UTC')::date) <> 1
        or (select accepted_count from blabee_analytics.error_ingest_days
            where user_id = 'a943920f-ef2b-4c53-9924-e7f10d200004'
                and received_date = (now() at time zone 'UTC')::date - 1) <> 200 then
        raise exception 'Cross-day retry consumed or reset the wrong quota';
    end if;
    raise notice 'PASS: daily quota rollover and cross-day event deduplication';
end;
$test$;

insert into blabee_analytics.error_events values
    ('a943920f-ef2b-4c53-9924-e7f10d200004', '00000000-0000-4000-8000-000000000411',
        now() - interval '721 hours', now() - interval '720 hours 1 microsecond', 'app_service_failed', '1', '1', '15'),
    ('a943920f-ef2b-4c53-9924-e7f10d200004', '00000000-0000-4000-8000-000000000412',
        now() - interval '721 hours', now() - interval '720 hours', 'app_service_failed', '1', '1', '15'),
    ('a943920f-ef2b-4c53-9924-e7f10d200004', '00000000-0000-4000-8000-000000000413',
        now() - interval '721 hours', now() - interval '719 hours', 'app_service_failed', '1', '1', '15');
insert into blabee_analytics.error_ingest_days values
    ('a943920f-ef2b-4c53-9924-e7f10d200004', (now() at time zone 'UTC')::date - 31, 1),
    ('a943920f-ef2b-4c53-9924-e7f10d200004', (now() at time zone 'UTC')::date - 30, 2);
do $test$
declare
    v_deleted bigint;
begin
    v_deleted := blabee_analytics.prune_error_events();
    if v_deleted <> 1
        or exists (select 1 from blabee_analytics.error_events
            where event_id = '00000000-0000-4000-8000-000000000411')
        or (select count(*) from blabee_analytics.error_events
            where event_id in ('00000000-0000-4000-8000-000000000412',
                '00000000-0000-4000-8000-000000000413')) <> 2
        or exists (select 1 from blabee_analytics.error_ingest_days
            where received_date = (now() at time zone 'UTC')::date - 31)
        or not exists (select 1 from blabee_analytics.error_ingest_days
            where received_date = (now() at time zone 'UTC')::date - 30)
    then
        raise exception 'Pruning must follow strict 30-day receipt time and retain the cutoff quota date';
    end if;
    raise notice 'PASS: strict 30-day receipt retention, independent of occurrence time';
end;
$test$;

rollback;

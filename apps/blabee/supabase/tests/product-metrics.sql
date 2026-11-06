-- Run only in a DISPOSABLE database as the owner after migrations 0001/0002/0004.
-- Requires Supabase auth/users/roles. All fixtures and permission probes roll back.
-- Single-session tests do not replace a concurrent-session PostgreSQL load test.
begin;
set local timezone = 'Asia/Seoul';

insert into auth.users (id, email, created_at, updated_at) values
    ('b712fa00-0000-4000-8000-000000000001', 'product-one@example.invalid', now(), now()),
    ('b712fa00-0000-4000-8000-000000000002', 'product-two@example.invalid', now(), now()),
    ('b712fa00-0000-4000-8000-000000000003', 'product-quota@example.invalid', now(), now()),
    ('b712fa00-0000-4000-8000-000000000004', 'product-retention@example.invalid', now(), now());

-- Test-only typed argument adapter; production RPC remains the exact 13 fields.
create function pg_temp.product_event(p_overrides jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path = ''
as $function$
declare
    v jsonb := pg_catalog.jsonb_build_object(
        'event_id', pg_catalog.gen_random_uuid(), 'occurred_at', pg_catalog.now(),
        'metric_kind', 'environment_observed', 'operation_id', null,
        'feature', 'none', 'input_method', 'none', 'latency_bucket', 'none',
        'app_version', '1.0.0', 'app_build', '55', 'os_major', '15',
        'ui_language', 'ko', 'target_version', 'none', 'target_build', 'none') || p_overrides;
begin
    return public.record_blabee_product_event(
        (v->>'event_id')::uuid, (v->>'occurred_at')::timestamptz,
        v->>'metric_kind', (v->>'operation_id')::uuid,
        v->>'feature', v->>'input_method', v->>'latency_bucket',
        v->>'app_version', v->>'app_build', v->>'os_major', v->>'ui_language',
        v->>'target_version', v->>'target_build');
end;
$function$;

do $test$
declare
    v_rpc regprocedure := 'public.record_blabee_product_event(uuid,timestamptz,text,uuid,text,text,text,text,text,text,text,text,text)'::regprocedure;
    v_table regclass;
    v_role text;
begin
    if not exists (select 1 from pg_catalog.pg_proc where oid = v_rpc
        and prosecdef and proconfig @> array['search_path=""']
        and proargnames = array['p_event_id', 'p_occurred_at', 'p_metric_kind',
            'p_operation_id', 'p_feature', 'p_input_method', 'p_latency_bucket',
            'p_app_version', 'p_app_build', 'p_os_major', 'p_ui_language',
            'p_target_version', 'p_target_build']::text[])
    then raise exception 'RPC security settings or 13-field contract changed'; end if;
    if has_function_privilege('anon', v_rpc, 'execute')
        or has_function_privilege('service_role', v_rpc, 'execute')
        or not has_function_privilege('authenticated', v_rpc, 'execute')
        or has_function_privilege('authenticated', 'blabee_analytics.prune_product_event_receipts()', 'execute')
        or has_function_privilege('service_role', 'blabee_analytics.prune_product_event_receipts()', 'execute')
    then raise exception 'Unexpected function privileges'; end if;
    for v_table in select oid from pg_catalog.pg_class
        where relnamespace = 'blabee_analytics'::regnamespace and relname like 'product_%' and relkind = 'r'
    loop
        if not (select relrowsecurity from pg_catalog.pg_class where oid = v_table)
            or exists (select 1 from pg_catalog.pg_policy where polrelid = v_table)
        then raise exception 'Every product table needs RLS with no client policy'; end if;
        foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
            if has_table_privilege(v_role, v_table, 'select,insert,update,delete,truncate,references,trigger')
            then raise exception 'Unexpected direct table privilege: % %', v_role, v_table; end if;
        end loop;
        if not exists (select 1 from pg_catalog.pg_constraint where conrelid = v_table
            and contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype = 'c')
        then raise exception 'Missing account deletion cascade'; end if;
    end loop;
    if (select count(*) from pg_catalog.pg_class where relnamespace = 'blabee_analytics'::regnamespace
        and relname like 'product_%' and relkind = 'r') <> 7
    then raise exception 'Unexpected product table count'; end if;
    raise notice 'PASS: RPC contract, least privilege, seven private RLS tables, deletion cascades';
end;
$test$;

set local role anon;
do $test$
begin
    begin
        perform pg_temp.product_event();
        raise exception 'Anonymous event accepted';
    exception when insufficient_privilege then null; end;
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
        perform pg_temp.product_event();
        raise exception 'Authenticated role without uid accepted';
    exception when invalid_authorization_specification then null; end;
    raise notice 'PASS: missing auth.uid rejected';
end;
$test$;
reset role;

set local request.jwt.claim.sub = 'b712fa00-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"b712fa00-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    if not pg_temp.product_event('{"event_id":"00000000-0000-4000-8000-000000000001"}')
        or pg_temp.product_event('{"event_id":"00000000-0000-4000-8000-000000000001","metric_kind":"account_ready"}')
    then raise exception 'Valid ingest or immutable event-ID dedup failed'; end if;
    begin
        perform count(*) from blabee_analytics.product_environment_days;
        raise exception 'Authenticated table access accepted';
    exception when insufficient_privilege then null; end;
    raise notice 'PASS: authenticated ingest, event-ID dedup and direct-read denial';
end;
$test$;
reset role;

do $test$
begin
    if (select count(*) from blabee_analytics.product_environment_days) <> 1
        or exists(select 1 from blabee_analytics.product_milestones)
        or (select accepted_count from blabee_analytics.product_ingest_days
            where user_id = 'b712fa00-0000-4000-8000-000000000001') <> 1
    then raise exception 'Duplicate ID altered aggregate or consumed quota'; end if;
    if pg_temp.product_event() then raise exception 'Same environment/day counted twice'; end if;
    if not pg_temp.product_event('{"app_build":"56"}')
        or not pg_temp.product_event('{"ui_language":"en"}')
        or not pg_temp.product_event(jsonb_build_object('occurred_at',
            ((now() at time zone 'UTC')::date - 1)::timestamp at time zone 'UTC' + interval '22 hours'))
    then raise exception 'Distinct environment or UTC day missing'; end if;
    if (select count(*) from blabee_analytics.product_environment_days) <> 4
        or not exists(select 1 from blabee_analytics.product_environment_days
            where observed_date = (now() at time zone 'UTC')::date - 1)
    then raise exception 'Daily environment uniqueness/UTC dates incorrect'; end if;
    raise notice 'PASS: environment user/day/dimension uniqueness and UTC bucketing';
end;
$test$;

do $test$
declare
    v_kind text;
begin
    foreach v_kind in array array['account_ready', 'service_connected', 'card_received', 'first_action'] loop
        if not pg_temp.product_event(jsonb_build_object('metric_kind', v_kind))
            or not pg_temp.product_event(jsonb_build_object('metric_kind', v_kind, 'occurred_at', now() - interval '48 hours'))
            or pg_temp.product_event(jsonb_build_object('metric_kind', v_kind, 'occurred_at', now() - interval '24 hours'))
        then raise exception 'Milestone did not retain earliest observed day'; end if;
    end loop;
    if (select count(*) from blabee_analytics.product_milestones
        where first_observed_date = ((now() - interval '48 hours') at time zone 'UTC')::date) <> 4
    then raise exception 'Missing earliest milestone dates'; end if;
    raise notice 'PASS: all four stages retain earliest observed date without backfilling other stages';
end;
$test$;

do $test$
declare
    v_op jsonb := jsonb_build_object('operation_id', '10000000-0000-4000-8000-000000000001',
        'occurred_at', now() - interval '24 hours', 'feature', 'choice', 'input_method', 'button');
begin
    if not pg_temp.product_event(v_op || '{"metric_kind":"feature_started"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"feature_started"}')
        or not pg_temp.product_event(v_op || '{"metric_kind":"feature_succeeded","latency_bucket":"under_1s"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"feature_failed","latency_bucket":"over_3s"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"feature_succeeded","latency_bucket":"1_to_3s"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"feature_started"}')
    then raise exception 'Start/terminal first-wins semantics incorrect'; end if;
    if (select sum(operation_count) from blabee_analytics.product_operation_days) <> 1
        or (select sum(operation_count) from blabee_analytics.product_operation_days
            where outcome = 'succeeded' and latency_bucket = 'under_1s') <> 1
        or exists(select 1 from blabee_analytics.product_operation_days where outcome = 'pending')
    then raise exception 'Operation moved denominator or left pending count'; end if;
    raise notice 'PASS: start/result pairing, semantic duplicates, first terminal wins, no reopening';
end;
$test$;

do $test$
declare
    v_op jsonb := jsonb_build_object('operation_id', '10000000-0000-4000-8000-000000000002',
        'occurred_at', now() - interval '24 hours', 'feature', 'approval', 'input_method', 'keyboard');
begin
    if not pg_temp.product_event(v_op || '{"metric_kind":"feature_failed","latency_bucket":"1_to_3s"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"feature_started"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"feature_cancelled","latency_bucket":"unknown"}')
    then raise exception 'Terminal-first operation duplicated or changed'; end if;
    if not pg_temp.product_event(jsonb_build_object(
        'operation_id', '10000000-0000-4000-8000-000000000003',
        'metric_kind', 'feature_cancelled', 'latency_bucket', 'unknown',
        'feature', 'dismiss', 'input_method', 'button'))
        or not pg_temp.product_event(jsonb_build_object(
            'operation_id', '10000000-0000-4000-8000-000000000004',
            'metric_kind', 'feature_started', 'feature', 'dismiss', 'input_method', 'keyboard'))
    then raise exception 'Cancellation or pending operation missing'; end if;
    if (select sum(operation_count) from blabee_analytics.product_operation_days) <> 4
        or (select count(*) from blabee_analytics.product_operation_days
            where outcome in ('succeeded', 'failed', 'cancelled', 'pending') and operation_count = 1) <> 4
    then raise exception 'Outcome denominators or cancellation distinction incorrect'; end if;
    raise notice 'PASS: terminal-before-start is one attempt; cancellation/pending stay separate';
end;
$test$;

do $test$
declare
    v_op jsonb := jsonb_build_object('operation_id', '10000000-0000-4000-8000-000000000001',
        'occurred_at', now() - interval '24 hours', 'feature', 'choice', 'input_method', 'button',
        'metric_kind', 'feature_succeeded', 'latency_bucket', 'under_1s');
    v_change jsonb;
    v_before integer := (select accepted_count from blabee_analytics.product_ingest_days
        where user_id = 'b712fa00-0000-4000-8000-000000000001');
    v_receipts bigint := (select count(*) from blabee_analytics.product_event_receipts);
begin
    for v_change in select value from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('occurred_at', now() - interval '48 hours'),
        '{"feature":"approval"}'::jsonb, '{"input_method":"keyboard"}'::jsonb,
        '{"app_version":"2.0"}'::jsonb, '{"app_build":"56"}'::jsonb,
        '{"os_major":"16"}'::jsonb, '{"ui_language":"en"}'::jsonb
    )) loop
        begin
            perform pg_temp.product_event(v_op || v_change);
            raise exception 'Changed operation dimensions accepted';
        exception when invalid_parameter_value then null; end;
    end loop;
    if (select accepted_count from blabee_analytics.product_ingest_days
        where user_id = 'b712fa00-0000-4000-8000-000000000001') <> v_before
        or (select count(*) from blabee_analytics.product_event_receipts) <> v_receipts
        or (select sum(operation_count) from blabee_analytics.product_operation_days) <> 4
    then raise exception 'Rejected dimension change left partial state'; end if;
    raise notice 'PASS: original operation date/environment/input enforced; rejected calls fully roll back';
end;
$test$;

do $test$
declare
    v_update jsonb := '{"feature":"app_update","target_version":"1.1","target_build":"60"}';
    v_op jsonb := '{"feature":"app_update","target_version":"1.1","target_build":"60",
        "operation_id":"20000000-0000-4000-8000-000000000001"}';
begin
    if not pg_temp.product_event(v_update || '{"metric_kind":"update_available"}')
        or pg_temp.product_event(v_update || '{"metric_kind":"update_available","app_build":"56"}')
        or not pg_temp.product_event(v_update || '{"metric_kind":"update_available","target_build":"61"}')
        or not pg_temp.product_event(v_op || '{"metric_kind":"update_started"}')
        or not pg_temp.product_event(v_op || '{"metric_kind":"update_succeeded"}')
        or pg_temp.product_event(v_op || '{"metric_kind":"update_failed"}')
    then raise exception 'Update offer/state aggregation incorrect'; end if;
    begin
        perform pg_temp.product_event(v_op || '{"metric_kind":"update_succeeded","target_build":"61"}');
        raise exception 'Changed update target accepted';
    exception when invalid_parameter_value then null; end;
    if (select count(*) from blabee_analytics.product_update_offer_days) <> 2
        or (select sum(operation_count) from blabee_analytics.product_operation_days where feature = 'app_update') <> 1
    then raise exception 'Updates duplicated attempts or offers'; end if;
    raise notice 'PASS: daily update target dedup, paired update outcomes, immutable update target';
end;
$test$;

do $test$
declare
    v_bad jsonb;
    v_key text;
    v_before integer := (select accepted_count from blabee_analytics.product_ingest_days
        where user_id = 'b712fa00-0000-4000-8000-000000000001');
begin
    foreach v_key in array array['event_id', 'occurred_at', 'metric_kind', 'feature',
        'input_method', 'latency_bucket', 'app_version', 'app_build', 'os_major',
        'ui_language', 'target_version', 'target_build'] loop
        begin
            perform pg_temp.product_event(jsonb_build_object(v_key, null));
            raise exception 'NULL input accepted: %', v_key;
        exception when invalid_parameter_value then null; end;
    end loop;
    for v_bad in select value from jsonb_array_elements(jsonb_build_array(
        '{"metric_kind":"raw_log"}'::jsonb, '{"app_version":"/Users/test/private"}'::jsonb,
        '{"app_build":"1234567"}'::jsonb, '{"app_version":"1.2.3.4.5"}'::jsonb,
        '{"app_build":"token-secret"}'::jsonb, '{"os_major":"15.6"}'::jsonb,
        '{"os_major":"1234567"}'::jsonb, '{"ui_language":"ko-KR"}'::jsonb,
        jsonb_build_object('app_version', E'1.0\n'),
        '{"occurred_at":"infinity"}'::jsonb, '{"occurred_at":"-infinity"}'::jsonb,
        jsonb_build_object('occurred_at', now() - interval '168 hours 1 second'),
        jsonb_build_object('occurred_at', now() + interval '5 minutes 1 second')
    )) loop
        begin
            perform pg_temp.product_event(v_bad);
            raise exception 'Invalid scalar/time accepted: %', v_bad;
        exception when invalid_parameter_value then null; end;
    end loop;
    if (select accepted_count from blabee_analytics.product_ingest_days
        where user_id = 'b712fa00-0000-4000-8000-000000000001') <> v_before
    then raise exception 'Invalid scalar inputs consumed quota'; end if;
    if not pg_temp.product_event('{"app_version":"999999.999999.999999.999999","app_build":"unknown","os_major":"999999","ui_language":"other"}')
        or not pg_temp.product_event(jsonb_build_object('occurred_at', now() - interval '168 hours'))
        or not pg_temp.product_event(jsonb_build_object('occurred_at', now() + interval '5 minutes', 'app_build', '57'))
    then raise exception 'Valid bounded version/time edge rejected'; end if;
    raise notice 'PASS: NULL, scalar allowlists, free text, finite/time bounds and valid boundary values';
end;
$test$;

do $test$
declare
    v_bad jsonb;
    v_before bigint := (select count(*) from blabee_analytics.product_event_receipts);
begin
    for v_bad in select value from jsonb_array_elements('[
        {"operation_id":"30000000-0000-4000-8000-000000000001"},
        {"feature":"choice"}, {"input_method":"button"}, {"latency_bucket":"under_1s"},
        {"target_version":"1"}, {"target_build":"60"},
        {"metric_kind":"feature_started","feature":"choice","input_method":"button"},
        {"metric_kind":"feature_succeeded","operation_id":"30000000-0000-4000-8000-000000000001","feature":"choice","input_method":"button"},
        {"metric_kind":"feature_started","operation_id":"30000000-0000-4000-8000-000000000001","feature":"choice","input_method":"button","latency_bucket":"under_1s"},
        {"metric_kind":"feature_failed","operation_id":"30000000-0000-4000-8000-000000000001","feature":"choice","input_method":"mouse","latency_bucket":"unknown"},
        {"metric_kind":"feature_cancelled","operation_id":"30000000-0000-4000-8000-000000000001","feature":"choice","input_method":"button","latency_bucket":"unknown","target_build":"60"},
        {"metric_kind":"update_available","feature":"app_update","target_version":"1","target_build":"60","operation_id":"30000000-0000-4000-8000-000000000001"},
        {"metric_kind":"update_started","feature":"app_update","target_version":"1","target_build":"60"},
        {"metric_kind":"update_failed","feature":"app_update","operation_id":"30000000-0000-4000-8000-000000000001"},
        {"metric_kind":"update_succeeded","feature":"app_update","target_version":"1","target_build":"60","input_method":"button","operation_id":"30000000-0000-4000-8000-000000000001"},
        {"metric_kind":"update_cancelled","feature":"app_update","target_version":"1","target_build":"60","latency_bucket":"unknown","operation_id":"30000000-0000-4000-8000-000000000001"},
        {"metric_kind":"update_available","feature":"app_update","target_version":"secret","target_build":"60"}
    ]'::jsonb) loop
        begin
            perform pg_temp.product_event(v_bad);
            raise exception 'Invalid event shape accepted: %', v_bad;
        exception when invalid_parameter_value then null; end;
    end loop;
    if (select count(*) from blabee_analytics.product_event_receipts) <> v_before
    then raise exception 'Invalid shape left receipts'; end if;
    raise notice 'PASS: observation/feature/update shape matrix rejects cross-kind or unbounded fields';
end;
$test$;

set local request.jwt.claim.sub = 'b712fa00-0000-4000-8000-000000000002';
do $test$
begin
    if not pg_temp.product_event('{"event_id":"00000000-0000-4000-8000-000000000001"}')
        or not pg_temp.product_event(jsonb_build_object(
            'operation_id', '10000000-0000-4000-8000-000000000001',
            'occurred_at', now() - interval '24 hours', 'feature', 'choice', 'input_method', 'button',
            'metric_kind', 'feature_succeeded', 'latency_bucket', 'over_3s'))
    then raise exception 'Same event/operation UUID was not scoped to auth.uid'; end if;
    if (select sum(operation_count) from blabee_analytics.product_operation_days
        where user_id = 'b712fa00-0000-4000-8000-000000000002') <> 1
    then raise exception 'Wrong user received operation'; end if;
    raise notice 'PASS: event/operation UUIDs scoped to server auth.uid across users';
end;
$test$;

do $test$
declare
    v_first jsonb := '{"feature":"choice","input_method":"button","operation_id":"50000000-0000-4000-8000-000000000001"}';
    v_second jsonb := '{"feature":"choice","input_method":"button","operation_id":"50000000-0000-4000-8000-000000000002"}';
begin
    perform pg_temp.product_event(v_first || '{"metric_kind":"feature_started"}');
    perform pg_temp.product_event(v_second || '{"metric_kind":"feature_started"}');
    perform pg_temp.product_event(v_first || '{"metric_kind":"feature_failed","latency_bucket":"over_3s"}');
    if (select sum(operation_count) from blabee_analytics.product_operation_days
        where user_id = 'b712fa00-0000-4000-8000-000000000002') <> 3
        or (select sum(operation_count) from blabee_analytics.product_operation_days
            where user_id = 'b712fa00-0000-4000-8000-000000000002' and outcome = 'pending') <> 1
    then raise exception 'One result consumed another pending operation'; end if;
    perform pg_temp.product_event(v_second || '{"metric_kind":"feature_cancelled","latency_bucket":"under_1s"}');
    if exists(select 1 from blabee_analytics.product_operation_days
        where user_id = 'b712fa00-0000-4000-8000-000000000002' and outcome = 'pending')
        or (select sum(operation_count) from blabee_analytics.product_operation_days
            where user_id = 'b712fa00-0000-4000-8000-000000000002') <> 3
    then raise exception 'Shared pending aggregate leaked or changed attempt total'; end if;
    raise notice 'PASS: multiple operations sharing an aggregate retain attempts across independent terminal moves';
end;
$test$;

set local request.jwt.claim.sub = 'b712fa00-0000-4000-8000-000000000003';
do $test$
declare
    v_i integer;
begin
    for v_i in 1..1000 loop
        perform pg_temp.product_event();
    end loop;
    if pg_temp.product_event('{"metric_kind":"account_ready"}')
        or (select accepted_count from blabee_analytics.product_ingest_days
            where user_id = 'b712fa00-0000-4000-8000-000000000003') <> 1000
        or (select count(*) from blabee_analytics.product_event_receipts
            where user_id = 'b712fa00-0000-4000-8000-000000000003') <> 1000
        or exists(select 1 from blabee_analytics.product_milestones
            where user_id = 'b712fa00-0000-4000-8000-000000000003')
    then raise exception 'Cap did not suppress atomically at 1000 receipts'; end if;
    raise notice 'PASS: 1000-receipt daily cap, semantic duplicates consume cap, suppression leaves no partial stage';
end;
$test$;

set local request.jwt.claim.sub = 'b712fa00-0000-4000-8000-000000000004';
do $test$
declare
    v_rows bigint;
begin
    perform pg_temp.product_event();
    perform pg_temp.product_event('{"metric_kind":"account_ready"}');
    perform pg_temp.product_event('{"metric_kind":"feature_started","operation_id":"40000000-0000-4000-8000-000000000001","feature":"choice","input_method":"button"}');
    update blabee_analytics.product_event_receipts set received_at = now() - interval '192 hours 1 second'
        where user_id = 'b712fa00-0000-4000-8000-000000000004';
    update blabee_analytics.product_operation_receipts set first_received_at = now() - interval '192 hours 1 second'
        where user_id = 'b712fa00-0000-4000-8000-000000000004';
    insert into blabee_analytics.product_event_receipts values
        ('b712fa00-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000002', now() - interval '192 hours'),
        ('b712fa00-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000003', now() - interval '191 hours');
    insert into blabee_analytics.product_ingest_days values
        ('b712fa00-0000-4000-8000-000000000004', ((now() - interval '192 hours') at time zone 'UTC')::date - 1, 1),
        ('b712fa00-0000-4000-8000-000000000004', ((now() - interval '192 hours') at time zone 'UTC')::date, 1);
    v_rows := blabee_analytics.prune_product_event_receipts();
    if v_rows <> 4
        or (select count(*) from blabee_analytics.product_event_receipts
            where user_id = 'b712fa00-0000-4000-8000-000000000004') <> 2
        or exists(select 1 from blabee_analytics.product_operation_receipts
            where user_id = 'b712fa00-0000-4000-8000-000000000004')
        or (select count(*) from blabee_analytics.product_ingest_days
            where user_id = 'b712fa00-0000-4000-8000-000000000004') <> 2
        or not exists(select 1 from blabee_analytics.product_milestones
            where user_id = 'b712fa00-0000-4000-8000-000000000004')
        or not exists(select 1 from blabee_analytics.product_environment_days
            where user_id = 'b712fa00-0000-4000-8000-000000000004')
        or (select sum(operation_count) from blabee_analytics.product_operation_days
            where user_id = 'b712fa00-0000-4000-8000-000000000004' and outcome = 'pending') <> 1
    then raise exception 'Retention cutoff, date boundary, or durable aggregates incorrect'; end if;
    raise notice 'PASS: eight-day server-receipt retention, strict cutoff and aggregate/pending preservation';
end;
$test$;

do $test$
declare
    v_table regclass;
    v_count bigint;
begin
    delete from auth.users where id in (
        'b712fa00-0000-4000-8000-000000000001', 'b712fa00-0000-4000-8000-000000000002',
        'b712fa00-0000-4000-8000-000000000003', 'b712fa00-0000-4000-8000-000000000004');
    for v_table in select oid from pg_catalog.pg_class where relnamespace = 'blabee_analytics'::regnamespace
        and relname like 'product_%' and relkind = 'r'
    loop
        execute format('select count(*) from %s', v_table) into v_count;
        if v_count <> 0 then raise exception 'Account deletion left rows in %', v_table; end if;
    end loop;
    raise notice 'PASS: account deletion cascades through all seven tables';
end;
$test$;

rollback;

-- Disposable owner-only SQL tests after migrations 0001/0002/0004/0006.
-- All fixtures/helpers roll back. PGlite covers single-session state/ACL behavior,
-- not a multi-connection race/load test.
begin;
set local timezone='Asia/Seoul';
insert into auth.users(id,email,created_at,updated_at)
select ('d912fa00-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
    'feedback-test-' || i || '@example.invalid',now(),now() from generate_series(1,4) as n(i);

create function pg_temp.insight(p jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $f$
declare v jsonb:=pg_catalog.jsonb_build_object('event_id',pg_catalog.gen_random_uuid(),'occurred_at',pg_catalog.now(),
    'metric_kind','connection_observed','card_id',null,'card_kind','none','response','none','reaction_bucket','none',
    'app_version','1.0.0','app_build','56','os_major','15','ui_language','ko',
    'codex_version','0.154.0','connection_mode','plugin','compatibility','qualified')||p;
begin return public.record_blabee_insight_event(
    (v->>'event_id')::uuid,(v->>'occurred_at')::timestamptz,v->>'metric_kind',(v->>'card_id')::uuid,
    v->>'card_kind',v->>'response',v->>'reaction_bucket',v->>'app_version',v->>'app_build',
    v->>'os_major',v->>'ui_language',v->>'codex_version',v->>'connection_mode',v->>'compatibility'); end;$f$;
create function pg_temp.feedback(p jsonb default '{}') returns uuid
language plpgsql security invoker set search_path='' as $f$
declare v jsonb:=pg_catalog.jsonb_build_object('submission_id',pg_catalog.gen_random_uuid(),
    'rating','helpful','reason','none','use_purpose','none','question','','answer','','suggestion','','note','',
    'content_consent',false,'policy_version',1,'app_version','1.0.0','app_build','56','os_major','15','ui_language','ko')||p;
begin return public.submit_blabee_feedback((v->>'submission_id')::uuid,v->>'rating',v->>'reason',v->>'use_purpose',
    v->>'question',v->>'answer',v->>'suggestion',v->>'note',(v->>'content_consent')::boolean,(v->>'policy_version')::integer,
    v->>'app_version',v->>'app_build',v->>'os_major',v->>'ui_language'); end;$f$;

do $t$
declare v_table regclass;v_role text;v_fn regprocedure;
begin
    foreach v_fn in array array[
        'public.record_blabee_insight_event(uuid,timestamptz,text,uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure,
        'public.submit_blabee_feedback(uuid,text,text,text,text,text,text,text,boolean,integer,text,text,text,text)'::regprocedure,
        'public.list_blabee_feedback()'::regprocedure,'public.delete_blabee_feedback(uuid)'::regprocedure
    ] loop
        if not exists(select 1 from pg_proc where oid=v_fn and prosecdef and proconfig @> array['search_path=""'])
            or has_function_privilege('anon',v_fn,'execute')
            or has_function_privilege('service_role',v_fn,'execute')
            or not has_function_privilege('authenticated',v_fn,'execute')
        then raise exception 'Incorrect authenticated RPC privilege/security'; end if;
    end loop;
    v_fn:='public.record_blabee_subscription_event(text,text,uuid,text,timestamptz,text)'::regprocedure;
    if has_function_privilege('authenticated',v_fn,'execute') or has_function_privilege('anon',v_fn,'execute')
        or not has_function_privilege('service_role',v_fn,'execute')
        or not exists(select 1 from pg_proc where oid=v_fn and prosecdef and proconfig @> array['search_path=""'])
    then raise exception 'Billing must be service-role-only definer with empty path'; end if;
    foreach v_table in array array[
        'blabee_analytics.insight_event_receipts'::regclass,'blabee_analytics.insight_ingest_days'::regclass,
        'blabee_analytics.connection_observation_days'::regclass,'blabee_analytics.card_observation_receipts'::regclass,
        'blabee_analytics.card_observation_days'::regclass,'blabee_analytics.feedback_receipts'::regclass,
        'blabee_analytics.feedback_submissions'::regclass,'blabee_analytics.feedback_ingest_days'::regclass,
        'blabee_analytics.subscription_events'::regclass
    ] loop
        if not(select relrowsecurity from pg_class where oid=v_table)
            or exists(select 1 from pg_policy where polrelid=v_table)
        then raise exception 'Table must have RLS and no direct policy'; end if;
        foreach v_role in array array['anon','authenticated','service_role'] loop
            if has_table_privilege(v_role,v_table,'select,insert,update,delete,truncate,references,trigger')
            then raise exception 'Unexpected direct table privilege'; end if;
        end loop;
        if not exists(select 1 from pg_constraint where conrelid=v_table and contype='f'
            and confrelid='auth.users'::regclass and confdeltype='c')
        then raise exception 'Missing account cascade'; end if;
    end loop;
    if (select pronargs from pg_proc where oid='public.record_blabee_insight_event(uuid,timestamptz,text,uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure)<>14
        or (select pronargs from pg_proc where oid='public.submit_blabee_feedback(uuid,text,text,text,text,text,text,text,boolean,integer,text,text,text,text)'::regprocedure)<>14
        or (select proargnames from pg_proc where oid='public.list_blabee_feedback()'::regprocedure)
            is distinct from array['submission_id','received_at','expires_at','rating','reason','use_purpose','has_content']::text[]
    then raise exception 'Bounded RPC/list contract changed'; end if;
    raise notice 'PASS: nine private RLS tables, exact RPC fields, bounded summary shape and billing ACL';
end;$t$;

set local role anon;
do $t$begin
    begin perform pg_temp.insight();raise exception 'anon insight';exception when insufficient_privilege then null;end;
    begin perform pg_temp.feedback();raise exception 'anon feedback';exception when insufficient_privilege then null;end;
    begin perform public.list_blabee_feedback();raise exception 'anon list';exception when insufficient_privilege then null;end;
    begin perform public.delete_blabee_feedback(gen_random_uuid());raise exception 'anon delete';exception when insufficient_privilege then null;end;
    raise notice 'PASS: anonymous ingestion, submission, list and deletion denied';
end;$t$;
reset role;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{"role":"authenticated"}';
set local role authenticated;
do $t$begin
    begin perform pg_temp.insight();raise exception 'missing uid insight';exception when invalid_authorization_specification then null;end;
    begin perform pg_temp.feedback();raise exception 'missing uid feedback';exception when invalid_authorization_specification then null;end;
    begin perform public.list_blabee_feedback();raise exception 'missing uid list';exception when invalid_authorization_specification then null;end;
    begin perform public.delete_blabee_feedback(gen_random_uuid());raise exception 'missing uid delete';exception when invalid_authorization_specification then null;end;
    begin perform public.record_blabee_subscription_event('stripe','evt_1',gen_random_uuid(),'started',now(),'none');
        raise exception 'client billing accepted';exception when insufficient_privilege then null;end;
    raise notice 'PASS: all client RPCs require auth.uid and authenticated clients cannot write billing';
end;$t$;
reset role;
set local request.jwt.claim.sub='d912fa00-0000-4000-8000-000000000001';
set local role authenticated;
do $t$begin
    if not pg_temp.insight('{"event_id":"01000000-0000-4000-8000-000000000001"}')
        or pg_temp.insight('{"event_id":"01000000-0000-4000-8000-000000000001","codex_version":"0.155.0"}')
    then raise exception 'Authenticated insight or immutable ID dedup failed';end if;
    perform pg_temp.feedback('{"submission_id":"02000000-0000-4000-8000-000000000001"}');
    if (select count(*) from public.list_blabee_feedback())<>1 then raise exception 'Own list missing';end if;
    begin perform * from blabee_analytics.feedback_submissions;raise exception 'Direct content read accepted';
        exception when insufficient_privilege then null;end;
    raise notice 'PASS: authenticated insight/feedback and own summary work without direct table access';
end;$t$;
reset role;

do $t$begin
    if pg_temp.insight() or not pg_temp.insight('{"connection_mode":"managed","compatibility":"unqualified"}')
        or not pg_temp.insight(jsonb_build_object('occurred_at',now()-interval '24 hours'))
    then raise exception 'Connection user/date/environment dedup wrong';end if;
    if (select count(*) from blabee_analytics.connection_observation_days)<>3
        or (select accepted_count from blabee_analytics.insight_ingest_days
            where user_id='d912fa00-0000-4000-8000-000000000001')<>4
    then raise exception 'Connection group count or receipt quota incorrect';end if;
    raise notice 'PASS: connection observations deduplicate by UTC day and fixed environment';
end;$t$;

do $t$
declare v_card jsonb:=jsonb_build_object('metric_kind','card_presented','card_id','03000000-0000-4000-8000-000000000001',
    'card_kind','suggestion','codex_version','unknown','connection_mode','none','compatibility','none',
    'occurred_at',now()-interval '24 hours');
begin
    if not pg_temp.insight(v_card) or pg_temp.insight(v_card)
        or not pg_temp.insight(v_card||'{"metric_kind":"card_responded","response":"selected","reaction_bucket":"under_5s"}')
        or pg_temp.insight(v_card||'{"metric_kind":"card_responded","response":"dismissed","reaction_bucket":"over_30s"}')
        or pg_temp.insight(v_card)
    then raise exception 'Card first-response/dedup/reopen incorrect';end if;
    if (select sum(card_count) from blabee_analytics.card_observation_days)<>1
        or (select sum(card_count) from blabee_analytics.card_observation_days where response='selected')<>1
        or exists(select 1 from blabee_analytics.card_observation_days where response='none')
    then raise exception 'Response moved exposure denominator';end if;
    raise notice 'PASS: card exposure moves once to first response, duplicate/conflicting responses cannot mutate it';
end;$t$;

do $t$
declare v_card jsonb:='{"metric_kind":"card_responded","card_id":"03000000-0000-4000-8000-000000000002",
    "card_kind":"approval","codex_version":"unknown","connection_mode":"none","compatibility":"none",
    "response":"denied","reaction_bucket":"unknown"}';
    v_delta jsonb;v_before bigint:=(select count(*) from blabee_analytics.insight_event_receipts);
begin
    if not pg_temp.insight(v_card)
        or pg_temp.insight(v_card||'{"metric_kind":"card_presented","response":"none","reaction_bucket":"none"}')
    then raise exception 'Response-first did not count one exposure';end if;
    v_before:=(select count(*) from blabee_analytics.insight_event_receipts);
    for v_delta in select value from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('occurred_at',now()-interval '24 hours'),
        '{"app_build":"57"}'::jsonb,'{"app_version":"2"}'::jsonb,'{"os_major":"16"}'::jsonb,
        '{"ui_language":"en"}'::jsonb,'{"card_kind":"suggestion","response":"selected"}'::jsonb
    )) loop
        begin perform pg_temp.insight(v_card||v_delta);raise exception 'Card dimensions changed';
            exception when invalid_parameter_value then null;end;
    end loop;
    if (select sum(card_count) from blabee_analytics.card_observation_days)<>2
        or (select count(*) from blabee_analytics.insight_event_receipts)<>v_before
    then raise exception 'Response-first or rejected dimension change corrupted state';end if;
    raise notice 'PASS: response-before-presentation counts one exposure; original date/environment immutable with rollback';
end;$t$;

do $t$
declare v_bad jsonb;v_key text;
begin
    foreach v_key in array array['event_id','occurred_at','metric_kind','card_kind','response','reaction_bucket',
        'app_version','app_build','os_major','ui_language','codex_version','connection_mode','compatibility'] loop
        begin perform pg_temp.insight(jsonb_build_object(v_key,null));raise exception 'NULL insight accepted';
            exception when invalid_parameter_value then null;end;
    end loop;
    for v_bad in select value from jsonb_array_elements(jsonb_build_array(
        '{"codex_version":"/private/session"}'::jsonb,'{"app_build":"raw output"}'::jsonb,
        '{"os_major":"15.6"}'::jsonb,'{"ui_language":"ko-KR"}'::jsonb,
        '{"compatibility":"full log"}'::jsonb,'{"connection_mode":"shell command"}'::jsonb,
        '{"card_id":"03000000-0000-4000-8000-000000000003"}'::jsonb,
        '{"occurred_at":"infinity"}'::jsonb,
        jsonb_build_object('occurred_at',now()-interval '168 hours 1 second'),
        jsonb_build_object('occurred_at',now()+interval '5 minutes 1 second'),
        '{"metric_kind":"card_presented","card_id":"03000000-0000-4000-8000-000000000003","card_kind":"suggestion"}'::jsonb,
        '{"metric_kind":"card_responded","card_id":"03000000-0000-4000-8000-000000000003","card_kind":"suggestion","codex_version":"unknown","connection_mode":"none","compatibility":"none","response":"approved","reaction_bucket":"under_5s"}'::jsonb
    )) loop
        begin perform pg_temp.insight(v_bad);raise exception 'Invalid insight shape accepted';
            exception when invalid_parameter_value then null;end;
    end loop;
    raise notice 'PASS: automatic insight NULL/time/enum/shape checks reject raw data and cross-kind response fields';
end;$t$;

do $t$
declare v_id uuid:='02000000-0000-4000-8000-000000000001';
begin
    if pg_temp.feedback(jsonb_build_object('submission_id',v_id))<>v_id then raise exception 'Retry changed ID';end if;
    begin perform pg_temp.feedback(jsonb_build_object('submission_id',v_id,'rating','unhelpful'));
        raise exception 'Conflicting payload accepted';exception when invalid_parameter_value then
            if sqlerrm<>'Feedback submission identifier conflict' then raise;end if;end;
    if (select accepted_count from blabee_analytics.feedback_ingest_days
        where user_id='d912fa00-0000-4000-8000-000000000001')<>1
        or (select rating from blabee_analytics.feedback_submissions where submission_id=v_id)<>'helpful'
    then raise exception 'Retry consumed quota or mutated body';end if;
    perform pg_temp.feedback('{"submission_id":"02000000-0000-4000-8000-000000000002","question":"explicit sample question","answer":"explicit sample answer","suggestion":"explicit sample suggestion","note":"explicit note","content_consent":true}');
    perform pg_temp.feedback('{"submission_id":"02000000-0000-4000-8000-000000000003","rating":"none","use_purpose":"debugging"}');
    if (select count(*) from public.list_blabee_feedback() where has_content)<>1
        or (select count(*) from public.list_blabee_feedback())<>3
    then raise exception 'Summary content flag or purpose-only submission incorrect';end if;
    raise notice 'PASS: immutable submission retries, quota preservation, explicit content and purpose-only feedback';
end;$t$;

do $t$
declare v_bad jsonb;v_key text;v_before bigint:=(select count(*) from blabee_analytics.feedback_submissions);
begin
    foreach v_key in array array['submission_id','rating','reason','use_purpose','question','answer','suggestion','note',
        'content_consent','policy_version','app_version','app_build','os_major','ui_language'] loop
        begin perform pg_temp.feedback(jsonb_build_object(v_key,null));raise exception 'NULL feedback accepted';
            exception when invalid_parameter_value then null;end;
    end loop;
    for v_bad in select value from jsonb_array_elements(jsonb_build_array(
        '{"rating":"none"}'::jsonb,'{"rating":"none","reason":"next_step_clear"}'::jsonb,
        '{"reason":"irrelevant"}'::jsonb,'{"rating":"unhelpful","reason":"easier_action"}'::jsonb,
        '{"use_purpose":"project path"}'::jsonb,'{"question":"private without consent"}'::jsonb,
        '{"answer":"private without consent"}'::jsonb,'{"suggestion":"private without consent"}'::jsonb,
        '{"note":"private without consent"}'::jsonb,'{"policy_version":2}'::jsonb,
        '{"app_version":"/user/path"}'::jsonb,'{"os_major":"15.6"}'::jsonb,'{"ui_language":"country"}'::jsonb,
        jsonb_build_object('question',repeat('가',2667),'content_consent',true),
        jsonb_build_object('answer',repeat('a',8001),'content_consent',true),
        jsonb_build_object('suggestion',repeat('a',8001),'content_consent',true),
        jsonb_build_object('note',repeat('a',2001),'content_consent',true)
    )) loop
        begin perform pg_temp.feedback(v_bad);raise exception 'Invalid feedback accepted';
            exception when invalid_parameter_value then null;end;
    end loop;
    if (select count(*) from blabee_analytics.feedback_submissions)<>v_before then raise exception 'Invalid feedback left body';end if;
    perform pg_temp.feedback(jsonb_build_object('question',repeat('😀',2000),'note',repeat('a',2000),'content_consent',true));
    raise notice 'PASS: feedback NULL/enum/reason/consent/empty checks and UTF-8 byte boundaries';
end;$t$;

set local request.jwt.claim.sub='d912fa00-0000-4000-8000-000000000002';
do $t$begin
    if exists(select 1 from public.list_blabee_feedback())
        or public.delete_blabee_feedback('02000000-0000-4000-8000-000000000002')
    then raise exception 'Cross-user list/delete leaked account';end if;
    perform pg_temp.feedback('{"submission_id":"02000000-0000-4000-8000-000000000001","use_purpose":"learning"}');
    if (select count(*) from public.list_blabee_feedback())<>1 then raise exception 'Per-user UUID scope lost';end if;
    if not pg_temp.insight('{"event_id":"01000000-0000-4000-8000-000000000001"}') then raise exception 'Insight ID leaked across users';end if;
    raise notice 'PASS: list/delete are own-only and receipt/submission UUIDs are user scoped';
end;$t$;

set local request.jwt.claim.sub='d912fa00-0000-4000-8000-000000000001';
do $t$
declare v_quota integer:=(select accepted_count from blabee_analytics.feedback_ingest_days
    where user_id='d912fa00-0000-4000-8000-000000000001');
begin
    if not public.delete_blabee_feedback('02000000-0000-4000-8000-000000000001')
        or public.delete_blabee_feedback('02000000-0000-4000-8000-000000000001')
        or public.delete_blabee_feedback(gen_random_uuid())
    then raise exception 'Delete result contract incorrect';end if;
    begin perform pg_temp.feedback('{"submission_id":"02000000-0000-4000-8000-000000000001"}');
        raise exception 'Deleted retry resurrected feedback';exception when invalid_parameter_value then
            if sqlerrm<>'Feedback submission no longer available' then raise;end if;end;
    if (select accepted_count from blabee_analytics.feedback_ingest_days
        where user_id='d912fa00-0000-4000-8000-000000000001')<>v_quota
        or exists(select 1 from blabee_analytics.feedback_submissions
            where user_id='d912fa00-0000-4000-8000-000000000001' and submission_id='02000000-0000-4000-8000-000000000001')
        or not exists(select 1 from blabee_analytics.feedback_receipts
            where user_id='d912fa00-0000-4000-8000-000000000001' and submission_id='02000000-0000-4000-8000-000000000001'
                and unavailable_at=now() and tombstone_until=now()+interval '744 hours'
                and payload_hash ~ '^[0-9a-f]{64}$')
    then raise exception 'Deletion erased quota or failed bounded tombstone';end if;
    raise notice 'PASS: immediate own deletion, hash tombstone, no quota refund and deleted-retry suppression';
end;$t$;

set local request.jwt.claim.sub='d912fa00-0000-4000-8000-000000000003';
do $t$
declare v_i integer;v_existing uuid;v_count bigint;
begin
    for v_i in 1..1000 loop perform pg_temp.insight();end loop;
    if pg_temp.insight('{"codex_version":"0.155.0"}')
        or (select count(*) from blabee_analytics.insight_event_receipts where user_id=auth.uid())<>1000
    then raise exception 'Insight receipt cap failed';end if;
    for v_i in 1..10 loop v_existing:=pg_temp.feedback();end loop;
    if pg_temp.feedback(jsonb_build_object('submission_id',v_existing))<>v_existing then raise exception 'Retry denied at quota';end if;
    perform public.delete_blabee_feedback(v_existing);
    begin perform pg_temp.feedback();raise exception using errcode='22023',message='Feedback cap absent';
        exception when raise_exception then if sqlerrm<>'Feedback daily limit reached' then raise;end if;end;
    if (select accepted_count from blabee_analytics.feedback_ingest_days where user_id=auth.uid())<>10
        or (select count(*) from blabee_analytics.feedback_submissions where user_id=auth.uid())<>9
    then raise exception 'Feedback cap/deletion quota incorrect';end if;
    raise notice 'PASS: 1000 insight and 10 submission caps; retry at cap allowed, delete never refunds quota';
end;$t$;

set local request.jwt.claim.sub='d912fa00-0000-4000-8000-000000000001';
do $t$
declare v_count bigint;
begin
    update blabee_analytics.feedback_receipts set received_at=now()-interval '720 hours',expires_at=now()
        where user_id=auth.uid() and submission_id='02000000-0000-4000-8000-000000000003';
    update blabee_analytics.feedback_submissions set received_at=now()-interval '720 hours',expires_at=now()
        where user_id=auth.uid() and submission_id='02000000-0000-4000-8000-000000000003';
    if exists(select 1 from public.list_blabee_feedback() where submission_id='02000000-0000-4000-8000-000000000003')
    then raise exception 'Expired content listed before cleanup';end if;
    begin perform pg_temp.feedback('{"submission_id":"02000000-0000-4000-8000-000000000003","rating":"none","use_purpose":"debugging"}');
        raise exception 'Expired retry accepted';exception when invalid_parameter_value then null;end;
    update blabee_analytics.insight_event_receipts set received_at=now()-interval '192 hours 1 second'
        where user_id=auth.uid();
    update blabee_analytics.card_observation_receipts set first_received_at=now()-interval '192 hours 1 second'
        where user_id=auth.uid();
    insert into blabee_analytics.insight_event_receipts values(auth.uid(),'09000000-0000-4000-8000-000000000001',now()-interval '192 hours');
    perform blabee_analytics.prune_feedback_data();
    if exists(select 1 from blabee_analytics.feedback_submissions
        where user_id=auth.uid() and submission_id='02000000-0000-4000-8000-000000000003')
        or not exists(select 1 from blabee_analytics.feedback_receipts
            where user_id=auth.uid() and submission_id='02000000-0000-4000-8000-000000000003'
                and unavailable_at=now() and tombstone_until=now()+interval '744 hours')
        or (select count(*) from blabee_analytics.insight_event_receipts where user_id=auth.uid())<>1
        or exists(select 1 from blabee_analytics.card_observation_receipts where user_id=auth.uid())
        or (select sum(card_count) from blabee_analytics.card_observation_days where user_id=auth.uid())<>2
    then raise exception 'Expiry or 8-day receipt cleanup damaged durable aggregates';end if;
    update blabee_analytics.feedback_receipts set unavailable_at=now()-interval '744 hours',tombstone_until=now()
        where user_id=auth.uid() and submission_id='02000000-0000-4000-8000-000000000001';
    perform blabee_analytics.prune_feedback_data();
    if exists(select 1 from blabee_analytics.feedback_receipts
        where user_id=auth.uid() and submission_id='02000000-0000-4000-8000-000000000001')
    then raise exception 'Expired 31-day tombstone retained';end if;
    raise notice 'PASS: logical 30-day expiry, 31-day tombstone cleanup and 8-day insight-state retention preserve aggregates';
end;$t$;

set local role service_role;
do $t$begin
    if not public.record_blabee_subscription_event('stripe','evt_1','d912fa00-0000-4000-8000-000000000001','started',now(),'none')
        or public.record_blabee_subscription_event('stripe','evt_1','d912fa00-0000-4000-8000-000000000001','started',now(),'none')
    then raise exception 'Verified server billing dedup failed';end if;
    perform public.record_blabee_subscription_event('stripe','evt_2','d912fa00-0000-4000-8000-000000000001','renewed',now(),'none');
    perform public.record_blabee_subscription_event('stripe','evt_3','d912fa00-0000-4000-8000-000000000001','cancellation_scheduled',now(),'too_expensive');
    perform public.record_blabee_subscription_event('stripe','evt_4','d912fa00-0000-4000-8000-000000000001','ended',now(),'not_using');
    perform public.record_blabee_subscription_event('paddle','evt_1','d912fa00-0000-4000-8000-000000000002','started',now(),'none');
    begin perform public.record_blabee_subscription_event('stripe','evt_1','d912fa00-0000-4000-8000-000000000002','started',now(),'none');
        raise exception 'Conflicting billing user accepted';exception when invalid_parameter_value then null;end;
    begin perform pg_temp.feedback();raise exception 'service-role user feedback accepted';exception when insufficient_privilege then null;end;
    begin perform * from blabee_analytics.subscription_events;raise exception 'Direct server billing read accepted';
        exception when insufficient_privilege then null;end;
    raise notice 'PASS: service-role billing only, provider/event idempotence, conflict rejection and no direct table grant';
end;$t$;
reset role;

do $t$
declare v_reason text;
begin
    begin perform public.record_blabee_subscription_event('stripe','raw content / path','d912fa00-0000-4000-8000-000000000001','started',now(),'none');
        raise exception 'Unbounded provider ID accepted';exception when invalid_parameter_value then null;end;
    begin perform public.record_blabee_subscription_event('stripe','evt_bad','d912fa00-0000-4000-8000-000000000001','started',now(),'too_expensive');
        raise exception 'Reason on start accepted';exception when invalid_parameter_value then null;end;
    begin perform public.record_blabee_subscription_event('stripe','evt_bad','d912fa00-0000-4000-8000-000000000001','ended','infinity','none');
        raise exception 'Infinite billing time accepted';exception when invalid_parameter_value then null;end;
    begin perform public.record_blabee_subscription_event('stripe','evt_bad','d912fa00-0000-4000-8000-000000000001','ended',now()+interval '5 minutes 1 second','none');
        raise exception 'Future billing time accepted';exception when invalid_parameter_value then null;end;
    if (select count(*) from blabee_analytics.subscription_events)<>5 then raise exception 'Invalid billing left data';end if;
    raise notice 'PASS: bounded billing IDs/reasons/times; lifecycle events stay independent';
end;$t$;

set local request.jwt.claim.sub='d912fa00-0000-4000-8000-000000000004';
insert into blabee_analytics.feedback_receipts(user_id,submission_id,payload_hash,received_at,expires_at)
select auth.uid(),md5('bounded-list-'||i)::uuid,repeat('0',64),now()-make_interval(secs=>i),now()-make_interval(secs=>i)+interval '720 hours'
from generate_series(1,321) as n(i);
insert into blabee_analytics.feedback_submissions
select user_id,submission_id,received_at,expires_at,'helpful','none','none','','','','',false,1,'1','56','15','ko'
from blabee_analytics.feedback_receipts where user_id=auth.uid();
do $t$begin
    if (select count(*) from public.list_blabee_feedback())<>320
        or exists(select 1 from public.list_blabee_feedback() where submission_id=md5('bounded-list-321')::uuid)
    then raise exception 'List limit/order incorrect';end if;
    raise notice 'PASS: own summary returns newest 320 and no content fields';
end;$t$;

do $t$
declare v_table regclass;v_count bigint;
begin
    delete from auth.users where id::text like 'd912fa00-0000-4000-8000-%';
    foreach v_table in array array[
        'blabee_analytics.insight_event_receipts'::regclass,'blabee_analytics.insight_ingest_days'::regclass,
        'blabee_analytics.connection_observation_days'::regclass,'blabee_analytics.card_observation_receipts'::regclass,
        'blabee_analytics.card_observation_days'::regclass,'blabee_analytics.feedback_receipts'::regclass,
        'blabee_analytics.feedback_submissions'::regclass,'blabee_analytics.feedback_ingest_days'::regclass,
        'blabee_analytics.subscription_events'::regclass
    ] loop execute format('select count(*) from %s',v_table) into v_count;
        if v_count<>0 then raise exception 'Account deletion left % rows',v_table;end if;end loop;
    raise notice 'PASS: all insight/feedback/tombstone/billing data cascades on account deletion';
end;$t$;
rollback;

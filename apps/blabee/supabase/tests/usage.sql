-- Run AFTER the migration in a disposable Supabase/local PostgreSQL database,
-- as its trusted owner. Requires auth.users, auth.uid(), anon/authenticated roles.
-- Example: psql --no-psqlrc --set ON_ERROR_STOP=1 --file supabase/tests/usage.sql
-- Every fixture and temporary privilege change is rolled back. No pgTAP needed.
-- Unique keys + atomic UPSERT are checked here; a single connection is not a
-- concurrent-session load test.
begin;
set local timezone = 'Asia/Seoul';

insert into auth.users (id, email, created_at, updated_at) values
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760001', 'usage-one@example.invalid', now(), now()),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760002', 'usage-two@example.invalid', now(), now()),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760003', 'usage-three@example.invalid', now(), now());

do $test$
begin
    if not exists (
        select 1 from pg_catalog.pg_proc
        where oid = 'public.record_blabee_usage(uuid,text,timestamptz)'::regprocedure
            and prosecdef and proconfig @> array['search_path=""']
    ) then
        raise exception 'RPC must use SECURITY DEFINER with an empty search path';
    end if;
    if exists (
        select 1 from pg_catalog.pg_class
        where oid in (
            'blabee_analytics.event_receipts'::regclass,
            'blabee_analytics.daily_activity'::regclass
        ) and not relrowsecurity
    ) then
        raise exception 'Private tables must retain RLS';
    end if;
    if (
        select count(*) from pg_catalog.pg_constraint
        where contype = 'p' and (
            (conrelid = 'blabee_analytics.event_receipts'::regclass
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, event_id)')
            or (conrelid = 'blabee_analytics.daily_activity'::regclass
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, activity_date, event_kind)')
        )
    ) <> 2 then
        raise exception 'Unique keys must serialize event retries and daily upserts';
    end if;
    raise notice 'PASS: RPC security settings, RLS, and concurrency keys';
end;
$test$;

set local role anon;
do $test$
begin
    begin
        perform public.record_blabee_usage(
            '00000000-0000-4000-8000-000000000001', 'choice_accepted', now()
        );
        raise exception 'Anonymous RPC call unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
    raise notice 'PASS: anonymous execution denied';
end;
$test$;
reset role;

set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"authenticated"}';
set local role authenticated;
do $test$
begin
    begin
        perform public.record_blabee_usage(
            '00000000-0000-4000-8000-000000000001', 'choice_accepted', now()
        );
        raise exception 'Missing auth.uid unexpectedly accepted';
    exception when invalid_authorization_specification then null;
    end;
    raise notice 'PASS: authenticated role without a user rejected';
end;
$test$;
reset role;

set local request.jwt.claim.sub = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001';
set local request.jwt.claims = '{"sub":"fc2edbb0-bf7c-4cd3-8bce-657dd6760001","role":"authenticated"}';
set local role authenticated;
do $test$
declare
    v_midnight timestamptz :=
        ((now() at time zone 'UTC')::date - 1)::timestamp at time zone 'UTC';
begin
    if public.record_blabee_usage('00000000-0000-4000-8000-000000000001',
        'choice_accepted', v_midnight - interval '1 second') is not true then
        raise exception 'First event was not recorded';
    end if;
    if public.record_blabee_usage('00000000-0000-4000-8000-000000000001',
        'choice_accepted', v_midnight - interval '1 second') is not false then
        raise exception 'Identical retry was not deduplicated';
    end if;
    if public.record_blabee_usage('00000000-0000-4000-8000-000000000001',
        'approval_resolved', now()) is not false then
        raise exception 'Changed retry payload evaded event-ID deduplication';
    end if;
    -- Deliberately out of order: first/last must come from event time, not arrival.
    perform public.record_blabee_usage('00000000-0000-4000-8000-000000000003',
        'choice_accepted', v_midnight + interval '1 minute');
    perform public.record_blabee_usage('00000000-0000-4000-8000-000000000002',
        'choice_accepted', v_midnight);
    perform public.record_blabee_usage('00000000-0000-4000-8000-000000000004',
        'approval_resolved', v_midnight + interval '2 minutes');
    perform public.record_blabee_usage('00000000-0000-4000-8000-000000000005',
        'suggestion_dismissed', v_midnight + interval '3 minutes');
    raise notice 'PASS: authenticated recording and idempotent retry results';
end;
$test$;
reset role;

do $test$
declare
    v_midnight timestamptz :=
        ((now() at time zone 'UTC')::date - 1)::timestamp at time zone 'UTC';
    v_total numeric;
    v_days bigint;
    v_first timestamptz;
    v_last timestamptz;
begin
    select sum(action_count), count(distinct activity_date), min(first_used_at), max(last_used_at)
    into v_total, v_days, v_first, v_last
    from blabee_analytics.daily_activity
    where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001';
    if v_total is distinct from 5::numeric or v_days <> 2
        or v_first is distinct from v_midnight - interval '1 second'
        or v_last is distinct from v_midnight + interval '3 minutes'
    then
        raise exception 'UTC day counts, deduplication, or first/last event time incorrect';
    end if;
    if not exists (
        select 1 from blabee_analytics.daily_activity
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001'
            and activity_date = (v_midnight at time zone 'UTC')::date
            and event_kind = 'choice_accepted' and action_count = 2
            and first_used_at = v_midnight and last_used_at = v_midnight + interval '1 minute'
    ) then
        raise exception 'Same-day increment or out-of-order timestamp merge incorrect';
    end if;
    if (select count(*) from blabee_analytics.event_receipts
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001') <> 5 then
        raise exception 'Duplicate receipt changed receipt count';
    end if;
    raise notice 'PASS: UTC midnight, exact aggregates, and out-of-order times';
end;
$test$;

set local request.jwt.claim.sub = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760002';
set local request.jwt.claims = '{"sub":"fc2edbb0-bf7c-4cd3-8bce-657dd6760002","role":"authenticated"}';
set local role authenticated;
do $test$
declare
    v_sql text;
    v_time timestamptz;
    v_kind text;
begin
    if public.record_blabee_usage('00000000-0000-4000-8000-000000000001',
        'choice_accepted', now()) is not true then
        raise exception 'Another user incorrectly shared a deduplication key';
    end if;
    foreach v_sql in array array[
        'select * from blabee_analytics.daily_activity',
        'select * from blabee_analytics.event_receipts',
        'insert into blabee_analytics.event_receipts (user_id,event_id) values
            (''fc2edbb0-bf7c-4cd3-8bce-657dd6760001'',''00000000-0000-4000-8000-000000000099'')',
        'update blabee_analytics.daily_activity set action_count = 1000
            where user_id = ''fc2edbb0-bf7c-4cd3-8bce-657dd6760001''',
        'delete from blabee_analytics.daily_activity
            where user_id = ''fc2edbb0-bf7c-4cd3-8bce-657dd6760001''',
        'select blabee_analytics.prune_usage_event_receipts()'
    ] loop
        begin
            execute v_sql;
            raise exception 'Direct client read/write/maintenance unexpectedly succeeded';
        exception when insufficient_privilege then null;
        end;
    end loop;
    foreach v_kind in array array[null::text, '', 'app_opened', 'CHOICE_ACCEPTED'] loop
        begin
            perform public.record_blabee_usage('00000000-0000-4000-8000-000000000020', v_kind, now());
            raise exception 'Unknown or null event kind accepted';
        exception when invalid_parameter_value then null;
        end;
    end loop;
    foreach v_time in array array[
        null::timestamptz, 'infinity'::timestamptz, '-infinity'::timestamptz,
        now() - interval '168 hours 1 microsecond',
        now() + interval '5 minutes 1 microsecond'
    ] loop
        begin
            perform public.record_blabee_usage('00000000-0000-4000-8000-000000000020',
                'choice_accepted', v_time);
            raise exception 'Out-of-range, null, or nonfinite time accepted';
        exception when invalid_parameter_value then null;
        end;
    end loop;
    begin
        perform public.record_blabee_usage(null, 'choice_accepted', now());
        raise exception 'Null event ID accepted';
    exception when invalid_parameter_value then null;
    end;
    -- Inclusive timestamp limits are deliberately exercised in this transaction.
    if public.record_blabee_usage('00000000-0000-4000-8000-000000000021',
        'approval_resolved', now() - interval '168 hours') is not true
        or public.record_blabee_usage('00000000-0000-4000-8000-000000000022',
        'approval_resolved', now() + interval '5 minutes') is not true
    then
        raise exception 'Inclusive timestamp limits rejected';
    end if;
    raise notice 'PASS: user-scoped IDs, direct-access denial, and timestamp/input bounds';
end;
$test$;
reset role;

do $test$
begin
    if (select count(*) from blabee_analytics.event_receipts
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760002') <> 3
        or (select sum(action_count) from blabee_analytics.daily_activity
            where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760002') <> 3
        or (select sum(action_count) from blabee_analytics.daily_activity
            where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001') <> 5
    then
        raise exception 'Invalid input mutated tables or another user was modified';
    end if;
    raise notice 'PASS: rejected inputs leave no receipts or aggregate mutations';
end;
$test$;

-- Exercise RLS itself even if table grants are accidentally added in the future.
grant usage on schema blabee_analytics to authenticated;
grant select, insert, update, delete on all tables in schema blabee_analytics to authenticated;
set local role authenticated;
do $test$
declare
    v_rows bigint;
begin
    if exists (select 1 from blabee_analytics.daily_activity)
        or exists (select 1 from blabee_analytics.event_receipts) then
        raise exception 'RLS leaked analytics after a table grant';
    end if;
    update blabee_analytics.daily_activity set action_count = 1000;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'RLS allowed a direct update'; end if;
    delete from blabee_analytics.event_receipts;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then raise exception 'RLS allowed a direct delete'; end if;
    begin
        insert into blabee_analytics.event_receipts (user_id, event_id)
        values ('fc2edbb0-bf7c-4cd3-8bce-657dd6760002', '00000000-0000-4000-8000-000000000099');
        raise exception 'RLS allowed a direct insert';
    exception when insufficient_privilege then null;
    end;
    begin
        perform blabee_analytics.prune_usage_event_receipts();
        raise exception 'Maintenance function granted client execution';
    exception when insufficient_privilege then null;
    end;
    raise notice 'PASS: RLS and maintenance ACL remain effective with accidental table grants';
end;
$test$;
reset role;
revoke all on all tables in schema blabee_analytics from authenticated;
revoke all on schema blabee_analytics from authenticated;

-- An aggregate write failure must roll back the receipt in the same RPC.
insert into blabee_analytics.daily_activity
    (user_id, activity_date, event_kind, action_count, first_used_at, last_used_at)
values ('fc2edbb0-bf7c-4cd3-8bce-657dd6760003', (now() at time zone 'UTC')::date,
    'choice_accepted', 9223372036854775807, now(), now());
set local request.jwt.claim.sub = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760003';
set local request.jwt.claims = '{"sub":"fc2edbb0-bf7c-4cd3-8bce-657dd6760003","role":"authenticated"}';
set local role authenticated;
do $test$
begin
    begin
        perform public.record_blabee_usage('00000000-0000-4000-8000-000000000030',
            'choice_accepted', now());
        raise exception 'Expected aggregate overflow did not occur';
    exception when numeric_value_out_of_range then null;
    end;
    perform public.record_blabee_usage('00000000-0000-4000-8000-000000000031',
        'suggestion_dismissed', now());
end;
$test$;
reset role;
do $test$
begin
    if exists (select 1 from blabee_analytics.event_receipts
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760003'
            and event_id = '00000000-0000-4000-8000-000000000030') then
        raise exception 'Failed aggregate update left a receipt that prevents retry';
    end if;
    if (select count(*) from blabee_analytics.event_receipts
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760003') <> 1 then
        raise exception 'Expected a receipt before account deletion';
    end if;
    delete from auth.users where id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760003';
    if exists (select 1 from blabee_analytics.event_receipts
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760003')
        or exists (select 1 from blabee_analytics.daily_activity
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760003') then
        raise exception 'Account deletion did not cascade to both analytics tables';
    end if;
    raise notice 'PASS: RPC failure atomicity and account deletion cascade';
end;
$test$;

insert into blabee_analytics.event_receipts (user_id, event_id, received_at) values
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760001', '00000000-0000-4000-8000-000000000041', now() - interval '192 hours 1 microsecond'),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760001', '00000000-0000-4000-8000-000000000042', now() - interval '192 hours'),
    ('fc2edbb0-bf7c-4cd3-8bce-657dd6760001', '00000000-0000-4000-8000-000000000043', now() - interval '191 hours');
do $test$
begin
    perform blabee_analytics.prune_usage_event_receipts();
    if exists (select 1 from blabee_analytics.event_receipts
        where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001'
            and event_id = '00000000-0000-4000-8000-000000000041')
        or (select count(*) from blabee_analytics.event_receipts
            where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001'
                and event_id in ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000043')) <> 2
        or (select sum(action_count) from blabee_analytics.daily_activity
            where user_id = 'fc2edbb0-bf7c-4cd3-8bce-657dd6760001') <> 5
    then
        raise exception 'Pruning must remove only receipts older than eight days, preserving aggregates';
    end if;
    raise notice 'PASS: strict eight-day receipt pruning without aggregate loss';
end;
$test$;

rollback;

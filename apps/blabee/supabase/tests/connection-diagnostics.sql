-- Run only against a disposable database after the connection upgrade.
begin;
insert into auth.users (id,email) values
 ('a943920f-ef2b-4c53-9924-e7f10d200081','connection-test@example.invalid'),
 ('a943920f-ef2b-4c53-9924-e7f10d200082','connection-other@example.invalid');

do $test$
declare
 f regprocedure := 'public.record_blabee_connection_error(uuid,timestamptz,text,text,text,text,text,text,text)'::regprocedure;
begin
 if not exists (select 1 from pg_proc where oid=f and prosecdef and proconfig @> array['search_path=""'])
    or has_function_privilege('anon',f,'execute') or has_function_privilege('service_role',f,'execute')
    or not has_function_privilege('authenticated',f,'execute') then
   raise exception 'connection RPC privilege boundary invalid';
 end if;
 if not (select relrowsecurity from pg_class where oid='blabee_analytics.error_events'::regclass)
    or exists (select 1 from pg_policy where polrelid='blabee_analytics.error_events'::regclass) then
   raise exception 'private error RLS changed';
 end if;
end;
$test$;

set local role anon;
do $test$
begin
 begin
   perform public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude','configuration','settings_conflict','unknown');
   raise exception 'anonymous ingestion allowed';
 exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
set local request.jwt.claim.sub = '';
set local role authenticated;
do $test$
begin
 begin
   perform public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude','configuration','settings_conflict','unknown');
   raise exception 'unauthenticated ingestion allowed';
 exception when invalid_authorization_specification then null; end;
end;
$test$;
reset role;
set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200081';
set local role authenticated;
do $test$
declare v text;
begin
 if public.record_blabee_connection_error('00000000-0000-4000-8000-000000000081',now(),'0.1.0','70','26.5','codex','native_executable','executable_unsafe','0.156.1') is not true
 or public.record_blabee_connection_error('00000000-0000-4000-8000-000000000081',now(),'0.1.0','70','26.5','claude','configuration','settings_conflict','unknown') is not false
 or public.record_blabee_error('00000000-0000-4000-8000-000000000081','app_service_failed',now(),'0.1.0','70','26.5') is not false
 or public.record_blabee_error('00000000-0000-4000-8000-000000000082','app_service_failed',now(),'0.1.0','70','26.5') is not true
 then raise exception 'legacy compatibility or shared idempotency failed'; end if;
 foreach v in array array['/Users/private/token','secret message','',null] loop
   begin
     perform public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5',v,'configuration','settings_conflict','unknown');
     raise exception 'unsafe provider accepted';
   exception when invalid_parameter_value then null; end;
   begin
     perform public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude',v,'settings_conflict','unknown');
     raise exception 'unsafe stage accepted';
   exception when invalid_parameter_value then null; end;
   begin
     perform public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude','configuration',v,'unknown');
     raise exception 'unsafe reason accepted';
   exception when invalid_parameter_value then null; end;
   begin
     perform public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude','configuration','settings_conflict',v);
     raise exception 'unsafe tool version accepted';
   exception when invalid_parameter_value then null; end;
 end loop;
 begin
   perform public.record_blabee_connection_error(gen_random_uuid(),now()-interval '8 days','0.1.0','70','26.5','claude','transport','connection_lost','unknown');
   raise exception 'expired time accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform 1 from blabee_analytics.error_events;
   raise exception 'client read allowed';
 exception when insufficient_privilege then null; end;
end;
$test$;
reset role;

do $test$
begin
 if (select accepted_count from blabee_analytics.error_ingest_days where user_id='a943920f-ef2b-4c53-9924-e7f10d200081') <> 2 then
   raise exception 'duplicate or invalid inputs consumed quota';
 end if;
 if not exists(select 1 from blabee_analytics.error_events where event_id='00000000-0000-4000-8000-000000000081'
   and connection_provider='codex' and connection_stage='native_executable' and connection_reason='executable_unsafe' and tool_version='0.156.1') then
   raise exception 'context changed on duplicate';
 end if;
 update blabee_analytics.error_ingest_days set accepted_count=199 where user_id='a943920f-ef2b-4c53-9924-e7f10d200081';
end;
$test$;
set local role authenticated;
do $test$
begin
 if public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude','configuration','settings_conflict','unknown') is not true
 or public.record_blabee_error(gen_random_uuid(),'app_service_failed',now(),'0.1.0','70','26.5') is not false
 or public.record_blabee_connection_error(gen_random_uuid(),now(),'0.1.0','70','26.5','claude','configuration','settings_conflict','unknown') is not false
 then raise exception 'shared 200/day quota broken'; end if;
end;
$test$;
reset role;

set local request.jwt.claim.sub = 'a943920f-ef2b-4c53-9924-e7f10d200082';
set local role authenticated;
select public.record_blabee_connection_error('00000000-0000-4000-8000-000000000081',now(),'0.1.0','70','26.5','claude','configuration','settings_conflict','unknown');
reset role;
do $test$
begin
 if (select count(*) from blabee_analytics.error_events where event_id='00000000-0000-4000-8000-000000000081') <> 2 then
   raise exception 'different accounts do not have independent event IDs';
 end if;
 update blabee_analytics.error_events set received_at=now()-interval '31 days'
 where user_id='a943920f-ef2b-4c53-9924-e7f10d200082';
 if blabee_analytics.prune_error_events() <> 1 then raise exception 'connection retention failed'; end if;
 delete from auth.users where id='a943920f-ef2b-4c53-9924-e7f10d200081';
 if exists(select 1 from blabee_analytics.error_events where user_id='a943920f-ef2b-4c53-9924-e7f10d200081') then
   raise exception 'account deletion did not cascade';
 end if;
end;
$test$;
rollback;

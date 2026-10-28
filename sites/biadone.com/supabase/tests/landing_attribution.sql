-- Isolated database only, after both site migrations. All fixtures roll back.
begin;

do $test$
declare
  normalized jsonb;
  role_name text;
  rpc_name text;
begin
  normalized := blabee_marketing.normalize_attribution('{"utm_source":" X ","utm_medium":"SOCIAL","utm_campaign":"mac-beta","utm_content":"post-1","referrer_host":"T.CO","email":"ignored@example.invalid","url":"https://ignored.example/private?token=secret"}');
  if normalized <> '{"source":"x","source_type":"utm","medium":"social","campaign":"mac-beta","content":"post-1","referrer_host":"t.co"}'::jsonb then
    raise exception 'Incorrect tag normalization or extra data retained: %', normalized;
  end if;
  if blabee_marketing.normalize_attribution('{"referrer_host":"news.ycombinator.com"}') ->> 'source_type' <> 'referrer' then
    raise exception 'Referrer fallback failed';
  end if;
  if blabee_marketing.normalize_attribution('{"utm_source":"person@example.com","utm_campaign":"https://private.example/path","referrer_host":"https://private.example/path?secret=yes"}') ->> 'source' <> 'direct_or_unknown' then
    raise exception 'Full URL or email accepted as campaign metadata';
  end if;
  if blabee_marketing.normalize_attribution('{"referrer_host":"127.0.0.1"}') ->> 'referrer_host' <> ''
     or blabee_marketing.normalize_attribution('{"referrer_host":"www.biadone.com"}') ->> 'referrer_host' <> ''
     or blabee_marketing.normalize_attribution('{"referrer_host":"host.local"}') ->> 'referrer_host' <> ''
     or blabee_marketing.normalize_attribution('{"referrer_host":"host.localhost"}') ->> 'referrer_host' <> '' then
    raise exception 'Private or self referral accepted';
  end if;
  if blabee_marketing.normalize_attribution(jsonb_build_object('utm_source', repeat('a', 81))) ->> 'source' <> 'direct_or_unknown'
     or blabee_marketing.normalize_attribution('{"utm_source":123,"utm_content":{"secret":true}}') ->> 'content' <> ''
     or blabee_marketing.normalize_attribution('["invalid"]') ->> 'source_type' <> 'unknown' then
    raise exception 'Invalid or excessive campaign input retained';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'blabee_marketing.landing_daily_views'::regclass) then
    raise exception 'View counters require RLS';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(role_name, 'blabee_marketing', 'USAGE')
       or has_table_privilege(role_name, 'blabee_marketing.landing_daily_views', 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege(role_name, 'blabee_marketing.beta_requests', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Direct access unexpectedly allowed for %', role_name;
    end if;
  end loop;
  foreach rpc_name in array array['public.record_blabee_landing_view(jsonb)', 'public.request_blabee_beta_tracked(text,jsonb)'] loop
    if not exists (select 1 from pg_proc where oid = rpc_name::regprocedure and prosecdef and proconfig @> array['search_path=""']) then
      raise exception 'Unsafe RPC definition: %', rpc_name;
    end if;
    if has_function_privilege('service_role', rpc_name, 'EXECUTE') then
      raise exception 'Unexpected service-role grant';
    end if;
  end loop;
end;
$test$;

set local role anon;
select public.record_blabee_landing_view('{"utm_source":"x","utm_medium":"social","utm_campaign":"mac-beta"}');
select public.record_blabee_landing_view('{"utm_campaign":"mac-beta","utm_source":"X","utm_medium":"social","ignored":"not-stored"}');
select public.record_blabee_landing_view('{"referrer_host":"reddit.com"}');
select public.record_blabee_landing_view('{}');
select public.request_blabee_beta('legacy@example.invalid');
select public.request_blabee_beta_tracked(' TRACKED@Example.invalid ', '{"utm_source":"x","utm_medium":"social","utm_campaign":"mac-beta"}');
select public.request_blabee_beta_tracked('opted-out@example.invalid');
do $test$
begin
  if public.request_blabee_beta_tracked('tracked@example.invalid', '{"utm_source":"reddit"}') <> '{"accepted":true}'::jsonb then
    raise exception 'Duplicate response changed';
  end if;
  perform public.request_blabee_beta_tracked('legacy@example.invalid', '{"utm_source":"x"}');
  begin
    perform public.request_blabee_beta_tracked('invalid', '{}');
    raise exception 'Invalid email accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform views from blabee_marketing.landing_daily_views;
    raise exception 'Public counter read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;

do $test$
begin
  if (select sum(views) from blabee_marketing.landing_daily_views) <> 4
     or (select count(*) from blabee_marketing.landing_daily_views) <> 3
     or (select views from blabee_marketing.landing_daily_views where attribution ->> 'source' = 'x') <> 2 then
    raise exception 'Daily aggregation lost or split equivalent page views';
  end if;
  if exists (select 1 from blabee_marketing.landing_daily_views where day <> (now() at time zone 'UTC')::date) then
    raise exception 'View day is not server UTC day';
  end if;
  if (select count(*) from blabee_marketing.beta_requests) <> 3
     or (select attribution ->> 'source' from blabee_marketing.beta_requests where email = 'tracked@example.invalid') <> 'x'
     or exists (select 1 from blabee_marketing.beta_requests where email in ('legacy@example.invalid', 'opted-out@example.invalid') and attribution is not null) then
    raise exception 'Duplicate, first-source, legacy, or opt-out contract failed';
  end if;
end;
$test$;

update blabee_marketing.beta_requests set created_at = '2026-01-01T00:00:00Z' where email = 'tracked@example.invalid';
set local role authenticated;
select public.request_blabee_beta_tracked('tracked@example.invalid', '{"utm_source":"different"}');
select public.request_blabee_beta_tracked('no-view@example.invalid', '{"utm_source":"newsletter"}');
reset role;
do $test$
begin
  if (select created_at from blabee_marketing.beta_requests where email = 'tracked@example.invalid') <> '2026-01-01T00:00:00Z'::timestamptz then
    raise exception 'Duplicate changed timestamp';
  end if;
  if not exists (select 1 from blabee_marketing.beta_requests where email = 'no-view@example.invalid' and attribution ->> 'source' = 'newsletter') then
    raise exception 'Signup must work independently of page-view ingestion';
  end if;
end;
$test$;

grant usage on schema blabee_marketing to anon;
grant select on blabee_marketing.landing_daily_views, blabee_marketing.beta_requests to anon;
set local role anon;
do $test$
begin
  if (select count(*) from blabee_marketing.landing_daily_views) <> 0
     or (select count(*) from blabee_marketing.beta_requests) <> 0 then
    raise exception 'RLS exposed source or applicant data';
  end if;
end;
$test$;
reset role;
rollback;

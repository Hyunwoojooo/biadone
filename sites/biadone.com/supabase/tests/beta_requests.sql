-- Run after this site's migration in an isolated PostgreSQL database.
-- The fixtures and temporary grants are rolled back. No customer rows are read.
begin;

do $test$
declare
  client_role text;
begin
  if not (select relrowsecurity from pg_class where oid = 'blabee_marketing.beta_requests'::regclass) then
    raise exception 'RLS is required';
  end if;
  if not exists (
    select 1 from pg_proc where oid = 'public.request_blabee_beta(text)'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']
  ) then
    raise exception 'RPC must use a fixed empty search path';
  end if;
  foreach client_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(client_role, 'blabee_marketing', 'USAGE')
       or has_table_privilege(client_role, 'blabee_marketing.beta_requests', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Direct table access for % must be denied', client_role;
    end if;
  end loop;
end;
$test$;

set local role anon;
do $test$
declare
  invalid_email text;
begin
  if public.request_blabee_beta(' Beta.Test+1@Example.invalid ') <> '{"accepted":true}'::jsonb then
    raise exception 'Anonymous registration failed';
  end if;
  if public.request_blabee_beta('beta.test+1@example.invalid') <> '{"accepted":true}'::jsonb then
    raise exception 'Duplicate must have the same acknowledgement';
  end if;
  foreach invalid_email in array array[
    null, '', '  ', 'invalid', 'user@', '@example.com', 'user@localhost',
    'user@example..com', 'user@-example.com', 'user@example-.com',
    E'user\n@example.com', E'user@example.com\r\nBcc: someone@example.com',
    repeat('x', 250) || '@example.com'
  ] loop
    begin
      perform public.request_blabee_beta(invalid_email);
      raise exception 'Invalid email accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform email from blabee_marketing.beta_requests;
    raise exception 'Anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into blabee_marketing.beta_requests(email) values ('direct@example.invalid');
    raise exception 'Anonymous direct insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;

do $test$
begin
  if (select count(*) from blabee_marketing.beta_requests) <> 1 then
    raise exception 'Retries or invalid inputs created extra rows';
  end if;
  if not exists (select 1 from blabee_marketing.beta_requests where email = 'beta.test+1@example.invalid') then
    raise exception 'Stored email was not normalized';
  end if;
end;
$test$;

update blabee_marketing.beta_requests set created_at = '2026-01-01T00:00:00Z';
set local role authenticated;
select public.request_blabee_beta('BETA.TEST+1@example.invalid');
select public.request_blabee_beta('signed-in@example.invalid');
reset role;

do $test$
begin
  if (select created_at from blabee_marketing.beta_requests where email = 'beta.test+1@example.invalid')
     <> '2026-01-01T00:00:00Z'::timestamptz then
    raise exception 'Duplicate changed original request time';
  end if;
  if (select count(*) from blabee_marketing.beta_requests) <> 2 then
    raise exception 'Authenticated caller failed or duplicated data';
  end if;
end;
$test$;

-- RLS still hides rows even if table SELECT were mistakenly granted later.
grant usage on schema blabee_marketing to anon;
grant select on blabee_marketing.beta_requests to anon;
set local role anon;
do $test$
begin
  if (select count(*) from blabee_marketing.beta_requests) <> 0 then
    raise exception 'RLS exposed private email rows';
  end if;
end;
$test$;
reset role;

rollback;

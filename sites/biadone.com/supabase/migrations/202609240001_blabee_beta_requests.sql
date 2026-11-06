-- Blabee landing-page beta requests. Apply once as the trusted database owner.
-- This migration is independent of the app's analytics migrations.
begin;

create schema blabee_marketing;
revoke all on schema blabee_marketing from public, anon, authenticated, service_role;

create table blabee_marketing.beta_requests (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint beta_requests_normalized_email check (
    email = lower(btrim(email))
    and octet_length(email) between 3 and 254
    and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  )
);

alter table blabee_marketing.beta_requests enable row level security;
revoke all on table blabee_marketing.beta_requests from public, anon, authenticated, service_role;

comment on table blabee_marketing.beta_requests is
  'Blabee beta access requests. Email is normalized; duplicates preserve the first request time. No Auth account is created.';

create function public.request_blabee_beta(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
begin
  if normalized_email is null
     or octet_length(normalized_email) not between 3 and 254
     or normalized_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception using errcode = '22023', message = 'Invalid email address';
  end if;

  insert into blabee_marketing.beta_requests (email)
  values (normalized_email)
  on conflict (email) do nothing;

  -- The same response for new and duplicate requests avoids revealing membership.
  return '{"accepted": true}'::jsonb;
end;
$$;

revoke all on function public.request_blabee_beta(text) from public, anon, authenticated, service_role;
grant execute on function public.request_blabee_beta(text) to anon, authenticated;

comment on function public.request_blabee_beta(text) is
  'Public email-only beta request. No email list, account creation, or outbound email. Duplicate submissions are idempotent.';

notify pgrst, 'reload schema';
commit;

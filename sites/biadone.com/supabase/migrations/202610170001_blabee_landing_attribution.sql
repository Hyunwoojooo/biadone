-- Add referral measurement without changing the existing email-only RPC.
begin;

create function blabee_marketing.normalize_attribution(p_attribution jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  input jsonb := case when jsonb_typeof(p_attribution) = 'object' then p_attribution else '{}'::jsonb end;
  tags jsonb := '{}'::jsonb;
  tag text;
  value text;
  referrer_host text;
  source text;
  source_type text;
begin
  foreach tag in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] loop
    value := lower(btrim(coalesce(input ->> tag, '')));
    if jsonb_typeof(input -> tag) is distinct from 'string'
       or octet_length(value) > 80 or value !~ '^[a-z0-9][a-z0-9._-]{0,79}$' then
      value := '';
    end if;
    tags := tags || jsonb_build_object(tag, value);
  end loop;

  referrer_host := lower(btrim(coalesce(input ->> 'referrer_host', '')));
  if jsonb_typeof(input -> 'referrer_host') is distinct from 'string'
     or octet_length(referrer_host) > 253
     or referrer_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
     or referrer_host ~ '^[0-9.]+$'
     or referrer_host in ('biadone.com', 'www.biadone.com')
     or referrer_host ~ '[.](localhost|local|internal)$' then
    referrer_host := '';
  end if;

  source := tags ->> 'utm_source';
  source_type := 'utm';
  if source = '' then
    source := referrer_host;
    source_type := 'referrer';
  end if;
  if source = '' then
    source := 'direct_or_unknown';
    source_type := 'unknown';
  end if;

  return jsonb_build_object(
    'source', source, 'source_type', source_type,
    'medium', coalesce(nullif(tags ->> 'utm_medium', ''), case when source_type = 'referrer' then 'referral' else 'unknown' end),
    'campaign', tags ->> 'utm_campaign', 'content', tags ->> 'utm_content',
    'referrer_host', referrer_host
  );
end;
$$;
revoke all on function blabee_marketing.normalize_attribution(jsonb) from public, anon, authenticated, service_role;

create table blabee_marketing.landing_daily_views (
  day date not null,
  attribution jsonb not null,
  views bigint not null default 1 check (views > 0),
  primary key (day, attribution)
);
alter table blabee_marketing.landing_daily_views enable row level security;
revoke all on table blabee_marketing.landing_daily_views from public, anon, authenticated, service_role;
comment on table blabee_marketing.landing_daily_views is
  'UTC daily landing page-view counters by allowlisted campaign tags/referrer hostname. No visitor ID, IP, full URL, or per-visitor event history. Reloads count as new views.';

alter table blabee_marketing.beta_requests add column attribution jsonb;
create index beta_requests_attribution_created_at_idx on blabee_marketing.beta_requests (created_at);
comment on column blabee_marketing.beta_requests.attribution is
  'Referral metadata for the first successful signup. NULL means unmeasured (legacy client, before tracking, or privacy opt-out), not a direct visit. Never overwritten by duplicate requests.';

create function public.record_blabee_landing_view(p_attribution jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into blabee_marketing.landing_daily_views (day, attribution)
  values ((now() at time zone 'UTC')::date, blabee_marketing.normalize_attribution(p_attribution))
  on conflict (day, attribution) do update
  set views = blabee_marketing.landing_daily_views.views + 1;
  return '{"accepted": true}'::jsonb;
end;
$$;
revoke all on function public.record_blabee_landing_view(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_blabee_landing_view(jsonb) to anon, authenticated;
comment on function public.record_blabee_landing_view(jsonb) is
  'Increment a daily page-view counter. Call once per visible page load; no automatic retries or unique-visitor claims. Campaign fields are untrusted browser reports.';

create function public.request_blabee_beta_tracked(p_email text, p_attribution jsonb default null)
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

  insert into blabee_marketing.beta_requests (email, attribution)
  values (normalized_email, case when p_attribution is null then null else blabee_marketing.normalize_attribution(p_attribution) end)
  on conflict (email) do nothing;
  return '{"accepted": true}'::jsonb;
end;
$$;
revoke all on function public.request_blabee_beta_tracked(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.request_blabee_beta_tracked(text, jsonb) to anon, authenticated;
comment on function public.request_blabee_beta_tracked(text, jsonb) is
  'Email-only beta signup with optional first-signup referral metadata. No new/duplicate distinction in the response; no dependency on analytics ingestion.';

notify pgrst, 'reload schema';
commit;

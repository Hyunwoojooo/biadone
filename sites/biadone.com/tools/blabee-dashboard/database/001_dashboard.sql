-- Dashboard-only objects. Review and apply as the trusted database owner.
-- This file never alters or grants access to blabee_marketing source objects.
-- The empty allowlist deliberately denies every user until separate enrollment.
begin;

create schema blabee_dashboard;
revoke all on schema blabee_dashboard from public, anon, authenticated, service_role;

-- Match JavaScript's UTF-16 string limits, including supplementary characters.
create function blabee_dashboard.utf16_length(p_value text)
returns integer language sql immutable strict set search_path = '' as $$
  select (length(p_value) + count(*) filter (where ascii(c) > 65535))::integer
  from regexp_split_to_table(p_value, '') as chars(c);
$$;
revoke all on function blabee_dashboard.utf16_length(text) from public, anon, authenticated, service_role;

create table blabee_dashboard.owner_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enrolled_at timestamptz not null default now()
);

-- UTC, end-exclusive bounds verified out of band by the database owner.
-- Keep empty when collection completeness is unknown. Query success is not
-- evidence of collection health; today's missing rows never become zero.
create table blabee_dashboard.source_bounds (
  metric text primary key check (metric in ('page_views', 'new_beta_requests')),
  verified_start_day date not null,
  verified_end_day date not null,
  evidence_note text not null check (length(btrim(evidence_note)) between 1 and 1000),
  verified_at timestamptz not null default now(),
  check (verified_start_day < verified_end_day)
);

create table blabee_dashboard.posts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  title text not null check (blabee_dashboard.utf16_length(btrim(title)) between 1 and 200),
  url text not null check (blabee_dashboard.utf16_length(url) <= 2048 and url ~* '^https?://[^/[:space:]?#@]+([/?#][^[:space:]]*)?$'),
  published_at timestamptz not null,
  published_offset_minutes integer not null check (published_offset_minutes between -840 and 840),
  content_format text check (blabee_dashboard.utf16_length(content_format) <= 80),
  link_placement text check (blabee_dashboard.utf16_length(link_placement) <= 80),
  notes text check (blabee_dashboard.utf16_length(notes) <= 4000),
  external_refs jsonb not null default '{}'::jsonb check (jsonb_typeof(external_refs) = 'object'),
  source text check (source ~ '^([a-z0-9][a-z0-9._-]{0,79})?$'),
  medium text check (medium ~ '^([a-z0-9][a-z0-9._-]{0,79})?$'),
  campaign text check (campaign ~ '^([a-z0-9][a-z0-9._-]{0,79})?$'),
  content text check (content ~ '^([a-z0-9][a-z0-9._-]{0,79})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source is null and medium is null and campaign is null and content is null)
      or (source is not null and medium is not null and campaign is not null and content is not null))
);
create index dashboard_posts_published_at_idx on blabee_dashboard.posts (published_at desc, id);

alter table blabee_dashboard.owner_allowlist enable row level security;
alter table blabee_dashboard.source_bounds enable row level security;
alter table blabee_dashboard.posts enable row level security;
revoke all on all tables in schema blabee_dashboard from public, anon, authenticated, service_role;
alter default privileges in schema blabee_dashboard revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema blabee_dashboard revoke execute on functions from public, anon, authenticated, service_role;

create function blabee_dashboard.require_owner()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from blabee_dashboard.owner_allowlist where user_id = (select auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'Dashboard owner access required';
  end if;
end;
$$;
revoke all on function blabee_dashboard.require_owner() from public, anon, authenticated, service_role;

create function public.blabee_dashboard_overview(p_start_day date, p_end_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today_utc date := (now() at time zone 'UTC')::date;
  view_rows jsonb := '[]'::jsonb;
  signup_rows jsonb := '[]'::jsonb;
  daily_rows jsonb;
  views_available boolean := false;
  signups_available boolean := false;
  signup_attribution boolean := false;
  view_bounds blabee_dashboard.source_bounds%rowtype;
  signup_bounds blabee_dashboard.source_bounds%rowtype;
  coverage jsonb := '{}'::jsonb;
  metric text;
  available boolean;
  bounds_start date;
  bounds_end date;
  coverage_status text;
begin
  perform blabee_dashboard.require_owner();
  if p_start_day is null or p_end_day is null
     or p_end_day <= p_start_day or p_end_day - p_start_day > 90
     or p_end_day > today_utc + 1 then
    raise exception using errcode = '22023', message = 'Expected an end-exclusive UTC date range of 1 to 90 days, ending no later than tomorrow';
  end if;

  select * into view_bounds from blabee_dashboard.source_bounds where source_bounds.metric = 'page_views';
  select * into signup_bounds from blabee_dashboard.source_bounds where source_bounds.metric = 'new_beta_requests';

  -- Dynamic SQL allows the dashboard to be installed before the independent
  -- tracking work. Missing source objects yield unavailable, never false zero.
  if to_regclass('blabee_marketing.landing_daily_views') is not null then
    begin
      execute $query$
        select coalesce(jsonb_agg(jsonb_build_object('day', day, 'attribution', attribution, 'page_views', page_views)), '[]'::jsonb)
        from (
          select day, attribution, sum(views)::bigint as page_views
          from blabee_marketing.landing_daily_views
          where day >= $1 and day < $2
          group by day, attribution
        ) observations
      $query$ into view_rows using p_start_day, p_end_day;
      views_available := true;
    exception when undefined_table or undefined_column or invalid_schema_name then
      views_available := false;
    end;
  end if;

  if to_regclass('blabee_marketing.beta_requests') is not null then
    select exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('blabee_marketing.beta_requests')
        and attname = 'attribution' and attnum > 0 and not attisdropped
    ) into signup_attribution;
    begin
      execute format($query$
        select coalesce(jsonb_agg(jsonb_build_object('day', day, 'attribution', attribution, 'new_beta_requests', new_beta_requests)), '[]'::jsonb)
        from (
          select (created_at at time zone 'UTC')::date as day,
            %s as attribution, count(*)::bigint as new_beta_requests
          from blabee_marketing.beta_requests
          where created_at >= ($1::timestamp at time zone 'UTC')
            and created_at < ($2::timestamp at time zone 'UTC')
          group by 1, 2
        ) observations
      $query$, case when signup_attribution
        then 'coalesce(attribution, ''{"source":"unmeasured","source_type":"unmeasured","medium":"","campaign":"","content":"","referrer_host":""}''::jsonb)'
        else '''{"source":"unmeasured","source_type":"unmeasured","medium":"","campaign":"","content":"","referrer_host":""}''::jsonb'
      end) into signup_rows using p_start_day, p_end_day;
      signups_available := true;
    exception when undefined_table or undefined_column or invalid_schema_name then
      signups_available := false;
      signup_attribution := false;
    end;
  end if;

  with views as (
    select * from jsonb_to_recordset(view_rows) as v(day date, attribution jsonb, page_views bigint)
  ), signups as (
    select * from jsonb_to_recordset(signup_rows) as s(day date, attribution jsonb, new_beta_requests bigint)
  ), keys as (
    select day, attribution from views union select day, attribution from signups
  ), days as (
    select p_start_day + n as day from generate_series(0, p_end_day - p_start_day - 1) n
  )
  select jsonb_agg(jsonb_build_object(
    'day', days.day,
    'attribution', keys.attribution,
    'page_views', case when views.page_views is not null then views.page_views
      when views_available and days.day < today_utc
        and days.day >= view_bounds.verified_start_day and days.day < view_bounds.verified_end_day then 0 else null end,
    'new_beta_requests', case when signups.new_beta_requests is not null then signups.new_beta_requests
      when signups_available and days.day < today_utc
        and days.day >= signup_bounds.verified_start_day and days.day < signup_bounds.verified_end_day then 0 else null end
  ) order by days.day, keys.attribution::text) into daily_rows
  from days left join keys on keys.day = days.day
  left join views on views.day = days.day and views.attribution = keys.attribution
  left join signups on signups.day = days.day and signups.attribution = keys.attribution;

  foreach metric in array array['page_views', 'new_beta_requests'] loop
    available := case when metric = 'page_views' then views_available else signups_available end;
    bounds_start := case when metric = 'page_views' then view_bounds.verified_start_day else signup_bounds.verified_start_day end;
    bounds_end := case when metric = 'page_views' then view_bounds.verified_end_day else signup_bounds.verified_end_day end;
    coverage_status := case
      when not available then 'unavailable'
      when bounds_start is null then 'unverified'
      when p_start_day >= bounds_start and p_end_day <= bounds_end and p_end_day <= today_utc then 'verified'
      when bounds_start < p_end_day and bounds_end > p_start_day then 'partial'
      else 'unverified' end;
    coverage := coverage || jsonb_build_object(metric, jsonb_build_object(
      'available', available, 'status', coverage_status,
      'verified_start_day', bounds_start, 'verified_end_day', bounds_end,
      'collector_status', 'unknown'
    ));
  end loop;

  return jsonb_build_object(
    'version', 1, 'generated_at', now(), 'timezone', 'UTC',
    'range', jsonb_build_object('start_day', p_start_day, 'end_day', p_end_day),
    'scope', jsonb_build_object('id', 'blabee_landings_combined', 'label', 'Blabee 랜딩 합산'),
    'daily', daily_rows, 'coverage', coverage,
    'capabilities', jsonb_build_object('daily_page_views', views_available, 'daily_beta_requests', signups_available,
      'signup_attribution', signup_attribution, 'hourly', false, 'sessions', false, 'conversion_rate', false)
  );
end;
$$;
revoke all on function public.blabee_dashboard_overview(date, date) from public, anon, authenticated, service_role;
grant execute on function public.blabee_dashboard_overview(date, date) to authenticated;

create function public.blabee_dashboard_posts(p_action text default 'list', p_post jsonb default null, p_post_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  post_row blabee_dashboard.posts%rowtype;
  payload jsonb;
  key text;
  value jsonb;
  stamp text;
  offset_text text;
  offset_minutes integer;
  published timestamptz;
  refs jsonb;
  rows_json jsonb;
begin
  perform blabee_dashboard.require_owner();
  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.published_at desc, p.id), '[]'::jsonb)
      into rows_json from blabee_dashboard.posts p;
    return jsonb_build_object('posts', rows_json);
  end if;
  if p_action not in ('create', 'update', 'delete') or p_action is null then
    raise exception using errcode = '22023', message = 'Unsupported post action';
  end if;
  if p_action in ('update', 'delete') then
    if p_post_id is null then
      raise exception using errcode = '22023', message = 'Post ID required';
    end if;
    select * into post_row from blabee_dashboard.posts where id = p_post_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Post not found';
    end if;
  end if;
  if p_action = 'delete' then
    delete from blabee_dashboard.posts where id = p_post_id;
    return jsonb_build_object('deleted', true, 'id', p_post_id);
  end if;
  if p_post is null or jsonb_typeof(p_post) <> 'object' then
    raise exception using errcode = '22023', message = 'Post object required';
  end if;
  for key, value in select * from jsonb_each(p_post) loop
    if key not in ('channel', 'title', 'url', 'published_at', 'published_offset_minutes', 'content_format', 'link_placement', 'notes', 'external_refs', 'source', 'medium', 'campaign', 'content') then
      raise exception using errcode = '22023', message = 'Unsupported post field';
    end if;
    if key not in ('external_refs', 'published_offset_minutes') and jsonb_typeof(value) not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'Post text fields must be strings';
    end if;
  end loop;
  payload := case when p_action = 'update' then to_jsonb(post_row) else '{}'::jsonb end || p_post;
  if payload ->> 'channel' is null or payload ->> 'channel' !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
    or payload ->> 'title' is null or blabee_dashboard.utf16_length(btrim(payload ->> 'title')) not between 1 and 200
    or btrim(payload ->> 'title', U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = ''
    or payload ->> 'url' is null or blabee_dashboard.utf16_length(payload ->> 'url') > 2048
    or payload ->> 'url' !~* '^https?://[^/[:space:]?#@]+([/?#][^[:space:]]*)?$' then
    raise exception using errcode = '22023', message = 'Invalid post channel, title, or HTTP(S) URL';
  end if;
  foreach key in array array['title', 'url', 'content_format', 'link_placement', 'notes', 'source', 'medium', 'campaign', 'content'] loop
    if payload ->> key ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
       or (key <> 'notes' and payload ->> key ~ E'[\r\n]') then
      raise exception using errcode = '22023', message = 'Post text contains unsupported control characters';
    end if;
    if key in ('content_format', 'link_placement', 'notes', 'source', 'medium', 'campaign', 'content')
       and blabee_dashboard.utf16_length(payload ->> key) > (case when key = 'notes' then 4000 else 80 end) then
      raise exception using errcode = '22023', message = 'Post field exceeds length limit';
    end if;
    if key in ('source', 'medium', 'campaign', 'content') and payload ->> key !~ '^([a-z0-9][a-z0-9._-]{0,79})?$' then
      raise exception using errcode = '22023', message = 'Invalid explicit post mapping';
    end if;
  end loop;
  if num_nonnulls(payload ->> 'source', payload ->> 'medium', payload ->> 'campaign', payload ->> 'content') not in (0, 4) then
    raise exception using errcode = '22023', message = 'Explicit post mapping requires source, medium, campaign, and content together';
  end if;
  refs := coalesce(nullif(payload -> 'external_refs', 'null'::jsonb), '{}'::jsonb);
  if jsonb_typeof(refs) <> 'object' then
    raise exception using errcode = '22023', message = 'External references must be an object';
  end if;
  if (select count(*) from jsonb_object_keys(refs)) > 10 then
    raise exception using errcode = '22023', message = 'At most 10 external references allowed';
  end if;
  for key, value in select * from jsonb_each(refs) loop
    if key !~ '^[A-Za-z0-9_.-]{1,80}$' or jsonb_typeof(value) <> 'string'
       or blabee_dashboard.utf16_length(value #>> '{}') > 500 or value #>> '{}' ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
      raise exception using errcode = '22023', message = 'Invalid external reference';
    end if;
  end loop;
  stamp := payload ->> 'published_at';
  -- Updates without a new timestamp preserve the offset recorded on creation.
  if p_action = 'update' and not (p_post ? 'published_at') then
    published := post_row.published_at;
    offset_minutes := post_row.published_offset_minutes;
  else
    if stamp is null or stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode = '22023', message = 'Published time must be RFC3339 with an explicit UTC offset';
    end if;
    offset_text := substring(stamp from '(Z|[+-][0-9]{2}:[0-9]{2})$');
    offset_minutes := case when offset_text = 'Z' then 0 else
      (substring(offset_text from 2 for 2)::integer * 60 + substring(offset_text from 5 for 2)::integer)
      * case when left(offset_text, 1) = '-' then -1 else 1 end end;
    if abs(offset_minutes) > 840 or (offset_text <> 'Z' and substring(offset_text from 5 for 2)::integer > 59) then
      raise exception using errcode = '22023', message = 'Invalid published time offset';
    end if;
    begin
      published := stamp::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Invalid published time';
    end;
  end if;
  if p_post ? 'published_offset_minutes' and (jsonb_typeof(p_post -> 'published_offset_minutes') <> 'number'
    or (p_post ->> 'published_offset_minutes') !~ '^-?[0-9]+$'
    or (p_post ->> 'published_offset_minutes')::numeric <> offset_minutes) then
    raise exception using errcode = '22023', message = 'Published offset must match the supplied timestamp';
  end if;

  if p_action = 'create' then
    insert into blabee_dashboard.posts (channel, title, url, published_at, published_offset_minutes, content_format, link_placement, notes, external_refs, source, medium, campaign, content)
    values (payload ->> 'channel', btrim(payload ->> 'title'), payload ->> 'url', published, offset_minutes,
      payload ->> 'content_format', payload ->> 'link_placement', payload ->> 'notes', refs,
      payload ->> 'source', payload ->> 'medium', payload ->> 'campaign', payload ->> 'content') returning * into post_row;
  else
    update blabee_dashboard.posts set
      channel = payload ->> 'channel', title = btrim(payload ->> 'title'), url = payload ->> 'url',
      published_at = published, published_offset_minutes = offset_minutes,
      content_format = payload ->> 'content_format', link_placement = payload ->> 'link_placement', notes = payload ->> 'notes',
      external_refs = refs, source = payload ->> 'source', medium = payload ->> 'medium', campaign = payload ->> 'campaign', content = payload ->> 'content', updated_at = now()
    where id = p_post_id returning * into post_row;
  end if;
  return jsonb_build_object('post', to_jsonb(post_row));
end;
$$;
revoke all on function public.blabee_dashboard_posts(text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.blabee_dashboard_posts(text, jsonb, uuid) to authenticated;

comment on table blabee_dashboard.posts is 'Owner-maintained promotion registry only. Deletion never deletes source measurements. Mapping values are opaque references; no tracking links or UTM values are generated.';
comment on table blabee_dashboard.source_bounds is 'Trusted owner evidence for UTC collection completeness only, end exclusive. Empty by default. Collector health remains unknown.';
comment on function public.blabee_dashboard_overview(date, date) is 'Owner-only read of UTC daily Blabee landing aggregates. No raw signup identities. Missing source or unverified gaps remain unknown.';
notify pgrst, 'reload schema';
commit;

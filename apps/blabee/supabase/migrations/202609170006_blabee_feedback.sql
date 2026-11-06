-- Apply as postgres after product metrics migration 202609170004.
-- Fixed opt-in observations, explicit user-submitted feedback, and future
-- verified-server billing observations. No entitlement writes or raw auto logs.
begin;

create table blabee_analytics.insight_event_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    event_id uuid not null, received_at timestamptz not null,
    primary key(user_id,event_id), check(pg_catalog.isfinite(received_at))
);
create index insight_event_receipts_time_idx on blabee_analytics.insight_event_receipts(received_at);
create table blabee_analytics.insight_ingest_days (
    user_id uuid not null references auth.users(id) on delete cascade,
    received_date date not null, accepted_count integer not null,
    primary key(user_id,received_date),
    check(pg_catalog.isfinite(received_date)), check(accepted_count between 0 and 1000)
);
create index insight_ingest_days_date_idx on blabee_analytics.insight_ingest_days(received_date);
create table blabee_analytics.connection_observation_days (
    user_id uuid not null references auth.users(id) on delete cascade,
    observed_date date not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    codex_version blabee_analytics.product_version not null,
    connection_mode text not null check(connection_mode in ('plugin','managed','unknown')),
    compatibility text not null check(compatibility in ('qualified','unqualified','unknown')),
    primary key(user_id,observed_date,app_version,app_build,os_major,ui_language,
        codex_version,connection_mode,compatibility),
    check(pg_catalog.isfinite(observed_date))
);
create index connection_observation_days_date_idx
    on blabee_analytics.connection_observation_days(observed_date,user_id);

-- card_id is a newly random analytics ID, never a source card/session/project ID.
create table blabee_analytics.card_observation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    card_id uuid not null, first_received_at timestamptz not null,
    observed_date date not null, card_kind text not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    response text not null, reaction_bucket text not null,
    primary key(user_id,card_id),
    check(pg_catalog.isfinite(first_received_at) and pg_catalog.isfinite(observed_date)),
    check(card_kind in ('suggestion','approval') and (
        (response = 'none' and reaction_bucket = 'none')
        or (reaction_bucket in ('under_5s','5_to_30s','over_30s','unknown') and
            ((card_kind = 'suggestion' and response in ('selected','dismissed'))
                or (card_kind = 'approval' and response in ('approved','denied'))))))
);
create index card_observation_receipts_time_idx
    on blabee_analytics.card_observation_receipts(first_received_at);
create table blabee_analytics.card_observation_days (
    user_id uuid not null references auth.users(id) on delete cascade,
    observed_date date not null, card_kind text not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    response text not null, reaction_bucket text not null, card_count bigint not null,
    primary key(user_id,observed_date,card_kind,app_version,app_build,os_major,ui_language,response,reaction_bucket),
    check(pg_catalog.isfinite(observed_date)), check(card_count >= 0),
    check(card_kind in ('suggestion','approval') and (
        (response = 'none' and reaction_bucket = 'none')
        or (reaction_bucket in ('under_5s','5_to_30s','over_30s','unknown') and
            ((card_kind = 'suggestion' and response in ('selected','dismissed'))
                or (card_kind = 'approval' and response in ('approved','denied'))))))
);
create index card_observation_days_date_idx on blabee_analytics.card_observation_days(observed_date,user_id);

-- Receipts retain only a SHA-256 payload fingerprint once content is removed.
-- Tombstones suppress recreation for 31 days after deletion or logical expiry.
create table blabee_analytics.feedback_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    submission_id uuid not null, payload_hash text not null,
    received_at timestamptz not null, expires_at timestamptz not null,
    unavailable_at timestamptz, tombstone_until timestamptz,
    primary key(user_id,submission_id),
    check(payload_hash ~ '^[0-9a-f]{64}$'),
    check(pg_catalog.isfinite(received_at) and pg_catalog.isfinite(expires_at)
        and expires_at = received_at + interval '720 hours'),
    check((unavailable_at is null and tombstone_until is null)
        or (unavailable_at is not null and tombstone_until is not null
            and pg_catalog.isfinite(unavailable_at) and pg_catalog.isfinite(tombstone_until)
            and tombstone_until = unavailable_at + interval '744 hours'))
);
create index feedback_receipts_expiry_idx on blabee_analytics.feedback_receipts(expires_at);
create index feedback_receipts_tombstone_idx on blabee_analytics.feedback_receipts(tombstone_until)
    where tombstone_until is not null;
create table blabee_analytics.feedback_submissions (
    user_id uuid not null references auth.users(id) on delete cascade,
    submission_id uuid not null, received_at timestamptz not null, expires_at timestamptz not null,
    rating text not null, reason text not null, use_purpose text not null,
    question text not null, answer text not null, suggestion text not null, note text not null,
    content_consent boolean not null, policy_version integer not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    primary key(user_id,submission_id),
    foreign key(user_id,submission_id) references blabee_analytics.feedback_receipts(user_id,submission_id) on delete cascade,
    check(pg_catalog.isfinite(received_at) and pg_catalog.isfinite(expires_at)
        and expires_at = received_at + interval '720 hours'),
    check(rating in ('none','helpful','unhelpful') and
        (reason = 'none' or (rating = 'helpful' and reason in ('next_step_clear','easier_action'))
            or (rating = 'unhelpful' and reason in ('irrelevant','already_done','repetitive','did_not_work')))),
    check(use_purpose in ('none','development','debugging','writing','learning','other')),
    check(pg_catalog.octet_length(question) <= 8000 and pg_catalog.octet_length(answer) <= 8000
        and pg_catalog.octet_length(suggestion) <= 8000 and pg_catalog.octet_length(note) <= 2000),
    check(policy_version = 1),
    check(content_consent or (question = '' and answer = '' and suggestion = '' and note = '')),
    check(rating <> 'none' or use_purpose <> 'none'
        or pg_catalog.btrim(question || answer || suggestion || note) <> '')
);
create index feedback_submissions_expiry_idx on blabee_analytics.feedback_submissions(expires_at);
create index feedback_submissions_user_time_idx on blabee_analytics.feedback_submissions(user_id,received_at desc,submission_id desc);
create table blabee_analytics.feedback_ingest_days (
    user_id uuid not null references auth.users(id) on delete cascade,
    received_date date not null, accepted_count integer not null,
    primary key(user_id,received_date),
    check(pg_catalog.isfinite(received_date)), check(accepted_count between 0 and 10)
);
create index feedback_ingest_days_date_idx on blabee_analytics.feedback_ingest_days(received_date);

-- Verified billing webhooks only. No prices, payment credentials or entitlements.
create table blabee_analytics.subscription_events (
    provider text not null, provider_event_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    event_kind text not null, occurred_at timestamptz not null, received_at timestamptz not null,
    cancellation_reason text not null,
    primary key(provider,provider_event_id),
    check(provider in ('stripe','paddle','lemonsqueezy','toss')),
    check(pg_catalog.length(provider_event_id) between 1 and 200
        and provider_event_id ~ '^[A-Za-z0-9_.:-]+$'),
    check(event_kind in ('started','renewed','cancellation_scheduled','ended')),
    check(cancellation_reason in ('none','too_expensive','not_using','missing_feature','technical_issue','other')
        and (cancellation_reason = 'none' or event_kind in ('cancellation_scheduled','ended'))),
    check(pg_catalog.isfinite(occurred_at) and pg_catalog.isfinite(received_at)
        and occurred_at <= received_at + interval '5 minutes')
);
create index subscription_events_user_time_idx on blabee_analytics.subscription_events(user_id,occurred_at);
create index subscription_events_occurred_idx on blabee_analytics.subscription_events(occurred_at);

revoke all on blabee_analytics.insight_event_receipts from public,anon,authenticated,service_role;
alter table blabee_analytics.insight_event_receipts enable row level security;
revoke all on blabee_analytics.insight_ingest_days from public,anon,authenticated,service_role;
alter table blabee_analytics.insight_ingest_days enable row level security;
revoke all on blabee_analytics.connection_observation_days from public,anon,authenticated,service_role;
alter table blabee_analytics.connection_observation_days enable row level security;
revoke all on blabee_analytics.card_observation_receipts from public,anon,authenticated,service_role;
alter table blabee_analytics.card_observation_receipts enable row level security;
revoke all on blabee_analytics.card_observation_days from public,anon,authenticated,service_role;
alter table blabee_analytics.card_observation_days enable row level security;
revoke all on blabee_analytics.feedback_receipts from public,anon,authenticated,service_role;
alter table blabee_analytics.feedback_receipts enable row level security;
revoke all on blabee_analytics.feedback_submissions from public,anon,authenticated,service_role;
alter table blabee_analytics.feedback_submissions enable row level security;
revoke all on blabee_analytics.feedback_ingest_days from public,anon,authenticated,service_role;
alter table blabee_analytics.feedback_ingest_days enable row level security;
revoke all on blabee_analytics.subscription_events from public,anon,authenticated,service_role;
alter table blabee_analytics.subscription_events enable row level security;
-- Intentionally no direct client policies, including service_role table grants.

create function public.record_blabee_insight_event(
    p_event_id uuid, p_occurred_at timestamptz, p_metric_kind text, p_card_id uuid,
    p_card_kind text, p_response text, p_reaction_bucket text,
    p_app_version text, p_app_build text, p_os_major text, p_ui_language text,
    p_codex_version text, p_connection_mode text, p_compatibility text
) returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
    v_user uuid := auth.uid();
    v_now timestamptz := pg_catalog.now();
    v_day date := (v_now at time zone 'UTC')::date;
    v_date date;
    v_count integer;
    v_value text;
    v_new boolean;
    v_changed boolean := false;
    v_card blabee_analytics.card_observation_receipts%rowtype;
begin
    if v_user is null then raise exception using errcode='28000',message='Authentication required'; end if;
    if p_event_id is null or p_occurred_at is null or not pg_catalog.isfinite(p_occurred_at)
        or p_occurred_at < v_now - interval '168 hours' or p_occurred_at > v_now + interval '5 minutes'
        or p_metric_kind is null or p_metric_kind not in ('card_presented','card_responded','connection_observed')
    then raise exception using errcode='22023',message='Invalid insight event'; end if;
    foreach v_value in array array[p_app_version,p_app_build,p_codex_version] loop
        if v_value is null or pg_catalog.length(v_value) > 27
            or v_value !~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
        then raise exception using errcode='22023',message='Invalid insight version'; end if;
    end loop;
    if p_os_major is null or p_os_major !~ '^(unknown|[0-9]{1,6})$'
        or p_ui_language is null or p_ui_language not in ('ko','en','other','unknown')
        or p_card_kind is null or p_response is null or p_reaction_bucket is null
        or p_connection_mode is null or p_compatibility is null
    then raise exception using errcode='22023',message='Invalid insight dimensions'; end if;
    if p_metric_kind = 'connection_observed' then
        if p_card_id is not null or p_card_kind <> 'none' or p_response <> 'none' or p_reaction_bucket <> 'none'
            or p_connection_mode not in ('plugin','managed','unknown')
            or p_compatibility not in ('qualified','unqualified','unknown')
        then raise exception using errcode='22023',message='Invalid connection dimensions'; end if;
    else
        if p_card_id is null or p_card_kind not in ('suggestion','approval')
            or p_codex_version <> 'unknown' or p_connection_mode <> 'none' or p_compatibility <> 'none'
            or (p_metric_kind = 'card_presented' and (p_response <> 'none' or p_reaction_bucket <> 'none'))
            or (p_metric_kind = 'card_responded' and
                (p_reaction_bucket not in ('under_5s','5_to_30s','over_30s','unknown')
                    or (p_card_kind = 'suggestion' and p_response not in ('selected','dismissed'))
                    or (p_card_kind = 'approval' and p_response not in ('approved','denied'))))
        then raise exception using errcode='22023',message='Invalid card dimensions'; end if;
    end if;
    v_date := (p_occurred_at at time zone 'UTC')::date;
    insert into blabee_analytics.insight_ingest_days values(v_user,v_day,0) on conflict do nothing;
    select accepted_count into v_count from blabee_analytics.insight_ingest_days
        where user_id=v_user and received_date=v_day for update;
    if v_count >= 1000 then return false; end if;
    insert into blabee_analytics.insight_event_receipts values(v_user,p_event_id,v_now) on conflict do nothing;
    if not found then return false; end if;
    if p_metric_kind = 'connection_observed' then
        insert into blabee_analytics.connection_observation_days values(v_user,v_date,
            p_app_version,p_app_build,p_os_major,p_ui_language,p_codex_version,p_connection_mode,p_compatibility)
        on conflict do nothing;
        v_changed := found;
    else
        insert into blabee_analytics.card_observation_receipts values(v_user,p_card_id,v_now,v_date,p_card_kind,
            p_app_version,p_app_build,p_os_major,p_ui_language,p_response,p_reaction_bucket)
        on conflict do nothing;
        v_new := found;
        select * into strict v_card from blabee_analytics.card_observation_receipts
            where user_id=v_user and card_id=p_card_id for update;
        if row(v_card.observed_date,v_card.card_kind,v_card.app_version,v_card.app_build,v_card.os_major,v_card.ui_language)
            is distinct from row(v_date,p_card_kind,p_app_version,p_app_build,p_os_major,p_ui_language)
        then raise exception using errcode='22023',message='Card observation dimensions changed'; end if;
        if v_new or (v_card.response = 'none' and p_response <> 'none') then
            if not v_new then
                update blabee_analytics.card_observation_days set card_count=card_count-1
                where user_id=v_user and observed_date=v_date and card_kind=p_card_kind
                    and app_version=p_app_version and app_build=p_app_build and os_major=p_os_major
                    and ui_language=p_ui_language and response='none' and reaction_bucket='none' and card_count>0;
                if not found then raise exception using errcode='23514',message='Missing card exposure aggregate'; end if;
                delete from blabee_analytics.card_observation_days
                where user_id=v_user and observed_date=v_date and card_kind=p_card_kind
                    and app_version=p_app_version and app_build=p_app_build and os_major=p_os_major
                    and ui_language=p_ui_language and response='none' and reaction_bucket='none' and card_count=0;
                update blabee_analytics.card_observation_receipts set response=p_response,reaction_bucket=p_reaction_bucket
                    where user_id=v_user and card_id=p_card_id;
            end if;
            insert into blabee_analytics.card_observation_days as daily values(v_user,v_date,p_card_kind,
                p_app_version,p_app_build,p_os_major,p_ui_language,p_response,p_reaction_bucket,1)
            on conflict(user_id,observed_date,card_kind,app_version,app_build,os_major,ui_language,response,reaction_bucket)
            do update set card_count=daily.card_count+1;
            v_changed := true;
        end if;
    end if;
    update blabee_analytics.insight_ingest_days set accepted_count=accepted_count+1
        where user_id=v_user and received_date=v_day;
    return v_changed;
end;
$function$;

create function public.submit_blabee_feedback(
    p_submission_id uuid, p_rating text, p_reason text, p_use_purpose text,
    p_question text, p_answer text, p_suggestion text, p_note text,
    p_content_consent boolean, p_policy_version integer,
    p_app_version text, p_app_build text, p_os_major text, p_ui_language text
) returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
    v_user uuid := auth.uid();
    v_now timestamptz := pg_catalog.now();
    v_day date := (v_now at time zone 'UTC')::date;
    v_value text;
    v_count integer;
    v_payload jsonb;
    v_hash text;
    v_receipt blabee_analytics.feedback_receipts%rowtype;
begin
    if v_user is null then raise exception using errcode='28000',message='Authentication required'; end if;
    if p_submission_id is null or p_rating is null or p_reason is null or p_use_purpose is null
        or p_question is null or p_answer is null or p_suggestion is null or p_note is null
        or p_content_consent is null or p_policy_version is null or p_policy_version <> 1
        or p_rating not in ('none','helpful','unhelpful')
        or not (p_reason = 'none' or (p_rating='helpful' and p_reason in ('next_step_clear','easier_action'))
            or (p_rating='unhelpful' and p_reason in ('irrelevant','already_done','repetitive','did_not_work')))
        or p_use_purpose not in ('none','development','debugging','writing','learning','other')
        or pg_catalog.octet_length(p_question)>8000 or pg_catalog.octet_length(p_answer)>8000
        or pg_catalog.octet_length(p_suggestion)>8000 or pg_catalog.octet_length(p_note)>2000
        or (not p_content_consent and (p_question<>'' or p_answer<>'' or p_suggestion<>'' or p_note<>''))
        or (p_rating='none' and p_use_purpose='none'
            and pg_catalog.btrim(p_question || p_answer || p_suggestion || p_note)='')
    then raise exception using errcode='22023',message='Invalid feedback or content consent'; end if;
    foreach v_value in array array[p_app_version,p_app_build] loop
        if v_value is null or pg_catalog.length(v_value)>27
            or v_value !~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
        then raise exception using errcode='22023',message='Invalid feedback version'; end if;
    end loop;
    if p_os_major is null or p_os_major !~ '^(unknown|[0-9]{1,6})$'
        or p_ui_language is null or p_ui_language not in ('ko','en','other','unknown')
    then raise exception using errcode='22023',message='Invalid feedback environment'; end if;
    v_payload := pg_catalog.jsonb_build_array(p_rating,p_reason,p_use_purpose,p_question,p_answer,p_suggestion,p_note,
        p_content_consent,p_policy_version,p_app_version,p_app_build,p_os_major,p_ui_language);
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_payload::text,'UTF8')),'hex');

    -- New submissions serialize on the user/day quota. Existing submission IDs
    -- additionally serialize across UTC day boundaries on their unique receipt.
    insert into blabee_analytics.feedback_ingest_days values(v_user,v_day,0) on conflict do nothing;
    select accepted_count into v_count from blabee_analytics.feedback_ingest_days
        where user_id=v_user and received_date=v_day for update;
    select * into v_receipt from blabee_analytics.feedback_receipts
        where user_id=v_user and submission_id=p_submission_id for update;
    if found then
        if v_receipt.unavailable_at is not null or v_receipt.expires_at<=v_now
        then raise exception using errcode='22023',message='Feedback submission no longer available'; end if;
        if v_receipt.payload_hash<>v_hash
        then raise exception using errcode='22023',message='Feedback submission identifier conflict'; end if;
        return p_submission_id;
    end if;
    if v_count>=10 then raise exception using errcode='P0001',message='Feedback daily limit reached'; end if;
    insert into blabee_analytics.feedback_receipts(user_id,submission_id,payload_hash,received_at,expires_at)
        values(v_user,p_submission_id,v_hash,v_now,v_now+interval '720 hours') on conflict do nothing;
    if not found then
        -- Another receipt-day transaction inserted this ID between SELECT/INSERT.
        select * into strict v_receipt from blabee_analytics.feedback_receipts
            where user_id=v_user and submission_id=p_submission_id for update;
        if v_receipt.unavailable_at is not null or v_receipt.expires_at<=v_now
        then raise exception using errcode='22023',message='Feedback submission no longer available'; end if;
        if v_receipt.payload_hash<>v_hash
        then raise exception using errcode='22023',message='Feedback submission identifier conflict'; end if;
        return p_submission_id;
    end if;
    insert into blabee_analytics.feedback_submissions values(v_user,p_submission_id,v_now,v_now+interval '720 hours',
        p_rating,p_reason,p_use_purpose,p_question,p_answer,p_suggestion,p_note,p_content_consent,p_policy_version,
        p_app_version,p_app_build,p_os_major,p_ui_language);
    update blabee_analytics.feedback_ingest_days set accepted_count=accepted_count+1
        where user_id=v_user and received_date=v_day;
    return p_submission_id;
end;
$function$;

create function public.list_blabee_feedback()
returns table(submission_id uuid,received_at timestamptz,expires_at timestamptz,rating text,reason text,use_purpose text,has_content boolean)
language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := auth.uid();
begin
    if v_user is null then raise exception using errcode='28000',message='Authentication required'; end if;
    return query select f.submission_id,f.received_at,f.expires_at,f.rating,f.reason,f.use_purpose,
        (f.question<>'' or f.answer<>'' or f.suggestion<>'' or f.note<>'')
    from blabee_analytics.feedback_submissions as f
    where f.user_id=v_user and f.expires_at>pg_catalog.now()
    order by f.received_at desc,f.submission_id desc limit 320;
end;
$function$;

create function public.delete_blabee_feedback(p_submission_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
    v_user uuid := auth.uid();
    v_now timestamptz := pg_catalog.now();
    v_receipt blabee_analytics.feedback_receipts%rowtype;
    v_deleted boolean;
begin
    if v_user is null then raise exception using errcode='28000',message='Authentication required'; end if;
    if p_submission_id is null then raise exception using errcode='22023',message='Invalid feedback identifier'; end if;
    select * into v_receipt from blabee_analytics.feedback_receipts
        where user_id=v_user and submission_id=p_submission_id for update;
    if not found or v_receipt.unavailable_at is not null then return false; end if;
    delete from blabee_analytics.feedback_submissions where user_id=v_user and submission_id=p_submission_id;
    v_deleted := found;
    update blabee_analytics.feedback_receipts set unavailable_at=v_now,tombstone_until=v_now+interval '744 hours'
        where user_id=v_user and submission_id=p_submission_id;
    -- Deleting never refunds the user's submission quota.
    return v_deleted;
end;
$function$;

-- Called only by a backend AFTER verifying the provider's webhook signature.
-- ACL requires service_role; p_user_id is the verified backend's resolved account.
create function public.record_blabee_subscription_event(
    p_provider text,p_provider_event_id text,p_user_id uuid,p_event_kind text,
    p_occurred_at timestamptz,p_cancellation_reason text
) returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
    v_now timestamptz := pg_catalog.now();
    v_previous blabee_analytics.subscription_events%rowtype;
begin
    if p_provider is null or p_provider not in ('stripe','paddle','lemonsqueezy','toss')
        or p_provider_event_id is null or pg_catalog.length(p_provider_event_id) not between 1 and 200
        or p_provider_event_id !~ '^[A-Za-z0-9_.:-]+$'
        or p_user_id is null or p_event_kind is null
        or p_event_kind not in ('started','renewed','cancellation_scheduled','ended')
        or p_occurred_at is null or not pg_catalog.isfinite(p_occurred_at)
        or p_occurred_at>v_now+interval '5 minutes'
        or p_cancellation_reason is null
        or p_cancellation_reason not in ('none','too_expensive','not_using','missing_feature','technical_issue','other')
        or (p_cancellation_reason<>'none' and p_event_kind not in ('cancellation_scheduled','ended'))
    then raise exception using errcode='22023',message='Invalid verified subscription event'; end if;
    insert into blabee_analytics.subscription_events values(
        p_provider,p_provider_event_id,p_user_id,p_event_kind,p_occurred_at,v_now,p_cancellation_reason)
    on conflict do nothing;
    if found then return true; end if;
    select * into strict v_previous from blabee_analytics.subscription_events
        where provider=p_provider and provider_event_id=p_provider_event_id;
    if row(v_previous.user_id,v_previous.event_kind,v_previous.occurred_at,v_previous.cancellation_reason)
        is distinct from row(p_user_id,p_event_kind,p_occurred_at,p_cancellation_reason)
    then raise exception using errcode='22023',message='Subscription event identifier conflict'; end if;
    return false;
end;
$function$;

revoke all on function public.record_blabee_insight_event(uuid,timestamptz,text,uuid,text,text,text,text,text,text,text,text,text,text)
    from public,anon,authenticated,service_role;
grant execute on function public.record_blabee_insight_event(uuid,timestamptz,text,uuid,text,text,text,text,text,text,text,text,text,text)
    to authenticated;
revoke all on function public.submit_blabee_feedback(uuid,text,text,text,text,text,text,text,boolean,integer,text,text,text,text)
    from public,anon,authenticated,service_role;
grant execute on function public.submit_blabee_feedback(uuid,text,text,text,text,text,text,text,boolean,integer,text,text,text,text)
    to authenticated;
revoke all on function public.list_blabee_feedback(), public.delete_blabee_feedback(uuid)
    from public,anon,authenticated,service_role;
grant execute on function public.list_blabee_feedback(), public.delete_blabee_feedback(uuid) to authenticated;
revoke all on function public.record_blabee_subscription_event(text,text,uuid,text,timestamptz,text)
    from public,anon,authenticated,service_role;
grant execute on function public.record_blabee_subscription_event(text,text,uuid,text,timestamptz,text) to service_role;

create function blabee_analytics.prune_feedback_data()
returns bigint language plpgsql security invoker set search_path = ''
as $function$
declare
    v_now timestamptz := pg_catalog.now();
    v_count bigint;
    v_total bigint := 0;
begin
    delete from blabee_analytics.insight_event_receipts where received_at<v_now-interval '192 hours';
    get diagnostics v_count=row_count; v_total:=v_total+v_count;
    delete from blabee_analytics.card_observation_receipts where first_received_at<v_now-interval '192 hours';
    get diagnostics v_count=row_count; v_total:=v_total+v_count;
    delete from blabee_analytics.insight_ingest_days
        where received_date<((v_now-interval '192 hours') at time zone 'UTC')::date;
    -- Expiry is logical at exactly 30 days even before this housekeeping job.
    update blabee_analytics.feedback_receipts
        set unavailable_at=expires_at,tombstone_until=expires_at+interval '744 hours'
        where unavailable_at is null and expires_at<=v_now;
    delete from blabee_analytics.feedback_submissions where expires_at<=v_now;
    get diagnostics v_count=row_count; v_total:=v_total+v_count;
    delete from blabee_analytics.feedback_receipts where tombstone_until<=v_now;
    get diagnostics v_count=row_count; v_total:=v_total+v_count;
    delete from blabee_analytics.feedback_ingest_days
        where received_date<((v_now-interval '744 hours') at time zone 'UTC')::date;
    return v_total;
end;
$function$;
revoke all on function blabee_analytics.prune_feedback_data() from public,anon,authenticated,service_role;

comment on table blabee_analytics.feedback_submissions is
    'Explicit user submission only. Raw fields require content_consent policy 1, expire at 30 receipt days, own deletion available.';
comment on table blabee_analytics.feedback_receipts is
    'SHA-256 retry fingerprint and metadata. After delete/expiry only tombstone/hash remain for 31 days; suppression is bounded, not permanent.';
comment on table blabee_analytics.card_observation_days is
    'Daily opted-in first displayed cards by first response. Sum is exposure denominator; none is unobserved response, never failure.';
comment on table blabee_analytics.subscription_events is
    'Verified-backend subscription analytics only, retained until account deletion. Does not grant/revoke entitlements or store payment details.';
commit;

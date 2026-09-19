-- Disposable fixtures for the six actual SELECTs in feedback-reports.sql.
-- Driver executes unchanged report SQL, asserts JSON results, then rolls back.
begin;
set local timezone='Pacific/Honolulu';
insert into auth.users(id,email,created_at,updated_at)
select ('e012fa00-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
    'feedback-report-'||i||'@example.invalid',now(),now() from generate_series(1,3) as n(i);

insert into blabee_analytics.card_observation_days
select ('e012fa00-0000-4000-8000-'||lpad(user_number::text,12,'0'))::uuid,
    (now() at time zone 'UTC')::date+day_offset,card_kind,'1.0.0','56','15','ko',response,bucket,amount
from (values
    (1,0,'suggestion','selected','under_5s',2),
    (1,0,'suggestion','dismissed','5_to_30s',1),
    (2,0,'suggestion','none','none',3),
    (2,-29,'suggestion','selected','over_30s',1),
    (1,0,'approval','approved','unknown',1),
    (2,0,'approval','denied','under_5s',1),
    (3,1,'suggestion','selected','under_5s',100),
    (3,-30,'suggestion','selected','under_5s',100),
    (3,0,'suggestion','none','none',0)
) as fixtures(user_number,day_offset,card_kind,response,bucket,amount);

insert into blabee_analytics.connection_observation_days
select ('e012fa00-0000-4000-8000-'||lpad(user_number::text,12,'0'))::uuid,
    (now() at time zone 'UTC')::date+day_offset,'1.0.0','56','15','ko',codex_version,mode,compatibility
from (values
    (1,0,'0.154.0','plugin','qualified'),
    (1,-1,'0.154.0','plugin','qualified'),
    (2,-29,'0.154.0','plugin','qualified'),
    (1,0,'0.153.0','managed','unqualified'),
    (3,1,'0.154.0','plugin','qualified'),
    (3,-30,'0.154.0','plugin','qualified')
) as fixtures(user_number,day_offset,codex_version,mode,compatibility);

insert into blabee_analytics.feedback_receipts(user_id,submission_id,payload_hash,received_at,expires_at)
select ('e012fa00-0000-4000-8000-'||lpad(user_number::text,12,'0'))::uuid,
    md5('feedback-report-'||submission_number)::uuid,repeat('a',64),
    now()+make_interval(hours=>hour_offset),now()+make_interval(hours=>hour_offset)+interval '720 hours'
from (values (1,1,-1),(1,2,-2),(2,3,-3),(1,4,-720),(2,5,1),(1,6,-4))
    as fixtures(user_number,submission_number,hour_offset);
insert into blabee_analytics.feedback_submissions
select user_id,submission_id,received_at,expires_at,
    case when submission_id=md5('feedback-report-3')::uuid then 'unhelpful' else 'helpful' end,
    case when submission_id=md5('feedback-report-3')::uuid then 'repetitive' else 'next_step_clear' end,
    case when submission_id=md5('feedback-report-3')::uuid then 'learning' else 'development' end,
    case when submission_id=md5('feedback-report-1')::uuid then 'Reviewed question' else '' end,
    '', '',
    case when submission_id=md5('feedback-report-3')::uuid then 'Reviewed note' else '' end,
    submission_id in (md5('feedback-report-1')::uuid,md5('feedback-report-3')::uuid),
    1,'1.0.0','56','15','ko'
from blabee_analytics.feedback_receipts;
set local request.jwt.claim.sub='e012fa00-0000-4000-8000-000000000001';
select public.delete_blabee_feedback(md5('feedback-report-6')::uuid);

insert into blabee_analytics.subscription_events
select provider,'evt_report_'||event_number,
    ('e012fa00-0000-4000-8000-'||lpad(user_number::text,12,'0'))::uuid,
    event_kind,case when hour_offset is not null then now()+make_interval(hours=>hour_offset)
        else (((now() at time zone 'UTC')::date+day_offset)::timestamp at time zone 'UTC') end,
    now(),reason
from (values
    ('stripe',1,1,'started',-1,null,'none'),
    ('stripe',2,1,'renewed',-240,null,'none'),
    ('stripe',3,2,'cancellation_scheduled',0,null,'technical_issue'),
    ('stripe',4,1,'ended',0,null,'too_expensive'),
    ('stripe',5,1,'started',null,-29,'none'),
    ('stripe',6,1,'started',null,-30,'none'),
    ('paddle',7,2,'started',0,null,'none')
) as fixtures(provider,event_number,user_number,event_kind,hour_offset,day_offset,reason);
insert into blabee_analytics.subscription_events values
    ('stripe','evt_report_future','e012fa00-0000-4000-8000-000000000001','started',now()+interval '1 minute',now(),'none');

create function pg_temp.assert_feedback_reports(
    p_cards jsonb,p_reactions jsonb,p_connections jsonb,p_ratings jsonb,p_content jsonb,p_billing jsonb
) returns void language plpgsql as $f$
declare v_row record;
begin
    select * into v_row from jsonb_to_recordset(p_cards) as r(
        card_kind text,observed_exposures bigint,observed_responded bigint,observed_without_response bigint,
        observed_selected bigint,observed_dismissed bigint,observed_approved bigint,observed_denied bigint,
        observed_users bigint,observed_response_percent numeric) where card_kind='suggestion';
    if jsonb_array_length(p_cards)<>2 or v_row.observed_exposures is distinct from 7::bigint
        or v_row.observed_responded is distinct from 4::bigint or v_row.observed_without_response is distinct from 3::bigint
        or v_row.observed_selected is distinct from 3::bigint or v_row.observed_dismissed is distinct from 1::bigint
        or v_row.observed_approved is distinct from 0::bigint or v_row.observed_denied is distinct from 0::bigint
        or v_row.observed_users is distinct from 2::bigint or v_row.observed_response_percent is distinct from 57.1
        or not exists(select 1 from jsonb_to_recordset(p_cards) as r(
            card_kind text,observed_exposures bigint,observed_responded bigint,observed_response_percent numeric)
            where card_kind='approval' and observed_exposures=2 and observed_responded=2 and observed_response_percent=100.0)
    then raise exception 'Actual card report denominator/outcome/date filtering failed';end if;
    raise notice 'PASS: actual displayed-card response denominator, pending separation and UTC 30-date boundaries';

    if jsonb_array_length(p_reactions)<>5
        or (select sum(observed_responses) from jsonb_to_recordset(p_reactions) as r(observed_responses bigint))<>6
        or exists(select 1 from jsonb_to_recordset(p_reactions) as r(response text,reaction_bucket text)
            where response='none' or reaction_bucket='none')
        or not exists(select 1 from jsonb_to_recordset(p_reactions) as r(
            card_kind text,response text,reaction_bucket text,observed_responses bigint)
            where card_kind='approval' and response='approved' and reaction_bucket='unknown' and observed_responses=1)
    then raise exception 'Actual reaction buckets mixed pending or dropped unknown';end if;
    raise notice 'PASS: actual reaction buckets preserve card response and unknown timing without pending latency';

    if jsonb_array_length(p_connections)<>2
        or not exists(select 1 from jsonb_to_recordset(p_connections) as r(
            codex_version text,connection_mode text,compatibility text,observed_users bigint,observed_user_environment_days bigint)
            where codex_version='0.154.0' and connection_mode='plugin' and compatibility='qualified'
                and observed_users=2 and observed_user_environment_days=3)
        or (select sum(observed_users) from jsonb_to_recordset(p_connections) as r(observed_users bigint))<>3
    then raise exception 'Actual connection environment distinct users/days/window wrong';end if;
    raise notice 'PASS: actual installation/probe version cohorts use distinct users and environment-days';

    if jsonb_array_length(p_ratings)<>2
        or not exists(select 1 from jsonb_to_recordset(p_ratings) as r(
            rating text,reason text,use_purpose text,submitted_feedback bigint,submitting_users bigint,submissions_with_content bigint)
            where rating='helpful' and reason='next_step_clear' and use_purpose='development'
                and submitted_feedback=2 and submitting_users=1 and submissions_with_content=1)
        or (select sum(submitted_feedback) from jsonb_to_recordset(p_ratings) as r(submitted_feedback bigint))<>3
    then raise exception 'Actual feedback summary included deleted/expired/future rows';end if;
    raise notice 'PASS: actual feedback rating/reason/purpose report excludes logical expiry, deleted and future rows';

    if jsonb_array_length(p_content)<>3
        or p_content->0->>'question'<>'Reviewed question'
        or (p_content->0->>'content_consent')::boolean is distinct from true
        or (p_content->2->>'note')<>'Reviewed note'
        or exists(select 1 from jsonb_to_recordset(p_content) as r(submission_id uuid)
            where submission_id in (md5('feedback-report-4')::uuid,md5('feedback-report-5')::uuid,md5('feedback-report-6')::uuid))
    then raise exception 'Actual operator content report failed expiry/deletion/order';end if;
    raise notice 'PASS: actual privileged content report returns explicit fields only for active submissions in order';

    if jsonb_array_length(p_billing)<>5
        or (select sum(recorded_events) from jsonb_to_recordset(p_billing) as r(recorded_events bigint))<>6
        or not exists(select 1 from jsonb_to_recordset(p_billing) as r(
            provider text,event_kind text,cancellation_reason text,recorded_events bigint,observed_users bigint)
            where provider='stripe' and event_kind='started' and cancellation_reason='none'
                and recorded_events=2 and observed_users=1)
        or not exists(select 1 from jsonb_to_recordset(p_billing) as r(event_kind text,cancellation_reason text,recorded_events bigint)
            where event_kind='cancellation_scheduled' and cancellation_reason='technical_issue' and recorded_events=1)
        or not exists(select 1 from jsonb_to_recordset(p_billing) as r(event_kind text,cancellation_reason text,recorded_events bigint)
            where event_kind='ended' and cancellation_reason='too_expensive' and recorded_events=1)
    then raise exception 'Actual billing report conflated lifecycle/observed users or window boundaries';end if;
    raise notice 'PASS: actual verified-billing report separates lifecycle/reason and excludes future/out-of-window events';
end;$f$;

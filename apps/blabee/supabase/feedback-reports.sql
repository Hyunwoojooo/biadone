-- OWNER-ONLY reports. Do not expose views or raw feedback to a client API.
-- Card/connection metrics are opt-in observations, not all users or AI success.
-- Card response uses its own displayed-card denominator, not usage/error counts.
-- Feedback expiry is enforced here immediately, before daily physical cleanup.

-- 1. Displayed-card response rates, latest 30 UTC exposure dates.
with cards as (
    select card_kind,app_version,app_build,os_major,ui_language,
        sum(card_count) as observed_exposures,
        coalesce(sum(card_count) filter(where response<>'none'),0) as observed_responded,
        coalesce(sum(card_count) filter(where response='none'),0) as observed_without_response,
        coalesce(sum(card_count) filter(where response='selected'),0) as observed_selected,
        coalesce(sum(card_count) filter(where response='dismissed'),0) as observed_dismissed,
        coalesce(sum(card_count) filter(where response='approved'),0) as observed_approved,
        coalesce(sum(card_count) filter(where response='denied'),0) as observed_denied,
        count(distinct user_id) as observed_users
    from blabee_analytics.card_observation_days
    where card_count>0 and observed_date between (now() at time zone 'UTC')::date-29
        and (now() at time zone 'UTC')::date
    group by card_kind,app_version,app_build,os_major,ui_language
)
select *,round(100.0*observed_responded/nullif(observed_exposures,0),1) as observed_response_percent
from cards order by observed_exposures desc,card_kind,app_version,app_build,os_major,ui_language;

-- 2. User reaction buckets, same original exposure dates; none is not a latency.
select card_kind,response,reaction_bucket,app_version,app_build,os_major,ui_language,
    sum(card_count) as observed_responses
from blabee_analytics.card_observation_days
where card_count>0 and response<>'none'
    and observed_date between (now() at time zone 'UTC')::date-29 and (now() at time zone 'UTC')::date
group by card_kind,response,reaction_bucket,app_version,app_build,os_major,ui_language
order by card_kind,response,reaction_bucket,app_version,app_build,os_major,ui_language;

-- 3. Observed Codex installation/probe environments; users may appear in
-- multiple groups. Mode reflects inspected configuration, not a proven live
-- connection. Compatibility is CLI-version qualification for the plugin
-- profile, not Hook trust or successful delivery. Unavailable probes are unknown.
select codex_version,connection_mode,compatibility,app_version,app_build,os_major,ui_language,
    count(distinct user_id) as observed_users,count(*) as observed_user_environment_days
from blabee_analytics.connection_observation_days
where observed_date between (now() at time zone 'UTC')::date-29 and (now() at time zone 'UTC')::date
group by codex_version,connection_mode,compatibility,app_version,app_build,os_major,ui_language
order by observed_users desc,codex_version,connection_mode,compatibility,app_version,app_build,os_major,ui_language;

-- 4. Current feedback ratings/reasons/purposes. Deleted/expired submissions are absent.
select rating,reason,use_purpose,count(*) as submitted_feedback,count(distinct user_id) as submitting_users,
    count(*) filter(where question<>'' or answer<>'' or suggestion<>'' or note<>'') as submissions_with_content
from blabee_analytics.feedback_submissions
where expires_at>now() and received_at<=now()
group by rating,reason,use_purpose order by submitted_feedback desc,rating,reason,use_purpose;

-- 5. Explicitly submitted content, newest 320 only. This is privileged operator
-- access; the user-facing list RPC intentionally returns no question/answer/note.
select f.submission_id,f.user_id,f.received_at,f.expires_at,f.rating,f.reason,f.use_purpose,
    f.question,f.answer,f.suggestion,f.note,f.content_consent,f.policy_version,
    f.app_version,f.app_build,f.os_major,f.ui_language
from blabee_analytics.feedback_submissions as f
where f.expires_at>now() and f.received_at<=now()
order by f.received_at desc,f.submission_id desc limit 320;

-- 6. Verified-backend billing observations, latest 30 UTC occurrence dates.
-- A cancellation schedule is separate from actual end. No revenue, conversion,
-- or entitlement state is inferred from event counts.
select provider,event_kind,cancellation_reason,
    count(*) as recorded_events,count(distinct user_id) as observed_users,
    max(occurred_at) as last_occurred_at,max(received_at) as last_received_at
from blabee_analytics.subscription_events
where occurred_at>=(((now() at time zone 'UTC')::date-29)::timestamp at time zone 'UTC')
    and occurred_at<=now()
group by provider,event_kind,cancellation_reason
order by provider,event_kind,cancellation_reason;

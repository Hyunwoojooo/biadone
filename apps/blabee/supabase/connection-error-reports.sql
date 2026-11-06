-- ADMINISTRATOR ONLY: run separately in the Supabase SQL Editor as postgres.
-- No client view/RPC permissions. These are sampled opt-in observations, not
-- all failures or failure rates. A handshake timeout can mean a user is waiting
-- to approve/login/trust the project, rather than a broken connection.

-- 1. Recent issues by provider, step, reason and app/tool/OS version.
select connection_provider, connection_stage, connection_reason,
       app_version, app_build, os_version, tool_version,
       count(*) as observed_count, count(distinct user_id) as affected_accounts,
       max(received_at) as last_received_at
from blabee_analytics.error_events
where received_at >= now() - interval '7 days' and received_at <= now()
  and connection_provider is not null
group by connection_provider, connection_stage, connection_reason,
         app_version, app_build, os_version, tool_version
order by affected_accounts desc, observed_count desc, last_received_at desc;

-- 2. Recent user reports. Filter by user_id to inspect your own test account,
-- or by event_id (the app's 문의용 진단 ID) to investigate a support request.
-- Email is only joined for this privileged report, never copied into telemetry.
select errors.event_id, errors.user_id, users.email,
       errors.connection_provider, errors.connection_stage, errors.connection_reason,
       errors.app_build, errors.os_version, errors.tool_version,
       errors.occurred_at, errors.received_at
from blabee_analytics.error_events errors
join auth.users users on users.id = errors.user_id
where errors.received_at >= now() - interval '30 days' and errors.received_at <= now()
  and errors.connection_provider is not null
order by errors.received_at desc, errors.event_id
limit 200;

-- 3. Verify that the existing retention scheduler is active and actually ran.
select job.jobname, job.schedule, job.active, runs.start_time, runs.status, runs.return_message
from cron.job job
left join lateral (
    select start_time, status, return_message from cron.job_run_details
    where jobid = job.jobid order by start_time desc limit 1
) runs on true
where job.jobname = 'blabee-error-retention-daily';

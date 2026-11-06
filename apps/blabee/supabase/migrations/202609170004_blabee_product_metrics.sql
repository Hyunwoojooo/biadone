-- Apply as the trusted migration owner after the existing analytics migrations.
-- Opt-in, client-observed product metrics. Never billing or entitlement data.
-- Keep blabee_analytics outside the Supabase exposed-schema list.
begin;

-- Bounded domains also protect owner-side imports from accidental free text.
create domain blabee_analytics.product_version as text
    check (pg_catalog.length(value) <= 27
        and value ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$');
create domain blabee_analytics.product_os_major as text
    check (value ~ '^(unknown|[0-9]{1,6})$');
create domain blabee_analytics.product_ui_language as text
    check (value in ('ko', 'en', 'other', 'unknown'));

create table blabee_analytics.product_event_receipts (
    user_id uuid not null references auth.users (id) on delete cascade,
    event_id uuid not null,
    received_at timestamptz not null,
    primary key (user_id, event_id),
    check (pg_catalog.isfinite(received_at))
);
create index product_event_receipts_received_at_idx
    on blabee_analytics.product_event_receipts (received_at);

create table blabee_analytics.product_ingest_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    received_date date not null,
    accepted_count integer not null,
    primary key (user_id, received_date),
    check (pg_catalog.isfinite(received_date)),
    check (accepted_count between 0 and 1000)
);
create index product_ingest_days_received_date_idx
    on blabee_analytics.product_ingest_days (received_date);

-- Only day-level observations survive housekeeping, not event timestamps/IDs.
create table blabee_analytics.product_environment_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    observed_date date not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    primary key (user_id, observed_date, app_version, app_build, os_major, ui_language),
    check (pg_catalog.isfinite(observed_date))
);
create index product_environment_days_date_user_idx
    on blabee_analytics.product_environment_days (observed_date, user_id);

create table blabee_analytics.product_milestones (
    user_id uuid not null references auth.users (id) on delete cascade,
    milestone text not null,
    first_observed_date date not null,
    primary key (user_id, milestone),
    check (milestone in ('account_ready', 'service_connected', 'card_received', 'first_action')),
    check (pg_catalog.isfinite(first_observed_date))
);

-- An offer is counted once per user/UTC date/target, even across environments.
-- Its source environment is the first accepted observation for that key.
create table blabee_analytics.product_update_offer_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    observed_date date not null,
    target_version blabee_analytics.product_version not null,
    target_build blabee_analytics.product_version not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    primary key (user_id, observed_date, target_version, target_build),
    check (pg_catalog.isfinite(observed_date))
);
create index product_update_offer_days_date_user_idx
    on blabee_analytics.product_update_offer_days (observed_date, user_id);

-- Temporary state pairs late/out-of-order results with their original date and
-- bounded dimensions. It stores no command, content, or client session ID.
create table blabee_analytics.product_operation_receipts (
    user_id uuid not null references auth.users (id) on delete cascade,
    operation_id uuid not null,
    first_received_at timestamptz not null,
    operation_date date not null,
    feature text not null,
    input_method text not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    target_version text not null,
    target_build text not null,
    outcome text not null,
    latency_bucket text not null,
    primary key (user_id, operation_id),
    check (pg_catalog.isfinite(first_received_at) and pg_catalog.isfinite(operation_date)),
    constraint product_operation_receipts_shape check (
        (feature in ('choice', 'approval', 'dismiss')
            and input_method in ('button', 'keyboard')
            and target_version = 'none' and target_build = 'none'
            and ((outcome = 'pending' and latency_bucket = 'none')
                or (outcome in ('succeeded', 'failed', 'cancelled')
                    and latency_bucket in ('under_1s', '1_to_3s', 'over_3s', 'unknown'))))
        or (feature = 'app_update' and input_method = 'none' and latency_bucket = 'none'
            and outcome in ('pending', 'succeeded', 'failed', 'cancelled')
            and pg_catalog.length(target_version) <= 27
            and target_version ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
            and pg_catalog.length(target_build) <= 27
            and target_build ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$')
    )
);
create index product_operation_receipts_received_at_idx
    on blabee_analytics.product_operation_receipts (first_received_at);

-- Moving pending -> terminal moves ONE count between aggregate rows. Every
-- operation therefore contributes exactly once to the attempts denominator.
create table blabee_analytics.product_operation_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    operation_date date not null,
    feature text not null,
    input_method text not null,
    app_version blabee_analytics.product_version not null,
    app_build blabee_analytics.product_version not null,
    os_major blabee_analytics.product_os_major not null,
    ui_language blabee_analytics.product_ui_language not null,
    target_version text not null,
    target_build text not null,
    outcome text not null,
    latency_bucket text not null,
    operation_count bigint not null,
    primary key (user_id, operation_date, feature, input_method, app_version,
        app_build, os_major, ui_language, target_version, target_build, outcome, latency_bucket),
    check (pg_catalog.isfinite(operation_date)),
    check (operation_count >= 0),
    constraint product_operation_days_shape check (
        (feature in ('choice', 'approval', 'dismiss')
            and input_method in ('button', 'keyboard')
            and target_version = 'none' and target_build = 'none'
            and ((outcome = 'pending' and latency_bucket = 'none')
                or (outcome in ('succeeded', 'failed', 'cancelled')
                    and latency_bucket in ('under_1s', '1_to_3s', 'over_3s', 'unknown'))))
        or (feature = 'app_update' and input_method = 'none' and latency_bucket = 'none'
            and outcome in ('pending', 'succeeded', 'failed', 'cancelled')
            and pg_catalog.length(target_version) <= 27
            and target_version ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
            and pg_catalog.length(target_build) <= 27
            and target_build ~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$')
    )
);
create index product_operation_days_date_user_idx
    on blabee_analytics.product_operation_days (operation_date, user_id);

revoke all on blabee_analytics.product_event_receipts,
    blabee_analytics.product_ingest_days, blabee_analytics.product_environment_days,
    blabee_analytics.product_milestones, blabee_analytics.product_update_offer_days,
    blabee_analytics.product_operation_receipts, blabee_analytics.product_operation_days
    from public, anon, authenticated, service_role;
alter table blabee_analytics.product_event_receipts enable row level security;
alter table blabee_analytics.product_ingest_days enable row level security;
alter table blabee_analytics.product_environment_days enable row level security;
alter table blabee_analytics.product_milestones enable row level security;
alter table blabee_analytics.product_update_offer_days enable row level security;
alter table blabee_analytics.product_operation_receipts enable row level security;
alter table blabee_analytics.product_operation_days enable row level security;
-- No client policies. The security-definer RPC owner must own these tables.

create function public.record_blabee_product_event(
    p_event_id uuid,
    p_occurred_at timestamptz,
    p_metric_kind text,
    p_operation_id uuid,
    p_feature text,
    p_input_method text,
    p_latency_bucket text,
    p_app_version text,
    p_app_build text,
    p_os_major text,
    p_ui_language text,
    p_target_version text,
    p_target_build text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_received_at timestamptz := pg_catalog.now();
    v_received_date date := (v_received_at at time zone 'UTC')::date;
    v_date date;
    v_accepted_count integer;
    v_version text;
    v_outcome text;
    v_changed boolean := false;
    v_new_operation boolean;
    v_operation blabee_analytics.product_operation_receipts%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication required';
    end if;
    if p_event_id is null then
        raise exception using errcode = '22023', message = 'Invalid product event identifier';
    end if;
    if p_occurred_at is null or not pg_catalog.isfinite(p_occurred_at)
        or p_occurred_at < v_received_at - interval '168 hours'
        or p_occurred_at > v_received_at + interval '5 minutes'
    then
        raise exception using errcode = '22023', message = 'Product event time outside accepted range';
    end if;
    v_date := (p_occurred_at at time zone 'UTC')::date;
    if p_metric_kind is null or p_metric_kind not in (
        'environment_observed', 'account_ready', 'service_connected', 'card_received', 'first_action',
        'feature_started', 'feature_succeeded', 'feature_failed', 'feature_cancelled',
        'update_available', 'update_started', 'update_succeeded', 'update_failed', 'update_cancelled'
    ) then
        raise exception using errcode = '22023', message = 'Invalid product metric kind';
    end if;
    foreach v_version in array array[p_app_version, p_app_build] loop
        if v_version is null or pg_catalog.length(v_version) > 27
            or v_version !~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
        then
            raise exception using errcode = '22023', message = 'Invalid product version';
        end if;
    end loop;
    if p_os_major is null or p_os_major !~ '^(unknown|[0-9]{1,6})$'
        or p_ui_language is null or p_ui_language not in ('ko', 'en', 'other', 'unknown')
        or p_feature is null or p_input_method is null or p_latency_bucket is null
        or p_target_version is null or p_target_build is null
    then
        raise exception using errcode = '22023', message = 'Invalid product environment or dimensions';
    end if;

    if p_metric_kind in ('environment_observed', 'account_ready', 'service_connected', 'card_received', 'first_action') then
        if p_operation_id is not null or p_feature <> 'none' or p_input_method <> 'none'
            or p_latency_bucket <> 'none' or p_target_version <> 'none' or p_target_build <> 'none'
        then
            raise exception using errcode = '22023', message = 'Invalid observation dimensions';
        end if;
    elsif p_metric_kind in ('feature_started', 'feature_succeeded', 'feature_failed', 'feature_cancelled') then
        if p_operation_id is null or p_feature not in ('choice', 'approval', 'dismiss')
            or p_input_method not in ('button', 'keyboard')
            or p_target_version <> 'none' or p_target_build <> 'none'
            or (p_metric_kind = 'feature_started' and p_latency_bucket <> 'none')
            or (p_metric_kind <> 'feature_started'
                and p_latency_bucket not in ('under_1s', '1_to_3s', 'over_3s', 'unknown'))
        then
            raise exception using errcode = '22023', message = 'Invalid feature dimensions';
        end if;
    else
        if p_feature <> 'app_update' or p_input_method <> 'none' or p_latency_bucket <> 'none'
            or (p_metric_kind = 'update_available' and p_operation_id is not null)
            or (p_metric_kind <> 'update_available' and p_operation_id is null)
        then
            raise exception using errcode = '22023', message = 'Invalid update dimensions';
        end if;
        foreach v_version in array array[p_target_version, p_target_build] loop
            if pg_catalog.length(v_version) > 27
                or v_version !~ '^(unknown|[0-9]{1,6}([.][0-9]{1,6}){0,3})$'
            then
                raise exception using errcode = '22023', message = 'Invalid update target';
            end if;
        end loop;
    end if;

    -- One user/receipt-day lock bounds new receipts atomically without locking
    -- auth.users or other users. Duplicate IDs never consume quota.
    insert into blabee_analytics.product_ingest_days (user_id, received_date, accepted_count)
    values (v_user_id, v_received_date, 0)
    on conflict (user_id, received_date) do nothing;
    select accepted_count into v_accepted_count
    from blabee_analytics.product_ingest_days
    where user_id = v_user_id and received_date = v_received_date
    for update;
    if v_accepted_count >= 1000 then
        return false;
    end if;
    insert into blabee_analytics.product_event_receipts (user_id, event_id, received_at)
    values (v_user_id, p_event_id, v_received_at)
    on conflict (user_id, event_id) do nothing;
    if not found then
        return false;
    end if;

    if p_metric_kind = 'environment_observed' then
        insert into blabee_analytics.product_environment_days (
            user_id, observed_date, app_version, app_build, os_major, ui_language
        ) values (v_user_id, v_date, p_app_version, p_app_build, p_os_major, p_ui_language)
        on conflict do nothing;
        v_changed := found;
    elsif p_metric_kind in ('account_ready', 'service_connected', 'card_received', 'first_action') then
        insert into blabee_analytics.product_milestones as milestones (
            user_id, milestone, first_observed_date
        ) values (v_user_id, p_metric_kind, v_date)
        on conflict (user_id, milestone) do update
        set first_observed_date = excluded.first_observed_date
        where excluded.first_observed_date < milestones.first_observed_date;
        v_changed := found;
    elsif p_metric_kind = 'update_available' then
        insert into blabee_analytics.product_update_offer_days (
            user_id, observed_date, target_version, target_build,
            app_version, app_build, os_major, ui_language
        ) values (v_user_id, v_date, p_target_version, p_target_build,
            p_app_version, p_app_build, p_os_major, p_ui_language)
        on conflict do nothing;
        v_changed := found;
    else
        v_outcome := case p_metric_kind
            when 'feature_started' then 'pending' when 'update_started' then 'pending'
            when 'feature_succeeded' then 'succeeded' when 'update_succeeded' then 'succeeded'
            when 'feature_failed' then 'failed' when 'update_failed' then 'failed'
            else 'cancelled' end;
        insert into blabee_analytics.product_operation_receipts (
            user_id, operation_id, first_received_at, operation_date, feature, input_method,
            app_version, app_build, os_major, ui_language, target_version, target_build,
            outcome, latency_bucket
        ) values (v_user_id, p_operation_id, v_received_at, v_date, p_feature, p_input_method,
            p_app_version, p_app_build, p_os_major, p_ui_language, p_target_version, p_target_build,
            v_outcome, p_latency_bucket)
        on conflict (user_id, operation_id) do nothing;
        v_new_operation := found;
        select * into strict v_operation
        from blabee_analytics.product_operation_receipts
        where user_id = v_user_id and operation_id = p_operation_id
        for update;

        if row(v_operation.operation_date, v_operation.feature, v_operation.input_method,
            v_operation.app_version, v_operation.app_build, v_operation.os_major,
            v_operation.ui_language, v_operation.target_version, v_operation.target_build)
            is distinct from row(v_date, p_feature, p_input_method,
                p_app_version, p_app_build, p_os_major, p_ui_language, p_target_version, p_target_build)
        then
            raise exception using errcode = '22023', message = 'Operation dimensions changed';
        end if;

        if v_new_operation or (v_operation.outcome = 'pending' and v_outcome <> 'pending') then
            if not v_new_operation then
                update blabee_analytics.product_operation_days
                set operation_count = operation_count - 1
                where user_id = v_user_id and operation_date = v_date and feature = p_feature
                    and input_method = p_input_method and app_version = p_app_version
                    and app_build = p_app_build and os_major = p_os_major and ui_language = p_ui_language
                    and target_version = p_target_version and target_build = p_target_build
                    and outcome = 'pending' and latency_bucket = 'none' and operation_count > 0;
                if not found then
                    raise exception using errcode = '23514', message = 'Missing pending operation aggregate';
                end if;
                delete from blabee_analytics.product_operation_days
                where user_id = v_user_id and operation_date = v_date and feature = p_feature
                    and input_method = p_input_method and app_version = p_app_version
                    and app_build = p_app_build and os_major = p_os_major and ui_language = p_ui_language
                    and target_version = p_target_version and target_build = p_target_build
                    and outcome = 'pending' and latency_bucket = 'none' and operation_count = 0;
                update blabee_analytics.product_operation_receipts
                set outcome = v_outcome, latency_bucket = p_latency_bucket
                where user_id = v_user_id and operation_id = p_operation_id;
            end if;
            insert into blabee_analytics.product_operation_days as daily (
                user_id, operation_date, feature, input_method, app_version, app_build,
                os_major, ui_language, target_version, target_build, outcome, latency_bucket, operation_count
            ) values (v_user_id, v_date, p_feature, p_input_method, p_app_version, p_app_build,
                p_os_major, p_ui_language, p_target_version, p_target_build, v_outcome, p_latency_bucket, 1)
            on conflict (user_id, operation_date, feature, input_method, app_version, app_build,
                os_major, ui_language, target_version, target_build, outcome, latency_bucket)
            do update set operation_count = daily.operation_count + 1;
            v_changed := true;
        end if;
        -- Existing terminal outcomes win. Repeated starts/results and conflicting
        -- terminal results cannot reopen an operation or move its terminal count.
    end if;

    -- New valid receipts consume quota even when daily/stage/state aggregates
    -- already exist. All writes and aggregate moves commit/roll back together.
    update blabee_analytics.product_ingest_days
    set accepted_count = accepted_count + 1
    where user_id = v_user_id and received_date = v_received_date;
    return v_changed;
end;
$function$;

revoke all on function public.record_blabee_product_event(
    uuid, timestamptz, text, uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_blabee_product_event(
    uuid, timestamptz, text, uuid, text, text, text, text, text, text, text, text, text
) to authenticated;

-- Eight receipt days outlast the seven-day accepted event window. Clients must
-- retry original IDs AND original occurrence date/environment. Reusing IDs with
-- refreshed timestamps after pruning represents a new observation.
create function blabee_analytics.prune_product_event_receipts()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_cutoff timestamptz := pg_catalog.now() - interval '192 hours';
    v_deleted bigint;
    v_operations_deleted bigint;
begin
    delete from blabee_analytics.product_event_receipts where received_at < v_cutoff;
    get diagnostics v_deleted = row_count;
    delete from blabee_analytics.product_operation_receipts where first_received_at < v_cutoff;
    get diagnostics v_operations_deleted = row_count;
    delete from blabee_analytics.product_ingest_days
    where received_date < (v_cutoff at time zone 'UTC')::date;
    return v_deleted + v_operations_deleted;
end;
$function$;
revoke all on function blabee_analytics.prune_product_event_receipts()
    from public, anon, authenticated, service_role;

comment on table blabee_analytics.product_operation_days is
    'Opt-in observed attempts by original UTC start date/environment. Pending, cancellation and failures differ. Retained until account deletion.';
comment on table blabee_analytics.product_milestones is
    'Earliest observed UTC date after consent for each stage; not historical first login or a guaranteed ordered funnel.';
comment on table blabee_analytics.product_environment_days is
    'Distinct opted-in user/date/environment observations, not actual feature-use counts or nationality.';
comment on table blabee_analytics.product_ingest_days is
    'Atomic cap of 1000 new valid receipts per user/UTC receipt day. Duplicate IDs do not consume quota; semantic duplicates do.';
comment on function public.record_blabee_product_event(
    uuid, timestamptz, text, uuid, text, text, text, text, text, text, text, text, text
) is 'Authenticated bounded opt-in metrics. True updates an aggregate; false acknowledges duplicate, unchanged state, or daily suppression. No user ID parameter.';

commit;

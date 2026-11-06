-- Add only the two explicitly requested, reviewed administrator accounts.
-- Run as the trusted database owner against the already installed dashboard.
-- Do not replay 001, 002, or the independently maintained UTM migration.
-- All account checks finish before any allowlist insert; any failure aborts
-- this entire transaction. Existing administrators and their timestamps remain.
begin;
do $$
declare
  requested record;
  matches integer;
  account_id uuid;
  confirmed boolean;
begin
  for requested in
    select * from (values
      ('hyunwoojoo.33@gmail.com'::text, '338752c1-9293-47eb-ab45-b9832348860f'::uuid),
      ('hn7742@gmail.com'::text, '642f7cfe-003e-4d63-9bfa-c25056b1325a'::uuid)
    ) as requested_accounts(email, expected_uid)
  loop
    -- Count all matches, including unconfirmed duplicates. Never silently
    -- select one account from a case-insensitive duplicate email set.
    select count(*)::integer, min(u.id::text)::uuid,
           bool_and(u.email_confirmed_at is not null)
      into matches, account_id, confirmed
    from auth.users u
    where lower(u.email) = requested.email;

    if matches <> 1 then
      raise exception 'Expected exactly one existing Auth account for each requested administrator; enrollment aborted';
    end if;
    if confirmed is not true then
      raise exception 'All requested administrator accounts must have confirmed email; enrollment aborted';
    end if;
    if account_id is distinct from requested.expected_uid then
      raise exception 'Requested administrator UID does not match the reviewed account; enrollment aborted';
    end if;
  end loop;

  insert into blabee_dashboard.owner_allowlist (user_id) values
    ('338752c1-9293-47eb-ab45-b9832348860f'::uuid),
    ('642f7cfe-003e-4d63-9bfa-c25056b1325a'::uuid)
  on conflict (user_id) do nothing;
end;
$$;
commit;

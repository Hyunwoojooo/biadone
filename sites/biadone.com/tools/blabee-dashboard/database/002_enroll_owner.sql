-- Run separately as the trusted database owner, after 001_dashboard.sql.
-- This enrolls only the existing, confirmed account requested by the owner.
-- Does not create an Auth account or grant access to other product users.
begin;
do $$
declare
  owner_id uuid;
  matches integer;
begin
  select count(*), min(id::text)::uuid into matches, owner_id
  from auth.users
  where lower(email) = 'biadone.official@gmail.com' and email_confirmed_at is not null;
  if matches <> 1 then
    raise exception 'Expected exactly one existing confirmed dashboard owner account; enrollment aborted';
  end if;
  insert into blabee_dashboard.owner_allowlist (user_id) values (owner_id)
  on conflict (user_id) do nothing;
end;
$$;
commit;

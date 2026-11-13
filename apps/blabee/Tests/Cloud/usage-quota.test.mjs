import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);

// Disposable in-memory PostgreSQL. Auth and pg_cron are minimal stand-ins:
// auth.uid() reads a session setting and cron.schedule only records the job.
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text,
      is_anonymous boolean not null default false, banned_until timestamptz, deleted_at timestamptz);
    create table auth.sessions (id uuid primary key,
      user_id uuid not null references auth.users (id) on delete cascade, not_after timestamptz);
    create table auth.identities (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade, provider text not null);
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid(), auth.jwt() to authenticated;
    create schema cron;
    create table cron.job (jobname text primary key, schedule text, command text);
    create function cron.schedule(name text, schedule text, command text) returns bigint language sql as $$
      insert into cron.job values (name, schedule, command); select 1::bigint $$;
  `);
  const directory = new URL('supabase/migrations/', root);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    // The cron stub stands in for the pg_cron extension, which PGlite lacks.
    const text = (await readFile(new URL(name, directory), 'utf8'))
      .replace(/^create extension if not exists pg_cron[^;]*;$/gim, '');
    try { await db.exec(text); }
    catch (error) { assert.fail(`${name}: ${error.code ?? 'unknown'} ${error.message}\n${error.where ?? ''}`); }
  }
  return db;
}

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
async function as(db, id, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const record = (db, id, eventID, kind = 'choice_accepted') => as(db, id,
  'select public.record_blabee_usage($1, $2, now()) as ok', [eventID, kind]).then(r => r.rows[0].ok);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('usage ingest is capped at 1000 new events per user and receipt day; duplicates use no quota', async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users (id) values ('${user}'), ('${other}');`);
    assert.equal(await record(db, user, uuid(1)), true);
    assert.equal(await record(db, user, uuid(1)), false, 'duplicate');
    for (let index = 2; index <= 1000; index++) assert.equal(await record(db, user, uuid(index)), true);
    assert.equal(await record(db, user, uuid(1001)), false, 'over quota');
    assert.equal(await record(db, other, uuid(1001)), true, 'other users keep their own quota');
    const counts = await db.query(`select
      (select accepted_count from blabee_analytics.usage_ingest_days where user_id = $1) as accepted,
      (select sum(action_count)::int from blabee_analytics.daily_activity where user_id = $1) as actions,
      (select count(*)::int from blabee_analytics.event_receipts where user_id = $1) as receipts`, [user]);
    assert.deepEqual(counts.rows[0], { accepted: 1000, actions: 1000, receipts: 1000 });
  } finally { await db.close(); }
});

test('callers cannot read the counter; delete_my_blabee_usage removes only the caller aggregates', async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users (id) values ('${user}'), ('${other}');`);
    await record(db, user, uuid(1)); await record(db, user, uuid(2), 'approval_resolved');
    await record(db, other, uuid(3));
    await assert.rejects(as(db, user, 'select * from blabee_analytics.usage_ingest_days'));
    await assert.rejects(db.query('select public.delete_my_blabee_usage()'), /Authentication required|permission/);
    const deleted = await as(db, user, 'select public.delete_my_blabee_usage() as deleted');
    assert.equal(Number(deleted.rows[0].deleted), 2);
    const left = await db.query(`select user_id::text, count(*)::int as n from blabee_analytics.daily_activity group by 1`);
    assert.deepEqual(left.rows, [{ user_id: other, n: 1 }]);
    // Receipts stay until housekeeping, so a deleted user cannot recount or reset quota.
    assert.equal(await record(db, user, uuid(1)), false);
    const quota = await db.query('select accepted_count from blabee_analytics.usage_ingest_days where user_id = $1', [user]);
    assert.equal(quota.rows[0].accepted_count, 2);
  } finally { await db.close(); }
});

test('usage housekeeping is scheduled and prunes old receipts and counters only', async () => {
  const db = await database();
  try {
    const jobs = await db.query('select jobname, command from cron.job order by jobname');
    assert.deepEqual(jobs.rows.map(row => row.jobname), ['blabee-error-retention-daily',
      'blabee-feedback-retention-daily', 'blabee-product-retention-daily', 'blabee-usage-retention-daily']);
    assert.match(jobs.rows[3].command, /prune_usage_event_receipts/);
    await db.exec(`insert into auth.users (id) values ('${user}');
      insert into blabee_analytics.event_receipts values ('${user}', '${uuid(1)}', now() - interval '9 days'),
        ('${user}', '${uuid(2)}', now() - interval '1 day');
      insert into blabee_analytics.usage_ingest_days values ('${user}', current_date - 10, 5), ('${user}', current_date, 1);`);
    const pruned = await db.query('select blabee_analytics.prune_usage_event_receipts() as n');
    assert.equal(Number(pruned.rows[0].n), 1);
    const remaining = await db.query(`select (select count(*)::int from blabee_analytics.event_receipts) as receipts,
      (select count(*)::int from blabee_analytics.usage_ingest_days) as days`);
    assert.deepEqual(remaining.rows[0], { receipts: 1, days: 1 });
  } finally { await db.close(); }
});

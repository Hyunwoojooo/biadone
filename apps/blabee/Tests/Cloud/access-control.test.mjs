import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);
const sql = (path) => readFile(new URL(path, root), 'utf8');

test('account access: SQL permissions, sessions, leases, admin audit and operator runbook', async () => {
  // Disposable in-memory PostgreSQL. These Auth tables model only the columns
  // used by the migration; this does not emulate JWT verification or GoTrue.
  const db = new PGlite();
  const execute = async (path) => {
    try { return await db.exec(await sql(path)); }
    catch (error) {
      assert.fail(`${path}: ${error.code ?? 'unknown'} ${error.message}\n${error.where ?? ''}`);
    }
  };
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (
        id uuid primary key, email text,
        is_anonymous boolean not null default false,
        banned_until timestamptz, deleted_at timestamptz
      );
      create table auth.sessions (
        id uuid primary key,
        user_id uuid not null references auth.users (id) on delete cascade,
        not_after timestamptz
      );
      create table auth.identities (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users (id) on delete cascade,
        provider text not null
      );
      create function auth.jwt() returns jsonb language sql stable as $$
        select nullif(current_setting('request.jwt.claims', true), '')::jsonb
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
          auth.jwt() ->> 'sub')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid(), auth.jwt() to authenticated;
    `);
    await execute('supabase/migrations/202609270001_blabee_access_control.sql');
    const results = await execute('supabase/tests/access-control.sql');
    const groups = results.flatMap(result => result.rows)
      .flatMap(row => row.access_test_passed ? [row.access_test_passed] : []);
    assert.deepEqual(groups, [
      'private permissions', 'anonymous and untrusted clients',
      'nonce and automatic provisioning', 'owner bootstrap audit',
      'individual suspension and audit', 'global pause and administrator recovery',
      'suspension before first use', 'social authentication required',
      'invalid claims', 'logout and session ownership',
      'Auth ban and soft deletion', 'bounded lease lifetime',
      'administrator input validation', 'audit failure rolls back changes',
      'administrator revocation', 'account deletion preserves audit',
    ]);
    const { rows } = await db.query(`
      select (select count(*) from auth.users)::integer as users,
        (select count(*) from blabee_access.user_access)::integer as access_rows,
        (select count(*) from blabee_access.admin_users)::integer as admins,
        (select count(*) from blabee_access.audit_events)::integer as audit_rows,
        (select paused from blabee_access.service_control where singleton) as paused
    `);
    assert.deepEqual(rows, [{ users: 0, access_rows: 0, admins: 0, audit_rows: 0, paused: false }],
      'SQL test fixtures must roll back, leaving only the migration defaults');

    // Execute the documented owner operations too: these are privileged writes,
    // so copied examples must preserve their audit and transaction boundaries.
    const operatorUser = 'a2000000-0000-4000-8000-000000000001';
    await db.query('insert into auth.users(id,email) values($1,$2)',
      [operatorUser, 'operator-fixture@example.invalid']);
    const runbook = await sql('docs/features/ACCESS_CONTROL_ADMIN.md');
    const snippets = [...runbook.matchAll(/```sql\n([\s\S]*?)\n```/g)].map(match => match[1]);
    assert.equal(snippets.length, 6, 'review newly added operator SQL before executing it in the test');
    for (const snippet of snippets) {
      await db.exec(snippet.replaceAll('00000000-0000-0000-0000-000000000000', operatorUser)
        .replaceAll('관리자 이메일로 교체', 'operator-fixture@example.invalid'));
    }
    const operatorResult = await db.query(`
      select (select status from blabee_access.user_access where user_id = $1) as status,
        (select enabled from blabee_access.admin_users where user_id = $1) as admin_enabled,
        (select paused from blabee_access.service_control where singleton) as paused,
        (select count(*)::integer from blabee_access.audit_events) as audit_rows,
        (select count(*)::integer from blabee_access.audit_events
          where actor_user_id is null and actor_session_id is null
            and actor_database_role = session_user) as owner_audit_rows
    `, [operatorUser]);
    assert.deepEqual(operatorResult.rows, [{
      status: 'suspended', admin_enabled: true, paused: false, audit_rows: 3, owner_audit_rows: 3,
    }]);
  } finally { await db.close(); }
});

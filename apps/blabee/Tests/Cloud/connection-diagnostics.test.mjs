import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);
const sql = (path) => readFile(new URL(path, root), 'utf8');

test('connection diagnostics upgrade: legacy compatibility, private RPC, quota, retention, reports', async () => {
  // Disposable in-memory PostgreSQL only. No network, auth tokens or real users.
  // pg_cron scheduling and multi-connection contention need deployment checks.
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key, email text, created_at timestamptz, updated_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    for (const path of [
      'supabase/migrations/202609170001_blabee_usage.sql',
      'supabase/migrations/202609170002_blabee_errors.sql',
      'supabase/tests/errors.sql',
    ]) await db.exec(await sql(path));
    // This fixture intentionally leaves a transaction open and installs a
    // frozen clock. Assert the real queries, then roll back before upgrading.
    await db.exec(await sql('supabase/tests/error-reports.sql'));
    const legacyReports = await db.exec(await sql('supabase/error-reports.sql'));
    await db.query('select pg_temp.assert_error_reports($1::jsonb,$2::jsonb,$3::jsonb)',
      legacyReports.map(result => JSON.stringify(result.rows)));
    await db.exec('rollback');
    await db.exec(await sql('supabase/migrations/202609240001_blabee_connection_diagnostics.sql'));
    await db.exec(await sql('supabase/tests/connection-diagnostics.sql'));

    const reports = await sql('supabase/connection-error-reports.sql');
    const results = await db.exec(reports.split('-- 3.')[0]);
    assert.equal(results.length, 2);
    assert.equal(results[0].rows.length, 0, 'test fixtures roll back');

    // Keep both client and database vocabularies closed and synchronized.
    const swift = await sql('app/telemetry/PetConnectionDiagnostics.swift');
    const migration = await sql('supabase/migrations/202609240001_blabee_connection_diagnostics.sql');
    const literals = [...swift.matchAll(/= "([a-z]+_[a-z_]+)"/g)].map(m => m[1]);
    for (const literal of new Set(literals)) assert.ok(migration.includes(`'${literal}'`), literal);
  } finally { await db.close(); }
});

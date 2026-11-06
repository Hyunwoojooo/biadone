// Disposable database checks only. No network, production dependencies, or live SQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { handlePosts } from '../server/posts.mjs';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const dashboardSql = await read('../database/001_dashboard.sql');
const enrollmentSql = await read('../database/002_enroll_owner.sql');
const preflightSql = await read('../database/000_preflight.sql');
const verificationSql = await read('../database/003_verify_connection.sql');
const additionalAdminsSql = await read('../database/004_enroll_additional_admins.sql');
const signupSql = await read('../../../supabase/migrations/202609240001_blabee_beta_requests.sql');
const trackingSql = await read('../../../supabase/migrations/202610170001_blabee_landing_attribution.sql');

async function setup({ source = 'tracking', enroll = true, ownerUid = owner } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users values
      ('${ownerUid}', 'biadone.official@gmail.com', now()),
      ('${other}', 'ordinary@example.invalid', now());
  `);
  if (source !== 'none') await db.exec(signupSql);
  if (source === 'tracking') await db.exec(trackingSql);
  const preflight = await db.exec(preflightSql);
  const objects = preflight.flatMap((result) => result.rows).find((row) => 'dashboard_schema' in row);
  assert.equal(objects.dashboard_schema, null);
  assert.equal(objects.overview_rpc, null);
  assert.equal(objects.posts_rpc, null);
  assert.equal(preflight.flatMap((result) => result.rows).find((row) => 'confirmed_owner_matches' in row).confirmed_owner_matches, 1);
  await db.exec(dashboardSql);
  if (enroll) await db.exec(enrollmentSql);
  return db;
}

async function identity(db, role, uid = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec(`set role ${role}`);
}

async function overview(db, start = '2026-01-01', end = '2026-01-04') {
  const { rows } = await db.query('select public.blabee_dashboard_overview($1::date, $2::date) as result', [start, end]);
  return rows[0].result;
}

async function posts(db, action = 'list', post = null, id = null) {
  const { rows } = await db.query('select public.blabee_dashboard_posts($1, $2::jsonb, $3::uuid) as result', [action, post === null ? null : JSON.stringify(post), id]);
  return rows[0].result;
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error.code === code, `Expected PostgreSQL ${code}`);
}

test('default-deny installation, independent owner guard, private tables, and restricted RPC grants', async () => {
  const db = await setup({ source: 'none', enroll: false });
  try {
    const owners = await db.query('select count(*)::int as count from blabee_dashboard.owner_allowlist');
    assert.equal(owners.rows[0].count, 0);
    for (const role of ['anon', 'service_role']) {
      await identity(db, role, owner);
      await rejectsCode(overview(db), '42501');
      await rejectsCode(posts(db), '42501');
    }
    await identity(db, 'authenticated', owner);
    await rejectsCode(overview(db), '42501');
    await rejectsCode(posts(db), '42501');

    await db.exec('reset role');
    await db.exec(enrollmentSql);
    await identity(db, 'authenticated', other);
    await rejectsCode(overview(db), '42501');
    await rejectsCode(posts(db), '42501');
    await identity(db, 'authenticated');
    await rejectsCode(overview(db), '42501');

    await identity(db, 'authenticated', owner);
    assert.deepEqual((await posts(db)).posts, []);
    for (const table of ['owner_allowlist', 'source_bounds', 'posts']) {
      await rejectsCode(db.query(`select * from blabee_dashboard.${table}`), '42501');
    }
    const grants = await db.query(`
      select has_function_privilege('authenticated', 'public.blabee_dashboard_overview(date,date)', 'EXECUTE') as authenticated,
        has_function_privilege('anon', 'public.blabee_dashboard_overview(date,date)', 'EXECUTE') as anon,
        has_function_privilege('service_role', 'public.blabee_dashboard_overview(date,date)', 'EXECUTE') as service,
        has_function_privilege('authenticated', 'public.blabee_dashboard_posts(text,jsonb,uuid)', 'EXECUTE') as authenticated_posts,
        has_function_privilege('anon', 'public.blabee_dashboard_posts(text,jsonb,uuid)', 'EXECUTE') as anon_posts,
        has_function_privilege('service_role', 'public.blabee_dashboard_posts(text,jsonb,uuid)', 'EXECUTE') as service_posts
    `);
    assert.deepEqual(grants.rows[0], { authenticated: true, anon: false, service: false, authenticated_posts: true, anon_posts: false, service_posts: false });
    await db.exec('reset role');
    const security = await db.query(`
      select p.proname, p.prosecdef, p.proconfig from pg_proc p
      where p.oid in ('public.blabee_dashboard_overview(date,date)'::regprocedure,
        'public.blabee_dashboard_posts(text,jsonb,uuid)'::regprocedure)
    `);
    assert.equal(security.rows.length, 2);
    for (const row of security.rows) {
      assert.equal(row.prosecdef, true);
      assert.ok(row.proconfig.includes('search_path=""'));
    }
    const rls = await db.query("select relrowsecurity from pg_class where relnamespace = 'blabee_dashboard'::regnamespace and relkind = 'r'");
    assert.equal(rls.rows.length, 3);
    assert.ok(rls.rows.every((row) => row.relrowsecurity));
  } finally { await db.close(); }
});

test('owner enrollment fails closed for missing, unconfirmed, or ambiguous accounts', async () => {
  const db = await setup({ source: 'none', enroll: false });
  try {
    await db.exec('update auth.users set email_confirmed_at = null');
    await rejectsCode(db.exec(enrollmentSql), 'P0001');
    await db.exec('rollback');
    let { rows } = await db.query('select count(*)::int as count from blabee_dashboard.owner_allowlist');
    assert.equal(rows[0].count, 0);
    await db.exec(`update auth.users set email_confirmed_at = now(); update auth.users set email = 'BIADONE.OFFICIAL@GMAIL.COM' where id = '${other}';`);
    await rejectsCode(db.exec(enrollmentSql), 'P0001');
    await db.exec('rollback');
    ({ rows } = await db.query('select count(*)::int as count from blabee_dashboard.owner_allowlist'));
    assert.equal(rows[0].count, 0);
    await db.exec(`delete from auth.users where id = '${other}';`);
    await db.exec(enrollmentSql);
    await db.exec(enrollmentSql);
    ({ rows } = await db.query('select user_id from blabee_dashboard.owner_allowlist'));
    assert.deepEqual(rows, [{ user_id: owner }]);
  } finally { await db.close(); }
});

const originalAdministrator = 'b0723835-2e5f-488c-b12e-dc50bf1cdc66';
const additionalAdministrators = [
  { id: '338752c1-9293-47eb-ab45-b9832348860f', email: 'hyunwoojoo.33@gmail.com' },
  { id: '642f7cfe-003e-4d63-9bfa-c25056b1325a', email: 'hn7742@gmail.com' },
];

async function addAdministratorFixtures(db, rows = additionalAdministrators) {
  for (const row of rows) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,$3)', [
      row.id, row.email, row.confirmed === false ? null : '2026-01-01T00:00:00Z',
    ]);
  }
}

test('additional administrator enrollment preserves existing owner, is idempotent, and restricts all read paths', async () => {
  const db = await setup({ ownerUid: originalAdministrator });
  try {
    await addAdministratorFixtures(db, additionalAdministrators.map((row) => ({ ...row, email: row.email.toUpperCase() })));
    await db.exec(`
      insert into blabee_marketing.landing_daily_views(day,attribution,views)
      values ('2026-01-02',blabee_marketing.normalize_attribution('{"utm_source":"reddit"}'),5);
      insert into blabee_marketing.beta_requests(email,created_at)
      values ('isolated-admin-check@example.invalid','2026-01-02T00:00:00Z');
    `);
    const original = (await db.query('select user_id,enrolled_at from blabee_dashboard.owner_allowlist')).rows;
    const authCount = (await db.query('select count(*)::int as n from auth.users')).rows[0].n;
    await db.exec(additionalAdminsSql);
    const first = (await db.query('select user_id,enrolled_at from blabee_dashboard.owner_allowlist order by user_id')).rows;
    assert.deepEqual(first.map((row) => row.user_id), [originalAdministrator, ...additionalAdministrators.map((row) => row.id)].sort());
    assert.deepEqual(first.find((row) => row.user_id === originalAdministrator), original[0]);
    await db.exec(additionalAdminsSql);
    assert.deepEqual((await db.query('select user_id,enrolled_at from blabee_dashboard.owner_allowlist order by user_id')).rows, first);
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, authCount);

    for (const id of [originalAdministrator, ...additionalAdministrators.map((row) => row.id)]) {
      await identity(db, 'authenticated', id);
      const data = await overview(db);
      assert.equal(data.daily.reduce((sum, row) => sum + (row.page_views ?? 0), 0), 5);
      assert.equal(data.daily.reduce((sum, row) => sum + (row.new_beta_requests ?? 0), 0), 1);
      assert.deepEqual((await posts(db)).posts, []);
      for (const table of ['owner_allowlist', 'source_bounds', 'posts']) {
        await rejectsCode(db.query(`select * from blabee_dashboard.${table}`), '42501');
      }
    }
    await identity(db, 'authenticated', other);
    await rejectsCode(overview(db), '42501');
    await rejectsCode(posts(db), '42501');
    for (const role of ['anon', 'service_role']) {
      await identity(db, role, additionalAdministrators[0].id);
      await rejectsCode(overview(db), '42501');
      await rejectsCode(posts(db), '42501');
      await rejectsCode(db.query('select * from blabee_dashboard.posts'), '42501');
    }
  } finally { await db.close(); }
});

test('additional administrator enrollment fails atomically for either missing, unconfirmed, mismatched, or duplicate account', async () => {
  const wrongId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for (const invalidIndex of [0, 1]) {
    for (const condition of ['missing', 'unconfirmed', 'uid_mismatch', 'case_insensitive_duplicate']) {
      const db = await setup({ source: 'none', ownerUid: originalAdministrator });
      try {
        const rows = additionalAdministrators.flatMap((row, index) => {
          if (index !== invalidIndex) return [{ ...row }];
          if (condition === 'missing') return [];
          if (condition === 'unconfirmed') return [{ ...row, confirmed: false }];
          if (condition === 'uid_mismatch') return [{ ...row, id: wrongId }];
          // An unconfirmed duplicate also counts: filtering confirmed accounts
          // before counting would silently accept an ambiguous email set.
          return [{ ...row }, { ...row, id: wrongId, email: row.email.toUpperCase(), confirmed: false }];
        });
        await addAdministratorFixtures(db, rows);
        const before = (await db.query('select user_id,enrolled_at from blabee_dashboard.owner_allowlist order by user_id')).rows;
        await rejectsCode(db.exec(additionalAdminsSql), 'P0001');
        await db.exec('rollback');
        const after = (await db.query('select user_id,enrolled_at from blabee_dashboard.owner_allowlist order by user_id')).rows;
        assert.deepEqual(after, before, `${condition} for account ${invalidIndex} must preserve the complete previous allowlist`);
        assert.deepEqual(after.map((row) => row.user_id), [originalAdministrator]);
        for (const row of additionalAdministrators) {
          await identity(db, 'authenticated', row.id);
          await rejectsCode(overview(db), '42501');
          await rejectsCode(posts(db), '42501');
        }
        await identity(db, 'authenticated', originalAdministrator);
        assert.deepEqual((await posts(db)).posts, []);
      } finally { await db.close(); }
    }
  }
});

test('missing tracking is unavailable, legacy signup attribution stays unmeasured, and install order is independent', async () => {
  const db = await setup({ source: 'none' });
  try {
    await identity(db, 'authenticated', owner);
    let result = await overview(db);
    assert.equal(result.coverage.page_views.status, 'unavailable');
    assert.equal(result.coverage.new_beta_requests.status, 'unavailable');
    assert.equal(result.capabilities.signup_attribution, false);
    assert.equal(result.daily.length, 3);
    assert.ok(result.daily.every((row) => row.page_views === null && row.new_beta_requests === null && row.attribution === null));
    await db.exec('reset role');
    await db.exec(signupSql);
    await db.exec("insert into blabee_marketing.beta_requests(email,created_at) values ('legacy@example.invalid','2026-01-02T12:00:00Z')");
    await identity(db, 'authenticated', owner);
    result = await overview(db);
    const legacy = result.daily.find((row) => row.day === '2026-01-02');
    assert.equal(legacy.new_beta_requests, 1);
    assert.equal(legacy.attribution.source, 'unmeasured');
    assert.equal(legacy.attribution.source_type, 'unmeasured');
    assert.equal(legacy.page_views, null);
    assert.equal(result.capabilities.daily_beta_requests, true);
    assert.equal(result.capabilities.signup_attribution, false);
    await db.exec('reset role');
    await db.exec(trackingSql);
    await identity(db, 'authenticated', owner);
    result = await overview(db);
    assert.equal(result.capabilities.daily_page_views, true);
    assert.equal(result.capabilities.signup_attribution, true);
    assert.equal(result.coverage.page_views.status, 'unverified');
    assert.equal(result.daily.find((row) => row.day === '2026-01-02').attribution.source, 'unmeasured');
    await db.exec('reset role');
    await db.exec('alter table blabee_marketing.landing_daily_views rename column views to not_views');
    await identity(db, 'authenticated', owner);
    result = await overview(db);
    assert.equal(result.capabilities.daily_page_views, false);
    assert.equal(result.coverage.page_views.status, 'unavailable');
    assert.ok(result.daily.every((row) => row.page_views === null));
  } finally { await db.close(); }
});

test('real source data uses inclusive/exclusive UTC boundaries, first signup only, and preserves attribution', async () => {
  const db = await setup();
  try {
    await db.exec(`
      set timezone = 'Pacific/Honolulu';
      insert into blabee_marketing.landing_daily_views(day,attribution,views) values
        ('2025-12-31',blabee_marketing.normalize_attribution('{"utm_source":"x"}'),999),
        ('2026-01-01',blabee_marketing.normalize_attribution('{"utm_source":"x","utm_medium":"social","utm_campaign":"launch","utm_content":"a"}'),7),
        ('2026-01-01',blabee_marketing.normalize_attribution('{"utm_source":"x","utm_medium":"social","utm_campaign":"launch","utm_content":"b"}'),3),
        ('2026-01-03',blabee_marketing.normalize_attribution('{}'),5),
        ('2026-01-04',blabee_marketing.normalize_attribution('{"utm_source":"x"}'),999);
      insert into blabee_marketing.beta_requests(email,created_at,attribution) values
        ('before@example.invalid','2025-12-31T23:59:59.999999Z',null),
        ('start@example.invalid','2026-01-01T00:00:00Z',blabee_marketing.normalize_attribution('{"utm_source":"x","utm_medium":"social","utm_campaign":"launch","utm_content":"a"}')),
        ('legacy@example.invalid','2026-01-02T01:00:00Z',null),
        ('last@example.invalid','2026-01-03T23:59:59.999999Z',blabee_marketing.normalize_attribution('{}')),
        ('after@example.invalid','2026-01-04T00:00:00Z',null);
      select public.request_blabee_beta_tracked('START@example.invalid','{"utm_source":"reddit"}');
    `);
    await identity(db, 'authenticated', owner);
    const result = await overview(db);
    assert.equal(result.timezone, 'UTC');
    assert.equal(result.scope.id, 'blabee_landings_combined');
    assert.equal(result.daily.reduce((sum, row) => sum + (row.page_views ?? 0), 0), 15);
    assert.equal(result.daily.reduce((sum, row) => sum + (row.new_beta_requests ?? 0), 0), 3);
    const first = result.daily.find((row) => row.day === '2026-01-01' && row.attribution.content === 'a');
    assert.equal(first.page_views, 7);
    assert.equal(first.new_beta_requests, 1);
    const second = result.daily.find((row) => row.day === '2026-01-01' && row.attribution.content === 'b');
    assert.equal(second.page_views, 3);
    assert.equal(second.new_beta_requests, null);
    assert.equal(result.daily.find((row) => row.day === '2026-01-02').attribution.source, 'unmeasured');
    assert.equal(result.daily.find((row) => row.day === '2026-01-03').attribution.source, 'direct_or_unknown');
    assert.equal(result.coverage.page_views.status, 'unverified');
    assert.equal(result.coverage.page_views.collector_status, 'unknown');
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('@'));
    assert.ok(!serialized.includes('email'));
    for (const feature of ['hourly', 'sessions', 'conversion_rate']) assert.equal(result.capabilities[feature], false);

    // Execute the shipped read-only connection check against nonzero current
    // observations, rather than validating only a copied query or empty table.
    await db.exec('reset role');
    await db.exec(`
      insert into blabee_marketing.landing_daily_views(day,attribution,views)
      values ((now() at time zone 'UTC')::date,blabee_marketing.normalize_attribution('{"utm_source":"x","utm_campaign":"verify-file"}'),11);
      insert into blabee_marketing.beta_requests(email,created_at)
      values ('verify-file@example.invalid',now());
    `);
    const verification = await db.exec(verificationSql);
    const checks = verification.flatMap((entry) => entry.rows);
    const reconciliation = checks.find((row) => 'views_match' in row);
    assert.equal(reconciliation.views_match, true);
    assert.equal(reconciliation.signups_match, true);
    assert.ok(Number(reconciliation.recorded_views) >= 11);
    assert.ok(Number(reconciliation.recorded_signups) >= 1);
    assert.equal(checks.filter((row) => 'grants_match' in row).length, 6);
    assert.ok(checks.filter((row) => 'grants_match' in row).every((row) => row.grants_match));
    assert.equal(checks.filter((row) => 'raw_access' in row).length, 9);
    assert.ok(checks.filter((row) => 'raw_access' in row).every((row) => row.relrowsecurity && !row.schema_usage && !row.raw_access && row.client_policy_count === 0));
    assert.equal(checks.find((row) => 'authenticated_post_rows' in row).authenticated_post_rows, 0);
    assert.ok(checks.find((row) => 'authenticated_daily_rows' in row).authenticated_daily_rows >= 7);
    assert.equal((await db.query('select current_user as name')).rows[0].name, 'postgres');
  } finally { await db.close(); }
});

test('verified collection bounds alone allow completed-day zeros, not current-day health claims', async () => {
  const db = await setup();
  try {
    await identity(db, 'authenticated', owner);
    let result = await overview(db);
    assert.ok(result.daily.every((row) => row.page_views === null && row.new_beta_requests === null));
    await db.exec('reset role');
    await db.exec(`
      insert into blabee_dashboard.source_bounds(metric,verified_start_day,verified_end_day,evidence_note) values
        ('page_views','2026-01-02','2026-01-04','Isolated fixture completeness'),
        ('new_beta_requests','2026-01-01','2026-01-04','Isolated fixture completeness');
    `);
    await identity(db, 'authenticated', owner);
    result = await overview(db);
    assert.equal(result.daily[0].page_views, null);
    assert.equal(result.daily[0].new_beta_requests, 0);
    assert.equal(result.daily[1].page_views, 0);
    assert.equal(result.daily[1].new_beta_requests, 0);
    assert.equal(result.coverage.page_views.status, 'partial');
    assert.equal(result.coverage.new_beta_requests.status, 'verified');
    result = await overview(db, '2026-01-02', '2026-01-04');
    assert.equal(result.coverage.page_views.status, 'verified');
    assert.equal(result.coverage.page_views.collector_status, 'unknown');
    result = await overview(db, '2026-01-05', '2026-01-06');
    assert.equal(result.coverage.page_views.status, 'unverified');
    assert.equal(result.daily[0].page_views, null);
    await db.exec('reset role');
    await db.exec("update blabee_dashboard.source_bounds set verified_start_day = (now() at time zone 'UTC')::date - 1, verified_end_day = (now() at time zone 'UTC')::date + 1");
    const { rows } = await db.query("select (now() at time zone 'UTC')::date::text as today, ((now() at time zone 'UTC')::date + 1)::text as tomorrow");
    await identity(db, 'authenticated', owner);
    result = await overview(db, rows[0].today, rows[0].tomorrow);
    assert.equal(result.coverage.page_views.status, 'partial');
    assert.equal(result.daily[0].page_views, null);
    assert.equal(result.daily[0].new_beta_requests, null);
  } finally { await db.close(); }
});

test('date range validation rejects null, reversed, excessive, and future bounds', async () => {
  const db = await setup({ source: 'none' });
  try {
    await identity(db, 'authenticated', owner);
    for (const [start, end] of [[null, '2026-01-01'], ['2026-01-01', null], ['2026-01-01', '2026-01-01'], ['2026-01-04', '2026-01-01'], ['2026-01-01', '2026-04-02'], ['2999-01-01', '2999-01-02']]) {
      await rejectsCode(overview(db, start, end), '22023');
    }
    await rejectsCode(overview(db, '2026-02-30', '2026-03-01'), '22008');
    assert.equal((await overview(db, '2026-01-01', '2026-04-01')).daily.length, 90);
  } finally { await db.close(); }
});

const validPost = (overrides = {}) => ({
  channel: 'reddit', title: 'First promotion', url: 'https://www.reddit.com/r/example/comments/abc',
  published_at: '2026-01-02T09:30:00+09:00', content_format: 'post', link_placement: 'body', notes: '<script>as plain text</script>',
  external_refs: { platform_id: 'abc' }, source: 'reddit', medium: 'social', campaign: 'launch', content: 'a',
  ...overrides,
});

test('owner registry supports CRUD, partial updates, opaque references, duplicate mappings, and original offsets', async () => {
  const db = await setup();
  try {
    await db.exec(`
      insert into blabee_marketing.beta_requests(email,created_at,attribution) values
        ('preserved@example.invalid','2026-01-02T00:00:00Z',blabee_marketing.normalize_attribution('{"utm_source":"reddit","utm_medium":"social","utm_campaign":"launch","utm_content":"a"}'));
      insert into blabee_marketing.landing_daily_views(day,attribution,views) values
        ('2026-01-02',blabee_marketing.normalize_attribution('{"utm_source":"reddit","utm_medium":"social","utm_campaign":"launch","utm_content":"a"}'),7);
    `);
    const before = await db.query('select count(*)::int as count from blabee_marketing.beta_requests');
    await identity(db, 'authenticated', owner);
    const created = (await posts(db, 'create', validPost())).post;
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(new Date(created.published_at).toISOString(), '2026-01-02T00:30:00.000Z');
    assert.equal(created.published_offset_minutes, 540);
    assert.equal(created.notes, '<script>as plain text</script>');
    assert.deepEqual(created.external_refs, { platform_id: 'abc' });
    const shared = (await posts(db, 'create', validPost({ title: 'Shared link', published_at: '2026-01-03T12:00:00-05:00' }))).post;
    assert.equal(shared.published_offset_minutes, -300);
    let listed = (await posts(db)).posts;
    assert.deepEqual(listed.map((row) => row.id), [shared.id, created.id]);
    assert.equal(listed[0].source, listed[1].source);
    assert.equal(listed[0].content, listed[1].content);
    // Two registry rows sharing one explicit mapping do not duplicate the
    // observed source counts. No registry join is allowed to inflate overview.
    const measured = await overview(db);
    assert.equal(measured.daily.reduce((sum, row) => sum + (row.page_views ?? 0), 0), 7);
    assert.equal(measured.daily.reduce((sum, row) => sum + (row.new_beta_requests ?? 0), 0), 1);
    const updated = (await posts(db, 'update', { title: 'Revised title' }, created.id)).post;
    assert.equal(updated.title, 'Revised title');
    assert.equal(updated.published_offset_minutes, 540);
    assert.equal(updated.external_refs.platform_id, 'abc');
    const remapped = (await posts(db, 'update', { source: null, medium: null, campaign: null, content: null, external_refs: {} }, created.id)).post;
    assert.equal(remapped.source, null);
    const changedTime = (await posts(db, 'update', { published_at: '2026-01-02T02:30:00Z', published_offset_minutes: 0 }, created.id)).post;
    assert.equal(changedTime.published_offset_minutes, 0);
    const deleted = await posts(db, 'delete', null, created.id);
    assert.deepEqual(deleted, { deleted: true, id: created.id });
    await rejectsCode(posts(db, 'delete', null, created.id), 'P0002');
    listed = (await posts(db)).posts;
    assert.deepEqual(listed.map((row) => row.id), [shared.id]);
    await db.exec('reset role');
    const after = await db.query('select count(*)::int as count from blabee_marketing.beta_requests');
    assert.equal(after.rows[0].count, before.rows[0].count);
    const views = await db.query('select sum(views)::int as count from blabee_marketing.landing_daily_views');
    assert.equal(views.rows[0].count, 7);
  } finally { await db.close(); }
});

test('direct RPC callers cannot bypass registry validation or mutate read-only fields', async () => {
  const db = await setup({ source: 'none' });
  try {
    await identity(db, 'authenticated', owner);
    const invalid = [
      { channel: 'Reddit' }, { channel: '' }, { title: '' }, { title: ' '.repeat(4) }, { title: 'a'.repeat(201) },
      { url: 'javascript:alert(1)' }, { url: 'file:///tmp/a' }, { url: 'https://user:password@example.com' }, { url: 'https://example.com/a\n' },
      { published_at: '2026-01-02T10:00:00' }, { published_at: '2026-02-30T10:00:00Z' }, { published_at: '2026-01-02T24:00:00Z' },
      { published_at: '2026-01-02T10:00:00+99:00' }, { published_at: '2026-01-02T10:00:00+09:70' }, { published_offset_minutes: 0 },
      { published_offset_minutes: 1.5 }, { published_offset_minutes: '540' }, { published_offset_minutes: null }, { published_offset_minutes: {} },
      { title: 10 }, { notes: 'a'.repeat(4001) }, { notes: 'a'.repeat(4500) }, { content_format: 'a'.repeat(81) }, { external_refs: [] },
      { external_refs: { id: { nested: true } } }, { external_refs: { 'bad key': 'a' } }, { external_refs: { id: 'a'.repeat(501) } },
      { external_refs: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`id${index}`, 'a'])) },
      { source: null }, { source: 'a'.repeat(81) }, { created_at: '2026-01-01T00:00:00Z' }, { id: owner },
    ];
    for (const override of invalid) await rejectsCode(posts(db, 'create', validPost(override)), '22023');
    await rejectsCode(posts(db, 'create', null), '22023');
    await rejectsCode(posts(db, 'create', []), '22023');
    await rejectsCode(posts(db, 'replace', {}), '22023');
    await rejectsCode(posts(db, 'update', { title: 'a' }), '22023');
    await rejectsCode(posts(db, 'update', { title: 'a' }, other), 'P0002');
    await rejectsCode(posts(db, 'delete', null, 'invalid-uuid'), '22P02');
    const emptyDimensions = (await posts(db, 'create', validPost({ medium: '', campaign: '', content: '' }))).post;
    assert.equal(emptyDimensions.content, '');
    assert.equal((await posts(db)).posts.length, 1);
  } finally { await db.close(); }
});

test('real Pages handler and SQL round-trip minute timestamps, offsets, and identical text limits', async () => {
  const db = await setup({ source: 'none' });
  const token = 'e30.e30.c2ln';
  const env = { SUPABASE_URL: 'https://dashboard-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dashboard_test', DASHBOARD_OWNER_UID: owner };
  const rpcCalls = [];
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    if (url === `${env.SUPABASE_URL}/auth/v1/user`) {
      return json({ id: owner, email: 'biadone.official@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' });
    }
    assert.equal(url, `${env.SUPABASE_URL}/rest/v1/rpc/blabee_dashboard_posts`);
    const args = JSON.parse(init.body);
    rpcCalls.push(args);
    await identity(db, 'authenticated', owner);
    try { return json(await posts(db, args.p_action, args.p_post, args.p_post_id)); }
    catch (error) { return json({ code: error.code }, error.code === '42501' ? 403 : 400); }
  };
  const api = (method = 'GET', body, id) => handlePosts({
    env,
    request: new Request(`https://analytics.example.test/api/admin/posts${id ? `?id=${id}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  }, { fetchImpl });
  try {
    // Exercise the production handler against the actual SQL rather than a
    // hand-written stored-row fixture, including inputs with no seconds.
    for (const [stamp, offset, instant] of [
      ['2026-10-17T12:30Z', 0, '2026-10-17T12:30:00.000Z'],
      ['2026-10-17T12:30+09:00', 540, '2026-10-17T03:30:00.000Z'],
      ['2026-10-17T12:30-05:00', -300, '2026-10-17T17:30:00.000Z'],
    ]) {
      const input = validPost({ published_at: stamp, notes: 'a'.repeat(4000) });
      const result = await api('POST', input);
      const body = await result.json();
      assert.equal(result.status, 201, JSON.stringify(body));
      assert.equal(body.post.published_offset_minutes, offset);
      assert.equal(new Date(body.post.published_at).toISOString(), instant);
      assert.equal(body.post.notes.length, 4000);
      assert.equal(rpcCalls.at(-1).p_post.published_at, stamp);
      assert.equal(rpcCalls.at(-1).p_post.published_offset_minutes, offset);
      const update = await api('PUT', { ...input, title: 'Updated from API', notes: 'b'.repeat(4000) }, body.post.id);
      assert.equal(update.status, 200, JSON.stringify(await update.json()));
    }
    let result = await api();
    assert.equal(result.status, 200);
    assert.equal((await result.json()).posts.length, 3);

    const beforeInvalid = rpcCalls.length;
    for (const length of [4001, 4500]) {
      result = await api('POST', validPost({ notes: 'a'.repeat(length) }));
      assert.equal(result.status, 400);
      assert.equal((await result.json()).error.code, 'INVALID_POST');
    }
    assert.equal(rpcCalls.length, beforeInvalid, 'API rejects long notes before calling SQL');

    await identity(db, 'authenticated', owner);
    for (const override of [
      { notes: 'a'.repeat(4001) }, { notes: 'a'.repeat(4500) }, { notes: '🌳'.repeat(2001) },
      { title: '🌳'.repeat(101) }, { title: '\u00a0'.repeat(3) }, { title: 'Unexpected\nline' }, { title: '\u0001bad' },
      { content_format: '🌳'.repeat(41) }, { link_placement: '🌳'.repeat(41) },
      { source: 'REDDIT' }, { medium: 'social campaign' },
      { external_refs: { id: '🌳'.repeat(251) } }, { external_refs: { id: '\u0001bad' } },
    ]) await rejectsCode(posts(db, 'create', validPost(override)), '22023');

    // At the shared UTF-16 boundaries, SQL-created rows remain readable by the
    // real API. A supplementary character consumes two JavaScript code units.
    await posts(db, 'create', validPost({
      title: '🌳'.repeat(100), notes: '🌳'.repeat(2000), content_format: '🌳'.repeat(40),
      link_placement: '🌳'.repeat(40), external_refs: { id: '🌳'.repeat(250) },
    }));
    result = await api();
    const listed = await result.json();
    assert.equal(result.status, 200, JSON.stringify(listed));
    assert.equal(listed.posts.length, 4, 'Rejected direct RPC payloads never poison later API reads');
    const unicode = listed.posts.find((row) => row.title.startsWith('🌳'));
    assert.equal(unicode.title.length, 200);
    assert.equal(unicode.notes.length, 4000);
    assert.equal(unicode.external_refs.id.length, 500);
  } finally { await db.close(); }
});

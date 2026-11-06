import test from 'node:test';
import assert from 'node:assert/strict';
import { handleConfig } from '../server/config.mjs';
import { handleOverview, normalizeOverview } from '../server/overview.mjs';
import { handlePosts, validatePost } from '../server/posts.mjs';
import { readConfig } from '../server/auth.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const POST_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'e30.e30.c2ln';
const NOW = new Date('2026-10-17T12:00:00.000Z');
const ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key', DASHBOARD_OWNER_UID: OWNER };
const ADMIN_UIDS = ['b0723835-2e5f-488c-b12e-dc50bf1cdc66', '338752c1-9293-47eb-ab45-b9832348860f', '642f7cfe-003e-4d63-9bfa-c25056b1325a'];
const PLURAL_ENV = { ...ENV, DASHBOARD_OWNER_UIDS: ADMIN_UIDS.join(',') };
const RANGE = { start_day: '2026-10-13', end_day: '2026-10-18' };
const FILTERS = { channel: null, campaign: null };
const URL_BASE = 'https://analytics.example.test';

function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function request(path = '/api/admin/overview?start=2026-10-13&end=2026-10-18', options = {}) {
  return new Request(`${URL_BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, ...options.headers } });
}
function attribution(source, overrides = {}) {
  return { source, source_type: 'utm', medium: 'social', campaign: 'beta', content: 'post-01', referrer_host: '', ...overrides };
}
function rawOverview(overrides = {}) {
  const unverified = { status: 'unverified', available: true, verified_start_day: null, verified_end_day: null, collector_status: 'unknown' };
  return {
    version: 1, generated_at: NOW.toISOString(), timezone: 'UTC', range: RANGE,
    scope: { id: 'blabee_landings_combined', label: 'Blabee 랜딩 합산' },
    coverage: { page_views: { ...unverified }, new_beta_requests: { ...unverified } },
    capabilities: { daily_page_views: true, daily_beta_requests: true, signup_attribution: true, hourly: false, sessions: false, conversion_rate: false },
    daily: [
      { day: '2026-10-14', attribution: attribution('reddit'), page_views: 12, new_beta_requests: 1 },
      { day: '2026-10-15', attribution: attribution('old.reddit.com', { source_type: 'referrer', medium: 'referral', campaign: '', content: '', referrer_host: 'old.reddit.com' }), page_views: 3, new_beta_requests: null },
      { day: '2026-10-16', attribution: attribution('unmeasured', { source_type: 'unmeasured', medium: '', campaign: '', content: '' }), page_views: null, new_beta_requests: 1 },
      { day: '2026-10-17', attribution: attribution('x', { campaign: 'launch' }), page_views: 5, new_beta_requests: 0 },
    ],
    ...overrides,
  };
}
function fetchSequence(...handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const handler = handlers[calls.length - 1];
    assert.ok(handler, `Unexpected network call ${url}`);
    return typeof handler === 'function' ? handler(url, init) : handler;
  };
  return { calls, fetchImpl };
}
function authUser(id = OWNER) { return response({ id, email: 'private-owner@example.test' }); }
function assertPrivate(result) {
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(result.headers.get('Vary'), /Authorization/);
}
async function callOverview(mock, req = request(), env = ENV) {
  return handleOverview({ request: req, env }, { fetchImpl: mock.fetchImpl, now: () => NOW });
}
function post(overrides = {}) {
  return { channel: 'reddit', title: 'Blabee launch', published_at: '2026-10-17T21:30:00+09:00', url: 'https://reddit.com/r/example/comments/demo', content_format: 'text', link_placement: 'body', notes: '', external_refs: { platform_post: 'opaque-post-id' }, source: 'reddit', medium: 'social', campaign: 'beta', content: 'post-01', ...overrides };
}
function storedPost(overrides = {}) {
  return { id: POST_ID, ...post(), published_at: '2026-10-17T12:30:00+00:00', published_offset_minutes: 540, created_at: '2026-10-17T12:31:00+00:00', updated_at: '2026-10-17T12:31:00+00:00', ...overrides };
}

test('public config returns only URL and public key; incomplete or privileged-key config fails closed', async () => {
  const result = await handleConfig({ request: request('/api/config'), env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'never-return-this-secret' } });
  assertPrivate(result);
  assert.deepEqual(await result.json(), { configured: true, supabase: { url: ENV.SUPABASE_URL, publishableKey: ENV.SUPABASE_PUBLISHABLE_KEY } });
  for (const env of [{ ...ENV, DASHBOARD_OWNER_UID: '' }, { ...ENV, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_return' }, { ...ENV, SUPABASE_URL: 'http://project.supabase.co' }, { ...ENV, DASHBOARD_OWNER_UID: 'typo', DASHBOARD_OWNER_EMAIL: 'valid@example.test' }]) {
    const res = await handleConfig({ request: request('/api/config'), env });
    assert.deepEqual(await res.json(), { configured: false, supabase: null });
  }
});

test('plural owner configuration takes precedence, normalizes UUIDs, and stays out of public config', async () => {
  const env = { ...PLURAL_ENV, DASHBOARD_OWNER_UIDS: ` ${ADMIN_UIDS[0].toUpperCase()}, ${ADMIN_UIDS[1]},${ADMIN_UIDS[1].toUpperCase()}, ${ADMIN_UIDS[2]} `, DASHBOARD_OWNER_UID: 'ignored-invalid-legacy-uid', DASHBOARD_OWNER_EMAIL: 'private-admin@example.test' };
  const config = readConfig(env);
  assert.deepEqual(config.ownerUids, ADMIN_UIDS);
  assert.equal(config.ownerUid, null);
  assert.deepEqual(readConfig(ENV).ownerUids, [OWNER]);
  assert.equal(readConfig(ENV).ownerUid, OWNER);
  const result = await handleConfig({ request: request('/api/config'), env });
  assertPrivate(result);
  const publicResult = await result.json();
  assert.deepEqual(publicResult, { configured: true, supabase: { url: ENV.SUPABASE_URL, publishableKey: ENV.SUPABASE_PUBLISHABLE_KEY } });
  for (const uid of ADMIN_UIDS) assert.ok(!JSON.stringify(publicResult).includes(uid));
  assert.doesNotMatch(JSON.stringify(publicResult), /private-admin|OWNER|ownerUid/);
});

test('each allowlisted UID can read aggregates and use all post registry operations', async () => {
  for (const id of ADMIN_UIDS) {
    const overview = fetchSequence(authUser(id.toUpperCase()), response(rawOverview()));
    assert.equal((await callOverview(overview, request(), PLURAL_ENV)).status, 200);
    assert.equal(overview.calls.length, 2);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const raw = method === 'GET' ? { posts: [storedPost()] } : method === 'DELETE' ? { deleted: true, id: POST_ID } : { post: storedPost() };
      const mock = fetchSequence(authUser(id), response(raw));
      const hasBody = method === 'POST' || method === 'PUT';
      const options = { method, ...(hasBody ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post()) } : {}) };
      const path = `/api/admin/posts${method === 'PUT' || method === 'DELETE' ? `?id=${POST_ID}` : ''}`;
      const result = await handlePosts({ request: request(path, options), env: PLURAL_ENV }, { fetchImpl: mock.fetchImpl });
      assert.equal(result.status, method === 'POST' ? 201 : 200, `${id} ${method}`);
      assertPrivate(result);
      assert.equal(mock.calls.length, 2);
    }
  }
});

test('plural mode rejects outside and legacy-only UIDs despite a matching confirmed fallback email', async () => {
  const env = { ...PLURAL_ENV, DASHBOARD_OWNER_EMAIL: 'owner@example.test' };
  for (const id of [OTHER, OWNER]) {
    const user = { id, email: 'owner@example.test', email_confirmed_at: NOW.toISOString() };
    const overview = fetchSequence(response(user));
    assert.equal((await callOverview(overview, request(), env)).status, 403);
    assert.equal(overview.calls.length, 1);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const mock = fetchSequence(response(user));
      const result = await handlePosts({ request: request('/api/admin/posts', { method }), env }, { fetchImpl: mock.fetchImpl });
      assert.equal(result.status, 403, `${id} ${method}`);
      assertPrivate(result);
      assert.equal(mock.calls.length, 1, 'failed authorization must not query or mutate the registry');
    }
  }
});

test('any present invalid plural owner list fails closed without legacy/email fallback or source requests', async () => {
  for (const value of ['', ' ', null, undefined, 123, [], {}, `${ADMIN_UIDS[0]},`, `,${ADMIN_UIDS[0]}`, `${ADMIN_UIDS[0]},,${ADMIN_UIDS[1]}`, `${ADMIN_UIDS[0]},invalid`, ADMIN_UIDS.join(';')]) {
    const env = { ...ENV, DASHBOARD_OWNER_UIDS: value, DASHBOARD_OWNER_EMAIL: 'owner@example.test' };
    assert.equal(readConfig(env), null);
    const publicResult = await handleConfig({ request: request('/api/config'), env });
    assert.deepEqual(await publicResult.json(), { configured: false, supabase: null });
    const overview = fetchSequence();
    const result = await callOverview(overview, request(), env);
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, 'DASHBOARD_NOT_CONFIGURED');
    assert.equal(overview.calls.length, 0);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const mock = fetchSequence();
      const denied = await handlePosts({ request: request('/api/admin/posts', { method }), env }, { fetchImpl: mock.fetchImpl });
      assert.equal(denied.status, 503);
      assert.equal(mock.calls.length, 0);
    }
  }
});

test('missing/malformed auth never calls Supabase or the aggregate RPC', async () => {
  for (const authorization of ['', 'Bearer malformed', 'Basic abc', `Bearer ${TOKEN} trailing`]) {
    const mock = fetchSequence();
    const result = await callOverview(mock, request(undefined, { headers: { Authorization: authorization } }));
    assert.equal(result.status, 401);
    assertPrivate(result);
    assert.equal(mock.calls.length, 0);
  }
});

test('unconfigured owner fails closed and marks authentication uncertain', async () => {
  const mock = fetchSequence();
  const result = await callOverview(mock, request(), { ...ENV, DASHBOARD_OWNER_UID: '' });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).auth_uncertain, true);
  assert.equal(mock.calls.length, 0);
});

test('expired token and nonowner each stop after Auth verification', async () => {
  for (const [auth, status] of [[response({ message: 'expired private token' }, 401), 401], [authUser(OTHER), 403]]) {
    const mock = fetchSequence(auth);
    const result = await callOverview(mock);
    assert.equal(result.status, status);
    assertPrivate(result);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${ENV.SUPABASE_URL}/auth/v1/user`);
    assert.equal(mock.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(mock.calls[0].init.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
    assert.doesNotMatch(await result.text(), /private token|private-owner|email/);
  }
});

test('known bad_jwt Auth responses return 401 without leaking source details or querying data', async () => {
  for (const [status, error] of [[400, { code: 400, error_code: 'bad_jwt' }], [400, { code: 'bad_jwt' }], [403, { code: 403, error_code: 'bad_jwt' }]]) {
    const mock = fetchSequence(response({ ...error, msg: `invalid JWT: ${TOKEN}; private@example.test` }, status));
    const result = await callOverview(mock);
    assert.equal(result.status, 401);
    assertPrivate(result);
    const body = await result.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.equal(body.auth_uncertain, undefined);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${ENV.SUPABASE_URL}/auth/v1/user`);
    assert.doesNotMatch(JSON.stringify(body), /invalid JWT|e30\.e30\.c2ln|private@example|bad_jwt/);
  }
});

test('other Auth 400 bodies and upstream outages remain authentication unavailable', async () => {
  for (const upstream of [
    response({ code: 400, error_code: 'bad_json', msg: `private: ${TOKEN}` }, 400),
    response({ code: 400, msg: 'invalid JWT: no structured error code' }, 400),
    new Response('malformed upstream body', { status: 400 }),
    response({ code: 'bad_jwt', msg: 'source unavailable' }, 500),
  ]) {
    const mock = fetchSequence(upstream);
    const result = await callOverview(mock);
    assert.equal(result.status, 503);
    assertPrivate(result);
    const body = await result.json();
    assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
    assert.equal(body.auth_uncertain, true);
    assert.equal(mock.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(body), /private:|e30\.e30\.c2ln|invalid JWT|malformed upstream|source unavailable/);
  }
});

test('bad_jwt-shaped errors from the data source do not become Auth failures', async () => {
  const mock = fetchSequence(authUser(), response({ code: 'bad_jwt', message: `private: ${TOKEN}` }, 400));
  const result = await callOverview(mock);
  assert.equal(result.status, 503);
  const body = await result.json();
  assert.equal(body.error.code, 'DATA_SOURCE_UNAVAILABLE');
  assert.equal(body.auth_uncertain, undefined);
  assert.equal(mock.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(body), /private:|e30\.e30\.c2ln|bad_jwt/);
});

test('email fallback requires the exact confirmed account, while configured UID takes precedence', async () => {
  const env = { ...ENV, DASHBOARD_OWNER_UID: '', DASHBOARD_OWNER_EMAIL: 'owner@example.test' };
  for (const [user, status] of [
    [{ id: OWNER, email: 'owner@example.test' }, 403],
    [{ id: OWNER, email: 'other@example.test', email_confirmed_at: NOW.toISOString() }, 403],
    [{ id: OWNER, email: 'OWNER@example.test', email_confirmed_at: NOW.toISOString() }, 200],
  ]) {
    const mock = fetchSequence(response(user), response(rawOverview()));
    const result = await callOverview(mock, request(), env);
    assert.equal(result.status, status);
    assert.equal(mock.calls.length, status === 200 ? 2 : 1);
  }
  const mock = fetchSequence(response({ id: OTHER, email: 'owner@example.test', email_confirmed_at: NOW.toISOString() }));
  assert.equal((await callOverview(mock, request(), { ...ENV, DASHBOARD_OWNER_EMAIL: 'owner@example.test' })).status, 403);
});

test('Auth network, malformed JSON, and malformed user failures never return data', async () => {
  for (const handler of [() => { throw new Error('private upstream message'); }, new Response('broken'), response({ id: 'not-a-uuid' })]) {
    const mock = fetchSequence(handler);
    const result = await callOverview(mock);
    assert.ok([502, 503].includes(result.status));
    const body = await result.json();
    assert.equal(body.auth_uncertain, true);
    assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
    assert.equal(mock.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(body), /private upstream/);
  }
});

test('Auth redirects use manual mode and stop without following or exposing the target', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const mock = fetchSequence(new Response(JSON.stringify({ error_code: 'bad_jwt', msg: `private: ${TOKEN}` }), {
      status, headers: { Location: `https://unexpected.example.test/login?token=${TOKEN}` },
    }));
    const result = await callOverview(mock);
    assert.equal(result.status, 503, String(status));
    assertPrivate(result);
    assert.equal(result.headers.get('Location'), null);
    const body = await result.json();
    assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
    assert.equal(body.auth_uncertain, true);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${ENV.SUPABASE_URL}/auth/v1/user`);
    assert.equal(mock.calls[0].init.redirect, 'manual');
    assert.doesNotMatch(JSON.stringify(body), /unexpected\.example|e30\.e30\.c2ln|bad_jwt|private:/);
  }
});

test('data redirects use manual mode and remain unavailable regardless of their body code', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const mock = fetchSequence(authUser(), new Response(JSON.stringify({ code: '22023', message: `private: ${TOKEN}` }), {
      status, headers: { Location: `https://unexpected.example.test/rpc?token=${TOKEN}` },
    }));
    const result = await callOverview(mock);
    assert.equal(result.status, 503, String(status));
    assertPrivate(result);
    assert.equal(result.headers.get('Location'), null);
    const body = await result.json();
    assert.equal(body.error.code, 'DATA_SOURCE_UNAVAILABLE');
    assert.equal(body.auth_uncertain, undefined);
    assert.equal(mock.calls.length, 2);
    assert.ok(mock.calls.every(call => call.init.redirect === 'manual'));
    assert.equal(mock.calls[1].url, `${ENV.SUPABASE_URL}/rest/v1/rpc/blabee_dashboard_overview`);
    assert.doesNotMatch(JSON.stringify(body), /unexpected\.example|e30\.e30\.c2ln|22023|private:/);
  }
});

test('cross-origin requests are refused without auth or admin calls', async () => {
  for (const headers of [{ Origin: 'https://other.example.test' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const mock = fetchSequence();
    const result = await callOverview(mock, request(undefined, { headers }));
    assert.equal(result.status, 403);
    assertPrivate(result);
    assert.equal(mock.calls.length, 0);
  }
  const mock = fetchSequence(authUser(), response(rawOverview()));
  assert.equal((await callOverview(mock, request(undefined, { headers: { Origin: URL_BASE, 'Sec-Fetch-Site': 'same-origin' } }))).status, 200);
});

test('the verified user token, never a service key, calls the fixed aggregate RPC', async () => {
  const mock = fetchSequence(authUser(), response(rawOverview()));
  const result = await callOverview(mock);
  assert.equal(result.status, 200);
  assertPrivate(result);
  assert.equal(mock.calls[1].url, `${ENV.SUPABASE_URL}/rest/v1/rpc/blabee_dashboard_overview`);
  assert.equal(mock.calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(mock.calls[1].init.body), { p_start_day: RANGE.start_day, p_end_day: RANGE.end_day });
  assert.equal(mock.calls[1].init.cache, 'no-store');
  assert.equal(mock.calls[1].init.redirect, 'manual');
  const body = await result.json();
  assert.equal(body.metrics.page_views.value, 20);
  assert.equal(body.metrics.new_beta_requests.value, 2);
  assert.equal(body.metrics.signup_attribution.value, 0.5);
  assert.equal(body.capabilities.conversion_rate, false);
  assert.doesNotMatch(JSON.stringify(body), /private-owner|Bearer|sb_publishable/);
});

test('missing dates stay null; known zero and UTC calendar boundaries remain distinct', () => {
  const body = normalizeOverview(rawOverview(), RANGE, FILTERS, NOW);
  assert.deepEqual(body.daily.map(row => row.day), ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.equal(body.daily[0].page_views, null);
  assert.equal(body.daily[0].status.page_views, 'missing');
  assert.equal(body.daily[4].new_beta_requests, 0);
  assert.equal(body.daily[4].status.new_beta_requests, 'collecting');
  assert.equal(body.daily[4].bucket_start, '2026-10-17T00:00:00.000Z');
  assert.equal(body.daily[4].bucket_end, '2026-10-18T00:00:00.000Z');
  assert.equal(body.metrics.page_views.status, 'partial');
});

test('only owner-confirmed past coverage can turn absent counts into zero', () => {
  const raw = rawOverview({ daily: [] });
  for (const metric of ['page_views', 'new_beta_requests']) raw.coverage[metric] = { status: 'partial', available: true, verified_start_day: '2026-10-13', verified_end_day: '2026-10-18', collector_status: 'unknown' };
  const body = normalizeOverview(raw, RANGE, FILTERS, NOW);
  assert.equal(body.daily[0].page_views, 0);
  assert.equal(body.daily[3].new_beta_requests, 0);
  assert.equal(body.daily[4].page_views, null, 'today must not be certified complete');
});

test('explicit null sibling rows keep known daily, card and channel sums marked partial', () => {
  const range = { start_day: '2026-10-14', end_day: '2026-10-15' };
  const raw = rawOverview({ range, daily: [
    { day: range.start_day, attribution: attribution('reddit'), page_views: 10, new_beta_requests: 2 },
    { day: range.start_day, attribution: attribution('reddit', { referrer_host: 'x.com' }), page_views: null, new_beta_requests: null },
  ] });
  for (const filters of [FILTERS, { channel: 'reddit', campaign: 'beta' }]) {
    const body = normalizeOverview(raw, range, filters, NOW);
    assert.deepEqual(body.metrics.page_views, { value: 10, status: 'partial' });
    assert.deepEqual(body.metrics.new_beta_requests, { value: 2, status: 'partial' });
    assert.equal(body.metrics.signup_attribution.status, 'partial');
    assert.deepEqual(body.daily[0].status, { page_views: 'partial', new_beta_requests: 'partial' });
    assert.equal(body.daily[0].page_views, 10);
    assert.equal(body.daily[0].new_beta_requests, 2);
    assert.deepEqual(body.channels[0].status, { page_views: 'partial', new_beta_requests: 'partial' });
    assert.equal(body.channels[0].page_views, 10);
    assert.equal(body.source_daily[1].page_views, null, 'raw missing observations must remain null');
  }
  for (const metric of ['page_views', 'new_beta_requests']) raw.coverage[metric] = {
    status: 'verified', available: true, verified_start_day: range.start_day, verified_end_day: range.end_day, collector_status: 'unknown',
  };
  const covered = normalizeOverview(raw, range, FILTERS, NOW);
  assert.deepEqual(covered.metrics.page_views, { value: 10, status: 'verified' });
  assert.deepEqual(covered.daily[0].status, { page_views: 'verified', new_beta_requests: 'verified' });
  assert.deepEqual(covered.channels[0].status, { page_views: 'verified', new_beta_requests: 'verified' });
});

test('today status does not hide explicit missing sibling values behind collecting', () => {
  const range = { start_day: '2026-10-17', end_day: '2026-10-18' };
  const raw = rawOverview({ range, daily: [
    { day: range.start_day, attribution: attribution('x'), page_views: 10, new_beta_requests: 1 },
    { day: range.start_day, attribution: attribution('x', { content: 'post-02' }), page_views: null, new_beta_requests: null },
  ] });
  const body = normalizeOverview(raw, range, FILTERS, NOW);
  assert.equal(body.daily[0].is_today, true);
  assert.equal(body.daily[0].status.page_views, 'partial');
  assert.equal(body.metrics.page_views.status, 'partial');
  assert.equal(body.channels[0].status.page_views, 'partial');
});

test('channel/campaign filters apply to cards and timeline, preserving source distinctions', async () => {
  const mock = fetchSequence(authUser(), response(rawOverview()));
  const result = await callOverview(mock, request('/api/admin/overview?start=2026-10-13&end=2026-10-18&channel=reddit&campaign=beta'));
  const body = await result.json();
  assert.equal(body.metrics.page_views.value, 12);
  assert.equal(body.metrics.new_beta_requests.value, 1);
  assert.equal(body.channels.length, 1);
  assert.equal(body.channels[0].id, 'reddit');
  assert.equal(body.source_daily[0].attribution.source, 'reddit');
  assert.ok(body.filter_options.channels.some(channel => channel.id === 'x'));
  const unfiltered = normalizeOverview(rawOverview(), RANGE, FILTERS, NOW);
  assert.equal(unfiltered.channels.find(channel => channel.id === 'reddit').page_views, 15);
  assert.ok(unfiltered.source_daily.some(row => row.attribution.source === 'old.reddit.com' && row.attribution.source_type === 'referrer'));
});

test('literal all source/campaign values and an empty campaign are real filters, while absent parameters mean unfiltered', async () => {
  const range = { start_day: '2026-10-14', end_day: '2026-10-15' };
  const raw = rawOverview({ range, daily: [
    { day: range.start_day, attribution: attribution('all', { campaign: 'all' }), page_views: 7, new_beta_requests: 1 },
    { day: range.start_day, attribution: attribution('reddit', { campaign: 'all' }), page_views: 11, new_beta_requests: 2 },
    { day: range.start_day, attribution: attribution('all', { campaign: '' }), page_views: 13, new_beta_requests: 3 },
    { day: range.start_day, attribution: attribution('x', { campaign: 'beta' }), page_views: 17, new_beta_requests: 4 },
  ] });
  for (const [query, filters, expectedViews, expectedSignups] of [
    ['', { channel: null, campaign: null }, 48, 10],
    ['&channel=all', { channel: 'all', campaign: null }, 20, 4],
    ['&campaign=all', { channel: null, campaign: 'all' }, 18, 3],
    ['&channel=all&campaign=all', { channel: 'all', campaign: 'all' }, 7, 1],
    ['&campaign=', { channel: null, campaign: '' }, 13, 3],
  ]) {
    const mock = fetchSequence(authUser(), response(raw));
    const result = await callOverview(mock, request(`/api/admin/overview?start=${range.start_day}&end=${range.end_day}${query}`));
    assert.equal(result.status, 200, query);
    const body = await result.json();
    assert.deepEqual(body.filters, filters, query);
    assert.equal(body.metrics.page_views.value, expectedViews, query);
    assert.equal(body.metrics.new_beta_requests.value, expectedSignups, query);
    assert.equal(body.daily[0].page_views, expectedViews, query);
  }
});

test('unsupported signup dimension and absent source objects remain unavailable', () => {
  const raw = rawOverview();
  raw.capabilities.signup_attribution = false;
  raw.coverage.page_views = { status: 'unavailable', available: false, verified_start_day: null, verified_end_day: null, collector_status: 'unknown' };
  const body = normalizeOverview(raw, RANGE, { channel: 'reddit', campaign: null }, NOW);
  assert.deepEqual(body.metrics.page_views, { value: null, status: 'unavailable' });
  assert.deepEqual(body.metrics.new_beta_requests, { value: null, status: 'unavailable' });
  assert.ok(body.daily.every(row => row.page_views === null && row.new_beta_requests === null));
});

test('invalid dates, oversized ranges, future dates, unsupported grain and unknown filters never query data', async () => {
  for (const query of [
    'start=2026-02-30&end=2026-03-01', 'start=2026-10-17',
    'start=2026-01-01&end=2026-10-18', 'start=2026-10-18&end=2026-10-19',
    'start=2026-10-17&end=2026-10-17', 'grain=hour', 'owner_id=anything',
    'channel=reddit&channel=x', 'channel=%3Cscript%3E', 'campaign=a%20b', 'channel=__all__', 'campaign=__all__',
  ]) {
    const mock = fetchSequence(authUser());
    const result = await callOverview(mock, request(`/api/admin/overview?${query}`));
    assert.equal(result.status, 400, query);
    assert.equal(mock.calls.length, 1, query);
  }
});

test('raw malformed totals, duplicate tuples and wrong timezone are rejected instead of rendered', async () => {
  for (const raw of [rawOverview({ timezone: 'Asia/Seoul' }), rawOverview({ daily: [...rawOverview().daily, rawOverview().daily[0]] }), rawOverview({ daily: [{ day: '2026-10-14', attribution: attribution('reddit'), page_views: -1, new_beta_requests: 0 }] })]) {
    const mock = fetchSequence(authUser(), response(raw));
    const result = await callOverview(mock);
    assert.equal(result.status, 502);
    assert.equal((await result.json()).error.code, 'INVALID_SOURCE_DATA');
  }
});

test('source errors never leak upstream email, token or SQL content', async () => {
  const mock = fetchSequence(authUser(), response({ message: 'SELECT email FROM applicants; private@example.test', token: 'secret' }, 500));
  const result = await callOverview(mock);
  assert.equal(result.status, 503);
  assertPrivate(result);
  assert.doesNotMatch(await result.text(), /SELECT|private@example|secret/);
});

test('post create sends parameterized metadata and preserves original UTC offset', async () => {
  const mock = fetchSequence(authUser(), (url, init) => {
    assert.equal(url, `${ENV.SUPABASE_URL}/rest/v1/rpc/blabee_dashboard_posts`);
    const args = JSON.parse(init.body);
    assert.equal(args.p_action, 'create');
    assert.equal(args.p_post_id, null);
    assert.equal(args.p_post.published_offset_minutes, 540);
    assert.equal(args.p_post.content, 'post-01');
    assert.equal(args.p_post.external_refs.platform_post, 'opaque-post-id');
    return response({ post: storedPost({ ...args.p_post, published_at: '2026-10-17T12:30:00+00:00' }), email: 'never-return@example.test' });
  });
  const result = await handlePosts({ request: request('/api/admin/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post()) }), env: ENV }, { fetchImpl: mock.fetchImpl });
  assert.equal(result.status, 201);
  assertPrivate(result);
  const saved = (await result.json()).post;
  assert.equal(saved.published_at, '2026-10-17T21:30:00.000+09:00');
  assert.equal(saved.published_offset_minutes, 540);
  assert.equal(saved.email, undefined);
});

test('post list sorting and UTC date filter use the instant rather than local calendar labels', async () => {
  const mock = fetchSequence(authUser(), response({ posts: [
    storedPost({ id: OTHER, title: 'Previous UTC day', published_at: '2026-10-17T00:30:00+09:00', published_offset_minutes: 540 }),
    storedPost({ title: 'Selected UTC day' }),
  ] }));
  const result = await handlePosts({ request: request('/api/admin/posts?start=2026-10-17&end=2026-10-18&channel=reddit'), env: ENV }, { fetchImpl: mock.fetchImpl, now: () => NOW });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).posts.map(item => item.title), ['Selected UTC day']);
});

test('post list treats explicit all channel and campaign as literal filters', async () => {
  const mock = fetchSequence(authUser(), response({ posts: [
    storedPost({ channel: 'all', source: 'all', campaign: 'all', title: 'Literal all' }),
    storedPost({ id: OTHER, title: 'Another channel and campaign' }),
  ] }));
  const result = await handlePosts({ request: request('/api/admin/posts?channel=all&campaign=all'), env: ENV }, { fetchImpl: mock.fetchImpl });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).posts.map(item => item.title), ['Literal all']);
});

test('post validation rejects unsafe URLs, partial mappings, invalid calendars and unknown fields', () => {
  for (const input of [
    post({ url: 'javascript:alert(1)' }), post({ url: 'data:text/html,anything' }),
    post({ url: 'https://user:password@example.test' }), post({ source: null }),
    post({ published_at: '2026-02-30T12:30:00Z' }), post({ published_at: '2026-10-17T12:30' }),
    post({ published_at: '2026-10-17T12:30:00+14:30' }), post({ published_offset_minutes: 0 }),
    post({ owner_uid: OWNER }), post({ external_refs: { bad: { object: true } } }),
  ]) assert.throws(() => validatePost(input), error => error.code === 'INVALID_POST');
  assert.deepEqual(validatePost(post({ source: null, medium: null, campaign: null, content: null })).source, null);
  assert.equal(validatePost(post({ source: 'reddit', medium: '', campaign: '', content: '' })).campaign, '');
});

test('invalid and oversized CRUD input never reaches the posts RPC', async () => {
  const inputs = [
    { method: 'POST', body: JSON.stringify(post({ url: 'file:///private' })), headers: { 'Content-Type': 'application/json' }, status: 400 },
    { method: 'POST', body: JSON.stringify(post()), headers: { 'Content-Type': 'text/plain' }, status: 415 },
    { method: 'POST', body: '{bad JSON', headers: { 'Content-Type': 'application/json' }, status: 400 },
    { method: 'POST', body: JSON.stringify(post({ notes: 'a'.repeat(20_000) })), headers: { 'Content-Type': 'application/json' }, status: 413 },
    { method: 'DELETE', body: undefined, headers: {}, status: 400 },
  ];
  for (const { status, ...input } of inputs) {
    const mock = fetchSequence(authUser());
    const result = await handlePosts({ request: request('/api/admin/posts', input), env: ENV }, { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, status);
    assertPrivate(result);
    assert.equal(mock.calls.length, 1);
  }
});

test('post update and delete use only validated IDs and fixed actions', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const mock = fetchSequence(authUser(), (_url, init) => {
      const args = JSON.parse(init.body);
      assert.equal(args.p_post_id, POST_ID);
      assert.equal(args.p_action, method === 'PUT' ? 'update' : 'delete');
      return response(method === 'PUT' ? { post: storedPost() } : { deleted: true, id: POST_ID });
    });
    const options = method === 'PUT' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post()) } : { method };
    const result = await handlePosts({ request: request(`/api/admin/posts?id=${POST_ID}`, options), env: ENV }, { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 200);
    assertPrivate(result);
  }
});

test('all post methods deny nonowners before attempting a registry query', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const mock = fetchSequence(authUser(OTHER));
    const result = await handlePosts({ request: request('/api/admin/posts', { method }), env: ENV }, { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 403);
    assert.equal(mock.calls.length, 1);
  }
});

test('missing registry rows map PostgreSQL P0002 to 404 regardless of upstream transport status', async () => {
  const mock = fetchSequence(authUser(), response({ code: 'P0002', message: 'private SQL detail' }, 500));
  const result = await handlePosts({ request: request(`/api/admin/posts?id=${POST_ID}`, { method: 'DELETE' }), env: ENV }, { fetchImpl: mock.fetchImpl });
  assert.equal(result.status, 404);
  assert.equal((await result.json()).error.code, 'POST_NOT_FOUND');
});

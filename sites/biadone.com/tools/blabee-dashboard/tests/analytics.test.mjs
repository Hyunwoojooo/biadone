import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalytics } from '../server/analytics.mjs';
import { handleConfig } from '../server/config.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const JWT = 'e30.e30.c2ln';
const SECRET = 'test-only-cloudflare-secret-never-disclose';
const NOW = new Date('2026-10-17T13:35:00.000Z');
const ENV = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key', DASHBOARD_OWNER_UID: OWNER };
const SETTINGS = {
  enabled: true, maxDuration: 30 * 86_400, notOlderThan: 31 * 86_400, maxPageSize: 10_000, maxNumberOfFields: 40,
  availableFields: ['count', 'sum_visits', 'avg_sampleInterval', 'dimensions_datetimeHour', 'dimensions_clientCountryName', 'dimensions_userAgentBrowser', 'dimensions_userAgentOS'],
};

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function request(query = 'start=2026-10-11&end=2026-10-18', headers = {}) {
  return new Request(`https://biadone.com/blabee/admin/api/admin/analytics?${query}`, { headers: { Authorization: `Bearer ${JWT}`, ...headers } });
}
function gate(start = '2026-10-11') {
  const coverage = { status: 'unverified', available: true, verified_start_day: null, verified_end_day: null, collector_status: 'unknown' };
  return {
    version: 1, timezone: 'UTC', scope: { id: 'blabee_landings_combined' },
    range: { start_day: start, end_day: new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) },
    coverage: { page_views: coverage, new_beta_requests: coverage },
    capabilities: { daily_page_views: true, daily_beta_requests: true, signup_attribution: true },
    daily: [],
  };
}
function sequence(...responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const value = responses[calls.length - 1];
      assert.ok(value, `Unexpected external request: ${url}`);
      return typeof value === 'function' ? value(url, init) : value;
    },
  };
}
async function call(mock, { req = request(), env = ENV, providerTimeoutMs = 10_000 } = {}) {
  const response = await handleAnalytics({ request: req, env }, { fetchImpl: mock.fetchImpl, now: () => NOW, providerTimeoutMs });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  return { response, body: await response.json() };
}
function cf(value, errors = null) { return json({ data: { viewer: { zones: [value] } }, errors }); }
function measurement(count, visits, sample = 1, dimensions) {
  return { count, sum: { visits }, avg: { sampleInterval: sample }, ...(dimensions ? { dimensions } : {}) };
}
function sourceData(overrides = {}) {
  return {
    totals: [measurement(186, 158, 1.25)], previous: [measurement(100, 80)],
    hourly: [measurement(100, 90, 1.25, { datetimeHour: '2026-10-11T00:00:00Z' }), measurement(50, 40, 1, { datetimeHour: '2026-10-12T00:00:00Z' }), measurement(36, 28, 1, { datetimeHour: '2026-10-17T13:00:00Z' })],
    countries: [measurement(100, 90, 1.25, { clientCountryName: 'KR' }), measurement(70, 56, 1, { clientCountryName: 'US' }), measurement(10, 8, 1, { clientCountryName: 'T1' }), measurement(6, 4, 1, { clientCountryName: 'XX' })],
    browsers: [measurement(100, 90, 1.25, { userAgentBrowser: 'Chrome' }), measurement(51, 40, 1, { userAgentBrowser: 'ChromeHeadless' }), measurement(35, 28, 1, { userAgentBrowser: 'Unknown' })],
    operatingSystems: [measurement(100, 90, 1.25, { userAgentOS: 'MacOSX' }), measurement(70, 56, 1, { userAgentOS: 'Windows' }), measurement(16, 12, 1, { userAgentOS: 'Unknown' })],
    ...overrides,
  };
}
function providerSequence(data = sourceData(), settings = SETTINGS) {
  return sequence(json({ id: OWNER }), json(gate()), cf({ settings: { httpRequestsAdaptiveGroups: settings } }), cf(data));
}
const CONNECTED_ENV = { ...ENV, CF_ANALYTICS_API_TOKEN: SECRET };
const ROTATED_SECRET = 'test-only-rotated-cloudflare-secret-never-disclose';
const ACCOUNT_VERIFY = 'https://api.cloudflare.com/client/v4/accounts/94217884f3a123f7d12341dbc556751c/tokens/verify';
const USER_VERIFY = 'https://api.cloudflare.com/client/v4/user/tokens/verify';
function verification(status = 'active', extra = {}) {
  return json({ success: true, errors: [], result: { id: 'private-verification-id', status, ...extra } });
}

test('missing Cloudflare credentials returns a protected structured state with null totals after both owner checks', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate()));
  const { response, body } = await call(mock);
  assert.equal(response.status, 200);
  assert.equal(body.status, 'not_configured');
  assert.deepEqual(body.scope.paths, ['/blabee', '/blabee/']);
  assert.equal(body.scope.host, 'biadone.com');
  assert.equal(body.range.end_at, NOW.toISOString());
  assert.equal(body.metrics.page_views.value, null);
  assert.equal(body.metrics.visits.value, null);
  assert.deepEqual(body.series, []);
  assert.deepEqual(body.hourly.rows, []);
  assert.deepEqual(body.breakdowns.countries.rows, []);
  assert.equal(body.source.sampled, null);
  assert.equal(body.diagnostic_trace, undefined);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(JSON.parse(mock.calls[1].init.body), { p_start_day: '2026-10-11', p_end_day: '2026-10-12' });
});

test('end dates remain exclusive UTC boundaries for completed periods', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate('2026-10-13')));
  const { body } = await call(mock, { req: request('start=2026-10-13&end=2026-10-14') });
  assert.equal(body.range.start_at, '2026-10-13T00:00:00.000Z');
  assert.equal(body.range.end_at, '2026-10-14T00:00:00.000Z');
  assert.equal(body.timezone, 'UTC');
});

test('missing, expired and nonowner tokens never reach Cloudflare or the database gate', async () => {
  for (const [req, responses, expected] of [
    [request(undefined, { Authorization: '' }), [], 401],
    [request(), [json({ error_code: 'bad_jwt' }, 403)], 401],
    [request(), [json({ id: OTHER })], 403],
    [request(undefined, { Origin: 'https://untrusted.example' }), [], 403],
  ]) {
    const mock = sequence(...responses);
    const { response } = await call(mock, { req, env: { ...ENV, CF_ANALYTICS_API_TOKEN: SECRET } });
    assert.equal(response.status, expected);
    assert.equal(mock.calls.length, responses.length);
    assert.ok(mock.calls.every(item => item.url.endsWith('/auth/v1/user')));
  }
});

test('database owner revocation or invalid gate output stops access even when the server UID matches', async () => {
  for (const [db, expected] of [[json({ code: '42501', message: 'private detail' }, 403), 403], [json({ invalid: true }), 502]]) {
    const mock = sequence(json({ id: OWNER }), db);
    const { response, body } = await call(mock, { env: { ...ENV, CF_ANALYTICS_API_TOKEN: SECRET } });
    assert.equal(response.status, expected);
    assert.equal(mock.calls.length, 2);
    assert.doesNotMatch(JSON.stringify(body), /private detail|test-only-cloudflare/);
  }
});

test('unknown filters, invalid dates and ranges over 90 days stop before provider calls', async () => {
  for (const query of ['start=2026-01-01&end=2026-10-18', 'start=2026-02-30&end=2026-03-01', 'start=2026-10-11&end=2026-10-18&channel=reddit', 'start=2026-10-11&end=2026-10-18&query=arbitrary', 'start=2026-10-11&start=2026-10-12&end=2026-10-18']) {
    const mock = sequence(json({ id: OWNER }));
    const { response } = await call(mock, { req: request(query) });
    assert.equal(response.status, 400);
    assert.equal(mock.calls.length, 1);
  }
});

test('public configuration never returns the Cloudflare runtime credential', async () => {
  const response = await handleConfig({ request: new Request('https://biadone.com/blabee/admin/api/config'), env: { ...ENV, CF_ANALYTICS_API_TOKEN: SECRET, CF_ANALYTICS_API_TOKEN_V2: ROTATED_SECRET } });
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['configured', 'supabase']);
  assert.doesNotMatch(JSON.stringify(body), /cloudflare|CF_ANALYTICS|test-only/);
});

test('the new secret binding takes precedence for every provider request without disclosing either value', async () => {
  for (const base of [ENV, CONNECTED_ENV]) {
    const mock = providerSequence();
    const { body } = await call(mock, { env: { ...base, CF_ANALYTICS_API_TOKEN_V2: ROTATED_SECRET } });
    assert.equal(body.status, 'ready');
    assert.equal(mock.calls.length, 4);
    for (const provider of mock.calls.slice(2)) assert.equal(provider.init.headers.Authorization, `Bearer ${ROTATED_SECRET}`);
    assert.doesNotMatch(JSON.stringify(body), /test-only|CF_ANALYTICS_API_TOKEN/);
  }
});

test('an explicitly configured unusable new binding does not fall back to the old credential', async () => {
  for (const value of ['', '  ', undefined, null, `Bearer ${ROTATED_SECRET}`]) {
    const mock = sequence(json({ id: OWNER }), json(gate()));
    const { body } = await call(mock, { env: { ...CONNECTED_ENV, CF_ANALYTICS_API_TOKEN_V2: value } });
    assert.equal(body.status, typeof value === 'string' && value.trim() ? 'unavailable' : 'not_configured');
    assert.equal(mock.calls.length, 2);
    assert.doesNotMatch(JSON.stringify(body), /test-only/);
  }
});

test('a rejected new token is verified using that same binding and never retries the old one', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate()), json({ errors: [{ code: 10000 }] }, 401), verification());
  const { body } = await call(mock, { env: { ...CONNECTED_ENV, CF_ANALYTICS_API_TOKEN_V2: ROTATED_SECRET } });
  assert.equal(body.diagnostic_code, 'provider_permission');
  assert.equal(mock.calls.length, 4);
  for (const provider of mock.calls.slice(2)) assert.equal(provider.init.headers.Authorization, `Bearer ${ROTATED_SECRET}`);
  assert.doesNotMatch(JSON.stringify(body), /test-only/);
});

test('wrapped token input has a distinct raw-token-only diagnostic without making a provider request', async () => {
  for (const token of [`Bearer ${SECRET}`, `"${SECRET}"`, JSON.stringify({ token: SECRET }), `Authorization: Bearer ${SECRET}`, `${SECRET}\nother`, `curl -H "Authorization: Bearer ${SECRET}"`]) {
    const mock = sequence(json({ id: OWNER }), json(gate()));
    const { body } = await call(mock, { env: { ...ENV, CF_ANALYTICS_API_TOKEN: token } });
    assert.equal(body.status, 'unavailable');
    assert.equal(body.diagnostic_code, 'invalid_token_format');
    assert.match(body.message, /Bearer 접두어·따옴표·JSON 없이 Cloudflare API 토큰 값만/);
    assert.equal(mock.calls.length, 2);
    assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|token_length|token_id/);
  }
});

test('verified Cloudflare source uses fixed exact HTML GET 2xx scope and preserves already weighted counts', async () => {
  const mock = providerSequence();
  const { response, body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ready');
  assert.equal(body.diagnostic_trace, undefined, 'successful analytics must keep its existing response contract');
  assert.equal(body.source.dataset, 'httpRequestsAdaptiveGroups');
  assert.equal(body.source.sampled, true);
  assert.equal(body.source.sample_interval, 1.25);
  assert.equal(body.source.bots, 'included');
  assert.equal(body.metrics.page_views.value, 186, 'adaptive counts must not be multiplied by sampling interval');
  assert.equal(body.metrics.visits.value, 158);
  assert.equal(body.metrics.page_views.previous_value, 100);
  assert.equal(body.metrics.page_views.change_percent, 86);
  assert.equal(body.metrics.visits.change_percent, 97.5);
  assert.equal(body.comparison.start_at, '2026-10-04T10:25:00.000Z');
  assert.equal(body.comparison.end_at, '2026-10-11T00:00:00.000Z');
  const currentDuration = Date.parse(body.range.end_at) - Date.parse(body.range.start_at);
  assert.equal(Date.parse(body.comparison.end_at) - Date.parse(body.comparison.start_at), currentDuration);
  assert.equal(body.series.length, 158, 'UTC grid must expose unobserved hours as gaps');
  assert.equal(body.series.filter(row => row.page_views !== null).length, 3);
  assert.equal(body.series[1].page_views, null, 'missing observations must break the plotted line');
  assert.equal(body.series.at(-1).bucket_end, NOW.toISOString());
  assert.equal(body.hourly.rows.length, 24);
  assert.deepEqual(body.hourly.rows.filter(row => row.page_views !== null), [{ hour: 0, page_views: 150, visits: 130 }, { hour: 13, page_views: 36, visits: 28 }]);
  assert.equal(body.hourly.rows[1].page_views, null);
  assert.equal(body.breakdowns.countries.rows.find(row => row.id === 'T1').label, 'Tor 네트워크');
  assert.equal(body.breakdowns.countries.rows.find(row => row.id === 'XX').value, 6);
  assert.equal(body.breakdowns.browsers.rows.find(row => row.id === 'ChromeHeadless').value, 51);
  const upstream = mock.calls.filter(item => item.url.includes('api.cloudflare.com'));
  assert.equal(upstream.length, 2);
  for (const { url, init } of upstream) {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
  }
  const dataRequest = JSON.parse(upstream[1].init.body);
  assert.equal(dataRequest.variables.zoneTag, 'ea37fec2cfe3490e5ff1622f3d260567');
  assert.equal(dataRequest.variables.to, NOW.toISOString());
  assert.match(dataRequest.query, /clientRequestHTTPHost:"biadone\.com"/);
  assert.match(dataRequest.query, /clientRequestHTTPMethodName:"GET"/);
  assert.match(dataRequest.query, /requestSource:"eyeball"/);
  assert.match(dataRequest.query, /edgeResponseContentTypeName:"html"/);
  assert.match(dataRequest.query, /edgeResponseStatus_geq:200,edgeResponseStatus_lt:300/);
  assert.match(dataRequest.query, /OR:\[\{clientRequestPath:"\/blabee"\},\{clientRequestPath:"\/blabee\/"\}\]/);
  assert.doesNotMatch(dataRequest.query, /clientRequestPath_(?:like|has|starts)|admin\/|liquid-glass/);
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|Bearer|private-owner/);
});

test('30-day current data remains usable while an expired previous range is omitted from GraphQL', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate('2026-09-18')), cf({ settings: { httpRequestsAdaptiveGroups: SETTINGS } }), cf(sourceData({
    previous: undefined,
    hourly: [measurement(100, 90, 1, { datetimeHour: '2026-09-18T00:00:00Z' }), measurement(86, 68, 1, { datetimeHour: '2026-10-17T13:00:00Z' })],
  })));
  const { body } = await call(mock, { env: CONNECTED_ENV, req: request('start=2026-09-18&end=2026-10-18') });
  assert.equal(body.status, 'ready');
  assert.equal(body.grain, 'day');
  assert.equal(body.metrics.page_views.value, 186);
  assert.equal(body.metrics.page_views.previous_value, null);
  assert.equal(body.metrics.page_views.change_percent, null);
  assert.equal(body.comparison.status, 'unavailable');
  assert.equal(body.series.length, 30);
  assert.equal(body.series.filter(row => row.page_views !== null).length, 2);
  assert.equal(body.series.at(-1).bucket_end, NOW.toISOString());
  const outgoing = JSON.parse(mock.calls[3].init.body);
  assert.doesNotMatch(outgoing.query, /previousFrom|previous:/);
  assert.equal(outgoing.variables.previousFrom, undefined);
});

test('provider duration and retention restrictions do not silently shrink a requested period', async () => {
  for (const [start, settings] of [['2026-09-15', SETTINGS], ['2026-10-11', { ...SETTINGS, notOlderThan: 86_400 }]]) {
    const mock = sequence(json({ id: OWNER }), json(gate(start)), cf({ settings: { httpRequestsAdaptiveGroups: settings } }));
    const { response, body } = await call(mock, { env: CONNECTED_ENV, req: request(`start=${start}&end=2026-10-18`) });
    assert.equal(response.status, 200);
    assert.equal(body.status, 'unsupported_range');
    assert.equal(body.metrics.page_views.value, null);
    assert.equal(body.range.start_day, start);
    assert.equal(mock.calls.length, 3);
  }
});

test('empty observations remain null while explicit measured zero is preserved and never yields infinite change', async () => {
  for (const explicitZero of [false, true]) {
    const empty = sourceData({ totals: explicitZero ? [measurement(0, 0)] : [], previous: explicitZero ? [measurement(0, 0)] : [], hourly: [], countries: [], browsers: [], operatingSystems: [] });
    const { body } = await call(providerSequence(empty), { env: CONNECTED_ENV });
    assert.equal(body.status, 'empty');
    assert.equal(body.metrics.page_views.value, explicitZero ? 0 : null);
    assert.equal(body.metrics.visits.value, explicitZero ? 0 : null);
    assert.equal(body.metrics.page_views.change_percent, null);
    assert.deepEqual(body.series, []);
    assert.deepEqual(body.hourly.rows, []);
  }
});

test('unsupported dimensions and sampling fields stay unavailable instead of duplicating other totals', async () => {
  const settings = { ...SETTINGS, availableFields: ['count'] };
  const mock = providerSequence({ totals: [{ count: 12 }], previous: [{ count: 10 }] }, settings);
  const { body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(body.metrics.page_views.value, 12);
  assert.equal(body.metrics.visits.value, null);
  assert.equal(body.metrics.visits.status, 'unavailable');
  assert.equal(body.hourly.status, 'unavailable');
  assert.equal(body.breakdowns.countries.status, 'unavailable');
  assert.equal(body.source.sampled, null);
  const outgoing = JSON.parse(mock.calls[3].init.body);
  assert.doesNotMatch(outgoing.query, /sum\s*\{|avg\s*\{|dimensions\s*\{|hourly:/);
});

test('top lists at the provider row limit and hour truncation carry explicit partial metadata', async () => {
  const twoRows = dimension => [measurement(100, 90, 1, { [dimension]: 'Known' }), measurement(86, 68, 1, { [dimension]: 'Unknown' })];
  const data = sourceData({ hourly: [measurement(100, 90, 1, { datetimeHour: '2026-10-11T00:00:00Z' }), measurement(86, 68, 1, { datetimeHour: '2026-10-17T13:00:00Z' })], countries: twoRows('clientCountryName'), browsers: twoRows('userAgentBrowser'), operatingSystems: twoRows('userAgentOS') });
  const { body } = await call(providerSequence(data, { ...SETTINGS, maxPageSize: 2 }), { env: CONNECTED_ENV });
  assert.equal(body.source.truncated, true);
  assert.equal(body.hourly.status, 'partial');
  assert.equal(body.breakdowns.countries.status, 'partial');
  assert.equal(body.metrics.page_views.value, 186);
  assert.equal(body.breakdowns.browsers.rows.reduce((sum, row) => sum + row.value, 0), 186);
});

test('unsampled untruncated detail mismatches and absent dimensions are explicitly partial', async () => {
  const data = sourceData({
    totals: [measurement(100, 80)], previous: [measurement(50, 40)],
    hourly: [measurement(10, 8, 1, { datetimeHour: '2026-10-11T00:00:00Z' })],
    countries: [], browsers: [measurement(90, 70, 1, { userAgentBrowser: 'Chrome' })], operatingSystems: [],
  });
  const { body } = await call(providerSequence(data), { env: CONNECTED_ENV });
  assert.equal(body.metrics.page_views.value, 100);
  assert.equal(body.hourly.status, 'partial');
  assert.equal(body.breakdowns.countries.status, 'partial');
  assert.equal(body.breakdowns.browsers.status, 'partial');
  assert.equal(body.breakdowns.operating_systems.status, 'partial');
  assert.equal(body.source.incomplete, true);
  assert.equal(body.source.truncated, false);
  assert.equal(body.source.sampled, false);
  assert.ok(body.message);
  const sampled = structuredClone(data);
  sampled.totals[0].avg.sampleInterval = 1.5;
  const sampledResult = await call(providerSequence(sampled), { env: CONNECTED_ENV });
  assert.equal(sampledResult.body.hourly.status, 'ready', 'independent weighted estimates need not reconcile exactly');
  assert.equal(sampledResult.body.breakdowns.browsers.status, 'ready');
  assert.equal(sampledResult.body.breakdowns.countries.status, 'partial', 'a missing supported dimension is still incomplete');
});

test('null country and agent categories remain visible without dropping their counts', async () => {
  const data = sourceData({ countries: [measurement(186, 158, 1, { clientCountryName: null })], browsers: [measurement(186, 158, 1, { userAgentBrowser: null })] });
  const { body } = await call(providerSequence(data), { env: CONNECTED_ENV });
  assert.deepEqual(body.breakdowns.countries.rows, [{ id: 'unknown', label: '알 수 없음', value: 186 }]);
  assert.deepEqual(body.breakdowns.browsers.rows, [{ id: 'unknown', label: '알 수 없음', value: 186 }]);
});

test('country labels use Korean names while preserving original and nonstandard identifiers', async () => {
  const countries = ['KR', 'NL', 'US', 'T1', 'XX', 'QQ', 'custom-region'].map(code => measurement(1, 1, 1, { clientCountryName: code }));
  const { body } = await call(providerSequence(sourceData({ countries })), { env: CONNECTED_ENV });
  const labels = Object.fromEntries(body.breakdowns.countries.rows.map(row => [row.id, row.label]));
  assert.deepEqual(labels, { KR: '대한민국', NL: '네덜란드', US: '미국', T1: 'Tor 네트워크', XX: '알 수 없음', QQ: 'QQ', 'custom-region': 'custom-region' });
  assert.equal(body.breakdowns.countries.rows.reduce((sum, row) => sum + row.value, 0), 7);
});

test('HTTP 200 GraphQL errors reject partial data and expose only safe diagnostic categories', async () => {
  for (const [errors, status, diagnostic, verifyResponses = []] of [
    [[{ message: `private ${SECRET}`, extensions: { code: 'unknown_failure' } }], 'unavailable', 'graphql_error'],
    [[{ message: `rate limit ${SECRET}`, extensions: { code: 'rate_limiter_budget_depleted' } }], 'rate_limited', 'rate_limited'],
    [[{ code: 9109, message: `invalid access token ${SECRET}` }], 'unavailable', 'provider_token_expired', [verification('expired')]],
    [[{ code: 9109, message: `Unauthorized to access requested resource ${SECRET}` }], 'unavailable', 'provider_permission', [json({}, 401), json({}, 403)]],
    [[{ code: 9109, message: `Unauthorized ${SECRET}` }], 'unavailable', 'provider_access_unverified', [json({}, 401), json({}, 403)]],
    [[{ message: `forbidden ${SECRET}` }], 'unavailable', 'provider_permission', [verification()]],
  ]) {
    const mock = sequence(json({ id: OWNER }), json(gate()), cf({ settings: { httpRequestsAdaptiveGroups: SETTINGS } }), cf(sourceData(), errors), ...verifyResponses);
    const { body } = await call(mock, { env: CONNECTED_ENV });
    assert.equal(body.status, status);
    assert.equal(body.diagnostic_code, diagnostic);
    assert.equal(body.diagnostic_stage, 'data');
    assert.equal(body.metrics.page_views.value, null);
    assert.deepEqual(body.series, []);
    assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|private |unknown_failure/);
  }
});

test('provider HTTP errors and every redirect remain structured and never follow a target', async () => {
  for (const [status, diagnostic] of [[301, 'redirect_rejected'], [302, 'redirect_rejected'], [303, 'redirect_rejected'], [307, 'redirect_rejected'], [308, 'redirect_rejected'], [401, 'provider_permission'], [403, 'provider_permission'], [429, 'rate_limited'], [502, 'upstream_unavailable']]) {
    const mock = sequence(json({ id: OWNER }), json(gate()), new Response(`private ${SECRET}`, { status, headers: { Location: `https://untrusted.example/?token=${SECRET}` } }), ...([401, 403].includes(status) ? [verification()] : []));
    const { response, body } = await call(mock, { env: CONNECTED_ENV });
    assert.equal(response.status, 200);
    assert.equal(body.diagnostic_code, diagnostic);
    assert.equal(body.metrics.page_views.value, null);
    assert.equal(mock.calls.length, [401, 403].includes(status) ? 4 : 3);
    assert.equal(mock.calls[2].init.redirect, 'manual');
    assert.equal(response.headers.get('Location'), null);
    assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|untrusted\.example/);
  }
});

test('an active account token turns settings access denial into a permission diagnosis without leaking verification data', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate()), json({ errors: [{ code: 9109, message: `Unauthorized to access requested resource ${SECRET}` }] }), verification());
  const { body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(body.diagnostic_code, 'provider_permission');
  assert.equal(body.diagnostic_stage, 'settings');
  assert.match(body.message, /연결 설정 조회: 토큰은 활성 상태이지만 biadone.com 분석 조회가 거부/);
  assert.equal(mock.calls.length, 4);
  const attempt = mock.calls[3];
  assert.equal(attempt.url, ACCOUNT_VERIFY);
  assert.equal(attempt.init.method, 'GET');
  assert.equal(attempt.init.redirect, 'manual');
  assert.equal(attempt.init.cache, 'no-store');
  assert.equal(attempt.init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(attempt.init.body, undefined);
  assert.doesNotMatch(JSON.stringify(body), /private-verification-id|test-only-cloudflare|token_length/);
});

test('legacy user tokens can verify on the second official endpoint without being falsely marked invalid', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate()), cf({ settings: { httpRequestsAdaptiveGroups: SETTINGS } }), json({}, 401), json({ success: false }, 403), verification());
  const { body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(body.diagnostic_code, 'provider_permission');
  assert.equal(body.diagnostic_stage, 'data');
  assert.match(body.message, /분석 데이터 조회: 토큰은 활성 상태/);
  assert.deepEqual(mock.calls.slice(4).map(item => item.url), [ACCOUNT_VERIFY, USER_VERIFY]);
  assert.ok(mock.calls.slice(4).every(item => item.init.method === 'GET' && item.init.redirect === 'manual' && item.init.cache === 'no-store'));
  assert.deepEqual(body.diagnostic_trace, [
    { endpoint: 'data', http_status: 401, error_codes: [] },
    { endpoint: 'token_account', http_status: 403, error_codes: [] },
    { endpoint: 'token_user', http_status: 200, error_codes: [] },
  ], 'the earlier successful settings request must not crowd out verification diagnostics');
});

test('access diagnostics expose only bounded HTTP statuses and two-level numeric error codes in a fixed suffix', async () => {
  const errors = [{
    code: 9109, message: `Unauthorized ${SECRET}`, id: 'private-id',
    errors: [{ code: '10000', errors: [{ code: 777 }] }, { code: 10000 }, { code: -1 }, { code: 1.5 }, { code: Number.MAX_SAFE_INTEGER }, { code: SECRET }],
    error_chain: [{ code: '10001' }],
    extensions: { code: 'not-a-numeric-code', errors: [{ code: 10002 }, { code: '10003' }, { code: 10004 }] },
  }, { code: 10005 }];
  const mock = sequence(
    json({ id: OWNER }), json(gate()), json({ errors, result: { id: 'private-id' } }),
    json({ success: false, errors: [{ code: 10000, message: SECRET, error_chain: [{ code: 10001 }] }], result: { id: 'private-id' } }, 403),
    json({ success: false, errors: [{ extensions: { code: '9106' }, message: SECRET }] }, 401),
  );
  const { body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(body.diagnostic_code, 'provider_access_unverified');
  assert.deepEqual(body.diagnostic_trace, [
    { endpoint: 'settings', http_status: 200, error_codes: [9109, 10000, 10001, 10002, 10003] },
    { endpoint: 'token_account', http_status: 403, error_codes: [10000, 10001] },
    { endpoint: 'token_user', http_status: 401, error_codes: [9106] },
  ]);
  assert.ok(body.message.endsWith('[진단: settings HTTP200 codes9109,10000,10001,10002,10003; token_account HTTP403 codes10000,10001; token_user HTTP401 codes9106]'));
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|private-id|not-a-numeric-code|777|10004|10005|Authorization|Bearer/);
});

test('non-OK GraphQL HTTP responses contribute only numeric provider error codes', async () => {
  const mock = sequence(
    json({ id: OWNER }), json(gate()),
    json({ errors: [{ code: 10000, message: SECRET, error_chain: [{ code: '10001' }] }], result: { id: 'private-id' } }, 401),
    verification(),
  );
  const { body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(body.diagnostic_code, 'provider_permission');
  assert.deepEqual(body.diagnostic_trace, [
    { endpoint: 'settings', http_status: 401, error_codes: [10000, 10001] },
    { endpoint: 'token_account', http_status: 200, error_codes: [] },
  ]);
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|private-id/);
});

test('network failures are fixed diagnostic enums without exception details', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate()), () => { throw new Error(`private ${SECRET}`); });
  const { body } = await call(mock, { env: CONNECTED_ENV });
  assert.equal(body.diagnostic_code, 'upstream_unavailable');
  assert.deepEqual(body.diagnostic_trace, [{ endpoint: 'settings', http_status: null, error_codes: [], transport_error: 'network' }]);
  assert.ok(body.message.endsWith('[진단: settings HTTP없음 codes없음 network]'));
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|private /);
});

test('non-OK body reads and both verification body reads share their request deadline', async () => {
  const stalledBody = status => () => ({ status, json: () => new Promise(() => {}) });
  const mock = sequence(json({ id: OWNER }), json(gate()), stalledBody(401), stalledBody(403), stalledBody(401));
  const started = Date.now();
  const { body } = await call(mock, { env: CONNECTED_ENV, providerTimeoutMs: 5 });
  assert.ok(Date.now() - started < 1_000, 'reading a body must not outlive the request deadline');
  assert.equal(body.diagnostic_code, 'provider_access_unverified', 'a verification timeout cannot establish an invalid token');
  assert.deepEqual(body.diagnostic_trace, [
    { endpoint: 'settings', http_status: 401, error_codes: [], transport_error: 'timeout' },
    { endpoint: 'token_account', http_status: 403, error_codes: [], transport_error: 'timeout' },
    { endpoint: 'token_user', http_status: 401, error_codes: [], transport_error: 'timeout' },
  ]);
  assert.ok(mock.calls.slice(2).every(item => item.init.signal.aborted && item.init.redirect === 'manual' && item.init.cache === 'no-store'));
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|private-verification-id/);
});

test('verified expiry, disabled status and future activation have fixed distinct diagnostics', async () => {
  for (const [status, extra, diagnostic] of [
    ['expired', {}, 'provider_token_expired'], ['disabled', {}, 'provider_token_disabled'],
    ['active', { expires_on: '2026-10-01T00:00:00Z' }, 'provider_token_expired'],
    ['active', { not_before: '2026-11-01T00:00:00Z' }, 'provider_token_not_yet_active'],
  ]) {
    const mock = sequence(json({ id: OWNER }), json(gate()), json({}, 401), verification(status, extra));
    const { body } = await call(mock, { env: CONNECTED_ENV });
    assert.equal(body.diagnostic_code, diagnostic);
    assert.equal(mock.calls.length, 4);
    assert.equal(body.metrics.page_views.value, null);
    assert.doesNotMatch(JSON.stringify(body), /private-verification-id|test-only-cloudflare|2026-10-01|2026-11-01/);
  }
});

test('failed or redirected verification does not establish invalidity and never follows a supplied location', async () => {
  for (const responses of [
    [json({ success: false }, 401), json({ success: false }, 403)],
    [new Response('private', { status: 302, headers: { Location: `https://untrusted.example/?token=${SECRET}` } }), new Response('malformed')],
    [json({ success: true, errors: [{ message: SECRET }], result: { status: 'active' } }), json({ success: true, result: { status: 'unexpected' } })],
  ]) {
    const mock = sequence(json({ id: OWNER }), json(gate()), json({}, 401), ...responses);
    const { body } = await call(mock, { env: CONNECTED_ENV });
    assert.equal(body.diagnostic_code, 'provider_access_unverified');
    assert.match(body.message, /활성 상태를 확인하지 못했습니다/);
    assert.equal(mock.calls.length, 5);
    assert.deepEqual(mock.calls.slice(3).map(item => item.url), [ACCOUNT_VERIFY, USER_VERIFY]);
    assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|untrusted\.example|private/);
  }
});

test('legacy and officially prefixed raw token values are accepted without exposing their shape', async () => {
  for (const token of [SECRET, 'cfat_testAccountTokenValue', 'cfut_testUserTokenValue']) {
    const mock = providerSequence();
    const { body } = await call(mock, { env: { ...ENV, CF_ANALYTICS_API_TOKEN: token } });
    assert.equal(body.status, 'ready');
    assert.equal(mock.calls.length, 4, 'successful analytics must never trigger token verification');
    assert.ok(!JSON.stringify(body).includes(token));
  }
});

test('verification timeouts stay bounded and unverified without retrying the analytics request', async () => {
  const timeout = (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error(SECRET)), { once: true });
  });
  const mock = sequence(json({ id: OWNER }), json(gate()), json({}, 401), timeout, timeout);
  const { body } = await call(mock, { env: CONNECTED_ENV, providerTimeoutMs: 5 });
  assert.equal(body.diagnostic_code, 'provider_access_unverified');
  assert.equal(mock.calls.filter(item => item.url.endsWith('/graphql')).length, 1);
  assert.deepEqual(mock.calls.slice(3).map(item => item.url), [ACCOUNT_VERIFY, USER_VERIFY]);
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare/);
});

test('malformed, overflowing, duplicated and out-of-range data cannot become valid metrics', async () => {
  for (const data of [
    sourceData({ totals: [measurement(-1, 2)] }), sourceData({ totals: [measurement(Number.MAX_SAFE_INTEGER + 1, 2)] }),
    sourceData({ totals: [measurement(186, 158, 0)] }),
    sourceData({ hourly: [...sourceData().hourly, sourceData().hourly[0]] }),
    sourceData({ hourly: [measurement(1, 1, 1, { datetimeHour: '2026-10-18T00:00:00Z' })] }),
    sourceData({ countries: undefined }),
  ]) {
    const { body } = await call(providerSequence(data), { env: CONNECTED_ENV });
    assert.equal(body.status, 'unavailable');
    assert.equal(body.diagnostic_code, 'invalid_response');
    assert.equal(body.metrics.page_views.value, null);
  }
});

test('malformed provider JSON and an empty account scope are unavailable, not measured zero', async () => {
  for (const upstream of [new Response('malformed JSON'), json({ data: { viewer: { zones: [] } }, errors: null })]) {
    const mock = sequence(json({ id: OWNER }), json(gate()), upstream);
    const { body } = await call(mock, { env: CONNECTED_ENV });
    assert.equal(body.status, 'unavailable');
    assert.equal(body.metrics.page_views.value, null);
    assert.equal(body.source.sampled, null);
  }
});

test('provider timeout returns a safe retryable state without token details', async () => {
  const mock = sequence(json({ id: OWNER }), json(gate()), (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error(`private ${SECRET}`)), { once: true });
  }));
  const { body } = await call(mock, { env: CONNECTED_ENV, providerTimeoutMs: 5 });
  assert.equal(body.status, 'unavailable');
  assert.equal(body.diagnostic_code, 'timeout');
  assert.doesNotMatch(JSON.stringify(body), /test-only-cloudflare|private /);
});

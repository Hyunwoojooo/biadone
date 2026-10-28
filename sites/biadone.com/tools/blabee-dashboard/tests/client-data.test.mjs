import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeForDays, validateRange, utcDays, formatCount, formatKST, formatUTCDay, formatUTCTime,
  validateAnalytics, validateOverview, filterSupplement, sourceChannel, lineSegments, hourlyRows, dailySeries,
} from '../public/data.mjs';
import { createDemoData, createDemoAnalytics, loadDemo } from '../public/demo.mjs';

const NOW = new Date('2026-10-17T12:30:00.000Z');
const range = rangeForDays(7, NOW);
const fixture = () => createDemoData({ ...range, now: NOW });
const clone = value => structuredClone(value);

test('UTC calendar presets include today and exclude the ending day across KST/year boundaries', () => {
  assert.deepEqual(rangeForDays(7, '2026-10-17T00:30:00+09:00'), { start: '2026-10-10', end: '2026-10-17' });
  assert.deepEqual(rangeForDays(1, NOW), { start: '2026-10-17', end: '2026-10-18' });
  assert.deepEqual(rangeForDays(7, '2026-01-02T02:00:00Z'), { start: '2025-12-27', end: '2026-01-03' });
});
test('strict dates reject normalization, invalid formats, future periods and ranges above ninety days', () => {
  for (const invalid of [
    { start: '2026-02-29', end: '2026-03-01' }, { start: '2026-04-31', end: '2026-05-01' },
    { start: '2026-2-01', end: '2026-02-02' }, { start: '2026-10-17', end: '2026-10-17' },
    { start: '2026-10-18', end: '2026-10-17' }, { start: '2026-01-01', end: '2026-04-02' },
    { start: '2026-10-17', end: '2026-10-19' },
  ]) assert.throws(() => validateRange(invalid, { now: NOW }), RangeError);
  assert.equal(validateRange({ start: '2024-02-29', end: '2024-03-01' }, { now: NOW }).days, 1);
  assert.equal(validateRange({ start: '2026-01-01', end: '2026-04-01' }, { now: NOW }).days, 90);
  assert.throws(() => rangeForDays(91, NOW), RangeError);
});
test('UTC day enumeration respects leap dates and an exclusive end', () => {
  assert.deepEqual(utcDays({ start: '2024-02-28', end: '2024-03-02' }), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(utcDays(range).length, 7);
});
test('formatting preserves actual zero while invalid/missing counts remain unknown', () => {
  assert.equal(formatCount(0), '0'); assert.equal(formatCount(12345), '12,345');
  for (const value of [null, undefined, NaN, Infinity, -1, 2.5, '5']) assert.equal(formatCount(value), '—');
  assert.equal(formatKST('2026-10-16T15:30:00.000Z'), '2026.10.17 00:30 KST');
  assert.equal(formatUTCTime('2026-10-16T15:30:00Z'), '10.16 15:30 UTC');
  assert.equal(formatUTCDay('2026-10-16'), '2026.10.16');
  assert.equal(formatKST('2026-10-17T00:30:00'), '—');
  assert.equal(formatKST('2026-02-30T12:00:00Z'), '—');
});

test('explicit fixtures are deterministic and provide two separate provider contracts without post records', async () => {
  const first = fixture();
  assert.deepEqual(first, await loadDemo({ ...range, now: NOW }));
  assert.deepEqual(Object.keys(first).sort(), ['analytics', 'overview']);
  assert.equal(first.overview.demo.enabled, true);
  assert.equal(first.analytics.demo.enabled, true);
  assert.equal(first.analytics.provider, 'cloudflare');
  assert.equal(first.analytics.scope.id, 'blabee_main');
  assert.equal(first.overview.scope.id, 'blabee_landings_combined');
  assert.equal(first.overview.capabilities.sessions, false);
  assert.equal(first.overview.capabilities.conversion_rate, false);
  assert.equal(validateAnalytics(first.analytics, range), first.analytics);
  assert.equal(validateOverview(first.overview, range), first.overview);
});
test('Cloudflare totals equal observed series sums without scaling weighted provider counts again', () => {
  const { analytics } = fixture();
  for (const metric of ['page_views', 'visits']) {
    assert.equal(analytics.metrics[metric].value, analytics.series.reduce((sum, row) => sum + (row[metric] ?? 0), 0));
  }
  analytics.source.sample_interval = 7;
  const totals = clone(analytics.metrics);
  validateAnalytics(analytics, range);
  assert.deepEqual(analytics.metrics, totals);
  assert.equal(analytics.range.end_at, NOW.toISOString());
  assert.ok(analytics.series.every(row => row.bucket_start >= analytics.range.start_at && row.bucket_end <= analytics.range.end_at));
});
test('Cloudflare comparison uses exactly the elapsed duration, with no infinite zero-denominator change', () => {
  const { analytics } = fixture();
  assert.equal(Date.parse(analytics.range.end_at) - Date.parse(analytics.range.start_at), Date.parse(analytics.comparison.end_at) - Date.parse(analytics.comparison.start_at));
  const bad = clone(analytics); bad.metrics.page_views.previous_value = 0; bad.metrics.page_views.change_percent = 2;
  assert.throws(() => validateAnalytics(bad, range), TypeError);
  bad.metrics.page_views.change_percent = null;
  assert.doesNotThrow(() => validateAnalytics(bad, range));
});
test('Cloudflare invalid counts are rejected at cards, series, hourly rows and breakdowns', () => {
  for (const modify of [
    data => { data.metrics.page_views.value = -1; },
    data => { data.metrics.visits.value = Number.MAX_SAFE_INTEGER + 1; },
    data => { data.series[0].page_views = '12'; },
    data => { data.hourly.rows[0].visits = Infinity; },
    data => { data.breakdowns.countries.rows[0].value = 1.5; },
    data => { data.metrics.visits.change_percent = NaN; },
  ]) {
    const data = fixture().analytics; modify(data);
    assert.throws(() => validateAnalytics(data, range), TypeError);
  }
});
test('Cloudflare scope cannot include root, admin, assets or a mismatched requested range', () => {
  for (const paths of [['/', '/blabee/'], ['/blabee', '/blabee/admin/'], ['/blabee', '/blabee/assets/a.js'], ['/blabee/', '/blabee/']]) {
    const data = fixture().analytics; data.scope.paths = paths;
    assert.throws(() => validateAnalytics(data, range), TypeError);
  }
  const data = fixture().analytics; data.range.start_day = '2026-10-01';
  assert.throws(() => validateAnalytics(data, range), TypeError);
});
test('invalid/overlapping buckets and duplicate dimensions are rejected', () => {
  for (const modify of [
    data => { data.series[1].bucket_start = data.series[0].bucket_start; },
    data => { data.series[0].bucket_end = '2026-10-30T00:00:00Z'; },
    data => { data.hourly.rows.push(clone(data.hourly.rows[0])); },
    data => { data.breakdowns.browsers.rows.push(clone(data.breakdowns.browsers.rows[0])); },
  ]) {
    const data = fixture().analytics; modify(data);
    assert.throws(() => validateAnalytics(data, range), TypeError);
  }
});
test('provider-specific non-ISO and unknown country categories remain intact', () => {
  const data = fixture().analytics;
  data.breakdowns.countries.rows[0] = { id: 'T1', label: 'Tor / T1', value: 7 };
  const unknown = { id: 'XX', label: 'Unknown', value: 2 };
  data.breakdowns.countries.rows.push(unknown);
  validateAnalytics(data, range);
  assert.equal(data.breakdowns.countries.rows[0].id, 'T1');
  assert.ok(data.breakdowns.countries.rows.includes(unknown));
});
test('missing provider connection remains null while a measured empty period can be real zero', () => {
  const missing = fixture().analytics;
  missing.status = 'not_configured'; missing.message = 'Cloudflare 미연결'; missing.series = [];
  missing.hourly = { status: 'unavailable', rows: [] };
  for (const key of ['page_views', 'visits']) missing.metrics[key] = { value: null, previous_value: null, change_percent: null, status: 'unavailable' };
  for (const key of ['countries', 'browsers', 'operating_systems']) missing.breakdowns[key] = { status: 'unavailable', rows: [] };
  validateAnalytics(missing, range); assert.equal(missing.metrics.page_views.value, null);
  const zeroRange = { start: '2026-10-15', end: '2026-10-16' };
  const measured = createDemoAnalytics({ ...zeroRange, now: NOW });
  validateAnalytics(measured, zeroRange);
  assert.equal(measured.metrics.page_views.value, 0);
  assert.equal(measured.status, 'empty');
});
test('an unsupported provider range does not fabricate a long-range series or hide available beta data', () => {
  const longRange = rangeForDays(90, NOW), data = createDemoData({ ...longRange, now: NOW });
  validateAnalytics(data.analytics, longRange); validateOverview(data.overview, longRange);
  assert.equal(data.analytics.status, 'unsupported_range');
  assert.equal(data.analytics.metrics.visits.value, null);
  assert.deepEqual(data.analytics.series, []);
  assert.ok(data.overview.metrics.new_beta_requests.value > 0);
});
test('line segments break on both explicit nulls and entirely absent buckets', () => {
  const series = [
    { bucket_start: '2026-10-17T00:00:00Z', bucket_end: '2026-10-17T01:00:00Z', page_views: 1 },
    { bucket_start: '2026-10-17T01:00:00Z', bucket_end: '2026-10-17T02:00:00Z', page_views: null },
    { bucket_start: '2026-10-17T02:00:00Z', bucket_end: '2026-10-17T03:00:00Z', page_views: 0 },
    { bucket_start: '2026-10-17T04:00:00Z', bucket_end: '2026-10-17T05:00:00Z', page_views: 5 },
  ];
  assert.deepEqual(lineSegments(series, 'page_views').map(items => items.map(row => row.value)), [[1], [0], [5]]);
  series[1].page_views = 2; series[2].bucket_start = '2026-10-17T11:00:00+09:00';
  assert.equal(lineSegments(series, 'page_views')[0].length, 3);
});
test('24-hour axis retains unknown hours as null and measured zero as zero', () => {
  const rows = hourlyRows([{ hour: 3, page_views: 0, visits: 0 }, { hour: 17, page_views: 11, visits: 5 }]);
  assert.equal(rows.length, 24);
  assert.equal(rows[0].page_views, null); assert.equal(rows[3].page_views, 0); assert.equal(rows[17].visits, 5);
});

test('Supabase missing date and verified zero remain distinct', () => {
  const { overview } = fixture();
  assert.equal(overview.daily.find(row => row.day === '2026-10-14').new_beta_requests, null);
  assert.equal(overview.daily.find(row => row.day === '2026-10-14').status.new_beta_requests, 'missing');
  assert.equal(overview.daily.find(row => row.day === '2026-10-15').new_beta_requests, 0);
  assert.equal(overview.daily.find(row => row.day === '2026-10-15').status.new_beta_requests, 'verified');
  assert.equal(overview.metrics.new_beta_requests.status, 'partial');
  assert.equal(dailySeries(overview.daily, 'new_beta_requests')[0].bucket_start, overview.daily[0].day + 'T00:00:00.000Z');
});
test('local source filters change only the supplemental aggregate, never cards or Cloudflare data', () => {
  const data = fixture(), before = clone(data);
  const filtered = filterSupplement(data.overview, { channel: 'x', campaign: 'demo-beta' });
  assert.ok(filtered.source_daily.length > 0);
  assert.ok(filtered.source_daily.every(row => row.attribution.source === 'x' && row.attribution.campaign === 'demo-beta'));
  assert.equal(filtered.metrics.new_beta_requests.value, filtered.source_daily.reduce((sum, row) => sum + (row.new_beta_requests ?? 0), 0));
  assert.deepEqual(data, before);
  assert.ok(filtered.metrics.new_beta_requests.value < data.overview.metrics.new_beta_requests.value);
  assert.equal(filterSupplement(data.overview, { channel: '__all__', campaign: '__all__' }), data.overview);
});
test('literal all remains a real source/campaign and raw host classification is preserved', () => {
  const { overview } = fixture();
  const filtered = filterSupplement(overview, { channel: 'all', campaign: 'all' });
  assert.ok(filtered.source_daily.length > 0);
  assert.ok(filtered.source_daily.every(row => row.attribution.source === 'all' && row.attribution.campaign === 'all'));
  assert.equal(sourceChannel('t.co'), 'x'); assert.equal(sourceChannel('m.youtube.com'), 'youtube');
  assert.equal(sourceChannel('newsletter.example'), 'newsletter.example');
  assert.ok(overview.channels.some(row => row.id === 'unmeasured'));
  assert.ok(overview.channels.some(row => row.id === 'direct_or_unknown'));
});
test('empty campaign is an exact supplemental filter rather than all campaigns', () => {
  const { overview } = fixture();
  const filtered = filterSupplement(overview, { campaign: '' });
  assert.ok(filtered.source_daily.every(row => row.attribution.campaign === ''));
  assert.ok(filtered.channels.some(row => row.id === 'unmeasured'));
  assert.ok(!filtered.channels.some(row => row.id === 'reddit'));
});
test('unsupported signup attribution never repeats an unfiltered count into source filters', () => {
  const { overview } = fixture();
  overview.capabilities.signup_attribution = false;
  const filtered = filterSupplement(overview, { channel: 'reddit' });
  assert.equal(filtered.metrics.new_beta_requests.value, null);
  assert.equal(filtered.metrics.new_beta_requests.status, 'unavailable');
  assert.ok(filtered.daily.every(row => row.new_beta_requests === null));
});
test('server partial sums survive unfiltered and filtered supplemental views', () => {
  const { overview } = fixture();
  overview.range = { start_day: '2026-10-16', end_day: '2026-10-17' };
  for (const metric of ['page_views', 'new_beta_requests']) overview.coverage[metric] = { available: true, status: 'unverified', verified_start_day: null, verified_end_day: null };
  const attribution = { source: 'x', source_type: 'utm', medium: 'social', campaign: 'demo-beta', content: 'one', referrer_host: '' };
  overview.source_daily = [
    { day: '2026-10-16', attribution, page_views: 1, new_beta_requests: 1 },
    { day: '2026-10-16', attribution: { ...attribution, content: 'two' }, page_views: null, new_beta_requests: null },
  ];
  overview.metrics.new_beta_requests = { value: 1, status: 'partial' };
  overview.daily = [{ day: '2026-10-16', page_views: 1, new_beta_requests: 1, status: { page_views: 'partial', new_beta_requests: 'partial' } }];
  assert.equal(filterSupplement(overview), overview);
  const filtered = filterSupplement(overview, { channel: 'x' });
  assert.equal(filtered.metrics.new_beta_requests.value, 1);
  assert.equal(filtered.metrics.new_beta_requests.status, 'partial');
  assert.equal(filtered.daily[0].status.new_beta_requests, 'partial');
  assert.equal(filtered.channels[0].status.new_beta_requests, 'partial');
});
test('Supabase response validation rejects wrong scope dates, unsafe counts and duplicate calendar rows', () => {
  for (const modify of [
    value => { value.range.start_day = '2026-10-01'; },
    value => { value.metrics.new_beta_requests.value = -1; },
    value => { value.daily.push(clone(value.daily[0])); },
    value => { value.source_daily[0].new_beta_requests = '1'; },
  ]) {
    const data = fixture().overview; modify(data);
    assert.throws(() => validateOverview(data, range), TypeError);
  }
});

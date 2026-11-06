import { rangeForDays, validateRange, utcDays, filterSupplement, sourceChannel, isCount } from './data.mjs';

const DAY_MS = 86_400_000, HOUR_MS = 3_600_000;
const LABELS = { reddit: 'Reddit', x: 'X', youtube: 'YouTube', instagram: 'Instagram', direct_or_unknown: '직접 또는 출처 불명', unmeasured: '출처 미측정' };
const dateAt = (day, offset) => new Date(Date.parse(day + 'T00:00:00Z') + offset * DAY_MS).toISOString().slice(0, 10);
function context(options) {
  const now = new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new RangeError('A valid demo timestamp is required.');
  const defaults = rangeForDays(7, now);
  const { start, end } = validateRange({ start: options.start ?? defaults.start, end: options.end ?? defaults.end }, { now });
  return { now, today: now.toISOString().slice(0, 10), start, end };
}
function attribution(source, source_type, medium, campaign, content = '') {
  return { source, source_type, medium, campaign, content, referrer_host: source_type === 'referrer' ? source : '' };
}
function overviewFixture({ now, today, start, end }) {
  const sources = [
    attribution('reddit', 'utm', 'community', 'demo-beta', 'demo-question'),
    attribution('x', 'utm', 'social', 'demo-beta', 'demo-workflow'),
    attribution('youtube', 'utm', 'video', 'demo-story', 'demo-video'),
    attribution('instagram', 'utm', 'social', 'demo-story', 'demo-interface'),
    attribution('direct_or_unknown', 'unknown', '', ''),
    attribution('unmeasured', 'unmeasured', '', ''),
    attribution('newsletter.example', 'referrer', '', ''),
    attribution('t.co', 'referrer', '', ''),
    attribution('all', 'utm', 'social', 'all', 'demo-literal-all'),
  ];
  const rows = [];
  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const day = dateAt(today, -daysAgo);
    if (day < start || day >= end || daysAgo === 3) continue;
    sources.forEach((source, index) => {
      const seed = (30 - daysAgo) * 97 + (index + 3) * 37;
      const zero = daysAgo === 2;
      rows.push({
        day, attribution: { ...source },
        page_views: zero || source.source_type === 'unmeasured' ? 0 : Math.floor((12 + seed % 73) * (daysAgo === 0 ? 0.25 : 1)),
        new_beta_requests: zero ? 0 : (seed + index) % (index < 4 ? 5 : 3),
      });
    });
  }
  const verifiedStart = dateAt(today, -2);
  const coverage = {
    available: true, collector_status: 'unknown',
    status: start >= verifiedStart && end <= today ? 'verified' : verifiedStart < end && today > start ? 'partial' : 'unverified',
    verified_start_day: verifiedStart, verified_end_day: today,
  };
  const channelIds = [...new Set(rows.map(row => sourceChannel(row.attribution.source)))].sort();
  return filterSupplement({
    version: 1, generated_at: now.toISOString(), timezone: 'UTC',
    range: { start_day: start, end_day: end }, filters: { channel: null, campaign: null },
    scope: { id: 'blabee_landings_combined', label: 'Blabee 랜딩 합산' },
    demo: { enabled: true, label: '샘플 데이터 · 실제 유입 및 신청과 무관합니다.' },
    capabilities: { daily_page_views: true, daily_beta_requests: true, signup_attribution: true, hourly: false, sessions: false, conversion_rate: false },
    coverage: { page_views: { ...coverage }, new_beta_requests: { ...coverage } },
    source_daily: rows,
    filter_options: { channels: channelIds.map(id => ({ id, label: LABELS[id] ?? id })), campaigns: [...new Set(rows.map(row => row.attribution.campaign))].sort() },
  });
}
function cfSeries(start, end, today) {
  const rows = [];
  for (let hour = Math.floor(start / HOUR_MS) * HOUR_MS; hour < end; hour += HOUR_MS) {
    const stamp = new Date(hour), day = stamp.toISOString().slice(0, 10), utcHour = stamp.getUTCHours();
    const seed = Math.floor(hour / HOUR_MS);
    const gap = day === dateAt(today, -1) && utcHour === 8;
    const zero = day === dateAt(today, -2);
    const page_views = gap ? null : zero ? 0 : (seed * 13 % 19) + (utcHour >= 13 && utcHour <= 20 ? 15 + seed % 23 : 1);
    rows.push({
      bucket_start: new Date(Math.max(start, hour)).toISOString(), bucket_end: new Date(Math.min(end, hour + HOUR_MS)).toISOString(),
      page_views, visits: gap ? null : zero ? 0 : Math.max(0, page_views - (seed % 5)),
    });
  }
  return rows;
}
const sum = (rows, metric) => {
  const values = rows.map(row => row[metric]).filter(isCount);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
};
function ranking(labels, total, partial) {
  if (!isCount(total)) return { status: 'unavailable', rows: [] };
  let remaining = total;
  const weights = [0.47, 0.23, 0.13, 0.08, 0.05];
  const rows = labels.map(([id, label], index) => {
    const value = index === labels.length - 1 ? remaining : Math.floor(total * weights[index]);
    remaining -= value; return { id, label, value };
  });
  return { status: total === 0 ? 'empty' : partial ? 'partial' : 'ready', rows };
}
export function createDemoAnalytics(options = {}) {
  const { now, today, start, end } = context(options);
  const startTime = Date.parse(start + 'T00:00:00Z'), endTime = Math.min(Date.parse(end + 'T00:00:00Z'), now.getTime());
  const emptyMetric = () => ({ value: null, previous_value: null, change_percent: null, status: 'unavailable' });
  const data = {
    version: 1, provider: 'cloudflare', generated_at: now.toISOString(), timezone: 'UTC',
    scope: { id: 'blabee_main', host: 'biadone.com', paths: ['/blabee', '/blabee/'], label: 'biadone.com/blabee/' },
    range: { start_day: start, end_day: end, start_at: new Date(startTime).toISOString(), end_at: new Date(endTime).toISOString() },
    grain: 'hour', status: 'unsupported_range', message: '샘플의 Cloudflare 데이터는 최근 30일 범위만 제공합니다.',
    source: { dataset: 'explicit_demo_fixture', sampled: true, sample_interval: 1, bots: 'included', truncated: false },
    comparison: { status: 'unavailable', start_at: null, end_at: null },
    metrics: { page_views: emptyMetric(), visits: emptyMetric() }, series: [],
    hourly: { status: 'unavailable', rows: [] },
    breakdowns: { countries: { status: 'unavailable', rows: [] }, browsers: { status: 'unavailable', rows: [] }, operating_systems: { status: 'unavailable', rows: [] } },
    demo: { enabled: true, label: '샘플 데이터 · 운영 Cloudflare 데이터가 아닙니다.' },
  };
  const earliest = Date.parse(dateAt(today, -29) + 'T00:00:00Z');
  if (startTime < earliest) return data;
  const rows = cfSeries(startTime, endTime, today);
  const partial = rows.some(row => row.page_views === null || row.visits === null);
  const previousStart = startTime - (endTime - startTime);
  const previous = previousStart >= earliest ? cfSeries(previousStart, startTime, today) : [];
  data.series = rows; data.status = 'ready'; data.message = null;
  data.comparison = previous.length ? {
    status: previous.some(row => row.page_views === null) ? 'partial' : 'ready',
    start_at: new Date(previousStart).toISOString(), end_at: new Date(startTime).toISOString(),
  } : data.comparison;
  for (const metric of ['page_views', 'visits']) {
    const value = sum(rows, metric), previousValue = sum(previous, metric);
    data.metrics[metric] = {
      value, previous_value: previousValue,
      change_percent: value !== null && previousValue > 0 ? (value - previousValue) / previousValue * 100 : null,
      status: value === 0 && !partial ? 'empty' : partial ? 'partial' : 'ready',
    };
  }
  if (data.metrics.page_views.status === 'empty' && data.metrics.visits.status === 'empty') data.status = 'empty';
  const hours = new Map();
  for (const row of rows) {
    const hour = new Date(row.bucket_start).getUTCHours();
    if (!hours.has(hour)) hours.set(hour, []);
    hours.get(hour).push(row);
  }
  data.hourly = { status: partial ? 'partial' : data.status === 'empty' ? 'empty' : 'ready', rows: [...hours].sort(([a], [b]) => a - b).map(([hour, items]) => ({ hour, page_views: sum(items, 'page_views'), visits: sum(items, 'visits') })) };
  const total = data.metrics.page_views.value;
  data.breakdowns = {
    countries: ranking([['KR', '대한민국'], ['US', '미국'], ['JP', '일본'], ['DE', '독일'], ['GB', '영국'], ['unknown', '알 수 없음']], total, partial),
    browsers: ranking([['Chrome', 'Chrome'], ['Safari', 'Safari'], ['Firefox', 'Firefox'], ['Edge', 'Edge'], ['Samsung', 'Samsung Internet'], ['unknown', '알 수 없음']], total, partial),
    operating_systems: ranking([['macOS', 'macOS'], ['Windows', 'Windows'], ['iOS', 'iOS'], ['Android', 'Android'], ['Linux', 'Linux'], ['unknown', '알 수 없음']], total, partial),
  };
  return data;
}
export function createDemoData(options = {}) {
  const values = context(options);
  return { overview: overviewFixture(values), analytics: createDemoAnalytics(options) };
}
export async function loadDemo(options = {}) { return createDemoData(options); }

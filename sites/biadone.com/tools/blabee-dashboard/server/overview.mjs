import { ApiError, assertMethod, assertQuery, errorResponse, jsonResponse } from './http.mjs';
import { authorize, callRpc } from './auth.mjs';

const DAY_MS = 86_400_000;
const METRICS = ['page_views', 'new_beta_requests'];
const COVERAGE_STATUSES = new Set(['verified', 'partial', 'unverified', 'unavailable']);
const SOURCE_TYPES = new Set(['utm', 'referrer', 'unknown', 'unmeasured']);
const LABELS = { reddit: 'Reddit', x: 'X', youtube: 'YouTube', instagram: 'Instagram', direct_or_unknown: '직접 또는 출처 불명', unmeasured: '출처 미측정' };

export function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '2000-01-01' && value <= '2199-12-31'
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function daysBetween(start, end) {
  const result = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time < Date.parse(`${end}T00:00:00Z`); time += DAY_MS) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

export function parseRange(url, now = new Date(), { optional = false } = {}) {
  let start = url.searchParams.get('start');
  let end = url.searchParams.get('end');
  const tomorrow = new Date(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  if (start === null && end === null) {
    if (optional) return null;
    end = tomorrow;
    start = new Date(Date.parse(`${end}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10);
  }
  if (!isDay(start) || !isDay(end) || start >= end || end > tomorrow
      || Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 90 * DAY_MS) {
    throw new ApiError(400, 'INVALID_RANGE', '시작일과 종료일을 확인해 주세요. UTC 기준 최대 90일이며 종료일은 포함하지 않습니다.');
  }
  return { start_day: start, end_day: end };
}

export function parseFilters(url) {
  const channel = url.searchParams.get('channel');
  const campaign = url.searchParams.get('campaign');
  if (channel !== null && !/^[a-z0-9][a-z0-9._-]{0,252}$/.test(channel)) {
    throw new ApiError(400, 'INVALID_CHANNEL', '채널 값을 확인해 주세요.');
  }
  if (campaign !== null && !/^(?:[a-z0-9][a-z0-9._-]{0,79})?$/.test(campaign)) {
    throw new ApiError(400, 'INVALID_CAMPAIGN', '캠페인 값을 확인해 주세요.');
  }
  return { channel, campaign };
}

export function channelId(source) {
  if (['reddit', 'x', 'youtube', 'instagram'].includes(source)) return source;
  const host = source.replace(/^www\./, '');
  for (const [id, domains] of Object.entries({ reddit: ['reddit.com'], x: ['x.com', 'twitter.com', 't.co'], youtube: ['youtube.com', 'youtu.be'], instagram: ['instagram.com'] })) {
    if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return id;
  }
  return source;
}

function invalidSource() {
  return new ApiError(502, 'INVALID_SOURCE_DATA', '집계 응답 형식이나 집계 범위를 확인하지 못했습니다.');
}

function attributionOf(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.source !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,252}$/.test(value.source)
      || !SOURCE_TYPES.has(value.source_type)) throw invalidSource();
  const result = { source: value.source, source_type: value.source_type };
  for (const field of ['medium', 'campaign', 'content', 'referrer_host']) {
    const item = value[field] ?? '';
    const limit = field === 'referrer_host' ? 253 : 80;
    if (typeof item !== 'string' || item.length > limit || !/^[a-z0-9._-]*$/.test(item)) throw invalidSource();
    result[field] = item;
  }
  return result;
}

function coverageOf(value) {
  if (!value || typeof value !== 'object' || !COVERAGE_STATUSES.has(value.status) || typeof value.available !== 'boolean') throw invalidSource();
  const start = value.verified_start_day;
  const end = value.verified_end_day;
  if (!((start === null && end === null) || (isDay(start) && isDay(end) && start < end))) throw invalidSource();
  return {
    status: value.available ? value.status : 'unavailable',
    available: value.available,
    verified_start_day: start,
    verified_end_day: end,
    collector_status: 'unknown',
  };
}

function isCovered(day, coverage, today) {
  return coverage.available && coverage.verified_start_day !== null
    && day < today && coverage.verified_start_day <= day && day < coverage.verified_end_day;
}

function sumKnown(rows, metric) {
  const values = rows.map(row => row[metric]).filter(value => value !== null);
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) throw invalidSource();
  return sum;
}

function dailyMetric(rows, name, coverage, day, supported, today) {
  if (!coverage.available || !supported) return { value: null, status: 'unavailable' };
  const covered = isCovered(day, coverage, today);
  let value = sumKnown(rows, name);
  if (value === null && covered) value = 0;
  const partial = !covered && rows.some(row => row[name] === null);
  return { value, status: value === null ? 'missing' : covered ? 'verified' : partial ? 'partial' : 'unverified' };
}

function summary(daily, name, coverage, supported, today) {
  if (!coverage.available || !supported) return { value: null, status: 'unavailable' };
  const value = sumKnown(daily, name);
  if (value === null) return { value: null, status: 'missing' };
  const complete = daily.every(row => row[name] !== null && row.status[name] !== 'partial');
  const verified = complete && daily.every(row => isCovered(row.day, coverage, today));
  return { value, status: !complete || coverage.status === 'partial' ? 'partial' : verified ? 'verified' : 'unverified' };
}

export function normalizeOverview(raw, range, filters, now = new Date()) {
  if (!raw || raw.version !== 1 || raw.timezone !== 'UTC' || !Array.isArray(raw.daily)
      || raw.range?.start_day !== range.start_day || raw.range?.end_day !== range.end_day
      || raw.scope?.id !== 'blabee_landings_combined'
      || !raw.capabilities || raw.daily.length > 100_000) throw invalidSource();
  const coverage = Object.fromEntries(METRICS.map(name => [name, coverageOf(raw.coverage?.[name])]));
  const capabilities = {
    daily_page_views: raw.capabilities.daily_page_views === true && coverage.page_views.available,
    daily_beta_requests: raw.capabilities.daily_beta_requests === true && coverage.new_beta_requests.available,
    signup_attribution: raw.capabilities.signup_attribution === true,
    hourly: false,
    sessions: false,
    conversion_rate: false,
    post_windows: false,
  };
  const unfiltered = raw.daily.map(row => {
    if (!row || !isDay(row.day) || row.day < range.start_day || row.day >= range.end_day) throw invalidSource();
    const result = { day: row.day, attribution: attributionOf(row.attribution) };
    for (const name of METRICS) {
      const value = row[name];
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw invalidSource();
      result[name] = coverage[name].available ? value : null;
    }
    return result;
  });
  // Repeated source-day rows would inflate totals. The RPC must return each tuple once.
  const keys = new Set();
  for (const row of unfiltered) {
    const key = JSON.stringify([row.day, row.attribution]);
    if (keys.has(key)) throw invalidSource();
    keys.add(key);
  }
  const rows = unfiltered.filter(row => {
    if (!row.attribution) return !filters.channel && filters.campaign === null;
    return (!filters.channel || channelId(row.attribution.source) === filters.channel)
      && (filters.campaign === null || row.attribution.campaign === filters.campaign);
  });
  const dimensionFiltered = filters.channel !== null || filters.campaign !== null;
  const supported = {
    page_views: capabilities.daily_page_views,
    new_beta_requests: capabilities.daily_beta_requests && (!dimensionFiltered || capabilities.signup_attribution),
  };
  const today = now.toISOString().slice(0, 10);
  const daily = daysBetween(range.start_day, range.end_day).map(day => {
    const selected = rows.filter(row => row.day === day);
    const metrics = Object.fromEntries(METRICS.map(name => [name, dailyMetric(selected, name, coverage[name], day, supported[name], today)]));
    return {
      day,
      bucket_start: `${day}T00:00:00.000Z`,
      bucket_end: new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString(),
      is_today: day === today,
      page_views: metrics.page_views.value,
      new_beta_requests: metrics.new_beta_requests.value,
      status: Object.fromEntries(METRICS.map(name => [name, day === today && metrics[name].value !== null && metrics[name].status !== 'partial' ? 'collecting' : metrics[name].status])),
    };
  });
  const metrics = Object.fromEntries(METRICS.map(name => [name, summary(daily, name, coverage[name], supported[name], today)]));
  const attributedSignups = sumKnown(rows.filter(row => ['utm', 'referrer'].includes(row.attribution?.source_type)), 'new_beta_requests') ?? 0;
  metrics.signup_attribution = {
    value: capabilities.signup_attribution && metrics.new_beta_requests.value > 0 ? attributedSignups / metrics.new_beta_requests.value : null,
    status: capabilities.signup_attribution ? metrics.new_beta_requests.status : 'unavailable',
  };
  const grouped = new Map();
  for (const row of rows) {
    if (!row.attribution) continue;
    const id = channelId(row.attribution.source);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const channels = [...grouped].map(([id, channelRows]) => {
    const totals = Object.fromEntries(METRICS.map(name => {
      const channelDays = daily.map(({ day }) => {
        const metric = dailyMetric(channelRows.filter(row => row.day === day), name, coverage[name], day, supported[name], today);
        return { day, [name]: metric.value, status: { [name]: metric.status } };
      });
      return [name, summary(channelDays, name, coverage[name], supported[name], today)];
    }));
    return {
      id,
      label: LABELS[id] || id,
      page_views: totals.page_views.value,
      new_beta_requests: totals.new_beta_requests.value,
      status: Object.fromEntries(METRICS.map(name => [name, totals[name].status])),
      sources: [...new Map(channelRows.map(row => [JSON.stringify([row.attribution.source, row.attribution.source_type]), { source: row.attribution.source, source_type: row.attribution.source_type }])).values()],
    };
  }).sort((a, b) => (b.page_views ?? -1) - (a.page_views ?? -1) || a.id.localeCompare(b.id));
  const channelIds = new Set(unfiltered.flatMap(row => row.attribution ? [channelId(row.attribution.source)] : []));
  return {
    version: 1,
    generated_at: now.toISOString(),
    timezone: 'UTC',
    range,
    filters,
    scope: { id: 'blabee_landings_combined', label: 'Blabee 랜딩 합산' },
    capabilities,
    coverage,
    metrics,
    daily,
    channels,
    source_daily: rows,
    filter_options: {
      channels: [...channelIds].sort().map(id => ({ id, label: LABELS[id] || id })),
      campaigns: [...new Set(unfiltered.flatMap(row => row.attribution ? [row.attribution.campaign] : []))].sort(),
    },
  };
}

export async function handleOverview(context, { fetchImpl = fetch, now = () => new Date() } = {}) {
  try {
    assertMethod(context.request, ['GET']);
    const auth = await authorize(context.request, context.env, fetchImpl);
    const url = new URL(context.request.url);
    assertQuery(url, ['start', 'end', 'channel', 'campaign', 'grain']);
    if (url.searchParams.has('grain') && url.searchParams.get('grain') !== 'day') {
      throw new ApiError(400, 'UNSUPPORTED_GRAIN', '현재는 UTC 일별 집계만 제공됩니다.');
    }
    const time = now();
    const range = parseRange(url, time);
    const filters = parseFilters(url);
    const raw = await callRpc(auth, 'blabee_dashboard_overview', { p_start_day: range.start_day, p_end_day: range.end_day }, fetchImpl);
    return jsonResponse(normalizeOverview(raw, range, filters, time));
  } catch (error) {
    return errorResponse(error);
  }
}

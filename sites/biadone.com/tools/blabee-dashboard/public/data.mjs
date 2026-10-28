const DAY_MS = 86_400_000;
const METRICS = ['page_views', 'new_beta_requests'];
const countFormatter = new Intl.NumberFormat('ko-KR');
const kstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function dayTime(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
      || day < '2000-01-01' || day > '2199-12-31') return NaN;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : NaN;
}

function validNow(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('A valid current timestamp is required.');
  return date;
}

function boundsOf({ start, end } = {}, maxDays = 90) {
  const first = dayTime(start);
  const last = dayTime(end);
  const days = (last - first) / DAY_MS;
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 90
      || !Number.isInteger(days) || days < 1 || days > maxDays) {
    throw new RangeError('Use real UTC dates and an end-exclusive range of 1 to 90 days.');
  }
  return { start, end, days };
}

// Calendar dates follow the API's UTC buckets, including the current UTC date.
export function rangeForDays(days = 7, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RangeError('Choose 1 to 90 days.');
  const today = validNow(now).toISOString().slice(0, 10);
  const endTime = dayTime(today) + DAY_MS;
  const range = {
    start: new Date(endTime - days * DAY_MS).toISOString().slice(0, 10),
    end: new Date(endTime).toISOString().slice(0, 10),
  };
  boundsOf(range);
  return range;
}

export function validateRange(range, { now = new Date(), maxDays = 90 } = {}) {
  const result = boundsOf(range, maxDays);
  const tomorrow = dayTime(validNow(now).toISOString().slice(0, 10)) + DAY_MS;
  if (dayTime(result.end) > tomorrow) throw new RangeError('The range cannot extend beyond the current UTC day.');
  return result;
}

export function utcDays(range) {
  const { start, days } = boundsOf(range);
  return Array.from({ length: days }, (_, index) => new Date(dayTime(start) + index * DAY_MS).toISOString().slice(0, 10));
}

// Naive timestamps depend on the viewer's timezone, so only explicit offsets are accepted.
function timestampTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(dayTime(match[1]))
      || +match[2] > 23 || +match[3] > 59 || +match[4] > 59
      || (match[5] !== 'Z' && (+match[8] > 59 || +match[7] * 60 + +match[8] > 840))) return NaN;
  return Date.parse(value);
}

export function formatCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? countFormatter.format(value) : '—';
}

export function formatKST(timestamp) {
  const time = timestampTime(timestamp);
  if (!Number.isFinite(time)) return '—';
  const parts = Object.fromEntries(kstFormatter.formatToParts(new Date(time)).map(part => [part.type, part.value]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
}

export function formatUTCDay(day, { short = false } = {}) {
  if (!Number.isFinite(dayTime(day))) return '—';
  return (short ? day.slice(5) : day).replaceAll('-', '.');
}


export function isCount(value) { return Number.isSafeInteger(value) && value >= 0; }
export function formatCompactCount(value) {
  return isCount(value) ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : '—';
}
export function formatUTCTime(value, { grain = 'hour', full = false } = {}) {
  const time = timestampTime(value);
  if (!Number.isFinite(time)) return '—';
  const iso = new Date(time).toISOString();
  return (full ? iso.slice(0, 10) : iso.slice(5, 10)).replaceAll('-', '.')
    + (grain === 'day' ? '' : ' ' + iso.slice(11, 16)) + ' UTC';
}

const componentStatuses = new Set(['ready', 'empty', 'partial', 'unavailable']);
const metricStatuses = new Set(['verified', 'partial', 'unverified', 'unavailable', 'missing', 'collecting']);
function invalidData(provider) { throw new TypeError(provider + ' 집계 응답의 형식이나 범위를 확인하지 못했습니다.'); }
function optionalCount(value) { return value === null || isCount(value); }

export function validateOverview(value, range) {
  boundsOf(range);
  if (!value || value.version !== 1 || value.timezone !== 'UTC'
      || value.range?.start_day !== range.start || value.range?.end_day !== range.end
      || !Number.isFinite(timestampTime(value.generated_at)) || !value.capabilities
      || !Array.isArray(value.daily) || !Array.isArray(value.channels) || !Array.isArray(value.source_daily)
      || !Array.isArray(value.filter_options?.channels) || !Array.isArray(value.filter_options?.campaigns)) invalidData('Supabase');
  for (const metric of METRICS) {
    if (!optionalCount(value.metrics?.[metric]?.value) || !metricStatuses.has(value.metrics?.[metric]?.status)
        || !['verified', 'partial', 'unverified', 'unavailable'].includes(value.coverage?.[metric]?.status)
        || typeof value.coverage?.[metric]?.available !== 'boolean') invalidData('Supabase');
  }
  const days = new Set();
  for (const row of value.daily) {
    if (!Number.isFinite(dayTime(row?.day)) || row.day < range.start || row.day >= range.end || days.has(row.day)) invalidData('Supabase');
    days.add(row.day);
    for (const metric of METRICS) if (!optionalCount(row[metric]) || !metricStatuses.has(row.status?.[metric])) invalidData('Supabase');
  }
  for (const row of value.source_daily) {
    if (!Number.isFinite(dayTime(row?.day)) || row.day < range.start || row.day >= range.end) invalidData('Supabase');
    if (row.attribution !== null && (!row.attribution || typeof row.attribution.source !== 'string' || typeof row.attribution.source_type !== 'string')) invalidData('Supabase');
    for (const metric of METRICS) if (!optionalCount(row[metric])) invalidData('Supabase');
  }
  for (const row of value.channels) {
    if (!row || typeof row.id !== 'string' || typeof row.label !== 'string') invalidData('Supabase');
    for (const metric of METRICS) if (!optionalCount(row[metric])) invalidData('Supabase');
  }
  return value;
}

export function validateAnalytics(value, range) {
  boundsOf(range);
  if (!value || value.version !== 1 || value.provider !== 'cloudflare' || value.timezone !== 'UTC'
      || !['ready', 'empty', 'not_configured', 'rate_limited', 'unsupported_range', 'unavailable'].includes(value.status)
      || !['hour', 'day'].includes(value.grain) || !Number.isFinite(timestampTime(value.generated_at))
      || !(value.message === null || typeof value.message === 'string')
      || value.scope?.host !== 'biadone.com' || value.scope?.id !== 'blabee_main'
      || !Array.isArray(value.scope.paths) || value.scope.paths.length !== 2 || new Set(value.scope.paths).size !== 2
      || !value.scope.paths.includes('/blabee') || !value.scope.paths.includes('/blabee/')
      || value.range?.start_day !== range.start || value.range?.end_day !== range.end) invalidData('Cloudflare');
  const start = timestampTime(value.range.start_at), end = timestampTime(value.range.end_at);
  if (start !== dayTime(range.start) || !Number.isFinite(end) || end <= start
      || end > dayTime(range.end) || end > timestampTime(value.generated_at)) invalidData('Cloudflare');
  if (!value.source || !(value.source.dataset === null || typeof value.source.dataset === 'string')
      || !(value.source.sampled === null || typeof value.source.sampled === 'boolean')
      || !(value.source.sample_interval === null || (Number.isFinite(value.source.sample_interval) && value.source.sample_interval > 0))
      || typeof value.source.truncated !== 'boolean' || typeof value.source.bots !== 'string'
      || !componentStatuses.has(value.comparison?.status)) invalidData('Cloudflare');
  for (const metric of ['page_views', 'visits']) {
    const item = value.metrics?.[metric];
    if (!item || !optionalCount(item.value) || !optionalCount(item.previous_value) || !componentStatuses.has(item.status)
        || !(item.change_percent === null || Number.isFinite(item.change_percent))
        || ((item.previous_value === null || item.previous_value === 0) && item.change_percent !== null)) invalidData('Cloudflare');
  }
  if (!Array.isArray(value.series) || value.series.length > 2161) invalidData('Cloudflare');
  let previousEnd = start;
  for (const row of value.series) {
    const rowStart = timestampTime(row?.bucket_start), rowEnd = timestampTime(row?.bucket_end);
    if (!Number.isFinite(rowStart) || !Number.isFinite(rowEnd) || rowStart < previousEnd || rowEnd <= rowStart || rowEnd > end
        || !optionalCount(row.page_views) || !optionalCount(row.visits)) invalidData('Cloudflare');
    previousEnd = rowEnd;
  }
  if (!componentStatuses.has(value.hourly?.status) || !Array.isArray(value.hourly.rows) || value.hourly.rows.length > 24) invalidData('Cloudflare');
  const hours = new Set();
  for (const row of value.hourly.rows) {
    if (!Number.isInteger(row?.hour) || row.hour < 0 || row.hour > 23 || hours.has(row.hour)
        || !optionalCount(row.page_views) || !optionalCount(row.visits)) invalidData('Cloudflare');
    hours.add(row.hour);
  }
  for (const name of ['countries', 'browsers', 'operating_systems']) {
    const component = value.breakdowns?.[name];
    if (!componentStatuses.has(component?.status) || !Array.isArray(component.rows) || component.rows.length > 500) invalidData('Cloudflare');
    const ids = new Set();
    for (const row of component.rows) {
      if (!row || typeof row.id !== 'string' || typeof row.label !== 'string' || !isCount(row.value) || ids.has(row.id)) invalidData('Cloudflare');
      ids.add(row.id);
    }
  }
  return value;
}

export function sourceChannel(source) {
  const host = source.replace(/^www\./, '');
  for (const [id, domains] of Object.entries({ reddit: ['reddit', 'reddit.com'], x: ['x', 'x.com', 'twitter.com', 't.co'], youtube: ['youtube', 'youtube.com', 'youtu.be'], instagram: ['instagram', 'instagram.com'] })) {
    if (domains.some(domain => host === domain || host.endsWith('.' + domain))) return id;
  }
  return source;
}
function sumKnown(rows, metric) {
  const counts = rows.map(row => row[metric]).filter(isCount);
  if (!counts.length) return null;
  const value = counts.reduce((sum, item) => sum + item, 0);
  return isCount(value) ? value : null;
}

// These filters affect only the Supabase details; the main overview stays unchanged.
export function filterSupplement(overview, { channel = null, campaign = null } = {}) {
  channel = channel === '__all__' ? null : channel;
  campaign = campaign === '__all__' ? null : campaign;
  const filtered = channel !== null || campaign !== null;
  if (!filtered && overview.metrics && Array.isArray(overview.daily) && Array.isArray(overview.channels)) return overview;
  const today = new Date(overview.generated_at).toISOString().slice(0, 10);
  const rows = overview.source_daily.filter(row => row.attribution
    ? (channel === null || sourceChannel(row.attribution.source) === channel) && (campaign === null || row.attribution.campaign === campaign)
    : !filtered);
  const covered = (day, metric) => {
    const coverage = overview.coverage[metric];
    return coverage.available && day < today && coverage.verified_start_day !== null
      && coverage.verified_start_day <= day && day < coverage.verified_end_day;
  };
  const supported = {
    page_views: overview.capabilities.daily_page_views,
    new_beta_requests: overview.capabilities.daily_beta_requests && (!filtered || overview.capabilities.signup_attribution),
  };
  const daily = utcDays({ start: overview.range.start_day, end: overview.range.end_day }).map(day => {
    const selected = rows.filter(row => row.day === day);
    const values = Object.fromEntries(METRICS.map(metric => [metric, !supported[metric] ? null : sumKnown(selected, metric) ?? (covered(day, metric) ? 0 : null)]));
    const partial = metric => !covered(day, metric) && selected.some(row => isCount(row[metric])) && selected.some(row => row[metric] === null);
    return { day, ...values, status: Object.fromEntries(METRICS.map(metric => [metric,
      !supported[metric] ? 'unavailable' : values[metric] === null ? 'missing' : partial(metric) ? 'partial' : day === today ? 'collecting' : covered(day, metric) ? 'verified' : 'unverified',
    ])) };
  });
  const metrics = Object.fromEntries(METRICS.map(metric => {
    const value = supported[metric] ? sumKnown(daily, metric) : null;
    const status = !supported[metric] ? 'unavailable' : value === null ? 'missing'
      : daily.some(row => row[metric] === null || row.status[metric] === 'partial') || overview.coverage[metric].status === 'partial' ? 'partial'
        : daily.every(row => covered(row.day, metric)) ? 'verified' : 'unverified';
    return [metric, { value, status }];
  }));
  const identified = sumKnown(rows.filter(row => ['utm', 'referrer'].includes(row.attribution?.source_type)), 'new_beta_requests') ?? 0;
  metrics.signup_attribution = { value: overview.capabilities.signup_attribution && metrics.new_beta_requests.value > 0 ? identified / metrics.new_beta_requests.value : null, status: metrics.new_beta_requests.status };
  const grouped = new Map();
  for (const row of rows) {
    if (!row.attribution) continue;
    const id = sourceChannel(row.attribution.source);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const labels = new Map(overview.filter_options.channels.map(row => [row.id, row.label]));
  const channels = [...grouped].map(([id, items]) => ({
    id, label: labels.get(id) ?? id,
    ...Object.fromEntries(METRICS.map(metric => [metric, supported[metric] ? sumKnown(items, metric) : null])),
    status: Object.fromEntries(METRICS.map(metric => [metric, metrics[metric].status])),
    sources: [...new Map(items.map(row => [JSON.stringify([row.attribution.source, row.attribution.source_type]), { source: row.attribution.source, source_type: row.attribution.source_type }])).values()],
  }));
  return { ...overview, filters: { channel, campaign }, metrics, daily, channels, source_daily: rows };
}
export function dailySeries(daily, metric) {
  return daily.map(row => ({ bucket_start: row.day + 'T00:00:00.000Z', bucket_end: new Date(dayTime(row.day) + DAY_MS).toISOString(), [metric]: row[metric] }));
}
// Null values and absent buckets break a line instead of inventing zero.
export function lineSegments(series, metric) {
  const result = []; let current = [];
  const flush = () => { if (current.length) result.push(current); current = []; };
  series.forEach((row, index) => {
    if (!isCount(row[metric])) { flush(); return; }
    if (current.length && Date.parse(current.at(-1).bucket_end) !== Date.parse(row.bucket_start)) flush();
    current.push({ ...row, value: row[metric], index });
  });
  flush(); return result;
}
export function hourlyRows(rows = []) {
  const byHour = new Map(rows.map(row => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? { hour, page_views: null, visits: null });
}

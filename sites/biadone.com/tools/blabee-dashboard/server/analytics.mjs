import { authorize, callRpc } from './auth.mjs';
import { assertMethod, assertQuery, errorResponse, jsonResponse } from './http.mjs';
import { normalizeOverview, parseRange } from './overview.mjs';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ZONE_TAG = 'ea37fec2cfe3490e5ff1622f3d260567';
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const DIAGNOSTIC_REVISION = 'cf-auth-check-20261017-v2';
const TOKEN_VERIFY_URLS = [
  ['token_account', 'https://api.cloudflare.com/client/v4/accounts/94217884f3a123f7d12341dbc556751c/tokens/verify'],
  ['token_user', 'https://api.cloudflare.com/client/v4/user/tokens/verify'],
];
const TRACE_ENDPOINTS = new Set(['settings', 'data', 'token_account', 'token_user']);
const DATASET = 'httpRequestsAdaptiveGroups';
const SCOPE = Object.freeze({ id: 'blabee_main', host: 'biadone.com', paths: ['/blabee', '/blabee/'], label: 'biadone.com/blabee/' });
const SETTINGS_QUERY = 'query DashboardCapabilities($zoneTag:string!) { viewer { zones(filter:{zoneTag:$zoneTag}) { settings { httpRequestsAdaptiveGroups { enabled availableFields maxDuration maxNumberOfFields maxPageSize notOlderThan } } } } }';
let countryNames;
try { countryNames = new Intl.DisplayNames(['ko'], { type: 'region', fallback: 'none' }); }
catch { /* Keep the provider's original country code when display names are unsupported. */ }

class ProviderFailure extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function invalidProvider() {
  return new ProviderFailure('unavailable', 'invalid_response', 'Cloudflare 분석 응답을 확인하지 못했습니다.');
}

function numericErrorCodes(body) {
  const codes = new Set();
  function visit(errors, depth) {
    if (!Array.isArray(errors) || depth > 2 || codes.size >= 5) return;
    for (const error of errors.slice(0, 20)) {
      for (const raw of [error?.code, error?.extensions?.code]) {
        const code = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : raw;
        if (Number.isSafeInteger(code) && code >= 0 && code <= 999_999_999) codes.add(code);
        if (codes.size >= 5) return;
      }
      if (depth < 2) {
        visit(error?.errors, depth + 1);
        visit(error?.error_chain, depth + 1);
        visit(error?.extensions?.errors, depth + 1);
      }
      if (codes.size >= 5) return;
    }
  }
  visit(body?.errors, 1);
  return [...codes];
}

function recordTrace(trace, entry) {
  if (trace.length >= 3 || !TRACE_ENDPOINTS.has(entry.endpoint)) return;
  trace.push({
    endpoint: entry.endpoint,
    http_status: Number.isInteger(entry.http_status) && entry.http_status >= 100 && entry.http_status <= 599 ? entry.http_status : null,
    error_codes: entry.error_codes.filter(code => Number.isSafeInteger(code) && code >= 0 && code <= 999_999_999).slice(0, 5),
    ...(['network', 'timeout'].includes(entry.transport_error) ? { transport_error: entry.transport_error } : {}),
  });
}

function traceSuffix(trace) {
  return ` [진단: ${trace.map(entry => `${entry.endpoint} HTTP${entry.http_status ?? '없음'} codes${entry.error_codes.join(',') || '없음'}${entry.transport_error ? ` ${entry.transport_error}` : ''}`).join('; ')}]`;
}

async function providerResponse(fetchImpl, url, init, timeoutMs, entry) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Provider request timed out.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, redirect: 'manual', cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted) throw new Error('Provider request timed out.');
        entry.http_status = response.status;
        let body;
        try { body = await response.json(); }
        catch (error) { if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error; }
        if (controller.signal.aborted) throw new Error('Provider request timed out.');
        entry.error_codes = numericErrorCodes(body);
        return { status: response.status, body };
      })(),
      deadline,
    ]);
  } catch (error) {
    entry.transport_error = controller.signal.aborted ? 'timeout' : 'network';
    throw error;
  } finally { clearTimeout(timer); }
}

function httpFailure(status) {
  if (status === 429) return new ProviderFailure('rate_limited', 'rate_limited', 'Cloudflare 조회 한도에 도달했습니다. 잠시 후 다시 조회해 주세요.');
  if (status === 401) return new ProviderFailure('unavailable', 'provider_authentication', 'Cloudflare 분석 읽기 자격 증명을 확인해 주세요.');
  if (status === 403) return new ProviderFailure('unavailable', 'provider_permission', 'Cloudflare 분석 읽기 권한을 확인해 주세요.');
  if (status >= 300 && status < 400) return new ProviderFailure('unavailable', 'redirect_rejected', 'Cloudflare 분석 원천의 응답 경로를 확인하지 못했습니다.');
  if (status !== null && (status < 200 || status >= 300)) return new ProviderFailure('unavailable', 'upstream_unavailable', 'Cloudflare 분석 원천에 연결하지 못했습니다.');
  return null;
}

function graphqlFailure(errors) {
  const codes = errors.map(error => String(error?.extensions?.code ?? error?.code ?? ''));
  const messages = errors.map(error => typeof error?.message === 'string' ? error.message : '').join(' ');
  if (codes.some(code => /rate|budget|quota/i.test(code)) || /rate.?limit|quota|budget.?depleted/i.test(messages)) {
    return new ProviderFailure('rate_limited', 'rate_limited', 'Cloudflare 조회 한도에 도달했습니다. 잠시 후 다시 조회해 주세요.');
  }
  if (/maxDuration|notOlderThan|retention|older than|time range.*(?:large|long|exceed)/i.test(messages)) {
    return new ProviderFailure('unsupported_range', 'unsupported_range', '선택한 기간은 Cloudflare 원천의 조회·보존 범위를 벗어납니다.');
  }
  if (/permission|not authorized|forbidden|not allowed|unauthori[sz]ed.*(?:requested )?resource/i.test(messages)) {
    return new ProviderFailure('unavailable', 'provider_permission', 'Cloudflare에서 biadone.com 분석 읽기 권한과 Zone 리소스 범위를 확인해 주세요.');
  }
  if (/authentication|invalid.*token|token.*(?:expired|revoked|invalid)/i.test(messages)) {
    return new ProviderFailure('unavailable', 'provider_authentication', 'Cloudflare API 토큰 값과 활성 상태를 확인해 주세요.');
  }
  if (codes.includes('9109') || /unauthori[sz]ed/i.test(messages)) {
    return new ProviderFailure('unavailable', 'provider_access_denied', 'Cloudflare API 토큰의 활성 상태와 분석 읽기 권한·리소스 범위를 확인해 주세요.');
  }
  return new ProviderFailure('unavailable', 'graphql_error', 'Cloudflare 분석 조회가 완료되지 않았습니다.');
}

async function tokenState(fetchImpl, token, now, timeoutMs, trace) {
  for (const [endpoint, url] of TOKEN_VERIFY_URLS) {
    const entry = { endpoint, http_status: null, error_codes: [] };
    try {
      const { status: httpStatus, body } = await providerResponse(fetchImpl, url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }, Math.min(timeoutMs, 2_000), entry);
      if (httpStatus < 200 || httpStatus >= 300) continue;
      if (body?.success !== true || (body.errors != null && (!Array.isArray(body.errors) || body.errors.length))) continue;
      const status = body.result?.status;
      if (status === 'disabled' || status === 'expired') return status;
      if (status !== 'active') continue;
      const expiry = body.result.expires_on, beginning = body.result.not_before;
      if ((expiry != null && (typeof expiry !== 'string' || !Number.isFinite(Date.parse(expiry))))
          || (beginning != null && (typeof beginning !== 'string' || !Number.isFinite(Date.parse(beginning))))) continue;
      if (expiry != null && Date.parse(expiry) <= now.getTime()) return 'expired';
      if (beginning != null && Date.parse(beginning) > now.getTime()) return 'not_yet_active';
      return 'active';
    } catch { /* A failed verification endpoint cannot prove that a token is invalid. */ }
    finally { recordTrace(trace, entry); }
  }
  return 'unverified';
}

async function diagnoseAccess(error, fetchImpl, token, now, timeoutMs, trace) {
  if (!['provider_authentication', 'provider_permission', 'provider_access_denied'].includes(error.code)) return error;
  const status = await tokenState(fetchImpl, token, now, timeoutMs, trace);
  if (status === 'active') return new ProviderFailure('unavailable', 'provider_permission', '토큰은 활성 상태이지만 biadone.com 분석 조회가 거부되었습니다. 분석 읽기 권한·Zone 리소스 범위·접근 제한을 확인해 주세요.');
  if (status === 'expired') return new ProviderFailure('unavailable', 'provider_token_expired', 'Cloudflare API 토큰이 만료되었습니다. 활성 API 토큰 값만 Production 비밀값에 저장해 주세요.');
  if (status === 'disabled') return new ProviderFailure('unavailable', 'provider_token_disabled', 'Cloudflare API 토큰이 비활성 상태입니다. 활성 API 토큰 값만 Production 비밀값에 저장해 주세요.');
  if (status === 'not_yet_active') return new ProviderFailure('unavailable', 'provider_token_not_yet_active', 'Cloudflare API 토큰의 사용 시작 시각이 아직 지나지 않았습니다. 토큰의 사용 기간을 확인해 주세요.');
  if (error.code === 'provider_permission') return error;
  return new ProviderFailure('unavailable', 'provider_access_unverified', 'Cloudflare 토큰의 활성 상태를 확인하지 못했습니다. API 토큰 값만 저장했는지, 만료 여부와 분석 읽기 권한·리소스 범위를 확인해 주세요.');
}

async function queryCloudflare(fetchImpl, token, query, variables, timeoutMs, trace, endpoint) {
  const entry = { endpoint, http_status: null, error_codes: [] };
  try {
    const { status, body } = await providerResponse(fetchImpl, GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    }, timeoutMs, entry);
    const failure = httpFailure(status);
    if (failure) throw failure;
    if (!body || typeof body !== 'object' || (body.errors != null && !Array.isArray(body.errors))) throw invalidProvider();
    if (body.errors?.length) throw graphqlFailure(body.errors);
    const zones = body.data?.viewer?.zones;
    if (!Array.isArray(zones) || zones.length !== 1 || !zones[0] || typeof zones[0] !== 'object') throw invalidProvider();
    return zones[0];
  } catch (error) {
    recordTrace(trace, entry);
    if (error instanceof ProviderFailure) throw error;
    const failure = httpFailure(entry.http_status);
    if (failure) throw failure;
    if (entry.transport_error === 'timeout') throw new ProviderFailure('unavailable', 'timeout', 'Cloudflare 분석 조회 시간이 초과되었습니다. 다시 조회해 주세요.');
    throw new ProviderFailure('unavailable', 'upstream_unavailable', 'Cloudflare 분석 원천에 연결하지 못했습니다.');
  }
}

function capabilitiesOf(raw) {
  if (!raw || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.availableFields)
      || raw.availableFields.length > 1_000 || raw.availableFields.some(field => typeof field !== 'string')
      || !['maxDuration', 'maxPageSize', 'notOlderThan'].every(field => Number.isSafeInteger(raw[field]) && raw[field] > 0)) throw invalidProvider();
  if (!raw.enabled) throw new ProviderFailure('unavailable', 'dataset_disabled', '이 Cloudflare 원천의 분석 조회가 활성화되지 않았습니다.');
  const fields = new Set(raw.availableFields);
  if (!fields.has('count')) throw new ProviderFailure('unavailable', 'unsupported_dataset', '이 Cloudflare 원천은 HTML 요청 집계를 제공하지 않습니다.');
  return {
    visits: fields.has('sum_visits'), sampling: fields.has('avg_sampleInterval'),
    hourly: fields.has('dimensions_datetimeHour'), countries: fields.has('dimensions_clientCountryName'),
    browsers: fields.has('dimensions_userAgentBrowser'), operatingSystems: fields.has('dimensions_userAgentOS'),
    maxDuration: raw.maxDuration * 1_000, retention: raw.notOlderThan * 1_000,
    limits: { hourly: Math.min(raw.maxPageSize, 10_000), countries: Math.min(raw.maxPageSize, 250), browsers: Math.min(raw.maxPageSize, 100), operatingSystems: Math.min(raw.maxPageSize, 100) },
  };
}

function supportedPeriod(start, end, caps, now) {
  return end > start && end - start <= caps.maxDuration && start >= now.getTime() - caps.retention;
}

function analyticsQuery(caps, previous) {
  const fields = `count${caps.visits ? ' sum { visits }' : ''}${caps.sampling ? ' avg { sampleInterval }' : ''}`;
  const filter = (from, to) => `{datetime_geq:${from},datetime_lt:${to},clientRequestHTTPHost:"biadone.com",clientRequestHTTPMethodName:"GET",requestSource:"eyeball",edgeResponseContentTypeName:"html",edgeResponseStatus_geq:200,edgeResponseStatus_lt:300,OR:[{clientRequestPath:"/blabee"},{clientRequestPath:"/blabee/"}]}`;
  const group = (alias, limit, from, to, dimension, order) => `${alias}:httpRequestsAdaptiveGroups(limit:${limit},filter:${filter(from, to)}${order ? `,orderBy:[${order}]` : ''}){${fields}${dimension ? ` dimensions{${dimension}}` : ''}}`;
  const entries = [group('totals', 1, '$from', '$to')];
  if (previous) entries.push(group('previous', 1, '$previousFrom', '$from'));
  for (const [alias, dimension, order] of [['hourly', 'datetimeHour', 'datetimeHour_ASC'], ['countries', 'clientCountryName', 'count_DESC'], ['browsers', 'userAgentBrowser', 'count_DESC'], ['operatingSystems', 'userAgentOS', 'count_DESC']]) {
    if (caps[alias]) entries.push(group(alias, caps.limits[alias], '$from', '$to', dimension, order));
  }
  return `query DashboardLandingAnalytics($zoneTag:string!,$from:Time!,$to:Time!${previous ? ',$previousFrom:Time!' : ''}){viewer{zones(filter:{zoneTag:$zoneTag}){${entries.join(' ')}}}}`;
}

export function buildAnalyticsRequest(settings, range, now) {
  const caps = capabilitiesOf(settings);
  const result = responseBase(range, now);
  result.source.dataset = DATASET;
  const start = Date.parse(result.range.start_at), end = Date.parse(result.range.end_at);
  if (!supportedPeriod(start, end, caps, now)) throw new ProviderFailure('unsupported_range', 'unsupported_range', '선택한 기간은 Cloudflare 원천의 조회·보존 범위를 벗어납니다.');
  const previousStart = start - (end - start);
  const previousSupported = supportedPeriod(previousStart, start, caps, now);
  if (previousSupported) result.comparison = { status: 'unavailable', start_at: new Date(previousStart).toISOString(), end_at: new Date(start).toISOString() };
  return {
    query: analyticsQuery(caps, previousSupported),
    variables: { zoneTag: ZONE_TAG, from: result.range.start_at, to: result.range.end_at, ...(previousSupported ? { previousFrom: new Date(previousStart).toISOString() } : {}) },
    caps, result, previousSupported,
  };
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidProvider();
  return value;
}

function addCount(a, b) { return safeCount(a + b); }

function measure(row, caps) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidProvider();
  const sample = caps.sampling ? row.avg?.sampleInterval : null;
  if (sample !== null && (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 1)) throw invalidProvider();
  return { page_views: safeCount(row.count), visits: caps.visits ? safeCount(row.sum?.visits) : null, sample };
}

function rowsOf(raw, name, limit) {
  if (!Array.isArray(raw[name]) || raw[name].length > limit) throw invalidProvider();
  return raw[name];
}

function countryLabel(value) {
  if (value === 'T1') return 'Tor 네트워크';
  if (/^[A-Za-z]{2}$/.test(value)) {
    try { return countryNames?.of(value.toUpperCase()) || value; }
    catch { /* Nonstandard codes stay visible with their original identifier. */ }
  }
  return value;
}

function breakdown(raw, name, dimension, caps) {
  if (!caps[name]) return { status: 'unavailable', rows: [] };
  const rows = rowsOf(raw, name, caps.limits[name]);
  const grouped = new Map();
  for (const row of rows) {
    const rawValue = row.dimensions?.[dimension];
    if (rawValue !== null && (typeof rawValue !== 'string' || rawValue.length > 300 || /[\u0000-\u001f\u007f]/.test(rawValue))) throw invalidProvider();
    const value = rawValue ?? '';
    const id = value || 'unknown';
    const label = !value || /^(?:unknown|xx)$/i.test(value) ? '알 수 없음' : name === 'countries' ? countryLabel(value) : value;
    const count = measure(row, caps).page_views;
    grouped.set(id, { id, label, value: addCount(grouped.get(id)?.value ?? 0, count) });
  }
  return { status: rows.length >= caps.limits[name] ? 'partial' : rows.length ? 'ready' : 'empty', rows: [...grouped.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)) };
}

export function normalizeAnalytics(raw, result, caps, previousSupported) {
  const totals = rowsOf(raw, 'totals', 1);
  const current = totals.length ? measure(totals[0], caps) : null;
  const previousRows = previousSupported ? rowsOf(raw, 'previous', 1) : [];
  const previous = previousRows.length ? measure(previousRows[0], caps) : null;
  const start = Date.parse(result.range.start_at), end = Date.parse(result.range.end_at);
  const rawHours = caps.hourly ? rowsOf(raw, 'hourly', caps.limits.hourly) : [];
  const hours = new Map();
  for (const row of rawHours) {
    const instant = typeof row.dimensions?.datetimeHour === 'string' ? Date.parse(row.dimensions.datetimeHour) : NaN;
    if (!Number.isFinite(instant) || instant % HOUR_MS !== 0 || instant >= end || instant + HOUR_MS <= start || hours.has(instant)) throw invalidProvider();
    hours.set(instant, measure(row, caps));
  }
  const series = new Map(), hourly = new Map();
  if (caps.hourly && (hours.size || current?.page_views > 0 || current?.visits > 0)) {
    const duration = result.grain === 'day' ? DAY_MS : HOUR_MS;
    for (let bucket = Math.floor(start / duration) * duration; bucket < end; bucket += duration) {
      series.set(bucket, {
        bucket_start: new Date(Math.max(bucket, start)).toISOString(), bucket_end: new Date(Math.min(bucket + duration, end)).toISOString(),
        page_views: null, visits: null,
      });
    }
    for (let hour = 0; hour < 24; hour++) hourly.set(hour, { hour, page_views: null, visits: null });
  }
  for (const [instant, counts] of [...hours].sort((a, b) => a[0] - b[0])) {
    const bucket = result.grain === 'day' ? Math.floor(instant / DAY_MS) * DAY_MS : instant;
    const duration = result.grain === 'day' ? DAY_MS : HOUR_MS;
    const existing = series.get(bucket);
    series.set(bucket, {
      bucket_start: new Date(Math.max(bucket, start)).toISOString(), bucket_end: new Date(Math.min(bucket + duration, end)).toISOString(),
      page_views: addCount(existing?.page_views ?? 0, counts.page_views), visits: caps.visits ? addCount(existing?.visits ?? 0, counts.visits) : null,
    });
    const hour = new Date(instant).getUTCHours(), existingHour = hourly.get(hour);
    hourly.set(hour, { hour, page_views: addCount(existingHour?.page_views ?? 0, counts.page_views), visits: caps.visits ? addCount(existingHour?.visits ?? 0, counts.visits) : null });
  }
  result.breakdowns = { countries: breakdown(raw, 'countries', 'clientCountryName', caps), browsers: breakdown(raw, 'browsers', 'userAgentBrowser', caps), operating_systems: breakdown(raw, 'operatingSystems', 'userAgentOS', caps) };
  if (!current && (rawHours.length || Object.values(result.breakdowns).some(component => component.rows.length))) throw invalidProvider();
  const truncatedHours = rawHours.length >= caps.limits.hourly;
  result.series = [...series.values()];
  result.hourly = { status: !caps.hourly ? 'unavailable' : truncatedHours || (current?.page_views > 0 && !rawHours.length) ? 'partial' : rawHours.length ? 'ready' : 'empty', rows: [...hourly.values()].sort((a, b) => a.hour - b.hour) };
  result.source.truncated = truncatedHours || ['countries', 'browsers', 'operatingSystems'].some(name => caps[name] && raw[name].length >= caps.limits[name]);
  const measures = [...totals, ...previousRows, ...rawHours, ...Object.keys(caps.limits).filter(name => name !== 'hourly' && caps[name]).flatMap(name => raw[name])].map(row => measure(row, caps));
  result.source.sampled = caps.sampling && measures.length ? measures.some(item => item.sample > 1) ? true : measures.every(item => item.sample === 1) ? false : null : null;
  result.source.sample_interval = current?.sample ?? null;
  if (current) {
    const unsampled = result.source.sampled === false;
    if (caps.hourly && !truncatedHours && unsampled) {
      const pageViews = [...hours.values()].reduce((sum, row) => addCount(sum, row.page_views), 0);
      const visits = caps.visits ? [...hours.values()].reduce((sum, row) => addCount(sum, row.visits), 0) : null;
      if (pageViews !== current.page_views || (caps.visits && visits !== current.visits)) result.hourly.status = 'partial';
    }
    for (const [name, alias] of [['countries', 'countries'], ['browsers', 'browsers'], ['operating_systems', 'operatingSystems']]) {
      if (!caps[alias]) continue;
      const component = result.breakdowns[name];
      const total = component.rows.reduce((sum, row) => addCount(sum, row.value), 0);
      if ((current.page_views > 0 && !component.rows.length)
          || (unsampled && raw[alias].length < caps.limits[alias] && total !== current.page_views)) component.status = 'partial';
    }
  }
  result.source.incomplete = result.hourly.status === 'partial' || Object.values(result.breakdowns).some(component => component.status === 'partial');
  result.status = !current || (current.page_views === 0 && (current.visits === null || current.visits === 0)) ? 'empty' : 'ready';
  result.message = result.status === 'empty' ? '선택한 범위에서 제공된 Edge HTML 측정 기록이 없습니다. 빈 응답만으로 실제 유입 0을 확정하지 않습니다.' : result.source.truncated ? '일부 세부 목록이 조회 한도에 도달해 부분 집계로 표시됩니다.' : result.source.incomplete ? '일부 세부 집계가 누락되었거나 요약과 일치하지 않아 부분 집계로 표시됩니다.' : null;
  result.diagnostic_code = null;
  for (const name of ['page_views', 'visits']) {
    const value = current?.[name] ?? null, previousValue = previous?.[name] ?? null;
    result.metrics[name] = { value, previous_value: previousValue, change_percent: value !== null && previousValue > 0 ? Math.round((value - previousValue) / previousValue * 10_000) / 100 : null, status: name === 'visits' && !caps.visits ? 'unavailable' : current ? (value === 0 ? 'empty' : 'ready') : 'empty' };
  }
  if (previousSupported) result.comparison.status = previous ? 'ready' : 'empty';
  return result;
}

function responseBase(range, now) {
  const start = new Date(`${range.start_day}T00:00:00Z`);
  const end = new Date(Math.min(Date.parse(`${range.end_day}T00:00:00Z`), now.getTime()));
  const emptyMetric = () => ({ value: null, previous_value: null, change_percent: null, status: 'unavailable' });
  const emptyComponent = () => ({ status: 'unavailable', rows: [] });
  return {
    version: 1,
    provider: 'cloudflare',
    generated_at: now.toISOString(),
    timezone: 'UTC',
    scope: SCOPE,
    range: { ...range, start_at: start.toISOString(), end_at: end.toISOString() },
    grain: end - start <= 7 * DAY_MS ? 'hour' : 'day',
    status: 'not_configured',
    diagnostic_code: 'missing_token',
    message: 'Cloudflare 분석 읽기 연결이 아직 설정되지 않았습니다.',
    source: { dataset: null, sampled: null, sample_interval: null, bots: 'included', truncated: false },
    comparison: { status: 'unavailable', start_at: null, end_at: null },
    metrics: { page_views: emptyMetric(), visits: emptyMetric() },
    series: [],
    hourly: emptyComponent(),
    breakdowns: { countries: emptyComponent(), browsers: emptyComponent(), operating_systems: emptyComponent() },
  };
}

export async function handleAnalytics(context, { fetchImpl = fetch, now = () => new Date(), providerTimeoutMs = 10_000 } = {}) {
  try {
    assertMethod(context.request, ['GET']);
    const auth = await authorize(context.request, context.env, fetchImpl);
    const url = new URL(context.request.url);
    assertQuery(url, ['start', 'end']);
    const time = now();
    const range = parseRange(url, time);
    // The database maintains its independent owner registry. Read only one UTC day
    // to recheck it before disclosing a second provider's private analytics.
    const gateRange = { start_day: range.start_day, end_day: new Date(Date.parse(`${range.start_day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10) };
    const gate = await callRpc(auth, 'blabee_dashboard_overview', { p_start_day: gateRange.start_day, p_end_day: gateRange.end_day }, fetchImpl);
    normalizeOverview(gate, gateRange, { channel: null, campaign: null }, time);
    const result = responseBase(range, time);
    const tokenKey = Object.hasOwn(context.env ?? {}, 'CF_ANALYTICS_API_TOKEN_V2') ? 'CF_ANALYTICS_API_TOKEN_V2' : 'CF_ANALYTICS_API_TOKEN';
    const token = context.env?.[tokenKey];
    if (typeof token !== 'string' || !token.trim()) return jsonResponse(result);
    let stage = 'token_format';
    const trace = [];
    try {
      if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token.trim()) || /^Bearer$/i.test(token.trim()) || token.trim().length > 4_096) {
        throw new ProviderFailure('unavailable', 'invalid_token_format', `${tokenKey}에는 Bearer 접두어·따옴표·JSON 없이 Cloudflare API 토큰 값만 저장해 주세요.`);
      }
      stage = 'settings';
      const settings = await queryCloudflare(fetchImpl, token.trim(), SETTINGS_QUERY, { zoneTag: ZONE_TAG }, providerTimeoutMs, trace, stage);
      result.source.dataset = DATASET;
      const generated = buildAnalyticsRequest(settings.settings?.[DATASET], range, time);
      stage = 'data';
      const raw = await queryCloudflare(fetchImpl, token.trim(), generated.query, generated.variables, providerTimeoutMs, trace, stage);
      return jsonResponse(normalizeAnalytics(raw, generated.result, generated.caps, generated.previousSupported));
    } catch (error) {
      if (!(error instanceof ProviderFailure)) throw error;
      const diagnosed = await diagnoseAccess(error, fetchImpl, token.trim(), time, providerTimeoutMs, trace);
      result.status = diagnosed.status;
      result.diagnostic_code = diagnosed.code;
      result.diagnostic_stage = stage;
      const denied = ['provider_permission', 'provider_access_unverified', 'provider_token_expired', 'provider_token_disabled', 'provider_token_not_yet_active'].includes(diagnosed.code);
      result.message = denied ? `${stage === 'settings' ? '연결 설정 조회' : '분석 데이터 조회'}: ${diagnosed.message}` : diagnosed.message;
      if (trace.length) {
        result.diagnostic_trace = trace;
        result.diagnostic_revision = DIAGNOSTIC_REVISION;
        result.message += ` [서버: ${DIAGNOSTIC_REVISION}]${traceSuffix(trace)}`;
      }
      return jsonResponse(result);
    }
  } catch (error) {
    return errorResponse(error);
  }
}

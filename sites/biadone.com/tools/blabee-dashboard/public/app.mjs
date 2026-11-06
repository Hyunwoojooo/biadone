import { rangeForDays, validateRange, formatCount, formatCompactCount, formatKST, formatUTCDay, validateOverview, validateAnalytics, filterSupplement, dailySeries, isCount } from './data.mjs';
import { loadDemo } from './demo.mjs';
import { drawSparkline, drawLineChart, drawHourlyChart } from './charts.mjs';
import { initAuth, beginLogin, accessToken, clearSession, sessionExpiresAt, getAuthConfig } from './auth.mjs';
import { createDashboardPaths } from './paths.mjs';

const appPaths = createDashboardPaths(import.meta.url, location.href);
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = {
  range: rangeForDays(), period: 7, channel: '__all__', campaign: '__all__', tab: 'dates', ascending: false,
  demo: false, overview: null, analytics: null, analyticsError: null, analyticsLoading: false,
  loading: false, signedIn: false, authReady: false, authBusy: true, error: null, requestId: 0,
};
const STATUS = { ready: '기록된 값', empty: '관측 없음', partial: '부분 집계', verified: '확인된 집계', collecting: '집계 중', unverified: '기록된 값', missing: '미수집', unavailable: '미제공' };
const CF_STATUS = { not_configured: 'Cloudflare 미연결', rate_limited: 'Cloudflare 조회 제한', unsupported_range: '지원하지 않는 조회 기간', unavailable: 'Cloudflare 조회 불가' };
let expiryTimer, pageActive = true;

const statusLabel = value => STATUS[value] || '상태 확인 필요';
const datePlus = (day, days) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10);
function showDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function clearPrivateData(message = null, { preserveSession = false } = {}) {
  state.requestId++; state.overview = null; state.analytics = null; state.analyticsError = null; state.analyticsLoading = false;
  state.signedIn = false; state.loading = false; state.demo = false; state.authBusy = false; state.error = message;
  state.channel = '__all__'; state.campaign = '__all__'; state.period = 7; state.range = rangeForDays();
  clearTimeout(expiryTimer);
  if (!preserveSession) clearSession();
  for (const id of ['period-dialog', 'info-dialog']) closeDialog(id);
  $('info-content').replaceChildren(); $('period-form').reset(); $('period-error').textContent = '';
  render();
}
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (state.demo || !state.signedIn) return;
  const remaining = sessionExpiresAt() - Date.now();
  if (remaining <= 0) { clearPrivateData('로그인이 만료되었습니다. 다시 로그인해 주세요.'); return; }
  expiryTimer = setTimeout(() => clearPrivateData('로그인이 만료되었습니다. 다시 로그인해 주세요.'), Math.min(remaining, 86400_000));
}
async function request(path) {
  const id = state.requestId;
  const discard = () => Object.assign(new Error('이전 조회 결과는 사용하지 않습니다.'), { handled: true, discarded: true });
  const token = await accessToken();
  if (id !== state.requestId || !pageActive) throw discard();
  if (!token) { clearPrivateData(); throw Object.assign(new Error('로그인이 필요합니다.'), { handled: true }); }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(appPaths.apiPath(path), {
      cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer ' + token }, signal: controller.signal,
    });
    let body; try { body = await response.json(); } catch { body = null; }
    if (id !== state.requestId || !pageActive) throw discard();
    const currentToken = await accessToken();
    if (id !== state.requestId || !pageActive) throw discard();
    if (currentToken !== token) {
      clearPrivateData(currentToken ? '로그인이 변경되었습니다. 관리자 권한을 다시 확인해 주세요.' : '로그인이 만료되었습니다. 다시 로그인해 주세요.', { preserveSession: Boolean(currentToken) });
      throw discard();
    }
    if (!response.ok || body?.auth_uncertain) {
      const message = body?.error?.message ?? '데이터를 불러오지 못했습니다. 다시 조회해 주세요.';
      if (response.status === 401 || response.status === 403 || body?.auth_uncertain) {
        clearPrivateData(message); throw Object.assign(new Error(message), { handled: true });
      }
      throw new Error(message);
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('집계 조회가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function currentRequest(id) {
  if (id !== state.requestId || !pageActive) return false;
  if (!state.demo && !await accessToken()) {
    if (id === state.requestId) clearPrivateData('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    return false;
  }
  return id === state.requestId && pageActive;
}
async function finishAnalytics(pending, id) {
  const result = await pending;
  if (result.handled || !await currentRequest(id)) return;
  state.analyticsLoading = false; state.analytics = result.data ?? null; state.analyticsError = result.error ?? null;
  render();
}
async function load() {
  if (!pageActive) return;
  const id = ++state.requestId, range = { ...state.range };
  state.loading = true; state.error = null; state.overview = null; state.analytics = null; state.analyticsError = null; state.analyticsLoading = true;
  render();
  try {
    let overview, pending;
    if (state.demo) {
      const fixture = await loadDemo(range);
      overview = validateOverview(fixture.overview, range);
      state.analytics = validateAnalytics(fixture.analytics, range); state.analyticsLoading = false;
    } else {
      const query = new URLSearchParams(range);
      // This result never opens the console. The existing DB-owner overview remains the approval anchor.
      pending = request('/api/admin/analytics?' + query).then(data => ({ data: validateAnalytics(data, range) })).catch(error => ({ error: error.message, handled: error.handled }));
      overview = validateOverview(await request('/api/admin/overview?' + query), range);
    }
    if (!await currentRequest(id)) return;
    state.overview = overview; state.loading = false; state.signedIn = !state.demo;
    scheduleExpiry(); render();
    if (pending) void finishAnalytics(pending, id);
  } catch (error) {
    if (id !== state.requestId || error.handled) return;
    clearPrivateData(error.message, { preserveSession: true });
  }
}
function enterDemo() {
  clearPrivateData();
  state.demo = true; state.range = rangeForDays(); state.period = 7; load();
}
function renderLogin() {
  const busy = state.authBusy || state.loading;
  const configured = state.authReady && getAuthConfig()?.configured === true;
  const message = state.error || (!busy && !configured ? '로그인 연결을 확인하지 못했습니다. 다시 시도해 주세요.' : '');
  $('login-screen').setAttribute('aria-busy', String(busy)); $('google-login').disabled = busy;
  $('login-message').className = 'login-message error'; $('login-message').textContent = message; $('login-message').hidden = !message;
}
function updateOptions(select, entries, current, firstLabel) {
  const items = [{ id: '__all__', label: firstLabel }, ...entries.filter(row => row.id !== '__all__')];
  if (current !== '__all__' && !items.some(row => row.id === current)) items.push({ id: current, label: current || '캠페인 미지정' });
  select.replaceChildren(...items.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; return option; }));
  select.value = current;
}
function renderFilters() {
  document.querySelectorAll('[data-days]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.days) === state.period)));
  $('custom-period').setAttribute('aria-pressed', String(state.period === null));
  $('range-label').textContent = formatUTCDay(state.range.start) + ' – ' + formatUTCDay(datePlus(state.range.end, -1));
  updateOptions($('channel'), state.overview?.filter_options?.channels ?? [], state.channel, '모든 채널');
  updateOptions($('campaign'), (state.overview?.filter_options?.campaigns ?? []).map(id => ({ id, label: id || '캠페인 미지정' })), state.campaign, '모든 캠페인');
}
function analyticsMessage(component, label) {
  if (state.analyticsLoading) return 'Cloudflare 집계를 조회하고 있습니다.';
  if (state.analyticsError) return state.analyticsError;
  if (!state.analytics) return 'Cloudflare 데이터 미연결';
  if (CF_STATUS[state.analytics.status]) return CF_STATUS[state.analytics.status];
  if (component?.status === 'unavailable') return label + ' 데이터 미제공';
  if (component?.status === 'empty') return '선택한 기간에 기록된 관측값이 없습니다.';
  return '관측되지 않은 구간은 표시하지 않습니다.';
}
function renderStatus() {
  $('mode-label').textContent = state.demo ? '샘플 데이터' : '관리자';
  $('demo-status').hidden = !state.demo;
  const analytics = state.analytics;
  let message = '';
  if (state.analyticsLoading || state.analyticsError || !analytics || CF_STATUS[analytics.status]) message = analyticsMessage(null, '') + (analytics?.message ? ' · ' + analytics.message : '');
  else if (analytics.status === 'empty') message = '선택한 기간에 기록된 Cloudflare 관측값이 없습니다.';
  else {
    const notes = [];
    if (analytics.metrics.page_views.status === 'partial' || analytics.metrics.visits.status === 'partial') notes.push('일부 구간만 관측됨');
    if (analytics.source.sampled) notes.push('샘플링된 추정치');
    if (analytics.source.truncated) notes.push('일부 순위만 제공');
    if (analytics.source.incomplete) notes.push(analytics.message || '집계 간 불일치로 일부 값만 제공');
    message = notes.length ? 'Cloudflare · ' + notes.join(' · ') : '';
  }
  $('analytics-status').textContent = message; $('analytics-status').hidden = !message;
}
function renderMetrics() {
  for (const [metric, countId, captionId, changeId, title] of [
    ['page_views', 'pageviews', 'views-status', 'views-change', '페이지 조회수'], ['visits', 'visits', 'visits-status', 'visits-change', 'Visits'],
  ]) {
    const item = state.analytics?.metrics?.[metric];
    $(countId).textContent = formatCount(item?.value);
    const note = isCount(item?.value) ? (state.analytics.source.sampled ? '추정 · ' : '') + statusLabel(item.status) : analyticsMessage(item, title);
    $(captionId).textContent = 'Cloudflare · ' + note;
    const change = item?.change_percent;
    $(changeId).textContent = Number.isFinite(change) ? (change > 0 ? '+' : '') + change.toFixed(1) + '%' : '';
    $(changeId).className = 'metric-change' + (change < 0 ? ' down' : '');
    $(changeId).title = '같은 경과 시간의 이전 기간과 비교';
  }
  const signup = state.overview?.metrics?.new_beta_requests;
  $('signups').textContent = formatCount(signup?.value);
  $('signups-status').textContent = signup?.status && !['verified', 'collecting'].includes(signup.status) ? statusLabel(signup.status) : '';
  const fraction = state.overview?.metrics?.signup_attribution?.value;
  $('attribution-label').textContent = 'Supabase · 신청 출처 확인 ' + (Number.isFinite(fraction) ? (fraction * 100).toFixed(1) + '%' : '미제공');
}
function renderCharts() {
  const analytics = state.analytics, series = analytics?.series ?? [];
  for (const [metric, lineId, sparkId, grainId, label] of [
    ['page_views', 'views-chart', 'views-sparkline', 'views-grain', '페이지 조회수'],
    ['visits', 'visits-chart', 'visits-sparkline', 'visits-grain', 'Visits'],
  ]) {
    const options = { series, metric, label, grain: analytics?.grain ?? 'hour', startAt: analytics?.range?.start_at, endAt: analytics?.range?.end_at };
    drawSparkline($(sparkId), options);
    drawLineChart($(lineId), { ...options, message: analyticsMessage(analytics?.metrics?.[metric], label) });
    $(grainId).textContent = 'UTC · ' + (analytics?.grain === 'day' ? '일별' : '시간별');
  }
  drawSparkline($('signups-sparkline'), { series: dailySeries(state.overview?.daily ?? [], 'new_beta_requests'), metric: 'new_beta_requests' });
  drawHourlyChart($('hours-chart'), { rows: analytics?.hourly?.rows ?? [], metric: $('hours-metric').value, message: analyticsMessage(analytics?.hourly, '시간대') });
  $('hours-status').textContent = analytics?.hourly?.status === 'partial' ? '부분 집계 · 관측된 시간대만 포함합니다.' : '';
  $('hours-status').hidden = !$('hours-status').textContent;
}
function renderRankings() {
  for (const [name, id, label] of [['countries', 'countries', '국가'], ['browsers', 'browsers', '브라우저'], ['operating_systems', 'operating-systems', '운영체제']]) {
    const component = state.analytics?.breakdowns?.[name];
    const rows = [...(component?.rows ?? [])].sort((a, b) => b.value - a.value);
    if (!rows.length || component?.status === 'unavailable') {
      $(id).innerHTML = '<div class="ranking-empty"><strong>—</strong><p>' + escape(analyticsMessage(component, label)) + '</p></div>';
      continue;
    }
    const total = Math.max(state.analytics?.metrics?.page_views?.value ?? 0, rows.reduce((sum, row) => sum + row.value, 0));
    $(id).innerHTML = '<ol class="ranking-list">' + rows.map(row => {
      const width = total > 0 ? row.value / total * 100 : 0;
      return '<li><span class="ranking-label" title="' + escape(row.label) + '">' + escape(row.label) + '</span><span class="ranking-bar" aria-hidden="true"><span data-width="' + width.toFixed(3) + '"></span></span><span class="ranking-value" title="' + formatCount(row.value) + '">' + formatCompactCount(row.value) + '</span></li>';
    }).join('') + '</ol>' + (component.status === 'partial' || state.analytics.source.truncated ? '<p class="ranking-note">관측된 일부 데이터입니다.</p>' : '');
    $(id).querySelectorAll('[data-width]').forEach(bar => { bar.style.width = bar.dataset.width + '%'; });
  }
}
const quality = status => '<span class="status-pill ' + escape(status) + '">' + escape(statusLabel(status)) + '</span>';
const countCell = (value, status) => formatCount(value) + (status && !['verified', 'collecting'].includes(status) ? '<small class="cell-quality">' + escape(statusLabel(status)) + '</small>' : '');
function renderTable() {
  document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === state.tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  $('table-panel').setAttribute('aria-labelledby', 'tab-' + state.tab);
  const data = state.overview ? filterSupplement(state.overview, { channel: state.channel, campaign: state.campaign }) : null;
  const metric = data?.metrics?.new_beta_requests;
  $('supplement-status').textContent = data ? '선택한 출처의 신규 신청 ' + formatCount(metric?.value) + '건 · ' + statusLabel(metric?.status) : '승인된 Supabase 집계를 기다리고 있습니다.';
  let headings, rows;
  if (state.tab === 'channels') {
    headings = ['유입 채널', '기록된 랜딩 조회수', '신규 신청', '출처 구분'];
    const channels = [...(data?.channels ?? [])].sort((a, b) => state.ascending ? (a.new_beta_requests ?? -1) - (b.new_beta_requests ?? -1) : (b.new_beta_requests ?? -1) - (a.new_beta_requests ?? -1));
    rows = channels.map(row => {
      const types = new Set(row.sources.map(source => source.source_type));
      const method = row.id === 'unmeasured' ? '출처 미측정' : row.id === 'direct_or_unknown' ? '직접 또는 출처 불명' : types.has('utm') ? 'UTM 확인' : types.has('referrer') ? '리퍼러 확인' : '제공된 출처';
      return '<tr><td>' + escape(row.label) + '</td><td class="numeric">' + countCell(row.page_views, row.status?.page_views ?? data.metrics.page_views.status) + '</td><td class="numeric">' + countCell(row.new_beta_requests, row.status?.new_beta_requests ?? metric.status) + '</td><td class="muted">' + method + '</td></tr>';
    });
  } else {
    headings = ['날짜 · UTC', '기록된 랜딩 조회수', '신규 신청', '데이터 상태'];
    rows = [...(data?.daily ?? [])].sort((a, b) => state.ascending ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day)).map(row => '<tr><td>' + formatUTCDay(row.day) + '</td><td class="numeric">' + countCell(row.page_views, row.status.page_views) + '</td><td class="numeric">' + countCell(row.new_beta_requests, row.status.new_beta_requests) + '</td><td>' + quality(row.status.new_beta_requests) + '</td></tr>');
  }
  $('table-panel').innerHTML = '<table class="data-table"><thead><tr>' + headings.map(label => '<th scope="col">' + label + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + headings.length + '" class="empty-table">이 기간에 표시할 집계가 없습니다.</td></tr>') + '</tbody></table>';
  $('sort').querySelector('span').textContent = state.tab === 'channels' ? state.ascending ? '신청 적은 순' : '신청 많은 순' : state.ascending ? '오래된 순' : '최신순';
}
function render() {
  const visible = state.demo || state.signedIn;
  document.title = visible ? '접속 분석 · Blabee' : '관리자 로그인 · Blabee';
  $('login-screen').hidden = visible; $('login-screen').inert = visible;
  $('dashboard-screen').hidden = !visible; $('dashboard-screen').inert = !visible;
  renderLogin(); renderFilters(); renderStatus(); renderMetrics(); renderCharts(); renderRankings(); renderTable();
  $('main').classList.toggle('is-loading', state.loading);
  $('refresh').disabled = state.loading || (!state.demo && !state.signedIn);
  $('source-label').textContent = state.demo ? '명시적 샘플 모드 · 실제 운영 데이터가 아닙니다.' : 'Cloudflare Edge · 자동화 요청 포함 · ' + (state.analytics?.source?.sampled ? '표본 기반 추정 · ' : '') + 'Supabase · UTC' + (state.overview?.generated_at ? ' · 조회 ' + formatKST(state.overview.generated_at) : '');
}
function openPeriod() {
  const form = $('period-form'); form.elements.start.value = state.range.start; form.elements.end.value = datePlus(state.range.end, -1);
  const today = new Date().toISOString().slice(0, 10); form.elements.start.max = today; form.elements.end.max = today;
  $('period-error').textContent = ''; showDialog('period-dialog');
}
function showInfo() {
  const analytics = state.analytics, overview = state.overview;
  $('info-content').innerHTML = '<div class="info-item"><h3>Cloudflare 대상 범위</h3><p>biadone.com의 /blabee와 /blabee/만 포함합니다. 관리자 화면, 정책, 파일 요청과 다른 랜딩은 포함하지 않습니다. 조회수와 Visits는 고유 인원수가 아닙니다.</p></div>'
    + '<div class="info-item"><h3>Cloudflare 원천</h3><p>' + escape(analytics?.source?.dataset || '현재 연결된 집계 원천이 없습니다.') + ' · ' + escape(analytics?.source?.sampled ? '샘플링된 추정치' : '제공자가 반환한 관측값') + '. 봇과 QA 요청이 포함될 수 있습니다. 누락된 구간은 0으로 채우지 않습니다.</p></div>'
    + '<div class="info-item"><h3>Supabase 신청 집계</h3><p>' + escape(overview?.scope?.label || 'Blabee 랜딩 합산') + '에서 저장된 신규 신청입니다. 원본의 중복 제외·최초 출처 기준을 따릅니다. 이 원천의 랜딩 조회수와 Cloudflare 조회수를 합산하지 않습니다. 채널·캠페인 필터는 보조 표에만 적용됩니다.</p></div>'
    + '<div class="info-item"><h3>시간과 비교</h3><p>UTC 달력 날짜를 사용하며 종료일은 포함하지 않습니다. 오늘은 현재 시각까지 집계합니다. 증감률은 같은 경과 시간의 이전 기간이 제공될 때만 표시합니다. 이전 값이 0이면 비율을 만들지 않습니다. 시간대 분포는 선택한 기간의 0–23시 UTC 합계이며 최근 24시간을 뜻하지 않습니다.</p></div>'
    + '<div class="info-item"><h3>순위와 측정 범위</h3><p>국가·브라우저·운영체제는 같은 Cloudflare 기간의 페이지 조회수를 기준으로 합니다. 알 수 없는 항목도 보존하며, 일부 순위만 반환되면 전체 모집단으로 해석하지 않습니다. 연결된 방문 세션이 없으므로 베타 신청 전환율은 계산하지 않습니다.</p></div>';
  showDialog('info-dialog');
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.close) closeDialog(button.dataset.close);
  if (button.dataset.days) { state.period = Number(button.dataset.days); state.range = rangeForDays(state.period); load(); }
  if (button.dataset.tab) { state.tab = button.dataset.tab; state.ascending = false; renderTable(); }
});
for (const id of ['channel', 'campaign']) $(id).addEventListener('change', event => { state[id] = event.target.value; renderTable(); });
$('hours-metric').addEventListener('change', renderCharts);
$('custom-period').addEventListener('click', openPeriod); $('date-range').addEventListener('click', openPeriod);
$('period-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const values = new FormData(event.target), start = values.get('start'), last = values.get('end');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) throw new Error();
    const end = datePlus(last, 1); validateRange({ start, end }); state.range = { start, end }; state.period = null;
    closeDialog('period-dialog'); load();
  } catch { $('period-error').textContent = '오늘까지의 실제 날짜로 1~90일 범위를 선택해 주세요.'; }
});
$('sort').addEventListener('click', () => { state.ascending = !state.ascending; renderTable(); });
$('refresh').addEventListener('click', load);
$('google-login').addEventListener('click', async () => {
  if (state.authBusy || state.loading) return;
  if (!state.authReady || !getAuthConfig()?.configured || state.error) {
    await initializeLogin();
    if (!pageActive || state.signedIn || state.error || !state.authReady || !getAuthConfig()?.configured) return;
  }
  clearPrivateData(); const id = state.requestId; state.authBusy = true; render();
  try { await beginLogin('google'); }
  catch (error) { if (id === state.requestId && pageActive) { state.authBusy = false; state.error = error.message; render(); } }
});
$('account-button').addEventListener('click', () => clearPrivateData());
$('data-info').addEventListener('click', showInfo);
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')], index = tabs.findIndex(tab => tab.dataset.tab === state.tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  state.tab = tabs[next].dataset.tab; renderTable(); tabs[next].focus();
});
const observer = new ResizeObserver(renderCharts);
for (const id of ['views-chart', 'visits-chart', 'hours-chart']) observer.observe($(id));
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.signedIn && sessionExpiresAt() <= Date.now()) clearPrivateData('로그인이 만료되었습니다. 다시 로그인해 주세요.'); });
window.addEventListener('pagehide', () => { pageActive = false; clearPrivateData(null, { preserveSession: appPaths.basePath === '/' }); });
window.addEventListener('pageshow', event => { if (event.persisted) { pageActive = true; clearPrivateData(null, { preserveSession: appPaths.basePath === '/' }); } });
async function initializeLogin({ allowDemo = false } = {}) {
  if (!pageActive) return;
  clearPrivateData(null, { preserveSession: true }); const id = ++state.requestId;
  state.authReady = false; state.authBusy = true; state.error = null; render();
  try {
    await initAuth();
    if (id !== state.requestId || !pageActive) { if (!pageActive && appPaths.basePath !== '/') clearSession(); return; }
    state.authReady = true; state.authBusy = false;
    const token = await accessToken();
    if (id !== state.requestId || !pageActive) return;
    if (allowDemo && new URL(location.href).searchParams.get('demo') === '1') enterDemo();
    else if (token) await load(); else render();
  } catch (error) {
    if (id !== state.requestId || !pageActive) return;
    state.authBusy = false;
    if (allowDemo && new URL(location.href).searchParams.get('demo') === '1') enterDemo(); else clearPrivateData(error.message);
  }
}
render();
await initializeLogin({ allowDemo: true });

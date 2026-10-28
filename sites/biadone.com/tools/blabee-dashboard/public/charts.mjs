import { formatCount, formatCompactCount, formatUTCTime, hourlyRows, isCount, lineSegments } from './data.mjs';

const SVG = 'http://www.w3.org/2000/svg';
function node(tag, attrs = {}, text = null) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text !== null) element.textContent = text;
  return element;
}
function html(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function empty(container, message) {
  const element = html('div', 'chart-empty');
  element.append(html('strong', '', '—'), html('p', '', message || '이 지표를 제공하지 않습니다.'));
  container.append(element);
}
function maximum(values) {
  const max = Math.max(1, ...values.filter(isCount));
  if (max <= 4) return 4;
  const unit = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / unit / 2) * unit * 2;
}
function domains(series, startAt, endAt) {
  const start = Date.parse(startAt || series[0]?.bucket_start);
  const end = Date.parse(endAt || series.at(-1)?.bucket_end);
  return { start, end: Math.max(start + 1, end) };
}
function paths(svg, series, metric, x, y, bottom, area) {
  for (const points of lineSegments(series, metric)) {
    const coordinates = points.map(row => [x((Date.parse(row.bucket_start) + Date.parse(row.bucket_end)) / 2), y(row.value)]);
    const path = coordinates.map(([px, py], index) => (index ? 'L' : 'M') + px.toFixed(2) + ' ' + py.toFixed(2)).join(' ');
    if (area && points.length > 1) svg.append(node('path', { d: path + ' L' + coordinates.at(-1)[0] + ' ' + bottom + ' L' + coordinates[0][0] + ' ' + bottom + ' Z', class: 'chart-area' }));
    svg.append(node('path', { d: path, class: 'chart-line' }));
    if (points.length === 1) svg.append(node('circle', { cx: coordinates[0][0], cy: coordinates[0][1], r: 2, class: 'chart-point' }));
  }
}
function tableFor(series, metric, label, grain) {
  const wrapper = html('div', 'sr-only');
  const table = document.createElement('table');
  table.append(html('caption', '', label + ' · UTC'));
  const body = document.createElement('tbody');
  for (const row of series) {
    const tr = document.createElement('tr');
    tr.append(html('th', '', formatUTCTime(row.bucket_start, { grain, full: true })), html('td', '', formatCount(row[metric])));
    body.append(tr);
  }
  table.append(body); wrapper.append(table); return wrapper;
}
export function drawSparkline(container, { series = [], metric, startAt, endAt } = {}) {
  container.replaceChildren();
  if (!series.some(row => isCount(row[metric]))) return;
  const width = 400, height = 64, max = maximum(series.map(row => row[metric]));
  const { start, end } = domains(series, startAt, endAt);
  const svg = node('svg', { viewBox: '0 0 ' + width + ' ' + height, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  paths(svg, series, metric, time => 2 + (time - start) / (end - start) * (width - 4), value => height - 2 - value / max * (height - 6), height, true);
  container.append(svg);
}
export function drawLineChart(container, { series = [], metric, label, grain = 'hour', startAt, endAt, message } = {}) {
  container.replaceChildren();
  if (!series.some(row => isCount(row[metric]))) { empty(container, message); return; }
  const width = Math.max(280, container.getBoundingClientRect().width), height = 226;
  const left = 42, right = width - 18, top = 22, bottom = height - 32;
  const max = maximum(series.map(row => row[metric]));
  const { start, end } = domains(series, startAt, endAt);
  const x = time => left + (time - start) / (end - start) * (right - left);
  const y = value => bottom - value / max * (bottom - top);
  const svg = node('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', tabindex: 0, 'aria-label': label + ' 추이. UTC 기준. 방향키로 관측값을 확인할 수 있습니다.' });
  svg.append(node('title', {}, label + ' 추이 · UTC'));
  for (let i = 0; i <= 4; i++) {
    const value = max * i / 4, py = y(value);
    svg.append(node('line', { x1: left, x2: right, y1: py, y2: py, class: 'chart-grid' }));
    svg.append(node('text', { x: left - 9, y: py + 4, 'text-anchor': 'end', class: 'chart-axis' }, formatCompactCount(value) === '—' ? String(Number(value.toFixed(1))) : formatCompactCount(value)));
  }
  const tickCount = width < 460 ? 3 : 4;
  for (let i = 0; i < tickCount; i++) {
    const time = start + (end - start) * i / (tickCount - 1);
    const text = formatUTCTime(new Date(time), { grain }).replace(' UTC', '');
    svg.append(node('text', { x: x(time), y: height - 9, 'text-anchor': i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle', class: 'chart-axis' }, text));
  }
  paths(svg, series, metric, x, y, bottom, false);
  const guide = node('line', { y1: top, y2: bottom, class: 'chart-guide', visibility: 'hidden' });
  svg.append(guide);
  const tooltip = html('div', 'chart-tooltip'); tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip');
  let selected = 0;
  const show = index => {
    selected = index;
    const row = series[index], center = x((Date.parse(row.bucket_start) + Date.parse(row.bucket_end)) / 2);
    tooltip.replaceChildren(html('b', '', formatUTCTime(row.bucket_start, { grain, full: true })), html('span', '', label + '  ' + formatCount(row[metric])));
    tooltip.hidden = false; tooltip.style.left = Math.max(0, Math.min(width - 194, center - 90)) + 'px';
    guide.setAttribute('x1', center); guide.setAttribute('x2', center); guide.setAttribute('visibility', 'visible');
    svg.setAttribute('aria-label', formatUTCTime(row.bucket_start, { grain, full: true }) + ', ' + label + ' ' + formatCount(row[metric]));
  };
  const hide = () => { tooltip.hidden = true; guide.setAttribute('visibility', 'hidden'); };
  series.forEach((row, index) => {
    const startX = x(Date.parse(row.bucket_start)), endX = x(Date.parse(row.bucket_end));
    const hit = node('rect', { x: startX, y: top, width: Math.max(1, endX - startX), height: bottom - top, class: 'chart-hit' });
    hit.addEventListener('pointerenter', () => show(index)); hit.addEventListener('pointerleave', hide); svg.append(hit);
  });
  svg.addEventListener('focus', () => show(selected)); svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') { hide(); return; }
    show(event.key === 'Home' ? 0 : event.key === 'End' ? series.length - 1 : Math.max(0, Math.min(series.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1))));
  });
  container.append(svg, tooltip, tableFor(series, metric, label, grain));
}
export function drawHourlyChart(container, { rows = [], metric = 'page_views', message } = {}) {
  container.replaceChildren();
  if (!rows.some(row => isCount(row[metric]))) { empty(container, message); return; }
  const values = hourlyRows(rows), width = Math.max(280, container.getBoundingClientRect().width), height = 155;
  const left = 34, right = width - 15, top = 12, bottom = 126, step = (right - left) / 24;
  const max = maximum(values.map(row => row[metric]));
  const svg = node('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'UTC 0시부터 23시까지의 시간대별 유입 분포' });
  for (let i = 0; i <= 2; i++) {
    const value = max * i / 2, py = bottom - value / max * (bottom - top);
    svg.append(node('line', { x1: left, x2: right, y1: py, y2: py, class: 'chart-grid' }));
    svg.append(node('text', { x: left - 8, y: py + 4, 'text-anchor': 'end', class: 'chart-axis' }, formatCompactCount(value)));
  }
  for (const row of values) {
    const px = left + step * row.hour, value = row[metric];
    const known = isCount(value), barHeight = known ? Math.max(1, value / max * (bottom - top)) : 2;
    const bar = node('rect', { x: px + step * 0.17, y: bottom - barHeight, width: Math.max(2, step * 0.66), height: barHeight, class: known ? 'hour-bar' : 'hour-missing', tabindex: 0, role: 'img', 'aria-label': String(row.hour).padStart(2, '0') + ':00 UTC, ' + formatCount(value) });
    bar.append(node('title', {}, String(row.hour).padStart(2, '0') + ':00 UTC · ' + formatCount(value))); svg.append(bar);
    if (row.hour % (width < 500 ? 4 : 2) === 0 || row.hour === 23) svg.append(node('text', { x: px + step / 2, y: 146, 'text-anchor': 'middle', class: 'chart-axis' }, String(row.hour).padStart(2, '0')));
  }
  container.append(svg);
}

import { ApiError, assertMethod, assertQuery, errorResponse, jsonResponse, readJsonBody } from './http.mjs';
import { UUID, authorize, callRpc } from './auth.mjs';
import { channelId, isDay, parseFilters, parseRange } from './overview.mjs';

const POST_FIELDS = ['channel', 'title', 'published_at', 'published_offset_minutes', 'url', 'content_format', 'link_placement', 'notes', 'external_refs', 'source', 'medium', 'campaign', 'content'];
const MAPPING_FIELDS = ['source', 'medium', 'campaign', 'content'];
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function invalidPost() {
  return new ApiError(400, 'INVALID_POST', '게시물의 필수 항목과 입력 길이를 확인해 주세요.');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function text(value, max, required = false, multiline = false) {
  if ((value === null || value === undefined) && !required) return '';
  if (typeof value !== 'string') throw invalidPost();
  const result = value.trim();
  if ((required && !result) || result.length > max || FORBIDDEN_CONTROL.test(result)
      || (!multiline && /[\r\n]/.test(result))) throw invalidPost();
  return result;
}

function timestamp(value) {
  if (typeof value !== 'string') throw invalidPost();
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match || !isDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59
      || Number(match[4] || 0) > 59 || Number(match[7] || 0) > 14 || Number(match[8] || 0) > 59
      || (Number(match[7]) === 14 && Number(match[8]) !== 0)
      || !Number.isFinite(Date.parse(value))) throw invalidPost();
  const minutes = match[5] === 'Z' ? 0 : (Number(match[7]) * 60 + Number(match[8])) * (match[6] === '-' ? -1 : 1);
  return { value, minutes };
}

function safeUrl(value) {
  const raw = text(value, 2048, true);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw invalidPost();
    return url.href;
  } catch { throw invalidPost(); }
}

export function validatePost(value) {
  if (!plainObject(value) || Object.keys(value).some(key => !POST_FIELDS.includes(key))) throw invalidPost();
  const channel = text(value.channel, 80, true);
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(channel)) throw invalidPost();
  const published = timestamp(value.published_at);
  if (value.published_offset_minutes !== undefined && value.published_offset_minutes !== published.minutes) throw invalidPost();
  const mappingCount = MAPPING_FIELDS.filter(field => value[field] !== undefined && value[field] !== null).length;
  if (mappingCount !== 0 && mappingCount !== MAPPING_FIELDS.length) throw invalidPost();
  const result = {
    channel,
    title: text(value.title, 200, true),
    published_at: published.value,
    published_offset_minutes: published.minutes,
    url: safeUrl(value.url),
    content_format: text(value.content_format, 80),
    link_placement: text(value.link_placement, 80),
    notes: text(value.notes, 4000, false, true),
    external_refs: {},
  };
  if (value.external_refs !== undefined && value.external_refs !== null) {
    if (!plainObject(value.external_refs) || Object.keys(value.external_refs).length > 10) throw invalidPost();
    const pairs = Object.entries(value.external_refs);
    if (pairs.some(([key, item]) => !/^[A-Za-z0-9_.-]{1,80}$/.test(key)
        || typeof item !== 'string' || item.length > 500 || FORBIDDEN_CONTROL.test(item))) throw invalidPost();
    result.external_refs = Object.fromEntries(pairs);
  }
  for (const field of MAPPING_FIELDS) {
    if (!mappingCount) result[field] = null;
    else {
      const item = value[field];
      if (typeof item !== 'string' || !/^(?:[a-z0-9][a-z0-9._-]{0,79})?$/.test(item)) throw invalidPost();
      result[field] = item;
    }
  }
  return result;
}

function cleanStoredPost(value) {
  if (!plainObject(value) || !UUID.test(value.id)) throw new ApiError(502, 'INVALID_SOURCE_DATA', '게시물 응답을 확인하지 못했습니다.');
  try {
    const allowed = Object.fromEntries(POST_FIELDS.filter(field => field in value).map(field => [field, value[field]]));
    if (!Number.isInteger(value.published_offset_minutes) || Math.abs(value.published_offset_minutes) > 840) throw invalidPost();
    const instant = timestamp(value.published_at);
    if (instant.minutes !== value.published_offset_minutes) {
      const offset = value.published_offset_minutes;
      const zone = offset === 0 ? 'Z' : `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
      allowed.published_at = new Date(Date.parse(instant.value) + offset * 60_000).toISOString().replace(/Z$/, zone);
    }
    const post = validatePost(allowed);
    timestamp(value.created_at);
    timestamp(value.updated_at);
    return { id: value.id, ...post, created_at: value.created_at, updated_at: value.updated_at };
  } catch {
    throw new ApiError(502, 'INVALID_SOURCE_DATA', '게시물 응답을 확인하지 못했습니다.');
  }
}

function idFrom(url) {
  const id = url.searchParams.get('id');
  if (!id || !UUID.test(id)) throw new ApiError(400, 'INVALID_POST_ID', '게시물 ID를 확인해 주세요.');
  return id.toLowerCase();
}

export async function handlePosts(context, { fetchImpl = fetch, now = () => new Date() } = {}) {
  try {
    const { request } = context;
    assertMethod(request, ['GET', 'POST', 'PUT', 'DELETE']);
    const auth = await authorize(request, context.env, fetchImpl);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      assertQuery(url, ['start', 'end', 'channel', 'campaign']);
      const range = parseRange(url, now(), { optional: true });
      const filters = parseFilters(url);
      const raw = await callRpc(auth, 'blabee_dashboard_posts', { p_action: 'list', p_post: null, p_post_id: null }, fetchImpl);
      if (!raw || !Array.isArray(raw.posts)) throw new ApiError(502, 'INVALID_SOURCE_DATA', '게시물 응답을 확인하지 못했습니다.');
      const posts = raw.posts.map(cleanStoredPost).filter(post => {
        const day = new Date(post.published_at).toISOString().slice(0, 10);
        return (!range || (range.start_day <= day && day < range.end_day))
          && (!filters.channel || channelId(post.channel) === filters.channel)
          && (filters.campaign === null || post.campaign === filters.campaign);
      }).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id));
      return jsonResponse({ posts });
    }
    assertQuery(url, request.method === 'POST' ? [] : ['id']);
    const id = request.method === 'POST' ? null : idFrom(url);
    if (request.method === 'DELETE') {
      const raw = await callRpc(auth, 'blabee_dashboard_posts', { p_action: 'delete', p_post: null, p_post_id: id }, fetchImpl);
      if (raw?.deleted !== true || raw.id !== id) throw new ApiError(502, 'INVALID_SOURCE_DATA', '삭제 응답을 확인하지 못했습니다.');
      return jsonResponse({ deleted: true, id });
    }
    const post = validatePost(await readJsonBody(request));
    const raw = await callRpc(auth, 'blabee_dashboard_posts', {
      p_action: request.method === 'POST' ? 'create' : 'update',
      p_post: post,
      p_post_id: id,
    }, fetchImpl);
    const saved = cleanStoredPost(raw?.post);
    if (id && saved.id !== id) throw new ApiError(502, 'INVALID_SOURCE_DATA', '저장 응답을 확인하지 못했습니다.');
    return jsonResponse({ post: saved }, request.method === 'POST' ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}

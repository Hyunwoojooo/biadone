import { ApiError, assertSameOrigin, requestJson } from './http.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function publicKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return key;
  // Legacy anon JWT keys are public too. Refuse service-role JWTs and all secret keys.
  if (key.length < 8192 && JWT.test(key)) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'anon') return key;
    } catch { /* Invalid keys leave the dashboard unconfigured. */ }
  }
  return null;
}

export function readConfig(env = {}) {
  const key = publicKey(env.SUPABASE_PUBLISHABLE_KEY);
  let url;
  try {
    const parsed = new URL(env.SUPABASE_URL);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password
        && parsed.pathname === '/' && !parsed.search && !parsed.hash) url = parsed.origin;
  } catch { /* Invalid URLs leave the dashboard unconfigured. */ }
  const hasOwnerUids = Object.hasOwn(env, 'DASHBOARD_OWNER_UIDS');
  let ownerUids = [];
  if (hasOwnerUids) {
    if (typeof env.DASHBOARD_OWNER_UIDS !== 'string') return null;
    const values = env.DASHBOARD_OWNER_UIDS.split(',').map(value => value.trim());
    if (values.some(value => !UUID.test(value))) return null;
    ownerUids = [...new Set(values.map(value => value.toLowerCase()))];
  }
  const rawUid = typeof env.DASHBOARD_OWNER_UID === 'string' ? env.DASHBOARD_OWNER_UID.trim() : '';
  const ownerUid = !hasOwnerUids && UUID.test(rawUid) ? rawUid.toLowerCase() : null;
  if (ownerUid) ownerUids = [ownerUid];
  const rawEmail = typeof env.DASHBOARD_OWNER_EMAIL === 'string' ? env.DASHBOARD_OWNER_EMAIL.trim().toLowerCase() : '';
  const ownerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;
  // A mistyped UID must not silently enable a different authorization mode.
  const ownerConfigured = hasOwnerUids ? ownerUids.length > 0 : rawUid ? Boolean(ownerUid) : Boolean(ownerEmail);
  if (!url || !key || !ownerConfigured) return null;
  return { url, key, ownerUid, ownerUids, ownerEmail };
}

export function publicConfig(env) {
  const config = readConfig(env);
  return {
    configured: Boolean(config),
    supabase: config ? { url: config.url, publishableKey: config.key } : null,
  };
}

export async function authorize(request, env, fetchImpl = fetch) {
  assertSameOrigin(request);
  const config = readConfig(env);
  if (!config) {
    throw new ApiError(503, 'DASHBOARD_NOT_CONFIGURED', '대시보드 인증 설정이 준비되지 않았습니다.', { authUncertain: true });
  }
  const header = request.headers.get('Authorization');
  const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
  if (!match || match[1].length > 8192 || !JWT.test(match[1])) {
    throw new ApiError(401, 'UNAUTHORIZED', '로그인 후 이용해 주세요.');
  }
  const token = match[1];
  const user = await requestJson(fetchImpl, `${config.url}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: config.key, Authorization: `Bearer ${token}` },
  }, 'auth');
  if (!user || typeof user !== 'object' || !UUID.test(user.id)) {
    throw new ApiError(502, 'AUTH_UNAVAILABLE', '로그인 상태를 확인하지 못했습니다.', { authUncertain: true });
  }
  const isOwner = config.ownerUids.length
    ? config.ownerUids.includes(user.id.toLowerCase())
    : typeof user.email === 'string' && user.email.trim().toLowerCase() === config.ownerEmail
      && typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at));
  if (!isOwner) throw new ApiError(403, 'FORBIDDEN', '이 계정에는 대시보드 권한이 없습니다.');
  return { config, token };
}

export async function callRpc(auth, name, args, fetchImpl = fetch) {
  // Calls always run as the verified user, never with an elevated server key.
  return requestJson(fetchImpl, `${auth.config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: auth.config.key,
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  }, 'data');
}

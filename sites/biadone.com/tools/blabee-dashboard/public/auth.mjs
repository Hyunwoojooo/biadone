import { createDashboardPaths } from './paths.mjs';

const SESSION_KEY = 'blabee.dashboard.auth.v1';
const PKCE_KEY = 'blabee.dashboard.pkce.v1';
const LOGIN_TIMEOUT = 15_000;
let session = null;
let config = null;
let generation = 0;
let appPaths = null;

function stored(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

function remove(key) { try { sessionStorage.removeItem(key); } catch { /* Memory-only session remains usable. */ } }

function persist(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* Login works without persistent token storage. */ }
}

async function authRequest(path, body) {
  if (!config?.configured || !config.supabase) throw new Error('운영 연결이 준비되면 관리자 로그인을 사용할 수 있습니다.');
  const controller = new AbortController();
  const startedInGeneration = generation;
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT);
  try {
    const response = await fetch(`${config.supabase.url}/auth/v1/${path}`, {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { apikey: config.supabase.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new Error('로그인을 완료하지 못했습니다. 다시 로그인해 주세요.');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)
        || data.expires_in <= 0 || data.expires_in > 86400) throw new Error('로그인 응답을 확인하지 못했습니다.');
    // This owner console keeps no refresh/provider token. Expiry requires sign-in again.
    if (generation !== startedInGeneration) throw new Error('로그인 요청이 취소되었습니다. 다시 로그인해 주세요.');
    persist({ accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
    return session;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('로그인 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function initAuth({ moduleURL = import.meta.url, locationURL = location.href } = {}) {
  appPaths = createDashboardPaths(moduleURL, locationURL);
  const response = await fetch(appPaths.apiPath('/api/config'), { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('대시보드 연결 상태를 확인하지 못했습니다.');
  config = await response.json();
  if (config.configured && (!config.supabase?.url?.startsWith('https://') || !config.supabase.publishableKey)) {
    throw new Error('대시보드 연결 정보를 확인하지 못했습니다.');
  }
  const saved = stored(SESSION_KEY);
  if (saved && typeof saved.accessToken === 'string' && Number.isFinite(saved.expiresAt)
      && saved.expiresAt > Date.now() && saved.expiresAt < Date.now() + 86400_000) session = { accessToken: saved.accessToken, expiresAt: saved.expiresAt };
  else clearSession();
  const url = new URL(locationURL);
  if (url.searchParams.has('error') || url.searchParams.has('error_description')) {
    clearSession();
    remove(PKCE_KEY);
    url.searchParams.delete('error'); url.searchParams.delete('error_description'); url.searchParams.delete('error_code');
    history.replaceState(null, '', url);
    throw new Error('로그인이 취소되었거나 완료되지 않았습니다. 다시 시도해 주세요.');
  }
  const code = url.searchParams.get('code');
  if (code) {
    const pkce = stored(PKCE_KEY);
    // Remove the short-lived auth code from the address/history before any data request.
    url.searchParams.delete('code'); url.searchParams.delete('auth_return');
    history.replaceState(null, '', url);
    remove(PKCE_KEY);
    clearSession();
    if (!pkce?.verifier || !Number.isFinite(pkce.createdAt) || pkce.createdAt > Date.now()
        || Date.now() - pkce.createdAt > 600_000) throw new Error('로그인 요청이 만료되었습니다. 같은 탭에서 다시 로그인해 주세요.');
    await authRequest('token?grant_type=pkce', { auth_code: code, code_verifier: pkce.verifier });
  }
  return config;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function beginLogin(provider) {
  if (!['google', 'github'].includes(provider)) throw new Error('지원하지 않는 로그인 방식입니다.');
  if (!config?.configured) throw new Error('운영 연결이 준비되면 관리자 로그인을 사용할 수 있습니다.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  try { sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, createdAt: Date.now() })); }
  catch { throw new Error('로그인을 위해 이 탭의 세션 저장소를 허용해 주세요.'); }
  const target = new URL(`${config.supabase.url}/auth/v1/authorize`);
  target.searchParams.set('provider', provider);
  target.searchParams.set('redirect_to', appPaths.oauthCallbackURL);
  target.searchParams.set('code_challenge', challenge);
  target.searchParams.set('code_challenge_method', 's256');
  clearSession();
  location.assign(target);
}

export async function accessToken() {
  if (!session) return null;
  if (session.expiresAt > Date.now()) return session.accessToken;
  clearSession();
  return null;
}

export function sessionExpiresAt() { return session?.expiresAt ?? 0; }
export function clearSession() { generation++; persist(null); }
export function getAuthConfig() { return config; }

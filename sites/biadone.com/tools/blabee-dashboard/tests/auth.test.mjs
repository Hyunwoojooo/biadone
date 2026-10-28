import assert from 'node:assert/strict';
import { test } from 'node:test';

function harness(href = 'https://dashboard.example/') {
  const storage = new Map();
  globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.location = { href, origin: new URL(href).origin, assign: value => { globalThis.location.href = String(value); } };
  globalThis.history = { replaceState: (_state, _title, value) => { location.href = String(value); } };
  return storage;
}
const publicConfig = { configured: true, supabase: { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test_only' } };
const moduleForTest = () => import(`../public/auth.mjs?test=${crypto.randomUUID()}`);
const initialize = auth => auth.initAuth({ moduleURL: new URL('./auth.mjs', location.href).href, locationURL: location.href });

test('restores only a current access token and expiry, never provider or refresh credentials', async () => {
  const storage = harness();
  storage.set('blabee.dashboard.auth.v1', JSON.stringify({ accessToken: 'access-only', refreshToken: 'discard', provider_token: 'discard', expiresAt: Date.now() + 60000 }));
  globalThis.fetch = async () => Response.json(publicConfig);
  const auth = await moduleForTest(); await initialize(auth);
  assert.equal(await auth.accessToken(), 'access-only');
  auth.clearSession(); assert.equal(await auth.accessToken(), null); assert.equal(storage.has('blabee.dashboard.auth.v1'), false);
});

test('expired session clears locally and never issues a refresh request', async () => {
  const storage = harness(); let calls = 0;
  storage.set('blabee.dashboard.auth.v1', JSON.stringify({ accessToken: 'expired', refreshToken: 'discard', expiresAt: Date.now() - 1 }));
  globalThis.fetch = async () => { calls++; return Response.json(publicConfig); };
  const auth = await moduleForTest(); await initialize(auth);
  assert.equal(await auth.accessToken(), null); assert.equal(calls, 1); assert.equal(storage.size, 0);
});

test('an in-flight PKCE callback cannot restore a session after clearSession', async () => {
  const storage = harness('https://dashboard.example/?code=one-use-code&auth_return=1');
  storage.set('blabee.dashboard.pkce.v1', JSON.stringify({ verifier: 'test-verifier', createdAt: Date.now() }));
  let resolveExchange, signalStarted;
  const exchangeStarted = new Promise(resolve => { signalStarted = resolve; });
  globalThis.fetch = async url => {
    if (url === '/api/config') return Response.json(publicConfig);
    assert.match(String(url), /token\?grant_type=pkce/);
    signalStarted();
    return new Promise(resolve => { resolveExchange = resolve; });
  };
  const auth = await moduleForTest(); const init = initialize(auth); await exchangeStarted;
  auth.clearSession();
  resolveExchange(Response.json({ access_token: 'must-not-persist', refresh_token: 'must-not-persist', expires_in: 3600 }));
  await assert.rejects(init, /취소/);
  assert.equal(await auth.accessToken(), null); assert.equal(storage.size, 0);
  assert.equal(new URL(location.href).searchParams.has('code'), false);
});

test('callback exchanges once, scrubs URL/verifier, and stores no refresh/provider token', async () => {
  const storage = harness('https://dashboard.example/?code=one-use-code&auth_return=1');
  storage.set('blabee.dashboard.pkce.v1', JSON.stringify({ verifier: 'test-verifier', createdAt: Date.now() }));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return Response.json(url === '/api/config' ? publicConfig : { access_token: 'new-access', refresh_token: 'never-store', provider_token: 'never-store', expires_in: 3600 });
  };
  const auth = await moduleForTest(); await initialize(auth);
  assert.equal(await auth.accessToken(), 'new-access');
  assert.deepEqual(Object.keys(JSON.parse(storage.get('blabee.dashboard.auth.v1'))).sort(), ['accessToken', 'expiresAt']);
  assert.equal(storage.has('blabee.dashboard.pkce.v1'), false);
  assert.equal(calls.length, 2); assert.deepEqual(JSON.parse(calls[1][1].body), { auth_code: 'one-use-code', code_verifier: 'test-verifier' });
  assert.equal(new URL(location.href).search, '');
});

test('root Google login keeps its existing callback and PKCE storage key', async () => {
  const storage = harness('http://localhost:8000/?demo=1&redirect_to=https://untrusted.example/');
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return Response.json(publicConfig); };
  const auth = await moduleForTest(); await initialize(auth); await auth.beginLogin('google');
  const target = new URL(location.href);
  assert.deepEqual(calls, ['/api/config']);
  assert.equal(target.origin, 'https://project.supabase.co');
  assert.equal(target.searchParams.get('provider'), 'google');
  assert.equal(target.searchParams.get('redirect_to'), 'http://localhost:8000/?auth_return=1');
  assert.equal(target.searchParams.get('code_challenge_method'), 's256');
  assert.ok(target.searchParams.get('code_challenge'));
  assert.equal(typeof JSON.parse(storage.get('blabee.dashboard.pkce.v1')).verifier, 'string');
});

test('nested Google login uses the shipped module base for config and callback', async () => {
  const storage = harness('https://biadone.com/blabee/admin/index.html?demo=1&base=/another/&redirect_to=https://untrusted.example/#ignored');
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return Response.json(publicConfig); };
  const auth = await moduleForTest(); await initialize(auth); await auth.beginLogin('google');
  const target = new URL(location.href);
  assert.deepEqual(calls, ['/blabee/admin/api/config']);
  assert.equal(target.searchParams.get('redirect_to'), 'https://biadone.com/blabee/admin/?auth_return=1');
  assert.equal(storage.has('blabee.dashboard.pkce.v1'), true);
  assert.equal(storage.has('blabee.dashboard.auth.v1'), false);
});

test('nested callback restores the same access-token session format and scrubs only auth params', async () => {
  const storage = harness('https://biadone.com/blabee/admin/?code=nested-code&auth_return=1&keep=1');
  storage.set('blabee.dashboard.pkce.v1', JSON.stringify({ verifier: 'nested-verifier', createdAt: Date.now() }));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return Response.json(url === '/blabee/admin/api/config' ? publicConfig : { access_token: 'nested-access', expires_in: 3600 });
  };
  const auth = await moduleForTest(); await initialize(auth);
  assert.equal(calls[0][0], '/blabee/admin/api/config');
  assert.deepEqual(JSON.parse(calls[1][1].body), { auth_code: 'nested-code', code_verifier: 'nested-verifier' });
  assert.equal(await auth.accessToken(), 'nested-access');
  assert.equal(JSON.parse(storage.get('blabee.dashboard.auth.v1')).accessToken, 'nested-access');
  assert.equal(storage.has('blabee.dashboard.pkce.v1'), false);
  assert.equal(location.href, 'https://biadone.com/blabee/admin/?keep=1');
});

test('nested page-exit logout removes access data while preserving a pending PKCE callback', async () => {
  const storage = harness('https://biadone.com/blabee/admin/');
  storage.set('blabee.dashboard.auth.v1', JSON.stringify({ accessToken: 'old-access', expiresAt: Date.now() + 60000 }));
  storage.set('blabee.dashboard.pkce.v1', JSON.stringify({ verifier: 'pending-verifier', createdAt: Date.now() }));
  globalThis.fetch = async url => Response.json(url === '/blabee/admin/api/config' ? publicConfig : { access_token: 'callback-access', expires_in: 3600 });
  const beforeNavigation = await moduleForTest(); await initialize(beforeNavigation);
  assert.equal(await beforeNavigation.accessToken(), 'old-access');
  // app.clearPrivateData calls this on pagehide and BFCache return in subpath mode.
  beforeNavigation.clearSession();
  assert.equal(await beforeNavigation.accessToken(), null);
  assert.equal(storage.has('blabee.dashboard.auth.v1'), false);
  assert.equal(JSON.parse(storage.get('blabee.dashboard.pkce.v1')).verifier, 'pending-verifier');
  location.href = 'https://biadone.com/blabee/admin/?code=returned-code&auth_return=1';
  const afterCallback = await moduleForTest(); await initialize(afterCallback);
  assert.equal(await afterCallback.accessToken(), 'callback-access');
  assert.equal(storage.has('blabee.dashboard.pkce.v1'), false);
});

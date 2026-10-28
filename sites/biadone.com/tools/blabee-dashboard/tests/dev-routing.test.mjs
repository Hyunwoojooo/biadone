import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevHandler } from '../scripts/dev.mjs';

const PREFIX = '/blabee/admin/';
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
const INDEX = '<!doctype html><title>Blabee dashboard</title><script type="module" src="./app.mjs"></script>';
const ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key', DASHBOARD_OWNER_UID: '11111111-1111-4111-8111-111111111111' };

async function fixture(t, overrides = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'blabee-dashboard-routing-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const publicDirectory = join(temporary, 'public');
  await mkdir(join(publicDirectory, 'api'), { recursive: true });
  await Promise.all([
    writeFile(join(publicDirectory, 'index.html'), INDEX),
    writeFile(join(publicDirectory, 'app.mjs'), 'export const dashboard = true;'),
    writeFile(join(publicDirectory, 'styles.css'), 'body { color: black; }'),
    writeFile(join(publicDirectory, '_headers'), 'private deployment rules'),
    writeFile(join(publicDirectory, 'api', 'unknown.mjs'), 'must not serve unknown API paths'),
    writeFile(join(temporary, 'outside.mjs'), 'outside fixture must remain private'),
  ]);
  await symlink(join(temporary, 'outside.mjs'), join(publicDirectory, 'leak.mjs'));
  return createDevHandler({ publicDirectory, headers: HEADERS, env: ENV, ...overrides });
}

async function invoke(handler, url, { method = 'GET', headers = {}, body = '' } = {}) {
  const incoming = {
    url,
    method,
    headers: { host: 'localhost:8814', ...headers },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
  };
  const result = {};
  const outgoing = {
    writeHead(status, values) { result.status = status; result.headers = new Headers(values); },
    end(value) { result.body = value === undefined ? '' : Buffer.from(value).toString('utf8'); },
  };
  await handler(incoming, outgoing);
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(result.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(result.headers.get('Referrer-Policy'), 'no-referrer');
  return result;
}

test('root and prefixed pages serve the same app and assets without opening a server', async t => {
  const handler = await fixture(t);
  for (const base of ['/', PREFIX]) {
    const index = await invoke(handler, `${base}?demo=1`);
    assert.equal(index.status, 200);
    assert.equal(index.body, INDEX);
    assert.equal(index.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(index.headers.get('Cache-Control'), 'no-store');
    const script = await invoke(handler, `${base}app.mjs`);
    assert.equal(script.status, 200);
    assert.equal(script.body, 'export const dashboard = true;');
    const head = await invoke(handler, `${base}styles.css`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers.get('Content-Type'), 'text/css; charset=utf-8');
  }
});

test('canonical prefix redirect preserves the query while the root OAuth callback remains at root', async t => {
  const handler = await fixture(t);
  const query = '?demo=1&code=a%2Fb&state=some+state';
  const redirect = await invoke(handler, `/blabee/admin${query}`);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('Location'), `${PREFIX}${query}`);
  assert.equal(redirect.headers.get('Cache-Control'), 'no-store');
  const callback = await invoke(handler, `/${query}`);
  assert.equal(callback.status, 200);
  assert.equal(callback.headers.get('Location'), null);
  assert.equal(callback.body, INDEX);
});

test('both API mounts dispatch the original request to the same configured handlers', async t => {
  const calls = [];
  const apiRoutes = Object.fromEntries(['/api/config', '/api/admin/overview', '/api/admin/posts', '/api/admin/analytics'].map(path => [path, async ({ request, env }) => {
    calls.push({ path, request, env, body: await request.text() });
    return new Response(JSON.stringify({ route: path }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  }]));
  const handler = await fixture(t, { apiRoutes });
  for (const base of ['/', PREFIX]) {
    for (const path of Object.keys(apiRoutes)) {
      const method = path.endsWith('/posts') ? 'POST' : 'GET';
      const body = method === 'POST' ? '{"title":"metadata"}' : '';
      const result = await invoke(handler, `${base}${path.slice(1)}?start=2026-10-01`, {
        method, body, headers: { origin: 'http://localhost:8814', authorization: 'Bearer test', 'content-type': 'application/json' },
      });
      assert.equal(result.status, 200);
      assert.equal(JSON.parse(result.body).route, path);
      assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
      const call = calls.at(-1);
      assert.equal(new URL(call.request.url).origin, 'http://localhost:8814');
      assert.equal(new URL(call.request.url).pathname, `${base}${path.slice(1)}`);
      assert.equal(new URL(call.request.url).searchParams.get('start'), '2026-10-01');
      assert.equal(call.request.method, method);
      assert.equal(call.body, body);
      assert.equal(call.request.headers.get('Authorization'), 'Bearer test');
      assert.deepEqual(call.env, ENV);
    }
  }
  assert.equal(calls.length, 8);
});

test('real config and protected API handlers preserve localhost and 127.0.0.1 same-origin behavior', async t => {
  const handler = await fixture(t);
  for (const host of ['localhost:8814', '127.0.0.1:8814']) {
    for (const base of ['/', PREFIX]) {
      const config = await invoke(handler, `${base}api/config`, { headers: { host, origin: `http://${host}` } });
      assert.equal(config.status, 200);
      assert.equal(JSON.parse(config.body).configured, true);
      const protectedResponse = await invoke(handler, `${base}api/admin/posts`, {
        method: 'POST', headers: { host, origin: `http://${host}`, 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(protectedResponse.status, 401, 'missing bearer token must fail before any Supabase request');
      assert.equal(JSON.parse(protectedResponse.body).error.code, 'UNAUTHORIZED');
      assert.equal(protectedResponse.headers.get('Cache-Control'), 'private, no-store');
    }
  }
});

test('unknown APIs and paths outside either app mount return 404', async t => {
  const handler = await fixture(t);
  for (const path of [
    '/api/missing', '/api/admin/unknown', '/api/unknown.mjs',
    `${PREFIX}api/missing`, `${PREFIX}api/admin/overview/`, `${PREFIX}api/unknown.mjs`,
    '/blabee/api/config', '/blabee/adminx/api/config', '/other/api/config', '/other/index.html',
  ]) assert.equal((await invoke(handler, path)).status, 404, path);
  assert.equal((await invoke(handler, `${PREFIX}styles.css`, { method: 'POST' })).status, 404);
  assert.equal((await invoke(handler, PREFIX, { headers: { host: 'other.example:8814' } })).status, 404);
});

test('raw and encoded traversal, private files and symlink escapes stay inaccessible', async t => {
  const handler = await fixture(t);
  for (const path of [
    '/../index.html', '/%2e%2e/index.html',
    `${PREFIX}../index.html`, `${PREFIX}%2e%2e/index.html`, `${PREFIX}../../api/config`,
    `${PREFIX}%2e%2e%2findex.html`, `${PREFIX}..%5cindex.html`, `${PREFIX}%00.mjs`, `${PREFIX}%zz`,
    '//other.example/index.html', 'http://other.example/index.html',
    '/_headers', `${PREFIX}_headers`, '/leak.mjs', `${PREFIX}leak.mjs`,
  ]) {
    const result = await invoke(handler, path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body, /outside fixture|private deployment/);
  }
});

test('prefixed API requests retain the existing development transport size limit', async t => {
  let called = false;
  const handler = await fixture(t, { apiRoutes: { '/api/admin/posts': async () => { called = true; return new Response('{}'); } } });
  const result = await invoke(handler, `${PREFIX}api/admin/posts`, { method: 'POST', body: 'a'.repeat(32_769) });
  assert.equal(result.status, 413);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(called, false);
});

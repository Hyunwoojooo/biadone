import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSite } from '../scripts/prepare-site.mjs';
import { DASHBOARD_BASE, DASHBOARD_ASSETS, onRequestDashboard } from '../server/dashboard-route.mjs';
import { readConfig } from '../server/auth.mjs';
import { withDevelopmentOverrides } from '../scripts/dev.mjs';

const OWNER_UIDS = ['b0723835-2e5f-488c-b12e-dc50bf1cdc66', '338752c1-9293-47eb-ab45-b9832348860f', '642f7cfe-003e-4d63-9bfa-c25056b1325a'];

async function route(path, { method = 'GET', response = new Response('asset'), origin = 'https://biadone.com' } = {}) {
  let forwarded = false;
  const result = await onRequestDashboard({
    request: new Request(`${origin}${path}`, { method }),
    next: async () => { forwarded = true; return response; },
  });
  return { result, forwarded };
}

test('canonical admin redirects preserve OAuth/query values on the same origin', async () => {
  for (const path of ['/blabee/admin', '/blabee/admin/index.html']) {
    const { result, forwarded } = await route(`${path}?code=short-lived&next=https%3A%2F%2Felsewhere.example`);
    assert.equal(result.status, 308);
    const target = new URL(result.headers.get('Location'));
    assert.equal(target.origin, 'https://biadone.com');
    assert.equal(target.pathname, DASHBOARD_BASE);
    assert.equal(target.searchParams.get('code'), 'short-lived');
    assert.equal(target.searchParams.get('next'), 'https://elsewhere.example');
    assert.equal(forwarded, false);
  }
});

test('admin assets replace an overlapping landing CSP without changing the asset body', async () => {
  const { result, forwarded } = await route('/blabee/admin/', {
    response: new Response('dashboard HTML', { headers: {
      'Content-Security-Policy': "connect-src https://example.test/rpc/submit",
      'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Type': 'text/html',
    } }),
  });
  assert.equal(forwarded, true);
  assert.equal(await result.text(), 'dashboard HTML');
  assert.equal(result.headers.get('Content-Type'), 'text/html');
  assert.match(result.headers.get('Content-Security-Policy'), /connect-src 'self' https:\/\/vulnkqyqqbucvbhwjswr.supabase.co;/);
  assert.doesNotMatch(result.headers.get('Content-Security-Policy'), /example.test|,/);
  assert.equal(result.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(result.headers.get('Cache-Control'), 'no-store, no-transform');
});

test('immutable downstream responses are wrapped and API denials retain no-store and Vary', async () => {
  const redirect = await route('/blabee/admin/styles.css', { response: Response.redirect('https://biadone.com/blabee/admin/styles.css?v=1') });
  assert.equal(redirect.result.status, 302);
  assert.equal(redirect.result.headers.get('X-Frame-Options'), 'DENY');
  const { result } = await route('/blabee/admin/api/admin/overview', {
    response: Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401, headers: { Vary: 'Accept-Encoding' } }),
  });
  assert.equal(result.status, 401);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(new Set(result.headers.get('Vary').split(',').map(s => s.trim())), new Set(['Accept-Encoding', 'Authorization', 'Origin']));
  assert.equal((await result.json()).error.code, 'UNAUTHORIZED');
});

test('unknown admin assets, API paths and private paths never reach the site fallback', async () => {
  for (const path of ['api/admin/other', 'api/config/extra', 'other.html', '_headers', '_routes.json', 'database/001_dashboard.sql', 'server/auth.mjs', 'nested/app.mjs', '%2e%2e%2fconfig']) {
    const { result, forwarded } = await route(`${DASHBOARD_BASE}${path}`);
    assert.equal(result.status, 404, path);
    assert.equal(forwarded, false, path);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal((await route('/blabee/administer/')).result.status, 404);
});

test('static mutations are denied while valid API methods remain the handlers responsibility', async () => {
  const denied = await route('/blabee/admin/app.mjs', { method: 'POST' });
  assert.equal(denied.result.status, 405);
  assert.equal(denied.result.headers.get('Allow'), 'GET, HEAD');
  assert.equal(denied.forwarded, false);
  const delegated = await route('/blabee/admin/api/admin/posts', { method: 'POST', response: new Response(null, { status: 403 }) });
  assert.equal(delegated.forwarded, true);
  assert.equal(delegated.result.status, 403);
  const analytics = await route('/blabee/admin/api/admin/analytics', { response: Response.json({ status: 'not_configured' }) });
  assert.equal(analytics.forwarded, true);
  assert.equal(analytics.result.headers.get('Cache-Control'), 'private, no-store');
  const head = await route('/blabee/admin/app.mjs', { method: 'HEAD', response: new Response(null) });
  assert.equal(head.result.body, null);
});

let prepared;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
after(async () => { if (prepared) await rm(prepared, { recursive: true, force: true }); });

test('combined site package preserves public landing bytes and contains only approved admin assets', async () => {
  prepared = await prepareSite();
  for (const file of ['index.html', '_headers', '_redirects', 'blabee/index.html', 'blabee/js/landing-attribution.mjs', 'blabee/js/beta-signup.mjs']) {
    assert.deepEqual(await readFile(join(prepared, 'public', file)), await readFile(join(root, file)), file);
  }
  assert.deepEqual((await readdir(join(prepared, 'public/blabee/admin'))).sort(), [...DASHBOARD_ASSETS].sort());
  assert.equal((await readdir(join(prepared, 'public'))).some(name => ['reference', 'tools', 'database', 'server', 'dashboard-server', 'functions', 'wrangler.jsonc'].includes(name)), false);
  const routes = JSON.parse(await readFile(join(prepared, 'public/_routes.json'), 'utf8'));
  assert.deepEqual(routes, { version: 1, include: ['/blabee/admin', '/blabee/admin/*'], exclude: [] });
  const config = JSON.parse(await readFile(join(prepared, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.name, 'biadone');
  assert.equal(config.pages_build_output_dir, './public');
  assert.deepEqual(readConfig(config.vars).ownerUids, OWNER_UIDS);
  assert.equal(readConfig(config.vars).ownerUid, null);
});

test('packaging accepts valid plural UID configuration and rejects malformed or email-only authorization', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'blabee-dashboard-owner-config-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const original = JSON.parse(await readFile(join(root, 'tools/blabee-dashboard/wrangler.jsonc'), 'utf8'));
  const configPath = join(temporary, 'config.json');
  const vars = { ...original.vars, DASHBOARD_OWNER_UIDS: ` ${OWNER_UIDS[0].toUpperCase()},${OWNER_UIDS[1]}, ${OWNER_UIDS[2]},${OWNER_UIDS[1]} ` };
  await writeFile(configPath, JSON.stringify({ ...original, vars }));
  const result = await prepareSite({ configPath });
  t.after(() => rm(result, { recursive: true, force: true }));
  const config = JSON.parse(await readFile(join(result, 'wrangler.jsonc'), 'utf8'));
  assert.deepEqual(readConfig(config.vars).ownerUids, OWNER_UIDS);
  for (const value of ['', null, [], `${OWNER_UIDS[0]},invalid`, `${OWNER_UIDS[0]},`]) {
    await writeFile(configPath, JSON.stringify({ ...original, vars: { ...vars, DASHBOARD_OWNER_UIDS: value } }));
    await assert.rejects(prepareSite({ configPath }), /Confirmed dashboard owner UIDs are required/);
  }
  const emailOnly = { ...vars, DASHBOARD_OWNER_UID: '', DASHBOARD_OWNER_EMAIL: 'owner@example.test' };
  delete emailOnly.DASHBOARD_OWNER_UIDS;
  await writeFile(configPath, JSON.stringify({ ...original, vars: emailOnly }));
  await assert.rejects(prepareSite({ configPath }), /Confirmed dashboard owner UIDs are required/);
});

test('development overrides support plural UIDs and preserve explicit empty values as invalid configuration', () => {
  const vars = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key', DASHBOARD_OWNER_UID: OWNER_UIDS[0] };
  const configured = withDevelopmentOverrides(vars, { DASHBOARD_OWNER_UIDS: OWNER_UIDS.join(',') });
  assert.deepEqual(readConfig(configured).ownerUids, OWNER_UIDS);
  assert.equal(Object.hasOwn(vars, 'DASHBOARD_OWNER_UIDS'), false);
  for (const value of ['', undefined]) {
    const overridden = withDevelopmentOverrides(configured, { DASHBOARD_OWNER_UIDS: value });
    assert.equal(Object.hasOwn(overridden, 'DASHBOARD_OWNER_UIDS'), true);
    assert.equal(readConfig(overridden), null);
  }
  assert.deepEqual(readConfig(withDevelopmentOverrides(configured, {})).ownerUids, OWNER_UIDS);
});

test('generated Functions resolve to private server modules outside the deployed public directory', async () => {
  if (!prepared) prepared = await prepareSite();
  for (const file of ['_middleware.js', 'api/config.js', 'api/admin/overview.js', 'api/admin/posts.js', 'api/admin/analytics.js']) {
    const wrapper = join(prepared, 'functions/blabee/admin', file);
    const source = await readFile(wrapper, 'utf8');
    const imported = source.match(/from '([^']+)'/)?.[1];
    assert.ok(imported);
    const target = resolve(dirname(wrapper), imported);
    assert.ok(target.startsWith(join(prepared, 'dashboard-server/')));
    assert.ok((await readFile(target)).length > 0);
  }
});

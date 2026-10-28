import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createDashboardPaths } from '../public/paths.mjs';

test('root modules keep root API paths and a root OAuth callback', () => {
  const paths = createDashboardPaths('http://localhost:8000/app.mjs', 'http://localhost:8000/?demo=1');
  assert.equal(paths.basePath, '/');
  assert.equal(paths.homeURL, 'http://localhost:8000/');
  assert.equal(paths.apiPath('/api/config'), '/api/config');
  assert.equal(paths.apiPath('/api/admin/posts?id=post-1'), '/api/admin/posts?id=post-1');
  assert.equal(paths.apiPath('/api/admin/analytics?start=2026-10-10&end=2026-10-17'), '/api/admin/analytics?start=2026-10-10&end=2026-10-17');
  assert.equal(paths.oauthCallbackURL, 'http://localhost:8000/?auth_return=1');
});

test('nested modules use the entire directory and preserve API query parameters', () => {
  const paths = createDashboardPaths('https://biadone.com/blabee/admin/app.mjs?version=1#ignored', 'https://biadone.com/blabee/admin/index.html?demo=1');
  assert.equal(paths.basePath, '/blabee/admin/');
  assert.equal(paths.homeURL, 'https://biadone.com/blabee/admin/');
  assert.equal(paths.apiPath('/api/config'), '/blabee/admin/api/config');
  assert.equal(paths.apiPath('/api/admin/overview?start=2026-10-10&end=2026-10-17&campaign=all'), '/blabee/admin/api/admin/overview?start=2026-10-10&end=2026-10-17&campaign=all');
  assert.equal(paths.apiPath('/api/admin/analytics?start=2026-10-10&end=2026-10-17'), '/blabee/admin/api/admin/analytics?start=2026-10-10&end=2026-10-17');
  assert.equal(paths.oauthCallbackURL, 'https://biadone.com/blabee/admin/?auth_return=1');
});

test('page path, search, hash, and redirect values cannot override the module base', () => {
  const paths = createDashboardPaths('https://biadone.com/blabee/admin/auth.mjs', 'https://biadone.com/unrelated/path/?base=https://untrusted.example/&api=/other/#/injected/');
  assert.equal(paths.basePath, '/blabee/admin/');
  assert.equal(paths.apiPath('/api/admin/posts'), '/blabee/admin/api/admin/posts');
  assert.equal(paths.oauthCallbackURL, 'https://biadone.com/blabee/admin/?auth_return=1');
});

test('cross-origin modules, non-HTTP origins, and arbitrary API destinations are rejected', () => {
  for (const [moduleURL, pageURL] of [
    ['https://untrusted.example/auth.mjs', 'https://biadone.com/blabee/admin/'],
    ['http://biadone.com/auth.mjs', 'https://biadone.com/'],
    ['http://localhost:8001/auth.mjs', 'http://localhost:8000/'],
    ['file:///tmp/auth.mjs', 'file:///tmp/index.html'],
    ['https://name:secret@biadone.com/auth.mjs', 'https://biadone.com/'],
  ]) assert.throws(() => createDashboardPaths(moduleURL, pageURL), TypeError);
  const paths = createDashboardPaths('https://biadone.com/blabee/admin/app.mjs');
  for (const route of ['https://untrusted.example/api/config', '//untrusted.example/api/config', '/../api/config', '/api/admin/posts/../../../', '/api/unknown', '/api/config#hash']) {
    assert.throws(() => paths.apiPath(route), TypeError);
  }
});

test('HTML assets and brand link resolve beneath both supported app bases', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const assets = [...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  const brand = /<a class="brand" href="([^"]+)"/.exec(html)?.[1];
  assert.deepEqual(assets, ['./mark.svg', './styles.css', './app.mjs']);
  assert.equal(brand, './');
  for (const base of ['https://dashboard.example/', 'https://biadone.com/blabee/admin/']) {
    const paths = createDashboardPaths(new URL('./app.mjs', base), base);
    for (const asset of assets) assert.equal(new URL(asset, base).pathname, `${paths.basePath}${asset.slice(2)}`);
    assert.equal(new URL(brand, base).href, paths.homeURL);
  }
});

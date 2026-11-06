// Local Cloudflare package only. All API fixtures and OAuth are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const { chromium } = require(option('--playwright-module') || process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8816/blabee/admin/');
const output = process.env.OUTPUT_DIR || '/tmp/blabee-dashboard-subpath-qa';
const SESSION = 'blabee.dashboard.auth.v1', PKCE = 'blabee.dashboard.pkce.v1';
const results = [], errors = [], unexpectedNetwork = [];

(async () => {
  const { createDemoData } = await import(pathToFileURL(path.resolve(__dirname, '../public/demo.mjs')).href);
  const { rangeForDays } = await import(pathToFileURL(path.resolve(__dirname, '../public/data.mjs')).href);
  const fixture = createDemoData(rangeForDays()); fixture.overview.demo = false;
  const config = { configured: true, supabase: { url: 'https://vulnkqyqqbucvbhwjswr.supabase.co', publishableKey: 'sb_publishable_qa_fixture_only' } };
  const browser = await chromium.launch({ headless: true, executablePath: option('--executable') || process.env.PLAYWRIGHT_EXECUTABLE });
  await fs.mkdir(output, { recursive: true });
  async function scenario(name, run, auth = false) {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    context.setDefaultTimeout(10000);
    const requests = [], oauth = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === config.supabase.url && url.pathname === '/auth/v1/authorize') {
        oauth.push(url.href); return route.fulfill({ contentType: 'text/html', body: '<p>Mock OAuth provider. No external request sent.</p>' });
      }
      if (url.origin !== base.origin) { unexpectedNetwork.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
      if (url.pathname === '/qa-public') return route.fulfill({ contentType: 'text/html', body: '<p>Public navigation fixture.</p>' });
      if (url.pathname.startsWith(`${base.pathname}api/`)) {
        requests.push(url.pathname);
        if (url.pathname.endsWith('/config')) return route.fulfill({ json: config });
        return route.fulfill({ json: url.pathname.endsWith('/analytics') ? fixture.analytics : fixture.overview });
      }
      return route.continue();
    });
    if (auth) await context.addInitScript(({ key }) => {
      if (!sessionStorage.getItem('qa-seeded-once')) {
        sessionStorage.setItem(key, JSON.stringify({ accessToken: 'qa.owner.token', expiresAt: Date.now() + 3600000 }));
        sessionStorage.setItem('qa-seeded-once', '1');
      }
    }, { key: SESSION });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ name, error: error.message }));
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push({ name, error: message.text() }); });
    try { await run(page, requests, oauth); results.push({ name, passed: true }); }
    finally { await context.close(); }
  }
  const waitForData = page => page.locator('#pageviews').filter({ hasText: /\d/ }).waitFor();
  const checkCleared = async page => {
    assert.equal(await page.locator('#login-screen').isVisible(), true);
    assert.equal(await page.locator('#dashboard-screen').isVisible(), false);
    assert.equal(await page.locator('#pageviews').innerText(), '—');
    assert.equal(await page.locator('#signups').innerText(), '—');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
    assert.equal(await page.locator('#visits').innerText(), '—');
    assert.equal(await page.locator('#views-chart svg').count(), 0);
  };
  try {
    await scenario('subpath assets, single CSP, explicit demo and responsive filters', async page => {
      const response = await page.goto(`${base.href}?demo=1`); await waitForData(page);
      const csp = (await response.allHeaders())['content-security-policy'];
      assert.equal(csp.split(',').length, 1); assert.match(csp, /connect-src 'self' https:\/\/vulnkqyqqbucvbhwjswr.supabase.co;/);
      assert.match(await page.locator('#mode-label').innerText(), /샘플/);
      assert.equal(await page.locator('#notice, #new-post, #post-form, #tab-posts').count(), 0);
      assert.equal(await page.locator('#dashboard-screen .brand').getAttribute('href'), './');
      await page.screenshot({ path: `${output}/desktop.png`, fullPage: false });
      for (const [width, height] of [[768, 1024], [390, 844]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
    });
    await scenario('mounted APIs, native page exit and back navigation clear owner data and retain PKCE', async (page, requests) => {
      await page.goto(base.href); await waitForData(page);
      assert.ok(requests.includes(`${base.pathname}api/admin/overview`));
      assert.ok(requests.includes(`${base.pathname}api/admin/analytics`));
      assert.equal(requests.some(url => url.endsWith('/posts')), false);
      await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ verifier: 'pending-verifier', createdAt: Date.now() })), PKCE);
      await page.goto(`${base.origin}/qa-public`);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
      assert.match(await page.evaluate(key => sessionStorage.getItem(key), PKCE), /pending-verifier/);
      await page.goBack(); await page.locator('#login-screen').waitFor();
      await checkCleared(page);
    }, true);
    await scenario('persisted pageshow cleanup prevents cached private data restoration', async page => {
      await page.goto(base.href); await waitForData(page);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await checkCleared(page);
    }, true);
    await scenario('Google PKCE uses the exact mounted callback and keeps verifier through provider navigation', async (page, requests, oauth) => {
      await page.goto(base.href); await page.locator('#login-screen').waitFor();
      await page.locator('#google-login').click();
      await page.waitForURL(url => url.origin === config.supabase.url);
      const target = new URL(oauth[0]);
      assert.equal(target.searchParams.get('redirect_to'), `${base.href}?auth_return=1`);
      assert.match(target.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
      await page.goBack(); await page.locator('#login-screen').waitFor();
      assert.ok(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.verifier?.length > 40, PKCE));
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
    });
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
    await fs.writeFile(`${output}/results.json`, JSON.stringify({ results, errors, unexpectedNetwork }, null, 2));
    console.log(JSON.stringify({ passed: results.length, results, errors, unexpectedNetwork, output }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

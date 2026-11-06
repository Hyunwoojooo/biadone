// Real rendered app; all owner APIs and OAuth are intercepted. No live writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const { chromium } = require(option('--playwright-module') || process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8818/blabee/admin/');
const output = process.env.OUTPUT_DIR || '/tmp/blabee-login-gate-qa';
const SESSION = 'blabee.dashboard.auth.v1', PKCE = 'blabee.dashboard.pkce.v1';
const config = { configured: true, supabase: { url: 'https://vulnkqyqqbucvbhwjswr.supabase.co', publishableKey: 'sb_publishable_qa_fixture_only' } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

(async () => {
  const { createDemoData } = await import(pathToFileURL(path.resolve(__dirname, '../public/demo.mjs')).href);
  const { rangeForDays } = await import(pathToFileURL(path.resolve(__dirname, '../public/data.mjs')).href);
  const fixture = createDemoData(rangeForDays()); fixture.overview.demo = false;
  const browser = await chromium.launch({ headless: true, executablePath: option('--executable') || process.env.PLAYWRIGHT_EXECUTABLE });
  const results = [], errors = [], external = [];
  await fs.mkdir(output, { recursive: true });

  async function scenario(name, run, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block', javaScriptEnabled: options.javaScript !== false });
    context.setDefaultTimeout(10000);
    const requests = [], oauth = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === config.supabase.url) {
        if (url.pathname === '/auth/v1/authorize') {
          oauth.push(url.href);
          return route.fulfill({ contentType: 'text/html', body: '<p>Mock OAuth. No external request sent.</p>' });
        }
        if (url.pathname === '/auth/v1/token' && options.onToken) return options.onToken(route);
      }
      if (url.origin !== base.origin) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
      if (url.pathname.startsWith(`${base.pathname}api/`)) {
        requests.push(url.pathname);
        if (url.pathname.endsWith('/config')) return options.onConfig ? options.onConfig(route) : route.fulfill({ json: config });
        if (options.onApi) return options.onApi(route, url);
        return route.fulfill({ json: url.pathname.endsWith('/analytics') ? fixture.analytics : fixture.overview });
      }
      return route.continue();
    });
    if (options.auth || options.callback) await context.addInitScript(({ sessionKey, pkceKey, auth, callback, expiry }) => {
      if (auth) sessionStorage.setItem(sessionKey, JSON.stringify({ accessToken: 'qa.owner.token', expiresAt: Date.now() + expiry }));
      if (callback) sessionStorage.setItem(pkceKey, JSON.stringify({ verifier: 'v'.repeat(64), createdAt: Date.now() }));
    }, { sessionKey: SESSION, pkceKey: PKCE, auth: !!options.auth, callback: !!options.callback, expiry: options.expiry || 3600000 });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ name, error: e.message }));
    page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (401|403|503)/.test(m.text())) errors.push({ name, error: m.text() }); });
    try {
      await run(page, requests, oauth);
      assert.equal(requests.some(url => url.endsWith('/posts')), false, 'Removed post management never requests its API');
      results.push({ name, passed: true });
    }
    finally { await context.close(); }
  }
  async function onlyLogin(page) {
    await page.locator('#login-screen').waitFor();
    assert.equal(await page.locator('#dashboard-screen').isVisible(), false);
    assert.equal(await page.locator('.main-nav').isVisible(), false);
    assert.equal(await page.locator('#new-post').isVisible(), false);
    assert.equal(await page.locator('#pageviews').isVisible(), false);
  }
  const mainReady = async page => {
    await page.locator('#dashboard-screen').waitFor();
    await page.locator('#signups').filter({ hasText: /\d/ }).waitFor();
    assert.equal(await page.locator('#login-screen').isVisible(), false);
  };

  try {
    await scenario('HTML with JavaScript disabled exposes only login, never dashboard controls', async page => {
      await page.goto(base.href); await onlyLogin(page);
      assert.equal(await page.locator('#dashboard-screen').getAttribute('hidden') !== null, true);
      assert.equal(await page.locator('#google-login').isDisabled(), true);
      assert.match(await page.locator('#login-screen').innerText(), /JavaScript/);
      await page.screenshot({ path: `${output}/no-javascript.png` });
    }, { javaScript: false });

    const configuration = deferred(), configStarted = deferred();
    await scenario('slow configuration and anonymous entry stay on a responsive standalone login screen', async (page, requests) => {
      await page.goto(base.href, { waitUntil: 'commit' }); await configStarted.promise;
      await onlyLogin(page);
      assert.equal(await page.locator('#google-login').isDisabled(), true);
      assert.equal((await page.locator('#login-screen').innerText()).replace(/\s+/g, ' ').trim(), 'Blabee Google로 로그인');
      configuration.resolve();
      await page.waitForFunction(() => !document.getElementById('google-login').disabled);
      await onlyLogin(page);
      assert.equal(requests.some(url => url.includes('/api/admin/')), false);
      assert.equal(await page.locator('#demo-login:visible').count(), 0);
      assert.equal(await page.locator('#github-login, #login-retry').count(), 0);
      assert.equal(await page.locator('#login-screen button').count(), 1);
      assert.equal((await page.locator('#login-screen').innerText()).replace(/\s+/g, ' ').trim(), 'Blabee Google로 로그인');
      await page.screenshot({ path: `${output}/login-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${output}/login-mobile.png`, fullPage: true });
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('#dashboard-screen')), false);
      }
    }, { onConfig: async route => { configStarted.resolve(); await configuration.promise; return route.fulfill({ json: config }); } });

    await scenario('standalone Google button uses exact PKCE callback and retains verifier on browser return', async (page, requests, oauth) => {
      await page.goto(base.href); await onlyLogin(page);
      await page.locator('#google-login').click();
      await page.waitForURL(url => url.origin === config.supabase.url);
      const target = new URL(oauth[0]);
      assert.equal(target.searchParams.get('provider'), 'google');
      assert.equal(target.searchParams.get('redirect_to'), `${base.href}?auth_return=1`);
      assert.match(target.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
      await page.goBack(); await onlyLogin(page);
      assert.ok(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.verifier?.length > 40, PKCE));
    });

    const token = deferred(), tokenStarted = deferred(), overview = deferred(), overviewStarted = deferred();
    await scenario('PKCE callback waits for database owner overview before main, then logout clears private analytics', async page => {
      await page.goto(`${base.href}?auth_return=1&code=qa-callback&keep=1#done`, { waitUntil: 'commit' });
      await tokenStarted.promise; await onlyLogin(page); token.resolve();
      await overviewStarted.promise; await onlyLogin(page); overview.resolve();
      await mainReady(page);
      assert.match(await page.title(), /Blabee/);
      const url = new URL(page.url());
      assert.equal(url.searchParams.get('keep'), '1'); assert.equal(url.hash, '#done');
      assert.equal(url.searchParams.has('code'), false); assert.equal(url.searchParams.has('auth_return'), false);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), PKCE), null);
      await page.screenshot({ path: `${output}/authorized-main.png` });
      assert.equal(await page.locator('#new-post, #post-form, #tab-posts').count(), 0);
      await page.locator('#account-button').click(); await onlyLogin(page);
      assert.equal((await page.locator('#login-screen').innerText()).replace(/\s+/g, ' ').trim(), 'Blabee Google로 로그인');
      assert.equal(await page.locator('#pageviews').innerText(), '—');
      assert.equal(await page.locator('#visits').innerText(), '—');
      assert.equal(await page.locator('#views-chart svg').count(), 0);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
      await page.screenshot({ path: `${output}/logged-out.png` });
    }, {
      callback: true,
      onToken: async route => {
        assert.deepEqual(route.request().postDataJSON(), { auth_code: 'qa-callback', code_verifier: 'v'.repeat(64) });
        tokenStarted.resolve(); await token.promise;
        return route.fulfill({ json: { access_token: 'qa.owner.token', expires_in: 3600 } });
      },
      onApi: async (route, url) => {
        if (url.pathname.endsWith('/overview')) { overviewStarted.resolve(); await overview.promise; return route.fulfill({ json: fixture.overview }); }
        return route.fulfill({ json: fixture.analytics });
      },
    });

    for (const status of [401, 403]) await scenario(`${status} owner verification never reveals main and removes cached session`, async page => {
      await page.goto(base.href); await page.locator('#login-message').filter({ hasText: '접근 권한을 확인해 주세요.' }).waitFor();
      await onlyLogin(page);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
    }, { auth: true, onApi: route => route.fulfill({ status, json: { error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: '접근 권한을 확인해 주세요.' } } }) });

    await scenario('session expiry automatically restores login and clears private state', async page => {
      await page.goto(base.href); await mainReady(page);
      await page.locator('#login-message').filter({ hasText: '로그인이 만료' }).waitFor();
      await onlyLogin(page);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
      assert.equal(await page.locator('#pageviews').innerText(), '—');
    }, { auth: true, expiry: 3500 });

    let failedConfig = true;
    await scenario('configuration failure retries through the same Google button without exposing main', async (page, requests, oauth) => {
      await page.goto(base.href);
      await page.locator('#login-message').filter({ hasText: /연결/ }).waitFor(); await onlyLogin(page);
      assert.equal(await page.locator('#google-login').isDisabled(), false);
      failedConfig = false; await page.locator('#google-login').click();
      await page.waitForURL(url => url.origin === config.supabase.url);
      assert.equal(new URL(oauth[0]).searchParams.get('provider'), 'google');
    }, { onConfig: route => failedConfig ? route.fulfill({ status: 503, json: { error: { message: '연결 실패' } } }) : route.fulfill({ json: config }) });

    let unavailable = true;
    await scenario('initial owner data failure stays on login and retry can open the authorized main', async page => {
      await page.goto(base.href);
      await page.locator('#login-message').filter({ hasText: '일시적으로 조회할 수 없습니다.' }).waitFor();
      await onlyLogin(page); unavailable = false;
      await page.locator('#google-login').click(); await mainReady(page);
    }, { auth: true, onApi: (route, url) => unavailable ? route.fulfill({ status: 503, json: { error: { code: 'DATA_SOURCE_UNAVAILABLE', message: '일시적으로 조회할 수 없습니다.' } } }) : route.fulfill({ json: url.pathname.endsWith('/analytics') ? fixture.analytics : fixture.overview }) });

    await scenario('Cloudflare outage leaves authorized beta data available and never invents visits', async page => {
      await page.goto(base.href); await mainReady(page);
      await page.locator('#analytics-status').filter({ hasText: /조회|연결|실패|Cloudflare/ }).waitFor();
      assert.equal(await page.locator('#pageviews').innerText(), '—');
      assert.equal(await page.locator('#visits').innerText(), '—');
      assert.equal(await page.locator('#views-chart svg').count(), 0);
    }, { auth: true, onApi: (route, url) => url.pathname.endsWith('/analytics')
      ? route.fulfill({ status: 503, json: { error: { code: 'CLOUDFLARE_UNAVAILABLE', message: 'Cloudflare 조회 실패' } } })
      : route.fulfill({ json: fixture.overview }) });

    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await fs.writeFile(`${output}/results.json`, JSON.stringify({ base: base.href, results, errors, external }, null, 2));
    console.log(JSON.stringify({ passed: results.length, results, errors, external, output }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

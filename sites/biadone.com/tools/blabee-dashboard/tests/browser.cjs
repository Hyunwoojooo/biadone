// Rendered analytics QA. All external requests are blocked; owner APIs use fixtures.
// Browser plugin not available: reuse the existing local Playwright installation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const { chromium } = require(option('--playwright-module') || process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8818/');
const output = process.env.OUTPUT_DIR || '/tmp/blabee-analytics-browser-qa';
const SESSION = 'blabee.dashboard.auth.v1';
const results = [], errors = [], external = [];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

(async () => {
  const { createDemoData } = await import(pathToFileURL(path.resolve(__dirname, '../public/demo.mjs')).href);
  const { rangeForDays } = await import(pathToFileURL(path.resolve(__dirname, '../public/data.mjs')).href);
  const config = { configured: true, supabase: { url: 'https://vulnkqyqqbucvbhwjswr.supabase.co', publishableKey: 'sb_publishable_qa_fixture_only' } };
  const fixture = createDemoData(rangeForDays()); fixture.overview.demo = false;
  fixture.overview.filter_options.campaigns.push('private-launch');
  fixture.analytics.breakdowns.countries.rows[0].label = 'Private country <img src=x onerror=alert(1)>';
  const browser = await chromium.launch({ headless: true, executablePath: option('--executable') || process.env.PLAYWRIGHT_EXECUTABLE });
  await fs.mkdir(output, { recursive: true });

  function unavailableAnalytics(status = 'not_configured') {
    const value = structuredClone(fixture.analytics);
    value.status = status; value.message = 'Cloudflare 연결 설정이 필요합니다.';
    for (const metric of Object.values(value.metrics)) Object.assign(metric, { value: null, previous_value: null, change_percent: null, status: 'unavailable' });
    value.series = []; value.hourly = { status: 'unavailable', rows: [] };
    for (const key of Object.keys(value.breakdowns)) value.breakdowns[key] = { status: 'unavailable', rows: [] };
    value.comparison = { status: 'unavailable', start_at: null, end_at: null };
    return value;
  }
  const normalResponse = (route, url) => route.fulfill({ json: url.pathname.endsWith('/analytics') ? fixture.analytics : fixture.overview });
  async function scenario(name, run, { auth = false, api, configured = true } = {}) {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    context.setDefaultTimeout(10000);
    const requests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
      if (url.pathname.startsWith(`${base.pathname}api/`)) {
        requests.push(url.pathname);
        if (url.pathname.endsWith('/config')) return route.fulfill({ json: configured ? config : { configured: false, supabase: null } });
        return api ? api(route, url) : normalResponse(route, url);
      }
      return route.continue();
    });
    if (auth) await context.addInitScript(key => sessionStorage.setItem(key, JSON.stringify({ accessToken: 'qa.owner.token', expiresAt: Date.now() + 3600000 })), SESSION);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ name, error: error.message }));
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push({ name, error: message.text() }); });
    try {
      await run(page, requests);
      assert.equal(requests.some(url => url.endsWith('/posts')), false, 'No post API requests');
      results.push({ name, passed: true });
    } finally { await context.close(); }
  }
  async function dataReady(page) {
    await page.locator('#dashboard-screen').waitFor();
    await page.locator('#pageviews').filter({ hasText: /\d/ }).waitFor();
  }
  async function cleared(page) {
    await page.locator('#login-screen').waitFor();
    assert.equal(await page.locator('#dashboard-screen').isVisible(), false);
    for (const id of ['pageviews', 'visits', 'signups']) assert.equal(await page.locator(`#${id}`).innerText(), '—');
    assert.equal(await page.locator('#views-chart svg, #visits-chart svg, #hours-chart svg').count(), 0);
    assert.equal(await page.locator('#countries').innerText().then(text => text.includes('Private country')), false);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
  }
  try {
    await scenario('sample analytics: exact scope, charts, time of day, rankings, local source filters, periods, responsive', async page => {
      await page.goto(`${base.href}?demo=1`); await dataReady(page);
      assert.match(await page.title(), /Blabee/);
      assert.match(await page.locator('#mode-label').innerText(), /샘플/);
      assert.equal(await page.locator('.page-heading, #notice, #new-post, #post-form, #tab-posts, [data-nav=posts]').count(), 0);
      for (const id of ['views-chart', 'visits-chart', 'hours-chart']) assert.ok(await page.locator(`#${id} svg`).count() > 0, `${id} renders`);
      for (const id of ['countries', 'browsers', 'operating-systems']) assert.ok((await page.locator(`#${id}`).innerText()).trim().length > 0, `${id} populated`);
      assert.match(await page.locator('body').innerText(), /UTC/);
      assert.equal(await page.locator('#table-panel tbody tr').count(), 7);
      const cfViews = await page.locator('#pageviews').innerText();
      const cfVisits = await page.locator('#visits').innerText();
      const signups = await page.locator('#signups').innerText();
      const allRows = await page.locator('#table-panel').innerText();
      await page.locator('#channel').selectOption('reddit');
      assert.equal(await page.locator('#pageviews').innerText(), cfViews);
      assert.equal(await page.locator('#visits').innerText(), cfVisits);
      assert.equal(await page.locator('#signups').innerText(), signups);
      assert.notEqual(await page.locator('#table-panel').innerText(), allRows);
      await page.locator('#channel').selectOption('__all__');
      assert.equal(await page.locator('#table-panel').innerText(), allRows);
      await page.locator('#tab-channels').click();
      assert.match(await page.locator('#table-panel').innerText(), /Reddit/);
      await page.locator('#tab-dates').click();
      await page.getByRole('button', { name: '30일', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#table-panel tbody tr').length === 30);
      assert.notEqual(await page.locator('#pageviews').innerText(), cfViews);
      await page.locator('[data-days="1"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#table-panel tbody tr').length === 1);
      await page.locator('[data-days="7"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#table-panel tbody tr').length === 7);
      assert.equal(await page.locator('#pageviews').innerText(), cfViews);
      await page.locator('#custom-period').click();
      const selected = rangeForDays(4);
      await page.locator('#period-form [name=start]').fill(selected.start);
      await page.locator('#period-form [name=end]').fill(new Date(Date.parse(`${selected.end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
      await page.locator('#period-form').getByRole('button', { name: '적용' }).click();
      await page.waitForFunction(() => document.querySelectorAll('#table-panel tbody tr').length === 4);
      await page.locator('[data-days="7"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#table-panel tbody tr').length === 7);
      await page.locator('#data-info').click();
      assert.match(await page.locator('#info-content').innerText(), /Cloudflare/);
      assert.match(await page.locator('#info-content').innerText(), /biadone.com/);
      await page.locator('[data-close="info-dialog"]').click();
      await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
      for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px no overflow`);
        assert.ok(await page.locator('#channel').evaluate(element => element.getBoundingClientRect().width) > 100);
        await page.screenshot({ path: `${output}/${width === 390 ? 'mobile' : width === 768 ? 'tablet' : 'laptop'}.png`, fullPage: true });
      }
    });

    await scenario('authorized data renders safely; logout clears charts, country labels and dynamic filter options', async (page, requests) => {
      await page.goto(base.href); await dataReady(page);
      assert.ok(requests.some(url => url.endsWith('/overview'))); assert.ok(requests.some(url => url.endsWith('/analytics')));
      assert.match(await page.locator('#countries').innerText(), /Private country <img/);
      assert.equal(await page.locator('#countries img').count(), 0);
      await page.locator('#campaign').selectOption('private-launch');
      await page.locator('#account-button').click(); await cleared(page);
      assert.equal(await page.locator('#campaign').inputValue(), '__all__');
      assert.equal(await page.locator('option[value="private-launch"]').count(), 0);
    }, { auth: true });

    for (const status of [401, 403]) {
      let deny = false;
      await scenario(`${status} from Cloudflare owner endpoint clears previously visible data`, async page => {
        await page.goto(base.href); await dataReady(page);
        deny = true; await page.locator('#refresh').click();
        await page.locator('#login-message').filter({ hasText: '접근 권한을 확인해 주세요.' }).waitFor();
        await cleared(page);
      }, { auth: true, api: (route, url) => deny && url.pathname.endsWith('/analytics')
        ? route.fulfill({ status, json: { error: { code: status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED', message: '접근 권한을 확인해 주세요.' } } })
        : normalResponse(route, url) });
    }

    for (const [status, authUncertain] of [[401, false], [403, false], [503, true]]) {
      const stale = deferred(), staleStarted = deferred(); let sequence = 0;
      await scenario(`stale ${status}${authUncertain ? ' auth_uncertain' : ''} cannot erase a newer successful owner request`, async page => {
        await page.goto(base.href);
        await page.locator('#signups').filter({ hasText: /\d/ }).waitFor(); await staleStarted.promise;
        await page.locator('#refresh').click(); await dataReady(page);
        const before = await page.locator('#pageviews').innerText();
        const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/analytics') && res.status() === status);
        stale.resolve(); await (await response).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#dashboard-screen').isVisible(), true);
        assert.equal(await page.locator('#pageviews').innerText(), before);
        assert.notEqual(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
      }, { auth: true, api: async (route, url) => {
        if (url.pathname.endsWith('/analytics') && ++sequence === 1) {
          staleStarted.resolve(); await stale.promise;
          return route.fulfill({ status, json: { auth_uncertain: authUncertain, error: { code: 'STALE_OWNER_RESPONSE', message: '오래된 인증 확인 응답' } } });
        }
        return normalResponse(route, url);
      } });
    }

    const held = deferred(), started = deferred(); let hold = false;
    await scenario('late analytics response after logout cannot restore private figures', async page => {
      await page.goto(base.href); await dataReady(page); hold = true;
      const delayed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/analytics'));
      await page.locator('#refresh').click(); await started.promise;
      await page.locator('#account-button').click(); held.resolve();
      await (await delayed).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await cleared(page);
    }, { auth: true, api: async (route, url) => {
      if (hold && url.pathname.endsWith('/analytics')) { started.resolve(); await held.promise; }
      return normalResponse(route, url);
    } });

    await scenario('missing Cloudflare connection shows unavailable counts while authorized beta data remains visible', async page => {
      await page.goto(base.href);
      await page.locator('#signups').filter({ hasText: /\d/ }).waitFor();
      await page.locator('#analytics-status').filter({ hasText: 'Cloudflare 연결 설정이 필요합니다.' }).waitFor();
      assert.equal(await page.locator('#pageviews').innerText(), '—');
      assert.equal(await page.locator('#visits').innerText(), '—');
      assert.equal(await page.locator('#countries').innerText().then(text => text.includes('Private country')), false);
      await page.screenshot({ path: `${output}/cloudflare-unavailable.png`, fullPage: true });
    }, { auth: true, api: (route, url) => url.pathname.endsWith('/analytics') ? route.fulfill({ json: unavailableAnalytics() }) : normalResponse(route, url) });

    const empty = structuredClone(fixture.analytics);
    empty.status = 'empty'; empty.message = null;
    for (const metric of Object.values(empty.metrics)) Object.assign(metric, { value: 0, previous_value: 0, change_percent: null, status: 'empty' });
    empty.series = empty.series.map(row => ({ ...row, page_views: 0, visits: 0 }));
    empty.hourly = { status: 'empty', rows: Array.from({ length: 24 }, (_, hour) => ({ hour, page_views: 0, visits: 0 })) };
    for (const key of Object.keys(empty.breakdowns)) empty.breakdowns[key] = { status: 'empty', rows: [] };
    await scenario('measured empty period displays zero instead of treating it as an unavailable source', async page => {
      await page.goto(base.href);
      await page.locator('#signups').filter({ hasText: /\d/ }).waitFor();
      await page.waitForFunction(() => document.getElementById('pageviews').textContent === '0');
      assert.equal(await page.locator('#visits').innerText(), '0');
      assert.equal(await page.locator('#countries').innerText().then(text => text.includes('Private country')), false);
      assert.equal(await page.locator('#dashboard-screen').isVisible(), true);
      await page.screenshot({ path: `${output}/empty-period.png`, fullPage: true });
    }, { auth: true, api: (route, url) => url.pathname.endsWith('/analytics') ? route.fulfill({ json: empty }) : normalResponse(route, url) });

    await scenario('unconfigured authentication keeps login minimal; sample view stays explicitly selected', async page => {
      await page.goto(base.href);
      await page.locator('#login-message').filter({ hasText: /연결|설정/ }).waitFor();
      assert.equal(await page.locator('#dashboard-screen').isVisible(), false);
      assert.equal(await page.locator('#google-login').isDisabled(), false);
      assert.equal(await page.locator('#login-screen button').count(), 1);
      await page.goto(`${base.href}?demo=1`); await dataReady(page);
      assert.match(await page.locator('#mode-label').innerText(), /샘플/);
    }, { configured: false });

    assert.deepEqual(errors, [], 'No runtime or CSP errors'); assert.deepEqual(external, [], 'No external QA requests');
    await fs.writeFile(`${output}/results.json`, JSON.stringify({ base: base.href, results, errors, external }, null, 2));
    console.log(JSON.stringify({ passed: results.length, results, errors, external, output }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

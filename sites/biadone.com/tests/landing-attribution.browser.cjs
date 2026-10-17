// Optional browser QA using an existing Playwright installation; no site dependency.
// All Supabase calls are mocked and all other external requests are blocked.
// These counts are pageviews, not unique visitors.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

const origin = process.env.BASE_URL || 'http://127.0.0.1:8800';
const siteOrigin = new URL(origin).origin;
const output = process.env.OUTPUT_DIR || '/tmp/blabee-attribution-qa';
const signupEndpoint = 'https://vulnkqyqqbucvbhwjswr.supabase.co/rest/v1/rpc/request_blabee_beta_tracked';
const viewEndpoint = 'https://vulnkqyqqbucvbhwjswr.supabase.co/rest/v1/rpc/record_blabee_landing_view';
const cacheKey = 'blabee.landing-attribution.v1';
const fixtureEmail = 'attribution.qa@example.invalid';
const emptyAttribution = {
  utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', referrer_host: '',
};
const corsHeaders = {
  'access-control-allow-origin': siteOrigin,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'apikey, content-type',
};

function landingUrl(pathname = '/blabee/', params = {}) {
  const url = new URL(pathname, origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

async function navigate(page, url, options = {}) {
  const response = await page.goto(url, { waitUntil: 'networkidle', ...options });
  assert.equal(response.status(), 200);
  const entry = new URL(url);
  if (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].some(key => entry.searchParams.has(key))) {
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) entry.searchParams.delete(key);
    assert.equal(page.url(), entry.href, 'Campaign tags are removed after attribution is captured');
  }
}

async function submitBeta(page) {
  const form = page.locator('[data-beta-form]');
  await form.locator('input[type=email]').fill(fixtureEmail);
  await form.locator('button[type=submit]').click();
  await form.locator('[data-form-success]').waitFor({ state: 'visible' });
  assert.equal(await form.locator('[data-form-error]').isVisible(), false);
}

async function withScenario(browser, results, name, options, run) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  context.setDefaultTimeout(15000);
  const state = { views: [], signups: [], errors: [], unexpectedExternal: [], badAssets: [] };
  try {
    await context.addInitScript(({ privacySignal, blockStorage, seedCache, key }) => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => privacySignal === 'gpc' });
      Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => privacySignal === 'navigator-dnt' ? '1' : '0' });
      Object.defineProperty(window, 'doNotTrack', { configurable: true, get: () => privacySignal === 'window-dnt' ? '1' : '0' });
      if (seedCache) {
        try {
          sessionStorage.setItem(key, JSON.stringify({
            attribution: { utm_source: 'old-campaign', utm_medium: '', utm_campaign: '', utm_content: '', referrer_host: '' },
            expiresAt: Date.now() + 30 * 60 * 1000,
          }));
          sessionStorage.setItem('unrelated-test-value', 'keep');
        } catch { /* A fresh about:blank document may have no storage. */ }
      }
      if (blockStorage) {
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          get() { throw new DOMException('Storage blocked by browser test', 'SecurityError'); },
        });
      }
    }, { privacySignal: options.privacySignal, blockStorage: options.blockStorage, seedCache: options.seedCache, key: cacheKey });

    await context.route('**/*', async route => {
      const request = route.request();
      const url = request.url();
      if (url !== signupEndpoint && url !== viewEndpoint) {
        if (new URL(url).origin === siteOrigin) return route.continue();
        state.unexpectedExternal.push(url);
        return route.abort('blockedbyclient');
      }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
      assert.equal(request.method(), 'POST');
      const isView = url === viewEndpoint;
      (isView ? state.views : state.signups).push(request.postDataJSON());
      assert.equal(request.headers().referer, undefined);
      return route.fulfill({
        status: isView && options.failViews ? 503 : 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ accepted: !(isView && options.failViews) }),
      });
    });

    const page = await context.newPage();
    page.on('pageerror', error => state.errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).origin === siteOrigin && response.status() >= 400) state.badAssets.push(response.url());
    });
    await run({ page, ...state });
    await page.waitForLoadState('networkidle');
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.badAssets, []);
    assert.deepEqual(state.unexpectedExternal, []);
    results.push({ name, url: page.url(), pageviews: state.views.length, signupRequests: state.signups.length });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [source, content] of [['reddit', 'post-01'], ['x', 'post-01'], ['instagram', 'bio'], ['youtube', 'video-01']]) {
      for (const suffix of ['', '/']) {
        const viewport = source === 'instagram' ? { width: 390, height: 844 } : undefined;
        await withScenario(browser, results, `Short ${source} link${suffix ? ' with trailing slash' : ''} retains attribution and shows a clean URL`, { viewport }, async ({ page, views, signups }) => {
          const expected = { ...emptyAttribution, utm_source: source, utm_medium: 'social', utm_campaign: 'mac-beta', utm_content: content };
          await navigate(page, landingUrl(`/blabee/${source}${suffix}`));
          assert.equal(page.url(), landingUrl());
          assert.match(await page.title(), /Blabee/);
          assert.ok(await page.locator('[data-beta-form]').count());
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.deepEqual(views, [{ p_attribution: expected }]);
          if (!suffix && ['reddit', 'instagram'].includes(source)) {
            await fs.mkdir(output, { recursive: true });
            await page.screenshot({ path: `${output}/short-${source}.png` });
          }
          const response = await page.reload({ waitUntil: 'networkidle' });
          assert.equal(response.status(), 200);
          assert.equal(page.url(), landingUrl());
          assert.deepEqual(views, [{ p_attribution: expected }, { p_attribution: expected }]);
          await submitBeta(page);
          assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
        });
      }
    }

    await withScenario(browser, results, 'A simulated retained external referrer does not replace the captured campaign on reload', {}, async ({ page, views, signups }) => {
      const referrer = 'https://www.reddit.com/r/example';
      const expected = { ...emptyAttribution, utm_source: 'reddit', utm_medium: 'social', utm_campaign: 'mac-beta', utm_content: 'post-01', referrer_host: 'www.reddit.com' };
      await navigate(page, landingUrl('/blabee/', { utm_source: 'reddit', utm_medium: 'social', utm_campaign: 'mac-beta', utm_content: 'post-01' }), { referer: referrer });
      assert.equal(page.url(), landingUrl());
      assert.deepEqual(views, [{ p_attribution: expected }]);
      assert.equal(await page.evaluate(() => document.referrer), referrer);
      // Browsers vary here; explicitly exercise a retained original referrer.
      await page.addInitScript(value => Object.defineProperty(document, 'referrer', { configurable: true, get: () => value }), referrer);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload');
      assert.equal(await page.evaluate(() => document.referrer), referrer);
      assert.deepEqual(views, [{ p_attribution: expected }, { p_attribution: expected }]);
      await submitBeta(page);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
    });

    await withScenario(browser, results, 'URL cleanup preserves unrelated query parameters, anchor, and history state', {}, async ({ page, views, signups }) => {
      await page.context().addInitScript(() => history.replaceState({ existing: 'keep' }, '', location.href));
      const expected = { ...emptyAttribution, utm_source: 'x' };
      await navigate(page, landingUrl('/blabee/', { utm_source: 'x', lang: 'ko' }) + '#beta');
      assert.equal(page.url(), landingUrl('/blabee/', { lang: 'ko' }) + '#beta');
      assert.deepEqual(await page.evaluate(() => history.state), { existing: 'keep' });
      assert.deepEqual(views, [{ p_attribution: expected }]);
      await submitBeta(page);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
    });

    await withScenario(browser, results, 'Only approved UTM slugs and referrer hostname are sent', {}, async ({ page, views, signups }) => {
      const expected = {
        utm_source: 'reddit', utm_medium: 'social', utm_campaign: 'mac-beta', utm_content: 'post.1', referrer_host: 'news.example.com',
      };
      await navigate(page, landingUrl('/blabee/', {
        utm_source: ' Reddit ', utm_medium: 'SOCIAL', utm_campaign: 'Mac-Beta', utm_content: 'post.1',
        utm_term: 'not-collected', email: 'query-pii@example.invalid', gclid: 'not-collected',
        return_url: 'https://private.example/path?token=not-collected',
      }), { referer: 'https://news.example.com/private/article?email=referrer-pii@example.invalid' });
      assert.deepEqual(views, [{ p_attribution: expected }]);
      await submitBeta(page);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
      assert.equal(views.length, 1);
      const cached = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), cacheKey);
      assert.deepEqual(Object.keys(cached).sort(), ['attribution', 'expiresAt']);
      assert.deepEqual(cached.attribution, expected);
      assert.doesNotMatch(JSON.stringify({ views, signups, cached }), /query-pii|referrer-pii|not-collected|gclid|utm_term|https:\/\//);
    });

    for (const pathname of ['/blabee/', '/blabee/liquid-glass/light/']) {
      await withScenario(browser, results, `Policy round trip preserves attribution on ${pathname}`, {}, async ({ page, views, signups }) => {
        const expected = { ...emptyAttribution, utm_source: 'newsletter', utm_campaign: 'beta-invite' };
        await navigate(page, landingUrl('/blabee/', { utm_source: 'newsletter', utm_campaign: 'beta-invite' }));
        assert.deepEqual(views, [{ p_attribution: expected }]);
        const originalCache = await page.evaluate(key => sessionStorage.getItem(key), cacheKey);
        await Promise.all([
          page.waitForURL(url => url.pathname === '/blabee/policies/'),
          page.locator('[data-beta-form] .policy-form-link').click(),
        ]);
        await page.waitForLoadState('networkidle');
        assert.equal(views.length, 1, 'Policy pages do not record a landing pageview');
        if (pathname === '/blabee/') {
          await Promise.all([
            page.waitForURL(url => url.pathname === '/blabee/' && url.search === ''),
            page.locator('.back-link').click(),
          ]);
          await page.waitForLoadState('networkidle');
        } else {
          await navigate(page, landingUrl(pathname), { referer: page.url() });
        }
        assert.equal(new URL(page.url()).search, '');
        assert.deepEqual(views, [{ p_attribution: expected }, { p_attribution: expected }]);
        assert.equal(await page.evaluate(key => sessionStorage.getItem(key), cacheKey), originalCache);
        await submitBeta(page);
        assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
      });
    }

    await withScenario(browser, results, 'A new campaign replaces the prior campaign in the same tab', {}, async ({ page, views, signups }) => {
      const first = { ...emptyAttribution, utm_source: 'old-source', utm_medium: 'social', utm_campaign: 'old-campaign', utm_content: 'old-post' };
      const next = { ...emptyAttribution, utm_source: 'new-source', utm_campaign: 'new-campaign' };
      await navigate(page, landingUrl('/blabee/', first));
      await navigate(page, landingUrl('/blabee/liquid-glass/light/', { utm_source: 'new-source', utm_campaign: 'new-campaign' }), { referer: page.url() });
      assert.deepEqual(views, [{ p_attribution: first }, { p_attribution: next }]);
      await submitBeta(page);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: next }]);
    });

    await withScenario(browser, results, 'Reload adds exactly one pageview and visibility events do not duplicate it', {}, async ({ page, views, signups }) => {
      const expected = { ...emptyAttribution, utm_source: 'reddit' };
      await navigate(page, landingUrl('/blabee/', { utm_source: 'reddit' }));
      assert.deepEqual(views, [{ p_attribution: expected }]);
      const response = await page.reload({ waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.deepEqual(views, [{ p_attribution: expected }, { p_attribution: expected }]);
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await submitBeta(page);
      assert.equal(views.length, 2);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
    });

    await withScenario(browser, results, 'Failed analytics does not prevent a successful beta request', { failViews: true }, async ({ page, views, signups }) => {
      const expected = { ...emptyAttribution, utm_source: 'newsletter' };
      await navigate(page, landingUrl('/blabee/', { utm_source: 'newsletter' }));
      assert.deepEqual(views, [{ p_attribution: expected }]);
      await submitBeta(page);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
      assert.equal(views.length, 1, 'A failed view is never automatically retried');
    });

    for (const privacySignal of ['gpc', 'navigator-dnt', 'window-dnt']) {
      await withScenario(browser, results, `${privacySignal} disables pageviews and signup attribution`, { privacySignal, seedCache: true }, async ({ page, views, signups }) => {
        await navigate(page, landingUrl('/blabee/', { utm_source: 'must-not-send', utm_campaign: 'private' }));
        assert.deepEqual(views, []);
        const cache = await page.evaluate(key => ({ own: sessionStorage.getItem(key), unrelated: sessionStorage.getItem('unrelated-test-value') }), cacheKey);
        assert.deepEqual(cache, { own: null, unrelated: 'keep' });
        await submitBeta(page);
        assert.deepEqual(signups, [{ p_email: fixtureEmail }]);
        assert.deepEqual(views, []);
      });
    }

    await withScenario(browser, results, 'Blocked sessionStorage still permits UTM attribution and signup', { blockStorage: true }, async ({ page, views, signups }) => {
      const expected = { ...emptyAttribution, utm_source: 'reddit', utm_campaign: 'beta-launch' };
      await navigate(page, landingUrl('/blabee/', { utm_source: 'reddit', utm_campaign: 'beta-launch' }));
      assert.equal(await page.evaluate(() => {
        try { void window.sessionStorage; return false; } catch { return true; }
      }), true);
      assert.deepEqual(views, [{ p_attribution: expected }]);
      await submitBeta(page);
      assert.deepEqual(signups, [{ p_email: fixtureEmail, p_attribution: expected }]);
    });

    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(`${output}/landing-attribution-results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ status: 'PASS', metric: 'pageviews, not unique visitors', results, output }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

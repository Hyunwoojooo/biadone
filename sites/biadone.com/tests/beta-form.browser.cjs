// Optional browser QA. Use an existing Playwright installation; no site dependency.
// All signup requests are intercepted, so this test never stores a real lead.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

const origin = process.env.BASE_URL || 'http://127.0.0.1:8800';
const output = process.env.OUTPUT_DIR || '/tmp/blabee-beta-qa';
const endpoint = 'https://vulnkqyqqbucvbhwjswr.supabase.co/rest/v1/rpc/request_blabee_beta';

(async () => {
  const browser = await chromium.launch({ headless: true });
  await fs.mkdir(output, { recursive: true });
  const results = [];
  try {
    for (const [width, height, pathname] of [
      [1440, 1000, '/blabee/'], [768, 1024, '/blabee/'],
      [390, 844, '/blabee/'], [1440, 1000, '/blabee/liquid-glass/light/']
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], requests = [], badAssets = [], violations = [];
      let acknowledge = false;
      let releaseRequest;
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(origin) && response.status() >= 400) badAssets.push(response.url());
      });
      await page.exposeFunction('recordViolation', uri => violations.push(uri));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', event => window.recordViolation(event.blockedURI));
      });
      await page.route(endpoint, async route => {
        assert.equal(route.request().method(), 'POST');
        requests.push(route.request().postDataJSON());
        if (acknowledge) await new Promise(resolve => { releaseRequest = resolve; });
        await route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ accepted: acknowledge }) });
      });
      const response = await page.goto(origin + pathname, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.ok(response.headers()['content-security-policy'].includes(endpoint));
      const form = page.locator('[data-beta-form]');
      const input = form.locator('input[type=email]');
      const button = form.locator('button[type=submit]');
      await form.scrollIntoViewIfNeeded();
      assert.equal(await form.locator('input').count(), 1);
      assert.equal(await form.locator('fieldset, [name=agent], [name=tool], input[type=radio]').count(), 0);
      assert.doesNotMatch(await form.innerText(), /Which coding|Claude Code|Both/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${output}/form-${width}-${pathname.includes('liquid') ? 'compat' : 'main'}.png` });

      await input.fill('invalid');
      await button.click();
      assert.equal(await input.evaluate(element => element.validity.typeMismatch), true);
      assert.equal(requests.length, 0);

      await input.fill(' Beta.QA+1@Example.invalid ');
      await button.click();
      await form.locator('[data-form-error]').waitFor({ state: 'visible' });
      assert.equal(await form.locator('[data-form-success]').isVisible(), false);
      assert.equal(await input.isEnabled(), true);
      assert.equal(await button.isEnabled(), true);
      assert.deepEqual(requests, [{ p_email: 'beta.qa+1@example.invalid' }]);

      acknowledge = true;
      await button.click();
      await page.waitForFunction(() => document.querySelector('[data-beta-form]').getAttribute('aria-busy') === 'true');
      assert.equal(await input.isDisabled(), true);
      assert.equal(await button.isDisabled(), true);
      assert.equal(await form.locator('[data-form-success]').isVisible(), false);
      await form.evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(requests.length, 2);
      releaseRequest();
      await form.locator('[data-form-success]').waitFor({ state: 'visible' });
      assert.equal(await form.locator('[data-form-error]').isVisible(), false);
      assert.equal(await form.getAttribute('aria-busy'), 'false');
      assert.equal(await button.isDisabled(), true);
      assert.equal(await input.isDisabled(), true);
      assert.deepEqual(requests, Array(2).fill({ p_email: 'beta.qa+1@example.invalid' }));
      assert.deepEqual(errors, []);
      assert.deepEqual(badAssets, []);
      assert.equal(violations.some(uri => uri.includes('supabase.co')), false);
      results.push({ width, pathname, requests: requests.length, errors, badAssets, violations });
      await context.close();
    }
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const page = await noJS.newPage();
    await page.goto(origin + '/blabee/');
    assert.equal(await page.locator('[data-beta-form] button').isDisabled(), true);
    assert.equal(await page.locator('[data-no-js-form-message]').isVisible(), true);
    await noJS.close();
    const mime = await fetch(origin + '/blabee/js/beta-signup.mjs');
    assert.equal(mime.status, 200);
    assert.match(mime.headers.get('content-type'), /javascript/);
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ status: 'PASS', results, screenshots: output }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

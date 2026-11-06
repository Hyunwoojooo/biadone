import assert from "node:assert/strict";
import { test } from "node:test";
import { getCleanLandingPath, getLandingAttribution, recordLandingView } from "../blabee/js/landing-attribution.mjs";

const CACHE_KEY = "blabee.landing-attribution.v1";
const TTL = 30 * 60 * 1000;
const NOW = 1800000000000;
const LANDING = "https://biadone.com/blabee/";
const EMPTY = {
  utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", referrer_host: "",
};
const config = {
  endpoint: "https://example.supabase.co/rest/v1/rpc/record_blabee_landing_view",
  publishableKey: "sb_publishable_test",
};

test("URL cleanup removes all campaign tags while preserving other parameters and the anchor", () => {
  const path = getCleanLandingPath(`${LANDING}?utm_source=reddit&utm_source=x&utm_medium=social&utm_campaign=mac-beta&utm_content=post-01&lang=ko&filter=a%20b#beta`);
  const cleaned = new URL(path, LANDING);
  assert.equal(cleaned.pathname, "/blabee/");
  assert.equal(cleaned.hash, "#beta");
  assert.deepEqual([...cleaned.searchParams], [["lang", "ko"], ["filter", "a b"]]);
  assert.equal(getCleanLandingPath(`${LANDING}?utm_source=#beta`), "/blabee/#beta");
});

test("URL cleanup does nothing for untagged, invalid or non-web URLs", () => {
  for (const url of [LANDING, `${LANDING}?lang=ko#beta`, "not a URL", undefined, "javascript:alert(1)?utm_source=x", "file:///blabee/?utm_source=x"]) {
    assert.equal(getCleanLandingPath(url), null);
  }
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    writes: 0,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { this.writes++; data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test("valid UTMs take precedence and retain only approved lowercase campaign slugs", () => {
  const storage = memoryStorage();
  getLandingAttribution({ url: `${LANDING}?utm_source=old`, storage, now: NOW });
  const attribution = getLandingAttribution({
    url: `${LANDING}?utm_source=%20Reddit%20&utm_medium=SOCIAL&utm_campaign=Mac_Beta-1&utm_content=post.2&utm_term=private&email=person%40example.com#private`,
    referrer: "https://www.reddit.com/r/example?user=private#private",
    storage,
    now: NOW + 10,
  });
  assert.deepEqual(attribution, {
    utm_source: "reddit", utm_medium: "social", utm_campaign: "mac_beta-1", utm_content: "post.2", referrer_host: "www.reddit.com",
  });
  assert.deepEqual(JSON.parse(storage.getItem(CACHE_KEY)), { attribution, expiresAt: NOW + 10 + TTL });
  assert.doesNotMatch(storage.getItem(CACHE_KEY), /private|person|email|utm_term|https:|user=/);
});

test("generic referrals collect only the hostname, never credentials, path or query", () => {
  assert.deepEqual(getLandingAttribution({
    url: LANDING,
    referrer: "https://person:password@News.Example.COM.:8443/private?email=person@example.com#fragment",
  }), { ...EMPTY, referrer_host: "news.example.com" });
});

test("direct or unknown visits return five empty strings without creating a cache", () => {
  const storage = memoryStorage();
  for (const url of [LANDING, `${LANDING}?email=person@example.com&utm_term=private`, "not a URL", undefined]) {
    assert.deepEqual(getLandingAttribution({ url, storage, now: NOW }), EMPTY);
  }
  assert.equal(storage.getItem(CACHE_KEY), null);
  assert.equal(storage.writes, 0);
});

test("PII-shaped, malformed and overlong UTM values are rejected without truncation", () => {
  for (const invalid of ["person@example.com", "hello world", "홍보", "https://example.com", "-start", "a".repeat(81), "private/name", "id=123"]) {
    const url = new URL(LANDING);
    for (const field of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) url.searchParams.set(field, invalid);
    assert.deepEqual(getLandingAttribution({ url: url.href }), EMPTY, invalid);
  }
  assert.deepEqual(getLandingAttribution({ url: `${LANDING}?utm_source=${"a".repeat(80)}` }), { ...EMPTY, utm_source: "a".repeat(80) });
  assert.deepEqual(getLandingAttribution({ url: `${LANDING}?utm_source=person%40example.com&utm_medium=Social` }), { ...EMPTY, utm_medium: "social" });
});

test("referrers reject non-web URLs, private hosts, IPs and the site's own hosts", () => {
  for (const referrer of [
    "", "not a URL", "mailto:person@example.com", "ftp://news.example.com/path",
    "https://127.0.0.1/", "https://192.168.1.2/", "https://2130706433/", "https://0x7f000001/", "https://[::1]/", "https://[2001:db8::1]/",
    "https://localhost/", "https://app.localhost/", "https://server.local/", "https://server.internal/", "https://intranet/", "https://intranet./",
    "https://biadone.com/policies?private", "https://www.biadone.com/", "https://BIADONE.COM./",
    "https://bad_label.example/", "https://-bad.example/", "https://bad-.example/",
    `https://${"a".repeat(64)}.example/`,
    `https://${[63, 63, 63, 62].map((length) => "a".repeat(length)).join(".")}/`,
  ]) {
    assert.deepEqual(getLandingAttribution({ url: LANDING, referrer }), EMPTY, referrer);
  }
  assert.deepEqual(getLandingAttribution({ url: "https://preview.example.com/blabee/", referrer: "https://preview.example.com:8443/policy" }), EMPTY);
  const longestHost = [63, 63, 63, 61].map((length) => "a".repeat(length)).join(".");
  assert.deepEqual(getLandingAttribution({ url: LANDING, referrer: `https://${longestHost}/` }), { ...EMPTY, referrer_host: longestHost });
});

test("same-tab policy and alternate landing returns preserve attribution without extending expiry", () => {
  const storage = memoryStorage();
  const original = getLandingAttribution({ url: `${LANDING}?utm_source=reddit&utm_campaign=launch`, storage, now: NOW });
  const cached = storage.getItem(CACHE_KEY);
  for (const [url, referrer, now] of [
    ["https://biadone.com/blabee/policies/privacy.html", LANDING, NOW + 1000],
    ["https://biadone.com/blabee/liquid-glass/light/", "https://biadone.com/blabee/policies/privacy.html", NOW + 2000],
    [LANDING, "", NOW + TTL - 1],
  ]) {
    assert.deepEqual(getLandingAttribution({ url, referrer, storage, now }), original);
  }
  assert.equal(storage.writes, 1);
  assert.equal(storage.getItem(CACHE_KEY), cached);
});

test("a new campaign or external referral replaces the prior source and renews its expiry", () => {
  const storage = memoryStorage();
  getLandingAttribution({ url: `${LANDING}?utm_source=old&utm_campaign=old`, storage, now: NOW });
  const next = getLandingAttribution({ url: `${LANDING}?utm_content=new-post`, storage, now: NOW + 1000 });
  assert.deepEqual(next, { ...EMPTY, utm_content: "new-post" });
  assert.equal(JSON.parse(storage.getItem(CACHE_KEY)).expiresAt, NOW + 1000 + TTL);
  const referral = getLandingAttribution({ url: LANDING, referrer: "https://news.ycombinator.com/item?id=123", storage, now: NOW + 2000 });
  assert.deepEqual(referral, { ...EMPTY, referrer_host: "news.ycombinator.com" });
  assert.equal(JSON.parse(storage.getItem(CACHE_KEY)).expiresAt, NOW + 2000 + TTL);
});

test("reload and history restoration preserve valid UTM cache despite the original external referrer", () => {
  const storage = memoryStorage();
  const referrer = "https://www.reddit.com/r/example";
  const original = getLandingAttribution({ url: `${LANDING}?utm_source=reddit&utm_campaign=mac-beta`, referrer, storage, now: NOW });
  const cached = storage.getItem(CACHE_KEY);
  for (const navigationType of ["reload", "back_forward"]) {
    assert.deepEqual(getLandingAttribution({ url: LANDING, referrer, storage, now: NOW + 1000, navigationType }), original);
    assert.equal(storage.getItem(CACHE_KEY), cached, "Restoration does not extend the cache expiry");
  }
  assert.deepEqual(getLandingAttribution({ url: `${LANDING}?utm_source=x`, referrer, storage, now: NOW + 2000, navigationType: "reload" }), { ...EMPTY, utm_source: "x", referrer_host: "www.reddit.com" });
  assert.deepEqual(getLandingAttribution({ url: LANDING, referrer, storage, now: NOW + 2000 + TTL, navigationType: "reload" }), { ...EMPTY, referrer_host: "www.reddit.com" });
});

test("expired and implausibly future cache entries are discarded", () => {
  for (const expiresAt of [NOW - 1, NOW, NOW + TTL + 1, "tomorrow", null]) {
    const storage = memoryStorage({ [CACHE_KEY]: JSON.stringify({ attribution: { ...EMPTY, utm_source: "reddit" }, expiresAt }) });
    assert.deepEqual(getLandingAttribution({ url: LANDING, storage, now: NOW }), EMPTY);
    assert.equal(storage.getItem(CACHE_KEY), null);
  }
});

test("corrupt or tampered cache entries cannot introduce extra fields, PII or invalid hosts", () => {
  const valid = { attribution: { ...EMPTY, utm_source: "reddit" }, expiresAt: NOW + TTL };
  const invalidValues = [
    "not JSON", "null", "[]", "{}",
    JSON.stringify({ ...valid, visitor_id: "private" }),
    JSON.stringify({ ...valid, attribution: { ...valid.attribution, email: "person@example.com" } }),
    JSON.stringify({ ...valid, attribution: { utm_source: "reddit" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, utm_source: "person@example.com" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, utm_source: 123 } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "https://example.com/private" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "127.0.0.1" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "127.1" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "2130706433" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "0x7f000001" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "intranet" } }),
    JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "biadone.com" } }),
    JSON.stringify({ ...valid, attribution: EMPTY }),
  ];
  for (const raw of invalidValues) {
    const storage = memoryStorage({ [CACHE_KEY]: raw, unrelated: "keep" });
    assert.deepEqual(getLandingAttribution({ url: LANDING, storage, now: NOW }), EMPTY);
    assert.equal(storage.getItem(CACHE_KEY), null);
    assert.equal(storage.getItem("unrelated"), "keep");
  }
  const storage = memoryStorage({ [CACHE_KEY]: JSON.stringify({ ...valid, attribution: { ...EMPTY, referrer_host: "preview.example.com" } }) });
  assert.deepEqual(getLandingAttribution({ url: "https://preview.example.com/", storage, now: NOW }), EMPTY);
});

test("blocked storage never prevents fresh attribution, direct visits or opt-out", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(getLandingAttribution({ url: `${LANDING}?utm_source=reddit`, storage: blocked, now: NOW }), { ...EMPTY, utm_source: "reddit" });
  assert.deepEqual(getLandingAttribution({ url: LANDING, storage: blocked, now: NOW }), EMPTY);
  assert.equal(getLandingAttribution({ url: `${LANDING}?utm_source=reddit`, storage: blocked, privacyEnabled: true }), null);
});

test("opt-out returns null and removes only this module's session cache", () => {
  const storage = memoryStorage({ unrelated: "keep" });
  getLandingAttribution({ url: `${LANDING}?utm_source=reddit`, storage, now: NOW });
  assert.equal(getLandingAttribution({ url: `${LANDING}?utm_source=new`, referrer: "https://example.com/", storage, privacyEnabled: true }), null);
  assert.equal(storage.getItem(CACHE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(storage.writes, 1);
});

test("recording sends exactly one public-key POST with only sanitized attribution", async () => {
  const calls = [];
  const attribution = getLandingAttribution({ url: `${LANDING}?utm_source=reddit` });
  await recordLandingView(attribution, {
    ...config,
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response('{"accepted":true}');
    },
  });
  assert.equal(calls.length, 1);
  const [endpoint, options] = calls[0];
  assert.equal(endpoint, config.endpoint);
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.deepEqual(options.headers, { "Content-Type": "application/json", apikey: config.publishableKey });
  assert.deepEqual(JSON.parse(options.body), { p_attribution: attribution });
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
});

test("null attribution is a no-op even without configuration", async () => {
  await recordLandingView(null);
  await recordLandingView(null, { fetchImpl: () => assert.fail("opt-out must not send a request") });
});

test("invalid configuration and unsanitized attribution never reach the network", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; };
  for (const invalid of [
    { endpoint: "http://example.com/rpc" },
    { endpoint: "https://" },
    { endpoint: "https://person:password@example.com/rpc" },
    { publishableKey: "sb_secret_not_allowed" },
    { publishableKey: "sb_publishable_" },
    { publishableKey: "sb_publishable_with spaces" },
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
  ]) {
    await assert.rejects(recordLandingView(EMPTY, { ...config, ...invalid, fetchImpl }));
  }
  for (const attribution of [undefined, {}, { ...EMPTY, email: "person@example.com" }, { ...EMPTY, utm_source: "person@example.com" }]) {
    await assert.rejects(recordLandingView(attribution, { ...config, fetchImpl }));
  }
  assert.equal(calls, 0);
});

test("only a successful HTTP response with accepted true confirms a view; failures are not retried", async () => {
  for (const response of [
    new Response('{"accepted":true}', { status: 500 }),
    new Response('{"accepted":false}'),
    new Response('{"accepted":"true"}'),
    new Response('{}'),
    new Response('null'),
    new Response('<html>Not an API</html>'),
    new Response(null, { status: 204 }),
  ]) {
    let calls = 0;
    await assert.rejects(recordLandingView(EMPTY, { ...config, fetchImpl: async () => { calls++; return response; } }));
    assert.equal(calls, 1);
  }
  let networkCalls = 0;
  await assert.rejects(recordLandingView(EMPTY, { ...config, fetchImpl: async () => { networkCalls++; throw new Error("network failed"); } }), /network failed/);
  assert.equal(networkCalls, 1);
});

test("a hung view request aborts after its timeout without retrying", async () => {
  let calls = 0;
  let signal;
  await assert.rejects(recordLandingView(EMPTY, {
    ...config,
    timeoutMs: 5,
    fetchImpl: (_url, options) => {
      calls++;
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

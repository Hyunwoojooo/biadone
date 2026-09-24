import assert from "node:assert/strict";
import { test } from "node:test";
import { requestBetaAccess } from "../blabee/js/beta-signup.mjs";

const config = {
  endpoint: "https://example.supabase.co/rest/v1/rpc/request_blabee_beta",
  publishableKey: "sb_publishable_test",
};

test("sends only a normalized email and the public API key", async () => {
  let call;
  await requestBetaAccess("  Tester+Beta@Example.com  ", {
    ...config,
    fetchImpl: async (...args) => {
      call = args;
      return new Response('{"accepted":true}', { status: 200 });
    },
  });
  assert.equal(call[0], config.endpoint);
  assert.deepEqual(JSON.parse(call[1].body), { p_email: "tester+beta@example.com" });
  assert.equal(call[1].method, "POST");
  assert.equal(call[1].credentials, "omit");
  assert.equal(call[1].referrerPolicy, "no-referrer");
  assert.deepEqual(call[1].headers, {
    "Content-Type": "application/json", apikey: config.publishableKey,
  });
});

test("only an explicit successful acknowledgement counts as saved", async () => {
  for (const response of [
    new Response('{"accepted":true}', { status: 500 }),
    new Response('{"accepted":false}'),
    new Response('{}'),
    new Response('null'),
    new Response('<html>Static fallback</html>'),
    new Response(null, { status: 204 }),
  ]) {
    await assert.rejects(requestBetaAccess("test@example.com", {
      ...config, fetchImpl: async () => response,
    }));
  }
});

test("invalid configuration or empty/overlong input never sends a request", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; };
  for (const email of ["", "  ", null, "a".repeat(255)]) {
    await assert.rejects(requestBetaAccess(email, { ...config, fetchImpl }));
  }
  for (const badConfig of [
    { ...config, endpoint: "http://example.com" },
    { ...config, publishableKey: "sb_secret_not_allowed" },
    { ...config, publishableKey: "" },
  ]) {
    await assert.rejects(requestBetaAccess("test@example.com", { ...badConfig, fetchImpl }));
  }
  assert.equal(calls, 0);
});

test("a hung request times out and a later retry can succeed", async () => {
  await assert.rejects(requestBetaAccess("test@example.com", {
    ...config,
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  }), { name: "AbortError" });
  await requestBetaAccess("test@example.com", {
    ...config, fetchImpl: async () => new Response('{"accepted":true}'),
  });
});

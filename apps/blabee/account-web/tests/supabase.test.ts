import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthOptions } from "../src/supabase.ts";

const config = {
  url: "https://project.example.com",
  publishableKey: "sb_publishable_example-not-a-real-key",
};

test("provider settings are fetched only on demand with the public key and no cache", async (context) => {
  const controller = new AbortController();
  const timeouts: number[] = [];
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    timeouts.push(milliseconds);
    return controller.signal;
  });
  const calls: { input: Parameters<typeof fetch>[0]; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return Response.json({ external: { google: true, github: false } });
  };
  const options = createOAuthOptions(config, () => {}, fetcher);
  assert.equal(options.authorizeUrl, "https://project.example.com/auth/v1/authorize");
  assert.equal(calls.length, 0);
  assert.equal(await options.isProviderEnabled("google"), true);
  assert.equal(await options.isProviderEnabled("github"), false);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(String(call.input), "https://project.example.com/auth/v1/settings");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.signal, controller.signal);
    assert.deepEqual([...new Headers(call.init?.headers)], [["apikey", config.publishableKey]]);
    assert.equal(call.init?.body, undefined);
  }
  assert.deepEqual(timeouts, [10_000, 10_000]);
});

test("provider availability is refreshed on the next attempt instead of retaining an old result", async () => {
  let enabled = false;
  const fetcher: typeof fetch = async () => Response.json({ external: { google: enabled, github: false } });
  const options = createOAuthOptions(config, () => {}, fetcher);
  assert.equal(await options.isProviderEnabled("google"), false);
  enabled = true;
  assert.equal(await options.isProviderEnabled("google"), true);
});

for (const status of [401, 429, 503]) {
  test(`an unsuccessful settings response (${status}) is rejected despite an enabled flag`, async () => {
    const fetcher: typeof fetch = async () => Response.json({ external: { google: true } }, { status });
    const options = createOAuthOptions(config, () => {}, fetcher);
    await assert.rejects(options.isProviderEnabled("google"));
  });
}

test("malformed settings and non-boolean flags are rejected", async () => {
  for (const settings of [
    null,
    [],
    {},
    { external: null },
    { external: [] },
    { external: {} },
    { external: { github: true } },
    { external: { google: "true" } },
    { external: { google: 1 } },
    { external: { google: null } },
  ]) {
    const fetcher: typeof fetch = async () => Response.json(settings);
    const options = createOAuthOptions(config, () => {}, fetcher);
    await assert.rejects(options.isProviderEnabled("google"), JSON.stringify(settings));
  }
});

test("invalid JSON from the settings endpoint is rejected", async () => {
  const fetcher: typeof fetch = async () => new Response("not JSON", { status: 200 });
  const options = createOAuthOptions(config, () => {}, fetcher);
  await assert.rejects(options.isProviderEnabled("github"));
});

test("a settings network failure propagates to the controller's recoverable error path", async () => {
  const fetcher: typeof fetch = async () => { throw new Error("network unavailable"); };
  const options = createOAuthOptions(config, () => {}, fetcher);
  await assert.rejects(options.isProviderEnabled("google"), /network unavailable/);
});

test("the settings request observes timeout cancellation without real network traffic", async (context) => {
  const timeout = new AbortController();
  context.mock.method(AbortSignal, "timeout", () => timeout.signal);
  const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const options = createOAuthOptions(config, () => {}, fetcher);
  const pending = options.isProviderEnabled("google");
  timeout.abort(new DOMException("The operation timed out", "TimeoutError"));
  await assert.rejects(pending, { name: "TimeoutError" });
});

test("the navigation dependency is preserved without navigating during setup", () => {
  const navigations: string[] = [];
  const navigate = (url: string) => navigations.push(url);
  const fetcher: typeof fetch = async () => { throw new Error("Unexpected network request"); };
  const options = createOAuthOptions(config, navigate, fetcher);
  assert.equal(options.navigate, navigate);
  assert.deepEqual(navigations, []);
});

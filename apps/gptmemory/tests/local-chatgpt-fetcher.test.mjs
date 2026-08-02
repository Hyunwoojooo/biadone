import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalChatGPTFetcherHandler,
  startLocalChatGPTFetcher,
} from "../tools/local-chatgpt-fetcher.mjs";

const SECRET = "local-fetcher-test-secret";
const ENDPOINT = "http://127.0.0.1/fetch-chatgpt-share";
const SHARE_URL = "https://chatgpt.com/share/test-share-id";

test("local ChatGPT fetcher rejects unsafe startup configuration", async () => {
  await assert.rejects(
    startLocalChatGPTFetcher({ secret: "" }),
    /secret is required/,
  );
  await assert.rejects(
    startLocalChatGPTFetcher({ host: "0.0.0.0", secret: SECRET }),
    /loopback/,
  );
});

test("startLocalChatGPTFetcher binds to loopback and exposes closed", async (t) => {
  let bridge;
  try {
    bridge = await startLocalChatGPTFetcher({
      secret: SECRET,
      fetchImpl: async () => htmlResponse("<html>unused</html>"),
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("This sandbox prohibits loopback TCP listeners.");
      return;
    }
    throw error;
  }

  assert.match(
    bridge.url,
    /^http:\/\/127\.0\.0\.1:\d+\/fetch-chatgpt-share$/,
  );
  assert.equal(bridge.closed instanceof Promise, true);
  await bridge.close();
  await bridge.closed;
  await bridge.close();
});

test("handler enforces authentication and share-only SSRF protection", async () => {
  let upstreamCalls = 0;
  const handler = createHandler(async () => {
    upstreamCalls += 1;
    return htmlResponse("<html>unused</html>");
  });

  const missingAuth = await handler(
    jsonRequest({ url: SHARE_URL }, { authorization: null }),
  );
  assert.equal(missingAuth.status, 401);

  const wrongAuth = await post(handler, { url: SHARE_URL }, "wrong");
  assert.equal(wrongAuth.response.status, 401);

  const wrongMethod = await handler(
    new Request(ENDPOINT, {
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");

  const wrongContentType = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "text/plain",
      },
      body: JSON.stringify({ url: SHARE_URL }),
    }),
  );
  assert.equal(wrongContentType.status, 415);

  const oversized = await handler(
    jsonRequest({ url: SHARE_URL, padding: "x".repeat(5_000) }),
  );
  assert.equal(oversized.status, 413);

  const invalidUrls = [
    "http://chatgpt.com/share/test-share-id",
    "https://example.com/share/test-share-id",
    "https://chatgpt.com/share/test-share-id/nested",
    "https://chatgpt.com/share/test-share-id?next=https://example.com",
    "https://user:pass@chatgpt.com/share/test-share-id",
  ];
  for (const url of invalidUrls) {
    const result = await post(handler, { url });
    assert.equal(result.response.status, 400, url);
    assert.equal(result.payload.error.code, "INVALID_SHARE_URL", url);
  }
  assert.equal(upstreamCalls, 0);
});

test("manual redirects require the same exact share target and have a hop cap", async () => {
  let cancelled = 0;
  let upstream = async () =>
    redirectResponse("https://example.com/private", () => {
      cancelled += 1;
    });
  const handler = createHandler((...args) => upstream(...args));

  const unsafeHost = await post(handler, { url: SHARE_URL });
  assert.equal(unsafeHost.response.status, 502);
  assert.equal(unsafeHost.payload.error.code, "UNSAFE_REDIRECT");
  assert.equal(cancelled, 1);

  upstream = async () =>
    htmlResponse(
      "<html>wrong</html>",
      "https://chatgpt.com/share/different-share-id",
    );
  const wrongFinalId = await post(handler, { url: SHARE_URL });
  assert.equal(wrongFinalId.response.status, 502);
  assert.equal(wrongFinalId.payload.error.code, "UNSAFE_REDIRECT");

  let validHop = 0;
  upstream = async () => {
    validHop += 1;
    return validHop === 1
      ? redirectResponse(`${SHARE_URL}/`)
      : htmlResponse("<html>redirected</html>");
  };
  const sameId = await post(handler, { url: SHARE_URL });
  assert.equal(sameId.response.status, 200);
  assert.equal(sameId.payload.finalUrl, SHARE_URL);
  assert.equal(validHop, 2);

  let loopCalls = 0;
  upstream = async () => {
    loopCalls += 1;
    return redirectResponse(`${SHARE_URL}/`);
  };
  const loop = await post(handler, { url: SHARE_URL });
  assert.equal(loop.response.status, 502);
  assert.equal(loop.payload.error.code, "TOO_MANY_REDIRECTS");
  assert.equal(loopCalls, 6);
});

test("content type, streaming size, and full-body timeout are enforced", async () => {
  let upstream = async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const handler = createHandler((...args) => upstream(...args));

  const wrongType = await post(handler, { url: SHARE_URL });
  assert.equal(wrongType.response.status, 502);
  assert.equal(wrongType.payload.error.code, "UPSTREAM_NOT_HTML");

  let sizeCancelled = false;
  upstream = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(20)));
          controller.enqueue(new TextEncoder().encode("y".repeat(20)));
        },
        cancel() {
          sizeCancelled = true;
        },
      }),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  const tooLarge = await post(handler, { url: SHARE_URL });
  assert.equal(tooLarge.response.status, 413);
  assert.equal(tooLarge.payload.error.code, "UPSTREAM_TOO_LARGE");
  assert.equal(sizeCancelled, true);

  upstream = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init.signal.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      }),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  const timedOut = await post(handler, { url: SHARE_URL });
  assert.equal(timedOut.response.status, 504);
  assert.equal(timedOut.payload.error.code, "UPSTREAM_TIMEOUT");
});

test("upstream errors are drained and success uses the compatible envelope", async () => {
  let statusCancelled = false;
  let upstream = async () =>
    new Response(
      new ReadableStream({
        cancel() {
          statusCancelled = true;
        },
      }),
      { status: 429, headers: { "content-type": "text/html" } },
    );
  const handler = createHandler((...args) => upstream(...args));

  const limited = await post(handler, { url: SHARE_URL });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.ok, false);
  assert.equal(limited.payload.status, 429);
  assert.equal("html" in limited.payload, false);
  assert.equal(statusCancelled, true);

  let observedUrl;
  let observedInit;
  upstream = async (url, init) => {
    observedUrl = url;
    observedInit = init;
    return htmlResponse("<html>safe</html>");
  };
  const result = await post(handler, { url: SHARE_URL });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, {
    ok: true,
    status: 200,
    finalUrl: SHARE_URL,
    contentType: "text/html; charset=utf-8",
    html: "<html>safe</html>",
  });
  assert.equal(observedUrl, SHARE_URL);
  assert.equal(observedInit.redirect, "manual");
  assert.equal(observedInit.signal instanceof AbortSignal, true);
});

function createHandler(fetchImpl) {
  return createLocalChatGPTFetcherHandler({
    secret: SECRET,
    fetchImpl,
    timeoutMs: 25,
    maxBodyBytes: 32,
  });
}

async function post(handler, body, secret = SECRET) {
  const response = await handler(jsonRequest(body, { secret }));
  return { response, payload: await response.json() };
}

function jsonRequest(body, { secret = SECRET, authorization } = {}) {
  const auth = authorization === null ? null : authorization ?? `Bearer ${secret}`;
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function htmlResponse(html, url = SHARE_URL) {
  const response = new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function redirectResponse(location, onCancel = () => undefined) {
  return new Response(
    new ReadableStream({
      cancel: onCancel,
    }),
    { status: 302, headers: { location } },
  );
}

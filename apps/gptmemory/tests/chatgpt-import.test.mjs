import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatGPTImportError,
  fetchShareHtml,
  importChatGPTShareUrl,
  validateShareUrl,
} from "../lib/chatgpt/index.ts";

test("only accepts public chatgpt.com share URLs and normalizes query strings", () => {
  assert.deepEqual(
    validateShareUrl(
      "https://chatgpt.com/share/6a4a1f03-7a88-83ee-860e-4389fc6fea67?utm_source=test",
    ),
    {
      valid: true,
      originalUrl:
        "https://chatgpt.com/share/6a4a1f03-7a88-83ee-860e-4389fc6fea67?utm_source=test",
      normalizedUrl:
        "https://chatgpt.com/share/6a4a1f03-7a88-83ee-860e-4389fc6fea67",
      shareId: "6a4a1f03-7a88-83ee-860e-4389fc6fea67",
    },
  );

  for (const invalidUrl of [
    "http://chatgpt.com/share/abc",
    "https://chat.openai.com/share/abc",
    "https://chatgpt.com/c/abc",
    "https://chatgpt.com/share/abc/extra",
    "https://chatgpt.com/share/abc%2Fdef",
  ]) {
    assert.equal(validateShareUrl(invalidUrl).valid, false, invalidUrl);
  }
});

test("restores an ordered user/assistant conversation from a share payload", async () => {
  const html = enqueueFixture({
    title: "대화 맥락 노트",
    _1: {
      author: { role: "user" },
      id: "u1",
      create_time: 1_717_219_067.363,
      content: { content_type: "text", parts: ["첫 질문"] },
    },
    _2: {
      author: { role: "tool" },
      id: "tool1",
      content: { content_type: "text", parts: ["숨길 도구 결과"] },
    },
    _3: {
      author: { role: "assistant" },
      id: "a1",
      content: { content_type: "text", parts: ["첫 답변"] },
    },
    linear_conversation: [
      { message: "_1" },
      { message: "_2" },
      { message: "_3" },
    ],
  });

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/fixture",
    fetchHtml: async () => html,
  });

  assert.equal(result.conversation.title, "대화 맥락 노트");
  assert.deepEqual(
    result.conversation.messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "첫 질문" },
      { role: "assistant", text: "첫 답변" },
    ],
  );
  assert.equal(
    result.conversation.messages[0].createdAt,
    "2024-06-01T05:17:47.363Z",
  );
  assert.equal(result.source.normalizedUrl, "https://chatgpt.com/share/fixture");
});

test("restores messages embedded in React Flight row strings", async () => {
  const flightRow = `66:${JSON.stringify({
    _1: {
      author: { role: "user" },
      id: "u1",
      content: { parts: ["Flight 사용자 메시지"] },
    },
    _2: {
      author: { role: "assistant" },
      id: "a1",
      content: { parts: ["Flight 답변 메시지"] },
    },
    linear_conversation: [{ message: "_1" }, { message: "_2" }],
  })}`;

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/flight-row",
    fetchHtml: async () => enqueueFixture([flightRow, "P67:[{}]"]),
  });

  assert.deepEqual(
    result.conversation.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.match(result.conversation.messages[0].text, /Flight 사용자/);
});

test("restores messages from a flat React Flight table", async () => {
  const table = [
    "id",
    "author",
    "role",
    "content",
    "content_type",
    "parts",
    "user",
    "assistant",
    "text",
    "flat user",
    "flat assistant",
    { _0: 9, _1: 13, _3: 15 },
    { _0: 10, _1: 14, _3: 16 },
    { _2: 6 },
    { _2: 7 },
    { _4: 8, _5: [9] },
    { _4: 8, _5: [10] },
    "linear_conversation",
    [11, 12],
  ];

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/flat-table",
    fetchHtml: async () => enqueueFixture(table),
  });

  assert.deepEqual(
    result.conversation.messages.map((message) => message.text),
    ["flat user", "flat assistant"],
  );
});

test("enforces the fetched response body limit before parsing", async () => {
  await assert.rejects(
    fetchShareHtml({
      url: "https://chatgpt.com/share/too-large",
      maxBodyBytes: 4,
      fetchImpl: async () =>
        new Response("12345", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    }),
    (error) =>
      error instanceof ChatGPTImportError &&
      error.code === "SHARE_RESPONSE_TOO_LARGE",
  );
});

test("times out a stalled share fetch with a stable error code", async () => {
  await assert.rejects(
    fetchShareHtml({
      url: "https://chatgpt.com/share/timeout",
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        await new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    }),
    (error) =>
      error instanceof ChatGPTImportError &&
      error.code === "SHARE_FETCH_TIMEOUT",
  );
});

test("returns a payload-change error instead of accepting arbitrary HTML", async () => {
  await assert.rejects(
    importChatGPTShareUrl({
      url: "https://chatgpt.com/share/no-payload",
      fetchHtml: async () => "<!doctype html><title>ChatGPT</title>",
    }),
    (error) =>
      error instanceof ChatGPTImportError &&
      error.code === "CHATGPT_PAYLOAD_CHANGED",
  );
});

function enqueueFixture(payload) {
  const encodedPayload = JSON.stringify(JSON.stringify(payload));
  return `<!doctype html><script>window.__reactRouterContext.streamController.enqueue(${encodedPayload});</script>`;
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatGPTImportError,
  fetchShareHtml,
  importChatGPTShareUrl,
  validateShareUrl,
} from "../lib/chatgpt/index.ts";
import { createConversationNote } from "../lib/note-engine/index.ts";

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

test("materializes a production-shaped Flight conversation before reading its title", async () => {
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
    "실제 질문",
    "실제 답변",
    { _0: 9, _1: 13, _3: 15 },
    { _0: 10, _1: 14, _3: 16 },
    { _2: 6 },
    { _2: 7 },
    { _4: 8, _5: [9] },
    { _4: 8, _5: [10] },
    "linear_conversation",
    [11, 30, 12],
    "정확한 대화 제목",
    "title",
    "create_time",
    1_717_219_067.363,
    { _17: 18, _20: 19, _21: 22 },
    "recipient",
    "web.run",
    "code",
    '{"search_query":[{"q":"flat internal"}]}',
    { _2: 7 },
    { _4: 26, _8: 27 },
    { _0: 31, _1: 28, _3: 29, _24: 25 },
    "tool-call-id",
  ];

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/flight-title",
    fetchHtml: async () => enqueueFixture(table),
  });

  assert.equal(result.conversation.title, "정확한 대화 제목");
  assert.equal(result.diagnostics.titleSource, "payload");
  assert.deepEqual(
    result.conversation.messages.map((message) => message.sourceIndex),
    [1, 3],
  );
  assert.equal(result.diagnostics.omittedInternalCount, 1);
  assert.equal(
    result.warnings.some((warning) => warning.code === "TITLE_FALLBACK_USED"),
    false,
  );
});

test("rejects schema tokens as titles and falls back to the first user message", async () => {
  const html = enqueueFixture({
    title: "create_time",
    linear_conversation: [
      {
        id: "u1",
        author: { role: "user" },
        content: { content_type: "text", parts: ["첫 질문으로 만든 제목"] },
      },
      {
        id: "a1",
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["답변"] },
      },
    ],
  }).replace("</script>", "</script><title>ChatGPT</title>");

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/title-fallback",
    fetchHtml: async () => html,
  });

  assert.equal(result.conversation.title, "첫 질문으로 만든 제목");
  assert.equal(result.diagnostics.titleSource, "first_user_message");
  assert.ok(
    result.warnings.some((warning) => warning.code === "TITLE_FALLBACK_USED"),
  );
});

test("accepts a safe title from the direct parent of a conversation record", async () => {
  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/parent-title",
    fetchHtml: async () =>
      enqueueFixture({
        title: "부모 객체의 대화 제목",
        conversation: {
          linear_conversation: [
            {
              id: "u1",
              author: { role: "user" },
              content: { content_type: "text", parts: ["질문"] },
            },
            {
              id: "a1",
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["답변"] },
            },
          ],
        },
      }),
  });

  assert.equal(result.conversation.title, "부모 객체의 대화 제목");
  assert.equal(result.diagnostics.titleSource, "payload");
});

test("omits internal assistant calls while retaining visible JSON and source indexes", async () => {
  const messages = [
    {
      id: "u1",
      author: { role: "user" },
      content: { content_type: "text", parts: ["조사해 줘"] },
    },
    {
      id: "internal-search",
      author: { role: "assistant" },
      recipient: "web.run",
      channel: "commentary",
      content: {
        content_type: "code",
        language: "json",
        text: '{"search_query":[{"q":"내부 검색"}]}',
      },
    },
    {
      id: "visible-json",
      author: { role: "assistant" },
      recipient: "all",
      channel: "final",
      content: { content_type: "text", parts: ['{"answer":42}'] },
    },
    {
      id: "visible-tool-schema",
      author: { role: "assistant" },
      recipient: "all",
      channel: "final",
      content: {
        content_type: "text",
        parts: ['{"search_query":[{"q":"사용자에게 보여 준 예시"}]}'],
      },
    },
    {
      id: "u2",
      author: { role: "user" },
      content: {
        content_type: "text",
        parts: ['{"search_query":[{"q":"사용자 입력"}]}'],
      },
    },
    {
      id: "hidden",
      author: { role: "assistant" },
      recipient: "all",
      metadata: { is_visually_hidden_from_conversation: true },
      content: { content_type: "text", parts: ["숨겨진 내부 상태"] },
    },
    {
      id: "visible-code-json",
      author: { role: "assistant" },
      recipient: "all",
      content: {
        content_type: "code",
        parts: ['{"open":[{"ref_id":"사용자에게 보인 코드 예시"}]}'],
      },
    },
    {
      id: "thoughts",
      author: { role: "assistant" },
      recipient: "all",
      content: { content_type: "thoughts", thoughts: ["내부 추론"] },
    },
    {
      id: "model-context",
      author: { role: "assistant" },
      recipient: "all",
      content: {
        content_type: "model_editable_context",
        model_set_context: "내부 컨텍스트",
      },
    },
    {
      id: "reasoning-recap",
      author: { role: "assistant" },
      recipient: "all",
      content: { content_type: "reasoning_recap", content: "내부 요약" },
    },
    {
      id: "final",
      author: { role: "assistant" },
      recipient: "all",
      channel: "commentary",
      content: { content_type: "text", parts: ["사용자에게 보인 답변"] },
    },
  ];

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/sanitized",
    fetchHtml: async () =>
      enqueueFixture({ title: "정제 테스트", linear_conversation: messages }),
  });

  assert.deepEqual(
    result.conversation.messages.map((message) => message.text),
    [
      "조사해 줘",
      '{"answer":42}',
      '{"search_query":[{"q":"사용자에게 보여 준 예시"}]}',
      '{"search_query":[{"q":"사용자 입력"}]}',
      '{"open":[{"ref_id":"사용자에게 보인 코드 예시"}]}',
      "사용자에게 보인 답변",
    ],
  );
  assert.deepEqual(
    result.conversation.messages.map((message) => message.sourceIndex),
    [1, 3, 4, 5, 7, 8],
  );
  assert.deepEqual(
    result.conversation.messages.map((message) => message.index),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    result.conversation.messages
      .filter(
        (message) =>
          message.sourceIndex !== null && message.sourceIndex <= 5,
      )
      .map((message) => message.text),
    [
      "조사해 줘",
      '{"answer":42}',
      '{"search_query":[{"q":"사용자에게 보여 준 예시"}]}',
      '{"search_query":[{"q":"사용자 입력"}]}',
    ],
  );
  assert.equal(result.diagnostics.sourceMessageCount, 8);
  assert.equal(result.diagnostics.noteMessageCount, 6);
  assert.equal(result.diagnostics.omittedInternalCount, 5);
  assert.equal(result.diagnostics.unsupportedContentCount, 0);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "INTERNAL_MESSAGES_OMITTED",
    ),
  );
});

test("preserves confirmed image and file results as deduplicated safe events", async () => {
  const imageResult = {
    id: "image-result-1",
    author: { role: "tool", name: "image_gen" },
    metadata: { image_gen_title: "Blabase 구조도" },
    content: {
      content_type: "multimodal_text",
      parts: [
        {
          content_type: "image_asset_pointer",
          asset_pointer: "file-service://private-image-asset",
          mime_type: "image/png",
        },
      ],
    },
  };
  const messages = [
    {
      id: "u1",
      author: { role: "user" },
      content: { content_type: "text", parts: ["구조도를 만들어 줘"] },
    },
    {
      id: "image-call",
      author: { role: "assistant" },
      recipient: "t2uay3k.sj1i4kz",
      content: {
        content_type: "code",
        language: "json",
        text: '{"prompt":"내부 프롬프트"}',
      },
    },
    imageResult,
    { ...imageResult, id: "image-result-visible-duplicate" },
    {
      ...imageResult,
      id: "image-result-duplicate",
      metadata: {
        ...imageResult.metadata,
        is_visually_hidden_from_conversation: true,
      },
    },
    {
      id: "image-result-without-generation-metadata",
      author: { role: "tool", name: "unknown_image_tool" },
      content: {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "image_asset_pointer",
            asset_pointer: "file-service://unconfirmed-image-asset",
            mime_type: "image/png",
          },
        ],
      },
    },
    {
      id: "file-result",
      author: { role: "tool", name: "python" },
      content: {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "file_asset_pointer",
            file_id: "file-1",
            file_name: "/mnt/data/report.md",
            sandbox_path: "/mnt/data/report.md",
          },
          {
            content_type: "file_asset_pointer",
            file_id: "file-2",
            file_name: "/mnt/data/unsafe]\n# injected.txt",
            sandbox_path: "/mnt/data/unsafe-file-2",
          },
        ],
      },
    },
    {
      id: "a1",
      author: { role: "assistant" },
      recipient: "all",
      metadata: {
        attachments: [
          {
            file_id: "input-attachment",
            file_name: "source.pdf",
            sandbox_path: "/mnt/data/source.pdf",
          },
        ],
      },
      content: { content_type: "text", parts: ["완료했습니다."] },
    },
  ];

  const result = await importChatGPTShareUrl({
    url: "https://chatgpt.com/share/artifacts",
    fetchHtml: async () =>
      enqueueFixture({ title: "결과 이벤트", linear_conversation: messages }),
  });

  assert.deepEqual(
    result.conversation.messages.map(({ kind, eventType, text }) => ({
      kind,
      eventType,
      text,
    })),
    [
      { kind: "text", eventType: undefined, text: "구조도를 만들어 줘" },
      {
        kind: "event",
        eventType: "image_generated",
        text: "[생성된 이미지: Blabase 구조도]",
      },
      {
        kind: "event",
        eventType: "file_created",
        text: "[생성된 파일: report.md]",
      },
      {
        kind: "event",
        eventType: "file_created",
        text: "[생성된 파일: unsafe) # injected.txt]",
      },
      { kind: "text", eventType: undefined, text: "완료했습니다." },
    ],
  );
  assert.equal(result.diagnostics.sourceMessageCount, 3);
  assert.equal(result.diagnostics.noteMessageCount, 5);
  assert.equal(result.diagnostics.omittedInternalCount, 1);
  assert.equal(result.diagnostics.preservedEventCount, 3);
  assert.equal(result.diagnostics.unsupportedContentCount, 1);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "UNSUPPORTED_CONTENT_OMITTED",
    ),
  );
  assert.deepEqual(
    result.conversation.messages.map((message) => message.sourceIndex),
    [1, 2, 2, 2, 3],
  );
  assert.deepEqual(
    result.conversation.messages
      .filter(
        (message) =>
          message.sourceIndex !== null && message.sourceIndex <= 1,
      )
      .map((message) => message.text),
    ["구조도를 만들어 줘"],
  );
  assert.equal(
    new Set(result.conversation.messages.map((message) => message.id)).size,
    result.conversation.messages.length,
  );
  assert.doesNotThrow(() =>
    createConversationNote({
      title: result.conversation.title,
      messages: result.conversation.messages,
    }),
  );
  assert.equal(
    JSON.stringify(result.conversation.messages).includes("private-image-asset"),
    false,
  );
  assert.equal(
    JSON.stringify(result.conversation.messages).includes(
      "unconfirmed-image-asset",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(result.conversation.messages).includes("/mnt/data"),
    false,
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

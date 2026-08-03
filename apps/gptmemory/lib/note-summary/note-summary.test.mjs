import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GEMINI_MODEL,
  SUMMARY_SCHEMA_VERSION,
  SummaryGenerationError,
  createGeminiConversationSummary,
  parseConversationSummaryV2,
} from "./index.ts";

const messages = [
  {
    id: "u1",
    role: "user",
    text: "Gemini로 사용하자. nika가 Gemini 기반 요약을 2026년 8월 10일까지 구현해야 해.",
  },
  {
    id: "a1",
    role: "assistant",
    text: "Gemini Interactions API와 Structured Output 방식을 제안합니다.",
  },
];

test("uses stateless Gemini Interactions Structured Output and materializes evidence IDs", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(
      String(url),
      "https://generativelanguage.googleapis.com/v1/interactions",
    );
    const headers = new Headers(init.headers);
    assert.equal(headers.get("x-goog-api-key"), "gemini-test-key");
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, DEFAULT_GEMINI_MODEL);
    assert.equal(body.store, false);
    assert.equal(body.response_format.type, "text");
    assert.equal(body.response_format.mime_type, "application/json");
    const payload = JSON.parse(body.input.slice(body.input.indexOf("{")));
    const schemaRanges = collectEvidenceIdRanges(body.response_format.schema);
    assert.ok(schemaRanges.length >= 4);
    for (const range of schemaRanges) {
      assert.deepEqual(range, {
        minimum: 0,
        maximum: payload.evidenceCatalog.length - 1,
      });
    }
    assert.deepEqual(body.generation_config, {
      thinking_level: "minimal",
      thinking_summaries: "none",
    });
    assert.match(body.system_instruction, /untrusted data/i);
    assert.match(body.system_instruction, /assistant recommendation remains a proposal/i);
    assert.match(body.input, /Gemini로 사용하자/);
    assert.doesNotMatch(body.input, /gemini-test-key/);

    const titleEvidence = findCatalogEvidence(
      payload,
      "u1",
      "Gemini로 사용하자",
    );
    const assistantEvidence = findCatalogEvidence(
      payload,
      "a1",
      "Gemini Interactions API와 Structured Output 방식을 제안합니다",
    );
    const actionEvidence = findCatalogEvidence(
      payload,
      "u1",
      "nika가 Gemini 기반 요약을 2026년 8월 10일까지 구현해야 해",
    );
    return geminiResponse(
      rawSummary({
        titleEvidence,
        assistantEvidence,
        outcomes: [
          {
            kind: "decision",
            text: "Gemini를 요약 provider로 사용하기로 했다.",
            evidence: [titleEvidence],
          },
          {
            kind: "proposal",
            text: "Interactions API와 Structured Output 사용이 제안됐다.",
            evidence: [assistantEvidence],
          },
        ],
        actionItems: [
          {
            text: "Gemini 기반 요약을 구현한다.",
            owner: "nika",
            status: "open",
            dueAt: "2026-08-10T00:00:00.000Z",
            evidence: [actionEvidence],
          },
        ],
      }),
    );
  };

  const summary = await createGeminiConversationSummary(
    { title: "Gemini 전환", messages },
    { apiKey: "gemini-test-key", fetchImpl },
  );

  assert.equal(summary.schemaVersion, SUMMARY_SCHEMA_VERSION);
  assert.deepEqual(summary.title.sourceMessageIds, ["u1"]);
  assert.deepEqual(
    summary.outcomes.map((outcome) => outcome.kind),
    ["decision", "proposal"],
  );
  assert.deepEqual(summary.actionItems, [
    {
      text: "nika가 Gemini 기반 요약을 2026년 8월 10일까지 구현해야 해.",
      owner: "nika",
      status: "open",
      dueAt: "2026-08-10T00:00:00.000Z",
      sourceMessageIds: ["u1"],
    },
  ]);
  assert.equal(JSON.stringify(summary).includes("quote"), false);
});

test("does not turn an assistant proposal into a decision or action", async () => {
  const source = [
    { id: "u1", role: "user", text: "어떤 방식이 좋을까?" },
    {
      id: "a1",
      role: "assistant",
      text: "Gemini로 하자. 다음에는 캐시도 추가하자.",
    },
  ];
  const result = await createGeminiConversationSummary(
    { messages: source },
    {
      apiKey: "key",
      fetchImpl: async () =>
        geminiResponse(
          rawSummary({
            titleEvidence: evidence("u1", "어떤 방식이 좋을까?"),
            assistantEvidence: evidence("a1", "Gemini로 하자"),
            outcomes: [
              {
                kind: "decision",
                text: "Gemini 사용이 확정됐다.",
                evidence: [evidence("a1", "Gemini로 하자")],
              },
              {
                kind: "proposal",
                text: "Gemini 사용이 제안됐다.",
                evidence: [evidence("a1", "Gemini로 하자")],
              },
            ],
            actionItems: [
              {
                text: "캐시를 추가한다.",
                owner: null,
                status: null,
                dueAt: null,
                evidence: [evidence("a1", "다음에는 캐시도 추가하자")],
              },
            ],
          }),
        ),
    },
  );

  assert.deepEqual(result.outcomes.map((outcome) => outcome.kind), ["proposal"]);
  assert.deepEqual(result.actionItems, []);
});

test("removes unsupported optional action metadata", async () => {
  const source = [
    { id: "u1", role: "user", text: "요약 엔진을 구현해줘." },
    { id: "a1", role: "assistant", text: "알겠습니다." },
  ];
  const result = await createGeminiConversationSummary(
    { messages: source },
    {
      apiKey: "key",
      fetchImpl: async () =>
        geminiResponse(
          rawSummary({
            titleEvidence: evidence("u1", "요약 엔진을 구현해줘"),
            assistantEvidence: evidence("a1", "알겠습니다"),
            actionItems: [
              {
                text: "요약 엔진을 구현한다.",
                owner: "nika",
                status: "completed",
                dueAt: "2026-08-10T00:00:00.000Z",
                evidence: [evidence("u1", "요약 엔진을 구현해줘")],
              },
            ],
          }),
        ),
    },
  );

  assert.deepEqual(result.actionItems, [
    {
      text: "요약 엔진을 구현해줘.",
      sourceMessageIds: ["u1"],
    },
  ]);
});

test("canonicalizes decisions and actions to complete affirmative user clauses", async () => {
  const source = [
    {
      id: "u1",
      role: "user",
      text: "서비스 이름은 Nuvin으로 해야겠다. README를 수정해줘.",
    },
    { id: "a1", role: "assistant", text: "요청을 확인했습니다." },
  ];
  const result = await createGeminiConversationSummary(
    { messages: source },
    {
      apiKey: "key",
      fetchImpl: async () =>
        geminiResponse(
          rawSummary({
            titleEvidence: evidence("u1", "서비스 이름은 Nuvin으로 해야겠다"),
            assistantEvidence: evidence("a1", "요청을 확인했습니다"),
            outcomes: [
              {
                kind: "decision",
                text: "Gemini를 모델로 확정했다.",
                evidence: [
                  evidence("u1", "서비스 이름은 Nuvin으로 해야겠다"),
                ],
              },
            ],
            actionItems: [
              {
                text: "배포를 진행한다.",
                owner: null,
                status: null,
                dueAt: null,
                evidence: [evidence("u1", "README를 수정해줘")],
              },
            ],
          }),
        ),
    },
  );

  assert.deepEqual(result.outcomes, [
    {
      kind: "decision",
      text: "서비스 이름은 Nuvin으로 해야겠다.",
      sourceMessageIds: ["u1"],
    },
  ]);
  assert.deepEqual(result.actionItems, [
    { text: "README를 수정해줘.", sourceMessageIds: ["u1"] },
  ]);
});

test("drops question, conditional, and negated authority claims", async () => {
  for (const userText of [
    "그걸로 무엇을 할 수 있어?",
    "Gemini로 해도 될까?",
    "Gemini라면 진행하자.",
    "README를 수정하지 마.",
  ]) {
    const source = [
      { id: "u1", role: "user", text: userText },
      { id: "a1", role: "assistant", text: "맥락을 확인했습니다." },
    ];
    const quote = userText;
    const result = await createGeminiConversationSummary(
      { messages: source },
      {
        apiKey: "key",
        fetchImpl: async () =>
          geminiResponse(
            rawSummary({
              titleEvidence: evidence("u1", userText),
              assistantEvidence: evidence("a1", "맥락을 확인했습니다"),
              outcomes: [
                {
                  kind: "decision",
                  text: "Gemini 사용을 결정했다.",
                  evidence: [evidence("u1", quote)],
                },
              ],
              actionItems: [
                {
                  text: "README를 수정한다.",
                  owner: null,
                  status: null,
                  dueAt: null,
                  evidence: [evidence("u1", quote)],
                },
              ],
            }),
          ),
      },
    );
    assert.deepEqual(result.outcomes, []);
    assert.deepEqual(result.actionItems, []);
  }
});

test("strips mentioned owners, negated completion, and non-deadline dates", async () => {
  const source = [
    { id: "u1", role: "user", text: "README를 수정해줘." },
    { id: "a1", role: "assistant", text: "nika는 회의에 참석했다." },
    {
      id: "a2",
      role: "assistant",
      text: "README 수정은 아직 완료되지 않았다.",
    },
    {
      id: "a3",
      role: "assistant",
      text: "README 검토 회의는 2026년 8월 10일에 열렸다.",
    },
  ];
  const result = await createGeminiConversationSummary(
    { messages: source },
    {
      apiKey: "key",
      fetchImpl: async () =>
        geminiResponse(
          rawSummary({
            titleEvidence: evidence("u1", "README를 수정해줘"),
            assistantEvidence: evidence("a1", "nika는 회의에 참석했다"),
            actionItems: [
              {
                text: "README를 수정한다.",
                owner: "nika",
                status: "completed",
                dueAt: "2026-08-10T00:00:00.000Z",
                evidence: [
                  evidence("u1", "README를 수정해줘"),
                  evidence("a1", "nika는 회의에 참석했다"),
                  evidence("a2", "README 수정은 아직 완료되지 않았다"),
                  evidence(
                    "a3",
                    "README 검토 회의는 2026년 8월 10일에 열렸다",
                  ),
                ],
              },
            ],
          }),
        ),
    },
  );

  assert.deepEqual(result.actionItems, [
    { text: "README를 수정해줘.", sourceMessageIds: ["u1", "a1", "a2", "a3"] },
  ]);
});

test("rejects unknown source IDs and non-exact evidence quotes", async () => {
  for (const invalidEvidence of [
    { evidenceId: 999 },
    evidence("missing", "Gemini로 사용하자"),
    evidence("u1", "원문에 없는 인용문"),
  ]) {
    await assert.rejects(
      createGeminiConversationSummary(
        { messages },
        {
          apiKey: "key",
          fetchImpl: async () =>
            geminiResponse(rawSummary({ titleEvidence: invalidEvidence })),
        },
      ),
      (error) =>
        error instanceof SummaryGenerationError &&
        error.code === "SUMMARY_INVALID_EVIDENCE",
    );
  }
});

test("keeps the evidence response schema constant-size for a large catalog", async () => {
  const source = Array.from({ length: 40 }, (_, messageIndex) => ({
    id: `m${messageIndex}`,
    role: messageIndex === 0 ? "user" : "assistant",
    text: Array.from(
      { length: 20 },
      (_, clauseIndex) => `메시지 ${messageIndex}의 근거 조항 ${clauseIndex}.`,
    ).join(" "),
  }));
  let schemaLength = 0;
  let catalogLength = 0;

  const result = await createGeminiConversationSummary(
    { messages: source },
    {
      apiKey: "key",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init.body));
        const payload = JSON.parse(body.input.slice(body.input.indexOf("{")));
        catalogLength = payload.evidenceCatalog.length;
        schemaLength = JSON.stringify(body.response_format.schema).length;
        for (const range of collectEvidenceIdRanges(
          body.response_format.schema,
        )) {
          assert.deepEqual(range, {
            minimum: 0,
            maximum: catalogLength - 1,
          });
        }
        return geminiResponse(
          rawSummary({
            titleEvidence: { evidenceId: 0 },
            assistantEvidence: { evidenceId: 0 },
          }),
        );
      },
    },
  );

  assert.equal(catalogLength, 800);
  assert.ok(schemaLength < 6_000, `unexpected schema length: ${schemaLength}`);
  assert.equal(result.schemaVersion, SUMMARY_SCHEMA_VERSION);
});

test("retries a correctable evidence failure with the same constrained IDs", async () => {
  let calls = 0;
  const result = await createGeminiConversationSummary(
    { messages },
    {
      apiKey: "key",
      fetchImpl: async (_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init.body));
        const payload = JSON.parse(body.input.slice(body.input.indexOf("{")));
        for (const range of collectEvidenceIdRanges(
          body.response_format.schema,
        )) {
          assert.deepEqual(range, {
            minimum: 0,
            maximum: payload.evidenceCatalog.length - 1,
          });
        }
        return calls === 1
          ? geminiResponse(
              rawSummary({
                titleEvidence: { evidenceId: "ev_not_in_catalog" },
              }),
            )
          : geminiResponse(
              rawSummary({
                titleEvidence: findCatalogEvidence(
                  payload,
                  "u1",
                  "Gemini로 사용하자",
                ),
                assistantEvidence: findCatalogEvidence(
                  payload,
                  "a1",
                  messages[1].text,
                ),
              }),
            );
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.schemaVersion, SUMMARY_SCHEMA_VERSION);
});

test("strictly validates stored v2 summaries, item limits, and total length", () => {
  const valid = publicSummary();
  assert.deepEqual(parseConversationSummaryV2(valid), valid);

  assert.throws(
    () =>
      parseConversationSummaryV2({
        ...valid,
        oneLineSummary: {
          ...valid.oneLineSummary,
          text: "첫 줄\n둘째 줄",
        },
      }),
    hasCode("SUMMARY_INVALID_STRUCTURE"),
  );
  assert.throws(
    () =>
      parseConversationSummaryV2({
        ...valid,
        oneLineSummary: {
          ...valid.oneLineSummary,
          text: "첫 문장이다. 두 번째 문장이다.",
        },
      }),
    hasCode("SUMMARY_INVALID_STRUCTURE"),
  );
  assert.throws(
    () => parseConversationSummaryV2({ ...valid, keyPoints: valid.keyPoints.slice(0, 2) }),
    hasCode("SUMMARY_INVALID_STRUCTURE"),
  );
  assert.throws(
    () => parseConversationSummaryV2({ ...valid, unexpected: true }),
    hasCode("SUMMARY_INVALID_STRUCTURE"),
  );

  const longText = "가".repeat(190);
  assert.throws(
    () =>
      parseConversationSummaryV2({
        ...valid,
        keyPoints: Array.from({ length: 7 }, (_, index) => ({
          text: `${index}${longText}`,
          sourceMessageIds: ["u1"],
        })),
      }),
    hasCode("SUMMARY_INVALID_STRUCTURE"),
  );
});

test("accepts explicit Korean user decisions without requiring a fixed phrase", async () => {
  for (const decisionText of [
    "Delay-Tolerant Grasp를 심화하자.",
    "서비스 이름은 Nuvin으로 해야겠다.",
  ]) {
    const source = [
      { id: "u1", role: "user", text: decisionText },
      { id: "a1", role: "assistant", text: "선택 내용을 정리했습니다." },
    ];
    const result = await createGeminiConversationSummary(
      { messages: source },
      {
        apiKey: "key",
        fetchImpl: async () =>
          geminiResponse(
            rawSummary({
              titleEvidence: evidence("u1", decisionText),
              assistantEvidence: evidence("a1", "선택 내용을 정리했습니다"),
              outcomes: [
                {
                  kind: "decision",
                  text: "사용자가 연구 또는 서비스 방향을 명시적으로 선택했다.",
                  evidence: [evidence("u1", decisionText)],
                },
              ],
            }),
          ),
      },
    );
    assert.equal(result.outcomes[0]?.kind, "decision");
  }
});

test("classifies malformed JSON, rate limits, provider failures, and timeouts", async () => {
  await assert.rejects(
    createGeminiConversationSummary(
      { messages },
      {
        apiKey: "key",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status: "in_progress",
              output_text: JSON.stringify(rawSummary()),
            }),
            { status: 200 },
          ),
      },
    ),
    hasCode("SUMMARY_INVALID_STRUCTURE"),
  );
  await assert.rejects(
    createGeminiConversationSummary(
      { messages },
      {
        apiKey: "key",
        fetchImpl: async () =>
          new Response(JSON.stringify({ output_text: "not-json" }), {
            status: 200,
          }),
      },
    ),
    hasCode("SUMMARY_INVALID_JSON"),
  );
  await assert.rejects(
    createGeminiConversationSummary(
      { messages },
      { apiKey: "key", fetchImpl: async () => new Response("", { status: 429 }) },
    ),
    (error) =>
      error instanceof SummaryGenerationError &&
      error.code === "SUMMARY_RATE_LIMITED" &&
      error.httpStatus === 429 &&
      error.retryable,
  );
  await assert.rejects(
    createGeminiConversationSummary(
      { messages },
      { apiKey: "key", fetchImpl: async () => new Response("", { status: 503 }) },
    ),
    hasCode("SUMMARY_PROVIDER_UNAVAILABLE"),
  );
  await assert.rejects(
    createGeminiConversationSummary(
      { messages },
      {
        apiKey: "key",
        timeoutMs: 5,
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      },
    ),
    hasCode("SUMMARY_PROVIDER_TIMEOUT"),
  );
});

test("uses chunk, validated partial summaries, and reduce while preserving evidence IDs", async () => {
  const source = [
    { id: "u1", role: "user", text: "첫 번째 목표를 검토해줘." },
    { id: "a1", role: "assistant", text: "첫 번째 분석입니다." },
    { id: "u2", role: "user", text: "두 번째 조건을 확인해줘." },
    { id: "a2", role: "assistant", text: "두 번째 분석입니다." },
  ];
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init.body));
    const payload = JSON.parse(body.input.slice(body.input.indexOf("{")));
    for (const range of collectEvidenceIdRanges(body.response_format.schema)) {
      assert.deepEqual(range, {
        minimum: 0,
        maximum: payload.evidenceCatalog.length - 1,
      });
    }

    if (payload.task === "reduce_validated_partial_summaries") {
      const first = payload.evidenceCatalog[0];
      const last = payload.evidenceCatalog.at(-1);
      return geminiResponse(
        rawSummary({
          titleEvidence: first,
          assistantEvidence: last,
          keyPoints: [
            rawText("첫 목표를 검토했다.", first),
            rawText("조건을 확인했다.", last),
            rawText("두 구간을 압축했다.", first),
          ],
          necessaryContext: [rawText("대화가 여러 구간으로 나뉘었다.", last)],
        }),
      );
    }

    const chunkMessages = payload.untrustedConversation;
    const first = chunkMessages[0];
    const last = chunkMessages.at(-1);
    const firstEvidence = evidence(
      first.id,
      first.id === "u1" ? "첫 번째 목표를 검토해줘." : first.text,
    );
    const lastEvidence = evidence(last.id, last.text);
    return geminiResponse(
      rawSummary({
        titleEvidence: firstEvidence,
        assistantEvidence: lastEvidence,
        keyPoints: [rawText("구간 핵심", firstEvidence)],
        necessaryContext: [],
      }),
    );
  };

  const result = await createGeminiConversationSummary(
    { messages: source },
    {
      apiKey: "key",
      fetchImpl,
      maxMessagesPerChunk: 3,
      maxCharsPerChunk: 10_000,
      chunkConcurrency: 1,
    },
  );

  assert.equal(calls, 3);
  const inputIds = new Set(source.map((message) => message.id));
  for (const id of collectIds(result)) assert.equal(inputIds.has(id), true);
});

test("reduce accepts only exact evidence pairs from validated partials", async () => {
  const source = [
    {
      id: "u1",
      role: "user",
      text: "첫 번째 목표를 검토해줘. 카탈로그 밖 문구.",
    },
    { id: "a1", role: "assistant", text: "첫 번째 분석입니다." },
    { id: "u2", role: "user", text: "두 번째 목표를 확인해줘." },
    { id: "a2", role: "assistant", text: "두 번째 분석입니다." },
  ];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const payload = JSON.parse(body.input.slice(body.input.indexOf("{")));
    if (payload.task === "reduce_validated_partial_summaries") {
      const allowed = payload.evidenceCatalog.at(-1);
      const changed = evidence("u1", "카탈로그 밖 문구");
      return geminiResponse(
        rawSummary({
          titleEvidence: changed,
          assistantEvidence: allowed,
          keyPoints: [
            rawText("첫 목표", allowed),
            rawText("두 번째 목표", allowed),
            rawText("통합 결과", allowed),
          ],
          necessaryContext: [rawText("분할 요약", allowed)],
        }),
      );
    }

    const first = payload.untrustedConversation[0];
    const last = payload.untrustedConversation.at(-1);
    const firstEvidence = evidence(
      first.id,
      first.id === "u1" ? "첫 번째 목표를 검토해줘." : first.text,
    );
    const lastEvidence = evidence(last.id, last.text);
    return geminiResponse(
      rawSummary({
        titleEvidence: firstEvidence,
        assistantEvidence: lastEvidence,
        keyPoints: [rawText("구간 핵심", firstEvidence)],
        necessaryContext: [],
      }),
    );
  };

  await assert.rejects(
    createGeminiConversationSummary(
      { messages: source },
      {
        apiKey: "key",
        fetchImpl,
        maxMessagesPerChunk: 3,
        maxCharsPerChunk: 10_000,
        chunkConcurrency: 1,
      },
    ),
    hasCode("SUMMARY_INVALID_EVIDENCE"),
  );
});

test("fails closed when the Gemini key is explicitly absent", async () => {
  await assert.rejects(
    createGeminiConversationSummary(
      { messages },
      { apiKey: "   ", fetchImpl: async () => geminiResponse(rawSummary()) },
    ),
    hasCode("SUMMARY_PROVIDER_NOT_CONFIGURED"),
  );
});

function rawSummary(overrides = {}) {
  const titleEvidence = overrides.titleEvidence ?? evidence("u1", "Gemini로 사용하자");
  const assistantEvidence =
    overrides.assistantEvidence ?? evidence("a1", messages[1].text);
  return {
    title: rawText("Gemini 기반 대화 요약", titleEvidence),
    oneLineSummary: rawText(
      "Gemini Structured Output을 이용한 압축 요약을 논의했다.",
      titleEvidence,
    ),
    keyPoints:
      overrides.keyPoints ??
      [
        rawText("Gemini 사용 방향을 검토했다.", titleEvidence),
        rawText("Structured Output 방식이 제안됐다.", assistantEvidence),
        rawText("근거 메시지 ID를 유지한다.", titleEvidence),
      ],
    outcomes: overrides.outcomes ?? [],
    actionItems: overrides.actionItems ?? [],
    necessaryContext:
      overrides.necessaryContext ??
      [rawText("기존 대화 adapter의 정제 결과를 사용한다.", assistantEvidence)],
  };
}

function rawText(text, evidenceItem) {
  return { text, evidence: [{ evidenceId: evidenceItem.evidenceId }] };
}

function evidence(sourceMessageId, quote) {
  return { evidenceId: evidenceIdFor(sourceMessageId, quote) };
}

function evidenceIdFor(sourceMessageId, quote) {
  const normalizedQuote = String(quote)
    .normalize("NFKC")
    .replace(/^[\s\-*•·]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;。！？]+$/u, "")
    .trim();
  const value = `${sourceMessageId}\u0000${normalizedQuote}`;
  let hash = 14_695_981_039_346_656_037n;
  const prime = 1_099_511_628_211n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `ev_${hash.toString(36)}`;
}

function geminiResponse(value) {
  return new Response(
    JSON.stringify({
      id: "interaction-test",
      model: DEFAULT_GEMINI_MODEL,
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(value) }],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function publicSummary() {
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    title: { text: "요약 제목", sourceMessageIds: ["u1"] },
    oneLineSummary: { text: "한 줄 요약", sourceMessageIds: ["u1", "a1"] },
    keyPoints: [
      { text: "핵심 1", sourceMessageIds: ["u1"] },
      { text: "핵심 2", sourceMessageIds: ["a1"] },
      { text: "핵심 3", sourceMessageIds: ["u1", "a1"] },
    ],
    outcomes: [],
    actionItems: [],
    necessaryContext: [{ text: "필요 맥락", sourceMessageIds: ["u1"] }],
  };
}

function hasCode(code) {
  return (error) =>
    error instanceof SummaryGenerationError && error.code === code;
}

function collectIds(summary) {
  return [
    ...summary.title.sourceMessageIds,
    ...summary.oneLineSummary.sourceMessageIds,
    ...summary.keyPoints.flatMap((item) => item.sourceMessageIds),
    ...summary.outcomes.flatMap((item) => item.sourceMessageIds),
    ...summary.actionItems.flatMap((item) => item.sourceMessageIds),
    ...summary.necessaryContext.flatMap((item) => item.sourceMessageIds),
  ];
}

function collectEvidenceIdRanges(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceIdRanges(item, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  if (
    value.properties?.evidenceId?.type === "integer" &&
    Number.isInteger(value.properties.evidenceId.minimum) &&
    Number.isInteger(value.properties.evidenceId.maximum)
  ) {
    result.push({
      minimum: value.properties.evidenceId.minimum,
      maximum: value.properties.evidenceId.maximum,
    });
  }
  for (const child of Object.values(value)) {
    collectEvidenceIdRanges(child, result);
  }
  return result;
}

function findCatalogEvidence(payload, sourceMessageId, quote) {
  const normalizedQuote = String(quote)
    .normalize("NFKC")
    .replace(/^[\s\-*•·]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;。！？]+$/u, "")
    .trim();
  const match = payload.evidenceCatalog.find(
    (item) =>
      item.sourceMessageId === sourceMessageId &&
      String(item.quote)
        .normalize("NFKC")
        .replace(/^[\s\-*•·]+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.!?;。！？]+$/u, "")
        .trim() === normalizedQuote,
  );
  assert.ok(match, `missing evidence for ${sourceMessageId}: ${quote}`);
  return { evidenceId: match.evidenceId };
}

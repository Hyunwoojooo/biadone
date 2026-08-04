import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GEMINI_STATE_MODEL,
  STATE_NOTE_SCHEMA_VERSION,
  StateNoteCorrectionError,
  StateNoteGenerationError,
  applyStateNoteCorrection,
  createGeminiConversationStateNote,
  listConversationStateNoteItems,
  parseConversationStateNoteV3,
  resolveStateNoteItemPresentation,
} from "./index.ts";

const NULL_EVENT_FIELDS = {
  targetKey: null,
  requestKind: null,
  status: null,
  owner: null,
  dueAt: null,
  resultKind: null,
  completionBasis: null,
  artifactKind: null,
  artifactLabel: null,
  artifactLocator: null,
  proposedBy: null,
  unresolvedKind: null,
  changeKind: null,
  from: null,
  to: null,
  reason: null,
};

function rawEvent(kind, key, text, evidenceId, extra = {}) {
  return {
    kind,
    key,
    text,
    ...NULL_EVENT_FIELDS,
    ...extra,
    evidence: [{ evidenceId }],
  };
}

function response(events) {
  return new Response(
    JSON.stringify({ status: "completed", output_text: JSON.stringify({ events }) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function payloadFromRequest(init) {
  const body = JSON.parse(String(init.body));
  return {
    body,
    prompt: JSON.parse(body.input.slice(body.input.indexOf("{"))),
  };
}

function evidenceId(prompt, sourceMessageId, quotePart) {
  const entry = prompt.evidenceCatalog.find(
    (item) =>
      item.sourceMessageId === sourceMessageId && item.quote.includes(quotePart),
  );
  assert.ok(entry, `missing evidence ${sourceMessageId}: ${quotePart}`);
  return entry.evidenceId;
}

function stateNoteFixture() {
  const evidence = (text, sourceMessageId = "u1") => ({
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote: text }],
  });
  return {
    schemaVersion: STATE_NOTE_SCHEMA_VERSION,
    title: evidence("상태 노트"),
    primaryGoal: evidence("현재 상태를 정확히 보존한다."),
    currentState: evidence("결정 하나가 확정된 상태다."),
    confirmedDecisions: [
      {
        ...evidence("State Note v3를 사용한다."),
        basis: "conversation_explicit",
      },
    ],
    completedResults: [],
    openActions: [],
    unresolvedQuestions: [],
    activeConstraints: [],
    activeProposals: [],
    keyInsights: [],
    stateChanges: [],
  };
}

test("applies text, hide, and restore corrections without mutating generated evidence", () => {
  const original = parseConversationStateNoteV3(stateNoteFixture());
  const decision = listConversationStateNoteItems(original).find(
    (entry) => entry.section === "confirmedDecisions",
  );
  assert.ok(decision);
  const generatedBefore = structuredClone(original.confirmedDecisions[0]);

  const overridden = applyStateNoteCorrection(
    original,
    {
      itemKey: decision.itemKey,
      operation: "override_text",
      text: "State Note v3를 기본 노트로 사용한다.",
    },
    "2026-08-04T01:00:00.000Z",
  );
  assert.deepEqual(overridden.confirmedDecisions[0], generatedBefore);
  assert.equal(
    listConversationStateNoteItems(overridden).find(
      (entry) => entry.section === "confirmedDecisions",
    )?.itemKey,
    decision.itemKey,
  );
  assert.deepEqual(
    resolveStateNoteItemPresentation(
      overridden,
      decision.itemKey,
      generatedBefore.text,
    ),
    {
      generatedText: "State Note v3를 사용한다.",
      displayText: "State Note v3를 기본 노트로 사용한다.",
      hidden: false,
      isUserOverridden: true,
    },
  );

  const hidden = applyStateNoteCorrection(
    overridden,
    { itemKey: decision.itemKey, operation: "hide" },
    "2026-08-04T01:01:00.000Z",
  );
  assert.equal(hidden.userCorrections[0].hidden, true);
  assert.equal(hidden.userCorrections[0].textOverride, "State Note v3를 기본 노트로 사용한다.");

  const restored = applyStateNoteCorrection(
    hidden,
    { itemKey: decision.itemKey, operation: "restore" },
    "2026-08-04T01:02:00.000Z",
  );
  assert.equal(restored.userCorrections, undefined);
  assert.deepEqual(restored.confirmedDecisions[0], generatedBefore);
});

test("rejects corrections for unknown items and malformed stored metadata", () => {
  const note = parseConversationStateNoteV3(stateNoteFixture());
  assert.throws(
    () =>
      applyStateNoteCorrection(
        note,
        { itemKey: "v3:title:0000000000000000", operation: "hide" },
        "2026-08-04T01:00:00.000Z",
      ),
    (error) =>
      error instanceof StateNoteCorrectionError &&
      error.code === "STATE_NOTE_ITEM_NOT_FOUND",
  );

  const titleKey = listConversationStateNoteItems(note)[0].itemKey;
  assert.throws(
    () =>
      parseConversationStateNoteV3({
        ...stateNoteFixture(),
        userCorrections: [
          {
            itemKey: titleKey,
            textOverride: "사용자 정정",
            hidden: false,
            updatedAt: "2026-08-04T01:00:00.000Z",
          },
        ],
      }),
    (error) =>
      error instanceof StateNoteGenerationError &&
      error.code === "STATE_INVALID_STRUCTURE",
  );
});

test("uses stateless Gemini structured event extraction and folds a fulfilled request", async () => {
  const messages = [
    { id: "u1", role: "user", text: "제품 철학 문서를 만들어줘." },
    {
      id: "a1",
      role: "assistant",
      text: "제품 철학 문서를 docs/philosophy.md로 작성했습니다.",
    },
  ];
  const fetchImpl = async (url, init) => {
    assert.equal(
      String(url),
      "https://generativelanguage.googleapis.com/v1/interactions",
    );
    const { body, prompt } = payloadFromRequest(init);
    assert.equal(body.model, DEFAULT_GEMINI_STATE_MODEL);
    assert.equal(body.store, false);
    assert.match(body.system_instruction, /state-event extractor/i);
    assert.doesNotMatch(body.input, /test-secret/);
    assert.equal(prompt.primaryLanguageHint, "ko");
    const userEvidence = evidenceId(prompt, "u1", "문서를 만들어줘");
    const assistantEvidence = evidenceId(prompt, "a1", "작성했습니다");
    return response([
      rawEvent("goal_opened", "product-philosophy", "제품 철학을 문서화한다.", userEvidence),
      rawEvent(
        "request_opened",
        "write-philosophy",
        "제품 철학 문서를 만든다.",
        userEvidence,
        { requestKind: "artifact_change" },
      ),
      rawEvent(
        "request_fulfilled",
        "write-philosophy",
        "제품 철학 문서가 작성됐다.",
        assistantEvidence,
        {
          targetKey: "write-philosophy",
          resultKind: "document",
          completionBasis: "assistant_reported",
          artifactKind: "file",
          artifactLabel: "docs/philosophy.md",
          artifactLocator: "docs/philosophy.md",
        },
      ),
    ]);
  };

  const note = await createGeminiConversationStateNote(
    { title: "GPTMemory 철학", messages },
    { apiKey: "test-secret", fetchImpl },
  );

  assert.equal(note.schemaVersion, STATE_NOTE_SCHEMA_VERSION);
  assert.equal(note.title.text, "GPTMemory 철학");
  assert.equal(note.openActions.length, 0);
  assert.equal(note.completedResults.length, 1);
  assert.equal(note.completedResults[0].kind, "document");
  assert.deepEqual(note.completedResults[0].sourceMessageIds, ["a1"]);
  assert.equal(note.completedResults[0].artifact.locator, "docs/philosophy.md");
  assert.match(note.currentState.text, /남은 작업은 없다/);
});

test("keeps an assistant suggestion as a proposal and rejects assistant-only decisions", async () => {
  const messages = [
    { id: "u1", role: "user", text: "다음 방향을 제안해줘." },
    {
      id: "a1",
      role: "assistant",
      text: "상태 이벤트 원장 방식으로 바꾸는 것을 제안합니다.",
    },
  ];
  const note = await createGeminiConversationStateNote(
    { messages },
    {
      apiKey: "key",
      fetchImpl: async (_url, init) => {
        const { prompt } = payloadFromRequest(init);
        const assistantEvidence = evidenceId(prompt, "a1", "제안합니다");
        return response([
          rawEvent(
            "proposal_made",
            "state-ledger",
            "상태 이벤트 원장 방식으로 변경한다.",
            assistantEvidence,
            { proposedBy: "assistant" },
          ),
          rawEvent(
            "decision_set",
            "state-ledger",
            "상태 이벤트 원장 방식이 확정됐다.",
            assistantEvidence,
          ),
        ]);
      },
    },
  );

  assert.equal(note.confirmedDecisions.length, 0);
  assert.equal(note.openActions.length, 0);
  assert.deepEqual(note.activeProposals.map((item) => item.proposedBy), [
    "assistant",
  ]);
});

test("publishes an open action from the exact user request instead of model paraphrase", async () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      text: "README를 수정해줘. 담당자는 nika이고 2026년 8월 10일까지 해야 해.",
    },
    { id: "a1", role: "assistant", text: "요청을 확인했습니다." },
  ];
  const note = await createGeminiConversationStateNote(
    { messages },
    {
      apiKey: "key",
      fetchImpl: async (_url, init) => {
        const { prompt } = payloadFromRequest(init);
        const requestEvidence = evidenceId(prompt, "u1", "README를 수정해줘");
        const metadataEvidence = evidenceId(prompt, "u1", "담당자는 nika");
        return response([
          {
            ...rawEvent(
              "request_opened",
              "readme-update",
              "프로덕션 배포를 수행한다.",
              requestEvidence,
              {
                requestKind: "artifact_change",
                owner: "nika",
                dueAt: "2026-08-10T00:00:00.000Z",
              },
            ),
            evidence: [
              { evidenceId: requestEvidence },
              { evidenceId: metadataEvidence },
            ],
          },
        ]);
      },
    },
  );

  assert.equal(note.openActions.length, 1);
  assert.equal(note.openActions[0].text, "README를 수정해줘.");
  assert.equal(note.openActions[0].owner, "nika");
  assert.equal(note.openActions[0].dueAt, "2026-08-10T00:00:00.000Z");
});

test("a later user correction supersedes an earlier decision", async () => {
  const messages = [
    { id: "u1", role: "user", text: "OpenAI를 사용하기로 했다." },
    { id: "a1", role: "assistant", text: "OpenAI 기준으로 진행하겠습니다." },
    { id: "u2", role: "user", text: "OpenAI 말고 Gemini를 사용하자." },
  ];
  const note = await createGeminiConversationStateNote(
    { messages },
    {
      apiKey: "key",
      fetchImpl: async (_url, init) => {
        const { prompt } = payloadFromRequest(init);
        const oldDecision = evidenceId(prompt, "u1", "사용하기로 했다");
        const correction = evidenceId(prompt, "u2", "Gemini를 사용하자");
        return response([
          rawEvent("decision_set", "provider", "OpenAI를 사용한다.", oldDecision),
          rawEvent(
            "decision_superseded",
            "provider-old",
            "OpenAI 선택을 Gemini로 대체한다.",
            correction,
            {
              targetKey: "provider",
              changeKind: "direction_changed",
              from: "OpenAI를 사용한다.",
              to: "Gemini를 사용한다.",
            },
          ),
          rawEvent("decision_set", "provider", "Gemini를 사용한다.", correction),
        ]);
      },
    },
  );

  assert.deepEqual(note.confirmedDecisions.map((item) => item.text), [
    "OpenAI 말고 Gemini를 사용하자.",
  ]);
  assert.equal(note.stateChanges.length, 1);
  assert.equal(note.stateChanges[0].from, "OpenAI를 사용하기로 했다.");
  assert.equal(note.stateChanges[0].to, "Gemini를 사용한다.");
});

test("folds request completion across chunk boundaries", async () => {
  const messages = [
    { id: "u1", role: "user", text: "README를 수정해줘." },
    { id: "a1", role: "assistant", text: "파일을 확인하고 있습니다." },
    { id: "u2", role: "user", text: "계속 진행해." },
    { id: "a2", role: "assistant", text: "README 수정이 완료됐습니다." },
  ];
  let calls = 0;
  const note = await createGeminiConversationStateNote(
    { messages },
    {
      apiKey: "key",
      maxMessagesPerChunk: 2,
      chunkConcurrency: 2,
      fetchImpl: async (_url, init) => {
        calls += 1;
        const { prompt } = payloadFromRequest(init);
        if (prompt.chunk.number === 1) {
          const opened = evidenceId(prompt, "u1", "README를 수정해줘");
          return response([
            rawEvent(
              "request_opened",
              "readme-update",
              "README를 수정한다.",
              opened,
              { requestKind: "artifact_change" },
            ),
          ]);
        }
        const fulfilled = evidenceId(prompt, "a2", "완료됐습니다");
        return response([
          rawEvent(
            "request_fulfilled",
            "readme-update",
            "README 수정이 완료됐다.",
            fulfilled,
            {
              targetKey: "readme-update",
              resultKind: "code_change",
              completionBasis: "assistant_reported",
            },
          ),
        ]);
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(note.openActions.length, 0);
  assert.deepEqual(note.completedResults.map((item) => item.text), [
    "README 수정이 완료됐다.",
  ]);
});

test("strict parser rejects a snippet not listed in sourceMessageIds", () => {
  const evidence = {
    text: "현재 상태",
    sourceMessageIds: ["u1"],
    evidenceSnippets: [{ sourceMessageId: "a1", quote: "다른 근거" }],
  };
  assert.throws(
    () =>
      parseConversationStateNoteV3({
        schemaVersion: STATE_NOTE_SCHEMA_VERSION,
        title: evidence,
        primaryGoal: null,
        currentState: evidence,
        confirmedDecisions: [],
        completedResults: [],
        openActions: [],
        unresolvedQuestions: [],
        activeConstraints: [],
        activeProposals: [],
        keyInsights: [],
        stateChanges: [],
      }),
    (error) =>
      error instanceof StateNoteGenerationError &&
      error.code === "STATE_INVALID_EVIDENCE",
  );
});

test("provider timeout is mapped without leaking credentials", async () => {
  await assert.rejects(
    createGeminiConversationStateNote(
      { messages: [{ id: "u1", role: "user", text: "정리해줘." }] },
      {
        apiKey: "never-print-this",
        timeoutMs: 1,
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      },
    ),
    (error) => {
      assert.ok(error instanceof StateNoteGenerationError);
      assert.equal(error.code, "STATE_PROVIDER_TIMEOUT");
      assert.doesNotMatch(error.message, /never-print-this/);
      return true;
    },
  );
});

test("classifies malformed output, rate limits, and provider failures", async () => {
  const source = {
    messages: [{ id: "u1", role: "user", text: "현재 상태를 정리해줘." }],
  };
  const cases = [
    {
      response: new Response(
        JSON.stringify({ status: "completed", output_text: "{" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      code: "STATE_INVALID_JSON",
    },
    {
      response: new Response("rate limited", { status: 429 }),
      code: "STATE_RATE_LIMITED",
    },
    {
      response: new Response("unavailable", { status: 503 }),
      code: "STATE_PROVIDER_UNAVAILABLE",
    },
  ];

  for (const fixture of cases) {
    await assert.rejects(
      createGeminiConversationStateNote(source, {
        apiKey: "key",
        fetchImpl: async () => fixture.response,
      }),
      (error) =>
        error instanceof StateNoteGenerationError &&
        error.code === fixture.code,
    );
  }
});

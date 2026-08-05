import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiRequestError,
  parseCreateNoteInput,
  parseListNotesInput,
  parsePatchNoteInput,
  parseStoredConversationContentNote,
  parseStoredConversationStateNote,
  parseStoredConversationSummary,
  requireOwnerKey,
} from "../app/api/notes/_shared.ts";

const ownerKey = "owner_abcdefghijklmnopqrstuvwxyz_123456";

test("accepts a safe owner key and rejects missing or unsafe keys", () => {
  const request = new Request("https://example.test/api/notes", {
    headers: { "x-gptmemory-owner": ownerKey },
  });
  assert.equal(requireOwnerKey(request), ownerKey);

  assert.throws(
    () => requireOwnerKey(new Request("https://example.test/api/notes")),
    (error: unknown) =>
      error instanceof ApiRequestError &&
      error.code === "OWNER_KEY_REQUIRED" &&
      error.status === 401,
  );
  assert.throws(
    () =>
      requireOwnerKey(
        new Request("https://example.test/api/notes", {
          headers: { "x-gptmemory-owner": "unsafe owner key with spaces" },
        }),
      ),
    (error: unknown) =>
      error instanceof ApiRequestError &&
      error.code === "INVALID_OWNER_KEY" &&
      error.status === 401,
  );
});

test("normalizes a valid create payload without accepting owner data", () => {
  const note = parseCreateNoteInput({
    title: "  대화 정리  ",
    overview: "정리된 개요",
    sections: [{ heading: "시작", narrative: "첫 대화" }],
    tags: ["ChatGPT", "chatgpt", "기록"],
    favorite: true,
    sourceUrl: "https://chatgpt.com/share/example",
    sourceMessageCount: 12,
  });

  assert.equal(note.title, "대화 정리");
  assert.deepEqual(note.tags, ["ChatGPT", "기록"]);
  assert.equal(note.favorite, true);
  assert.equal(note.archived, false);
  assert.equal(note.sourceMessageCount, 12);

  assert.throws(
    () =>
      parseCreateNoteInput({
        title: "private",
        ownerKey,
      }),
    (error: unknown) =>
      error instanceof ApiRequestError && error.code === "UNKNOWN_FIELDS",
  );
  assert.throws(
    () =>
      parseCreateNoteInput({
        title: "client-forged-generation",
        generationMetadata: {
          workflowVersion: "gptmemory-note-import.v2",
        },
      }),
    (error: unknown) =>
      error instanceof ApiRequestError && error.code === "UNKNOWN_FIELDS",
  );
});

test("validates list views and patch restore semantics", () => {
  assert.deepEqual(
    parseListNotesInput(
      new Request(
        "https://example.test/api/notes?view=favorites&q=memory&tag=AI",
      ),
    ),
    { view: "favorites", query: "memory", tag: "AI" },
  );

  assert.deepEqual(parsePatchNoteInput({ deletedAt: null }), {
    deletedAt: null,
  });
  assert.deepEqual(
    parseListNotesInput(
      new Request("https://example.test/api/notes?view=timeline"),
    ),
    { view: "timeline" },
  );
  assert.throws(
    () => parsePatchNoteInput({ deletedAt: new Date().toISOString() }),
    (error: unknown) =>
      error instanceof ApiRequestError && error.code === "INVALID_FIELD",
  );
  assert.throws(
    () => parsePatchNoteInput({}),
    (error: unknown) =>
      error instanceof ApiRequestError && error.code === "EMPTY_PATCH",
  );
  for (const serverManagedPatch of [
    { sourceUrl: "https://chatgpt.com/share/other" },
    { sourceTitle: "forged source" },
    { sourceMessageCount: 999 },
    { sourceTimelineAt: "2026-08-01T00:00:00.000Z" },
    { sourceLastVisibleAt: "2026-08-01T01:00:00.000Z" },
    { sourceTimestampedVisibleMessageCount: 2 },
    { sourceVisibleMessageCount: 3 },
    {
      generationMetadata: {
        workflowVersion: "gptmemory-note-import.v2",
      },
    },
    { summarySchemaVersion: "gptmemory.summary.v2" },
    {
      summary: {
        title: { text: "forged", sourceMessageIds: ["u1"] },
      },
    },
  ]) {
    assert.throws(
      () => parsePatchNoteInput(serverManagedPatch),
      (error: unknown) =>
        error instanceof ApiRequestError && error.code === "UNKNOWN_FIELDS",
    );
  }

  for (const serverManagedCreate of [
    { sourceTimelineAt: "2026-08-01T00:00:00.000Z" },
    { sourceLastVisibleAt: "2026-08-01T01:00:00.000Z" },
    { sourceTimestampedVisibleMessageCount: 2 },
    { sourceVisibleMessageCount: 3 },
  ]) {
    assert.throws(
      () => parseCreateNoteInput({ title: "forged timeline", ...serverManagedCreate }),
      (error: unknown) =>
        error instanceof ApiRequestError && error.code === "UNKNOWN_FIELDS",
    );
  }
});

test("validates state-note correction PATCH payloads and stale-write preconditions", () => {
  const itemKey = "v3:confirmedDecisions:0123456789abcdef";
  const expectedUpdatedAt = "2026-08-04T01:00:00.000Z";
  assert.deepEqual(
    parsePatchNoteInput({
      expectedUpdatedAt,
      stateNoteCorrection: {
        itemKey,
        operation: "override_text",
        text: "사용자가 바로잡은 결정",
      },
    }),
    {
      expectedUpdatedAt,
      stateNoteCorrection: {
        itemKey,
        operation: "override_text",
        text: "사용자가 바로잡은 결정",
      },
    },
  );
  assert.deepEqual(
    parsePatchNoteInput({
      expectedUpdatedAt,
      stateNoteCorrection: { itemKey, operation: "hide" },
    }),
    {
      expectedUpdatedAt,
      stateNoteCorrection: { itemKey, operation: "hide" },
    },
  );
  assert.deepEqual(
    parsePatchNoteInput({
      expectedUpdatedAt,
      stateNoteCorrection: { itemKey, operation: "restore" },
    }),
    {
      expectedUpdatedAt,
      stateNoteCorrection: { itemKey, operation: "restore" },
    },
  );

  for (const invalid of [
    {
      stateNoteCorrection: { itemKey, operation: "hide" },
    },
    {
      expectedUpdatedAt,
    },
    {
      expectedUpdatedAt,
      favorite: true,
      stateNoteCorrection: { itemKey, operation: "hide" },
    },
    {
      expectedUpdatedAt: "not-a-date",
      stateNoteCorrection: { itemKey, operation: "hide" },
    },
    {
      expectedUpdatedAt,
      stateNoteCorrection: {
        itemKey,
        operation: "override_text",
        text: "",
      },
    },
    {
      expectedUpdatedAt,
      stateNoteCorrection: { itemKey: "title:0", operation: "hide" },
    },
    {
      expectedUpdatedAt,
      stateNoteCorrection: { itemKey, operation: "hide", text: "unexpected" },
    },
  ]) {
    assert.throws(
      () => parsePatchNoteInput(invalid),
      (error: unknown) => error instanceof ApiRequestError,
    );
  }
});

test("keeps v1 rows readable when stored v2 summary metadata is absent or malformed", () => {
  assert.equal(parseStoredConversationSummary(null, null), null);
  assert.equal(
    parseStoredConversationSummary("gptmemory.summary.v1", "{}"),
    null,
  );
  assert.equal(
    parseStoredConversationSummary("gptmemory.summary.v2", "not-json"),
    null,
  );
  assert.equal(
    parseStoredConversationSummary("gptmemory.summary.v2", "{}"),
    null,
  );
});

test("restores a valid v2 summary from its versioned JSON column", () => {
  const summary = {
    schemaVersion: "gptmemory.summary.v2",
    title: { text: "요약 제목", sourceMessageIds: ["u1"] },
    oneLineSummary: { text: "한 줄 요약입니다.", sourceMessageIds: ["u1"] },
    keyPoints: [
      { text: "핵심 1", sourceMessageIds: ["u1"] },
      { text: "핵심 2", sourceMessageIds: ["a1"] },
      { text: "핵심 3", sourceMessageIds: ["u1", "a1"] },
    ],
    outcomes: [],
    actionItems: [],
    necessaryContext: [
      { text: "중요 배경", sourceMessageIds: ["u1"] },
    ],
  };

  assert.deepEqual(
    parseStoredConversationSummary(
      "gptmemory.summary.v2",
      JSON.stringify(summary),
    ),
    summary,
  );
});

test("restores valid v3 state notes and fails back to the preserved legacy note", () => {
  const evidence = (text: string, sourceMessageId = "u1") => ({
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote: text }],
  });
  const stateNote = {
    schemaVersion: "gptmemory.state-note.v3",
    title: evidence("상태 노트"),
    primaryGoal: evidence("대화를 다시 이어갈 현재 상태를 만든다."),
    currentState: evidence("구조 변경이 확정됐고 열린 작업은 없다."),
    confirmedDecisions: [
      { ...evidence("상태 노트 구조를 사용한다."), basis: "conversation_explicit" },
    ],
    completedResults: [],
    openActions: [],
    unresolvedQuestions: [],
    activeConstraints: [],
    activeProposals: [],
    keyInsights: [],
    stateChanges: [],
  };

  assert.deepEqual(
    parseStoredConversationStateNote(
      "gptmemory.state-note.v3",
      JSON.stringify(stateNote),
    ),
    stateNote,
  );
  assert.equal(
    parseStoredConversationStateNote("gptmemory.state-note.v3", "{}"),
    null,
  );
  assert.equal(
    parseStoredConversationStateNote(
      "gptmemory.summary.v2",
      JSON.stringify(stateNote),
    ),
    null,
  );
});

test("restores valid v4 content notes without changing v1-v3 compatibility", () => {
  const evidence = (text: string, sourceMessageId = "u1") => ({
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote: text }],
  });
  const contentNote = {
    schemaVersion: "gptmemory.content-note.v4",
    conversationType: "research",
    title: evidence("대화 내용을 중심으로 정리하는 방법"),
    oneLineSummary: evidence(
      "핵심 내용을 주제별로 먼저 보여주고 상태와 근거를 보조 정보로 둔다.",
      "a1",
    ),
    keyTakeaways: [
      evidence("대화의 실질적인 내용이 상태 정보보다 먼저 보여야 한다.", "a1"),
      evidence("주제 구분과 핵심 합성 뒤 결정과 할 일을 분리한다.", "a1"),
      evidence("원문 근거와 시간순 흐름은 필요할 때 펼쳐 본다.", "a1"),
    ],
    topics: [
      {
        title: evidence("주제 중심 계층형 요약", "a1"),
        summary: evidence(
          "고정된 바깥 구조 안에서 대화에 맞는 주제 제목과 내용을 생성한다.",
          "a1",
        ),
        details: [
          {
            ...evidence("내용이 먼저, 상태는 그다음에 배치된다.", "a1"),
            kind: "rationale",
          },
        ],
      },
    ],
    conclusions: [
      evidence("GPTMemory의 기본 결과를 내용 중심 노트로 바꾼다."),
    ],
    confirmedDecisions: [
      evidence("이 방향으로 수정한다."),
    ],
    actionItems: [],
    openQuestions: [],
    supportingInfo: {
      currentState: evidence("v4 내용 노트 구현을 진행하는 상태다."),
      artifacts: [],
      activeProposals: [],
      constraintsAndChanges: [],
    },
  };

  assert.deepEqual(
    parseStoredConversationContentNote(
      "gptmemory.content-note.v4",
      JSON.stringify(contentNote),
    ),
    contentNote,
  );
  assert.equal(
    parseStoredConversationContentNote("gptmemory.content-note.v4", "{}"),
    null,
  );
  assert.equal(
    parseStoredConversationContentNote(
      "gptmemory.state-note.v3",
      JSON.stringify(contentNote),
    ),
    null,
  );
  assert.equal(
    parseStoredConversationSummary(
      "gptmemory.content-note.v4",
      JSON.stringify(contentNote),
    ),
    null,
  );
  assert.equal(
    parseStoredConversationStateNote(
      "gptmemory.content-note.v4",
      JSON.stringify(contentNote),
    ),
    null,
  );
});

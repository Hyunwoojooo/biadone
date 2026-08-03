import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiRequestError,
  parseCreateNoteInput,
  parseListNotesInput,
  parsePatchNoteInput,
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

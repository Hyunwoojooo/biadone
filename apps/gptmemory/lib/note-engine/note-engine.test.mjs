import assert from "node:assert/strict";
import test from "node:test";

import {
  NoteEngineError,
  classifyUserTurn,
  createConversationNote,
} from "./index.ts";

test("keeps Korean corrections and conversation order in note sections", () => {
  const draft = createConversationNote({
    messages: [
      {
        id: "u1",
        role: "user",
        text: "대화 내용을 그래프로 정리해줘.",
        createdAt: "2026-07-29T09:00:00.000Z",
      },
      {
        id: "a1",
        role: "assistant",
        text: "엔티티와 관계를 중심으로 구조를 제안할게요.",
        createdAt: "2026-07-29T09:01:00.000Z",
      },
      {
        id: "u2",
        role: "user",
        text: "그게 아니라 대화 흐름과 맥락을 노트 형식으로만 표현하고 싶어.",
        createdAt: "2026-07-29T09:02:00.000Z",
      },
      {
        id: "a2",
        role: "assistant",
        text: "질문과 답변, 중간의 수정 과정을 시간순 섹션으로 구성할게요.",
        createdAt: "2026-07-29T09:03:00.000Z",
      },
      {
        id: "u3",
        role: "user",
        text: "그럼 구현 계획을 만들어줘.",
        createdAt: "2026-07-29T09:04:00.000Z",
      },
      {
        id: "a3",
        role: "assistant",
        text: "노트 중심 MVP 구현 계획을 작성했습니다.",
        createdAt: "2026-07-29T09:05:00.000Z",
      },
    ],
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/example",
      normalizedUrl: "https://chatgpt.com/share/example",
      shareId: "example",
    },
  });

  assert.equal(draft.schemaVersion, "gptmemory.note-draft.v1");
  assert.equal(draft.format, "plain_text");
  assert.equal(draft.title, "대화 내용을 그래프로 정리해줘");
  assert.equal(draft.sections.length, 3);
  assert.equal(draft.sections[0].flowKind, "opening");
  assert.equal(draft.sections[1].flowKind, "correction");
  assert.match(draft.sections[1].heading, /^조건 수정 · /);
  assert.equal(draft.sections[2].flowKind, "transition");
  assert.match(draft.sections[2].heading, /^맥락 전환 · /);
  assert.deepEqual(draft.sections[1].sourceMessageIds, ["u2", "a2"]);
  assert.match(
    draft.sections[1].body,
    /그게 아니라 대화 흐름과 맥락을 노트 형식으로만 표현하고 싶어/,
  );
  assert.match(
    draft.sections[1].body,
    /질문과 답변, 중간의 수정 과정을 시간순 섹션으로 구성할게요/,
  );
  assert.match(draft.overview, /조건 수정이나 맥락 전환/);
  assert.deepEqual(draft.tags, []);
  assert.equal(draft.source.messageCount, 6);
  assert.equal(draft.source.userTurnCount, 3);
  assert.equal(draft.source.startedAt, "2026-07-29T09:00:00.000Z");
  assert.equal(draft.source.endedAt, "2026-07-29T09:05:00.000Z");
});

test("uses a supplied title and produces readable English flow text", () => {
  const draft = createConversationNote({
    title: "A compact research note",
    messages: [
      { id: "u1", role: "user", text: "Compare the two approaches." },
      { id: "a1", role: "assistant", text: "The first is simpler." },
      {
        id: "u2",
        role: "user",
        text: "Actually, leave the graph out and keep this as a note.",
      },
      {
        id: "a2",
        role: "assistant",
        text: "The note will retain the chronological context.",
      },
    ],
  });

  assert.equal(draft.title, "A compact research note");
  assert.equal(draft.sections[1].flowKind, "correction");
  assert.match(draft.sections[1].heading, /^Correction · /);
  assert.match(draft.overview, /^The conversation moved through 2 user requests/);
  assert.match(
    draft.closingState,
    /^The conversation ended after a response to/,
  );
  assert.equal(draft.source.conversationTitle, "A compact research note");
});

test("keeps consecutive assistant messages in one user-turn section", () => {
  const draft = createConversationNote({
    messages: [
      { id: "u1", role: "user", text: "Explain the migration." },
      { id: "a1", role: "assistant", text: "First, back up the data." },
      { id: "a2", role: "assistant", text: "Then, run the migration." },
    ],
  });

  assert.equal(draft.sections.length, 1);
  assert.deepEqual(draft.sections[0].sourceMessageIds, ["u1", "a1", "a2"]);
  assert.ok(
    draft.sections[0].body.indexOf("First, back up the data.") <
      draft.sections[0].body.indexOf("Then, run the migration."),
  );
  assert.match(draft.sections[0].body, /The responses continued as follows/);
});

test("preserves assistant context that appears before the first user turn", () => {
  const draft = createConversationNote({
    messages: [
      { id: "a0", role: "assistant", text: "How can I help?" },
      { id: "u1", role: "user", text: "Summarize this conversation." },
      { id: "a1", role: "assistant", text: "Here is the summary." },
    ],
  });

  assert.equal(draft.sections.length, 2);
  assert.equal(draft.sections[0].flowKind, "opening_context");
  assert.deepEqual(draft.sections[0].sourceMessageIds, ["a0"]);
  assert.deepEqual(draft.sections[1].sourceMessageIds, ["u1", "a1"]);
  assert.deepEqual(draft.source.messageIds, ["a0", "u1", "a1"]);
});

test("keeps output as plain text instead of adding HTML markup", () => {
  const draft = createConversationNote({
    messages: [
      { id: "u1", role: "user", text: "Write a short note." },
      { id: "a1", role: "assistant", text: "A plain text answer." },
    ],
  });
  const serializedText = [
    draft.overview,
    draft.closingState,
    ...draft.sections.flatMap((section) => [
      section.heading,
      section.body,
    ]),
  ].join("\n");

  assert.doesNotMatch(
    serializedText,
    /<\/?(?:article|div|h[1-6]|p|section|strong)(?:\s|>)/i,
  );
});

test("reports an unanswered final request without inventing a response", () => {
  const draft = createConversationNote({
    messages: [
      { id: "u1", role: "user", text: "Start with a draft." },
      { id: "a1", role: "assistant", text: "Here is a draft." },
      { id: "u2", role: "user", text: "Now remove the final paragraph." },
    ],
  });

  assert.equal(draft.sections[1].flowKind, "correction");
  assert.match(draft.sections[1].body, /No response followed this request yet/);
  assert.match(draft.closingState, /has not yet received a response/);
  assert.deepEqual(draft.sections[1].sourceMessageIds, ["u2"]);
});

test("ignores blank text but rejects duplicate source IDs", () => {
  const draft = createConversationNote({
    messages: [
      { id: "blank", role: "assistant", text: "   \n " },
      { id: "u1", role: "user", text: "Keep this." },
      { id: "a1", role: "assistant", text: "Kept." },
    ],
  });
  assert.equal(draft.source.messageCount, 2);
  assert.deepEqual(draft.source.messageIds, ["u1", "a1"]);

  assert.throws(
    () =>
      createConversationNote({
        messages: [
          { id: "same", role: "user", text: "One" },
          { id: "same", role: "assistant", text: "Two" },
        ],
      }),
    (error) =>
      error instanceof NoteEngineError &&
      error.code === "DUPLICATE_MESSAGE_ID",
  );
});

test("requires at least one non-empty user message", () => {
  assert.throws(
    () =>
      createConversationNote({
        messages: [
          { id: "a1", role: "assistant", text: "Assistant-only text." },
        ],
      }),
    (error) =>
      error instanceof NoteEngineError && error.code === "NO_USER_MESSAGE",
  );
});

test("exposes correction and transition classification independently", () => {
  assert.equal(classifyUserTurn("첫 질문", 0), "opening");
  assert.equal(classifyUserTurn("그거 말고 노트로 해줘", 1), "correction");
  assert.equal(classifyUserTurn("Next, add a title.", 2), "transition");
  assert.equal(classifyUserTurn("Could you make it shorter?", 3), "follow_up");
});

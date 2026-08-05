import assert from "node:assert/strict";
import test from "node:test";

import { validateShareUrl } from "../lib/chatgpt/index.ts";
import {
  NOTE_IMPORT_WORKFLOW_VERSION,
  canonicalizeImportedConversation,
  createNoteImportService,
  NoteImportWorkflowError,
  sha256Hex,
  type GeneratedImportDraft,
  type ImportedConversation,
  type ImportedNoteWrite,
  type ImportStoredNote,
  type NoteImportDependencies,
  type NoteImportRepository,
} from "../lib/note-import/index.ts";

const OWNER_A = "owner_abcdefghijklmnopqrstuvwxyz_123456";
const OWNER_B = "owner_bcdefghijklmnopqrstuvwxyz_1234567";
const SOURCE_URL = "https://chatgpt.com/share/safe-reimport-fixture";
const SHARE_ID = "safe-reimport-fixture";
const INITIAL_UPDATED_AT = "2026-08-01T00:00:00.000Z";
const REPLACED_UPDATED_AT = "2026-08-02T01:00:00.000Z";
const GENERATED_AT = "2026-08-02T00:00:00.000Z";

type TestNote = ImportStoredNote & {
  ownerKey: string;
  overview: string;
  sections: Array<Record<string, unknown>>;
  tags: string[];
  sourceTitle: string | null;
  sourceTimelineAt?: string | null;
  sourceLastVisibleAt?: string | null;
  sourceTimestampedVisibleMessageCount?: number | null;
  sourceVisibleMessageCount?: number | null;
  favorite: boolean;
  createdAt: string;
  generationMetadata?: ImportedNoteWrite["generationMetadata"];
  summarySchemaVersion?: ImportedNoteWrite["summarySchemaVersion"];
  summary?: ImportedNoteWrite["summary"];
  userEditedMarker?: string;
};

type CallCounts = {
  find: number;
  hasReplacementCandidate: number;
  create: number;
  replace: number;
  import: number;
  createDraft: number;
  digest: number;
};

type HarnessOptions = {
  stored?: TestNote | null;
  repository?: Partial<NoteImportRepository<TestNote>>;
  dependencies?: Partial<
    Omit<NoteImportDependencies<TestNote>, "repository">
  >;
};

function createHarness(options: HarnessOptions = {}) {
  let stored = options.stored === undefined ? null : options.stored;
  let lastCreate: ImportedNoteWrite | null = null;
  let lastReplace: ImportedNoteWrite | null = null;
  const calls: CallCounts = {
    find: 0,
    hasReplacementCandidate: 0,
    create: 0,
    replace: 0,
    import: 0,
    createDraft: 0,
    digest: 0,
  };

  const repository: NoteImportRepository<TestNote> = {
    async findBySourceUrl(ownerKey, normalizedUrl) {
      calls.find += 1;
      if (options.repository?.findBySourceUrl) {
        return options.repository.findBySourceUrl(ownerKey, normalizedUrl);
      }
      return stored?.ownerKey === ownerKey && stored.sourceUrl === normalizedUrl
        ? stored
        : null;
    },
    async hasReplacementCandidate(input) {
      calls.hasReplacementCandidate += 1;
      if (options.repository?.hasReplacementCandidate) {
        return options.repository.hasReplacementCandidate(input);
      }
      return Boolean(
        stored &&
          stored.ownerKey === input.ownerKey &&
          stored.id === input.noteId &&
          stored.sourceUrl === input.normalizedUrl &&
          stored.updatedAt === input.expectedUpdatedAt,
      );
    },
    async createImportedNote(ownerKey, input) {
      calls.create += 1;
      lastCreate = input;
      if (options.repository?.createImportedNote) {
        return options.repository.createImportedNote(ownerKey, input);
      }
      if (stored?.ownerKey === ownerKey && stored.sourceUrl === input.sourceUrl) {
        return { note: stored, disposition: "existing" };
      }
      stored = {
        id: "note-created",
        ownerKey,
        ...input,
        favorite: false,
        archived: false,
        createdAt: GENERATED_AT,
        updatedAt: GENERATED_AT,
      };
      return { note: stored, disposition: "created" };
    },
    async replaceImportedNote(input) {
      calls.replace += 1;
      lastReplace = input.note;
      if (options.repository?.replaceImportedNote) {
        return options.repository.replaceImportedNote(input);
      }
      if (
        !stored ||
        stored.ownerKey !== input.ownerKey ||
        stored.id !== input.noteId ||
        stored.sourceUrl !== input.normalizedUrl ||
        stored.updatedAt !== input.expectedUpdatedAt
      ) {
        return null;
      }
      stored = {
        ...stored,
        sourceTitle: input.note.sourceTitle,
        sourceMessageCount: input.note.sourceMessageCount,
        sourceTimelineAt: input.note.sourceTimelineAt,
        sourceLastVisibleAt: input.note.sourceLastVisibleAt,
        sourceTimestampedVisibleMessageCount:
          input.note.sourceTimestampedVisibleMessageCount,
        sourceVisibleMessageCount: input.note.sourceVisibleMessageCount,
        generationMetadata: input.note.generationMetadata,
        summarySchemaVersion: input.note.summarySchemaVersion,
        summary: input.note.summary,
        updatedAt: REPLACED_UPDATED_AT,
      };
      return stored;
    },
  };

  const imported = importedConversation();
  const draft = generatedDraft();
  const dependencyOverrides = options.dependencies;
  const dependencies: NoteImportDependencies<TestNote> = {
    repository,
    async importShareUrl(normalizedUrl) {
      calls.import += 1;
      if (dependencyOverrides?.importShareUrl) {
        return dependencyOverrides.importShareUrl(normalizedUrl);
      }
      return imported;
    },
    async createDraft(value) {
      calls.createDraft += 1;
      return dependencyOverrides?.createDraft
        ? await dependencyOverrides.createDraft(value)
        : draft;
    },
    noteEngineVersion:
      dependencyOverrides?.noteEngineVersion ?? "gptmemory-note-engine.v1",
    now: dependencyOverrides?.now ?? (() => GENERATED_AT),
    randomUUID:
      dependencyOverrides?.randomUUID ??
      (() => "00000000-0000-4000-8000-000000000001"),
    async sha256Hex(value) {
      calls.digest += 1;
      if (dependencyOverrides?.sha256Hex) {
        return dependencyOverrides.sha256Hex(value);
      }
      return sha256Hex(value);
    },
  };

  return {
    calls,
    imported,
    service: createNoteImportService(dependencies),
    getStored: () => stored,
    getLastCreate: () => lastCreate,
    getLastReplace: () => lastReplace,
  };
}

test("normalizes harmless share URL variants to one duplicate key", () => {
  for (const url of [
    `${SOURCE_URL}?utm_source=test`,
    `${SOURCE_URL}?utm_source=test#fragment`,
    `${SOURCE_URL}/?utm_medium=copy`,
  ]) {
    const result = validateShareUrl(url);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.normalizedUrl, SOURCE_URL);
      assert.equal(result.shareId, SHARE_ID);
    }
  }
});

test("returns an existing note before any import or write side effect", async () => {
  const existing = storedNote();
  const harness = createHarness({ stored: existing });

  const result = await harness.service.execute(importCommand());

  assert.deepEqual(result, {
    status: "already_exists",
    existing: {
      id: existing.id,
      title: existing.title,
      updatedAt: existing.updatedAt,
      archived: existing.archived,
      deletedAt: existing.deletedAt ?? null,
      sourceMessageCount: existing.sourceMessageCount ?? null,
    },
  });
  assert.deepEqual(harness.calls, {
    find: 1,
    hasReplacementCandidate: 0,
    create: 0,
    replace: 0,
    import: 0,
    createDraft: 0,
    digest: 0,
  });
});

test("scopes duplicate lookup and creation to the current owner", async () => {
  const ownerANote = storedNote({ ownerKey: OWNER_A });
  const harness = createHarness({ stored: ownerANote });

  const result = await harness.service.execute(
    importCommand({ ownerKey: OWNER_B }),
  );

  assert.equal(result.status, "created");
  assert.equal(harness.getStored()?.ownerKey, OWNER_B);
  assert.equal(harness.calls.find, 1);
  assert.equal(harness.calls.import, 1);
  assert.equal(harness.calls.create, 1);
});

test("stores exact generation versions and a stable source digest", async () => {
  const harness = createHarness();

  const result = await harness.service.execute(importCommand());

  assert.equal(result.status, "created");
  assert.equal(harness.getLastCreate()?.title, "새 노트 제목");
  assert.equal(harness.getLastCreate()?.overview, "legacy overview");
  assert.equal(harness.getLastCreate()?.summarySchemaVersion, "gptmemory.summary.v2");
  assert.deepEqual(harness.getLastCreate()?.sections, [
    {
      id: "section-1",
      heading: "첫 맥락",
      body: "새 본문",
      sourceMessageIds: ["u1", "a1"],
    },
    {
      id: "closing-state",
      heading: "대화가 도달한 지점",
      body: "새 도달점",
      sourceMessageIds: [],
    },
  ]);
  assert.equal(
    canonicalizeImportedConversation(harness.imported),
    '{"title":"대화 제목","messages":[{"role":"user","text":"질문"},{"role":"assistant","text":"답변"}]}',
  );
  const generationMetadata = harness.getLastCreate()?.generationMetadata;
  assert.equal(NOTE_IMPORT_WORKFLOW_VERSION, "gptmemory-note-import.v6");
  assert.deepEqual(generationMetadata, {
    runId: "00000000-0000-4000-8000-000000000001",
    workflowVersion: NOTE_IMPORT_WORKFLOW_VERSION,
    adapterVersion: "gptmemory-chatgpt-share.v4",
    noteEngineVersion: "gptmemory-note-engine.v1",
    noteSchemaVersion: "gptmemory.note-draft.v1",
    summarySchemaVersion: "gptmemory.summary.v2",
    summaryProvider: "gemini",
    summaryModel: "gemini-test-model",
    summaryEngineVersion: "gptmemory-note-summary.v2",
    summaryPromptVersion: "gptmemory-summary-prompt.v2",
    sourceShareId: SHARE_ID,
    sourceContentSha256:
      "b57425be2f9b3318551c853ba8bdfa2ccdc7532ec8d23fc75bebb563204d4353",
    sourceFetchedAt: "2026-08-01T23:59:00.000Z",
    generatedAt: GENERATED_AT,
  });
  assert.match(
    generationMetadata?.sourceContentSha256 ?? "",
    /^[a-f0-9]{64}$/,
  );
  assert.equal(harness.calls.digest, 1);
});

test("derives UTC timeline metadata in normalized visible-message order", async () => {
  const imported = importedConversation();
  imported.conversation.messages = [
    {
      id: "a0",
      role: "assistant",
      text: "앞선 표시 메시지",
      createdAt: "2026-08-01T09:00:00+09:00",
    },
    {
      id: "u-invalid",
      role: "user",
      text: "시간이 손상된 질문",
      createdAt: "not-a-timestamp",
    },
    {
      id: "u-first-valid",
      role: "user",
      text: "첫 유효 시간 질문",
      createdAt: "2026-08-03T12:34:56+09:00",
    },
    {
      id: "a-missing",
      role: "assistant",
      text: "시간 없는 답변",
      createdAt: null,
    },
    {
      id: "a-last-valid",
      role: "assistant",
      text: "마지막 유효 시간 메시지",
      createdAt: "2026-08-02T01:02:03.004Z",
    },
  ];
  const harness = createHarness({
    dependencies: {
      async importShareUrl() {
        return imported;
      },
    },
  });

  const result = await harness.service.execute(importCommand());

  assert.equal(result.status, "created");
  assert.equal(
    harness.getLastCreate()?.sourceTimelineAt,
    "2026-08-03T03:34:56.000Z",
  );
  assert.equal(
    harness.getLastCreate()?.sourceLastVisibleAt,
    "2026-08-02T01:02:03.004Z",
  );
  assert.equal(
    harness.getLastCreate()?.sourceTimestampedVisibleMessageCount,
    3,
  );
  assert.equal(harness.getLastCreate()?.sourceVisibleMessageCount, 5);
});

test("keeps nullable timeline anchors when visible timestamps are unusable", async () => {
  const imported = importedConversation();
  imported.conversation.messages = imported.conversation.messages.map(
    (message, index) => ({
      ...message,
      createdAt: index === 0 ? "invalid" : null,
    }),
  );
  const harness = createHarness({
    dependencies: {
      async importShareUrl() {
        return imported;
      },
    },
  });

  const result = await harness.service.execute(importCommand());

  assert.equal(result.status, "created");
  assert.equal(harness.getLastCreate()?.sourceTimelineAt, null);
  assert.equal(harness.getLastCreate()?.sourceLastVisibleAt, null);
  assert.equal(
    harness.getLastCreate()?.sourceTimestampedVisibleMessageCount,
    0,
  );
  assert.equal(harness.getLastCreate()?.sourceVisibleMessageCount, 2);
});

test("stores a versioned v3 state note through the same atomic import path", async () => {
  const harness = createHarness({
    dependencies: {
      async createDraft() {
        return generatedStateDraft();
      },
    },
  });

  const result = await harness.service.execute(importCommand());

  assert.equal(result.status, "created");
  assert.equal(
    harness.getLastCreate()?.summarySchemaVersion,
    "gptmemory.state-note.v3",
  );
  assert.equal(
    harness.getLastCreate()?.generationMetadata.summaryPromptVersion,
    "gptmemory-state-prompt.v3",
  );
  assert.equal(
    harness.getLastCreate()?.generationMetadata.summaryEngineVersion,
    "gptmemory-note-state.v3",
  );
  assert.equal(
    harness.getLastCreate()?.summary.schemaVersion,
    "gptmemory.state-note.v3",
  );
});

test("stores a versioned v4 content note through the same atomic import path", async () => {
  const harness = createHarness({
    dependencies: {
      async createDraft() {
        return generatedContentDraft();
      },
    },
  });

  const result = await harness.service.execute(importCommand());

  assert.equal(result.status, "created");
  assert.equal(
    harness.getLastCreate()?.summarySchemaVersion,
    "gptmemory.content-note.v4",
  );
  assert.equal(
    harness.getLastCreate()?.generationMetadata.summaryPromptVersion,
    "gptmemory-content-prompt.v4",
  );
  assert.equal(
    harness.getLastCreate()?.generationMetadata.summaryEngineVersion,
    "gptmemory-note-content.v4",
  );
  assert.equal(
    harness.getLastCreate()?.summary.schemaVersion,
    "gptmemory.content-note.v4",
  );
});

test("keeps the existing note byte-for-byte unchanged when import fails", async () => {
  const existing = storedNote();
  const before = JSON.stringify(existing);
  const harness = createHarness({
    stored: existing,
    dependencies: {
      async importShareUrl() {
        throw new Error("synthetic import failure");
      },
    },
  });

  await assert.rejects(
    harness.service.execute(replaceCommand()),
    /synthetic import failure/,
  );

  assert.equal(JSON.stringify(harness.getStored()), before);
  assert.equal(harness.calls.import, 1);
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.replace, 0);
});

test("keeps the existing note byte-for-byte unchanged when summary generation fails", async () => {
  const existing = storedNote();
  const before = JSON.stringify(existing);
  const harness = createHarness({
    stored: existing,
    dependencies: {
      async createDraft() {
        throw new Error("synthetic malformed structured output");
      },
    },
  });

  await assert.rejects(
    harness.service.execute(replaceCommand()),
    /synthetic malformed structured output/,
  );

  assert.equal(JSON.stringify(harness.getStored()), before);
  assert.equal(harness.calls.import, 1);
  assert.equal(harness.calls.createDraft, 1);
  assert.equal(harness.calls.digest, 0);
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.replace, 0);
});

test("does not write when the summary provider times out or rate limits", async () => {
  for (const providerFailure of ["synthetic timeout", "synthetic rate limit"]) {
    const existing = storedNote();
    const before = JSON.stringify(existing);
    const harness = createHarness({
      stored: existing,
      dependencies: {
        async createDraft() {
          throw new Error(providerFailure);
        },
      },
    });

    await assert.rejects(
      harness.service.execute(replaceCommand()),
      new RegExp(providerFailure),
    );
    assert.equal(JSON.stringify(harness.getStored()), before);
    assert.equal(harness.calls.create, 0);
    assert.equal(harness.calls.replace, 0);
  }
});

test("rejects a stale replacement before import or writes", async () => {
  const existing = storedNote();
  const before = JSON.stringify(existing);
  const harness = createHarness({ stored: existing });

  await assert.rejects(
    harness.service.execute(
      replaceCommand({
        replace: {
          noteId: existing.id,
          expectedUpdatedAt: "2026-07-31T00:00:00.000Z",
        },
      }),
    ),
    isNoteChangedConflict,
  );

  assert.equal(JSON.stringify(harness.getStored()), before);
  assert.equal(harness.calls.hasReplacementCandidate, 1);
  assert.equal(harness.calls.import, 0);
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.replace, 0);
});

test("does not mutate the existing note when the conditional write loses a race", async () => {
  const existing = storedNote();
  const before = JSON.stringify(existing);
  const harness = createHarness({
    stored: existing,
    repository: {
      async replaceImportedNote() {
        return null;
      },
    },
  });

  await assert.rejects(
    harness.service.execute(replaceCommand()),
    isNoteChangedConflict,
  );

  assert.equal(JSON.stringify(harness.getStored()), before);
  assert.equal(harness.calls.import, 1);
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.replace, 1);
});

test("successful replacement adds v4 content and preserves legacy edits and note state", async () => {
  const existing = storedNote({
    archived: true,
    deletedAt: "2026-08-01T12:00:00.000Z",
    favorite: true,
    userEditedMarker: "keep-state-outside-generated-fields",
  });
  const harness = createHarness({
    stored: existing,
    dependencies: {
      async createDraft() {
        return generatedContentDraft();
      },
    },
  });

  const result = await harness.service.execute(replaceCommand());

  assert.equal(result.status, "replaced");
  if (result.status !== "replaced") return;
  assert.equal(result.note.id, existing.id);
  assert.equal(result.note.createdAt, existing.createdAt);
  assert.equal(result.note.favorite, true);
  assert.equal(result.note.archived, true);
  assert.equal(result.note.deletedAt, existing.deletedAt);
  assert.equal(
    result.note.userEditedMarker,
    "keep-state-outside-generated-fields",
  );
  assert.equal(result.note.title, existing.title);
  assert.equal(result.note.overview, existing.overview);
  assert.deepEqual(result.note.sections, existing.sections);
  assert.deepEqual(result.note.tags, existing.tags);
  assert.equal(result.note.sourceMessageCount, 2);
  assert.equal(result.note.sourceTimelineAt, "2026-08-01T23:58:00.000Z");
  assert.equal(
    result.note.sourceLastVisibleAt,
    "2026-08-01T23:58:01.000Z",
  );
  assert.equal(result.note.sourceTimestampedVisibleMessageCount, 2);
  assert.equal(result.note.sourceVisibleMessageCount, 2);
  assert.equal(result.note.summarySchemaVersion, "gptmemory.content-note.v4");
  assert.equal(result.note.summary?.title.text, "주제 중심 새 노트");
  assert.equal(harness.getLastCreate(), null);
  assert.equal(
    harness.getLastReplace()?.generationMetadata.workflowVersion,
    NOTE_IMPORT_WORKFLOW_VERSION,
  );
});

test("maps an insert race to already_exists instead of a duplicate note", async () => {
  const raceWinner = storedNote({
    id: "note-race-winner",
    title: "먼저 저장된 노트",
  });
  const harness = createHarness({
    repository: {
      async createImportedNote() {
        return { note: raceWinner, disposition: "existing" };
      },
    },
  });

  const result = await harness.service.execute(importCommand());

  assert.deepEqual(result, {
    status: "already_exists",
    existing: {
      id: raceWinner.id,
      title: raceWinner.title,
      updatedAt: raceWinner.updatedAt,
      archived: raceWinner.archived,
      deletedAt: raceWinner.deletedAt ?? null,
      sourceMessageCount: raceWinner.sourceMessageCount ?? null,
    },
  });
  assert.equal(harness.calls.find, 1);
  assert.equal(harness.calls.import, 1);
  assert.equal(harness.calls.create, 1);
  assert.equal(harness.calls.replace, 0);
});

function storedNote(overrides: Partial<TestNote> = {}): TestNote {
  return {
    id: "note-existing",
    ownerKey: OWNER_A,
    title: "사용자가 편집한 기존 노트",
    overview: "사용자 편집 개요",
    sections: [{ id: "edited", heading: "편집", body: "보존할 내용" }],
    tags: ["사용자태그"],
    sourceUrl: SOURCE_URL,
    sourceTitle: "기존 원본 제목",
    sourceMessageCount: 1,
    sourceTimelineAt: "2026-07-30T23:00:00.000Z",
    sourceLastVisibleAt: "2026-07-30T23:30:00.000Z",
    sourceTimestampedVisibleMessageCount: 1,
    sourceVisibleMessageCount: 1,
    favorite: true,
    archived: false,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: INITIAL_UPDATED_AT,
    userEditedMarker: "existing-user-edit",
    ...overrides,
  };
}

function importedConversation(): ImportedConversation {
  return {
    conversation: {
      title: "대화 제목",
      messages: [
        {
          id: "u1",
          role: "user",
          text: "질문",
          createdAt: "2026-08-01T23:58:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          text: "답변",
          createdAt: "2026-08-01T23:58:01.000Z",
        },
      ],
    },
    source: {
      normalizedUrl: SOURCE_URL,
      shareId: SHARE_ID,
      fetchedAt: "2026-08-01T23:59:00.000Z",
      adapterVersion: "gptmemory-chatgpt-share.v4",
    },
  };
}

function generatedDraft(): GeneratedImportDraft {
  return {
    legacyDraft: {
      schemaVersion: "gptmemory.note-draft.v1",
      title: " legacy title ",
      overview: " legacy overview ",
      sections: [
        {
          id: "section-1",
          heading: " 첫 맥락 ",
          body: " 새 본문 ",
          sourceMessageIds: ["u1", "a1"],
        },
      ],
      closingState: " 새 도달점 ",
      tags: ["#AI", "ai", "기록"],
    },
    summary: {
      schemaVersion: "gptmemory.summary.v2",
      title: { text: "새 노트 제목", sourceMessageIds: ["u1", "a1"] },
      oneLineSummary: {
        text: "새 개요",
        sourceMessageIds: ["u1", "a1"],
      },
      keyPoints: [
        { text: "핵심 내용", sourceMessageIds: ["u1", "a1"] },
        { text: "핵심 결정", sourceMessageIds: ["u1"] },
        { text: "핵심 답변", sourceMessageIds: ["a1"] },
      ],
      outcomes: [],
      actionItems: [],
      necessaryContext: [
        { text: "중요 배경", sourceMessageIds: ["u1"] },
      ],
    },
    summaryProvider: {
      provider: "gemini",
      model: "gemini-test-model",
      engineVersion: "gptmemory-note-summary.v2",
      promptVersion: "gptmemory-summary-prompt.v2",
    },
  };
}

function generatedStateDraft(): GeneratedImportDraft {
  const legacyDraft = generatedDraft().legacyDraft;
  const evidence = (text: string, sourceMessageId: string) => ({
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote: text }],
  });
  return {
    legacyDraft,
    summary: {
      schemaVersion: "gptmemory.state-note.v3",
      title: evidence("새 상태 노트", "u1"),
      primaryGoal: evidence("질문에 답한다.", "u1"),
      currentState: evidence("답변이 제공됐고 열린 작업은 없다.", "a1"),
      confirmedDecisions: [],
      completedResults: [
        {
          ...evidence("질문에 대한 답변이 제공됐다.", "a1"),
          kind: "answer",
          completionBasis: "conversation_output",
        },
      ],
      openActions: [],
      unresolvedQuestions: [],
      activeConstraints: [],
      activeProposals: [],
      keyInsights: [],
      stateChanges: [],
    },
    summaryProvider: {
      provider: "gemini",
      model: "gemini-test-model",
      engineVersion: "gptmemory-note-state.v3",
      promptVersion: "gptmemory-state-prompt.v3",
    },
  };
}

function generatedContentDraft(): GeneratedImportDraft {
  const legacyDraft = generatedDraft().legacyDraft;
  const evidence = (text: string, sourceMessageId: string) => ({
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote: text }],
  });
  return {
    legacyDraft,
    summary: {
      schemaVersion: "gptmemory.content-note.v4",
      conversationType: "research",
      title: evidence("주제 중심 새 노트", "u1"),
      oneLineSummary: evidence(
        "질문과 답변의 핵심 내용을 주제별로 정리했다.",
        "a1",
      ),
      keyTakeaways: [
        evidence("사용자가 질문을 제시했다.", "u1"),
        evidence("Assistant가 실질적인 답변을 제공했다.", "a1"),
        evidence("내용을 주제 중심으로 다시 찾을 수 있다.", "a1"),
      ],
      topics: [
        {
          title: evidence("질문과 핵심 답변", "u1"),
          summary: evidence("질문에 대한 핵심 답변이 제공됐다.", "a1"),
          details: [],
        },
      ],
      conclusions: [evidence("핵심 답변을 내용 중심으로 보존한다.", "a1")],
      confirmedDecisions: [],
      actionItems: [],
      openQuestions: [],
      supportingInfo: {
        currentState: null,
        artifacts: [],
        activeProposals: [],
        constraintsAndChanges: [],
      },
    },
    summaryProvider: {
      provider: "gemini",
      model: "gemini-test-model",
      engineVersion: "gptmemory-note-content.v4",
      promptVersion: "gptmemory-content-prompt.v4",
    },
  };
}

function importCommand(overrides: Record<string, unknown> = {}) {
  return {
    ownerKey: OWNER_A,
    normalizedUrl: SOURCE_URL,
    shareId: SHARE_ID,
    ...overrides,
  } as Parameters<
    ReturnType<typeof createNoteImportService<TestNote>>["execute"]
  >[0];
}

function replaceCommand(overrides: Record<string, unknown> = {}) {
  return importCommand({
    replace: {
      noteId: "note-existing",
      expectedUpdatedAt: INITIAL_UPDATED_AT,
    },
    ...overrides,
  });
}

function isNoteChangedConflict(error: unknown): boolean {
  return (
    error instanceof NoteImportWorkflowError &&
    error.code === "NOTE_CHANGED_SINCE_CONFIRMATION" &&
    error.httpStatus === 409
  );
}

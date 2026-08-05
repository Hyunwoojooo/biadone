"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { stateNoteItemKey } from "@/lib/note-state/item-key";

type ViewKey =
  | "all"
  | "timeline"
  | "continue"
  | "favorites"
  | "archive"
  | "trash";
type MobilePane = "navigation" | "list" | "detail";
type SaveState = "idle" | "saving" | "saved" | "error";

type NoteSection = {
  id: string;
  heading: string;
  body: string;
  sourceMessageIds?: string[];
};

type SummaryEvidenceText = {
  text: string;
  sourceMessageIds: string[];
};

type StateEvidenceSnippet = {
  sourceMessageId: string;
  quote: string;
};

type StateEvidenceText = SummaryEvidenceText & {
  evidenceSnippets?: StateEvidenceSnippet[];
};

type StateDecisionItem = StateEvidenceText & {
  basis?: "conversation_explicit" | "post_import_user_confirmation";
};

type StateCompletedResult = StateEvidenceText & {
  kind?: string;
  completionBasis?: string;
  artifact?: { kind?: string; label: string; locator?: string };
};

type StateOpenAction = StateEvidenceText & {
  status: "open" | "in_progress" | "blocked" | "deferred";
  owner?: string;
  dueAt?: string;
};

type StateUnresolvedItem = StateEvidenceText & {
  kind?: "question" | "decision_needed" | "missing_information" | "blocker";
};

type StateProposalItem = StateEvidenceText & {
  proposedBy?: "user" | "assistant";
  status?: "active_proposal" | "deferred";
};

type StateChangeItem = StateEvidenceText & {
  kind?: string;
  from?: string | null;
  to?: string;
  reason?: string;
};

type StateNoteUserCorrection = {
  itemKey: string;
  textOverride?: string;
  hidden?: true;
  updatedAt: string;
};

type StateNoteCorrectionOperation =
  | {
      itemKey: string;
      operation: "override_text";
      text: string;
    }
  | {
      itemKey: string;
      operation: "hide" | "restore";
    };

type StateNoteItemSection =
  | "primaryGoal"
  | "currentState"
  | "confirmedDecisions"
  | "completedResults"
  | "openActions"
  | "unresolvedQuestions"
  | "activeConstraints"
  | "activeProposals"
  | "keyInsights"
  | "stateChanges";

type NoteStateV3 = {
  schemaVersion: typeof STATE_NOTE_SCHEMA_VERSION;
  title: StateEvidenceText;
  primaryGoal: StateEvidenceText | null;
  currentState: StateEvidenceText;
  confirmedDecisions: StateDecisionItem[];
  completedResults: StateCompletedResult[];
  openActions: StateOpenAction[];
  unresolvedQuestions: StateUnresolvedItem[];
  activeConstraints: StateEvidenceText[];
  activeProposals: StateProposalItem[];
  keyInsights: StateEvidenceText[];
  stateChanges: StateChangeItem[];
  userCorrections: StateNoteUserCorrection[];
};

type ContentConversationType =
  | "research"
  | "decision"
  | "problem_solving"
  | "planning"
  | "learning"
  | "mixed";

type ContentTopicDetail = StateEvidenceText & {
  kind:
    | "finding"
    | "explanation"
    | "comparison"
    | "rationale"
    | "change"
    | "example"
    | "implication"
    | "tradeoff"
    | "verification"
    | "step"
    | "risk"
    | "principle";
};

type ContentTopic = {
  title: StateEvidenceText;
  summary: StateEvidenceText;
  details: ContentTopicDetail[];
};

type ContentActionItem = StateEvidenceText & {
  status: "open" | "in_progress" | "blocked" | "deferred";
  owner?: string;
  dueAt?: string;
};

type ContentArtifact = StateEvidenceText & {
  kind: "file" | "url" | "code" | "document" | "configuration" | "other";
  label: string;
  locator?: string;
};

type NoteContentV4 = {
  schemaVersion: typeof CONTENT_NOTE_SCHEMA_VERSION;
  conversationType: ContentConversationType;
  title: StateEvidenceText;
  oneLineSummary: StateEvidenceText;
  keyTakeaways: StateEvidenceText[];
  topics: ContentTopic[];
  conclusions: StateEvidenceText[];
  confirmedDecisions: StateEvidenceText[];
  actionItems: ContentActionItem[];
  openQuestions: StateEvidenceText[];
  supportingInfo: {
    currentState: StateEvidenceText | null;
    artifacts: ContentArtifact[];
    activeProposals: StateEvidenceText[];
    constraintsAndChanges: StateEvidenceText[];
  };
};

type SummaryOutcome = SummaryEvidenceText & {
  kind: "conclusion" | "decision" | "proposal" | "unresolved";
};

type SummaryActionItem = SummaryEvidenceText & {
  owner?: string;
  status?: string;
  dueAt?: string;
};

type NoteSummaryV2 = {
  title: SummaryEvidenceText;
  oneLineSummary: SummaryEvidenceText;
  keyPoints: SummaryEvidenceText[];
  outcomes: SummaryOutcome[];
  actionItems: SummaryActionItem[];
  necessaryContext: SummaryEvidenceText[];
};

type NoteRecord = {
  id: string;
  title: string;
  overview: string;
  sections: NoteSection[];
  tags: string[];
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceMessageCount: number | null;
  sourceTimelineAt: string | null;
  sourceLastVisibleAt: string | null;
  sourceTimestampedVisibleMessageCount: number | null;
  sourceVisibleMessageCount: number | null;
  summarySchemaVersion: string | null;
  summary: NoteSummaryV2 | null;
  stateNote: NoteStateV3 | null;
  contentNote: NoteContentV4 | null;
  favorite: boolean;
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteDraft = Pick<
  NoteRecord,
  "title" | "overview" | "sections" | "tags"
>;

type ExistingNoteSummary = Pick<
  NoteRecord,
  "id" | "title" | "updatedAt" | "archived"
> & {
  deletedAt?: string | null;
  sourceMessageCount?: number | null;
};

type ImportResponsePayload = {
  status?: "created" | "replaced" | "already_exists";
  note?: Partial<NoteRecord>;
  existing?: ExistingNoteSummary;
  error?:
    | string
    | {
        code?: string;
        message?: string;
      };
  message?: string;
};

const OWNER_KEY_STORAGE = "gptmemory.owner-key.v1";
const SUMMARY_SCHEMA_VERSION = "gptmemory.summary.v2";
const STATE_NOTE_SCHEMA_VERSION = "gptmemory.state-note.v3";
const CONTENT_NOTE_SCHEMA_VERSION = "gptmemory.content-note.v4";
const OUTCOME_LABELS: Record<SummaryOutcome["kind"], string> = {
  conclusion: "결론",
  decision: "확정된 결정",
  proposal: "제안",
  unresolved: "미해결",
};

const viewMeta: Record<
  ViewKey,
  { label: string; title: string; eyebrow: string; symbol: string }
> = {
  all: {
    label: "모든 노트",
    title: "모든 노트",
    eyebrow: "내 노트",
    symbol: "▤",
  },
  timeline: {
    label: "시간순",
    title: "대화 타임라인",
    eyebrow: "대화가 이어진 순서",
    symbol: "→",
  },
  continue: {
    label: "이어가기",
    title: "대화 이어가기",
    eyebrow: "멈춘 지점에서 다시 시작",
    symbol: "↗",
  },
  favorites: {
    label: "즐겨찾기",
    title: "즐겨찾기",
    eyebrow: "다시 볼 노트",
    symbol: "♡",
  },
  archive: {
    label: "보관함",
    title: "보관함",
    eyebrow: "보관한 노트",
    symbol: "□",
  },
  trash: {
    label: "휴지통",
    title: "휴지통",
    eyebrow: "최근 삭제한 노트",
    symbol: "⌫",
  },
};

function createOwnerKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function getOwnerKey() {
  const current = window.localStorage.getItem(OWNER_KEY_STORAGE);
  if (current && /^[A-Za-z0-9_-]{32,128}$/.test(current)) return current;
  const next = createOwnerKey();
  window.localStorage.setItem(OWNER_KEY_STORAGE, next);
  return next;
}

function normalizeNote(input: Partial<NoteRecord>): NoteRecord {
  const summarySchemaVersion = input.summarySchemaVersion ?? null;
  return {
    id: String(input.id ?? ""),
    title: input.title?.trim() || "제목 없는 노트",
    overview: input.overview ?? "",
    sections: Array.isArray(input.sections)
      ? input.sections.map((section, index) => ({
          id: section.id || `section-${index + 1}`,
          heading: section.heading || `맥락 ${index + 1}`,
          body: section.body || "",
          sourceMessageIds: section.sourceMessageIds ?? [],
        }))
      : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    sourceUrl: input.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? null,
    sourceMessageCount:
      typeof input.sourceMessageCount === "number"
        ? input.sourceMessageCount
        : null,
    sourceTimelineAt: input.sourceTimelineAt ?? null,
    sourceLastVisibleAt: input.sourceLastVisibleAt ?? null,
    sourceTimestampedVisibleMessageCount:
      typeof input.sourceTimestampedVisibleMessageCount === "number"
        ? input.sourceTimestampedVisibleMessageCount
        : null,
    sourceVisibleMessageCount:
      typeof input.sourceVisibleMessageCount === "number"
        ? input.sourceVisibleMessageCount
        : null,
    summarySchemaVersion,
    summary:
      summarySchemaVersion === SUMMARY_SCHEMA_VERSION
        ? normalizeSummary(input.summary)
        : null,
    stateNote:
      summarySchemaVersion === STATE_NOTE_SCHEMA_VERSION
        ? normalizeStateNote(input.stateNote)
        : null,
    contentNote:
      summarySchemaVersion === CONTENT_NOTE_SCHEMA_VERSION
        ? normalizeContentNote(input.contentNote)
        : null,
    favorite: Boolean(input.favorite),
    archived: Boolean(input.archived),
    deletedAt: input.deletedAt ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("ko-KR", {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

type TimelineDayGroup = {
  key: string;
  yearLabel: string;
  monthLabel: string;
  dayLabel: string;
  dateTime: string | null;
  undated: boolean;
  notes: NoteRecord[];
};

const timelineYearFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
});
const timelineMonthFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
});
const timelineDayFormatter = new Intl.DateTimeFormat("ko-KR", {
  day: "numeric",
  weekday: "short",
});
const timelineTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
});
const timelineDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function sourceTimelineDate(note: NoteRecord) {
  if (!note.sourceTimelineAt) return null;
  const date = new Date(note.sourceTimelineAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function groupNotesByTimelineDay(notes: NoteRecord[]): TimelineDayGroup[] {
  const sorted = notes
    .map((note, index) => ({ note, index, date: sourceTimelineDate(note) }))
    .sort((left, right) => {
      if (left.date && right.date) {
        return left.date.getTime() - right.date.getTime() || left.index - right.index;
      }
      if (left.date) return -1;
      if (right.date) return 1;
      return left.index - right.index;
    });
  const groups: TimelineDayGroup[] = [];

  for (const { note, date } of sorted) {
    const key = date ? localDateKey(date) : "undated";
    const current = groups.at(-1);
    if (current?.key === key) {
      current.notes.push(note);
      continue;
    }
    groups.push(
      date
        ? {
            key,
            yearLabel: timelineYearFormatter.format(date),
            monthLabel: timelineMonthFormatter.format(date),
            dayLabel: timelineDayFormatter.format(date),
            dateTime: key,
            undated: false,
            notes: [note],
          }
        : {
            key,
            yearLabel: "",
            monthLabel: "날짜 없음",
            dayLabel: "대화 시간 정보가 없습니다",
            dateTime: null,
            undated: true,
            notes: [note],
          },
    );
  }

  return groups;
}

function sameLocalDay(left: Date, right: Date) {
  return localDateKey(left) === localDateKey(right);
}

function formatTimelineRange(note: NoteRecord) {
  const start = sourceTimelineDate(note);
  if (!start) return "";
  const last = note.sourceLastVisibleAt
    ? new Date(note.sourceLastVisibleAt)
    : null;
  const validLast = last && !Number.isNaN(last.getTime()) ? last : null;
  if (!validLast || validLast.getTime() <= start.getTime()) {
    return timelineTimeFormatter.format(start);
  }
  if (sameLocalDay(start, validLast)) {
    return `${timelineTimeFormatter.format(start)}–${timelineTimeFormatter.format(validLast)}`;
  }
  return `${timelineDateTimeFormatter.format(start)}–${timelineDateTimeFormatter.format(validLast)}`;
}

function formatTimestampCoverage(note: NoteRecord) {
  const timestamped = note.sourceTimestampedVisibleMessageCount;
  const visible = note.sourceVisibleMessageCount;
  if (timestamped === null || visible === null || visible < 1) return "";
  if (timestamped >= visible) return `${visible}개 메시지 시간 확인`;
  return `${timestamped}/${visible}개 메시지 시간 확인`;
}

function notePreview(note: NoteRecord) {
  const currentState = note.stateNote
    ? presentStateItem(
        note.stateNote,
        "currentState",
        note.stateNote.currentState,
      ).displayText
    : "";
  return (
    note.contentNote?.oneLineSummary.text ||
    currentState ||
    note.summary?.oneLineSummary.text ||
    note.overview ||
    note.sections.find((section) => section.body.trim())?.body ||
    "아직 내용이 없습니다."
  )
    .replace(/\s+/g, " ")
    .trim();
}

function noteTitle(note: NoteRecord) {
  return (
    note.contentNote?.title.text ||
    note.stateNote?.title.text ||
    note.summary?.title.text ||
    note.title
  );
}

function noteHasDecision(note: NoteRecord) {
  if (note.contentNote) return note.contentNote.confirmedDecisions.length > 0;
  const stateNote = note.stateNote;
  if (stateNote) {
    return stateNote.confirmedDecisions.some(
      (item) => !presentStateItem(stateNote, "confirmedDecisions", item).hidden,
    );
  }
  return (
    note.summary?.outcomes.some((outcome) => outcome.kind === "decision") ??
    false
  );
}

function noteHasActionItems(note: NoteRecord) {
  if (note.contentNote) return note.contentNote.actionItems.length > 0;
  const stateNote = note.stateNote;
  if (stateNote) {
    return stateNote.openActions.some(
      (item) => !presentStateItem(stateNote, "openActions", item).hidden,
    );
  }
  return Boolean(note.summary?.actionItems.length);
}

type ResumePack = {
  goal: string;
  summary: string;
  currentState: string;
  decisions: string[];
  context: string[];
  constraints: string[];
  openQuestions: string[];
  actions: string[];
  topicCount: number;
};

function visibleStateTexts(
  stateNote: NoteStateV3,
  section: StateNoteItemSection,
  items: StateEvidenceText[],
) {
  return presentStateItems(stateNote, section, items)
    .filter((entry) => !entry.hidden)
    .map((entry) => entry.displayText.trim())
    .filter(Boolean);
}

function legacyResumeSummary(note: NoteRecord) {
  return (
    note.overview.trim() ||
    note.sections.find((section) => section.body.trim())?.body ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isPendingSummaryAction(item: SummaryActionItem) {
  const status = item.status?.trim().toLowerCase();
  return (
    !status ||
    status === "open" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "deferred"
  );
}

function createResumePack(note: NoteRecord): ResumePack {
  if (note.contentNote) {
    return {
      goal: "",
      summary: note.contentNote.oneLineSummary.text.trim(),
      currentState:
        note.contentNote.supportingInfo.currentState?.text.trim() ?? "",
      decisions: note.contentNote.confirmedDecisions.map((item) => item.text),
      context: [],
      constraints: note.contentNote.supportingInfo.constraintsAndChanges.map(
        (item) => item.text,
      ),
      openQuestions: note.contentNote.openQuestions.map((item) => item.text),
      actions: note.contentNote.actionItems.map((item) => item.text),
      topicCount: note.contentNote.topics.length,
    };
  }

  if (note.stateNote) {
    const goal = note.stateNote.primaryGoal
      ? presentStateItem(
          note.stateNote,
          "primaryGoal",
          note.stateNote.primaryGoal,
        )
      : null;
    const currentState = presentStateItem(
      note.stateNote,
      "currentState",
      note.stateNote.currentState,
    );
    return {
      goal: goal && !goal.hidden ? goal.displayText.trim() : "",
      summary: "",
      currentState: currentState.hidden
        ? ""
        : currentState.displayText.trim(),
      decisions: visibleStateTexts(
        note.stateNote,
        "confirmedDecisions",
        note.stateNote.confirmedDecisions,
      ),
      context: [],
      constraints: visibleStateTexts(
        note.stateNote,
        "activeConstraints",
        note.stateNote.activeConstraints,
      ),
      openQuestions: visibleStateTexts(
        note.stateNote,
        "unresolvedQuestions",
        note.stateNote.unresolvedQuestions,
      ),
      actions: visibleStateTexts(
        note.stateNote,
        "openActions",
        note.stateNote.openActions,
      ),
      topicCount: 0,
    };
  }

  if (note.summary) {
    return {
      goal: "",
      summary: note.summary.oneLineSummary.text.trim(),
      currentState: "",
      decisions: note.summary.outcomes
        .filter((item) => item.kind === "decision")
        .map((item) => item.text),
      context: note.summary.necessaryContext.map((item) => item.text),
      constraints: [],
      openQuestions: note.summary.outcomes
        .filter((item) => item.kind === "unresolved")
        .map((item) => item.text),
      actions: note.summary.actionItems
        .filter(isPendingSummaryAction)
        .map((item) => item.text),
      topicCount: 0,
    };
  }

  return {
    goal: "",
    summary: legacyResumeSummary(note),
    currentState: "",
    decisions: [],
    context: [],
    constraints: [],
    openQuestions: [],
    actions: [],
    topicCount: 0,
  };
}

function appendResumeSection(lines: string[], heading: string, items: string[]) {
  const visibleItems = items.map((item) => item.trim()).filter(Boolean);
  if (!visibleItems.length) return;
  lines.push("", `## ${heading}`, ...visibleItems.map((item) => `- ${item}`));
}

function buildResumeBrief(note: NoteRecord) {
  const pack = createResumePack(note);
  const lines = [
    "# 이전 ChatGPT 대화 이어가기",
    `제목: ${noteTitle(note)}`,
  ];

  if (pack.goal) lines.push("", "## 목표", pack.goal);
  if (pack.summary) lines.push("", "## 대화 요약", pack.summary);
  if (pack.currentState) {
    lines.push("", "## 현재 도달한 지점", pack.currentState);
  }
  appendResumeSection(lines, "확정한 결정", pack.decisions);
  appendResumeSection(lines, "필요한 맥락", pack.context);
  appendResumeSection(lines, "제약과 변경 사항", pack.constraints);
  appendResumeSection(lines, "남은 질문", pack.openQuestions);
  appendResumeSection(lines, "다음에 할 일", pack.actions);
  lines.push(
    "",
    "## 이어갈 요청",
    "위 내용은 이전 대화에서 확인된 맥락입니다. 확정되지 않은 사실을 새로 만들지 말고, 남은 질문과 다음 행동을 기준으로 대화를 이어가 주세요.",
  );
  return lines.join("\n");
}

function isResumableNote(note: NoteRecord) {
  return Boolean(note.sourceUrl);
}

function normalizeSummary(value: unknown): NoteSummaryV2 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = normalizeEvidenceText(record.title);
  const oneLineSummary = normalizeEvidenceText(record.oneLineSummary);
  const keyPoints = normalizeEvidenceList(record.keyPoints);
  const necessaryContext = normalizeEvidenceList(record.necessaryContext);
  if (!title || !oneLineSummary || !keyPoints || !necessaryContext) return null;
  if (!Array.isArray(record.outcomes) || !Array.isArray(record.actionItems)) {
    return null;
  }

  const outcomes: SummaryOutcome[] = [];
  for (const value of record.outcomes) {
    const evidence = normalizeEvidenceText(value);
    if (!evidence || !value || typeof value !== "object") return null;
    const kind = (value as Record<string, unknown>).kind;
    if (
      kind !== "conclusion" &&
      kind !== "decision" &&
      kind !== "proposal" &&
      kind !== "unresolved"
    ) {
      return null;
    }
    outcomes.push({ ...evidence, kind });
  }

  const actionItems: SummaryActionItem[] = [];
  for (const value of record.actionItems) {
    const evidence = normalizeEvidenceText(value);
    if (!evidence || !value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    actionItems.push({
      ...evidence,
      ...(typeof item.owner === "string" && item.owner.trim()
        ? { owner: item.owner.trim() }
        : {}),
      ...(typeof item.status === "string" && item.status.trim()
        ? { status: item.status.trim() }
        : {}),
      ...(typeof item.dueAt === "string" && item.dueAt.trim()
        ? { dueAt: item.dueAt.trim() }
        : {}),
    });
  }

  return {
    title,
    oneLineSummary,
    keyPoints,
    outcomes,
    actionItems,
    necessaryContext,
  };
}

function normalizeStateNote(value: unknown): NoteStateV3 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== STATE_NOTE_SCHEMA_VERSION) return null;
  const title = normalizeStateEvidenceText(record.title);
  const primaryGoal =
    record.primaryGoal === null
      ? null
      : normalizeStateEvidenceText(record.primaryGoal);
  const currentState = normalizeStateEvidenceText(record.currentState);
  if (!title || record.primaryGoal === undefined || !currentState) return null;

  const confirmedDecisions = normalizeStateEvidenceArray(
    record.confirmedDecisions,
  );
  const completedResults = normalizeStateEvidenceArray(record.completedResults);
  const openActions = normalizeStateEvidenceArray(record.openActions);
  const unresolvedQuestions = normalizeStateEvidenceArray(
    record.unresolvedQuestions,
  );
  const activeConstraints = normalizeStateEvidenceArray(record.activeConstraints);
  const activeProposals = normalizeStateEvidenceArray(record.activeProposals);
  const keyInsights = normalizeStateEvidenceArray(record.keyInsights);
  const stateChanges = normalizeStateEvidenceArray(record.stateChanges);
  const userCorrections = normalizeStateNoteCorrections(record.userCorrections);
  if (
    !confirmedDecisions ||
    !completedResults ||
    !openActions ||
    !unresolvedQuestions ||
    !activeConstraints ||
    !activeProposals ||
    !keyInsights ||
    !stateChanges ||
    !userCorrections
  ) {
    return null;
  }

  return {
    schemaVersion: STATE_NOTE_SCHEMA_VERSION,
    title,
    primaryGoal,
    currentState,
    confirmedDecisions: confirmedDecisions.map((item, index) => {
      const raw = (record.confirmedDecisions as unknown[])[index];
      const detail = raw as Record<string, unknown>;
      return {
        ...item,
        ...(detail.basis === "conversation_explicit" ||
        detail.basis === "post_import_user_confirmation"
          ? { basis: detail.basis }
          : {}),
      };
    }),
    completedResults: completedResults.map((item, index) => {
      const raw = (record.completedResults as unknown[])[index];
      const detail = raw as Record<string, unknown>;
      const artifact = normalizeStateArtifact(detail.artifact);
      return {
        ...item,
        ...(typeof detail.kind === "string" ? { kind: detail.kind } : {}),
        ...(typeof detail.completionBasis === "string"
          ? { completionBasis: detail.completionBasis }
          : {}),
        ...(artifact ? { artifact } : {}),
      };
    }),
    openActions: openActions.map((item, index) => {
      const raw = (record.openActions as unknown[])[index];
      const detail = raw as Record<string, unknown>;
      const status =
        detail.status === "in_progress" ||
        detail.status === "blocked" ||
        detail.status === "deferred"
          ? detail.status
          : "open";
      return {
        ...item,
        status,
        ...(typeof detail.owner === "string" && detail.owner.trim()
          ? { owner: detail.owner.trim() }
          : {}),
        ...(typeof detail.dueAt === "string" && detail.dueAt.trim()
          ? { dueAt: detail.dueAt.trim() }
          : {}),
      };
    }),
    unresolvedQuestions: unresolvedQuestions.map((item, index) => {
      const raw = (record.unresolvedQuestions as unknown[])[index];
      const kind = (raw as Record<string, unknown>).kind;
      return {
        ...item,
        ...(kind === "question" ||
        kind === "decision_needed" ||
        kind === "missing_information" ||
        kind === "blocker"
          ? { kind }
          : {}),
      };
    }),
    activeConstraints,
    activeProposals: activeProposals.map((item, index) => {
      const raw = (record.activeProposals as unknown[])[index];
      const detail = raw as Record<string, unknown>;
      return {
        ...item,
        ...(detail.proposedBy === "user" || detail.proposedBy === "assistant"
          ? { proposedBy: detail.proposedBy }
          : {}),
        ...(detail.status === "active_proposal" || detail.status === "deferred"
          ? { status: detail.status }
          : {}),
      };
    }),
    keyInsights,
    stateChanges: stateChanges.map((item, index) => {
      const raw = (record.stateChanges as unknown[])[index];
      const detail = raw as Record<string, unknown>;
      return {
        ...item,
        ...(typeof detail.kind === "string" ? { kind: detail.kind } : {}),
        ...(typeof detail.from === "string" || detail.from === null
          ? { from: detail.from }
          : {}),
        ...(typeof detail.to === "string" ? { to: detail.to } : {}),
        ...(typeof detail.reason === "string" ? { reason: detail.reason } : {}),
      };
    }),
    userCorrections,
  };
}

function normalizeContentNote(value: unknown): NoteContentV4 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== CONTENT_NOTE_SCHEMA_VERSION ||
    !isContentConversationType(record.conversationType)
  ) {
    return null;
  }
  const title = normalizeStateEvidenceText(record.title);
  const oneLineSummary = normalizeStateEvidenceText(record.oneLineSummary);
  const keyTakeaways = normalizeStateEvidenceArray(record.keyTakeaways);
  const conclusions = normalizeStateEvidenceArray(record.conclusions);
  const confirmedDecisions = normalizeStateEvidenceArray(
    record.confirmedDecisions,
  );
  const openQuestions = normalizeStateEvidenceArray(record.openQuestions);
  if (
    !title ||
    !oneLineSummary ||
    !keyTakeaways ||
    !conclusions ||
    !confirmedDecisions ||
    !openQuestions ||
    !Array.isArray(record.topics) ||
    !Array.isArray(record.actionItems) ||
    !record.supportingInfo ||
    typeof record.supportingInfo !== "object" ||
    Array.isArray(record.supportingInfo)
  ) {
    return null;
  }

  const topics: ContentTopic[] = [];
  for (const rawTopic of record.topics) {
    if (!rawTopic || typeof rawTopic !== "object" || Array.isArray(rawTopic)) {
      return null;
    }
    const topic = rawTopic as Record<string, unknown>;
    const topicTitle = normalizeStateEvidenceText(topic.title);
    const topicSummary = normalizeStateEvidenceText(topic.summary);
    if (!topicTitle || !topicSummary || !Array.isArray(topic.details)) return null;
    const details: ContentTopicDetail[] = [];
    for (const rawDetail of topic.details) {
      const detail = normalizeStateEvidenceText(rawDetail);
      const kind =
        rawDetail && typeof rawDetail === "object" && !Array.isArray(rawDetail)
          ? (rawDetail as Record<string, unknown>).kind
          : null;
      if (!detail || !isContentDetailKind(kind)) return null;
      details.push({ ...detail, kind });
    }
    topics.push({ title: topicTitle, summary: topicSummary, details });
  }

  const actionItems: ContentActionItem[] = [];
  for (const rawAction of record.actionItems) {
    const action = normalizeStateEvidenceText(rawAction);
    const detail =
      rawAction && typeof rawAction === "object" && !Array.isArray(rawAction)
        ? (rawAction as Record<string, unknown>)
        : null;
    if (!action || !detail || !isContentActionStatus(detail.status)) return null;
    actionItems.push({
      ...action,
      status: detail.status,
      ...(typeof detail.owner === "string" && detail.owner.trim()
        ? { owner: detail.owner.trim() }
        : {}),
      ...(typeof detail.dueAt === "string" && detail.dueAt.trim()
        ? { dueAt: detail.dueAt.trim() }
        : {}),
    });
  }

  const supporting = record.supportingInfo as Record<string, unknown>;
  const currentState =
    supporting.currentState === null
      ? null
      : normalizeStateEvidenceText(supporting.currentState);
  const activeProposals = normalizeStateEvidenceArray(supporting.activeProposals);
  const constraintsAndChanges = normalizeStateEvidenceArray(
    supporting.constraintsAndChanges,
  );
  if (
    supporting.currentState === undefined ||
    (supporting.currentState !== null && !currentState) ||
    !activeProposals ||
    !constraintsAndChanges ||
    !Array.isArray(supporting.artifacts)
  ) {
    return null;
  }
  const artifacts: ContentArtifact[] = [];
  for (const rawArtifact of supporting.artifacts) {
    const artifact = normalizeStateEvidenceText(rawArtifact);
    const detail =
      rawArtifact &&
      typeof rawArtifact === "object" &&
      !Array.isArray(rawArtifact)
        ? (rawArtifact as Record<string, unknown>)
        : null;
    if (
      !artifact ||
      !detail ||
      !isContentArtifactKind(detail.kind) ||
      typeof detail.label !== "string" ||
      !detail.label.trim()
    ) {
      return null;
    }
    artifacts.push({
      ...artifact,
      kind: detail.kind,
      label: detail.label.trim(),
      ...(typeof detail.locator === "string" && detail.locator.trim()
        ? { locator: detail.locator.trim() }
        : {}),
    });
  }

  return {
    schemaVersion: CONTENT_NOTE_SCHEMA_VERSION,
    conversationType: record.conversationType,
    title,
    oneLineSummary,
    keyTakeaways,
    topics,
    conclusions,
    confirmedDecisions,
    actionItems,
    openQuestions,
    supportingInfo: {
      currentState,
      artifacts,
      activeProposals,
      constraintsAndChanges,
    },
  };
}

function isContentConversationType(value: unknown): value is ContentConversationType {
  return (
    value === "research" ||
    value === "decision" ||
    value === "problem_solving" ||
    value === "planning" ||
    value === "learning" ||
    value === "mixed"
  );
}

function isContentDetailKind(value: unknown): value is ContentTopicDetail["kind"] {
  return (
    value === "finding" ||
    value === "explanation" ||
    value === "comparison" ||
    value === "rationale" ||
    value === "change" ||
    value === "example" ||
    value === "implication" ||
    value === "tradeoff" ||
    value === "verification" ||
    value === "step" ||
    value === "risk" ||
    value === "principle"
  );
}

function isContentActionStatus(value: unknown): value is ContentActionItem["status"] {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "deferred"
  );
}

function isContentArtifactKind(value: unknown): value is ContentArtifact["kind"] {
  return (
    value === "file" ||
    value === "url" ||
    value === "code" ||
    value === "document" ||
    value === "configuration" ||
    value === "other"
  );
}

function normalizeStateNoteCorrections(
  value: unknown,
): StateNoteUserCorrection[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const corrections: StateNoteUserCorrection[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.itemKey !== "string" ||
      !record.itemKey.trim() ||
      typeof record.updatedAt !== "string" ||
      !record.updatedAt.trim() ||
      keys.has(record.itemKey)
    ) {
      return null;
    }
    const textOverride =
      typeof record.textOverride === "string" && record.textOverride.trim()
        ? record.textOverride.trim()
        : undefined;
    const hidden = record.hidden === true;
    if (!textOverride && !hidden) return null;
    keys.add(record.itemKey);
    corrections.push({
      itemKey: record.itemKey,
      updatedAt: record.updatedAt,
      ...(textOverride ? { textOverride } : {}),
      ...(hidden ? { hidden: true as const } : {}),
    });
  }
  return corrections;
}

function normalizeStateArtifact(
  value: unknown,
): StateCompletedResult["artifact"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || !record.label.trim()) return null;
  return {
    label: record.label.trim(),
    ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
    ...(typeof record.locator === "string" && record.locator.trim()
      ? { locator: record.locator.trim() }
      : {}),
  };
}

function normalizeStateEvidenceArray(
  value: unknown,
): StateEvidenceText[] | null {
  if (!Array.isArray(value)) return null;
  const result: StateEvidenceText[] = [];
  for (const item of value) {
    const evidence = normalizeStateEvidenceText(item);
    if (!evidence) return null;
    result.push(evidence);
  }
  return result;
}

function normalizeStateEvidenceText(value: unknown): StateEvidenceText | null {
  const base = normalizeEvidenceText(value);
  if (!base || !value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawSnippets = Array.isArray(record.evidenceSnippets)
    ? record.evidenceSnippets
    : Array.isArray(record.evidence)
      ? record.evidence
      : [];
  const evidenceSnippets: StateEvidenceSnippet[] = [];
  for (const raw of rawSnippets) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const snippet = raw as Record<string, unknown>;
    if (
      typeof snippet.sourceMessageId !== "string" ||
      !snippet.sourceMessageId.trim() ||
      typeof snippet.quote !== "string" ||
      !snippet.quote.trim()
    ) {
      continue;
    }
    evidenceSnippets.push({
      sourceMessageId: snippet.sourceMessageId.trim(),
      quote: snippet.quote.trim(),
    });
  }
  return {
    ...base,
    ...(evidenceSnippets.length ? { evidenceSnippets } : {}),
  };
}

function normalizeEvidenceList(value: unknown): SummaryEvidenceText[] | null {
  if (!Array.isArray(value)) return null;
  const result: SummaryEvidenceText[] = [];
  for (const item of value) {
    const evidence = normalizeEvidenceText(item);
    if (!evidence) return null;
    result.push(evidence);
  }
  return result;
}

function normalizeEvidenceText(value: unknown): SummaryEvidenceText | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.text !== "string" ||
    !record.text.trim() ||
    !Array.isArray(record.sourceMessageIds) ||
    record.sourceMessageIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    return null;
  }
  return {
    text: record.text.trim(),
    sourceMessageIds: record.sourceMessageIds.map((id) => String(id).trim()),
  };
}

function parseError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as Record<string, unknown>).message === "string"
  ) {
    return (record.error as { message: string }).message;
  }
  return fallback;
}

function ConversationTimeline({
  notes,
  selectedId,
  onChoose,
}: {
  notes: NoteRecord[];
  selectedId: string | null;
  onChoose: (id: string) => void;
}) {
  const groups = useMemo(() => groupNotesByTimelineDay(notes), [notes]);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedButtonRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedId, groups]);

  return (
    <div
      className="timeline-scroll"
      role="region"
      aria-label="대화 타임라인. 왼쪽은 과거, 오른쪽은 최신입니다."
      tabIndex={0}
    >
      <ol className="timeline-track">
        {groups.map((group) => {
          const headingId = `timeline-date-${group.key}`;
          return (
            <li
              className={`timeline-day-group ${group.undated ? "undated" : ""}`}
              key={group.key}
            >
              <section aria-labelledby={headingId}>
                <header className="timeline-date-label" id={headingId}>
                  {group.dateTime ? (
                    <time dateTime={group.dateTime}>
                      <span>{group.yearLabel}</span>
                      <strong>{group.monthLabel}</strong>
                      <small>{group.dayLabel}</small>
                    </time>
                  ) : (
                    <span>
                      <strong>{group.monthLabel}</strong>
                      <small>{group.dayLabel}</small>
                    </span>
                  )}
                </header>
                <ol className="timeline-day-entries">
                  {group.notes.map((note) => {
                    const selected = selectedId === note.id;
                    const coverage = formatTimestampCoverage(note);
                    return (
                      <li className="timeline-entry" key={note.id}>
                        <button
                          className={`timeline-note-card ${selected ? "selected" : ""}`}
                          ref={selected ? selectedButtonRef : undefined}
                          type="button"
                          onClick={() => onChoose(note.id)}
                          aria-current={selected || undefined}
                        >
                          <span className="note-card-topline">
                            <strong>{noteTitle(note)}</strong>
                          </span>
                          <span className="note-card-preview">
                            {notePreview(note)}
                          </span>
                          <span className="note-card-meta">
                            {noteHasDecision(note) ? (
                              <span className="note-card-signal decision">
                                결정 있음
                              </span>
                            ) : null}
                            {noteHasActionItems(note) ? (
                              <span className="note-card-signal action">
                                할 일 있음
                              </span>
                            ) : null}
                            {group.undated ? (
                              <span className="timeline-date-missing">
                                날짜 없음
                              </span>
                            ) : (
                              <time dateTime={note.sourceTimelineAt ?? undefined}>
                                {formatTimelineRange(note)}
                              </time>
                            )}
                          </span>
                          {coverage ? (
                            <span className="timeline-coverage">{coverage}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type ResumeCopyState = {
  noteId: string;
  result: "copied" | "error";
} | null;

function ResumeDashboard({
  notes,
  selectedId,
  onChoose,
  onImport,
}: {
  notes: NoteRecord[];
  selectedId: string | null;
  onChoose: (id: string) => void;
  onImport: () => void;
}) {
  const [copyState, setCopyState] = useState<ResumeCopyState>(null);

  const copyResumeBrief = async (note: NoteRecord) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(buildResumeBrief(note));
      setCopyState({ noteId: note.id, result: "copied" });
    } catch {
      setCopyState({ noteId: note.id, result: "error" });
    }
  };

  if (!notes.length) {
    return (
      <div className="resume-empty">
        <span aria-hidden="true">↗</span>
        <h2>이어갈 대화를 하나 남겨보세요</h2>
        <p>
          중요한 ChatGPT 대화 하나를 가져오면, 멈춘 지점과 결정·남은
          질문을 다시 시작할 문맥으로 정리합니다.
        </p>
        <button type="button" onClick={onImport}>
          대화 가져오기
        </button>
      </div>
    );
  }

  return (
    <div className="resume-dashboard">
      <section className="resume-intro" aria-label="이어가기 사용 안내">
        <span aria-hidden="true">↗</span>
        <div>
          <strong>요약을 넘어, 멈춘 지점에서 다시 시작하세요.</strong>
          <p>확인된 결정과 제약, 남은 질문만 모아 다음 대화 문맥을 만듭니다.</p>
        </div>
      </section>

      <ol className="resume-card-list">
        {notes.map((note) => {
          const pack = createResumePack(note);
          const selected = selectedId === note.id;
          const structured = Boolean(
            note.contentNote || note.stateNote || note.summary,
          );
          const copyResult =
            copyState?.noteId === note.id ? copyState.result : null;

          return (
            <li key={note.id}>
              <article
                className={`resume-card ${selected ? "selected" : ""}`}
              >
                <button
                  className="resume-card-main"
                  type="button"
                  onClick={() => onChoose(note.id)}
                  aria-current={selected || undefined}
                >
                  <span className="resume-card-kicker">대화 결산서</span>
                  <strong>{noteTitle(note)}</strong>
                  <span className="resume-card-summary">
                    {pack.currentState || pack.summary || pack.goal}
                  </span>
                </button>

                <dl className="resume-stats" aria-label="대화에서 정리한 항목">
                  {note.sourceMessageCount !== null ? (
                    <div>
                      <dt>메시지</dt>
                      <dd>{note.sourceMessageCount}</dd>
                    </div>
                  ) : null}
                  {structured && pack.topicCount > 0 ? (
                    <div>
                      <dt>주제</dt>
                      <dd>{pack.topicCount}</dd>
                    </div>
                  ) : null}
                  {structured ? (
                    <>
                      <div>
                        <dt>결정</dt>
                        <dd>{pack.decisions.length}</dd>
                      </div>
                      <div>
                        <dt>다음 행동</dt>
                        <dd>{pack.actions.length}</dd>
                      </div>
                      <div>
                        <dt>남은 질문</dt>
                        <dd>{pack.openQuestions.length}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>

                <div className="resume-card-footer">
                  <button
                    className="resume-copy-button"
                    type="button"
                    onClick={() => void copyResumeBrief(note)}
                  >
                    {copyResult === "copied"
                      ? "문맥을 복사했어요"
                      : "이어가기 문맥 복사"}
                  </button>
                  {copyResult ? (
                    <span
                      className={`resume-copy-status ${copyResult}`}
                      role="status"
                    >
                      {copyResult === "copied"
                        ? "새 ChatGPT 대화에 붙여넣어 이어갈 수 있습니다."
                        : "복사하지 못했습니다. 브라우저 권한을 확인해주세요."}
                    </span>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function GPTMemoryApp() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [view, setView] = useState<ViewKey>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [detailResetToken, setDetailResetToken] = useState(0);
  const queryTimer = useRef<number | null>(null);
  const [ownerKey, setOwnerKey] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setOwnerKey(getOwnerKey()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (queryTimer.current) window.clearTimeout(queryTimer.current);
    },
    [],
  );

  const resumeNotes = useMemo(
    () => notes.filter(isResumableNote),
    [notes],
  );
  const selectableNotes = view === "continue" ? resumeNotes : notes;
  const selectedNote =
    selectableNotes.find((note) => note.id === selectedId) ??
    selectableNotes[0] ??
    null;
  const currentViewCount =
    view === "continue" ? resumeNotes.length : notes.length;

  const loadNotes = useCallback(
    async (nextView = view, nextQuery = query, nextTag = activeTag) => {
      if (!ownerKey) return;
      setLoading(true);
      setLoadError("");
      try {
        const requestView = nextView === "continue" ? "all" : nextView;
        const params = new URLSearchParams({ view: requestView });
        if (nextQuery.trim()) params.set("q", nextQuery.trim());
        if (nextTag) params.set("tag", nextTag);
        const response = await fetch(`/api/notes?${params.toString()}`, {
          headers: { "x-gptmemory-owner": ownerKey },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          notes?: Partial<NoteRecord>[];
        };
        if (!response.ok) {
          throw new Error(parseError(payload, "노트를 불러오지 못했습니다."));
        }
        const nextNotes = (payload.notes ?? []).map(normalizeNote);
        const nextSelectableNotes =
          nextView === "continue"
            ? nextNotes.filter(isResumableNote)
            : nextNotes;
        setNotes(nextNotes);
        setSelectedId((current) => {
          if (
            current &&
            nextSelectableNotes.some((note) => note.id === current)
          ) {
            return current;
          }
          return nextSelectableNotes[0]?.id ?? null;
        });
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "노트를 불러오지 못했습니다.",
        );
      } finally {
        setLoading(false);
      }
    },
    [activeTag, ownerKey, query, view],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotes(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNotes]);

  useEffect(() => {
    if (selectedId !== null) return;
    const timer = window.setTimeout(() => setMobilePane("list"), 0);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  const changeQuery = (value: string) => {
    setQueryInput(value);
    if (queryTimer.current) window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => setQuery(value), 260);
  };

  const changeView = (nextView: ViewKey) => {
    setView(nextView);
    setActiveTag(null);
    setMobilePane("list");
  };

  const chooseTag = (tag: string | null) => {
    setActiveTag(tag);
    setView("all");
    setMobilePane("list");
  };

  const chooseNote = (id: string) => {
    setSelectedId(id);
    setMobilePane("detail");
  };

  const replaceNote = (updated: NoteRecord) => {
    setNotes((current) =>
      current.map((note) => (note.id === updated.id ? updated : note)),
    );
  };

  const removeFromCurrentList = (id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) =>
      note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
    );
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [notes]);

  return (
    <main
      className="memory-app"
      data-mobile-pane={mobilePane}
      data-view={view}
    >
      <aside className="sidebar" aria-label="노트 탐색">
        <div className="brand-row">
          <button
            className="brand-button"
            type="button"
            onClick={() => changeView("all")}
            aria-label="GPTMemory 모든 노트"
          >
            <span className="brand-mark" aria-hidden="true">
              M
            </span>
            <span>GPTMemory</span>
          </button>
          <button
            className="icon-button sidebar-settings"
            type="button"
            aria-label="설정"
            title="설정은 곧 제공됩니다"
          >
            ···
          </button>
        </div>

        <div className="profile-card">
          <span className="profile-orb" aria-hidden="true">
            나
          </span>
          <span>
            <strong>내 대화</strong>
            <small>이 브라우저의 개인 노트</small>
          </span>
        </div>

        <nav className="nav-block" aria-label="빠른 메뉴">
          <p className="nav-label">빠른 메뉴</p>
          {(Object.keys(viewMeta) as ViewKey[]).map((key) => (
            <button
              className={`nav-item ${view === key && !activeTag ? "active" : ""}`}
              key={key}
              type="button"
              onClick={() => changeView(key)}
              aria-current={view === key && !activeTag ? "page" : undefined}
            >
              <span className="nav-symbol" aria-hidden="true">
                {viewMeta[key].symbol}
              </span>
              <span>{viewMeta[key].label}</span>
              {key === view && !loading ? (
                <span className="nav-count">{currentViewCount}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="nav-block tag-block">
          <div className="nav-label-row">
            <p className="nav-label">태그</p>
            {activeTag ? (
              <button type="button" onClick={() => chooseTag(null)}>
                지우기
              </button>
            ) : null}
          </div>
          {tags.length ? (
            tags.map(([tag, count]) => (
              <button
                className={`tag-nav-item ${activeTag === tag ? "active" : ""}`}
                key={tag}
                type="button"
                onClick={() => chooseTag(tag)}
              >
                <span aria-hidden="true">#</span>
                <span>{tag}</span>
                <small>{count}</small>
              </button>
            ))
          ) : (
            <p className="sidebar-hint">노트를 만들면 태그가 여기에 모입니다.</p>
          )}
        </div>

        <div className="privacy-note">
          <span aria-hidden="true">◌</span>
          <p>
            공개 공유 링크만 가져옵니다.
            <br />
            정제된 대화는 내용 중심 노트 생성을 위해 Google Gemini API로
            전송됩니다. 원본 공유 HTML과 복원된 전체 메시지 배열은
            GPTMemory에 저장하지 않습니다.
          </p>
        </div>
      </aside>

      <section
        className="notes-pane"
        aria-label={
          view === "timeline"
            ? "대화 타임라인"
            : view === "continue"
              ? "대화 이어가기"
              : "노트 목록"
        }
      >
        <div className="list-topbar">
          <button
            className="mobile-nav-button"
            type="button"
            onClick={() => setMobilePane("navigation")}
            aria-label="탐색 열기"
          >
            ☰
          </button>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">노트 검색</span>
            <input
              value={queryInput}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="노트 검색"
              type="search"
            />
            {queryInput ? (
              <button
                type="button"
                onClick={() => changeQuery("")}
                aria-label="검색어 지우기"
              >
                ×
              </button>
            ) : null}
          </label>
          <button
            className="import-button"
            type="button"
            onClick={() => setImportOpen(true)}
            aria-label="ChatGPT 대화 가져오기"
            title="ChatGPT 대화 가져오기"
          >
            +
          </button>
        </div>

        <header className="list-heading">
          <div>
            <p>{activeTag ? "태그 노트" : viewMeta[view].eyebrow}</p>
            <h1>{activeTag ? `#${activeTag}` : viewMeta[view].title}</h1>
          </div>
          <span>{loading ? "…" : `${currentViewCount}개 노트`}</span>
        </header>

        <div
          className={`note-list ${
            view === "timeline"
              ? "timeline-list"
              : view === "continue"
                ? "resume-list"
                : ""
          }`}
          aria-live="polite"
          aria-busy={loading}
        >
          {loading ? (
            <ListSkeleton />
          ) : loadError ? (
            <div className="list-message error-message">
              <span aria-hidden="true">!</span>
              <h2>목록을 열 수 없어요</h2>
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadNotes()}>
                다시 시도
              </button>
            </div>
          ) : view === "continue" ? (
            <ResumeDashboard
              notes={resumeNotes}
              selectedId={selectedNote?.id ?? null}
              onChoose={chooseNote}
              onImport={() => setImportOpen(true)}
            />
          ) : notes.length && view === "timeline" ? (
            <ConversationTimeline
              notes={notes}
              selectedId={selectedNote?.id ?? null}
              onChoose={chooseNote}
            />
          ) : notes.length ? (
            notes.map((note) => (
              <button
                className={`note-card ${selectedNote?.id === note.id ? "selected" : ""}`}
                key={note.id}
                type="button"
                onClick={() => chooseNote(note.id)}
              >
                <span className="note-card-topline">
                  <strong>{noteTitle(note)}</strong>
                </span>
                <span className="note-card-preview">{notePreview(note)}</span>
                <span className="note-card-meta">
                  {noteHasDecision(note) ? (
                    <span className="note-card-signal decision">
                      결정 있음
                    </span>
                  ) : null}
                  {noteHasActionItems(note) ? (
                    <span className="note-card-signal action">
                      할 일 있음
                    </span>
                  ) : null}
                  <time dateTime={note.updatedAt}>
                    {formatDate(note.updatedAt)}
                  </time>
                </span>
              </button>
            ))
          ) : (
            <div className="list-message">
              <span className="empty-glyph" aria-hidden="true">
                ✦
              </span>
              <h2>
                {queryInput || activeTag
                  ? "맞는 노트가 없어요"
                  : view === "trash"
                    ? "휴지통이 비어 있어요"
                    : "첫 노트를 만들어보세요"}
              </h2>
              <p>
                {queryInput || activeTag
                  ? "다른 검색어나 태그를 사용해보세요."
                  : view === "trash"
                    ? "삭제한 노트가 없거나 모두 영구 삭제되었습니다."
                    : "ChatGPT 공유 링크 하나면 핵심 내용과 결정, 다음 행동을 다시 읽기 쉬운 노트로 만들 수 있습니다."}
              </p>
              {!queryInput && !activeTag && view === "all" ? (
                <button type="button" onClick={() => setImportOpen(true)}>
                  대화 가져오기
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="detail-pane" aria-label="선택한 노트">
        {selectedNote ? (
          <NoteDetail
            key={`${selectedNote.id}:${detailResetToken}`}
            note={selectedNote}
            ownerKey={ownerKey}
            view={view}
            onBack={() => setMobilePane("list")}
            onUpdated={replaceNote}
            onRemoved={removeFromCurrentList}
          />
        ) : (
          <EmptyDetail
            onBack={() => setMobilePane("list")}
          />
        )}
      </section>

      {importOpen ? (
        <ImportDialog
          ownerKey={ownerKey}
          onClose={() => setImportOpen(false)}
          onImported={(note) => {
            if (queryTimer.current) window.clearTimeout(queryTimer.current);
            setQueryInput("");
            setQuery("");
            setActiveTag(null);
            setView(
              note.deletedAt ? "trash" : note.archived ? "archive" : "all",
            );
            setNotes((current) => [
              note,
              ...current.filter((item) => item.id !== note.id),
            ]);
            setSelectedId(note.id);
            setDetailResetToken((current) => current + 1);
            setMobilePane("detail");
            setImportOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-label="노트 목록 불러오는 중">
      {[0, 1, 2, 3].map((item) => (
        <div key={item}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function EmptyDetail({
  onBack,
}: {
  onBack: () => void;
}) {
  return (
    <div className="empty-detail">
      <button
        className="detail-back-button"
        type="button"
        onClick={onBack}
        aria-label="노트 목록으로 돌아가기"
      >
        ←
      </button>
      <div className="paper-orbit" aria-hidden="true">
        <span>“</span>
      </div>
      <p className="detail-eyebrow">대화를 다시 이어가는 노트</p>
      <h2>가져온 노트가<br />여기에 열립니다.</h2>
      <p>
        가운데의 대화 가져오기를 사용하거나, 기존 노트를 선택해 현재 상태와
        다음 판단을 확인하세요.
      </p>
    </div>
  );
}

function NoteDetail({
  note,
  ownerKey,
  view,
  onBack,
  onUpdated,
  onRemoved,
}: {
  note: NoteRecord;
  ownerKey: string;
  view: ViewKey;
  onBack: () => void;
  onUpdated: (note: NoteRecord) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>({
    title: note.title,
    overview: note.overview,
    sections: note.sections,
    tags: note.tags,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [actionError, setActionError] = useState("");
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [permanentDeleteError, setPermanentDeleteError] = useState("");
  const [permanentlyDeleting, setPermanentlyDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permanentDeleteTriggerRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteCancelRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteConfirmRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteInFlight = useRef(false);
  const displayTitle = noteTitle(note);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!permanentDeleteOpen) return;
    const focusTimer = window.setTimeout(
      () => permanentDeleteCancelRef.current?.focus(),
      0,
    );
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || permanentDeleteInFlight.current) return;
      setPermanentDeleteOpen(false);
      setPermanentDeleteError("");
      window.setTimeout(() => permanentDeleteTriggerRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [permanentDeleteOpen]);

  const patchNote = async (patch: Record<string, unknown>) => {
    const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gptmemory-owner": ownerKey,
      },
      body: JSON.stringify(patch),
    });
    const payload = (await response.json()) as {
      note?: Partial<NoteRecord>;
    };
    if (!response.ok || !payload.note) {
      throw new Error(parseError(payload, "변경사항을 저장하지 못했습니다."));
    }
    const updated = normalizeNote(payload.note);
    onUpdated(updated);
    return updated;
  };

  const saveDraft = async (nextDraft = draft) => {
    setSaveState("saving");
    setActionError("");
    try {
      const updated = await patchNote(nextDraft);
      setDraft({
        title: updated.title,
        overview: updated.overview,
        sections: updated.sections,
        tags: updated.tags,
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setActionError(
        error instanceof Error
          ? error.message
          : "변경사항을 저장하지 못했습니다.",
      );
    }
  };

  const queueSave = (nextDraft: NoteDraft) => {
    setDraft(nextDraft);
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveDraft(nextDraft), 850);
  };

  const runAction = async (patch: Record<string, unknown>) => {
    setActionError("");
    try {
      await patchNote(patch);
      if (
        "deletedAt" in patch ||
        ("archived" in patch &&
          Boolean(patch.archived) !== (view === "archive")) ||
        ("favorite" in patch && view === "favorites" && !patch.favorite)
      ) {
        onRemoved(note.id);
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "요청을 처리하지 못했습니다.",
      );
    }
  };

  const saveStateNoteCorrection = async (
    correction: StateNoteCorrectionOperation,
  ) => {
    setSaveState("saving");
    setActionError("");
    try {
      await patchNote({
        expectedUpdatedAt: note.updatedAt,
        stateNoteCorrection: correction,
      });
      setSaveState("saved");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "사용자 수정을 저장하지 못했습니다.";
      setSaveState("error");
      setActionError(message);
      throw error;
    }
  };

  const moveToTrash = async () => {
    setActionError("");
    try {
      const response = await fetch(
        `/api/notes/${encodeURIComponent(note.id)}`,
        {
          method: "DELETE",
          headers: { "x-gptmemory-owner": ownerKey },
        },
      );
      const payload = (await response.json()) as {
        note?: Partial<NoteRecord>;
      };
      if (!response.ok || !payload.note) {
        throw new Error(
          parseError(payload, "노트를 휴지통으로 옮기지 못했습니다."),
        );
      }
      onRemoved(note.id);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "노트를 휴지통으로 옮기지 못했습니다.",
      );
    }
  };

  const closePermanentDelete = () => {
    if (permanentDeleteInFlight.current) return;
    setPermanentDeleteOpen(false);
    setPermanentDeleteError("");
    window.setTimeout(() => permanentDeleteTriggerRef.current?.focus(), 0);
  };

  const permanentlyDeleteNote = async () => {
    if (permanentDeleteInFlight.current) return;
    permanentDeleteInFlight.current = true;
    setPermanentlyDeleting(true);
    setPermanentDeleteError("");

    try {
      const response = await fetch(
        `/api/notes/${encodeURIComponent(note.id)}?permanent=true`,
        {
          method: "DELETE",
          headers: { "x-gptmemory-owner": ownerKey },
        },
      );
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // A successful permanent delete may intentionally return no body.
      }
      if (!response.ok) {
        throw new Error(
          parseError(payload, "노트를 영구 삭제하지 못했습니다."),
        );
      }

      permanentDeleteInFlight.current = false;
      setPermanentlyDeleting(false);
      onRemoved(note.id);
    } catch (error) {
      permanentDeleteInFlight.current = false;
      setPermanentlyDeleting(false);
      setPermanentDeleteError(
        error instanceof Error
          ? error.message
          : "노트를 영구 삭제하지 못했습니다.",
      );
    }
  };

  const closeEditor = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (
      draft.title !== note.title ||
      draft.overview !== note.overview ||
      JSON.stringify(draft.sections) !== JSON.stringify(note.sections) ||
      JSON.stringify(draft.tags) !== JSON.stringify(note.tags)
    ) {
      await saveDraft();
    }
    setEditing(false);
  };

  const restore = async () => {
    await runAction({ deletedAt: null });
    onRemoved(note.id);
  };

  return (
    <article
      className={`note-detail ${note.contentNote ? "content-note-detail" : note.stateNote ? "state-note-detail" : ""}`}
    >
      <header className="detail-toolbar">
        <button
          className="detail-back-button"
          type="button"
          onClick={onBack}
          aria-label="노트 목록으로 돌아가기"
        >
          ←
        </button>
        <div className="detail-source">
          <span className="source-pulse" aria-hidden="true" />
          <span>ChatGPT 대화</span>
        </div>
        <div className="toolbar-actions">
          {view === "trash" ? (
            <>
              <button
                className="toolbar-primary-button"
                type="button"
                onClick={() => void restore()}
                disabled={permanentlyDeleting}
              >
                복원
              </button>
              <details className="toolbar-overflow">
                <summary aria-label="노트 작업 더 보기" title="노트 작업 더 보기">
                  ···
                </summary>
                <div className="toolbar-overflow-menu">
                  <button
                    ref={permanentDeleteTriggerRef}
                    className="danger-toolbar-button"
                    type="button"
                    onClick={() => {
                      setPermanentDeleteError("");
                      setPermanentDeleteOpen(true);
                    }}
                    disabled={permanentlyDeleting}
                  >
                    영구 삭제
                  </button>
                </div>
              </details>
            </>
          ) : (
            <>
              {note.sourceUrl ? (
                <a
                  className="toolbar-source-link"
                  href={note.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="원본 ChatGPT 대화 새 창에서 열기"
                >
                  원문 ↗
                </a>
              ) : null}
              <button
                className={`toolbar-favorite-button ${note.favorite ? "active" : ""}`}
                type="button"
                onClick={() => void runAction({ favorite: !note.favorite })}
                aria-label={note.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
                title={note.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
              >
                {note.favorite ? "♥" : "♡"}
              </button>
              <details className="toolbar-overflow">
                <summary aria-label="노트 작업 더 보기" title="노트 작업 더 보기">
                  ···
                </summary>
                <div className="toolbar-overflow-menu">
                  <button
                    type="button"
                    onClick={() => void runAction({ archived: !note.archived })}
                  >
                    {note.archived ? "보관함에서 꺼내기" : "보관함으로 이동"}
                  </button>
                  <button
                    className="danger-toolbar-button"
                    type="button"
                    onClick={() => void moveToTrash()}
                  >
                    휴지통으로 이동
                  </button>
                </div>
              </details>
            </>
          )}
        </div>
      </header>

      <div className="note-paper">
        <div className="note-meta-row">
          <span>
            {note.contentNote
              ? note.sourceMessageCount
                ? `${note.sourceMessageCount}개의 메시지 · 주제 중심 노트`
                : "대화 주제 중심 노트"
              : note.stateNote
              ? note.sourceMessageCount
                ? `${note.sourceMessageCount}개의 메시지 · 현재 상태 노트`
                : "대화 현재 상태 노트"
              : note.sourceMessageCount
                ? `${note.sourceMessageCount}개의 메시지에서 정리`
                : note.summary
                  ? "대화 압축 요약"
                  : "대화 흐름 노트"}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={note.updatedAt}>{formatDate(note.updatedAt)} 수정</time>
          <span className={`save-indicator ${saveState}`}>
            {saveState === "saving"
              ? "저장 중…"
              : saveState === "saved"
                ? "저장됨"
                : saveState === "error"
                  ? "저장 실패"
                  : ""}
          </span>
        </div>

        {editing && !note.summary && !note.stateNote && !note.contentNote ? (
          <div className="note-editor">
            <label>
              <span>제목</span>
              <input
                value={draft.title}
                onChange={(event) =>
                  queueSave({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              <span>개요</span>
              <textarea
                value={draft.overview}
                rows={4}
                onChange={(event) =>
                  queueSave({ ...draft, overview: event.target.value })
                }
              />
            </label>
            <div className="section-editor-list">
              {draft.sections.map((section, index) => (
                <div className="section-editor" key={section.id}>
                  <span className="section-index">{index + 1}</span>
                  <label>
                    <span>구간 제목</span>
                    <input
                      value={section.heading}
                      onChange={(event) => {
                        const sections = draft.sections.map((item) =>
                          item.id === section.id
                            ? { ...item, heading: event.target.value }
                            : item,
                        );
                        queueSave({ ...draft, sections });
                      }}
                    />
                  </label>
                  <label>
                    <span>구간 내용</span>
                    <textarea
                      value={section.body}
                      rows={7}
                      onChange={(event) => {
                        const sections = draft.sections.map((item) =>
                          item.id === section.id
                            ? { ...item, body: event.target.value }
                            : item,
                        );
                        queueSave({ ...draft, sections });
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
            <label>
              <span>태그 · 쉼표로 구분</span>
              <input
                value={draft.tags.join(", ")}
                onChange={(event) =>
                  queueSave({
                    ...draft,
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim().replace(/^#/, ""))
                      .filter(Boolean)
                      .slice(0, 8),
                  })
                }
              />
            </label>
            <div className="editor-footer">
              <p>{actionError || "입력한 내용은 잠시 후 자동 저장됩니다."}</p>
              <button
                className="primary-action"
                type="button"
                onClick={() => void closeEditor()}
              >
                편집 마치기
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1>{displayTitle}</h1>
            {note.contentNote ? (
              <V4ContentNote
                contentNote={note.contentNote}
                overview={note.overview}
                sections={note.sections}
              />
            ) : note.stateNote ? (
              <V3StateNote
                stateNote={note.stateNote}
                overview={note.overview}
                sections={note.sections}
                onCorrect={
                  view === "trash" ? undefined : saveStateNoteCorrection
                }
              />
            ) : note.summary ? (
              <V2Summary
                summary={note.summary}
                overview={note.overview}
                sections={note.sections}
              />
            ) : (
              <LegacyNoteBody
                overview={note.overview}
                sections={note.sections}
              />
            )}
            {!note.summary && !note.stateNote && !note.contentNote && note.tags.length ? (
              <div className="note-tags" aria-label="노트 태그">
                {note.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            ) : null}
            {actionError ? <p className="inline-error">{actionError}</p> : null}
          </>
        )}
      </div>

      {!note.summary && !note.stateNote && !note.contentNote && !editing && view !== "trash" ? (
        <button
          className="edit-note-button"
          type="button"
          onClick={() => setEditing(true)}
        >
          <span aria-hidden="true">✎</span> 노트 편집
        </button>
      ) : null}

      {view === "trash" && permanentDeleteOpen ? (
        <div
          className="dialog-backdrop permanent-delete-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePermanentDelete();
          }}
        >
          <section
            className="permanent-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-title"
            aria-describedby="permanent-delete-description"
            aria-busy={permanentlyDeleting}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const cancelButton = permanentDeleteCancelRef.current;
              const confirmButton = permanentDeleteConfirmRef.current;
              if (!cancelButton || !confirmButton) return;
              if (event.shiftKey && document.activeElement === cancelButton) {
                event.preventDefault();
                confirmButton.focus();
              } else if (
                !event.shiftKey &&
                document.activeElement === confirmButton
              ) {
                event.preventDefault();
                cancelButton.focus();
              }
            }}
          >
            <span className="permanent-delete-symbol" aria-hidden="true">
              !
            </span>
            <p className="dialog-kicker">영구 삭제</p>
            <h2 id="permanent-delete-title">이 노트를 완전히 삭제할까요?</h2>
            <p
              className="permanent-delete-description"
              id="permanent-delete-description"
            >
              <strong>{displayTitle}</strong> 노트와 저장된 대화 정리를 즉시
              삭제합니다. 이 작업은 취소하거나 복원할 수 없습니다.
            </p>
            {permanentDeleteError ? (
              <p className="permanent-delete-error" role="alert">
                {permanentDeleteError}
              </p>
            ) : null}
            <div className="dialog-actions permanent-delete-actions">
              <button
                ref={permanentDeleteCancelRef}
                type="button"
                onClick={closePermanentDelete}
                disabled={permanentlyDeleting}
              >
                취소
              </button>
              <button
                ref={permanentDeleteConfirmRef}
                className="permanent-delete-action"
                type="button"
                onClick={() => void permanentlyDeleteNote()}
                disabled={permanentlyDeleting}
              >
                {permanentlyDeleting ? "삭제하는 중…" : "완전히 삭제"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

type StateItemPresentation<T extends StateEvidenceText = StateEvidenceText> = {
  item: T;
  itemKey: string;
  generatedText: string;
  displayText: string;
  hidden: boolean;
  isUserOverridden: boolean;
};

type StateCorrectionHandler = (
  correction: StateNoteCorrectionOperation,
) => Promise<void>;

function presentStateItem<T extends StateEvidenceText>(
  stateNote: NoteStateV3,
  section: StateNoteItemSection,
  item: T,
): StateItemPresentation<T> {
  const itemKey = stateNoteItemKey(section, item);
  const correction = stateNote.userCorrections.find(
    (candidate) => candidate.itemKey === itemKey,
  );
  return {
    item,
    itemKey,
    generatedText: item.text,
    displayText: correction?.textOverride ?? item.text,
    hidden: correction?.hidden === true,
    isUserOverridden: correction?.textOverride !== undefined,
  };
}

function presentStateItems<T extends StateEvidenceText>(
  stateNote: NoteStateV3,
  section: StateNoteItemSection,
  items: T[],
) {
  return items.map((item) => presentStateItem(stateNote, section, item));
}

function V4ContentNote({
  contentNote,
  overview,
  sections,
}: {
  contentNote: NoteContentV4;
  overview: string;
  sections: NoteSection[];
}) {
  const supporting = contentNote.supportingInfo;
  const hasSupportingInfo =
    supporting.artifacts.length > 0 ||
    supporting.activeProposals.length > 0 ||
    supporting.constraintsAndChanges.length > 0;
  const outcomeHeading =
    contentNote.conclusions.length && contentNote.confirmedDecisions.length
      ? "결론과 확정된 결정"
      : contentNote.conclusions.length
        ? "결론"
        : "확정된 결정";

  return (
    <div className="content-note">
      <section className="content-glance" aria-labelledby="content-glance-title">
        <p className="content-kicker" id="content-glance-title">
          한눈에 보기
        </p>
        <p className="content-lede">{contentNote.oneLineSummary.text}</p>
        <ContentEvidenceDetails
          label="한눈에 보기의 근거"
          items={[contentNote.oneLineSummary]}
        />
      </section>

      {supporting.currentState ? (
        <aside className="content-current-state" aria-label="현재 도달한 지점">
          <span>현재 도달한 지점</span>
          <p>{supporting.currentState.text}</p>
          <ContentEvidenceDetails
            label="현재 상태의 근거"
            items={[supporting.currentState]}
          />
        </aside>
      ) : null}

      <section className="content-section content-takeaways">
        <h2>핵심 정리</h2>
        <ul>
          {contentNote.keyTakeaways.map((item, index) => (
            <li key={`takeaway-${index}`}>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
        <ContentEvidenceDetails
          label="핵심 정리의 근거"
          items={contentNote.keyTakeaways}
        />
      </section>

      <section className="content-section content-topics">
        <h2>주제별 정리</h2>
        <div className="content-topic-list">
          {contentNote.topics.map((topic, index) => (
            <article className="content-topic" key={`topic-${index}`}>
              <span className="content-topic-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{topic.title.text}</h3>
                <p className="content-topic-summary">{topic.summary.text}</p>
                {topic.details.length ? (
                  <ul className="content-topic-details">
                    {topic.details.map((detail, detailIndex) => (
                      <li key={`${detail.kind}-${detailIndex}`}>
                        <span className={`content-detail-kind ${detail.kind}`}>
                          {contentDetailLabel(detail.kind)}
                        </span>
                        <div>
                          <p>{detail.text}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ContentEvidenceDetails
                  label="이 주제의 근거"
                  items={[topic.title, topic.summary, ...topic.details]}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      {contentNote.conclusions.length || contentNote.confirmedDecisions.length ? (
        <section className="content-section content-outcomes">
          <h2>{outcomeHeading}</h2>
          <ul className="content-labeled-list">
            {contentNote.conclusions.map((item, index) => (
              <li key={`conclusion-${index}`}>
                <span className="content-item-label conclusion">결론</span>
                <div>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
            {contentNote.confirmedDecisions.map((item, index) => (
              <li key={`decision-${index}`}>
                <span className="content-item-label decision">확정</span>
                <div>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <ContentEvidenceDetails
            label={`${outcomeHeading}의 근거`}
            items={[
              ...contentNote.conclusions,
              ...contentNote.confirmedDecisions,
            ]}
          />
        </section>
      ) : null}

      {contentNote.actionItems.length ? (
        <section className="content-section content-actions">
          <h2>다음에 할 일</h2>
          <ol>
            {contentNote.actionItems.map((item, index) => {
              const metadata = [
                `상태: ${stateActionLabel(item.status)}`,
                item.owner ? `담당자: ${item.owner}` : "",
                item.dueAt ? `기한: ${item.dueAt}` : "",
              ].filter(Boolean);
              return (
                <li key={`content-action-${index}`}>
                  <p>{item.text}</p>
                  <small>{metadata.join(" · ")}</small>
                </li>
              );
            })}
          </ol>
          <ContentEvidenceDetails
            label="다음에 할 일의 근거"
            items={contentNote.actionItems}
          />
        </section>
      ) : null}

      {contentNote.openQuestions.length ? (
        <section className="content-section content-questions">
          <h2>남은 질문</h2>
          <ContentEvidenceList items={contentNote.openQuestions} />
          <ContentEvidenceDetails
            label="남은 질문의 근거"
            items={contentNote.openQuestions}
          />
        </section>
      ) : null}

      {hasSupportingInfo ? (
        <details className="content-supporting-details">
          <summary>보조 정보</summary>
          <div className="content-supporting-body">
            {supporting.artifacts.length ? (
              <section>
                <h3>실제 산출물</h3>
                <ul>
                  {supporting.artifacts.map((item, index) => (
                    <li key={`artifact-${index}`}>
                      <p>{item.text}</p>
                      <small>
                        {item.label}
                        {item.locator ? ` · ${item.locator}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
                <ContentEvidenceDetails
                  label="실제 산출물의 근거"
                  items={supporting.artifacts}
                />
              </section>
            ) : null}
            {supporting.activeProposals.length ? (
              <section>
                <h3>검토 중인 제안</h3>
                <ContentEvidenceList items={supporting.activeProposals} />
                <ContentEvidenceDetails
                  label="검토 중인 제안의 근거"
                  items={supporting.activeProposals}
                />
              </section>
            ) : null}
            {supporting.constraintsAndChanges.length ? (
              <section>
                <h3>중요한 제약과 변경 이력</h3>
                <ContentEvidenceList items={supporting.constraintsAndChanges} />
                <ContentEvidenceDetails
                  label="제약과 변경 이력의 근거"
                  items={supporting.constraintsAndChanges}
                />
              </section>
            ) : null}
          </div>
        </details>
      ) : null}

      {overview || sections.length ? (
        <details className="conversation-flow-details">
          <summary>대화 흐름 상세 보기</summary>
          <div className="conversation-flow-body">
            <LegacyNoteBody overview={overview} sections={sections} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ContentEvidenceList({ items }: { items: StateEvidenceText[] }) {
  return (
    <ul className="content-evidence-list">
      {items.map((item, index) => (
        <li key={`${item.text}-${index}`}>
          <p>{item.text}</p>
        </li>
      ))}
    </ul>
  );
}

function ContentEvidenceDetails({
  label,
  items,
}: {
  label: string;
  items: StateEvidenceText[];
}) {
  const evidence = new Map<string, string[]>();

  for (const item of items) {
    for (const sourceMessageId of item.sourceMessageIds) {
      if (!evidence.has(sourceMessageId)) evidence.set(sourceMessageId, []);
    }
    for (const snippet of item.evidenceSnippets ?? []) {
      const quotes = evidence.get(snippet.sourceMessageId) ?? [];
      if (!quotes.includes(snippet.quote)) quotes.push(snippet.quote);
      evidence.set(snippet.sourceMessageId, quotes);
    }
  }

  if (!evidence.size) return null;

  return (
    <details className="content-evidence-details">
      <summary aria-label={`${label} 보기`}>
        <span>{label}</span>
        <small>{evidence.size}개 메시지</small>
      </summary>
      <ul>
        {[...evidence.entries()].map(([sourceMessageId, quotes]) => (
          <li key={sourceMessageId}>
            <span>{sourceMessageId}</span>
            {quotes.length ? (
              quotes.map((quote, index) => (
                <q key={`${sourceMessageId}-${index}`}>{quote}</q>
              ))
            ) : (
              <small>연결된 원문 메시지</small>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function contentDetailLabel(kind: ContentTopicDetail["kind"]): string {
  switch (kind) {
    case "finding":
      return "발견";
    case "comparison":
      return "비교";
    case "rationale":
      return "이유";
    case "change":
      return "변경";
    case "example":
      return "예시";
    case "implication":
      return "시사점";
    case "tradeoff":
      return "절충점";
    case "verification":
      return "검증";
    case "step":
      return "단계";
    case "risk":
      return "위험";
    case "principle":
      return "원리";
    default:
      return "설명";
  }
}

function V3StateNote({
  stateNote,
  overview,
  sections,
  onCorrect,
}: {
  stateNote: NoteStateV3;
  overview: string;
  sections: NoteSection[];
  onCorrect?: StateCorrectionHandler;
}) {
  const currentState = presentStateItem(
    stateNote,
    "currentState",
    stateNote.currentState,
  );
  const decisions = presentStateItems(
    stateNote,
    "confirmedDecisions",
    stateNote.confirmedDecisions,
  );
  const actions = presentStateItems(
    stateNote,
    "openActions",
    stateNote.openActions,
  );
  const unresolved = presentStateItems(
    stateNote,
    "unresolvedQuestions",
    stateNote.unresolvedQuestions,
  );
  const visibleDecisions = decisions.filter((entry) => !entry.hidden);
  const visibleActions = actions.filter((entry) => !entry.hidden);
  const visibleUnresolved = unresolved.filter((entry) => !entry.hidden);
  const currentSignalCount =
    visibleDecisions.length + visibleActions.length + visibleUnresolved.length;
  const completedResults = presentStateItems(
    stateNote,
    "completedResults",
    stateNote.completedResults,
  );
  const visibleCompletedResults = completedResults.filter(
    (entry) => !entry.hidden,
  );
  const hiddenCompletedResults = completedResults.filter(
    (entry) => entry.hidden,
  );
  const primaryCompletedResults = visibleCompletedResults.slice(-3);
  const additionalCompletedResults = visibleCompletedResults.slice(0, -3);
  const primaryGoal = stateNote.primaryGoal
    ? presentStateItem(stateNote, "primaryGoal", stateNote.primaryGoal)
    : null;
  const stateChanges = presentStateItems(
    stateNote,
    "stateChanges",
    stateNote.stateChanges,
  );
  const visibleStateChanges = stateChanges.filter((entry) => !entry.hidden);
  const hiddenStateChanges = stateChanges.filter((entry) => entry.hidden);

  return (
    <div className="state-note">
      <section className="state-current-card" aria-labelledby="current-state-title">
        <p className="state-kicker" id="current-state-title">
          현재 상태
        </p>
        <p className="state-current-text">{currentState.displayText}</p>
        <StateCorrectionControls
          presentation={currentState}
          onCorrect={onCorrect}
        />
        <EvidenceDetails item={stateNote.currentState} />
        {currentSignalCount ? (
          <div className="state-counts" aria-label="현재 상태 항목 수">
            {visibleDecisions.length ? (
              <span className="has-items">
                확정 결정 {visibleDecisions.length}
              </span>
            ) : null}
            {visibleActions.length ? (
              <span className="has-items action">
                열린 작업 {visibleActions.length}
              </span>
            ) : null}
            {visibleUnresolved.length ? (
              <span className="has-items unresolved">
                미해결 {visibleUnresolved.length}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="state-counts-empty">
            추가로 확인된 결정·남은 작업·미해결 항목 없음
          </p>
        )}
      </section>

      {primaryGoal && !primaryGoal.hidden ? (
        <section className="state-goal" aria-labelledby="primary-goal-title">
          <h2 id="primary-goal-title">핵심 문제</h2>
          <p>{primaryGoal.displayText}</p>
          <StateCorrectionControls
            presentation={primaryGoal}
            allowHide
            onCorrect={onCorrect}
          />
          <EvidenceDetails item={primaryGoal.item} />
        </section>
      ) : primaryGoal ? (
        <section className="state-goal state-goal-hidden">
          <h2>핵심 문제</h2>
          <HiddenStateItems items={[primaryGoal]} onCorrect={onCorrect} />
        </section>
      ) : null}

      <StateItemSection
        title="확정된 결정"
        className="state-decisions"
        stateNote={stateNote}
        section="confirmedDecisions"
        items={stateNote.confirmedDecisions}
        onCorrect={onCorrect}
      />

      <StateItemSection
        title="다음에 할 일"
        className="state-actions"
        stateNote={stateNote}
        section="openActions"
        items={stateNote.openActions}
        onCorrect={onCorrect}
        renderMeta={(item) => {
          const action = item as StateOpenAction;
          return [
            `상태: ${stateActionLabel(action.status)}`,
            action.owner ? `담당자: ${action.owner}` : "",
            action.dueAt ? `기한: ${action.dueAt}` : "",
          ].filter(Boolean);
        }}
      />

      <StateItemSection
        title="미해결 질문"
        className="state-unresolved"
        stateNote={stateNote}
        section="unresolvedQuestions"
        items={stateNote.unresolvedQuestions}
        onCorrect={onCorrect}
      />

      {stateNote.completedResults.length ? (
        <section className="state-section state-completed">
          <h2>완료된 결과와 산출물</h2>
          <CompletedResultList
            items={primaryCompletedResults}
            onCorrect={onCorrect}
          />
          {additionalCompletedResults.length ? (
            <details className="state-more-results">
              <summary>
                이전 결과 {additionalCompletedResults.length}개 보기
              </summary>
              <CompletedResultList
                items={additionalCompletedResults}
                onCorrect={onCorrect}
              />
            </details>
          ) : null}
          <HiddenStateItems
            items={hiddenCompletedResults}
            onCorrect={onCorrect}
          />
        </section>
      ) : null}

      <StateItemSection
        title="현재 유효한 제약"
        className="state-constraints"
        stateNote={stateNote}
        section="activeConstraints"
        items={stateNote.activeConstraints}
        onCorrect={onCorrect}
      />
      <StateItemSection
        title="핵심 인사이트"
        className="state-insights"
        stateNote={stateNote}
        section="keyInsights"
        items={stateNote.keyInsights}
        onCorrect={onCorrect}
      />
      <StateItemSection
        title="검토 중인 제안"
        className="state-proposals"
        stateNote={stateNote}
        section="activeProposals"
        items={stateNote.activeProposals}
        onCorrect={onCorrect}
        renderMeta={(item) => {
          const proposal = item as StateProposalItem;
          return proposal.proposedBy
            ? [`제안자: ${proposal.proposedBy === "assistant" ? "Assistant" : "사용자"}`]
            : [];
        }}
      />

      {stateChanges.length ? (
        <details className="state-history-details">
          <summary>변경·보류·대체된 방향</summary>
          {visibleStateChanges.length ? (
            <ul className="state-item-list state-change-list">
              {visibleStateChanges.map((entry) => (
                <li key={entry.itemKey}>
                  <p>{entry.displayText}</p>
                  {entry.item.from !== undefined || entry.item.to ? (
                    <small className="state-item-meta">
                      {entry.item.from ? `${entry.item.from} → ` : ""}
                      {entry.item.to ?? ""}
                    </small>
                  ) : null}
                  <StateCorrectionControls
                    presentation={entry}
                    allowHide
                    onCorrect={onCorrect}
                  />
                  <EvidenceDetails item={entry.item} />
                </li>
              ))}
            </ul>
          ) : null}
          <HiddenStateItems
            items={hiddenStateChanges}
            onCorrect={onCorrect}
          />
        </details>
      ) : null}

      {overview || sections.length ? (
        <details className="conversation-flow-details">
          <summary>대화 흐름 상세 보기</summary>
          <div className="conversation-flow-body">
            <LegacyNoteBody overview={overview} sections={sections} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CompletedResultList({
  items,
  onCorrect,
}: {
  items: StateItemPresentation<StateCompletedResult>[];
  onCorrect?: StateCorrectionHandler;
}) {
  if (!items.length) return null;
  return (
    <ul className="state-item-list">
      {items.map((entry) => (
        <li key={entry.itemKey}>
          <p>{entry.displayText}</p>
          {entry.item.artifact ? (
            <small className="state-item-meta">
              산출물: {entry.item.artifact.label}
            </small>
          ) : null}
          <StateCorrectionControls
            presentation={entry}
            allowHide
            onCorrect={onCorrect}
          />
          <EvidenceDetails item={entry.item} />
        </li>
      ))}
    </ul>
  );
}

function StateItemSection({
  title,
  className,
  stateNote,
  section,
  items,
  onCorrect,
  renderMeta,
}: {
  title: string;
  className: string;
  stateNote: NoteStateV3;
  section: StateNoteItemSection;
  items: StateEvidenceText[];
  onCorrect?: StateCorrectionHandler;
  renderMeta?: (item: StateEvidenceText) => string[];
}) {
  if (!items.length) return null;
  const presented = presentStateItems(stateNote, section, items);
  const visibleItems = presented.filter((entry) => !entry.hidden);
  const hiddenItems = presented.filter((entry) => entry.hidden);
  return (
    <section className={`state-section ${className}`}>
      <h2>{title}</h2>
      {visibleItems.length ? (
        <ul className="state-item-list">
          {visibleItems.map((entry) => {
            const metadata = renderMeta?.(entry.item) ?? [];
            return (
              <li key={entry.itemKey}>
                <p>{entry.displayText}</p>
                {metadata.length ? (
                  <small className="state-item-meta">
                    {metadata.join(" · ")}
                  </small>
                ) : null}
                <StateCorrectionControls
                  presentation={entry}
                  allowHide
                  onCorrect={onCorrect}
                />
                <EvidenceDetails item={entry.item} />
              </li>
            );
          })}
        </ul>
      ) : null}
      <HiddenStateItems items={hiddenItems} onCorrect={onCorrect} />
    </section>
  );
}

function StateCorrectionControls({
  presentation,
  allowHide = false,
  onCorrect,
}: {
  presentation: StateItemPresentation;
  allowHide?: boolean;
  onCorrect?: StateCorrectionHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(presentation.displayText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const apply = async (correction: StateNoteCorrectionOperation) => {
    if (!onCorrect || saving) return false;
    setSaving(true);
    setError("");
    try {
      await onCorrect(correction);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "사용자 수정을 저장하지 못했습니다.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draftText.trim();
    if (!text) {
      setError("수정할 내용을 입력해 주세요.");
      return;
    }
    const saved = await apply(
      text === presentation.generatedText
        ? { itemKey: presentation.itemKey, operation: "restore" }
        : {
            itemKey: presentation.itemKey,
            operation: "override_text",
            text,
          },
    );
    if (saved) setEditing(false);
  };

  if (editing && onCorrect) {
    return (
      <form className="state-correction-editor" onSubmit={saveText}>
        <label>
          <span className="sr-only">항목 내용 수정</span>
          <textarea
            value={draftText}
            maxLength={200}
            rows={3}
            autoFocus
            onChange={(event) => setDraftText(event.target.value)}
            disabled={saving}
          />
        </label>
        <div className="state-correction-actions">
          <button type="submit" disabled={saving || !draftText.trim()}>
            {saving ? "저장 중…" : "저장"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftText(presentation.displayText);
              setEditing(false);
              setError("");
            }}
            disabled={saving}
          >
            취소
          </button>
        </div>
        {error ? (
          <p className="state-correction-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  if (!onCorrect && !presentation.isUserOverridden) return null;
  return (
    <div className="state-correction-controls">
      {presentation.isUserOverridden ? (
        <span className="state-user-override">사용자 수정</span>
      ) : null}
      {onCorrect ? (
        <>
          <button
            type="button"
            onClick={() => {
              setDraftText(presentation.displayText);
              setEditing(true);
              setError("");
            }}
            disabled={saving}
          >
            수정
          </button>
          {presentation.isUserOverridden ? (
            <button
              type="button"
              onClick={() =>
                void apply({
                  itemKey: presentation.itemKey,
                  operation: "restore",
                })
              }
              disabled={saving}
            >
              원문으로 복원
            </button>
          ) : null}
          {allowHide ? (
            <button
              type="button"
              onClick={() =>
                void apply({
                  itemKey: presentation.itemKey,
                  operation: "hide",
                })
              }
              disabled={saving}
            >
              숨기기
            </button>
          ) : null}
        </>
      ) : null}
      {error ? (
        <span className="state-correction-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function HiddenStateItems({
  items,
  onCorrect,
}: {
  items: StateItemPresentation[];
  onCorrect?: StateCorrectionHandler;
}) {
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!items.length) return null;

  const restore = async (itemKey: string) => {
    if (!onCorrect || restoringKey) return;
    setRestoringKey(itemKey);
    setError("");
    try {
      await onCorrect({ itemKey, operation: "restore" });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "숨긴 항목을 복원하지 못했습니다.",
      );
    } finally {
      setRestoringKey(null);
    }
  };

  return (
    <details className="state-hidden-items">
      <summary>숨긴 항목 {items.length}개</summary>
      <ul>
        {items.map((entry) => (
          <li key={entry.itemKey}>
            <div>
              <span>숨김</span>
              <p>{entry.displayText}</p>
            </div>
            {onCorrect ? (
              <button
                type="button"
                onClick={() => void restore(entry.itemKey)}
                disabled={restoringKey !== null}
              >
                {restoringKey === entry.itemKey ? "복원 중…" : "원문으로 복원"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="state-correction-error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}

function EvidenceDetails({ item }: { item: StateEvidenceText }) {
  if (!item.evidenceSnippets?.length) return null;
  return (
    <details className="state-evidence">
      <summary aria-label={`근거 보기: ${item.text.slice(0, 60)}`}>
        근거 보기
      </summary>
      <ul>
        {item.evidenceSnippets.map((snippet, index) => (
          <li key={`${snippet.sourceMessageId}-${index}`}>
            <span>{snippet.sourceMessageId}</span>
            <q>{snippet.quote}</q>
          </li>
        ))}
      </ul>
    </details>
  );
}

function stateActionLabel(status: StateOpenAction["status"]): string {
  switch (status) {
    case "in_progress":
      return "진행 중";
    case "blocked":
      return "막힘";
    case "deferred":
      return "보류";
    default:
      return "열림";
  }
}

function V2Summary({
  summary,
  overview,
  sections,
}: {
  summary: NoteSummaryV2;
  overview: string;
  sections: NoteSection[];
}) {
  return (
    <div className="compressed-summary">
      <p className="summary-lede">{summary.oneLineSummary.text}</p>

      {summary.keyPoints.length ? (
        <section className="summary-block key-points-block">
          <h2>핵심 내용</h2>
          <ul className="summary-list key-points-list">
            {summary.keyPoints.map((item, index) => (
              <li key={`key-point-${index}`}>{item.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.outcomes.length ? (
        <section className="summary-block outcomes-block">
          <h2>결과</h2>
          <ul className="outcome-list">
            {summary.outcomes.map((outcome, index) => (
              <li key={`${outcome.kind}-${index}`}>
                <span className={`outcome-kind ${outcome.kind}`}>
                  {OUTCOME_LABELS[outcome.kind]}
                </span>
                <p>{outcome.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.actionItems.length ? (
        <section className="summary-block action-items-block">
          <h2>할 일</h2>
          <ol className="action-item-list">
            {summary.actionItems.map((item, index) => {
              const metadata = [
                item.owner ? `담당자: ${item.owner}` : "",
                item.status ? `상태: ${item.status}` : "",
                item.dueAt ? `기한: ${item.dueAt}` : "",
              ].filter(Boolean);
              return (
                <li key={`action-item-${index}`}>
                  <p>{item.text}</p>
                  {metadata.length ? (
                    <small className="action-item-meta">
                      {metadata.join(" · ")}
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {summary.necessaryContext.length ? (
        <section className="summary-block necessary-context-block">
          <h2>필요한 맥락</h2>
          <ul className="summary-list context-list">
            {summary.necessaryContext.map((item, index) => (
              <li key={`necessary-context-${index}`}>{item.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview || sections.length ? (
        <details className="conversation-flow-details">
          <summary>대화 흐름 상세 보기</summary>
          <div className="conversation-flow-body">
            <LegacyNoteBody overview={overview} sections={sections} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function LegacyNoteBody({
  overview,
  sections,
}: {
  overview: string;
  sections: NoteSection[];
}) {
  return (
    <>
      {overview ? <p className="note-overview">{overview}</p> : null}
      {sections.length ? (
        <>
          <div className="note-divider">
            <span />
            <i>conversation note</i>
            <span />
          </div>
          <div className="note-sections">
            {sections.map((section, index) => (
              <section key={section.id}>
                <span className="section-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2>{section.heading}</h2>
                  {section.body
                    .split(/\n{2,}/)
                    .filter(Boolean)
                    .map((paragraph, paragraphIndex) => (
                      <p key={`${section.id}-${paragraphIndex}`}>
                        {paragraph}
                      </p>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function ImportDialog({
  ownerKey,
  onClose,
  onImported,
}: {
  ownerKey: string;
  onClose: () => void;
  onImported: (note: NoteRecord) => void;
}) {
  const [shareUrl, setShareUrl] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<ExistingNoteSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  const requestImport = async (replace?: ExistingNoteSummary) => {
    if (!shareUrl.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    setStatus(
      replace
        ? "기존 노트를 보존한 채 새 내용 노트를 생성하는 중입니다…"
        : "공개 대화를 불러와 핵심 내용을 주제별로 정리하는 중입니다…",
    );
    try {
      const response = await fetch("/api/notes/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gptmemory-owner": ownerKey,
        },
        body: JSON.stringify({
          shareUrl: shareUrl.trim(),
          ...(replace
            ? {
                replace: {
                  noteId: replace.id,
                  expectedUpdatedAt: replace.updatedAt,
                },
              }
            : {}),
        }),
      });
      const payload = (await response.json()) as ImportResponsePayload;

      if (
        response.status === 409 &&
        payload.status === "already_exists" &&
        payload.existing
      ) {
        setExisting(payload.existing);
        setStatus("");
        return;
      }
      if (!response.ok || !payload.note) {
        throw new Error(
          parseError(payload, "이 대화를 노트로 만들지 못했습니다."),
        );
      }
      onImported(normalizeNote(payload.note));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "가져오기를 완료하지 못했습니다.",
      );
      setStatus("");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (existing) return;
    await requestImport();
  };

  const openExisting = async () => {
    if (!existing || submitting) return;
    setSubmitting(true);
    setError("");
    setStatus("기존 노트를 여는 중입니다…");
    try {
      const response = await fetch(
        `/api/notes/${encodeURIComponent(existing.id)}`,
        {
          headers: { "x-gptmemory-owner": ownerKey },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        note?: Partial<NoteRecord>;
      };
      if (!response.ok || !payload.note) {
        throw new Error(parseError(payload, "기존 노트를 열지 못했습니다."));
      }
      onImported(normalizeNote(payload.note));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "기존 노트를 열지 못했습니다.",
      );
      setStatus("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-describedby="import-description gemini-transfer-notice"
      >
        <button
          className="dialog-close"
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="가져오기 창 닫기"
        >
          ×
        </button>
        <span className="dialog-kicker">새 대화 노트</span>
        <h2 id="import-title">대화를 노트로 가져오기</h2>
        <p className="dialog-intro" id="import-description">
          ChatGPT의 공개 공유 링크를 붙여 넣으세요. 핵심 내용을 주제별로
          정리하고, 확정된 결정과 다음 할 일을 분리한 노트로 만듭니다.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>ChatGPT share link</span>
            <div className="url-input-wrap">
              <span aria-hidden="true">↗</span>
              <input
                ref={inputRef}
                type="url"
                inputMode="url"
                value={shareUrl}
                onChange={(event) => setShareUrl(event.target.value)}
                placeholder="https://chatgpt.com/share/..."
                required
                disabled={submitting || Boolean(existing)}
              />
            </div>
          </label>
          <div className="import-assurance" id="gemini-transfer-notice">
            <span aria-hidden="true">◉</span>
            <p>
              공개 공유 링크만 지원합니다. tool·reasoning 등 내부 정보를 제거한
                  정제된 대화가 내용 중심 노트 생성을 위해 Google Gemini API로 전송됩니다.
                  원본 공유 HTML과 복원된 전체 메시지 배열은 GPTMemory에 저장하지
                  않습니다. 근거 확인에 선택된 짧은 문장만 메시지 ID와 함께 노트에
                  저장됩니다.
            </p>
          </div>
          {existing ? (
            <div className="existing-note-card" role="status">
              <span className="existing-note-symbol" aria-hidden="true">
                ↺
              </span>
              <div>
                <p className="existing-note-label">이미 가져온 대화입니다</p>
                <h3>{existing.title}</h3>
                <p className="existing-note-meta">
                  {formatDate(existing.updatedAt)} 수정
                  {existing.deletedAt
                    ? " · 휴지통"
                    : existing.archived
                      ? " · 보관됨"
                      : ""}
                  {existing.sourceMessageCount
                    ? ` · ${existing.sourceMessageCount}개 메시지`
                    : ""}
                </p>
                <p className="existing-note-warning">
                  생성된 요약만 새 내용 중심 노트로 교체되고 기존 편집 본문은
                  보존됩니다. 기존 상태 노트에 직접 수정하거나 숨긴 항목이 있으면
                  데이터 보호를 위해 재생성을 중단하며, 생성에 실패해도 기존 노트는
                  그대로 유지됩니다.
                </p>
              </div>
            </div>
          ) : null}
          {status ? (
            <div className="import-status" role="status">
              <span className="status-spinner" aria-hidden="true" />
              <span>{status}</span>
            </div>
          ) : null}
          {error ? (
            <p className="import-error" role="alert">
              {error}
            </p>
          ) : null}
          {existing ? (
            <div className="dialog-actions duplicate-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                취소
              </button>
              <button
                className="existing-open-action"
                type="button"
                onClick={() => void openExisting()}
                disabled={submitting}
              >
                기존 노트 열기
              </button>
              <button
                className="primary-action replace-action"
                type="button"
                onClick={() => void requestImport(existing)}
                disabled={submitting}
              >
                {submitting ? "처리하는 중…" : "새 내용 노트로 재생성"}
              </button>
            </div>
          ) : (
            <div className="dialog-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                취소
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={submitting || !shareUrl.trim()}
              >
                    {submitting ? "내용 정리 중…" : "내용 노트 만들기"}
                {!submitting ? <span aria-hidden="true">→</span> : null}
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

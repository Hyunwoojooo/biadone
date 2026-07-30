/**
 * Deterministic conversation-to-note engine.
 *
 * This module intentionally does not infer entities, decisions, action items, or
 * facts that are not present in the conversation. It keeps the conversation in
 * order and turns each user turn into a readable, plain-text note section.
 */

export type ConversationRole = "user" | "assistant";

export type ConversationSourceType =
  | "chatgpt_share_link"
  | "conversation";

export interface ConversationMessageInput {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt?: string | null;
}

export interface ConversationSourceInput {
  type?: ConversationSourceType;
  originalUrl?: string;
  normalizedUrl?: string;
  shareId?: string;
}

export interface ConversationNoteInput {
  title?: string | null;
  messages: readonly ConversationMessageInput[];
  source?: ConversationSourceInput;
}

export type ConversationFlowKind =
  | "opening"
  | "follow_up"
  | "correction"
  | "transition"
  | "opening_context";

export interface ConversationNoteSectionDraft {
  id: string;
  heading: string;
  body: string;
  sourceMessageIds: string[];
  flowKind: ConversationFlowKind;
}

export interface ConversationNoteSourceSummary {
  type: ConversationSourceType;
  conversationTitle: string | null;
  originalUrl: string | null;
  normalizedUrl: string | null;
  shareId: string | null;
  messageCount: number;
  userTurnCount: number;
  messageIds: string[];
  startedAt: string | null;
  endedAt: string | null;
}

export interface ConversationNoteDraft {
  schemaVersion: "gptmemory.note-draft.v1";
  format: "plain_text";
  title: string;
  overview: string;
  sections: ConversationNoteSectionDraft[];
  closingState: string;
  tags: string[];
  source: ConversationNoteSourceSummary;
}

export type NoteEngineErrorCode =
  | "INVALID_INPUT"
  | "INVALID_MESSAGE"
  | "DUPLICATE_MESSAGE_ID"
  | "NO_MESSAGES"
  | "NO_USER_MESSAGE";

export class NoteEngineError extends Error {
  readonly code: NoteEngineErrorCode;

  constructor(code: NoteEngineErrorCode, message: string) {
    super(message);
    this.name = "NoteEngineError";
    this.code = code;
  }
}

export interface NoteEngineOptions {
  maxTitleLength?: number;
  maxHeadingLength?: number;
  maxOverviewExcerptLength?: number;
}

type NoteLanguage = "ko" | "en";

interface NormalizedMessage {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt: string | null;
}

interface TurnGroup {
  user: NormalizedMessage;
  assistants: NormalizedMessage[];
  flowKind: Exclude<ConversationFlowKind, "opening_context">;
}

const DEFAULT_MAX_TITLE_LENGTH = 72;
const DEFAULT_MAX_HEADING_LENGTH = 68;
const DEFAULT_MAX_OVERVIEW_EXCERPT_LENGTH = 88;

const KOREAN_CORRECTION_PATTERNS = [
  /그게\s*아니/,
  /그건\s*아니/,
  /그거\s*아니/,
  /아니라/,
  /말고/,
  /빼고/,
  /대신/,
  /정정/,
  /수정/,
  /바꿔/,
  /변경/,
  /하지\s*마/,
  /필요\s*없/,
];

const ENGLISH_CORRECTION_PATTERNS = [
  /\bactually\b/i,
  /\brather than\b/i,
  /\binstead\b/i,
  /\bcorrection\b/i,
  /\brevise\b/i,
  /\bremove\b/i,
  /\bexclude\b/i,
  /\bleave (?:it|that|this) out\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bnot that\b/i,
  /\bwithout\b/i,
];

const KOREAN_TRANSITION_PATTERNS = [
  /^(?:그럼|그러면|이제|다음|이번에는|그리고|또|추가로)(?:\s|,|\.|$)/,
  /넘어가/,
];

const ENGLISH_TRANSITION_PATTERNS = [
  /^(?:then|now|next|also|additionally|another|and now)(?:\s|,|\.|$)/i,
  /\bmove on to\b/i,
];

/**
 * Convert an ordered conversation into a readable note draft without an LLM.
 *
 * The input order is authoritative. Blank messages are ignored, but invalid or
 * duplicate message IDs fail fast so source links remain reliable.
 */
export function createConversationNote(
  input: ConversationNoteInput,
  options: NoteEngineOptions = {},
): ConversationNoteDraft {
  if (!input || !Array.isArray(input.messages)) {
    throw new NoteEngineError(
      "INVALID_INPUT",
      "The note engine requires an ordered messages array.",
    );
  }

  const messages = normalizeMessages(input.messages);
  if (messages.length === 0) {
    throw new NoteEngineError(
      "NO_MESSAGES",
      "The conversation does not contain any non-empty messages.",
    );
  }

  const firstUserIndex = messages.findIndex((message) => message.role === "user");
  if (firstUserIndex === -1) {
    throw new NoteEngineError(
      "NO_USER_MESSAGE",
      "A note cannot be created without a user message.",
    );
  }

  const language = detectLanguage(
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.text)
      .join("\n"),
  );
  const maxTitleLength = positiveIntegerOr(
    options.maxTitleLength,
    DEFAULT_MAX_TITLE_LENGTH,
  );
  const maxHeadingLength = positiveIntegerOr(
    options.maxHeadingLength,
    DEFAULT_MAX_HEADING_LENGTH,
  );
  const maxOverviewExcerptLength = positiveIntegerOr(
    options.maxOverviewExcerptLength,
    DEFAULT_MAX_OVERVIEW_EXCERPT_LENGTH,
  );

  const leadingAssistants = messages
    .slice(0, firstUserIndex)
    .filter((message) => message.role === "assistant");
  const turnGroups = groupTurns(messages.slice(firstUserIndex));
  const sections: ConversationNoteSectionDraft[] = [];

  if (leadingAssistants.length > 0) {
    sections.push(
      createOpeningContextSection(leadingAssistants, language, sections.length),
    );
  }

  for (const group of turnGroups) {
    sections.push(
      createTurnSection(
        group,
        language,
        sections.length,
        maxHeadingLength,
      ),
    );
  }

  const firstTurn = turnGroups[0];
  const lastTurn = turnGroups[turnGroups.length - 1];
  const suppliedTitle = normalizeOptionalText(input.title);
  const title = shortenText(
    suppliedTitle ?? headingExcerpt(firstTurn.user.text),
    maxTitleLength,
  );

  return {
    schemaVersion: "gptmemory.note-draft.v1",
    format: "plain_text",
    title,
    overview: createOverview(
      turnGroups,
      language,
      maxOverviewExcerptLength,
    ),
    sections,
    closingState: createClosingState(
      lastTurn,
      language,
      maxOverviewExcerptLength,
    ),
    // Topic/entity extraction is intentionally outside this engine. Tags stay
    // empty until a user or a separate, explicitly scoped feature supplies them.
    tags: [],
    source: createSourceSummary(input, messages, turnGroups.length),
  };
}

/**
 * Classify how a user turn relates to the preceding flow. This classification
 * describes chronology only; it does not infer a decision or action.
 */
export function classifyUserTurn(
  text: string,
  turnIndex: number,
): Exclude<ConversationFlowKind, "opening_context"> {
  if (turnIndex === 0) {
    return "opening";
  }

  const normalized = normalizePlainText(text);
  if (
    KOREAN_CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    ENGLISH_CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return "correction";
  }

  if (
    KOREAN_TRANSITION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    ENGLISH_TRANSITION_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return "transition";
  }

  return "follow_up";
}

function normalizeMessages(
  messages: readonly ConversationMessageInput[],
): NormalizedMessage[] {
  const seenIds = new Set<string>();
  const normalized: NormalizedMessage[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      throw new NoteEngineError(
        "INVALID_MESSAGE",
        "Each conversation message must be an object.",
      );
    }

    const id =
      typeof message.id === "string" ? message.id.trim() : "";
    if (!id) {
      throw new NoteEngineError(
        "INVALID_MESSAGE",
        "Each conversation message must have a non-empty ID.",
      );
    }
    if (seenIds.has(id)) {
      throw new NoteEngineError(
        "DUPLICATE_MESSAGE_ID",
        `Duplicate conversation message ID: ${id}`,
      );
    }
    seenIds.add(id);

    if (message.role !== "user" && message.role !== "assistant") {
      throw new NoteEngineError(
        "INVALID_MESSAGE",
        `Unsupported conversation role for message ${id}.`,
      );
    }

    const text =
      typeof message.text === "string"
        ? normalizePlainText(message.text)
        : "";
    if (!text) {
      continue;
    }

    normalized.push({
      id,
      role: message.role,
      text,
      createdAt: normalizeOptionalText(message.createdAt),
    });
  }

  return normalized;
}

function groupTurns(messages: readonly NormalizedMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      groups.push({
        user: message,
        assistants: [],
        flowKind: classifyUserTurn(message.text, groups.length),
      });
      continue;
    }

    const currentGroup = groups[groups.length - 1];
    if (currentGroup) {
      currentGroup.assistants.push(message);
    }
  }

  return groups;
}

function createOpeningContextSection(
  assistants: readonly NormalizedMessage[],
  language: NoteLanguage,
  sectionIndex: number,
): ConversationNoteSectionDraft {
  const body =
    language === "ko"
      ? [
          "사용자의 첫 요청에 앞서 다음 응답 맥락이 있었다.",
          assistants.map((message) => message.text).join("\n\n"),
        ].join("\n\n")
      : [
          "The following response context appeared before the first user request.",
          assistants.map((message) => message.text).join("\n\n"),
        ].join("\n\n");

  return {
    id: sectionId(sectionIndex),
    heading: language === "ko" ? "대화 시작 전 맥락" : "Opening context",
    body,
    sourceMessageIds: assistants.map((message) => message.id),
    flowKind: "opening_context",
  };
}

function createTurnSection(
  group: TurnGroup,
  language: NoteLanguage,
  sectionIndex: number,
  maxHeadingLength: number,
): ConversationNoteSectionDraft {
  const requestIntroduction = requestIntroductionFor(
    group.flowKind,
    language,
  );
  const bodyParts = [requestIntroduction, group.user.text];

  if (group.assistants.length > 0) {
    bodyParts.push(
      responseIntroductionFor(group.assistants.length, language),
      group.assistants.map((message) => message.text).join("\n\n"),
    );
  } else {
    bodyParts.push(
      language === "ko"
        ? "아직 이 요청에 대한 응답은 이어지지 않았다."
        : "No response followed this request yet.",
    );
  }

  return {
    id: sectionId(sectionIndex),
    heading: createSectionHeading(
      group.user.text,
      group.flowKind,
      language,
      maxHeadingLength,
    ),
    body: bodyParts.join("\n\n"),
    sourceMessageIds: [
      group.user.id,
      ...group.assistants.map((message) => message.id),
    ],
    flowKind: group.flowKind,
  };
}

function requestIntroductionFor(
  flowKind: Exclude<ConversationFlowKind, "opening_context">,
  language: NoteLanguage,
): string {
  if (language === "ko") {
    switch (flowKind) {
      case "opening":
        return "대화는 다음 요청에서 시작되었다.";
      case "correction":
        return "이 지점에서 사용자가 앞선 조건이나 방향을 다음과 같이 수정했다.";
      case "transition":
        return "이후 대화의 초점이 다음 내용으로 옮겨갔다.";
      case "follow_up":
        return "이어서 사용자가 다음 내용을 물었거나 요청했다.";
    }
  }

  switch (flowKind) {
    case "opening":
      return "The conversation began with the following request.";
    case "correction":
      return "At this point, the user revised the earlier conditions or direction.";
    case "transition":
      return "The focus of the conversation then shifted to the following request.";
    case "follow_up":
      return "The user continued with the following question or request.";
  }
}

function responseIntroductionFor(
  assistantCount: number,
  language: NoteLanguage,
): string {
  if (language === "ko") {
    return assistantCount > 1
      ? "이에 대한 응답은 다음과 같이 이어졌다."
      : "이에 대한 응답은 다음과 같다.";
  }

  return assistantCount > 1
    ? "The responses continued as follows."
    : "The response was as follows.";
}

function createSectionHeading(
  userText: string,
  flowKind: Exclude<ConversationFlowKind, "opening_context">,
  language: NoteLanguage,
  maxLength: number,
): string {
  const excerpt = headingExcerpt(userText);
  const prefix =
    flowKind === "correction"
      ? language === "ko"
        ? "조건 수정 · "
        : "Correction · "
      : flowKind === "transition"
        ? language === "ko"
          ? "맥락 전환 · "
          : "Context shift · "
        : "";

  return shortenText(`${prefix}${excerpt}`, maxLength);
}

function createOverview(
  groups: readonly TurnGroup[],
  language: NoteLanguage,
  maxExcerptLength: number,
): string {
  const first = quotedExcerpt(groups[0].user.text, maxExcerptLength);
  const last = quotedExcerpt(
    groups[groups.length - 1].user.text,
    maxExcerptLength,
  );
  const correctionCount = groups.filter(
    (group) =>
      group.flowKind === "correction" || group.flowKind === "transition",
  ).length;

  if (language === "ko") {
    if (groups.length === 1) {
      return `대화는 “${first}”라는 요청을 중심으로 진행되었다.`;
    }

    const flowSentence = `대화는 “${first}”에서 시작해 “${last}”까지 ${groups.length}개의 요청 흐름으로 이어졌다.`;
    return correctionCount > 0
      ? `${flowSentence} 그 과정에서 조건 수정이나 맥락 전환도 시간순으로 이어졌다.`
      : flowSentence;
  }

  if (groups.length === 1) {
    return `The conversation centered on the request “${first}.”`;
  }

  const flowSentence = `The conversation moved through ${groups.length} user requests, beginning with “${first}” and ending with “${last}.”`;
  return correctionCount > 0
    ? `${flowSentence} Changes in direction or context are kept in chronological order.`
    : flowSentence;
}

function createClosingState(
  lastGroup: TurnGroup,
  language: NoteLanguage,
  maxExcerptLength: number,
): string {
  const lastRequest = quotedExcerpt(
    lastGroup.user.text,
    maxExcerptLength,
  );
  const hasResponse = lastGroup.assistants.length > 0;

  if (language === "ko") {
    return hasResponse
      ? `마지막으로 “${lastRequest}”에 대한 응답까지 이어진 상태다.`
      : `마지막 요청인 “${lastRequest}”에는 아직 응답이 없다.`;
  }

  return hasResponse
    ? `The conversation ended after a response to “${lastRequest}.”`
    : `The final request, “${lastRequest},” has not yet received a response.`;
}

function createSourceSummary(
  input: ConversationNoteInput,
  messages: readonly NormalizedMessage[],
  userTurnCount: number,
): ConversationNoteSourceSummary {
  const timestamps = messages
    .map((message) => message.createdAt)
    .filter((createdAt): createdAt is string => Boolean(createdAt));

  return {
    type: input.source?.type ?? "conversation",
    conversationTitle: normalizeOptionalText(input.title),
    originalUrl: normalizeOptionalText(input.source?.originalUrl),
    normalizedUrl: normalizeOptionalText(input.source?.normalizedUrl),
    shareId: normalizeOptionalText(input.source?.shareId),
    messageCount: messages.length,
    userTurnCount,
    messageIds: messages.map((message) => message.id),
    startedAt: timestamps[0] ?? null,
    endedAt: timestamps[timestamps.length - 1] ?? null,
  };
}

function detectLanguage(text: string): NoteLanguage {
  const koreanCount = (text.match(/[가-힣]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return koreanCount > 0 && koreanCount >= latinCount * 0.2 ? "ko" : "en";
}

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizePlainText(value);
  return normalized || null;
}

function headingExcerpt(text: string): string {
  const normalized = normalizePlainText(text)
    .replace(/^```[^\n]*\n?/, "")
    .replace(/```$/, "")
    .replace(/^(?:#{1,6}|[-*+]>?)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = normalized.split(/(?<=[.!?。！？])\s+/u)[0];
  return stripTrailingPunctuation(firstSentence || normalized);
}

function quotedExcerpt(text: string, maxLength: number): string {
  return shortenText(headingExcerpt(text), maxLength);
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s.!?。！？，,;:]+$/u, "").trim();
}

function shortenText(text: string, maxLength: number): string {
  const normalized = normalizePlainText(text).replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxLength) {
    return stripTrailingPunctuation(normalized);
  }

  const sliced = characters.slice(0, Math.max(1, maxLength - 1)).join("");
  const lastWhitespace = sliced.lastIndexOf(" ");
  const candidate =
    lastWhitespace >= Math.floor(maxLength * 0.55)
      ? sliced.slice(0, lastWhitespace)
      : sliced;
  return `${stripTrailingPunctuation(candidate)}…`;
}

function positiveIntegerOr(
  candidate: number | undefined,
  fallback: number,
): number {
  return typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate > 0
    ? candidate
    : fallback;
}

function sectionId(index: number): string {
  return `section-${String(index + 1).padStart(2, "0")}`;
}

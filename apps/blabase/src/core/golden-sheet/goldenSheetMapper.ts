import type {
  CanonicalConversation,
  CanonicalMessage
} from "../types/conversation";

export type GoldenSessionRow = {
  sessionId: string;
  title: string;
  shareUrl: string;
  sourceType: "ChatGPT 공유 링크";
  importedDate: string;
  labelingStatus: "미작성";
  datasetSplit: "미지정";
  memo: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
};

export type GoldenMessageRow = {
  sessionId: string;
  messageId: string;
  conversationOrder: number;
  originalMessageNumber: number;
  speaker: "사용자" | "ChatGPT" | "기타";
  originalText: string;
  messageClassification:
    "Clean Conversation" | "Context Signal" | "Excluded/Internal";
  analysisTarget: "예" | "아니오" | "보조 근거만";
  note: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GoldenPromptRow = {
  originalPrompt: string;
  sessionId: string;
  promptId: string;
  promptOrder: number;
  userMessageId: string;
  previousAssistantMessageId: string;
  promptRole: "미분류";
  previousAnswerEvaluation: "미판정";
  authorJudgment: "미작성";
  reviewResult: "미검수";
  promptCreatedAt: string | null;
  answerCompletedAt: string | null;
  responseDurationSeconds: number | null;
};

export type GoldenSessionSummaryRow = {
  sessionId: string;
  title: string;
};

export type GoldenSheetBundle = {
  session: GoldenSessionRow;
  messages: GoldenMessageRow[];
  prompts: GoldenPromptRow[];
  sessionSummary: GoldenSessionSummaryRow;
};

export function buildGoldenSheetBundle(input: {
  analysisId: string;
  sessionId: string;
  shareUrl: string;
  conversation: CanonicalConversation;
}): GoldenSheetBundle {
  const { analysisId, sessionId, shareUrl, conversation } = input;
  const title =
    conversation.title?.trim() || `${sessionId} ChatGPT conversation`;
  const orderedMessages = [...conversation.messages].sort(
    (left, right) => left.index - right.index
  );
  const messages = orderedMessages.map((message, position) =>
    mapMessage(sessionId, message, position)
  );
  const prompts = buildPromptRows(sessionId, orderedMessages);

  return {
    session: {
      sessionId,
      title,
      shareUrl,
      sourceType: "ChatGPT 공유 링크",
      importedDate: toDateString(conversation.importedAt),
      labelingStatus: "미작성",
      datasetSplit: "미지정",
      memo: `blabase 자동 가져오기 · ${analysisId}`,
      startedAt: conversation.stats.startedAt,
      endedAt: conversation.stats.endedAt,
      durationSeconds: conversation.stats.durationSeconds
    },
    messages,
    prompts,
    sessionSummary: {
      sessionId,
      title
    }
  };
}

export function formatGoldenMessageId(
  sessionId: string,
  messageIndex: number
): string {
  return `${sessionId}-M${String(messageIndex).padStart(3, "0")}`;
}

export function formatGoldenPromptId(
  sessionId: string,
  messageIndex: number
): string {
  return `${sessionId}-P${String(messageIndex).padStart(3, "0")}`;
}

function mapMessage(
  sessionId: string,
  message: CanonicalMessage,
  position: number
): GoldenMessageRow {
  const messageClassification = classificationFor(message);

  return {
    sessionId,
    messageId: formatGoldenMessageId(sessionId, message.index),
    conversationOrder: position + 1,
    originalMessageNumber: message.index,
    speaker: speakerFor(message.role),
    originalText: message.text,
    messageClassification,
    analysisTarget: analysisTargetFor(messageClassification),
    note: messageNote(message),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  };
}

function buildPromptRows(
  sessionId: string,
  orderedMessages: CanonicalMessage[]
): GoldenPromptRow[] {
  const userMessages = orderedMessages.filter(
    (message) =>
      message.role === "user" &&
      message.metadata.messageCategory === "clean_conversation"
  );

  return userMessages.map((message, position) => {
    const nextUser = userMessages[position + 1];
    const previousAssistant = [...orderedMessages]
      .reverse()
      .find(
        (candidate) =>
          candidate.index < message.index &&
          candidate.role === "assistant" &&
          candidate.metadata.messageCategory === "clean_conversation"
      );
    const scopedAssistants = orderedMessages.filter(
      (candidate) =>
        candidate.index > message.index &&
        candidate.index < (nextUser?.index ?? Number.POSITIVE_INFINITY) &&
        candidate.role === "assistant" &&
        candidate.metadata.messageCategory === "clean_conversation"
    );
    const answer = finalAssistant(scopedAssistants);
    const answerCompletedAt = answer?.createdAt ?? null;

    return {
      originalPrompt: message.text,
      sessionId,
      promptId: formatGoldenPromptId(sessionId, message.index),
      promptOrder: position + 1,
      userMessageId: formatGoldenMessageId(sessionId, message.index),
      previousAssistantMessageId: previousAssistant
        ? formatGoldenMessageId(sessionId, previousAssistant.index)
        : "",
      promptRole: "미분류",
      previousAnswerEvaluation: "미판정",
      authorJudgment: "미작성",
      reviewResult: "미검수",
      promptCreatedAt: message.createdAt,
      answerCompletedAt,
      responseDurationSeconds: elapsedSeconds(
        message.createdAt,
        answerCompletedAt
      )
    };
  });
}

function finalAssistant(messages: CanonicalMessage[]): CanonicalMessage | null {
  return (
    [...messages]
      .reverse()
      .find((message) =>
        ["final_answer", "final_answer_with_artifact"].includes(
          message.metadata.assistantMessageType ?? ""
        )
      ) ??
    messages.at(-1) ??
    null
  );
}

function elapsedSeconds(
  startedAt: string | null,
  endedAt: string | null
): number | null {
  if (!startedAt || !endedAt) return null;
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return null;
  return endedAtMs >= startedAtMs ? (endedAtMs - startedAtMs) / 1000 : null;
}

function classificationFor(
  message: CanonicalMessage
): GoldenMessageRow["messageClassification"] {
  switch (message.metadata.messageCategory) {
    case "context_signal":
      return "Context Signal";
    case "excluded_internal":
      return "Excluded/Internal";
    default:
      return "Clean Conversation";
  }
}

function analysisTargetFor(
  classification: GoldenMessageRow["messageClassification"]
): GoldenMessageRow["analysisTarget"] {
  switch (classification) {
    case "Context Signal":
      return "보조 근거만";
    case "Excluded/Internal":
      return "아니오";
    default:
      return "예";
  }
}

function speakerFor(
  role: CanonicalMessage["role"]
): GoldenMessageRow["speaker"] {
  if (role === "user") return "사용자";
  if (role === "assistant") return "ChatGPT";
  return "기타";
}

function messageNote(message: CanonicalMessage): string {
  return [
    message.metadata.contextSignalType,
    message.metadata.internalContentType,
    message.metadata.assistantMessageType,
    message.metadata.hasUnsupportedContent ? "unsupported content" : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function toDateString(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

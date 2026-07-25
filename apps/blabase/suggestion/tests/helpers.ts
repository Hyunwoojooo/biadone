import type { CanonicalConversation } from "../../src/core/types/conversation";
import type {
  RawTaskCandidate,
  VerifiedTaskCandidate
} from "../src/types";

export function conversationFixture(input?: {
  id?: string;
  userText?: string;
  assistantText?: string;
  endedAt?: string;
}): CanonicalConversation {
  const id = input?.id ?? "conversation-1";
  const endedAt = input?.endedAt ?? "2026-07-20T12:00:00.000Z";
  const userText =
    input?.userText ?? "금요일까지 계약서를 검토하고 회신해야 해.";
  const assistantText =
    input?.assistantText ?? "먼저 종료일 조항부터 확인해보세요.";

  return {
    id,
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/private",
      normalizedUrl: "https://chatgpt.com/share/private",
      shareId: id,
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "test",
      fetchedAt: endedAt
    },
    title: null,
    language: "ko",
    importedAt: endedAt,
    messages: [
      messageFixture(1, "user", userText, endedAt),
      messageFixture(2, "assistant", assistantText, endedAt)
    ],
    stats: {
      startedAt: endedAt,
      endedAt,
      durationSeconds: 10,
      totalMessages: 2,
      userMessages: 1,
      assistantMessages: 1,
      unsupportedMessages: 0,
      cleanConversationMessages: 2,
      contextSignalMessages: 0,
      excludedInternalMessages: 0,
      totalChars: userText.length + assistantText.length
    },
    warnings: []
  };
}

function messageFixture(
  index: number,
  role: "user" | "assistant",
  text: string,
  createdAt: string
): CanonicalConversation["messages"][number] {
  return {
    id: `msg-${index}`,
    index,
    role,
    createdAt,
    updatedAt: null,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw-${index}`,
      messageIndex: index,
      role
    },
    metadata: {
      messageCategory: "clean_conversation",
      visibility: "user_visible",
      contentType: "plain_text",
      semanticAnalyzable: true,
      assistantMessageType:
        role === "assistant" ? "final_answer" : undefined
    }
  };
}

export function rawCandidateFixture(
  overrides: Partial<RawTaskCandidate> = {}
): RawTaskCandidate {
  return {
    title: "계약서 검토 후 회신하기",
    target: "계약서",
    deliverable: "계약서 조건을 확인하고 상대방에게 회신한다.",
    owner: "user",
    state: "open",
    origin: "user_commitment",
    deadlineKind: "none",
    deadlineText: "",
    consequence: "none",
    evidence: [
      {
        kind: "task",
        messageIndex: 1,
        quote: "계약서를 검토하고 회신해야 해"
      }
    ],
    ...overrides
  };
}

export function verifiedCandidateFixture(
  overrides: Partial<VerifiedTaskCandidate> = {}
): VerifiedTaskCandidate {
  const conversationId = overrides.conversationId ?? "conversation-1";
  return {
    id: `task-${conversationId}`,
    canonicalKey: "계약서 계약서 조건을 확인하고 상대방에게 회신한다",
    title: "계약서 검토 후 회신하기",
    description: "계약서 조건을 확인하고 상대방에게 회신한다.",
    whyNow: "",
    firstStep: "계약서의 현재 상태를 10분 동안 확인하세요.",
    owner: "user",
    state: "not_started",
    origin: "explicit_user_commitment",
    executionMode: "user_must_act",
    deadlineIso: null,
    deadlineSource: null,
    impact: "high",
    effort: "minutes",
    blocks: [],
    blockedBy: [],
    confidence: 0.9,
    conversationId,
    conversationEndedAt: "2026-07-20T12:00:00.000Z",
    evidence: [
      {
        conversationId,
        messageId: "msg-1",
        kind: "task",
        messageIndex: 1,
        role: "user",
        quote: "계약서를 검토하고 회신해야 해",
        startChar: 6,
        endChar: 24
      }
    ],
    verificationIssues: [],
    ...overrides
  };
}

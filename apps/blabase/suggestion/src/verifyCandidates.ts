import { createHash } from "node:crypto";

import type { CanonicalConversation } from "../../src/core/types/conversation";

import type {
  RawTaskCandidate,
  VerifiedTaskCandidate,
  VerifiedTaskEvidence
} from "./types";

const USER_BACKED_ORIGINS = new Set<RawTaskCandidate["origin"]>([
  "user_commitment",
  "user_request",
  "accepted_next_step",
  "unresolved_blocker",
  "decision_required"
]);

export function verifyTaskCandidates(
  conversation: CanonicalConversation,
  candidates: RawTaskCandidate[]
): VerifiedTaskCandidate[] {
  return candidates.map((candidate) =>
    verifyCandidate(conversation, candidate)
  );
}

function verifyCandidate(
  conversation: CanonicalConversation,
  candidate: RawTaskCandidate
): VerifiedTaskCandidate {
  const issues = new Set<string>();
  const verifiedEvidence: VerifiedTaskEvidence[] = [];

  for (const evidence of candidate.evidence) {
    const message = conversation.messages.find(
      (item) => item.index === evidence.messageIndex
    );
    if (!message) {
      issues.add("OUT_OF_RANGE_MESSAGE_INDEX");
      continue;
    }
    if (
      message.metadata.messageCategory !== "clean_conversation" ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      issues.add("NON_CLEAN_EVIDENCE");
      continue;
    }
    const startChar = message.text.indexOf(evidence.quote);
    if (startChar < 0) {
      issues.add("QUOTE_NOT_FOUND");
      continue;
    }
    verifiedEvidence.push({
      ...evidence,
      conversationId: conversation.id,
      messageId: message.id,
      role: message.role,
      startChar,
      endChar: startChar + evidence.quote.length
    });
  }

  if (verifiedEvidence.length === 0) issues.add("MISSING_VERIFIED_EVIDENCE");

  const hasUserEvidence = verifiedEvidence.some(
    (evidence) => evidence.role === "user"
  );
  if (USER_BACKED_ORIGINS.has(candidate.origin) && !hasUserEvidence) {
    issues.add("USER_EVIDENCE_REQUIRED");
  }
  if (
    (candidate.owner === "user" || candidate.owner === "shared") &&
    !hasUserEvidence
  ) {
    issues.add("ASSISTANT_ONLY_USER_TASK");
  }
  const deadlineEvidence = verifiedEvidence.filter(
    (evidence) => evidence.kind === "deadline"
  );
  if (
    candidate.deadlineKind !== "none" &&
    (!candidate.deadlineText ||
      !deadlineEvidence.some((evidence) =>
        evidence.quote.includes(candidate.deadlineText)
      ))
  ) {
    issues.add("DEADLINE_SOURCE_NOT_VERIFIED");
  }
  if (
    candidate.consequence !== "none" &&
    !verifiedEvidence.some((evidence) => evidence.kind === "consequence")
  ) {
    issues.add("CONSEQUENCE_SOURCE_NOT_VERIFIED");
  }

  const canonicalKey = normalizeCanonicalKey(
    `${candidate.target} ${candidate.deliverable}`
  );
  const state = mapState(candidate.state);
  const origin = mapOrigin(candidate.origin);
  const blockingQuotes = verifiedEvidence
    .filter((evidence) => evidence.kind === "blocking")
    .map((evidence) => evidence.quote);
  const confidence = hasUserEvidence
    ? candidate.origin === "accepted_next_step"
      ? 0.85
      : 0.9
    : 0.55;
  if (confidence < 0.7) issues.add("LOW_CONFIDENCE");

  return {
    id: createTaskId(conversation.id, canonicalKey),
    canonicalKey,
    title: candidate.title,
    description: candidate.deliverable,
    whyNow: "",
    firstStep: `‘${candidate.title}’의 현재 상태를 확인하고, 다음 한 단계를 10분 동안 정리하세요.`,
    owner: candidate.owner,
    state,
    origin,
    executionMode: executionModeForOwner(candidate.owner),
    deadlineIso: parseVerifiedDeadline(
      candidate.deadlineKind,
      candidate.deadlineText
    ),
    deadlineSource:
      candidate.deadlineKind === "none" ? null : candidate.deadlineText,
    impact:
      candidate.consequence === "explicit_critical"
        ? "critical"
        : candidate.consequence === "explicit_high"
          ? "high"
          : "unknown",
    effort: "unknown",
    blocks: blockingQuotes,
    blockedBy: state === "blocked" ? blockingQuotes : [],
    confidence,
    conversationId: conversation.id,
    conversationEndedAt: conversation.stats.endedAt,
    evidence: verifiedEvidence,
    verificationIssues: [...issues].sort()
  };
}

function mapState(state: RawTaskCandidate["state"]): VerifiedTaskCandidate["state"] {
  return state === "open" ? "not_started" : state;
}

function mapOrigin(
  origin: RawTaskCandidate["origin"]
): VerifiedTaskCandidate["origin"] {
  switch (origin) {
    case "user_commitment":
      return "explicit_user_commitment";
    case "user_request":
      return "explicit_user_request";
    case "decision_required":
      return "open_question";
    default:
      return origin;
  }
}

function executionModeForOwner(
  owner: RawTaskCandidate["owner"]
): VerifiedTaskCandidate["executionMode"] {
  if (owner === "user") return "user_must_act";
  if (owner === "shared") return "agent_can_execute_with_approval";
  if (owner === "agent") return "agent_can_prepare";
  return "unknown";
}

function parseVerifiedDeadline(
  kind: RawTaskCandidate["deadlineKind"],
  text: string
): string | null {
  if (kind !== "absolute") return null;
  const isoDate = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (!isoDate) return null;
  const [, year, month, day] = isoDate;
  const parsed = new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T23:59:59+09:00`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeCanonicalKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createTaskId(conversationId: string, key: string): string {
  return `task_${createHash("sha256")
    .update(`${conversationId}|${normalizeCanonicalKey(key)}`)
    .digest("hex")
    .slice(0, 16)}`;
}

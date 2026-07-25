import type { CanonicalConversation } from "../../src/core/types/conversation";

export type SuggestionProviderId = "gemini" | "openai" | "qwen";

export type TaskOwner = "user" | "agent" | "shared" | "unknown";
export type TaskState =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "completed"
  | "cancelled"
  | "replaced"
  | "unclear";
export type TaskOrigin =
  | "explicit_user_commitment"
  | "explicit_user_request"
  | "accepted_next_step"
  | "unresolved_blocker"
  | "open_question"
  | "inferred";
export type ExecutionMode =
  | "user_must_act"
  | "agent_can_prepare"
  | "agent_can_execute_with_approval"
  | "unknown";

export type RawTaskEvidence = {
  kind:
    | "task"
    | "proposal"
    | "acceptance"
    | "state"
    | "deadline"
    | "blocking"
    | "consequence";
  messageIndex: number;
  quote: string;
};

export type RawTaskCandidate = {
  title: string;
  target: string;
  deliverable: string;
  owner: TaskOwner;
  state:
    | "open"
    | "in_progress"
    | "blocked"
    | "waiting"
    | "completed"
    | "cancelled"
    | "replaced"
    | "unclear";
  origin:
    | "user_commitment"
    | "user_request"
    | "accepted_next_step"
    | "unresolved_blocker"
    | "decision_required";
  deadlineKind: "none" | "absolute" | "relative";
  deadlineText: string;
  consequence: "none" | "explicit_high" | "explicit_critical";
  evidence: RawTaskEvidence[];
};

export type VerifiedTaskEvidence = RawTaskEvidence & {
  conversationId: string;
  messageId: string;
  role: "user" | "assistant";
  startChar: number;
  endChar: number;
};

export type VerifiedTaskCandidate = {
  id: string;
  canonicalKey: string;
  title: string;
  description: string;
  whyNow: string;
  firstStep: string;
  owner: TaskOwner;
  state: TaskState;
  origin: TaskOrigin;
  executionMode: ExecutionMode;
  deadlineIso: string | null;
  deadlineSource: string | null;
  impact: "critical" | "high" | "medium" | "low" | "unknown";
  effort: "minutes" | "hours" | "days" | "unknown";
  blocks: string[];
  blockedBy: string[];
  confidence: number;
  conversationId: string;
  conversationEndedAt: string | null;
  evidence: VerifiedTaskEvidence[];
  verificationIssues: string[];
};

export type MergedTaskCandidate = Omit<
  VerifiedTaskCandidate,
  "conversationId" | "conversationEndedAt" | "verificationIssues"
> & {
  sourceConversationIds: string[];
  recurrenceCount: number;
  verificationIssues: string[];
};

export type PriorityFactors = {
  urgency: number;
  blockingPower: number;
  impact: number;
  commitmentStrength: number;
  crossConversationRecurrence: number;
  readiness: number;
  recency: number;
  uncertaintyPenalty: number;
  completionPenalty: number;
};

export type PriorityAssessment = {
  candidateId: string;
  eligibility: "eligible" | "review_required" | "ineligible";
  score: number;
  factors: PriorityFactors;
  reasonCodes: string[];
};

export type SourceStatus = {
  inputIndex: number;
  status: "restored" | "failed";
  conversationId: string | null;
  title: string | null;
  messageCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type SuggestionRunRecord = {
  runId: string;
  engineVersion: string;
  schemaVersion: string;
  promptVersion: string;
  verifierVersion: string;
  scoringVersion: string;
  provider: SuggestionProviderId;
  model: string;
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  candidateCount: number;
  eligibleCount: number;
  requestCount: number;
  failedRequestCount: number;
  usage: ProviderUsage;
};

export type PrioritySuggestionResult = {
  status:
    | "suggested"
    | "insufficient_evidence"
    | "needs_clarification";
  topSuggestion: {
    candidateId: string;
    title: string;
    whyNow: string;
    firstStep: string;
    owner: "user" | "shared";
    executionMode: ExecutionMode;
    confidence: number;
    score: number;
    recurrenceCount: number;
    sourceConversationCount: number;
    evidence: VerifiedTaskEvidence[];
  } | null;
  alternatives: Array<{
    candidateId: string;
    title: string;
    score: number;
  }>;
  clarificationQuestion: string | null;
  decisionDiagnostics: {
    mergedCandidateCount: number;
    eligibleCount: number;
    reviewRequiredCount: number;
    ineligibleCount: number;
    highestEligibleScore: number | null;
    minimumSuggestionScore: number;
    reasonCounts: Record<string, number>;
    verificationIssueCounts: Record<string, number>;
  };
  sources: SourceStatus[];
  run: SuggestionRunRecord;
};

export type RestoredConversation = {
  inputIndex: number;
  conversation: CanonicalConversation;
};

export type ProviderResponse = {
  outputText: string;
  requestId: string | null;
  responseModel: string | null;
  usage: ProviderUsage;
};

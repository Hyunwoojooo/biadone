import type {
  MergedTaskCandidate,
  PriorityAssessment,
  PriorityFactors
} from "./types";

const INELIGIBLE_STATES = new Set<MergedTaskCandidate["state"]>([
  "completed",
  "cancelled",
  "replaced"
]);
const BLOCKING_ISSUES = new Set([
  "MISSING_VERIFIED_EVIDENCE",
  "USER_EVIDENCE_REQUIRED",
  "ASSISTANT_ONLY_USER_TASK",
  "DEADLINE_SOURCE_REQUIRED",
  "DEADLINE_SOURCE_NOT_VERIFIED",
  "CONSEQUENCE_SOURCE_NOT_VERIFIED"
]);

export function scorePriority(
  candidate: MergedTaskCandidate,
  now: string
): PriorityAssessment {
  const factors = buildFactors(candidate, now);
  const reasonCodes: string[] = [];

  if (INELIGIBLE_STATES.has(candidate.state)) {
    reasonCodes.push("TASK_ALREADY_FINAL");
  }
  if (candidate.owner !== "user" && candidate.owner !== "shared") {
    reasonCodes.push("NOT_A_USER_TASK");
  }
  if (
    candidate.verificationIssues.some((issue) => BLOCKING_ISSUES.has(issue))
  ) {
    reasonCodes.push("EVIDENCE_GATE_FAILED");
  }
  if (candidate.confidence < 0.7) reasonCodes.push("LOW_CONFIDENCE");
  if (factors.urgency >= 80) reasonCodes.push("DEADLINE_SOON");
  if (factors.blockingPower >= 70) reasonCodes.push("UNBLOCKS_OTHER_WORK");
  if (candidate.recurrenceCount >= 2)
    reasonCodes.push("REPEATED_ACROSS_CONVERSATIONS");
  if (factors.commitmentStrength >= 80)
    reasonCodes.push("EXPLICIT_USER_COMMITMENT");

  const ineligible = reasonCodes.some((code) =>
    [
      "TASK_ALREADY_FINAL",
      "NOT_A_USER_TASK",
      "EVIDENCE_GATE_FAILED"
    ].includes(code)
  );
  const reviewRequired = !ineligible && candidate.verificationIssues.length > 0;
  const score = ineligible ? 0 : calculateScore(factors);

  return {
    candidateId: candidate.id,
    eligibility: ineligible
      ? "ineligible"
      : reviewRequired
        ? "review_required"
        : "eligible",
    score,
    factors,
    reasonCodes
  };
}

function buildFactors(
  candidate: MergedTaskCandidate,
  now: string
): PriorityFactors {
  const urgency = urgencyScore(candidate.deadlineIso, now);
  const hasVerifiedBlockingPhrase =
    candidate.blocks.length > 0 &&
    candidate.evidence.some((evidence) =>
      /막|선행|먼저|전제|없이는|block|depend/i.test(evidence.quote)
    );
  const blockingPower =
    hasVerifiedBlockingPhrase
      ? Math.min(100, 70 + candidate.blocks.length * 10)
      : candidate.state === "blocked"
        ? 40
        : 20;
  const hasVerifiedConsequence = candidate.evidence.some((evidence) =>
    /손실|위험|중단|실패|해지|벌금|critical|risk|loss/i.test(evidence.quote)
  );
  const impact =
    hasVerifiedConsequence && candidate.impact === "critical"
      ? 100
      : hasVerifiedConsequence && candidate.impact === "high"
        ? 80
        : candidate.impact === "low"
          ? 30
          : 45;
  const commitmentStrength = {
    explicit_user_commitment: 100,
    explicit_user_request: 90,
    accepted_next_step: 80,
    unresolved_blocker: 70,
    open_question: 55,
    inferred: 20
  }[candidate.origin];
  const crossConversationRecurrence = Math.min(
    100,
    candidate.recurrenceCount * 35
  );
  const readiness =
    candidate.blockedBy.length > 0 || candidate.state === "waiting"
      ? 25
      : candidate.effort === "minutes"
        ? 100
        : candidate.effort === "hours"
          ? 75
          : 55;
  const recency = Math.min(100, 45 + candidate.recurrenceCount * 15);
  const uncertaintyPenalty = Math.round((1 - candidate.confidence) * 30);
  const completionPenalty = INELIGIBLE_STATES.has(candidate.state) ? 100 : 0;

  return {
    urgency,
    blockingPower,
    impact,
    commitmentStrength,
    crossConversationRecurrence,
    readiness,
    recency,
    uncertaintyPenalty,
    completionPenalty
  };
}

function calculateScore(factors: PriorityFactors): number {
  const raw =
    factors.urgency * 0.2 +
    factors.blockingPower * 0.2 +
    factors.impact * 0.2 +
    factors.commitmentStrength * 0.15 +
    factors.crossConversationRecurrence * 0.1 +
    factors.readiness * 0.1 +
    factors.recency * 0.05 -
    factors.uncertaintyPenalty -
    factors.completionPenalty;
  return Math.max(0, Math.min(100, Number(raw.toFixed(2))));
}

function urgencyScore(deadlineIso: string | null, now: string): number {
  if (!deadlineIso) return 35;
  const deadline = Date.parse(deadlineIso);
  const reference = Date.parse(now);
  if (!Number.isFinite(deadline) || !Number.isFinite(reference)) return 35;
  const days = (deadline - reference) / 86_400_000;
  if (days <= 0) return 100;
  if (days <= 1) return 95;
  if (days <= 3) return 85;
  if (days <= 7) return 70;
  if (days <= 14) return 55;
  return 35;
}

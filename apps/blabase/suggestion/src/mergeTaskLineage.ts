import { createHash } from "node:crypto";

import type {
  MergedTaskCandidate,
  VerifiedTaskCandidate
} from "./types";
import { normalizeCanonicalKey } from "./verifyCandidates";

export function mergeTaskLineage(
  candidates: VerifiedTaskCandidate[]
): MergedTaskCandidate[] {
  const groups = new Map<string, VerifiedTaskCandidate[]>();

  for (const candidate of candidates) {
    const key = normalizeCanonicalKey(candidate.canonicalKey);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => mergeGroup(key, group));
}

function mergeGroup(
  canonicalKey: string,
  candidates: VerifiedTaskCandidate[]
): MergedTaskCandidate {
  const ordered = [...candidates].sort(compareCandidateTime);
  const latest = ordered.at(-1) as VerifiedTaskCandidate;
  const strongest = [...ordered].sort(
    (left, right) => right.confidence - left.confidence
  )[0];
  const stateSource = ordered.at(-1) as VerifiedTaskCandidate;
  const sourceConversationIds = [
    ...new Set(ordered.map((candidate) => candidate.conversationId))
  ].sort();
  const evidence = dedupeEvidence(
    ordered.flatMap((candidate) => candidate.evidence)
  );
  const issues = [
    ...new Set(ordered.flatMap((candidate) => candidate.verificationIssues))
  ].sort();
  if (
    new Set(ordered.map((candidate) => candidate.state)).size > 1 &&
    ordered.some((candidate) => !candidate.conversationEndedAt)
  ) {
    issues.push("STATE_CHRONOLOGY_UNCLEAR");
  }

  return {
    ...strongest,
    id: `merged_${createHash("sha256")
      .update(canonicalKey)
      .digest("hex")
      .slice(0, 16)}`,
    canonicalKey,
    title: latest.title || strongest.title,
    description: latest.description || strongest.description,
    whyNow: latest.whyNow || strongest.whyNow,
    firstStep: latest.firstStep || strongest.firstStep,
    state: stateSource.state,
    deadlineIso: latest.deadlineIso ?? strongest.deadlineIso,
    deadlineSource: latest.deadlineSource ?? strongest.deadlineSource,
    impact: highestImpact(ordered),
    blocks: [...new Set(ordered.flatMap((candidate) => candidate.blocks))],
    blockedBy: [
      ...new Set(ordered.flatMap((candidate) => candidate.blockedBy))
    ],
    evidence,
    confidence: Math.max(...ordered.map((candidate) => candidate.confidence)),
    sourceConversationIds,
    recurrenceCount: sourceConversationIds.length,
    verificationIssues: issues
  };
}

function compareCandidateTime(
  left: VerifiedTaskCandidate,
  right: VerifiedTaskCandidate
): number {
  const leftTime = Date.parse(left.conversationEndedAt ?? "") || 0;
  const rightTime = Date.parse(right.conversationEndedAt ?? "") || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.conversationId.localeCompare(right.conversationId);
}

function dedupeEvidence(
  evidence: MergedTaskCandidate["evidence"]
): MergedTaskCandidate["evidence"] {
  const unique = new Map<string, MergedTaskCandidate["evidence"][number]>();
  for (const item of evidence) {
    unique.set(
      `${item.conversationId}|${item.messageId}|${item.startChar}|${item.endChar}`,
      item
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.conversationId.localeCompare(right.conversationId) ||
      left.messageIndex - right.messageIndex ||
      left.startChar - right.startChar
  );
}

function highestImpact(
  candidates: VerifiedTaskCandidate[]
): MergedTaskCandidate["impact"] {
  const priority: Record<MergedTaskCandidate["impact"], number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    unknown: 1
  };
  return [...candidates]
    .sort((left, right) => priority[right.impact] - priority[left.impact])[0]
    .impact;
}

import { createHash } from "node:crypto";

import type {
  MergedTaskCandidate,
  VerifiedTaskCandidate,
  VerifiedTaskStateSignal
} from "./types";
import { normalizeCanonicalKey } from "./verifyCandidates";

const TERMINAL_STATES = new Set<VerifiedTaskCandidate["state"]>([
  "completed",
  "cancelled",
  "replaced"
]);
const REOPENING_STATES = new Set<VerifiedTaskCandidate["state"]>([
  "not_started",
  "in_progress",
  "blocked",
  "waiting"
]);
const IDENTITY_STATE_TOKENS = new Set([
  "complete",
  "completed",
  "done",
  "open",
  "pending",
  "대기",
  "미완료",
  "완료"
]);

export function mergeTaskLineage(
  candidates: VerifiedTaskCandidate[],
  stateSignals: VerifiedTaskStateSignal[] = []
): MergedTaskCandidate[] {
  const groups: VerifiedTaskCandidate[][] = [];

  for (const candidate of [...candidates].sort(compareCandidateIdentity)) {
    const group = groups.find((current) =>
      sameTaskFamily(current[0] as VerifiedTaskCandidate, candidate)
    );
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }

  return groups
    .map((group) => ({ key: stableGroupKey(group), group }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ key, group }) =>
      mergeGroup(
        key,
        group,
        stateSignals.filter((signal) =>
          group.some((candidate) => sameTaskFamily(candidate, signal))
        )
      )
    );
}

function mergeGroup(
  canonicalKey: string,
  candidates: VerifiedTaskCandidate[],
  stateSignals: VerifiedTaskStateSignal[]
): MergedTaskCandidate {
  const ordered = [...candidates].sort(compareCandidateTime);
  const latest = ordered.at(-1) as VerifiedTaskCandidate;
  const strongest = [...ordered].sort(
    (left, right) => right.confidence - left.confidence
  )[0];
  const terminalObservations: TaskStateObservation[] = [
    ...ordered.filter((candidate) => TERMINAL_STATES.has(candidate.state)),
    ...stateSignals
  ];
  const latestTerminal = terminalObservations
    .sort(compareObservationTime)
    .at(-1);
  const latestStructuredNonterminal = [...ordered]
    .filter(
      (candidate) =>
        REOPENING_STATES.has(candidate.state) &&
        candidate.sourceContexts.some(
          (context) => context.authority === "structured_source"
        )
    )
    .sort(compareObservationTime)
    .at(-1);
  const stateSource =
    latestTerminal === undefined
      ? latest
      : latestStructuredNonterminal !== undefined &&
          isStrictlyNewer(latestStructuredNonterminal, latestTerminal)
        ? latestStructuredNonterminal
        : latestTerminal;
  const sourceConversationIds = [
    ...new Set(ordered.map((candidate) => candidate.conversationId))
  ].sort();
  const evidence = dedupeEvidence(
    ordered.flatMap((candidate) => candidate.evidence)
  );
  const sourceContexts = dedupeSourceContexts(
    ordered.flatMap((candidate) => candidate.sourceContexts)
  );
  const issues = [
    ...new Set(ordered.flatMap((candidate) => candidate.verificationIssues))
  ].sort();
  if (
    new Set(
      [...ordered, ...stateSignals].map((observation) => observation.state)
    ).size > 1 &&
    [...ordered, ...stateSignals].some(
      (observation) => observationTime(observation) === null
    )
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
    sourceContexts,
    confidence: Math.max(...ordered.map((candidate) => candidate.confidence)),
    sourceConversationIds,
    recurrenceCount: sourceConversationIds.length,
    verificationIssues: issues
  };
}

function compareCandidateIdentity(
  left: VerifiedTaskCandidate,
  right: VerifiedTaskCandidate
): number {
  return (
    normalizeCanonicalKey(left.canonicalKey).localeCompare(
      normalizeCanonicalKey(right.canonicalKey)
    ) || left.id.localeCompare(right.id)
  );
}

function stableGroupKey(candidates: VerifiedTaskCandidate[]): string {
  return candidates
    .map((candidate) => normalizeCanonicalKey(candidate.canonicalKey))
    .sort((left, right) => left.localeCompare(right))[0] as string;
}

type TaskFamilyDescriptor = Pick<
  VerifiedTaskCandidate,
  "canonicalKey" | "title"
>;

type TaskStateObservation = Pick<
  VerifiedTaskCandidate,
  "state" | "conversationEndedAt" | "sourceContexts"
>;

function sameTaskFamily(
  left: TaskFamilyDescriptor,
  right: TaskFamilyDescriptor
): boolean {
  if (
    normalizeCanonicalKey(left.canonicalKey) ===
    normalizeCanonicalKey(right.canonicalKey)
  ) {
    return true;
  }
  const leftTitle = semanticTokens(left.title);
  const rightTitle = semanticTokens(right.title);
  const leftCanonical = semanticTokens(left.canonicalKey);
  const rightCanonical = semanticTokens(right.canonicalKey);
  return (
    leftTitle.length >= 3 &&
    rightTitle.length >= 3 &&
    leftCanonical.length >= 3 &&
    rightCanonical.length >= 3 &&
    overlapRatio(leftTitle, rightTitle) >= 0.8 &&
    overlapRatio(leftCanonical, rightCanonical) >= 0.75
  );
}

function semanticTokens(value: string): string[] {
  let normalized = normalizeCanonicalKey(value)
    .replace(/자격\s+증명(?:을|를|이|가)?/gu, " credential ")
    .replace(/비밀\s*값(?:을|를|이|가)?|시크릿/gu, " credential ")
    .replace(/공급자(?:의|용)?/gu, " provider ")
    .replace(/샌드박스(?:의|용)?/gu, " sandbox ")
    .replace(/교체\p{L}*|로테이션/gu, " rotate ")
    .replace(/제출\p{L}*/gu, " submit ")
    .replace(/\b(?:credentials?|secrets?)\b/gu, " credential ")
    .replace(/\b(?:replace|replaced|replacement|rotate|rotated|rotation)\b/gu, " rotate ")
    .replace(/\b(?:submit|submitted|submission)\b/gu, " submit ");
  normalized = normalizeCanonicalKey(normalized);
  const containsSandbox = normalized.split(" ").includes("sandbox");
  return [
    ...new Set(
      normalized
        .split(" ")
        .filter(Boolean)
        .filter((token) => !IDENTITY_STATE_TOKENS.has(token))
        .filter(
          (token) =>
            !containsSandbox ||
            (token !== "test" && token !== "testing" && token !== "테스트")
        )
    )
  ].sort((left, right) => left.localeCompare(right));
}

function overlapRatio(left: string[], right: string[]): number {
  const rightTokens = new Set(right);
  const shared = left.filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(left.length, right.length);
}

function isStrictlyNewer(
  candidate: TaskStateObservation,
  reference: TaskStateObservation
): boolean {
  const candidateTime = observationTime(candidate);
  const referenceTime = observationTime(reference);
  return candidateTime !== null && referenceTime !== null && candidateTime > referenceTime;
}

function compareObservationTime(
  left: TaskStateObservation,
  right: TaskStateObservation
): number {
  return (observationTime(left) ?? 0) - (observationTime(right) ?? 0);
}

function observationTime(observation: TaskStateObservation): number | null {
  const observedTimes = observation.sourceContexts
    .map((context) => Date.parse(context.observedTo))
    .filter(Number.isFinite);
  if (observedTimes.length > 0) return Math.max(...observedTimes);
  const conversationTime = Date.parse(observation.conversationEndedAt ?? "");
  return Number.isFinite(conversationTime) ? conversationTime : null;
}

function dedupeSourceContexts(
  contexts: MergedTaskCandidate["sourceContexts"]
): MergedTaskCandidate["sourceContexts"] {
  const unique = new Map<
    string,
    MergedTaskCandidate["sourceContexts"][number]
  >();
  for (const context of contexts) {
    if (!unique.has(context.sourceId)) unique.set(context.sourceId, context);
  }
  return [...unique.values()].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId)
  );
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

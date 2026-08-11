import {
  activeAttentionResultSchema,
  type ActiveAttentionCandidate,
  type ActiveAttentionResult
} from "../attentionDecision/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
  FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
  FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT,
  FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION,
  FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION
} from "../crossSource/versions";
import { createFocusIdentityRef } from "../recentEvents/contracts";
import {
  currentFocusProjectionSchema,
  sealFocusAwareAttentionShadowProjection,
  type CurrentFocusProjection,
  type FocusAwareAttentionShadowProjection
} from "./contracts";

export type FocusAwareAttentionShadowInput = {
  asOf: string;
  currentFocus: CurrentFocusProjection;
  activeAttentionResult: ActiveAttentionResult;
  eligibilityProjectionSha256: string;
  workRelationProjectionSha256: string;
  claimAuthorityProjectionSha256: string;
};

type CandidateMatch = "exact" | "project" | "none";

export function resolveFocusAwareAttentionShadow(
  input: FocusAwareAttentionShadowInput
): FocusAwareAttentionShadowProjection {
  const parsed = parseInput(input);
  const existingTopCandidateId =
    parsed.activeAttentionResult.decision.topSuggestion?.candidateId ??
    null;
  const candidates = parsed.activeAttentionResult.rankedCandidates;
  const existingRankByCandidateId = new Map(
    candidates.map((candidate, index) => [candidate.candidateId, index + 1])
  );
  const matchByCandidateId = new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      focusMatch(candidate, parsed.currentFocusProjection)
    ])
  );
  const counterfactualCandidates =
    parsed.currentFocusProjection.status === "selected"
      ? reorderWithinSafetyTiers(candidates, matchByCandidateId)
      : [...candidates];
  const counterfactualTopCandidateId =
    counterfactualCandidates[0]?.candidateId ?? null;
  const wouldSwitch =
    existingTopCandidateId !== counterfactualTopCandidateId;
  const counterfactualRankByCandidateId = new Map(
    counterfactualCandidates.map((candidate, index) => [
      candidate.candidateId,
      index + 1
    ])
  );
  const dependencies = {
    currentFocusProjectionSha256:
      parsed.currentFocusProjection.projectionSha256,
    activeAttentionResultSha256:
      parsed.activeAttentionResult.resultSha256,
    eligibilityProjectionSha256:
      parsed.eligibilityProjectionSha256,
    workRelationProjectionSha256:
      parsed.workRelationProjectionSha256,
    claimAuthorityProjectionSha256:
      parsed.claimAuthorityProjectionSha256
  };
  const status = resolveStatus(
    parsed.currentFocusProjection,
    candidates.length
  );
  const retainedMatches = counterfactualCandidates
    .slice(0, 100)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      existingRank: existingRankByCandidateId.get(candidate.candidateId)!,
      counterfactualRank:
        counterfactualRankByCandidateId.get(candidate.candidateId)!,
      match: matchByCandidateId.get(candidate.candidateId) ?? "none"
    }));

  return sealFocusAwareAttentionShadowProjection({
    contract: FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT,
    schemaVersion: FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION,
    rankingPolicyVersion:
      FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
    resolverVersion:
      FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION,
    rolloutVersion: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
    asOf: parsed.asOf,
    inputSha256: runtimeSha256({
      domain: "focus-aware-attention-shadow-input-v0.1",
      asOf: parsed.asOf,
      dependencies,
      rankingPolicyVersion:
        FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
      resolverVersion:
        FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION
    }),
    dependencies,
    status,
    existingTopCandidateId,
    counterfactualTopCandidateId,
    wouldSwitch,
    matches: retainedMatches,
    totalMatchCount: counterfactualCandidates.length,
    omittedMatchCount:
      counterfactualCandidates.length - retainedMatches.length,
    reasonCodes: resolveReasonCodes({
      status,
      wouldSwitch,
      matches: [...matchByCandidateId.values()],
      currentFocus: parsed.currentFocusProjection
    }),
    candidateUniverseChanged: false,
    eligibilityDiffCount: 0,
    attentionSelectionEffect: "none"
  });
}

export function createDependencyMismatchFocusAwareAttentionShadow(input: {
  asOf: string;
  currentFocus: CurrentFocusProjection;
  activeAttentionResult: ActiveAttentionResult;
  eligibilityProjectionSha256: string;
  workRelationProjectionSha256: string;
  claimAuthorityProjectionSha256: string;
}): FocusAwareAttentionShadowProjection {
  const asOf = new Date(input.asOf).toISOString();
  const currentFocus = currentFocusProjectionSchema.parse(input.currentFocus);
  const activeAttentionResult = activeAttentionResultSchema.parse(
    input.activeAttentionResult
  );
  const eligibilityProjectionSha256 = parseSha256(
    input.eligibilityProjectionSha256
  );
  const workRelationProjectionSha256 = parseSha256(
    input.workRelationProjectionSha256
  );
  const claimAuthorityProjectionSha256 = parseSha256(
    input.claimAuthorityProjectionSha256
  );
  if (currentFocus.asOf !== asOf || activeAttentionResult.asOf !== asOf) {
    throw new TypeError(
      "Unavailable Focus shadow inputs must share one asOf."
    );
  }
  const existingTopCandidateId =
    activeAttentionResult.decision.topSuggestion?.candidateId ?? null;
  const dependencies = {
    currentFocusProjectionSha256: currentFocus.projectionSha256,
    activeAttentionResultSha256: activeAttentionResult.resultSha256,
    eligibilityProjectionSha256,
    workRelationProjectionSha256,
    claimAuthorityProjectionSha256
  };
  return sealFocusAwareAttentionShadowProjection({
    contract: FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT,
    schemaVersion: FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION,
    rankingPolicyVersion:
      FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
    resolverVersion:
      FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION,
    rolloutVersion: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
    asOf,
    inputSha256: runtimeSha256({
      domain: "focus-aware-attention-shadow-unavailable-input-v0.1",
      asOf,
      dependencies
    }),
    dependencies,
    status: "unavailable",
    existingTopCandidateId,
    counterfactualTopCandidateId: existingTopCandidateId,
    wouldSwitch: false,
    matches: [],
    totalMatchCount: 0,
    omittedMatchCount: 0,
    reasonCodes: ["SHADOW_DEPENDENCY_MISMATCH"],
    candidateUniverseChanged: false,
    eligibilityDiffCount: 0,
    attentionSelectionEffect: "none"
  });
}

function parseInput(input: FocusAwareAttentionShadowInput) {
  const asOf = new Date(input.asOf).toISOString();
  const currentFocusProjection = currentFocusProjectionSchema.parse(
    input.currentFocus
  );
  const activeAttentionResult = activeAttentionResultSchema.parse(
    input.activeAttentionResult
  );
  const eligibilityProjectionSha256 = parseSha256(
    input.eligibilityProjectionSha256
  );
  const workRelationProjectionSha256 = parseSha256(
    input.workRelationProjectionSha256
  );
  const claimAuthorityProjectionSha256 = parseSha256(
    input.claimAuthorityProjectionSha256
  );
  const focusDependencies = currentFocusProjection.dependencies;
  const focusDependencyHashes = Object.values(focusDependencies);
  const focusHasEvidenceGraph = focusDependencyHashes.every(
    (value) => value !== null
  );
  const focusHasNoEvidenceGraph = focusDependencyHashes.every(
    (value) => value === null
  );

  if (
    (!focusHasEvidenceGraph && !focusHasNoEvidenceGraph) ||
    (currentFocusProjection.status !== "unavailable" &&
      !focusHasEvidenceGraph) ||
    currentFocusProjection.asOf !== asOf ||
    activeAttentionResult.asOf !== asOf ||
    activeAttentionResult.dependencies.eligibilityProjectionSha256 !==
      eligibilityProjectionSha256 ||
    activeAttentionResult.dependencies.workRelationProjectionSha256 !==
      workRelationProjectionSha256 ||
    activeAttentionResult.dependencies.claimAuthorityProjectionSha256 !==
      claimAuthorityProjectionSha256 ||
    (focusHasEvidenceGraph &&
      (focusDependencies.workRelationProjectionSha256 !==
        workRelationProjectionSha256 ||
        focusDependencies.claimAuthorityProjectionSha256 !==
          claimAuthorityProjectionSha256))
  ) {
    throw new TypeError(
      "Focus-aware shadow inputs must share one exact evidence graph."
    );
  }

  return {
    asOf,
    currentFocusProjection,
    activeAttentionResult,
    eligibilityProjectionSha256,
    workRelationProjectionSha256,
    claimAuthorityProjectionSha256
  };
}

function parseSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("Focus-aware shadow dependency hash is invalid.");
  }
  return value;
}

function focusMatch(
  candidate: ActiveAttentionCandidate,
  projection: CurrentFocusProjection
): CandidateMatch {
  const focus = projection.selectedFocus;
  if (projection.status !== "selected" || focus === null) return "none";

  if (
    focus.level === "exact_task" &&
    exactFocusRefs(candidate).some(
      (ref) =>
        focus.latestMeaningfulEvent.claimTargetRefs.includes(ref) ||
        focus.latestMeaningfulEvent.relationRefs.includes(ref) ||
        focus.identityRefs.includes(ref)
    )
  ) {
    return "exact";
  }
  return focus.projectId !== null && candidate.projectId === focus.projectId
    ? "project"
    : "none";
}

function exactFocusRefs(candidate: ActiveAttentionCandidate): string[] {
  const refs = [candidate.targetRef];
  if (candidate.relationRef !== null) {
    refs.push(
      candidate.relationRef,
      createFocusIdentityRef({ relationRef: candidate.relationRef })
    );
  }
  if (candidate.executionId !== null) {
    refs.push(
      createFocusIdentityRef({
        source: "codex_managed",
        executionId: candidate.executionId
      })
    );
  }
  if (candidate.bindingId !== null) {
    refs.push(
      createFocusIdentityRef({
        source: "codex_managed",
        bindingId: candidate.bindingId
      })
    );
  }
  return refs;
}

function reorderWithinSafetyTiers(
  candidates: ActiveAttentionCandidate[],
  matchByCandidateId: ReadonlyMap<string, CandidateMatch>
): ActiveAttentionCandidate[] {
  const output = [...candidates];
  const existingRankByCandidateId = new Map(
    candidates.map((candidate, index) => [candidate.candidateId, index])
  );
  const indexesByTier = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const key = safetyTierKey(candidate);
    const indexes = indexesByTier.get(key) ?? [];
    indexes.push(index);
    indexesByTier.set(key, indexes);
  });
  for (const indexes of indexesByTier.values()) {
    const reordered = indexes
      .map((index) => candidates[index]!)
      .sort((left, right) => {
        const matchDelta =
          matchWeight(matchByCandidateId.get(right.candidateId) ?? "none") -
          matchWeight(matchByCandidateId.get(left.candidateId) ?? "none");
        return (
          matchDelta ||
          existingRankByCandidateId.get(left.candidateId)! -
            existingRankByCandidateId.get(right.candidateId)!
        );
      });
    indexes.forEach((outputIndex, tierIndex) => {
      output[outputIndex] = reordered[tierIndex]!;
    });
  }
  return output;
}

function safetyTierKey(candidate: ActiveAttentionCandidate): string {
  return JSON.stringify([
    candidate.lane,
    candidate.dueAt,
    candidate.triggerKind
  ]);
}

function matchWeight(match: CandidateMatch): number {
  return match === "exact" ? 2 : match === "project" ? 1 : 0;
}

function resolveStatus(
  focus: CurrentFocusProjection,
  candidateCount: number
): FocusAwareAttentionShadowProjection["status"] {
  if (focus.status === "unavailable") return "unavailable";
  if (focus.status !== "selected" || candidateCount === 0) {
    return "not_applied";
  }
  return "evaluated";
}

function resolveReasonCodes(input: {
  status: FocusAwareAttentionShadowProjection["status"];
  wouldSwitch: boolean;
  matches: CandidateMatch[];
  currentFocus: CurrentFocusProjection;
}): FocusAwareAttentionShadowProjection["reasonCodes"] {
  const reasons = new Set<
    FocusAwareAttentionShadowProjection["reasonCodes"][number]
  >([
    "SHADOW_CANDIDATE_UNIVERSE_UNCHANGED",
    "SHADOW_SAFETY_TIER_PRESERVED",
    input.wouldSwitch
      ? "SHADOW_COUNTERFACTUAL_TOP_CHANGED"
      : "SHADOW_EXISTING_TOP_PRESERVED"
  ]);
  if (input.status === "unavailable") {
    reasons.add(
      input.currentFocus.reasonCodes.some(
        (reasonCode) =>
          reasonCode === "FOCUS_DEPENDENCY_MISMATCH" ||
          reasonCode === "FOCUS_PROJECTION_UNAVAILABLE"
      )
        ? "SHADOW_DEPENDENCY_MISMATCH"
        : "SHADOW_NO_FOCUS_AVAILABLE"
    );
  } else if (
    input.status === "not_applied" &&
    input.currentFocus.status === "unresolved"
  ) {
    reasons.add("SHADOW_FOCUS_UNRESOLVED");
  }
  if (input.matches.includes("exact")) {
    reasons.add("SHADOW_EXACT_FOCUS_MATCH");
  }
  if (input.matches.includes("project")) {
    reasons.add("SHADOW_PROJECT_FOCUS_MATCH");
  }
  return [...reasons].sort(compareRuntimeStrings);
}

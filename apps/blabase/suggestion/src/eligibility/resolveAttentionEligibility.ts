import {
  managedCodexArtifactRelationProjectionSchema,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts";
import {
  claimAuthorityProjectionSchema,
  createClaimKey,
  createClaimTargetRef,
  type ClaimAuthorityProjection,
  type ClaimConflict,
  type ClaimField,
  type NormalizedWorkClaim
} from "../claims";
import {
  compareRuntimeStrings,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION,
  ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_ID_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_RESOLVER_VERSION,
  ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT
} from "../crossSource/versions";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";
import {
  managedCodexWorkRelationProjectionSchema,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  attentionEligibilityInputSha256,
  sealAttentionEligibilityShadowProjection,
  type AttentionEligibilityAssessment,
  type AttentionEligibilityDependencies,
  type AttentionEligibilityReasonCode,
  type AttentionEligibilityShadowProjection
} from "./contracts";

type GitHubWorkItemSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;

type CandidateSeed = {
  candidateSeedId: string;
  signal: GitHubWorkItemSignal;
  targetRef: string;
  relationRefs: string[];
};

type MaterialFieldResult =
  | { status: "resolved"; claim: NormalizedWorkClaim }
  | {
      status: "review_required";
      route: "user_review" | "refresh_sources";
      reason: AttentionEligibilityReasonCode;
    };

export function resolveAttentionEligibilityShadow(input: {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  claimAuthorityProjection: ClaimAuthorityProjection;
}): AttentionEligibilityShadowProjection {
  const asOf = new Date(input.asOf).toISOString();
  const workRelations = managedCodexWorkRelationProjectionSchema.parse(
    input.workRelationProjection
  );
  const artifacts = managedCodexArtifactRelationProjectionSchema.parse(
    input.artifactRelationProjection
  );
  const claims = claimAuthorityProjectionSchema.parse(
    input.claimAuthorityProjection
  );
  const githubBatch = parseGitHubBatch(input.githubBatch, asOf);

  assertExactDependencies({
    asOf,
    githubBatch,
    workRelations,
    artifacts,
    claims
  });

  const seeds = deriveGitHubCandidateSeeds(githubBatch, workRelations);
  const assessments = seeds
    .map((seed) => assessGitHubSeed(seed, githubBatch, claims))
    .sort((left, right) =>
      compareRuntimeStrings(left.assessmentId, right.assessmentId)
    );
  const dependencies = eligibilityDependencies({
    githubBatch,
    workRelations,
    artifacts,
    claims
  });
  const relatedUnresolvedConflictIds = new Set(
    seeds.flatMap((seed) =>
      relevantConflicts(seed, claims)
        .filter((conflict) => conflict.status === "review_required")
        .map((conflict) => conflict.conflictId)
    )
  );
  const candidateSeedIds = assessments.map(
    (assessment) => assessment.candidateSeedId
  );

  return sealAttentionEligibilityShadowProjection({
    contract: ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT,
    candidateSeedSchemaVersion:
      ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION,
    policyVersion: ATTENTION_ELIGIBILITY_POLICY_VERSION,
    evidencePolicyVersion:
      ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION,
    resolverVersion: ATTENTION_ELIGIBILITY_RESOLVER_VERSION,
    idPolicyVersion: ATTENTION_ELIGIBILITY_ID_POLICY_VERSION,
    mode: "shadow",
    asOf,
    dependencies,
    coverage: {
      candidateUniverse: "github_work_items_only",
      githubCandidateCoverage: githubCoverage(githubBatch),
      codexManagedEligibility: "not_evaluated_phase_4a",
      totalGitHubWorkItemSignalCount:
        githubBatch?.signals.filter(
          (signal) => signal.kind === "work_item_observation"
        ).length ?? 0,
      candidateSeedCount: assessments.length,
      unrelatedUnresolvedCriticalConflictCount: claims.conflicts.filter(
        (conflict) =>
          conflict.status === "review_required" &&
          !relatedUnresolvedConflictIds.has(conflict.conflictId)
      ).length
    },
    counts: {
      eligible: assessments.filter(
        (assessment) => assessment.status === "eligible"
      ).length,
      reviewRequired: assessments.filter(
        (assessment) => assessment.status === "review_required"
      ).length,
      ineligible: assessments.filter(
        (assessment) => assessment.status === "ineligible"
      ).length
    },
    assessments,
    inputSha256: attentionEligibilityInputSha256({
      asOf,
      dependencies,
      candidateSeedIds
    }),
    attentionSelectionEffect: "none",
    attentionDisposition: "shadow_only",
    forbiddenAsAttentionCandidate: true
  });
}

function deriveGitHubCandidateSeeds(
  batch: RuntimeWorkSignalBatch | null,
  workRelations: ManagedCodexWorkRelationProjection
): CandidateSeed[] {
  if (batch === null) return [];
  return batch.signals
    .filter(
      (signal): signal is GitHubWorkItemSignal =>
        signal.kind === "work_item_observation"
    )
    .map((signal) => {
      const targetRef = createClaimTargetRef({
        kind: "github_work_item",
        identity: {
          sourceScopeId: signal.sourceScopeId,
          subjectId: signal.subjectId
        }
      });
      return {
        candidateSeedId: runtimeStableId(
          "seed",
          ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION,
          {
            source: "github",
            targetRef,
            taskKind: signal.facts.taskKind
          }
        ),
        signal,
        targetRef,
        relationRefs: workRelations.relations
          .filter(
            (relation) =>
              relation.to.source === "github" &&
              relation.to.subjectId === signal.subjectId
          )
          .map((relation) => relation.relationId)
          .sort(compareRuntimeStrings)
      };
    })
    .sort((left, right) =>
      compareRuntimeStrings(left.candidateSeedId, right.candidateSeedId)
    );
}

function assessGitHubSeed(
  seed: CandidateSeed,
  batch: RuntimeWorkSignalBatch | null,
  claims: ClaimAuthorityProjection
): AttentionEligibilityAssessment {
  const { signal } = seed;
  const relatedConflicts = relevantConflicts(seed, claims);
  const base = {
    assessmentId: runtimeStableId(
      "elig",
      ATTENTION_ELIGIBILITY_ID_POLICY_VERSION,
      {
        candidateSeedId: seed.candidateSeedId,
        policyVersion: ATTENTION_ELIGIBILITY_POLICY_VERSION
      }
    ),
    candidateSeedId: seed.candidateSeedId,
    source: "github" as const,
    sourceSignalId: signal.signalId,
    targetRef: seed.targetRef,
    taskKind: signal.facts.taskKind,
    relationRefs: seed.relationRefs,
    relatedConflictIds: relatedConflicts
      .map((conflict) => conflict.conflictId)
      .sort(compareRuntimeStrings),
    attentionDisposition: "shadow_only" as const,
    forbiddenAsAttentionCandidate: true as const
  };

  if (signal.facts.semanticRole === "context_only") {
    return assessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_CONTEXT_ONLY"]
    });
  }
  if (signal.facts.taskKind === "authored_pull_request") {
    return assessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_UNSUPPORTED_TASK_KIND"]
    });
  }
  if (signal.facts.destinationUrl === null) {
    return assessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_NATIVE_DESTINATION_MISSING"]
    });
  }
  if (signal.attentionCapability !== "candidate_input") {
    return assessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_NOT_CANDIDATE_INPUT"]
    });
  }

  const actionKind =
    signal.facts.taskKind === "assigned_issue"
      ? ("do" as const)
      : ("inspect" as const);
  if (batch === null || batch.assessment.freshness !== "fresh") {
    return assessment(base, {
      actionKind,
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_SOURCE_STALE"]
    });
  }
  if (signal.completeness !== "complete") {
    return assessment(base, {
      actionKind,
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_MATERIAL_EVIDENCE_PARTIAL"]
    });
  }

  const state = resolveMaterialField(
    seed.targetRef,
    "github_work_item_state",
    claims
  );
  if (state.status === "review_required") {
    return reviewAssessment(base, actionKind, state);
  }
  if (
    state.claim.value.type !== "enum" ||
    state.claim.value.value !== "open"
  ) {
    return assessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_CURRENT_STATE_NOT_OPEN"]
    });
  }

  const relationship = resolveMaterialField(
    seed.targetRef,
    "github_user_relationship",
    claims
  );
  if (relationship.status === "review_required") {
    return reviewAssessment(base, actionKind, relationship);
  }
  const expectedRelationship =
    signal.facts.taskKind === "assigned_issue"
      ? "assigned_to_user"
      : "review_requested_from_user";
  if (
    relationship.claim.value.type !== "enum" ||
    relationship.claim.value.value !== expectedRelationship
  ) {
    return assessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_USER_RELATIONSHIP_MISMATCH"]
    });
  }

  const unresolved = relatedConflicts.filter(
    (conflict) => conflict.status === "review_required"
  );
  if (unresolved.length > 0) {
    const requiresUser = unresolved.some(
      (conflict) => conflict.nextAction === "user_review"
    );
    return assessment(base, {
      actionKind,
      status: "review_required",
      reviewRoute: requiresUser ? "user_review" : "refresh_sources",
      reasonCodes: [
        requiresUser
          ? "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER"
          : "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH"
      ]
    });
  }

  const reasonCodes: AttentionEligibilityReasonCode[] = [
    signal.facts.taskKind === "assigned_issue"
      ? "ELIGIBLE_DIRECT_ASSIGNED_ISSUE"
      : "ELIGIBLE_REVIEW_STATUS_INSPECTION"
  ];
  if (relatedConflicts.length > 0) {
    reasonCodes.push("ELIGIBLE_RELEVANT_CONFLICT_RESOLVED");
  }
  if (
    batch.assessment.completeness !== "complete" ||
    !batch.assessment.candidateSetComplete
  ) {
    reasonCodes.push("ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE");
  }
  return assessment(base, {
    actionKind,
    status: "eligible",
    reviewRoute: "none",
    reasonCodes
  });
}

function resolveMaterialField(
  targetRef: string,
  field: ClaimField,
  projection: ClaimAuthorityProjection
): MaterialFieldResult {
  const claimKey = createClaimKey({ targetRef, field });
  const resolution = projection.fieldResolutions.find(
    (candidate) => candidate.claimKey === claimKey
  );
  const conflict = projection.conflicts.find(
    (candidate) => candidate.claimKey === claimKey
  );
  if (!resolution) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MATERIAL_CLAIM_MISSING"
    };
  }
  if (resolution.status !== "resolved" || resolution.winningClaimId === null) {
    if (conflict?.nextAction === "user_review") {
      return {
        status: "review_required",
        route: "user_review",
        reason: "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER"
      };
    }
    return {
      status: "review_required",
      route: "refresh_sources",
      reason:
        conflict?.nextAction === "refresh_sources"
          ? "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH"
          : "REVIEW_MATERIAL_CLAIM_UNRESOLVED"
    };
  }
  const claim = projection.claims.find(
    (candidate) => candidate.claimId === resolution.winningClaimId
  );
  if (!claim) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MATERIAL_CLAIM_MISSING"
    };
  }
  if (claim.freshness !== "current") {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_SOURCE_STALE"
    };
  }
  if (claim.completeness !== "complete") {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MATERIAL_EVIDENCE_PARTIAL"
    };
  }
  return { status: "resolved", claim };
}

function reviewAssessment(
  base: Omit<
    AttentionEligibilityAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes"
  >,
  actionKind: "do" | "inspect",
  result: Extract<MaterialFieldResult, { status: "review_required" }>
): AttentionEligibilityAssessment {
  return assessment(base, {
    actionKind,
    status: "review_required",
    reviewRoute: result.route,
    reasonCodes: [result.reason]
  });
}

function assessment(
  base: Omit<
    AttentionEligibilityAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes"
  >,
  result: Pick<
    AttentionEligibilityAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes"
  >
): AttentionEligibilityAssessment {
  return {
    ...base,
    ...result,
    reasonCodes: [...new Set(result.reasonCodes)].sort(compareRuntimeStrings)
  };
}

function relevantConflicts(
  seed: CandidateSeed,
  projection: ClaimAuthorityProjection
): ClaimConflict[] {
  const relationRefs = new Set(seed.relationRefs);
  return projection.conflicts
    .filter(
      (conflict) =>
        conflict.target.ref === seed.targetRef ||
        conflict.relationRefs.some((relationRef) =>
          relationRefs.has(relationRef)
        )
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.conflictId, right.conflictId)
    );
}

function eligibilityDependencies(input: {
  githubBatch: RuntimeWorkSignalBatch | null;
  workRelations: ManagedCodexWorkRelationProjection;
  artifacts: ManagedCodexArtifactRelationProjection;
  claims: ClaimAuthorityProjection;
}): AttentionEligibilityDependencies {
  return {
    workRelationProjectionSha256: input.workRelations.projectionSha256,
    artifactRelationProjectionSha256: input.artifacts.projectionSha256,
    claimAuthorityProjectionSha256: input.claims.projectionSha256,
    githubBatchSha256: input.githubBatch?.batchSha256 ?? null,
    githubSourceSnapshotSha256:
      input.githubBatch?.sourceSnapshotSha256 ?? null,
    managedSourceRevision: input.workRelations.managedSourceRevision,
    managedGeneratedAt: input.workRelations.managedGeneratedAt,
    managedSemanticProjectionSha256:
      input.claims.inputs.managedSemanticProjectionSha256,
    contextRegistrySha256: input.workRelations.contextRegistrySha256
  };
}

function assertExactDependencies(input: {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  workRelations: ManagedCodexWorkRelationProjection;
  artifacts: ManagedCodexArtifactRelationProjection;
  claims: ClaimAuthorityProjection;
}): void {
  const githubBatchSha256 = input.githubBatch?.batchSha256 ?? null;
  const githubSourceSnapshotSha256 =
    input.githubBatch?.sourceSnapshotSha256 ?? null;
  if (
    input.workRelations.asOf !== input.asOf ||
    input.artifacts.asOf !== input.asOf ||
    input.claims.asOf !== input.asOf ||
    input.artifacts.workRelationProjectionSha256 !==
      input.workRelations.projectionSha256 ||
    input.claims.inputs.workRelationProjectionSha256 !==
      input.workRelations.projectionSha256 ||
    input.claims.inputs.artifactRelationProjectionSha256 !==
      input.artifacts.projectionSha256 ||
    input.workRelations.githubBatchSha256 !== githubBatchSha256 ||
    input.artifacts.githubBatchSha256 !== githubBatchSha256 ||
    input.claims.inputs.githubBatchSha256 !== githubBatchSha256 ||
    input.workRelations.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    input.artifacts.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    input.claims.inputs.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    input.claims.inputs.managedSourceRevision !==
      input.workRelations.managedSourceRevision ||
    input.claims.inputs.managedGeneratedAt !==
      input.workRelations.managedGeneratedAt ||
    input.claims.inputs.contextRegistrySha256 !==
      input.workRelations.contextRegistrySha256
  ) {
    throw new TypeError(
      "Eligibility inputs must share one exact evidence graph."
    );
  }
}

function parseGitHubBatch(
  input: RuntimeWorkSignalBatch | null,
  asOf: string
): RuntimeWorkSignalBatch | null {
  if (input === null) return null;
  const parsed = runtimeWorkSignalBatchSchema.parse(input);
  if (
    parsed.source !== "github" ||
    parsed.assessment.asOf !== asOf ||
    !verifyRuntimeWorkSignalBatchIntegrity(parsed).ok
  ) {
    throw new TypeError("Eligibility requires an integrity-verified GitHub batch.");
  }
  return parsed;
}

function githubCoverage(
  batch: RuntimeWorkSignalBatch | null
): "complete" | "partial" | "stale" | "unavailable" {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return "unavailable";
  }
  if (batch.assessment.freshness === "stale") return "stale";
  if (
    batch.assessment.completeness === "complete" &&
    batch.assessment.candidateSetComplete
  ) {
    return "complete";
  }
  return "partial";
}

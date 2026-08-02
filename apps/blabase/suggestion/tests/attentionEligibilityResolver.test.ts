import { describe, expect, it } from "vitest";

import {
  sealManagedCodexArtifactRelationProjection
} from "../src/artifacts";
import {
  canonicalClaimCoverage,
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  deriveGitHubClaims,
  resolveClaimAuthority,
  type BoundedClaimValue,
  type ClaimField,
  type NormalizedWorkClaim
} from "../src/claims";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import type {
  RuntimeWorkSignal,
  RuntimeWorkSignalBatch
} from "../src/crossSource/schema";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../src/crossSource/workSignalIntegrity";
import {
  attentionEligibilityShadowProjectionSchema,
  resolveAttentionEligibilityShadow
} from "../src/eligibility";
import {
  sealManagedCodexWorkRelationProjection
} from "../src/relations";

const AS_OF = "2026-08-02T03:00:00.000Z";
const OBSERVED_AT = "2026-08-02T02:50:00.000Z";
const MANAGED_SEMANTIC_SHA = "7".repeat(64);

describe("attention eligibility shadow resolver", () => {
  it("passes a fresh direct assigned issue without changing Attention selection", () => {
    const graph = graphFixture({ signals: [githubSignal()] });
    const projection = resolveGraph(graph);

    expect(projection.counts).toEqual({
      eligible: 1,
      reviewRequired: 0,
      ineligible: 0
    });
    expect(projection.assessments[0]).toMatchObject({
      taskKind: "assigned_issue",
      actionKind: "do",
      status: "eligible",
      reviewRoute: "none",
      reasonCodes: ["ELIGIBLE_DIRECT_ASSIGNED_ISSUE"],
      attentionDisposition: "shadow_only",
      forbiddenAsAttentionCandidate: true
    });
    expect(projection.attentionSelectionEffect).toBe("none");
    expect(
      attentionEligibilityShadowProjectionSchema.parse(projection)
    ).toEqual(projection);
  });

  it("allows only an inspection action for a draft-unknown review request", () => {
    const graph = graphFixture({
      signals: [
        githubSignal({
          objectId: 202,
          taskKind: "review_requested_pull_request"
        })
      ]
    });

    expect(resolveGraph(graph).assessments[0]).toMatchObject({
      taskKind: "review_requested_pull_request",
      actionKind: "inspect",
      status: "eligible",
      reasonCodes: ["ELIGIBLE_REVIEW_STATUS_INSPECTION"]
    });
  });

  it("excludes authored context and a candidate without a native destination", () => {
    const graph = graphFixture({
      signals: [
        githubSignal({ objectId: 202, taskKind: "authored_pull_request" }),
        githubSignal({ objectId: 203, destinationUrl: null })
      ]
    });
    const projection = resolveGraph(graph);

    expect(projection.counts).toEqual({
      eligible: 0,
      reviewRequired: 0,
      ineligible: 2
    });
    expect(
      projection.assessments.map((item) => item.reasonCodes[0]).sort()
    ).toEqual([
      "INELIGIBLE_CONTEXT_ONLY",
      "INELIGIBLE_NATIVE_DESTINATION_MISSING"
    ]);
  });

  it("routes stale source evidence to automatic refresh, not user review", () => {
    const graph = graphFixture({
      signals: [githubSignal()],
      freshness: "stale"
    });

    expect(resolveGraph(graph).assessments[0]).toMatchObject({
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_SOURCE_STALE"]
    });
  });

  it("routes material truncation to source refresh", () => {
    const graph = graphFixture({
      signals: [githubSignal({ completeness: "truncated" })],
      completeness: "partial"
    });

    expect(resolveGraph(graph).assessments[0]).toMatchObject({
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_MATERIAL_EVIDENCE_PARTIAL"]
    });
  });

  it("blocks only a relevant unresolved critical conflict for user review", () => {
    const signal = githubSignal();
    const graph = graphFixture({
      signals: [signal],
      transformClaims: (claims) => [
        ...claims,
        githubClaim({
          signal,
          field: "github_work_item_state",
          value: { type: "enum", value: "completed" },
          lineage: "conflicting-current-state"
        })
      ]
    });
    const projection = resolveGraph(graph);

    expect(graph.claims.unresolvedCriticalConflictCount).toBe(1);
    expect(projection.assessments[0]).toMatchObject({
      status: "review_required",
      reviewRoute: "user_review",
      reasonCodes: ["REVIEW_RELEVANT_CRITICAL_CONFLICT_USER"]
    });
  });

  it("ignores an unresolved critical conflict on another exact target", () => {
    const signal = githubSignal();
    const unrelated = githubSignal({ objectId: 999 });
    const graph = graphFixture({
      signals: [signal],
      transformClaims: (claims) => [
        ...claims,
        githubClaim({
          signal: unrelated,
          field: "github_work_item_state",
          value: { type: "enum", value: "open" },
          lineage: "unrelated-open"
        }),
        githubClaim({
          signal: unrelated,
          field: "github_work_item_state",
          value: { type: "enum", value: "completed" },
          lineage: "unrelated-completed"
        })
      ]
    });
    const projection = resolveGraph(graph);

    expect(graph.claims.unresolvedCriticalConflictCount).toBe(1);
    expect(projection.assessments[0].status).toBe("eligible");
    expect(
      projection.coverage.unrelatedUnresolvedCriticalConflictCount
    ).toBe(1);
  });

  it("does not block a disagreement already resolved by freshness", () => {
    const signal = githubSignal();
    const graph = graphFixture({
      signals: [signal],
      transformClaims: (claims) => [
        ...claims,
        githubClaim({
          signal,
          field: "github_work_item_state",
          value: { type: "enum", value: "completed" },
          lineage: "older-stale-state",
          freshness: "stale",
          sourceUpdatedAt: "2026-08-02T02:00:00.000Z"
        })
      ]
    });
    const projection = resolveGraph(graph);

    expect(graph.claims.conflicts[0]?.status).toBe(
      "resolved_by_freshness"
    );
    expect(projection.assessments[0]).toMatchObject({
      status: "eligible",
      reasonCodes: [
        "ELIGIBLE_DIRECT_ASSIGNED_ISSUE",
        "ELIGIBLE_RELEVANT_CONFLICT_RESOLVED"
      ]
    });
  });

  it("keeps a terminal candidate ineligible even when another field conflicts", () => {
    const signal = githubSignal();
    const graph = graphFixture({
      signals: [signal],
      transformClaims: (claims) => [
        ...claims.filter(
          (claim) => claim.field !== "github_work_item_state"
        ),
        githubClaim({
          signal,
          field: "github_work_item_state",
          value: { type: "enum", value: "completed" },
          lineage: "terminal-state"
        }),
        githubClaim({
          signal,
          field: "github_milestone_due_at",
          value: { type: "timestamp", value: "2026-08-04T00:00:00.000Z" },
          lineage: "deadline-a"
        }),
        githubClaim({
          signal,
          field: "github_milestone_due_at",
          value: { type: "timestamp", value: "2026-08-05T00:00:00.000Z" },
          lineage: "deadline-b"
        })
      ]
    });
    const projection = resolveGraph(graph);

    expect(projection.assessments[0]).toMatchObject({
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: ["INELIGIBLE_CURRENT_STATE_NOT_OPEN"]
    });
  });

  it("allows an exact candidate under nonmaterial partial source coverage", () => {
    const graph = graphFixture({
      signals: [githubSignal()],
      completeness: "partial"
    });
    const projection = resolveGraph(graph);

    expect(projection.coverage.githubCandidateCoverage).toBe("partial");
    expect(projection.assessments[0]).toMatchObject({
      status: "eligible",
      reasonCodes: [
        "ELIGIBLE_DIRECT_ASSIGNED_ISSUE",
        "ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE"
      ]
    });
  });

  it("keeps candidate semantics deterministic across source signal order", () => {
    const signals = [
      githubSignal({ objectId: 201 }),
      githubSignal({
        objectId: 202,
        taskKind: "review_requested_pull_request"
      })
    ];
    const forward = resolveGraph(graphFixture({ signals }));
    const reverse = resolveGraph(
      graphFixture({ signals: [...signals].reverse() })
    );

    expect(reverse.assessments).toEqual(forward.assessments);
    expect(reverse.counts).toEqual(forward.counts);
  });

  it("fails closed when one graph dependency comes from another revision", () => {
    const graph = graphFixture({ signals: [githubSignal()] });

    expect(() =>
      resolveAttentionEligibilityShadow({
        asOf: AS_OF,
        githubBatch: graph.githubBatch,
        workRelationProjection: graph.workRelations,
        artifactRelationProjection: graph.artifacts,
        claimAuthorityProjection: {
          ...graph.claims,
          inputs: {
            ...graph.claims.inputs,
            artifactRelationProjectionSha256: "f".repeat(64)
          }
        }
      })
    ).toThrow();
  });

  it("does not expose titles, repository names, destinations, or raw content", () => {
    const projection = resolveGraph(
      graphFixture({ signals: [githubSignal()] })
    );
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain("PRIVATE_ELIGIBILITY_TITLE");
    expect(serialized).not.toContain("PRIVATE_ELIGIBILITY_REPOSITORY");
    expect(serialized).not.toContain("https://github.com");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("answer");
  });
});

type GraphFixture = {
  githubBatch: RuntimeWorkSignalBatch;
  workRelations: ReturnType<typeof emptyWorkRelations>;
  artifacts: ReturnType<typeof emptyArtifacts>;
  claims: ReturnType<typeof resolveClaimAuthority>;
};

function resolveGraph(graph: GraphFixture) {
  return resolveAttentionEligibilityShadow({
    asOf: AS_OF,
    githubBatch: graph.githubBatch,
    workRelationProjection: graph.workRelations,
    artifactRelationProjection: graph.artifacts,
    claimAuthorityProjection: graph.claims
  });
}

function graphFixture(input: {
  signals: RuntimeWorkSignal[];
  freshness?: "fresh" | "stale";
  completeness?: "complete" | "partial";
  transformClaims?: (
    claims: NormalizedWorkClaim[]
  ) => NormalizedWorkClaim[];
}): GraphFixture {
  const githubBatch = githubBatchFixture(input);
  const workRelations = emptyWorkRelations(githubBatch);
  const artifacts = emptyArtifacts(workRelations);
  const derived = deriveGitHubClaims({
    batch: githubBatch,
    workRelations
  });
  const claims = resolveClaimAuthority({
    asOf: AS_OF,
    dependencies: {
      workRelationProjectionSha256: workRelations.projectionSha256,
      artifactRelationProjectionSha256: artifacts.projectionSha256,
      githubBatchSha256: githubBatch.batchSha256,
      githubSourceSnapshotSha256: githubBatch.sourceSnapshotSha256,
      managedSourceRevision: workRelations.managedSourceRevision,
      managedGeneratedAt: workRelations.managedGeneratedAt,
      managedSemanticProjectionSha256: MANAGED_SEMANTIC_SHA,
      contextRegistrySha256: null
    },
    sourceCoverage: canonicalClaimCoverage({
      github: input.freshness === "stale" ? "stale" :
        input.completeness === "partial" ? "partial" : "evaluated"
    }),
    claims: input.transformClaims?.(derived) ?? derived
  });
  return { githubBatch, workRelations, artifacts, claims };
}

function githubSignal(input?: {
  objectId?: number;
  taskKind?:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request";
  destinationUrl?: string | null;
  completeness?: "complete" | "truncated" | "unknown";
}): Extract<RuntimeWorkSignal, { kind: "work_item_observation" }> {
  const objectId = input?.objectId ?? 201;
  const taskKind = input?.taskKind ?? "assigned_issue";
  const relationship =
    taskKind === "assigned_issue"
      ? ("assigned_to_user" as const)
      : taskKind === "review_requested_pull_request"
        ? ("review_requested_from_user" as const)
        : ("authored_by_user" as const);
  const direct = taskKind !== "authored_pull_request";
  const objectType =
    taskKind === "assigned_issue" ? ("issue" as const) : ("pull_request" as const);
  const facts = {
    objectType,
    taskKind,
    state: "open" as const,
    relationship,
    semanticRole: direct ? ("direct_work_item" as const) : ("context_only" as const),
    eligibilityLimit:
      taskKind === "assigned_issue"
        ? ("none" as const)
        : taskKind === "review_requested_pull_request"
          ? ("draft_state_unknown" as const)
          : ("not_actionable_by_source_kind" as const),
    draftState:
      taskKind === "assigned_issue" ? ("not_applicable" as const) : ("unknown" as const),
    repositoryFullName: "PRIVATE_ELIGIBILITY_REPOSITORY/project",
    number: objectId,
    title: "PRIVATE_ELIGIBILITY_TITLE",
    destinationUrl:
      input?.destinationUrl === undefined
        ? `https://github.com/private/project/${objectType === "issue" ? "issues" : "pull"}/${objectId}`
        : input.destinationUrl
  };
  const snapshotSha256 = "5".repeat(64);
  const signal = finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    source: "github",
    subjectId: `github:object:${objectId}`,
    subjectType: "work_item",
    sourceScopeId: "repository:101",
    projectId: null,
    kind: "work_item_observation",
    facts,
    observedAt: OBSERVED_AT,
    sourceUpdatedAt: OBSERVED_AT,
    validUntil: null,
    directness: "explicit",
    completeness: input?.completeness ?? "complete",
    attentionCapability: direct ? "candidate_input" : "overview_only",
    evidence: [
      {
        type: "github_query_membership",
        source: "github",
        queryKind:
          taskKind === "assigned_issue"
            ? "assigned_open_issue"
            : taskKind === "review_requested_pull_request"
              ? "review_requested_open_pr"
              : "authored_open_pr",
        objectId: String(objectId),
        snapshotSha256,
        subjectId: `github:object:${objectId}`,
        observedAt: OBSERVED_AT,
        sourceUpdatedAt: OBSERVED_AT
      },
      {
        type: "github_object_field",
        source: "github",
        objectId: String(objectId),
        field: "state",
        valueSha256: runtimeSha256({ state: "open" }),
        snapshotSha256,
        subjectId: `github:object:${objectId}`,
        observedAt: OBSERVED_AT,
        sourceUpdatedAt: OBSERVED_AT
      }
    ]
  });
  if (signal.kind !== "work_item_observation") {
    throw new TypeError("Expected a GitHub work-item signal fixture.");
  }
  return signal;
}

function githubBatchFixture(input: {
  signals: RuntimeWorkSignal[];
  freshness?: "fresh" | "stale";
  completeness?: "complete" | "partial";
}): RuntimeWorkSignalBatch {
  const freshness = input.freshness ?? "fresh";
  const completeness = input.completeness ?? "complete";
  const truncated = input.signals.some(
    (signal) => signal.completeness === "truncated"
  );
  return finalizeRuntimeWorkSignalBatch({
    contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
    source: "github",
    sourceSchemaVersion: "github-snapshot-v2",
    collectorVersion: "github-collector-v0.2",
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: "5".repeat(64),
    normalizationInputSha256: "6".repeat(64),
    assessment: {
      contract: RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
      source: "github",
      asOf: AS_OF,
      fetchedAt: OBSERVED_AT,
      freshnessPolicyVersion: "test-freshness-v1",
      freshness,
      completeness,
      truncated,
      candidateSetComplete: completeness === "complete" && !truncated,
      usableForOverview: true,
      usableForCurrentCandidates: freshness === "fresh",
      reasonCodes: [
        freshness === "fresh" ? "SNAPSHOT_FRESH" : "SNAPSHOT_STALE",
        ...(truncated ? (["SNAPSHOT_TRUNCATED"] as const) : [])
      ]
    },
    skippedRecordCount: 0,
    issues: [],
    signals: input.signals
  });
}

function emptyWorkRelations(batch: RuntimeWorkSignalBatch) {
  return sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: AS_OF,
    managedSourceRevision: 0,
    managedGeneratedAt: OBSERVED_AT,
    bindingStoreRevision: 0,
    bindingStoreSha256: "1".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: batch.batchSha256,
    githubSourceSnapshotSha256: batch.sourceSnapshotSha256,
    totalManagedRunCount: 0,
    omittedManagedRunCount: 0,
    relations: [],
    runResolutions: [],
    inputSha256: "2".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function emptyArtifacts(workRelations: ReturnType<typeof emptyWorkRelations>) {
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: AS_OF,
    workRelationProjectionSha256: workRelations.projectionSha256,
    attributionStoreRevision: 0,
    attributionStoreSha256: "3".repeat(64),
    githubBatchSha256: workRelations.githubBatchSha256,
    githubSourceSnapshotSha256: workRelations.githubSourceSnapshotSha256,
    totalAttachDecisionCount: 0,
    unresolvedAttributionCount: 0,
    relations: [],
    inputSha256: "4".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function githubClaim(input: {
  signal: Extract<RuntimeWorkSignal, { kind: "work_item_observation" }>;
  field: ClaimField;
  value: BoundedClaimValue;
  lineage: string;
  freshness?: "current" | "stale";
  sourceUpdatedAt?: string;
}): NormalizedWorkClaim {
  return createNormalizedWorkClaim({
    target: {
      kind: "github_work_item",
      ref: createClaimTargetRef({
        kind: "github_work_item",
        identity: {
          sourceScopeId: input.signal.sourceScopeId,
          subjectId: input.signal.subjectId
        }
      })
    },
    lineageRef: createClaimLineageRef({
      source: "github",
      seed: input.lineage
    }),
    field: input.field,
    value: input.value,
    source: "github",
    origin: "github_normalized_snapshot",
    freshness: input.freshness ?? "current",
    completeness: "complete",
    directness: "explicit",
    observedAt: input.sourceUpdatedAt ?? OBSERVED_AT,
    sourceUpdatedAt: input.sourceUpdatedAt ?? OBSERVED_AT,
    evidenceRefs: [
      createClaimEvidenceRef({
        seed: input.lineage,
        valueSha256: runtimeSha256(input.value)
      })
    ]
  });
}

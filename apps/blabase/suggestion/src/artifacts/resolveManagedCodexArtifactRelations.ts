import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION
} from "../crossSource/versions";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";
import {
  managedCodexWorkRelationProjectionSchema,
  type ManagedCodexWorkRelation,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  createGitHubArtifactId,
  createManagedCodexArtifactRelationId,
  managedCodexArtifactRelationSchema,
  sealManagedCodexArtifactRelationProjection,
  workArtifactAttributionStoreSchema,
  type GitHubArtifactIdentity,
  type ManagedCodexArtifactRelation,
  type ManagedCodexArtifactRelationProjection,
  type WorkArtifactAttributionDecision,
  type WorkArtifactAttributionStore
} from "./contracts";

type GitHubWorkSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;

export function resolveManagedCodexArtifactRelations(input: {
  asOf: string;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  attributionStore: WorkArtifactAttributionStore;
  githubBatch: RuntimeWorkSignalBatch | null;
}): ManagedCodexArtifactRelationProjection {
  const asOf = new Date(input.asOf).toISOString();
  const workRelationProjection =
    managedCodexWorkRelationProjectionSchema.parse(
      input.workRelationProjection
    );
  if (workRelationProjection.asOf !== asOf) {
    throw new TypeError(
      "Artifact and work relation projections require the same as-of time."
    );
  }
  const attributionStore = workArtifactAttributionStoreSchema.parse(
    input.attributionStore
  );
  if (
    Date.parse(attributionStore.updatedAt) > Date.parse(asOf) ||
    attributionStore.decisions.some(
      (decision) => Date.parse(decision.decidedAt) > Date.parse(asOf)
    )
  ) {
    throw new TypeError(
      "Artifact attribution evidence cannot be newer than the projection."
    );
  }
  const githubBatch = parseGitHubBatch(input.githubBatch, asOf);
  const successors = successorDecisions(attributionStore);
  const attachDecisions = attributionStore.decisions.filter(
    (
      decision
    ): decision is WorkArtifactAttributionDecision & {
      action: "attach";
    } => decision.action === "attach"
  );
  const relations: ManagedCodexArtifactRelation[] = [];

  for (const decision of attachDecisions) {
    const workRelation = exactWorkRelation(
      decision,
      workRelationProjection
    );
    if (!workRelation) continue;
    const successor = successors.get(decision.attributionId);
    const artifactId = createGitHubArtifactId(decision.artifact);
    relations.push(
      managedCodexArtifactRelationSchema.parse({
        relationId: createManagedCodexArtifactRelationId({
          attributionId: decision.attributionId,
          executionId: decision.executionId,
          artifactId
        }),
        managedRunId: decision.managedRunId,
        bindingId: decision.bindingId,
        executionId: decision.executionId,
        executesRelationId: workRelation.relationId,
        attributionId: decision.attributionId,
        type: "produces",
        authority: "user_configured",
        artifactId,
        artifact: decision.artifact,
        attributionEvidence: {
          decidedAt: decision.decidedAt,
          decisionSource: "explicit_user",
          identityPolicyVersion:
            GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION
        },
        attributionLifecycle: successor
          ? {
              state:
                successor.action === "detach"
                  ? "superseded_by_detach"
                  : "superseded_by_reattribution",
              supersededByAttributionId: successor.attributionId
            }
          : {
              state: "active",
              supersededByAttributionId: null
            },
        githubObservation: resolveGitHubArtifactObservation(
          decision.artifact,
          githubBatch
        ),
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true
      })
    );
  }

  relations.sort((left, right) =>
    compareRuntimeStrings(left.relationId, right.relationId)
  );
  const inputSha256 = runtimeSha256({
    domain: "managed-codex-artifact-relation-input-v0.1",
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion:
      MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion:
      ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf,
    workRelationProjectionSha256:
      workRelationProjection.projectionSha256,
    attributionStore: {
      revision: attributionStore.revision,
      sha256: attributionStore.storeSha256
    },
    github: githubBatch
      ? {
          batchSha256: githubBatch.batchSha256,
          sourceSnapshotSha256: githubBatch.sourceSnapshotSha256
        }
      : null
  });

  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion:
      MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion:
      ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf,
    workRelationProjectionSha256:
      workRelationProjection.projectionSha256,
    attributionStoreRevision: attributionStore.revision,
    attributionStoreSha256: attributionStore.storeSha256,
    githubBatchSha256: githubBatch?.batchSha256 ?? null,
    githubSourceSnapshotSha256:
      githubBatch?.sourceSnapshotSha256 ?? null,
    totalAttachDecisionCount: attachDecisions.length,
    unresolvedAttributionCount:
      attachDecisions.length - relations.length,
    relations,
    inputSha256,
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function exactWorkRelation(
  decision: WorkArtifactAttributionDecision,
  projection: ManagedCodexWorkRelationProjection
): ManagedCodexWorkRelation | null {
  const resolution = projection.runResolutions.find(
    (candidate) =>
      candidate.managedRunId === decision.managedRunId
  );
  if (
    resolution?.status !== "resolved" ||
    resolution.bindingId !== decision.bindingId ||
    resolution.executionId !== decision.executionId ||
    resolution.relationId !== decision.executesRelationId
  ) {
    return null;
  }
  const relation = projection.relations.find(
    (candidate) => candidate.relationId === decision.executesRelationId
  );
  if (
    !relation ||
    relation.bindingId !== decision.bindingId ||
    relation.from.kind !== "execution" ||
    relation.from.source !== "codex" ||
    relation.from.subjectId !== decision.executionId ||
    !relation.managedRunIds.includes(decision.managedRunId)
  ) {
    return null;
  }
  return relation;
}

function successorDecisions(
  store: WorkArtifactAttributionStore
): Map<string, WorkArtifactAttributionDecision> {
  const result = new Map<string, WorkArtifactAttributionDecision>();
  for (const decision of store.decisions) {
    if (decision.supersedesAttributionId) {
      result.set(decision.supersedesAttributionId, decision);
    }
  }
  return result;
}

function resolveGitHubArtifactObservation(
  artifact: GitHubArtifactIdentity,
  batch: RuntimeWorkSignalBatch | null
): ManagedCodexArtifactRelation["githubObservation"] {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return unavailableObservation();
  }
  if (artifact.kind === "github_commit") {
    return {
      status: "not_observed",
      sourceSnapshotSha256: batch.sourceSnapshotSha256,
      signalIds: [],
      destinationUrl: null,
      sourceUpdatedAt: null,
      completeness: publicCompleteness(
        batch.assessment.completeness
      )
    };
  }

  const signals = batch.signals
    .filter(
      (signal): signal is GitHubWorkSignal =>
        signal.kind === "work_item_observation" &&
        signal.subjectId === `github:object:${artifact.objectId}`
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId)
    );
  if (signals.length === 0) {
    return {
      status: "not_observed",
      sourceSnapshotSha256: batch.sourceSnapshotSha256,
      signalIds: [],
      destinationUrl: null,
      sourceUpdatedAt: null,
      completeness: publicCompleteness(
        batch.assessment.completeness
      )
    };
  }
  const first = signals[0];
  const incompatible =
    !first ||
    signals.length > 20 ||
    signals.some(
      (signal) =>
        signal.facts.objectType !== "pull_request" ||
        signal.facts.number !== artifact.number ||
        signal.sourceScopeId !==
          `repository:${artifact.repositoryId}` ||
        signal.facts.destinationUrl !== first.facts.destinationUrl
    );
  if (incompatible) {
    return {
      status: "conflict",
      sourceSnapshotSha256: batch.sourceSnapshotSha256,
      signalIds: signals
        .slice(0, 20)
        .map((signal) => signal.signalId),
      destinationUrl: null,
      sourceUpdatedAt: null,
      completeness: publicCompleteness(
        batch.assessment.completeness
      )
    };
  }
  const sourceUpdatedAt = signals
    .map((signal) => signal.sourceUpdatedAt)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  return {
    status:
      batch.assessment.freshness === "fresh" ? "current" : "stale",
    sourceSnapshotSha256: batch.sourceSnapshotSha256,
    signalIds: signals.map((signal) => signal.signalId),
    // The exact native tuple is sufficient for this projection. Do not copy
    // the repository-bearing source URL into the artifact relation output.
    destinationUrl: null,
    sourceUpdatedAt,
    completeness: publicCompleteness(batch.assessment.completeness)
  };
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
    throw new TypeError("GitHub artifact relation input is invalid.");
  }
  return parsed;
}

function unavailableObservation(): ManagedCodexArtifactRelation["githubObservation"] {
  return {
    status: "unavailable",
    sourceSnapshotSha256: null,
    signalIds: [],
    destinationUrl: null,
    sourceUpdatedAt: null,
    completeness: null
  };
}

function publicCompleteness(
  value: RuntimeWorkSignalBatch["assessment"]["completeness"]
): "complete" | "truncated" {
  return value === "complete" ? "complete" : "truncated";
}

import { compareRuntimeStrings } from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";
import {
  sourceScopeFingerprint,
  workContextRegistrySchema,
  type WorkContextRegistry
} from "../context";
import {
  managedCodexArtifactRelationProjectionSchema,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts";
import {
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema,
  type ManagedCodexPublicProjection,
  type ManagedCodexSemanticProjection
} from "../managedCodex";
import {
  managedCodexWorkRelationProjectionSchema,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  opaqueProjectValue,
  type ClaimAuthorityProjection,
  type NormalizedWorkClaim
} from "./contracts";
import { deriveGitHubClaims } from "./deriveGitHubClaims";
import { deriveManagedCodexClaims } from "./deriveManagedCodexClaims";
import {
  canonicalClaimCoverage,
  resolveClaimAuthority
} from "./resolveClaimAuthority";

export function resolveCurrentClaimAuthority(input: {
  asOf: string;
  managedProjection: ManagedCodexPublicProjection;
  managedSemantics: ManagedCodexSemanticProjection;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
}): ClaimAuthorityProjection {
  const asOf = new Date(input.asOf).toISOString();
  const managedProjection = managedCodexPublicProjectionSchema.parse(
    input.managedProjection
  );
  const managedSemantics = managedCodexSemanticProjectionSchema.parse(
    input.managedSemantics
  );
  const workRelationProjection =
    managedCodexWorkRelationProjectionSchema.parse(
      input.workRelationProjection
    );
  const artifactRelationProjection =
    managedCodexArtifactRelationProjectionSchema.parse(
      input.artifactRelationProjection
    );
  const contextRegistry =
    input.contextRegistry === null
      ? null
      : workContextRegistrySchema.parse(input.contextRegistry);
  const githubBatch = parseGitHubBatch(input.githubBatch, asOf);

  if (
    workRelationProjection.asOf !== asOf ||
    artifactRelationProjection.asOf !== asOf ||
    artifactRelationProjection.workRelationProjectionSha256 !==
      workRelationProjection.projectionSha256
  ) {
    throw new TypeError(
      "Claim authority inputs must share one exact relation projection."
    );
  }
  assertRuntimeDependencyCoherence({
    managedProjection,
    managedSemantics,
    workRelationProjection,
    artifactRelationProjection,
    githubBatch,
    contextRegistry
  });

  const claims: NormalizedWorkClaim[] = [
    ...deriveGitHubClaims({
      batch: githubBatch,
      workRelations: workRelationProjection
    }),
    ...deriveManagedCodexClaims({
      managedProjection,
      managedSemantics,
      workRelations: workRelationProjection
    }),
    ...deriveProjectAlignmentClaims({
      workRelations: workRelationProjection,
      contextRegistry
    })
  ].sort((left, right) => compareRuntimeStrings(left.claimId, right.claimId));

  return resolveClaimAuthority({
    asOf,
    dependencies: {
      workRelationProjectionSha256:
        workRelationProjection.projectionSha256,
      artifactRelationProjectionSha256:
        artifactRelationProjection.projectionSha256,
      githubBatchSha256: githubBatch?.batchSha256 ?? null,
      githubSourceSnapshotSha256:
        githubBatch?.sourceSnapshotSha256 ?? null,
      managedSourceRevision: managedProjection.revision,
      managedGeneratedAt: managedProjection.generatedAt,
      managedSemanticProjectionSha256:
        managedSemantics.projectionSha256,
      contextRegistrySha256:
        contextRegistry?.registrySha256 ?? null
    },
    sourceCoverage: canonicalClaimCoverage({
      github: githubCoverage(githubBatch)
    }),
    claims
  });
}

function assertRuntimeDependencyCoherence(input: {
  managedProjection: ManagedCodexPublicProjection;
  managedSemantics: ManagedCodexSemanticProjection;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
}): void {
  const githubBatchSha256 = input.githubBatch?.batchSha256 ?? null;
  const githubSourceSnapshotSha256 =
    input.githubBatch?.sourceSnapshotSha256 ?? null;
  const contextRegistrySha256 =
    input.contextRegistry?.registrySha256 ?? null;
  if (
    input.workRelationProjection.managedSourceRevision !==
      input.managedProjection.revision ||
    input.workRelationProjection.managedGeneratedAt !==
      input.managedProjection.generatedAt ||
    input.workRelationProjection.githubBatchSha256 !==
      githubBatchSha256 ||
    input.workRelationProjection.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    input.workRelationProjection.contextRegistrySha256 !==
      contextRegistrySha256 ||
    input.managedSemantics.sourceRevision !==
      input.managedProjection.revision ||
    input.managedSemantics.generatedAt !==
      input.managedProjection.generatedAt ||
    Object.keys(input.managedSemantics.runs).length !==
      input.managedProjection.runs.length ||
    input.artifactRelationProjection.githubBatchSha256 !==
      githubBatchSha256 ||
    input.artifactRelationProjection.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256
  ) {
    throw new TypeError(
      "Claim authority inputs do not share exact source dependencies."
    );
  }
  for (const run of input.managedProjection.runs) {
    const semantic = input.managedSemantics.runs[run.managedRunId];
    if (
      !semantic ||
      semantic.bindingId !== run.bindingId ||
      semantic.executionId !== run.executionId
    ) {
      throw new TypeError(
        "Claim authority inputs do not share exact managed semantics."
      );
    }
  }
}

function deriveProjectAlignmentClaims(input: {
  workRelations: ManagedCodexWorkRelationProjection;
  contextRegistry: WorkContextRegistry | null;
}): NormalizedWorkClaim[] {
  if (input.contextRegistry === null) return [];
  const claims: NormalizedWorkClaim[] = [];
  for (const relation of input.workRelations.relations) {
    if (relation.bindingEvidence.bindingState !== "active") continue;
    const decisionIds = [
      relation.projectAlignment.codexMappingDecisionId,
      relation.projectAlignment.githubMappingDecisionId
    ].filter((value): value is string => value !== null);
    for (const decisionId of decisionIds) {
      const decision = input.contextRegistry.mappingDecisions.find(
        (candidate) => candidate.decisionId === decisionId
      );
      if (!decision || decision.action !== "confirm" || !decision.projectId) {
        continue;
      }
      claims.push(
        createNormalizedWorkClaim({
          target: {
            kind: "project_relation",
            ref: createClaimTargetRef({
              kind: "project_relation",
              identity: { relationId: relation.relationId }
            })
          },
          lineageRef: createClaimLineageRef({
            source: "explicit_user_mapping",
            scopeFingerprint: sourceScopeFingerprint(decision.scope)
          }),
          field: "project_alignment_identity",
          value: opaqueProjectValue(decision.projectId),
          source: "explicit_user",
          origin: "explicit_user_mapping",
          freshness: "current",
          completeness: "complete",
          directness: "explicit",
          observedAt: decision.decidedAt,
          sourceUpdatedAt: decision.decidedAt,
          evidenceRefs: [
            createClaimEvidenceRef({
              source: "explicit_user_mapping",
              decisionId
            })
          ],
          relationRefs: [relation.relationId]
        })
      );
    }
  }
  return claims.sort((left, right) =>
    compareRuntimeStrings(left.claimId, right.claimId)
  );
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
    throw new TypeError("GitHub claim input is invalid.");
  }
  return parsed;
}

function githubCoverage(
  batch: RuntimeWorkSignalBatch | null
): "evaluated" | "stale" | "partial" | "unavailable" {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return "unavailable";
  }
  if (batch.assessment.freshness === "stale") return "stale";
  if (
    batch.assessment.completeness === "partial" ||
    batch.assessment.truncated
  ) {
    return "partial";
  }
  return "evaluated";
}

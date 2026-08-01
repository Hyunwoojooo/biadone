import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import type {
  RuntimeWorkSignal,
  RuntimeWorkSignalBatch
} from "../crossSource/schema";
import type { ManagedCodexWorkRelationProjection } from "../relations";
import {
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  type NormalizedWorkClaim
} from "./contracts";

type GitHubWorkItemSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;
type GitHubDeadlineSignal = Extract<
  RuntimeWorkSignal,
  { kind: "deadline_observation" }
>;

export function deriveGitHubClaims(input: {
  batch: RuntimeWorkSignalBatch | null;
  workRelations: ManagedCodexWorkRelationProjection;
}): NormalizedWorkClaim[] {
  if (
    input.batch === null ||
    input.batch.assessment.freshness === "invalid"
  ) {
    return [];
  }
  const claims: NormalizedWorkClaim[] = [];
  const freshness: "current" | "stale" =
    input.batch.assessment.freshness === "fresh"
      ? "current"
      : "stale";
  const workSignals = input.batch.signals.filter(
    (signal): signal is GitHubWorkItemSignal =>
      signal.kind === "work_item_observation"
  );

  for (const signal of workSignals) {
    const relationRefs = input.workRelations.relations
      .filter(
        (relation) =>
          relation.to.source === "github" &&
          relation.to.subjectId === signal.subjectId
      )
      .map((relation) => relation.relationId)
      .sort(compareRuntimeStrings);
    const nativeTargetRef = createClaimTargetRef({
      kind: "github_work_item",
      identity: {
        sourceScopeId: signal.sourceScopeId,
        subjectId: signal.subjectId
      }
    });
    const nativeLineageRef = createClaimLineageRef({
      source: "github",
      sourceScopeId: signal.sourceScopeId,
      subjectId: signal.subjectId
    });
    const evidenceRefs = [
      createClaimEvidenceRef({
        source: "github",
        signalId: signal.signalId,
        signalHash: signal.signalHash
      })
    ];
    const common = {
      target: {
        kind: "github_work_item" as const,
        ref: nativeTargetRef
      },
      lineageRef: nativeLineageRef,
      source: "github" as const,
      origin: "github_normalized_snapshot" as const,
      freshness,
      completeness: claimCompleteness(signal.completeness),
      directness: "explicit" as const,
      observedAt: signal.observedAt,
      sourceUpdatedAt: signal.sourceUpdatedAt,
      evidenceRefs,
      relationRefs
    };
    claims.push(
      createNormalizedWorkClaim({
        ...common,
        field: "github_work_item_state",
        value: { type: "enum", value: signal.facts.state }
      }),
      createNormalizedWorkClaim({
        ...common,
        field: "github_user_relationship",
        value: { type: "enum", value: signal.facts.relationship }
      })
    );

    for (const relationId of relationRefs) {
      const relationTargetRef = createClaimTargetRef({
        kind: "github_work_item",
        identity: {
          relationId,
          equivalence: "bound_github_native_identity"
        }
      });
      claims.push(
        createNormalizedWorkClaim({
          ...common,
          target: {
            kind: "github_work_item",
            ref: relationTargetRef
          },
          field: "github_native_identity",
          value: {
            type: "opaque_hash",
            valueSha256: runtimeSha256({
              domain: "github-native-work-item-claim-v0.1",
              sourceScopeId: signal.sourceScopeId,
              subjectId: signal.subjectId,
              objectType: signal.facts.objectType,
              number: signal.facts.number
            })
          },
          relationRefs: [relationId]
        })
      );
    }
  }

  for (const signal of input.batch.signals.filter(
    (candidate): candidate is GitHubDeadlineSignal =>
      candidate.kind === "deadline_observation"
  )) {
    const matchingWorkItem = workSignals.find(
      (candidate) =>
        candidate.subjectId === signal.subjectId &&
        candidate.sourceScopeId === signal.sourceScopeId
    );
    if (!matchingWorkItem) continue;
    const relationRefs = input.workRelations.relations
      .filter(
        (relation) =>
          relation.to.source === "github" &&
          relation.to.subjectId === signal.subjectId
      )
      .map((relation) => relation.relationId)
      .sort(compareRuntimeStrings);
    claims.push(
      createNormalizedWorkClaim({
        target: {
          kind: "github_work_item",
          ref: createClaimTargetRef({
            kind: "github_work_item",
            identity: {
              sourceScopeId: signal.sourceScopeId,
              subjectId: signal.subjectId
            }
          })
        },
        lineageRef: createClaimLineageRef({
          source: "github",
          sourceScopeId: signal.sourceScopeId,
          subjectId: signal.subjectId
        }),
        field: "github_milestone_due_at",
        value: {
          type: "timestamp",
          value: signal.facts.deadlineAt
        },
        source: "github",
        origin: "github_normalized_snapshot",
        freshness,
        completeness: claimCompleteness(signal.completeness),
        directness: "explicit",
        observedAt: signal.observedAt,
        sourceUpdatedAt: signal.sourceUpdatedAt,
        evidenceRefs: [
          createClaimEvidenceRef({
            source: "github",
            signalId: signal.signalId,
            signalHash: signal.signalHash
          })
        ],
        relationRefs
      })
    );
  }

  return claims.sort((left, right) =>
    compareRuntimeStrings(left.claimId, right.claimId)
  );
}

function claimCompleteness(
  value: RuntimeWorkSignal["completeness"]
): "complete" | "partial" | "unknown" {
  if (value === "complete") return "complete";
  if (value === "truncated") return "partial";
  return "unknown";
}

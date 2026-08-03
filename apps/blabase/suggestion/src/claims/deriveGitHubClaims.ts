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
  const relationshipClaimSignalIds = selectRelationshipClaimSignals(
    workSignals
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
      })
    );
    if (relationshipClaimSignalIds.has(signal.signalId)) {
      claims.push(
        createNormalizedWorkClaim({
          ...common,
          field: "github_user_relationship",
          value: { type: "enum", value: signal.facts.relationship }
        })
      );
    }

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

/**
 * GitHub can return the same pull request through more than one user-role
 * query (for example, authored by the user and review requested from the
 * user). Those roles can coexist, so treating them as equal-authority value
 * disagreement would manufacture a critical conflict. For an otherwise exact
 * native object, retain the action-driving direct role as the singular
 * relationship claim. Conflicting native identities are deliberately left
 * untouched so the authority and relation layers can still fail closed.
 */
function selectRelationshipClaimSignals(
  signals: GitHubWorkItemSignal[]
): Set<string> {
  const byTarget = new Map<string, GitHubWorkItemSignal[]>();
  for (const signal of signals) {
    const key = `${signal.sourceScopeId}:${signal.subjectId}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), signal]);
  }

  const selected = new Set<string>();
  for (const group of byTarget.values()) {
    const first = group[0];
    if (
      !first ||
      group.some((signal) => !sameNativeGitHubObject(first, signal))
    ) {
      for (const signal of group) selected.add(signal.signalId);
      continue;
    }
    const winner = [...group].sort(
      (left, right) =>
        relationshipClaimPriority(left) -
          relationshipClaimPriority(right) ||
        compareRuntimeStrings(left.signalId, right.signalId)
    )[0];
    if (winner) selected.add(winner.signalId);
  }
  return selected;
}

function sameNativeGitHubObject(
  left: GitHubWorkItemSignal,
  right: GitHubWorkItemSignal
): boolean {
  return (
    left.facts.objectType === right.facts.objectType &&
    left.facts.number === right.facts.number &&
    left.facts.destinationUrl === right.facts.destinationUrl &&
    left.projectId === right.projectId
  );
}

function relationshipClaimPriority(signal: GitHubWorkItemSignal): number {
  switch (signal.facts.taskKind) {
    case "review_requested_pull_request":
      return 0;
    case "assigned_issue":
      return 1;
    case "authored_pull_request":
      return 2;
  }
}

function claimCompleteness(
  value: RuntimeWorkSignal["completeness"]
): "complete" | "partial" | "unknown" {
  if (value === "complete") return "complete";
  if (value === "truncated") return "partial";
  return "unknown";
}

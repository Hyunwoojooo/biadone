import { compareRuntimeStrings } from "../crossSource/canonicalHash";
import type {
  ManagedCodexPublicProjection,
  ManagedCodexSemanticProjection
} from "../managedCodex";
import type { ManagedCodexWorkRelationProjection } from "../relations";
import {
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  type NormalizedWorkClaim
} from "./contracts";

export function deriveManagedCodexClaims(input: {
  managedProjection: ManagedCodexPublicProjection;
  managedSemantics: ManagedCodexSemanticProjection;
  workRelations: ManagedCodexWorkRelationProjection;
}): NormalizedWorkClaim[] {
  const claims: NormalizedWorkClaim[] = [];
  for (const run of input.managedProjection.runs) {
    if (run.effectiveExecutionState === "unknown") continue;
    const semantic = input.managedSemantics.runs[run.managedRunId];
    if (
      !semantic ||
      semantic.bindingId !== run.bindingId ||
      semantic.executionId !== run.executionId
    ) {
      continue;
    }
    const evidence = [
      ...semantic.window.evidence,
      ...(semantic.detector.latestTurnEvidence
        ? [semantic.detector.latestTurnEvidence]
        : []),
      ...(semantic.detector.failureEvidence
        ? [semantic.detector.failureEvidence]
        : [])
    ]
      .filter(
        (item) => item.executionState === run.effectiveExecutionState
      )
      .sort(
        (left, right) =>
          right.sequence - left.sequence ||
          compareRuntimeStrings(right.evidenceId, left.evidenceId)
      )[0];
    if (!evidence) continue;
    const relationRefs = input.workRelations.relations
      .filter(
        (relation) =>
          relation.bindingId === run.bindingId &&
          relation.from.source === "codex" &&
          relation.from.subjectId === run.executionId &&
          relation.managedRunIds.includes(run.managedRunId)
      )
      .map((relation) => relation.relationId)
      .sort(compareRuntimeStrings);
    claims.push(
      createNormalizedWorkClaim({
        target: {
          kind: "codex_execution",
          ref: createClaimTargetRef({
            kind: "codex_execution",
            identity: {
              managedRunId: run.managedRunId,
              bindingId: run.bindingId,
              executionId: run.executionId
            }
          })
        },
        lineageRef: createClaimLineageRef({
          source: "codex_managed",
          managedRunId: run.managedRunId
        }),
        field: "managed_codex_execution_state",
        value: {
          type: "enum",
          value: run.effectiveExecutionState
        },
        source: "codex_managed",
        origin: "managed_codex_event_stream",
        freshness: "current",
        completeness:
          semantic.window.historyCompleteness === "complete" &&
          semantic.window.continuity === "continuous" &&
          semantic.window.clockQuality === "monotonic"
            ? "complete"
            : "partial",
        directness: "explicit",
        observedAt: evidence.observedAt,
        sourceUpdatedAt: evidence.observedAt,
        evidenceRefs: [
          createClaimEvidenceRef({
            source: "codex_managed",
            managedRunId: run.managedRunId,
            evidenceId: evidence.evidenceId,
            sequence: evidence.sequence,
            sourceEvent: evidence.sourceEvent,
            windowSha256: semantic.window.windowSha256,
            detectorSha256: semantic.detector.detectorSha256,
            semanticProjectionSha256:
              input.managedSemantics.projectionSha256
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

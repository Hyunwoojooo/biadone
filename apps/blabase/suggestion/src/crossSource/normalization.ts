import {
  compareRuntimeStrings,
  runtimeSha256
} from "./canonicalHash";
import type {
  FreshnessPolicy,
  NormalizationIssue,
  RuntimeWorkSignal,
  RuntimeWorkSignalBatch,
  SnapshotAssessment
} from "./schema";
import { RUNTIME_WORK_SIGNAL_CONTRACT } from "./versions";
import type { SourceCollectionFailure } from "./validateSnapshots";

export type RuntimeNormalizationResult =
  | {
      status: "normalized";
      batch: RuntimeWorkSignalBatch;
    }
  | {
      status: "rejected";
      failure: SourceCollectionFailure;
    };

export function computeNormalizationInputSha256(input: {
  sourceSnapshotSha256: string;
  sourceSchemaVersion: string;
  normalizerVersion: string;
  asOf: string;
  freshnessPolicy: FreshnessPolicy;
  contextRegistrySha256?: string | null;
}): string {
  return runtimeSha256({
    domain: "blabase-runtime-normalization-input-v0.3",
    workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
    ...input
  });
}

export function issuesFromAssessment(
  assessment: SnapshotAssessment
): NormalizationIssue[] {
  const issues: NormalizationIssue[] = [];
  for (const code of assessment.reasonCodes) {
    if (
      code === "SNAPSHOT_STALE" ||
      code === "SNAPSHOT_FROM_FUTURE" ||
      code === "SNAPSHOT_TRUNCATED" ||
      code === "GITHUB_ACTIVITIES_PARTIAL" ||
      code === "GITHUB_ACTIVITIES_UNAVAILABLE" ||
      code === "GITHUB_ACTIONABILITY_PARTIAL" ||
      code === "GITHUB_ACTIONABILITY_UNAVAILABLE"
    ) {
      issues.push({
        code,
        subjectId: null,
        recordSha256: null
      });
    }
  }
  return issues;
}

export function sortRuntimeSignals(
  signals: RuntimeWorkSignal[]
): RuntimeWorkSignal[] {
  return [...signals].sort(
    (left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId) ||
      compareRuntimeStrings(
        left.observationId,
        right.observationId
      )
  );
}

export function sortNormalizationIssues(
  issues: NormalizationIssue[]
): NormalizationIssue[] {
  return [...issues].sort(
    (left, right) =>
      compareRuntimeStrings(left.code, right.code) ||
      compareRuntimeStrings(
        left.subjectId ?? "",
        right.subjectId ?? ""
      ) ||
      compareRuntimeStrings(
        left.recordSha256 ?? "",
        right.recordSha256 ?? ""
      )
  );
}

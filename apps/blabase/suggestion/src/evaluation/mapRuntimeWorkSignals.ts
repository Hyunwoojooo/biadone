import { z } from "zod";

import {
  syntheticNormalizedSignalSchema,
  type CrossSourceEvaluationCase
} from "./crossSourceDatasetSchema";
import { computeCrossSourceSnapshotSha256 } from "./crossSourceIntegrity";

import { runtimeSha256 } from "../crossSource/canonicalHash";
import type {
  RuntimeWorkSignal,
  RuntimeWorkSignalBatch
} from "../crossSource/schema";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";

const RUNTIME_EVALUATION_MAPPING_CONTRACT =
  "runtime-to-synthetic-signal-mapping-v0.1" as const;

type SyntheticNormalizedSignal =
  CrossSourceEvaluationCase["workSignals"][number];

const mappingOptionsSchema = z
  .object({
    snapshotId: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
    fixtureRef: z.string().trim().min(1).max(300)
  })
  .strict();

export type RuntimeEvaluationMapping = {
  contract: typeof RUNTIME_EVALUATION_MAPPING_CONTRACT;
  runtimeSourceSnapshotSha256: string;
  runtimeAssessment: RuntimeWorkSignalBatch["assessment"];
  snapshotReference: {
    snapshotId: string;
    snapshotSha256: string;
    fetchedAt: string;
    schemaVersion: string;
    normalizerVersion: string;
    fixtureRef: string;
  };
  signalCount: number;
  mappingSha256: string;
  signals: SyntheticNormalizedSignal[];
};

export function mapRuntimeBatchToSyntheticEvaluationSignals(
  batch: RuntimeWorkSignalBatch,
  optionsInput: {
    snapshotId: string;
    fixtureRef: string;
  }
): RuntimeEvaluationMapping {
  if (!verifyRuntimeWorkSignalBatchIntegrity(batch).ok) {
    throw new TypeError(
      "Runtime WorkSignal batch integrity verification failed."
    );
  }
  const options = mappingOptionsSchema.parse(optionsInput);
  const signals = batch.signals.map((signal) =>
    syntheticNormalizedSignalSchema.parse(
      mapRuntimeSignal(signal, options.snapshotId)
    )
  );
  const snapshotSha256 = computeCrossSourceSnapshotSha256({
    schemaVersion: batch.workSignalContract,
    normalizerVersion: batch.normalizerVersion,
    fetchedAt: batch.assessment.fetchedAt,
    signals
  });
  const withoutHash = {
    contract: RUNTIME_EVALUATION_MAPPING_CONTRACT,
    runtimeSourceSnapshotSha256: batch.sourceSnapshotSha256,
    runtimeAssessment: batch.assessment,
    snapshotReference: {
      snapshotId: options.snapshotId,
      snapshotSha256,
      fetchedAt: batch.assessment.fetchedAt,
      schemaVersion: batch.workSignalContract,
      normalizerVersion: batch.normalizerVersion,
      fixtureRef: options.fixtureRef
    },
    signalCount: signals.length,
    signals
  };
  return {
    ...withoutHash,
    mappingSha256: runtimeSha256({
      domain: RUNTIME_EVALUATION_MAPPING_CONTRACT,
      mapping: withoutHash
    })
  };
}

function mapRuntimeSignal(
  signal: RuntimeWorkSignal,
  snapshotId: string
): SyntheticNormalizedSignal {
  const common = {
    signalId: signal.signalId,
    source: signal.source,
    nativeId: signal.subjectId,
    subjectId: signal.subjectId,
    projectId: signal.projectId,
    observedAt: signal.observedAt,
    sourceUpdatedAt: signal.sourceUpdatedAt,
    validUntil: signal.validUntil,
    evidenceLevel:
      signal.directness === "explicit"
        ? ("explicit" as const)
        : ("derived" as const),
    completeness:
      signal.completeness === "complete"
        ? ("complete" as const)
        : ("partial" as const),
    evidenceRefs: [snapshotId]
  };

  switch (signal.kind) {
    case "work_item_observation":
      return {
        ...common,
        subjectType: "work_item",
        kind:
          signal.facts.taskKind ===
          "review_requested_pull_request"
            ? "review_requested"
            : signal.facts.taskKind === "authored_pull_request"
              ? "activity"
              : "task_exists",
        facts: {
          runtimeObservationId: signal.observationId,
          state: signal.facts.state,
          taskKind: signal.facts.taskKind,
          relationship: signal.facts.relationship,
          semanticRole: signal.facts.semanticRole,
          eligibilityLimit: signal.facts.eligibilityLimit,
          draft:
            signal.facts.draftState === "not_applicable"
              ? null
              : signal.facts.draftState,
          assignee:
            signal.facts.relationship === "assigned_to_user"
              ? "user"
              : null,
          reviewer:
            signal.facts.relationship ===
            "review_requested_from_user"
              ? "user"
              : null,
          repositoryFullName:
            signal.facts.repositoryFullName,
          number: signal.facts.number,
          title: signal.facts.title
        },
        destinationRef: githubDestinationRef(signal)
      };
    case "deadline_observation":
      return {
        ...common,
        subjectType: "work_item",
        kind: "deadline",
        facts: {
          runtimeObservationId: signal.observationId,
          deadlineAt: signal.facts.deadlineAt,
          deadlineKind: signal.facts.deadlineKind,
          taskKind: signal.facts.taskKind,
          semanticRole: signal.facts.semanticRole,
          eligibilityLimit: signal.facts.eligibilityLimit
        },
        destinationRef: null
      };
    case "activity_observation":
      return {
        ...common,
        subjectType: "event",
        kind: "activity",
        facts: {
          runtimeObservationId: signal.observationId,
          activityKind: signal.facts.activityKind,
          repositoryFullName:
            signal.facts.repositoryFullName,
          subjectType: signal.facts.subjectType,
          subjectNumber: signal.facts.subjectNumber,
          subjectTitle: signal.facts.subjectTitle,
          refName: signal.facts.refName,
          reviewState: signal.facts.reviewState,
          semanticRole: signal.facts.semanticRole
        },
        destinationRef: null
      };
    case "execution_observation":
      return {
        ...common,
        subjectType: "execution",
        kind: "execution_state",
        facts: {
          runtimeObservationId: signal.observationId,
          nativeState: signal.facts.nativeActivityState,
          state: signal.facts.semanticState,
          attentionBadge: signal.facts.nativeAttentionState,
          attentionSemanticRole:
            signal.facts.attentionSemanticRole,
          projectLabel: signal.facts.projectLabel,
          projectSemanticRole:
            signal.facts.projectSemanticRole,
          taskSummary: signal.facts.taskSummary,
          taskSummarySource: signal.facts.taskSummarySource,
          taskSummarySemanticRole:
            signal.facts.taskSummarySemanticRole
        },
        destinationRef: null
      };
  }
}

function githubDestinationRef(
  signal: Extract<
    RuntimeWorkSignal,
    { kind: "work_item_observation" }
  >
): string | null {
  if (signal.facts.destinationUrl === null) return null;
  const objectPath =
    signal.facts.objectType === "issue" ? "issues" : "pull";
  return `github://${signal.facts.repositoryFullName}/${objectPath}/${signal.facts.number}`;
}

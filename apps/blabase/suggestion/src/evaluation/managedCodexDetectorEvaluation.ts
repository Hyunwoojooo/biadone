import { randomBytes } from "node:crypto";

import { z } from "zod";

import detectorConfigArtifact from "../../eval/synthetic/managedCodexDetectorConfig.v0.1.json";
import datasetArtifact from "../../eval/synthetic/managedCodexDetectorCases.v0.1.json";
import {
  CODEX_APP_SERVER_EVENT_SCHEMA_VERSION,
  CODEX_EXECUTION_OBSERVATION_CONTRACT,
  codexExecutionObservationSchema,
  type CodexExecutionObservation
} from "../connectors/codex/observationContract";
import {
  CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
  CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
  createManagedCodexEvent,
  managedCodexExecutionStateSchema,
  managedCodexEventHistorySchema,
  managedCodexHistoryAnchorSchema,
  managedCodexItemTypeSchema,
  managedCodexPublicSourceEventSchema,
  managedCodexPublicRunProjectionSchema,
  managedCodexWaitingStateSchema,
  sealManagedCodexHistory,
  type ManagedCodexEventHistory,
  type ManagedCodexPublicRunProjection
} from "../managedCodex/contracts";
import {
  buildManagedCodexSemanticRunResult,
  type ManagedCodexSemanticRunResult
} from "../managedCodex/semanticTimeline";
import {
  CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
  CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION,
  CODEX_MANAGED_SEMANTIC_RULE_VERSION,
  CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
  CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT
} from "../crossSource/versions";
import { sha256Canonical } from "./crossSourceIntegrity";

export const CODEX_MANAGED_DETECTOR_DATASET_CONTRACT =
  "codex-managed-detector-evaluation-dataset-v0.1" as const;
export const CODEX_MANAGED_DETECTOR_CASE_SCHEMA_VERSION =
  "codex-managed-detector-case-v0.1" as const;
export const CODEX_MANAGED_DETECTOR_RUN_RECORD_CONTRACT =
  "codex-managed-detector-evaluation-run-v0.1" as const;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const managedRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
const bindingIdSchema = z.string().regex(/^binding_[a-f0-9]{32}$/);
const executionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const ownerInstanceIdSchema = z
  .string()
  .regex(/^instance_[a-f0-9]{32}$/);
const streamGenerationSchema = z
  .string()
  .regex(/^stream_[a-f0-9]{32}$/);

const streamEventSpecSchema = z
  .object({
    type: z.enum([
      "stream_connected",
      "stream_reconnected",
      "stream_disconnected",
      "run_failed",
      "run_closed"
    ]),
    at: timestampSchema,
    stream: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .strict();

const turnStartedSpecSchema = z
  .object({
    type: z.literal("turn_started"),
    at: timestampSchema,
    stream: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .strict();

const turnCompletedSpecSchema = z
  .object({
    type: z.literal("turn_completed"),
    status: z.enum(["completed", "failed", "interrupted"]),
    at: timestampSchema,
    stream: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .strict();

const threadActiveSpecSchema = z
  .object({
    type: z.literal("thread_active"),
    waitingState: z
      .enum(["waiting_on_approval", "waiting_on_user_input"])
      .nullable(),
    at: timestampSchema,
    stream: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .strict();

const simpleThreadSpecSchema = z
  .object({
    type: z.enum([
      "thread_idle",
      "thread_not_loaded",
      "thread_system_error"
    ]),
    at: timestampSchema,
    stream: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .strict();

const itemSpecSchema = z
  .object({
    type: z.enum(["item_started", "item_completed"]),
    itemType: z.enum([
      "user_message",
      "agent_message",
      "reasoning",
      "command_execution",
      "file_change",
      "tool_call",
      "collaboration",
      "web_search",
      "context_compaction",
      "other"
    ]),
    at: timestampSchema,
    stream: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .strict();

export const managedCodexDetectorEventSpecSchema =
  z.discriminatedUnion("type", [
    streamEventSpecSchema,
    turnStartedSpecSchema,
    turnCompletedSpecSchema,
    threadActiveSpecSchema,
    simpleThreadSpecSchema,
    itemSpecSchema
  ]);

type ManagedCodexDetectorEventSpec = z.infer<
  typeof managedCodexDetectorEventSpecSchema
>;
type ManagedCodexDetectorStreamEventSpec = z.infer<
  typeof streamEventSpecSchema
>;

const publicRunFixtureSchema = managedCodexPublicRunProjectionSchema
  .omit({
    managedRunId: true,
    bindingId: true,
    executionId: true,
    forbiddenAsAttentionCandidate: true
  })
  .strict();

const directEvidenceReasonSchema = z.enum([
  "CODEX_MANAGED_THREAD_ACTIVE",
  "CODEX_MANAGED_THREAD_IDLE",
  "CODEX_MANAGED_THREAD_NOT_LOADED",
  "CODEX_MANAGED_THREAD_SYSTEM_ERROR",
  "CODEX_MANAGED_TURN_STARTED",
  "CODEX_MANAGED_TURN_COMPLETED",
  "CODEX_MANAGED_TURN_FAILED",
  "CODEX_MANAGED_TURN_INTERRUPTED",
  "CODEX_MANAGED_ITEM_ACTIVITY",
  "CODEX_MANAGED_STREAM_CONNECTED",
  "CODEX_MANAGED_STREAM_RECONNECTED",
  "CODEX_MANAGED_STREAM_DISCONNECTED",
  "CODEX_MANAGED_RUN_FAILED",
  "CODEX_MANAGED_RUN_CLOSED"
]);

const expectedEvidenceSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    observedAt: timestampSchema,
    sourceEvent: managedCodexPublicSourceEventSchema,
    executionState: managedCodexExecutionStateSchema.nullable(),
    waitingState: managedCodexWaitingStateSchema,
    itemType: managedCodexItemTypeSchema,
    reasonCode: directEvidenceReasonSchema
  })
  .strict();

const expectedInvariantSemanticsSchema = z
  .object({
    contract: z.literal(
      CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT
    ),
    ruleVersion: z.literal(CODEX_MANAGED_SEMANTIC_RULE_VERSION),
    evidencePolicyVersion: z.literal(
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION
    ),
    meaningfulProgress: z.literal("unknown"),
    meaningfulProgressReason: z.literal(
      "TASK_OUTCOME_EVIDENCE_MISSING"
    ),
    stall: z.literal("not_evaluable"),
    stallReason: z.literal(
      "STALL_PHASE_HEARTBEAT_OUTCOME_EVIDENCE_MISSING"
    ),
    requestEscalation: z.literal("unsupported"),
    requestEscalationReason: z.literal(
      "STABLE_REQUEST_LIFECYCLE_MISSING"
    ),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

const expectedCaseSemanticsSchema = z
  .object({
    assessment: z.enum([
      "turn_running",
      "turn_completed",
      "turn_failed",
      "turn_interrupted",
      "thread_idle",
      "managed_run_failed",
      "managed_run_closed",
      "activity_observed",
      "observation_gap",
      "observation_unavailable",
      "insufficient_evidence"
    ]),
    latestTurnState: z.enum([
      "running",
      "completed",
      "failed",
      "interrupted",
      "not_observed",
      "unknown"
    ]),
    latestTurnEvidence: expectedEvidenceSchema.nullable(),
    failureLifecycle: z.enum([
      "latest_direct_turn_failure",
      "latest_direct_managed_run_failure",
      "superseded_by_newer_turn",
      "not_observed_in_retained_window",
      "unknown"
    ]),
    failureEvidence: expectedEvidenceSchema.nullable()
  })
  .strict();

const detectorCaseSchema = z
  .object({
    caseId: z.string().regex(/^MCD-DEV-[0-9]{3}$/),
    title: z.string().min(1).max(180),
    generatedAt: timestampSchema,
    anchor: managedCodexHistoryAnchorSchema.optional(),
    events: z.array(managedCodexDetectorEventSpecSchema).min(1).max(100),
    run: publicRunFixtureSchema,
    expected: expectedCaseSemanticsSchema,
    labels: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1)
  })
  .strict();

const lifecycleSchema = z
  .object({
    state: z.literal("mutable"),
    datasetSha256: z.null(),
    immutableRef: z.null(),
    frozenAt: z.null()
  })
  .strict();

export const managedCodexDetectorEvaluationDatasetSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_DETECTOR_DATASET_CONTRACT),
    schemaVersion: z.literal(
      CODEX_MANAGED_DETECTOR_CASE_SCHEMA_VERSION
    ),
    datasetVersion: z.literal("suggestion-codex-detector-dev-v0.1"),
    datasetRevision: z.literal(1),
    datasetClass: z.literal("dev_candidate"),
    inputBoundary: z.literal("managed_codex_event_history"),
    dataOrigin: z.literal("synthetic"),
    containsProductionData: z.literal(false),
    createdAt: timestampSchema,
    lifecycle: lifecycleSchema,
    detectorConfig: z
      .object({
        immutableRef: z.literal(
          "eval/synthetic/managedCodexDetectorConfig.v0.1.json"
        ),
        version: z.literal(
          "codex-managed-direct-event-detector-config-v0.1"
        ),
        sha256: sha256Schema
      })
      .strict(),
    fixtureIdentity: z
      .object({
        managedRunId: managedRunIdSchema,
        bindingId: bindingIdSchema,
        executionId: executionIdSchema,
        ownerInstanceId: ownerInstanceIdSchema,
        streamGeneration1: streamGenerationSchema,
        streamGeneration2: streamGenerationSchema,
        retentionAt: timestampSchema
      })
      .strict(),
    expectedInvariantSemantics: expectedInvariantSemanticsSchema,
    cases: z.array(detectorCaseSchema).min(16).max(100)
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = new Set<string>();
    dataset.cases.forEach((item, index) => {
      if (ids.has(item.caseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "caseId"],
          message: "Detector evaluation case IDs must be unique."
        });
      }
      ids.add(item.caseId);
    });
  });

export type ManagedCodexDetectorEvaluationDataset = z.infer<
  typeof managedCodexDetectorEvaluationDatasetSchema
>;
export type ManagedCodexDetectorEvaluationCase =
  ManagedCodexDetectorEvaluationDataset["cases"][number];

export type MaterializedManagedCodexDetectorCase = {
  evaluationCase: ManagedCodexDetectorEvaluationCase;
  run: ManagedCodexPublicRunProjection;
  history: ManagedCodexEventHistory;
};

export type ManagedCodexDetectorCaseResult = {
  caseId: string;
  passed: boolean;
  expectedDetectorSha256: string;
  actualDetectorSha256: string;
  semanticResultSha256: string;
  activeFailureExpected: boolean;
  activeFailureObserved: boolean;
};

export type ManagedCodexDetectorEvaluationMetrics = {
  caseCount: number;
  exactCasePassCount: number;
  exactCasePassRate: number;
  activeFailureExpectedCount: number;
  activeFailureObservedCount: number;
  activeFailureTruePositiveCount: number;
  activeFailureFalsePositiveCount: number;
  activeFailureFalseNegativeCount: number;
  activeFailurePrecision: number;
  activeFailureRecall: number;
  supersededFailureLeakageCount: number;
  gapStaleStateLeakageCount: number;
  systemErrorFalseFailureCount: number;
  unsupportedStallOrRequestEmissionCount: number;
};

export type ManagedCodexDetectorEvaluationRecord = {
  contract: typeof CODEX_MANAGED_DETECTOR_RUN_RECORD_CONTRACT;
  runId: string;
  comparisonRunId: null;
  comparisonReason: "INITIAL_TARGETED_DEV_CANDIDATE_BASELINE";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  dataset: {
    version: "suggestion-codex-detector-dev-v0.1";
    revision: 1;
    class: "dev_candidate";
    lifecycle: "mutable";
    inputBoundary: "managed_codex_event_history";
    canonicalSha256: string;
    materializedInputSha256: string;
    caseCount: number;
  };
  versions: {
    datasetSchemaVersion: typeof CODEX_MANAGED_DETECTOR_CASE_SCHEMA_VERSION;
    inputHistoryContract: typeof CODEX_MANAGED_EVENT_HISTORY_CONTRACT;
    observationSchemaVersion: typeof CODEX_APP_SERVER_EVENT_SCHEMA_VERSION;
    semanticSchemaVersion: typeof CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION;
    timelineContract: typeof CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT;
    detectorContract: typeof CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT;
    ruleVersion: typeof CODEX_MANAGED_SEMANTIC_RULE_VERSION;
    evidencePolicyVersion: typeof CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION;
  };
  detectorConfig: {
    immutableRef: string;
    version: string;
    sha256: string;
  };
  code: {
    commitSha: string | null;
    state:
      | "clean_commit"
      | "declared_commit"
      | "dirty_worktree"
      | "unavailable";
    fingerprintSha256: string | null;
  };
  inference: {
    provider: "not_applicable";
    model: "not_applicable";
    promptVersion: "not_applicable";
    tokenUsage: "not_applicable";
  };
  metrics: ManagedCodexDetectorEvaluationMetrics;
  cases: ManagedCodexDetectorCaseResult[];
  deterministicOutputSha256: string;
  errors: Array<{
    caseId: string;
    code: "DETECTOR_EXACT_MISMATCH";
  }>;
  attentionDisposition: "not_connected";
  privacyClass: "synthetic_sanitized_metadata";
};

export function loadManagedCodexDetectorEvaluationDataset(
  input: unknown
): ManagedCodexDetectorEvaluationDataset {
  const dataset = managedCodexDetectorEvaluationDatasetSchema.parse(input);
  const actualConfigVersion =
    typeof detectorConfigArtifact.version === "string"
      ? detectorConfigArtifact.version
      : null;
  const actualConfigSha256 = sha256Canonical(detectorConfigArtifact);
  if (
    dataset.detectorConfig.version !== actualConfigVersion ||
    dataset.detectorConfig.sha256 !== actualConfigSha256
  ) {
    throw new Error(
      "Managed Codex detector evaluation config integrity check failed."
    );
  }
  return dataset;
}

export const managedCodexDetectorEvaluationDataset =
  loadManagedCodexDetectorEvaluationDataset(datasetArtifact);

export const MANAGED_CODEX_DETECTOR_DATASET_SHA256 =
  sha256Canonical(managedCodexDetectorEvaluationDataset);

export function materializeManagedCodexDetectorCase(
  evaluationCase: ManagedCodexDetectorEvaluationCase,
  dataset: ManagedCodexDetectorEvaluationDataset =
    managedCodexDetectorEvaluationDataset
): MaterializedManagedCodexDetectorCase {
  const identity = dataset.fixtureIdentity;
  let sequence =
    (evaluationCase.anchor?.prunedThroughSequence ?? -1) + 1;
  let previousEventSha256 =
    evaluationCase.anchor?.prunedThroughEventSha256 ?? null;
  const events = evaluationCase.events.map((spec) => {
    const observation = observationFromSpec({
      spec,
      sequence,
      executionId: identity.executionId.slice(
        "codex:execution:".length
      )
    });
    const native = observation !== null;
    const event = createManagedCodexEvent({
      managedRunId: identity.managedRunId,
      sequence,
      ownerInstanceId: identity.ownerInstanceId,
      streamGeneration:
        spec.stream === 2
          ? identity.streamGeneration2
          : identity.streamGeneration1,
      observedAt: spec.at,
      retentionAt: identity.retentionAt,
      kind: native ? "native_notification" : "stream_lifecycle",
      streamKind: isStreamEventSpec(spec) ? spec.type : null,
      observation,
      itemType:
        spec.type === "item_started" ||
        spec.type === "item_completed"
          ? spec.itemType
          : null,
      previousEventSha256
    });
    sequence += 1;
    previousEventSha256 = event.eventSha256;
    return event;
  });
  const history = sealManagedCodexHistory({
    contract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
    managedRunId: identity.managedRunId,
    updatedAt: evaluationCase.generatedAt,
    anchor: evaluationCase.anchor ?? null,
    events
  });
  const run = managedCodexPublicRunProjectionSchema.parse({
    managedRunId: identity.managedRunId,
    bindingId: identity.bindingId,
    executionId: identity.executionId,
    ...evaluationCase.run,
    forbiddenAsAttentionCandidate: true
  });
  return { evaluationCase, run, history };
}

export function materializeManagedCodexDetectorDataset(
  dataset: ManagedCodexDetectorEvaluationDataset =
    managedCodexDetectorEvaluationDataset
): MaterializedManagedCodexDetectorCase[] {
  return dataset.cases.map((item) =>
    materializeManagedCodexDetectorCase(item, dataset)
  );
}

export function runManagedCodexDetectorEvaluation(input?: {
  startedAt?: Date;
  completedAt?: Date;
  code?: ManagedCodexDetectorEvaluationRecord["code"];
  dataset?: ManagedCodexDetectorEvaluationDataset;
}): ManagedCodexDetectorEvaluationRecord {
  const startedAt = input?.startedAt ?? new Date();
  const dataset = input?.dataset ?? managedCodexDetectorEvaluationDataset;
  const materialized = materializeManagedCodexDetectorDataset(dataset);
  const materializedInputSha256 = sha256Canonical(
    materialized.map(({ evaluationCase, run, history }) => ({
      caseId: evaluationCase.caseId,
      sourceRevision: dataset.datasetRevision,
      generatedAt: evaluationCase.generatedAt,
      run,
      history
    }))
  );
  const evaluated = materialized.map((item) =>
    evaluateManagedCodexDetectorCase(item, dataset)
  );
  const caseResults = evaluated.map(({ result: _result, ...summary }) =>
    summary
  );
  const metrics = computeDetectorMetrics(dataset, evaluated);
  const errors = caseResults
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "DETECTOR_EXACT_MISMATCH" as const
    }));
  const deterministicOutputSha256 = sha256Canonical({
    datasetSha256: sha256Canonical(dataset),
    materializedInputSha256,
    versions: {
      schema: CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
      timeline: CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
      detector: CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
      rule: CODEX_MANAGED_SEMANTIC_RULE_VERSION,
      evidence: CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION
    },
    metrics,
    cases: caseResults
  });
  const completedAt = input?.completedAt ?? new Date();
  const status =
    errors.length === 0 && detectorReleaseGatesPass(metrics)
      ? "passed"
      : "failed";

  return {
    contract: CODEX_MANAGED_DETECTOR_RUN_RECORD_CONTRACT,
    runId: createManagedCodexDetectorRunId(),
    comparisonRunId: null,
    comparisonReason: "INITIAL_TARGETED_DEV_CANDIDATE_BASELINE",
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    latencyMs: Math.max(
      0,
      completedAt.getTime() - startedAt.getTime()
    ),
    dataset: {
      version: dataset.datasetVersion,
      revision: dataset.datasetRevision,
      class: dataset.datasetClass,
      lifecycle: dataset.lifecycle.state,
      inputBoundary: dataset.inputBoundary,
      canonicalSha256: sha256Canonical(dataset),
      materializedInputSha256,
      caseCount: dataset.cases.length
    },
    versions: {
      datasetSchemaVersion: CODEX_MANAGED_DETECTOR_CASE_SCHEMA_VERSION,
      inputHistoryContract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
      observationSchemaVersion: CODEX_APP_SERVER_EVENT_SCHEMA_VERSION,
      semanticSchemaVersion: CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
      timelineContract: CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
      detectorContract: CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
      ruleVersion: CODEX_MANAGED_SEMANTIC_RULE_VERSION,
      evidencePolicyVersion:
        CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION
    },
    detectorConfig: dataset.detectorConfig,
    code: input?.code ?? {
      commitSha: null,
      state: "unavailable",
      fingerprintSha256: null
    },
    inference: {
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    },
    metrics,
    cases: caseResults,
    deterministicOutputSha256,
    errors,
    attentionDisposition: "not_connected",
    privacyClass: "synthetic_sanitized_metadata"
  };
}

export function detectorReleaseGatesPass(
  metrics: ManagedCodexDetectorEvaluationMetrics
): boolean {
  return (
    metrics.exactCasePassCount === metrics.caseCount &&
    metrics.activeFailureFalsePositiveCount === 0 &&
    metrics.activeFailureFalseNegativeCount === 0 &&
    metrics.supersededFailureLeakageCount === 0 &&
    metrics.gapStaleStateLeakageCount === 0 &&
    metrics.systemErrorFalseFailureCount === 0 &&
    metrics.unsupportedStallOrRequestEmissionCount === 0
  );
}

function evaluateManagedCodexDetectorCase(
  item: MaterializedManagedCodexDetectorCase,
  dataset: ManagedCodexDetectorEvaluationDataset
): ManagedCodexDetectorCaseResult & {
  result: ManagedCodexSemanticRunResult;
} {
  const result = buildManagedCodexSemanticRunResult({
    sourceRevision: dataset.datasetRevision,
    generatedAt: item.evaluationCase.generatedAt,
    run: item.run,
    history: item.history
  });
  const expected = expectedDetectorSemantics(
    item.evaluationCase,
    dataset
  );
  const actual = normalizedDetectorSemantics(result);
  const expectedDetectorSha256 = sha256Canonical(expected);
  const actualDetectorSha256 = sha256Canonical(actual);
  return {
    caseId: item.evaluationCase.caseId,
    passed: expectedDetectorSha256 === actualDetectorSha256,
    expectedDetectorSha256,
    actualDetectorSha256,
    semanticResultSha256: result.resultSha256,
    activeFailureExpected: item.evaluationCase.labels.includes(
      "active_failure_positive"
    ),
    activeFailureObserved: detectorHasActiveFailure(result),
    result
  };
}

function computeDetectorMetrics(
  dataset: ManagedCodexDetectorEvaluationDataset,
  evaluated: Array<
    ManagedCodexDetectorCaseResult & {
      result: ManagedCodexSemanticRunResult;
    }
  >
): ManagedCodexDetectorEvaluationMetrics {
  const caseById = new Map(
    dataset.cases.map((item) => [item.caseId, item])
  );
  const truePositive = evaluated.filter(
    (item) => item.activeFailureExpected && item.activeFailureObserved
  ).length;
  const falsePositive = evaluated.filter(
    (item) => !item.activeFailureExpected && item.activeFailureObserved
  ).length;
  const falseNegative = evaluated.filter(
    (item) => item.activeFailureExpected && !item.activeFailureObserved
  ).length;
  const expectedPositive = evaluated.filter(
    (item) => item.activeFailureExpected
  ).length;
  const observedPositive = evaluated.filter(
    (item) => item.activeFailureObserved
  ).length;
  return {
    caseCount: evaluated.length,
    exactCasePassCount: evaluated.filter((item) => item.passed).length,
    exactCasePassRate:
      evaluated.length === 0
        ? 0
        : evaluated.filter((item) => item.passed).length /
          evaluated.length,
    activeFailureExpectedCount: expectedPositive,
    activeFailureObservedCount: observedPositive,
    activeFailureTruePositiveCount: truePositive,
    activeFailureFalsePositiveCount: falsePositive,
    activeFailureFalseNegativeCount: falseNegative,
    activeFailurePrecision:
      observedPositive === 0 ? 0 : truePositive / observedPositive,
    activeFailureRecall:
      expectedPositive === 0 ? 0 : truePositive / expectedPositive,
    supersededFailureLeakageCount: evaluated.filter((item) => {
      const fixture = caseById.get(item.caseId);
      return (
        fixture?.labels.includes("failure_superseded") === true &&
        item.activeFailureObserved
      );
    }).length,
    gapStaleStateLeakageCount: evaluated.filter((item) => {
      const fixture = caseById.get(item.caseId);
      return (
        fixture?.labels.includes("stale_state_guard") === true &&
        item.result.detector.assessment !== "observation_gap" &&
        item.result.detector.assessment !== "observation_unavailable"
      );
    }).length,
    systemErrorFalseFailureCount: evaluated.filter((item) => {
      const fixture = caseById.get(item.caseId);
      return (
        fixture?.labels.includes("system_error") === true &&
        item.activeFailureObserved
      );
    }).length,
    unsupportedStallOrRequestEmissionCount: evaluated.filter(
      (item) =>
        item.result.detector.stall !== "not_evaluable" ||
        item.result.detector.requestEscalation !== "unsupported"
    ).length
  };
}

function detectorHasActiveFailure(
  result: ManagedCodexSemanticRunResult
): boolean {
  return (
    result.detector.failureLifecycle ===
      "latest_direct_turn_failure" ||
    result.detector.failureLifecycle ===
      "latest_direct_managed_run_failure"
  );
}

export function expectedDetectorSemantics(
  evaluationCase: ManagedCodexDetectorEvaluationCase,
  dataset: ManagedCodexDetectorEvaluationDataset =
    managedCodexDetectorEvaluationDataset
) {
  return {
    ...dataset.expectedInvariantSemantics,
    ...evaluationCase.expected
  };
}

export function normalizedDetectorSemantics(
  result: ManagedCodexSemanticRunResult
) {
  return {
    contract: result.detector.contract,
    ruleVersion: result.detector.ruleVersion,
    evidencePolicyVersion: result.detector.evidencePolicyVersion,
    assessment: result.detector.assessment,
    latestTurnState: result.detector.latestTurnState,
    latestTurnEvidence: normalizedEvidence(
      result.detector.latestTurnEvidence
    ),
    failureLifecycle: result.detector.failureLifecycle,
    failureEvidence: normalizedEvidence(
      result.detector.failureEvidence
    ),
    meaningfulProgress: result.detector.meaningfulProgress,
    meaningfulProgressReason:
      result.detector.meaningfulProgressReason,
    stall: result.detector.stall,
    stallReason: result.detector.stallReason,
    requestEscalation: result.detector.requestEscalation,
    requestEscalationReason:
      result.detector.requestEscalationReason,
    attentionDisposition: result.detector.attentionDisposition,
    forbiddenAsAttentionCandidate:
      result.detector.forbiddenAsAttentionCandidate
  };
}

function normalizedEvidence(
  evidence: ManagedCodexSemanticRunResult["detector"]["latestTurnEvidence"]
) {
  if (!evidence) return null;
  const { evidenceId: _evidenceId, ...semanticEvidence } = evidence;
  return semanticEvidence;
}

export function createManagedCodexDetectorRunId(): string {
  return `detector_run_${randomBytes(16).toString("hex")}`;
}

function observationFromSpec(input: {
  spec: ManagedCodexDetectorEventSpec;
  sequence: number;
  executionId: string;
}): CodexExecutionObservation | null {
  const { spec } = input;
  if (isStreamEventSpec(spec)) {
    return null;
  }

  const semantics = observationSemantics(spec);
  return codexExecutionObservationSchema.parse({
    contract: CODEX_EXECUTION_OBSERVATION_CONTRACT,
    schemaVersion: CODEX_APP_SERVER_EVENT_SCHEMA_VERSION,
    executionId: input.executionId,
    observedAt: spec.at,
    sequence: input.sequence,
    observationMode: "managed_event_stream",
    liveObservationAvailable: true,
    inventoryActivityState: null,
    sourceUpdatedAt: null,
    ...semantics
  });
}

function observationSemantics(
  spec: Exclude<
    ManagedCodexDetectorEventSpec,
    ManagedCodexDetectorStreamEventSpec
  >
): Pick<
  CodexExecutionObservation,
  "executionState" | "waitingState" | "sourceEvent" | "reasonCode"
> {
  switch (spec.type) {
    case "turn_started":
      return {
        executionState: "running",
        waitingState: null,
        sourceEvent: "turn_started",
        reasonCode: "CODEX_MANAGED_TURN_STARTED"
      };
    case "turn_completed":
      return {
        executionState: spec.status,
        waitingState: null,
        sourceEvent: "turn_completed",
        reasonCode:
          spec.status === "completed"
            ? "CODEX_MANAGED_TURN_COMPLETED"
            : spec.status === "failed"
              ? "CODEX_MANAGED_TURN_FAILED"
              : "CODEX_MANAGED_TURN_INTERRUPTED"
      };
    case "thread_active":
      return {
        executionState: "running",
        waitingState: spec.waitingState,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_ACTIVE"
      };
    case "thread_idle":
      return {
        executionState: "idle",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_IDLE"
      };
    case "thread_not_loaded":
      return {
        executionState: "unknown",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_NOT_LOADED"
      };
    case "thread_system_error":
      return {
        executionState: "unknown",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_SYSTEM_ERROR"
      };
    case "item_started":
    case "item_completed":
      return {
        executionState: "running",
        waitingState: null,
        sourceEvent: spec.type,
        reasonCode: "CODEX_MANAGED_ITEM_ACTIVITY"
      };
  }
}

function isStreamEventSpec(
  spec: ManagedCodexDetectorEventSpec
): spec is ManagedCodexDetectorStreamEventSpec {
  return (
    spec.type === "stream_connected" ||
    spec.type === "stream_reconnected" ||
    spec.type === "stream_disconnected" ||
    spec.type === "run_failed" ||
    spec.type === "run_closed"
  );
}

export function assertMaterializedHistoryIntegrity(
  history: ManagedCodexEventHistory
): void {
  managedCodexEventHistorySchema.parse(history);
}

export const MANAGED_CODEX_DETECTOR_INPUT_CONTRACT =
  CODEX_MANAGED_EVENT_HISTORY_CONTRACT;
export const MANAGED_CODEX_DETECTOR_PUBLIC_RUN_CONTRACT =
  CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT;

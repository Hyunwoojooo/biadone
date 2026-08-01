import { z } from "zod";

import {
  CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
  CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION,
  CODEX_MANAGED_SEMANTIC_PROJECTION_CONTRACT,
  CODEX_MANAGED_SEMANTIC_RULE_VERSION,
  CODEX_MANAGED_SEMANTIC_RUN_RESULT_CONTRACT,
  CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
  CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
  CODEX_MANAGED_SEMANTIC_WINDOW_CONTRACT
} from "../crossSource/versions";
import {
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  managedCodexEventHistorySchema,
  managedCodexExecutionStateSchema,
  managedCodexItemTypeSchema,
  managedCodexNativeSourceEventSchema,
  managedCodexPublicRunProjectionSchema,
  managedCodexPublicSourceEventSchema,
  managedCodexWaitingStateSchema,
  type ManagedCodexEventHistory,
  type ManagedCodexPublicRunProjection
} from "./contracts";

export const CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT = 24;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const managedRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
const bindingIdSchema = z.string().regex(/^binding_[a-f0-9]{32}$/);
const executionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const semanticEvidenceIdSchema = z
  .string()
  .regex(/^semantic_evidence_[a-f0-9]{32}$/);
const semanticEntryIdSchema = z
  .string()
  .regex(/^semantic_entry_[a-f0-9]{32}$/);

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

const semanticEvidenceSchema = z
  .object({
    evidenceId: semanticEvidenceIdSchema,
    sequence: z.number().int().nonnegative(),
    observedAt: timestampSchema,
    sourceEvent: managedCodexPublicSourceEventSchema,
    executionState: managedCodexExecutionStateSchema.nullable(),
    waitingState: managedCodexWaitingStateSchema,
    itemType: managedCodexItemTypeSchema,
    reasonCode: directEvidenceReasonSchema
  })
  .strict();

const semanticWindowContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_SEMANTIC_WINDOW_CONTRACT),
    schemaVersion: z.literal(CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION),
    evidencePolicyVersion: z.literal(
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION
    ),
    sourceRevision: z.number().int().nonnegative(),
    generatedAt: timestampSchema,
    managedRunId: managedRunIdSchema,
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    historyCompleteness: z.enum(["complete", "prefix_pruned"]),
    continuity: z.enum(["continuous", "unverified", "gap_detected"]),
    liveObservationAvailable: z.boolean(),
    clockQuality: z.enum(["monotonic", "regressed"]),
    firstRetainedSequence: z.number().int().nonnegative().nullable(),
    lastRetainedSequence: z.number().int().nonnegative().nullable(),
    totalEvidenceCount: z.number().int().nonnegative(),
    omittedEvidenceCount: z.number().int().nonnegative(),
    evidence: z
      .array(semanticEvidenceSchema)
      .max(CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT)
  })
  .strict();

export const managedCodexSemanticWindowSchema =
  semanticWindowContentSchema
    .extend({
      inputSha256: sha256Schema,
      windowSha256: sha256Schema
    })
    .strict()
    .superRefine((window, context) => {
      if (
        window.totalEvidenceCount !==
          window.omittedEvidenceCount + window.evidence.length ||
        window.windowSha256 !== semanticWindowSha256(window)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Managed Codex semantic window is incoherent."
        });
      }
    });

export type ManagedCodexSemanticWindow = z.infer<
  typeof managedCodexSemanticWindowSchema
>;

const semanticTimelineEntrySchema = z
  .object({
    entryId: semanticEntryIdSchema,
    kind: z.enum([
      "stream_state_changed",
      "thread_state_observed",
      "turn_started",
      "turn_completed",
      "turn_failed",
      "turn_interrupted",
      "item_activity",
      "managed_run_failed",
      "managed_run_closed"
    ]),
    verification: z.literal("direct"),
    evidence: semanticEvidenceSchema
  })
  .strict();

const semanticTimelineContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT),
    schemaVersion: z.literal(CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION),
    totalEntryCount: z.number().int().nonnegative(),
    omittedEntryCount: z.number().int().nonnegative(),
    entries: z
      .array(semanticTimelineEntrySchema)
      .max(CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT)
  })
  .strict();

export const managedCodexSemanticTimelineSchema =
  semanticTimelineContentSchema
    .extend({ timelineSha256: sha256Schema })
    .strict()
    .superRefine((timeline, context) => {
      if (
        timeline.totalEntryCount !==
          timeline.omittedEntryCount + timeline.entries.length ||
        timeline.timelineSha256 !== semanticTimelineSha256(timeline)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Managed Codex semantic timeline is incoherent."
        });
      }
    });

export type ManagedCodexSemanticTimeline = z.infer<
  typeof managedCodexSemanticTimelineSchema
>;

const detectorContentSchema = z
  .object({
    contract: z.literal(
      CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT
    ),
    ruleVersion: z.literal(CODEX_MANAGED_SEMANTIC_RULE_VERSION),
    evidencePolicyVersion: z.literal(
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION
    ),
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
    latestTurnEvidence: semanticEvidenceSchema.nullable(),
    failureLifecycle: z.enum([
      "latest_direct_turn_failure",
      "latest_direct_managed_run_failure",
      "superseded_by_newer_turn",
      "not_observed_in_retained_window",
      "unknown"
    ]),
    failureEvidence: semanticEvidenceSchema.nullable(),
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

export const managedCodexSemanticDetectorResultSchema =
  detectorContentSchema
    .extend({ detectorSha256: sha256Schema })
    .strict()
    .superRefine((detector, context) => {
      if (detector.detectorSha256 !== semanticDetectorSha256(detector)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["detectorSha256"],
          message: "Managed Codex semantic detector hash does not match."
        });
      }
    });

export type ManagedCodexSemanticDetectorResult = z.infer<
  typeof managedCodexSemanticDetectorResultSchema
>;

const semanticRunResultContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_SEMANTIC_RUN_RESULT_CONTRACT),
    sourceRevision: z.number().int().nonnegative(),
    generatedAt: timestampSchema,
    managedRunId: managedRunIdSchema,
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    window: managedCodexSemanticWindowSchema,
    timeline: managedCodexSemanticTimelineSchema,
    detector: managedCodexSemanticDetectorResultSchema
  })
  .strict();

export const managedCodexSemanticRunResultSchema =
  semanticRunResultContentSchema
    .extend({ resultSha256: sha256Schema })
    .strict()
    .superRefine((result, context) => {
      if (
        result.managedRunId !== result.window.managedRunId ||
        result.bindingId !== result.window.bindingId ||
        result.executionId !== result.window.executionId ||
        result.sourceRevision !== result.window.sourceRevision ||
        result.generatedAt !== result.window.generatedAt ||
        result.resultSha256 !== semanticRunResultSha256(result)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Managed Codex semantic run result is incoherent."
        });
      }
    });

export type ManagedCodexSemanticRunResult = z.infer<
  typeof managedCodexSemanticRunResultSchema
>;

const semanticProjectionContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_SEMANTIC_PROJECTION_CONTRACT),
    schemaVersion: z.literal(CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION),
    ruleVersion: z.literal(CODEX_MANAGED_SEMANTIC_RULE_VERSION),
    evidencePolicyVersion: z.literal(
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION
    ),
    sourceRevision: z.number().int().nonnegative(),
    generatedAt: timestampSchema,
    runs: z.record(managedRunIdSchema, managedCodexSemanticRunResultSchema)
  })
  .strict();

export const managedCodexSemanticProjectionSchema =
  semanticProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      for (const [managedRunId, result] of Object.entries(
        projection.runs
      )) {
        if (
          managedRunId !== result.managedRunId ||
          projection.sourceRevision !== result.sourceRevision ||
          projection.generatedAt !== result.generatedAt
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["runs", managedRunId],
            message:
              "Managed Codex semantic projection result is incoherent."
          });
        }
      }
      if (
        projection.projectionSha256 !==
        semanticProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Managed Codex semantic projection hash does not match."
        });
      }
    });

export type ManagedCodexSemanticProjection = z.infer<
  typeof managedCodexSemanticProjectionSchema
>;

export function buildManagedCodexSemanticRunResult(input: {
  sourceRevision: number;
  generatedAt: string;
  run: ManagedCodexPublicRunProjection;
  history: ManagedCodexEventHistory;
}): ManagedCodexSemanticRunResult {
  const run = managedCodexPublicRunProjectionSchema.parse(input.run);
  const history = managedCodexEventHistorySchema.parse(input.history);
  if (history.managedRunId !== run.managedRunId) {
    throw new Error("MANAGED_CODEX_SEMANTIC_RUN_MISMATCH");
  }
  const { window, allEvidence } = buildSemanticWindow({
    sourceRevision: input.sourceRevision,
    generatedAt: timestampSchema.parse(input.generatedAt),
    run,
    history
  });
  const timeline = buildSemanticTimeline(allEvidence);
  const detector = detectSemantics(run, window, allEvidence);
  return sealRunResult({
    contract: CODEX_MANAGED_SEMANTIC_RUN_RESULT_CONTRACT,
    sourceRevision: input.sourceRevision,
    generatedAt: input.generatedAt,
    managedRunId: run.managedRunId,
    bindingId: run.bindingId,
    executionId: run.executionId,
    window,
    timeline,
    detector
  });
}

export function buildManagedCodexSemanticProjection(input: {
  sourceRevision: number;
  generatedAt: string;
  runs: Array<{
    run: ManagedCodexPublicRunProjection;
    history: ManagedCodexEventHistory;
  }>;
}): ManagedCodexSemanticProjection {
  const content = semanticProjectionContentSchema.parse({
    contract: CODEX_MANAGED_SEMANTIC_PROJECTION_CONTRACT,
    schemaVersion: CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
    ruleVersion: CODEX_MANAGED_SEMANTIC_RULE_VERSION,
    evidencePolicyVersion:
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION,
    sourceRevision: input.sourceRevision,
    generatedAt: input.generatedAt,
    runs: Object.fromEntries(
      [...input.runs]
        .sort((left, right) =>
          left.run.managedRunId.localeCompare(right.run.managedRunId)
        )
        .map(({ run, history }) => {
          const result = buildManagedCodexSemanticRunResult({
            sourceRevision: input.sourceRevision,
            generatedAt: input.generatedAt,
            run,
            history
          });
          return [result.managedRunId, result];
        })
    )
  });
  return managedCodexSemanticProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: CODEX_MANAGED_SEMANTIC_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

function buildSemanticWindow(input: {
  sourceRevision: number;
  generatedAt: string;
  run: ManagedCodexPublicRunProjection;
  history: ManagedCodexEventHistory;
}): {
  window: ManagedCodexSemanticWindow;
  allEvidence: Array<z.infer<typeof semanticEvidenceSchema>>;
} {
  const allEvidence = input.history.events.map((event) => {
    const sourceEvent = event.observation
      ? managedCodexNativeSourceEventSchema.parse(
          event.observation.sourceEvent
        )
      : event.streamKind;
    if (!sourceEvent) throw new Error("MANAGED_CODEX_EVENT_EMPTY");
    const payload = {
      sequence: event.sequence,
      observedAt: event.observedAt,
      sourceEvent,
      executionState: event.observation?.executionState ?? null,
      waitingState: event.observation?.waitingState ?? null,
      itemType: event.itemType,
      reasonCode: event.observation
        ? event.observation.reasonCode
        : streamReason(sourceEvent)
    };
    return semanticEvidenceSchema.parse({
      evidenceId: runtimeStableId(
        "semantic_evidence",
        CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION,
        { managedRunId: input.run.managedRunId, ...payload }
      ),
      ...payload
    });
  });
  const omittedEvidenceCount = Math.max(
    0,
    allEvidence.length - CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT
  );
  const common = {
    contract: CODEX_MANAGED_SEMANTIC_WINDOW_CONTRACT,
    schemaVersion: CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
    evidencePolicyVersion:
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION,
    sourceRevision: input.sourceRevision,
    generatedAt: input.generatedAt,
    managedRunId: input.run.managedRunId,
    bindingId: input.run.bindingId,
    executionId: input.run.executionId,
    historyCompleteness: input.history.anchor
      ? "prefix_pruned"
      : "complete",
    continuity: input.run.continuity,
    liveObservationAvailable: input.run.liveObservationAvailable,
    clockQuality: hasClockRegression(allEvidence)
      ? "regressed"
      : "monotonic",
    firstRetainedSequence: allEvidence[0]?.sequence ?? null,
    lastRetainedSequence: allEvidence.at(-1)?.sequence ?? null
  } as const;
  const inputSha256 = runtimeSha256({
    domain: CODEX_MANAGED_SEMANTIC_WINDOW_CONTRACT,
    input: { ...common, evidence: allEvidence }
  });
  const content = semanticWindowContentSchema.parse({
    ...common,
    totalEvidenceCount: allEvidence.length,
    omittedEvidenceCount,
    evidence: allEvidence.slice(omittedEvidenceCount)
  });
  const window = managedCodexSemanticWindowSchema.parse({
    ...content,
    inputSha256,
    windowSha256: semanticWindowSha256({
      ...content,
      inputSha256
    })
  });
  return { window, allEvidence };
}

function buildSemanticTimeline(
  evidence: Array<z.infer<typeof semanticEvidenceSchema>>
): ManagedCodexSemanticTimeline {
  const allEntries = evidence.map((item) => {
    const kind = semanticKind(item);
    return semanticTimelineEntrySchema.parse({
      entryId: runtimeStableId(
        "semantic_entry",
        CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
        { evidenceId: item.evidenceId, kind }
      ),
      kind,
      verification: "direct",
      evidence: item
    });
  });
  const omittedEntryCount = Math.max(
    0,
    allEntries.length - CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT
  );
  const content = semanticTimelineContentSchema.parse({
    contract: CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
    schemaVersion: CODEX_MANAGED_SEMANTIC_SCHEMA_VERSION,
    totalEntryCount: allEntries.length,
    omittedEntryCount,
    entries: allEntries.slice(omittedEntryCount)
  });
  return managedCodexSemanticTimelineSchema.parse({
    ...content,
    timelineSha256: runtimeSha256({
      domain: CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
      timeline: content
    })
  });
}

function detectSemantics(
  run: ManagedCodexPublicRunProjection,
  window: ManagedCodexSemanticWindow,
  evidence: Array<z.infer<typeof semanticEvidenceSchema>>
): ManagedCodexSemanticDetectorResult {
  const latestRunFailure = findLast(
    evidence,
    (item) => item.sourceEvent === "run_failed"
  );
  const latestRunClose = findLast(
    evidence,
    (item) => item.sourceEvent === "run_closed"
  );
  const latestTurnEvidence = findLast(
    evidence,
    (item) =>
      item.sourceEvent === "turn_started" ||
      item.sourceEvent === "turn_completed"
  );
  const latestFailedTurn = findLast(
    evidence,
    (item) =>
      item.sourceEvent === "turn_completed" &&
      item.executionState === "failed"
  );
  const newerTurn = latestFailedTurn
    ? evidence.find(
        (item) =>
          item.sequence > latestFailedTurn.sequence &&
          (item.sourceEvent === "turn_started" ||
            item.sourceEvent === "turn_completed")
      )
    : null;
  const latestContinuityBoundary = findLast(
    evidence,
    (item) =>
      item.sourceEvent === "stream_disconnected" ||
      item.sourceEvent === "stream_reconnected"
  );
  const terminalLifecycle = [latestRunFailure, latestRunClose]
    .filter((item): item is z.infer<typeof semanticEvidenceSchema> =>
      Boolean(item)
    )
    .sort((left, right) => right.sequence - left.sequence)[0];

  const failureLifecycle = terminalLifecycle?.sourceEvent === "run_failed"
    ? "latest_direct_managed_run_failure"
    : window.historyCompleteness === "prefix_pruned"
      ? "unknown"
    : latestFailedTurn && newerTurn
      ? "superseded_by_newer_turn"
      : latestFailedTurn &&
          latestContinuityBoundary &&
          latestContinuityBoundary.sequence > latestFailedTurn.sequence
        ? "unknown"
      : latestFailedTurn
        ? "latest_direct_turn_failure"
        : window.continuity === "gap_detected"
          ? "unknown"
          : "not_observed_in_retained_window";
  const latestTurnState = window.historyCompleteness === "prefix_pruned"
    ? "unknown"
    : latestTurnEvidence?.executionState === "running" &&
        latestContinuityBoundary &&
        latestContinuityBoundary.sequence > latestTurnEvidence.sequence
      ? "unknown"
    : latestTurnEvidence
    ? latestTurnEvidence.sourceEvent === "turn_started"
      ? "running"
      : latestTurnEvidence.executionState === "completed" ||
          latestTurnEvidence.executionState === "failed" ||
          latestTurnEvidence.executionState === "interrupted"
        ? latestTurnEvidence.executionState
        : "unknown"
      : "not_observed";
  const content = detectorContentSchema.parse({
    contract: CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
    ruleVersion: CODEX_MANAGED_SEMANTIC_RULE_VERSION,
    evidencePolicyVersion:
      CODEX_MANAGED_SEMANTIC_EVIDENCE_POLICY_VERSION,
    assessment: assessmentFor({
      run,
      evidence,
      historyCompleteness: window.historyCompleteness,
      terminalLifecycle,
      latestTurnEvidence
    }),
    latestTurnState,
    latestTurnEvidence: latestTurnEvidence ?? null,
    failureLifecycle,
    failureEvidence:
      failureLifecycle === "latest_direct_managed_run_failure"
        ? terminalLifecycle ?? null
        : latestFailedTurn ?? null,
    meaningfulProgress: "unknown",
    meaningfulProgressReason: "TASK_OUTCOME_EVIDENCE_MISSING",
    stall: "not_evaluable",
    stallReason:
      "STALL_PHASE_HEARTBEAT_OUTCOME_EVIDENCE_MISSING",
    requestEscalation: "unsupported",
    requestEscalationReason: "STABLE_REQUEST_LIFECYCLE_MISSING",
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
  return managedCodexSemanticDetectorResultSchema.parse({
    ...content,
    detectorSha256: runtimeSha256({
      domain: CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
      detector: content
    })
  });
}

function assessmentFor(input: {
  run: ManagedCodexPublicRunProjection;
  evidence: Array<z.infer<typeof semanticEvidenceSchema>>;
  historyCompleteness: ManagedCodexSemanticWindow["historyCompleteness"];
  terminalLifecycle: z.infer<typeof semanticEvidenceSchema> | undefined;
  latestTurnEvidence: z.infer<typeof semanticEvidenceSchema> | undefined;
}): z.infer<typeof detectorContentSchema>["assessment"] {
  if (input.historyCompleteness === "prefix_pruned") {
    return "insufficient_evidence";
  }
  if (input.terminalLifecycle?.sourceEvent === "run_failed") {
    return "managed_run_failed";
  }
  if (input.terminalLifecycle?.sourceEvent === "run_closed") {
    return "managed_run_closed";
  }
  if (input.run.effectiveExecutionState === "failed") return "turn_failed";
  if (input.run.effectiveExecutionState === "interrupted") {
    return "turn_interrupted";
  }
  if (input.run.effectiveExecutionState === "completed") {
    return "turn_completed";
  }
  if (input.run.effectiveExecutionState === "running") {
    return "turn_running";
  }
  if (input.run.effectiveExecutionState === "idle") return "thread_idle";
  if (
    input.run.continuity === "gap_detected" &&
    input.run.sourceEvent === "stream_reconnected"
  ) {
    return "observation_gap";
  }
  if (
    !input.run.liveObservationAvailable &&
    input.run.lifecycle !== "ended" &&
    input.run.lifecycle !== "failed"
  ) {
    return "observation_unavailable";
  }
  if (
    input.evidence.some(
      (item) =>
        item.sourceEvent === "item_started" ||
        item.sourceEvent === "item_completed"
    )
  ) {
    return "activity_observed";
  }
  return "insufficient_evidence";
}

function semanticKind(
  evidence: z.infer<typeof semanticEvidenceSchema>
): z.infer<typeof semanticTimelineEntrySchema>["kind"] {
  switch (evidence.sourceEvent) {
    case "stream_connected":
    case "stream_reconnected":
    case "stream_disconnected":
      return "stream_state_changed";
    case "thread_status_changed":
      return "thread_state_observed";
    case "turn_started":
      return "turn_started";
    case "turn_completed":
      return evidence.executionState === "failed"
        ? "turn_failed"
        : evidence.executionState === "interrupted"
          ? "turn_interrupted"
          : "turn_completed";
    case "item_started":
    case "item_completed":
      return "item_activity";
    case "run_failed":
      return "managed_run_failed";
    case "run_closed":
      return "managed_run_closed";
    case "run_started":
      throw new Error("RUN_STARTED_IS_NOT_PERSISTED_EVENT");
  }
}

function streamReason(
  sourceEvent: z.infer<typeof managedCodexPublicSourceEventSchema>
): z.infer<typeof directEvidenceReasonSchema> {
  switch (sourceEvent) {
    case "stream_connected":
      return "CODEX_MANAGED_STREAM_CONNECTED";
    case "stream_reconnected":
      return "CODEX_MANAGED_STREAM_RECONNECTED";
    case "stream_disconnected":
      return "CODEX_MANAGED_STREAM_DISCONNECTED";
    case "run_failed":
      return "CODEX_MANAGED_RUN_FAILED";
    case "run_closed":
      return "CODEX_MANAGED_RUN_CLOSED";
    default:
      throw new Error("MANAGED_CODEX_STREAM_EVENT_INVALID");
  }
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && predicate(item)) return item;
  }
  return undefined;
}

function hasClockRegression(
  evidence: Array<z.infer<typeof semanticEvidenceSchema>>
): boolean {
  return evidence.some(
    (item, index) =>
      index > 0 &&
      Date.parse(item.observedAt) <
        Date.parse(evidence[index - 1]!.observedAt)
  );
}

function semanticWindowSha256(
  window: z.infer<typeof semanticWindowContentSchema> & {
    inputSha256: string;
    windowSha256?: string;
  }
): string {
  const { windowSha256: _windowSha256, ...content } = window;
  return runtimeSha256({
    domain: CODEX_MANAGED_SEMANTIC_WINDOW_CONTRACT,
    window: content
  });
}

function semanticTimelineSha256(
  timeline: z.infer<typeof semanticTimelineContentSchema> & {
    timelineSha256?: string;
  }
): string {
  const { timelineSha256: _timelineSha256, ...content } = timeline;
  return runtimeSha256({
    domain: CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT,
    timeline: content
  });
}

function semanticDetectorSha256(
  detector: z.infer<typeof detectorContentSchema> & {
    detectorSha256?: string;
  }
): string {
  const { detectorSha256: _detectorSha256, ...content } = detector;
  return runtimeSha256({
    domain: CODEX_MANAGED_SEMANTIC_DETECTOR_RESULT_CONTRACT,
    detector: content
  });
}

function semanticRunResultSha256(
  result: z.infer<typeof semanticRunResultContentSchema> & {
    resultSha256?: string;
  }
): string {
  const { resultSha256: _resultSha256, ...content } = result;
  return runtimeSha256({
    domain: CODEX_MANAGED_SEMANTIC_RUN_RESULT_CONTRACT,
    result: content
  });
}

function semanticProjectionSha256(
  projection: z.infer<typeof semanticProjectionContentSchema> & {
    projectionSha256?: string;
  }
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: CODEX_MANAGED_SEMANTIC_PROJECTION_CONTRACT,
    projection: content
  });
}

function sealRunResult(
  contentInput: z.input<typeof semanticRunResultContentSchema>
): ManagedCodexSemanticRunResult {
  const content = semanticRunResultContentSchema.parse(contentInput);
  return managedCodexSemanticRunResultSchema.parse({
    ...content,
    resultSha256: runtimeSha256({
      domain: CODEX_MANAGED_SEMANTIC_RUN_RESULT_CONTRACT,
      result: content
    })
  });
}

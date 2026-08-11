import { z } from "zod";

import {
  rootIdSchema,
  rootSyncRevisionSchema
} from "../rootContext/contracts";
import { currentFocusReasonCodeSchema } from "../currentFocus/contracts";

export const LAUNCHER_IPC_CONTRACT =
  "blabase-launcher-ipc-v1" as const;
export const LAUNCHER_ATTENTION_CONTRACT =
  "blabase-launcher-attention-v2" as const;
export const LAUNCHER_EXECUTION_CONTRACT =
  "blabase-launcher-execution-v1" as const;
export const LAUNCHER_STATUS_CONTRACT =
  "blabase-launcher-status-v1" as const;

const requestIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/);
const resultIdSchema = z
  .string()
  .regex(/^attention_result_[a-f0-9]{32}$/);
const candidateIdSchema = z
  .string()
  .regex(/^attention_[a-f0-9]{32}$/);
const commandIdSchema = z
  .string()
  .regex(/^command_[a-f0-9]{32}$/);
const timestampSchema = z.string().datetime();

const launcherRequestEnvelopeShape = {
  contract: z.literal(LAUNCHER_IPC_CONTRACT),
  requestId: requestIdSchema
};

export const launcherAttentionGetRequestSchema = z
  .object({
    ...launcherRequestEnvelopeShape,
    method: z.literal("attention.get"),
    params: z.object({ refresh: z.boolean() }).strict()
  })
  .strict();

export const launcherAttentionExecuteRequestSchema = z
  .object({
    ...launcherRequestEnvelopeShape,
    method: z.literal("attention.execute"),
    params: z
      .object({
        resultId: resultIdSchema,
        candidateId: candidateIdSchema,
        explicitUserAction: z.literal(true)
      })
      .strict()
  })
  .strict();

export const launcherCommandGetRequestSchema = z
  .object({
    ...launcherRequestEnvelopeShape,
    method: z.literal("command.get"),
    params: z.object({ commandId: commandIdSchema }).strict()
  })
  .strict();

export const launcherStatusGetRequestSchema = z
  .object({
    ...launcherRequestEnvelopeShape,
    method: z.literal("status.get"),
    params: z.object({}).strict()
  })
  .strict();

export const launcherIpcRequestSchema = z.discriminatedUnion(
  "method",
  [
    launcherAttentionGetRequestSchema,
    launcherAttentionExecuteRequestSchema,
    launcherCommandGetRequestSchema,
    launcherStatusGetRequestSchema
  ]
);

export const launcherPrimaryActionSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("focus_or_resume"),
        enabled: z.boolean()
      })
      .strict(),
    z
      .object({
        kind: z.literal("open_github"),
        url: z.string().url()
      })
      .strict()
  ]
);

export const launcherDecisionReasonCodeSchema = z.enum([
  "DECISION_BEST_ELIGIBLE_CANDIDATE",
  "DECISION_REFRESH_REQUIRED",
  "DECISION_USER_CLARIFICATION_REQUIRED",
  "DECISION_SCOPED_NO_ACTION",
  "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
]);

export const launcherSourceDiagnosticStateSchema = z.enum([
  "available",
  "stale",
  "invalid",
  "missing",
  "rejected",
  "disconnected",
  "collection_failed",
  "unevaluated"
]);

export const launcherSourceDiagnosticReasonCodeSchema = z.enum([
  "SNAPSHOT_MISSING",
  "SNAPSHOT_PARSE_FAILED",
  "SNAPSHOT_SCHEMA_UNSUPPORTED",
  "CONNECTOR_DISCONNECTED",
  "COLLECTION_FAILED"
]);

export const launcherCandidateCountsSchema = z
  .object({
    eligible: z.number().int().nonnegative(),
    reviewRequired: z.number().int().nonnegative(),
    ineligible: z.number().int().nonnegative()
  })
  .strict();

export const launcherCurrentFocusSummarySchema = z
  .object({
    status: z.enum(["selected", "unresolved", "unavailable"]),
    displayLabel: z.string().min(1).max(240).nullable(),
    reasonCodes: z
      .array(currentFocusReasonCodeSchema)
      .min(1)
      .max(12),
    attentionSelectionEffect: z.literal("none")
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      (summary.status === "selected") !==
      (summary.displayLabel !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["displayLabel"],
        message: "Only a selected Current Focus may expose a label."
      });
    }
    if (
      new Set(summary.reasonCodes).size !== summary.reasonCodes.length ||
      summary.reasonCodes.join("|") !==
        [...summary.reasonCodes].sort().join("|")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCodes"],
        message: "Current Focus reasons must be canonical and unique."
      });
    }
  });

export const launcherRecentWorkSummarySchema = z
  .object({
    displayLabel: z.string().min(1).max(240),
    pushOccurredAt: z.string().datetime({ precision: 3 }),
    trackingState: z.enum([
      "in_sync",
      "ahead",
      "behind",
      "diverged",
      "not_configured"
    ]),
    aheadCount: z.number().int().min(0).max(100_000).nullable(),
    behindCount: z.number().int().min(0).max(100_000).nullable(),
    correlation: z.literal("repository_scope_only"),
    presentation: z.literal("display_only"),
    attentionSelectionEffect: z.literal("none"),
    executionEffect: z.literal("none")
  })
  .strict()
  .superRefine((summary, context) => {
    const countsMatchTrackingState =
      (summary.trackingState === "in_sync" &&
        summary.aheadCount === 0 &&
        summary.behindCount === 0) ||
      (summary.trackingState === "ahead" &&
        summary.aheadCount !== null &&
        summary.aheadCount > 0 &&
        summary.behindCount === 0) ||
      (summary.trackingState === "behind" &&
        summary.aheadCount === 0 &&
        summary.behindCount !== null &&
        summary.behindCount > 0) ||
      (summary.trackingState === "diverged" &&
        summary.aheadCount !== null &&
        summary.aheadCount > 0 &&
        summary.behindCount !== null &&
        summary.behindCount > 0) ||
      (summary.trackingState === "not_configured" &&
        summary.aheadCount === null &&
        summary.behindCount === null);
    if (!countsMatchTrackingState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackingState"],
        message: "Recent Work tracking counts are inconsistent."
      });
    }
  });

export const launcherSourceDiagnosticSchema = z
  .object({
    source: z.enum([
      "github",
      "codex",
      "notion",
      "google_calendar"
    ]),
    state: launcherSourceDiagnosticStateSchema,
    signalCount: z.number().int().nonnegative(),
    candidateSetComplete: z.boolean().nullable(),
    reasonCode: launcherSourceDiagnosticReasonCodeSchema.nullable()
  })
  .strict()
  .superRefine((diagnostic, context) => {
    const isCandidateSource =
      diagnostic.source === "github" || diagnostic.source === "codex";
    if (
      (isCandidateSource && diagnostic.candidateSetComplete === null) ||
      (!isCandidateSource && diagnostic.candidateSetComplete !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateSetComplete"],
        message:
          "Candidate completeness is required only for GitHub and Codex."
      });
    }

    const reasonMatchesState =
      ((diagnostic.state === "available" ||
        diagnostic.state === "stale" ||
        diagnostic.state === "invalid" ||
        diagnostic.state === "unevaluated") &&
        diagnostic.reasonCode === null) ||
      (diagnostic.state === "disconnected" &&
        diagnostic.reasonCode === "CONNECTOR_DISCONNECTED") ||
      (diagnostic.state === "missing" &&
        diagnostic.reasonCode === "SNAPSHOT_MISSING") ||
      (diagnostic.state === "rejected" &&
        (diagnostic.reasonCode === "SNAPSHOT_PARSE_FAILED" ||
          diagnostic.reasonCode ===
            "SNAPSHOT_SCHEMA_UNSUPPORTED")) ||
      (diagnostic.state === "collection_failed" &&
        diagnostic.reasonCode === "COLLECTION_FAILED");
    if (!reasonMatchesState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "Source diagnostic state and reason code must agree."
      });
    }
  });

export const launcherAttentionProjectionSchema = z
  .object({
    contract: z.literal(LAUNCHER_ATTENTION_CONTRACT),
    resultId: resultIdSchema,
    asOf: timestampSchema,
    decisionStatus: z.enum([
      "suggested",
      "needs_clarification",
      "no_action",
      "insufficient_evidence"
    ]),
    decisionReasonCodes: z
      .array(launcherDecisionReasonCodeSchema)
      .min(1)
      .max(3),
    candidateCounts: launcherCandidateCountsSchema,
    sourceDiagnostics: z.tuple([
      launcherSourceDiagnosticSchema,
      launcherSourceDiagnosticSchema,
      launcherSourceDiagnosticSchema,
      launcherSourceDiagnosticSchema
    ]),
    currentFocusSummary: launcherCurrentFocusSummarySchema
      .nullable()
      .optional()
      .default(null),
    recentWorkSummary: launcherRecentWorkSummarySchema
      .nullable()
      .optional()
      .default(null),
    card: z
      .object({
        candidateId: candidateIdSchema,
        title: z.string().min(1).max(240),
        contextLabel: z.string().min(1).max(300),
        laneLabel: z.string().min(1).max(80),
        certainty: z.enum(["confirmed", "provisional"]),
        whyNowText: z.array(z.string().min(1).max(160)).min(1).max(4),
        explanation: z.string().min(1).max(500),
        firstStep: z.string().min(1).max(300),
        dueAt: timestampSchema.nullable(),
        primaryAction: launcherPrimaryActionSchema
      })
      .strict()
      .nullable(),
    clarificationQuestion: z.string().min(1).max(300).nullable(),
    scopeStatement: z.string().min(1).max(500),
    unavailableSources: z
      .array(
        z.enum([
          "github",
          "codex",
          "notion",
          "google_calendar"
        ])
      )
      .max(4),
    dashboardPath: z.literal("/")
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      (projection.decisionStatus === "suggested") !==
      (projection.card !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["card"],
        message: "Only a suggested decision can contain a launcher card."
      });
    }
    if (
      (projection.decisionStatus === "needs_clarification") !==
      (projection.clarificationQuestion !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clarificationQuestion"],
        message:
          "A clarification question must match the clarification decision."
      });
    }
    if (
      new Set(projection.unavailableSources).size !==
      projection.unavailableSources.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unavailableSources"],
        message: "Unavailable sources must be unique."
      });
    }
    if (
      new Set(projection.decisionReasonCodes).size !==
      projection.decisionReasonCodes.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionReasonCodes"],
        message: "Decision reason codes must be unique."
      });
    }
    const reasonCodesMatchDecision = (() => {
      switch (projection.decisionStatus) {
        case "suggested":
          return (
            projection.decisionReasonCodes.length === 1 &&
            projection.decisionReasonCodes[0] ===
              "DECISION_BEST_ELIGIBLE_CANDIDATE"
          );
        case "needs_clarification":
          return (
            projection.decisionReasonCodes.length === 1 &&
            projection.decisionReasonCodes[0] ===
              "DECISION_USER_CLARIFICATION_REQUIRED"
          );
        case "no_action":
          return (
            projection.decisionReasonCodes.length === 1 &&
            projection.decisionReasonCodes[0] ===
              "DECISION_SCOPED_NO_ACTION"
          );
        case "insufficient_evidence":
          return projection.decisionReasonCodes.every(
            (reasonCode) =>
              reasonCode === "DECISION_REFRESH_REQUIRED" ||
              reasonCode ===
                "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
          );
      }
    })();
    if (!reasonCodesMatchDecision) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionReasonCodes"],
        message: "Decision reason codes must match decision status."
      });
    }
    if (
      (projection.decisionStatus === "suggested") !==
      (projection.candidateCounts.eligible > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateCounts", "eligible"],
        message:
          "A suggested decision requires at least one eligible candidate, and other decisions cannot claim one."
      });
    }
    const canonicalSources = [
      "github",
      "codex",
      "notion",
      "google_calendar"
    ] as const;
    if (
      projection.sourceDiagnostics.some(
        (diagnostic, index) =>
          diagnostic.source !== canonicalSources[index]
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceDiagnostics"],
        message:
          "Source diagnostics must contain GitHub, Codex, Notion, and Google Calendar in canonical order."
      });
    }
  });

export const launcherExecutionProjectionSchema = z
  .object({
    contract: z.literal(LAUNCHER_EXECUTION_CONTRACT),
    kind: z.literal("focus_or_resume"),
    commandId: commandIdSchema,
    status: z.enum([
      "pending",
      "claimed",
      "completed",
      "failed",
      "expired"
    ])
  })
  .strict();

export const launcherStatusProjectionSchema = z
  .object({
    contract: z.literal(LAUNCHER_STATUS_CONTRACT),
    rootId: rootIdSchema.nullable(),
    sourceMode: z.enum(["managed", "read_only"]),
    mutationAuthority: z.enum(["launcher_agent", "none"]),
    syncRevision: rootSyncRevisionSchema.nullable()
  })
  .strict()
  .superRefine((status, context) => {
    const expectedAuthority =
      status.sourceMode === "managed" ? "launcher_agent" : "none";
    if (status.mutationAuthority !== expectedAuthority) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mutationAuthority"],
        message: "Mutation authority must match launcher source mode."
      });
    }
    if (status.sourceMode === "managed" && status.rootId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rootId"],
        message: "Managed launcher status requires a root identity."
      });
    }
  });

export const launcherIpcErrorSchema = z
  .object({
    code: z.string().min(1).max(120).regex(/^[A-Z0-9_]+$/),
    message: z.string().min(1).max(500)
  })
  .strict();

export const launcherIpcSuccessResponseSchema = z
  .object({
    contract: z.literal(LAUNCHER_IPC_CONTRACT),
    requestId: requestIdSchema,
    ok: z.literal(true),
    result: z.union([
      launcherAttentionProjectionSchema,
      launcherExecutionProjectionSchema,
      launcherStatusProjectionSchema
    ])
  })
  .strict();

export const launcherIpcErrorResponseSchema = z
  .object({
    contract: z.literal(LAUNCHER_IPC_CONTRACT),
    requestId: requestIdSchema.nullable(),
    ok: z.literal(false),
    error: launcherIpcErrorSchema
  })
  .strict();

export const launcherIpcResponseSchema = z.union([
  launcherIpcSuccessResponseSchema,
  launcherIpcErrorResponseSchema
]);

export type LauncherIpcRequest = z.infer<
  typeof launcherIpcRequestSchema
>;
export type LauncherAttentionGetRequest = z.infer<
  typeof launcherAttentionGetRequestSchema
>;
export type LauncherAttentionExecuteRequest = z.infer<
  typeof launcherAttentionExecuteRequestSchema
>;
export type LauncherCommandGetRequest = z.infer<
  typeof launcherCommandGetRequestSchema
>;
export type LauncherStatusGetRequest = z.infer<
  typeof launcherStatusGetRequestSchema
>;
export type LauncherPrimaryAction = z.infer<
  typeof launcherPrimaryActionSchema
>;
export type LauncherDecisionReasonCode = z.infer<
  typeof launcherDecisionReasonCodeSchema
>;
export type LauncherSourceDiagnosticState = z.infer<
  typeof launcherSourceDiagnosticStateSchema
>;
export type LauncherSourceDiagnosticReasonCode = z.infer<
  typeof launcherSourceDiagnosticReasonCodeSchema
>;
export type LauncherCandidateCounts = z.infer<
  typeof launcherCandidateCountsSchema
>;
export type LauncherCurrentFocusSummary = z.infer<
  typeof launcherCurrentFocusSummarySchema
>;
export type LauncherRecentWorkSummary = z.infer<
  typeof launcherRecentWorkSummarySchema
>;
export type LauncherSourceDiagnostic = z.infer<
  typeof launcherSourceDiagnosticSchema
>;
export type LauncherAttentionProjection = z.infer<
  typeof launcherAttentionProjectionSchema
>;
export type LauncherExecutionProjection = z.infer<
  typeof launcherExecutionProjectionSchema
>;
export type LauncherStatusProjection = z.infer<
  typeof launcherStatusProjectionSchema
>;
export type LauncherIpcResponse = z.infer<
  typeof launcherIpcResponseSchema
>;

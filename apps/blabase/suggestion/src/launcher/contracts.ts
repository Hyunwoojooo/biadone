import { z } from "zod";

export const LAUNCHER_IPC_CONTRACT =
  "blabase-launcher-ipc-v1" as const;
export const LAUNCHER_ATTENTION_CONTRACT =
  "blabase-launcher-attention-v1" as const;
export const LAUNCHER_EXECUTION_CONTRACT =
  "blabase-launcher-execution-v1" as const;

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

export const launcherIpcRequestSchema = z.discriminatedUnion(
  "method",
  [
    launcherAttentionGetRequestSchema,
    launcherAttentionExecuteRequestSchema,
    launcherCommandGetRequestSchema
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
      launcherExecutionProjectionSchema
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
export type LauncherPrimaryAction = z.infer<
  typeof launcherPrimaryActionSchema
>;
export type LauncherAttentionProjection = z.infer<
  typeof launcherAttentionProjectionSchema
>;
export type LauncherExecutionProjection = z.infer<
  typeof launcherExecutionProjectionSchema
>;
export type LauncherIpcResponse = z.infer<
  typeof launcherIpcResponseSchema
>;

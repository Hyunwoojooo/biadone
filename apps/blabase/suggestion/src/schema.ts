import { z } from "zod";

const taskOwnerSchema = z.enum(["user", "agent", "shared", "unknown"]);
const taskStateSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "waiting",
  "completed",
  "cancelled",
  "replaced",
  "unclear"
]);
const actionableTaskStateSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "waiting",
  "unclear"
]);
const terminalTaskStateSchema = z.enum([
  "completed",
  "cancelled",
  "replaced"
]);
const taskOriginSchema = z.enum([
  "user_commitment",
  "user_request",
  "accepted_next_step",
  "unresolved_blocker",
  "decision_required"
]);

export const suggestionRequestSchema = z
  .object({
    shareUrls: z.array(z.string().trim().min(1)).min(3).max(10),
    sameUserConfirmed: z.literal(true)
  })
  .strict();

export const rawTaskCandidateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    target: z.string().trim().min(1).max(160),
    deliverable: z.string().trim().min(1).max(300),
    owner: taskOwnerSchema,
    state: taskStateSchema,
    origin: taskOriginSchema,
    deadlineKind: z.enum(["none", "absolute", "relative"]),
    deadlineText: z.string().max(160),
    consequence: z.enum([
      "none",
      "explicit_high",
      "explicit_critical"
    ]),
    evidence: z
      .array(
        z
          .object({
            kind: z.enum([
              "task",
              "proposal",
              "acceptance",
              "state",
              "deadline",
              "blocking",
              "consequence"
            ]),
            messageIndex: z.number().int().positive(),
            quote: z.string().min(1).max(500)
          })
          .strict()
      )
      .min(1)
      .max(8)
  })
  .strict();

const rawActionableTaskCandidateSchema = rawTaskCandidateSchema.extend({
  state: actionableTaskStateSchema
});

const rawTaskStateSignalSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    target: z.string().trim().min(1).max(160),
    deliverable: z.string().trim().min(1).max(300),
    state: terminalTaskStateSchema,
    evidence: z
      .array(
        z
          .object({
            kind: z.enum([
              "task",
              "proposal",
              "acceptance",
              "state",
              "deadline",
              "blocking",
              "consequence"
            ]),
            messageIndex: z.number().int().positive(),
            quote: z.string().min(1).max(500)
          })
          .strict()
      )
      .min(1)
      .max(8)
  })
  .strict()
  .superRefine((signal, context) => {
    if (!signal.evidence.some((evidence) => evidence.kind === "state")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "A terminal state signal requires state evidence."
      });
    }
  });

export const rawTaskOutputSchema = z
  .object({
    candidates: z.array(rawActionableTaskCandidateSchema).max(30),
    stateSignals: z.array(rawTaskStateSignalSchema).max(30)
  })
  .strict();

export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;

const TASK_OUTPUT_ITEM_REQUIRED = [
  "title",
  "target",
  "deliverable",
  "owner",
  "state",
  "origin",
  "deadlineKind",
  "deadlineText",
  "consequence",
  "evidence"
] as const;

const TASK_STATE_SIGNAL_REQUIRED = [
  "title",
  "target",
  "deliverable",
  "state",
  "evidence"
] as const;

const TASK_OUTPUT_ITEM_PROPERTIES = {
  title: { type: "string" },
  target: { type: "string" },
  deliverable: { type: "string" },
  owner: {
    type: "string",
    enum: ["user", "agent", "shared", "unknown"]
  },
  origin: {
    type: "string",
    enum: [
      "user_commitment",
      "user_request",
      "accepted_next_step",
      "unresolved_blocker",
      "decision_required"
    ]
  },
  deadlineKind: {
    type: "string",
    enum: ["none", "absolute", "relative"]
  },
  deadlineText: { type: "string" },
  consequence: {
    type: "string",
    enum: ["none", "explicit_high", "explicit_critical"]
  },
  evidence: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "messageIndex", "quote"],
      properties: {
        kind: {
          type: "string",
          enum: [
            "task",
            "proposal",
            "acceptance",
            "state",
            "deadline",
            "blocking",
            "consequence"
          ]
        },
        messageIndex: { type: "integer" },
        quote: { type: "string" }
      }
    }
  }
} as const;

export const TASK_CANDIDATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "stateSignals"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: TASK_OUTPUT_ITEM_REQUIRED,
        properties: {
          ...TASK_OUTPUT_ITEM_PROPERTIES,
          state: {
            type: "string",
            enum: [
              "open",
              "in_progress",
              "blocked",
              "waiting",
              "unclear"
            ]
          }
        }
      }
    },
    stateSignals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: TASK_STATE_SIGNAL_REQUIRED,
        properties: {
          title: TASK_OUTPUT_ITEM_PROPERTIES.title,
          target: TASK_OUTPUT_ITEM_PROPERTIES.target,
          deliverable: TASK_OUTPUT_ITEM_PROPERTIES.deliverable,
          state: {
            type: "string",
            enum: ["completed", "cancelled", "replaced"]
          },
          evidence: TASK_OUTPUT_ITEM_PROPERTIES.evidence
        }
      }
    }
  }
} as const;

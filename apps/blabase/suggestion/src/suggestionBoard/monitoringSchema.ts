import { z } from "zod";

import { workSuggestionBoardPublicSchema } from "./contracts";

export const workBoardFallbackReasonCodeSchema = z.enum([
  "CONTINUATION_PREREQUISITES_UNAVAILABLE",
  "CONTINUATION_IDENTITY_REJECTED",
  "CONTINUATION_DERIVATION_REJECTED",
  "CONTINUATION_RESOLUTION_REJECTED",
  "BOARD_COMPOSITION_REJECTED",
  "BOARD_PUBLIC_PROJECTION_REJECTED"
]);

export const workBoardReadyResponseSchema = z
  .object({
    status: z.literal("ready"),
    mode: z.enum(["full", "active_only_fallback"]),
    reasonCode: workBoardFallbackReasonCodeSchema.nullable(),
    board: workSuggestionBoardPublicSchema
  })
  .strict()
  .superRefine((response, context) => {
    if (
      (response.mode === "full" && response.reasonCode !== null) ||
      (response.mode === "active_only_fallback" &&
        response.reasonCode === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "Work Board projection mode and fallback reason must agree"
      });
    }
  });

export const workBoardUnavailableResponseSchema = z
  .object({
    status: z.enum(["unavailable", "error"]),
    code: z.enum([
      "WORK_BOARD_SHADOW_DISABLED",
      "WORK_BOARD_LOCAL_ONLY",
      "WORK_BOARD_PROJECTION_KEY_UNAVAILABLE",
      "WORK_BOARD_PREVIEW_FAILED"
    ]),
    message: z.string().min(1).max(160)
  })
  .strict();

export const workBoardApiResponseSchema = z.union([
  workBoardReadyResponseSchema,
  workBoardUnavailableResponseSchema
]);

export type WorkBoardFallbackReasonCode = z.infer<
  typeof workBoardFallbackReasonCodeSchema
>;
export type WorkBoardReadyResponse = z.infer<
  typeof workBoardReadyResponseSchema
>;
export type WorkBoardApiResponse = z.infer<
  typeof workBoardApiResponseSchema
>;

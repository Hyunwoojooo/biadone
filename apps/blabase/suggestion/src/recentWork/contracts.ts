import { z } from "zod";

import { runtimeSha256 } from "../crossSource/canonicalHash";

export const RECENT_WORK_PROJECTION_CONTRACT =
  "recent-work-projection-v0.2" as const;
export const RECENT_WORK_SCHEMA_VERSION =
  "recent-work-schema-v0.2" as const;
export const RECENT_WORK_RESOLVER_VERSION =
  "repository-scope-recent-work-resolver-v0.2" as const;
export const RECENT_WORK_FOCUS_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const RECENT_WORK_LOCAL_GIT_MAX_AGE_MS = 5 * 60 * 1_000;
export const RECENT_WORK_MAX_FUTURE_SKEW_MS = 60 * 1_000;

const timestampSchema = z.string().datetime();
const publicTimestampSchema = z.string().datetime({ precision: 3 });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const projectIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/u);
const trackingStateSchema = z.enum([
  "in_sync",
  "ahead",
  "behind",
  "diverged",
  "not_configured"
]);
const trackingCountSchema = z.number().int().min(0).max(100_000);

export const recentWorkReasonCodeSchema = z.enum([
  "RECENT_WORK_MATCHED",
  "RECENT_WORK_PUSH_ACTIVITY_MATCHED",
  "RECENT_WORK_FOCUS_UNAVAILABLE",
  "RECENT_WORK_FOCUS_NOT_GITHUB_PUSH",
  "RECENT_WORK_FOCUS_NOT_CURRENT",
  "RECENT_WORK_FOCUS_STALE",
  "RECENT_WORK_FOCUS_REPOSITORY_UNAVAILABLE",
  "RECENT_WORK_FOCUS_REPOSITORY_CONFLICT",
  "RECENT_WORK_LINK_UNAVAILABLE",
  "RECENT_WORK_LINK_CONFLICT",
  "RECENT_WORK_LINK_TIE",
  "RECENT_WORK_LOCAL_GIT_UNAVAILABLE",
  "RECENT_WORK_LOCAL_GIT_STALE",
  "RECENT_WORK_LOCAL_GIT_CONFLICT",
  "RECENT_WORK_LOCAL_GIT_UNBORN",
  "RECENT_WORK_DEPENDENCY_MISMATCH"
]);

const confirmedRecentWorkMatchSchema = z
  .object({
    matchKind: z.literal("confirmed_focus"),
    linkId: z
      .string()
      .regex(/^repository_scope_link_[a-f0-9]{32}$/u),
    projectId: projectIdSchema,
    displayLabel: z.string().min(1).max(240),
    pushOccurredAt: timestampSchema,
    trackingState: trackingStateSchema,
    aheadCount: trackingCountSchema.nullable(),
    behindCount: trackingCountSchema.nullable(),
    correlation: z.literal("repository_scope_only"),
    currentFocusProjectionSha256: sha256Schema,
    focusEventSha256: sha256Schema,
    registrySha256: sha256Schema,
    localGitSnapshotSha256: sha256Schema
  })
  .strict()
  .superRefine((match, context) => {
  const countsMatchTrackingState =
    (match.trackingState === "in_sync" &&
      match.aheadCount === 0 &&
      match.behindCount === 0) ||
    (match.trackingState === "ahead" &&
      match.aheadCount !== null &&
      match.aheadCount > 0 &&
      match.behindCount === 0) ||
    (match.trackingState === "behind" &&
      match.aheadCount === 0 &&
      match.behindCount !== null &&
      match.behindCount > 0) ||
    (match.trackingState === "diverged" &&
      match.aheadCount !== null &&
      match.aheadCount > 0 &&
      match.behindCount !== null &&
      match.behindCount > 0) ||
    (match.trackingState === "not_configured" &&
      match.aheadCount === null &&
      match.behindCount === null);
  if (!countsMatchTrackingState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackingState"],
        message: "Recent Work tracking counts are inconsistent."
      });
    }
  });

const verifiedPushActivityMatchSchema = z
  .object({
    matchKind: z.literal("verified_push_activity"),
    displayLabel: z.string().min(1).max(240),
    pushOccurredAt: timestampSchema,
    trackingState: z.literal("not_configured"),
    aheadCount: z.null(),
    behindCount: z.null(),
    correlation: z.literal("repository_scope_only"),
    githubBatchSha256: sha256Schema,
    activitySignalSha256: sha256Schema
  })
  .strict();

export const recentWorkMatchSchema = z.union([
  confirmedRecentWorkMatchSchema,
  verifiedPushActivityMatchSchema
]);

const recentWorkProjectionContentSchema = z
  .object({
    contract: z.literal(RECENT_WORK_PROJECTION_CONTRACT),
    schemaVersion: z.literal(RECENT_WORK_SCHEMA_VERSION),
    resolverVersion: z.literal(RECENT_WORK_RESOLVER_VERSION),
    asOf: timestampSchema,
    inputSha256: sha256Schema,
    status: z.enum(["matched", "unavailable"]),
    reasonCodes: z.array(recentWorkReasonCodeSchema).min(1).max(8),
    match: recentWorkMatchSchema.nullable(),
    presentationDisposition: z.literal("sidecar_only"),
    correlationBasis: z.literal("repository_scope_only"),
    attentionSelectionEffect: z.literal("none"),
    candidateEligibilityEffect: z.literal("none"),
    rankingEffect: z.literal("none"),
    executionEffect: z.literal("none")
  })
  .strict();

export const recentWorkProjectionSchema = recentWorkProjectionContentSchema
  .extend({ projectionSha256: sha256Schema })
  .strict()
  .superRefine((projection, context) => {
    if (
      projection.projectionSha256 !==
      recentWorkProjectionSha256(projection)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionSha256"],
        message: "Recent Work projection hash is invalid."
      });
    }
    if (
      (projection.status === "matched") !==
      (projection.match !== null) ||
      (projection.status === "matched" &&
        !projection.reasonCodes.includes("RECENT_WORK_MATCHED") &&
        !projection.reasonCodes.includes(
          "RECENT_WORK_PUSH_ACTIVITY_MATCHED"
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["match"],
        message: "Recent Work match state is inconsistent."
      });
    }
    if (
      new Set(projection.reasonCodes).size !== projection.reasonCodes.length ||
      projection.reasonCodes.some(
        (reason, index) =>
          index > 0 && projection.reasonCodes[index - 1]! > reason
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCodes"],
        message: "Recent Work reasons must be canonical and unique."
      });
    }
  });

export const recentWorkPublicSummarySchema = z
  .object({
    displayLabel: z.string().min(1).max(240),
    pushOccurredAt: publicTimestampSchema,
    trackingState: trackingStateSchema,
    aheadCount: trackingCountSchema.nullable(),
    behindCount: trackingCountSchema.nullable(),
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
        message: "Recent Work public tracking counts are inconsistent."
      });
    }
  });

export type RecentWorkReasonCode = z.infer<
  typeof recentWorkReasonCodeSchema
>;
export type RecentWorkProjection = z.infer<
  typeof recentWorkProjectionSchema
>;
export type RecentWorkProjectionContent = z.infer<
  typeof recentWorkProjectionContentSchema
>;
export type RecentWorkPublicSummary = z.infer<
  typeof recentWorkPublicSummarySchema
>;

export function sealRecentWorkProjection(
  content: RecentWorkProjectionContent
): RecentWorkProjection {
  return recentWorkProjectionSchema.parse({
    ...content,
    projectionSha256: recentWorkProjectionSha256(content)
  });
}

export function recentWorkProjectionSha256(
  projection: RecentWorkProjection | RecentWorkProjectionContent
): string {
  const { projectionSha256: _projectionSha256, ...content } =
    projection as RecentWorkProjection;
  return runtimeSha256({
    domain: "recent-work-projection-v0.2",
    projection: content
  });
}

export function createUnavailableRecentWorkProjection(input: {
  asOf: string;
  reasonCode: Exclude<
    RecentWorkReasonCode,
    "RECENT_WORK_MATCHED" | "RECENT_WORK_PUSH_ACTIVITY_MATCHED"
  >;
  inputSha256?: string;
}): RecentWorkProjection {
  return sealRecentWorkProjection({
    contract: RECENT_WORK_PROJECTION_CONTRACT,
    schemaVersion: RECENT_WORK_SCHEMA_VERSION,
    resolverVersion: RECENT_WORK_RESOLVER_VERSION,
    asOf: input.asOf,
    inputSha256:
      input.inputSha256 ??
      runtimeSha256({
        domain: "recent-work-unavailable-input-v0.2",
        asOf: input.asOf,
        reasonCode: input.reasonCode
      }),
    status: "unavailable",
    reasonCodes: [input.reasonCode],
    match: null,
    presentationDisposition: "sidecar_only",
    correlationBasis: "repository_scope_only",
    attentionSelectionEffect: "none",
    candidateEligibilityEffect: "none",
    rankingEffect: "none",
    executionEffect: "none"
  });
}

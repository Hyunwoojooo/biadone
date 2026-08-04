import { z } from "zod";

import type {
  GitHubActionabilityCoverage,
  GitHubPullRequestActionabilitySignal,
  GitHubTaskSignal
} from "./types";

export const githubPullRequestChecksSummarySchema = z
  .object({
    collectionState: z.enum(["complete", "partial"]),
    state: z.enum(["passing", "failing", "pending", "none", "unknown"]),
    totalCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    truncated: z.boolean()
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      summary.completedCount + summary.pendingCount > summary.totalCount ||
      summary.failedCount > summary.completedCount ||
      (summary.state === "failing") !== (summary.failedCount > 0) ||
      (summary.collectionState === "complete" && summary.truncated) ||
      (summary.state === "none" && summary.totalCount !== 0) ||
      (summary.state === "passing" &&
        (summary.collectionState !== "complete" ||
          summary.totalCount === 0 ||
          summary.pendingCount > 0))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GitHub check summary counts and state must agree."
      });
    }
  });

export const githubPullRequestActionabilitySchema: z.ZodType<GitHubPullRequestActionabilitySignal> =
  z
    .object({
      collectionState: z.enum(["complete", "partial"]),
      draft: z.boolean(),
      reviewDecision: z.enum([
        "changes_requested",
        "review_requested",
        "approved",
        "none",
        "unknown"
      ]),
      checksSummary: githubPullRequestChecksSummarySchema.nullable(),
      mergeable: z.boolean().nullable(),
      mergeConflict: z.boolean().nullable(),
      unresolvedChangeRequestCount: z.number().int().nonnegative().nullable(),
      requestedReviewerCount: z.number().int().nonnegative(),
      actionRequired: z.boolean(),
      actionRequiredReasons: z.array(
        z.enum(["checks_failed", "changes_requested", "merge_conflict"])
      ).max(3)
    })
    .strict()
    .superRefine((actionability, context) => {
      const reasons = new Set<string>(actionability.actionRequiredReasons);
      const expected = new Set<string>();
      if ((actionability.checksSummary?.failedCount ?? 0) > 0) {
        expected.add("checks_failed");
      }
      if ((actionability.unresolvedChangeRequestCount ?? 0) > 0) {
        expected.add("changes_requested");
      }
      if (actionability.mergeConflict === true) {
        expected.add("merge_conflict");
      }
      const collectionComplete =
        actionability.checksSummary !== null &&
        actionability.checksSummary.collectionState === "complete" &&
        !actionability.checksSummary.truncated &&
        actionability.unresolvedChangeRequestCount !== null &&
        actionability.mergeConflict !== null;
      if (
        reasons.size !== actionability.actionRequiredReasons.length ||
        [...expected].some((reason) => !reasons.has(reason)) ||
        [...reasons].some((reason) => !expected.has(reason)) ||
        actionability.actionRequired !== (reasons.size > 0) ||
        (actionability.reviewDecision === "changes_requested") !==
          reasons.has("changes_requested") ||
        (actionability.collectionState === "complete") !==
          collectionComplete ||
        (actionability.mergeable === true &&
          actionability.mergeConflict !== false)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GitHub PR actionability facts must agree."
        });
      }
    });

export const githubActionabilityCoverageSchema: z.ZodType<GitHubActionabilityCoverage> =
  z
    .object({
      state: z.enum(["complete", "partial", "unavailable"]),
      authoredPullRequestCount: z.number().int().nonnegative(),
      attemptedCount: z.number().int().nonnegative(),
      collectedCount: z.number().int().nonnegative(),
      truncated: z.boolean()
    })
    .strict()
    .superRefine((coverage, context) => {
      const completeByCount =
        coverage.collectedCount === coverage.authoredPullRequestCount &&
        !coverage.truncated;
      if (
        coverage.attemptedCount > coverage.authoredPullRequestCount ||
        coverage.collectedCount > coverage.attemptedCount ||
        coverage.truncated !==
          (coverage.attemptedCount < coverage.authoredPullRequestCount) ||
        (coverage.state === "complete" && !completeByCount) ||
        (coverage.state === "unavailable" &&
          (coverage.authoredPullRequestCount === 0 ||
            coverage.collectedCount !== 0)) ||
        (coverage.authoredPullRequestCount === 0 &&
          coverage.state !== "complete")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GitHub actionability coverage counts and state must agree."
        });
      }
    });

export function actionabilityCoverageMatchesTasks(
  coverage: GitHubActionabilityCoverage,
  tasks: Array<
    Pick<GitHubTaskSignal, "kind" | "actionability">
  >
): boolean {
  const authored = tasks.filter(
    (task) => task.kind === "authored_pull_request"
  );
  const collected = authored.filter(
    (task) => task.actionability !== undefined
  );
  const expectedState =
    authored.length === 0 ||
    (collected.length === authored.length &&
      collected.every(
        (task) => task.actionability?.collectionState === "complete"
      ))
      ? "complete"
      : collected.length === 0
        ? "unavailable"
        : "partial";
  return (
    coverage.authoredPullRequestCount === authored.length &&
    coverage.collectedCount === collected.length &&
    coverage.state === expectedState
  );
}

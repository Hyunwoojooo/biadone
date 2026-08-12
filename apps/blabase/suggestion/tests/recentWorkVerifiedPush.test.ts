import { describe, expect, it } from "vitest";

import {
  projectRecentWorkPublicSummary,
  resolveRecentWork
} from "../src/recentWork";

const AS_OF = "2026-08-11T03:00:00.000Z";
const PUSH_AT = "2026-08-11T02:58:30.000Z";

function verifiedPushInput() {
  return {
    asOf: AS_OF,
    currentFocus: {
      status: "unresolved",
      projectionSha256: "e".repeat(64)
    },
    githubBatch: {
      batchSha256: "9".repeat(64),
      signals: [
        {
          kind: "activity_observation",
          signalId: `signal_${"4".repeat(32)}`,
          signalHash: "4".repeat(64),
          sourceScopeId: "repository:101",
          sourceUpdatedAt: PUSH_AT,
          completeness: "complete",
          facts: { activityKind: "push" }
        }
      ]
    },
    confirmedLinks: {
      status: "conflict",
      registrySha256: "a".repeat(64),
      links: []
    },
    localGitSnapshot: null
  } as unknown as Parameters<typeof resolveRecentWork>[0];
}

describe("Recent Work verified push fallback", () => {
  it("shows a fresh complete push when Focus abstains", () => {
    const result = resolveRecentWork(verifiedPushInput());

    expect(result).toMatchObject({
      status: "matched",
      reasonCodes: ["RECENT_WORK_PUSH_ACTIVITY_MATCHED"],
      match: {
        matchKind: "verified_push_activity",
        displayLabel: "최근 GitHub push · 작업 공간 선택 필요",
        pushOccurredAt: PUSH_AT,
        trackingState: "not_configured",
        aheadCount: null,
        behindCount: null
      },
      attentionSelectionEffect: "none",
      candidateEligibilityEffect: "none",
      rankingEffect: "none",
      executionEffect: "none"
    });
    expect(projectRecentWorkPublicSummary(result, "shadow")).toBeNull();
    expect(projectRecentWorkPublicSummary(result, "present")).toMatchObject({
      displayLabel: "최근 GitHub push · 작업 공간 선택 필요",
      trackingState: "not_configured",
      attentionSelectionEffect: "none",
      executionEffect: "none"
    });
    expect(
      JSON.stringify(projectRecentWorkPublicSummary(result, "present"))
    ).not.toContain("repository:101");
  });

  it("rejects partial or stale individual push evidence", () => {
    const partial = verifiedPushInput();
    partial.githubBatch!.signals[0]!.completeness = "unknown";
    expect(resolveRecentWork(partial).status).toBe("unavailable");

    const stale = verifiedPushInput();
    stale.githubBatch!.signals[0]!.sourceUpdatedAt =
      "2026-08-09T02:58:30.000Z";
    expect(resolveRecentWork(stale).status).toBe("unavailable");
  });
});

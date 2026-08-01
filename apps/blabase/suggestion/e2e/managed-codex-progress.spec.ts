import { expect, test } from "@playwright/test";

import type {
  ManagedCodexPublicRun,
  ManagedCodexRunsReadyResponse
} from "../app/managedCodexRunsClient";

const OBSERVED_AT = "2026-08-01T03:00:00.000Z";

test("shows managed progress without refreshing the Attention decision", async ({
  page
}) => {
  let managedReads = 0;
  let attentionReads = 0;
  let runOverride: Partial<ManagedCodexPublicRun> = {};

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/attention") {
      attentionReads += 1;
    }
  });
  await page.route("**/api/managed-codex-runs", async (route) => {
    managedReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projection(runOverride))
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(
    progress.getByRole("heading", { name: "Codex 실시간 진행" })
  ).toBeVisible();
  await expect(
    progress.getByText("관찰 전용 · 추천 우선순위에 반영하지 않음", {
      exact: true
    })
  ).toBeVisible();
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "진행 중"
  );

  await page.waitForTimeout(400);
  const attentionReadsBeforeTransition = attentionReads;
  const managedReadsBeforeTransition = managedReads;
  runOverride = {
    streamState: "disconnected",
    continuity: "unverified",
    effectiveExecutionState: "unknown",
    sourceEvent: "stream_disconnected",
    liveObservationAvailable: false
  };

  await expect
    .poll(() => managedReads)
    .toBeGreaterThan(managedReadsBeforeTransition);
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "연결 끊김 · 현재 상태 미확인"
  );
  await expect(progress.locator(".managedCodexRunMeta")).toContainText(
    "마지막 검증 상태진행 중"
  );

  const readsBeforeReconnect = managedReads;
  runOverride = {
    continuity: "gap_detected",
    effectiveExecutionState: "unknown",
    sourceEvent: "stream_reconnected"
  };
  await expect
    .poll(() => managedReads)
    .toBeGreaterThan(readsBeforeReconnect);
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "이벤트 누락 · 현재 상태 미확인"
  );

  const readsBeforeNewEvidence = managedReads;
  runOverride = {
    continuity: "gap_detected",
    effectiveExecutionState: "running",
    sourceEvent: "turn_started"
  };
  await expect
    .poll(() => managedReads)
    .toBeGreaterThan(readsBeforeNewEvidence);
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "진행 중"
  );
  await expect(progress.locator(".managedCodexRunMeta")).toContainText(
    "이벤트 누락 감지"
  );
  expect(attentionReads).toBe(attentionReadsBeforeTransition);
});

test("distinguishes an empty managed view from historical Codex context", async ({
  page
}) => {
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        contract: "codex-managed-public-projection-v1",
        revision: 0,
        generatedAt: OBSERVED_AT,
        runs: []
      } satisfies ManagedCodexRunsReadyResponse)
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(progress).toContainText(
    "현재 Blabase가 직접 관리하며 실시간으로 관찰하는 Codex run이 없습니다."
  );
  await expect(
    page.getByRole("heading", { name: "Codex 과거 작업 맥락" })
  ).toBeVisible();
});

function projection(
  override: Partial<ManagedCodexPublicRun> = {}
): ManagedCodexRunsReadyResponse {
  return {
    status: "ready",
    contract: "codex-managed-public-projection-v1",
    revision:
      override.sourceEvent === "turn_started"
        ? 4
        : override.sourceEvent === "stream_reconnected"
          ? 3
          : override.streamState === "disconnected"
            ? 2
            : 1,
    generatedAt: OBSERVED_AT,
    runs: [
      {
        managedRunId: `managed_run_${"a".repeat(32)}`,
        bindingId: `binding_${"b".repeat(32)}`,
        executionId: `codex:execution:${"c".repeat(24)}`,
        lifecycle: "observing",
        streamState: "connected",
        continuity: "continuous",
        effectiveExecutionState: "running",
        lastVerifiedExecutionState: "running",
        waitingState: null,
        sourceEvent: "item_started",
        itemType: "command_execution",
        lastObservedAt: OBSERVED_AT,
        liveObservationAvailable: true,
        forbiddenAsAttentionCandidate: true,
        ...override
      }
    ]
  };
}

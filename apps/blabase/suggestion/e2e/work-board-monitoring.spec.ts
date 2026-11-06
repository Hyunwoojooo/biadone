import { expect, test } from "@playwright/test";

import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  WORK_BOARD_MONITORING_RECEIPT_HEADER,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  createWorkBoardMonitoringReceipt
} from "../src/suggestionBoard/monitoring";
import { monitoringAuthority } from "../tests/fixtures/workBoardMonitoringFixture";

test.skip(
  process.env.BLABASE_WORK_BOARD_MONITORING_ENABLED !== "true",
  "M-001a browser test requires an explicit monitoring opt-in."
);

test("records only a committed current render and keeps receipt metadata out of the DOM", async ({
  page
}) => {
  const issuedAt = new Date();
  const authority = monitoringAuthority();
  if (authority.response.base.status !== "ready") throw new Error("fixture");
  authority.response.base.board.generatedAt = issuedAt.toISOString();
  if (authority.response.semanticPresentation !== null) {
    authority.response.semanticPresentation.baseGeneratedAt =
      issuedAt.toISOString();
  }
  for (const entry of authority.response.base.board.alternatives) {
    entry.item.expiresAt = new Date(
      issuedAt.getTime() + 60 * 60_000
    ).toISOString();
  }
  const receipt = createWorkBoardMonitoringReceipt({ authority, issuedAt });
  if (receipt === null) throw new Error("fixture receipt");
  const aggregate = emptyAggregate(issuedAt.toISOString());
  const mutations: unknown[] = [];
  const browserMessages: string[] = [];
  let releaseBoard!: () => void;
  const boardReady = new Promise<void>((resolve) => {
    releaseBoard = resolve;
  });
  page.on("console", (message) => browserMessages.push(message.text()));

  await page.route("**/api/sync/start", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncFixture())
    })
  );
  await page.route("**/api/sync/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncFixture())
    })
  );
  await page.route("**/api/attention", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        code: "E2E_ATTENTION_UNAVAILABLE",
        message: "Attention fixture unavailable"
      })
    })
  );
  await page.route("**/api/work-board", async (route) => {
    await boardReady;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        [WORK_BOARD_MONITORING_RECEIPT_HEADER]: receipt.headerValue
      },
      body: JSON.stringify(authority.response)
    });
  });
  await page.route("**/api/work-board/monitoring", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contract: WORK_BOARD_MONITORING_API_CONTRACT,
          status: "ready",
          consent: true,
          aggregate,
          history: []
        })
      });
      return;
    }
    const mutation = route.request().postDataJSON() as unknown;
    mutations.push(mutation);
    const operation = (mutation as { operation?: string }).operation;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contract: WORK_BOARD_MONITORING_API_CONTRACT,
        status: "recorded",
        operation,
        consent: true,
        aggregate
      })
    });
  });

  await page.goto("/");
  expect(mutations).toEqual([]);
  releaseBoard();
  await expect(
    page.getByRole("heading", { name: "QA 진행 상태 확인하기" })
  ).toBeVisible();
  await expect
    .poll(
      () =>
        mutations.filter(
          (value) =>
            (value as { operation?: string }).operation ===
            "render_confirmed"
        ).length
    )
    .toBeGreaterThan(0);
  const usefulButtons = page.getByRole("button", { name: "유용함" });
  await expect(usefulButtons).toHaveCount(2);
  await expect(usefulButtons.first()).toBeVisible();
  await usefulButtons.first().click();
  await expect
    .poll(() =>
      mutations.some(
        (value) =>
          (value as { operation?: string }).operation === "feedback"
      )
    )
    .toBe(true);

  const feedback = mutations.find(
    (value) => (value as { operation?: string }).operation === "feedback"
  );
  expect(feedback).toEqual({
    operation: "feedback",
    receipt: receipt.headerValue,
    ordinal: 1,
    feedback: "useful",
    reason: null,
    explicitUserAction: true
  });
  const markup = await page.locator("body").innerHTML();
  expect(markup).not.toContain("wbm1.");
  expect(markup).not.toContain("work_board_monitor_");
  expect(page.url()).not.toContain("wbm1.");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe("{}");
  expect(browserMessages.join("\n")).not.toContain("wbm1.");
  expect(browserMessages.join("\n")).not.toContain("work_board_monitor_");
});

function emptyAggregate(asOf: string) {
  return {
    contract: WORK_BOARD_MONITORING_QUALITY_CONTRACT,
    schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
    asOf,
    eventCount: 0,
    eligibleDistinct: 0,
    ratedDistinct: 0,
    usefulDistinct: 0,
    coverage: { numerator: 0, denominator: 0, value: null },
    usefulShare: { numerator: 0, denominator: 0, value: null },
    strata: [],
    reviewState: "candidate",
    appliedToRanking: false,
    goldEligible: false,
    releaseGateEligible: false
  } as const;
}

function syncFixture() {
  return {
    status: "ready",
    revision: "monitoring-e2e",
    generatedAt: new Date().toISOString(),
    sources: []
  };
}

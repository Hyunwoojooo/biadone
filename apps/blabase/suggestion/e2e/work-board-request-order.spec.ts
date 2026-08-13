import { expect, test } from "@playwright/test";

test("keeps the newest mounted Work Board when an older response finishes last", async ({
  page
}) => {
  let boardReads = 0;
  let releaseOlder!: () => void;
  let releaseInitialSync!: () => void;
  let markOlderStarted!: () => void;
  let markOlderSettled!: () => void;
  const olderResponse = new Promise<void>((resolve) => {
    releaseOlder = resolve;
  });
  const olderStarted = new Promise<void>((resolve) => {
    markOlderStarted = resolve;
  });
  const olderSettled = new Promise<void>((resolve) => {
    markOlderSettled = resolve;
  });
  const initialSyncResponse = new Promise<void>((resolve) => {
    releaseInitialSync = resolve;
  });
  let syncRevision = 0;

  await page.route("**/api/sync/start", async (route) => {
    await initialSyncResponse;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncFixture(syncRevision))
    });
  });
  await page.route("**/api/sync/status", async (route) => {
    syncRevision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncFixture(syncRevision))
    });
  });
  await page.route("**/api/attention", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        code: "E2E_ATTENTION_UNAVAILABLE",
        message: "Attention fixture unavailable"
      })
    });
  });
  await page.route("**/api/work-board", async (route) => {
    boardReads += 1;
    const currentRead = boardReads;
    if (currentRead === 2) {
      markOlderStarted();
      await olderResponse;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        boardFixture(
          currentRead === 1
            ? "초기 작업 제안"
            : currentRead === 2
              ? "오래된 작업 제안"
              : "최신 작업 제안"
        )
      )
    });
    if (currentRead === 2) markOlderSettled();
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "초기 작업 제안" })
  ).toBeVisible();

  releaseInitialSync();
  await olderStarted;
  expect(boardReads).toBe(2);
  await expect(
    page.getByRole("heading", { name: "최신 작업 제안" })
  ).toBeVisible();
  expect(boardReads).toBe(3);

  releaseOlder();
  await olderSettled;
  await expect(
    page.getByRole("heading", { name: "최신 작업 제안" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "오래된 작업 제안" })
  ).toHaveCount(0);
});

for (const failure of ["401", "non-json", "rejected"] as const) {
  test(`clears the mounted base and overlay on a current ${failure} Board failure`, async ({
    page
  }) => {
    let boardReads = 0;
    let releaseSync!: () => void;
    const syncResponse = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    await page.route("**/api/sync/start", async (route) => {
      await syncResponse;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture(1))
      });
    });
    await page.route("**/api/sync/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture(1))
      });
    });
    await page.route("**/api/attention", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "error",
          code: "E2E_ATTENTION_UNAVAILABLE",
          message: "Attention fixture unavailable"
        })
      });
    });
    await page.route("**/api/work-board", async (route) => {
      boardReads += 1;
      if (boardReads === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            boardFixture("초기 기본 제안", "QA 진행 상태 확인하기")
          )
        });
        return;
      }
      if (failure === "401") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ status: "error" })
        });
        return;
      }
      if (failure === "non-json") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html>private auth detail</html>"
        });
        return;
      }
      await route.abort("connectionrefused");
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "QA 진행 상태 확인하기" })
    ).toBeVisible();
    releaseSync();
    await expect.poll(() => boardReads).toBe(2);
    await expect(
      page.getByRole("alert").filter({
        hasText: "작업 제안을 불러오지 못했습니다."
      })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "QA 진행 상태 확인하기" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "초기 기본 제안" })
    ).toHaveCount(0);
    await expect(page.locator(".workSuggestionBoardLanes")).toHaveCount(0);
    await expect(page.getByText("private auth detail")).toHaveCount(0);
  });
}

function syncFixture(revision: number) {
  return {
    status: "ready",
    revision: `e2e:${revision}`,
    generatedAt: "2026-08-13T09:00:00.000Z",
    sources: [
      {
        source: "github",
        status: "idle",
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        nextRetryAt: null,
        retryCount: 0,
        lastErrorCode: null,
        snapshotRevision: `github:${revision}`,
        snapshotHash: null
      }
    ]
  };
}

function boardFixture(title: string, overlayTitle?: string) {
  return {
    contract: "semantic-continuation-work-board-response-v0.2",
    schemaVersion: "semantic-continuation-presentation-schema-v0.2",
    base: {
      status: "ready",
      mode: "full",
      reasonCode: null,
      board: {
        contract: "work-suggestion-board-public-v0.1",
        schemaVersion: "work-suggestion-board-schema-v0.1",
        generatedAt: "2026-08-13T09:00:00.000Z",
        prominentLane: "continuation",
        continuationStatus: "available",
        primary: {
          lane: "continuation",
          item: {
            itemRef: `item_ref_${"a".repeat(32)}`,
            workContextRef: `context_ref_${"b".repeat(32)}`,
            kind: "linked_workstream",
            title,
            summary: title,
            observedAt: "2026-08-13T08:00:00.000Z",
            expiresAt: "2099-08-14T08:00:00.000Z",
            evidenceBand: "corroborated",
            capability: "display",
            action: null,
            caveatCodes: []
          }
        },
        alternatives: [],
        executionPolicy: {
          automaticExecutionAllowed: false,
          explicitUserActionRequired: true,
          externalMutationAllowed: false
        }
      }
    },
    semanticPresentation:
      overlayTitle === undefined
        ? null
        : {
            contract: "semantic-continuation-presentation-v0.2",
            schemaVersion: "semantic-continuation-presentation-schema-v0.2",
            baseGeneratedAt: "2026-08-13T09:00:00.000Z",
            overlays: [
              {
                itemRef: `item_ref_${"a".repeat(32)}`,
                displayTitle: overlayTitle
              }
            ]
          }
  };
}

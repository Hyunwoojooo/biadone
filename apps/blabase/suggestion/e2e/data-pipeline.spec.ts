import { expect, test, type Page, type Route } from "@playwright/test";

test.describe.serial("Phase 2A.1 browser data pipeline", () => {
  test("recovers polling and propagates the stored revision into Work Cockpit and Lab", async ({
    page: todayPage,
    context
  }) => {
    let todayAttentionReads = 0;
    trackAttentionReads(todayPage, () => {
      todayAttentionReads += 1;
    });
    const releaseTodaySyncStatus = await holdFirstSyncStatus(todayPage);

    await todayPage.goto("/");
    await expect(
      todayPage.getByRole("heading", { name: "오늘의 Work Cockpit" })
    ).toBeVisible();
    await expect
      .poll(() => todayAttentionReads, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(1);
    const todayReadsBeforeRevision = todayAttentionReads;
    await releaseTodaySyncStatus();
    await expect
      .poll(() => todayAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(todayReadsBeforeRevision);

    const labPage = await context.newPage();
    let labAttentionReads = 0;
    trackAttentionReads(labPage, () => {
      labAttentionReads += 1;
    });
    const releaseLabSyncStatus = await holdFirstSyncStatus(labPage);

    await labPage.goto("/attention-lab");
    await expect(
      labPage.getByRole("heading", { name: "Attention Lab" })
    ).toBeVisible();
    await expect(
      labPage.getByText("최근 Attention 실행을 불러오고 있습니다.", {
        exact: true
      })
    ).toHaveCount(0);
    await expect
      .poll(() => labAttentionReads, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(1);
    const labReadsBeforeRevision = labAttentionReads;
    await labPage.bringToFront();
    await expect
      .poll(() =>
        labPage.evaluate(() => document.visibilityState)
      )
      .toBe("visible");
    await releaseLabSyncStatus();
    await expect
      .poll(() => labAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(labReadsBeforeRevision);

    const sourcesPage = await context.newPage();
    let failStatusOnce = true;
    await sourcesPage.route("**/api/sync/status", async (route) => {
      if (failStatusOnce) {
        failStatusOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            code: "E2E_TRANSIENT_FAILURE"
          })
        });
        return;
      }
      await route.continue();
    });

    await sourcesPage.goto("/sources");
    await expect(
      sourcesPage.getByRole("heading", { name: "연결과 데이터 범위" })
    ).toBeVisible();
    await expect(
      sourcesPage
        .locator('section[aria-labelledby="codex-title"]')
        .getByText("연결됨", { exact: true })
    ).toBeVisible();
    await expect(
      sourcesPage.locator(".sourceSyncMeta.isWarning").first()
    ).toContainText("상태 확인 재시도", { timeout: 6_000 });
    await expect(
      sourcesPage.locator(".sourceSyncMeta.isWarning")
    ).toHaveCount(0, { timeout: 8_000 });

    await labPage.bringToFront();
    await expect(
      labPage
        .locator('section[aria-labelledby="active-decision-title"]')
        .getByText("근거 부족", { exact: true })
    ).toBeVisible();

    await sourcesPage.close();
    await labPage.close();
  });

  test("disconnects Codex through the real route and propagates the cleared revision to both UIs", async ({
    page: todayPage,
    request,
    context
  }) => {
    let todayAttentionReads = 0;
    trackAttentionReads(todayPage, () => {
      todayAttentionReads += 1;
    });
    const releaseTodaySyncStatus = await holdFirstSyncStatus(todayPage);

    await todayPage.goto("/");
    await expect(
      todayPage.getByRole("heading", { name: "오늘의 Work Cockpit" })
    ).toBeVisible();
    await expect
      .poll(() => todayAttentionReads, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(1);
    const todayReadsBeforeInitialRevision = todayAttentionReads;
    await releaseTodaySyncStatus();
    await expect
      .poll(() => todayAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(todayReadsBeforeInitialRevision);

    const labPage = await context.newPage();
    let labAttentionReads = 0;
    trackAttentionReads(labPage, () => {
      labAttentionReads += 1;
    });
    const releaseLabSyncStatus = await holdFirstSyncStatus(labPage);

    await labPage.goto("/attention-lab");
    await expect(
      labPage.getByRole("heading", { name: "Attention Lab" })
    ).toBeVisible();
    await expect(
      labPage.getByText("최근 Attention 실행을 불러오고 있습니다.", {
        exact: true
      })
    ).toHaveCount(0);
    await expect
      .poll(() => labAttentionReads, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(1);
    const labReadsBeforeInitialRevision = labAttentionReads;
    await labPage.bringToFront();
    await expect
      .poll(() =>
        labPage.evaluate(() => document.visibilityState)
      )
      .toBe("visible");
    await releaseLabSyncStatus();
    await expect
      .poll(() => labAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(labReadsBeforeInitialRevision);

    const sourcesPage = await context.newPage();
    await sourcesPage.goto("/sources");
    const codexSection = sourcesPage.locator(
      'section[aria-labelledby="codex-title"]'
    );
    await expect(
      codexSection.getByText("연결됨", { exact: true })
    ).toBeVisible();

    const todayReadsBeforeDisconnect = todayAttentionReads;
    const labReadsBeforeDisconnect = labAttentionReads;
    const disconnectResponse = sourcesPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          "/api/connectors/codex/disconnect"
    );
    await codexSection
      .getByRole("button", { name: "연결 해제", exact: true })
      .click();
    expect((await disconnectResponse).status()).toBe(200);

    await expect(
      codexSection.getByText("연결 안 됨", { exact: true })
    ).toBeVisible();
    await expect(codexSection.locator(".sourceSyncMeta")).toContainText(
      "오류 CONNECTOR_DISCONNECTED"
    );
    const connectorStatus = await request.get(
      "/api/connectors/codex/status"
    );
    expect(connectorStatus.status()).toBe(200);
    await expect(connectorStatus.json()).resolves.toMatchObject({
      status: "disconnected"
    });
    const syncStatus = await request.get("/api/sync/status");
    expect(syncStatus.status()).toBe(200);
    const syncPayload = await syncStatus.json();
    expect(
      syncPayload.sources.find(
        (source: { source: string }) => source.source === "codex"
      )
    ).toMatchObject({
      status: "disconnected",
      snapshotRevision: null,
      lastErrorCode: "CONNECTOR_DISCONNECTED"
    });

    await todayPage.bringToFront();
    await expect(
      todayPage.getByRole("heading", { name: "오늘의 Work Cockpit" })
    ).toBeVisible();
    await expect
      .poll(() => todayAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(todayReadsBeforeDisconnect);

    await labPage.bringToFront();
    await expect(
      labPage.getByRole("heading", { name: "Attention Lab" })
    ).toBeVisible();
    await expect
      .poll(() => labAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(labReadsBeforeDisconnect);
    expect(new URL(labPage.url()).pathname).toBe("/attention-lab");

    await sourcesPage.close();
    await labPage.close();
  });
});

function trackAttentionReads(page: Page, onRead: () => void): void {
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/attention"
    ) {
      onRead();
    }
  });
}

async function holdFirstSyncStatus(
  page: Page
): Promise<() => Promise<void>> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let shouldHold = true;

  const holdFirstResponse = async (route: Route) => {
    if (shouldHold) {
      shouldHold = false;
      markRequested();
      await gate;
    }
    await route.continue();
  };

  await page.route("**/api/sync/start", holdFirstResponse);
  await page.route("**/api/sync/status", holdFirstResponse);

  return async () => {
    await requested;
    release();
  };
}

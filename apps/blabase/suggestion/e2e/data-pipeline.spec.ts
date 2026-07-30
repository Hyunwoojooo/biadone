import { expect, test } from "@playwright/test";

test.describe.serial("Phase 2A.1 browser data pipeline", () => {
  test("recovers polling and propagates the stored revision into Work Cockpit and Lab", async ({
    page
  }) => {
    let failStatusOnce = true;
    let attentionReads = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/attention"
      ) {
        attentionReads += 1;
      }
    });
    await page.route("**/api/sync/status", async (route) => {
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

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "오늘의 Work Cockpit" })
    ).toBeVisible();
    await expect(
      page
        .locator('section[aria-labelledby="codex-title"]')
        .getByText("연결됨", { exact: true })
    ).toBeVisible();
    await expect(
      page.locator(".sourceSyncMeta.isWarning").first()
    ).toContainText("상태 확인 재시도", { timeout: 6_000 });
    await expect
      .poll(() => attentionReads, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(2);
    await expect(
      page.locator(".sourceSyncMeta.isWarning")
    ).toHaveCount(0, { timeout: 8_000 });

    await page.goto("/attention-lab");
    await expect(
      page.getByRole("heading", { name: "Attention Lab" })
    ).toBeVisible();
    await expect(
      page.getByText("근거 부족", { exact: true })
    ).toBeVisible();
  });

  test("disconnects Codex through the real route and propagates the cleared revision to both UIs", async ({
    page,
    request,
    context
  }) => {
    let attentionReads = 0;
    page.on("request", (browserRequest) => {
      if (
        browserRequest.method() === "GET" &&
        new URL(browserRequest.url()).pathname === "/api/attention"
      ) {
        attentionReads += 1;
      }
    });

    await page.goto("/");
    const codexSection = page.locator(
      'section[aria-labelledby="codex-title"]'
    );
    await expect(
      codexSection.getByText("연결됨", { exact: true })
    ).toBeVisible();

    const labPage = await context.newPage();
    let labAttentionReads = 0;
    labPage.on("request", (browserRequest) => {
      if (
        browserRequest.method() === "GET" &&
        new URL(browserRequest.url()).pathname === "/api/attention"
      ) {
        labAttentionReads += 1;
      }
    });
    await labPage.goto("/attention-lab");
    await expect(
      labPage.getByRole("heading", { name: "Attention Lab" })
    ).toBeVisible();
    const labReadsBeforeDisconnect = labAttentionReads;

    await page.bringToFront();
    const readsBeforeDisconnect = attentionReads;
    const disconnectResponse = page.waitForResponse(
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
    await expect
      .poll(() => attentionReads, { timeout: 8_000 })
      .toBeGreaterThan(readsBeforeDisconnect);

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

    await labPage.bringToFront();
    await expect(
      labPage.getByRole("heading", { name: "Attention Lab" })
    ).toBeVisible();
    await expect
      .poll(() => labAttentionReads, { timeout: 8_000 })
      .toBeGreaterThan(labReadsBeforeDisconnect);
    expect(new URL(labPage.url()).pathname).toBe("/attention-lab");
    await labPage.close();
  });
});

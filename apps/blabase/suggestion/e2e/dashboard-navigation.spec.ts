import { expect, test } from "@playwright/test";

test("navigates the dashboard information architecture", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "오늘의 Work Cockpit" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Today" })
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page
      .getByRole("complementary", { name: "Blabase dashboard" })
      .locator("kbd")
  ).toHaveText("⇧ Space");

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(
    page.getByRole("heading", { name: "프로젝트와 작업 맥락" })
  ).toBeVisible();

  await page.getByRole("link", { name: "Sources" }).click();
  await expect(
    page.getByRole("heading", { name: "연결과 데이터 범위" })
  ).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "동작과 진단 설정" })
  ).toBeVisible();
  await expect(page.getByRole("main").locator("kbd")).toHaveText(
    "⇧ Space"
  );

  await page.getByRole("link", { name: "Legacy ChatGPT 분석 열기" }).click();
  await expect(
    page.getByRole("heading", { name: "기존 ChatGPT 대화 분석" })
  ).toBeVisible();
});

test("focuses only allowlisted launcher source targets", async ({ page }) => {
  await page.goto(
    "/sources?source=google-calendar&entry=launcher&returnTo=https%3A%2F%2Fexample.com"
  );

  const calendar = page.locator("#source-google-calendar");
  await expect(calendar).toBeFocused();
  await expect(calendar).toHaveAttribute("data-source-focus", "true");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        origin: window.location.origin,
        pathname: window.location.pathname,
        hash: window.location.hash
      }))
    )
    .toEqual({
      origin: "http://localhost:3199",
      pathname: "/sources",
      hash: "#source-google-calendar"
    });

  await page.evaluate(() => {
    window.location.hash = "source-codex";
  });
  await expect(page.locator("#source-codex")).toBeFocused();

  await page.goto("/sources?source=google_calendar&entry=launcher");
  await expect(page.locator("[data-source-focus='true']")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("");
});

test("consumes a connector status at its canonical source anchor", async ({
  page
}) => {
  await page.goto("/sources?notion=connected#source-notion");

  await expect(page.locator("#source-notion")).toBeFocused();
  await expect(page.getByText("Notion이 연결되었습니다.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        search: window.location.search,
        hash: window.location.hash
      }))
    )
    .toEqual({ search: "", hash: "#source-notion" });
});

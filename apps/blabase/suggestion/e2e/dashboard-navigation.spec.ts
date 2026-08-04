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

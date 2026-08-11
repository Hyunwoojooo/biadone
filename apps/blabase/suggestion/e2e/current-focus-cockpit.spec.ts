import { expect, test } from "@playwright/test";

test("separates Current Focus from Next Attention and exposes shadow diagnostics", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByText("Current Focus", { exact: true })).toBeVisible();
  await expect(page.getByText("Next Attention", { exact: true })).toBeVisible();
  await expect(
    page.getByText("기존 권위·자격 판정 유지", { exact: true })
  ).toBeVisible();

  await page
    .getByRole("link", {
      name: "Attention Lab에서 실행 기록과 근거 자세히 보기"
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Current Focus 복원 진단" })
  ).toBeVisible();
  await expect(
    page.getByText("Focus는 후보를 만들거나 eligibility를 바꾸지 않으며", {
      exact: false
    })
  ).toBeVisible();
});

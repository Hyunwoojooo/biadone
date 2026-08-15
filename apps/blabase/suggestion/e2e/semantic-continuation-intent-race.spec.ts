import { expect, test } from "@playwright/test";

test.skip(
  process.env.BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED !== "true",
  "SC-001 mounted race test requires the explicit write opt-in."
);

test("resets confirmation state when the exact Board target changes", async ({
  page
}) => {
  const generatedAt = new Date();
  let target = "a";
  let boardReads = 0;
  const intentBodies: unknown[] = [];
  let releaseFirstIntent!: () => void;
  const firstIntentHeld = new Promise<void>((resolve) => {
    releaseFirstIntent = resolve;
  });

  await page.route("**/api/work-board", async (route) => {
    boardReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workBoard(target, generatedAt))
    });
  });
  await page.route("**/api/work-board/intent", async (route) => {
    const body = route.request().postDataJSON() as {
      subjectLabel?: string;
    };
    intentBodies.push(body);
    if (intentBodies.length === 1) await firstIntentHeld;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "confirmed",
        intent: "QA_RUN",
        title: `${body.subjectLabel ?? "fixture"} QA 진행하기`,
        expiresAt: new Date(
          generatedAt.getTime() + 60 * 60_000
        ).toISOString()
      })
    });
  });

  await page.goto("/attention-lab");
  const input = page.getByLabel("QA 대상 이름");
  await expect(input).toBeVisible();
  await input.fill("alpha");
  await page.getByRole("button", { name: "QA 진행 제목으로 확인" }).click();
  await expect.poll(() => intentBodies.length).toBe(1);

  target = "b";
  await page
    .getByRole("button", { name: "연결된 소스 새로고침 후 평가" })
    .click();
  await expect.poll(() => boardReads).toBeGreaterThanOrEqual(2);
  await expect(input).toHaveValue("");
  expect(intentBodies).toHaveLength(1);

  // The manual source refresh can legitimately finish its Board reread after
  // the target remount. Establish a quiet boundary before attributing a later
  // read to the held, stale intent completion.
  await page.waitForTimeout(500);
  const readsBeforeStaleCompletion = boardReads;
  releaseFirstIntent();
  await page.waitForTimeout(150);
  expect(boardReads).toBe(readsBeforeStaleCompletion);
  await expect(
    page.getByText(
      "명시적으로 확인했습니다. 실행이나 QA 결과 기록은 만들지 않습니다."
    )
  ).toHaveCount(0);

  await input.fill("beta");
  await page.getByRole("button", { name: "QA 진행 제목으로 확인" }).click();
  await expect(
    page.getByText(
      "명시적으로 확인했습니다. 실행이나 QA 결과 기록은 만들지 않습니다."
    )
  ).toBeVisible();
  expect(intentBodies).toHaveLength(2);

  await input.fill("gamma");
  await expect(
    page.getByText(
      "명시적으로 확인했습니다. 실행이나 QA 결과 기록은 만들지 않습니다."
    )
  ).toHaveCount(0);
  await expect(
    page.getByText("확인하면 이 로컬 Board 제목에만 반영됩니다.")
  ).toBeVisible();
  expect(intentBodies).toHaveLength(2);
});

function workBoard(target: string, generatedAt: Date) {
  const observedAt = new Date(generatedAt.getTime() - 60_000).toISOString();
  const expiresAt = new Date(
    generatedAt.getTime() + 2 * 60 * 60_000
  ).toISOString();
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
        generatedAt: generatedAt.toISOString(),
        prominentLane: "continuation",
        primary: {
          lane: "continuation",
          item: {
            itemRef: `item_ref_${target.repeat(43)}`,
            workContextRef: `context_ref_${target.repeat(43)}`,
            kind: "linked_workstream",
            title: `QA target ${target.toUpperCase()}`,
            summary: `QA target ${target.toUpperCase()}`,
            observedAt,
            expiresAt,
            evidenceBand: "corroborated",
            capability: "display",
            action: null,
            caveatCodes: []
          }
        },
        alternatives: [],
        continuationStatus: "available",
        executionPolicy: {
          automaticExecutionAllowed: false,
          explicitUserActionRequired: true,
          externalMutationAllowed: false
        }
      }
    },
    semanticPresentation: null
  };
}

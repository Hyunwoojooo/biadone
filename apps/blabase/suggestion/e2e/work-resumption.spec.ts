import { expect, test, type Route } from "@playwright/test";

import type { AttentionReadyResponse } from "../src/attention/monitoringSchema";
import type {
  Phase2Candidate,
  Phase2CodexOverviewItem
} from "../src/crossSource/attentionSchema";

const NOW = "2026-07-30T03:00:00.000Z";
const EXECUTION_ID = `codex:execution:${"d".repeat(24)}`;
const TASK_TITLE = "blabase Phase 2B 작업 설정 필요";
const TASK_REF = {
  kind: "attention_subject",
  source: "github",
  subjectId: "github:issue:blabase:42",
  displayTitle: TASK_TITLE
} as const;

test("explicitly binds a Codex session and resumes it with Enter", async ({
  page
}) => {
  const mutationBodies: Array<Record<string, unknown>> = [];
  let binding: WorkResumptionBinding | null = null;
  let completedCommand: WorkResumptionCommand | null = null;

  await page.route("**/api/attention*", async (route) => {
    const upstream = await route.fetch();
    const payload = (await upstream.json()) as AttentionReadyResponse;
    expect(payload.status).toBe("ready");

    payload.result.decision = {
      ...payload.result.decision,
      status: "suggested",
      topSuggestion: attentionCandidate(),
      alternatives: [],
      certainty: "confirmed",
      reasonCodes: ["DECISION_BEST_OBSERVED_CANDIDATE"],
      caveatCodes: [],
      scopeStatement:
        "테스트에서 합성한 GitHub 작업과 Codex 과거 세션만 평가했습니다."
    };
    payload.result.workCockpit.codexExecutions = [codexSession()];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload)
    });
  });

  await page.route("**/api/work-resumption*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET") {
      const commandId = url.searchParams.get("commandId");
      await fulfillWorkResumption(route, {
        status: "ready",
        companion: {
          state: "online",
          lastSeenAt: NOW
        },
        bindings: binding ? [binding] : [],
        command:
          commandId && completedCommand?.commandId === commandId
            ? completedCommand
            : null
      });
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    mutationBodies.push(body);

    if (body.action === "bind") {
      binding = {
        bindingId: `binding_${"b".repeat(32)}`,
        taskRef: {
          kind: TASK_REF.kind,
          source: TASK_REF.source,
          subjectId: TASK_REF.subjectId
        },
        executionId: EXECUTION_ID,
        boundAt: NOW
      };
      await fulfillWorkResumption(route, {
        status: "ready",
        companion: {
          state: "online",
          lastSeenAt: NOW
        },
        bindings: [binding]
      });
      return;
    }

    expect(body.action).toBe("open");
    completedCommand = {
      commandId: `command_${"c".repeat(32)}`,
      bindingId: binding?.bindingId ?? "",
      operation: "focus_or_resume",
      status: "completed",
      createdAt: NOW,
      expiresAt: "2026-07-30T03:00:30.000Z",
      completedAt: "2026-07-30T03:00:01.000Z",
      resultCode: "RESUMED_IN_TERMINAL"
    };
    await fulfillWorkResumption(route, {
      status: "ready",
      companion: {
        state: "online",
        lastSeenAt: NOW
      },
      bindings: binding ? [binding] : [],
      acceptedCommand: {
        ...completedCommand,
        status: "pending",
        completedAt: null,
        resultCode: null
      }
    });
  });

  await page.goto("/");

  const resumption = page.locator(
    'section[aria-labelledby="work-resumption-title"]'
  );
  await expect(
    resumption.getByRole("heading", {
      name: "이 작업의 Codex 세션"
    })
  ).toBeVisible();
  await expect(
    resumption.getByRole("combobox", {
      name: "연결할 Codex 세션"
    })
  ).toHaveValue("");
  await expect(
    resumption.getByText("사용자가 연결한 세션", { exact: true })
  ).toHaveCount(0);
  expect(mutationBodies).toHaveLength(0);

  await resumption
    .getByRole("combobox", { name: "연결할 Codex 세션" })
    .selectOption(EXECUTION_ID);
  await resumption
    .getByRole("button", { name: "이 세션을 작업에 연결" })
    .click();

  await expect(
    resumption.getByText("사용자가 연결한 세션", { exact: true })
  ).toBeVisible();
  await expect(
    resumption.getByText(
      "선택한 Codex 세션을 이 작업에 연결했습니다. 제목이 비슷한 다른 세션은 자동 연결하지 않습니다.",
      { exact: true }
    )
  ).toBeVisible();
  expect(mutationBodies[0]).toEqual({
    action: "bind",
    taskRef: TASK_REF,
    executionId: EXECUTION_ID,
    explicitUserConfirmation: true
  });

  const resumeButton = resumption.getByRole("button", {
    name: "Codex에서 작업 이어가기"
  });
  await resumeButton.focus();
  await expect(resumeButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(() => mutationBodies.find((body) => body.action === "open"))
    .toEqual({
      action: "open",
      taskRef: TASK_REF,
      explicitUserAction: true
    });

  const openBody = mutationBodies.find(
    (body) => body.action === "open"
  );
  expect(openBody).toBeDefined();
  expect(openBody).not.toHaveProperty("prompt");
  expect(openBody).not.toHaveProperty("shellCommand");
  expect(openBody).not.toHaveProperty("command");

  await expect(
    resumption.getByText(
      "Terminal에서 Codex 세션을 이어서 열었습니다.",
      { exact: true }
    )
  ).toBeVisible();
});

function attentionCandidate(): Phase2Candidate {
  return {
    candidateId: `candidate_${"1".repeat(32)}`,
    source: "github",
    subjectId: TASK_REF.subjectId,
    projectId: null,
    sourceSignalIds: [`signal_${"2".repeat(32)}`],
    taskKind: "assigned_issue",
    title: TASK_TITLE,
    repositoryFullName: "biadone/blabase",
    number: 42,
    intervention: "do",
    lane: "focus",
    state: "unclear",
    dueAt: null,
    destinationUrl: "https://github.com/biadone/blabase/issues/42",
    certainty: "confirmed",
    reasonCodes: ["CANDIDATE_GITHUB_ASSIGNED_ISSUE"],
    whyNowReasonCodes: ["WHY_NOW_OPEN_ASSIGNED_WORK"],
    caveatCodes: [],
    sourceUpdatedAt: NOW,
    firstStep: "연결할 Codex 세션을 명시적으로 선택합니다.",
    explanation:
      "실제 실행 전 사용자가 세션 연결과 작업 재개를 각각 확인합니다."
  };
}

function codexSession(): Phase2CodexOverviewItem {
  return {
    executionId: EXECUTION_ID,
    signalId: `signal_${"3".repeat(32)}`,
    observationId: `observation_${"4".repeat(32)}`,
    observationMode: "inventory_only",
    liveObservationAvailable: false,
    executionState: "unknown",
    executionStateReason:
      "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE",
    nativeActivityState: "idle",
    semanticState: "idle",
    nativeAttentionState: null,
    attentionSemanticRole: "overview_badge_only",
    projectLabel: "blabase",
    taskSummary: "Phase 2B 엔진 작업 세션",
    taskSummarySemanticRole: "display_only_unknown",
    contentMode: "metadata_only",
    conversationCollectionState: "not_collected",
    conversationContentAvailable: false,
    historicalContextCompleteness: "not_collected",
    historicalTurnStatus: "unknown",
    historicalStatusSemanticRole: "persisted_history_only",
    conversationSourceUpdatedAt: null,
    contentCollectedAt: null,
    contentExpiresAt: null,
    latestTurnCompletedAt: null,
    turnCount: 0,
    userPromptCount: 0,
    agentResponseCount: 0,
    commandExecutionCount: 0,
    failedCommandCount: 0,
    fileChangeCount: 0,
    toolCallCount: 0,
    omittedReasoningItemCount: 0,
    omittedUnsupportedItemCount: 0,
    contentTruncated: false,
    contentReasonCodes: ["CONTENT_MODE_DISABLED"],
    latestUserPromptExcerpt: null,
    latestAgentResponseExcerpt: null,
    latestExecutionSummary: null,
    contentSemanticRole: "historical_context_only",
    contentPrivacyBoundary: "sanitized_manifest_only",
    observedAt: NOW,
    sourceUpdatedAt: NOW,
    freshness: "fresh",
    reasonCode: "OVERVIEW_CODEX_EXECUTION_IDLE",
    forbiddenAsAttentionCandidate: true
  };
}

type WorkResumptionBinding = {
  bindingId: string;
  taskRef: Omit<typeof TASK_REF, "displayTitle">;
  executionId: string;
  boundAt: string;
};

type WorkResumptionCommand = {
  commandId: string;
  bindingId: string;
  operation: "focus_or_resume";
  status: "pending" | "completed";
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  resultCode: "RESUMED_IN_TERMINAL" | null;
};

async function fulfillWorkResumption(
  route: Route,
  body: Record<string, unknown>
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

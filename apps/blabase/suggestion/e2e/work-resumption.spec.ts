import { expect, test, type Route } from "@playwright/test";

import type { AttentionReadyResponse } from "../src/attention/monitoringSchema";
import type { ActiveAttentionCandidate } from "../src/attentionDecision";
import type { Phase2CodexOverviewItem } from "../src/crossSource/attentionSchema";

const NOW = "2026-07-30T03:00:00.000Z";
const EXECUTION_ID = `codex:execution:${"d".repeat(24)}`;
const BINDING_ID = `binding_${"b".repeat(32)}`;
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
  const attentionResponse = await page.request.get("/api/attention");
  const baseAttentionPayload =
    (await attentionResponse.json()) as AttentionReadyResponse;
  expect(baseAttentionPayload.status).toBe("ready");

  await page.route("**/api/attention*", async (route) => {
    const payload = structuredClone(baseAttentionPayload);

    payload.result.decision = {
      ...payload.result.decision,
      status: "suggested",
      topSuggestion: attentionCandidate(),
      alternatives: [],
      certainty: "confirmed",
      reasonCodes: ["DECISION_BEST_ELIGIBLE_CANDIDATE"],
      caveatCodes: [],
      scopeStatement:
        "테스트에서 합성한 GitHub 작업과 Codex 과거 세션만 평가했습니다."
    };
    payload.baseResult.workCockpit.codexExecutions = [codexSession()];

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
        bindingId: BINDING_ID,
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

test("opens a managed suggestion only with its exact evaluated binding identity", async ({
  page
}) => {
  const mutationBodies: Array<Record<string, unknown>> = [];
  const binding: WorkResumptionBinding = {
    bindingId: BINDING_ID,
    taskRef: {
      kind: TASK_REF.kind,
      source: TASK_REF.source,
      subjectId: TASK_REF.subjectId
    },
    executionId: EXECUTION_ID,
    boundAt: NOW
  };
  const attentionResponse = await page.request.get("/api/attention");
  const baseAttentionPayload =
    (await attentionResponse.json()) as AttentionReadyResponse;
  expect(baseAttentionPayload.status).toBe("ready");

  await page.route("**/api/attention*", async (route) => {
    const payload = structuredClone(baseAttentionPayload);
    payload.result.decision = {
      ...payload.result.decision,
      status: "suggested",
      topSuggestion: managedAttentionCandidate(),
      alternatives: [],
      certainty: "confirmed",
      reasonCodes: ["DECISION_BEST_ELIGIBLE_CANDIDATE"],
      caveatCodes: [],
      scopeStatement: "테스트 managed identity만 평가했습니다."
    };
    payload.baseResult.workCockpit.codexExecutions = [codexSession()];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload)
    });
  });

  await page.route("**/api/work-resumption*", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await fulfillWorkResumption(route, {
        status: "ready",
        companion: { state: "online", lastSeenAt: NOW },
        bindings: [binding],
        command: null
      });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    mutationBodies.push(body);
    await fulfillWorkResumption(route, {
      status: "ready",
      companion: { state: "online", lastSeenAt: NOW },
      bindings: [binding],
      acceptedCommand: {
        commandId: `command_${"a".repeat(32)}`,
        bindingId: BINDING_ID,
        operation: "focus_or_resume",
        status: "pending",
        createdAt: NOW,
        expiresAt: "2026-07-30T03:00:30.000Z",
        completedAt: null,
        resultCode: null
      }
    });
  });

  await page.goto("/");
  await page
    .getByRole("button", { name: "Codex에서 작업 이어가기" })
    .click();

  await expect.poll(() => mutationBodies[0]).toEqual({
    action: "open",
    taskRef: TASK_REF,
    explicitUserAction: true,
    expectedBindingId: BINDING_ID,
    expectedExecutionId: EXECUTION_ID
  });
});

test("does not open a managed suggestion after its binding identity changed", async ({
  page
}) => {
  const mutationBodies: Array<Record<string, unknown>> = [];
  const attentionResponse = await page.request.get("/api/attention");
  const baseAttentionPayload =
    (await attentionResponse.json()) as AttentionReadyResponse;
  expect(baseAttentionPayload.status).toBe("ready");

  await page.route("**/api/attention*", async (route) => {
    const payload = structuredClone(baseAttentionPayload);
    payload.result.decision = {
      ...payload.result.decision,
      status: "suggested",
      topSuggestion: managedAttentionCandidate(),
      alternatives: [],
      certainty: "confirmed",
      reasonCodes: ["DECISION_BEST_ELIGIBLE_CANDIDATE"],
      caveatCodes: [],
      scopeStatement: "테스트 managed identity만 평가했습니다."
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload)
    });
  });

  await page.route("**/api/work-resumption*", async (route) => {
    if (route.request().method() === "POST") {
      mutationBodies.push(
        route.request().postDataJSON() as Record<string, unknown>
      );
    }
    await fulfillWorkResumption(route, {
      status: "ready",
      companion: { state: "online", lastSeenAt: NOW },
      bindings: [
        {
          bindingId: `binding_${"e".repeat(32)}`,
          taskRef: {
            kind: TASK_REF.kind,
            source: TASK_REF.source,
            subjectId: TASK_REF.subjectId
          },
          executionId: `codex:execution:${"f".repeat(24)}`,
          boundAt: NOW
        }
      ]
    });
  });

  await page.goto("/");
  await expect(
    page.getByText(
      "이 추천을 만들 때 확인한 Codex 세션 연결이 현재 상태와 다릅니다.",
      { exact: false }
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Codex에서 작업 이어가기" })
  ).toHaveCount(0);
  expect(mutationBodies).toEqual([]);
});

function attentionCandidate(): ActiveAttentionCandidate {
  return {
    candidateId: `attention_${"1".repeat(32)}`,
    candidateSeedId: `seed_${"2".repeat(32)}`,
    triggerSource: "github",
    triggerKind: "github_work_item",
    targetRef: `claim_subject_${"3".repeat(32)}`,
    githubSubjectId: TASK_REF.subjectId,
    projectId: null,
    relationRef: null,
    managedRunId: null,
    bindingId: null,
    executionId: null,
    workflowDecisionId: null,
    workflowActionKind: null,
    taskKind: "assigned_issue",
    title: TASK_TITLE,
    repositoryFullName: "biadone/blabase",
    number: 42,
    intervention: "do",
    lane: "focus",
    state: "open",
    dueAt: null,
    destinationUrl: "https://github.com/biadone/blabase/issues/42",
    certainty: "confirmed",
    reasonCodes: ["CANDIDATE_GITHUB_ASSIGNED_ISSUE"],
    whyNowReasonCodes: ["WHY_NOW_ASSIGNED_WORK_OPEN"],
    caveatCodes: [],
    sourceEvidenceRefs: [`sig_${"4".repeat(32)}`],
    sourceUpdatedAt: NOW,
    firstStep: "연결할 Codex 세션을 명시적으로 선택합니다.",
    explanation:
      "실제 실행 전 사용자가 세션 연결과 작업 재개를 각각 확인합니다.",
    upstreamObjectsRemainForbidden: true,
    attentionDisposition: "active_candidate"
  };
}

function managedAttentionCandidate(): ActiveAttentionCandidate {
  return {
    ...attentionCandidate(),
    triggerSource: "codex_managed",
    triggerKind: "managed_failure",
    relationRef: `relation_${"5".repeat(32)}`,
    managedRunId: `managed_run_${"6".repeat(32)}`,
    bindingId: BINDING_ID,
    executionId: EXECUTION_ID,
    intervention: "inspect",
    lane: "unblock",
    state: "failed",
    reasonCodes: ["CANDIDATE_CODEX_LATEST_DIRECT_FAILURE"],
    whyNowReasonCodes: ["WHY_NOW_MANAGED_FAILURE_CURRENT"],
    caveatCodes: ["CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY"],
    firstStep: "연결된 Codex 실패 원인을 확인합니다."
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

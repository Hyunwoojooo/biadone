import { expect, test } from "@playwright/test";

import type {
  ManagedCodexPublicRun,
  ManagedCodexRunsReadyResponse,
  ManagedCodexSemanticProjection
} from "../app/managedCodexRunsClient";
import type { WorkRelationsReadyResponse } from "../app/workRelationsClient";
import {
  buildManagedCodexSemanticProjection,
  CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
  createEmptyManagedCodexHistory,
  createManagedCodexEvent,
  sealManagedCodexHistory,
  type ManagedCodexEventHistory
} from "../src/managedCodex";
import { observeCodexManagedNotification } from "../src/connectors/codex/observationContract";
import {
  createGitHubArtifactId,
  createManagedCodexArtifactRelationId,
  createWorkArtifactAttributionId,
  sealManagedCodexArtifactRelationProjection,
  type GitHubArtifactIdentity,
  type ManagedCodexArtifactRelation,
  type ManagedCodexArtifactRelationProjection
} from "../src/artifacts";
import {
  canonicalClaimCoverage,
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  deriveManagedCodexClaims,
  resolveClaimAuthority
} from "../src/claims";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import {
  sealManagedCodexWorkRelationProjection,
  type ManagedCodexWorkRelation
} from "../src/relations";

const OBSERVED_AT = "2026-08-01T03:00:00.000Z";

test("shows managed progress without triggering an Attention source refresh", async ({
  page
}) => {
  let managedReads = 0;
  let relationReads = 0;
  let attentionRefreshes = 0;
  let runOverride: Partial<ManagedCodexPublicRun> = {};

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname === "/api/attention") {
      attentionRefreshes += 1;
    }
  });
  await page.route("**/api/managed-codex-runs", async (route) => {
    managedReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projection(runOverride))
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    relationReads += 1;
    const run = projection(runOverride).runs[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        run
          ? workRelationProjection(run)
          : emptyWorkRelationProjection()
      )
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(
    progress.getByRole("heading", { name: "Codex 실시간 진행" })
  ).toBeVisible();
  await expect(
    progress.getByText("정상 실행은 관찰 전용 · 검증된 실패와 설정된 후속 작업만 추천 후보", {
      exact: true
    })
  ).toBeVisible();
  await expect(progress.locator(".claimConflictSummary")).toContainText(
    "현재 평가 가능한 범위에서 확인된 충돌이 없습니다."
  );
  await progress.getByText("source별 평가 범위").click();
  await expect(progress.locator(".claimCoverageDetails")).toContainText(
    "Notion맥락 전용 · 상태 충돌 미평가"
  );
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "진행 중"
  );
  await expect(progress.locator(".managedCodexSemanticStatus")).toContainText(
    "직접 이벤트 해석 turn 진행 관찰됨"
  );
  await expect(progress.locator(".managedCodexSemanticStatus")).toContainText(
    "작업 진전 판단 불가"
  );
  await expect(progress.locator(".managedCodexSemanticStatus")).toContainText(
    "정체 평가 불가"
  );
  await expect(progress.locator(".managedCodexRelation")).toContainText(
    "GitHub 이슈 #42"
  );
  await expect(progress.locator(".managedCodexRelation")).toContainText(
    "사용자 직접 연결"
  );
  await expect(progress.locator(".managedCodexRelation")).toContainText(
    "executes · 사용자가 직접 연결"
  );
  await progress.getByText("최근 직접 관찰 타임라인 (1개)").click();
  await expect(progress.locator(".managedCodexTimeline")).toContainText(
    "명령 실행 시작"
  );

  await page.waitForTimeout(400);
  const attentionRefreshesBeforeTransition = attentionRefreshes;
  const managedReadsBeforeTransition = managedReads;
  const relationReadsBeforeTransition = relationReads;
  runOverride = {
    streamState: "disconnected",
    continuity: "unverified",
    effectiveExecutionState: "unknown",
    sourceEvent: "stream_disconnected",
    liveObservationAvailable: false
  };

  await expect
    .poll(() => managedReads)
    .toBeGreaterThan(managedReadsBeforeTransition);
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "연결 끊김 · 현재 상태 미확인"
  );
  await expect(progress.locator(".managedCodexRunMeta")).toContainText(
    "마지막 검증 상태진행 중"
  );
  await expect
    .poll(() => relationReads)
    .toBeGreaterThan(relationReadsBeforeTransition);

  const readsBeforeReconnect = managedReads;
  const relationReadsBeforeReconnect = relationReads;
  runOverride = {
    continuity: "gap_detected",
    effectiveExecutionState: "unknown",
    sourceEvent: "stream_reconnected"
  };
  await expect
    .poll(() => managedReads)
    .toBeGreaterThan(readsBeforeReconnect);
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "이벤트 누락 · 현재 상태 미확인"
  );
  await expect
    .poll(() => relationReads)
    .toBeGreaterThan(relationReadsBeforeReconnect);

  const readsBeforeNewEvidence = managedReads;
  const relationReadsBeforeNewEvidence = relationReads;
  runOverride = {
    continuity: "gap_detected",
    effectiveExecutionState: "running",
    sourceEvent: "turn_started"
  };
  await expect
    .poll(() => managedReads)
    .toBeGreaterThan(readsBeforeNewEvidence);
  await expect(progress.locator(".managedCodexRunState")).toContainText(
    "진행 중"
  );
  await expect(progress.locator(".managedCodexRunMeta")).toContainText(
    "이벤트 누락 감지"
  );
  await expect
    .poll(() => relationReads)
    .toBeGreaterThan(relationReadsBeforeNewEvidence);
  expect(attentionRefreshes).toBe(attentionRefreshesBeforeTransition);
});

test("shows an unresolved field conflict without triggering an Attention source refresh", async ({
  page
}) => {
  let attentionRefreshes = 0;
  const managed = projection();
  const run = managed.runs[0];
  if (!run) throw new Error("Synthetic managed run is missing.");
  const workRelations = workRelationProjection(run);
  const claims = conflictingClaimProjection(workRelations);
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/attention"
    ) {
      attentionRefreshes += 1;
    }
  });
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...workRelations, claims })
    });
  });

  await page.goto("/");

  const summary = page.locator(".claimConflictSummary");
  await expect(summary).toContainText("Cross-source 상태 판정");
  await expect(summary).toContainText(
    "claim과 충돌 자체는 후보가 아님 · 관련 작업의 상태 검증과 확인 필요 경로에 반영"
  );
  await expect(summary).toContainText("Codex 실행 상태");
  await expect(summary).toContainText(
    "GitHub 이슈 #42에 연결된 Codex 실행"
  );
  await expect(summary).toContainText("Managed Codex");
  await expect(summary).toContainText("판정 보류");
  await expect(summary).toContainText("미해결 1개");
  const privateProjectionIds = [
    ...claims.conflicts.flatMap((conflict) => [
      conflict.conflictId,
      conflict.target.ref
    ]),
    ...claims.claims.flatMap((claim) => [
      claim.claimId,
      claim.lineageRef,
      ...claim.evidenceRefs
    ])
  ];
  for (const privateId of privateProjectionIds) {
    await expect(summary).not.toContainText(privateId);
  }

  const attentionRefreshesAfterRender = attentionRefreshes;
  await page.waitForTimeout(400);
  expect(attentionRefreshes).toBe(attentionRefreshesAfterRender);
});

test("puts unresolved conflicts first and keeps every conflict accessible", async ({
  page
}) => {
  const managed = projection();
  const run = managed.runs[0];
  if (!run) throw new Error("Synthetic managed run is missing.");
  const workRelations = workRelationProjection(run);
  const claims = manyConflictProjection(workRelations);
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...workRelations, claims })
    });
  });

  await page.goto("/");

  const summary = page.locator(".claimConflictSummary");
  const visibleRows = summary
    .locator(".claimConflictList")
    .first()
    .locator(":scope > li");
  await expect(visibleRows).toHaveCount(5);
  await expect(visibleRows.first()).toContainText("판정 보류");
  await expect(summary).toContainText("미해결 1개 · 기록 6개");
  await summary.getByText("나머지 1개 모두 보기").click();
  await expect(summary.locator(".claimConflictList > li")).toHaveCount(6);
});

test("distinguishes stale source refresh from a user-review conflict", async ({
  page
}) => {
  const managed = projection();
  const run = managed.runs[0];
  if (!run) throw new Error("Synthetic managed run is missing.");
  const workRelations = workRelationProjection(run);
  const claims = staleGitHubConflictProjection(workRelations);
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...workRelations, claims })
    });
  });

  await page.goto("/");

  const summary = page.locator(".claimConflictSummary");
  await expect(summary.locator(".claimConflictList > li")).toContainText(
    "source 갱신 필요"
  );
  await expect(summary.locator(".claimConflictList > li")).toContainText(
    "GitHub 이슈 #42"
  );
  await expect(summary.locator(".claimConflictList > li .isWarning")).toHaveCount(
    1
  );
  await expect(summary.locator(".claimConflictList > li .isError")).toHaveCount(
    0
  );
});

test("distinguishes an empty managed view from historical Codex context", async ({
  page
}) => {
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        contract: "codex-managed-public-projection-v1",
        revision: 0,
        generatedAt: OBSERVED_AT,
        runs: [],
        semantics: emptySemanticProjection(0)
      } satisfies ManagedCodexRunsReadyResponse)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyWorkRelationProjection())
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(progress).toContainText(
    "현재 Blabase가 직접 관리하며 실시간으로 관찰하는 Codex run이 없습니다."
  );
  await expect(
    page.getByRole("heading", { name: "Codex 과거 작업 맥락" })
  ).toBeVisible();
});

const relationStateScenarios: Array<{
  name: string;
  override: (
    run: ManagedCodexPublicRun
  ) => Partial<ManagedCodexWorkRelation>;
  expected: string;
}> = [
  {
    name: "stale GitHub evidence",
    override: () => ({
      githubObservation: {
        status: "stale",
        sourceSnapshotSha256: "2".repeat(64),
        signalIds: [`sig_${"3".repeat(32)}`],
        objectType: "issue",
        taskKind: "assigned_issue",
        number: 42,
        destinationUrl:
          "https://github.com/biadone/blabase/issues/42",
        sourceUpdatedAt: OBSERVED_AT,
        completeness: "complete"
      }
    }),
    expected: "GitHub 데이터 오래됨"
  },
  {
    name: "a GitHub target not observed in the current snapshot",
    override: () => ({
      githubObservation: {
        status: "not_observed",
        sourceSnapshotSha256: "2".repeat(64),
        signalIds: [],
        objectType: null,
        taskKind: null,
        number: null,
        destinationUrl: null,
        sourceUpdatedAt: null,
        completeness: "complete"
      },
      projectAlignment: {
        status: "unavailable",
        projectId: null,
        codexMappingDecisionId: null,
        githubMappingDecisionId: null
      }
    }),
    expected: "최신 데이터에서 미확인"
  },
  {
    name: "a superseded explicit binding",
    override: (run) => ({
      bindingEvidence: {
        bindingId: run.bindingId,
        boundAt: OBSERVED_AT,
        decisionSource: "explicit_user",
        bindingState: "superseded_by_unbind",
        supersededByBindingId: `binding_${"f".repeat(32)}`
      }
    }),
    expected: "연결 해제됨"
  },
  {
    name: "an explicit project mapping conflict",
    override: () => ({
      projectAlignment: {
        status: "conflict",
        projectId: null,
        codexMappingDecisionId: `mapping_${"5".repeat(32)}`,
        githubMappingDecisionId: `mapping_${"6".repeat(32)}`
      },
      conflictCodes: ["PROJECT_MISMATCH"]
    }),
    expected: "프로젝트 충돌"
  }
];

for (const scenario of relationStateScenarios) {
  test(`shows ${scenario.name} without promoting it to Attention`, async ({
    page
  }) => {
    const managed = projection();
    const run = managed.runs[0];
    if (!run) throw new Error("Synthetic managed run is missing.");
    await page.route("**/api/managed-codex-runs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(managed)
      });
    });
    await page.route("**/api/work-relations", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          workRelationProjection(run, scenario.override(run))
        )
      });
    });

    await page.goto("/");

    const relation = page.locator(".managedCodexRelation");
    await expect(relation).toContainText(scenario.expected);
    await expect(relation).toContainText("executes · 사용자가 직접 연결");
    await expect(
      page.getByText("정상 실행은 관찰 전용 · 검증된 실패와 설정된 후속 작업만 추천 후보", {
        exact: true
      })
    ).toBeVisible();
  });
}

test("does not collapse an unavailable relation API into no relation", async ({
  page
}) => {
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projection())
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        code: "WORK_RELATIONS_READ_FAILED",
        message: "연결 근거 확인 불가"
      })
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(progress).toContainText("연결 근거 확인 불가");
  await expect(progress).not.toContainText("GitHub 작업 연결 없음");
});

test("does not attach an older relation to a newer run sharing the binding", async ({
  page
}) => {
  const managed = projection();
  const currentRun = managed.runs[0];
  if (!currentRun) throw new Error("Synthetic managed run is missing.");
  const previousRun: ManagedCodexPublicRun = {
    ...currentRun,
    managedRunId: `managed_run_${"9".repeat(32)}`
  };
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workRelationProjection(previousRun))
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(progress.locator(".managedCodexRelation")).toHaveCount(0);
  await expect(progress).toContainText(
    "이 실행의 연결 근거를 현재 projection에서 확인하지 못했습니다."
  );
});

test("fails closed when a resolved relation has a different execution identity", async ({
  page
}) => {
  const managed = projection();
  const run = managed.runs[0];
  if (!run) throw new Error("Synthetic managed run is missing.");
  const relationPayload = workRelationProjection(run);
  const relation = relationPayload.relations[0];
  if (!relation) throw new Error("Synthetic work relation is missing.");
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...relationPayload,
        relations: [
          {
            ...relation,
            from: {
              ...relation.from,
              subjectId: `codex:execution:${"0".repeat(24)}`
            }
          }
        ]
      })
    });
  });

  await page.goto("/");

  const progress = page.locator(
    'section[aria-labelledby="managed-codex-progress-title"]'
  );
  await expect(progress.locator(".managedCodexRelation")).toHaveCount(0);
  await expect(progress).toContainText(
    "이 실행의 연결 근거를 현재 projection에서 확인하지 못했습니다."
  );
});

test("shows only exact active commit and PR results without exposing repository names", async ({
  page
}) => {
  const managed = projection();
  const run = managed.runs[0];
  if (!run) throw new Error("Synthetic managed run is missing.");
  const workRelations = workRelationProjection(run);
  const executesRelation = workRelations.relations[0];
  if (!executesRelation) {
    throw new Error("Synthetic executes relation is missing.");
  }
  const artifacts = artifactRelationProjection({
    run,
    executesRelation,
    workRelationProjectionSha256: workRelations.projectionSha256,
    entries: [
      {
        artifact: {
          kind: "github_pull_request",
          repositoryId: 101,
          objectId: 4_242,
          number: 17
        }
      },
      {
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "0123456789abcdef0123456789abcdef01234567"
        }
      },
      {
        artifact: {
          kind: "github_pull_request",
          repositoryId: 101,
          objectId: 9_999,
          number: 99
        },
        executesRelationId: `relation_${"f".repeat(32)}`
      }
    ]
  });
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        workRelationsWithArtifacts(workRelations, artifacts)
      )
    });
  });

  await page.goto("/");

  const results = page.locator(".managedCodexArtifacts");
  await expect(results.getByText("생성된 결과", { exact: true })).toBeVisible();
  await expect(results).toContainText(
    "결과 자체는 후보가 아님 · 후속 작업 완료 여부의 근거로 사용"
  );
  await expect(results).toContainText("produces · 사용자가 직접 연결");
  await expect(results).toContainText("GitHub PR #17");
  await expect(results).toContainText("GitHub commit 01234567");
  await expect(results).not.toContainText("GitHub PR #99");
  await expect(results).not.toContainText("biadone/blabase");
  await expect(results).toContainText("GitHub 데이터 최신");
  await expect(results).toContainText("최신 데이터에서 미확인");
});

test("attaches and detaches an exact artifact with an immediate relation refresh", async ({
  page
}) => {
  const managed = projection();
  const run = managed.runs[0];
  if (!run) throw new Error("Synthetic managed run is missing.");
  const workRelations = workRelationProjection(run);
  const executesRelation = workRelations.relations[0];
  if (!executesRelation) {
    throw new Error("Synthetic executes relation is missing.");
  }
  const attachedProjection = artifactRelationProjection({
    run,
    executesRelation,
    workRelationProjectionSha256: workRelations.projectionSha256,
    entries: [
      {
        artifact: {
          kind: "github_pull_request",
          repositoryId: 101,
          objectId: 4_242,
          number: 17
        }
      }
    ]
  });
  const attributionId = attachedProjection.relations[0]?.attributionId;
  if (!attributionId) {
    throw new Error("Synthetic artifact attribution is missing.");
  }
  let artifacts = emptyArtifactRelationProjection(
    workRelations.projectionSha256
  );
  const mutationBodies: unknown[] = [];
  await page.route("**/api/managed-codex-runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(managed)
    });
  });
  await page.route("**/api/work-relations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        workRelationsWithArtifacts(workRelations, artifacts)
      )
    });
  });
  await page.route("**/api/work-artifacts", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    mutationBodies.push(body);
    artifacts =
      body.action === "attach"
        ? attachedProjection
        : emptyArtifactRelationProjection(workRelations.projectionSha256);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        ...(body.action === "attach" ? { attributionId } : {})
      })
    });
  });

  await page.goto("/");

  const results = page.locator(".managedCodexArtifacts");
  const input = results.getByLabel("정확한 GitHub commit 또는 PR URL");
  const artifactUrl =
    "https://github.com/biadone/blabase/pull/17";
  await input.fill(artifactUrl);
  await results.getByRole("button", { name: "결과 연결" }).click();

  await expect(input).toHaveValue("");
  await expect(results).toContainText("GitHub PR #17");
  expect(mutationBodies[0]).toEqual({
    action: "attach",
    managedRunId: run.managedRunId,
    bindingId: run.bindingId,
    executionId: run.executionId,
    artifactUrl,
    explicitUserConfirmation: true
  });

  await results
    .getByRole("button", { name: "GitHub PR #17 연결 해제" })
    .click();

  await expect(results).toContainText(
    "이 실행에 직접 연결된 GitHub 결과가 없습니다."
  );
  expect(mutationBodies[1]).toEqual({
    action: "detach",
    attributionId,
    explicitUserConfirmation: true
  });
});

function projection(
  override: Partial<ManagedCodexPublicRun> = {}
): ManagedCodexRunsReadyResponse {
  const run: ManagedCodexPublicRun = {
    managedRunId: `managed_run_${"a".repeat(32)}`,
    bindingId: `binding_${"b".repeat(32)}`,
    executionId: `codex:execution:${"c".repeat(24)}`,
    lifecycle: "observing",
    streamState: "connected",
    continuity: "continuous",
    effectiveExecutionState: "running",
    lastVerifiedExecutionState: "running",
    waitingState: null,
    sourceEvent: "item_started",
    itemType: "command_execution",
    lastObservedAt: OBSERVED_AT,
    liveObservationAvailable: true,
    forbiddenAsAttentionCandidate: true,
    ...override
  };
  return managedProjectionForRun(run);
}

function managedProjectionForRun(
  run: ManagedCodexPublicRun
): ManagedCodexRunsReadyResponse {
  const revision = managedRevision(run);
  return {
    status: "ready",
    contract: "codex-managed-public-projection-v1",
    revision,
    generatedAt: OBSERVED_AT,
    runs: [run],
    semantics: semanticProjection(run, revision)
  };
}

function managedRevision(run: ManagedCodexPublicRun): number {
  return run.sourceEvent === "turn_started"
    ? 4
    : run.sourceEvent === "stream_reconnected"
      ? 3
      : run.streamState === "disconnected"
        ? 2
        : 1;
}

function workRelationProjection(
  run: ManagedCodexPublicRun,
  relationOverride: Partial<ManagedCodexWorkRelation> = {}
): WorkRelationsReadyResponse {
  const managed = managedProjectionForRun(run);
  const relation: ManagedCodexWorkRelation = {
    relationId: `relation_${"1".repeat(32)}`,
    managedRunIds: [run.managedRunId],
    bindingId: run.bindingId,
    type: "executes",
    authority: "user_configured",
    from: {
      kind: "execution",
      source: "codex",
      subjectId: run.executionId
    },
    to: {
      kind: "work_item",
      source: "github",
      subjectId: "github:object:42"
    },
    bindingEvidence: {
      bindingId: run.bindingId,
      boundAt: OBSERVED_AT,
      decisionSource: "explicit_user",
      bindingState: "active",
      supersededByBindingId: null
    },
    githubObservation: {
      status: "current",
      sourceSnapshotSha256: "2".repeat(64),
      signalIds: [`sig_${"3".repeat(32)}`],
      objectType: "issue",
      taskKind: "assigned_issue",
      number: 42,
      destinationUrl:
        "https://github.com/biadone/blabase/issues/42",
      sourceUpdatedAt: OBSERVED_AT,
      completeness: "complete"
    },
    projectAlignment: {
      status: "aligned",
      projectId: `project_${"4".repeat(32)}`,
      codexMappingDecisionId: `mapping_${"5".repeat(32)}`,
      githubMappingDecisionId: `mapping_${"6".repeat(32)}`
    },
    identityStatus: "resolved",
    conflictCodes: [],
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true,
    ...relationOverride
  };
  const projection = sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: OBSERVED_AT,
    managedSourceRevision: managed.revision,
    managedGeneratedAt: managed.generatedAt,
    bindingStoreRevision: 1,
    bindingStoreSha256: "7".repeat(64),
    contextRegistrySha256: "8".repeat(64),
    githubBatchSha256: "9".repeat(64),
    githubSourceSnapshotSha256: "2".repeat(64),
    totalManagedRunCount: 1,
    omittedManagedRunCount: 0,
    relations: [relation],
    runResolutions: [
      {
        managedRunId: run.managedRunId,
        bindingId: run.bindingId,
        executionId: run.executionId,
        status: "resolved",
        relationId: relation.relationId
      }
    ],
    inputSha256: "a".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
  const artifacts = emptyArtifactRelationProjection(
    projection.projectionSha256
  );
  const claims = deriveManagedCodexClaims({
    managedProjection: managed,
    managedSemantics: managed.semantics,
    workRelations: projection
  });
  return {
    status: "ready",
    ...projection,
    artifacts,
    claims: resolveClaimAuthority({
      asOf: OBSERVED_AT,
      dependencies: {
        workRelationProjectionSha256: projection.projectionSha256,
        artifactRelationProjectionSha256: artifacts.projectionSha256,
        githubBatchSha256: projection.githubBatchSha256,
        githubSourceSnapshotSha256:
          projection.githubSourceSnapshotSha256,
        managedSourceRevision: managed.revision,
        managedGeneratedAt: managed.generatedAt,
        managedSemanticProjectionSha256:
          managed.semantics.projectionSha256,
        contextRegistrySha256: projection.contextRegistrySha256
      },
      sourceCoverage: canonicalClaimCoverage({ github: "unavailable" }),
      claims
    })
  };
}

function emptyWorkRelationProjection(): WorkRelationsReadyResponse {
  const projection = sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: OBSERVED_AT,
    managedSourceRevision: 0,
    managedGeneratedAt: OBSERVED_AT,
    bindingStoreRevision: 0,
    bindingStoreSha256: "7".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    totalManagedRunCount: 0,
    omittedManagedRunCount: 0,
    relations: [],
    runResolutions: [],
    inputSha256: "a".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
  const artifacts = emptyArtifactRelationProjection(
    projection.projectionSha256
  );
  const semantics = emptySemanticProjection(0);
  return {
    status: "ready",
    ...projection,
    artifacts,
    claims: emptyClaimProjection(
      projection.projectionSha256,
      artifacts.projectionSha256,
      0,
      semantics.projectionSha256
    )
  };
}

function emptyClaimProjection(
  workRelationProjectionSha256: string,
  artifactRelationProjectionSha256: string,
  managedSourceRevision: number,
  managedSemanticProjectionSha256: string
) {
  return resolveClaimAuthority({
    asOf: OBSERVED_AT,
    dependencies: {
      workRelationProjectionSha256,
      artifactRelationProjectionSha256,
      githubBatchSha256: null,
      githubSourceSnapshotSha256: null,
      managedSourceRevision,
      managedGeneratedAt: OBSERVED_AT,
      managedSemanticProjectionSha256,
      contextRegistrySha256: null
    },
    sourceCoverage: canonicalClaimCoverage({ github: "unavailable" }),
    claims: []
  });
}

function workRelationsWithArtifacts(
  workRelations: WorkRelationsReadyResponse,
  artifacts: ManagedCodexArtifactRelationProjection
): WorkRelationsReadyResponse {
  return {
    ...workRelations,
    artifacts,
    claims: resolveClaimAuthority({
      asOf: workRelations.claims.asOf,
      dependencies: {
        ...workRelations.claims.inputs,
        workRelationProjectionSha256: workRelations.projectionSha256,
        artifactRelationProjectionSha256: artifacts.projectionSha256
      },
      sourceCoverage: workRelations.claims.sourceCoverage,
      claims: workRelations.claims.claims
    })
  };
}

function conflictingClaimProjection(
  workRelations: WorkRelationsReadyResponse
) {
  const managedClaim = workRelations.claims.claims.find(
    (claim) => claim.field === "managed_codex_execution_state"
  );
  if (!managedClaim) {
    throw new Error("Synthetic managed execution claim is missing.");
  }
  const claims = [
    managedClaim,
    createNormalizedWorkClaim({
      target: managedClaim.target,
      lineageRef: createClaimLineageRef({
        source: "codex_managed",
        syntheticObserver: "independent-e2e-observer"
      }),
      field: managedClaim.field,
      value: { type: "enum", value: "failed" },
      source: managedClaim.source,
      origin: managedClaim.origin,
      freshness: managedClaim.freshness,
      completeness: managedClaim.completeness,
      directness: managedClaim.directness,
      observedAt: managedClaim.observedAt,
      sourceUpdatedAt: managedClaim.sourceUpdatedAt,
      evidenceRefs: [
        createClaimEvidenceRef({
          source: "codex_managed",
          syntheticObserver: "independent-e2e-observer"
        })
      ],
      relationRefs: managedClaim.relationRefs
    })
  ];
  return resolveClaimAuthority({
    asOf: OBSERVED_AT,
    dependencies: workRelations.claims.inputs,
    sourceCoverage: workRelations.claims.sourceCoverage,
    claims
  });
}

function manyConflictProjection(
  workRelations: WorkRelationsReadyResponse
) {
  const relationRefs = workRelations.relations.map(
    (relation) => relation.relationId
  );
  const claims = [];

  for (let targetIndex = 0; targetIndex < 6; targetIndex += 1) {
    const target = {
      kind: "codex_execution" as const,
      ref: createClaimTargetRef({
        kind: "codex_execution",
        identity: {
          fixture: "managed-conflict-accessibility",
          targetIndex
        }
      })
    };
    const lineageRef = createClaimLineageRef({
      fixture: "managed-conflict-accessibility",
      targetIndex,
      observer: "primary"
    });
    claims.push(
      createNormalizedWorkClaim({
        target,
        lineageRef,
        field: "managed_codex_execution_state",
        value: { type: "enum", value: "running" },
        source: "codex_managed",
        origin: "managed_codex_event_stream",
        freshness: "current",
        completeness: "complete",
        directness: "explicit",
        observedAt: "2026-08-01T02:58:00.000Z",
        sourceUpdatedAt: "2026-08-01T02:58:00.000Z",
        evidenceRefs: [
          createClaimEvidenceRef({
            fixture: "managed-conflict-accessibility",
            targetIndex,
            value: "running"
          })
        ],
        relationRefs
      }),
      createNormalizedWorkClaim({
        target,
        lineageRef:
          targetIndex === 0
            ? createClaimLineageRef({
                fixture: "managed-conflict-accessibility",
                targetIndex,
                observer: "independent"
              })
            : lineageRef,
        field: "managed_codex_execution_state",
        value: { type: "enum", value: "failed" },
        source: "codex_managed",
        origin: "managed_codex_event_stream",
        freshness: "current",
        completeness: "complete",
        directness: "explicit",
        observedAt: "2026-08-01T02:59:00.000Z",
        sourceUpdatedAt: "2026-08-01T02:59:00.000Z",
        evidenceRefs: [
          createClaimEvidenceRef({
            fixture: "managed-conflict-accessibility",
            targetIndex,
            value: "failed"
          })
        ],
        relationRefs
      })
    );
  }

  return resolveClaimAuthority({
    asOf: OBSERVED_AT,
    dependencies: workRelations.claims.inputs,
    sourceCoverage: workRelations.claims.sourceCoverage,
    claims
  });
}

function staleGitHubConflictProjection(
  workRelations: WorkRelationsReadyResponse
) {
  const relation = workRelations.relations[0];
  if (!relation) throw new Error("Synthetic work relation is missing.");
  const target = {
    kind: "github_work_item" as const,
    ref: createClaimTargetRef({
      kind: "github_work_item",
      identity: {
        relationId: relation.relationId,
        equivalence: "bound_github_native_identity"
      }
    })
  };
  const common = {
    target,
    field: "github_work_item_state" as const,
    source: "github" as const,
    origin: "github_normalized_snapshot" as const,
    freshness: "stale" as const,
    completeness: "complete" as const,
    directness: "explicit" as const,
    observedAt: "2026-08-01T02:59:00.000Z",
    sourceUpdatedAt: "2026-08-01T02:59:00.000Z",
    relationRefs: [relation.relationId]
  };
  const claims = [
    createNormalizedWorkClaim({
      ...common,
      lineageRef: createClaimLineageRef({
        fixture: "stale-github-conflict",
        observer: "snapshot-a"
      }),
      value: { type: "enum", value: "open" },
      evidenceRefs: [
        createClaimEvidenceRef({
          fixture: "stale-github-conflict",
          observer: "snapshot-a"
        })
      ]
    }),
    createNormalizedWorkClaim({
      ...common,
      lineageRef: createClaimLineageRef({
        fixture: "stale-github-conflict",
        observer: "snapshot-b"
      }),
      value: { type: "enum", value: "completed" },
      evidenceRefs: [
        createClaimEvidenceRef({
          fixture: "stale-github-conflict",
          observer: "snapshot-b"
        })
      ]
    })
  ];

  return resolveClaimAuthority({
    asOf: OBSERVED_AT,
    dependencies: workRelations.claims.inputs,
    sourceCoverage: canonicalClaimCoverage({ github: "stale" }),
    claims
  });
}

function emptyArtifactRelationProjection(
  workRelationProjectionSha256: string
): ManagedCodexArtifactRelationProjection {
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: OBSERVED_AT,
    workRelationProjectionSha256,
    attributionStoreRevision: 0,
    attributionStoreSha256: "b".repeat(64),
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    totalAttachDecisionCount: 0,
    unresolvedAttributionCount: 0,
    relations: [],
    inputSha256: "c".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function artifactRelationProjection(input: {
  run: ManagedCodexPublicRun;
  executesRelation: ManagedCodexWorkRelation;
  workRelationProjectionSha256: string;
  entries: Array<{
    artifact: GitHubArtifactIdentity;
    executesRelationId?: string;
  }>;
}): ManagedCodexArtifactRelationProjection {
  const relations = input.entries.map(
    ({ artifact, executesRelationId }, index): ManagedCodexArtifactRelation => {
      const relationId =
        executesRelationId ?? input.executesRelation.relationId;
      const attributionCore = {
        action: "attach" as const,
        managedRunId: input.run.managedRunId,
        bindingId: input.run.bindingId,
        executionId: input.run.executionId,
        executesRelationId: relationId,
        artifact,
        decidedAt: OBSERVED_AT,
        decisionSource: "explicit_user" as const,
        supersedesAttributionId: null
      };
      const attributionId =
        createWorkArtifactAttributionId(attributionCore);
      const artifactId = createGitHubArtifactId(artifact);
      return {
        relationId: createManagedCodexArtifactRelationId({
          attributionId,
          executionId: input.run.executionId,
          artifactId
        }),
        managedRunId: input.run.managedRunId,
        bindingId: input.run.bindingId,
        executionId: input.run.executionId,
        executesRelationId: relationId,
        attributionId,
        type: "produces",
        authority: "user_configured",
        artifactId,
        artifact,
        attributionEvidence: {
          decidedAt: attributionCore.decidedAt,
          decisionSource: "explicit_user",
          identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION
        },
        attributionLifecycle: {
          state: "active",
          supersededByAttributionId: null
        },
        githubObservation:
          artifact.kind === "github_pull_request"
            ? {
                status: "current",
                sourceSnapshotSha256: "d".repeat(64),
                signalIds: [
                  `sig_${(index + 1).toString(16).repeat(32).slice(0, 32)}`
                ],
                destinationUrl: null,
                sourceUpdatedAt: attributionCore.decidedAt,
                completeness: "complete"
              }
            : {
                status: "not_observed",
                sourceSnapshotSha256: "d".repeat(64),
                signalIds: [],
                destinationUrl: null,
                sourceUpdatedAt: null,
                completeness: "complete"
              },
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true
      };
    }
  );
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: OBSERVED_AT,
    workRelationProjectionSha256: input.workRelationProjectionSha256,
    attributionStoreRevision: relations.length,
    attributionStoreSha256: "e".repeat(64),
    githubBatchSha256: "f".repeat(64),
    githubSourceSnapshotSha256: "d".repeat(64),
    totalAttachDecisionCount: relations.length,
    unresolvedAttributionCount: 0,
    relations,
    inputSha256: "a".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function emptySemanticProjection(
  sourceRevision: number
): ManagedCodexSemanticProjection {
  return buildManagedCodexSemanticProjection({
    sourceRevision,
    generatedAt: OBSERVED_AT,
    runs: []
  });
}

function semanticProjection(
  run: ManagedCodexPublicRun,
  sourceRevision: number
): ManagedCodexSemanticProjection {
  return buildManagedCodexSemanticProjection({
    sourceRevision,
    generatedAt: OBSERVED_AT,
    runs: [
      {
        run,
        history: semanticHistory(run)
      }
    ]
  });
}

function semanticHistory(
  run: ManagedCodexPublicRun
): ManagedCodexEventHistory {
  const native =
    run.sourceEvent === "item_started" ||
    run.sourceEvent === "turn_started";
  const observation = native
    ? observeCodexManagedNotification({
        notification:
          run.sourceEvent === "turn_started"
            ? {
                method: "turn/started",
                params: {
                  threadId: "synthetic-thread",
                  turn: { id: "synthetic-turn", status: "inProgress" }
                }
              }
            : {
                method: "item/started",
                params: {
                  threadId: "synthetic-thread",
                  turnId: "synthetic-turn",
                  item: {
                    id: "synthetic-item",
                    type: "commandExecution"
                  }
                }
              },
        executionId: run.executionId.slice(
          "codex:execution:".length
        ),
        expectedThreadId: "synthetic-thread",
        observedAt: OBSERVED_AT,
        sequence: 0
      })
    : null;
  const event = createManagedCodexEvent({
    managedRunId: run.managedRunId,
    sequence: 0,
    ownerInstanceId: `instance_${"d".repeat(32)}`,
    streamGeneration: `stream_${"e".repeat(32)}`,
    observedAt: OBSERVED_AT,
    retentionAt: OBSERVED_AT,
    kind: native ? "native_notification" : "stream_lifecycle",
    streamKind:
      run.sourceEvent === "stream_disconnected" ||
      run.sourceEvent === "stream_reconnected"
        ? run.sourceEvent
        : null,
    observation,
    itemType:
      run.sourceEvent === "item_started"
        ? "command_execution"
        : null,
    previousEventSha256: null
  });
  return sealManagedCodexHistory({
    contract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
    managedRunId: run.managedRunId,
    updatedAt: OBSERVED_AT,
    anchor: null,
    events: [event]
  });
}

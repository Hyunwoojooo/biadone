import type {
  ActiveAttentionCandidate,
  ActiveAttentionResult
} from "../attentionDecision";
import type {
  AttentionMonitorRun
} from "../attention/monitoringSchema";
import type { Phase2AttentionResult } from "../crossSource/attentionSchema";
import type {
  WorkResumptionStatus,
  WorkSessionBinding
} from "../resumption";
import {
  LAUNCHER_ATTENTION_CONTRACT,
  launcherAttentionProjectionSchema,
  type LauncherAttentionProjection,
  type LauncherPrimaryAction
} from "./contracts";

export type LauncherProjectionInput = {
  result: ActiveAttentionResult;
  baseResult: Phase2AttentionResult;
  run: AttentionMonitorRun;
  resumption: WorkResumptionStatus;
};

export type LauncherExecutionGuard =
  | {
      kind: "focus_or_resume";
      enabled: boolean;
      expectedBindingId: string | null;
      expectedExecutionId: string | null;
    }
  | { kind: "open_github" }
  | { kind: "none" };

export type LauncherAttentionView = {
  projection: LauncherAttentionProjection;
  executionGuard: LauncherExecutionGuard;
};

export function projectAttentionForLauncher(
  input: LauncherProjectionInput
): LauncherAttentionProjection {
  return buildLauncherAttentionView(input).projection;
}

export function buildLauncherAttentionView(
  input: LauncherProjectionInput
): LauncherAttentionView {
  const suggestion = input.result.decision.topSuggestion;
  const action = suggestion
    ? resolvePrimaryAction(suggestion, input.resumption)
    : { publicAction: null, guard: { kind: "none" as const } };
  const card = suggestion
    ? {
        candidateId: suggestion.candidateId,
        title: suggestion.title,
        contextLabel: `${suggestion.repositoryFullName} #${suggestion.number}`,
        laneLabel: launcherLaneLabel(suggestion.lane),
        certainty: suggestion.certainty,
        whyNowText: suggestion.whyNowReasonCodes.map(
          launcherWhyNowLabel
        ),
        explanation: suggestion.explanation,
        firstStep: suggestion.firstStep,
        dueAt: suggestion.dueAt,
        primaryAction: action.publicAction as LauncherPrimaryAction
      }
    : null;

  const projection = launcherAttentionProjectionSchema.parse({
    contract: LAUNCHER_ATTENTION_CONTRACT,
    resultId: input.result.resultId,
    asOf: input.result.asOf,
    decisionStatus: input.result.decision.status,
    card,
    clarificationQuestion:
      input.result.decision.clarification?.question ?? null,
    scopeStatement: input.result.decision.scopeStatement,
    unavailableSources: unavailableSources(input),
    dashboardPath: "/"
  });

  return { projection, executionGuard: action.guard };
}

function resolvePrimaryAction(
  suggestion: ActiveAttentionCandidate,
  resumption: WorkResumptionStatus
): {
  publicAction: LauncherPrimaryAction;
  guard: LauncherExecutionGuard;
} {
  const binding = findTaskBinding(suggestion, resumption.bindings);
  if (suggestion.triggerSource === "codex_managed") {
    const exact =
      binding !== null &&
      binding.bindingId === suggestion.bindingId &&
      binding.executionId === suggestion.executionId;
    return exact
      ? focusAction(binding, resumption.companion.state === "online")
      : {
          publicAction: {
            kind: "focus_or_resume",
            enabled: false
          },
          guard: {
            kind: "focus_or_resume",
            enabled: false,
            expectedBindingId: null,
            expectedExecutionId: null
          }
        };
  }
  if (binding) {
    return focusAction(
      binding,
      resumption.companion.state === "online"
    );
  }
  return {
    publicAction: {
      kind: "open_github",
      url: safeGitHubDestination(suggestion)
    },
    guard: { kind: "open_github" }
  };
}

function focusAction(
  binding: WorkSessionBinding,
  enabled: boolean
): {
  publicAction: LauncherPrimaryAction;
  guard: LauncherExecutionGuard;
} {
  return {
    publicAction: { kind: "focus_or_resume", enabled },
    guard: {
      kind: "focus_or_resume",
      enabled,
      expectedBindingId: binding.bindingId,
      expectedExecutionId: binding.executionId
    }
  };
}

function findTaskBinding(
  suggestion: ActiveAttentionCandidate,
  bindings: WorkSessionBinding[]
): WorkSessionBinding | null {
  return (
    bindings.find(
      (binding) =>
        binding.taskRef.kind === "attention_subject" &&
        binding.taskRef.source === "github" &&
        binding.taskRef.subjectId === suggestion.githubSubjectId
    ) ?? null
  );
}

function unavailableSources(
  input: LauncherProjectionInput
): Array<"github" | "codex" | "notion" | "google_calendar"> {
  const unavailable = new Set<
    "github" | "codex" | "notion" | "google_calendar"
  >();
  for (const source of input.run.sources) {
    if (
      source.inputState !== "available" ||
      source.freshness === "invalid"
    ) {
      unavailable.add(source.source);
    }
  }
  for (const source of input.baseResult.coverage.unevaluatedSources) {
    unavailable.add(source);
  }
  const order = [
    "github",
    "codex",
    "notion",
    "google_calendar"
  ] as const;
  return order.filter((source) => unavailable.has(source));
}

function safeGitHubDestination(
  suggestion: ActiveAttentionCandidate
): string {
  const url = new URL(suggestion.destinationUrl);
  const objectPath =
    suggestion.taskKind === "assigned_issue" ? "issues" : "pull";
  const expectedPath = `/${suggestion.repositoryFullName}/${objectPath}/${suggestion.number}`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== expectedPath
  ) {
    throw new TypeError("UNSAFE_GITHUB_DESTINATION");
  }
  return url.toString();
}

function launcherWhyNowLabel(
  code: ActiveAttentionCandidate["whyNowReasonCodes"][number]
): string {
  switch (code) {
    case "WHY_NOW_NATIVE_DEADLINE_DUE_SOON":
      return "48시간 안의 GitHub 마감";
    case "WHY_NOW_NATIVE_DEADLINE_OVERDUE":
      return "GitHub 마감일이 지남";
    case "WHY_NOW_REVIEW_REQUEST_OPEN":
      return "리뷰 요청이 확인됨";
    case "WHY_NOW_ASSIGNED_WORK_OPEN":
      return "열린 할당 작업이 확인됨";
    case "WHY_NOW_MANAGED_FAILURE_CURRENT":
      return "현재 Codex 실행 실패가 확인됨";
    case "WHY_NOW_CONFIGURED_HANDOFF_OPEN":
      return "설정한 완료 후속 작업이 남음";
    case "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH":
      return "이번 주 결과와 직접 연결됨";
  }
}

function launcherLaneLabel(
  lane: ActiveAttentionCandidate["lane"]
): string {
  switch (lane) {
    case "must_now":
      return "지금 확인";
    case "unblock":
      return "진행 해제";
    case "close_loop":
      return "마무리";
    case "focus":
      return "집중";
  }
}

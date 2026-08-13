"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  AttentionApiResponse,
  AttentionFeedbackType,
  AttentionReadyResponse,
  AttentionSourceMonitor
} from "../src/attention/monitoringSchema";
import type { ActiveAttentionCandidate } from "../src/attentionDecision";
import type { Phase2CodexOverviewItem } from "../src/crossSource/attentionSchema";
import type { RecentWorkPublicSummary } from "../src/recentWork";
import type { SemanticContinuationWorkBoardResponse } from "../src/semanticContinuation/contracts";
import {
  fetchAttention,
  fetchDisplayOnlyWorkBoard,
  submitAttentionFeedback
} from "./attentionClient";
import { ManagedCodexProgress } from "./ManagedCodexProgress";
import { recordProjectWorkflowClosure } from "./projectWorkflowsClient";
import { syncInvalidationBus } from "./sync/invalidationBus";
import {
  useSourceSyncRuntime,
  useSyncInvalidation,
  useVisiblePolling,
  wakeSourceSyncStatus
} from "./sync/useSourceSync";
import {
  bindWorkSession,
  fetchWorkResumption,
  openWorkSession,
  unbindWorkSession,
  WorkResumptionRequestError,
  type WorkResumptionApiResponse,
  type WorkResumptionCommand,
  type WorkResumptionReadyResponse,
  type WorkResumptionTaskIdentity,
  type WorkResumptionTaskRef
} from "./workResumptionClient";
import { WorkSuggestionBoardPanel } from "./WorkSuggestionBoardPanel";

const feedbackOptions: Array<{
  value: AttentionFeedbackType;
  label: string;
}> = [
  { value: "helpful", label: "적절함" },
  { value: "wrong_priority", label: "우선순위 아님" },
  { value: "already_done", label: "이미 끝남" },
  { value: "not_mine", label: "내 일이 아님" },
  { value: "insufficient_context", label: "근거 부족" }
];

export function createMonotonicRequestGate() {
  let current = 0;
  return {
    begin(): number {
      current += 1;
      return current;
    },
    isCurrent(sequence: number): boolean {
      return sequence === current;
    }
  };
}

export async function loadWorkCockpitRequest(input: {
  refreshSources: boolean;
  loadAttention: typeof fetchAttention;
  loadWorkBoard: typeof fetchDisplayOnlyWorkBoard;
  onBoardSettled?: (
    result: PromiseSettledResult<SemanticContinuationWorkBoardResponse>
  ) => void;
}) {
  const attentionPromise = input.loadAttention(input.refreshSources);
  const boardPromise = input.refreshSources
    ? attentionPromise.then(() => input.loadWorkBoard())
    : input.loadWorkBoard();
  const boardSettled = settle(boardPromise).then((result) => {
    input.onBoardSettled?.(result);
    return result;
  });
  const [attention, board] = await Promise.all([
    settle(attentionPromise),
    boardSettled
  ]);
  return { attention, board };
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason })
  );
}

export function displayBoardStateFromResult(
  result: PromiseSettledResult<SemanticContinuationWorkBoardResponse>
): {
  response: SemanticContinuationWorkBoardResponse | null;
  error: string | null;
} {
  return result.status === "fulfilled"
    ? { response: result.value, error: null }
    : {
        response: null,
        error: "작업 제안을 불러오지 못했습니다."
      };
}

export function WorkCockpit({
  loadAttention = fetchAttention,
  loadWorkBoard = fetchDisplayOnlyWorkBoard
}: {
  loadAttention?: typeof fetchAttention;
  loadWorkBoard?: typeof fetchDisplayOnlyWorkBoard;
} = {}) {
  const [payload, setPayload] = useState<AttentionApiResponse | null>(
    null
  );
  const [workBoard, setWorkBoard] =
    useState<SemanticContinuationWorkBoardResponse | null>(null);
  const [workBoardError, setWorkBoardError] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] =
    useState(false);
  const [selectedFeedback, setSelectedFeedback] =
    useState<AttentionFeedbackType | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(
    null
  );
  const requestGate = useRef(createMonotonicRequestGate());
  const interactiveSequenceRef = useRef<number | null>(null);
  const suppressOwnManualInvalidationRef = useRef(false);
  useSourceSyncRuntime();

  const load = useCallback(
    async (
      refreshSources = false,
      silent = false
    ): Promise<boolean> => {
      if (silent && interactiveSequenceRef.current !== null) {
        return false;
      }
      const sequence = requestGate.current.begin();
      if (!silent) {
        interactiveSequenceRef.current = sequence;
        refreshSources ? setIsRefreshing(true) : setIsLoading(true);
        setFeedbackMessage(null);
      }
      try {
        const { attention: attentionResult } =
          await loadWorkCockpitRequest({
            refreshSources,
            loadAttention,
            loadWorkBoard,
            onBoardSettled: (result) => {
              if (!requestGate.current.isCurrent(sequence)) return;
              const nextWorkBoard = displayBoardStateFromResult(result);
              setWorkBoard(nextWorkBoard.response);
              setWorkBoardError(nextWorkBoard.error);
            }
          });
        if (!requestGate.current.isCurrent(sequence)) return false;
        if (attentionResult.status === "rejected") {
          if (!silent) {
            setPayload({
              status: "error",
              code: "NETWORK_ERROR",
              message:
                "Work Cockpit에 연결하지 못했습니다. 로컬 서버 상태를 확인해주세요."
            });
          }
          return false;
        }
        const next = attentionResult.value;
        setPayload(next);
        if (!silent) setSelectedFeedback(null);
        return next.status !== "error";
      } catch {
        if (!requestGate.current.isCurrent(sequence)) return false;
        setWorkBoard(null);
        setWorkBoardError("작업 제안을 불러오지 못했습니다.");
        if (!silent) {
          setPayload({
            status: "error",
            code: "NETWORK_ERROR",
            message:
              "Work Cockpit에 연결하지 못했습니다. 로컬 서버 상태를 확인해주세요."
          });
        }
        return false;
      } finally {
        if (
          !silent &&
          interactiveSequenceRef.current === sequence
        ) {
          interactiveSequenceRef.current = null;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [loadAttention, loadWorkBoard]
  );

  const refreshSources = useCallback(async () => {
    const updated = await load(true);
    if (!updated) return;
    suppressOwnManualInvalidationRef.current = true;
    syncInvalidationBus.invalidate({
      reason: "manual_refresh",
      targets: ["github", "codex", "attention", "timeline"]
    });
    wakeSourceSyncStatus();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useSyncInvalidation(["attention"], (event) => {
    if (
      suppressOwnManualInvalidationRef.current &&
      event.reason === "manual_refresh"
    ) {
      suppressOwnManualInvalidationRef.current = false;
      return;
    }
    void load(false, true);
  });

  useVisiblePolling(() => load(false, true), {
    intervalMs: 30_000,
    maxBackoffMs: 120_000,
    runImmediately: false
  });

  async function recordFeedback(feedbackType: AttentionFeedbackType) {
    if (
      payload?.status !== "ready" ||
      payload.monitoring.state !== "recorded" ||
      isFeedbackSubmitting
    ) {
      return;
    }
    setIsFeedbackSubmitting(true);
    setFeedbackMessage("피드백 기록 중");
    try {
      const response = await submitAttentionFeedback({
        runId: payload.run.runId,
        feedbackType
      });
      if (response.status === "recorded") {
        setSelectedFeedback(response.feedback.feedbackType);
        setFeedbackMessage(
          "평가 후보로 기록했습니다. 자동으로 학습 데이터가 되지는 않습니다."
        );
      } else {
        setFeedbackMessage(response.message);
      }
    } catch {
      setFeedbackMessage("피드백을 기록하지 못했습니다.");
    } finally {
      setIsFeedbackSubmitting(false);
    }
  }

  return (
    <section
      className="attentionCockpit"
      aria-labelledby="attention-title"
      aria-busy={isLoading || isRefreshing}
    >
      <div className="attentionHeader">
        <div>
          <div className="attentionKickerRow">
            <p className="attentionTitleSignal">
              <span aria-hidden="true" />
              Work Cockpit
            </p>
            <span>Beta · 확인 전에는 실행하지 않음</span>
          </div>
          <h2 id="attention-title">작업 제안과 기존 판정을 확인하세요.</h2>
          <p>
            Work Board 제안과 기존 Active Attention 진단을 분리해 표시합니다.
          </p>
        </div>
        <button
          className="attentionRefreshButton"
          type="button"
          onClick={() => void refreshSources()}
          disabled={isLoading || isRefreshing}
        >
          {isRefreshing
            ? "소스 갱신 중"
            : "새로고침"}
        </button>
      </div>

      {isLoading && payload === null ? (
        <div className="attentionLoading" role="status">
          저장된 연결 소스 상태를 평가하고 있습니다.
        </div>
      ) : null}

      <WorkSuggestionBoardPanel
        response={workBoard}
        loadError={workBoardError}
        loading={isLoading}
      />

      <header className="activeAttentionDiagnosticHeader">
        <p className="eyebrow">Diagnostic</p>
        <h2>기존 Active Attention 판정</h2>
        <p>기존 평가 결과와 연결 상태를 별도 진단 정보로 유지합니다.</p>
      </header>

      {payload?.status === "unavailable" ? (
        <div className="attentionState attentionState-neutral">
          <h3>로컬 Work Cockpit에서 확인할 수 있습니다.</h3>
          <p>{payload.message}</p>
          <a href={payload.localUrl}>로컬 주소로 열기</a>
        </div>
      ) : null}

      {payload?.status === "error" ? (
        <div className="attentionState attentionState-error" role="alert">
          <h3>현재 결과를 불러오지 못했습니다.</h3>
          <p>{payload.message}</p>
          <button type="button" onClick={() => void load()}>
            다시 확인
          </button>
        </div>
      ) : null}

      {payload?.status === "ready" ? (
        <CockpitResult
          payload={payload}
          selectedFeedback={selectedFeedback}
          feedbackMessage={feedbackMessage}
          isFeedbackSubmitting={isFeedbackSubmitting}
          onFeedback={(value) => void recordFeedback(value)}
        />
      ) : null}
    </section>
  );
}

function CockpitResult({
  payload,
  selectedFeedback,
  feedbackMessage,
  isFeedbackSubmitting,
  onFeedback
}: {
  payload: AttentionReadyResponse;
  selectedFeedback: AttentionFeedbackType | null;
  feedbackMessage: string | null;
  isFeedbackSubmitting: boolean;
  onFeedback: (value: AttentionFeedbackType) => void;
}) {
  const { result, baseResult, run } = payload;
  const feedbackEnabled = payload.monitoring.state === "recorded";
  return (
    <>
      <p className="attentionAsOf">
        기존 Active Attention 판정{" "}
        <time dateTime={result.asOf}>{formatTimestamp(result.asOf)}</time>
        {" · "}
        {run.latencyMs.toLocaleString("ko-KR")}ms
      </p>

      <CurrentFocusCard payload={payload} />

      <RecentWorkCard summary={payload.recentWork ?? null} />

      <section className="nextAttentionSection" aria-label="Next Attention">
        <div className="workFlowSectionHeader">
          <div>
            <p className="eyebrow">Next Attention</p>
            <h3>다음에 직접 확인할 일</h3>
          </div>
          <span>기존 권위·자격 판정 유지</span>
        </div>

        <AttentionDecision
          status={result.decision.status}
          suggestion={result.decision.topSuggestion}
          alternatives={result.decision.alternatives}
          clarification={result.decision.clarification}
          scopeStatement={result.decision.scopeStatement}
          certainty={result.decision.certainty}
          currentFocus={payload.currentFocus}
          reasonCodes={result.decision.reasonCodes}
        />

        <AttentionReviewDisclosure assessments={result.assessments} />

        {result.decision.status === "suggested" &&
        result.decision.topSuggestion ? (
          <WorkResumption
            suggestion={result.decision.topSuggestion}
            codexItems={baseResult.workCockpit.codexExecutions}
          />
        ) : null}

        {result.decision.topSuggestion?.triggerKind ===
        "configured_follow_through" ? (
          <WorkflowFollowThroughActions
            suggestion={result.decision.topSuggestion}
          />
        ) : null}
      </section>

      <AttentionStatusStrip payload={payload} />

      <ManagedCodexProgress />

      <SourceHealthGrid
        sources={run.sources}
        supportingContext={baseResult.workCockpit.supportingContext}
      />
      <CodexOverview items={baseResult.workCockpit.codexExecutions} />

      <div
        className="attentionFeedback"
        role="group"
        aria-label="이번 결과 평가"
        aria-busy={isFeedbackSubmitting}
      >
        <p>이 결과가 실제 상황과 맞나요?</p>
        <div>
          {feedbackOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                selectedFeedback === option.value ? "isSelected" : ""
              }
              aria-pressed={selectedFeedback === option.value}
              disabled={!feedbackEnabled || isFeedbackSubmitting}
              onClick={() => onFeedback(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {feedbackMessage ? (
          <span role="status">{feedbackMessage}</span>
        ) : !feedbackEnabled ? (
          <span>
            연결된 소스 새로고침 후 평가를 실행하면 피드백을 남길 수
            있습니다.
          </span>
        ) : null}
      </div>

      <details className="attentionDiagnostics">
        <summary>판단 범위와 엔진 정보</summary>
        <div className="attentionDiagnosticsGrid">
          <DiagnosticGroup
            title="결정"
            values={[
              ...result.decision.reasonCodes,
              ...result.decision.caveatCodes
            ]}
          />
          <DiagnosticGroup
            title="Coverage"
            values={[
              `GITHUB_${result.coverage.githubCandidateCoverage.toUpperCase()}`,
              `MANAGED_CODEX_${result.coverage.managedCodexCoverage.toUpperCase()}`,
              result.coverage.negativeCandidateCoverageComplete
                ? "NEGATIVE_COVERAGE_COMPLETE"
                : "NEGATIVE_COVERAGE_LIMITED"
            ]}
          />
          <dl>
            <div>
              <dt>후보</dt>
              <dd>
                통과 {run.candidateCounts.eligible} · 검토{" "}
                {"reviewRequired" in run.candidateCounts
                  ? run.candidateCounts.reviewRequired
                  : run.candidateCounts.provisional} · 제외{" "}
                {run.candidateCounts.ineligible}
              </dd>
            </div>
            <div>
              <dt>정책</dt>
              <dd>{result.policyVersion}</dd>
            </div>
            <div>
              <dt>Result ID</dt>
              <dd className="monoValue">{result.resultId}</dd>
            </div>
          </dl>
        </div>
      </details>

      {payload.monitoring.state === "degraded" ? (
        <p className="attentionWarning" role="status">
          현재 결과는 표시했지만 실행 history에는 기록하지 못했습니다.
        </p>
      ) : null}
      {payload.monitoring.state === "preview" ? (
        <p className="attentionWarning" role="status">
          저장된 snapshot을 미리 본 결과입니다. History에는 새 평가 실행만
          기록합니다.
        </p>
      ) : null}

      <Link className="attentionLabLink" href="/attention-lab">
        Attention Lab에서 실행 기록과 근거 자세히 보기
      </Link>
    </>
  );
}

export function RecentWorkCard({
  summary
}: {
  summary: RecentWorkPublicSummary | null;
}) {
  if (summary === null) return null;
  return (
    <section className="recentWorkCard" aria-labelledby="recent-work-title">
      <div className="workFlowSectionHeader">
        <div>
          <p className="eyebrow">Recent Work</p>
          <h3 id="recent-work-title">{summary.displayLabel}</h3>
        </div>
        <span>표시 전용</span>
      </div>
      <div className="recentWorkSignal">
        <div>
          <span>최근 push</span>
          <time dateTime={summary.pushOccurredAt}>
            {formatTimestamp(summary.pushOccurredAt)}
          </time>
        </div>
        <div>
          <span>로컬 추적 상태</span>
          <strong>{recentWorkTrackingLabel(summary)}</strong>
        </div>
      </div>
      <p className="recentWorkBoundary">
        검증된 GitHub push를 최근 작업 맥락으로만 표시합니다. 우선순위나
        처리 필요성을 단정하지 않으며 추천 순위나 실행에는 영향을 주지
        않습니다.
      </p>
    </section>
  );
}

function recentWorkTrackingLabel(summary: RecentWorkPublicSummary): string {
  switch (summary.trackingState) {
    case "in_sync":
      return "동기화됨";
    case "ahead":
      return `로컬 +${summary.aheadCount ?? 0}`;
    case "behind":
      return `원격 추적 +${summary.behindCount ?? 0}`;
    case "diverged":
      return `분기됨 · 로컬 ${summary.aheadCount ?? 0} / 추적 ${summary.behindCount ?? 0}`;
    case "not_configured":
      return "upstream 미설정";
  }
}

function CurrentFocusCard({
  payload
}: {
  payload: AttentionReadyResponse;
}) {
  const projection = payload.currentFocus;
  const focus = projection.selectedFocus;
  if (projection.status !== "selected" || focus === null) {
    return (
      <section
        className="currentFocusCard currentFocusCard-unresolved"
        aria-labelledby="current-focus-title"
      >
        <div className="workFlowSectionHeader">
          <div>
            <p className="eyebrow">Current Focus</p>
            <h3 id="current-focus-title">
              현재 작업 흐름을 확정하지 않았습니다.
            </h3>
          </div>
          <span>
            {projection.status === "unavailable"
              ? "근거 확인 불가"
              : "안전하게 보류"}
          </span>
        </div>
        <p className="currentFocusBoundary">
          {projection.reasonCodes.map(currentFocusReasonLabel).join(" · ")}
        </p>
        <p className="currentFocusFootnote">
          Current Focus가 없어도 검증된 Next Attention 결과는 그대로
          유지합니다.
        </p>
      </section>
    );
  }

  const workstream = payload.currentWorkstreams?.workstreams.find(
    (item) => item.workstreamId === focus.workstreamId
  );
  const eventById = new Map(
    (payload.recentMeaningfulEvents?.events ?? []).map((event) => [
      event.eventId,
      event
    ])
  );
  const historicalEvents = (workstream?.historicalEventRefs ?? [])
    .map((eventId) => eventById.get(eventId))
    .filter(
      (
        event
      ): event is NonNullable<
        AttentionReadyResponse["recentMeaningfulEvents"]
      >["events"][number] => event !== undefined
    );
  const latest = focus.latestMeaningfulEvent;
  return (
    <section
      className="currentFocusCard"
      aria-labelledby="current-focus-title"
    >
      <div className="workFlowSectionHeader">
        <div>
          <p className="eyebrow">Current Focus</p>
          <h3 id="current-focus-title">{focus.displayLabel}</h3>
        </div>
        <span>
          {focus.level === "exact_task" ? "정확한 작업 연결" : "프로젝트 범위"}
        </span>
      </div>
      <div className="currentFocusLatest">
        <span
          className={`attentionSourceBadge ${
            latest.source === "github" ? "isGitHub" : "isCodex"
          }`}
        >
          <i aria-hidden="true" />
          {focusSourceLabel(latest.source)}
        </span>
        <div>
          <strong>{focusEventLabel(latest.kind)}</strong>
          <time dateTime={latest.occurredAt}>
            {formatTimestamp(latest.occurredAt)}
          </time>
        </div>
      </div>
      <dl className="currentFocusMeta">
        <div>
          <dt>현재 단계</dt>
          <dd>{focusStateLabel(focus.authoritativeState)}</dd>
        </div>
        <div>
          <dt>데이터 상태</dt>
          <dd>{focusCurrentnessLabel(focus.currentness)}</dd>
        </div>
        <div>
          <dt>복원 확신도</dt>
          <dd>{focusConfidenceLabel(focus.reconstructionConfidence)}</dd>
        </div>
        <div>
          <dt>Blocker</dt>
          <dd>{focusBlockerLabel(focus.activeBlocker)}</dd>
        </div>
      </dl>
      <p className="currentFocusBoundary">
        최근 의미 이벤트를 현재 Focus 복원에 사용했습니다. 이 값은 새 추천
        후보를 만들지 않습니다.
      </p>
      {historicalEvents.length > 0 ? (
        <details className="currentFocusHistory">
          <summary>이 작업 흐름의 과거 이벤트 {historicalEvents.length}개</summary>
          <ol>
            {historicalEvents.map((event) => (
              <li key={event.eventId}>
                <div>
                  <strong>{focusEventLabel(event.kind)}</strong>
                  <span>{event.displayLabel}</span>
                </div>
                <time dateTime={event.occurredAt}>
                  {formatTimestamp(event.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function currentFocusReasonLabel(
  reason: AttentionReadyResponse["currentFocus"]["reasonCodes"][number]
): string {
  const labels: Record<typeof reason, string> = {
    FOCUS_EXPLICIT_USER_CONFIRMATION: "사용자가 확인한 Focus",
    FOCUS_LATEST_DIRECT_COMPLETE_EVENT: "최신 직접 이벤트",
    FOCUS_PROJECT_LEVEL_ONLY: "프로젝트 수준 근거만 있음",
    FOCUS_NO_MEANINGFUL_EVENT: "최근 의미 이벤트 없음",
    FOCUS_EVENT_OUTSIDE_RECENT_WINDOW: "최근성 범위 밖의 이벤트",
    FOCUS_SOURCE_STALE: "소스가 오래됨",
    FOCUS_SOURCE_PARTIAL: "소스 수집이 일부만 완료됨",
    FOCUS_IDENTITY_CONFLICT: "작업 식별자 충돌",
    FOCUS_AUTHORITY_CONFLICT: "현재 상태 근거 충돌",
    FOCUS_LATEST_EVENT_TIE: "최신 이벤트가 동률임",
    FOCUS_INSUFFICIENT_IDENTITY: "정확한 작업 근거 부족",
    FOCUS_DEPENDENCY_MISMATCH: "동일 evidence graph를 확인하지 못함",
    FOCUS_PROJECTION_UNAVAILABLE: "Focus projection을 만들 수 없음"
  };
  return labels[reason];
}

function focusSourceLabel(
  source: NonNullable<
    AttentionReadyResponse["currentFocus"]["selectedFocus"]
  >["latestMeaningfulEvent"]["source"]
): string {
  return source === "github"
    ? "GitHub"
    : source === "codex_managed"
      ? "Codex"
      : "Codex 기록";
}

function focusEventLabel(kind: string): string {
  const labels: Record<string, string> = {
    github_push: "코드 push",
    github_issue_opened: "Issue 생성",
    github_issue_closed: "Issue 종료",
    github_issue_reopened: "Issue 재개",
    github_pull_request_opened: "Pull Request 생성",
    github_pull_request_closed: "Pull Request 종료",
    github_pull_request_reopened: "Pull Request 재개",
    github_pull_request_merged: "Pull Request merge",
    github_review_submitted: "Review 완료",
    github_changes_requested: "변경 요청",
    github_ci_failed: "CI 실패 확인",
    github_merge_conflict: "Merge conflict 확인",
    codex_run_started: "Codex 실행 시작",
    codex_turn_started: "Codex 작업 진행",
    codex_turn_completed: "Codex turn 완료",
    codex_turn_failed: "Codex turn 실패",
    codex_turn_interrupted: "Codex turn 중단",
    codex_run_failed: "Codex 실행 실패",
    codex_run_closed: "Codex 실행 종료",
    codex_waiting_approval: "승인 대기",
    codex_waiting_user_input: "사용자 입력 대기",
    codex_project_activity: "Codex 프로젝트 기록"
  };
  return labels[kind] ?? kind;
}

function focusStateLabel(state: string): string {
  const labels: Record<string, string> = {
    open: "열림",
    running: "진행 중",
    idle: "대기",
    failed: "실패",
    interrupted: "중단",
    completed: "완료",
    cancelled: "취소",
    unknown: "확인되지 않음",
    conflict: "근거 충돌"
  };
  return labels[state] ?? state;
}

function focusCurrentnessLabel(currentness: string): string {
  const labels: Record<string, string> = {
    current: "최신·완전",
    stale: "오래됨",
    partial: "부분 수집",
    historical_only: "과거 맥락만",
    conflict: "근거 충돌",
    unknown: "확인되지 않음"
  };
  return labels[currentness] ?? currentness;
}

function focusConfidenceLabel(confidence: string): string {
  return confidence === "high"
    ? "높음"
    : confidence === "medium"
      ? "중간"
      : "낮음";
}

function focusBlockerLabel(blocker: string): string {
  const labels: Record<string, string> = {
    none: "없음",
    ci_failed: "CI 실패",
    changes_requested: "변경 요청",
    merge_conflict: "Merge conflict",
    codex_failure: "Codex 실패",
    waiting_on_approval: "승인 대기",
    waiting_on_user_input: "사용자 입력 대기",
    unknown: "확인되지 않음"
  };
  return labels[blocker] ?? blocker;
}

function AttentionStatusStrip({
  payload
}: {
  payload: AttentionReadyResponse;
}) {
  const availableSources = payload.run.sources.filter(
    (source) =>
      source.inputState === "available" && source.freshness !== "invalid"
  );
  const reviewCount = payload.result.assessments.filter(
    (assessment) => assessment.status === "review_required"
  ).length;
  return (
    <div className="attentionStatusStrip" aria-label="평가 상태 요약">
      <span>
        마지막 평가 {formatTimestamp(payload.result.asOf)}
      </span>
      <span className="isHealthy">
        {availableSources.length > 0
          ? `${availableSources.map((source) => sourceLabel(source.source)).join(" · ")} 확인`
          : "현재 확인된 source 없음"}
      </span>
      <span className={reviewCount > 0 ? "isWarning" : "isHealthy"}>
        {reviewCount > 0
          ? `확인 필요한 근거 ${reviewCount}개`
          : "근거 충돌 없음"}
      </span>
    </div>
  );
}

function AttentionReviewDisclosure({
  assessments
}: {
  assessments: AttentionReadyResponse["result"]["assessments"];
}) {
  const userReview = assessments.filter(
    (assessment) =>
      assessment.status === "review_required" &&
      assessment.reviewRoute === "user_review"
  );
  const refresh = assessments.filter(
    (assessment) =>
      assessment.status === "review_required" &&
      assessment.reviewRoute === "refresh_sources"
  );
  if (userReview.length === 0 && refresh.length === 0) return null;
  const userSources = reviewSourceLabels(userReview);
  const refreshSources = reviewSourceLabels(refresh);
  return (
    <aside className="attentionWarning" role="status">
      {userReview.length > 0 ? (
        <span>
          추천 순위에서 제외된 확인 필요 후보 {userReview.length}개 ·{" "}
          {userSources.join(", ")} 근거 충돌
        </span>
      ) : null}
      {userReview.length > 0 && refresh.length > 0 ? " · " : null}
      {refresh.length > 0 ? (
        <span>
          근거 갱신 필요 {refresh.length}개 · {refreshSources.join(", ")}
        </span>
      ) : null}
    </aside>
  );
}

function reviewSourceLabels(
  assessments: AttentionReadyResponse["result"]["assessments"]
): string[] {
  return Array.from(
    new Set(
      assessments.map((assessment) =>
        assessment.triggerSource === "codex_managed"
          ? "Codex 실행↔GitHub 연결"
          : "GitHub 작업"
      )
    )
  );
}

function AttentionDecision({
  status,
  suggestion,
  alternatives,
  clarification,
  scopeStatement,
  certainty,
  currentFocus,
  reasonCodes
}: {
  status: AttentionReadyResponse["result"]["decision"]["status"];
  suggestion: ActiveAttentionCandidate | null;
  alternatives: ActiveAttentionCandidate[];
  clarification: AttentionReadyResponse["result"]["decision"]["clarification"];
  scopeStatement: string;
  certainty: AttentionReadyResponse["result"]["decision"]["certainty"];
  currentFocus: AttentionReadyResponse["currentFocus"];
  reasonCodes: AttentionReadyResponse["result"]["decision"]["reasonCodes"];
}) {
  if (status === "suggested" && suggestion) {
    const source =
      suggestion.triggerSource === "codex_managed" ? "Codex" : "GitHub";
    return (
      <article className="attentionDecision attentionDecision-suggested">
        <div className="attentionProjectContext">
          <span className="attentionProjectMark" aria-hidden="true">
            ◈
          </span>
          <span>
            <strong>{suggestion.repositoryFullName}</strong>
            <small>
              {suggestion.projectId
                ? "프로젝트 매핑 확인됨"
                : "현재 저장소 범위 · 프로젝트 매핑 미확인"}
            </small>
          </span>
          <span className="attentionProjectShortcut">현재 범위</span>
        </div>
        <div className="attentionDecisionMeta">
          <span>{laneLabel(suggestion.lane)}</span>
          <span>
            {certainty === "confirmed" ? "확인된 후보" : "임시 제안"}
          </span>
          <span
            className={`attentionSourceBadge ${
              source === "Codex" ? "isCodex" : "isGitHub"
            }`}
          >
            <i aria-hidden="true" />
            {source}
          </span>
        </div>
        <h3>{suggestion.title}</h3>
        <div className="attentionCandidateContext">
          <span>
            {suggestion.repositoryFullName} #{suggestion.number}
          </span>
          {suggestion.dueAt ? (
            <time dateTime={suggestion.dueAt}>
              마감 {formatTimestamp(suggestion.dueAt)}
            </time>
          ) : null}
        </div>
        <p className="attentionWhyNow">
          {suggestion.whyNowReasonCodes.map(whyNowLabel).join(" · ")}
        </p>
        <p className="attentionExplanation">
          {suggestion.explanation}
        </p>
        <div className="attentionFirstStep">
          <span>첫 단계</span>
          <p>{suggestion.firstStep}</p>
        </div>
        <a
          className="attentionPrimaryLink"
          href={suggestion.destinationUrl}
          target="_blank"
          rel="noreferrer"
        >
          GitHub에서 열기
          <span className="srOnly"> (새 탭)</span>
        </a>
        {alternatives.length > 0 ? (
          <details className="attentionAlternatives">
            <summary>다른 후보 {alternatives.length}개</summary>
            <ol>
              {alternatives.map((candidate) => (
                <li key={candidate.candidateId}>
                  <a
                    href={candidate.destinationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {candidate.title}
                    <span className="srOnly"> (새 탭)</span>
                  </a>
                  <span>{laneLabel(candidate.lane)}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        <p className="attentionScope">{scopeStatement}</p>
      </article>
    );
  }

  const hasSelectedCurrentFocus =
    currentFocus.status === "selected" &&
    currentFocus.selectedFocus !== null;
  const coverageIsIncomplete = reasonCodes.includes(
    "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
  );
  const content =
    status === "no_action"
      ? {
          label: "현재 평가 범위",
          title: hasSelectedCurrentFocus
            ? "현재 작업 흐름은 확인했지만, 평가한 범위에서는 별도 개입 후보가 없습니다."
            : "지금 직접 개입할 항목이 없습니다."
        }
      : status === "needs_clarification"
        ? {
            label: "한 가지 확인 필요",
            title: "사용자의 판단이 필요한 충돌이 있습니다."
          }
        : {
            label: "평가 범위 부족",
            title: hasSelectedCurrentFocus
              ? "현재 작업 흐름은 확인했지만, 다음 개입 후보는 확정하지 못했습니다."
              : coverageIsIncomplete
                ? "검증된 개입 후보가 없고 일부 작업 근거가 부족합니다."
                : "현재 근거만으로 다음 개입 후보를 확정하지 못했습니다."
          };
  return (
    <article
      className={`attentionDecision attentionDecision-${status}`}
    >
      <p className="eyebrow">{content.label}</p>
      <h3>{content.title}</h3>
      {clarification ? (
        <div className="attentionClarification">
          <strong>{clarification.question}</strong>
          <span>
            {clarification.triggerSource === "codex_managed"
              ? "Codex 실행과 연결된 GitHub 작업의 근거가 충돌합니다."
              : "GitHub 작업 근거가 서로 충돌합니다."}
          </span>
        </div>
      ) : null}
      <p className="attentionScope">{scopeStatement}</p>
    </article>
  );
}

function WorkResumption({
  suggestion,
  codexItems
}: {
  suggestion: ActiveAttentionCandidate;
  codexItems: Phase2CodexOverviewItem[];
}) {
  const taskRef: WorkResumptionTaskRef = {
    kind: "attention_subject",
    source: "github",
    subjectId: suggestion.githubSubjectId,
    displayTitle: suggestion.title
  };
  const taskKey = `${taskRef.kind}:${taskRef.source}:${taskRef.subjectId}`;
  const sessionOptions = useMemo(
    () => uniqueCodexSessions(codexItems),
    [codexItems]
  );
  const sessionOptionKey = sessionOptions
    .map((item) => item.executionId)
    .join(":");
  const [snapshot, setSnapshot] =
    useState<WorkResumptionReadyResponse | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [command, setCommand] =
    useState<WorkResumptionCommand | null>(null);
  const [pollingCommandId, setPollingCommandId] =
    useState<string | null>(null);
  const requestSequence = useRef(0);

  useVisiblePolling(
    async () => {
      const response = await fetchWorkResumption();
      if (response.status === "ready") setSnapshot(response);
    },
    {
      intervalMs: 5_000,
      maxBackoffMs: 30_000,
      enabled: !isMutating && pollingCommandId === null,
      runImmediately: false
    }
  );

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setIsLoading(true);
    setSnapshot(null);
    setSelectedExecutionId("");
    setMessage(null);
    setCommand(null);
    setPollingCommandId(null);
    void fetchWorkResumption()
      .then((response) => {
        if (sequence !== requestSequence.current) return;
        if (response.status === "ready") {
          setSnapshot(response);
          return;
        }
        setMessage(
          response.message ??
            "이 기기에서는 작업 이어가기를 사용할 수 없습니다."
        );
      })
      .catch((error) => {
        if (sequence !== requestSequence.current) return;
        setMessage(
          workResumptionErrorMessage(
            error,
            "Codex 작업 연결 정보를 불러오지 못했습니다."
          )
        );
      })
      .finally(() => {
        if (sequence === requestSequence.current) {
          setIsLoading(false);
        }
      });
  }, [taskKey]);

  useEffect(() => {
    if (
      selectedExecutionId &&
      !sessionOptions.some(
        (item) => item.executionId === selectedExecutionId
      )
    ) {
      setSelectedExecutionId("");
    }
  }, [selectedExecutionId, sessionOptionKey, sessionOptions]);

  useEffect(() => {
    if (!pollingCommandId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pollCommand() {
      try {
        const response = await fetchWorkResumption(
          pollingCommandId as string
        );
        if (cancelled) return;
        if (response.status !== "ready" || !response.command) {
          setCommand(null);
          setMessage(
            response.status === "error"
              ? response.message ??
                  "작업 열기 상태를 확인하지 못했습니다."
              : "작업 열기 상태를 확인하지 못했습니다."
          );
          setPollingCommandId(null);
          return;
        }
        setSnapshot(response);
        setCommand(response.command);
        if (isTerminalCommandStatus(response.command.status)) {
          setPollingCommandId(null);
          return;
        }
        timer = setTimeout(() => void pollCommand(), 800);
      } catch (error) {
        if (cancelled) return;
        setCommand(null);
        setMessage(
          workResumptionErrorMessage(
            error,
            "Local Companion의 응답을 확인하지 못했습니다."
          )
        );
        setPollingCommandId(null);
      }
    }

    void pollCommand();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollingCommandId]);

  const activeBinding = snapshot?.bindings.find((binding) =>
    sameTaskRef(binding.taskRef, taskRef)
  );
  const expectedManagedBinding =
    suggestion.triggerSource === "codex_managed" &&
    suggestion.bindingId &&
    suggestion.executionId
      ? {
          expectedBindingId: suggestion.bindingId,
          expectedExecutionId: suggestion.executionId
        }
      : null;
  const exactActiveBinding =
    activeBinding &&
    (!expectedManagedBinding ||
      (activeBinding.bindingId ===
        expectedManagedBinding.expectedBindingId &&
        activeBinding.executionId ===
          expectedManagedBinding.expectedExecutionId))
      ? activeBinding
      : undefined;
  const linkedSession = activeBinding
    ? sessionOptions.find(
        (item) => item.executionId === activeBinding.executionId
      )
    : null;
  const companionOnline = snapshot?.companion.state === "online";

  async function bindSelectedSession() {
    if (!selectedExecutionId || isMutating) return;
    const sequence = ++requestSequence.current;
    setIsMutating(true);
    setMessage(null);
    setCommand(null);
    try {
      const response = await bindWorkSession({
        taskRef,
        executionId: selectedExecutionId
      });
      if (sequence !== requestSequence.current) return;
      if (acceptWorkResumptionResponse(response, setSnapshot, setMessage)) {
        setSelectedExecutionId("");
        syncInvalidationBus.invalidate({
          reason: "context_changed",
          targets: ["attention"]
        });
        setMessage(
          "선택한 Codex 세션을 이 작업에 연결했습니다. 제목이 비슷한 다른 세션은 자동 연결하지 않습니다."
        );
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setMessage(
          workResumptionErrorMessage(
            error,
            "Codex 세션을 작업에 연결하지 못했습니다."
          )
        );
      }
    } finally {
      if (sequence === requestSequence.current) setIsMutating(false);
    }
  }

  async function unbindCurrentSession() {
    if (!activeBinding || isMutating) return;
    const sequence = ++requestSequence.current;
    setIsMutating(true);
    setMessage(null);
    setCommand(null);
    setPollingCommandId(null);
    try {
      const response = await unbindWorkSession({ taskRef });
      if (sequence !== requestSequence.current) return;
      if (acceptWorkResumptionResponse(response, setSnapshot, setMessage)) {
        syncInvalidationBus.invalidate({
          reason: "context_changed",
          targets: ["attention"]
        });
        setMessage("Codex 세션 연결을 해제했습니다.");
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setMessage(
          workResumptionErrorMessage(
            error,
            "Codex 세션 연결을 해제하지 못했습니다."
          )
        );
      }
    } finally {
      if (sequence === requestSequence.current) setIsMutating(false);
    }
  }

  async function openBoundSession() {
    if (
      !exactActiveBinding ||
      !companionOnline ||
      isMutating ||
      pollingCommandId
    ) {
      return;
    }
    const sequence = ++requestSequence.current;
    setIsMutating(true);
    setMessage(null);
    setCommand(null);
    try {
      const response = await openWorkSession({
        taskRef,
        ...(expectedManagedBinding ?? {})
      });
      if (sequence !== requestSequence.current) return;
      if (!acceptWorkResumptionResponse(response, setSnapshot, setMessage)) {
        return;
      }
      const commandId = response.acceptedCommand?.commandId;
      if (!commandId) {
        setMessage("작업 열기 요청 ID를 받지 못했습니다.");
        return;
      }
      setCommand(response.acceptedCommand ?? null);
      setPollingCommandId(commandId);
    } catch (error) {
      if (sequence === requestSequence.current) {
        setMessage(
          workResumptionErrorMessage(
            error,
            "Codex 작업 열기를 요청하지 못했습니다."
          )
        );
      }
    } finally {
      if (sequence === requestSequence.current) setIsMutating(false);
    }
  }

  return (
    <section
      className="workResumption"
      aria-labelledby="work-resumption-title"
      aria-busy={isLoading || isMutating}
    >
      <div className="workResumptionHeader">
        <div>
          <p className="eyebrow">Return to work</p>
          <h3 id="work-resumption-title">이 작업의 Codex 세션</h3>
        </div>
        <CompanionBadge snapshot={snapshot} />
      </div>

      {isLoading ? (
        <p className="workResumptionEmpty" role="status">
          연결된 Codex 작업 공간을 확인하고 있습니다.
        </p>
      ) : !snapshot ? (
        <p className="workResumptionEmpty">
          작업 이어가기 상태를 확인할 수 없습니다. 이 기능은 준비된 로컬
          Blabase 환경에서만 연결하거나 실행할 수 있습니다.
        </p>
      ) : exactActiveBinding ? (
        <div className="workResumptionBound">
          <div className="workResumptionSession">
            <span>사용자가 연결한 세션</span>
            <strong>
              {linkedSession
                ? codexSessionLabel(linkedSession)
                : "저장된 Codex 세션"}
            </strong>
            <small>
              {linkedSession
                ? `${linkedSession.projectLabel} · ${formatTimestamp(
                    linkedSession.sourceUpdatedAt
                  )}`
                : `세션 ${shortOpaqueId(exactActiveBinding.executionId)}`}
            </small>
          </div>
          <div className="workResumptionActions">
            <button
              className="workResumptionPrimary"
              type="button"
              disabled={
                !companionOnline ||
                isMutating ||
                pollingCommandId !== null
              }
              onClick={() => void openBoundSession()}
              aria-describedby="work-resumption-boundary"
            >
              {pollingCommandId
                ? "Codex 세션 여는 중"
                : "Codex에서 작업 이어가기"}
            </button>
            <button
              className="workResumptionSecondary"
              type="button"
              disabled={isMutating || pollingCommandId !== null}
              onClick={() => void unbindCurrentSession()}
            >
              연결 해제
            </button>
          </div>
          {!companionOnline ? (
            <p className="workResumptionOffline">
              Local Companion이 오프라인입니다. 이 기기의{" "}
              <code>suggestion/</code> 폴더에서{" "}
              <code>npm run companion:work-resumption</code>을 실행해주세요.
              연결 정보는 그대로 유지되며 상태는 자동으로 다시
              확인합니다.
            </p>
          ) : (
            <p className="workResumptionShortcut">
              버튼에 초점을 둔 뒤 Enter를 눌러도 실행됩니다.
            </p>
          )}
        </div>
      ) : expectedManagedBinding ? (
        <p className="workResumptionEmpty" role="status">
          이 추천을 만들 때 확인한 Codex 세션 연결이 현재 상태와 다릅니다.
          새로고침 후 다시 평가하면 다른 세션을 실수로 열지 않습니다.
        </p>
      ) : sessionOptions.length === 0 ? (
        <p className="workResumptionEmpty">
          연결할 Codex 과거 세션이 없습니다. Codex 연결에서 세션을 먼저
          수집한 뒤 직접 연결해주세요.
        </p>
      ) : (
        <div className="workResumptionBinder">
          <p>
            이 제안과 실제로 이어지는 세션을 직접 선택하세요. 제목이나
            URL이 비슷하다는 이유로 자동 연결하지 않습니다.
          </p>
          <div>
            <label htmlFor={`work-session-${suggestion.candidateId}`}>
              연결할 Codex 세션
            </label>
            <select
              id={`work-session-${suggestion.candidateId}`}
              value={selectedExecutionId}
              disabled={isMutating}
              onChange={(event) =>
                setSelectedExecutionId(event.target.value)
              }
            >
              <option value="">세션을 직접 선택하세요</option>
              {sessionOptions.map((item) => (
                <option key={item.executionId} value={item.executionId}>
                  {codexSessionLabel(item)} · {item.projectLabel} ·{" "}
                  {formatTimestamp(item.sourceUpdatedAt)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedExecutionId || isMutating}
              onClick={() => void bindSelectedSession()}
            >
              {isMutating ? "연결 중" : "이 세션을 작업에 연결"}
            </button>
          </div>
        </div>
      )}

      <p id="work-resumption-boundary" className="workResumptionBoundary">
        세션을 열거나 포커스만 이동합니다. 프롬프트 전송, 승인, 재시도는
        자동으로 실행하지 않습니다. Companion이 이전에 연 Terminal만
        포커스할 수 있으므로 다른 Codex 클라이언트에서 실행 중인 같은
        세션을 동시에 열지 마세요.
        {suggestion.triggerKind === "managed_failure" ? (
          <>
            {" "}세션을 여는 것만으로 실패가 해결된 것으로 처리하지
            않습니다. 더 최신 실행이나 직접 확인된 상태 변경이 들어올
            때까지 이 제안은 다시 나타날 수 있습니다.
          </>
        ) : null}
      </p>
      {command ? <WorkResumptionCommandState command={command} /> : null}
      {message ? (
        <p className="workResumptionMessage" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function WorkflowFollowThroughActions({
  suggestion
}: {
  suggestion: ActiveAttentionCandidate;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const identity =
    suggestion.triggerKind === "configured_follow_through" &&
    suggestion.managedRunId &&
    suggestion.bindingId &&
    suggestion.executionId &&
    suggestion.workflowDecisionId &&
    suggestion.workflowActionKind
      ? {
          managedRunId: suggestion.managedRunId,
          bindingId: suggestion.bindingId,
          executionId: suggestion.executionId,
          workflowDecisionId: suggestion.workflowDecisionId,
          actionKind: suggestion.workflowActionKind
        }
      : null;

  if (!identity) return null;

  async function close(outcome: "completed" | "skipped") {
    if (isSubmitting || !identity) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      await recordProjectWorkflowClosure({ ...identity, outcome });
      setMessage(
        outcome === "completed"
          ? "후속 작업을 완료로 기록했습니다."
          : "이번 후속 작업을 건너뜀으로 기록했습니다."
      );
      syncInvalidationBus.invalidate({
        reason: "context_changed",
        targets: ["attention"]
      });
    } catch {
      setMessage("후속 작업 상태를 기록하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      className="workflowFollowThrough"
      aria-labelledby="workflow-follow-through-title"
      aria-busy={isSubmitting}
    >
      <div>
        <p className="eyebrow">Configured follow-through</p>
        <h3 id="workflow-follow-through-title">
          이 후속 작업의 상태를 알려주세요
        </h3>
        <p>
          완료 또는 건너뜀을 직접 기록하면 같은 Codex 실행에서 다시
          제안하지 않습니다.
        </p>
      </div>
      <div className="workflowFollowThroughActions">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void close("completed")}
        >
          완료로 기록
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void close("skipped")}
        >
          이번에는 건너뛰기
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function CompanionBadge({
  snapshot
}: {
  snapshot: WorkResumptionReadyResponse | null;
}) {
  if (!snapshot) {
    return <span className="workResumptionBadge">확인 불가</span>;
  }
  return (
    <span
      className={`workResumptionBadge ${
        snapshot.companion.state === "online" ? "isOnline" : ""
      }`}
      title={
        snapshot.companion.lastSeenAt
          ? `마지막 신호 ${formatTimestamp(
              snapshot.companion.lastSeenAt
            )}`
          : undefined
      }
    >
      Companion{" "}
      {snapshot.companion.state === "online" ? "실행 중" : "꺼짐"}
    </span>
  );
}

function WorkResumptionCommandState({
  command
}: {
  command: WorkResumptionCommand;
}) {
  const state =
    command.status === "completed"
      ? {
          className: "isSuccess",
          text: commandSuccessMessage(command.resultCode)
        }
      : command.status === "failed"
        ? {
            className: "isError",
            text: commandFailureMessage(command.resultCode)
          }
        : command.status === "expired"
          ? {
              className: "isError",
              text:
                "작업 열기 요청이 만료되었습니다. Companion 상태를 확인한 뒤 다시 시도해주세요."
            }
          : {
              className: "",
              text:
                command.status === "claimed"
                  ? "Local Companion이 요청을 받아 Codex 세션을 여는 중입니다."
                  : "Local Companion에 Codex 작업 열기를 요청했습니다."
            };
  return (
    <p
      className={`workResumptionCommand ${state.className}`}
      role="status"
      aria-live="polite"
    >
      {state.text}
    </p>
  );
}

function commandFailureMessage(resultCode?: string | null): string {
  switch (resultCode) {
    case "EXECUTION_NOT_FOUND":
      return "이 기기에서 연결된 Codex 세션을 찾지 못했습니다.";
    case "EXECUTION_STALE":
      return "연결된 Codex 세션이 오래되어 다시 확인해야 합니다.";
    case "CODEX_UNAVAILABLE":
      return "Codex 또는 Local Companion의 응답을 확인하지 못했습니다.";
    case "LAUNCH_FAILED":
      return "Terminal에서 Codex 세션을 열지 못했습니다.";
    case "LAUNCH_OUTCOME_UNKNOWN":
      return "Terminal 실행 결과를 확인하지 못했습니다. Terminal을 확인한 뒤 필요할 때만 다시 시도해주세요.";
    case "UNSUPPORTED_PLATFORM":
      return "현재 운영체제에서는 Codex 작업 이어가기를 지원하지 않습니다.";
    default:
      return "Local Companion이 Codex 세션을 열지 못했습니다.";
  }
}

function commandSuccessMessage(resultCode?: string | null): string {
  switch (resultCode) {
    case "FOCUSED_EXISTING":
      return "Companion이 추적 중인 Codex Terminal을 앞으로 가져왔습니다.";
    case "RESUMED_IN_TERMINAL":
      return "Terminal에서 Codex 세션을 이어서 열었습니다.";
    default:
      return "Terminal에서 Codex 세션을 열었습니다.";
  }
}

function workResumptionErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof WorkResumptionRequestError
    ? error.message
    : fallback;
}

function acceptWorkResumptionResponse(
  response: WorkResumptionApiResponse,
  setSnapshot: (
    snapshot: WorkResumptionReadyResponse | null
  ) => void,
  setMessage: (message: string | null) => void
): response is WorkResumptionReadyResponse {
  if (response.status === "ready") {
    setSnapshot(response);
    return true;
  }
  setSnapshot(null);
  setMessage(
    response.message ??
      "이 기기에서는 Codex 작업 이어가기를 사용할 수 없습니다."
  );
  return false;
}

function isTerminalCommandStatus(
  status: WorkResumptionCommand["status"]
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "expired"
  );
}

function sameTaskRef(
  left: WorkResumptionTaskIdentity | WorkResumptionTaskRef,
  right: WorkResumptionTaskIdentity | WorkResumptionTaskRef
): boolean {
  return (
    left.kind === right.kind &&
    left.source === right.source &&
    left.subjectId === right.subjectId
  );
}

function uniqueCodexSessions(
  items: Phase2CodexOverviewItem[]
): Phase2CodexOverviewItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.executionId)) return false;
    seen.add(item.executionId);
    return true;
  });
}

function codexSessionLabel(item: Phase2CodexOverviewItem): string {
  return (
    item.taskSummary ??
    item.latestUserPromptExcerpt ??
    `Codex 세션 ${shortOpaqueId(item.executionId)}`
  );
}

function shortOpaqueId(value: string): string {
  const opaqueValue = value.startsWith("codex:execution:")
    ? value.slice("codex:execution:".length)
    : value;
  return opaqueValue.length > 8
    ? `${opaqueValue.slice(0, 8)}…`
    : opaqueValue;
}

function SourceHealthGrid({
  sources,
  supportingContext
}: {
  sources: AttentionReadyResponse["run"]["sources"];
  supportingContext: AttentionReadyResponse["baseResult"]["workCockpit"]["supportingContext"];
}) {
  return (
    <section className="attentionSubsection" aria-labelledby="source-health">
      <div className="attentionSubsectionHeader">
        <div>
          <p className="eyebrow">Evaluation scope</p>
          <h3 id="source-health">Source 상태</h3>
        </div>
      </div>
      <ul className="sourceHealthGrid">
        {sources.map((source) => (
          <SourceHealthItem key={source.source} source={source} />
        ))}
        <li
          className={
            supportingContext.notion.status === "available"
              ? "isLimited"
              : "isUnevaluated"
          }
        >
          <div>
            <strong>Notion</strong>
            <span>
              {supportingContext.notion.status === "available"
                ? `프로젝트 맥락 ${supportingContext.notion.resourceCount}개`
                : "이번 판단에서 미평가"}
            </span>
          </div>
          <span>
            {supportingContext.notion.status === "available"
              ? "Context"
              : "Later"}
          </span>
        </li>
        <li
          className={
            supportingContext.googleCalendar.status === "available"
              ? "isLimited"
              : "isUnevaluated"
          }
        >
          <div>
            <strong>Google Calendar</strong>
            <span>
              {supportingContext.googleCalendar.status === "available"
                ? `예정 일정 ${supportingContext.googleCalendar.upcomingConstraintCount}개`
                : "이번 판단에서 미평가"}
            </span>
          </div>
          <span>
            {supportingContext.googleCalendar.status === "available"
              ? "Schedule"
              : "Later"}
          </span>
        </li>
      </ul>
    </section>
  );
}

function SourceHealthItem({
  source
}: {
  source: AttentionSourceMonitor;
}) {
  const state = sourceState(source);
  return (
    <li className={`is${capitalize(state.tone)}`}>
      <div>
        <strong>
          {source.source === "github" ? "GitHub" : "Codex history"}
        </strong>
        <span>{state.detail}</span>
      </div>
      <span>{state.label}</span>
    </li>
  );
}

function CodexOverview({
  items
}: {
  items: Phase2CodexOverviewItem[];
}) {
  return (
    <section className="attentionSubsection" aria-labelledby="codex-overview">
      <div className="attentionSubsectionHeader">
        <div>
          <p className="eyebrow">Execution overview</p>
          <h3 id="codex-overview">Codex 과거 작업 맥락</h3>
        </div>
        <span>{items.length}개</span>
      </div>
      {items.length === 0 ? (
        <p className="attentionEmpty">
          현재 표시할 Codex 과거 세션 metadata가 없습니다.
        </p>
      ) : (
        <ul className="codexOverviewList">
          {items.slice(0, 8).map((item) => (
            <li key={item.observationId}>
              <div>
                <strong>{item.taskSummary ?? item.projectLabel}</strong>
                <span>
                  {item.taskSummary ? item.projectLabel : "프로젝트"}
                  {" · "}
                  {formatTimestamp(item.sourceUpdatedAt)}
                </span>
                {item.latestUserPromptExcerpt ? (
                  <small>최근 요청: {item.latestUserPromptExcerpt}</small>
                ) : null}
                {item.latestAgentResponseExcerpt ? (
                  <small>최근 답변: {item.latestAgentResponseExcerpt}</small>
                ) : null}
                {item.latestExecutionSummary ? (
                  <small>최근 실행: {item.latestExecutionSummary}</small>
                ) : null}
              </div>
              <div className="codexOverviewState">
                <span>
                  {item.conversationContentAvailable
                    ? `${codexHistoricalStatusLabel(
                        item.historicalTurnStatus
                      )} · 요청 ${item.userPromptCount} · 답변 ${
                        item.agentResponseCount
                      }`
                    : codexActivityLabel(item.nativeActivityState)}
                </span>
                <small>
                  {item.conversationContentAvailable
                    ? `${codexContentStateLabel(
                        item.conversationCollectionState
                      )} · 명령 ${item.commandExecutionCount} · 파일 변경 ${
                        item.fileChangeCount
                      } · 도구 ${item.toolCallCount}`
                    : `${item.observationMode} · execution ${item.executionState}`}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 ? (
        <p className="attentionListRemainder">
          이외 {items.length - 8}개 실행은 Attention Lab의 실행 수에서
          확인할 수 있습니다.
        </p>
      ) : null}
      <p className="attentionFootnote">
        현재 Codex 표시는 수집 시점에 저장된 과거 thread 기록입니다.
        완료·실패 표시는 저장된 마지막 turn의 결과일 뿐 현재 프로세스의
        실시간 상태가 아닙니다. 원문은 이 화면이나 Attention 기록에
        포함하지 않으며, 정제된 짧은 발췌와 개수만 표시합니다. 지금 목록은
        추천 후보가 아니라 판단 맥락으로만 사용합니다.
      </p>
    </section>
  );
}

function DiagnosticGroup({
  title,
  values
}: {
  title: string;
  values: string[];
}) {
  return (
    <div>
      <h4>{title}</h4>
      {values.length > 0 ? (
        <ul>
          {values.map((value) => (
            <li key={value} className="monoValue">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p>기록 없음</p>
      )}
    </div>
  );
}

function sourceState(source: AttentionSourceMonitor): {
  tone: "fresh" | "limited" | "unavailable";
  label: string;
  detail: string;
} {
  if (source.inputState !== "available") {
    return {
      tone: "unavailable",
      label: "Unavailable",
      detail:
        source.inputState === "disconnected"
          ? "연결되지 않음"
          : "현재 snapshot 사용 불가"
    };
  }
  if (source.freshness === "invalid") {
    return {
      tone: "unavailable",
      label: "Invalid",
      detail: source.issueCodes[0] ?? "현재 snapshot 사용 불가"
    };
  }
  if (
    source.freshness !== "fresh" ||
    source.completeness !== "complete"
  ) {
    return {
      tone: "limited",
      label: source.freshness === "stale" ? "Stale" : "Partial",
      detail: source.snapshotFetchedAt
        ? `마지막 수집 ${formatTimestamp(source.snapshotFetchedAt)}`
        : "평가 범위 제한"
    };
  }
  return {
    tone: "fresh",
    label: "Fresh",
    detail: `signal ${source.signalCount}개 · ${formatTimestamp(
      source.snapshotFetchedAt
    )}`
  };
}

function sourceLabel(
  source: AttentionSourceMonitor["source"]
): string {
  return source === "github" ? "GitHub" : "Codex";
}

function whyNowLabel(
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
    case "WHY_NOW_AUTHORED_PR_CHECKS_FAILED":
      return "내 PR의 검사 실패가 확인됨";
    case "WHY_NOW_AUTHORED_PR_CHANGES_REQUESTED":
      return "내 PR에 변경 요청이 확인됨";
    case "WHY_NOW_AUTHORED_PR_MERGE_CONFLICT":
      return "내 PR의 병합 충돌이 확인됨";
    case "WHY_NOW_MANAGED_FAILURE_CURRENT":
      return "현재 Codex 실행 실패가 확인됨";
    case "WHY_NOW_CONFIGURED_HANDOFF_OPEN":
      return "설정한 완료 후속 작업이 남음";
    case "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH":
      return "이번 주 결과와 직접 연결됨";
  }
}

function laneLabel(lane: ActiveAttentionCandidate["lane"]): string {
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

function codexActivityLabel(
  state: Phase2CodexOverviewItem["nativeActivityState"]
): string {
  switch (state) {
    case "active":
      return "목록 기록: active";
    case "idle":
      return "목록 기록: idle";
    case "not_loaded":
      return "실행 관찰 불가";
    case "system_error":
      return "목록 기록: system error";
    case "unknown":
      return "알 수 없음";
  }
}

function codexHistoricalStatusLabel(
  status: Phase2CodexOverviewItem["historicalTurnStatus"]
): string {
  switch (status) {
    case "completed":
      return "과거 마지막 턴 완료";
    case "failed":
      return "과거 마지막 턴 실패";
    case "interrupted":
      return "과거 마지막 턴 중단";
    case "in_progress":
      return "저장 당시 진행 중";
    case "unknown":
      return "과거 결과 알 수 없음";
  }
}

function codexContentStateLabel(
  state: Phase2CodexOverviewItem["conversationCollectionState"]
): string {
  switch (state) {
    case "complete":
      return "기록 수집 완료";
    case "partial":
      return "일부 기록만 수집";
    case "stale":
      return "이전 기록 사용";
    case "failed":
      return "기록 읽기 실패";
    case "expired":
      return "기록 보관 만료";
    case "not_collected":
      return "기록 수집 안 함";
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return "시각 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

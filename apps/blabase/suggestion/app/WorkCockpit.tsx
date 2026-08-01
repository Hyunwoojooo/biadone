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
import type {
  Phase2Candidate,
  Phase2CodexOverviewItem
} from "../src/crossSource/attentionSchema";
import {
  fetchAttention,
  submitAttentionFeedback
} from "./attentionClient";
import { ManagedCodexProgress } from "./ManagedCodexProgress";
import { ProjectMappings } from "./ProjectMappings";
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

export function WorkCockpit() {
  const [payload, setPayload] = useState<AttentionApiResponse | null>(
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
  const requestSequence = useRef(0);
  const interactiveSequenceRef = useRef<number | null>(null);
  useSourceSyncRuntime();

  const load = useCallback(
    async (
      refreshSources = false,
      silent = false
    ): Promise<boolean> => {
      if (silent && interactiveSequenceRef.current !== null) {
        return false;
      }
      const sequence = ++requestSequence.current;
      if (!silent) {
        interactiveSequenceRef.current = sequence;
        refreshSources ? setIsRefreshing(true) : setIsLoading(true);
        setFeedbackMessage(null);
      }
      try {
        const next = await fetchAttention(refreshSources);
        if (sequence !== requestSequence.current) return false;
        setPayload(next);
        if (!silent) setSelectedFeedback(null);
        return next.status !== "error";
      } catch {
        if (sequence !== requestSequence.current) return false;
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
    []
  );

  const refreshSources = useCallback(async () => {
    const updated = await load(true);
    if (!updated) return;
    syncInvalidationBus.invalidate({
      reason: "manual_refresh",
      targets: ["github", "codex", "attention", "timeline"]
    });
    wakeSourceSyncStatus();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useSyncInvalidation(["attention"], () => {
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
            <p className="eyebrow">Work Cockpit</p>
            <span>Beta · 추천은 read-only</span>
          </div>
          <h2 id="attention-title">지금 개입할 한 가지</h2>
          <p>
            연결되고 갱신된 범위에서 확인된 작업과 Codex 실행 현황입니다.
          </p>
        </div>
        <button
          className="attentionRefreshButton"
          type="button"
          onClick={() => void refreshSources()}
          disabled={isLoading || isRefreshing}
        >
          {isRefreshing
            ? "연결된 소스 갱신 중"
            : "연결된 소스 새로고침 후 평가"}
        </button>
      </div>

      <ProjectMappings />

      {isLoading && payload === null ? (
        <div className="attentionLoading" role="status">
          저장된 연결 소스 상태를 평가하고 있습니다.
        </div>
      ) : null}

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
  const { result, run } = payload;
  const feedbackEnabled = payload.monitoring.state === "recorded";
  return (
    <>
      <p className="attentionAsOf">
        마지막 평가{" "}
        <time dateTime={result.asOf}>{formatTimestamp(result.asOf)}</time>
        {" · "}
        {run.latencyMs.toLocaleString("ko-KR")}ms
      </p>

      <AttentionDecision
        status={result.decision.status}
        suggestion={result.decision.topSuggestion}
        alternatives={result.decision.alternatives}
        scopeStatement={result.decision.scopeStatement}
        certainty={result.decision.certainty}
      />

      {result.decision.status === "suggested" &&
      result.decision.topSuggestion ? (
        <WorkResumption
          suggestion={result.decision.topSuggestion}
          codexItems={result.workCockpit.codexExecutions}
        />
      ) : null}

      <ManagedCodexProgress />

      <SourceHealthGrid
        sources={run.sources}
        supportingContext={result.workCockpit.supportingContext}
      />
      <CodexOverview items={result.workCockpit.codexExecutions} />

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
            values={result.coverage.reasonCodes}
          />
          <dl>
            <div>
              <dt>후보</dt>
              <dd>
                확정 {run.candidateCounts.eligible} · 임시{" "}
                {run.candidateCounts.provisional} · 제외{" "}
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

function AttentionDecision({
  status,
  suggestion,
  alternatives,
  scopeStatement,
  certainty
}: {
  status: AttentionReadyResponse["result"]["decision"]["status"];
  suggestion: Phase2Candidate | null;
  alternatives: Phase2Candidate[];
  scopeStatement: string;
  certainty: AttentionReadyResponse["result"]["decision"]["certainty"];
}) {
  if (status === "suggested" && suggestion) {
    return (
      <article className="attentionDecision attentionDecision-suggested">
        <div className="attentionDecisionMeta">
          <span>{laneLabel(suggestion.lane)}</span>
          <span>
            {certainty === "confirmed" ? "확인된 후보" : "임시 제안"}
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

  const content =
    status === "no_action"
      ? {
          label: "현재 평가 범위",
          title: "지금 직접 개입할 항목이 없습니다."
        }
      : status === "needs_clarification"
        ? {
            label: "한 가지 확인 필요",
            title: "사용자의 판단이 필요한 충돌이 있습니다."
          }
        : {
            label: "평가 범위 부족",
            title: "안전하게 한 가지를 고르기 어렵습니다."
          };
  return (
    <article
      className={`attentionDecision attentionDecision-${status}`}
    >
      <p className="eyebrow">{content.label}</p>
      <h3>{content.title}</h3>
      <p className="attentionScope">{scopeStatement}</p>
    </article>
  );
}

function WorkResumption({
  suggestion,
  codexItems
}: {
  suggestion: Phase2Candidate;
  codexItems: Phase2CodexOverviewItem[];
}) {
  const taskRef: WorkResumptionTaskRef = {
    kind: "attention_subject",
    source: suggestion.source,
    subjectId: suggestion.subjectId,
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
      !activeBinding ||
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
      const response = await openWorkSession({ taskRef });
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
      ) : activeBinding ? (
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
                : `세션 ${shortOpaqueId(activeBinding.executionId)}`}
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
  supportingContext: AttentionReadyResponse["result"]["workCockpit"]["supportingContext"];
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
        <strong>{source.source === "github" ? "GitHub" : "Codex"}</strong>
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

function whyNowLabel(
  code: Phase2Candidate["whyNowReasonCodes"][number]
): string {
  switch (code) {
    case "WHY_NOW_MILESTONE_DUE_SOON":
      return "48시간 안의 GitHub 마감";
    case "WHY_NOW_MILESTONE_OVERDUE":
      return "GitHub 마감일이 지남";
    case "WHY_NOW_REVIEW_REQUEST_OBSERVED":
      return "리뷰 요청이 확인됨";
    case "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH":
      return "이번 주 결과와 텍스트가 일치";
    case "WHY_NOW_OPEN_ASSIGNED_WORK":
      return "열린 할당 작업이 확인됨";
  }
}

function laneLabel(lane: Phase2Candidate["lane"]): string {
  switch (lane) {
    case "must_now":
      return "지금 확인";
    case "unblock":
      return "진행 해제";
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

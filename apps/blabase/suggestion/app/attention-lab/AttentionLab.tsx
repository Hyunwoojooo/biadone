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
  AttentionHistoryEntry,
  AttentionHistoryResponse
} from "../../src/attention/monitoringSchema";
import {
  fetchAttention,
  fetchAttentionHistory
} from "../attentionClient";
import { syncInvalidationBus } from "../sync/invalidationBus";
import {
  useSourceSyncRuntime,
  useSyncInvalidation,
  useVisiblePolling,
  wakeSourceSyncStatus
} from "../sync/useSourceSync";

export function AttentionLab() {
  const [current, setCurrent] = useState<AttentionApiResponse | null>(
    null
  );
  const [history, setHistory] =
    useState<AttentionHistoryResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const interactiveSequenceRef = useRef<number | null>(null);
  useSourceSyncRuntime();

  const loadPreview = useCallback(async (silent = false) => {
    if (silent && interactiveSequenceRef.current !== null) return;
    const sequence = ++sequenceRef.current;
    if (!silent) {
      interactiveSequenceRef.current = sequence;
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const [nextCurrent, nextHistory] = await Promise.all([
        fetchAttention(false),
        fetchAttentionHistory()
      ]);
      if (sequence !== sequenceRef.current) return;
      setCurrent(nextCurrent);
      setHistory(nextHistory);
      if (
        nextHistory.status === "ready" &&
        nextHistory.entries.length > 0
      ) {
        setSelectedRunId((selected) =>
          selected &&
          nextHistory.entries.some((entry) => entry.runId === selected)
            ? selected
            : nextHistory.entries[0].runId
        );
      }
    } catch {
      if (sequence !== sequenceRef.current) return;
      if (!silent) {
        setLoadError(
          "Attention 실행 기록을 불러오지 못했습니다. 로컬 서버 상태를 확인해주세요."
        );
      }
    } finally {
      if (
        !silent &&
        interactiveSequenceRef.current === sequence
      ) {
        interactiveSequenceRef.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  const runAttention = useCallback(async (): Promise<boolean> => {
    const sequence = ++sequenceRef.current;
    interactiveSequenceRef.current = sequence;
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const attention = await fetchAttention(true);
      if (sequence !== sequenceRef.current) return false;
      setCurrent(attention);

      const nextHistory = await fetchAttentionHistory();
      if (sequence !== sequenceRef.current) return false;
      setHistory(nextHistory);
      if (
        nextHistory.status === "ready" &&
        nextHistory.entries.length > 0
      ) {
        setSelectedRunId(nextHistory.entries[0].runId);
      }
      return attention.status !== "error";
    } catch {
      if (sequence !== sequenceRef.current) return false;
      setLoadError(
        "새 평가 또는 실행 기록을 갱신하지 못했습니다. 로컬 서버 상태를 확인해주세요."
      );
      return false;
    } finally {
      if (interactiveSequenceRef.current === sequence) {
        interactiveSequenceRef.current = null;
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  }, []);

  const refreshSources = useCallback(async () => {
    const updated = await runAttention();
    if (!updated) return;
    syncInvalidationBus.invalidate({
      reason: "manual_refresh",
      targets: ["github", "codex", "attention", "timeline"]
    });
    wakeSourceSyncStatus();
  }, [runAttention]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useSyncInvalidation(["attention"], () => {
    void loadPreview(true);
  });

  useVisiblePolling(() => loadPreview(true), {
    intervalMs: 30_000,
    maxBackoffMs: 120_000,
    runImmediately: false
  });

  const selectedEntry = useMemo(() => {
    if (history?.status !== "ready") return null;
    return (
      history.entries.find((entry) => entry.runId === selectedRunId) ??
      history.entries[0] ??
      null
    );
  }, [history, selectedRunId]);

  return (
    <main className="labShell" id="main-content">
      <header className="labIntro">
        <div>
          <p className="eyebrow">Engine observability</p>
          <h1>Attention Lab</h1>
          <p>
            추천 결과가 만들어진 범위, 후보 funnel, reason code와 명시적
            피드백을 확인합니다. 원문과 private URL은 history에 저장하지
            않습니다.
          </p>
        </div>
        <div className="labIntroActions">
          <button
            type="button"
            onClick={() => void refreshSources()}
            disabled={isLoading || isRefreshing}
          >
            {isRefreshing
              ? "연결된 소스 갱신 중"
              : "연결된 소스 새로고침 후 평가"}
          </button>
          <Link href="/">Work Cockpit으로 돌아가기</Link>
        </div>
      </header>

      {isLoading && history === null ? (
        <div className="labLoading" role="status">
          최근 Attention 실행을 불러오고 있습니다.
        </div>
      ) : null}

      {loadError ? (
        <div className="labError" role="alert">
          {loadError}
        </div>
      ) : null}

      {current?.status === "error" ? (
        <div className="labError" role="alert">
          현재 실행 실패 · {current.code}
        </div>
      ) : null}

      {current?.status === "unavailable" ? (
        <div className="labNotice">
          {current.message} <a href={current.localUrl}>로컬 주소 열기</a>
        </div>
      ) : null}

      {history?.status === "error" ? (
        <div className="labError" role="alert">
          {history.message}
        </div>
      ) : null}

      {history?.status === "unavailable" ? (
        <div className="labNotice">{history.message}</div>
      ) : null}

      {history?.status === "ready" ? (
        <>
          <LabSummary history={history} current={current} />
          <section className="labWorkspace" aria-label="Attention 실행 기록">
            <RecentRuns
              entries={history.entries}
              selectedRunId={selectedEntry?.runId ?? null}
              onSelect={setSelectedRunId}
            />
            <RunInspector entry={selectedEntry} current={current} />
          </section>
          <p className="labRetentionNote">
            최근 {history.retentionDays}일의 metadata-only 기록입니다. 사용자
            피드백은 평가 후보이며 자동으로 Golden Dataset에 반영되지
            않습니다.
          </p>
        </>
      ) : null}
    </main>
  );
}

function LabSummary({
  history,
  current
}: {
  history: Extract<AttentionHistoryResponse, { status: "ready" }>;
  current: AttentionApiResponse | null;
}) {
  const latest = history.entries[0] ?? null;
  const latestFailure = history.failures[0] ?? null;
  const currentStatus =
    current?.status === "ready"
      ? decisionLabel(current.result.decision.status)
      : current?.status === "error"
        ? "실행 오류"
        : current?.status === "unavailable"
          ? "로컬에서 사용 불가"
          : latest
            ? decisionLabel(latest.decisionStatus)
            : "아직 실행 없음";
  return (
    <section className="labSummaryGrid" aria-label="최근 요약">
      <SummaryCard
        label="현재 결과"
        value={currentStatus}
        detail={
          current?.status === "ready"
            ? formatTimestamp(current.result.asOf)
            : latest
              ? `${formatTimestamp(latest.asOf)} 기록 기준`
              : "새 평가를 실행해주세요"
        }
      />
      <SummaryCard
        label="최근 실행"
        value={`${history.runCount}회`}
        detail={`추천 ${history.decisionCounts.suggested} · 근거 부족 ${history.decisionCounts.insufficient_evidence}`}
      />
      <SummaryCard
        label="명시적 피드백"
        value={`${history.feedbackCount}건`}
        detail={`현재 평가 ${history.feedbackCount} · 변경 기록 ${history.feedbackEventCount}`}
      />
      <SummaryCard
        label="실패한 평가"
        value={`${history.failureCount}회`}
        detail={
          latestFailure
            ? `${latestFailure.stage === "source_sync" ? "소스 동기화" : "Attention 해석"} · ${latestFailure.errorCode}`
            : "기록된 실패 없음"
        }
      />
      <SummaryCard
        label="보관 범위"
        value={`${history.retentionDays}일`}
        detail="private local metadata"
      />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="labSummaryCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RecentRuns({
  entries,
  selectedRunId,
  onSelect
}: {
  entries: AttentionHistoryEntry[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <aside className="labRunList" aria-labelledby="recent-run-title">
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">History</p>
          <h2 id="recent-run-title">최근 실행</h2>
        </div>
        <span>{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <p className="labEmpty">
          아직 기록이 없습니다. 새 평가를 실행해주세요.
        </p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.runId}>
              <button
                type="button"
                className={
                  entry.runId === selectedRunId ? "isSelected" : ""
                }
                aria-pressed={entry.runId === selectedRunId}
                aria-controls="attention-run-inspector"
                onClick={() => onSelect(entry.runId)}
              >
                <span
                  className={`labRunStatus labRunStatus-${entry.decisionStatus}`}
                >
                  {decisionLabel(entry.decisionStatus)}
                </span>
                <strong>{formatTimestamp(entry.asOf)}</strong>
                <small>
                  후보{" "}
                  {entry.candidateCounts.eligible +
                    entry.candidateCounts.provisional}
                  개 · {entry.latencyMs.toLocaleString("ko-KR")}ms
                </small>
                {entry.feedback.length > 0 ? (
                  <em>피드백 {entry.feedback.length}</em>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function RunInspector({
  entry,
  current
}: {
  entry: AttentionHistoryEntry | null;
  current: AttentionApiResponse | null;
}) {
  if (!entry) {
    return (
      <section className="labInspector" id="attention-run-inspector">
        <p className="labEmpty">
          확인할 실행 기록을 선택해주세요.
        </p>
      </section>
    );
  }
  const currentTitle =
    current?.status === "ready" &&
    current.run.runId === entry.runId &&
    current.result.decision.topSuggestion
      ? current.result.decision.topSuggestion.title
      : null;

  return (
    <section
      className="labInspector"
      id="attention-run-inspector"
      aria-labelledby="run-inspector-title"
      aria-live="polite"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Run inspector</p>
          <h2 id="run-inspector-title">
            {decisionLabel(entry.decisionStatus)}
          </h2>
        </div>
        <span>{entry.certainty ?? "미확정"}</span>
      </div>

      {currentTitle ? (
        <div className="labCurrentCandidate">
          <span>현재 사용자 화면의 top candidate</span>
          <strong>{currentTitle}</strong>
        </div>
      ) : null}

      <section className="labInspectorSection">
        <h3>Candidate funnel</h3>
        <div className="labFunnel">
          <div>
            <strong>{entry.candidateCounts.eligible}</strong>
            <span>확정</span>
          </div>
          <div>
            <strong>{entry.candidateCounts.provisional}</strong>
            <span>임시</span>
          </div>
          <div>
            <strong>{entry.candidateCounts.ineligible}</strong>
            <span>제외</span>
          </div>
        </div>
        <p className="labCodexMetric">
          Codex 과거 세션 맥락{" "}
          <strong>{entry.codexExecutionCount}개</strong> · 추천 후보에는
          포함하지 않음 · 원문과 짧은 발췌는 history에 저장하지 않음
        </p>
      </section>

      <section className="labInspectorSection">
        <h3>Candidate assessments</h3>
        {entry.candidateAssessmentDetailState === "not_recorded" ? (
          <p className="labEmpty">
            이 실행은 후보별 상세 기록을 추가하기 전에 생성됐습니다.
          </p>
        ) : entry.candidateAssessments.length > 0 ? (
          <ul className="labAssessmentList">
            {entry.candidateAssessments.map((assessment) => (
              <li key={assessment.assessmentId}>
                <div>
                  <strong>{assessment.taskKind}</strong>
                  <span>{assessment.disposition}</span>
                </div>
                <div>
                  <code>{assessment.candidateId ?? "candidate 없음"}</code>
                  <small>
                    {assessment.gateReasonCodes.length > 0
                      ? assessment.gateReasonCodes.join(" · ")
                      : "gate 통과"}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="labEmpty">평가된 GitHub 후보가 없습니다.</p>
        )}
      </section>

      <section className="labInspectorSection">
        <h3>Source coverage</h3>
        <ul className="labSourceList">
          {entry.sources.map((source) => (
            <li key={source.source}>
              <div>
                <strong>
                  {source.source === "github" ? "GitHub" : "Codex"}
                </strong>
                <span>
                  {source.inputState === "available"
                    ? `${source.freshness} · ${source.completeness}`
                    : source.inputState}
                </span>
              </div>
              <div>
                <span>signals {source.signalCount}</span>
                <small>
                  {source.snapshotFetchedAt
                    ? formatTimestamp(source.snapshotFetchedAt)
                    : source.unavailableReason}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <CodeSection
        title="Decision reasons"
        values={entry.decisionReasonCodes}
      />
      <CodeSection title="Caveats" values={entry.caveatCodes} />
      {entry.errors.length > 0 ? (
        <CodeSection
          title="Sanitized errors"
          values={entry.errors.map(
            (error) => `${error.source}:${error.code}`
          )}
        />
      ) : null}

      <details className="labTechnical">
        <summary>버전과 integrity 정보</summary>
        <dl>
          <TechnicalValue label="Run ID" value={entry.runId} />
          <TechnicalValue label="Result ID" value={entry.resultId} />
          <TechnicalValue
            label="Top candidate ID"
            value={entry.topCandidateId ?? "none"}
          />
          <TechnicalValue
            label="Input SHA-256"
            value={entry.inputSha256}
          />
          <TechnicalValue
            label="Result SHA-256"
            value={entry.resultSha256}
          />
          <TechnicalValue
            label="Orchestrator"
            value={entry.orchestratorVersion}
          />
          <TechnicalValue
            label="Freshness policy"
            value={entry.freshnessPolicyVersion}
          />
          <TechnicalValue
            label="Effective TTL"
            value={`GitHub ${entry.freshnessPolicy.githubMaxAgeMs}ms · Codex ${entry.freshnessPolicy.codexMaxAgeMs}ms · skew ${entry.freshnessPolicy.maxFutureClockSkewMs}ms`}
          />
          <TechnicalValue label="Policy" value={entry.policyVersion} />
          <TechnicalValue
            label="GitHub rule"
            value={entry.githubCandidateRuleVersion}
          />
          <TechnicalValue
            label="Codex rule"
            value={entry.codexOverviewRuleVersion}
          />
          <TechnicalValue
            label="Base commit"
            value={entry.codeCommitSha ?? "local-unrecorded"}
          />
        </dl>
      </details>

      {entry.feedback.length > 0 ? (
        <section className="labInspectorSection">
          <h3>명시적 피드백</h3>
          <ul className="labFeedbackList">
            {entry.feedback.map((feedback) => (
              <li key={feedback.feedbackId}>
                <strong>
                  {feedbackLabel(feedback.feedbackType)}
                  {feedback.supersedesFeedbackId ? " · 수정" : ""}
                </strong>
                <time dateTime={feedback.createdAt}>
                  {formatTimestamp(feedback.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function CodeSection({
  title,
  values
}: {
  title: string;
  values: string[];
}) {
  return (
    <section className="labInspectorSection">
      <h3>{title}</h3>
      {values.length > 0 ? (
        <ul className="labCodeList">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="labEmpty">기록 없음</p>
      )}
    </section>
  );
}

function TechnicalValue({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function decisionLabel(
  status: AttentionHistoryEntry["decisionStatus"]
): string {
  switch (status) {
    case "suggested":
      return "추천 생성";
    case "needs_clarification":
      return "확인 필요";
    case "no_action":
      return "개입 없음";
    case "insufficient_evidence":
      return "근거 부족";
  }
}

function feedbackLabel(
  type: AttentionHistoryEntry["feedback"][number]["feedbackType"]
): string {
  switch (type) {
    case "helpful":
      return "적절함";
    case "wrong_priority":
      return "우선순위 아님";
    case "already_done":
      return "이미 끝남";
    case "not_mine":
      return "내 일이 아님";
    case "insufficient_context":
      return "근거 부족";
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

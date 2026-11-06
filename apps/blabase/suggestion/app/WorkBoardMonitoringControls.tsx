"use client";

import type { WorkBoardMonitoringStateResponse } from "../src/suggestionBoard/monitoring/contracts";

export function WorkBoardMonitoringControls({
  enabled,
  state,
  error,
  pending,
  onConsent,
  onPurge
}: {
  enabled: boolean;
  state: WorkBoardMonitoringStateResponse | null;
  error: string | null;
  pending: boolean;
  onConsent: (consent: boolean) => void;
  onPurge: () => void;
}) {
  if (!enabled) return null;
  return (
    <section
      className="workBoardMonitoring"
      aria-labelledby="work-board-monitoring-title"
    >
      <header>
        <p className="eyebrow">Local dogfood</p>
        <h2 id="work-board-monitoring-title">Work Board 피드백</h2>
        <p>
          명시적으로 동의한 뒤 Continuation과 Setup 표시 결과에만 피드백을
          기록합니다. 순위·Gold·릴리스 판단에는 반영하지 않습니다.
        </p>
      </header>
      {error !== null ? <p role="alert">{error}</p> : null}
      {state === null ? (
        <p>로컬 모니터링 상태를 확인할 수 없습니다.</p>
      ) : (
        <>
          <p>
            동의 상태: <strong>{state.consent ? "사용 중" : "사용 안 함"}</strong>
          </p>
          <p>
            표시 대상 {state.aggregate.eligibleDistinct} · 응답 대상{" "}
            {state.aggregate.ratedDistinct} · 이벤트 {state.aggregate.eventCount}
          </p>
          <div className="workBoardMonitoringActions">
            <button
              type="button"
              disabled={pending || state.consent}
              onClick={() => onConsent(true)}
            >
              피드백 사용 동의
            </button>
            <button
              type="button"
              disabled={pending || !state.consent}
              onClick={() => onConsent(false)}
            >
              동의 철회
            </button>
          </div>
          {state.history.length === 0 ? (
            <p>기록된 피드백 없음</p>
          ) : (
            <ol aria-label="최근 Work Board 피드백 기록">
              {state.history.map((entry, index) => (
                <li key={`${entry.occurredAt}-${entry.eventType}-${index}`}>
                  <time dateTime={entry.occurredAt}>
                    {formatTimestamp(entry.occurredAt)}
                  </time>{" "}
                  {historyCopy(entry.eventType, entry.feedback)}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className="workBoardMonitoringActions">
        <button type="button" disabled={pending} onClick={onPurge}>
          모니터링 데이터 모두 삭제
        </button>
      </div>
    </section>
  );
}

function historyCopy(
  eventType: WorkBoardMonitoringStateResponse["history"][number]["eventType"],
  feedback: WorkBoardMonitoringStateResponse["history"][number]["feedback"]
): string {
  if (eventType === "consent_granted") return "피드백 사용 동의";
  if (eventType === "consent_revoked") return "피드백 사용 철회";
  if (eventType === "render_confirmed") return "표시 결과 확인 기록";
  if (eventType === "feedback_reset") return "피드백 초기화";
  return feedback === "useful" ? "유용함" : "유용하지 않음";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

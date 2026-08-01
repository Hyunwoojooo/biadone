"use client";

import { useCallback, useState } from "react";

import {
  fetchManagedCodexRuns,
  type ManagedCodexContinuity,
  type ManagedCodexExecutionState,
  type ManagedCodexItemType,
  type ManagedCodexPublicRun,
  type ManagedCodexRunsReadyResponse,
  type ManagedCodexSourceEvent,
  type ManagedCodexStreamState
} from "./managedCodexRunsClient";
import { useVisiblePolling } from "./sync/useSourceSync";

const MANAGED_RUN_POLL_INTERVAL_MS = 2_000;
const MANAGED_RUN_MAX_BACKOFF_MS = 30_000;
const MAX_VISIBLE_MANAGED_RUNS = 8;

export function ManagedCodexProgress() {
  const [payload, setPayload] =
    useState<ManagedCodexRunsReadyResponse | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetchManagedCodexRuns();
      if (response.status !== "ready") {
        setNotice(
          response.message ??
            "Blabase가 관리하는 Codex 실행 상태를 확인할 수 없습니다."
        );
        return;
      }
      // Liveness is also derived from the current Companion owner heartbeat.
      // It can safely degrade while the persisted event revision stays the
      // same, so every no-store projection must replace the previous view.
      setPayload(response);
      setNotice(null);
    } catch (error) {
      setNotice(
        "Codex 실시간 관찰 상태를 갱신하지 못했습니다. 마지막으로 검증된 상태만 표시합니다."
      );
      throw error;
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useVisiblePolling(load, {
    intervalMs: MANAGED_RUN_POLL_INTERVAL_MS,
    maxBackoffMs: MANAGED_RUN_MAX_BACKOFF_MS
  });

  const visibleRuns = payload?.runs.slice(0, MAX_VISIBLE_MANAGED_RUNS) ?? [];

  return (
    <section
      className="managedCodexProgress attentionSubsection"
      aria-labelledby="managed-codex-progress-title"
      aria-busy={isInitialLoading}
    >
      <div className="attentionSubsectionHeader">
        <div>
          <p className="eyebrow">Managed execution</p>
          <h3 id="managed-codex-progress-title">Codex 실시간 진행</h3>
        </div>
        <span>{payload ? `${payload.runs.length}개` : "관찰 전용"}</span>
      </div>

      <p className="managedCodexBoundary">
        관찰 전용 · 추천 우선순위에 반영하지 않음
      </p>

      <div aria-live="polite" aria-atomic="false">
        {isInitialLoading && payload === null ? (
          <p className="managedCodexEmpty" role="status">
            Blabase가 직접 관리하는 Codex 실행을 확인하고 있습니다.
          </p>
        ) : payload === null ? (
          <p className="managedCodexEmpty">
            {notice ??
              "Blabase가 관리하는 Codex 실행 상태를 확인할 수 없습니다."}
          </p>
        ) : payload.runs.length === 0 ? (
          <p className="managedCodexEmpty">
            현재 Blabase가 직접 관리하며 실시간으로 관찰하는 Codex run이
            없습니다. 과거 Codex 세션 기록은 아래의 과거 작업 맥락에서
            별도로 확인할 수 있습니다.
          </p>
        ) : (
          <>
            {notice ? (
              <p className="managedCodexNotice" role="status">
                {notice}
              </p>
            ) : null}
            <ul className="managedCodexRunList">
              {visibleRuns.map((run) => (
                <ManagedCodexRunItem key={run.managedRunId} run={run} />
              ))}
            </ul>
            {payload.runs.length > MAX_VISIBLE_MANAGED_RUNS ? (
              <p className="managedCodexRemainder">
                이외 {payload.runs.length - MAX_VISIBLE_MANAGED_RUNS}개 run은
                현재 목록에서 접었습니다.
              </p>
            ) : null}
          </>
        )}
      </div>

      {payload ? (
        <p className="managedCodexAsOf">
          마지막 projection{" "}
          <time dateTime={payload.generatedAt}>
            {formatTimestamp(payload.generatedAt)}
          </time>
        </p>
      ) : null}
    </section>
  );
}

function ManagedCodexRunItem({ run }: { run: ManagedCodexPublicRun }) {
  const tone = managedRunTone(run);
  const currentWaitingState =
    run.liveObservationAvailable &&
    run.streamState === "connected" &&
    run.continuity === "continuous"
      ? run.waitingState
      : null;

  return (
    <li className={`is${capitalize(tone)}`}>
      <div className="managedCodexRunMain">
        <div className="managedCodexRunTitle">
          <strong>Codex managed run</strong>
          <span className="monoValue">{shortManagedRunId(run.managedRunId)}</span>
        </div>
        <div className="managedCodexRunState">
          <span>{effectiveExecutionLabel(run)}</span>
          {currentWaitingState ? (
            <span className="managedCodexWaiting">
              {currentWaitingState === "waiting_on_user_input"
                ? "사용자 입력 대기"
                : "승인 대기"}
            </span>
          ) : null}
        </div>
        <p>
          최근 관찰: {sourceEventLabel(run.sourceEvent, run.itemType)} ·{" "}
          <time dateTime={run.lastObservedAt}>
            {formatTimestamp(run.lastObservedAt)}
          </time>
        </p>
      </div>
      <dl className="managedCodexRunMeta">
        <div>
          <dt>연결</dt>
          <dd>{streamStateLabel(run.streamState)}</dd>
        </div>
        <div>
          <dt>연속성</dt>
          <dd>{continuityLabel(run.continuity)}</dd>
        </div>
        <div>
          <dt>마지막 검증 상태</dt>
          <dd>{executionStateLabel(run.lastVerifiedExecutionState)}</dd>
        </div>
      </dl>
    </li>
  );
}

function effectiveExecutionLabel(run: ManagedCodexPublicRun): string {
  if (run.streamState === "disconnected") {
    return "연결 끊김 · 현재 상태 미확인";
  }
  if (run.streamState === "connecting") {
    return "실시간 연결 확인 중";
  }
  if (run.streamState === "closed") {
    return run.effectiveExecutionState === "unknown"
      ? "관찰 종료 · 현재 상태 미확인"
      : `관찰 종료 · ${executionStateLabel(
          run.effectiveExecutionState
        )}`;
  }
  if (
    run.continuity === "gap_detected" &&
    run.effectiveExecutionState === "unknown"
  ) {
    return "이벤트 누락 · 현재 상태 미확인";
  }
  if (!run.liveObservationAvailable) return "실시간 검증 없음";
  return executionStateLabel(run.effectiveExecutionState);
}

function executionStateLabel(state: ManagedCodexExecutionState): string {
  switch (state) {
    case "running":
      return "진행 중";
    case "idle":
      return "현재 turn 없음";
    case "completed":
      return "최근 turn 완료";
    case "failed":
      return "최근 turn 실패";
    case "interrupted":
      return "최근 turn 중단";
    default:
      return "현재 상태 미확인";
  }
}

function streamStateLabel(state: ManagedCodexStreamState): string {
  switch (state) {
    case "connecting":
      return "연결 중";
    case "connected":
      return "실시간 연결됨";
    case "disconnected":
      return "재연결 필요";
    case "closed":
      return "관찰 종료";
  }
}

function continuityLabel(continuity: ManagedCodexContinuity): string {
  switch (continuity) {
    case "continuous":
      return "연속 검증됨";
    case "gap_detected":
      return "이벤트 누락 감지";
    case "unverified":
      return "연속성 미확인";
  }
}

function sourceEventLabel(
  event: ManagedCodexSourceEvent,
  itemType: ManagedCodexItemType
): string {
  switch (event) {
    case "run_started":
      return "관리 시작";
    case "stream_connected":
      return "실시간 stream 연결";
    case "stream_reconnected":
      return "실시간 stream 재연결";
    case "stream_disconnected":
      return "실시간 stream 연결 끊김";
    case "thread_status_changed":
      return "thread 상태 변경";
    case "turn_started":
      return "turn 시작";
    case "turn_completed":
      return "turn 종료";
    case "item_started":
      return `${itemTypeLabel(itemType)} 시작`;
    case "item_completed":
      return `${itemTypeLabel(itemType)} 완료`;
    case "run_failed":
      return "관리 run 실패";
    case "run_closed":
      return "관리 run 종료";
  }
}

function itemTypeLabel(type: ManagedCodexItemType): string {
  switch (type) {
    case "user_message":
      return "사용자 메시지";
    case "agent_message":
      return "Codex 응답";
    case "command_execution":
      return "명령 실행";
    case "file_change":
      return "파일 변경";
    case "tool_call":
      return "도구 호출";
    case "collaboration":
      return "협업 작업";
    case "web_search":
      return "웹 검색";
    case "context_compaction":
      return "맥락 정리";
    case "reasoning":
      return "추론 단계";
    case "other":
    case null:
      return "작업 단계";
  }
}

function managedRunTone(
  run: ManagedCodexPublicRun
): "active" | "complete" | "warning" | "error" | "neutral" {
  if (
    run.lifecycle === "failed" ||
    run.effectiveExecutionState === "failed"
  ) {
    return "error";
  }
  if (
    !run.liveObservationAvailable ||
    run.streamState === "disconnected" ||
    run.continuity !== "continuous"
  ) {
    return "warning";
  }
  if (
    run.effectiveExecutionState === "completed" ||
    run.lifecycle === "ended"
  ) {
    return "complete";
  }
  if (
    run.streamState === "connected" &&
    run.effectiveExecutionState === "running"
  ) {
    return "active";
  }
  return "neutral";
}

function shortManagedRunId(value: string): string {
  const opaque = value.startsWith("managed_run_")
    ? value.slice("managed_run_".length)
    : value;
  return opaque.length > 8 ? `${opaque.slice(0, 8)}…` : opaque;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

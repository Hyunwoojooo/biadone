"use client";

import type {
  SourceSyncName,
  SourceSyncState
} from "./sourceSyncClient";
import {
  useSourceSyncRuntime,
  useSourceSyncStatus
} from "./useSourceSync";

export function SourceSyncMeta({
  source
}: {
  source: SourceSyncName;
}) {
  const sourceStatus = useSourceSyncStatus(source);
  const runtime = useSourceSyncRuntime();

  if (!sourceStatus) {
    if (runtime.polling.status !== "backoff") return null;
    return (
      <p className="sourceSyncMeta isWarning" role="status">
        동기화 상태 확인 재시도 중
        {runtime.polling.nextRetryAt
          ? ` · ${formatTime(runtime.polling.nextRetryAt)} 재시도`
          : ""}
      </p>
    );
  }

  const parts = [
    syncStateLabel(sourceStatus.status),
    sourceStatus.lastAttemptAt
      ? `마지막 시도 ${formatTimestamp(sourceStatus.lastAttemptAt)}`
      : null,
    sourceStatus.lastSuccessAt
      ? `마지막 성공 ${formatTimestamp(sourceStatus.lastSuccessAt)}`
      : null,
    sourceStatus.lastFailureAt
      ? sourceStatus.lastSuccessAt &&
        Date.parse(sourceStatus.lastSuccessAt) >=
          Date.parse(sourceStatus.lastFailureAt)
        ? `이전 실패 ${formatTimestamp(sourceStatus.lastFailureAt)} · 복구됨`
        : `최근 실패 ${formatTimestamp(sourceStatus.lastFailureAt)}`
      : null,
    sourceStatus.nextRetryAt
      ? `다음 재시도 ${formatTimestamp(sourceStatus.nextRetryAt)}`
      : null,
    sourceStatus.retryCount > 0
      ? `재시도 ${sourceStatus.retryCount}회`
      : null,
    sourceStatus.lastErrorCode
      ? `오류 ${sourceStatus.lastErrorCode}`
      : null,
    runtime.polling.status === "backoff"
      ? `상태 확인 재시도${
          runtime.polling.nextRetryAt
            ? ` ${formatTime(runtime.polling.nextRetryAt)}`
            : ""
        }`
      : null
  ].filter((part): part is string => part !== null);

  return (
    <p
      className={`sourceSyncMeta${
        sourceStatus.status === "error" ||
        sourceStatus.status === "backoff" ||
        runtime.polling.status === "backoff"
          ? " isWarning"
          : ""
      }`}
      role={
        sourceStatus.status === "error" ? "alert" : "status"
      }
    >
      {parts.join(" · ")}
    </p>
  );
}

function syncStateLabel(status: SourceSyncState): string {
  switch (status) {
    case "idle":
      return "사용 가능 · 자동 동기화 대기";
    case "syncing":
      return "동기화 중";
    case "backoff":
      return "일시 실패 · 자동 재시도";
    case "disconnected":
      return "연결 안 됨";
    case "error":
      return "동기화 오류";
  }
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(value);
}

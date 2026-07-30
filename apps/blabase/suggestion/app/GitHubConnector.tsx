"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  GitHubConnectionState,
  GitHubTaskKind
} from "../src/connectors/github/types";
import { SourceSyncMeta } from "./sync/SourceSyncMeta";
import { invalidateSourceConsumers } from "./sync/invalidationBus";
import { requestSourceSync } from "./sync/sourceSyncClient";
import {
  useSyncInvalidation,
  wakeSourceSyncStatus
} from "./sync/useSourceSync";

type GitHubNotice = {
  tone: "success" | "neutral" | "error";
  message: string;
};

type GitHubDisconnectResult = {
  status: "disconnected";
  remoteRevocationFailed?: boolean;
};

export function GitHubConnector() {
  const [connection, setConnection] =
    useState<GitHubConnectionState | null>(null);
  const [notice, setNotice] = useState<GitHubNotice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const requestSequenceRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const interactiveRefreshSequenceRef = useRef<number | null>(null);

  const refreshConnection = useCallback(
    async (
      forceRefresh = false,
      silent = false
    ): Promise<boolean> => {
      if (
        silent &&
        interactiveRefreshSequenceRef.current !== null
      ) {
        return false;
      }
      const requestSequence = ++requestSequenceRef.current;
      const mutationEpoch = mutationEpochRef.current;
      if (!silent) {
        interactiveRefreshSequenceRef.current = requestSequence;
        setIsRefreshing(true);
      }
      try {
        if (forceRefresh) await requestSourceSync(["github"]);
        const response = await fetch("/api/connectors/github/status", {
          cache: "no-store"
        });
        if (!response.ok) throw new Error("status request failed");
        const payload = (await response.json()) as GitHubConnectionState;
        if (
          requestSequence !== requestSequenceRef.current ||
          mutationEpoch !== mutationEpochRef.current
        ) {
          return false;
        }
        setConnection(payload);
        return true;
      } catch {
        if (
          requestSequence !== requestSequenceRef.current ||
          mutationEpoch !== mutationEpochRef.current
        ) {
          return false;
        }
        if (!silent) {
          setConnection((current) => ({
            status: "sync_error",
            message:
              "연결 상태를 확인하지 못했습니다. 로컬 서버를 확인해주세요.",
            lastSyncedAt:
              current?.status === "connected"
                ? current.lastSyncedAt
                : current?.status === "sync_error"
                  ? current.lastSyncedAt
                  : null
          }));
        }
        return false;
      } finally {
        if (
          !silent &&
          interactiveRefreshSequenceRef.current === requestSequence
        ) {
          interactiveRefreshSequenceRef.current = null;
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  const refreshAndInvalidate = useCallback(async () => {
    const updated = await refreshConnection(true);
    if (!updated) return;
    invalidateSourceConsumers("github", "manual_refresh");
    wakeSourceSyncStatus();
  }, [refreshConnection]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("github");
    if (status) {
      setNotice(githubNotice(status));
      params.delete("github");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${
          window.location.hash
        }`
      );
    }
    void refreshConnection();
  }, [refreshConnection]);

  useSyncInvalidation(["github"], () => {
    void refreshConnection(false, true);
  });

  async function disconnect() {
    mutationEpochRef.current += 1;
    requestSequenceRef.current += 1;
    interactiveRefreshSequenceRef.current = null;
    setIsDisconnecting(true);
    setIsRefreshing(false);
    setNotice(null);
    let succeeded = false;
    try {
      const response = await fetch("/api/connectors/github/disconnect", {
        method: "POST"
      });
      if (!response.ok) throw new Error("disconnect failed");
      const payload = (await response.json()) as GitHubDisconnectResult;
      setConnection({ status: "disconnected" });
      setNotice({
        tone: payload.remoteRevocationFailed ? "error" : "neutral",
        message: payload.remoteRevocationFailed
          ? "로컬 데이터는 삭제했지만 GitHub 사용자 승인을 폐기하지 못했습니다. GitHub 설정의 Applications에서 직접 취소해주세요."
          : "GitHub 사용자 승인을 해제하고 로컬 미리보기 데이터를 삭제했습니다."
      });
      succeeded = true;
    } catch {
      setNotice({
        tone: "error",
        message: "연결을 해제하지 못했습니다. 잠시 후 다시 시도해주세요."
      });
    } finally {
      setIsDisconnecting(false);
    }
    if (succeeded) {
      invalidateSourceConsumers("github", "disconnect");
      wakeSourceSyncStatus();
    }
  }

  return (
    <section
      className="calendarSection"
      aria-labelledby="github-title"
      aria-busy={isRefreshing || isDisconnecting}
    >
      <div className="calendarHeader">
        <div>
          <p className="calendarKicker">데이터 연결</p>
          <h2 id="github-title">GitHub</h2>
        </div>
        <GitHubStatusBadge connection={connection} />
      </div>

      <p className="calendarDescription">
        사용자가 선택한 저장소의 이슈·PR 제목과 상태를 읽기 전용으로
        확인합니다. 코드·본문·댓글은 저장하지 않습니다.
      </p>
      <SourceSyncMeta source="github" />

      {notice ? (
        <p
          className={`calendarNotice calendarNotice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <GitHubConnectionBody
        connection={connection}
        isRefreshing={isRefreshing}
        isDisconnecting={isDisconnecting}
        onRefresh={() => void refreshAndInvalidate()}
        onDisconnect={() => void disconnect()}
      />
    </section>
  );
}

function GitHubStatusBadge({
  connection
}: {
  connection: GitHubConnectionState | null;
}) {
  const connected = connection?.status === "connected";
  const fullyConnected =
    connected && connection.installationCount > 0;
  return (
    <span
      className={`calendarStatus ${fullyConnected ? "isConnected" : ""}`}
      aria-live="polite"
    >
      {connection === null
        ? "확인 중"
        : fullyConnected
          ? "연결됨"
          : connected
            ? "저장소 선택 필요"
            : connection.status === "unavailable"
              ? "설정 필요"
              : connection.status === "reauthorization_required"
                ? "다시 연결 필요"
                : "연결 안 됨"}
    </span>
  );
}

function GitHubConnectionBody({
  connection,
  isRefreshing,
  isDisconnecting,
  onRefresh,
  onDisconnect
}: {
  connection: GitHubConnectionState | null;
  isRefreshing: boolean;
  isDisconnecting: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  if (connection === null) {
    return (
      <button className="calendarPrimaryButton" type="button" disabled>
        연결 상태 확인 중
      </button>
    );
  }

  if (connection.status === "unavailable") {
    return (
      <div className="calendarActionBlock">
        <p>{connection.message}</p>
        {connection.localUrl ? (
          <a className="calendarPrimaryButton" href={connection.localUrl}>
            로컬 주소로 열기
          </a>
        ) : null}
      </div>
    );
  }

  if (
    connection.status === "disconnected" ||
    connection.status === "reauthorization_required"
  ) {
    return (
      <div className="calendarActionBlock">
        {connection.status === "reauthorization_required" ? (
          <p role="alert">{connection.message}</p>
        ) : null}
        <a
          className="calendarPrimaryButton"
          href="/api/connectors/github/connect"
        >
          {connection.status === "reauthorization_required"
            ? "GitHub 다시 연결"
            : "GitHub 연결"}
        </a>
        <p>
          설치 과정에서 blabase가 확인할 저장소만 직접 선택할 수 있습니다.
        </p>
      </div>
    );
  }

  if (connection.status === "sync_error") {
    return (
      <div className="calendarActionBlock">
        <p role="alert">{connection.message}</p>
        {connection.lastSyncedAt ? (
          <p className="calendarMeta">
            마지막 확인 {formatGitHubTimestamp(connection.lastSyncedAt)}
          </p>
        ) : null}
        <button
          className="calendarPrimaryButton"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? "다시 확인 중" : "다시 확인"}
        </button>
      </div>
    );
  }

  if (connection.installationCount === 0) {
    return (
      <div className="calendarActionBlock">
        <p>
          @{connection.userLogin} 사용자 승인이 완료되었습니다. 이제 확인할
          저장소를 선택해주세요.
        </p>
        <a
          className="calendarPrimaryButton"
          href="/api/connectors/github/install"
        >
          GitHub App 설치 및 저장소 선택
        </a>
      </div>
    );
  }

  const previewTasks = connection.tasks.slice(0, 3);
  const hiddenTaskCount = Math.max(
    0,
    connection.taskCount - previewTasks.length
  );

  return (
    <div className="calendarConnectedBody">
      <div className="calendarSyncSummary">
        <p>
          @{connection.userLogin} 계정에서 선택한 저장소{" "}
          {connection.repositoryCount}개를 확인했습니다.
        </p>
        <span>
          마지막 확인 {formatGitHubTimestamp(connection.lastSyncedAt)}
        </span>
      </div>

      <p className="calendarMeta">
        담당 이슈 {connection.assignedIssueCount}개 · 리뷰 요청{" "}
        {connection.reviewRequestedPullRequestCount}개 · 내 열린 PR{" "}
        {connection.authoredPullRequestCount}개
        {connection.truncated ? " · 최대 수집 범위까지만 표시" : ""}
      </p>

      {previewTasks.length > 0 ? (
        <ol className="calendarEventList">
          {previewTasks.map((task) => (
            <li key={`${task.kind}-${task.id}`}>
              <time dateTime={task.updatedAt}>
                {formatGitHubTimestamp(task.updatedAt)} 수정
              </time>
              <span>
                {githubTaskLabel(task.kind)} · {task.repositoryFullName}#
                {task.number} ·{" "}
                <a
                  href={task.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {task.title}
                </a>
                {task.milestoneDueAt
                  ? ` · 마감 ${formatGitHubDate(task.milestoneDueAt)}`
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="calendarEmpty">
          선택한 저장소에서 지금 확인할 담당 이슈, 리뷰 요청, 열린 PR을 찾지
          못했습니다.
        </p>
      )}

      {hiddenTaskCount > 0 ? (
        <p className="calendarMore">
          이외에 {hiddenTaskCount}개 항목이 더 있습니다.
        </p>
      ) : null}

      <div className="calendarSecondaryActions">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing || isDisconnecting}
        >
          {isRefreshing ? "새로고침 중" : "GitHub 새로고침"}
        </button>
        <a href="/api/connectors/github/install">저장소 다시 선택</a>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={isRefreshing || isDisconnecting}
        >
          {isDisconnecting ? "연결 해제 중" : "연결 해제"}
        </button>
      </div>
    </div>
  );
}

function githubTaskLabel(kind: GitHubTaskKind): string {
  switch (kind) {
    case "assigned_issue":
      return "담당 이슈";
    case "review_requested_pull_request":
      return "리뷰 요청";
    case "authored_pull_request":
      return "내 열린 PR";
  }
}

function githubNotice(status: string): GitHubNotice {
  switch (status) {
    case "connected":
      return {
        tone: "success",
        message: "GitHub가 연결되었습니다."
      };
    case "connected_sync_pending":
      return {
        tone: "neutral",
        message:
          "GitHub는 연결됐습니다. 선택한 저장소를 다시 확인하고 있습니다."
      };
    case "installation_updated":
      return {
        tone: "success",
        message: "GitHub 저장소 선택을 반영했습니다."
      };
    case "installation_sync_pending":
      return {
        tone: "neutral",
        message:
          "GitHub 저장소 선택은 반영됐습니다. 데이터를 다시 확인하고 있습니다."
      };
    case "authorization_required":
      return {
        tone: "neutral",
        message: "저장소를 읽으려면 GitHub 사용자 승인이 필요합니다."
      };
    case "cancelled":
      return {
        tone: "neutral",
        message: "연결이 취소되었습니다. 원할 때 다시 시도할 수 있어요."
      };
    case "temporarily_unavailable":
      return {
        tone: "error",
        message:
          "GitHub 연결을 준비 중입니다. 운영자 GitHub App 설정을 확인해주세요."
      };
    case "local_only":
      return {
        tone: "neutral",
        message: "GitHub 연결은 로컬 서버에서만 사용할 수 있습니다."
      };
    default:
      return {
        tone: "error",
        message: "GitHub 연결을 완료하지 못했습니다. 다시 시도해주세요."
      };
  }
}

function formatGitHubTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatGitHubDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric"
  }).format(date);
}

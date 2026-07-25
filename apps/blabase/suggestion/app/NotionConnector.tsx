"use client";

import { useCallback, useEffect, useState } from "react";

import type { NotionConnectionState } from "../src/connectors/notion/types";

type NotionNotice = {
  tone: "success" | "neutral" | "error";
  message: string;
};

export function NotionConnector() {
  const [connection, setConnection] =
    useState<NotionConnectionState | null>(null);
  const [notice, setNotice] = useState<NotionNotice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const refreshConnection = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/connectors/notion/status", {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("status request failed");
      const payload = (await response.json()) as NotionConnectionState;
      setConnection(payload);
    } catch {
      setConnection({
        status: "sync_error",
        message: "연결 상태를 확인하지 못했습니다. 로컬 서버를 확인해주세요.",
        lastSyncedAt: null
      });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("notion");
    if (status) {
      setNotice(notionNotice(status));
      params.delete("notion");
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

  async function disconnect() {
    setIsDisconnecting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/connectors/notion/disconnect", {
        method: "POST"
      });
      if (!response.ok) throw new Error("disconnect failed");
      setConnection({ status: "disconnected" });
      setNotice({
        tone: "neutral",
        message: "Notion 연결과 로컬 미리보기 데이터를 삭제했습니다."
      });
    } catch {
      setNotice({
        tone: "error",
        message: "연결을 해제하지 못했습니다. 잠시 후 다시 시도해주세요."
      });
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <section
      className="calendarSection"
      aria-labelledby="notion-title"
      aria-busy={isRefreshing || isDisconnecting}
    >
      <div className="calendarHeader">
        <div>
          <p className="calendarKicker">데이터 연결</p>
          <h2 id="notion-title">Notion</h2>
        </div>
        <NotionStatusBadge connection={connection} />
      </div>

      <p className="calendarDescription">
        사용자가 선택해 공유한 페이지와 데이터 소스의 제목·수정 시각을 읽기
        전용으로 가져옵니다. 본문을 저장하거나 페이지를 수정하지 않습니다.
      </p>

      {notice ? (
        <p
          className={`calendarNotice calendarNotice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <NotionConnectionBody
        connection={connection}
        isRefreshing={isRefreshing}
        isDisconnecting={isDisconnecting}
        onRefresh={() => void refreshConnection()}
        onDisconnect={() => void disconnect()}
      />
    </section>
  );
}

function NotionStatusBadge({
  connection
}: {
  connection: NotionConnectionState | null;
}) {
  const connected = connection?.status === "connected";
  return (
    <span
      className={`calendarStatus ${connected ? "isConnected" : ""}`}
      aria-live="polite"
    >
      {connection === null
        ? "확인 중"
        : connected
          ? "연결됨"
          : "연결 안 됨"}
    </span>
  );
}

function NotionConnectionBody({
  connection,
  isRefreshing,
  isDisconnecting,
  onRefresh,
  onDisconnect
}: {
  connection: NotionConnectionState | null;
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
        <a className="calendarPrimaryButton" href="http://localhost:3102">
          로컬 주소로 열기
        </a>
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
          href="/api/connectors/notion/connect"
        >
          {connection.status === "reauthorization_required"
            ? "Notion 다시 연결"
            : "Notion 연결"}
        </a>
        <p>
          연결 과정에서 blabase에 보여줄 페이지만 직접 선택할 수 있습니다.
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
            마지막 확인 {formatNotionTimestamp(connection.lastSyncedAt)}
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

  return (
    <div className="calendarConnectedBody">
      <div className="calendarSyncSummary">
        <p>
          {connection.workspaceName
            ? `${connection.workspaceName}에서 `
            : ""}
          공유된 범위의 {connection.resourceCount}개 항목을 찾았습니다.
        </p>
        <span>
          마지막 확인 {formatNotionTimestamp(connection.lastSyncedAt)}
        </span>
      </div>

      <p className="calendarMeta">
        페이지 {connection.pageCount}개 · 데이터 소스{" "}
        {connection.dataSourceCount}개
        {connection.truncated ? " · 최대 수집 범위까지만 표시" : ""}
      </p>

      {connection.resources.length > 0 ? (
        <ol className="calendarEventList">
          {connection.resources.map((resource) => (
            <li key={`${resource.kind}-${resource.id}`}>
              <time dateTime={resource.lastEditedAt}>
                {formatNotionTimestamp(resource.lastEditedAt)} 수정
              </time>
              <span>
                {resource.kind === "page" ? "페이지" : "데이터 소스"} ·{" "}
                {resource.title}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="calendarEmpty">
          공유된 페이지를 아직 찾지 못했습니다. 다시 연결해 읽을 페이지를
          선택하거나 잠시 후 새로고침해주세요.
        </p>
      )}

      {connection.resourceCount > connection.resources.length ? (
        <p className="calendarMore">
          이외에 {connection.resourceCount - connection.resources.length}개
          항목이 더 있습니다.
        </p>
      ) : null}

      <div className="calendarSecondaryActions">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing || isDisconnecting}
        >
          {isRefreshing ? "새로고침 중" : "Notion 새로고침"}
        </button>
        <a href="/api/connectors/notion/connect">공유 페이지 다시 선택</a>
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

function notionNotice(status: string): NotionNotice {
  switch (status) {
    case "connected":
      return {
        tone: "success",
        message: "Notion이 연결되었습니다."
      };
    case "connected_sync_pending":
      return {
        tone: "neutral",
        message:
          "Notion은 연결됐습니다. 공유된 페이지를 다시 확인하고 있습니다."
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
          "Notion 연결을 준비 중입니다. 운영자 OAuth 설정을 확인해주세요."
      };
    case "local_only":
      return {
        tone: "neutral",
        message: "Notion 연결은 로컬 서버에서만 사용할 수 있습니다."
      };
    default:
      return {
        tone: "error",
        message: "Notion 연결을 완료하지 못했습니다. 다시 시도해주세요."
      };
  }
}

function formatNotionTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { CalendarConnectionState } from "../src/connectors/googleCalendar/types";
import { SOURCE_CONNECTION_ANCHORS } from "./sourceNavigation";
import { SourceSyncMeta } from "./sync/SourceSyncMeta";
import { invalidateSourceConsumers } from "./sync/invalidationBus";
import { requestSourceSync } from "./sync/sourceSyncClient";
import {
  useSyncInvalidation,
  wakeSourceSyncStatus
} from "./sync/useSourceSync";

type CalendarNotice = {
  tone: "success" | "neutral" | "error";
  message: string;
};

export function GoogleCalendarConnector() {
  const [connection, setConnection] =
    useState<CalendarConnectionState | null>(null);
  const [notice, setNotice] = useState<CalendarNotice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const requestSequenceRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const interactiveRefreshSequenceRef = useRef<number | null>(null);

  const refreshConnection = useCallback(async (
    silent = false,
    forceRefresh = false
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
      if (forceRefresh) {
        await requestSourceSync(["google_calendar"]);
      }
      const response = await fetch(
        "/api/connectors/google-calendar/status",
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("status request failed");
      const payload = (await response.json()) as CalendarConnectionState;
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
  }, []);

  const refreshAndInvalidate = useCallback(async () => {
    const updated = await refreshConnection(false, true);
    if (!updated) return;
    invalidateSourceConsumers("google_calendar", "manual_refresh");
    wakeSourceSyncStatus();
  }, [refreshConnection]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("calendar");
    if (status) {
      setNotice(calendarNotice(status));
      params.delete("calendar");
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

  useSyncInvalidation(["google_calendar"], () => {
    void refreshConnection(true);
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
      const response = await fetch(
        "/api/connectors/google-calendar/disconnect",
        { method: "POST" }
      );
      if (!response.ok) throw new Error("disconnect failed");
      setConnection({ status: "disconnected" });
      setNotice({
        tone: "neutral",
        message: "Google Calendar 연결과 로컬 일정 데이터를 삭제했습니다."
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
      invalidateSourceConsumers("google_calendar", "disconnect");
      wakeSourceSyncStatus();
    }
  }

  return (
    <section
      className="calendarSection sourceConnectorTarget"
      id={SOURCE_CONNECTION_ANCHORS["google-calendar"]}
      tabIndex={-1}
      aria-labelledby="google-calendar-title"
      aria-busy={isRefreshing || isDisconnecting}
    >
      <div className="calendarHeader">
        <div>
          <p className="calendarKicker">데이터 연결</p>
          <h2 id="google-calendar-title">Google Calendar</h2>
        </div>
        <CalendarStatusBadge connection={connection} />
      </div>

      <p className="calendarDescription">
        최근 일정과 다가오는 일정을 읽기 전용으로 가져옵니다. 일정을
        만들거나 수정하지 않습니다.
      </p>
      <SourceSyncMeta source="google_calendar" />

      {notice ? (
        <p
          className={`calendarNotice calendarNotice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <CalendarConnectionBody
        connection={connection}
        isRefreshing={isRefreshing}
        isDisconnecting={isDisconnecting}
        onRefresh={() => void refreshAndInvalidate()}
        onDisconnect={() => void disconnect()}
      />
    </section>
  );
}

function CalendarStatusBadge({
  connection
}: {
  connection: CalendarConnectionState | null;
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
          : connection.status === "unavailable"
            ? "설정 필요"
            : connection.status === "reauthorization_required"
              ? "다시 연결 필요"
              : "연결 안 됨"}
    </span>
  );
}

function CalendarConnectionBody({
  connection,
  isRefreshing,
  isDisconnecting,
  onRefresh,
  onDisconnect
}: {
  connection: CalendarConnectionState | null;
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
        <p role="alert">{connection.message}</p>
        {connection.localUrl ? (
          <a className="calendarPrimaryButton" href={connection.localUrl}>
            로컬 연결 화면 열기
          </a>
        ) : (
          <p className="calendarMeta">
            이 개발 베타에서는 Blabase 운영자가 Google OAuth 앱을 먼저
            준비해야 계정 연결을 시작할 수 있습니다.
          </p>
        )}
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
          href="/api/connectors/google-calendar/connect"
        >
          {connection.status === "reauthorization_required"
            ? "Google Calendar 다시 연결"
            : "Google Calendar 연결"}
        </a>
      </div>
    );
  }

  if (connection.status === "sync_error") {
    return (
      <div className="calendarActionBlock">
        <p role="alert">{connection.message}</p>
        {connection.lastSyncedAt ? (
          <p className="calendarMeta">
            마지막 확인 {formatSyncedAt(connection.lastSyncedAt)}
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
          지난 7일과 앞으로 14일에서 {connection.eventCount}개의 일정을
          가져왔습니다.
        </p>
        <span>마지막 확인 {formatSyncedAt(connection.lastSyncedAt)}</span>
      </div>

      {connection.events.length > 0 ? (
        <ol className="calendarEventList">
          {connection.events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.startAt}>
                {formatEventTime(event.startAt, event.allDay)}
              </time>
              <span>{event.title}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="calendarEmpty">
          앞으로 14일 안에 예정된 일정이 없습니다.
        </p>
      )}

      {connection.upcomingEventCount > connection.events.length ? (
        <p className="calendarMore">
          이외에 {connection.upcomingEventCount - connection.events.length}개
          일정이 더 있습니다.
        </p>
      ) : null}

      <div className="calendarSecondaryActions">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing || isDisconnecting}
        >
          {isRefreshing ? "새로고침 중" : "일정 새로고침"}
        </button>
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

function calendarNotice(status: string): CalendarNotice {
  switch (status) {
    case "connected":
      return {
        tone: "success",
        message: "Google Calendar가 연결되었습니다."
      };
    case "connected_sync_pending":
      return {
        tone: "neutral",
        message:
          "Google Calendar는 연결됐습니다. 일정을 다시 확인하고 있습니다."
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
          "지금은 Google Calendar에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."
      };
    case "local_only":
      return {
        tone: "neutral",
        message: "Google Calendar 연결은 로컬 서버에서만 사용할 수 있습니다."
      };
    default:
      return {
        tone: "error",
        message: "Google Calendar 연결을 완료하지 못했습니다. 다시 시도해주세요."
      };
  }
}

function formatEventTime(value: string, allDay: boolean): string {
  const date = allDay
    ? new Date(`${value}T00:00:00+09:00`)
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return allDay ? "종일" : value;
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    ...(allDay
      ? {}
      : {
          hour: "numeric",
          minute: "2-digit"
        })
  }).format(date);
  return allDay ? `${formatted} · 종일` : formatted;
}

function formatSyncedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "알 수 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

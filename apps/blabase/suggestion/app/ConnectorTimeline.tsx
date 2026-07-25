"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  ConnectorTimelineItem,
  ConnectorTimelineSource,
  ConnectorTimelineState,
  ConnectorTimelineTimestampKind
} from "../src/connectors/timeline/types";

type ReadyTimeline = Extract<
  ConnectorTimelineState,
  { status: "ready" }
>;

type TimelineGroup = {
  dateKey: string;
  label: string;
  items: ConnectorTimelineItem[];
};

const TIMEZONE = "Asia/Seoul";
const SOURCE_LABELS: Record<ConnectorTimelineSource, string> = {
  google_calendar: "Google Calendar",
  notion: "Notion",
  github: "GitHub",
  codex: "Codex"
};
const TIMESTAMP_LABELS: Record<
  ConnectorTimelineTimestampKind,
  string
> = {
  scheduled_start: "예정",
  last_edited: "수정",
  last_updated: "업데이트",
  activity_occurred: "활동",
  last_activity: "활동"
};

const dateHeadingFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short"
});
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const dueFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function ConnectorTimeline() {
  const [timeline, setTimeline] = useState<ReadyTimeline | null>(null);
  const [latestState, setLatestState] =
    useState<ConnectorTimelineState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestSequenceRef = useRef(0);

  const refreshTimeline = useCallback(async (silent = false) => {
    const requestSequence = ++requestSequenceRef.current;
    if (!silent) setIsRefreshing(true);

    try {
      const response = await fetch("/api/connectors/timeline", {
        cache: "no-store"
      });
      const payload = (await response.json()) as ConnectorTimelineState;
      if (requestSequence !== requestSequenceRef.current) return;

      setLatestState(payload);
      if (payload.status === "ready") {
        setTimeline(payload);
      }
    } catch {
      if (requestSequence !== requestSequenceRef.current) return;
      setLatestState({
        status: "error",
        message:
          "연결 데이터 타임라인을 읽지 못했습니다. 로컬 서버를 확인해주세요."
      });
    } finally {
      if (!silent && requestSequence === requestSequenceRef.current) {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshTimeline();
  }, [refreshTimeline]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshTimeline(true);
      }
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshTimeline]);

  const groups = useMemo(
    () => (timeline ? groupTimelineItems(timeline.items) : []),
    [timeline]
  );
  const statusMessage = timelineStatusMessage(
    timeline,
    latestState,
    isRefreshing
  );

  return (
    <section
      className="timelineSection"
      aria-labelledby="connector-timeline-title"
      aria-busy={isRefreshing}
    >
      <div className="timelineHeader">
        <div>
          <p className="calendarKicker">통합 데이터 보기</p>
          <h2 id="connector-timeline-title">연결 데이터 타임라인</h2>
        </div>
        <button
          className="timelineRefreshButton"
          type="button"
          onClick={() => void refreshTimeline()}
          disabled={isRefreshing}
        >
          {isRefreshing ? "읽는 중" : "로컬 목록 다시 읽기"}
        </button>
      </div>

      <p className="timelineDescription">
        캘린더는 일정이 시작되는 시각, Notion은 마지막 수정 시각,
        GitHub는 push·이슈·PR 같은 사용자 활동이 발생한 시각과 현재
        할 일의 업데이트 시각, Codex는 마지막 활동 시각을 사용합니다.
        Codex 작업 설명은 동의한 경우에만 표시합니다. GitHub 활동은
        실시간 기록이 아니어서 반영이 늦을 수 있습니다.
      </p>

      <p
        className={`timelineLoadStatus${
          latestState?.status === "error" ? " isError" : ""
        }`}
        role={latestState?.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {statusMessage}
      </p>

      {timeline ? (
        <>
          <ul className="timelineSourceSummary" aria-label="연결 소스별 항목 수">
            {timeline.sources.map((source) => (
              <li
                key={source.source}
                className={
                  source.state === "missing"
                    ? "isMissing"
                    : source.state === "partial"
                      ? "isPartial"
                      : undefined
                }
              >
                <strong>{SOURCE_LABELS[source.source]}</strong>
                <span>
                  {source.state === "missing"
                    ? "저장본 없음"
                    : `${source.itemCount}개`}
                  {source.state === "partial"
                    ? " · 사용자 활동 일부 확인 불가"
                    : ""}
                  {source.truncated ? " · 일부" : ""}
                  {source.skippedItemCount > 0
                    ? ` · 시간 누락 ${source.skippedItemCount}개`
                    : ""}
                </span>
              </li>
            ))}
          </ul>

          {timeline.truncated ? (
            <p className="timelineLimitNotice">
              일부 연결 데이터는 각 도구의 현재 수집 상한까지만
              표시됩니다. GitHub 활동은 실시간 기록이 아니며 반영이
              늦을 수 있습니다.
            </p>
          ) : null}

          {groups.length > 0 ? (
            <div className="timelineGroups">
              {groups.map((group) => (
                <section
                  className="timelineDay"
                  key={group.dateKey}
                  aria-labelledby={`timeline-day-${group.dateKey}`}
                >
                  <h3 id={`timeline-day-${group.dateKey}`}>
                    {group.label}
                  </h3>
                  <ol className="timelineList">
                    {group.items.map((item) => (
                      <li className="timelineItem" key={item.id}>
                        <div className="timelineRail" aria-hidden="true">
                          <span
                            className={`timelineDot timelineDot-${item.source}`}
                          />
                        </div>
                        <article>
                          <div className="timelineItemMeta">
                            <span
                              className={`timelineSource timelineSource-${item.source}`}
                            >
                              {SOURCE_LABELS[item.source]}
                            </span>
                            <time dateTime={item.occurredAt}>
                              {formatTimelineTime(item)}
                            </time>
                            <span>
                              {TIMESTAMP_LABELS[item.timestampKind]}
                            </span>
                          </div>
                          <h4>{item.title}</h4>
                          <p>{item.detail}</p>
                          {item.dueAt ? (
                            <p className="timelineDue">
                              마감 {formatDueAt(item.dueAt)}
                            </p>
                          ) : null}
                          {item.tags.length > 0 ? (
                            <ul
                              className="timelineTags"
                              aria-label="태그"
                            >
                              {item.tags.map((tag, index) => (
                                <li key={`${tag}-${index}`}>{tag}</li>
                              ))}
                            </ul>
                          ) : null}
                        </article>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : (
            <p className="timelineEmpty">
              아직 나열할 연결 데이터가 없습니다. 위에서 도구를 연결한 뒤
              각 연결의 새로고침을 눌러주세요.
            </p>
          )}
        </>
      ) : latestState?.status === "unavailable" ? (
        <p className="timelineEmpty">
          {latestState.message}{" "}
          <a href={latestState.localUrl}>로컬 서버 열기</a>
        </p>
      ) : latestState?.status === "error" ? (
        <p className="timelineEmpty">{latestState.message}</p>
      ) : (
        <p className="timelineEmpty">저장된 연결 데이터를 읽고 있습니다.</p>
      )}
    </section>
  );
}

function groupTimelineItems(
  items: ConnectorTimelineItem[]
): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();

  for (const item of items) {
    const date = new Date(item.occurredAt);
    const dateKey = timelineDateKey(date);
    const existing = groups.get(dateKey);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(dateKey, {
      dateKey,
      label: dateHeadingFormatter.format(date),
      items: [item]
    });
  }

  return [...groups.values()];
}

function formatTimelineTime(item: ConnectorTimelineItem): string {
  if (item.allDay) return "종일";

  const start = new Date(item.occurredAt);
  if (
    item.endAt &&
    timelineDateKey(start) === timelineDateKey(new Date(item.endAt))
  ) {
    return `${timeFormatter.format(start)}–${timeFormatter.format(
      new Date(item.endAt)
    )}`;
  }
  return timeFormatter.format(start);
}

function formatDueAt(value: string): string {
  return dueFormatter.format(new Date(value));
}

function timelineDateKey(date: Date): string {
  const parts = dateKeyFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function timelineStatusMessage(
  timeline: ReadyTimeline | null,
  latestState: ConnectorTimelineState | null,
  isRefreshing: boolean
): string {
  if (isRefreshing) {
    return timeline
      ? "기존 목록을 유지하면서 로컬 저장본을 다시 읽고 있습니다."
      : "로컬 저장본을 읽고 있습니다.";
  }
  if (latestState?.status === "error") {
    return timeline
      ? `${latestState.message} 마지막으로 읽은 목록을 그대로 표시합니다.`
      : latestState.message;
  }
  if (latestState?.status === "unavailable") {
    return latestState.message;
  }
  if (timeline) {
    return `${timeline.itemCount}개 항목을 최신 날짜부터 표시합니다.`;
  }
  return "로컬 저장본을 확인하고 있습니다.";
}

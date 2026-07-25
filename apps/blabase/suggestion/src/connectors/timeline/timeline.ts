import { createHash } from "node:crypto";

import { codexSnapshotMatchesConfig } from "../codex/connectionState";
import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../codex/localStore";
import type { CodexSnapshot } from "../codex/types";
import { readStoredGitHubSnapshot } from "../github/localStore";
import type {
  GitHubActivityKind,
  GitHubReviewState,
  GitHubSnapshot,
  GitHubTaskKind,
  GitHubUserActivitySignal
} from "../github/types";
import { readStoredSnapshot as readStoredGoogleCalendarSnapshot } from "../googleCalendar/localStore";
import type {
  GoogleCalendarEventStatus,
  GoogleCalendarSnapshot
} from "../googleCalendar/types";
import { readStoredNotionSnapshot } from "../notion/localStore";
import type {
  NotionResourceKind,
  NotionSnapshot
} from "../notion/types";
import type {
  ConnectorTimelineItem,
  ConnectorTimelineKind,
  ConnectorTimelineSource,
  ConnectorTimelineSourceSummary,
  ConnectorTimelineState
} from "./types";

export type ConnectorSnapshots = {
  googleCalendar: GoogleCalendarSnapshot | null;
  notion: NotionSnapshot | null;
  github: GitHubSnapshot | null;
  codex: CodexSnapshot | null;
};

const SOURCE_ORDER: ConnectorTimelineSource[] = [
  "google_calendar",
  "notion",
  "github",
  "codex"
];

export async function readConnectorTimeline(
  cwd = process.cwd(),
  now = new Date()
): Promise<ConnectorTimelineState> {
  const [googleCalendar, notion, github, codexConfig, codexSnapshot] =
    await Promise.all([
      readStoredGoogleCalendarSnapshot(cwd),
      readStoredNotionSnapshot(cwd),
      readStoredGitHubSnapshot(cwd),
      readStoredCodexConfig(cwd),
      readStoredCodexSnapshot(cwd)
    ]);
  const codex =
    codexConfig &&
    codexSnapshot &&
    codexSnapshotMatchesConfig(codexSnapshot, codexConfig)
      ? codexSnapshot
      : null;

  return buildConnectorTimeline(
    { googleCalendar, notion, github, codex },
    now
  );
}

export function buildConnectorTimeline(
  snapshots: ConnectorSnapshots,
  now = new Date()
): ConnectorTimelineState {
  const calendarItems = calendarTimelineItems(snapshots.googleCalendar);
  const notionItems = notionTimelineItems(snapshots.notion);
  const githubItems = githubTimelineItems(snapshots.github);
  const codexItems = codexTimelineItems(snapshots.codex);
  const items = [
    ...calendarItems,
    ...notionItems,
    ...githubItems,
    ...codexItems
  ].sort(compareTimelineItems);
  const sources: ConnectorTimelineSourceSummary[] = [
    sourceSummary(
      "google_calendar",
      calendarItems.length,
      (snapshots.googleCalendar?.events.length ?? 0) -
        calendarItems.length,
      snapshots.googleCalendar?.fetchedAt ?? null,
      false,
      snapshots.googleCalendar ? "available" : "missing"
    ),
    sourceSummary(
      "notion",
      notionItems.length,
      (snapshots.notion?.resources.length ?? 0) - notionItems.length,
      snapshots.notion?.fetchedAt ?? null,
      snapshots.notion?.truncated ?? false,
      snapshots.notion ? "available" : "missing"
    ),
    sourceSummary(
      "github",
      githubItems.length,
      (snapshots.github
        ? snapshots.github.activities.length +
          snapshots.github.tasks.length
        : 0) - githubItems.length,
      snapshots.github?.fetchedAt ?? null,
      Boolean(
        snapshots.github?.truncated ||
          snapshots.github?.activitiesTruncated
      ),
      !snapshots.github
        ? "missing"
        : snapshots.github.activitiesState === "available"
          ? "available"
          : "partial"
    ),
    sourceSummary(
      "codex",
      codexItems.length,
      (snapshots.codex?.sessions.length ?? 0) - codexItems.length,
      snapshots.codex?.fetchedAt ?? null,
      snapshots.codex?.truncated ?? false,
      snapshots.codex ? "available" : "missing"
    )
  ];

  return {
    status: "ready",
    schemaVersion: "connector-timeline-v2",
    timezone: "Asia/Seoul",
    generatedAt: now.toISOString(),
    itemCount: items.length,
    truncated: sources.some((source) => source.truncated),
    sources,
    items
  };
}

function calendarTimelineItems(
  snapshot: GoogleCalendarSnapshot | null
): ConnectorTimelineItem[] {
  if (!snapshot) return [];
  return snapshot.events.flatMap((event) => {
    const occurredAt = normalizeTimestamp(event.startAt);
    if (!occurredAt) return [];
    return [
      {
        id: timelineId("google_calendar", event.kind, event.id),
        source: "google_calendar",
        kind: "calendar_event",
        occurredAt,
        timestampKind: "scheduled_start",
        endAt: normalizeTimestamp(event.endAt),
        dueAt: null,
        allDay: event.allDay,
        title: safeText(event.title, "제목 없는 일정"),
        detail: [
          calendarStatusLabel(event.status),
          event.allDay ? "종일" : null
        ]
          .filter(Boolean)
          .join(" · "),
        tags:
          event.eventType && event.eventType !== "default"
            ? [safeText(event.eventType, "일정")]
            : []
      }
    ];
  });
}

function notionTimelineItems(
  snapshot: NotionSnapshot | null
): ConnectorTimelineItem[] {
  if (!snapshot) return [];
  return snapshot.resources.flatMap((resource) => {
    const occurredAt = normalizeTimestamp(resource.lastEditedAt);
    if (!occurredAt) return [];
    const kind = notionTimelineKind(resource.kind);
    return [
      {
        id: timelineId("notion", kind, resource.id),
        source: "notion",
        kind,
        occurredAt,
        timestampKind: "last_edited",
        endAt: null,
        dueAt: null,
        allDay: false,
        title: safeText(resource.title, "제목 없는 Notion 항목"),
        detail:
          resource.kind === "page" ? "페이지 수정" : "데이터 소스 수정",
        tags: []
      }
    ];
  });
}

function githubTimelineItems(
  snapshot: GitHubSnapshot | null
): ConnectorTimelineItem[] {
  if (!snapshot) return [];
  const activityItems = snapshot.activities.flatMap((activity) => {
    const occurredAt = normalizeTimestamp(activity.occurredAt);
    if (!occurredAt) return [];
    const kind = githubActivityTimelineKind(activity.activityKind);
    return [
      {
        id: timelineId("github", kind, activity.id),
        source: "github" as const,
        kind,
        occurredAt,
        timestampKind: "activity_occurred" as const,
        endAt: null,
        dueAt: null,
        allDay: false,
        title: githubActivityTitle(activity),
        detail: githubActivityDetail(activity),
        tags: []
      }
    ];
  });
  const taskItems = snapshot.tasks.flatMap((task) => {
    const occurredAt = normalizeTimestamp(task.updatedAt);
    if (!occurredAt) return [];
    const kind = githubTimelineKind(task.kind);
    return [
      {
        id: timelineId("github", kind, String(task.id)),
        source: "github" as const,
        kind,
        occurredAt,
        timestampKind: "last_updated" as const,
        endAt: null,
        dueAt: task.milestoneDueAt
          ? normalizeTimestamp(task.milestoneDueAt)
          : null,
        allDay: false,
        title: safeText(task.title, "제목 없는 GitHub 항목"),
        detail: `${safeText(
          task.repositoryFullName,
          "저장소"
        )} #${task.number} · 현재 ${githubTaskLabel(task.kind)}`,
        tags: [
          ...new Set(
            task.labelNames
              .map((label) => safeText(label, ""))
              .filter(Boolean)
          )
        ]
      }
    ];
  });

  return [...activityItems, ...taskItems];
}

function codexTimelineItems(
  snapshot: CodexSnapshot | null
): ConnectorTimelineItem[] {
  if (!snapshot) return [];
  return snapshot.sessions.flatMap((session) => {
    const occurredAt = normalizeTimestamp(session.updatedAt);
    if (!occurredAt) return [];
    return [
      {
        id: timelineId("codex", "codex_session", session.id),
        source: "codex",
        kind: "codex_session",
        occurredAt,
        timestampKind: "last_activity",
        endAt: null,
        dueAt: null,
        allDay: false,
        title: safeText(
          session.taskSummary ?? session.projectLabel,
          "Codex 작업"
        ),
        detail: codexTaskDetail(
          session.projectLabel,
          session.taskSummarySource
        ),
        tags: []
      }
    ];
  });
}

function compareTimelineItems(
  left: ConnectorTimelineItem,
  right: ConnectorTimelineItem
): number {
  return (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    SOURCE_ORDER.indexOf(left.source) -
      SOURCE_ORDER.indexOf(right.source) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  );
}

function sourceSummary(
  source: ConnectorTimelineSource,
  itemCount: number,
  skippedItemCount: number,
  snapshotFetchedAt: string | null,
  truncated: boolean,
  state: ConnectorTimelineSourceSummary["state"]
): ConnectorTimelineSourceSummary {
  return {
    source,
    state,
    itemCount,
    skippedItemCount: Math.max(0, skippedItemCount),
    snapshotFetchedAt: snapshotFetchedAt
      ? normalizeTimestamp(snapshotFetchedAt)
      : null,
    truncated
  };
}

function timelineId(
  source: ConnectorTimelineSource,
  kind: ConnectorTimelineKind,
  sourceId: string
): string {
  return createHash("sha256")
    .update(`${source}:${kind}:${sourceId}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeTimestamp(value: string): string | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00+09:00`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function safeText(value: string, fallback: string): string {
  const sanitized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return (sanitized || fallback).slice(0, 240);
}

function calendarStatusLabel(
  status: GoogleCalendarEventStatus
): string {
  switch (status) {
    case "confirmed":
      return "확정 일정";
    case "tentative":
      return "잠정 일정";
    case "cancelled":
      return "취소된 일정";
  }
}

function notionTimelineKind(
  kind: NotionResourceKind
): ConnectorTimelineKind {
  return kind === "page" ? "notion_page" : "notion_data_source";
}

function githubTimelineKind(
  kind: GitHubTaskKind
): ConnectorTimelineKind {
  switch (kind) {
    case "assigned_issue":
      return "github_assigned_issue";
    case "review_requested_pull_request":
      return "github_review_requested_pull_request";
    case "authored_pull_request":
      return "github_authored_pull_request";
  }
}

function githubActivityTimelineKind(
  kind: GitHubActivityKind
): ConnectorTimelineKind {
  return `github_${kind}`;
}

function githubActivityTitle(
  activity: GitHubUserActivitySignal
): string {
  if (activity.subjectTitle) {
    return safeText(
      activity.subjectTitle,
      activity.subjectType === "pull_request"
        ? "제목 없는 PR"
        : "제목 없는 이슈"
    );
  }
  return safeText(activity.repositoryFullName, "이름 없는 저장소");
}

function githubActivityDetail(
  activity: GitHubUserActivitySignal
): string {
  const repository = safeText(
    activity.repositoryFullName,
    "저장소"
  );
  switch (activity.activityKind) {
    case "push":
      return `${repository} · ${githubPushTarget(activity)} push`;
    case "ref_created":
      return `${repository} · ${githubRefLabel(activity)} 생성`;
    case "ref_deleted":
      return `${repository} · ${githubRefLabel(activity)} 삭제`;
    case "issue_opened":
      return `${githubActivitySubject(
        activity,
        repository
      )} · ${githubIssueLikeLabel(activity)} 열기`;
    case "issue_closed":
      return `${githubActivitySubject(
        activity,
        repository
      )} · ${githubIssueLikeLabel(activity)} 닫기`;
    case "issue_reopened":
      return `${githubActivitySubject(
        activity,
        repository
      )} · ${githubIssueLikeLabel(activity)} 다시 열기`;
    case "issue_commented":
      return `${githubActivitySubject(
        activity,
        repository
      )} · ${githubIssueLikeLabel(activity)} 댓글 작성`;
    case "pull_request_opened":
      return `${githubActivitySubject(activity, repository)} · PR 열기`;
    case "pull_request_closed":
      return `${githubActivitySubject(activity, repository)} · PR 닫기`;
    case "pull_request_reopened":
      return `${githubActivitySubject(activity, repository)} · PR 다시 열기`;
    case "pull_request_merged":
      return `${githubActivitySubject(activity, repository)} · PR 병합`;
    case "pull_request_reviewed":
      return `${githubActivitySubject(activity, repository)} · ${githubReviewLabel(
        activity.reviewState
      )}`;
    case "pull_request_review_commented":
      return `${githubActivitySubject(activity, repository)} · 코드 리뷰 댓글 작성`;
  }
}

function githubActivitySubject(
  activity: GitHubUserActivitySignal,
  repository: string
): string {
  return activity.subjectNumber === null
    ? repository
    : `${repository} #${activity.subjectNumber}`;
}

function githubRefLabel(activity: GitHubUserActivitySignal): string {
  const refType =
    activity.subjectType === "tag" ? "태그" : "브랜치";
  return activity.refName
    ? `${refType} ${safeText(activity.refName, "")}`.trim()
    : refType;
}

function githubPushTarget(
  activity: GitHubUserActivitySignal
): string {
  if (!activity.refName) return "저장소에";
  const refName = safeText(activity.refName, "참조");
  return activity.subjectType === "tag"
    ? `${refName} 태그에`
    : `${refName} 브랜치에`;
}

function githubIssueLikeLabel(
  activity: GitHubUserActivitySignal
): "PR" | "이슈" {
  return activity.subjectType === "pull_request" ? "PR" : "이슈";
}

function githubReviewLabel(
  state: GitHubReviewState | null
): string {
  switch (state) {
    case "approved":
      return "PR 승인";
    case "changes_requested":
      return "PR 변경 요청";
    case "commented":
      return "PR 리뷰 의견 제출";
    default:
      return "PR 리뷰 제출";
  }
}

function githubTaskLabel(kind: GitHubTaskKind): string {
  switch (kind) {
    case "assigned_issue":
      return "담당 이슈";
    case "review_requested_pull_request":
      return "리뷰 요청 PR";
    case "authored_pull_request":
      return "내 열린 PR";
  }
}

function codexTaskDetail(
  projectLabel: string,
  summarySource: "thread_name" | "first_user_request" | null
): string {
  const project = safeText(projectLabel, "Codex 프로젝트");
  switch (summarySource) {
    case "thread_name":
      return `${project} · Codex 작업 제목`;
    case "first_user_request":
      return `${project} · 첫 요청 기준`;
    default:
      return `${project} · 작업 설명 없음`;
  }
}

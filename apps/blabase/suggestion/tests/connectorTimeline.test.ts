import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConnectorTimeline,
  readConnectorTimeline,
  type ConnectorSnapshots
} from "../src/connectors/timeline/timeline";
import {
  writeStoredCodexConfig,
  writeStoredCodexSnapshot
} from "../src/connectors/codex/localStore";
import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import type {
  CodexSnapshot,
  StoredCodexConfig
} from "../src/connectors/codex/types";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import type { GoogleCalendarSnapshot } from "../src/connectors/googleCalendar/types";
import type { NotionSnapshot } from "../src/connectors/notion/types";

describe("connector timeline", () => {
  it("normalizes all connector snapshots onto one newest-first time axis", () => {
    const result = buildConnectorTimeline(
      {
        googleCalendar: calendarSnapshot([
          {
            id: "calendar-secret-id",
            source: "google_calendar",
            kind: "calendar_event",
            title: "종일 계획",
            status: "confirmed",
            startAt: "2026-07-28",
            endAt: "2026-07-29",
            allDay: true,
            recurringEventId: null,
            eventType: "default",
            updatedAt: "2026-07-01T00:00:00.000Z"
          },
          {
            id: "cancelled-secret-id",
            source: "google_calendar",
            kind: "calendar_event",
            title: "취소된 약속",
            status: "cancelled",
            startAt: "2026-07-25T09:00:00.000Z",
            endAt: "2026-07-25T10:00:00.000Z",
            allDay: false,
            recurringEventId: null,
            eventType: "focusTime",
            updatedAt: "2026-07-24T00:00:00.000Z"
          },
          {
            id: "invalid-calendar-id",
            source: "google_calendar",
            kind: "calendar_event",
            title: "시간이 잘못된 일정",
            status: "tentative",
            startAt: "not-a-time",
            endAt: "still-not-a-time",
            allDay: false,
            recurringEventId: null,
            eventType: "default",
            updatedAt: "2026-07-24T00:00:00.000Z"
          }
        ]),
        notion: notionSnapshot([
          {
            id: "notion-secret-id",
            source: "notion",
            kind: "page",
            title: "제품\u202e  \n 계획",
            createdAt: "2026-07-20T00:00:00.000Z",
            lastEditedAt: "2026-07-25T10:00:00.000Z"
          }
        ]),
        github: githubSnapshot(),
        codex: codexSnapshot()
      },
      new Date("2026-07-25T14:00:00.000Z")
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result).toMatchObject({
      schemaVersion: "connector-timeline-v2",
      timezone: "Asia/Seoul",
      generatedAt: "2026-07-25T14:00:00.000Z",
      itemCount: 8,
      truncated: true
    });
    expect(result.items.map((item) => item.source)).toEqual([
      "google_calendar",
      "codex",
      "github",
      "github",
      "github",
      "github",
      "notion",
      "google_calendar"
    ]);
    expect(result.items.map((item) => item.timestampKind)).toEqual([
      "scheduled_start",
      "last_activity",
      "activity_occurred",
      "last_updated",
      "activity_occurred",
      "last_updated",
      "last_edited",
      "scheduled_start"
    ]);

    const allDayEvent = result.items[0];
    expect(allDayEvent).toMatchObject({
      occurredAt: "2026-07-27T15:00:00.000Z",
      endAt: "2026-07-28T15:00:00.000Z",
      allDay: true,
      title: "종일 계획"
    });

    const githubTask = result.items.find(
      (item) => item.kind === "github_assigned_issue"
    );
    expect(githubTask).toMatchObject({
      dueAt: "2026-07-29T15:00:00.000Z",
      tags: ["urgent", "customer"]
    });
    expect(githubTask?.detail).toContain("현재 담당 이슈");

    expect(
      result.items.find(
        (item) => item.kind === "github_pull_request_merged"
      )
    ).toMatchObject({
      title: "타임라인 활동 상세화",
      detail: "team/product #43 · PR 병합"
    });
    expect(
      result.items.find((item) => item.kind === "github_push")
    ).toMatchObject({
      title: "team/product",
      detail: "team/product · feature/timeline 브랜치에 push"
    });
    expect(
      result.items.some((item) => item.detail === "저장소 업데이트")
    ).toBe(false);

    expect(
      result.items.find((item) => item.kind === "codex_session")
    ).toMatchObject({
      title: "연결 활동을 날짜순으로 더 구체적으로 보여줘",
      detail: "blabase · 첫 요청 기준"
    });

    const notionPage = result.items.find(
      (item) => item.kind === "notion_page"
    );
    expect(notionPage?.title).toBe("제품 계획");
    expect(
      result.items.find((item) => item.title === "취소된 약속")?.detail
    ).toContain("취소된 일정");

    expect(result.sources).toEqual([
      {
        source: "google_calendar",
        state: "available",
        itemCount: 2,
        skippedItemCount: 1,
        snapshotFetchedAt: "2026-07-25T08:00:00.000Z",
        truncated: false
      },
      {
        source: "notion",
        state: "available",
        itemCount: 1,
        skippedItemCount: 0,
        snapshotFetchedAt: "2026-07-25T08:00:00.000Z",
        truncated: false
      },
      {
        source: "github",
        state: "available",
        itemCount: 4,
        skippedItemCount: 0,
        snapshotFetchedAt: "2026-07-25T08:00:00.000Z",
        truncated: true
      },
      {
        source: "codex",
        state: "available",
        itemCount: 1,
        skippedItemCount: 0,
        snapshotFetchedAt: "2026-07-25T08:00:00.000Z",
        truncated: false
      }
    ]);
  });

  it("uses deterministic source and kind ordering for identical timestamps", () => {
    const sharedTimestamp = "2026-07-25T10:00:00.000Z";
    const snapshots: ConnectorSnapshots = {
      googleCalendar: calendarSnapshot([
        {
          id: "calendar-tie",
          source: "google_calendar",
          kind: "calendar_event",
          title: "Calendar",
          status: "confirmed",
          startAt: sharedTimestamp,
          endAt: "2026-07-25T11:00:00.000Z",
          allDay: false,
          recurringEventId: null,
          eventType: "default",
          updatedAt: sharedTimestamp
        }
      ]),
      notion: notionSnapshot([
        {
          id: "notion-tie",
          source: "notion",
          kind: "data_source",
          title: "Notion",
          createdAt: sharedTimestamp,
          lastEditedAt: sharedTimestamp
        }
      ]),
      github: githubSnapshot({
        repositories: [
          {
            id: 21,
            source: "github",
            kind: "repository",
            installationId: 22,
            fullName: "team/repository",
            private: false,
            archived: false,
            updatedAt: sharedTimestamp
          }
        ],
        tasks: [
          {
            id: 23,
            source: "github",
            kind: "assigned_issue",
            repositoryId: 21,
            repositoryFullName: "team/repository",
            number: 24,
            title: "GitHub issue",
            htmlUrl: "https://github.example/private",
            labelNames: [],
            milestoneDueAt: null,
            state: "open",
            createdAt: sharedTimestamp,
            updatedAt: sharedTimestamp
          }
        ],
        activities: [
          {
            id: "github-tie-event",
            source: "github",
            kind: "user_activity",
            activityKind: "push",
            repositoryId: 21,
            repositoryFullName: "team/repository",
            occurredAt: sharedTimestamp,
            subjectType: "branch",
            subjectNumber: null,
            subjectTitle: null,
            refName: "main",
            reviewState: null
          }
        ]
      }),
      codex: codexSnapshot({
        sessions: [
          {
            id: "codex-tie",
            source: "codex",
            kind: "coding_session",
            scopeId: "scope-tie",
            projectLabel: "Codex",
            taskSummary: null,
            taskSummarySource: null,
            createdAt: sharedTimestamp,
            updatedAt: sharedTimestamp,
            activityState: "idle",
            attentionState: null,
            content: emptyCodexContentManifest()
          }
        ]
      })
    };

    const first = buildConnectorTimeline(snapshots);
    const second = buildConnectorTimeline(snapshots);
    if (first.status !== "ready" || second.status !== "ready") return;

    expect(first.items.map((item) => `${item.source}:${item.kind}`)).toEqual([
      "google_calendar:calendar_event",
      "notion:notion_data_source",
      "github:github_assigned_issue",
      "github:github_push",
      "codex:codex_session"
    ]);
    expect(second.items.map((item) => item.id)).toEqual(
      first.items.map((item) => item.id)
    );
  });

  it("distinguishes missing snapshots from connected empty snapshots", () => {
    const missing = buildConnectorTimeline({
      googleCalendar: null,
      notion: null,
      github: null,
      codex: null
    });
    if (missing.status !== "ready") return;

    expect(missing.itemCount).toBe(0);
    expect(missing.sources.every((source) => source.state === "missing")).toBe(
      true
    );

    const empty = buildConnectorTimeline({
      googleCalendar: calendarSnapshot([]),
      notion: notionSnapshot([]),
      github: githubSnapshot({
        repositories: [],
        tasks: [],
        activities: [],
        truncated: false
      }),
      codex: codexSnapshot({ sessions: [] })
    });
    if (empty.status !== "ready") return;

    expect(empty.itemCount).toBe(0);
    expect(
      empty.sources.every(
        (source) =>
          source.state === "available" &&
          source.itemCount === 0 &&
          source.skippedItemCount === 0
      )
    ).toBe(true);
  });

  it("omits cached Codex summaries when the active consent config no longer matches", async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), "blabase-timeline-consent-")
    );
    const scopeId = "c".repeat(24);
    const summaryConfig: StoredCodexConfig = {
      schemaVersion: "codex-connector-config-v3",
      installationSecret: "f".repeat(64),
      selectedScopeIds: [scopeId],
      scopes: [
        {
          id: scopeId,
          queryPath: "/private/project",
          label: "project",
          sessionCount: 1,
          lastActivityAt: "2026-07-25T09:00:00.000Z"
        }
      ],
      contentMode: "activity_summary",
      contentConsentAt: "2026-07-25T08:00:00.000Z",
      conversationConsentContract: null,
      conversationConsentAt: null,
      conversationRetentionDays: null,
      discoveredAt: "2026-07-25T08:00:00.000Z"
    };
    const staleSummary: CodexSnapshot = {
      schemaVersion: "codex-snapshot-v3",
      collectorVersion: "codex-app-server-activity-summary-v1",
      contentMode: "activity_summary",
      codexVersion: "codex-cli 0.145.0",
      fetchedAt: "2026-07-25T10:00:00.000Z",
      lookbackStart: "2026-06-25T10:00:00.000Z",
      truncated: false,
      conversationStoreSha256: null,
      conversationRetentionDays: null,
      scopeIds: [scopeId],
      sessions: [
        {
          id: "d".repeat(24),
          source: "codex",
          kind: "coding_session",
          scopeId,
          projectLabel: "project",
          taskSummary: "SHOULD_NOT_REACH_TIMELINE",
          taskSummarySource: "first_user_request",
          createdAt: "2026-07-25T08:00:00.000Z",
          updatedAt: "2026-07-25T09:00:00.000Z",
          activityState: "idle",
          attentionState: null,
          content: emptyCodexContentManifest()
        }
      ]
    };

    try {
      await writeStoredCodexConfig(summaryConfig, cwd);
      await writeStoredCodexSnapshot(
        staleSummary,
        summaryConfig,
        cwd
      );
      await writeStoredCodexConfig(
        {
          ...summaryConfig,
          contentMode: "metadata_only",
          contentConsentAt: null
        },
        cwd
      );

      const result = await readConnectorTimeline(cwd);
      if (result.status !== "ready") return;
      expect(
        result.sources.find((source) => source.source === "codex")
      ).toMatchObject({
        state: "missing",
        itemCount: 0
      });
      expect(JSON.stringify(result)).not.toContain(
        "SHOULD_NOT_REACH_TIMELINE"
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("marks GitHub as partial when task data exists but user activities could not be read", () => {
    const result = buildConnectorTimeline({
      googleCalendar: null,
      notion: null,
      github: githubSnapshot({
        activitiesState: "unavailable",
        activities: [],
        activitiesTruncated: false,
        truncated: false
      }),
      codex: null
    });
    if (result.status !== "ready") return;

    expect(result.sources.find((source) => source.source === "github")).toEqual(
      {
        source: "github",
        state: "partial",
        itemCount: 2,
        skippedItemCount: 0,
        snapshotFetchedAt: "2026-07-25T08:00:00.000Z",
        truncated: false
      }
    );
    expect(
      result.items.some((item) => item.kind === "github_push")
    ).toBe(false);
  });

  it("summarizes branches, issue comments, and pull request reviews as concrete actions", () => {
    const result = buildConnectorTimeline({
      googleCalendar: null,
      notion: null,
      github: githubSnapshot({
        repositories: [],
        tasks: [],
        truncated: false,
        activities: [
          githubActivity({
            id: "created",
            activityKind: "ref_created",
            subjectType: "branch",
            refName: "suggestion-detail",
            occurredAt: "2026-07-25T12:00:00.000Z"
          }),
          githubActivity({
            id: "commented",
            activityKind: "issue_commented",
            subjectType: "issue",
            subjectNumber: 55,
            subjectTitle: "연결 오류 확인",
            occurredAt: "2026-07-25T11:00:00.000Z"
          }),
          githubActivity({
            id: "reviewed",
            activityKind: "pull_request_reviewed",
            subjectType: "pull_request",
            subjectNumber: 56,
            subjectTitle: "OAuth 흐름 정리",
            reviewState: "approved",
            occurredAt: "2026-07-25T10:00:00.000Z"
          }),
          githubActivity({
            id: "tag-push",
            activityKind: "push",
            subjectType: "tag",
            refName: "v1.0.0",
            occurredAt: "2026-07-25T09:00:00.000Z"
          })
        ]
      }),
      codex: null
    });
    if (result.status !== "ready") return;

    expect(result.items.map((item) => item.detail)).toEqual([
      "team/product · 브랜치 suggestion-detail 생성",
      "team/product #55 · 이슈 댓글 작성",
      "team/product #56 · PR 승인",
      "team/product · v1.0.0 태그에 push"
    ]);
  });

  it("does not serialize connector credentials, raw ids, paths, or unused metadata", () => {
    const snapshots = {
      googleCalendar: calendarSnapshot([
        {
          id: "RAW_CALENDAR_IDENTIFIER",
          source: "google_calendar" as const,
          kind: "calendar_event" as const,
          title: "안전한 일정",
          status: "confirmed" as const,
          startAt: "2026-07-25T10:00:00.000Z",
          endAt: "2026-07-25T11:00:00.000Z",
          allDay: false,
          recurringEventId: "RAW_RECURRING_IDENTIFIER",
          eventType: "default",
          updatedAt: "2026-07-25T09:00:00.000Z"
        }
      ]),
      notion: notionSnapshot([
        {
          id: "RAW_NOTION_IDENTIFIER",
          source: "notion" as const,
          kind: "page" as const,
          title: "안전한 페이지",
          createdAt: "2026-07-24T00:00:00.000Z",
          lastEditedAt: "2026-07-25T09:00:00.000Z"
        }
      ]),
      github: githubSnapshot(),
      codex: codexSnapshot()
    };
    const result = buildConnectorTimeline(snapshots);
    if (result.status !== "ready") return;
    const serialized = JSON.stringify(result);

    expect(result.items.every((item) => /^[a-f0-9]{24}$/.test(item.id))).toBe(
      true
    );
    for (const sensitiveValue of [
      "RAW_CALENDAR_IDENTIFIER",
      "RAW_RECURRING_IDENTIFIER",
      "RAW_NOTION_IDENTIFIER",
      "RAW_CODEX_IDENTIFIER",
      "RAW_GITHUB_EVENT_IDENTIFIER",
      "RAW_GITHUB_MERGE_IDENTIFIER",
      "SECRET_SCOPE_IDENTIFIER",
      "SECRET_WORKSPACE_IDENTIFIER",
      "SECRET_GITHUB_CLIENT_ID",
      "SECRET_GITHUB_APP_SLUG",
      "private-user-login",
      "https://github.example/private-task"
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
    for (const excludedField of [
      '"workspaceId"',
      '"appClientId"',
      '"appSlug"',
      '"installations"',
      '"htmlUrl"',
      '"scopeIds"',
      '"activityState"',
      '"attentionState"',
      '"repositoryId"',
      '"subjectNumber"',
      '"subjectTitle"',
      '"reviewState"',
      '"private"'
    ]) {
      expect(serialized).not.toContain(excludedField);
    }
  });
});

function calendarSnapshot(
  events: GoogleCalendarSnapshot["events"]
): GoogleCalendarSnapshot {
  return {
    schemaVersion: "google-calendar-snapshot-v1",
    fetchedAt: "2026-07-25T08:00:00.000Z",
    timeMin: "2026-07-18T00:00:00.000Z",
    timeMax: "2026-08-08T00:00:00.000Z",
    events
  };
}

function notionSnapshot(
  resources: NotionSnapshot["resources"]
): NotionSnapshot {
  return {
    schemaVersion: "notion-snapshot-v1",
    apiVersion: "2025-09-03",
    fetchedAt: "2026-07-25T08:00:00.000Z",
    workspaceId: "SECRET_WORKSPACE_IDENTIFIER",
    workspaceName: "Private workspace",
    truncated: false,
    resources
  };
}

function githubSnapshot(
  overrides: Partial<GitHubSnapshot> = {}
): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "SECRET_GITHUB_CLIENT_ID",
    appSlug: "SECRET_GITHUB_APP_SLUG",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-07-25T08:00:00.000Z",
    user: { id: 123456789, login: "private-user-login" },
    truncated: true,
    activityWindowStart: "2026-06-25T08:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 987654321,
        accountLogin: "private-installation",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 7654321,
        source: "github",
        kind: "repository",
        installationId: 987654321,
        fullName: "team/product",
        private: true,
        archived: false,
        updatedAt: "2026-07-25T11:00:00.000Z"
      }
    ],
    tasks: [
      {
        id: 8765432,
        source: "github",
        kind: "assigned_issue",
        repositoryId: 7654321,
        repositoryFullName: "team/product",
        number: 42,
        title: "고객 문제 확인",
        htmlUrl: "https://github.example/private-task",
        labelNames: ["urgent", "customer", "urgent"],
        milestoneDueAt: "2026-07-30",
        state: "open",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-25T12:00:00.000Z"
      },
      {
        id: 9765432,
        source: "github",
        kind: "authored_pull_request",
        repositoryId: 7654321,
        repositoryFullName: "team/product",
        number: 43,
        title: "내 PR 확인",
        htmlUrl: "https://github.example/private-pr",
        labelNames: [],
        milestoneDueAt: null,
        state: "open",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-25T10:30:00.000Z"
      }
    ],
    activities: [
      {
        id: "RAW_GITHUB_EVENT_IDENTIFIER",
        source: "github",
        kind: "user_activity",
        activityKind: "push",
        repositoryId: 7654321,
        repositoryFullName: "team/product",
        occurredAt: "2026-07-25T11:30:00.000Z",
        subjectType: "branch",
        subjectNumber: null,
        subjectTitle: null,
        refName: "feature/timeline",
        reviewState: null
      },
      {
        id: "RAW_GITHUB_MERGE_IDENTIFIER",
        source: "github",
        kind: "user_activity",
        activityKind: "pull_request_merged",
        repositoryId: 7654321,
        repositoryFullName: "team/product",
        occurredAt: "2026-07-25T12:30:00.000Z",
        subjectType: "pull_request",
        subjectNumber: 43,
        subjectTitle: "타임라인 활동 상세화",
        refName: null,
        reviewState: null
      }
    ],
    ...overrides
  };
}

function githubActivity(
  overrides: Partial<GitHubSnapshot["activities"][number]>
): GitHubSnapshot["activities"][number] {
  return {
    id: "activity",
    source: "github",
    kind: "user_activity",
    activityKind: "push",
    repositoryId: 7654321,
    repositoryFullName: "team/product",
    occurredAt: "2026-07-25T10:00:00.000Z",
    subjectType: "repository",
    subjectNumber: null,
    subjectTitle: null,
    refName: null,
    reviewState: null,
    ...overrides
  };
}

function codexSnapshot(
  overrides: Partial<CodexSnapshot> = {}
): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-activity-summary-v1",
    contentMode: "activity_summary",
    codexVersion: "codex-cli 0.145.0",
    fetchedAt: "2026-07-25T08:00:00.000Z",
    lookbackStart: "2026-06-25T08:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["SECRET_SCOPE_IDENTIFIER"],
    sessions: [
      {
        id: "RAW_CODEX_IDENTIFIER",
        source: "codex",
        kind: "coding_session",
        scopeId: "SECRET_SCOPE_IDENTIFIER",
        projectLabel: "blabase",
        taskSummary: "연결 활동을 날짜순으로 더 구체적으로 보여줘",
        taskSummarySource: "first_user_request",
        createdAt: "2026-07-24T00:00:00.000Z",
        updatedAt: "2026-07-25T13:00:00.000Z",
        activityState: "active",
        attentionState: "waiting_on_user_input",
        content: emptyCodexContentManifest()
      }
    ],
    ...overrides
  };
}

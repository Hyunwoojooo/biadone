export type ConnectorTimelineSource =
  | "google_calendar"
  | "notion"
  | "github"
  | "codex";

export type ConnectorTimelineKind =
  | "calendar_event"
  | "notion_page"
  | "notion_data_source"
  | "github_push"
  | "github_ref_created"
  | "github_ref_deleted"
  | "github_issue_opened"
  | "github_issue_closed"
  | "github_issue_reopened"
  | "github_issue_commented"
  | "github_pull_request_opened"
  | "github_pull_request_closed"
  | "github_pull_request_reopened"
  | "github_pull_request_merged"
  | "github_pull_request_reviewed"
  | "github_pull_request_review_commented"
  | "github_assigned_issue"
  | "github_review_requested_pull_request"
  | "github_authored_pull_request"
  | "codex_session";

export type ConnectorTimelineTimestampKind =
  | "scheduled_start"
  | "last_edited"
  | "last_updated"
  | "activity_occurred"
  | "last_activity";

export type ConnectorTimelineItem = {
  id: string;
  source: ConnectorTimelineSource;
  kind: ConnectorTimelineKind;
  occurredAt: string;
  timestampKind: ConnectorTimelineTimestampKind;
  endAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  title: string;
  detail: string;
  tags: string[];
};

export type ConnectorTimelineSourceSummary = {
  source: ConnectorTimelineSource;
  state: "available" | "partial" | "missing";
  itemCount: number;
  skippedItemCount: number;
  snapshotFetchedAt: string | null;
  truncated: boolean;
};

export type ConnectorTimelineState =
  | {
      status: "unavailable";
      message: string;
      localUrl: string;
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "ready";
      schemaVersion: "connector-timeline-v2";
      timezone: "Asia/Seoul";
      generatedAt: string;
      itemCount: number;
      truncated: boolean;
      sources: ConnectorTimelineSourceSummary[];
      items: ConnectorTimelineItem[];
    };

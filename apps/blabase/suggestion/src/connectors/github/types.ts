export type GitHubTaskKind =
  | "assigned_issue"
  | "review_requested_pull_request"
  | "authored_pull_request";

export type GitHubActivityKind =
  | "push"
  | "ref_created"
  | "ref_deleted"
  | "issue_opened"
  | "issue_closed"
  | "issue_reopened"
  | "issue_commented"
  | "pull_request_opened"
  | "pull_request_closed"
  | "pull_request_reopened"
  | "pull_request_merged"
  | "pull_request_reviewed"
  | "pull_request_review_commented";

export type GitHubActivitySubjectType =
  | "repository"
  | "branch"
  | "tag"
  | "issue"
  | "pull_request";

export type GitHubReviewState =
  | "approved"
  | "changes_requested"
  | "commented";

export type GitHubUserSignal = {
  id: number;
  login: string;
};

export type GitHubInstallationSignal = {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  suspended: boolean;
};

export type GitHubRepositorySignal = {
  id: number;
  source: "github";
  kind: "repository";
  installationId: number;
  fullName: string;
  private: boolean;
  archived: boolean;
  updatedAt: string;
};

export type GitHubTaskSignal = {
  id: number;
  source: "github";
  kind: GitHubTaskKind;
  repositoryId: number;
  repositoryFullName: string;
  number: number;
  title: string;
  htmlUrl: string;
  labelNames: string[];
  milestoneDueAt: string | null;
  state: "open";
  createdAt: string;
  updatedAt: string;
};

export type GitHubUserActivitySignal = {
  id: string;
  source: "github";
  kind: "user_activity";
  activityKind: GitHubActivityKind;
  repositoryId: number;
  repositoryFullName: string;
  occurredAt: string;
  subjectType: GitHubActivitySubjectType;
  subjectNumber: number | null;
  subjectTitle: string | null;
  refName: string | null;
  reviewState: GitHubReviewState | null;
};

export type GitHubSnapshot = {
  schemaVersion: "github-snapshot-v2";
  appClientId: string;
  appSlug: string;
  apiVersion: string;
  fetchedAt: string;
  user: GitHubUserSignal;
  truncated: boolean;
  activityWindowStart: string;
  activitiesState: "available" | "partial" | "unavailable";
  activitiesTruncated: boolean;
  installations: GitHubInstallationSignal[];
  repositories: GitHubRepositorySignal[];
  tasks: GitHubTaskSignal[];
  activities: GitHubUserActivitySignal[];
};

export type StoredGitHubTokens = {
  appClientId: string;
  appSlug: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshTokenExpiresAt: string;
  tokenType: string;
  scope: string;
};

export type GitHubPreviewTask = {
  id: number;
  kind: GitHubTaskKind;
  repositoryFullName: string;
  number: number;
  title: string;
  htmlUrl: string;
  labelNames: string[];
  milestoneDueAt: string | null;
  updatedAt: string;
};

export type GitHubConnectionState =
  | {
      status: "unavailable";
      message: string;
      localUrl?: string;
    }
  | {
      status: "disconnected";
    }
  | {
      status: "connected";
      userLogin: string;
      lastSyncedAt: string;
      installationCount: number;
      repositoryCount: number;
      taskCount: number;
      assignedIssueCount: number;
      reviewRequestedPullRequestCount: number;
      authoredPullRequestCount: number;
      truncated: boolean;
      tasks: GitHubPreviewTask[];
    }
  | {
      status: "reauthorization_required";
      message: string;
    }
  | {
      status: "sync_error";
      message: string;
      lastSyncedAt: string | null;
    };

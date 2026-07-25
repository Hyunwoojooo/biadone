export type GitHubTaskKind =
  | "assigned_issue"
  | "review_requested_pull_request"
  | "authored_pull_request";

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

export type GitHubSnapshot = {
  schemaVersion: "github-snapshot-v1";
  appClientId: string;
  appSlug: string;
  apiVersion: string;
  fetchedAt: string;
  user: GitHubUserSignal;
  truncated: boolean;
  installations: GitHubInstallationSignal[];
  repositories: GitHubRepositorySignal[];
  tasks: GitHubTaskSignal[];
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

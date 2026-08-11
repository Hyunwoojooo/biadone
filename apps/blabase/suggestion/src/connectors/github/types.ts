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

export type GitHubPullRequestActionRequiredReason =
  | "checks_failed"
  | "changes_requested"
  | "merge_conflict";

export type GitHubPullRequestChecksSummary = {
  collectionState: "complete" | "partial";
  state: "passing" | "failing" | "pending" | "none" | "unknown";
  totalCount: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  truncated: boolean;
};

/**
 * Privacy-minimized, REST-derived PR actionability metadata.
 *
 * Review bodies, check/status names and output, reviewer identities, commit
 * SHAs, and branch names are intentionally excluded. Older
 * github-snapshot-v2 records omit this field and remain valid.
 */
export type GitHubPullRequestActionabilitySignal = {
  collectionState: "complete" | "partial";
  draft: boolean;
  reviewDecision:
    | "changes_requested"
    | "review_requested"
    | "approved"
    | "none"
    | "unknown";
  checksSummary: GitHubPullRequestChecksSummary | null;
  mergeable: boolean | null;
  mergeConflict: boolean | null;
  unresolvedChangeRequestCount: number | null;
  requestedReviewerCount: number;
  actionRequired: boolean;
  actionRequiredReasons: GitHubPullRequestActionRequiredReason[];
};

export type GitHubActionabilityCoverage = {
  state: "complete" | "partial" | "unavailable";
  authoredPullRequestCount: number;
  attemptedCount: number;
  collectedCount: number;
  truncated: boolean;
};

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
  actionability?: GitHubPullRequestActionabilitySignal;
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
  /**
   * Required by github-snapshot-v5/v6. In v6, issue and pull-request activity carries
   * the canonical Issues REST object ID used by task bindings. Pull request
   * event IDs are resolved through the exact repository/number Issues API;
   * non-work-item activity carries null. v5 may contain the pre-canonicalized
   * event-native PR ID, so only v6 can bridge a disappeared task by this field.
   * Older snapshots omit it.
   */
  subjectObjectId?: number | null;
  subjectTitle: string | null;
  refName: string | null;
  reviewState: GitHubReviewState | null;
  /**
   * Required by github-snapshot-v4. Pushes carry the opaque commit artifact
   * ID; every other activity carries null. Legacy v2/v3 snapshots omit it.
   */
  artifactId?: string | null;
};

export type GitHubSnapshot = {
  schemaVersion:
    | "github-snapshot-v2"
    | "github-snapshot-v3"
    | "github-snapshot-v4"
    | "github-snapshot-v5"
    | "github-snapshot-v6";
  appClientId: string;
  appSlug: string;
  apiVersion: string;
  fetchedAt: string;
  user: GitHubUserSignal;
  truncated: boolean;
  activityWindowStart: string;
  activitiesState: "available" | "partial" | "unavailable";
  activitiesTruncated: boolean;
  /** Required by github-snapshot-v3/v4; absent from legacy v2 snapshots. */
  actionabilityCoverage?: GitHubActionabilityCoverage;
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

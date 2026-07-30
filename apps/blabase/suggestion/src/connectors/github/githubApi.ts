import { z } from "zod";

import type { GitHubConfig } from "./config";
import {
  githubStoreGeneration,
  readStoredGitHubTokens,
  writeStoredGitHubSnapshot,
  writeStoredGitHubTokens
} from "./localStore";
import {
  GitHubOAuthError,
  refreshGitHubAccessToken
} from "./oauth";
import type {
  GitHubActivityKind,
  GitHubActivitySubjectType,
  GitHubInstallationSignal,
  GitHubRepositorySignal,
  GitHubReviewState,
  GitHubSnapshot,
  GitHubTaskKind,
  GitHubTaskSignal,
  GitHubUserActivitySignal,
  StoredGitHubTokens
} from "./types";

export const MAX_GITHUB_INSTALLATIONS = 50;
export const MAX_GITHUB_REPOSITORIES = 100;
export const MAX_GITHUB_TASKS = 200;
export const MAX_GITHUB_ACTIVITIES = 300;

const GITHUB_PAGE_SIZE = 100;
const MAX_GITHUB_PAGES = 10;
const MAX_GITHUB_ACTIVITY_PAGES = 3;
const GITHUB_ACTIVITY_LOOKBACK_DAYS = 30;
const SUPPORTED_GITHUB_EVENT_TYPES = new Set([
  "PushEvent",
  "CreateEvent",
  "DeleteEvent",
  "IssuesEvent",
  "IssueCommentEvent",
  "PullRequestEvent",
  "PullRequestReviewEvent",
  "PullRequestReviewCommentEvent"
]);
const storedTokenRefreshes = new Map<
  string,
  Promise<StoredGitHubTokens>
>();

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1)
});

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({
    login: z.string().min(1),
    type: z.enum(["User", "Organization"])
  }),
  repository_selection: z.enum(["all", "selected"]),
  suspended_at: z.string().datetime().nullable().optional().default(null)
});

const installationsResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(installationSchema)
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  private: z.boolean(),
  archived: z.boolean().optional().default(false),
  updated_at: z.string().datetime()
});

const repositoriesResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema)
});

const labelSchema = z.union([
  z.string(),
  z.object({
    name: z.string().nullable().optional()
  })
]);

const taskResponseSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.literal("open"),
  repository_url: z.string().url(),
  html_url: z.string().url(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  labels: z.array(labelSchema).optional().default([]),
  milestone: z
    .object({
      due_on: z.string().datetime().nullable().optional().default(null)
    })
    .nullable()
    .optional()
    .default(null),
  pull_request: z.unknown().optional()
});

const assignedIssuesResponseSchema = z.array(taskResponseSchema);
const searchResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(taskResponseSchema)
});

const eventsResponseSchema = z.array(z.unknown());
const eventEnvelopeSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().nonnegative()]),
  type: z.string().min(1),
  actor: z.object({
    login: z.string().min(1)
  }),
  repo: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1)
  }),
  payload: z.unknown(),
  created_at: z.string().datetime()
});

const issueSubjectSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  pull_request: z.unknown().optional()
});
const pullRequestSubjectSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  merged: z.boolean().optional().default(false)
});
const pushEventPayloadSchema = z.object({
  ref: z.string().min(1)
});
const refEventPayloadSchema = z.object({
  ref: z.string().min(1),
  ref_type: z.enum(["branch", "tag"])
});
const issuesEventPayloadSchema = z.object({
  action: z.enum(["opened", "closed", "reopened"]),
  issue: issueSubjectSchema
});
const issueCommentEventPayloadSchema = z.object({
  action: z.literal("created"),
  issue: issueSubjectSchema
});
const pullRequestEventPayloadSchema = z.object({
  action: z.enum(["opened", "closed", "reopened", "merged"]),
  pull_request: pullRequestSubjectSchema
});
const pullRequestReviewEventPayloadSchema = z.object({
  action: z.enum(["submitted", "created"]),
  pull_request: pullRequestSubjectSchema,
  review: z.object({
    state: z.string().min(1)
  })
});
const pullRequestReviewCommentEventPayloadSchema = z.object({
  action: z.literal("created"),
  pull_request: pullRequestSubjectSchema
});

type AuthenticatedRequest = (url: URL) => Promise<Response>;
type RepositoryIndexEntry = {
  id: number;
  fullName: string;
};

export async function fetchAndStoreGitHubSnapshot(
  config: GitHubConfig,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    cwd?: string;
    maxRepositories?: number;
    maxTasks?: number;
  } = {}
): Promise<GitHubSnapshot> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const cwd = options.cwd ?? process.cwd();
  const storeGeneration = githubStoreGeneration(cwd);
  const maxRepositories = boundedLimit(
    options.maxRepositories,
    MAX_GITHUB_REPOSITORIES
  );
  const maxTasks = boundedLimit(options.maxTasks, MAX_GITHUB_TASKS);

  const storedTokens = await readStoredGitHubTokens(cwd);
  if (!storedTokens) {
    throw new GitHubApiError("NOT_CONNECTED");
  }
  if (
    storedTokens.appClientId !== config.clientId ||
    storedTokens.appSlug !== config.appSlug
  ) {
    throw new GitHubApiError("REAUTHORIZATION_REQUIRED");
  }

  const request = createAuthenticatedRequest({
    config,
    storedTokens,
    now,
    fetchImpl,
    cwd,
    storeGeneration
  });

  const userResponse = await request(apiUrl(config, "/user"));
  assertResponseOk(userResponse, "USER_REQUEST_FAILED");
  const user = await parseResponse(
    userResponse,
    userSchema,
    "USER_RESPONSE_INVALID"
  );

  const installationResult = await fetchInstallations(
    config,
    request,
    MAX_GITHUB_INSTALLATIONS
  );
  const repositoryResult = await fetchInstallationRepositories(
    config,
    request,
    installationResult.installations,
    maxRepositories
  );

  const repositoryIndex = new Map<string, RepositoryIndexEntry>(
    repositoryResult.repositories
      .filter((repository) => !repository.archived)
      .map((repository) => [
        repository.fullName.toLowerCase(),
        { id: repository.id, fullName: repository.fullName }
      ])
  );

  const [
    assignedIssueResult,
    reviewRequestedResult,
    authoredPullRequestResult
  ] =
    repositoryIndex.size === 0
      ? [
          emptyTaskResult(),
          emptyTaskResult(),
          emptyTaskResult()
        ]
      : await Promise.all([
          fetchAssignedIssues(
            config,
            request,
            repositoryIndex,
            maxTasks
          ),
          fetchSearchedPullRequests(
            config,
            request,
            repositoryIndex,
            maxTasks,
            "review_requested_pull_request",
            `is:pr is:open review-requested:${user.login}`
          ),
          fetchSearchedPullRequests(
            config,
            request,
            repositoryIndex,
            maxTasks,
            "authored_pull_request",
            `is:pr is:open author:${user.login}`
          )
        ]);

  const combinedTasks = deduplicateTasks([
    ...assignedIssueResult.tasks,
    ...reviewRequestedResult.tasks,
    ...authoredPullRequestResult.tasks
  ]).sort(compareGitHubTasks);
  const tasks = combinedTasks.slice(0, maxTasks);
  const activityWindowStart = new Date(
    now.getTime() -
      GITHUB_ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const activityResult =
    repositoryIndex.size === 0
      ? emptyActivityResult(activityWindowStart)
      : await fetchUserActivities(
          config,
          request,
          user.login,
          repositoryIndex,
          activityWindowStart
        ).catch(() => unavailableActivityResult(activityWindowStart));

  const snapshot: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v2",
    appClientId: config.clientId,
    appSlug: config.appSlug,
    apiVersion: config.apiVersion,
    fetchedAt: now.toISOString(),
    user,
    truncated:
      installationResult.truncated ||
      repositoryResult.truncated ||
      assignedIssueResult.truncated ||
      reviewRequestedResult.truncated ||
      authoredPullRequestResult.truncated ||
      activityResult.truncated ||
      combinedTasks.length > tasks.length,
    activityWindowStart: activityResult.windowStart,
    activitiesState: activityResult.state,
    activitiesTruncated: activityResult.truncated,
    installations: installationResult.installations,
    repositories: repositoryResult.repositories.sort(
      compareGitHubRepositories
    ),
    tasks,
    activities: activityResult.activities
  };

  return writeStoredGitHubSnapshot(
    snapshot,
    cwd,
    storeGeneration
  );
}

export function compareGitHubTasks(
  left: GitHubTaskSignal,
  right: GitHubTaskSignal
): number {
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.kind.localeCompare(right.kind) ||
    left.id - right.id
  );
}

export function compareGitHubActivities(
  left: GitHubUserActivitySignal,
  right: GitHubUserActivitySignal
): number {
  return (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.activityKind.localeCompare(right.activityKind) ||
    left.id.localeCompare(right.id)
  );
}

export class GitHubApiError extends Error {
  constructor(
    readonly code:
      | "NOT_CONNECTED"
      | "REAUTHORIZATION_REQUIRED"
      | "USER_REQUEST_FAILED"
      | "USER_RESPONSE_INVALID"
      | "INSTALLATIONS_REQUEST_FAILED"
      | "INSTALLATIONS_RESPONSE_INVALID"
      | "REPOSITORIES_REQUEST_FAILED"
      | "REPOSITORIES_RESPONSE_INVALID"
      | "TASKS_REQUEST_FAILED"
      | "TASKS_RESPONSE_INVALID"
      | "ACTIVITIES_REQUEST_FAILED"
      | "ACTIVITIES_RESPONSE_INVALID"
  ) {
    super(code);
    this.name = "GitHubApiError";
  }
}

async function fetchInstallations(
  config: GitHubConfig,
  request: AuthenticatedRequest,
  limit: number
): Promise<{
  installations: GitHubInstallationSignal[];
  truncated: boolean;
}> {
  const installations: GitHubInstallationSignal[] = [];
  let pageNumber = 1;
  let truncated = false;

  while (
    installations.length < limit &&
    pageNumber <= MAX_GITHUB_PAGES
  ) {
    const perPage = Math.min(
      GITHUB_PAGE_SIZE,
      limit - installations.length
    );
    const url = apiUrl(config, "/user/installations", {
      per_page: String(perPage),
      page: String(pageNumber)
    });
    const response = await request(url);
    assertResponseOk(response, "INSTALLATIONS_REQUEST_FAILED");
    const page = await parseResponse(
      response,
      installationsResponseSchema,
      "INSTALLATIONS_RESPONSE_INVALID"
    );

    installations.push(
      ...page.installations.map(normalizeInstallation)
    );
    const hasMore = installations.length < page.total_count;
    if (!hasMore) break;
    if (
      installations.length >= limit ||
      pageNumber >= MAX_GITHUB_PAGES
    ) {
      truncated = true;
      break;
    }
    if (page.installations.length === 0) {
      throw new GitHubApiError("INSTALLATIONS_RESPONSE_INVALID");
    }
    pageNumber += 1;
  }

  return { installations, truncated };
}

async function fetchInstallationRepositories(
  config: GitHubConfig,
  request: AuthenticatedRequest,
  installations: GitHubInstallationSignal[],
  limit: number
): Promise<{
  repositories: GitHubRepositorySignal[];
  truncated: boolean;
}> {
  const repositories: GitHubRepositorySignal[] = [];
  const seenRepositoryIds = new Set<number>();
  let truncated = false;

  for (let installationIndex = 0; installationIndex < installations.length; installationIndex += 1) {
    const installation = installations[installationIndex];
    if (installation.suspended) continue;

    let pageNumber = 1;
    let installationSeenCount = 0;

    while (
      repositories.length < limit &&
      pageNumber <= MAX_GITHUB_PAGES
    ) {
      const perPage = Math.min(
        GITHUB_PAGE_SIZE,
        limit - repositories.length
      );
      const url = apiUrl(
        config,
        `/user/installations/${installation.id}/repositories`,
        {
          per_page: String(perPage),
          page: String(pageNumber)
        }
      );
      const response = await request(url);
      assertResponseOk(response, "REPOSITORIES_REQUEST_FAILED");
      const page = await parseResponse(
        response,
        repositoriesResponseSchema,
        "REPOSITORIES_RESPONSE_INVALID"
      );
      installationSeenCount += page.repositories.length;

      for (const repository of page.repositories) {
        if (seenRepositoryIds.has(repository.id)) continue;
        seenRepositoryIds.add(repository.id);
        repositories.push({
          id: repository.id,
          source: "github",
          kind: "repository",
          installationId: installation.id,
          fullName: repository.full_name,
          private: repository.private,
          archived: repository.archived ?? false,
          updatedAt: repository.updated_at
        });
        if (repositories.length >= limit) break;
      }

      const hasMore = installationSeenCount < page.total_count;
      if (!hasMore) break;
      if (
        repositories.length >= limit ||
        pageNumber >= MAX_GITHUB_PAGES
      ) {
        truncated = true;
        break;
      }
      if (page.repositories.length === 0) {
        throw new GitHubApiError("REPOSITORIES_RESPONSE_INVALID");
      }
      pageNumber += 1;
    }

    if (repositories.length >= limit) {
      if (installationIndex < installations.length - 1) truncated = true;
      break;
    }
  }

  return { repositories, truncated };
}

async function fetchAssignedIssues(
  config: GitHubConfig,
  request: AuthenticatedRequest,
  repositoryIndex: Map<string, RepositoryIndexEntry>,
  limit: number
): Promise<TaskFetchResult> {
  const tasks: GitHubTaskSignal[] = [];
  let pageNumber = 1;
  let truncated = false;

  while (tasks.length < limit && pageNumber <= MAX_GITHUB_PAGES) {
    const url = apiUrl(config, "/issues", {
      filter: "assigned",
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: String(GITHUB_PAGE_SIZE),
      page: String(pageNumber)
    });
    const response = await request(url);
    assertResponseOk(response, "TASKS_REQUEST_FAILED");
    const page = await parseResponse(
      response,
      assignedIssuesResponseSchema,
      "TASKS_RESPONSE_INVALID"
    );

    for (const item of page) {
      if (item.pull_request !== undefined) continue;
      const task = normalizeTask(
        item,
        "assigned_issue",
        repositoryIndex
      );
      if (task) tasks.push(task);
      if (tasks.length >= limit) break;
    }

    const hasMore = page.length === GITHUB_PAGE_SIZE;
    if (!hasMore) break;
    if (tasks.length >= limit || pageNumber >= MAX_GITHUB_PAGES) {
      truncated = true;
      break;
    }
    pageNumber += 1;
  }

  return { tasks, truncated };
}

async function fetchSearchedPullRequests(
  config: GitHubConfig,
  request: AuthenticatedRequest,
  repositoryIndex: Map<string, RepositoryIndexEntry>,
  limit: number,
  kind:
    | "review_requested_pull_request"
    | "authored_pull_request",
  query: string
): Promise<TaskFetchResult> {
  const tasks: GitHubTaskSignal[] = [];
  let pageNumber = 1;
  let seenCount = 0;
  let truncated = false;

  while (tasks.length < limit && pageNumber <= MAX_GITHUB_PAGES) {
    const url = apiUrl(config, "/search/issues", {
      q: query,
      sort: "updated",
      order: "desc",
      per_page: String(GITHUB_PAGE_SIZE),
      page: String(pageNumber)
    });
    const response = await request(url);
    assertResponseOk(response, "TASKS_REQUEST_FAILED");
    const page = await parseResponse(
      response,
      searchResponseSchema,
      "TASKS_RESPONSE_INVALID"
    );
    seenCount += page.items.length;
    if (page.incomplete_results) truncated = true;

    for (const item of page.items) {
      if (item.pull_request === undefined) continue;
      const task = normalizeTask(item, kind, repositoryIndex);
      if (task) tasks.push(task);
      if (tasks.length >= limit) break;
    }

    const hasMore = seenCount < page.total_count;
    if (!hasMore) break;
    if (tasks.length >= limit || pageNumber >= MAX_GITHUB_PAGES) {
      truncated = true;
      break;
    }
    if (page.items.length === 0) {
      throw new GitHubApiError("TASKS_RESPONSE_INVALID");
    }
    pageNumber += 1;
  }

  return { tasks, truncated };
}

async function fetchUserActivities(
  config: GitHubConfig,
  request: AuthenticatedRequest,
  userLogin: string,
  repositoryIndex: Map<string, RepositoryIndexEntry>,
  windowStart: string
): Promise<ActivityFetchResult> {
  const activitiesById = new Map<string, GitHubUserActivitySignal>();
  let truncated = false;
  let invalidEventCount = 0;

  for (
    let pageNumber = 1;
    pageNumber <= MAX_GITHUB_ACTIVITY_PAGES;
    pageNumber += 1
  ) {
    let page: unknown[];
    try {
      const response = await request(
        apiUrl(
          config,
          `/users/${encodeURIComponent(userLogin)}/events`,
          {
            per_page: String(GITHUB_PAGE_SIZE),
            page: String(pageNumber)
          }
        )
      );
      assertResponseOk(response, "ACTIVITIES_REQUEST_FAILED");
      page = await parseResponse(
        response,
        eventsResponseSchema,
        "ACTIVITIES_RESPONSE_INVALID"
      );
    } catch (error) {
      if (pageNumber === 1) throw error;
      truncated = true;
      break;
    }

    for (const rawEvent of page) {
      const normalized = normalizeUserActivity(
        rawEvent,
        userLogin,
        repositoryIndex,
        windowStart
      );
      if (normalized.state === "invalid") {
        invalidEventCount += 1;
        continue;
      }
      if (normalized.state === "ignored") continue;
      const activity = normalized.activity;
      if (activitiesById.has(activity.id)) continue;
      activitiesById.set(activity.id, activity);
    }

    if (page.length < GITHUB_PAGE_SIZE) break;
    if (pageNumber === MAX_GITHUB_ACTIVITY_PAGES) {
      truncated = true;
    }
  }

  return {
    state:
      truncated || invalidEventCount > 0 ? "partial" : "available",
    windowStart,
    truncated,
    activities: [...activitiesById.values()]
      .sort(compareGitHubActivities)
      .slice(0, MAX_GITHUB_ACTIVITIES)
  };
}

function normalizeUserActivity(
  value: unknown,
  userLogin: string,
  repositoryIndex: Map<string, RepositoryIndexEntry>,
  windowStart: string
): NormalizedActivityResult {
  const envelope = eventEnvelopeSchema.safeParse(value);
  if (!envelope.success) return { state: "invalid" };

  const event = envelope.data;
  if (
    event.actor.login.toLowerCase() !== userLogin.toLowerCase() ||
    Date.parse(event.created_at) < Date.parse(windowStart)
  ) {
    return { state: "ignored" };
  }

  const repository = repositoryIndex.get(event.repo.name.toLowerCase());
  if (!repository || repository.id !== event.repo.id) {
    return { state: "ignored" };
  }
  if (!SUPPORTED_GITHUB_EVENT_TYPES.has(event.type)) {
    return { state: "ignored" };
  }

  const base = {
    id: String(event.id),
    source: "github" as const,
    kind: "user_activity" as const,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
    occurredAt: event.created_at
  };

  switch (event.type) {
    case "PushEvent": {
      const payload = pushEventPayloadSchema.safeParse(event.payload);
      if (!payload.success) return { state: "invalid" };
      const ref = normalizeGitRef(payload.data.ref);
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind: "push",
          subjectType: ref?.type ?? "repository",
          subjectNumber: null,
          subjectTitle: null,
          refName: ref?.name ?? null,
          reviewState: null
        }
      };
    }
    case "CreateEvent":
    case "DeleteEvent": {
      const payload = refEventPayloadSchema.safeParse(event.payload);
      if (!payload.success) return { state: "invalid" };
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind:
            event.type === "CreateEvent"
              ? "ref_created"
              : "ref_deleted",
          subjectType: payload.data.ref_type,
          subjectNumber: null,
          subjectTitle: null,
          refName: normalizeActivityText(payload.data.ref),
          reviewState: null
        }
      };
    }
    case "IssuesEvent": {
      const payload = issuesEventPayloadSchema.safeParse(event.payload);
      if (!payload.success) return { state: "invalid" };
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind: issueActivityKind(payload.data.action),
          subjectType: payload.data.issue.pull_request
            ? "pull_request"
            : "issue",
          subjectNumber: payload.data.issue.number,
          subjectTitle: normalizeActivityText(payload.data.issue.title),
          refName: null,
          reviewState: null
        }
      };
    }
    case "IssueCommentEvent": {
      const payload = issueCommentEventPayloadSchema.safeParse(
        event.payload
      );
      if (!payload.success) return { state: "invalid" };
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind: "issue_commented",
          subjectType: payload.data.issue.pull_request
            ? "pull_request"
            : "issue",
          subjectNumber: payload.data.issue.number,
          subjectTitle: normalizeActivityText(payload.data.issue.title),
          refName: null,
          reviewState: null
        }
      };
    }
    case "PullRequestEvent": {
      const payload = pullRequestEventPayloadSchema.safeParse(
        event.payload
      );
      if (!payload.success) return { state: "invalid" };
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind: pullRequestActivityKind(
            payload.data.action,
            payload.data.pull_request.merged
          ),
          subjectType: "pull_request",
          subjectNumber: payload.data.pull_request.number,
          subjectTitle: normalizeActivityText(
            payload.data.pull_request.title
          ),
          refName: null,
          reviewState: null
        }
      };
    }
    case "PullRequestReviewEvent": {
      const payload = pullRequestReviewEventPayloadSchema.safeParse(
        event.payload
      );
      if (!payload.success) return { state: "invalid" };
      const reviewState = normalizeReviewState(
        payload.data.review.state
      );
      if (!reviewState) return { state: "invalid" };
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind: "pull_request_reviewed",
          subjectType: "pull_request",
          subjectNumber: payload.data.pull_request.number,
          subjectTitle: normalizeActivityText(
            payload.data.pull_request.title
          ),
          refName: null,
          reviewState
        }
      };
    }
    case "PullRequestReviewCommentEvent": {
      const payload =
        pullRequestReviewCommentEventPayloadSchema.safeParse(
          event.payload
        );
      if (!payload.success) return { state: "invalid" };
      return {
        state: "activity",
        activity: {
          ...base,
          activityKind: "pull_request_review_commented",
          subjectType: "pull_request",
          subjectNumber: payload.data.pull_request.number,
          subjectTitle: normalizeActivityText(
            payload.data.pull_request.title
          ),
          refName: null,
          reviewState: null
        }
      };
    }
    default:
      return { state: "ignored" };
  }
}

function issueActivityKind(
  action: "opened" | "closed" | "reopened"
): GitHubActivityKind {
  switch (action) {
    case "opened":
      return "issue_opened";
    case "closed":
      return "issue_closed";
    case "reopened":
      return "issue_reopened";
  }
}

function pullRequestActivityKind(
  action: "opened" | "closed" | "reopened" | "merged",
  merged: boolean
): GitHubActivityKind {
  if (action === "merged" || (action === "closed" && merged)) {
    return "pull_request_merged";
  }
  switch (action) {
    case "opened":
      return "pull_request_opened";
    case "closed":
      return "pull_request_closed";
    case "reopened":
      return "pull_request_reopened";
  }
}

function normalizeReviewState(value: string): GitHubReviewState | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "approved" ||
    normalized === "changes_requested" ||
    normalized === "commented"
    ? normalized
    : null;
}

function normalizeGitRef(
  value: string
): { type: "branch" | "tag"; name: string } | null {
  const prefixes = [
    ["refs/heads/", "branch"],
    ["refs/tags/", "tag"]
  ] as const;
  for (const [prefix, type] of prefixes) {
    if (!value.startsWith(prefix)) continue;
    const name = normalizeActivityText(value.slice(prefix.length));
    return name ? { type, name } : null;
  }
  return null;
}

function normalizeActivityText(value: string): string | null {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 240) : null;
}

function normalizeInstallation(
  installation: z.input<typeof installationSchema>
): GitHubInstallationSignal {
  return {
    id: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    suspended: installation.suspended_at !== null
  };
}

function normalizeTask(
  item: z.input<typeof taskResponseSchema>,
  kind: GitHubTaskKind,
  repositoryIndex: Map<string, RepositoryIndexEntry>
): GitHubTaskSignal | null {
  const repositoryFullName = repositoryNameFromApiUrl(
    item.repository_url
  );
  if (!repositoryFullName) return null;
  const repository = repositoryIndex.get(
    repositoryFullName.toLowerCase()
  );
  if (!repository) return null;

  const labelNames = Array.from(
    new Set(
      (item.labels ?? [])
        .map((label) =>
          typeof label === "string" ? label : label.name ?? ""
        )
        .map((label) => label.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);

  return {
    id: item.id,
    source: "github",
    kind,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
    number: item.number,
    title: item.title.trim() || "제목 없는 GitHub task",
    htmlUrl: item.html_url,
    labelNames,
    milestoneDueAt: item.milestone?.due_on ?? null,
    state: "open",
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function createAuthenticatedRequest({
  config,
  storedTokens,
  now,
  fetchImpl,
  cwd,
  storeGeneration
}: {
  config: GitHubConfig;
  storedTokens: StoredGitHubTokens;
  now: Date;
  fetchImpl: typeof fetch;
  cwd: string;
  storeGeneration: number;
}): AuthenticatedRequest {
  let tokens = storedTokens;
  let refreshCompleted = false;
  let refreshPromise: Promise<void> | null = null;

  const refreshOrThrow = async () => {
    if (refreshPromise) {
      return refreshPromise;
    }
    if (refreshCompleted) {
      throw new GitHubApiError("REAUTHORIZATION_REQUIRED");
    }
    refreshCompleted = true;
    refreshPromise = (async () => {
      try {
        tokens = await refreshStoredGitHubTokens(
          config,
          tokens,
          fetchImpl,
          now,
          cwd,
          storeGeneration
        );
      } catch (error) {
        if (error instanceof GitHubOAuthError) {
          throw new GitHubApiError("REAUTHORIZATION_REQUIRED");
        }
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  let preparation: Promise<void> | null = null;
  if (shouldRefresh(tokens, now)) {
    preparation = refreshOrThrow();
  }

  return async (url: URL) => {
    if (preparation) {
      await preparation;
      preparation = null;
    }

    const accessTokenUsed = tokens.accessToken;
    let response = await fetchImpl(url, {
      headers: githubApiHeaders(config, accessTokenUsed),
      cache: "no-store"
    });
    if (response.status === 401) {
      if (tokens.accessToken === accessTokenUsed) {
        await refreshOrThrow();
      }
      response = await fetchImpl(url, {
        headers: githubApiHeaders(config, tokens.accessToken),
        cache: "no-store"
      });
    }
    if (response.status === 401) {
      throw new GitHubApiError("REAUTHORIZATION_REQUIRED");
    }
    return response;
  };
}

function refreshStoredGitHubTokens(
  config: GitHubConfig,
  previousTokens: StoredGitHubTokens,
  fetchImpl: typeof fetch,
  now: Date,
  cwd: string,
  storeGeneration: number
): Promise<StoredGitHubTokens> {
  const refreshKey = `${cwd}:${storeGeneration}`;
  const existingRefresh = storedTokenRefreshes.get(refreshKey);
  if (existingRefresh) return existingRefresh;

  const refreshTask = (async () => {
    const latestTokens = await readStoredGitHubTokens(cwd);
    if (!latestTokens) {
      throw new GitHubApiError("NOT_CONNECTED");
    }

    const tokenAlreadyRotated =
      latestTokens.accessToken !== previousTokens.accessToken ||
      latestTokens.refreshToken !== previousTokens.refreshToken;
    if (tokenAlreadyRotated && !shouldRefresh(latestTokens, now)) {
      return latestTokens;
    }

    const refreshedTokens = await refreshGitHubAccessToken(
      config,
      latestTokens,
      fetchImpl,
      now
    );
    await writeStoredGitHubTokens(
      refreshedTokens,
      cwd,
      storeGeneration
    );
    return refreshedTokens;
  })();

  let guardedRefresh: Promise<StoredGitHubTokens>;
  guardedRefresh = refreshTask.finally(() => {
    if (
      storedTokenRefreshes.get(refreshKey) === guardedRefresh
    ) {
      storedTokenRefreshes.delete(refreshKey);
    }
  });
  storedTokenRefreshes.set(refreshKey, guardedRefresh);
  return guardedRefresh;
}

function githubApiHeaders(
  config: GitHubConfig,
  accessToken: string
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "blabase-suggestion",
    "X-GitHub-Api-Version": config.apiVersion
  };
}

function apiUrl(
  config: GitHubConfig,
  path: string,
  searchParams: Record<string, string> = {}
): URL {
  const url = new URL(path, `${config.apiBaseUrl.replace(/\/$/, "")}/`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  errorCode:
    | "USER_RESPONSE_INVALID"
    | "INSTALLATIONS_RESPONSE_INVALID"
    | "REPOSITORIES_RESPONSE_INVALID"
    | "TASKS_RESPONSE_INVALID"
    | "ACTIVITIES_RESPONSE_INVALID"
): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new GitHubApiError(errorCode);
  }
}

function assertResponseOk(
  response: Response,
  errorCode:
    | "USER_REQUEST_FAILED"
    | "INSTALLATIONS_REQUEST_FAILED"
    | "REPOSITORIES_REQUEST_FAILED"
    | "TASKS_REQUEST_FAILED"
    | "ACTIVITIES_REQUEST_FAILED"
): void {
  if (!response.ok) {
    throw new GitHubApiError(errorCode);
  }
}

function repositoryNameFromApiUrl(value: string): string | null {
  try {
    const segments = new URL(value).pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const reposIndex = segments.findIndex(
      (segment, index) =>
        segment === "repos" && index + 3 === segments.length
    );
    if (
      reposIndex < 0 ||
      segments.length !== reposIndex + 3
    ) {
      return null;
    }
    return `${segments[reposIndex + 1]}/${segments[reposIndex + 2]}`;
  } catch {
    return null;
  }
}

function shouldRefresh(
  tokens: StoredGitHubTokens,
  now: Date
): boolean {
  const accessExpiry = Date.parse(tokens.expiresAt);
  const refreshExpiry = Date.parse(tokens.refreshTokenExpiresAt);
  if (
    !Number.isFinite(accessExpiry) ||
    !Number.isFinite(refreshExpiry) ||
    refreshExpiry <= now.getTime()
  ) {
    return true;
  }
  return accessExpiry <= now.getTime() + 60_000;
}

function compareGitHubRepositories(
  left: GitHubRepositorySignal,
  right: GitHubRepositorySignal
): number {
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.id - right.id
  );
}

function deduplicateTasks(
  tasks: GitHubTaskSignal[]
): GitHubTaskSignal[] {
  const deduplicated = new Map<string, GitHubTaskSignal>();
  for (const task of tasks) {
    deduplicated.set(`${task.kind}:${task.id}`, task);
  }
  return Array.from(deduplicated.values());
}

function boundedLimit(
  requested: number | undefined,
  maximum: number
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return maximum;
  }
  return Math.max(1, Math.min(Math.floor(requested), maximum));
}

type TaskFetchResult = {
  tasks: GitHubTaskSignal[];
  truncated: boolean;
};

type ActivityFetchResult = {
  state: "available" | "partial" | "unavailable";
  windowStart: string;
  truncated: boolean;
  activities: GitHubUserActivitySignal[];
};

type NormalizedActivityResult =
  | { state: "activity"; activity: GitHubUserActivitySignal }
  | { state: "ignored" }
  | { state: "invalid" };

function emptyTaskResult(): TaskFetchResult {
  return { tasks: [], truncated: false };
}

function emptyActivityResult(windowStart: string): ActivityFetchResult {
  return {
    state: "available",
    windowStart,
    truncated: false,
    activities: []
  };
}

function unavailableActivityResult(
  windowStart: string
): ActivityFetchResult {
  return {
    state: "unavailable",
    windowStart,
    truncated: false,
    activities: []
  };
}

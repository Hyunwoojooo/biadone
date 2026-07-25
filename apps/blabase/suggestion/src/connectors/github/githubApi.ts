import { z } from "zod";

import type { GitHubConfig } from "./config";
import {
  readStoredGitHubTokens,
  writeStoredGitHubSnapshot,
  writeStoredGitHubTokens
} from "./localStore";
import { refreshGitHubAccessToken } from "./oauth";
import type {
  GitHubInstallationSignal,
  GitHubRepositorySignal,
  GitHubSnapshot,
  GitHubTaskKind,
  GitHubTaskSignal,
  StoredGitHubTokens
} from "./types";

export const MAX_GITHUB_INSTALLATIONS = 50;
export const MAX_GITHUB_REPOSITORIES = 100;
export const MAX_GITHUB_TASKS = 200;

const GITHUB_PAGE_SIZE = 100;
const MAX_GITHUB_PAGES = 10;
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
    cwd
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

  const snapshot: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v1",
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
      combinedTasks.length > tasks.length,
    installations: installationResult.installations,
    repositories: repositoryResult.repositories.sort(
      compareGitHubRepositories
    ),
    tasks
  };

  await writeStoredGitHubSnapshot(snapshot, cwd);
  return snapshot;
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
  cwd
}: {
  config: GitHubConfig;
  storedTokens: StoredGitHubTokens;
  now: Date;
  fetchImpl: typeof fetch;
  cwd: string;
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
          cwd
        );
      } catch {
        throw new GitHubApiError("REAUTHORIZATION_REQUIRED");
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
  cwd: string
): Promise<StoredGitHubTokens> {
  const existingRefresh = storedTokenRefreshes.get(cwd);
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
    await writeStoredGitHubTokens(refreshedTokens, cwd);
    return refreshedTokens;
  })();

  let guardedRefresh: Promise<StoredGitHubTokens>;
  guardedRefresh = refreshTask.finally(() => {
    if (storedTokenRefreshes.get(cwd) === guardedRefresh) {
      storedTokenRefreshes.delete(cwd);
    }
  });
  storedTokenRefreshes.set(cwd, guardedRefresh);
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

function emptyTaskResult(): TaskFetchResult {
  return { tasks: [], truncated: false };
}

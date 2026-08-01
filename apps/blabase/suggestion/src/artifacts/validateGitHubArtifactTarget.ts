import { readStoredGitHubSnapshot } from "../connectors/github/localStore";
import type {
  GitHubSnapshot,
  GitHubTaskSignal
} from "../connectors/github/types";
import {
  githubArtifactIdentitySchema,
  type GitHubArtifactIdentity
} from "./contracts";

export class GitHubArtifactTargetError extends Error {
  constructor(
    public readonly code:
      | "GITHUB_ARTIFACT_URL_INVALID"
      | "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE"
      | "GITHUB_ARTIFACT_REPOSITORY_NOT_FOUND"
      | "GITHUB_ARTIFACT_REPOSITORY_IDENTITY_CONFLICT"
      | "GITHUB_PULL_REQUEST_NOT_FOUND"
      | "GITHUB_PULL_REQUEST_IDENTITY_CONFLICT"
  ) {
    super(code);
    this.name = "GitHubArtifactTargetError";
  }
}

export async function validateStoredGitHubArtifactTarget(
  artifactUrl: string,
  cwd = process.cwd()
): Promise<GitHubArtifactIdentity> {
  const snapshot = await readStoredGitHubSnapshot(cwd);
  if (snapshot === null) {
    throw new GitHubArtifactTargetError(
      "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE"
    );
  }
  return validateGitHubArtifactTarget(artifactUrl, snapshot);
}

/**
 * The raw URL is parsed only at this boundary. Callers persist the returned
 * source-native tuple, never the URL or repository name.
 */
export function validateGitHubArtifactTarget(
  artifactUrl: string,
  snapshot: GitHubSnapshot
): GitHubArtifactIdentity {
  const parsed = parseExactGitHubArtifactUrl(artifactUrl);
  const repositoryMatches = snapshot.repositories.filter(
    (repository) =>
      repository.fullName.toLocaleLowerCase("en-US") ===
      parsed.repositoryFullName.toLocaleLowerCase("en-US")
  );
  if (repositoryMatches.length === 0) {
    throw new GitHubArtifactTargetError(
      "GITHUB_ARTIFACT_REPOSITORY_NOT_FOUND"
    );
  }
  const repository = repositoryMatches[0];
  if (
    !repository ||
    repositoryMatches.some(
      (candidate) =>
        candidate.id !== repository.id ||
        candidate.fullName.toLocaleLowerCase("en-US") !==
          repository.fullName.toLocaleLowerCase("en-US")
    )
  ) {
    throw new GitHubArtifactTargetError(
      "GITHUB_ARTIFACT_REPOSITORY_IDENTITY_CONFLICT"
    );
  }

  if (parsed.kind === "github_commit") {
    return githubArtifactIdentitySchema.parse({
      kind: "github_commit",
      repositoryId: repository.id,
      oid: parsed.oid
    });
  }

  const pullRequests = snapshot.tasks.filter(
    (task) =>
      task.kind !== "assigned_issue" &&
      task.repositoryId === repository.id &&
      task.number === parsed.number
  );
  if (pullRequests.length === 0) {
    throw new GitHubArtifactTargetError(
      "GITHUB_PULL_REQUEST_NOT_FOUND"
    );
  }
  const first = pullRequests[0];
  if (
    !first ||
    pullRequests.some(
      (task) =>
        !samePullRequestTarget(first, task) ||
        !taskMatchesParsedPullRequest(task, parsed)
    ) ||
    !taskMatchesParsedPullRequest(first, parsed)
  ) {
    throw new GitHubArtifactTargetError(
      "GITHUB_PULL_REQUEST_IDENTITY_CONFLICT"
    );
  }
  return githubArtifactIdentitySchema.parse({
    kind: "github_pull_request",
    repositoryId: repository.id,
    objectId: first.id,
    number: first.number
  });
}

type ParsedGitHubArtifactUrl =
  | {
      kind: "github_commit";
      repositoryFullName: string;
      oid: string;
    }
  | {
      kind: "github_pull_request";
      repositoryFullName: string;
      number: number;
    };

function parseExactGitHubArtifactUrl(
  input: string
): ParsedGitHubArtifactUrl {
  if (
    input !== input.trim() ||
    input.length === 0 ||
    input.length > 2_048 ||
    /[\u0000-\u001f\u007f]/u.test(input)
  ) {
    throw invalidUrl();
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidUrl();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLocaleLowerCase("en-US") !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalidUrl();
  }

  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(commit|pull)\/([^/]+)$/
  );
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    throw invalidUrl();
  }
  const repositoryFullName = `${match[1]}/${match[2]}`;
  if (match[3] === "commit") {
    const oid = match[4].toLocaleLowerCase("en-US");
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) {
      throw invalidUrl();
    }
    return { kind: "github_commit", repositoryFullName, oid };
  }
  if (!/^[1-9][0-9]*$/.test(match[4])) throw invalidUrl();
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number)) throw invalidUrl();
  return { kind: "github_pull_request", repositoryFullName, number };
}

function taskMatchesParsedPullRequest(
  task: GitHubTaskSignal,
  parsed: Extract<
    ParsedGitHubArtifactUrl,
    { kind: "github_pull_request" }
  >
): boolean {
  if (
    task.repositoryFullName.toLocaleLowerCase("en-US") !==
      parsed.repositoryFullName.toLocaleLowerCase("en-US") ||
    task.number !== parsed.number
  ) {
    return false;
  }
  try {
    const taskUrl = parseExactGitHubArtifactUrl(task.htmlUrl);
    return (
      taskUrl.kind === "github_pull_request" &&
      taskUrl.repositoryFullName.toLocaleLowerCase("en-US") ===
        parsed.repositoryFullName.toLocaleLowerCase("en-US") &&
      taskUrl.number === parsed.number
    );
  } catch {
    return false;
  }
}

function samePullRequestTarget(
  left: GitHubTaskSignal,
  right: GitHubTaskSignal
): boolean {
  return (
    left.id === right.id &&
    left.repositoryId === right.repositoryId &&
    left.number === right.number
  );
}

function invalidUrl(): GitHubArtifactTargetError {
  return new GitHubArtifactTargetError(
    "GITHUB_ARTIFACT_URL_INVALID"
  );
}

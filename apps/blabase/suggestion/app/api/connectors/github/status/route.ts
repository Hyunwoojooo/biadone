import { NextResponse } from "next/server";

import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../../../../../src/connectors/github/config";
import {
  readStoredGitHubSnapshot,
  readStoredGitHubTokens
} from "../../../../../src/connectors/github/localStore";
import type {
  GitHubConnectionState,
  GitHubSnapshot,
  GitHubTaskKind
} from "../../../../../src/connectors/github/types";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalGitHubRequest(request)) {
    return noStoreJson({
      status: "unavailable",
      message: "GitHub 연결은 http://localhost:3102에서 확인해주세요.",
      localUrl: "http://localhost:3102"
    });
  }

  loadSharedLocalEnv();
  const configResult = loadGitHubConfig();
  if (!configResult.ok) {
    return noStoreJson({
      status: "unavailable",
      message: configResult.message
    });
  }

  const tokens = await readStoredGitHubTokens();
  if (!tokens) {
    return noStoreJson({ status: "disconnected" });
  }
  if (
    tokens.appClientId !== configResult.config.clientId ||
    tokens.appSlug !== configResult.config.appSlug
  ) {
    return noStoreJson({
      status: "reauthorization_required",
      message: "GitHub App 설정이 변경되었습니다. 다시 연결해주세요."
    });
  }
  if (Date.parse(tokens.refreshTokenExpiresAt) <= Date.now()) {
    return noStoreJson({
      status: "reauthorization_required",
      message: "GitHub 연결이 만료되었습니다. 다시 연결해주세요."
    });
  }

  const storedSnapshot = await readStoredGitHubSnapshot();
  const previousSnapshot =
    storedSnapshot?.appClientId === configResult.config.clientId &&
    storedSnapshot.appSlug === configResult.config.appSlug
      ? storedSnapshot
      : null;
  if (previousSnapshot) {
    return noStoreJson(connectedState(previousSnapshot));
  }

  return noStoreJson({
    status: "sync_error",
    message:
      "GitHub 저장본이 아직 없습니다. 동기화를 잠시 기다리거나 다시 시도해주세요.",
    lastSyncedAt: null
  });
}

function connectedState(snapshot: GitHubSnapshot): GitHubConnectionState {
  return {
    status: "connected",
    userLogin: snapshot.user.login,
    lastSyncedAt: snapshot.fetchedAt,
    installationCount: snapshot.installations.length,
    repositoryCount: snapshot.repositories.length,
    taskCount: snapshot.tasks.length,
    assignedIssueCount: countTasks(snapshot, "assigned_issue"),
    reviewRequestedPullRequestCount: countTasks(
      snapshot,
      "review_requested_pull_request"
    ),
    authoredPullRequestCount: countTasks(snapshot, "authored_pull_request"),
    truncated: snapshot.truncated,
    tasks: snapshot.tasks.slice(0, 3).map((task) => ({
      id: task.id,
      kind: task.kind,
      repositoryFullName: task.repositoryFullName,
      number: task.number,
      title: task.title,
      updatedAt: task.updatedAt,
      htmlUrl: task.htmlUrl,
      labelNames: task.labelNames,
      milestoneDueAt: task.milestoneDueAt
    }))
  };
}

function countTasks(snapshot: GitHubSnapshot, kind: GitHubTaskKind): number {
  return snapshot.tasks.filter((task) => task.kind === kind).length;
}

function noStoreJson(body: GitHubConnectionState) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}

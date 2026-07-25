import { NextRequest, NextResponse } from "next/server";

import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../../../../../src/connectors/github/config";
import { fetchAndStoreGitHubSnapshot } from "../../../../../src/connectors/github/githubApi";
import {
  deleteStoredGitHubSnapshot,
  readStoredGitHubTokens
} from "../../../../../src/connectors/github/localStore";
import {
  githubOAuthStatesMatch,
  GITHUB_STATE_COOKIE
} from "../../../../../src/connectors/github/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalGitHubRequest(request)) {
    return redirectWithClearedState(request, "local_only");
  }

  const expectedState = request.cookies.get(GITHUB_STATE_COOKIE)?.value;
  const actualState = request.nextUrl.searchParams.get("state");
  if (!githubOAuthStatesMatch(expectedState, actualState)) {
    return redirectWithClearedState(request, "failed");
  }

  loadSharedLocalEnv();
  const configResult = loadGitHubConfig();
  if (!configResult.ok) {
    return redirectWithClearedState(request, "temporarily_unavailable");
  }

  const tokens = await readStoredGitHubTokens();
  if (!tokens) {
    return redirectWithClearedState(request, "authorization_required");
  }

  try {
    await deleteStoredGitHubSnapshot();
    await fetchAndStoreGitHubSnapshot(configResult.config);
    return redirectWithClearedState(request, "installation_updated");
  } catch {
    return redirectWithClearedState(request, "installation_sync_pending");
  }
}

function redirectWithClearedState(
  request: NextRequest,
  status: string
): NextResponse {
  const destination = new URL("/", request.url);
  destination.searchParams.set("github", status);
  const response = NextResponse.redirect(destination);
  response.cookies.set(GITHUB_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    expires: new Date(0),
    path: "/"
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

import { NextRequest, NextResponse } from "next/server";

import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../../../../../src/connectors/github/config";
import {
  deleteStoredGitHubSnapshot,
  writeStoredGitHubTokens
} from "../../../../../src/connectors/github/localStore";
import { fetchAndStoreGitHubSnapshot } from "../../../../../src/connectors/github/githubApi";
import {
  exchangeGitHubAuthorizationCode,
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

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return redirectWithClearedState(
      request,
      error === "access_denied" ? "cancelled" : "failed"
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectWithClearedState(request, "failed");
  }

  loadSharedLocalEnv();
  const configResult = loadGitHubConfig();
  if (!configResult.ok) {
    return redirectWithClearedState(request, "temporarily_unavailable");
  }

  try {
    const tokens = await exchangeGitHubAuthorizationCode(
      configResult.config,
      code
    );
    await deleteStoredGitHubSnapshot();
    await writeStoredGitHubTokens(tokens);

    let snapshotInstallationCount: number | null = null;
    try {
      const snapshot = await fetchAndStoreGitHubSnapshot(
        configResult.config
      );
      snapshotInstallationCount = snapshot.installations.length;
    } catch {
      snapshotInstallationCount = null;
    }

    if (snapshotInstallationCount === 0) {
      return redirectWithClearedState(
        request,
        "installation_required",
        "/api/connectors/github/install"
      );
    }

    return redirectWithClearedState(
      request,
      snapshotInstallationCount === null
        ? "connected_sync_pending"
        : "connected"
    );
  } catch {
    return redirectWithClearedState(request, "failed");
  }
}

function redirectWithClearedState(
  request: NextRequest,
  status: string,
  pathname = "/"
): NextResponse {
  const destination = new URL(pathname, request.url);
  if (pathname === "/") {
    destination.searchParams.set("github", status);
  }
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

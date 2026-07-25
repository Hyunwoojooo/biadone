import { NextResponse } from "next/server";

import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../../../../../src/connectors/github/config";
import {
  createGitHubAuthorizationUrl,
  createGitHubOAuthState,
  GITHUB_STATE_COOKIE
} from "../../../../../src/connectors/github/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalGitHubRequest(request)) {
    return NextResponse.redirect(new URL("/?github=local_only", request.url));
  }

  loadSharedLocalEnv();
  const configResult = loadGitHubConfig();
  if (!configResult.ok) {
    return NextResponse.redirect(
      new URL("/?github=temporarily_unavailable", request.url)
    );
  }

  const state = createGitHubOAuthState();
  const response = NextResponse.redirect(
    createGitHubAuthorizationUrl(configResult.config, state)
  );
  response.cookies.set(GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 10 * 60,
    path: "/"
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

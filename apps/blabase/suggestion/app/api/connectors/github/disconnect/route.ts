import { NextResponse } from "next/server";

import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../../../../../src/connectors/github/config";
import {
  deleteStoredGitHubSnapshot,
  deleteStoredGitHubTokens,
  readStoredGitHubTokens
} from "../../../../../src/connectors/github/localStore";
import {
  refreshGitHubAccessToken,
  revokeGitHubAuthorization
} from "../../../../../src/connectors/github/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalGitHubRequest(request)) {
    return noStoreError("LOCAL_ONLY", 404);
  }
  if (!isSameOriginRequest(request)) {
    return noStoreError("INVALID_ORIGIN", 403);
  }

  loadSharedLocalEnv();
  const configResult = loadGitHubConfig();
  const tokens = await readStoredGitHubTokens();
  let remoteRevocationFailed = false;
  if (tokens && !configResult.ok) {
    remoteRevocationFailed = true;
  } else if (configResult.ok && tokens) {
    try {
      const accessToken = shouldRefreshBeforeRevocation(tokens.expiresAt)
        ? (
            await refreshGitHubAccessToken(
              configResult.config,
              tokens
            )
          ).accessToken
        : tokens.accessToken;
      await revokeGitHubAuthorization(
        configResult.config,
        accessToken
      );
    } catch {
      remoteRevocationFailed = true;
    }
  }

  await Promise.all([deleteStoredGitHubTokens(), deleteStoredGitHubSnapshot()]);
  return NextResponse.json(
    { status: "disconnected", remoteRevocationFailed },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function shouldRefreshBeforeRevocation(expiresAt: string): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= Date.now() + 60_000;
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function noStoreError(error: string, status: number) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { "Cache-Control": "no-store" }
    }
  );
}

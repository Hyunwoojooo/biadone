import { NextResponse } from "next/server";

import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../../../../../src/connectors/github/config";
import {
  deleteStoredGitHubConnection,
  readStoredGitHubTokens
} from "../../../../../src/connectors/github/localStore";
import {
  refreshGitHubAccessToken,
  revokeGitHubAuthorization
} from "../../../../../src/connectors/github/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";
import { noteRuntimeSourceDisconnected } from "../../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOTE_REVOCATION_TIMEOUT_MS = 2_000;

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
  await deleteStoredGitHubConnection();
  try {
    await noteRuntimeSourceDisconnected("github");
  } catch {
    // Local deletion is authoritative even if sync metadata is degraded.
  }

  let remoteRevocationFailed = false;
  if (tokens && !configResult.ok) {
    remoteRevocationFailed = true;
  } else if (configResult.ok && tokens) {
    try {
      await withTimeout(
        (async () => {
          const accessToken = shouldRefreshBeforeRevocation(
            tokens.expiresAt
          )
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
        })(),
        REMOTE_REVOCATION_TIMEOUT_MS
      );
    } catch {
      remoteRevocationFailed = true;
    }
  }

  return NextResponse.json(
    { status: "disconnected", remoteRevocationFailed },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("REMOTE_REVOCATION_TIMEOUT")),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

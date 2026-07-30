import { NextResponse } from "next/server";

import { hasSameAttentionOrigin } from "../../../../../src/attention/access";
import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../../../../../src/connectors/notion/config";
import {
  deleteStoredNotionConnection,
  readStoredNotionTokens
} from "../../../../../src/connectors/notion/localStore";
import { revokeNotionToken } from "../../../../../src/connectors/notion/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";
import { noteRuntimeSourceDisconnected } from "../../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOTE_REVOCATION_TIMEOUT_MS = 2_000;

export async function POST(request: Request) {
  if (!isLocalNotionRequest(request)) {
    return NextResponse.json(
      { error: "LOCAL_ONLY" },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
  if (!hasSameAttentionOrigin(request)) {
    return NextResponse.json(
      { error: "INVALID_ORIGIN" },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  loadSharedLocalEnv();
  const configResult = loadNotionConfig();
  const tokens = await readStoredNotionTokens();
  await deleteStoredNotionConnection();
  try {
    await noteRuntimeSourceDisconnected("notion");
  } catch {
    // Local deletion is authoritative even if sync metadata is degraded.
  }

  if (configResult.ok && tokens) {
    try {
      await withTimeout(
        revokeNotionToken(configResult.config, tokens.accessToken),
        REMOTE_REVOCATION_TIMEOUT_MS
      );
    } catch {
      // Local deletion still takes precedence if Notion is unreachable.
    }
  }

  return NextResponse.json(
    { status: "disconnected" },
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

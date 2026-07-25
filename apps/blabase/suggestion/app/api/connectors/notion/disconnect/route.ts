import { NextResponse } from "next/server";

import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../../../../../src/connectors/notion/config";
import {
  deleteStoredNotionSnapshot,
  deleteStoredNotionTokens,
  readStoredNotionTokens
} from "../../../../../src/connectors/notion/localStore";
import { revokeNotionToken } from "../../../../../src/connectors/notion/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  loadSharedLocalEnv();
  const configResult = loadNotionConfig();
  const tokens = await readStoredNotionTokens();
  if (configResult.ok && tokens) {
    try {
      await revokeNotionToken(configResult.config, tokens.accessToken);
    } catch {
      // Local deletion still takes precedence if Notion is unreachable.
    }
  }

  await Promise.all([
    deleteStoredNotionTokens(),
    deleteStoredNotionSnapshot()
  ]);
  return NextResponse.json(
    { status: "disconnected" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

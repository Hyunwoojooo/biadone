import { NextResponse } from "next/server";

import { codexErrorState } from "../../../../../src/connectors/codex/connectionState";
import {
  hasSameOrigin,
  isLocalCodexRequest
} from "../../../../../src/connectors/codex/config";
import { deleteStoredCodexConnection } from "../../../../../src/connectors/codex/localStore";
import type { CodexConnectionState } from "../../../../../src/connectors/codex/types";
import { noteRuntimeSourceDisconnected } from "../../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalCodexRequest(request)) {
    return noStoreError("LOCAL_ONLY", 404);
  }
  if (!hasSameOrigin(request)) {
    return noStoreError("INVALID_ORIGIN", 403);
  }

  try {
    await deleteStoredCodexConnection();
    await recordDisconnect();
    return noStoreJson({ status: "disconnected" });
  } catch (error) {
    return noStoreJson(codexErrorState(error, null), 500);
  }
}

async function recordDisconnect(): Promise<void> {
  try {
    await noteRuntimeSourceDisconnected("codex");
  } catch {
    // Local deletion is authoritative even if sync metadata is degraded.
  }
}

function noStoreJson(body: CodexConnectionState, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
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

import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { readRuntimeSourceSyncStatus } from "../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSafeReadOrigin(request)) {
    return noStoreJson(
      { status: "error", code: "INVALID_ORIGIN" },
      403
    );
  }
  try {
    return noStoreJson(
      await readRuntimeSourceSyncStatus({
        startScheduler: false
      })
    );
  } catch {
    return noStoreJson(
      { status: "error", code: "SYNC_STATUS_FAILED" },
      500
    );
  }
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

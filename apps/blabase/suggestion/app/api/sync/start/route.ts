import { NextResponse } from "next/server";

import {
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { startRuntimeSourceSync } from "../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSameAttentionOrigin(request)) {
    return noStoreJson(
      { status: "error", code: "INVALID_ORIGIN" },
      403
    );
  }

  try {
    return noStoreJson(await startRuntimeSourceSync());
  } catch {
    return noStoreJson(
      { status: "error", code: "SOURCE_SYNC_START_FAILED" },
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

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import { syncRuntimeSources } from "../../../src/sync/runtime";
import { syncSourceSchema } from "../../../src/sync/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    sources: z.array(syncSourceSchema).min(1).max(4)
  })
  .strict();

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

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return noStoreJson(
      { status: "error", code: "INVALID_SYNC_REQUEST" },
      400
    );
  }

  try {
    return noStoreJson(
      await syncRuntimeSources({ sources: input.sources })
    );
  } catch {
    return noStoreJson(
      { status: "error", code: "SOURCE_SYNC_FAILED" },
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

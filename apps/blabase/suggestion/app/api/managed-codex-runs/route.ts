import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import {
  managedCodexPublicProjectionSchema,
  readManagedCodexPublicProjection
} from "../../../src/managedCodex";
import { withManagedCodexAuthorityLease } from "../../../src/resumption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message:
          "Codex 실시간 관찰은 로컬 Work Cockpit에서 확인해주세요."
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }

  const now = new Date();
  const cwd = process.cwd();
  try {
    const projection = await withManagedCodexAuthorityLease(
      cwd,
      now,
      async (authority) =>
        managedCodexPublicProjectionSchema.parse(
          await readManagedCodexPublicProjection(
            { ...authority, now },
            cwd
          )
        )
    );
    return noStoreJson({
      status: "ready",
      ...projection
    });
  } catch {
    return errorResponse(
      "MANAGED_CODEX_RUNS_READ_FAILED",
      "Codex 실시간 관찰 상태를 확인하지 못했습니다.",
      500
    );
  }
}

function errorResponse(
  code: string,
  message: string,
  status: number
) {
  return noStoreJson(
    {
      status: "error",
      code,
      message
    },
    status
  );
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import {
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema,
  readManagedCodexObservability,
  type ManagedCodexPublicProjection,
  type ManagedCodexSemanticProjection
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

  const cwd = process.cwd();
  try {
    const observability = await withManagedCodexAuthorityLease(
      cwd,
      () => new Date(),
      async (authority, now) => {
        const read = await readManagedCodexObservability(
          { ...authority, now },
          cwd
        );
        const projection = managedCodexPublicProjectionSchema.parse(
          read.projection
        );
        const semantics = managedCodexSemanticProjectionSchema.parse(
          read.semantics
        );
        assertObservabilityCoherent(projection, semantics);
        return { projection, semantics };
      }
    );
    return noStoreJson({
      status: "ready",
      ...observability.projection,
      semantics: observability.semantics
    });
  } catch {
    return errorResponse(
      "MANAGED_CODEX_RUNS_READ_FAILED",
      "Codex 실시간 관찰 상태를 확인하지 못했습니다.",
      500
    );
  }
}

function assertObservabilityCoherent(
  projection: ManagedCodexPublicProjection,
  semantics: ManagedCodexSemanticProjection
): void {
  if (
    semantics.sourceRevision !== projection.revision ||
    semantics.generatedAt !== projection.generatedAt ||
    Object.keys(semantics.runs).length !== projection.runs.length
  ) {
    throw new TypeError("Managed Codex observability snapshots do not match.");
  }
  for (const run of projection.runs) {
    const semantic = semantics.runs[run.managedRunId];
    if (
      !semantic ||
      semantic.sourceRevision !== projection.revision ||
      semantic.generatedAt !== projection.generatedAt ||
      semantic.bindingId !== run.bindingId ||
      semantic.executionId !== run.executionId
    ) {
      throw new TypeError("Managed Codex run semantics do not match.");
    }
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

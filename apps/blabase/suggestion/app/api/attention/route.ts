import { NextResponse } from "next/server";

import {
  ATTENTION_LOCAL_URL,
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import {
  asEphemeralAttentionPreview,
  evaluateCurrentAttention
} from "../../../src/attention/liveAttention";
import {
  createAttentionExecutionIds,
  createAttentionFailureRecord,
  type AttentionFailureStage
} from "../../../src/attention/execution";
import {
  resolveAttentionCodeProvenance,
  unavailableCodeProvenance
} from "../../../src/attention/codeProvenance";
import {
  recordAttentionFailure,
  recordAttentionRun
} from "../../../src/attention/localMonitorStore";
import type {
  AttentionApiResponse,
  AttentionReadyResponse
} from "../../../src/attention/monitoringSchema";
import { syncRuntimeSources } from "../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return unavailableResponse();
  }
  if (!hasSafeReadOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }
  return runAttention(false, false);
}

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return unavailableResponse();
  }
  if (!hasSameAttentionOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }
  return runAttention(true, true);
}

async function runAttention(
  refreshSources: boolean,
  persistRun: boolean
) {
  const executionIds = persistRun
    ? createAttentionExecutionIds()
    : undefined;
  const startedAt = new Date();
  let stage: AttentionFailureStage = "source_sync";
  let codeProvenance = unavailableCodeProvenance();
  try {
    if (persistRun) {
      codeProvenance = await resolveAttentionCodeProvenance(
        process.cwd(),
        process.env
      );
    }
    if (refreshSources) {
      await syncRuntimeSources();
    }
    stage = "attention_resolution";
    const evaluated = await evaluateCurrentAttention({
      refreshSources: false,
      ...(persistRun ? { startedAt } : {}),
      ...(executionIds
        ? { executionIds, codeProvenance }
        : {})
    });
    const { replayArtifact } = evaluated;
    let publicRun = persistRun
      ? evaluated.run
      : asEphemeralAttentionPreview(evaluated.run);
    let monitoring: AttentionReadyResponse["monitoring"] = {
      state: persistRun ? "recorded" : "preview",
      warningCode: null
    };
    if (persistRun) {
      try {
        await recordAttentionRun(
          evaluated.run,
          replayArtifact
        );
      } catch {
        publicRun = asEphemeralAttentionPreview(evaluated.run);
        monitoring = {
          state: "degraded",
          warningCode: "RUN_HISTORY_WRITE_FAILED"
        };
      }
    }
    return noStoreJson({
      status: "ready",
      result: evaluated.result,
      baseResult: evaluated.baseResult,
      eligibilityProjection: evaluated.eligibilityProjection,
      run: publicRun,
      monitoring
    } satisfies AttentionReadyResponse);
  } catch {
    if (executionIds) {
      try {
        const completedAt = new Date(
          Math.max(startedAt.getTime(), Date.now())
        );
        await recordAttentionFailure(
          createAttentionFailureRecord({
            executionIds,
            startedAt,
            completedAt,
            stage,
            retryCount: 0,
            codeProvenance
          })
        );
      } catch {
        // A failure to persist sanitized diagnostics must not expose internals.
      }
    }
    return errorResponse(
      "ATTENTION_RUN_FAILED",
      "현재 작업 제안을 만들지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.",
      500
    );
  }
}

function unavailableResponse() {
  return noStoreJson(
    {
      status: "unavailable",
      message: `Work Cockpit은 ${ATTENTION_LOCAL_URL}에서 확인해주세요.`,
      localUrl: ATTENTION_LOCAL_URL
    },
    404
  );
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

function noStoreJson(body: AttentionApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

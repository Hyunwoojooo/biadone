import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import {
  attentionEligibilityShadowProjectionSchema,
  resolveAttentionEligibilityShadow
} from "../../../../src/eligibility";
import { readCurrentWorkEvidence } from "../../../../src/workEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Current-only shadow reads are intentionally never cached.

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "Eligibility shadow는 로컬 Attention Lab에서 확인해주세요.",
        localUrl: "http://localhost:3102/attention-lab"
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return noStoreJson(
      {
        status: "error",
        code: "INVALID_ORIGIN",
        message: "허용되지 않은 출처의 요청입니다."
      },
      403
    );
  }

  try {
    const now = new Date();
    const evidence = await readCurrentWorkEvidence({ now });
    const projection = attentionEligibilityShadowProjectionSchema.parse(
      resolveAttentionEligibilityShadow({
        asOf: evidence.asOf,
        githubBatch: evidence.githubBatch,
        workRelationProjection: evidence.workRelations,
        artifactRelationProjection: evidence.artifacts,
        claimAuthorityProjection: evidence.claims
      })
    );
    return noStoreJson({ status: "ready", projection });
  } catch {
    return noStoreJson(
      {
        status: "error",
        code: "ATTENTION_ELIGIBILITY_READ_FAILED",
        message: "후보 eligibility 근거를 확인하지 못했습니다."
      },
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

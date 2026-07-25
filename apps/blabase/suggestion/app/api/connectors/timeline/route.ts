import { NextResponse } from "next/server";

import { readConnectorTimeline } from "../../../../src/connectors/timeline/timeline";
import type { ConnectorTimelineState } from "../../../../src/connectors/timeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_URL = "http://localhost:3102";

export async function GET(request: Request) {
  if (!isLocalTimelineRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: `연결 데이터 타임라인은 ${LOCAL_URL}에서 확인해주세요.`,
        localUrl: LOCAL_URL
      },
      404
    );
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return noStoreJson(
      {
        status: "error",
        message: "허용되지 않은 출처의 요청입니다."
      },
      403
    );
  }

  try {
    return noStoreJson(await readConnectorTimeline());
  } catch {
    return noStoreJson(
      {
        status: "error",
        message:
          "저장된 연결 데이터를 읽지 못했습니다. 로컬 서버 상태를 확인해주세요."
      },
      500
    );
  }
}

function isLocalTimelineRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return new URL(request.url).hostname === "localhost";
}

function noStoreJson(body: ConnectorTimelineState, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

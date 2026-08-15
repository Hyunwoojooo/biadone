import { NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "../../../../src/accessControl";
import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { readStoredCodexConfig } from "../../../../src/connectors/codex/localStore";
import {
  readBoundedJsonRequest,
  type BoundedJsonReadFailureCode
} from "../../../../src/http/boundedJson";
import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_MAX_REQUEST_BYTES,
  WorkBoardMonitoringStoreError,
  type WorkBoardMonitoringErrorCode,
  purgeAllWorkBoardMonitoringData,
  readWorkBoardMonitoringState,
  recordWorkBoardMonitoringMutation,
  workBoardMonitoringErrorResponseSchema,
  workBoardMonitoringMutationInputSchema
} from "../../../../src/suggestionBoard/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gated = gateRequest(request, false);
  if (gated !== null) return gated;
  try {
    const installationSecret = await currentInstallationSecret();
    if (installationSecret === null) {
      return monitoringError("AUTH_UNAVAILABLE", 503);
    }
    return monitoringJson(
      await readWorkBoardMonitoringState({ installationSecret })
    );
  } catch {
    return monitoringError("STORE_UNAVAILABLE", 503);
  }
}

export async function POST(request: Request) {
  const gated = gateRequest(request, true);
  if (gated !== null) return gated;
  const body = await readBoundedJsonRequest(
    request,
    WORK_BOARD_MONITORING_MAX_REQUEST_BYTES
  );
  if (!body.ok) return boundedJsonError(body.code);
  const parsed = workBoardMonitoringMutationInputSchema.safeParse(
    body.value
  );
  if (!parsed.success) return monitoringError("INVALID_REQUEST", 400);

  try {
    if (parsed.data.operation === "purge") {
      return monitoringJson(await purgeAllWorkBoardMonitoringData());
    }
    const installationSecret = await currentInstallationSecret();
    if (installationSecret === null) {
      return monitoringError("AUTH_UNAVAILABLE", 503);
    }
    return monitoringJson(
      await recordWorkBoardMonitoringMutation({
        installationSecret,
        mutation: parsed.data
      })
    );
  } catch (error) {
    if (error instanceof WorkBoardMonitoringStoreError) {
      if (error.code === "CONSENT_REQUIRED") {
        return monitoringError("CONSENT_REQUIRED", 409);
      }
      if (error.code === "RECEIPT_NOT_CURRENT") {
        return monitoringError("RECEIPT_NOT_CURRENT", 409);
      }
      return monitoringError("STORE_UNAVAILABLE", 503);
    }
    return monitoringError("FAILED", 500);
  }
}

function gateRequest(
  request: Request,
  exactPostOrigin: boolean
): NextResponse | null {
  if (!isLocalAttentionRequest(request)) {
    return monitoringError("LOCAL_ONLY", 404);
  }
  if (
    exactPostOrigin
      ? !hasSameAttentionOrigin(request)
      : !hasSafeReadOrigin(request)
  ) {
    return monitoringError("INVALID_ORIGIN", 403);
  }
  if (process.env.BLABASE_WORK_BOARD_MONITORING_ENABLED !== "true") {
    return monitoringError("DISABLED", 404);
  }
  const password = process.env.SUGGESTION_ACCESS_PASSWORD;
  if (!password) return monitoringError("AUTH_UNAVAILABLE", 503);
  if (
    !hasValidBasicAuthorization(
      request.headers.get("authorization"),
      password
    )
  ) {
    return monitoringError("UNAUTHORIZED", 401, {
      "WWW-Authenticate": 'Basic realm="blabase suggestion"'
    });
  }
  return null;
}

async function currentInstallationSecret(): Promise<string | null> {
  const config = await readStoredCodexConfig(process.cwd(), "preserve");
  return config?.installationSecret ?? null;
}

function boundedJsonError(
  code: BoundedJsonReadFailureCode
): NextResponse {
  if (code === "INVALID_CONTENT_TYPE") {
    return monitoringError("INVALID_CONTENT_TYPE", 415);
  }
  if (code === "MISSING_CONTENT_LENGTH") {
    return monitoringError("INVALID_CONTENT_LENGTH", 411);
  }
  if (code === "CONTENT_LENGTH_TOO_LARGE") {
    return monitoringError("INVALID_CONTENT_LENGTH", 413);
  }
  return monitoringError(
    code === "CONTENT_LENGTH_MISMATCH"
      ? "INVALID_CONTENT_LENGTH"
      : "INVALID_REQUEST",
    400
  );
}

function monitoringError(
  code: WorkBoardMonitoringErrorCode,
  status: number,
  extraHeaders: Record<string, string> = {}
) {
  return monitoringJson(
    workBoardMonitoringErrorResponseSchema.parse({
      contract: WORK_BOARD_MONITORING_API_CONTRACT,
      status: "error",
      code
    }),
    status,
    extraHeaders
  );
}

function monitoringJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders
    }
  });
}

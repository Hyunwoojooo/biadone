import { NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "../../../../src/accessControl";
import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { readStoredCodexConfig } from "../../../../src/connectors/codex/localStore";
import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_MAX_REQUEST_BYTES,
  WorkBoardMonitoringStoreError,
  type WorkBoardMonitoringErrorCode,
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
  const body = await readBoundedJson(request);
  if (!body.ok) return body.response;
  const parsed = workBoardMonitoringMutationInputSchema.safeParse(
    body.value
  );
  if (!parsed.success) return monitoringError("INVALID_REQUEST", 400);

  try {
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

async function readBoundedJson(
  request: Request
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse }
> {
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (
    contentType === undefined ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(contentType)
  ) {
    return {
      ok: false,
      response: monitoringError("INVALID_CONTENT_TYPE", 415)
    };
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength === null ||
    !/^[1-9][0-9]{0,4}$/u.test(contentLength)
  ) {
    return {
      ok: false,
      response: monitoringError("INVALID_CONTENT_LENGTH", 411)
    };
  }
  const declaredLength = Number(contentLength);
  if (declaredLength > WORK_BOARD_MONITORING_MAX_REQUEST_BYTES) {
    return {
      ok: false,
      response: monitoringError("INVALID_CONTENT_LENGTH", 413)
    };
  }
  if (request.body === null) {
    return {
      ok: false,
      response: monitoringError("INVALID_REQUEST", 400)
    };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > WORK_BOARD_MONITORING_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          response: monitoringError("INVALID_CONTENT_LENGTH", 413)
        };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (bytesRead !== declaredLength) {
      return {
        ok: false,
        response: monitoringError("INVALID_CONTENT_LENGTH", 400)
      };
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: monitoringError("INVALID_REQUEST", 400)
    };
  } finally {
    reader.releaseLock();
  }
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

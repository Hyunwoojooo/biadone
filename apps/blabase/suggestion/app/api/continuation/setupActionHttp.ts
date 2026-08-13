import { NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "../../../src/accessControl";
import {
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import {
  CONTINUATION_SETUP_ACTION_API_CONTRACT,
  continuationSetupActionErrorResponseSchema,
  type ContinuationSetupActionErrorCode
} from "../../../src/continuation/actions";

export const MAX_ACTION_REQUEST_BYTES = 512;

export function gateContinuationSetupActionPost(
  request: Request
): NextResponse | null {
  if (!isLocalAttentionRequest(request)) {
    return setupActionError("SETUP_ACTION_LOCAL_ONLY", 404);
  }
  if (!hasSameAttentionOrigin(request)) {
    return setupActionError("INVALID_ORIGIN", 403);
  }
  if (
    process.env.BLABASE_CONTINUATION_SETUP_ACTION_ENABLED !== "true"
  ) {
    return setupActionError("DISABLED", 404);
  }
  const password = process.env.SUGGESTION_ACCESS_PASSWORD;
  if (!password) {
    return setupActionError("AUTH_UNAVAILABLE", 503);
  }
  if (
    !hasValidBasicAuthorization(
      request.headers.get("authorization"),
      password
    )
  ) {
    return setupActionError("UNAUTHORIZED", 401, {
      "WWW-Authenticate": 'Basic realm="blabase suggestion"'
    });
  }
  return null;
}

export async function readContinuationSetupActionJson(
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
      response: setupActionError("INVALID_CONTENT_TYPE", 415)
    };
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength === null ||
    !/^[1-9][0-9]{0,3}$/u.test(contentLength)
  ) {
    return {
      ok: false,
      response: setupActionError("INVALID_CONTENT_LENGTH", 411)
    };
  }
  const declaredLength = Number(contentLength);
  if (declaredLength > MAX_ACTION_REQUEST_BYTES) {
    return {
      ok: false,
      response: setupActionError("INVALID_CONTENT_LENGTH", 413)
    };
  }
  if (request.body === null) {
    return {
      ok: false,
      response: setupActionError("INVALID_REQUEST", 400)
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
      if (bytesRead > MAX_ACTION_REQUEST_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          response: setupActionError("INVALID_CONTENT_LENGTH", 413)
        };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (bytesRead !== declaredLength) {
      return {
        ok: false,
        response: setupActionError("INVALID_CONTENT_LENGTH", 400)
      };
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: setupActionError("INVALID_REQUEST", 400)
    };
  } finally {
    reader.releaseLock();
  }
}

export function setupActionError(
  code: ContinuationSetupActionErrorCode,
  status: number,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return setupActionJson(
    continuationSetupActionErrorResponseSchema.parse({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "error",
      code
    }),
    status,
    extraHeaders
  );
}

export function setupActionJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): NextResponse {
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

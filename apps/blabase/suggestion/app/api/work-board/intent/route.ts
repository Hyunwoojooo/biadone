import { NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "../../../../src/accessControl";
import {
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { isPreserveCaptureError } from "../../../../src/attention/preserveCapture";
import { readBoundedJsonRequest } from "../../../../src/http/boundedJson";
import {
  confirmStoredSemanticContinuationIntent,
  findSemanticContinuationConfirmationTarget,
  semanticContinuationConfirmationInputSchema,
  semanticContinuationTitle,
  SemanticContinuationStoreError
} from "../../../../src/semanticContinuation";
import { evaluateLiveWorkSuggestionBoardBase } from "../../../../src/suggestionBoard/liveShadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_INTENT_REQUEST_BYTES = 8 * 1024;

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_LOCAL_ONLY" },
      404
    );
  }
  if (!hasSameAttentionOrigin(request)) {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_INVALID_ORIGIN" },
      403
    );
  }
  if (process.env.BLABASE_WORK_BOARD_SHADOW_READ_ENABLED !== "true") {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_DISABLED" },
      404
    );
  }
  if (
    process.env.BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED !== "true"
  ) {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_DISABLED" },
      404
    );
  }
  const password = process.env.SUGGESTION_ACCESS_PASSWORD;
  if (!password) {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_AUTH_UNAVAILABLE" },
      503
    );
  }
  if (
    !hasValidBasicAuthorization(
      request.headers.get("authorization"),
      password
    )
  ) {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_UNAUTHORIZED" },
      401,
      { "WWW-Authenticate": 'Basic realm="blabase suggestion"' }
    );
  }

  const bounded = await readBoundedJsonRequest(
    request,
    MAX_INTENT_REQUEST_BYTES
  );
  if (!bounded.ok) {
    const status =
      bounded.code === "INVALID_CONTENT_TYPE"
        ? 415
        : bounded.code === "MISSING_CONTENT_LENGTH"
          ? 411
          : bounded.code === "CONTENT_LENGTH_TOO_LARGE"
            ? 413
            : 400;
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_INVALID" },
      status
    );
  }
  const body = bounded.value;
  const confirmation =
    semanticContinuationConfirmationInputSchema.safeParse(body);
  if (!confirmation.success) {
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_INVALID" },
      400
    );
  }

  try {
    const base = await evaluateLiveWorkSuggestionBoardBase();
    if (
      base.response.status !== "ready" ||
      base.response.mode !== "full" ||
      base.registrySha256 === null ||
      base.installationSecret === null ||
      base.installationSecret === undefined
    ) {
      return json(
        { status: "error", code: "WORK_BOARD_INTENT_STALE" },
        409
      );
    }
    const target = findSemanticContinuationConfirmationTarget(
      base.response.board,
      confirmation.data
    );
    if (target === null) {
      return json(
        { status: "error", code: "WORK_BOARD_INTENT_STALE" },
        409
      );
    }
    const confirmedAt = new Date().toISOString();
    const { decision } = await confirmStoredSemanticContinuationIntent({
      confirmation: confirmation.data,
      target,
      registrySha256: base.registrySha256,
      confirmedAt,
      installationSecret: base.installationSecret
    });
    return json({
      status: "confirmed",
      intent: decision.intent,
      title: semanticContinuationTitle(decision.subjectLabel),
      expiresAt: decision.expiresAt
    });
  } catch (error) {
    if (
      error instanceof SemanticContinuationStoreError &&
      error.code === "TARGET_EXPIRED"
    ) {
      return json(
        { status: "error", code: "WORK_BOARD_INTENT_STALE" },
        409
      );
    }
    return json(
      { status: "error", code: "WORK_BOARD_INTENT_FAILED" },
      isPreserveCaptureError(error) ? 503 : 500
    );
  }
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders
    }
  });
}

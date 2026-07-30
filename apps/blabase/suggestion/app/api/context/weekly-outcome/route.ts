import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasSafeReadOrigin,
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import {
  captureStoredWeeklyOutcome,
  readWeeklyOutcome,
  weeklyOutcomeValidUntil
} from "../../../../src/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    primaryOutcome: z.string().trim().min(1).max(240)
  })
  .strict();

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSafeReadOrigin(request)) {
    return noStoreJson(
      { status: "error", message: "INVALID_ORIGIN" },
      403
    );
  }
  try {
    return noStoreJson(await currentResponse(new Date()));
  } catch {
    return noStoreJson(
      { status: "error", message: "WEEKLY_OUTCOME_READ_FAILED" },
      500
    );
  }
}

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson({ status: "unavailable" }, 404);
  }
  if (!hasSameAttentionOrigin(request)) {
    return noStoreJson(
      { status: "error", message: "INVALID_ORIGIN" },
      403
    );
  }
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return noStoreJson(
      { status: "error", message: "INVALID_WEEKLY_OUTCOME" },
      400
    );
  }

  const now = new Date();
  const capturedAt = now.toISOString();
  try {
    await captureStoredWeeklyOutcome({
      primaryOutcome: input.primaryOutcome,
      capturedAt,
      validUntil: weeklyOutcomeValidUntil(capturedAt),
      recordedAt: capturedAt
    });
    return noStoreJson(await currentResponse(now));
  } catch {
    return noStoreJson(
      { status: "error", message: "WEEKLY_OUTCOME_WRITE_FAILED" },
      500
    );
  }
}

async function currentResponse(now: Date) {
  const resolved = await readWeeklyOutcome({
    asOf: now.toISOString()
  });
  return {
    status: "ready" as const,
    focus:
      resolved.status === "available"
        ? {
            primaryOutcome: resolved.outcome.primaryOutcome,
            capturedAt: resolved.outcome.capturedAt,
            validUntil: resolved.outcome.validUntil
          }
        : null,
    projectResolution: "global",
    projectId: null
  };
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

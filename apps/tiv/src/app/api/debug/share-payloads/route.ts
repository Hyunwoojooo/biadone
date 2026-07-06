import { NextResponse } from "next/server";

import {
  fetchShareHtml,
  summarizePayloadStructure,
  validateShareUrl
} from "@/core/adapters/chatgpt-share";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shareUrl = url.searchParams.get("url") ?? "";
  const validation = validateShareUrl(shareUrl);

  if (!validation.valid || !validation.normalizedUrl) {
    return NextResponse.json(
      {
        ok: false,
        stage: "validate_url",
        error: validation.errorCode ?? "INVALID_URL"
      },
      { status: 400 }
    );
  }

  try {
    const startedAt = Date.now();
    const result = await fetchShareHtml({ url: validation.normalizedUrl });
    const summary = summarizePayloadStructure(result.html);

    return NextResponse.json({
      ok: true,
      stage: "summarize_payloads",
      mode: process.env.CHATGPT_SHARE_FETCHER_URL ? "fetcher" : "direct",
      status: result.statusCode,
      finalUrl: result.finalUrl,
      elapsedMs: Date.now() - startedAt,
      summary
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "summarize_payloads",
        error: error instanceof Error ? error.message : "Unknown payload error",
        cause:
          error instanceof Error && "cause" in error
            ? String((error as Error & { cause?: unknown }).cause)
            : null
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

import { fetchShareHtml, validateShareUrl } from "@/core/adapters/chatgpt-share";

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
    const html = result.html;

    return NextResponse.json({
      ok: true,
      stage: "fetch_html",
      mode: process.env.CHATGPT_SHARE_FETCHER_URL ? "fetcher" : "direct",
      status: result.statusCode,
      finalUrl: result.finalUrl,
      elapsedMs: Date.now() - startedAt,
      htmlLength: html.length,
      hasStreamControllerEnqueue: html.includes("streamController.enqueue"),
      hasLinearConversation: html.includes("linear_conversation"),
      hasLoginText: html.includes("Log in")
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "fetch_html",
        error: error instanceof Error ? error.message : "Unknown fetch error",
        cause:
          error instanceof Error && "cause" in error
            ? String((error as Error & { cause?: unknown }).cause)
            : null
      },
      { status: 500 }
    );
  }
}

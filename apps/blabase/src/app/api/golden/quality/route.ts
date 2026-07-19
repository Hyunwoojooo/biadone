import { NextResponse } from "next/server";

import {
  GoldenQualityReportReadError,
  readGoldenQualitySummary
} from "@/core/golden-baseline/qualityReportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store"
};

export async function GET() {
  try {
    const report = await readGoldenQualitySummary();
    return NextResponse.json(report, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const normalized = normalizeError(error);
    return NextResponse.json(
      {
        error: {
          code: normalized.code,
          message: normalized.message
        }
      },
      {
        status:
          normalized.code === "GOLDEN_QUALITY_REPORT_NOT_FOUND" ? 404 : 503,
        headers: NO_STORE_HEADERS
      }
    );
  }
}

function normalizeError(error: unknown): GoldenQualityReportReadError {
  if (error instanceof GoldenQualityReportReadError) return error;
  return new GoldenQualityReportReadError(
    "GOLDEN_QUALITY_REPORT_READ_FAILED",
    "Golden Dataset 품질 보고서를 읽지 못했습니다."
  );
}

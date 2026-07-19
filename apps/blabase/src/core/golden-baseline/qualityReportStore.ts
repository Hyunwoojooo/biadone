import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

export const DEFAULT_GOLDEN_QUALITY_REPORT_PATH =
  ".local/golden-v01-quality.json";
export const MAX_GOLDEN_QUALITY_REPORT_BYTES = 1_000_000;

export type GoldenQualitySummary = {
  datasetVersion: string | null;
  goldSnapshotSha256: string | null;
  qualityReportVersion: string;
  generatedAt: string;
  issueCounts: {
    error: number;
    warning: number;
  };
  warnings: Array<{
    code: string;
    targetId: string | null;
  }>;
};

export type GoldenQualityReportReadErrorCode =
  | "GOLDEN_QUALITY_REPORT_NOT_FOUND"
  | "GOLDEN_QUALITY_REPORT_TOO_LARGE"
  | "GOLDEN_QUALITY_REPORT_INVALID"
  | "GOLDEN_QUALITY_REPORT_READ_FAILED";

export class GoldenQualityReportReadError extends Error {
  readonly code: GoldenQualityReportReadErrorCode;

  constructor(code: GoldenQualityReportReadErrorCode, message: string) {
    super(message);
    this.name = "GoldenQualityReportReadError";
    this.code = code;
  }
}

type ReadGoldenQualitySummaryOptions = {
  reportPath?: string;
  maxBytes?: number;
};

const safeVersionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const safeTargetIdSchema = z.string().regex(/^S-\d{3,}(?:-P\d{3,})?$/);
const issueSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  targetId: safeTargetIdSchema.optional()
});
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const persistedQualityReportSchema = z.object({
  reportVersion: safeVersionSchema,
  generatedAt: z.string().datetime({ offset: true }),
  datasetVersion: safeVersionSchema.nullable(),
  goldSnapshotSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  issueCounts: z.object({
    error: nonNegativeIntegerSchema,
    warning: nonNegativeIntegerSchema,
    info: nonNegativeIntegerSchema
  }),
  issues: z.array(issueSchema)
});

export async function readGoldenQualitySummary(
  options: ReadGoldenQualitySummaryOptions = {}
): Promise<GoldenQualitySummary> {
  const configuredPath =
    options.reportPath ??
    process.env.BLABASE_GOLDEN_QUALITY_REPORT_PATH ??
    DEFAULT_GOLDEN_QUALITY_REPORT_PATH;
  const reportPath = resolve(process.cwd(), configuredPath);
  const maxBytes = options.maxBytes ?? MAX_GOLDEN_QUALITY_REPORT_BYTES;

  let fileSize: number;
  try {
    const fileStats = await stat(reportPath);
    if (!fileStats.isFile()) {
      throw new GoldenQualityReportReadError(
        "GOLDEN_QUALITY_REPORT_INVALID",
        "Golden Dataset 품질 보고서 경로가 파일이 아닙니다."
      );
    }
    fileSize = fileStats.size;
  } catch (error) {
    throw normalizeFileError(error);
  }

  if (fileSize > maxBytes) {
    throw new GoldenQualityReportReadError(
      "GOLDEN_QUALITY_REPORT_TOO_LARGE",
      "Golden Dataset 품질 보고서가 허용 크기를 초과했습니다."
    );
  }

  let source: string;
  try {
    source = await readFile(reportPath, "utf8");
  } catch (error) {
    throw normalizeFileError(error);
  }
  if (Buffer.byteLength(source, "utf8") > maxBytes) {
    throw new GoldenQualityReportReadError(
      "GOLDEN_QUALITY_REPORT_TOO_LARGE",
      "Golden Dataset 품질 보고서가 허용 크기를 초과했습니다."
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new GoldenQualityReportReadError(
      "GOLDEN_QUALITY_REPORT_INVALID",
      "Golden Dataset 품질 보고서가 유효한 JSON이 아닙니다."
    );
  }

  return sanitizeGoldenQualityReport(value);
}

export function sanitizeGoldenQualityReport(
  value: unknown
): GoldenQualitySummary {
  const parsed = persistedQualityReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new GoldenQualityReportReadError(
      "GOLDEN_QUALITY_REPORT_INVALID",
      "Golden Dataset 품질 보고서가 조회 계약과 일치하지 않습니다."
    );
  }

  const report = parsed.data;
  for (const severity of ["error", "warning", "info"] as const) {
    const actualCount = report.issues.filter(
      (issue) => issue.severity === severity
    ).length;
    if (report.issueCounts[severity] !== actualCount) {
      throw new GoldenQualityReportReadError(
        "GOLDEN_QUALITY_REPORT_INVALID",
        "Golden Dataset 품질 보고서의 이슈 개수가 일치하지 않습니다."
      );
    }
  }

  return {
    datasetVersion: report.datasetVersion,
    goldSnapshotSha256: report.goldSnapshotSha256,
    qualityReportVersion: report.reportVersion,
    generatedAt: report.generatedAt,
    issueCounts: {
      error: report.issueCounts.error,
      warning: report.issueCounts.warning
    },
    warnings: report.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => ({
        code: issue.code,
        targetId: issue.targetId ?? null
      }))
  };
}

function normalizeFileError(error: unknown): GoldenQualityReportReadError {
  if (error instanceof GoldenQualityReportReadError) return error;
  if (isNodeError(error) && error.code === "ENOENT") {
    return new GoldenQualityReportReadError(
      "GOLDEN_QUALITY_REPORT_NOT_FOUND",
      "Golden Dataset 품질 보고서를 찾지 못했습니다."
    );
  }
  return new GoldenQualityReportReadError(
    "GOLDEN_QUALITY_REPORT_READ_FAILED",
    "Golden Dataset 품질 보고서를 읽지 못했습니다."
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

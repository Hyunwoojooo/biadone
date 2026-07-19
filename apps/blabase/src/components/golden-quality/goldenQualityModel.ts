export type GoldenQualityWarning = {
  code: string;
  targetId: string | null;
};

export type GoldenQualityReport = {
  datasetVersion: string | null;
  goldSnapshotSha256: string | null;
  qualityReportVersion: string;
  generatedAt: string;
  issueCounts: {
    error: number;
    warning: number;
  };
  warnings: GoldenQualityWarning[];
};

export type GoldenWarningGroup = {
  code: string;
  label: string;
  description: string;
  count: number;
  targetCount: number;
};

export type GoldenWarningTargetRow = {
  key: string;
  code: string;
  label: string;
  targetId: string | null;
  targetKind: "prompt" | "session" | "dataset";
  occurrences: number;
};

type WarningCopy = {
  label: string;
  description: string;
};

const WARNING_COPY: Record<string, WarningCopy> = {
  PROMPT_CANCELLED_INPUT: {
    label: "취소·오입력 프롬프트",
    description: "취소 또는 오입력 표시가 반복된 프롬프트 Gold입니다."
  },
  PROMPT_GOLD_EMPTY: {
    label: "비어 있는 프롬프트 Gold",
    description: "프롬프트 Gold 필드 중 비어 있는 값이 있습니다."
  },
  PROMPT_GOLD_FIELDS_IDENTICAL: {
    label: "동일한 프롬프트 Gold",
    description: "여러 프롬프트 Gold 필드가 같은 값으로 작성됐습니다."
  },
  SUMMARY_GOLD_EMPTY: {
    label: "비어 있는 세션 요약",
    description: "세션 요약 Gold 필드 중 비어 있는 값이 있습니다."
  },
  SUMMARY_AUTHOR_REVIEW_PENDING: {
    label: "작성자 판정 보류",
    description: "세션 요약의 작성자 판정이 검토 필요 상태입니다."
  },
  SESSION_TITLE_EMPTY: {
    label: "비어 있는 세션 제목",
    description: "세션 제목을 사람이 확인해야 합니다."
  },
  SESSION_SUMMARY_TITLE_MISMATCH: {
    label: "세션 제목 불일치",
    description: "세션 목록과 세션 요약의 제목이 일치하지 않습니다."
  }
};

export function buildGoldenWarningGroups(
  warnings: GoldenQualityWarning[]
): GoldenWarningGroup[] {
  const groups = new Map<string, { count: number; targetIds: Set<string> }>();
  for (const warning of warnings) {
    const group = groups.get(warning.code) ?? {
      count: 0,
      targetIds: new Set<string>()
    };
    group.count += 1;
    if (warning.targetId) group.targetIds.add(warning.targetId);
    groups.set(warning.code, group);
  }

  return [...groups.entries()]
    .map(([code, group]) => ({
      code,
      ...warningCopy(code),
      count: group.count,
      targetCount: group.targetIds.size
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.code.localeCompare(right.code)
    );
}

export function buildGoldenWarningTargetRows(
  warnings: GoldenQualityWarning[]
): GoldenWarningTargetRow[] {
  const rows = new Map<string, GoldenWarningTargetRow>();
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.targetId ?? "dataset"}`;
    const existing = rows.get(key);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }
    rows.set(key, {
      key,
      code: warning.code,
      label: warningCopy(warning.code).label,
      targetId: warning.targetId,
      targetKind: goldenTargetKind(warning.targetId),
      occurrences: 1
    });
  }
  return [...rows.values()].sort(
    (left, right) =>
      (left.targetId ?? "").localeCompare(right.targetId ?? "") ||
      left.code.localeCompare(right.code)
  );
}

export function goldenTargetKind(
  targetId: string | null
): "prompt" | "session" | "dataset" {
  if (!targetId) return "dataset";
  return targetId.includes("-P") ? "prompt" : "session";
}

export function goldenQualityState(report: GoldenQualityReport): {
  label: "ERROR" | "REVIEW" | "PASS";
  tone: "error" | "warning" | "pass";
  description: string;
} {
  if (report.issueCounts.error > 0) {
    return {
      label: "ERROR",
      tone: "error",
      description:
        "구조 오류를 해결하기 전에는 베이스라인을 실행할 수 없습니다."
    };
  }
  if (report.issueCounts.warning > 0) {
    return {
      label: "REVIEW",
      tone: "warning",
      description:
        "구조 오류는 없으며 표시된 항목은 사람 검수를 기다리고 있습니다."
    };
  }
  return {
    label: "PASS",
    tone: "pass",
    description: "자동 품질 검사에서 오류나 검수 경고가 발견되지 않았습니다."
  };
}

export function formatGoldenQualityTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date)} KST`;
}

export function isGoldenQualityReport(
  value: unknown
): value is GoldenQualityReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<GoldenQualityReport>;
  return (
    (typeof report.datasetVersion === "string" ||
      report.datasetVersion === null) &&
    (typeof report.goldSnapshotSha256 === "string" ||
      report.goldSnapshotSha256 === null) &&
    typeof report.qualityReportVersion === "string" &&
    typeof report.generatedAt === "string" &&
    Boolean(report.issueCounts) &&
    typeof report.issueCounts?.error === "number" &&
    typeof report.issueCounts?.warning === "number" &&
    Array.isArray(report.warnings) &&
    report.warnings.every(
      (warning) =>
        Boolean(warning) &&
        typeof warning.code === "string" &&
        (typeof warning.targetId === "string" || warning.targetId === null)
    )
  );
}

function warningCopy(code: string): WarningCopy {
  return (
    WARNING_COPY[code] ?? {
      label: code
        .toLocaleLowerCase("en-US")
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      description: "자동 품질 검사에서 사람이 확인할 항목으로 분류됐습니다."
    }
  );
}

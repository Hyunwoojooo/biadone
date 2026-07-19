"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleX,
  Clock3,
  Database,
  FileWarning,
  Hash,
  Home,
  LoaderCircle,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildGoldenWarningGroups,
  buildGoldenWarningTargetRows,
  formatGoldenQualityTimestamp,
  goldenQualityState,
  isGoldenQualityReport,
  type GoldenQualityReport
} from "./goldenQualityModel";
import styles from "./GoldenQualityDashboard.module.css";

type LoadPhase = "loading" | "ready" | "refreshing" | "error";

type DashboardError = {
  status: number;
  code: string;
  message: string;
};

type DashboardState = {
  phase: LoadPhase;
  report: GoldenQualityReport | null;
  error: DashboardError | null;
};

export function GoldenQualityDashboard() {
  const requestRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<DashboardState>({
    phase: "loading",
    report: null,
    error: null
  });

  const loadReport = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => ({
      ...current,
      phase: current.report ? "refreshing" : "loading",
      error: null
    }));

    try {
      const response = await fetch("/api/golden/quality", {
        cache: "no-store",
        signal: controller.signal
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throw dashboardError(response.status, payload);
      if (!isGoldenQualityReport(payload)) {
        throw {
          status: 503,
          code: "GOLDEN_QUALITY_RESPONSE_INVALID",
          message: "품질 보고서 응답 형식을 확인하지 못했습니다."
        } satisfies DashboardError;
      }
      setState({ phase: "ready", report: payload, error: null });
    } catch (error) {
      if (isAbortError(error)) return;
      setState((current) => ({
        phase: "error",
        report: current.report,
        error: normalizeDashboardError(error)
      }));
    }
  }, []);

  useEffect(() => {
    void loadReport();
    return () => requestRef.current?.abort();
  }, [loadReport]);

  const report = state.report;
  const quality = report ? goldenQualityState(report) : null;

  return (
    <main className={styles.dashboard}>
      <QualityHeader
        phase={state.phase}
        report={report}
        quality={quality}
        onRefresh={() => void loadReport()}
      />
      <QualityPipeline report={report} />

      {!report && state.phase === "loading" ? <LoadingState /> : null}
      {!report && state.phase === "error" ? (
        <ErrorState error={state.error} onRetry={() => void loadReport()} />
      ) : null}
      {report && quality ? (
        <QualityContent
          report={report}
          quality={quality}
          refreshError={state.error}
          onRetry={() => void loadReport()}
        />
      ) : null}
    </main>
  );
}

function QualityHeader({
  phase,
  report,
  quality,
  onRefresh
}: {
  phase: LoadPhase;
  report: GoldenQualityReport | null;
  quality: ReturnType<typeof goldenQualityState> | null;
  onRefresh: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerMain}>
        <Link href="/" className={styles.brand} title="새 링크 분석">
          <span className={styles.logo}>blabase</span>
          <span>
            <strong>blabase Extraction Monitor</strong>
            <small>INTERNAL OPERATIONS</small>
          </span>
        </Link>
        <span className={styles.headerDivider} />
        <div className={styles.pageIdentity}>
          <strong>Golden Dataset Quality</strong>
          <span>{report?.datasetVersion ?? "LATEST PRIVATE REPORT"}</span>
        </div>
        <Link
          href="/atlas"
          className={styles.headerLink}
          title="Structure Atlas 열기"
        >
          <Home size={14} /> Structure Atlas
        </Link>
        <StatusBadge
          label={
            phase === "loading"
              ? "LOADING"
              : !quality
                ? "UNAVAILABLE"
                : quality.label
          }
          tone={
            phase === "loading" ? "neutral" : !quality ? "error" : quality.tone
          }
        />
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Golden 품질 보고서 새로고침"
          title="최신 품질 보고서 다시 불러오기"
          onClick={onRefresh}
          disabled={phase === "loading" || phase === "refreshing"}
        >
          <RefreshCw
            size={16}
            className={
              phase === "loading" || phase === "refreshing"
                ? styles.spinning
                : ""
            }
          />
        </button>
      </div>
      <nav className={styles.tabs} aria-label="Golden Dataset 화면">
        <span className={styles.activeTab}>Quality Overview</span>
      </nav>
    </header>
  );
}

function QualityPipeline({ report }: { report: GoldenQualityReport | null }) {
  const stages = [
    ["Frozen Gold", report?.datasetVersion ?? "waiting"],
    ["Quality Checker", report?.qualityReportVersion ?? "waiting"],
    ["Sanitized Summary", "allowlist"],
    ["Read-only API", "no-store"]
  ];
  return (
    <div className={styles.pipeline} aria-label="Golden 품질 조회 파이프라인">
      <strong>Pipeline</strong>
      {stages.map(([label, version], index) => (
        <span className={styles.pipelineStage} key={label}>
          {index > 0 ? <ChevronRight size={13} /> : null}
          <span>{label}</span>
          <small>{version}</small>
        </span>
      ))}
      <span className={styles.pipelineStatus}>PRIVATE REPORT · READ ONLY</span>
    </div>
  );
}

function QualityContent({
  report,
  quality,
  refreshError,
  onRetry
}: {
  report: GoldenQualityReport;
  quality: ReturnType<typeof goldenQualityState>;
  refreshError: DashboardError | null;
  onRetry: () => void;
}) {
  const groups = useMemo(
    () => buildGoldenWarningGroups(report.warnings),
    [report.warnings]
  );
  const targets = useMemo(
    () => buildGoldenWarningTargetRows(report.warnings),
    [report.warnings]
  );

  return (
    <div className={styles.content}>
      <section className={styles.pageHeading}>
        <div>
          <p>GOLDEN DATASET / QUALITY REPORT</p>
          <h1>자동 품질 검사 결과</h1>
          <span>{quality.description}</span>
        </div>
        <StatusBadge label={quality.label} tone={quality.tone} large />
      </section>

      {refreshError ? (
        <div className={styles.inlineError} role="alert">
          <AlertTriangle size={16} />
          <span>
            최신 보고서를 불러오지 못했습니다. 기존 결과를 표시합니다.
          </span>
          <button type="button" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : null}

      <section className={styles.metadataGrid} aria-label="보고서 메타데이터">
        <MetadataCard
          icon={<Database size={17} />}
          label="DATASET VERSION"
          value={report.datasetVersion ?? "Unavailable"}
        />
        <MetadataCard
          icon={<ShieldCheck size={17} />}
          label="CHECKER VERSION"
          value={report.qualityReportVersion}
        />
        <MetadataCard
          icon={<Clock3 size={17} />}
          label="LAST CHECKED"
          value={formatGoldenQualityTimestamp(report.generatedAt)}
        />
        <MetadataCard
          icon={<Hash size={17} />}
          label="GOLD SNAPSHOT SHA-256"
          value={report.goldSnapshotSha256 ?? "Unavailable"}
          hash
        />
      </section>

      <section className={styles.metricsGrid} aria-label="품질 이슈 집계">
        <MetricCard
          icon={<CircleX size={19} />}
          label="STRUCTURAL ERRORS"
          value={report.issueCounts.error}
          tone="error"
          description="베이스라인 실행을 차단하는 오류"
        />
        <MetricCard
          icon={<AlertTriangle size={19} />}
          label="REVIEW WARNINGS"
          value={report.issueCounts.warning}
          tone="warning"
          description="사람 검수가 필요한 경고"
        />
        <MetricCard
          icon={<FileWarning size={19} />}
          label="AFFECTED TARGETS"
          value={targets.length}
          tone="neutral"
          description="중복을 제거한 세션·프롬프트"
        />
      </section>

      <section className={styles.reportGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <span>WARNING CLASSIFICATION</span>
              <h2>경고 코드별 분류</h2>
            </div>
            <i>{groups.length} TYPES</i>
          </header>
          {groups.length ? (
            <div className={styles.warningGroups}>
              {groups.map((group) => (
                <div className={styles.warningGroup} key={group.code}>
                  <span className={styles.warningIcon}>
                    <AlertTriangle size={15} />
                  </span>
                  <div>
                    <strong>{group.label}</strong>
                    <code>{group.code}</code>
                    <p>{group.description}</p>
                  </div>
                  <span className={styles.warningCount}>{group.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <PassState />
          )}
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <span>REVIEW TARGETS</span>
              <h2>대상 세션·프롬프트</h2>
            </div>
            <i>{targets.length} TARGETS</i>
          </header>
          {targets.length ? (
            <div className={styles.targetTable}>
              <div className={styles.targetTableHead} aria-hidden="true">
                <span>Target</span>
                <span>Type</span>
                <span>Warning</span>
                <span>State</span>
              </div>
              {targets.map((target) => (
                <div className={styles.targetRow} key={target.key}>
                  <strong>{target.targetId ?? "DATASET"}</strong>
                  <span
                    className={styles.targetKind}
                    data-kind={target.targetKind}
                  >
                    {target.targetKind.toUpperCase()}
                  </span>
                  <span className={styles.targetWarning}>
                    <em>{target.label}</em>
                    <code>{target.code}</code>
                  </span>
                  <span className={styles.reviewState}>
                    REVIEW
                    {target.occurrences > 1 ? ` ×${target.occurrences}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <PassState />
          )}
        </article>
      </section>
    </div>
  );
}

function MetadataCard({
  icon,
  label,
  value,
  hash = false
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hash?: boolean;
}) {
  return (
    <article className={styles.metadataCard}>
      <span className={styles.metadataIcon}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong className={hash ? styles.hashValue : ""}>{value}</strong>
      </div>
    </article>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  description
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "error" | "warning" | "neutral";
  description: string;
}) {
  return (
    <article className={styles.metricCard} data-tone={tone}>
      <span className={styles.metricIcon}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{description}</p>
      </div>
    </article>
  );
}

function StatusBadge({
  label,
  tone,
  large = false
}: {
  label: string;
  tone: "error" | "warning" | "pass" | "neutral";
  large?: boolean;
}) {
  return (
    <span
      className={`${styles.statusBadge} ${large ? styles.largeBadge : ""}`}
      data-tone={tone}
    >
      <span /> {label}
    </span>
  );
}

function PassState() {
  return (
    <div className={styles.passState}>
      <CheckCircle2 size={24} />
      <strong>검수할 경고가 없습니다</strong>
      <span>현재 보고서의 자동 품질 검사를 통과했습니다.</span>
    </div>
  );
}

function LoadingState() {
  return (
    <section className={styles.statePanel} aria-live="polite">
      <LoaderCircle size={25} className={styles.spinning} />
      <p>GOLDEN DATASET QUALITY</p>
      <h1>최신 품질 보고서를 불러오는 중입니다</h1>
      <span>비공개 보고서를 검증하고 안전한 요약만 준비하고 있습니다.</span>
    </section>
  );
}

function ErrorState({
  error,
  onRetry
}: {
  error: DashboardError | null;
  onRetry: () => void;
}) {
  const missing = error?.status === 404;
  return (
    <section className={styles.statePanel} data-tone="error" role="alert">
      <CircleX size={25} />
      <p>{missing ? "REPORT NOT FOUND" : "REPORT UNAVAILABLE"}</p>
      <h1>
        {missing
          ? "Golden 품질 보고서가 아직 없습니다"
          : "Golden 품질 보고서를 읽지 못했습니다"}
      </h1>
      <span>
        {missing
          ? "npm run golden:validate를 실행해 최신 보고서를 생성하세요."
          : (error?.message ?? "보고서를 다시 생성한 뒤 재시도하세요.")}
      </span>
      <code>{error?.code ?? "GOLDEN_QUALITY_REPORT_READ_FAILED"}</code>
      <button type="button" onClick={onRetry}>
        <RefreshCw size={15} /> 다시 불러오기
      </button>
    </section>
  );
}

function dashboardError(status: number, value: unknown): DashboardError {
  if (value && typeof value === "object") {
    const error = (value as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      return {
        status,
        code: typeof code === "string" ? code : "GOLDEN_QUALITY_REQUEST_FAILED",
        message:
          typeof message === "string"
            ? message
            : "Golden 품질 보고서를 불러오지 못했습니다."
      };
    }
  }
  return {
    status,
    code: "GOLDEN_QUALITY_REQUEST_FAILED",
    message: "Golden 품질 보고서를 불러오지 못했습니다."
  };
}

function normalizeDashboardError(error: unknown): DashboardError {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return error as DashboardError;
  }
  return {
    status: 0,
    code: "GOLDEN_QUALITY_NETWORK_ERROR",
    message: "Golden 품질 API에 연결하지 못했습니다."
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

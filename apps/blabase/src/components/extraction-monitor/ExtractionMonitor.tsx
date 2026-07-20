"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  ExternalLink,
  Eye,
  FileSearch,
  Home,
  LoaderCircle,
  RotateCw,
  Search,
  ShieldCheck,
  Table2
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";

import type {
  ConversationSource,
  ConversationStats,
  ImportWarning
} from "@/core/types/conversation";
import type {
  AnalysisMessagesPayload,
  AnalysisMonitorPayload,
  AnalysisResultPayload
} from "@/core/transport/analysisMonitorPayload";
import type {
  EvidenceMatch,
  HybridExtractionResult,
  SemanticItem,
  SemanticItemType,
  ShadowLlmSegmentResult
} from "@/core/types/semantic";
import type { MockStructureResult } from "@/core/types/structures";

import styles from "./ExtractionMonitor.module.css";
import {
  cacheAnalysisMonitorPayload,
  readAnalysisMonitorPayload
} from "./analysisSessionCache";
import { ThreadStructure } from "./ThreadStructure";
import {
  buildComparisonRows,
  buildMonitorTurns,
  buildParsingQaSummary,
  buildReviewRows,
  countSemanticTypes,
  SEMANTIC_TYPE_ORDER,
  turnIdForMessageIndex,
  type ComparisonRow,
  type MonitorMessage,
  type MonitorReviewRow,
  type MonitorTurn,
  type MonitorVerificationStatus
} from "./monitorModel";

type MonitorTab = "structure" | "turns" | "review" | "diagnostics";
type ResultFilter = "All" | MonitorVerificationStatus;

type ResultResponse = AnalysisResultPayload;
type MessagesResponse = AnalysisMessagesPayload;
type MonitorData = AnalysisMonitorPayload;

type GoldenSheetSyncResponse = {
  status?: "created" | "duplicate";
  sessionId?: string;
  messageCount?: number;
  promptCount?: number;
  spreadsheetUrl?: string;
  error?: { code?: string; message?: string };
};

const TYPE_LABELS: Record<SemanticItemType, string> = {
  intent: "Intent",
  topic: "Topic",
  decision: "Decision",
  open_question: "Open Question",
  action: "Action",
  preference: "Preference",
  content_constraint: "Content Constraint",
  problem_signal: "Problem Signal",
  satisfaction: "Satisfaction",
  change_event: "Change Event",
  entity: "Entity",
  relation: "Relation"
};

const STATUS_HELP: Record<ResultFilter, string> = {
  All: "모든 추출 항목",
  Verified: "근거 검증을 통과한 항목",
  Review: "사람의 검토가 필요한 항목",
  Rejected: "근거가 부족해 제외된 항목"
};

export function ExtractionMonitor({
  analysisId,
  initialTab,
  initialTurnId
}: {
  analysisId: string;
  initialTab?: string;
  initialTurnId?: number;
}) {
  const router = useRouter();
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MonitorTab>(
    isMonitorTab(initialTab) ? initialTab : "turns"
  );
  const [selectedTurnId, setSelectedTurnId] = useState(
    initialTurnId && initialTurnId > 0 ? initialTurnId : 1
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [signalsOpen, setSignalsOpen] = useState(true);
  const [internalOpen, setInternalOpen] = useState(false);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("All");
  const [query, setQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(42);
  const [auditExporting, setAuditExporting] = useState(false);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [sheetNotice, setSheetNotice] = useState<{
    message: string;
    spreadsheetUrl: string;
  } | null>(null);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const cached = readAnalysisMonitorPayload(analysisId);
        if (cached) {
          if (!cancelled) setData(cached);
          return;
        }

        const [resultResponse, messagesResponse] = await Promise.all([
          fetch(`/api/analyses/${analysisId}/result`),
          fetch(`/api/analyses/${analysisId}/messages`)
        ]);
        const [resultPayload, messagesPayload] = (await Promise.all([
          resultResponse.json(),
          messagesResponse.json()
        ])) as [ResultResponse, MessagesResponse];

        if (!resultResponse.ok || resultPayload.status === "failed") {
          throw new Error(
            resultPayload.error?.message ?? "분석 결과를 불러오지 못했습니다."
          );
        }
        if (!messagesResponse.ok || messagesPayload.status === "failed") {
          throw new Error(
            messagesPayload.error?.message ?? "대화 원문을 불러오지 못했습니다."
          );
        }

        if (!cancelled) {
          setData({ result: resultPayload, messages: messagesPayload });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "분석 결과를 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const messages = useMemo(
    () => data?.messages.messages ?? [],
    [data?.messages.messages]
  );
  const turns = useMemo(() => buildMonitorTurns(messages), [messages]);
  const sprint5 = data?.result.sprint5 ?? null;
  const selectedTurn =
    turns.find((turn) => turn.id === selectedTurnId) ?? turns[0] ?? null;
  const comparisonRows = useMemo(
    () =>
      selectedTurn && sprint5 ? buildComparisonRows(selectedTurn, sprint5) : [],
    [selectedTurn, sprint5]
  );
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return comparisonRows.filter((row) => {
      if (resultFilter !== "All" && row.verificationStatus !== resultFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      const searchable = [
        TYPE_LABELS[row.type],
        row.ruleItem?.label,
        row.ruleItem?.description,
        row.llmItem?.label,
        row.llmItem?.description
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [comparisonRows, query, resultFilter]);
  const selectedRow =
    visibleRows.find((row) => row.id === selectedRowId) ??
    visibleRows[0] ??
    comparisonRows[0] ??
    null;
  const reviewRows = useMemo(
    () => (sprint5 ? buildReviewRows(turns, sprint5) : []),
    [sprint5, turns]
  );

  useEffect(() => {
    if (turns.length > 0 && !turns.some((turn) => turn.id === selectedTurnId)) {
      setSelectedTurnId(turns[0]!.id);
    }
  }, [selectedTurnId, turns]);

  useEffect(() => {
    if (
      comparisonRows.length > 0 &&
      !comparisonRows.some((row) => row.id === selectedRowId)
    ) {
      setSelectedRowId(comparisonRows[0]!.id);
    }
  }, [comparisonRows, selectedRowId]);

  function startResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const move = (moveEvent: MouseEvent) => {
      setLeftWidth(
        Math.min(
          58,
          Math.max(34, (moveEvent.clientX / window.innerWidth) * 100)
        )
      );
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }

  async function downloadGptAudit() {
    setAuditExporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/gpt-audit`);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `blabase-gpt-audit-${analysisId}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("GPT 검수 파일을 만들지 못했습니다.");
    } finally {
      setAuditExporting(false);
    }
  }

  async function rerunAnalysis() {
    const shareUrl = data?.messages.conversation?.source?.originalUrl;
    if (!shareUrl) {
      setError("다시 분석할 원본 공유 링크가 없습니다.");
      return;
    }

    setRerunning(true);
    setError(null);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareUrl })
      });
      const payload = (await response.json()) as {
        analysisId?: string;
        monitorData?: AnalysisMonitorPayload | null;
        error?: { message?: string };
      };
      if (!response.ok || !payload.analysisId) {
        throw new Error(payload.error?.message ?? "다시 분석하지 못했습니다.");
      }
      if (payload.monitorData) {
        cacheAnalysisMonitorPayload(payload.analysisId, payload.monitorData);
      }
      router.push(
        `/analyses/${encodeURIComponent(payload.analysisId)}?tab=turns`
      );
    } catch (rerunError) {
      setError(
        rerunError instanceof Error
          ? rerunError.message
          : "다시 분석하지 못했습니다."
      );
      setRerunning(false);
    }
  }

  async function syncGoldenSheet() {
    setSheetSyncing(true);
    setSheetNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/golden-sheet`, {
        method: "POST"
      });
      const payload = (await response.json()) as GoldenSheetSyncResponse;
      if (
        !response.ok ||
        !payload.status ||
        !payload.sessionId ||
        !payload.spreadsheetUrl
      ) {
        throw new Error(
          payload.error?.message ??
            "Golden Dataset Sheet에 저장하지 못했습니다."
        );
      }

      setSheetNotice({
        message:
          payload.status === "duplicate"
            ? `${payload.sessionId}에 이미 등록된 공유 링크입니다.`
            : `${payload.sessionId} 생성 완료 · 메시지 ${payload.messageCount ?? 0}개 · 프롬프트 ${payload.promptCount ?? 0}개`,
        spreadsheetUrl: payload.spreadsheetUrl
      });
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Golden Dataset Sheet에 저장하지 못했습니다."
      );
    } finally {
      setSheetSyncing(false);
    }
  }

  function openReviewItem(row: MonitorReviewRow) {
    if (row.turnId) setSelectedTurnId(row.turnId);
    setSelectedRowId(
      comparisonRowIdForItem(row.itemId, row.turnId, turns, sprint5)
    );
    setTab("turns");
  }

  function openEvidenceMessage(messageIndex: number) {
    const targetTurnId = turnIdForMessageIndex(turns, messageIndex);
    const targetMessage = messages.find(
      (message) => message.index === messageIndex
    );
    if (targetTurnId) setSelectedTurnId(targetTurnId);
    if (targetMessage?.metadata.messageCategory === "context_signal") {
      setSignalsOpen(true);
    }
    if (targetMessage?.metadata.messageCategory === "excluded_internal") {
      setInternalOpen(true);
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(`message-${messageIndex}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      });
    });
  }

  if (loading) {
    return <MonitorLoading />;
  }

  if (!data || (error && !data)) {
    return <MonitorError message={error ?? "분석 결과가 없습니다."} />;
  }

  const conversation = data.messages.conversation;
  const conversationTitle =
    conversation?.title ?? data.result.result?.overview.title ?? null;

  return (
    <main className={styles.monitor}>
      <MonitorHeader
        analysisId={analysisId}
        title={conversationTitle}
        source={conversation?.source}
        tab={tab}
        onTabChange={setTab}
        onRerun={() => void rerunAnalysis()}
        onAudit={() => void downloadGptAudit()}
        onSheetSync={() => void syncGoldenSheet()}
        rerunning={rerunning}
        auditExporting={auditExporting}
        sheetSyncing={sheetSyncing}
      />
      <PipelineStrip source={conversation?.source} sprint5={sprint5} />
      {tab === "turns" ? (
        <ParsingQaStrip
          stats={conversation?.stats}
          warnings={conversation?.warnings ?? []}
          messages={messages}
          turnCount={turns.length}
        />
      ) : null}
      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {sheetNotice ? (
        <div className={styles.inlineSuccess} role="status">
          <span>{sheetNotice.message}</span>
          <a href={sheetNotice.spreadsheetUrl} target="_blank" rel="noreferrer">
            Sheet에서 확인
          </a>
        </div>
      ) : null}

      {tab === "structure" ? (
        <ThreadStructure
          analysisId={analysisId}
          title={conversationTitle}
          turns={turns}
          sprint5={sprint5}
          onOpenTurn={(turnId) => {
            setSelectedTurnId(turnId);
            setSelectedRowId(null);
            setTab("turns");
          }}
        />
      ) : null}

      {tab === "turns" ? (
        <section className={styles.inspector}>
          <ConversationPane
            width={leftWidth}
            turns={turns}
            selectedTurn={selectedTurn}
            sprint5={sprint5}
            messages={messages}
            selectedRow={selectedRow}
            signalsOpen={signalsOpen}
            internalOpen={internalOpen}
            onSignalsToggle={() => setSignalsOpen((value) => !value)}
            onInternalToggle={() => setInternalOpen((value) => !value)}
            onTurnSelect={(turnId) => {
              setSelectedTurnId(turnId);
              setSelectedRowId(null);
            }}
          />
          <div
            role="separator"
            aria-label="대화와 추출 결과 영역 너비 조절"
            aria-orientation="vertical"
            tabIndex={0}
            className={styles.resizeHandle}
            onMouseDown={startResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                setLeftWidth((value) => Math.max(34, value - 2));
              }
              if (event.key === "ArrowRight") {
                setLeftWidth((value) => Math.min(58, value + 2));
              }
            }}
          >
            <span />
          </div>
          <ComparisonPane
            turn={selectedTurn}
            rows={visibleRows}
            allRows={comparisonRows}
            selectedRow={selectedRow}
            filter={resultFilter}
            query={query}
            messages={messages}
            sprint5={sprint5}
            onFilterChange={setResultFilter}
            onQueryChange={setQuery}
            onRowSelect={(row) => setSelectedRowId(row.id)}
            onOpenEvidence={openEvidenceMessage}
          />
        </section>
      ) : null}

      {tab === "review" ? (
        <ReviewQueue rows={reviewRows} onOpenItem={openReviewItem} />
      ) : null}

      {tab === "diagnostics" ? (
        <RunDiagnostics
          analysisId={analysisId}
          stats={conversation?.stats}
          turns={turns}
          sprint5={sprint5}
        />
      ) : null}
    </main>
  );
}

function MonitorHeader({
  analysisId,
  title,
  source,
  tab,
  onTabChange,
  onRerun,
  onAudit,
  onSheetSync,
  rerunning,
  auditExporting,
  sheetSyncing
}: {
  analysisId: string;
  title: string | null;
  source?: ConversationSource;
  tab: MonitorTab;
  onTabChange: (tab: MonitorTab) => void;
  onRerun: () => void;
  onAudit: () => void;
  onSheetSync: () => void;
  rerunning: boolean;
  auditExporting: boolean;
  sheetSyncing: boolean;
}) {
  const tabs: Array<{ id: MonitorTab; label: string }> = [
    { id: "structure", label: "Structure Map" },
    { id: "turns", label: "Turn Inspector" },
    { id: "review", label: "Review Queue" },
    { id: "diagnostics", label: "Run Diagnostics" }
  ];

  return (
    <header className={styles.header}>
      <div className={styles.headerMain}>
        <Link href="/" className={styles.brand} title="새 링크 분석">
          <span className={styles.logo}>b</span>
          <span>
            <strong>blabase Extraction Monitor</strong>
            <small>CHATGPT SHARE ANALYSIS</small>
          </span>
        </Link>
        <span className={styles.headerDivider} />
        <div className={styles.analysisIdentity}>
          <strong>{title || "Untitled ChatGPT conversation"}</strong>
          <span>{analysisId}</span>
        </div>
        {source?.originalUrl ? (
          <a
            href={source.originalUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.sourceLink}
          >
            <ExternalLink size={13} /> 원본 공유 링크
          </a>
        ) : null}
        <Badge tone="verified">
          <span className={styles.statusDot} /> ANALYZED
        </Badge>
        <IconButton
          label={rerunning ? "다시 분석 중" : "같은 원본 링크 다시 분석"}
          onClick={onRerun}
          disabled={rerunning}
        >
          <RotateCw size={16} className={rerunning ? styles.spinning : ""} />
        </IconButton>
        <IconButton
          label={
            sheetSyncing
              ? "Golden Dataset Sheet 동기화 중"
              : "Golden Dataset Sheet에 세션 추가"
          }
          onClick={onSheetSync}
          disabled={sheetSyncing}
        >
          <Table2 size={16} className={sheetSyncing ? styles.spinning : ""} />
        </IconButton>
        <Link
          href="/golden/quality"
          className={styles.iconButton}
          aria-label="Golden Dataset 품질 화면"
          title="Golden Dataset 품질 화면"
        >
          <ShieldCheck size={16} />
        </Link>
        <IconButton
          label={
            auditExporting ? "GPT 검수 파일 생성 중" : "GPT 검수 파일 내보내기"
          }
          onClick={onAudit}
          disabled={auditExporting}
        >
          <ArrowDownToLine size={16} />
        </IconButton>
      </div>
      <nav className={styles.tabs} aria-label="모니터링 화면">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? styles.activeTab : ""}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function PipelineStrip({
  source,
  sprint5
}: {
  source?: ConversationSource;
  sprint5: HybridExtractionResult | null;
}) {
  const stages = [
    {
      label: "Share Parser",
      version: source?.adapterVersion ?? "unknown",
      title: "공유 HTML을 Canonical Conversation으로 변환하는 Adapter"
    },
    {
      label: "Clean Conversation",
      version: "canonical",
      title: "사용자 메시지와 assistant 최종 답변만 남긴 분석 입력"
    },
    {
      label: "Rule Extractor",
      version: sprint5?.ruleResult.extractorVersion ?? "unavailable",
      title: "Sprint 3/4 하드룰 기반 의미 추출"
    },
    {
      label: "LLM Shadow",
      version: sprint5?.llmResult.extractorVersion ?? "disabled",
      title: "Sprint 5A LLM 의미 후보 추출"
    },
    {
      label: "Evidence Verifier",
      version: sprint5?.evidenceVerifier.version ?? "unavailable",
      title: "Sprint 5B 원문 근거 검증"
    }
  ];

  return (
    <div className={styles.pipeline}>
      <strong>Pipeline</strong>
      {stages.map((stage, index) => (
        <span className={styles.pipelineStage} key={stage.label}>
          {index > 0 ? <ChevronRight size={13} /> : null}
          <span title={stage.title}>{stage.label}</span>
          <small>{stage.version}</small>
        </span>
      ))}
      <span className={styles.pipelineStage}>
        <ChevronRight size={13} />
        <span className={styles.muted}>Memory Candidate</span>
        <Badge tone="muted">NOT IMPLEMENTED</Badge>
      </span>
      <span className={styles.pipelineRunStatus}>
        {sprint5?.llmResult.provider ?? "no provider"} ·{" "}
        {sprint5?.llmResult.status ?? "no shadow run"}
      </span>
    </div>
  );
}

function ParsingQaStrip({
  stats,
  warnings,
  messages,
  turnCount
}: {
  stats?: ConversationStats;
  warnings: ImportWarning[];
  messages: MonitorMessage[];
  turnCount: number;
}) {
  const summary = buildParsingQaSummary({
    messages,
    stats,
    warnings,
    turnCount
  });
  const metrics = [
    {
      label: "Canonical",
      value: summary.counts.total,
      title: "공유 payload에서 복원·정규화 후 유지된 전체 메시지"
    },
    {
      label: "User",
      value: summary.counts.user,
      title: "복원된 사용자 메시지"
    },
    {
      label: "Assistant",
      value: summary.counts.assistant,
      title: "복원된 assistant 메시지"
    },
    {
      label: "Clean",
      value: summary.counts.clean,
      title: "Rule/LLM 의미 분석에 사용되는 사용자-visible 메시지"
    },
    {
      label: "Context",
      value: summary.counts.context,
      title: "검색·도구 사용처럼 답변 맥락을 설명하는 보조 신호"
    },
    {
      label: "Internal",
      value: summary.counts.internal,
      title: "의미 분석에서 제외된 내부 메시지"
    },
    {
      label: "Unsupported",
      value: summary.counts.unsupported,
      title: "현재 파서가 완전히 표현하지 못한 content가 포함된 메시지"
    },
    {
      label: "Turns",
      value: summary.counts.turns,
      title: "사용자 메시지를 기준으로 구성된 대화 턴"
    }
  ];
  const statusLabel =
    summary.status === "ready"
      ? "READY"
      : summary.status === "error"
        ? `${summary.warningCounts.error} ERROR`
        : "CHECK";
  const statusTone =
    summary.status === "ready"
      ? "verified"
      : summary.status === "error"
        ? "rejected"
        : "review";

  return (
    <section
      className={styles.parsingQa}
      data-status={summary.status}
      aria-label="파싱 QA 요약"
    >
      <header className={styles.parsingQaHeader}>
        <div>
          {summary.status === "ready" ? (
            <Check size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          <strong>Parsing QA</strong>
          <span>복원된 메시지 분류와 파서 경고를 먼저 확인하세요.</span>
        </div>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </header>
      <div className={styles.parsingQaMetrics}>
        {metrics.map((metric) => (
          <article key={metric.label} title={metric.title}>
            <span>{metric.label}</span>
            <strong>{formatNumber(metric.value)}</strong>
          </article>
        ))}
      </div>
      {warnings.length > 0 || summary.countMismatch ? (
        <details
          className={styles.parsingQaWarnings}
          open={summary.status !== "ready"}
        >
          <summary>
            파싱 확인 항목 {warnings.length + Number(summary.countMismatch)}개
          </summary>
          {summary.countMismatch ? (
            <p>
              <strong>COUNT_MISMATCH</strong>
              API 통계와 반환된 메시지 분류 개수가 일치하지 않습니다.
            </p>
          ) : null}
          {warnings.map((warning, index) => (
            <p
              key={`${warning.code}-${index}`}
              data-severity={warning.severity}
            >
              <strong>{warning.code}</strong>
              {warning.message}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}

function ConversationPane({
  width,
  turns,
  selectedTurn,
  sprint5,
  messages,
  selectedRow,
  signalsOpen,
  internalOpen,
  onSignalsToggle,
  onInternalToggle,
  onTurnSelect
}: {
  width: number;
  turns: MonitorTurn[];
  selectedTurn: MonitorTurn | null;
  sprint5: HybridExtractionResult | null;
  messages: MonitorMessage[];
  selectedRow: ComparisonRow | null;
  signalsOpen: boolean;
  internalOpen: boolean;
  onSignalsToggle: () => void;
  onInternalToggle: () => void;
  onTurnSelect: (turnId: number) => void;
}) {
  const itemCountByTurn = useMemo(
    () =>
      new Map(
        turns.map((turn) => [
          turn.id,
          sprint5 ? buildComparisonRows(turn, sprint5).length : 0
        ])
      ),
    [sprint5, turns]
  );

  return (
    <aside className={styles.conversationPane} style={{ width: `${width}%` }}>
      <div className={styles.paneHeader}>
        <div>
          <strong>Conversation Turns</strong>
          <span>
            {turns.length} TURNS / {messages.length} MSGS
          </span>
        </div>
      </div>
      <div className={styles.conversationBody}>
        <nav className={styles.turnList} aria-label="대화 턴 목록">
          <span className={styles.listEyebrow}>TURN LIST</span>
          {turns.map((turn) => (
            <button
              key={turn.id}
              type="button"
              className={turn.id === selectedTurn?.id ? styles.activeTurn : ""}
              onClick={() => onTurnSelect(turn.id)}
              title={clip(turn.user.text, 120)}
            >
              <span>
                <strong>Turn {turn.id}</strong>
                <em>{itemCountByTurn.get(turn.id) ?? 0}</em>
              </span>
              <small>
                #{turn.startMessageIndex} → #{turn.endMessageIndex} ·{" "}
                {formatKstTimestamp(turn.user.createdAt, true)}
              </small>
            </button>
          ))}
        </nav>
        <div className={styles.turnDetail}>
          {selectedTurn ? (
            <>
              <div className={styles.turnHeading}>
                <div>
                  <h1>Turn {selectedTurn.id}</h1>
                  <p>
                    #{selectedTurn.startMessageIndex} → #
                    {selectedTurn.endMessageIndex} · clean conversation ·{" "}
                    {formatKstTimestamp(selectedTurn.user.createdAt)}
                  </p>
                </div>
                <Badge tone="neutral">
                  {selectedTurn.scopeMessageIndexes.length} CLEAN MSGS
                </Badge>
              </div>
              <article className={styles.messageGroup}>
                <MessageBlock
                  message={selectedTurn.user}
                  roleLabel="USER"
                  tone="rule"
                  selectedRow={selectedRow}
                />
                <ContextSignals
                  signals={selectedTurn.contextSignals}
                  open={signalsOpen}
                  onToggle={onSignalsToggle}
                />
                {selectedTurn.intermediateCleanMessages.map((message) => (
                  <MessageBlock
                    key={message.id}
                    message={message}
                    roleLabel="ASSISTANT UPDATE"
                    tone="neutral"
                    selectedRow={selectedRow}
                    compact
                  />
                ))}
                {selectedTurn.assistant ? (
                  <MessageBlock
                    message={selectedTurn.assistant}
                    roleLabel="ASSISTANT"
                    tone="llm"
                    selectedRow={selectedRow}
                  />
                ) : (
                  <div className={styles.noAssistant}>
                    이 턴에는 assistant 최종 답변이 없습니다.
                  </div>
                )}
              </article>
              <ExcludedInternal
                messages={selectedTurn.excludedInternal}
                open={internalOpen}
                onToggle={onInternalToggle}
              />
            </>
          ) : (
            <EmptyState title="표시할 Clean Conversation 턴이 없습니다." />
          )}
        </div>
      </div>
    </aside>
  );
}

function MessageBlock({
  message,
  roleLabel,
  tone,
  selectedRow,
  compact = false
}: {
  message: MonitorMessage;
  roleLabel: string;
  tone: "rule" | "llm" | "neutral";
  selectedRow: ComparisonRow | null;
  compact?: boolean;
}) {
  return (
    <section id={`message-${message.index}`} className={styles.messageBlock}>
      <header data-tone={tone}>
        <Badge
          tone={tone === "rule" ? "rule" : tone === "llm" ? "llm" : "neutral"}
        >
          {roleLabel}
        </Badge>
        <span>
          message #{message.index} ·{" "}
          {message.metadata.assistantMessageType ??
            message.metadata.contentType ??
            "plain_text"}{" "}
          · {formatKstTimestamp(message.createdAt)}
        </span>
      </header>
      <div className={compact ? styles.compactMessageText : styles.messageText}>
        <HighlightedMessage message={message} row={selectedRow} />
      </div>
      <footer>
        {message.text.length.toLocaleString()} chars · {message.blocks.length}{" "}
        block
        {message.blocks.length === 1 ? "" : "s"}
      </footer>
    </section>
  );
}

function ContextSignals({
  signals,
  open,
  onToggle
}: {
  signals: MonitorMessage[];
  open: boolean;
  onToggle: () => void;
}) {
  const counts = signals.reduce<Record<string, number>>((result, signal) => {
    const key = signal.metadata.contextSignalType ?? "other";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});

  return (
    <section className={styles.contextSignals}>
      <button type="button" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong title="assistant가 답변을 만들 때 사용한 검색·도구 작업 흔적">
          Context Signals
        </strong>
        <span>{signals.length} SIGNALS</span>
      </button>
      {open ? (
        <div className={styles.signalList}>
          {signals.length > 0 ? (
            <>
              <p>
                {Object.entries(counts)
                  .map(([key, count]) => `${key} ${count}`)
                  .join(" · ")}
              </p>
              {signals.map((signal) => (
                <details id={`message-${signal.index}`} key={signal.id}>
                  <summary>
                    #{signal.index} ·{" "}
                    {signal.metadata.contextSignalType ?? "other"}
                  </summary>
                  <pre>{signal.text}</pre>
                </details>
              ))}
            </>
          ) : (
            <p>이 턴에서 수집된 Context Signal이 없습니다.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ExcludedInternal({
  messages,
  open,
  onToggle
}: {
  messages: MonitorMessage[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className={styles.internalBlock}>
      <div>
        <Eye size={15} />
        <span>
          Excluded/Internal · {messages.length} message
          {messages.length === 1 ? "" : "s"}
        </span>
      </div>
      <button type="button" onClick={onToggle} disabled={messages.length === 0}>
        {open ? "숨기기" : "표시"}
      </button>
      {open && messages.length > 0 ? (
        <div className={styles.internalList}>
          {messages.map((message) => (
            <details id={`message-${message.index}`} key={message.id}>
              <summary>
                #{message.index} ·{" "}
                {message.metadata.internalContentType ?? "internal"}
              </summary>
              <pre>{message.text}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ComparisonPane({
  turn,
  rows,
  allRows,
  selectedRow,
  filter,
  query,
  messages,
  sprint5,
  onFilterChange,
  onQueryChange,
  onRowSelect,
  onOpenEvidence
}: {
  turn: MonitorTurn | null;
  rows: ComparisonRow[];
  allRows: ComparisonRow[];
  selectedRow: ComparisonRow | null;
  filter: ResultFilter;
  query: string;
  messages: MonitorMessage[];
  sprint5: HybridExtractionResult | null;
  onFilterChange: (filter: ResultFilter) => void;
  onQueryChange: (query: string) => void;
  onRowSelect: (row: ComparisonRow) => void;
  onOpenEvidence: (messageIndex: number) => void;
}) {
  return (
    <section className={styles.comparisonPane}>
      <header className={styles.comparisonHeader}>
        <div className={styles.comparisonTitleRow}>
          <div>
            <h2>
              Extraction Comparison <span>/ Turn {turn?.id ?? "-"}</span>
            </h2>
            <p>
              Rule 결과와 LLM 해석을 같은 의미 타입과 근거 기준으로 정렬합니다.
            </p>
          </div>
          <div className={styles.resultTools}>
            <label className={styles.searchBox}>
              <Search size={14} />
              <span className={styles.srOnly}>추출 항목 검색</span>
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="항목 검색"
              />
            </label>
            <div className={styles.segmentedControl}>
              {(
                ["All", "Verified", "Review", "Rejected"] as ResultFilter[]
              ).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={filter === status ? styles.activeSegment : ""}
                  onClick={() => onFilterChange(status)}
                  title={STATUS_HELP[status]}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.stageLegend}>
          <Badge tone="rule">RULE · SPRINT 3/4</Badge>
          <Badge tone="llm">LLM INTERPRETATION · SPRINT 5A</Badge>
          <Badge tone="evidence">EVIDENCE · SPRINT 5B</Badge>
          <span>{allRows.length} extracted items</span>
        </div>
      </header>
      <div className={styles.comparisonScroll}>
        {sprint5 ? (
          <>
            <div className={styles.comparisonTable}>
              <div className={styles.tableHead}>
                <span title="정규화된 의미 범주">SEMANTIC TYPE</span>
                <span>HARD RULE</span>
                <span>LLM INTERPRETATION</span>
                <span>VERDICT</span>
              </div>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <ComparisonTableRow
                    key={row.id}
                    row={row}
                    selected={row.id === selectedRow?.id}
                    onSelect={() => onRowSelect(row)}
                  />
                ))
              ) : (
                <EmptyState title="현재 필터에 해당하는 추출 항목이 없습니다." />
              )}
            </div>
            <EvidenceTrace
              row={selectedRow}
              messages={messages}
              onOpenEvidence={onOpenEvidence}
            />
          </>
        ) : (
          <EmptyState title="Sprint 5 Shadow 결과가 없습니다." />
        )}
      </div>
    </section>
  );
}

function ComparisonTableRow({
  row,
  selected,
  onSelect
}: {
  row: ComparisonRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.tableRow} ${selected ? styles.selectedTableRow : ""}`}
      onClick={onSelect}
    >
      <span className={styles.semanticType} title="정규화된 의미 범주">
        {TYPE_LABELS[row.type]}
      </span>
      <SemanticCell item={row.ruleItem} source="rule" />
      <SemanticCell item={row.llmItem} source="llm" />
      <span className={styles.verdictCell}>
        <Badge tone={verdictTone(row.verdict)}>{row.verdict}</Badge>
        <Badge tone={verificationTone(row.verificationStatus)}>
          {row.verificationStatus}
        </Badge>
        <small>
          {formatPercent(row.confidence)} ·{" "}
          {formatEvidenceIndexes(row.evidenceMessageIndexes)}
        </small>
      </span>
    </button>
  );
}

function SemanticCell({
  item,
  source
}: {
  item: SemanticItem | null;
  source: "rule" | "llm";
}) {
  if (!item) {
    return (
      <span className={styles.semanticCell}>
        <strong className={styles.emptyValue}>—</strong>
        <small>후보 없음</small>
      </span>
    );
  }

  return (
    <span className={styles.semanticCell}>
      <strong>{item.label}</strong>
      <small>{item.description || "설명 없음"}</small>
      <em data-source={source}>
        {item.status ? `${item.status} · ` : ""}
        {item.category ? `${item.category} · ` : ""}
        {source === "rule" ? (item.sourceItemId ?? item.id) : item.id}
      </em>
    </span>
  );
}

function EvidenceTrace({
  row,
  messages,
  onOpenEvidence
}: {
  row: ComparisonRow | null;
  messages: MonitorMessage[];
  onOpenEvidence: (messageIndex: number) => void;
}) {
  if (!row) {
    return (
      <section className={styles.evidenceTrace}>
        <EmptyState title="항목을 선택하면 원문 근거를 확인할 수 있습니다." />
      </section>
    );
  }

  const evidence = evidenceViewForRow(row, messages);
  const issues = row.evaluatedLlmItem?.evidenceVerification.issues ?? [];
  const firstEvidenceIndex = row.evidenceMessageIndexes[0];

  function goToSource() {
    const index = evidence?.messageIndex ?? firstEvidenceIndex;
    if (!index) return;
    onOpenEvidence(index);
  }

  return (
    <section className={styles.evidenceTrace}>
      <header>
        <div>
          <FileSearch size={16} />
          <h3>Evidence Trace</h3>
          <Badge tone={verificationTone(row.verificationStatus)}>
            {row.verificationStatus.toLowerCase()}
          </Badge>
        </div>
        <button
          type="button"
          onClick={goToSource}
          disabled={!evidence && !firstEvidenceIndex}
        >
          원문으로 이동 <ArrowUpRight size={13} />
        </button>
      </header>
      {row.evidenceMessageIndexes.length > 0 ? (
        <div className={styles.evidenceIndexLinks}>
          <span>Evidence messages</span>
          {row.evidenceMessageIndexes.map((messageIndex) => (
            <button
              key={messageIndex}
              type="button"
              onClick={() => onOpenEvidence(messageIndex)}
            >
              #{messageIndex}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.evidenceGrid}>
        <div className={styles.quotePanel}>
          {evidence ? (
            <>
              <div>
                <Badge tone={evidence.role === "user" ? "rule" : "llm"}>
                  message #{evidence.messageIndex}
                </Badge>
                <span>
                  {evidence.role.toUpperCase()} · startChar{" "}
                  {evidence.startChar ?? "-"} · endChar{" "}
                  {evidence.endChar ?? "-"}
                </span>
              </div>
              <blockquote>“{evidence.quote}”</blockquote>
              {row.evaluatedLlmItem?.evidenceVerification.matches.length ? (
                <p>
                  {row.evaluatedLlmItem.evidenceVerification.matches.length}{" "}
                  evidence match
                  {row.evaluatedLlmItem.evidenceVerification.matches.length ===
                  1
                    ? ""
                    : "es"}
                </p>
              ) : null}
            </>
          ) : (
            <p>직접 표시할 수 있는 trigger phrase가 없습니다.</p>
          )}
        </div>
        <dl className={styles.evidenceMetadata}>
          <dt title="원문이 추출 판단을 지지하는 방식">grounding</dt>
          <dd>{evidence?.supportType ?? "unavailable"}</dd>
          <dt title="Evidence Verifier 판정">verification</dt>
          <dd>
            {row.evaluatedLlmItem?.evidenceVerification.status ??
              row.verificationStatus.toLowerCase()}
          </dd>
          <dt>verdict</dt>
          <dd>{row.verdict}</dd>
          <dt>reason</dt>
          <dd>
            {issues.length > 0
              ? issues.map((issue) => issue.code).join(", ")
              : "원문 직접 근거 확인"}
          </dd>
        </dl>
      </div>
    </section>
  );
}

function ReviewQueue({
  rows,
  onOpenItem
}: {
  rows: MonitorReviewRow[];
  onOpenItem: (row: MonitorReviewRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | "Review" | "Rejected">("All");
  const shown = rows.filter((row) => {
    if (status !== "All" && row.verificationStatus !== status) return false;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [
      TYPE_LABELS[row.type],
      row.label,
      row.source,
      row.issueCodes.join(" ")
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <section className={styles.fullPage}>
      <div className={styles.pageTitleRow}>
        <div>
          <p>HUMAN REVIEW REQUIRED</p>
          <h1>
            Review Queue <span>/ {rows.length} open</span>
          </h1>
        </div>
        <div className={styles.resultTools}>
          <label className={styles.searchBox}>
            <Search size={14} />
            <span className={styles.srOnly}>검토 항목 검색</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="검토 항목 검색"
            />
          </label>
          <div className={styles.segmentedControl}>
            {(["All", "Review", "Rejected"] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={status === value ? styles.activeSegment : ""}
                onClick={() => setStatus(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.reviewTable}>
        {shown.length > 0 ? (
          shown.map((row) => (
            <article key={row.id}>
              {row.verificationStatus === "Rejected" ? (
                <CircleX size={17} className={styles.rejectedIcon} />
              ) : (
                <AlertTriangle size={17} className={styles.reviewIcon} />
              )}
              <div>
                <strong>{row.label}</strong>
                <span>
                  {TYPE_LABELS[row.type]} · Turn {row.turnId ?? "-"} ·{" "}
                  {row.source} ·{" "}
                  {formatEvidenceIndexes(row.evidenceMessageIndexes)}
                </span>
                <small>{row.issueCodes.join(" · ") || "검토 사유 없음"}</small>
              </div>
              <Badge tone={verificationTone(row.verificationStatus)}>
                {row.verificationStatus.toUpperCase()}
              </Badge>
              <em>{formatPercent(row.confidence)}</em>
              <IconButton
                label="Turn Inspector에서 열기"
                onClick={() => onOpenItem(row)}
                disabled={!row.turnId}
              >
                <ArrowUpRight size={15} />
              </IconButton>
            </article>
          ))
        ) : (
          <EmptyState title="현재 조건에 해당하는 검토 항목이 없습니다." />
        )}
      </div>
    </section>
  );
}

function RunDiagnostics({
  analysisId,
  stats,
  turns,
  sprint5
}: {
  analysisId: string;
  stats?: ConversationStats;
  turns: MonitorTurn[];
  sprint5: HybridExtractionResult | null;
}) {
  if (!sprint5) {
    return (
      <section className={styles.fullPage}>
        <EmptyState title="Sprint 5 진단 데이터가 없습니다." />
      </section>
    );
  }

  const ruleCounts = countSemanticTypes(sprint5.ruleResult.items);
  const llmCounts = countSemanticTypes(sprint5.llmResult.items);
  const maxTypeCount = Math.max(
    1,
    ...SEMANTIC_TYPE_ORDER.flatMap((type) => [
      ruleCounts[type] ?? 0,
      llmCounts[type] ?? 0
    ])
  );
  const metrics: Array<{ label: string; value: string; help: string }> = [
    {
      label: "Conversation time",
      value: `${formatKstTimestamp(stats?.startedAt, true)} → ${formatKstTimestamp(stats?.endedAt, true)}`,
      help: `원본 메시지 create_time 기준 · 전체 경과 ${formatElapsedDuration(stats?.durationSeconds)}`
    },
    {
      label: "Clean messages",
      value: formatNumber(stats?.cleanConversationMessages ?? 0),
      help: "Rule/LLM 의미 분석에 사용된 사용자-visible 메시지 수"
    },
    {
      label: "Turn count",
      value: formatNumber(turns.length),
      help: "사용자 메시지와 이어지는 assistant 최종 답변 묶음 수"
    },
    {
      label: "Rule items",
      value: formatNumber(sprint5.ruleResult.items.length),
      help: "Sprint 3/4 하드룰이 추출한 의미 항목 수"
    },
    {
      label: "LLM candidates",
      value: formatNumber(sprint5.llmResult.items.length),
      help: "Sprint 5A Shadow LLM이 제안한 의미 후보 수"
    },
    {
      label: "Verified / Review / Rejected",
      value: `${sprint5.verifiedItems.length} / ${sprint5.reviewQueue.length} / ${sprint5.rejectedItems.length}`,
      help: "Sprint 5B Evidence Verifier 최종 분류"
    },
    {
      label: "Segment runs",
      value: `${sprint5.llmResult.metrics.completedRequestCount} / ${sprint5.llmResult.metrics.requestCount}`,
      help: "LLM에 분할 전송한 세그먼트 중 성공 요청 수"
    },
    {
      label: "Input / Output / Total tokens",
      value: `${formatNumber(sprint5.llmResult.metrics.usage.inputTokens)} / ${formatNumber(sprint5.llmResult.metrics.usage.outputTokens)} / ${formatNumber(sprint5.llmResult.metrics.usage.totalTokens)}`,
      help: "Provider가 보고한 Shadow LLM 토큰 사용량"
    },
    {
      label: "Provider time",
      value: formatDuration(sprint5.llmResult.metrics.providerDurationMs),
      help: "모든 LLM Provider 요청에 사용된 누적 시간"
    }
  ];

  return (
    <section className={styles.fullPage}>
      <div className={styles.pageTitleRow}>
        <div>
          <p>RUN DIAGNOSTICS · {analysisId}</p>
          <h1>Pipeline health &amp; coverage</h1>
        </div>
        <Badge tone={llmRunTone(sprint5.llmResult.status)}>
          {sprint5.llmResult.provider ?? "LLM"} · {sprint5.llmResult.status}
        </Badge>
      </div>
      <div className={styles.metricsGrid}>
        {metrics.map((metric) => (
          <article key={metric.label} title={metric.help}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
      <div className={styles.diagnosticsGrid}>
        <section className={styles.diagnosticPanel}>
          <header>
            <h2 title="Rule과 LLM이 각 의미 타입을 몇 개 추출했는지 비교">
              Semantic type coverage
            </h2>
            <span>
              <i className={styles.ruleKey} /> Rule
              <i className={styles.llmKey} /> LLM
            </span>
          </header>
          <div className={styles.coverageRows}>
            {SEMANTIC_TYPE_ORDER.map((type) => {
              const ruleCount = ruleCounts[type] ?? 0;
              const llmCount = llmCounts[type] ?? 0;
              return (
                <div key={type}>
                  <span>{TYPE_LABELS[type]}</span>
                  <div>
                    <i
                      className={styles.ruleBar}
                      style={{ width: `${(ruleCount / maxTypeCount) * 100}%` }}
                    />
                    <i
                      className={styles.llmBar}
                      style={{ width: `${(llmCount / maxTypeCount) * 100}%` }}
                    />
                  </div>
                  <em>{ruleCount}</em>
                  <em>{llmCount}</em>
                </div>
              );
            })}
          </div>
        </section>
        <section className={styles.diagnosticPanel}>
          <header>
            <h2 title="대화를 나눠 LLM에 전달한 각 요청의 실행 결과">
              Segment Runs
            </h2>
            <span>
              {formatPercent(
                sprint5.llmResult.coverage.evidenceMessageCoverageRatio
              )}{" "}
              evidence coverage
            </span>
          </header>
          <div className={styles.segmentRuns}>
            {sprint5.llmResult.segments.length > 0 ? (
              sprint5.llmResult.segments.map((segment) => (
                <SegmentRun key={segment.id} segment={segment} />
              ))
            ) : (
              <EmptyState title="실행된 LLM 세그먼트가 없습니다." />
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function SegmentRun({ segment }: { segment: ShadowLlmSegmentResult }) {
  return (
    <article>
      <span>
        <strong>{segment.id}</strong>
        <small>{segment.label}</small>
      </span>
      <span>
        messages #{segment.startMessageIndex}–#{segment.endMessageIndex}
      </span>
      <span data-status={segment.status}>
        {segment.status === "completed" ? (
          <Check size={14} />
        ) : (
          <CircleX size={14} />
        )}
        {segment.status}
      </span>
      <span>{formatDuration(segment.durationMs)}</span>
      <span>{formatNumber(segment.usage.totalTokens ?? 0)} tokens</span>
      {segment.error ? <small>{segment.error.message}</small> : null}
    </article>
  );
}

function HighlightedMessage({
  message,
  row
}: {
  message: MonitorMessage;
  row: ComparisonRow | null;
}) {
  if (!row) return <>{message.text}</>;
  const match = row.evaluatedLlmItem?.evidenceVerification.matches.find(
    (item) => item.messageIndex === message.index
  );
  const phrase =
    match?.quote ||
    (row.llmItem?.evidenceMessageIndexes.includes(message.index)
      ? row.llmItem.triggerPhrase
      : null) ||
    (row.ruleItem?.evidenceMessageIndexes.includes(message.index)
      ? row.ruleItem.triggerPhrase
      : null);
  if (!phrase) return <>{message.text}</>;

  const start =
    match?.startChar != null && match.startChar >= 0
      ? match.startChar
      : message.text.indexOf(phrase);
  if (start < 0 || start >= message.text.length) return <>{message.text}</>;
  const end = Math.min(
    message.text.length,
    match?.endChar != null && match.endChar > start
      ? match.endChar
      : start + phrase.length
  );

  return (
    <>
      {message.text.slice(0, start)}
      <mark data-verdict={row.verdict}>{message.text.slice(start, end)}</mark>
      {message.text.slice(end)}
    </>
  );
}

function MonitorLoading() {
  return (
    <main className={styles.centerState}>
      <LoaderCircle size={24} className={styles.spinning} />
      <strong>Extraction Monitor를 불러오는 중입니다.</strong>
    </main>
  );
}

function MonitorError({ message }: { message: string }) {
  return (
    <main className={styles.centerState}>
      <CircleX size={24} />
      <strong>{message}</strong>
      <Link href="/">
        <Home size={15} /> 새 링크 분석
      </Link>
    </main>
  );
}

function EmptyState({ title }: { title: string }) {
  return <div className={styles.emptyState}>{title}</div>;
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?:
    | "neutral"
    | "muted"
    | "rule"
    | "llm"
    | "evidence"
    | "verified"
    | "review"
    | "rejected"
    | "conflict";
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

function evidenceViewForRow(
  row: ComparisonRow,
  messages: MonitorMessage[]
): (EvidenceMatch & { role: MonitorMessage["role"] }) | null {
  const verifiedMatch = row.evaluatedLlmItem?.evidenceVerification.matches[0];
  if (verifiedMatch) {
    const message = messages.find(
      (candidate) => candidate.index === verifiedMatch.messageIndex
    );
    return { ...verifiedMatch, role: message?.role ?? "unknown" };
  }

  const item = row.llmItem ?? row.ruleItem;
  const messageIndex = item?.evidenceMessageIndexes[0];
  const message = messages.find(
    (candidate) => candidate.index === messageIndex
  );
  if (!item || !message) return null;
  const quote = item.triggerPhrase?.trim() || clip(message.text, 180);
  if (!quote) return null;
  const startChar = message.text.indexOf(quote);

  return {
    messageId: message.id,
    messageIndex: message.index,
    quote,
    startChar: startChar >= 0 ? startChar : null,
    endChar: startChar >= 0 ? startChar + quote.length : null,
    supportType: startChar >= 0 ? "explicit" : "inferred",
    verificationStatus:
      row.verificationStatus === "Verified"
        ? "verified"
        : row.verificationStatus === "Rejected"
          ? "rejected"
          : "review_required",
    role: message.role
  };
}

function comparisonRowIdForItem(
  itemId: string,
  turnId: number | null,
  turns: MonitorTurn[],
  sprint5: HybridExtractionResult | null
): string | null {
  if (!turnId || !sprint5) return null;
  const turn = turns.find((candidate) => candidate.id === turnId);
  if (!turn) return null;
  return (
    buildComparisonRows(turn, sprint5).find(
      (row) => row.ruleItem?.id === itemId || row.llmItem?.id === itemId
    )?.id ?? null
  );
}

function verdictTone(verdict: ComparisonRow["verdict"]) {
  if (verdict === "Rule only") return "rule" as const;
  if (verdict === "LLM only") return "llm" as const;
  if (verdict === "Conflict") return "conflict" as const;
  return "neutral" as const;
}

function verificationTone(status: MonitorVerificationStatus) {
  if (status === "Verified") return "verified" as const;
  if (status === "Rejected") return "rejected" as const;
  return "review" as const;
}

function isMonitorTab(value: string | undefined): value is MonitorTab {
  return ["structure", "turns", "review", "diagnostics"].includes(value ?? "");
}

function llmRunTone(status: HybridExtractionResult["llmResult"]["status"]) {
  if (status === "completed") return "verified" as const;
  if (status === "partial") return "review" as const;
  if (status === "failed") return "rejected" as const;
  return "muted" as const;
}

function formatEvidenceIndexes(indexes: number[]) {
  if (indexes.length === 0) return "no evidence";
  return indexes.map((index) => `#${index}`).join(", ");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatKstTimestamp(value: string | null | undefined, compact = false) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: compact ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: compact ? undefined : "2-digit",
    hour12: false
  }).format(date);
}

function formatElapsedDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "시간 없음";
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  const seconds = Math.floor(value % 60);
  return [
    days ? `${days}일` : "",
    hours ? `${hours}시간` : "",
    minutes ? `${minutes}분` : "",
    `${seconds}초`
  ]
    .filter(Boolean)
    .join(" ");
}

function clip(value: string, length: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= length
    ? normalized
    : `${normalized.slice(0, length - 1)}…`;
}

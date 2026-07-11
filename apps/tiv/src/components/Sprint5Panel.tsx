"use client";

import { useState } from "react";

import type {
  EvidenceEvaluatedItem,
  EvidenceVerificationReason,
  HybridExtractionResult,
  SemanticItem,
  SemanticItemType
} from "@/core/types/semantic";

type VerificationView = "verified" | "review" | "rejected";
type Tone = "good" | "warning" | "danger" | "neutral";

const SEMANTIC_TYPE_ORDER: SemanticItemType[] = [
  "intent",
  "topic",
  "decision",
  "open_question",
  "action",
  "preference",
  "content_constraint",
  "problem_signal",
  "satisfaction",
  "change_event",
  "entity",
  "relation"
];

export function Sprint5Panel({
  sprint5
}: {
  sprint5: HybridExtractionResult | null;
}) {
  const [activeView, setActiveView] = useState<VerificationView>("verified");

  if (!sprint5) {
    return (
      <PanelEmptyState text="이 분석에는 Sprint 5 결과가 저장되지 않았습니다." />
    );
  }

  const { llmResult, evidenceDiagnostics } = sprint5;
  const itemsByView: Record<VerificationView, EvidenceEvaluatedItem[]> = {
    verified: sprint5.verifiedItems,
    review: sprint5.reviewQueue,
    rejected: sprint5.rejectedItems
  };
  const activeItems = itemsByView[activeView];
  const typeRows = buildTypeRows(sprint5.ruleResult.items, llmResult.items);
  const completedSegments = llmResult.segments.filter(
    (segment) => segment.status === "completed"
  ).length;

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 16,
          borderBottom: "1px solid #d4d4d4"
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: "0 0 4px",
              color: "#737373",
              fontSize: 12,
              fontWeight: 700
            }}
          >
            {sprint5.evidenceVerifier.name} {sprint5.evidenceVerifier.version}
          </p>
          <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>
            {providerLabel(llmResult.provider)} ·{" "}
            {llmResult.model ?? "모델 없음"}
          </h2>
          <p
            style={{
              margin: "6px 0 0",
              color: "#525252",
              fontSize: 13,
              overflowWrap: "anywhere"
            }}
          >
            Extractor {llmResult.extractorVersion} ·{" "}
            {formatTimestamp(sprint5.createdAt)}
          </p>
        </div>
        <StatusBadge tone={llmStatusTone(llmResult.status)}>
          {llmResult.status}
        </StatusBadge>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 10
        }}
      >
        <Metric label="Candidates" value={String(llmResult.items.length)} />
        <Metric
          label="Verified"
          value={String(evidenceDiagnostics.verifiedItemCount)}
          tone="good"
        />
        <Metric
          label="Review"
          value={String(evidenceDiagnostics.reviewItemCount)}
          tone="warning"
        />
        <Metric
          label="Rejected"
          value={String(evidenceDiagnostics.rejectedItemCount)}
          tone="danger"
        />
        <Metric
          label="Segments"
          value={`${completedSegments}/${llmResult.segments.length}`}
          tone={
            completedSegments === llmResult.segments.length ? "good" : "warning"
          }
        />
        <Metric
          label="Tokens"
          value={formatNumber(llmResult.metrics.usage.totalTokens)}
        />
        <Metric
          label="Duration"
          value={formatDuration(llmResult.metrics.totalDurationMs)}
        />
      </div>

      <section aria-labelledby="sprint5-coverage-title">
        <SectionHeading
          id="sprint5-coverage-title"
          title="Coverage"
          meta={`${llmResult.coverage.analyzedMessageCount}/${llmResult.coverage.cleanMessageCount} messages`}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14,
            padding: "14px 0 18px",
            borderBottom: "1px solid #e5e5e5"
          }}
        >
          <CoverageBar
            label="Analyzed messages"
            value={ratio(
              llmResult.coverage.analyzedMessageCount,
              llmResult.coverage.cleanMessageCount
            )}
          />
          <CoverageBar
            label="Evidence messages"
            value={llmResult.coverage.evidenceMessageCoverageRatio}
          />
          <CoverageBar
            label="Semantic types"
            value={ratio(
              SEMANTIC_TYPE_ORDER.length -
                llmResult.coverage.unrepresentedSemanticTypes.length,
              SEMANTIC_TYPE_ORDER.length
            )}
          />
        </div>
      </section>

      <section aria-labelledby="sprint5-types-title">
        <SectionHeading
          id="sprint5-types-title"
          title="Semantic Type Comparison"
          meta={`Rule ${sprint5.ruleResult.items.length} · LLM ${llmResult.items.length}`}
        />
        <div style={{ overflowX: "auto", borderBottom: "1px solid #e5e5e5" }}>
          <table
            style={{
              width: "100%",
              minWidth: 460,
              borderCollapse: "collapse",
              fontSize: 13
            }}
          >
            <thead>
              <tr style={{ color: "#737373", textAlign: "left" }}>
                <TableHeader>Type</TableHeader>
                <TableHeader align="right">Rule</TableHeader>
                <TableHeader align="right">LLM</TableHeader>
                <TableHeader align="right">Difference</TableHeader>
              </tr>
            </thead>
            <tbody>
              {typeRows.map((row) => (
                <tr key={row.type} style={{ borderTop: "1px solid #eeeeee" }}>
                  <TableCell>
                    <strong>{semanticTypeLabel(row.type)}</strong>
                  </TableCell>
                  <TableCell align="right">{row.ruleCount}</TableCell>
                  <TableCell align="right">{row.llmCount}</TableCell>
                  <TableCell align="right">
                    <span
                      style={{
                        color:
                          row.difference === 0
                            ? "#737373"
                            : row.difference > 0
                              ? "#027a48"
                              : "#b54708",
                        fontWeight: 700
                      }}
                    >
                      {formatDifference(row.difference)}
                    </span>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="sprint5-segments-title">
        <SectionHeading
          id="sprint5-segments-title"
          title="Segment Runs"
          meta={`${llmResult.metrics.completedRequestCount} completed · ${llmResult.metrics.failedRequestCount} failed`}
        />
        {llmResult.segments.length === 0 ? (
          <PanelEmptyState
            text={llmResult.error?.message ?? "호출된 segment가 없습니다."}
          />
        ) : (
          <div style={{ overflowX: "auto", borderBottom: "1px solid #e5e5e5" }}>
            <table
              style={{
                width: "100%",
                minWidth: 700,
                borderCollapse: "collapse",
                fontSize: 13
              }}
            >
              <thead>
                <tr style={{ color: "#737373", textAlign: "left" }}>
                  <TableHeader>Segment</TableHeader>
                  <TableHeader>Messages</TableHeader>
                  <TableHeader align="right">Items</TableHeader>
                  <TableHeader align="right">Tokens</TableHeader>
                  <TableHeader align="right">Time</TableHeader>
                  <TableHeader align="right">Status</TableHeader>
                </tr>
              </thead>
              <tbody>
                {llmResult.segments.map((segment) => (
                  <tr
                    key={segment.id}
                    style={{ borderTop: "1px solid #eeeeee" }}
                  >
                    <TableCell>
                      <strong>
                        {segment.order}. {segment.label}
                      </strong>
                    </TableCell>
                    <TableCell>
                      #{segment.startMessageIndex}-#{segment.endMessageIndex}
                    </TableCell>
                    <TableCell align="right">{segment.itemCount}</TableCell>
                    <TableCell align="right">
                      {formatOptionalNumber(segment.usage.totalTokens)}
                    </TableCell>
                    <TableCell align="right">
                      {formatDuration(segment.durationMs)}
                    </TableCell>
                    <TableCell align="right">
                      <StatusBadge
                        tone={
                          segment.status === "completed" ? "good" : "danger"
                        }
                      >
                        {segment.status}
                      </StatusBadge>
                    </TableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="sprint5-verification-title">
        <SectionHeading
          id="sprint5-verification-title"
          title="Evidence Verification"
          meta={`${evidenceDiagnostics.evidenceMatchCount} evidence matches`}
        />
        <VerificationTabs
          activeView={activeView}
          onChange={setActiveView}
          counts={{
            verified: sprint5.verifiedItems.length,
            review: sprint5.reviewQueue.length,
            rejected: sprint5.rejectedItems.length
          }}
        />
        {activeItems.length === 0 ? (
          <PanelEmptyState text="표시할 항목이 없습니다." />
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {activeItems.map((item) => (
              <EvidenceItemCard key={item.id} item={item} view={activeView} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function VerificationTabs({
  activeView,
  onChange,
  counts
}: {
  activeView: VerificationView;
  onChange: (view: VerificationView) => void;
  counts: Record<VerificationView, number>;
}) {
  const views: Array<{
    id: VerificationView;
    label: string;
    tone: Tone;
  }> = [
    { id: "verified", label: "Verified", tone: "good" },
    { id: "review", label: "Review", tone: "warning" },
    { id: "rejected", label: "Rejected", tone: "danger" }
  ];

  return (
    <div
      role="tablist"
      aria-label="Evidence 검증 상태"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 6,
        marginTop: 12,
        padding: 4,
        border: "1px solid #d4d4d4",
        borderRadius: 8,
        background: "#f5f5f5"
      }}
    >
      {views.map((view) => {
        const active = activeView === view.id;
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(view.id)}
            style={{
              minWidth: 0,
              border: active ? "1px solid #d4d4d4" : "1px solid transparent",
              borderRadius: 6,
              padding: "9px 8px",
              background: active ? "#fff" : "transparent",
              color: active ? "#171717" : "#737373",
              cursor: "pointer",
              fontWeight: active ? 800 : 600,
              boxShadow: active ? "0 1px 2px rgba(0, 0, 0, 0.06)" : "none",
              overflowWrap: "anywhere"
            }}
          >
            {view.label} {counts[view.id]}
          </button>
        );
      })}
    </div>
  );
}

function EvidenceItemCard({
  item,
  view
}: {
  item: EvidenceEvaluatedItem;
  view: VerificationView;
}) {
  const tone = verificationTone(view);

  return (
    <article
      style={{
        border: "1px solid #e5e5e5",
        borderLeft: `4px solid ${toneColor(tone)}`,
        borderRadius: 8,
        padding: 14,
        background: "#fff",
        minWidth: 0
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <p
            style={{
              margin: "0 0 4px",
              color: "#737373",
              fontSize: 12,
              fontWeight: 700
            }}
          >
            {semanticTypeLabel(item.type)} · {item.id}
          </p>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: 1.4,
              overflowWrap: "anywhere"
            }}
          >
            {item.label}
          </h3>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <StatusBadge tone={tone}>{view}</StatusBadge>
          <StatusBadge tone={confidenceTone(item.confidence)}>
            {formatPercent(item.confidence)}
          </StatusBadge>
        </div>
      </div>

      {item.description ? (
        <p
          style={{
            margin: "8px 0 0",
            color: "#404040",
            lineHeight: 1.55,
            overflowWrap: "anywhere"
          }}
        >
          {item.description}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 10
        }}
      >
        {item.status ? (
          <StatusBadge tone="neutral">{item.status}</StatusBadge>
        ) : null}
        {item.category ? (
          <StatusBadge tone="neutral">{item.category}</StatusBadge>
        ) : null}
        <StatusBadge tone="neutral">
          evidence{" "}
          {item.evidenceMessageIndexes.map((index) => `#${index}`).join(", ")}
        </StatusBadge>
      </div>

      {item.triggerPhrase ? (
        <blockquote
          style={{
            margin: "12px 0 0",
            padding: "9px 11px",
            borderLeft: "3px solid #a3a3a3",
            background: "#fafafa",
            color: "#404040",
            fontSize: 13,
            lineHeight: 1.5,
            overflowWrap: "anywhere"
          }}
        >
          {item.triggerPhrase}
        </blockquote>
      ) : null}

      {item.evidenceVerification.matches.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {item.evidenceVerification.matches.map((match, index) => (
            <div
              key={`${item.id}-${match.messageIndex}-${match.startChar}-${index}`}
              style={{
                paddingTop: 9,
                borderTop: "1px solid #eeeeee",
                minWidth: 0
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 6
                }}
              >
                <StatusBadge tone="neutral">#{match.messageIndex}</StatusBadge>
                <StatusBadge tone="neutral">{match.supportType}</StatusBadge>
                <StatusBadge tone={matchStatusTone(match.verificationStatus)}>
                  {match.verificationStatus}
                </StatusBadge>
                <StatusBadge tone="neutral">
                  {formatSpan(match.startChar, match.endChar)}
                </StatusBadge>
              </div>
              <p
                style={{
                  margin: 0,
                  color: "#404040",
                  fontSize: 13,
                  lineHeight: 1.5,
                  overflowWrap: "anywhere"
                }}
              >
                “{match.quote}”
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {item.evidenceVerification.issues.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 5,
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid #eeeeee"
          }}
        >
          {item.evidenceVerification.issues.map((issue) => (
            <p
              key={`${item.id}-${issue.code}-${issue.messageIndexes.join("-")}`}
              style={{
                margin: 0,
                color: view === "rejected" ? "#b42318" : "#92400e",
                fontSize: 13,
                lineHeight: 1.45,
                overflowWrap: "anywhere"
              }}
            >
              <strong>{reasonLabel(issue.code)}</strong>
              {issue.messageIndexes.length > 0
                ? ` · #${issue.messageIndexes.join(", #")}`
                : ""}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderTop: `3px solid ${toneColor(tone)}`,
        borderRadius: 8,
        padding: "10px 12px 12px",
        background: "#fff",
        minWidth: 0
      }}
    >
      <p style={{ margin: "0 0 5px", color: "#737373", fontSize: 12 }}>
        {label}
      </p>
      <strong
        style={{
          display: "block",
          fontSize: 21,
          lineHeight: 1.2,
          overflowWrap: "anywhere"
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function CoverageBar({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(Math.max(value, 0), 1);
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 7,
          fontSize: 13
        }}
      >
        <span style={{ color: "#525252" }}>{label}</span>
        <strong>{formatPercent(normalized)}</strong>
      </div>
      <div
        aria-label={`${label} ${formatPercent(normalized)}`}
        style={{
          height: 8,
          borderRadius: 4,
          background: "#e5e5e5",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: `${normalized * 100}%`,
            height: "100%",
            background: normalized >= 0.75 ? "#12b76a" : "#f79009"
          }}
        />
      </div>
    </div>
  );
}

function SectionHeading({
  id,
  title,
  meta
}: {
  id: string;
  title: string;
  meta: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 8
      }}
    >
      <h2 id={id} style={{ margin: 0, fontSize: 17, lineHeight: 1.35 }}>
        {title}
      </h2>
      <span style={{ color: "#737373", fontSize: 12 }}>{meta}</span>
    </div>
  );
}

function StatusBadge({
  tone,
  children
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  const colors = {
    good: { background: "#ecfdf3", color: "#027a48", border: "#abefc6" },
    warning: { background: "#fffaeb", color: "#b54708", border: "#fedf89" },
    danger: { background: "#fef3f2", color: "#b42318", border: "#fecdca" },
    neutral: { background: "#f5f5f5", color: "#525252", border: "#e5e5e5" }
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: "2px 7px",
        background: colors.background,
        color: colors.color,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.45,
        overflowWrap: "anywhere"
      }}
    >
      {children}
    </span>
  );
}

function TableHeader({
  children,
  align = "left"
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th style={{ padding: "9px 10px", textAlign: align, fontWeight: 700 }}>
      {children}
    </th>
  );
}

function TableCell({
  children,
  align = "left"
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "10px",
        textAlign: align,
        verticalAlign: "middle",
        lineHeight: 1.4
      }}
    >
      {children}
    </td>
  );
}

function PanelEmptyState({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: "12px 0 0",
        padding: "14px 0",
        color: "#737373",
        borderBottom: "1px solid #e5e5e5",
        lineHeight: 1.5
      }}
    >
      {text}
    </p>
  );
}

function buildTypeRows(ruleItems: SemanticItem[], llmItems: SemanticItem[]) {
  const ruleCounts = countTypes(ruleItems);
  const llmCounts = countTypes(llmItems);
  return SEMANTIC_TYPE_ORDER.map((type) => {
    const ruleCount = ruleCounts[type] ?? 0;
    const llmCount = llmCounts[type] ?? 0;
    return {
      type,
      ruleCount,
      llmCount,
      difference: llmCount - ruleCount
    };
  }).filter((row) => row.ruleCount > 0 || row.llmCount > 0);
}

function countTypes(items: SemanticItem[]) {
  return items.reduce<Partial<Record<SemanticItemType, number>>>(
    (counts, item) => {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
      return counts;
    },
    {}
  );
}

function semanticTypeLabel(type: SemanticItemType): string {
  return {
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
  }[type];
}

function reasonLabel(reason: EvidenceVerificationReason): string {
  return {
    MISSING_EVIDENCE: "근거 없음",
    OUT_OF_RANGE_MESSAGE_INDEX: "존재하지 않는 메시지",
    NON_CLEAN_EVIDENCE: "Clean Conversation 외 근거",
    MISSING_TRIGGER_PHRASE: "Trigger phrase 없음",
    TRIGGER_PHRASE_NOT_FOUND: "원문에서 trigger를 찾지 못함",
    ASSISTANT_ONLY_USER_CLAIM: "Assistant-only 사용자 판단",
    SATISFACTION_PAIR_REQUIRED: "Assistant와 다음 user 반응 쌍 필요",
    DECISION_NOT_EXPLICIT: "명시적 결정 표현 부족",
    OPEN_QUESTION_NOT_EXPLICIT: "명시적 질문 표현 부족",
    ACTION_NOT_EXPLICIT: "명시적 작업 표현 부족",
    LOW_CONFIDENCE: "낮은 신뢰도",
    INFERRED_SUPPORT: "암시적 근거"
  }[reason];
}

function providerLabel(
  provider: HybridExtractionResult["llmResult"]["provider"]
) {
  if (!provider) return "LLM 비활성";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function verificationTone(view: VerificationView): Tone {
  if (view === "verified") return "good";
  if (view === "review") return "warning";
  return "danger";
}

function llmStatusTone(
  status: HybridExtractionResult["llmResult"]["status"]
): Tone {
  if (status === "completed") return "good";
  if (status === "partial") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function matchStatusTone(status: "verified" | "review_required" | "rejected") {
  if (status === "verified") return "good";
  if (status === "review_required") return "warning";
  return "danger";
}

function confidenceTone(confidence: number): Tone {
  if (confidence >= 0.78) return "good";
  if (confidence >= 0.55) return "warning";
  return "danger";
}

function toneColor(tone: Tone): string {
  return {
    good: "#12b76a",
    warning: "#f79009",
    danger: "#f04438",
    neutral: "#a3a3a3"
  }[tone];
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatOptionalNumber(value: number | null): string {
  return value == null ? "-" : formatNumber(value);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatDifference(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatSpan(start: number | null, end: number | null): string {
  return start == null || end == null ? "span 없음" : `${start}-${end}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

"use client";

import { useId, useRef, useState } from "react";

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

const HELP = {
  model: "Sprint 5 의미 후보를 생성한 LLM provider와 실제 호출 모델입니다.",
  llmStatus:
    "모든 segment가 성공하면 completed, 일부만 성공하면 partial, 전부 실패하면 failed로 표시됩니다.",
  candidates:
    "LLM이 Clean Conversation에서 추출한 전체 SemanticItem 후보 수입니다. 근거 검증 전 개수입니다.",
  verified:
    "원문 quote와 span, 메시지 역할, 필요한 대화 쌍이 검증 기준을 통과한 후보 수입니다.",
  review:
    "근거가 일부 맞지만 trigger 불일치, 암시적 표현, 낮은 confidence 등으로 사람 검토가 필요한 후보 수입니다.",
  rejected:
    "잘못된 메시지 index, Internal/Context 근거, assistant-only 사용자 판단처럼 자동 사용하면 안 되는 후보 수입니다.",
  segments:
    "긴 대화를 나눈 LLM 분석 구간입니다. 앞 숫자는 성공 구간, 뒤 숫자는 전체 구간 수입니다.",
  tokens:
    "이번 분석의 모든 segment에서 provider가 보고한 입력·출력 토큰 합계입니다.",
  duration:
    "여러 segment를 병렬 호출한 시점부터 전체 Shadow 분석이 끝날 때까지의 실제 경과 시간입니다.",
  coverage:
    "LLM이 분석한 메시지 범위, evidence로 사용된 메시지 비율, 추출된 semantic type 범위를 보여줍니다.",
  analyzedMessages:
    "분석 가능한 Clean Conversation 메시지 중 LLM main segment에 포함된 비율입니다.",
  evidenceMessages:
    "Clean Conversation 메시지 중 하나 이상의 LLM 후보가 evidence로 인용한 메시지 비율입니다.",
  semanticTypes:
    "blabase가 정의한 12개 SemanticItem 타입 중 이번 LLM 결과에 실제로 등장한 타입 비율입니다.",
  semanticComparison:
    "같은 대화에서 RuleExtractor와 LLMExtractor가 타입별로 몇 개의 후보를 생성했는지 비교합니다.",
  typeColumn: "Intent, Decision, Action 같은 SemanticItem 분류입니다.",
  ruleColumn: "규칙 기반 MockExtractor가 생성한 해당 타입의 후보 수입니다.",
  llmColumn: "Gemini Shadow Extractor가 생성한 해당 타입의 후보 수입니다.",
  differenceColumn:
    "LLM 후보 수에서 Rule 후보 수를 뺀 값입니다. 양수라고 반드시 품질이 더 좋다는 뜻은 아닙니다.",
  segmentRuns:
    "긴 Clean Conversation을 Topic Flow 경계로 나눠 LLM에 개별 요청한 실행 기록입니다.",
  segmentColumn: "segment 순서와 포함된 Topic Flow 기반 구간 이름입니다.",
  messagesColumn:
    "해당 segment가 main input으로 분석한 첫 메시지와 마지막 메시지 index입니다.",
  itemsColumn:
    "해당 segment의 LLM 응답에서 schema 검증을 통과한 후보 수입니다.",
  segmentTokensColumn: "해당 segment 요청의 입력·출력 토큰 합계입니다.",
  timeColumn: "해당 provider 요청 한 건의 응답 시간입니다.",
  statusColumn: "segment별 schema 검증까지 포함한 성공 또는 실패 상태입니다.",
  evidenceVerification:
    "LLM 후보를 원문에 다시 연결해 Verified, Review, Rejected로 분류한 Sprint 5B 결과입니다.",
  evidenceMatches:
    "원문에서 실제 위치가 확인된 quote 연결 수입니다. 하나의 후보가 여러 메시지를 인용할 수 있습니다.",
  verifiedTab: "자동 검증 기준을 통과한 후보만 표시합니다.",
  reviewTab: "사람이 원문과 의미를 다시 확인해야 하는 후보만 표시합니다.",
  rejectedTab:
    "검증 기준을 통과하지 못해 후속 결과에서 제외할 후보만 표시합니다.",
  confidence:
    "LLM이 후보의 의미와 evidence 강도에 대해 반환한 0~100% 신뢰도입니다.",
  evidenceIndex:
    "후보가 근거로 인용한 Canonical Conversation 메시지 index입니다.",
  supportType:
    "explicit은 직접 표현, accepted_context는 연결된 반응, inferred는 암시, unsupported는 근거 불충분을 뜻합니다.",
  verificationStatus:
    "해당 quote 연결 자체가 verified, review_required, rejected 중 어디에 해당하는지 보여줍니다.",
  span: "Canonical message text 안에서 quote가 시작하고 끝나는 문자 위치입니다."
} as const;

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
            <HelpTooltip description={HELP.model}>
              {providerLabel(llmResult.provider)} ·{" "}
              {llmResult.model ?? "모델 없음"}
            </HelpTooltip>
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
        <StatusBadge
          tone={llmStatusTone(llmResult.status)}
          title={HELP.llmStatus}
        >
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
        <Metric
          label="Candidates"
          value={String(llmResult.items.length)}
          help={HELP.candidates}
        />
        <Metric
          label="Verified"
          value={String(evidenceDiagnostics.verifiedItemCount)}
          tone="good"
          help={HELP.verified}
        />
        <Metric
          label="Review"
          value={String(evidenceDiagnostics.reviewItemCount)}
          tone="warning"
          help={HELP.review}
        />
        <Metric
          label="Rejected"
          value={String(evidenceDiagnostics.rejectedItemCount)}
          tone="danger"
          help={HELP.rejected}
        />
        <Metric
          label="Segments"
          value={`${completedSegments}/${llmResult.segments.length}`}
          tone={
            completedSegments === llmResult.segments.length ? "good" : "warning"
          }
          help={HELP.segments}
        />
        <Metric
          label="Tokens"
          value={formatNumber(llmResult.metrics.usage.totalTokens)}
          help={HELP.tokens}
        />
        <Metric
          label="Duration"
          value={formatDuration(llmResult.metrics.totalDurationMs)}
          help={HELP.duration}
        />
      </div>

      <section aria-labelledby="sprint5-coverage-title">
        <SectionHeading
          id="sprint5-coverage-title"
          title="Coverage"
          meta={`${llmResult.coverage.analyzedMessageCount}/${llmResult.coverage.cleanMessageCount} messages`}
          help={HELP.coverage}
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
            help={HELP.analyzedMessages}
          />
          <CoverageBar
            label="Evidence messages"
            value={llmResult.coverage.evidenceMessageCoverageRatio}
            help={HELP.evidenceMessages}
          />
          <CoverageBar
            label="Semantic types"
            value={ratio(
              SEMANTIC_TYPE_ORDER.length -
                llmResult.coverage.unrepresentedSemanticTypes.length,
              SEMANTIC_TYPE_ORDER.length
            )}
            help={HELP.semanticTypes}
          />
        </div>
      </section>

      <section aria-labelledby="sprint5-types-title">
        <SectionHeading
          id="sprint5-types-title"
          title="Semantic Type Comparison"
          meta={`Rule ${sprint5.ruleResult.items.length} · LLM ${llmResult.items.length}`}
          help={HELP.semanticComparison}
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
                <TableHeader help={HELP.typeColumn}>Type</TableHeader>
                <TableHeader align="right" help={HELP.ruleColumn}>
                  Rule
                </TableHeader>
                <TableHeader align="right" help={HELP.llmColumn}>
                  LLM
                </TableHeader>
                <TableHeader align="right" help={HELP.differenceColumn}>
                  Difference
                </TableHeader>
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
          help={HELP.segmentRuns}
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
                  <TableHeader help={HELP.segmentColumn}>Segment</TableHeader>
                  <TableHeader help={HELP.messagesColumn}>Messages</TableHeader>
                  <TableHeader align="right" help={HELP.itemsColumn}>
                    Items
                  </TableHeader>
                  <TableHeader align="right" help={HELP.segmentTokensColumn}>
                    Tokens
                  </TableHeader>
                  <TableHeader align="right" help={HELP.timeColumn}>
                    Time
                  </TableHeader>
                  <TableHeader align="right" help={HELP.statusColumn}>
                    Status
                  </TableHeader>
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
          help={HELP.evidenceVerification}
          metaHelp={HELP.evidenceMatches}
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
    help: string;
  }> = [
    { id: "verified", label: "Verified", help: HELP.verifiedTab },
    { id: "review", label: "Review", help: HELP.reviewTab },
    { id: "rejected", label: "Rejected", help: HELP.rejectedTab }
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
            title={view.help}
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
            title={semanticTypeHelp(item.type)}
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
          <StatusBadge tone={tone} title={verificationViewHelp(view)}>
            {view}
          </StatusBadge>
          <StatusBadge
            tone={confidenceTone(item.confidence)}
            title={HELP.confidence}
          >
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
          <StatusBadge
            tone="neutral"
            title="해당 SemanticItem 타입에 맞춰 LLM이 부여한 현재 상태입니다."
          >
            {item.status}
          </StatusBadge>
        ) : null}
        {item.category ? (
          <StatusBadge
            tone="neutral"
            title="LLM이 구분한 선택적 세부 카테고리입니다."
          >
            {item.category}
          </StatusBadge>
        ) : null}
        <StatusBadge tone="neutral" title={HELP.evidenceIndex}>
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
                <StatusBadge tone="neutral" title={HELP.evidenceIndex}>
                  #{match.messageIndex}
                </StatusBadge>
                <StatusBadge tone="neutral" title={HELP.supportType}>
                  {match.supportType}
                </StatusBadge>
                <StatusBadge
                  tone={matchStatusTone(match.verificationStatus)}
                  title={HELP.verificationStatus}
                >
                  {match.verificationStatus}
                </StatusBadge>
                <StatusBadge tone="neutral" title={HELP.span}>
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
              <strong title={issue.message}>{reasonLabel(issue.code)}</strong>
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
  tone = "neutral",
  help
}: {
  label: string;
  value: string;
  tone?: Tone;
  help: string;
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
        <HelpTooltip description={help}>{label}</HelpTooltip>
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

function CoverageBar({
  label,
  value,
  help
}: {
  label: string;
  value: number;
  help: string;
}) {
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
        <span style={{ color: "#525252" }}>
          <HelpTooltip description={help}>{label}</HelpTooltip>
        </span>
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
  meta,
  help,
  metaHelp
}: {
  id: string;
  title: string;
  meta: string;
  help: string;
  metaHelp?: string;
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
        <HelpTooltip description={help}>{title}</HelpTooltip>
      </h2>
      <span style={{ color: "#737373", fontSize: 12 }}>
        {metaHelp ? (
          <HelpTooltip description={metaHelp}>{meta}</HelpTooltip>
        ) : (
          meta
        )}
      </span>
    </div>
  );
}

function HelpTooltip({
  children,
  description
}: {
  children: React.ReactNode;
  description: string;
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  function showTooltip() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, Math.max(180, window.innerWidth - 32));
    const left = Math.min(
      Math.max(16, rect.left),
      Math.max(16, window.innerWidth - width - 16)
    );
    const showAbove = rect.bottom + 150 > window.innerHeight && rect.top > 170;
    setPosition({
      left,
      width,
      ...(showAbove
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 })
    });
  }

  function hideTooltip() {
    setPosition(null);
  }

  return (
    <span style={{ display: "inline-flex", maxWidth: "100%" }}>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={position ? tooltipId : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onClick={() => (position ? hideTooltip() : showTooltip())}
        onKeyDown={(event) => {
          if (event.key === "Escape") hideTooltip();
        }}
        style={{
          maxWidth: "100%",
          borderBottom: "1px dotted #a3a3a3",
          cursor: "help",
          outlineOffset: 3,
          overflowWrap: "anywhere"
        }}
      >
        {children}
      </span>
      {position ? (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: "fixed",
            zIndex: 100,
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: position.width,
            padding: "9px 11px",
            border: "1px solid #262626",
            borderRadius: 6,
            background: "#171717",
            color: "#fff",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.5,
            textAlign: "left",
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            pointerEvents: "none"
          }}
        >
          {description}
        </span>
      ) : null}
    </span>
  );
}

function StatusBadge({
  tone,
  children,
  title
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  const colors = {
    good: { background: "#ecfdf3", color: "#027a48", border: "#abefc6" },
    warning: { background: "#fffaeb", color: "#b54708", border: "#fedf89" },
    danger: { background: "#fef3f2", color: "#b42318", border: "#fecdca" },
    neutral: { background: "#f5f5f5", color: "#525252", border: "#e5e5e5" }
  }[tone];

  return (
    <span
      title={title}
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
        overflowWrap: "anywhere",
        cursor: title ? "help" : "default"
      }}
    >
      {children}
    </span>
  );
}

function TableHeader({
  children,
  align = "left",
  help
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  help?: string;
}) {
  return (
    <th
      title={help}
      style={{ padding: "9px 10px", textAlign: align, fontWeight: 700 }}
    >
      <span
        style={{
          borderBottom: help ? "1px dotted #a3a3a3" : "none",
          cursor: help ? "help" : "default"
        }}
      >
        {children}
      </span>
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

function semanticTypeHelp(type: SemanticItemType): string {
  return {
    intent: "사용자가 궁극적으로 달성하려는 목표나 확인하려는 핵심 목적입니다.",
    topic: "대화에서 실제로 논의된 구체적인 주제나 논점입니다.",
    decision: "사용자가 확정, 제외, 보류하거나 후보로 남긴 방향입니다.",
    open_question: "아직 답이나 최종 결정이 필요한 사용자 질문입니다.",
    action: "사용자가 요청했거나 대화에서 다음에 수행하기로 한 작업입니다.",
    preference:
      "답변의 형식, 길이, 표현, 톤 또는 깊이에 대한 사용자 선호입니다.",
    content_constraint:
      "결과물에 반드시 포함하거나 제외해야 하는 내용 조건입니다.",
    problem_signal:
      "사용자가 겪는 오류, 불편, 위험 또는 해결이 필요한 문제입니다.",
    satisfaction:
      "Assistant 답변과 다음 user 반응을 연결해 판단한 만족 상태입니다.",
    change_event: "대화의 범위, 조건, 형식 또는 구현 단계가 바뀐 사건입니다.",
    entity: "대화 이해에 필요한 제품, 기술, 조직, 문서 등의 명명된 대상입니다.",
    relation: "두 Entity 사이에 원문으로 확인되는 관계입니다."
  }[type];
}

function verificationViewHelp(view: VerificationView): string {
  if (view === "verified") return HELP.verifiedTab;
  if (view === "review") return HELP.reviewTab;
  return HELP.rejectedTab;
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

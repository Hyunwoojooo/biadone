"use client";

import { useEffect, useState } from "react";

import type {
  ActionItem,
  ContentConstraint,
  DecisionItem,
  EvidenceItem,
  MockStructureResult,
  OpenQuestionItem,
  PreferenceSignal,
  ReviewRequiredReason,
  SatisfactionSignal,
  TopicFlowItem
} from "@/core/types/structures";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type StructureResultResponse = {
  analysisId: string;
  status: "completed" | "failed";
  result?: MockStructureResult;
  error?: {
    code: string;
    message: string;
  };
};

type EvidenceMap = Map<number, EvidenceItem[]>;

type ReviewItem = {
  id: string;
  type: string;
  label: string;
  confidence: number;
  reason: ReviewRequiredReason | "example_like" | "missing_quote";
  evidenceMessageIndexes: number[];
};

type PreferenceInsight = {
  id: string;
  title: string;
  description: string;
  confidence: number;
  evidenceMessageIndexes: number[];
  sourceSignals: PreferenceSignal[];
};

type EvidenceQuoteItem = {
  id: string;
  quote: string;
  messageIndexes: number[];
  contextSignalRefs: string[];
  sourceType: EvidenceItem["sourceType"];
  evidenceStrength: EvidenceItem["evidenceStrength"];
};

type OverviewNarrative = {
  headline: string;
  summary: string;
  userIntent: string;
  confidenceNote: string;
  nextReviewFocus: string[];
};

type BadgeTone = "good" | "warning" | "danger" | "neutral";

export function StructureResultViewer({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<StructureResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditExporting, setAuditExporting] = useState(false);
  const [activeSprint, setActiveSprint] = useState<"sprint3" | "sprint4">(
    "sprint4"
  );

  useEffect(() => {
    let cancelled = false;

    async function loadResult() {
      try {
        const response = await fetch(`${basePath}/api/analyses/${analysisId}/result`);
        const payload = (await response.json()) as StructureResultResponse;

        if (cancelled) {
          return;
        }

        if (!response.ok || payload.status === "failed") {
          setError(payload.error?.message ?? "구조화 결과를 불러오지 못했습니다.");
          return;
        }

        setData(payload);
      } catch {
        if (!cancelled) {
          setError("구조화 결과를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadResult();

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  if (loading) {
    return <p>구조화 결과를 만드는 중...</p>;
  }

  if (error) {
    return (
      <p role="alert" style={{ color: "#b42318" }}>
        {error}
      </p>
    );
  }

  if (!data?.result) {
    return <p style={{ color: "#777" }}>표시할 구조화 결과가 없습니다.</p>;
  }

  const { result } = data;
  const evidenceByMessage = buildEvidenceByMessage(result.evidence);
  const reviewItems = buildReviewItems(result, evidenceByMessage);
  const quotedEvidenceCount = result.evidence.filter((item) => item.quote?.trim()).length;

  async function downloadGptAuditFile() {
    setAuditExporting(true);
    try {
      const response = await fetch(
        `${basePath}/api/analyses/${analysisId}/gpt-audit`
      );
      if (!response.ok) {
        throw new Error("GPT audit export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tiv-gpt-audit-${analysisId}.md`;
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

  return (
    <section style={{ marginBottom: 40, color: "#171717" }}>
      <header style={{ marginBottom: 20 }}>
        <p style={{ margin: "0 0 6px", color: "#737373", fontSize: 13 }}>
          Structure Result · {result.extractor.name} {result.extractor.version}
        </p>
        <h1 style={{ margin: "0 0 10px", fontSize: 30, lineHeight: 1.15 }}>
          {result.overview.title}
        </h1>
        <p style={{ color: "#404040", lineHeight: 1.65, margin: 0 }}>
          {result.overview.resolutionSummary}
        </p>
        <button
          type="button"
          onClick={downloadGptAuditFile}
          disabled={auditExporting}
          style={{
            marginTop: 14,
            border: "1px solid #111827",
            borderRadius: 8,
            background: auditExporting ? "#f5f5f5" : "#111827",
            color: auditExporting ? "#737373" : "#fff",
            padding: "9px 12px",
            cursor: auditExporting ? "not-allowed" : "pointer",
            fontWeight: 700
          }}
        >
          {auditExporting ? "GPT 검수 파일 생성 중..." : "GPT 검수 파일 만들기"}
        </button>
      </header>

      <SprintTabs activeSprint={activeSprint} onChange={setActiveSprint} />

      {activeSprint === "sprint3" ? (
        <Sprint3Panel result={result} />
      ) : (
        <Sprint4Panel
          result={result}
          evidenceByMessage={evidenceByMessage}
          reviewItems={reviewItems}
          quotedEvidenceCount={quotedEvidenceCount}
        />
      )}
    </section>
  );
}

function SprintTabs({
  activeSprint,
  onChange
}: {
  activeSprint: "sprint3" | "sprint4";
  onChange: (sprint: "sprint3" | "sprint4") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="분석 결과 버전"
      style={{
        display: "flex",
        gap: 8,
        borderBottom: "1px solid #d4d4d4",
        marginBottom: 18
      }}
    >
      <SprintTabButton
        active={activeSprint === "sprint3"}
        label="Sprint 3"
        description="Mock 구조화 원본"
        onClick={() => onChange("sprint3")}
      />
      <SprintTabButton
        active={activeSprint === "sprint4"}
        label="Sprint 4"
        description="사람이 읽기 쉬운 판단 UI"
        onClick={() => onChange("sprint4")}
      />
    </div>
  );
}

function SprintTabButton({
  active,
  label,
  description,
  onClick
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        appearance: "none",
        border: 0,
        borderBottom: `3px solid ${active ? "#111827" : "transparent"}`,
        background: "transparent",
        padding: "10px 12px 9px",
        cursor: "pointer",
        textAlign: "left",
        color: active ? "#111827" : "#525252"
      }}
    >
      <span style={{ display: "block", fontWeight: 800 }}>{label}</span>
      <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>
        {description}
      </span>
    </button>
  );
}

function Sprint3Panel({ result }: { result: MockStructureResult }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section title="Sprint 3 Raw Structure">
        <KeyValue label="Extractor" value={`${result.extractor.name} ${result.extractor.version}`} />
        <KeyValue label="Overview confidence" value={formatConfidence(result.overview.confidence)} />
        <KeyValue label="Current status" value={result.overview.currentStatus} />
        <KeyValue label="Context signals" value={`${result.diagnostics.contextSignalCount} total`} />
      </Section>

      <Section title="Overview">
        <KeyValue label="Title" value={result.overview.title} />
        <KeyValue label="Main subject" value={result.overview.mainSubject} />
        <KeyValue label="Core intent" value={result.overview.userCoreIntent} />
        <KeyValue label="Resolution" value={result.overview.resolutionSummary} />
        <KeyValue label="Satisfaction" value={result.overview.satisfactionSummary} />
      </Section>

      <Section title="Board">
        <RawList
          title="Decisions"
          items={result.board.decisions.map((item) => ({
            id: item.id,
            title: item.title,
            meta: `${item.status} · ${item.source}`,
            confidence: item.confidence,
            evidenceMessageIndexes: item.evidenceMessageIndexes
          }))}
        />
        <RawList
          title="Open Questions"
          items={result.board.openQuestions.map((item) => ({
            id: item.id,
            title: item.question,
            meta: item.status,
            confidence: item.confidence,
            evidenceMessageIndexes: item.evidenceMessageIndexes
          }))}
        />
        <RawList
          title="Actions"
          items={result.board.actions.map((item) => ({
            id: item.id,
            title: item.title,
            meta: `${item.actionType} · ${item.status} · ${item.assignee}`,
            confidence: item.confidence,
            evidenceMessageIndexes: item.evidenceMessageIndexes
          }))}
        />
      </Section>

      <Section title="Topic Flow">
        <RawList
          title="Topics"
          items={result.topicFlow.map((topic) => ({
            id: topic.id,
            title: topic.label,
            meta: `${topic.changeReason} · #${topic.startMessageIndex}-#${topic.endMessageIndex}${topic.contextSummary ? ` · ${topic.contextSummary.signalCount} context signals` : ""}`,
            confidence: topic.confidence,
            evidenceMessageIndexes: topic.evidenceMessageIndexes
          }))}
        />
      </Section>

      <Section title="Signals">
        <RawList
          title="Preferences"
          items={result.preferenceSignals.map((item) => ({
            id: item.id,
            title: item.normalizedLabel,
            meta: `${item.category} · ${item.polarity}${item.reinforced ? " · reinforced" : ""}`,
            confidence: item.confidence,
            evidenceMessageIndexes: item.evidenceMessageIndexes
          }))}
        />
        <RawList
          title="Satisfaction"
          items={result.satisfactionSignals.slice(0, 20).map((item) => ({
            id: item.id,
            title: item.status,
            meta: item.rationale,
            confidence: item.confidence,
            evidenceMessageIndexes: item.evidenceMessageIndexes
          }))}
        />
      </Section>

      <Section title="Diagnostics">
        <KeyValue
          label="Context signal types"
          value={formatSignalCounts(result.diagnostics.contextSignalTypeCounts)}
        />
        <KeyValue label="Rules fired" value={formatSignalCounts(result.diagnostics.rulesFired)} />
        <KeyValue label="Warnings" value={String(result.diagnostics.warnings.length)} />
        <KeyValue label="Excluded internal" value={String(result.diagnostics.excludedInternalCount)} />
      </Section>
    </div>
  );
}

function Sprint4Panel({
  result,
  evidenceByMessage,
  reviewItems,
  quotedEvidenceCount
}: {
  result: MockStructureResult;
  evidenceByMessage: EvidenceMap;
  reviewItems: ReviewItem[];
  quotedEvidenceCount: number;
}) {
  const preferenceInsights = buildPreferenceInsights(result.preferenceSignals);
  const primaryPreferenceInsights = preferenceInsights.filter(
    (insight) => insight.confidence >= 0.75
  );
  const weakPreferenceInsights = preferenceInsights.filter(
    (insight) => insight.confidence < 0.75
  );
  const evidenceQuotes = buildEvidenceQuoteItems(result.evidence);
  const confidentPreferenceSignals = result.preferenceSignals.filter(
    (item) => item.confidence >= 0.75
  );
  const weakPreferenceSignals = result.preferenceSignals.filter(
    (item) => item.confidence < 0.75
  );
  const confidentSatisfactionSignals = result.satisfactionSignals.filter(
    (item) => item.confidence >= 0.75
  );
  const weakSatisfactionSignals = result.satisfactionSignals.filter(
    (item) => item.confidence < 0.75
  );
  const confidentContentConstraints = result.contentConstraints.filter(
    (item) => item.includeInMainBoard
  );
  const weakContentConstraints = result.contentConstraints.filter(
    (item) => !item.includeInMainBoard
  );
  const overviewNarrative = buildOverviewNarrative(
    result,
    primaryPreferenceInsights,
    reviewItems
  );
  const mainBoardDecisions = result.board.decisions.filter(
    (item) => item.includeInMainBoard
  );
  const mainBoardOpenQuestions = result.board.openQuestions.filter(
    (item) => item.includeInMainBoard
  );
  const mainBoardActions = result.board.actions.filter(
    (item) => item.includeInMainBoard
  );

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
          marginBottom: 18
        }}
      >
        <MetricCard
          label="Overall confidence"
          value={formatConfidence(result.overview.confidence)}
          tone={confidenceTone(result.overview.confidence)}
        />
        <MetricCard
          label="Needs review"
          value={String(reviewItems.length)}
          tone={reviewItems.length > 0 ? "warning" : "good"}
        />
        <MetricCard
          label="Evidence quotes"
          value={`${quotedEvidenceCount}/${result.evidence.length}`}
          tone={quotedEvidenceCount > 0 ? "good" : "warning"}
        />
        <MetricCard
          label="Warnings"
          value={String(result.diagnostics.warnings.length)}
          tone={result.diagnostics.warnings.length > 0 ? "warning" : "good"}
        />
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <Section title="Evidence Quote Viewer">
          <p style={{ marginTop: 0, color: "#525252", lineHeight: 1.55 }}>
            구조화 결과가 어떤 원문 근거에서 나왔는지 먼저 확인하는 영역입니다.
            clean conversation 근거와 context signal 근거를 분리해서 표시합니다.
          </p>
          {evidenceQuotes.length === 0 ? (
            <EmptyState text="표시할 evidence quote가 없습니다." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {evidenceQuotes.slice(0, 12).map((item) => (
                <EvidenceQuoteCard key={item.id} item={item} />
              ))}
            </div>
          )}
          {evidenceQuotes.length > 12 ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "#737373" }}>
                추가 evidence quote {evidenceQuotes.length - 12}개
              </summary>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {evidenceQuotes.slice(12).map((item) => (
                  <EvidenceQuoteCard key={item.id} item={item} compact />
                ))}
              </div>
            </details>
          ) : null}
        </Section>

        <Section title="Preference Insight">
          {primaryPreferenceInsights.length === 0 ? (
            <EmptyState text="높은 신뢰도의 선호 인사이트가 아직 없습니다." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {primaryPreferenceInsights.map((insight) => (
                <PreferenceInsightCard
                  key={insight.id}
                  insight={insight}
                  evidenceByMessage={evidenceByMessage}
                />
              ))}
            </div>
          )}
          {weakPreferenceInsights.length > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "#737373" }}>
                약한 선호 신호 {weakPreferenceInsights.length}개
              </summary>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {weakPreferenceInsights.map((insight) => (
                  <PreferenceInsightCard
                    key={insight.id}
                    insight={insight}
                    evidenceByMessage={evidenceByMessage}
                    compact
                  />
                ))}
              </div>
            </details>
          ) : null}
        </Section>

        {reviewItems.length > 0 ? (
          <Section title="Review First" tone="warning">
            <p style={{ marginTop: 0, color: "#57534e", lineHeight: 1.55 }}>
              낮은 신뢰도, 예시 문장 기반, quote 누락처럼 바로 믿기 어려운
              항목입니다. 이 목록부터 원문과 비교하면 지금 구조화가 믿을 만한지
              빠르게 판단할 수 있습니다.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {reviewItems.slice(0, 8).map((item) => (
                <ReviewRow key={item.id} item={item} />
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Current Read">
          <OverviewNarrativePanel narrative={overviewNarrative} />
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "#737373" }}>
              원본 overview 필드 보기
            </summary>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <KeyValue label="Main subject" value={result.overview.mainSubject} />
              <KeyValue label="Core intent" value={result.overview.userCoreIntent} />
              <KeyValue label="Status" value={result.overview.currentStatus} />
              <KeyValue
                label="Satisfaction"
                value={result.overview.satisfactionSummary}
              />
            </div>
          </details>
        </Section>

        <Section title="Board">
          <Group title="Decisions" empty={mainBoardDecisions.length === 0}>
            {mainBoardDecisions.map((item) => (
              <DecisionCard
                key={item.id}
                item={item}
                evidenceByMessage={evidenceByMessage}
              />
            ))}
          </Group>
          <Group title="Open Questions" empty={mainBoardOpenQuestions.length === 0}>
            {mainBoardOpenQuestions.map((item) => (
              <OpenQuestionCard
                key={item.id}
                item={item}
                evidenceByMessage={evidenceByMessage}
              />
            ))}
          </Group>
          <Group title="Actions" empty={mainBoardActions.length === 0}>
            {mainBoardActions.map((item) => (
              <ActionCard
                key={item.id}
                item={item}
                evidenceByMessage={evidenceByMessage}
              />
            ))}
          </Group>
        </Section>

        <Section title="Topic Timeline">
          {result.topicFlow.length === 0 ? (
            <EmptyState text="생성된 topic flow가 없습니다." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {result.topicFlow.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  evidenceByMessage={evidenceByMessage}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Signals">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 14
            }}
          >
            <Group title="Preferences" empty={confidentPreferenceSignals.length === 0}>
              {confidentPreferenceSignals.map((item) => (
                <PreferenceCard
                  key={item.id}
                  item={item}
                  evidenceByMessage={evidenceByMessage}
                />
              ))}
            </Group>
            <Group
              title="Content Constraints"
              empty={confidentContentConstraints.length === 0}
            >
              {confidentContentConstraints.map((item) => (
                <ContentConstraintCard
                  key={item.id}
                  item={item}
                  evidenceByMessage={evidenceByMessage}
                />
              ))}
            </Group>
            <Group
              title="Satisfaction"
              empty={confidentSatisfactionSignals.length === 0}
            >
              {confidentSatisfactionSignals.slice(0, 10).map((item) => (
                <SatisfactionCard
                  key={item.id}
                  item={item}
                  evidenceByMessage={evidenceByMessage}
                />
              ))}
            </Group>
          </div>
          {weakPreferenceSignals.length +
            weakContentConstraints.length +
            weakSatisfactionSignals.length >
          0 ? (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", color: "#737373" }}>
                Weak Signals {weakPreferenceSignals.length + weakContentConstraints.length + weakSatisfactionSignals.length}개
              </summary>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 14,
                  marginTop: 12
                }}
              >
                <Group title="Weak Preferences" empty={weakPreferenceSignals.length === 0}>
                  {weakPreferenceSignals.map((item) => (
                    <PreferenceCard
                      key={item.id}
                      item={item}
                      evidenceByMessage={evidenceByMessage}
                    />
                  ))}
                </Group>
                <Group
                  title="Weak Content Constraints"
                  empty={weakContentConstraints.length === 0}
                >
                  {weakContentConstraints.map((item) => (
                    <ContentConstraintCard
                      key={item.id}
                      item={item}
                      evidenceByMessage={evidenceByMessage}
                    />
                  ))}
                </Group>
                <Group
                  title="Weak Satisfaction"
                  empty={weakSatisfactionSignals.length === 0}
                >
                  {weakSatisfactionSignals.slice(0, 10).map((item) => (
                    <SatisfactionCard
                      key={item.id}
                      item={item}
                      evidenceByMessage={evidenceByMessage}
                    />
                  ))}
                </Group>
              </div>
            </details>
          ) : null}
        </Section>

        <details
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            padding: 16,
            background: "#fafafa"
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Diagnostics and raw extraction signals
          </summary>
          <div style={{ marginTop: 14 }}>
            <KeyValue
              label="Context signal types"
              value={formatSignalCounts(result.diagnostics.contextSignalTypeCounts)}
            />
            <KeyValue
              label="Context signals"
              value={`${result.diagnostics.contextSignalCount} total · ${result.diagnostics.sourceBackedTopicCount} source-backed topics`}
            />
            <KeyValue
              label="Excluded internal"
              value={String(result.diagnostics.excludedInternalCount)}
            />
            <KeyValue
              label="Rules fired"
              value={formatSignalCounts(result.diagnostics.rulesFired)}
            />
            {result.diagnostics.warnings.slice(0, 12).map((warning, index) => (
              <p key={`${warning.code}-${index}`} style={{ margin: "8px 0 0" }}>
                <Badge tone="warning">{warning.code}</Badge>{" "}
                <span style={{ color: "#525252" }}>{warning.message}</span>
              </p>
            ))}
          </div>
        </details>
      </div>
    </>
  );
}

function RawList({
  title,
  items
}: {
  title: string;
  items: Array<{
    id: string;
    title: string;
    meta: string;
    confidence: number;
    evidenceMessageIndexes: number[];
  }>;
}) {
  return (
    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{title}</h3>
      {items.length === 0 ? (
        <EmptyState text="표시할 항목이 없습니다." />
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item) => (
            <article
              key={item.id}
              style={{
                borderTop: "1px solid #ececec",
                paddingTop: 8
              }}
            >
              <p style={{ margin: 0, lineHeight: 1.45 }}>
                <strong>{item.title}</strong>
              </p>
              <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
                {item.meta} · {formatConfidence(item.confidence)} · evidence{" "}
                {item.evidenceMessageIndexes.length > 0
                  ? item.evidenceMessageIndexes.map((index) => `#${index}`).join(", ")
                  : "none"}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PreferenceInsightCard({
  insight,
  evidenceByMessage,
  compact = false
}: {
  insight: PreferenceInsight;
  evidenceByMessage: EvidenceMap;
  compact?: boolean;
}) {
  return (
    <InsightCard
      title={insight.title}
      description={insight.description}
      badges={[
        `${insight.sourceSignals.length} signals`,
        insight.sourceSignals.some((signal) => signal.reinforced)
          ? "reinforced"
          : "single"
      ]}
      confidence={insight.confidence}
      evidenceMessageIndexes={insight.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
      compact={compact}
    />
  );
}

function EvidenceQuoteCard({
  item,
  compact = false
}: {
  item: EvidenceQuoteItem;
  compact?: boolean;
}) {
  return (
    <article
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        padding: compact ? 10 : 12,
        background: item.sourceType === "context_signal" ? "#fafafa" : "#fff"
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <Badge tone={item.sourceType === "context_signal" ? "neutral" : "good"}>
          {item.sourceType}
        </Badge>
        <Badge tone="neutral">{item.evidenceStrength}</Badge>
        {item.messageIndexes.length > 0 ? (
          <Badge tone="neutral">
            {item.messageIndexes.map((index) => `#${index}`).join(", ")}
          </Badge>
        ) : null}
        {item.contextSignalRefs.length > 0 ? (
          <Badge tone="neutral">{item.contextSignalRefs.join(", ")}</Badge>
        ) : null}
      </div>
      <blockquote
        style={{
          margin: 0,
          padding: "8px 10px",
          borderLeft: "3px solid #d4d4d4",
          background: "#fff",
          color: "#404040",
          fontSize: compact ? 13 : 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap"
        }}
      >
        {item.quote}
      </blockquote>
    </article>
  );
}

function OverviewNarrativePanel({
  narrative
}: {
  narrative: OverviewNarrative;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <article
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 8,
          padding: 14,
          background: "#fafafa"
        }}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: 18, lineHeight: 1.35 }}>
          {narrative.headline}
        </h3>
        <p style={{ margin: 0, color: "#404040", lineHeight: 1.65 }}>
          {narrative.summary}
        </p>
      </article>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 10
        }}
      >
        <NarrativeNote title="User Intent" body={narrative.userIntent} />
        <NarrativeNote title="Confidence" body={narrative.confidenceNote} />
      </div>

      {narrative.nextReviewFocus.length > 0 ? (
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Next Review Focus</h3>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            {narrative.nextReviewFocus.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function NarrativeNote({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        padding: 12,
        background: "#fff"
      }}
    >
      <p style={{ margin: "0 0 6px", color: "#737373", fontSize: 12 }}>
        {title}
      </p>
      <p style={{ margin: 0, color: "#404040", lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

function buildEvidenceByMessage(evidence: EvidenceItem[]): EvidenceMap {
  const map: EvidenceMap = new Map();
  for (const item of evidence) {
    for (const messageIndex of item.evidenceMessageIndexes) {
      map.set(messageIndex, [...(map.get(messageIndex) ?? []), item]);
    }
  }
  return map;
}

function buildEvidenceQuoteItems(evidence: EvidenceItem[]): EvidenceQuoteItem[] {
  return evidence
    .map((item, index): EvidenceQuoteItem | null => {
      const quote = item.quote?.trim();
      if (!quote) {
        return null;
      }

      return {
        id: item.id || `evidence_quote_${index + 1}`,
        quote,
        messageIndexes: item.evidenceMessageIndexes,
        contextSignalRefs: item.contextSignalRefs ?? [],
        sourceType: item.sourceType,
        evidenceStrength: item.evidenceStrength
      };
    })
    .filter((item): item is EvidenceQuoteItem => item != null)
    .sort((a, b) => {
      const aIndex = a.messageIndexes[0] ?? Number.MAX_SAFE_INTEGER;
      const bIndex = b.messageIndexes[0] ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
}

function buildOverviewNarrative(
  result: MockStructureResult,
  preferenceInsights: PreferenceInsight[],
  reviewItems: ReviewItem[]
): OverviewNarrative {
  const decisionCount = result.board.decisions.length;
  const openQuestionCount = result.board.openQuestions.filter(
    (item) => item.status === "open"
  ).length;
  const actionCount = result.board.actions.length;
  const strongestPreferences = preferenceInsights.slice(0, 2);
  const preferenceText =
    strongestPreferences.length > 0
      ? strongestPreferences.map((item) => item.title).join(", ")
      : "명확한 고신뢰 선호 신호는 아직 부족합니다";

  return {
    headline: overviewHeadline(result),
    summary: `이 대화는 “${result.overview.mainSubject}”를 중심으로 진행됐습니다. 현재 추출된 결정은 ${decisionCount}개, 남은 질문은 ${openQuestionCount}개, 요청/작업 항목은 ${actionCount}개입니다. 주요 선호는 ${preferenceText} 쪽으로 읽힙니다.`,
    userIntent: `사용자의 현재 핵심 의도는 “${result.overview.userCoreIntent}”로 요약됩니다. 단순한 대화 기록보다, 의도와 결정, 다음 작업을 판단 가능한 형태로 보고 싶어하는 흐름입니다.`,
    confidenceNote: overviewConfidenceNote(result, reviewItems),
    nextReviewFocus: overviewReviewFocus(result, reviewItems)
  };
}

function overviewHeadline(result: MockStructureResult): string {
  if (result.overview.currentStatus === "in_progress") {
    return "아직 진행 중인 대화로 보입니다";
  }
  if (result.overview.currentStatus === "resolved") {
    return "대화의 핵심 요청은 대체로 처리된 상태로 보입니다";
  }
  if (result.overview.currentStatus === "partially_resolved") {
    return "일부는 정리됐지만 추가 확인이 필요한 상태입니다";
  }
  return "대화 상태를 판단하기에는 근거가 부족합니다";
}

function overviewConfidenceNote(
  result: MockStructureResult,
  reviewItems: ReviewItem[]
): string {
  const confidence = formatConfidence(result.overview.confidence);
  if (reviewItems.length === 0) {
    return `전체 confidence는 ${confidence}이며, 우선 검토가 필요한 약한 신호는 많지 않습니다.`;
  }

  const exampleLikeCount = reviewItems.filter(
    (item) => item.reason === "example_like"
  ).length;
  const missingQuoteCount = reviewItems.filter(
    (item) => item.reason === "missing_quote"
  ).length;

  return `전체 confidence는 ${confidence}입니다. 다만 review 대상 ${reviewItems.length}개가 있으며, 그중 예시 문장 기반 가능성 ${exampleLikeCount}개, quote 누락 ${missingQuoteCount}개는 원문 확인이 필요합니다.`;
}

function overviewReviewFocus(
  result: MockStructureResult,
  reviewItems: ReviewItem[]
): string[] {
  const focus: string[] = [];

  if (reviewItems.some((item) => item.reason === "example_like")) {
    focus.push("예시/문서 문장 안에서 잡힌 신호가 실제 사용자 선호인지 확인");
  }
  if (reviewItems.some((item) => item.reason === "missing_quote")) {
    focus.push("evidence index는 있으나 quote가 없는 항목의 원문 근거 확인");
  }
  if (result.board.openQuestions.some((item) => item.status === "open")) {
    focus.push("아직 resolved 처리되지 않은 open question이 실제로 남아 있는지 확인");
  }
  if (result.preferenceSignals.some((item) => item.confidence < 0.75)) {
    focus.push("Weak Signals에 들어간 낮은 confidence 선호는 기본 판단에서 제외할지 검토");
  }
  if (focus.length === 0) {
    focus.push("Board의 decisions/actions가 실제 대화 흐름과 맞는지 최종 확인");
  }

  return focus;
}

function buildPreferenceInsights(
  signals: PreferenceSignal[]
): PreferenceInsight[] {
  const groups = new Map<string, PreferenceSignal[]>();

  for (const signal of signals) {
    const key = preferenceInsightKey(signal);
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  return [...groups.entries()]
    .map(([key, group], index): PreferenceInsight => {
      const evidenceMessageIndexes = [
        ...new Set(group.flatMap((signal) => signal.evidenceMessageIndexes))
      ].sort((a, b) => a - b);
      const confidence = Math.max(...group.map((signal) => signal.confidence));
      const reinforced = group.some((signal) => signal.reinforced);

      return {
        id: `pref_insight_${index + 1}`,
        title: preferenceInsightTitle(key, group),
        description: preferenceInsightDescription(key, group, reinforced),
        confidence,
        evidenceMessageIndexes,
        sourceSignals: group
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function preferenceInsightKey(signal: PreferenceSignal): string {
  if (signal.category === "avoidance") {
    return `avoidance:${avoidanceSubject(signal.description)}`;
  }
  return `${signal.category}:${signal.normalizedLabel}`;
}

function preferenceInsightTitle(
  key: string,
  signals: PreferenceSignal[]
): string {
  const [category, subject] = key.split(":");

  if (category === "format") {
    return "구조화된 산출물 형식을 선호함";
  }
  if (category === "specificity_depth") {
    return "바로 구현 가능한 수준의 구체성을 선호함";
  }
  if (category === "avoidance") {
    return `${avoidanceSubjectLabel(subject)} 제외 또는 후순위 선호`;
  }
  if (category === "length") {
    return subject === "detailed" ? "충분히 자세한 답변을 선호함" : "짧고 압축된 답변을 선호함";
  }
  if (category === "tone") {
    return "답변 톤에 대한 선호 신호";
  }
  if (category === "language_expression") {
    return "언어와 표현 방식에 대한 선호 신호";
  }

  return signals[0]?.normalizedLabel ?? "선호 신호";
}

function preferenceInsightDescription(
  key: string,
  signals: PreferenceSignal[],
  reinforced: boolean
): string {
  const [category, subject] = key.split(":");
  const evidenceCount = [
    ...new Set(signals.flatMap((signal) => signal.evidenceMessageIndexes))
  ].length;
  const strength = reinforced || evidenceCount >= 2 ? "반복적으로" : "한 번";

  if (category === "format") {
    return `사용자는 ${strength} 문서, 파일, 표, 스키마처럼 형태가 잡힌 결과물을 요구했습니다. 단순 설명보다 구조화된 산출물을 보고 판단하려는 경향이 강합니다.`;
  }
  if (category === "specificity_depth") {
    return `사용자는 ${strength} 추상적인 방향보다 바로 적용하거나 구현할 수 있는 세부 규칙과 기준을 요구했습니다.`;
  }
  if (category === "avoidance") {
    return `사용자는 ${strength} ${avoidanceSubjectLabel(subject)} 항목을 현재 범위에서 제외하거나 후순위로 두려는 신호를 보였습니다.`;
  }
  if (category === "length") {
    return subject === "detailed"
      ? `사용자는 ${strength} 빠진 내용 없이 충분히 자세한 설명을 요구했습니다.`
      : `사용자는 ${strength} 핵심만 압축한 짧은 답변을 요구했습니다.`;
  }
  if (category === "tone") {
    return `사용자는 답변의 말투나 태도에 대한 조건을 언급했습니다. 다만 confidence가 낮으면 예시 문장 안에서 잡힌 신호일 수 있습니다.`;
  }
  if (category === "language_expression") {
    return `사용자는 언어, 표현, 문장 방식에 대한 조건을 언급했습니다. 낮은 confidence 항목은 원문 확인이 필요합니다.`;
  }

  return signals[0]?.description ?? "선호 신호를 원문 근거와 함께 확인하세요.";
}

function avoidanceSubject(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.includes("pdf")) {
    return "pdf";
  }
  if (normalized.includes("rag") || normalized.includes("ask")) {
    return "ask_or_rag";
  }
  if (normalized.includes("timeline") || normalized.includes("타임라인")) {
    return "timeline";
  }
  if (normalized.includes("thought") || normalized.includes("reasoning")) {
    return "internal_reasoning";
  }
  if (normalized.includes("기술") || normalized.includes("개발")) {
    return "technical_details";
  }
  return "general";
}

function avoidanceSubjectLabel(subject?: string): string {
  switch (subject) {
    case "pdf":
      return "PDF 업로드";
    case "ask_or_rag":
      return "Ask/RAG";
    case "timeline":
      return "Timeline";
    case "internal_reasoning":
      return "내부 reasoning 로그";
    case "technical_details":
      return "기술 구현 세부사항";
    default:
      return "특정 범위";
  }
}

function buildReviewItems(
  result: MockStructureResult,
  evidenceByMessage: EvidenceMap
): ReviewItem[] {
  const items = [
    ...result.board.decisions.map((item) =>
      reviewItem("Decision", item.title, item, result, evidenceByMessage)
    ),
    ...result.board.openQuestions.map((item) =>
      reviewItem("Open Question", item.question, item, result, evidenceByMessage)
    ),
    ...result.board.actions.map((item) =>
      reviewItem("Action", item.title, item, result, evidenceByMessage)
    ),
    ...result.preferenceSignals.map((item) =>
      reviewItem("Preference", item.normalizedLabel, item, result, evidenceByMessage)
    ),
    ...result.contentConstraints.map((item) =>
      reviewItem("Content Constraint", item.title, item, result, evidenceByMessage)
    ),
    ...result.satisfactionSignals.map((item) =>
      reviewItem("Satisfaction", item.status, item, result, evidenceByMessage)
    ),
    ...result.topicFlow.map((item) =>
      reviewItem("Topic", item.label, item, result, evidenceByMessage)
    )
  ];

  return items
    .filter((item) => item.reason !== "low_confidence" || item.confidence < 0.75)
    .sort((a, b) => a.confidence - b.confidence);
}

function reviewItem(
  type: string,
  label: string,
  item: {
    id: string;
    confidence: number;
    evidenceMessageIndexes: number[];
    reviewRequired?: boolean;
    reviewRequiredReason?: ReviewRequiredReason;
  },
  result: MockStructureResult,
  evidenceByMessage: EvidenceMap
): ReviewItem {
  const reason = reviewReasonFor(item, result, evidenceByMessage);

  return {
    id: `${type}-${item.id}`,
    type,
    label,
    confidence: item.confidence,
    reason,
    evidenceMessageIndexes: item.evidenceMessageIndexes
  };
}

function reviewReasonFor(
  item: {
    confidence: number;
    evidenceMessageIndexes: number[];
    reviewRequired?: boolean;
    reviewRequiredReason?: ReviewRequiredReason;
  },
  result: MockStructureResult,
  evidenceByMessage: EvidenceMap
): ReviewItem["reason"] {
  if (item.reviewRequired && item.reviewRequiredReason) {
    return item.reviewRequiredReason;
  }
  if (item.evidenceMessageIndexes.length === 0) {
    return "weak_evidence";
  }
  if (
    result.diagnostics.warnings.some(
      (warning) =>
        warning.code === "EXAMPLE_TEXT_DETECTED" &&
        warning.messageIndexes?.some((index) =>
          item.evidenceMessageIndexes.includes(index)
        )
    )
  ) {
    return "example_like";
  }
  if (item.confidence <= 0.35) {
    return "very_low_confidence";
  }
  if (!hasEvidenceQuote(item.evidenceMessageIndexes, evidenceByMessage)) {
    return "missing_quote";
  }
  return "low_confidence";
}

function hasEvidenceQuote(
  evidenceMessageIndexes: number[],
  evidenceByMessage: EvidenceMap
): boolean {
  return evidenceMessageIndexes.some((messageIndex) =>
    (evidenceByMessage.get(messageIndex) ?? []).some((evidence) =>
      evidence.quote?.trim()
    )
  );
}

function Section({
  title,
  children,
  tone = "default"
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <section
      style={{
        border: `1px solid ${tone === "warning" ? "#facc15" : "#d4d4d4"}`,
        borderRadius: 8,
        padding: 16,
        background: tone === "warning" ? "#fffbeb" : "#fff"
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: BadgeTone;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        padding: 12,
        background: "#fff"
      }}
    >
      <p style={{ margin: "0 0 6px", color: "#737373", fontSize: 12 }}>{label}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 22 }}>{value}</strong>
        <Badge tone={tone}>{toneLabel(tone)}</Badge>
      </div>
    </div>
  );
}

function Group({
  title,
  empty,
  children
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{title}</h3>
      {empty ? (
        <EmptyState text="표시할 항목이 없습니다." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>{children}</div>
      )}
    </section>
  );
}

function DecisionCard({
  item,
  evidenceByMessage
}: {
  item: DecisionItem;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={item.title}
      description={item.description}
      triggerPhrase={item.triggerPhrase}
      badges={[item.status, item.source]}
      confidence={item.confidence}
      evidenceMessageIndexes={item.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
    />
  );
}

function OpenQuestionCard({
  item,
  evidenceByMessage
}: {
  item: OpenQuestionItem;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={item.question}
      description={item.description}
      triggerPhrase={item.triggerPhrase}
      badges={[
        item.status,
        item.resolvedBy ? resolvedByLabel(item.resolvedBy) : "unresolved"
      ]}
      confidence={item.confidence}
      evidenceMessageIndexes={item.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
    />
  );
}

function resolvedByLabel(resolvedBy: OpenQuestionItem["resolvedBy"]): string {
  if (!resolvedBy) {
    return "unresolved";
  }
  if (resolvedBy.type === "assistant_answer") {
    return `answered by #${resolvedBy.messageIndex}`;
  }
  if (resolvedBy.type === "user_decision") {
    return `resolved by ${resolvedBy.decisionId}`;
  }
  return `superseded by ${resolvedBy.decisionId}`;
}

function ActionCard({
  item,
  evidenceByMessage
}: {
  item: ActionItem;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={item.title}
      description={item.description}
      triggerPhrase={item.triggerPhrase}
      badges={[item.actionType, item.status, item.assignee]}
      confidence={item.confidence}
      evidenceMessageIndexes={item.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
    />
  );
}

function TopicCard({
  topic,
  evidenceByMessage
}: {
  topic: TopicFlowItem;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={`${topic.order}. ${topic.label}`}
      description={topic.summary}
      badges={[`#${topic.startMessageIndex}-#${topic.endMessageIndex}`, topic.changeReason]}
      confidence={topic.confidence}
      evidenceMessageIndexes={topic.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
      footer={
        [
          topic.mergedMessageIndexes?.length
            ? `merged #${topic.mergedMessageIndexes.join(", #")}`
            : null,
          topic.contextSummary
            ? `${topic.contextSummary.sourceBacked ? "source-backed" : "no source backing"} · ${topic.contextSummary.signalCount} context signals`
            : null
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
    />
  );
}

function PreferenceCard({
  item,
  evidenceByMessage
}: {
  item: PreferenceSignal;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={item.normalizedLabel}
      description={item.description}
      triggerPhrase={item.triggerPhrase}
      badges={[item.category, item.polarity, item.reinforced ? "reinforced" : "single signal"]}
      confidence={item.confidence}
      evidenceMessageIndexes={item.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
      compact
    />
  );
}

function ContentConstraintCard({
  item,
  evidenceByMessage
}: {
  item: ContentConstraint;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={item.title}
      description={item.description}
      triggerPhrase={item.triggerPhrase}
      badges={[
        item.constraintType,
        item.reviewRequired ? item.reviewRequiredReason ?? "review" : "main"
      ]}
      confidence={item.confidence}
      evidenceMessageIndexes={item.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
      compact
    />
  );
}

function SatisfactionCard({
  item,
  evidenceByMessage
}: {
  item: SatisfactionSignal;
  evidenceByMessage: EvidenceMap;
}) {
  return (
    <InsightCard
      title={item.status}
      description={item.rationale}
      badges={[
        `assistant #${item.assistantMessageIndex}`,
        item.userReactionMessageIndex == null
          ? "no user reaction"
          : `user #${item.userReactionMessageIndex}`
      ]}
      confidence={item.confidence}
      evidenceMessageIndexes={item.evidenceMessageIndexes}
      evidenceByMessage={evidenceByMessage}
      compact
    />
  );
}

function InsightCard({
  title,
  description,
  triggerPhrase,
  badges,
  confidence,
  evidenceMessageIndexes,
  evidenceByMessage,
  footer,
  compact = false
}: {
  title: string;
  description: string;
  triggerPhrase?: string;
  badges: string[];
  confidence: number;
  evidenceMessageIndexes: number[];
  evidenceByMessage: EvidenceMap;
  footer?: string;
  compact?: boolean;
}) {
  return (
    <article
      style={{
        border: "1px solid #e5e5e5",
        borderLeft: `4px solid ${confidenceColor(confidence)}`,
        borderRadius: 8,
        padding: compact ? 12 : 14,
        background: "#fff"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start"
        }}
      >
        <h4 style={{ margin: 0, fontSize: compact ? 14 : 16, lineHeight: 1.35 }}>
          {title}
        </h4>
        <Badge tone={confidenceTone(confidence)}>{formatConfidence(confidence)}</Badge>
      </div>
      {description ? (
        <p style={{ margin: "8px 0 0", color: "#404040", lineHeight: 1.55 }}>
          {description}
        </p>
      ) : null}
      {triggerPhrase ? (
        <p
          style={{
            margin: "8px 0 0",
            color: "#171717",
            fontSize: 13,
            lineHeight: 1.45
          }}
        >
          <strong>Trigger:</strong> {triggerPhrase}
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {badges.map((badge) => (
          <Badge key={badge} tone="neutral">
            {badge}
          </Badge>
        ))}
      </div>
      <EvidenceBlock
        evidenceMessageIndexes={evidenceMessageIndexes}
        evidenceByMessage={evidenceByMessage}
      />
      {footer ? (
        <p style={{ margin: "8px 0 0", color: "#737373", fontSize: 13 }}>{footer}</p>
      ) : null}
    </article>
  );
}

function EvidenceBlock({
  evidenceMessageIndexes,
  evidenceByMessage
}: {
  evidenceMessageIndexes: number[];
  evidenceByMessage: EvidenceMap;
}) {
  const quotes = evidenceMessageIndexes.flatMap((messageIndex) =>
    (evidenceByMessage.get(messageIndex) ?? [])
      .filter((evidence) => evidence.quote)
      .map((evidence) => ({
        messageIndex,
        quote: evidence.quote as string,
        sourceType: evidence.sourceType,
        evidenceStrength: evidence.evidenceStrength
      }))
  );

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
      <p style={{ margin: "0 0 6px", color: "#737373", fontSize: 13 }}>
        Evidence{" "}
        {evidenceMessageIndexes.length > 0
          ? evidenceMessageIndexes.map((index) => `#${index}`).join(", ")
          : "none"}
      </p>
      {quotes.length > 0 ? (
        quotes.slice(0, 2).map((item) => (
          <div
            key={`${item.messageIndex}-${item.quote}`}
            style={{
              marginTop: 6,
              padding: "8px 10px",
              borderLeft: "3px solid #d4d4d4",
              background: "#fafafa"
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              <Badge tone="neutral">#{item.messageIndex}</Badge>
              <Badge tone="neutral">{item.sourceType}</Badge>
              <Badge tone="neutral">{item.evidenceStrength}</Badge>
            </div>
            <blockquote
              style={{
                margin: 0,
                color: "#404040",
                fontSize: 13,
                lineHeight: 1.5
              }}
            >
              {item.quote}
            </blockquote>
          </div>
        ))
      ) : (
        <p style={{ margin: 0, color: "#a16207", fontSize: 13 }}>
          근거 메시지는 연결됐지만 캡처된 quote가 없습니다.
        </p>
      )}
    </div>
  );
}

function ReviewRow({ item }: { item: ReviewItem }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",
        borderTop: "1px solid #fde68a",
        paddingTop: 8
      }}
    >
      <div>
        <p style={{ margin: 0, lineHeight: 1.45 }}>
          <strong>{item.type}</strong> · {item.label}
        </p>
        <p style={{ margin: "3px 0 0", color: "#78716c", fontSize: 13 }}>
          {reviewReasonLabel(item.reason)} · evidence{" "}
          {item.evidenceMessageIndexes.length > 0
            ? item.evidenceMessageIndexes.map((index) => `#${index}`).join(", ")
            : "none"}
        </p>
      </div>
      <Badge tone={confidenceTone(item.confidence)}>
        {formatConfidence(item.confidence)}
      </Badge>
    </div>
  );
}

function reviewReasonLabel(reason: ReviewItem["reason"]): string {
  switch (reason) {
    case "very_low_confidence":
      return "매우 낮은 신뢰도";
    case "example_like":
      return "예시/문서 문장 기반 가능성";
    case "missing_quote":
      return "근거 quote 누락";
    case "weak_evidence":
      return "직접 근거 부족";
    case "assistant_suggestion":
      return "assistant 제안";
    case "candidate_decision":
      return "후보 decision";
    case "example_derived":
      return "예시 기반 항목";
    case "multi_status_satisfaction":
      return "복수 satisfaction 충돌";
    case "context_signal_only":
      return "context signal 단독 근거";
    case "low_confidence":
      return "낮은 신뢰도";
  }
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ margin: 0, lineHeight: 1.5 }}>
      <strong>{label}: </strong>
      <span>{value}</span>
    </p>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p style={{ margin: 0, color: "#777", lineHeight: 1.5 }}>{text}</p>;
}

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
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
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: "2px 8px",
        background: colors.background,
        color: colors.color,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}

function confidenceTone(confidence: number): BadgeTone {
  if (confidence >= 0.78) {
    return "good";
  }
  if (confidence >= 0.55) {
    return "warning";
  }
  return "danger";
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.78) {
    return "#12b76a";
  }
  if (confidence >= 0.55) {
    return "#f79009";
  }
  return "#f04438";
}

function toneLabel(tone: BadgeTone): string {
  if (tone === "good") {
    return "ok";
  }
  if (tone === "warning") {
    return "check";
  }
  if (tone === "danger") {
    return "risk";
  }
  return "info";
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatSignalCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([type, count]) => `${type} ${count}`).join(", ");
}

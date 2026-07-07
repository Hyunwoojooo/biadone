"use client";

import { useEffect, useState } from "react";

import type { MockStructureResult } from "@/core/types/structures";

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

export function StructureResultViewer({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<StructureResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <section style={{ marginBottom: 40 }}>
      <header style={{ marginBottom: 20 }}>
        <h1>Structure Result</h1>
        <p style={{ color: "#555", lineHeight: 1.6 }}>
          {result.overview.resolutionSummary}
        </p>
        <p style={{ color: "#777", fontSize: 14 }}>
          {result.extractor.name} {result.extractor.version} · confidence{" "}
          {formatConfidence(result.overview.confidence)}
        </p>
      </header>

      <div style={{ display: "grid", gap: 16 }}>
        <Section title="Overview">
          <KeyValue label="Title" value={result.overview.title} />
          <KeyValue label="Main subject" value={result.overview.mainSubject} />
          <KeyValue label="Core intent" value={result.overview.userCoreIntent} />
          <KeyValue label="Status" value={result.overview.currentStatus} />
          <KeyValue
            label="Satisfaction"
            value={result.overview.satisfactionSummary}
          />
          <KeyValue
            label="Context signals"
            value={`${result.diagnostics.contextSignalCount} total · ${result.diagnostics.sourceBackedTopicCount} source-backed topics`}
          />
        </Section>

        <Section title={`Board`}>
          <Column title="Decisions" empty={result.board.decisions.length === 0}>
            {result.board.decisions.map((item) => (
              <ResultItem
                key={item.id}
                title={item.title}
                meta={`${item.status} · ${formatConfidence(item.confidence)}`}
                evidence={item.evidenceMessageIndexes}
              />
            ))}
          </Column>
          <Column
            title="Open Questions"
            empty={result.board.openQuestions.length === 0}
          >
            {result.board.openQuestions.map((item) => (
              <ResultItem
                key={item.id}
                title={item.question}
                meta={`${item.status} · ${formatConfidence(item.confidence)}`}
                evidence={item.evidenceMessageIndexes}
              />
            ))}
          </Column>
          <Column title="Actions" empty={result.board.actions.length === 0}>
            {result.board.actions.map((item) => (
              <ResultItem
                key={item.id}
                title={item.title}
                meta={`${item.actionType} · ${item.status} · ${formatConfidence(
                  item.confidence
                )}`}
                evidence={item.evidenceMessageIndexes}
              />
            ))}
          </Column>
        </Section>

        <Section title="Preference Signals">
          {result.preferenceSignals.length === 0 ? (
            <p style={{ color: "#777" }}>추출된 선호 신호가 없습니다.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {result.preferenceSignals.map((item) => (
                <ResultItem
                  key={item.id}
                  title={item.normalizedLabel}
                  meta={`${item.category} · ${item.polarity} · ${
                    item.reinforced ? "reinforced · " : ""
                  }${formatConfidence(item.confidence)}`}
                  evidence={item.evidenceMessageIndexes}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Satisfaction Signals">
          {result.satisfactionSignals.length === 0 ? (
            <p style={{ color: "#777" }}>평가할 assistant-user pair가 없습니다.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {result.satisfactionSignals.slice(0, 12).map((item) => (
                <ResultItem
                  key={item.id}
                  title={item.status}
                  meta={`${item.rationale} · ${formatConfidence(item.confidence)}`}
                  evidence={item.evidenceMessageIndexes}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Topic Flow">
          {result.topicFlow.length === 0 ? (
            <p style={{ color: "#777" }}>생성된 topic flow가 없습니다.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.6 }}>
              {result.topicFlow.map((topic) => (
                <li key={topic.id}>
                  <strong>{topic.label}</strong>{" "}
                  <span style={{ color: "#666" }}>
                    #{topic.startMessageIndex}-#{topic.endMessageIndex} ·{" "}
                    {topic.changeReason}
                    {topic.contextSummary
                      ? ` · ${topic.contextSummary.externalResearch ? "research-backed" : "context"} · ${topic.contextSummary.signalCount} signals`
                      : ""}
                  </span>
                  {topic.contextSummary ? (
                    <div style={{ color: "#777", fontSize: 13 }}>
                      {topic.contextSummary.sourceBacked ? "source-backed" : "no source backing"} ·{" "}
                      {topic.contextSummary.signalTypes.join(", ")}
                      {topic.contextSummary.citationCount > 0
                        ? ` · citations ${topic.contextSummary.citationCount}`
                        : ""}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Diagnostics">
          <KeyValue
            label="Context signal types"
            value={formatSignalCounts(result.diagnostics.contextSignalTypeCounts)}
          />
          <KeyValue
            label="Excluded internal"
            value={String(result.diagnostics.excludedInternalCount)}
          />
          <KeyValue
            label="Warnings"
            value={String(result.diagnostics.warnings.length)}
          />
        </Section>
      </div>
    </section>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid #d4d4d4",
        borderRadius: 8,
        padding: 16,
        background: "#fff"
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function Column({
  title,
  empty,
  children
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8, fontSize: 15 }}>{title}</h3>
      {empty ? <p style={{ color: "#777" }}>없음</p> : <div>{children}</div>}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ margin: "8px 0", lineHeight: 1.5 }}>
      <strong>{label}: </strong>
      <span>{value}</span>
    </p>
  );
}

function ResultItem({
  title,
  meta,
  evidence
}: {
  title: string;
  meta: string;
  evidence: number[];
}) {
  return (
    <article
      style={{
        borderTop: "1px solid #ececec",
        paddingTop: 10,
        marginTop: 10
      }}
    >
      <p style={{ margin: 0, lineHeight: 1.45 }}>{title}</p>
      <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
        {meta} · evidence {evidence.map((index) => `#${index}`).join(", ")}
      </p>
    </article>
  );
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

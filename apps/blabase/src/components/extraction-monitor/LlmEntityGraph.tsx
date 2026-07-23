"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Search,
  ShieldAlert,
  Sparkles,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

import type {
  EvidenceEvaluatedItem,
  EvidenceMatch,
  HybridExtractionResult,
  SemanticItemType
} from "@/core/types/semantic";

import styles from "./LlmEntityGraph.module.css";
import {
  buildLlmEntityGraph,
  type LlmEntityGraphEdge,
  type LlmEntityGraphNode,
  type LlmEntityGraphRelation
} from "./llmEntityGraphModel";
import { turnIdForMessageIndex, type MonitorTurn } from "./monitorModel";

type GraphFilter = "all" | "verified" | "review_required";
const MAX_RENDERED_EDGES = 32;

const TYPE_LABELS: Record<SemanticItemType, string> = {
  intent: "Intent",
  topic: "Topic",
  decision: "Decision",
  open_question: "Open question",
  action: "Action",
  preference: "Preference",
  content_constraint: "Constraint",
  problem_signal: "Problem signal",
  satisfaction: "Satisfaction",
  change_event: "Change event",
  entity: "Entity",
  relation: "Relation"
};

const TYPE_COLORS: Record<SemanticItemType, string> = {
  intent: "#a78bfa",
  topic: "#7dd3fc",
  decision: "#fbbf24",
  open_question: "#fb7185",
  action: "#34d399",
  preference: "#f472b6",
  content_constraint: "#fb923c",
  problem_signal: "#f87171",
  satisfaction: "#2dd4bf",
  change_event: "#60a5fa",
  entity: "#c084fc",
  relation: "#94a3b8"
};

const RELATION_LABELS: Record<LlmEntityGraphRelation, string> = {
  core_layout: "중심 배치선 · 휴리스틱",
  shared_evidence: "공통 Evidence index",
  same_turn: "같은 대화 Turn"
};

export function LlmEntityGraph({
  analysisId,
  title,
  turns,
  sprint5,
  onOpenTurn
}: {
  analysisId: string;
  title: string | null;
  turns: MonitorTurn[];
  sprint5: HybridExtractionResult | null;
  onOpenTurn?: (turnId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GraphFilter>("all");
  const graph = useMemo(
    () =>
      buildLlmEntityGraph(turns, sprint5, {
        query,
        verificationStatus: filter
      }),
    [filter, query, sprint5, turns]
  );
  const [selectedId, setSelectedId] = useState<string | null>(graph.coreNodeId);

  useEffect(() => {
    if (!graph.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(graph.coreNodeId);
    }
  }, [graph.coreNodeId, graph.nodes, selectedId]);

  const visibleNodes = graph.nodes;
  const visibleEdges = graph.edges;
  const selected =
    visibleNodes.find((node) => node.id === selectedId) ??
    visibleNodes.find((node) => node.isCore) ??
    visibleNodes[0] ??
    null;
  const selectedEdges = selected
    ? visibleEdges.filter(
        (edge) => edge.from === selected.id || edge.to === selected.id
      )
    : [];
  const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
  const renderedEdges = [
    ...selectedEdges,
    ...visibleEdges
      .filter((edge) => !selectedEdgeIds.has(edge.id))
      .sort((left, right) => right.strength - left.strength)
  ].slice(0, MAX_RENDERED_EDGES);
  const omittedEdgeCount = Math.max(
    0,
    visibleEdges.length - renderedEdges.length
  );
  const related = selectedEdges
    .map((edge) => ({
      edge,
      node: visibleNodes.find(
        (node) => node.id === (edge.from === selected?.id ? edge.to : edge.from)
      )
    }))
    .filter(
      (
        entry
      ): entry is {
        edge: LlmEntityGraphEdge;
        node: LlmEntityGraphNode;
      } => Boolean(entry.node)
    );
  const highlightedIds = new Set(
    selectedEdges.flatMap((edge) => [edge.from, edge.to])
  );
  const selectedEvaluations = selected
    ? evaluatedItems(sprint5).filter((item) =>
        selected.itemIds.includes(item.id)
      )
    : [];
  const evidenceMatches = uniqueEvidenceMatches(selectedEvaluations);
  const evidenceTurnIds = [
    ...new Set(
      evidenceMatches
        .map((match) => turnIdForMessageIndex(turns, match.messageIndex))
        .filter((turnId): turnId is number => turnId !== null)
    )
  ];
  const issueCodes = [
    ...new Set(
      selectedEvaluations.flatMap((item) =>
        item.evidenceVerification.issues.map((issue) => issue.code)
      )
    )
  ];
  const llmStatus = sprint5?.llmResult.status ?? "disabled";

  return (
    <section className={styles.entityGraph} aria-label="LLM Entity Graph">
      <header className={styles.graphHeader}>
        <div className={styles.graphIdentity}>
          <span>LLM SEMANTIC / EVIDENCE GRAPH</span>
          <h1>{title || "Untitled ChatGPT conversation"}</h1>
          <p>
            LLM 후보 중 검증·리뷰 항목만 표시합니다. 중앙은 유형, 신뢰도, 근거
            범위를 기준으로 자동 선정됩니다.
          </p>
        </div>

        <div className={styles.runSummary}>
          <div className={styles.runStatus} data-status={llmStatus}>
            <span />
            {llmStatus.toUpperCase()}
          </div>
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>{sprint5?.llmResult.provider ?? "—"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd title={sprint5?.llmResult.model ?? undefined}>
                {sprint5?.llmResult.model ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Coverage</dt>
              <dd>
                {sprint5
                  ? `${sprint5.llmResult.coverage.analyzedMessageCount}/${sprint5.llmResult.coverage.cleanMessageCount}`
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className={styles.graphControls}>
          <label className={styles.searchBox}>
            <Search size={14} />
            <span className={styles.srOnly}>LLM 항목 검색</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="키워드, 설명, 유형 검색"
            />
            {query ? (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            ) : null}
          </label>
          <div
            className={styles.filters}
            aria-label="검증 상태 필터"
            role="group"
          >
            {(
              [
                ["all", "All"],
                ["verified", "Verified"],
                ["review_required", "Review"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? styles.filterActive : ""}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={styles.graphWorkspace}>
        <div className={styles.canvas}>
          {visibleNodes.length > 0 ? (
            <GraphCanvas
              nodes={visibleNodes}
              edges={renderedEdges}
              selected={selected}
              highlightedIds={highlightedIds}
              onSelect={setSelectedId}
            />
          ) : (
            <GraphEmptyState
              status={llmStatus}
              message={sprint5?.llmResult.error?.message}
            />
          )}

          <div className={styles.statsBar} aria-label="LLM 후보 검증 통계">
            <Stat label="Candidates" value={graph.stats.candidateCount} />
            <Stat
              label="Verified"
              value={graph.stats.verifiedCount}
              tone="verified"
            />
            <Stat
              label="Review"
              value={graph.stats.reviewCount}
              tone="review"
            />
            <Stat
              label="Rejected"
              value={graph.stats.rejectedCount}
              tone="rejected"
            />
            <Stat
              label="Graph nodes"
              value={`${graph.stats.displayedNodeCount}/${graph.stats.uniqueNodeCount}`}
            />
          </div>

          <div className={styles.noticeStack}>
            {query || filter !== "all" ? (
              <div className={styles.filterNote}>
                {graph.stats.matchingNodeCount}개 일치 · 중앙 노드는 고정
              </div>
            ) : null}
            {graph.stats.omittedNodeCount > 0 ? (
              <div className={styles.omissionNote}>
                그래프 {graph.stats.displayedNodeCount}개(중앙 포함) · 일치 후보{" "}
                {graph.stats.omittedNodeCount}개 생략
              </div>
            ) : null}
            {omittedEdgeCount > 0 ? (
              <div className={styles.edgeOmissionNote}>
                화면 선 {renderedEdges.length}/{visibleEdges.length} · 선택 항목
                연결은 모두 유지
              </div>
            ) : null}
            {graph.stats.rejectedCount > 0 ? (
              <div className={styles.exclusionNote}>
                <ShieldAlert size={13} />
                Rejected {graph.stats.rejectedCount}개는 그래프에서 제외됨
              </div>
            ) : null}
          </div>

          <div className={styles.edgeLegend}>
            <span>
              <i data-relation="core" /> 중심 배치선
            </span>
            <span>
              <i data-relation="evidence" /> 공통 Evidence index
            </span>
            <span>
              <i data-relation="turn" /> 같은 Turn
            </span>
          </div>
        </div>

        <aside className={styles.detailPanel}>
          {selected ? (
            <>
              <span className={styles.panelEyebrow}>
                {selected.isCore ? "CENTRAL KEYWORD" : "SELECTED LLM ITEM"}
              </span>
              <div className={styles.selectedTitle}>
                <i style={{ background: TYPE_COLORS[selected.type] }} />
                <div>
                  <h2>{selected.label}</h2>
                  <span>{TYPE_LABELS[selected.type]}</span>
                </div>
              </div>

              <div className={styles.qualityRow}>
                <span data-status={selected.verificationStatus}>
                  {selected.verificationStatus === "verified" ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <ShieldAlert size={13} />
                  )}
                  {verificationLabel(selected.verificationStatus)}
                </span>
                <strong>{Math.round(selected.confidence * 100)}%</strong>
              </div>

              <p className={styles.description}>
                {selected.description || "설명 없음"}
              </p>

              {selected.isCore ? (
                <div className={styles.coreExplanation}>
                  <Sparkles size={14} />
                  <p>
                    이 항목은 LLM이 별도 지정한 중심어가 아니라, 의미 유형과
                    신뢰도·근거·연결도를 조합해 모니터가 선택한 중심 후보입니다.
                  </p>
                </div>
              ) : null}

              <DetailSection title="LLM OUTPUT">
                <div className={styles.triggerCard}>
                  <span>TRIGGER PHRASE</span>
                  <p>
                    {selected.triggerPhrase || "기록된 trigger phrase 없음"}
                  </p>
                  <span className={styles.candidateRefs}>
                    LLM CANDIDATE REFS{" "}
                    {formatIndexes(selected.evidenceMessageIndexes)}
                  </span>
                  {selected.turnIds.length > 0 && onOpenTurn ? (
                    <div className={styles.turnLinks}>
                      {selected.turnIds.slice(0, 3).map((turnId) => (
                        <button
                          key={turnId}
                          type="button"
                          onClick={() => onOpenTurn(turnId)}
                        >
                          Candidate Turn {turnId} <ArrowRight size={12} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </DetailSection>

              <DetailSection title="SOURCE EVIDENCE">
                <div className={styles.evidenceCard}>
                  {evidenceMatches.length > 0 ? (
                    evidenceMatches.slice(0, 3).map((match) => (
                      <blockquote key={`${match.messageIndex}:${match.quote}`}>
                        <span>
                          MESSAGE #{match.messageIndex} ·{" "}
                          {match.supportType.replace("_", " ")} ·{" "}
                          {match.verificationStatus.replace("_", " ")}
                        </span>
                        <p>“{match.quote}”</p>
                      </blockquote>
                    ))
                  ) : (
                    <p className={styles.noEvidenceQuote}>
                      Evidence Verifier가 기록한 원문 인용이 없습니다. 위 LLM
                      trigger를 원문 근거로 간주하지 마세요.
                    </p>
                  )}
                  {evidenceTurnIds.length > 0 && onOpenTurn ? (
                    <div className={styles.turnLinks}>
                      {evidenceTurnIds.slice(0, 3).map((turnId) => (
                        <button
                          key={turnId}
                          type="button"
                          onClick={() => onOpenTurn(turnId)}
                        >
                          Evidence Turn {turnId} <ArrowRight size={12} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </DetailSection>

              {issueCodes.length > 0 ? (
                <DetailSection title="REVIEW SIGNALS">
                  <div className={styles.issueList}>
                    {issueCodes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                </DetailSection>
              ) : null}

              <DetailSection title={`VIEW LINKS · ${related.length}`}>
                <div className={styles.relatedList}>
                  {related.length > 0 ? (
                    related.map(({ edge, node }) => (
                      <button
                        key={edge.id}
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                      >
                        <span>
                          <i style={{ background: TYPE_COLORS[node.type] }} />
                          <strong>{node.label}</strong>
                          <small>{RELATION_LABELS[edge.relation]}</small>
                        </span>
                        <ArrowRight size={12} />
                      </button>
                    ))
                  ) : (
                    <p className={styles.emptyDetail}>
                      표시 중인 직접 연결 없음
                    </p>
                  )}
                </div>
              </DetailSection>

              <footer className={styles.detailFooter}>
                <span>{selected.itemIds.length} source item</span>
                <span>{analysisId.slice(0, 12)}</span>
              </footer>
            </>
          ) : (
            <div className={styles.emptyDetail}>항목을 선택하세요.</div>
          )}
        </aside>
      </div>
    </section>
  );
}

function GraphCanvas({
  nodes,
  edges,
  selected,
  highlightedIds,
  onSelect
}: {
  nodes: LlmEntityGraphNode[];
  edges: LlmEntityGraphEdge[];
  selected: LlmEntityGraphNode | null;
  highlightedIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        className={styles.graphLines}
      >
        {edges.map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;
          const emphasized =
            edge.from === selected?.id || edge.to === selected?.id;
          return (
            <line
              key={edge.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={edgeColor(edge.relation, emphasized)}
              strokeWidth={emphasized ? 0.38 : edgeWidth(edge.relation)}
              strokeDasharray={
                edge.relation === "same_turn" ? "1.1 1.1" : undefined
              }
              opacity={emphasized ? 0.95 : 0.52}
            />
          );
        })}
      </svg>

      {nodes.map((node) => {
        const active = node.id === selected?.id;
        const related = highlightedIds.has(node.id);
        const nodeStyle = {
          "--node-color": TYPE_COLORS[node.type],
          left: `${node.x}%`,
          top: `${node.y}%`
        } as CSSProperties;
        return (
          <button
            key={node.id}
            type="button"
            className={`${styles.graphNode} ${
              node.isCore ? styles.coreNode : ""
            } ${active ? styles.nodeActive : ""} ${
              selected && !active && !related ? styles.nodeMuted : ""
            }`}
            style={nodeStyle}
            onClick={() => onSelect(node.id)}
            aria-pressed={active}
            aria-label={`${node.isCore ? "중앙 핵심어, " : ""}${node.label}, ${
              TYPE_LABELS[node.type]
            }, ${verificationLabel(node.verificationStatus)}`}
          >
            {node.isCore ? <span className={styles.coreTag}>CORE</span> : null}
            <i />
            <strong>{node.label}</strong>
            <small>
              {TYPE_LABELS[node.type]} · {Math.round(node.confidence * 100)}%
            </small>
            <span
              className={styles.nodeStatus}
              data-status={node.verificationStatus}
            >
              {node.verificationStatus === "verified" ? "V" : "R"}
            </span>
          </button>
        );
      })}
    </>
  );
}

function Stat({
  label,
  value,
  tone
}: {
  label: string;
  value: ReactNode;
  tone?: "verified" | "review" | "rejected";
}) {
  return (
    <div data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailSection({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.detailSection}>
      <span className={styles.panelEyebrow}>{title}</span>
      {children}
    </section>
  );
}

function GraphEmptyState({
  status,
  message
}: {
  status: HybridExtractionResult["llmResult"]["status"];
  message?: string;
}) {
  const copy =
    status === "disabled"
      ? "LLM 분석이 비활성화되어 그래프를 만들 수 없습니다."
      : status === "failed"
        ? "LLM 분석이 실패해 표시할 후보가 없습니다."
        : "검증 또는 리뷰 대상으로 남은 LLM 후보가 없습니다.";

  return (
    <div className={styles.emptyGraph}>
      <CircleDot size={24} />
      <strong>표시할 LLM 항목이 없습니다.</strong>
      <p>{message || copy}</p>
    </div>
  );
}

function evaluatedItems(
  sprint5: HybridExtractionResult | null
): EvidenceEvaluatedItem[] {
  if (!sprint5) return [];
  return [...sprint5.verifiedItems, ...sprint5.reviewQueue];
}

function uniqueEvidenceMatches(
  items: EvidenceEvaluatedItem[]
): EvidenceMatch[] {
  const unique = new Map<string, EvidenceMatch>();
  for (const match of items.flatMap(
    (item) => item.evidenceVerification.matches
  )) {
    const quote = match.quote.trim();
    if (!quote) continue;
    const key = `${match.messageIndex}:${quote}`;
    if (!unique.has(key)) unique.set(key, { ...match, quote });
  }
  return [...unique.values()].sort(
    (left, right) => left.messageIndex - right.messageIndex
  );
}

function verificationLabel(status: LlmEntityGraphNode["verificationStatus"]) {
  return status === "verified" ? "Verified" : "Needs review";
}

function edgeColor(relation: LlmEntityGraphRelation, emphasized: boolean) {
  if (emphasized) return "#c4b5fd";
  if (relation === "shared_evidence") return "#67e8f9";
  if (relation === "same_turn") return "#94a3b8";
  return "#8b9bb1";
}

function edgeWidth(relation: LlmEntityGraphRelation) {
  if (relation === "core_layout") return 0.26;
  if (relation === "shared_evidence") return 0.21;
  return 0.16;
}

function formatIndexes(indexes: number[]) {
  if (indexes.length === 0) return "—";
  return indexes.map((index) => `#${index}`).join(", ");
}

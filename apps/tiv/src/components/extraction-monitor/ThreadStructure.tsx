"use client";

import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  MessageSquare,
  Network,
  Search,
  Sparkles,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type {
  HybridExtractionResult,
  SemanticItemType
} from "@/core/types/semantic";

import type { MonitorTurn } from "./monitorModel";
import styles from "./ThreadStructure.module.css";
import {
  buildThreadStructure,
  type ThreadStructure as ThreadStructureData,
  type StructureFlowItem,
  type StructureNode,
  type StructureTone
} from "./threadStructureModel";

type StructureMode = "connections" | "flow";

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

const TONE_COLORS: Record<StructureTone, string> = {
  violet: "#9e9cff",
  teal: "#55d9ca",
  amber: "#ffc36f",
  rose: "#f38d9b",
  blue: "#77bdfb"
};

export function ThreadStructure({
  analysisId,
  title,
  turns,
  sprint5,
  onOpenTurn,
  standalone = false,
  structureOverride,
  demo = false,
  actionHref
}: {
  analysisId: string;
  title: string | null;
  turns: MonitorTurn[];
  sprint5: HybridExtractionResult | null;
  onOpenTurn?: (turnId: number) => void;
  standalone?: boolean;
  structureOverride?: ThreadStructureData;
  demo?: boolean;
  actionHref?: string;
}) {
  const generatedStructure = useMemo(
    () => buildThreadStructure(turns, sprint5),
    [sprint5, turns]
  );
  const structure = structureOverride ?? generatedStructure;
  const turnCount =
    new Set(structure.flow.map((item) => item.turnId)).size || turns.length;
  const [mode, setMode] = useState<StructureMode>("connections");
  const [selectedId, setSelectedId] = useState<string | null>(
    structure.nodes[0]?.id ?? null
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!structure.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(structure.nodes[0]?.id ?? null);
    }
  }, [selectedId, structure.nodes]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const visibleNodes = structure.nodes.filter((node) =>
    matchesNode(node, normalizedQuery)
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleLinks = structure.links.filter(
    (link) => visibleNodeIds.has(link.from) && visibleNodeIds.has(link.to)
  );
  const selected =
    visibleNodes.find((node) => node.id === selectedId) ??
    visibleNodes[0] ??
    null;
  const selectedLinks = selected
    ? structure.links.filter(
        (link) => link.from === selected.id || link.to === selected.id
      )
    : [];
  const related = selectedLinks
    .map((link) =>
      structure.nodes.find(
        (node) => node.id === (link.from === selected?.id ? link.to : link.from)
      )
    )
    .filter(
      (node): node is StructureNode =>
        Boolean(node) && visibleNodeIds.has(node!.id)
    );
  const visibleFlow = structure.flow.filter((item) =>
    matchesFlow(item, normalizedQuery)
  );

  return (
    <section
      className={`${styles.structure} ${standalone ? styles.standalone : ""}`}
    >
      <aside className={styles.sidebar}>
        <div className={styles.structureBrand}>
          <span className={styles.structureMark}>T</span>
          <span>
            <strong>Thread structure</strong>
            <small>GPT CONVERSATION</small>
          </span>
        </div>

        <div className={styles.sessionCard} title={title ?? analysisId}>
          <div>
            <span>{demo ? "INTERACTIVE DEMO" : "ACTIVE ANALYSIS"}</span>
            <strong>{title || "Untitled conversation"}</strong>
          </div>
          <small>{turnCount} turns</small>
        </div>

        <nav className={styles.modeSwitcher} aria-label="Structure view">
          <button
            type="button"
            className={mode === "connections" ? styles.modeActive : ""}
            onClick={() => setMode("connections")}
          >
            <Network size={15} />
            <span>Connections</span>
            <small>{structure.links.length}</small>
          </button>
          <button
            type="button"
            className={mode === "flow" ? styles.modeActive : ""}
            onClick={() => setMode("flow")}
          >
            <MessageSquare size={15} />
            <span>Flow</span>
            <small>{structure.flow.length}</small>
          </button>
        </nav>

        <div className={styles.sessionStats}>
          <span>THIS SESSION</span>
          <dl>
            <div>
              <dt>Concepts</dt>
              <dd>{structure.nodes.length}</dd>
            </div>
            <div>
              <dt>Connected pairs</dt>
              <dd>{structure.links.length}</dd>
            </div>
            <div>
              <dt>Turns</dt>
              <dd>{turnCount}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.completeCard}>
          <span>
            <Sparkles size={14} />{" "}
            {demo ? "Explore the demo" : "Structure ready"}
          </span>
          <p>
            {demo
              ? "실제 대화를 분석하면 이 화면에 해당 세션의 구조가 표시됩니다."
              : "검증된 의미 항목과 원문 근거를 연결해 표시합니다."}
          </p>
          {actionHref ? (
            <a href={actionHref} className={styles.sidebarAction}>
              내 대화 분석하기 <ArrowRight size={12} />
            </a>
          ) : null}
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <div>
            <span>
              {mode === "connections"
                ? "CONCEPT RELATIONSHIPS"
                : "CONVERSATION PROGRESSION"}
            </span>
            <h1>
              {mode === "connections"
                ? "What belongs together"
                : "How the conversation moved"}
            </h1>
          </div>
          <label className={styles.searchBox}>
            <Search size={14} />
            <span className={styles.srOnly}>현재 구조 검색</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === "connections" ? "Find a concept" : "Search this thread"
              }
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
        </header>

        {mode === "connections" ? (
          <ConnectionsView
            nodes={visibleNodes}
            links={visibleLinks}
            selected={selected}
            selectedLinks={selectedLinks}
            related={related}
            totalNodes={structure.nodes.length}
            totalLinks={structure.links.length}
            onSelect={setSelectedId}
            onOpenTurn={onOpenTurn}
          />
        ) : (
          <FlowView items={visibleFlow} onOpenTurn={onOpenTurn} />
        )}
      </div>
    </section>
  );
}

function ConnectionsView({
  nodes,
  links,
  selected,
  selectedLinks,
  related,
  totalNodes,
  totalLinks,
  onSelect,
  onOpenTurn
}: {
  nodes: StructureNode[];
  links: ReturnType<typeof buildThreadStructure>["links"];
  selected: StructureNode | null;
  selectedLinks: ReturnType<typeof buildThreadStructure>["links"];
  related: StructureNode[];
  totalNodes: number;
  totalLinks: number;
  onSelect: (id: string) => void;
  onOpenTurn?: (turnId: number) => void;
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const highlightedIds = new Set(
    selectedLinks.flatMap((link) => [link.from, link.to])
  );

  return (
    <div className={styles.connectionLayout}>
      <div className={styles.graphCanvas}>
        {nodes.length > 0 ? (
          <>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className={styles.graphLines}
            >
              {links.map((link) => {
                const from = nodeById.get(link.from);
                const to = nodeById.get(link.to);
                if (!from || !to) return null;
                const emphasized =
                  link.from === selected?.id || link.to === selected?.id;
                return (
                  <line
                    key={link.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={
                      emphasized && selected
                        ? TONE_COLORS[selected.tone]
                        : "#71849b"
                    }
                    strokeWidth={emphasized ? 0.34 : 0.18}
                    opacity={emphasized ? 0.9 : 0.44}
                  />
                );
              })}
            </svg>
            {nodes.map((node) => {
              const active = node.id === selected?.id;
              const relatedNode = highlightedIds.has(node.id);
              const nodeStyle = {
                "--node-color": TONE_COLORS[node.tone],
                left: `${node.x}%`,
                top: `${node.y}%`
              } as CSSProperties;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`${styles.graphNode} ${active ? styles.nodeActive : ""} ${
                    selected && !active && !relatedNode ? styles.nodeMuted : ""
                  }`}
                  style={nodeStyle}
                  onClick={() => onSelect(node.id)}
                  aria-pressed={active}
                >
                  <i />
                  <span>
                    <strong>{node.label}</strong>
                    <small>
                      {TYPE_LABELS[node.type]} · {node.mentions}
                    </small>
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <div className={styles.emptyGraph}>
            <CircleDot size={22} />
            <strong>표시할 개념이 없습니다.</strong>
            <p>검색 조건을 지우거나 Flow에서 원문 흐름을 확인하세요.</p>
          </div>
        )}
        <div className={styles.graphSummary}>
          <span>{totalNodes} concepts</span>
          <i />
          <span>{totalLinks} connections</span>
        </div>
      </div>

      <aside className={styles.detailPanel}>
        {selected ? (
          <>
            <span className={styles.panelEyebrow}>SELECTED CONCEPT</span>
            <div className={styles.selectedTitle}>
              <i style={{ background: TONE_COLORS[selected.tone] }} />
              <h2>{selected.label}</h2>
            </div>
            <p className={styles.selectedMeta}>
              {TYPE_LABELS[selected.type]} · {selected.mentions} evidence ·{" "}
              {selected.source}
            </p>
            <p className={styles.selectedDescription}>
              {selected.description || "설명 없음"}
            </p>

            <section className={styles.detailSection}>
              <span className={styles.panelEyebrow}>CONNECTED TO</span>
              <div className={styles.relatedList}>
                {related.length > 0 ? (
                  related.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => onSelect(node.id)}
                    >
                      <span>
                        <i style={{ background: TONE_COLORS[node.tone] }} />
                        {node.label}
                      </span>
                      <ChevronRight size={13} />
                    </button>
                  ))
                ) : (
                  <p className={styles.emptyDetail}>직접 연결된 개념 없음</p>
                )}
              </div>
            </section>

            <section className={styles.detailSection}>
              <span className={styles.panelEyebrow}>APPEARS IN</span>
              <div className={styles.evidenceCard}>
                <span>
                  MESSAGE {formatIndexes(selected.evidenceMessageIndexes)}
                </span>
                <p>
                  “{selected.triggerPhrase || clip(selected.description, 100)}”
                </p>
                {selected.turnIds[0] && onOpenTurn ? (
                  <button
                    type="button"
                    onClick={() => onOpenTurn(selected.turnIds[0]!)}
                  >
                    Turn {selected.turnIds[0]}에서 보기 <ArrowRight size={12} />
                  </button>
                ) : null}
              </div>
            </section>

            <div className={styles.qualityRow}>
              <span>
                <CheckCircle2 size={13} /> {verificationLabel(selected)}
              </span>
              <strong>{Math.round(selected.confidence * 100)}%</strong>
            </div>
          </>
        ) : (
          <div className={styles.emptyDetail}>개념을 선택하세요.</div>
        )}
      </aside>
    </div>
  );
}

function FlowView({
  items,
  onOpenTurn
}: {
  items: StructureFlowItem[];
  onOpenTurn?: (turnId: number) => void;
}) {
  return (
    <div className={styles.flowScroll}>
      <div className={styles.flowContent}>
        <div className={styles.flowHeading}>
          <span>SESSION FLOW</span>
          <i />
          <span>{items.length} KEY MESSAGES</span>
        </div>
        {items.length > 0 ? (
          <div className={styles.timeline}>
            {items.map((item, index) => (
              <article key={item.id} className={styles.flowItem}>
                <span className={styles.timelineIcon} data-role={item.role}>
                  {item.role === "user" ? (
                    <UserRound size={11} />
                  ) : (
                    <Bot size={11} />
                  )}
                </span>
                <div className={styles.flowCard}>
                  <header>
                    <div>
                      <span data-role={item.role}>{item.role}</span>
                      <strong>{item.title}</strong>
                    </div>
                    {onOpenTurn ? (
                      <button
                        type="button"
                        onClick={() => onOpenTurn(item.turnId)}
                      >
                        #{item.messageIndex} <ChevronRight size={12} />
                      </button>
                    ) : (
                      <small className={styles.messageIndex}>
                        #{item.messageIndex}
                      </small>
                    )}
                  </header>
                  <p>{item.text}</p>
                  {item.tags.length > 0 ? (
                    <div className={styles.flowTags}>
                      {item.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  {item.createdAt ? (
                    <time dateTime={item.createdAt}>
                      {formatTimestamp(item.createdAt)}
                    </time>
                  ) : null}
                </div>
                {index < items.length - 1 ? (
                  <div className={styles.flowConnector}>
                    <ArrowRight size={12} /> response / refinement
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyFlow}>
            검색 조건과 일치하는 메시지가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function matchesNode(node: StructureNode, query: string) {
  if (!query) return true;
  return [
    node.label,
    node.description,
    node.type,
    node.category,
    node.status,
    node.triggerPhrase
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(query);
}

function matchesFlow(item: StructureFlowItem, query: string) {
  if (!query) return true;
  return [item.title, item.text, ...item.tags]
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(query);
}

function verificationLabel(node: StructureNode) {
  if (node.verificationStatus === "verified") return "Evidence verified";
  if (node.verificationStatus === "review_required") return "Review required";
  return "Rule grounded";
}

function formatIndexes(indexes: number[]) {
  if (indexes.length === 0) return "—";
  return indexes.map((index) => `#${index}`).join(", ");
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function clip(value: string, length: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > length
    ? `${normalized.slice(0, length).trimEnd()}…`
    : normalized;
}

"use client";

import {
  ChevronRight,
  Database,
  Focus,
  Layers3,
  Maximize2,
  Minus,
  Network,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";

import {
  ATLAS_EDGES,
  ATLAS_TOPICS,
  ATLAS_TOTALS,
  ATLAS_WORLD,
  ATLAS_ZONES,
  getNeighborTopicIds,
  getTopicById,
  getZoneById,
  isTopicMatch,
  topicsForZone,
  type AtlasKeyword,
  type AtlasTopic,
  type AtlasZone,
  type KeywordKind,
  type ZoneId
} from "./atlasModel";
import styles from "./AtlasDashboard.module.css";

type ViewMode = "territory" | "local" | "evidence";
type KeywordFilter = "all" | KeywordKind;

type Camera = {
  x: number;
  y: number;
  scale: number;
};

type PinnedItem = {
  id: string;
  type: "topic" | "keyword";
  title: string;
  meta: string;
  summary: string;
};

type DragPayload = Pick<PinnedItem, "id" | "type">;

const INITIAL_CAMERA: Camera = { x: 0, y: 0, scale: 0.3 };
const DETAIL_LABELS = [
  "Territories only",
  "Territories + hubs",
  "Keywords + summaries",
  "Evidence detail"
] as const;
const DENSITY_LABELS = [
  "Hidden",
  "2 / topic",
  "3 / topic",
  "4 / topic",
  "All"
] as const;
const DENSITY_LIMITS = [0, 2, 3, 4, Number.POSITIVE_INFINITY] as const;
const EDGE_LABELS = ["None", "Bundled", "Key links", "Full context"] as const;
const VIEW_LABELS: Record<ViewMode, string> = {
  territory: "Territory",
  local: "Local",
  evidence: "Evidence"
};

const KIND_META: Record<
  KeywordKind,
  { label: string; color: string; short: string }
> = {
  topic: { label: "Topic / Thought", color: "#f7d283", short: "Topic" },
  decision: { label: "Decision / Change", color: "#ff8f85", short: "Decision" },
  action: { label: "Action / Workflow", color: "#8ce99a", short: "Action" },
  evidence: { label: "Evidence / Source", color: "#9ad4ff", short: "Evidence" },
  pending: { label: "Pending / Risk", color: "#ffd166", short: "Pending" }
};

const FILTER_ORDER: readonly KeywordFilter[] = [
  "all",
  "decision",
  "action",
  "evidence",
  "pending"
];

const EDGE_COLORS = {
  supports: "#e8bc72",
  informs: "#b79aff",
  feeds: "#7ed9b0",
  validates: "#8fcfff",
  governs: "#ff8178"
} as const;

const ZONE_LANES: readonly [ZoneId, ZoneId, string][] = [
  ["strategy", "product", "purpose → system"],
  ["product", "atlas", "structure → interface"],
  ["strategy", "evidence", "intent → proof"],
  ["product", "memory", "objects → memory"],
  ["atlas", "governance", "experience → control"],
  ["evidence", "memory", "decision → continuity"],
  ["memory", "governance", "memory → trust"]
];

const TOPIC_BY_ID = new Map(ATLAS_TOPICS.map((topic) => [topic.id, topic]));
const ZONE_BY_ID = new Map(ATLAS_ZONES.map((zone) => [zone.id, zone]));
const KEYWORD_CONTEXT = new Map<
  string,
  { keyword: AtlasKeyword; topic: AtlasTopic }
>();

for (const topic of ATLAS_TOPICS) {
  for (const keyword of topic.keywords) {
    KEYWORD_CONTEXT.set(keyword.id, { keyword, topic });
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function keywordStyle(kind: KeywordKind): CSSProperties {
  return { "--kind-color": KIND_META[kind].color } as CSSProperties;
}

function zoneStyle(color: string): CSSProperties {
  return { "--zone-color": color } as CSSProperties;
}

function curvedPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bend = 0.1
) {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return `M ${start.x} ${start.y} Q ${midX - dy * bend} ${midY + dx * bend} ${end.x} ${end.y}`;
}

function keywordPosition(topic: AtlasTopic, index: number) {
  const angles = [-108, -34, 34, 108, 172, 224];
  const angle = ((angles[index % angles.length] ?? 0) * Math.PI) / 180;
  const ring = Math.floor(index / angles.length);
  return {
    x: topic.x + Math.cos(angle) * (190 + ring * 82),
    y: topic.y + Math.sin(angle) * (124 + ring * 50)
  };
}

export function AtlasDashboard() {
  const viewportRef = useRef<HTMLElement | null>(null);
  const hasFittedRef = useRef(false);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewMode>("territory");
  const [selectedZoneId, setSelectedZoneId] = useState<ZoneId>("strategy");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(
    null
  );
  const [detail, setDetail] = useState(1);
  const [density, setDensity] = useState(1);
  const [edgeLevel, setEdgeLevel] = useState(1);
  const [filter, setFilter] = useState<KeywordFilter>("all");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<PinnedItem[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const selectedZone = getZoneById(selectedZoneId) ?? ATLAS_ZONES[0];
  const selectedTopic = selectedTopicId
    ? getTopicById(selectedTopicId)
    : undefined;
  const selectedKeywordContext = selectedKeywordId
    ? KEYWORD_CONTEXT.get(selectedKeywordId)
    : undefined;

  const queryText = query.trim().toLocaleLowerCase("ko-KR");
  const matchingTopicIds = useMemo<Set<string>>(
    () =>
      new Set(
        ATLAS_TOPICS.filter((topic) => isTopicMatch(topic, queryText)).map(
          (topic) => topic.id
        )
      ),
    [queryText]
  );
  const localTopicIds = useMemo(
    () =>
      selectedTopicId
        ? getNeighborTopicIds(selectedTopicId, true)
        : new Set<string>(),
    [selectedTopicId]
  );

  const fitMap = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const padding = width < 680 ? 28 : 76;
    const scale = clamp(
      Math.min(
        (width - padding * 2) / ATLAS_WORLD.width,
        (height - padding * 2) / ATLAS_WORLD.height
      ),
      0.18,
      1.2
    );
    setCamera({
      scale,
      x: (width - ATLAS_WORLD.width * scale) / 2,
      y: (height - ATLAS_WORLD.height * scale) / 2
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight
      });
      if (!hasFittedRef.current && viewport.clientWidth > 0) {
        hasFittedRef.current = true;
        fitMap();
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitMap]);

  function focusZone(zoneId: ZoneId) {
    const zone = getZoneById(zoneId);
    const viewport = viewportRef.current;
    if (!zone || !viewport) return;
    const padding = viewport.clientWidth < 680 ? 34 : 92;
    const scale = clamp(
      Math.min(
        (viewport.clientWidth - padding * 2) / zone.width,
        (viewport.clientHeight - padding * 2) / zone.height
      ),
      0.34,
      1.18
    );
    setSelectedZoneId(zoneId);
    setSelectedTopicId(null);
    setSelectedKeywordId(null);
    setCamera({
      scale,
      x: viewport.clientWidth / 2 - (zone.x + zone.width / 2) * scale,
      y: viewport.clientHeight / 2 - (zone.y + zone.height / 2) * scale
    });
  }

  function focusTopic(topicId: string) {
    const topic = getTopicById(topicId);
    const viewport = viewportRef.current;
    if (!topic || !viewport) return;
    const scale = clamp(Math.max(camera.scale, 0.78), 0.78, 1.35);
    setSelectedZoneId(topic.zoneId);
    setSelectedTopicId(topic.id);
    setSelectedKeywordId(null);
    setCamera({
      scale,
      x: viewport.clientWidth / 2 - topic.x * scale,
      y: viewport.clientHeight / 2 - topic.y * scale
    });
  }

  function selectKeyword(keywordId: string) {
    const context = KEYWORD_CONTEXT.get(keywordId);
    if (!context) return;
    setSelectedKeywordId(keywordId);
    setSelectedTopicId(context.topic.id);
    setSelectedZoneId(context.topic.zoneId);
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const centerX = viewport.clientWidth / 2;
    const centerY = viewport.clientHeight / 2;
    setCamera((current) => {
      const worldX = (centerX - current.x) / current.scale;
      const worldY = (centerY - current.y) / current.scale;
      const scale = clamp(current.scale * factor, 0.18, 2.4);
      return {
        scale,
        x: centerX - worldX * scale,
        y: centerY - worldY * scale
      };
    });
  }

  function changeView(nextView: ViewMode) {
    setView(nextView);
    if (nextView === "local" && !selectedTopicId) {
      const firstTopic = topicsForZone(selectedZoneId)[0];
      if (firstTopic) focusTopic(firstTopic.id);
    }
    if (nextView === "evidence") {
      setDetail(3);
      setDensity((current) => Math.max(current, 2));
      setFilter("evidence");
    }
  }

  function resetAtlas() {
    setView("territory");
    setSelectedZoneId("strategy");
    setSelectedTopicId(null);
    setSelectedKeywordId(null);
    setDetail(1);
    setDensity(1);
    setEdgeLevel(1);
    setFilter("all");
    setQuery("");
    fitMap();
  }

  function topicIsDimmed(topic: AtlasTopic) {
    if (queryText && !matchingTopicIds.has(topic.id)) return true;
    if (
      filter !== "all" &&
      !topic.keywords.some((keyword) => keyword.kind === filter)
    ) {
      return true;
    }
    if (view === "local" && selectedTopicId && !localTopicIds.has(topic.id)) {
      return true;
    }
    return false;
  }

  function zoneIsDimmed(zoneId: ZoneId) {
    const topics = topicsForZone(zoneId);
    return topics.every(topicIsDimmed);
  }

  function visibleKeywords(topic: AtlasTopic) {
    if (detail === 0) return [];
    const shouldReveal =
      Boolean(queryText) ||
      detail >= 2 ||
      selectedTopicId === topic.id ||
      view === "evidence";
    if (!shouldReveal) return [];

    let keywords = [...topic.keywords];
    if (filter !== "all") {
      keywords = keywords.filter((keyword) => keyword.kind === filter);
    }
    if (queryText) {
      const keywordMatches = keywords.filter((keyword) =>
        `${keyword.label} ${keyword.summary} ${keyword.kind}`
          .toLocaleLowerCase("ko-KR")
          .includes(queryText)
      );
      if (keywordMatches.length > 0) keywords = keywordMatches;
    }

    const densityLimit = DENSITY_LIMITS[density] ?? 0;
    const detailLimit = detail === 1 ? 2 : detail === 2 ? 3 : Infinity;
    return keywords.slice(0, Math.min(densityLimit, detailLimit));
  }

  function pinItem(payload: DragPayload) {
    let item: PinnedItem | undefined;
    if (payload.type === "topic") {
      const topic = getTopicById(payload.id);
      if (topic) {
        item = {
          id: topic.id,
          type: "topic",
          title: topic.title,
          meta: `${topic.ko} · ${topic.keywordCount} keywords`,
          summary: topic.summary
        };
      }
    } else {
      const context = KEYWORD_CONTEXT.get(payload.id);
      if (context) {
        item = {
          id: context.keyword.id,
          type: "keyword",
          title: context.keyword.label,
          meta: `${KIND_META[context.keyword.kind].short} · ${context.topic.ko}`,
          summary: context.keyword.summary
        };
      }
    }
    if (!item) return;
    setPinned((current) =>
      current.some((pinnedItem) => pinnedItem.id === item?.id)
        ? current
        : [item!, ...current]
    );
  }

  function writeDragPayload(
    event: ReactDragEvent<HTMLElement>,
    payload: DragPayload
  ) {
    const value = JSON.stringify(payload);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-tiv-atlas", value);
    event.dataTransfer.setData("text/plain", value);
  }

  function readDropPayload(event: ReactDragEvent<HTMLElement>) {
    const raw =
      event.dataTransfer.getData("application/x-tiv-atlas") ||
      event.dataTransfer.getData("text/plain");
    try {
      const payload = JSON.parse(raw) as Partial<DragPayload>;
      if (
        typeof payload.id === "string" &&
        (payload.type === "topic" || payload.type === "keyword")
      ) {
        pinItem(payload as DragPayload);
      }
    } catch {
      // Ignore unrelated drag payloads.
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-map-control='true']")) return;
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const activePan = panRef.current;
    if (!activePan || activePan.pointerId !== event.pointerId) return;
    const dx = event.clientX - activePan.x;
    const dy = event.clientY - activePan.y;
    panRef.current = { ...activePan, x: event.clientX, y: event.clientY };
    setCamera((current) => ({
      ...current,
      x: current.x + dx,
      y: current.y + dy
    }));
  }

  function stopPanning(event: ReactPointerEvent<HTMLElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLElement>) {
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    setCamera((current) => {
      const worldX = (screenX - current.x) / current.scale;
      const worldY = (screenY - current.y) / current.scale;
      const scale = clamp(
        current.scale * Math.exp(-event.deltaY * 0.001),
        0.18,
        2.4
      );
      return {
        scale,
        x: screenX - worldX * scale,
        y: screenY - worldY * scale
      };
    });
  }

  function handleMapKeys(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    const panAmount = event.shiftKey ? 120 : 48;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.18);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(1 / 1.18);
    } else if (event.key === "0" || event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitMap();
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      setCamera((current) => ({
        ...current,
        x:
          current.x +
          (event.key === "ArrowLeft"
            ? panAmount
            : event.key === "ArrowRight"
              ? -panAmount
              : 0),
        y:
          current.y +
          (event.key === "ArrowUp"
            ? panAmount
            : event.key === "ArrowDown"
              ? -panAmount
              : 0)
      }));
    }
  }

  function recenterFromMinimap(event: ReactMouseEvent<HTMLButtonElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const worldX =
      ((event.clientX - rect.left) / rect.width) * ATLAS_WORLD.width;
    const worldY =
      ((event.clientY - rect.top) / rect.height) * ATLAS_WORLD.height;
    setCamera((current) => ({
      ...current,
      x: viewport.clientWidth / 2 - worldX * current.scale,
      y: viewport.clientHeight / 2 - worldY * current.scale
    }));
  }

  const visibleTopicCount = ATLAS_TOPICS.filter(
    (topic) => !topicIsDimmed(topic)
  ).length;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">
            TIV
          </div>
          <div className={styles.brandText}>
            <div className={styles.eyebrow}>T.I.V · Conversation Atlas</div>
            <div className={styles.brandTitle}>
              Zoned Investigation Dashboard
            </div>
          </div>
        </div>

        <div className={styles.searchWrap}>
          <label className={styles.visuallyHidden} htmlFor="atlas-search">
            토픽과 키워드 검색
          </label>
          <Search className={styles.searchIcon} size={15} aria-hidden="true" />
          <input
            id="atlas-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="토픽·키워드 검색: Evidence, Atlas, Memory…"
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="검색어 지우기"
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        <div className={styles.topActions}>
          <div className={styles.modeGroup} aria-label="Atlas 보기 모드">
            <button
              type="button"
              className={`${styles.modeButton} ${view === "territory" ? styles.modeActive : ""}`}
              aria-pressed={view === "territory"}
              title="영역 중심 보기"
              onClick={() => changeView("territory")}
            >
              <Layers3 size={13} aria-hidden="true" />
              <span>Territory</span>
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${view === "local" ? styles.modeActive : ""}`}
              aria-pressed={view === "local"}
              title="선택 토픽의 직접 연결만 보기"
              onClick={() => changeView("local")}
            >
              <Network size={13} aria-hidden="true" />
              <span>Local</span>
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${view === "evidence" ? styles.modeActive : ""}`}
              aria-pressed={view === "evidence"}
              title="근거 키워드 보기"
              onClick={() => changeView("evidence")}
            >
              <Database size={13} aria-hidden="true" />
              <span>Evidence</span>
            </button>
          </div>
          <button
            type="button"
            className={styles.headerButton}
            aria-label="전체 지도 맞춤"
            title="전체 지도 맞춤"
            onClick={fitMap}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className={styles.headerButton}
            aria-label="Atlas 초기화"
            title="Atlas 초기화"
            onClick={resetAtlas}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.leftRail} aria-label="Atlas 탐색">
          <div className={styles.railScroll}>
            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>Atlas scale</span>
                <span>live model</span>
              </div>
              <div className={styles.metricGrid}>
                <MetricCard value={ATLAS_TOTALS.zones} label="Clear zones" />
                <MetricCard value={ATLAS_TOTALS.topics} label="Topic hubs" />
                <MetricCard value={ATLAS_TOTALS.keywords} label="Keywords" />
                <MetricCard
                  value={ATLAS_TOTALS.atoms}
                  label="Conversation atoms"
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.principle}>
                정보는 한 번에 펼치지 않습니다.{" "}
                <strong>영역 → 토픽 허브 → 키워드 → 근거</strong> 순으로 맥락을
                좁혀 보세요.
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>Territories</span>
                <span>{ATLAS_ZONES.length} zones</span>
              </div>
              <div className={styles.territoryList}>
                {ATLAS_ZONES.map((zone) => {
                  const zoneTopics = topicsForZone(zone.id);
                  const keywordCount = zoneTopics.reduce(
                    (sum, topic) => sum + topic.keywordCount,
                    0
                  );
                  return (
                    <button
                      type="button"
                      key={zone.id}
                      className={`${styles.territoryButton} ${selectedZoneId === zone.id ? styles.territoryActive : ""}`}
                      style={zoneStyle(zone.color)}
                      aria-pressed={selectedZoneId === zone.id}
                      onClick={() => focusZone(zone.id)}
                    >
                      <span className={styles.territoryHead}>
                        <span className={styles.territoryIdentity}>
                          <span className={styles.territoryIndex}>
                            {String(zone.num).padStart(2, "0")}
                          </span>
                          <span>
                            <span className={styles.territoryName}>
                              {zone.title}
                            </span>
                            <span className={styles.territoryKo}>
                              {zone.ko}
                            </span>
                          </span>
                        </span>
                        <span className={styles.territoryCount}>
                          {zoneTopics.length}T<br />
                          {keywordCount}K
                        </span>
                      </span>
                      <span className={styles.progressTrack} aria-hidden="true">
                        <span
                          className={styles.progressFill}
                          style={{
                            width: `${Math.min(100, 38 + keywordCount / 1.5)}%`
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>Topic hubs</span>
                <span>{visibleTopicCount} visible</span>
              </div>
              <div className={styles.topicList}>
                {[...ATLAS_TOPICS]
                  .sort(
                    (a, b) => b.degree - a.degree || b.turnCount - a.turnCount
                  )
                  .map((topic) => {
                    const zone = ZONE_BY_ID.get(topic.zoneId)!;
                    const dimmed = topicIsDimmed(topic);
                    return (
                      <button
                        type="button"
                        key={topic.id}
                        className={`${styles.topicButton} ${selectedTopicId === topic.id ? styles.topicActive : ""} ${dimmed ? styles.topicDim : ""}`}
                        style={zoneStyle(zone.color)}
                        aria-pressed={selectedTopicId === topic.id}
                        onClick={() => focusTopic(topic.id)}
                      >
                        <span
                          className={styles.topicStripe}
                          aria-hidden="true"
                        />
                        <span className={styles.topicCopy}>
                          <span className={styles.topicName}>
                            {topic.title}
                          </span>
                          <span className={styles.topicKo}>{topic.ko}</span>
                        </span>
                        <span className={styles.topicCount}>
                          {topic.keywordCount} kw <ChevronRight size={11} />
                        </span>
                      </button>
                    );
                  })}
              </div>
              {queryText ? (
                <p className={styles.searchFeedback} aria-live="polite">
                  “{query}”와 연결된 토픽 {matchingTopicIds.size}개
                </p>
              ) : null}
            </section>
          </div>
        </aside>

        <section
          ref={viewportRef}
          className={`${styles.viewport} ${isPanning ? styles.panning : ""}`}
          aria-label="대화 Atlas 지도. 화살표로 이동하고 더하기와 빼기로 확대할 수 있습니다."
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPanning}
          onPointerCancel={stopPanning}
          onWheel={handleWheel}
          onKeyDown={handleMapKeys}
        >
          <div
            className={styles.world}
            style={{
              width: ATLAS_WORLD.width,
              height: ATLAS_WORLD.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
            }}
          >
            <AtlasConnections
              edgeLevel={edgeLevel}
              view={view}
              selectedTopicId={selectedTopicId}
            />

            {ATLAS_ZONES.map((zone) => {
              const zoneTopics = topicsForZone(zone.id);
              const keywords = zoneTopics.reduce(
                (sum, topic) => sum + topic.keywordCount,
                0
              );
              return (
                <button
                  type="button"
                  key={zone.id}
                  className={`${styles.zone} ${selectedZoneId === zone.id ? styles.zoneActive : ""} ${zoneIsDimmed(zone.id) ? styles.zoneDim : ""}`}
                  style={
                    {
                      ...zoneStyle(zone.color),
                      left: zone.x,
                      top: zone.y,
                      width: zone.width,
                      height: zone.height
                    } as CSSProperties
                  }
                  data-map-control="true"
                  aria-label={`${zone.title}, ${zoneTopics.length}개 토픽`}
                  onClick={() => focusZone(zone.id)}
                >
                  <span className={styles.zoneHeader}>
                    <span className={styles.zoneNumber}>
                      {String(zone.num).padStart(2, "0")}
                    </span>
                    <span>
                      <span className={styles.zoneTitle}>{zone.title}</span>
                      <span className={styles.zoneKo}>{zone.ko}</span>
                    </span>
                    <span className={styles.zoneStats}>
                      {zoneTopics.length} topics
                      <br />
                      {keywords} keywords
                      <br />
                      {zone.atomCount} atoms
                    </span>
                  </span>
                  <span className={styles.zoneSummary}>{zone.summary}</span>
                </button>
              );
            })}

            <div className={styles.core} aria-hidden="true">
              <div className={styles.coreTitle}>
                T.I.V
                <small>CORE ATLAS</small>
              </div>
            </div>
            <div className={styles.coreLabel} aria-hidden="true">
              AI conversations → structured thought map
            </div>

            {detail > 0
              ? ATLAS_TOPICS.map((topic) => {
                  const zone = ZONE_BY_ID.get(topic.zoneId)!;
                  const active = selectedTopicId === topic.id;
                  return (
                    <button
                      type="button"
                      draggable
                      key={topic.id}
                      className={`${styles.topicNode} ${active ? styles.topicNodeActive : ""} ${topicIsDimmed(topic) ? styles.topicNodeDim : ""}`}
                      style={
                        {
                          ...zoneStyle(zone.color),
                          left: topic.x - 124,
                          top: topic.y - 47
                        } as CSSProperties
                      }
                      data-map-control="true"
                      aria-pressed={active}
                      onClick={() => focusTopic(topic.id)}
                      onDragStart={(event) =>
                        writeDragPayload(event, { type: "topic", id: topic.id })
                      }
                    >
                      <span className={styles.topicPin} aria-hidden="true" />
                      <span className={styles.topicNodeCopy}>
                        <span className={styles.topicNodeTitle}>
                          {topic.title}
                        </span>
                        <span className={styles.topicNodeKo}>{topic.ko}</span>
                        <span className={styles.topicNodeMeta}>
                          {topic.keywordCount} kw · {topic.turnCount} atoms ·
                          degree {topic.degree}
                        </span>
                      </span>
                      {detail >= 2 ? (
                        <span className={styles.topicNodeSummary}>
                          {topic.summary}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              : null}

            {ATLAS_TOPICS.flatMap((topic) =>
              visibleKeywords(topic).map((keyword, index) => {
                const position = keywordPosition(topic, index);
                const active = selectedKeywordId === keyword.id;
                const match =
                  Boolean(queryText) &&
                  `${keyword.label} ${keyword.summary}`
                    .toLocaleLowerCase("ko-KR")
                    .includes(queryText);
                return (
                  <button
                    type="button"
                    draggable
                    key={keyword.id}
                    className={`${styles.keywordPill} ${active ? styles.keywordActive : ""} ${match ? styles.keywordMatch : ""}`}
                    style={
                      {
                        ...keywordStyle(keyword.kind),
                        left: position.x,
                        top: position.y
                      } as CSSProperties
                    }
                    data-map-control="true"
                    aria-pressed={active}
                    onClick={() => selectKeyword(keyword.id)}
                    onDragStart={(event) =>
                      writeDragPayload(event, {
                        type: "keyword",
                        id: keyword.id
                      })
                    }
                  >
                    {keyword.label}
                  </button>
                );
              })
            )}
          </div>

          <ReadabilityHud
            view={view}
            detail={detail}
            density={density}
            edgeLevel={edgeLevel}
            filter={filter}
            onDetailChange={setDetail}
            onDensityChange={setDensity}
            onEdgeChange={setEdgeLevel}
            onFilterChange={setFilter}
          />

          <div className={styles.canvasTools} data-map-control="true">
            <button
              type="button"
              className={styles.toolButton}
              aria-label="확대"
              onClick={() => zoomBy(1.18)}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              aria-label="축소"
              onClick={() => zoomBy(1 / 1.18)}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              aria-label="전체 지도 맞춤"
              onClick={fitMap}
            >
              <Focus size={15} />
            </button>
          </div>

          <div className={styles.statusbar} aria-hidden="true">
            <span>
              Drag background to pan · Wheel or +/− to zoom · Drag a node to
              evidence
            </span>
            <span className={styles.cameraStatus}>
              {Math.round(camera.scale * 100)}% · {VIEW_LABELS[view]}
            </span>
          </div>

          <button
            type="button"
            className={styles.minimap}
            data-map-control="true"
            aria-label="미니맵에서 선택한 위치로 이동"
            onClick={recenterFromMinimap}
          >
            <svg
              viewBox={`0 0 ${ATLAS_WORLD.width} ${ATLAS_WORLD.height}`}
              aria-hidden="true"
            >
              {ATLAS_ZONES.map((zone) => (
                <rect
                  key={zone.id}
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  rx="34"
                  fill={`${zone.color}28`}
                  stroke={zone.color}
                  strokeWidth="10"
                />
              ))}
              <rect
                x={-camera.x / camera.scale}
                y={-camera.y / camera.scale}
                width={viewportSize.width / camera.scale}
                height={viewportSize.height / camera.scale}
                fill="transparent"
                stroke="#fff8e8"
                strokeWidth="12"
              />
            </svg>
          </button>
        </section>

        <aside className={styles.rightRail} aria-label="선택 항목과 근거 보드">
          <div className={styles.railScroll}>
            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>Node organizer</span>
                <span>Inspector</span>
              </div>
              <Inspector
                zone={selectedZone}
                topic={selectedTopic}
                keywordContext={selectedKeywordContext}
                onPin={pinItem}
                onKeywordSelect={selectKeyword}
                onTopicSelect={focusTopic}
              />
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>Evidence board</span>
                <span>{pinned.length} pinned</span>
              </div>
              <div
                className={`${styles.dropzone} ${dropActive ? styles.dropzoneActive : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDropActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    setDropActive(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropActive(false);
                  readDropPayload(event);
                }}
              >
                <div>
                  <Pin size={18} aria-hidden="true" />
                  <strong>토픽이나 키워드를 이곳에 놓으세요</strong>
                  <span>중요한 맥락을 근거 카드로 고정합니다.</span>
                </div>
              </div>
              <div className={styles.pinnedList} aria-live="polite">
                {pinned.map((item) => (
                  <article className={styles.pinnedCard} key={item.id}>
                    <div className={styles.pinnedHead}>
                      <div>
                        <div className={styles.pinnedTitle}>{item.title}</div>
                        <div className={styles.pinnedMeta}>{item.meta}</div>
                      </div>
                      <button
                        type="button"
                        className={styles.removePin}
                        aria-label={`${item.title} 고정 해제`}
                        onClick={() =>
                          setPinned((current) =>
                            current.filter((entry) => entry.id !== item.id)
                          )
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className={styles.pinnedSummary}>{item.summary}</div>
                  </article>
                ))}
              </div>
              {pinned.length === 0 ? (
                <p className={styles.emptyPins}>아직 고정된 근거가 없습니다.</p>
              ) : null}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <span>Legend</span>
                <span>types</span>
              </div>
              <div className={styles.legend}>
                {(Object.keys(KIND_META) as KeywordKind[]).map((kind) => (
                  <div className={styles.legendRow} key={kind}>
                    <span
                      className={styles.legendDot}
                      style={keywordStyle(kind)}
                    />
                    {KIND_META[kind].label}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricValue}>{compactNumber(value)}</div>
      <div className={styles.metricLabel}>{label}</div>
    </div>
  );
}

function AtlasConnections({
  edgeLevel,
  view,
  selectedTopicId
}: {
  edgeLevel: number;
  view: ViewMode;
  selectedTopicId: string | null;
}) {
  const localIds = selectedTopicId
    ? getNeighborTopicIds(selectedTopicId, true)
    : new Set<string>();
  const visibleEdges =
    edgeLevel >= 2
      ? ATLAS_EDGES
      : edgeLevel === 1 && view === "local" && selectedTopicId
        ? ATLAS_EDGES.filter(
            (edge) =>
              edge.source === selectedTopicId || edge.target === selectedTopicId
          )
        : [];

  return (
    <svg
      className={styles.graphSvg}
      width={ATLAS_WORLD.width}
      height={ATLAS_WORLD.height}
      aria-hidden="true"
    >
      {edgeLevel >= 1
        ? ZONE_LANES.map(([sourceId, targetId]) => {
            const source = ZONE_BY_ID.get(sourceId)!;
            const target = ZONE_BY_ID.get(targetId)!;
            const start = {
              x: source.x + source.width / 2,
              y: source.y + source.height / 2
            };
            const end = {
              x: target.x + target.width / 2,
              y: target.y + target.height / 2
            };
            const path = curvedPath(start, end, 0.055);
            return (
              <g key={`${sourceId}-${targetId}`}>
                <path
                  className={styles.zoneLaneHalo}
                  d={path}
                  fill="none"
                  stroke="#000"
                  strokeLinecap="round"
                  strokeWidth="34"
                />
                <path
                  className={styles.zoneLane}
                  d={path}
                  fill="none"
                  stroke={source.color}
                  strokeLinecap="round"
                  strokeWidth="18"
                />
              </g>
            );
          })
        : null}

      {visibleEdges.map((edge) => {
        const source = TOPIC_BY_ID.get(edge.source)!;
        const target = TOPIC_BY_ID.get(edge.target)!;
        const active =
          Boolean(selectedTopicId) &&
          localIds.has(source.id) &&
          localIds.has(target.id) &&
          (source.id === selectedTopicId || target.id === selectedTopicId);
        const path = curvedPath(source, target, 0.08);
        return (
          <g key={`${edge.source}-${edge.target}`}>
            <path
              className={`${styles.topicEdge} ${active ? styles.topicEdgeActive : ""}`}
              d={path}
              fill="none"
              stroke={EDGE_COLORS[edge.kind]}
              strokeLinecap="round"
              strokeWidth={active ? 5 : 3}
            />
            {edgeLevel >= 3 && (active || view !== "local") ? (
              <text
                x={(source.x + target.x) / 2}
                y={(source.y + target.y) / 2 - 8}
                fill="#cbb998"
                fontFamily="ui-monospace, monospace"
                fontSize="13"
                textAnchor="middle"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function ReadabilityHud({
  view,
  detail,
  density,
  edgeLevel,
  filter,
  onDetailChange,
  onDensityChange,
  onEdgeChange,
  onFilterChange
}: {
  view: ViewMode;
  detail: number;
  density: number;
  edgeLevel: number;
  filter: KeywordFilter;
  onDetailChange: (value: number) => void;
  onDensityChange: (value: number) => void;
  onEdgeChange: (value: number) => void;
  onFilterChange: (value: KeywordFilter) => void;
}) {
  return (
    <div className={styles.hud} data-map-control="true">
      <div className={styles.hudHeader}>
        <h2 className={styles.hudTitle}>
          <Sparkles size={13} aria-hidden="true" /> Readability lens
        </h2>
        <span className={styles.hudMode}>{VIEW_LABELS[view]}</span>
      </div>
      <p className={styles.hudIntro}>
        지도를 넓게 보고, 필요한 맥락만 단계적으로 여세요.
      </p>
      <RangeControl
        id="atlas-detail"
        label="Detail depth"
        output={DETAIL_LABELS[detail] ?? DETAIL_LABELS[1]}
        max={3}
        value={detail}
        onChange={onDetailChange}
      />
      <RangeControl
        id="atlas-density"
        label="Keyword density"
        output={DENSITY_LABELS[density] ?? DENSITY_LABELS[1]}
        max={4}
        value={density}
        onChange={onDensityChange}
      />
      <RangeControl
        id="atlas-edges"
        label="Edge clarity"
        output={EDGE_LABELS[edgeLevel] ?? EDGE_LABELS[1]}
        max={3}
        value={edgeLevel}
        onChange={onEdgeChange}
      />
      <div className={styles.filterChips} aria-label="키워드 타입 필터">
        {FILTER_ORDER.map((kind) => {
          const color = kind === "all" ? "#ff7067" : KIND_META[kind].color;
          return (
            <button
              type="button"
              key={kind}
              className={`${styles.filterButton} ${filter === kind ? styles.filterActive : ""}`}
              style={{ "--kind-color": color } as CSSProperties}
              aria-pressed={filter === kind}
              onClick={() => onFilterChange(kind)}
            >
              {kind === "all" ? "All" : KIND_META[kind].short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RangeControl({
  id,
  label,
  output,
  max,
  value,
  onChange
}: {
  id: string;
  label: string;
  output: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.control}>
      <label className={styles.controlLabel} htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id}>{output}</output>
      </label>
      <input
        className={styles.range}
        id={id}
        type="range"
        min="0"
        max={max}
        step="1"
        value={value}
        aria-valuetext={output}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Inspector({
  zone,
  topic,
  keywordContext,
  onPin,
  onKeywordSelect,
  onTopicSelect
}: {
  zone: AtlasZone;
  topic?: AtlasTopic;
  keywordContext?: { keyword: AtlasKeyword; topic: AtlasTopic };
  onPin: (payload: DragPayload) => void;
  onKeywordSelect: (keywordId: string) => void;
  onTopicSelect: (topicId: string) => void;
}) {
  if (keywordContext) {
    const { keyword, topic: parentTopic } = keywordContext;
    const parentZone = getZoneById(parentTopic.zoneId)!;
    return (
      <div
        className={styles.inspector}
        style={{ "--accent": KIND_META[keyword.kind].color } as CSSProperties}
      >
        <div className={styles.inspectorType}>
          {KIND_META[keyword.kind].label}
        </div>
        <h2 className={styles.inspectorTitle}>{keyword.label}</h2>
        <div className={styles.inspectorKo}>
          {parentTopic.ko} · {parentZone.ko}
        </div>
        <p className={styles.inspectorSummary}>{keyword.summary}</p>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>{parentZone.title}</span>
          <span className={styles.badge}>{KIND_META[keyword.kind].short}</span>
          <span className={styles.badge}>source-linked</span>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => onPin({ type: "keyword", id: keyword.id })}
        >
          <Pin size={12} /> Pin to evidence
        </button>
      </div>
    );
  }

  if (topic) {
    const topicZone = getZoneById(topic.zoneId)!;
    return (
      <div
        className={styles.inspector}
        style={{ "--accent": topicZone.color } as CSSProperties}
      >
        <div className={styles.inspectorType}>Topic hub</div>
        <h2 className={styles.inspectorTitle}>{topic.title}</h2>
        <div className={styles.inspectorKo}>
          {topic.ko} · {topicZone.ko}
        </div>
        <p className={styles.inspectorSummary}>{topic.summary}</p>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>{topic.keywordCount} keywords</span>
          <span className={styles.badge}>{topic.turnCount} atoms</span>
          <span className={styles.badge}>degree {topic.degree}</span>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => onPin({ type: "topic", id: topic.id })}
        >
          <Pin size={12} /> Pin topic
        </button>
        <div className={styles.tokenList} aria-label="대표 키워드">
          {topic.keywords.map((keyword) => (
            <button
              type="button"
              className={styles.token}
              key={keyword.id}
              onClick={() => onKeywordSelect(keyword.id)}
            >
              {keyword.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const zoneTopics = topicsForZone(zone.id);
  const keywordCount = zoneTopics.reduce(
    (sum, zoneTopic) => sum + zoneTopic.keywordCount,
    0
  );
  return (
    <div
      className={styles.inspector}
      style={{ "--accent": zone.color } as CSSProperties}
    >
      <div className={styles.inspectorType}>
        Territory {String(zone.num).padStart(2, "0")}
      </div>
      <h2 className={styles.inspectorTitle}>{zone.title}</h2>
      <div className={styles.inspectorKo}>{zone.ko}</div>
      <p className={styles.inspectorSummary}>{zone.summary}</p>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>{zoneTopics.length} topic hubs</span>
        <span className={styles.badge}>{keywordCount} keywords</span>
        <span className={styles.badge}>{zone.atomCount} atoms</span>
      </div>
      <div className={styles.tokenList} aria-label="영역의 토픽">
        {zoneTopics.map((zoneTopic) => (
          <button
            type="button"
            className={styles.token}
            key={zoneTopic.id}
            onClick={() => onTopicSelect(zoneTopic.id)}
          >
            {zoneTopic.title}
          </button>
        ))}
      </div>
    </div>
  );
}

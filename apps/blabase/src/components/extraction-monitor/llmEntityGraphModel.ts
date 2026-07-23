import type {
  EvidenceEvaluatedItem,
  EvidenceVerificationStatus,
  HybridExtractionResult,
  SemanticItemType
} from "@/core/types/semantic";

import type { MonitorTurn } from "./monitorModel";

export type LlmEntityGraphRelation =
  "core_layout" | "shared_evidence" | "same_turn";

export type LlmEntityGraphNode = {
  id: string;
  itemIds: string[];
  label: string;
  description: string;
  type: SemanticItemType;
  confidence: number;
  status: string | null;
  category: string | null;
  triggerPhrase: string | null;
  evidenceMessageIndexes: number[];
  turnIds: number[];
  verificationStatus: Exclude<EvidenceVerificationStatus, "rejected">;
  isCore: boolean;
  x: number;
  y: number;
};

export type LlmEntityGraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: LlmEntityGraphRelation;
  strength: number;
  sharedMessageIndexes: number[];
  sharedTurnIds: number[];
};

export type LlmEntityGraph = {
  coreNodeId: string | null;
  nodes: LlmEntityGraphNode[];
  edges: LlmEntityGraphEdge[];
  stats: {
    candidateCount: number;
    verifiedCount: number;
    reviewCount: number;
    rejectedCount: number;
    uniqueNodeCount: number;
    matchingNodeCount: number;
    displayedNodeCount: number;
    omittedNodeCount: number;
  };
};

export type LlmEntityGraphOptions = {
  query?: string;
  verificationStatus?: "all" | Exclude<EvidenceVerificationStatus, "rejected">;
};

type NodeDraft = Omit<LlmEntityGraphNode, "id" | "isCore" | "x" | "y"> & {
  key: string;
  searchTerms: string[];
};

const MAX_GRAPH_NODES = 19;

const CORE_TYPE_WEIGHT: Record<SemanticItemType, number> = {
  intent: 18,
  topic: 15,
  entity: 11,
  decision: 10,
  problem_signal: 8,
  action: 7,
  open_question: 7,
  change_event: 6,
  preference: 5,
  content_constraint: 5,
  relation: 4,
  satisfaction: 3
};

export function buildLlmEntityGraph(
  turns: MonitorTurn[],
  sprint5: HybridExtractionResult | null,
  options: LlmEntityGraphOptions = {}
): LlmEntityGraph {
  const stats = {
    candidateCount: sprint5?.evidenceDiagnostics.candidateCount ?? 0,
    verifiedCount: sprint5?.evidenceDiagnostics.verifiedItemCount ?? 0,
    reviewCount: sprint5?.evidenceDiagnostics.reviewItemCount ?? 0,
    rejectedCount: sprint5?.evidenceDiagnostics.rejectedItemCount ?? 0,
    uniqueNodeCount: 0,
    matchingNodeCount: 0,
    displayedNodeCount: 0,
    omittedNodeCount: 0
  };
  if (!sprint5) return { coreNodeId: null, nodes: [], edges: [], stats };

  const turnByMessageIndex = new Map<number, number>();
  for (const turn of turns) {
    for (const messageIndex of turn.scopeMessageIndexes) {
      turnByMessageIndex.set(messageIndex, turn.id);
    }
  }

  const drafts = groupCandidates(
    [...sprint5.verifiedItems, ...sprint5.reviewQueue],
    turnByMessageIndex
  );
  if (drafts.length === 0) {
    return { coreNodeId: null, nodes: [], edges: [], stats };
  }

  stats.uniqueNodeCount = drafts.length;
  const coreDraft = [...drafts].sort(
    (left, right) =>
      coreScore(right, drafts) - coreScore(left, drafts) ||
      left.label.localeCompare(right.label, "ko")
  )[0]!;
  const matchingDrafts = drafts.filter((draft) =>
    matchesOptions(draft, options)
  );
  stats.matchingNodeCount = matchingDrafts.length;
  const matchingSatellites = matchingDrafts.filter(
    (draft) => draft.key !== coreDraft.key
  );
  const selectedDrafts = [
    coreDraft,
    ...matchingSatellites
      .sort(
        (left, right) =>
          nodeScore(right, coreDraft) - nodeScore(left, coreDraft) ||
          left.label.localeCompare(right.label, "ko")
      )
      .slice(0, MAX_GRAPH_NODES - 1)
  ];
  stats.displayedNodeCount = selectedDrafts.length;
  stats.omittedNodeCount = Math.max(
    0,
    matchingSatellites.length - (selectedDrafts.length - 1)
  );
  const nodes = selectedDrafts.map((draft, index): LlmEntityGraphNode => {
    const position = graphPosition(index, selectedDrafts.length);
    return {
      id: `llm-entity-${slug(draft.key)}-${stableHash(draft.key)}`,
      itemIds: draft.itemIds,
      label: draft.label,
      description: draft.description,
      type: draft.type,
      confidence: draft.confidence,
      status: draft.status,
      category: draft.category,
      triggerPhrase: draft.triggerPhrase,
      evidenceMessageIndexes: draft.evidenceMessageIndexes,
      turnIds: draft.turnIds,
      verificationStatus: draft.verificationStatus,
      isCore: index === 0,
      x: position.x,
      y: position.y
    };
  });
  const coreNodeId = nodes[0]?.id ?? null;

  return {
    coreNodeId,
    nodes,
    edges: coreNodeId ? buildEdges(nodes, coreNodeId) : [],
    stats
  };
}

function groupCandidates(
  candidates: EvidenceEvaluatedItem[],
  turnByMessageIndex: Map<number, number>
): NodeDraft[] {
  const grouped = new Map<string, NodeDraft>();

  for (const item of candidates) {
    const verificationStatus = item.evidenceVerification.status;
    if (verificationStatus === "rejected") continue;
    const key = `${verificationStatus}:${item.type}:${normalizeLabel(item.label)}`;
    const evidenceMessageIndexes = uniqueSorted(item.evidenceMessageIndexes);
    const turnIds = uniqueSorted(
      evidenceMessageIndexes
        .map((index) => turnByMessageIndex.get(index))
        .filter((value): value is number => value !== undefined)
    );
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        key,
        itemIds: [item.id],
        label: item.label,
        description: item.description,
        type: item.type,
        confidence: item.confidence,
        status: item.status,
        category: item.category,
        triggerPhrase: item.triggerPhrase,
        evidenceMessageIndexes,
        turnIds,
        verificationStatus,
        searchTerms: candidateSearchTerms(item)
      });
      continue;
    }

    current.itemIds = [...new Set([...current.itemIds, item.id])];
    current.evidenceMessageIndexes = uniqueSorted([
      ...current.evidenceMessageIndexes,
      ...evidenceMessageIndexes
    ]);
    current.turnIds = uniqueSorted([...current.turnIds, ...turnIds]);
    current.searchTerms = [
      ...new Set([...current.searchTerms, ...candidateSearchTerms(item)])
    ];
    if (item.confidence > current.confidence) {
      current.label = item.label;
      current.description = item.description || current.description;
      current.status = item.status ?? current.status;
      current.category = item.category ?? current.category;
      current.triggerPhrase = item.triggerPhrase ?? current.triggerPhrase;
      current.confidence = item.confidence;
    }
  }

  return [...grouped.values()];
}

function coreScore(draft: NodeDraft, allDrafts: NodeDraft[]): number {
  const connectedStrength = allDrafts
    .filter((candidate) => candidate.key !== draft.key)
    .reduce(
      (total, candidate) => total + relationshipStrength(draft, candidate),
      0
    );
  return (
    CORE_TYPE_WEIGHT[draft.type] +
    verificationWeight(draft.verificationStatus) * 3 +
    draft.confidence * 4 +
    draft.evidenceMessageIndexes.length * 1.5 +
    connectedStrength * 0.65
  );
}

function nodeScore(draft: NodeDraft, coreDraft: NodeDraft): number {
  return (
    verificationWeight(draft.verificationStatus) * 4 +
    draft.confidence * 3 +
    draft.evidenceMessageIndexes.length * 1.25 +
    relationshipStrength(draft, coreDraft) * 2 +
    CORE_TYPE_WEIGHT[draft.type] * 0.2
  );
}

function relationshipStrength(left: NodeDraft, right: NodeDraft): number {
  return (
    intersection(left.evidenceMessageIndexes, right.evidenceMessageIndexes)
      .length *
      3 +
    intersection(left.turnIds, right.turnIds).length
  );
}

function buildEdges(
  nodes: LlmEntityGraphNode[],
  coreNodeId: string
): LlmEntityGraphEdge[] {
  const core = nodes.find((node) => node.id === coreNodeId);
  if (!core) return [];

  const coreEdges = nodes
    .filter((node) => node.id !== coreNodeId)
    .map((node) => edgeBetween(core, node, true));
  const secondaryEdges: LlmEntityGraphEdge[] = [];
  const nonCoreNodes = nodes.filter((node) => node.id !== coreNodeId);

  for (let leftIndex = 0; leftIndex < nonCoreNodes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < nonCoreNodes.length;
      rightIndex += 1
    ) {
      const left = nonCoreNodes[leftIndex]!;
      const right = nonCoreNodes[rightIndex]!;
      const sharedMessageIndexes = intersection(
        left.evidenceMessageIndexes,
        right.evidenceMessageIndexes
      );
      const sharedTurnIds = intersection(left.turnIds, right.turnIds);
      if (sharedMessageIndexes.length === 0 && sharedTurnIds.length === 0) {
        continue;
      }
      secondaryEdges.push(edgeBetween(left, right, false));
    }
  }

  return [
    ...coreEdges,
    ...secondaryEdges.sort((left, right) => right.strength - left.strength)
  ];
}

function edgeBetween(
  from: LlmEntityGraphNode,
  to: LlmEntityGraphNode,
  coreConnection: boolean
): LlmEntityGraphEdge {
  const sharedMessageIndexes = intersection(
    from.evidenceMessageIndexes,
    to.evidenceMessageIndexes
  );
  const sharedTurnIds = intersection(from.turnIds, to.turnIds);
  const relation: LlmEntityGraphRelation = coreConnection
    ? "core_layout"
    : sharedMessageIndexes.length > 0
      ? "shared_evidence"
      : "same_turn";

  return {
    id: `${from.id}:${to.id}`,
    from: from.id,
    to: to.id,
    relation,
    strength: Math.max(
      1,
      sharedMessageIndexes.length * 3 + sharedTurnIds.length
    ),
    sharedMessageIndexes,
    sharedTurnIds
  };
}

function graphPosition(index: number, total: number): { x: number; y: number } {
  if (index === 0) return { x: 50, y: 50 };

  const satelliteCount = Math.max(1, total - 1);
  const innerCount = Math.min(8, satelliteCount);
  const satelliteIndex = index - 1;
  const isInner = satelliteIndex < innerCount;
  const ringIndex = isInner ? satelliteIndex : satelliteIndex - innerCount;
  const ringCount = isInner ? innerCount : satelliteCount - innerCount;
  const angle =
    -Math.PI / 2 + (Math.PI * 2 * ringIndex) / Math.max(1, ringCount);
  const radiusX = isInner ? 27 : 39;
  const radiusY = isInner ? 29 : 37;

  return {
    x: Number((50 + Math.cos(angle) * radiusX).toFixed(2)),
    y: Number((50 + Math.sin(angle) * radiusY).toFixed(2))
  };
}

function verificationWeight(
  status: Exclude<EvidenceVerificationStatus, "rejected">
): number {
  return status === "verified" ? 3 : 1;
}

function normalizeLabel(value: string): string {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function slug(value: string): string {
  return normalizeLabel(value).replace(/\s+/g, "-").slice(0, 42) || "item";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function matchesOptions(draft: NodeDraft, options: LlmEntityGraphOptions) {
  const verificationStatus = options.verificationStatus ?? "all";
  if (
    verificationStatus !== "all" &&
    draft.verificationStatus !== verificationStatus
  ) {
    return false;
  }

  const query = normalizeLabel(options.query ?? "");
  if (!query) return true;
  return normalizeLabel(draft.searchTerms.join(" ")).includes(query);
}

function candidateSearchTerms(item: EvidenceEvaluatedItem): string[] {
  return [
    item.label,
    item.description,
    item.triggerPhrase,
    item.type,
    item.status,
    item.category
  ].filter((value): value is string => Boolean(value));
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function intersection(left: number[], right: number[]): number[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

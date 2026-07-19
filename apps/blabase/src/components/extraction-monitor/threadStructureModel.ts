import type {
  EvidenceVerificationStatus,
  HybridExtractionResult,
  SemanticItem,
  SemanticItemType
} from "@/core/types/semantic";

import type { MonitorTurn } from "./monitorModel";

export type StructureTone = "violet" | "teal" | "amber" | "rose" | "blue";

export type StructureNode = {
  id: string;
  label: string;
  description: string;
  type: SemanticItemType;
  tone: StructureTone;
  mentions: number;
  evidenceMessageIndexes: number[];
  turnIds: number[];
  source: "rule" | "llm" | "mixed";
  confidence: number;
  status: string | null;
  category: string | null;
  triggerPhrase: string | null;
  verificationStatus: EvidenceVerificationStatus | "rule_only";
  x: number;
  y: number;
};

export type StructureLink = {
  id: string;
  from: string;
  to: string;
  strength: number;
  sharedMessageIndexes: number[];
  sharedTurnIds: number[];
};

export type StructureFlowItem = {
  id: string;
  role: "user" | "assistant";
  turnId: number;
  messageIndex: number;
  title: string;
  text: string;
  tags: string[];
  createdAt: string | null;
};

export type ThreadStructure = {
  nodes: StructureNode[];
  links: StructureLink[];
  flow: StructureFlowItem[];
};

type Candidate = {
  item: SemanticItem;
  verificationStatus: EvidenceVerificationStatus | "rule_only";
};

type NodeDraft = Omit<StructureNode, "id" | "mentions" | "x" | "y"> & {
  key: string;
  sources: Set<SemanticItem["source"]>;
};

const MAX_NODES = 14;
const MAX_LINKS = 24;

const NODE_POSITIONS = [
  [18, 28],
  [39, 18],
  [62, 27],
  [82, 18],
  [15, 56],
  [40, 48],
  [67, 51],
  [84, 69],
  [55, 76],
  [29, 80],
  [9, 78],
  [72, 84],
  [91, 42],
  [48, 31]
] as const;

export function buildThreadStructure(
  turns: MonitorTurn[],
  sprint5: HybridExtractionResult | null
): ThreadStructure {
  const candidates = semanticCandidates(sprint5);
  const turnByMessageIndex = new Map<number, number>();
  for (const turn of turns) {
    for (const index of turn.scopeMessageIndexes) {
      turnByMessageIndex.set(index, turn.id);
    }
  }

  const grouped = new Map<string, NodeDraft>();
  for (const candidate of candidates) {
    const { item, verificationStatus } = candidate;
    const key = `${item.type}:${normalizeLabel(item.label)}`;
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
        label: item.label,
        description: item.description,
        type: item.type,
        tone: toneForType(item.type),
        evidenceMessageIndexes,
        turnIds,
        sources: new Set([item.source]),
        source: item.source,
        confidence: item.confidence,
        status: item.status,
        category: item.category,
        triggerPhrase: item.triggerPhrase,
        verificationStatus
      });
      continue;
    }

    current.evidenceMessageIndexes = uniqueSorted([
      ...current.evidenceMessageIndexes,
      ...evidenceMessageIndexes
    ]);
    current.turnIds = uniqueSorted([...current.turnIds, ...turnIds]);
    current.sources.add(item.source);
    current.source = current.sources.size > 1 ? "mixed" : item.source;
    current.confidence = Math.max(current.confidence, item.confidence);
    current.verificationStatus = strongerVerification(
      current.verificationStatus,
      verificationStatus
    );
    if (candidatePriority(candidate) >= nodePriority(current)) {
      current.description = item.description || current.description;
      current.status = item.status ?? current.status;
      current.category = item.category ?? current.category;
      current.triggerPhrase = item.triggerPhrase ?? current.triggerPhrase;
    }
  }

  const drafts = [...grouped.values()]
    .sort((left, right) => nodeScore(right) - nodeScore(left))
    .slice(0, MAX_NODES);
  const nodes = drafts.map((draft, index): StructureNode => {
    const position = NODE_POSITIONS[index] ?? [50, 50];
    return {
      id: `concept-${index + 1}-${slug(draft.key)}`,
      label: draft.label,
      description: draft.description,
      type: draft.type,
      tone: draft.tone,
      mentions: draft.evidenceMessageIndexes.length,
      evidenceMessageIndexes: draft.evidenceMessageIndexes,
      turnIds: draft.turnIds,
      source: draft.source,
      confidence: draft.confidence,
      status: draft.status,
      category: draft.category,
      triggerPhrase: draft.triggerPhrase,
      verificationStatus: draft.verificationStatus,
      x: position[0],
      y: position[1]
    };
  });
  const links = buildLinks(nodes);
  const flow = buildFlow(turns, nodes);

  return { nodes, links, flow };
}

function semanticCandidates(
  sprint5: HybridExtractionResult | null
): Candidate[] {
  if (!sprint5) return [];

  const evaluated = new Map(
    [
      ...sprint5.verifiedItems,
      ...sprint5.reviewQueue,
      ...sprint5.rejectedItems
    ].map((item) => [item.id, item.evidenceVerification.status])
  );

  const ruleCandidates = sprint5.ruleResult.items.map((item): Candidate => ({
    item,
    verificationStatus: "rule_only"
  }));
  const llmCandidates = sprint5.llmResult.items
    .map((item): Candidate => ({
      item,
      verificationStatus: evaluated.get(item.id) ?? "review_required"
    }))
    .filter((candidate) => candidate.verificationStatus !== "rejected");

  return [...ruleCandidates, ...llmCandidates];
}

function buildLinks(nodes: StructureNode[]): StructureLink[] {
  const links: StructureLink[] = [];

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < nodes.length;
      rightIndex += 1
    ) {
      const left = nodes[leftIndex]!;
      const right = nodes[rightIndex]!;
      const sharedMessageIndexes = intersection(
        left.evidenceMessageIndexes,
        right.evidenceMessageIndexes
      );
      const sharedTurnIds = intersection(left.turnIds, right.turnIds);
      const strength = sharedMessageIndexes.length * 3 + sharedTurnIds.length;
      if (strength === 0) continue;
      links.push({
        id: `${left.id}:${right.id}`,
        from: left.id,
        to: right.id,
        strength,
        sharedMessageIndexes,
        sharedTurnIds
      });
    }
  }

  return links
    .sort((left, right) => right.strength - left.strength)
    .slice(0, MAX_LINKS);
}

function buildFlow(
  turns: MonitorTurn[],
  nodes: StructureNode[]
): StructureFlowItem[] {
  return turns.flatMap((turn) => {
    const messages = [turn.user, turn.assistant].filter(
      (message): message is NonNullable<typeof message> => Boolean(message)
    );
    return messages.map((message): StructureFlowItem => {
      const tags = nodes
        .filter(
          (node) =>
            node.evidenceMessageIndexes.includes(message.index) ||
            node.turnIds.includes(turn.id)
        )
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 5)
        .map((node) => node.label);
      return {
        id: `turn-${turn.id}-${message.role}-${message.index}`,
        role: message.role === "user" ? "user" : "assistant",
        turnId: turn.id,
        messageIndex: message.index,
        title:
          message.role === "user"
            ? `Turn ${turn.id} · User prompt`
            : `Turn ${turn.id} · Assistant response`,
        text: message.text,
        tags,
        createdAt: message.createdAt
      };
    });
  });
}

function nodeScore(node: NodeDraft) {
  return (
    node.evidenceMessageIndexes.length * 4 +
    node.turnIds.length * 3 +
    node.confidence * 2 +
    verificationWeight(node.verificationStatus)
  );
}

function candidatePriority(candidate: Candidate) {
  return (
    verificationWeight(candidate.verificationStatus) * 10 +
    candidate.item.confidence
  );
}

function nodePriority(node: NodeDraft) {
  return verificationWeight(node.verificationStatus) * 10 + node.confidence;
}

function verificationWeight(status: EvidenceVerificationStatus | "rule_only") {
  if (status === "verified") return 4;
  if (status === "rule_only") return 3;
  if (status === "review_required") return 2;
  return 0;
}

function strongerVerification(
  left: EvidenceVerificationStatus | "rule_only",
  right: EvidenceVerificationStatus | "rule_only"
) {
  return verificationWeight(right) > verificationWeight(left) ? right : left;
}

function toneForType(type: SemanticItemType): StructureTone {
  if (["decision", "action", "satisfaction"].includes(type)) return "teal";
  if (["intent", "open_question", "change_event"].includes(type)) {
    return "amber";
  }
  if (["preference", "content_constraint", "problem_signal"].includes(type)) {
    return "rose";
  }
  if (["entity", "relation"].includes(type)) return "blue";
  return "violet";
}

function normalizeLabel(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function slug(value: string) {
  return normalizeLabel(value).replace(/\s+/g, "-").slice(0, 42) || "item";
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function intersection(left: number[], right: number[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

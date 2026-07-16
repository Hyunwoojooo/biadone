import type { CanonicalMessage } from "@/core/types/conversation";
import type {
  EvidenceEvaluatedItem,
  HybridExtractionResult,
  SemanticItem,
  SemanticItemType
} from "@/core/types/semantic";

export type MonitorMessage = Pick<
  CanonicalMessage,
  "id" | "index" | "role" | "text" | "blocks" | "sourceRef" | "metadata"
>;

export type MonitorTurn = {
  id: number;
  user: MonitorMessage;
  assistant: MonitorMessage | null;
  intermediateCleanMessages: MonitorMessage[];
  contextSignals: MonitorMessage[];
  excludedInternal: MonitorMessage[];
  scopeMessageIndexes: number[];
  startMessageIndex: number;
  endMessageIndex: number;
};

export type ComparisonVerdict = "Match" | "Rule only" | "LLM only" | "Conflict";

export type MonitorVerificationStatus = "Verified" | "Review" | "Rejected";

export type ComparisonRow = {
  id: string;
  type: SemanticItemType;
  ruleItem: SemanticItem | null;
  llmItem: SemanticItem | null;
  evaluatedLlmItem: EvidenceEvaluatedItem | null;
  verdict: ComparisonVerdict;
  verificationStatus: MonitorVerificationStatus;
  confidence: number;
  evidenceMessageIndexes: number[];
};

export type MonitorReviewRow = {
  id: string;
  itemId: string;
  type: SemanticItemType;
  label: string;
  source: "Rule Extractor" | "LLM Shadow";
  verificationStatus: "Review" | "Rejected";
  confidence: number;
  evidenceMessageIndexes: number[];
  issueCodes: string[];
  turnId: number | null;
};

export function buildMonitorTurns(messages: MonitorMessage[]): MonitorTurn[] {
  const ordered = [...messages].sort((left, right) => left.index - right.index);
  const cleanMessages = ordered.filter(
    (message) => message.metadata.messageCategory === "clean_conversation"
  );
  const userMessages = cleanMessages.filter(
    (message) => message.role === "user"
  );

  return userMessages.map((user, position) => {
    const nextUser = userMessages[position + 1];
    const boundary = nextUser?.index ?? Number.POSITIVE_INFINITY;
    const scopedMessages = ordered.filter(
      (message) => message.index >= user.index && message.index < boundary
    );
    const scopedCleanAssistants = scopedMessages.filter(
      (message) =>
        message.metadata.messageCategory === "clean_conversation" &&
        message.role === "assistant"
    );
    const assistant = findFinalAssistant(scopedCleanAssistants);
    const intermediateCleanMessages = scopedCleanAssistants.filter(
      (message) => message.id !== assistant?.id
    );
    const endMessageIndex = Math.max(
      user.index,
      ...scopedMessages.map((message) => message.index)
    );

    return {
      id: position + 1,
      user,
      assistant,
      intermediateCleanMessages,
      contextSignals: scopedMessages.filter(
        (message) => message.metadata.messageCategory === "context_signal"
      ),
      excludedInternal: scopedMessages.filter(
        (message) => message.metadata.messageCategory === "excluded_internal"
      ),
      scopeMessageIndexes: scopedMessages
        .filter(
          (message) => message.metadata.messageCategory === "clean_conversation"
        )
        .map((message) => message.index),
      startMessageIndex: user.index,
      endMessageIndex
    };
  });
}

export function buildComparisonRows(
  turn: MonitorTurn,
  sprint5: HybridExtractionResult
): ComparisonRow[] {
  const scopedIndexes = new Set(turn.scopeMessageIndexes);
  const ruleItems = sprint5.ruleResult.items.filter((item) =>
    item.evidenceMessageIndexes.some((index) => scopedIndexes.has(index))
  );
  const llmItems = sprint5.llmResult.items.filter((item) =>
    item.evidenceMessageIndexes.some((index) => scopedIndexes.has(index))
  );
  const evaluatedById = evaluatedItemMap(sprint5);
  const rows: ComparisonRow[] = [];

  for (const type of semanticTypesIn(ruleItems, llmItems)) {
    const unmatchedRule = ruleItems.filter((item) => item.type === type);
    const unmatchedLlm = llmItems.filter((item) => item.type === type);

    while (unmatchedRule.length > 0) {
      const ruleItem = unmatchedRule.shift() ?? null;
      if (!ruleItem) continue;
      const llmIndex = bestLlmMatchIndex(ruleItem, unmatchedLlm);
      const llmItem =
        llmIndex >= 0 ? (unmatchedLlm.splice(llmIndex, 1)[0] ?? null) : null;
      rows.push(createComparisonRow(ruleItem, llmItem, evaluatedById));
    }

    for (const llmItem of unmatchedLlm) {
      rows.push(createComparisonRow(null, llmItem, evaluatedById));
    }
  }

  return rows.sort((left, right) => {
    const typeOrder =
      SEMANTIC_TYPE_ORDER.indexOf(left.type) -
      SEMANTIC_TYPE_ORDER.indexOf(right.type);
    if (typeOrder !== 0) return typeOrder;
    return right.confidence - left.confidence;
  });
}

export function buildReviewRows(
  turns: MonitorTurn[],
  sprint5: HybridExtractionResult
): MonitorReviewRow[] {
  const llmRows = [...sprint5.reviewQueue, ...sprint5.rejectedItems].map(
    (item): MonitorReviewRow => ({
      id: `llm-review-${item.id}`,
      itemId: item.id,
      type: item.type,
      label: item.label,
      source: "LLM Shadow",
      verificationStatus:
        item.evidenceVerification.status === "rejected" ? "Rejected" : "Review",
      confidence: item.confidence,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      issueCodes: item.evidenceVerification.issues.map((issue) => issue.code),
      turnId: turnIdForEvidence(turns, item.evidenceMessageIndexes)
    })
  );
  const ruleRows = sprint5.ruleResult.items
    .filter((item) => item.reviewRequired)
    .map((item): MonitorReviewRow => ({
      id: `rule-review-${item.id}`,
      itemId: item.id,
      type: item.type,
      label: item.label,
      source: "Rule Extractor",
      verificationStatus: "Review",
      confidence: item.confidence,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      issueCodes: ["RULE_REVIEW_REQUIRED"],
      turnId: turnIdForEvidence(turns, item.evidenceMessageIndexes)
    }));

  return [...llmRows, ...ruleRows].sort((left, right) => {
    if (left.verificationStatus !== right.verificationStatus) {
      return left.verificationStatus === "Rejected" ? -1 : 1;
    }
    return left.confidence - right.confidence;
  });
}

export function countSemanticTypes(
  items: SemanticItem[]
): Partial<Record<SemanticItemType, number>> {
  return items.reduce<Partial<Record<SemanticItemType, number>>>(
    (counts, item) => {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
      return counts;
    },
    {}
  );
}

export const SEMANTIC_TYPE_ORDER: SemanticItemType[] = [
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

function findFinalAssistant(messages: MonitorMessage[]): MonitorMessage | null {
  return (
    [...messages]
      .reverse()
      .find((message) =>
        ["final_answer", "final_answer_with_artifact"].includes(
          message.metadata.assistantMessageType ?? ""
        )
      ) ??
    messages.at(-1) ??
    null
  );
}

function evaluatedItemMap(sprint5: HybridExtractionResult) {
  return new Map(
    [
      ...sprint5.verifiedItems,
      ...sprint5.reviewQueue,
      ...sprint5.rejectedItems
    ].map((item) => [item.id, item])
  );
}

function semanticTypesIn(ruleItems: SemanticItem[], llmItems: SemanticItem[]) {
  const types = new Set([...ruleItems, ...llmItems].map((item) => item.type));
  return SEMANTIC_TYPE_ORDER.filter((type) => types.has(type));
}

function bestLlmMatchIndex(
  ruleItem: SemanticItem,
  llmItems: SemanticItem[]
): number {
  if (llmItems.length === 0) return -1;
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  llmItems.forEach((item, index) => {
    const score = comparisonScore(ruleItem, item);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function comparisonScore(
  ruleItem: SemanticItem,
  llmItem: SemanticItem
): number {
  const evidenceOverlap = ruleItem.evidenceMessageIndexes.filter((index) =>
    llmItem.evidenceMessageIndexes.includes(index)
  ).length;
  const statusMatch =
    ruleItem.status && llmItem.status && ruleItem.status === llmItem.status
      ? 2
      : 0;
  return (
    evidenceOverlap * 10 +
    statusMatch +
    labelSimilarity(ruleItem.label, llmItem.label)
  );
}

function createComparisonRow(
  ruleItem: SemanticItem | null,
  llmItem: SemanticItem | null,
  evaluatedById: Map<string, EvidenceEvaluatedItem>
): ComparisonRow {
  const evaluatedLlmItem = llmItem
    ? (evaluatedById.get(llmItem.id) ?? null)
    : null;
  const verdict = comparisonVerdict(ruleItem, llmItem);
  const verificationStatus = resolveVerificationStatus(
    verdict,
    ruleItem,
    evaluatedLlmItem
  );
  const type = ruleItem?.type ?? llmItem?.type;
  if (!type)
    throw new Error("Comparison row requires at least one semantic item.");

  return {
    id: `${type}:${ruleItem?.id ?? "none"}:${llmItem?.id ?? "none"}`,
    type,
    ruleItem,
    llmItem,
    evaluatedLlmItem,
    verdict,
    verificationStatus,
    confidence: llmItem?.confidence ?? ruleItem?.confidence ?? 0,
    evidenceMessageIndexes: [
      ...new Set([
        ...(ruleItem?.evidenceMessageIndexes ?? []),
        ...(llmItem?.evidenceMessageIndexes ?? [])
      ])
    ].sort((left, right) => left - right)
  };
}

function comparisonVerdict(
  ruleItem: SemanticItem | null,
  llmItem: SemanticItem | null
): ComparisonVerdict {
  if (!ruleItem) return "LLM only";
  if (!llmItem) return "Rule only";
  if (ruleItem.status && llmItem.status && ruleItem.status !== llmItem.status) {
    return "Conflict";
  }
  const evidenceOverlap = ruleItem.evidenceMessageIndexes.some((index) =>
    llmItem.evidenceMessageIndexes.includes(index)
  );
  if (
    !evidenceOverlap &&
    labelSimilarity(ruleItem.label, llmItem.label) < 0.2
  ) {
    return "Conflict";
  }
  return "Match";
}

function resolveVerificationStatus(
  verdict: ComparisonVerdict,
  ruleItem: SemanticItem | null,
  evaluatedLlmItem: EvidenceEvaluatedItem | null
): MonitorVerificationStatus {
  if (evaluatedLlmItem) {
    const status = evaluatedLlmItem.evidenceVerification.status;
    if (status === "rejected") return "Rejected";
    if (status === "review_required") return "Review";
    if (verdict === "Conflict") return "Review";
    return "Verified";
  }
  if (ruleItem?.reviewRequired || verdict === "Conflict") return "Review";
  return "Verified";
}

function labelSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizedTokens(left));
  const rightTokens = new Set(normalizedTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function turnIdForEvidence(
  turns: MonitorTurn[],
  evidenceMessageIndexes: number[]
): number | null {
  return (
    turns.find((turn) =>
      evidenceMessageIndexes.some((index) =>
        turn.scopeMessageIndexes.includes(index)
      )
    )?.id ?? null
  );
}

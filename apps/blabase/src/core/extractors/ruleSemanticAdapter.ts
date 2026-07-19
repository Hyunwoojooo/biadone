import type { MockStructureResult } from "../types/structures";
import type { SemanticItem, SemanticItemType } from "../types/semantic";

export function convertRuleResultToSemanticItems(
  result: MockStructureResult
): SemanticItem[] {
  const items: SemanticItem[] = [];
  const add = (
    type: SemanticItemType,
    input: {
      sourceItemId: string;
      label: string;
      description: string;
      status?: string | null;
      category?: string | null;
      triggerPhrase?: string | null;
      evidenceMessageIndexes: number[];
      confidence: number;
      reviewRequired?: boolean;
    }
  ) => {
    items.push({
      id: `rule_${type}_${String(items.length + 1).padStart(3, "0")}`,
      type,
      source: "rule",
      sourceItemId: input.sourceItemId,
      label: input.label,
      description: input.description,
      status: input.status ?? null,
      category: input.category ?? null,
      triggerPhrase: input.triggerPhrase ?? null,
      evidenceMessageIndexes: input.evidenceMessageIndexes,
      confidence: input.confidence,
      reviewRequired: input.reviewRequired ?? input.confidence < 0.75
    });
  };

  add("intent", {
    sourceItemId: "overview",
    label: result.overview.userCoreIntent,
    description: result.overview.mainSubject,
    status: result.overview.currentStatus,
    evidenceMessageIndexes: result.overview.evidenceMessageIndexes,
    confidence: result.overview.confidence
  });

  for (const topic of result.topicFlow) {
    add("topic", {
      sourceItemId: topic.id,
      label: topic.label,
      description: topic.summary,
      category: topic.changeReason,
      evidenceMessageIndexes: topic.evidenceMessageIndexes,
      confidence: topic.confidence
    });
  }
  for (const item of result.board.decisions) {
    add("decision", {
      sourceItemId: item.id,
      label: item.title,
      description: item.description,
      status: item.status,
      category: item.source,
      triggerPhrase: item.triggerPhrase,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence,
      reviewRequired: item.reviewRequired
    });
  }
  for (const item of result.board.openQuestions) {
    add("open_question", {
      sourceItemId: item.id,
      label: item.question,
      description: item.description,
      status: item.status,
      triggerPhrase: item.triggerPhrase,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence,
      reviewRequired: item.reviewRequired
    });
  }
  for (const item of result.board.actions) {
    add("action", {
      sourceItemId: item.id,
      label: item.title,
      description: item.description,
      status: item.status,
      category: item.actionType,
      triggerPhrase: item.triggerPhrase,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence,
      reviewRequired: item.reviewRequired
    });
  }
  for (const item of result.preferenceSignals) {
    add("preference", {
      sourceItemId: item.id,
      label: item.normalizedLabel,
      description: item.description,
      status: item.polarity,
      category: item.category,
      triggerPhrase: item.triggerPhrase,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence
    });
  }
  for (const item of result.contentConstraints) {
    add("content_constraint", {
      sourceItemId: item.id,
      label: item.title,
      description: item.description,
      category: item.constraintType,
      triggerPhrase: item.triggerPhrase,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence,
      reviewRequired: item.reviewRequired
    });
  }
  for (const item of result.problemSignals) {
    add("problem_signal", {
      sourceItemId: item.id,
      label: item.title,
      description: item.triggerPhrase,
      category: item.category,
      triggerPhrase: item.triggerPhrase,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence
    });
  }
  for (const item of result.satisfactionSignals) {
    add("satisfaction", {
      sourceItemId: item.id,
      label: item.status,
      description: item.rationale,
      status: item.status,
      evidenceMessageIndexes: item.evidenceMessageIndexes,
      confidence: item.confidence,
      reviewRequired: item.reviewRequired
    });
  }

  return items;
}

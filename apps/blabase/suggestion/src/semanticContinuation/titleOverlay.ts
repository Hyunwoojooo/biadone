import type { AttentionCodeProvenance } from "../attention/codeProvenance";
import type { WorkSuggestionBoardPublic } from "../suggestionBoard/contracts";
import { workSuggestionBoardPublicSchema } from "../suggestionBoard/contracts";
import {
  SEMANTIC_CONTINUATION_PRESENTATION_CONTRACT,
  SEMANTIC_CONTINUATION_PRESENTATION_SCHEMA_VERSION,
  semanticContinuationConfirmationTargetSchema,
  semanticContinuationIntentStoreSchema,
  semanticContinuationTitle,
  semanticContinuationTitlePresentationSchema,
  type SemanticContinuationConfirmationTarget,
  type SemanticContinuationIntentDecision,
  type SemanticContinuationTitlePresentation
} from "./contracts";
import {
  resolveSemanticValidationDisplayTitle
} from "./validation/resolveReceipt";
import type { SemanticValidationStore } from "./validation/contracts";

export function findSemanticContinuationConfirmationTarget(
  boardInput: unknown,
  input: { itemRef: string; workContextRef: string }
): SemanticContinuationConfirmationTarget | null {
  const parsed = workSuggestionBoardPublicSchema.safeParse(boardInput);
  if (!parsed.success || parsed.data.continuationStatus !== "available") {
    return null;
  }
  const entry = boardEntries(parsed.data).find(
    (candidate) =>
      candidate.lane === "continuation" &&
      candidate.item.itemRef === input.itemRef &&
      candidate.item.workContextRef === input.workContextRef &&
      candidate.item.capability === "display" &&
      candidate.item.action === null
  );
  if (
    entry === undefined ||
    entry.lane !== "continuation" ||
    entry.item.workContextRef === null ||
    entry.item.observedAt === null ||
    entry.item.expiresAt === null
  ) {
    return null;
  }
  const target = semanticContinuationConfirmationTargetSchema.safeParse({
    itemRef: entry.item.itemRef,
    workContextRef: entry.item.workContextRef,
    observedAt: entry.item.observedAt,
    candidateExpiresAt: entry.item.expiresAt
  });
  return target.success ? target.data : null;
}

/**
 * Builds a separate display-title envelope without mutating the base public
 * Board. Invalid, stale, mismatched, or absent private state returns null.
 */
export function buildSemanticContinuationTitlePresentation(input: {
  board: WorkSuggestionBoardPublic;
  registrySha256: string;
  store: unknown;
  validationStore?: SemanticValidationStore | null;
  currentCodeProvenance?: AttentionCodeProvenance | null;
}): SemanticContinuationTitlePresentation | null {
  const base = workSuggestionBoardPublicSchema.safeParse(input.board);
  const store = semanticContinuationIntentStoreSchema.safeParse(input.store);
  if (!base.success || !store.success) return null;
  const supersededIds = new Set(
    store.data.decisions.flatMap((decision) =>
      decision.supersedesDecisionId === null
        ? []
        : [decision.supersedesDecisionId]
    )
  );
  const current = store.data.decisions
    .filter(
      (decision) =>
        !supersededIds.has(decision.decisionId) &&
        decision.registrySha256 === input.registrySha256 &&
        Date.parse(decision.confirmedAt) <= Date.parse(base.data.generatedAt) &&
        Date.parse(base.data.generatedAt) < Date.parse(decision.expiresAt)
    )
    .sort(compareCurrentDecision)
    .reverse();
  const overlays = boardEntries(base.data).flatMap((entry) => {
    if (
      entry.lane !== "continuation" ||
      entry.item.workContextRef === null ||
      entry.item.observedAt === null ||
      entry.item.expiresAt === null ||
      entry.item.capability !== "display" ||
      entry.item.action !== null
    ) {
      return [];
    }
    const decision = current.find(
      (candidate) =>
        candidate.itemRef === entry.item.itemRef &&
        candidate.workContextRef === entry.item.workContextRef &&
        candidate.targetObservedAt === entry.item.observedAt &&
        candidate.targetCandidateExpiresAt === entry.item.expiresAt
    );
    return decision === undefined
      ? []
      : [
          {
            itemRef: entry.item.itemRef,
            displayTitle:
              input.validationStore !== undefined &&
              input.validationStore !== null &&
              input.currentCodeProvenance !== undefined &&
              input.currentCodeProvenance !== null
                ? resolveSemanticValidationDisplayTitle({
                    store: input.validationStore,
                    intent: decision,
                    currentCodeProvenance: input.currentCodeProvenance,
                    asOf: base.data.generatedAt
                  }) ?? semanticContinuationTitle(decision.subjectLabel)
                : semanticContinuationTitle(decision.subjectLabel)
          }
        ];
  });
  if (overlays.length === 0) return null;
  return semanticContinuationTitlePresentationSchema.parse({
    contract: SEMANTIC_CONTINUATION_PRESENTATION_CONTRACT,
    schemaVersion: SEMANTIC_CONTINUATION_PRESENTATION_SCHEMA_VERSION,
    baseGeneratedAt: base.data.generatedAt,
    overlays
  });
}

function boardEntries(board: WorkSuggestionBoardPublic) {
  return [
    ...(board.primary === null ? [] : [board.primary]),
    ...board.alternatives
  ];
}

function compareCurrentDecision(
  left: SemanticContinuationIntentDecision,
  right: SemanticContinuationIntentDecision
): number {
  return left.confirmedAt < right.confirmedAt
    ? -1
    : left.confirmedAt > right.confirmedAt
      ? 1
      : left.decisionId < right.decisionId
        ? -1
        : left.decisionId > right.decisionId
          ? 1
          : 0;
}

import type { AttentionCodeProvenance } from "../attention/codeProvenance";
import type { WorkSuggestionBoardPublic } from "../suggestionBoard/contracts";
import { workSuggestionBoardPublicSchema } from "../suggestionBoard/contracts";
import {
  SEMANTIC_CONTINUATION_INTENT_CONTRACT,
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
    candidateKind: entry.item.kind,
    evidenceBand: entry.item.evidenceBand,
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
  const allEntries = boardEntries(base.data);
  const entries = allEntries.filter(isOverlayEligibleEntry);
  const matches = current.flatMap((decision) => {
    const match = matchSemanticContinuationDecision(
      decision,
      entries,
      allEntries,
      base.data.generatedAt
    );
    return match === null ? [] : [{ decision, ...match }];
  });
  const overlays = entries.flatMap((entry) => {
    const match = matches.find(
      (candidate) => candidate.entry.item.itemRef === entry.item.itemRef
    );
    return match === undefined
      ? []
      : [
          {
            itemRef: entry.item.itemRef,
            displayTitle:
              match.kind === "exact" &&
              input.validationStore !== undefined &&
              input.validationStore !== null &&
              input.currentCodeProvenance !== undefined &&
              input.currentCodeProvenance !== null
                ? resolveSemanticValidationDisplayTitle({
                    store: input.validationStore,
                    intent: match.decision,
                    currentCodeProvenance: input.currentCodeProvenance,
                    asOf: base.data.generatedAt
                  }) ??
                  semanticContinuationTitle(match.decision.subjectLabel)
                : semanticContinuationTitle(match.decision.subjectLabel)
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

type BoardEntry = ReturnType<typeof boardEntries>[number];

function isOverlayEligibleEntry(entry: BoardEntry): boolean {
  return (
    entry.lane === "continuation" &&
    entry.item.workContextRef !== null &&
    entry.item.observedAt !== null &&
    entry.item.expiresAt !== null &&
    entry.item.capability === "display" &&
    entry.item.action === null
  );
}

function matchSemanticContinuationDecision(
  decision: SemanticContinuationIntentDecision,
  entries: BoardEntry[],
  allEntries: BoardEntry[],
  generatedAt: string
): { kind: "exact" | "rebound"; entry: BoardEntry } | null {
  const exact = entries.find(
    (entry) =>
      decision.itemRef === entry.item.itemRef &&
      decision.workContextRef === entry.item.workContextRef &&
      decision.targetObservedAt === entry.item.observedAt &&
      decision.targetCandidateExpiresAt === entry.item.expiresAt &&
      (decision.contract !== SEMANTIC_CONTINUATION_INTENT_CONTRACT ||
        (decision.targetCandidateKind === entry.item.kind &&
          decision.targetEvidenceBand === entry.item.evidenceBand))
  );
  if (exact !== undefined) return { kind: "exact", entry: exact };
  if (
    decision.contract !== SEMANTIC_CONTINUATION_INTENT_CONTRACT ||
    decision.targetCandidateKind !== "linked_workstream" ||
    decision.targetEvidenceBand !== "corroborated" ||
    allEntries.some((entry) => entry.item.itemRef === decision.itemRef)
  ) {
    return null;
  }
  const candidates = entries.filter(
    (entry) =>
      entry.lane === "continuation" &&
      entry.item.kind === "linked_workstream" &&
      entry.item.evidenceBand === "corroborated" &&
      entry.item.workContextRef === decision.workContextRef &&
      entry.item.expiresAt === decision.targetCandidateExpiresAt &&
      entry.item.observedAt !== null &&
      Date.parse(entry.item.observedAt) >
        Date.parse(decision.targetObservedAt) &&
      Date.parse(entry.item.observedAt) <= Date.parse(generatedAt) &&
      entry.item.expiresAt !== null &&
      Date.parse(generatedAt) < Date.parse(entry.item.expiresAt)
  );
  return candidates.length === 1
    ? { kind: "rebound", entry: candidates[0]! }
    : null;
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

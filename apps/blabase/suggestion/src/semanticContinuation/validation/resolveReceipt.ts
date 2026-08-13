import type { AttentionCodeProvenance } from "../../attention/codeProvenance";
import type { SemanticContinuationIntentDecision } from "../contracts";
import {
  normalizeSemanticValidationCodeProvenance,
  isUsableSemanticValidationCodeProvenance,
  sameSemanticValidationCodeProvenance,
  semanticValidationBindingForIntent,
  semanticValidationStoreSchema,
  type SemanticValidationReceipt,
  type SemanticValidationStore
} from "./contracts";
import { SEMANTIC_VALIDATION_TITLES } from "./versions";

export function resolveSemanticValidationDisplayTitle(input: {
  store: SemanticValidationStore;
  intent: SemanticContinuationIntentDecision;
  currentCodeProvenance: AttentionCodeProvenance;
  asOf: string;
}): string | null {
  const store = semanticValidationStoreSchema.safeParse(input.store);
  if (!store.success) return null;
  const receipt = currentReceipt(store.data);
  if (
    receipt === null ||
    !bindingMatchesIntent(receipt, input.intent) ||
    Date.parse(receipt.startedAt) > Date.parse(input.asOf) ||
    Date.parse(input.asOf) >= Date.parse(receipt.expiresAt)
  ) {
    return null;
  }
  const currentCodeProvenance = normalizeSemanticValidationCodeProvenance(
    input.currentCodeProvenance
  );
  if (
    !isUsableSemanticValidationCodeProvenance(
      receipt.startedCodeProvenance
    ) ||
    !isUsableSemanticValidationCodeProvenance(currentCodeProvenance) ||
    !sameSemanticValidationCodeProvenance(
      receipt.startedCodeProvenance,
      currentCodeProvenance
    )
  ) {
    return null;
  }
  if (receipt.status === "running") {
    return SEMANTIC_VALIDATION_TITLES.running;
  }
  if (
    receipt.completedAt === null ||
    Date.parse(receipt.completedAt) > Date.parse(input.asOf) ||
    receipt.endedCodeProvenance === null ||
    !sameSemanticValidationCodeProvenance(
      receipt.endedCodeProvenance,
      currentCodeProvenance
    )
  ) {
    return null;
  }
  return receipt.status === "passed"
    ? SEMANTIC_VALIDATION_TITLES.passed
    : receipt.status === "failed"
      ? SEMANTIC_VALIDATION_TITLES.failed
      : null;
}

function currentReceipt(
  store: SemanticValidationStore
): SemanticValidationReceipt | null {
  if (
    store.currentRunId === null ||
    store.currentReceiptSha256 === null
  ) {
    return null;
  }
  return (
    [...store.receipts]
      .reverse()
      .find(
        (receipt) =>
          receipt.runId === store.currentRunId &&
          receipt.receiptSha256 === store.currentReceiptSha256
      ) ?? null
  );
}

function bindingMatchesIntent(
  receipt: SemanticValidationReceipt,
  intent: SemanticContinuationIntentDecision
): boolean {
  return (
    JSON.stringify(receipt.binding) ===
    JSON.stringify(semanticValidationBindingForIntent(intent))
  );
}

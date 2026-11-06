import { describe, expect, it } from "vitest";

import {
  buildSemanticContinuationTitlePresentation,
  createEmptySemanticContinuationIntentStore,
  createSemanticContinuationIntentDecision,
  findSemanticContinuationConfirmationTarget,
  sealSemanticContinuationIntentStore
} from "../src/semanticContinuation";
import {
  appendSemanticValidationReceipt,
  createEmptySemanticValidationStore,
  createSemanticValidationRunningReceipt,
  createSemanticValidationTerminalReceipt,
  semanticValidationBindingForIntent,
  type SemanticValidationReceipt,
  type SemanticValidationStepResult,
  type SemanticValidationStore
} from "../src/semanticContinuation/validation";
import {
  workSuggestionBoardPublicSchema,
  type WorkSuggestionBoardPublic
} from "../src/suggestionBoard/contracts";

const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const NEW_ITEM_REF = `item_ref_${"c".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const REGISTRY_SHA = "f".repeat(64);
const INSTALLATION_SECRET = "e".repeat(64);
const CODE = {
  kind: "clean" as const,
  codeState: "clean_commit" as const,
  codeCommitSha: "c".repeat(40),
  codeFingerprintSha256: null
};

describe("Semantic validation presentation resolver", () => {
  it("projects only the fixed running, failed, and passed titles", () => {
    const board = genericBoard();
    const { store: intentStore, decision } = intentStoreFor(board);

    const running = runningStore(decision, "1".repeat(32), null);
    expect(title(board, intentStore, running)).toBe(
      "QA 진행 상태 확인하기"
    );

    const failed = terminalStore(
      running,
      "failed",
      "STEP_FAILED",
      failedSteps(),
      CODE,
      "2026-08-13T12:03:00.000Z"
    );
    expect(title(board, intentStore, failed)).toBe(
      "QA 실패 항목 검토하기"
    );

    const passedRun = runningStore(
      decision,
      "2".repeat(32),
      failed,
      "2026-08-13T12:04:00.000Z"
    );
    const passed = terminalStore(
      passedRun,
      "passed",
      null,
      passedSteps(),
      CODE,
      "2026-08-13T12:04:30.000Z"
    );
    expect(title(board, intentStore, passed)).toBe(
      "QA 통과 결과 확인하기"
    );
  });

  it("lets a newer run shadow an older pass and never resurrects it", () => {
    const board = genericBoard();
    const { store: intentStore, decision } = intentStoreFor(board);
    const firstRun = runningStore(
      decision,
      "1".repeat(32),
      null,
      "2026-08-13T12:01:00.000Z"
    );
    const oldPass = terminalStore(
      firstRun,
      "passed",
      null,
      passedSteps(),
      CODE,
      "2026-08-13T12:02:00.000Z"
    );
    const newRun = runningStore(
      decision,
      "2".repeat(32),
      oldPass,
      "2026-08-13T12:04:00.000Z"
    );

    expect(title(board, intentStore, newRun)).toBe(
      "QA 진행 상태 확인하기"
    );

    const changedCode = {
      ...CODE,
      codeCommitSha: "d".repeat(40)
    };
    const inconclusive = terminalStore(
      newRun,
      "inconclusive",
      "CODE_PROVENANCE_CHANGED",
      passedSteps(),
      changedCode,
      "2026-08-13T12:04:30.000Z"
    );
    expect(title(board, intentStore, inconclusive)).toBe(
      "blabase QA 진행하기"
    );
  });

  it("falls back for code drift, stale time, or a mismatched binding", () => {
    const board = genericBoard();
    const { store: intentStore, decision } = intentStoreFor(board);
    const run = runningStore(decision, "3".repeat(32), null);
    const passed = terminalStore(
      run,
      "passed",
      null,
      passedSteps(),
      CODE,
      "2026-08-13T12:03:00.000Z"
    );

    expect(
      title(board, intentStore, passed, {
        ...CODE,
        codeCommitSha: "d".repeat(40)
      })
    ).toBe("blabase QA 진행하기");
    expect(
      title(
        { ...board, generatedAt: "2026-08-13T12:00:30.000Z" },
        intentStore,
        passed
      )
    ).toBe("blabase QA 진행하기");

    const tampered = structuredClone(passed);
    tampered.currentRunId = "semantic_validation_run_mismatch";
    expect(title(board, intentStore, tampered)).toBe(
      "blabase QA 진행하기"
    );
    expect(board.primary?.item.title).toBe("Recent GitHub activity");
    expect(board.primary?.item.summary).toBe("Recent GitHub activity");
  });

  it("does not transfer an exact-target QA receipt title onto a rebound snapshot", () => {
    const board = genericBoard();
    const { store: intentStore, decision } = intentStoreFor(board);
    const running = runningStore(decision, "4".repeat(32), null);
    const passed = terminalStore(
      running,
      "passed",
      null,
      passedSteps(),
      CODE,
      "2026-08-13T12:03:00.000Z"
    );
    const rebound = workSuggestionBoardPublicSchema.parse({
      ...board,
      primary: board.primary && {
        ...board.primary,
        item: {
          ...board.primary.item,
          itemRef: NEW_ITEM_REF,
          observedAt: "2026-08-13T10:01:00.000Z"
        }
      }
    });

    expect(title(rebound, intentStore, passed)).toBe(
      "blabase QA 진행하기"
    );
  });
});

function title(
  board: WorkSuggestionBoardPublic,
  intentStore: ReturnType<typeof intentStoreFor>["store"],
  validationStore: SemanticValidationStore,
  code = CODE
): string | null {
  return (
    buildSemanticContinuationTitlePresentation({
      board,
      registrySha256: REGISTRY_SHA,
      store: intentStore,
      validationStore,
      currentCodeProvenance: code
    })?.overlays[0]?.displayTitle ?? null
  );
}

function runningStore(
  decision: ReturnType<typeof intentStoreFor>["decision"],
  suffix: string,
  existing: SemanticValidationStore | null,
  startedAt = "2026-08-13T12:01:00.000Z"
): SemanticValidationStore {
  const store =
    existing ??
    createEmptySemanticValidationStore({
      createdAt: startedAt,
      installationSecret: INSTALLATION_SECRET
    });
  const running = createSemanticValidationRunningReceipt({
    receiptRevision: store.revision + 1,
    previousReceiptSha256: store.receipts.at(-1)?.receiptSha256 ?? null,
    runId: `semantic_validation_run_${suffix.slice(0, 32)}`,
    binding: semanticValidationBindingForIntent(decision),
    startedCodeProvenance: CODE,
    startedAt,
    installationSecret: INSTALLATION_SECRET
  });
  return appendSemanticValidationReceipt({
    store,
    receipt: running,
    installationSecret: INSTALLATION_SECRET
  });
}

function terminalStore(
  store: SemanticValidationStore,
  status: "passed" | "failed" | "inconclusive",
  statusReasonCode: SemanticValidationReceipt["statusReasonCode"],
  stepResults: SemanticValidationStepResult[],
  endedCodeProvenance: typeof CODE,
  completedAt: string
): SemanticValidationStore {
  const running = store.receipts.at(-1)!;
  const terminal = createSemanticValidationTerminalReceipt({
    runningReceipt: running,
    receiptRevision: store.revision + 1,
    previousReceiptSha256: running.receiptSha256,
    status,
    statusReasonCode,
    endedCodeProvenance,
    completedAt,
    stepResults,
    installationSecret: INSTALLATION_SECRET
  });
  return appendSemanticValidationReceipt({
    store,
    receipt: terminal,
    installationSecret: INSTALLATION_SECRET
  });
}

function passedSteps(): SemanticValidationStepResult[] {
  return ["typecheck", "lint", "unit_test"].map((step) => ({
    step: step as SemanticValidationStepResult["step"],
    status: "passed",
    durationMs: 10,
    reasonCode: null
  }));
}

function failedSteps(): SemanticValidationStepResult[] {
  return [
    {
      step: "typecheck",
      status: "failed",
      durationMs: 10,
      reasonCode: "NONZERO_EXIT"
    },
    ...(["lint", "unit_test"] as const).map((step) => ({
      step,
      status: "not_run" as const,
      durationMs: null,
      reasonCode: "PRIOR_STEP_TERMINATED" as const
    }))
  ];
}

function intentStoreFor(board: WorkSuggestionBoardPublic) {
  const target = findSemanticContinuationConfirmationTarget(board, {
    itemRef: ITEM_REF,
    workContextRef: CONTEXT_REF
  });
  if (target === null) throw new TypeError("Synthetic target missing");
  const decision = createSemanticContinuationIntentDecision({
    confirmation: {
      intent: "QA_RUN",
      subjectLabel: "blabase",
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      explicitUserConfirmation: true
    },
    target,
    registrySha256: REGISTRY_SHA,
    confirmedAt: "2026-08-13T12:00:00.000Z",
    supersedesDecisionId: null
  });
  const empty = createEmptySemanticContinuationIntentStore(
    decision.confirmedAt,
    INSTALLATION_SECRET
  );
  return {
    decision,
    store: sealSemanticContinuationIntentStore(
      {
        contract: empty.contract,
        schemaVersion: empty.schemaVersion,
        authKeyId: empty.authKeyId,
        revision: 1,
        updatedAt: decision.confirmedAt,
        decisions: [decision]
      },
      INSTALLATION_SECRET
    )
  };
}

function genericBoard(): WorkSuggestionBoardPublic {
  return workSuggestionBoardPublicSchema.parse({
    contract: "work-suggestion-board-public-v0.1",
    schemaVersion: "work-suggestion-board-schema-v0.1",
    generatedAt: "2026-08-13T12:05:00.000Z",
    prominentLane: "continuation",
    primary: {
      lane: "continuation",
      item: {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        kind: "linked_workstream",
        title: "Recent GitHub activity",
        summary: "Recent GitHub activity",
        observedAt: "2026-08-13T10:00:00.000Z",
        expiresAt: "2026-08-14T10:00:00.000Z",
        evidenceBand: "corroborated",
        capability: "display",
        action: null,
        caveatCodes: []
      }
    },
    alternatives: [],
    continuationStatus: "available",
    executionPolicy: {
      automaticExecutionAllowed: false,
      explicitUserActionRequired: true,
      externalMutationAllowed: false
    }
  });
}

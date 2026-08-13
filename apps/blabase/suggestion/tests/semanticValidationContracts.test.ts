import { describe, expect, it } from "vitest";

import {
  appendSemanticValidationReceipt,
  createEmptySemanticValidationStore,
  createSemanticValidationRunningReceipt,
  createSemanticValidationTerminalReceipt,
  semanticValidationBindingForIntent,
  semanticValidationReceiptSchema,
  semanticValidationStoreSchema,
  verifySemanticValidationReceipt,
  verifySemanticValidationStore,
  type SemanticValidationCodeProvenance,
  type SemanticValidationStepResult
} from "../src/semanticContinuation/validation/contracts";
import { resolveSemanticValidationDisplayTitle } from "../src/semanticContinuation/validation/resolveReceipt";
import { SEMANTIC_VALIDATION_TITLES } from "../src/semanticContinuation/validation/versions";
import { createSemanticContinuationIntentDecision } from "../src/semanticContinuation";

const INSTALLATION_SECRET = "1".repeat(64);
const OTHER_INSTALLATION_SECRET = "2".repeat(64);
const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const REGISTRY_SHA256 = "c".repeat(64);
const RUN_ONE = `semantic_validation_run_${"d".repeat(32)}`;
const RUN_TWO = `semantic_validation_run_${"e".repeat(32)}`;
const STARTED_AT = "2026-08-13T12:10:00.000Z";
const COMPLETED_AT = "2026-08-13T12:11:00.000Z";

describe("Semantic Validation contracts", () => {
  it("rejects content, hash, HMAC, and installation-authority tampering", () => {
    const running = runningReceipt();

    expect(
      verifySemanticValidationReceipt(running, INSTALLATION_SECRET)
    ).toEqual(running);
    expect(
      verifySemanticValidationReceipt(running, OTHER_INSTALLATION_SECRET)
    ).toBeNull();

    const contentTampered = structuredClone(running);
    contentTampered.binding.registrySha256 = "f".repeat(64);
    expect(
      semanticValidationReceiptSchema.safeParse(contentTampered).success
    ).toBe(false);
    expect(
      verifySemanticValidationReceipt(contentTampered, INSTALLATION_SECRET)
    ).toBeNull();

    const hmacTampered = {
      ...running,
      receiptHmac: "0".repeat(64)
    };
    expect(
      semanticValidationReceiptSchema.safeParse(hmacTampered).success
    ).toBe(true);
    expect(
      verifySemanticValidationReceipt(hmacTampered, INSTALLATION_SECRET)
    ).toBeNull();

    const store = appendSemanticValidationReceipt({
      store: emptyStore(),
      receipt: running,
      installationSecret: INSTALLATION_SECRET
    });
    expect(verifySemanticValidationStore(store, INSTALLATION_SECRET)).toEqual(
      store
    );
    expect(
      verifySemanticValidationStore(store, OTHER_INSTALLATION_SECRET)
    ).toBeNull();
    expect(
      verifySemanticValidationStore(
        { ...store, storeHmac: "0".repeat(64) },
        INSTALLATION_SECRET
      )
    ).toBeNull();
  });

  it("enforces an append-only chain and an exact current receipt pointer", () => {
    const running = runningReceipt();
    let store = appendSemanticValidationReceipt({
      store: emptyStore(),
      receipt: running,
      installationSecret: INSTALLATION_SECRET
    });
    const terminal = createSemanticValidationTerminalReceipt({
      runningReceipt: running,
      receiptRevision: 2,
      previousReceiptSha256: running.receiptSha256,
      status: "passed",
      statusReasonCode: null,
      endedCodeProvenance: cleanProvenance(),
      completedAt: COMPLETED_AT,
      stepResults: passedStepResults(),
      installationSecret: INSTALLATION_SECRET
    });
    store = appendSemanticValidationReceipt({
      store,
      receipt: terminal,
      installationSecret: INSTALLATION_SECRET
    });

    expect(store.revision).toBe(2);
    expect(store.currentRunId).toBe(RUN_ONE);
    expect(store.currentReceiptSha256).toBe(terminal.receiptSha256);
    expect(store.receipts[1]?.previousReceiptSha256).toBe(
      running.receiptSha256
    );

    expect(
      semanticValidationStoreSchema.safeParse({
        ...store,
        receipts: [...store.receipts].reverse()
      }).success
    ).toBe(false);
    expect(
      semanticValidationStoreSchema.safeParse({
        ...store,
        currentReceiptSha256: running.receiptSha256
      }).success
    ).toBe(false);
    expect(
      semanticValidationStoreSchema.safeParse({
        ...store,
        revision: store.revision + 1
      }).success
    ).toBe(false);
  });

  it("requires the complete ordered status tuple and stable clean provenance", () => {
    const running = runningReceipt();

    expect(running.profileSteps).toEqual([
      "typecheck",
      "lint",
      "unit_test"
    ]);
    expect(running.stepResults).toEqual([]);
    expect(running.expiresAt).toBe("2026-08-14T12:00:00.000Z");

    expect(() =>
      createSemanticValidationTerminalReceipt({
        runningReceipt: running,
        receiptRevision: 2,
        previousReceiptSha256: running.receiptSha256,
        status: "passed",
        statusReasonCode: null,
        endedCodeProvenance: cleanProvenance(),
        completedAt: COMPLETED_AT,
        stepResults: passedStepResults().slice(0, 2),
        installationSecret: INSTALLATION_SECRET
      })
    ).toThrow();

    expect(() =>
      createSemanticValidationTerminalReceipt({
        runningReceipt: running,
        receiptRevision: 2,
        previousReceiptSha256: running.receiptSha256,
        status: "passed",
        statusReasonCode: null,
        endedCodeProvenance: cleanProvenance(),
        completedAt: COMPLETED_AT,
        stepResults: [
          passedStepResults()[1]!,
          passedStepResults()[0]!,
          passedStepResults()[2]!
        ],
        installationSecret: INSTALLATION_SECRET
      })
    ).toThrow();

    expect(() =>
      createSemanticValidationTerminalReceipt({
        runningReceipt: running,
        receiptRevision: 2,
        previousReceiptSha256: running.receiptSha256,
        status: "passed",
        statusReasonCode: null,
        endedCodeProvenance: cleanProvenance("f"),
        completedAt: COMPLETED_AT,
        stepResults: passedStepResults(),
        installationSecret: INSTALLATION_SECRET
      })
    ).toThrow();
  });

  it("never resurrects an old pass after a newer run becomes current", () => {
    const intent = semanticIntent();
    const provenance = cleanProvenance();
    const firstRunning = runningReceipt();
    const firstTerminal = createSemanticValidationTerminalReceipt({
      runningReceipt: firstRunning,
      receiptRevision: 2,
      previousReceiptSha256: firstRunning.receiptSha256,
      status: "passed",
      statusReasonCode: null,
      endedCodeProvenance: provenance,
      completedAt: COMPLETED_AT,
      stepResults: passedStepResults(),
      installationSecret: INSTALLATION_SECRET
    });
    let store = appendSemanticValidationReceipt({
      store: appendSemanticValidationReceipt({
        store: emptyStore(),
        receipt: firstRunning,
        installationSecret: INSTALLATION_SECRET
      }),
      receipt: firstTerminal,
      installationSecret: INSTALLATION_SECRET
    });

    expect(
      resolveSemanticValidationDisplayTitle({
        store,
        intent,
        currentCodeProvenance: attentionProvenance(),
        asOf: "2026-08-13T12:12:00.000Z"
      })
    ).toBe(SEMANTIC_VALIDATION_TITLES.passed);

    const secondRunning = createSemanticValidationRunningReceipt({
      receiptRevision: 3,
      previousReceiptSha256: firstTerminal.receiptSha256,
      runId: RUN_TWO,
      binding: semanticValidationBindingForIntent(intent),
      startedCodeProvenance: provenance,
      startedAt: "2026-08-13T12:13:00.000Z",
      installationSecret: INSTALLATION_SECRET
    });
    store = appendSemanticValidationReceipt({
      store,
      receipt: secondRunning,
      installationSecret: INSTALLATION_SECRET
    });

    expect(store.currentRunId).toBe(RUN_TWO);
    expect(
      resolveSemanticValidationDisplayTitle({
        store,
        intent,
        currentCodeProvenance: attentionProvenance(),
        asOf: "2026-08-13T12:14:00.000Z"
      })
    ).toBe(SEMANTIC_VALIDATION_TITLES.running);

    const failed = createSemanticValidationTerminalReceipt({
      runningReceipt: secondRunning,
      receiptRevision: 4,
      previousReceiptSha256: secondRunning.receiptSha256,
      status: "failed",
      statusReasonCode: "STEP_FAILED",
      endedCodeProvenance: provenance,
      completedAt: "2026-08-13T12:15:00.000Z",
      stepResults: failedStepResults(),
      installationSecret: INSTALLATION_SECRET
    });
    store = appendSemanticValidationReceipt({
      store,
      receipt: failed,
      installationSecret: INSTALLATION_SECRET
    });

    expect(
      resolveSemanticValidationDisplayTitle({
        store,
        intent,
        currentCodeProvenance: attentionProvenance(),
        asOf: "2026-08-13T12:16:00.000Z"
      })
    ).toBe(SEMANTIC_VALIDATION_TITLES.failed);
  });

  it("keeps commands, outputs, paths, native IDs, prompts, and the secret out of receipts", () => {
    const running = runningReceipt();
    const store = appendSemanticValidationReceipt({
      store: emptyStore(),
      receipt: running,
      installationSecret: INSTALLATION_SECRET
    });
    const serialized = JSON.stringify(store);

    expect(serialized).not.toContain(INSTALLATION_SECRET);
    for (const forbiddenKey of [
      "command",
      "cwd",
      "executable",
      "installationSecret",
      "nativeId",
      "path",
      "prompt",
      "sessionId",
      "stderr",
      "stdout",
      "url"
    ]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }
    expect(
      semanticValidationReceiptSchema.safeParse({
        ...running,
        stdout: "RAW_STDOUT_PRIVACY_SENTINEL"
      }).success
    ).toBe(false);
  });
});

function semanticIntent() {
  return createSemanticContinuationIntentDecision({
    confirmation: {
      intent: "QA_RUN",
      subjectLabel: "blabase",
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      explicitUserConfirmation: true
    },
    target: {
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      observedAt: "2026-08-13T10:00:00.000Z",
      candidateExpiresAt: "2026-08-15T12:00:00.000Z"
    },
    registrySha256: REGISTRY_SHA256,
    confirmedAt: "2026-08-13T12:00:00.000Z",
    supersedesDecisionId: null
  });
}

function emptyStore() {
  return createEmptySemanticValidationStore({
    createdAt: STARTED_AT,
    installationSecret: INSTALLATION_SECRET
  });
}

function runningReceipt() {
  return createSemanticValidationRunningReceipt({
    receiptRevision: 1,
    previousReceiptSha256: null,
    runId: RUN_ONE,
    binding: semanticValidationBindingForIntent(semanticIntent()),
    startedCodeProvenance: cleanProvenance(),
    startedAt: STARTED_AT,
    installationSecret: INSTALLATION_SECRET
  });
}

function cleanProvenance(fill = "a"): SemanticValidationCodeProvenance {
  return {
    kind: "clean",
    codeState: "clean_commit",
    codeCommitSha: fill.repeat(40),
    codeFingerprintSha256: null
  };
}

function attentionProvenance() {
  return {
    codeState: "clean_commit" as const,
    codeCommitSha: "a".repeat(40),
    codeFingerprintSha256: null
  };
}

function passedStepResults(): SemanticValidationStepResult[] {
  return ["typecheck", "lint", "unit_test"].map((step) => ({
    step: step as SemanticValidationStepResult["step"],
    status: "passed" as const,
    durationMs: 10,
    reasonCode: null
  }));
}

function failedStepResults(): SemanticValidationStepResult[] {
  return [
    {
      step: "typecheck",
      status: "passed",
      durationMs: 10,
      reasonCode: null
    },
    {
      step: "lint",
      status: "failed",
      durationMs: 20,
      reasonCode: "NONZERO_EXIT"
    },
    {
      step: "unit_test",
      status: "not_run",
      durationMs: null,
      reasonCode: "PRIOR_STEP_TERMINATED"
    }
  ];
}

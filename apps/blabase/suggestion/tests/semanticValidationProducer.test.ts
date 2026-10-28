import { realpath } from "node:fs/promises";
import { relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AttentionCodeProvenance } from "../src/attention/codeProvenance";
import {
  appendSemanticValidationReceipt,
  createEmptySemanticValidationStore,
  createSemanticValidationRunningReceipt,
  semanticValidationBindingForIntent,
  type SemanticValidationReceipt,
  type SemanticValidationStepResult,
  type SemanticValidationStore
} from "../src/semanticContinuation/validation/contracts";
import {
  runSemanticContinuationValidationWithDependencies
} from "../src/semanticContinuation/validation/producer";
import {
  hasExactValidationScripts,
  resolveFixedSemanticValidationProfile,
  SemanticValidationProfileError,
  type SemanticValidationProfile
} from "../src/semanticContinuation/validation/profiles";
import { SEMANTIC_VALIDATION_PROFILE_VERSION } from "../src/semanticContinuation/validation/versions";
import {
  createEmptySemanticContinuationIntentStore,
  createSemanticContinuationIntentDecision,
  sealSemanticContinuationIntentStore
} from "../src/semanticContinuation";
import {
  workSuggestionBoardPublicSchema,
  type WorkSuggestionBoardPublic
} from "../src/suggestionBoard/contracts";
import { workBoardApiResponseSchema } from "../src/suggestionBoard/monitoringSchema";

const INSTALLATION_SECRET = "1".repeat(64);
const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const REGISTRY_SHA256 = "c".repeat(64);
const RUN_ID = `semantic_validation_run_${"d".repeat(32)}`;
const ABANDONED_RUN_ID = `semantic_validation_run_${"e".repeat(32)}`;
const STARTED_AT = "2026-08-13T12:10:00.000Z";
const COMPLETED_AT = "2026-08-13T12:11:00.000Z";

describe("Semantic Validation fixed producer", () => {
  it("resolves only the fixed direct-node profile in exact order", async () => {
    const profile = await resolveFixedSemanticValidationProfile();
    const executable = await realpath(process.execPath);

    expect(profile.version).toBe(SEMANTIC_VALIDATION_PROFILE_VERSION);
    expect(profile.entries.map((entry) => entry.step)).toEqual([
      "typecheck",
      "lint",
      "unit_test"
    ]);
    expect(profile.entries.map((entry) => entry.executable)).toEqual([
      executable,
      executable,
      executable
    ]);
    expect(
      profile.entries.map((entry) => relative(profile.root, entry.entrypoint))
    ).toEqual([
      "node_modules/typescript/lib/tsc.js",
      "node_modules/eslint/bin/eslint.js",
      "node_modules/vitest/vitest.mjs"
    ]);
    expect(profile.entries.map((entry) => entry.args)).toEqual([
      ["--noEmit"],
      [
        ".",
        "--ignore-pattern",
        ".next/**",
        "--ignore-pattern",
        ".next-dev/**",
        "--ignore-pattern",
        ".next-build/**"
      ],
      ["run"]
    ]);
    expect(profile.environment).toEqual({
      CI: "1",
      FORCE_COLOR: "0",
      NODE_ENV: "test",
      NO_COLOR: "1",
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    });
    expect(
      profile.entries.every(
        (entry) =>
          !entry.executable.includes("npm") &&
          !entry.entrypoint.includes("npm") &&
          !entry.args.some((argument) => /[;&|`]/u.test(argument))
      )
    ).toBe(true);
  });

  it("rejects package-script drift and command injection", () => {
    const exact = {
      typecheck: "tsc --noEmit",
      lint:
        "eslint . --ignore-pattern '.next/**' --ignore-pattern '.next-dev/**' --ignore-pattern '.next-build/**'",
      test: "vitest run"
    };
    expect(hasExactValidationScripts(exact)).toBe(true);

    for (const scripts of [
      { ...exact, typecheck: "tsc --noEmit; touch /tmp/synthetic" },
      { ...exact, lint: "eslint . && synthetic-command" },
      { ...exact, test: "vitest run --changed" },
      { ...exact, typecheck: "npx tsc --noEmit" }
    ]) {
      expect(hasExactValidationScripts(scripts)).toBe(false);
    }
  });

  it("suppresses a lease loser before reading authority or executing a step", async () => {
    const harness = producerHarness();
    harness.dependencies.acquireRunLease = vi.fn(async () => null);

    await expect(
      runSemanticContinuationValidationWithDependencies(
        harness.dependencies
      )
    ).resolves.toEqual({
      status: "inconclusive",
      code: "RUN_ALREADY_ACTIVE",
      runId: null,
      receiptSha256: null,
      stepStatuses: []
    });
    expect(harness.dependencies.readInstallationSecret).not.toHaveBeenCalled();
    expect(harness.dependencies.captureBase).not.toHaveBeenCalled();
    expect(harness.executeStep).not.toHaveBeenCalled();
    expect(harness.receipts()).toEqual([]);
  });

  it("rejects a rebound Board before provenance, profile, or subprocess work", async () => {
    const harness = producerHarness({ bases: [reboundBase()] });

    await expect(
      runSemanticContinuationValidationWithDependencies(
        harness.dependencies
      )
    ).resolves.toEqual({
      status: "inconclusive",
      code: "ACTIVE_INTENT_UNAVAILABLE",
      runId: RUN_ID,
      receiptSha256: null,
      stepStatuses: []
    });
    expect(
      harness.dependencies.resolveCodeProvenance
    ).not.toHaveBeenCalled();
    expect(harness.dependencies.resolveProfile).not.toHaveBeenCalled();
    expect(harness.executeStep).not.toHaveBeenCalled();
    expect(harness.receipts()).toEqual([]);
  });

  it("rejects v0.2 kind or evidence mismatch before spawning validation work", async () => {
    for (const base of [
      baseWithItem({ kind: "recent_codex_session" }),
      baseWithItem({ evidenceBand: "single_source" })
    ]) {
      const harness = producerHarness({ bases: [base] });
      await expect(
        runSemanticContinuationValidationWithDependencies(
          harness.dependencies
        )
      ).resolves.toMatchObject({
        status: "inconclusive",
        code: "ACTIVE_INTENT_UNAVAILABLE",
        stepStatuses: []
      });
      expect(
        harness.dependencies.resolveCodeProvenance
      ).not.toHaveBeenCalled();
      expect(harness.dependencies.resolveProfile).not.toHaveBeenCalled();
      expect(harness.executeStep).not.toHaveBeenCalled();
      expect(harness.receipts()).toEqual([]);
    }
  });

  it("rechecks a fresh clock after profile resolution before starting a receipt", async () => {
    const harness = producerHarness({
      moments: [STARTED_AT, "2026-08-14T12:00:00.000Z"]
    });

    await expect(
      runSemanticContinuationValidationWithDependencies(
        harness.dependencies
      )
    ).resolves.toMatchObject({
      status: "inconclusive",
      code: "ACTIVE_INTENT_UNAVAILABLE",
      stepStatuses: []
    });
    expect(harness.dependencies.resolveProfile).toHaveBeenCalledOnce();
    expect(harness.executeStep).not.toHaveBeenCalled();
    expect(harness.receipts()).toEqual([]);
  });

  it("recovers an abandoned receipt before rejecting a rebound Board", async () => {
    const intent = semanticIntent();
    const empty = createEmptySemanticValidationStore({
      createdAt: "2026-08-13T12:05:00.000Z",
      installationSecret: INSTALLATION_SECRET
    });
    const abandoned = createSemanticValidationRunningReceipt({
      receiptRevision: 1,
      previousReceiptSha256: null,
      runId: ABANDONED_RUN_ID,
      binding: semanticValidationBindingForIntent(intent),
      startedCodeProvenance: {
        kind: "clean",
        codeState: "clean_commit",
        codeCommitSha: "a".repeat(40),
        codeFingerprintSha256: null
      },
      startedAt: "2026-08-13T12:05:00.000Z",
      installationSecret: INSTALLATION_SECRET
    });
    const initialStore = appendSemanticValidationReceipt({
      store: empty,
      receipt: abandoned,
      installationSecret: INSTALLATION_SECRET
    });
    const harness = producerHarness({
      abandonedRunId: ABANDONED_RUN_ID,
      bases: [reboundBase()],
      initialStore
    });

    await expect(
      runSemanticContinuationValidationWithDependencies(
        harness.dependencies
      )
    ).resolves.toMatchObject({
      status: "inconclusive",
      code: "ACTIVE_INTENT_UNAVAILABLE",
      stepStatuses: []
    });
    expect(harness.dependencies.resolveProfile).not.toHaveBeenCalled();
    expect(harness.executeStep).not.toHaveBeenCalled();
    expect(
      harness.receipts().map((receipt) => [
        receipt.runId,
        receipt.status,
        receipt.statusReasonCode
      ])
    ).toEqual([
      [ABANDONED_RUN_ID, "running", null],
      [ABANDONED_RUN_ID, "inconclusive", "RUN_ABANDONED"]
    ]);
  });

  it("runs in fixed order, fails fast, and persists all three statuses", async () => {
    const harness = producerHarness({
      executeStep: async (step) =>
        step === "lint"
          ? {
              step,
              status: "failed",
              durationMs: 20,
              reasonCode: "NONZERO_EXIT"
            }
          : {
              step,
              status: "passed",
              durationMs: 10,
              reasonCode: null
            }
    });

    const result = await runSemanticContinuationValidationWithDependencies(
      harness.dependencies
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "VALIDATION_FAILED",
      runId: RUN_ID,
      receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      stepStatuses: ["passed", "failed", "not_run"]
    });
    expect(
      harness.executeStep.mock.calls.map(([entry]) => entry.step)
    ).toEqual(["typecheck", "lint"]);
    const receipts = harness.receipts();
    expect(receipts.map((receipt) => receipt.status)).toEqual([
      "running",
      "failed"
    ]);
    expect(receipts[1]?.stepResults).toEqual([
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
    ]);
  });

  it("records a provenance drift as inconclusive even when all steps pass", async () => {
    const harness = producerHarness({
      provenances: [cleanAttentionProvenance("a"), cleanAttentionProvenance("b")]
    });

    const result = await runSemanticContinuationValidationWithDependencies(
      harness.dependencies
    );

    expect(result).toMatchObject({
      status: "inconclusive",
      code: "CODE_PROVENANCE_CHANGED",
      stepStatuses: ["passed", "passed", "passed"]
    });
    expect(
      harness.executeStep.mock.calls.map(([entry]) => entry.step)
    ).toEqual(["typecheck", "lint", "unit_test"]);
    const terminal = harness.receipts().at(-1);
    expect(terminal).toMatchObject({
      status: "inconclusive",
      statusReasonCode: "CODE_PROVENANCE_CHANGED",
      stepResults: [
        { step: "typecheck", status: "passed" },
        { step: "lint", status: "passed" },
        { step: "unit_test", status: "passed" }
      ]
    });
  });

  it("records INTENT_NOT_CURRENT when the terminal Board is only a rebound", async () => {
    const harness = producerHarness({
      bases: [liveBase(), reboundBase()]
    });

    await expect(
      runSemanticContinuationValidationWithDependencies(
        harness.dependencies
      )
    ).resolves.toMatchObject({
      status: "inconclusive",
      code: "INTENT_NOT_CURRENT",
      stepStatuses: ["passed", "passed", "passed"]
    });
    expect(harness.executeStep).toHaveBeenCalledTimes(3);
    expect(harness.receipts().at(-1)).toMatchObject({
      status: "inconclusive",
      statusReasonCode: "INTENT_NOT_CURRENT"
    });
  });

  it("records INTENT_NOT_CURRENT for terminal kind or evidence drift", async () => {
    for (const refreshed of [
      baseWithItem({ kind: "recent_codex_session" }),
      baseWithItem({ evidenceBand: "single_source" })
    ]) {
      const harness = producerHarness({
        bases: [liveBase(), refreshed]
      });
      await expect(
        runSemanticContinuationValidationWithDependencies(
          harness.dependencies
        )
      ).resolves.toMatchObject({
        status: "inconclusive",
        code: "INTENT_NOT_CURRENT",
        stepStatuses: ["passed", "passed", "passed"]
      });
      expect(harness.executeStep).toHaveBeenCalledTimes(3);
      expect(harness.receipts().at(-1)).toMatchObject({
        status: "inconclusive",
        statusReasonCode: "INTENT_NOT_CURRENT"
      });
    }
  });

  it("records profile drift without invoking a validation command", async () => {
    const harness = producerHarness();
    harness.dependencies.resolveProfile = vi.fn(async () => {
      throw new SemanticValidationProfileError("PROFILE_MISMATCH");
    });

    const result = await runSemanticContinuationValidationWithDependencies(
      harness.dependencies
    );

    expect(result).toMatchObject({
      status: "inconclusive",
      code: "PROFILE_MISMATCH",
      stepStatuses: ["not_run", "not_run", "not_run"]
    });
    expect(harness.executeStep).not.toHaveBeenCalled();
    expect(harness.receipts().at(-1)).toMatchObject({
      status: "inconclusive",
      statusReasonCode: "PROFILE_MISMATCH",
      stepResults: [
        {
          step: "typecheck",
          status: "not_run",
          reasonCode: "PROFILE_MISMATCH"
        },
        {
          step: "lint",
          status: "not_run",
          reasonCode: "PROFILE_MISMATCH"
        },
        {
          step: "unit_test",
          status: "not_run",
          reasonCode: "PROFILE_MISMATCH"
        }
      ]
    });
  });

  it("closes a stale matching running receipt as abandoned before starting the new run", async () => {
    const intent = semanticIntent();
    const empty = createEmptySemanticValidationStore({
      createdAt: "2026-08-13T12:05:00.000Z",
      installationSecret: INSTALLATION_SECRET
    });
    const abandoned = createSemanticValidationRunningReceipt({
      receiptRevision: 1,
      previousReceiptSha256: null,
      runId: ABANDONED_RUN_ID,
      binding: semanticValidationBindingForIntent(intent),
      startedCodeProvenance: {
        kind: "clean",
        codeState: "clean_commit",
        codeCommitSha: "a".repeat(40),
        codeFingerprintSha256: null
      },
      startedAt: "2026-08-13T12:05:00.000Z",
      installationSecret: INSTALLATION_SECRET
    });
    const initialStore = appendSemanticValidationReceipt({
      store: empty,
      receipt: abandoned,
      installationSecret: INSTALLATION_SECRET
    });
    const harness = producerHarness({
      abandonedRunId: ABANDONED_RUN_ID,
      initialStore
    });

    await expect(
      runSemanticContinuationValidationWithDependencies(
        harness.dependencies
      )
    ).resolves.toMatchObject({
      status: "passed",
      code: "VALIDATION_PASSED"
    });
    expect(
      harness.receipts().map((receipt) => [
        receipt.runId,
        receipt.status,
        receipt.statusReasonCode
      ])
    ).toEqual([
      [ABANDONED_RUN_ID, "running", null],
      [ABANDONED_RUN_ID, "inconclusive", "RUN_ABANDONED"],
      [RUN_ID, "running", null],
      [RUN_ID, "passed", null]
    ]);
  });
});

type ProducerDependencies = Parameters<
  typeof runSemanticContinuationValidationWithDependencies
>[0];

function producerHarness(input?: {
  abandonedRunId?: string | null;
  bases?: ReturnType<typeof liveBase>[];
  initialStore?: SemanticValidationStore;
  moments?: string[];
  provenances?: AttentionCodeProvenance[];
  executeStep?: (
    step: SemanticValidationStepResult["step"]
  ) => Promise<SemanticValidationStepResult>;
}): {
  dependencies: ProducerDependencies;
  executeStep: ReturnType<typeof vi.fn>;
  receipts: () => SemanticValidationReceipt[];
} {
  const intent = semanticIntent();
  const emptyIntentStore = createEmptySemanticContinuationIntentStore(
    intent.confirmedAt,
    INSTALLATION_SECRET
  );
  const intentStore = sealSemanticContinuationIntentStore(
    {
      contract: emptyIntentStore.contract,
      schemaVersion: emptyIntentStore.schemaVersion,
      authKeyId: emptyIntentStore.authKeyId,
      revision: 1,
      updatedAt: intent.confirmedAt,
      decisions: [intent]
    },
    INSTALLATION_SECRET
  );
  let validationStore: SemanticValidationStore =
    input?.initialStore ??
    createEmptySemanticValidationStore({
      createdAt: STARTED_AT,
      installationSecret: INSTALLATION_SECRET
    });
  const moments = input?.moments ?? [STARTED_AT, STARTED_AT, COMPLETED_AT];
  let momentIndex = 0;
  const provenances = input?.provenances ?? [
    cleanAttentionProvenance("a"),
    cleanAttentionProvenance("a")
  ];
  let provenanceIndex = 0;
  const bases = input?.bases ?? [liveBase(), liveBase()];
  let baseIndex = 0;
  const executeStep = vi.fn(async (entry: SemanticValidationProfile["entries"][number]) =>
    input?.executeStep
      ? input.executeStep(entry.step)
      : {
          step: entry.step,
          status: "passed" as const,
          durationMs: 10,
          reasonCode: null
        }
  );
  const stop = vi.fn(async () => undefined);
  const dependencies: ProducerDependencies = {
    now: () =>
      new Date(moments[Math.min(momentIndex++, moments.length - 1)]!),
    createRunId: () => RUN_ID,
    readInstallationSecret: vi.fn(async () => INSTALLATION_SECRET),
    captureBase: vi.fn(async () =>
      bases[Math.min(baseIndex++, bases.length - 1)]!
    ),
    resolveCodeProvenance: vi.fn(async () =>
      provenances[Math.min(provenanceIndex++, provenances.length - 1)]!
    ),
    resolveProfile: vi.fn(async () => syntheticProfile()),
    executeStep,
    readIntentStore: vi.fn(async () => ({
      status: "available" as const,
      value: intentStore
    })),
    readValidationStore: vi.fn(async () => ({
      status: "available" as const,
      value: validationStore
    })),
    appendReceipt: vi.fn(async ({ installationSecret, receipt }) => {
      validationStore = appendSemanticValidationReceipt({
        store: validationStore,
        receipt,
        installationSecret
      });
      return validationStore;
    }),
    withAuthority: async <T>(operation: () => Promise<T>) => operation(),
    acquireRunLease: vi.fn(async (runId: string) => ({
      runId,
      abandonedRunId: input?.abandonedRunId ?? null,
      assertCurrent: vi.fn(async () => undefined),
      stop
    }))
  };
  return {
    dependencies,
    executeStep,
    receipts: () => validationStore.receipts
  };
}

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
      candidateKind: "linked_workstream",
      evidenceBand: "corroborated",
      observedAt: "2026-08-13T10:00:00.000Z",
      candidateExpiresAt: "2026-08-15T12:00:00.000Z"
    },
    registrySha256: REGISTRY_SHA256,
    confirmedAt: "2026-08-13T12:00:00.000Z",
    supersedesDecisionId: null
  });
}

function liveBase() {
  const board = workSuggestionBoardPublicSchema.parse({
    contract: "work-suggestion-board-public-v0.1",
    schemaVersion: "work-suggestion-board-schema-v0.1",
    generatedAt: STARTED_AT,
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
        expiresAt: "2026-08-15T12:00:00.000Z",
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
  return {
    response: workBoardApiResponseSchema.parse({
      status: "ready",
      mode: "full",
      reasonCode: null,
      board
    }),
    registrySha256: REGISTRY_SHA256,
    codeProvenance: cleanAttentionProvenance("a")
  };
}

function reboundBase(): ReturnType<typeof liveBase> {
  return baseWithItem({
    itemRef: `item_ref_${"f".repeat(43)}`,
    observedAt: "2026-08-13T10:01:00.000Z"
  });
}

function baseWithItem(
  item: Partial<
    NonNullable<WorkSuggestionBoardPublic["primary"]>["item"]
  >
): ReturnType<typeof liveBase> {
  const base = liveBase();
  if (base.response.status !== "ready") {
    throw new TypeError("Synthetic Board unavailable");
  }
  const primary = base.response.board.primary;
  if (primary === null) throw new TypeError("Synthetic item missing");
  const board = workSuggestionBoardPublicSchema.parse({
    ...base.response.board,
    primary: {
      ...primary,
      item: {
        ...primary.item,
        ...item
      }
    }
  });
  return {
    ...base,
    response: workBoardApiResponseSchema.parse({
      ...base.response,
      board
    })
  };
}

function syntheticProfile(): SemanticValidationProfile {
  return {
    version: SEMANTIC_VALIDATION_PROFILE_VERSION,
    root: "/synthetic/blabase/suggestion",
    environment: {
      CI: "1",
      FORCE_COLOR: "0",
      NODE_ENV: "test",
      NO_COLOR: "1",
      PATH: "/usr/bin:/bin"
    },
    entries: [
      {
        step: "typecheck",
        executable: "/synthetic/node",
        entrypoint: "/synthetic/typescript/tsc.js",
        args: ["--noEmit"],
        timeoutMs: 300_000
      },
      {
        step: "lint",
        executable: "/synthetic/node",
        entrypoint: "/synthetic/eslint/eslint.js",
        args: ["."],
        timeoutMs: 300_000
      },
      {
        step: "unit_test",
        executable: "/synthetic/node",
        entrypoint: "/synthetic/vitest/vitest.mjs",
        args: ["run"],
        timeoutMs: 900_000
      }
    ]
  };
}

function cleanAttentionProvenance(fill: string): AttentionCodeProvenance {
  return {
    codeState: "clean_commit",
    codeCommitSha: fill.repeat(40),
    codeFingerprintSha256: null
  };
}

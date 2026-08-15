import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { realpath } from "node:fs/promises";

import {
  resolveAttentionCodeProvenance,
  type AttentionCodeProvenance
} from "../../attention/codeProvenance";
import { readStoredCodexConfig } from "../../connectors/codex/localStore";
import {
  evaluateLiveWorkSuggestionBoardBase,
  type LiveWorkSuggestionBoardBase
} from "../../suggestionBoard/liveShadow";
import {
  readSemanticContinuationIntentStore,
  type SemanticContinuationStoreReadResult
} from "../localStore";
import type {
  SemanticContinuationIntentDecision
} from "../contracts";
import {
  createEmptySemanticValidationStore,
  createSemanticValidationRunningReceipt,
  createSemanticValidationTerminalReceipt,
  isUsableSemanticValidationCodeProvenance,
  normalizeSemanticValidationCodeProvenance,
  sameSemanticValidationCodeProvenance,
  semanticValidationBindingForIntent,
  type SemanticValidationCodeProvenance,
  type SemanticValidationReceipt,
  type SemanticValidationStepResult,
  type SemanticValidationStore
} from "./contracts";
import {
  resolveFixedSemanticValidationProfile,
  resolveFixedSemanticValidationRoot,
  SemanticValidationProfileError,
  type SemanticValidationProfile,
  type SemanticValidationProfileEntry
} from "./profiles";
import {
  acquireSemanticValidationRunLease,
  appendStoredSemanticValidationReceiptUnderAuthorityLease,
  readSemanticValidationStore,
  withSemanticContinuationAuthorityLease,
  type SemanticValidationRunLease,
  type SemanticValidationStoreReadResult,
  SemanticValidationStoreError
} from "./store";
import { SEMANTIC_VALIDATION_STEPS } from "./versions";

export type SemanticValidationRunResult = {
  status: "passed" | "failed" | "inconclusive";
  code:
    | "VALIDATION_PASSED"
    | "VALIDATION_FAILED"
    | "RUN_ALREADY_ACTIVE"
    | "FIXED_ROOT_REQUIRED"
    | "INSTALLATION_SECRET_UNAVAILABLE"
    | "BASE_BOARD_UNAVAILABLE"
    | "ACTIVE_INTENT_UNAVAILABLE"
    | "INTENT_EXPIRED"
    | "PROFILE_MISMATCH"
    | "CODE_PROVENANCE_UNAVAILABLE"
    | "CODE_PROVENANCE_CHANGED"
    | "STEP_TIMEOUT"
    | "STEP_UNAVAILABLE"
    | "VALIDATION_WINDOW_EXPIRED"
    | "INTENT_NOT_CURRENT"
    | "STORE_INVALID"
    | "RUN_LEASE_FAILED";
  runId: string | null;
  receiptSha256: string | null;
  stepStatuses: Array<SemanticValidationStepResult["status"]>;
};

type SemanticValidationProducerDependencies = {
  now: () => Date;
  createRunId: () => string;
  readInstallationSecret: () => Promise<string | null>;
  captureBase: () => Promise<LiveWorkSuggestionBoardBase>;
  resolveCodeProvenance: () => Promise<AttentionCodeProvenance>;
  resolveProfile: () => Promise<SemanticValidationProfile>;
  executeStep: (
    entry: SemanticValidationProfileEntry,
    profile: SemanticValidationProfile
  ) => Promise<SemanticValidationStepResult>;
  readIntentStore: (
    installationSecret: string
  ) => Promise<SemanticContinuationStoreReadResult>;
  readValidationStore: (
    installationSecret: string
  ) => Promise<SemanticValidationStoreReadResult>;
  appendReceipt: (input: {
    installationSecret: string;
    receipt: SemanticValidationReceipt;
    createAt: string;
  }) => Promise<SemanticValidationStore>;
  withAuthority: <T>(operation: () => Promise<T>) => Promise<T>;
  acquireRunLease: (
    runId: string
  ) => Promise<SemanticValidationRunLease | null>;
};

export async function runSemanticContinuationValidation(): Promise<SemanticValidationRunResult> {
  let root: string;
  try {
    root = await resolveFixedSemanticValidationRoot();
    if ((await realpath(process.cwd())) !== root) {
      return inconclusive("FIXED_ROOT_REQUIRED");
    }
  } catch {
    return inconclusive("FIXED_ROOT_REQUIRED");
  }
  return runSemanticContinuationValidationWithDependencies(
    productionDependencies(root)
  );
}

/** Test seam only; production and HTTP paths call the zero-input function. */
export async function runSemanticContinuationValidationWithDependencies(
  dependencies: SemanticValidationProducerDependencies
): Promise<SemanticValidationRunResult> {
  const runId = dependencies.createRunId();
  let lease: SemanticValidationRunLease | null = null;
  try {
    lease = await dependencies.acquireRunLease(runId);
    if (lease === null) {
      return inconclusive("RUN_ALREADY_ACTIVE");
    }
    const installationSecret = await dependencies.readInstallationSecret();
    if (
      installationSecret === null ||
      !/^[a-f0-9]{64}$/u.test(installationSecret)
    ) {
      return inconclusive("INSTALLATION_SECRET_UNAVAILABLE", runId);
    }

    let captured: LiveWorkSuggestionBoardBase;
    try {
      captured = await dependencies.captureBase();
    } catch {
      return inconclusive("BASE_BOARD_UNAVAILABLE", runId);
    }
    const startedCodeProvenance = normalizeSemanticValidationCodeProvenance(
      await dependencies.resolveCodeProvenance()
    );
    let profile: SemanticValidationProfile | null = null;
    try {
      profile = await dependencies.resolveProfile();
    } catch (error) {
      if (!(error instanceof SemanticValidationProfileError)) throw error;
    }

    const started = await dependencies.withAuthority(async () => {
      const startedAt = dependencies.now().toISOString();
      let store = await requireValidationStore(
        dependencies,
        installationSecret,
        startedAt
      );
      store = await recoverAbandonedRun({
        dependencies,
        installationSecret,
        store,
        abandonedRunId: lease!.abandonedRunId,
        recoveredAt: startedAt,
        endedCodeProvenance: startedCodeProvenance
      });
      const intentRead = await dependencies.readIntentStore(
        installationSecret
      );
      const intent = currentIntentForBase(intentRead, captured, startedAt);
      if (intent === null) return null;
      const position = nextReceiptPosition(store);
      const receipt = createSemanticValidationRunningReceipt({
        ...position,
        runId,
        binding: semanticValidationBindingForIntent(intent),
        startedCodeProvenance,
        startedAt,
        installationSecret
      });
      const updated = await dependencies.appendReceipt({
        installationSecret,
        receipt,
        createAt: startedAt
      });
      return { receipt, intent, store: updated };
    });
    if (started === null) {
      return inconclusive("ACTIVE_INTENT_UNAVAILABLE", runId);
    }

    let stepResults: SemanticValidationStepResult[];
    if (profile === null) {
      stepResults = skippedStepResults("PROFILE_MISMATCH");
    } else if (
      !isUsableSemanticValidationCodeProvenance(startedCodeProvenance)
    ) {
      stepResults = skippedStepResults("PRIOR_STEP_TERMINATED");
    } else {
      stepResults = await executeFixedProfile(profile, dependencies.executeStep);
    }

    const endedCodeProvenance = normalizeSemanticValidationCodeProvenance(
      await dependencies.resolveCodeProvenance()
    );
    let refreshed: LiveWorkSuggestionBoardBase | null = null;
    try {
      refreshed = await dependencies.captureBase();
    } catch {
      // Currentness is resolved as inconclusive below.
    }
    const terminal = await dependencies.withAuthority(async () => {
      await lease!.assertCurrent();
      const completedAt = dependencies.now().toISOString();
      const read = await dependencies.readValidationStore(installationSecret);
      if (read.status !== "available") return null;
      const current = currentReceipt(read.value);
      if (
        current === null ||
        current.runId !== runId ||
        current.receiptSha256 !== started.receipt.receiptSha256 ||
        current.status !== "running"
      ) {
        return null;
      }
      const currentIntent =
        refreshed === null
          ? null
          : currentIntentForBase(
              await dependencies.readIntentStore(installationSecret),
              refreshed,
              completedAt
            );
      const outcome = terminalOutcome({
        running: started.receipt,
        profileAvailable: profile !== null,
        startedCodeProvenance,
        endedCodeProvenance,
        endedAt: completedAt,
        stepResults,
        currentIntent,
        expectedIntent: started.intent
      });
      const receipt = createSemanticValidationTerminalReceipt({
        runningReceipt: current,
        ...nextReceiptPosition(read.value),
        status: outcome.status,
        statusReasonCode: outcome.statusReasonCode,
        endedCodeProvenance,
        completedAt,
        stepResults,
        installationSecret
      });
      await dependencies.appendReceipt({
        installationSecret,
        receipt,
        createAt: started.receipt.startedAt
      });
      return { receipt, outcome };
    });
    if (terminal === null) {
      return inconclusive(
        "STORE_INVALID",
        runId,
        null,
        stepResults
      );
    }
    return {
      status: terminal.outcome.status,
      code: terminal.outcome.resultCode,
      runId,
      receiptSha256: terminal.receipt.receiptSha256,
      stepStatuses: stepResults.map((result) => result.status)
    };
  } catch (error) {
    return inconclusive(
      error instanceof SemanticValidationProfileError
        ? "PROFILE_MISMATCH"
        : error instanceof SemanticValidationStoreError &&
            error.code === "RUN_LEASE_FAILED"
          ? "RUN_LEASE_FAILED"
        : "STORE_INVALID",
      runId
    );
  } finally {
    if (lease !== null) {
      await lease.stop().catch(() => undefined);
    }
  }
}

async function executeFixedProfile(
  profile: SemanticValidationProfile,
  executeStep: SemanticValidationProducerDependencies["executeStep"]
): Promise<SemanticValidationStepResult[]> {
  const results: SemanticValidationStepResult[] = [];
  let terminated = false;
  for (const entry of profile.entries) {
    if (terminated) {
      results.push({
        step: entry.step,
        status: "not_run",
        durationMs: null,
        reasonCode: "PRIOR_STEP_TERMINATED"
      });
      continue;
    }
    const result = await executeStep(entry, profile);
    results.push(result);
    terminated = result.status !== "passed";
  }
  return results;
}

async function executeFixedSemanticValidationStep(
  entry: SemanticValidationProfileEntry,
  profile: SemanticValidationProfile
): Promise<SemanticValidationStepResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let forceKill: ReturnType<typeof setTimeout> | null = null;
    const child: ChildProcess = spawn(
      entry.executable,
      [entry.entrypoint, ...entry.args],
      {
        cwd: profile.root,
        env: { ...profile.environment } as NodeJS.ProcessEnv,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"]
      }
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceKill.unref?.();
    }, entry.timeoutMs);
    const finish = (
      status: "passed" | "failed" | "inconclusive",
      reasonCode: SemanticValidationStepResult["reasonCode"]
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill !== null) clearTimeout(forceKill);
      resolve({
        step: entry.step,
        status,
        durationMs: Math.min(Date.now() - startedAt, entry.timeoutMs),
        reasonCode
      });
    };
    child.once("error", () => finish("inconclusive", "SPAWN_FAILED"));
    child.once("close", (code) => {
      if (timedOut) finish("inconclusive", "TIMEOUT");
      else if (code === 0) finish("passed", null);
      else if (typeof code === "number") finish("failed", "NONZERO_EXIT");
      else finish("inconclusive", "SPAWN_FAILED");
    });
  });
}

function productionDependencies(
  root: string
): SemanticValidationProducerDependencies {
  return {
    now: () => new Date(),
    createRunId: () =>
      `semantic_validation_run_${randomBytes(16).toString("hex")}`,
    readInstallationSecret: async () =>
      (await readStoredCodexConfig(root))?.installationSecret ?? null,
    captureBase: () =>
      evaluateLiveWorkSuggestionBoardBase({ cwd: root, env: process.env }),
    resolveCodeProvenance: () =>
      resolveAttentionCodeProvenance(root, { NODE_ENV: "test" }),
    resolveProfile: resolveFixedSemanticValidationProfile,
    executeStep: executeFixedSemanticValidationStep,
    readIntentStore: (installationSecret) =>
      readSemanticContinuationIntentStore(root, installationSecret),
    readValidationStore: (installationSecret) =>
      readSemanticValidationStore(root, installationSecret),
    appendReceipt: (input) =>
      appendStoredSemanticValidationReceiptUnderAuthorityLease({
        cwd: root,
        ...input
      }),
    withAuthority: (operation) =>
      withSemanticContinuationAuthorityLease(root, operation),
    acquireRunLease: (runId) =>
      acquireSemanticValidationRunLease({ cwd: root, runId })
  };
}

function currentIntentForBase(
  read: SemanticContinuationStoreReadResult,
  base: LiveWorkSuggestionBoardBase,
  at: string
): SemanticContinuationIntentDecision | null {
  if (
    read.status !== "available" ||
    base.response.status !== "ready" ||
    base.response.mode !== "full" ||
    base.registrySha256 === null
  ) {
    return null;
  }
  const supersededIds = new Set(
    read.value.decisions.flatMap((decision) =>
      decision.supersedesDecisionId === null
        ? []
        : [decision.supersedesDecisionId]
    )
  );
  const current = read.value.decisions.filter(
    (decision) =>
      !supersededIds.has(decision.decisionId) &&
      decision.registrySha256 === base.registrySha256 &&
      Date.parse(decision.confirmedAt) <= Date.parse(at) &&
      Date.parse(at) < Date.parse(decision.expiresAt)
  );
  const entries = [
    ...(base.response.board.primary === null
      ? []
      : [base.response.board.primary]),
    ...base.response.board.alternatives
  ];
  for (const entry of entries) {
    if (
      entry.lane !== "continuation" ||
      entry.item.workContextRef === null ||
      entry.item.observedAt === null ||
      entry.item.expiresAt === null ||
      entry.item.capability !== "display" ||
      entry.item.action !== null
    ) {
      continue;
    }
    const decision = current.find(
      (candidate) =>
        candidate.itemRef === entry.item.itemRef &&
        candidate.workContextRef === entry.item.workContextRef &&
        candidate.targetObservedAt === entry.item.observedAt &&
        candidate.targetCandidateExpiresAt === entry.item.expiresAt
    );
    if (decision !== undefined) return decision;
  }
  return null;
}

async function requireValidationStore(
  dependencies: SemanticValidationProducerDependencies,
  installationSecret: string,
  createAt: string
): Promise<SemanticValidationStore> {
  const read = await dependencies.readValidationStore(installationSecret);
  if (read.status === "invalid") throw new TypeError("STORE_INVALID");
  if (read.status === "available") return read.value;
  return createEmptySemanticValidationStore({
    createdAt: createAt,
    installationSecret
  });
}

async function recoverAbandonedRun(input: {
  dependencies: SemanticValidationProducerDependencies;
  installationSecret: string;
  store: SemanticValidationStore;
  abandonedRunId: string | null;
  recoveredAt: string;
  endedCodeProvenance: SemanticValidationCodeProvenance;
}): Promise<SemanticValidationStore> {
  if (input.abandonedRunId === null) return input.store;
  const current = currentReceipt(input.store);
  if (
    current === null ||
    current.runId !== input.abandonedRunId ||
    current.status !== "running"
  ) {
    return input.store;
  }
  const completedAt = new Date(
    Math.max(Date.parse(input.recoveredAt), Date.parse(current.startedAt))
  ).toISOString();
  const receipt = createSemanticValidationTerminalReceipt({
    runningReceipt: current,
    ...nextReceiptPosition(input.store),
    status: "inconclusive",
    statusReasonCode: "RUN_ABANDONED",
    endedCodeProvenance: input.endedCodeProvenance,
    completedAt,
    stepResults: skippedStepResults("PRIOR_STEP_TERMINATED"),
    installationSecret: input.installationSecret
  });
  return input.dependencies.appendReceipt({
    installationSecret: input.installationSecret,
    receipt,
    createAt: input.store.createdAt
  });
}

function terminalOutcome(input: {
  running: SemanticValidationReceipt;
  profileAvailable: boolean;
  startedCodeProvenance: SemanticValidationCodeProvenance;
  endedCodeProvenance: SemanticValidationCodeProvenance;
  endedAt: string;
  stepResults: SemanticValidationStepResult[];
  currentIntent: SemanticContinuationIntentDecision | null;
  expectedIntent: SemanticContinuationIntentDecision;
}): {
  status: "passed" | "failed" | "inconclusive";
  statusReasonCode: SemanticValidationReceipt["statusReasonCode"];
  resultCode: SemanticValidationRunResult["code"];
} {
  if (!input.profileAvailable) {
    return terminal("PROFILE_MISMATCH", "PROFILE_MISMATCH");
  }
  if (
    !isUsableSemanticValidationCodeProvenance(
      input.startedCodeProvenance
    ) ||
    !isUsableSemanticValidationCodeProvenance(input.endedCodeProvenance)
  ) {
    return terminal(
      "CODE_PROVENANCE_UNAVAILABLE",
      "CODE_PROVENANCE_UNAVAILABLE"
    );
  }
  if (
    !sameSemanticValidationCodeProvenance(
      input.startedCodeProvenance,
      input.endedCodeProvenance
    )
  ) {
    return terminal(
      "CODE_PROVENANCE_CHANGED",
      "CODE_PROVENANCE_CHANGED"
    );
  }
  if (Date.parse(input.endedAt) >= Date.parse(input.running.expiresAt)) {
    return terminal(
      "VALIDATION_WINDOW_EXPIRED",
      "VALIDATION_WINDOW_EXPIRED"
    );
  }
  if (
    input.currentIntent === null ||
    input.currentIntent.decisionId !== input.expectedIntent.decisionId ||
    input.currentIntent.decisionSha256 !==
      input.expectedIntent.decisionSha256
  ) {
    return terminal("INTENT_NOT_CURRENT", "INTENT_NOT_CURRENT");
  }
  const inconclusiveStep = input.stepResults.find(
    (result) => result.status === "inconclusive"
  );
  if (inconclusiveStep?.reasonCode === "TIMEOUT") {
    return terminal("STEP_TIMEOUT", "STEP_TIMEOUT");
  }
  if (inconclusiveStep !== undefined) {
    return terminal("STEP_UNAVAILABLE", "STEP_UNAVAILABLE");
  }
  if (input.stepResults.some((result) => result.status === "failed")) {
    return {
      status: "failed",
      statusReasonCode: "STEP_FAILED",
      resultCode: "VALIDATION_FAILED"
    };
  }
  return {
    status: "passed",
    statusReasonCode: null,
    resultCode: "VALIDATION_PASSED"
  };
}

function terminal(
  statusReasonCode: Exclude<
    SemanticValidationReceipt["statusReasonCode"],
    null | "STEP_FAILED"
  >,
  resultCode: SemanticValidationRunResult["code"]
) {
  return {
    status: "inconclusive" as const,
    statusReasonCode,
    resultCode
  };
}

function nextReceiptPosition(store: SemanticValidationStore): {
  receiptRevision: number;
  previousReceiptSha256: string | null;
} {
  return {
    receiptRevision: store.revision + 1,
    previousReceiptSha256: store.receipts.at(-1)?.receiptSha256 ?? null
  };
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

function skippedStepResults(
  reasonCode: "PRIOR_STEP_TERMINATED" | "PROFILE_MISMATCH"
): SemanticValidationStepResult[] {
  return SEMANTIC_VALIDATION_STEPS.map((step) => ({
    step,
    status: "not_run" as const,
    durationMs: null,
    reasonCode
  }));
}

function inconclusive(
  code: Extract<SemanticValidationRunResult["code"], string>,
  runId: string | null = null,
  receiptSha256: string | null = null,
  stepResults: SemanticValidationStepResult[] = []
): SemanticValidationRunResult {
  return {
    status: "inconclusive",
    code,
    runId,
    receiptSha256,
    stepStatuses: stepResults.map((result) => result.status)
  };
}

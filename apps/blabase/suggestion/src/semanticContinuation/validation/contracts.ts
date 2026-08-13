import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { AttentionCodeProvenance } from "../../attention/codeProvenance";
import {
  runtimeCanonicalJson,
  runtimeSha256,
  runtimeStableId
} from "../../crossSource/canonicalHash";
import type { SemanticContinuationIntentDecision } from "../contracts";
import {
  SEMANTIC_VALIDATION_MAX_RECEIPTS,
  SEMANTIC_VALIDATION_PROFILE_VERSION,
  SEMANTIC_VALIDATION_RECEIPT_CONTRACT,
  SEMANTIC_VALIDATION_RECEIPT_POLICY_VERSION,
  SEMANTIC_VALIDATION_SCHEMA_VERSION,
  SEMANTIC_VALIDATION_STEPS,
  SEMANTIC_VALIDATION_STORE_CONTRACT,
  SEMANTIC_VALIDATION_TTL_MS,
  SEMANTIC_VALIDATION_TTL_POLICY_VERSION
} from "./versions";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const installationSecretSchema = sha256Schema;
const timestampSchema = z.string().datetime().refine(isCanonicalTimestamp, {
  message: "Timestamp must use canonical UTC ISO form"
});
const runIdSchema = z
  .string()
  .regex(/^semantic_validation_run_[a-f0-9]{32}$/u);
const receiptIdSchema = z
  .string()
  .regex(/^semantic_validation_receipt_[a-f0-9]{32}$/u);
const intentDecisionIdSchema = z
  .string()
  .regex(/^semantic_intent_[a-f0-9]{32}$/u);
const itemRefSchema = z
  .string()
  .regex(/^item_ref_[A-Za-z0-9_-]{22,128}$/u);
const workContextRefSchema = z
  .string()
  .regex(/^context_ref_[A-Za-z0-9_-]{22,128}$/u);

const cleanCodeProvenanceSchema = z
  .object({
    kind: z.literal("clean"),
    codeState: z.enum(["clean_commit", "declared_commit"]),
    codeCommitSha: commitShaSchema,
    codeFingerprintSha256: z.null()
  })
  .strict();

const dirtyCodeProvenanceSchema = z
  .object({
    kind: z.literal("dirty"),
    codeState: z.literal("dirty_worktree"),
    codeCommitSha: z.null(),
    codeFingerprintSha256: sha256Schema
  })
  .strict();

const unavailableCodeProvenanceSchema = z
  .object({
    kind: z.literal("unavailable"),
    codeState: z.literal("unavailable"),
    codeCommitSha: z.null(),
    codeFingerprintSha256: z.null()
  })
  .strict();

export const semanticValidationCodeProvenanceSchema = z.discriminatedUnion(
  "kind",
  [
    cleanCodeProvenanceSchema,
    dirtyCodeProvenanceSchema,
    unavailableCodeProvenanceSchema
  ]
);

export const semanticValidationBindingSchema = z
  .object({
    intentDecisionId: intentDecisionIdSchema,
    intentDecisionSha256: sha256Schema,
    itemRef: itemRefSchema,
    workContextRef: workContextRefSchema,
    registrySha256: sha256Schema,
    targetObservedAt: timestampSchema,
    targetCandidateExpiresAt: timestampSchema,
    intentConfirmedAt: timestampSchema,
    intentExpiresAt: timestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    const observedAt = Date.parse(value.targetObservedAt);
    const confirmedAt = Date.parse(value.intentConfirmedAt);
    const candidateExpiresAt = Date.parse(value.targetCandidateExpiresAt);
    const intentExpiresAt = Date.parse(value.intentExpiresAt);
    if (
      observedAt > confirmedAt ||
      confirmedAt >= intentExpiresAt ||
      intentExpiresAt > candidateExpiresAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intentExpiresAt"],
        message: "Semantic validation binding time bounds conflict"
      });
    }
  });

const semanticValidationStepSchema = z.enum(SEMANTIC_VALIDATION_STEPS);

export const semanticValidationStepResultSchema = z
  .object({
    step: semanticValidationStepSchema,
    status: z.enum(["passed", "failed", "inconclusive", "not_run"]),
    durationMs: z.number().int().min(0).max(15 * 60_000).nullable(),
    reasonCode: z
      .enum([
        "NONZERO_EXIT",
        "TIMEOUT",
        "SPAWN_FAILED",
        "PRIOR_STEP_TERMINATED",
        "PROFILE_MISMATCH"
      ])
      .nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.status === "passed" &&
        value.durationMs !== null &&
        value.reasonCode === null) ||
      (value.status === "failed" &&
        value.durationMs !== null &&
        value.reasonCode === "NONZERO_EXIT") ||
      (value.status === "inconclusive" &&
        value.durationMs !== null &&
        (value.reasonCode === "TIMEOUT" ||
          value.reasonCode === "SPAWN_FAILED")) ||
      (value.status === "not_run" &&
        value.durationMs === null &&
        (value.reasonCode === "PRIOR_STEP_TERMINATED" ||
          value.reasonCode === "PROFILE_MISMATCH"));
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Semantic validation step result fields conflict"
      });
    }
  });

const semanticValidationReceiptContentObjectSchema = z
  .object({
    contract: z.literal(SEMANTIC_VALIDATION_RECEIPT_CONTRACT),
    schemaVersion: z.literal(SEMANTIC_VALIDATION_SCHEMA_VERSION),
    receiptPolicyVersion: z.literal(
      SEMANTIC_VALIDATION_RECEIPT_POLICY_VERSION
    ),
    ttlPolicyVersion: z.literal(SEMANTIC_VALIDATION_TTL_POLICY_VERSION),
    profileVersion: z.literal(SEMANTIC_VALIDATION_PROFILE_VERSION),
    profileSteps: z.tuple([
      z.literal("typecheck"),
      z.literal("lint"),
      z.literal("unit_test")
    ]),
    receiptRevision: z.number().int().positive(),
    previousReceiptSha256: sha256Schema.nullable(),
    receiptId: receiptIdSchema,
    runId: runIdSchema,
    status: z.enum(["running", "passed", "failed", "inconclusive"]),
    statusReasonCode: z
      .enum([
        "STEP_FAILED",
        "STEP_TIMEOUT",
        "STEP_UNAVAILABLE",
        "PROFILE_MISMATCH",
        "CODE_PROVENANCE_CHANGED",
        "CODE_PROVENANCE_UNAVAILABLE",
        "VALIDATION_WINDOW_EXPIRED",
        "INTENT_NOT_CURRENT",
        "RUN_ABANDONED"
      ])
      .nullable(),
    binding: semanticValidationBindingSchema,
    startedCodeProvenance: semanticValidationCodeProvenanceSchema,
    endedCodeProvenance: semanticValidationCodeProvenanceSchema.nullable(),
    startedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    stepResults: z.array(semanticValidationStepResultSchema).max(3)
  })
  .strict();

const semanticValidationReceiptContentSchema =
  semanticValidationReceiptContentObjectSchema.superRefine(
    refineSemanticValidationReceipt
  );

export const semanticValidationReceiptSchema =
  semanticValidationReceiptContentObjectSchema
    .extend({
      receiptSha256: sha256Schema,
      receiptHmac: sha256Schema
    })
    .strict()
    .superRefine((value, context) => {
      refineSemanticValidationReceipt(value, context);
      const {
        receiptSha256: _receiptSha256,
        receiptHmac: _receiptHmac,
        ...content
      } = value;
      if (value.receiptSha256 !== semanticValidationReceiptSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["receiptSha256"],
          message: "Semantic validation receipt hash mismatch"
        });
      }
    });

const semanticValidationStoreContentObjectSchema = z
  .object({
    contract: z.literal(SEMANTIC_VALIDATION_STORE_CONTRACT),
    schemaVersion: z.literal(SEMANTIC_VALIDATION_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    currentRunId: runIdSchema.nullable(),
    currentReceiptSha256: sha256Schema.nullable(),
    receipts: z
      .array(semanticValidationReceiptSchema)
      .max(SEMANTIC_VALIDATION_MAX_RECEIPTS)
  })
  .strict();

const semanticValidationStoreContentSchema =
  semanticValidationStoreContentObjectSchema.superRefine(
    refineSemanticValidationStore
  );

export const semanticValidationStoreSchema =
  semanticValidationStoreContentObjectSchema
    .extend({ storeSha256: sha256Schema, storeHmac: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      refineSemanticValidationStore(value, context);
      const {
        storeSha256: _storeSha256,
        storeHmac: _storeHmac,
        ...content
      } = value;
      if (value.storeSha256 !== semanticValidationStoreSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Semantic validation store hash mismatch"
        });
      }
    });

export type SemanticValidationCodeProvenance = z.infer<
  typeof semanticValidationCodeProvenanceSchema
>;
export type SemanticValidationBinding = z.infer<
  typeof semanticValidationBindingSchema
>;
export type SemanticValidationStep = z.infer<
  typeof semanticValidationStepSchema
>;
export type SemanticValidationStepResult = z.infer<
  typeof semanticValidationStepResultSchema
>;
export type SemanticValidationReceipt = z.infer<
  typeof semanticValidationReceiptSchema
>;
export type SemanticValidationStore = z.infer<
  typeof semanticValidationStoreSchema
>;

export function semanticValidationBindingForIntent(
  intent: SemanticContinuationIntentDecision
): SemanticValidationBinding {
  return semanticValidationBindingSchema.parse({
    intentDecisionId: intent.decisionId,
    intentDecisionSha256: intent.decisionSha256,
    itemRef: intent.itemRef,
    workContextRef: intent.workContextRef,
    registrySha256: intent.registrySha256,
    targetObservedAt: intent.targetObservedAt,
    targetCandidateExpiresAt: intent.targetCandidateExpiresAt,
    intentConfirmedAt: intent.confirmedAt,
    intentExpiresAt: intent.expiresAt
  });
}

export function normalizeSemanticValidationCodeProvenance(
  value: AttentionCodeProvenance
): SemanticValidationCodeProvenance {
  const kind =
    value.codeState === "dirty_worktree"
      ? "dirty"
      : value.codeState === "unavailable"
        ? "unavailable"
        : "clean";
  return semanticValidationCodeProvenanceSchema.parse({ kind, ...value });
}

export function sameSemanticValidationCodeProvenance(
  left: SemanticValidationCodeProvenance,
  right: SemanticValidationCodeProvenance
): boolean {
  return runtimeCanonicalJson(left) === runtimeCanonicalJson(right);
}

export function isUsableSemanticValidationCodeProvenance(
  value: SemanticValidationCodeProvenance
): boolean {
  return value.kind === "clean" && value.codeState === "clean_commit";
}

export function createSemanticValidationRunningReceipt(input: {
  receiptRevision: number;
  previousReceiptSha256: string | null;
  runId: string;
  binding: SemanticValidationBinding;
  startedCodeProvenance: SemanticValidationCodeProvenance;
  startedAt: string;
  installationSecret: string;
}): SemanticValidationReceipt {
  const startedAt = timestampSchema.parse(input.startedAt);
  const binding = semanticValidationBindingSchema.parse(input.binding);
  const expiresAt = new Date(
    Math.min(
      Date.parse(startedAt) + SEMANTIC_VALIDATION_TTL_MS,
      Date.parse(binding.intentExpiresAt),
      Date.parse(binding.targetCandidateExpiresAt)
    )
  ).toISOString();
  if (Date.parse(startedAt) >= Date.parse(expiresAt)) {
    throw new TypeError("Semantic validation target is already expired");
  }
  return sealSemanticValidationReceipt(
    {
      contract: SEMANTIC_VALIDATION_RECEIPT_CONTRACT,
      schemaVersion: SEMANTIC_VALIDATION_SCHEMA_VERSION,
      receiptPolicyVersion: SEMANTIC_VALIDATION_RECEIPT_POLICY_VERSION,
      ttlPolicyVersion: SEMANTIC_VALIDATION_TTL_POLICY_VERSION,
      profileVersion: SEMANTIC_VALIDATION_PROFILE_VERSION,
      profileSteps: [...SEMANTIC_VALIDATION_STEPS],
      receiptRevision: input.receiptRevision,
      previousReceiptSha256: input.previousReceiptSha256,
      receiptId: semanticValidationReceiptId({
        runId: input.runId,
        receiptRevision: input.receiptRevision,
        status: "running",
        issuedAt: startedAt
      }),
      runId: runIdSchema.parse(input.runId),
      status: "running",
      statusReasonCode: null,
      binding,
      startedCodeProvenance:
        semanticValidationCodeProvenanceSchema.parse(
          input.startedCodeProvenance
        ),
      endedCodeProvenance: null,
      startedAt,
      completedAt: null,
      issuedAt: startedAt,
      expiresAt,
      stepResults: []
    },
    input.installationSecret
  );
}

export function createSemanticValidationTerminalReceipt(input: {
  runningReceipt: SemanticValidationReceipt;
  receiptRevision: number;
  previousReceiptSha256: string | null;
  status: "passed" | "failed" | "inconclusive";
  statusReasonCode: Exclude<
    SemanticValidationReceipt["statusReasonCode"],
    null
  > | null;
  endedCodeProvenance: SemanticValidationCodeProvenance;
  completedAt: string;
  stepResults: SemanticValidationStepResult[];
  installationSecret: string;
}): SemanticValidationReceipt {
  const running = semanticValidationReceiptSchema.parse(
    input.runningReceipt
  );
  if (running.status !== "running") {
    throw new TypeError("Semantic validation terminal receipt needs a running receipt");
  }
  const completedAt = timestampSchema.parse(input.completedAt);
  return sealSemanticValidationReceipt(
    {
      contract: SEMANTIC_VALIDATION_RECEIPT_CONTRACT,
      schemaVersion: SEMANTIC_VALIDATION_SCHEMA_VERSION,
      receiptPolicyVersion: SEMANTIC_VALIDATION_RECEIPT_POLICY_VERSION,
      ttlPolicyVersion: SEMANTIC_VALIDATION_TTL_POLICY_VERSION,
      profileVersion: SEMANTIC_VALIDATION_PROFILE_VERSION,
      profileSteps: [...SEMANTIC_VALIDATION_STEPS],
      receiptRevision: input.receiptRevision,
      previousReceiptSha256: input.previousReceiptSha256,
      receiptId: semanticValidationReceiptId({
        runId: running.runId,
        receiptRevision: input.receiptRevision,
        status: input.status,
        issuedAt: completedAt
      }),
      runId: running.runId,
      status: input.status,
      statusReasonCode: input.statusReasonCode,
      binding: running.binding,
      startedCodeProvenance: running.startedCodeProvenance,
      endedCodeProvenance:
        semanticValidationCodeProvenanceSchema.parse(
          input.endedCodeProvenance
        ),
      startedAt: running.startedAt,
      completedAt,
      issuedAt: completedAt,
      expiresAt: running.expiresAt,
      stepResults: input.stepResults
    },
    input.installationSecret
  );
}

export function createEmptySemanticValidationStore(input: {
  createdAt: string;
  installationSecret: string;
}): SemanticValidationStore {
  const createdAt = timestampSchema.parse(input.createdAt);
  return sealSemanticValidationStore(
    {
      contract: SEMANTIC_VALIDATION_STORE_CONTRACT,
      schemaVersion: SEMANTIC_VALIDATION_SCHEMA_VERSION,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      currentRunId: null,
      currentReceiptSha256: null,
      receipts: []
    },
    input.installationSecret
  );
}

export function appendSemanticValidationReceipt(input: {
  store: SemanticValidationStore;
  receipt: SemanticValidationReceipt;
  installationSecret: string;
}): SemanticValidationStore {
  const store = verifySemanticValidationStore(
    input.store,
    input.installationSecret
  );
  const receipt = verifySemanticValidationReceipt(
    input.receipt,
    input.installationSecret
  );
  if (store === null || receipt === null) {
    throw new TypeError("Semantic validation authority proof mismatch");
  }
  const receipts = [...store.receipts, receipt];
  const currentRunId = latestStartedRunId(receipts);
  const currentReceipt = [...receipts]
    .reverse()
    .find((candidate) => candidate.runId === currentRunId);
  return sealSemanticValidationStore(
    {
      contract: SEMANTIC_VALIDATION_STORE_CONTRACT,
      schemaVersion: SEMANTIC_VALIDATION_SCHEMA_VERSION,
      revision: receipts.length,
      createdAt: store.createdAt,
      updatedAt: receipt.issuedAt,
      currentRunId,
      currentReceiptSha256: currentReceipt?.receiptSha256 ?? null,
      receipts
    },
    input.installationSecret
  );
}

export function verifySemanticValidationReceipt(
  input: unknown,
  installationSecret: string
): SemanticValidationReceipt | null {
  const parsed = semanticValidationReceiptSchema.safeParse(input);
  if (!parsed.success) return null;
  const expected = semanticValidationReceiptHmac(
    parsed.data.receiptSha256,
    installationSecret
  );
  return secureHexEqual(parsed.data.receiptHmac, expected)
    ? parsed.data
    : null;
}

export function verifySemanticValidationStore(
  input: unknown,
  installationSecret: string
): SemanticValidationStore | null {
  const parsed = semanticValidationStoreSchema.safeParse(input);
  if (!parsed.success) return null;
  if (
    parsed.data.receipts.some(
      (receipt) =>
        verifySemanticValidationReceipt(receipt, installationSecret) === null
    )
  ) {
    return null;
  }
  const expected = semanticValidationStoreHmac(
    parsed.data.storeSha256,
    installationSecret
  );
  return secureHexEqual(parsed.data.storeHmac, expected)
    ? parsed.data
    : null;
}

function sealSemanticValidationReceipt(
  contentInput: z.input<typeof semanticValidationReceiptContentSchema>,
  installationSecretInput: string
): SemanticValidationReceipt {
  const installationSecret = installationSecretSchema.parse(
    installationSecretInput
  );
  const content = semanticValidationReceiptContentSchema.parse(contentInput);
  const receiptSha256 = semanticValidationReceiptSha256(content);
  return semanticValidationReceiptSchema.parse({
    ...content,
    receiptSha256,
    receiptHmac: semanticValidationReceiptHmac(
      receiptSha256,
      installationSecret
    )
  });
}

function sealSemanticValidationStore(
  contentInput: z.input<typeof semanticValidationStoreContentSchema>,
  installationSecretInput: string
): SemanticValidationStore {
  const installationSecret = installationSecretSchema.parse(
    installationSecretInput
  );
  const content = semanticValidationStoreContentSchema.parse(contentInput);
  const storeSha256 = semanticValidationStoreSha256(content);
  return semanticValidationStoreSchema.parse({
    ...content,
    storeSha256,
    storeHmac: semanticValidationStoreHmac(
      storeSha256,
      installationSecret
    )
  });
}

function semanticValidationReceiptId(value: {
  runId: string;
  receiptRevision: number;
  status: string;
  issuedAt: string;
}): string {
  return runtimeStableId(
    "semantic_validation_receipt",
    "semantic-validation-receipt-id-v0.1",
    value
  );
}

function semanticValidationReceiptSha256(value: unknown): string {
  return runtimeSha256({
    domain: "semantic-validation-receipt-hash-v0.1",
    receipt: value
  });
}

function semanticValidationStoreSha256(value: unknown): string {
  return runtimeSha256({
    domain: "semantic-validation-store-hash-v0.1",
    store: value
  });
}

function semanticValidationReceiptHmac(
  receiptSha256: string,
  installationSecret: string
): string {
  return semanticValidationHmac(
    "semantic-validation-receipt-hmac-v0.1",
    receiptSha256,
    installationSecret
  );
}

function semanticValidationStoreHmac(
  storeSha256: string,
  installationSecret: string
): string {
  return semanticValidationHmac(
    "semantic-validation-store-hmac-v0.1",
    storeSha256,
    installationSecret
  );
}

function semanticValidationHmac(
  domain: string,
  sha256: string,
  installationSecret: string
): string {
  return createHmac("sha256", Buffer.from(installationSecret, "hex"))
    .update(runtimeCanonicalJson({ domain, sha256 }))
    .digest("hex");
}

function refineSemanticValidationReceipt(
  value: z.infer<typeof semanticValidationReceiptContentObjectSchema>,
  context: z.RefinementCtx
): void {
  const expectedReceiptId = semanticValidationReceiptId({
    runId: value.runId,
    receiptRevision: value.receiptRevision,
    status: value.status,
    issuedAt: value.issuedAt
  });
  if (value.receiptId !== expectedReceiptId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptId"],
      message: "Semantic validation receipt ID mismatch"
    });
  }
  const expectedExpiry = Math.min(
    Date.parse(value.startedAt) + SEMANTIC_VALIDATION_TTL_MS,
    Date.parse(value.binding.intentExpiresAt),
    Date.parse(value.binding.targetCandidateExpiresAt)
  );
  if (
    Date.parse(value.startedAt) < Date.parse(value.binding.intentConfirmedAt) ||
    Date.parse(value.startedAt) >= expectedExpiry ||
    Date.parse(value.expiresAt) !== expectedExpiry
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Semantic validation receipt TTL mismatch"
    });
  }
  if (value.status === "running") {
    if (
      value.statusReasonCode !== null ||
      value.endedCodeProvenance !== null ||
      value.completedAt !== null ||
      value.issuedAt !== value.startedAt ||
      value.stepResults.length !== 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Running semantic validation receipt fields conflict"
      });
    }
    return;
  }
  if (
    value.endedCodeProvenance === null ||
    value.completedAt === null ||
    value.issuedAt !== value.completedAt ||
    Date.parse(value.completedAt) < Date.parse(value.startedAt) ||
    !hasExactStepOrder(value.stepResults)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Terminal semantic validation receipt fields conflict"
    });
    return;
  }
  const usableStableCode =
    isUsableSemanticValidationCodeProvenance(
      value.startedCodeProvenance
    ) &&
    isUsableSemanticValidationCodeProvenance(value.endedCodeProvenance) &&
    sameSemanticValidationCodeProvenance(
      value.startedCodeProvenance,
      value.endedCodeProvenance
    );
  if (value.status === "passed") {
    if (
      value.statusReasonCode !== null ||
      !usableStableCode ||
      Date.parse(value.completedAt) >= Date.parse(value.expiresAt) ||
      value.stepResults.some((result) => result.status !== "passed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passed semantic validation receipt fields conflict"
      });
    }
    return;
  }
  if (value.status === "failed") {
    if (
      value.statusReasonCode !== "STEP_FAILED" ||
      !usableStableCode ||
      Date.parse(value.completedAt) >= Date.parse(value.expiresAt) ||
      !hasTerminalStepShape(value.stepResults, "failed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed semantic validation receipt fields conflict"
      });
    }
    return;
  }
  if (
    value.statusReasonCode === null ||
    value.statusReasonCode === "STEP_FAILED" ||
    !hasInconclusiveShape(value)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Inconclusive semantic validation receipt fields conflict"
    });
  }
}

function hasInconclusiveShape(
  value: z.infer<typeof semanticValidationReceiptContentObjectSchema>
): boolean {
  switch (value.statusReasonCode) {
    case "PROFILE_MISMATCH":
      return value.stepResults.every(
        (result) =>
          result.status === "not_run" &&
          result.reasonCode === "PROFILE_MISMATCH"
      );
    case "STEP_TIMEOUT":
    case "STEP_UNAVAILABLE":
      return hasTerminalStepShape(value.stepResults, "inconclusive");
    case "CODE_PROVENANCE_CHANGED":
      return !sameSemanticValidationCodeProvenance(
        value.startedCodeProvenance,
        value.endedCodeProvenance!
      );
    case "CODE_PROVENANCE_UNAVAILABLE":
      return (
        !isUsableSemanticValidationCodeProvenance(
          value.startedCodeProvenance
        ) ||
        !isUsableSemanticValidationCodeProvenance(
          value.endedCodeProvenance!
        )
      );
    case "VALIDATION_WINDOW_EXPIRED":
      return Date.parse(value.completedAt!) >= Date.parse(value.expiresAt);
    case "INTENT_NOT_CURRENT":
      return true;
    case "RUN_ABANDONED":
      return value.stepResults.every(
        (result) =>
          result.status === "not_run" &&
          result.reasonCode === "PRIOR_STEP_TERMINATED"
      );
    default:
      return false;
  }
}

function hasExactStepOrder(
  values: SemanticValidationStepResult[]
): boolean {
  return (
    values.length === SEMANTIC_VALIDATION_STEPS.length &&
    values.every(
      (value, index) => value.step === SEMANTIC_VALIDATION_STEPS[index]
    )
  );
}

function hasTerminalStepShape(
  values: SemanticValidationStepResult[],
  terminalStatus: "failed" | "inconclusive"
): boolean {
  const terminalIndex = values.findIndex(
    (result) => result.status === terminalStatus
  );
  return (
    terminalIndex >= 0 &&
    values.filter((result) => result.status === terminalStatus).length === 1 &&
    values.every((result, index) =>
      index < terminalIndex
        ? result.status === "passed"
        : index === terminalIndex
          ? result.status === terminalStatus
          : result.status === "not_run"
    )
  );
}

function refineSemanticValidationStore(
  value: z.infer<typeof semanticValidationStoreContentObjectSchema>,
  context: z.RefinementCtx
): void {
  if (
    value.revision !== value.receipts.length ||
    Date.parse(value.createdAt) > Date.parse(value.updatedAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["revision"],
      message: "Semantic validation store revision mismatch"
    });
  }
  if (
    value.receipts.some(
      (receipt, index) =>
        receipt.receiptRevision !== index + 1 ||
        receipt.previousReceiptSha256 !==
          (index === 0 ? null : value.receipts[index - 1]!.receiptSha256) ||
        (index > 0 &&
          Date.parse(receipt.issuedAt) <
            Date.parse(value.receipts[index - 1]!.issuedAt))
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receipts"],
      message: "Semantic validation receipt chain mismatch"
    });
  }
  const receiptIds = value.receipts.map((receipt) => receipt.receiptId);
  if (new Set(receiptIds).size !== receiptIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receipts"],
      message: "Semantic validation receipt IDs must be unique"
    });
  }
  const runs = new Map<string, SemanticValidationReceipt[]>();
  for (const receipt of value.receipts) {
    const receipts = runs.get(receipt.runId) ?? [];
    receipts.push(receipt);
    runs.set(receipt.runId, receipts);
  }
  for (const receipts of runs.values()) {
    const running = receipts.filter((receipt) => receipt.status === "running");
    const terminal = receipts.filter((receipt) => receipt.status !== "running");
    if (
      running.length !== 1 ||
      terminal.length > 1 ||
      (terminal[0] !== undefined &&
        !terminalMatchesRunning(terminal[0], running[0]!))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipts"],
        message: "Semantic validation run lifecycle mismatch"
      });
    }
  }
  const latestRunId = latestStartedRunId(value.receipts);
  const latestReceipt = [...value.receipts]
    .reverse()
    .find((receipt) => receipt.runId === latestRunId);
  if (
    value.currentRunId !== latestRunId ||
    value.currentReceiptSha256 !== (latestReceipt?.receiptSha256 ?? null) ||
    value.updatedAt !==
      (value.receipts.at(-1)?.issuedAt ?? value.createdAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentRunId"],
      message: "Semantic validation current run pointer mismatch"
    });
  }
}

function terminalMatchesRunning(
  terminal: SemanticValidationReceipt,
  running: SemanticValidationReceipt
): boolean {
  return (
    terminal.receiptRevision > running.receiptRevision &&
    terminal.startedAt === running.startedAt &&
    terminal.expiresAt === running.expiresAt &&
    terminal.profileVersion === running.profileVersion &&
    runtimeCanonicalJson(terminal.profileSteps) ===
      runtimeCanonicalJson(running.profileSteps) &&
    runtimeCanonicalJson(terminal.binding) ===
      runtimeCanonicalJson(running.binding) &&
    sameSemanticValidationCodeProvenance(
      terminal.startedCodeProvenance,
      running.startedCodeProvenance
    )
  );
}

function latestStartedRunId(
  receipts: SemanticValidationReceipt[]
): string | null {
  return (
    [...receipts]
      .reverse()
      .find((receipt) => receipt.status === "running")?.runId ?? null
  );
}

function secureHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

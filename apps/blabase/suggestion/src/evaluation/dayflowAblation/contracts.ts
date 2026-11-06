import { z } from "zod";

import {
  boundedJsonUnsignedIntegerSchema,
  dataOriginSchema,
  domainSeparatedSha256,
  evidenceIdSchema,
  hashRegisteredArtifact,
  jcsCanonicalize,
  jsonUnsignedIntegerSchema,
  schemaVersionSchema,
  semanticOutputSchema,
  semanticOutputSha256,
  sha256HexSchema,
  studyPhaseSchema,
  utcTimestampSchema,
  dayflowNormalizedEvidenceSchema,
  dayflowScreenEvidenceExportSchema,
  verifyResolvedNormalizedEvidence,
  verifyRegisteredArtifactHash,
} from "../../dayflowEvidence/contracts";

const ARM_ORDER = ["A0", "A1", "B", "C"] as const;
const PILOT_CHECKPOINT_TARGET = 15;
const DIRECTIONAL_CHECKPOINT_TARGET = 60;
const HARD_RAW_RETENTION_MAX_MS = 86_400_000;

export const dayflowArmIdSchema = z.enum(ARM_ORDER);
export const replicateIndexSchema = boundedJsonUnsignedIntegerSchema(7);
export const counterSchema = jsonUnsignedIntegerSchema;
export const basisPointsSchema = boundedJsonUnsignedIntegerSchema(10_000);
export const canonicalDecimalStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/);
export const issueCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);

const CREDENTIAL_SHAPED_TEXT = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/u,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/u,
  /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret|token|authorization|cookie|session[_-]?id)\b["']?\s*[:=]\s*["']?\S{4,}/iu,
  /\b[A-Z0-9_]*(?:PASSWORD|PASSWD|API_KEY|TOKEN|SECRET|PRIVATE_KEY)[A-Z0-9_]*\b["']?\s*[:=]\s*["']?\S{4,}/iu,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/u,
] as const;

function isPrintableUnicode(value: string, allowLf: boolean): boolean {
  for (const character of value) {
    if (character === "\n") {
      if (allowLf) continue;
      return false;
    }
    if (/^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]$/u.test(character)) {
      return false;
    }
  }
  return true;
}

function containsCredentialShapedText(value: string): boolean {
  if (CREDENTIAL_SHAPED_TEXT.some((pattern) => pattern.test(value))) {
    return true;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    return !(error instanceof SyntaxError);
  }
  const pending: unknown[] = [parsed];
  let visited = 0;
  while (pending.length > 0) {
    visited += 1;
    if (visited > 4_096) return true;
    const current = pending.pop();
    if (Array.isArray(current)) {
      if (pending.length + current.length > 4_096) return true;
      for (const child of current) pending.push(child);
      continue;
    }
    if (
      typeof current === "string" &&
      CREDENTIAL_SHAPED_TEXT.some((pattern) => pattern.test(current))
    ) {
      return true;
    }
    if (current === null || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (
        CREDENTIAL_SHAPED_TEXT.some((pattern) =>
          pattern.test(`${key}=NESTED_VALUE`),
        )
      ) {
        return true;
      }
      if (child !== null && typeof child === "object") {
        if (pending.length >= 4_096) return true;
        pending.push(child);
        continue;
      }
      const candidate = `${key}=${String(child)}`;
      if (CREDENTIAL_SHAPED_TEXT.some((pattern) => pattern.test(candidate))) {
        return true;
      }
    }
  }
  return false;
}

function printableTextSchema(maxLength: number, allowLf: boolean) {
  return z
    .string()
    .max(maxLength)
    .refine(
      (value) => isPrintableUnicode(value, allowLf),
      allowLf
        ? "only printable Unicode and LF are allowed"
        : "only printable Unicode is allowed",
    )
    .refine(
      (value) => !containsCredentialShapedText(value),
      "credential-shaped or private-secret text is forbidden",
    );
}

const safeTextSchema = printableTextSchema(256, false);
const nonEmptySafeTextSchema = safeTextSchema.refine(
  (value) => value.length > 0,
  "value must not be empty",
);
const reasonTextSchema = printableTextSchema(1_024, true);
const relativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => isPrintableUnicode(value, false),
    "relative paths must contain only printable Unicode",
  )
  .refine((value) => !value.startsWith("/"), "absolute paths are forbidden")
  .refine((value) => !value.includes("\\"), "backslash paths are forbidden")
  .refine(
    (value) => !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value),
    "URI and drive-qualified paths are forbidden",
  )
  .refine(
    (value) => !value.split("/").some((segment) => segment === ".."),
    "parent traversal is forbidden",
  );

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return jcsCanonicalize(left) === jcsCanonicalize(right);
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const epoch = Date.parse(timestamp);
  const deadline = epoch + milliseconds;
  if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(deadline)) {
    throw new TypeError("Timestamp arithmetic exceeded the safe epoch range");
  }
  return new Date(deadline).toISOString();
}

function isStrictlySortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compareStrings(key(values[index - 1]), key(values[index])) >= 0) {
      return false;
    }
  }
  return true;
}

function addSortedIssue<T>(
  values: readonly T[],
  context: z.RefinementCtx,
  key: (value: T) => string,
  path: (string | number)[],
): void {
  if (!isStrictlySortedUnique(values, key)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "entries must be strictly sorted and unique",
    });
  }
}

function hasValidEvidenceOriginPhase(value: {
  lineageClass: string;
  dataOrigin: string;
  studyPhase: string;
}): boolean {
  return (
    value.lineageClass === "evidence" &&
    ((value.dataOrigin === "synthetic" &&
      value.studyPhase === "contract_conformance") ||
      (value.dataOrigin === "live" &&
        (value.studyPhase === "private_pilot" ||
          value.studyPhase === "directional_study")))
  );
}

function addRegisteredHashIssue(
  artifactClass: string,
  value: Readonly<Record<string, unknown>>,
  context: z.RefinementCtx,
  detachedHashField: string,
): void {
  if (!verifyRegisteredArtifactHash(artifactClass, value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [detachedHashField],
      message: `registered ${artifactClass} hash mismatch`,
    });
  }
}

export const evidenceLineageSchema = z
  .object({
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid = hasValidEvidenceOriginPhase(value);
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
  });

export const controlLineageSchema = z
  .object({ lineageClass: z.literal("control") })
  .strict();

export const DAYFLOW_ABLATION_ARTIFACT_REGISTRY = [
  [
    "dayflow-export-manifest",
    "dayflow-screen-evidence-export-v0.1",
    "blabase.dayflow-screen-evidence-export.v0.1",
    "standalone",
    "detachedManifestSha256",
  ],
  [
    "normalized-screen-evidence",
    "dayflow-normalized-evidence-v0.1",
    "blabase.dayflow-normalized-evidence.v0.1",
    "standalone",
    "dayflowNormalizedEvidenceHash",
  ],
  [
    "artifact-layout-config",
    "dayflow-ablation-artifact-layout-config-v0.2",
    "blabase.dayflow-ablation.artifact-layout-config.v0.2",
    "standalone",
    "artifactLayoutConfigSha256",
  ],
  [
    "experiment-manifest",
    "dayflow-ablation-experiment-manifest-v0.2",
    "blabase.dayflow-ablation.experiment-manifest.v0.2",
    "standalone",
    "experimentManifestSha256",
  ],
  [
    "evaluation-execution-freeze",
    "dayflow-ablation-evaluation-execution-freeze-v0.3",
    "blabase.dayflow-ablation.evaluation-execution-freeze.v0.3",
    "standalone",
    "evaluationExecutionFreezeSha256",
  ],
  [
    "live-collection-freeze",
    "dayflow-ablation-live-collection-freeze-v0.3",
    "blabase.dayflow-ablation.live-collection-freeze.v0.3",
    "standalone",
    "liveCollectionFreezeSha256",
  ],
  [
    "human-approval-record",
    "dayflow-ablation-human-approval-v0.1",
    "blabase.dayflow-ablation.human-approval.v0.1",
    "standalone",
    "approvalRecordSha256",
  ],
  [
    "study-protocol",
    "dayflow-ablation-study-protocol-v0.3",
    "blabase.dayflow-ablation.study-protocol.v0.3",
    "standalone",
    "studyProtocolHash",
  ],
  [
    "request-order-manifest",
    "dayflow-ablation-request-order-manifest-v0.1",
    "blabase.dayflow-ablation.request-order-manifest.v0.1",
    "standalone",
    "requestOrderManifestSha256",
  ],
  [
    "request-issuance-receipt",
    "dayflow-ablation-request-issuance-receipt-v0.1",
    "blabase.dayflow-ablation.request-issuance-receipt.v0.1",
    "standalone",
    "requestIssuanceReceiptSha256",
  ],
  [
    "blind-permutation",
    "dayflow-ablation-blind-permutation-v0.1",
    "blabase.dayflow-ablation.blind-permutation.v0.1",
    "standalone",
    "permutationHash",
  ],
  [
    "candidate-dataset-generation",
    "dayflow-ablation-candidate-dataset-generation-v0.1",
    "blabase.dayflow-ablation.candidate-dataset-generation.v0.1",
    "standalone",
    "candidateDatasetGenerationSha256",
  ],
  [
    "exclusion-decision",
    "dayflow-ablation-exclusion-decision-v0.1",
    "blabase.dayflow-ablation.exclusion-decision.v0.1",
    "standalone",
    "exclusionDecisionSha256",
  ],
  [
    "exclusion-closure",
    "dayflow-ablation-exclusion-closure-v0.1",
    "blabase.dayflow-ablation.exclusion-closure.v0.1",
    "standalone",
    "exclusionClosureSha256",
  ],
  [
    "final-dataset-manifest",
    "dayflow-ablation-final-dataset-manifest-v0.1",
    "blabase.dayflow-ablation.final-dataset-manifest.v0.1",
    "standalone",
    "datasetSha256",
  ],
  [
    "final-dataset-binding",
    "dayflow-ablation-final-dataset-binding-v0.1",
    "blabase.dayflow-ablation.final-dataset-binding.v0.1",
    "standalone",
    "finalDatasetBindingSha256",
  ],
  [
    "pilot-verification-attestation",
    "dayflow-ablation-pilot-verification-attestation-v0.1",
    "blabase.dayflow-ablation.pilot-verification-attestation.v0.1",
    "standalone",
    "pilotVerificationAttestationSha256",
  ],
  [
    "evaluation-checkpoint",
    "dayflow-ablation-checkpoint-v0.2",
    "blabase.dayflow-ablation.checkpoint.v0.2",
    "standalone",
    "checkpointSha256",
  ],
  [
    "checkpoint-completion",
    "dayflow-ablation-checkpoint-completion-v0.1",
    "blabase.dayflow-ablation.checkpoint-completion.v0.1",
    "standalone",
    "checkpointCompletionSha256",
  ],
  [
    "a0-arm-input",
    "dayflow-ablation-arm-input-v0.4",
    "blabase.dayflow-ablation.arm-input.a0.v0.4",
    "standalone",
    "armInputHash",
  ],
  [
    "a1-arm-input",
    "dayflow-ablation-arm-input-v0.4",
    "blabase.dayflow-ablation.arm-input.a1.v0.4",
    "standalone",
    "armInputHash",
  ],
  [
    "b-arm-input",
    "dayflow-ablation-arm-input-v0.4",
    "blabase.dayflow-ablation.arm-input.b.v0.4",
    "standalone",
    "armInputHash",
  ],
  [
    "c-arm-input",
    "dayflow-ablation-arm-input-v0.4",
    "blabase.dayflow-ablation.arm-input.c.v0.4",
    "standalone",
    "armInputHash",
  ],
  [
    "semantic-output",
    "dayflow-ablation-semantic-output-v0.1",
    "blabase.dayflow-ablation.semantic-output.v0.1",
    "standalone",
    "semanticOutputSha256",
  ],
  [
    "arm-run",
    "dayflow-ablation-run-v0.4",
    "blabase.dayflow-ablation.run.v0.4",
    "standalone",
    "runSha256",
  ],
  [
    "run-results",
    "dayflow-ablation-run-results-v0.1",
    "blabase.dayflow-ablation.run-results.v0.1",
    "standalone",
    "runResultsSha256",
  ],
  [
    "output-review",
    "dayflow-ablation-output-review-v0.2",
    "blabase.dayflow-ablation.output-review.v0.2",
    "standalone",
    "outputReviewSha256",
  ],
  [
    "pair-preference-review",
    "dayflow-ablation-pair-preference-review-v0.2",
    "blabase.dayflow-ablation.pair-preference-review.v0.2",
    "standalone",
    "pairPreferenceReviewSha256",
  ],
  [
    "deletion-receipt",
    "dayflow-ablation-deletion-receipt-v0.1",
    "blabase.dayflow-ablation.deletion-receipt.v0.1",
    "standalone",
    "deletionReceiptSha256",
  ],
  [
    "aggregate",
    "dayflow-ablation-aggregate-v0.1",
    "blabase.dayflow-ablation.aggregate.v0.1",
    "standalone",
    "aggregateSha256",
  ],
] as const;

DAYFLOW_ABLATION_ARTIFACT_REGISTRY.forEach((entry) => Object.freeze(entry));
Object.freeze(DAYFLOW_ABLATION_ARTIFACT_REGISTRY);

export const dayflowAblationRegistryEntrySchema = z
  .object({
    artifactClass: z.enum(
      DAYFLOW_ABLATION_ARTIFACT_REGISTRY.map((row) => row[0]) as [
        (typeof DAYFLOW_ABLATION_ARTIFACT_REGISTRY)[number][0],
        ...(typeof DAYFLOW_ABLATION_ARTIFACT_REGISTRY)[number][0][],
      ],
    ),
    schemaVersion: schemaVersionSchema,
    hashDomain: z.string().min(1).max(128),
    storageMode: z.enum(["standalone", "embedded"]),
  })
  .strict();

export const dayflowAblationArtifactRegistry =
  DAYFLOW_ABLATION_ARTIFACT_REGISTRY.map(
    ([
      artifactClass,
      schemaVersion,
      hashDomain,
      storageMode,
      _detachedHashField,
    ]) =>
      dayflowAblationRegistryEntrySchema.parse({
        artifactClass,
        schemaVersion,
        hashDomain,
        storageMode,
      }),
  );

dayflowAblationArtifactRegistry.forEach((entry) => Object.freeze(entry));
Object.freeze(dayflowAblationArtifactRegistry);

export const DAYFLOW_ABLATION_DETACHED_HASH_FIELDS = Object.freeze(
  Object.fromEntries(
    DAYFLOW_ABLATION_ARTIFACT_REGISTRY.map(
      ([artifactClass, , , , detachedHashField]) => [
        artifactClass,
        detachedHashField,
      ],
    ),
  ) as Readonly<Record<DayflowAblationArtifactClass, string>>,
);

export type DayflowAblationArtifactClass =
  (typeof DAYFLOW_ABLATION_ARTIFACT_REGISTRY)[number][0];

export function getDayflowAblationArtifactRegistration(
  artifactClass: DayflowAblationArtifactClass,
) {
  const registration = dayflowAblationArtifactRegistry.find(
    (entry) => entry.artifactClass === artifactClass,
  );
  if (!registration) {
    throw new Error(`Unregistered Dayflow ablation artifact: ${artifactClass}`);
  }
  return registration;
}

const versionHashRefSchema = z
  .object({ version: schemaVersionSchema, sha256: sha256HexSchema })
  .strict();
const studyProtocolRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-study-protocol-v0.3"),
    studyProtocolHash: sha256HexSchema,
  })
  .strict();
export const experimentManifestRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-experiment-manifest-v0.2"),
    experimentManifestId: evidenceIdSchema,
    experimentManifestSha256: sha256HexSchema,
  })
  .strict();
const executionFreezeRefSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-evaluation-execution-freeze-v0.3",
    ),
    evaluationExecutionFreezeId: evidenceIdSchema,
    evaluationExecutionFreezeSha256: sha256HexSchema,
  })
  .strict();
const checkpointRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-checkpoint-v0.2"),
    checkpointId: evidenceIdSchema,
    checkpointSha256: sha256HexSchema,
  })
  .strict();
const requestOrderManifestRefSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-request-order-manifest-v0.1",
    ),
    requestOrderManifestId: evidenceIdSchema,
    requestOrderManifestSha256: sha256HexSchema,
  })
  .strict();
const requestIssuanceReceiptRefSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-request-issuance-receipt-v0.1",
    ),
    requestIssuanceReceiptId: evidenceIdSchema,
    requestIssuanceReceiptSha256: sha256HexSchema,
  })
  .strict();
const normalizedEvidenceRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-normalized-evidence-v0.1"),
    evidenceId: evidenceIdSchema,
    dayflowNormalizedEvidenceHash: sha256HexSchema,
  })
  .strict();
const armInputRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-arm-input-v0.4"),
    armInputId: evidenceIdSchema,
    armInputHash: sha256HexSchema,
  })
  .strict();
const runRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-run-v0.4"),
    runId: evidenceIdSchema,
    runSha256: sha256HexSchema,
    armId: dayflowArmIdSchema,
    replicateIndex: replicateIndexSchema,
  })
  .strict();
export const runResultsRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-run-results-v0.1"),
    runResultsId: evidenceIdSchema,
    runResultsSha256: sha256HexSchema,
  })
  .strict();
const candidateGenerationRefSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-candidate-dataset-generation-v0.1",
    ),
    candidateDatasetGenerationId: evidenceIdSchema,
    candidateDatasetGenerationSha256: sha256HexSchema,
  })
  .strict();
const pilotVerificationAttestationRefSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-pilot-verification-attestation-v0.1",
    ),
    pilotVerificationAttestationId: evidenceIdSchema,
    pilotVerificationAttestationSha256: sha256HexSchema,
  })
  .strict();

const deterministicFixtureTupleSchema = z
  .object({
    generationMode: z.literal("deterministic_fixture_only"),
    provider: z.literal("none"),
    model: z.literal("none"),
    promptVersion: z.literal("none"),
    promptSha256: z.literal("none"),
    templateVersion: z.literal("none"),
    generationParameters: z.object({}).strict(),
    fixtureGeneratorVersion: schemaVersionSchema,
    fixtureGeneratorSeed: safeTextSchema,
    fixtureGeneratorConfigSha256: sha256HexSchema,
    syntheticOnly: z.literal(true),
  })
  .strict();

export const DFA002_REQUIRED_PROVENANCE_PIN_SHAPES = [
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "architecture/planned.c4" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "architecture/views.c4" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/docs/ENGINE_CHANGE_RECORD.md" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/src/dayflowEvidence/contracts.ts" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/src/evaluation/dayflowAblation/buildDataset.ts" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/src/evaluation/dayflowAblation/contracts.ts" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/src/evaluation/dayflowAblation/runGeneration.ts" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/tests/dayflowAblationEvaluation.test.ts" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/tests/dayflowEvidenceContracts.test.ts" },
  { repositoryId: "blabase", pinRole: "authorized-output-baseline", pinKind: "file-sha256", relativePath: "suggestion/tests/dayflowEvidenceExtraction.test.ts" },
  { repositoryId: "blabase", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "suggestion/docs/DAYFLOW_SUGGESTION_ABLATION_PLAN.md" },
  { repositoryId: "blabase", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "suggestion/docs/DAYFLOW_SUGGESTION_ABLATION_RUNBOOK.md" },
  { repositoryId: "blabase", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "suggestion/package-lock.json" },
  { repositoryId: "blabase", pinRole: "immutable-input", pinKind: "repository-revision", relativePath: ".", expectedRevision: "92b2ca94fc3e8347261ac6a85a627c8e6c915400" },
  { repositoryId: "dayflow", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "Dayflow/Dayflow.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved", expectedSha256: "2fbad062f299f029a3ac35ae82ef06eca622ad3abcb7486aff9687c8e3f33077", expectedByteLength: "2013" },
  { repositoryId: "dayflow", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "Dayflow/Dayflow/Core/Recording/ScreenRecorder.swift", expectedSha256: "94f2683bce56a1aec41bab3a856b07a551d87d09e64d4bc7186046d76448192e", expectedByteLength: "22192" },
  { repositoryId: "dayflow", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "Dayflow/Dayflow/Core/Recording/StorageManager+Screenshots.swift", expectedSha256: "67e0ca38c673981a1a9da2d48c2359f47132c44c817789d6ad0c6468feb4b1f4", expectedByteLength: "3648" },
  { repositoryId: "dayflow", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "Dayflow/Dayflow/Core/Recording/StorageManager.swift", expectedSha256: "d1fc88fe3b0caec6c2cc4dc28c8fc75735d99dfbc56b47518fb14024c394ae7b", expectedByteLength: "29266" },
  { repositoryId: "dayflow", pinRole: "immutable-input", pinKind: "file-sha256", relativePath: "docs/BLABASE_DAYFLOW_DATA_ARCHITECTURE.md", expectedSha256: "bfc38c0c22aa594711db04e87210f7b64d82802d1b8d93d5be28d39ad0dc8b39", expectedByteLength: "31924" },
  { repositoryId: "dayflow", pinRole: "immutable-input", pinKind: "repository-revision", relativePath: ".", expectedRevision: "df3c367edb7d405a78d1ae76edffe4ba366f57d7" },
] as const;

DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.forEach((entry) => Object.freeze(entry));
Object.freeze(DFA002_REQUIRED_PROVENANCE_PIN_SHAPES);

const provenancePinSchema = z.discriminatedUnion("pinKind", [
  z
    .object({
      repositoryId: z.enum(["blabase", "dayflow"]),
      pinRole: z.enum(["immutable-input", "authorized-output-baseline"]),
      pinKind: z.literal("repository-revision"),
      relativePath: z.literal("."),
      revision: safeTextSchema,
    })
    .strict(),
  z
    .object({
      repositoryId: z.enum(["blabase", "dayflow"]),
      pinRole: z.enum(["immutable-input", "authorized-output-baseline"]),
      pinKind: z.literal("file-sha256"),
      relativePath: relativePathSchema,
      sha256: sha256HexSchema,
    })
    .strict(),
]);

const sourceProvenancePayloadSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-source-provenance-v0.1",
    ),
    pins: z.array(provenancePinSchema).min(1).max(32),
    createdAt: utcTimestampSchema,
  })
  .strict();

export const DAYFLOW_ABLATION_SOURCE_PROVENANCE_HASH_DOMAIN =
  "blabase.dayflow-ablation.source-provenance.v0.1";

export type DayflowAblationSourceProvenancePayload = z.infer<
  typeof sourceProvenancePayloadSchema
>;

export function dayflowAblationSourceProvenanceSha256(
  value: DayflowAblationSourceProvenancePayload,
): string {
  return domainSeparatedSha256(
    DAYFLOW_ABLATION_SOURCE_PROVENANCE_HASH_DOMAIN,
    sourceProvenancePayloadSchema.parse(value),
  );
}

export const sourceProvenanceSchema = sourceProvenancePayloadSchema
  .extend({ sourceProvenanceSha256: sha256HexSchema })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.pins,
      context,
      (pin) =>
        `${pin.repositoryId}\u0000${pin.pinRole}\u0000${pin.pinKind}\u0000${pin.relativePath}`,
      ["pins"],
    );
    const exactShape =
      value.pins.length === DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.length &&
      value.pins.every((pin, index) => {
        const expected = DFA002_REQUIRED_PROVENANCE_PIN_SHAPES[index];
        if (
          expected === undefined ||
          pin.repositoryId !== expected.repositoryId ||
          pin.pinRole !== expected.pinRole ||
          pin.pinKind !== expected.pinKind ||
          pin.relativePath !== expected.relativePath
        ) {
          return false;
        }
        return pin.pinKind === "repository-revision"
          ? "expectedRevision" in expected &&
              pin.revision === expected.expectedRevision
          : !("expectedSha256" in expected) ||
              (pin.sha256 === expected.expectedSha256 &&
                expected.repositoryId === "dayflow");
      });
    if (!exactShape) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pins"],
        message: "source provenance must exactly cover the DFA-002 role/path/revision set",
      });
    }
    const { sourceProvenanceSha256, ...payload } = value;
    if (
      sourceProvenanceSha256 !==
      dayflowAblationSourceProvenanceSha256(payload)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceProvenanceSha256"],
        message: "source provenance hash mismatch",
      });
    }
  });

const pathTemplateSchema = z
  .object({
    artifactClass: z.enum(
      DAYFLOW_ABLATION_ARTIFACT_REGISTRY.map((row) => row[0]) as [
        DayflowAblationArtifactClass,
        ...DayflowAblationArtifactClass[],
      ],
    ),
    relativeTemplate: relativePathSchema,
  })
  .strict();

export const artifactLayoutConfigSchema = z
  .object({
    artifactLayoutConfigSchemaVersion: z.literal(
      "dayflow-ablation-artifact-layout-config-v0.2",
    ),
    artifactLayoutConfigId: evidenceIdSchema,
    lineageClass: z.literal("control"),
    root: z.literal("suggestion/.local/evaluations/dayflow-ablation"),
    pathTemplates: z.array(pathTemplateSchema).max(256),
    temporaryRootTemplate: relativePathSchema,
    directoryMode: z.literal("0700"),
    fileMode: z.literal("0600"),
    immutablePublish: z
      .object({
        noClobber: z.literal(true),
        atomicRename: z.literal(true),
        readbackHash: z.literal(true),
        noFollow: z.literal(true),
      })
      .strict(),
    privateOnly: z.literal(true),
    createdAt: utcTimestampSchema,
    artifactLayoutConfigSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.pathTemplates,
      context,
      (entry) => entry.artifactClass,
      ["pathTemplates"],
    );
    const expected = dayflowAblationArtifactRegistry
      .filter((entry) => entry.storageMode === "standalone")
      .map((entry) => entry.artifactClass)
      .sort(compareStrings);
    const actual = value.pathTemplates.map((entry) => entry.artifactClass);
    if (actual.length !== expected.length || actual.some((item, i) => item !== expected[i])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathTemplates"],
        message: "path templates must be an exact standalone-registry bijection",
      });
    }
    addRegisteredHashIssue(
      "artifact-layout-config",
      value,
      context,
      "artifactLayoutConfigSha256",
    );
  });

const replicateCountByArmSchema = z
  .object({
    A0: boundedJsonUnsignedIntegerSchema(8),
    A1: boundedJsonUnsignedIntegerSchema(8),
    B: boundedJsonUnsignedIntegerSchema(8),
    C: boundedJsonUnsignedIntegerSchema(8),
  })
  .strict();

const armPolicySchema = z
  .object({
    enabledArms: z.array(dayflowArmIdSchema).max(4),
    replicateCountByArm: replicateCountByArmSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const order = new Map(ARM_ORDER.map((arm, index) => [arm, index]));
    if (
      !isStrictlySortedUnique(value.enabledArms, (arm) =>
        String(order.get(arm)).padStart(2, "0"),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enabledArms"],
        message: "enabled arms must be in canonical enum order and unique",
      });
    }
    for (const arm of ARM_ORDER) {
      const enabled = value.enabledArms.includes(arm);
      const count = value.replicateCountByArm[arm];
      if ((enabled && count === 0) || (!enabled && count !== 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["replicateCountByArm", arm],
          message: "replicate count must be positive iff the arm is enabled",
        });
      }
    }
    if (
      value.enabledArms.includes("A1") !== value.enabledArms.includes("B") ||
      value.replicateCountByArm.A1 !== value.replicateCountByArm.B
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replicateCountByArm"],
        message: "A1 and B must be enabled together with equal replicate counts",
      });
    }
  });

const ineligibleClaimsSchema = z
  .object({
    contractConformance: z.literal(false),
    quality: z.literal(false),
    baseline: z.literal(false),
    release: z.literal(false),
    hPilotGo: z.literal(false),
    hE2: z.literal(false),
  })
  .strict();

const studyProtocolBase = {
  studyProtocolSchemaVersion: z.literal(
    "dayflow-ablation-study-protocol-v0.3",
  ),
  studyProtocolId: evidenceIdSchema,
  lineageClass: z.literal("control"),
  armPolicy: armPolicySchema,
  createdAt: utcTimestampSchema,
  studyProtocolHash: sha256HexSchema,
} as const;
const syntheticStudyProtocolBase = {
  ...studyProtocolBase,
  targetDataOrigin: z.literal("synthetic"),
  targetStudyPhase: z.literal("contract_conformance"),
  fixtureOnly: z.literal(true),
  evidenceUse: z.literal("contract_conformance_only"),
  syntheticConsentPolicyId: z
    .string()
    .regex(/^synthetic-consent-[a-z0-9._-]+$/),
  syntheticRetentionPolicyId: z
    .string()
    .regex(/^synthetic-retention-[a-z0-9._-]+$/),
  fixtureGenerator: z
    .object({
      version: schemaVersionSchema,
      seed: safeTextSchema,
      configSha256: sha256HexSchema,
      syntheticOnly: z.literal(true),
    })
    .strict(),
} as const;

export const syntheticStudyProtocolCandidateSchema = z
  .object({
    ...syntheticStudyProtocolBase,
    claimEligibility: ineligibleClaimsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addRegisteredHashIssue(
      "study-protocol",
      value,
      context,
      "studyProtocolHash",
    );
  });

const frozenSyntheticEligibilitySchema = z
  .object({
    contractConformance: z.literal(true),
    quality: z.literal(false),
    baseline: z.literal(false),
    release: z.literal(false),
    hPilotGo: z.literal(false),
    hE2: z.literal(false),
  })
  .strict();

export const frozenSyntheticStudyProtocolSchema = z
  .object({
    ...syntheticStudyProtocolBase,
    experimentManifestRef: experimentManifestRefSchema,
    claimEligibility: frozenSyntheticEligibilitySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !canonicalEqual(value.armPolicy.enabledArms, ARM_ORDER) ||
      ARM_ORDER.some(
        (arm) => value.armPolicy.replicateCountByArm[arm] === 0,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["armPolicy"],
        message: "frozen synthetic protocol must enable all four arms",
      });
    }
    addRegisteredHashIssue(
      "study-protocol",
      value,
      context,
      "studyProtocolHash",
    );
  });

const privatePilotEligibilitySchema = z
  .object({
    contractConformance: z.literal(false),
    quality: z.literal(true),
    baseline: z.literal(false),
    release: z.literal(false),
    hPilotGo: z.literal(true),
    hE2: z.literal(false),
  })
  .strict();
const directionalEligibilitySchema = z
  .object({
    contractConformance: z.literal(false),
    quality: z.literal(true),
    baseline: z.literal(false),
    release: z.literal(false),
    hPilotGo: z.literal(false),
    hE2: z.literal(true),
  })
  .strict();
const liveStudyProtocolBase = {
  ...studyProtocolBase,
  targetDataOrigin: z.literal("live"),
  fixtureOnly: z.literal(false),
  evidenceUse: z.literal("evaluation"),
  experimentManifestRef: experimentManifestRefSchema,
  inclusionPolicyVersion: schemaVersionSchema,
  exclusionPolicyVersion: schemaVersionSchema,
  checkpointSpacingPolicyVersion: schemaVersionSchema,
  asOfPolicyVersion: schemaVersionSchema,
  missingOutputAnalysisPolicyVersion: schemaVersionSchema,
  reviewRubricVersion: schemaVersionSchema,
  blindPermutationVersion: schemaVersionSchema,
  metricFormulaVersion: schemaVersionSchema,
  captureScopeHash: sha256HexSchema,
  consentRef: z
    .object({
      lineageClass: z.literal("control"),
      consentRevision: schemaVersionSchema,
      consentRecordSha256: sha256HexSchema,
    })
    .strict(),
  retentionPolicyRef: z
    .object({
      lineageClass: z.literal("control"),
      policyId: evidenceIdSchema,
      policySha256: sha256HexSchema,
    })
    .strict(),
  capturePolicyRef: versionHashRefSchema,
  denylistPolicyRef: versionHashRefSchema,
  encryptionDeploymentRef: versionHashRefSchema,
  artifactGovernancePolicyRefs: z
    .array(
      z
        .object({
          artifactClass: safeTextSchema,
          policyId: evidenceIdSchema,
          policySha256: sha256HexSchema,
        })
        .strict(),
    )
    .min(1)
    .max(256),
  localOnly: z.literal(true),
  cloudImageUpload: z.literal(false),
} as const;

export const liveStudyProtocolSchema = z
  .union([
    z
      .object({
        ...liveStudyProtocolBase,
        targetStudyPhase: z.literal("private_pilot"),
        targetCheckpointCount: z.literal(PILOT_CHECKPOINT_TARGET),
        claimEligibility: privatePilotEligibilitySchema,
      })
      .strict(),
    z
      .object({
        ...liveStudyProtocolBase,
        targetStudyPhase: z.literal("directional_study"),
        targetCheckpointCount: z.literal(DIRECTIONAL_CHECKPOINT_TARGET),
        claimEligibility: directionalEligibilitySchema,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    addSortedIssue(
      value.artifactGovernancePolicyRefs,
      context,
      (entry) => `${entry.artifactClass}\u0000${entry.policyId}`,
      ["artifactGovernancePolicyRefs"],
    );
    if (
      !value.armPolicy.enabledArms.includes("A1") ||
      !value.armPolicy.enabledArms.includes("B")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["armPolicy"],
        message: "live comparison protocol must enable A1 and B",
      });
    }
    addRegisteredHashIssue(
      "study-protocol",
      value,
      context,
      "studyProtocolHash",
    );
  });

export const studyProtocolSchema = z.union([
  syntheticStudyProtocolCandidateSchema,
  frozenSyntheticStudyProtocolSchema,
  liveStudyProtocolSchema,
]);

export const executableStudyProtocolSchema = z.union([
  frozenSyntheticStudyProtocolSchema,
  liveStudyProtocolSchema,
]);

export const DFA002_CONTRACT_SOURCE_ENTRIES = [
  {
    relativePath:
      "suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json",
    role: "fixture",
  },
  {
    relativePath:
      "suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json",
    role: "config",
  },
  {
    relativePath: "suggestion/src/dayflowEvidence/contracts.ts",
    role: "source",
  },
  {
    relativePath:
      "suggestion/src/evaluation/dayflowAblation/buildDataset.ts",
    role: "source",
  },
  {
    relativePath:
      "suggestion/src/evaluation/dayflowAblation/contracts.ts",
    role: "source",
  },
  {
    relativePath:
      "suggestion/src/evaluation/dayflowAblation/runGeneration.ts",
    role: "source",
  },
  {
    relativePath: "suggestion/tests/dayflowAblationEvaluation.test.ts",
    role: "test",
  },
  {
    relativePath: "suggestion/tests/dayflowEvidenceContracts.test.ts",
    role: "test",
  },
  {
    relativePath: "suggestion/tests/dayflowEvidenceExtraction.test.ts",
    role: "test",
  },
  {
    relativePath: "suggestion/tsconfig.dayflow-dfa002.json",
    role: "config",
  },
  {
    relativePath: "suggestion/vitest.dayflow-dfa002.config.ts",
    role: "config",
  },
] as const;

DFA002_CONTRACT_SOURCE_ENTRIES.forEach((entry) => Object.freeze(entry));
Object.freeze(DFA002_CONTRACT_SOURCE_ENTRIES);

export const DFA002_COMMAND_DEFINING_INPUTS = [
  "dependency-cruiser.config.mjs",
  "dependency-cruiser.suggestion.config.mjs",
  "package-lock.json",
  "package.json",
  "suggestion/eslint.config.mjs",
  "suggestion/package-lock.json",
  "suggestion/package.json",
  "suggestion/tsconfig.dayflow-dfa002.json",
  "suggestion/tsconfig.json",
  "suggestion/vitest.dayflow-dfa002.config.ts",
] as const;

Object.freeze(DFA002_COMMAND_DEFINING_INPUTS);

export const DFA002_REQUIRED_COMMANDS = [
  {
    commandId: "dfa002-depcruise",
    cwd: "suggestion",
    toolPackage: "dependency-cruiser",
    toolVersion: "18.2.0",
    toolEntryRelativePath:
      "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
    argv: [
      "--config",
      "../dependency-cruiser.suggestion.config.mjs",
      "src/dayflowEvidence/contracts.ts",
      "src/evaluation/dayflowAblation/contracts.ts",
      "src/evaluation/dayflowAblation/buildDataset.ts",
      "src/evaluation/dayflowAblation/runGeneration.ts",
      "tests/dayflowEvidenceContracts.test.ts",
      "tests/dayflowEvidenceExtraction.test.ts",
      "tests/dayflowAblationEvaluation.test.ts",
    ],
  },
  {
    commandId: "dfa002-eslint",
    cwd: "suggestion",
    toolPackage: "eslint",
    toolVersion: "9.39.5",
    toolEntryRelativePath: "suggestion/node_modules/eslint/bin/eslint.js",
    argv: [
      "src/dayflowEvidence/contracts.ts",
      "src/evaluation/dayflowAblation/contracts.ts",
      "src/evaluation/dayflowAblation/buildDataset.ts",
      "src/evaluation/dayflowAblation/runGeneration.ts",
      "tests/dayflowEvidenceContracts.test.ts",
      "tests/dayflowEvidenceExtraction.test.ts",
      "tests/dayflowAblationEvaluation.test.ts",
      "vitest.dayflow-dfa002.config.ts",
    ],
  },
  {
    commandId: "dfa002-tsc",
    cwd: "suggestion",
    toolPackage: "typescript",
    toolVersion: "5.9.3",
    toolEntryRelativePath: "suggestion/node_modules/typescript/bin/tsc",
    argv: ["--noEmit", "--project", "tsconfig.dayflow-dfa002.json"],
  },
  {
    commandId: "dfa002-vitest",
    cwd: "suggestion",
    toolPackage: "vitest",
    toolVersion: "3.2.7",
    toolEntryRelativePath: "suggestion/node_modules/vitest/vitest.mjs",
    argv: [
      "run",
      "--config",
      "vitest.dayflow-dfa002.config.ts",
      "tests/dayflowEvidenceContracts.test.ts",
      "tests/dayflowEvidenceExtraction.test.ts",
      "tests/dayflowAblationEvaluation.test.ts",
    ],
  },
] as const;

DFA002_REQUIRED_COMMANDS.forEach((entry) => {
  Object.freeze(entry.argv);
  Object.freeze(entry);
});
Object.freeze(DFA002_REQUIRED_COMMANDS);

export const DAYFLOW_ABLATION_REGISTRY_HASH_DOMAIN =
  "blabase.dayflow-ablation.artifact-registry.v0.2";

export function dayflowAblationRegistrySha256(
  registry: readonly z.infer<typeof dayflowAblationRegistryEntrySchema>[] =
    dayflowAblationArtifactRegistry,
): string {
  return domainSeparatedSha256(
    DAYFLOW_ABLATION_REGISTRY_HASH_DOMAIN,
    registry,
  );
}

const trackedInputMediaTypeSchema = z.enum([
  "application/json; charset=utf-8",
  "text/plain; charset=utf-8",
]);

function expectedTrackedInputMediaType(
  relativePath: string,
): z.infer<typeof trackedInputMediaTypeSchema> {
  return relativePath.endsWith(".json")
    ? "application/json; charset=utf-8"
    : "text/plain; charset=utf-8";
}

export const sourceHashRecordSchema = z
  .object({
    relativePath: relativePathSchema,
    mediaType: trackedInputMediaTypeSchema,
    byteLength: canonicalDecimalStringSchema,
    rawSha256: sha256HexSchema,
    role: z.enum(["source", "config", "fixture", "test"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mediaType !== expectedTrackedInputMediaType(value.relativePath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaType"],
        message: "tracked input media type does not match its path",
      });
    }
  });

const commandInputHashSchema = z
  .object({
    relativePath: relativePathSchema,
    mediaType: trackedInputMediaTypeSchema,
    byteLength: canonicalDecimalStringSchema,
    rawSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mediaType !== expectedTrackedInputMediaType(value.relativePath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaType"],
        message: "command input media type does not match its path",
      });
    }
  });

const validationInputSetPayloadObjectSchema = z
  .object({
    trackedBaseRevision: nonEmptySafeTextSchema,
    candidateFiles: z.array(sourceHashRecordSchema).min(1).max(32),
    commandDefiningFiles: z.array(commandInputHashSchema).min(1).max(32),
    unexpectedTrackedPaths: z.tuple([]),
  })
  .strict();

function addValidationInputSetIssues(
  value: z.infer<typeof validationInputSetPayloadObjectSchema>,
  context: z.RefinementCtx,
): void {
    addSortedIssue(
      value.candidateFiles,
      context,
      (entry) => entry.relativePath,
      ["candidateFiles"],
    );
    addSortedIssue(
      value.commandDefiningFiles,
      context,
      (entry) => entry.relativePath,
      ["commandDefiningFiles"],
    );
    const candidateShapeValid =
      value.candidateFiles.length === DFA002_CONTRACT_SOURCE_ENTRIES.length &&
      value.candidateFiles.every((entry, index) => {
        const expected = DFA002_CONTRACT_SOURCE_ENTRIES[index];
        return (
          expected !== undefined &&
          entry.relativePath === expected.relativePath &&
          entry.role === expected.role &&
          BigInt(entry.byteLength) > 0n
        );
      });
    const commandInputShapeValid =
      value.commandDefiningFiles.length ===
        DFA002_COMMAND_DEFINING_INPUTS.length &&
      value.commandDefiningFiles.every(
        (entry, index) =>
          entry.relativePath === DFA002_COMMAND_DEFINING_INPUTS[index] &&
          BigInt(entry.byteLength) > 0n,
      );
    if (!candidateShapeValid || !commandInputShapeValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateFiles"],
        message: "validation inputs must exactly cover DFA-002 tracked inputs",
      });
    }
}

const validationInputSetPayloadSchema =
  validationInputSetPayloadObjectSchema.superRefine(
    addValidationInputSetIssues,
  );

export type Dfa002ValidationInputSetPayload = z.infer<
  typeof validationInputSetPayloadSchema
>;

export function dfa002ValidationInputSetSha256(
  value: Dfa002ValidationInputSetPayload,
): string {
  return domainSeparatedSha256(
    "blabase.dayflow-dfa.validation-input-set.v0.1",
    validationInputSetPayloadSchema.parse(value),
  );
}

export const dfa002ValidationInputSetSchema =
  validationInputSetPayloadObjectSchema
  .extend({ validationInputSetSha256: sha256HexSchema })
  .strict()
  .superRefine((value, context) => {
    const { validationInputSetSha256, ...payload } = value;
    addValidationInputSetIssues(payload, context);
    if (
      validationInputSetSha256 !== dfa002ValidationInputSetSha256(payload)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validationInputSetSha256"],
        message: "validation input-set hash mismatch",
      });
    }
  });

const experimentConfigurationIdentitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    configId: evidenceIdSchema,
    relativePath: relativePathSchema,
    configSha256: sha256HexSchema,
  })
  .strict();

const commonEvaluationInputIdentitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    inputId: evidenceIdSchema,
    relativePath: relativePathSchema,
    inputSha256: sha256HexSchema,
  })
  .strict();

const experimentCommandIdentitySchema = z
  .object({
    commandId: evidenceIdSchema,
    cwd: relativePathSchema,
    toolPackage: nonEmptySafeTextSchema,
    toolVersion: nonEmptySafeTextSchema,
    toolEntryRelativePath: relativePathSchema,
    argv: z.array(safeTextSchema).max(64),
  })
  .strict();

const experimentToolVersionsSchema = z
  .object({
    node: nonEmptySafeTextSchema,
    dependencyCruiser: nonEmptySafeTextSchema,
    eslint: nonEmptySafeTextSchema,
    typescript: nonEmptySafeTextSchema,
    vitest: nonEmptySafeTextSchema,
  })
  .strict();

export const experimentManifestSchema = z
  .object({
    experimentManifestSchemaVersion: z.literal(
      "dayflow-ablation-experiment-manifest-v0.2",
    ),
    experimentManifestId: evidenceIdSchema,
    lineageClass: z.literal("control"),
    scopeId: z.literal("DFA-002"),
    ownerPseudonym: z.literal("colin"),
    targetDataOrigin: dataOriginSchema,
    targetStudyPhase: studyPhaseSchema,
    sourceProvenance: sourceProvenanceSchema,
    validationInputSet: dfa002ValidationInputSetSchema,
    baseCodeProvenance: z
      .object({
        blabaseRevision: nonEmptySafeTextSchema,
        dayflowRevision: nonEmptySafeTextSchema,
        sourceProvenanceSha256: sha256HexSchema,
      })
      .strict(),
    configurationIdentity: experimentConfigurationIdentitySchema,
    toolVersions: experimentToolVersionsSchema,
    commandIdentities: z.array(experimentCommandIdentitySchema).length(4),
    commonEvaluationInputIdentity: commonEvaluationInputIdentitySchema,
    limitations: z.array(issueCodeSchema).max(32),
    createdAt: utcTimestampSchema,
    experimentManifestSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const validOriginPhase =
      (value.targetDataOrigin === "synthetic" &&
        value.targetStudyPhase === "contract_conformance") ||
      (value.targetDataOrigin === "live" &&
        (value.targetStudyPhase === "private_pilot" ||
          value.targetStudyPhase === "directional_study"));
    if (!validOriginPhase) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetStudyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addSortedIssue(value.limitations, context, (entry) => entry, [
      "limitations",
    ]);
    if (!canonicalEqual(value.commandIdentities, DFA002_REQUIRED_COMMANDS)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commandIdentities"],
        message: "experiment manifest must bind the exact command identities",
      });
    }
    const expectedToolVersions = {
      node: value.toolVersions.node,
      dependencyCruiser: DFA002_REQUIRED_COMMANDS[0].toolVersion,
      eslint: DFA002_REQUIRED_COMMANDS[1].toolVersion,
      typescript: DFA002_REQUIRED_COMMANDS[2].toolVersion,
      vitest: DFA002_REQUIRED_COMMANDS[3].toolVersion,
    };
    if (!canonicalEqual(value.toolVersions, expectedToolVersions)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolVersions"],
        message: "experiment manifest tool identities do not match commands",
      });
    }
    const blabaseRevisionPin = value.sourceProvenance.pins.find(
      (pin) =>
        pin.repositoryId === "blabase" &&
        pin.pinKind === "repository-revision",
    );
    const dayflowRevisionPin = value.sourceProvenance.pins.find(
      (pin) =>
        pin.repositoryId === "dayflow" &&
        pin.pinKind === "repository-revision",
    );
    if (
      value.baseCodeProvenance.sourceProvenanceSha256 !==
        value.sourceProvenance.sourceProvenanceSha256 ||
      value.validationInputSet.trackedBaseRevision !==
        value.baseCodeProvenance.blabaseRevision ||
      blabaseRevisionPin?.pinKind !== "repository-revision" ||
      blabaseRevisionPin.revision !==
        value.baseCodeProvenance.blabaseRevision ||
      dayflowRevisionPin?.pinKind !== "repository-revision" ||
      dayflowRevisionPin.revision !== value.baseCodeProvenance.dayflowRevision
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseCodeProvenance"],
        message: "experiment manifest code provenance is not self-consistent",
      });
    }
    const configSource = value.validationInputSet.candidateFiles.find(
      (entry) => entry.relativePath === value.configurationIdentity.relativePath,
    );
    if (
      configSource?.role !== "config" ||
      configSource.rawSha256 !== value.configurationIdentity.configSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["configurationIdentity"],
        message: "experiment configuration must resolve to a frozen config entry",
      });
    }
    if (value.targetDataOrigin === "synthetic") {
      const commonInput = value.validationInputSet.candidateFiles.find(
        (entry) =>
          entry.relativePath ===
          value.commonEvaluationInputIdentity.relativePath,
      );
      if (
        commonInput?.role !== "fixture" ||
        commonInput.rawSha256 !==
          value.commonEvaluationInputIdentity.inputSha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commonEvaluationInputIdentity"],
          message: "synthetic common input must resolve to the frozen fixture entry",
        });
      }
    }
    if (value.createdAt < value.sourceProvenance.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["createdAt"],
        message: "experiment manifest cannot predate its source provenance",
      });
    }
    addRegisteredHashIssue(
      "experiment-manifest",
      value,
      context,
      "experimentManifestSha256",
    );
  });

export type DayflowAblationExperimentManifest = z.infer<
  typeof experimentManifestSchema
>;

export function dayflowAblationExperimentManifestSha256(
  value: DayflowAblationExperimentManifest,
): string {
  return hashRegisteredArtifact("experiment-manifest", value);
}

export const runResultsSchema = z
  .object({
    runResultsSchemaVersion: z.literal("dayflow-ablation-run-results-v0.1"),
    runResultsId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    experimentManifestRef: experimentManifestRefSchema,
    studyProtocolRef: studyProtocolRefSchema,
    executionFreezeRef: executionFreezeRefSchema,
    terminalArmRunRefs: z.array(runRefSchema).min(1).max(32),
    completedAt: utcTimestampSchema,
    runResultsSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    if (value.studyProtocolRef.studyProtocolHash !== value.studyProtocolHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyProtocolRef", "studyProtocolHash"],
        message: "run results protocol reference must match evidence lineage",
      });
    }
    addSortedIssue(
      value.terminalArmRunRefs,
      context,
      (entry) =>
        `${String(ARM_ORDER.indexOf(entry.armId)).padStart(2, "0")}\u0000${String(entry.replicateIndex).padStart(2, "0")}\u0000${entry.runId}`,
      ["terminalArmRunRefs"],
    );
    addRegisteredHashIssue(
      "run-results",
      value,
      context,
      "runResultsSha256",
    );
  });

export type DayflowAblationRunResults = z.infer<typeof runResultsSchema>;

export function dayflowAblationRunResultsSha256(
  value: DayflowAblationRunResults,
): string {
  return hashRegisteredArtifact("run-results", value);
}

const generationParametersSchema = z
  .record(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
  .superRefine((value, context) => {
    const keys = Object.keys(value);
    if (!isStrictlySortedUnique(keys, (key) => key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "generation parameter keys must be canonical",
      });
    }
  });
const executionTupleSchema = z
  .object({
    provider: safeTextSchema,
    model: safeTextSchema,
    promptVersion: schemaVersionSchema,
    promptSha256: sha256HexSchema,
    templateVersion: schemaVersionSchema,
    configVersion: schemaVersionSchema,
    generationParameters: generationParametersSchema,
  })
  .strict();
export const evaluationExecutionFreezeSchema = z
  .object({
    evaluationExecutionFreezeSchemaVersion: z.literal(
      "dayflow-ablation-evaluation-execution-freeze-v0.3",
    ),
    evaluationExecutionFreezeId: evidenceIdSchema,
    lineageClass: z.literal("control"),
    revision: canonicalDecimalStringSchema,
    predecessorRef: executionFreezeRefSchema.optional(),
    targetDataOrigin: dataOriginSchema,
    targetStudyPhase: studyPhaseSchema,
    targetCheckpointCount: boundedJsonUnsignedIntegerSchema(1_000_000, 1),
    experimentManifestRef: experimentManifestRefSchema,
    studyProtocolRef: studyProtocolRefSchema,
    extractorTuple: executionTupleSchema,
    a1bCausalTuple: executionTupleSchema,
    cScreenOnlyTuple: executionTupleSchema,
    retryPolicy: versionHashRefSchema,
    concurrencyPolicy: versionHashRefSchema,
    resolverVersion: schemaVersionSchema,
    guardrailVersion: schemaVersionSchema,
    verifierVersions: z.array(schemaVersionSchema).min(1).max(16),
    replicatePolicy: z
      .object({
        armPolicyRef: z
          .object({
            studyProtocolHash: sha256HexSchema,
            jsonPointer: z.literal("/armPolicy"),
          })
          .strict(),
        enabledArms: z.array(dayflowArmIdSchema).max(4),
        replicateCountByArm: replicateCountByArmSchema,
      })
      .strict(),
    randomization: z
      .object({
        algorithmVersion: schemaVersionSchema,
        seed: safeTextSchema,
        seedDerivationVersion: schemaVersionSchema,
        requestOrderManifestSchemaVersion: z.literal(
          "dayflow-ablation-request-order-manifest-v0.1",
        ),
        bindingTime: z.literal("before-first-paired-request"),
      })
      .strict(),
    review: z
      .object({
        rubricVersion: schemaVersionSchema,
        permutationVersion: schemaVersionSchema,
        missingOutputPolicyVersion: schemaVersionSchema,
      })
      .strict(),
    createdAt: utcTimestampSchema,
    evaluationExecutionFreezeSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const pairValid =
      (value.targetDataOrigin === "synthetic" &&
        value.targetStudyPhase === "contract_conformance") ||
      (value.targetDataOrigin === "live" &&
        (value.targetStudyPhase === "private_pilot" ||
          value.targetStudyPhase === "directional_study"));
    if (!pairValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetStudyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    if (
      (value.targetStudyPhase === "private_pilot" &&
        value.targetCheckpointCount !== PILOT_CHECKPOINT_TARGET) ||
      (value.targetStudyPhase === "directional_study" &&
        value.targetCheckpointCount !== DIRECTIONAL_CHECKPOINT_TARGET)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetCheckpointCount"],
        message: "execution freeze target count does not match its live phase",
      });
    }
    const revision = BigInt(value.revision);
    if ((revision === 1n) !== (value.predecessorRef === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predecessorRef"],
        message: "predecessor is required iff revision is greater than 1",
      });
    }
    if (
      value.predecessorRef?.evaluationExecutionFreezeId ===
      value.evaluationExecutionFreezeId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predecessorRef"],
        message: "freeze cannot reference itself",
      });
    }
    if (
      value.replicatePolicy.armPolicyRef.studyProtocolHash !==
      value.studyProtocolRef.studyProtocolHash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replicatePolicy", "armPolicyRef"],
        message: "replicate policy must bind the same protocol",
      });
    }
    addRegisteredHashIssue(
      "evaluation-execution-freeze",
      value,
      context,
      "evaluationExecutionFreezeSha256",
    );
  });

const humanApprovalCommon = {
  approvalSchemaVersion: z.literal("dayflow-ablation-human-approval-v0.1"),
  approvalRecordId: evidenceIdSchema,
  lineageClass: z.literal("control"),
  approverPseudonym: evidenceIdSchema,
  approvedAt: utcTimestampSchema,
  scopeHash: sha256HexSchema,
  approvalRecordSha256: sha256HexSchema,
} as const;

const crossRepoApprovalSchema = z
  .object({
    ...humanApprovalCommon,
    approvalType: z.literal("H-CROSS-REPO"),
    decision: z.literal("approved"),
    repositoryRef: z
      .object({
        repositoryId: z.literal("dayflow"),
        canonicalPath: relativePathSchema,
        pinnedHeadSha256: sha256HexSchema,
      })
      .strict(),
    writeScope: z
      .object({
        branchName: safeTextSchema,
        allowedPaths: z.array(relativePathSchema).min(1).max(32),
      })
      .strict(),
  })
  .strict();
const threatModelApprovalSchema = z
  .object({
    ...humanApprovalCommon,
    approvalType: z.literal("H-THREAT-MODEL-DESIGN"),
    decision: z.literal("approved"),
    threatModelRef: versionHashRefSchema,
    encryptionPolicyRef: versionHashRefSchema,
    retentionPolicyRefs: z.array(versionHashRefSchema).min(1).max(32),
    localSameUserBoundaryRef: versionHashRefSchema,
  })
  .strict();
const liveCaptureApprovalSchema = z
  .object({
    ...humanApprovalCommon,
    approvalType: z.literal("H-LIVE-CAPTURE"),
    decision: z.literal("approved"),
    phase: z.enum(["private_pilot", "directional_study"]),
    studyProtocolRef: studyProtocolRefSchema,
    consentRevision: schemaVersionSchema,
    captureScopeHash: sha256HexSchema,
    capturePolicyRef: versionHashRefSchema,
    denylistPolicyRef: versionHashRefSchema,
    retentionPolicyRef: z
      .object({ policyId: evidenceIdSchema, sha256: sha256HexSchema })
      .strict(),
    encryptionDeploymentRef: versionHashRefSchema,
    artifactGovernancePolicyRefs: z
      .array(
        z
          .object({
            artifactClass: safeTextSchema,
            policyId: evidenceIdSchema,
            policySha256: sha256HexSchema,
          })
          .strict(),
      )
      .min(1)
      .max(256),
    localOnly: z.literal(true),
    cloudImageUpload: z.literal(false),
    validFrom: utcTimestampSchema,
    validUntil: utcTimestampSchema,
    revokedAt: utcTimestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.artifactGovernancePolicyRefs,
      context,
      (entry) => `${entry.artifactClass}\u0000${entry.policyId}`,
      ["artifactGovernancePolicyRefs"],
    );
    if (
      value.validFrom > value.validUntil ||
      value.approvedAt > value.validFrom ||
      (value.revokedAt !== undefined && value.revokedAt < value.approvedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validFrom"],
        message: "live approval validity chronology is invalid",
      });
    }
    addRegisteredHashIssue(
      "human-approval-record",
      value,
      context,
      "approvalRecordSha256",
    );
  });
const pilotGoApprovalSchema = z
  .object({
    ...humanApprovalCommon,
    approvalType: z.literal("H-PILOT-GO"),
    decision: z.literal("approved"),
    pilotFinalBindingRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-final-dataset-binding-v0.1",
        ),
        finalDatasetBindingId: evidenceIdSchema,
        finalDatasetBindingSha256: sha256HexSchema,
      })
      .strict(),
    pilotVerificationAttestationRef:
      pilotVerificationAttestationRefSchema,
    pilotDeletionEvidenceRefs: z
      .array(
        z
          .object({
            schemaVersion: z.literal(
              "dayflow-ablation-deletion-receipt-v0.1",
            ),
            deletionReceiptId: evidenceIdSchema,
            deletionReceiptSha256: sha256HexSchema,
          })
          .strict(),
      )
      .min(1)
      .max(256),
    directionalTarget: z
      .object({
        phase: z.literal("directional_study"),
        studyProtocolHash: sha256HexSchema,
      })
      .strict(),
    liveCaptureApprovalRef: z
      .object({
        schemaVersion: z.literal("dayflow-ablation-human-approval-v0.1"),
        approvalRecordId: evidenceIdSchema,
        approvalRecordSha256: sha256HexSchema,
      })
      .strict(),
    validFrom: utcTimestampSchema,
    validUntil: utcTimestampSchema,
    revokedAt: utcTimestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.pilotDeletionEvidenceRefs,
      context,
      (entry) => entry.deletionReceiptId,
      ["pilotDeletionEvidenceRefs"],
    );
    if (
      value.validFrom > value.validUntil ||
      value.approvedAt > value.validFrom ||
      (value.revokedAt !== undefined && value.revokedAt < value.approvedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validFrom"],
        message: "pilot-go validity chronology is invalid",
      });
    }
    addRegisteredHashIssue(
      "human-approval-record",
      value,
      context,
      "approvalRecordSha256",
    );
  });
const qualityEvidenceRefSchema = z.discriminatedUnion("artifactType", [
  z
    .object({
      artifactType: z.literal("aggregate"),
      schemaVersion: z.literal("dayflow-ablation-aggregate-v0.1"),
      artifactId: evidenceIdSchema,
      artifactSha256: sha256HexSchema,
    })
    .strict(),
  z
    .object({
      artifactType: z.literal("output-review"),
      schemaVersion: z.literal("dayflow-ablation-output-review-v0.2"),
      artifactId: evidenceIdSchema,
      artifactSha256: sha256HexSchema,
    })
    .strict(),
  z
    .object({
      artifactType: z.literal("pair-preference-review"),
      schemaVersion: z.literal(
        "dayflow-ablation-pair-preference-review-v0.2",
      ),
      artifactId: evidenceIdSchema,
      artifactSha256: sha256HexSchema,
    })
    .strict(),
]);
const e2ApprovalSchema = z
  .object({
    ...humanApprovalCommon,
    approvalType: z.literal("H-E2"),
    decisionTarget: z.literal("e2-candidate-discovery-design"),
    decision: z.enum(["design-E2", "do-not-proceed"]),
    targetStudyProtocolRef: studyProtocolRefSchema,
    targetFinalBindingRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-final-dataset-binding-v0.1",
        ),
        finalDatasetBindingId: evidenceIdSchema,
        finalDatasetBindingSha256: sha256HexSchema,
      })
      .strict(),
    qualityEvidenceRefs: z.array(qualityEvidenceRefSchema).min(1).max(256),
    decisionReasonCode: issueCodeSchema,
    decisionNote: reasonTextSchema.optional(),
  })
  .strict();
const registeredAffectedArtifactRefSchema = z
  .object({
    artifactType: z.enum(
      DAYFLOW_ABLATION_ARTIFACT_REGISTRY.map((row) => row[0]) as [
        DayflowAblationArtifactClass,
        ...DayflowAblationArtifactClass[],
      ],
    ),
    schemaVersion: schemaVersionSchema,
    artifactId: evidenceIdSchema,
    artifactSha256: sha256HexSchema,
  })
  .strict();
const exportFrameDeletionRefSchema = z
  .object({
    artifactType: z.literal("dayflow-export-frame"),
    schemaVersion: z.literal("dayflow-export-artifact-v0.1"),
    artifactId: evidenceIdSchema,
    artifactSha256: sha256HexSchema,
  })
  .strict();
const affectedArtifactRefSchema = z.union([
  registeredAffectedArtifactRefSchema,
  exportFrameDeletionRefSchema,
]);
const exceptionCommon = {
  ...humanApprovalCommon,
  approvalType: z.literal("H-EXCEPTION"),
  decision: z.literal("approved"),
  exceptionScope: z
    .object({
      phase: z.enum([
        "implementation",
        "private_pilot",
        "directional_study",
        "post_study_audit",
      ]),
      artifactTypes: z.array(safeTextSchema).min(1).max(256),
    })
    .strict(),
  reasonCode: issueCodeSchema,
  ownerPseudonym: evidenceIdSchema,
  expiresAt: utcTimestampSchema,
  compensatingControls: z.array(issueCodeSchema).min(1).max(32),
  affectedArtifactRefs: z.array(affectedArtifactRefSchema).min(1).max(256),
  requiredChecksPassInvariant: z.literal(true),
} as const;
const exceptionApprovalSchema = z
  .union([
  z
    .object({
      ...exceptionCommon,
      exceptionKind: z.literal("non-blocking-check"),
      checkRef: z
        .object({
          checkId: evidenceIdSchema,
          blockingClassification: z.literal("non-blocking"),
        })
        .strict(),
    })
    .strict(),
    z
      .object({
        ...exceptionCommon,
        exceptionKind: z.literal("longer-retention"),
        originalDeadline: utcTimestampSchema,
        extendedDeadline: utcTimestampSchema,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.exceptionKind === "longer-retention" &&
      (value.originalDeadline >= value.extendedDeadline ||
        value.extendedDeadline > value.expiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extendedDeadline"],
        message: "retention deadline ordering is invalid",
      });
    }
  });

export const humanApprovalSchema = z
  .union([
    crossRepoApprovalSchema,
    threatModelApprovalSchema,
    liveCaptureApprovalSchema,
    pilotGoApprovalSchema,
    e2ApprovalSchema,
    exceptionApprovalSchema,
  ])
  .superRefine((value, context) => {
    addRegisteredHashIssue(
      "human-approval-record",
      value,
      context,
      "approvalRecordSha256",
    );
  });

export const dayflowApprovalSchema = humanApprovalSchema;

export const DAYFLOW_APPROVAL_TYPES = [
  "H-CROSS-REPO",
  "H-THREAT-MODEL-DESIGN",
  "H-LIVE-CAPTURE",
  "H-PILOT-GO",
  "H-E2",
  "H-EXCEPTION",
] as const;

export const liveCollectionFreezeSchema = z
  .object({
    liveCollectionFreezeSchemaVersion: z.literal(
      "dayflow-ablation-live-collection-freeze-v0.3",
    ),
    liveCollectionFreezeId: evidenceIdSchema,
    lineageClass: z.literal("control"),
    supersedesLiveCollectionFreezeRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-live-collection-freeze-v0.3",
        ),
        liveCollectionFreezeId: evidenceIdSchema,
        liveCollectionFreezeSha256: sha256HexSchema,
      })
      .strict()
      .optional(),
    targetDataOrigin: z.literal("live"),
    targetStudyPhase: z.enum(["private_pilot", "directional_study"]),
    targetCheckpointCount: z.union([
      z.literal(PILOT_CHECKPOINT_TARGET),
      z.literal(DIRECTIONAL_CHECKPOINT_TARGET),
    ]),
    experimentManifestRef: experimentManifestRefSchema,
    executionFreezeRef: executionFreezeRefSchema,
    studyProtocolRef: studyProtocolRefSchema,
    inclusionPolicyVersion: schemaVersionSchema,
    exclusionPolicyVersion: schemaVersionSchema,
    checkpointSpacingPolicyVersion: schemaVersionSchema,
    asOfPolicyVersion: schemaVersionSchema,
    missingOutputAnalysisPolicyVersion: schemaVersionSchema,
    reviewRubricVersion: schemaVersionSchema,
    blindPermutationVersion: schemaVersionSchema,
    metricFormulaVersion: schemaVersionSchema,
    captureScopeHash: sha256HexSchema,
    consentRevision: schemaVersionSchema,
    capturePolicyRef: versionHashRefSchema,
    denylistPolicyRef: versionHashRefSchema,
    retentionPolicyRef: z
      .object({ policyId: evidenceIdSchema, sha256: sha256HexSchema })
      .strict(),
    encryptionDeploymentRef: versionHashRefSchema,
    artifactGovernancePolicyRefs: z
      .array(
        z
          .object({
            artifactClass: safeTextSchema,
            policyId: evidenceIdSchema,
            policySha256: sha256HexSchema,
          })
          .strict(),
      )
      .min(1)
      .max(256),
    localOnly: z.literal(true),
    cloudImageUpload: z.literal(false),
    approvalRefs: z
      .array(
        z
          .object({
            approvalType: z.enum([
              "H-LIVE-CAPTURE",
              "H-PILOT-GO",
            ]),
            approvalRecordId: evidenceIdSchema,
            approvalRecordSha256: sha256HexSchema,
          })
          .strict(),
      )
      .min(1)
      .max(2),
    status: z.enum(["approved", "closed"]),
    approvedAt: utcTimestampSchema.optional(),
    closedAt: utcTimestampSchema.optional(),
    closureReasonCode: issueCodeSchema.optional(),
    liveCollectionFreezeSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.artifactGovernancePolicyRefs,
      context,
      (entry) => `${entry.artifactClass}\u0000${entry.policyId}`,
      ["artifactGovernancePolicyRefs"],
    );
    addSortedIssue(
      value.approvalRefs,
      context,
      (entry) => `${entry.approvalType}\u0000${entry.approvalRecordId}`,
      ["approvalRefs"],
    );
    const expectedApprovalTypes =
      value.targetStudyPhase === "private_pilot"
        ? ["H-LIVE-CAPTURE"]
        : ["H-LIVE-CAPTURE", "H-PILOT-GO"];
    if (
      (value.targetStudyPhase === "private_pilot" &&
        value.targetCheckpointCount !== PILOT_CHECKPOINT_TARGET) ||
      (value.targetStudyPhase === "directional_study" &&
        value.targetCheckpointCount !== DIRECTIONAL_CHECKPOINT_TARGET)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetCheckpointCount"],
        message: "live freeze target count does not match its phase",
      });
    }
    if (
      (value.status === "approved" &&
        (!value.approvedAt ||
          value.closedAt ||
          value.closureReasonCode ||
          value.supersedesLiveCollectionFreezeRef !== undefined)) ||
      (value.status === "closed" &&
        (value.approvedAt ||
          !value.closedAt ||
          !value.closureReasonCode ||
          value.supersedesLiveCollectionFreezeRef === undefined))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "live freeze lifecycle fields do not match status",
      });
    }
    if (
      !canonicalEqual(
        value.approvalRefs.map((entry) => entry.approvalType),
        expectedApprovalTypes,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvalRefs"],
        message: "live freeze has the wrong phase-specific approval set",
      });
    }
    addRegisteredHashIssue(
      "live-collection-freeze",
      value,
      context,
      "liveCollectionFreezeSha256",
    );
  });

const liveCollectionFreezeHeadRefSchema = z
  .object({
    schemaVersion: z.literal(
      "dayflow-ablation-live-collection-freeze-v0.3",
    ),
    liveCollectionFreezeId: evidenceIdSchema,
    liveCollectionFreezeSha256: sha256HexSchema,
  })
  .strict();

const liveAuthorityApprovalRefSchema = z
  .object({
    approvalType: z.enum(["H-LIVE-CAPTURE", "H-PILOT-GO"]),
    approvalRecordId: evidenceIdSchema,
    approvalRecordSha256: sha256HexSchema,
  })
  .strict();

export type LiveAuthorityFreezeRef = z.infer<
  typeof liveCollectionFreezeHeadRefSchema
>;
export type LiveAuthorityApprovalRef = z.infer<
  typeof liveAuthorityApprovalRefSchema
>;
export type LiveAuthorityScope = Readonly<{
  studyProtocolHash: string;
  targetStudyPhase: "private_pilot" | "directional_study";
}>;
export type HistoricalLiveAuthorityScope = LiveAuthorityScope &
  Readonly<{ asOf: string }>;

/**
 * Trusted current-authority seam. DFA-007 must supply its implementation; this
 * candidate contract never treats caller-enumerated freeze or approval arrays
 * as current authority.
 */
export interface AuthoritativeLiveAuthorityResolver {
  getCurrentHeadRef(scope: LiveAuthorityScope): unknown;
  getHeadRefAsOf(scope: HistoricalLiveAuthorityScope): unknown;
  resolve(
    reference: LiveAuthorityFreezeRef | LiveAuthorityApprovalRef,
  ): unknown | undefined;
}

const liveConsentResolutionSchema = z
  .object({
    lineageClass: z.literal("control"),
    consentRevision: schemaVersionSchema,
    consentRecordSha256: sha256HexSchema,
  })
  .strict();

const liveRetentionPolicyPayloadSchema = z
  .object({
    policySchemaVersion: z.literal(
      "dayflow-ablation-live-retention-policy-v0.1",
    ),
    lineageClass: z.literal("control"),
    policyId: evidenceIdSchema,
    blabaseRawCopyMaxAgeMs: canonicalDecimalStringSchema.refine(
      (value) =>
        BigInt(value) > 0n && BigInt(value) <= BigInt(HARD_RAW_RETENTION_MAX_MS),
      "Blabase raw retention must be positive and at most 24 hours",
    ),
    dayflowCanonicalSourceMaxAgeMs: canonicalDecimalStringSchema.refine(
      (value) =>
        BigInt(value) > 0n && BigInt(value) <= BigInt(HARD_RAW_RETENTION_MAX_MS),
      "Dayflow canonical retention must be positive and at most 24 hours",
    ),
  })
  .strict();

export type LiveRetentionPolicyPayload = z.infer<
  typeof liveRetentionPolicyPayloadSchema
>;

export function liveRetentionPolicySha256(
  value: LiveRetentionPolicyPayload,
): string {
  return domainSeparatedSha256(
    "blabase.dayflow-ablation.live-retention-policy.v0.1",
    liveRetentionPolicyPayloadSchema.parse(value),
  );
}

export const liveRetentionPolicySchema = liveRetentionPolicyPayloadSchema
  .extend({ policySha256: sha256HexSchema })
  .strict()
  .superRefine((value, context) => {
    const { policySha256, ...payload } = value;
    if (policySha256 !== liveRetentionPolicySha256(payload)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policySha256"],
        message: "live retention policy hash mismatch",
      });
    }
  });

const liveRetentionResolutionSchema = liveRetentionPolicySchema;

export type ResolvedLiveExecutionAuthorityInput = Readonly<{
  experimentManifest: unknown;
  studyProtocol: unknown;
  executionFreeze: unknown;
  authorizationAsOf: unknown;
  captureWindowStart: unknown;
  authorityResolutionMode: "current" | "historical-as-of";
  authorityResolver: AuthoritativeLiveAuthorityResolver;
  pilotDatasetDag?: unknown;
  pilotVerificationAttestation?: unknown;
  pilotHistoricalAuthorityResolver?: AuthoritativeLiveAuthorityResolver;
  pilotDeletionReceipts: readonly unknown[];
  consentRef: unknown;
  retentionPolicyRef: unknown;
}>;

export const resolvedLiveAuthorityIssueCodeSchema = z.enum([
  "LIVE_AUTHORITY_APPROVAL_INVALID",
  "LIVE_AUTHORITY_CHRONOLOGY_INVALID",
  "LIVE_AUTHORITY_CURRENTNESS_INVALID",
  "LIVE_AUTHORITY_FREEZE_GRAPH_INVALID",
  "LIVE_AUTHORITY_REFERENCE_MISMATCH",
  "LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID",
  "LIVE_AUTHORITY_SCHEMA_INVALID",
  "LIVE_AUTHORITY_SCOPE_MISMATCH",
]);

export type ResolvedLiveAuthorityIssueCode = z.infer<
  typeof resolvedLiveAuthorityIssueCodeSchema
>;

export type ResolvedLiveAuthorityVerification =
  | Readonly<{
      valid: true;
      issueCodes: readonly [];
      authorityHeadRef: LiveAuthorityFreezeRef;
      retentionPolicy: z.infer<typeof liveRetentionPolicySchema>;
    }>
  | Readonly<{
      valid: false;
      issueCodes: readonly ResolvedLiveAuthorityIssueCode[];
    }>;

function liveFreezeScopeProjection(
  value: z.infer<typeof liveCollectionFreezeSchema>,
) {
  return {
    targetDataOrigin: value.targetDataOrigin,
    targetStudyPhase: value.targetStudyPhase,
    targetCheckpointCount: value.targetCheckpointCount,
    experimentManifestRef: value.experimentManifestRef,
    executionFreezeRef: value.executionFreezeRef,
    studyProtocolRef: value.studyProtocolRef,
    inclusionPolicyVersion: value.inclusionPolicyVersion,
    exclusionPolicyVersion: value.exclusionPolicyVersion,
    checkpointSpacingPolicyVersion: value.checkpointSpacingPolicyVersion,
    asOfPolicyVersion: value.asOfPolicyVersion,
    missingOutputAnalysisPolicyVersion:
      value.missingOutputAnalysisPolicyVersion,
    reviewRubricVersion: value.reviewRubricVersion,
    blindPermutationVersion: value.blindPermutationVersion,
    metricFormulaVersion: value.metricFormulaVersion,
    captureScopeHash: value.captureScopeHash,
    consentRevision: value.consentRevision,
    capturePolicyRef: value.capturePolicyRef,
    denylistPolicyRef: value.denylistPolicyRef,
    retentionPolicyRef: value.retentionPolicyRef,
    encryptionDeploymentRef: value.encryptionDeploymentRef,
    artifactGovernancePolicyRefs: value.artifactGovernancePolicyRefs,
    localOnly: value.localOnly,
    cloudImageUpload: value.cloudImageUpload,
    approvalRefs: value.approvalRefs,
  };
}

export function verifyResolvedLiveExecutionAuthority(
  input: ResolvedLiveExecutionAuthorityInput,
): ResolvedLiveAuthorityVerification {
  const allowedKeys = new Set([
    "experimentManifest",
    "studyProtocol",
    "executionFreeze",
    "authorizationAsOf",
    "captureWindowStart",
    "authorityResolutionMode",
    "authorityResolver",
    "pilotDatasetDag",
    "pilotVerificationAttestation",
    "pilotHistoricalAuthorityResolver",
    "pilotDeletionReceipts",
    "consentRef",
    "retentionPolicyRef",
  ]);
  if (
    input === null ||
    typeof input !== "object" ||
    Object.keys(input).some((key) => !allowedKeys.has(key)) ||
    input.authorityResolver === null ||
    typeof input.authorityResolver !== "object" ||
    typeof input.authorityResolver.getCurrentHeadRef !== "function" ||
    typeof input.authorityResolver.getHeadRefAsOf !== "function" ||
    typeof input.authorityResolver.resolve !== "function" ||
    !["current", "historical-as-of"].includes(
      input.authorityResolutionMode,
    ) ||
    !Array.isArray(input.pilotDeletionReceipts)
  ) {
    return { valid: false, issueCodes: ["LIVE_AUTHORITY_SCHEMA_INVALID"] };
  }
  const experimentManifest = experimentManifestSchema.safeParse(
    input.experimentManifest,
  );
  const protocol = liveStudyProtocolSchema.safeParse(input.studyProtocol);
  const executionFreeze = evaluationExecutionFreezeSchema.safeParse(
    input.executionFreeze,
  );
  const authorizationAsOf = utcTimestampSchema.safeParse(
    input.authorizationAsOf,
  );
  const captureWindowStart = utcTimestampSchema.safeParse(
    input.captureWindowStart,
  );
  const consent = liveConsentResolutionSchema.safeParse(input.consentRef);
  const retention = liveRetentionResolutionSchema.safeParse(
    input.retentionPolicyRef,
  );
  const pilotDeletionReceipts = parseResolvedArray(
    deletionReceiptSchema,
    input.pilotDeletionReceipts,
  );
  if (
    !experimentManifest.success ||
    !protocol.success ||
    !executionFreeze.success ||
    !authorizationAsOf.success ||
    !captureWindowStart.success ||
    !consent.success ||
    !retention.success ||
    pilotDeletionReceipts === undefined
  ) {
    return { valid: false, issueCodes: ["LIVE_AUTHORITY_SCHEMA_INVALID"] };
  }

  const issues = new Set<ResolvedLiveAuthorityIssueCode>();
  const experimentManifestValue = experimentManifest.data;
  const protocolValue = protocol.data;
  const executionFreezeValue = executionFreeze.data;
  let currentHeadRef: LiveAuthorityFreezeRef | undefined;
  try {
    const scope = {
      studyProtocolHash: protocolValue.studyProtocolHash,
      targetStudyPhase: protocolValue.targetStudyPhase,
    } as const;
    const parsedHead = liveCollectionFreezeHeadRefSchema.safeParse(
      input.authorityResolutionMode === "current"
        ? input.authorityResolver.getCurrentHeadRef(scope)
        : input.authorityResolver.getHeadRefAsOf({
            ...scope,
            asOf: authorizationAsOf.data,
          }),
    );
    currentHeadRef = parsedHead.success ? parsedHead.data : undefined;
  } catch {
    currentHeadRef = undefined;
  }
  const resolvedFreezes: z.infer<typeof liveCollectionFreezeSchema>[] = [];
  let graphInvalid = currentHeadRef === undefined;
  const visited = new Set<string>();
  let cursorRef = currentHeadRef;
  let child: z.infer<typeof liveCollectionFreezeSchema> | undefined;
  for (let depth = 0; cursorRef !== undefined && depth < 256; depth += 1) {
    if (visited.has(cursorRef.liveCollectionFreezeId)) {
      graphInvalid = true;
      break;
    }
    visited.add(cursorRef.liveCollectionFreezeId);
    let resolvedValue: unknown;
    try {
      resolvedValue = input.authorityResolver.resolve(cursorRef);
    } catch {
      graphInvalid = true;
      break;
    }
    const resolved = liveCollectionFreezeSchema.safeParse(resolvedValue);
    if (
      !resolved.success ||
      resolved.data.liveCollectionFreezeId !==
        cursorRef.liveCollectionFreezeId ||
      resolved.data.liveCollectionFreezeSha256 !==
        cursorRef.liveCollectionFreezeSha256
    ) {
      graphInvalid = true;
      break;
    }
    const cursor = resolved.data;
    resolvedFreezes.push(cursor);
    if (
      child !== undefined &&
      (child.status !== "closed" ||
        child.supersedesLiveCollectionFreezeRef === undefined ||
        child.supersedesLiveCollectionFreezeRef.liveCollectionFreezeId !==
          cursor.liveCollectionFreezeId ||
        child.supersedesLiveCollectionFreezeRef
          .liveCollectionFreezeSha256 !==
          cursor.liveCollectionFreezeSha256 ||
        !canonicalEqual(
          liveFreezeScopeProjection(child),
          liveFreezeScopeProjection(cursor),
        ) ||
        child.closedAt === undefined ||
        (cursor.approvedAt !== undefined &&
          child.closedAt <= cursor.approvedAt))
    ) {
      graphInvalid = true;
      break;
    }
    const predecessorRef = cursor.supersedesLiveCollectionFreezeRef;
    if (predecessorRef === undefined) break;
    child = cursor;
    cursorRef = predecessorRef;
    if (depth === 255) graphInvalid = true;
  }
  const head = resolvedFreezes[0];
  if (head?.status !== "approved") graphInvalid = true;
  if (graphInvalid) issues.add("LIVE_AUTHORITY_FREEZE_GRAPH_INVALID");
  if (head === undefined) {
    return { valid: false, issueCodes: sortedIssueCodes(issues) };
  }

  if (
    !canonicalEqual(
      head.experimentManifestRef,
      protocolValue.experimentManifestRef,
    ) ||
    !canonicalEqual(
      head.experimentManifestRef,
      executionFreezeValue.experimentManifestRef,
    ) ||
    !canonicalEqual(head.experimentManifestRef, {
      schemaVersion: experimentManifestValue.experimentManifestSchemaVersion,
      experimentManifestId: experimentManifestValue.experimentManifestId,
      experimentManifestSha256:
        experimentManifestValue.experimentManifestSha256,
    }) ||
    !executionFreezeRefMatches(head.executionFreezeRef, executionFreezeValue) ||
    head.studyProtocolRef.studyProtocolHash !==
      protocolValue.studyProtocolHash ||
    head.targetStudyPhase !== protocolValue.targetStudyPhase ||
    head.targetDataOrigin !== protocolValue.targetDataOrigin ||
    head.targetCheckpointCount !== protocolValue.targetCheckpointCount ||
    experimentManifestValue.targetDataOrigin !==
      protocolValue.targetDataOrigin ||
    experimentManifestValue.targetStudyPhase !==
      protocolValue.targetStudyPhase ||
    executionFreezeValue.targetCheckpointCount !==
      protocolValue.targetCheckpointCount
  ) {
    issues.add("LIVE_AUTHORITY_REFERENCE_MISMATCH");
  }
  if (
    !canonicalEqual(consent.data, protocolValue.consentRef) ||
    head.consentRevision !== consent.data.consentRevision ||
    retention.data.policyId !== protocolValue.retentionPolicyRef.policyId ||
    retention.data.policySha256 !==
      protocolValue.retentionPolicyRef.policySha256 ||
    head.retentionPolicyRef.policyId !== retention.data.policyId ||
    head.retentionPolicyRef.sha256 !== retention.data.policySha256
  ) {
    issues.add("LIVE_AUTHORITY_SCOPE_MISMATCH");
  }
  if (
    head.inclusionPolicyVersion !== protocolValue.inclusionPolicyVersion ||
    head.exclusionPolicyVersion !== protocolValue.exclusionPolicyVersion ||
    head.checkpointSpacingPolicyVersion !==
      protocolValue.checkpointSpacingPolicyVersion ||
    head.asOfPolicyVersion !== protocolValue.asOfPolicyVersion ||
    head.missingOutputAnalysisPolicyVersion !==
      protocolValue.missingOutputAnalysisPolicyVersion ||
    head.reviewRubricVersion !== protocolValue.reviewRubricVersion ||
    head.blindPermutationVersion !== protocolValue.blindPermutationVersion ||
    head.metricFormulaVersion !== protocolValue.metricFormulaVersion ||
    head.captureScopeHash !== protocolValue.captureScopeHash ||
    !canonicalEqual(head.capturePolicyRef, protocolValue.capturePolicyRef) ||
    !canonicalEqual(head.denylistPolicyRef, protocolValue.denylistPolicyRef) ||
    !canonicalEqual(
      head.encryptionDeploymentRef,
      protocolValue.encryptionDeploymentRef,
    ) ||
    !canonicalEqual(
      head.artifactGovernancePolicyRefs,
      protocolValue.artifactGovernancePolicyRefs,
    ) ||
    head.localOnly !== protocolValue.localOnly ||
    head.cloudImageUpload !== protocolValue.cloudImageUpload ||
    head.missingOutputAnalysisPolicyVersion !==
      executionFreezeValue.review.missingOutputPolicyVersion ||
    head.reviewRubricVersion !== executionFreezeValue.review.rubricVersion ||
    head.blindPermutationVersion !==
      executionFreezeValue.review.permutationVersion
  ) {
    issues.add("LIVE_AUTHORITY_SCOPE_MISMATCH");
  }

  const liveApprovals: z.infer<typeof liveCaptureApprovalSchema>[] = [];
  const pilotApprovals: z.infer<typeof pilotGoApprovalSchema>[] = [];
  let approvalResolutionInvalid = false;
  for (const reference of head.approvalRefs) {
    let resolvedValue: unknown;
    try {
      resolvedValue = input.authorityResolver.resolve(reference);
    } catch {
      approvalResolutionInvalid = true;
      continue;
    }
    if (reference.approvalType === "H-LIVE-CAPTURE") {
      const resolved = liveCaptureApprovalSchema.safeParse(resolvedValue);
      if (
        !resolved.success ||
        resolved.data.approvalRecordId !== reference.approvalRecordId ||
        resolved.data.approvalRecordSha256 !==
          reference.approvalRecordSha256
      ) {
        approvalResolutionInvalid = true;
      } else {
        liveApprovals.push(resolved.data);
      }
    } else {
      const resolved = pilotGoApprovalSchema.safeParse(resolvedValue);
      if (
        !resolved.success ||
        resolved.data.approvalRecordId !== reference.approvalRecordId ||
        resolved.data.approvalRecordSha256 !==
          reference.approvalRecordSha256
      ) {
        approvalResolutionInvalid = true;
      } else {
        pilotApprovals.push(resolved.data);
      }
    }
  }
  const approvalById = new Map(
    [...liveApprovals, ...pilotApprovals].map((entry) => [
      entry.approvalRecordId,
      entry,
    ]),
  );
  if (
    approvalResolutionInvalid ||
    approvalById.size !== liveApprovals.length + pilotApprovals.length ||
    head.approvalRefs.length !== approvalById.size ||
    head.approvalRefs.some((reference) => {
      const resolved = approvalById.get(reference.approvalRecordId);
      return (
        resolved === undefined ||
        resolved.approvalType !== reference.approvalType ||
        resolved.approvalRecordSha256 !== reference.approvalRecordSha256
      );
    })
  ) {
    issues.add("LIVE_AUTHORITY_APPROVAL_INVALID");
  }
  const liveApproval = liveApprovals[0];
  const liveApprovalRef = head.approvalRefs.find(
    (reference) => reference.approvalType === "H-LIVE-CAPTURE",
  );
  if (
    liveApprovals.length !== 1 ||
    liveApproval === undefined ||
    liveApprovalRef === undefined ||
    liveApproval.approvalRecordId !== liveApprovalRef.approvalRecordId ||
    liveApproval.approvalRecordSha256 !==
      liveApprovalRef.approvalRecordSha256 ||
    liveApproval.phase !== protocolValue.targetStudyPhase ||
    liveApproval.studyProtocolRef.studyProtocolHash !==
      protocolValue.studyProtocolHash ||
    liveApproval.scopeHash !== head.captureScopeHash ||
    liveApproval.consentRevision !== head.consentRevision ||
    liveApproval.captureScopeHash !== head.captureScopeHash ||
    !canonicalEqual(liveApproval.capturePolicyRef, head.capturePolicyRef) ||
    !canonicalEqual(liveApproval.denylistPolicyRef, head.denylistPolicyRef) ||
    !canonicalEqual(liveApproval.retentionPolicyRef, head.retentionPolicyRef) ||
    !canonicalEqual(
      liveApproval.encryptionDeploymentRef,
      head.encryptionDeploymentRef,
    ) ||
    !canonicalEqual(
      liveApproval.artifactGovernancePolicyRefs,
      head.artifactGovernancePolicyRefs,
    ) ||
    liveApproval.localOnly !== head.localOnly ||
    liveApproval.cloudImageUpload !== head.cloudImageUpload
  ) {
    issues.add("LIVE_AUTHORITY_SCOPE_MISMATCH");
  }
  const requiredPilotApprovals =
    protocolValue.targetStudyPhase === "directional_study" ? 1 : 0;
  const pilotApproval = pilotApprovals[0];
  if (
    pilotApprovals.length !== requiredPilotApprovals ||
    (pilotApproval !== undefined &&
      (pilotApproval.directionalTarget.studyProtocolHash !==
        protocolValue.studyProtocolHash ||
        pilotApproval.liveCaptureApprovalRef.approvalRecordId !==
          liveApproval?.approvalRecordId ||
        pilotApproval.liveCaptureApprovalRef.approvalRecordSha256 !==
          liveApproval?.approvalRecordSha256))
  ) {
    issues.add("LIVE_AUTHORITY_APPROVAL_INVALID");
  }
  if (protocolValue.targetStudyPhase === "private_pilot") {
    if (
      input.pilotDatasetDag !== undefined ||
      input.pilotVerificationAttestation !== undefined ||
      input.pilotHistoricalAuthorityResolver !== undefined ||
      pilotDeletionReceipts.length !== 0
    ) {
      issues.add("LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID");
    }
  } else if (
    pilotApproval === undefined ||
    !verifyPostPurgePilotEvidence({
      dag: input.pilotDatasetDag,
      attestation: input.pilotVerificationAttestation,
      historicalAuthorityResolver: input.pilotHistoricalAuthorityResolver,
      deletionReceipts: pilotDeletionReceipts,
      pilotApproval,
    })
  ) {
    issues.add("LIVE_AUTHORITY_PILOT_EVIDENCE_INVALID");
  }
  const approvalsAreCurrent = [...liveApprovals, ...pilotApprovals].every(
    (approval) =>
      approval.approvedAt <= captureWindowStart.data &&
      approval.validFrom <= captureWindowStart.data &&
      authorizationAsOf.data <= approval.validUntil &&
      (approval.revokedAt === undefined ||
        authorizationAsOf.data < approval.revokedAt),
  );
  if (
    !approvalsAreCurrent ||
    head.approvedAt === undefined ||
    head.approvedAt > captureWindowStart.data
  ) {
    issues.add("LIVE_AUTHORITY_CURRENTNESS_INVALID");
  }
  if (
    experimentManifestValue.createdAt > captureWindowStart.data ||
    protocolValue.createdAt > captureWindowStart.data ||
    executionFreezeValue.createdAt > captureWindowStart.data ||
    head.approvedAt === undefined ||
    head.approvedAt > captureWindowStart.data ||
    captureWindowStart.data > authorizationAsOf.data
  ) {
    issues.add("LIVE_AUTHORITY_CHRONOLOGY_INVALID");
  }
  if (issues.size > 0) {
    return { valid: false, issueCodes: sortedIssueCodes(issues) };
  }
  return {
    valid: true,
    issueCodes: [],
    authorityHeadRef: {
      schemaVersion: head.liveCollectionFreezeSchemaVersion,
      liveCollectionFreezeId: head.liveCollectionFreezeId,
      liveCollectionFreezeSha256: head.liveCollectionFreezeSha256,
    },
    retentionPolicy: retention.data,
  };
}

const expectedRunKeySchema = z
  .object({ armId: dayflowArmIdSchema, replicateIndex: replicateIndexSchema })
  .strict();

export const requestOrderManifestSchema = z
  .object({
    requestOrderManifestSchemaVersion: z.literal(
      "dayflow-ablation-request-order-manifest-v0.1",
    ),
    requestOrderManifestId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    algorithmVersion: schemaVersionSchema,
    seed: safeTextSchema,
    entries: z
      .array(
        z
          .object({
            position: canonicalDecimalStringSchema,
            checkpointId: evidenceIdSchema,
            checkpointSha256: sha256HexSchema,
            matchedPairId: evidenceIdSchema,
            replicateIndex: replicateIndexSchema,
            armId: z.enum(["A1", "B"]),
            requestId: evidenceIdSchema,
          })
          .strict(),
      )
      .max(256),
    createdAt: utcTimestampSchema,
    requestOrderManifestSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    const seenRequests = new Set<string>();
    const groups = new Map<string, { A1: number; B: number }>();
    value.entries.forEach((entry, index) => {
      if (entry.position !== String(index)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "position"],
          message: "request positions must be contiguous from 0",
        });
      }
      if (seenRequests.has(entry.requestId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "requestId"],
          message: "request IDs must be unique",
        });
      }
      seenRequests.add(entry.requestId);
      const groupKey = `${entry.checkpointId}\u0000${entry.checkpointSha256}\u0000${entry.matchedPairId}\u0000${entry.replicateIndex}`;
      const counts = groups.get(groupKey) ?? { A1: 0, B: 0 };
      counts[entry.armId] += 1;
      groups.set(groupKey, counts);
    });
    for (const counts of groups.values()) {
      if (counts.A1 !== 1 || counts.B !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries"],
          message: "each matched pair requires exactly one A1 and one B request",
        });
      }
    }
    addRegisteredHashIssue(
      "request-order-manifest",
      value,
      context,
      "requestOrderManifestSha256",
    );
  });

export const requestIssuanceReceiptSchema = z
  .object({
    requestIssuanceReceiptSchemaVersion: z.literal(
      "dayflow-ablation-request-issuance-receipt-v0.1",
    ),
    requestIssuanceReceiptId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    requestOrderManifestRef: requestOrderManifestRefSchema,
    requestId: evidenceIdSchema,
    position: canonicalDecimalStringSchema,
    issuanceSequence: canonicalDecimalStringSchema,
    armInputRef: armInputRefSchema,
    issuedAt: utcTimestampSchema,
    previousReceiptSha256: sha256HexSchema.optional(),
    requestIssuanceReceiptSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addRegisteredHashIssue(
      "request-issuance-receipt",
      value,
      context,
      "requestIssuanceReceiptSha256",
    );
  });

export const blindPermutationSchema = z
  .object({
    blindPermutationSchemaVersion: z.literal(
      "dayflow-ablation-blind-permutation-v0.1",
    ),
    permutationId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    comparisonGroupId: evidenceIdSchema,
    checkpointRef: checkpointRefSchema,
    matchedPairId: evidenceIdSchema,
    replicateIndex: replicateIndexSchema,
    permutationVersion: schemaVersionSchema,
    slots: z
      .array(
        z
          .object({
            opaqueSlot: z.enum(["left", "right"]),
            armId: z.enum(["A1", "B"]),
            runId: evidenceIdSchema,
          })
          .strict(),
      )
      .length(2),
    createdAt: utcTimestampSchema,
    permutationHash: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    if (
      new Set(value.slots.map((slot) => slot.opaqueSlot)).size !== 2 ||
      new Set(value.slots.map((slot) => slot.armId)).size !== 2 ||
      new Set(value.slots.map((slot) => slot.runId)).size !== 2
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: "permutation must be a two-way A1/B bijection",
      });
    }
    addRegisteredHashIssue(
      "blind-permutation",
      value,
      context,
      "permutationHash",
    );
  });

export const checkpointSchema = z
  .object({
    checkpointSchemaVersion: z.literal("dayflow-ablation-checkpoint-v0.2"),
    checkpointId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    captureWindowId: evidenceIdSchema,
    asOf: utcTimestampSchema,
    windowStart: utcTimestampSchema,
    windowEnd: utcTimestampSchema,
    studyProtocolHash: sha256HexSchema,
    studyProtocolRef: studyProtocolRefSchema,
    executionFreezeRef: executionFreezeRefSchema,
    priorCandidateDatasetGenerationRef: candidateGenerationRefSchema.optional(),
    expectedRunKeys: z.array(expectedRunKeySchema).max(32),
    blabaseCodeProvenance: sha256HexSchema,
    currentAttentionInputHash: sha256HexSchema,
    currentAttentionResultHash: sha256HexSchema,
    currentBoardHash: sha256HexSchema,
    structuredEvidenceHash: sha256HexSchema,
    dayflowExportHash: sha256HexSchema,
    dayflowNormalizedEvidenceHash: sha256HexSchema,
    workContextRegistryHash: sha256HexSchema,
    consentRevision: schemaVersionSchema,
    retentionPolicyId: evidenceIdSchema,
    inputSealStatus: z.literal("sealed"),
    checkpointSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    if (value.windowStart >= value.windowEnd || value.asOf < value.windowEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["windowEnd"],
        message: "checkpoint window must precede asOf",
      });
    }
    if (value.studyProtocolHash !== value.studyProtocolRef.studyProtocolHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyProtocolRef"],
        message: "checkpoint protocol ref mismatch",
      });
    }
    const order = new Map(ARM_ORDER.map((arm, index) => [arm, index]));
    if (
      !isStrictlySortedUnique(
        value.expectedRunKeys,
        (entry) =>
          `${String(order.get(entry.armId)).padStart(2, "0")}\u0000${String(entry.replicateIndex).padStart(2, "0")}`,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedRunKeys"],
        message: "expected run keys must be canonical and unique",
      });
    }
    addRegisteredHashIssue(
      "evaluation-checkpoint",
      value,
      context,
      "checkpointSha256",
    );
  });

const structuredCheckpointRefSchema = z
  .object({
    currentAttentionInputHash: sha256HexSchema,
    currentAttentionResultHash: sha256HexSchema,
    currentBoardHash: sha256HexSchema,
    structuredEvidenceHash: sha256HexSchema,
    workContextRegistryHash: sha256HexSchema,
  })
  .strict();
const armInputCommon = {
  armInputSchemaVersion: z.literal("dayflow-ablation-arm-input-v0.4"),
  armInputId: evidenceIdSchema,
  lineageClass: z.literal("evidence"),
  dataOrigin: dataOriginSchema,
  studyPhase: studyPhaseSchema,
  studyProtocolHash: sha256HexSchema,
  captureWindowId: evidenceIdSchema,
  executionFreezeRef: executionFreezeRefSchema,
  replicateIndex: replicateIndexSchema,
  presentationPolicyRef: versionHashRefSchema,
  armInputHash: sha256HexSchema,
} as const;

export const a0ArmInputSchema = z
  .object({
    ...armInputCommon,
    armId: z.literal("A0"),
    inputKind: z.literal("structured_baseline"),
    checkpointRef: checkpointRefSchema,
    sealedAttentionResultRef: z
      .object({ resultId: evidenceIdSchema, resultSha256: sha256HexSchema })
      .strict(),
    structuredCheckpointRef: structuredCheckpointRefSchema,
    screenEvidenceMode: z.literal("none"),
  })
  .strict();
export const a1ArmInputSchema = z
  .object({
    ...armInputCommon,
    armId: z.literal("A1"),
    inputKind: z.literal("structured_generation"),
    checkpointRef: checkpointRefSchema,
    structuredCheckpointRef: structuredCheckpointRefSchema,
    structuredCandidateHash: sha256HexSchema,
    screenEvidenceMode: z.literal("masked"),
    generationTupleSelector: z.literal("a1bCausalTuple"),
    matchedPairId: evidenceIdSchema,
    requestOrderManifestRef: requestOrderManifestRefSchema,
    requestId: evidenceIdSchema,
    requestPosition: canonicalDecimalStringSchema,
  })
  .strict();
export const bArmInputSchema = z
  .object({
    ...armInputCommon,
    armId: z.literal("B"),
    inputKind: z.literal("structured_plus_screen_generation"),
    checkpointRef: checkpointRefSchema,
    structuredCheckpointRef: structuredCheckpointRefSchema,
    structuredCandidateHash: sha256HexSchema,
    screenEvidenceMode: z.literal("normalized"),
    normalizedEvidenceRef: normalizedEvidenceRefSchema,
    generationTupleSelector: z.literal("a1bCausalTuple"),
    matchedPairId: evidenceIdSchema,
    requestOrderManifestRef: requestOrderManifestRefSchema,
    requestId: evidenceIdSchema,
    requestPosition: canonicalDecimalStringSchema,
  })
  .strict();
export const cArmInputSchema = z
  .object({
    ...armInputCommon,
    armId: z.literal("C"),
    inputKind: z.literal("screen_only_generation"),
    screenEvidenceMode: z.literal("normalized"),
    normalizedEvidenceRef: normalizedEvidenceRefSchema,
    generationTupleSelector: z.literal("cScreenOnlyTuple"),
  })
  .strict();

export const armInputSchema = z
  .discriminatedUnion("armId", [
    a0ArmInputSchema,
    a1ArmInputSchema,
    bArmInputSchema,
    cArmInputSchema,
  ])
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    const artifactClass =
      value.armId === "A0"
        ? "a0-arm-input"
        : value.armId === "A1"
          ? "a1-arm-input"
          : value.armId === "B"
            ? "b-arm-input"
            : "c-arm-input";
    addRegisteredHashIssue(artifactClass, value, context, "armInputHash");
  });

const attemptCommon = {
  attemptIndex: boundedJsonUnsignedIntegerSchema(8),
  startedAt: utcTimestampSchema,
  completedAt: utcTimestampSchema,
  requestSha256: sha256HexSchema,
  latencyMs: counterSchema,
  inputTokens: counterSchema,
  outputTokens: counterSchema,
  costMicrounits: counterSchema,
} as const;
const attemptSchema = z.union([
  z
    .object({
      ...attemptCommon,
      attemptKind: z.literal("deterministic_success"),
      responseSha256: sha256HexSchema,
      attemptOutputHash: sha256HexSchema,
    })
    .strict(),
  z
    .object({
      ...attemptCommon,
      attemptKind: z.literal("provider_success"),
      responseSha256: sha256HexSchema,
      attemptOutputHash: sha256HexSchema,
      providerGenerationId: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    })
    .strict(),
  z
    .object({
      ...attemptCommon,
      attemptKind: z.literal("deterministic_failure"),
      failureCode: issueCodeSchema,
    })
    .strict(),
  z
    .object({
      ...attemptCommon,
      attemptKind: z.literal("provider_failure"),
      failureCode: issueCodeSchema,
      failureStage: z.literal("before_provider_acknowledgement"),
    })
    .strict(),
  z
    .object({
      ...attemptCommon,
      attemptKind: z.literal("provider_failure"),
      failureCode: issueCodeSchema,
      failureStage: z.literal("after_provider_acknowledgement"),
      providerGenerationId: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
      responseSha256: sha256HexSchema,
    })
    .strict(),
]);
const runCommon = {
  runSchemaVersion: z.literal("dayflow-ablation-run-v0.4"),
  runId: evidenceIdSchema,
  lineageClass: z.literal("evidence"),
  dataOrigin: dataOriginSchema,
  studyPhase: studyPhaseSchema,
  studyProtocolHash: sha256HexSchema,
  armInputRef: armInputRefSchema,
  executionFreezeRef: executionFreezeRefSchema,
  replicateIndex: replicateIndexSchema,
  startedAt: utcTimestampSchema,
  completedAt: utcTimestampSchema,
  status: z.enum(["completed", "failed", "no_output"]),
  attempts: z.array(attemptSchema).min(1).max(8),
  semanticOutput: semanticOutputSchema.optional(),
  validationIssueCodes: z.array(issueCodeSchema).max(64),
  outputHash: sha256HexSchema.optional(),
  terminalFailureCode: issueCodeSchema.optional(),
  runSha256: sha256HexSchema,
} as const;

const a0RunSchema = z
  .object({
    ...runCommon,
    armId: z.literal("A0"),
    runKind: z.literal("sealed_baseline"),
    checkpointRef: checkpointRefSchema,
    sealedResultSha256: sha256HexSchema,
  })
  .strict();
const causalRunSchema = z
  .object({
    ...runCommon,
    armId: z.enum(["A1", "B"]),
    runKind: z.literal("causal_generation"),
    checkpointRef: checkpointRefSchema,
    matchedPairId: evidenceIdSchema,
    requestOrderManifestRef: requestOrderManifestRefSchema,
    requestId: evidenceIdSchema,
    requestPosition: canonicalDecimalStringSchema,
    requestIssuanceReceiptRef: requestIssuanceReceiptRefSchema,
    issuanceSequence: canonicalDecimalStringSchema,
  })
  .strict();
const cRunSchema = z
  .object({
    ...runCommon,
    armId: z.literal("C"),
    runKind: z.literal("screen_only_generation"),
  })
  .strict();

export const runSchema = z
  .union([a0RunSchema, causalRunSchema, cRunSchema])
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    if (value.startedAt > value.completedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "run completion must not precede its start",
      });
    }
    value.attempts.forEach((attempt, index) => {
      const previous = value.attempts[index - 1];
      if (
        attempt.attemptIndex !== index ||
        attempt.startedAt > attempt.completedAt ||
        attempt.startedAt < value.startedAt ||
        attempt.completedAt > value.completedAt ||
        (previous !== undefined && previous.completedAt > attempt.startedAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attempts", index],
          message: "attempts must be contiguous and temporally ordered",
        });
      }
    });
    const finalAttempt = value.attempts.at(-1);
    const success =
      finalAttempt?.attemptKind === "deterministic_success" ||
      finalAttempt?.attemptKind === "provider_success";
    const finalAttemptOutputHash =
      finalAttempt !== undefined && "attemptOutputHash" in finalAttempt
        ? finalAttempt.attemptOutputHash
        : undefined;
    const finalAttemptFailureCode =
      finalAttempt !== undefined && "failureCode" in finalAttempt
        ? finalAttempt.failureCode
        : undefined;
    const earlierAttemptsAreFailures = value.attempts
      .slice(0, -1)
      .every(
        (attempt) =>
          attempt.attemptKind === "deterministic_failure" ||
          attempt.attemptKind === "provider_failure",
      );
    const allAttemptsAreFailures = value.attempts.every(
      (attempt) =>
        attempt.attemptKind === "deterministic_failure" ||
        attempt.attemptKind === "provider_failure",
    );
    const hasSuggestions = value.semanticOutput?.status === "suggestions_available";
    const hasNoSuggestion = value.semanticOutput?.status === "no_suggestion";
    const semanticHash =
      value.semanticOutput === undefined
        ? undefined
        : semanticOutputSha256(value.semanticOutput);
    addSortedIssue(
      value.validationIssueCodes,
      context,
      (entry) => entry,
      ["validationIssueCodes"],
    );
    if (
      (value.status === "completed" &&
        (!success ||
          !earlierAttemptsAreFailures ||
          !hasSuggestions ||
          !value.outputHash ||
          value.outputHash !== semanticHash ||
          value.outputHash !== finalAttemptOutputHash ||
          value.terminalFailureCode)) ||
      (value.status === "no_output" &&
        (!success ||
          !earlierAttemptsAreFailures ||
          !hasNoSuggestion ||
          !value.outputHash ||
          value.outputHash !== semanticHash ||
          value.outputHash !== finalAttemptOutputHash ||
          value.terminalFailureCode !== "NO_ELIGIBLE_OUTPUT")) ||
      (value.status === "failed" &&
        (!allAttemptsAreFailures ||
          success ||
          value.semanticOutput ||
          value.outputHash ||
          !value.terminalFailureCode ||
          value.terminalFailureCode !== finalAttemptFailureCode))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "run terminal fields do not match final attempt",
      });
    }
    if (
      value.armId === "A0" &&
      (value.status !== "completed" ||
        value.attempts.length !== 1 ||
        value.attempts[0]?.attemptKind !== "deterministic_success" ||
        value.sealedResultSha256 !== finalAttemptOutputHash)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempts"],
        message: "A0 is one deterministic sealed success",
      });
    }
    addRegisteredHashIssue("arm-run", value, context, "runSha256");
  });

export const checkpointCompletionSchema = z
  .object({
    checkpointCompletionSchemaVersion: z.literal(
      "dayflow-ablation-checkpoint-completion-v0.1",
    ),
    checkpointCompletionId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    studyProtocolRef: studyProtocolRefSchema,
    checkpointRef: checkpointRefSchema,
    executionFreezeRef: executionFreezeRefSchema,
    expectedRunKeys: z.array(expectedRunKeySchema).max(32),
    completionStatus: z.enum(["completed", "failed"]),
    presentRunRefs: z.array(runRefSchema).max(32),
    missingExpectedRunKeys: z.array(expectedRunKeySchema).max(32),
    failedRunKeys: z.array(expectedRunKeySchema).max(32),
    noOutputRunKeys: z.array(expectedRunKeySchema).max(32),
    completedAt: utcTimestampSchema,
    checkpointCompletionSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const canonicalRunKey = (entry: {
      armId: (typeof ARM_ORDER)[number];
      replicateIndex: number;
    }) =>
      `${String(ARM_ORDER.indexOf(entry.armId)).padStart(2, "0")}\u0000${String(entry.replicateIndex).padStart(2, "0")}`;
    if (!isStrictlySortedUnique(value.expectedRunKeys, canonicalRunKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedRunKeys"],
        message: "expected run keys must be sorted and unique",
      });
    }
    for (const [path, entries] of [
      ["presentRunRefs", value.presentRunRefs],
      ["missingExpectedRunKeys", value.missingExpectedRunKeys],
      ["failedRunKeys", value.failedRunKeys],
      ["noOutputRunKeys", value.noOutputRunKeys],
    ] as const) {
      if (!isStrictlySortedUnique(entries, canonicalRunKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must be sorted and unique by run key`,
        });
      }
    }
    const expectedKeys = new Set(value.expectedRunKeys.map(canonicalRunKey));
    const presentKeys = new Set(value.presentRunRefs.map(canonicalRunKey));
    const missingKeys = new Set(
      value.missingExpectedRunKeys.map(canonicalRunKey),
    );
    const failedKeys = new Set(value.failedRunKeys.map(canonicalRunKey));
    const noOutputKeys = new Set(value.noOutputRunKeys.map(canonicalRunKey));
    if (
      presentKeys.size + missingKeys.size !== expectedKeys.size ||
      [...expectedKeys].some(
        (key) => presentKeys.has(key) === missingKeys.has(key),
      ) ||
      [...presentKeys].some((key) => !expectedKeys.has(key)) ||
      [...missingKeys].some((key) => !expectedKeys.has(key)) ||
      [...failedKeys].some(
        (key) => !presentKeys.has(key) || noOutputKeys.has(key),
      ) ||
      [...noOutputKeys].some((key) => !presentKeys.has(key)) ||
      (value.completionStatus === "completed" &&
        (missingKeys.size > 0 ||
          failedKeys.size > 0 ||
          noOutputKeys.size > 0)) ||
      (value.completionStatus === "failed" &&
        missingKeys.size + failedKeys.size + noOutputKeys.size === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completionStatus"],
        message:
          "completion must exactly partition expected keys into present, missing, failed, and no-output state",
      });
    }
    if (
      value.studyProtocolHash !== value.studyProtocolRef.studyProtocolHash ||
      !hasValidEvidenceOriginPhase(value)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyProtocolRef"],
        message: "completion lineage mismatch",
      });
    }
    addRegisteredHashIssue(
      "checkpoint-completion",
      value,
      context,
      "checkpointCompletionSha256",
    );
  });

export function validateMatchedA1BInputs(
  a1Input: unknown,
  bInput: unknown,
): boolean {
  const a1 = a1ArmInputSchema.safeParse(a1Input);
  const b = bArmInputSchema.safeParse(bInput);
  if (!a1.success || !b.success) return false;
  return (
    a1.data.dataOrigin === b.data.dataOrigin &&
    a1.data.studyPhase === b.data.studyPhase &&
    a1.data.studyProtocolHash === b.data.studyProtocolHash &&
    a1.data.captureWindowId === b.data.captureWindowId &&
    a1.data.checkpointRef.checkpointId === b.data.checkpointRef.checkpointId &&
    a1.data.checkpointRef.checkpointSha256 ===
      b.data.checkpointRef.checkpointSha256 &&
    a1.data.structuredCandidateHash === b.data.structuredCandidateHash &&
    a1.data.replicateIndex === b.data.replicateIndex &&
    a1.data.matchedPairId === b.data.matchedPairId &&
    a1.data.requestOrderManifestRef.requestOrderManifestId ===
      b.data.requestOrderManifestRef.requestOrderManifestId &&
    a1.data.requestOrderManifestRef.requestOrderManifestSha256 ===
      b.data.requestOrderManifestRef.requestOrderManifestSha256 &&
    a1.data.requestId !== b.data.requestId &&
    a1.data.requestPosition !== b.data.requestPosition &&
    JSON.stringify(a1.data.executionFreezeRef) ===
      JSON.stringify(b.data.executionFreezeRef) &&
    JSON.stringify(a1.data.presentationPolicyRef) ===
      JSON.stringify(b.data.presentationPolicyRef) &&
    JSON.stringify(a1.data.structuredCheckpointRef) ===
      JSON.stringify(b.data.structuredCheckpointRef)
  );
}

export function validateCheckpointCompletionBijection(
  checkpointValue: unknown,
  completionValue: unknown,
): boolean {
  const checkpoint = checkpointSchema.safeParse(checkpointValue);
  const completion = checkpointCompletionSchema.safeParse(completionValue);
  if (!checkpoint.success || !completion.success) return false;
  return (
    completion.data.checkpointRef.checkpointId === checkpoint.data.checkpointId &&
    completion.data.checkpointRef.checkpointSha256 ===
      checkpoint.data.checkpointSha256 &&
    completion.data.dataOrigin === checkpoint.data.dataOrigin &&
    completion.data.studyPhase === checkpoint.data.studyPhase &&
    completion.data.studyProtocolHash === checkpoint.data.studyProtocolHash &&
    JSON.stringify(completion.data.studyProtocolRef) ===
      JSON.stringify(checkpoint.data.studyProtocolRef) &&
    JSON.stringify(completion.data.executionFreezeRef) ===
      JSON.stringify(checkpoint.data.executionFreezeRef) &&
    JSON.stringify(completion.data.expectedRunKeys) ===
      JSON.stringify(checkpoint.data.expectedRunKeys)
  );
}

const generationRunEntrySchema = z
  .object({
    checkpointRef: checkpointRefSchema,
    checkpointCompletionRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-checkpoint-completion-v0.1",
        ),
        checkpointCompletionId: evidenceIdSchema,
        checkpointCompletionSha256: sha256HexSchema,
      })
      .strict(),
    runRefs: z.array(runRefSchema).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.runRefs,
      context,
      (run) =>
        `${run.armId}\u0000${String(run.replicateIndex).padStart(2, "0")}\u0000${run.runId}`,
      ["runRefs"],
    );
  });

export const candidateDatasetGenerationSchema = z
  .object({
    candidateDatasetGenerationSchemaVersion: z.literal(
      "dayflow-ablation-candidate-dataset-generation-v0.1",
    ),
    candidateDatasetGenerationId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    priorCandidateDatasetGenerationRef: candidateGenerationRefSchema.optional(),
    completedCheckpointRuns: z.array(generationRunEntrySchema).min(1).max(256),
    createdAt: utcTimestampSchema,
    candidateDatasetGenerationSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addSortedIssue(
      value.completedCheckpointRuns,
      context,
      (entry) => entry.checkpointRef.checkpointId,
      ["completedCheckpointRuns"],
    );
    if (
      value.priorCandidateDatasetGenerationRef
        ?.candidateDatasetGenerationId === value.candidateDatasetGenerationId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priorCandidateDatasetGenerationRef"],
        message: "generation cannot reference itself",
      });
    }
    addRegisteredHashIssue(
      "candidate-dataset-generation",
      value,
      context,
      "candidateDatasetGenerationSha256",
    );
  });

type ExecutableStudyProtocol = z.infer<typeof executableStudyProtocolSchema>;
type EvaluationExecutionFreeze = z.infer<
  typeof evaluationExecutionFreezeSchema
>;
type DayflowCheckpoint = z.infer<typeof checkpointSchema>;
type DayflowArmInput = z.infer<typeof armInputSchema>;
type RequestOrderManifest = z.infer<typeof requestOrderManifestSchema>;
type RequestIssuanceReceipt = z.infer<typeof requestIssuanceReceiptSchema>;
type DayflowRun = z.infer<typeof runSchema>;
type CheckpointCompletion = z.infer<typeof checkpointCompletionSchema>;
type CandidateDatasetGeneration = z.infer<
  typeof candidateDatasetGenerationSchema
>;
type DayflowNormalizedEvidence = z.infer<
  typeof dayflowNormalizedEvidenceSchema
>;
type DayflowScreenEvidenceExport = z.infer<
  typeof dayflowScreenEvidenceExportSchema
>;

const SYNTHETIC_EXPORT_PROVENANCE = Object.freeze({
  dayflowCommitSha: "a".repeat(40),
  packageResolvedSha256: "1".repeat(64),
  sourceFileHashes: Object.freeze([
    Object.freeze({
      relativePath: "synthetic-source.swift",
      sha256: "0".repeat(64),
    }),
  ]),
});

const LIVE_DAYFLOW_EXPORT_SOURCE_PATHS = Object.freeze([
  "Dayflow/Dayflow/Core/Recording/ScreenRecorder.swift",
  "Dayflow/Dayflow/Core/Recording/StorageManager+Screenshots.swift",
  "Dayflow/Dayflow/Core/Recording/StorageManager.swift",
]);

function exportProvenanceMatchesExperimentManifest(
  exportManifest: DayflowScreenEvidenceExport,
  protocol: ExecutableStudyProtocol,
  experimentManifest: DayflowAblationExperimentManifest,
): boolean {
  if (protocol.targetDataOrigin === "synthetic") {
    return (
      exportManifest.dayflowCommitSha ===
        SYNTHETIC_EXPORT_PROVENANCE.dayflowCommitSha &&
      exportManifest.packageResolvedSha256 ===
        SYNTHETIC_EXPORT_PROVENANCE.packageResolvedSha256 &&
      canonicalEqual(
        exportManifest.sourceFileHashes,
        SYNTHETIC_EXPORT_PROVENANCE.sourceFileHashes,
      )
    );
  }

  if (
    exportManifest.capturePolicyVersion !==
      protocol.capturePolicyRef.version ||
    exportManifest.artifacts.some(
      (artifact) =>
        artifact.pseudonymousDisplayAttestation.policySha256 !==
          protocol.capturePolicyRef.sha256 ||
        artifact.pseudonymousWindowAttestation.policySha256 !==
          protocol.capturePolicyRef.sha256,
    )
  ) {
    return false;
  }

  const packagePin = experimentManifest.sourceProvenance.pins.find(
    (pin) =>
      pin.repositoryId === "dayflow" &&
      pin.pinKind === "file-sha256" &&
      pin.relativePath ===
        "Dayflow/Dayflow.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  );
  const sourceFileHashes = LIVE_DAYFLOW_EXPORT_SOURCE_PATHS.map((relativePath) => {
    const pin = experimentManifest.sourceProvenance.pins.find(
      (candidate) =>
        candidate.repositoryId === "dayflow" &&
        candidate.pinKind === "file-sha256" &&
        candidate.relativePath === relativePath,
    );
    return pin?.pinKind === "file-sha256"
      ? { relativePath, sha256: pin.sha256 }
      : undefined;
  });
  return (
    exportManifest.dayflowCommitSha ===
      experimentManifest.baseCodeProvenance.dayflowRevision &&
    packagePin?.pinKind === "file-sha256" &&
    exportManifest.packageResolvedSha256 === packagePin.sha256 &&
    sourceFileHashes.every((entry) => entry !== undefined) &&
    canonicalEqual(exportManifest.sourceFileHashes, sourceFileHashes)
  );
}

export type ResolvedExecutionScreenEvidenceInput = Parameters<
  typeof verifyResolvedNormalizedEvidence
>[0];

export type ResolvedExecutionBundleInput = Readonly<{
  experimentManifest: unknown;
  studyProtocol: unknown;
  executionFreeze: unknown;
  executionFreezeAncestors?: readonly unknown[];
  checkpoint: unknown;
  priorGenerations?: readonly unknown[];
  armInputs: readonly unknown[];
  requestOrderManifests: readonly unknown[];
  requestIssuanceReceipts: readonly unknown[];
  runs: readonly unknown[];
  completion: unknown;
  screenEvidence: ResolvedExecutionScreenEvidenceInput;
  liveAuthority?: Readonly<{
    authorityResolver: AuthoritativeLiveAuthorityResolver;
    pilotDatasetDag?: unknown;
    pilotVerificationAttestation?: unknown;
    pilotHistoricalAuthorityResolver?: AuthoritativeLiveAuthorityResolver;
    pilotDeletionReceipts: readonly unknown[];
    consentRef: unknown;
    retentionPolicyRef: unknown;
  }>;
}>;

export const resolvedExecutionBundleIssueCodeSchema = z.enum([
  "EXECUTION_ANCESTRY_MISMATCH",
  "EXECUTION_ARM_INPUT_PARITY_MISMATCH",
  "EXECUTION_CHRONOLOGY_MISMATCH",
  "EXECUTION_COMPLETION_MISMATCH",
  "EXECUTION_CYCLE_DETECTED",
  "EXECUTION_EXPECTED_RUN_KEYS_MISMATCH",
  "EXECUTION_EXPERIMENT_MANIFEST_INVALID",
  "EXECUTION_LIVE_AUTHORITY_INVALID",
  "EXECUTION_ORIGIN_PHASE_PROTOCOL_MISMATCH",
  "EXECUTION_REFERENCE_MISMATCH",
  "EXECUTION_REQUEST_ORDER_MISMATCH",
  "EXECUTION_RESOLUTION_NOT_EXACT",
  "EXECUTION_RUN_STATUS_MISMATCH",
  "EXECUTION_SCREEN_EVIDENCE_INVALID",
  "EXECUTION_SCHEMA_INVALID",
]);

export type ResolvedExecutionBundleIssueCode = z.infer<
  typeof resolvedExecutionBundleIssueCodeSchema
>;

export type ResolvedExecutionBundle = Readonly<{
  experimentManifest: DayflowAblationExperimentManifest;
  studyProtocol: ExecutableStudyProtocol;
  executionFreeze: EvaluationExecutionFreeze;
  executionFreezeAncestors: readonly EvaluationExecutionFreeze[];
  checkpoint: DayflowCheckpoint;
  priorGenerations: readonly CandidateDatasetGeneration[];
  armInputs: readonly DayflowArmInput[];
  requestOrderManifests: readonly RequestOrderManifest[];
  requestIssuanceReceipts: readonly RequestIssuanceReceipt[];
  runs: readonly DayflowRun[];
  completion: CheckpointCompletion;
  screenEvidence: Readonly<{
    captureWindowId: string;
    normalizedEvidence: DayflowNormalizedEvidence;
    exportManifest: DayflowScreenEvidenceExport;
  }>;
  historicalLiveAuthority?: Readonly<{
    authorityHeadRef: LiveAuthorityFreezeRef;
    retentionPolicy: z.infer<typeof liveRetentionPolicySchema>;
  }>;
}>;

export type ResolvedExecutionBundleVerification =
  | Readonly<{
      valid: true;
      issueCodes: readonly [];
      bundle: ResolvedExecutionBundle;
    }>
  | Readonly<{
      valid: false;
      issueCodes: readonly ResolvedExecutionBundleIssueCode[];
    }>;

function parseResolvedArray<T>(
  schema: z.ZodType<T>,
  values: readonly unknown[] | undefined,
): T[] | undefined {
  if (values === undefined) return [];
  const parsed: T[] = [];
  for (const value of values) {
    const result = schema.safeParse(value);
    if (!result.success) return undefined;
    parsed.push(result.data);
  }
  return parsed;
}

function recomputeExpectedRunKeys(
  armPolicy: ExecutableStudyProtocol["armPolicy"],
): { armId: (typeof ARM_ORDER)[number]; replicateIndex: number }[] {
  return ARM_ORDER.flatMap((armId) =>
    Array.from(
      { length: armPolicy.replicateCountByArm[armId] },
      (_unused, replicateIndex) => ({ armId, replicateIndex }),
    ),
  );
}

function executionFreezeRefMatches(
  reference: z.infer<typeof executionFreezeRefSchema>,
  freeze: EvaluationExecutionFreeze,
): boolean {
  return (
    reference.evaluationExecutionFreezeId ===
      freeze.evaluationExecutionFreezeId &&
    reference.evaluationExecutionFreezeSha256 ===
      freeze.evaluationExecutionFreezeSha256
  );
}

function checkpointRefMatches(
  reference: z.infer<typeof checkpointRefSchema>,
  checkpoint: DayflowCheckpoint,
): boolean {
  return (
    reference.checkpointId === checkpoint.checkpointId &&
    reference.checkpointSha256 === checkpoint.checkpointSha256
  );
}

function generationRefMatches(
  reference: z.infer<typeof candidateGenerationRefSchema>,
  generation: CandidateDatasetGeneration,
): boolean {
  return (
    reference.candidateDatasetGenerationId ===
      generation.candidateDatasetGenerationId &&
    reference.candidateDatasetGenerationSha256 ===
      generation.candidateDatasetGenerationSha256
  );
}

function runRefMatches(
  reference: z.infer<typeof runRefSchema>,
  run: DayflowRun,
): boolean {
  return (
    reference.runId === run.runId &&
    reference.runSha256 === run.runSha256 &&
    reference.armId === run.armId &&
    reference.replicateIndex === run.replicateIndex
  );
}

type GenerationChainInspection = Readonly<{
  ancestryMismatch: boolean;
  cumulativeMismatch: boolean;
  cycleDetected: boolean;
  chronologyMismatch: boolean;
}>;

function inspectGenerationChain(
  generations: readonly CandidateDatasetGeneration[],
): GenerationChainInspection {
  let ancestryMismatch = false;
  let cumulativeMismatch = false;
  let cycleDetected = false;
  let chronologyMismatch = false;
  const byId = new Map<string, CandidateDatasetGeneration>();
  for (const generation of generations) {
    if (byId.has(generation.candidateDatasetGenerationId)) {
      cycleDetected = true;
    }
    byId.set(generation.candidateDatasetGenerationId, generation);
  }
  generations.forEach((generation, index) => {
    const previous = generations[index - 1];
    if (
      (previous === undefined &&
        generation.priorCandidateDatasetGenerationRef !== undefined) ||
      (previous !== undefined &&
        (generation.priorCandidateDatasetGenerationRef === undefined ||
          !generationRefMatches(
            generation.priorCandidateDatasetGenerationRef,
            previous,
          )))
    ) {
      ancestryMismatch = true;
    }
    if (previous === undefined) return;
    if (
      generation.dataOrigin !== previous.dataOrigin ||
      generation.studyPhase !== previous.studyPhase ||
      generation.studyProtocolHash !== previous.studyProtocolHash
    ) {
      ancestryMismatch = true;
    }
    if (generation.createdAt <= previous.createdAt) {
      chronologyMismatch = true;
    }
    const currentByCheckpoint = new Map(
      generation.completedCheckpointRuns.map((entry) => [
        entry.checkpointRef.checkpointId,
        entry,
      ]),
    );
    if (
      generation.completedCheckpointRuns.length <=
        previous.completedCheckpointRuns.length ||
      previous.completedCheckpointRuns.some((entry) => {
        const current = currentByCheckpoint.get(
          entry.checkpointRef.checkpointId,
        );
        return current === undefined || !canonicalEqual(current, entry);
      })
    ) {
      cumulativeMismatch = true;
    }
  });
  for (const start of generations) {
    const visited = new Set<string>();
    let current: CandidateDatasetGeneration | undefined = start;
    while (current !== undefined) {
      if (visited.has(current.candidateDatasetGenerationId)) {
        cycleDetected = true;
        break;
      }
      visited.add(current.candidateDatasetGenerationId);
      const reference = current.priorCandidateDatasetGenerationRef;
      if (reference === undefined) break;
      const resolved = byId.get(reference.candidateDatasetGenerationId);
      if (resolved === undefined || !generationRefMatches(reference, resolved)) {
        ancestryMismatch = true;
        break;
      }
      current = resolved;
    }
  }
  return {
    ancestryMismatch,
    cumulativeMismatch,
    cycleDetected,
    chronologyMismatch,
  };
}

function expectedRunKey(entry: {
  armId: (typeof ARM_ORDER)[number];
  replicateIndex: number;
}): string {
  return `${String(ARM_ORDER.indexOf(entry.armId)).padStart(2, "0")}\u0000${String(entry.replicateIndex).padStart(2, "0")}`;
}

function sortedIssueCodes<T extends string>(issues: Set<T>): T[] {
  return [...issues].sort(compareStrings);
}

export function verifyResolvedExecutionBundle(
  input: ResolvedExecutionBundleInput,
): ResolvedExecutionBundleVerification {
  const allowedInputKeys = new Set([
    "experimentManifest",
    "studyProtocol",
    "executionFreeze",
    "executionFreezeAncestors",
    "checkpoint",
    "priorGenerations",
    "armInputs",
    "requestOrderManifests",
    "requestIssuanceReceipts",
    "runs",
    "completion",
    "screenEvidence",
    "liveAuthority",
  ]);
  if (
    input === null ||
    typeof input !== "object" ||
    Object.keys(input).some((key) => !allowedInputKeys.has(key)) ||
    input.experimentManifest === null ||
    typeof input.experimentManifest !== "object" ||
    input.screenEvidence === null ||
    typeof input.screenEvidence !== "object" ||
    !Array.isArray(input.screenEvidence.resolvedExportManifests) ||
    !Array.isArray(input.screenEvidence.resolvedArtifacts) ||
    !Array.isArray(input.screenEvidence.artifactBlobs) ||
    !Array.isArray(input.screenEvidence.normalizedTexts) ||
    !Array.isArray(input.armInputs) ||
    !Array.isArray(input.requestOrderManifests) ||
    !Array.isArray(input.requestIssuanceReceipts) ||
    !Array.isArray(input.runs)
  ) {
    return { valid: false, issueCodes: ["EXECUTION_SCHEMA_INVALID"] };
  }
  const experimentManifest = experimentManifestSchema.safeParse(
    input.experimentManifest,
  );
  const protocol = executableStudyProtocolSchema.safeParse(
    input.studyProtocol,
  );
  const freeze = evaluationExecutionFreezeSchema.safeParse(
    input.executionFreeze,
  );
  const checkpoint = checkpointSchema.safeParse(input.checkpoint);
  const completion = checkpointCompletionSchema.safeParse(input.completion);
  const freezeAncestors = parseResolvedArray(
    evaluationExecutionFreezeSchema,
    input.executionFreezeAncestors,
  );
  const priorGenerations = parseResolvedArray(
    candidateDatasetGenerationSchema,
    input.priorGenerations,
  );
  const armInputs = parseResolvedArray(armInputSchema, input.armInputs);
  const requestOrderManifests = parseResolvedArray(
    requestOrderManifestSchema,
    input.requestOrderManifests,
  );
  const requestIssuanceReceipts = parseResolvedArray(
    requestIssuanceReceiptSchema,
    input.requestIssuanceReceipts,
  );
  const runs = parseResolvedArray(runSchema, input.runs);
  const normalizedEvidence = dayflowNormalizedEvidenceSchema.safeParse(
    input.screenEvidence.evidence,
  );
  const exportManifests = parseResolvedArray(
    dayflowScreenEvidenceExportSchema,
    input.screenEvidence.resolvedExportManifests,
  );
  if (
    !experimentManifest.success ||
    !protocol.success ||
    !freeze.success ||
    !checkpoint.success ||
    !completion.success ||
    freezeAncestors === undefined ||
    priorGenerations === undefined ||
    armInputs === undefined ||
    requestOrderManifests === undefined ||
    requestIssuanceReceipts === undefined ||
    runs === undefined ||
    !normalizedEvidence.success ||
    exportManifests === undefined
  ) {
    return { valid: false, issueCodes: ["EXECUTION_SCHEMA_INVALID"] };
  }

  const issues = new Set<ResolvedExecutionBundleIssueCode>();
  const experimentManifestValue = experimentManifest.data;
  const protocolValue = protocol.data;
  const freezeValue = freeze.data;
  const checkpointValue = checkpoint.data;
  const completionValue = completion.data;
  const expectedRunKeys = recomputeExpectedRunKeys(protocolValue.armPolicy);
  const normalizedEvidenceVerification = verifyResolvedNormalizedEvidence(
    input.screenEvidence,
  );
  const exportManifest = exportManifests[0];
  if (
    !normalizedEvidenceVerification.valid ||
    exportManifests.length !== 1 ||
    exportManifest === undefined
  ) {
    issues.add("EXECUTION_SCREEN_EVIDENCE_INVALID");
  }
  if (
    !canonicalEqual(protocolValue.experimentManifestRef, {
      schemaVersion: experimentManifestValue.experimentManifestSchemaVersion,
      experimentManifestId: experimentManifestValue.experimentManifestId,
      experimentManifestSha256:
        experimentManifestValue.experimentManifestSha256,
    }) ||
    !canonicalEqual(
      freezeValue.experimentManifestRef,
      protocolValue.experimentManifestRef,
    ) ||
    experimentManifestValue.targetDataOrigin !==
      protocolValue.targetDataOrigin ||
    experimentManifestValue.targetStudyPhase !==
      protocolValue.targetStudyPhase
  ) {
    issues.add("EXECUTION_EXPERIMENT_MANIFEST_INVALID");
  }
  if (
    experimentManifestValue.createdAt > protocolValue.createdAt
  ) {
    issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
  }
  if (
    exportManifest !== undefined &&
    exportManifest.exportedAt > checkpointValue.asOf
  ) {
    issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
  }
  if (normalizedEvidence.data.expiresAt < checkpointValue.asOf) {
    issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
  }
  let historicalLiveAuthority:
    | ResolvedExecutionBundle["historicalLiveAuthority"]
    | undefined;
  if (protocolValue.targetDataOrigin === "live") {
    if (input.liveAuthority === undefined) {
      issues.add("EXECUTION_LIVE_AUTHORITY_INVALID");
    } else {
      const liveAuthorityVerification = verifyResolvedLiveExecutionAuthority({
        ...input.liveAuthority,
        experimentManifest: experimentManifestValue,
        studyProtocol: protocolValue,
        executionFreeze: freezeValue,
        authorizationAsOf: checkpointValue.asOf,
        captureWindowStart: checkpointValue.windowStart,
        authorityResolutionMode: "historical-as-of",
      });
      if (!liveAuthorityVerification.valid) {
        issues.add("EXECUTION_LIVE_AUTHORITY_INVALID");
      } else {
        historicalLiveAuthority = {
          authorityHeadRef: liveAuthorityVerification.authorityHeadRef,
          retentionPolicy: liveAuthorityVerification.retentionPolicy,
        };
      }
    }
  } else if (input.liveAuthority !== undefined) {
    issues.add("EXECUTION_LIVE_AUTHORITY_INVALID");
  }

  const screenEvidenceRefs = armInputs.flatMap((armInput) =>
    armInput.armId === "B" || armInput.armId === "C"
      ? [armInput.normalizedEvidenceRef]
      : [],
  );
  const uniqueScreenEvidenceRefs = new Map(
    screenEvidenceRefs.map((reference) => [jcsCanonicalize(reference), reference]),
  );
  const sourceExportRef = normalizedEvidence.data.sourceExportRefs[0];
  const expectedConsentRevision =
    protocolValue.targetDataOrigin === "synthetic"
      ? protocolValue.syntheticConsentPolicyId
      : protocolValue.consentRef.consentRevision;
  const expectedRetentionPolicyId =
    protocolValue.targetDataOrigin === "synthetic"
      ? protocolValue.syntheticRetentionPolicyId
      : protocolValue.retentionPolicyRef.policyId;
  if (
    uniqueScreenEvidenceRefs.size !== 1 ||
    screenEvidenceRefs.length === 0 ||
    screenEvidenceRefs.some(
      (reference) =>
        reference.evidenceId !== normalizedEvidence.data.evidenceId ||
        reference.dayflowNormalizedEvidenceHash !==
          normalizedEvidence.data.dayflowNormalizedEvidenceHash,
    ) ||
    normalizedEvidence.data.dayflowNormalizedEvidenceHash !==
      checkpointValue.dayflowNormalizedEvidenceHash ||
    normalizedEvidence.data.captureWindow.start !== checkpointValue.windowStart ||
    normalizedEvidence.data.captureWindow.end !== checkpointValue.windowEnd ||
    normalizedEvidence.data.dataOrigin !== checkpointValue.dataOrigin ||
    normalizedEvidence.data.studyPhase !== checkpointValue.studyPhase ||
    normalizedEvidence.data.studyProtocolHash !==
      checkpointValue.studyProtocolHash ||
    exportManifest === undefined ||
    sourceExportRef === undefined ||
    sourceExportRef.exportId !== exportManifest.exportId ||
    sourceExportRef.detachedManifestSha256 !==
      exportManifest.detachedManifestSha256 ||
    exportManifest.detachedManifestSha256 !== checkpointValue.dayflowExportHash ||
    !exportProvenanceMatchesExperimentManifest(
      exportManifest,
      protocolValue,
      experimentManifestValue,
    ) ||
    exportManifest.consentRevision !== checkpointValue.consentRevision ||
    exportManifest.retentionPolicyId !== checkpointValue.retentionPolicyId ||
    checkpointValue.consentRevision !== expectedConsentRevision ||
    checkpointValue.retentionPolicyId !== expectedRetentionPolicyId
  ) {
    issues.add("EXECUTION_SCREEN_EVIDENCE_INVALID");
  }

  if (
    freezeValue.targetDataOrigin !== protocolValue.targetDataOrigin ||
    freezeValue.targetStudyPhase !== protocolValue.targetStudyPhase ||
    (protocolValue.targetDataOrigin === "live" &&
      freezeValue.targetCheckpointCount !==
        protocolValue.targetCheckpointCount) ||
    freezeValue.studyProtocolRef.studyProtocolHash !==
      protocolValue.studyProtocolHash ||
    !canonicalEqual(
      freezeValue.experimentManifestRef,
      protocolValue.experimentManifestRef,
    ) ||
    checkpointValue.dataOrigin !== protocolValue.targetDataOrigin ||
    checkpointValue.studyPhase !== protocolValue.targetStudyPhase ||
    checkpointValue.studyProtocolHash !== protocolValue.studyProtocolHash ||
    completionValue.dataOrigin !== protocolValue.targetDataOrigin ||
    completionValue.studyPhase !== protocolValue.targetStudyPhase ||
    completionValue.studyProtocolHash !== protocolValue.studyProtocolHash
  ) {
    issues.add("EXECUTION_ORIGIN_PHASE_PROTOCOL_MISMATCH");
  }
  if (
    !canonicalEqual(
      freezeValue.replicatePolicy.enabledArms,
      protocolValue.armPolicy.enabledArms,
    ) ||
    !canonicalEqual(
      freezeValue.replicatePolicy.replicateCountByArm,
      protocolValue.armPolicy.replicateCountByArm,
    ) ||
    freezeValue.replicatePolicy.armPolicyRef.studyProtocolHash !==
      protocolValue.studyProtocolHash ||
    !canonicalEqual(checkpointValue.expectedRunKeys, expectedRunKeys) ||
    !canonicalEqual(completionValue.expectedRunKeys, expectedRunKeys)
  ) {
    issues.add("EXECUTION_EXPECTED_RUN_KEYS_MISMATCH");
  }
  if (
    !executionFreezeRefMatches(
      checkpointValue.executionFreezeRef,
      freezeValue,
    ) ||
    !executionFreezeRefMatches(
      completionValue.executionFreezeRef,
      freezeValue,
    ) ||
    !checkpointRefMatches(completionValue.checkpointRef, checkpointValue) ||
    completionValue.studyProtocolRef.studyProtocolHash !==
      protocolValue.studyProtocolHash
  ) {
    issues.add("EXECUTION_REFERENCE_MISMATCH");
  }
  if (
    protocolValue.createdAt > freezeValue.createdAt ||
    freezeValue.createdAt > checkpointValue.windowStart
  ) {
    issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
  }

  const completeFreezeChain = [...freezeAncestors, freezeValue];
  if (
    completeFreezeChain[0] !== undefined &&
    protocolValue.createdAt > completeFreezeChain[0].createdAt
  ) {
    issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
  }
  const freezeIds = new Set<string>();
  for (const [index, current] of completeFreezeChain.entries()) {
    if (freezeIds.has(current.evaluationExecutionFreezeId)) {
      issues.add("EXECUTION_CYCLE_DETECTED");
    }
    freezeIds.add(current.evaluationExecutionFreezeId);
    const previous = completeFreezeChain[index - 1];
    if (
      BigInt(current.revision) !== BigInt(index + 1) ||
      (previous === undefined && current.predecessorRef !== undefined) ||
      (previous !== undefined &&
        (current.predecessorRef === undefined ||
          !executionFreezeRefMatches(current.predecessorRef, previous) ||
          current.targetDataOrigin !== previous.targetDataOrigin ||
          current.targetStudyPhase !== previous.targetStudyPhase ||
          current.studyProtocolRef.studyProtocolHash !==
            previous.studyProtocolRef.studyProtocolHash))
    ) {
      issues.add("EXECUTION_ANCESTRY_MISMATCH");
    }
    if (previous !== undefined && current.createdAt <= previous.createdAt) {
      issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
    }
  }

  const completeGenerationChain = [...priorGenerations];
  const generationInspection = inspectGenerationChain(completeGenerationChain);
  if (
    generationInspection.ancestryMismatch ||
    generationInspection.cumulativeMismatch
  ) {
    issues.add("EXECUTION_ANCESTRY_MISMATCH");
  }
  if (generationInspection.cycleDetected) {
    issues.add("EXECUTION_CYCLE_DETECTED");
  }
  if (generationInspection.chronologyMismatch) {
    issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
  }
  const directPriorGeneration = priorGenerations.at(-1);
  if (
    (directPriorGeneration === undefined &&
      checkpointValue.priorCandidateDatasetGenerationRef !== undefined) ||
    (directPriorGeneration !== undefined &&
      (checkpointValue.priorCandidateDatasetGenerationRef === undefined ||
        !generationRefMatches(
          checkpointValue.priorCandidateDatasetGenerationRef,
          directPriorGeneration,
        ) ||
        directPriorGeneration.createdAt >= checkpointValue.windowStart)) ||
    priorGenerations.some(
      (generation) =>
        generation.dataOrigin !== checkpointValue.dataOrigin ||
        generation.studyPhase !== checkpointValue.studyPhase ||
        generation.studyProtocolHash !== checkpointValue.studyProtocolHash ||
        generation.completedCheckpointRuns.some(
          (entry) =>
            entry.checkpointRef.checkpointId === checkpointValue.checkpointId,
        ),
    )
  ) {
    issues.add("EXECUTION_ANCESTRY_MISMATCH");
  }

  const expectedKeyStrings = expectedRunKeys.map(expectedRunKey);
  const presentKeyStrings = completionValue.presentRunRefs.map(expectedRunKey);
  const armInputKeys = armInputs.map(expectedRunKey);
  const runKeys = runs.map(expectedRunKey);
  if (
    !canonicalEqual(armInputKeys, expectedKeyStrings) ||
    !canonicalEqual(runKeys, presentKeyStrings) ||
    new Set(armInputs.map((armInput) => armInput.armInputId)).size !==
      armInputs.length ||
    new Set(runs.map((run) => run.runId)).size !== runs.length
  ) {
    issues.add("EXECUTION_RESOLUTION_NOT_EXACT");
  }
  const armInputByKey = new Map(
    armInputs.map((armInput) => [expectedRunKey(armInput), armInput]),
  );
  const runByKey = new Map(runs.map((run) => [expectedRunKey(run), run]));
  const checkpointStructuredRef = {
    currentAttentionInputHash: checkpointValue.currentAttentionInputHash,
    currentAttentionResultHash: checkpointValue.currentAttentionResultHash,
    currentBoardHash: checkpointValue.currentBoardHash,
    structuredEvidenceHash: checkpointValue.structuredEvidenceHash,
    workContextRegistryHash: checkpointValue.workContextRegistryHash,
  };
  for (const armInput of armInputs) {
    if (
      armInput.dataOrigin !== checkpointValue.dataOrigin ||
      armInput.studyPhase !== checkpointValue.studyPhase ||
      armInput.studyProtocolHash !== checkpointValue.studyProtocolHash ||
      armInput.captureWindowId !== checkpointValue.captureWindowId ||
      !executionFreezeRefMatches(armInput.executionFreezeRef, freezeValue)
    ) {
      issues.add("EXECUTION_ORIGIN_PHASE_PROTOCOL_MISMATCH");
    }
    if (armInput.armId === "C") {
      if (
        armInput.normalizedEvidenceRef.dayflowNormalizedEvidenceHash !==
        checkpointValue.dayflowNormalizedEvidenceHash
      ) {
        issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
      }
      continue;
    }
    if (
      !checkpointRefMatches(armInput.checkpointRef, checkpointValue) ||
      !canonicalEqual(armInput.structuredCheckpointRef, checkpointStructuredRef)
    ) {
      issues.add("EXECUTION_REFERENCE_MISMATCH");
    }
    if (
      armInput.armId === "A0" &&
      armInput.sealedAttentionResultRef.resultSha256 !==
        checkpointValue.currentAttentionResultHash
    ) {
      issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
    }
    if (
      armInput.armId === "B" &&
      armInput.normalizedEvidenceRef.dayflowNormalizedEvidenceHash !==
        checkpointValue.dayflowNormalizedEvidenceHash
    ) {
      issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
    }
  }
  for (const expectedKey of expectedRunKeys) {
    const key = expectedRunKey(expectedKey);
    const armInput = armInputByKey.get(key);
    const run = runByKey.get(key);
    if (armInput === undefined || run === undefined) continue;
    if (
      armInput.dataOrigin !== checkpointValue.dataOrigin ||
      armInput.studyPhase !== checkpointValue.studyPhase ||
      armInput.studyProtocolHash !== checkpointValue.studyProtocolHash ||
      armInput.captureWindowId !== checkpointValue.captureWindowId ||
      !executionFreezeRefMatches(armInput.executionFreezeRef, freezeValue) ||
      run.dataOrigin !== checkpointValue.dataOrigin ||
      run.studyPhase !== checkpointValue.studyPhase ||
      run.studyProtocolHash !== checkpointValue.studyProtocolHash ||
      !executionFreezeRefMatches(run.executionFreezeRef, freezeValue)
    ) {
      issues.add("EXECUTION_ORIGIN_PHASE_PROTOCOL_MISMATCH");
    }
    if (
      run.armInputRef.armInputId !== armInput.armInputId ||
      run.armInputRef.armInputHash !== armInput.armInputHash ||
      run.armId !== armInput.armId ||
      run.replicateIndex !== armInput.replicateIndex
    ) {
      issues.add("EXECUTION_REFERENCE_MISMATCH");
    }
    if (
      run.startedAt < checkpointValue.asOf ||
      run.startedAt > run.completedAt ||
      run.attempts[0]!.startedAt < run.startedAt ||
      run.attempts.at(-1)!.completedAt > run.completedAt
    ) {
      issues.add("EXECUTION_CHRONOLOGY_MISMATCH");
    }
    if (armInput.armId === "C") {
      if (
        armInput.normalizedEvidenceRef.dayflowNormalizedEvidenceHash !==
        checkpointValue.dayflowNormalizedEvidenceHash
      ) {
        issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
      }
    } else {
      if (
        !checkpointRefMatches(armInput.checkpointRef, checkpointValue) ||
        run.armId === "C" ||
        !checkpointRefMatches(run.checkpointRef, checkpointValue) ||
        !canonicalEqual(
          armInput.structuredCheckpointRef,
          checkpointStructuredRef,
        )
      ) {
        issues.add("EXECUTION_REFERENCE_MISMATCH");
      }
      if (
        armInput.armId === "A0" &&
        (armInput.sealedAttentionResultRef.resultSha256 !==
          checkpointValue.currentAttentionResultHash ||
          run.armId !== "A0" ||
          run.sealedResultSha256 !==
            checkpointValue.currentAttentionResultHash)
      ) {
        issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
      }
      if (
        armInput.armId === "B" &&
        armInput.normalizedEvidenceRef.dayflowNormalizedEvidenceHash !==
          checkpointValue.dayflowNormalizedEvidenceHash
      ) {
        issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
      }
      if (
        (armInput.armId === "A1" || armInput.armId === "B") &&
        ((run.armId !== "A1" && run.armId !== "B") ||
          run.matchedPairId !== armInput.matchedPairId ||
          run.requestId !== armInput.requestId ||
          run.requestPosition !== armInput.requestPosition ||
          !canonicalEqual(
            run.requestOrderManifestRef,
            armInput.requestOrderManifestRef,
          ))
      ) {
        issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
      }
    }
  }

  for (let replicateIndex = 0;
    replicateIndex < protocolValue.armPolicy.replicateCountByArm.A1;
    replicateIndex += 1) {
    const a1 = armInputByKey.get(expectedRunKey({ armId: "A1", replicateIndex }));
    const b = armInputByKey.get(expectedRunKey({ armId: "B", replicateIndex }));
    if (a1 === undefined || b === undefined || !validateMatchedA1BInputs(a1, b)) {
      issues.add("EXECUTION_ARM_INPUT_PARITY_MISMATCH");
    }
  }
  const matchedPairIds = armInputs.flatMap((armInput) =>
    armInput.armId === "A1" ? [armInput.matchedPairId] : [],
  );
  if (new Set(matchedPairIds).size !== matchedPairIds.length) {
    issues.add("EXECUTION_REQUEST_ORDER_MISMATCH");
  }
  const causalRequestIds = armInputs.flatMap((armInput) =>
    armInput.armId === "A1" || armInput.armId === "B"
      ? [armInput.requestId]
      : [],
  );
  if (new Set(causalRequestIds).size !== causalRequestIds.length) {
    issues.add("EXECUTION_REQUEST_ORDER_MISMATCH");
  }

  const manifestReferences = new Map<string, z.infer<typeof requestOrderManifestRefSchema>>();
  for (const armInput of armInputs) {
    if (armInput.armId === "A1" || armInput.armId === "B") {
      const existing = manifestReferences.get(
        armInput.requestOrderManifestRef.requestOrderManifestId,
      );
      if (
        existing !== undefined &&
        !canonicalEqual(existing, armInput.requestOrderManifestRef)
      ) {
        issues.add("EXECUTION_REQUEST_ORDER_MISMATCH");
      }
      manifestReferences.set(
        armInput.requestOrderManifestRef.requestOrderManifestId,
        armInput.requestOrderManifestRef,
      );
    }
  }
  const manifestIds = requestOrderManifests.map(
    (manifest) => manifest.requestOrderManifestId,
  );
  if (
    manifestReferences.size !== 1 ||
    requestOrderManifests.length !== 1 ||
    manifestReferences.size !== requestOrderManifests.length ||
    !isStrictlySortedUnique(manifestIds, (id) => id)
  ) {
    issues.add("EXECUTION_RESOLUTION_NOT_EXACT");
  }
  for (const manifest of requestOrderManifests) {
    const reference = manifestReferences.get(manifest.requestOrderManifestId);
    if (
      reference === undefined ||
      reference.requestOrderManifestSha256 !==
        manifest.requestOrderManifestSha256 ||
      manifest.dataOrigin !== checkpointValue.dataOrigin ||
      manifest.studyPhase !== checkpointValue.studyPhase ||
      manifest.studyProtocolHash !== checkpointValue.studyProtocolHash ||
      manifest.algorithmVersion !==
        freezeValue.randomization.algorithmVersion ||
      manifest.seed !== freezeValue.randomization.seed ||
      manifest.createdAt < checkpointValue.asOf ||
      manifest.entries.some(
        (entry) =>
          entry.checkpointId !== checkpointValue.checkpointId ||
          entry.checkpointSha256 !== checkpointValue.checkpointSha256,
      )
    ) {
      issues.add("EXECUTION_REQUEST_ORDER_MISMATCH");
      continue;
    }
    const referencedInputs = armInputs.filter(
      (armInput) =>
        (armInput.armId === "A1" || armInput.armId === "B") &&
        armInput.requestOrderManifestRef.requestOrderManifestId ===
          manifest.requestOrderManifestId,
    );
    const orderedInputs = referencedInputs
      .flatMap((armInput) =>
        armInput.armId === "A1" || armInput.armId === "B"
          ? [
              {
                armId: armInput.armId,
                matchedPairId: armInput.matchedPairId,
                replicateIndex: armInput.replicateIndex,
                requestId: armInput.requestId,
                requestPosition: armInput.requestPosition,
              },
            ]
          : [],
      )
      .sort((left, right) =>
        BigInt(left.requestPosition) < BigInt(right.requestPosition)
          ? -1
          : BigInt(left.requestPosition) > BigInt(right.requestPosition)
            ? 1
            : 0,
      );
    const inputsMatchManifestExactly =
      orderedInputs.length === manifest.entries.length &&
      orderedInputs.every((armInput, index) => {
        const entry = manifest.entries[index];
        return (
          entry !== undefined &&
          armInput.requestPosition === entry.position &&
          armInput.requestId === entry.requestId &&
          armInput.matchedPairId === entry.matchedPairId &&
          armInput.replicateIndex === entry.replicateIndex &&
          armInput.armId === entry.armId
        );
      });
    const referencedRuns = runs.flatMap((run) =>
      (run.armId === "A1" || run.armId === "B") &&
      run.requestOrderManifestRef.requestOrderManifestId ===
        manifest.requestOrderManifestId
        ? [
            {
              armId: run.armId,
              matchedPairId: run.matchedPairId,
              replicateIndex: run.replicateIndex,
              requestId: run.requestId,
              requestPosition: run.requestPosition,
              startedAt: run.startedAt,
            },
          ]
        : [],
    );
    const orderedRuns = [...referencedRuns].sort((left, right) =>
      BigInt(left.requestPosition) < BigInt(right.requestPosition)
        ? -1
        : BigInt(left.requestPosition) > BigInt(right.requestPosition)
          ? 1
          : 0,
    );
    const runStartOrderMatches = orderedRuns.every((run, index) => {
      const previous = orderedRuns[index - 1];
      return previous === undefined || previous.startedAt <= run.startedAt;
    });
    if (
      !inputsMatchManifestExactly ||
      !runStartOrderMatches ||
      referencedRuns.some((run) => {
        const entry = manifest.entries[Number(run.requestPosition)];
        return (
          manifest.createdAt > run.startedAt ||
          entry === undefined ||
          entry.position !== run.requestPosition ||
          entry.requestId !== run.requestId ||
          entry.matchedPairId !== run.matchedPairId ||
          entry.replicateIndex !== run.replicateIndex ||
          entry.armId !== run.armId
        );
      })
    ) {
      issues.add("EXECUTION_REQUEST_ORDER_MISMATCH");
    }
  }

  const soleManifest = requestOrderManifests[0];
  const causalArmInputs = armInputs.filter(
    (
      entry,
    ): entry is
      | z.infer<typeof a1ArmInputSchema>
      | z.infer<typeof bArmInputSchema> =>
      entry.armId === "A1" || entry.armId === "B",
  );
  const causalRuns = runs.filter(
    (entry): entry is z.infer<typeof causalRunSchema> =>
      entry.armId === "A1" || entry.armId === "B",
  );
  const receiptIds = requestIssuanceReceipts.map(
    (receipt) => receipt.requestIssuanceReceiptId,
  );
  if (
    soleManifest === undefined ||
    requestIssuanceReceipts.length !== soleManifest.entries.length ||
    new Set(receiptIds).size !== receiptIds.length
  ) {
    issues.add("EXECUTION_RESOLUTION_NOT_EXACT");
  } else {
    for (const [index, receipt] of requestIssuanceReceipts.entries()) {
      const position = String(index);
      const manifestEntry = soleManifest.entries[index];
      const previousReceipt = requestIssuanceReceipts[index - 1];
      const armInput = causalArmInputs.find(
        (entry) => entry.requestId === receipt.requestId,
      );
      const run = causalRuns.find(
        (entry) => entry.requestId === receipt.requestId,
      );
      if (
        manifestEntry === undefined ||
        receipt.position !== position ||
        receipt.issuanceSequence !== position ||
        receipt.dataOrigin !== checkpointValue.dataOrigin ||
        receipt.studyPhase !== checkpointValue.studyPhase ||
        receipt.studyProtocolHash !== checkpointValue.studyProtocolHash ||
        receipt.requestOrderManifestRef.requestOrderManifestId !==
          soleManifest.requestOrderManifestId ||
        receipt.requestOrderManifestRef.requestOrderManifestSha256 !==
          soleManifest.requestOrderManifestSha256 ||
        receipt.requestId !== manifestEntry.requestId ||
        (previousReceipt === undefined
          ? receipt.previousReceiptSha256 !== undefined ||
            receipt.issuedAt <= soleManifest.createdAt
          : receipt.previousReceiptSha256 !==
              previousReceipt.requestIssuanceReceiptSha256 ||
            receipt.issuedAt <= previousReceipt.issuedAt) ||
        armInput === undefined ||
        armInput.armId !== manifestEntry.armId ||
        armInput.replicateIndex !== manifestEntry.replicateIndex ||
        armInput.requestPosition !== position ||
        receipt.armInputRef.armInputId !== armInput.armInputId ||
        receipt.armInputRef.armInputHash !== armInput.armInputHash ||
        run === undefined ||
        run.requestPosition !== position ||
        run.issuanceSequence !== position ||
        run.requestIssuanceReceiptRef.requestIssuanceReceiptId !==
          receipt.requestIssuanceReceiptId ||
        run.requestIssuanceReceiptRef.requestIssuanceReceiptSha256 !==
          receipt.requestIssuanceReceiptSha256 ||
        run.startedAt < receipt.issuedAt
      ) {
        issues.add("EXECUTION_REQUEST_ORDER_MISMATCH");
      }
    }
  }

  const completionRunRefs = completionValue.presentRunRefs;
  if (
    completionRunRefs.length !== runs.length ||
    completionRunRefs.some((reference, index) => {
      const run = runs[index];
      return run === undefined || !runRefMatches(reference, run);
    })
  ) {
    issues.add("EXECUTION_COMPLETION_MISMATCH");
  }
  const resolvedRunKeys = new Set(runs.map(expectedRunKey));
  const derivedMissingKeys = expectedRunKeys.filter(
    (key) => !resolvedRunKeys.has(expectedRunKey(key)),
  );
  const derivedFailedKeys = runs
    .filter((run) => run.status === "failed")
    .map(({ armId, replicateIndex }) => ({ armId, replicateIndex }));
  const derivedNoOutputKeys = runs
    .filter((run) => run.status === "no_output")
    .map(({ armId, replicateIndex }) => ({ armId, replicateIndex }));
  const completionShouldSucceed =
    derivedMissingKeys.length === 0 &&
    derivedFailedKeys.length === 0 &&
    derivedNoOutputKeys.length === 0 &&
    runs.every((run) => run.status === "completed");
  if (
    !canonicalEqual(
      completionValue.missingExpectedRunKeys,
      derivedMissingKeys,
    ) ||
    !canonicalEqual(completionValue.failedRunKeys, derivedFailedKeys) ||
    !canonicalEqual(completionValue.noOutputRunKeys, derivedNoOutputKeys) ||
    (completionValue.completionStatus === "completed") !==
      completionShouldSucceed ||
    completionValue.completedAt < checkpointValue.asOf ||
    runs.some((run) => completionValue.completedAt < run.completedAt)
  ) {
    issues.add("EXECUTION_COMPLETION_MISMATCH");
  }
  if (
    (completionValue.completionStatus === "completed" &&
      !completionShouldSucceed) ||
    (completionValue.completionStatus === "failed" &&
      completionShouldSucceed)
  ) {
    issues.add("EXECUTION_RUN_STATUS_MISMATCH");
  }

  if (issues.size > 0) {
    return { valid: false, issueCodes: sortedIssueCodes(issues) };
  }
  return {
    valid: true,
    issueCodes: [],
    bundle: {
      experimentManifest: experimentManifestValue,
      studyProtocol: protocolValue,
      executionFreeze: freezeValue,
      executionFreezeAncestors: freezeAncestors,
      checkpoint: checkpointValue,
      priorGenerations,
      armInputs,
      requestOrderManifests,
      requestIssuanceReceipts,
      runs,
      completion: completionValue,
      screenEvidence: {
        captureWindowId: checkpointValue.captureWindowId,
        normalizedEvidence: normalizedEvidence.data,
        exportManifest: exportManifest!,
      },
      ...(historicalLiveAuthority === undefined
        ? {}
        : { historicalLiveAuthority }),
    },
  };
}

export function validateResolvedDayflowExecutionBundle(
  input: ResolvedExecutionBundleInput,
): boolean {
  return verifyResolvedExecutionBundle(input).valid;
}

export const exclusionDecisionSchema = z
  .object({
    exclusionDecisionSchemaVersion: z.literal(
      "dayflow-ablation-exclusion-decision-v0.1",
    ),
    exclusionDecisionId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    sourceGenerationRef: candidateGenerationRefSchema,
    checkpointRef: checkpointRefSchema,
    disposition: z.enum(["include", "exclude"]),
    reasonCode: issueCodeSchema,
    reasonDetail: reasonTextSchema.optional(),
    reviewerPseudonym: evidenceIdSchema,
    decidedAt: utcTimestampSchema,
    exclusionDecisionSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addRegisteredHashIssue(
      "exclusion-decision",
      value,
      context,
      "exclusionDecisionSha256",
    );
  });

const exclusionDecisionRefSchema = z
  .object({
    checkpointId: evidenceIdSchema,
    schemaVersion: z.literal("dayflow-ablation-exclusion-decision-v0.1"),
    exclusionDecisionId: evidenceIdSchema,
    exclusionDecisionSha256: sha256HexSchema,
  })
  .strict();

export const exclusionClosureSchema = z
  .object({
    exclusionClosureSchemaVersion: z.literal(
      "dayflow-ablation-exclusion-closure-v0.1",
    ),
    exclusionClosureId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    sourceGenerationRef: candidateGenerationRefSchema,
    decisionRefs: z.array(exclusionDecisionRefSchema).min(1).max(256),
    closedAt: utcTimestampSchema,
    exclusionClosureSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addSortedIssue(
      value.decisionRefs,
      context,
      (entry) => entry.checkpointId,
      ["decisionRefs"],
    );
    addRegisteredHashIssue(
      "exclusion-closure",
      value,
      context,
      "exclusionClosureSha256",
    );
  });

const manifestRunRefSchema = z.union([
  z
    .object({
      schemaVersion: z.literal("dayflow-ablation-run-v0.4"),
      runId: evidenceIdSchema,
      runSha256: sha256HexSchema,
      armId: z.enum(["A0", "C"]),
      replicateIndex: replicateIndexSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("dayflow-ablation-run-v0.4"),
      runId: evidenceIdSchema,
      runSha256: sha256HexSchema,
      armId: z.enum(["A1", "B"]),
      replicateIndex: replicateIndexSchema,
      matchedPairId: evidenceIdSchema,
    })
    .strict(),
]);
const includedCheckpointRunsSchema = z
  .object({
    checkpointRef: checkpointRefSchema,
    runRefs: z.array(manifestRunRefSchema).min(1).max(32),
  })
  .strict();

export const finalDatasetManifestSchema = z
  .object({
    finalDatasetManifestSchemaVersion: z.literal(
      "dayflow-ablation-final-dataset-manifest-v0.1",
    ),
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    exclusionClosureRef: z
      .object({
        schemaVersion: z.literal("dayflow-ablation-exclusion-closure-v0.1"),
        exclusionClosureId: evidenceIdSchema,
        exclusionClosureSha256: sha256HexSchema,
      })
      .strict(),
    datasetVersion: schemaVersionSchema,
    includedCheckpointRuns: z
      .array(includedCheckpointRunsSchema)
      .min(1)
      .max(256),
    datasetSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addSortedIssue(
      value.includedCheckpointRuns,
      context,
      (entry) => entry.checkpointRef.checkpointId,
      ["includedCheckpointRuns"],
    );
    for (const [entryIndex, entry] of value.includedCheckpointRuns.entries()) {
      const pairs = new Map<string, { A1: number; B: number }>();
      for (const run of entry.runRefs) {
        if (run.armId !== "A1" && run.armId !== "B") continue;
        const key = `${run.replicateIndex}\u0000${run.matchedPairId}`;
        const counts = pairs.get(key) ?? { A1: 0, B: 0 };
        counts[run.armId] += 1;
        pairs.set(key, counts);
      }
      if ([...pairs.values()].some((counts) => counts.A1 !== 1 || counts.B !== 1)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["includedCheckpointRuns", entryIndex, "runRefs"],
          message: "manifest A1/B refs must form exact matched pairs",
        });
      }
    }
    addRegisteredHashIssue(
      "final-dataset-manifest",
      value,
      context,
      "datasetSha256",
    );
  });

const runBindingSchema = z.union([
  z
    .object({
      checkpointId: evidenceIdSchema,
      checkpointSha256: sha256HexSchema,
      runId: evidenceIdSchema,
      runSha256: sha256HexSchema,
      armId: z.enum(["A0", "C"]),
      replicateIndex: replicateIndexSchema,
    })
    .strict(),
  z
    .object({
      checkpointId: evidenceIdSchema,
      checkpointSha256: sha256HexSchema,
      runId: evidenceIdSchema,
      runSha256: sha256HexSchema,
      armId: z.enum(["A1", "B"]),
      replicateIndex: replicateIndexSchema,
      matchedPairId: evidenceIdSchema,
    })
    .strict(),
]);

export const finalDatasetBindingSchema = z
  .object({
    finalDatasetBindingSchemaVersion: z.literal(
      "dayflow-ablation-final-dataset-binding-v0.1",
    ),
    finalDatasetBindingId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    manifestRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-final-dataset-manifest-v0.1",
        ),
        datasetVersion: schemaVersionSchema,
        datasetSha256: sha256HexSchema,
      })
      .strict(),
    runBindings: z.array(runBindingSchema).min(1).max(8_192),
    createdAt: utcTimestampSchema,
    finalDatasetBindingSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addSortedIssue(
      value.runBindings,
      context,
      (entry) =>
        `${entry.checkpointId}\u0000${entry.armId}\u0000${String(entry.replicateIndex).padStart(2, "0")}\u0000${entry.runId}`,
      ["runBindings"],
    );
    addRegisteredHashIssue(
      "final-dataset-binding",
      value,
      context,
      "finalDatasetBindingSha256",
    );
  });

const pilotRawPurgeObligationSchema = z
  .object({
    frameRef: exportFrameDeletionRefSchema,
    exportManifestRef: z
      .object({
        schemaVersion: z.literal("dayflow-screen-evidence-export-v0.1"),
        exportId: evidenceIdSchema,
        detachedManifestSha256: sha256HexSchema,
      })
      .strict(),
    capturedAt: utcTimestampSchema,
    exportedAt: utcTimestampSchema,
    blabaseRawCopyDeleteBy: utcTimestampSchema,
    dayflowCanonicalSourceDeleteBy: utcTimestampSchema,
  })
  .strict();

const pilotCheckpointVerificationSchema = z
  .object({
    captureWindowId: evidenceIdSchema,
    windowStart: utcTimestampSchema,
    windowEnd: utcTimestampSchema,
    checkpointAsOf: utcTimestampSchema,
    checkpointRef: checkpointRefSchema,
    checkpointCompletionRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-checkpoint-completion-v0.1",
        ),
        checkpointCompletionId: evidenceIdSchema,
        checkpointCompletionSha256: sha256HexSchema,
      })
      .strict(),
    exportManifestRef: z
      .object({
        schemaVersion: z.literal("dayflow-screen-evidence-export-v0.1"),
        exportId: evidenceIdSchema,
        detachedManifestSha256: sha256HexSchema,
      })
      .strict(),
    normalizedEvidenceRef: normalizedEvidenceRefSchema,
    historicalLiveAuthorityRef: liveCollectionFreezeHeadRefSchema,
    retentionPolicy: liveRetentionPolicySchema,
    executionBundleProofSha256: sha256HexSchema,
    rawPurgeObligations: z
      .array(pilotRawPurgeObligationSchema)
      .min(1)
      .max(256),
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.rawPurgeObligations,
      context,
      (entry) => entry.frameRef.artifactId,
      ["rawPurgeObligations"],
    );
    const blabaseMaxAge = Number(
      BigInt(value.retentionPolicy.blabaseRawCopyMaxAgeMs),
    );
    const dayflowMaxAge = Number(
      BigInt(value.retentionPolicy.dayflowCanonicalSourceMaxAgeMs),
    );
    for (const [index, obligation] of value.rawPurgeObligations.entries()) {
      const hardDeadline = addMilliseconds(
        obligation.capturedAt,
        HARD_RAW_RETENTION_MAX_MS,
      );
      const policyCopyDeadline = addMilliseconds(
        obligation.exportedAt,
        blabaseMaxAge,
      );
      const expectedBlabaseDeadline =
        policyCopyDeadline < hardDeadline ? policyCopyDeadline : hardDeadline;
      const expectedDayflowDeadline = addMilliseconds(
        obligation.capturedAt,
        dayflowMaxAge,
      );
      if (
        obligation.exportManifestRef.exportId !==
          value.exportManifestRef.exportId ||
        obligation.exportManifestRef.detachedManifestSha256 !==
          value.exportManifestRef.detachedManifestSha256 ||
        obligation.capturedAt < value.windowStart ||
        obligation.capturedAt >= value.windowEnd ||
        obligation.exportedAt < value.windowEnd ||
        obligation.exportedAt > expectedDayflowDeadline ||
        obligation.blabaseRawCopyDeleteBy !== expectedBlabaseDeadline ||
        obligation.dayflowCanonicalSourceDeleteBy !== expectedDayflowDeadline
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rawPurgeObligations", index],
          message: "raw purge obligation does not match capture/export policy",
        });
      }
    }
  });

export const pilotVerificationAttestationSchema = z
  .object({
    pilotVerificationAttestationSchemaVersion: z.literal(
      "dayflow-ablation-pilot-verification-attestation-v0.1",
    ),
    pilotVerificationAttestationId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: z.literal("live"),
    studyPhase: z.literal("private_pilot"),
    studyProtocolHash: sha256HexSchema,
    targetCheckpointCount: z.literal(PILOT_CHECKPOINT_TARGET),
    sourceGenerationRef: candidateGenerationRefSchema,
    exclusionClosureRef: z
      .object({
        schemaVersion: z.literal("dayflow-ablation-exclusion-closure-v0.1"),
        exclusionClosureId: evidenceIdSchema,
        exclusionClosureSha256: sha256HexSchema,
      })
      .strict(),
    finalDatasetManifestRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-final-dataset-manifest-v0.1",
        ),
        datasetVersion: schemaVersionSchema,
        datasetSha256: sha256HexSchema,
      })
      .strict(),
    finalDatasetBindingRef: z
      .object({
        schemaVersion: z.literal(
          "dayflow-ablation-final-dataset-binding-v0.1",
        ),
        finalDatasetBindingId: evidenceIdSchema,
        finalDatasetBindingSha256: sha256HexSchema,
      })
      .strict(),
    verifierVersion: schemaVersionSchema,
    verificationStatus: z.literal("verified"),
    verificationIssueCodes: z.tuple([]),
    checkpoints: z
      .array(pilotCheckpointVerificationSchema)
      .length(PILOT_CHECKPOINT_TARGET),
    verifiedAt: utcTimestampSchema,
    pilotVerificationAttestationSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addSortedIssue(
      value.checkpoints,
      context,
      (entry) => entry.checkpointRef.checkpointId,
      ["checkpoints"],
    );
    const sortedWindows = [...value.checkpoints].sort((left, right) =>
      compareStrings(
        `${left.windowStart}\u0000${left.windowEnd}\u0000${left.captureWindowId}`,
        `${right.windowStart}\u0000${right.windowEnd}\u0000${right.captureWindowId}`,
      ),
    );
    if (
      new Set(value.checkpoints.map((entry) => entry.captureWindowId)).size !==
        PILOT_CHECKPOINT_TARGET ||
      new Set(
        value.checkpoints.map(
          (entry) =>
            `${entry.exportManifestRef.exportId}\u0000${entry.exportManifestRef.detachedManifestSha256}`,
        ),
      ).size !== PILOT_CHECKPOINT_TARGET ||
      sortedWindows.some((entry, index) => {
        const previous = sortedWindows[index - 1];
        return previous !== undefined && previous.windowEnd > entry.windowStart;
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpoints"],
        message: "pilot checkpoints must be a unique non-overlapping set of 15",
      });
    }
    addRegisteredHashIssue(
      "pilot-verification-attestation",
      value,
      context,
      "pilotVerificationAttestationSha256",
    );
  });

export type PilotVerificationAttestation = z.infer<
  typeof pilotVerificationAttestationSchema
>;

export const dayflowDatasetDagSchema = z
  .object({
    generation: candidateDatasetGenerationSchema,
    decisions: z.array(exclusionDecisionSchema).min(1).max(256),
    closure: exclusionClosureSchema,
    manifest: finalDatasetManifestSchema,
    binding: finalDatasetBindingSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lineageKey = (entry: {
      dataOrigin: string;
      studyPhase: string;
      studyProtocolHash: string;
    }) => `${entry.dataOrigin}\u0000${entry.studyPhase}\u0000${entry.studyProtocolHash}`;
    const expectedLineage = lineageKey(value.generation);
    for (const [path, entry] of [
      ["closure", value.closure],
      ["manifest", value.manifest],
      ["binding", value.binding],
    ] as const) {
      if (lineageKey(entry) !== expectedLineage) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: "DAG lineage must not mix origin, phase, or protocol",
        });
      }
    }
    for (const decision of value.decisions) {
      if (lineageKey(decision) !== expectedLineage) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions"],
          message: "decision lineage mismatch",
        });
      }
    }
    const generationRef = {
      id: value.generation.candidateDatasetGenerationId,
      hash: value.generation.candidateDatasetGenerationSha256,
    };
    if (
      value.closure.sourceGenerationRef.candidateDatasetGenerationId !==
        generationRef.id ||
      value.closure.sourceGenerationRef.candidateDatasetGenerationSha256 !==
        generationRef.hash ||
      value.decisions.some(
        (decision) =>
          decision.sourceGenerationRef.candidateDatasetGenerationId !==
            generationRef.id ||
          decision.sourceGenerationRef.candidateDatasetGenerationSha256 !==
            generationRef.hash,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closure", "sourceGenerationRef"],
        message: "DAG generation references do not resolve",
      });
    }
    const checkpointIds = value.generation.completedCheckpointRuns.map(
      (entry) => entry.checkpointRef.checkpointId,
    );
    const decisionByCheckpoint = new Map(
      value.decisions.map((decision) => [
        decision.checkpointRef.checkpointId,
        decision,
      ]),
    );
    if (
      decisionByCheckpoint.size !== checkpointIds.length ||
      checkpointIds.some((id) => !decisionByCheckpoint.has(id)) ||
      value.closure.decisionRefs.length !== checkpointIds.length ||
      value.closure.decisionRefs.some((reference) => {
        const decision = decisionByCheckpoint.get(reference.checkpointId);
        return (
          !decision ||
          decision.exclusionDecisionId !== reference.exclusionDecisionId ||
          decision.exclusionDecisionSha256 !== reference.exclusionDecisionSha256
        );
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closure", "decisionRefs"],
        message: "closure must bijectively bind one decision per checkpoint",
      });
    }
    for (const entry of value.generation.completedCheckpointRuns) {
      const decision = decisionByCheckpoint.get(entry.checkpointRef.checkpointId);
      if (
        !decision ||
        decision.checkpointRef.checkpointSha256 !==
          entry.checkpointRef.checkpointSha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions"],
          message: "decision checkpoint hash must match the generation checkpoint",
        });
      }
    }
    if (
      value.manifest.exclusionClosureRef.exclusionClosureId !==
        value.closure.exclusionClosureId ||
      value.manifest.exclusionClosureRef.exclusionClosureSha256 !==
        value.closure.exclusionClosureSha256 ||
      value.binding.manifestRef.datasetVersion !== value.manifest.datasetVersion ||
      value.binding.manifestRef.datasetSha256 !== value.manifest.datasetSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifest"],
        message: "DAG successor reference mismatch",
      });
    }
    const included = value.generation.completedCheckpointRuns.filter(
      (entry) =>
        decisionByCheckpoint.get(entry.checkpointRef.checkpointId)?.disposition ===
        "include",
    );
    if (
      included.length !== value.manifest.includedCheckpointRuns.length ||
      included.some((entry, index) => {
        const manifestEntry = value.manifest.includedCheckpointRuns[index];
        return (
          !manifestEntry ||
          JSON.stringify(entry.checkpointRef) !==
            JSON.stringify(manifestEntry.checkpointRef) ||
          entry.runRefs.length !== manifestEntry.runRefs.length ||
          entry.runRefs.some((run, runIndex) => {
            const manifestRun = manifestEntry.runRefs[runIndex];
            return (
              !manifestRun ||
              run.schemaVersion !== manifestRun.schemaVersion ||
              run.runId !== manifestRun.runId ||
              run.runSha256 !== manifestRun.runSha256 ||
              run.armId !== manifestRun.armId ||
              run.replicateIndex !== manifestRun.replicateIndex
            );
          })
        );
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifest", "includedCheckpointRuns"],
        message: "manifest must contain exactly included generation checkpoints",
      });
    }
    const flattened = value.manifest.includedCheckpointRuns.flatMap((entry) =>
      entry.runRefs.map((run) => {
        const common = {
          checkpointId: entry.checkpointRef.checkpointId,
          checkpointSha256: entry.checkpointRef.checkpointSha256,
          runId: run.runId,
          runSha256: run.runSha256,
          armId: run.armId,
          replicateIndex: run.replicateIndex,
        };
        return "matchedPairId" in run
          ? { ...common, matchedPairId: run.matchedPairId }
          : common;
      }),
    );
    if (
      flattened.length !== value.binding.runBindings.length ||
      flattened.some(
        (entry, index) =>
          JSON.stringify(entry) !== JSON.stringify(value.binding.runBindings[index]),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["binding", "runBindings"],
        message: "final binding must bijectively flatten the manifest",
      });
    }
  });

export function validateDayflowDatasetDag(value: unknown): boolean {
  return dayflowDatasetDagSchema.safeParse(value).success;
}

export type DayflowDatasetDagResolver = Readonly<{
  resolveCandidateGeneration: (
    reference: Readonly<{
      schemaVersion: "dayflow-ablation-candidate-dataset-generation-v0.1";
      candidateDatasetGenerationId: string;
      candidateDatasetGenerationSha256: string;
    }>,
  ) => unknown | undefined;
  resolveExecutionBundles: () => readonly ResolvedExecutionBundleInput[];
}>;

export const resolvedDayflowDatasetDagIssueCodeSchema = z.enum([
  "DATASET_DAG_ANCESTRY_MISMATCH",
  "DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH",
  "DATASET_DAG_CHRONOLOGY_MISMATCH",
  "DATASET_DAG_CUMULATIVE_MISMATCH",
  "DATASET_DAG_CYCLE_DETECTED",
  "DATASET_DAG_EXECUTION_INVALID",
  "DATASET_DAG_ORDER_MISMATCH",
  "DATASET_DAG_PILOT_TARGET_MISMATCH",
  "DATASET_DAG_REFERENCE_MISMATCH",
  "DATASET_DAG_RESOLUTION_NOT_EXACT",
  "DATASET_DAG_RUN_BIJECTION_MISMATCH",
  "DATASET_DAG_SCHEMA_INVALID",
  "DATASET_DAG_STATUS_MISMATCH",
]);

export type ResolvedDayflowDatasetDagIssueCode = z.infer<
  typeof resolvedDayflowDatasetDagIssueCodeSchema
>;

export type ResolvedDayflowDatasetDagVerification =
  | Readonly<{
      valid: true;
      issueCodes: readonly [];
      dag: z.infer<typeof dayflowDatasetDagSchema>;
      generationAncestry: readonly CandidateDatasetGeneration[];
      executionBundles: readonly ResolvedExecutionBundle[];
    }>
  | Readonly<{
      valid: false;
      issueCodes: readonly ResolvedDayflowDatasetDagIssueCode[];
    }>;

function generationLineageMatches(
  left: CandidateDatasetGeneration,
  right: CandidateDatasetGeneration,
): boolean {
  return (
    left.dataOrigin === right.dataOrigin &&
    left.studyPhase === right.studyPhase &&
    left.studyProtocolHash === right.studyProtocolHash
  );
}

function manifestRunRefMatchesResolvedRun(
  reference: z.infer<typeof manifestRunRefSchema>,
  run: DayflowRun,
): boolean {
  if (!runRefMatches(reference, run)) return false;
  if (reference.armId === "A1" || reference.armId === "B") {
    return (
      (run.armId === "A1" || run.armId === "B") &&
      reference.matchedPairId === run.matchedPairId
    );
  }
  return run.armId === reference.armId;
}

/**
 * Resolves the forward-only dataset DAG without performing I/O itself. The
 * resolver must return exact referenced payloads; every returned artifact is
 * reparsed and detached-hash checked before any cross-artifact comparison.
 */
export function verifyResolvedDayflowDatasetDag(
  value: unknown,
  resolver: DayflowDatasetDagResolver,
): ResolvedDayflowDatasetDagVerification {
  const parsedDag = dayflowDatasetDagSchema.safeParse(value);
  if (!parsedDag.success) {
    return { valid: false, issueCodes: ["DATASET_DAG_SCHEMA_INVALID"] };
  }
  const dag = parsedDag.data;
  const issues = new Set<ResolvedDayflowDatasetDagIssueCode>();

  const generationAncestryNewestFirst: CandidateDatasetGeneration[] = [
    dag.generation,
  ];
  const seenGenerationIds = new Set<string>([
    dag.generation.candidateDatasetGenerationId,
  ]);
  let childGeneration = dag.generation;
  for (let depth = 0; depth < 256; depth += 1) {
    const reference = childGeneration.priorCandidateDatasetGenerationRef;
    if (reference === undefined) break;
    if (seenGenerationIds.has(reference.candidateDatasetGenerationId)) {
      issues.add("DATASET_DAG_CYCLE_DETECTED");
      break;
    }
    let resolvedValue: unknown;
    try {
      resolvedValue = resolver.resolveCandidateGeneration(reference);
    } catch {
      issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
      break;
    }
    const resolved = candidateDatasetGenerationSchema.safeParse(resolvedValue);
    if (!resolved.success) {
      issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
      break;
    }
    const parentGeneration = resolved.data;
    if (!generationRefMatches(reference, parentGeneration)) {
      issues.add("DATASET_DAG_REFERENCE_MISMATCH");
      break;
    }
    if (!generationLineageMatches(childGeneration, parentGeneration)) {
      issues.add("DATASET_DAG_ANCESTRY_MISMATCH");
    }
    if (parentGeneration.createdAt >= childGeneration.createdAt) {
      issues.add("DATASET_DAG_CHRONOLOGY_MISMATCH");
    }
    generationAncestryNewestFirst.push(parentGeneration);
    seenGenerationIds.add(parentGeneration.candidateDatasetGenerationId);
    childGeneration = parentGeneration;
    if (
      depth === 255 &&
      parentGeneration.priorCandidateDatasetGenerationRef !== undefined
    ) {
      issues.add("DATASET_DAG_ANCESTRY_MISMATCH");
    }
  }
  const generationAncestry = [...generationAncestryNewestFirst].reverse();
  if (
    dag.generation.dataOrigin === "live" &&
    dag.generation.studyPhase === "private_pilot" &&
    dag.generation.completedCheckpointRuns.length !== PILOT_CHECKPOINT_TARGET
  ) {
    issues.add("DATASET_DAG_PILOT_TARGET_MISMATCH");
  }
  const generationInspection = inspectGenerationChain(generationAncestry);
  if (generationInspection.ancestryMismatch) {
    issues.add("DATASET_DAG_ANCESTRY_MISMATCH");
  }
  if (generationInspection.cumulativeMismatch) {
    issues.add("DATASET_DAG_CUMULATIVE_MISMATCH");
  }
  if (generationInspection.cycleDetected) {
    issues.add("DATASET_DAG_CYCLE_DETECTED");
  }
  if (generationInspection.chronologyMismatch) {
    issues.add("DATASET_DAG_CHRONOLOGY_MISMATCH");
  }

  const directParent = generationAncestry.at(-2);
  const parentEntries = new Map(
    (directParent?.completedCheckpointRuns ?? []).map((entry) => [
      entry.checkpointRef.checkpointId,
      entry,
    ]),
  );
  const resolvedBundles: ResolvedExecutionBundle[] = [];
  let resolvedBundleInputs: readonly ResolvedExecutionBundleInput[] = [];
  try {
    resolvedBundleInputs = resolver.resolveExecutionBundles();
  } catch {
    issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
  }
  if (!Array.isArray(resolvedBundleInputs)) {
    issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
    resolvedBundleInputs = [];
  }
  const verifiedBundleByCheckpoint = new Map<
    string,
    ResolvedExecutionBundle
  >();
  const exportIdentityByCaptureWindow = new Map<string, string>();
  const captureWindowByExportIdentity = new Map<string, string>();
  const checkpointByCaptureWindow = new Map<string, string>();
  const exportHashByExportId = new Map<string, string>();
  const liveCaptureWindows: Array<{
    captureWindowId: string;
    windowStart: string;
    windowEnd: string;
  }> = [];
  for (const bundleInput of resolvedBundleInputs) {
    const verified = verifyResolvedExecutionBundle(bundleInput);
    if (!verified.valid) {
      issues.add("DATASET_DAG_EXECUTION_INVALID");
      continue;
    }
    const bundle = verified.bundle;
    if (verifiedBundleByCheckpoint.has(bundle.checkpoint.checkpointId)) {
      issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
      continue;
    }
    verifiedBundleByCheckpoint.set(bundle.checkpoint.checkpointId, bundle);
    const exportIdentity = jcsCanonicalize({
      schemaVersion: bundle.screenEvidence.exportManifest.schemaVersion,
      exportId: bundle.screenEvidence.exportManifest.exportId,
      detachedManifestSha256:
        bundle.screenEvidence.exportManifest.detachedManifestSha256,
    });
    const previousExportIdentity = exportIdentityByCaptureWindow.get(
      bundle.screenEvidence.captureWindowId,
    );
    const previousCaptureWindow =
      captureWindowByExportIdentity.get(exportIdentity);
    const previousCheckpoint = checkpointByCaptureWindow.get(
      bundle.screenEvidence.captureWindowId,
    );
    const previousExportHash = exportHashByExportId.get(
      bundle.screenEvidence.exportManifest.exportId,
    );
    if (
      previousExportIdentity !== undefined &&
      previousExportIdentity !== exportIdentity ||
      (previousCaptureWindow !== undefined &&
        previousCaptureWindow !== bundle.screenEvidence.captureWindowId) ||
      (previousCheckpoint !== undefined &&
        previousCheckpoint !== bundle.checkpoint.checkpointId) ||
      (previousExportHash !== undefined &&
        previousExportHash !==
          bundle.screenEvidence.exportManifest.detachedManifestSha256)
    ) {
      issues.add("DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH");
    }
    exportIdentityByCaptureWindow.set(
      bundle.screenEvidence.captureWindowId,
      exportIdentity,
    );
    captureWindowByExportIdentity.set(
      exportIdentity,
      bundle.screenEvidence.captureWindowId,
    );
    checkpointByCaptureWindow.set(
      bundle.screenEvidence.captureWindowId,
      bundle.checkpoint.checkpointId,
    );
    exportHashByExportId.set(
      bundle.screenEvidence.exportManifest.exportId,
      bundle.screenEvidence.exportManifest.detachedManifestSha256,
    );
    if (bundle.checkpoint.dataOrigin === "live") {
      liveCaptureWindows.push({
        captureWindowId: bundle.screenEvidence.captureWindowId,
        windowStart: bundle.checkpoint.windowStart,
        windowEnd: bundle.checkpoint.windowEnd,
      });
    }
  }
  liveCaptureWindows.sort((left, right) =>
    compareStrings(
      `${left.windowStart}\u0000${left.windowEnd}\u0000${left.captureWindowId}`,
      `${right.windowStart}\u0000${right.windowEnd}\u0000${right.captureWindowId}`,
    ),
  );
  if (
    liveCaptureWindows.some((window, index) => {
      const previous = liveCaptureWindows[index - 1];
      return previous !== undefined && previous.windowEnd > window.windowStart;
    })
  ) {
    issues.add("DATASET_DAG_CAPTURE_WINDOW_EXPORT_MISMATCH");
  }
  for (const entry of dag.generation.completedCheckpointRuns) {
    const bundle = verifiedBundleByCheckpoint.get(
      entry.checkpointRef.checkpointId,
    );
    if (bundle === undefined) {
      issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
      continue;
    }
    resolvedBundles.push(bundle);
    if (
      !checkpointRefMatches(entry.checkpointRef, bundle.checkpoint) ||
      entry.checkpointCompletionRef.checkpointCompletionId !==
        bundle.completion.checkpointCompletionId ||
      entry.checkpointCompletionRef.checkpointCompletionSha256 !==
        bundle.completion.checkpointCompletionSha256
    ) {
      issues.add("DATASET_DAG_REFERENCE_MISMATCH");
    }
    if (
      bundle.checkpoint.dataOrigin !== dag.generation.dataOrigin ||
      bundle.checkpoint.studyPhase !== dag.generation.studyPhase ||
      bundle.checkpoint.studyProtocolHash !==
        dag.generation.studyProtocolHash
    ) {
      issues.add("DATASET_DAG_ANCESTRY_MISMATCH");
    }
    if (bundle.completion.completionStatus !== "completed") {
      issues.add("DATASET_DAG_STATUS_MISMATCH");
    }
    if (
      entry.runRefs.length !== bundle.runs.length ||
      entry.runRefs.length !== bundle.completion.presentRunRefs.length ||
      entry.runRefs.some((reference, index) => {
        const run = bundle.runs[index];
        const completionReference =
          bundle.completion.presentRunRefs[index];
        return (
          run === undefined ||
          completionReference === undefined ||
          !runRefMatches(reference, run) ||
          !canonicalEqual(reference, completionReference)
        );
      })
    ) {
      issues.add("DATASET_DAG_RUN_BIJECTION_MISMATCH");
    }
    if (
      bundle.completion.completedAt > dag.generation.createdAt ||
      bundle.runs.some((run) => run.completedAt > dag.generation.createdAt)
    ) {
      issues.add("DATASET_DAG_CHRONOLOGY_MISMATCH");
    }

    const parentEntry = parentEntries.get(entry.checkpointRef.checkpointId);
    if (parentEntry !== undefined && !canonicalEqual(parentEntry, entry)) {
      issues.add("DATASET_DAG_CUMULATIVE_MISMATCH");
    }
    const firstAppearanceIndex = generationAncestry.findIndex((generation) =>
      generation.completedCheckpointRuns.some(
        (candidate) =>
          candidate.checkpointRef.checkpointId ===
          entry.checkpointRef.checkpointId,
      ),
    );
    const generationBeforeFirstAppearance =
      firstAppearanceIndex > 0
        ? generationAncestry[firstAppearanceIndex - 1]
        : undefined;
    if (
      (generationBeforeFirstAppearance === undefined &&
        bundle.checkpoint.priorCandidateDatasetGenerationRef !== undefined) ||
      (generationBeforeFirstAppearance !== undefined &&
        (bundle.checkpoint.priorCandidateDatasetGenerationRef === undefined ||
          !generationRefMatches(
            bundle.checkpoint.priorCandidateDatasetGenerationRef,
            generationBeforeFirstAppearance,
          ) ||
          generationBeforeFirstAppearance.createdAt >=
            bundle.checkpoint.windowStart))
    ) {
      issues.add("DATASET_DAG_ANCESTRY_MISMATCH");
    }
  }
  if (
    resolvedBundles.length !== dag.generation.completedCheckpointRuns.length ||
    verifiedBundleByCheckpoint.size !==
      dag.generation.completedCheckpointRuns.length ||
    resolvedBundleInputs.length !== dag.generation.completedCheckpointRuns.length
  ) {
    issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
  }
  if (
    dag.generation.dataOrigin === "live" &&
    dag.generation.studyPhase === "private_pilot"
  ) {
    const globallyUniqueIds = resolvedBundles.flatMap((bundle) => [
      bundle.checkpoint.checkpointId,
      bundle.completion.checkpointCompletionId,
      bundle.screenEvidence.exportManifest.exportId,
      bundle.screenEvidence.normalizedEvidence.evidenceId,
      ...bundle.armInputs.map((entry) => entry.armInputId),
      ...bundle.requestOrderManifests.map(
        (entry) => entry.requestOrderManifestId,
      ),
      ...bundle.requestIssuanceReceipts.map(
        (entry) => entry.requestIssuanceReceiptId,
      ),
      ...bundle.runs.map((entry) => entry.runId),
    ]);
    const requestIds = resolvedBundles.flatMap((bundle) =>
      bundle.requestOrderManifests.flatMap((manifest) =>
        manifest.entries.map((entry) => entry.requestId),
      ),
    );
    if (
      resolvedBundles.some(
        (bundle) =>
          bundle.studyProtocol.targetDataOrigin !== "live" ||
          bundle.studyProtocol.targetStudyPhase !== "private_pilot" ||
          bundle.studyProtocol.targetCheckpointCount !==
            PILOT_CHECKPOINT_TARGET ||
          bundle.executionFreeze.targetCheckpointCount !==
            PILOT_CHECKPOINT_TARGET,
      ) ||
      new Set(globallyUniqueIds).size !== globallyUniqueIds.length ||
      new Set(requestIds).size !== requestIds.length
    ) {
      issues.add("DATASET_DAG_PILOT_TARGET_MISMATCH");
    }
  }

  const decisionCheckpointIds = dag.decisions.map(
    (decision) => decision.checkpointRef.checkpointId,
  );
  if (!isStrictlySortedUnique(decisionCheckpointIds, (id) => id)) {
    issues.add("DATASET_DAG_ORDER_MISMATCH");
  }
  if (
    dag.decisions.some(
      (decision) => decision.decidedAt <= dag.generation.createdAt,
    ) ||
    dag.decisions.some((decision) => decision.decidedAt > dag.closure.closedAt) ||
    dag.binding.createdAt < dag.closure.closedAt
  ) {
    issues.add("DATASET_DAG_CHRONOLOGY_MISMATCH");
  }

  const bundleByCheckpoint = new Map(
    resolvedBundles.map((bundle) => [bundle.checkpoint.checkpointId, bundle]),
  );
  for (const included of dag.manifest.includedCheckpointRuns) {
    const bundle = bundleByCheckpoint.get(included.checkpointRef.checkpointId);
    if (bundle === undefined) {
      issues.add("DATASET_DAG_RESOLUTION_NOT_EXACT");
      continue;
    }
    const runById = new Map(bundle.runs.map((run) => [run.runId, run]));
    if (
      !isStrictlySortedUnique(
        included.runRefs,
        (run) =>
          `${String(ARM_ORDER.indexOf(run.armId)).padStart(2, "0")}\u0000${String(run.replicateIndex).padStart(2, "0")}\u0000${run.runId}`,
      ) ||
      included.runRefs.some((reference) => {
        const run = runById.get(reference.runId);
        return run === undefined || !manifestRunRefMatchesResolvedRun(reference, run);
      })
    ) {
      issues.add("DATASET_DAG_RUN_BIJECTION_MISMATCH");
    }
  }

  if (issues.size > 0) {
    return { valid: false, issueCodes: sortedIssueCodes(issues) };
  }
  return {
    valid: true,
    issueCodes: [],
    dag,
    generationAncestry,
    executionBundles: resolvedBundles,
  };
}

function registeredAffectedArtifactRefKey(
  reference: z.infer<typeof affectedArtifactRefSchema>,
): string {
  return `${reference.artifactType}\u0000${reference.schemaVersion}\u0000${reference.artifactId}\u0000${reference.artifactSha256}`;
}

function resolvedExecutionBundleProofSha256(
  bundle: ResolvedExecutionBundle,
): string {
  const authority = bundle.historicalLiveAuthority;
  if (authority === undefined) {
    throw new TypeError("Pilot execution has no historical live authority");
  }
  return domainSeparatedSha256(
    "blabase.dayflow-ablation.resolved-execution-proof.v0.1",
    {
      studyProtocolHash: bundle.studyProtocol.studyProtocolHash,
      executionFreezeRef: {
        schemaVersion:
          bundle.executionFreeze.evaluationExecutionFreezeSchemaVersion,
        evaluationExecutionFreezeId:
          bundle.executionFreeze.evaluationExecutionFreezeId,
        evaluationExecutionFreezeSha256:
          bundle.executionFreeze.evaluationExecutionFreezeSha256,
      },
      checkpointRef: {
        schemaVersion: bundle.checkpoint.checkpointSchemaVersion,
        checkpointId: bundle.checkpoint.checkpointId,
        checkpointSha256: bundle.checkpoint.checkpointSha256,
      },
      checkpointCompletionRef: {
        schemaVersion: bundle.completion.checkpointCompletionSchemaVersion,
        checkpointCompletionId: bundle.completion.checkpointCompletionId,
        checkpointCompletionSha256:
          bundle.completion.checkpointCompletionSha256,
      },
      authorityHeadRef: authority.authorityHeadRef,
      retentionPolicy: authority.retentionPolicy,
      armInputRefs: bundle.armInputs.map((entry) => ({
        armId: entry.armId,
        replicateIndex: entry.replicateIndex,
        armInputId: entry.armInputId,
        armInputHash: entry.armInputHash,
      })),
      requestOrderManifestRefs: bundle.requestOrderManifests.map((entry) => ({
        requestOrderManifestId: entry.requestOrderManifestId,
        requestOrderManifestSha256: entry.requestOrderManifestSha256,
      })),
      requestIssuanceReceiptRefs: bundle.requestIssuanceReceipts.map(
        (entry) => ({
          requestIssuanceReceiptId: entry.requestIssuanceReceiptId,
          requestIssuanceReceiptSha256:
            entry.requestIssuanceReceiptSha256,
        }),
      ),
      runRefs: bundle.runs.map((entry) => ({
        armId: entry.armId,
        replicateIndex: entry.replicateIndex,
        runId: entry.runId,
        runSha256: entry.runSha256,
      })),
      exportManifestRef: {
        schemaVersion: bundle.screenEvidence.exportManifest.schemaVersion,
        exportId: bundle.screenEvidence.exportManifest.exportId,
        detachedManifestSha256:
          bundle.screenEvidence.exportManifest.detachedManifestSha256,
      },
      normalizedEvidenceRef: {
        schemaVersion: bundle.screenEvidence.normalizedEvidence.schemaVersion,
        evidenceId: bundle.screenEvidence.normalizedEvidence.evidenceId,
        dayflowNormalizedEvidenceHash:
          bundle.screenEvidence.normalizedEvidence
            .dayflowNormalizedEvidenceHash,
      },
    },
  );
}

export type PilotVerificationAttestationIssuanceInput = Readonly<{
  dag: unknown;
  resolver: DayflowDatasetDagResolver;
  pilotVerificationAttestationId: string;
  verifierVersion: string;
  verifiedAt: string;
}>;

/**
 * Pre-purge-only pure issuance seam. It emits an attestation only after the
 * complete raw execution DAG verifies; publication/storage remains DFA-007.
 */
export function issuePilotVerificationAttestation(
  input: PilotVerificationAttestationIssuanceInput,
): PilotVerificationAttestation | undefined {
  const attestationId = evidenceIdSchema.safeParse(
    input.pilotVerificationAttestationId,
  );
  const verifierVersion = schemaVersionSchema.safeParse(input.verifierVersion);
  const verifiedAt = utcTimestampSchema.safeParse(input.verifiedAt);
  if (!attestationId.success || !verifierVersion.success || !verifiedAt.success) {
    return undefined;
  }
  const verification = verifyResolvedDayflowDatasetDag(input.dag, input.resolver);
  if (
    !verification.valid ||
    verification.dag.generation.dataOrigin !== "live" ||
    verification.dag.generation.studyPhase !== "private_pilot" ||
    verification.executionBundles.length !== PILOT_CHECKPOINT_TARGET ||
    verifiedAt.data < verification.dag.binding.createdAt ||
    verifiedAt.data < verification.dag.closure.closedAt
  ) {
    return undefined;
  }
  const checkpoints = verification.executionBundles
    .map((bundle): z.infer<typeof pilotCheckpointVerificationSchema> => {
      const authority = bundle.historicalLiveAuthority;
      if (
        authority === undefined ||
        bundle.studyProtocol.targetDataOrigin !== "live" ||
        bundle.studyProtocol.targetStudyPhase !== "private_pilot" ||
        bundle.studyProtocol.targetCheckpointCount !== PILOT_CHECKPOINT_TARGET ||
        bundle.executionFreeze.targetCheckpointCount !== PILOT_CHECKPOINT_TARGET
      ) {
        throw new TypeError("Pilot execution target or authority mismatch");
      }
      const exportManifest = bundle.screenEvidence.exportManifest;
      const exportManifestRef = {
        schemaVersion: exportManifest.schemaVersion,
        exportId: exportManifest.exportId,
        detachedManifestSha256: exportManifest.detachedManifestSha256,
      } as const;
      const blabaseMaxAge = Number(
        BigInt(authority.retentionPolicy.blabaseRawCopyMaxAgeMs),
      );
      const dayflowMaxAge = Number(
        BigInt(authority.retentionPolicy.dayflowCanonicalSourceMaxAgeMs),
      );
      const rawPurgeObligations = exportManifest.artifacts
        .map((artifact) => {
          const hardDeadline = addMilliseconds(
            artifact.capturedAt,
            HARD_RAW_RETENTION_MAX_MS,
          );
          const policyCopyDeadline = addMilliseconds(
            exportManifest.exportedAt,
            blabaseMaxAge,
          );
          return {
            frameRef: {
              artifactType: "dayflow-export-frame" as const,
              schemaVersion: "dayflow-export-artifact-v0.1" as const,
              artifactId: `frame-${domainSeparatedSha256(
                "blabase.dayflow-ablation.deletion-obligation.frame.v0.1",
                {
                  exportId: exportManifest.exportId,
                  sourceArtifactId: artifact.sourceArtifactId,
                },
              )}`,
              artifactSha256: artifact.sha256,
            },
            exportManifestRef,
            capturedAt: artifact.capturedAt,
            exportedAt: exportManifest.exportedAt,
            blabaseRawCopyDeleteBy:
              policyCopyDeadline < hardDeadline
                ? policyCopyDeadline
                : hardDeadline,
            dayflowCanonicalSourceDeleteBy: addMilliseconds(
              artifact.capturedAt,
              dayflowMaxAge,
            ),
          };
        })
        .sort((left, right) =>
          compareStrings(left.frameRef.artifactId, right.frameRef.artifactId),
        );
      if (
        rawPurgeObligations.some(
          (entry) =>
            exportManifest.exportedAt >
            entry.dayflowCanonicalSourceDeleteBy,
        )
      ) {
        throw new TypeError("Export was published after a raw purge deadline");
      }
      return {
        captureWindowId: bundle.checkpoint.captureWindowId,
        windowStart: bundle.checkpoint.windowStart,
        windowEnd: bundle.checkpoint.windowEnd,
        checkpointAsOf: bundle.checkpoint.asOf,
        checkpointRef: {
          schemaVersion: bundle.checkpoint.checkpointSchemaVersion,
          checkpointId: bundle.checkpoint.checkpointId,
          checkpointSha256: bundle.checkpoint.checkpointSha256,
        },
        checkpointCompletionRef: {
          schemaVersion: bundle.completion.checkpointCompletionSchemaVersion,
          checkpointCompletionId: bundle.completion.checkpointCompletionId,
          checkpointCompletionSha256:
            bundle.completion.checkpointCompletionSha256,
        },
        exportManifestRef,
        normalizedEvidenceRef: {
          schemaVersion: bundle.screenEvidence.normalizedEvidence.schemaVersion,
          evidenceId: bundle.screenEvidence.normalizedEvidence.evidenceId,
          dayflowNormalizedEvidenceHash:
            bundle.screenEvidence.normalizedEvidence
              .dayflowNormalizedEvidenceHash,
        },
        historicalLiveAuthorityRef: authority.authorityHeadRef,
        retentionPolicy: authority.retentionPolicy,
        executionBundleProofSha256: resolvedExecutionBundleProofSha256(bundle),
        rawPurgeObligations,
      };
    })
    .sort((left, right) =>
      compareStrings(
        left.checkpointRef.checkpointId,
        right.checkpointRef.checkpointId,
      ),
    );
  if (
    checkpoints.some((entry) =>
      entry.rawPurgeObligations.some(
        (obligation) =>
          verifiedAt.data > obligation.blabaseRawCopyDeleteBy ||
          verifiedAt.data > obligation.dayflowCanonicalSourceDeleteBy,
      ),
    )
  ) {
    return undefined;
  }
  const candidate: Record<string, unknown> = {
    pilotVerificationAttestationSchemaVersion:
      "dayflow-ablation-pilot-verification-attestation-v0.1",
    pilotVerificationAttestationId: attestationId.data,
    lineageClass: "evidence",
    dataOrigin: "live",
    studyPhase: "private_pilot",
    studyProtocolHash: verification.dag.generation.studyProtocolHash,
    targetCheckpointCount: PILOT_CHECKPOINT_TARGET,
    sourceGenerationRef: {
      schemaVersion:
        verification.dag.generation.candidateDatasetGenerationSchemaVersion,
      candidateDatasetGenerationId:
        verification.dag.generation.candidateDatasetGenerationId,
      candidateDatasetGenerationSha256:
        verification.dag.generation.candidateDatasetGenerationSha256,
    },
    exclusionClosureRef: {
      schemaVersion: verification.dag.closure.exclusionClosureSchemaVersion,
      exclusionClosureId: verification.dag.closure.exclusionClosureId,
      exclusionClosureSha256: verification.dag.closure.exclusionClosureSha256,
    },
    finalDatasetManifestRef: {
      schemaVersion:
        verification.dag.manifest.finalDatasetManifestSchemaVersion,
      datasetVersion: verification.dag.manifest.datasetVersion,
      datasetSha256: verification.dag.manifest.datasetSha256,
    },
    finalDatasetBindingRef: {
      schemaVersion:
        verification.dag.binding.finalDatasetBindingSchemaVersion,
      finalDatasetBindingId:
        verification.dag.binding.finalDatasetBindingId,
      finalDatasetBindingSha256:
        verification.dag.binding.finalDatasetBindingSha256,
    },
    verifierVersion: verifierVersion.data,
    verificationStatus: "verified",
    verificationIssueCodes: [],
    checkpoints,
    verifiedAt: verifiedAt.data,
    pilotVerificationAttestationSha256: "0".repeat(64),
  };
  candidate.pilotVerificationAttestationSha256 = hashRegisteredArtifact(
    "pilot-verification-attestation",
    candidate,
  );
  const parsed = pilotVerificationAttestationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function verifyHistoricalPilotAuthorityProjection(
  checkpoint: z.infer<typeof pilotCheckpointVerificationSchema>,
  studyProtocolHash: string,
  resolver: AuthoritativeLiveAuthorityResolver,
): boolean {
  try {
    const resolvedHeadRef = liveCollectionFreezeHeadRefSchema.safeParse(
      resolver.getHeadRefAsOf({
        studyProtocolHash,
        targetStudyPhase: "private_pilot",
        asOf: checkpoint.checkpointAsOf,
      }),
    );
    if (
      !resolvedHeadRef.success ||
      !canonicalEqual(
        resolvedHeadRef.data,
        checkpoint.historicalLiveAuthorityRef,
      )
    ) {
      return false;
    }
    const freeze = liveCollectionFreezeSchema.safeParse(
      resolver.resolve(resolvedHeadRef.data),
    );
    if (
      !freeze.success ||
      freeze.data.status !== "approved" ||
      freeze.data.liveCollectionFreezeId !==
        resolvedHeadRef.data.liveCollectionFreezeId ||
      freeze.data.liveCollectionFreezeSha256 !==
        resolvedHeadRef.data.liveCollectionFreezeSha256 ||
      freeze.data.targetStudyPhase !== "private_pilot" ||
      freeze.data.targetCheckpointCount !== PILOT_CHECKPOINT_TARGET ||
      freeze.data.studyProtocolRef.studyProtocolHash !== studyProtocolHash ||
      freeze.data.approvedAt === undefined ||
      freeze.data.approvedAt > checkpoint.windowStart
    ) {
      return false;
    }
    const approvalRef = freeze.data.approvalRefs[0];
    if (approvalRef?.approvalType !== "H-LIVE-CAPTURE") return false;
    const approval = liveCaptureApprovalSchema.safeParse(
      resolver.resolve(approvalRef),
    );
    return (
      approval.success &&
      approval.data.approvalRecordId === approvalRef.approvalRecordId &&
      approval.data.approvalRecordSha256 ===
        approvalRef.approvalRecordSha256 &&
      approval.data.phase === "private_pilot" &&
      approval.data.studyProtocolRef.studyProtocolHash === studyProtocolHash &&
      approval.data.approvedAt <= checkpoint.windowStart &&
      approval.data.validFrom <= checkpoint.windowStart &&
      checkpoint.checkpointAsOf <= approval.data.validUntil &&
      (approval.data.revokedAt === undefined ||
        checkpoint.checkpointAsOf < approval.data.revokedAt)
    );
  } catch {
    return false;
  }
}

function verifyPostPurgePilotEvidence(input: Readonly<{
  dag: unknown;
  attestation: unknown;
  historicalAuthorityResolver: AuthoritativeLiveAuthorityResolver | undefined;
  deletionReceipts: readonly z.infer<typeof deletionReceiptSchema>[];
  pilotApproval: z.infer<typeof pilotGoApprovalSchema>;
}>): boolean {
  const dag = dayflowDatasetDagSchema.safeParse(input.dag);
  const attestation = pilotVerificationAttestationSchema.safeParse(
    input.attestation,
  );
  const resolver = input.historicalAuthorityResolver;
  if (
    !dag.success ||
    !attestation.success ||
    resolver === undefined ||
    resolver === null ||
    typeof resolver !== "object" ||
    typeof resolver.getCurrentHeadRef !== "function" ||
    typeof resolver.getHeadRefAsOf !== "function" ||
    typeof resolver.resolve !== "function"
  ) {
    return false;
  }
  const dagValue = dag.data;
  const attestationValue = attestation.data;
  const expectedCheckpointRefs = dagValue.generation.completedCheckpointRuns
    .map((entry) => ({
      checkpointRef: entry.checkpointRef,
      checkpointCompletionRef: entry.checkpointCompletionRef,
    }))
    .sort((left, right) =>
      compareStrings(
        left.checkpointRef.checkpointId,
        right.checkpointRef.checkpointId,
      ),
    );
  const attestedCheckpointRefs = attestationValue.checkpoints.map((entry) => ({
    checkpointRef: entry.checkpointRef,
    checkpointCompletionRef: entry.checkpointCompletionRef,
  }));
  if (
    dagValue.generation.dataOrigin !== "live" ||
    dagValue.generation.studyPhase !== "private_pilot" ||
    dagValue.generation.completedCheckpointRuns.length !==
      PILOT_CHECKPOINT_TARGET ||
    attestationValue.studyProtocolHash !==
      dagValue.generation.studyProtocolHash ||
    !canonicalEqual(attestationValue.sourceGenerationRef, {
      schemaVersion: dagValue.generation.candidateDatasetGenerationSchemaVersion,
      candidateDatasetGenerationId:
        dagValue.generation.candidateDatasetGenerationId,
      candidateDatasetGenerationSha256:
        dagValue.generation.candidateDatasetGenerationSha256,
    }) ||
    !canonicalEqual(attestationValue.exclusionClosureRef, {
      schemaVersion: dagValue.closure.exclusionClosureSchemaVersion,
      exclusionClosureId: dagValue.closure.exclusionClosureId,
      exclusionClosureSha256: dagValue.closure.exclusionClosureSha256,
    }) ||
    !canonicalEqual(attestationValue.finalDatasetManifestRef, {
      schemaVersion: dagValue.manifest.finalDatasetManifestSchemaVersion,
      datasetVersion: dagValue.manifest.datasetVersion,
      datasetSha256: dagValue.manifest.datasetSha256,
    }) ||
    !canonicalEqual(attestationValue.finalDatasetBindingRef, {
      schemaVersion: dagValue.binding.finalDatasetBindingSchemaVersion,
      finalDatasetBindingId: dagValue.binding.finalDatasetBindingId,
      finalDatasetBindingSha256: dagValue.binding.finalDatasetBindingSha256,
    }) ||
    !canonicalEqual(expectedCheckpointRefs, attestedCheckpointRefs) ||
    attestationValue.verifiedAt < dagValue.binding.createdAt ||
    attestationValue.verifiedAt < dagValue.closure.closedAt ||
    input.pilotApproval.pilotFinalBindingRef.finalDatasetBindingId !==
      dagValue.binding.finalDatasetBindingId ||
    input.pilotApproval.pilotFinalBindingRef.finalDatasetBindingSha256 !==
      dagValue.binding.finalDatasetBindingSha256 ||
    input.pilotApproval.pilotVerificationAttestationRef
      .pilotVerificationAttestationId !==
      attestationValue.pilotVerificationAttestationId ||
    input.pilotApproval.pilotVerificationAttestationRef
      .pilotVerificationAttestationSha256 !==
      attestationValue.pilotVerificationAttestationSha256 ||
    attestationValue.verifiedAt > input.pilotApproval.approvedAt ||
    attestationValue.checkpoints.some(
      (checkpoint) =>
        !verifyHistoricalPilotAuthorityProjection(
          checkpoint,
          attestationValue.studyProtocolHash,
          resolver,
        ),
    )
  ) {
    return false;
  }
  const receiptsById = new Map(
    input.deletionReceipts.map((receipt) => [receipt.deletionReceiptId, receipt]),
  );
  if (
    receiptsById.size !== input.deletionReceipts.length ||
    input.pilotApproval.pilotDeletionEvidenceRefs.length !== receiptsById.size ||
    input.pilotApproval.pilotDeletionEvidenceRefs.some((reference) => {
      const receipt = receiptsById.get(reference.deletionReceiptId);
      return (
        receipt === undefined ||
        receipt.deletionReceiptSha256 !== reference.deletionReceiptSha256
      );
    })
  ) {
    return false;
  }
  const expectedRefs = new Map<string, z.infer<typeof affectedArtifactRefSchema>>();
  for (const checkpoint of attestationValue.checkpoints) {
    const exportRef: z.infer<typeof affectedArtifactRefSchema> = {
      artifactType: "dayflow-export-manifest",
      schemaVersion: checkpoint.exportManifestRef.schemaVersion,
      artifactId: checkpoint.exportManifestRef.exportId,
      artifactSha256: checkpoint.exportManifestRef.detachedManifestSha256,
    };
    expectedRefs.set(registeredAffectedArtifactRefKey(exportRef), exportRef);
    for (const obligation of checkpoint.rawPurgeObligations) {
      expectedRefs.set(
        registeredAffectedArtifactRefKey(obligation.frameRef),
        obligation.frameRef,
      );
    }
  }
  const actualRefs = input.deletionReceipts.flatMap((receipt) =>
    receipt.affectedArtifactRefs.map((reference) => ({ receipt, reference })),
  );
  const actualKeys = actualRefs.map(({ reference }) =>
    registeredAffectedArtifactRefKey(reference),
  );
  if (
    new Set(actualKeys).size !== actualKeys.length ||
    expectedRefs.size !== actualKeys.length ||
    [...expectedRefs.keys()].some((key) => !actualKeys.includes(key))
  ) {
    return false;
  }
  return attestationValue.checkpoints.every((checkpoint) =>
    checkpoint.rawPurgeObligations.every((obligation) => {
      const frameKey = registeredAffectedArtifactRefKey(obligation.frameRef);
      const exportKey = registeredAffectedArtifactRefKey({
        artifactType: "dayflow-export-manifest",
        schemaVersion: obligation.exportManifestRef.schemaVersion,
        artifactId: obligation.exportManifestRef.exportId,
        artifactSha256:
          obligation.exportManifestRef.detachedManifestSha256,
      });
      const receipt = input.deletionReceipts.find((candidate) => {
        const keys = candidate.affectedArtifactRefs.map(
          registeredAffectedArtifactRefKey,
        );
        return keys.includes(frameKey) && keys.includes(exportKey);
      });
      return (
        receipt !== undefined &&
        receipt.dataOrigin === "live" &&
        receipt.studyPhase === "private_pilot" &&
        receipt.studyProtocolHash === attestationValue.studyProtocolHash &&
        ["deleted", "not-present"].includes(receipt.blabaseRawCopyStatus) &&
        ["deleted", "not-present"].includes(
          receipt.dayflowCanonicalSourceStatus,
        ) &&
        receipt.blabaseRawCopyPurgedAt !== undefined &&
        receipt.dayflowCanonicalSourcePurgedAt !== undefined &&
        receipt.blabaseRawCopyPurgedAt >= attestationValue.verifiedAt &&
        receipt.dayflowCanonicalSourcePurgedAt >=
          attestationValue.verifiedAt &&
        receipt.blabaseRawCopyPurgedAt <=
          obligation.blabaseRawCopyDeleteBy &&
        receipt.dayflowCanonicalSourcePurgedAt <=
          obligation.dayflowCanonicalSourceDeleteBy &&
        receipt.createdAt <= input.pilotApproval.approvedAt
      );
    }),
  );
}

export function validateResolvedDayflowDatasetDag(
  value: unknown,
  resolver: DayflowDatasetDagResolver,
): boolean {
  return verifyResolvedDayflowDatasetDag(value, resolver).valid;
}

const rankAcceptabilitySchema = z
  .object({
    rank: boundedJsonUnsignedIntegerSchema(3, 1),
    outputItemId: evidenceIdSchema,
    acceptable: z.enum(["yes", "no"]),
  })
  .strict();
const outputReviewCommon = {
  reviewSchemaVersion: z.literal("dayflow-ablation-output-review-v0.2"),
  reviewId: evidenceIdSchema,
  evalId: evidenceIdSchema,
  lineageClass: z.literal("evidence"),
  dataOrigin: dataOriginSchema,
  studyPhase: studyPhaseSchema,
  studyProtocolHash: sha256HexSchema,
  checkpointId: evidenceIdSchema,
  runId: evidenceIdSchema,
  reviewerPseudonym: evidenceIdSchema,
  reviewedAt: utcTimestampSchema,
  committedAt: utcTimestampSchema,
  commitSequence: canonicalDecimalStringSchema,
  rankAcceptability: z.array(rankAcceptabilitySchema).max(3),
  specificity: boundedJsonUnsignedIntegerSchema(3),
  nextActionClarity: boundedJsonUnsignedIntegerSchema(3),
  correctness: boundedJsonUnsignedIntegerSchema(3),
  timeliness: boundedJsonUnsignedIntegerSchema(3),
  privacyConcern: z.enum(["none", "possible", "confirmed"]),
  unsupportedClaimCodes: z.array(issueCodeSchema).max(64),
  wrongIdentity: z.boolean(),
  staleOrCompletedResurfaced: z.boolean(),
  reviewerNote: reasonTextSchema.optional(),
  outputReviewSha256: sha256HexSchema,
} as const;

export const outputReviewSchema = z
  .union([
    z
      .object({
        ...outputReviewCommon,
        queue: z.literal("causal-blind"),
        arm: z.enum(["A1", "B"]),
        comparisonGroupId: evidenceIdSchema,
        opaqueSlot: z.enum(["left", "right"]),
        permutationRef: z
          .object({ version: schemaVersionSchema, hash: sha256HexSchema })
          .strict(),
        sourceArmGuess: z.enum(["A1", "B", "unsure"]),
        sourceArmGuessConfidenceBasisPoints: basisPointsSchema,
      })
      .strict(),
    z
      .object({
        ...outputReviewCommon,
        queue: z.literal("reference"),
        arm: z.literal("A0"),
      })
      .strict(),
    z
      .object({
        ...outputReviewCommon,
        queue: z.literal("screen-only"),
        arm: z.literal("C"),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    value.rankAcceptability.forEach((entry, index) => {
      if (entry.rank !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rankAcceptability", index, "rank"],
          message: "ranks must be contiguous from 1",
        });
      }
    });
    addSortedIssue(
      value.unsupportedClaimCodes,
      context,
      (entry) => entry,
      ["unsupportedClaimCodes"],
    );
    if (value.reviewedAt > value.committedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["committedAt"],
        message: "review must precede commit",
      });
    }
    addRegisteredHashIssue(
      "output-review",
      value,
      context,
      "outputReviewSha256",
    );
  });

export const pairPreferenceReviewSchema = z
  .object({
    reviewSchemaVersion: z.literal(
      "dayflow-ablation-pair-preference-review-v0.2",
    ),
    reviewId: evidenceIdSchema,
    evalId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    comparisonGroupId: evidenceIdSchema,
    checkpointId: evidenceIdSchema,
    leftOutputReviewId: evidenceIdSchema,
    rightOutputReviewId: evidenceIdSchema,
    leftRunId: evidenceIdSchema,
    rightRunId: evidenceIdSchema,
    leftOpaqueSlot: z.literal("left"),
    rightOpaqueSlot: z.literal("right"),
    permutationVersion: schemaVersionSchema,
    permutationHash: sha256HexSchema,
    preference: z.enum(["left", "right", "tie", "none"]),
    reviewerPseudonym: evidenceIdSchema,
    reviewedAt: utcTimestampSchema,
    committedAt: utcTimestampSchema,
    commitSequence: canonicalDecimalStringSchema,
    pairPreferenceReviewSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    if (
      value.leftOutputReviewId === value.rightOutputReviewId ||
      value.leftRunId === value.rightRunId ||
      value.reviewedAt > value.committedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rightOutputReviewId"],
        message: "pair sides must be distinct and temporally ordered",
      });
    }
    addRegisteredHashIssue(
      "pair-preference-review",
      value,
      context,
      "pairPreferenceReviewSha256",
    );
  });

export const reviewGroupSchema = z
  .object({
    outputReviews: z.array(outputReviewSchema).length(2),
    pairPreferenceReview: pairPreferenceReviewSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const [left, right] = value.outputReviews;
    const pair = value.pairPreferenceReview;
    if (!left || !right) return;
    if (
      left.queue !== "causal-blind" ||
      right.queue !== "causal-blind" ||
      new Set([left.arm, right.arm]).size !== 2 ||
      left.comparisonGroupId !== pair.comparisonGroupId ||
      right.comparisonGroupId !== pair.comparisonGroupId ||
      left.reviewerPseudonym !== pair.reviewerPseudonym ||
      right.reviewerPseudonym !== pair.reviewerPseudonym ||
      left.checkpointId !== pair.checkpointId ||
      right.checkpointId !== pair.checkpointId ||
      left.studyProtocolHash !== pair.studyProtocolHash ||
      right.studyProtocolHash !== pair.studyProtocolHash ||
      BigInt(left.commitSequence) >= BigInt(pair.commitSequence) ||
      BigInt(right.commitSequence) >= BigInt(pair.commitSequence) ||
      left.committedAt > pair.committedAt ||
      right.committedAt > pair.committedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pairPreferenceReview"],
        message: "blind review group is not a valid A1/B pair",
      });
    }
    const bySlot = new Map(
      value.outputReviews
        .filter((review) => review.queue === "causal-blind")
        .map((review) => [review.opaqueSlot, review]),
    );
    if (
      bySlot.get("left")?.reviewId !== pair.leftOutputReviewId ||
      bySlot.get("right")?.reviewId !== pair.rightOutputReviewId ||
      bySlot.get("left")?.runId !== pair.leftRunId ||
      bySlot.get("right")?.runId !== pair.rightRunId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pairPreferenceReview"],
        message: "pair orientation does not match opaque review slots",
      });
    }
  });

export const deletionReceiptSchema = z
  .object({
    deletionReceiptSchemaVersion: z.literal(
      "dayflow-ablation-deletion-receipt-v0.1",
    ),
    deletionReceiptId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    affectedArtifactRefs: z.array(affectedArtifactRefSchema).min(1).max(256),
    blabaseRawCopyStatus: z.enum(["deleted", "not-present", "pending", "failed"]),
    blabaseRawCopyPurgedAt: utcTimestampSchema.optional(),
    dayflowCanonicalSourceStatus: z.enum([
      "deleted",
      "not-present",
      "retained-under-separate-explicit-approval",
      "pending",
      "failed",
    ]),
    dayflowCanonicalSourcePurgedAt: utcTimestampSchema.optional(),
    dayflowCanonicalRetentionExceptionRef: z
      .object({
        schemaVersion: z.literal("dayflow-ablation-human-approval-v0.1"),
        approvalType: z.literal("H-EXCEPTION"),
        approvalRecordId: evidenceIdSchema,
        approvalRecordSha256: sha256HexSchema,
      })
      .strict()
      .optional(),
    createdAt: utcTimestampSchema,
    deletionReceiptSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addSortedIssue(
      value.affectedArtifactRefs,
      context,
      (entry) =>
        `${entry.artifactType}\u0000${entry.schemaVersion}\u0000${entry.artifactId}\u0000${entry.artifactSha256}`,
      ["affectedArtifactRefs"],
    );
    const retained =
      value.dayflowCanonicalSourceStatus ===
      "retained-under-separate-explicit-approval";
    if (retained !== Boolean(value.dayflowCanonicalRetentionExceptionRef)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayflowCanonicalRetentionExceptionRef"],
        message: "retention exception is required only for explicitly retained source",
      });
    }
    if (
      (["deleted", "not-present"] as const).includes(
        value.blabaseRawCopyStatus as "deleted" | "not-present",
      ) !== Boolean(value.blabaseRawCopyPurgedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blabaseRawCopyPurgedAt"],
        message: "purge timestamp must match final raw-copy state",
      });
    }
    if (
      (["deleted", "not-present"] as const).includes(
        value.dayflowCanonicalSourceStatus as "deleted" | "not-present",
      ) !== Boolean(value.dayflowCanonicalSourcePurgedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayflowCanonicalSourcePurgedAt"],
        message: "purge timestamp must match final canonical-source state",
      });
    }
    if (
      (value.blabaseRawCopyPurgedAt !== undefined &&
        value.blabaseRawCopyPurgedAt > value.createdAt) ||
      (value.dayflowCanonicalSourcePurgedAt !== undefined &&
        value.dayflowCanonicalSourcePurgedAt > value.createdAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["createdAt"],
        message: "deletion receipt must be created after its purge events",
      });
    }
    addRegisteredHashIssue(
      "deletion-receipt",
      value,
      context,
      "deletionReceiptSha256",
    );
  });

const metricRateSchema = z
  .object({
    acceptableCount: counterSchema,
    eligibleCount: counterSchema,
    excludedCount: counterSchema,
    rate: z.string().regex(/^(?:0|1|0\.[0-9]{1,6})$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptableCount > value.eligibleCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptableCount"],
        message: "acceptable count cannot exceed eligible count",
      });
    }
    const numerator = BigInt(value.acceptableCount);
    const denominator = BigInt(value.eligibleCount);
    const scaled =
      denominator === 0n
        ? 0n
        : (numerator * 1_000_000n + denominator / 2n) / denominator;
    const expectedRate =
      scaled === 0n
        ? "0"
        : scaled === 1_000_000n
          ? "1"
          : `0.${scaled.toString().padStart(6, "0")}`;
    if (value.rate !== expectedRate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rate"],
        message: "rate must be the canonical six-decimal half-up ratio",
      });
    }
  });
const armMetricsSchema = z
  .object({ acceptableAt1: metricRateSchema, acceptableAt3: metricRateSchema })
  .strict()
  .superRefine((value, context) => {
    if (
      value.acceptableAt1.eligibleCount !==
        value.acceptableAt3.eligibleCount ||
      value.acceptableAt1.excludedCount !==
        value.acceptableAt3.excludedCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptableAt3", "eligibleCount"],
        message: "At1 and At3 must use the same eligible/excluded denominator",
      });
    }
    if (
      value.acceptableAt1.acceptableCount >
      value.acceptableAt3.acceptableCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptableAt3", "acceptableCount"],
        message: "acceptable@1 cannot exceed acceptable@3",
      });
    }
  });

export const aggregateSchema = z
  .object({
    aggregateSchemaVersion: z.literal("dayflow-ablation-aggregate-v0.1"),
    analysisId: evidenceIdSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    finalDatasetBindingId: evidenceIdSchema,
    finalDatasetBindingSha256: sha256HexSchema,
    datasetVersion: schemaVersionSchema,
    datasetSha256: sha256HexSchema,
    claimScope: ineligibleClaimsSchema,
    metrics: z
      .object({
        byArm: z
          .object({
            A0: armMetricsSchema,
            A1: armMetricsSchema,
            B: armMetricsSchema,
            C: armMetricsSchema,
          })
          .strict(),
      })
      .strict(),
    aggregateSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasValidEvidenceOriginPhase(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "ORIGIN_PHASE_MISMATCH",
      });
    }
    addRegisteredHashIssue("aggregate", value, context, "aggregateSha256");
  });

const evidenceBoundaryVectorSchema = z
  .object({
    vectorId: evidenceIdSchema,
    vectorKind: z.enum(["observed", "valid_empty", "failure"]),
    syntheticSentinel: z.literal("SYNTHETIC_DAYFLOW_FIXTURE_DO_NOT_USE_AS_HUMAN_DATA"),
    fixtureSha256: sha256HexSchema,
    expectedDisposition: z.enum(["accepted", "empty", "rejected"]),
    expectedIssueCodes: z.array(issueCodeSchema).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.vectorKind === "observed"
        ? "accepted"
        : value.vectorKind === "valid_empty"
          ? "empty"
          : "rejected";
    if (value.expectedDisposition !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedDisposition"],
        message: "evidence vector disposition does not match kind",
      });
    }
    if (
      (value.vectorKind === "failure") !== (value.expectedIssueCodes.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedIssueCodes"],
        message: "only failure vectors carry issue codes",
      });
    }
  });

const aggregateA1ArmInputSchema = armInputSchema.pipe(a1ArmInputSchema);
const aggregateBArmInputSchema = armInputSchema.pipe(bArmInputSchema);
const matchedInputVectorSchema = z
  .object({
    vectorId: evidenceIdSchema,
    a1Input: aggregateA1ArmInputSchema,
    bInput: aggregateBArmInputSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!validateMatchedA1BInputs(value.a1Input, value.bInput)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bInput"],
        message: "A1/B inputs are not causally matched",
      });
    }
  });

export const dayflowAblationSyntheticConfigSchema = z
  .object({
    configSchemaVersion: z.literal("dayflow-evidence-ablation-config-v0.2"),
    configId: evidenceIdSchema,
    dataOrigin: z.literal("synthetic"),
    studyPhase: z.literal("contract_conformance"),
    studyProtocolHash: sha256HexSchema,
    syntheticSentinel: z.literal("SYNTHETIC_DAYFLOW_FIXTURE_DO_NOT_USE_AS_HUMAN_DATA"),
    generationTuple: deterministicFixtureTupleSchema,
    claimEligibility: ineligibleClaimsSchema,
    rawHumanContentIncluded: z.literal(false),
    liveCaptureAllowed: z.literal(false),
    networkProviderCallsAllowed: z.literal(false),
    registry: z.array(dayflowAblationRegistryEntrySchema).length(
      DAYFLOW_ABLATION_ARTIFACT_REGISTRY.length,
    ),
    fixtureGeneratorConfigSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (JSON.stringify(value.registry) !== JSON.stringify(dayflowAblationArtifactRegistry)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registry"],
        message: "fixture registry must equal the closed candidate registry",
      });
    }
    if (
      value.generationTuple.fixtureGeneratorConfigSha256 !==
      value.fixtureGeneratorConfigSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generationTuple", "fixtureGeneratorConfigSha256"],
        message: "generator config hash mismatch",
      });
    }
  });

export const dayflowAblationSyntheticCasesSchema = z
  .object({
    casesSchemaVersion: z.literal("dayflow-evidence-ablation-cases-v0.2"),
    fixtureSetId: evidenceIdSchema,
    dataOrigin: z.literal("synthetic"),
    studyPhase: z.literal("contract_conformance"),
    studyProtocolHash: sha256HexSchema,
    syntheticSentinel: z.literal("SYNTHETIC_DAYFLOW_FIXTURE_DO_NOT_USE_AS_HUMAN_DATA"),
    fixtureGenerator: z
      .object({
        version: schemaVersionSchema,
        seed: safeTextSchema,
        configSha256: sha256HexSchema,
        syntheticOnly: z.literal(true),
      })
      .strict(),
    rawHumanContentIncluded: z.literal(false),
    humanConversationIncluded: z.literal(false),
    screenshotBlobIncluded: z.literal(false),
    filesystemPathIncluded: z.literal(false),
    secretIncluded: z.literal(false),
    evidenceBoundaryVectors: z.array(evidenceBoundaryVectorSchema).length(3),
    matchedInputVectors: z.array(matchedInputVectorSchema).min(1).max(8),
    dagVectors: z.array(dayflowDatasetDagSchema).min(1).max(8),
    casesSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const kinds = new Set(value.evidenceBoundaryVectors.map((entry) => entry.vectorKind));
    if (
      kinds.size !== 3 ||
      !kinds.has("observed") ||
      !kinds.has("valid_empty") ||
      !kinds.has("failure")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceBoundaryVectors"],
        message: "fixture set requires observed, valid-empty, and failure vectors",
      });
    }
  });

export type DayflowAblationSyntheticConfig = z.infer<
  typeof dayflowAblationSyntheticConfigSchema
>;
export type DayflowAblationSyntheticCases = z.infer<
  typeof dayflowAblationSyntheticCasesSchema
>;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Cross-document validation for the executable, synthetic-only fixture set.
 * Payloads are owned and hash-checked by buildDataset; this contract projects
 * only their vector metadata while still enforcing their nested lineage.
 */
export function validateDayflowAblationSyntheticDataset(
  configValue: unknown,
  casesValue: unknown,
): boolean {
  const config = dayflowAblationSyntheticConfigSchema.safeParse(configValue);
  if (!config.success || !isUnknownRecord(casesValue)) return false;
  const rawVectors = casesValue.evidenceBoundaryVectors;
  if (!Array.isArray(rawVectors)) return false;

  const projectedVectors: unknown[] = [];
  const payloadSnapshotIdentities: Record<string, unknown>[] = [];
  const payloadExportLineages: Record<string, unknown>[] = [];
  for (const vectorValue of rawVectors) {
    if (!isUnknownRecord(vectorValue) || !("payload" in vectorValue)) {
      return false;
    }
    const payload = vectorValue.payload;
    if (!isUnknownRecord(payload) || !isUnknownRecord(payload.exportManifest)) {
      return false;
    }
    const exportManifest = payload.exportManifest;
    if (
      exportManifest.dataOrigin !== "synthetic" ||
      exportManifest.studyPhase !== "contract_conformance" ||
      !isUnknownRecord(exportManifest.databaseSnapshotIdentity) ||
      exportManifest.databaseSnapshotIdentity.snapshotKind !== "synthetic-fixture"
    ) {
      return false;
    }
    payloadSnapshotIdentities.push(exportManifest.databaseSnapshotIdentity);
    payloadExportLineages.push(exportManifest);
    const { payload: _payload, ...metadata } = vectorValue;
    projectedVectors.push(metadata);
  }

  const cases = dayflowAblationSyntheticCasesSchema.safeParse({
    ...casesValue,
    evidenceBoundaryVectors: projectedVectors,
  });
  if (!cases.success) return false;
  if (
    config.data.dataOrigin !== cases.data.dataOrigin ||
    config.data.studyPhase !== cases.data.studyPhase ||
    config.data.studyProtocolHash !== cases.data.studyProtocolHash ||
    config.data.syntheticSentinel !== cases.data.syntheticSentinel ||
    config.data.generationTuple.fixtureGeneratorVersion !==
      cases.data.fixtureGenerator.version ||
    config.data.generationTuple.fixtureGeneratorSeed !==
      cases.data.fixtureGenerator.seed ||
    config.data.generationTuple.fixtureGeneratorConfigSha256 !==
      cases.data.fixtureGenerator.configSha256 ||
    config.data.generationTuple.syntheticOnly !==
      cases.data.fixtureGenerator.syntheticOnly
  ) {
    return false;
  }
  if (
    payloadExportLineages.some(
      (manifest) =>
        manifest.dataOrigin !== cases.data.dataOrigin ||
        manifest.studyPhase !== cases.data.studyPhase ||
        manifest.studyProtocolHash !== cases.data.studyProtocolHash,
    ) ||
    payloadSnapshotIdentities.some(
      (identity) =>
        identity.fixtureSetId !== cases.data.fixtureSetId ||
        identity.fixtureGeneratorVersion !==
          cases.data.fixtureGenerator.version ||
        identity.fixtureGeneratorSeed !== cases.data.fixtureGenerator.seed ||
        identity.fixtureGeneratorConfigSha256 !==
          cases.data.fixtureGenerator.configSha256,
    )
  ) {
    return false;
  }

  const vectorIds = cases.data.evidenceBoundaryVectors.map(
    (vector) => vector.vectorId,
  );
  const matchedVectorIds = cases.data.matchedInputVectors.map(
    (vector) => vector.vectorId,
  );
  const generationIds = cases.data.dagVectors.map(
    (dag) => dag.generation.candidateDatasetGenerationId,
  );
  const armInputIds = cases.data.matchedInputVectors.flatMap((vector) => [
    vector.a1Input.armInputId,
    vector.bInput.armInputId,
  ]);
  const allVectorIds = [...vectorIds, ...matchedVectorIds];
  if (
    new Set(allVectorIds).size !== allVectorIds.length ||
    new Set(armInputIds).size !== armInputIds.length ||
    new Set(generationIds).size !== generationIds.length
  ) {
    return false;
  }

  if (
    cases.data.matchedInputVectors.some(
      ({ a1Input, bInput }) =>
        a1Input.dataOrigin !== cases.data.dataOrigin ||
        a1Input.studyPhase !== cases.data.studyPhase ||
        a1Input.studyProtocolHash !== cases.data.studyProtocolHash ||
        bInput.dataOrigin !== cases.data.dataOrigin ||
        bInput.studyPhase !== cases.data.studyPhase ||
        bInput.studyProtocolHash !== cases.data.studyProtocolHash ||
        !validateMatchedA1BInputs(a1Input, bInput),
    ) ||
    cases.data.dagVectors.some(
      (dag) =>
        dag.generation.dataOrigin !== cases.data.dataOrigin ||
        dag.generation.studyPhase !== cases.data.studyPhase ||
        dag.generation.studyProtocolHash !== cases.data.studyProtocolHash ||
        !validateDayflowDatasetDag(dag),
    )
  ) {
    return false;
  }
  return true;
}

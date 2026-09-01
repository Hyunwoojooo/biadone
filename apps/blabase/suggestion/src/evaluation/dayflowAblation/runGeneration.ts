import { createHash } from "node:crypto";

import { z } from "zod";

import {
  activeAttentionResultSchema,
  activeAttentionResultSha256,
  verifyActiveAttentionResultIntegrity,
  type ActiveAttentionResult,
} from "../../attentionDecision";
import {
  domainSeparatedSha256,
  hashRegisteredArtifact,
  jcsCanonicalize,
  semanticOutputSchema,
  semanticOutputSha256,
  utcTimestampSchema,
  verifyResolvedNormalizedEvidence,
  type DayflowNormalizedEvidence,
  type SemanticOutput,
} from "../../dayflowEvidence/contracts";
import {
  a1ArmInputSchema,
  bArmInputSchema,
  cArmInputSchema,
  requestIssuanceReceiptSchema,
  runSchema,
} from "./contracts";
import { isLauncherWorkBoardPublicTitleSafe } from "../../launcher/workBoardTextSafety";
import { isWorkSuggestionBoardPublicOutputTextSafe } from "../../suggestionBoard/publicTextSafety";

export const DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION =
  "dayflow-e1-deterministic-arm-runner-v0.1" as const;
export const DAYFLOW_E1_AB_RENDERER_VERSION =
  "dayflow-e1-ab-renderer-v0.1" as const;
export const DAYFLOW_E1_C_RENDERER_VERSION =
  "dayflow-e1-c-renderer-v0.1" as const;
export const DAYFLOW_E1_SCREEN_ELIGIBILITY_VERSION =
  "dayflow-e1-screen-eligibility-v0.1" as const;
export const DAYFLOW_E1_PUBLIC_TEXT_GUARD_VERSION =
  "dayflow-e1-public-text-guard-v0.1" as const;
export const DAYFLOW_E1_PRESENTATION_VERSION =
  "dayflow-e1-display-only-presentation-v0.1" as const;

const SCREEN_CAVEATS = [
  "NOT_ACTIONABLE",
  "NOT_COMPLETION_EVIDENCE",
  "SCREEN_CONTEXT_ONLY",
] as const;
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const encoder = new TextEncoder();

type ResolvedVerificationInput = Parameters<
  typeof verifyResolvedNormalizedEvidence
>[0];

export type DayflowE1ResolvedScreenEvidenceInput =
  | Readonly<{ state: "unavailable" }>
  | Readonly<{ state: "rejected" }>
  | Readonly<{ state: "failure" }>
  | Readonly<{
      state: "available";
      asOf: string;
      evidence: unknown;
      resolvedExportManifests: ResolvedVerificationInput["resolvedExportManifests"];
      resolvedArtifacts: ResolvedVerificationInput["resolvedArtifacts"];
      artifactBlobs: ResolvedVerificationInput["artifactBlobs"];
      normalizedTexts: ResolvedVerificationInput["normalizedTexts"];
    }>;

export type DayflowE1A1RenderInput = Readonly<{
  activeAttentionResult: unknown;
  currentAttentionResultHash: string;
}>;

export type DayflowE1BRenderInput = Readonly<{
  activeAttentionResult: unknown;
  currentAttentionResultHash: string;
  screenContext: DayflowE1ResolvedScreenEvidenceInput;
}>;

export type DayflowE1CRenderInput = Readonly<{
  screenContext: DayflowE1ResolvedScreenEvidenceInput;
}>;

type DayflowE1SemanticPayload = Readonly<{
  semanticOutput: SemanticOutput;
  semanticOutputBytes: Uint8Array;
  semanticOutputSha256: string;
}>;

type DayflowE1CommonMetadata = Readonly<{
  runnerVersion: typeof DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION;
  screenEligibilityVersion: typeof DAYFLOW_E1_SCREEN_ELIGIBILITY_VERSION;
  publicTextGuardVersion: typeof DAYFLOW_E1_PUBLIC_TEXT_GUARD_VERSION;
  presentationVersion: typeof DAYFLOW_E1_PRESENTATION_VERSION;
}>;

export type DayflowE1A1RenderResult = DayflowE1SemanticPayload &
  DayflowE1CommonMetadata &
  Readonly<{
    armId: "A1";
    rendererVersion: typeof DAYFLOW_E1_AB_RENDERER_VERSION;
    outcome: "rendered" | "no_suggestion";
  }>;

export const DAYFLOW_E1_B_FALLBACK_CODES = [
  "SCREEN_CONTEXT_EXPIRED",
  "SCREEN_CONTEXT_FAILURE",
  "SCREEN_CONTEXT_INVALID",
  "SCREEN_CONTEXT_LOW_CONFIDENCE",
  "SCREEN_CONTEXT_NO_CONTEXT",
  "SCREEN_CONTEXT_REJECTED",
  "SCREEN_CONTEXT_UNAVAILABLE",
  "SCREEN_CONTEXT_UNSAFE",
  "SCREEN_CONTEXT_VALID_EMPTY",
] as const;
export type DayflowE1BFallbackCode =
  (typeof DAYFLOW_E1_B_FALLBACK_CODES)[number];

export type DayflowE1BRenderResult = DayflowE1SemanticPayload &
  DayflowE1CommonMetadata &
  Readonly<{
    armId: "B";
    rendererVersion: typeof DAYFLOW_E1_AB_RENDERER_VERSION;
    outcome: "rendered" | "fallback";
    fallbackCodes: readonly DayflowE1BFallbackCode[];
  }>;

export const DAYFLOW_E1_C_FAILURE_CODES = [
  "SCREEN_CONTEXT_CLAIM_LINEAGE_INVALID",
  "SCREEN_CONTEXT_EXPIRED",
  "SCREEN_CONTEXT_FAILURE",
  "SCREEN_CONTEXT_INVALID",
  "SCREEN_CONTEXT_REJECTED",
  "SCREEN_CONTEXT_UNAVAILABLE",
  "SCREEN_CONTEXT_UNSAFE",
] as const;
export type DayflowE1CFailureCode =
  (typeof DAYFLOW_E1_C_FAILURE_CODES)[number];

export type DayflowE1CRenderResult =
  | (DayflowE1SemanticPayload &
      DayflowE1CommonMetadata &
      Readonly<{
        armId: "C";
        rendererVersion: typeof DAYFLOW_E1_C_RENDERER_VERSION;
        outcome: "rendered" | "no_suggestion";
        failureCodes: readonly [];
      }>)
  | (DayflowE1CommonMetadata &
      Readonly<{
        armId: "C";
        rendererVersion: typeof DAYFLOW_E1_C_RENDERER_VERSION;
        outcome: "failure";
        failureCodes: readonly DayflowE1CFailureCode[];
        semanticOutput: null;
        semanticOutputBytes: null;
        semanticOutputSha256: null;
      }>);

export type DayflowE1BlindReviewProjection = readonly Readonly<{
  title: string;
  summary: string;
  caveatCodes: readonly string[];
}>[];

const COMMON_METADATA: DayflowE1CommonMetadata = {
  runnerVersion: DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION,
  screenEligibilityVersion: DAYFLOW_E1_SCREEN_ELIGIBILITY_VERSION,
  publicTextGuardVersion: DAYFLOW_E1_PUBLIC_TEXT_GUARD_VERSION,
  presentationVersion: DAYFLOW_E1_PRESENTATION_VERSION,
};

type ScreenResolutionCode =
  | "SCREEN_CONTEXT_EXPIRED"
  | "SCREEN_CONTEXT_FAILURE"
  | "SCREEN_CONTEXT_INVALID"
  | "SCREEN_CONTEXT_REJECTED"
  | "SCREEN_CONTEXT_UNAVAILABLE";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireExactKeys(
  candidate: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts candidate is Record<string, unknown> {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  const actualKeys = Object.keys(candidate).sort(compareStrings);
  const expected = [...expectedKeys].sort(compareStrings);
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStrings);
}

function parseActiveAttention(
  input: DayflowE1A1RenderInput,
): ActiveAttentionResult {
  requireExactKeys(
    input,
    ["activeAttentionResult", "currentAttentionResultHash"],
    "A1 renderer input",
  );
  const expectedHash = sha256HexSchema.parse(
    input.currentAttentionResultHash,
  );
  const result = activeAttentionResultSchema.parse(
    input.activeAttentionResult,
  );
  if (
    !verifyActiveAttentionResultIntegrity(result) ||
    result.resultSha256 !== expectedHash ||
    activeAttentionResultSha256(result) !== expectedHash
  ) {
    throw new TypeError(
      "Active Attention result does not match the checkpoint hash",
    );
  }
  return result;
}

function isEligibleTitle(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 120 &&
    isWorkSuggestionBoardPublicOutputTextSafe(value) &&
    isLauncherWorkBoardPublicTitleSafe(value)
  );
}

function isEligibleSummary(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 500 &&
    isWorkSuggestionBoardPublicOutputTextSafe(value)
  );
}

function sealSemanticOutput(candidate: unknown): DayflowE1SemanticPayload {
  const semanticOutput = semanticOutputSchema.parse(candidate);
  const semanticOutputBytes = encoder.encode(
    `${jcsCanonicalize(semanticOutput)}\n`,
  );
  return {
    semanticOutput,
    semanticOutputBytes,
    semanticOutputSha256: semanticOutputSha256(semanticOutput),
  };
}

function renderSharedA1Payload(
  input: DayflowE1A1RenderInput,
): DayflowE1SemanticPayload {
  const result = parseActiveAttention(input);
  const candidates =
    result.decision.status === "suggested"
      ? [
          ...(result.decision.topSuggestion === null
            ? []
            : [result.decision.topSuggestion]),
          ...result.decision.alternatives,
        ]
      : [];
  const items = candidates
    .filter(
      (candidate) =>
        isEligibleTitle(candidate.title) &&
        isEligibleSummary(candidate.explanation),
    )
    .map((candidate, index) => ({
      position: index + 1,
      title: candidate.title,
      summary: candidate.explanation,
      caveatCodes: [],
      claimIds: [],
    }));
  return sealSemanticOutput({
    schemaVersion: "dayflow-ablation-semantic-output-v0.1",
    presentationMode: "display_only",
    status:
      items.length === 0 ? "no_suggestion" : "suggestions_available",
    items,
  });
}

export function renderDayflowE1A1SemanticOutput(
  input: DayflowE1A1RenderInput,
): DayflowE1A1RenderResult {
  const payload = renderSharedA1Payload(input);
  return {
    ...COMMON_METADATA,
    armId: "A1",
    rendererVersion: DAYFLOW_E1_AB_RENDERER_VERSION,
    outcome:
      payload.semanticOutput.status === "no_suggestion"
        ? "no_suggestion"
        : "rendered",
    ...payload,
  };
}

type ScreenContextResolution =
  | Readonly<{ valid: true; evidence: DayflowNormalizedEvidence }>
  | Readonly<{ valid: false; code: ScreenResolutionCode }>;

function resolveScreenContext(
  input: DayflowE1ResolvedScreenEvidenceInput,
): ScreenContextResolution {
  if (input.state === "unavailable") {
    requireExactKeys(input, ["state"], "Unavailable screen context");
    return { valid: false, code: "SCREEN_CONTEXT_UNAVAILABLE" };
  }
  if (input.state === "rejected") {
    requireExactKeys(input, ["state"], "Rejected screen context");
    return { valid: false, code: "SCREEN_CONTEXT_REJECTED" };
  }
  if (input.state === "failure") {
    requireExactKeys(input, ["state"], "Failed screen context");
    return { valid: false, code: "SCREEN_CONTEXT_FAILURE" };
  }
  requireExactKeys(
    input,
    [
      "state",
      "asOf",
      "evidence",
      "resolvedExportManifests",
      "resolvedArtifacts",
      "artifactBlobs",
      "normalizedTexts",
    ],
    "Available screen context",
  );
  const asOf = utcTimestampSchema.safeParse(input.asOf);
  if (!asOf.success) {
    return { valid: false, code: "SCREEN_CONTEXT_INVALID" };
  }
  const verification = verifyResolvedNormalizedEvidence({
    evidence: input.evidence,
    resolvedExportManifests: input.resolvedExportManifests,
    resolvedArtifacts: input.resolvedArtifacts,
    artifactBlobs: input.artifactBlobs,
    normalizedTexts: input.normalizedTexts,
  });
  if (!verification.valid) {
    return { valid: false, code: "SCREEN_CONTEXT_INVALID" };
  }
  const evidence = verification.evidence;
  if (evidence.verificationStatus === "rejected") {
    return { valid: false, code: "SCREEN_CONTEXT_REJECTED" };
  }
  if (evidence.verificationStatus === "unavailable") {
    return { valid: false, code: "SCREEN_CONTEXT_UNAVAILABLE" };
  }
  if (evidence.coverageCode === "failure") {
    return { valid: false, code: "SCREEN_CONTEXT_FAILURE" };
  }
  if (evidence.expiresAt <= asOf.data) {
    return { valid: false, code: "SCREEN_CONTEXT_EXPIRED" };
  }
  return { valid: true, evidence };
}

function bFallback(
  a1: DayflowE1A1RenderResult,
  code: DayflowE1BFallbackCode,
): DayflowE1BRenderResult {
  return {
    ...a1,
    armId: "B",
    rendererVersion: DAYFLOW_E1_AB_RENDERER_VERSION,
    outcome: "fallback",
    fallbackCodes: sortedUnique([code]),
  };
}

function screenClaimPriority(
  value: DayflowNormalizedEvidence["acceptedClaims"][number]["claimClass"],
): number {
  return value === "RECENT_FOCUS"
    ? 0
    : value === "VISIBLE_TASK_INTENT"
      ? 1
      : 2;
}

function summaryItemIndex(outputFieldPath: string): number | null {
  const match = /^\/items\/(0|1|2)\/summary$/u.exec(outputFieldPath);
  return match === null ? null : Number(match[1]);
}

export function renderDayflowE1BSemanticOutput(
  input: DayflowE1BRenderInput,
): DayflowE1BRenderResult {
  requireExactKeys(
    input,
    [
      "activeAttentionResult",
      "currentAttentionResultHash",
      "screenContext",
    ],
    "B renderer input",
  );
  const a1 = renderDayflowE1A1SemanticOutput({
    activeAttentionResult: input.activeAttentionResult,
    currentAttentionResultHash: input.currentAttentionResultHash,
  });
  const resolution = resolveScreenContext(input.screenContext);
  if (!resolution.valid) {
    return bFallback(a1, resolution.code);
  }
  if (a1.semanticOutput.items.length === 0) {
    return bFallback(a1, "SCREEN_CONTEXT_NO_CONTEXT");
  }
  const evidence = resolution.evidence;
  if (
    evidence.semanticOutput.status === "no_suggestion" ||
    evidence.semanticOutput.items.length === 0
  ) {
    return bFallback(a1, "SCREEN_CONTEXT_VALID_EMPTY");
  }
  const conflictedPaths = new Set(
    evidence.conflictingClaims.map(
      (conflict) => conflict.outputFieldPath,
    ),
  );
  const classEligible = evidence.acceptedClaims.filter(
    (claim) =>
      (claim.claimClass === "RECENT_FOCUS" ||
        claim.claimClass === "VISIBLE_TASK_INTENT") &&
      summaryItemIndex(claim.outputFieldPath) !== null &&
      !conflictedPaths.has(claim.outputFieldPath),
  );
  const confidenceEligible = classEligible.filter(
    (claim) => claim.confidenceBasisPoints >= 8_000,
  );
  if (confidenceEligible.length === 0) {
    return bFallback(
      a1,
      classEligible.length === 0
        ? "SCREEN_CONTEXT_NO_CONTEXT"
        : "SCREEN_CONTEXT_LOW_CONFIDENCE",
    );
  }
  const selected = [...confidenceEligible].sort((left, right) => {
    const priority =
      screenClaimPriority(left.claimClass) -
      screenClaimPriority(right.claimClass);
    return (
      priority ||
      compareStrings(left.outputFieldPath, right.outputFieldPath) ||
      compareStrings(left.claimId, right.claimId)
    );
  })[0]!;
  const index = summaryItemIndex(selected.outputFieldPath);
  const screenItem =
    index === null ? undefined : evidence.semanticOutput.items[index];
  if (
    screenItem === undefined ||
    !screenItem.claimIds.includes(selected.claimId) ||
    !isEligibleSummary(screenItem.summary)
  ) {
    return bFallback(a1, "SCREEN_CONTEXT_UNSAFE");
  }
  const first = a1.semanticOutput.items[0]!;
  const combinedSummary =
    `${first.summary} 화면 맥락: ${screenItem.summary} ` +
    "(화면 표시는 완료·검증 근거가 아닙니다.)";
  if (!isEligibleSummary(combinedSummary)) {
    return bFallback(a1, "SCREEN_CONTEXT_UNSAFE");
  }
  const payload = sealSemanticOutput({
    ...a1.semanticOutput,
    items: a1.semanticOutput.items.map((item, itemIndex) =>
      itemIndex === 0
        ? {
            ...item,
            summary: combinedSummary,
            caveatCodes: sortedUnique([
              ...item.caveatCodes,
              ...SCREEN_CAVEATS,
            ]),
            claimIds: sortedUnique([
              ...item.claimIds,
              selected.claimId,
            ]),
          }
        : item,
    ),
  });
  return {
    ...COMMON_METADATA,
    armId: "B",
    rendererVersion: DAYFLOW_E1_AB_RENDERER_VERSION,
    outcome: "rendered",
    fallbackCodes: [],
    ...payload,
  };
}

function cFailure(
  code: DayflowE1CFailureCode,
): DayflowE1CRenderResult {
  return {
    ...COMMON_METADATA,
    armId: "C",
    rendererVersion: DAYFLOW_E1_C_RENDERER_VERSION,
    outcome: "failure",
    failureCodes: sortedUnique([code]),
    semanticOutput: null,
    semanticOutputBytes: null,
    semanticOutputSha256: null,
  };
}

function exactEligibleLeafClaim(
  evidence: DayflowNormalizedEvidence,
  itemIndex: number,
  leaf: "title" | "summary",
): DayflowNormalizedEvidence["acceptedClaims"][number] | null {
  const path = `/items/${itemIndex}/${leaf}`;
  if (
    evidence.conflictingClaims.some(
      (conflict) => conflict.outputFieldPath === path,
    )
  ) {
    return null;
  }
  const matches = evidence.acceptedClaims.filter(
    (claim) => claim.outputFieldPath === path,
  );
  if (matches.length !== 1) return null;
  const claim = matches[0]!;
  return (claim.claimClass === "RECENT_FOCUS" ||
    claim.claimClass === "VISIBLE_TASK_INTENT") &&
    claim.confidenceBasisPoints >= 8_000
    ? claim
    : null;
}

export function renderDayflowE1CSemanticOutput(
  input: DayflowE1CRenderInput,
): DayflowE1CRenderResult {
  requireExactKeys(input, ["screenContext"], "C renderer input");
  const resolution = resolveScreenContext(input.screenContext);
  if (!resolution.valid) {
    return cFailure(resolution.code);
  }
  const evidence = resolution.evidence;
  if (evidence.semanticOutput.status === "no_suggestion") {
    const payload = sealSemanticOutput(evidence.semanticOutput);
    return {
      ...COMMON_METADATA,
      armId: "C",
      rendererVersion: DAYFLOW_E1_C_RENDERER_VERSION,
      outcome: "no_suggestion",
      failureCodes: [],
      ...payload,
    };
  }
  const items: SemanticOutput["items"][number][] = [];
  for (const [index, item] of evidence.semanticOutput.items.entries()) {
    if (
      !isEligibleTitle(item.title) ||
      !isEligibleSummary(item.summary)
    ) {
      return cFailure("SCREEN_CONTEXT_UNSAFE");
    }
    const titleClaim = exactEligibleLeafClaim(
      evidence,
      index,
      "title",
    );
    const summaryClaim = exactEligibleLeafClaim(
      evidence,
      index,
      "summary",
    );
    if (
      titleClaim === null ||
      summaryClaim === null ||
      !item.claimIds.includes(titleClaim.claimId) ||
      !item.claimIds.includes(summaryClaim.claimId)
    ) {
      return cFailure("SCREEN_CONTEXT_CLAIM_LINEAGE_INVALID");
    }
    items.push({
      ...item,
      caveatCodes: sortedUnique([
        ...item.caveatCodes,
        ...SCREEN_CAVEATS,
      ]),
      claimIds: sortedUnique([
        titleClaim.claimId,
        summaryClaim.claimId,
      ]),
    });
  }
  const payload = sealSemanticOutput({
    ...evidence.semanticOutput,
    items,
  });
  return {
    ...COMMON_METADATA,
    armId: "C",
    rendererVersion: DAYFLOW_E1_C_RENDERER_VERSION,
    outcome: "rendered",
    failureCodes: [],
    ...payload,
  };
}

export const DAYFLOW_E1_DETERMINISTIC_REQUEST_SCHEMA_VERSION =
  "dayflow-e1-deterministic-request-v0.1" as const;
export const DAYFLOW_E1_DETERMINISTIC_REQUEST_HASH_DOMAIN =
  "blabase.dayflow-e1.deterministic-request.v0.1" as const;

type DayflowE1A1ArmInput = z.infer<typeof a1ArmInputSchema>;
type DayflowE1BArmInput = z.infer<typeof bArmInputSchema>;
type DayflowE1CArmInput = z.infer<typeof cArmInputSchema>;
type DayflowE1RequestIssuanceReceipt = z.infer<
  typeof requestIssuanceReceiptSchema
>;

type DayflowE1CausalArmRunBuildInput<
  TArmInput extends DayflowE1A1ArmInput | DayflowE1BArmInput,
  TRenderResult extends DayflowE1A1RenderResult | DayflowE1BRenderResult,
> = Readonly<{
  runId: string;
  armInput: TArmInput;
  requestIssuanceReceipt: DayflowE1RequestIssuanceReceipt;
  renderResult: TRenderResult;
  startedAt: string;
  completedAt: string;
}>;

export type DayflowE1ArmRunBuildInput =
  | DayflowE1CausalArmRunBuildInput<
      DayflowE1A1ArmInput,
      DayflowE1A1RenderResult
    >
  | DayflowE1CausalArmRunBuildInput<
      DayflowE1BArmInput,
      DayflowE1BRenderResult
    >
  | Readonly<{
      runId: string;
      armInput: DayflowE1CArmInput;
      renderResult: DayflowE1CRenderResult;
      startedAt: string;
      completedAt: string;
    }>;

export type DayflowE1ArmRun = z.infer<typeof runSchema>;

type VerifiedDayflowE1RenderResult =
  | Readonly<{
      resultKind: "semantic";
      semanticOutput: z.infer<typeof semanticOutputSchema>;
      semanticOutputSha256: string;
      semanticOutputBytes: Uint8Array;
      validationIssueCodes: readonly string[];
    }>
  | Readonly<{
      resultKind: "failure";
      failureCode: string;
      validationIssueCodes: readonly [string];
    }>;

const DAYFLOW_E1_CAUSAL_RUN_BUILD_KEYS = [
  "armInput",
  "completedAt",
  "renderResult",
  "requestIssuanceReceipt",
  "runId",
  "startedAt",
] as const;
const DAYFLOW_E1_SCREEN_ONLY_RUN_BUILD_KEYS = [
  "armInput",
  "completedAt",
  "renderResult",
  "runId",
  "startedAt",
] as const;

function dayflowE1RunBuildRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertDayflowE1RunBuildKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError("Arm run build input has an invalid key set");
  }
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return jcsCanonicalize(left) === jcsCanonicalize(right);
}

function assertRegisteredArtifactIntegrity(
  artifactClass: string,
  detachedField: string,
  artifact: Readonly<Record<string, unknown>>,
): void {
  if (
    artifact[detachedField] !==
    hashRegisteredArtifact(artifactClass, artifact)
  ) {
    throw new TypeError(`${artifactClass} detached hash mismatch`);
  }
}

function rendererVersionForArm(
  armId: "A1" | "B" | "C",
): typeof DAYFLOW_E1_AB_RENDERER_VERSION | typeof DAYFLOW_E1_C_RENDERER_VERSION {
  return armId === "C"
    ? DAYFLOW_E1_C_RENDERER_VERSION
    : DAYFLOW_E1_AB_RENDERER_VERSION;
}

function assertRenderMetadata(
  value: Record<string, unknown>,
  armId: "A1" | "B" | "C",
): void {
  if (
    value.armId !== armId ||
    value.runnerVersion !== DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION ||
    value.rendererVersion !== rendererVersionForArm(armId) ||
    value.presentationVersion !== DAYFLOW_E1_PRESENTATION_VERSION ||
    value.publicTextGuardVersion !== DAYFLOW_E1_PUBLIC_TEXT_GUARD_VERSION ||
    (armId !== "A1" &&
      value.screenEligibilityVersion !==
        DAYFLOW_E1_SCREEN_ELIGIBILITY_VERSION)
  ) {
    throw new TypeError("Renderer result metadata does not match the arm");
  }
}

function parseSortedDiagnosticCodes(
  value: unknown,
  allowed: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  const codes = value as string[];
  if (codes.some((code) => !allowed.includes(code))) {
    throw new TypeError(`${label} contains an unsupported code`);
  }
  const canonical = [...new Set(codes)].sort();
  if (
    canonical.length !== codes.length ||
    canonical.some((code, index) => code !== codes[index])
  ) {
    throw new TypeError(`${label} must be sorted and unique`);
  }
  return canonical;
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function verifySemanticRenderResult(
  value: Record<string, unknown>,
  armId: "A1" | "B" | "C",
): VerifiedDayflowE1RenderResult {
  assertRenderMetadata(value, armId);

  if (armId === "C" && value.outcome === "failure") {
    const failureCodes = parseSortedDiagnosticCodes(
      value.failureCodes,
      DAYFLOW_E1_C_FAILURE_CODES,
      "C failure codes",
    );
    if (
      failureCodes.length !== 1 ||
      value.semanticOutput !== null ||
      value.semanticOutputSha256 !== null ||
      value.semanticOutputBytes !== null
    ) {
      throw new TypeError("C failure renderer result must contain one failure only");
    }
    return {
      resultKind: "failure",
      failureCode: failureCodes[0]!,
      validationIssueCodes: [failureCodes[0]!],
    };
  }

  const semanticOutput = semanticOutputSchema.parse(value.semanticOutput);
  const expectedSemanticOutputSha256 = semanticOutputSha256(semanticOutput);
  const expectedBytes = new TextEncoder().encode(
    `${jcsCanonicalize(semanticOutput)}\n`,
  );
  if (
    value.semanticOutputSha256 !== expectedSemanticOutputSha256 ||
    !(value.semanticOutputBytes instanceof Uint8Array) ||
    !byteArraysEqual(value.semanticOutputBytes, expectedBytes)
  ) {
    throw new TypeError("Renderer result semantic output integrity mismatch");
  }

  let validationIssueCodes: readonly string[] = [];
  if (armId === "A1") {
    const expectedOutcome =
      semanticOutput.status === "suggestions_available"
        ? "rendered"
        : "no_suggestion";
    if (value.outcome !== expectedOutcome) {
      throw new TypeError("A1 renderer outcome does not match semantic output");
    }
  } else if (armId === "B") {
    const fallbackCodes = parseSortedDiagnosticCodes(
      value.fallbackCodes,
      DAYFLOW_E1_B_FALLBACK_CODES,
      "B fallback codes",
    );
    if (
      (value.outcome === "rendered" &&
        (fallbackCodes.length !== 0 ||
          semanticOutput.status !== "suggestions_available")) ||
      (value.outcome === "fallback" && fallbackCodes.length === 0) ||
      (value.outcome !== "rendered" && value.outcome !== "fallback")
    ) {
      throw new TypeError("B renderer outcome does not match fallback metadata");
    }
    validationIssueCodes = fallbackCodes;
  } else {
    const failureCodes = parseSortedDiagnosticCodes(
      value.failureCodes,
      DAYFLOW_E1_C_FAILURE_CODES,
      "C failure codes",
    );
    const expectedOutcome =
      semanticOutput.status === "suggestions_available"
        ? "rendered"
        : "no_suggestion";
    if (failureCodes.length !== 0 || value.outcome !== expectedOutcome) {
      throw new TypeError("C renderer outcome does not match semantic output");
    }
  }

  return {
    resultKind: "semantic",
    semanticOutput,
    semanticOutputSha256: expectedSemanticOutputSha256,
    semanticOutputBytes: new Uint8Array(expectedBytes),
    validationIssueCodes,
  };
}

function verifyCausalReceipt(
  armInput: DayflowE1A1ArmInput | DayflowE1BArmInput,
  receipt: DayflowE1RequestIssuanceReceipt,
  startedAt: string,
): void {
  const armInputRef = {
    schemaVersion: "dayflow-ablation-arm-input-v0.4" as const,
    armInputId: armInput.armInputId,
    armInputHash: armInput.armInputHash,
  };
  if (
    receipt.dataOrigin !== armInput.dataOrigin ||
    receipt.studyPhase !== armInput.studyPhase ||
    receipt.studyProtocolHash !== armInput.studyProtocolHash ||
    !sameCanonicalValue(
      receipt.requestOrderManifestRef,
      armInput.requestOrderManifestRef,
    ) ||
    receipt.requestId !== armInput.requestId ||
    receipt.position !== armInput.requestPosition ||
    receipt.issuanceSequence !== armInput.requestPosition ||
    !sameCanonicalValue(receipt.armInputRef, armInputRef) ||
    Date.parse(receipt.issuedAt) > Date.parse(startedAt)
  ) {
    throw new TypeError("Request issuance receipt does not match arm input");
  }
}

function requestSha256ForArmInput(
  armInput: DayflowE1A1ArmInput | DayflowE1BArmInput | DayflowE1CArmInput,
): string {
  return domainSeparatedSha256(DAYFLOW_E1_DETERMINISTIC_REQUEST_HASH_DOMAIN, {
    requestSchemaVersion: DAYFLOW_E1_DETERMINISTIC_REQUEST_SCHEMA_VERSION,
    runnerVersion: DAYFLOW_E1_DETERMINISTIC_ARM_RUNNER_VERSION,
    rendererVersion: rendererVersionForArm(armInput.armId),
    armInput,
  });
}

export function buildDayflowE1ArmRun(
  input: DayflowE1ArmRunBuildInput,
): DayflowE1ArmRun {
  const inputRecord = dayflowE1RunBuildRecord(input, "Arm run build input");
  const armInputRecord = dayflowE1RunBuildRecord(
    inputRecord.armInput,
    "Arm input",
  );
  const armId = armInputRecord.armId;
  if (armId !== "A1" && armId !== "B" && armId !== "C") {
    throw new TypeError("Only A1, B, and C deterministic runs are supported");
  }
  assertDayflowE1RunBuildKeys(
    inputRecord,
    armId === "C"
      ? DAYFLOW_E1_SCREEN_ONLY_RUN_BUILD_KEYS
      : DAYFLOW_E1_CAUSAL_RUN_BUILD_KEYS,
  );

  const armInput =
    armId === "A1"
      ? a1ArmInputSchema.parse(inputRecord.armInput)
      : armId === "B"
        ? bArmInputSchema.parse(inputRecord.armInput)
        : cArmInputSchema.parse(inputRecord.armInput);
  assertRegisteredArtifactIntegrity(
    armId === "A1"
      ? "a1-arm-input"
      : armId === "B"
        ? "b-arm-input"
        : "c-arm-input",
    "armInputHash",
    armInput,
  );

  const startedAt = utcTimestampSchema.parse(inputRecord.startedAt);
  const completedAt = utcTimestampSchema.parse(inputRecord.completedAt);
  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);
  const latencyMs = completedAtMs - startedAtMs;
  if (latencyMs < 0 || !Number.isSafeInteger(latencyMs)) {
    throw new TypeError("Run timestamps must be ordered and have safe latency");
  }

  const renderResult = verifySemanticRenderResult(
    dayflowE1RunBuildRecord(inputRecord.renderResult, "Renderer result"),
    armId,
  );
  const requestSha256 = requestSha256ForArmInput(armInput);
  const attemptCommon = {
    attemptIndex: 0,
    startedAt,
    completedAt,
    requestSha256,
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
    costMicrounits: 0,
  } as const;

  const status =
    renderResult.resultKind === "failure"
      ? "failed"
      : renderResult.semanticOutput.status === "suggestions_available"
        ? "completed"
        : "no_output";
  const validationIssueCodes = [
    ...renderResult.validationIssueCodes,
    ...(status === "no_output" ? ["NO_ELIGIBLE_OUTPUT"] : []),
  ].sort();
  const attempts =
    renderResult.resultKind === "failure"
      ? [
          {
            ...attemptCommon,
            attemptKind: "deterministic_failure" as const,
            failureCode: renderResult.failureCode,
          },
        ]
      : [
          {
            ...attemptCommon,
            attemptKind: "deterministic_success" as const,
            responseSha256: createHash("sha256")
              .update(renderResult.semanticOutputBytes)
              .digest("hex"),
            attemptOutputHash: renderResult.semanticOutputSha256,
          },
        ];
  const candidate: Record<string, unknown> = {
    runSchemaVersion: "dayflow-ablation-run-v0.4",
    runId: inputRecord.runId,
    lineageClass: "evidence",
    dataOrigin: armInput.dataOrigin,
    studyPhase: armInput.studyPhase,
    studyProtocolHash: armInput.studyProtocolHash,
    armId,
    armInputRef: {
      schemaVersion: "dayflow-ablation-arm-input-v0.4",
      armInputId: armInput.armInputId,
      armInputHash: armInput.armInputHash,
    },
    executionFreezeRef: armInput.executionFreezeRef,
    replicateIndex: armInput.replicateIndex,
    startedAt,
    completedAt,
    status,
    attempts,
    validationIssueCodes,
    ...(renderResult.resultKind === "semantic"
      ? {
          semanticOutput: renderResult.semanticOutput,
          outputHash: renderResult.semanticOutputSha256,
        }
      : {}),
    ...(status === "no_output"
      ? { terminalFailureCode: "NO_ELIGIBLE_OUTPUT" }
      : status === "failed" && renderResult.resultKind === "failure"
        ? { terminalFailureCode: renderResult.failureCode }
        : {}),
    runSha256: "0".repeat(64),
  };

  if (armId === "C") {
    candidate.runKind = "screen_only_generation";
  } else {
    const causalArmInput = armInput as DayflowE1A1ArmInput | DayflowE1BArmInput;
    const receipt = requestIssuanceReceiptSchema.parse(
      inputRecord.requestIssuanceReceipt,
    );
    assertRegisteredArtifactIntegrity(
      "request-issuance-receipt",
      "requestIssuanceReceiptSha256",
      receipt,
    );
    verifyCausalReceipt(causalArmInput, receipt, startedAt);
    candidate.runKind = "causal_generation";
    candidate.checkpointRef = causalArmInput.checkpointRef;
    candidate.matchedPairId = causalArmInput.matchedPairId;
    candidate.requestOrderManifestRef = causalArmInput.requestOrderManifestRef;
    candidate.requestId = causalArmInput.requestId;
    candidate.requestPosition = causalArmInput.requestPosition;
    candidate.requestIssuanceReceiptRef = {
      schemaVersion:
        "dayflow-ablation-request-issuance-receipt-v0.1",
      requestIssuanceReceiptId: receipt.requestIssuanceReceiptId,
      requestIssuanceReceiptSha256:
        receipt.requestIssuanceReceiptSha256,
    };
    candidate.issuanceSequence = receipt.issuanceSequence;
  }

  candidate.runSha256 = hashRegisteredArtifact("arm-run", candidate);
  return runSchema.parse(candidate);
}

export function projectDayflowE1SemanticOutputForBlindReview(
  candidate: unknown,
): DayflowE1BlindReviewProjection {
  const semanticOutput = semanticOutputSchema.parse(candidate);
  return semanticOutput.items.map((item) => ({
    title: item.title,
    summary: item.summary,
    caveatCodes: [...item.caveatCodes],
  }));
}

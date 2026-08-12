import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SCORING_RESULT_CONTRACT,
  CONTINUATION_SCORING_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  continuationCandidateSchema,
  sealContinuationCandidate,
  type ContinuationCandidate
} from "./contracts";
import {
  continuationCandidateDerivationEnvelopeSchema,
  continuationCandidateDerivationResultSchema,
  verifyContinuationCandidateDerivationResultAgainstInput,
  type ContinuationCandidateDerivationEnvelope,
  type ContinuationCandidateDerivationResult
} from "./deriveCandidates";
import {
  continuationIdentityResultSchema,
  type ContinuationIdentityResult
} from "./resolveIdentity";

const HOUR_MS = 60 * 60 * 1_000;
const MAX_SCORING_ITEMS = 10_000;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.string().datetime();
const NON_CANONICAL_SCORING_BOUNDARY_VALUE = Object.freeze({
  nonCanonicalContinuationScoringBoundaryValue: true
});

const scoringConfigObjectSchema = z
  .object({
    contract: z.literal("continuation-scoring-config-v0.1"),
    schemaVersion: z.literal(CONTINUATION_SCORING_SCHEMA_VERSION),
    scoringPolicyVersion: z.literal(CONTINUATION_SCORING_POLICY_VERSION),
    recencyBuckets: z.tuple([
      bucketSchema(0, 2 * HOUR_MS, 35),
      bucketSchema(2 * HOUR_MS, 8 * HOUR_MS, 28),
      bucketSchema(8 * HOUR_MS, 24 * HOUR_MS, 21),
      bucketSchema(24 * HOUR_MS, 72 * HOUR_MS, 14),
      bucketSchema(72 * HOUR_MS, 168 * HOUR_MS, 7)
    ]),
    exactCorroborationScore: z.literal(25),
    resumabilityScore: z.literal(0),
    localContinuityScore: z.literal(0),
    explicitPreferenceScore: z.literal(0),
    scoreMeaning: z.literal(
      "continuity_ordering_hypothesis_not_probability_or_importance"
    )
  })
  .strict();

export const continuationScoringConfigSchema = failClosedCanonicalBoundary(
  scoringConfigObjectSchema
);

export const CONTINUATION_SCORING_CONFIG = Object.freeze({
  contract: "continuation-scoring-config-v0.1" as const,
  schemaVersion: CONTINUATION_SCORING_SCHEMA_VERSION,
  scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
  recencyBuckets: Object.freeze([
    frozenBucket(0, 2 * HOUR_MS, 35),
    frozenBucket(2 * HOUR_MS, 8 * HOUR_MS, 28),
    frozenBucket(8 * HOUR_MS, 24 * HOUR_MS, 21),
    frozenBucket(24 * HOUR_MS, 72 * HOUR_MS, 14),
    frozenBucket(72 * HOUR_MS, 168 * HOUR_MS, 7)
  ]),
  exactCorroborationScore: 25 as const,
  resumabilityScore: 0 as const,
  localContinuityScore: 0 as const,
  explicitPreferenceScore: 0 as const,
  scoreMeaning:
    "continuity_ordering_hypothesis_not_probability_or_importance" as const
});

const scoringResultContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_SCORING_RESULT_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_SCORING_SCHEMA_VERSION),
    scoringPolicyVersion: z.literal(CONTINUATION_SCORING_POLICY_VERSION),
    derivationResultSha256: sha256Schema,
    asOf: timestampSchema,
    configSha256: sha256Schema,
    candidateCount: z.number().int().nonnegative().max(MAX_SCORING_ITEMS),
    candidates: z.array(continuationCandidateSchema).max(MAX_SCORING_ITEMS)
  })
  .strict();

export const continuationScoringResultContentSchema =
  failClosedCanonicalBoundary(
    scoringResultContentObjectSchema.superRefine(refineScoringResult)
  );

const scoringResultSealedObjectSchema = scoringResultContentObjectSchema
  .extend({ resultSha256: sha256Schema })
  .strict();

export const continuationScoringResultSchema = failClosedCanonicalBoundary(
  scoringResultSealedObjectSchema.superRefine((value, context) => {
    refineScoringResult(value, context);
    if (value.resultSha256 !== continuationScoringResultSha256(value)) {
      addIssue(context, ["resultSha256"], "Scoring result hash mismatch");
    }
  })
);

export type ContinuationScoringConfig = z.infer<
  typeof continuationScoringConfigSchema
>;
export type ContinuationScoringResultContent = z.infer<
  typeof continuationScoringResultContentSchema
>;
export type ContinuationScoringResult = z.infer<
  typeof continuationScoringResultSchema
>;
export type ContinuationScoringBoundaryResult =
  | { ok: true; result: ContinuationScoringResult }
  | { ok: false; code: "CONTINUATION_SCORING_INPUT_REJECTED" };

/**
 * Returns the provisional R-003 recency ordering score. The score is neither
 * a probability nor an importance claim. Future and seven-day-old activity
 * are outside the half-open scoring policy and return null.
 */
export function scoreContinuationRecency(
  observedAtInput: unknown,
  asOfInput: unknown,
  configInput: unknown
): number | null {
  try {
    const observedAt = timestampSchema.safeParse(observedAtInput);
    const asOf = timestampSchema.safeParse(asOfInput);
    const config = continuationScoringConfigSchema.safeParse(configInput);
    if (!observedAt.success || !asOf.success || !config.success) return null;
    return recencyScore(
      Date.parse(observedAt.data),
      Date.parse(asOf.data),
      config.data
    );
  } catch {
    return null;
  }
}

/** Scores only an exact input-bound R-002 artifact. */
export function scoreContinuationCandidates(
  identityResultInput: unknown,
  derivationEnvelopeInput: unknown,
  derivationResultInput: unknown,
  configInput: unknown
): ContinuationScoringBoundaryResult {
  try {
    const identityResult = continuationIdentityResultSchema.safeParse(
      identityResultInput
    );
    const derivationEnvelope =
      continuationCandidateDerivationEnvelopeSchema.safeParse(
        derivationEnvelopeInput
      );
    const derivationResult =
      continuationCandidateDerivationResultSchema.safeParse(
        derivationResultInput
      );
    const config = continuationScoringConfigSchema.safeParse(configInput);
    if (
      !identityResult.success ||
      !derivationEnvelope.success ||
      !derivationResult.success ||
      !config.success ||
      !verifyContinuationCandidateDerivationResultAgainstInput(
        identityResult.data,
        derivationEnvelope.data,
        derivationResult.data
      )
    ) {
      return { ok: false, code: "CONTINUATION_SCORING_INPUT_REJECTED" };
    }
    return {
      ok: true,
      result: scoreCandidatesUnchecked(
        identityResult.data,
        derivationEnvelope.data,
        derivationResult.data,
        config.data
      )
    };
  } catch {
    return { ok: false, code: "CONTINUATION_SCORING_INPUT_REJECTED" };
  }
}

export function verifyContinuationScoringResultAgainstInput(
  identityResultInput: unknown,
  derivationEnvelopeInput: unknown,
  derivationResultInput: unknown,
  configInput: unknown,
  scoringResultInput: unknown
): boolean {
  try {
    const actual = continuationScoringResultSchema.safeParse(scoringResultInput);
    const expected = scoreContinuationCandidates(
      identityResultInput,
      derivationEnvelopeInput,
      derivationResultInput,
      configInput
    );
    return (
      actual.success &&
      expected.ok &&
      runtimeCanonicalJson(actual.data) ===
        runtimeCanonicalJson(expected.result)
    );
  } catch {
    return false;
  }
}

export function continuationScoringConfigSha256(): string {
  return runtimeSha256({
    domain: "continuation-scoring-config-hash-v0.1",
    config: CONTINUATION_SCORING_CONFIG
  });
}

export function continuationScoringResultSha256(
  value: ContinuationScoringResult | ContinuationScoringResultContent
): string {
  const { resultSha256: _resultSha256, ...content } =
    value as ContinuationScoringResult;
  return runtimeSha256({
    domain: "continuation-scoring-result-hash-v0.1",
    result: content
  });
}

function scoreCandidatesUnchecked(
  _identityResult: ContinuationIdentityResult,
  derivationEnvelope: ContinuationCandidateDerivationEnvelope,
  derivationResult: ContinuationCandidateDerivationResult,
  config: ContinuationScoringConfig
): ContinuationScoringResult {
  const candidates: ContinuationCandidate[] = [];
  for (const candidate of derivationResult.candidates) {
    const scored = scoreCandidate(candidate, derivationEnvelope.asOf, config);
    if (scored === null) {
      throw new TypeError("R-002 candidate falls outside the R-003 score window");
    }
    candidates.push(scored);
  }
  candidates.sort((left, right) =>
    compareRuntimeStrings(left.candidateId, right.candidateId)
  );
  const content = continuationScoringResultContentSchema.parse({
    contract: CONTINUATION_SCORING_RESULT_CONTRACT,
    schemaVersion: CONTINUATION_SCORING_SCHEMA_VERSION,
    scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    derivationResultSha256: derivationResult.resultSha256,
    asOf: derivationEnvelope.asOf,
    configSha256: continuationScoringConfigSha256(),
    candidateCount: candidates.length,
    candidates
  });
  return continuationScoringResultSchema.parse({
    ...content,
    resultSha256: continuationScoringResultSha256(content)
  });
}

function scoreCandidate(
  candidate: ContinuationCandidate,
  asOf: string,
  config: ContinuationScoringConfig
): ContinuationCandidate | null {
  const recency = recencyScore(
    Date.parse(candidate.observedAt),
    Date.parse(asOf),
    config
  );
  if (recency === null) return null;
  const exactCorroboration =
    candidate.candidateKind === "linked_workstream" &&
    candidate.evidenceBand === "corroborated" &&
    candidate.sourceObservationIds.length === 2
      ? config.exactCorroborationScore
      : 0;
  const scoreBreakdown = {
    recency,
    exactCorroboration,
    resumability: config.resumabilityScore,
    localContinuity: config.localContinuityScore,
    explicitPreference: config.explicitPreferenceScore
  };
  const { candidateSha256: _candidateSha256, ...content } = candidate;
  return sealContinuationCandidate({
    ...content,
    continuityScore: Object.values(scoreBreakdown).reduce(
      (total, score) => total + score,
      0
    ),
    scoreBreakdown
  });
}

function recencyScore(
  observedAtMs: number,
  asOfMs: number,
  config: ContinuationScoringConfig
): number | null {
  if (!Number.isInteger(observedAtMs) || !Number.isInteger(asOfMs)) return null;
  const ageMs = asOfMs - observedAtMs;
  if (!Number.isInteger(ageMs) || ageMs < 0) return null;
  const bucket = config.recencyBuckets.find(
    (item) => ageMs >= item.minAgeMs && ageMs < item.maxAgeExclusiveMs
  );
  return bucket?.score ?? null;
}

function refineScoringResult(
  value: z.infer<typeof scoringResultContentObjectSchema>,
  context: z.RefinementCtx
): void {
  if (value.configSha256 !== continuationScoringConfigSha256()) {
    addIssue(context, ["configSha256"], "Scoring config hash mismatch");
  }
  if (value.candidateCount !== value.candidates.length) {
    addIssue(context, ["candidateCount"], "Scoring candidate count mismatch");
  }
  refineCanonical(
    value.candidates.map((candidate) => candidate.candidateId),
    context,
    ["candidates"]
  );
  const config = continuationScoringConfigSchema.parse(
    CONTINUATION_SCORING_CONFIG
  );
  for (const [index, candidate] of value.candidates.entries()) {
    const recency = recencyScore(
      Date.parse(candidate.observedAt),
      Date.parse(value.asOf),
      config
    );
    const exactCorroboration =
      candidate.candidateKind === "linked_workstream" &&
      candidate.evidenceBand === "corroborated" &&
      candidate.sourceObservationIds.length === 2
        ? config.exactCorroborationScore
        : 0;
    if (
      recency === null ||
      candidate.scoreBreakdown.recency !== recency ||
      candidate.scoreBreakdown.exactCorroboration !== exactCorroboration ||
      candidate.scoreBreakdown.resumability !== 0 ||
      candidate.scoreBreakdown.localContinuity !== 0 ||
      candidate.scoreBreakdown.explicitPreference !== 0
    ) {
      addIssue(
        context,
        ["candidates", index, "scoreBreakdown"],
        "Candidate score must match the exact R-003 policy"
      );
    }
  }
}

function bucketSchema<Min extends number, Max extends number, Score extends number>(
  minAgeMs: Min,
  maxAgeExclusiveMs: Max,
  score: Score
) {
  return z
    .object({
      minAgeMs: z.literal(minAgeMs),
      maxAgeExclusiveMs: z.literal(maxAgeExclusiveMs),
      score: z.literal(score)
    })
    .strict();
}

function frozenBucket<Min extends number, Max extends number, Score extends number>(
  minAgeMs: Min,
  maxAgeExclusiveMs: Max,
  score: Score
) {
  return Object.freeze({ minAgeMs, maxAgeExclusiveMs, score });
}

function refineCanonical(
  values: string[],
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareRuntimeStrings(values[index - 1]!, values[index]!) >= 0) {
      addIssue(context, path, "Array must be canonical and unique");
      return;
    }
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function failClosedCanonicalBoundary<T extends z.ZodTypeAny>(
  schema: T
): z.ZodEffects<T, z.output<T>, unknown> {
  return z.preprocess((value) => {
    try {
      return JSON.parse(runtimeCanonicalJson(value)) as unknown;
    } catch {
      return NON_CANONICAL_SCORING_BOUNDARY_VALUE;
    }
  }, schema);
}

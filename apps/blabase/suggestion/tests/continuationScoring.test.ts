import { describe, expect, it } from "vitest";

import { WORK_CONTEXT_REGISTRY_CONTRACT } from "../src/context/contracts";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "../src/crossSource/canonicalHash";
import {
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION
} from "../src/crossSource/versions";
import {
  continuationCandidateSha256,
  createContinuationObservationId,
  sealContinuationObservation,
  type ContinuationObservation,
  type ContinuationSourceIdentity
} from "../src/continuation/contracts";
import {
  CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
  deriveContinuationCandidates
} from "../src/continuation/deriveCandidates";
import {
  CONTINUATION_IDENTITY_RESULT_CONTRACT,
  CONTINUATION_IDENTITY_SCHEMA_VERSION,
  continuationIdentityResultSchema,
  type ContinuationIdentityResult
} from "../src/continuation/resolveIdentity";
import {
  CONTINUATION_SCORING_CONFIG,
  continuationScoringConfigSchema,
  continuationScoringResultSchema,
  scoreContinuationCandidates,
  scoreContinuationRecency,
  verifyContinuationScoringResultAgainstInput
} from "../src/continuation/scoreContinuity";

const AS_OF = "2026-08-13T12:00:00.000Z";
const PROJECT_A = `project_${"a".repeat(32)}`;
const PROJECT_B = `project_${"b".repeat(32)}`;
const HOUR_MS = 60 * 60 * 1_000;

describe("Continuation R-003 scoring", () => {
  it("uses exact half-open epoch-ms buckets at every boundary", () => {
    const cases = [
      { ageMs: -1, expected: null },
      { ageMs: 0, expected: 35 },
      { ageMs: 1, expected: 35 },
      { ageMs: 2 * HOUR_MS - 1, expected: 35 },
      { ageMs: 2 * HOUR_MS, expected: 28 },
      { ageMs: 2 * HOUR_MS + 1, expected: 28 },
      { ageMs: 8 * HOUR_MS - 1, expected: 28 },
      { ageMs: 8 * HOUR_MS, expected: 21 },
      { ageMs: 8 * HOUR_MS + 1, expected: 21 },
      { ageMs: 24 * HOUR_MS - 1, expected: 21 },
      { ageMs: 24 * HOUR_MS, expected: 14 },
      { ageMs: 24 * HOUR_MS + 1, expected: 14 },
      { ageMs: 72 * HOUR_MS - 1, expected: 14 },
      { ageMs: 72 * HOUR_MS, expected: 7 },
      { ageMs: 72 * HOUR_MS + 1, expected: 7 },
      { ageMs: 168 * HOUR_MS - 1, expected: 7 },
      { ageMs: 168 * HOUR_MS, expected: null },
      { ageMs: 168 * HOUR_MS + 1, expected: null }
    ];

    for (const { ageMs, expected } of cases) {
      const observedAt = new Date(Date.parse(AS_OF) - ageMs).toISOString();
      expect(
        scoreContinuationRecency(
          observedAt,
          AS_OF,
          CONTINUATION_SCORING_CONFIG
        )
      ).toBe(expected);
    }
  });

  it("adds exact corroboration only to an input-bound linked candidate", () => {
    const identity = identityResult([
      resolution("mapped", observation("github", 1, PROJECT_A, 1 * HOUR_MS)),
      resolution("mapped", observation("codex", 2, PROJECT_A, 3 * HOUR_MS)),
      resolution("mapped", observation("github", 3, PROJECT_B, 9 * HOUR_MS))
    ]);
    const derived = deriveContinuationCandidates(identity, derivationEnvelope());

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const scored = scoreContinuationCandidates(
      identity,
      derivationEnvelope(),
      derived.result,
      CONTINUATION_SCORING_CONFIG
    );

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;
    const linked = scored.result.candidates.find(
      (candidate) => candidate.candidateKind === "linked_workstream"
    )!;
    const single = scored.result.candidates.find(
      (candidate) => candidate.candidateKind === "recent_github_push"
    )!;
    expect(linked.scoreBreakdown).toEqual({
      recency: 35,
      exactCorroboration: 25,
      resumability: 0,
      localContinuity: 0,
      explicitPreference: 0
    });
    expect(linked.continuityScore).toBe(60);
    expect(single.scoreBreakdown).toEqual({
      recency: 21,
      exactCorroboration: 0,
      resumability: 0,
      localContinuity: 0,
      explicitPreference: 0
    });
  });

  it("scores setup by recency only and preserves every non-score field", () => {
    const identity = identityResult([
      resolution("setup_needed", observation("github", 4, null, 2 * HOUR_MS))
    ]);
    const derived = deriveContinuationCandidates(identity, derivationEnvelope());

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const before = derived.result.candidates[0]!;
    const scored = scoreContinuationCandidates(
      identity,
      derivationEnvelope(),
      derived.result,
      CONTINUATION_SCORING_CONFIG
    );

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;
    const after = scored.result.candidates[0]!;
    expect(after.scoreBreakdown).toEqual({
      recency: 28,
      exactCorroboration: 0,
      resumability: 0,
      localContinuity: 0,
      explicitPreference: 0
    });
    expect(withoutScore(after)).toEqual(withoutScore(before));
    expect(after.candidateId).toBe(before.candidateId);
    expect(after.privateActionTarget).toEqual(before.privateActionTarget);
    expect(after.candidateSha256).toBe(continuationCandidateSha256(after));
    expect(after.candidateSha256).not.toBe(before.candidateSha256);
  });

  it("rejects config or derivation rebinding and verifies exact scored output", () => {
    const identity = identityResult([
      resolution("mapped", observation("github", 5, PROJECT_A, HOUR_MS))
    ]);
    const derived = deriveContinuationCandidates(identity, derivationEnvelope());
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const scored = scoreContinuationCandidates(
      identity,
      derivationEnvelope(),
      derived.result,
      CONTINUATION_SCORING_CONFIG
    );
    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(
      verifyContinuationScoringResultAgainstInput(
        identity,
        derivationEnvelope(),
        derived.result,
        CONTINUATION_SCORING_CONFIG,
        scored.result
      )
    ).toBe(true);
    expect(
      scoreContinuationCandidates(
        identity,
        derivationEnvelope(),
        { ...derived.result, resultSha256: "0".repeat(64) },
        CONTINUATION_SCORING_CONFIG
      )
    ).toEqual({ ok: false, code: "CONTINUATION_SCORING_INPUT_REJECTED" });
    expect(
      scoreContinuationCandidates(
        identity,
        derivationEnvelope(),
        derived.result,
        { ...CONTINUATION_SCORING_CONFIG, exactCorroborationScore: 24 }
      )
    ).toEqual({ ok: false, code: "CONTINUATION_SCORING_INPUT_REJECTED" });
    expect(
      verifyContinuationScoringResultAgainstInput(
        identity,
        derivationEnvelope(),
        derived.result,
        CONTINUATION_SCORING_CONFIG,
        { ...scored.result, resultSha256: "f".repeat(64) }
      )
    ).toBe(false);
  });

  it("makes every exported scoring schema fail closed for hostile values", () => {
    const throwing = Object.defineProperty({}, "contract", {
      get(): never {
        throw new Error("hostile getter");
      }
    });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [throwing, BigInt(1), Number.NaN, undefined, cycle]) {
      expect(() => continuationScoringConfigSchema.safeParse(value)).not.toThrow();
      expect(continuationScoringConfigSchema.safeParse(value).success).toBe(false);
      expect(() => continuationScoringResultSchema.safeParse(value)).not.toThrow();
      expect(continuationScoringResultSchema.safeParse(value).success).toBe(false);
    }
  });
});

function derivationEnvelope() {
  return {
    contract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    asOf: AS_OF,
    config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
  };
}

function observation(
  source: "github" | "codex",
  marker: number,
  workContextId: string | null,
  ageMs: number
): ContinuationObservation {
  const observedAt = new Date(Date.parse(AS_OF) - ageMs).toISOString();
  const snapshotCapturedAt = new Date(Date.parse(observedAt) + 1_000).toISOString();
  const sourceIdentity: ContinuationSourceIdentity = {
    source,
    opaqueId: `source_ref_${hex(marker, 32)}`
  };
  const sourceRecordRef = `source_record_ref_${hex(marker + 100, 32)}`;
  const payload = source === "github"
    ? { kind: "github_push" as const, pushOccurredAt: observedAt }
    : {
        kind: "codex_session_activity" as const,
        sessionUpdatedAt: observedAt,
        boundedActivityCount: 1,
        boundedSummaryAvailable: true
      };
  return sealContinuationObservation({
    contract: "continuation-observation-v0.2",
    schemaVersion: "continuation-observation-schema-v0.2",
    observationId: createContinuationObservationId({
      sourceIdentity,
      sourceRecordRef,
      observedAt
    }),
    observationIdPolicyVersion: "continuation-observation-id-policy-v0.2",
    sourceIdentity,
    sourceRecordRef,
    sourceSchemaVersion: source === "github"
      ? CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION
      : CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
    adapterVersion: source === "github"
      ? CONTINUATION_GITHUB_ADAPTER_VERSION
      : CONTINUATION_CODEX_ADAPTER_VERSION,
    sourceSnapshotSha256: hex(marker + 200, 64),
    workContextId,
    payload,
    observedAt,
    snapshotCapturedAt,
    expiresAt: new Date(Date.parse(observedAt) + 168 * HOUR_MS).toISOString(),
    activityWindowPolicyVersion: "continuation-activity-window-7d-v0.1",
    snapshotFreshnessPolicyVersion: "continuation-source-freshness-policy-v0.1",
    sourceCoverage: "complete",
    snapshotFreshness: "fresh",
    terminalState: "active",
    evidenceRefs: [`evidence_${hex(marker + 300, 32)}`],
    conflictCodes: [],
    errorCodes: []
  });
}

function resolution(
  status: "mapped" | "setup_needed" | "conflict",
  item: ContinuationObservation
) {
  return {
    observationId: item.observationId,
    status,
    workContextId: item.workContextId,
    reasonCodes: [status === "mapped"
      ? "EXPLICIT_MAPPING_CONFIRMED"
      : status === "setup_needed"
        ? "IDENTITY_MAPPING_NOT_CONFIRMED"
        : "IDENTITY_BINDING_CONFLICT"],
    observation: item
  } as const;
}

function identityResult(
  resolutionsInput: ReturnType<typeof resolution>[]
): ContinuationIdentityResult {
  const resolutions = [...resolutionsInput].sort((left, right) =>
    compareRuntimeStrings(left.observationId, right.observationId)
  );
  const sources = [...new Set(resolutions.map(
    (item) => item.observation.sourceIdentity.source
  ))].sort(compareRuntimeStrings) as Array<"github" | "codex">;
  const content = {
    contract: CONTINUATION_IDENTITY_RESULT_CONTRACT,
    schemaVersion: CONTINUATION_IDENTITY_SCHEMA_VERSION,
    identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
    registryContract: WORK_CONTEXT_REGISTRY_CONTRACT,
    registrySha256: "a".repeat(64),
    sourceBatchSha256s: sources.map(batchSha).sort(compareRuntimeStrings),
    sourceFreshnessEvaluations: sources.map((source) => ({
      source,
      batchSha256: batchSha(source),
      evaluatedAsOf: AS_OF,
      snapshotFreshnessCutoff: "2026-08-06T12:00:00.000Z"
    })),
    mappedCount: resolutions.filter((item) => item.status === "mapped").length,
    setupNeededCount: resolutions.filter((item) => item.status === "setup_needed").length,
    conflictCount: resolutions.filter((item) => item.status === "conflict").length,
    resolutions
  };
  return continuationIdentityResultSchema.parse({
    ...content,
    resultSha256: runtimeSha256({
      domain: "continuation-identity-result-hash-v0.4",
      result: content
    })
  });
}

function batchSha(source: "github" | "codex"): string {
  return source === "github" ? "b".repeat(64) : "c".repeat(64);
}

function withoutScore(candidate: Record<string, unknown>) {
  const {
    continuityScore: _continuityScore,
    scoreBreakdown: _scoreBreakdown,
    candidateSha256: _candidateSha256,
    ...rest
  } = candidate;
  return JSON.parse(runtimeCanonicalJson(rest)) as unknown;
}

function hex(value: number, length: number): string {
  return value.toString(16).padStart(length, "0");
}

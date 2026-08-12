import { describe, expect, it } from "vitest";

import { WORK_CONTEXT_REGISTRY_CONTRACT } from "../src/context/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../src/crossSource/canonicalHash";
import {
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION,
  CONTINUATION_LOCAL_GIT_ADAPTER_VERSION,
  CONTINUATION_LOCAL_GIT_SOURCE_SCHEMA_VERSION,
  CONTINUATION_SETUP_TARGET_POLICY_VERSION
} from "../src/crossSource/versions";
import {
  CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
  continuationCandidateDerivationEnvelopeSchema,
  continuationCandidateDerivationResultContentSchema,
  continuationCandidateDerivationResultSchema,
  continuationCandidateDerivationResultSha256,
  deriveContinuationCandidates,
  verifyContinuationCandidateDerivationResultIntegrity,
  verifyContinuationCandidateDerivationResultAgainstInput,
  type ContinuationCandidateDerivationResult,
  type ContinuationCandidateDerivationResultContent
} from "../src/continuation/deriveCandidates";
import {
  continuationCandidateSha256,
  createContinuationCandidateId,
  createContinuationObservationId,
  sealContinuationObservation,
  type ContinuationCandidate,
  type ContinuationCandidateContent,
  type ContinuationObservation,
  type ContinuationSourceIdentity
} from "../src/continuation/contracts";
import {
  CONTINUATION_IDENTITY_RESULT_CONTRACT,
  CONTINUATION_IDENTITY_SCHEMA_VERSION,
  continuationIdentityResultSchema,
  type ContinuationIdentityResult
} from "../src/continuation/resolveIdentity";

const AS_OF = "2026-08-12T12:00:00.000Z";
const PROJECT_A = projectId(1);
const PROJECT_B = projectId(2);
const PROJECT_C = projectId(3);

describe("Continuation R-002 candidate derivation", () => {
  it("derives a sealed, generic, display-only GitHub candidate with zero R-003 score", () => {
    const observation = makeObservation({
      source: "github",
      identityKey: 1,
      recordKey: 1,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([makeResolution("mapped", observation)]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(verifyContinuationCandidateDerivationResultIntegrity(derived.result)).toBe(true);
    expect(derived.result).toMatchObject({
      resolutionCount: 1,
      admittedObservationCount: 1,
      candidateCount: 1,
      setupCandidateCount: 0,
      excludedCount: 0,
      exclusions: [],
      setupReasons: []
    });
    expect(derived.result.candidates[0]).toMatchObject({
      candidateKind: "recent_github_push",
      workContextId: PROJECT_A,
      sourceObservationIds: [observation.observationId],
      localDisplayLabel: "Recent GitHub activity",
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      continuityScore: 0,
      scoreBreakdown: {
        recency: 0,
        exactCorroboration: 0,
        resumability: 0,
        localContinuity: 0,
        explicitPreference: 0
      },
      reasonCodes: ["EXPLICIT_MAPPING_CONFIRMED", "RECENT_GITHUB_ACTIVITY"],
      caveatCodes: [],
      privateActionTarget: null
    });
  });

  it("admits terminal-unknown metadata-only Codex evidence only with bounded caveats", () => {
    const observation = makeObservation({
      source: "codex",
      identityKey: 2,
      recordKey: 2,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:10:00.000Z",
      sourceCoverage: "partial",
      terminalState: "unknown",
      boundedActivityCount: 0,
      boundedSummaryAvailable: false
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([makeResolution("mapped", observation)]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const candidate = derived.result.candidates[0]!;
    expect(candidate).toMatchObject({
      candidateKind: "recent_codex_session",
      localDisplayLabel: "Recent Codex activity",
      capability: "display",
      privateActionTarget: null,
      caveatCodes: [
        "SOURCE_COVERAGE_PARTIAL",
        "SOURCE_METADATA_ONLY",
        "TERMINAL_STATE_UNKNOWN"
      ]
    });
    expect(candidate).not.toHaveProperty("sourceIdentity");
    expect(candidate).not.toHaveProperty("evidenceRefs");
    expect(candidate.localDisplayLabel).not.toMatch(/unfinished|current|urgent/iu);
  });

  it("corroborates only GitHub and Codex observations sharing one explicit WorkContext", () => {
    const github = makeObservation({
      source: "github",
      identityKey: 3,
      recordKey: 3,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const codex = makeObservation({
      source: "codex",
      identityKey: 4,
      recordKey: 4,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:30:00.000Z"
    });
    const linked = deriveContinuationCandidates(
      makeIdentityResult([
        makeResolution("mapped", github),
        makeResolution("mapped", codex)
      ]),
      envelope()
    );

    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.result.candidates).toHaveLength(1);
    expect(linked.result.candidates[0]).toMatchObject({
      candidateKind: "linked_workstream",
      workContextId: PROJECT_A,
      sourceObservationIds: [github.observationId, codex.observationId].sort(
        compareRuntimeStrings
      ),
      observedAt: "2026-08-12T11:30:00.000Z",
      evidenceBand: "corroborated",
      capability: "display",
      privateActionTarget: null
    });

    const sameTimeDifferentContexts = deriveContinuationCandidates(
      makeIdentityResult([
        makeResolution("mapped", github),
        makeResolution(
          "mapped",
          makeObservation({
            source: "codex",
            identityKey: 5,
            recordKey: 5,
            workContextId: PROJECT_B,
            observedAt: github.observedAt
          })
        )
      ]),
      envelope()
    );
    expect(sameTimeDifferentContexts.ok).toBe(true);
    if (!sameTimeDifferentContexts.ok) return;
    expect(
      sameTimeDifferentContexts.result.candidates.some(
        (candidate) => candidate.candidateKind === "linked_workstream"
      )
    ).toBe(false);
    expect(sameTimeDifferentContexts.result.candidates).toHaveLength(2);
  });

  it("collapses each source and WorkContext to its newest observation and accounts for the older row", () => {
    const older = makeObservation({
      source: "github",
      identityKey: 6,
      recordKey: 6,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T10:00:00.000Z"
    });
    const newer = makeObservation({
      source: "github",
      identityKey: 7,
      recordKey: 7,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([
        makeResolution("mapped", older),
        makeResolution("mapped", newer)
      ]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.result.candidates[0]?.sourceObservationIds).toEqual([
      newer.observationId
    ]);
    expect(derived.result).toMatchObject({
      resolutionCount: 2,
      admittedObservationCount: 1,
      candidateCount: 1,
      excludedCount: 1,
      exclusions: [
        { reasonCode: "SUPERSEDED_BY_NEWER_OBSERVATION", count: 1 }
      ]
    });
  });

  it("creates deterministic bounded setup and clarification descriptors without making them ready", () => {
    const mappingObservation = makeObservation({
      source: "github",
      identityKey: 8,
      recordKey: 8,
      workContextId: null,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const conflictObservation = makeObservation({
      source: "codex",
      identityKey: 9,
      recordKey: 9,
      workContextId: null,
      observedAt: "2026-08-12T11:10:00.000Z"
    });
    const identity = makeIdentityResult([
      makeResolution("setup_needed", mappingObservation),
      makeResolution("conflict", conflictObservation)
    ]);
    const first = deriveContinuationCandidates(identity, envelope());
    const replay = deriveContinuationCandidates(identity, envelope());

    expect(first).toEqual(replay);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result).toMatchObject({
      candidateCount: 2,
      setupCandidateCount: 2,
      excludedCount: 0,
      setupReasons: [
        { reasonCode: "IDENTITY_BINDING_CONFLICT", count: 1 },
        { reasonCode: "IDENTITY_MAPPING_NOT_CONFIRMED", count: 1 }
      ]
    });
    for (const candidate of first.result.candidates) {
      expect(candidate).toMatchObject({
        candidateKind: "workspace_mapping",
        workContextId: null,
        evidenceBand: "setup",
        capability: "open_setup_surface",
        availability: "setup_required",
        continuityScore: 0,
        privateActionTarget: { capability: "open_setup_surface" }
      });
      expect(candidate.privateActionTarget?.targetRef).toMatch(
        /^private_target_[a-f0-9]{32}$/u
      );
    }
    const mappingCandidate = first.result.candidates.find((candidate) =>
      candidate.reasonCodes.includes("IDENTITY_MAPPING_NOT_CONFIRMED")
    )!;
    expect(mappingCandidate.privateActionTarget?.targetRef).toBe(
      runtimeStableId(
        "private_target",
        `${CONTINUATION_SETUP_TARGET_POLICY_VERSION}:identity-mapping-not-confirmed`,
        {
          identityResultSha256: identity.resultSha256,
          sourceObservationIds: [mappingObservation.observationId]
        }
      )
    );
    const conflictCandidate = first.result.candidates.find((candidate) =>
      candidate.reasonCodes.includes("IDENTITY_BINDING_CONFLICT")
    )!;
    expect(conflictCandidate.availability).not.toBe("ready");
    expect(conflictCandidate.localDisplayLabel).toBe(
      "Review recent work connection"
    );
  });

  it("admits only fresh, unexpired, nonfuture, nonterminal, conflict-free observations", () => {
    const inputs = [
      makeObservation({ source: "github", identityKey: 10, recordKey: 10, workContextId: projectId(10), observedAt: "2026-08-12T08:00:00.000Z", snapshotCapturedAt: "2026-08-12T09:00:00.000Z", snapshotFreshness: "stale" }),
      makeObservation({ source: "github", identityKey: 13, recordKey: 13, workContextId: projectId(13), observedAt: "2026-08-01T11:00:00.000Z", expiresAt: "2026-08-08T11:00:00.000Z", snapshotFreshness: "stale" }),
      makeObservation({ source: "codex", identityKey: 15, recordKey: 15, workContextId: projectId(15), terminalState: "terminal" }),
      makeObservation({ source: "codex", identityKey: 16, recordKey: 16, workContextId: projectId(16), conflictCodes: ["SOURCE_CONFLICT"] }),
      makeObservation({ source: "codex", identityKey: 17, recordKey: 17, workContextId: projectId(17), errorCodes: ["SOURCE_ERROR"] })
    ];
    const derived = deriveContinuationCandidates(
      makeIdentityResult(
        inputs.map((observation) => makeResolution("mapped", observation))
      ),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.result).toMatchObject({
      resolutionCount: 5,
      admittedObservationCount: 0,
      candidateCount: 0,
      setupCandidateCount: 0,
      excludedCount: 5,
      candidates: [],
      setupReasons: []
    });
    expect(derived.result.exclusions).toEqual([
      { reasonCode: "OBSERVATION_CONFLICT_REPORTED", count: 1 },
      { reasonCode: "OBSERVATION_ERROR_REPORTED", count: 1 },
      { reasonCode: "OBSERVATION_EXPIRED", count: 1 },
      { reasonCode: "OBSERVATION_TERMINAL", count: 1 },
      { reasonCode: "SNAPSHOT_STALE", count: 1 }
    ]);
  });

  it("rejects impossible freshness states and future snapshots at the provenance boundary", () => {
    const invalidInputs = [
      makeObservation({ source: "github", identityKey: 11, recordKey: 11, workContextId: PROJECT_A, snapshotFreshness: "invalid" }),
      makeObservation({ source: "github", identityKey: 12, recordKey: 12, workContextId: PROJECT_A, snapshotFreshness: "unknown" }),
      makeObservation({ source: "github", identityKey: 14, recordKey: 14, workContextId: PROJECT_A, observedAt: "2026-08-12T12:01:00.000Z" })
    ];
    for (const observation of invalidInputs) {
      expect(
        deriveContinuationCandidates(
          makeIdentityResult([makeResolution("mapped", observation)]),
          envelope()
        )
      ).toEqual({
        ok: false,
        code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
      });
    }
  });

  it("does not turn an ineligible setup resolution into a setup candidate", () => {
    const stale = makeObservation({
      source: "github",
      identityKey: 19,
      recordKey: 19,
      workContextId: null,
      observedAt: "2026-08-12T08:00:00.000Z",
      snapshotCapturedAt: "2026-08-12T09:00:00.000Z",
      snapshotFreshness: "stale"
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([makeResolution("setup_needed", stale)]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.result).toMatchObject({
      candidateCount: 0,
      setupCandidateCount: 0,
      excludedCount: 1,
      candidates: [],
      setupReasons: [],
      exclusions: [{ reasonCode: "SNAPSHOT_STALE", count: 1 }]
    });
  });

  it("rejects extended observation expiry and excludes the exact expiry boundary", () => {
    const extended = makeObservation({
      source: "github",
      identityKey: 39,
      recordKey: 39,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z",
      expiresAt: "2026-08-20T11:00:00.000Z"
    });
    const extendedIdentity = makeIdentityResult([
      makeResolution("mapped", extended)
    ]);

    expect(deriveContinuationCandidates(extendedIdentity, envelope())).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });

    const boundaryObservation = makeObservation({
      source: "github",
      identityKey: 40,
      recordKey: 40,
      workContextId: PROJECT_A,
      observedAt: "2026-08-05T12:00:00.000Z"
    });
    const boundaryIdentity = makeIdentityResult(
      [makeResolution("mapped", boundaryObservation)],
      {
        evaluatedAsOf: boundaryObservation.expiresAt,
        snapshotFreshnessCutoff: boundaryObservation.snapshotCapturedAt
      }
    );
    const atExpiry = deriveContinuationCandidates(
      boundaryIdentity,
      envelope(boundaryObservation.expiresAt)
    );

    expect(atExpiry.ok).toBe(true);
    if (!atExpiry.ok) return;
    expect(atExpiry.result).toMatchObject({
      candidateCount: 0,
      admittedObservationCount: 0,
      excludedCount: 1,
      candidates: [],
      exclusions: [{ reasonCode: "OBSERVATION_EXPIRED", count: 1 }]
    });
  });

  it("orders the derivation output by candidateId rather than an R-003 score", () => {
    const observations = [
      makeObservation({ source: "github", identityKey: 20, recordKey: 20, workContextId: PROJECT_A }),
      makeObservation({ source: "codex", identityKey: 21, recordKey: 21, workContextId: PROJECT_B }),
      makeObservation({ source: "github", identityKey: 22, recordKey: 22, workContextId: PROJECT_C })
    ];
    const derived = deriveContinuationCandidates(
      makeIdentityResult(
        observations.map((observation) => makeResolution("mapped", observation))
      ),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.result.candidates.map((candidate) => candidate.candidateId)).toEqual(
      derived.result.candidates
        .map((candidate) => candidate.candidateId)
        .sort(compareRuntimeStrings)
    );
    expect(
      derived.result.candidates.every(
        (candidate) =>
          candidate.continuityScore === 0 &&
          Object.values(candidate.scoreBreakdown).every((score) => score === 0)
      )
    ).toBe(true);
  });

  it("fails closed without throwing for tamper, unknown versions, injected targets, and hostile values", () => {
    const observation = makeObservation({
      source: "github",
      identityKey: 23,
      recordKey: 23,
      workContextId: PROJECT_A
    });
    const identity = makeIdentityResult([makeResolution("mapped", observation)]);
    const tampered = { ...identity, resultSha256: "0".repeat(64) };
    const unknownEnvelope = {
      ...envelope(),
      schemaVersion: "continuation-candidate-derivation-schema-v9"
    };
    const injectedTargetEnvelope = {
      ...envelope(),
      config: {
        ...CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
        targetRef: `private_target_${"f".repeat(32)}`
      }
    };
    const semanticallyInvalid = structuredClone(identity);
    semanticallyInvalid.resolutions[0]!.reasonCodes = [
      "IDENTITY_MAPPING_NOT_CONFIRMED"
    ];
    semanticallyInvalid.resultSha256 = identityResultSha256(semanticallyInvalid);
    const hostile = Object.defineProperty({}, "contract", {
      get(): never {
        throw new Error("hostile getter");
      }
    });

    expect(deriveContinuationCandidates(tampered, envelope())).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });
    expect(deriveContinuationCandidates(identity, unknownEnvelope)).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });
    expect(deriveContinuationCandidates(identity, injectedTargetEnvelope)).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });
    expect(deriveContinuationCandidates(semanticallyInvalid, envelope())).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });
    expect(() => deriveContinuationCandidates(BigInt(1), envelope())).not.toThrow();
    expect(() => deriveContinuationCandidates(identity, hostile)).not.toThrow();
  });

  it("rejects a resealed R-001 result that maps one source identity to two WorkContexts", () => {
    const first = makeObservation({
      source: "github",
      identityKey: 33,
      recordKey: 33,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T10:00:00.000Z"
    });
    const second = makeObservation({
      source: "github",
      identityKey: 33,
      recordKey: 34,
      workContextId: PROJECT_B,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const resealedIdentity = makeIdentityResult([
      makeResolution("mapped", first),
      makeResolution("mapped", second)
    ]);

    expect(
      continuationIdentityResultSchema.safeParse(resealedIdentity).success
    ).toBe(true);
    expect(deriveContinuationCandidates(resealedIdentity, envelope())).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });
  });

  it("rejects resealed R-001 results mixing mapped with setup or conflict for one identity", () => {
    for (const inconsistentStatus of ["setup_needed", "conflict"] as const) {
      const mapped = makeObservation({
        source: "codex",
        identityKey: 34,
        recordKey: inconsistentStatus === "setup_needed" ? 35 : 37,
        workContextId: PROJECT_A,
        observedAt: "2026-08-12T10:00:00.000Z"
      });
      const inconsistent = makeObservation({
        source: "codex",
        identityKey: 34,
        recordKey: inconsistentStatus === "setup_needed" ? 36 : 38,
        workContextId: null,
        observedAt: "2026-08-12T11:00:00.000Z"
      });
      const resealedIdentity = makeIdentityResult([
        makeResolution("mapped", mapped),
        makeResolution(inconsistentStatus, inconsistent)
      ]);

      expect(
        continuationIdentityResultSchema.safeParse(resealedIdentity).success
      ).toBe(true);
      expect(deriveContinuationCandidates(resealedIdentity, envelope())).toEqual({
        ok: false,
        code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
      });
    }
  });

  it("rejects a tampered or noncanonical sealed derivation result", () => {
    const identity = makeIdentityResult([
      makeResolution(
        "mapped",
        makeObservation({ source: "github", identityKey: 24, recordKey: 24, workContextId: PROJECT_A })
      ),
      makeResolution(
        "mapped",
        makeObservation({ source: "codex", identityKey: 25, recordKey: 25, workContextId: PROJECT_B })
      )
    ]);
    const derived = deriveContinuationCandidates(identity, envelope());

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(
      verifyContinuationCandidateDerivationResultIntegrity({
        ...derived.result,
        resultSha256: "0".repeat(64)
      })
    ).toBe(false);
    const reversed = {
      ...derived.result,
      candidates: [...derived.result.candidates].reverse()
    };
    const resealed = {
      ...reversed,
      resultSha256: continuationCandidateDerivationResultSha256(reversed)
    };
    expect(continuationCandidateDerivationResultSchema.safeParse(resealed).success).toBe(
      false
    );
  });

  it("rejects rehashed config and private setup target rebinding", () => {
    const observation = makeObservation({
      source: "github",
      identityKey: 26,
      recordKey: 26,
      workContextId: null
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([makeResolution("setup_needed", observation)]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const setupCandidate = derived.result.candidates[0]!;
    const reboundCandidate = resealCandidate(setupCandidate, {
      privateActionTarget: {
        capability: "open_setup_surface",
        targetRef: `private_target_${"f".repeat(32)}`
      }
    });
    const reboundResult = resealDerivationResult(derived.result, {
      candidates: [reboundCandidate]
    });
    const configRebound = resealDerivationResult(derived.result, {
      configSha256: "f".repeat(64)
    });

    expect(
      continuationCandidateDerivationResultSchema.safeParse(reboundResult).success
    ).toBe(false);
    expect(
      continuationCandidateDerivationResultSchema.safeParse(configRebound).success
    ).toBe(false);
  });

  it("rejects a rehashed setup reason histogram that is not derived from candidates", () => {
    const identity = makeIdentityResult([
      makeResolution(
        "setup_needed",
        makeObservation({ source: "github", identityKey: 27, recordKey: 27, workContextId: null })
      ),
      makeResolution(
        "setup_needed",
        makeObservation({ source: "github", identityKey: 28, recordKey: 28, workContextId: null })
      ),
      makeResolution(
        "conflict",
        makeObservation({ source: "codex", identityKey: 29, recordKey: 29, workContextId: null })
      )
    ]);
    const derived = deriveContinuationCandidates(identity, envelope());

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.result.setupReasons).toEqual([
      { reasonCode: "IDENTITY_BINDING_CONFLICT", count: 1 },
      { reasonCode: "IDENTITY_MAPPING_NOT_CONFIRMED", count: 2 }
    ]);
    const swappedCounts = resealDerivationResult(derived.result, {
      setupReasons: [
        { reasonCode: "IDENTITY_BINDING_CONFLICT", count: 2 },
        { reasonCode: "IDENTITY_MAPPING_NOT_CONFIRMED", count: 1 }
      ]
    });

    expect(
      continuationCandidateDerivationResultSchema.safeParse(swappedCounts).success
    ).toBe(false);
  });

  it("rejects rehashed result times before observation or at candidate expiry", () => {
    const observation = makeObservation({
      source: "github",
      identityKey: 30,
      recordKey: 30,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([makeResolution("mapped", observation)]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const beforeObservation = resealDerivationResult(derived.result, {
      asOf: "2026-08-12T10:59:59.999Z"
    });
    const atExpiry = resealDerivationResult(derived.result, {
      asOf: derived.result.candidates[0]!.expiresAt
    });

    expect(
      continuationCandidateDerivationResultSchema.safeParse(beforeObservation).success
    ).toBe(false);
    expect(
      continuationCandidateDerivationResultSchema.safeParse(atExpiry).success
    ).toBe(false);
  });

  it("rejects rehashed illegal candidate kinds and source-observation cardinality", () => {
    const observation = makeObservation({
      source: "github",
      identityKey: 31,
      recordKey: 31,
      workContextId: PROJECT_A
    });
    const derived = deriveContinuationCandidates(
      makeIdentityResult([makeResolution("mapped", observation)]),
      envelope()
    );

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const candidate = derived.result.candidates[0]!;
    const illegalKind = resealCandidate(candidate, {
      candidateKind: "linked_workstream"
    });
    const illegalKindResult = resealDerivationResult(derived.result, {
      candidates: [illegalKind]
    });
    const extraObservation = makeObservation({
      source: "github",
      identityKey: 32,
      recordKey: 32,
      workContextId: PROJECT_A
    });
    const illegalCardinality = resealCandidate(candidate, {
      sourceObservationIds: [
        candidate.sourceObservationIds[0]!,
        extraObservation.observationId
      ].sort(compareRuntimeStrings)
    });
    const illegalCardinalityResult = resealDerivationResult(derived.result, {
      resolutionCount: 2,
      admittedObservationCount: 2,
      candidates: [illegalCardinality]
    });

    expect(
      continuationCandidateDerivationResultSchema.safeParse(illegalKindResult)
        .success
    ).toBe(false);
    expect(
      continuationCandidateDerivationResultSchema.safeParse(
        illegalCardinalityResult
      ).success
    ).toBe(false);
  });

  it("authenticates a result by exact deterministic re-derivation from its sealed input", () => {
    const github = makeObservation({
      source: "github",
      identityKey: 41,
      recordKey: 41,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T10:00:00.000Z"
    });
    const codex = makeObservation({
      source: "codex",
      identityKey: 42,
      recordKey: 42,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z"
    });
    const identity = makeIdentityResult([
      makeResolution("mapped", github),
      makeResolution("mapped", codex)
    ]);
    const derivationEnvelope = envelope();
    const derived = deriveContinuationCandidates(identity, derivationEnvelope);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(
      verifyContinuationCandidateDerivationResultAgainstInput(
        identity,
        derivationEnvelope,
        derived.result
      )
    ).toBe(true);

    const linked = derived.result.candidates[0]!;
    const tamperedCandidates = [
      resealCandidate(linked, { workContextId: PROJECT_B }),
      resealCandidate(linked, {
        sourceObservationIds: [github.observationId, makeObservation({
          source: "codex",
          identityKey: 43,
          recordKey: 43,
          workContextId: PROJECT_A
        }).observationId].sort(compareRuntimeStrings)
      }),
      resealCandidate(linked, {
        caveatCodes: ["SOURCE_COVERAGE_PARTIAL"]
      }),
      resealCandidate(linked, {
        expiresAt: new Date(Date.parse(linked.expiresAt) - 60_000).toISOString()
      })
    ];
    for (const candidate of tamperedCandidates) {
      const tamperedResult = resealDerivationResult(derived.result, {
        candidates: [candidate]
      });
      expect(
        continuationCandidateDerivationResultSchema.safeParse(tamperedResult)
          .success
      ).toBe(true);
      expect(
        verifyContinuationCandidateDerivationResultAgainstInput(
          identity,
          derivationEnvelope,
          tamperedResult
        )
      ).toBe(false);
    }

    const setupIdentity = makeIdentityResult([
      makeResolution(
        "setup_needed",
        makeObservation({
          source: "github",
          identityKey: 44,
          recordKey: 44,
          workContextId: null
        })
      )
    ]);
    const setup = deriveContinuationCandidates(setupIdentity, derivationEnvelope);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    const wrongKind = resealCandidate(setup.result.candidates[0]!, {
      candidateKind: "recent_github_push",
      workContextId: PROJECT_A,
      localDisplayLabel: "Recent GitHub activity",
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      reasonCodes: ["EXPLICIT_MAPPING_CONFIRMED", "RECENT_GITHUB_ACTIVITY"],
      caveatCodes: ["TERMINAL_STATE_UNKNOWN"],
      privateActionTarget: null
    });
    const wrongKindResult = resealDerivationResult(setup.result, {
      setupCandidateCount: 0,
      setupReasons: [],
      candidates: [wrongKind]
    });
    expect(
      continuationCandidateDerivationResultSchema.safeParse(wrongKindResult)
        .success
    ).toBe(true);
    expect(
      verifyContinuationCandidateDerivationResultAgainstInput(
        setupIdentity,
        derivationEnvelope,
        wrongKindResult
      )
    ).toBe(false);

    const reboundResult = resealDerivationResult(derived.result, {
      identityResultSha256: "f".repeat(64)
    });
    expect(
      continuationCandidateDerivationResultSchema.safeParse(reboundResult)
        .success
    ).toBe(true);
    expect(
      verifyContinuationCandidateDerivationResultAgainstInput(
        identity,
        derivationEnvelope,
        reboundResult
      )
    ).toBe(false);
  });

  it("rejects reuse at a later asOf instead of trusting a formerly fresh snapshot", () => {
    const observation = makeObservation({
      source: "github",
      identityKey: 45,
      recordKey: 45,
      workContextId: PROJECT_A,
      observedAt: "2026-08-12T11:00:00.000Z",
      snapshotCapturedAt: "2026-08-12T11:01:00.000Z"
    });
    const identity = makeIdentityResult([makeResolution("mapped", observation)]);
    const original = deriveContinuationCandidates(identity, envelope());
    const sixDaysLater = "2026-08-18T12:00:00.000Z";

    expect(original.ok).toBe(true);
    expect(deriveContinuationCandidates(identity, envelope(sixDaysLater))).toEqual({
      ok: false,
      code: "CANDIDATE_DERIVATION_INPUT_REJECTED"
    });
  });

  it("makes every exported derivation schema fail closed for non-canonical hostile values", () => {
    const throwingContract = Object.defineProperty({}, "contract", {
      get(): never {
        throw new Error("hostile contract getter");
      }
    });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const hostileValues: unknown[] = [
      throwingContract,
      BigInt(1),
      Number.NaN,
      undefined,
      cycle
    ];
    const boundaries = [
      (value: unknown) =>
        continuationCandidateDerivationEnvelopeSchema.safeParse(value),
      (value: unknown) =>
        continuationCandidateDerivationResultContentSchema.safeParse(value),
      (value: unknown) =>
        continuationCandidateDerivationResultSchema.safeParse(value)
    ];

    for (const parse of boundaries) {
      for (const value of hostileValues) {
        expect(() => parse(value)).not.toThrow();
        expect(parse(value).success).toBe(false);
      }
    }
  });
});

type ObservationSource = "github" | "codex" | "local_git";
type ResolutionStatus = "mapped" | "setup_needed" | "conflict";

function envelope(asOf = AS_OF) {
  return {
    contract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    asOf,
    config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
  };
}

function makeObservation(input: {
  source: ObservationSource;
  identityKey: number;
  recordKey: number;
  workContextId: string | null;
  observedAt?: string;
  snapshotCapturedAt?: string;
  expiresAt?: string;
  sourceCoverage?: "complete" | "partial" | "unknown";
  snapshotFreshness?: "fresh" | "stale" | "invalid" | "unknown";
  terminalState?: "active" | "terminal" | "unknown";
  conflictCodes?: string[];
  errorCodes?: string[];
  boundedActivityCount?: number;
  boundedSummaryAvailable?: boolean;
}): ContinuationObservation {
  const observedAt = input.observedAt ?? "2026-08-12T11:00:00.000Z";
  const snapshotCapturedAt =
    input.snapshotCapturedAt ??
    new Date(Date.parse(observedAt) + 60_000).toISOString();
  const expiresAt =
    input.expiresAt ??
    new Date(Date.parse(observedAt) + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const sourceIdentity = sourceIdentityFor(input.source, input.identityKey);
  const sourceRecordRef = `source_record_ref_${hex(input.recordKey + 1_000, 32)}`;
  const observationId = createContinuationObservationId({
    sourceIdentity,
    sourceRecordRef,
    observedAt
  });
  const versions = sourceVersions(input.source);
  const payload =
    input.source === "github"
      ? { kind: "github_push" as const, pushOccurredAt: observedAt }
      : input.source === "codex"
        ? {
            kind: "codex_session_activity" as const,
            sessionUpdatedAt: observedAt,
            boundedActivityCount: input.boundedActivityCount ?? 1,
            boundedSummaryAvailable: input.boundedSummaryAvailable ?? true
          }
        : {
            kind: "local_git_state" as const,
            lastCommitAt: observedAt,
            trackingState: "in_sync" as const,
            dirtyCount: 0
          };
  return sealContinuationObservation({
    contract: "continuation-observation-v0.2",
    schemaVersion: "continuation-observation-schema-v0.2",
    observationId,
    observationIdPolicyVersion: "continuation-observation-id-policy-v0.2",
    sourceIdentity,
    sourceRecordRef,
    ...versions,
    sourceSnapshotSha256: hex(input.recordKey + 2_000, 64),
    workContextId: input.workContextId,
    payload,
    observedAt,
    snapshotCapturedAt,
    expiresAt,
    activityWindowPolicyVersion: "continuation-activity-window-7d-v0.1",
    snapshotFreshnessPolicyVersion:
      "continuation-source-freshness-policy-v0.1",
    sourceCoverage: input.sourceCoverage ?? "complete",
    snapshotFreshness: input.snapshotFreshness ?? "fresh",
    terminalState: input.terminalState ?? "active",
    evidenceRefs: [`evidence_${hex(input.recordKey + 3_000, 32)}`],
    conflictCodes: input.conflictCodes ?? [],
    errorCodes: input.errorCodes ?? []
  });
}

function sourceVersions(source: ObservationSource) {
  if (source === "github") {
    return {
      sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION
    };
  }
  if (source === "codex") {
    return {
      sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION
    };
  }
  return {
    sourceSchemaVersion: CONTINUATION_LOCAL_GIT_SOURCE_SCHEMA_VERSION,
    adapterVersion: CONTINUATION_LOCAL_GIT_ADAPTER_VERSION
  };
}

function sourceIdentityFor(
  source: ObservationSource,
  identityKey: number
): ContinuationSourceIdentity {
  const opaqueId = `source_ref_${hex(identityKey, 32)}`;
  if (source === "github") return { source: "github", opaqueId };
  if (source === "codex") return { source: "codex", opaqueId };
  return { source: "local_git", opaqueId };
}

function makeResolution(
  status: ResolutionStatus,
  observation: ContinuationObservation
) {
  const reasonCode =
    status === "mapped"
      ? "EXPLICIT_MAPPING_CONFIRMED"
      : status === "setup_needed"
        ? "IDENTITY_MAPPING_NOT_CONFIRMED"
        : "IDENTITY_BINDING_CONFLICT";
  return {
    observationId: observation.observationId,
    status,
    workContextId: observation.workContextId,
    reasonCodes: [reasonCode],
    observation
  } as const;
}

function makeIdentityResult(
  resolutionsInput: ReturnType<typeof makeResolution>[],
  freshnessEvaluation: {
    evaluatedAsOf: string;
    snapshotFreshnessCutoff: string;
  } = {
    evaluatedAsOf: AS_OF,
    snapshotFreshnessCutoff: "2026-08-12T10:00:00.000Z"
  }
): ContinuationIdentityResult {
  const resolutions = [...resolutionsInput].sort((left, right) =>
    compareRuntimeStrings(left.observationId, right.observationId)
  );
  const content = {
    contract: CONTINUATION_IDENTITY_RESULT_CONTRACT,
    schemaVersion: CONTINUATION_IDENTITY_SCHEMA_VERSION,
    identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
    registryContract: WORK_CONTEXT_REGISTRY_CONTRACT,
    registrySha256: "a".repeat(64),
    sourceBatchSha256s: [...new Set(
      resolutions.map((resolution) => resolution.observation.sourceIdentity.source)
    )]
      .filter((source): source is "github" | "codex" =>
        source === "github" || source === "codex"
      )
      .sort(compareRuntimeStrings)
      .map(sourceBatchSha256)
      .sort(compareRuntimeStrings),
    sourceFreshnessEvaluations: [...new Set(
      resolutions.map((resolution) => resolution.observation.sourceIdentity.source)
    )]
      .filter((source): source is "github" | "codex" =>
        source === "github" || source === "codex"
      )
      .sort(compareRuntimeStrings)
      .map((source) => ({
        source,
        batchSha256: sourceBatchSha256(source),
        evaluatedAsOf: freshnessEvaluation.evaluatedAsOf,
        snapshotFreshnessCutoff: freshnessEvaluation.snapshotFreshnessCutoff
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

function identityResultSha256(result: ContinuationIdentityResult): string {
  const { resultSha256: _resultSha256, ...content } = result;
  return runtimeSha256({
    domain: "continuation-identity-result-hash-v0.4",
    result: content
  });
}

function sourceBatchSha256(source: "github" | "codex"): string {
  return source === "github" ? "b".repeat(64) : "c".repeat(64);
}

function resealCandidate(
  candidate: ContinuationCandidate,
  changes: Partial<ContinuationCandidateContent>
): ContinuationCandidate {
  const { candidateSha256: _candidateSha256, ...content } = candidate;
  const changedContent: ContinuationCandidateContent = {
    ...content,
    ...changes
  };
  const identifiedContent: ContinuationCandidateContent = {
    ...changedContent,
    candidateId: createContinuationCandidateId(changedContent)
  };
  return {
    ...identifiedContent,
    candidateSha256: continuationCandidateSha256(identifiedContent)
  };
}

function resealDerivationResult(
  result: ContinuationCandidateDerivationResult,
  changes: Partial<ContinuationCandidateDerivationResultContent>
): ContinuationCandidateDerivationResult {
  const { resultSha256: _resultSha256, ...content } = result;
  const changedContent: ContinuationCandidateDerivationResultContent = {
    ...content,
    ...changes
  };
  return {
    ...changedContent,
    resultSha256:
      continuationCandidateDerivationResultSha256(changedContent)
  };
}

function projectId(value: number): string {
  return `project_${hex(value, 32)}`;
}

function hex(value: number, length: number): string {
  return value.toString(16).padStart(length, "0");
}

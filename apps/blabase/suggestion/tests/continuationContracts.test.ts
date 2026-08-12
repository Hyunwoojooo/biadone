import { describe, expect, it } from "vitest";

import {
  continuationCandidateSchema,
  continuationDecisionSchema,
  continuationDecisionSemanticSha256,
  continuationDecisionSha256,
  continuationInputSchema,
  continuationObservationSchema,
  continuationPublicDecisionSchema,
  createContinuationCandidateId,
  createContinuationObservationId,
  createPrivateContinuationActionOfferId,
  privateContinuationActionOfferSchema,
  sealContinuationCandidate,
  sealContinuationDecision,
  sealContinuationInput,
  sealContinuationObservation,
  sealPrivateContinuationActionOffer,
  verifyContinuationCandidateIntegrity,
  verifyContinuationDecisionIntegrity,
  verifyContinuationInputIntegrity,
  verifyContinuationObservationIntegrity,
  verifyPrivateContinuationActionOfferIntegrity
} from "../src/continuation/contracts";
import {
  CONTINUATION_ACTION_OFFER_SCHEMA_VERSION,
  CONTINUATION_ACTION_POLICY_VERSION,
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION,
  CONTINUATION_INPUT_CONTRACT,
  CONTINUATION_INPUT_SCHEMA_VERSION,
  CONTINUATION_OBSERVATION_CONTRACT,
  CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
  CONTINUATION_OBSERVATION_SCHEMA_VERSION,
  CONTINUATION_PRIVATE_ACTION_OFFER_CONTRACT,
  CONTINUATION_PUBLIC_DECISION_CONTRACT,
  CONTINUATION_PUBLIC_DECISION_SCHEMA_VERSION,
  CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../src/crossSource/versions";

const AS_OF = "2026-08-12T03:00:00.000Z";
const OBSERVED_AT = "2026-08-12T02:00:00.000Z";
const EXPIRES_AT = "2026-08-19T02:00:00.000Z";
const SOURCE_REF = `source_ref_${"1".repeat(32)}`;
const SOURCE_RECORD_REF = `source_record_ref_${"2".repeat(32)}`;
const WORK_CONTEXT_ID = `project_${"2".repeat(32)}`;
const EVIDENCE_REF = `evidence_${"3".repeat(32)}`;
const SHA = "a".repeat(64);

describe("Continuation contracts", () => {
  it("seals observations and inputs deterministically", () => {
    const firstObservation = githubObservation();
    const secondObservation = githubObservation();

    expect(secondObservation).toEqual(firstObservation);
    expect(continuationObservationSchema.safeParse(firstObservation).success).toBe(
      true
    );

    const firstInput = continuationInput([firstObservation]);
    const secondInput = continuationInput([secondObservation]);
    expect(secondInput).toEqual(firstInput);
    expect(continuationInputSchema.safeParse(firstInput).success).toBe(true);
  });

  it("keeps logical event IDs stable across snapshot refreshes and supporting evidence", () => {
    const original = githubObservation();
    const originalContent = withoutObservationHash(original);
    const refreshed = sealContinuationObservation({
      ...originalContent,
      snapshotCapturedAt: "2026-08-12T03:30:00.000Z",
      sourceSnapshotSha256: "b".repeat(64)
    });
    const withSupportingEvidence = sealContinuationObservation({
      ...originalContent,
      evidenceRefs: [EVIDENCE_REF, `evidence_${"4".repeat(32)}`]
    });

    expect(refreshed.observationId).toBe(original.observationId);
    expect(refreshed.observationSha256).not.toBe(original.observationSha256);
    expect(withSupportingEvidence.observationId).toBe(original.observationId);
    expect(withSupportingEvidence.observationSha256).not.toBe(
      original.observationSha256
    );
    expect(() =>
      sealContinuationObservation({
        ...originalContent,
        evidenceRefs: [`evidence_${"4".repeat(32)}`, EVIDENCE_REF]
      })
    ).toThrow(/canonical/i);
  });

  it("distinguishes same-time source records without storing an installation secret", () => {
    const first = githubObservation();
    const content = withoutObservationHash(first);
    const secondSourceRecordRef = `source_record_ref_${"5".repeat(32)}`;
    const second = sealContinuationObservation({
      ...content,
      sourceRecordRef: secondSourceRecordRef,
      observationId: createContinuationObservationId({
        sourceIdentity: content.sourceIdentity,
        sourceRecordRef: secondSourceRecordRef,
        observedAt: content.observedAt
      })
    });

    expect(second.observationId).not.toBe(first.observationId);
    expect(JSON.stringify(second)).not.toMatch(/installationSecret|hmacKey/u);
  });

  it("canonicalizes semantically equivalent observation times for logical IDs", () => {
    const sourceIdentity = {
      source: "github" as const,
      opaqueId: SOURCE_REF
    };
    const base = {
      sourceIdentity,
      sourceRecordRef: SOURCE_RECORD_REF
    };

    expect(
      createContinuationObservationId({
        ...base,
        observedAt: "2026-08-12T02:00:00.000Z"
      })
    ).toBe(
      createContinuationObservationId({
        ...base,
        observedAt: "2026-08-12T11:00:00.000+09:00"
      })
    );
    expect(() =>
      continuationObservationSchema.safeParse({
        ...githubObservation(),
        observedAt: "not-a-timestamp"
      })
    ).not.toThrow();
  });

  it("accepts metadata-only Codex observations with zero bounded activities", () => {
    const sourceIdentity = {
      source: "codex" as const,
      opaqueId: `source_ref_${"6".repeat(32)}`
    };
    const sourceRecordRef = `source_record_ref_${"7".repeat(32)}`;
    const payload = {
      kind: "codex_session_activity" as const,
      sessionUpdatedAt: OBSERVED_AT,
      boundedActivityCount: 0,
      boundedSummaryAvailable: false
    };
    const observation = sealContinuationObservation({
      contract: CONTINUATION_OBSERVATION_CONTRACT,
      schemaVersion: CONTINUATION_OBSERVATION_SCHEMA_VERSION,
      observationId: createContinuationObservationId({
        sourceIdentity,
        sourceRecordRef,
        observedAt: OBSERVED_AT
      }),
      observationIdPolicyVersion: CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
      sourceIdentity,
      sourceRecordRef,
      sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
      sourceSnapshotSha256: "b".repeat(64),
      workContextId: null,
      payload,
      observedAt: OBSERVED_AT,
      snapshotCapturedAt: AS_OF,
      expiresAt: EXPIRES_AT,
      activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
      snapshotFreshnessPolicyVersion:
        CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
      sourceCoverage: "partial",
      snapshotFreshness: "fresh",
      terminalState: "unknown",
      evidenceRefs: [`evidence_${"8".repeat(32)}`],
      conflictCodes: [],
      errorCodes: ["METADATA_ONLY"]
    });

    expect(observation.payload).toMatchObject({
      boundedActivityCount: 0,
      boundedSummaryAvailable: false
    });
  });

  it("rejects mixed provenance tuples and dependency provenance mismatches", () => {
    const observation = githubObservation();
    const content = withoutObservationHash(observation);

    expect(() =>
      sealContinuationObservation({
        ...content,
        sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION
      })
    ).toThrow(/exact supported tuple/i);

    const tamperedProvenance = {
      ...observation,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION
    };
    expect(() =>
      continuationObservationSchema.safeParse(tamperedProvenance)
    ).not.toThrow();
    expect(
      continuationObservationSchema.safeParse(tamperedProvenance).success
    ).toBe(false);

    const differentSnapshotObservation = sealContinuationObservation({
      ...content,
      sourceSnapshotSha256: "b".repeat(64)
    });
    expect(() => continuationInput([differentSnapshotObservation])).toThrow(
      /provenance/i
    );
  });

  it("rejects tampered hashes, stable IDs, versions, and unknown fields", () => {
    const observation = githubObservation();
    expect(
      continuationObservationSchema.safeParse({
        ...observation,
        observationSha256: "0".repeat(64)
      }).success
    ).toBe(false);
    expect(
      continuationObservationSchema.safeParse({
        ...observation,
        observationId: `continuation_observation_${"0".repeat(32)}`
      }).success
    ).toBe(false);
    expect(
      continuationObservationSchema.safeParse({
        ...observation,
        schemaVersion: "continuation-observation-schema-v9.9"
      }).success
    ).toBe(false);
    expect(
      continuationObservationSchema.safeParse({
        ...observation,
        repositoryUrl: "https://example.invalid/private/repo"
      }).success
    ).toBe(false);

    const malformedId = {
      ...observation,
      observationId: "malformed"
    };
    expect(() =>
      continuationObservationSchema.safeParse(malformedId)
    ).not.toThrow();
    expect(continuationObservationSchema.safeParse(malformedId).success).toBe(
      false
    );
    expect(() =>
      verifyContinuationObservationIntegrity(malformedId)
    ).not.toThrow();
    expect(verifyContinuationObservationIntegrity(malformedId)).toBe(false);

    const input = continuationInput([observation]);
    const mixedDependencyVersion = {
      ...input,
      dependencies: {
        ...input.dependencies,
        github: {
          ...input.dependencies.github,
          sourceSchemaVersion: "github-snapshot-v9"
        }
      }
    };
    expect(() =>
      continuationInputSchema.safeParse(mixedDependencyVersion)
    ).not.toThrow();
    expect(
      continuationInputSchema.safeParse(mixedDependencyVersion).success
    ).toBe(false);
  });

  it("requires canonical unique evidence and observation arrays", () => {
    const observation = githubObservation();
    const raw = withoutObservationHash(observation);
    expect(() =>
      sealContinuationObservation({
        ...raw,
        evidenceRefs: [EVIDENCE_REF, EVIDENCE_REF]
      })
    ).toThrow(/canonical/i);

    expect(() => continuationInput([observation, observation])).toThrow(
      /canonical/i
    );
  });

  it("enforces the exact 35/25/20/10/10 score contract", () => {
    const candidate = readyCandidate();
    expect(candidate.continuityScore).toBe(100);
    expect(candidate.scoreBreakdown).toEqual({
      recency: 35,
      exactCorroboration: 25,
      resumability: 20,
      localContinuity: 10,
      explicitPreference: 10
    });

    expect(() =>
      readyCandidate({
        continuityScore: 99
      })
    ).toThrow(/score/i);
    expect(() =>
      readyCandidate({
        scoreBreakdown: {
          recency: 36,
          exactCorroboration: 25,
          resumability: 20,
          localContinuity: 10,
          explicitPreference: 10
        }
      })
    ).toThrow();
  });

  it("keeps future capabilities internal and blocked", () => {
    const blocked = readyCandidate({
      capability: "prefill_prompt_draft",
      availability: "future_capability_blocked",
      privateActionTarget: null
    });
    expect(blocked.capability).toBe("prefill_prompt_draft");

    expect(() =>
      readyCandidate({
        capability: "resume_exact_session",
        availability: "ready",
        privateActionTarget: {
          capability: "resume_exact_session",
          targetRef: `private_target_${"7".repeat(32)}`
        }
      })
    ).toThrow(/future capability/i);

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...publicDecision(),
        primary: {
          ...publicDecision().primary,
          capability: "prefill_prompt_draft"
        }
      }).success
    ).toBe(false);
  });

  it("enforces decision status, ranking, diversity, and result integrity", () => {
    const primary = readyCandidate();
    const decision = decisionWith(primary);
    expect(verifyContinuationDecisionIntegrity(decision)).toBe(true);

    expect(
      continuationDecisionSchema.safeParse({
        ...decision,
        resultSha256: "0".repeat(64)
      }).success
    ).toBe(false);

    const nestedTamper = {
      ...decision,
      primary: {
        ...decision.primary!,
        candidateSha256: "0".repeat(64)
      }
    };
    expect(() => continuationDecisionSchema.safeParse(nestedTamper)).not.toThrow();
    expect(continuationDecisionSchema.safeParse(nestedTamper).success).toBe(false);
    expect(() => verifyContinuationDecisionIntegrity(nestedTamper)).not.toThrow();
    expect(verifyContinuationDecisionIntegrity(nestedTamper)).toBe(false);
    expect(() =>
      sealContinuationDecision({
        ...withoutDecisionHash(decision),
        status: "no_recent_context",
        primary
      })
    ).toThrow(/cannot carry/i);

    const lower = readyCandidate({
      sourceObservationIds: [
        `continuation_observation_${"8".repeat(32)}`
      ],
      workContextId: `project_${"9".repeat(32)}`,
      observedAt: "2026-08-12T01:00:00.000Z",
      continuityScore: 50,
      scoreBreakdown: {
        recency: 20,
        exactCorroboration: 10,
        resumability: 10,
        localContinuity: 5,
        explicitPreference: 5
      }
    });
    expect(() =>
      sealContinuationDecision({
        ...withoutDecisionHash(decision),
        primary: lower,
        alternatives: [primary]
      })
    ).toThrow(/ranked/i);
    expect(() =>
      sealContinuationDecision({
        ...withoutDecisionHash(decision),
        alternatives: [primary]
      })
    ).toThrow(/unique/i);
  });

  it("separates stable decision semantics from run and locator lineage", () => {
    const decision = decisionWith(readyCandidate());
    const replayed = sealContinuationDecision({
      ...withoutDecisionHash(decision),
      run: {
        ...decision.run,
        runId: `continuation_run_${"7".repeat(32)}`,
        analysisId: `analysis_${"8".repeat(32)}`,
        latencyMs: 2
      }
    });
    const relocated = decisionWith(
      readyCandidate({
        privateActionTarget: {
          capability: "open_source",
          targetRef: `private_target_${"9".repeat(32)}`
        }
      })
    );
    const renamed = decisionWith(
      readyCandidate({ localDisplayLabel: "BiaDone next" })
    );

    expect(decision.schemaVersion).toBe("continuation-decision-schema-v0.2");
    expect(continuationDecisionSemanticSha256(decision)).toBe(
      decision.semanticResultSha256
    );
    expect(replayed.semanticResultSha256).toBe(decision.semanticResultSha256);
    expect(replayed.resultSha256).not.toBe(decision.resultSha256);
    expect(relocated.semanticResultSha256).toBe(decision.semanticResultSha256);
    expect(relocated.resultSha256).not.toBe(decision.resultSha256);
    expect(renamed.semanticResultSha256).not.toBe(
      decision.semanticResultSha256
    );
    expect(renamed.resultSha256).not.toBe(decision.resultSha256);

    const semanticTamper = {
      ...decision,
      semanticResultSha256: "0".repeat(64)
    };
    const reboundResultSha256 = continuationDecisionSha256(semanticTamper);
    expect(reboundResultSha256).not.toBe(decision.resultSha256);
    expect(
      continuationDecisionSchema.safeParse({
        ...semanticTamper,
        resultSha256: reboundResultSha256
      }).success
    ).toBe(false);
    expect(() => continuationDecisionSchema.safeParse(semanticTamper)).not.toThrow();
    expect(continuationDecisionSchema.safeParse(semanticTamper).success).toBe(false);
    expect(verifyContinuationDecisionIntegrity(semanticTamper)).toBe(false);
  });

  it("fails closed without throwing for every sealed hash boundary", () => {
    const observation = githubObservation();
    const nonFiniteObservation = {
      ...observation,
      sourceIdentity: {
        source: "codex" as const,
        opaqueId: SOURCE_REF
      },
      payload: {
        kind: "codex_session_activity" as const,
        sessionUpdatedAt: OBSERVED_AT,
        boundedActivityCount: Number.POSITIVE_INFINITY,
        boundedSummaryAvailable: true
      }
    };
    const input = continuationInput([observation]);
    const candidate = readyCandidate();
    const decision = decisionWith(candidate);
    const offer = privateActionOffer(candidate.candidateId);
    const boundaries = [
      {
        parse: () => continuationObservationSchema.safeParse(nonFiniteObservation),
        verify: () =>
          verifyContinuationObservationIntegrity(nonFiniteObservation)
      },
      {
        parse: () =>
          continuationInputSchema.safeParse({
            ...input,
            observations: [nonFiniteObservation]
          }),
        verify: () =>
          verifyContinuationInputIntegrity({
            ...input,
            observations: [nonFiniteObservation]
          })
      },
      {
        parse: () =>
          continuationCandidateSchema.safeParse({
            ...candidate,
            continuityScore: Number.POSITIVE_INFINITY
          }),
        verify: () =>
          verifyContinuationCandidateIntegrity({
            ...candidate,
            continuityScore: Number.POSITIVE_INFINITY
          })
      },
      {
        parse: () =>
          continuationDecisionSchema.safeParse({
            ...decision,
            run: { ...decision.run, latencyMs: Number.NaN }
          }),
        verify: () =>
          verifyContinuationDecisionIntegrity({
            ...decision,
            run: { ...decision.run, latencyMs: Number.NaN }
          })
      },
      {
        parse: () =>
          privateContinuationActionOfferSchema.safeParse({
            ...offer,
            nonCanonicalValue: undefined
          }),
        verify: () =>
          verifyPrivateContinuationActionOfferIntegrity({
            ...offer,
            nonCanonicalValue: undefined
          })
      }
    ];

    for (const boundary of boundaries) {
      expect(() => boundary.parse()).not.toThrow();
      expect(boundary.parse().success).toBe(false);
      expect(() => boundary.verify()).not.toThrow();
      expect(boundary.verify()).toBe(false);
    }
  });

  it("requires live candidates and compatible run and capability states", () => {
    const primary = readyCandidate();
    const decision = decisionWith(primary);
    const content = withoutDecisionHash(decision);

    expect(() =>
      decisionWith(
        readyCandidate({
          expiresAt: AS_OF
        })
      )
    ).toThrow(/decision time/i);

    expect(() =>
      sealContinuationDecision({
        ...content,
        run: { ...content.run, status: "failed" }
      })
    ).toThrow(/run status/i);

    const setupCandidate = readyCandidate({
      evidenceBand: "setup",
      capability: "open_setup_surface",
      availability: "setup_required",
      privateActionTarget: {
        capability: "open_setup_surface",
        targetRef: `private_target_${"7".repeat(32)}`
      }
    });
    expect(() => decisionWith(setupCandidate)).toThrow(/available capabilities/i);
    expect(() =>
      sealContinuationDecision({
        ...content,
        status: "setup_required"
      })
    ).toThrow(/setup/i);

    expect(() =>
      sealContinuationDecision({
        ...content,
        status: "unavailable",
        primary: null,
        alternatives: [],
        coverageCode: "UNAVAILABLE"
      })
    ).toThrow(/run status/i);
  });

  it("keeps the public projection free of private provenance and future actions", () => {
    const projection = continuationPublicDecisionSchema.parse(publicDecision());
    const json = JSON.stringify(projection);
    expect(json).not.toMatch(
      /sourceIdentity|sourceObservationIds|evidenceRefs|privateActionTarget|runId|analysisId|inputSha256|resultSha256|semanticResultSha256|snapshotSha256|repositoryUrl|filePath|sessionId|commitSha/u
    );
    expect(projection.schemaVersion).toBe(
      "continuation-public-decision-schema-v0.1"
    );
    expect(projection.primary?.capability).toBe("open_source");

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...publicDecision(),
        sourceIdentity: { source: "github", opaqueId: SOURCE_REF }
      }).success
    ).toBe(false);
  });

  it("rejects sensitive public title and summary text but allows normal labels", () => {
    const sensitiveValues = [
      "unsafe\u0000text",
      "https://example.invalid/private/repo",
      "file:///Users/joo/private/repo",
      "/Users/joo/private/repo",
      "C:\\Users\\joo\\private\\repo",
      "C:/Users/joo/private/repo",
      "\\\\server\\share\\private",
      "//server/share/private",
      "ssh://git@example.invalid/org/repo.git",
      "git://example.invalid/org/repo.git",
      "git@example.invalid:org/repo.git",
      "경로(/Users/joo/private)",
      "share(\\\\server\\share)",
      "share(//server/share)",
      "경로(C:/Users/joo/private)",
      "경로(C:\\Users\\joo\\private)",
      "path=/Users/joo/private",
      "path=\\\\server\\share",
      "path=//server/share",
      "path=C:/Users/joo/private",
      "path=C:\\Users\\joo\\private",
      "path=`/Users/joo/private`",
      "A".repeat(40),
      "session_native-secret"
    ];

    for (const field of ["title", "summary"] as const) {
      for (const value of sensitiveValues) {
        const fixture = publicDecision();
        expect(
          continuationPublicDecisionSchema.safeParse({
            ...fixture,
            primary: { ...fixture.primary, [field]: value }
          }).success
        ).toBe(false);
      }
    }

    const safeFixture = publicDecision();
    expect(
      continuationPublicDecisionSchema.safeParse({
        ...safeFixture,
        primary: {
          ...safeFixture.primary,
          title: "비아던 프로젝트",
          summary: "최근 GitHub 작업으로 안전하게 돌아갈 수 있습니다."
        }
      }).success
    ).toBe(true);

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...safeFixture,
        primary: {
          ...safeFixture.primary,
          title: "작업: biadone",
          summary:
            "최근 작업(owner/repo)을 확인하고 A / B 중에서 선택합니다."
        }
      }).success
    ).toBe(true);
  });

  it("enforces public freshness, bounded action expiry, and lane capability", () => {
    const fixture = publicDecision();

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...fixture,
        coverageCode: "UNAVAILABLE"
      }).success
    ).toBe(false);

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...fixture,
        primary: {
          ...fixture.primary,
          expiresAt: AS_OF,
          action: { ...fixture.primary.action, expiresAt: AS_OF }
        }
      }).success
    ).toBe(false);

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...fixture,
        primary: {
          ...fixture.primary,
          expiresAt: "2026-08-18T02:00:00.000Z",
          action: { ...fixture.primary.action, expiresAt: EXPIRES_AT }
        }
      }).success
    ).toBe(false);

    expect(
      continuationPublicDecisionSchema.safeParse({
        ...fixture,
        primary: {
          ...fixture.primary,
          action: { ...fixture.primary.action, expiresAt: AS_OF }
        }
      }).success
    ).toBe(false);

    const setupPrimary = {
      ...fixture.primary,
      evidenceBand: "setup",
      capability: "open_setup_surface",
      action: {
        ...fixture.primary.action,
        capability: "open_setup_surface"
      }
    };
    expect(
      continuationPublicDecisionSchema.safeParse({
        ...fixture,
        primary: setupPrimary
      }).success
    ).toBe(false);
    expect(
      continuationPublicDecisionSchema.safeParse({
        ...fixture,
        status: "setup_required",
        primary: fixture.primary
      }).success
    ).toBe(false);
  });
});

function githubObservation() {
  const sourceIdentity = {
    source: "github" as const,
    opaqueId: SOURCE_REF
  };
  const payload = {
    kind: "github_push" as const,
    pushOccurredAt: OBSERVED_AT
  };
  return sealContinuationObservation({
    contract: CONTINUATION_OBSERVATION_CONTRACT,
    schemaVersion: CONTINUATION_OBSERVATION_SCHEMA_VERSION,
    observationId: createContinuationObservationId({
      sourceIdentity,
      sourceRecordRef: SOURCE_RECORD_REF,
      observedAt: OBSERVED_AT
    }),
    observationIdPolicyVersion: CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
    sourceIdentity,
    sourceRecordRef: SOURCE_RECORD_REF,
    sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
    adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
    sourceSnapshotSha256: SHA,
    workContextId: WORK_CONTEXT_ID,
    payload,
    observedAt: OBSERVED_AT,
    snapshotCapturedAt: AS_OF,
    expiresAt: EXPIRES_AT,
    activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion:
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    sourceCoverage: "complete",
    snapshotFreshness: "fresh",
    terminalState: "active",
    evidenceRefs: [EVIDENCE_REF],
    conflictCodes: [],
    errorCodes: []
  });
}

function continuationInput(observations: ReturnType<typeof githubObservation>[]) {
  return sealContinuationInput({
    contract: CONTINUATION_INPUT_CONTRACT,
    schemaVersion: CONTINUATION_INPUT_SCHEMA_VERSION,
    asOf: AS_OF,
    dependencies: dependencies(),
    contextLinks: [],
    observations
  });
}

function dependencies() {
  return {
    identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
    activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion:
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    ruleVersion: CONTINUATION_RULE_VERSION,
    scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    resolverVersion: CONTINUATION_RESOLVER_VERSION,
    actionPolicyVersion: CONTINUATION_ACTION_POLICY_VERSION,
    publicProjectionPolicyVersion:
      CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
    workContextRegistryContract: "work-context-registry-v1" as const,
    workContextRegistrySha256: SHA,
    github: {
      state: "available" as const,
      source: "github" as const,
      sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
      snapshotSha256: SHA
    },
    codex: {
      state: "available" as const,
      source: "codex" as const,
      sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
      snapshotSha256: "b".repeat(64)
    },
    configSha256: "c".repeat(64)
  };
}

function readyCandidate(
  override: Partial<Parameters<typeof sealContinuationCandidate>[0]> = {}
) {
  const sourceObservationIds = override.sourceObservationIds ?? [
    githubObservation().observationId
  ];
  const candidateKind = override.candidateKind ?? "recent_github_push";
  const workContextId =
    override.workContextId === undefined
      ? WORK_CONTEXT_ID
      : override.workContextId;
  const observedAt = override.observedAt ?? OBSERVED_AT;
  const base = {
    contract: CONTINUATION_CANDIDATE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    candidateKind,
    workContextId,
    sourceObservationIds,
    localDisplayLabel: "BiaDone",
    observedAt,
    expiresAt: EXPIRES_AT,
    evidenceBand: "exact" as const,
    capability: "open_source" as const,
    availability: "ready" as const,
    continuityScore: 100,
    scoreBreakdown: {
      recency: 35,
      exactCorroboration: 25,
      resumability: 20,
      localContinuity: 10,
      explicitPreference: 10
    },
    reasonCodes: ["RECENT_DIRECT_ACTIVITY"],
    caveatCodes: [],
    privateActionTarget: {
      capability: "open_source" as const,
      targetRef: `private_target_${"4".repeat(32)}`
    },
    ...override
  };
  return sealContinuationCandidate({
    ...base,
    candidateId: createContinuationCandidateId({
      candidateKind: base.candidateKind,
      workContextId: base.workContextId,
      sourceObservationIds: base.sourceObservationIds,
      observedAt: base.observedAt
    })
  });
}

function decisionWith(primary: ReturnType<typeof readyCandidate>) {
  return sealContinuationDecision({
    contract: CONTINUATION_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_DECISION_SCHEMA_VERSION,
    asOf: AS_OF,
    status: "offers_available",
    primary,
    alternatives: [],
    coverageCode: "COMPLETE",
    reasonCodes: ["CONTINUATION_AVAILABLE"],
    run: {
      runId: `continuation_run_${"5".repeat(32)}`,
      analysisId: `analysis_${"6".repeat(32)}`,
      startedAt: "2026-08-12T02:59:59.000Z",
      completedAt: AS_OF,
      status: "completed",
      codeCommitSha: "d".repeat(40),
      inputSha256: continuationInput([githubObservation()]).inputSha256,
      dependencies: dependencies(),
      datasetVersion: null,
      datasetSha256: null,
      observationCount: 1,
      admittedCandidateCount: 1,
      excludedCandidateCount: 0,
      errors: [],
      latencyMs: 1,
      tokenUsage: null
    }
  });
}

function publicDecision() {
  return {
    contract: CONTINUATION_PUBLIC_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_PUBLIC_DECISION_SCHEMA_VERSION,
    generatedAt: AS_OF,
    status: "offers_available" as const,
    primary: {
      itemRef: `item_ref_${"A".repeat(24)}`,
      workContextRef: `context_ref_${"B".repeat(24)}`,
      kind: "recent_github_push" as const,
      title: "BiaDone",
      summary: "Recent GitHub activity is available to reopen.",
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      evidenceBand: "single_source" as const,
      capability: "open_source" as const,
      action: {
        contract: "continuation-public-action-ref-v0.1" as const,
        actionRef: `action_ref_${"C".repeat(24)}`,
        capability: "open_source" as const,
        expiresAt: EXPIRES_AT,
        explicitUserActionRequired: true as const
      },
      caveatCodes: ["RECENT_ACTIVITY_NOT_URGENCY"]
    },
    alternatives: [],
    coverageCode: "COMPLETE" as const
  };
}

function privateActionOffer(candidateId: string) {
  const actionRef = `action_ref_${"D".repeat(24)}`;
  const capability = "open_source" as const;
  const issuedAt = AS_OF;
  return sealPrivateContinuationActionOffer({
    contract: CONTINUATION_PRIVATE_ACTION_OFFER_CONTRACT,
    schemaVersion: CONTINUATION_ACTION_OFFER_SCHEMA_VERSION,
    offerId: createPrivateContinuationActionOfferId({
      actionRef,
      candidateId,
      capability,
      issuedAt
    }),
    actionRef,
    candidateId,
    capability,
    privateActionTarget: {
      capability,
      targetRef: `private_target_${"4".repeat(32)}`
    },
    issuedAt,
    expiresAt: EXPIRES_AT,
    explicitUserActionRequired: true,
    automaticExecutionAllowed: false,
    externalMutationAllowed: false,
    oneTimeUse: true
  });
}

function withoutObservationHash(observation: ReturnType<typeof githubObservation>) {
  const { observationSha256: _observationSha256, ...content } = observation;
  return content;
}

function withoutDecisionHash(decision: ReturnType<typeof decisionWith>) {
  const {
    semanticResultSha256: _semanticResultSha256,
    resultSha256: _resultSha256,
    ...content
  } = decision;
  return content;
}

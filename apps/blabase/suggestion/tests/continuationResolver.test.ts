import { describe, expect, it } from "vitest";

import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity
} from "../src/context/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256
} from "../src/crossSource/canonicalHash";
import {
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
  CONTINUATION_RESOLUTION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import {
  adaptCodexContinuationObservations,
  adaptGitHubContinuationObservations,
  type ContinuationSourceAdapterBatch
} from "../src/continuation/adapters";
import {
  continuationDecisionSemanticSha256,
  sealContinuationCandidate,
  sealContinuationDecision,
} from "../src/continuation/contracts";
import {
  CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
  deriveContinuationCandidates,
  type ContinuationCandidateDerivationResult
} from "../src/continuation/deriveCandidates";
import {
  createContinuationIdentityInput,
  resolveContinuationIdentity,
  type ContinuationIdentityInput,
  type ContinuationIdentityResult
} from "../src/continuation/resolveIdentity";
import {
  CONTINUATION_RESOLUTION_CONFIG,
  continuationResolvedDecisionSha256,
  continuationResolvedDecisionSchema,
  continuationResolutionConfigSha256,
  continuationResolutionEnvelopeSchema,
  resolveContinuation,
  verifyContinuationDecisionAgainstInput,
  type ContinuationResolutionEnvelope,
  type ContinuationResolvedDecision
} from "../src/continuation/resolveContinuation";

const SECRET = "synthetic-r003-installation-secret";
const AS_OF = "2026-08-13T12:00:00.000Z";
const OPTIONS = {
  installationSecret: SECRET,
  asOf: AS_OF,
  snapshotFreshnessCutoff: "2026-08-13T10:00:00.000Z"
};
const RESOLUTION_OPTIONS = {
  installationSecret: SECRET,
  expectedCodeCommitSha: "d".repeat(40),
  expectedDatasetVersion: null,
  expectedDatasetSha256: null
};
const PROJECT_A = projectId(1);

describe("Continuation R-003 resolver", () => {
  it("selects an exact linked ready candidate with complete coverage", () => {
    const fixture = linkedFixture();
    const resolved = run(fixture);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.result.decision).toMatchObject({
      status: "offers_available",
      coverageCode: "COMPLETE",
      reasonCodes: ["CONTINUATION_AVAILABLE"],
      primary: {
        candidateKind: "linked_workstream",
        evidenceBand: "corroborated",
        continuityScore: 60,
        capability: "display",
        privateActionTarget: null
      },
      alternatives: [],
      run: {
        status: "completed",
        observationCount: 2,
        admittedCandidateCount: 1,
        excludedCandidateCount: 0,
        errors: [],
        latencyMs: 10
      }
    });
    expect(resolved.result.decision.run.dependencies.configSha256).toBe(
      continuationResolutionConfigSha256()
    );
    expect(
      verifyContinuationDecisionAgainstInput(
        fixture.identityInput,
        fixture.identityResult,
        fixture.derivationEnvelope,
        fixture.derivationResult,
        fixture.resolutionEnvelope,
        resolutionOptions(fixture),
        resolved.result
      )
    ).toBe(true);
  });

  it("gives the ready pool absolute precedence over setup", () => {
    const registry = confirmGitHubMapping(registryWithProjects([PROJECT_A]));
    const fixture = buildFixture(registry, [
      adaptCodexContinuationObservations(codexSnapshot(), OPTIONS),
      adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS)
    ]);
    const resolved = run(fixture);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.result.decision.status).toBe("offers_available");
    expect(resolved.result.decision.coverageCode).toBe("COMPLETE");
    expect(resolved.result.decision.primary?.candidateKind).toBe("recent_github_push");
    expect(resolved.result.decision.primary?.availability).toBe("ready");
    expect(resolved.result.decision.alternatives).toEqual([]);
  });

  it("downgrades an otherwise ready offer when global source coverage is partial", () => {
    const registry = confirmGitHubMapping(registryWithProjects([PROJECT_A]));
    const partialCodex = codexSnapshot();
    partialCodex.truncated = true;
    const fixture = buildFixture(registry, [
      adaptCodexContinuationObservations(partialCodex, OPTIONS),
      adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS)
    ]);
    const resolved = run(fixture);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.result.decision).toMatchObject({
      status: "offers_available",
      coverageCode: "SOURCE_LOCAL_PARTIAL",
      primary: { candidateKind: "recent_github_push" }
    });
  });

  it("keeps a valid offer but downgrades coverage when another source row is excluded", () => {
    const registry = confirmGitHubMapping(registryWithProjects([PROJECT_A]));
    const github = githubSnapshot();
    github.activities.push({
      ...github.activities[0]!,
      id: "future-push-event",
      occurredAt: "2026-08-13T12:00:00.001Z"
    });
    const fixture = buildFixture(registry, [
      adaptCodexContinuationObservations(codexSnapshot(), OPTIONS),
      adaptGitHubContinuationObservations(github, OPTIONS)
    ]);
    const resolved = run(fixture);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.result.decision).toMatchObject({
      status: "offers_available",
      coverageCode: "SOURCE_LOCAL_PARTIAL",
      primary: { candidateKind: "recent_github_push" }
    });
  });

  it("keeps multiple null-WorkContext setup candidates and selects at most three", () => {
    const snapshot = githubSnapshot(4);
    const fixture = buildFixture(
      registryWithProjects([]),
      [
        adaptCodexContinuationObservations(codexSnapshot(), OPTIONS),
        adaptGitHubContinuationObservations(snapshot, OPTIONS)
      ]
    );
    const resolved = run(fixture);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const selected = [resolved.result.decision.primary!, ...resolved.result.decision.alternatives];
    expect(resolved.result.decision.status).toBe("setup_required");
    expect(resolved.result.decision.coverageCode).toBe("SOURCE_LOCAL_PARTIAL");
    expect(selected).toHaveLength(3);
    expect(selected.every((candidate) => candidate.workContextId === null)).toBe(true);
    expect(selected.every((candidate) => candidate.availability === "setup_required")).toBe(true);
  });

  it("implements exact unavailable, insufficient, and conservative no-recent states", () => {
    const unavailable = buildFixture(registryWithProjects([]), [
      adaptCodexContinuationObservations({}, OPTIONS),
      adaptGitHubContinuationObservations({}, OPTIONS)
    ]);
    const unavailableResult = run(unavailable);
    expect(unavailableResult.ok).toBe(true);
    if (!unavailableResult.ok) return;
    expect(unavailableResult.result.decision).toMatchObject({
      status: "unavailable",
      coverageCode: "UNAVAILABLE",
      primary: null,
      alternatives: [],
      reasonCodes: ["CONTINUATION_SOURCES_UNAVAILABLE"],
      run: {
        status: "failed",
        errors: [{
          code: "CONTINUATION_SOURCES_UNAVAILABLE",
          stage: "resolve",
          sanitizedDetail: null
        }]
      }
    });
    const impossibleInsufficient = sealContinuationDecision({
      ...withoutDecisionHashes(unavailableResult.result.decision),
      status: "insufficient_evidence",
      coverageCode: "INSUFFICIENT",
      reasonCodes: ["INSUFFICIENT_CONTINUATION_EVIDENCE"],
      run: {
        ...unavailableResult.result.decision.run,
        status: "partial",
        errors: [{
          code: "CONTINUATION_SOURCE_QUALITY_INSUFFICIENT",
          stage: "candidate",
          sanitizedDetail: null
        }]
      }
    });
    expect(continuationResolvedDecisionSchema.safeParse(
      resealResolvedArtifact({
        ...unavailableResult.result,
        decision: impossibleInsufficient
      })
    ).success).toBe(false);

    const noActivities = githubSnapshot();
    noActivities.activitiesState = "unavailable";
    noActivities.activities = [];
    const insufficient = buildFixture(registryWithProjects([]), [
      adaptCodexContinuationObservations({}, OPTIONS),
      adaptGitHubContinuationObservations(noActivities, OPTIONS)
    ]);
    const insufficientResult = run(insufficient);
    expect(insufficientResult.ok).toBe(true);
    if (!insufficientResult.ok) return;
    expect(insufficientResult.result.decision).toMatchObject({
      status: "insufficient_evidence",
      coverageCode: "INSUFFICIENT",
      reasonCodes: ["INSUFFICIENT_CONTINUATION_EVIDENCE"],
      run: {
        status: "partial",
        errors: [{
          code: "CONTINUATION_SOURCE_QUALITY_INSUFFICIENT",
          stage: "candidate",
          sanitizedDetail: null
        }]
      }
    });

    const emptyGitHub = githubSnapshot();
    emptyGitHub.activities = [];
    const emptyCodex = codexSnapshot();
    emptyCodex.sessions = [];
    const noActivity = buildFixture(registryWithProjects([]), [
      adaptCodexContinuationObservations(emptyCodex, OPTIONS),
      adaptGitHubContinuationObservations(emptyGitHub, OPTIONS)
    ]);
    const noRecent = run(noActivity);
    expect(noRecent.ok).toBe(true);
    if (!noRecent.ok) return;
    expect(noRecent.result.decision).toMatchObject({
      status: "no_recent_context",
      coverageCode: "COMPLETE",
      primary: null,
      alternatives: [],
      reasonCodes: ["NO_RECENT_CONTEXT"],
      run: {
        status: "completed",
        observationCount: 0,
        admittedCandidateCount: 0,
        excludedCandidateCount: 0,
        errors: []
      }
    });

    const oldGitHub = githubSnapshot();
    oldGitHub.activities[0]!.occurredAt = "2026-08-06T12:00:00.000Z";
    const oldCodex = codexSnapshot();
    oldCodex.sessions[0]!.createdAt = "2026-08-06T11:00:00.000Z";
    oldCodex.sessions[0]!.updatedAt = "2026-08-06T12:00:00.000Z";
    const outsideWindow = run(buildFixture(registryWithProjects([]), [
      adaptCodexContinuationObservations(oldCodex, OPTIONS),
      adaptGitHubContinuationObservations(oldGitHub, OPTIONS)
    ]));
    expect(outsideWindow.ok).toBe(true);
    if (!outsideWindow.ok) return;
    expect(outsideWindow.result.decision).toMatchObject({
      status: "no_recent_context",
      coverageCode: "COMPLETE",
      primary: null,
      alternatives: [],
      reasonCodes: ["NO_RECENT_CONTEXT"]
    });
  });

  it("uses score then candidateId, caps top three, and is permutation-stable", () => {
    const projects = [projectId(11), projectId(12), projectId(13), projectId(14)];
    const registry = projects.reduce((current, project, index) =>
      confirmProjectMapping(current, {
        scope: githubScope(String(10 + index)),
        projectId: project,
        confirmedAt: `2026-08-13T00:01:0${index}.000Z`,
        explicitUserConfirmation: true
      }).registry,
    registryWithProjects(projects));
    const forwardSnapshot = githubSnapshot(4);
    const reverseSnapshot = {
      ...forwardSnapshot,
      repositories: [...forwardSnapshot.repositories].reverse(),
      activities: [...forwardSnapshot.activities].reverse()
    };
    const forward = buildFixture(registry, [
      adaptCodexContinuationObservations({}, OPTIONS),
      adaptGitHubContinuationObservations(forwardSnapshot, OPTIONS)
    ]);
    const reverse = buildFixture(registry, [
      adaptCodexContinuationObservations({}, OPTIONS),
      adaptGitHubContinuationObservations(reverseSnapshot, OPTIONS)
    ]);
    const left = run(forward);
    const right = run(reverse);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.result).toEqual(right.result);
    const selected = [left.result.decision.primary!, ...left.result.decision.alternatives];
    expect(selected).toHaveLength(3);
    expect(selected.map((candidate) => candidate.candidateId)).toEqual(
      selected.map((candidate) => candidate.candidateId).sort(compareRuntimeStrings)
    );
    expect(new Set(selected.map((candidate) => candidate.workContextId)).size).toBe(3);
  });

  it("rejects forged R-001, R-002, config, source batch, or installation secret", () => {
    const fixture = linkedFixture();
    const resealedIdentity = resealIdentityResult({
      ...fixture.identityResult,
      registrySha256: "f".repeat(64)
    });
    const changedBatch = resealBatch({
      ...fixture.identityInput.adapterBatches[0]!,
      evaluatedAsOf: "2026-08-13T11:59:59.999Z"
    });
    const changedIdentityInput = {
      ...fixture.identityInput,
      adapterBatches: [
        changedBatch,
        fixture.identityInput.adapterBatches[1]!
      ]
    };
    const oldOptions = {
      ...OPTIONS,
      asOf: "2026-08-13T11:59:59.999Z"
    };
    const emptyCodex = codexSnapshot();
    emptyCodex.sessions = [];
    const oldEmptyBatch = adaptCodexContinuationObservations(
      emptyCodex,
      oldOptions
    );
    const oldUnavailableBatch = adaptCodexContinuationObservations(
      {},
      oldOptions
    );
    const withCodexBatch = (batch: ContinuationSourceAdapterBatch) => ({
      ...fixture.identityInput,
      adapterBatches: fixture.identityInput.adapterBatches.map((candidate) =>
        candidate.source === "codex" ? batch : candidate
      )
    });

    expect(run(fixture, {
      ...resolutionOptions(fixture),
      installationSecret: "wrong-secret"
    })).toEqual({
      ok: false,
      code: "CONTINUATION_RESOLUTION_INPUT_REJECTED"
    });
    expect(run({ ...fixture, identityResult: resealedIdentity })).toEqual({
      ok: false,
      code: "CONTINUATION_RESOLUTION_INPUT_REJECTED"
    });
    expect(run({
      ...fixture,
      derivationResult: {
        ...fixture.derivationResult,
        resultSha256: "0".repeat(64)
      }
    })).toEqual({ ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" });
    expect(run({ ...fixture, identityInput: changedIdentityInput })).toEqual({
      ok: false,
      code: "CONTINUATION_RESOLUTION_INPUT_REJECTED"
    });
    expect(run({
      ...fixture,
      identityInput: withCodexBatch(oldEmptyBatch)
    })).toEqual({
      ok: false,
      code: "CONTINUATION_RESOLUTION_INPUT_REJECTED"
    });
    expect(run({
      ...fixture,
      identityInput: withCodexBatch(oldUnavailableBatch)
    })).toEqual({
      ok: false,
      code: "CONTINUATION_RESOLUTION_INPUT_REJECTED"
    });
    expect(run(
      fixture,
      resolutionOptions(fixture, {
        expectedRegistrySha256: registryWithProjects([
          PROJECT_A,
          projectId(2)
        ]).registrySha256
      })
    )).toEqual({
      ok: false,
      code: "CONTINUATION_RESOLUTION_INPUT_REJECTED"
    });
    expect(resolveContinuation(
      fixture.identityInput,
      fixture.identityResult,
      fixture.derivationEnvelope,
      fixture.derivationResult,
      {
        ...fixture.resolutionEnvelope,
        config: {
          ...fixture.resolutionEnvelope.config,
          maxSelectedCandidateCount: 2
        }
      },
      resolutionOptions(fixture)
    )).toEqual({ ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" });
    expect(run({
      ...fixture,
      resolutionEnvelope: {
        ...fixture.resolutionEnvelope,
        run: {
          ...fixture.resolutionEnvelope.run,
          codeCommitSha: "e".repeat(40)
        }
      }
    })).toEqual({ ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" });
    expect(run({
      ...fixture,
      resolutionEnvelope: {
        ...fixture.resolutionEnvelope,
        run: {
          ...fixture.resolutionEnvelope.run,
          datasetVersion: "forged-dataset-v1",
          datasetSha256: "e".repeat(64)
        }
      }
    })).toEqual({ ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" });
  });

  it("keeps semantic hashes stable across run lineage while artifact hashes change", () => {
    const fixture = linkedFixture();
    const first = run(fixture);
    const replayEnvelope = resolutionEnvelope({
      runId: `continuation_run_${"9".repeat(32)}`,
      analysisId: `analysis_${"8".repeat(32)}`,
      startedAt: "2026-08-13T12:00:00.000Z",
      completedAt: "2026-08-13T12:00:00.020Z"
    });
    const replay = run({ ...fixture, resolutionEnvelope: replayEnvelope });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(continuationDecisionSemanticSha256(first.result.decision)).toBe(
      first.result.decision.semanticResultSha256
    );
    expect(replay.result.decision.semanticResultSha256).toBe(
      first.result.decision.semanticResultSha256
    );
    expect(replay.result.resultSha256).not.toBe(first.result.resultSha256);
    expect(replay.result.decision.run.inputSha256).toBe(
      first.result.decision.run.inputSha256
    );
  });

  it("requires the input-bound verifier even for a valid rehashed artifact", () => {
    const fixture = linkedFixture();
    const resolved = run(fixture);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const reboundDecision = sealContinuationDecision({
      ...withoutDecisionHashes(resolved.result.decision),
      run: {
        ...resolved.result.decision.run,
        inputSha256: "f".repeat(64)
      }
    });
    const { resultSha256: _resultSha256, ...artifactContent } = resolved.result;
    const rebound = {
      ...artifactContent,
      decision: reboundDecision,
      resultSha256: continuationResolvedDecisionSha256({
        ...artifactContent,
        decision: reboundDecision
      })
    };

    expect(continuationResolvedDecisionSchema.safeParse(rebound).success).toBe(true);
    expect(
      verifyContinuationDecisionAgainstInput(
        fixture.identityInput,
        fixture.identityResult,
        fixture.derivationEnvelope,
        fixture.derivationResult,
        fixture.resolutionEnvelope,
        resolutionOptions(fixture),
        rebound
      )
    ).toBe(false);
  });

  it("rejects base decisions and resealed local R-003 semantic tampering", () => {
    const fixture = linkedFixture();
    const resolved = run(fixture);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(
      continuationResolvedDecisionSchema.safeParse(resolved.result.decision)
        .success
    ).toBe(false);

    const primary = resolved.result.decision.primary!;
    const { candidateSha256: _candidateSha256, ...candidateContent } = primary;
    const invalidScoreCandidate = sealContinuationCandidate({
      ...candidateContent,
      continuityScore: primary.continuityScore - 1,
      scoreBreakdown: {
        ...primary.scoreBreakdown,
        recency: primary.scoreBreakdown.recency - 1
      }
    });
    const invalidScoreDecision = sealContinuationDecision({
      ...withoutDecisionHashes(resolved.result.decision),
      primary: invalidScoreCandidate
    });
    expect(
      continuationResolvedDecisionSchema.safeParse(resealResolvedArtifact({
        ...resolved.result,
        decision: invalidScoreDecision
      })).success
    ).toBe(false);

    const wrongBucketCandidate = sealContinuationCandidate({
      ...candidateContent,
      continuityScore: primary.continuityScore - 7,
      scoreBreakdown: {
        ...primary.scoreBreakdown,
        recency: 28
      }
    });
    const wrongBucketDecision = sealContinuationDecision({
      ...withoutDecisionHashes(resolved.result.decision),
      primary: wrongBucketCandidate
    });
    expect(
      continuationResolvedDecisionSchema.safeParse(resealResolvedArtifact({
        ...resolved.result,
        decision: wrongBucketDecision
      })).success
    ).toBe(false);

    expect(
      continuationResolvedDecisionSchema.safeParse(resealResolvedArtifact({
        ...resolved.result,
        configSha256: "f".repeat(64)
      })).success
    ).toBe(false);
    const partialDecision = sealContinuationDecision({
      ...withoutDecisionHashes(resolved.result.decision),
      coverageCode: "SOURCE_LOCAL_PARTIAL"
    });
    expect(
      continuationResolvedDecisionSchema.safeParse(resealResolvedArtifact({
        ...resolved.result,
        sourceAssessments: resolved.result.sourceAssessments.map(
          (assessment, index) => index === 0
            ? { ...assessment, coverage: "unavailable" as const }
            : assessment
        ) as unknown as ContinuationResolvedDecision["sourceAssessments"],
        decision: partialDecision
      })).success
    ).toBe(false);
    const unknownCoverage = resealResolvedArtifact({
      ...resolved.result,
      sourceAssessments: resolved.result.sourceAssessments.map(
        (assessment, index) => index === 0
          ? { ...assessment, coverage: "unknown" as const }
          : assessment
      ) as unknown as ContinuationResolvedDecision["sourceAssessments"],
      decision: partialDecision
    });
    expect(
      continuationResolvedDecisionSchema.safeParse(unknownCoverage).success
    ).toBe(true);
    expect(verifyContinuationDecisionAgainstInput(
      fixture.identityInput,
      fixture.identityResult,
      fixture.derivationEnvelope,
      fixture.derivationResult,
      fixture.resolutionEnvelope,
      resolutionOptions(fixture),
      unknownCoverage
    )).toBe(false);
    expect(
      continuationResolvedDecisionSchema.safeParse(resealResolvedArtifact({
        ...resolved.result,
        sourceAssessments: resolved.result.sourceAssessments.map(
          (assessment, index) => index === 0
            ? { ...assessment, coverage: "partial" as const }
            : assessment
        ) as typeof resolved.result.sourceAssessments
      })).success
    ).toBe(false);
  });

  it("fails closed for hostile values and never serializes secret or raw source data", () => {
    const fixture = linkedFixture();
    const resolved = run(fixture);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const serialized = JSON.stringify(resolved.result);
    for (const sentinel of [
      SECRET,
      "a".repeat(24),
      "b".repeat(24),
      "push-event-0",
      "private-user",
      "client-id",
      "app-slug",
      "private/repository-0",
      "refs/heads/main",
      `artifact_${"1".repeat(32)}`,
      "https://private.example/repository",
      "/Users/private/worktree",
      "f".repeat(40),
      "private user prompt"
    ]) {
      expect(serialized).not.toContain(sentinel);
    }

    const throwing = Object.defineProperty({}, "contract", {
      get(): never {
        throw new Error("hostile getter");
      }
    });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [throwing, BigInt(1), Number.NaN, undefined, cycle]) {
      expect(() => continuationResolutionEnvelopeSchema.safeParse(value)).not.toThrow();
      expect(continuationResolutionEnvelopeSchema.safeParse(value).success).toBe(false);
      expect(() => continuationResolvedDecisionSchema.safeParse(value)).not.toThrow();
      expect(continuationResolvedDecisionSchema.safeParse(value).success).toBe(false);
    }
    expect(() => resolveContinuation(
      fixture.identityInput,
      fixture.identityResult,
      fixture.derivationEnvelope,
      fixture.derivationResult,
      fixture.resolutionEnvelope,
      BigInt(1)
    )).not.toThrow();
  });
});

type Fixture = {
  identityInput: ContinuationIdentityInput;
  identityResult: ContinuationIdentityResult;
  derivationEnvelope: ReturnType<typeof derivationEnvelope>;
  derivationResult: ContinuationCandidateDerivationResult;
  resolutionEnvelope: ContinuationResolutionEnvelope;
};

function linkedFixture(): Fixture {
  return buildFixture(confirmBothMappings(registryWithProjects([PROJECT_A])), [
    adaptCodexContinuationObservations(codexSnapshot(), OPTIONS),
    adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS)
  ]);
}

function buildFixture(
  registry: ReturnType<typeof registryWithProjects>,
  batchesInput: ContinuationSourceAdapterBatch[]
): Fixture {
  const adapterBatches = [...batchesInput].sort((left, right) =>
    compareRuntimeStrings(left.source, right.source)
  );
  const identityInput = createContinuationIdentityInput({
    registry,
    adapterBatches
  }, identityOptions(registry));
  const identity = resolveContinuationIdentity(identityInput, {
    ...identityOptions(registry)
  });
  if (!identity.ok) throw new TypeError("Synthetic identity fixture rejected");
  const envelope = derivationEnvelope();
  const derivation = deriveContinuationCandidates(identity.result, envelope);
  if (!derivation.ok) throw new TypeError("Synthetic derivation fixture rejected");
  return {
    identityInput,
    identityResult: identity.result,
    derivationEnvelope: envelope,
    derivationResult: derivation.result,
    resolutionEnvelope: resolutionEnvelope()
  };
}

function run(
  fixture: Fixture,
  options = resolutionOptions(fixture)
) {
  return resolveContinuation(
    fixture.identityInput,
    fixture.identityResult,
    fixture.derivationEnvelope,
    fixture.derivationResult,
    fixture.resolutionEnvelope,
    options
  );
}

function resolutionOptions(
  fixture: Fixture,
  overrides: Partial<typeof RESOLUTION_OPTIONS & {
    expectedRegistrySha256: string;
  }> = {}
) {
  return {
    ...RESOLUTION_OPTIONS,
    expectedRegistrySha256: fixture.identityInput.registry.registrySha256,
    ...overrides
  };
}

function identityOptions(registry: { registrySha256: string }) {
  return {
    installationSecret: SECRET,
    expectedRegistrySha256: registry.registrySha256
  };
}

function derivationEnvelope() {
  return {
    contract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    asOf: AS_OF,
    config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
  };
}

function resolutionEnvelope(
  overrides: Partial<ContinuationResolutionEnvelope["run"]> = {}
): ContinuationResolutionEnvelope {
  return continuationResolutionEnvelopeSchema.parse({
    contract: CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_RESOLUTION_SCHEMA_VERSION,
    asOf: AS_OF,
    config: CONTINUATION_RESOLUTION_CONFIG,
    run: {
      runId: `continuation_run_${"5".repeat(32)}`,
      analysisId: `analysis_${"6".repeat(32)}`,
      startedAt: "2026-08-13T12:00:00.000Z",
      completedAt: "2026-08-13T12:00:00.010Z",
      codeCommitSha: "d".repeat(40),
      datasetVersion: null,
      datasetSha256: null,
      ...overrides
    }
  });
}

function registryWithProjects(projects: string[]) {
  return projects.reduce((registry, project, index) =>
    createProjectIdentity(registry, {
      createdAt: `2026-08-13T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
      projectId: project
    }).registry,
  createEmptyWorkContextRegistry("2026-08-13T00:00:00.000Z"));
}

function confirmGitHubMapping(registry: ReturnType<typeof registryWithProjects>) {
  return confirmProjectMapping(registry, {
    scope: githubScope("10"),
    projectId: PROJECT_A,
    confirmedAt: "2026-08-13T00:01:00.000Z",
    explicitUserConfirmation: true
  }).registry;
}

function confirmBothMappings(registry: ReturnType<typeof registryWithProjects>) {
  const github = confirmGitHubMapping(registry);
  return confirmProjectMapping(github, {
    scope: codexScope("a".repeat(24)),
    projectId: PROJECT_A,
    confirmedAt: "2026-08-13T00:02:00.000Z",
    explicitUserConfirmation: true
  }).registry;
}

function githubScope(opaqueId: string) {
  return { source: "github" as const, resourceType: "repository" as const, opaqueId };
}

function codexScope(opaqueId: string) {
  return { source: "codex" as const, resourceType: "scope" as const, opaqueId };
}

function githubSnapshot(count = 1) {
  const repositories = Array.from({ length: count }, (_, index) => ({
    id: 10 + index,
    source: "github" as const,
    kind: "repository" as const,
    installationId: 1,
    fullName: `private/repository-${index}`,
    private: true,
    archived: false,
    updatedAt: "2026-08-13T11:30:00.000Z"
  }));
  const activities = repositories.map((repository, index) => ({
    id: `push-event-${index}`,
    source: "github" as const,
    kind: "user_activity" as const,
    activityKind: "push" as const,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
    occurredAt: "2026-08-13T11:30:00.000Z",
    subjectType: "repository" as const,
    subjectNumber: null,
    subjectObjectId: null,
        subjectTitle: "private user prompt https://private.example/repository /Users/private/worktree ffffffffffffffffffffffffffffffffffffffff",
    refName: "refs/heads/main",
    reviewState: null,
    artifactId: `artifact_${String(index + 1).repeat(32).slice(0, 32)}`
  }));
  return {
    schemaVersion: "github-snapshot-v6" as const,
    appClientId: "client-id",
    appSlug: "app-slug",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-13T11:40:00.000Z",
    user: { id: 1, login: "private-user" },
    truncated: false,
    activityWindowStart: "2026-08-06T12:00:00.000Z",
    activitiesState: "available" as "available" | "unavailable",
    activitiesTruncated: false,
    actionabilityCoverage: {
      state: "complete" as const,
      authoredPullRequestCount: 0,
      attemptedCount: 0,
      collectedCount: 0,
      truncated: false
    },
    installations: [{
      id: 1,
      accountLogin: "private-user",
      accountType: "User" as const,
      repositorySelection: "selected" as const,
      suspended: false
    }],
    repositories,
    tasks: [],
    activities
  };
}

function codexSnapshot() {
  return {
    schemaVersion: "codex-snapshot-v3" as const,
    collectorVersion: "codex-app-server-metadata-v1" as const,
    contentMode: "metadata_only" as const,
    codexVersion: "1.0.0",
    fetchedAt: "2026-08-13T11:40:00.000Z",
    lookbackStart: "2026-08-06T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["a".repeat(24)],
    sessions: [{
      id: "b".repeat(24),
      source: "codex" as const,
      kind: "coding_session" as const,
      scopeId: "a".repeat(24),
      projectLabel: "private-project",
      taskSummary: null,
      taskSummarySource: null,
      createdAt: "2026-08-13T11:00:00.000Z",
      updatedAt: "2026-08-13T11:30:00.000Z",
      activityState: "idle" as const,
      attentionState: null,
      content: {
        state: "not_collected" as const,
        contentSha256: null,
        contentSourceUpdatedAt: null,
        collectedAt: null,
        expiresAt: null,
        historicalTurnStatus: "unknown" as const,
        latestTurnCompletedAt: null,
        turnCount: 0,
        userPromptCount: 0,
        agentResponseCount: 0,
        commandExecutionCount: 0,
        failedCommandCount: 0,
        fileChangeCount: 0,
        toolCallCount: 0,
        omittedReasoningItemCount: 0,
        omittedUnsupportedItemCount: 0,
        truncated: false,
        reasonCodes: ["CONTENT_MODE_DISABLED" as const],
        latestUserPromptExcerpt: null,
        latestAgentResponseExcerpt: null,
        latestExecutionSummary: null
      }
    }]
  };
}

function resealBatch(batch: ContinuationSourceAdapterBatch): ContinuationSourceAdapterBatch {
  const {
    batchSha256: _batchSha256,
    batchProofHmac,
    ...content
  } = batch;
  return {
    ...content,
    batchSha256: runtimeSha256({
      domain: "continuation-source-adapter-batch-hash-v0.4",
      batch: content
    }),
    batchProofHmac
  } as ContinuationSourceAdapterBatch;
}

function resealIdentityResult(
  result: ContinuationIdentityResult
): ContinuationIdentityResult {
  const { resultSha256: _resultSha256, ...content } = result;
  return {
    ...content,
    resultSha256: runtimeSha256({
      domain: "continuation-identity-result-hash-v0.4",
      result: content
    })
  };
}

function withoutDecisionHashes(result: ReturnType<typeof sealContinuationDecision>) {
  const {
    semanticResultSha256: _semanticResultSha256,
    resultSha256: _resultSha256,
    ...content
  } = result;
  return content;
}

function resealResolvedArtifact(
  value: ContinuationResolvedDecision
) {
  const { resultSha256: _resultSha256, ...content } = value;
  return {
    ...content,
    resultSha256: continuationResolvedDecisionSha256(content)
  };
}

function projectId(marker: number): string {
  return `project_${marker.toString(16).padStart(32, "0")}`;
}

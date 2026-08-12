import { describe, expect, it } from "vitest";

import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  proposeProjectMapping,
  removeProjectMapping
} from "../src/context/contracts";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "../src/crossSource/canonicalHash";
import {
  adaptCodexContinuationObservations,
  adaptGitHubContinuationObservations,
  createContinuationIdentityBindingProof
} from "../src/continuation/adapters";
import {
  createContinuationObservationId,
  sealContinuationObservation
} from "../src/continuation/contracts";
import {
  createContinuationIdentityInput,
  resolveContinuationIdentity
} from "../src/continuation/resolveIdentity";

const SECRET = "synthetic-identity-installation-secret";
const OPTIONS = {
  installationSecret: SECRET,
  asOf: "2026-08-12T12:00:00.000Z",
  snapshotFreshnessCutoff: "2026-08-12T10:00:00.000Z"
};
const PROJECT_A = `project_${"a".repeat(32)}`;

describe("Continuation R-001 identity resolution", () => {
  it("maps adapter-proven GitHub and Codex identities only through explicit confirmations", () => {
    let registry = registryWithProject();
    registry = confirmProjectMapping(registry, {
      scope: githubScope("10"),
      projectId: PROJECT_A,
      confirmedAt: "2026-08-12T00:01:00.000Z",
      explicitUserConfirmation: true
    }).registry;
    registry = confirmProjectMapping(registry, {
      scope: codexScope("a".repeat(24)),
      projectId: PROJECT_A,
      confirmedAt: "2026-08-12T00:02:00.000Z",
      explicitUserConfirmation: true
    }).registry;
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const codex = adaptCodexContinuationObservations(codexSnapshot(), OPTIONS);
    const originals = [...codex.observations, ...github.observations];
    const result = resolveContinuationIdentity(
      input(registry, [codex, github]),
      identityOptions(registry)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.mappedCount).toBe(2);
    expect(result.result.sourceFreshnessEvaluations).toEqual([
      {
        source: "codex",
        batchSha256: codex.batchSha256,
        evaluatedAsOf: OPTIONS.asOf,
        snapshotFreshnessCutoff: OPTIONS.snapshotFreshnessCutoff
      },
      {
        source: "github",
        batchSha256: github.batchSha256,
        evaluatedAsOf: OPTIONS.asOf,
        snapshotFreshnessCutoff: OPTIONS.snapshotFreshnessCutoff
      }
    ]);
    expect(result.result.resolutions.map((item) => item.workContextId)).toEqual([
      PROJECT_A,
      PROJECT_A
    ]);
    for (const item of result.result.resolutions) {
      const original = originals.find(
        (candidate) => candidate.observationId === item.observationId
      );
      expect(item.observation.observationId).toBe(original?.observationId);
      expect(item.observation.observationSha256).not.toBe(
        original?.observationSha256
      );
    }
    const serialized = JSON.stringify(result.result);
    expect(serialized).not.toContain('"opaqueId":"10"');
    expect(serialized).not.toContain(
      `\"opaqueId\":\"${"a".repeat(24)}\"`
    );
  });

  it("ignores proposals and does not map a proven source to another confirmed scope", () => {
    let registry = registryWithProject();
    registry = proposeProjectMapping(registry, {
      scope: githubScope("10"),
      suggestedProjectId: PROJECT_A,
      proposedAt: "2026-08-12T00:01:00.000Z",
      basis: "source_metadata_hint"
    }).registry;
    registry = confirmProjectMapping(registry, {
      scope: githubScope("11"),
      projectId: PROJECT_A,
      confirmedAt: "2026-08-12T00:02:00.000Z",
      explicitUserConfirmation: true
    }).registry;
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const result = resolveContinuationIdentity(
      input(registry, [github]),
      identityOptions(registry)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.resolutions[0]).toMatchObject({
      status: "setup_needed",
      workContextId: null,
      reasonCodes: ["IDENTITY_MAPPING_NOT_CONFIRMED"]
    });
  });

  it("treats a terminally removed mapping as setup needed", () => {
    let registry = registryWithProject();
    registry = confirmProjectMapping(registry, {
      scope: githubScope("10"),
      projectId: PROJECT_A,
      confirmedAt: "2026-08-12T00:01:00.000Z",
      explicitUserConfirmation: true
    }).registry;
    registry = removeProjectMapping(registry, {
      scope: githubScope("10"),
      removedAt: "2026-08-12T00:02:00.000Z",
      explicitUserConfirmation: true
    }).registry;
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const result = resolveContinuationIdentity(
      input(registry, [github]),
      identityOptions(registry)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.resolutions[0]).toMatchObject({
      status: "setup_needed",
      workContextId: null,
      reasonCodes: ["IDENTITY_MAPPING_NOT_CONFIRMED"]
    });
  });

  it("rejects missing or identical duplicate proofs at the adapter batch boundary", () => {
    const registry = registryWithProject();
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const missing = resealBatch({
      ...structuredClone(github),
      identityBindings: []
    });
    const duplicate = resealBatch({
      ...structuredClone(github),
      identityBindings: [
        github.identityBindings[0]!,
        structuredClone(github.identityBindings[0]!)
      ]
    });
    const validInput = input(registry, [github]);

    expect(
      resolveContinuationIdentity(
        { ...validInput, adapterBatches: [missing] },
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(
      resolveContinuationIdentity(
        { ...validInput, adapterBatches: [duplicate] },
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
  });

  it("rejects an added proof when the whole-batch authority proof is unchanged", () => {
    const registry = registryWithProject();
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const conflictingProof = createContinuationIdentityBindingProof(
      {
        sourceIdentity: github.observations[0]!.sourceIdentity,
        sourceScope: githubScope("11"),
        sourceSnapshotSha256: github.sourceSnapshotSha256!,
        adapterVersion: github.adapterVersion
      },
      { installationSecret: SECRET }
    );
    const conflicting = resealBatch({
      ...structuredClone(github),
      identityBindings: [
        ...github.identityBindings,
        conflictingProof
      ].sort((left, right) =>
        compareRuntimeStrings(
          runtimeCanonicalJson(left),
          runtimeCanonicalJson(right)
        )
      )
    });
    expect(resolveContinuationIdentity(
      input(registry, [conflicting]),
      identityOptions(registry)
    )).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
  });

  it("rejects copied or tampered binding proofs and the wrong installation secret", () => {
    const registry = registryWithProject();
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const tampered = structuredClone(github);
    tampered.identityBindings[0]!.scopeBindingRef =
      `scope_binding_ref_${"f".repeat(32)}`;
    const tamperedWithValidBatchHash = resealBatch(tampered);

    expect(
      resolveContinuationIdentity(
        input(registry, [tamperedWithValidBatchHash]),
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(
      resolveContinuationIdentity(input(registry, [github]), {
        ...identityOptions(registry),
        installationSecret: "different-installation-secret"
      })
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(
      resolveContinuationIdentity(
        { ...input(registry, [github]), bindings: [] },
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
  });

  it("rejects unkeyed reseals of every security-relevant observation field", () => {
    const registry = registryWithProject();
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const original = github.observations[0]!;
    const { observationSha256: _observationSha256, ...content } = original;
    const earlierObservedAt = "2026-08-12T11:29:59.999Z";
    const variants = [
      { ...content, terminalState: "active" as const },
      { ...content, sourceCoverage: "partial" as const },
      { ...content, snapshotFreshness: "stale" as const },
      { ...content, errorCodes: ["SYNTHETIC_ERROR"] },
      { ...content, conflictCodes: ["SYNTHETIC_CONFLICT"] },
      { ...content, evidenceRefs: [`evidence_${"f".repeat(32)}`] },
      {
        ...content,
        observationId: createContinuationObservationId({
          sourceIdentity: content.sourceIdentity,
          sourceRecordRef: content.sourceRecordRef,
          observedAt: earlierObservedAt
        }),
        observedAt: earlierObservedAt,
        expiresAt: "2026-08-19T11:29:59.999Z",
        payload: {
          kind: "github_push" as const,
          pushOccurredAt: earlierObservedAt
        }
      }
    ];

    for (const variant of variants) {
      const observation = sealContinuationObservation(variant);
      const tampered = resealBatch({
        ...structuredClone(github),
        observations: [observation]
      });
      expect(resolveContinuationIdentity(
        input(registry, [tampered]),
        identityOptions(registry)
      )).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    }
    const assessmentTampered = resealBatch({
      ...structuredClone(github),
      sourceAssessment: {
        coverage: "partial" as const,
        freshness: "fresh" as const
      }
    });
    expect(resolveContinuationIdentity(
      input(registry, [assessmentTampered]),
      identityOptions(registry)
    )).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
  });

  it("is deterministic for source input permutations", () => {
    const registry = registryWithProject();
    const leftSnapshot = githubSnapshot();
    leftSnapshot.activities.push({
      ...leftSnapshot.activities[0]!,
      id: "push-event-2",
      occurredAt: "2026-08-12T11:20:00.000Z"
    });
    const rightSnapshot = {
      ...leftSnapshot,
      activities: [...leftSnapshot.activities].reverse()
    };
    const leftBatch = adaptGitHubContinuationObservations(leftSnapshot, OPTIONS);
    const rightBatch = adaptGitHubContinuationObservations(rightSnapshot, OPTIONS);
    const left = resolveContinuationIdentity(
      input(registry, [leftBatch]),
      identityOptions(registry)
    );
    const right = resolveContinuationIdentity(
      input(registry, [rightBatch]),
      identityOptions(registry)
    );

    expect(left).toEqual(right);
  });

  it("rejects registry, version, and boundary tampering without throwing", () => {
    const registry = registryWithProject();
    const github = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const valid = input(registry, [github]);
    const authorityTamperedRegistry = confirmProjectMapping(registry, {
      scope: githubScope("10"),
      projectId: PROJECT_A,
      confirmedAt: "2026-08-12T00:01:00.000Z",
      explicitUserConfirmation: true
    }).registry;
    expect(
      resolveContinuationIdentity(
        valid,
        identityOptions(authorityTamperedRegistry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(
      resolveContinuationIdentity(
        { ...valid, registry: authorityTamperedRegistry },
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(
      resolveContinuationIdentity(
        {
          ...valid,
          registry: { ...registry, registrySha256: "0".repeat(64) }
        },
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(
      resolveContinuationIdentity(
        {
          ...valid,
          contract: "continuation-identity-input-v0.3",
          schemaVersion: "continuation-identity-schema-v0.3"
        },
        identityOptions(registry)
      )
    ).toEqual({ ok: false, code: "IDENTITY_INPUT_REJECTED" });
    expect(() =>
      resolveContinuationIdentity(BigInt(1), identityOptions(registry))
    ).not.toThrow();
  });
});

function registryWithProject() {
  return createProjectIdentity(
    createEmptyWorkContextRegistry("2026-08-12T00:00:00.000Z"),
    { createdAt: "2026-08-12T00:00:01.000Z", projectId: PROJECT_A }
  ).registry;
}

function githubScope(opaqueId: string) {
  return {
    source: "github" as const,
    resourceType: "repository" as const,
    opaqueId
  };
}

function codexScope(opaqueId: string) {
  return { source: "codex" as const, resourceType: "scope" as const, opaqueId };
}

function input(
  registry: ReturnType<typeof registryWithProject>,
  adapterBatches: Array<
    ReturnType<typeof adaptGitHubContinuationObservations> |
    ReturnType<typeof adaptCodexContinuationObservations>
  >
) {
  return createContinuationIdentityInput({
    registry,
    adapterBatches
  }, identityOptions(registry));
}

function identityOptions(registry: { registrySha256: string }) {
  return {
    installationSecret: SECRET,
    expectedRegistrySha256: registry.registrySha256
  };
}

function resealBatch<T extends { batchSha256: string }>(batch: T): T {
  const {
    batchSha256: _batchSha256,
    batchProofHmac,
    ...content
  } = batch as T & { batchProofKeyId: string; batchProofHmac: string };
  return {
    ...content,
    batchSha256: runtimeSha256({
      domain: "continuation-source-adapter-batch-hash-v0.4",
      batch: content
    }),
    batchProofHmac
  } as T;
}

function githubSnapshot() {
  return {
    schemaVersion: "github-snapshot-v6" as const,
    appClientId: "client-id",
    appSlug: "app-slug",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-12T11:40:00.000Z",
    user: { id: 1, login: "private-user" },
    truncated: false,
    activityWindowStart: "2026-08-05T11:40:00.000Z",
    activitiesState: "available" as const,
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
    repositories: [{
      id: 10,
      source: "github" as const,
      kind: "repository" as const,
      installationId: 1,
      fullName: "private/repository",
      private: true,
      archived: false,
      updatedAt: "2026-08-12T11:30:00.000Z"
    }],
    tasks: [],
    activities: [{
      id: "push-event-1",
      source: "github" as const,
      kind: "user_activity" as const,
      activityKind: "push" as const,
      repositoryId: 10,
      repositoryFullName: "private/repository",
      occurredAt: "2026-08-12T11:30:00.000Z",
      subjectType: "repository" as const,
      subjectNumber: null,
      subjectObjectId: null,
      subjectTitle: null,
      refName: "refs/heads/main",
      reviewState: null,
      artifactId: `artifact_${"1".repeat(32)}`
    }]
  };
}

function codexSnapshot() {
  return {
    schemaVersion: "codex-snapshot-v3" as const,
    collectorVersion: "codex-app-server-metadata-v1" as const,
    contentMode: "metadata_only" as const,
    codexVersion: "1.0.0",
    fetchedAt: "2026-08-12T11:40:00.000Z",
    lookbackStart: "2026-08-05T11:40:00.000Z",
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
      createdAt: "2026-08-12T11:00:00.000Z",
      updatedAt: "2026-08-12T11:30:00.000Z",
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

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WorkContextContractError,
  captureStoredWeeklyOutcome,
  captureWeeklyOutcome,
  confirmProjectMapping,
  confirmStoredProjectMapping,
  correctStoredWeeklyOutcome,
  correctWeeklyOutcome,
  createEmptyWeeklyOutcomeStore,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  createStoredProjectIdentity,
  hashWeeklyOutcomeStoreContent,
  hashWorkContextRegistryContent,
  lookupProjectId,
  proposeProjectMapping,
  readWeeklyOutcome,
  readWeeklyOutcomeStore,
  readWorkContextRegistry,
  resolveAttentionWorkContext,
  resolveStoredAttentionWorkContext,
  resolveWeeklyOutcome,
  weeklyOutcomeStoreSchema,
  weeklyOutcomeValidUntil,
  workContextLocalDirectory,
  workContextRegistrySchema,
  type SourceScopeRef
} from "../src/context";

const PROJECT_A = `project_${"1".repeat(32)}`;
const PROJECT_B = `project_${"2".repeat(32)}`;
const T0 = "2026-07-27T00:00:00.000Z";
const T1 = "2026-07-27T00:01:00.000Z";
const T2 = "2026-07-27T00:02:00.000Z";
const T3 = "2026-07-27T00:03:00.000Z";

const scopes = {
  github: {
    source: "github",
    resourceType: "repository",
    opaqueId: "github-private-repository-4815"
  },
  codex: {
    source: "codex",
    resourceType: "scope",
    opaqueId: "codex-private-scope-1623"
  },
  notion: {
    source: "notion",
    resourceType: "resource",
    opaqueId: "notion-private-resource-4217"
  },
  calendar: {
    source: "google_calendar",
    resourceType: "scope",
    opaqueId: "calendar-private-scope-1010"
  }
} as const satisfies Record<string, SourceScopeRef>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("work context registry", () => {
  it("resolves only explicit user mappings and keeps automatic matches proposed", () => {
    let registry = registryWithProjects();
    const proposed = proposeProjectMapping(registry, {
      scope: scopes.github,
      suggestedProjectId: PROJECT_A,
      proposedAt: T1,
      basis: "source_metadata_hint"
    });
    registry = proposed.registry;

    expect(proposed.proposal.state).toBe("proposed");
    expect(lookupProjectId(registry, scopes.github)).toBeNull();

    for (const scope of Object.values(scopes)) {
      registry = confirmProjectMapping(registry, {
        scope,
        projectId: PROJECT_A,
        confirmedAt: T2,
        explicitUserConfirmation: true
      }).registry;
    }

    expect(
      Object.values(scopes).map((scope) =>
        lookupProjectId(registry, scope)
      )
    ).toEqual([
      PROJECT_A,
      PROJECT_A,
      PROJECT_A,
      PROJECT_A
    ]);
    expect(registry.mappingProposals).toEqual([proposed.proposal]);
    expect(registry.registrySha256).toBe(
      hashWorkContextRegistryContent(registry)
    );
  });

  it("corrects mappings by appending an explicit decision and preserves the original", () => {
    let registry = registryWithProjects();
    const original = confirmProjectMapping(registry, {
      scope: scopes.github,
      projectId: PROJECT_A,
      confirmedAt: T1,
      explicitUserConfirmation: true
    });
    registry = original.registry;
    const correction = confirmProjectMapping(registry, {
      scope: scopes.github,
      projectId: PROJECT_B,
      confirmedAt: T2,
      explicitUserConfirmation: true
    });

    expect(correction.registry.mappingDecisions).toHaveLength(2);
    expect(correction.registry.mappingDecisions[0]).toEqual(
      original.decision
    );
    expect(correction.decision.supersedesDecisionId).toBe(
      original.decision.decisionId
    );
    expect(lookupProjectId(correction.registry, scopes.github)).toBe(
      PROJECT_B
    );

    const tampered = {
      ...correction.registry,
      mappingDecisions: correction.registry.mappingDecisions.map(
        (decision, index) =>
          index === 0
            ? { ...decision, projectId: PROJECT_B }
            : decision
      )
    };
    expect(() => workContextRegistrySchema.parse(tampered)).toThrow();
  });
});

describe("weekly outcome contract", () => {
  it("enforces seven days and preserves original values through corrections and updates", () => {
    let store = createEmptyWeeklyOutcomeStore(T0);
    const first = captureWeeklyOutcome(store, {
      projectId: PROJECT_A,
      primaryOutcome: "Ship the first usable cockpit",
      capturedAt: T0,
      validUntil: weeklyOutcomeValidUntil(T0),
      recordedAt: T0
    });
    store = first.store;
    const correction = correctWeeklyOutcome(store, {
      targetOutcomeId: first.outcome.outcomeId,
      primaryOutcome: "Ship the first useful cockpit",
      recordedAt: T1
    });
    store = correction.store;

    expect(store.outcomes).toHaveLength(2);
    expect(store.outcomes[0]).toEqual(first.outcome);
    expect(correction.outcome).toMatchObject({
      changeKind: "correction",
      capturedAt: first.outcome.capturedAt,
      validUntil: first.outcome.validUntil,
      supersedesOutcomeId: first.outcome.outcomeId
    });
    expect(
      resolveWeeklyOutcome(store, {
        projectId: PROJECT_A,
        asOf: T2
      })
    ).toMatchObject({
      status: "active",
      outcome: {
        primaryOutcome: "Ship the first useful cockpit"
      }
    });
    const update = captureWeeklyOutcome(store, {
      projectId: PROJECT_A,
      primaryOutcome: "Verify the cockpit with live data",
      capturedAt: T3,
      validUntil: weeklyOutcomeValidUntil(T3),
      recordedAt: T3
    });
    store = update.store;
    expect(update.outcome).toMatchObject({
      changeKind: "update",
      supersedesOutcomeId: correction.outcome.outcomeId
    });
    expect(store.outcomes.slice(0, 2)).toEqual([
      first.outcome,
      correction.outcome
    ]);
    expect(
      resolveWeeklyOutcome(store, {
        projectId: PROJECT_A,
        asOf: T3
      })
    ).toMatchObject({
      status: "active",
      outcome: {
        primaryOutcome: "Verify the cockpit with live data"
      }
    });
    expect(store.storeSha256).toBe(
      hashWeeklyOutcomeStoreContent(store)
    );

    expect(() =>
      captureWeeklyOutcome(store, {
        projectId: PROJECT_A,
        primaryOutcome: "Invalid cadence",
        capturedAt: T0,
        validUntil: "2026-08-02T00:00:00.000Z",
        recordedAt: T3
      })
    ).toThrow();
    expect(() =>
      correctWeeklyOutcome(store, {
        targetOutcomeId: first.outcome.outcomeId,
        primaryOutcome: "Overwrite history",
        recordedAt: T3
      })
    ).toThrow(
      expect.objectContaining<Partial<WorkContextContractError>>({
        code: "OUTCOME_NOT_CURRENT"
      })
    );
  });

  it("distinguishes active, not-yet-active, missing, and expired outcomes", () => {
    const captured = captureWeeklyOutcome(
      createEmptyWeeklyOutcomeStore(T0),
      {
        primaryOutcome: "Finish the data loop",
        capturedAt: T1,
        validUntil: weeklyOutcomeValidUntil(T1),
        recordedAt: T1
      }
    ).store;

    expect(
      resolveWeeklyOutcome(captured, {
        asOf: T0
      })
    ).toEqual({
      status: "missing",
      reason: "NOT_YET_ACTIVE"
    });
    expect(
      resolveWeeklyOutcome(captured, {
        asOf: weeklyOutcomeValidUntil(T1)
      })
    ).toMatchObject({ status: "expired" });
    expect(
      resolveWeeklyOutcome(
        createEmptyWeeklyOutcomeStore(T0),
        { asOf: T1 }
      )
    ).toEqual({
      status: "missing",
      reason: "OUTCOME_MISSING"
    });
  });
});

describe("attention context resolution", () => {
  it("is deterministic, does not expose source IDs, and ignores proposals", () => {
    let registry = registryWithProjects();
    registry = proposeProjectMapping(registry, {
      scope: scopes.github,
      suggestedProjectId: PROJECT_B,
      proposedAt: T1,
      basis: "shared_opaque_identifier"
    }).registry;
    registry = confirmProjectMapping(registry, {
      scope: scopes.github,
      projectId: PROJECT_A,
      confirmedAt: T2,
      explicitUserConfirmation: true
    }).registry;
    registry = confirmProjectMapping(registry, {
      scope: scopes.codex,
      projectId: PROJECT_A,
      confirmedAt: T2,
      explicitUserConfirmation: true
    }).registry;
    const outcomes = captureWeeklyOutcome(
      createEmptyWeeklyOutcomeStore(T0),
      {
        projectId: PROJECT_A,
        primaryOutcome: "Make sync observable",
        capturedAt: T0,
        validUntil: weeklyOutcomeValidUntil(T0),
        recordedAt: T0
      }
    ).store;

    const forward = resolveAttentionWorkContext({
      registry,
      weeklyOutcomes: outcomes,
      sourceScopes: [scopes.github, scopes.codex],
      asOf: T3
    });
    const reverse = resolveAttentionWorkContext({
      registry,
      weeklyOutcomes: outcomes,
      sourceScopes: [scopes.codex, scopes.github],
      asOf: T3
    });

    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      projectResolution: "resolved",
      projectId: PROJECT_A,
      weeklyOutcomeStatus: "active",
      focus: {
        primaryOutcome: "Make sync observable"
      }
    });
    const serialized = JSON.stringify(forward);
    for (const scope of Object.values(scopes)) {
      expect(serialized).not.toContain(scope.opaqueId);
    }
    expect(serialized).not.toContain("source_metadata_hint");
    expect(serialized).not.toContain("shared_opaque_identifier");
  });

  it("uses the global weekly outcome when a resolved project has no override", () => {
    let registry = registryWithProjects();
    registry = confirmProjectMapping(registry, {
      scope: scopes.github,
      projectId: PROJECT_A,
      confirmedAt: T1,
      explicitUserConfirmation: true
    }).registry;
    const outcomes = captureWeeklyOutcome(
      createEmptyWeeklyOutcomeStore(T0),
      {
        primaryOutcome: "Ship the first stable data loop",
        capturedAt: T0,
        validUntil: weeklyOutcomeValidUntil(T0),
        recordedAt: T0
      }
    ).store;

    expect(
      resolveAttentionWorkContext({
        registry,
        weeklyOutcomes: outcomes,
        sourceScopes: [scopes.github],
        asOf: T2
      })
    ).toMatchObject({
      projectResolution: "resolved",
      projectId: PROJECT_A,
      weeklyOutcomeStatus: "active",
      focus: {
        primaryOutcome: "Ship the first stable data loop"
      }
    });
  });

  it.each(["expired", "not-yet-active"] as const)(
    "falls back to an active global outcome when the project override is %s",
    (overrideState) => {
      let registry = registryWithProjects();
      registry = confirmProjectMapping(registry, {
        scope: scopes.github,
        projectId: PROJECT_A,
        confirmedAt: T1,
        explicitUserConfirmation: true
      }).registry;
      let outcomes = captureWeeklyOutcome(
        createEmptyWeeklyOutcomeStore(T0),
        {
          primaryOutcome: "Keep the data loop reliable",
          capturedAt: T0,
          validUntil: weeklyOutcomeValidUntil(T0),
          recordedAt: T0
        }
      ).store;
      const projectCapturedAt =
        overrideState === "expired"
          ? "2026-07-19T00:00:00.000Z"
          : "2026-07-28T00:00:00.000Z";
      outcomes = captureWeeklyOutcome(outcomes, {
        projectId: PROJECT_A,
        primaryOutcome: "Project-only override",
        capturedAt: projectCapturedAt,
        validUntil: weeklyOutcomeValidUntil(projectCapturedAt),
        recordedAt: projectCapturedAt
      }).store;

      expect(
        resolveAttentionWorkContext({
          registry,
          weeklyOutcomes: outcomes,
          sourceScopes: [scopes.github],
          asOf: T2
        })
      ).toMatchObject({
        projectResolution: "resolved",
        projectId: PROJECT_A,
        weeklyOutcomeStatus: "active",
        focus: {
          primaryOutcome: "Keep the data loop reliable"
        }
      });
    }
  );

  it("uses a global weekly outcome before a project registry exists", async () => {
    const cwd = await temporaryDirectory();
    await captureStoredWeeklyOutcome(
      {
        primaryOutcome: "Stabilize the first complete data loop",
        capturedAt: T0,
        validUntil: weeklyOutcomeValidUntil(T0),
        recordedAt: T0
      },
      cwd
    );

    expect(
      await resolveStoredAttentionWorkContext({
        sourceScopes: [scopes.github],
        asOf: T2,
        cwd
      })
    ).toMatchObject({
      projectResolution: "registry_missing",
      projectId: null,
      weeklyOutcomeStatus: "active",
      unavailableReason: "REGISTRY_MISSING",
      focus: {
        primaryOutcome: "Stabilize the first complete data loop",
        capturedAt: T0,
        validUntil: weeklyOutcomeValidUntil(T0)
      }
    });
  });
});

describe("private local context store", () => {
  it("serializes concurrent mutations, writes atomically with private modes, and preserves corrections", async () => {
    const cwd = await temporaryDirectory();
    await Promise.all([
      createStoredProjectIdentity(
        { projectId: PROJECT_A, createdAt: T0 },
        cwd
      ),
      createStoredProjectIdentity(
        { projectId: PROJECT_B, createdAt: T1 },
        cwd
      )
    ]);
    await Promise.all([
      confirmStoredProjectMapping(
        {
          scope: scopes.github,
          projectId: PROJECT_A,
          confirmedAt: T2,
          explicitUserConfirmation: true
        },
        cwd
      ),
      confirmStoredProjectMapping(
        {
          scope: scopes.codex,
          projectId: PROJECT_A,
          confirmedAt: T2,
          explicitUserConfirmation: true
        },
        cwd
      )
    ]);
    const first = await captureStoredWeeklyOutcome(
      {
        projectId: PROJECT_A,
        primaryOutcome: "Stabilize collection",
        capturedAt: T0,
        validUntil: weeklyOutcomeValidUntil(T0),
        recordedAt: T0
      },
      cwd
    );
    await correctStoredWeeklyOutcome(
      {
        targetOutcomeId: first.outcome.outcomeId,
        primaryOutcome: "Stabilize collection and processing",
        recordedAt: T3
      },
      cwd
    );

    const registryRead = await readWorkContextRegistry(cwd);
    const outcomeRead = await readWeeklyOutcomeStore(cwd);
    expect(registryRead).toMatchObject({
      status: "available",
      value: {
        projects: [{ projectId: PROJECT_A }, { projectId: PROJECT_B }],
        mappingDecisions: [{ projectId: PROJECT_A }, { projectId: PROJECT_A }]
      }
    });
    expect(outcomeRead).toMatchObject({
      status: "available",
      value: {
        outcomes: [
          { primaryOutcome: "Stabilize collection" },
          {
            primaryOutcome: "Stabilize collection and processing",
            changeKind: "correction"
          }
        ]
      }
    });

    const directory = workContextLocalDirectory(cwd);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    for (const filename of [
      "project-registry.json",
      "weekly-outcomes.json"
    ]) {
      expect((await stat(join(directory, filename))).mode & 0o777).toBe(
        0o600
      );
    }
    expect(
      (await readFile(join(directory, "weekly-outcomes.json"), "utf8"))
        .length
    ).toBeGreaterThan(0);
  });

  it("distinguishes a missing weekly outcome store from an invalid one without leaking its contents", async () => {
    const cwd = await temporaryDirectory();
    expect(await readWeeklyOutcomeStore(cwd)).toEqual({
      status: "missing"
    });
    expect(await readWeeklyOutcome({ asOf: T0 }, cwd)).toEqual({
      status: "missing",
      reason: "STORE_MISSING"
    });

    const directory = workContextLocalDirectory(cwd);
    await mkdir(directory, { recursive: true });
    const secretInvalidValue = "PRIVATE_OUTCOME_DO_NOT_REPORT";
    await writeFile(
      join(directory, "weekly-outcomes.json"),
      `{${secretInvalidValue}`,
      "utf8"
    );
    const invalid = await readWeeklyOutcomeStore(cwd);
    expect(invalid).toEqual({
      status: "invalid",
      reason: "PARSE_FAILED"
    });
    expect(await readWeeklyOutcome({ asOf: T0 }, cwd)).toEqual(
      invalid
    );
    expect(JSON.stringify(invalid)).not.toContain(secretInvalidValue);
  });

  it("rejects integrity changes instead of silently accepting a modified local record", () => {
    const store = captureWeeklyOutcome(
      createEmptyWeeklyOutcomeStore(T0),
      {
        primaryOutcome: "Original",
        capturedAt: T0,
        validUntil: weeklyOutcomeValidUntil(T0),
        recordedAt: T0
      }
    ).store;
    const tampered = {
      ...store,
      outcomes: store.outcomes.map((outcome) => ({
        ...outcome,
        primaryOutcome: "Tampered"
      }))
    };
    expect(() => weeklyOutcomeStoreSchema.parse(tampered)).toThrow();
  });
});

function registryWithProjects() {
  const first = createProjectIdentity(
    createEmptyWorkContextRegistry(T0),
    {
      projectId: PROJECT_A,
      createdAt: T0
    }
  ).registry;
  return createProjectIdentity(first, {
    projectId: PROJECT_B,
    createdAt: T1
  }).registry;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-work-context-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

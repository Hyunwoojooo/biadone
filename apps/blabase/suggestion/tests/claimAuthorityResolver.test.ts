import { describe, expect, it } from "vitest";

import {
  claimAuthorityProjectionSchema,
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  opaqueProjectValue,
  resolveClaimAuthority,
  sealClaimAuthorityProjection,
  canonicalClaimCoverage,
  type BoundedClaimValue,
  type ClaimField,
  type ClaimOrigin,
  type ClaimSource,
  type ClaimTargetKind,
  type NormalizedWorkClaim
} from "../src/claims";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";

const AS_OF = "2026-08-02T03:00:00.000Z";
const T0 = "2026-08-02T02:00:00.000Z";
const T1 = "2026-08-02T02:10:00.000Z";
const T2 = "2026-08-02T02:20:00.000Z";
const dependencies = {
  workRelationProjectionSha256: "1".repeat(64),
  artifactRelationProjectionSha256: "2".repeat(64),
  githubBatchSha256: "3".repeat(64),
  githubSourceSnapshotSha256: "4".repeat(64),
  managedSourceRevision: 3,
  managedGeneratedAt: T2,
  managedSemanticProjectionSha256: "6".repeat(64),
  contextRegistrySha256: "5".repeat(64)
};

describe("claim authority resolver", () => {
  it("selects one fresh authoritative GitHub field without creating a conflict", () => {
    const projection = resolve([githubStateClaim({ value: "open" })]);

    expect(projection.fieldResolutions).toHaveLength(1);
    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "resolved",
      field: "github_work_item_state",
      reasonCodes: ["AUTHORITATIVE_CLAIM_SELECTED"]
    });
    expect(projection.conflicts).toEqual([]);
    expect(projection.attentionDisposition).toBe("not_connected");
    expect(projection.forbiddenAsAttentionCandidate).toBe(true);
  });

  it("keeps a stale authoritative claim but refuses to make it current", () => {
    const projection = resolve([
      githubStateClaim({ value: "open", freshness: "stale" })
    ]);

    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "insufficient_evidence",
      winningClaimId: null,
      reasonCodes: ["AUTHORITATIVE_CLAIM_STALE"]
    });
  });

  it("does not let Codex inventory context become live execution authority", () => {
    const projection = resolve([
      managedStateClaim({
        value: "completed",
        source: "codex_inventory",
        origin: "codex_inventory_snapshot"
      })
    ]);

    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "insufficient_evidence",
      winningClaimId: null,
      reasonCodes: [
        "AUTHORITATIVE_CLAIM_MISSING",
        "CONTEXT_ONLY_EVIDENCE"
      ]
    });
  });

  it("preserves lower-authority disagreement while selecting managed direct evidence", () => {
    const direct = managedStateClaim({ value: "running" });
    const inventory = managedStateClaim({
      value: "completed",
      source: "codex_inventory",
      origin: "codex_inventory_snapshot",
      lineageSeed: "inventory"
    });
    const projection = resolve([inventory, direct]);

    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "resolved",
      winningClaimId: direct.claimId,
      reasonCodes: [
        "AUTHORITATIVE_CLAIM_SELECTED",
        "LOWER_AUTHORITY_DISAGREEMENT"
      ]
    });
    expect(projection.conflicts[0]).toMatchObject({
      status: "resolved_by_authority",
      reasonCode: "LOWER_AUTHORITY_VALUE_DISAGREEMENT",
      winningClaimId: direct.claimId,
      nextAction: "none"
    });
  });

  it("uses a newer observation only within the same exact lineage", () => {
    const older = managedStateClaim({
      value: "running",
      sourceUpdatedAt: T0
    });
    const newer = managedStateClaim({
      value: "completed",
      sourceUpdatedAt: T2
    });
    const projection = resolve([older, newer]);

    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "resolved",
      winningClaimId: newer.claimId,
      reasonCodes: [
        "AUTHORITATIVE_CLAIM_SELECTED",
        "NEWER_SAME_LINEAGE_SELECTED"
      ]
    });
    expect(projection.conflicts[0]).toMatchObject({
      status: "resolved_by_freshness",
      reasonCode: "OLDER_LINEAGE_VALUE_DISAGREEMENT"
    });
  });

  it("fails closed on equal-time conflicting values in one lineage", () => {
    const projection = resolve([
      managedStateClaim({ value: "running", sourceUpdatedAt: T1 }),
      managedStateClaim({ value: "failed", sourceUpdatedAt: T1 })
    ]);

    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "review_required",
      winningClaimId: null,
      reasonCodes: ["EQUAL_AUTHORITY_CONFLICT"]
    });
    expect(projection.conflicts[0]).toMatchObject({
      status: "review_required",
      nextAction: "user_review"
    });
    expect(projection.unresolvedCriticalConflictCount).toBe(1);
  });

  it("requires two independent explicit mappings before resolving project alignment", () => {
    const one = projectClaim("project-a", "codex-scope");
    const two = projectClaim("project-a", "github-scope");

    expect(resolve([one]).fieldResolutions[0]).toMatchObject({
      status: "insufficient_evidence",
      reasonCodes: ["MINIMUM_CORROBORATION_MISSING"]
    });
    expect(resolve([one, two]).fieldResolutions[0]).toMatchObject({
      status: "resolved",
      reasonCodes: ["CONSISTENT_AUTHORITATIVE_CLAIMS"]
    });
  });

  it("keeps conflicting project mappings unresolved rather than using the newest mapping", () => {
    const left = projectClaim("project-a", "codex-scope", T0);
    const right = projectClaim("project-b", "github-scope", T2);
    const projection = resolve([left, right]);

    expect(projection.fieldResolutions[0]).toMatchObject({
      status: "review_required",
      winningClaimId: null
    });
    expect(projection.conflicts[0]).toMatchObject({
      reasonCode: "EQUAL_AUTHORITY_VALUE_DISAGREEMENT",
      status: "review_required"
    });
  });

  it("does not conflate a completed Codex execution with an open GitHub work item", () => {
    const projection = resolve([
      managedStateClaim({ value: "completed" }),
      githubStateClaim({ value: "open" })
    ]);

    expect(projection.fieldResolutions).toHaveLength(2);
    expect(projection.fieldResolutions.every((item) => item.status === "resolved")).toBe(true);
    expect(projection.conflicts).toEqual([]);
  });

  it("does not compare the same semantic field across different exact targets", () => {
    const projection = resolve([
      githubStateClaim({ value: "open", targetSeed: "github-a" }),
      githubStateClaim({ value: "completed", targetSeed: "github-b" })
    ]);

    expect(projection.fieldResolutions).toHaveLength(2);
    expect(projection.conflicts).toEqual([]);
  });

  it("deduplicates byte-identical claims and preserves input count", () => {
    const claim = githubStateClaim({ value: "open" });
    const projection = resolve([claim, claim]);

    expect(projection.totalInputClaimCount).toBe(2);
    expect(projection.deduplicatedClaimCount).toBe(1);
    expect(projection.claims).toHaveLength(1);
  });

  it("includes raw claim multiplicity in the resolver input hash", () => {
    const claim = githubStateClaim({ value: "open" });

    expect(resolve([claim]).inputSha256).not.toBe(
      resolve([claim, claim]).inputSha256
    );
  });

  it("is deterministic under input permutation", () => {
    const claims = [
      projectClaim("project-a", "codex-scope"),
      projectClaim("project-b", "github-scope"),
      managedStateClaim({ value: "running" })
    ];
    const forward = resolve(claims);
    const reverse = resolve([...claims].reverse());

    expect(reverse.projectionSha256).toBe(forward.projectionSha256);
    expect(reverse.inputSha256).toBe(forward.inputSha256);
    expect(reverse.conflicts).toEqual(forward.conflicts);
  });

  it("rejects evidence newer than the fixed asOf time", () => {
    const future = githubStateClaim({
      value: "open",
      observedAt: "2026-08-02T04:00:00.000Z",
      sourceUpdatedAt: "2026-08-02T04:00:00.000Z"
    });

    expect(() => resolve([future])).toThrow(/newer than asOf/);
  });

  it("accepts the versioned one-minute source clock skew boundary", () => {
    const withinSkew = githubStateClaim({
      value: "open",
      observedAt: "2026-08-02T03:00:30.000Z",
      sourceUpdatedAt: "2026-08-02T03:00:45.000Z"
    });

    expect(resolve([withinSkew]).fieldResolutions[0]).toMatchObject({
      status: "resolved"
    });
  });

  it("rejects unsupported source-field authority injection", () => {
    expect(() =>
      baseClaim({
        targetKind: "github_work_item",
        targetSeed: "github-a",
        lineageSeed: "notion-a",
        field: "github_work_item_state",
        value: { type: "enum", value: "open" },
        source: "notion",
        origin: "notion_task_database"
      })
    ).toThrow(/Unsupported source/);
  });

  it("rejects claims that contradict the declared source coverage", () => {
    const notionClaim = baseClaim({
      targetKind: "notion_task",
      targetSeed: "notion-a",
      lineageSeed: "notion-a",
      field: "notion_task_state",
      value: { type: "enum", value: "open" },
      source: "notion",
      origin: "notion_task_database"
    });
    expect(() => resolve([notionClaim])).toThrow(/source coverage/u);
  });

  it("rejects duplicate source coverage instead of using the last entry", () => {
    const coverage = canonicalClaimCoverage({ github: "evaluated" });
    expect(() =>
      resolveClaimAuthority({
        asOf: AS_OF,
        dependencies,
        sourceCoverage: [...coverage, coverage[0]!],
        claims: [githubStateClaim({ value: "open" })]
      })
    ).toThrow(/explicit coverage/u);
  });

  it("uses fresh evidence over a stale equal-authority lineage without calling it an authority win", () => {
    const current = baseClaim({
      targetKind: "github_work_item",
      targetSeed: "github-a",
      lineageSeed: "github-current",
      field: "github_work_item_state",
      value: { type: "enum", value: "open" },
      source: "github",
      origin: "github_normalized_snapshot"
    });
    const stale = baseClaim({
      targetKind: "github_work_item",
      targetSeed: "github-a",
      lineageSeed: "github-stale",
      field: "github_work_item_state",
      value: { type: "enum", value: "completed" },
      source: "github",
      origin: "github_normalized_snapshot",
      freshness: "stale",
      sourceUpdatedAt: T0
    });
    const projection = resolve([stale, current]);

    expect(projection.conflicts[0]).toMatchObject({
      status: "resolved_by_freshness",
      reasonCode: "STALE_AUTHORITY_VALUE_DISAGREEMENT",
      winningClaimId: current.claimId,
      nextAction: "none"
    });
  });

  it("rejects a valid source-field claim attached to the wrong target kind", () => {
    expect(() =>
      baseClaim({
        targetKind: "codex_execution",
        targetSeed: "execution-a",
        lineageSeed: "github-a",
        field: "github_work_item_state",
        value: { type: "enum", value: "open" },
        source: "github",
        origin: "github_normalized_snapshot"
      })
    ).toThrow(/target kind/u);
  });

  it("detects projection tampering and never exposes raw target seeds", () => {
    const projection = resolve([
      githubStateClaim({
        value: "open",
        targetSeed: "PRIVATE_REPOSITORY/project-raw"
      })
    ]);
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain("PRIVATE_REPOSITORY");
    expect(serialized).not.toContain("project-raw");
    expect(
      claimAuthorityProjectionSchema.safeParse({
        ...projection,
        unresolvedCriticalConflictCount: 99
      }).success
    ).toBe(false);

    const { projectionSha256: _projectionSha256, ...content } = projection;
    expect(() =>
      sealClaimAuthorityProjection({
        ...content,
        fieldResolutions: content.fieldResolutions.map(
          (resolution, index) =>
            index === 0
              ? {
                  ...resolution,
                  resolutionId: `claim_resolution_${"f".repeat(32)}`
                }
              : resolution
        )
      })
    ).toThrow(/incoherent|canonical/u);
  });
});

function resolve(claims: NormalizedWorkClaim[]) {
  return resolveClaimAuthority({
    asOf: AS_OF,
    dependencies,
    sourceCoverage: canonicalClaimCoverage({ github: "evaluated" }),
    claims
  });
}

function githubStateClaim(input: {
  value: "open" | "completed" | "cancelled";
  freshness?: "current" | "stale";
  targetSeed?: string;
  observedAt?: string;
  sourceUpdatedAt?: string;
}): NormalizedWorkClaim {
  return baseClaim({
    targetKind: "github_work_item",
    targetSeed: input.targetSeed ?? "github-a",
    lineageSeed: input.targetSeed ?? "github-a",
    field: "github_work_item_state",
    value: { type: "enum", value: input.value },
    source: "github",
    origin: "github_normalized_snapshot",
    freshness: input.freshness,
    observedAt: input.observedAt,
    sourceUpdatedAt: input.sourceUpdatedAt
  });
}

function managedStateClaim(input: {
  value: "running" | "idle" | "completed" | "failed" | "interrupted";
  source?: "codex_managed" | "codex_inventory";
  origin?: "managed_codex_event_stream" | "codex_inventory_snapshot";
  lineageSeed?: string;
  sourceUpdatedAt?: string;
}): NormalizedWorkClaim {
  return baseClaim({
    targetKind: "codex_execution",
    targetSeed: "execution-a",
    lineageSeed: input.lineageSeed ?? "managed-run-a",
    field: "managed_codex_execution_state",
    value: { type: "enum", value: input.value },
    source: input.source ?? "codex_managed",
    origin: input.origin ?? "managed_codex_event_stream",
    directness:
      input.source === "codex_inventory" ? "derived" : "explicit",
    sourceUpdatedAt: input.sourceUpdatedAt
  });
}

function projectClaim(
  projectSeed: string,
  lineageSeed: string,
  sourceUpdatedAt = T1
): NormalizedWorkClaim {
  return baseClaim({
    targetKind: "project_relation",
    targetSeed: "relation-a",
    lineageSeed,
    field: "project_alignment_identity",
    value: opaqueProjectValue(
      `project_${runtimeSha256(projectSeed).slice(0, 32)}`
    ),
    source: "explicit_user",
    origin: "explicit_user_mapping",
    sourceUpdatedAt
  });
}

function baseClaim(input: {
  targetKind: ClaimTargetKind;
  targetSeed: string;
  lineageSeed: string;
  field: ClaimField;
  value: BoundedClaimValue;
  source: ClaimSource;
  origin: ClaimOrigin;
  freshness?: "current" | "stale";
  completeness?: "complete" | "partial" | "unknown";
  directness?: "explicit" | "derived";
  observedAt?: string;
  sourceUpdatedAt?: string;
}): NormalizedWorkClaim {
  const observedAt = input.observedAt ?? T2;
  return createNormalizedWorkClaim({
    target: {
      kind: input.targetKind,
      ref: createClaimTargetRef({
        kind: input.targetKind,
        identity: { seed: input.targetSeed }
      })
    },
    lineageRef: createClaimLineageRef({ seed: input.lineageSeed }),
    field: input.field,
    value: input.value,
    source: input.source,
    origin: input.origin,
    freshness: input.freshness ?? "current",
    completeness: input.completeness ?? "complete",
    directness: input.directness ?? "explicit",
    observedAt,
    sourceUpdatedAt: input.sourceUpdatedAt ?? observedAt,
    evidenceRefs: [
      createClaimEvidenceRef({
        source: input.source,
        seed: `${input.targetSeed}:${input.lineageSeed}:${input.sourceUpdatedAt ?? observedAt}:${JSON.stringify(input.value)}`
      })
    ]
  });
}

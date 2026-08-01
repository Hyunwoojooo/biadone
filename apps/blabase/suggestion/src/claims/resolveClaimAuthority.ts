import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CLAIM_AUTHORITY_PROJECTION_CONTRACT,
  CLAIM_CONFLICT_SCHEMA_VERSION,
  CLAIM_EVIDENCE_POLICY_VERSION,
  CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
  FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
  WORK_CLAIM_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  CLAIM_COVERAGE_SOURCES,
  CLAIM_SOURCE_CLOCK_SKEW_MS,
  claimConflictSchema,
  claimFieldResolutionSchema,
  claimSourceCoverageSchema,
  createClaimConflictId,
  createClaimResolutionId,
  normalizedWorkClaimSchema,
  sealClaimAuthorityProjection,
  type ClaimAuthorityProjection,
  type ClaimConflict,
  type ClaimField,
  type ClaimFieldResolution,
  type ClaimSourceCoverage,
  type NormalizedWorkClaim
} from "./contracts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime();

export const claimAuthorityDependenciesSchema = z
  .object({
    workRelationProjectionSha256: sha256Schema,
    artifactRelationProjectionSha256: sha256Schema,
    githubBatchSha256: sha256Schema.nullable(),
    githubSourceSnapshotSha256: sha256Schema.nullable(),
    managedSourceRevision: z.number().int().nonnegative(),
    managedGeneratedAt: timestampSchema,
    managedSemanticProjectionSha256: sha256Schema,
    contextRegistrySha256: sha256Schema.nullable()
  })
  .strict()
  .superRefine((dependencies, context) => {
    if (
      (dependencies.githubBatchSha256 === null) !==
      (dependencies.githubSourceSnapshotSha256 === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GitHub batch and source snapshot hashes must be present together."
      });
    }
  });

export type ClaimAuthorityDependencies = z.infer<
  typeof claimAuthorityDependenciesSchema
>;

export function resolveClaimAuthority(input: {
  asOf: string;
  dependencies: ClaimAuthorityDependencies;
  sourceCoverage: ClaimSourceCoverage[];
  claims: NormalizedWorkClaim[];
}): ClaimAuthorityProjection {
  const asOf = new Date(input.asOf).toISOString();
  const dependencies = claimAuthorityDependenciesSchema.parse(
    input.dependencies
  );
  if (Date.parse(dependencies.managedGeneratedAt) > Date.parse(asOf)) {
    throw new TypeError("Claim dependency evidence cannot be newer than asOf.");
  }

  const sourceCoverage = canonicalCoverage(input.sourceCoverage);
  const parsedClaims = input.claims.map((claim) =>
    normalizedWorkClaimSchema.parse(claim)
  );
  assertClaimCoverageCoherence(parsedClaims, sourceCoverage);
  if (
    parsedClaims.some(
      (claim) =>
        Date.parse(claim.observedAt) >
          Date.parse(asOf) + CLAIM_SOURCE_CLOCK_SKEW_MS ||
        (claim.sourceUpdatedAt !== null &&
          Date.parse(claim.sourceUpdatedAt) >
            Date.parse(asOf) + CLAIM_SOURCE_CLOCK_SKEW_MS)
    )
  ) {
    throw new TypeError("Claim evidence cannot be newer than asOf.");
  }

  const claims = deduplicateClaims(parsedClaims).sort(compareClaims);
  const groups = groupClaimsByKey(claims);
  const fieldResolutions: ClaimFieldResolution[] = [];
  const conflicts: ClaimConflict[] = [];

  for (const claimKey of [...groups.keys()].sort(compareRuntimeStrings)) {
    const group = groups.get(claimKey) ?? [];
    if (group.length === 0) continue;
    const result = resolveClaimGroup(group);
    fieldResolutions.push(result.resolution);
    if (result.conflict) conflicts.push(result.conflict);
  }

  fieldResolutions.sort((left, right) =>
    compareRuntimeStrings(left.resolutionId, right.resolutionId)
  );
  conflicts.sort((left, right) =>
    compareRuntimeStrings(left.conflictId, right.conflictId)
  );

  const inputSha256 = runtimeSha256({
    domain: "claim-authority-resolution-input-v0.1",
    projectionContract: CLAIM_AUTHORITY_PROJECTION_CONTRACT,
    schemaVersion: WORK_CLAIM_SCHEMA_VERSION,
    conflictSchemaVersion: CLAIM_CONFLICT_SCHEMA_VERSION,
    resolverVersion: CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
    authorityPolicyVersion: FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
    evidencePolicyVersion: CLAIM_EVIDENCE_POLICY_VERSION,
    asOf,
    dependencies,
    sourceCoverage,
    totalInputClaimCount: parsedClaims.length,
    rawClaimIds: parsedClaims
      .map((claim) => claim.claimId)
      .sort(compareRuntimeStrings),
    claims: claims.map((claim) => ({
      claimId: claim.claimId,
      claimKey: claim.claimKey,
      valueSha256: claim.valueSha256
    }))
  });

  return sealClaimAuthorityProjection({
    contract: CLAIM_AUTHORITY_PROJECTION_CONTRACT,
    schemaVersion: WORK_CLAIM_SCHEMA_VERSION,
    conflictSchemaVersion: CLAIM_CONFLICT_SCHEMA_VERSION,
    resolverVersion: CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
    authorityPolicyVersion: FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
    evidencePolicyVersion: CLAIM_EVIDENCE_POLICY_VERSION,
    asOf,
    inputs: dependencies,
    sourceCoverage,
    totalInputClaimCount: parsedClaims.length,
    deduplicatedClaimCount: claims.length,
    claims,
    fieldResolutions,
    conflicts,
    unresolvedCriticalConflictCount: conflicts.filter(
      (conflict) => conflict.status === "review_required"
    ).length,
    inputSha256,
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function assertClaimCoverageCoherence(
  claims: NormalizedWorkClaim[],
  coverage: ClaimSourceCoverage[]
): void {
  const coverageBySource = new Map(
    coverage.map((item) => [item.source, item])
  );
  for (const claim of claims) {
    const sourceCoverage = coverageBySource.get(claim.source);
    if (!sourceCoverage) {
      throw new TypeError("Claim source coverage is missing.");
    }
    if (claim.authority === "context_only") {
      if (sourceCoverage.status !== "context_only") {
        throw new TypeError(
          "Context-only claim does not match source coverage."
        );
      }
      continue;
    }
    if (
      !["evaluated", "partial", "stale"].includes(
        sourceCoverage.status
      ) ||
      !sourceCoverage.claimFields.includes(claim.field) ||
      (sourceCoverage.status === "stale" &&
        claim.freshness !== "stale")
    ) {
      throw new TypeError(
        "Authoritative claim does not match source coverage."
      );
    }
  }
}

function resolveClaimGroup(claims: NormalizedWorkClaim[]): {
  resolution: ClaimFieldResolution;
  conflict: ClaimConflict | null;
} {
  const first = claims[0];
  if (!first) throw new TypeError("Claim group cannot be empty.");
  if (
    claims.some(
      (claim) =>
        claim.claimKey !== first.claimKey ||
        claim.field !== first.field ||
        claim.target.ref !== first.target.ref ||
        claim.target.kind !== first.target.kind
    )
  ) {
    throw new TypeError("Claim group identity is incoherent.");
  }

  const currentAuthoritative = claims.filter(
    (claim) =>
      claim.authority === "authoritative" &&
      claim.freshness === "current"
  );
  const lineageSelection = selectLatestPerLineage(currentAuthoritative);
  const selected = lineageSelection.selected;
  const uniqueSelectedValues = new Set(
    selected.map((claim) => claim.valueSha256)
  );
  const needsCorroboration =
    first.field === "project_alignment_identity";
  const selectedLineageCount = new Set(
    selected.map((claim) => claim.lineageRef)
  ).size;

  let status: ClaimFieldResolution["status"];
  let winner: NormalizedWorkClaim | null = null;
  const reasonCodes = new Set<
    ClaimFieldResolution["reasonCodes"][number]
  >();

  if (selected.length === 0) {
    status = "insufficient_evidence";
    if (
      claims.some(
        (claim) =>
          claim.authority === "authoritative" &&
          claim.freshness === "stale"
      )
    ) {
      reasonCodes.add("AUTHORITATIVE_CLAIM_STALE");
    } else {
      reasonCodes.add("AUTHORITATIVE_CLAIM_MISSING");
    }
    if (claims.some((claim) => claim.authority === "context_only")) {
      reasonCodes.add("CONTEXT_ONLY_EVIDENCE");
    }
  } else if (needsCorroboration && selectedLineageCount < 2) {
    status = "insufficient_evidence";
    reasonCodes.add("MINIMUM_CORROBORATION_MISSING");
  } else if (lineageSelection.ambiguous || uniqueSelectedValues.size > 1) {
    status = "review_required";
    reasonCodes.add("EQUAL_AUTHORITY_CONFLICT");
  } else {
    status = "resolved";
    winner = chooseWinner(selected);
    reasonCodes.add(
      selected.length > 1
        ? "CONSISTENT_AUTHORITATIVE_CLAIMS"
        : "AUTHORITATIVE_CLAIM_SELECTED"
    );
  }

  if (
    winner &&
    claims.some(
      (claim) =>
        claim.lineageRef === winner?.lineageRef &&
        claim.valueSha256 !== winner.valueSha256 &&
        effectiveClaimTime(claim) < effectiveClaimTime(winner)
    )
  ) {
    reasonCodes.add("NEWER_SAME_LINEAGE_SELECTED");
  }
  if (
    winner &&
    claims.some(
      (claim) =>
        claim.valueSha256 !== winner?.valueSha256 &&
        claim.authority !== "authoritative"
    )
  ) {
    reasonCodes.add("LOWER_AUTHORITY_DISAGREEMENT");
  }
  if (
    winner &&
    claims.some(
      (claim) =>
        claim.claimId === winner?.claimId &&
        claim.completeness !== "complete"
    )
  ) {
    reasonCodes.add("PARTIAL_EVIDENCE");
  }

  const claimIds = claims
    .map((claim) => claim.claimId)
    .sort(compareRuntimeStrings);
  const resolution = claimFieldResolutionSchema.parse({
    resolutionId: createClaimResolutionId({
      claimKey: first.claimKey,
      claimIds
    }),
    claimKey: first.claimKey,
    target: first.target,
    field: first.field,
    status,
    winningClaimId: winner?.claimId ?? null,
    claimIds,
    reasonCodes: [...reasonCodes].sort(compareRuntimeStrings),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });

  return {
    resolution,
    conflict: buildConflict(claims, resolution, winner)
  };
}

function buildConflict(
  claims: NormalizedWorkClaim[],
  resolution: ClaimFieldResolution,
  winner: NormalizedWorkClaim | null
): ClaimConflict | null {
  const values = new Set(claims.map((claim) => claim.valueSha256));
  if (values.size < 2) return null;
  const claimIds = claims
    .map((claim) => claim.claimId)
    .sort(compareRuntimeStrings);
  const relationRefs = [
    ...new Set(claims.flatMap((claim) => claim.relationRefs))
  ].sort(compareRuntimeStrings);
  const hasOlderSameLineageDisagreement =
    winner !== null &&
    claims.some(
      (claim) =>
        claim.lineageRef === winner.lineageRef &&
        claim.valueSha256 !== winner.valueSha256 &&
        effectiveClaimTime(claim) < effectiveClaimTime(winner)
    );
  const hasLowerAuthorityDisagreement =
    winner !== null &&
    claims.some(
      (claim) =>
        claim.valueSha256 !== winner.valueSha256 &&
        authorityRank(claim.authority) < authorityRank(winner.authority)
    );
  const hasStaleAuthorityDisagreement =
    winner !== null &&
    claims.some(
      (claim) =>
        claim.authority === "authoritative" &&
        claim.freshness === "stale" &&
        claim.valueSha256 !== winner.valueSha256
    );
  const onlyStaleAuthority =
    winner === null &&
    claims.some(
      (claim) =>
        claim.authority === "authoritative" &&
        claim.freshness === "stale"
    ) &&
    !claims.some(
      (claim) =>
        claim.authority === "authoritative" &&
        claim.freshness === "current"
    );

  const status: ClaimConflict["status"] =
    resolution.status !== "resolved"
      ? "review_required"
      : hasOlderSameLineageDisagreement || hasStaleAuthorityDisagreement
        ? "resolved_by_freshness"
        : "resolved_by_authority";
  const reasonCode: ClaimConflict["reasonCode"] =
    hasOlderSameLineageDisagreement
      ? "OLDER_LINEAGE_VALUE_DISAGREEMENT"
      : hasStaleAuthorityDisagreement
        ? "STALE_AUTHORITY_VALUE_DISAGREEMENT"
      : hasLowerAuthorityDisagreement
        ? "LOWER_AUTHORITY_VALUE_DISAGREEMENT"
        : onlyStaleAuthority
          ? "STALE_AUTHORITY_VALUE_DISAGREEMENT"
          : "EQUAL_AUTHORITY_VALUE_DISAGREEMENT";

  return claimConflictSchema.parse({
    conflictId: createClaimConflictId({
      claimKey: resolution.claimKey,
      claimIds
    }),
    conflictSchemaVersion: CLAIM_CONFLICT_SCHEMA_VERSION,
    claimKey: resolution.claimKey,
    target: resolution.target,
    field: resolution.field,
    status,
    criticality: "critical",
    reasonCode,
    winningClaimId: status === "review_required" ? null : winner?.claimId ?? null,
    claimIds,
    relationRefs,
    nextAction:
      status !== "review_required"
        ? "none"
        : onlyStaleAuthority
          ? "refresh_sources"
          : "user_review",
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function selectLatestPerLineage(claims: NormalizedWorkClaim[]): {
  selected: NormalizedWorkClaim[];
  ambiguous: boolean;
} {
  const byLineage = new Map<string, NormalizedWorkClaim[]>();
  for (const claim of claims) {
    byLineage.set(claim.lineageRef, [
      ...(byLineage.get(claim.lineageRef) ?? []),
      claim
    ]);
  }
  const selected: NormalizedWorkClaim[] = [];
  let ambiguous = false;
  for (const lineageRef of [...byLineage.keys()].sort(compareRuntimeStrings)) {
    const lineage = byLineage.get(lineageRef) ?? [];
    const latestTime = Math.max(...lineage.map(effectiveClaimTime));
    const latest = lineage
      .filter((claim) => effectiveClaimTime(claim) === latestTime)
      .sort(compareClaims);
    if (new Set(latest.map((claim) => claim.valueSha256)).size > 1) {
      ambiguous = true;
      selected.push(...latest);
    } else if (latest[0]) {
      selected.push(latest[0]);
    }
  }
  return { selected, ambiguous };
}

function chooseWinner(claims: NormalizedWorkClaim[]): NormalizedWorkClaim {
  const sorted = [...claims].sort(
    (left, right) =>
      authorityRank(right.authority) - authorityRank(left.authority) ||
      effectiveClaimTime(right) - effectiveClaimTime(left) ||
      compareRuntimeStrings(left.source, right.source) ||
      compareRuntimeStrings(left.claimId, right.claimId)
  );
  const winner = sorted[0];
  if (!winner) throw new TypeError("Resolved claim group requires a winner.");
  return winner;
}

function authorityRank(
  authority: NormalizedWorkClaim["authority"]
): number {
  switch (authority) {
    case "authoritative":
      return 3;
    case "supporting":
      return 2;
    case "context_only":
      return 1;
  }
}

function effectiveClaimTime(claim: NormalizedWorkClaim): number {
  return Date.parse(claim.sourceUpdatedAt ?? claim.observedAt);
}

function deduplicateClaims(
  claims: NormalizedWorkClaim[]
): NormalizedWorkClaim[] {
  const byId = new Map<string, NormalizedWorkClaim>();
  for (const claim of claims) {
    const previous = byId.get(claim.claimId);
    if (previous && runtimeSha256(previous) !== runtimeSha256(claim)) {
      throw new TypeError("Duplicate claim ID contains conflicting content.");
    }
    byId.set(claim.claimId, claim);
  }
  return [...byId.values()];
}

function groupClaimsByKey(
  claims: NormalizedWorkClaim[]
): Map<string, NormalizedWorkClaim[]> {
  const result = new Map<string, NormalizedWorkClaim[]>();
  for (const claim of claims) {
    result.set(claim.claimKey, [
      ...(result.get(claim.claimKey) ?? []),
      claim
    ]);
  }
  return result;
}

function canonicalCoverage(
  input: ClaimSourceCoverage[]
): ClaimSourceCoverage[] {
  const parsed = input.map((coverage) =>
    claimSourceCoverageSchema.parse(coverage)
  );
  const bySource = new Map(
    parsed.map((coverage) => [coverage.source, coverage])
  );
  if (
    parsed.length !== CLAIM_COVERAGE_SOURCES.length ||
    bySource.size !== CLAIM_COVERAGE_SOURCES.length ||
    CLAIM_COVERAGE_SOURCES.some((source) => !bySource.has(source))
  ) {
    throw new TypeError("Claim resolver requires explicit coverage for every source.");
  }
  return [...bySource.values()].sort((left, right) =>
    compareRuntimeStrings(left.source, right.source)
  );
}

function compareClaims(
  left: NormalizedWorkClaim,
  right: NormalizedWorkClaim
): number {
  return (
    compareRuntimeStrings(left.claimKey, right.claimKey) ||
    compareRuntimeStrings(left.claimId, right.claimId)
  );
}

export function canonicalClaimCoverage(input: {
  github: "evaluated" | "stale" | "partial" | "unavailable";
}): ClaimSourceCoverage[] {
  const githubReasons: ClaimSourceCoverage["reasonCodes"] = [
    input.github === "evaluated"
      ? "GITHUB_DIRECT_FIELDS_EVALUATED"
      : input.github === "stale"
        ? "GITHUB_SNAPSHOT_STALE"
        : input.github === "partial"
          ? "GITHUB_SNAPSHOT_PARTIAL"
          : "GITHUB_SNAPSHOT_UNAVAILABLE"
  ];
  return canonicalCoverage([
    {
      source: "github",
      status: input.github,
      claimFields:
        input.github === "unavailable"
          ? []
          : [
              "github_milestone_due_at",
              "github_native_identity",
              "github_user_relationship",
              "github_work_item_state"
            ],
      reasonCodes: githubReasons
    },
    {
      source: "codex_managed",
      status: "evaluated",
      claimFields: ["managed_codex_execution_state"],
      reasonCodes: ["MANAGED_CODEX_DIRECT_EVENTS_EVALUATED"]
    },
    {
      source: "codex_inventory",
      status: "context_only",
      claimFields: [],
      reasonCodes: ["CODEX_INVENTORY_NOT_LIVE"]
    },
    {
      source: "notion",
      status: "context_only",
      claimFields: [],
      reasonCodes: ["NOTION_TASK_PROPERTIES_UNAVAILABLE"]
    },
    {
      source: "google_calendar",
      status: "context_only",
      claimFields: [],
      reasonCodes: ["CALENDAR_WORK_EQUIVALENCE_UNAVAILABLE"]
    },
    {
      source: "explicit_user",
      status: "evaluated",
      claimFields: ["project_alignment_identity"],
      reasonCodes: ["EXPLICIT_PROJECT_MAPPING_EVALUATED"]
    }
  ]);
}

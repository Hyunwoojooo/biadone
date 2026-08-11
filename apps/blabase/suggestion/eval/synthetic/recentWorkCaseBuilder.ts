import { z } from "zod";

import {
  sealCodexLocalGitSnapshot,
  type CodexLocalGitSnapshot,
  type CodexLocalGitTrackingState
} from "../../src/connectors/codex/localGitContracts";
import type { ConfirmedRepositoryScopeLinkResolution } from "../../src/context";
import { runtimeSha256 } from "../../src/crossSource/canonicalHash";
import type { RuntimeWorkSignalBatch } from "../../src/crossSource/schema";
import type { CurrentFocusProjection } from "../../src/currentFocus";
import { createRecentMeaningfulEventId } from "../../src/recentEvents";
import {
  recentWorkReasonCodeSchema,
  type ResolveRecentWorkInput
} from "../../src/recentWork";

export const RECENT_WORK_EVALUATION_SCENARIOS = [
  "present_in_sync",
  "shadow_ahead",
  "present_behind",
  "present_diverged",
  "present_not_configured",
  "push_age_boundary",
  "push_future_skew_boundary",
  "local_git_age_boundary",
  "local_git_future_skew_boundary",
  "focus_partial",
  "focus_stale",
  "focus_non_push",
  "project_level_display_only",
  "mapping_missing",
  "mapping_different_repository",
  "mapping_removed_upstream",
  "mapping_archived_upstream",
  "mapping_duplicate",
  "same_project_multi_repository",
  "local_git_unavailable_unborn",
  "invalid_rollout_defaults_shadow",
  "seconds_public_canonicalization_privacy",
  "deterministic_active_no_effect"
] as const;

const trackingStateSchema = z.enum([
  "in_sync",
  "ahead",
  "behind",
  "diverged",
  "not_configured",
  "unborn",
  "unavailable"
]);
const publicTrackingStateSchema = trackingStateSchema.exclude([
  "unborn",
  "unavailable"
]);
const linkModeSchema = z.enum([
  "exact",
  "missing",
  "different_repository",
  "removed_filtered",
  "archived_filtered",
  "duplicate",
  "same_project_multi_repository"
]);
const presentationInputSchema = z.enum(["shadow", "present", "invalid"]);

const variantInputSchema = z
  .object({
    pushOccurredAt: z.string().datetime().optional(),
    localGitFetchedAt: z.string().datetime().optional(),
    focusLevel: z.enum(["exact_task", "project"]).optional(),
    focusKind: z.enum(["github_push", "github_issue_reopened"]).optional(),
    focusCurrentness: z.enum(["current", "stale"]).optional(),
    focusCompleteness: z.enum(["complete", "partial"]).optional(),
    eventCurrentness: z.enum(["current", "stale"]).optional(),
    eventCompleteness: z.enum(["complete", "partial"]).optional(),
    eventFreshness: z.enum(["current", "stale"]).optional(),
    eventAttentionCapability: z
      .enum(["focus_selector", "historical_context_only"])
      .optional(),
    linkMode: linkModeSchema.optional(),
    trackingState: trackingStateSchema.optional(),
    presentationInput: presentationInputSchema.optional()
  })
  .strict();

const expectedVariantSchema = z
  .object({
    projectionStatus: z.enum(["matched", "unavailable"]),
    reasonCode: recentWorkReasonCodeSchema,
    presentationMode: z.enum(["shadow", "present"]),
    summaryDisposition: z.enum(["present", "null"]),
    trackingState: publicTrackingStateSchema.nullable(),
    aheadCount: z.number().int().min(0).max(100_000).nullable(),
    behindCount: z.number().int().min(0).max(100_000).nullable(),
    publicPushOccurredAt: z.string().datetime({ precision: 3 }).nullable()
  })
  .strict();

const recentWorkEvaluationCaseSchema = z
  .object({
    caseId: z.string().regex(/^RW-PROJ-DEV-[0-9]{3}$/u),
    scenario: z.enum(RECENT_WORK_EVALUATION_SCENARIOS),
    evaluationKind: z.enum([
      "runtime",
      "boundary_matrix",
      "upstream_filtered_runtime",
      "state_matrix",
      "invariant"
    ]),
    upstreamMappingState: z.enum([
      "not_applicable",
      "removed",
      "archived"
    ]),
    labels: z.array(z.string().min(1).max(80)).min(1).max(12),
    privateSentinels: z.array(z.string().min(1).max(240)).max(12),
    variants: z
      .array(
        z
          .object({
            variantId: z.string().regex(/^[a-z0-9-]{1,80}$/u),
            input: variantInputSchema,
            expected: expectedVariantSchema
          })
          .strict()
      )
      .min(1)
      .max(4)
  })
  .strict()
  .superRefine((definition, context) => {
    const filtered = definition.evaluationKind === "upstream_filtered_runtime";
    if (
      filtered !== (definition.upstreamMappingState !== "not_applicable") ||
      (definition.upstreamMappingState === "removed" &&
        definition.variants.some(
          (variant) => variant.input.linkMode !== "removed_filtered"
        )) ||
      (definition.upstreamMappingState === "archived" &&
        definition.variants.some(
          (variant) => variant.input.linkMode !== "archived_filtered"
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["upstreamMappingState"],
        message:
          "Upstream-filtered mapping coverage must be explicit and cannot masquerade as a Recent Work resolver decision."
      });
    }
  });

export const recentWorkEvaluationDatasetSchema = z
  .object({
    contract: z.literal("recent-work-projection-evaluation-dataset-v0.1"),
    schemaVersion: z.literal(
      "recent-work-projection-evaluation-case-v0.1"
    ),
    datasetVersion: z.literal(
      "suggestion-recent-work-projection-dev-v0.1"
    ),
    datasetRevision: z.literal(1),
    datasetClass: z.literal("regression_dev_candidate"),
    split: z.literal("development"),
    scope: z.literal("repository_scope_recent_work_projection_v0.1"),
    dataOrigin: z.literal("bounded_synthetic_non_private"),
    containsProductionData: z.literal(false),
    createdAt: z.string().datetime({ precision: 3 }),
    lifecycle: z
      .object({
        state: z.literal("mutable"),
        datasetSha256: z.null(),
        immutableRef: z.null(),
        frozenAt: z.null()
      })
      .strict(),
    config: z
      .object({
        ref: z.literal(
          "eval/synthetic/recentWorkProjectionConfig.v0.1.json"
        ),
        version: z.literal("recent-work-projection-config-v0.1")
      })
      .strict(),
    cases: z.array(recentWorkEvaluationCaseSchema).length(23)
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = new Set<string>();
    const scenarios = new Set<string>();
    dataset.cases.forEach((definition, index) => {
      const expectedId = `RW-PROJ-DEV-${String(index + 1).padStart(3, "0")}`;
      if (definition.caseId !== expectedId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "caseId"],
          message: "Recent Work Dev Candidate IDs must be canonical and ordered."
        });
      }
      if (ids.has(definition.caseId) || scenarios.has(definition.scenario)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index],
          message: "Recent Work cases and scenarios must be unique."
        });
      }
      ids.add(definition.caseId);
      scenarios.add(definition.scenario);
    });
  });

const fixtureDefaultsSchema = z
  .object({
    asOf: z.string().datetime({ precision: 3 }),
    pushOccurredAt: z.string().datetime(),
    localGitFetchedAt: z.string().datetime(),
    focusLevel: z.enum(["exact_task", "project"]),
    focusKind: z.enum(["github_push", "github_issue_reopened"]),
    focusCurrentness: z.enum(["current", "stale"]),
    focusCompleteness: z.enum(["complete", "partial"]),
    eventCurrentness: z.enum(["current", "stale"]),
    eventCompleteness: z.enum(["complete", "partial"]),
    eventFreshness: z.enum(["current", "stale"]),
    eventAttentionCapability: z.enum([
      "focus_selector",
      "historical_context_only"
    ]),
    linkMode: linkModeSchema,
    trackingState: trackingStateSchema,
    presentationInput: presentationInputSchema,
    displayLabel: z.string().min(1).max(240)
  })
  .strict();
const trackingCountsSchema = z
  .object({
    aheadCount: z.number().int().min(0).max(100_000).nullable(),
    behindCount: z.number().int().min(0).max(100_000).nullable()
  })
  .strict();

export const recentWorkEvaluationConfigSchema = z
  .object({
    version: z.literal("recent-work-projection-config-v0.1"),
    purpose: z.literal(
      "targeted_synthetic_repository_scope_recent_work_projection_evaluation_only"
    ),
    lifecycle: z
      .object({
        state: z.literal("mutable"),
        configSha256: z.null(),
        immutableRef: z.null()
      })
      .strict(),
    fixtureDefaults: fixtureDefaultsSchema,
    trackingMatrices: z
      .object({
        in_sync: trackingCountsSchema,
        ahead: trackingCountsSchema,
        behind: trackingCountsSchema,
        diverged: trackingCountsSchema,
        not_configured: trackingCountsSchema,
        unborn: trackingCountsSchema,
        unavailable: trackingCountsSchema
      })
      .strict(),
    recency: z
      .object({
        focusMaxAgeMs: z.literal(86_400_000),
        localGitMaxAgeMs: z.literal(300_000),
        maxFutureSkewMs: z.literal(60_000)
      })
      .strict(),
    scopeTruth: z
      .object({
        recentWorkContract: z.literal("recent-work-projection-v0.1"),
        correlationBasis: z.literal("repository_scope_only"),
        presentation: z.literal("display_only"),
        defaultMode: z.literal("shadow"),
        actorOriginProvenanceAvailable: z.literal(false),
        exactCommitEqualityAvailable: z.literal(false),
        continuationObservationContextOfferAvailable: z.literal(false),
        heartbeatOrResumeActionAvailable: z.literal(false),
        fourModeRolloutAvailable: z.literal(false),
        appliedSelectionAvailable: z.literal(false),
        monitorV07OrReplayV4Available: z.literal(false)
      })
      .strict(),
    releaseGates: z
      .object({
        allCasesMustPass: z.literal(true),
        allFivePublicTrackingStatesRequired: z.literal(true),
        presentAndShadowCoverageRequired: z.literal(true),
        deterministicHashFailureMax: z.literal(0),
        privacyLeakageMax: z.literal(0),
        activeInputMutationMax: z.literal(0),
        candidateUniverseDiffMax: z.literal(0),
        eligibilityDiffMax: z.literal(0),
        activeSelectionDiffMax: z.literal(0),
        activeResultHashDiffMax: z.literal(0),
        recentWorkEffectViolationMax: z.literal(0),
        humanReviewRequiredBeforeFreezeOrRollout: z.literal(true)
      })
      .strict(),
    privacy: z
      .object({
        containsProductionData: z.literal(false),
        rawConversationAllowed: z.literal(false),
        credentialOrTokenAllowed: z.literal(false),
        absoluteLocalPathAllowed: z.literal(false),
        rawBranchOrCommitAllowed: z.literal(false),
        remoteTelemetryAdded: z.literal(false),
        artifactRetention: z.literal("private_local_evaluation_artifact")
      })
      .strict()
  })
  .strict()
  .superRefine((config, context) => {
    const expectedMatrices = {
      in_sync: [0, 0],
      ahead: [2, 0],
      behind: [0, 3],
      diverged: [2, 3],
      not_configured: [null, null],
      unborn: [null, null],
      unavailable: [null, null]
    } as const;
    for (const [state, expected] of Object.entries(expectedMatrices)) {
      const actual = config.trackingMatrices[
        state as keyof typeof config.trackingMatrices
      ];
      if (
        actual.aheadCount !== expected[0] ||
        actual.behindCount !== expected[1]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trackingMatrices", state],
          message: "Recent Work tracking matrices must match Local Git v1."
        });
      }
    }
  });

export type RecentWorkEvaluationDataset = z.infer<
  typeof recentWorkEvaluationDatasetSchema
>;
export type RecentWorkEvaluationCaseDefinition =
  RecentWorkEvaluationDataset["cases"][number];
export type RecentWorkEvaluationConfig = z.infer<
  typeof recentWorkEvaluationConfigSchema
>;
export type RecentWorkExpectedVariant = z.infer<
  typeof expectedVariantSchema
>;
export type RecentWorkEvaluationVariantFixture = {
  variantId: string;
  input: ResolveRecentWorkInput;
  presentationInput: "shadow" | "present" | "invalid";
  expected: RecentWorkExpectedVariant;
  forbiddenPublicValues: string[];
};
export type RecentWorkEvaluationFixture = {
  definition: RecentWorkEvaluationCaseDefinition;
  variants: RecentWorkEvaluationVariantFixture[];
};

const PROJECT_ID = `project_${"1".repeat(32)}`;
const PRIMARY_SCOPE_ID = "b".repeat(24);
const SECONDARY_SCOPE_ID = "c".repeat(24);
const PRIMARY_REPOSITORY_KEY = `github_repo_${"3".repeat(32)}`;
const SECONDARY_REPOSITORY_KEY = `github_repo_${"4".repeat(32)}`;
const REGISTRY_SHA256 = "a".repeat(64);

export function buildRecentWorkEvaluationFixture(
  definition: RecentWorkEvaluationCaseDefinition,
  config: RecentWorkEvaluationConfig
): RecentWorkEvaluationFixture {
  return {
    definition,
    variants: definition.variants.map((variant) => {
      const options = { ...config.fixtureDefaults, ...variant.input };
      const snapshot = localGitSnapshot(options, config);
      const githubBatch = pushBatch(options.pushOccurredAt);
      const input: ResolveRecentWorkInput = {
        asOf: options.asOf,
        currentFocus: currentFocus(options, githubBatch),
        githubBatch,
        confirmedLinks: confirmedLinks(options.linkMode, snapshot),
        localGitSnapshot: snapshot
      };
      return {
        variantId: variant.variantId,
        input,
        presentationInput: options.presentationInput,
        expected: variant.expected,
        forbiddenPublicValues: [
          ...definition.privateSentinels,
          PROJECT_ID,
          PRIMARY_SCOPE_ID,
          SECONDARY_SCOPE_ID,
          PRIMARY_REPOSITORY_KEY,
          SECONDARY_REPOSITORY_KEY,
          `local_repo_${"1".repeat(64)}`,
          `local_repo_${"5".repeat(64)}`,
          `local_commit_${"2".repeat(64)}`,
          `local_commit_${"6".repeat(64)}`,
          `repository_scope_link_${"c".repeat(32)}`
        ]
      };
    })
  };
}

type MaterializedOptions = RecentWorkEvaluationConfig["fixtureDefaults"];

function currentFocus(
  options: MaterializedOptions,
  githubBatch: RuntimeWorkSignalBatch
): CurrentFocusProjection {
  const eventId = selectedPushEventId(githubBatch);
  const eventSha256 = runtimeSha256({
    domain: "recent-work-evaluation-focus-event-v0.1",
    eventId,
    kind: options.focusKind,
    occurredAt: options.pushOccurredAt,
    currentness: options.eventCurrentness,
    completeness: options.eventCompleteness
  });
  return {
    status: "selected",
    projectionSha256: runtimeSha256({
      domain: "recent-work-evaluation-focus-projection-v0.1",
      eventSha256,
      level: options.focusLevel,
      projectId: PROJECT_ID
    }),
    selectedFocus: {
      projectId: PROJECT_ID,
      level: options.focusLevel,
      displayLabel: options.displayLabel,
      currentness: options.focusCurrentness,
      completeness: options.focusCompleteness,
      latestMeaningfulEvent: {
        eventId,
        source: "github",
        kind: options.focusKind,
        occurredAt: options.pushOccurredAt,
        freshness: options.eventFreshness,
        completeness: options.eventCompleteness,
        currentness: options.eventCurrentness,
        attentionCapability: options.eventAttentionCapability,
        eventSha256
      }
    }
  } as unknown as CurrentFocusProjection;
}

function pushBatch(sourceUpdatedAt: string): RuntimeWorkSignalBatch {
  const signals = [
    {
      kind: "activity_observation",
      signalId: `signal_${"4".repeat(32)}`,
      sourceScopeId: "repository:101",
      sourceUpdatedAt,
      facts: { activityKind: "push" }
    }
  ];
  return {
    batchSha256: runtimeSha256({
      domain: "recent-work-evaluation-github-batch-v0.1",
      signals
    }),
    signals
  } as unknown as RuntimeWorkSignalBatch;
}

function selectedPushEventId(batch: RuntimeWorkSignalBatch): string {
  const signal = batch.signals[0];
  if (
    !signal ||
    signal.kind !== "activity_observation" ||
    signal.sourceUpdatedAt === null
  ) {
    throw new TypeError("Synthetic Recent Work push signal is missing.");
  }
  return createRecentMeaningfulEventId({
    source: "github",
    kind: "github_push",
    stableIdentity: {
      signalId: signal.signalId,
      kind: "github_push",
      sourceUpdatedAt: signal.sourceUpdatedAt
    }
  });
}

function localGitSnapshot(
  options: MaterializedOptions,
  config: RecentWorkEvaluationConfig
): CodexLocalGitSnapshot {
  const primary = repositoryRow(
    PRIMARY_SCOPE_ID,
    PRIMARY_REPOSITORY_KEY,
    options.trackingState,
    config
  );
  const includeSecondary =
    options.linkMode === "same_project_multi_repository";
  return sealCodexLocalGitSnapshot({
    schemaVersion: "codex-local-git-snapshot-v1",
    collectorVersion: "codex-local-git-metadata-v1",
    upstreamBasis: "local_tracking_ref_without_network_refresh",
    fetchedAt: options.localGitFetchedAt,
    scopeIds: includeSecondary
      ? [PRIMARY_SCOPE_ID, SECONDARY_SCOPE_ID]
      : [PRIMARY_SCOPE_ID],
    repositories: includeSecondary
      ? [
          primary,
          repositoryRow(
            SECONDARY_SCOPE_ID,
            SECONDARY_REPOSITORY_KEY,
            "in_sync",
            config
          )
        ]
      : [primary],
    truncated: false
  });
}

function repositoryRow(
  scopeId: string,
  githubRepositoryKey: string,
  trackingState: CodexLocalGitTrackingState,
  config: RecentWorkEvaluationConfig
): CodexLocalGitSnapshot["repositories"][number] {
  const unavailable = trackingState === "unavailable";
  const hasHead = !unavailable && trackingState !== "unborn";
  const secondary = scopeId === SECONDARY_SCOPE_ID;
  const counts = config.trackingMatrices[trackingState];
  return {
    scopeId,
    repositoryId: `local_repo_${(secondary ? "5" : "1").repeat(64)}`,
    headCommitId: hasHead
      ? `local_commit_${(secondary ? "6" : "2").repeat(64)}`
      : null,
    githubRepositoryKey,
    mappingEligibility: "exact",
    trackingState,
    aheadCount: counts.aheadCount,
    behindCount: counts.behindCount,
    headCommittedAt: hasHead ? "2026-08-10T10:00:00.000Z" : null,
    unavailableReason: unavailable ? "GIT_EXECUTION_FAILED" : null
  };
}

function confirmedLinks(
  mode: MaterializedOptions["linkMode"],
  snapshot: CodexLocalGitSnapshot
): ConfirmedRepositoryScopeLinkResolution {
  const primary = confirmedLink({
    linkId: `repository_scope_link_${"c".repeat(32)}`,
    repositoryOpaqueId:
      mode === "different_repository" ? "202" : "101",
    scopeId: PRIMARY_SCOPE_ID,
    snapshotSha256: snapshot.snapshotSha256
  });
  if (
    mode === "missing" ||
    mode === "removed_filtered" ||
    mode === "archived_filtered"
  ) {
    return { status: "ready", registrySha256: REGISTRY_SHA256, links: [] };
  }
  if (mode === "duplicate") {
    return {
      status: "ready",
      registrySha256: REGISTRY_SHA256,
      links: [
        primary,
        confirmedLink({
          linkId: `repository_scope_link_${"d".repeat(32)}`,
          repositoryOpaqueId: "101",
          scopeId: SECONDARY_SCOPE_ID,
          snapshotSha256: snapshot.snapshotSha256
        })
      ]
    };
  }
  if (mode === "same_project_multi_repository") {
    return {
      status: "ready",
      registrySha256: REGISTRY_SHA256,
      links: [
        primary,
        confirmedLink({
          linkId: `repository_scope_link_${"d".repeat(32)}`,
          repositoryOpaqueId: "202",
          scopeId: SECONDARY_SCOPE_ID,
          snapshotSha256: snapshot.snapshotSha256
        })
      ]
    };
  }
  return {
    status: "ready",
    registrySha256: REGISTRY_SHA256,
    links: [primary]
  };
}

function confirmedLink(input: {
  linkId: string;
  repositoryOpaqueId: string;
  scopeId: string;
  snapshotSha256: string;
}): ConfirmedRepositoryScopeLinkResolution["links"][number] {
  return {
    linkId: input.linkId,
    projectId: PROJECT_ID,
    scopes: {
      github: {
        source: "github",
        resourceType: "repository",
        opaqueId: input.repositoryOpaqueId
      },
      codex: {
        source: "codex",
        resourceType: "scope",
        opaqueId: input.scopeId
      }
    },
    registrySha256: REGISTRY_SHA256,
    githubFetchedAt: "2026-08-10T11:59:00.000Z",
    localGitSnapshotSha256: input.snapshotSha256,
    correlation: "repository_scope_only"
  };
}

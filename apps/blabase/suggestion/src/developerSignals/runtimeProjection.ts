import { z } from "zod";

import {
  activeAttentionResultSchema,
  type ActiveAttentionAssessment,
  type ActiveAttentionCandidate,
  type ActiveAttentionResult
} from "../attentionDecision/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  attentionEligibilityShadowProjectionSchema,
  type AttentionEligibilityShadowProjection
} from "../eligibility/contracts";
import {
  buildDeveloperCandidateFunnel,
  candidateFunnelReferencesLedger,
  developerCandidateFunnelStageSummarySchema,
  developerCandidateFunnelProjectionSchema,
  type DeveloperCandidateFunnelProjection,
  type DeveloperCandidateTrace
} from "./candidateFunnel";
import {
  codexOpenLoopLedgerSchema,
  type CodexOpenLoopClaim,
  type CodexOpenLoopLedger
} from "./codexOpenLoops";
import {
  buildDeveloperWorkLedger,
  createDeveloperWorkEntityId,
  createDeveloperWorkEvidenceId,
  developerWorkLedgerSchema,
  type DeveloperWorkEvidence,
  type DeveloperWorkLedger,
  type DeveloperWorkLedgerDraft
} from "./workLedger";

export const DEVELOPER_RUNTIME_PROJECTION_CONTRACT =
  "developer-runtime-projection-v0.1" as const;
export const DEVELOPER_RUNTIME_PROJECTION_SCHEMA_VERSION =
  "developer-runtime-projection-schema-v0.1" as const;
export const DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION =
  "developer-runtime-projection-rules-v0.1" as const;
export const DEVELOPER_RUNTIME_PUBLIC_SUMMARY_CONTRACT =
  "developer-runtime-public-summary-v0.1" as const;
export const DEVELOPER_RUNTIME_PRIVACY_POLICY_VERSION =
  "developer-runtime-public-aggregate-only-v0.1" as const;
export const CODEX_HISTORY_CURRENTNESS_POLICY_VERSION =
  "codex-history-currentness-unverified-v0.1" as const;

const RETENTION_DAYS = 30;
const timestampSchema = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value, {
    message: "Runtime projection timestamps must use canonical UTC ISO format."
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const runIdSchema = z.string().regex(/^run_[a-f0-9]{32}$/);
const analysisIdSchema = z.string().regex(/^analysis_[a-f0-9]{32}$/);

export const developerRuntimeCodeProvenanceSchema = z
  .object({
    codeState: z.enum([
      "clean_commit",
      "declared_commit",
      "dirty_worktree",
      "unavailable"
    ]),
    codeCommitSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
    codeFingerprintSha256: sha256Schema.nullable()
  })
  .strict()
  .superRefine((provenance, context) => {
    const commit =
      provenance.codeState === "clean_commit" ||
      provenance.codeState === "declared_commit";
    const dirty = provenance.codeState === "dirty_worktree";
    if (
      commit !== (provenance.codeCommitSha !== null) ||
      dirty !== (provenance.codeFingerprintSha256 !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime code provenance fields do not match code state."
      });
    }
  });

export const developerRuntimeProjectionInputSchema = z
  .object({
    asOf: timestampSchema,
    runId: runIdSchema,
    analysisId: analysisIdSchema,
    codeProvenance: developerRuntimeCodeProvenanceSchema,
    githubBatch: runtimeWorkSignalBatchSchema.nullable(),
    codexBatch: runtimeWorkSignalBatchSchema.nullable(),
    // The Active contract imports eligibility contracts, so keep this edge
    // lazy to avoid freezing an uninitialized binding in the schema graph.
    activeAttentionResult: z.lazy(() => activeAttentionResultSchema),
    eligibilityProjection: attentionEligibilityShadowProjectionSchema,
    codexOpenLoopLedger: codexOpenLoopLedgerSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.githubBatch !== null && input.githubBatch.source !== "github") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubBatch", "source"],
        message: "The GitHub runtime input must contain a GitHub batch."
      });
    }
    if (input.codexBatch !== null && input.codexBatch.source !== "codex") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["codexBatch", "source"],
        message: "The Codex runtime input must contain a Codex batch."
      });
    }
    for (const [path, value] of [
      ["activeAttentionResult", input.activeAttentionResult.asOf],
      ["eligibilityProjection", input.eligibilityProjection.asOf],
      ["codexOpenLoopLedger", input.codexOpenLoopLedger.asOf],
      ["githubBatch", input.githubBatch?.assessment.asOf],
      ["codexBatch", input.codexBatch?.assessment.asOf]
    ] as const) {
      if (value !== undefined && value !== input.asOf) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: "All runtime projection inputs must share one as-of time."
        });
      }
    }
    const githubBatchSha256 = input.githubBatch?.batchSha256 ?? null;
    const githubSnapshotSha256 =
      input.githubBatch?.sourceSnapshotSha256 ?? null;
    if (
      input.activeAttentionResult.dependencies.githubBatchSha256 !==
        githubBatchSha256 ||
      input.activeAttentionResult.dependencies
        .githubSourceSnapshotSha256 !== githubSnapshotSha256 ||
      input.eligibilityProjection.dependencies.githubBatchSha256 !==
        githubBatchSha256 ||
      input.eligibilityProjection.dependencies
        .githubSourceSnapshotSha256 !== githubSnapshotSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubBatch"],
        message:
          "Runtime GitHub lineage must match both eligibility and active Attention."
      });
    }
    if (
      input.activeAttentionResult.dependencies.eligibilityProjectionSha256 !==
      input.eligibilityProjection.projectionSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eligibilityProjection"],
        message:
          "Active Attention must reference the supplied eligibility projection."
      });
    }
  });

const publicEntityCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    evidence: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    workItems: z.number().int().nonnegative(),
    executions: z.number().int().nonnegative(),
    openLoops: z.number().int().nonnegative(),
    blockers: z.number().int().nonnegative(),
    nextActions: z.number().int().nonnegative()
  })
  .strict();

const publicClaimCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    superseded: z.number().int().nonnegative(),
    byType: z
      .object({
        goal: z.number().int().nonnegative(),
        remainingWork: z.number().int().nonnegative(),
        blocker: z.number().int().nonnegative(),
        verificationNeeded: z.number().int().nonnegative(),
        followThrough: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

const developerRuntimePublicSummaryContentSchema = z
  .object({
    contract: z.literal(DEVELOPER_RUNTIME_PUBLIC_SUMMARY_CONTRACT),
    privacyPolicyVersion: z.literal(
      DEVELOPER_RUNTIME_PRIVACY_POLICY_VERSION
    ),
    privacyClass: z.literal("public_aggregate_metadata"),
    asOf: timestampSchema,
    runId: runIdSchema,
    analysisId: analysisIdSchema,
    resultId: z.string().regex(/^attention_result_[a-f0-9]{32}$/),
    ledgerId: z.string().regex(/^work_ledger_[a-f0-9]{32}$/),
    ledgerSha256: sha256Schema,
    funnelId: z.string().regex(/^candidate_funnel_[a-f0-9]{32}$/),
    funnelSha256: sha256Schema,
    entityCounts: publicEntityCountsSchema,
    claimCounts: publicClaimCountsSchema,
    stageSummaries: z.array(developerCandidateFunnelStageSummarySchema)
  })
  .strict();

export const developerRuntimePublicSummarySchema =
  developerRuntimePublicSummaryContentSchema
    .extend({ summarySha256: sha256Schema })
    .strict()
    .superRefine((summary, context) => {
      if (summary.summarySha256 !== developerRuntimePublicSummarySha256(summary)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["summarySha256"],
          message: "Runtime public summary hash does not match its content."
        });
      }
      const entities = summary.entityCounts;
      if (
        entities.total !==
        entities.projects +
          entities.workItems +
          entities.executions +
          entities.openLoops +
          entities.blockers +
          entities.nextActions
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entityCounts", "total"],
          message: "Public entity totals do not match their components."
        });
      }
      const claims = summary.claimCounts;
      if (
        claims.total !== claims.open + claims.expired + claims.superseded ||
        claims.total !==
          claims.byType.goal +
            claims.byType.remainingWork +
            claims.byType.blocker +
            claims.byType.verificationNeeded +
            claims.byType.followThrough
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claimCounts", "total"],
          message: "Public claim totals do not match their components."
        });
      }
    });

export const developerRuntimeProjectionSchema = z
  .object({
    contract: z.literal(DEVELOPER_RUNTIME_PROJECTION_CONTRACT),
    schemaVersion: z.literal(DEVELOPER_RUNTIME_PROJECTION_SCHEMA_VERSION),
    ruleVersion: z.literal(DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION),
    inputSha256: sha256Schema,
    ledger: developerWorkLedgerSchema,
    funnel: developerCandidateFunnelProjectionSchema,
    publicSummary: developerRuntimePublicSummarySchema
  })
  .strict()
  .superRefine((projection, context) => {
    if (!candidateFunnelReferencesLedger(projection.funnel, projection.ledger)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["funnel"],
        message: "Runtime candidate funnel must reference its exact work ledger."
      });
    }
    const expectedSummary = publicSummaryContent(
      projection.ledger,
      projection.funnel,
      projection.publicSummary.claimCounts
    );
    const { summarySha256: _summarySha256, ...actualSummary } =
      projection.publicSummary;
    if (runtimeSha256(actualSummary) !== runtimeSha256(expectedSummary)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicSummary"],
        message: "Public summary must exactly describe the private projections."
      });
    }
  });

export type DeveloperRuntimeCodeProvenance = z.infer<
  typeof developerRuntimeCodeProvenanceSchema
>;
export type DeveloperRuntimeProjectionInput = z.infer<
  typeof developerRuntimeProjectionInputSchema
>;
export type DeveloperRuntimePublicSummary = z.infer<
  typeof developerRuntimePublicSummarySchema
>;
export type DeveloperRuntimeProjection = z.infer<
  typeof developerRuntimeProjectionSchema
>;

type GitHubWorkItemSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;
type GitHubDeadlineSignal = Extract<
  RuntimeWorkSignal,
  { kind: "deadline_observation" }
>;
type CodexExecutionSignal = Extract<
  RuntimeWorkSignal,
  { kind: "execution_observation" }
>;
type DraftProject = DeveloperWorkLedgerDraft["projects"][number];
type DraftWorkItem = DeveloperWorkLedgerDraft["workItems"][number];
type DraftExecution = DeveloperWorkLedgerDraft["executions"][number];
type DraftOpenLoop = DeveloperWorkLedgerDraft["openLoops"][number];
type DraftBlocker = DeveloperWorkLedgerDraft["blockers"][number];
type DraftNextAction = DeveloperWorkLedgerDraft["nextActions"][number];

type LedgerAssembly = {
  draft: DeveloperWorkLedgerDraft;
  assessmentEvidenceIds: Map<string, string>;
  assessmentNextActionIds: Map<string, string>;
  githubSignalEvidenceIds: Map<string, string>;
  codexSignalEvidenceIds: Map<string, string>;
  claimEvidenceIds: Map<string, string>;
  workItemIdsBySubject: Map<string, string>;
  executionIdsBySubject: Map<string, string>;
};

type ProjectAggregate = {
  projectId: string;
  labels: Array<{ source: "github" | "codex"; value: string }>;
  sourceScopes: Map<
    string,
    { source: "github" | "codex"; sourceScopeSha256: string }
  >;
  evidenceIds: Set<string>;
  reasonCodes: Set<string>;
};

type SafeActionability = {
  checksFailed: boolean;
  changesRequested: boolean;
  mergeConflict: boolean;
};

/**
 * Builds an observational sidecar only. It does not call, rank, or alter the
 * active resolver. Codex inventory/history is retained as private context but
 * is always stopped before eligibility unless an independent managed-live
 * Active assessment already exists.
 */
export function buildDeveloperRuntimeProjection(
  input: DeveloperRuntimeProjectionInput
): DeveloperRuntimeProjection {
  const parsed = developerRuntimeProjectionInputSchema.parse(input);
  const inputSha256 = developerRuntimeProjectionInputSha256(parsed);
  const assembly = assembleLedger(parsed, inputSha256);
  const ledger = buildDeveloperWorkLedger(assembly.draft);
  const funnel = buildDeveloperCandidateFunnel({
    runId: parsed.runId,
    analysisId: parsed.analysisId,
    resultId: parsed.activeAttentionResult.resultId,
    ledgerId: ledger.ledgerId,
    ledgerSha256: ledger.ledgerSha256,
    asOf: parsed.asOf,
    inputSha256,
    candidateRuleVersion: parsed.activeAttentionResult.candidateRuleVersion,
    normalizationVersions: canonicalStrings([
      DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
      ...(parsed.githubBatch ? [parsed.githubBatch.normalizerVersion] : []),
      ...(parsed.codexBatch ? [parsed.codexBatch.normalizerVersion] : [])
    ]),
    interpretationVersions: canonicalStrings([
      DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
      parsed.codexOpenLoopLedger.ruleVersion
    ]),
    verifierVersions: canonicalStrings([
      parsed.activeAttentionResult.resolverVersion,
      CODEX_HISTORY_CURRENTNESS_POLICY_VERSION
    ]),
    eligibilityPolicyVersion: parsed.activeAttentionResult.policyVersion,
    selectionPolicyVersion: parsed.activeAttentionResult.rankingPolicyVersion,
    traces: buildCandidateTraces(parsed, assembly)
  });
  const claimCounts = claimCountsFrom(parsed.codexOpenLoopLedger);
  const summaryContent = publicSummaryContent(ledger, funnel, claimCounts);
  const publicSummary = developerRuntimePublicSummarySchema.parse({
    ...summaryContent,
    summarySha256: developerRuntimePublicSummarySha256(summaryContent)
  });
  return developerRuntimeProjectionSchema.parse({
    contract: DEVELOPER_RUNTIME_PROJECTION_CONTRACT,
    schemaVersion: DEVELOPER_RUNTIME_PROJECTION_SCHEMA_VERSION,
    ruleVersion: DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
    inputSha256,
    ledger,
    funnel,
    publicSummary
  });
}

export function developerRuntimeProjectionInputSha256(
  input: DeveloperRuntimeProjectionInput
): string {
  return runtimeSha256({
    domain: DEVELOPER_RUNTIME_PROJECTION_CONTRACT,
    input: {
      asOf: input.asOf,
      runId: input.runId,
      analysisId: input.analysisId,
      codeProvenance: input.codeProvenance,
      githubBatchSha256: input.githubBatch?.batchSha256 ?? null,
      githubSourceSnapshotSha256:
        input.githubBatch?.sourceSnapshotSha256 ?? null,
      codexBatchSha256: input.codexBatch?.batchSha256 ?? null,
      codexSourceSnapshotSha256:
        input.codexBatch?.sourceSnapshotSha256 ?? null,
      activeAttentionResultSha256: input.activeAttentionResult.resultSha256,
      eligibilityProjectionSha256:
        input.eligibilityProjection.projectionSha256,
      codexOpenLoopLedgerSha256: input.codexOpenLoopLedger.ledgerSha256
    }
  });
}

export function developerRuntimePublicSummarySha256(
  summary:
    | DeveloperRuntimePublicSummary
    | z.infer<typeof developerRuntimePublicSummaryContentSchema>
): string {
  const { summarySha256: _summarySha256, ...content } =
    summary as DeveloperRuntimePublicSummary;
  return runtimeSha256({
    domain: DEVELOPER_RUNTIME_PUBLIC_SUMMARY_CONTRACT,
    summary: content
  });
}

export function verifyDeveloperRuntimeProjection(input: unknown): boolean {
  return developerRuntimeProjectionSchema.safeParse(input).success;
}

function assembleLedger(
  input: DeveloperRuntimeProjectionInput,
  inputSha256: string
): LedgerAssembly {
  const evidence = new Map<string, DeveloperWorkEvidence>();
  const projects = new Map<string, ProjectAggregate>();
  const workItems = new Map<string, DraftWorkItem>();
  const executions = new Map<string, DraftExecution>();
  const openLoops = new Map<string, DraftOpenLoop>();
  const blockers = new Map<string, DraftBlocker>();
  const nextActions = new Map<string, DraftNextAction>();
  const assessmentEvidenceIds = new Map<string, string>();
  const assessmentNextActionIds = new Map<string, string>();
  const githubSignalEvidenceIds = new Map<string, string>();
  const codexSignalEvidenceIds = new Map<string, string>();
  const claimEvidenceIds = new Map<string, string>();
  const workItemIdsBySubject = new Map<string, string>();
  const executionIdsBySubject = new Map<string, string>();
  const githubOpenLoopByWorkItem = new Map<string, string>();
  const blockerIdsByWorkItem = new Map<string, Set<string>>();

  const githubDeadlines = githubDeadlineSignals(input.githubBatch);
  const deadlineBySubject = new Map(
    githubDeadlines.map((signal) => [signal.subjectId, signal])
  );
  for (const signal of githubWorkItemSignals(input.githubBatch)) {
    const stateEvidence = addEvidence(
      evidence,
      evidenceFromSignal(signal, input.githubBatch!, {
        role: "state",
        verification: githubVerification(input.githubBatch!),
        reasonCodes: [
          "GITHUB_WORK_ITEM_OBSERVED",
          ...input.githubBatch!.assessment.reasonCodes
        ]
      })
    );
    githubSignalEvidenceIds.set(signal.signalId, stateEvidence.evidenceId);
    const deadline = deadlineBySubject.get(signal.subjectId) ?? null;
    const evidenceIds = [stateEvidence.evidenceId];
    if (deadline !== null) {
      const deadlineEvidence = addEvidence(
        evidence,
        evidenceFromSignal(deadline, input.githubBatch!, {
          role: "deadline",
          verification: githubVerification(input.githubBatch!),
          reasonCodes: ["GITHUB_NATIVE_DEADLINE_OBSERVED"]
        })
      );
      evidenceIds.push(deadlineEvidence.evidenceId);
    }
    const workItemId = createDeveloperWorkEntityId("work_item", {
      source: "github",
      subjectId: signal.subjectId
    });
    workItemIdsBySubject.set(signal.subjectId, workItemId);
    workItems.set(workItemId, {
      workItemId,
      projectId: signal.projectId,
      source: "github",
      sourceObjectSha256: runtimeSha256({
        source: "github",
        subjectId: signal.subjectId
      }),
      kind:
        signal.facts.objectType === "issue" ? "issue" : "pull_request",
      title: signal.facts.title,
      state: "open",
      dueAt: deadline?.facts.deadlineAt ?? null,
      evidenceIds,
      reasonCodes: [
        "GITHUB_WORK_ITEM_OPEN",
        taskKindReason(signal.facts.taskKind)
      ]
    });
    if (signal.projectId !== null) {
      addProjectObservation(projects, {
        projectId: signal.projectId,
        source: "github",
        label: signal.facts.repositoryFullName,
        sourceScopeIdentity: signal.sourceScopeId,
        evidenceId: stateEvidence.evidenceId,
        reasonCode: "GITHUB_PROJECT_SCOPE_OBSERVED"
      });
    }
    if (signal.facts.semanticRole === "direct_work_item") {
      const kind =
        signal.facts.taskKind === "assigned_issue"
          ? "assigned_work"
          : signal.facts.taskKind === "review_requested_pull_request"
            ? "review_request"
            : "code_review";
      const openLoopId = createDeveloperWorkEntityId("open_loop", {
        source: "github",
        workItemId,
        kind
      });
      openLoops.set(openLoopId, {
        openLoopId,
        projectId: signal.projectId,
        workItemId,
        executionId: null,
        kind,
        state: "open",
        openedAt: canonicalTimestamp(
          signal.sourceUpdatedAt ?? signal.observedAt
        ),
        dueAt: deadline?.facts.deadlineAt ?? null,
        evidenceIds: [stateEvidence.evidenceId],
        reasonCodes: ["GITHUB_DIRECT_WORK_OPEN_LOOP"]
      });
      githubOpenLoopByWorkItem.set(workItemId, openLoopId);
    }
    const actionability = readOptionalGitHubActionability(signal.facts);
    if (actionability !== null) {
      for (const blockerKind of actionabilityBlockerKinds(actionability)) {
        const blockerEvidence = addEvidence(evidence, {
          source: "github",
          sourceRecordSha256: signal.signalHash,
          sourceSnapshotSha256: signal.sourceSnapshotSha256,
          valueSha256: runtimeSha256({
            subjectId: signal.subjectId,
            blockerKind
          }),
          signalId: signal.signalId,
          claimId: null,
          relationId: null,
          observedAt: canonicalTimestamp(signal.observedAt),
          sourceUpdatedAt: nullableCanonicalTimestamp(signal.sourceUpdatedAt),
          role: "blocker",
          directness: "explicit",
          freshness: batchFreshness(input.githubBatch!),
          completeness: signalCompleteness(signal),
          verification: githubVerification(input.githubBatch!),
          reasonCodes: [githubBlockerReason(blockerKind)]
        });
        const blockerId = createDeveloperWorkEntityId("blocker", {
          source: "github",
          workItemId,
          blockerKind
        });
        blockers.set(blockerId, {
          blockerId,
          projectId: signal.projectId,
          workItemId,
          executionId: null,
          openLoopId: githubOpenLoopByWorkItem.get(workItemId) ?? null,
          kind: blockerKind,
          state: "active",
          severity: blockerKind === "merge_conflict" ? "critical" : "warning",
          evidenceIds: [blockerEvidence.evidenceId],
          reasonCodes: [githubBlockerReason(blockerKind)]
        });
        addToSetMap(blockerIdsByWorkItem, workItemId, blockerId);
      }
    }
  }

  for (const signal of codexExecutionSignals(input.codexBatch)) {
    const executionEvidence = addEvidence(
      evidence,
      evidenceFromSignal(signal, input.codexBatch!, {
        role: "execution",
        verification: "unverified",
        reasonCodes: [
          "CODEX_INVENTORY_OBSERVED",
          "CODEX_INVENTORY_NOT_LIVE_CURRENT_STATE"
        ]
      })
    );
    codexSignalEvidenceIds.set(signal.signalId, executionEvidence.evidenceId);
    const executionId = ledgerExecutionId(signal.subjectId);
    executionIdsBySubject.set(signal.subjectId, executionId);
    upsertExecution(executions, {
      executionId,
      projectId: signal.projectId,
      workItemId: null,
      source: "codex",
      sourceExecutionSha256: runtimeSha256({
        source: "codex",
        subjectId: signal.subjectId
      }),
      state: signal.facts.semanticState === "idle" ? "idle" : "unknown",
      startedAt: null,
      updatedAt: canonicalTimestamp(
        signal.sourceUpdatedAt ?? signal.observedAt
      ),
      completedAt: null,
      evidenceIds: [executionEvidence.evidenceId],
      reasonCodes: [
        "CODEX_INVENTORY_ONLY",
        "CODEX_CURRENT_EXECUTION_STATE_UNKNOWN"
      ]
    });
    if (signal.projectId !== null) {
      addProjectObservation(projects, {
        projectId: signal.projectId,
        source: "codex",
        label: signal.facts.projectLabel,
        sourceScopeIdentity: signal.sourceScopeId,
        evidenceId: executionEvidence.evidenceId,
        reasonCode: "CODEX_PROJECT_SCOPE_OBSERVED"
      });
    }
  }

  const codexSignalById = new Map(
    codexExecutionSignals(input.codexBatch).map((signal) => [
      signal.signalId,
      signal
    ])
  );
  for (const claim of input.codexOpenLoopLedger.claims) {
    const sourceSignal = firstClaimSourceSignal(claim, codexSignalById);
    const claimEvidence = addEvidence(evidence, {
      source: "codex",
      sourceRecordSha256: runtimeSha256({
        ledgerSha256: input.codexOpenLoopLedger.ledgerSha256,
        claimId: claim.claimId
      }),
      sourceSnapshotSha256: sourceSignal?.sourceSnapshotSha256 ?? null,
      valueSha256: runtimeSha256(claim.value),
      signalId: sourceSignal?.signalId ?? claim.evidenceRefs[0]?.signalId ?? null,
      claimId: claim.claimId,
      relationId: null,
      observedAt: canonicalTimestamp(
        claim.evidenceRefs[0]?.observedAt ?? claim.sourceUpdatedAt
      ),
      sourceUpdatedAt: canonicalTimestamp(claim.sourceUpdatedAt),
      role: claim.claimType === "blocker" ? "blocker" : "open_loop",
      directness: "derived",
      freshness: "unknown",
      completeness:
        claim.verificationStatus === "evidence_supported"
          ? "partial"
          : "unknown",
      verification: "unverified",
      reasonCodes: [
        claim.ruleId,
        lifecycleReason(claim),
        "CODEX_HISTORY_CURRENTNESS_UNVERIFIED"
      ]
    });
    claimEvidenceIds.set(claim.claimId, claimEvidence.evidenceId);
    const executionId = ledgerExecutionId(claim.subjectId);
    executionIdsBySubject.set(claim.subjectId, executionId);
    upsertExecution(executions, {
      executionId,
      projectId: claim.projectId,
      workItemId: null,
      source: "codex",
      sourceExecutionSha256: runtimeSha256({
        source: "codex",
        subjectId: claim.subjectId
      }),
      state: "unknown",
      startedAt: null,
      updatedAt: canonicalTimestamp(claim.sourceUpdatedAt),
      completedAt: null,
      evidenceIds: [claimEvidence.evidenceId],
      reasonCodes: [
        "CODEX_HISTORY_ONLY",
        "CODEX_CURRENT_EXECUTION_STATE_UNKNOWN"
      ]
    });
    if (claim.projectId !== null) {
      addProjectObservation(projects, {
        projectId: claim.projectId,
        source: "codex",
        label: sourceSignal?.facts.projectLabel ?? "Codex project",
        sourceScopeIdentity:
          sourceSignal?.sourceScopeId ?? `project:${claim.projectId}`,
        evidenceId: claimEvidence.evidenceId,
        reasonCode: "CODEX_PROJECT_REFERENCE_OBSERVED"
      });
    }
    const openLoopId = createDeveloperWorkEntityId("open_loop", {
      source: "codex",
      claimId: claim.claimId
    });
    openLoops.set(openLoopId, {
      openLoopId,
      projectId: claim.projectId,
      workItemId: null,
      executionId,
      kind: codexOpenLoopKind(claim),
      state: claim.lifecycleStatus === "open" ? "open" : "resolved",
      openedAt: canonicalTimestamp(claim.sourceUpdatedAt),
      dueAt: null,
      evidenceIds: [claimEvidence.evidenceId],
      reasonCodes: [claim.ruleId, lifecycleReason(claim)]
    });
    const claimBlockerIds: string[] = [];
    if (claim.claimType === "blocker") {
      const kind =
        claim.ruleId === "EXECUTION_FAILED_NEEDS_INSPECTION"
          ? "execution_failure"
          : "other";
      const blockerId = createDeveloperWorkEntityId("blocker", {
        source: "codex",
        claimId: claim.claimId,
        kind
      });
      blockers.set(blockerId, {
        blockerId,
        projectId: claim.projectId,
        workItemId: null,
        executionId,
        openLoopId,
        kind,
        state: claim.lifecycleStatus === "open" ? "active" : "resolved",
        severity: "warning",
        evidenceIds: [claimEvidence.evidenceId],
        reasonCodes: [claim.ruleId, "CODEX_HISTORY_CURRENTNESS_UNVERIFIED"]
      });
      claimBlockerIds.push(blockerId);
    }
    if (claim.claimType !== "goal") {
      const nextActionId = createDeveloperWorkEntityId("next_action", {
        source: "codex_history",
        claimId: claim.claimId
      });
      nextActions.set(nextActionId, {
        nextActionId,
        projectId: claim.projectId,
        workItemId: null,
        executionId,
        openLoopId,
        blockerIds: claimBlockerIds,
        kind:
          claim.claimType === "remaining_work" ? "do" : "inspect",
        title: claim.value,
        firstStep:
          claim.claimType === "remaining_work"
            ? claim.value
            : "Inspect the bounded Codex history before acting.",
        state:
          claim.lifecycleStatus === "open" ? "ineligible" : "dismissed",
        dueAt: null,
        evidenceIds: [claimEvidence.evidenceId],
        reasonCodes: [
          "CODEX_HISTORY_CURRENTNESS_UNVERIFIED",
          "CODEX_HISTORY_FORBIDDEN_AS_CANDIDATE"
        ]
      });
    }
  }

  const githubSignalById = new Map(
    githubWorkItemSignals(input.githubBatch).map((signal) => [
      signal.signalId,
      signal
    ])
  );
  const candidateById = new Map(
    input.activeAttentionResult.rankedCandidates.map((candidate) => [
      candidate.candidateId,
      candidate
    ])
  );
  for (const assessment of input.activeAttentionResult.assessments) {
    const assessmentEvidence = addEvidence(evidence, {
      source: "system",
      sourceRecordSha256: input.activeAttentionResult.resultSha256,
      sourceSnapshotSha256: null,
      valueSha256: runtimeSha256(assessment),
      signalId: assessment.sourceSignalId,
      claimId: null,
      relationId: assessment.relationRefs[0] ?? null,
      observedAt: input.asOf,
      sourceUpdatedAt: null,
      role: "next_action",
      directness: "derived",
      freshness: "current",
      completeness: "complete",
      verification:
        assessment.status === "review_required" ? "provisional" : "verified",
      reasonCodes: assessment.reasonCodes
    });
    assessmentEvidenceIds.set(
      assessment.assessmentId,
      assessmentEvidence.evidenceId
    );
    const candidate =
      assessment.candidateId === null
        ? null
        : candidateById.get(assessment.candidateId) ?? null;
    const target = ensureAssessmentTarget({
      input,
      assessment,
      candidate,
      assessmentEvidence,
      githubSignalById,
      projects,
      workItems,
      executions,
      workItemIdsBySubject,
      executionIdsBySubject
    });
    if (target === null) continue;
    const openLoopId = ensureAssessmentOpenLoop({
      input,
      assessment,
      target,
      assessmentEvidence,
      openLoops,
      githubOpenLoopByWorkItem
    });
    const assessmentBlockerIds = assessmentBlockers({
      assessment,
      target,
      openLoopId,
      evidenceId: assessmentEvidence.evidenceId,
      blockers
    });
    const blockerIds = canonicalStrings([
      ...(target.workItemId
        ? [...(blockerIdsByWorkItem.get(target.workItemId) ?? new Set())]
        : []),
      ...assessmentBlockerIds
    ]);
    const nextActionId = createDeveloperWorkEntityId("next_action", {
      assessmentId: assessment.assessmentId,
      candidateSeedId: assessment.candidateSeedId
    });
    const selected =
      assessment.candidateId !== null &&
      input.activeAttentionResult.decision.topSuggestion?.candidateId ===
        assessment.candidateId;
    nextActions.set(nextActionId, {
      nextActionId,
      projectId: target.projectId,
      workItemId: target.workItemId,
      executionId: target.executionId,
      openLoopId,
      blockerIds,
      kind: activeActionKind(assessment),
      title: candidate?.title ?? target.title,
      firstStep: candidate?.firstStep ?? defaultFirstStep(assessment),
      state: selected ? "selected" : assessment.status,
      dueAt: candidate?.dueAt ?? target.dueAt,
      evidenceIds: [assessmentEvidence.evidenceId],
      reasonCodes: assessment.reasonCodes
    });
    assessmentNextActionIds.set(assessment.assessmentId, nextActionId);
  }

  return {
    draft: {
      runId: input.runId,
      analysisId: input.analysisId,
      resultId: input.activeAttentionResult.resultId,
      asOf: input.asOf,
      inputSha256,
      privacyClass: "private_local_metadata",
      retentionDays: RETENTION_DAYS,
      codeProvenance: input.codeProvenance,
      pipelineVersions: {
        collected: canonicalStrings([
          DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
          ...(input.githubBatch ? [input.githubBatch.collectorVersion] : []),
          ...(input.codexBatch ? [input.codexBatch.collectorVersion] : [])
        ]),
        normalized: canonicalStrings([
          DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
          ...(input.githubBatch ? [input.githubBatch.normalizerVersion] : []),
          ...(input.codexBatch ? [input.codexBatch.normalizerVersion] : [])
        ]),
        interpreted: canonicalStrings([
          DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
          input.codexOpenLoopLedger.ruleVersion
        ]),
        verified: canonicalStrings([
          input.activeAttentionResult.resolverVersion,
          CODEX_HISTORY_CURRENTNESS_POLICY_VERSION
        ]),
        eligibility: canonicalStrings([
          input.activeAttentionResult.candidateRuleVersion,
          input.eligibilityProjection.policyVersion
        ]),
        selection: [input.activeAttentionResult.rankingPolicyVersion]
      },
      sourceSnapshots: [
        sourceSnapshot("github", input.githubBatch),
        sourceSnapshot("codex", input.codexBatch)
      ],
      evidence: [...evidence.values()],
      projects: finalizeProjects(projects),
      workItems: [...workItems.values()],
      executions: [...executions.values()],
      openLoops: [...openLoops.values()],
      blockers: [...blockers.values()],
      nextActions: [...nextActions.values()]
    },
    assessmentEvidenceIds,
    assessmentNextActionIds,
    githubSignalEvidenceIds,
    codexSignalEvidenceIds,
    claimEvidenceIds,
    workItemIdsBySubject,
    executionIdsBySubject
  };
}

type AssessmentTarget = {
  projectId: string | null;
  workItemId: string | null;
  executionId: string | null;
  title: string;
  dueAt: string | null;
};

function ensureAssessmentTarget(input: {
  input: DeveloperRuntimeProjectionInput;
  assessment: ActiveAttentionAssessment;
  candidate: ActiveAttentionCandidate | null;
  assessmentEvidence: DeveloperWorkEvidence;
  githubSignalById: Map<string, GitHubWorkItemSignal>;
  projects: Map<string, ProjectAggregate>;
  workItems: Map<string, DraftWorkItem>;
  executions: Map<string, DraftExecution>;
  workItemIdsBySubject: Map<string, string>;
  executionIdsBySubject: Map<string, string>;
}): AssessmentTarget | null {
  const { assessment, candidate, assessmentEvidence } = input;
  if (assessment.triggerSource === "github") {
    const signal = assessment.sourceSignalId
      ? input.githubSignalById.get(assessment.sourceSignalId) ?? null
      : null;
    const subjectId = signal?.subjectId ?? assessment.githubSubjectId;
    if (subjectId === null) return null;
    let workItemId = input.workItemIdsBySubject.get(subjectId) ?? null;
    if (workItemId === null) {
      workItemId = createDeveloperWorkEntityId("work_item", {
        source: "github",
        subjectId
      });
      input.workItemIdsBySubject.set(subjectId, workItemId);
      input.workItems.set(workItemId, {
        workItemId,
        projectId: candidate?.projectId ?? null,
        source: "github",
        sourceObjectSha256: runtimeSha256({ source: "github", subjectId }),
        kind: candidate?.taskKind === "assigned_issue" ? "issue" : "pull_request",
        title: candidate?.title ?? "GitHub work item",
        state: "unknown",
        dueAt: candidate?.dueAt ?? null,
        evidenceIds: [assessmentEvidence.evidenceId],
        reasonCodes: ["ACTIVE_ASSESSMENT_TARGET_ONLY"]
      });
    }
    const item = input.workItems.get(workItemId)!;
    if (candidate?.projectId) {
      addProjectObservation(input.projects, {
        projectId: candidate.projectId,
        source: "github",
        label: candidate.repositoryFullName,
        sourceScopeIdentity: `repository:${candidate.repositoryFullName}`,
        evidenceId: assessmentEvidence.evidenceId,
        reasonCode: "ACTIVE_CANDIDATE_PROJECT_OBSERVED"
      });
    }
    return {
      projectId: item.projectId ?? candidate?.projectId ?? null,
      workItemId,
      executionId: null,
      title: item.title,
      dueAt: item.dueAt
    };
  }
  const sourceIdentity =
    candidate?.executionId ?? assessment.managedRunId ?? assessment.targetRef;
  const executionId = ledgerExecutionId(sourceIdentity);
  if (candidate?.executionId) {
    input.executionIdsBySubject.set(candidate.executionId, executionId);
  }
  const liveFailure = assessment.reasonCodes.some(
    (reason) =>
      reason === "ELIGIBLE_MANAGED_LATEST_DIRECT_FAILURE" ||
      reason === "INELIGIBLE_FAILURE_RECOVERED"
  );
  upsertExecution(input.executions, {
    executionId,
    projectId: candidate?.projectId ?? null,
    workItemId:
      candidate === null
        ? null
        : input.workItemIdsBySubject.get(candidate.githubSubjectId) ?? null,
    source: "codex",
    sourceExecutionSha256: runtimeSha256({
      source: "codex_managed",
      sourceIdentity
    }),
    state: liveFailure ? "failed" : "unknown",
    startedAt: null,
    updatedAt: input.input.asOf,
    completedAt: null,
    evidenceIds: [assessmentEvidence.evidenceId],
    reasonCodes: [
      "ACTIVE_MANAGED_ASSESSMENT_OBSERVED",
      ...(liveFailure ? ["MANAGED_FAILURE_VERIFIED"] : [])
    ]
  });
  if (candidate?.projectId) {
    addProjectObservation(input.projects, {
      projectId: candidate.projectId,
      source: "codex",
      label: "Managed Codex project",
      sourceScopeIdentity: `managed:${candidate.projectId}`,
      evidenceId: assessmentEvidence.evidenceId,
      reasonCode: "ACTIVE_MANAGED_PROJECT_OBSERVED"
    });
  }
  return {
    projectId: candidate?.projectId ?? null,
    workItemId:
      candidate === null
        ? null
        : input.workItemIdsBySubject.get(candidate.githubSubjectId) ?? null,
    executionId,
    title: candidate?.title ?? "Managed Codex work",
    dueAt: candidate?.dueAt ?? null
  };
}

function ensureAssessmentOpenLoop(input: {
  input: DeveloperRuntimeProjectionInput;
  assessment: ActiveAttentionAssessment;
  target: AssessmentTarget;
  assessmentEvidence: DeveloperWorkEvidence;
  openLoops: Map<string, DraftOpenLoop>;
  githubOpenLoopByWorkItem: Map<string, string>;
}): string {
  if (input.target.workItemId) {
    const existing = input.githubOpenLoopByWorkItem.get(input.target.workItemId);
    if (existing) return existing;
  }
  const kind =
    input.assessment.triggerKind === "managed_failure"
      ? "execution_failure"
      : input.assessment.triggerKind === "configured_follow_through"
        ? "workflow_follow_through"
        : input.assessment.actionKind === "inspect"
          ? "review_request"
          : "assigned_work";
  const openLoopId = createDeveloperWorkEntityId("open_loop", {
    assessmentId: input.assessment.assessmentId,
    kind
  });
  input.openLoops.set(openLoopId, {
    openLoopId,
    projectId: input.target.projectId,
    workItemId: input.target.workItemId,
    executionId: input.target.executionId,
    kind,
    state: input.assessment.status === "ineligible" ? "uncertain" : "open",
    openedAt: input.input.asOf,
    dueAt: input.target.dueAt,
    evidenceIds: [input.assessmentEvidence.evidenceId],
    reasonCodes: input.assessment.reasonCodes
  });
  return openLoopId;
}

function assessmentBlockers(input: {
  assessment: ActiveAttentionAssessment;
  target: AssessmentTarget;
  openLoopId: string;
  evidenceId: string;
  blockers: Map<string, DraftBlocker>;
}): string[] {
  if (input.assessment.status !== "review_required") return [];
  const kinds = new Set<DraftBlocker["kind"]>();
  for (const reason of input.assessment.reasonCodes) {
    if (reason.includes("CRITICAL_CONFLICT")) kinds.add("source_conflict");
    else if (reason.includes("STALE")) kinds.add("stale_evidence");
    else if (
      reason.includes("MISSING") ||
      reason.includes("LINK_") ||
      reason.includes("UNRESOLVED")
    ) {
      kinds.add("missing_relation");
    } else {
      kinds.add("user_clarification");
    }
  }
  return [...kinds]
    .sort(compareRuntimeStrings)
    .map((kind) => {
      const blockerId = createDeveloperWorkEntityId("blocker", {
        assessmentId: input.assessment.assessmentId,
        kind
      });
      input.blockers.set(blockerId, {
        blockerId,
        projectId: input.target.projectId,
        workItemId: input.target.workItemId,
        executionId: input.target.executionId,
        openLoopId: input.openLoopId,
        kind,
        state: "active",
        severity: kind === "source_conflict" ? "critical" : "warning",
        evidenceIds: [input.evidenceId],
        reasonCodes: input.assessment.reasonCodes
      });
      return blockerId;
    });
}

function buildCandidateTraces(
  input: DeveloperRuntimeProjectionInput,
  assembly: LedgerAssembly
): DeveloperCandidateTrace[] {
  const traces: DeveloperCandidateTrace[] = [];
  const activeGitHubSignalIds = new Set<string>();
  const githubBySignalId = new Map(
    githubWorkItemSignals(input.githubBatch).map((signal) => [
      signal.signalId,
      signal
    ])
  );
  const candidateById = new Map(
    input.activeAttentionResult.rankedCandidates.map((candidate) => [
      candidate.candidateId,
      candidate
    ])
  );
  for (const assessment of input.activeAttentionResult.assessments) {
    if (assessment.sourceSignalId) {
      activeGitHubSignalIds.add(assessment.sourceSignalId);
    }
    const signal = assessment.sourceSignalId
      ? githubBySignalId.get(assessment.sourceSignalId) ?? null
      : null;
    const evidenceIds = canonicalStrings([
      assembly.assessmentEvidenceIds.get(assessment.assessmentId)!,
      ...(signal
        ? [assembly.githubSignalEvidenceIds.get(signal.signalId)!]
        : [])
    ]);
    const candidate =
      assessment.candidateId === null
        ? null
        : candidateById.get(assessment.candidateId) ?? null;
    const selected =
      candidate !== null &&
      input.activeAttentionResult.decision.topSuggestion?.candidateId ===
        candidate.candidateId;
    traces.push({
      candidateSeedId: assessment.candidateSeedId,
      candidateId: assessment.candidateId,
      source: assessment.triggerSource === "github" ? "github" : "codex",
      sourceRecordSha256:
        signal?.signalHash ?? runtimeSha256({ assessment }),
      nextActionId:
        assembly.assessmentNextActionIds.get(assessment.assessmentId) ?? null,
      stages: {
        collected: reachedStage(
          "collected",
          "collected",
          ["SOURCE_RECORD_COLLECTED"],
          evidenceIds
        ),
        normalized: reachedStage(
          "normalized",
          "normalized",
          ["NORMALIZED_WORK_SIGNAL"],
          evidenceIds
        ),
        interpreted: reachedStage(
          "interpreted",
          "interpreted",
          ["ACTIVE_ASSESSMENT_INTERPRETED"],
          evidenceIds
        ),
        verified: reachedStage(
          "verified",
          "verified",
          ["ACTIVE_ASSESSMENT_VERIFIED"],
          evidenceIds
        ),
        eligibility: reachedStage(
          "eligibility",
          assessment.status,
          assessment.reasonCodes,
          evidenceIds
        ),
        selected:
          assessment.status === "eligible"
            ? reachedStage(
                "selected",
                selected ? "selected" : "not_selected",
                [selected ? "SELECTED_TOP_RANKED" : "NOT_SELECTED_LOWER_RANK"],
                evidenceIds
              )
            : notReachedStage("selected", "NOT_REACHED_NOT_ELIGIBLE")
      }
    });
  }

  const shadowBySignalId = new Map(
    input.eligibilityProjection.assessments.map((assessment) => [
      assessment.sourceSignalId,
      assessment
    ])
  );
  for (const signal of githubWorkItemSignals(input.githubBatch)) {
    if (activeGitHubSignalIds.has(signal.signalId)) continue;
    const evidenceId = assembly.githubSignalEvidenceIds.get(signal.signalId)!;
    const shadow = shadowBySignalId.get(signal.signalId) ?? null;
    const status =
      shadow?.status === "ineligible" ? "ineligible" : "review_required";
    traces.push({
      candidateSeedId:
        shadow?.candidateSeedId ??
        runtimeStableId("seed", DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION, {
          source: "github",
          signalId: signal.signalId
        }),
      candidateId: null,
      source: "github",
      sourceRecordSha256: signal.signalHash,
      nextActionId: null,
      stages: {
        collected: reachedStage(
          "collected",
          "collected",
          ["SOURCE_RECORD_COLLECTED"],
          [evidenceId]
        ),
        normalized: reachedStage(
          "normalized",
          "normalized",
          ["NORMALIZED_WORK_SIGNAL"],
          [evidenceId]
        ),
        interpreted: reachedStage(
          "interpreted",
          "interpreted",
          ["GITHUB_WORK_ITEM_INTERPRETED"],
          [evidenceId]
        ),
        verified: reachedStage(
          "verified",
          "verified",
          ["GITHUB_SOURCE_STATE_VERIFIED"],
          [evidenceId]
        ),
        eligibility: reachedStage(
          "eligibility",
          status,
          canonicalStrings([
            ...(shadow?.reasonCodes ?? []),
            shadow?.status === "eligible"
              ? "REVIEW_ACTIVE_ASSESSMENT_MISSING"
              : shadow === null
                ? "INELIGIBLE_NOT_ACTIVE_CANDIDATE"
                : "SHADOW_ASSESSMENT_PRESERVED"
          ]),
          [evidenceId]
        ),
        selected: notReachedStage("selected", "NOT_REACHED_NOT_ELIGIBLE")
      }
    });
  }

  const claimsBySignalId = new Map<string, number>();
  for (const claim of input.codexOpenLoopLedger.claims) {
    for (const ref of claim.evidenceRefs) {
      claimsBySignalId.set(ref.signalId, (claimsBySignalId.get(ref.signalId) ?? 0) + 1);
    }
    const claimEvidenceId = assembly.claimEvidenceIds.get(claim.claimId)!;
    const sourceEvidenceIds = canonicalStrings([
      claimEvidenceId,
      ...claim.evidenceRefs.flatMap((ref) => {
        const evidenceId = assembly.codexSignalEvidenceIds.get(ref.signalId);
        return evidenceId ? [evidenceId] : [];
      })
    ]);
    traces.push({
      candidateSeedId: runtimeStableId(
        "seed",
        DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
        { source: "codex_history_claim", claimId: claim.claimId }
      ),
      candidateId: null,
      source: "codex",
      sourceRecordSha256: runtimeSha256({
        ledgerSha256: input.codexOpenLoopLedger.ledgerSha256,
        claimId: claim.claimId
      }),
      nextActionId: findClaimNextActionId(assembly.draft, claim.claimId),
      stages: {
        collected: reachedStage(
          "collected",
          "collected",
          ["CODEX_HISTORY_RECORD_COLLECTED"],
          sourceEvidenceIds
        ),
        normalized: reachedStage(
          "normalized",
          "normalized",
          ["CODEX_HISTORY_NORMALIZED"],
          sourceEvidenceIds
        ),
        interpreted: reachedStage(
          "interpreted",
          "interpreted",
          [claim.ruleId, "CODEX_OPEN_LOOP_INTERPRETED"],
          [claimEvidenceId]
        ),
        verified: reachedStage(
          "verified",
          "rejected",
          [
            "CODEX_HISTORY_CURRENTNESS_UNVERIFIED",
            "CODEX_HISTORY_FORBIDDEN_AS_CANDIDATE"
          ],
          sourceEvidenceIds
        ),
        eligibility: notReachedStage(
          "eligibility",
          "NOT_REACHED_CODEX_CURRENTNESS_UNVERIFIED"
        ),
        selected: notReachedStage(
          "selected",
          "NOT_REACHED_CODEX_CURRENTNESS_UNVERIFIED"
        )
      }
    });
  }
  for (const signal of codexExecutionSignals(input.codexBatch)) {
    if ((claimsBySignalId.get(signal.signalId) ?? 0) > 0) continue;
    const evidenceId = assembly.codexSignalEvidenceIds.get(signal.signalId)!;
    traces.push({
      candidateSeedId: runtimeStableId(
        "seed",
        DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
        { source: "codex_inventory", signalId: signal.signalId }
      ),
      candidateId: null,
      source: "codex",
      sourceRecordSha256: signal.signalHash,
      nextActionId: null,
      stages: {
        collected: reachedStage(
          "collected",
          "collected",
          ["CODEX_INVENTORY_COLLECTED"],
          [evidenceId]
        ),
        normalized: reachedStage(
          "normalized",
          "normalized",
          ["CODEX_INVENTORY_NORMALIZED"],
          [evidenceId]
        ),
        interpreted: reachedStage(
          "interpreted",
          "rejected",
          ["CODEX_INVENTORY_HAS_NO_OPEN_LOOP_CLAIM"],
          [evidenceId]
        ),
        verified: notReachedStage(
          "verified",
          "NOT_REACHED_NO_INTERPRETED_CODEX_CLAIM"
        ),
        eligibility: notReachedStage(
          "eligibility",
          "NOT_REACHED_NO_INTERPRETED_CODEX_CLAIM"
        ),
        selected: notReachedStage(
          "selected",
          "NOT_REACHED_NO_INTERPRETED_CODEX_CLAIM"
        )
      }
    });
  }
  return traces;
}

function sourceSnapshot(
  source: "github" | "codex",
  batch: RuntimeWorkSignalBatch | null
): DeveloperWorkLedgerDraft["sourceSnapshots"][number] {
  return batch === null
    ? {
        source,
        state: "missing",
        snapshotSha256: null,
        collectedAt: null,
        collectionVersion: DEVELOPER_RUNTIME_PROJECTION_RULE_VERSION,
        reasonCodes: ["SOURCE_BATCH_MISSING"]
      }
    : {
        source,
        state: "collected",
        snapshotSha256: batch.sourceSnapshotSha256,
        collectedAt: canonicalTimestamp(batch.assessment.fetchedAt),
        collectionVersion: batch.collectorVersion,
        reasonCodes: canonicalStrings([
          "SOURCE_COLLECTED",
          ...batch.assessment.reasonCodes
        ])
      };
}

function evidenceFromSignal(
  signal: RuntimeWorkSignal,
  batch: RuntimeWorkSignalBatch,
  input: {
    role: DeveloperWorkEvidence["role"];
    verification: DeveloperWorkEvidence["verification"];
    reasonCodes: string[];
  }
): Omit<DeveloperWorkEvidence, "evidenceId"> {
  return {
    source: signal.source,
    sourceRecordSha256: signal.signalHash,
    sourceSnapshotSha256: signal.sourceSnapshotSha256,
    valueSha256: runtimeSha256({
      signalId: signal.signalId,
      signalHash: signal.signalHash,
      role: input.role
    }),
    signalId: signal.signalId,
    claimId: null,
    relationId: null,
    observedAt: canonicalTimestamp(signal.observedAt),
    sourceUpdatedAt: nullableCanonicalTimestamp(signal.sourceUpdatedAt),
    role: input.role,
    directness: signal.directness,
    freshness: batchFreshness(batch),
    completeness: signalCompleteness(signal),
    verification: input.verification,
    reasonCodes: canonicalStrings(input.reasonCodes)
  };
}

function addEvidence(
  evidence: Map<string, DeveloperWorkEvidence>,
  draft: Omit<DeveloperWorkEvidence, "evidenceId">
): DeveloperWorkEvidence {
  const canonicalDraft = {
    ...draft,
    reasonCodes: canonicalStrings(draft.reasonCodes)
  };
  const item: DeveloperWorkEvidence = {
    evidenceId: createDeveloperWorkEvidenceId(canonicalDraft),
    ...canonicalDraft
  };
  const existing = evidence.get(item.evidenceId);
  if (existing && runtimeSha256(existing) !== runtimeSha256(item)) {
    throw new TypeError("DEVELOPER_RUNTIME_EVIDENCE_ID_COLLISION");
  }
  evidence.set(item.evidenceId, item);
  return item;
}

function addProjectObservation(
  projects: Map<string, ProjectAggregate>,
  input: {
    projectId: string;
    source: "github" | "codex";
    label: string;
    sourceScopeIdentity: string;
    evidenceId: string;
    reasonCode: string;
  }
): void {
  const aggregate: ProjectAggregate = projects.get(input.projectId) ?? {
    projectId: input.projectId,
    labels: [],
    sourceScopes: new Map(),
    evidenceIds: new Set(),
    reasonCodes: new Set()
  };
  aggregate.labels.push({ source: input.source, value: input.label });
  const sourceScopeSha256 = runtimeSha256({
    source: input.source,
    identity: input.sourceScopeIdentity
  });
  aggregate.sourceScopes.set(`${input.source}:${sourceScopeSha256}`, {
    source: input.source,
    sourceScopeSha256
  });
  aggregate.evidenceIds.add(input.evidenceId);
  aggregate.reasonCodes.add(input.reasonCode);
  projects.set(input.projectId, aggregate);
}

function finalizeProjects(
  projects: Map<string, ProjectAggregate>
): DraftProject[] {
  return [...projects.values()].map((project) => ({
    projectId: project.projectId,
    label:
      [...project.labels].sort((left, right) => {
        const sourceOrder =
          (left.source === "github" ? 0 : 1) -
          (right.source === "github" ? 0 : 1);
        return sourceOrder || compareRuntimeStrings(left.value, right.value);
      })[0]?.value ?? "Developer project",
    state: "active",
    sourceScopeRefs: [...project.sourceScopes.values()],
    evidenceIds: [...project.evidenceIds],
    reasonCodes: [...project.reasonCodes]
  }));
}

function upsertExecution(
  executions: Map<string, DraftExecution>,
  incoming: DraftExecution
): void {
  const existing = executions.get(incoming.executionId);
  if (!existing) {
    executions.set(incoming.executionId, incoming);
    return;
  }
  executions.set(incoming.executionId, {
    ...existing,
    projectId: existing.projectId ?? incoming.projectId,
    workItemId: existing.workItemId ?? incoming.workItemId,
    state: strongerExecutionState(existing.state, incoming.state),
    updatedAt:
      Date.parse(existing.updatedAt) >= Date.parse(incoming.updatedAt)
        ? existing.updatedAt
        : incoming.updatedAt,
    evidenceIds: canonicalStrings([
      ...existing.evidenceIds,
      ...incoming.evidenceIds
    ]),
    reasonCodes: canonicalStrings([
      ...existing.reasonCodes,
      ...incoming.reasonCodes
    ])
  });
}

function strongerExecutionState(
  left: DraftExecution["state"],
  right: DraftExecution["state"]
): DraftExecution["state"] {
  const priority: Record<DraftExecution["state"], number> = {
    failed: 6,
    running: 5,
    queued: 4,
    idle: 3,
    completed: 2,
    cancelled: 1,
    unknown: 0
  };
  return priority[left] >= priority[right] ? left : right;
}

function githubWorkItemSignals(
  batch: RuntimeWorkSignalBatch | null
): GitHubWorkItemSignal[] {
  if (batch === null) return [];
  return batch.signals
    .filter(
      (signal): signal is GitHubWorkItemSignal =>
        signal.kind === "work_item_observation"
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId)
    );
}

function githubDeadlineSignals(
  batch: RuntimeWorkSignalBatch | null
): GitHubDeadlineSignal[] {
  if (batch === null) return [];
  return batch.signals
    .filter(
      (signal): signal is GitHubDeadlineSignal =>
        signal.kind === "deadline_observation"
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId)
    );
}

function codexExecutionSignals(
  batch: RuntimeWorkSignalBatch | null
): CodexExecutionSignal[] {
  if (batch === null) return [];
  return batch.signals
    .filter(
      (signal): signal is CodexExecutionSignal =>
        signal.kind === "execution_observation"
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId)
    );
}

function firstClaimSourceSignal(
  claim: CodexOpenLoopClaim,
  signals: Map<string, CodexExecutionSignal>
): CodexExecutionSignal | null {
  for (const ref of claim.evidenceRefs) {
    const signal = signals.get(ref.signalId);
    if (signal) return signal;
  }
  return null;
}

function readOptionalGitHubActionability(facts: unknown): SafeActionability | null {
  if (!isRecord(facts)) return null;
  const actionability = facts.actionability;
  if (!isRecord(actionability)) return null;
  const reasons = new Set(
    Array.isArray(actionability.actionRequiredReasons)
      ? actionability.actionRequiredReasons.filter(
          (reason): reason is string => typeof reason === "string"
        )
      : []
  );
  const checksSummary = isRecord(actionability.checksSummary)
    ? actionability.checksSummary
    : null;
  const failedCount =
    checksSummary && typeof checksSummary.failedCount === "number"
      ? checksSummary.failedCount
      : 0;
  return {
    checksFailed: reasons.has("checks_failed") || failedCount > 0,
    changesRequested:
      reasons.has("changes_requested") ||
      (typeof actionability.unresolvedChangeRequestCount === "number" &&
        actionability.unresolvedChangeRequestCount > 0),
    mergeConflict:
      reasons.has("merge_conflict") || actionability.mergeConflict === true
  };
}

function actionabilityBlockerKinds(
  actionability: SafeActionability
): Array<"ci_failure" | "changes_requested" | "merge_conflict"> {
  return [
    ...(actionability.checksFailed ? (["ci_failure"] as const) : []),
    ...(actionability.changesRequested
      ? (["changes_requested"] as const)
      : []),
    ...(actionability.mergeConflict ? (["merge_conflict"] as const) : [])
  ];
}

function githubBlockerReason(
  kind: "ci_failure" | "changes_requested" | "merge_conflict"
): string {
  return kind === "ci_failure"
    ? "GITHUB_CI_FAILURE"
    : kind === "changes_requested"
      ? "GITHUB_CHANGES_REQUESTED"
      : "GITHUB_MERGE_CONFLICT";
}

function codexOpenLoopKind(
  claim: CodexOpenLoopClaim
): DraftOpenLoop["kind"] {
  switch (claim.claimType) {
    case "remaining_work":
      return "assigned_work";
    case "verification_needed":
      return "verification_needed";
    case "follow_through":
      return "workflow_follow_through";
    case "blocker":
      return claim.ruleId === "EXECUTION_FAILED_NEEDS_INSPECTION"
        ? "execution_failure"
        : "other";
    case "goal":
      return "other";
  }
}

function lifecycleReason(claim: CodexOpenLoopClaim): string {
  return claim.lifecycleStatus === "open"
    ? "CODEX_OPEN_LOOP_OPEN"
    : claim.lifecycleStatus === "expired"
      ? "CODEX_OPEN_LOOP_EXPIRED"
      : "CODEX_OPEN_LOOP_SUPERSEDED";
}

function taskKindReason(taskKind: GitHubWorkItemSignal["facts"]["taskKind"]): string {
  return taskKind === "assigned_issue"
    ? "GITHUB_ASSIGNED_ISSUE"
    : taskKind === "review_requested_pull_request"
      ? "GITHUB_REVIEW_REQUEST"
      : "GITHUB_AUTHORED_PULL_REQUEST";
}

function activeActionKind(
  assessment: ActiveAttentionAssessment
): DraftNextAction["kind"] {
  return assessment.actionKind === "do"
    ? "do"
    : assessment.actionKind === "inspect"
      ? "inspect"
      : assessment.triggerKind === "configured_follow_through"
        ? "do"
        : "inspect";
}

function defaultFirstStep(assessment: ActiveAttentionAssessment): string {
  return assessment.reviewRoute === "refresh_sources"
    ? "Refresh the relevant sources before acting."
    : assessment.reviewRoute === "user_review"
      ? "Review the unresolved evidence before acting."
      : assessment.actionKind === "do"
        ? "Open the work item and continue the next concrete step."
        : "Inspect the current evidence and decide the next concrete step.";
}

function githubVerification(
  batch: RuntimeWorkSignalBatch
): DeveloperWorkEvidence["verification"] {
  return batch.assessment.usableForCurrentCandidates
    ? "verified"
    : batch.assessment.usableForOverview
      ? "provisional"
      : "rejected";
}

function batchFreshness(
  batch: RuntimeWorkSignalBatch
): DeveloperWorkEvidence["freshness"] {
  return batch.assessment.freshness === "fresh"
    ? "current"
    : batch.assessment.freshness;
}

function signalCompleteness(
  signal: RuntimeWorkSignal
): DeveloperWorkEvidence["completeness"] {
  return signal.completeness === "complete"
    ? "complete"
    : signal.completeness === "truncated"
      ? "partial"
      : "unknown";
}

function ledgerExecutionId(identity: string): string {
  return createDeveloperWorkEntityId("execution", {
    source: "codex",
    identity
  });
}

function reachedStage<
  Stage extends
    | "collected"
    | "normalized"
    | "interpreted"
    | "verified"
    | "eligibility"
    | "selected",
  Outcome extends string
>(
  stage: Stage,
  outcome: Outcome,
  reasonCodes: string[],
  evidenceIds: string[]
): { stage: Stage; outcome: Outcome; reasonCodes: string[]; evidenceIds: string[] } {
  return {
    stage,
    outcome,
    reasonCodes: canonicalStrings(reasonCodes),
    evidenceIds: canonicalStrings(evidenceIds)
  };
}

function notReachedStage<
  Stage extends "interpreted" | "verified" | "eligibility" | "selected"
>(stage: Stage, reasonCode: string) {
  return {
    stage,
    outcome: "not_reached" as const,
    reasonCodes: [reasonCode],
    evidenceIds: []
  };
}

function findClaimNextActionId(
  draft: DeveloperWorkLedgerDraft,
  claimId: string
): string | null {
  const expected = createDeveloperWorkEntityId("next_action", {
    source: "codex_history",
    claimId
  });
  return draft.nextActions.some((action) => action.nextActionId === expected)
    ? expected
    : null;
}

function claimCountsFrom(
  ledger: CodexOpenLoopLedger
): DeveloperRuntimePublicSummary["claimCounts"] {
  return {
    total: ledger.claims.length,
    open: ledger.counts.open,
    expired: ledger.counts.expired,
    superseded: ledger.counts.superseded,
    byType: {
      goal: ledger.counts.byType.goal,
      remainingWork: ledger.counts.byType.remaining_work,
      blocker: ledger.counts.byType.blocker,
      verificationNeeded: ledger.counts.byType.verification_needed,
      followThrough: ledger.counts.byType.follow_through
    }
  };
}

function publicSummaryContent(
  ledger: DeveloperWorkLedger,
  funnel: DeveloperCandidateFunnelProjection,
  claimCounts: DeveloperRuntimePublicSummary["claimCounts"]
): z.infer<typeof developerRuntimePublicSummaryContentSchema> {
  const entityCounts = {
    total:
      ledger.projects.length +
      ledger.workItems.length +
      ledger.executions.length +
      ledger.openLoops.length +
      ledger.blockers.length +
      ledger.nextActions.length,
    evidence: ledger.evidence.length,
    projects: ledger.projects.length,
    workItems: ledger.workItems.length,
    executions: ledger.executions.length,
    openLoops: ledger.openLoops.length,
    blockers: ledger.blockers.length,
    nextActions: ledger.nextActions.length
  };
  return developerRuntimePublicSummaryContentSchema.parse({
    contract: DEVELOPER_RUNTIME_PUBLIC_SUMMARY_CONTRACT,
    privacyPolicyVersion: DEVELOPER_RUNTIME_PRIVACY_POLICY_VERSION,
    privacyClass: "public_aggregate_metadata",
    asOf: ledger.asOf,
    runId: ledger.runId,
    analysisId: ledger.analysisId,
    resultId: ledger.resultId,
    ledgerId: ledger.ledgerId,
    ledgerSha256: ledger.ledgerSha256,
    funnelId: funnel.funnelId,
    funnelSha256: funnel.projectionSha256,
    entityCounts,
    claimCounts,
    stageSummaries: funnel.stageSummaries
  });
}

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}

function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function nullableCanonicalTimestamp(value: string | null): string | null {
  return value === null ? null : canonicalTimestamp(value);
}

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string
): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

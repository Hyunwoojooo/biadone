import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";

export const DEVELOPER_WORK_LEDGER_CONTRACT =
  "developer-work-ledger-v0.1" as const;
export const DEVELOPER_WORK_LEDGER_SCHEMA_VERSION =
  "developer-work-ledger-schema-v0.1" as const;
export const DEVELOPER_WORK_LEDGER_CANONICALIZATION_VERSION =
  "developer-work-ledger-canonicalization-v0.1" as const;
export const DEVELOPER_WORK_LEDGER_EVIDENCE_POLICY_VERSION =
  "developer-work-ledger-evidence-policy-v0.1" as const;
export const DEVELOPER_WORK_LEDGER_ID_POLICY_VERSION =
  "developer-work-ledger-id-v0.1" as const;

const MAX_LEDGER_ENTITIES = 20_000;
const MAX_EVIDENCE_REFS = 200;
const MAX_REASON_CODES = 32;

const timestampSchema = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value, {
    message: "Ledger timestamps must use canonical UTC ISO format."
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const versionSchema = z.string().min(1).max(120);
const reasonCodeSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const developerWorkConnectorSourceSchema = z.enum([
  "github",
  "codex",
  "notion",
  "google_calendar"
]);

export const developerWorkSourceSchema = z.enum([
  ...developerWorkConnectorSourceSchema.options,
  "user",
  "system"
]);

export const workLedgerProjectIdSchema = z
  .string()
  .regex(/^project_[a-f0-9]{32}$/);
export const workLedgerWorkItemIdSchema = z
  .string()
  .regex(/^work_item_[a-f0-9]{32}$/);
export const workLedgerExecutionIdSchema = z
  .string()
  .regex(/^execution_[a-f0-9]{32}$/);
export const workLedgerOpenLoopIdSchema = z
  .string()
  .regex(/^open_loop_[a-f0-9]{32}$/);
export const workLedgerBlockerIdSchema = z
  .string()
  .regex(/^blocker_[a-f0-9]{32}$/);
export const workLedgerNextActionIdSchema = z
  .string()
  .regex(/^next_action_[a-f0-9]{32}$/);
export const workLedgerEvidenceIdSchema = z
  .string()
  .regex(/^ledger_evidence_[a-f0-9]{32}$/);
const workLedgerIdSchema = z
  .string()
  .regex(/^work_ledger_[a-f0-9]{32}$/);
const runIdSchema = z.string().regex(/^run_[a-f0-9]{32}$/);
const analysisIdSchema = z.string().regex(/^analysis_[a-f0-9]{32}$/);
const resultIdSchema = z
  .string()
  .regex(/^attention_result_[a-f0-9]{32}$/);

const canonicalReasonCodesSchema = z
  .array(reasonCodeSchema)
  .min(1)
  .max(MAX_REASON_CODES)
  .superRefine((values, context) => {
    if (!isCanonicalUnique(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reason codes must be unique and canonically ordered."
      });
    }
  });

const canonicalEvidenceIdsSchema = z
  .array(workLedgerEvidenceIdSchema)
  .min(1)
  .max(MAX_EVIDENCE_REFS)
  .superRefine((values, context) => {
    if (!isCanonicalUnique(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence references must be unique and canonically ordered."
      });
    }
  });

export const developerWorkSourceSnapshotSchema = z
  .object({
    source: developerWorkConnectorSourceSchema,
    state: z.enum([
      "collected",
      "disconnected",
      "missing",
      "rejected",
      "collection_failed"
    ]),
    snapshotSha256: sha256Schema.nullable(),
    collectedAt: timestampSchema.nullable(),
    collectionVersion: versionSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    const collected = snapshot.state === "collected";
    if (
      collected !==
      (snapshot.snapshotSha256 !== null && snapshot.collectedAt !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only a collected source may claim snapshot identity and collection time."
      });
    }
  });

export const developerWorkEvidenceSchema = z
  .object({
    evidenceId: workLedgerEvidenceIdSchema,
    source: developerWorkSourceSchema,
    sourceRecordSha256: sha256Schema,
    sourceSnapshotSha256: sha256Schema.nullable(),
    valueSha256: sha256Schema,
    signalId: z.string().min(1).max(240).nullable(),
    claimId: z.string().min(1).max(240).nullable(),
    relationId: z.string().min(1).max(240).nullable(),
    observedAt: timestampSchema,
    sourceUpdatedAt: timestampSchema.nullable(),
    role: z.enum([
      "identity",
      "state",
      "relationship",
      "deadline",
      "execution",
      "progress",
      "open_loop",
      "blocker",
      "next_action",
      "context"
    ]),
    directness: z.enum(["explicit", "derived"]),
    freshness: z.enum(["current", "stale", "invalid", "unknown"]),
    completeness: z.enum(["complete", "partial", "unknown"]),
    verification: z.enum([
      "verified",
      "provisional",
      "rejected",
      "unverified"
    ]),
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.evidenceId !==
      createDeveloperWorkEvidenceId({
        source: evidence.source,
        sourceRecordSha256: evidence.sourceRecordSha256,
        sourceSnapshotSha256: evidence.sourceSnapshotSha256,
        valueSha256: evidence.valueSha256,
        observedAt: evidence.observedAt,
        role: evidence.role
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceId"],
        message: "Evidence ID does not match canonical provenance."
      });
    }
  });

const sourceScopeRefSchema = z
  .object({
    source: developerWorkConnectorSourceSchema,
    sourceScopeSha256: sha256Schema
  })
  .strict();

export const developerWorkProjectSchema = z
  .object({
    projectId: workLedgerProjectIdSchema,
    label: z.string().min(1).max(240),
    state: z.enum(["active", "archived", "unknown"]),
    sourceScopeRefs: z.array(sourceScopeRefSchema).min(1).max(100),
    evidenceIds: canonicalEvidenceIdsSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine((project, context) => {
    if (!isCanonicalSourceScopeRefs(project.sourceScopeRefs)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceScopeRefs"],
        message: "Project source scopes must be unique and canonical."
      });
    }
  });

export const developerWorkItemSchema = z
  .object({
    workItemId: workLedgerWorkItemIdSchema,
    projectId: workLedgerProjectIdSchema.nullable(),
    source: developerWorkConnectorSourceSchema,
    sourceObjectSha256: sha256Schema,
    kind: z.enum([
      "issue",
      "pull_request",
      "review_request",
      "task",
      "change_set",
      "unknown"
    ]),
    title: z.string().min(1).max(240),
    state: z.enum([
      "open",
      "in_progress",
      "blocked",
      "completed",
      "closed",
      "unknown"
    ]),
    dueAt: timestampSchema.nullable(),
    evidenceIds: canonicalEvidenceIdsSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict();

export const developerExecutionSchema = z
  .object({
    executionId: workLedgerExecutionIdSchema,
    projectId: workLedgerProjectIdSchema.nullable(),
    workItemId: workLedgerWorkItemIdSchema.nullable(),
    source: z.literal("codex"),
    sourceExecutionSha256: sha256Schema,
    state: z.enum([
      "queued",
      "running",
      "idle",
      "completed",
      "failed",
      "cancelled",
      "unknown"
    ]),
    startedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    evidenceIds: canonicalEvidenceIdsSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine((execution, context) => {
    if (
      execution.completedAt !== null &&
      execution.startedAt !== null &&
      Date.parse(execution.completedAt) < Date.parse(execution.startedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Execution completion cannot predate its start."
      });
    }
  });

const workTargetShape = {
  projectId: workLedgerProjectIdSchema.nullable(),
  workItemId: workLedgerWorkItemIdSchema.nullable(),
  executionId: workLedgerExecutionIdSchema.nullable()
} as const;

export const developerOpenLoopSchema = z
  .object({
    openLoopId: workLedgerOpenLoopIdSchema,
    ...workTargetShape,
    kind: z.enum([
      "assigned_work",
      "review_request",
      "verification_needed",
      "code_review",
      "execution_failure",
      "workflow_follow_through",
      "uncommitted_change",
      "external_dependency",
      "other"
    ]),
    state: z.enum(["open", "resolved", "uncertain"]),
    openedAt: timestampSchema,
    dueAt: timestampSchema.nullable(),
    evidenceIds: canonicalEvidenceIdsSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine(refineTargetRequired);

export const developerBlockerSchema = z
  .object({
    blockerId: workLedgerBlockerIdSchema,
    ...workTargetShape,
    openLoopId: workLedgerOpenLoopIdSchema.nullable(),
    kind: z.enum([
      "source_conflict",
      "stale_evidence",
      "missing_relation",
      "ci_failure",
      "changes_requested",
      "merge_conflict",
      "execution_failure",
      "external_dependency",
      "user_clarification",
      "other"
    ]),
    state: z.enum(["active", "resolved"]),
    severity: z.enum(["info", "warning", "critical"]),
    evidenceIds: canonicalEvidenceIdsSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine((blocker, context) => {
    if (
      blocker.projectId === null &&
      blocker.workItemId === null &&
      blocker.executionId === null &&
      blocker.openLoopId === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A blocker must refer to at least one ledger object."
      });
    }
  });

export const developerNextActionSchema = z
  .object({
    nextActionId: workLedgerNextActionIdSchema,
    ...workTargetShape,
    openLoopId: workLedgerOpenLoopIdSchema.nullable(),
    blockerIds: z.array(workLedgerBlockerIdSchema).max(100),
    kind: z.enum([
      "do",
      "inspect",
      "refresh_sources",
      "clarify",
      "focus_or_resume",
      "open_source"
    ]),
    title: z.string().min(1).max(240),
    firstStep: z.string().min(1).max(300),
    state: z.enum([
      "candidate",
      "eligible",
      "review_required",
      "ineligible",
      "selected",
      "dismissed",
      "completed"
    ]),
    dueAt: timestampSchema.nullable(),
    evidenceIds: canonicalEvidenceIdsSchema,
    reasonCodes: canonicalReasonCodesSchema
  })
  .strict()
  .superRefine((action, context) => {
    if (
      action.projectId === null &&
      action.workItemId === null &&
      action.executionId === null &&
      action.openLoopId === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A next action must refer to at least one ledger object."
      });
    }
    if (!isCanonicalUnique(action.blockerIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockerIds"],
        message: "Blocker references must be unique and canonical."
      });
    }
  });

const pipelineVersionsSchema = z
  .object({
    collected: z.array(versionSchema).min(1).max(20),
    normalized: z.array(versionSchema).min(1).max(20),
    interpreted: z.array(versionSchema).min(1).max(20),
    verified: z.array(versionSchema).min(1).max(20),
    eligibility: z.array(versionSchema).min(1).max(20),
    selection: z.array(versionSchema).min(1).max(20)
  })
  .strict()
  .superRefine((versions, context) => {
    for (const [stage, values] of Object.entries(versions)) {
      if (!isCanonicalUnique(values)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [stage],
          message: "Pipeline versions must be unique and canonical."
        });
      }
    }
  });

const codeProvenanceSchema = z
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
        message: "Code provenance fields do not match code state."
      });
    }
  });

const developerWorkLedgerContentSchema = z
  .object({
    contract: z.literal(DEVELOPER_WORK_LEDGER_CONTRACT),
    schemaVersion: z.literal(DEVELOPER_WORK_LEDGER_SCHEMA_VERSION),
    canonicalizationVersion: z.literal(
      DEVELOPER_WORK_LEDGER_CANONICALIZATION_VERSION
    ),
    evidencePolicyVersion: z.literal(
      DEVELOPER_WORK_LEDGER_EVIDENCE_POLICY_VERSION
    ),
    idPolicyVersion: z.literal(DEVELOPER_WORK_LEDGER_ID_POLICY_VERSION),
    ledgerId: workLedgerIdSchema,
    runId: runIdSchema,
    analysisId: analysisIdSchema,
    resultId: resultIdSchema,
    asOf: timestampSchema,
    inputSha256: sha256Schema,
    privacyClass: z.literal("private_local_metadata"),
    retentionDays: z.number().int().positive().max(3_650),
    codeProvenance: codeProvenanceSchema,
    pipelineVersions: pipelineVersionsSchema,
    sourceSnapshots: z
      .array(developerWorkSourceSnapshotSchema)
      .max(developerWorkConnectorSourceSchema.options.length),
    evidence: z.array(developerWorkEvidenceSchema).max(MAX_LEDGER_ENTITIES),
    projects: z.array(developerWorkProjectSchema).max(MAX_LEDGER_ENTITIES),
    workItems: z.array(developerWorkItemSchema).max(MAX_LEDGER_ENTITIES),
    executions: z.array(developerExecutionSchema).max(MAX_LEDGER_ENTITIES),
    openLoops: z.array(developerOpenLoopSchema).max(MAX_LEDGER_ENTITIES),
    blockers: z.array(developerBlockerSchema).max(MAX_LEDGER_ENTITIES),
    nextActions: z.array(developerNextActionSchema).max(MAX_LEDGER_ENTITIES)
  })
  .strict();

const developerWorkLedgerDraftSchema = developerWorkLedgerContentSchema.omit({
  contract: true,
  schemaVersion: true,
  canonicalizationVersion: true,
  evidencePolicyVersion: true,
  idPolicyVersion: true,
  ledgerId: true
});

export const developerWorkLedgerSchema = developerWorkLedgerContentSchema
  .extend({ ledgerSha256: sha256Schema })
  .strict()
  .superRefine((ledger, context) => {
    if (ledger.ledgerId !== createDeveloperWorkLedgerId(ledger)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ledgerId"],
        message: "Work ledger ID does not match canonical run identity."
      });
    }
    if (ledger.ledgerSha256 !== developerWorkLedgerSha256(ledger)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ledgerSha256"],
        message: "Work ledger hash does not match canonical content."
      });
    }
    refineCanonicalLedger(ledger, context);
    refineLedgerReferences(ledger, context);
  });

export type DeveloperWorkSource = z.infer<typeof developerWorkSourceSchema>;
export type DeveloperWorkEvidence = z.infer<
  typeof developerWorkEvidenceSchema
>;
export type DeveloperWorkLedgerDraft = z.infer<
  typeof developerWorkLedgerDraftSchema
>;
export type DeveloperWorkLedger = z.infer<typeof developerWorkLedgerSchema>;

export function createDeveloperWorkEvidenceId(input: {
  source: DeveloperWorkSource;
  sourceRecordSha256: string;
  sourceSnapshotSha256: string | null;
  valueSha256: string;
  observedAt: string;
  role: DeveloperWorkEvidence["role"];
}): string {
  return runtimeStableId(
    "ledger_evidence",
    DEVELOPER_WORK_LEDGER_ID_POLICY_VERSION,
    {
      source: input.source,
      sourceRecordSha256: input.sourceRecordSha256,
      sourceSnapshotSha256: input.sourceSnapshotSha256,
      valueSha256: input.valueSha256,
      observedAt: input.observedAt,
      role: input.role
    }
  );
}

export function createDeveloperWorkEntityId(
  kind:
    | "project"
    | "work_item"
    | "execution"
    | "open_loop"
    | "blocker"
    | "next_action",
  identity: unknown
): string {
  return runtimeStableId(
    kind,
    DEVELOPER_WORK_LEDGER_ID_POLICY_VERSION,
    identity
  );
}

export function createDeveloperWorkLedgerId(input: {
  runId: string;
  resultId: string;
  asOf: string;
  inputSha256: string;
}): string {
  return runtimeStableId(
    "work_ledger",
    DEVELOPER_WORK_LEDGER_ID_POLICY_VERSION,
    {
      runId: input.runId,
      resultId: input.resultId,
      asOf: input.asOf,
      inputSha256: input.inputSha256
    }
  );
}

export function buildDeveloperWorkLedger(
  draftInput: DeveloperWorkLedgerDraft
): DeveloperWorkLedger {
  const canonical = canonicalizeDraft(draftInput);
  const draft = developerWorkLedgerDraftSchema.parse(canonical);
  const content = developerWorkLedgerContentSchema.parse({
    contract: DEVELOPER_WORK_LEDGER_CONTRACT,
    schemaVersion: DEVELOPER_WORK_LEDGER_SCHEMA_VERSION,
    canonicalizationVersion:
      DEVELOPER_WORK_LEDGER_CANONICALIZATION_VERSION,
    evidencePolicyVersion:
      DEVELOPER_WORK_LEDGER_EVIDENCE_POLICY_VERSION,
    idPolicyVersion: DEVELOPER_WORK_LEDGER_ID_POLICY_VERSION,
    ledgerId: createDeveloperWorkLedgerId(draft),
    ...draft
  });
  return developerWorkLedgerSchema.parse({
    ...content,
    ledgerSha256: developerWorkLedgerSha256(content)
  });
}

export function developerWorkLedgerSha256(
  ledger:
    | DeveloperWorkLedger
    | z.infer<typeof developerWorkLedgerContentSchema>
): string {
  const { ledgerSha256: _ledgerSha256, ...content } =
    ledger as DeveloperWorkLedger;
  return runtimeSha256({
    domain: DEVELOPER_WORK_LEDGER_CONTRACT,
    ledger: content
  });
}

export function verifyDeveloperWorkLedger(input: unknown): boolean {
  return developerWorkLedgerSchema.safeParse(input).success;
}

function canonicalizeDraft(
  draft: DeveloperWorkLedgerDraft
): DeveloperWorkLedgerDraft {
  const reasons = (values: string[]) => canonicalStrings(values);
  const evidenceIds = (values: string[]) => canonicalStrings(values);
  return {
    ...draft,
    pipelineVersions: {
      collected: canonicalStrings(draft.pipelineVersions.collected),
      normalized: canonicalStrings(draft.pipelineVersions.normalized),
      interpreted: canonicalStrings(draft.pipelineVersions.interpreted),
      verified: canonicalStrings(draft.pipelineVersions.verified),
      eligibility: canonicalStrings(draft.pipelineVersions.eligibility),
      selection: canonicalStrings(draft.pipelineVersions.selection)
    },
    sourceSnapshots: [...draft.sourceSnapshots]
      .map((source) => ({
        ...source,
        reasonCodes: reasons(source.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.source, right.source)
      ),
    evidence: [...draft.evidence]
      .map((item) => ({
        ...item,
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.evidenceId, right.evidenceId)
      ),
    projects: [...draft.projects]
      .map((item) => ({
        ...item,
        sourceScopeRefs: [...item.sourceScopeRefs].sort(compareSourceScopeRefs),
        evidenceIds: evidenceIds(item.evidenceIds),
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.projectId, right.projectId)
      ),
    workItems: [...draft.workItems]
      .map((item) => ({
        ...item,
        evidenceIds: evidenceIds(item.evidenceIds),
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.workItemId, right.workItemId)
      ),
    executions: [...draft.executions]
      .map((item) => ({
        ...item,
        evidenceIds: evidenceIds(item.evidenceIds),
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.executionId, right.executionId)
      ),
    openLoops: [...draft.openLoops]
      .map((item) => ({
        ...item,
        evidenceIds: evidenceIds(item.evidenceIds),
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.openLoopId, right.openLoopId)
      ),
    blockers: [...draft.blockers]
      .map((item) => ({
        ...item,
        evidenceIds: evidenceIds(item.evidenceIds),
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.blockerId, right.blockerId)
      ),
    nextActions: [...draft.nextActions]
      .map((item) => ({
        ...item,
        blockerIds: canonicalStrings(item.blockerIds),
        evidenceIds: evidenceIds(item.evidenceIds),
        reasonCodes: reasons(item.reasonCodes)
      }))
      .sort((left, right) =>
        compareRuntimeStrings(left.nextActionId, right.nextActionId)
      )
  };
}

function refineCanonicalLedger(
  ledger: DeveloperWorkLedger,
  context: z.RefinementCtx
): void {
  const canonicalLists: Array<[string, string[]]> = [
    ["sourceSnapshots", ledger.sourceSnapshots.map((item) => item.source)],
    ["evidence", ledger.evidence.map((item) => item.evidenceId)],
    ["projects", ledger.projects.map((item) => item.projectId)],
    ["workItems", ledger.workItems.map((item) => item.workItemId)],
    ["executions", ledger.executions.map((item) => item.executionId)],
    ["openLoops", ledger.openLoops.map((item) => item.openLoopId)],
    ["blockers", ledger.blockers.map((item) => item.blockerId)],
    ["nextActions", ledger.nextActions.map((item) => item.nextActionId)]
  ];
  for (const [path, values] of canonicalLists) {
    if (!isCanonicalUnique(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: "Ledger entities must be unique and canonically ordered."
      });
    }
  }
}

function refineLedgerReferences(
  ledger: DeveloperWorkLedger,
  context: z.RefinementCtx
): void {
  const evidenceIds = new Set(ledger.evidence.map((item) => item.evidenceId));
  const projectIds = new Set(ledger.projects.map((item) => item.projectId));
  const workItemIds = new Set(ledger.workItems.map((item) => item.workItemId));
  const executionIds = new Set(
    ledger.executions.map((item) => item.executionId)
  );
  const openLoopIds = new Set(ledger.openLoops.map((item) => item.openLoopId));
  const blockerIds = new Set(ledger.blockers.map((item) => item.blockerId));

  const entities: Array<{
    path: string;
    value: {
      evidenceIds: string[];
      projectId?: string | null;
      workItemId?: string | null;
      executionId?: string | null;
      openLoopId?: string | null;
      blockerIds?: string[];
    };
  }> = [
    ...ledger.projects.map((value) => ({ path: "projects", value })),
    ...ledger.workItems.map((value) => ({ path: "workItems", value })),
    ...ledger.executions.map((value) => ({ path: "executions", value })),
    ...ledger.openLoops.map((value) => ({ path: "openLoops", value })),
    ...ledger.blockers.map((value) => ({ path: "blockers", value })),
    ...ledger.nextActions.map((value) => ({ path: "nextActions", value }))
  ];

  for (const { path, value } of entities) {
    if (value.evidenceIds.some((id) => !evidenceIds.has(id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: "Ledger entity refers to unknown evidence."
      });
    }
    if (value.projectId && !projectIds.has(value.projectId)) {
      addUnknownReference(context, path, "project");
    }
    if (value.workItemId && !workItemIds.has(value.workItemId)) {
      addUnknownReference(context, path, "work item");
    }
    if (value.executionId && !executionIds.has(value.executionId)) {
      addUnknownReference(context, path, "execution");
    }
    if (value.openLoopId && !openLoopIds.has(value.openLoopId)) {
      addUnknownReference(context, path, "open loop");
    }
    if (value.blockerIds?.some((id) => !blockerIds.has(id))) {
      addUnknownReference(context, path, "blocker");
    }
  }
}

function refineTargetRequired(
  target: {
    projectId: string | null;
    workItemId: string | null;
    executionId: string | null;
  },
  context: z.RefinementCtx
): void {
  if (
    target.projectId === null &&
    target.workItemId === null &&
    target.executionId === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A work target must refer to at least one ledger object."
    });
  }
}

function addUnknownReference(
  context: z.RefinementCtx,
  path: string,
  kind: string
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message: `Ledger entity refers to an unknown ${kind}.`
  });
}

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}

function isCanonicalUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) =>
      index === 0
        ? true
        : compareRuntimeStrings(values[index - 1]!, value) < 0
    )
  );
}

function compareSourceScopeRefs(
  left: z.infer<typeof sourceScopeRefSchema>,
  right: z.infer<typeof sourceScopeRefSchema>
): number {
  return (
    compareRuntimeStrings(left.source, right.source) ||
    compareRuntimeStrings(left.sourceScopeSha256, right.sourceScopeSha256)
  );
}

function isCanonicalSourceScopeRefs(
  values: Array<z.infer<typeof sourceScopeRefSchema>>
): boolean {
  return values.every((value, index) => {
    if (index === 0) return true;
    return compareSourceScopeRefs(values[index - 1]!, value) < 0;
  });
}

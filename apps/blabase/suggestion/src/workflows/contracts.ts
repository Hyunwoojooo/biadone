import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";

export const PROJECT_WORKFLOW_STORE_CONTRACT =
  "project-workflow-store-v0.1" as const;
export const PROJECT_WORKFLOW_SCHEMA_VERSION =
  "project-workflow-schema-v0.1" as const;
export const PROJECT_WORKFLOW_POLICY_VERSION =
  "project-workflow-follow-through-policy-v0.1" as const;
export const PROJECT_WORKFLOW_PROJECTION_CONTRACT =
  "project-workflow-projection-v0.1" as const;
export const PROJECT_WORKFLOW_ID_POLICY_VERSION =
  "project-workflow-id-v0.1" as const;
export const PROJECT_WORKFLOW_GRACE_PERIOD_MS = 120_000 as const;
export const PROJECT_WORKFLOW_FILENAME =
  "project-workflows.json" as const;
export const MAX_PROJECT_WORKFLOW_DECISIONS = 10_000;
export const MAX_PROJECT_WORKFLOW_CLOSURES = 50_000;

const timestampSchema = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value, {
    message: "Workflow timestamps must use canonical UTC ISO format."
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const eventSequenceSchema = z.number().int().safe().positive();
const revisionSchema = z.number().int().safe().nonnegative();
export const projectWorkflowProjectIdSchema = z
  .string()
  .regex(/^project_[a-f0-9]{32}$/);
export const projectWorkflowDecisionIdSchema = z
  .string()
  .regex(/^workflow_decision_[a-f0-9]{32}$/);
export const projectWorkflowClosureIdSchema = z
  .string()
  .regex(/^workflow_closure_[a-f0-9]{32}$/);
export const projectWorkflowManagedRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
export const projectWorkflowBindingIdSchema = z
  .string()
  .regex(/^binding_[a-f0-9]{32}$/);
export const projectWorkflowExecutionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);

export const projectWorkflowActionKindSchema = z.enum([
  "review_changes",
  "commit_changes",
  "create_pull_request",
  "request_review"
]);

const workflowDecisionShape = {
  sequence: eventSequenceSchema,
  operation: z.enum(["configure", "clear"]),
  projectId: projectWorkflowProjectIdSchema,
  actionKind: projectWorkflowActionKindSchema.nullable(),
  configuredAt: timestampSchema.nullable(),
  decidedAt: timestampSchema,
  decisionSource: z.literal("explicit_user"),
  supersedesWorkflowDecisionId:
    projectWorkflowDecisionIdSchema.nullable(),
  gracePeriodMs: z.literal(PROJECT_WORKFLOW_GRACE_PERIOD_MS)
} as const;

const workflowDecisionCoreSchema = z
  .object(workflowDecisionShape)
  .strict()
  .superRefine(refineWorkflowDecision);

export const projectWorkflowDecisionSchema = z
  .object({
    ...workflowDecisionShape,
    workflowDecisionId: projectWorkflowDecisionIdSchema
  })
  .strict()
  .superRefine((decision, context) => {
    refineWorkflowDecision(decision, context);
    const core = workflowDecisionCoreSchema.safeParse(
      withoutWorkflowDecisionId(decision)
    );
    if (
      core.success &&
      decision.workflowDecisionId !==
        createProjectWorkflowDecisionId(core.data)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflowDecisionId"],
        message: "Workflow decision ID does not match canonical content."
      });
    }
  });

const workflowClosureShape = {
  sequence: eventSequenceSchema,
  managedRunId: projectWorkflowManagedRunIdSchema,
  bindingId: projectWorkflowBindingIdSchema,
  executionId: projectWorkflowExecutionIdSchema,
  workflowDecisionId: projectWorkflowDecisionIdSchema,
  actionKind: projectWorkflowActionKindSchema,
  outcome: z.enum(["completed", "skipped"]),
  decidedAt: timestampSchema,
  decisionSource: z.literal("explicit_user")
} as const;

const workflowClosureCoreSchema = z
  .object(workflowClosureShape)
  .strict();

export const projectWorkflowClosureSchema = z
  .object({
    ...workflowClosureShape,
    closureId: projectWorkflowClosureIdSchema
  })
  .strict()
  .superRefine((closure, context) => {
    const core = workflowClosureCoreSchema.safeParse(
      withoutClosureId(closure)
    );
    if (
      core.success &&
      closure.closureId !== createProjectWorkflowClosureId(core.data)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closureId"],
        message: "Workflow closure ID does not match canonical content."
      });
    }
  });

const projectWorkflowStoreContentSchema = z
  .object({
    contract: z.literal(PROJECT_WORKFLOW_STORE_CONTRACT),
    schemaVersion: z.literal(PROJECT_WORKFLOW_SCHEMA_VERSION),
    policyVersion: z.literal(PROJECT_WORKFLOW_POLICY_VERSION),
    revision: revisionSchema,
    updatedAt: timestampSchema,
    decisions: z
      .array(projectWorkflowDecisionSchema)
      .max(MAX_PROJECT_WORKFLOW_DECISIONS),
    closures: z
      .array(projectWorkflowClosureSchema)
      .max(MAX_PROJECT_WORKFLOW_CLOSURES)
  })
  .strict();

export const projectWorkflowStoreSchema =
  projectWorkflowStoreContentSchema
    .extend({ storeSha256: sha256Schema })
    .strict()
    .superRefine((store, context) => {
      if (
        store.storeSha256 !== projectWorkflowStoreSha256(store)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Workflow store hash does not match content."
        });
      }

      const events = [
        ...store.decisions.map((decision) => ({
          sequence: decision.sequence,
          decidedAt: decision.decidedAt,
          kind: "decision" as const,
          value: decision
        })),
        ...store.closures.map((closure) => ({
          sequence: closure.sequence,
          decidedAt: closure.decidedAt,
          kind: "closure" as const,
          value: closure
        }))
      ].sort((left, right) => left.sequence - right.sequence);
      if (store.revision !== events.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revision"],
          message: "Workflow revision must match its append-only event count."
        });
      }

      let previousTime = Number.NEGATIVE_INFINITY;
      events.forEach((event, index) => {
        if (event.sequence !== index + 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [event.kind === "decision" ? "decisions" : "closures"],
            message: "Workflow event sequences must be contiguous."
          });
        }
        const decidedAt = Date.parse(event.decidedAt);
        if (decidedAt < previousTime) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [event.kind === "decision" ? "decisions" : "closures"],
            message: "Workflow events must be chronological."
          });
        }
        previousTime = decidedAt;
      });
      const latestEvent = events[events.length - 1];
      if (latestEvent && store.updatedAt !== latestEvent.decidedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["updatedAt"],
          message: "Workflow store update time must match its latest event."
        });
      }
      if (
        !isStrictlyIncreasing(
          store.decisions.map((decision) => decision.sequence)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions"],
          message:
            "Workflow decisions must retain append order by sequence."
        });
      }
      if (
        !isStrictlyIncreasing(
          store.closures.map((closure) => closure.sequence)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["closures"],
          message:
            "Workflow closures must retain append order by sequence."
        });
      }

      const decisionIds = new Set<string>();
      const currentByProject = new Map<string, ProjectWorkflowDecision>();
      for (const [index, decision] of store.decisions.entries()) {
        if (decisionIds.has(decision.workflowDecisionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "workflowDecisionId"],
            message: "Workflow decision IDs must be unique."
          });
        }
        decisionIds.add(decision.workflowDecisionId);
        const current = currentByProject.get(decision.projectId);
        if (
          decision.supersedesWorkflowDecisionId !==
          (current?.workflowDecisionId ?? null)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "decisions",
              index,
              "supersedesWorkflowDecisionId"
            ],
            message:
              "A workflow decision must supersede the current decision for its project."
          });
        }
        currentByProject.set(decision.projectId, decision);
      }

      const decisionById = new Map(
        store.decisions.map((decision) => [
          decision.workflowDecisionId,
          decision
        ])
      );
      const closureIds = new Set<string>();
      const closureKeys = new Set<string>();
      for (const [index, closure] of store.closures.entries()) {
        const decision = decisionById.get(closure.workflowDecisionId);
        const closureKey = projectWorkflowClosureKey(closure);
        if (closureIds.has(closure.closureId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["closures", index, "closureId"],
            message: "Workflow closure IDs must be unique."
          });
        }
        if (closureKeys.has(closureKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["closures", index],
            message:
              "A managed run may be closed only once for a workflow decision."
          });
        }
        closureIds.add(closure.closureId);
        closureKeys.add(closureKey);
        if (
          !decision ||
          decision.operation !== "configure" ||
          decision.actionKind !== closure.actionKind ||
          closure.sequence <= decision.sequence ||
          Date.parse(closure.decidedAt) <
            Date.parse(decision.configuredAt as string)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["closures", index],
            message:
              "A closure must follow and match its explicit workflow configuration."
          });
        }
      }
    });

const activeWorkflowSchema = z
  .object({
    workflowDecisionId: projectWorkflowDecisionIdSchema,
    projectId: projectWorkflowProjectIdSchema,
    actionKind: projectWorkflowActionKindSchema,
    configuredAt: timestampSchema,
    gracePeriodMs: z.literal(PROJECT_WORKFLOW_GRACE_PERIOD_MS)
  })
  .strict();

const projectedClosureSchema = z
  .object({
    closureId: projectWorkflowClosureIdSchema,
    managedRunId: projectWorkflowManagedRunIdSchema,
    bindingId: projectWorkflowBindingIdSchema,
    executionId: projectWorkflowExecutionIdSchema,
    workflowDecisionId: projectWorkflowDecisionIdSchema,
    actionKind: projectWorkflowActionKindSchema,
    outcome: z.enum(["completed", "skipped"]),
    decidedAt: timestampSchema
  })
  .strict();

const projectWorkflowProjectionContentSchema = z
  .object({
    contract: z.literal(PROJECT_WORKFLOW_PROJECTION_CONTRACT),
    schemaVersion: z.literal(PROJECT_WORKFLOW_SCHEMA_VERSION),
    policyVersion: z.literal(PROJECT_WORKFLOW_POLICY_VERSION),
    asOf: timestampSchema,
    revision: revisionSchema,
    storeSha256: sha256Schema,
    activeWorkflows: z
      .array(activeWorkflowSchema)
      .max(MAX_PROJECT_WORKFLOW_DECISIONS),
    closures: z
      .array(projectedClosureSchema)
      .max(MAX_PROJECT_WORKFLOW_CLOSURES)
  })
  .strict();

export const projectWorkflowProjectionSchema =
  projectWorkflowProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.projectionSha256 !==
        projectWorkflowProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Workflow projection hash does not match content."
        });
      }
      const activeKeys = projection.activeWorkflows.map(
        (workflow) => `${workflow.projectId}:${workflow.workflowDecisionId}`
      );
      const closureIds = projection.closures.map(
        (closure) => closure.closureId
      );
      if (
        !isCanonicalUnique(activeKeys) ||
        new Set(
          projection.activeWorkflows.map((workflow) => workflow.projectId)
        ).size !== projection.activeWorkflows.length ||
        new Set(
          projection.activeWorkflows.map(
            (workflow) => workflow.workflowDecisionId
          )
        ).size !== projection.activeWorkflows.length ||
        !isCanonicalUnique(closureIds) ||
        new Set(
          projection.closures.map(projectWorkflowClosureKey)
        ).size !== projection.closures.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Workflow projection entries must be canonical and unique."
        });
      }
      if (
        projection.revision <
        projection.activeWorkflows.length + projection.closures.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revision"],
          message:
            "Workflow projection revision cannot predate its projected events."
        });
      }
      if (
        projection.activeWorkflows.some(
          (workflow) =>
            Date.parse(workflow.configuredAt) > Date.parse(projection.asOf)
        ) ||
        projection.closures.some(
          (closure) =>
            Date.parse(closure.decidedAt) > Date.parse(projection.asOf)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["asOf"],
          message: "A workflow projection cannot include future decisions."
        });
      }
    });

export type ProjectWorkflowActionKind = z.infer<
  typeof projectWorkflowActionKindSchema
>;
export type ProjectWorkflowDecision = z.infer<
  typeof projectWorkflowDecisionSchema
>;
export type ProjectWorkflowClosure = z.infer<
  typeof projectWorkflowClosureSchema
>;
export type ProjectWorkflowStore = z.infer<
  typeof projectWorkflowStoreSchema
>;
export type ActiveProjectWorkflow = z.infer<
  typeof activeWorkflowSchema
>;
export type ProjectWorkflowProjectedClosure = z.infer<
  typeof projectedClosureSchema
>;
export type ProjectWorkflowProjection = z.infer<
  typeof projectWorkflowProjectionSchema
>;
export type ProjectWorkflowStoreContent = z.infer<
  typeof projectWorkflowStoreContentSchema
>;
export type ProjectWorkflowProjectionContent = z.infer<
  typeof projectWorkflowProjectionContentSchema
>;

export type ProjectWorkflowApiResponse =
  | {
      status: "ready";
      projection: ProjectWorkflowProjection;
    }
  | {
      status: "unavailable";
      message: string;
    }
  | {
      status: "error";
      code: string;
      message: string;
    };

export function createProjectWorkflowDecisionId(
  input: z.infer<typeof workflowDecisionCoreSchema>
): string {
  return runtimeStableId(
    "workflow_decision",
    PROJECT_WORKFLOW_ID_POLICY_VERSION,
    input
  );
}

export function createProjectWorkflowClosureId(
  input: z.infer<typeof workflowClosureCoreSchema>
): string {
  return runtimeStableId(
    "workflow_closure",
    PROJECT_WORKFLOW_ID_POLICY_VERSION,
    input
  );
}

export function projectWorkflowDecision(
  input: z.infer<typeof workflowDecisionCoreSchema>
): ProjectWorkflowDecision {
  const core = workflowDecisionCoreSchema.parse(input);
  return projectWorkflowDecisionSchema.parse({
    ...core,
    workflowDecisionId: createProjectWorkflowDecisionId(core)
  });
}

export function projectWorkflowClosure(
  input: z.infer<typeof workflowClosureCoreSchema>
): ProjectWorkflowClosure {
  const core = workflowClosureCoreSchema.parse(input);
  return projectWorkflowClosureSchema.parse({
    ...core,
    closureId: createProjectWorkflowClosureId(core)
  });
}

export function sealProjectWorkflowStore(
  input: ProjectWorkflowStoreContent
): ProjectWorkflowStore {
  const content = projectWorkflowStoreContentSchema.parse(input);
  return projectWorkflowStoreSchema.parse({
    ...content,
    storeSha256: projectWorkflowStoreSha256(content)
  });
}

export function sealProjectWorkflowProjection(
  input: ProjectWorkflowProjectionContent
): ProjectWorkflowProjection {
  const content = projectWorkflowProjectionContentSchema.parse(input);
  return projectWorkflowProjectionSchema.parse({
    ...content,
    projectionSha256: projectWorkflowProjectionSha256(content)
  });
}

export function resolveProjectWorkflowProjection(input: {
  store: ProjectWorkflowStore;
  asOf: string;
}): ProjectWorkflowProjection {
  const store = projectWorkflowStoreSchema.parse(input.store);
  const asOf = new Date(input.asOf).toISOString();
  if (Date.parse(asOf) < Date.parse(store.updatedAt)) {
    throw new TypeError(
      "Current workflow projection asOf cannot predate the store."
    );
  }
  const currentByProject = new Map<string, ProjectWorkflowDecision>();
  for (const decision of store.decisions) {
    currentByProject.set(decision.projectId, decision);
  }
  const activeWorkflows = [...currentByProject.values()]
    .filter(
      (
        decision
      ): decision is ProjectWorkflowDecision & {
        operation: "configure";
        actionKind: ProjectWorkflowActionKind;
        configuredAt: string;
      } =>
        decision.operation === "configure" &&
        decision.actionKind !== null &&
        decision.configuredAt !== null
    )
    .map((decision) => ({
      workflowDecisionId: decision.workflowDecisionId,
      projectId: decision.projectId,
      actionKind: decision.actionKind,
      configuredAt: decision.configuredAt,
      gracePeriodMs: PROJECT_WORKFLOW_GRACE_PERIOD_MS
    }))
    .sort((left, right) =>
      compareRuntimeStrings(
        `${left.projectId}:${left.workflowDecisionId}`,
        `${right.projectId}:${right.workflowDecisionId}`
      )
    );
  const closures = store.closures
    .map((closure) => ({
      closureId: closure.closureId,
      managedRunId: closure.managedRunId,
      bindingId: closure.bindingId,
      executionId: closure.executionId,
      workflowDecisionId: closure.workflowDecisionId,
      actionKind: closure.actionKind,
      outcome: closure.outcome,
      decidedAt: closure.decidedAt
    }))
    .sort((left, right) =>
      compareRuntimeStrings(left.closureId, right.closureId)
    );
  return sealProjectWorkflowProjection({
    contract: PROJECT_WORKFLOW_PROJECTION_CONTRACT,
    schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
    policyVersion: PROJECT_WORKFLOW_POLICY_VERSION,
    asOf,
    revision: store.revision,
    storeSha256: store.storeSha256,
    activeWorkflows,
    closures
  });
}

export function projectWorkflowAppliesToManagedRun(input: {
  workflow: ActiveProjectWorkflow;
  managedRunStartedAt: string;
}): boolean {
  const workflow = activeWorkflowSchema.parse(input.workflow);
  const startedAt = timestampSchema.parse(input.managedRunStartedAt);
  return Date.parse(startedAt) >= Date.parse(workflow.configuredAt);
}

export function projectWorkflowGraceElapsed(input: {
  workflow: ActiveProjectWorkflow;
  managedRunStartedAt: string;
  completedAt: string;
  asOf: string;
}): boolean {
  if (!projectWorkflowAppliesToManagedRun(input)) return false;
  const completedAt = timestampSchema.parse(input.completedAt);
  const asOf = timestampSchema.parse(input.asOf);
  if (Date.parse(completedAt) < Date.parse(input.managedRunStartedAt)) {
    return false;
  }
  return (
    Date.parse(asOf) >=
    Date.parse(completedAt) + PROJECT_WORKFLOW_GRACE_PERIOD_MS
  );
}

export function projectWorkflowClosureKey(input: {
  managedRunId: string;
  workflowDecisionId: string;
}): string {
  return `${input.managedRunId}:${input.workflowDecisionId}`;
}

function projectWorkflowStoreSha256(
  input: Omit<ProjectWorkflowStore, "storeSha256"> | ProjectWorkflowStoreContent
): string {
  const { storeSha256: _storeSha256, ...content } = input as ProjectWorkflowStore;
  return runtimeSha256({
    domain: PROJECT_WORKFLOW_STORE_CONTRACT,
    store: content
  });
}

function projectWorkflowProjectionSha256(
  input:
    | Omit<ProjectWorkflowProjection, "projectionSha256">
    | ProjectWorkflowProjectionContent
): string {
  const { projectionSha256: _projectionSha256, ...content } =
    input as ProjectWorkflowProjection;
  return runtimeSha256({
    domain: PROJECT_WORKFLOW_PROJECTION_CONTRACT,
    projection: content
  });
}

function withoutWorkflowDecisionId(
  input: ProjectWorkflowDecision
): z.infer<typeof workflowDecisionCoreSchema> {
  const { workflowDecisionId: _workflowDecisionId, ...core } = input;
  return core;
}

function withoutClosureId(
  input: ProjectWorkflowClosure
): z.infer<typeof workflowClosureCoreSchema> {
  const { closureId: _closureId, ...core } = input;
  return core;
}

function isCanonicalUnique(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every(
      (value, index) => index === 0 || values[index - 1]! < value
    )
  );
}

function isStrictlyIncreasing(values: number[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value
  );
}

function refineWorkflowDecision(
  decision: {
    operation: "configure" | "clear";
    actionKind: ProjectWorkflowActionKind | null;
    configuredAt: string | null;
    decidedAt: string;
  },
  context: z.RefinementCtx
): void {
  const configured = decision.operation === "configure";
  if (
    configured !== (decision.actionKind !== null) ||
    configured !== (decision.configuredAt !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Only configure decisions may contain an action and configuration time."
    });
  }
  if (
    configured &&
    decision.configuredAt !== decision.decidedAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["configuredAt"],
      message:
        "A workflow becomes applicable only from its explicit configuration time."
    });
  }
}

import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";

export const WORK_CONTEXT_REGISTRY_CONTRACT =
  "work-context-registry-v1" as const;
export const WORK_CONTEXT_REGISTRY_SCHEMA_VERSION =
  "work-context-registry-schema-v1" as const;
export const WEEKLY_OUTCOME_STORE_CONTRACT =
  "weekly-outcome-store-v1" as const;
export const WEEKLY_OUTCOME_SCHEMA_VERSION =
  "weekly-outcome-schema-v1" as const;
export const RESOLVED_WORK_CONTEXT_CONTRACT =
  "resolved-work-context-v1" as const;
export const WEEKLY_OUTCOME_CADENCE_DAYS = 7 as const;

const WEEKLY_OUTCOME_CADENCE_MS =
  WEEKLY_OUTCOME_CADENCE_DAYS * 24 * 60 * 60 * 1_000;
const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const projectIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/);
const opaqueIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), {
    message: "Opaque IDs must not contain surrounding whitespace."
  })
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Opaque IDs must not contain control characters."
  });

const githubScopeSchema = z
  .object({
    source: z.literal("github"),
    resourceType: z.literal("repository"),
    opaqueId: opaqueIdSchema
  })
  .strict();

const codexScopeSchema = z
  .object({
    source: z.literal("codex"),
    resourceType: z.literal("scope"),
    opaqueId: opaqueIdSchema
  })
  .strict();

const notionScopeSchema = z
  .object({
    source: z.literal("notion"),
    resourceType: z.literal("resource"),
    opaqueId: opaqueIdSchema
  })
  .strict();

const googleCalendarScopeSchema = z
  .object({
    source: z.literal("google_calendar"),
    resourceType: z.literal("scope"),
    opaqueId: opaqueIdSchema
  })
  .strict();

/**
 * Provider identifiers are deliberately opaque. This contract does not parse
 * repository names, paths, calendar IDs, or Notion URLs to infer identity.
 */
export const sourceScopeRefSchema = z.discriminatedUnion("source", [
  githubScopeSchema,
  codexScopeSchema,
  notionScopeSchema,
  googleCalendarScopeSchema
]);

const projectIdentitySchema = z
  .object({
    projectId: projectIdSchema,
    createdAt: timestampSchema,
    archivedAt: timestampSchema.nullable()
  })
  .strict()
  .superRefine((project, context) => {
    if (
      project.archivedAt !== null &&
      Date.parse(project.archivedAt) < Date.parse(project.createdAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["archivedAt"],
        message: "Project archival cannot predate project creation."
      });
    }
  });

const mappingDecisionShape = {
  action: z.enum(["confirm", "remove"]),
  scope: sourceScopeRefSchema,
  projectId: projectIdSchema.nullable(),
  decidedAt: timestampSchema,
  decisionSource: z.literal("explicit_user"),
  supersedesDecisionId: z
    .string()
    .regex(/^mapping_[a-f0-9]{32}$/)
    .nullable()
} as const;

const mappingDecisionCoreSchema = z
  .object(mappingDecisionShape)
  .strict()
  .superRefine((decision, context) => {
    const projectMatchesAction =
      (decision.action === "confirm" && decision.projectId !== null) ||
      (decision.action === "remove" && decision.projectId === null);
    if (!projectMatchesAction) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "Mapping action and projectId do not match."
      });
    }
  });

const mappingDecisionSchema = z
  .object({
    ...mappingDecisionShape,
    decisionId: z.string().regex(/^mapping_[a-f0-9]{32}$/)
  })
  .strict()
  .superRefine((decision, context) => {
    const projectMatchesAction =
      (decision.action === "confirm" && decision.projectId !== null) ||
      (decision.action === "remove" && decision.projectId === null);
    if (!projectMatchesAction) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "Mapping action and projectId do not match."
      });
    }
    if (decision.decisionId !== createMappingDecisionId(decision)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionId"],
        message: "Mapping decision ID does not match its canonical content."
      });
    }
  });

const mappingProposalCoreSchema = z
  .object({
    scope: sourceScopeRefSchema,
    suggestedProjectId: projectIdSchema,
    proposedAt: timestampSchema,
    state: z.literal("proposed"),
    basis: z.enum([
      "shared_opaque_identifier",
      "source_metadata_hint",
      "user_workflow_hint"
    ])
  })
  .strict();

const mappingProposalSchema = mappingProposalCoreSchema
  .extend({
    proposalId: z.string().regex(/^proposal_[a-f0-9]{32}$/)
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.proposalId !== createMappingProposalId(proposal)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposalId"],
        message: "Mapping proposal ID does not match its canonical content."
      });
    }
  });

const workContextRegistryContentSchema = z
  .object({
    contract: z.literal(WORK_CONTEXT_REGISTRY_CONTRACT),
    schemaVersion: z.literal(WORK_CONTEXT_REGISTRY_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    projects: z.array(projectIdentitySchema),
    mappingDecisions: z.array(mappingDecisionSchema),
    mappingProposals: z.array(mappingProposalSchema)
  })
  .strict();

export const workContextRegistrySchema =
  workContextRegistryContentSchema
    .extend({
      registrySha256: sha256Schema
    })
    .strict()
    .superRefine((registry, context) => {
      const projectIds = new Set<string>();
      for (const [index, project] of registry.projects.entries()) {
        if (projectIds.has(project.projectId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["projects", index, "projectId"],
            message: "Project IDs must be unique."
          });
        }
        projectIds.add(project.projectId);
      }

      const decisionById = new Map<string, MappingDecision>();
      const supersededIds = new Set<string>();
      for (const [index, decision] of registry.mappingDecisions.entries()) {
        if (decisionById.has(decision.decisionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mappingDecisions", index, "decisionId"],
            message: "Mapping decision IDs must be unique."
          });
        }
        if (
          decision.projectId !== null &&
          !projectIds.has(decision.projectId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mappingDecisions", index, "projectId"],
            message: "Mapping decision references an unknown project."
          });
        }
        if (decision.supersedesDecisionId !== null) {
          const previous = decisionById.get(
            decision.supersedesDecisionId
          );
          if (
            !previous ||
            sourceScopeKey(previous.scope) !==
              sourceScopeKey(decision.scope) ||
            supersededIds.has(decision.supersedesDecisionId) ||
            Date.parse(decision.decidedAt) <
              Date.parse(previous.decidedAt)
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "mappingDecisions",
                index,
                "supersedesDecisionId"
              ],
              message:
                "A mapping decision must supersede the current decision for the same scope."
            });
          }
          supersededIds.add(decision.supersedesDecisionId);
        } else if (
          registry.mappingDecisions
            .slice(0, index)
            .some(
              (previous) =>
                sourceScopeKey(previous.scope) ===
                  sourceScopeKey(decision.scope) &&
                !supersededIds.has(previous.decisionId)
            )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "mappingDecisions",
              index,
              "supersedesDecisionId"
            ],
            message:
              "A new mapping decision must supersede the current decision."
          });
        }
        decisionById.set(decision.decisionId, decision);
      }

      const proposalIds = new Set<string>();
      for (const [index, proposal] of registry.mappingProposals.entries()) {
        if (
          proposalIds.has(proposal.proposalId) ||
          !projectIds.has(proposal.suggestedProjectId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mappingProposals", index],
            message:
              "Mapping proposals must be unique and reference an existing project."
          });
        }
        proposalIds.add(proposal.proposalId);
      }

      if (
        registry.registrySha256 !==
        hashWorkContextRegistryContent(registry)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["registrySha256"],
          message: "Registry integrity hash does not match."
        });
      }
    });

const weeklyOutcomeShape = {
  projectId: projectIdSchema.nullable(),
  primaryOutcome: z.string().trim().min(1).max(240),
  capturedAt: timestampSchema,
  validUntil: timestampSchema,
  recordedAt: timestampSchema,
  changeKind: z.enum(["capture", "update", "correction"]),
  supersedesOutcomeId: z
    .string()
    .regex(/^outcome_[a-f0-9]{32}$/)
    .nullable()
} as const;

const weeklyOutcomeCoreSchema = z
  .object(weeklyOutcomeShape)
  .strict()
  .superRefine((outcome, context) => {
    if (
      Date.parse(outcome.validUntil) - Date.parse(outcome.capturedAt) !==
      WEEKLY_OUTCOME_CADENCE_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "Weekly outcomes must use an exact seven-day cadence."
      });
    }
    if (Date.parse(outcome.recordedAt) < Date.parse(outcome.capturedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordedAt"],
        message: "An outcome cannot be recorded before it was captured."
      });
    }
    if (
      (outcome.changeKind === "capture") !==
      (outcome.supersedesOutcomeId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersedesOutcomeId"],
        message:
          "Only an initial capture may omit a superseded outcome."
      });
    }
  });

export const weeklyOutcomeSchema = z
  .object({
    ...weeklyOutcomeShape,
    outcomeId: z.string().regex(/^outcome_[a-f0-9]{32}$/)
  })
  .strict()
  .superRefine((outcome, context) => {
    if (
      Date.parse(outcome.validUntil) - Date.parse(outcome.capturedAt) !==
      WEEKLY_OUTCOME_CADENCE_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "Weekly outcomes must use an exact seven-day cadence."
      });
    }
    if (Date.parse(outcome.recordedAt) < Date.parse(outcome.capturedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordedAt"],
        message: "An outcome cannot be recorded before it was captured."
      });
    }
    if (
      (outcome.changeKind === "capture") !==
      (outcome.supersedesOutcomeId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersedesOutcomeId"],
        message:
          "Only an initial capture may omit a superseded outcome."
      });
    }
    if (outcome.outcomeId !== createWeeklyOutcomeId(outcome)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcomeId"],
        message: "Outcome ID does not match its canonical content."
      });
    }
  });

const weeklyOutcomeStoreContentSchema = z
  .object({
    contract: z.literal(WEEKLY_OUTCOME_STORE_CONTRACT),
    schemaVersion: z.literal(WEEKLY_OUTCOME_SCHEMA_VERSION),
    cadenceDays: z.literal(WEEKLY_OUTCOME_CADENCE_DAYS),
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    outcomes: z.array(weeklyOutcomeSchema)
  })
  .strict();

export const weeklyOutcomeStoreSchema =
  weeklyOutcomeStoreContentSchema
    .extend({
      storeSha256: sha256Schema
    })
    .strict()
    .superRefine((store, context) => {
      const outcomeById = new Map<string, WeeklyOutcome>();
      const supersededIds = new Set<string>();
      for (const [index, outcome] of store.outcomes.entries()) {
        if (outcomeById.has(outcome.outcomeId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["outcomes", index, "outcomeId"],
            message: "Outcome IDs must be unique."
          });
        }
        if (outcome.supersedesOutcomeId !== null) {
          const previous = outcomeById.get(
            outcome.supersedesOutcomeId
          );
          if (
            !previous ||
            previous.projectId !== outcome.projectId ||
            supersededIds.has(outcome.supersedesOutcomeId) ||
            Date.parse(outcome.recordedAt) <
              Date.parse(previous.recordedAt)
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["outcomes", index, "supersedesOutcomeId"],
              message:
                "An outcome must supersede the current outcome in the same project scope."
            });
          } else if (
            outcome.changeKind === "update" &&
            Date.parse(outcome.capturedAt) <=
              Date.parse(previous.capturedAt)
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["outcomes", index, "capturedAt"],
              message:
                "An updated weekly outcome must have a later capture time."
            });
          } else if (
            outcome.changeKind === "correction" &&
            (outcome.capturedAt !== previous.capturedAt ||
              outcome.validUntil !== previous.validUntil)
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["outcomes", index, "capturedAt"],
              message:
                "A correction preserves the original capture window."
            });
          }
          supersededIds.add(outcome.supersedesOutcomeId);
        }
        outcomeById.set(outcome.outcomeId, outcome);
      }
      if (
        store.storeSha256 !== hashWeeklyOutcomeStoreContent(store)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Weekly outcome store integrity hash does not match."
        });
      }
    });

export type SourceScopeRef = z.infer<typeof sourceScopeRefSchema>;
export type ProjectIdentity = z.infer<typeof projectIdentitySchema>;
export type MappingDecision = z.infer<typeof mappingDecisionSchema>;
export type MappingProposal = z.infer<typeof mappingProposalSchema>;
export type WorkContextRegistry = z.infer<
  typeof workContextRegistrySchema
>;
export type WeeklyOutcome = z.infer<typeof weeklyOutcomeSchema>;
export type WeeklyOutcomeStore = z.infer<
  typeof weeklyOutcomeStoreSchema
>;

export function createEmptyWorkContextRegistry(
  updatedAt: string
): WorkContextRegistry {
  return sealWorkContextRegistry({
    contract: WORK_CONTEXT_REGISTRY_CONTRACT,
    schemaVersion: WORK_CONTEXT_REGISTRY_SCHEMA_VERSION,
    revision: 0,
    updatedAt,
    projects: [],
    mappingDecisions: [],
    mappingProposals: []
  });
}

export function createProjectIdentity(
  registryInput: WorkContextRegistry,
  input: {
    createdAt: string;
    projectId?: string;
  }
): {
  registry: WorkContextRegistry;
  project: ProjectIdentity;
} {
  const registry = workContextRegistrySchema.parse(registryInput);
  const project = projectIdentitySchema.parse({
    projectId:
      input.projectId ??
      `project_${randomBytes(16).toString("hex")}`,
    createdAt: input.createdAt,
    archivedAt: null
  });
  if (
    registry.projects.some(
      (candidate) => candidate.projectId === project.projectId
    )
  ) {
    throw new WorkContextContractError("PROJECT_ALREADY_EXISTS");
  }
  return {
    registry: sealWorkContextRegistry({
      ...withoutRegistryHash(registry),
      revision: registry.revision + 1,
      updatedAt: input.createdAt,
      projects: [...registry.projects, project].sort((left, right) =>
        compareRuntimeStrings(left.projectId, right.projectId)
      )
    }),
    project
  };
}

export function proposeProjectMapping(
  registryInput: WorkContextRegistry,
  input: {
    scope: SourceScopeRef;
    suggestedProjectId: string;
    proposedAt: string;
    basis:
      | "shared_opaque_identifier"
      | "source_metadata_hint"
      | "user_workflow_hint";
  }
): {
  registry: WorkContextRegistry;
  proposal: MappingProposal;
} {
  const registry = workContextRegistrySchema.parse(registryInput);
  assertProjectExists(registry, input.suggestedProjectId);
  const proposalCore = mappingProposalCoreSchema.parse({
    ...input,
    state: "proposed"
  });
  const proposal = mappingProposalSchema.parse({
    ...proposalCore,
    proposalId: createMappingProposalId(proposalCore)
  });
  const existing = registry.mappingProposals.find(
    (candidate) => candidate.proposalId === proposal.proposalId
  );
  if (existing) return { registry, proposal: existing };

  return {
    registry: sealWorkContextRegistry({
      ...withoutRegistryHash(registry),
      revision: registry.revision + 1,
      updatedAt: input.proposedAt,
      mappingProposals: [
        ...registry.mappingProposals,
        proposal
      ].sort(compareProposals)
    }),
    proposal
  };
}

export function confirmProjectMapping(
  registryInput: WorkContextRegistry,
  input: {
    scope: SourceScopeRef;
    projectId: string;
    confirmedAt: string;
    explicitUserConfirmation: true;
  }
): {
  registry: WorkContextRegistry;
  decision: MappingDecision;
} {
  if (input.explicitUserConfirmation !== true) {
    throw new WorkContextContractError(
      "EXPLICIT_USER_CONFIRMATION_REQUIRED"
    );
  }
  const registry = workContextRegistrySchema.parse(registryInput);
  assertProjectExists(registry, input.projectId);
  const current = currentMappingDecision(registry, input.scope);
  if (
    current?.action === "confirm" &&
    current.projectId === input.projectId
  ) {
    return { registry, decision: current };
  }
  const decision = buildMappingDecision({
    action: "confirm",
    scope: input.scope,
    projectId: input.projectId,
    decidedAt: input.confirmedAt,
    decisionSource: "explicit_user",
    supersedesDecisionId: current?.decisionId ?? null
  });
  return {
    registry: appendMappingDecision(
      registry,
      decision,
      input.confirmedAt
    ),
    decision
  };
}

export function removeProjectMapping(
  registryInput: WorkContextRegistry,
  input: {
    scope: SourceScopeRef;
    removedAt: string;
    explicitUserConfirmation: true;
  }
): {
  registry: WorkContextRegistry;
  decision: MappingDecision | null;
} {
  if (input.explicitUserConfirmation !== true) {
    throw new WorkContextContractError(
      "EXPLICIT_USER_CONFIRMATION_REQUIRED"
    );
  }
  const registry = workContextRegistrySchema.parse(registryInput);
  const current = currentMappingDecision(registry, input.scope);
  if (!current || current.action === "remove") {
    return { registry, decision: null };
  }
  const decision = buildMappingDecision({
    action: "remove",
    scope: input.scope,
    projectId: null,
    decidedAt: input.removedAt,
    decisionSource: "explicit_user",
    supersedesDecisionId: current.decisionId
  });
  return {
    registry: appendMappingDecision(
      registry,
      decision,
      input.removedAt
    ),
    decision
  };
}

/**
 * Only the terminal explicit-user decision is eligible. Mapping proposals are
 * intentionally absent from this resolver.
 */
export function lookupProjectId(
  registryInput: WorkContextRegistry,
  scopeInput: SourceScopeRef
): string | null {
  const registry = workContextRegistrySchema.parse(registryInput);
  const scope = sourceScopeRefSchema.parse(scopeInput);
  const decision = currentMappingDecision(registry, scope);
  return decision?.action === "confirm"
    ? decision.projectId
    : null;
}

export function createEmptyWeeklyOutcomeStore(
  updatedAt: string
): WeeklyOutcomeStore {
  return sealWeeklyOutcomeStore({
    contract: WEEKLY_OUTCOME_STORE_CONTRACT,
    schemaVersion: WEEKLY_OUTCOME_SCHEMA_VERSION,
    cadenceDays: WEEKLY_OUTCOME_CADENCE_DAYS,
    revision: 0,
    updatedAt,
    outcomes: []
  });
}

export function weeklyOutcomeValidUntil(capturedAt: string): string {
  const milliseconds = Date.parse(timestampSchema.parse(capturedAt));
  return new Date(milliseconds + WEEKLY_OUTCOME_CADENCE_MS).toISOString();
}

export function captureWeeklyOutcome(
  storeInput: WeeklyOutcomeStore,
  input: {
    primaryOutcome: string;
    capturedAt: string;
    validUntil: string;
    recordedAt: string;
    projectId?: string;
  }
): {
  store: WeeklyOutcomeStore;
  outcome: WeeklyOutcome;
} {
  const store = weeklyOutcomeStoreSchema.parse(storeInput);
  const projectId = input.projectId ?? null;
  const current = currentWeeklyOutcome(store, projectId);
  const core = weeklyOutcomeCoreSchema.parse({
    projectId,
    primaryOutcome: input.primaryOutcome,
    capturedAt: input.capturedAt,
    validUntil: input.validUntil,
    recordedAt: input.recordedAt,
    changeKind: current ? "update" : "capture",
    supersedesOutcomeId: current?.outcomeId ?? null
  });
  return appendWeeklyOutcome(store, buildWeeklyOutcome(core));
}

export function correctWeeklyOutcome(
  storeInput: WeeklyOutcomeStore,
  input: {
    targetOutcomeId: string;
    primaryOutcome: string;
    recordedAt: string;
  }
): {
  store: WeeklyOutcomeStore;
  outcome: WeeklyOutcome;
} {
  const store = weeklyOutcomeStoreSchema.parse(storeInput);
  const target = store.outcomes.find(
    (outcome) => outcome.outcomeId === input.targetOutcomeId
  );
  if (!target) {
    throw new WorkContextContractError("OUTCOME_NOT_FOUND");
  }
  if (
    currentWeeklyOutcome(store, target.projectId)?.outcomeId !==
    target.outcomeId
  ) {
    throw new WorkContextContractError("OUTCOME_NOT_CURRENT");
  }
  const core = weeklyOutcomeCoreSchema.parse({
    projectId: target.projectId,
    primaryOutcome: input.primaryOutcome,
    capturedAt: target.capturedAt,
    validUntil: target.validUntil,
    recordedAt: input.recordedAt,
    changeKind: "correction",
    supersedesOutcomeId: target.outcomeId
  });
  return appendWeeklyOutcome(store, buildWeeklyOutcome(core));
}

export type WeeklyOutcomeResolution =
  | {
      status: "active";
      outcome: WeeklyOutcome;
    }
  | {
      status: "missing";
      reason: "OUTCOME_MISSING" | "NOT_YET_ACTIVE";
    }
  | {
      status: "expired";
      outcomeId: string;
      validUntil: string;
    };

export function resolveWeeklyOutcome(
  storeInput: WeeklyOutcomeStore,
  input: {
    asOf: string;
    projectId?: string;
  }
): WeeklyOutcomeResolution {
  const store = weeklyOutcomeStoreSchema.parse(storeInput);
  const asOf = Date.parse(timestampSchema.parse(input.asOf));
  const outcome = currentWeeklyOutcome(
    store,
    input.projectId ?? null
  );
  if (!outcome) {
    return { status: "missing", reason: "OUTCOME_MISSING" };
  }
  if (asOf < Date.parse(outcome.capturedAt)) {
    return { status: "missing", reason: "NOT_YET_ACTIVE" };
  }
  if (asOf >= Date.parse(outcome.validUntil)) {
    return {
      status: "expired",
      outcomeId: outcome.outcomeId,
      validUntil: outcome.validUntil
    };
  }
  return { status: "active", outcome };
}

export function hashWorkContextRegistryContent(
  registry: WorkContextRegistry | z.infer<
    typeof workContextRegistryContentSchema
  >
): string {
  return runtimeSha256(withoutRegistryHash(registry));
}

export function hashWeeklyOutcomeStoreContent(
  store: WeeklyOutcomeStore | z.infer<
    typeof weeklyOutcomeStoreContentSchema
  >
): string {
  return runtimeSha256(withoutOutcomeStoreHash(store));
}

export function sourceScopeFingerprint(
  scopeInput: SourceScopeRef
): string {
  const scope = sourceScopeRefSchema.parse(scopeInput);
  return runtimeStableId(
    "scope",
    "work-context-source-scope-v1",
    scope
  );
}

export class WorkContextContractError extends Error {
  constructor(
    public readonly code:
      | "EXPLICIT_USER_CONFIRMATION_REQUIRED"
      | "PROJECT_ALREADY_EXISTS"
      | "PROJECT_NOT_FOUND"
      | "OUTCOME_NOT_FOUND"
      | "OUTCOME_NOT_CURRENT"
  ) {
    super(code);
    this.name = "WorkContextContractError";
  }
}

function sourceScopeKey(scope: SourceScopeRef): string {
  return runtimeCanonicalJson(scope);
}

function createMappingDecisionId(
  decision:
    | MappingDecision
    | Omit<MappingDecision, "decisionId">
): string {
  const { decisionId: _decisionId, ...content } =
    decision as MappingDecision;
  return runtimeStableId(
    "mapping",
    "work-context-mapping-decision-v1",
    content
  );
}

function createMappingProposalId(
  proposal:
    | MappingProposal
    | Omit<MappingProposal, "proposalId">
): string {
  const { proposalId: _proposalId, ...content } =
    proposal as MappingProposal;
  return runtimeStableId(
    "proposal",
    "work-context-mapping-proposal-v1",
    content
  );
}

function createWeeklyOutcomeId(
  outcome: WeeklyOutcome | Omit<WeeklyOutcome, "outcomeId">
): string {
  const { outcomeId: _outcomeId, ...content } =
    outcome as WeeklyOutcome;
  return runtimeStableId(
    "outcome",
    "weekly-outcome-record-v1",
    content
  );
}

function buildMappingDecision(
  coreInput: z.infer<typeof mappingDecisionCoreSchema>
): MappingDecision {
  const core = mappingDecisionCoreSchema.parse(coreInput);
  return mappingDecisionSchema.parse({
    ...core,
    decisionId: createMappingDecisionId(core)
  });
}

function buildWeeklyOutcome(
  coreInput: z.infer<typeof weeklyOutcomeCoreSchema>
): WeeklyOutcome {
  const core = weeklyOutcomeCoreSchema.parse(coreInput);
  return weeklyOutcomeSchema.parse({
    ...core,
    outcomeId: createWeeklyOutcomeId(core)
  });
}

function currentMappingDecision(
  registry: WorkContextRegistry,
  scope: SourceScopeRef
): MappingDecision | null {
  const key = sourceScopeKey(scope);
  const candidates = registry.mappingDecisions.filter(
    (decision) => sourceScopeKey(decision.scope) === key
  );
  const superseded = new Set(
    candidates
      .map((decision) => decision.supersedesDecisionId)
      .filter((id): id is string => id !== null)
  );
  return (
    candidates.find(
      (decision) => !superseded.has(decision.decisionId)
    ) ?? null
  );
}

function currentWeeklyOutcome(
  store: WeeklyOutcomeStore,
  projectId: string | null
): WeeklyOutcome | null {
  const candidates = store.outcomes.filter(
    (outcome) => outcome.projectId === projectId
  );
  const superseded = new Set(
    candidates
      .map((outcome) => outcome.supersedesOutcomeId)
      .filter((id): id is string => id !== null)
  );
  return (
    candidates.find(
      (outcome) => !superseded.has(outcome.outcomeId)
    ) ?? null
  );
}

function appendMappingDecision(
  registry: WorkContextRegistry,
  decision: MappingDecision,
  updatedAt: string
): WorkContextRegistry {
  return sealWorkContextRegistry({
    ...withoutRegistryHash(registry),
    revision: registry.revision + 1,
    updatedAt,
    mappingDecisions: [...registry.mappingDecisions, decision]
  });
}

function appendWeeklyOutcome(
  store: WeeklyOutcomeStore,
  outcome: WeeklyOutcome
): {
  store: WeeklyOutcomeStore;
  outcome: WeeklyOutcome;
} {
  return {
    store: sealWeeklyOutcomeStore({
      ...withoutOutcomeStoreHash(store),
      revision: store.revision + 1,
      updatedAt: outcome.recordedAt,
      outcomes: [...store.outcomes, outcome]
    }),
    outcome
  };
}

function sealWorkContextRegistry(
  contentInput: z.input<typeof workContextRegistryContentSchema>
): WorkContextRegistry {
  const content = workContextRegistryContentSchema.parse(contentInput);
  return workContextRegistrySchema.parse({
    ...content,
    registrySha256: runtimeSha256(content)
  });
}

function sealWeeklyOutcomeStore(
  contentInput: z.input<typeof weeklyOutcomeStoreContentSchema>
): WeeklyOutcomeStore {
  const content = weeklyOutcomeStoreContentSchema.parse(contentInput);
  return weeklyOutcomeStoreSchema.parse({
    ...content,
    storeSha256: runtimeSha256(content)
  });
}

function withoutRegistryHash(
  registry: WorkContextRegistry | z.infer<
    typeof workContextRegistryContentSchema
  >
): z.infer<typeof workContextRegistryContentSchema> {
  const {
    registrySha256: _registrySha256,
    ...content
  } = registry as WorkContextRegistry;
  return workContextRegistryContentSchema.parse(content);
}

function withoutOutcomeStoreHash(
  store: WeeklyOutcomeStore | z.infer<
    typeof weeklyOutcomeStoreContentSchema
  >
): z.infer<typeof weeklyOutcomeStoreContentSchema> {
  const { storeSha256: _storeSha256, ...content } =
    store as WeeklyOutcomeStore;
  return weeklyOutcomeStoreContentSchema.parse(content);
}

function compareProposals(
  left: MappingProposal,
  right: MappingProposal
): number {
  return (
    compareRuntimeStrings(left.proposedAt, right.proposedAt) ||
    compareRuntimeStrings(left.proposalId, right.proposalId)
  );
}

function assertProjectExists(
  registry: WorkContextRegistry,
  projectId: string
): void {
  const parsedProjectId = projectIdSchema.parse(projectId);
  if (
    !registry.projects.some(
      (project) =>
        project.projectId === parsedProjectId &&
        project.archivedAt === null
    )
  ) {
    throw new WorkContextContractError("PROJECT_NOT_FOUND");
  }
}

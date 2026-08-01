import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";

export const WORK_RESUMPTION_BINDING_STORE_CONTRACT =
  "work-resumption-binding-store-v1" as const;
export const WORK_RESUMPTION_SCHEMA_VERSION =
  "work-resumption-schema-v1" as const;
export const WORK_RESUMPTION_COMMAND_CONTRACT =
  "work-resumption-command-v1" as const;
export const WORK_RESUMPTION_HEARTBEAT_CONTRACT =
  "work-resumption-heartbeat-v1" as const;
export const WORK_RESUMPTION_PROTOCOL_VERSION =
  "work-resumption-local-protocol-v1" as const;
export const WORK_RESUMPTION_COMMAND_TTL_MS = 30_000;
export const WORK_RESUMPTION_HEARTBEAT_FRESH_MS = 15_000;
export const WORK_RESUMPTION_COMMAND_RETENTION_DAYS = 7;
export const WORK_RESUMPTION_COMMAND_RETENTION_POLICY_VERSION =
  "work-resumption-command-retention-v1" as const;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const bindingIdSchema = z.string().regex(/^binding_[a-f0-9]{32}$/);
export const workResumptionCommandIdSchema = z
  .string()
  .regex(/^command_[a-f0-9]{32}$/);
export const workResumptionExecutionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const opaqueCodexScopeIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/);
const claimTokenSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const workResumptionInstanceIdSchema = z
  .string()
  .regex(/^instance_[a-f0-9]{32}$/);
const codexConnectionGenerationSchema = z
  .string()
  .regex(/^connection_[a-f0-9]{32}$/);
const opaqueSubjectIdSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value === value.trim(), {
    message: "Subject IDs must not contain surrounding whitespace."
  })
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Subject IDs must not contain control characters."
  });

export const workResumptionTaskIdentitySchema = z
  .object({
    kind: z.literal("attention_subject"),
    source: z.enum(["github", "codex", "notion", "manual"]),
    subjectId: opaqueSubjectIdSchema
  })
  .strict();

export const workResumptionTaskRefSchema =
  workResumptionTaskIdentitySchema
    .extend({
      displayTitle: z
        .string()
        .trim()
        .min(1)
        .max(240)
        .refine(
          (value) => !/[\u0000-\u001f\u007f]/u.test(value),
          {
            message:
              "Display titles must not contain control characters."
          }
        )
    })
    .strict();

const bindingDecisionCoreSchema = z
  .object({
    action: z.enum(["bind", "unbind"]),
    taskRef: workResumptionTaskIdentitySchema,
    executionId: workResumptionExecutionIdSchema,
    scopeId: opaqueCodexScopeIdSchema,
    decidedAt: timestampSchema,
    decisionSource: z.literal("explicit_user"),
    supersedesBindingId: bindingIdSchema.nullable()
  })
  .strict();

export const workSessionBindingDecisionSchema =
  bindingDecisionCoreSchema
    .extend({
      bindingId: bindingIdSchema
    })
    .strict()
    .superRefine((decision, context) => {
      const {
        bindingId: _bindingId,
        ...decisionCore
      } = decision;
      if (
        decision.bindingId !==
        createWorkSessionBindingId(decisionCore)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bindingId"],
          message:
            "Binding decision ID does not match canonical content."
        });
      }
    });

const bindingStoreContentSchema = z
  .object({
    contract: z.literal(
      WORK_RESUMPTION_BINDING_STORE_CONTRACT
    ),
    schemaVersion: z.literal(WORK_RESUMPTION_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    decisions: z.array(workSessionBindingDecisionSchema)
  })
  .strict();

export const workSessionBindingStoreSchema =
  bindingStoreContentSchema
    .extend({
      storeSha256: sha256Schema
    })
    .strict()
    .superRefine((store, context) => {
      const currentByTask = new Map<
        string,
        WorkSessionBindingDecision
      >();
      const seenIds = new Set<string>();
      let previousTime = Number.NEGATIVE_INFINITY;

      for (const [index, decision] of store.decisions.entries()) {
        const decidedAt = Date.parse(decision.decidedAt);
        if (decidedAt < previousTime) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "decidedAt"],
            message:
              "Binding decisions must be stored in chronological order."
          });
        }
        previousTime = decidedAt;
        if (seenIds.has(decision.bindingId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "bindingId"],
            message: "Binding decision IDs must be unique."
          });
        }
        seenIds.add(decision.bindingId);

        const key = workResumptionTaskKey(decision.taskRef);
        const current = currentByTask.get(key);
        if (
          decision.supersedesBindingId !==
          (current?.bindingId ?? null)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "decisions",
              index,
              "supersedesBindingId"
            ],
            message:
              "A binding decision must supersede the current decision for the same task."
          });
        }
        if (!current && decision.action === "unbind") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "action"],
            message: "An unbind decision must supersede a binding."
          });
        }
        if (
          decision.action === "unbind" &&
          current &&
          (current.action !== "bind" ||
            current.executionId !== decision.executionId ||
            current.scopeId !== decision.scopeId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index],
            message:
              "An unbind decision must preserve the superseded binding identity."
          });
        }
        currentByTask.set(key, decision);
      }
      if (store.revision !== store.decisions.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revision"],
          message:
            "Binding store revision must match its append-only decision count."
        });
      }
      const lastDecision =
        store.decisions[store.decisions.length - 1];
      if (
        lastDecision &&
        store.updatedAt !== lastDecision.decidedAt
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["updatedAt"],
          message:
            "Binding store update time must match its last decision."
        });
      }

      const content = withoutBindingStoreHash(store);
      if (store.storeSha256 !== runtimeSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Binding store hash does not match its content."
        });
      }
    });

export const storedWorkSessionBindingSchema = z
  .object({
    bindingId: bindingIdSchema,
    taskRef: workResumptionTaskIdentitySchema,
    executionId: workResumptionExecutionIdSchema,
    scopeId: opaqueCodexScopeIdSchema,
    boundAt: timestampSchema
  })
  .strict();

export const workSessionBindingSchema =
  storedWorkSessionBindingSchema
    .omit({ scopeId: true })
    .strict();

export const workResumptionSuccessCodeSchema = z.enum([
  "FOCUSED_EXISTING",
  "RESUMED_IN_TERMINAL"
]);

export const workResumptionFailureCodeSchema = z.enum([
  "EXECUTION_NOT_FOUND",
  "EXECUTION_STALE",
  "CODEX_UNAVAILABLE",
  "LAUNCH_FAILED",
  "LAUNCH_OUTCOME_UNKNOWN",
  "UNSUPPORTED_PLATFORM"
]);

export const workResumptionResultCodeSchema = z.union([
  workResumptionSuccessCodeSchema,
  workResumptionFailureCodeSchema,
  z.literal("COMMAND_EXPIRED")
]);

export const workResumptionCommandSchema = z
  .object({
    contract: z.literal(WORK_RESUMPTION_COMMAND_CONTRACT),
    commandId: workResumptionCommandIdSchema,
    bindingId: bindingIdSchema,
    operation: z.literal("focus_or_resume"),
    executionId: workResumptionExecutionIdSchema,
    scopeId: opaqueCodexScopeIdSchema,
    connectionGeneration: codexConnectionGenerationSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    status: z.enum([
      "pending",
      "claimed",
      "completed",
      "failed",
      "expired"
    ]),
    statusUpdatedAt: timestampSchema,
    claimedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    claimToken: claimTokenSchema.nullable(),
    launchStartedAt: timestampSchema.nullable(),
    resultCode: workResumptionResultCodeSchema.nullable()
  })
  .strict()
  .superRefine((command, context) => {
    if (
      Date.parse(command.expiresAt) - Date.parse(command.createdAt) !==
      WORK_RESUMPTION_COMMAND_TTL_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Command expiry must use the fixed short TTL."
      });
    }
    if (
      command.commandId !==
      createWorkResumptionCommandId({
        bindingId: command.bindingId,
        executionId: command.executionId,
        scopeId: command.scopeId,
        connectionGeneration: command.connectionGeneration,
        createdAt: command.createdAt
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commandId"],
        message: "Command ID does not match canonical content."
      });
    }

    const claimFieldsMatch =
      (command.claimedAt === null) ===
      (command.claimToken === null);
    const hasClaim =
      command.claimedAt !== null && command.claimToken !== null;
    const hasCompletion = command.completedAt !== null;
    const resultCode = command.resultCode;
    const lifecycleValid =
      (command.status === "pending" &&
        !hasClaim &&
        !hasCompletion &&
        command.launchStartedAt === null &&
        resultCode === null) ||
      (command.status === "claimed" &&
        hasClaim &&
        !hasCompletion &&
        resultCode === null) ||
      (command.status === "completed" &&
        hasClaim &&
        hasCompletion &&
        command.launchStartedAt !== null &&
        workResumptionSuccessCodeSchema.safeParse(resultCode)
          .success) ||
      (command.status === "failed" &&
        hasClaim &&
        hasCompletion &&
        workResumptionFailureCodeSchema.safeParse(resultCode)
          .success) ||
      (command.status === "expired" &&
        hasCompletion &&
        command.launchStartedAt === null &&
        resultCode === "COMMAND_EXPIRED");
    const valid = claimFieldsMatch && lifecycleValid;
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Command status, claim, completion, and result fields do not match."
      });
    }
    const createdAt = Date.parse(command.createdAt);
    const expiresAt = Date.parse(command.expiresAt);
    const statusUpdatedAt = Date.parse(command.statusUpdatedAt);
    const claimedAt =
      command.claimedAt === null
        ? null
        : Date.parse(command.claimedAt);
    const completedAt =
      command.completedAt === null
        ? null
        : Date.parse(command.completedAt);
    const launchStartedAt =
      command.launchStartedAt === null
        ? null
        : Date.parse(command.launchStartedAt);
    const chronologyValid =
      statusUpdatedAt >= createdAt &&
      (claimedAt === null ||
        (claimedAt >= createdAt && claimedAt < expiresAt)) &&
      (completedAt === null ||
        completedAt >= (claimedAt ?? createdAt)) &&
      (launchStartedAt === null ||
        (claimedAt !== null &&
          launchStartedAt >= claimedAt &&
          launchStartedAt < expiresAt)) &&
      (command.status === "pending"
        ? statusUpdatedAt === createdAt
        : command.status === "claimed"
          ? statusUpdatedAt === claimedAt
          : statusUpdatedAt === completedAt) &&
      (command.status !== "expired" ||
        completedAt === null ||
        completedAt >= expiresAt);
    if (!chronologyValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statusUpdatedAt"],
        message: "Command lifecycle timestamps are inconsistent."
      });
    }
  });

export const workResumptionHeartbeatSchema = z
  .object({
    contract: z.literal(WORK_RESUMPTION_HEARTBEAT_CONTRACT),
    protocolVersion: z.literal(WORK_RESUMPTION_PROTOCOL_VERSION),
    instanceId: workResumptionInstanceIdSchema,
    observedAt: timestampSchema,
    capabilities: z.tuple([z.literal("focus_or_resume")])
  })
  .strict();

export const workResumptionMutationSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("bind"),
        taskRef: workResumptionTaskRefSchema,
        executionId: workResumptionExecutionIdSchema,
        explicitUserConfirmation: z.literal(true)
      })
      .strict(),
    z
      .object({
        action: z.literal("unbind"),
        taskRef: workResumptionTaskRefSchema,
        explicitUserConfirmation: z.literal(true)
      })
      .strict(),
    z
      .object({
        action: z.literal("open"),
        taskRef: workResumptionTaskRefSchema,
        explicitUserAction: z.literal(true)
      })
      .strict()
  ]
);

export const completeClaimedCommandInputSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        commandId: workResumptionCommandIdSchema,
        claimToken: claimTokenSchema,
        outcome: z.literal("completed"),
        resultCode: workResumptionSuccessCodeSchema,
        completedAt: timestampSchema
      })
      .strict(),
    z
      .object({
        commandId: workResumptionCommandIdSchema,
        claimToken: claimTokenSchema,
        outcome: z.literal("failed"),
        resultCode: workResumptionFailureCodeSchema,
        completedAt: timestampSchema
      })
      .strict(),
    z
      .object({
        commandId: workResumptionCommandIdSchema,
        claimToken: claimTokenSchema,
        outcome: z.literal("expired"),
        resultCode: z.literal("COMMAND_EXPIRED"),
        completedAt: timestampSchema
      })
      .strict()
  ]);

export const publicWorkResumptionCommandStatusSchema = z
  .object({
    commandId: workResumptionCommandIdSchema,
    bindingId: bindingIdSchema,
    operation: z.literal("focus_or_resume"),
    status: z.enum([
      "pending",
      "claimed",
      "completed",
      "failed",
      "expired"
    ]),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    resultCode: workResumptionResultCodeSchema.nullable()
  })
  .strict();

export type WorkResumptionTaskRef = z.infer<
  typeof workResumptionTaskRefSchema
>;
export type WorkResumptionTaskIdentity = z.infer<
  typeof workResumptionTaskIdentitySchema
>;
export type WorkSessionBindingDecision = z.infer<
  typeof workSessionBindingDecisionSchema
>;
export type WorkSessionBindingStore = z.infer<
  typeof workSessionBindingStoreSchema
>;
export type WorkSessionBinding = z.infer<
  typeof workSessionBindingSchema
>;
export type StoredWorkSessionBinding = z.infer<
  typeof storedWorkSessionBindingSchema
>;
export type WorkResumptionCommand = z.infer<
  typeof workResumptionCommandSchema
>;
export type WorkResumptionHeartbeat = z.infer<
  typeof workResumptionHeartbeatSchema
>;
export type WorkResumptionMutation = z.infer<
  typeof workResumptionMutationSchema
>;
export type CompleteClaimedCommandInput = z.infer<
  typeof completeClaimedCommandInputSchema
>;
export type PublicWorkResumptionCommandStatus = z.infer<
  typeof publicWorkResumptionCommandStatusSchema
>;

export function createEmptyWorkSessionBindingStore(
  updatedAt: string
): WorkSessionBindingStore {
  return sealBindingStore({
    contract: WORK_RESUMPTION_BINDING_STORE_CONTRACT,
    schemaVersion: WORK_RESUMPTION_SCHEMA_VERSION,
    revision: 0,
    updatedAt,
    decisions: []
  });
}

export function bindWorkSessionDecision(
  storeInput: WorkSessionBindingStore,
  input: {
    taskRef: WorkResumptionTaskRef;
    executionId: string;
    scopeId: string;
    boundAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: WorkSessionBindingStore;
  binding: StoredWorkSessionBinding;
  decision: WorkSessionBindingDecision;
} {
  assertExplicitConfirmation(input.explicitUserConfirmation);
  const store = workSessionBindingStoreSchema.parse(storeInput);
  const taskRef = storedTaskIdentity(input.taskRef);
  const current = currentDecision(store, taskRef);
  if (
    current?.action === "bind" &&
    current.executionId === input.executionId &&
    current.scopeId === input.scopeId
  ) {
    return {
      store,
      decision: current,
      binding: storedBindingFromDecision(current)
    };
  }
  const decision = buildBindingDecision({
    action: "bind",
    taskRef,
    executionId: input.executionId,
    scopeId: input.scopeId,
    decidedAt: input.boundAt,
    decisionSource: "explicit_user",
    supersedesBindingId: current?.bindingId ?? null
  });
  const next = appendBindingDecision(store, decision);
  return {
    store: next,
    decision,
    binding: storedBindingFromDecision(decision)
  };
}

export function unbindWorkSessionDecision(
  storeInput: WorkSessionBindingStore,
  input: {
    taskRef: WorkResumptionTaskRef;
    unboundAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: WorkSessionBindingStore;
  decision: WorkSessionBindingDecision | null;
} {
  assertExplicitConfirmation(input.explicitUserConfirmation);
  const store = workSessionBindingStoreSchema.parse(storeInput);
  const taskRef = storedTaskIdentity(input.taskRef);
  const current = currentDecision(store, taskRef);
  if (!current || current.action === "unbind") {
    return { store, decision: null };
  }
  const decision = buildBindingDecision({
    action: "unbind",
    taskRef,
    executionId: current.executionId,
    scopeId: current.scopeId,
    decidedAt: input.unboundAt,
    decisionSource: "explicit_user",
    supersedesBindingId: current.bindingId
  });
  return {
    store: appendBindingDecision(store, decision),
    decision
  };
}

export function currentWorkSessionBindings(
  storeInput: WorkSessionBindingStore
): WorkSessionBinding[] {
  return currentStoredWorkSessionBindings(storeInput).map(
    publicBinding
  );
}

export function currentStoredWorkSessionBindings(
  storeInput: WorkSessionBindingStore
): StoredWorkSessionBinding[] {
  const store = workSessionBindingStoreSchema.parse(storeInput);
  const current = new Map<string, WorkSessionBindingDecision>();
  for (const decision of store.decisions) {
    current.set(workResumptionTaskKey(decision.taskRef), decision);
  }
  return [...current.values()]
    .filter(
      (
        decision
      ): decision is WorkSessionBindingDecision & {
        action: "bind";
      } => decision.action === "bind"
    )
    .map(storedBindingFromDecision)
    .sort((left, right) =>
      workResumptionTaskKey(left.taskRef).localeCompare(
        workResumptionTaskKey(right.taskRef)
      )
    );
}

export function lookupWorkSessionBinding(
  storeInput: WorkSessionBindingStore,
  taskRefInput: WorkResumptionTaskRef
): WorkSessionBinding | null {
  const stored = lookupStoredWorkSessionBinding(
    storeInput,
    taskRefInput
  );
  return stored ? publicBinding(stored) : null;
}

export function lookupStoredWorkSessionBinding(
  storeInput: WorkSessionBindingStore,
  taskRefInput:
    | WorkResumptionTaskRef
    | WorkResumptionTaskIdentity
): StoredWorkSessionBinding | null {
  const store = workSessionBindingStoreSchema.parse(storeInput);
  const taskRef = storedTaskIdentity(taskRefInput);
  const decision = currentDecision(store, taskRef);
  return decision?.action === "bind"
    ? storedBindingFromDecision(decision)
    : null;
}

export function workResumptionTaskKey(
  taskRefInput:
    | WorkResumptionTaskRef
    | WorkResumptionTaskIdentity
): string {
  const taskRef = storedTaskIdentity(taskRefInput);
  return runtimeSha256({
    kind: taskRef.kind,
    source: taskRef.source,
    subjectId: taskRef.subjectId
  });
}

export function createPendingWorkResumptionCommand(input: {
  binding: StoredWorkSessionBinding;
  connectionGeneration: string;
  createdAt: string;
}): WorkResumptionCommand {
  const binding = storedWorkSessionBindingSchema.parse(
    input.binding
  );
  const createdAt = timestampSchema.parse(input.createdAt);
  const expiresAt = new Date(
    Date.parse(createdAt) + WORK_RESUMPTION_COMMAND_TTL_MS
  ).toISOString();
  return workResumptionCommandSchema.parse({
    contract: WORK_RESUMPTION_COMMAND_CONTRACT,
    commandId: createWorkResumptionCommandId({
      bindingId: binding.bindingId,
      executionId: binding.executionId,
      scopeId: binding.scopeId,
      connectionGeneration: input.connectionGeneration,
      createdAt
    }),
    bindingId: binding.bindingId,
    operation: "focus_or_resume",
    executionId: binding.executionId,
    scopeId: binding.scopeId,
    connectionGeneration:
      codexConnectionGenerationSchema.parse(
        input.connectionGeneration
      ),
    createdAt,
    expiresAt,
    status: "pending",
    statusUpdatedAt: createdAt,
    claimedAt: null,
    completedAt: null,
    claimToken: null,
    launchStartedAt: null,
    resultCode: null
  });
}

export function claimWorkResumptionCommand(
  commandInput: WorkResumptionCommand,
  claimedAtInput: string,
  claimTokenInput = randomBytes(16).toString("hex")
): WorkResumptionCommand {
  const command = workResumptionCommandSchema.parse(commandInput);
  const claimedAt = timestampSchema.parse(claimedAtInput);
  const claimToken = claimTokenSchema.parse(claimTokenInput);
  if (command.status !== "pending") return command;
  if (Date.parse(claimedAt) >= Date.parse(command.expiresAt)) {
    return expireWorkResumptionCommand(command, claimedAt);
  }
  return workResumptionCommandSchema.parse({
    ...command,
    status: "claimed",
    statusUpdatedAt: claimedAt,
    claimedAt,
    claimToken
  });
}

export function startWorkResumptionCommandLaunch(
  commandInput: WorkResumptionCommand,
  input: {
    claimToken: string;
    launchStartedAt: string;
  }
): WorkResumptionCommand {
  const command = workResumptionCommandSchema.parse(commandInput);
  const claimToken = claimTokenSchema.parse(input.claimToken);
  const launchStartedAt = timestampSchema.parse(
    input.launchStartedAt
  );
  if (
    command.status !== "claimed" ||
    command.claimToken !== claimToken ||
    command.launchStartedAt !== null ||
    Date.parse(launchStartedAt) < Date.parse(command.claimedAt as string) ||
    Date.parse(launchStartedAt) >= Date.parse(command.expiresAt)
  ) {
    throw new WorkResumptionContractError(
      "INVALID_COMMAND_TRANSITION"
    );
  }
  return workResumptionCommandSchema.parse({
    ...command,
    launchStartedAt
  });
}

export function completeWorkResumptionCommand(
  commandInput: WorkResumptionCommand,
  input: CompleteClaimedCommandInput
): WorkResumptionCommand {
  const command = workResumptionCommandSchema.parse(commandInput);
  const completion = completeClaimedCommandInputSchema.parse(input);
  if (
    command.status === "expired" &&
    completion.outcome === "expired" &&
    command.claimToken === completion.claimToken
  ) {
    return command;
  }
  if (
    command.status !== "claimed" ||
    command.claimToken !== completion.claimToken
  ) {
    throw new WorkResumptionContractError(
      "COMMAND_CLAIM_MISMATCH"
    );
  }
  if (
    Date.parse(completion.completedAt) <
    Date.parse(command.claimedAt as string)
  ) {
    throw new WorkResumptionContractError(
      "INVALID_COMMAND_TRANSITION"
    );
  }
  if (
    completion.outcome === "expired" &&
    Date.parse(completion.completedAt) <
      Date.parse(command.expiresAt)
  ) {
    throw new WorkResumptionContractError(
      "INVALID_COMMAND_TRANSITION"
    );
  }
  return workResumptionCommandSchema.parse({
    ...command,
    status: completion.outcome,
    statusUpdatedAt: completion.completedAt,
    completedAt: completion.completedAt,
    resultCode: completion.resultCode
  });
}

export function expireWorkResumptionCommand(
  commandInput: WorkResumptionCommand,
  expiredAtInput: string
): WorkResumptionCommand {
  const command = workResumptionCommandSchema.parse(commandInput);
  const expiredAt = timestampSchema.parse(expiredAtInput);
  if (
    (command.status !== "pending" &&
      command.status !== "claimed") ||
    Date.parse(expiredAt) < Date.parse(command.expiresAt)
  ) {
    return command;
  }
  if (command.launchStartedAt !== null) {
    return workResumptionCommandSchema.parse({
      ...command,
      status: "failed",
      statusUpdatedAt: expiredAt,
      completedAt: expiredAt,
      resultCode: "LAUNCH_OUTCOME_UNKNOWN"
    });
  }
  return workResumptionCommandSchema.parse({
    ...command,
    status: "expired",
    statusUpdatedAt: expiredAt,
    completedAt: expiredAt,
    resultCode: "COMMAND_EXPIRED"
  });
}

export function publicCommandStatus(
  commandInput: WorkResumptionCommand
): PublicWorkResumptionCommandStatus {
  const command = workResumptionCommandSchema.parse(commandInput);
  return publicWorkResumptionCommandStatusSchema.parse({
    commandId: command.commandId,
    bindingId: command.bindingId,
    operation: command.operation,
    status: command.status,
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
    completedAt: command.completedAt,
    resultCode: command.resultCode
  });
}

export function createWorkResumptionHeartbeat(
  observedAt: string,
  instanceId: string
): WorkResumptionHeartbeat {
  return workResumptionHeartbeatSchema.parse({
    contract: WORK_RESUMPTION_HEARTBEAT_CONTRACT,
    protocolVersion: WORK_RESUMPTION_PROTOCOL_VERSION,
    instanceId,
    observedAt,
    capabilities: ["focus_or_resume"]
  });
}

export function createWorkResumptionInstanceId(): string {
  return workResumptionInstanceIdSchema.parse(
    `instance_${randomBytes(16).toString("hex")}`
  );
}

export function workResumptionCodexConnectionGeneration(input: {
  installationSecret: string;
  discoveredAt: string;
}): string {
  return codexConnectionGenerationSchema.parse(
    runtimeStableId(
      "connection",
      "work-resumption-codex-connection-v1",
      {
        installationSecret: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(input.installationSecret),
        discoveredAt: timestampSchema.parse(input.discoveredAt)
      }
    )
  );
}

export function isFreshWorkResumptionHeartbeat(
  heartbeatInput: WorkResumptionHeartbeat,
  now: Date
): boolean {
  const heartbeat = workResumptionHeartbeatSchema.parse(
    heartbeatInput
  );
  const age = now.getTime() - Date.parse(heartbeat.observedAt);
  return age >= -5_000 && age <= WORK_RESUMPTION_HEARTBEAT_FRESH_MS;
}

function createWorkSessionBindingId(
  decisionInput: z.input<typeof bindingDecisionCoreSchema>
): string {
  const decision = bindingDecisionCoreSchema.parse(decisionInput);
  return runtimeStableId(
    "binding",
    WORK_RESUMPTION_BINDING_STORE_CONTRACT,
    decision
  );
}

function createWorkResumptionCommandId(input: {
  bindingId: string;
  executionId: string;
  scopeId: string;
  connectionGeneration: string;
  createdAt: string;
}): string {
  return runtimeStableId(
    "command",
    WORK_RESUMPTION_COMMAND_CONTRACT,
    {
      bindingId: bindingIdSchema.parse(input.bindingId),
      executionId: workResumptionExecutionIdSchema.parse(
        input.executionId
      ),
      scopeId: opaqueCodexScopeIdSchema.parse(input.scopeId),
      connectionGeneration:
        codexConnectionGenerationSchema.parse(
          input.connectionGeneration
        ),
      createdAt: timestampSchema.parse(input.createdAt),
      operation: "focus_or_resume"
    }
  );
}

function buildBindingDecision(
  input: z.input<typeof bindingDecisionCoreSchema>
): WorkSessionBindingDecision {
  const core = bindingDecisionCoreSchema.parse(input);
  return workSessionBindingDecisionSchema.parse({
    ...core,
    bindingId: createWorkSessionBindingId(core)
  });
}

function appendBindingDecision(
  store: WorkSessionBindingStore,
  decision: WorkSessionBindingDecision
): WorkSessionBindingStore {
  return sealBindingStore({
    ...withoutBindingStoreHash(store),
    revision: store.revision + 1,
    updatedAt: decision.decidedAt,
    decisions: [...store.decisions, decision]
  });
}

function sealBindingStore(
  input: z.input<typeof bindingStoreContentSchema>
): WorkSessionBindingStore {
  const content = bindingStoreContentSchema.parse(input);
  return workSessionBindingStoreSchema.parse({
    ...content,
    storeSha256: runtimeSha256(content)
  });
}

function withoutBindingStoreHash(
  store: z.input<typeof workSessionBindingStoreSchema>
): z.infer<typeof bindingStoreContentSchema> {
  const { storeSha256: _storeSha256, ...content } = store;
  return bindingStoreContentSchema.parse(content);
}

function currentDecision(
  store: WorkSessionBindingStore,
  taskRef:
    | WorkResumptionTaskRef
    | WorkResumptionTaskIdentity
): WorkSessionBindingDecision | null {
  const key = workResumptionTaskKey(taskRef);
  let current: WorkSessionBindingDecision | null = null;
  for (const decision of store.decisions) {
    if (workResumptionTaskKey(decision.taskRef) === key) {
      current = decision;
    }
  }
  return current;
}

function storedBindingFromDecision(
  decision: WorkSessionBindingDecision & { action: "bind" }
): StoredWorkSessionBinding;
function storedBindingFromDecision(
  decision: WorkSessionBindingDecision
): StoredWorkSessionBinding;
function storedBindingFromDecision(
  decision: WorkSessionBindingDecision
): StoredWorkSessionBinding {
  return storedWorkSessionBindingSchema.parse({
    bindingId: decision.bindingId,
    taskRef: decision.taskRef,
    executionId: decision.executionId,
    scopeId: decision.scopeId,
    boundAt: decision.decidedAt
  });
}

function publicBinding(
  bindingInput: StoredWorkSessionBinding
): WorkSessionBinding {
  const binding =
    storedWorkSessionBindingSchema.parse(bindingInput);
  return workSessionBindingSchema.parse({
    bindingId: binding.bindingId,
    taskRef: binding.taskRef,
    executionId: binding.executionId,
    boundAt: binding.boundAt
  });
}

function storedTaskIdentity(
  taskRefInput:
    | WorkResumptionTaskRef
    | WorkResumptionTaskIdentity
): WorkResumptionTaskIdentity {
  return workResumptionTaskIdentitySchema.parse({
    kind: taskRefInput.kind,
    source: taskRefInput.source,
    subjectId: taskRefInput.subjectId
  });
}

function assertExplicitConfirmation(
  confirmation: true
): void {
  if (confirmation !== true) {
    throw new WorkResumptionContractError(
      "EXPLICIT_USER_CONFIRMATION_REQUIRED"
    );
  }
}

export class WorkResumptionContractError extends Error {
  constructor(
    public readonly code:
      | "EXPLICIT_USER_CONFIRMATION_REQUIRED"
      | "COMMAND_CLAIM_MISMATCH"
      | "INVALID_COMMAND_TRANSITION"
  ) {
    super(code);
    this.name = "WorkResumptionContractError";
  }
}

import { z } from "zod";

import {
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION
} from "../crossSource/versions";

export const WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT =
  "work-artifact-attribution-store-v0.1" as const;
export const WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION =
  "work-artifact-attribution-schema-v0.1" as const;
export const WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION =
  "work-artifact-attribution-retention-30d-v0.1" as const;
export const WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS = 30;
export const MAX_WORK_ARTIFACT_ATTRIBUTION_DECISIONS = 1_000;
export const WORK_ARTIFACT_ATTRIBUTIONS_FILENAME =
  "artifact-attributions.json" as const;
const workArtifactAttributionTempFilenamePattern =
  /^artifact-attributions\.json\.[0-9]+\.[a-f0-9]{16}\.tmp$/;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const managedRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
export const artifactBindingIdSchema = z
  .string()
  .regex(/^binding_[a-f0-9]{32}$/);
export const artifactExecutionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
export const executesRelationIdSchema = z
  .string()
  .regex(/^relation_[a-f0-9]{32}$/);
export const workArtifactAttributionIdSchema = z
  .string()
  .regex(/^attribution_[a-f0-9]{32}$/);
const artifactIdSchema = z
  .string()
  .regex(/^artifact_[a-f0-9]{32}$/);
const artifactRelationIdSchema = z
  .string()
  .regex(/^artifact_relation_[a-f0-9]{32}$/);
const signalIdSchema = z.string().regex(/^sig_[a-f0-9]{32}$/);
const repositoryIdSchema = z.number().int().safe().positive();
const nativeObjectIdSchema = z.number().int().safe().positive();

export const githubCommitOidSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

export const githubCommitArtifactIdentitySchema = z
  .object({
    kind: z.literal("github_commit"),
    repositoryId: repositoryIdSchema,
    oid: githubCommitOidSchema
  })
  .strict();

export const githubPullRequestArtifactIdentitySchema = z
  .object({
    kind: z.literal("github_pull_request"),
    repositoryId: repositoryIdSchema,
    objectId: nativeObjectIdSchema,
    number: z.number().int().safe().positive()
  })
  .strict();

export const githubArtifactIdentitySchema = z.discriminatedUnion(
  "kind",
  [
    githubCommitArtifactIdentitySchema,
    githubPullRequestArtifactIdentitySchema
  ]
);

const attributionDecisionCoreSchema = z
  .object({
    action: z.enum(["attach", "detach"]),
    managedRunId: managedRunIdSchema,
    bindingId: artifactBindingIdSchema,
    executionId: artifactExecutionIdSchema,
    executesRelationId: executesRelationIdSchema,
    artifact: githubArtifactIdentitySchema,
    decidedAt: timestampSchema,
    decisionSource: z.literal("explicit_user"),
    supersedesAttributionId: workArtifactAttributionIdSchema.nullable()
  })
  .strict();

export const workArtifactAttributionDecisionSchema =
  attributionDecisionCoreSchema
    .extend({
      attributionId: workArtifactAttributionIdSchema
    })
    .strict()
    .superRefine((decision, context) => {
      const { attributionId: _attributionId, ...core } = decision;
      const parsedCore = attributionDecisionCoreSchema.safeParse(core);
      if (!parsedCore.success) return;
      if (
        decision.attributionId !==
        createWorkArtifactAttributionId(parsedCore.data)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attributionId"],
          message:
            "Artifact attribution ID does not match canonical content."
        });
      }
    });

const attributionStoreContentSchema = z
  .object({
    contract: z.literal(WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT),
    schemaVersion: z.literal(WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION),
    retentionPolicyVersion: z.literal(
      WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION
    ),
    revision: z.number().int().nonnegative(),
    prunedDecisionCount: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    decisions: z
      .array(workArtifactAttributionDecisionSchema)
      .max(MAX_WORK_ARTIFACT_ATTRIBUTION_DECISIONS)
  })
  .strict();

export const workArtifactAttributionStoreSchema =
  attributionStoreContentSchema
    .extend({ storeSha256: sha256Schema })
    .strict()
    .superRefine((store, context) => {
      if (
        store.decisions.some(
          (decision) =>
            !workArtifactAttributionDecisionSchema.safeParse(decision)
              .success
        )
      ) {
        return;
      }
      if (
        store.revision !==
        store.prunedDecisionCount + store.decisions.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revision"],
          message:
            "Artifact store revision must include retained and pruned decisions."
        });
      }

      const seen = new Map<string, WorkArtifactAttributionDecision>();
      const currentByArtifact = new Map<
        string,
        WorkArtifactAttributionDecision
      >();
      const retainedAttributionIds = new Set(
        store.decisions.map((decision) => decision.attributionId)
      );
      let previousTime = Number.NEGATIVE_INFINITY;
      for (const [index, decision] of store.decisions.entries()) {
        const decidedAt = Date.parse(decision.decidedAt);
        if (decidedAt < previousTime) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "decidedAt"],
            message:
              "Artifact attribution decisions must be chronological."
          });
        }
        previousTime = decidedAt;
        if (seen.has(decision.attributionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "attributionId"],
            message: "Artifact attribution IDs must be unique."
          });
        }

        const artifactKey = githubArtifactIdentityKey(decision.artifact);
        const previous = currentByArtifact.get(artifactKey);
        const expectedPredecessor = previous?.attributionId ?? null;
        const predecessorWasPruned =
          previous === undefined &&
          decision.supersedesAttributionId !== null &&
          store.prunedDecisionCount > 0 &&
          !retainedAttributionIds.has(
            decision.supersedesAttributionId
          );
        if (
          decision.supersedesAttributionId !== expectedPredecessor &&
          !predecessorWasPruned
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "decisions",
              index,
              "supersedesAttributionId"
            ],
            message:
              "An artifact decision must supersede the current exact artifact decision."
          });
        }
        if (
          decision.action === "detach" &&
          previous !== undefined &&
          (previous.action !== "attach" ||
            !sameArtifactProducer(previous, decision))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index],
            message:
              "A detach decision must preserve its attached producer identity."
          });
        }
        if (
          decision.action === "detach" &&
          previous === undefined &&
          !predecessorWasPruned
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decisions", index, "action"],
            message: "A detach decision must supersede an attachment."
          });
        }
        seen.set(decision.attributionId, decision);
        currentByArtifact.set(artifactKey, decision);
      }

      const last = store.decisions[store.decisions.length - 1];
      if (last && Date.parse(store.updatedAt) < Date.parse(last.decidedAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["updatedAt"],
          message:
            "Artifact store update time cannot precede its last decision."
        });
      }
      if (store.storeSha256 !== workArtifactAttributionStoreSha256(store)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Artifact attribution store hash is invalid."
        });
      }
    });

export const workArtifactMutationSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("attach"),
        managedRunId: managedRunIdSchema,
        bindingId: artifactBindingIdSchema,
        executionId: artifactExecutionIdSchema,
        artifactUrl: z
          .string()
          .min(1)
          .max(2_048)
          .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
        explicitUserConfirmation: z.literal(true)
      })
      .strict(),
    z
      .object({
        action: z.literal("detach"),
        attributionId: workArtifactAttributionIdSchema,
        explicitUserConfirmation: z.literal(true)
      })
      .strict()
  ]
);

const attributionLifecycleSchema = z
  .object({
    state: z.enum([
      "active",
      "superseded_by_detach",
      "superseded_by_reattribution"
    ]),
    supersededByAttributionId: workArtifactAttributionIdSchema.nullable()
  })
  .strict()
  .superRefine((lifecycle, context) => {
    if (
      (lifecycle.state === "active") !==
      (lifecycle.supersededByAttributionId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only an active attribution may omit a successor decision."
      });
    }
  });

const githubArtifactObservationSchema = z
  .object({
    status: z.enum([
      "current",
      "stale",
      "not_observed",
      "unavailable",
      "conflict"
    ]),
    sourceSnapshotSha256: sha256Schema.nullable(),
    signalIds: z.array(signalIdSchema).max(20),
    destinationUrl: z.null(),
    sourceUpdatedAt: timestampSchema.nullable(),
    completeness: z.enum(["complete", "truncated"]).nullable()
  })
  .strict()
  .superRefine((observation, context) => {
    const hasObservedIdentity =
      observation.status === "current" ||
      observation.status === "stale";
    if (hasObservedIdentity && observation.signalIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signalIds"],
        message:
          "Current or stale artifact observations require exact native signals."
      });
    }
    if (
      observation.status === "conflict" &&
      observation.signalIds.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signalIds"],
        message:
          "A conflicting artifact observation requires bounded native signals."
      });
    }
    if (
      observation.status !== "current" &&
      observation.status !== "stale" &&
      observation.status !== "conflict" &&
      observation.signalIds.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signalIds"],
        message:
          "Only observed or conflicting artifacts may retain exact native signals."
      });
    }
    const sourceAvailable = observation.status !== "unavailable";
    if (
      sourceAvailable !==
        (observation.sourceSnapshotSha256 !== null) ||
      sourceAvailable !== (observation.completeness !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Artifact observation status must match its source evidence."
      });
    }
  });

export const managedCodexArtifactRelationSchema = z
  .object({
    relationId: artifactRelationIdSchema,
    managedRunId: managedRunIdSchema,
    bindingId: artifactBindingIdSchema,
    executionId: artifactExecutionIdSchema,
    executesRelationId: executesRelationIdSchema,
    attributionId: workArtifactAttributionIdSchema,
    type: z.literal("produces"),
    authority: z.literal("user_configured"),
    artifactId: artifactIdSchema,
    artifact: githubArtifactIdentitySchema,
    attributionEvidence: z
      .object({
        decidedAt: timestampSchema,
        decisionSource: z.literal("explicit_user"),
        identityPolicyVersion: z.literal(
          GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION
        )
      })
      .strict(),
    attributionLifecycle: attributionLifecycleSchema,
    githubObservation: githubArtifactObservationSchema,
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((relation, context) => {
    const parsedArtifact = githubArtifactIdentitySchema.safeParse(
      relation.artifact
    );
    if (!parsedArtifact.success) return;
    if (
      relation.artifactId !==
      createGitHubArtifactId(parsedArtifact.data)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactId"],
        message: "Artifact ID does not match its exact native identity."
      });
    }
    if (
      relation.relationId !==
      createManagedCodexArtifactRelationId({
        attributionId: relation.attributionId,
        executionId: relation.executionId,
        artifactId: relation.artifactId
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationId"],
        message: "Artifact relation ID does not match canonical content."
      });
    }
    if (
      relation.artifact.kind === "github_commit" &&
      (relation.githubObservation.status === "current" ||
        relation.githubObservation.status === "stale")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubObservation", "status"],
        message:
          "The current GitHub adapter cannot claim an exact commit observation."
      });
    }
  });

const artifactProjectionContentSchema = z
  .object({
    contract: z.literal(
      MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT
    ),
    schemaVersion: z.literal(ARTIFACT_RELATION_SCHEMA_VERSION),
    resolverVersion: z.literal(
      MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION
    ),
    evidencePolicyVersion: z.literal(
      ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION
    ),
    identityPolicyVersion: z.literal(
      GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION
    ),
    asOf: timestampSchema,
    workRelationProjectionSha256: sha256Schema,
    attributionStoreRevision: z.number().int().nonnegative(),
    attributionStoreSha256: sha256Schema,
    githubBatchSha256: sha256Schema.nullable(),
    githubSourceSnapshotSha256: sha256Schema.nullable(),
    totalAttachDecisionCount: z.number().int().nonnegative(),
    unresolvedAttributionCount: z.number().int().nonnegative(),
    relations: z
      .array(managedCodexArtifactRelationSchema)
      .max(MAX_WORK_ARTIFACT_ATTRIBUTION_DECISIONS),
    inputSha256: sha256Schema,
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const managedCodexArtifactRelationProjectionSchema =
  artifactProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.totalAttachDecisionCount !==
        projection.relations.length +
          projection.unresolvedAttributionCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Artifact relation projection counts are incoherent."
        });
      }
      const relationIds = new Set<string>();
      const attributionIds = new Set<string>();
      const activeArtifacts = new Set<string>();
      for (const relation of projection.relations) {
        relationIds.add(relation.relationId);
        attributionIds.add(relation.attributionId);
        if (relation.attributionLifecycle.state === "active") {
          activeArtifacts.add(relation.artifactId);
        }
      }
      if (
        relationIds.size !== projection.relations.length ||
        attributionIds.size !== projection.relations.length ||
        activeArtifacts.size !==
          projection.relations.filter(
            (relation) =>
              relation.attributionLifecycle.state === "active"
          ).length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Artifact relation, attribution, and active producer identities must be unique."
        });
      }
      if (
        projection.projectionSha256 !==
        managedCodexArtifactRelationProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Artifact relation projection hash is invalid."
        });
      }
    });

export type GitHubArtifactIdentity = z.infer<
  typeof githubArtifactIdentitySchema
>;
export type WorkArtifactAttributionDecision = z.infer<
  typeof workArtifactAttributionDecisionSchema
>;
export type WorkArtifactAttributionStore = z.infer<
  typeof workArtifactAttributionStoreSchema
>;
export type WorkArtifactMutation = z.infer<
  typeof workArtifactMutationSchema
>;
export type ManagedCodexArtifactRelation = z.infer<
  typeof managedCodexArtifactRelationSchema
>;
export type ManagedCodexArtifactRelationProjection = z.infer<
  typeof managedCodexArtifactRelationProjectionSchema
>;

export function githubArtifactIdentityKey(
  artifactInput: GitHubArtifactIdentity
): string {
  const artifact = githubArtifactIdentitySchema.parse(artifactInput);
  return artifact.kind === "github_commit"
    ? `github:commit:${artifact.repositoryId}:${artifact.oid}`
    : `github:pull_request:${artifact.repositoryId}:${artifact.objectId}`;
}

export function isWorkArtifactAttributionTempFilename(
  filename: string
): boolean {
  return workArtifactAttributionTempFilenamePattern.test(filename);
}

export function createGitHubArtifactId(
  artifactInput: GitHubArtifactIdentity
): string {
  const artifact = githubArtifactIdentitySchema.parse(artifactInput);
  return runtimeStableId(
    "artifact",
    GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    artifact.kind === "github_commit"
      ? artifact
      : {
          kind: artifact.kind,
          repositoryId: artifact.repositoryId,
          objectId: artifact.objectId
        }
  );
}

export function createWorkArtifactAttributionId(
  coreInput: z.infer<typeof attributionDecisionCoreSchema>
): string {
  return runtimeStableId(
    "attribution",
    WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
    attributionDecisionCoreSchema.parse(coreInput)
  );
}

export function createManagedCodexArtifactRelationId(input: {
  attributionId: string;
  executionId: string;
  artifactId: string;
}): string {
  return runtimeStableId(
    "artifact_relation",
    MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    input
  );
}

export function sealWorkArtifactAttributionStore(
  content: z.infer<typeof attributionStoreContentSchema>
): WorkArtifactAttributionStore {
  return workArtifactAttributionStoreSchema.parse({
    ...content,
    storeSha256: runtimeSha256(content)
  });
}

export function workArtifactAttributionStoreSha256(
  store: WorkArtifactAttributionStore
): string {
  const { storeSha256: _storeSha256, ...content } = store;
  return runtimeSha256(content);
}

export function sealManagedCodexArtifactRelationProjection(
  content: z.infer<typeof artifactProjectionContentSchema>
): ManagedCodexArtifactRelationProjection {
  return managedCodexArtifactRelationProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function managedCodexArtifactRelationProjectionSha256(
  projection: ManagedCodexArtifactRelationProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    projection: content
  });
}

function sameArtifactProducer(
  left: WorkArtifactAttributionDecision,
  right: WorkArtifactAttributionDecision
): boolean {
  return (
    left.managedRunId === right.managedRunId &&
    left.bindingId === right.bindingId &&
    left.executionId === right.executionId &&
    left.executesRelationId === right.executesRelationId
  );
}

import { z } from "zod";

import {
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../crossSource/versions";
import { runtimeSha256 } from "../crossSource/canonicalHash";

export const MAX_MANAGED_CODEX_WORK_RELATION_RUNS = 100;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const managedRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
const bindingIdSchema = z.string().regex(/^binding_[a-f0-9]{32}$/);
const executionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const relationIdSchema = z
  .string()
  .regex(/^relation_[a-f0-9]{32}$/);
const signalIdSchema = z.string().regex(/^sig_[a-f0-9]{32}$/);
const mappingDecisionIdSchema = z
  .string()
  .regex(/^mapping_[a-f0-9]{32}$/);
const projectIdSchema = z
  .string()
  .regex(/^project_[a-f0-9]{32}$/);

export const managedCodexWorkRelationConflictCodeSchema = z.enum([
  "GITHUB_IDENTITY_CONFLICT",
  "PROJECT_MISMATCH"
]);

export const managedCodexWorkRelationRunStatusSchema = z.enum([
  "resolved",
  "binding_not_found",
  "binding_not_bind",
  "execution_mismatch",
  "unsupported_task_source",
  "invalid_github_subject"
]);

const relationEndpointSchema = z
  .object({
    kind: z.enum(["execution", "work_item"]),
    source: z.enum(["codex", "github"]),
    subjectId: z.string().min(1).max(240)
  })
  .strict();

const bindingEvidenceSchema = z
  .object({
    bindingId: bindingIdSchema,
    boundAt: timestampSchema,
    decisionSource: z.literal("explicit_user"),
    bindingState: z.enum([
      "active",
      "superseded_by_unbind",
      "superseded_by_rebind"
    ]),
    supersededByBindingId: bindingIdSchema.nullable()
  })
  .strict();

const githubObservationSchema = z
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
    objectType: z.enum(["issue", "pull_request"]).nullable(),
    taskKind: z
      .enum([
        "assigned_issue",
        "review_requested_pull_request",
        "authored_pull_request"
      ])
      .nullable(),
    number: z.number().int().positive().nullable(),
    destinationUrl: z.string().url().nullable(),
    sourceUpdatedAt: timestampSchema.nullable(),
    completeness: z
      .enum(["complete", "truncated", "unknown"])
      .nullable()
  })
  .strict()
  .superRefine((observation, context) => {
    const hasIdentity =
      observation.objectType !== null &&
      observation.taskKind !== null &&
      observation.number !== null;
    if (
      (observation.status === "current" ||
        observation.status === "stale") !== hasIdentity
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Current or stale GitHub observations require a complete native identity."
      });
    }
    if (
      observation.status === "unavailable" &&
      (observation.sourceSnapshotSha256 !== null ||
        observation.signalIds.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Unavailable GitHub observations cannot claim snapshot evidence."
      });
    }
  });

const projectAlignmentSchema = z
  .object({
    status: z.enum([
      "aligned",
      "unmapped",
      "conflict",
      "unavailable"
    ]),
    projectId: projectIdSchema.nullable(),
    codexMappingDecisionId: mappingDecisionIdSchema.nullable(),
    githubMappingDecisionId: mappingDecisionIdSchema.nullable()
  })
  .strict()
  .superRefine((alignment, context) => {
    if (
      (alignment.status === "aligned") !==
      (alignment.projectId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "Only aligned relations may expose a resolved project."
      });
    }
  });

export const managedCodexWorkRelationSchema = z
  .object({
    relationId: relationIdSchema,
    managedRunIds: z.array(managedRunIdSchema).min(1).max(100),
    bindingId: bindingIdSchema,
    type: z.literal("executes"),
    authority: z.literal("user_configured"),
    from: relationEndpointSchema,
    to: relationEndpointSchema,
    bindingEvidence: bindingEvidenceSchema,
    githubObservation: githubObservationSchema,
    projectAlignment: projectAlignmentSchema,
    identityStatus: z.enum(["resolved", "conflict"]),
    conflictCodes: z
      .array(managedCodexWorkRelationConflictCodeSchema)
      .max(10),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((relation, context) => {
    if (
      relation.bindingEvidence.bindingId !== relation.bindingId ||
      new Set(relation.managedRunIds).size !==
        relation.managedRunIds.length ||
      new Set(relation.conflictCodes).size !==
        relation.conflictCodes.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Managed work relation identity and evidence must be internally coherent."
      });
    }
    if (
      relation.from.kind !== "execution" ||
      relation.from.source !== "codex" ||
      !executionIdSchema.safeParse(relation.from.subjectId).success ||
      relation.to.kind !== "work_item" ||
      relation.to.source !== "github" ||
      !/^github:object:[1-9][0-9]*$/.test(relation.to.subjectId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Managed work relation endpoints are incoherent."
      });
    }
    const identityConflict = relation.conflictCodes.includes(
      "GITHUB_IDENTITY_CONFLICT"
    );
    if (
      (relation.identityStatus === "conflict") !== identityConflict
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityStatus"],
        message: "Identity status must match its conflict evidence."
      });
    }
    const projectConflict = relation.conflictCodes.includes(
      "PROJECT_MISMATCH"
    );
    if (
      (relation.projectAlignment.status === "conflict") !==
      projectConflict
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectAlignment"],
        message: "Project conflict state must match its conflict evidence."
      });
    }
  });

export const managedCodexWorkRelationRunResolutionSchema = z
  .object({
    managedRunId: managedRunIdSchema,
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    status: managedCodexWorkRelationRunStatusSchema,
    relationId: relationIdSchema.nullable()
  })
  .strict()
  .superRefine((resolution, context) => {
    if (
      (resolution.status === "resolved") !==
      (resolution.relationId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationId"],
        message: "Only resolved runs may reference a relation."
      });
    }
  });

const relationProjectionContentSchema = z
  .object({
    contract: z.literal(
      MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT
    ),
    schemaVersion: z.literal(WORK_RELATION_SCHEMA_VERSION),
    resolverVersion: z.literal(
      MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION
    ),
    evidencePolicyVersion: z.literal(
      WORK_RELATION_EVIDENCE_POLICY_VERSION
    ),
    asOf: timestampSchema,
    managedSourceRevision: z.number().int().nonnegative(),
    managedGeneratedAt: timestampSchema,
    bindingStoreRevision: z.number().int().nonnegative(),
    bindingStoreSha256: sha256Schema,
    contextRegistrySha256: sha256Schema.nullable(),
    githubBatchSha256: sha256Schema.nullable(),
    githubSourceSnapshotSha256: sha256Schema.nullable(),
    totalManagedRunCount: z.number().int().nonnegative(),
    omittedManagedRunCount: z.number().int().nonnegative(),
    relations: z
      .array(managedCodexWorkRelationSchema)
      .max(MAX_MANAGED_CODEX_WORK_RELATION_RUNS),
    runResolutions: z
      .array(managedCodexWorkRelationRunResolutionSchema)
      .max(MAX_MANAGED_CODEX_WORK_RELATION_RUNS),
    inputSha256: sha256Schema,
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const managedCodexWorkRelationProjectionSchema =
  relationProjectionContentSchema
    .extend({
      projectionSha256: sha256Schema
    })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.totalManagedRunCount !==
          projection.omittedManagedRunCount +
            projection.runResolutions.length ||
        projection.projectionSha256 !==
          managedCodexWorkRelationProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Managed Codex work relation projection is incoherent."
        });
      }
      const relationIds = new Set(
        projection.relations.map((relation) => relation.relationId)
      );
      const relationsById = new Map(
        projection.relations.map((relation) => [
          relation.relationId,
          relation
        ])
      );
      const bindingIds = new Set(
        projection.relations.map((relation) => relation.bindingId)
      );
      const managedRunIds = new Set(
        projection.runResolutions.map(
          (resolution) => resolution.managedRunId
        )
      );
      if (
        relationIds.size !== projection.relations.length ||
        bindingIds.size !== projection.relations.length ||
        managedRunIds.size !== projection.runResolutions.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Relation, binding, and managed run identities must be unique."
        });
      }
      const resolutionsByRunId = new Map(
        projection.runResolutions.map((resolution) => [
          resolution.managedRunId,
          resolution
        ])
      );
      for (const resolution of projection.runResolutions) {
        if (resolution.relationId === null) continue;
        const relation = relationsById.get(resolution.relationId);
        if (
          !relation ||
          relation.bindingId !== resolution.bindingId ||
          relation.from.subjectId !== resolution.executionId ||
          !relation.managedRunIds.includes(resolution.managedRunId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["runResolutions"],
            message:
              "Run resolution does not match its relation identity and evidence."
          });
        }
      }
      for (const relation of projection.relations) {
        if (
          relation.managedRunIds.some((managedRunId) => {
            const resolution = resolutionsByRunId.get(managedRunId);
            return (
              !resolution ||
              resolution.status !== "resolved" ||
              resolution.relationId !== relation.relationId
            );
          })
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["relations"],
            message:
              "Relation members must have matching resolved run records."
          });
        }
      }
    });

export type ManagedCodexWorkRelation = z.infer<
  typeof managedCodexWorkRelationSchema
>;
export type ManagedCodexWorkRelationRunResolution = z.infer<
  typeof managedCodexWorkRelationRunResolutionSchema
>;
export type ManagedCodexWorkRelationProjection = z.infer<
  typeof managedCodexWorkRelationProjectionSchema
>;

export function sealManagedCodexWorkRelationProjection(
  content: z.infer<typeof relationProjectionContentSchema>
): ManagedCodexWorkRelationProjection {
  return managedCodexWorkRelationProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function managedCodexWorkRelationProjectionSha256(
  projection: ManagedCodexWorkRelationProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } =
    projection;
  return runtimeSha256({
    domain: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    projection: content
  });
}

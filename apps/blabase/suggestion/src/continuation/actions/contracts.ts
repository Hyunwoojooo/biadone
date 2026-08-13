import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../../crossSource/canonicalHash";
import {
  CONTINUATION_SETUP_ACTION_API_CONTRACT,
  CONTINUATION_SETUP_ACTION_CAPABILITY,
  CONTINUATION_SETUP_ACTION_DESTINATION,
  CONTINUATION_SETUP_ACTION_EVENT_CONTRACT,
  CONTINUATION_SETUP_ACTION_NAVIGATE_TO,
  CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS,
  CONTINUATION_SETUP_ACTION_OFFER_CONTRACT,
  CONTINUATION_SETUP_ACTION_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_RETENTION_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_REVALIDATION_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_SCHEMA_VERSION,
  CONTINUATION_SETUP_ACTION_STORE_CONTRACT,
  CONTINUATION_SETUP_ACTION_TOMBSTONE_RETENTION_MS,
  CONTINUATION_SETUP_ACTION_TTL_MS
} from "./versions";
import {
  continuationSetupActionAuthKeyId,
  continuationSetupActionAuthKeyIdSchema,
  continuationSetupActionAuthoritySchema,
  verifyContinuationSetupActionAuthorityForSecret
} from "./authority";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const installationSecretSchema = sha256Schema;
const timestampSchema = z.string().datetime().refine(isCanonicalTimestamp, {
  message: "Timestamp must use canonical UTC ISO form"
});
const itemRefSchema = z
  .string()
  .regex(/^item_ref_[A-Za-z0-9_-]{22,128}$/u);
const privateTargetRefSchema = z
  .string()
  .regex(/^private_target_[a-f0-9]{32}$/u);

export const continuationSetupActionOfferIdSchema = z
  .string()
  .regex(/^continuation_setup_offer_[a-f0-9]{64}$/u);

const codexSourceBatchBindingSchema = z
  .object({
    source: z.literal("codex"),
    batchSha256: sha256Schema,
    snapshotSha256: sha256Schema.nullable()
  })
  .strict();

const githubSourceBatchBindingSchema = z
  .object({
    source: z.literal("github"),
    batchSha256: sha256Schema,
    snapshotSha256: sha256Schema.nullable()
  })
  .strict();

export const continuationSetupActionIssuanceAuditSchema = z
  .object({
    candidateSha256: sha256Schema,
    privateTargetRef: privateTargetRefSchema,
    generatedAt: timestampSchema,
    continuationResolvedResultSha256: sha256Schema,
    continuationDecisionResultSha256: sha256Schema,
    continuationDecisionSemanticResultSha256: sha256Schema,
    continuationResolutionInputSha256: sha256Schema,
    identityResultSha256: sha256Schema,
    derivationResultSha256: sha256Schema,
    scoringResultSha256: sha256Schema,
    registrySha256: sha256Schema,
    sourceBatches: z.tuple([
      codexSourceBatchBindingSchema,
      githubSourceBatchBindingSchema
    ])
  })
  .strict();

export const continuationSetupActionBindingSchema = z
  .object({
    authority: continuationSetupActionAuthoritySchema,
    issuanceAudit: continuationSetupActionIssuanceAuditSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Date.parse(value.issuanceAudit.generatedAt) >=
      Date.parse(value.authority.candidateExpiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authority", "candidateExpiresAt"],
        message: "Setup action candidate must be live after its exact as-of"
      });
    }
  });

export const continuationSetupActionIssueInputSchema = z
  .object({
    itemRef: itemRefSchema,
    explicitUserAction: z.literal(true)
  })
  .strict();

export const continuationSetupActionOpenInputSchema = z
  .object({
    offerId: continuationSetupActionOfferIdSchema,
    explicitUserAction: z.literal(true)
  })
  .strict();

export const continuationSetupActionIssueResponseSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_API_CONTRACT),
    status: z.literal("issued"),
    offerId: continuationSetupActionOfferIdSchema,
    expiresAt: timestampSchema
  })
  .strict();

export const continuationSetupActionOpenResponseSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_API_CONTRACT),
    status: z.literal("opened"),
    destination: z.literal(CONTINUATION_SETUP_ACTION_DESTINATION),
    navigateTo: z.literal(CONTINUATION_SETUP_ACTION_NAVIGATE_TO)
  })
  .strict();

export const continuationSetupActionErrorCodeSchema = z.enum([
  "SETUP_ACTION_LOCAL_ONLY",
  "INVALID_ORIGIN",
  "DISABLED",
  "AUTH_UNAVAILABLE",
  "UNAUTHORIZED",
  "INVALID_CONTENT_TYPE",
  "INVALID_CONTENT_LENGTH",
  "INVALID_REQUEST",
  "OFFER_NOT_CURRENT",
  "CAPTURE_UNAVAILABLE",
  "FAILED"
]);

export const continuationSetupActionErrorResponseSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_API_CONTRACT),
    status: z.literal("error"),
    code: continuationSetupActionErrorCodeSchema
  })
  .strict();

const continuationSetupActionOfferContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_OFFER_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_SETUP_ACTION_SCHEMA_VERSION),
    actionPolicyVersion: z.literal(
      CONTINUATION_SETUP_ACTION_POLICY_VERSION
    ),
    revalidationPolicyVersion: z.literal(
      CONTINUATION_SETUP_ACTION_REVALIDATION_POLICY_VERSION
    ),
    authKeyId: continuationSetupActionAuthKeyIdSchema,
    offerId: continuationSetupActionOfferIdSchema,
    capability: z.literal(CONTINUATION_SETUP_ACTION_CAPABILITY),
    destination: z.literal(CONTINUATION_SETUP_ACTION_DESTINATION),
    navigateTo: z.literal(CONTINUATION_SETUP_ACTION_NAVIGATE_TO),
    binding: continuationSetupActionBindingSchema,
    bindingSha256: sha256Schema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    explicitUserActionRequired: z.literal(true),
    automaticExecutionAllowed: z.literal(false),
    externalMutationAllowed: z.literal(false),
    oneTimeUse: z.literal(true)
  })
  .strict();

export const continuationSetupActionOfferContentSchema =
  continuationSetupActionOfferContentObjectSchema.superRefine(
    refineContinuationSetupActionOffer
  );

export const continuationSetupActionOfferSchema =
  continuationSetupActionOfferContentObjectSchema
    .extend({ offerSha256: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      refineContinuationSetupActionOffer(value, context);
      const { offerSha256: _offerSha256, ...content } = value;
      if (value.offerSha256 !== continuationSetupActionOfferSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offerSha256"],
          message: "Setup action offer hash mismatch"
        });
      }
    });

const terminalReasonSchema = z.enum([
  "consumed",
  "superseded",
  "expired",
  "revalidation_failed"
]);

const continuationSetupActionEventContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_EVENT_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_SETUP_ACTION_SCHEMA_VERSION),
    authKeyId: continuationSetupActionAuthKeyIdSchema,
    sequence: z.number().int().positive(),
    previousEventSha256: sha256Schema.nullable(),
    eventType: z.enum(["issued", "terminal"]),
    occurredAt: timestampSchema,
    offerId: continuationSetupActionOfferIdSchema,
    itemRef: itemRefSchema,
    offer: continuationSetupActionOfferSchema.nullable(),
    terminalReason: terminalReasonSchema.nullable(),
    retainedUntil: timestampSchema.nullable()
  })
  .strict();

export const continuationSetupActionEventSchema =
  continuationSetupActionEventContentObjectSchema
    .extend({
      eventSha256: sha256Schema,
      eventHmac: sha256Schema
    })
    .strict()
    .superRefine((value, context) => {
      refineContinuationSetupActionEvent(value, context);
      const {
        eventSha256: _eventSha256,
        eventHmac: _eventHmac,
        ...content
      } = value;
      if (value.eventSha256 !== continuationSetupActionEventSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["eventSha256"],
          message: "Setup action event hash mismatch"
        });
      }
    });

const continuationSetupActionStoreContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_STORE_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_SETUP_ACTION_SCHEMA_VERSION),
    authKeyId: continuationSetupActionAuthKeyIdSchema,
    retentionPolicyVersion: z.literal(
      CONTINUATION_SETUP_ACTION_RETENTION_POLICY_VERSION
    ),
    revision: z.number().int().nonnegative(),
    anchorSequence: z.number().int().nonnegative(),
    anchorEventSha256: sha256Schema.nullable(),
    anchorOccurredAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    events: z
      .array(continuationSetupActionEventSchema)
      .max(CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS)
  })
  .strict();

export const continuationSetupActionStoreSchema =
  continuationSetupActionStoreContentObjectSchema
    .extend({
      storeSha256: sha256Schema,
      storeHmac: sha256Schema
    })
    .strict()
    .superRefine((value, context) => {
      refineContinuationSetupActionStore(value, context);
      const {
        storeSha256: _storeSha256,
        storeHmac: _storeHmac,
        ...content
      } = value;
      if (value.storeSha256 !== continuationSetupActionStoreSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Setup action store hash mismatch"
        });
      }
    });

export type ContinuationSetupActionBinding = z.infer<
  typeof continuationSetupActionBindingSchema
>;
export type ContinuationSetupActionIssuanceAudit = z.infer<
  typeof continuationSetupActionIssuanceAuditSchema
>;
export type ContinuationSetupActionIssueInput = z.infer<
  typeof continuationSetupActionIssueInputSchema
>;
export type ContinuationSetupActionOpenInput = z.infer<
  typeof continuationSetupActionOpenInputSchema
>;
export type ContinuationSetupActionIssueResponse = z.infer<
  typeof continuationSetupActionIssueResponseSchema
>;
export type ContinuationSetupActionOpenResponse = z.infer<
  typeof continuationSetupActionOpenResponseSchema
>;
export type ContinuationSetupActionErrorCode = z.infer<
  typeof continuationSetupActionErrorCodeSchema
>;
export type ContinuationSetupActionErrorResponse = z.infer<
  typeof continuationSetupActionErrorResponseSchema
>;
export type ContinuationSetupActionOfferContent = z.infer<
  typeof continuationSetupActionOfferContentSchema
>;
export type ContinuationSetupActionOffer = z.infer<
  typeof continuationSetupActionOfferSchema
>;
export type ContinuationSetupActionEvent = z.infer<
  typeof continuationSetupActionEventSchema
>;
export type ContinuationSetupActionStore = z.infer<
  typeof continuationSetupActionStoreSchema
>;

export function createContinuationSetupActionOffer(input: {
  binding: ContinuationSetupActionBinding;
  issuedAt: string;
  offerId?: string;
}): ContinuationSetupActionOffer {
  const binding = continuationSetupActionBindingSchema.parse(input.binding);
  const issuedAt = timestampSchema.parse(input.issuedAt);
  const expiresAt = new Date(
    Math.min(
      Date.parse(issuedAt) + CONTINUATION_SETUP_ACTION_TTL_MS,
      Date.parse(binding.authority.candidateExpiresAt)
    )
  ).toISOString();
  const content = continuationSetupActionOfferContentSchema.parse({
    contract: CONTINUATION_SETUP_ACTION_OFFER_CONTRACT,
    schemaVersion: CONTINUATION_SETUP_ACTION_SCHEMA_VERSION,
    actionPolicyVersion: CONTINUATION_SETUP_ACTION_POLICY_VERSION,
    revalidationPolicyVersion:
      CONTINUATION_SETUP_ACTION_REVALIDATION_POLICY_VERSION,
    authKeyId: binding.authority.authKeyId,
    offerId:
      input.offerId ??
      `continuation_setup_offer_${randomBytes(32).toString("hex")}`,
    capability: CONTINUATION_SETUP_ACTION_CAPABILITY,
    destination: CONTINUATION_SETUP_ACTION_DESTINATION,
    navigateTo: CONTINUATION_SETUP_ACTION_NAVIGATE_TO,
    binding,
    bindingSha256: continuationSetupActionBindingSha256(binding),
    issuedAt,
    expiresAt,
    explicitUserActionRequired: true,
    automaticExecutionAllowed: false,
    externalMutationAllowed: false,
    oneTimeUse: true
  });
  return continuationSetupActionOfferSchema.parse({
    ...content,
    offerSha256: continuationSetupActionOfferSha256(content)
  });
}

export function createEmptyContinuationSetupActionStore(input: {
  createdAt: string;
  installationSecret: string;
  authKeyId: string;
}): ContinuationSetupActionStore {
  const createdAt = timestampSchema.parse(input.createdAt);
  if (
    input.authKeyId !==
    continuationSetupActionAuthKeyId(input.installationSecret)
  ) {
    throw new TypeError("Setup action store key namespace mismatch");
  }
  return sealContinuationSetupActionStore(
    {
      contract: CONTINUATION_SETUP_ACTION_STORE_CONTRACT,
      schemaVersion: CONTINUATION_SETUP_ACTION_SCHEMA_VERSION,
      authKeyId: input.authKeyId,
      retentionPolicyVersion:
        CONTINUATION_SETUP_ACTION_RETENTION_POLICY_VERSION,
      revision: 0,
      anchorSequence: 0,
      anchorEventSha256: null,
      anchorOccurredAt: null,
      createdAt,
      updatedAt: createdAt,
      events: []
    },
    input.installationSecret
  );
}

export function appendContinuationSetupActionEvent(input: {
  store: ContinuationSetupActionStore;
  installationSecret: string;
  event:
    | {
        eventType: "issued";
        occurredAt: string;
        offer: ContinuationSetupActionOffer;
      }
    | {
        eventType: "terminal";
        occurredAt: string;
        offerId: string;
        itemRef: string;
        terminalReason: z.infer<typeof terminalReasonSchema>;
      };
}): ContinuationSetupActionStore {
  const verified = verifyContinuationSetupActionStore(
    input.store,
    input.installationSecret
  );
  if (verified === null) {
    throw new TypeError("Continuation Setup action store is unauthenticated");
  }
  const previous = verified.events.at(-1) ?? null;
  const sequence = verified.revision + 1;
  const occurredAt = timestampSchema.parse(input.event.occurredAt);
  const previousOccurredAt =
    previous?.occurredAt ??
    verified.anchorOccurredAt ??
    verified.createdAt;
  if (Date.parse(occurredAt) < Date.parse(previousOccurredAt)) {
    throw new TypeError("Continuation Setup action event time regressed");
  }
  const eventContent =
    input.event.eventType === "issued"
      ? continuationSetupActionEventContentObjectSchema.parse({
          contract: CONTINUATION_SETUP_ACTION_EVENT_CONTRACT,
          schemaVersion: CONTINUATION_SETUP_ACTION_SCHEMA_VERSION,
          authKeyId: verified.authKeyId,
          sequence,
          previousEventSha256:
            previous?.eventSha256 ?? verified.anchorEventSha256,
          eventType: "issued",
          occurredAt,
          offerId: input.event.offer.offerId,
          itemRef: input.event.offer.binding.authority.itemRef,
          offer: input.event.offer,
          terminalReason: null,
          retainedUntil: null
        })
      : continuationSetupActionEventContentObjectSchema.parse({
          contract: CONTINUATION_SETUP_ACTION_EVENT_CONTRACT,
          schemaVersion: CONTINUATION_SETUP_ACTION_SCHEMA_VERSION,
          authKeyId: verified.authKeyId,
          sequence,
          previousEventSha256:
            previous?.eventSha256 ?? verified.anchorEventSha256,
          eventType: "terminal",
          occurredAt,
          offerId: input.event.offerId,
          itemRef: input.event.itemRef,
          offer: null,
          terminalReason: input.event.terminalReason,
          retainedUntil: terminalRetainedUntil(
            verified,
            input.event.offerId,
            input.event.terminalReason,
            occurredAt
          )
        });
  const eventSha256 = continuationSetupActionEventSha256(eventContent);
  const event = continuationSetupActionEventSchema.parse({
    ...eventContent,
    eventSha256,
    eventHmac: continuationSetupActionHmac(
      "continuation-setup-action-event-hmac-v0.2",
      eventSha256,
      input.installationSecret
    )
  });
  return sealContinuationSetupActionStore(
    {
      contract: verified.contract,
      schemaVersion: verified.schemaVersion,
      authKeyId: verified.authKeyId,
      retentionPolicyVersion: verified.retentionPolicyVersion,
      revision: sequence,
      anchorSequence: verified.anchorSequence,
      anchorEventSha256: verified.anchorEventSha256,
      anchorOccurredAt: verified.anchorOccurredAt,
      createdAt: verified.createdAt,
      updatedAt: occurredAt,
      events: [...verified.events, event]
    },
    input.installationSecret
  );
}

export function continuationSetupActionBindingSha256(
  binding: ContinuationSetupActionBinding
): string {
  return runtimeSha256({
    domain: "continuation-setup-action-binding-hash-v0.2",
    binding: continuationSetupActionBindingSchema.parse(binding)
  });
}

function terminalRetainedUntil(
  store: ContinuationSetupActionStore,
  offerId: string,
  terminalReason: z.infer<typeof terminalReasonSchema>,
  occurredAt: string
): string {
  const offer = activeOfferFromEvents(store.events, offerId);
  if (offer === null) {
    throw new TypeError("Setup action terminal event lacks an active offer");
  }
  const retainedFrom =
    terminalReason === "expired" ? offer.expiresAt : occurredAt;
  return new Date(
    Date.parse(retainedFrom) +
      CONTINUATION_SETUP_ACTION_TOMBSTONE_RETENTION_MS
  ).toISOString();
}

function activeOfferFromEvents(
  events: ContinuationSetupActionEvent[],
  offerId: string
): ContinuationSetupActionOffer | null {
  let active: ContinuationSetupActionOffer | null = null;
  for (const event of events) {
    if (event.offerId !== offerId) continue;
    active =
      event.eventType === "issued" && event.offer !== null
        ? event.offer
        : null;
  }
  return active;
}

export function verifyContinuationSetupActionBindingForSecret(
  bindingInput: unknown,
  installationSecret: string
): bindingInput is ContinuationSetupActionBinding {
  const binding = continuationSetupActionBindingSchema.safeParse(bindingInput);
  return (
    binding.success &&
    verifyContinuationSetupActionAuthorityForSecret(
      binding.data.authority,
      installationSecret
    )
  );
}

export function compactContinuationSetupActionStore(input: {
  store: ContinuationSetupActionStore;
  installationSecret: string;
  asOf: string;
}): ContinuationSetupActionStore {
  const verified = verifyContinuationSetupActionStore(
    input.store,
    input.installationSecret
  );
  if (verified === null) {
    throw new TypeError("Continuation Setup action store is unauthenticated");
  }
  const asOf = timestampSchema.parse(input.asOf);
  let pruneThrough = -1;
  const open = new Set<string>();
  for (const [index, event] of verified.events.entries()) {
    if (event.eventType === "issued") {
      open.add(event.offerId);
      continue;
    }
    if (
      event.retainedUntil === null ||
      Date.parse(event.retainedUntil) > Date.parse(asOf)
    ) {
      break;
    }
    open.delete(event.offerId);
    if (open.size === 0) pruneThrough = index;
  }
  if (pruneThrough < 0) return verified;
  const anchor = verified.events[pruneThrough]!;
  return sealContinuationSetupActionStore(
    {
      contract: verified.contract,
      schemaVersion: verified.schemaVersion,
      authKeyId: verified.authKeyId,
      retentionPolicyVersion: verified.retentionPolicyVersion,
      revision: verified.revision,
      anchorSequence: anchor.sequence,
      anchorEventSha256: anchor.eventSha256,
      anchorOccurredAt: anchor.occurredAt,
      createdAt: verified.createdAt,
      updatedAt: verified.updatedAt,
      events: verified.events.slice(pruneThrough + 1)
    },
    input.installationSecret
  );
}

export function continuationSetupActionOfferSha256(
  offer:
    | ContinuationSetupActionOffer
    | ContinuationSetupActionOfferContent
): string {
  const { offerSha256: _offerSha256, ...content } =
    offer as ContinuationSetupActionOffer;
  return runtimeSha256({
    domain: "continuation-setup-action-offer-hash-v0.2",
    offer: content
  });
}

export function verifyContinuationSetupActionStore(
  input: unknown,
  installationSecret: string
): ContinuationSetupActionStore | null {
  const secret = installationSecretSchema.safeParse(installationSecret);
  if (!secret.success) return null;
  const parsed = continuationSetupActionStoreSchema.safeParse(input);
  if (!parsed.success) return null;
  if (
    parsed.data.authKeyId !==
    continuationSetupActionAuthKeyId(secret.data)
  ) {
    return null;
  }
  for (const event of parsed.data.events) {
    const expected = continuationSetupActionHmac(
      "continuation-setup-action-event-hmac-v0.2",
      event.eventSha256,
      secret.data
    );
    if (!safeHexEqual(event.eventHmac, expected)) return null;
  }
  const expectedStoreHmac = continuationSetupActionHmac(
    "continuation-setup-action-store-hmac-v0.2",
    parsed.data.storeSha256,
    secret.data
  );
  if (!safeHexEqual(parsed.data.storeHmac, expectedStoreHmac)) return null;
  return parsed.data;
}

function sealContinuationSetupActionStore(
  content: z.infer<typeof continuationSetupActionStoreContentObjectSchema>,
  installationSecret: string
): ContinuationSetupActionStore {
  const secret = installationSecretSchema.parse(installationSecret);
  const parsed = continuationSetupActionStoreContentObjectSchema.parse(content);
  if (parsed.authKeyId !== continuationSetupActionAuthKeyId(secret)) {
    throw new TypeError("Setup action store key namespace mismatch");
  }
  const storeSha256 = continuationSetupActionStoreSha256(parsed);
  return continuationSetupActionStoreSchema.parse({
    ...parsed,
    storeSha256,
    storeHmac: continuationSetupActionHmac(
      "continuation-setup-action-store-hmac-v0.2",
      storeSha256,
      secret
    )
  });
}

function continuationSetupActionEventSha256(value: unknown): string {
  return runtimeSha256({
    domain: "continuation-setup-action-event-hash-v0.2",
    event: value
  });
}

function continuationSetupActionStoreSha256(value: unknown): string {
  return runtimeSha256({
    domain: "continuation-setup-action-store-hash-v0.2",
    store: value
  });
}

function continuationSetupActionHmac(
  domain: string,
  sha256: string,
  installationSecret: string
): string {
  return createHmac("sha256", Buffer.from(installationSecret, "hex"))
    .update(runtimeCanonicalJson({ domain, sha256 }))
    .digest("hex");
}

function refineContinuationSetupActionOffer(
  value: z.infer<typeof continuationSetupActionOfferContentObjectSchema>,
  context: z.RefinementCtx
): void {
  const issuedAt = Date.parse(value.issuedAt);
  const candidateExpiresAt = Date.parse(
    value.binding.authority.candidateExpiresAt
  );
  const expectedExpiresAt = Math.min(
    issuedAt + CONTINUATION_SETUP_ACTION_TTL_MS,
    candidateExpiresAt
  );
  if (
    issuedAt < Date.parse(value.binding.issuanceAudit.generatedAt) ||
    issuedAt >= candidateExpiresAt ||
    Date.parse(value.expiresAt) !== expectedExpiresAt ||
    value.authKeyId !== value.binding.authority.authKeyId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Setup action offer TTL or candidate bound mismatch"
    });
  }
  if (
    value.bindingSha256 !==
    continuationSetupActionBindingSha256(value.binding)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bindingSha256"],
      message: "Setup action offer binding hash mismatch"
    });
  }
}

function refineContinuationSetupActionEvent(
  value: z.infer<typeof continuationSetupActionEventContentObjectSchema>,
  context: z.RefinementCtx
): void {
  if (value.eventType === "issued") {
    if (
      value.offer === null ||
      value.terminalReason !== null ||
      value.retainedUntil !== null ||
      value.authKeyId !== value.offer.authKeyId ||
      value.offerId !== value.offer.offerId ||
      value.itemRef !== value.offer.binding.authority.itemRef ||
      value.occurredAt !== value.offer.issuedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Issued Setup action event fields conflict"
      });
    }
    return;
  }
  if (
    value.offer !== null ||
    value.terminalReason === null ||
    value.retainedUntil === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Terminal Setup action event fields conflict"
    });
  }
}

function refineContinuationSetupActionStore(
  value: z.infer<typeof continuationSetupActionStoreContentObjectSchema>,
  context: z.RefinementCtx
): void {
  if (
    value.anchorSequence > value.revision ||
    value.revision !== value.anchorSequence + value.events.length ||
    (value.anchorSequence === 0) !==
      (value.anchorEventSha256 === null) ||
    (value.anchorSequence === 0) !==
      (value.anchorOccurredAt === null) ||
    (value.revision === 0
      ? value.updatedAt !== value.createdAt
      : value.events.length > 0
        ? value.updatedAt !== value.events.at(-1)?.occurredAt
        : value.updatedAt !== value.anchorOccurredAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Setup action store revision or update time mismatch"
    });
  }
  let previousEventSha256: string | null = value.anchorEventSha256;
  const activeByOffer = new Map<string, ContinuationSetupActionOffer>();
  const activeOfferByItem = new Map<string, string>();
  const seenOfferIds = new Set<string>();
  for (const [index, event] of value.events.entries()) {
    if (
      event.authKeyId !== value.authKeyId ||
      event.sequence !== value.anchorSequence + index + 1 ||
      event.previousEventSha256 !== previousEventSha256 ||
      (index === 0 &&
        Date.parse(event.occurredAt) <
          Date.parse(value.anchorOccurredAt ?? value.createdAt)) ||
      (index > 0 &&
        Date.parse(event.occurredAt) <
          Date.parse(value.events[index - 1]!.occurredAt))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index],
        message: "Setup action event chain is invalid"
      });
    }
    if (event.eventType === "issued" && event.offer !== null) {
      if (
        seenOfferIds.has(event.offerId) ||
        activeOfferByItem.has(event.itemRef)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index],
          message: "Setup action store has duplicate active authority"
        });
      }
      seenOfferIds.add(event.offerId);
      activeByOffer.set(event.offerId, event.offer);
      activeOfferByItem.set(event.itemRef, event.offerId);
    } else if (event.eventType === "terminal") {
      const active = activeByOffer.get(event.offerId);
      const expectedRetainedUntil =
        active === undefined
          ? null
          : new Date(
              (event.terminalReason === "expired"
                ? Date.parse(active.expiresAt)
                : Date.parse(event.occurredAt)) +
                CONTINUATION_SETUP_ACTION_TOMBSTONE_RETENTION_MS
            ).toISOString();
      if (
        active === undefined ||
        active.binding.authority.itemRef !== event.itemRef ||
        activeOfferByItem.get(event.itemRef) !== event.offerId ||
        event.retainedUntil !== expectedRetainedUntil
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index],
          message: "Setup action terminal event lacks exact active offer"
        });
      } else {
        activeByOffer.delete(event.offerId);
        activeOfferByItem.delete(event.itemRef);
      }
    }
    previousEventSha256 = event.eventSha256;
  }
  if (
    value.events.length + activeByOffer.size >
    CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["events"],
      message: "Setup action store must reserve terminal capacity"
    });
  }
}

function safeHexEqual(left: string, right: string): boolean {
  try {
    const leftBytes = Buffer.from(left, "hex");
    const rightBytes = Buffer.from(right, "hex");
    return (
      leftBytes.length === rightBytes.length &&
      timingSafeEqual(leftBytes, rightBytes)
    );
  } catch {
    return false;
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

import { types as utilTypes } from "node:util";

import { z } from "zod";

import { containsCredentialShapedPublicText } from "../publicTextSafety";
import {
  continuationDecisionStatusSchema,
  type ContinuationDecisionStatus
} from "./contracts";
import {
  continuationResolvedDecisionSchema,
  type ContinuationResolvedDecision
} from "./resolveContinuation";

export const CONTINUATION_READ_API_CONTRACT =
  "continuation-read-api-v0.1" as const;

const timestampSchema = z
  .string()
  .datetime()
  .refine((value) => {
    const parsed = Date.parse(value);
    return (
      Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    );
  }, "Continuation read timestamps must be canonical UTC");
const coverageCodeSchema = z.enum([
  "COMPLETE",
  "SOURCE_LOCAL_PARTIAL",
  "INSUFFICIENT",
  "UNAVAILABLE"
]);
const caveatCodeSchema = z.enum([
  "EXPLICIT_MAPPING_CONFIRMATION_REQUIRED",
  "IDENTITY_CLARIFICATION_REQUIRED",
  "SOURCE_COVERAGE_PARTIAL",
  "SOURCE_COVERAGE_UNKNOWN",
  "SOURCE_METADATA_ONLY",
  "TERMINAL_STATE_UNKNOWN"
]);
const forbiddenPublicTextPatterns = [
  /[\u0000-\u001f\u007f-\u009f]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /[\\/]/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:action_ref|analysis|artifact|binding|candidate|candidate_sha|context_ref|continuation_candidate|continuation_observation|continuation_offer|continuation_run|evidence|execution|input_sha|item_ref|managed_run|observation_sha|private_target|project|proof|repository|result_sha|run|scope|session|source_record_ref|source_ref|stream|work_context)_[A-Za-z0-9_-]+/iu
] as const;
const NON_CANONICAL_READ_VALUE = Object.freeze({
  nonCanonicalContinuationReadBoundaryValue: true
});

const continuationReadItemObjectSchema = z
  .object({
    title: publicSafeTextSchema(120),
    summary: publicSafeTextSchema(240),
    caveats: z.array(caveatCodeSchema).max(8),
    capability: z.literal("display"),
    action: z.null()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary !== value.title) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "Continuation read summary must preserve its title"
      });
    }
    if (!isCanonicalUnique(value.caveats)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caveats"],
        message: "Continuation read caveats must be canonical and unique"
      });
    }
  });

export const continuationReadItemSchema = descriptorSafeBoundary(
  continuationReadItemObjectSchema
);

const continuationReadDecisionObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_READ_API_CONTRACT),
    generatedAt: timestampSchema,
    status: continuationDecisionStatusSchema,
    coverageCode: coverageCodeSchema,
    items: z.array(continuationReadItemObjectSchema).max(3)
  })
  .strict()
  .superRefine(refineDecisionStatus);

export const continuationReadDecisionSchema = descriptorSafeBoundary(
  continuationReadDecisionObjectSchema
);

export const continuationReadErrorCodeSchema = z.enum([
  "CONTINUATION_READ_LOCAL_ONLY",
  "CONTINUATION_READ_INVALID_ORIGIN",
  "CONTINUATION_READ_DISABLED",
  "CONTINUATION_READ_AUTH_UNAVAILABLE",
  "CONTINUATION_READ_UNAUTHORIZED",
  "CONTINUATION_READ_FAILED"
]);

const continuationReadErrorObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_READ_API_CONTRACT),
    status: z.literal("error"),
    code: continuationReadErrorCodeSchema,
    message: publicSafeTextSchema(160)
  })
  .strict();

export const continuationReadErrorSchema = descriptorSafeBoundary(
  continuationReadErrorObjectSchema
);

export const continuationReadApiResponseSchema = z.union([
  continuationReadDecisionSchema,
  continuationReadErrorSchema
]);

export type ContinuationReadItem = z.infer<
  typeof continuationReadItemSchema
>;
export type ContinuationReadDecision = z.infer<
  typeof continuationReadDecisionSchema
>;
export type ContinuationReadError = z.infer<
  typeof continuationReadErrorSchema
>;
export type ContinuationReadApiResponse = z.infer<
  typeof continuationReadApiResponseSchema
>;

export function projectContinuationReadDecision(
  resolvedInput: ContinuationResolvedDecision
): ContinuationReadDecision {
  const resolved = continuationResolvedDecisionSchema.parse(resolvedInput);
  const decision = resolved.decision;
  const candidates = [
    ...(decision.primary === null ? [] : [decision.primary]),
    ...decision.alternatives
  ];
  return continuationReadDecisionSchema.parse({
    contract: CONTINUATION_READ_API_CONTRACT,
    generatedAt: decision.asOf,
    status: decision.status,
    coverageCode: decision.coverageCode,
    items: candidates.map((candidate) => ({
      title: candidate.localDisplayLabel,
      summary: candidate.localDisplayLabel,
      caveats: candidate.caveatCodes,
      capability: "display" as const,
      action: null
    }))
  });
}

export function createContinuationReadFallback(
  generatedAt: string,
  status: "unavailable" | "insufficient_evidence"
): ContinuationReadDecision {
  return continuationReadDecisionSchema.parse({
    contract: CONTINUATION_READ_API_CONTRACT,
    generatedAt,
    status,
    coverageCode:
      status === "unavailable" ? "UNAVAILABLE" : "INSUFFICIENT",
    items: []
  });
}

function refineDecisionStatus(
  value: {
    status: ContinuationDecisionStatus;
    coverageCode: z.infer<typeof coverageCodeSchema>;
    items: Array<z.infer<typeof continuationReadItemObjectSchema>>;
  },
  context: z.RefinementCtx
): void {
  const expectedCoverage = {
    offers_available: ["COMPLETE", "SOURCE_LOCAL_PARTIAL"],
    setup_required: ["SOURCE_LOCAL_PARTIAL"],
    no_recent_context: ["COMPLETE"],
    insufficient_evidence: ["INSUFFICIENT"],
    unavailable: ["UNAVAILABLE"]
  } as const;
  if (
    !(expectedCoverage[value.status] as readonly string[]).includes(
      value.coverageCode
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["coverageCode"],
      message: "Continuation read status and coverage mismatch"
    });
  }
  const carriesItems =
    value.status === "offers_available" ||
    value.status === "setup_required";
  if (carriesItems !== (value.items.length > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["items"],
      message: "Continuation read status and item presence mismatch"
    });
  }
}

function publicSafeTextSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .superRefine((value, context) => {
      if (
        forbiddenPublicTextPatterns.some((pattern) => pattern.test(value)) ||
        containsCredentialShapedPublicText(value)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: "Continuation read text is not public-safe"
        });
      }
    });
}

function isCanonicalUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) return false;
  }
  return true;
}

function descriptorSafeBoundary<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    try {
      return cloneDescriptorSafeValue(value);
    } catch {
      return NON_CANONICAL_READ_VALUE;
    }
  }, schema);
}

function cloneDescriptorSafeValue(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new TypeError("Continuation read value is too deep");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && utilTypes.isProxy(value)) {
    throw new TypeError("Continuation read proxies are not accepted");
  }
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Continuation read array contains a symbol");
    }
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (length === undefined || !("value" in length)) {
      throw new TypeError("Continuation read array length is not data");
    }
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw new TypeError("Continuation read arrays must be dense data");
      }
      output.push(cloneDescriptorSafeValue(descriptor.value, depth + 1));
    }
    if (keys.length !== value.length + 1) {
      throw new TypeError("Continuation read array contains extra properties");
    }
    return output;
  }
  if (typeof value !== "object") {
    throw new TypeError("Continuation read value is not JSON data");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Continuation read object prototype is unsafe");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError("Continuation read object contains a symbol");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError("Continuation read object is not enumerable data");
    }
    output[key] = cloneDescriptorSafeValue(descriptor.value, depth + 1);
  }
  return output;
}

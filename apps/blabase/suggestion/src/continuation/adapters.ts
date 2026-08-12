import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  continuationObservationSchema,
  createContinuationObservationId,
  sealContinuationObservation,
  type ContinuationObservation,
  type ContinuationObservationContent
} from "./contracts";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_OBSERVATION_CONTRACT,
  CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
  CONTINUATION_OBSERVATION_SCHEMA_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../crossSource/versions";
import {
  validateCodexSnapshot,
  validateGitHubSnapshot
} from "../crossSource/validateSnapshots";

const ADAPTER_BATCH_CONTRACT = "continuation-source-adapter-batch-v0.1" as const;
const ADAPTER_BATCH_SCHEMA_VERSION =
  "continuation-source-adapter-batch-schema-v0.1" as const;
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_GITHUB_ACTIVITIES = 10_000;
const MAX_GITHUB_REPOSITORIES = 5_000;
const MAX_GITHUB_TASKS = 10_000;
const MAX_GITHUB_INSTALLATIONS = 1_000;
const MAX_CODEX_SESSIONS = 10_000;
const MAX_CODEX_SCOPE_IDS = 1_000;

const exclusionReasonSchema = z.enum([
  "ACTIVITIES_UNAVAILABLE",
  "ACTIVITY_AFTER_SNAPSHOT",
  "ACTIVITY_FROM_FUTURE",
  "DUPLICATE_COLLAPSED",
  "DUPLICATE_CONFLICT",
  "INPUT_LIMIT_EXCEEDED",
  "NON_PUSH_ACTIVITY",
  "OUTSIDE_ACTIVITY_WINDOW",
  "SNAPSHOT_FROM_FUTURE",
  "SNAPSHOT_MISSING",
  "SOURCE_REJECTED",
  "UNSUPPORTED_SOURCE_VERSION"
]);

const exclusionCountSchema = z
  .object({
    reasonCode: exclusionReasonSchema,
    count: z.number().int().positive().max(100_000)
  })
  .strict();

const commonBatchShape = {
  contract: z.literal(ADAPTER_BATCH_CONTRACT),
  schemaVersion: z.literal(ADAPTER_BATCH_SCHEMA_VERSION),
  status: z.enum(["available", "unavailable"]),
  sourceSnapshotSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  observations: z.array(continuationObservationSchema).max(10_000),
  excludedCount: z.number().int().nonnegative().max(100_000),
  exclusions: z.array(exclusionCountSchema).max(16),
  batchSha256: z.string().regex(/^[a-f0-9]{64}$/u)
};

const githubBatchSchema = z
  .object({
    ...commonBatchShape,
    source: z.literal("github"),
    sourceSchemaVersion: z.literal(CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION),
    adapterVersion: z.literal(CONTINUATION_GITHUB_ADAPTER_VERSION)
  })
  .strict();

const codexBatchSchema = z
  .object({
    ...commonBatchShape,
    source: z.literal("codex"),
    sourceSchemaVersion: z.literal(CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION),
    adapterVersion: z.literal(CONTINUATION_CODEX_ADAPTER_VERSION)
  })
  .strict();

export const continuationSourceAdapterBatchSchema = z
  .union([githubBatchSchema, codexBatchSchema])
  .superRefine((batch, context) => {
    if (
      (batch.status === "available") !==
      (batch.sourceSnapshotSha256 !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceSnapshotSha256"],
        message: "Available adapter batches require an exact source snapshot hash"
      });
    }
    if (batch.status === "unavailable" && batch.observations.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations"],
        message: "Unavailable adapter batches cannot carry observations"
      });
    }
    if (
      batch.excludedCount !==
      batch.exclusions.reduce((total, item) => total + item.count, 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["excludedCount"],
        message: "Excluded count must equal the bounded reason counts"
      });
    }
    if (!isCanonical(batch.observations, (item) => item.observationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations"],
        message: "Observations must be canonical and unique"
      });
    }
    if (!isCanonical(batch.exclusions, (item) => item.reasonCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exclusions"],
        message: "Exclusions must be canonical and unique"
      });
    }
    const { batchSha256: _storedHash, ...content } = batch;
    if (batch.batchSha256 !== adapterBatchSha256(content)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batchSha256"],
        message: "Adapter batch hash mismatch"
      });
    }
    for (const observation of batch.observations) {
      if (
        observation.sourceIdentity.source !== batch.source ||
        observation.sourceSchemaVersion !== batch.sourceSchemaVersion ||
        observation.adapterVersion !== batch.adapterVersion ||
        observation.sourceSnapshotSha256 !== batch.sourceSnapshotSha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observations"],
          message: "Observation provenance does not match its adapter batch"
        });
        break;
      }
    }
  });

export type ContinuationSourceAdapterBatch = z.infer<
  typeof continuationSourceAdapterBatchSchema
>;

export type ContinuationSourceAdapterOptions = {
  installationSecret: string;
  asOf: string;
  snapshotFreshnessCutoff: string;
};

const optionsSchema = z
  .object({
    installationSecret: z.string().min(1).max(1_024),
    asOf: z.string().datetime(),
    snapshotFreshnessCutoff: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.snapshotFreshnessCutoff) > Date.parse(value.asOf)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshotFreshnessCutoff"],
        message: "Freshness cutoff cannot follow asOf"
      });
    }
  });

export function adaptGitHubContinuationObservations(
  input: unknown,
  optionsInput: ContinuationSourceAdapterOptions
): ContinuationSourceAdapterBatch {
  const options = optionsSchema.safeParse(optionsInput);
  if (!options.success) {
    return unavailableBatch("github", "SOURCE_REJECTED");
  }
  const rawVersion = schemaVersionOf(input);
  if (input === null || input === undefined) {
    return unavailableBatch("github", "SNAPSHOT_MISSING");
  }
  if (rawVersion !== CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION) {
    return unavailableBatch("github", "UNSUPPORTED_SOURCE_VERSION");
  }
  if (
    arrayLength(input, "activities") > MAX_GITHUB_ACTIVITIES ||
    arrayLength(input, "repositories") > MAX_GITHUB_REPOSITORIES ||
    arrayLength(input, "tasks") > MAX_GITHUB_TASKS ||
    arrayLength(input, "installations") > MAX_GITHUB_INSTALLATIONS
  ) {
    return unavailableBatch("github", "INPUT_LIMIT_EXCEEDED");
  }
  const validated = validateGitHubSnapshot(input);
  if (validated.status !== "ok") {
    return unavailableBatch("github", "SOURCE_REJECTED");
  }
  const { artifact } = validated;
  const asOfMs = Date.parse(options.data.asOf);
  const snapshotMs = Date.parse(artifact.fetchedAt);
  if (snapshotMs > asOfMs) {
    return unavailableBatch("github", "SNAPSHOT_FROM_FUTURE");
  }
  const exclusions = new Map<ExclusionReason, number>();
  if (artifact.payload.activitiesState === "unavailable") {
    addExclusion(exclusions, "ACTIVITIES_UNAVAILABLE");
    return availableBatch("github", artifact.sourceSnapshotSha256, [], exclusions);
  }

  const repositories = new Set(
    artifact.payload.repositories.map((repository) => repository.id)
  );
  const eligible = artifact.payload.activities.filter((activity) => {
    if (activity.activityKind !== "push") {
      addExclusion(exclusions, "NON_PUSH_ACTIVITY");
      return false;
    }
    const occurredAtMs = Date.parse(activity.occurredAt);
    if (occurredAtMs > asOfMs) {
      addExclusion(exclusions, "ACTIVITY_FROM_FUTURE");
      return false;
    }
    if (occurredAtMs > snapshotMs) {
      addExclusion(exclusions, "ACTIVITY_AFTER_SNAPSHOT");
      return false;
    }
    if (occurredAtMs <= asOfMs - ACTIVITY_WINDOW_MS) {
      addExclusion(exclusions, "OUTSIDE_ACTIVITY_WINDOW");
      return false;
    }
    if (!repositories.has(activity.repositoryId)) {
      addExclusion(exclusions, "SOURCE_REJECTED");
      return false;
    }
    return true;
  });
  const observations = dedupeRecords(
    eligible,
    (activity) =>
      opaqueRef(
        "source_record_ref",
        options.data.installationSecret,
        "github-push-record-v0.1",
        activity.id
      ),
    exclusions
  ).map((activity) => {
    const sourceIdentity = {
      source: "github" as const,
      opaqueId: opaqueRef(
        "source_ref",
        options.data.installationSecret,
        "github-repository-v0.1",
        activity.repositoryId
      )
    };
    const sourceRecordRef = opaqueRef(
      "source_record_ref",
      options.data.installationSecret,
      "github-push-record-v0.1",
      activity.id
    );
    return sealObservation({
      sourceIdentity,
      sourceRecordRef,
      sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
      sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      payload: {
        kind: "github_push",
        pushOccurredAt: activity.occurredAt
      },
      observedAt: activity.occurredAt,
      snapshotCapturedAt: artifact.fetchedAt,
      sourceCoverage:
        artifact.payload.truncated ||
        artifact.payload.activitiesTruncated ||
        artifact.payload.activitiesState === "partial" ||
        Date.parse(artifact.payload.activityWindowStart) >
          asOfMs - ACTIVITY_WINDOW_MS
          ? "partial"
          : "complete",
      snapshotFreshness:
        snapshotMs < Date.parse(options.data.snapshotFreshnessCutoff)
          ? "stale"
          : "fresh",
      evidenceRefs: [
        opaqueRef(
          "evidence",
          options.data.installationSecret,
          "github-push-evidence-v0.1",
          { id: activity.id, artifactId: activity.artifactId }
        )
      ]
    });
  });
  return availableBatch("github", artifact.sourceSnapshotSha256, observations, exclusions);
}

export function adaptCodexContinuationObservations(
  input: unknown,
  optionsInput: ContinuationSourceAdapterOptions
): ContinuationSourceAdapterBatch {
  const options = optionsSchema.safeParse(optionsInput);
  if (!options.success) {
    return unavailableBatch("codex", "SOURCE_REJECTED");
  }
  const rawVersion = schemaVersionOf(input);
  if (input === null || input === undefined) {
    return unavailableBatch("codex", "SNAPSHOT_MISSING");
  }
  if (rawVersion !== CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION) {
    return unavailableBatch("codex", "UNSUPPORTED_SOURCE_VERSION");
  }
  if (
    arrayLength(input, "sessions") > MAX_CODEX_SESSIONS ||
    arrayLength(input, "scopeIds") > MAX_CODEX_SCOPE_IDS
  ) {
    return unavailableBatch("codex", "INPUT_LIMIT_EXCEEDED");
  }
  const validated = validateCodexSnapshot(input);
  if (validated.status !== "ok") {
    return unavailableBatch("codex", "SOURCE_REJECTED");
  }
  const { artifact } = validated;
  const asOfMs = Date.parse(options.data.asOf);
  const snapshotMs = Date.parse(artifact.fetchedAt);
  if (snapshotMs > asOfMs) {
    return unavailableBatch("codex", "SNAPSHOT_FROM_FUTURE");
  }
  const exclusions = new Map<ExclusionReason, number>();
  const eligible = artifact.payload.sessions.filter((session) => {
    const updatedAtMs = Date.parse(session.updatedAt);
    if (updatedAtMs > asOfMs) {
      addExclusion(exclusions, "ACTIVITY_FROM_FUTURE");
      return false;
    }
    if (updatedAtMs > snapshotMs) {
      addExclusion(exclusions, "ACTIVITY_AFTER_SNAPSHOT");
      return false;
    }
    if (updatedAtMs <= asOfMs - ACTIVITY_WINDOW_MS) {
      addExclusion(exclusions, "OUTSIDE_ACTIVITY_WINDOW");
      return false;
    }
    return true;
  });
  const observations = dedupeRecords(
    eligible,
    (session) =>
      opaqueRef(
        "source_record_ref",
        options.data.installationSecret,
        "codex-session-record-v0.1",
        session.id
      ),
    exclusions
  ).map((session) => {
    const sourceIdentity = {
      source: "codex" as const,
      opaqueId: opaqueRef(
        "source_ref",
        options.data.installationSecret,
        "codex-session-v0.1",
        session.id
      )
    };
    const sourceRecordRef = opaqueRef(
      "source_record_ref",
      options.data.installationSecret,
      "codex-session-record-v0.1",
      session.id
    );
    const partial =
      artifact.payload.truncated ||
      Date.parse(artifact.payload.lookbackStart) > asOfMs - ACTIVITY_WINDOW_MS ||
      session.content.truncated ||
      ["partial", "stale", "failed", "expired"].includes(
        session.content.state
      );
    return sealObservation({
      sourceIdentity,
      sourceRecordRef,
      sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
      sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      payload: {
        kind: "codex_session_activity",
        sessionUpdatedAt: session.updatedAt,
        boundedActivityCount: Math.min(10_000, session.content.turnCount),
        boundedSummaryAvailable: session.taskSummary !== null
      },
      observedAt: session.updatedAt,
      snapshotCapturedAt: artifact.fetchedAt,
      sourceCoverage: partial ? "partial" : "complete",
      snapshotFreshness:
        snapshotMs < Date.parse(options.data.snapshotFreshnessCutoff)
          ? "stale"
          : "fresh",
      evidenceRefs: [
        opaqueRef(
          "evidence",
          options.data.installationSecret,
          "codex-session-evidence-v0.1",
          session.id
        )
      ]
    });
  });
  return availableBatch("codex", artifact.sourceSnapshotSha256, observations, exclusions);
}

type AdapterSource = "github" | "codex";
type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

function sealObservation(input: {
  sourceIdentity: ContinuationObservationContent["sourceIdentity"];
  sourceRecordRef: string;
  sourceSchemaVersion: ContinuationObservationContent["sourceSchemaVersion"];
  adapterVersion: ContinuationObservationContent["adapterVersion"];
  sourceSnapshotSha256: string;
  payload: ContinuationObservationContent["payload"];
  observedAt: string;
  snapshotCapturedAt: string;
  sourceCoverage: ContinuationObservationContent["sourceCoverage"];
  snapshotFreshness: ContinuationObservationContent["snapshotFreshness"];
  evidenceRefs: string[];
}): ContinuationObservation {
  const expiresAt = new Date(
    Date.parse(input.observedAt) + ACTIVITY_WINDOW_MS
  ).toISOString();
  return sealContinuationObservation({
    contract: CONTINUATION_OBSERVATION_CONTRACT,
    schemaVersion: CONTINUATION_OBSERVATION_SCHEMA_VERSION,
    observationId: createContinuationObservationId(input),
    observationIdPolicyVersion: CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
    sourceIdentity: input.sourceIdentity,
    sourceRecordRef: input.sourceRecordRef,
    sourceSchemaVersion: input.sourceSchemaVersion,
    adapterVersion: input.adapterVersion,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    workContextId: null,
    payload: input.payload,
    observedAt: input.observedAt,
    snapshotCapturedAt: input.snapshotCapturedAt,
    expiresAt,
    activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion:
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    sourceCoverage: input.sourceCoverage,
    snapshotFreshness: input.snapshotFreshness,
    terminalState: "unknown",
    evidenceRefs: [...input.evidenceRefs].sort(compareRuntimeStrings),
    conflictCodes: [],
    errorCodes: []
  });
}

function availableBatch(
  source: AdapterSource,
  sourceSnapshotSha256: string,
  observationsInput: ContinuationObservation[],
  exclusionMap: Map<ExclusionReason, number>
): ContinuationSourceAdapterBatch {
  return sealBatch({
    source,
    status: "available",
    sourceSnapshotSha256,
    observations: [...observationsInput].sort((left, right) =>
      compareRuntimeStrings(left.observationId, right.observationId)
    ),
    exclusions: exclusionCounts(exclusionMap)
  });
}

function unavailableBatch(
  source: AdapterSource,
  reasonCode: ExclusionReason
): ContinuationSourceAdapterBatch {
  return sealBatch({
    source,
    status: "unavailable",
    sourceSnapshotSha256: null,
    observations: [],
    exclusions: [{ reasonCode, count: 1 }]
  });
}

function sealBatch(input: {
  source: AdapterSource;
  status: "available" | "unavailable";
  sourceSnapshotSha256: string | null;
  observations: ContinuationObservation[];
  exclusions: Array<{ reasonCode: ExclusionReason; count: number }>;
}): ContinuationSourceAdapterBatch {
  const versions =
    input.source === "github"
      ? {
          sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION
        }
      : {
          sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION
        };
  const content = {
    contract: ADAPTER_BATCH_CONTRACT,
    schemaVersion: ADAPTER_BATCH_SCHEMA_VERSION,
    source: input.source,
    ...versions,
    status: input.status,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    observations: input.observations,
    excludedCount: input.exclusions.reduce(
      (total, exclusion) => total + exclusion.count,
      0
    ),
    exclusions: input.exclusions
  };
  return continuationSourceAdapterBatchSchema.parse({
    ...content,
    batchSha256: adapterBatchSha256(content)
  });
}

function adapterBatchSha256(value: unknown): string {
  return runtimeSha256({
    domain: "continuation-source-adapter-batch-hash-v0.1",
    batch: value
  });
}

function opaqueRef(
  prefix: "source_ref" | "source_record_ref" | "evidence",
  installationSecret: string,
  domain: string,
  value: unknown
): string {
  const digest = createHmac("sha256", installationSecret)
    .update(runtimeCanonicalJson({ domain, value }))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function dedupeRecords<T>(
  records: T[],
  identity: (record: T) => string,
  exclusions: Map<ExclusionReason, number>
): T[] {
  const groups = new Map<string, { values: Map<string, T>; total: number }>();
  for (const record of records) {
    const recordIdentity = identity(record);
    const group = groups.get(recordIdentity) ?? {
      values: new Map<string, T>(),
      total: 0
    };
    group.values.set(runtimeCanonicalJson(record), record);
    group.total += 1;
    groups.set(recordIdentity, group);
  }
  const retained: T[] = [];
  for (const group of groups.values()) {
    if (group.values.size > 1) {
      addExclusion(exclusions, "DUPLICATE_CONFLICT", group.total);
      continue;
    }
    const record = group.values.values().next().value as T;
    if (group.total > 1) {
      addExclusion(exclusions, "DUPLICATE_COLLAPSED", group.total - 1);
    }
    retained.push(record);
  }
  return retained.sort((left, right) =>
    compareRuntimeStrings(runtimeCanonicalJson(left), runtimeCanonicalJson(right))
  );
}

function addExclusion(
  map: Map<ExclusionReason, number>,
  reason: ExclusionReason,
  count = 1
): void {
  map.set(reason, Math.min(100_000, (map.get(reason) ?? 0) + count));
}

function exclusionCounts(
  map: Map<ExclusionReason, number>
): Array<{ reasonCode: ExclusionReason; count: number }> {
  return [...map.entries()]
    .sort(([left], [right]) => compareRuntimeStrings(left, right))
    .map(([reasonCode, count]) => ({ reasonCode, count }));
}

function schemaVersionOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>).schemaVersion;
  return typeof value === "string" ? value : null;
}

function arrayLength(input: unknown, key: string): number {
  if (typeof input !== "object" || input === null) return 0;
  const value = (input as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : 0;
}

function isCanonical<T>(values: T[], key: (value: T) => string): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compareRuntimeStrings(key(values[index - 1]!), key(values[index]!)) >= 0) {
      return false;
    }
  }
  return true;
}

import { Buffer } from "node:buffer";

import type { StoredCodexConfig } from "../../connectors/codex/types";
import {
  type WorkContextRegistry,
  workContextRegistrySchema
} from "../../context/contracts";
import {
  type RuntimeWorkSignalBatch,
  runtimeWorkSignalBatchSchema
} from "../../crossSource/schema";
import {
  domainSeparatedSha256,
  jcsCanonicalize
} from "../../dayflowEvidence/contracts";
import {
  resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot
} from "../../workEvidence/currentWorkEvidence";

export const STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1 =
  "blabase.dayflow-ablation.structured-current-work-evidence.v1" as const;

const INCLUSIVE_WINDOW_DURATION_SECONDS = 600 as const;
const INCLUSIVE_WINDOW_OFFSET_SECONDS =
  INCLUSIVE_WINDOW_DURATION_SECONDS - 1;
const GITHUB_SOURCE_INVALID = Symbol("github_source_invalid");

export type StructuredCurrentWorkEvidenceGithubModeV1 =
  | "configured_available"
  | "unconfigured";

export type StructuredCurrentWorkEvidenceDescriptorV1 = Readonly<{
  schemaVersion: typeof STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1;
  asOf: string;
  githubMode: StructuredCurrentWorkEvidenceGithubModeV1;
  canonicalJson: string;
  canonicalJsonByteLength: number;
  sha256: string;
}>;

export type CaptureStructuredCurrentWorkEvidenceFailureCodeV1 =
  | "WINDOW_INVALID"
  | "MANAGED_CODEX_REQUIRED"
  | "CONTEXT_REGISTRY_INVALID"
  | "GITHUB_SOURCE_INVALID"
  | "AUTHORITY_SNAPSHOT_FAILED"
  | "AUTHORITY_AS_OF_MISMATCH"
  | "PRESERVED_AUTHORITY_INVALID"
  | "STRUCTURED_EVIDENCE_INVALID"
  | "CANONICAL_PAYLOAD_INVALID";

export type CaptureStructuredCurrentWorkEvidenceResultV1 =
  | Readonly<{
      ok: true;
      descriptor: StructuredCurrentWorkEvidenceDescriptorV1;
    }>
  | Readonly<{
      ok: false;
      failure: Readonly<{
        code: CaptureStructuredCurrentWorkEvidenceFailureCodeV1;
      }>;
    }>;

export type CaptureStructuredCurrentWorkEvidenceInputV1 = Readonly<{
  cwd?: string;
  window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
  }>;
  codexConfig: StoredCodexConfig | null;
  contextRegistry: WorkContextRegistry | null;
  githubSource:
    | Readonly<{ mode: "unconfigured" }>
    | Readonly<{
        mode: "configured";
        resolveBatch: (asOf: string) => RuntimeWorkSignalBatch | null;
      }>;
}>;

type FailureResult = Extract<
  CaptureStructuredCurrentWorkEvidenceResultV1,
  { ok: false }
>;

const failureResults = Object.freeze(
  Object.fromEntries(
    (
      [
        "WINDOW_INVALID",
        "MANAGED_CODEX_REQUIRED",
        "CONTEXT_REGISTRY_INVALID",
        "GITHUB_SOURCE_INVALID",
        "AUTHORITY_SNAPSHOT_FAILED",
        "AUTHORITY_AS_OF_MISMATCH",
        "PRESERVED_AUTHORITY_INVALID",
        "STRUCTURED_EVIDENCE_INVALID",
        "CANONICAL_PAYLOAD_INVALID"
      ] as const
    ).map((code) => [
      code,
      Object.freeze({ ok: false as const, failure: Object.freeze({ code }) })
    ])
  )
) as Readonly<
  Record<CaptureStructuredCurrentWorkEvidenceFailureCodeV1, FailureResult>
>;

export async function captureStructuredCurrentWorkEvidenceV1(
  input: CaptureStructuredCurrentWorkEvidenceInputV1
): Promise<CaptureStructuredCurrentWorkEvidenceResultV1> {
  const asOf = exactWindowAsOf(input.window);
  if (asOf === null) return failureResults.WINDOW_INVALID;
  if (input.codexConfig === null) {
    return failureResults.MANAGED_CODEX_REQUIRED;
  }

  const contextRegistry = validatedContextRegistry(input.contextRegistry);
  if (contextRegistry === undefined) {
    return failureResults.CONTEXT_REGISTRY_INVALID;
  }

  const githubMode = githubModeForSource(input.githubSource);
  if (githubMode === null) return failureResults.GITHUB_SOURCE_INVALID;

  let githubResolutionCount = 0;
  let currentWorkEvidence: unknown;
  try {
    currentWorkEvidence =
      await resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot({
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        now: new Date(asOf),
        codexConfig: input.codexConfig,
        contextRegistry,
        resolveGithubBatch: (requestedAsOf) => {
          githubResolutionCount += 1;
          if (githubResolutionCount !== 1 || requestedAsOf !== asOf) {
            throw GITHUB_SOURCE_INVALID;
          }
          if (input.githubSource.mode === "unconfigured") return null;
          try {
            const candidate = input.githubSource.resolveBatch(requestedAsOf);
            if (candidate === null) throw GITHUB_SOURCE_INVALID;
            const parsed = runtimeWorkSignalBatchSchema.safeParse(candidate);
            if (!parsed.success || parsed.data.assessment.asOf !== requestedAsOf) {
              throw GITHUB_SOURCE_INVALID;
            }
            return parsed.data;
          } catch {
            throw GITHUB_SOURCE_INVALID;
          }
        }
      });
  } catch (error) {
    return error === GITHUB_SOURCE_INVALID
      ? failureResults.GITHUB_SOURCE_INVALID
      : failureResults.AUTHORITY_SNAPSHOT_FAILED;
  }

  if (githubResolutionCount !== 1) {
    return failureResults.GITHUB_SOURCE_INVALID;
  }
  const evidenceBoundary = readPreservedEvidenceBoundary(currentWorkEvidence);
  if (evidenceBoundary === null) {
    return failureResults.PRESERVED_AUTHORITY_INVALID;
  }
  if (evidenceBoundary.asOf !== asOf) {
    return failureResults.AUTHORITY_AS_OF_MISMATCH;
  }
  if (
    !evidenceMatchesSourceState(
      evidenceBoundary,
      githubMode,
      contextRegistry,
      asOf
    )
  ) {
    return failureResults.STRUCTURED_EVIDENCE_INVALID;
  }

  const sourceState = {
    asOf,
    window: {
      startEpochSecond: input.window.startEpochSecond,
      endEpochSecond: input.window.endEpochSecond,
      durationSeconds: INCLUSIVE_WINDOW_DURATION_SECONDS,
      boundary: "inclusive" as const
    },
    managedCodexMode: "configured" as const,
    contextRegistryMode:
      contextRegistry === null ? ("missing" as const) : ("available" as const),
    githubMode
  };
  const payload = {
    schemaVersion: STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
    sourceState,
    currentWorkEvidence
  };

  try {
    const canonicalJson = jcsCanonicalize(payload);
    const descriptor = Object.freeze({
      schemaVersion: STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
      asOf,
      githubMode,
      canonicalJson,
      canonicalJsonByteLength: Buffer.byteLength(canonicalJson, "utf8"),
      sha256: domainSeparatedSha256(
        STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
        payload
      )
    });
    return Object.freeze({ ok: true as const, descriptor });
  } catch {
    return failureResults.CANONICAL_PAYLOAD_INVALID;
  }
}

function exactWindowAsOf(
  window: CaptureStructuredCurrentWorkEvidenceInputV1["window"]
): string | null {
  const { startEpochSecond, endEpochSecond } = window;
  if (
    !Number.isSafeInteger(startEpochSecond) ||
    !Number.isSafeInteger(endEpochSecond) ||
    startEpochSecond < 0 ||
    endEpochSecond - startEpochSecond !== INCLUSIVE_WINDOW_OFFSET_SECONDS
  ) {
    return null;
  }
  const endEpochMillisecond = endEpochSecond * 1_000;
  if (!Number.isSafeInteger(endEpochMillisecond)) return null;
  const date = new Date(endEpochMillisecond);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function validatedContextRegistry(
  candidate: WorkContextRegistry | null
): WorkContextRegistry | null | undefined {
  if (candidate === null) return null;
  try {
    const parsed = workContextRegistrySchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function githubModeForSource(
  source: CaptureStructuredCurrentWorkEvidenceInputV1["githubSource"]
): StructuredCurrentWorkEvidenceGithubModeV1 | null {
  try {
    if (source.mode === "unconfigured") return "unconfigured";
    if (source.mode === "configured" && typeof source.resolveBatch === "function") {
      return "configured_available";
    }
    return null;
  } catch {
    return null;
  }
}

type PreservedEvidenceBoundary = Readonly<{
  asOf: string;
  githubBatch: unknown;
  contextRegistry: unknown;
}>;

const intrinsicObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;

function readPreservedEvidenceBoundary(
  candidate: unknown
): PreservedEvidenceBoundary | null {
  if (candidate === null || typeof candidate !== "object") return null;
  try {
    const asOf = intrinsicObjectGetOwnPropertyDescriptor(candidate, "asOf");
    const githubBatch = intrinsicObjectGetOwnPropertyDescriptor(
      candidate,
      "githubBatch"
    );
    const contextRegistry = intrinsicObjectGetOwnPropertyDescriptor(
      candidate,
      "contextRegistry"
    );
    if (
      asOf === undefined ||
      githubBatch === undefined ||
      contextRegistry === undefined ||
      !("value" in asOf) ||
      !("value" in githubBatch) ||
      !("value" in contextRegistry) ||
      typeof asOf.value !== "string"
    ) {
      return null;
    }
    return Object.freeze({
      asOf: asOf.value,
      githubBatch: githubBatch.value,
      contextRegistry: contextRegistry.value
    });
  } catch {
    return null;
  }
}

function evidenceMatchesSourceState(
  evidence: PreservedEvidenceBoundary,
  githubMode: StructuredCurrentWorkEvidenceGithubModeV1,
  expectedContextRegistry: WorkContextRegistry | null,
  asOf: string
): boolean {
  try {
    if (githubMode === "unconfigured") {
      if (evidence.githubBatch !== null) return false;
    } else {
      const parsed = runtimeWorkSignalBatchSchema.safeParse(evidence.githubBatch);
      if (!parsed.success || parsed.data.assessment.asOf !== asOf) return false;
    }
    if ((evidence.contextRegistry === null) !== (expectedContextRegistry === null)) {
      return false;
    }
    if (expectedContextRegistry !== null) {
      const parsedContext = workContextRegistrySchema.safeParse(
        evidence.contextRegistry
      );
      if (
        !parsedContext.success ||
        parsedContext.data.registrySha256 !==
          expectedContextRegistry.registrySha256
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

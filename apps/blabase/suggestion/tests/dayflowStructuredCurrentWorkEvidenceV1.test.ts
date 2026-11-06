import { Buffer } from "node:buffer";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredCodexConfig } from "../src/connectors/codex/types";
import { createEmptyWorkContextRegistry } from "../src/context/contracts";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import {
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT
} from "../src/crossSource/versions";
import { finalizeRuntimeWorkSignalBatch } from "../src/crossSource/workSignalIntegrity";
import {
  domainSeparatedSha256,
  jcsCanonicalize
} from "../src/dayflowEvidence/contracts";
import {
  captureStructuredCurrentWorkEvidenceV1,
  STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1
} from "../src/evaluation/dayflowAblation/captureStructuredCurrentWorkEvidenceV1";
import type { CurrentWorkEvidence } from "../src/workEvidence/currentWorkEvidence";

const resolveCurrentWorkEvidenceMock = vi.hoisted(() => vi.fn());

vi.mock("../src/workEvidence/currentWorkEvidence", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/workEvidence/currentWorkEvidence")
    >();
  return {
    ...actual,
    resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot:
      resolveCurrentWorkEvidenceMock
  };
});

const AS_OF = "2026-08-26T03:00:00.000Z";
const END_EPOCH_SECOND = Date.parse(AS_OF) / 1_000;
const START_EPOCH_SECOND = END_EPOCH_SECOND - 599;
const CODEX_CONFIG = Object.freeze({
  schemaVersion: "codex-connector-config-v3"
}) as StoredCodexConfig;
type ResolveInput = Parameters<
  typeof import("../src/workEvidence/currentWorkEvidence").resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot
>[0];

beforeEach(() => {
  resolveCurrentWorkEvidenceMock.mockReset();
  resolveCurrentWorkEvidenceMock.mockImplementation(
    async (input: ResolveInput) => {
      const asOf = input.now.toISOString();
      return evidenceFixture(
        asOf,
        input.resolveGithubBatch(asOf),
        input.contextRegistry
      );
    }
  );
});

describe("Task 1C structured CurrentWorkEvidence capture", () => {
  it("captures an unconfigured-GitHub snapshot as deterministic no-LF JCS", async () => {
    const first = await captureStructuredCurrentWorkEvidenceV1(baseInput());
    const second = await captureStructuredCurrentWorkEvidenceV1(baseInput());

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) throw new Error("expected structured evidence capture");
    const payload = JSON.parse(first.descriptor.canonicalJson) as {
      schemaVersion: string;
      sourceState: Record<string, unknown>;
      currentWorkEvidence: CurrentWorkEvidence;
    };
    expect(payload).toMatchObject({
      schemaVersion: STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
      sourceState: {
        asOf: AS_OF,
        window: {
          startEpochSecond: START_EPOCH_SECOND,
          endEpochSecond: END_EPOCH_SECOND,
          durationSeconds: 600,
          boundary: "inclusive"
        },
        managedCodexMode: "configured",
        contextRegistryMode: "missing",
        githubMode: "unconfigured"
      },
      currentWorkEvidence: { asOf: AS_OF, githubBatch: null }
    });
    expect(first.descriptor).toMatchObject({
      schemaVersion: STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
      asOf: AS_OF,
      githubMode: "unconfigured",
      canonicalJsonByteLength: Buffer.byteLength(
        first.descriptor.canonicalJson,
        "utf8"
      ),
      sha256: domainSeparatedSha256(
        STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
        payload
      )
    });
    expect(first.descriptor.canonicalJson).toBe(jcsCanonicalize(payload));
    expect(first.descriptor.canonicalJson).not.toContain("\n");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.descriptor)).toBe(true);
  });

  it("records configured GitHub and an available validated context registry", async () => {
    const contextRegistry = createEmptyWorkContextRegistry(AS_OF);
    const githubBatch = githubBatchFixture();
    let requestedAsOf: string | null = null;

    const result = await captureStructuredCurrentWorkEvidenceV1({
      ...baseInput(),
      contextRegistry,
      githubSource: {
        mode: "configured",
        resolveBatch: (asOf) => {
          requestedAsOf = asOf;
          return githubBatch;
        }
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected structured evidence capture");
    expect(requestedAsOf).toBe(AS_OF);
    expect(result.descriptor.githubMode).toBe("configured_available");
    expect(JSON.parse(result.descriptor.canonicalJson)).toMatchObject({
      sourceState: {
        contextRegistryMode: "available",
        githubMode: "configured_available"
      },
      currentWorkEvidence: {
        githubBatch: { batchSha256: githubBatch.batchSha256 },
        contextRegistry: { registrySha256: contextRegistry.registrySha256 }
      }
    });
  });

  it.each([
    { startEpochSecond: START_EPOCH_SECOND + 0.5, endEpochSecond: END_EPOCH_SECOND },
    { startEpochSecond: START_EPOCH_SECOND, endEpochSecond: END_EPOCH_SECOND - 1 },
    { startEpochSecond: START_EPOCH_SECOND, endEpochSecond: END_EPOCH_SECOND + 1 },
    { startEpochSecond: -600, endEpochSecond: -1 },
    {
      startEpochSecond: Number.MAX_SAFE_INTEGER - 599,
      endEpochSecond: Number.MAX_SAFE_INTEGER
    }
  ])("rejects an invalid inclusive window before capture: %o", async (window) => {
    const result = await captureStructuredCurrentWorkEvidenceV1({
      ...baseInput(),
      window
    });

    expect(result).toEqual(failure("WINDOW_INVALID"));
    expect(resolveCurrentWorkEvidenceMock).not.toHaveBeenCalled();
  });

  it("requires managed Codex and validates an available context registry", async () => {
    const missingCodex = await captureStructuredCurrentWorkEvidenceV1({
      ...baseInput(),
      codexConfig: null
    });
    const invalidContext = await captureStructuredCurrentWorkEvidenceV1({
      ...baseInput(),
      contextRegistry: { revision: -1 } as never
    });

    expect(missingCodex).toEqual(failure("MANAGED_CODEX_REQUIRED"));
    expect(invalidContext).toEqual(failure("CONTEXT_REGISTRY_INVALID"));
  });

  it("requires the returned context state to match the requested state", async () => {
    const contextRegistry = createEmptyWorkContextRegistry(AS_OF);
    resolveCurrentWorkEvidenceMock.mockImplementationOnce(
      async (input: ResolveInput) =>
        evidenceFixture(AS_OF, input.resolveGithubBatch(AS_OF), null)
    );
    const missingReturnedContext =
      await captureStructuredCurrentWorkEvidenceV1({
        ...baseInput(),
        contextRegistry
      });

    resolveCurrentWorkEvidenceMock.mockImplementationOnce(
      async (input: ResolveInput) =>
        evidenceFixture(
          AS_OF,
          input.resolveGithubBatch(AS_OF),
          contextRegistry
        )
    );
    const unexpectedReturnedContext =
      await captureStructuredCurrentWorkEvidenceV1(baseInput());

    expect(missingReturnedContext).toEqual(
      failure("STRUCTURED_EVIDENCE_INVALID")
    );
    expect(unexpectedReturnedContext).toEqual(
      failure("STRUCTURED_EVIDENCE_INVALID")
    );
  });

  it("rejects null and accessor-backed authority results without invoking getters", async () => {
    resolveCurrentWorkEvidenceMock.mockImplementationOnce(
      async (input: ResolveInput) => {
        input.resolveGithubBatch(AS_OF);
        return null;
      }
    );
    expect(await captureStructuredCurrentWorkEvidenceV1(baseInput())).toEqual(
      failure("PRESERVED_AUTHORITY_INVALID")
    );

    const asOfGetter = vi.fn(() => AS_OF);
    const accessorBacked = Object.defineProperties(
      {},
      {
        asOf: { enumerable: true, get: asOfGetter },
        githubBatch: { enumerable: true, value: null },
        contextRegistry: { enumerable: true, value: null }
      }
    );
    resolveCurrentWorkEvidenceMock.mockImplementationOnce(
      async (input: ResolveInput) => {
        input.resolveGithubBatch(AS_OF);
        return accessorBacked;
      }
    );

    expect(await captureStructuredCurrentWorkEvidenceV1(baseInput())).toEqual(
      failure("PRESERVED_AUTHORITY_INVALID")
    );
    expect(asOfGetter).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null", resolveBatch: () => null },
    {
      label: "invalid batch",
      resolveBatch: () => ({ assessment: { asOf: AS_OF } }) as RuntimeWorkSignalBatch
    },
    {
      label: "configured read failure",
      resolveBatch: () => {
        throw new Error("synthetic configured GitHub failure");
      }
    }
  ])("fails closed for configured GitHub $label", async ({ resolveBatch }) => {
    const result = await captureStructuredCurrentWorkEvidenceV1({
      ...baseInput(),
      githubSource: { mode: "configured", resolveBatch }
    });

    expect(result).toEqual(failure("GITHUB_SOURCE_INVALID"));
  });

  it("separates authority failure, asOf drift, and invalid canonical evidence", async () => {
    resolveCurrentWorkEvidenceMock.mockRejectedValueOnce(
      new Error("synthetic authority failure")
    );
    expect(await captureStructuredCurrentWorkEvidenceV1(baseInput())).toEqual(
      failure("AUTHORITY_SNAPSHOT_FAILED")
    );

    resolveCurrentWorkEvidenceMock.mockImplementationOnce(
      async (input: ResolveInput) => {
        input.resolveGithubBatch(AS_OF);
        return evidenceFixture("2026-08-26T03:00:01.000Z", null, null);
      }
    );
    expect(await captureStructuredCurrentWorkEvidenceV1(baseInput())).toEqual(
      failure("AUTHORITY_AS_OF_MISMATCH")
    );

    resolveCurrentWorkEvidenceMock.mockImplementationOnce(
      async (input: ResolveInput) => ({
        ...evidenceFixture(
          AS_OF,
          input.resolveGithubBatch(AS_OF),
          input.contextRegistry
        ),
        managedProjection: { forbiddenUndefined: undefined }
      })
    );
    expect(await captureStructuredCurrentWorkEvidenceV1(baseInput())).toEqual(
      failure("CANONICAL_PAYLOAD_INVALID")
    );
  });
});

function baseInput() {
  return {
    window: {
      startEpochSecond: START_EPOCH_SECOND,
      endEpochSecond: END_EPOCH_SECOND
    },
    codexConfig: CODEX_CONFIG,
    contextRegistry: null,
    githubSource: { mode: "unconfigured" as const }
  };
}

function evidenceFixture(
  asOf: string,
  githubBatch: RuntimeWorkSignalBatch | null,
  contextRegistry: ResolveInput["contextRegistry"]
): CurrentWorkEvidence {
  return {
    asOf,
    githubBatch,
    managedProjection: {},
    managedSemantics: {},
    managedRunStartedAtById: {},
    workRelations: {},
    artifacts: {},
    claims: {},
    contextRegistry
  } as CurrentWorkEvidence;
}

function githubBatchFixture(): RuntimeWorkSignalBatch {
  return finalizeRuntimeWorkSignalBatch({
    contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
    source: "github",
    sourceSchemaVersion: "github-snapshot-v2",
    collectorVersion: "github-collector-v0.2",
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: "1".repeat(64),
    normalizationInputSha256: "2".repeat(64),
    assessment: {
      contract: RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
      source: "github",
      asOf: AS_OF,
      fetchedAt: AS_OF,
      freshnessPolicyVersion: "synthetic-test-v1",
      freshness: "fresh",
      completeness: "complete",
      truncated: false,
      candidateSetComplete: true,
      usableForOverview: true,
      usableForCurrentCandidates: true,
      reasonCodes: ["SNAPSHOT_FRESH"]
    },
    skippedRecordCount: 0,
    issues: [],
    signals: []
  });
}

function failure(code: string) {
  return { ok: false, failure: { code } };
}

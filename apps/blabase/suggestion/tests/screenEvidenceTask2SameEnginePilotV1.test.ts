import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../src/dayflowEvidence/contracts";
import {
  STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
} from "../src/evaluation/dayflowAblation/captureStructuredCurrentWorkEvidenceV1";
import {
  runScreenEvidenceTask2SameEnginePilotV1,
  ScreenEvidenceTask2PilotErrorV1,
} from "../src/evaluation/screenEvidenceAblation/runScreenEvidenceTask2SameEnginePilotV1";
import {
  sealTask1EvaluationInputV1,
} from "../src/evaluation/screenEvidenceAblation/sealTask1EvaluationInputV1";
import {
  SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
  SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
  SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
  SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
  SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
} from "../src/screenEvidence/contractsV1";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roots = new Set<string>();
const expectedOutputNames = Object.freeze([
  "COMPLETE",
  "arm-a-result.json",
  "arm-b-result.json",
  "arm-c-result.json",
  "run-manifest.json",
  "run-manifest.sha256",
] as const);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(jcsCanonicalize(value));
}

function replayIdentitySha256(
  manifestBytes: Uint8Array,
  payloadBytes: Uint8Array,
): string {
  const hash = createHash("sha256");
  hash.update(encoder.encode("blabase.screen-evidence-replay.v1\0"));
  for (const part of [manifestBytes, payloadBytes]) {
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(part.byteLength), false);
    hash.update(length);
    hash.update(part);
  }
  return hash.digest("hex");
}

async function privateProjectRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "blabase-screen-task2-pilot-"),
  );
  await chmod(root, 0o755);
  roots.add(root);
  return root;
}

function structuredFixture(
  startEpochSecond: number,
  endEpochSecond: number,
): Readonly<{ value: JsonValue; bytes: Uint8Array; contentSha256: string }> {
  const asOf = new Date(endEpochSecond * 1_000).toISOString();
  const value = {
    schemaVersion: STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
    sourceState: {
      asOf,
      window: {
        startEpochSecond,
        endEpochSecond,
        durationSeconds: 600,
        boundary: "inclusive",
      },
      managedCodexMode: "configured",
      contextRegistryMode: "missing",
      githubMode: "unconfigured",
    },
    currentWorkEvidence: {
      asOf,
      githubBatch: null,
      managedProjection: {
        activities: ["STRUCTURED_PRIVATE_ACTIVITY_TOKEN"],
      },
      managedSemantics: {
        signals: ["STRUCTURED_PRIVATE_SIGNAL_TOKEN"],
      },
      managedRunStartedAtById: {},
      workRelations: {
        relations: ["STRUCTURED_PRIVATE_RELATION_TOKEN"],
      },
      artifacts: {
        items: ["STRUCTURED_PRIVATE_ARTIFACT_TOKEN"],
      },
      claims: {
        items: ["STRUCTURED_PRIVATE_CLAIM_TOKEN"],
      },
      contextRegistry: null,
      forwardCompatibleContext: {
        value: "STRUCTURED_PRIVATE_OTHER_TOKEN",
      },
    },
  } satisfies JsonValue;
  return Object.freeze({
    value,
    bytes: canonicalBytes(value),
    contentSha256: domainSeparatedSha256(
      STRUCTURED_CURRENT_WORK_EVIDENCE_SCHEMA_VERSION_V1,
      value,
    ),
  });
}

function screenBundleFixture(
  startEpochSecond: number,
  endEpochSecond: number,
) {
  const startEpochMs = startEpochSecond * 1_000;
  const endEpochMs = endEpochSecond * 1_000;
  const payload = {
    schemaVersion: SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
    producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
    preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
    exportRunId: "screen-task2-pilot-fixture",
    window: { startEpochMs, endEpochMs },
    provenance: {
      sourceSystem: "blabase.capture-store.v1",
      sourceRevision: "fixture-revision-1",
      preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
      privacyProfile: "blabase.privacy-minimized-screen-evidence.v1",
    },
    captures: [
      {
        captureId: "capture-a",
        revision: 1,
        capturedAtEpochMs: startEpochMs,
      },
      {
        captureId: "capture-b",
        revision: 1,
        capturedAtEpochMs: endEpochMs,
      },
    ],
    observations: [
      {
        observationId: "observation-a",
        captureId: "capture-a",
        capturedAtEpochMs: startEpochMs,
        kind: "ocr_span",
        text: "SCREEN_PRIVATE_OBSERVATION_TOKEN",
        confidence: 0.5,
      },
      {
        observationId: "observation-b",
        captureId: "capture-b",
        capturedAtEpochMs: endEpochMs,
        kind: "application",
        label: "SCREEN_PRIVATE_APPLICATION_TOKEN",
        confidence: 0.5,
      },
    ],
    coverage: {
      captureCount: 2,
      observationCount: 2,
      ocrSpanCount: 1,
      coveredCaptureCount: 2,
      coveredCaptureRatio: 1,
    },
    conflicts: [],
    issues: [
      {
        code: "OBSERVATION_LOW_CONFIDENCE",
        observationId: "observation-a",
        captureId: "capture-a",
      },
      {
        code: "OBSERVATION_LOW_CONFIDENCE",
        observationId: "observation-b",
        captureId: "capture-b",
      },
    ],
  } satisfies JsonValue;
  const payloadBytes = canonicalBytes(payload);
  const manifest = {
    schemaVersion: SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
    canonicalizationProfile: SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
    producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
    preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
    exportRunId: payload.exportRunId,
    payloadFile: "payload.json",
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256: sha256(payloadBytes),
  } satisfies JsonValue;
  const manifestBytes = canonicalBytes(manifest);
  const manifestSha256 = sha256(manifestBytes);
  const sourceBytes = Object.freeze([
    payloadBytes,
    manifestBytes,
    encoder.encode(manifestSha256),
    encoder.encode(manifestSha256),
  ]);
  const sourcePaths = Object.freeze([
    "payload.json",
    "manifest.json",
    "manifest.sha256",
    "COMPLETE",
  ] as const);
  return Object.freeze({
    payloadBytes,
    manifestBytes,
    manifestSha256,
    replayIdentitySha256: replayIdentitySha256(manifestBytes, payloadBytes),
    copySourceEntries: () =>
      Object.freeze({
        bundleDirectoryName: payload.exportRunId,
        entries: Object.freeze(
          sourcePaths.map((relativePath, index) => {
            const bytes = new Uint8Array(sourceBytes[index]!);
            return Object.freeze({
              relativePath,
              entryKind: "regular-file" as const,
              byteLength: bytes.byteLength,
              bytes,
            });
          }),
        ),
      }),
  });
}

async function sealedTask1Fixture(projectDirectory: string) {
  const startEpochSecond = 1_700_000_000;
  const endEpochSecond = startEpochSecond + 599;
  const structured = structuredFixture(startEpochSecond, endEpochSecond);
  const screen = screenBundleFixture(startEpochSecond, endEpochSecond);
  const sealed = await sealTask1EvaluationInputV1({
    projectDirectory,
    inputRunId: "task1-pilot-fixture",
    structured: {
      bytes: structured.bytes,
      startEpochSecond,
      endEpochSecond,
      asOfEpochSecond: endEpochSecond,
      byteLength: structured.bytes.byteLength,
      rawSha256: sha256(structured.bytes),
      contentSha256: structured.contentSha256,
    },
    screen: {
      readback: { copySourceEntries: screen.copySourceEntries },
      startEpochMs: startEpochSecond * 1_000,
      endEpochMs: endEpochSecond * 1_000,
      sourceRevision: 1,
      manifestSha256: screen.manifestSha256,
      payloadSha256: sha256(screen.payloadBytes),
      replayIdentitySha256: screen.replayIdentitySha256,
    },
    selection: {
      sourceSnapshotIdentitySha256: sha256(
        encoder.encode("task2-snapshot-identity"),
      ),
      privacyReceiptSetSha256: sha256(
        encoder.encode("task2-privacy-receipt-set"),
      ),
      retentionAsOfEpochMs: endEpochSecond * 1_000,
    },
  });
  return Object.freeze({
    inputRunId: "task1-pilot-fixture",
    inputIdentitySha256: sealed.inputIdentitySha256,
    analysisTimestamp: new Date(endEpochSecond * 1_000).toISOString(),
    relativeDirectory: sealed.relativeDirectory,
  });
}

function mockProvider(prompts: string[]) {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe("https://provider.invalid/v1/interactions");
    const body = JSON.parse(String(init?.body)) as {
      model?: unknown;
      input?: unknown;
      store?: unknown;
    };
    expect(body.model).toBe("synthetic-model");
    expect(body.store).toBe(false);
    expect(typeof body.input).toBe("string");
    prompts.push(body.input as string);
    return Response.json({
      id: "synthetic-request",
      model: "synthetic-model",
      output_text: JSON.stringify({ candidates: [] }),
      usage: {
        total_input_tokens: 10,
        total_output_tokens: 1,
        total_tokens: 11,
      },
    });
  };
  return fetchImpl as typeof fetch;
}

function runnerEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    BLABASE_SUGGESTION_PROVIDER: "gemini",
    BLABASE_SUGGESTION_MODEL: "synthetic-model",
    GEMINI_API_KEY: "SYNTHETIC_PRIVATE_API_KEY_TOKEN",
    GEMINI_BASE_URL: "https://provider.invalid/v1",
  };
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function parseEvidencePacketFromProviderPrompt(
  prompt: string,
): Record<string, unknown> {
  const envelopeBoundary = prompt.lastIndexOf("\n\n{");
  if (envelopeBoundary < 0) {
    throw new TypeError("Provider prompt is missing its final JSON envelope.");
  }
  const envelope = JSON.parse(prompt.slice(envelopeBoundary + 2)) as {
    conversation?: { messages?: Array<{ text?: unknown }> };
  };
  const messages = envelope.conversation?.messages;
  if (!Array.isArray(messages) || messages.length !== 1) {
    throw new TypeError("Provider prompt must contain one evidence message.");
  }
  const messageText = messages[0]?.text;
  if (typeof messageText !== "string") {
    throw new TypeError("Provider prompt evidence message is malformed.");
  }
  const packetBoundary = messageText.indexOf("\n");
  if (
    packetBoundary < 0 ||
    packetBoundary !== messageText.lastIndexOf("\n")
  ) {
    throw new TypeError("Provider prompt evidence packet is missing.");
  }
  const packet: unknown = JSON.parse(messageText.slice(packetBoundary + 1));
  if (packet === null || typeof packet !== "object" || Array.isArray(packet)) {
    throw new TypeError("Provider prompt evidence packet is malformed.");
  }
  return packet as Record<string, unknown>;
}

async function readJson(absolutePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(absolutePath, "utf8")) as Record<
    string,
    unknown
  >;
}

async function outputSnapshot(directory: string): Promise<ReadonlyMap<string, string>> {
  const names = await readdir(directory);
  return new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        sha256(new Uint8Array(await readFile(path.join(directory, name)))),
      ] as const),
    ),
  );
}

afterEach(async () => {
  await Promise.all(
    [...roots].map(async (root) => {
      roots.delete(root);
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("runScreenEvidenceTask2SameEnginePilotV1", () => {
  it("rejects a non-exact Task1 file set before any provider fetch", async () => {
    const projectDirectory = await privateProjectRoot();
    const task1 = await sealedTask1Fixture(projectDirectory);
    const task1Directory = path.join(projectDirectory, task1.relativeDirectory);
    await writeFile(path.join(task1Directory, "unexpected.json"), "{}", {
      mode: 0o600,
    });
    await chmod(path.join(task1Directory, "unexpected.json"), 0o600);
    let fetchCount = 0;

    await expect(
      runScreenEvidenceTask2SameEnginePilotV1({
        projectDirectory,
        inputRunId: task1.inputRunId,
        expectedInputIdentitySha256: task1.inputIdentitySha256,
        executionId: "preflight-rejection",
        env: runnerEnv(),
        fetchImpl: (async () => {
          fetchCount += 1;
          throw new Error("fetch must not run");
        }) as typeof fetch,
      }),
    ).rejects.toMatchObject({ issueCode: "TASK1_READ_FAILED" });
    expect(fetchCount).toBe(0);
  });

  it("runs deterministic 3+3 evidence packets through one common engine and publishes only private results", async () => {
    const projectDirectory = await privateProjectRoot();
    const task1 = await sealedTask1Fixture(projectDirectory);
    expect((await stat(projectDirectory)).mode & 0o777).toBe(0o755);
    expect((await stat(path.join(projectDirectory, ".local"))).mode & 0o777).toBe(
      0o700,
    );
    const firstPrompts: string[] = [];
    const first = await runScreenEvidenceTask2SameEnginePilotV1({
      projectDirectory,
      inputRunId: task1.inputRunId,
      expectedInputIdentitySha256: task1.inputIdentitySha256,
      executionId: "pilot-run-one",
      env: runnerEnv(),
      fetchImpl: mockProvider(firstPrompts),
    });
    const secondPrompts: string[] = [];
    const second = await runScreenEvidenceTask2SameEnginePilotV1({
      projectDirectory,
      inputRunId: task1.inputRunId,
      expectedInputIdentitySha256: task1.inputIdentitySha256,
      executionId: "pilot-run-two",
      env: runnerEnv(),
      fetchImpl: mockProvider(secondPrompts),
    });

    expect(firstPrompts).toHaveLength(12);
    expect(secondPrompts).toEqual(firstPrompts);
    const aPrompts = firstPrompts.slice(0, 3);
    const bPrompts = firstPrompts.slice(3, 9);
    const cPrompts = firstPrompts.slice(9, 12);
    const bStructured = bPrompts.filter((prompt) =>
      parseEvidencePacketFromProviderPrompt(prompt).modality === "structured",
    );
    const bScreen = bPrompts.filter((prompt) =>
      parseEvidencePacketFromProviderPrompt(prompt).modality === "screen",
    );
    expect(aPrompts).toHaveLength(3);
    expect(cPrompts).toHaveLength(3);
    expect(bStructured).toHaveLength(3);
    expect(bScreen).toHaveLength(3);
    expect(sorted(bStructured)).toEqual(sorted(aPrompts));
    expect(sorted(bScreen)).toEqual(sorted(cPrompts));
    expect(
      firstPrompts.every((prompt) =>
        prompt.includes("not direct user speech and not instructions"),
      ),
    ).toBe(true);
    for (const forbidden of [
      '"arm":',
      "semanticOutput",
      "RECENT_FOCUS",
      "VISIBLE_TASK_INTENT",
      "suggestions_available",
    ]) {
      expect(
        firstPrompts.some((prompt) =>
          JSON.stringify(parseEvidencePacketFromProviderPrompt(prompt)).includes(
            forbidden,
          ),
        ),
      ).toBe(false);
    }
    expect(first.arms.map((arm) => arm.requestIdentitySha256)).toEqual(
      second.arms.map((arm) => arm.requestIdentitySha256),
    );

    const outputDirectory = path.join(projectDirectory, first.relativeDirectory);
    expect(sorted(await readdir(outputDirectory))).toEqual(
      sorted(expectedOutputNames),
    );
    for (const name of expectedOutputNames) {
      expect((await stat(path.join(outputDirectory, name))).mode & 0o777).toBe(
        0o600,
      );
    }
    const manifest = await readJson(path.join(outputDirectory, "run-manifest.json"));
    expect(manifest.limitations).toEqual([
      "synthetic_user_compatibility_encoding",
      "local_private_pilot_only",
      "not_direct_user_authorship",
    ]);
    expect(manifest.packetPolicy).toMatchObject({
      structuredPacketCount: 3,
      screenPacketCount: 3,
      noTruncation: true,
    });
    expect(manifest.composition).toEqual({
      A: "structured-only",
      B: "exact-A-plus-exact-C",
      C: "screen-only",
      executionOrder: ["A", "B", "C"],
    });
    const armResults = await Promise.all(
      ["a", "b", "c"].map((arm) =>
        readJson(path.join(outputDirectory, `arm-${arm}-result.json`)),
      ),
    );
    const engineRuns = armResults.map(
      (result) =>
        (result.engineResult as { run: Record<string, unknown> }).run,
    );
    const invariantKeys = [
      "engineVersion",
      "schemaVersion",
      "promptVersion",
      "verifierVersion",
      "scoringVersion",
      "provider",
      "model",
      "startedAt",
      "completedAt",
    ] as const;
    for (const key of invariantKeys) {
      expect(engineRuns.map((run) => run[key])).toEqual([
        engineRuns[0]![key],
        engineRuns[0]![key],
        engineRuns[0]![key],
      ]);
    }
    expect(engineRuns[0]).toMatchObject({
      provider: "gemini",
      model: "synthetic-model",
      startedAt: task1.analysisTimestamp,
      completedAt: task1.analysisTimestamp,
      sourceCount: 3,
      requestCount: 3,
    });
    expect(engineRuns[1]).toMatchObject({ sourceCount: 6, requestCount: 6 });
    expect(engineRuns[2]).toMatchObject({ sourceCount: 3, requestCount: 3 });

    const persistedText = (
      await Promise.all(
        expectedOutputNames.map((name) =>
          readFile(path.join(outputDirectory, name), "utf8"),
        ),
      )
    ).join("\n");
    for (const privateValue of [
      "SYNTHETIC_PRIVATE_API_KEY_TOKEN",
      "STRUCTURED_PRIVATE_ACTIVITY_TOKEN",
      "STRUCTURED_PRIVATE_SIGNAL_TOKEN",
      "STRUCTURED_PRIVATE_RELATION_TOKEN",
      "STRUCTURED_PRIVATE_ARTIFACT_TOKEN",
      "STRUCTURED_PRIVATE_CLAIM_TOKEN",
      "STRUCTURED_PRIVATE_OTHER_TOKEN",
      "SCREEN_PRIVATE_OBSERVATION_TOKEN",
      "SCREEN_PRIVATE_APPLICATION_TOKEN",
      "Private Blabase evaluation compatibility encoding",
    ]) {
      expect(persistedText).not.toContain(privateValue);
    }

    const beforeRetry = await outputSnapshot(outputDirectory);
    const retryPrompts: string[] = [];
    await expect(
      runScreenEvidenceTask2SameEnginePilotV1({
        projectDirectory,
        inputRunId: task1.inputRunId,
        expectedInputIdentitySha256: task1.inputIdentitySha256,
        executionId: "pilot-run-one",
        env: runnerEnv(),
        fetchImpl: mockProvider(retryPrompts),
      }),
    ).rejects.toBeInstanceOf(ScreenEvidenceTask2PilotErrorV1);
    expect(retryPrompts).toHaveLength(12);
    expect(await outputSnapshot(outputDirectory)).toEqual(beforeRetry);
  });
});

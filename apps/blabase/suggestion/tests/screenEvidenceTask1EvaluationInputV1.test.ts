import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCREEN_EVIDENCE_TASK1_INPUT_STORED_FILES_V1,
  ScreenEvidenceTask1SealErrorV1,
  sealTask1EvaluationInputV1,
} from "../src/evaluation/screenEvidenceAblation/sealTask1EvaluationInputV1";
import type {
  SealScreenEvidenceTask1EvaluationInputV1Input,
} from "../src/evaluation/screenEvidenceAblation/sealTask1EvaluationInputV1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roots = new Set<string>();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytes(source: string): Uint8Array {
  return encoder.encode(source);
}

function copyBytes(source: Uint8Array): Uint8Array {
  return new Uint8Array(source);
}

async function privateProjectRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "blabase-screen-task1-"),
  );
  await chmod(root, 0o700);
  roots.add(root);
  return root;
}

function fixture(projectDirectory: string): Readonly<{
  input: SealScreenEvidenceTask1EvaluationInputV1Input;
  structuredBytes: Uint8Array;
  sourceBytes: Uint8Array[];
}> {
  const structuredBytes = bytes('{"currentWork":"synthetic"}');
  const payload = bytes('{"observations":[],"sourceRevision":7}');
  const manifest = bytes('{"payload":"synthetic-screen-evidence"}');
  const manifestHash = sha256(manifest);
  const sourceBytes = [
    payload,
    manifest,
    bytes(manifestHash),
    bytes(manifestHash),
  ];
  const relativePaths = [
    "payload.json",
    "manifest.json",
    "manifest.sha256",
    "COMPLETE",
  ] as const;
  const copySourceEntries = () =>
    Object.freeze({
      bundleDirectoryName: "screen-export-001",
      entries: Object.freeze(
        relativePaths.map((relativePath, index) => {
          const owned = copyBytes(sourceBytes[index]!);
          return Object.freeze({
            relativePath,
            entryKind: "regular-file" as const,
            byteLength: owned.byteLength,
            bytes: owned,
          });
        }),
      ),
    });
  const startEpochSecond = 1_700_000_000;
  const endEpochSecond = startEpochSecond + 599;
  return Object.freeze({
    structuredBytes,
    sourceBytes,
    input: {
      projectDirectory,
      inputRunId: "task1-input-001",
      structured: {
        bytes: structuredBytes,
        startEpochSecond,
        endEpochSecond,
        asOfEpochSecond: endEpochSecond,
        byteLength: structuredBytes.byteLength,
        rawSha256: sha256(structuredBytes),
        contentSha256: sha256(bytes("structured-content-identity")),
      },
      screen: {
        readback: { copySourceEntries },
        startEpochMs: startEpochSecond * 1_000,
        endEpochMs: endEpochSecond * 1_000,
        sourceRevision: 7,
        manifestSha256: manifestHash,
        payloadSha256: sha256(payload),
        replayIdentitySha256: sha256(bytes("screen-replay-identity")),
      },
      selection: {
        sourceSnapshotIdentitySha256: sha256(bytes("snapshot-identity")),
        privacyReceiptSetSha256: sha256(bytes("privacy-receipt-set")),
        retentionAsOfEpochMs: endEpochSecond * 1_000,
      },
    },
  });
}

function withInput(
  input: SealScreenEvidenceTask1EvaluationInputV1Input,
  change: Partial<SealScreenEvidenceTask1EvaluationInputV1Input>,
): SealScreenEvidenceTask1EvaluationInputV1Input {
  return { ...input, ...change };
}

afterEach(async () => {
  await Promise.all(
    [...roots].map(async (root) => {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }),
  );
});

describe("sealTask1EvaluationInputV1", () => {
  it("seals one aligned 600-second input with exact canonical bindings and COMPLETE last", async () => {
    const projectDirectory = await privateProjectRoot();
    const { input } = fixture(projectDirectory);

    const sealed = await sealTask1EvaluationInputV1(input);
    const runDirectory = path.join(projectDirectory, sealed.relativeDirectory);
    const actualNames = await readdir(runDirectory);

    expect(sealed.relativeDirectory).toBe(
      ".local/evaluations/screen-evidence-ablation/task1-inputs/task1-input-001",
    );
    expect(sealed.directoryMode).toBe(0o700);
    expect(sealed.files.map((file) => file.relativePath)).toEqual(
      SCREEN_EVIDENCE_TASK1_INPUT_STORED_FILES_V1,
    );
    expect([...actualNames].sort()).toEqual(
      [...SCREEN_EVIDENCE_TASK1_INPUT_STORED_FILES_V1].sort(),
    );
    expect(sealed.files.at(-1)?.relativePath).toBe("COMPLETE");
    expect(sealed.manifest.window).toEqual({
      startEpochSecond: input.structured.startEpochSecond,
      endEpochSecond: input.structured.endEpochSecond,
      durationSeconds: 600,
      semantics: "inclusive",
      screenStartEpochMs: input.screen.startEpochMs,
      screenEndEpochMs: input.screen.endEpochMs,
    });
    expect(sealed.manifest.structuredEvidence).toMatchObject({
      rawSha256: input.structured.rawSha256,
      contentSha256: input.structured.contentSha256,
    });
    expect(sealed.manifest.screenEvidence).toMatchObject({
      sourceRevision: input.screen.sourceRevision,
      manifestSha256: input.screen.manifestSha256,
      payloadSha256: input.screen.payloadSha256,
      replayIdentitySha256: input.screen.replayIdentitySha256,
    });
    expect(sealed.manifest.selection).toMatchObject(input.selection);
    expect(sealed.inputIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);

    const manifestBytes = new Uint8Array(
      await readFile(path.join(runDirectory, "evaluation-input-manifest.json")),
    );
    const manifestHash = sha256(manifestBytes);
    expect(JSON.parse(decoder.decode(manifestBytes))).toEqual(sealed.manifest);
    expect(manifestHash).toBe(sealed.manifestRawSha256);
    expect(
      decoder.decode(
        await readFile(
          path.join(runDirectory, "evaluation-input-manifest.sha256"),
        ),
      ),
    ).toBe(manifestHash);
    expect(decoder.decode(await readFile(path.join(runDirectory, "COMPLETE")))).toBe(
      manifestHash,
    );
    for (const relativePath of SCREEN_EVIDENCE_TASK1_INPUT_STORED_FILES_V1) {
      expect((await stat(path.join(runDirectory, relativePath))).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("rejects non-inclusive structured windows and any screen millisecond misalignment", async () => {
    const projectDirectory = await privateProjectRoot();
    const { input } = fixture(projectDirectory);
    const invalidInputs = [
      withInput(input, {
        structured: {
          ...input.structured,
          endEpochSecond: input.structured.endEpochSecond + 1,
          asOfEpochSecond: input.structured.endEpochSecond + 1,
        },
      }),
      withInput(input, {
        structured: {
          ...input.structured,
          asOfEpochSecond: input.structured.endEpochSecond - 1,
        },
      }),
      withInput(input, {
        screen: { ...input.screen, startEpochMs: input.screen.startEpochMs + 1 },
      }),
      withInput(input, {
        screen: { ...input.screen, endEpochMs: input.screen.endEpochMs - 1 },
      }),
    ];

    for (let index = 0; index < invalidInputs.length; index += 1) {
      await expect(
        sealTask1EvaluationInputV1({
          ...invalidInputs[index]!,
          inputRunId: `invalid-window-${index}`,
        }),
      ).rejects.toMatchObject({ issueCode: "WINDOW_INVALID" });
    }
  });

  it("rejects structured and ScreenEvidence hash drift before publication", async () => {
    const projectDirectory = await privateProjectRoot();
    const { input } = fixture(projectDirectory);

    await expect(
      sealTask1EvaluationInputV1({
        ...input,
        inputRunId: "structured-hash-drift",
        structured: {
          ...input.structured,
          rawSha256: sha256(bytes("not-the-structured-bytes")),
        },
      }),
    ).rejects.toMatchObject({ issueCode: "STRUCTURED_EVIDENCE_INVALID" });

    await expect(
      sealTask1EvaluationInputV1({
        ...input,
        inputRunId: "screen-hash-drift",
        screen: {
          ...input.screen,
          payloadSha256: sha256(bytes("not-the-payload")),
        },
      }),
    ).rejects.toMatchObject({ issueCode: "SCREEN_EVIDENCE_INVALID" });

    await expect(
      sealTask1EvaluationInputV1({
        ...input,
        inputRunId: "invalid-selection",
        selection: { ...input.selection, privacyReceiptSetSha256: "private" },
      }),
    ).rejects.toBeInstanceOf(ScreenEvidenceTask1SealErrorV1);
  });

  it("owns caller bytes and preserves the first winner on a repeated inputRunId", async () => {
    const projectDirectory = await privateProjectRoot();
    const { input, structuredBytes, sourceBytes } = fixture(projectDirectory);
    const expectedStructured = copyBytes(structuredBytes);
    const expectedPayload = copyBytes(sourceBytes[0]!);

    const firstPublication = sealTask1EvaluationInputV1(input);
    structuredBytes.fill(0x78);
    sourceBytes[0]!.fill(0x79);
    const first = await firstPublication;
    const runDirectory = path.join(projectDirectory, first.relativeDirectory);

    expect(
      new Uint8Array(await readFile(path.join(runDirectory, "structured-evidence.json"))),
    ).toEqual(expectedStructured);
    expect(
      new Uint8Array(
        await readFile(path.join(runDirectory, "screen-evidence-payload.json")),
      ),
    ).toEqual(expectedPayload);

    const firstCopy = first.copyFiles();
    const secondCopy = first.copyFiles();
    expect(firstCopy).not.toBe(secondCopy);
    expect(firstCopy[0]?.bytes).not.toBe(secondCopy[0]?.bytes);
    firstCopy[0]?.bytes.fill(0x61);
    expect(secondCopy[0]?.bytes).toEqual(expectedStructured);

    const retry = fixture(projectDirectory).input;
    await expect(sealTask1EvaluationInputV1(retry)).rejects.toMatchObject({
      issueCode: "PUBLICATION_FAILED",
    });
    expect(
      new Uint8Array(await readFile(path.join(runDirectory, "structured-evidence.json"))),
    ).toEqual(expectedStructured);
    expect(
      (await readdir(runDirectory)).sort(),
    ).toEqual([...SCREEN_EVIDENCE_TASK1_INPUT_STORED_FILES_V1].sort());
  });
});

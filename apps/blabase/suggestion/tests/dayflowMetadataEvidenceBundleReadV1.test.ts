import { createHash } from "node:crypto";
import {
  chmod,
  chown,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1,
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_SCHEMA_VERSION,
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
  DayflowMetadataEvidenceBundleReadErrorV1,
  readDayflowMetadataEvidenceBundleV1,
  type DayflowMetadataEvidenceBundleReadIssueCodeV1,
  type ReadDayflowMetadataEvidenceBundleV1Input,
} from "../src/evaluation/dayflowAblation/readDayflowMetadataEvidenceBundleV1";

const EXPORT_RUN_ID = "task1c_synthetic_100_699_v1";
const SWIFT_FIXTURE_DIRECTORY = new URL(
  "./fixtures/dayflow-metadata-evidence-bundle-v1/swift-task1c-synthetic-1/",
  import.meta.url,
);
const cleanupRoots: string[] = [];

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeSyntheticBundle(): Promise<{
  input: ReadDayflowMetadataEvidenceBundleV1Input;
  root: string;
  bundle: string;
}> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "blabase-task1c-bridge-"));
  cleanupRoots.push(temporaryRoot);
  await chmod(temporaryRoot, 0o700);
  const root = await realpath(temporaryRoot);
  const bundle = join(root, EXPORT_RUN_ID);
  await mkdir(bundle, { mode: 0o700 });
  await chmod(bundle, 0o700);

  const files = new Map<string, Uint8Array>();
  for (const relativePath of DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1) {
    files.set(
      relativePath,
      new Uint8Array(
        await readFile(new URL(relativePath, SWIFT_FIXTURE_DIRECTORY)),
      ),
    );
  }
  for (const relativePath of DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1) {
    await writeFile(join(bundle, relativePath), files.get(relativePath)!, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(join(bundle, relativePath), 0o600);
  }
  return {
    root,
    bundle,
    input: {
      mode: "synthetic-task1-handoff",
      outputRoot: root,
      bundleDirectoryName: EXPORT_RUN_ID,
    },
  };
}

async function expectIssue(
  input: ReadDayflowMetadataEvidenceBundleV1Input,
  issueCode: DayflowMetadataEvidenceBundleReadIssueCodeV1,
): Promise<void> {
  try {
    await readDayflowMetadataEvidenceBundleV1(input);
    throw new TypeError("Expected bundle read to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DayflowMetadataEvidenceBundleReadErrorV1);
    if (!(error instanceof DayflowMetadataEvidenceBundleReadErrorV1)) {
      throw error;
    }
    expect(error.issueCode).toBe(issueCode);
    expect(error.message).toBe(
      "Dayflow metadata evidence bundle read failed (" + issueCode + ")",
    );
    expect(error.message).not.toContain(input.outputRoot);
    expect(error.message).not.toContain(input.bundleDirectoryName);
  }
}

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Task 1D synthetic filesystem facade isolation", () => {
  it("does not accept the real private-pilot source label", async () => {
    await expect(
      readDayflowMetadataEvidenceBundleV1({
        mode: "real-private-pilot",
        outputRoot: "/private/tmp/not-read",
        bundleDirectoryName: "task1d_not_read",
      } as unknown as Parameters<
        typeof readDayflowMetadataEvidenceBundleV1
      >[0]),
    ).rejects.toMatchObject({ issueCode: "BUNDLE_INPUT_INVALID" });
  });
});

describe("Task 1C Dayflow metadata evidence filesystem bridge", () => {
  it("qualifies the exact source order and returns immutable metadata with fresh owned copies", async () => {
    const { input } = await makeSyntheticBundle();
    const result = await readDayflowMetadataEvidenceBundleV1(input);

    expect(result.bridgeDescriptor).toEqual({
      readSchemaVersion: DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_SCHEMA_VERSION,
      mode: "synthetic-task1-handoff",
      bundleDirectoryName: EXPORT_RUN_ID,
      sourceOrder: [...DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1],
    });
    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(
      DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
    );
    expect(result.imported.descriptor.exportRunId).toBe(EXPORT_RUN_ID);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.bridgeDescriptor)).toBe(true);
    expect(Object.isFrozen(result.bridgeDescriptor.sourceOrder)).toBe(true);
    expect(Object.isFrozen(result.sourceFiles)).toBe(true);
    expect(result.sourceFiles.every(Object.isFrozen)).toBe(true);

    const first = result.copySourceEntries();
    const second = result.copySourceEntries();
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]).not.toBe(second[index]);
      expect(first[index]!.bytes).not.toBe(second[index]!.bytes);
      expect(Object.getPrototypeOf(first[index]!.bytes)).toBe(
        Uint8Array.prototype,
      );
      expect(first[index]!.bytes.buffer).toBeInstanceOf(ArrayBuffer);
      expect(Object.isFrozen(first[index])).toBe(true);
    }
    first[0]!.bytes.fill(0);
    expect(rawSha256(second[0]!.bytes)).toBe(
      result.sourceFiles[0]!.rawSha256,
    );
    expect(
      rawSha256(result.copySourceEntries()[0]!.bytes),
    ).toBe(result.sourceFiles[0]!.rawSha256);
  });

  it("rejects hostile input, unsafe roots, and unsafe bundle names without path disclosure", async () => {
    const { input, root } = await makeSyntheticBundle();
    await expectIssue(
      { ...input, outputRoot: "relative-root" },
      "BUNDLE_INPUT_INVALID",
    );
    await expectIssue(
      { ...input, bundleDirectoryName: "../escape" },
      "BUNDLE_INPUT_INVALID",
    );
    const accessor = { ...input } as Record<string, unknown>;
    Object.defineProperty(accessor, "outputRoot", {
      enumerable: true,
      get: () => root,
    });
    await expectIssue(
      accessor as unknown as ReadDayflowMetadataEvidenceBundleV1Input,
      "BUNDLE_INPUT_INVALID",
    );
    await expectIssue(
      new Proxy(input, {}),
      "BUNDLE_INPUT_INVALID",
    );

    await chmod(root, 0o755);
    await expectIssue(input, "OUTPUT_ROOT_UNSAFE");
  });

  it("rejects missing and extra source entries before import", async () => {
    const missing = await makeSyntheticBundle();
    await rm(join(missing.bundle, "COMPLETE"));
    await expectIssue(missing.input, "BUNDLE_INCOMPLETE");

    const extra = await makeSyntheticBundle();
    await writeFile(join(extra.bundle, "extra.json"), "{}", { mode: 0o600 });
    await chmod(join(extra.bundle, "extra.json"), 0o600);
    await expectIssue(extra.input, "ENTRY_SET_MISMATCH");
  });

  it("rejects unsafe directory modes, file modes, symlinks, hard links, and non-regular files", async () => {
    const unsafeDirectory = await makeSyntheticBundle();
    await chmod(unsafeDirectory.bundle, 0o755);
    await expectIssue(
      unsafeDirectory.input,
      "BUNDLE_DIRECTORY_UNSAFE",
    );

    const unsafeMode = await makeSyntheticBundle();
    await chmod(join(unsafeMode.bundle, "payload.json"), 0o644);
    await expectIssue(unsafeMode.input, "FILE_UNSAFE");

    const symbolic = await makeSyntheticBundle();
    const symbolicPayload = join(symbolic.bundle, "payload.json");
    const symbolicBacking = join(symbolic.root, "payload-backing.json");
    await rename(symbolicPayload, symbolicBacking);
    await symlink(symbolicBacking, symbolicPayload);
    await expectIssue(symbolic.input, "FILE_UNSAFE");

    const hardLinked = await makeSyntheticBundle();
    await link(
      join(hardLinked.bundle, "payload.json"),
      join(hardLinked.root, "payload-hard-link.json"),
    );
    await expectIssue(hardLinked.input, "FILE_UNSAFE");

    const nonRegular = await makeSyntheticBundle();
    const nonRegularPayload = join(nonRegular.bundle, "payload.json");
    await rm(nonRegularPayload);
    await mkdir(nonRegularPayload, { mode: 0o700 });
    await expectIssue(nonRegular.input, "FILE_UNSAFE");
  });

  it("enforces source byte caps before importer qualification", async () => {
    expect(DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1).toEqual({
      "payload.json": 5 * 1024 * 1024,
      "manifest.json": 16 * 1024,
      "manifest.sha256": 64,
      COMPLETE: 64,
    });
    const oversized = await makeSyntheticBundle();
    await truncate(
      join(oversized.bundle, "payload.json"),
      DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1["payload.json"] + 1,
    );
    await expectIssue(oversized.input, "RESOURCE_LIMIT_EXCEEDED");
  });

  it("uses the existing Task 1B importer as the qualification gate", async () => {
    const rejected = await makeSyntheticBundle();
    await writeFile(join(rejected.bundle, "COMPLETE"), "0".repeat(64));
    await chmod(join(rejected.bundle, "COMPLETE"), 0o600);
    await expectIssue(rejected.input, "IMPORT_REJECTED");
  });

  it("rejects owner mismatch when the test process can create one", async () => {
    if (process.geteuid?.() !== 0) return;
    const mismatch = await makeSyntheticBundle();
    await chown(
      join(mismatch.bundle, "payload.json"),
      1,
      process.getegid?.() ?? 0,
    );
    await expectIssue(mismatch.input, "FILE_UNSAFE");
  });

it("deterministically rejects metadata mutation during the pinned read", async () => {
  const { input, bundle } = await makeSyntheticBundle();
  const { readDayflowMetadataEvidenceBundleFilesystemV1Internal } =
    await import(
      "../src/evaluation/dayflowAblation/dayflowMetadataEvidenceBundleFilesystemReadV1.internal"
    );

  try {
    await expect(
      readDayflowMetadataEvidenceBundleFilesystemV1Internal(
        {
          outputRoot: input.outputRoot,
          bundleDirectoryName: input.bundleDirectoryName,
        },
        {
          afterFileRead: async (relativePath) => {
            if (relativePath === "payload.json") {
              await chmod(join(bundle, relativePath), 0o400);
            }
          },
        },
      ),
    ).rejects.toMatchObject({ issueCode: "FILE_UNSTABLE" });
  } finally {
    await rm(input.outputRoot, { recursive: true, force: true });
  }
});
});

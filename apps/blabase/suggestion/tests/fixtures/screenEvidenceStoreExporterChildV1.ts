import { access, open, readFile } from "node:fs/promises";

import type {
  ScreenEvidenceBundleEntryV1,
  ScreenEvidenceBundleInputV1,
} from "../../src/screenEvidence/contractsV1";
import {
  publishScreenEvidenceBundleV1,
  ScreenEvidenceExportErrorV1,
} from "../../src/screenEvidence/exportScreenEvidenceBundleV1";
import type { PrivateScreenEvidenceCaptureRevisionV1 } from "../../src/screenEvidence/privateStoreContractsV1";
import {
  PrivateScreenEvidenceStoreErrorV1,
  readPrivateScreenEvidenceCaptureRevisionV1,
  writePrivateScreenEvidenceCaptureRevisionV1,
} from "../../src/screenEvidence/privateScreenEvidenceStoreV1";
import {
  readScreenEvidenceBundleV1,
  ScreenEvidenceReadErrorV1,
} from "../../src/screenEvidence/readScreenEvidenceBundleV1";

interface BarrierConfig {
  readonly readyPath: string;
  readonly startPath: string;
  readonly timeoutMs: number;
}

interface StoreWriteConfig {
  readonly operation: "store-write";
  readonly projectDirectory: string;
  readonly record: PrivateScreenEvidenceCaptureRevisionV1;
  readonly barrier: BarrierConfig;
  readonly resultPath: string;
}

interface StoreReadConfig {
  readonly operation: "store-read";
  readonly projectDirectory: string;
  readonly captureId: string;
  readonly revision: number;
  readonly resultPath: string;
}

interface SerializedBundleEntry {
  readonly relativePath: ScreenEvidenceBundleEntryV1["relativePath"];
  readonly entryKind: "regular-file";
  readonly byteLength: number;
  readonly bytesBase64: string;
}

interface PublishConfig {
  readonly operation: "publish";
  readonly projectDirectory: string;
  readonly bundle: Readonly<{
    bundleDirectoryName: string;
    entries: readonly SerializedBundleEntry[];
  }>;
  readonly barrier: BarrierConfig;
  readonly resultPath: string;
}

interface BundleReadConfig {
  readonly operation: "bundle-read";
  readonly bundleDirectory: string;
  readonly resultPath: string;
}

type DriverConfig =
  | StoreWriteConfig
  | StoreReadConfig
  | PublishConfig
  | BundleReadConfig;

interface FulfilledResult {
  readonly status: "fulfilled";
  readonly value: unknown;
}

interface RejectedResult {
  readonly status: "rejected";
  readonly errorName: string;
  readonly issueCode?: string;
}

type DriverResult = FulfilledResult | RejectedResult;

function isMissingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function writePrivateFile(
  filePath: string,
  contents: string,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  let completed = false;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(contents, "utf8");
    completed = true;
  } finally {
    if (completed) {
      await handle.close().catch(() => undefined);
    } else {
      await handle.close();
    }
  }
}

async function waitForBarrier(barrier: BarrierConfig): Promise<void> {
  await writePrivateFile(barrier.readyPath, "ready\n");
  const deadline = Date.now() + barrier.timeoutMs;

  for (;;) {
    try {
      await access(barrier.startPath);
      return;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("Timed out waiting for the child-process start barrier");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(10, remainingMs));
    });
  }
}

function decodeBundle(config: PublishConfig): ScreenEvidenceBundleInputV1 {
  return {
    bundleDirectoryName: config.bundle.bundleDirectoryName,
    entries: config.bundle.entries.map((entry) => {
      const decoded = Buffer.from(entry.bytesBase64, "base64");
      const bytes = new Uint8Array(decoded.byteLength);
      bytes.set(decoded);
      return {
        relativePath: entry.relativePath,
        entryKind: entry.entryKind,
        byteLength: entry.byteLength,
        bytes,
      };
    }),
  };
}

async function execute(config: DriverConfig): Promise<FulfilledResult> {
  switch (config.operation) {
    case "store-write": {
      await waitForBarrier(config.barrier);
      const stored = await writePrivateScreenEvidenceCaptureRevisionV1({
        projectDirectory: config.projectDirectory,
        record: config.record,
      });
      return {
        status: "fulfilled",
        value: {
          rawSha256: stored.rawSha256,
          record: stored.record,
        },
      };
    }
    case "store-read": {
      const stored = await readPrivateScreenEvidenceCaptureRevisionV1({
        projectDirectory: config.projectDirectory,
        captureId: config.captureId,
        revision: config.revision,
      });
      return {
        status: "fulfilled",
        value: {
          rawSha256: stored.rawSha256,
          record: stored.record,
        },
      };
    }
    case "publish": {
      await waitForBarrier(config.barrier);
      const published = await publishScreenEvidenceBundleV1({
        projectDirectory: config.projectDirectory,
        bundle: decodeBundle(config),
      });
      return {
        status: "fulfilled",
        value: {
          bundleDirectory: published.bundleDirectory,
          payloadSha256: published.readback.imported.descriptor.payloadSha256,
          manifestSha256: published.readback.imported.descriptor.manifestSha256,
        },
      };
    }
    case "bundle-read": {
      const readback = await readScreenEvidenceBundleV1({
        bundleDirectory: config.bundleDirectory,
      });
      return {
        status: "fulfilled",
        value: {
          payloadSha256: readback.imported.descriptor.payloadSha256,
          manifestSha256: readback.imported.descriptor.manifestSha256,
          exportRunId: readback.imported.evidence.exportRunId,
          evidence: readback.imported.evidence,
        },
      };
    }
  }
}

function rejected(error: unknown): RejectedResult {
  if (
    error instanceof PrivateScreenEvidenceStoreErrorV1 ||
    error instanceof ScreenEvidenceExportErrorV1 ||
    error instanceof ScreenEvidenceReadErrorV1
  ) {
    return {
      status: "rejected",
      errorName: error.name,
      issueCode: error.issueCode,
    };
  }
  return {
    status: "rejected",
    errorName: error instanceof Error ? error.name : "UnknownError",
  };
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (configPath === undefined) {
    throw new Error("Expected a config JSON path");
  }
  const config = JSON.parse(await readFile(configPath, "utf8")) as DriverConfig;

  let result: DriverResult;
  try {
    result = await execute(config);
  } catch (error) {
    result = rejected(error);
  }

  await writePrivateFile(config.resultPath, JSON.stringify(result));
}

await main();

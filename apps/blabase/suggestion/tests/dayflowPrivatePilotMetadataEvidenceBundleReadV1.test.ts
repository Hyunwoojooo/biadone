import { chmod, copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_SCHEMA_VERSION,
  DAYFLOW_PRIVATE_PILOT_ID,
  DAYFLOW_PRIVATE_PILOT_POLICY_SHA256,
  DayflowPrivatePilotReadErrorV1,
  readPrivatePilotDayflowMetadataEvidenceBundleV1,
  type ReadPrivatePilotDayflowMetadataEvidenceBundleV1Input,
} from "../src/evaluation/dayflowAblation/readPrivatePilotDayflowMetadataEvidenceBundleV1";

const exportRunId = "task1c_synthetic_100_699_v1";
const fixtureRoot = fileURLToPath(
  new URL(
    "./fixtures/dayflow-metadata-evidence-bundle-v1/swift-task1c-synthetic-1/",
    import.meta.url,
  ),
);
const sourceOrder = ["payload.json", "manifest.json", "manifest.sha256", "COMPLETE"] as const;
const cleanup: string[] = [];

async function makeInput(): Promise<ReadPrivatePilotDayflowMetadataEvidenceBundleV1Input> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "blabase-private-pilot-read-"));
  cleanup.push(temporaryRoot);
  await chmod(temporaryRoot, 0o700);
  const outputRoot = await realpath(temporaryRoot);
  const bundleDirectory = path.join(outputRoot, exportRunId);
  await mkdir(bundleDirectory, { mode: 0o700 });
  for (const relativePath of sourceOrder) {
    const destination = path.join(bundleDirectory, relativePath);
    await copyFile(path.join(fixtureRoot, relativePath), destination);
    await chmod(destination, 0o600);
  }
  return {
    sourceMode: "real-private-pilot",
    outputRoot,
    bundleDirectoryName: exportRunId,
    captureBinding: {
      schemaVersion: DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_SCHEMA_VERSION,
      pilotId: DAYFLOW_PRIVATE_PILOT_ID,
      authorizationId: "task1d_wire_compatibility_only",
      policySha256: DAYFLOW_PRIVATE_PILOT_POLICY_SHA256,
      expectedExportRunId: exportRunId,
      window: { startEpochSecond: 100, endEpochSecond: 699 },
    },
  };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function expectIssue(input: unknown, issueCode: string) {
  try {
    await readPrivatePilotDayflowMetadataEvidenceBundleV1(
      input as ReadPrivatePilotDayflowMetadataEvidenceBundleV1Input,
    );
    throw new Error("expected private-pilot read rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(DayflowPrivatePilotReadErrorV1);
    expect(error).toMatchObject({ issueCode });
    expect(String(error)).not.toContain("/private/");
  }
}

describe("readPrivatePilotDayflowMetadataEvidenceBundleV1", () => {
  it("qualifies the authentic Swift synthetic fixture only as wire compatibility", async () => {
    const result = await readPrivatePilotDayflowMetadataEvidenceBundleV1(await makeInput());
    expect(result.sourceDescriptor).toMatchObject({
      sourceMode: "real-private-pilot",
      bundleDirectoryName: exportRunId,
    });
    expect(result.qualified.descriptor.exportRunId).toBe(exportRunId);
    expect(result).not.toHaveProperty("imported");
    expect(result).not.toHaveProperty("bridgeDescriptor");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceDescriptor.captureBinding)).toBe(true);
    const first = result.copySourceEntries();
    const second = result.copySourceEntries();
    expect(first).not.toBe(second);
    expect(first[0]?.bytes).not.toBe(second[0]?.bytes);
  });

  it("rejects the synthetic label before touching the filesystem", async () => {
    await expectIssue(
      {
        sourceMode: "synthetic-task1-handoff",
        outputRoot: "/private/tmp/not-read",
        bundleDirectoryName: exportRunId,
        captureBinding: {},
      },
      "PRIVATE_PILOT_INPUT_INVALID",
    );
  });

  it("closes policy, authorization, duration and export-run binding", async () => {
    const base = await makeInput();
    await expectIssue(
      { ...base, captureBinding: { ...base.captureBinding, policySha256: "0".repeat(64) } },
      "CAPTURE_BINDING_INVALID",
    );
    await expectIssue(
      { ...base, captureBinding: { ...base.captureBinding, authorizationId: "../unsafe" } },
      "CAPTURE_BINDING_INVALID",
    );
    await expectIssue(
      { ...base, captureBinding: { ...base.captureBinding, window: { startEpochSecond: 100, endEpochSecond: 700 } } },
      "CAPTURE_BINDING_INVALID",
    );
    await expectIssue(
      { ...base, captureBinding: { ...base.captureBinding, expectedExportRunId: "another_run" } },
      "CAPTURE_BINDING_MISMATCH",
    );
  });

  it("binds the qualified payload to the authorized exact window", async () => {
    const base = await makeInput();
    await expectIssue(
      { ...base, captureBinding: { ...base.captureBinding, window: { startEpochSecond: 101, endEpochSecond: 700 } } },
      "CAPTURE_BINDING_MISMATCH",
    );
  });

  it("rejects accessor and proxy input without invoking them", async () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, "sourceMode", {
      enumerable: true,
      get() {
        invoked = true;
        return "real-private-pilot";
      },
    });
    await expectIssue(accessor, "PRIVATE_PILOT_INPUT_INVALID");
    await expectIssue(new Proxy({}, {}), "PRIVATE_PILOT_INPUT_INVALID");
    expect(invoked).toBe(false);
  });
});

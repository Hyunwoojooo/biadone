import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { domainSeparatedSha256 } from "../src/dayflowEvidence/contracts";
import {
  buildTask1PrivatePilotAuthorizationV1,
  publishTask1PrivatePilotAuthorizationV1,
  TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER,
  TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
  TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
  TASK1_PRIVATE_PILOT_POLICY_ID,
  TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION,
  TASK1_PRIVATE_PILOT_POLICY_SHA256,
  Task1PrivatePilotAuthorizationErrorV1,
  verifyPublishedTask1PrivatePilotAuthorizationV1,
  type BuildTask1PrivatePilotAuthorizationV1Input,
  type Task1PrivatePilotAuthorizationIssueCodeV1,
} from "../src/evaluation/dayflowAblation/task1PrivatePilotAuthorizationV1";

const AUTHORIZED_AT_EPOCH_SECOND =
  Date.parse("2026-08-26T03:00:00.000Z") / 1_000;
const START_EPOCH_SECOND = AUTHORIZED_AT_EPOCH_SECOND + 60;
const EPISODE_ID = `episode_${"1".repeat(32)}`;
const WORKSPACE_IDENTITY_SHA256 = "2".repeat(64);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Task 1 private pilot authorization", () => {
  it("builds deterministic private authorization bytes and exact policy rules", () => {
    const first = buildTask1PrivatePilotAuthorizationV1(validInput());
    const second = buildTask1PrivatePilotAuthorizationV1(validInput());
    const files = first.copyArtifactFiles();

    expect(first.descriptor).toEqual(second.descriptor);
    expect(first.authorization).toEqual(second.authorization);
    expect(files.map((file) => file.relativePath)).toEqual(
      TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER,
    );
    const authorizationText = new TextDecoder().decode(files[0]!.bytes);
    expect(authorizationText.endsWith("\n")).toBe(true);
    expect(authorizationText.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(authorizationText)).toEqual(first.authorization);
    expect(authorizationText).not.toContain("/Users/");
    expect(first.descriptor.identitySha256).toBe(
      domainSeparatedSha256(
        TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
        first.authorization,
      ),
    );
    for (const marker of files.slice(1)) {
      const value = new TextDecoder().decode(marker.bytes);
      expect(value).toBe(first.descriptor.identitySha256);
      expect(value).toMatch(/^[a-f0-9]{64}$/u);
      expect(value).not.toContain("\n");
    }
    expect(first.authorization).toMatchObject({
      authorization: {
        authorizedBy: "colin",
        decision: "authorized",
        sourceMode: "real-private-pilot",
        episodeId: EPISODE_ID,
        workspaceIdentitySha256: WORKSPACE_IDENTITY_SHA256,
        expectedExportRunId:
          `task1_private_pilot_${START_EPOCH_SECOND}_${"1".repeat(32)}`,
      },
      window: {
        startEpochSecond: START_EPOCH_SECOND,
        endEpochSecond: START_EPOCH_SECOND + 599,
        durationSeconds: 600,
        semantics: "inclusive",
        asOf: new Date((START_EPOCH_SECOND + 599) * 1_000).toISOString(),
      },
      handling: {
        outputProfile: "metadata-only.v1",
        storageMode: "local-only",
        manualRepairAllowed: false,
      },
      structuredEvidence: {
        managedCodexRequired: true,
        githubIfConfiguredReadFails: "reject-entire-window",
      },
      quality: {
        rejectIssueCodes: [
          "NO_SCREENSHOT_METADATA_IN_WINDOW",
          "CAPTURE_GAP_DETECTED",
          "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
          "DATABASE_SCHEMA_USER_VERSION_UNSET",
        ],
      },
      retention: {
        incompleteStagingSeconds: 3_600,
        dayflowRawMaximumSeconds: 86_400,
        sealedPrivateInputMaximumSeconds: 2_592_000,
      },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.authorization)).toBe(true);

    files[0]!.bytes[0] = 0;
    expect(first.copyArtifactFiles()[0]!.bytes[0]).not.toBe(0);
  });

  it.each([
    [
      "wrong reviewer",
      { ...validInput(), authorizedBy: "david" },
      "AUTHORIZATION_INVALID",
    ],
    [
      "non-authorization decision",
      { ...validInput(), decision: "rejected" },
      "AUTHORIZATION_INVALID",
    ],
    [
      "synthetic source mode",
      { ...validInput(), sourceMode: "synthetic-task1-handoff" },
      "AUTHORIZATION_INVALID",
    ],
    [
      "non-opaque episode id",
      { ...validInput(), episodeId: "episode-readable" },
      "AUTHORIZATION_INVALID",
    ],
    [
      "uppercase workspace hash",
      { ...validInput(), workspaceIdentitySha256: "A".repeat(64) },
      "AUTHORIZATION_INVALID",
    ],
    [
      "wrong policy hash",
      {
        ...validInput(),
        policy: { ...validInput().policy, sha256: "f".repeat(64) },
      },
      "POLICY_INVALID",
    ],
    [
      "non-future start",
      { ...validInput(), startEpochSecond: AUTHORIZED_AT_EPOCH_SECOND },
      "WINDOW_INVALID",
    ],
    [
      "fractional start",
      { ...validInput(), startEpochSecond: START_EPOCH_SECOND + 0.5 },
      "WINDOW_INVALID",
    ],
    [
      "unsafe start",
      { ...validInput(), startEpochSecond: Number.MAX_SAFE_INTEGER },
      "WINDOW_INVALID",
    ],
    [
      "workspace path injection",
      { ...validInput(), workspacePath: "/Users/private/workspace" },
      "INPUT_INVALID",
    ],
  ] as const)("rejects %s", (_label, candidate, issueCode) => {
    expectBuildFailure(candidate, issueCode);
  });

  it("publishes without clobber and verifies exact same-process readback", async () => {
    const root = await temporaryRoot();
    const authorization = buildTask1PrivatePilotAuthorizationV1(validInput());
    const expectedDirectory = [
      ".local",
      "dayflow-ablation",
      "inputs",
      TASK1_PRIVATE_PILOT_POLICY_ID,
      "authorizations",
      authorization.descriptor.identitySha256,
    ].join("/");

    const published = await publishTask1PrivatePilotAuthorizationV1({
      dataRoot: root,
      authorization,
    });
    const verified = await verifyPublishedTask1PrivatePilotAuthorizationV1({
      dataRoot: root,
      authorization,
    });

    expect(published.relativeDirectory).toBe(expectedDirectory);
    expect(published.directoryMode).toBe(0o700);
    expect(published.files.map((file) => file.relativePath)).toEqual(
      TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER,
    );
    expect(published.files.every((file) => file.mode === 0o600)).toBe(true);
    expect(verified).toEqual(published);
    expect(
      await readFile(join(root, expectedDirectory, "authorization.sha256"), "utf8"),
    ).toBe(authorization.descriptor.identitySha256);
    await expect(
      publishTask1PrivatePilotAuthorizationV1({ dataRoot: root, authorization }),
    ).rejects.toMatchObject({ issueCode: "PUBLICATION_FAILED" });

    const forged = { ...authorization };
    await expect(
      verifyPublishedTask1PrivatePilotAuthorizationV1({
        dataRoot: root,
        authorization: forged,
      }),
    ).rejects.toMatchObject({ issueCode: "INPUT_INVALID" });
  });
});

function validInput(): BuildTask1PrivatePilotAuthorizationV1Input {
  return {
    schemaVersion: TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
    authorizedBy: "colin",
    decision: "authorized",
    sourceMode: "real-private-pilot",
    episodeId: EPISODE_ID,
    workspaceIdentitySha256: WORKSPACE_IDENTITY_SHA256,
    authorizedAtEpochSecond: AUTHORIZED_AT_EPOCH_SECOND,
    startEpochSecond: START_EPOCH_SECOND,
    policy: {
      schemaVersion: TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION,
      policyId: TASK1_PRIVATE_PILOT_POLICY_ID,
      sha256: TASK1_PRIVATE_PILOT_POLICY_SHA256,
    },
  };
}

function expectBuildFailure(
  candidate: unknown,
  issueCode: Task1PrivatePilotAuthorizationIssueCodeV1,
): void {
  try {
    buildTask1PrivatePilotAuthorizationV1(candidate as never);
    throw new Error("expected authorization build failure");
  } catch (error) {
    expect(error).toBeInstanceOf(Task1PrivatePilotAuthorizationErrorV1);
    expect(error).toMatchObject({ issueCode });
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "task1-private-pilot-auth-"));
  roots.push(root);
  return root;
}

import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { domainSeparatedSha256 } from "../src/dayflowEvidence/contracts";
import {
  canonicalJsonLfBytes,
  rawSha256,
} from "../src/evaluation/privateArtifactStore";
import {
  TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
  TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
} from "../src/evaluation/dayflowAblation/task1PrivatePilotAuthorizationV1";
import {
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
} from "../src/evaluation/dayflowAblation/task1PrivatePilotArtifactBudgetV0_2";
import { PRIVATE_PILOT_TASK1_RETENTION_V0_2 } from "../src/evaluation/dayflowAblation/sealPrivatePilotTask1EvaluationInputV0_2";
import { verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2 } from "../src/evaluation/dayflowAblation/verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2";

const encoder = new TextEncoder();
const roots: string[] = [];
const policy = Object.freeze({
  schemaVersion: "blabase.dayflow-ablation.task1c-policy.v0.1",
  policyId: "dayflow-ablation-private-pilot-v0.1",
  sha256:
    "da6ff5f6a9c4a5f62b04e81fdee6acf65d251689b1a96c93d2b0fd8b1e0a5ff2",
});
const identityDomain =
  "blabase.dayflow-ablation.task1-evaluation-input.v0.2";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

function canonicalNoLf(value: unknown): Uint8Array {
  return canonicalJsonLfBytes(value).subarray(0, -1);
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
}

async function createFixture(input?: Readonly<{ obsoleteRetention?: boolean }>) {
  const dataRoot = await realpath(
    await mkdtemp(join(tmpdir(), "task1d-2a-")),
  );
  roots.push(dataRoot);
  const startEpochSecond = 1_800_000_000;
  const endEpochSecond = startEpochSecond + 599;
  const asOf = new Date(endEpochSecond * 1_000).toISOString();
  const episodeId = "episode-private-pilot-test";
  const expectedExportRunId = "dayflow-private-pilot-test-run";
  const retention = input?.obsoleteRetention
    ? {
        stagingMaximumSeconds: 3_600,
        rawMaximumSeconds: 86_400,
        sealedInputMaximumSeconds: 2_592_000,
      }
    : PRIVATE_PILOT_TASK1_RETENTION_V0_2;
  const authorizationRecord = {
    schemaVersion: TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
    authorization: {
      authorizedBy: "colin",
      decision: "authorized",
      sourceMode: "real-private-pilot",
      episodeId,
      workspaceIdentitySha256: "1".repeat(64),
      authorizedAtEpochSecond: startEpochSecond - 60,
      authorizedAt: new Date((startEpochSecond - 60) * 1_000).toISOString(),
      expectedExportRunId,
    },
    policy,
    window: {
      startEpochSecond,
      endEpochSecond,
      durationSeconds: 600,
      semantics: "inclusive",
      asOf,
    },
    handling: { localOnly: true },
    structuredEvidence: { acquireAt: "window-end" },
    privacy: { screenshotsExcluded: true },
    quality: { interruptionPolicy: "fail-closed" },
    retention,
    failurePolicy: { retrySameEpisode: false },
    canonicalization: { storedAuthorization: "rfc8785-jcs.utf8.lf.v1" },
  };
  const authorizationBytes = canonicalJsonLfBytes(authorizationRecord);
  const authorizationIdentitySha256 = domainSeparatedSha256(
    TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
    authorizationRecord,
  );
  const structuredRecord = {
    schemaVersion:
      "blabase.dayflow-ablation.structured-current-work-evidence.v1",
    sourceState: "available",
    currentWorkEvidence: { items: [] },
  };
  const structuredBytes = canonicalNoLf(structuredRecord);
  const payloadBytes = canonicalNoLf({
    schemaVersion: "blabase.dayflow-metadata-evidence-payload.v1",
    exportRunId: expectedExportRunId,
    observations: [],
  });
  const sourceManifestBytes = canonicalNoLf({
    schemaVersion: "blabase.dayflow-metadata-evidence-manifest.v1",
    exportRunId: expectedExportRunId,
    payloadSha256: rawSha256(payloadBytes),
  });
  const sourceManifestIdentity = rawSha256(sourceManifestBytes);
  const sourceMarkerBytes = encoder.encode(sourceManifestIdentity);
  const captureBinding = {
    schemaVersion: "blabase.dayflow-ablation.private-pilot-capture-binding.v1",
    pilotId: "task1-private-pilot",
    authorizationId: authorizationIdentitySha256,
    policySha256: policy.sha256,
    expectedExportRunId,
    window: { startEpochSecond, endEpochSecond },
  };
  const replayIdentitySha256 = "7".repeat(64);
  const qualification = {
    qualificationSchemaVersion:
      "blabase.dayflow-ablation.metadata-evidence-bundle-qualification.v1",
    exportRunId: expectedExportRunId,
    manifestByteCount: sourceManifestBytes.byteLength,
    manifestSha256: sourceManifestIdentity,
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256: rawSha256(payloadBytes),
    replayIdentitySha256,
  };
  const sourceFiles = [
    ["payload.json", "dayflow-source-payload.json", payloadBytes],
    ["manifest.json", "dayflow-source-manifest.json", sourceManifestBytes],
    ["manifest.sha256", "dayflow-source-manifest.sha256", sourceMarkerBytes],
    ["COMPLETE", "dayflow-source-COMPLETE", sourceMarkerBytes],
  ].map(([sourceRelativePath, storedRelativePath, bytes]) => ({
    sourceRelativePath,
    storedRelativePath,
    byteLength: (bytes as Uint8Array).byteLength,
    rawSha256: rawSha256(bytes as Uint8Array),
  }));
  const manifest = {
    schemaVersion:
      "blabase.dayflow-ablation.task1-evaluation-input-manifest.v0.2",
    authorization: {
      schemaVersion: TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
      identityHashDomain:
        TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
      identitySha256: authorizationIdentitySha256,
      byteLength: authorizationBytes.byteLength,
      rawSha256: rawSha256(authorizationBytes),
      authorizedBy: "colin",
      decision: "authorized",
      authorizedAt: authorizationRecord.authorization.authorizedAt,
      episodeId,
      expectedExportRunId,
    },
    policy,
    sourceMode: "real-private-pilot",
    window: {
      startEpochSecond,
      endEpochSecond,
      durationSeconds: 600,
      semantics: "inclusive",
      asOf,
    },
    authorizationControls: {
      handling: authorizationRecord.handling,
      structuredEvidence: authorizationRecord.structuredEvidence,
      privacy: authorizationRecord.privacy,
      quality: authorizationRecord.quality,
      retention,
      failurePolicy: authorizationRecord.failurePolicy,
    },
    structured: {
      schemaVersion: structuredRecord.schemaVersion,
      asOf,
      githubMode: "unconfigured",
      storedRelativePath: "structured-evidence.json",
      byteLength: structuredBytes.byteLength,
      rawSha256: rawSha256(structuredBytes),
      contentSha256: domainSeparatedSha256(
        structuredRecord.schemaVersion,
        structuredRecord,
      ),
    },
    dayflow: {
      read: {
        readSchemaVersion:
          "blabase.dayflow-metadata-evidence-private-pilot-read.v1",
        sourceMode: "real-private-pilot",
        bundleDirectoryName: "dayflow-private-pilot-test-bundle",
        sourceOrder: [
          "payload.json",
          "manifest.json",
          "manifest.sha256",
          "COMPLETE",
        ],
        captureBinding,
        captureBindingSha256: "8".repeat(64),
        wireProvenance: {
          qualificationSchemaVersion:
            qualification.qualificationSchemaVersion,
          exportRunId: expectedExportRunId,
          manifestSha256: sourceManifestIdentity,
          payloadSha256: rawSha256(payloadBytes),
          replayIdentitySha256,
        },
      },
      qualification,
      sourceFiles,
    },
    canonicalization: {
      authorization: authorizationRecord.canonicalization,
      storedManifest: "rfc8785-jcs.utf8.lf.v1",
      identityHashDomain: identityDomain,
      identityPreimage:
        "manifest-without-self-hash-or-publication-metadata",
    },
  };
  const identitySha256 = domainSeparatedSha256(identityDomain, manifest);
  const relativeDirectory = [
    ".local",
    "dayflow-ablation",
    "inputs",
    policy.policyId,
    "runs",
    identitySha256,
  ].join("/");
  const directory = join(dataRoot, ...relativeDirectory.split("/"));
  const identityBytes = encoder.encode(identitySha256);
  const files = [
    ["authorization.json", authorizationBytes],
    ["authorization.sha256", encoder.encode(authorizationIdentitySha256)],
    ["structured-evidence.json", structuredBytes],
    ["dayflow-source-payload.json", payloadBytes],
    ["dayflow-source-manifest.json", sourceManifestBytes],
    ["dayflow-source-manifest.sha256", sourceMarkerBytes],
    ["dayflow-source-COMPLETE", sourceMarkerBytes],
    ["evaluation-input-manifest.json", canonicalJsonLfBytes(manifest)],
    ["evaluation-input-manifest.sha256", identityBytes],
    ["COMPLETE", identityBytes],
  ] as const;
  for (const [relativePath, bytes] of files) {
    await writePrivateFile(join(directory, relativePath), bytes);
  }
  await chmod(directory, 0o700);
  return { dataRoot, directory, relativeDirectory, identitySha256 };
}

describe("private-pilot Task1 evaluation input durable identity verifier V0.2", () => {
  it("reopens an exact publication after all branded seal references are lost", async () => {
    const fixture = await createFixture();
    const verified =
      await verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: fixture.dataRoot,
        relativeDirectory: fixture.relativeDirectory,
        expectedIdentitySha256: fixture.identitySha256,
      });

    expect(verified.identitySha256).toBe(fixture.identitySha256);
    expect(verified.retention).toEqual({
      action: "delete",
      incompleteStagingSeconds: 3_600,
      dayflowRawMaximumSeconds: 86_400,
      sealedPrivateInputMaximumSeconds: 2_592_000,
    });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.retention)).toBe(true);
    expect(verified).not.toHaveProperty("dataRoot");
    expect(verified).not.toHaveProperty("relativeDirectory");
  });

  it("rejects wrong identity and every non-canonical publication path", async () => {
    const fixture = await createFixture();
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: fixture.dataRoot,
        relativeDirectory: fixture.relativeDirectory,
        expectedIdentitySha256: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ issueCode: "PATH_MISMATCH" });
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: fixture.dataRoot,
        relativeDirectory: `${fixture.relativeDirectory}/.`,
        expectedIdentitySha256: fixture.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "PATH_MISMATCH" });
  });

  it("rejects extra, missing, and unsafe exact-set entries", async () => {
    const extra = await createFixture();
    await writePrivateFile(join(extra.directory, "extra.json"), encoder.encode("{}"));
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: extra.dataRoot,
        relativeDirectory: extra.relativeDirectory,
        expectedIdentitySha256: extra.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "ARTIFACT_SET_INVALID" });

    const missing = await createFixture();
    await unlink(join(missing.directory, "structured-evidence.json"));
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: missing.dataRoot,
        relativeDirectory: missing.relativeDirectory,
        expectedIdentitySha256: missing.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "ARTIFACT_SET_INVALID" });

    const unsafe = await createFixture();
    const target = join(unsafe.dataRoot, "unsafe-target");
    await writePrivateFile(target, encoder.encode("{}"));
    await unlink(join(unsafe.directory, "structured-evidence.json"));
    await symlink(target, join(unsafe.directory, "structured-evidence.json"));
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: unsafe.dataRoot,
        relativeDirectory: unsafe.relativeDirectory,
        expectedIdentitySha256: unsafe.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "ARTIFACT_SET_INVALID" });
  });

  it("rejects byte mutation and the obsolete three-key retention fixture", async () => {
    const mutated = await createFixture();
    await writeFile(
      join(mutated.directory, "structured-evidence.json"),
      encoder.encode("{}"),
    );
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: mutated.dataRoot,
        relativeDirectory: mutated.relativeDirectory,
        expectedIdentitySha256: mutated.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "STRUCTURED_INVALID" });

    const obsolete = await createFixture({ obsoleteRetention: true });
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: obsolete.dataRoot,
        relativeDirectory: obsolete.relativeDirectory,
        expectedIdentitySha256: obsolete.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "RETENTION_INVALID" });
  });

  it("binds resource rejection to the shared V0.2 artifact budget", async () => {
    const derivedTotal = Object.values(
      TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
    ).reduce((total, maximumBytes) => total + maximumBytes, 0);
    expect(derivedTotal).toBe(
      TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
    );

    const fixture = await createFixture();
    await writeFile(
      join(fixture.directory, "authorization.json"),
      new Uint8Array(
        TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2["authorization.json"] + 1,
      ),
    );
    await expect(
      verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2({
        dataRoot: fixture.dataRoot,
        relativeDirectory: fixture.relativeDirectory,
        expectedIdentitySha256: fixture.identitySha256,
      }),
    ).rejects.toMatchObject({ issueCode: "ARTIFACT_SET_INVALID" });
  });
});

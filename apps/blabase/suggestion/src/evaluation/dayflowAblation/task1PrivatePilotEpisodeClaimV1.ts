import { types as nodeUtilTypes } from "node:util";

import { domainSeparatedSha256 } from "../../dayflowEvidence/contracts";
import {
  canonicalJsonLfBytes,
  isNodeError,
  publishPrivateEvaluationArtifactSetNoClobber,
  rawSha256,
  type PrivateEvaluationArtifactSetFile,
  type VerifiedPrivateEvaluationArtifactSet,
} from "../privateArtifactStore";
import {
  TASK1_PRIVATE_PILOT_POLICY_ID,
  TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION,
  TASK1_PRIVATE_PILOT_POLICY_SHA256,
} from "./task1PrivatePilotAuthorizationV1";

export const TASK1_PRIVATE_PILOT_EPISODE_CLAIM_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1-private-pilot-episode-claim.v1" as const;
export const TASK1_PRIVATE_PILOT_EPISODE_CLAIM_KEY_HASH_DOMAIN =
  "blabase.dayflow-ablation.task1-private-pilot-episode-claim-key.v1" as const;
export const TASK1_PRIVATE_PILOT_EPISODE_CLAIM_IDENTITY_HASH_DOMAIN =
  TASK1_PRIVATE_PILOT_EPISODE_CLAIM_SCHEMA_VERSION;

export const TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER = Object.freeze([
  "episode-claim.json",
  "episode-claim.sha256",
  "COMPLETE",
] as const);

export type Task1PrivatePilotEpisodeClaimV1Input = Readonly<{
  dataRoot: string;
  episodeId: string;
  claimedAtEpochSecond: number;
}>;

export type Task1PrivatePilotEpisodeClaimV1Descriptor = Readonly<{
  schemaVersion: typeof TASK1_PRIVATE_PILOT_EPISODE_CLAIM_SCHEMA_VERSION;
  episodeId: string;
  episodeIdHash: string;
  claimIdentitySha256: string;
  policyId: typeof TASK1_PRIVATE_PILOT_POLICY_ID;
  policySchemaVersion: typeof TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION;
  policySha256: typeof TASK1_PRIVATE_PILOT_POLICY_SHA256;
  claimedAt: string;
  consumptionRule: "one-use-before-capture";
  relativeDirectory: string;
  fileOrder: typeof TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER;
}>;

export type Task1PrivatePilotEpisodeClaimV1Result = Readonly<{
  descriptor: Task1PrivatePilotEpisodeClaimV1Descriptor;
  verified: VerifiedPrivateEvaluationArtifactSet;
}>;

export type Task1PrivatePilotEpisodeClaimV1IssueCode =
  | "INPUT_INVALID"
  | "EPISODE_ALREADY_CONSUMED"
  | "CLAIM_PERSISTENCE_FAILED";

export class Task1PrivatePilotEpisodeClaimV1Error extends Error {
  readonly issueCode: Task1PrivatePilotEpisodeClaimV1IssueCode;

  constructor(issueCode: Task1PrivatePilotEpisodeClaimV1IssueCode) {
    super(`Task 1 private-pilot episode claim failed (${issueCode})`);
    this.name = "Task1PrivatePilotEpisodeClaimV1Error";
    this.issueCode = issueCode;
    Object.freeze(this);
  }
}

const EPISODE_ID_PATTERN = /^episode_[a-f0-9]{32}$/u;
const UTF8 = new TextEncoder();

function fail(
  issueCode: Task1PrivatePilotEpisodeClaimV1IssueCode,
): never {
  throw new Task1PrivatePilotEpisodeClaimV1Error(issueCode);
}

function ownDataValue(
  value: object,
  key: string,
): PropertyDescriptor & Readonly<{ value: unknown }> | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? (descriptor as PropertyDescriptor & Readonly<{ value: unknown }>)
    : undefined;
}

function snapshotInput(
  input: Task1PrivatePilotEpisodeClaimV1Input,
): Task1PrivatePilotEpisodeClaimV1Input {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      nodeUtilTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Object.prototype
    ) {
      return fail("INPUT_INVALID");
    }

    const keys = Reflect.ownKeys(input).sort();
    if (
      keys.length !== 3 ||
      keys[0] !== "claimedAtEpochSecond" ||
      keys[1] !== "dataRoot" ||
      keys[2] !== "episodeId"
    ) {
      return fail("INPUT_INVALID");
    }

    const dataRoot = ownDataValue(input, "dataRoot")?.value;
    const episodeId = ownDataValue(input, "episodeId")?.value;
    const claimedAtEpochSecond = ownDataValue(
      input,
      "claimedAtEpochSecond",
    )?.value;
    const claimedAtMilliseconds =
      typeof claimedAtEpochSecond === "number"
        ? claimedAtEpochSecond * 1_000
        : Number.NaN;

    if (
      typeof dataRoot !== "string" ||
      dataRoot.length === 0 ||
      typeof episodeId !== "string" ||
      !EPISODE_ID_PATTERN.test(episodeId) ||
      typeof claimedAtEpochSecond !== "number" ||
      !Number.isSafeInteger(claimedAtEpochSecond) ||
      claimedAtEpochSecond < 0 ||
      !Number.isSafeInteger(claimedAtMilliseconds)
    ) {
      return fail("INPUT_INVALID");
    }

    return Object.freeze({
      dataRoot,
      episodeId,
      claimedAtEpochSecond,
    });
  } catch (error) {
    if (error instanceof Task1PrivatePilotEpisodeClaimV1Error) {
      throw error;
    }
    return fail("INPUT_INVALID");
  }
}

export async function claimTask1PrivatePilotEpisodeV1(
  input: Task1PrivatePilotEpisodeClaimV1Input,
): Promise<Task1PrivatePilotEpisodeClaimV1Result> {
  const snapshot = snapshotInput(input);
  const episodeIdHash = domainSeparatedSha256(
    TASK1_PRIVATE_PILOT_EPISODE_CLAIM_KEY_HASH_DOMAIN,
    { episodeId: snapshot.episodeId },
  );
  const claimedAt = new Date(
    snapshot.claimedAtEpochSecond * 1_000,
  ).toISOString();
  const claim = Object.freeze({
    schemaVersion: TASK1_PRIVATE_PILOT_EPISODE_CLAIM_SCHEMA_VERSION,
    episodeId: snapshot.episodeId,
    episodeIdHash,
    policyId: TASK1_PRIVATE_PILOT_POLICY_ID,
    policySchemaVersion: TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION,
    policySha256: TASK1_PRIVATE_PILOT_POLICY_SHA256,
    claimedAt,
    consumptionRule: "one-use-before-capture" as const,
  });
  const claimIdentitySha256 = domainSeparatedSha256(
    TASK1_PRIVATE_PILOT_EPISODE_CLAIM_IDENTITY_HASH_DOMAIN,
    claim,
  );
  const claimBytes = canonicalJsonLfBytes(claim);
  const markerBytes = UTF8.encode(`${claimIdentitySha256}\n`);
  const files: readonly PrivateEvaluationArtifactSetFile[] = Object.freeze([
    Object.freeze({
      relativePath: TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER[0],
      mediaType: "application/json",
      byteLength: claimBytes.byteLength,
      rawSha256: rawSha256(claimBytes),
      bytes: new Uint8Array(claimBytes),
    }),
    Object.freeze({
      relativePath: TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER[1],
      mediaType: "text/plain; charset=utf-8",
      byteLength: markerBytes.byteLength,
      rawSha256: rawSha256(markerBytes),
      bytes: new Uint8Array(markerBytes),
    }),
    Object.freeze({
      relativePath: TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER[2],
      mediaType: "text/plain; charset=utf-8",
      byteLength: markerBytes.byteLength,
      rawSha256: rawSha256(markerBytes),
      bytes: new Uint8Array(markerBytes),
    }),
  ]);
  const pathComponents = Object.freeze([
    ".local",
    "dayflow-ablation",
    "inputs",
    TASK1_PRIVATE_PILOT_POLICY_ID,
    "episode-claims",
    episodeIdHash,
  ]);

  try {
    const verified = await publishPrivateEvaluationArtifactSetNoClobber({
      dataRoot: snapshot.dataRoot,
      pathComponents,
      files,
    });
    const descriptor = Object.freeze({
      schemaVersion: TASK1_PRIVATE_PILOT_EPISODE_CLAIM_SCHEMA_VERSION,
      episodeId: snapshot.episodeId,
      episodeIdHash,
      claimIdentitySha256,
      policyId: TASK1_PRIVATE_PILOT_POLICY_ID,
      policySchemaVersion: TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION,
      policySha256: TASK1_PRIVATE_PILOT_POLICY_SHA256,
      claimedAt,
      consumptionRule: "one-use-before-capture" as const,
      relativeDirectory: pathComponents.join("/"),
      fileOrder: TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER,
    });
    return Object.freeze({ descriptor, verified });
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      return fail("EPISODE_ALREADY_CONSUMED");
    }
    if (error instanceof Task1PrivatePilotEpisodeClaimV1Error) {
      throw error;
    }
    return fail("CLAIM_PERSISTENCE_FAILED");
  }
}

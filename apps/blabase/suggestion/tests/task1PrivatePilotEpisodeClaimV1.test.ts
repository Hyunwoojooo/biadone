import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { domainSeparatedSha256 } from "../src/dayflowEvidence/contracts";
import {
  claimTask1PrivatePilotEpisodeV1,
  TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER,
  TASK1_PRIVATE_PILOT_EPISODE_CLAIM_KEY_HASH_DOMAIN,
} from "../src/evaluation/dayflowAblation/task1PrivatePilotEpisodeClaimV1";

const EPISODE_ID = "episode_0123456789abcdef0123456789abcdef";
const CLAIMED_AT_EPOCH_SECOND = 1_800_000_000;

describe("Task 1 private-pilot episode claim V1", () => {
  it("persists a fixed one-use claim before capture", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "task1-episode-claim-")),
    );

    try {
      const result = await claimTask1PrivatePilotEpisodeV1({
        dataRoot: root,
        episodeId: EPISODE_ID,
        claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND,
      });
      const expectedEpisodeIdHash = domainSeparatedSha256(
        TASK1_PRIVATE_PILOT_EPISODE_CLAIM_KEY_HASH_DOMAIN,
        { episodeId: EPISODE_ID },
      );
      const directory = join(
        root,
        ...result.descriptor.relativeDirectory.split("/"),
      );

      expect(result.descriptor.episodeIdHash).toBe(expectedEpisodeIdHash);
      expect(result.descriptor.relativeDirectory).toBe(
        `.local/dayflow-ablation/inputs/dayflow-ablation-private-pilot-v0.1/episode-claims/${expectedEpisodeIdHash}`,
      );
      expect(result.verified.files.map((file) => file.relativePath)).toEqual(
        TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER,
      );
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      for (const relativePath of TASK1_PRIVATE_PILOT_EPISODE_CLAIM_FILE_ORDER) {
        expect((await stat(join(directory, relativePath))).mode & 0o777).toBe(
          0o600,
        );
      }
      const identityMarker = await readFile(
        join(directory, "episode-claim.sha256"),
      );
      const completeMarker = await readFile(join(directory, "COMPLETE"));
      expect(identityMarker.equals(completeMarker)).toBe(true);
      expect(identityMarker.toString("utf8")).toBe(
        `${result.descriptor.claimIdentitySha256}\n`,
      );
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.descriptor)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects sequential reuse even when mutable claim metadata differs", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "task1-episode-reuse-")),
    );

    try {
      await claimTask1PrivatePilotEpisodeV1({
        dataRoot: root,
        episodeId: EPISODE_ID,
        claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND,
      });
      await expect(
        claimTask1PrivatePilotEpisodeV1({
          dataRoot: root,
          episodeId: EPISODE_ID,
          claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND + 1,
        }),
      ).rejects.toMatchObject({ issueCode: "EPISODE_ALREADY_CONSUMED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows exactly one winner for concurrent claims", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "task1-episode-concurrent-")),
    );

    try {
      const attempts = await Promise.allSettled([
        claimTask1PrivatePilotEpisodeV1({
          dataRoot: root,
          episodeId: EPISODE_ID,
          claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND,
        }),
        claimTask1PrivatePilotEpisodeV1({
          dataRoot: root,
          episodeId: EPISODE_ID,
          claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND,
        }),
      ]);
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(
        1,
      );
      const rejected = attempts.find(
        (attempt) => attempt.status === "rejected",
      );
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { issueCode: "EPISODE_ALREADY_CONSUMED" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps an episode consumed when downstream capture never succeeds", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "task1-episode-failed-capture-")),
    );

    try {
      const first = await claimTask1PrivatePilotEpisodeV1({
        dataRoot: root,
        episodeId: EPISODE_ID,
        claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND,
      });
      const completePath = join(
        root,
        ...first.descriptor.relativeDirectory.split("/"),
        "COMPLETE",
      );
      const before = await readFile(completePath);

      await expect(
        claimTask1PrivatePilotEpisodeV1({
          dataRoot: root,
          episodeId: EPISODE_ID,
          claimedAtEpochSecond: CLAIMED_AT_EPOCH_SECOND + 10,
        }),
      ).rejects.toMatchObject({ issueCode: "EPISODE_ALREADY_CONSUMED" });
      expect((await readFile(completePath)).equals(before)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

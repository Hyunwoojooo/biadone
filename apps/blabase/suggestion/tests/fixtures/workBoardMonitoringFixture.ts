import type { AttentionSourceMonitor } from "../../src/attention/monitoringSchema";
import type { WorkBoardMonitoringReceiptAuthority } from "../../src/suggestionBoard/monitoring";
import { workBoardResponse } from "./launcherWorkBoardFixture";

export const MONITORING_SECRET = "a".repeat(64);
export const MONITORING_NOW = new Date("2026-08-13T09:01:00.000Z");

export function monitoringAuthority(
  installationSecret = MONITORING_SECRET
): WorkBoardMonitoringReceiptAuthority {
  return {
    installationSecret,
    response: workBoardResponse(),
    sources: [source("github"), source("codex")],
    privateProvenance: {
      registrySha256: "b".repeat(64),
      codeCommitSha: "c".repeat(40),
      codeState: "clean_commit",
      codeFingerprintSha256: null,
      boardResultSha256: "d".repeat(64),
      continuationResultSha256: "e".repeat(64)
    }
  };
}

function source(
  sourceName: "github" | "codex"
): AttentionSourceMonitor {
  return {
    source: sourceName,
    inputState: "available",
    unavailableReason: null,
    freshness: "fresh",
    completeness: "complete",
    snapshotFetchedAt: "2026-08-13T09:00:00.000Z",
    sourceSnapshotSha256:
      sourceName === "github" ? "1".repeat(64) : "2".repeat(64),
    batchSha256:
      sourceName === "github" ? "3".repeat(64) : "4".repeat(64),
    normalizerVersion:
      sourceName === "github"
        ? "github-continuation-adapter-v0.4"
        : "codex-continuation-adapter-v0.4",
    candidateSetComplete: true,
    signalCount: 1,
    skippedRecordCount: 0,
    issueCodes: []
  };
}

import {
  semanticContinuationWorkBoardResponseSchema,
  type SemanticContinuationWorkBoardResponse
} from "../semanticContinuation/contracts";
import {
  LAUNCHER_WORK_BOARD_CONTRACT,
  launcherWorkBoardProjectionSchema,
  type LauncherWorkBoardProjection
} from "./contracts";

export function buildLauncherWorkBoardProjection(
  rawResponse: SemanticContinuationWorkBoardResponse
): LauncherWorkBoardProjection {
  const response = semanticContinuationWorkBoardResponseSchema.parse(
    rawResponse
  );
  if (response.base.status !== "ready") {
    throw new TypeError("Launcher Work Board is unavailable.");
  }

  const overlays = new Map(
    (response.semanticPresentation?.overlays ?? []).map((overlay) => [
      overlay.itemRef,
      overlay.displayTitle
    ])
  );
  const entries = [
    ...(response.base.board.primary === null
      ? []
      : [response.base.board.primary]),
    ...response.base.board.alternatives
  ];

  return launcherWorkBoardProjectionSchema.parse({
    contract: LAUNCHER_WORK_BOARD_CONTRACT,
    generatedAt: response.base.board.generatedAt,
    mode: response.base.mode,
    prominentLane: response.base.board.prominentLane,
    continuationStatus: response.base.board.continuationStatus,
    items: entries.map((entry) => ({
      lane: entry.lane,
      title:
        entry.lane === "continuation"
          ? (overlays.get(entry.item.itemRef) ?? entry.item.title)
          : entry.item.title,
      evidenceBand: entry.item.evidenceBand,
      caveatCodes: entry.item.caveatCodes,
      // Active Attention expiresAt is a due date, not a visibility TTL.
      expiresAt: entry.lane === "attention" ? null : entry.item.expiresAt,
      capability: entry.item.capability,
      action: entry.item.action
    }))
  });
}

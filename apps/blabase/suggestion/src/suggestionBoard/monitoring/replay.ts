import { runtimeSha256 } from "../../crossSource/canonicalHash";
import {
  workBoardMonitoringReplaySchema,
  type WorkBoardMonitoringStore
} from "./contracts";
import { deriveWorkBoardMonitoringQuality } from "./quality";
import {
  WORK_BOARD_MONITORING_REPLAY_CONTRACT,
  WORK_BOARD_MONITORING_SCHEMA_VERSION
} from "./versions";

export function workBoardMonitoringAggregateSha256(input: {
  events: WorkBoardMonitoringStore["events"];
  asOf: string;
}): string {
  return runtimeSha256(
    deriveWorkBoardMonitoringQuality({
      events: input.events,
      asOf: input.asOf
    })
  );
}

export function replayWorkBoardMonitoringStore(
  store: WorkBoardMonitoringStore
) {
  const aggregate = deriveWorkBoardMonitoringQuality({
    events: store.events,
    asOf: store.updatedAt
  });
  const aggregateSha256 = runtimeSha256(aggregate);
  const matched = aggregateSha256 === store.aggregateSha256;
  return workBoardMonitoringReplaySchema.parse({
    contract: WORK_BOARD_MONITORING_REPLAY_CONTRACT,
    schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
    status: matched ? "matched" : "mismatch",
    inputEventCount: store.events.length,
    aggregate,
    aggregateSha256,
    expectedAggregateSha256: store.aggregateSha256,
    mismatchCodes: matched ? [] : ["AGGREGATE_SHA_MISMATCH"]
  });
}

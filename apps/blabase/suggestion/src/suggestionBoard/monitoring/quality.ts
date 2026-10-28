import { compareRuntimeStrings } from "../../crossSource/canonicalHash";
import {
  WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  WORK_BOARD_MONITORING_SURFACE
} from "./versions";
import {
  WORK_BOARD_MONITORING_REVIEW_FIELDS,
  workBoardMonitoringHistoryEntrySchema,
  workBoardMonitoringQualitySchema,
  type WorkBoardMonitoringEvent,
  type WorkBoardMonitoringQuality
} from "./contracts";

type Presentation = NonNullable<WorkBoardMonitoringEvent["target"]>;
type Rating = {
  feedback: "useful" | "not_useful";
  event: WorkBoardMonitoringEvent;
};

export function deriveWorkBoardMonitoringQuality(input: {
  events: readonly WorkBoardMonitoringEvent[];
  asOf: string;
}): WorkBoardMonitoringQuality {
  const eligible = new Map<string, Presentation>();
  const latestRatings = new Map<string, Rating>();
  for (const event of input.events) {
    if (event.eventType === "render_confirmed") {
      for (const presentation of event.presentations) {
        if (presentation.lane !== "attention") {
          eligible.set(
            presentation.presentationTargetHmac,
            presentation
          );
        }
      }
      continue;
    }
    const target = event.target;
    if (target === null || target.lane === "attention") continue;
    if (
      event.eventType === "feedback_recorded" &&
      event.feedback !== null
    ) {
      latestRatings.set(target.presentationTargetHmac, {
        feedback: event.feedback,
        event
      });
    } else if (event.eventType === "feedback_reset") {
      latestRatings.delete(target.presentationTargetHmac);
    }
  }
  for (const target of [...latestRatings.keys()]) {
    if (!eligible.has(target)) latestRatings.delete(target);
  }
  const usefulDistinct = [...latestRatings.values()].filter(
    (rating) => rating.feedback === "useful"
  ).length;

  const strata = new Map<
    string,
    {
      presentation: Presentation;
      eligible: Set<string>;
    }
  >();
  for (const [target, presentation] of eligible) {
    const key = stratumKey(presentation);
    const existing = strata.get(key) ?? {
      presentation,
      eligible: new Set<string>()
    };
    existing.eligible.add(target);
    strata.set(key, existing);
  }

  return workBoardMonitoringQualitySchema.parse({
    contract: WORK_BOARD_MONITORING_QUALITY_CONTRACT,
    schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
    asOf: input.asOf,
    eventCount: input.events.length,
    eligibleDistinct: eligible.size,
    ratedDistinct: latestRatings.size,
    usefulDistinct,
    coverage: ratio(latestRatings.size, eligible.size),
    usefulShare: ratio(usefulDistinct, latestRatings.size),
    strata: [...strata.entries()]
      .sort(([left], [right]) => compareRuntimeStrings(left, right))
      .map(([, stratum]) => {
        const rated = [...stratum.eligible].filter((target) =>
          latestRatings.has(target)
        );
        const useful = rated.filter(
          (target) => latestRatings.get(target)?.feedback === "useful"
        );
        return {
          lane: stratum.presentation.lane,
          position: stratum.presentation.position,
          mode: stratum.presentation.mode,
          evidenceBand: stratum.presentation.evidenceBand,
          surface: WORK_BOARD_MONITORING_SURFACE,
          eligibleDistinct: stratum.eligible.size,
          ratedDistinct: rated.length,
          usefulDistinct: useful.length,
          coverage: ratio(rated.length, stratum.eligible.size),
          usefulShare: ratio(useful.length, rated.length)
        };
      }),
    ...WORK_BOARD_MONITORING_REVIEW_FIELDS
  });
}

export function workBoardMonitoringConsent(
  events: readonly WorkBoardMonitoringEvent[]
): boolean {
  let consent = false;
  for (const event of events) {
    if (event.eventType === "consent_granted") consent = true;
    if (event.eventType === "consent_revoked") consent = false;
  }
  return consent;
}

export function workBoardMonitoringHistory(
  events: readonly WorkBoardMonitoringEvent[],
  limit: number
) {
  return [...events]
    .reverse()
    .slice(0, limit)
    .map((event) =>
      workBoardMonitoringHistoryEntrySchema.parse({
        occurredAt: event.occurredAt,
        eventType: event.eventType,
        lane:
          event.target?.lane === "continuation" ||
          event.target?.lane === "setup"
            ? event.target.lane
            : null,
        position: event.target?.position ?? null,
        mode: event.target?.mode ?? null,
        evidenceBand: event.target?.evidenceBand ?? null,
        feedback: event.feedback,
        reason: event.reason,
        ...WORK_BOARD_MONITORING_REVIEW_FIELDS
      })
    );
}

function ratio(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

function stratumKey(presentation: Presentation): string {
  return [
    presentation.lane,
    presentation.position,
    presentation.mode,
    presentation.evidenceBand,
    presentation.surface
  ].join("\u0000");
}

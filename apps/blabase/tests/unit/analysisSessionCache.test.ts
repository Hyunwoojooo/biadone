import { describe, expect, it } from "vitest";

import {
  cacheAnalysisMonitorPayload,
  readAnalysisMonitorPayload
} from "../../src/components/extraction-monitor/analysisSessionCache";
import type { AnalysisMonitorPayload } from "../../src/core/transport/analysisMonitorPayload";

describe("analysis session cache", () => {
  it("keeps a completed monitor payload across client-side navigation", () => {
    const analysisId = "ana_session_cache_test";
    const payload: AnalysisMonitorPayload = {
      result: {
        analysisId,
        status: "completed"
      },
      messages: {
        analysisId,
        status: "completed",
        messages: []
      }
    };

    cacheAnalysisMonitorPayload(analysisId, payload);

    expect(readAnalysisMonitorPayload(analysisId)).toBe(payload);
  });
});

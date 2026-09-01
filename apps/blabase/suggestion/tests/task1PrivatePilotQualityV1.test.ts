import { describe, expect, it } from "vitest";
import {
  assessTask1PrivatePilotQualityV1,
  TASK1_PRIVATE_PILOT_STRICT_REJECTION_ISSUE_CODES_V1
} from "../src/evaluation/dayflowAblation/task1PrivatePilotQualityV1";

function bundleFixture(issueCodes: readonly string[], schemaUserVersion = 1): unknown {
  return {
    evidence: {
      issues: issueCodes.map((code) => ({ code })),
      provenance: {
        sourceDatabaseSchemaUserVersion: schemaUserVersion
      }
    }
  };
}

describe("Task 1 private-pilot strict quality gate", () => {
  it.each(TASK1_PRIVATE_PILOT_STRICT_REJECTION_ISSUE_CODES_V1)(
    "rejects strict issue %s",
    (code) => {
      expect(assessTask1PrivatePilotQualityV1(bundleFixture([code]))).toEqual({
        ok: false,
        failure: {
          code: "DAYFLOW_QUALITY_REJECTED",
          reasons: [code]
        }
      });
    }
  );

  it("permits only the two approved nonblocking issue codes", () => {
    expect(
      assessTask1PrivatePilotQualityV1(
        bundleFixture([
          "OPTIONAL_SOURCE_METADATA_MISSING",
          "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED"
        ])
      )
    ).toEqual({ ok: true });
  });

  it("rejects unknown issue codes without echoing their value", () => {
    expect(assessTask1PrivatePilotQualityV1(bundleFixture(["PRIVATE_UNKNOWN_VALUE"]))).toEqual({
      ok: false,
      failure: {
        code: "DAYFLOW_QUALITY_REJECTED",
        reasons: ["UNAPPROVED_ISSUE_CODE"]
      }
    });
  });

  it("independently rejects schema user version zero", () => {
    expect(assessTask1PrivatePilotQualityV1(bundleFixture([], 0))).toEqual({
      ok: false,
      failure: {
        code: "DAYFLOW_QUALITY_REJECTED",
        reasons: ["DATABASE_SCHEMA_USER_VERSION_UNSET"]
      }
    });
  });

  it("orders combined failures deterministically", () => {
    expect(
      assessTask1PrivatePilotQualityV1(
        bundleFixture([
          "PRIVATE_UNKNOWN_VALUE",
          "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
          "NO_SCREENSHOT_METADATA_IN_WINDOW"
        ], 0)
      )
    ).toEqual({
      ok: false,
      failure: {
        code: "DAYFLOW_QUALITY_REJECTED",
        reasons: [
          "NO_SCREENSHOT_METADATA_IN_WINDOW",
          "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
          "DATABASE_SCHEMA_USER_VERSION_UNSET",
          "UNAPPROVED_ISSUE_CODE"
        ]
      }
    });
  });

  it.each([
    null,
    {},
    { evidence: {} },
    { evidence: { issues: [], provenance: {} } },
    { evidence: { issues: [null], provenance: { sourceDatabaseSchemaUserVersion: 1 } } }
  ])("rejects malformed input %#", (candidate) => {
    expect(assessTask1PrivatePilotQualityV1(candidate)).toEqual({
      ok: false,
      failure: { code: "QUALITY_INPUT_INVALID" }
    });
  });
});

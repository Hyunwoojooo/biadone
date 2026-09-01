export const TASK1_PRIVATE_PILOT_STRICT_REJECTION_ISSUE_CODES_V1 = Object.freeze([
  "NO_SCREENSHOT_METADATA_IN_WINDOW",
  "CAPTURE_GAP_DETECTED",
  "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
  "DATABASE_SCHEMA_USER_VERSION_UNSET"
] as const);

export const TASK1_PRIVATE_PILOT_ALLOWED_ISSUE_CODES_V1 = Object.freeze([
  "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
  "OPTIONAL_SOURCE_METADATA_MISSING"
] as const);

export type Task1PrivatePilotQualityRejectionReasonV1 =
  | (typeof TASK1_PRIVATE_PILOT_STRICT_REJECTION_ISSUE_CODES_V1)[number]
  | "UNAPPROVED_ISSUE_CODE";

export type Task1PrivatePilotQualityResultV1 =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      failure: Readonly<
        | { code: "QUALITY_INPUT_INVALID" }
        | {
            code: "DAYFLOW_QUALITY_REJECTED";
            reasons: readonly Task1PrivatePilotQualityRejectionReasonV1[];
          }
      >;
    }>;

const QUALITY_OK = Object.freeze({ ok: true as const });
const QUALITY_INPUT_INVALID = Object.freeze({
  ok: false as const,
  failure: Object.freeze({ code: "QUALITY_INPUT_INVALID" as const })
});
const STRICT_REJECTION_CODES = new Set<string>(
  TASK1_PRIVATE_PILOT_STRICT_REJECTION_ISSUE_CODES_V1
);
const ALLOWED_CODES = new Set<string>(TASK1_PRIVATE_PILOT_ALLOWED_ISSUE_CODES_V1);

export function assessTask1PrivatePilotQualityV1(
  candidate: unknown
): Task1PrivatePilotQualityResultV1 {
  let issues: unknown;
  let schemaUserVersion: unknown;

  try {
    if (candidate === null || typeof candidate !== "object") {
      return QUALITY_INPUT_INVALID;
    }
    const evidence = (candidate as { evidence?: unknown }).evidence;
    if (evidence === null || typeof evidence !== "object") {
      return QUALITY_INPUT_INVALID;
    }
    issues = (evidence as { issues?: unknown }).issues;
    const provenance = (evidence as { provenance?: unknown }).provenance;
    if (provenance === null || typeof provenance !== "object") {
      return QUALITY_INPUT_INVALID;
    }
    schemaUserVersion = (
      provenance as { sourceDatabaseSchemaUserVersion?: unknown }
    ).sourceDatabaseSchemaUserVersion;
  } catch {
    return QUALITY_INPUT_INVALID;
  }

  if (
    !Array.isArray(issues) ||
    !Number.isSafeInteger(schemaUserVersion) ||
    (schemaUserVersion as number) < 0
  ) {
    return QUALITY_INPUT_INVALID;
  }

  const presentRejections = new Set<Task1PrivatePilotQualityRejectionReasonV1>();
  for (const issue of issues) {
    let code: unknown;
    try {
      if (issue === null || typeof issue !== "object") {
        return QUALITY_INPUT_INVALID;
      }
      code = (issue as { code?: unknown }).code;
    } catch {
      return QUALITY_INPUT_INVALID;
    }
    if (typeof code !== "string") {
      return QUALITY_INPUT_INVALID;
    }
    if (STRICT_REJECTION_CODES.has(code)) {
      presentRejections.add(code as Task1PrivatePilotQualityRejectionReasonV1);
    } else if (!ALLOWED_CODES.has(code)) {
      presentRejections.add("UNAPPROVED_ISSUE_CODE");
    }
  }

  if (schemaUserVersion === 0) {
    presentRejections.add("DATABASE_SCHEMA_USER_VERSION_UNSET");
  }

  const reasons = [
    ...TASK1_PRIVATE_PILOT_STRICT_REJECTION_ISSUE_CODES_V1,
    "UNAPPROVED_ISSUE_CODE" as const
  ].filter((reason) => presentRejections.has(reason));

  if (reasons.length === 0) {
    return QUALITY_OK;
  }

  return Object.freeze({
    ok: false as const,
    failure: Object.freeze({
      code: "DAYFLOW_QUALITY_REJECTED" as const,
      reasons: Object.freeze(reasons)
    })
  });
}

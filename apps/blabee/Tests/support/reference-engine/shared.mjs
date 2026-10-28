import { isDeepStrictEqual } from "node:util";

import { invariant } from "./errors.mjs";

export const BINDING_FIELDS = Object.freeze([
  "project_id",
  "session_id",
  "source_turn_id",
  "source_prompt_id",
  "episode_id",
  "episode_root_prompt_id",
  "episode_baseline_checkpoint_id",
  "decision_boundary_id",
  "boundary_sequence",
]);

export const TURN_LINEAGE_FIELDS = Object.freeze([
  "source_prompt_id",
  "episode_id",
  "episode_root_prompt_id",
  "episode_baseline_checkpoint_id",
]);

function restoreNullPrototypes(source, target, seen = new WeakSet()) {
  if (source === null || typeof source !== "object" || seen.has(source)) return;
  seen.add(source);
  if (Object.getPrototypeOf(source) === null) Object.setPrototypeOf(target, null);
  for (const key of Object.keys(source)) {
    restoreNullPrototypes(source[key], target[key], seen);
  }
}

export function clone(value) {
  const cloned = structuredClone(value);
  // structuredClone() normalizes null-prototype records to ordinary objects in
  // Node. Coordinator projections deliberately use null-prototype records for
  // untrusted identifier keys such as "__proto__" and "constructor", so restore
  // that security property on every cloned projection map.
  restoreNullPrototypes(value, cloned);
  return cloned;
}

export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function exactDeepEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

export function bindingFrom(value) {
  const binding = {};
  for (const field of BINDING_FIELDS) {
    const fieldValue = value?.[field];
    if (field === "boundary_sequence") {
      invariant(
        Number.isInteger(fieldValue) && fieldValue > 0,
        "binding_incomplete",
        `${field} must be a positive integer`,
      );
    } else {
      try {
        assertIdentifier(fieldValue, field);
      } catch (error) {
        if (error?.code === `${field}_missing`) {
          invariant(false, "binding_incomplete", `${field} must be a non-empty string`);
        }
        throw error;
      }
    }
    binding[field] = fieldValue;
  }
  return binding;
}

export function bindingKey(value) {
  const binding = bindingFrom(value);
  return JSON.stringify(BINDING_FIELDS.map((field) => binding[field]));
}

export function boundaryIdentityKey(value) {
  const binding = bindingFrom(value);
  return JSON.stringify([
    binding.project_id,
    binding.decision_boundary_id,
    binding.boundary_sequence,
  ]);
}

export function turnKey(value) {
  const binding = bindingFrom(value);
  return JSON.stringify([
    binding.project_id,
    binding.session_id,
    binding.source_turn_id,
  ]);
}

export function assertTurnLineageEqual(
  actual,
  expected,
  code = "decision_boundary_lineage_mismatch",
) {
  const left = bindingFrom(actual);
  const right = bindingFrom(expected);
  invariant(
    TURN_LINEAGE_FIELDS.every((field) => left[field] === right[field]),
    code,
    "same-turn decision boundary lineage changed",
  );
}

export function packetRevisionKey(packetId, revision) {
  invariant(typeof packetId === "string" && packetId.length > 0, "packet_id_missing");
  invariant(Number.isInteger(revision) && revision > 0, "packet_revision_invalid");
  return JSON.stringify([packetId, revision]);
}

export function assertBindingsEqual(actual, expected, code = "decision_boundary_binding_mismatch") {
  const left = bindingFrom(actual);
  const right = bindingFrom(expected);
  invariant(
    BINDING_FIELDS.every((field) => left[field] === right[field]),
    code,
    "decision boundary binding does not match",
  );
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// Howard Hinnant's civil-date algorithm avoids Date.UTC's special handling
// for years 0000-0099 and lets comparisons retain all RFC3339 nanoseconds.
function daysFromCivil(year, month, day) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365
    + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100)
    + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function parseTimestamp(value, code = "timestamp_invalid") {
  invariant(typeof value === "string", code, "timestamp must be a string");
  const match = RFC3339.exec(value);
  invariant(match, code, `invalid RFC3339 timestamp: ${value}`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  invariant(month >= 1 && month <= 12, code, `invalid month in timestamp: ${value}`);
  invariant(day >= 1 && day <= daysInMonth(year, month), code, `invalid calendar date in timestamp: ${value}`);
  invariant(hour <= 23 && minute <= 59 && second <= 59, code, `invalid time in timestamp: ${value}`);

  if (offsetSign !== undefined) {
    invariant(
      Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59,
      code,
      `invalid timezone offset in timestamp: ${value}`,
    );
  }
  const localSeconds = daysFromCivil(year, month, day) * 86_400
    + hour * 3_600
    + minute * 60
    + second;
  const offsetDirection = offsetSign === "+" ? 1 : offsetSign === "-" ? -1 : 0;
  const offsetSeconds = offsetDirection
    * (Number(offsetHourText ?? 0) * 60 + Number(offsetMinuteText ?? 0))
    * 60;
  const nanoseconds = BigInt((fractionText ?? "").padEnd(9, "0") || "0");
  return BigInt(localSeconds - offsetSeconds) * NANOSECONDS_PER_SECOND + nanoseconds;
}

export function assertIdentifier(value, field) {
  invariant(typeof value === "string" && value.length > 0, `${field}_missing`, `${field} is required`);
  invariant(
    codePointLengthAtMost(value, 512),
    `${field}_invalid`,
    `${field} exceeds the v1 identifier limit`,
  );
  invariant(
    value.normalize("NFC") === value,
    `${field}_invalid`,
    `${field} must use NFC normalization`,
  );
  return value;
}

export function assertNonEmptyString(value, field) {
  invariant(typeof value === "string" && value.length > 0, `${field}_missing`, `${field} is required`);
  invariant(
    codePointLengthAtMost(value, 8192),
    `${field}_invalid`,
    `${field} exceeds the v1 string limit`,
  );
  return value;
}

function codePointLengthAtMost(value, maximum) {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maximum) return false;
  }
  return true;
}

export function assertStableCode(value, code = "stable_code_invalid") {
  invariant(
    typeof value === "string" && /^[a-z][a-z0-9_]{0,127}$/.test(value),
    code,
    "stable code must match Contracts/v1 common.schema.json",
  );
  return value;
}

export function assertEventId(value) {
  return assertIdentifier(value, "event_id");
}

export function record() {
  return Object.create(null);
}

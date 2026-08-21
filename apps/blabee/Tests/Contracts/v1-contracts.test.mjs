import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CONTRACT_ROOT,
  FIXTURE_ROOT,
  fixtureValidator,
  formatAjvErrors,
  loadV1ContractSuite,
  matchesExpectedAjvErrorCode,
  readJson,
} from "./contract-harness.mjs";
import {
  extractRuntimeEvent,
  traceEventData,
  traceEventType,
  validateSemanticTrace,
} from "./semantic-trace.mjs";
import {
  COMMON_CONTINUATION_BINDING_FIELDS,
  createContinuationClaimLedger,
} from "./continuation-claim.mjs";
import { validateDecisionPacketSemantics } from "./decision-packet-semantic.mjs";
import { isStrictRfc3339DateTime, parseStrictRfc3339DateTime } from "./rfc3339.mjs";

const suitePromise = loadV1ContractSuite();

function clone(value) {
  return structuredClone(value);
}

function caseFor(suite, predicate, description) {
  const fixtureCase = suite.fixtureManifest.cases.find(predicate);
  assert.ok(fixtureCase, `fixture manifest must include ${description}`);
  return fixtureCase;
}

function schemaIs(fixtureCase, expected) {
  const normalize = (value) => value.replace(/\.schema\.json$/, "").replace(/\.json$/, "").replaceAll("-", "_");
  return normalize(fixtureCase.schema) === normalize(expected);
}

function assertSchemaResult(validator, value, expected, label) {
  const actual = validator(value);
  assert.equal(actual, expected, `${label}: ${formatAjvErrors(validator.errors)}`);
}

async function listJsonFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && entry.name.endsWith(".json")) output.push(filename);
    }
  }
  await visit(root);
  return output;
}

async function loadSemanticTraces() {
  const traceRoot = path.join(FIXTURE_ROOT, "event-traces");
  const files = await listJsonFiles(traceRoot);
  assert.ok(files.length > 0, "Fixtures/v1/traces must contain semantic traces");
  return await Promise.all(files.map(async (filename) => ({ filename, trace: await readJson(filename) })));
}

function resequenceTrace(trace) {
  for (const [index, wrapperEvent] of trace.events.entries()) {
    const event = extractRuntimeEvent(wrapperEvent);
    event.event_sequence = index + 1;
    if (Object.hasOwn(wrapperEvent, "seq")) wrapperEvent.seq = index + 1;
  }
  return trace;
}

function eventOfType(trace, eventType, occurrence = 0) {
  const matches = trace.events.filter((event) => traceEventType(event) === eventType);
  assert.ok(matches[occurrence], `${trace.name} must contain ${eventType} occurrence ${occurrence}`);
  return matches[occurrence];
}

function assertSemanticError(trace, expectedErrorCode, runtimeValidator, label) {
  for (const [index, wrapperEvent] of trace.events.entries()) {
    assertSchemaResult(runtimeValidator, extractRuntimeEvent(wrapperEvent), true, `${label} event[${index}]`);
  }
  const result = validateSemanticTrace(trace);
  assert.equal(result.valid, false, `${label}: mutation unexpectedly passed`);
  assert.equal(result.errorCode, expectedErrorCode, `${label}: ${JSON.stringify(result)}`);
}

function assertSemanticValid(trace, runtimeValidator, label) {
  for (const [index, wrapperEvent] of trace.events.entries()) {
    assertSchemaResult(runtimeValidator, extractRuntimeEvent(wrapperEvent), true, `${label} event[${index}]`);
  }
  assert.deepEqual(validateSemanticTrace(trace), {
    valid: true,
    errorCode: null,
    eventIndex: null,
    message: null,
  }, label);
}

test("v1 manifests are complete and every Draft 2020-12 schema compiles offline", async () => {
  const suite = await suitePromise;
  const expectedContractNames = [
    "action",
    "common",
    "continuation_envelope",
    "decision_packet",
    "decision_proposal",
    "native_request",
    "prompt_episode",
    "resume_capsule",
    "runtime_event",
    "selection_request",
  ];
  assert.ok(suite.contractManifest.contracts.length > 0);
  assert.ok(suite.fixtureManifest.cases.length > 0);
  assert.deepEqual(suite.contractManifest.contracts.map((contract) => contract.name).sort(), expectedContractNames);
  assert.equal(suite.compiled.validatorsByName.size, suite.contractManifest.contracts.length);
  for (const contract of suite.contractManifest.contracts) {
    assert.equal(typeof suite.compiled.ajv.getSchema(contract.id), "function", contract.name);
  }

  const schemaFiles = (await listJsonFiles(CONTRACT_ROOT))
    .filter((filename) => filename.endsWith(".schema.json"))
    .sort();
  const declaredSchemaFiles = suite.contractManifest.contracts.map((contract) => contract.filename).sort();
  assert.deepEqual(declaredSchemaFiles, schemaFiles, "every v1 schema file must be declared exactly once");

  const fixtureFiles = (await Promise.all([
    listJsonFiles(path.join(FIXTURE_ROOT, "contracts", "valid")),
    listJsonFiles(path.join(FIXTURE_ROOT, "contracts", "invalid")),
  ])).flat().sort();
  const declaredFixtureFiles = suite.fixtureManifest.cases.map((fixtureCase) => fixtureCase.filename).sort();
  assert.equal(new Set(declaredFixtureFiles).size, declaredFixtureFiles.length, "fixture files must be declared once");
  assert.deepEqual(declaredFixtureFiles, fixtureFiles, "every valid/invalid fixture JSON must be declared exactly once");
});

test("manifest-declared valid and invalid fixtures match their schema expectations", async (t) => {
  const suite = await suitePromise;
  for (const fixtureCase of suite.fixtureManifest.cases) {
    await t.test(fixtureCase.name, () => {
      const validator = fixtureValidator(suite.compiled, fixtureCase);
      const actual = validator(fixtureCase.value);
      assert.equal(actual, fixtureCase.valid, `${fixtureCase.filename}: expected_error_code=${fixtureCase.expected_error_code ?? "none"}; ${formatAjvErrors(validator.errors)}`);
      if (!fixtureCase.valid) {
        assert.ok((validator.errors ?? []).length > 0, `${fixtureCase.name} must expose a schema failure`);
        assert.equal(
          matchesExpectedAjvErrorCode(fixtureCase.expected_error_code, validator.errors),
          true,
          `${fixtureCase.name}: ${fixtureCase.expected_error_code} did not match the intended Ajv path/keyword/params; ${formatAjvErrors(validator.errors)}`,
        );
      }
    });
  }
});

test("selection requests contain identifiers only and cannot smuggle action meaning", async () => {
  const suite = await suitePromise;
  const fixtureCase = caseFor(suite, (item) => item.valid && schemaIs(item, "selection_request"), "a valid selection-request");
  const validator = fixtureValidator(suite.compiled, fixtureCase);
  const forbidden = ["slot", "action_id", "action", "title", "objective", "constraints", "done_when", "continuation_token"];
  for (const field of forbidden) assert.equal(Object.hasOwn(fixtureCase.value, field), false, `valid selection unexpectedly contains ${field}`);

  for (const field of forbidden) {
    const mutated = clone(fixtureCase.value);
    mutated[field] = field === "slot" ? 1 : `untrusted-${field}`;
    assertSchemaResult(validator, mutated, false, `selection must reject ${field}`);
  }
});

test("decision packets preserve fixed slots and fail closed for disabled choices", async () => {
  const suite = await suitePromise;
  const packetCases = suite.fixtureManifest.cases.filter((item) => item.valid && schemaIs(item, "decision_packet"));
  assert.ok(packetCases.length >= 2, "valid decision-packet fixtures must cover disabled alternative and rollback");

  for (const fixtureCase of packetCases) {
    const packet = fixtureCase.value;
    const validator = fixtureValidator(suite.compiled, fixtureCase);
    assert.deepEqual(packet.choices.map((choice) => choice.slot), [1, 2, 3, 4]);
    assert.deepEqual(packet.choices.map((choice) => choice.kind), ["recommended_action", "alternative_action", "pause", "rollback"]);

    for (const choice of packet.choices.filter((candidate) => !candidate.enabled)) {
      assert.equal(typeof choice.disabled_reason, "string");
      assert.equal(choice.action_id, null);
      for (const field of ["action", "title", "objective", "constraints", "done_when", "target_checkpoint_id"]) {
        assert.equal(Object.hasOwn(choice, field), false, `disabled slot ${choice.slot} must not contain ${field}`);
      }
      const mutated = clone(packet);
      const target = mutated.choices.find((candidate) => candidate.slot === choice.slot);
      target.action = {
        title: "Must not execute",
        objective: "Disabled slots cannot smuggle work",
        constraints: [],
        done_when: ["Never"],
      };
      assertSchemaResult(validator, mutated, false, `disabled slot ${choice.slot} with action body`);
    }

    const repurposed = clone(packet);
    repurposed.choices[2].kind = "alternative_action";
    assertSchemaResult(validator, repurposed, false, "slot 3 cannot be repurposed");
  }
});

test("decision packet identifiers are unique across choices by semantic validation", async () => {
  const suite = await suitePromise;
  const packetCases = suite.fixtureManifest.cases.filter((item) => item.valid && schemaIs(item, "decision_packet"));
  assert.ok(packetCases.length > 0);

  for (const fixtureCase of packetCases) {
    const validator = fixtureValidator(suite.compiled, fixtureCase);
    assert.deepEqual(validateDecisionPacketSemantics(fixtureCase.value), {
      valid: true,
      errorCode: null,
      choiceIndices: null,
    });

    const duplicateOption = clone(fixtureCase.value);
    duplicateOption.choices[1].option_id = duplicateOption.choices[0].option_id;
    // JSON Schema Draft 2020-12 cannot express property-level uniqueness
    // across distinct array items; the schema remains valid by design.
    assertSchemaResult(validator, duplicateOption, true, "cross-choice option_id mutation remains schema-valid");
    assert.deepEqual(validateDecisionPacketSemantics(duplicateOption), {
      valid: false,
      errorCode: "decision_packet_option_id_not_unique",
      choiceIndices: [0, 1],
    });

    const choicesWithActions = fixtureCase.value.choices
      .map((choice, index) => ({ choice, index }))
      .filter(({ choice }) => choice.action_id !== null);
    assert.ok(choicesWithActions.length >= 2, "fixture needs two non-null action_id values");
    const duplicateAction = clone(fixtureCase.value);
    duplicateAction.choices[choicesWithActions[1].index].action_id = choicesWithActions[0].choice.action_id;
    assertSchemaResult(validator, duplicateAction, true, "cross-choice action_id mutation remains schema-valid");
    assert.deepEqual(validateDecisionPacketSemantics(duplicateAction), {
      valid: false,
      errorCode: "decision_packet_action_id_not_unique",
      choiceIndices: [choicesWithActions[0].index, choicesWithActions[1].index],
    });

    const invalidPacketTime = clone(fixtureCase.value);
    invalidPacketTime.sealed_at = invalidPacketTime.expires_at;
    assertSchemaResult(validator, invalidPacketTime, true, "packet time-order mutation remains schema-valid");
    assert.deepEqual(validateDecisionPacketSemantics(invalidPacketTime), {
      valid: false,
      errorCode: "decision_packet_time_invalid",
      choiceIndices: null,
    });

    const mismatchedCheckpoint = clone(fixtureCase.value);
    mismatchedCheckpoint.checkpoint.id = `${mismatchedCheckpoint.episode_baseline_checkpoint_id}_cross`;
    assertSchemaResult(validator, mismatchedCheckpoint, true, "checkpoint binding mutation remains schema-valid");
    assert.deepEqual(validateDecisionPacketSemantics(mismatchedCheckpoint), {
      valid: false,
      errorCode: "decision_packet_checkpoint_mismatch",
      choiceIndices: null,
    });

    const mismatchedRollbackTarget = clone(fixtureCase.value);
    const rollback = mismatchedRollbackTarget.choices.find((choice) => choice.slot === 4);
    rollback.enabled = true;
    rollback.disabled_reason = null;
    rollback.action_id = "action_fixture_inline_rollback";
    rollback.target_checkpoint_id = `${mismatchedRollbackTarget.episode_baseline_checkpoint_id}_cross`;
    assertSchemaResult(validator, mismatchedRollbackTarget, true, "enabled rollback target mutation remains schema-valid");
    assert.deepEqual(validateDecisionPacketSemantics(mismatchedRollbackTarget), {
      valid: false,
      errorCode: "rollback_target_checkpoint_mismatch",
      choiceIndices: null,
    });
  }
});

test("M1 fixtures keep rollback unavailable in packets, prompt episodes, and resume capsules", async () => {
  const suite = await suitePromise;
  const expectedPolicy = { enabled: false, disabled_reason: "rollback_not_enabled_in_build" };
  const packets = suite.fixtureManifest.cases.filter((item) => item.valid && schemaIs(item, "decision_packet"));
  for (const fixtureCase of packets) {
    const slot4 = fixtureCase.value.choices.find((choice) => choice.slot === 4);
    assert.ok(slot4, `${fixtureCase.name} needs slot 4`);
    assert.equal(slot4.kind, "rollback");
    assert.equal(slot4.enabled, false);
    assert.equal(slot4.disabled_reason, expectedPolicy.disabled_reason);
    assert.equal(slot4.action_id, null);
  }

  for (const schemaName of ["prompt_episode", "resume_capsule"]) {
    const fixtureCase = caseFor(suite, (item) => item.valid && schemaIs(item, schemaName), `a valid ${schemaName}`);
    assert.deepEqual(fixtureCase.value.rollback_policy, expectedPolicy);
  }
});

test("continuation dispatch modes are mutually exclusive", async () => {
  const suite = await suitePromise;
  const continuationCases = suite.fixtureManifest.cases.filter((item) => item.valid && schemaIs(item, "continuation_envelope"));
  assert.equal(continuationCases.length >= 2, true, "both continuation origins need valid fixtures");

  const origins = new Set();
  for (const fixtureCase of continuationCases) {
    const envelope = fixtureCase.value;
    const validator = fixtureValidator(suite.compiled, fixtureCase);
    origins.add(envelope.continuation_origin);
    const expectedMode = envelope.continuation_origin === "pet_action" ? "same_turn_stop" : "submitted_envelope";
    assert.equal(envelope.dispatch_mode, expectedMode);

    const mutated = clone(envelope);
    mutated.dispatch_mode = expectedMode === "same_turn_stop" ? "submitted_envelope" : "same_turn_stop";
    assertSchemaResult(validator, mutated, false, `${envelope.continuation_origin} opposite dispatch mode`);
  }
  assert.deepEqual([...origins].sort(), ["internal_format_repair", "pet_action"]);
});

test("Ajv applies a strict RFC3339 date-time format including calendar validity", async () => {
  const suite = await suitePromise;
  const fixtureCase = caseFor(suite, (item) => item.valid && schemaIs(item, "continuation_envelope"), "a valid continuation envelope");
  const validator = fixtureValidator(suite.compiled, fixtureCase);
  const invalidValues = [
    "2026-02-30T09:00:30Z",
    "2026-01-15T24:00:30Z",
    "2026-01-15T09:60:30Z",
    "2026-01-15T09:00:60Z",
    "2026-01-15T09:00:30+24:00",
  ];

  for (const invalidValue of invalidValues) {
    assert.equal(isStrictRfc3339DateTime(invalidValue), false, invalidValue);
    const mutated = clone(fixtureCase.value);
    mutated.issued_at = invalidValue;
    assertSchemaResult(validator, mutated, false, `strict date-time must reject ${invalidValue}`);
  }

  const impossibleCalendarDate = clone(fixtureCase.value);
  impossibleCalendarDate.issued_at = invalidValues[0];
  validator(impossibleCalendarDate);
  assert.ok(
    (validator.errors ?? []).some((error) => (
      error.instancePath === "/issued_at"
      && error.keyword === "format"
      && error.params?.format === "date-time"
    )),
    "February 30 must be rejected by the custom date-time format, not Date.parse normalization",
  );
  assert.equal(isStrictRfc3339DateTime("2024-02-29T23:59:59.123+23:59"), true);
  assert.equal(isStrictRfc3339DateTime("2024-02-29T23:59:59.1234567890Z"), false);
  const earlierNanosecond = parseStrictRfc3339DateTime("2026-01-15T09:00:00.000000001Z");
  const laterNanosecond = parseStrictRfc3339DateTime("2026-01-15T09:00:00.000000002Z");
  assert.equal(typeof earlierNanosecond, "bigint");
  assert.equal(earlierNanosecond < laterNanosecond, true);
  assert.equal(
    parseStrictRfc3339DateTime("2026-01-15T09:00:00+09:00"),
    parseStrictRfc3339DateTime("2026-01-15T00:00:00Z"),
  );
  assert.equal(
    parseStrictRfc3339DateTime("0000-01-01T00:00:00Z") < parseStrictRfc3339DateTime("0099-01-01T00:00:00Z"),
    true,
  );
});

test("continuation claims are one-time, unexpired, mode-specific, and exactly bound", async (t) => {
  const suite = await suitePromise;
  const continuationCases = suite.fixtureManifest.cases.filter((item) => item.valid && schemaIs(item, "continuation_envelope"));
  assert.deepEqual(
    continuationCases.map((item) => item.value.continuation_origin).sort(),
    ["internal_format_repair", "pet_action"],
  );

  for (const fixtureCase of continuationCases) {
    await t.test(fixtureCase.value.continuation_origin, () => {
      const envelope = fixtureCase.value;
      const originFields = envelope.continuation_origin === "pet_action"
        ? ["interaction_id", "packet_id", "revision", "option_id", "action_id"]
        : ["repair_request_id", "repair_kind", "repair_attempt", "max_repair_attempts"];
      const allFields = [...COMMON_CONTINUATION_BINDING_FIELDS, ...originFields];
      const expectedBinding = Object.fromEntries(allFields.map((field) => [field, envelope[field]]));
      const beforeExpiry = Date.parse(envelope.expires_at) - 1;

      const ledger = createContinuationClaimLedger({ now: () => beforeExpiry });
      assert.deepEqual(ledger.claim({ envelope, expectedBinding }).accepted, true);
      assert.equal(ledger.claim({ envelope, expectedBinding }).errorCode, "continuation_already_claimed");

      const sameToken = { ...clone(envelope), continuation_id: `${envelope.continuation_id}_other` };
      assert.equal(ledger.claim({ envelope: sameToken, expectedBinding }).errorCode, "continuation_token_already_claimed");

      const expiredLedger = createContinuationClaimLedger({ now: () => Date.parse(envelope.expires_at) });
      assert.equal(expiredLedger.claim({ envelope, expectedBinding }).errorCode, "continuation_expired");

      const notYetIssuedLedger = createContinuationClaimLedger({ now: () => Date.parse(envelope.issued_at) - 1 });
      assert.equal(notYetIssuedLedger.claim({ envelope, expectedBinding }).errorCode, "continuation_not_yet_valid");

      const reversedTimes = {
        ...clone(envelope),
        issued_at: new Date(Date.parse(envelope.expires_at) + 1_000).toISOString(),
      };
      assert.equal(
        createContinuationClaimLedger({ now: () => beforeExpiry }).claim({ envelope: reversedTimes, expectedBinding }).errorCode,
        "continuation_issued_at_not_before_expiry",
      );

      const invalidExpiry = { ...clone(envelope), expires_at: "2026-02-30T09:02:30Z" };
      assert.equal(
        createContinuationClaimLedger({ now: () => beforeExpiry }).claim({ envelope: invalidExpiry, expectedBinding }).errorCode,
        "continuation_time_invalid",
      );

      const wrongMode = {
        ...clone(envelope),
        dispatch_mode: envelope.dispatch_mode === "same_turn_stop" ? "submitted_envelope" : "same_turn_stop",
      };
      assert.equal(
        createContinuationClaimLedger({ now: () => beforeExpiry }).claim({ envelope: wrongMode, expectedBinding }).errorCode,
        "dispatch_mode_conflict",
      );

      for (const field of allFields) {
        const crossBound = clone(envelope);
        crossBound[field] = typeof envelope[field] === "number" ? envelope[field] + 1 : `${envelope[field]}_cross`;
        const result = createContinuationClaimLedger({ now: () => beforeExpiry }).claim({ envelope: crossBound, expectedBinding });
        assert.equal(result.errorCode, "continuation_binding_mismatch", `${envelope.continuation_origin} must reject cross-bound ${field}`);
        assert.deepEqual(result.mismatchedFields, [field]);
      }

      if (envelope.continuation_origin === "internal_format_repair") {
        const freshRepair = {
          ...clone(envelope),
          continuation_id: `${envelope.continuation_id}_fresh`,
          continuation_token: `${envelope.continuation_token}_fresh`,
          repair_request_id: `${envelope.repair_request_id}_fresh`,
        };
        const freshExpectedBinding = {
          ...expectedBinding,
          repair_request_id: freshRepair.repair_request_id,
        };
        assert.equal(
          ledger.claim({ envelope: freshRepair, expectedBinding: freshExpectedBinding }).errorCode,
          "format_repair_already_claimed_for_boundary",
        );
      } else {
        const reversedDeadline = {
          ...clone(envelope),
          in_flight_deadline_at: new Date(Date.parse(envelope.expires_at) - 1_000).toISOString(),
        };
        assert.equal(
          createContinuationClaimLedger({ now: () => beforeExpiry }).claim({ envelope: reversedDeadline, expectedBinding }).errorCode,
          "continuation_expiry_after_in_flight_deadline",
        );

        const freshPetAction = {
          ...clone(envelope),
          continuation_id: `${envelope.continuation_id}_fresh`,
          continuation_token: `${envelope.continuation_token}_fresh`,
        };
        assert.equal(
          ledger.claim({ envelope: freshPetAction, expectedBinding }).errorCode,
          "pet_action_already_claimed_for_selection",
        );
      }
    });
  }
});

test("semantic traces enforce same-turn boundary, binding, transport, outcome, and timeout rules", async (t) => {
  const suite = await suitePromise;
  const traces = await loadSemanticTraces();
  const runtimeValidator = suite.compiled.validatorsByName.get("runtime_event");
  assert.equal(typeof runtimeValidator, "function", "runtime-event contract must exist");

  for (const { filename, trace } of traces) {
    await t.test(trace.name ?? path.basename(filename), () => {
      assert.equal(trace.trace_version, "1.0");
      assert.equal(typeof trace.valid, "boolean");
      for (const [index, wrapperEvent] of trace.events.entries()) {
        const event = extractRuntimeEvent(wrapperEvent);
        assertSchemaResult(runtimeValidator, event, true, `${filename} event[${index}]`);
      }
      const result = validateSemanticTrace(trace);
      assert.equal(result.valid, trace.valid, `${filename}: ${JSON.stringify(result)}`);
      assert.equal(result.errorCode, trace.expected_error_code, `${filename}: semantic error code`);
    });
  }

  const valid = traces.filter(({ trace }) => trace.valid).map(({ trace }) => trace);
  const invalid = traces.filter(({ trace }) => !trace.valid).map(({ trace }) => trace);
  assert.ok(invalid.some((trace) => trace.expected_error_code === "stale_decision_boundary"), "stale/cross-boundary selection rejection trace is required");
  assert.ok(invalid.some((trace) => trace.expected_error_code === "decision_boundary_binding_mismatch"), "within-boundary binding mismatch rejection trace is required");

  const multiBoundary = valid.find((trace) => {
    const opened = trace.events.filter((event) => traceEventType(event) === "decision_boundary_opened");
    if (opened.length < 2) return false;
    const data = opened.map(extractRuntimeEvent);
    return data[0].source_turn_id === data[1].source_turn_id && data[0].boundary_sequence === 1 && data[1].boundary_sequence === 2;
  });
  assert.ok(multiBoundary, "a valid same-turn boundary sequence 1 then 2 trace is required");

  const separateOutcome = valid.find((trace) => {
    const types = trace.events.map(traceEventType);
    return types.includes("continuation_transport_completed") && types.includes("work_outcome_recorded");
  });
  assert.ok(separateOutcome, "transport completion and work outcome must be separate explicit events");

  const timedOut = valid.find((trace) => trace.events.some((event) => traceEventType(event) === "continuation_transport_timed_out_unknown"));
  assert.ok(timedOut, "an in-flight timeout trace is required");
  const timeoutEvent = timedOut.events.find((event) => traceEventType(event) === "continuation_transport_timed_out_unknown");
  assert.deepEqual(
    {
      transport_status: traceEventData(timeoutEvent).transport_status,
      work_outcome_status: traceEventData(timeoutEvent).work_outcome_status,
      automatic_retry: traceEventData(timeoutEvent).automatic_retry,
      cancellation_inferred: traceEventData(timeoutEvent).cancellation_inferred,
      failure_inferred: traceEventData(timeoutEvent).failure_inferred,
    },
    {
      transport_status: "timed_out_unknown",
      work_outcome_status: "unknown",
      automatic_retry: false,
      cancellation_inferred: false,
      failure_inferred: false,
    },
  );
});

test("internal format repair journal replay preserves one boundary reservation budget", async (t) => {
  const suite = await suitePromise;
  const runtimeValidator = suite.compiled.validatorsByName.get("runtime_event");
  assert.equal(typeof runtimeValidator, "function");
  const reservedFixture = caseFor(
    suite,
    (item) => item.valid && item.name === "valid_runtime_format_repair_reserved",
    "a valid internal-format-repair reservation event",
  ).value;
  const claimedFixture = caseFor(
    suite,
    (item) => item.valid && item.name === "valid_runtime_format_repair_claimed",
    "a valid internal-format-repair claim event",
  ).value;

  const opened = {
    ...clone(reservedFixture),
    event_id: "event_inline_format_repair_boundary_opened",
    event_type: "decision_boundary_opened",
    event_category: "decision_lifecycle",
    occurred_at: new Date(Date.parse(reservedFixture.occurred_at) - 1_000).toISOString(),
    payload: { proposal_id: "proposal_inline_format_repair" },
  };
  const traceFrom = (name, events, extra = {}) => resequenceTrace({
    trace_version: "1.0",
    name,
    valid: true,
    expected_error_code: null,
    events: events.map(clone),
    ...extra,
  });
  const freshReservation = (suffix) => {
    const event = clone(reservedFixture);
    event.event_id = `${event.event_id}_${suffix}`;
    event.payload.continuation_id = `${event.payload.continuation_id}_${suffix}`;
    event.payload.repair_request_id = `${event.payload.repair_request_id}_${suffix}`;
    event.payload.correlation_token_fingerprint = `sha256:${"b".repeat(64)}`;
    return event;
  };
  const packetSealed = (suffix, occurredAtValue) => ({
    ...clone(reservedFixture),
    event_id: `event_inline_format_repair_packet_${suffix}`,
    event_type: "decision_packet_sealed",
    event_category: "decision_lifecycle",
    occurred_at: occurredAtValue,
    payload: {
      interaction_id: `interaction_inline_format_repair_${suffix}`,
      packet_id: `packet_inline_format_repair_${suffix}`,
      revision: 1,
      expires_at: "2026-01-15T09:02:00Z",
    },
  });

  await t.test("reserved then claimed is a valid journal pair", () => {
    const trace = traceFrom("valid_format_repair_journal_pair", [opened, reservedFixture, claimedFixture]);
    assertSemanticValid(trace, runtimeValidator, trace.name);
  });

  await t.test("a repaired decision packet seals only after reservation and claim", () => {
    const packet = packetSealed("after_claim", "2026-01-15T09:00:31.500Z");
    const trace = traceFrom("valid_format_repair_then_packet", [opened, reservedFixture, claimedFixture, packet]);
    assertSemanticValid(trace, runtimeValidator, trace.name);
  });

  await t.test("claimed requires a preceding durable reservation", () => {
    const trace = traceFrom("format_repair_claimed_without_reservation", [opened, claimedFixture]);
    assertSemanticError(trace, "format_repair_not_reserved", runtimeValidator, trace.name);
  });

  await t.test("reservation alone permanently consumes the boundary budget", () => {
    const trace = traceFrom(
      "format_repair_duplicate_reservation_without_claim",
      [opened, reservedFixture, freshReservation("second")],
      { restart_after_event_sequence: 2 },
    );
    assertSemanticError(trace, "format_repair_already_reserved_for_boundary", runtimeValidator, trace.name);
  });

  await t.test("replayed reservation and claim survive a simulated restart", () => {
    const trace = traceFrom(
      "format_repair_restart_replay",
      [opened, reservedFixture, claimedFixture, freshReservation("after_restart")],
      { restart_after_event_sequence: 3 },
    );
    assertSemanticError(trace, "format_repair_already_reserved_for_boundary", runtimeValidator, trace.name);
  });

  await t.test("a reservation may be claimed once", () => {
    const duplicateClaim = clone(claimedFixture);
    duplicateClaim.event_id = `${duplicateClaim.event_id}_duplicate`;
    const trace = traceFrom("format_repair_duplicate_claim", [opened, reservedFixture, claimedFixture, duplicateClaim]);
    assertSemanticError(trace, "format_repair_already_claimed_for_boundary", runtimeValidator, trace.name);
  });

  for (const { field, value } of [
    { field: "continuation_id", value: "continuation_inline_format_repair_cross" },
    { field: "repair_request_id", value: "repair_request_inline_format_repair_cross" },
    { field: "correlation_token_fingerprint", value: `hmac-sha256:${"c".repeat(64)}` },
  ]) {
    await t.test(`claimed ${field} must match the reservation`, () => {
      const mismatchedClaim = clone(claimedFixture);
      mismatchedClaim.payload[field] = value;
      const trace = traceFrom(`format_repair_claim_${field}_mismatch`, [opened, reservedFixture, mismatchedClaim]);
      assertSemanticError(trace, "format_repair_reservation_mismatch", runtimeValidator, trace.name);
    });
  }

  await t.test("claimed event keeps the exact boundary binding", () => {
    const mismatchedClaim = clone(claimedFixture);
    mismatchedClaim.session_id = `${mismatchedClaim.session_id}_cross`;
    const trace = traceFrom("format_repair_claim_boundary_mismatch", [opened, reservedFixture, mismatchedClaim]);
    assertSemanticError(trace, "decision_boundary_binding_mismatch", runtimeValidator, trace.name);
  });

  await t.test("parent prompt is bound to the boundary source prompt", () => {
    const mismatchedReservation = clone(reservedFixture);
    mismatchedReservation.payload.parent_prompt_id = `${mismatchedReservation.payload.parent_prompt_id}_cross`;
    const trace = traceFrom("format_repair_parent_prompt_mismatch", [opened, mismatchedReservation]);
    assertSemanticError(trace, "format_repair_parent_prompt_mismatch", runtimeValidator, trace.name);
  });

  await t.test("claim occurred_at cannot precede reservation occurred_at", () => {
    const laterReservation = clone(reservedFixture);
    laterReservation.occurred_at = new Date(Date.parse(laterReservation.occurred_at) + 2_000).toISOString();
    const trace = traceFrom("format_repair_claim_before_reservation", [opened, laterReservation, claimedFixture]);
    assertSemanticError(trace, "format_repair_claim_before_reservation", runtimeValidator, trace.name);
  });

  await t.test("repair claim ordering preserves sub-millisecond precision", () => {
    const nanosecondReservation = clone(reservedFixture);
    nanosecondReservation.occurred_at = "2026-01-15T09:00:30.000000002Z";
    const nanosecondClaim = clone(claimedFixture);
    nanosecondClaim.occurred_at = "2026-01-15T09:00:30.000000001Z";
    const trace = traceFrom("format_repair_claim_one_nanosecond_before_reservation", [opened, nanosecondReservation, nanosecondClaim]);
    assertSemanticError(trace, "format_repair_claim_before_reservation", runtimeValidator, trace.name);
  });

  await t.test("repair reservation must precede the first sealed decision packet", () => {
    const packet = packetSealed("before_reservation", "2026-01-15T09:00:29.500Z");
    const trace = traceFrom("format_repair_reserved_after_packet", [opened, packet, reservedFixture]);
    assertSemanticError(trace, "format_repair_after_packet_sealed", runtimeValidator, trace.name);
  });

  await t.test("a reserved repair must be claimed before the first sealed decision packet", () => {
    const packet = packetSealed("before_claim", "2026-01-15T09:00:30.500Z");
    const trace = traceFrom("format_repair_claimed_after_packet", [opened, reservedFixture, packet, claimedFixture]);
    assertSemanticError(trace, "format_repair_not_claimed_before_packet", runtimeValidator, trace.name);
  });

  await t.test("repair journal events stay inside their issued and expiry window", () => {
    const expiredReservation = clone(reservedFixture);
    expiredReservation.occurred_at = expiredReservation.payload.expires_at;
    const trace = traceFrom("format_repair_reservation_at_expiry", [opened, expiredReservation]);
    assertSemanticError(trace, "format_repair_time_invalid", runtimeValidator, trace.name);
  });

  await t.test("raw correlation tokens are rejected even without schema prevalidation", () => {
    const rawReservation = clone(reservedFixture);
    rawReservation.payload.correlation_token = "raw_token_must_not_enter_journal";
    const trace = traceFrom("format_repair_raw_token", [opened, rawReservation]);
    const result = validateSemanticTrace(trace);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, "raw_correlation_token_forbidden");
  });
});

test("semantic trace mutations fail closed with stable lifecycle error codes", async (t) => {
  const suite = await suitePromise;
  const traces = (await loadSemanticTraces()).map(({ trace }) => trace);
  const runtimeValidator = suite.compiled.validatorsByName.get("runtime_event");
  assert.equal(typeof runtimeValidator, "function");
  const sameTurn = traces.find((trace) => trace.name === "same_turn_two_boundaries");
  const timeout = traces.find((trace) => trace.name === "in_flight_timeout_unknown");
  assert.ok(sameTurn && timeout, "valid lifecycle traces are required for mutation tests");

  const mutate = (base, name, mutation) => {
    const trace = clone(base);
    trace.name = name;
    mutation(trace);
    return resequenceTrace(trace);
  };

  const makeInteractionExpired = (packetEvent, suffix, occurredAtValue = traceEventData(packetEvent).expires_at) => {
    const event = clone(extractRuntimeEvent(packetEvent));
    const packet = traceEventData(packetEvent);
    event.event_id = `${event.event_id}_${suffix}`;
    event.event_type = "interaction_expired";
    event.event_category = "decision_lifecycle";
    event.occurred_at = occurredAtValue;
    event.payload = {
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      reason: "interaction_timeout",
      automatic_selection: false,
    };
    return event;
  };

  const makePacketReseal = (packetEvent, suffix, overrides = {}) => {
    const event = clone(extractRuntimeEvent(packetEvent));
    const previous = traceEventData(packetEvent);
    event.event_id = `${event.event_id}_${suffix}`;
    event.occurred_at = new Date(Date.parse(event.occurred_at) + 500).toISOString();
    event.payload = {
      ...previous,
      revision: previous.revision + 1,
      expires_at: new Date(Date.parse(previous.expires_at) + 1_000).toISOString(),
      ...overrides.payload,
    };
    if (overrides.occurred_at) event.occurred_at = overrides.occurred_at;
    return event;
  };

  await t.test("a claimed selection dispatches only one continuation", () => {
    const trace = mutate(sameTurn, "duplicate_dispatch_for_selection", (candidate) => {
      const index = candidate.events.findIndex((event) => traceEventType(event) === "continuation_dispatched");
      const duplicate = clone(candidate.events[index]);
      duplicate.event_id = `${duplicate.event_id}_duplicate`;
      traceEventData(duplicate).continuation_id = `${traceEventData(duplicate).continuation_id}_different`;
      candidate.events.splice(index + 1, 0, duplicate);
    });
    assertSemanticError(trace, "continuation_already_dispatched_for_selection", runtimeValidator, trace.name);
  });

  await t.test("a continuation can be consumed once", () => {
    const trace = mutate(sameTurn, "duplicate_continuation_consumed", (candidate) => {
      const index = candidate.events.findIndex((event) => traceEventType(event) === "continuation_consumed");
      const duplicate = clone(candidate.events[index]);
      duplicate.event_id = `${duplicate.event_id}_duplicate`;
      candidate.events.splice(index + 1, 0, duplicate);
    });
    assertSemanticError(trace, "continuation_already_consumed", runtimeValidator, trace.name);
  });

  await t.test("consumed mode must match the dispatched continuation", () => {
    const trace = mutate(sameTurn, "consumed_dispatch_mode_mismatch", (candidate) => {
      traceEventData(eventOfType(candidate, "continuation_consumed")).dispatch_mode = "submitted_envelope";
    });
    assertSemanticError(trace, "continuation_dispatch_mode_mismatch", runtimeValidator, trace.name);
  });

  await t.test("completed transport requires a prior consumed event", () => {
    const trace = mutate(sameTurn, "completion_without_consumption", (candidate) => {
      const index = candidate.events.findIndex((event) => traceEventType(event) === "continuation_consumed");
      candidate.events.splice(index, 1);
    });
    assertSemanticError(trace, "continuation_not_consumed", runtimeValidator, trace.name);
  });

  for (const { name, mutateDispatch, expected } of [
    {
      name: "dispatch_issued_at_equals_expiry",
      mutateDispatch: (data) => { data.issued_at = data.expires_at; },
      expected: "continuation_issued_at_not_before_expiry",
    },
    {
      name: "dispatch_expiry_after_deadline",
      mutateDispatch: (data) => { data.expires_at = new Date(Date.parse(data.in_flight_deadline_at) + 1_000).toISOString(); },
      expected: "continuation_expiry_after_in_flight_deadline",
    },
  ]) {
    await t.test(name, () => {
      const trace = mutate(sameTurn, name, (candidate) => mutateDispatch(traceEventData(eventOfType(candidate, "continuation_dispatched"))));
      assertSemanticError(trace, expected, runtimeValidator, name);
    });
  }

  for (const { name, occurredAtFrom, expected } of [
    {
      name: "dispatch_before_issued_at",
      occurredAtFrom: (data) => new Date(Date.parse(data.issued_at) - 1_000).toISOString(),
      expected: "continuation_dispatched_before_issued_at",
    },
    {
      name: "dispatch_at_expiry",
      occurredAtFrom: (data) => data.expires_at,
      expected: "continuation_dispatched_at_or_after_expiry",
    },
  ]) {
    await t.test(name, () => {
      const trace = mutate(sameTurn, name, (candidate) => {
        const dispatch = eventOfType(candidate, "continuation_dispatched");
        extractRuntimeEvent(dispatch).occurred_at = occurredAtFrom(traceEventData(dispatch));
      });
      assertSemanticError(trace, expected, runtimeValidator, name);
    });
  }

  await t.test("completion at the in-flight deadline uses timeout semantics", () => {
    const trace = mutate(sameTurn, "completion_at_in_flight_deadline", (candidate) => {
      const dispatch = eventOfType(candidate, "continuation_dispatched");
      const completion = eventOfType(candidate, "continuation_transport_completed");
      extractRuntimeEvent(completion).occurred_at = traceEventData(dispatch).in_flight_deadline_at;
    });
    assertSemanticError(trace, "transport_completion_after_in_flight_deadline", runtimeValidator, trace.name);
  });

  await t.test("timeout cannot be observed before the in-flight deadline", () => {
    const trace = mutate(timeout, "timeout_before_deadline", (candidate) => {
      const dispatch = eventOfType(candidate, "continuation_dispatched");
      const timeoutEvent = eventOfType(candidate, "continuation_transport_timed_out_unknown");
      extractRuntimeEvent(timeoutEvent).occurred_at = new Date(
        Date.parse(traceEventData(dispatch).in_flight_deadline_at) - 1_000,
      ).toISOString();
    });
    assertSemanticError(trace, "timeout_before_in_flight_deadline", runtimeValidator, trace.name);
  });

  await t.test("timeout comparison preserves sub-millisecond precision", () => {
    const trace = mutate(timeout, "timeout_one_nanosecond_before_deadline", (candidate) => {
      const dispatch = eventOfType(candidate, "continuation_dispatched");
      const timeoutEvent = eventOfType(candidate, "continuation_transport_timed_out_unknown");
      traceEventData(dispatch).in_flight_deadline_at = "2026-01-15T12:05:03.000000002Z";
      extractRuntimeEvent(timeoutEvent).occurred_at = "2026-01-15T12:05:03.000000001Z";
    });
    assertSemanticError(trace, "timeout_before_in_flight_deadline", runtimeValidator, trace.name);
  });

  await t.test("packet seal must precede packet expiry", () => {
    const trace = mutate(sameTurn, "packet_expiry_not_after_seal", (candidate) => {
      const packet = eventOfType(candidate, "decision_packet_sealed");
      traceEventData(packet).expires_at = extractRuntimeEvent(packet).occurred_at;
    });
    assertSemanticError(trace, "decision_packet_time_invalid", runtimeValidator, trace.name);
  });

  await t.test("selection at packet expiry is rejected even without an expiration event", () => {
    const trace = mutate(sameTurn, "selection_at_packet_expiry", (candidate) => {
      const packet = eventOfType(candidate, "decision_packet_sealed");
      const selection = eventOfType(candidate, "decision_selection_claimed");
      extractRuntimeEvent(selection).occurred_at = traceEventData(packet).expires_at;
    });
    assertSemanticError(trace, "decision_packet_expired", runtimeValidator, trace.name);
  });

  await t.test("packet revisions may reseal contiguously before claim and prior expiry", () => {
    const trace = mutate(sameTurn, "valid_packet_reseal_before_claim", (candidate) => {
      const packetIndex = candidate.events.findIndex((event) => traceEventType(event) === "decision_packet_sealed");
      const reseal = makePacketReseal(candidate.events[packetIndex], "valid_reseal");
      candidate.events.splice(packetIndex + 1, 0, reseal);
      traceEventData(eventOfType(candidate, "decision_selection_claimed")).revision = 2;
      traceEventData(eventOfType(candidate, "continuation_dispatched")).revision = 2;
    });
    assertSemanticValid(trace, runtimeValidator, trace.name);
  });

  await t.test("the first sealed packet revision is one", () => {
    const trace = mutate(sameTurn, "invalid_initial_packet_revision", (candidate) => {
      traceEventData(eventOfType(candidate, "decision_packet_sealed")).revision = 2;
    });
    assertSemanticError(trace, "decision_packet_initial_revision_invalid", runtimeValidator, trace.name);
  });

  await t.test("packet cannot reseal after its selection is claimed", () => {
    const trace = mutate(sameTurn, "packet_reseal_after_claim", (candidate) => {
      const selectionIndex = candidate.events.findIndex((event) => traceEventType(event) === "decision_selection_claimed");
      const packet = eventOfType(candidate, "decision_packet_sealed");
      candidate.events.splice(selectionIndex + 1, 0, makePacketReseal(packet, "after_claim"));
    });
    assertSemanticError(trace, "decision_packet_reseal_after_claim", runtimeValidator, trace.name);
  });

  for (const identityField of ["interaction_id", "packet_id"]) {
    await t.test(`packet reseal preserves ${identityField}`, () => {
      const trace = mutate(sameTurn, `packet_reseal_changed_${identityField}`, (candidate) => {
        const packetIndex = candidate.events.findIndex((event) => traceEventType(event) === "decision_packet_sealed");
        const packet = candidate.events[packetIndex];
        const reseal = makePacketReseal(packet, `changed_${identityField}`, {
          payload: { [identityField]: `${traceEventData(packet)[identityField]}_cross` },
        });
        candidate.events.splice(packetIndex + 1, 0, reseal);
      });
      assertSemanticError(trace, "decision_packet_identity_changed", runtimeValidator, trace.name);
    });
  }

  for (const revision of [1, 3]) {
    await t.test(`packet reseal rejects revision ${revision}`, () => {
      const trace = mutate(sameTurn, `packet_reseal_revision_${revision}`, (candidate) => {
        const packetIndex = candidate.events.findIndex((event) => traceEventType(event) === "decision_packet_sealed");
        const packet = candidate.events[packetIndex];
        candidate.events.splice(packetIndex + 1, 0, makePacketReseal(packet, `revision_${revision}`, {
          payload: { revision },
        }));
      });
      assertSemanticError(trace, "decision_packet_revision_not_contiguous", runtimeValidator, trace.name);
    });
  }

  await t.test("packet cannot reseal at or after the prior revision expiry", () => {
    const trace = mutate(sameTurn, "packet_reseal_after_prior_expiry", (candidate) => {
      const packetIndex = candidate.events.findIndex((event) => traceEventType(event) === "decision_packet_sealed");
      const packet = candidate.events[packetIndex];
      candidate.events.splice(packetIndex + 1, 0, makePacketReseal(packet, "after_expiry", {
        occurred_at: traceEventData(packet).expires_at,
      }));
    });
    assertSemanticError(trace, "decision_packet_reseal_after_expiry", runtimeValidator, trace.name);
  });

  await t.test("selection must claim the latest resealed packet revision", () => {
    const trace = mutate(sameTurn, "selection_claims_stale_packet_revision", (candidate) => {
      const packetIndex = candidate.events.findIndex((event) => traceEventType(event) === "decision_packet_sealed");
      candidate.events.splice(packetIndex + 1, 0, makePacketReseal(candidate.events[packetIndex], "latest"));
    });
    assertSemanticError(trace, "decision_packet_revision_stale", runtimeValidator, trace.name);
  });

  await t.test("same-turn boundary N+1 waits for boundary N to close", () => {
    const trace = mutate(sameTurn, "overlapping_same_turn_boundaries", (candidate) => {
      const firstClose = candidate.events.findIndex((event) => traceEventType(event) === "decision_boundary_closed");
      candidate.events.splice(firstClose, 1);
    });
    assertSemanticError(trace, "previous_decision_boundary_still_open", runtimeValidator, trace.name);
  });

  const firstPacket = eventOfType(sameTurn, "decision_packet_sealed");
  const firstOpen = eventOfType(sameTurn, "decision_boundary_opened");
  const firstSelection = eventOfType(sameTurn, "decision_selection_claimed");
  const firstDispatch = eventOfType(sameTurn, "continuation_dispatched");
  const expiration = makeInteractionExpired(firstPacket, "valid");

  await t.test("an unclaimed interaction may expire at its packet expiry", () => {
    const trace = resequenceTrace({
      ...clone(sameTurn),
      name: "valid_unclaimed_interaction_expiry",
      events: [clone(firstOpen), clone(firstPacket), clone(expiration)],
    });
    assertSemanticValid(trace, runtimeValidator, trace.name);
  });

  await t.test("interaction expiration verifies sealed packet identifiers", () => {
    const mismatched = clone(expiration);
    mismatched.payload.packet_id = `${mismatched.payload.packet_id}_cross`;
    const trace = resequenceTrace({
      ...clone(sameTurn),
      name: "interaction_expiry_packet_mismatch",
      events: [clone(firstOpen), clone(firstPacket), mismatched],
    });
    assertSemanticError(trace, "decision_boundary_binding_mismatch", runtimeValidator, trace.name);
  });

  await t.test("interaction cannot expire before the sealed packet", () => {
    const early = new Date(Date.parse(traceEventData(firstPacket).expires_at) - 1_000).toISOString();
    const trace = resequenceTrace({
      ...clone(sameTurn),
      name: "interaction_expiry_before_packet_expiry",
      events: [clone(firstOpen), clone(firstPacket), makeInteractionExpired(firstPacket, "early", early)],
    });
    assertSemanticError(trace, "interaction_expired_before_packet_expiry", runtimeValidator, trace.name);
  });

  await t.test("a claimed interaction cannot later become expired", () => {
    const trace = resequenceTrace({
      ...clone(sameTurn),
      name: "claimed_interaction_then_expired",
      events: [clone(firstOpen), clone(firstPacket), clone(firstSelection), clone(expiration)],
    });
    assertSemanticError(trace, "interaction_already_claimed", runtimeValidator, trace.name);
  });

  for (const { name, eventAfterExpiry } of [
    { name: "selection_after_interaction_expiry", eventAfterExpiry: firstSelection },
    { name: "packet_after_interaction_expiry", eventAfterExpiry: firstPacket },
    { name: "dispatch_after_interaction_expiry", eventAfterExpiry: firstDispatch },
  ]) {
    await t.test(name, () => {
      const trace = resequenceTrace({
        ...clone(sameTurn),
        name,
        events: [clone(firstOpen), clone(firstPacket), clone(expiration), clone(eventAfterExpiry)],
      });
      assertSemanticError(trace, "interaction_already_expired", runtimeValidator, name);
    });
  }

  await t.test("a closed boundary rejects every later boundary-scoped event", async (closedTest) => {
    const firstCloseIndex = sameTurn.events.findIndex((event) => traceEventType(event) === "decision_boundary_closed");
    const closedPrefix = sameTurn.events.slice(0, firstCloseIndex + 1).map(clone);
    const timeoutAfterClose = clone(eventOfType(sameTurn, "continuation_transport_completed"));
    timeoutAfterClose.event_type = "continuation_transport_timed_out_unknown";
    timeoutAfterClose.payload = {
      continuation_id: traceEventData(eventOfType(sameTurn, "continuation_dispatched")).continuation_id,
      transport_status: "timed_out_unknown",
      work_outcome_status: "unknown",
      automatic_retry: false,
      cancellation_inferred: false,
      failure_inferred: false,
    };
    const postCloseEvents = [
      eventOfType(sameTurn, "decision_packet_sealed"),
      eventOfType(sameTurn, "decision_selection_claimed"),
      eventOfType(sameTurn, "continuation_dispatched"),
      eventOfType(sameTurn, "continuation_consumed"),
      eventOfType(sameTurn, "continuation_transport_completed"),
      timeoutAfterClose,
      eventOfType(sameTurn, "work_outcome_recorded"),
      expiration,
    ];

    for (const postCloseEvent of postCloseEvents) {
      const eventType = traceEventType(postCloseEvent);
      await closedTest.test(eventType, () => {
        const appended = clone(postCloseEvent);
        extractRuntimeEvent(appended).event_id = `${extractRuntimeEvent(appended).event_id}_after_close`;
        const trace = resequenceTrace({
          ...clone(sameTurn),
          name: `${eventType}_after_close`,
          events: [...closedPrefix.map(clone), appended],
        });
        assertSemanticError(trace, "decision_boundary_closed", runtimeValidator, trace.name);
      });
    }
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { InMemoryJournal, decide, executeCommand, replay } from "../support/reference-engine/index.mjs";
import { bindingFrom } from "../support/reference-engine/shared.mjs";
import { loadV1ContractSuite, formatAjvErrors } from "../Contracts/contract-harness.mjs";

const basePacket = JSON.parse(await readFile(
  new URL("../../Fixtures/v1/contracts/valid/decision-packet-ranked-actions.json", import.meta.url), "utf8",
));
const suitePromise = loadV1ContractSuite();

async function stateOf(journal) {
  const snapshot = await journal.load();
  return replay(snapshot.events, { documents: snapshot.documents, verificationRecords: snapshot.verificationRecords });
}

async function setup(consumed = false) {
  const journal = new InMemoryJournal();
  const packet = structuredClone(basePacket);
  packet.valid_after_event_sequence = 2;
  const binding = bindingFrom(packet);
  await executeCommand(journal, { type: "open_boundary", event_id: "open", occurred_at: "2026-01-15T09:02:59Z", binding, proposal_id: "proposal" });
  await executeCommand(journal, { type: "seal_packet", event_id: "seal", packet });
  const selection = await executeCommand(journal, {
    type: "select_option", event_ids: { selection_claimed: "selection", continuation_dispatched: "dispatch" },
    occurred_at: "2026-01-15T09:03:01Z", continuation_id: "continuation", issued_at: "2026-01-15T09:03:01Z",
    expires_at: "2026-01-15T09:05:01Z", in_flight_deadline_at: "2026-01-15T09:08:01Z",
    request: { ...binding, schema_version: "1.0", kind: "blabee_selection_request", selection_id: "selection_request",
      interaction_id: packet.interaction_id, packet_id: packet.packet_id, revision: packet.revision, option_id: packet.choices[0].option_id },
  });
  const consume = { type: "consume_pet_action", event_id: "consume", occurred_at: "2026-01-15T09:03:02Z", envelope: selection.effects[0].envelope };
  if (consumed) await executeCommand(journal, consume);
  const failure = { type: "record_transport_not_submitted", event_id: "not_submitted", occurred_at: "2026-01-15T09:03:03Z",
    binding, continuation_id: "continuation", failure_code: "codex_native_version_unqualified", command_invocation_attempted: false };
  return { journal, binding, consume, failure };
}

for (const consumed of [false, true]) {
  test(`confirmed pre-submit failure closes queued transport with consumed=${consumed}`, async () => {
    const { journal, binding, failure } = await setup(consumed);
    const outcome = await executeCommand(journal, failure);
    assert.deepEqual(outcome.effects, []);
    assert.equal(outcome.commit.eventCount, 1);
    assert.deepEqual((await journal.load()).events.at(-1).payload, { continuation_id: "continuation", transport_status: "not_submitted",
      work_outcome_status: "not_recorded", automatic_retry: false, failure_code: failure.failure_code, command_invocation_attempted: false });
    const close = await executeCommand(journal, { type: "close_boundary", event_id: "closed", occurred_at: "2026-01-15T09:03:04Z",
      binding, close_reason: "transport_not_submitted" });
    assert.deepEqual(close.effects, []);
    const state = await stateOf(journal);
    assert.equal(state.continuations.continuation.transport.status, "not_submitted");
    assert.equal(state.continuations.continuation.workOutcome, null);
    assert.equal(Object.values(state.boundaries)[0].closed, true);
    const snapshot = await journal.load();
    assert.equal(snapshot.events.filter(event => event.event_type === "continuation_transport_not_submitted").length, 1);
    assert.equal(snapshot.events.some(event => event.event_type === "work_outcome_recorded"), false);
    const validator = (await suitePromise).compiled.validatorsByName.get("runtime_event");
    for (const event of snapshot.events) assert.equal(validator(event), true, formatAjvErrors(validator.errors));
  });
}

test("not-submitted command requires exact binding, unattempted submission, stable code and real issue time", async (t) => {
  const { journal, failure } = await setup();
  const initial = await stateOf(journal);
  for (const [name, mutate, code] of [
    ["different session", command => { command.binding.session_id = "another_session"; }, "decision_boundary_binding_mismatch"],
    ["different turn", command => { command.binding.source_turn_id = "another_turn"; }, "decision_boundary_binding_mismatch"],
    ["attempted command", command => { command.command_invocation_attempted = true; }, "transport_not_submitted_evidence_required"],
    ["missing command evidence", command => { delete command.command_invocation_attempted; }, "transport_not_submitted_evidence_required"],
    ["invalid reason", command => { command.failure_code = "free form reason"; }, "dispatch_failure_code_invalid"],
    ["before issue", command => { command.occurred_at = "2026-01-15T09:03:00Z"; }, "continuation_not_yet_valid"],
  ]) await t.test(name, () => {
    const command = structuredClone(failure); mutate(command);
    assert.throws(() => decide(initial, command), { code });
  });
  await t.test("wrong dispatch mode", () => {
    const state = structuredClone(initial); state.continuations.continuation.dispatchMode = "same_turn_stop";
    assert.throws(() => decide(state, failure), { code: "dispatch_mode_conflict" });
  });
  assert.deepEqual(await stateOf(journal), initial);
});

test("not-submitted terminal cannot be consumed, completed, timed out, re-recorded or given a work result", async (t) => {
  const { journal, consume, failure } = await setup();
  await executeCommand(journal, failure);
  const state = await stateOf(journal);
  for (const [command, code] of [
    [consume, "transport_already_terminal"],
    [{ ...failure, event_id: "duplicate" }, "transport_already_terminal"],
    [{ ...failure, type: "complete_transport" }, "continuation_not_consumed"],
    [{ ...failure, type: "timeout_transport_unknown", occurred_at: "2026-01-15T09:08:01Z" }, "transport_already_terminal"],
    [{ ...failure, type: "record_work_outcome", status: "failed", summary: "Invalid claimed work after non-submission.", evidence_ids: [] }, "transport_not_submitted"],
  ]) await t.test(command.type, () => assert.throws(() => decide(state, command), { code }));
  assert.deepEqual(await stateOf(journal), state);
});

test("consumed continuation still cannot complete after confirmed non-submission", async () => {
  const { journal, failure } = await setup(true);
  await executeCommand(journal, failure);
  const state = await stateOf(journal);
  assert.throws(() => decide(state, { ...failure, type: "complete_transport" }), { code: "transport_already_terminal" });
});

test("confirmed non-submission preserves its observed time without inventing a deadline timestamp", async () => {
  const { journal, failure } = await setup();
  const observedAt = "2026-01-15T09:03:01Z";
  await executeCommand(journal, { ...failure, occurred_at: observedAt });
  const state = await stateOf(journal);
  assert.equal(state.continuations.continuation.transport.occurredAt, observedAt);
  assert.notEqual(state.continuations.continuation.inFlightDeadlineAt, observedAt);
});

test("not-submitted replay rejects malformed payload, binding, and time", async (t) => {
  const { journal, failure } = await setup();
  await executeCommand(journal, failure);
  const snapshot = await journal.load();
  for (const [name, mutate, code] of [
    ["attempted submission", event => { event.payload.command_invocation_attempted = true; }, "invalid_transport_not_submitted"],
    ["automatic retry", event => { event.payload.automatic_retry = true; }, "invalid_transport_not_submitted"],
    ["claimed work", event => { event.payload.work_outcome_status = "failed"; }, "invalid_transport_not_submitted"],
    ["bad reason", event => { event.payload.failure_code = "invalid code"; }, "dispatch_failure_code_invalid"],
    ["wrong binding", event => { event.session_id = "wrong_session"; }, "decision_boundary_binding_mismatch"],
    ["before issue", event => { event.occurred_at = "2026-01-15T09:03:00Z"; }, "continuation_not_yet_valid"],
  ]) await t.test(name, () => {
    const events = structuredClone(snapshot.events); mutate(events.at(-1));
    assert.throws(() => replay(events, snapshot), { code });
  });
});

test("completed and timed-out observations cannot be relabeled as confirmed non-submission", async (t) => {
  for (const terminal of ["complete_transport", "timeout_transport_unknown"]) await t.test(terminal, async () => {
    const { journal, failure } = await setup(true);
    await executeCommand(journal, { ...failure, type: terminal, event_id: "terminal",
      occurred_at: terminal === "complete_transport" ? "2026-01-15T09:03:03Z" : "2026-01-15T09:08:01Z" });
    const state = await stateOf(journal);
    assert.throws(() => decide(state, failure), { code: "transport_already_terminal" });
  });
});

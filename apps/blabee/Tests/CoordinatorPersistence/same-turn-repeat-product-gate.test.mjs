import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cleanupCoordinatorBuild,
  createPersistenceWorkspace,
  launchProductCoordinator,
  PROJECT_ROOT,
} from "./runtime-harness.mjs";

const LINEAGE = Object.freeze({
  project_id: "project_same_turn_repeat",
  session_id: "session_same_turn_repeat",
  source_turn_id: "turn_same_turn_repeat",
  source_prompt_id: "prompt_same_turn_repeat",
  episode_id: "episode_same_turn_repeat",
  episode_root_prompt_id: "prompt_same_turn_repeat",
  episode_baseline_checkpoint_id: "checkpoint_same_turn_repeat",
});

function binding(sequence) {
  return {
    ...LINEAGE,
    decision_boundary_id: `boundary_same_turn_repeat_${sequence}`,
    boundary_sequence: sequence,
  };
}

async function packetFor(boundary, validAfterEventSequence, suffix) {
  const packet = JSON.parse(await readFile(
    `${PROJECT_ROOT}/Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json`,
    "utf8",
  ));
  Object.assign(packet, boundary, {
    interaction_id: `interaction_same_turn_repeat_${suffix}`,
    packet_id: `packet_same_turn_repeat_${suffix}`,
    revision: 1,
    valid_after_event_sequence: validAfterEventSequence,
    sealed_at: `2026-08-21T02:0${suffix}:00Z`,
    expires_at: `2026-08-21T02:0${suffix + 2}:00Z`,
  });
  packet.checkpoint.id = boundary.episode_baseline_checkpoint_id;
  return packet;
}

async function openAndSeal(client, sequence, expectedOpenSequence) {
  const boundary = binding(sequence);
  const opened = await client.request({
    op: "execute_command",
    command: {
      type: "open_boundary",
      event_id: `event_same_turn_repeat_open_${sequence}`,
      occurred_at: `2026-08-21T02:0${sequence}:00Z`,
      binding: boundary,
      proposal_id: `proposal_same_turn_repeat_${sequence}`,
    },
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.result.last_sequence, expectedOpenSequence);

  const packet = await packetFor(boundary, expectedOpenSequence + 1, sequence);
  const sealed = await client.request({
    op: "execute_command",
    command: {
      type: "seal_packet",
      event_id: `event_same_turn_repeat_seal_${sequence}`,
      packet,
    },
  });
  assert.equal(sealed.ok, true);
  assert.equal(sealed.result.last_sequence, expectedOpenSequence + 1);
  return { boundary, packet };
}

async function selectAndFinish(client, { boundary, packet }, slot, firstSequence) {
  const foreground = await client.request({
    op: "set_foreground",
    target: {
      expected_state: "pending",
      ...boundary,
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
    },
  });
  assert.equal(foreground.ok, true);
  assert.equal(foreground.result.selection_enabled, true);

  const choice = packet.choices.find((candidate) => candidate.slot === slot);
  const continuationID = `continuation_same_turn_repeat_${boundary.boundary_sequence}`;
  const selection = await client.request({
    op: "route_selection",
    command: {
      type: "select_option",
      expected_state: "pending",
      event_ids: {
        selection_claimed: `event_same_turn_repeat_selection_${boundary.boundary_sequence}`,
        continuation_dispatched: `event_same_turn_repeat_dispatch_${boundary.boundary_sequence}`,
        decision_boundary_closed: `event_same_turn_repeat_pause_close_${boundary.boundary_sequence}`,
      },
      occurred_at: "2099-08-21T02:00:00Z",
      request: {
        schema_version: "1.0",
        kind: "blabee_selection_request",
        ...boundary,
        selection_id: `selection_same_turn_repeat_${boundary.boundary_sequence}`,
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: choice.option_id,
      },
      continuation_id: continuationID,
      issued_at: "2099-08-21T02:00:00Z",
      expires_at: "2199-08-21T02:02:00Z",
      in_flight_deadline_at: "2299-08-21T02:05:00Z",
    },
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.result.first_sequence, firstSequence);
  assert.equal(selection.result.last_sequence, firstSequence + 1);
  const envelope = selection.result.effects[0].envelope;
  assert.equal(envelope.continuation_id, continuationID);
  assert.equal(envelope.option_id, choice.option_id);
  assert.match(envelope.continuation_token, /^[A-Za-z0-9_-]{22,1024}$/);

  const consumed = await client.request({
    op: "route_consume_pet_action",
    command: {
      type: "consume_pet_action",
      event_id: `event_same_turn_repeat_consume_${boundary.boundary_sequence}`,
      occurred_at: "2099-08-21T02:00:01Z",
      envelope,
    },
  });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.result.last_sequence, firstSequence + 2);

  const completed = await client.request({
    op: "execute_command",
    command: {
      type: "complete_transport",
      event_id: `event_same_turn_repeat_complete_${boundary.boundary_sequence}`,
      occurred_at: envelope.issued_at,
      binding: boundary,
      continuation_id: continuationID,
    },
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.result.last_sequence, firstSequence + 3);

  const outcome = await client.request({
    op: "execute_command",
    command: {
      type: "record_work_outcome",
      event_id: `event_same_turn_repeat_outcome_${boundary.boundary_sequence}`,
      occurred_at: envelope.issued_at,
      binding: boundary,
      continuation_id: continuationID,
      status: "succeeded",
      summary: `Fictional action ${boundary.boundary_sequence} completed.`,
      evidence_ids: [`evidence_same_turn_repeat_${boundary.boundary_sequence}`],
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.last_sequence, firstSequence + 4);

  const closed = await client.request({
    op: "execute_command",
    command: {
      type: "close_boundary",
      event_id: `event_same_turn_repeat_close_${boundary.boundary_sequence}`,
      occurred_at: envelope.issued_at,
      binding: boundary,
      close_reason: "work_outcome_recorded",
    },
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.result.last_sequence, firstSequence + 5);
  return { continuationID, envelope };
}

test("product coordinator persists two boundaries for one shared Codex turn lineage", async (t) => {
  const workspace = await createPersistenceWorkspace("same-turn-repeat-product-gate");
  let client;
  t.after(async () => {
    await client?.close();
    await workspace.cleanup();
    await cleanupCoordinatorBuild();
  });

  client = await launchProductCoordinator(workspace);
  const first = await openAndSeal(client, 1, 1);

  const prematureSecond = await client.request({
    op: "execute_command",
    command: {
      type: "open_boundary",
      event_id: "event_same_turn_repeat_premature_open_2",
      occurred_at: "2026-08-21T02:02:00Z",
      binding: binding(2),
      proposal_id: "proposal_same_turn_repeat_premature_2",
    },
  });
  assert.equal(prematureSecond.ok, false);
  assert.equal(prematureSecond.error.code, "previous_decision_boundary_still_open");

  const firstResult = await selectAndFinish(client, first, 1, 3);
  const second = await openAndSeal(client, 2, 9);
  const secondResult = await selectAndFinish(client, second, 2, 11);

  assert.notEqual(firstResult.continuationID, secondResult.continuationID);
  assert.notEqual(firstResult.envelope.continuation_token, secondResult.envelope.continuation_token);
  for (const token of [
    firstResult.envelope.continuation_token,
    secondResult.envelope.continuation_token,
  ]) {
    assert.equal(client.stdoutText.split(token).length - 1, 1);
    assert.equal(client.stderrText.includes(token), false);
  }

  const snapshot = await client.request({ op: "load" });
  assert.equal(snapshot.ok, true);
  const opened = snapshot.result.events.filter(
    (event) => event.event_type === "decision_boundary_opened",
  );
  assert.deepEqual(opened.map((event) => event.boundary_sequence), [1, 2]);
  for (const event of opened) {
    for (const [key, value] of Object.entries(LINEAGE)) assert.equal(event[key], value);
  }
  assert.equal(
    new Set(snapshot.result.events
      .filter((event) => event.event_type === "continuation_dispatched")
      .map((event) => event.payload.continuation_id)).size,
    2,
  );
  for (const eventType of [
    "decision_selection_claimed",
    "continuation_dispatched",
    "continuation_consumed",
    "continuation_transport_completed",
    "work_outcome_recorded",
    "decision_boundary_closed",
  ]) {
    assert.equal(
      snapshot.result.events.filter((event) => event.event_type === eventType).length,
      2,
      `${eventType} must occur exactly once per boundary`,
    );
  }
  assert.equal(snapshot.result.journal_sequence, 16);

  await client.close();
  client = await launchProductCoordinator(workspace);
  const replayed = await client.request({ op: "load" });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.result.journal_sequence, 16);
  assert.deepEqual(
    replayed.result.events
      .filter((event) => event.event_type === "decision_boundary_opened")
      .map((event) => event.boundary_sequence),
    [1, 2],
  );
});

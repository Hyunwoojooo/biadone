import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cleanupCoordinatorBuild,
  createPersistenceWorkspace,
  launchProductCoordinator,
  PROJECT_ROOT,
} from "./runtime-harness.mjs";

test("product adapter accepts semantic commands and rejects raw journal append", async (t) => {
  const workspace = await createPersistenceWorkspace("semantic-product-gate");
  let client;
  t.after(async () => {
    await client?.close();
    await workspace.cleanup();
    await cleanupCoordinatorBuild();
  });

  client = await launchProductCoordinator(workspace);
  const binding = {
    project_id: "project_semantic_product_gate",
    session_id: "session_semantic_product_gate",
    source_turn_id: "turn_semantic_product_gate",
    source_prompt_id: "prompt_semantic_product_gate",
    episode_id: "episode_semantic_product_gate",
    episode_root_prompt_id: "prompt_semantic_product_gate",
    episode_baseline_checkpoint_id: "checkpoint_semantic_product_gate",
    decision_boundary_id: "boundary_semantic_product_gate",
    boundary_sequence: 1,
  };

  const semantic = await client.request({
    op: "execute_command",
    command: {
      type: "open_boundary",
      event_id: "event_semantic_product_gate_open",
      occurred_at: "2026-08-21T01:00:00.000000001Z",
      binding,
      proposal_id: "proposal_semantic_product_gate",
    },
  });
  assert.equal(semantic.ok, true);
  assert.deepEqual(semantic.result, {
    effects: [],
    event_count: 1,
    first_sequence: 1,
    last_sequence: 1,
  });

  const packet = JSON.parse(await readFile(
    `${PROJECT_ROOT}/Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json`,
    "utf8",
  ));
  const nulPacketID = "packet_semantic_product_gate\u0000suffix";
  const nulContinuationID = "continuation_semantic_product_gate\u0000suffix";
  Object.assign(packet, binding, {
    interaction_id: "interaction_semantic_product_gate",
    packet_id: nulPacketID,
    revision: 1,
    valid_after_event_sequence: 2,
    sealed_at: "2026-08-21T01:00:01Z",
    expires_at: "2026-08-21T01:02:01Z",
  });
  packet.checkpoint.id = binding.episode_baseline_checkpoint_id;

  const sealed = await client.request({
    op: "execute_command",
    command: {
      type: "seal_packet",
      event_id: "event_semantic_product_gate_seal",
      packet,
    },
  });
  assert.equal(sealed.ok, true);
  assert.equal(sealed.result.last_sequence, 2);

  const directSelection = await client.request({
    op: "execute_command",
    command: {
      type: "select_option",
      event_ids: {
        selection_claimed: "event_semantic_product_gate_selection",
        continuation_dispatched: "event_semantic_product_gate_dispatch",
        decision_boundary_closed: "event_semantic_product_gate_pause_close",
      },
      occurred_at: "2026-08-21T01:00:02Z",
      request: {
        schema_version: "1.0",
        kind: "blabee_selection_request",
        ...binding,
        selection_id: "selection_semantic_product_gate",
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: packet.choices[0].option_id,
      },
      continuation_id: nulContinuationID,
      issued_at: "2026-08-21T01:00:02Z",
      expires_at: "2026-08-21T01:02:02Z",
      in_flight_deadline_at: "2026-08-21T01:05:02Z",
    },
  });
  assert.equal(directSelection.ok, false);
  assert.equal(directSelection.error.code, "foreground_selection_required");

  for (const type of ["expire_interaction", "timeout_transport_unknown"]) {
    const directSchedulerCommand = await client.request({
      op: "execute_command",
      command: { type },
    });
    assert.equal(directSchedulerCommand.ok, false);
    assert.equal(
      directSchedulerCommand.error.code,
      "routing_scheduler_command_required",
    );
  }

  const foreground = await client.request({
    op: "set_foreground",
    target: {
      expected_state: "pending",
      ...binding,
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
    },
  });
  assert.equal(foreground.ok, true);
  assert.equal(foreground.result.selection_enabled, true);
  assert.equal(foreground.result.foreground.packet_id, nulPacketID);

  const selection = await client.request({
    op: "route_selection",
    command: {
      type: "select_option",
      expected_state: "pending",
      event_ids: {
        selection_claimed: "event_semantic_product_gate_selection",
        continuation_dispatched: "event_semantic_product_gate_dispatch",
        decision_boundary_closed: "event_semantic_product_gate_pause_close",
      },
      // B2 replaces all external wall timestamps and duration authority with
      // seal-time + continuous elapsed and its fixed 120/300-second windows.
      occurred_at: "2099-08-21T01:00:02Z",
      request: {
        schema_version: "1.0",
        kind: "blabee_selection_request",
        ...binding,
        selection_id: "selection_semantic_product_gate",
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: packet.choices[0].option_id,
      },
      continuation_id: nulContinuationID,
      issued_at: "2099-08-21T01:00:02Z",
      expires_at: "2199-08-21T01:02:02Z",
      in_flight_deadline_at: "2299-08-21T01:05:02Z",
    },
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.result.first_sequence, 3);
  assert.equal(selection.result.last_sequence, 4);
  assert.equal(selection.result.event_count, 2);
  assert.equal(selection.result.effects.length, 1);
  const envelope = selection.result.effects[0].envelope;
  assert.match(envelope.continuation_token, /^[A-Za-z0-9_-]{22,1024}$/);
  assert.equal(
    client.stdoutText.split(envelope.continuation_token).length - 1,
    1,
    "the issued one-time token must appear exactly once on stdout",
  );
  assert.equal(client.stderrText.includes(envelope.continuation_token), false);

  const directConsume = await client.request({
    op: "execute_command",
    command: {
      type: "consume_pet_action",
      event_id: "event_semantic_product_gate_consume",
      occurred_at: envelope.issued_at,
      envelope,
    },
  });
  assert.equal(directConsume.ok, false);
  assert.equal(directConsume.error.code, "routing_token_consumption_required");

  const consumed = await client.request({
    op: "route_consume_pet_action",
    command: {
      type: "consume_pet_action",
      event_id: "event_semantic_product_gate_consume",
      occurred_at: "2099-08-21T01:00:02Z",
      envelope,
    },
  });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.result.last_sequence, 5);
  assert.equal(
    client.stdoutText.split(envelope.continuation_token).length - 1,
    1,
    "consume must not echo a submitted token",
  );
  assert.equal(client.stderrText.includes(envelope.continuation_token), false);

  const completed = await client.request({
    op: "execute_command",
    command: {
      type: "complete_transport",
      event_id: "event_semantic_product_gate_complete",
      occurred_at: envelope.issued_at,
      binding,
      continuation_id: nulContinuationID,
    },
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.result.last_sequence, 6);

  const nulBinding = Object.fromEntries(
    Object.entries(binding).map(([key, value]) => [
      key,
      key === "boundary_sequence" ? value : `${value}_nul`,
    ]),
  );
  const nulEventID = "event_semantic_product_gate\u0000suffix";
  const nulOpen = await client.request({
    op: "execute_command",
    command: {
      type: "open_boundary",
      event_id: nulEventID,
      occurred_at: "2026-08-21T01:00:04Z",
      binding: nulBinding,
      proposal_id: "proposal_semantic_product_gate_nul",
    },
  });
  assert.equal(nulOpen.ok, true);
  assert.equal(nulOpen.result.last_sequence, 7);
  await client.close();
  client = await launchProductCoordinator(workspace);
  const replayed = await client.request({ op: "load" });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.result.events.at(-1).event_id, nulEventID);
  const replayedDispatch = replayed.result.events.find(
    (event) => event.event_type === "continuation_dispatched",
  );
  assert.equal(replayedDispatch.payload.packet_id, nulPacketID);
  assert.equal(replayedDispatch.payload.continuation_id, nulContinuationID);

  const bypass = await client.request({ op: "append" });
  assert.equal(bypass.ok, false);
  assert.equal(bypass.error.code, "semantic_command_required");

  const health = await client.request({ op: "health" });
  assert.equal(health.ok, true);
  assert.equal(health.result.journal_sequence, 7);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CoordinatorError,
  InMemoryJournal,
  constantTimeEqual,
  continuationFor,
  decide,
  executeCommand,
  fingerprintToken,
  generateTokenMaterial,
  parseTimestamp,
  packetForBoundary,
  replay,
  verifyTokenFingerprint,
} from "../../src/coordinator-core/index.mjs";
import {
  formatAjvErrors,
  loadV1ContractSuite,
} from "../Contracts/contract-harness.mjs";

const suitePromise = loadV1ContractSuite();
const basePacket = JSON.parse(await readFile(
  new URL("../../Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json", import.meta.url),
  "utf8",
));

let uniqueId = 0;

function id(prefix) {
  uniqueId += 1;
  return `${prefix}_${String(uniqueId).padStart(4, "0")}`;
}

function binding({
  projectId = "project_core",
  sessionId = "session_core",
  turnId = "turn_core_001",
  promptId = "prompt_core_001",
  episodeId = "episode_core",
  rootPromptId = "prompt_core_001",
  checkpointId = "checkpoint_core_before_prompt",
  boundaryId = "boundary_core_001",
  boundarySequence = 1,
} = {}) {
  return {
    project_id: projectId,
    session_id: sessionId,
    source_turn_id: turnId,
    source_prompt_id: promptId,
    episode_id: episodeId,
    episode_root_prompt_id: rootPromptId,
    episode_baseline_checkpoint_id: checkpointId,
    decision_boundary_id: boundaryId,
    boundary_sequence: boundarySequence,
  };
}

function packetFor(boundary, eventSequence, {
  revision = 1,
  identity,
  sealedAt = "2026-08-21T01:00:01Z",
  expiresAt = "2026-08-21T01:02:01Z",
  suffix = `${boundary.boundary_sequence}_r${revision}`,
} = {}) {
  const packet = structuredClone(basePacket);
  Object.assign(packet, boundary);
  packet.interaction_id = identity?.interaction_id ?? `interaction_core_${boundary.boundary_sequence}`;
  packet.packet_id = identity?.packet_id ?? `packet_core_${boundary.boundary_sequence}`;
  packet.revision = revision;
  packet.valid_after_event_sequence = eventSequence;
  packet.sealed_at = sealedAt;
  packet.expires_at = expiresAt;
  packet.summary = `Fictional coordinator packet ${suffix}`;
  packet.checkpoint.id = boundary.episode_baseline_checkpoint_id;
  for (const choice of packet.choices) {
    choice.option_id = `option_core_${suffix}_${choice.slot}`;
    if (choice.action_id) choice.action_id = `action_core_${suffix}_${choice.slot}`;
  }
  return packet;
}

function selectionFor(packet, slot, overrides = {}) {
  const choice = packet.choices[slot - 1];
  return {
    schema_version: "1.0",
    kind: "blabee_selection_request",
    selection_id: id("selection"),
    interaction_id: packet.interaction_id,
    project_id: packet.project_id,
    session_id: packet.session_id,
    source_turn_id: packet.source_turn_id,
    source_prompt_id: packet.source_prompt_id,
    episode_id: packet.episode_id,
    episode_root_prompt_id: packet.episode_root_prompt_id,
    episode_baseline_checkpoint_id: packet.episode_baseline_checkpoint_id,
    decision_boundary_id: packet.decision_boundary_id,
    boundary_sequence: packet.boundary_sequence,
    packet_id: packet.packet_id,
    revision: packet.revision,
    option_id: choice.option_id,
    ...overrides,
  };
}

function openCommand(boundary, occurredAt = "2026-08-21T01:00:00Z") {
  return {
    type: "open_boundary",
    event_id: id("event_open"),
    occurred_at: occurredAt,
    binding: boundary,
    proposal_id: id("proposal"),
  };
}

function sealCommand(packet) {
  return { type: "seal_packet", event_id: id("event_seal"), packet };
}

function selectCommand(packet, slot, {
  occurredAt = "2026-08-21T01:00:03Z",
  issuedAt = occurredAt,
  expiresAt = "2026-08-21T01:02:03Z",
  deadlineAt = "2026-08-21T01:05:03Z",
  tokenMaterial,
  request = selectionFor(packet, slot),
} = {}) {
  const command = {
    type: "select_option",
    event_ids: {
      selection_claimed: id("event_selection"),
      continuation_dispatched: id("event_dispatch"),
      decision_boundary_closed: id("event_pause_close"),
    },
    occurred_at: occurredAt,
    request,
    continuation_id: id("continuation"),
    issued_at: issuedAt,
    expires_at: expiresAt,
    in_flight_deadline_at: deadlineAt,
  };
  if (tokenMaterial !== undefined) command.token_material = tokenMaterial;
  return command;
}

async function stateOf(journal) {
  const snapshot = await journal.load();
  return replay(snapshot.events, {
    documents: snapshot.documents,
    verificationRecords: snapshot.verificationRecords,
  });
}

async function setupWaiting({
  boundary: decisionBoundary = binding(),
  sealedAt,
  expiresAt,
} = {}) {
  const journal = new InMemoryJournal();
  await executeCommand(journal, openCommand(decisionBoundary));
  const current = await stateOf(journal);
  const packet = packetFor(decisionBoundary, current.eventSequence + 1, { sealedAt, expiresAt });
  await executeCommand(journal, sealCommand(packet));
  return { journal, packet, boundary: decisionBoundary };
}

function errorCode(expected) {
  return (error) => {
    assert.ok(error instanceof CoordinatorError, `expected CoordinatorError, received ${error}`);
    assert.equal(error.code, expected);
    return true;
  };
}

async function assertV1(name, value) {
  const suite = await suitePromise;
  const validator = suite.compiled.validatorsByName.get(name);
  assert.ok(validator, `missing ${name} validator`);
  assert.equal(validator(value), true, formatAjvErrors(validator.errors));
}

async function assertSnapshotEventsAreV1(snapshot) {
  for (const event of snapshot.events) await assertV1("runtime_event", event);
  for (const packet of snapshot.documents) await assertV1("decision_packet", packet);
}

function artifactsForPrefix(snapshot, prefixEvents) {
  const eventIds = new Set(prefixEvents.map((event) => event.event_id));
  const sealed = new Set(
    prefixEvents
      .filter((event) => event.event_type === "decision_packet_sealed")
      .map((event) => `${event.payload.packet_id}\0${event.payload.revision}`),
  );
  return {
    documents: snapshot.documents.filter(
      (packet) => sealed.has(`${packet.packet_id}\0${packet.revision}`),
    ),
    verificationRecords: snapshot.verificationRecords.filter(
      (record) => eventIds.has(record.dispatch_event_id),
    ),
  };
}

test("timestamps retain exact nanosecond ordering and reject impossible dates", () => {
  assert.equal(
    parseTimestamp("2026-08-21T01:00:00.000000001Z")
      - parseTimestamp("2026-08-21T01:00:00.000000000Z"),
    1n,
  );
  assert.equal(
    parseTimestamp("2026-08-21T10:00:00.123456789+09:00"),
    parseTimestamp("2026-08-21T01:00:00.123456789Z"),
  );
  assert.throws(
    () => parseTimestamp("2026-02-29T01:00:00Z"),
    errorCode("timestamp_invalid"),
  );
  assert.throws(
    () => parseTimestamp("2026-08-21T01:00:00.1234567890Z"),
    errorCode("timestamp_invalid"),
  );
  assert.throws(
    () => parseTimestamp("2026-08-21t01:00:00z"),
    errorCode("timestamp_invalid"),
  );
});

test("semantic identifiers require NFC without changing the pinned JSON schema", async () => {
  const decomposed = "cafe\u0301";

  const bindingJournal = new InMemoryJournal();
  await assert.rejects(
    executeCommand(bindingJournal, openCommand(binding({
      projectId: `project_${decomposed}`,
    }))),
    errorCode("project_id_invalid"),
  );

  const eventJournal = new InMemoryJournal();
  const eventCommand = openCommand(binding({
    projectId: "project_core_nfc_event",
    sessionId: "session_core_nfc_event",
    episodeId: "episode_core_nfc_event",
    boundaryId: "boundary_core_nfc_event",
  }));
  eventCommand.event_id = `event_${decomposed}`;
  await assert.rejects(
    executeCommand(eventJournal, eventCommand),
    errorCode("event_id_invalid"),
  );

  const packetBoundary = binding({
    projectId: "project_core_nfc_packet",
    sessionId: "session_core_nfc_packet",
    episodeId: "episode_core_nfc_packet",
    boundaryId: "boundary_core_nfc_packet",
  });
  const packetJournal = new InMemoryJournal();
  await executeCommand(packetJournal, openCommand(packetBoundary));
  const state = await stateOf(packetJournal);
  const packet = packetFor(packetBoundary, state.eventSequence + 1);
  packet.choices[0].option_id = `option_${decomposed}`;
  await assert.rejects(
    executeCommand(packetJournal, sealCommand(packet)),
    errorCode("option_id_invalid"),
  );
});

test("tokens use at least 128 CSPRNG bits and support SHA-256 and HMAC verification", () => {
  assert.throws(() => generateTokenMaterial({ bytes: 15 }), errorCode("token_entropy_too_low"));
  assert.throws(() => generateTokenMaterial({ bytes: 769 }), errorCode("token_size_too_large"));
  assert.throws(() => generateTokenMaterial({ bytes: 1024 }), errorCode("token_size_too_large"));
  const maximum = generateTokenMaterial({ bytes: 768 });
  assert.equal(maximum.token.length, 1024);
  assert.equal(verifyTokenFingerprint(maximum.token, maximum.fingerprint), true);
  const sha = generateTokenMaterial({ bytes: 16 });
  assert.equal(sha.entropy_bits, 128);
  assert.match(sha.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(verifyTokenFingerprint(sha.token, sha.fingerprint), true);
  assert.equal(verifyTokenFingerprint(`${sha.token}x`, sha.fingerprint), false);

  const hmacKey = Buffer.from("fictional-local-key");
  const hmac = generateTokenMaterial({ bytes: 32, hmacKey });
  assert.match(hmac.fingerprint, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.equal(verifyTokenFingerprint(hmac.token, hmac.fingerprint, { hmacKey }), true);
  assert.equal(verifyTokenFingerprint(hmac.token, hmac.fingerprint, { hmacKey: "wrong" }), false);
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("short", "a-different-length"), false);
  assert.equal(fingerprintToken("fixture"), fingerprintToken("fixture"));
});

test("HMAC token material passes dispatch and requires the same key at consumption", async () => {
  const { journal, packet } = await setupWaiting();
  const hmacKey = Buffer.from("fictional-coordinator-hmac-key");
  const tokenMaterial = generateTokenMaterial({ hmacKey });
  const selected = await executeCommand(
    journal,
    selectCommand(packet, 1, { tokenMaterial }),
  );
  const envelope = selected.effects[0].envelope;
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_hmac_wrong_key"),
      occurred_at: "2026-08-21T01:00:04Z",
      envelope,
      hmac_key: "wrong-key",
    }),
    errorCode("continuation_token_invalid"),
  );
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_hmac_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope,
    hmac_key: hmacKey,
  });
  assert.match(
    (await journal.load()).verificationRecords[0].correlation_token_fingerprint,
    /^hmac-sha256:/,
  );
});

test("generated packet, selection, events, and pet envelope satisfy v1 contracts", async () => {
  const { journal, packet } = await setupWaiting();
  const command = selectCommand(packet, 1);
  await assertV1("selection_request", command.request);
  const execution = await executeCommand(journal, command);
  assert.equal(execution.effects.length, 1);
  await assertV1("continuation_envelope", execution.effects[0].envelope);
  const snapshot = await journal.load();
  await assertSnapshotEventsAreV1(snapshot);
  const persisted = JSON.stringify(snapshot);
  assert.equal(persisted.includes(execution.effects[0].envelope.continuation_token), false);
  assert.equal(persisted.includes("continuation_token"), false);
  assert.equal(Object.hasOwn(snapshot.verificationRecords[0], "action"), false);
});

test("command-generated identifiers and stable codes obey v1 scalar bounds", async () => {
  const overlongIdentifier = "x".repeat(513);
  const decisionBoundary = binding({ boundaryId: "boundary_core_scalar_bounds" });
  const initial = replay([]);
  const unicodeBoundary = binding({
    projectId: "🦊".repeat(300),
    sessionId: "session_core_unicode_bounds",
    episodeId: "episode_core_unicode_bounds",
    boundaryId: "boundary_core_unicode_bounds",
  });
  const unicodeOpen = decide(initial, openCommand(unicodeBoundary)).events[0];
  await assertV1("runtime_event", unicodeOpen);
  assert.throws(
    () => decide(initial, openCommand({
      ...unicodeBoundary,
      project_id: "🦊".repeat(513),
    })),
    errorCode("project_id_invalid"),
  );
  const invalidOpenCommands = [
    {
      command: { ...openCommand(decisionBoundary), event_id: overlongIdentifier },
      code: "event_id_invalid",
    },
    {
      command: openCommand({ ...decisionBoundary, project_id: overlongIdentifier }),
      code: "project_id_invalid",
    },
    {
      command: { ...openCommand(decisionBoundary), proposal_id: overlongIdentifier },
      code: "proposal_id_invalid",
    },
  ];
  for (const fixtureCase of invalidOpenCommands) {
    assert.throws(
      () => decide(initial, fixtureCase.command),
      errorCode(fixtureCase.code),
    );
    await assert.rejects(
      executeCommand(new InMemoryJournal(), fixtureCase.command),
      errorCode(fixtureCase.code),
    );
  }
  const validOpen = decide(initial, openCommand(decisionBoundary)).events[0];
  const invalidReplayOpen = structuredClone(validOpen);
  invalidReplayOpen.event_id = overlongIdentifier;
  assert.throws(
    () => replay([invalidReplayOpen]),
    errorCode("event_id_invalid"),
  );

  const packetJournal = new InMemoryJournal();
  await executeCommand(packetJournal, openCommand(decisionBoundary));
  const packetState = await stateOf(packetJournal);
  const invalidPacket = packetFor(decisionBoundary, packetState.eventSequence + 1);
  invalidPacket.packet_id = overlongIdentifier;
  assert.throws(
    () => decide(packetState, sealCommand(invalidPacket)),
    errorCode("packet_id_invalid"),
  );
  await assert.rejects(
    executeCommand(packetJournal, sealCommand(invalidPacket)),
    errorCode("packet_id_invalid"),
  );

  const waiting = await setupWaiting({
    boundary: binding({
      projectId: "project_core_scalar_selection",
      sessionId: "session_core_scalar_selection",
      episodeId: "episode_core_scalar_selection",
      boundaryId: "boundary_core_scalar_selection",
    }),
  });
  const waitingState = await stateOf(waiting.journal);
  const invalidSelection = selectCommand(waiting.packet, 1, {
    request: selectionFor(waiting.packet, 1, { selection_id: overlongIdentifier }),
    tokenMaterial: generateTokenMaterial(),
  });
  assert.throws(
    () => decide(waitingState, invalidSelection),
    errorCode("selection_id_invalid"),
  );
  await assert.rejects(
    executeCommand(waiting.journal, invalidSelection),
    errorCode("selection_id_invalid"),
  );
  const invalidContinuation = selectCommand(waiting.packet, 1, {
    tokenMaterial: generateTokenMaterial(),
  });
  invalidContinuation.continuation_id = overlongIdentifier;
  assert.throws(
    () => decide(waitingState, invalidContinuation),
    errorCode("continuation_id_invalid"),
  );
  await assert.rejects(
    executeCommand(waiting.journal, invalidContinuation),
    errorCode("continuation_id_invalid"),
  );

  const repairBoundary = binding({
    projectId: "project_core_scalar_repair",
    sessionId: "session_core_scalar_repair",
    episodeId: "episode_core_scalar_repair",
    boundaryId: "boundary_core_scalar_repair",
  });
  const repairJournal = new InMemoryJournal();
  await executeCommand(repairJournal, openCommand(repairBoundary));
  const repairState = await stateOf(repairJournal);
  const invalidRepair = {
    type: "reserve_format_repair",
    event_id: id("event_scalar_repair"),
    occurred_at: "2026-08-21T01:00:01Z",
    binding: repairBoundary,
    continuation_id: id("continuation_scalar_repair"),
    repair_request_id: overlongIdentifier,
    parent_prompt_id: repairBoundary.source_prompt_id,
    token_material: generateTokenMaterial(),
    issued_at: "2026-08-21T01:00:01Z",
    expires_at: "2026-08-21T01:02:01Z",
  };
  assert.throws(
    () => decide(repairState, invalidRepair),
    errorCode("repair_request_id_invalid"),
  );
  await assert.rejects(
    executeCommand(repairJournal, invalidRepair),
    errorCode("repair_request_id_invalid"),
  );

  const closeJournal = new InMemoryJournal();
  const closeBoundary = binding({
    projectId: "project_core_scalar_close",
    sessionId: "session_core_scalar_close",
    episodeId: "episode_core_scalar_close",
    boundaryId: "boundary_core_scalar_close",
  });
  await executeCommand(closeJournal, openCommand(closeBoundary));
  const closeSnapshot = await closeJournal.load();
  const closeState = await stateOf(closeJournal);
  const invalidClose = {
    type: "close_boundary",
    event_id: id("event_scalar_close"),
    occurred_at: "2026-08-21T01:00:01Z",
    binding: closeBoundary,
    close_reason: "Invalid Reason",
  };
  assert.throws(
    () => decide(closeState, invalidClose),
    errorCode("close_reason_invalid"),
  );
  await assert.rejects(
    executeCommand(closeJournal, invalidClose),
    errorCode("close_reason_invalid"),
  );
  const validClose = decide(closeState, {
    ...invalidClose,
    event_id: id("event_scalar_close_projection"),
    close_reason: "checkpoint_complete",
  }).events[0];
  const invalidCloseReplay = structuredClone(validClose);
  invalidCloseReplay.payload.close_reason = "Invalid Reason";
  assert.throws(
    () => replay([...closeSnapshot.events, invalidCloseReplay]),
    errorCode("close_reason_invalid"),
  );
});

test("same Codex turn can complete boundary sequence 1 then open and dispatch sequence 2", async () => {
  const firstBoundary = binding();
  const { journal, packet: firstPacket } = await setupWaiting({ boundary: firstBoundary });
  const firstSelection = selectCommand(firstPacket, 1);
  const selected = await executeCommand(journal, firstSelection);
  const firstEnvelope = selected.effects[0].envelope;
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope: firstEnvelope,
  });
  await executeCommand(journal, {
    type: "complete_transport",
    event_id: id("event_transport"),
    occurred_at: "2026-08-21T01:00:05Z",
    binding: firstBoundary,
    continuation_id: firstEnvelope.continuation_id,
  });
  await executeCommand(journal, {
    type: "record_work_outcome",
    event_id: id("event_outcome"),
    occurred_at: "2026-08-21T01:00:06Z",
    binding: firstBoundary,
    continuation_id: firstEnvelope.continuation_id,
    status: "succeeded",
    summary: "The first fictional action completed.",
    evidence_ids: ["evidence_core_001"],
  });
  await executeCommand(journal, {
    type: "close_boundary",
    event_id: id("event_close"),
    occurred_at: "2026-08-21T01:00:07Z",
    binding: firstBoundary,
    close_reason: "work_outcome_recorded",
  });

  const secondBoundary = binding({
    boundaryId: "boundary_core_002",
    boundarySequence: 2,
  });
  await executeCommand(journal, openCommand(secondBoundary, "2026-08-21T01:00:08Z"));
  let state = await stateOf(journal);
  const secondPacket = packetFor(secondBoundary, state.eventSequence + 1, {
    sealedAt: "2026-08-21T01:00:09Z",
    expiresAt: "2026-08-21T01:02:09Z",
  });
  await executeCommand(journal, sealCommand(secondPacket));
  await executeCommand(journal, selectCommand(secondPacket, 2, {
    occurredAt: "2026-08-21T01:00:10Z",
    issuedAt: "2026-08-21T01:00:10Z",
    expiresAt: "2026-08-21T01:02:10Z",
    deadlineAt: "2026-08-21T01:05:10Z",
  }));

  const snapshot = await journal.load();
  const restarted = new InMemoryJournal(snapshot);
  state = await stateOf(restarted);
  const opened = snapshot.events.filter((event) => event.event_type === "decision_boundary_opened");
  assert.deepEqual(opened.map((event) => event.boundary_sequence), [1, 2]);
  assert.equal(state.eventSequence, snapshot.events.at(-1).event_sequence);
  assert.equal(Object.keys(state.continuations).length, 2);
});

test("same-turn boundary sequence rejects prompt and checkpoint lineage changes", async () => {
  const firstBoundary = binding({ boundaryId: "boundary_core_lineage_001" });
  const journal = new InMemoryJournal();
  await executeCommand(journal, openCommand(firstBoundary));
  await executeCommand(journal, {
    type: "close_boundary",
    event_id: id("event_lineage_close"),
    occurred_at: "2026-08-21T01:00:01Z",
    binding: firstBoundary,
    close_reason: "checkpoint_complete",
  });
  const snapshot = await journal.load();
  const state = await stateOf(journal);
  const secondBoundary = binding({
    boundaryId: "boundary_core_lineage_002",
    boundarySequence: 2,
  });
  const validSecondEvent = decide(
    state,
    openCommand(secondBoundary, "2026-08-21T01:00:02Z"),
  ).events[0];

  for (const [field, value] of [
    ["source_prompt_id", "prompt_core_changed"],
    ["episode_id", "episode_core_changed"],
    ["episode_root_prompt_id", "prompt_root_changed"],
    ["episode_baseline_checkpoint_id", "checkpoint_core_changed"],
  ]) {
    const changedBinding = { ...secondBoundary, [field]: value };
    const restarted = new InMemoryJournal(snapshot);
    await assert.rejects(
      executeCommand(restarted, openCommand(changedBinding, "2026-08-21T01:00:02Z")),
      errorCode("decision_boundary_lineage_mismatch"),
      `${field} command must fail closed`,
    );

    const changedEvent = structuredClone(validSecondEvent);
    changedEvent[field] = value;
    assert.throws(
      () => replay([...snapshot.events, changedEvent]),
      errorCode("decision_boundary_lineage_mismatch"),
      `${field} replay must fail closed`,
    );
  }

  const resetEpisodeBoundary = binding({
    episodeId: "episode_core_reset",
    rootPromptId: "prompt_core_reset",
    checkpointId: "checkpoint_core_reset",
    boundaryId: "boundary_core_lineage_reset",
    boundarySequence: 1,
  });
  const restarted = new InMemoryJournal(snapshot);
  await assert.rejects(
    executeCommand(
      restarted,
      openCommand(resetEpisodeBoundary, "2026-08-21T01:00:02Z"),
    ),
    errorCode("decision_boundary_lineage_mismatch"),
    "same source turn cannot reset episode lineage and boundary sequence",
  );
  const resetEpisodeEvent = structuredClone(validSecondEvent);
  Object.assign(resetEpisodeEvent, resetEpisodeBoundary);
  assert.throws(
    () => replay([...snapshot.events, resetEpisodeEvent]),
    errorCode("decision_boundary_lineage_mismatch"),
    "replay cannot reset episode lineage and boundary sequence within one source turn",
  );
});

test("episode_paused close reason requires a claimed slot 3 selection", async () => {
  const decisionBoundary = binding({ boundaryId: "boundary_core_unselected_pause" });
  const journal = new InMemoryJournal();
  await executeCommand(journal, openCommand(decisionBoundary));
  const snapshot = await journal.load();
  const state = await stateOf(journal);
  const invalidPauseClose = {
    type: "close_boundary",
    event_id: id("event_unselected_pause_close"),
    occurred_at: "2026-08-21T01:00:01Z",
    binding: decisionBoundary,
    close_reason: "episode_paused",
  };
  assert.throws(
    () => decide(state, invalidPauseClose),
    errorCode("episode_pause_selection_missing"),
  );
  await assert.rejects(
    executeCommand(journal, invalidPauseClose),
    errorCode("episode_pause_selection_missing"),
  );
  const validClose = decide(state, {
    ...invalidPauseClose,
    event_id: id("event_unselected_close_projection"),
    close_reason: "checkpoint_complete",
  }).events[0];
  const invalidReplayClose = structuredClone(validClose);
  invalidReplayClose.payload.close_reason = "episode_paused";
  assert.throws(
    () => replay([...snapshot.events, invalidReplayClose]),
    errorCode("episode_pause_selection_missing"),
  );
});

test("identifier-keyed projection records safely handle prototype property names", async () => {
  const decisionBoundary = binding({ boundaryId: "boundary_core_proto_event" });
  const initial = replay([]);
  const opened = decide(initial, {
    ...openCommand(decisionBoundary),
    event_id: "__proto__",
  }).events[0];
  const openedState = replay([opened]);
  assert.equal(Object.getPrototypeOf(openedState.eventIds), null);
  assert.equal(Object.hasOwn(openedState.eventIds, "__proto__"), true);
  const duplicateCommand = {
    type: "close_boundary",
    event_id: "__proto__",
    occurred_at: "2026-08-21T01:00:01Z",
    binding: decisionBoundary,
    close_reason: "duplicate_event_probe",
  };
  assert.throws(
    () => decide(openedState, duplicateCommand),
    errorCode("runtime_event_id_duplicate"),
  );
  const duplicateJournal = new InMemoryJournal({ events: [opened] });
  await assert.rejects(
    executeCommand(duplicateJournal, duplicateCommand),
    errorCode("runtime_event_id_duplicate"),
  );
  const duplicate = structuredClone(decide(openedState, {
    ...duplicateCommand,
    event_id: id("event_proto_close_projection"),
  }).events[0]);
  duplicate.event_id = "__proto__";
  assert.throws(
    () => replay([opened, duplicate]),
    errorCode("runtime_event_id_duplicate"),
  );

  for (const [index, specialId] of ["__proto__", "constructor", "toString"].entries()) {
    const boundary = binding({
      projectId: `project_core_proto_${index}`,
      sessionId: `session_core_proto_${index}`,
      episodeId: `episode_core_proto_${index}`,
      boundaryId: `boundary_core_proto_${index}`,
    });
    const journal = new InMemoryJournal();
    await executeCommand(journal, openCommand(boundary));
    let state = await stateOf(journal);
    const packet = packetFor(boundary, state.eventSequence + 1, {
      identity: {
        interaction_id: `interaction_core_proto_${index}`,
        packet_id: specialId,
      },
    });
    await executeCommand(journal, sealCommand(packet));
    const command = selectCommand(packet, 1);
    command.continuation_id = specialId;
    const selected = await executeCommand(journal, command);
    state = await stateOf(journal);

    for (const field of [
      "eventIds",
      "boundaries",
      "boundaryIdentities",
      "latestBoundaryByTurn",
      "packetDocuments",
      "sealedPacketDocuments",
      "verificationRecords",
      "usedVerificationRecords",
      "tokenFingerprints",
      "continuationIdentities",
      "continuations",
    ]) {
      assert.equal(Object.getPrototypeOf(state[field]), null, `${field} must be a safe record`);
    }
    assert.equal(Object.hasOwn(state.continuations, specialId), true);
    assert.equal(Object.hasOwn(state.verificationRecords, specialId), true);
    assert.equal(continuationFor(state, specialId)?.continuationId, specialId);
    assert.equal(packetForBoundary(state, boundary)?.packet_id, specialId);
    await executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_proto_consume"),
      occurred_at: "2026-08-21T01:00:04Z",
      envelope: selected.effects[0].envelope,
    });
  }
});

test("every valid journal prefix replays without requiring a terminal trace", async () => {
  const { journal, packet } = await setupWaiting();
  const selected = await executeCommand(journal, selectCommand(packet, 1));
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope: selected.effects[0].envelope,
  });
  await executeCommand(journal, {
    type: "complete_transport",
    event_id: id("event_transport"),
    occurred_at: "2026-08-21T01:00:05Z",
    binding: binding(),
    continuation_id: selected.effects[0].envelope.continuation_id,
  });
  const snapshot = await journal.load();
  for (let length = 1; length <= snapshot.events.length; length += 1) {
    const prefix = snapshot.events.slice(0, length);
    assert.doesNotThrow(() => replay(prefix, artifactsForPrefix(snapshot, prefix)));
  }
});

test("latest packet revision and exact option are required", async () => {
  const { journal, packet: revisionOne, boundary: decisionBoundary } = await setupWaiting();
  let state = await stateOf(journal);
  const snapshotBeforeReseal = await journal.load();
  const revisionTwo = packetFor(decisionBoundary, state.eventSequence + 1, {
    revision: 2,
    identity: revisionOne,
    sealedAt: "2026-08-21T01:00:02Z",
    expiresAt: "2026-08-21T01:02:02Z",
  });
  const expiredReseal = packetFor(decisionBoundary, state.eventSequence + 1, {
    revision: 2,
    identity: revisionOne,
    sealedAt: revisionOne.expires_at,
    expiresAt: "2026-08-21T01:02:02Z",
  });
  assert.throws(
    () => decide(state, sealCommand(expiredReseal)),
    errorCode("decision_packet_reseal_after_expiry"),
  );
  await assert.rejects(
    executeCommand(journal, sealCommand(expiredReseal)),
    errorCode("decision_packet_reseal_after_expiry"),
  );
  const validResealProjection = decide(state, sealCommand(revisionTwo));
  const expiredResealEvent = structuredClone(validResealProjection.events[0]);
  expiredResealEvent.occurred_at = expiredReseal.sealed_at;
  assert.throws(
    () => replay([...snapshotBeforeReseal.events, expiredResealEvent], {
      documents: [...snapshotBeforeReseal.documents, expiredReseal],
      verificationRecords: snapshotBeforeReseal.verificationRecords,
    }),
    errorCode("decision_packet_reseal_after_expiry"),
  );
  await executeCommand(journal, sealCommand(revisionTwo));
  await assert.rejects(
    executeCommand(journal, selectCommand(revisionOne, 1)),
    errorCode("decision_packet_revision_stale"),
  );
  const wrongOption = selectionFor(revisionTwo, 1, {
    option_id: revisionOne.choices[0].option_id,
  });
  await assert.rejects(
    executeCommand(journal, selectCommand(revisionTwo, 1, { request: wrongOption })),
    errorCode("decision_option_not_found"),
  );
  await executeCommand(journal, selectCommand(revisionTwo, 1));
  state = await stateOf(journal);
  assert.equal(Object.values(state.boundaries)[0].packet.revision, 2);
});

test("cross-session, disabled, stale, and duplicate selections fail closed", async () => {
  const { journal, packet, boundary: firstBoundary } = await setupWaiting();
  const crossSession = selectionFor(packet, 1, { session_id: "session_other" });
  await assert.rejects(
    executeCommand(journal, selectCommand(packet, 1, { request: crossSession })),
    errorCode("decision_boundary_binding_mismatch"),
  );
  await assert.rejects(
    executeCommand(journal, selectCommand(packet, 4)),
    errorCode("decision_option_disabled"),
  );

  const alternativeBoundary = binding({
    projectId: "project_core_disabled_alt",
    sessionId: "session_core_disabled_alt",
    episodeId: "episode_core_disabled_alt",
    boundaryId: "boundary_core_disabled_alt",
  });
  const alternativeJournal = new InMemoryJournal();
  await executeCommand(alternativeJournal, openCommand(alternativeBoundary));
  const alternativeState = await stateOf(alternativeJournal);
  const alternativePacket = packetFor(alternativeBoundary, alternativeState.eventSequence + 1);
  alternativePacket.choices[1].enabled = false;
  alternativePacket.choices[1].disabled_reason = "no_safe_meaningful_alternative";
  alternativePacket.choices[1].action_id = null;
  delete alternativePacket.choices[1].action;
  await executeCommand(alternativeJournal, sealCommand(alternativePacket));
  await assert.rejects(
    executeCommand(alternativeJournal, selectCommand(alternativePacket, 2)),
    errorCode("decision_option_disabled"),
  );

  const command = selectCommand(packet, 1);
  const selected = await executeCommand(journal, command);
  await assert.rejects(
    executeCommand(journal, selectCommand(packet, 1)),
    errorCode("selection_already_claimed"),
  );
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_consume_before_close"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope: selected.effects[0].envelope,
  });
  await executeCommand(journal, {
    type: "complete_transport",
    event_id: id("event_transport_before_close"),
    occurred_at: "2026-08-21T01:00:05Z",
    binding: firstBoundary,
    continuation_id: command.continuation_id,
  });
  await executeCommand(journal, {
    type: "close_boundary",
    event_id: id("event_close"),
    occurred_at: "2026-08-21T01:00:06Z",
    binding: firstBoundary,
    close_reason: "selection_claimed",
  });
  const secondBoundary = binding({ boundaryId: "boundary_core_stale_002", boundarySequence: 2 });
  await executeCommand(journal, openCommand(secondBoundary, "2026-08-21T01:00:07Z"));
  await assert.rejects(
    executeCommand(journal, selectCommand(packet, 1)),
    errorCode("stale_decision_boundary"),
  );
});

test("concurrent selections commit exactly once and expose only the winner effect", async () => {
  const { journal, packet } = await setupWaiting();
  const attempts = await Promise.allSettled([
    executeCommand(journal, selectCommand(packet, 1)),
    executeCommand(journal, selectCommand(packet, 2)),
  ]);
  const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.effects.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "selection_already_claimed");
  assert.equal(Object.hasOwn(rejected[0], "effects"), false);
  const snapshot = await journal.load();
  assert.equal(snapshot.events.filter((event) => event.event_type === "decision_selection_claimed").length, 1);
  assert.equal(snapshot.events.filter((event) => event.event_type === "continuation_dispatched").length, 1);
  assert.equal(snapshot.verificationRecords.length, 1);
});

test("multi-event action and pause commands reject duplicate event identifiers", async () => {
  const action = await setupWaiting({
    boundary: binding({
      projectId: "project_core_duplicate_action_events",
      sessionId: "session_core_duplicate_action_events",
      episodeId: "episode_core_duplicate_action_events",
      boundaryId: "boundary_core_duplicate_action_events",
    }),
  });
  const actionCommand = selectCommand(action.packet, 1, {
    tokenMaterial: generateTokenMaterial(),
  });
  actionCommand.event_ids.continuation_dispatched =
    actionCommand.event_ids.selection_claimed;
  const actionState = await stateOf(action.journal);
  assert.throws(
    () => decide(actionState, actionCommand),
    errorCode("runtime_event_id_duplicate"),
  );
  await assert.rejects(
    executeCommand(action.journal, actionCommand),
    errorCode("runtime_event_id_duplicate"),
  );

  const pause = await setupWaiting({
    boundary: binding({
      projectId: "project_core_duplicate_pause_events",
      sessionId: "session_core_duplicate_pause_events",
      episodeId: "episode_core_duplicate_pause_events",
      boundaryId: "boundary_core_duplicate_pause_events",
    }),
  });
  const pauseCommand = selectCommand(pause.packet, 3);
  pauseCommand.event_ids.decision_boundary_closed =
    pauseCommand.event_ids.selection_claimed;
  const pauseState = await stateOf(pause.journal);
  assert.throws(
    () => decide(pauseState, pauseCommand),
    errorCode("runtime_event_id_duplicate"),
  );
  await assert.rejects(
    executeCommand(pause.journal, pauseCommand),
    errorCode("runtime_event_id_duplicate"),
  );
});

test("a dispatched boundary cannot close before transport reaches a terminal observation", async () => {
  const { journal, packet, boundary: decisionBoundary } = await setupWaiting();
  const command = selectCommand(packet, 1);
  await executeCommand(journal, command);
  const snapshot = await journal.load();
  const actionSelectionPrefix = {
    events: snapshot.events.slice(0, -1),
    documents: snapshot.documents,
    verificationRecords: [],
  };
  assert.equal(
    actionSelectionPrefix.events.at(-1).event_type,
    "decision_selection_claimed",
  );
  assert.doesNotThrow(() => replay(actionSelectionPrefix.events, {
    documents: actionSelectionPrefix.documents,
    verificationRecords: actionSelectionPrefix.verificationRecords,
  }));
  const prefixJournal = new InMemoryJournal(actionSelectionPrefix);
  await assert.rejects(
    executeCommand(prefixJournal, {
      type: "close_boundary",
      event_id: id("event_undispatched_selection_close"),
      occurred_at: "2026-08-21T01:00:04Z",
      binding: decisionBoundary,
      close_reason: "selection_claimed",
    }),
    errorCode("transport_terminal_observation_missing"),
  );
  await assert.rejects(
    executeCommand(journal, {
      type: "close_boundary",
      event_id: id("event_premature_close"),
      occurred_at: "2026-08-21T01:00:04Z",
      binding: decisionBoundary,
      close_reason: "dispatch_recorded",
    }),
    errorCode("transport_terminal_observation_missing"),
  );

  const state = await stateOf(journal);
  const timeoutChange = decide(state, {
    type: "timeout_transport_unknown",
    event_id: id("event_close_gate_timeout_projection"),
    occurred_at: command.in_flight_deadline_at,
    binding: decisionBoundary,
    continuation_id: command.continuation_id,
  });
  const terminalState = replay([...snapshot.events, ...timeoutChange.events], {
    documents: snapshot.documents,
    verificationRecords: snapshot.verificationRecords,
  });
  const lateOutcomeCommand = {
    type: "record_work_outcome",
    event_id: id("event_outcome_after_close"),
    occurred_at: "2026-08-21T01:05:05Z",
    binding: decisionBoundary,
    continuation_id: command.continuation_id,
    status: "unknown",
    summary: "The fictional outcome remained unknown after timeout.",
    evidence_ids: [],
  };
  const validOutcomeBeforeClose = decide(terminalState, lateOutcomeCommand).events[0];
  const validClose = decide(terminalState, {
    type: "close_boundary",
    event_id: id("event_close_gate_projection"),
    occurred_at: "2026-08-21T01:05:04Z",
    binding: decisionBoundary,
    close_reason: "transport_terminal",
  }).events[0];
  assert.throws(
    () => decide(terminalState, {
      type: "close_boundary",
      event_id: id("event_action_episode_pause_projection"),
      occurred_at: "2026-08-21T01:05:04Z",
      binding: decisionBoundary,
      close_reason: "episode_paused",
    }),
    errorCode("episode_pause_selection_missing"),
  );
  const actionEpisodePauseClose = structuredClone(validClose);
  actionEpisodePauseClose.payload.close_reason = "episode_paused";
  assert.throws(
    () => replay([
      ...snapshot.events,
      ...timeoutChange.events,
      actionEpisodePauseClose,
    ], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("episode_pause_selection_missing"),
  );
  const prematureClose = structuredClone(validClose);
  prematureClose.event_sequence = state.eventSequence + 1;
  prematureClose.occurred_at = "2026-08-21T01:00:04Z";
  assert.throws(
    () => replay([...snapshot.events, prematureClose], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("transport_terminal_observation_missing"),
  );
  const undispatchedSelectionClose = structuredClone(validClose);
  undispatchedSelectionClose.event_sequence =
    actionSelectionPrefix.events.at(-1).event_sequence + 1;
  undispatchedSelectionClose.occurred_at = "2026-08-21T01:00:04Z";
  assert.throws(
    () => replay([...actionSelectionPrefix.events, undispatchedSelectionClose], {
      documents: actionSelectionPrefix.documents,
      verificationRecords: actionSelectionPrefix.verificationRecords,
    }),
    errorCode("transport_terminal_observation_missing"),
  );

  await executeCommand(journal, {
    type: "timeout_transport_unknown",
    event_id: id("event_close_gate_timeout"),
    occurred_at: command.in_flight_deadline_at,
    binding: decisionBoundary,
    continuation_id: command.continuation_id,
  });
  await assert.rejects(
    executeCommand(journal, {
      type: "close_boundary",
      event_id: id("event_action_episode_pause"),
      occurred_at: "2026-08-21T01:05:04Z",
      binding: decisionBoundary,
      close_reason: "episode_paused",
    }),
    errorCode("episode_pause_selection_missing"),
  );
  await executeCommand(journal, {
    type: "close_boundary",
    event_id: id("event_close_gate_terminal"),
    occurred_at: "2026-08-21T01:05:04Z",
    binding: decisionBoundary,
    close_reason: "transport_terminal",
  });
  const closedState = await stateOf(journal);
  assert.equal(closedState.continuations[command.continuation_id].workOutcome, null);
  assert.throws(
    () => decide(closedState, lateOutcomeCommand),
    errorCode("decision_boundary_closed"),
  );
  await assert.rejects(
    executeCommand(journal, lateOutcomeCommand),
    errorCode("decision_boundary_closed"),
  );
  const closedSnapshot = await journal.load();
  const lateOutcomeReplay = structuredClone(validOutcomeBeforeClose);
  lateOutcomeReplay.event_sequence = closedSnapshot.events.at(-1).event_sequence + 1;
  assert.throws(
    () => replay([...closedSnapshot.events, lateOutcomeReplay], {
      documents: closedSnapshot.documents,
      verificationRecords: closedSnapshot.verificationRecords,
    }),
    errorCode("decision_boundary_closed"),
  );
  await executeCommand(journal, openCommand(binding({
    boundaryId: "boundary_core_after_terminal_002",
    boundarySequence: 2,
  }), "2026-08-21T01:05:05Z"));
});

test("packet sidecar missing, mismatch, and orphan states fail with stable errors", async () => {
  const { journal, packet } = await setupWaiting();
  const snapshot = await journal.load();
  assert.throws(
    () => replay(snapshot.events, { documents: [] }),
    errorCode("packet_document_missing"),
  );
  const mismatch = structuredClone(packet);
  mismatch.source_prompt_id = "prompt_mismatch";
  assert.throws(
    () => replay(snapshot.events, { documents: [mismatch] }),
    errorCode("packet_document_binding_mismatch"),
  );
  const expiryMismatch = structuredClone(packet);
  expiryMismatch.expires_at = "2026-08-21T01:02:02Z";
  assert.throws(
    () => replay(snapshot.events, { documents: [expiryMismatch] }),
    errorCode("packet_document_expiry_mismatch"),
  );
  assert.throws(
    () => replay([], { documents: [packet] }),
    errorCode("packet_document_orphaned"),
  );
});

test("schema-valid packet semantic attacks fail closed in command and replay paths", async () => {
  const cases = [
    {
      name: "duplicate option_id",
      code: "packet_option_id_duplicate",
      mutate(packet) {
        packet.choices[1].option_id = packet.choices[0].option_id;
      },
    },
    {
      name: "duplicate non-null action_id",
      code: "decision_packet_action_id_not_unique",
      mutate(packet) {
        packet.choices[1].action_id = packet.choices[0].action_id;
      },
    },
    {
      name: "checkpoint outside episode baseline",
      code: "decision_packet_checkpoint_mismatch",
      mutate(packet) {
        packet.checkpoint.id = "checkpoint_core_cross_episode";
      },
    },
    {
      name: "rollback target outside episode baseline",
      code: "rollback_target_checkpoint_mismatch",
      mutate(packet) {
        const rollback = packet.choices[3];
        rollback.enabled = true;
        rollback.disabled_reason = null;
        rollback.action_id = "action_core_rollback";
        rollback.target_checkpoint_id = "checkpoint_core_cross_episode";
      },
    },
    {
      name: "enabled rollback even at the episode baseline",
      code: "rollback_not_supported_in_core",
      mutate(packet) {
        const rollback = packet.choices[3];
        rollback.enabled = true;
        rollback.disabled_reason = null;
        rollback.action_id = "action_core_rollback";
        rollback.target_checkpoint_id = packet.episode_baseline_checkpoint_id;
      },
    },
  ];

  for (const [index, fixtureCase] of cases.entries()) {
    const boundary = binding({
      projectId: `project_core_packet_semantic_${index}`,
      sessionId: `session_core_packet_semantic_${index}`,
      episodeId: `episode_core_packet_semantic_${index}`,
      boundaryId: `boundary_core_packet_semantic_${index}`,
    });
    const journal = new InMemoryJournal();
    await executeCommand(journal, openCommand(boundary));
    const state = await stateOf(journal);
    const packet = packetFor(boundary, state.eventSequence + 1);
    fixtureCase.mutate(packet);
    await assertV1("decision_packet", packet);
    await assert.rejects(
      executeCommand(journal, sealCommand(packet)),
      errorCode(fixtureCase.code),
      `${fixtureCase.name} command must fail closed`,
    );
    assert.throws(
      () => replay([], { documents: [packet] }),
      errorCode(fixtureCase.code),
      `${fixtureCase.name} replay must fail closed`,
    );
    assert.equal((await journal.load()).events.length, 1);
  }
});

test("packet action arrays fail closed at the semantic boundary", async () => {
  const decisionBoundary = binding({
    projectId: "project_core_array_action",
    sessionId: "session_core_array_action",
    episodeId: "episode_core_array_action",
    boundaryId: "boundary_core_array_action",
  });
  const journal = new InMemoryJournal();
  await executeCommand(journal, openCommand(decisionBoundary));
  const state = await stateOf(journal);
  const packet = packetFor(decisionBoundary, state.eventSequence + 1);
  packet.choices[0].action = [];
  await assert.rejects(
    executeCommand(journal, sealCommand(packet)),
    errorCode("packet_action_missing"),
  );
  assert.throws(
    () => replay([], { documents: [packet] }),
    errorCode("packet_action_missing"),
  );
});

test("interaction expiry rejects invalid reasons and defaults only an undefined reason", async () => {
  const { journal, packet, boundary: decisionBoundary } = await setupWaiting();
  const snapshot = await journal.load();
  const state = await stateOf(journal);
  const invalidCommand = {
    type: "expire_interaction",
    event_id: id("event_expire_invalid_reason"),
    occurred_at: packet.expires_at,
    binding: decisionBoundary,
    reason: "",
  };
  assert.throws(
    () => decide(state, invalidCommand),
    errorCode("interaction_expiry_reason_invalid"),
  );
  await assert.rejects(
    executeCommand(journal, invalidCommand),
    errorCode("interaction_expiry_reason_invalid"),
  );
  assert.throws(
    () => decide(state, { ...invalidCommand, reason: null }),
    errorCode("interaction_expiry_reason_invalid"),
  );

  const validProjection = decide(state, {
    ...invalidCommand,
    event_id: id("event_expire_projection"),
    reason: undefined,
  });
  assert.equal(validProjection.events[0].payload.reason, "selection_timeout");
  const invalidReasonEvent = structuredClone(validProjection.events[0]);
  invalidReasonEvent.payload.reason = "";
  assert.throws(
    () => replay([...snapshot.events, invalidReasonEvent], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("interaction_expiry_reason_invalid"),
  );

  await executeCommand(journal, {
    type: "expire_interaction",
    event_id: id("event_expire_default_reason"),
    occurred_at: packet.expires_at,
    binding: decisionBoundary,
  });
  const expiredEvent = (await journal.load()).events.at(-1);
  assert.equal(expiredEvent.payload.reason, "selection_timeout");
  await assertV1("runtime_event", expiredEvent);
});

test("continuation verification missing, mismatch, and orphan states fail closed", async () => {
  const { journal, packet } = await setupWaiting();
  await executeCommand(journal, selectCommand(packet, 1));
  const snapshot = await journal.load();
  assert.throws(
    () => replay(snapshot.events, { documents: snapshot.documents, verificationRecords: [] }),
    errorCode("continuation_verification_missing"),
  );
  const mismatch = structuredClone(snapshot.verificationRecords[0]);
  mismatch.session_id = "session_mismatch";
  assert.throws(
    () => replay(snapshot.events, { documents: snapshot.documents, verificationRecords: [mismatch] }),
    errorCode("verification_record_binding_mismatch"),
  );
  const selectionPrefix = snapshot.events.slice(0, -1);
  assert.throws(
    () => replay(selectionPrefix, {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("verification_record_orphaned"),
  );
});

test("journal append is atomic for packet seals, action selection+dispatch, and CAS conflicts", async () => {
  const decisionBoundary = binding();
  const journal = new InMemoryJournal();
  await executeCommand(journal, openCommand(decisionBoundary));
  let state = await stateOf(journal);
  const packet = packetFor(decisionBoundary, state.eventSequence + 1);
  const seal = decide(state, sealCommand(packet));
  await assert.rejects(
    journal.append(state.eventSequence, seal.events),
    errorCode("packet_document_seal_atomic_batch_required"),
  );
  assert.equal((await journal.load()).events.length, 1);
  await journal.append(state.eventSequence, seal.events, { documents: seal.documents });

  state = await stateOf(journal);
  const selection = decide(state, selectCommand(packet, 1, { tokenMaterial: generateTokenMaterial() }));
  await assert.rejects(
    journal.append(state.eventSequence, selection.events.slice(0, 1)),
    errorCode("selection_dispatch_atomic_batch_required"),
  );
  assert.equal((await journal.load()).events.length, 2);
  await journal.append(state.eventSequence, selection.events, {
    verificationRecords: selection.verificationRecords,
  });
  await assert.rejects(
    journal.append(state.eventSequence, selection.events, {
      verificationRecords: selection.verificationRecords,
    }),
    errorCode("journal_sequence_conflict"),
  );
  assert.equal((await journal.load()).events.length, 4);
});

test("journal constructor and append reject raw token keys in every artifact class", async () => {
  const decisionBoundary = binding({
    projectId: "project_core_raw_token",
    sessionId: "session_core_raw_token",
    episodeId: "episode_core_raw_token",
    boundaryId: "boundary_core_raw_token",
  });
  const rawOpenEvent = structuredClone(decide(replay([]), openCommand(decisionBoundary)).events[0]);
  rawOpenEvent.payload.continuation_token = "raw_token_must_not_persist";
  const rawDocument = structuredClone(basePacket);
  rawDocument.correlation_token = "raw_token_must_not_persist";
  const rawVerification = { continuation_token: "raw_token_must_not_persist" };
  assert.throws(
    () => new InMemoryJournal({ events: [rawOpenEvent] }),
    errorCode("raw_continuation_token_forbidden"),
  );
  assert.throws(
    () => new InMemoryJournal({ documents: [rawDocument] }),
    errorCode("raw_continuation_token_forbidden"),
  );
  assert.throws(
    () => new InMemoryJournal({ verificationRecords: [rawVerification] }),
    errorCode("raw_continuation_token_forbidden"),
  );
  await assert.rejects(
    new InMemoryJournal().append(0, [rawOpenEvent]),
    errorCode("raw_continuation_token_forbidden"),
  );

  const documentJournal = new InMemoryJournal();
  await executeCommand(documentJournal, openCommand(decisionBoundary));
  let state = await stateOf(documentJournal);
  const packet = packetFor(decisionBoundary, state.eventSequence + 1);
  const seal = decide(state, sealCommand(packet));
  const rawSealDocument = structuredClone(seal.documents[0]);
  rawSealDocument.continuation_token = "raw_token_must_not_persist";
  await assert.rejects(
    documentJournal.append(state.eventSequence, seal.events, {
      documents: [rawSealDocument],
    }),
    errorCode("raw_continuation_token_forbidden"),
  );

  const action = await setupWaiting({
    boundary: binding({
      projectId: "project_core_raw_verification",
      sessionId: "session_core_raw_verification",
      episodeId: "episode_core_raw_verification",
      boundaryId: "boundary_core_raw_verification",
    }),
  });
  state = await stateOf(action.journal);
  const selection = decide(state, selectCommand(action.packet, 1, {
    tokenMaterial: generateTokenMaterial(),
  }));
  const rawSelectionVerification = structuredClone(selection.verificationRecords[0]);
  rawSelectionVerification.correlation_token = "raw_token_must_not_persist";
  await assert.rejects(
    action.journal.append(state.eventSequence, selection.events, {
      verificationRecords: [rawSelectionVerification],
    }),
    errorCode("raw_continuation_token_forbidden"),
  );
});

test("format repair reservation and claim survive restart and remain exactly once", async () => {
  const decisionBoundary = binding({ boundaryId: "boundary_core_repair" });
  const journal = new InMemoryJournal();
  await executeCommand(journal, openCommand(decisionBoundary));
  const token = generateTokenMaterial();
  const reserveCommand = {
    type: "reserve_format_repair",
    event_id: id("event_repair_reserved"),
    occurred_at: "2026-08-21T01:00:01Z",
    binding: decisionBoundary,
    continuation_id: id("continuation_repair"),
    repair_request_id: id("repair_request"),
    parent_prompt_id: decisionBoundary.source_prompt_id,
    token_material: token,
    issued_at: "2026-08-21T01:00:01Z",
    expires_at: "2026-08-21T01:02:01Z",
  };
  const reserved = await executeCommand(journal, reserveCommand);
  const envelope = reserved.effects[0].envelope;
  let snapshot = await journal.load();
  assert.equal(JSON.stringify(snapshot).includes(envelope.continuation_token), false);
  assert.doesNotThrow(() => replay(snapshot.events, {
    documents: snapshot.documents,
    verificationRecords: snapshot.verificationRecords,
  }));

  const restarted = new InMemoryJournal(snapshot);
  await assert.rejects(
    executeCommand(restarted, { ...reserveCommand, event_id: id("event_repair_duplicate"), token_material: generateTokenMaterial() }),
    errorCode("format_repair_already_reserved_for_boundary"),
  );
  const reservedState = await stateOf(restarted);
  const earlyClaimCommand = {
    type: "claim_format_repair",
    event_id: id("event_repair_before_reservation"),
    occurred_at: "2026-08-21T01:00:00Z",
    envelope,
  };
  assert.throws(
    () => decide(reservedState, earlyClaimCommand),
    errorCode("format_repair_time_invalid"),
  );
  await assert.rejects(
    executeCommand(restarted, earlyClaimCommand),
    errorCode("format_repair_time_invalid"),
  );
  const validClaimProjection = decide(reservedState, {
    ...earlyClaimCommand,
    event_id: id("event_repair_claim_projection"),
    occurred_at: "2026-08-21T01:00:02Z",
  });
  const earlyClaimProjection = structuredClone(validClaimProjection.events[0]);
  earlyClaimProjection.occurred_at = earlyClaimCommand.occurred_at;
  assert.throws(
    () => replay([...snapshot.events, earlyClaimProjection], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("format_repair_time_invalid"),
  );
  const wrongTokenEnvelope = { ...envelope, continuation_token: generateTokenMaterial().token };
  await assert.rejects(
    executeCommand(restarted, {
      type: "claim_format_repair",
      event_id: id("event_repair_wrong_token"),
      occurred_at: "2026-08-21T01:00:02Z",
      envelope: wrongTokenEnvelope,
    }),
    errorCode("continuation_token_invalid"),
  );
  await assert.rejects(
    executeCommand(restarted, {
      type: "claim_format_repair",
      event_id: id("event_repair_cross_session"),
      occurred_at: "2026-08-21T01:00:02Z",
      envelope: { ...envelope, session_id: "session_other" },
    }),
    errorCode("decision_boundary_binding_mismatch"),
  );
  await assert.rejects(
    executeCommand(restarted, {
      type: "claim_format_repair",
      event_id: id("event_repair_expired"),
      occurred_at: envelope.expires_at,
      envelope,
    }),
    errorCode("format_repair_time_invalid"),
  );
  await executeCommand(restarted, {
    type: "claim_format_repair",
    event_id: id("event_repair_claimed"),
    occurred_at: "2026-08-21T01:00:02Z",
    envelope,
  });
  await assert.rejects(
    executeCommand(restarted, {
      type: "claim_format_repair",
      event_id: id("event_repair_claimed_twice"),
      occurred_at: "2026-08-21T01:00:03Z",
      envelope,
    }),
    errorCode("format_repair_already_claimed_for_boundary"),
  );
  snapshot = await restarted.load();
  assert.deepEqual(
    snapshot.events.slice(-2).map((event) => event.event_type),
    ["internal_format_repair_reserved", "internal_format_repair_claimed"],
  );
});

test("continuation identity is globally unique across repair boundaries and origins", async () => {
  function reserveCommandFor(decisionBoundary, continuationId, {
    occurredAt,
    expiresAt,
    tokenMaterial,
  }) {
    return {
      type: "reserve_format_repair",
      event_id: id("event_global_repair"),
      occurred_at: occurredAt,
      binding: decisionBoundary,
      continuation_id: continuationId,
      repair_request_id: id("repair_request_global"),
      parent_prompt_id: decisionBoundary.source_prompt_id,
      token_material: tokenMaterial,
      issued_at: occurredAt,
      expires_at: expiresAt,
    };
  }

  const repairBoundaryOne = binding({
    projectId: "project_core_global_repair",
    sessionId: "session_core_global_repair",
    episodeId: "episode_core_global_repair",
    boundaryId: "boundary_core_global_repair_001",
  });
  const repairJournal = new InMemoryJournal();
  await executeCommand(repairJournal, openCommand(repairBoundaryOne));
  const repairContinuationId = "continuation_core_global_repair";
  const reserved = await executeCommand(repairJournal, reserveCommandFor(
    repairBoundaryOne,
    repairContinuationId,
    {
      occurredAt: "2026-08-21T01:00:01Z",
      expiresAt: "2026-08-21T01:02:01Z",
      tokenMaterial: generateTokenMaterial(),
    },
  ));
  await executeCommand(repairJournal, {
    type: "claim_format_repair",
    event_id: id("event_global_repair_claim"),
    occurred_at: "2026-08-21T01:00:02Z",
    envelope: reserved.effects[0].envelope,
  });
  await executeCommand(repairJournal, {
    type: "close_boundary",
    event_id: id("event_global_repair_close"),
    occurred_at: "2026-08-21T01:00:03Z",
    binding: repairBoundaryOne,
    close_reason: "format_repair_claimed",
  });
  const repairBoundaryTwo = binding({
    projectId: "project_core_global_repair",
    sessionId: "session_core_global_repair",
    episodeId: "episode_core_global_repair",
    boundaryId: "boundary_core_global_repair_002",
    boundarySequence: 2,
  });
  await executeCommand(
    repairJournal,
    openCommand(repairBoundaryTwo, "2026-08-21T01:00:04Z"),
  );
  await assert.rejects(
    executeCommand(repairJournal, reserveCommandFor(
      repairBoundaryTwo,
      repairContinuationId,
      {
        occurredAt: "2026-08-21T01:00:05Z",
        expiresAt: "2026-08-21T01:02:05Z",
        tokenMaterial: generateTokenMaterial(),
      },
    )),
    errorCode("continuation_already_dispatched"),
  );

  let snapshot = await repairJournal.load();
  let state = await stateOf(repairJournal);
  const repairAttack = decide(state, reserveCommandFor(
    repairBoundaryTwo,
    id("continuation_global_repair_unique"),
    {
      occurredAt: "2026-08-21T01:00:05Z",
      expiresAt: "2026-08-21T01:02:05Z",
      tokenMaterial: generateTokenMaterial(),
    },
  ));
  const duplicateRepairEvent = structuredClone(repairAttack.events[0]);
  duplicateRepairEvent.payload.continuation_id = repairContinuationId;
  assert.throws(
    () => replay([...snapshot.events, duplicateRepairEvent], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("continuation_already_dispatched"),
  );

  const packet = packetFor(repairBoundaryTwo, state.eventSequence + 1, {
    sealedAt: "2026-08-21T01:00:06Z",
    expiresAt: "2026-08-21T01:02:06Z",
  });
  await executeCommand(repairJournal, sealCommand(packet));
  const duplicatePetCommand = selectCommand(packet, 1, {
    occurredAt: "2026-08-21T01:00:07Z",
    issuedAt: "2026-08-21T01:00:07Z",
    expiresAt: "2026-08-21T01:02:07Z",
    deadlineAt: "2026-08-21T01:05:07Z",
  });
  duplicatePetCommand.continuation_id = repairContinuationId;
  await assert.rejects(
    executeCommand(repairJournal, duplicatePetCommand),
    errorCode("continuation_already_dispatched"),
  );

  snapshot = await repairJournal.load();
  state = await stateOf(repairJournal);
  const validPetCommand = selectCommand(packet, 1, {
    occurredAt: "2026-08-21T01:00:07Z",
    issuedAt: "2026-08-21T01:00:07Z",
    expiresAt: "2026-08-21T01:02:07Z",
    deadlineAt: "2026-08-21T01:05:07Z",
    tokenMaterial: generateTokenMaterial(),
  });
  const petAttack = decide(state, validPetCommand);
  const duplicatePetEvents = structuredClone(petAttack.events);
  const duplicatePetVerification = structuredClone(petAttack.verificationRecords[0]);
  duplicatePetEvents[1].payload.continuation_id = repairContinuationId;
  duplicatePetVerification.continuation_id = repairContinuationId;
  assert.throws(
    () => replay([...snapshot.events, ...duplicatePetEvents], {
      documents: snapshot.documents,
      verificationRecords: [...snapshot.verificationRecords, duplicatePetVerification],
    }),
    errorCode("continuation_already_dispatched"),
  );

  const petBoundaryOne = binding({
    projectId: "project_core_global_pet",
    sessionId: "session_core_global_pet",
    episodeId: "episode_core_global_pet",
    boundaryId: "boundary_core_global_pet_001",
  });
  const petSetup = await setupWaiting({ boundary: petBoundaryOne });
  const petContinuationId = "continuation_core_global_pet";
  const petCommand = selectCommand(petSetup.packet, 1);
  petCommand.continuation_id = petContinuationId;
  await executeCommand(petSetup.journal, petCommand);
  await executeCommand(petSetup.journal, {
    type: "timeout_transport_unknown",
    event_id: id("event_global_pet_timeout"),
    occurred_at: petCommand.in_flight_deadline_at,
    binding: petBoundaryOne,
    continuation_id: petContinuationId,
  });
  await executeCommand(petSetup.journal, {
    type: "close_boundary",
    event_id: id("event_global_pet_close"),
    occurred_at: "2026-08-21T01:05:04Z",
    binding: petBoundaryOne,
    close_reason: "transport_terminal",
  });
  const petBoundaryTwo = binding({
    projectId: "project_core_global_pet",
    sessionId: "session_core_global_pet",
    episodeId: "episode_core_global_pet",
    boundaryId: "boundary_core_global_pet_002",
    boundarySequence: 2,
  });
  await executeCommand(
    petSetup.journal,
    openCommand(petBoundaryTwo, "2026-08-21T01:05:05Z"),
  );
  const duplicateRepairCommand = reserveCommandFor(
    petBoundaryTwo,
    petContinuationId,
    {
      occurredAt: "2026-08-21T01:05:06Z",
      expiresAt: "2026-08-21T01:07:06Z",
      tokenMaterial: generateTokenMaterial(),
    },
  );
  await assert.rejects(
    executeCommand(petSetup.journal, duplicateRepairCommand),
    errorCode("continuation_already_dispatched"),
  );

  snapshot = await petSetup.journal.load();
  state = await stateOf(petSetup.journal);
  const crossOriginAttack = decide(state, reserveCommandFor(
    petBoundaryTwo,
    id("continuation_global_pet_unique"),
    {
      occurredAt: "2026-08-21T01:05:06Z",
      expiresAt: "2026-08-21T01:07:06Z",
      tokenMaterial: generateTokenMaterial(),
    },
  ));
  const duplicateCrossOriginEvent = structuredClone(crossOriginAttack.events[0]);
  duplicateCrossOriginEvent.payload.continuation_id = petContinuationId;
  assert.throws(
    () => replay([...snapshot.events, duplicateCrossOriginEvent], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("continuation_already_dispatched"),
  );
});

test("a token fingerprint cannot be reused across continuation or repair boundaries", async () => {
  const first = await setupWaiting();
  const sharedToken = generateTokenMaterial();
  const firstCommand = selectCommand(first.packet, 1, { tokenMaterial: sharedToken });
  const firstSelected = await executeCommand(first.journal, firstCommand);
  await executeCommand(first.journal, {
    type: "consume_pet_action",
    event_id: id("event_reuse_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope: firstSelected.effects[0].envelope,
  });
  await executeCommand(first.journal, {
    type: "complete_transport",
    event_id: id("event_reuse_transport"),
    occurred_at: "2026-08-21T01:00:05Z",
    binding: first.boundary,
    continuation_id: firstCommand.continuation_id,
  });
  await executeCommand(first.journal, {
    type: "close_boundary",
    event_id: id("event_close"),
    occurred_at: "2026-08-21T01:00:06Z",
    binding: first.boundary,
    close_reason: "selection_claimed",
  });
  const secondBoundary = binding({ boundaryId: "boundary_core_repair_002", boundarySequence: 2 });
  await executeCommand(first.journal, openCommand(secondBoundary, "2026-08-21T01:00:07Z"));
  await assert.rejects(
    executeCommand(first.journal, {
      type: "reserve_format_repair",
      event_id: id("event_repair_reuse"),
      occurred_at: "2026-08-21T01:00:08Z",
      binding: secondBoundary,
      continuation_id: id("continuation_repair"),
      repair_request_id: id("repair_request"),
      parent_prompt_id: secondBoundary.source_prompt_id,
      token_material: sharedToken,
      issued_at: "2026-08-21T01:00:08Z",
      expires_at: "2026-08-21T01:02:08Z",
    }),
    errorCode("token_fingerprint_duplicate"),
  );

  let state = await stateOf(first.journal);
  const secondPacket = packetFor(secondBoundary, state.eventSequence + 1, {
    sealedAt: "2026-08-21T01:00:09Z",
    expiresAt: "2026-08-21T01:02:09Z",
  });
  await executeCommand(first.journal, sealCommand(secondPacket));
  await executeCommand(first.journal, selectCommand(secondPacket, 1, {
    occurredAt: "2026-08-21T01:00:10Z",
    issuedAt: "2026-08-21T01:00:10Z",
    expiresAt: "2026-08-21T01:02:10Z",
    deadlineAt: "2026-08-21T01:05:10Z",
  }));
  const snapshot = await first.journal.load();
  const duplicateProjection = structuredClone(snapshot.verificationRecords);
  duplicateProjection[1].correlation_token_fingerprint =
    duplicateProjection[0].correlation_token_fingerprint;
  assert.throws(
    () => replay(snapshot.events, {
      documents: snapshot.documents,
      verificationRecords: duplicateProjection,
    }),
    errorCode("token_fingerprint_duplicate"),
  );
});

test("pet continuation validates full binding, token, immutable action, and one-time consumption", async () => {
  const { journal, packet } = await setupWaiting();
  const selected = await executeCommand(journal, selectCommand(packet, 1));
  const envelope = selected.effects[0].envelope;
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_consume_before_issued"),
      occurred_at: "2026-08-20T01:00:03Z",
      envelope,
    }),
    errorCode("continuation_not_yet_valid"),
  );
  const beforeConsumeSnapshot = await journal.load();
  const beforeConsumeState = await stateOf(journal);
  const validConsumeProjection = decide(beforeConsumeState, {
    type: "consume_pet_action",
    event_id: id("event_consume_projection"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope,
  }).events[0];
  const earlyConsumeProjection = structuredClone(validConsumeProjection);
  earlyConsumeProjection.occurred_at = "2026-08-20T01:00:03Z";
  assert.throws(
    () => replay([...beforeConsumeSnapshot.events, earlyConsumeProjection], {
      documents: beforeConsumeSnapshot.documents,
      verificationRecords: beforeConsumeSnapshot.verificationRecords,
    }),
    errorCode("continuation_not_yet_valid"),
  );
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_consume_wrong_session"),
      occurred_at: "2026-08-21T01:00:04Z",
      envelope: { ...envelope, session_id: "session_other" },
    }),
    errorCode("decision_boundary_binding_mismatch"),
  );
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_consume_wrong_action"),
      occurred_at: "2026-08-21T01:00:04Z",
      envelope: { ...envelope, action: { ...envelope.action, title: "Tampered" } },
    }),
    errorCode("continuation_action_mismatch"),
  );
  for (const [field, value] of [
    ["issued_at", "2099-08-21T01:00:03Z"],
    ["expires_at", "2099-08-21T01:02:03Z"],
    ["in_flight_deadline_at", "2099-08-21T01:05:03Z"],
  ]) {
    await assert.rejects(
      executeCommand(journal, {
        type: "consume_pet_action",
        event_id: id(`event_consume_wrong_${field}`),
        occurred_at: "2026-08-21T01:00:04Z",
        envelope: { ...envelope, [field]: value },
      }),
      errorCode("continuation_binding_mismatch"),
      `${field} must exactly match the persisted dispatch`,
    );
  }
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_consume_wrong_token"),
      occurred_at: "2026-08-21T01:00:04Z",
      envelope: { ...envelope, continuation_token: generateTokenMaterial().token },
    }),
    errorCode("continuation_token_invalid"),
  );
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope,
  });
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_consume_twice"),
      occurred_at: "2026-08-21T01:00:05Z",
      envelope,
    }),
    errorCode("continuation_already_consumed"),
  );
});

test("work outcome scalar bounds fail closed in decide, execute, and replay", async () => {
  const decisionBoundary = binding({
    projectId: "project_core_work_bounds",
    sessionId: "session_core_work_bounds",
    episodeId: "episode_core_work_bounds",
    boundaryId: "boundary_core_work_bounds",
  });
  const { journal, packet } = await setupWaiting({ boundary: decisionBoundary });
  const selected = await executeCommand(journal, selectCommand(packet, 1));
  const envelope = selected.effects[0].envelope;
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_work_bounds_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope,
  });
  await executeCommand(journal, {
    type: "complete_transport",
    event_id: id("event_work_bounds_transport"),
    occurred_at: "2026-08-21T01:00:05Z",
    binding: decisionBoundary,
    continuation_id: envelope.continuation_id,
  });
  const snapshot = await journal.load();
  const state = await stateOf(journal);
  const baseCommand = {
    type: "record_work_outcome",
    event_id: id("event_work_bounds_base"),
    occurred_at: "2026-08-21T01:00:06Z",
    binding: decisionBoundary,
    continuation_id: envelope.continuation_id,
    status: "succeeded",
    summary: "The fictional bounded outcome completed.",
    evidence_ids: ["evidence_core_bounded"],
  };
  const invalidCases = [
    { code: "summary_missing", values: { summary: "" } },
    { code: "summary_invalid", values: { summary: "x".repeat(8193) } },
    { code: "evidence_ids_invalid", values: { evidence_ids: Array(257).fill("evidence") } },
    { code: "evidence_id_missing", values: { evidence_ids: [""] } },
    { code: "evidence_id_invalid", values: { evidence_ids: ["x".repeat(513)] } },
  ];
  for (const [index, fixtureCase] of invalidCases.entries()) {
    const command = {
      ...baseCommand,
      ...fixtureCase.values,
      event_id: id(`event_work_bounds_invalid_${index}`),
    };
    assert.throws(() => decide(state, command), errorCode(fixtureCase.code));
    await assert.rejects(executeCommand(journal, command), errorCode(fixtureCase.code));
  }

  const unicodeSummaryCommand = {
    ...baseCommand,
    event_id: id("event_work_bounds_unicode"),
    summary: "🧪".repeat(5000),
  };
  const unicodeOutcome = decide(state, unicodeSummaryCommand).events[0];
  await assertV1("runtime_event", unicodeOutcome);

  const validOutcome = decide(state, {
    ...baseCommand,
    event_id: id("event_work_bounds_projection"),
  }).events[0];
  await assertV1("runtime_event", validOutcome);
  const invalidSummaryReplay = structuredClone(validOutcome);
  invalidSummaryReplay.payload.summary = "x".repeat(8193);
  assert.throws(
    () => replay([...snapshot.events, invalidSummaryReplay], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("summary_invalid"),
  );
  const invalidEvidenceReplay = structuredClone(validOutcome);
  invalidEvidenceReplay.payload.evidence_ids = Array(257).fill("evidence");
  assert.throws(
    () => replay([...snapshot.events, invalidEvidenceReplay], {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    }),
    errorCode("evidence_ids_invalid"),
  );
  await executeCommand(journal, baseCommand);
});

test("transport completion and work outcome remain distinct projections", async () => {
  const { journal, packet, boundary: decisionBoundary } = await setupWaiting();
  const selected = await executeCommand(journal, selectCommand(packet, 1));
  const envelope = selected.effects[0].envelope;
  await executeCommand(journal, {
    type: "consume_pet_action",
    event_id: id("event_consume"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope,
  });
  await executeCommand(journal, {
    type: "complete_transport",
    event_id: id("event_transport"),
    occurred_at: "2026-08-21T01:00:05Z",
    binding: decisionBoundary,
    continuation_id: envelope.continuation_id,
  });
  let state = await stateOf(journal);
  assert.equal(state.continuations[envelope.continuation_id].transport.status, "completed");
  assert.equal(state.continuations[envelope.continuation_id].workOutcome, null);
  await executeCommand(journal, {
    type: "record_work_outcome",
    event_id: id("event_outcome"),
    occurred_at: "2026-08-21T01:00:06Z",
    binding: decisionBoundary,
    continuation_id: envelope.continuation_id,
    status: "failed",
    summary: "The fictional action failed independently of transport.",
    evidence_ids: [],
  });
  state = await stateOf(journal);
  assert.equal(state.continuations[envelope.continuation_id].workOutcome.work_outcome_status, "failed");
});

test("deadline timeout records unknown without retry or inferred cancellation/failure", async () => {
  const { journal, packet, boundary: decisionBoundary } = await setupWaiting();
  const selected = await executeCommand(journal, selectCommand(packet, 1));
  const envelope = selected.effects[0].envelope;
  const beforeTimeoutSnapshot = await journal.load();
  const beforeTimeoutState = await stateOf(journal);
  const validConsumeBeforeTimeout = decide(beforeTimeoutState, {
    type: "consume_pet_action",
    event_id: id("event_consume_before_timeout_projection"),
    occurred_at: "2026-08-21T01:00:04Z",
    envelope,
  }).events[0];
  await executeCommand(journal, {
    type: "timeout_transport_unknown",
    event_id: id("event_timeout"),
    occurred_at: envelope.in_flight_deadline_at,
    binding: decisionBoundary,
    continuation_id: envelope.continuation_id,
  });
  const state = await stateOf(journal);
  assert.deepEqual(state.continuations[envelope.continuation_id].transport, {
    status: "timed_out_unknown",
    occurredAt: envelope.in_flight_deadline_at,
    workOutcomeStatus: "unknown",
    automaticRetry: false,
  });
  const timeout = (await journal.load()).events.at(-1).payload;
  assert.equal(timeout.automatic_retry, false);
  assert.equal(timeout.cancellation_inferred, false);
  assert.equal(timeout.failure_inferred, false);
  await assert.rejects(
    executeCommand(journal, {
      type: "consume_pet_action",
      event_id: id("event_consume_after_timeout"),
      occurred_at: "2026-08-21T01:00:04Z",
      envelope,
    }),
    errorCode("transport_already_terminal"),
  );
  const timedOutSnapshot = await journal.load();
  const backdatedConsume = structuredClone(validConsumeBeforeTimeout);
  backdatedConsume.event_sequence = timedOutSnapshot.events.at(-1).event_sequence + 1;
  assert.throws(
    () => replay([...timedOutSnapshot.events, backdatedConsume], {
      documents: beforeTimeoutSnapshot.documents,
      verificationRecords: beforeTimeoutSnapshot.verificationRecords,
    }),
    errorCode("transport_already_terminal"),
  );
  await assert.rejects(
    executeCommand(journal, selectCommand(packet, 2)),
    errorCode("selection_already_claimed"),
  );
  await assert.rejects(
    executeCommand(journal, {
      type: "complete_transport",
      event_id: id("event_late_complete"),
      occurred_at: "2026-08-21T01:05:04Z",
      binding: decisionBoundary,
      continuation_id: envelope.continuation_id,
    }),
    errorCode("continuation_not_consumed"),
  );
});

test("a committed dispatch whose token response is lost cannot be reissued after restart", async () => {
  const { journal, packet, boundary: decisionBoundary } = await setupWaiting();
  const command = selectCommand(packet, 1);
  await executeCommand(journal, command); // Simulate a crash before the caller keeps the effect.
  const restarted = new InMemoryJournal(await journal.load());
  await assert.rejects(
    executeCommand(restarted, selectCommand(packet, 1)),
    errorCode("selection_already_claimed"),
  );
  await executeCommand(restarted, {
    type: "timeout_transport_unknown",
    event_id: id("event_timeout_after_restart"),
    occurred_at: command.in_flight_deadline_at,
    binding: decisionBoundary,
    continuation_id: command.continuation_id,
  });
  assert.equal(
    (await restarted.load()).events.at(-1).payload.automatic_retry,
    false,
  );
});

test("slot 3 pauses and closes atomically while slot 4 remains disabled", async () => {
  const { journal, packet } = await setupWaiting();
  const pause = selectCommand(packet, 3);
  const execution = await executeCommand(journal, pause);
  assert.equal(execution.effects[0].kind, "episode_paused");
  const snapshot = await journal.load();
  assert.deepEqual(
    snapshot.events.slice(-2).map((event) => event.event_type),
    ["decision_selection_claimed", "decision_boundary_closed"],
  );
  assert.equal(snapshot.events.at(-1).payload.close_reason, "episode_paused");
  const pauseSelectionPrefix = {
    events: snapshot.events.slice(0, -1),
    documents: snapshot.documents,
    verificationRecords: snapshot.verificationRecords,
  };
  assert.doesNotThrow(() => replay(pauseSelectionPrefix.events, {
    documents: pauseSelectionPrefix.documents,
    verificationRecords: pauseSelectionPrefix.verificationRecords,
  }));
  const pausePrefixJournal = new InMemoryJournal(pauseSelectionPrefix);
  await assert.rejects(
    executeCommand(pausePrefixJournal, {
      type: "close_boundary",
      event_id: id("event_pause_wrong_close_reason"),
      occurred_at: "2026-08-21T01:00:04Z",
      binding: binding(),
      close_reason: "manual_pause",
    }),
    errorCode("pause_selection_close_reason_invalid"),
  );
  const wrongPauseClose = structuredClone(snapshot.events.at(-1));
  wrongPauseClose.payload.close_reason = "manual_pause";
  assert.throws(
    () => replay([...pauseSelectionPrefix.events, wrongPauseClose], {
      documents: pauseSelectionPrefix.documents,
      verificationRecords: pauseSelectionPrefix.verificationRecords,
    }),
    errorCode("pause_selection_close_reason_invalid"),
  );
  const pausedState = await stateOf(journal);
  assert.equal(Object.values(pausedState.boundaries)[0].closed, true);

  const other = await setupWaiting({
    boundary: binding({
      projectId: "project_core_other",
      sessionId: "session_core_other",
      episodeId: "episode_core_other",
      boundaryId: "boundary_core_other",
    }),
  });
  await assert.rejects(
    executeCommand(other.journal, selectCommand(other.packet, 4)),
    errorCode("decision_option_disabled"),
  );
});

test("one-nanosecond packet, repair, and in-flight boundaries fail or pass exactly", async () => {
  const decisionBoundary = binding({ boundaryId: "boundary_core_ns" });
  const { journal, packet } = await setupWaiting({
    boundary: decisionBoundary,
    sealedAt: "2026-08-21T01:00:01.000000000Z",
    expiresAt: "2026-08-21T01:00:10.000000000Z",
  });
  const command = selectCommand(packet, 1, {
    occurredAt: "2026-08-21T01:00:09.999999999Z",
    issuedAt: "2026-08-21T01:00:09.999999999Z",
    expiresAt: "2026-08-21T01:00:12.000000000Z",
    deadlineAt: "2026-08-21T01:00:15.000000000Z",
  });
  await executeCommand(journal, command);
  await assert.rejects(
    executeCommand(journal, {
      type: "timeout_transport_unknown",
      event_id: id("event_timeout_early_ns"),
      occurred_at: "2026-08-21T01:00:14.999999999Z",
      binding: decisionBoundary,
      continuation_id: command.continuation_id,
    }),
    errorCode("timeout_before_in_flight_deadline"),
  );
  await executeCommand(journal, {
    type: "timeout_transport_unknown",
    event_id: id("event_timeout_exact_ns"),
    occurred_at: "2026-08-21T01:00:15.000000000Z",
    binding: decisionBoundary,
    continuation_id: command.continuation_id,
  });

  const exactExpiry = await setupWaiting({
    boundary: binding({
      projectId: "project_core_expiry",
      sessionId: "session_core_expiry",
      episodeId: "episode_core_expiry",
      boundaryId: "boundary_core_expiry",
    }),
    sealedAt: "2026-08-21T01:00:01.000000000Z",
    expiresAt: "2026-08-21T01:00:10.000000000Z",
  });
  await assert.rejects(
    executeCommand(exactExpiry.journal, selectCommand(exactExpiry.packet, 1, {
      occurredAt: "2026-08-21T01:00:10.000000000Z",
      issuedAt: "2026-08-21T01:00:10.000000000Z",
    })),
    errorCode("decision_packet_expired"),
  );

  const repairBoundary = binding({
    projectId: "project_core_repair_ns",
    sessionId: "session_core_repair_ns",
    episodeId: "episode_core_repair_ns",
    boundaryId: "boundary_core_repair_ns",
  });
  const repairJournal = new InMemoryJournal();
  await executeCommand(repairJournal, openCommand(repairBoundary));
  await executeCommand(repairJournal, {
    type: "reserve_format_repair",
    event_id: id("event_repair_ns"),
    occurred_at: "2026-08-21T01:00:01.999999999Z",
    binding: repairBoundary,
    continuation_id: id("continuation_repair_ns"),
    repair_request_id: id("repair_request_ns"),
    parent_prompt_id: repairBoundary.source_prompt_id,
    token_material: generateTokenMaterial(),
    issued_at: "2026-08-21T01:00:01.000000000Z",
    expires_at: "2026-08-21T01:00:02.000000000Z",
  });

  const repairExactBoundary = binding({
    projectId: "project_core_repair_exact",
    sessionId: "session_core_repair_exact",
    episodeId: "episode_core_repair_exact",
    boundaryId: "boundary_core_repair_exact",
  });
  const repairExactJournal = new InMemoryJournal();
  await executeCommand(repairExactJournal, openCommand(repairExactBoundary));
  await assert.rejects(
    executeCommand(repairExactJournal, {
      type: "reserve_format_repair",
      event_id: id("event_repair_exact"),
      occurred_at: "2026-08-21T01:00:02.000000000Z",
      binding: repairExactBoundary,
      continuation_id: id("continuation_repair_exact"),
      repair_request_id: id("repair_request_exact"),
      parent_prompt_id: repairExactBoundary.source_prompt_id,
      token_material: generateTokenMaterial(),
      issued_at: "2026-08-21T01:00:01.000000000Z",
      expires_at: "2026-08-21T01:00:02.000000000Z",
    }),
    errorCode("format_repair_time_invalid"),
  );
});

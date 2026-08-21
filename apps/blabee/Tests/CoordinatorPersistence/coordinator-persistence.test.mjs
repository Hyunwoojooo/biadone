import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  access,
  appendFile,
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  truncate,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  fixtureValidator,
  formatAjvErrors,
  loadV1ContractSuite,
} from "../Contracts/contract-harness.mjs";
import {
  buildCoordinator,
  cleanupCoordinatorBuild,
  CONTRACTS_ROOT,
  createKeySymlink,
  createPersistenceWorkspace,
  createStorageKey,
  deleteKeychainTestAnchor,
  existingDatabaseArtifacts,
  launchCoordinator,
  readKeychainTestAnchor,
  sqlite,
  structuredLogCodes,
} from "./runtime-harness.mjs";

const basePacket = JSON.parse(await readFile(
  new URL(
    "../../Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json",
    import.meta.url,
  ),
  "utf8",
));
const baseContinuation = JSON.parse(await readFile(
  new URL(
    "../../Fixtures/v1/contracts/valid/continuation-pet-action.json",
    import.meta.url,
  ),
  "utf8",
));
const contractSuitePromise = loadV1ContractSuite();

const packetBindingMutations = [
  ["project_id", (packet) => { packet.project_id = "project_persistence_cross_bound"; }],
  ["session_id", (packet) => { packet.session_id = "session_persistence_cross_bound"; }],
  ["source_turn_id", (packet) => { packet.source_turn_id = "turn_persistence_cross_bound"; }],
  ["source_prompt_id", (packet) => { packet.source_prompt_id = "prompt_persistence_cross_bound"; }],
  ["episode_id", (packet) => { packet.episode_id = "episode_persistence_cross_bound"; }],
  ["episode_root_prompt_id", (packet) => {
    packet.episode_root_prompt_id = "prompt_persistence_cross_bound";
  }],
  ["episode_baseline_checkpoint_id", (packet) => {
    packet.episode_baseline_checkpoint_id = "checkpoint_persistence_cross_bound";
    packet.checkpoint.id = packet.episode_baseline_checkpoint_id;
  }],
  ["decision_boundary_id", (packet) => {
    packet.decision_boundary_id = "boundary_persistence_cross_bound";
  }],
  ["boundary_sequence", (packet) => { packet.boundary_sequence = 2; }],
  ["interaction_id", (packet) => {
    packet.interaction_id = "interaction_persistence_cross_bound";
  }],
  ["expires_at", (packet) => { packet.expires_at = "2026-08-21T02:02:02Z"; }],
  ["sealed_at", (packet) => { packet.sealed_at = "2026-08-21T02:00:00Z"; }],
  ["valid_after_event_sequence", (packet) => { packet.valid_after_event_sequence = 3; }],
];

after(async () => {
  await cleanupCoordinatorBuild();
});

function assertOk(response, label = "coordinator response") {
  assert.equal(
    response?.ok,
    true,
    `${label}: ${JSON.stringify(response?.error ?? response)}`,
  );
  assert.ok(response.result && typeof response.result === "object", `${label}: missing result`);
  return response.result;
}

function assertError(response, expectedCode, label = "coordinator response") {
  assert.equal(response?.ok, false, `${label}: expected ${expectedCode}`);
  assert.equal(response?.error?.code, expectedCode, `${label}: ${JSON.stringify(response)}`);
  assert.equal(typeof response.error.message, "string", `${label}: missing error message`);
}

function assertSanitizedError(response, expectedCode, label) {
  assert.equal(
    response?.ok === false
      && response?.error?.code === expectedCode
      && typeof response?.error?.message === "string",
    true,
    `${label}: unexpected or incomplete fail-closed response`,
  );
}

function assertSanitizedOk(response, label) {
  assert.equal(
    response?.ok === true && response.result !== null && typeof response.result === "object",
    true,
    `${label}: expected a successful response`,
  );
  return response.result;
}

function bindingFor(suffix) {
  return {
    project_id: `project_persistence_${suffix}`,
    session_id: `session_persistence_${suffix}`,
    source_turn_id: `turn_persistence_${suffix}`,
    source_prompt_id: `prompt_persistence_${suffix}`,
    episode_id: `episode_persistence_${suffix}`,
    episode_root_prompt_id: `prompt_persistence_${suffix}`,
    episode_baseline_checkpoint_id: `checkpoint_persistence_${suffix}`,
    decision_boundary_id: `boundary_persistence_${suffix}`,
    boundary_sequence: 1,
  };
}

function eventFor({
  binding,
  category = "decision_lifecycle",
  eventId,
  eventSequence,
  eventType = "decision_boundary_opened",
  occurredAt = "2026-08-21T02:00:00Z",
  payload,
}) {
  return {
    schema_version: "1.0",
    kind: "blabee_runtime_event",
    event_id: eventId,
    event_sequence: eventSequence,
    event_type: eventType,
    event_category: category,
    occurred_at: occurredAt,
    ...binding,
    payload,
  };
}

function openEvent(eventSequence, suffix) {
  return eventFor({
    binding: bindingFor(suffix),
    eventId: `event_persistence_open_${suffix}`,
    eventSequence,
    payload: { proposal_id: `proposal_persistence_${suffix}` },
  });
}

function sidecarBatch(expectedSequence, suffix) {
  const binding = bindingFor(suffix);
  const interactionId = `interaction_persistence_${suffix}`;
  const packetId = `packet_persistence_${suffix}`;
  const optionId = `option_persistence_${suffix}_recommended`;
  const actionId = `action_persistence_${suffix}_recommended`;
  const continuationId = `continuation_persistence_${suffix}`;
  const packet = structuredClone(basePacket);
  Object.assign(packet, binding, {
    interaction_id: interactionId,
    packet_id: packetId,
    revision: 1,
    valid_after_event_sequence: expectedSequence + 2,
    sealed_at: "2026-08-21T02:00:01Z",
    expires_at: "2026-08-21T02:02:01Z",
    summary: `Fictional persisted packet ${suffix}`,
  });
  packet.checkpoint.id = binding.episode_baseline_checkpoint_id;
  for (const choice of packet.choices) {
    choice.option_id = `option_persistence_${suffix}_${choice.slot}`;
    if (choice.action_id !== null) {
      choice.action_id = `action_persistence_${suffix}_${choice.slot}`;
    }
  }
  packet.choices[0].option_id = optionId;
  packet.choices[0].action_id = actionId;

  const open = eventFor({
    binding,
    eventId: `event_persistence_${suffix}_open`,
    eventSequence: expectedSequence + 1,
    payload: { proposal_id: `proposal_persistence_${suffix}` },
  });
  const sealed = eventFor({
    binding,
    eventId: `event_persistence_${suffix}_sealed`,
    eventSequence: expectedSequence + 2,
    eventType: "decision_packet_sealed",
    occurredAt: packet.sealed_at,
    payload: {
      interaction_id: interactionId,
      packet_id: packetId,
      revision: 1,
      expires_at: packet.expires_at,
    },
  });
  const selected = eventFor({
    binding,
    eventId: `event_persistence_${suffix}_selected`,
    eventSequence: expectedSequence + 3,
    eventType: "decision_selection_claimed",
    occurredAt: "2026-08-21T02:00:02Z",
    payload: {
      selection_id: `selection_persistence_${suffix}`,
      interaction_id: interactionId,
      packet_id: packetId,
      revision: 1,
      option_id: optionId,
    },
  });
  const dispatched = eventFor({
    binding,
    category: "transport",
    eventId: `event_persistence_${suffix}_dispatched`,
    eventSequence: expectedSequence + 4,
    eventType: "continuation_dispatched",
    occurredAt: "2026-08-21T02:00:03Z",
    payload: {
      continuation_id: continuationId,
      interaction_id: interactionId,
      packet_id: packetId,
      revision: 1,
      option_id: optionId,
      action_id: actionId,
      dispatch_mode: "same_turn_stop",
      issued_at: "2026-08-21T02:00:03Z",
      expires_at: "2026-08-21T02:02:03Z",
      in_flight_deadline_at: "2026-08-21T02:05:03Z",
    },
  });
  const verification = {
    schema_version: "1.0",
    kind: "blabee_continuation_verification_record",
    dispatch_event_id: dispatched.event_id,
    continuation_id: continuationId,
    ...binding,
    interaction_id: interactionId,
    packet_id: packetId,
    revision: 1,
    option_id: optionId,
    action_id: actionId,
    correlation_token_fingerprint: `hmac-sha256:${createHash("sha256").update(`fictional-${suffix}`).digest("hex")}`,
  };
  return {
    documents: [packet],
    events: [open, sealed, selected, dispatched],
    packet,
    verification,
    verification_records: [verification],
  };
}

function repeatedSelectionBatch(expectedSequence, originalBatch, suffix, choiceIndex) {
  const packet = originalBatch.packet;
  const binding = Object.fromEntries(
    Object.keys(bindingFor("shape")).map((key) => [key, packet[key]]),
  );
  const choice = packet.choices[choiceIndex];
  assert.equal(choice.enabled, true, "repeat-selection fixture requires an enabled choice");
  assert.equal(typeof choice.action_id, "string", "repeat-selection fixture requires an action");
  const continuationId = `continuation_persistence_${suffix}`;
  const selected = eventFor({
    binding,
    eventId: `event_persistence_${suffix}_selected`,
    eventSequence: expectedSequence + 1,
    eventType: "decision_selection_claimed",
    occurredAt: "2026-08-21T02:00:04Z",
    payload: {
      selection_id: `selection_persistence_${suffix}`,
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      option_id: choice.option_id,
    },
  });
  const dispatched = eventFor({
    binding,
    category: "transport",
    eventId: `event_persistence_${suffix}_dispatched`,
    eventSequence: expectedSequence + 2,
    eventType: "continuation_dispatched",
    occurredAt: "2026-08-21T02:00:05Z",
    payload: {
      continuation_id: continuationId,
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      option_id: choice.option_id,
      action_id: choice.action_id,
      dispatch_mode: "same_turn_stop",
      issued_at: "2026-08-21T02:00:05Z",
      expires_at: "2026-08-21T02:02:05Z",
      in_flight_deadline_at: "2026-08-21T02:05:05Z",
    },
  });
  const verification = {
    schema_version: "1.0",
    kind: "blabee_continuation_verification_record",
    dispatch_event_id: dispatched.event_id,
    continuation_id: continuationId,
    ...binding,
    interaction_id: packet.interaction_id,
    packet_id: packet.packet_id,
    revision: packet.revision,
    option_id: choice.option_id,
    action_id: choice.action_id,
    correlation_token_fingerprint: `hmac-sha256:${createHash("sha256").update(`fictional-${suffix}`).digest("hex")}`,
  };
  return {
    documents: [],
    events: [selected, dispatched],
    verification_records: [verification],
  };
}

function revisionBumpSelectionBatch(expectedSequence, originalBatch, suffix) {
  const packet = structuredClone(originalBatch.packet);
  packet.revision += 1;
  packet.valid_after_event_sequence = expectedSequence + 1;
  packet.sealed_at = "2026-08-21T02:00:04Z";
  packet.expires_at = "2026-08-21T02:02:04Z";
  const binding = Object.fromEntries(
    Object.keys(bindingFor("shape")).map((key) => [key, packet[key]]),
  );
  const sealed = eventFor({
    binding,
    eventId: `event_persistence_${suffix}_sealed`,
    eventSequence: expectedSequence + 1,
    eventType: "decision_packet_sealed",
    occurredAt: packet.sealed_at,
    payload: {
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      expires_at: packet.expires_at,
    },
  });
  const repeated = repeatedSelectionBatch(
    expectedSequence + 1,
    { packet },
    suffix,
    0,
  );
  return {
    documents: [packet],
    events: [sealed, ...repeated.events],
    verification_records: repeated.verification_records,
  };
}

async function initialize(client) {
  const result = assertOk(await client.request({ op: "initialize" }), "initialize");
  assert.equal(result.schema_version, 1);
  return result;
}

async function seedSidecars(workspace, count = 1) {
  const client = await launchCoordinator(workspace);
  const batches = [];
  try {
    await initialize(client);
    for (let index = 0; index < count; index += 1) {
      const expectedSequence = index * 4;
      const batch = sidecarBatch(expectedSequence, `seed_${index + 1}`);
      batches.push(batch);
      const result = assertOk(await client.request({
        op: "append",
        expected_sequence: expectedSequence,
        events: batch.events,
        documents: batch.documents,
        verification_records: batch.verification_records,
      }), `seed sidecar batch ${index + 1}`);
      assert.equal(result.last_sequence, expectedSequence + 4);
    }
    const integrity = assertOk(await client.request({ op: "integrity" }));
    assert.equal(integrity.sidecars_verified, count * 2);
  } finally {
    await client.close();
  }
  return batches;
}

async function seedEventChain(workspace, count = 3) {
  const client = await launchCoordinator(workspace);
  const events = Array.from(
    { length: count },
    (_, index) => openEvent(index + 1, `event_chain_${index + 1}`),
  );
  try {
    await initialize(client);
    const result = assertOk(await client.request({
      op: "append",
      expected_sequence: 0,
      events,
      documents: [],
      verification_records: [],
    }), "seed event chain");
    assert.equal(result.last_sequence, count);
  } finally {
    await client.close();
  }
  return events;
}

async function requestLoad(workspace, overrides) {
  const client = await launchCoordinator(workspace, overrides);
  try {
    try {
      return await client.request({ op: "load" });
    } catch {
      await client.close();
      const code = structuredLogCodes(client.stderrText).at(-1);
      if (!code) throw new Error("coordinator failed without a structured error");
      return { ok: false, error: { code, message: "bootstrap failed closed" } };
    }
  } finally {
    await client.close();
  }
}

async function assertBootstrapFailure(
  workspace,
  keyPath,
  expectedCode,
  databasePath,
  launchOverrides = {},
) {
  const client = await launchCoordinator(workspace, {
    ...launchOverrides,
    databasePath,
    keyPath,
  });
  try {
    let response;
    try {
      response = await client.request({ op: "health" });
    } catch {
      await client.close();
    }
    if (response) {
      assertError(response, expectedCode, "bootstrap failure response");
      return;
    }
    const codes = structuredLogCodes(client.stderrText);
    assert.ok(
      codes.includes(expectedCode),
      `bootstrap stderr did not contain ${expectedCode}; observed ${JSON.stringify(codes)}`,
    );
  } finally {
    await client.close();
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function canonicalJSONData(value) {
  function sortKeys(node) {
    if (Array.isArray(node)) return node.map(sortKeys);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.keys(node).sort().map((key) => [key, sortKeys(node[key])]),
      );
    }
    return node;
  }
  return Buffer.from(JSON.stringify(sortKeys(value)), "utf8");
}

function authenticatedField(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  return Buffer.concat([length, bytes]);
}

function authenticationCode(storageKey, domain, identity, payload) {
  const message = Buffer.concat([
    authenticatedField(domain),
    authenticatedField(identity),
    authenticatedField(payload),
  ]);
  return createHmac("sha256", storageKey).update(message).digest();
}

function packetAuthenticationCode(storageKey, packet, canonicalData) {
  const identity = `${Buffer.byteLength(packet.packet_id, "utf8")}:${packet.packet_id}:${packet.revision}`;
  return authenticationCode(
    storageKey,
    "blabee.packet-document.v1",
    identity,
    canonicalData,
  );
}

async function replaceStoredPacketWithAuthenticatedMutation(workspace, mutate) {
  const { stdout } = await sqlite(
    workspace.databasePath,
    "SELECT hex(json) FROM packet_documents ORDER BY packet_id, revision LIMIT 1;",
  );
  const packet = JSON.parse(Buffer.from(stdout.trim(), "hex").toString("utf8"));
  const originalIdentity = [packet.packet_id, packet.revision];
  mutate(packet);
  assert.deepEqual(
    [packet.packet_id, packet.revision],
    originalIdentity,
    "the adversarial packet must retain its authenticated row identity",
  );
  const canonicalData = canonicalJSONData(packet);
  const storageKey = await readFile(workspace.keyPath);
  const mac = packetAuthenticationCode(storageKey, packet, canonicalData);
  await sqlite(workspace.databasePath, `
    UPDATE packet_documents
      SET json = X'${canonicalData.toString("hex")}',
          mac = X'${mac.toString("hex")}'
      WHERE packet_id = ${sqlLiteral(packet.packet_id)}
        AND revision = ${packet.revision};
  `);
  return packet;
}

async function forgeStoredDispatchAction(workspace, batch, actionID) {
  const storageKey = await readFile(workspace.keyPath);
  const dispatch = structuredClone(batch.events.find((event) => (
    event.event_type === "continuation_dispatched"
  )));
  const verification = structuredClone(batch.verification);
  dispatch.payload.action_id = actionID;
  verification.action_id = actionID;

  const { stdout: previousMACOutput } = await sqlite(
    workspace.databasePath,
    `SELECT hex(prev_mac) FROM runtime_events WHERE event_id=${sqlLiteral(dispatch.event_id)};`,
  );
  const previousMAC = Buffer.from(previousMACOutput.trim(), "hex");
  assert.equal(previousMAC.length, 32, "dispatch previous MAC is missing");
  const dispatchJSON = canonicalJSONData(dispatch);
  const dispatchIdentity = `${dispatch.event_sequence}:${Buffer.byteLength(dispatch.event_id, "utf8")}:${dispatch.event_id}`;
  const dispatchMAC = authenticationCode(
    storageKey,
    "blabee.runtime-event.v1",
    dispatchIdentity,
    Buffer.concat([previousMAC, dispatchJSON]),
  );
  const anchorMAC = authenticationCode(
    storageKey,
    "blabee.runtime-event-anchor.v1",
    `sequence:${dispatch.event_sequence}`,
    dispatchMAC,
  );

  const verificationJSON = canonicalJSONData(verification);
  const verificationIdentity = `${Buffer.byteLength(verification.continuation_id, "utf8")}:${verification.continuation_id}`;
  const verificationMAC = authenticationCode(
    storageKey,
    "blabee.verification-record.v1",
    verificationIdentity,
    verificationJSON,
  );

  await sqlite(workspace.databasePath, `
    BEGIN IMMEDIATE;
    UPDATE runtime_events
      SET json=X'${dispatchJSON.toString("hex")}', mac=X'${dispatchMAC.toString("hex")}'
      WHERE event_id=${sqlLiteral(dispatch.event_id)};
    UPDATE verification_records
      SET json=X'${verificationJSON.toString("hex")}', mac=X'${verificationMAC.toString("hex")}'
      WHERE continuation_id=${sqlLiteral(verification.continuation_id)};
    UPDATE coordinator_metadata
      SET value=X'${dispatchMAC.toString("hex")}' WHERE key='event_chain_head';
    UPDATE coordinator_metadata
      SET value=X'${anchorMAC.toString("hex")}' WHERE key='event_chain_anchor';
    COMMIT;
  `);
}

async function removeDatabaseArtifacts(databasePath) {
  for (const { filename } of await existingDatabaseArtifacts(databasePath)) {
    await unlink(filename);
  }
}

async function checkpointAndCopyDatabase(databasePath, destinationPath) {
  await sqlite(databasePath, "PRAGMA wal_checkpoint(TRUNCATE);");
  await cp(databasePath, destinationPath);
}

async function restoreDatabaseSnapshot(databasePath, snapshotPath) {
  await removeDatabaseArtifacts(databasePath);
  await cp(snapshotPath, databasePath);
}

async function assertPathMissing(filename, label) {
  await assert.rejects(
    access(filename),
    (error) => error?.code === "ENOENT",
    label,
  );
}

async function metadataHex(databasePath, key) {
  const { stdout } = await sqlite(
    databasePath,
    `SELECT hex(value) FROM coordinator_metadata WHERE key=${sqlLiteral(key)};`,
  );
  assert.match(stdout.trim(), /^[0-9A-F]+$/, `missing metadata ${key}`);
  return stdout.trim();
}

async function captureArtifactsAroundClose(client, workspace, output) {
  try {
    output.push(...await existingDatabaseArtifacts(workspace.databasePath));
  } finally {
    await client.close();
    output.push(...await existingDatabaseArtifacts(workspace.databasePath));
  }
}

function rawAppendRequest(requestID, expectedSequenceLiteral, suffix) {
  return [
    `{"request_id":${JSON.stringify(requestID)},"op":"append",`,
    `"expected_sequence":${expectedSequenceLiteral},`,
    `"events":[${JSON.stringify(openEvent(1, suffix))}],`,
    '"documents":[],"verification_records":[]}',
  ].join("");
}

test(
  "Swift runtime builds outside the repository and persists a hardened SQLite journal",
  { timeout: 300_000 },
  async () => {
    const build = await buildCoordinator();
    assert.ok(build.scratchPath.startsWith(`${path.resolve("/tmp")}${path.sep}`));
    assert.ok(build.binaryPath.startsWith(`${build.scratchPath}${path.sep}`));

    const workspace = await createPersistenceWorkspace("smoke");
    const client = await launchCoordinator(workspace);
    try {
      const initialized = await initialize(client);
      assert.equal(initialized.journal_sequence, 0);
      assert.equal(initialized.sqlite.journal_mode.toLowerCase(), "wal");
      assert.equal(initialized.sqlite.synchronous.toLowerCase(), "full");
      assert.equal(initialized.sqlite.foreign_keys, true);
      assert.equal(initialized.sqlite.integrity_check, "ok");

      const health = assertOk(await client.request({ op: "health" }), "health");
      assert.equal(health.schema_version, 1);
      assert.equal(health.journal_sequence, 0);
      assert.equal(health.sqlite.journal_mode.toLowerCase(), "wal");
      assert.equal(health.sqlite.synchronous.toLowerCase(), "full");
      assert.equal(health.sqlite.foreign_keys, true);
      assert.equal(health.sqlite.integrity_check, "ok");

      const diagnostics = assertOk(
        await client.request({ op: "diagnostics" }),
        "diagnostics",
      );
      assert.equal(diagnostics.database_configured, true);
      assert.equal(diagnostics.key_configured, true);
      assert.equal("database_path" in diagnostics, false);
      assert.equal("key_path" in diagnostics, false);
      assert.equal(diagnostics.schema_version, 1);
      assert.equal(diagnostics.sqlite.journal_mode.toLowerCase(), "wal");
      assert.equal(diagnostics.sqlite.synchronous.toLowerCase(), "full");
      assert.equal(diagnostics.sqlite.foreign_keys, true);

      const event = openEvent(1, "smoke");
      const appended = assertOk(await client.request({
        op: "append",
        expected_sequence: 0,
        events: [event],
        documents: [],
        verification_records: [],
      }), "append");
      assert.deepEqual(appended, {
        event_count: 1,
        first_sequence: 1,
        last_sequence: 1,
      });

      const loaded = assertOk(await client.request({ op: "load" }), "load");
      assert.equal(loaded.journal_sequence, 1);
      assert.deepEqual(loaded.events, [event]);
      assert.deepEqual(loaded.documents, []);
      assert.deepEqual(loaded.verification_records, []);

      const integrity = assertOk(await client.request({ op: "integrity" }), "integrity");
      assert.equal(integrity.integrity_check, "ok");
      assert.equal(integrity.quick_check, "ok");
      assert.equal(integrity.sidecars_verified, 0);
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  },
);

test("fresh Keychain bootstrap survives a coordinator restart", async () => {
  const workspace = await createPersistenceWorkspace("freshness-bootstrap");
  let first;
  let restarted;
  try {
    first = await launchCoordinator(workspace);
    await initialize(first);
    const event = openEvent(1, "freshness_bootstrap");
    assertOk(await first.request({
      op: "append",
      expected_sequence: 0,
      events: [event],
      documents: [],
      verification_records: [],
    }));
    await first.close();

    restarted = await launchCoordinator(workspace);
    const loaded = assertOk(await restarted.request({ op: "load" }), "freshness restart");
    assert.equal(loaded.journal_sequence, 1);
    assert.deepEqual(loaded.events, [event]);
  } finally {
    await first?.close();
    await restarted?.close();
    await workspace.cleanup();
  }
});

test("an authentic older database snapshot is rejected while the same key remains", async () => {
  const workspace = await createPersistenceWorkspace("freshness-rollback");
  const snapshotPath = path.join(workspace.directory, "sequence-one.sqlite3");
  let first;
  let second;
  try {
    first = await launchCoordinator(workspace);
    await initialize(first);
    assertOk(await first.request({
      op: "append",
      expected_sequence: 0,
      events: [openEvent(1, "freshness_snapshot_one")],
      documents: [],
      verification_records: [],
    }));
    await first.close();
    await checkpointAndCopyDatabase(workspace.databasePath, snapshotPath);

    second = await launchCoordinator(workspace);
    assertOk(await second.request({
      op: "append",
      expected_sequence: 1,
      events: [openEvent(2, "freshness_snapshot_two")],
      documents: [],
      verification_records: [],
    }));
    await second.close();

    await restoreDatabaseSnapshot(workspace.databasePath, snapshotPath);
    assertError(
      await requestLoad(workspace),
      "freshness_rollback_detected",
      "authentic database rollback",
    );
  } finally {
    await first?.close();
    await second?.close();
    await workspace.cleanup();
  }
});

test("freshness rollback is rejected before an older snapshot event row is replayed", async () => {
  const workspace = await createPersistenceWorkspace("freshness-before-replay");
  const snapshotPath = path.join(workspace.directory, "older.sqlite3");
  let first;
  let second;
  try {
    first = await launchCoordinator(workspace);
    await initialize(first);
    assertOk(await first.request({
      op: "append",
      expected_sequence: 0,
      events: [openEvent(1, "freshness_before_replay_one")],
      documents: [],
      verification_records: [],
    }));
    await first.close();
    await checkpointAndCopyDatabase(workspace.databasePath, snapshotPath);

    second = await launchCoordinator(workspace);
    assertOk(await second.request({
      op: "append",
      expected_sequence: 1,
      events: [openEvent(2, "freshness_before_replay_two")],
      documents: [],
      verification_records: [],
    }));
    await second.close();

    await restoreDatabaseSnapshot(workspace.databasePath, snapshotPath);
    await sqlite(
      workspace.databasePath,
      "UPDATE runtime_events SET mac=zeroblob(32) WHERE event_sequence=1;",
    );
    assertError(
      await requestLoad(workspace),
      "freshness_rollback_detected",
      "freshness-before-event-replay precedence",
    );
  } finally {
    await first?.close();
    await second?.close();
    await workspace.cleanup();
  }
});

test("a surviving Keychain anchor rejects deleted database and key without recreating them", async () => {
  const workspace = await createPersistenceWorkspace("freshness-storage-loss");
  try {
    await seedEventChain(workspace, 1);
    await removeDatabaseArtifacts(workspace.databasePath);
    await unlink(workspace.keyPath);

    assertError(
      await requestLoad(workspace),
      "freshness_storage_missing",
      "database and key loss",
    );
    assert.deepEqual(
      await existingDatabaseArtifacts(workspace.databasePath),
      [],
      "failed bootstrap recreated a database artifact",
    );
    await assert.rejects(
      readFile(workspace.keyPath),
      (error) => error?.code === "ENOENT",
      "failed bootstrap recreated the storage key",
    );
  } finally {
    await workspace.cleanup();
  }
});

test("committed and pending anchors reject a deleted key parent without recreating storage", async () => {
  for (const state of ["committed", "pending"]) {
    const workspace = await createPersistenceWorkspace(`freshness-parent-loss-${state}`);
    let client;
    try {
      client = await launchCoordinator(workspace, state === "pending" ? {
        environmentOverrides: { BLABEE_T007B_ENABLE_CRASH_INJECTION: "1" },
      } : {});
      await initialize(client);
      const event = openEvent(1, `freshness_parent_loss_${state}`);
      if (state === "pending") {
        await assert.rejects(
          client.request({
            op: "append",
            expected_sequence: 0,
            events: [event],
            documents: [],
            verification_records: [],
            crash_point: "after_freshness_pending_before_sqlite_commit",
          }),
          /exited before responding/,
        );
        assert.deepEqual(await client.exit, { code: 87, signal: null });
      } else {
        assertOk(await client.request({
          op: "append",
          expected_sequence: 0,
          events: [event],
          documents: [],
          verification_records: [],
        }));
        await client.close();
      }

      await removeDatabaseArtifacts(workspace.databasePath);
      await rm(workspace.keyDirectory, { force: true, recursive: true });
      await assertPathMissing(
        workspace.keyDirectory,
        `${state} setup did not remove the key parent`,
      );
      assertError(
        await requestLoad(workspace),
        "freshness_storage_missing",
        `${state} anchor with deleted key parent`,
      );
      await assertPathMissing(
        workspace.keyDirectory,
        `${state} failure recreated the key parent or lock`,
      );
      assert.deepEqual(
        await existingDatabaseArtifacts(workspace.databasePath),
        [],
        `${state} failure recreated the database`,
      );
    } finally {
      await client?.close();
      await workspace.cleanup();
    }
  }
});

test("an existing database and key without their Keychain anchor fail closed", async () => {
  const workspace = await createPersistenceWorkspace("freshness-anchor-missing");
  try {
    await seedEventChain(workspace, 1);
    await deleteKeychainTestAnchor(workspace);
    assertError(
      await requestLoad(workspace),
      "freshness_anchor_missing",
      "missing Keychain anchor",
    );
    assert.equal((await existingDatabaseArtifacts(workspace.databasePath)).length > 0, true);
    assert.equal((await readFile(workspace.keyPath)).length, 32);
  } finally {
    await workspace.cleanup();
  }
});

test("startup requires the pinned Contracts/v1 directory", async () => {
  const workspace = await createPersistenceWorkspace("contract-pin");
  try {
    await assertBootstrapFailure(
      workspace,
      workspace.keyPath,
      "invalid_arguments",
      path.join(workspace.directory, "missing-argument.sqlite3"),
      { contractsPath: null },
    );
    await assertBootstrapFailure(
      workspace,
      workspace.keyPath,
      "contract_pin_mismatch",
      path.join(workspace.directory, "wrong-pin.sqlite3"),
      { contractsPath: path.join(workspace.directory, "not-contracts-v1") },
    );
    const tamperedContracts = path.join(workspace.directory, "tampered-contracts-v1");
    await cp(CONTRACTS_ROOT, tamperedContracts, { recursive: true });
    await appendFile(
      path.join(tamperedContracts, "runtime-event.schema.json"),
      "\n",
      "utf8",
    );
    await assertBootstrapFailure(
      workspace,
      workspace.keyPath,
      "contract_pin_mismatch",
      path.join(workspace.directory, "tampered-pin.sqlite3"),
      { contractsPath: tamperedContracts },
    );
  } finally {
    await workspace.cleanup();
  }
});

test("stale CAS and strict-ingress failures leave the committed sequence unchanged", async () => {
  const workspace = await createPersistenceWorkspace("cas");
  const client = await launchCoordinator(workspace);
  try {
    await initialize(client);
    const committed = openEvent(1, "cas_committed");
    assertOk(await client.request({
      op: "append",
      expected_sequence: 0,
      events: [committed],
      documents: [],
      verification_records: [],
    }));

    const stale = await client.request({
      op: "append",
      expected_sequence: 0,
      events: [openEvent(2, "cas_stale")],
      documents: [],
      verification_records: [],
    });
    assertError(stale, "journal_sequence_conflict", "stale append");

    const invalid = openEvent(2, "cas_invalid");
    invalid.unexpected_field = "must fail closed";
    const invalidResult = await client.request({
      op: "append",
      expected_sequence: 1,
      events: [invalid],
      documents: [],
      verification_records: [],
    });
    assertError(invalidResult, "contract_validation_failed", "invalid append");

    const loaded = assertOk(await client.request({ op: "load" }));
    assert.equal(loaded.journal_sequence, 1);
    assert.deepEqual(loaded.events, [committed]);
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});

test("append rejects each protected schema-valid packet-to-lifecycle binding substitution", async () => {
  const workspace = await createPersistenceWorkspace("packet-binding-append");
  const client = await launchCoordinator(workspace);
  try {
    await initialize(client);
    const suite = await contractSuitePromise;
    const validatePacket = suite.compiled.validatorsByName.get("decision_packet");
    for (const [field, mutate] of packetBindingMutations) {
      const batch = sidecarBatch(0, `binding_append_${field}`);
      mutate(batch.packet);
      assert.equal(
        validatePacket(batch.packet),
        true,
        `${field} adversarial packet must remain schema-valid: ${formatAjvErrors(validatePacket.errors)}`,
      );
      const rejected = await client.request({
        op: "append",
        expected_sequence: 0,
        events: batch.events,
        documents: batch.documents,
        verification_records: batch.verification_records,
      });
      assertError(
        rejected,
        "packet_document_integrity_mismatch",
        `${field} append binding substitution`,
      );
      const loaded = assertOk(await client.request({ op: "load" }), `${field} rollback load`);
      assert.equal(loaded.journal_sequence, 0, `${field} append was not atomic`);
      assert.deepEqual(loaded.documents, [], `${field} packet escaped rollback`);
    }
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});

test("restart rejects each protected valid-MAC packet-to-lifecycle binding substitution", async () => {
  const suite = await contractSuitePromise;
  const validatePacket = suite.compiled.validatorsByName.get("decision_packet");
  const controlWorkspace = await createPersistenceWorkspace("packet-valid-mac-control");
  try {
    await seedSidecars(controlWorkspace);
    const controlPacket = await replaceStoredPacketWithAuthenticatedMutation(
      controlWorkspace,
      (packet) => { packet.summary = "Fictional authenticated non-binding control"; },
    );
    const controlLoad = assertOk(await requestLoad(controlWorkspace), "valid packet MAC control");
    assert.equal(controlLoad.documents[0].summary, controlPacket.summary);
  } finally {
    await controlWorkspace.cleanup();
  }
  for (const [field, mutate] of packetBindingMutations) {
    const workspace = await createPersistenceWorkspace(`packet-binding-load-${field}`);
    try {
      await seedSidecars(workspace);
      const packet = await replaceStoredPacketWithAuthenticatedMutation(workspace, mutate);
      assert.equal(
        validatePacket(packet),
        true,
        `${field} persisted mutation must remain schema-valid: ${formatAjvErrors(validatePacket.errors)}`,
      );
      assertError(
        await requestLoad(workspace),
        "packet_document_integrity_mismatch",
        `${field} restart binding substitution`,
      );
    } finally {
      await workspace.cleanup();
    }
  }
});

test("selected choice action remains the sealed truth even when dispatch and verification agree on a forgery", async () => {
  const appendWorkspace = await createPersistenceWorkspace("choice-action-append");
  const appendClient = await launchCoordinator(appendWorkspace);
  try {
    await initialize(appendClient);
    const batch = sidecarBatch(0, "choice_action_append");
    const forgedActionID = batch.packet.choices[1].action_id;
    batch.events.find((event) => (
      event.event_type === "continuation_dispatched"
    )).payload.action_id = forgedActionID;
    batch.verification.action_id = forgedActionID;
    assertError(
      await appendClient.request({
        op: "append",
        expected_sequence: 0,
        events: batch.events,
        documents: batch.documents,
        verification_records: batch.verification_records,
      }),
      "packet_document_integrity_mismatch",
      "forged selected action append",
    );
    assert.equal(assertOk(await appendClient.request({ op: "load" })).journal_sequence, 0);
  } finally {
    await appendClient.close();
    await appendWorkspace.cleanup();
  }

  const restartWorkspace = await createPersistenceWorkspace("choice-action-restart");
  try {
    const [batch] = await seedSidecars(restartWorkspace);
    const forgedActionID = batch.packet.choices[1].action_id;
    await forgeStoredDispatchAction(restartWorkspace, batch, forgedActionID);
    assertError(
      await requestLoad(restartWorkspace),
      "freshness_rollback_detected",
      "authenticated forged selected action restart",
    );
  } finally {
    await restartWorkspace.cleanup();
  }
});

test("a committed packet boundary rejects sequential selection claims before changing the journal", async () => {
  const workspace = await createPersistenceWorkspace("selection-already-claimed");
  const client = await launchCoordinator(workspace);
  try {
    await initialize(client);
    const original = sidecarBatch(0, "selection_original");
    assertOk(await client.request({
      op: "append",
      expected_sequence: 0,
      events: original.events,
      documents: original.documents,
      verification_records: original.verification_records,
    }), "original selection append");
    const committed = assertOk(await client.request({ op: "load" }), "original selection load");
    assert.equal(committed.journal_sequence, 4);

    const claims = [
      [
        "different_enabled_option",
        repeatedSelectionBatch(4, original, "different_enabled_option", 1),
      ],
      [
        "same_option_new_event_ids",
        repeatedSelectionBatch(4, original, "same_option_new_event_ids", 0),
      ],
      [
        "revision_bump_same_boundary",
        revisionBumpSelectionBatch(4, original, "revision_bump_same_boundary"),
      ],
    ];
    for (const [name, repeated] of claims) {
      assertError(
        await client.request({
          op: "append",
          expected_sequence: 4,
          events: repeated.events,
          documents: repeated.documents,
          verification_records: repeated.verification_records,
        }),
        "selection_already_claimed",
        name,
      );
      assert.deepEqual(
        assertOk(await client.request({ op: "load" }), `${name} load`),
        committed,
        `${name} changed the previously committed journal`,
      );
      const integrity = assertOk(
        await client.request({ op: "integrity" }),
        `${name} integrity`,
      );
      assert.equal(integrity.integrity_check, "ok");
      assert.equal(integrity.quick_check, "ok");
      assert.equal(integrity.sidecars_verified, 2);
    }
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});

test("two processes racing different selections for one sealed packet commit exactly one claim", async () => {
  const workspace = await createPersistenceWorkspace("selection-race");
  const first = await launchCoordinator(workspace);
  let second;
  try {
    try {
      await initialize(first);
      const packet = sidecarBatch(0, "selection_race_packet");
      assertOk(await first.request({
        op: "append",
        expected_sequence: 0,
        events: packet.events.slice(0, 2),
        documents: packet.documents,
        verification_records: [],
      }), "sealed packet setup");

      second = await launchCoordinator(workspace);
      assert.equal(assertOk(await second.request({ op: "health" })).journal_sequence, 2);
      const recommended = repeatedSelectionBatch(2, packet, "selection_race_recommended", 0);
      const alternative = repeatedSelectionBatch(2, packet, "selection_race_alternative", 1);
      const [left, right] = await Promise.all([
        first.request({
          op: "append",
          expected_sequence: 2,
          events: recommended.events,
          documents: recommended.documents,
          verification_records: recommended.verification_records,
        }),
        second.request({
          op: "append",
          expected_sequence: 2,
          events: alternative.events,
          documents: alternative.documents,
          verification_records: alternative.verification_records,
        }),
      ]);
      const winners = [left, right].filter((response) => response.ok === true);
      const losers = [left, right].filter((response) => response.ok === false);
      assert.equal(winners.length, 1, "selection race did not produce exactly one winner");
      assert.equal(losers.length, 1, "selection race did not produce exactly one loser");
      assertError(losers[0], "journal_sequence_conflict", "selection race loser");

      const loaded = assertOk(await first.request({ op: "load" }), "selection race load");
      assert.equal(loaded.journal_sequence, 4);
      const selections = loaded.events.filter((event) => (
        event.event_type === "decision_selection_claimed"
      ));
      assert.equal(selections.length, 1);
      assert.ok([
        packet.packet.choices[0].option_id,
        packet.packet.choices[1].option_id,
      ].includes(selections[0].payload.option_id));
      assert.equal(loaded.verification_records.length, 1);
      const integrity = assertOk(await first.request({ op: "integrity" }));
      assert.equal(integrity.integrity_check, "ok");
      assert.equal(integrity.quick_check, "ok");
      assert.equal(integrity.sidecars_verified, 2);
    } finally {
      await Promise.all([first.close(), second?.close()]);
    }

    const restarted = await launchCoordinator(workspace);
    try {
      const loaded = assertOk(await restarted.request({ op: "load" }), "selection race restart");
      assert.equal(loaded.journal_sequence, 4);
      assert.equal(
        loaded.events.filter((event) => event.event_type === "decision_selection_claimed").length,
        1,
      );
      assert.equal(assertOk(await restarted.request({ op: "integrity" })).sidecars_verified, 2);
    } finally {
      await restarted.close();
    }
  } finally {
    await workspace.cleanup();
  }
});

test("two independent processes racing the same expected sequence commit exactly one batch", async () => {
  const workspace = await createPersistenceWorkspace("race");
  const first = await launchCoordinator(workspace);
  let second;
  let restarted;
  try {
    await initialize(first);
    second = await launchCoordinator(workspace);
    assertOk(await second.request({ op: "health" }));
    const [left, right] = await Promise.all([
      first.request({
        op: "append",
        expected_sequence: 0,
        events: [openEvent(1, "race_left")],
        documents: [],
        verification_records: [],
      }),
      second.request({
        op: "append",
        expected_sequence: 0,
        events: [openEvent(1, "race_right")],
        documents: [],
        verification_records: [],
      }),
    ]);
    const winners = [left, right].filter((response) => response.ok === true);
    const losers = [left, right].filter((response) => response.ok === false);
    assert.equal(winners.length, 1, JSON.stringify([left, right]));
    assert.equal(losers.length, 1, JSON.stringify([left, right]));
    assertError(losers[0], "journal_sequence_conflict", "race loser");

    const loaded = assertOk(await first.request({ op: "load" }));
    assert.equal(loaded.journal_sequence, 1);
    assert.equal(loaded.events.length, 1);
    assert.ok([
      "event_persistence_open_race_left",
      "event_persistence_open_race_right",
    ].includes(loaded.events[0].event_id));
    await Promise.all([first.close(), second.close()]);

    restarted = await launchCoordinator(workspace);
    const recovered = assertOk(await restarted.request({ op: "load" }), "race restart");
    assert.equal(recovered.journal_sequence, 1);
    assert.deepEqual(recovered.events, loaded.events);
  } finally {
    await Promise.all([first.close(), second?.close(), restarted?.close()]);
    await workspace.cleanup();
  }
});

test("product NDJSON rejects crash injection unless the test-only environment gate is exact", async () => {
  const workspace = await createPersistenceWorkspace("crash-gate");
  try {
    const gateCases = [
      ["absent", {}],
      ["zero", { BLABEE_T007B_ENABLE_CRASH_INJECTION: "0" }],
      ["truthy", { BLABEE_T007B_ENABLE_CRASH_INJECTION: "true" }],
      ["leading_zero", { BLABEE_T007B_ENABLE_CRASH_INJECTION: "01" }],
      ["whitespace", { BLABEE_T007B_ENABLE_CRASH_INJECTION: " 1" }],
    ];
    for (const [name, environmentOverrides] of gateCases) {
      const client = await launchCoordinator(workspace, { environmentOverrides });
      try {
        if (name === "absent") await initialize(client);
        const response = await client.request({
          op: "append",
          expected_sequence: 0,
          events: [openEvent(1, `crash_gate_${name}`)],
          documents: [],
          verification_records: [],
          crash_point: "before_commit",
        });
        assertError(response, "invalid_request", `${name} crash injection gate`);
        assert.equal(assertOk(await client.request({ op: "load" })).journal_sequence, 0);
      } finally {
        await client.close();
      }
    }
  } finally {
    await workspace.cleanup();
  }
});

test("Keychain test cleanup cannot target an ungated namespace or the primary account", async () => {
  const workspace = await createPersistenceWorkspace("keychain-cleanup-gate");
  const cases = [
    {
      name: "missing exact gate",
      environmentOverrides: {
        BLABEE_T007B_KEYCHAIN_ACCOUNT: workspace.freshnessAccount,
        BLABEE_T007B_DELETE_KEYCHAIN_TEST_ANCHOR: "1",
      },
    },
    {
      name: "primary account",
      environmentOverrides: {
        BLABEE_T007B_ENABLE_KEYCHAIN_TEST_NAMESPACE: "1",
        BLABEE_T007B_KEYCHAIN_ACCOUNT: "primary",
        BLABEE_T007B_DELETE_KEYCHAIN_TEST_ANCHOR: "1",
      },
    },
  ];
  try {
    for (const { environmentOverrides, name } of cases) {
      const client = await launchCoordinator(workspace, {
        environmentOverrides,
        freshnessAccount: null,
      });
      try {
        assert.deepEqual(await client.exit, { code: 1, signal: null }, name);
        assert.ok(
          structuredLogCodes(client.stderrText).includes("invalid_arguments"),
          `${name} did not fail with invalid_arguments`,
        );
      } finally {
        await client.close();
      }
    }
  } finally {
    await workspace.cleanup();
  }
});

test("pending-before-commit blocks reads and permits only the exact batch retry", async () => {
  const workspace = await createPersistenceWorkspace("crash-before");
  let crashing;
  let restarted;
  let killed;
  try {
    crashing = await launchCoordinator(workspace, {
      environmentOverrides: { BLABEE_T007B_ENABLE_CRASH_INJECTION: "1" },
    });
    await initialize(crashing);
    const pendingEvent = openEvent(1, "before_commit");
    await assert.rejects(
      crashing.request({
        op: "append",
        expected_sequence: 0,
        events: [pendingEvent],
        documents: [],
        verification_records: [],
        crash_point: "after_freshness_pending_before_sqlite_commit",
      }),
      /exited before responding/,
    );
    assert.deepEqual(await crashing.exit, { code: 87, signal: null });

    restarted = await launchCoordinator(workspace);
    for (const op of ["health", "load", "integrity"]) {
      assertError(
        await restarted.request({ op }),
        "freshness_transition_pending",
        `${op} during pending transition`,
      );
    }
    assertError(await restarted.request({
      op: "append",
      expected_sequence: 0,
      events: [openEvent(1, "different_pending_batch")],
      documents: [],
      verification_records: [],
    }), "freshness_transition_pending", "different pending batch");
    assertOk(await restarted.request({
      op: "append",
      expected_sequence: 0,
      events: [pendingEvent],
      documents: [],
      verification_records: [],
    }), "exact pending batch retry");
    let loaded = assertOk(await restarted.request({ op: "load" }));
    assert.equal(loaded.journal_sequence, 1);
    assert.deepEqual(loaded.events, [pendingEvent]);
    await restarted.close();

    killed = await launchCoordinator(workspace);
    assert.equal(assertOk(await killed.request({ op: "health" })).journal_sequence, 1);
    const killResult = await killed.kill("SIGKILL");
    assert.equal(killResult.signal, "SIGKILL");

    const recovered = await launchCoordinator(workspace);
    try {
      loaded = assertOk(await recovered.request({ op: "load" }));
      assert.equal(loaded.journal_sequence, 1);
      assert.equal(loaded.events[0].event_id, pendingEvent.event_id);
    } finally {
      await recovered.close();
    }
  } finally {
    await crashing?.close();
    await restarted?.close();
    await killed?.close();
    await workspace.cleanup();
  }
});

test("post-commit pre-finalize restart authenticates the target and finalizes the anchor", async () => {
  const workspace = await createPersistenceWorkspace("crash-pre-finalize");
  const targetSnapshot = path.join(workspace.directory, "pending-target.sqlite3");
  let crashing;
  let restarted;
  let verifiedRestart;
  try {
    crashing = await launchCoordinator(workspace, {
      environmentOverrides: { BLABEE_T007B_ENABLE_CRASH_INJECTION: "1" },
    });
    await initialize(crashing);
    const event = openEvent(1, "after_sqlite_commit_before_freshness_finalize");
    await assert.rejects(
      crashing.request({
        op: "append",
        expected_sequence: 0,
        events: [event],
        documents: [],
        verification_records: [],
        crash_point: "after_sqlite_commit_before_freshness_finalize",
      }),
      /exited before responding/,
    );
    assert.deepEqual(await crashing.exit, { code: 88, signal: null });

    await checkpointAndCopyDatabase(workspace.databasePath, targetSnapshot);
    await sqlite(
      workspace.databasePath,
      "UPDATE runtime_events SET mac=zeroblob(32) WHERE event_sequence=1;",
    );
    assertError(
      await requestLoad(workspace),
      "runtime_event_integrity_mismatch",
      "pending target replay failure",
    );
    assert.equal(
      JSON.parse((await readKeychainTestAnchor(workspace)).toString("utf8")).state,
      "pending",
      "pending target was finalized before authenticated replay completed",
    );
    await restoreDatabaseSnapshot(workspace.databasePath, targetSnapshot);

    restarted = await launchCoordinator(workspace);
    const loaded = assertOk(await restarted.request({ op: "load" }), "pending target recovery");
    assert.equal(loaded.journal_sequence, 1);
    assert.deepEqual(loaded.events, [event]);
    await restarted.close();
    assert.equal(
      JSON.parse((await readKeychainTestAnchor(workspace)).toString("utf8")).state,
      "committed",
      "authenticated pending target did not finalize",
    );

    verifiedRestart = await launchCoordinator(workspace);
    assert.equal(
      assertOk(await verifiedRestart.request({ op: "health" })).journal_sequence,
      1,
      "finalized high-water did not survive another restart",
    );
    assertError(await verifiedRestart.request({
      op: "append",
      expected_sequence: 0,
      events: [event],
      documents: [],
      verification_records: [],
    }), "journal_sequence_conflict", "post-commit retry");
  } finally {
    await crashing?.close();
    await restarted?.close();
    await verifiedRestart?.close();
    await workspace.cleanup();
  }
});

test("after_commit_before_response is durable and the caller cannot safely retry", async () => {
  const workspace = await createPersistenceWorkspace("crash-after");
  let crashing;
  let restarted;
  try {
    crashing = await launchCoordinator(workspace, {
      environmentOverrides: { BLABEE_T007B_ENABLE_CRASH_INJECTION: "1" },
    });
    await initialize(crashing);
    const event = openEvent(1, "after_commit");
    await assert.rejects(
      crashing.request({
        op: "append",
        expected_sequence: 0,
        events: [event],
        documents: [],
        verification_records: [],
        crash_point: "after_commit_before_response",
      }),
      /exited before responding/,
    );
    assert.deepEqual(await crashing.exit, { code: 86, signal: null });

    restarted = await launchCoordinator(workspace);
    const loaded = assertOk(await restarted.request({ op: "load" }));
    assert.equal(loaded.journal_sequence, 1);
    assert.deepEqual(loaded.events, [event]);

    const unsafeRetry = await restarted.request({
      op: "append",
      expected_sequence: 0,
      events: [event],
      documents: [],
      verification_records: [],
    });
    assertError(unsafeRetry, "journal_sequence_conflict", "ambiguous commit retry");
    assert.equal(assertOk(await restarted.request({ op: "load" })).events.length, 1);
  } finally {
    await crashing?.close();
    await restarted?.close();
    await workspace.cleanup();
  }
});

test("runtime event MAC chain rejects truth-source mutation and deletion", async (t) => {
  await t.test("schema-valid event JSON mutation fails authentication", async () => {
    const workspace = await createPersistenceWorkspace("event-json-tamper");
    try {
      await seedEventChain(workspace);
      await sqlite(workspace.databasePath, `
        UPDATE runtime_events
          SET json = replace(
            CAST(json AS TEXT),
            'proposal_persistence_event_chain_1',
            'proposal_persistence_event_chain_x'
          )
          WHERE event_sequence = 1;
      `);
      assertError(
        await requestLoad(workspace),
        "runtime_event_integrity_mismatch",
        "mutated event JSON",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("event row MAC mutation fails authentication", async () => {
    const workspace = await createPersistenceWorkspace("event-mac-tamper");
    try {
      await seedEventChain(workspace);
      await sqlite(
        workspace.databasePath,
        "UPDATE runtime_events SET mac = zeroblob(32) WHERE event_sequence = 1;",
      );
      assertError(
        await requestLoad(workspace),
        "runtime_event_integrity_mismatch",
        "mutated event MAC",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("previous-MAC chain mutation fails authentication", async () => {
    const workspace = await createPersistenceWorkspace("event-chain-tamper");
    try {
      await seedEventChain(workspace);
      await sqlite(
        workspace.databasePath,
        "UPDATE runtime_events SET prev_mac = zeroblob(32) WHERE event_sequence = 2;",
      );
      assertError(
        await requestLoad(workspace),
        "runtime_event_integrity_mismatch",
        "mutated previous MAC",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("middle-event deletion cannot produce a valid replay prefix", async () => {
    const workspace = await createPersistenceWorkspace("event-delete");
    try {
      await seedEventChain(workspace);
      await sqlite(
        workspace.databasePath,
        "DELETE FROM runtime_events WHERE event_sequence = 2;",
      );
      assertError(
        await requestLoad(workspace),
        "runtime_event_integrity_mismatch",
        "deleted middle event",
      );
    } finally {
      await workspace.cleanup();
    }
  });
});

test("an existing key never permits a missing or zero-byte database to reinitialize at sequence zero", async () => {
  for (const mode of ["deleted", "zero_byte"]) {
    const workspace = await createPersistenceWorkspace(`database-pair-${mode}`);
    try {
      await seedEventChain(workspace, 1);
      if (mode === "deleted") {
        await removeDatabaseArtifacts(workspace.databasePath);
      } else {
        for (const { filename } of await existingDatabaseArtifacts(workspace.databasePath)) {
          if (filename !== workspace.databasePath) await unlink(filename);
        }
        await truncate(workspace.databasePath, 0);
      }
      await assertBootstrapFailure(
        workspace,
        workspace.keyPath,
        "freshness_storage_missing",
        workspace.databasePath,
      );
    } finally {
      await workspace.cleanup();
    }
  }
});

test("SQLite schema allowlisting rejects added tables, indexes, views, triggers, and columns", async () => {
  const schemaMutations = [
    ["extra_table", "CREATE TABLE attacker_extra_table(value TEXT);"],
    ["extra_index", "CREATE INDEX attacker_extra_index ON runtime_events(event_id);"],
    ["extra_view", "CREATE VIEW attacker_extra_view AS SELECT event_id FROM runtime_events;"],
    [
      "extra_trigger",
      "CREATE TRIGGER attacker_extra_trigger AFTER INSERT ON runtime_events BEGIN SELECT 1; END;",
    ],
    ["extra_column", "ALTER TABLE packet_documents ADD COLUMN attacker_extra_column BLOB;"],
  ];
  for (const [name, SQL] of schemaMutations) {
    const workspace = await createPersistenceWorkspace(`schema-${name}`);
    try {
      await seedEventChain(workspace, 1);
      await sqlite(workspace.databasePath, SQL);
      assertError(
        await requestLoad(workspace),
        "schema_version_mismatch",
        `${name} schema substitution`,
      );
    } finally {
      await workspace.cleanup();
    }
  }
});

test("a fake-commit trigger that deletes the insert and restores its anchor is never reported as ok", async () => {
  const workspace = await createPersistenceWorkspace("fake-commit-trigger");
  try {
    const client = await launchCoordinator(workspace);
    try {
      await initialize(client);
      const sequence = await metadataHex(workspace.databasePath, "event_chain_sequence");
      const head = await metadataHex(workspace.databasePath, "event_chain_head");
      const anchor = await metadataHex(workspace.databasePath, "event_chain_anchor");
      await sqlite(workspace.databasePath, `
        CREATE TRIGGER attacker_fake_commit
        AFTER UPDATE OF value ON coordinator_metadata
        WHEN NEW.key = 'event_chain_anchor' AND hex(NEW.value) <> '${anchor}'
        BEGIN
          DELETE FROM runtime_events
            WHERE event_sequence = (SELECT MAX(event_sequence) FROM runtime_events);
          UPDATE coordinator_metadata SET value=X'${sequence}' WHERE key='event_chain_sequence';
          UPDATE coordinator_metadata SET value=X'${head}' WHERE key='event_chain_head';
          UPDATE coordinator_metadata SET value=X'${anchor}' WHERE key='event_chain_anchor';
        END;
      `);

      const response = await client.request({
        op: "append",
        expected_sequence: 0,
        events: [openEvent(1, "fake_commit")],
        documents: [],
        verification_records: [],
      });
      assertError(response, "schema_version_mismatch", "fake commit append");
      const { stdout } = await sqlite(
        workspace.databasePath,
        "SELECT COUNT(*) FROM runtime_events;",
      );
      assert.equal(stdout.trim(), "0", "the rejected fake commit left a runtime event");
    } finally {
      await client.close();
    }
    assertError(
      await requestLoad(workspace),
      "schema_version_mismatch",
      "fake commit restart",
    );
  } finally {
    await workspace.cleanup();
  }
});

test("packet and verification sidecars fail closed on tamper, swap, or key loss", async (t) => {
  await t.test("packet JSON tamper invalidates its row-bound MAC", async () => {
    const workspace = await createPersistenceWorkspace("packet-tamper");
    try {
      await seedSidecars(workspace);
      await sqlite(
        workspace.databasePath,
        "UPDATE packet_documents SET json = json || ' ' WHERE rowid = (SELECT min(rowid) FROM packet_documents);",
      );
      assertError(
        await requestLoad(workspace),
        "packet_document_integrity_mismatch",
        "tampered packet",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("verification JSON tamper invalidates its row-bound MAC", async () => {
    const workspace = await createPersistenceWorkspace("verification-tamper");
    try {
      await seedSidecars(workspace);
      await sqlite(
        workspace.databasePath,
        "UPDATE verification_records SET json = json || ' ' WHERE rowid = (SELECT min(rowid) FROM verification_records);",
      );
      assertError(
        await requestLoad(workspace),
        "verification_record_integrity_mismatch",
        "tampered verification",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("packet JSON plus MAC cannot be swapped across row identities", async () => {
    const workspace = await createPersistenceWorkspace("packet-swap");
    try {
      const [first, second] = await seedSidecars(workspace, 2);
      await sqlite(workspace.databasePath, `
        BEGIN IMMEDIATE;
        CREATE TEMP TABLE packet_swap AS
          SELECT packet_id, revision, json, mac FROM packet_documents;
        UPDATE packet_documents
          SET json = (SELECT json FROM packet_swap WHERE packet_id = ${sqlLiteral(second.packet.packet_id)}),
              mac = (SELECT mac FROM packet_swap WHERE packet_id = ${sqlLiteral(second.packet.packet_id)})
          WHERE packet_id = ${sqlLiteral(first.packet.packet_id)};
        UPDATE packet_documents
          SET json = (SELECT json FROM packet_swap WHERE packet_id = ${sqlLiteral(first.packet.packet_id)}),
              mac = (SELECT mac FROM packet_swap WHERE packet_id = ${sqlLiteral(first.packet.packet_id)})
          WHERE packet_id = ${sqlLiteral(second.packet.packet_id)};
        COMMIT;
      `);
      assertError(
        await requestLoad(workspace),
        "packet_document_integrity_mismatch",
        "swapped packets",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("verification JSON plus MAC cannot be swapped across row identities", async () => {
    const workspace = await createPersistenceWorkspace("verification-swap");
    try {
      const [first, second] = await seedSidecars(workspace, 2);
      await sqlite(workspace.databasePath, `
        BEGIN IMMEDIATE;
        CREATE TEMP TABLE verification_swap AS
          SELECT continuation_id, json, mac FROM verification_records;
        UPDATE verification_records
          SET json = (SELECT json FROM verification_swap WHERE continuation_id = ${sqlLiteral(second.verification.continuation_id)}),
              mac = (SELECT mac FROM verification_swap WHERE continuation_id = ${sqlLiteral(second.verification.continuation_id)})
          WHERE continuation_id = ${sqlLiteral(first.verification.continuation_id)};
        UPDATE verification_records
          SET json = (SELECT json FROM verification_swap WHERE continuation_id = ${sqlLiteral(first.verification.continuation_id)}),
              mac = (SELECT mac FROM verification_swap WHERE continuation_id = ${sqlLiteral(first.verification.continuation_id)})
          WHERE continuation_id = ${sqlLiteral(second.verification.continuation_id)};
        COMMIT;
      `);
      assertError(
        await requestLoad(workspace),
        "verification_record_integrity_mismatch",
        "swapped verifications",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  await t.test("a replaced or missing external key never authenticates an existing database", async () => {
    const workspace = await createPersistenceWorkspace("key-loss");
    try {
      await seedSidecars(workspace);
      const replacementKey = await createStorageKey(
        workspace.keyDirectory,
        "replacement.key",
      );
      await assertBootstrapFailure(
        workspace,
        replacementKey,
        "storage_key_invalid",
        workspace.databasePath,
      );
      await assertBootstrapFailure(
        workspace,
        path.join(workspace.keyDirectory, "missing.key"),
        "freshness_storage_missing",
        workspace.databasePath,
      );
      await unlink(workspace.keyPath);
      await assertBootstrapFailure(
        workspace,
        workspace.keyPath,
        "freshness_storage_missing",
        workspace.databasePath,
      );
    } finally {
      await workspace.cleanup();
    }
  });
});

test("storage key path, file mode, and directory mode are fail-closed", async () => {
  const workspace = await createPersistenceWorkspace("key-policy");
  try {
    const seeded = await launchCoordinator(workspace);
    try {
      assert.equal(assertOk(await seeded.request({ op: "health" })).journal_sequence, 0);
    } finally {
      await seeded.close();
    }

    await chmod(workspace.keyPath, 0o644);
    await assertBootstrapFailure(
      workspace,
      workspace.keyPath,
      "storage_key_invalid",
      workspace.databasePath,
    );
    await chmod(workspace.keyPath, 0o600);

    await chmod(workspace.keyDirectory, 0o755);
    await assertBootstrapFailure(
      workspace,
      workspace.keyPath,
      "freshness_lock_unavailable",
      workspace.databasePath,
    );
    await chmod(workspace.keyDirectory, 0o700);

    const symlinkPath = await createKeySymlink(
      workspace.keyPath,
      path.join(workspace.keyDirectory, "linked.key"),
    );
    await assertBootstrapFailure(
      workspace,
      symlinkPath,
      "storage_key_invalid",
      workspace.databasePath,
    );

    const realRoot = path.join(workspace.directory, "real-root");
    const realKeyDirectory = path.join(realRoot, "keys");
    const aliasRoot = path.join(workspace.directory, "alias-root");
    await mkdir(realKeyDirectory, { mode: 0o700, recursive: true });
    await chmod(realRoot, 0o700);
    await chmod(realKeyDirectory, 0o700);
    await symlink(realRoot, aliasRoot);
    const ancestorSymlinkKey = path.join(aliasRoot, "keys", "created.key");
    await assertBootstrapFailure(
      workspace,
      ancestorSymlinkKey,
      "freshness_storage_missing",
      path.join(workspace.directory, "ancestor-symlink.sqlite3"),
    );
    await assert.rejects(
      readFile(ancestorSymlinkKey),
      (error) => error?.code === "ENOENT",
      "a rejected ancestor-symlink path must not create a key",
    );
    const existingAncestorSymlinkKey = await createStorageKey(
      realKeyDirectory,
      "existing.key",
      { bytes: await readFile(workspace.keyPath) },
    );
    await assertBootstrapFailure(
      workspace,
      path.join(aliasRoot, "keys", path.basename(existingAncestorSymlinkKey)),
      "freshness_lock_unavailable",
      workspace.databasePath,
    );

    const client = await launchCoordinator(workspace);
    try {
      assert.equal(assertOk(await client.request({ op: "health" })).journal_sequence, 0);
    } finally {
      await client.close();
    }
  } finally {
    await workspace.cleanup();
  }
});

test("Keychain record contents and test account never reach DB, WAL, SHM, or process output", async () => {
  const workspace = await createPersistenceWorkspace("freshness-secret-scan");
  const client = await launchCoordinator(workspace);
  const observedArtifacts = [];
  let operationError;
  try {
    let keychainRecord;
    try {
      await initialize(client);
      assertOk(await client.request({
        op: "append",
        expected_sequence: 0,
        events: [openEvent(1, "freshness_secret_scan")],
        documents: [],
        verification_records: [],
      }));
      keychainRecord = await readKeychainTestAnchor(workspace);
      assert.equal(keychainRecord.length > 64, true, "Keychain freshness record is unexpectedly empty");
      assert.equal(
        JSON.parse(keychainRecord.toString("utf8")).storage_slot,
        workspace.freshnessAccount,
      );
      await delay(50);
    } catch (error) {
      operationError = error;
    }

    await captureArtifactsAroundClose(client, workspace, observedArtifacts);
    observedArtifacts.push(
      { filename: "stdout", bytes: client.stdoutBytes },
      { filename: "stderr", bytes: client.stderrBytes },
    );
    if (keychainRecord) {
      for (const { bytes, filename } of observedArtifacts) {
        assert.equal(
          bytes.includes(keychainRecord),
          false,
          `${filename} leaked the serialized Keychain freshness record`,
        );
        assert.equal(
          bytes.includes(Buffer.from(workspace.freshnessAccount)),
          false,
          `${filename} leaked the Keychain test account`,
        );
      }
    }
  } finally {
    await client.close();
    await workspace.cleanup();
  }
  if (operationError) throw operationError;
});

test("raw continuation and correlation token bytes never reach DB, WAL, SHM, or logs", async () => {
  const workspace = await createPersistenceWorkspace("token-scan");
  const client = await launchCoordinator(workspace);
  const continuationToken = `fictional-continuation-${randomBytes(24).toString("hex")}`;
  const correlationToken = `fictional-correlation-${randomBytes(24).toString("hex")}`;
  const observedArtifacts = [];
  let operationError;
  try {
    try {
      await initialize(client);
      const batch = sidecarBatch(0, "token_scan");
      assertOk(await client.request({
        op: "append",
        expected_sequence: 0,
        events: batch.events,
        documents: batch.documents,
        verification_records: batch.verification_records,
      }));

      const malicious = openEvent(5, "token_scan_rejected");
      malicious.payload.continuation_token = continuationToken;
      malicious.payload.correlation_token = correlationToken;
      const rejected = await client.request({
        op: "append",
        expected_sequence: 4,
        events: [malicious],
        documents: [],
        verification_records: [],
      });
      assertSanitizedError(
        rejected,
        "raw_continuation_token_forbidden",
        "raw token ingress",
      );
      assert.equal(
        assertSanitizedOk(await client.request({ op: "load" }), "raw token rollback load")
          .journal_sequence === 4,
        true,
        "raw token rejection changed durable sequence",
      );
      assertSanitizedOk(
        await client.request({ op: "integrity" }),
        "raw token integrity check",
      );
      await delay(50);
    } catch (error) {
      operationError = error;
    }

    await captureArtifactsAroundClose(client, workspace, observedArtifacts);
    observedArtifacts.push(
      { filename: "structured-stdout", bytes: client.stdoutBytes },
      { filename: "structured-stderr", bytes: client.stderrBytes },
    );
    for (const { bytes, filename } of observedArtifacts) {
      assert.equal(
        bytes.includes(Buffer.from(continuationToken)),
        false,
        `${filename} leaked raw continuation token bytes`,
      );
      assert.equal(
        bytes.includes(Buffer.from(correlationToken)),
        false,
        `${filename} leaked raw correlation token bytes`,
      );
    }
    for (const line of client.stderrText.split("\n").filter(Boolean)) {
      assert.doesNotThrow(() => JSON.parse(line), "stderr contained a non-JSON diagnostic");
    }
  } finally {
    await workspace.cleanup();
  }
  if (operationError) throw operationError;
});

test("runtime-known secrets are rejected from allowed values and never reach storage or process output", async () => {
  const workspace = await createPersistenceWorkspace("sensitive-corpus");
  const client = await launchCoordinator(workspace);
  const sensitiveValue = baseContinuation.continuation_token;
  const observedArtifacts = [];
  let operationError;
  try {
    try {
      await initialize(client);
      assertSanitizedOk(await client.request({
        op: "validate",
        contract: "continuation_envelope",
        document: baseContinuation,
      }), "register typed continuation secret");

      const suite = await contractSuitePromise;
      const validatePacket = suite.compiled.validatorsByName.get("decision_packet");
      const validateEvent = suite.compiled.validatorsByName.get("runtime_event");
      const valueMutations = [
        ["proposal_id", (batch) => {
          batch.events[0].payload.proposal_id = sensitiveValue;
        }],
        ["summary", (batch) => {
          batch.packet.summary = sensitiveValue;
        }],
        ["objective", (batch) => {
          batch.packet.choices[0].action.objective = sensitiveValue;
        }],
        ["evidence", (batch) => {
          batch.packet.evidence[0].summary = sensitiveValue;
        }],
      ];
      for (const [field, mutate] of valueMutations) {
        const batch = sidecarBatch(0, `known_secret_${field}`);
        mutate(batch);
        assert.equal(validatePacket(batch.packet), true, `${field} packet must remain schema-valid`);
        for (const event of batch.events) {
          assert.equal(validateEvent(event), true, `${field} event must remain schema-valid`);
        }
        const response = await client.request({
          op: "append",
          expected_sequence: 0,
          events: batch.events,
          documents: batch.documents,
          verification_records: batch.verification_records,
        });
        assertSanitizedError(
          response,
          "raw_continuation_token_forbidden",
          `${field} known-secret ingress`,
        );
        assert.equal(
          assertSanitizedOk(
            await client.request({ op: "load" }),
            `${field} rollback load`,
          ).journal_sequence === 0,
          true,
          `${field} known-secret ingress changed durable state`,
        );
      }

      const unsafeMetadata = await client.requestExpecting(
        { request_id: sensitiveValue, op: sensitiveValue },
        "unknown",
      );
      assert.equal(
        unsafeMetadata.request_id === "unknown",
        true,
        "unsafe request ID was echoed",
      );
      assertSanitizedError(unsafeMetadata, "invalid_request", "unsafe request metadata");
      assertSanitizedError(
        await client.request({ op: sensitiveValue }),
        "invalid_request",
        "unsafe operation metadata",
      );
      const secretOverflow = await client.requestRawLine(
        rawAppendRequest(
          sensitiveValue,
          "9223372036854775808",
          "known_secret_correlation_overflow",
        ),
        "unknown",
        2_000,
      );
      assert.equal(secretOverflow.request_id, "unknown");
      assertSanitizedError(
        secretOverflow,
        "contract_validation_failed",
        "known-secret overflow correlation",
      );
      await delay(50);
    } catch (error) {
      operationError = error;
    }

    await captureArtifactsAroundClose(client, workspace, observedArtifacts);
    observedArtifacts.push(
      { filename: "stdout", bytes: client.stdoutBytes },
      { filename: "stderr", bytes: client.stderrBytes },
    );
    for (const { bytes } of observedArtifacts) {
      assert.equal(
        bytes.includes(Buffer.from(sensitiveValue)),
        false,
        "a runtime-known sensitive value reached a forbidden artifact",
      );
    }
    for (const line of client.stderrText.split("\n").filter(Boolean)) {
      assert.doesNotThrow(() => JSON.parse(line), "stderr contained a non-JSON diagnostic");
    }
  } finally {
    await workspace.cleanup();
  }
  if (operationError) throw operationError;
});

test("NDJSON integer parsing accepts Int64.max exactly and rejects Int64.max plus one", async () => {
  const workspace = await createPersistenceWorkspace("integer-boundary");
  const client = await launchCoordinator(workspace);
  try {
    await initialize(client);
    const maximumRequestID = "integer_boundary_max";
    const maximum = await client.requestRawLine(
      rawAppendRequest(maximumRequestID, "9223372036854775807", "integer_max"),
      maximumRequestID,
    );
    assertError(maximum, "journal_sequence_conflict", "Int64.max expected sequence");

    const overflowRequestID = "integer_boundary_overflow";
    const overflow = await client.requestRawLine(
      rawAppendRequest(overflowRequestID, "9223372036854775808", "integer_overflow"),
      overflowRequestID,
      2_000,
    );
    assertError(overflow, "invalid_request", "Int64.max plus one expected sequence");

    const unsafeRequestID = "unsafe/request/id-must-not-be-echoed";
    const unsafe = await client.requestRawLine(
      rawAppendRequest(unsafeRequestID, "9223372036854775808", "integer_unsafe_id"),
      "unknown",
      2_000,
    );
    assert.equal(unsafe.request_id, "unknown");
    assertError(unsafe, "contract_validation_failed", "unsafe overflow correlation");

    const duplicateFirst = "duplicate-first-must-not-be-echoed";
    const duplicateSecond = "duplicate-second-must-not-be-echoed";
    const duplicateRequest = rawAppendRequest(
      duplicateFirst,
      "9223372036854775808",
      "integer_duplicate_id",
    ).replace(
      `\"request_id\":${JSON.stringify(duplicateFirst)}`,
      `\"request_id\":${JSON.stringify(duplicateFirst)},\"request_id\":${JSON.stringify(duplicateSecond)}`,
    );
    const duplicate = await client.requestRawLine(duplicateRequest, "unknown", 2_000);
    assert.equal(duplicate.request_id, "unknown");
    assertError(duplicate, "contract_validation_failed", "duplicate request correlation");

    for (const forbidden of [unsafeRequestID, duplicateFirst, duplicateSecond]) {
      assert.equal(client.stdoutText.includes(forbidden), false, "unsafe request ID reached stdout");
      assert.equal(client.stderrText.includes(forbidden), false, "unsafe request ID reached stderr");
    }
    assert.equal(assertOk(await client.request({ op: "load" })).journal_sequence, 0);
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});

test("Swift strict ingress matches the Ajv oracle for supported v1 fixtures", async () => {
  const workspace = await createPersistenceWorkspace("strict-parity");
  const client = await launchCoordinator(workspace);
  try {
    await initialize(client);
    const suite = await contractSuitePromise;
    const supported = new Set([
      "continuation_envelope",
      "decision_packet",
      "runtime_event",
      "selection_request",
    ]);
    const cases = suite.fixtureManifest.cases.filter((fixtureCase) => (
      supported.has(fixtureCase.schema)
    ));
    assert.equal(cases.length, 20, "fixture parity scope unexpectedly changed");

    for (const fixtureCase of cases) {
      const validator = fixtureValidator(suite.compiled, fixtureCase);
      const oracleValid = validator(fixtureCase.value);
      assert.equal(
        oracleValid,
        fixtureCase.valid,
        `${fixtureCase.name}: ${formatAjvErrors(validator.errors)}`,
      );
      const response = await client.request({
        op: "validate",
        contract: fixtureCase.schema,
        document: fixtureCase.value,
      });
      if (oracleValid) {
        const result = assertOk(response, fixtureCase.name);
        assert.deepEqual(result, { contract: fixtureCase.schema, valid: true });
      } else {
        assertError(response, "contract_validation_failed", fixtureCase.name);
      }
    }

    const validSelection = structuredClone(cases.find((fixtureCase) => (
      fixtureCase.valid && fixtureCase.schema === "selection_request"
    )).value);
    validSelection.unknown_field = "strict additionalProperties must reject this";
    const selectionValidator = suite.compiled.validatorsByName.get("selection_request");
    assert.equal(selectionValidator(validSelection), false);
    assertError(
      await client.request({
        op: "validate",
        contract: "selection_request",
        document: validSelection,
      }),
      "contract_validation_failed",
      "unknown selection field",
    );

    const invalidCalendar = structuredClone(cases.find((fixtureCase) => (
      fixtureCase.valid && fixtureCase.schema === "runtime_event"
    )).value);
    invalidCalendar.occurred_at = "2026-02-29T10:00:00Z";
    const eventValidator = suite.compiled.validatorsByName.get("runtime_event");
    assert.equal(eventValidator(invalidCalendar), false);
    assertError(
      await client.request({
        op: "validate",
        contract: "runtime_event",
        document: invalidCalendar,
      }),
      "contract_validation_failed",
      "invalid calendar timestamp",
    );
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});

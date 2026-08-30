import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { after, test } from "node:test";

import {
  buildCoordinator,
  buildProductCoordinator,
  cleanupCoordinatorBuild,
  CONTRACTS_ROOT,
} from "../CoordinatorPersistence/runtime-harness.mjs";

const OPERATIONAL_TEST_RUNTIME_IDENTITY =
  "sha256:9f26db098b51450583945ef7a1da32d3f84b07ea697860ef5036f63c43c85b35";
const OPERATIONAL_RUNTIME_REQUEST_TYPE_PREFIX = "blabee.runtime-identity.v1/";

after(async () => {
  await cleanupCoordinatorBuild();
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spawnBuiltBinary(
  build,
  arguments_,
  { environment = {}, input = "", timeoutMs = 15_000 } = {},
) {
  const child = spawn(build.binaryPath, arguments_, {
    env: {
      ...build.environment,
      BLABEE_RUNTIME_IDENTITY: OPERATIONAL_TEST_RUNTIME_IDENTITY,
      ...environment,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(input);
  const completion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`adapter exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  return { child, completion };
}

async function runBuiltBinary(build, arguments_, options) {
  return await spawnBuiltBinary(build, arguments_, options).completion;
}

async function startOperationalServer() {
  const build = await buildCoordinator();
  const fixtureRoot = await mkdtemp("/tmp/blabee-t011-operational-");
  await chmod(fixtureRoot, 0o700);
  const contractsPath = path.join(fixtureRoot, "contracts-v1");
  const enabledProjectPath = path.join(fixtureRoot, "enabled-project");
  const authorityRootPath = path.join(fixtureRoot, "authority");
  await cp(CONTRACTS_ROOT, contractsPath, { recursive: true });
  await Promise.all([
    chmod(contractsPath, 0o700),
    mkdir(enabledProjectPath, { mode: 0o700 }),
    mkdir(authorityRootPath, { mode: 0o700 }),
  ]);
  const databasePath = path.join(fixtureRoot, "coordinator.sqlite3");
  const keyPath = path.join(fixtureRoot, "coordinator.key");
  const socketPath = path.join(fixtureRoot, "blabee.sock");
  const child = spawn(
    build.binaryPath,
    [
      "operational-roundtrip-test-server",
      "--fixture-root", fixtureRoot,
      "--database", databasePath,
      "--key", keyPath,
      "--contracts", contractsPath,
      "--enabled-project", enabledProjectPath,
      "--socket", socketPath,
      "--authority-root", authorityRootPath,
    ],
    {
      env: {
        ...build.environment,
        BLABEE_RUNTIME_IDENTITY: OPERATIONAL_TEST_RUNTIME_IDENTITY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdout.setEncoding("utf8");
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("operational server did not become ready"));
    }, 20_000);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(
        `operational server exited before ready (code=${code}, signal=${signal}, stderr=${Buffer.concat(stderr)})`,
      ));
    };
    child.once("exit", onExit);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      child.off("exit", onExit);
      assert.deepEqual(JSON.parse(output.slice(0, newline)), { ready: true });
      resolve();
    });
  });
  return {
    build,
    child,
    fixtureRoot,
    databasePath,
    enabledProjectPath,
    keyPath,
    socketPath,
    async stop() {
      const termination = await new Promise((resolve) => {
        const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          resolve({ code, signal });
        });
        child.kill("SIGTERM");
      });
      assert.deepEqual(
        termination,
        { code: 0, signal: null },
        Buffer.concat(stderr).toString("utf8"),
      );
      assert.equal(Buffer.concat(stderr).toString("utf8"), "");
      await assert.rejects(
        stat(socketPath),
        (error) => error?.code === "ENOENT",
        "the operational server must remove its owned socket before exit",
      );
    },
    async abort() {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill("SIGKILL");
        });
      }
    },
  };
}

function udsRequest(socketPath, type, payload = {}) {
  return new Promise((resolve, reject) => {
    const request_id = `request_roundtrip_${Math.random().toString(16).slice(2)}`;
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`UDS ${type} request timed out`));
    }, 5_000);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({
        request_id,
        runtime_identity: OPERATIONAL_TEST_RUNTIME_IDENTITY,
        type: `${OPERATIONAL_RUNTIME_REQUEST_TYPE_PREFIX}${type}`,
        payload,
      })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.end();
      try {
        const response = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        assert.equal(response.request_id, request_id);
        assert.equal(response.runtime_identity, OPERATIONAL_TEST_RUNTIME_IDENTITY);
        resolve(response);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function hookPayload(hook_event_name, fields = {}) {
  return {
    session_id: "session_operational_roundtrip",
    transcript_path: "/tmp/fictional-operational-roundtrip.jsonl",
    permission_mode: "default",
    hook_event_name,
    ...fields,
  };
}

function contextValue(context, key) {
  const match = context.match(new RegExp(`${key}=([^;.]+)`));
  assert.ok(match, `missing ${key} in designated prompt context`);
  return match[1];
}

const QUEUED_PROMPT_PREFIX =
  "Blabee 선택 작업을 불러옵니다. Hook 세부 조건이 없으면 실행하지 마세요. ref=";
const QUEUED_ACTION_CONTEXT_MARKER =
  "Blabee verified the selected action locally. Execute exactly this action JSON as the new user request. The visible ref is transport metadata, and a queue receipt is not proof that the work succeeded.\n";

function queuedPrompt(continuationID, enabledProjectPath) {
  const normalizedProjectPath = path.resolve(enabledProjectPath);
  const reference = createHash("sha256")
    .update(
      `blabee-next-turn-v2\0${continuationID}\0${normalizedProjectPath}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
  return `${QUEUED_PROMPT_PREFIX}${reference}`;
}

function canonicalJSONObject(value) {
  if (Array.isArray(value)) return value.map(canonicalJSONObject);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJSONObject(value[key])]),
    );
  }
  return value;
}

function canonicalJSON(value) {
  return JSON.stringify(canonicalJSONObject(value));
}

function assertOpaqueQueuedPrompt(
  message,
  { action, continuationID, enabledProjectPath, identifiers },
) {
  assert.equal(message, queuedPrompt(continuationID, enabledProjectPath));
  assert.match(message.slice(QUEUED_PROMPT_PREFIX.length), /^[0-9a-f]{32}$/);
  for (const leakedValue of [
    canonicalJSON(action),
    action.title,
    action.objective,
    ...action.constraints,
    ...action.done_when,
    continuationID,
    ...Object.values(identifiers).filter(
      (value) => typeof value === "string" && value.length > 0,
    ),
  ]) {
    assert.equal(
      message.includes(leakedValue),
      false,
      `queued prompt leaked ${leakedValue}`,
    );
  }
  for (const leakedKey of [
    "{",
    '"action"',
    '"binding"',
    "continuation_id",
    "correlation_token",
  ]) {
    assert.equal(message.includes(leakedKey), false, `queued prompt leaked ${leakedKey}`);
  }
}

function proposal(ids, suffix) {
  return {
    schema_version: "1.0",
    interaction_kind: "blabee_decision",
    proposal_id: `proposal_operational_${suffix}`,
    correlation_token: ids.correlation_token,
    task_goal: `Complete operational boundary ${suffix}`,
    outcome: {
      status: "completed",
      summary: `Operational boundary ${suffix} is ready`,
    },
    recommended_next: {
      title: `Continue ${suffix}`,
      objective: `Perform the verified ${suffix} continuation`,
      constraints: ["Keep the binding exact"],
      done_when: [`The ${suffix} continuation completes`],
    },
    alternative_next: null,
    pause_capsule: { resume_first: `Resume from ${suffix}` },
    reported_side_effects: [],
  };
}

function proposalWrapper(ids, proposal_) {
  return {
    project_id: ids.project_id,
    session_id: ids.session_id,
    source_turn_id: ids.source_turn_id,
    source_prompt_id: ids.source_prompt_id,
    episode_id: ids.episode_id,
    correlation_token: ids.correlation_token,
    proposal: proposal_,
  };
}

async function emitDecision(productBuild, socketPath, wrapper) {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "blabee-roundtrip-test", version: "0.1.0" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "emit_decision", arguments: wrapper },
    },
  ];
  const result = await runBuiltBinary(
    productBuild,
    ["mcp", "--socket", socketPath],
    { input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n` },
  );
  assert.deepEqual(
    { code: result.code, signal: result.signal, stderr: result.stderr },
    { code: 0, signal: null, stderr: "" },
  );
  const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.protocolVersion, "2025-06-18");
  assert.equal(responses[1].result.isError, undefined);
  return { result, response: responses[1].result.structuredContent };
}

async function waitForInteraction(socketPath, boundarySequence) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await udsRequest(socketPath, "get_state");
    assert.equal(response.ok, true);
    const interaction = response.result.interactions.find(
      (candidate) => candidate.boundary_sequence === boundarySequence
        && candidate.state === "waiting",
    );
    if (interaction) return { interaction, response };
    await delay(20);
  }
  throw new Error(`boundary ${boundarySequence} did not enter waiting state`);
}

function selection(interaction, sequence) {
  const choice = interaction.choices.find(
    (candidate) => candidate.slot === 1 && candidate.enabled === true,
  );
  assert.ok(choice);
  const request = {
    schema_version: "1.0",
    kind: "blabee_selection_request",
    selection_id: `selection_operational_${sequence}`,
    interaction_id: interaction.interaction_id,
    packet_id: interaction.packet_id,
    revision: interaction.revision,
    option_id: choice.option_id,
  };
  for (const key of [
    "project_id",
    "session_id",
    "source_turn_id",
    "source_prompt_id",
    "episode_id",
    "episode_root_prompt_id",
    "episode_baseline_checkpoint_id",
    "decision_boundary_id",
    "boundary_sequence",
  ]) {
    request[key] = interaction[key];
  }
  assert.equal(Object.keys(request).length, 16);
  return request;
}

function focusRequest(interaction) {
  const request = {
    schema_version: "1.0",
    kind: "blabee_pet_focus_request",
    interaction_id: interaction.interaction_id,
    packet_id: interaction.packet_id,
    revision: interaction.revision,
  };
  for (const key of [
    "project_id",
    "session_id",
    "source_turn_id",
    "source_prompt_id",
    "episode_id",
    "episode_root_prompt_id",
    "episode_baseline_checkpoint_id",
    "decision_boundary_id",
    "boundary_sequence",
  ]) {
    request[key] = interaction[key];
  }
  assert.equal(Object.keys(request).length, 14);
  return request;
}

async function readStorageArtifacts(databasePath) {
  const values = [];
  for (const artifactPath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      values.push(await readFile(artifactPath));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Buffer.concat(values);
}

test("real Hook, MCP, Pet, UDS, SQLite flow late-attaches and queues two next turns without leakage", async () => {
  const server = await startOperationalServer();
  const productBuild = await buildProductCoordinator();
  const productBinary = await readFile(productBuild.binaryPath);
  assert.equal(
    productBinary.includes(Buffer.from("operational-roundtrip-test-server")),
    false,
    "the integration server mode must be compiled out of the product binary",
  );
  let stopped = false;
  try {
    const userPromptPayload = hookPayload("UserPromptSubmit", {
      cwd: server.enabledProjectPath,
      turn_id: "turn_operational_roundtrip",
      prompt: "Run the real operational roundtrip",
    });
    const userPrompt = await runBuiltBinary(
      productBuild,
      ["hook", "UserPromptSubmit", "--socket", server.socketPath],
      {
        input: JSON.stringify(userPromptPayload),
      },
    );
    assert.deepEqual(
      { code: userPrompt.code, signal: userPrompt.signal, stderr: userPrompt.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    const userPromptOutput = JSON.parse(userPrompt.stdout);
    assert.equal(userPromptOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    const designatedContext = userPromptOutput.hookSpecificOutput.additionalContext;
    const ids = Object.fromEntries([
      "project_id",
      "session_id",
      "source_turn_id",
      "source_prompt_id",
      "episode_id",
      "episode_root_prompt_id",
      "episode_baseline_checkpoint_id",
      "correlation_token",
    ].map((key) => [key, contextValue(designatedContext, key)]));
    assert.equal(userPrompt.stdout.split(ids.correlation_token).length - 1, 1);

    const sessionStart = await runBuiltBinary(
      productBuild,
      ["hook", "SessionStart", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("SessionStart", {
          cwd: server.enabledProjectPath,
          source: "resume",
        })),
      },
    );
    assert.deepEqual(
      { code: sessionStart.code, signal: sessionStart.signal, stderr: sessionStart.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    const sessionOutput = JSON.parse(sessionStart.stdout);
    assert.equal(sessionOutput.hookSpecificOutput.hookEventName, "SessionStart");

    const resumedPrompt = await udsRequest(
      server.socketPath,
      "user_prompt_submit",
      userPromptPayload,
    );
    assert.equal(resumedPrompt.ok, true);
    assert.equal(resumedPrompt.result.enabled, true);
    for (const key of [
      "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
    ]) {
      assert.equal(resumedPrompt.result.identifiers[key], ids[key], key);
    }

    const assistantPrivateMarker = "fictional-private-finalization-marker";
    const fallbackInput = JSON.stringify(hookPayload("Stop", {
      cwd: server.enabledProjectPath,
      turn_id: ids.source_turn_id,
      stop_hook_active: false,
      last_assistant_message: `short action result ${assistantPrivateMarker}`,
    }));
    const fallbackStop = await runBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      { input: fallbackInput },
    );
    assert.deepEqual(
      { code: fallbackStop.code, signal: fallbackStop.signal, stderr: fallbackStop.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    assert.equal(fallbackStop.stdout, "");
    assert.equal(fallbackStop.stdout.includes(assistantPrivateMarker), false);
    assert.equal(fallbackStop.stdout.includes(ids.correlation_token), false);

    const replayedFallbackStop = await runBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      { input: fallbackInput },
    );
    assert.deepEqual(replayedFallbackStop, fallbackStop);

    const firstProposal = proposal(ids, "one");
    const firstMCP = await emitDecision(
      productBuild,
      server.socketPath,
      proposalWrapper(ids, firstProposal),
    );
    assert.equal(firstMCP.response.accepted, true);
    assert.equal(firstMCP.response.staged, false);
    assert.equal(firstMCP.response.packet.boundary_sequence, 1);

    const firstStop = await runBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("Stop", {
          cwd: server.enabledProjectPath,
          turn_id: ids.source_turn_id,
          stop_hook_active: false,
          last_assistant_message: "finalization self-check emitted boundary one",
        })),
      },
    );
    assert.deepEqual(firstStop, {
      code: 0,
      signal: null,
      stderr: "",
      stdout: "",
    });
    // The Stop adapter has already exited before the user focuses or selects the Pet card.
    const firstWaiting = await waitForInteraction(server.socketPath, 1);
    const firstFocus = await udsRequest(
      server.socketPath,
      "focus_interaction",
      focusRequest(firstWaiting.interaction),
    );
    assert.deepEqual(firstFocus.result, { focused: true });
    const firstSelection = await udsRequest(
      server.socketPath,
      "select",
      selection(firstWaiting.interaction, 1),
    );
    assert.equal(firstSelection.ok, true);
    assert.equal(firstSelection.result.accepted, true);
    assert.equal(firstSelection.result.outcome.kind, "next_turn");
    assert.equal(
      firstSelection.result.outcome.queued_submission_id,
      `queued_${firstSelection.result.outcome.continuation_id}`,
    );
    const afterFirstSelection = await udsRequest(server.socketPath, "get_state");
    assert.equal(afterFirstSelection.ok, true);
    assert.deepEqual(afterFirstSelection.result.interactions, []);
    assert.deepEqual(afterFirstSelection.result.routing.pending, []);
    assert.equal(afterFirstSelection.result.routing.in_flight_count, 0);

    const firstQueuedPrompt = queuedPrompt(
      firstSelection.result.outcome.continuation_id,
      server.enabledProjectPath,
    );
    assertOpaqueQueuedPrompt(firstQueuedPrompt, {
      action: firstProposal.recommended_next,
      continuationID: firstSelection.result.outcome.continuation_id,
      enabledProjectPath: server.enabledProjectPath,
      identifiers: { ...ids, ...firstWaiting.interaction },
    });

    const secondUserPromptPayload = hookPayload("UserPromptSubmit", {
      cwd: server.enabledProjectPath,
      turn_id: "turn_operational_roundtrip_queued_two",
      prompt: firstQueuedPrompt,
    });
    const secondUserPrompt = await runBuiltBinary(
      productBuild,
      ["hook", "UserPromptSubmit", "--socket", server.socketPath],
      { input: JSON.stringify(secondUserPromptPayload) },
    );
    assert.deepEqual(
      {
        code: secondUserPrompt.code,
        signal: secondUserPrompt.signal,
        stderr: secondUserPrompt.stderr,
      },
      { code: 0, signal: null, stderr: "" },
    );
    const secondUserPromptOutput = JSON.parse(secondUserPrompt.stdout);
    assert.equal(
      secondUserPromptOutput.hookSpecificOutput.hookEventName,
      "UserPromptSubmit",
    );
    const secondDesignatedContext = secondUserPromptOutput.hookSpecificOutput.additionalContext;
    const secondIds = Object.fromEntries([
      "project_id",
      "session_id",
      "source_turn_id",
      "source_prompt_id",
      "episode_id",
      "episode_root_prompt_id",
      "episode_baseline_checkpoint_id",
      "correlation_token",
    ].map((key) => [key, contextValue(secondDesignatedContext, key)]));
    assert.equal(secondIds.project_id, ids.project_id);
    assert.equal(secondIds.session_id, ids.session_id);
    for (const key of [
      "source_turn_id",
      "source_prompt_id",
      "episode_id",
      "episode_root_prompt_id",
      "episode_baseline_checkpoint_id",
      "correlation_token",
    ]) {
      assert.notEqual(secondIds[key], ids[key], key);
    }
    assert.equal(
      secondUserPrompt.stdout.split(secondIds.correlation_token).length - 1,
      1,
    );
    const canonicalFirstAction = canonicalJSON(firstProposal.recommended_next);
    assert.equal(
      secondDesignatedContext.endsWith(
        `${QUEUED_ACTION_CONTEXT_MARKER}${canonicalFirstAction}`,
      ),
      true,
    );
    const queuedActionOffset = secondDesignatedContext.lastIndexOf(
      QUEUED_ACTION_CONTEXT_MARKER,
    );
    assert.notEqual(queuedActionOffset, -1);
    const queuedActionJSON = secondDesignatedContext.slice(
      queuedActionOffset + QUEUED_ACTION_CONTEXT_MARKER.length,
    );
    assert.equal(queuedActionJSON, canonicalFirstAction);
    assert.deepEqual(
      JSON.parse(queuedActionJSON),
      canonicalJSONObject(firstProposal.recommended_next),
    );

    const secondProposal = proposal(secondIds, "two");
    const secondMCP = await emitDecision(
      productBuild,
      server.socketPath,
      proposalWrapper(secondIds, secondProposal),
    );
    assert.equal(secondMCP.response.accepted, true);
    assert.equal(secondMCP.response.staged, false);
    assert.equal(secondMCP.response.packet.boundary_sequence, 1);

    const secondStop = await runBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("Stop", {
          cwd: server.enabledProjectPath,
          turn_id: secondIds.source_turn_id,
          stop_hook_active: false,
          last_assistant_message: "queued next turn emitted boundary two",
        })),
      },
    );
    assert.deepEqual(secondStop, {
      code: 0,
      signal: null,
      stderr: "",
      stdout: "",
    });
    // This Stop also completes before Pet interaction, and the new episode restarts at sequence 1.
    const secondWaiting = await waitForInteraction(server.socketPath, 1);
    assert.equal(secondWaiting.interaction.episode_id, secondIds.episode_id);
    assert.equal(secondWaiting.interaction.boundary_sequence, 1);
    const secondFocus = await udsRequest(
      server.socketPath,
      "focus_interaction",
      focusRequest(secondWaiting.interaction),
    );
    assert.deepEqual(secondFocus.result, { focused: true });
    const secondSelection = await udsRequest(
      server.socketPath,
      "select",
      selection(secondWaiting.interaction, 2),
    );
    assert.equal(secondSelection.ok, true);
    assert.equal(secondSelection.result.accepted, true);
    assert.equal(secondSelection.result.outcome.kind, "next_turn");
    assert.equal(
      secondSelection.result.outcome.queued_submission_id,
      `queued_${secondSelection.result.outcome.continuation_id}`,
    );
    const secondQueuedPrompt = queuedPrompt(
      secondSelection.result.outcome.continuation_id,
      server.enabledProjectPath,
    );
    assertOpaqueQueuedPrompt(secondQueuedPrompt, {
      action: secondProposal.recommended_next,
      continuationID: secondSelection.result.outcome.continuation_id,
      enabledProjectPath: server.enabledProjectPath,
      identifiers: { ...secondIds, ...secondWaiting.interaction },
    });
    const finalState = await udsRequest(server.socketPath, "get_state");
    assert.equal(finalState.ok, true);
    assert.deepEqual(finalState.result.interactions, []);
    assert.deepEqual(finalState.result.routing.pending, []);
    assert.equal(finalState.result.routing.in_flight_count, 0);
    assert.equal(finalState.result.routing.selection_enabled, false);

    const publicOutputWithoutDesignatedContext = [
      sessionStart.stdout,
      sessionStart.stderr,
      JSON.stringify(resumedPrompt),
      fallbackStop.stdout,
      fallbackStop.stderr,
      replayedFallbackStop.stdout,
      replayedFallbackStop.stderr,
      firstMCP.result.stdout,
      firstMCP.result.stderr,
      JSON.stringify(firstWaiting.response),
      JSON.stringify(firstFocus),
      JSON.stringify(firstSelection),
      firstQueuedPrompt,
      firstStop.stdout,
      firstStop.stderr,
      JSON.stringify(afterFirstSelection),
      secondMCP.result.stdout,
      secondMCP.result.stderr,
      JSON.stringify(secondWaiting.response),
      JSON.stringify(secondFocus),
      JSON.stringify(secondSelection),
      secondQueuedPrompt,
      secondStop.stdout,
      secondStop.stderr,
      JSON.stringify(finalState),
    ].join("\n");
    assert.equal(publicOutputWithoutDesignatedContext.includes(ids.correlation_token), false);
    assert.equal(
      publicOutputWithoutDesignatedContext.includes(secondIds.correlation_token),
      false,
    );
    assert.equal(publicOutputWithoutDesignatedContext.includes(assistantPrivateMarker), false);
    assert.equal(publicOutputWithoutDesignatedContext.includes('"correlation_token"'), false);
    assert.equal(publicOutputWithoutDesignatedContext.includes('"continuation_token"'), false);
    assert.equal(designatedContext.includes(ids.correlation_token), true);
    assert.equal(secondDesignatedContext.includes(secondIds.correlation_token), true);

    const storageBytes = await readStorageArtifacts(server.databasePath);
    assert.equal(storageBytes.includes(Buffer.from(ids.correlation_token)), false);
    assert.equal(storageBytes.includes(Buffer.from(secondIds.correlation_token)), false);
    assert.equal(storageBytes.includes(Buffer.from(assistantPrivateMarker)), false);
    assert.equal(storageBytes.includes(Buffer.from('"correlation_token"')), false);
    assert.equal(storageBytes.includes(Buffer.from('"continuation_token":')), false);

    await server.stop();
    stopped = true;
  } finally {
    if (!stopped) await server.abort();
    await rm(server.fixtureRoot, { force: true, recursive: true });
  }
});
